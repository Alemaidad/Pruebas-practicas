# Funcionamiento del token REST en `rest-server.js`

## Alcance

Este documento describe el flujo implementado por [`rest-server.js`](./rest-server.js): cómo recibe un token REST de Moodle, cómo lo usa para consultar el Web Service REST y cómo entrega los datos importados. El servidor no crea ni solicita un token a Moodle: una persona debe generar/configurar el token en Moodle y pegarlo en el formulario.

## Dos credenciales diferentes

El flujo usa dos credenciales que cumplen propósitos distintos:

| Credencial | Quién la valida | Uso |
|---|---|---|
| **Clave administrativa** (`ADMIN_KEY`) | Este servidor Node.js, mediante `requireAdmin` | Autoriza a una persona a iniciar la importación y consultar/descargar el snapshot. |
| **Token REST de Moodle** (`wstoken`) | Moodle | Autoriza las llamadas que este servidor hace al Web Service REST de Moodle, con los permisos asociados a su usuario y servicio externo. |

La clave administrativa no es el token de Moodle, y no se envía a Moodle. El token de Moodle tampoco autoriza por sí solo las rutas locales del servidor.

## Recorrido de una importación

1. El proceso carga `lti-demo/.env` y lee `ADMIN_KEY` y `REST_PORT`. El puerto predeterminado es `3001`. La página `/` muestra el formulario con tres valores: clave administrativa, URL del sitio Moodle y token REST.
2. El navegador envía el formulario a `POST /import`. `requireAdmin` compara la clave recibida con `ADMIN_KEY` antes de que la ruta procese la configuración.
3. La ruta normaliza la URL y conserva URL y token en `moodleConfig`, una variable en memoria del proceso Node.js. El token no se escribe en `.env` ni se persiste en disco.
4. `importMoodleData()` llama primero a `core_webservice_get_site_info`. Esta llamada es obligatoria: comprueba que Moodle acepta la URL y el token. Si falla, la importación se considera fallida.
5. Si la comprobación pasa, se solicitan en paralelo estas funciones:
   - `core_user_get_users`, con criterio de correo electrónico `%`.
   - `core_role_get_roles`.
   - `core_course_get_courses`.
   - `core_course_get_categories`.
6. Para cada curso se consultan en paralelo `core_course_get_contents` y `core_enrol_get_enrolled_users`. Estas consultas son opcionales: si alguna falla, se usa una lista vacía para ese dato y se añade el error a `warnings`; no se cancela el resto de la importación.
7. El resultado se guarda en `moodleSnapshot` con `importedAt`, `site`, `users`, `roles`, `categories`, `courses` y `warnings`. El servidor lo imprime en la consola y redirige el navegador a `/` para mostrar el resumen.

Cada llamada a Moodle usa el mismo token. `moodleCall()` añade a la URL de Moodle los parámetros `wstoken`, `wsfunction` y `moodlewsrestformat=json`, más los argumentos propios de la función. `URLSearchParams` codifica los valores. La respuesta se lee como texto y luego se interpreta como JSON, ya que Moodle también puede responder HTML ante algunos errores. Se consideran errores una respuesta HTTP no exitosa o un payload con `exception` o `errorcode`.

## Rutas locales y autorización

`POST /import` y ambas rutas `/api/lms/snapshot...` requieren la clave administrativa mediante `requireAdmin`. Se acepta en cualquiera de estos lugares, con esta prioridad:

1. Header `x-admin-key`.
2. Parámetro de consulta `admin_key`.
3. Campo `admin_key` del cuerpo de la petición.

| Ruta | Resultado |
|---|---|
| `GET /` | Muestra el formulario y el resumen actual. No inicia una llamada a Moodle. |
| `POST /import` | Valida la clave administrativa, guarda temporalmente URL/token y ejecuta la importación. |
| `GET /api/lms/snapshot` | Devuelve `{ ok: true, snapshot: ... }`; antes de importar, `snapshot` es `null`. |
| `GET /api/lms/snapshot/download` | Descarga el snapshot como JSON; devuelve HTTP `404` si todavía no existe. |

