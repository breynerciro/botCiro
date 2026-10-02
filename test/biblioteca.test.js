// Modo biblioteca: cada copia pasa sus propios servicios y nada se escribe en el almacén compartido.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('./gasMocks');
const { transformar } = require('../scripts/biblioteca');

const TOKEN = '123456789:AAH' + 'x'.repeat(32);

function almacen() {
  const datos = {};
  return {
    datos,
    getProperty: (k) => (k in datos ? datos[k] : null),
    setProperty: (k, v) => (datos[k] = String(v)),
    deleteProperty: (k) => delete datos[k],
  };
}

function copia() {
  const env = crearEntorno({
    transformar: (f, s) => transformar(f, s, 3),
    telegram: (metodo) =>
      metodo === 'getMe' ? { codigo: 200, cuerpo: { ok: true, result: { first_name: 'Asistente de Ana', username: 'ana_asistente_bot' } } } : null,
  });
  const props = almacen();
  const cache = {};
  const ctx = {
    props,
    cache: { get: (k) => cache[k] || null, put: (k, v) => (cache[k] = v), remove: (k) => delete cache[k] },
    lock: { waitLock: () => {}, releaseLock: () => {} },
    url: '',
  };
  return { env, props, ctx, run: (nombre, args) => env.ctx.ejecutar(ctx, nombre, args) };
}

test('instalación completa desde la hoja sin tocar el almacén de la biblioteca', () => {
  const { env, props, run } = copia();

  assert.throws(() => run('instalarConToken', ['no-es-token']), /no parece un token/);
  const r1 = run('instalarConToken', [TOKEN]);
  assert.equal(r1.conectado, false, 'falta la app web');
  assert.equal(r1.nombre, 'Asistente de Ana');
  assert.equal(props.datos.TELEGRAM_TOKEN, TOKEN);
  assert.ok(props.datos.CODIGO_VINCULACION);
  assert.deepEqual(env.triggers.sort(), ['enviarResumenDiario', 'scheduler']);

  assert.throws(() => run('conectarWebApp', ['https://ejemplo.com/exec']), /script\.google\.com/);
  const r2 = run('conectarWebApp', ['https://script.google.com/macros/s/AKfyc-prueba/exec']);
  assert.equal(r2.enlace, `https://t.me/ana_asistente_bot?start=${props.datos.CODIGO_VINCULACION}`);
  assert.ok(env.tgLlamadas.some((l) => l.metodo === 'setWebhook' && l.payload.url.startsWith('https://script.google.com/macros/s/AKfyc-prueba/exec?key=')));

  // El botón "Abrir en Telegram" manda /start <código> y vincula el chat.
  run('doPost', [{
    parameter: { key: props.datos.WEBHOOK_SECRET },
    postData: { contents: JSON.stringify({ update_id: 1, message: { chat: { id: 555 }, text: '/start ' + props.datos.CODIGO_VINCULACION } }) },
  }]);
  assert.equal(props.datos.CHAT_ID, '555');
  assert.match(env.enviados[0].text, /Soy <b>Asistente de Ana<\/b>/);
  assert.ok(env.enviados[0].reply_markup.inline_keyboard[0].some((b) => b.callback_data === 'cmd:configurar'));

  assert.deepEqual(env.props, {}, 'las Script Properties de la biblioteca (compartidas) no se tocan');
  assert.deepEqual(Object.keys(env.cache), [], 'la caché compartida tampoco');
});

test('sin contexto, la biblioteca se niega a usar sus servicios compartidos', () => {
  const { env } = copia();
  assert.throws(() => env.ctx.prop_('TELEGRAM_TOKEN'), /sin contexto/);
  assert.throws(() => env.ctx.ejecutar(null, 'setup'), /sin contexto/i);
  assert.throws(() => env.ctx.ejecutar({}, 'borrarTodo'), /Entrada desconocida/);
});

test('aviso de actualización: una sola vez por versión y con los pasos', () => {
  const { env, props, run } = copia();
  run('instalarConToken', [TOKEN]);
  props.datos.CHAT_ID = '555';
  run('scheduler');
  assert.equal(props.datos.VERSION_INSTALADA, env.ctx.version());

  // El autor anuncia la versión 4 (la copia corre la 3).
  env.props.ULTIMA_VERSION = JSON.stringify({ version: '9.9.9', numero: 4, notas: 'Mejoras de prueba' });
  env.enviados.length = 0;
  props.datos.ULT_VERSION = '0'; // fuerza la revisión diaria
  run('scheduler');
  const aviso = env.enviados.map((m) => m.text).join('\n');
  assert.match(aviso, /versión nueva: 9\.9\.9/);
  assert.match(aviso, /Versión <b>4<\/b>/);

  env.enviados.length = 0;
  props.datos.ULT_VERSION = '0';
  run('scheduler');
  assert.doesNotMatch(env.enviados.map((m) => m.text).join('\n'), /versión nueva/, 'no repite el aviso');
});
