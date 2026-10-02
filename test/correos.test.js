// Pipeline de correos personales (Gmail → cola → reglas/Gemini → pendientes y avisos) y Jira por API.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('./gasMocks');

function respuestaGemini(obj) {
  return { codigo: 200, cuerpo: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } };
}

function preparar(opciones) {
  const env = crearEntorno(opciones);
  env.ctx.setup();
  Object.assign(env.props, { TELEGRAM_TOKEN: 'tok', CHAT_ID: '777', GEMINI_API_KEY: 'clave' });
  env.decir = (t) => env.ctx.responder_(t);
  env.avisos = () => env.enviados.map((m) => m.text).join('\n');
  return env;
}

const enMinutos = (m) => new Date(Date.now() + m * 60000);

test('primera ejecución no procesa el histórico', () => {
  const bandeja = [{ id: 'viejo', de: 'x@gmail.com', asunto: 'Correo viejo', cuerpo: 'hola', fecha: enMinutos(-600) }];
  const env = preparar({ bandeja, gemini: () => assert.fail('no debe llamar a Gemini') });
  env.ctx.escanearGmail();
  assert.equal(env.hojas.Correos._filas.length, 1); // solo encabezado
  assert.ok(env.props.CORREOS_DESDE_personal);
});

test('reglas + Gemini: pendientes, avisos, resumen y cuerpo borrado', () => {
  const bandeja = [];
  const env = preparar({
    bandeja,
    gemini: (payload) => {
      const texto = payload.contents[0].parts[0].text;
      assert.doesNotMatch(texto, /maria@gmail\.com|3001234567/, 'los datos sensibles se tapan antes de enviar');
      if (/arriendo/i.test(texto)) {
        return respuestaGemini({ categoria: 'finanzas', importante: true, prioridad: 'alta', resumen: 'María: el arriendo sube a $2.100.000 desde noviembre', tarea: 'Responder a María sobre el arriendo', fecha_limite: null, monto: 2100000 });
      }
      return respuestaGemini({ categoria: 'informativo', importante: false, prioridad: 'baja', resumen: 'Confirmación de registro', tarea: null });
    },
  });
  env.ctx.escanearGmail(); // fija CORREOS_DESDE

  bandeja.push(
    { id: 'm1', hilo: 'h1', de: 'María <maria@gmail.com>', asunto: 'Arriendo noviembre', cuerpo: 'Hola, el arriendo sube. Llámame al 3001234567', fecha: enMinutos(1) },
    { id: 'm2', hilo: 'h2', de: 'RappiCard <extractos@rappicard.co>', asunto: 'Tu extracto está listo', cuerpo: 'Pago total: $2.345.600 Fecha límite de pago: 15/10/2026', fecha: enMinutos(1) },
    { id: 'm3', hilo: 'h3', de: 'Netflix <info@netflix.com>', asunto: 'Tu recibo', cuerpo: 'Total $44.900', fecha: enMinutos(1) },
    { id: 'm4', hilo: 'h4', de: 'Plataforma <no-reply@plataforma.co>', asunto: 'Bienvenido', cuerpo: 'Gracias por registrarte', fecha: enMinutos(1) },
    { id: 'm5', hilo: 'h5', de: 'Tienda <news@tienda.co>', asunto: 'Ofertas', cuerpo: '50% off', listaBaja: true, fecha: enMinutos(1) },
  );
  env.enviados.length = 0;
  env.ctx.escanearGmail();

  assert.equal(env.llamadas.gemini.length, 2, 'solo los ambiguos (m1, m4) van a Gemini');
  const avisos = env.avisos();
  assert.match(avisos, /📬 <b>Correos importantes<\/b>/);
  assert.match(avisos, /🔴 <i>personal<\/i> · María: el arriendo sube[\s\S]*→ #\d+ Responder a María sobre el arriendo/);
  assert.match(avisos, /Extracto Rappi[\s\S]*Pagar tarjeta Rappi \$2\.345\.600 · vence/);
  assert.doesNotMatch(avisos, /Netflix|Bienvenido|Ofertas/, 'lo informativo no interrumpe');

  const pend = env.decir('/pendientes personal');
  assert.match(pend, /Pagar tarjeta Rappi \$2\.345\.600[\s\S]*✉️/);
  assert.match(pend, /Responder a María/);

  const filas = env.ctx.leer_('Correos');
  assert.ok(filas.every((c) => c.estado === 'procesado' && c.cuerpo === ''), 'no queda cuerpo guardado');
  assert.deepEqual(filas.map((c) => c.origen), ['ia', 'regla:extracto', 'regla:suscripcion', 'ia', 'regla:boletin']);

  const correos = env.decir('/correos');
  assert.match(correos, /💳 Extractos \(1\)[\s\S]*🔁 Suscripciones y cobros \(1\)[\s\S]*\$44\.900/);
  assert.doesNotMatch(env.decir('/resumen'), /Correos \(24 h\)/, 'los correos ya no van en el resumen; se ven con /correos');

  // Una respuesta en el mismo hilo no duplica el pendiente.
  bandeja.push({ id: 'm6', hilo: 'h1', de: 'María <maria@gmail.com>', asunto: 'RE: Arriendo noviembre', cuerpo: 'arriendo, ¿me confirmas?', fecha: enMinutos(2) });
  env.ctx.escanearGmail();
  assert.equal((env.decir('/pendientes personal').match(/Responder a María/g) || []).length, 1);

  // Una segunda pasada no reprocesa nada.
  const llamadas = env.llamadas.gemini.length;
  env.ctx.escanearGmail();
  assert.equal(env.llamadas.gemini.length, llamadas);
});

test('cuota de Gemini agotada: el correo queda en cola y se procesa después', () => {
  const bandeja = [];
  let cuota = true;
  const env = preparar({
    bandeja,
    gemini: () => (cuota ? { codigo: 429, cuerpo: { error: { message: 'quota' } } } : respuestaGemini({ categoria: 'seguridad', importante: true, prioridad: 'alta', resumen: 'Nuevo inicio de sesión en tu cuenta', tarea: null })),
  });
  env.ctx.escanearGmail();
  bandeja.push(
    { id: 'a', de: 'Banco X <seguridad@x.com>', asunto: 'Alerta de acceso', cuerpo: 'nuevo dispositivo', fecha: enMinutos(1) },
    { id: 'b', de: 'Otro <o@x.com>', asunto: 'Otra cosa', cuerpo: 'algo', fecha: enMinutos(1) },
  );
  env.ctx.escanearGmail();
  assert.equal(env.llamadas.gemini.length, 1, 'tras el 429 no insiste en esa ejecución');
  assert.deepEqual(env.ctx.leer_('Correos').map((c) => c.estado), ['cola', 'cola']);

  cuota = false;
  env.enviados.length = 0;
  env.ctx.escanearGmail();
  assert.deepEqual(env.ctx.leer_('Correos').map((c) => c.estado), ['procesado', 'procesado']);
  assert.match(env.avisos(), /Nuevo inicio de sesión/);
});

test('sin API key de Gemini todo sigue funcionando con reglas', () => {
  const bandeja = [];
  const env = preparar({ bandeja, gemini: () => assert.fail('no debe llamar a Gemini') });
  delete env.props.GEMINI_API_KEY;
  env.ctx.escanearGmail();
  bandeja.push({ id: 'z', de: 'Juan <juan@gmail.com>', asunto: 'Hola', cuerpo: 'hola', fecha: enMinutos(1) });
  env.ctx.escanearGmail();
  assert.deepEqual(env.ctx.leer_('Correos').map((c) => [c.origen, c.accion]), [['sin_ia', 'resumen']]);
});

test('/ignorar agrega el remitente a la lista', () => {
  const env = preparar({});
  assert.match(env.decir('/ignorar Boletines.com'), /boletines\.com/);
  env.decir('/ignorar otra.com');
  assert.equal(env.ctx.getConfig_('IGNORAR_REMITENTES'), 'boletines.com, otra.com');
});

test('Jira: solo lo que está en curso, cierres, /hecho y reasignación', () => {
  const enCurso = { name: 'En curso' };
  let issues = [
    { key: 'EMP-101', fields: { summary: 'Ajustar liquidación de demurrage', priority: { name: 'High' }, duedate: '2026-10-10', status: enCurso } },
    { key: 'EMP-102', fields: { summary: 'Revisar parser de BL', priority: { name: 'Medium' }, duedate: null, status: enCurso } },
    { key: 'EMP-103', fields: { summary: 'Cotizar flete marítimo', priority: null, duedate: null, status: { name: 'Por hacer' } } },
  ];
  let codigo = 200;
  const env = preparar({ jira: () => ({ codigo, cuerpo: { issues } }) });
  assert.match(env.decir('/jira'), /no está configurado/);
  Object.assign(env.props, { JIRA_SITIO: 'https://miempresa.atlassian.net/', JIRA_CORREO: 'ana@miempresa.co', JIRA_TOKEN: 't' });

  env.enviados.length = 0;
  env.ctx.escanearJira();
  assert.match(env.llamadas.jira[0], /^https:\/\/miempresa\.atlassian\.net\/rest\/api\/3\/search\/jql\?jql=assignee%20%3D%20currentUser\(\)/);
  assert.match(env.avisos(), /🎫 <b>Jira: en curso<\/b>[\s\S]*#1 <a href="https:\/\/miempresa\.atlassian\.net\/browse\/EMP-101">EMP-101<\/a> Ajustar liquidación de demurrage <i>\(High\)<\/i> · vence/);
  assert.match(env.decir('/pendientes trabajo'), /#1 EMP-101 · Ajustar liquidación[\s\S]*🎫[\s\S]*#2 EMP-102/);
  assert.doesNotMatch(env.decir('/pendientes trabajo'), /EMP-103/, '"Por hacer" no es pendiente');

  // Segunda pasada sin cambios: nada nuevo.
  env.enviados.length = 0;
  env.ctx.escanearJira();
  assert.equal(env.enviados.length, 0);

  // Cerrado en el bot: no se recrea mientras siga abierto en Jira.
  assert.match(env.decir('/hecho 2'), /recuerda moverlo también en Jira/);
  env.ctx.escanearJira();
  assert.doesNotMatch(env.decir('/pendientes trabajo'), /EMP-102/);

  // EMP-101 se resuelve en Jira → se cierra solo.
  issues = issues.filter((i) => i.key !== 'EMP-101');
  env.enviados.length = 0;
  env.ctx.escanearJira();
  assert.match(env.avisos(), /Ya no están en curso en Jira: #1 EMP-101/);

  // EMP-101 se reabre y te lo reasignan → pendiente nuevo.
  issues.push({ key: 'EMP-101', fields: { summary: 'Ajustar liquidación de demurrage', priority: null, duedate: null, status: enCurso } });
  env.ctx.escanearJira();
  assert.match(env.decir('/pendientes trabajo'), /#3 EMP-101/);

  // EMP-103 pasa a "In Progress" (Jira en inglés) → pendiente; luego a "En revisión" → se cierra.
  issues.find((i) => i.key === 'EMP-103').fields.status = { name: 'In Progress' };
  env.ctx.escanearJira();
  assert.match(env.decir('/pendientes trabajo'), /#4 EMP-103/);
  issues.find((i) => i.key === 'EMP-103').fields.status = { name: 'En revisión' };
  env.enviados.length = 0;
  env.ctx.escanearJira();
  assert.match(env.avisos(), /Ya no están en curso en Jira: #4 EMP-103/);

  // Config JIRA_ESTADOS = "todos" → sin filtro de estado.
  env.ctx.setConfig_('JIRA_ESTADOS', 'todos');
  env.ctx.escanearJira();
  assert.match(env.decir('/pendientes trabajo'), /#5 EMP-103/);

  // Token vencido: avisa una sola vez.
  codigo = 401;
  env.enviados.length = 0;
  env.ctx.escanearJira();
  env.ctx.escanearJira();
  assert.equal(env.enviados.length, 1);
  assert.match(env.avisos(), /venció el token/);
});
