// Express crea el servidor HTTP y define las rutas que podrá utilizar el navegador.
const express = require('express');
// crypto se usa para comparar la clave administrativa sin revelar información por tiempo de respuesta.
const crypto = require('crypto');
// body-parser permite leer formularios HTML y peticiones JSON enviadas a este backend.
const bodyParser = require('body-parser');
// path permite construir la ruta del archivo .env de forma compatible con Windows y Linux.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
// Este servidor es independiente del servidor LTI, por eso utiliza otro puerto.
const PORT = Number(process.env.REST_PORT || 3001);
// Nunca escribas el token de Moodle en el código. La clave administrativa se lee desde .env.
const ADMIN_KEY = String(process.env.ADMIN_KEY || 'LTI_ADMIN_KEY').trim();

// La configuración se mantiene en memoria mientras el proceso está encendido.
// Si se reinicia Node, será necesario volver a introducir la URL y el token.
let moodleConfig = { url: '', token: '' };
// Aquí se conserva el último resultado de importación para mostrarlo en la interfaz y en la API.
let moodleSnapshot = null;

// Acepta formularios HTML como POST /import.
app.use(bodyParser.urlencoded({ extended: false }));
// Acepta clientes que envíen JSON a los endpoints de la API.
app.use(bodyParser.json());

// Escapa caracteres HTML para que los datos recibidos desde Moodle no se interpreten como etiquetas.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Protege las rutas administrativas.
// La clave puede llegar en un header, en la URL o en el formulario HTML.
function requireAdmin(req, res, next) {
  const providedKey = req.get('x-admin-key') || req.query.admin_key || req.body?.admin_key;
  const providedBuffer = Buffer.from(String(providedKey || '').trim());
  const expectedBuffer = Buffer.from(ADMIN_KEY);
  const matches = providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  if (!matches) {
    return res.status(401).json({ ok: false, error: 'Clave administrativa no válida' });
  }
  return next();
}

// Acepta tanto la URL base de Moodle como una URL que ya incluya
// /webservice/rest/server.php y siempre devuelve una URL base limpia.
function normalizeMoodleUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/webservice\/rest\/server\.php\/?$/i, '')
    .replace(/\/+$/, '');
}

