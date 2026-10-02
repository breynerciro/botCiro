// /configurar: menús con botones, espera de datos y secretos que se borran del chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('./gasMocks');

function preparar(opciones = {}) {
  const env = crearEntorno(opciones);
  env.ctx.setup();
  env.props.TELEGRAM_TOKEN = 'tok';
  env.props.WEBAPP_URL = 'https://script.google.com/macros/s/prueba/exec';
  let updateId = 1;
  let mensajeId = 100;
  const textos = () => env.enviados.map((m) => m.text).join('\n');
  env.decir = (texto, chat = { id: 777, type: 'private' }) => {
    env.enviados.length = 0;
    env.tgLlamadas.length = 0;
    env.ctx.doPost({
      parameter: { key: env.props.WEBHOOK_SECRET },
      postData: { contents: JSON.stringify({ update_id: updateId++, message: { message_id: mensajeId++, chat: chat, text: texto } }) },
    });
    return textos();
  };
  // Pulsa un botón del menú: el bot edita el mensaje (editMessageText).
  env.tocar = (data) => {
    env.enviados.length = 0;
    env.tgLlamadas.length = 0;
    env.ctx.doPost({
      parameter: { key: env.props.WEBHOOK_SECRET },
      postData: { contents: JSON.stringify({ update_id: updateId++, callback_query: { id: 'cb', data: data, message: { message_id: 1, chat: { id: 777 } } } }) },
    });
    const editado = env.tgLlamadas.filter((l) => l.metodo === 'editMessageText').pop();
    env.ultimoTeclado = editado && editado.payload.reply_markup ? editado.payload.reply_markup.inline_keyboard.flat() : [];
    return editado ? editado.payload.text : textos();
  };
  env.botones = () => env.ultimoTeclado.map((b) => b.callback_data);
  env.decir('/vincular ' + env.props.CODIGO_VINCULACION);
  return env;
}

test('menú de /configurar con el estado de cada sección', () => {
  const env = preparar();
  env.decir('/configurar');
  const menu = env.enviados[0];
  assert.match(menu.text, /⚪ <b>IA<\/b>/);
  assert.match(menu.text, /⚪ <b>Cuentas<\/b>: 0/);
  assert.deepEqual(menu.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['cfg:ia', 'cfg:cuentas', 'cfg:trabajo', 'cfg:jira', 'cfg:pref']);
  assert.match(env.tocar('cfg:ia'), /Google AI Studio/);
  assert.match(env.tocar('cfg:menu'), /Configuración de botCiro/);
});

test('API key de Gemini: se valida, se guarda y se borra del chat', () => {
  let valida = false;
  const env = preparar({ gemini: () => (valida ? { codigo: 200, cuerpo: { models: [] } } : { codigo: 400, cuerpo: { error: { message: 'API key not valid' } } }) });
  env.tocar('cfg:ia_key');
  const r1 = env.decir('AIzaSyFalsa-clave-de-prueba-000000');
  assert.match(r1, /no aceptó esa API key/);
  assert.ok(env.tgLlamadas.some((l) => l.metodo === 'deleteMessage'), 'el mensaje con la clave se borra');
  assert.equal(env.props.GEMINI_API_KEY, undefined);

  valida = true;
  env.tocar('cfg:ia_key');
  assert.match(env.decir('AIzaSyFalsa-clave-de-prueba-111111'), /IA activada/);
  assert.equal(env.props.GEMINI_API_KEY, 'AIzaSyFalsa-clave-de-prueba-111111');
  assert.equal(env.ctx.iaDisponible_(), true);
});

test('las claves no se aceptan en grupos', () => {
  const env = preparar();
  env.props.CHAT_ID = '777';
  env.tocar('cfg:ia_key');
  assert.match(env.decir('AIzaSyFalsa-clave-de-prueba-222222', { id: 777, type: 'group' }), /chat privado/);
  assert.equal(env.props.GEMINI_API_KEY, undefined);
});