En errores de importación, `POST /import` devuelve HTTP `502` y presenta el mensaje de error. Si no se proporciona una clave administrativa válida, las rutas protegidas responden HTTP `401`.

## Configuración en Moodle

Para que la integración funcione, Moodle debe tener habilitados los servicios web y el protocolo REST, y el token debe pertenecer a un usuario autorizado para el servicio externo que contiene las funciones anteriores. La disponibilidad de cada función depende de la configuración y permisos de Moodle. Por eso, una importación puede completar la consulta obligatoria del sitio y aun así registrar advertencias por funciones opcionales.

La URL puede ser la raíz del sitio Moodle o incluir al final `/webservice/rest/server.php`; el código elimina ese sufijo si está presente. Se admiten esquemas `http` y `https`, aunque HTTPS debe preferirse, especialmente en producción.

## Configuración y ejecución local

1. Copia `.env.example` a `.env` y establece una clave administrativa privada:

   ```dotenv
   REST_PORT=3001
   ADMIN_KEY=una-clave-administrativa-larga-y-privada
   ```

2. Desde el directorio `lti-demo`, instala dependencias si es necesario y ejecuta `npm start`.
3. Abre `http://localhost:3001`, introduce la clave administrativa, la URL de Moodle y el token REST, y pulsa **Importar Moodle**.

No se debe guardar el token de Moodle en el código, el repositorio, `.env.example` ni mensajes compartidos. Al reiniciar Node.js se pierden `moodleConfig` y `moodleSnapshot`; es necesario volver a introducir URL y token y ejecutar la importación de nuevo.

## Consideraciones de seguridad y límites

- El token se transmite a Moodle como parámetro de consulta (`wstoken`), no como header. Debe usarse HTTPS hacia Moodle para evitar que viaje en claro. Como las URL pueden aparecer en registros de servidores, proxies o herramientas de diagnóstico, esos registros deben protegerse y no deben incluir datos sensibles.
- El formulario se sirve por HTTP en la configuración predeterminada local. En despliegues no locales, debe exponerse detrás de HTTPS y con controles de acceso de red apropiados; el campo `type="password"` solo oculta visualmente el valor, no cifra el transporte.
- `ADMIN_KEY` tiene un valor de reserva (`REST_ADMIN_KEY`) si no se configura. En cualquier despliegue real debe definirse un valor privado en `.env`; el valor de reserva no es una credencial segura.
- La clave administrativa se incluye en el parámetro `admin_key` de la redirección y del formulario de descarga. Los parámetros de consulta pueden quedar registrados o aparecer en historiales; para integraciones automatizadas es preferible enviar la clave en el header `x-admin-key`.
- El servidor mantiene el token en memoria mientras está en ejecución y no implementa renovación, expiración ni revocación. Esas funciones dependen de Moodle; para dejar de usar un token, debe revocarse en Moodle.
- El snapshot contiene información de usuarios y cursos. El código lo imprime completo en la consola y lo permite consultar/descargar tras validar la clave administrativa. Se deben restringir los logs, el acceso a las rutas y el almacenamiento del archivo descargado.
- `GET /` no está protegido por `requireAdmin` y el resumen renderizado puede mostrar nombres de cursos, cantidad de integrantes y actividades, además de advertencias. Si esos metadatos son confidenciales, limita también el acceso a esta página.
- La clave se compara con `crypto.timingSafeEqual` solo después de comprobar que ambos buffers tienen la misma longitud. Esto evita una comparación ordinaria dependiente del contenido, pero no reemplaza una clave fuerte ni protege el transporte HTTP.

## Referencias en el código

- Lectura de configuración y estado en memoria: `rest-server.js`, configuración inicial.
- Validación de clave local: función `requireAdmin`.
- Normalización de URL y llamada autenticada a Moodle: `normalizeMoodleUrl()` y `moodleCall()`.
- Consultas y tolerancia de fallos opcionales: `importMoodleData()`.
- Formulario, importación y endpoints del snapshot: rutas Express declaradas al final del archivo.