// Ejecuta una función del Web Service REST de Moodle.
// Moodle recibe el token y el nombre de la función como parámetros de consulta.
async function moodleCall(functionName, args = {}) {
  const baseUrl = normalizeMoodleUrl(moodleConfig.url);
  if (!baseUrl || !moodleConfig.token) {
    throw new Error('Configura la URL y el token de Moodle desde el formulario de conexión');
  }

  // URL valida la estructura y nos permite rechazar protocolos inseguros o no soportados.
  let moodleUrl;
  try {
    moodleUrl = new URL(baseUrl);
  } catch (error) {
    throw new Error('La URL de Moodle no es válida. Usa, por ejemplo, https://campus.tudominio.com/moodle');
  }
  if (!['http:', 'https:'].includes(moodleUrl.protocol)) {
    throw new Error('La URL de Moodle debe comenzar por http:// o https://');
  }

  // URLSearchParams codifica correctamente el token, el nombre de la función y sus argumentos.
  const params = new URLSearchParams({
    wstoken: moodleConfig.token,
    wsfunction: functionName,
    moodlewsrestformat: 'json',
  });
  Object.entries(args).forEach(([key, value]) => params.set(key, String(value)));

  // fetch realiza la conexión desde el backend; el token no se expone al navegador.
  let response;
  try {
    response = await fetch(`${baseUrl}/webservice/rest/server.php?${params.toString()}`);
  } catch (error) {
    throw new Error(`No se pudo alcanzar Moodle en ${baseUrl}. Comprueba que la URL sea real y accesible desde este equipo.`);
  }

  // Se lee como texto primero porque Moodle puede devolver HTML cuando hay un error de configuración.
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Moodle no devolvió JSON (HTTP ${response.status})`);
  }
  if (!response.ok || payload?.exception || payload?.errorcode) {
    throw new Error(payload?.message || `Moodle respondió con HTTP ${response.status}`);
  }
  return payload;
}

// Importa la información principal del sitio y la amplía con actividades e integrantes por curso.
// Las funciones secundarias son opcionales: si faltan permisos, se conserva el resto de la importación.
async function importMoodleData() {
  const warnings = [];
  // Ejecuta una llamada que puede fallar sin cancelar toda la importación.
  const callOptional = async (functionName, args, fallback) => {
    try {
      return await moodleCall(functionName, args);
    } catch (error) {
      warnings.push(`${functionName}: ${error.message}`);
      return fallback;
    }
  };

  // Esta llamada es obligatoria porque confirma que la URL y el token funcionan.
  const site = await moodleCall('core_webservice_get_site_info');
  const [users, roles, courses, categories] = await Promise.all([
    callOptional('core_user_get_users', { 'criteria[0][key]': 'email', 'criteria[0][value]': '%' }, []),
    callOptional('core_role_get_roles', {}, []),
    callOptional('core_course_get_courses', {}, []),
    callOptional('core_course_get_categories', {}, []),
  ]);

  // Para cada curso se consultan en paralelo sus contenidos y sus usuarios matriculados.
  const courseRecords = await Promise.all((courses || []).map(async (course) => {
    const [contents, members] = await Promise.all([
      callOptional('core_course_get_contents', { courseid: course.id }, []),
      callOptional('core_enrol_get_enrolled_users', { courseid: course.id }, []),
    ]);
    return { ...course, activities: contents, members };
  }));

  return { importedAt: new Date().toISOString(), site, users, roles, categories, courses: courseRecords, warnings };
}

// Construye una página HTML sencilla para que una persona pueda configurar e inspeccionar el servicio.
// Esta interfaz pertenece al backend REST; no forma parte del backend LTI.
function renderPage(title, content) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>
  :root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #17252b; background: #f7faf8; --teal: #116b66; --line: #d9e4e1; --muted: #617177; }
  * { box-sizing: border-box; } body { margin: 0; } .topbar { padding: 20px 7vw; color: white; background: #153f40; font-weight: 800; letter-spacing: .03em; } .topbar small { display: block; margin-top: 4px; color: #b8d8ce; font-size: 12px; font-weight: 500; }
  .shell { width: min(1060px, calc(100% - 32px)); margin: 34px auto 60px; } .hero, .panel { padding: 28px; border: 1px solid var(--line); background: white; } .hero { box-shadow: 0 18px 50px rgba(23, 63, 64, .08); } .eyebrow { margin: 0 0 8px; color: var(--teal); font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; } h1, h2 { margin: 0; line-height: 1.1; } h1 { font-size: clamp(30px, 5vw, 52px); } h2 { font-size: 22px; } .lead { max-width: 700px; margin: 16px 0 0; color: var(--muted); font-size: 17px; line-height: 1.6; } .grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(240px, .8fr); gap: 20px; margin-top: 20px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; } .stat { padding: 18px; border: 1px solid var(--line); background: #f5fbf8; } .stat strong { display: block; font-size: 28px; color: var(--teal); } .stat span, th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; } .field { display: grid; gap: 7px; margin: 14px 0; } .field label { font-weight: 700; } input { width: 100%; padding: 12px; border: 1px solid var(--line); font: inherit; } button { border: 0; padding: 12px 18px; color: white; background: var(--teal); font: inherit; font-weight: 700; cursor: pointer; } .table-wrap { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { padding: 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; } .notice { margin-top: 16px; padding: 14px; background: #fff6dd; border-left: 4px solid #cf9c2e; } @media (max-width: 720px) { .shell { width: min(100% - 20px, 1060px); margin-top: 20px; } .hero, .panel { padding: 20px; } .grid { grid-template-columns: 1fr; } .stats { grid-template-columns: repeat(2, 1fr); } }
</style></head><body><header class="topbar">IMPORTADOR MOODLE<small>Backend REST independiente del servicio LTI</small></header><main class="shell">${content}</main></body></html>`;
}