test('agregar cuentas paso a paso y fijar la cuenta por defecto', () => {
  const env = preparar();
  env.tocar('cfg:cuentas');
  assert.ok(env.botones().includes('cfg:cta_nueva'));
  env.tocar('cfg:cta_nueva');
  assert.ok(env.botones().includes('cfg:cta_b:nequi'));

  assert.match(env.tocar('cfg:cta_b:nequi'), /qué tipo de cuenta/);
  assert.match(env.tocar('cfg:cta_t:a'), /últimos 4 dígitos/);
  assert.match(env.decir('12'), /exactamente 4 dígitos/);
  assert.match(env.decir('4321'), /¿Cuánto tienes hoy en Nequi/);
  assert.match(env.decir('150 mil'), /Listo: <b>Nequi ahorros \*4321<\/b> \(personal\), saldo \$150\.000/);

  // Tarjeta de crédito: la deuda queda como saldo negativo.
  env.tocar('cfg:cta_b:falabella');
  env.tocar('cfg:cta_t:tc');
  env.tocar('cfg:cta_sin4');
  assert.match(env.decir('950000'), /Falabella TC.*debes \$950\.000/);
  assert.match(env.decir('/saldo'), /Falabella TC: debes <b>\$950\.000/);

  // Con dos cuentas se puede elegir la de por defecto y el gasto ya no pregunta.
  env.tocar('cfg:cta_def');
  const nequi = env.ultimoTeclado.find((b) => /Nequi/.test(b.text));
  env.tocar(nequi.callback_data);
  assert.match(env.decir('almuerzo 20 mil, gasté'), /−\$20\.000 almuerzo[\s\S]*Nequi ahorros \*4321/);
});

test('un comando cancela la espera y el texto vuelve a ser normal', () => {
  const env = preparar();
  env.tocar('cfg:cta_b:nequi');
  env.tocar('cfg:cta_t:a');
  assert.match(env.decir('/cancelar'), /cancelado/);
  assert.doesNotMatch(env.decir('1234'), /tienes hoy/);
});

test('Jira: sitio, correo y token validados contra /myself', () => {
  const env = preparar({ jira: (url) => (url.endsWith('/myself') ? { codigo: 200, cuerpo: { displayName: 'Ana Prueba' } } : { codigo: 200, cuerpo: { issues: [] } }) });
  env.tocar('cfg:jira_con');
  assert.match(env.decir('https://miempresa.atlassian.net/jira/'), /¿Con qué correo/);
  assert.match(env.decir('ana@ejemplo.com'), /token/);
  assert.match(env.decir('token-falso-123'), /Jira conectado como <b>Ana Prueba<\/b>/);
  assert.equal(env.props.JIRA_SITIO, 'miempresa.atlassian.net');
  assert.ok(env.tgLlamadas.some((l) => l.metodo === 'deleteMessage'));
  assert.equal(env.ctx.trabajoActivo_(), true, 'con Jira el perfil trabajo se activa solo');
});

test('trabajo: código de conexión del satélite y perfil opcional', () => {
  const env = preparar();
  assert.equal(env.ctx.trabajoActivo_(), false);
  assert.match(env.tocar('cfg:tr_con'), /\/exec\?sync=/);
  env.tocar('cfg:tr_onoff');
  assert.equal(env.ctx.trabajoActivo_(), true);
  assert.match(env.decir('/ayuda'), /\/perfil/);
  env.tocar('cfg:tr_onoff');
  assert.doesNotMatch(env.decir('/ayuda'), /\/perfil/);
});

test('preferencias: hora del resumen reprograma el trigger', () => {
  const env = preparar();
  env.ctx.instalarTriggers();
  env.tocar('cfg:pf:HORA_RESUMEN');
  assert.match(env.decir('25:00'), /Hora del resumen diario/, 'hora inválida: vuelve a preguntar');
  assert.match(env.decir('7:15'), /Guardado[\s\S]*Hora del resumen diario: <b>7:15<\/b>/);
  assert.equal(env.ctx.getConfig_('HORA_RESUMEN'), '7:15');
  assert.ok(env.triggers.includes('enviarResumenDiario'));
  assert.match(env.tocar('cfg:pf:AVISO_VENCIMIENTOS'), /Avisar pendientes que vencen: <b>no<\/b>/);
});
