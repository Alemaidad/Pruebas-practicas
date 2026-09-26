const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.LTI_PORT || process.env.PORT || 3000);
const LTI_URL = process.env.LTI_URL || `http://localhost:${PORT}/lti`;

// Cambia estos valores para tu prueba real.
const CONSUMER_KEY = 'testkey';
const SHARED_SECRET = 'testsecret';

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

function buildBaseString(method, url, params) {
  const normalized = {};

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || key === 'oauth_signature') {
      return;
    }

    normalized[key] = String(value);
  });

  const parameterString = Object.keys(normalized)
    .sort()
    .map((key) => {
      return `${encodeURIComponent(key)}=${encodeURIComponent(normalized[key])}`;
    })
    .join('&');

  return [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(parameterString),
  ].join('&');
}

function calculateOAuthSignature(body, url) {
  const params = { ...body };
  delete params.oauth_signature;

  const baseString = buildBaseString('POST', url, params);
  const signingKey = `${encodeURIComponent(SHARED_SECRET)}&`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function validateLtiLaunch(body) {
  const required = ['oauth_consumer_key', 'oauth_nonce', 'oauth_signature', 'oauth_timestamp', 'oauth_signature_method', 'oauth_version', 'context_id', 'user_id'];
  for (const key of required) {
    if (!body[key]) {
      return { valid: false, error: `Falta el parámetro requerido: ${key}` };
    }
  }

  if (body.oauth_consumer_key !== CONSUMER_KEY) {
    return { valid: false, error: 'Consumer key no válido' };
  }

  const expected = calculateOAuthSignature(body, LTI_URL);
  if (expected !== body.oauth_signature) {
    return { valid: false, error: 'Firma OAuth no válida' };
  }

  return { valid: true };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderPage(title, content) {
  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(title)}</title>
        <style>
          :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --ink: #17252b; --muted: #617177; --line: #d9e4e1; --mint: #d8f3e8; --teal: #116b66; --paper: #f7faf8; }
          * { box-sizing: border-box; }
          body { margin: 0; color: var(--ink); background: var(--paper); }
          .topbar { padding: 20px 7vw; color: white; background: #153f40; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
          .brand { font-weight: 800; letter-spacing: .03em; }
          .brand small { display: block; margin-top: 4px; color: #b8d8ce; font-size: 12px; font-weight: 500; }
          .shell { width: min(1060px, calc(100% - 32px)); margin: 34px auto 60px; }
          .hero { padding: 30px; border: 1px solid var(--line); background: white; box-shadow: 0 18px 50px rgba(23, 63, 64, .08); }
          .eyebrow { margin: 0 0 8px; color: var(--teal); font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
          h1, h2 { margin: 0; line-height: 1.1; }
          h1 { max-width: 760px; font-size: clamp(30px, 5vw, 52px); }
          h2 { font-size: 22px; }
          .lead { max-width: 700px; margin: 16px 0 0; color: var(--muted); font-size: 17px; line-height: 1.6; }
          .grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(240px, .8fr); gap: 20px; margin-top: 20px; }
          .panel { border: 1px solid var(--line); background: white; padding: 24px; }
          .panel h2 { margin-bottom: 18px; }
          .meta { display: grid; gap: 14px; margin: 0; }
          .meta div { padding-bottom: 12px; border-bottom: 1px solid #edf2f0; }
          dt { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
          dd { margin: 5px 0 0; overflow-wrap: anywhere; }
          .activity { margin-top: 26px; padding-top: 22px; border-top: 1px solid var(--line); }
          .question { margin: 18px 0; padding: 18px; border: 1px solid var(--line); background: #fbfdfc; }
          .question p { margin-top: 0; font-weight: 700; }
          label { display: block; padding: 8px 0; color: #33484d; cursor: pointer; }
          input { accent-color: var(--teal); }
          button, .return { display: inline-block; border: 0; padding: 12px 18px; color: white; background: var(--teal); font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
          button:hover, .return:hover { background: #0b514e; }
          .return { margin-top: 18px; color: var(--ink); background: var(--mint); }
          .custom { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); }
          .custom p { margin: 8px 0; overflow-wrap: anywhere; }
          .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
          .stat { padding: 18px; border: 1px solid var(--line); background: #f5fbf8; }
          .stat strong { display: block; font-size: 28px; color: var(--teal); }
          .stat span { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
          .field { display: grid; gap: 7px; margin: 14px 0; }
          .field label { padding: 0; color: var(--ink); font-weight: 700; }
          .field input { width: 100%; padding: 12px; border: 1px solid var(--line); font: inherit; }
          .notice { margin-top: 16px; padding: 14px; background: #fff6dd; border-left: 4px solid #cf9c2e; }
          .table-wrap { overflow-x: auto; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
          th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
          code { overflow-wrap: anywhere; }
          @media (max-width: 720px) { .stats { grid-template-columns: repeat(2, 1fr); } }
          @media (max-width: 720px) { .topbar { padding: 18px 16px; } .shell { width: min(100% - 20px, 1060px); margin-top: 20px; } .hero, .panel { padding: 20px; } .grid { grid-template-columns: 1fr; } }
        </style>
      </head>
      <body>
        <header class="topbar"><div class="brand">AULA EXTERNA<small>Actividad conectada con Moodle</small></div><span>LTI 1.1</span></header>
        <main class="shell">${content}</main>
      </body>
    </html>
  `;
}

app.get('/', (req, res) => {
  res.send(renderPage('Aula externa', `
    <section class="hero">
      <p class="eyebrow">Herramienta externa</p>
      <h1>Tu actividad de Moodle, dentro de esta aula.</h1>
      <p class="lead">Configura esta URL como una actividad de tipo herramienta externa en Moodle. Cada lanzamiento abrirá aquí el nombre, contexto, usuario y parámetros de la actividad recibida.</p>
      <p class="lead">La importación REST se administra en su servicio independiente.</p>
    </section>
  `));
});

app.get('/lti', (req, res) => {
  res.send(renderPage('Esperando lanzamiento', `
    <section class="hero">
      <p class="eyebrow">Esperando Moodle</p>
      <h1>Esta es la puerta de entrada de tus actividades.</h1>
      <p class="lead">El navegador debe llegar aquí mediante un POST firmado desde Moodle. Usa una actividad External Tool para enviar el lanzamiento real.</p>
    </section>
  `));
});

app.post('/lti', (req, res) => {
  const form = req.body || {};

  console.log('--------------------------------------------------');
  console.log('LTI launch recibido');
  console.log('Body keys:', Object.keys(form));
  console.log(JSON.stringify(form, null, 2));
  console.log('--------------------------------------------------');

  const validation = validateLtiLaunch(form);
  if (!validation.valid) {
    return res.status(400).json({ ok: false, error: validation.error, received: form });
  }

  const username = form.lis_person_name_full || form.lis_person_name_given || form.custom_user || 'Usuario Moodle';
  const course = form.context_title || form.context_id || 'Curso Moodle';
  const role = form.roles || 'Learner';
  const activityTitle = form.resource_link_title || 'Actividad de Moodle';
  const activityDescription = form.resource_link_description || 'Moodle ha conectado esta actividad con el aula externa.';
  const customParams = Object.entries(form).filter(([key]) => key.startsWith('custom_'));

  const questionSet = [
    { id: 1, text: '¿Qué significa LTI?', options: ['Learning Tools Interoperability', 'Language Tool Integration', 'Learning Test Interface'], correct: 0 },
    { id: 2, text: '¿Moodle puede lanzar una app externa?', options: ['Sí', 'No'], correct: 0 },
    { id: 3, text: '¿Qué se usa para devolver una nota?', options: ['HTTP GET', 'LTI Grade Service', 'XML directo'], correct: 1 }
  ];

  const questionHtml = questionSet.map((q, index) => `
    <div style="margin-bottom:20px; border:1px solid #ddd; padding:12px; border-radius:8px;">
      <p><strong>${index + 1}. ${q.text}</strong></p>
      ${q.options.map((option, optIndex) => `
        <label style="display:block; margin:6px 0;">
          <input type="radio" name="q${q.id}" value="${optIndex}" /> ${option}
        </label>
      `).join('')}
    </div>
  `).join('');

  const customHtml = customParams.length ? `
    <div class="custom"><strong>Datos enviados por Moodle</strong>
      ${customParams.map(([key, value]) => `<p><strong>${escapeHtml(key.replace('custom_', ''))}:</strong> ${escapeHtml(value)}</p>`).join('')}
    </div>` : '';

  return res.send(renderPage(activityTitle, `
    <section class="hero">
      <p class="eyebrow">Actividad recibida desde Moodle</p>
      <h1>${escapeHtml(activityTitle)}</h1>
      <p class="lead">${escapeHtml(activityDescription)}</p>
    </section>
    <div class="grid">
      <section class="panel">
        <h2>Actividad</h2>
        <div class="activity">
          <p>Completa esta actividad dentro de la herramienta externa. Este contenido puede sustituirse por cualquier experiencia propia de tu aplicación.</p>
          <form method="post" action="/grade">
            <input type="hidden" name="user_id" value="${escapeHtml(form.user_id)}" />
            <input type="hidden" name="lis_result_sourcedid" value="${escapeHtml(form.lis_result_sourcedid)}" />
            ${questionHtml}
            <button type="submit">Enviar respuesta a Moodle</button>
          </form>
        </div>
      </section>
      <aside class="panel">
        <h2>Sesión</h2>
        <dl class="meta">
          <div><dt>Usuario</dt><dd>${escapeHtml(username)}</dd></div>
          <div><dt>Curso</dt><dd>${escapeHtml(course)}</dd></div>
          <div><dt>Rol</dt><dd>${escapeHtml(role)}</dd></div>
          <div><dt>Actividad ID</dt><dd>${escapeHtml(form.resource_link_id || 'No disponible')}</dd></div>
        </dl>
        ${customHtml}
        ${form.launch_presentation_return_url ? `<a class="return" href="${escapeHtml(form.launch_presentation_return_url)}">Volver a Moodle</a>` : ''}
      </aside>
    </div>
  `));
});

app.post('/grade', (req, res) => {
  const userId = req.body.user_id || 'unknown';
  const sourcedid = req.body.lis_result_sourcedid || '';
  const answers = [];
  let score = 0;

  const questionSet = [
    { id: 1, correct: 0 },
    { id: 2, correct: 0 },
    { id: 3, correct: 1 }
  ];

  questionSet.forEach((q) => {
    const answer = Number(req.body['q' + q.id] ?? -1);
    const isCorrect = answer === q.correct;
    if (isCorrect) score += 33.33;
    answers.push({ id: q.id, answer, correct: isCorrect });
  });

  const roundedScore = Math.min(100, Math.max(0, Number(score.toFixed(2))));

  res.send(`
    <html>
      <head><title>Resultado</title></head>
      <body style="font-family:Arial;padding:24px; max-width:760px; margin:0 auto;">
        <h2>Resultado enviado</h2>
        <p><strong>Usuario:</strong> ${userId}</p>
        <p><strong>Nota final:</strong> ${roundedScore}/100</p>
        <p><strong>lis_result_sourcedid:</strong> ${sourcedid}</p>
        <pre>${JSON.stringify(answers, null, 2)}</pre>
        <p>En una integración real aquí se invocaría el Grade Service de Moodle.</p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Servidor LTI demo escuchando en http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /');
  console.log('  POST /lti');
  console.log('  POST /grade');
});