// Convierte el snapshot en tarjetas y tabla para la página principal.
// Renderiza el resumen y, cuando existe una importación, ofrece la descarga del JSON completo.
function renderSummary(adminKey = '') {
  if (!moodleSnapshot) {
    return '<section class="panel"><h2>Aún no hay una importación</h2><p class="lead">Configura la conexión y usa el botón para traer la información de Moodle.</p></section>';
  }
  const activityCount = moodleSnapshot.courses.reduce((total, course) => total + course.activities.length, 0);
  return `<div class="stats"><div class="stat"><strong>${moodleSnapshot.users.length}</strong><span>Usuarios</span></div><div class="stat"><strong>${moodleSnapshot.roles.length}</strong><span>Roles</span></div><div class="stat"><strong>${moodleSnapshot.courses.length}</strong><span>Cursos</span></div><div class="stat"><strong>${activityCount}</strong><span>Actividades</span></div></div><section class="panel"><h2>Cursos importados</h2><div class="table-wrap"><table><thead><tr><th>Curso</th><th>Integrantes</th><th>Actividades</th></tr></thead><tbody>${moodleSnapshot.courses.map((course) => `<tr><td>${escapeHtml(course.fullname || course.shortname || course.id)}</td><td>${course.members.length}</td><td>${course.activities.reduce((total, section) => total + (section.modules || []).length, 0)}</td></tr>`).join('')}</tbody></table></div>${moodleSnapshot.warnings.length ? `<div class="notice"><strong>Advertencias:</strong><br>${moodleSnapshot.warnings.map(escapeHtml).join('<br>')}</div>` : ''}<form method="get" action="/api/lms/snapshot/download"><input type="hidden" name="admin_key" value="${escapeHtml(adminKey)}"><button type="submit">Descargar snapshot JSON</button></form></section>`;
}

// Página principal del importador.
// Solo muestra el formulario; la conexión real con Moodle ocurre al enviar POST /import.
app.get('/', (req, res) => {
  res.send(renderPage('Importador Moodle', `<section class="hero"><p class="eyebrow">Backend REST</p><h1>Importar Moodle</h1><p class="lead">Este servicio administra exclusivamente la URL, el token REST y el snapshot importado. El lanzamiento LTI funciona en otro backend.</p></section><div class="grid"><section>${renderSummary(req.query.admin_key)}</section><aside class="panel"><h2>Conexión</h2><form method="post" action="/import"><div class="field"><label for="admin_key">Clave administrativa</label><input id="admin_key" name="admin_key" type="password" required></div><div class="field"><label for="url">URL de Moodle</label><input id="url" name="url" type="url" placeholder="https://campus.example.com" value="${escapeHtml(moodleConfig.url)}" required></div><div class="field"><label for="token">Token REST</label><input id="token" name="token" type="password" required></div><button type="submit">Importar Moodle</button></form></aside></div>`));
});

// Guarda temporalmente la configuración y ejecuta la importación completa.
// La clave administrativa se valida antes de permitir el acceso al token y a Moodle.
app.post('/import', requireAdmin, async (req, res) => {
  try {
    moodleConfig = { url: normalizeMoodleUrl(req.body.url), token: String(req.body.token || '').trim() };
    moodleSnapshot = await importMoodleData();
    res.redirect(`/?admin_key=${encodeURIComponent(req.body.admin_key)}`);
  } catch (error) {
    res.status(502).send(renderPage('Error de Moodle', `<section class="hero"><p class="eyebrow">Importación fallida</p><h1>No se pudo conectar con Moodle</h1><p class="lead">${escapeHtml(error.message)}</p></section>`));
  }
});

// Devuelve el último snapshot en formato JSON para otra interfaz o cliente autorizado.
app.get('/api/lms/snapshot', requireAdmin, (req, res) => {
  res.json({ ok: true, snapshot: moodleSnapshot });
});

// Descarga el último snapshot como archivo JSON para guardarlo o procesarlo en otra aplicación.
app.get('/api/lms/snapshot/download', requireAdmin, (req, res) => {
  if (!moodleSnapshot) {
    return res.status(404).json({ ok: false, error: 'Todavía no existe un snapshot importado' });
  }

  const fileName = `moodle-snapshot-${new Date(moodleSnapshot.importedAt).toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(JSON.stringify(moodleSnapshot, null, 2));
});

// Arranca únicamente el backend REST. El backend LTI se inicia por separado en server.js.
app.listen(PORT, () => {
  console.log(`Backend REST Moodle escuchando en http://localhost:${PORT}`);
  console.log('  GET  /');
  console.log('  POST /import');
  console.log('  GET  /api/lms/snapshot');
});
