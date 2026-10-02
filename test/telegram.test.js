// P0: manejo de Telegram (límites, reintentos, varios chats) y avisos bancarios agrupados.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('./gasMocks');
const { cargarGas } = require('./helpers');

function preparar(opciones = {}) {
  const env = crearEntorno(opciones);
  env.ctx.setup();
  env.props.TELEGRAM_TOKEN = 'tok';
  let updateId = 1;
  env.decir = (texto, chatId = 777) => {
    env.enviados.length = 0;
    env.ctx.doPost({
      parameter: { key: env.props.WEBHOOK_SECRET },
      postData: { contents: JSON.stringify({ update_id: updateId++, message: { chat: { id: chatId }, text: texto } }) },
    });
    return env.enviados.map((m) => m.text).join('\n');
  };
  env.decir('/vincular ' + env.props.CODIGO_VINCULACION);
  return env;
}

test('partirMensaje_: límite de Telegram y líneas larguísimas', () => {
  const g = cargarGas('Telegram.js');
  const plano = (x) => JSON.parse(JSON.stringify(x)); // los objetos del vm no comparan con deepEqual
  assert.deepEqual(plano(g.partirMensaje_('hola\nadios')), ['hola\nadios']);

  const gigante = 'x'.repeat(9500);
  const partes = plano(g.partirMensaje_(gigante));
  assert.deepEqual(partes.map((p) => p.length), [4000, 4000, 1500], 'una sola línea se corta en trozos');
  assert.equal(partes.join(''), gigante, 'no se pierde ni un carácter');

  const original = Array(300).fill('línea muy ' + 'larga '.repeat(30)).join('\n');
  const mixto = plano(g.partirMensaje_(original));
  assert.ok(mixto.length > 1);
  assert.ok(mixto.every((p) => p.length <= 4000));
  assert.equal(mixto.join('\n'), original);
});

test('429 de Telegram se reintenta y el mensaje sale igual', () => {
  let intentos = 0;
  const env = preparar({
    telegram: (metodo, payload) => {
      if (metodo !== 'sendMessage' || payload.text !== 'probando') return null;
      intentos++;
      if (intentos < 3) return { codigo: 429, cuerpo: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0 } } };
      return null; // tercera vez sí: cae al camino normal y queda registrado
    },
  });
  env.enviados.length = 0;
  env.ctx.enviar_('probando');
  assert.equal(intentos, 3, 'reintenta hasta que Telegram acepta');
  assert.equal(env.enviados.length, 1);
  assert.equal(env.enviados[0].text, 'probando');
});

test('varios chats: /vincular agrega dispositivos, /desvincular quita y el aviso va a todos', () => {
  const env = preparar();
  assert.equal(env.props.CHAT_ID, '777');

  // Otro dispositivo se vincula con el mismo código.
  assert.match(env.decir('/vincular ' + env.props.CODIGO_VINCULACION, 888), /quedó vinculado/);
  assert.equal(env.props.CHAT_ID, '777,888');
  // Sin código, otro chat sigue ignorado.
  assert.equal(env.decir('/ayuda', 999), '');

  env.enviados.length = 0;
  env.ctx.enviar_('aviso para todos');
  assert.deepEqual(env.enviados.map((m) => m.chat_id), ['777', '888'], 'broadcast a los dos chats');

  assert.match(env.decir('/desvincular', 888), /desvinculado/);
  assert.equal(env.props.CHAT_ID, '777');

  env.enviados.length = 0;
  env.ctx.enviar_('solo uno');
  assert.deepEqual(env.enviados.map((m) => m.chat_id), ['777']);

  // Si se desvincula el último, vuelve a requerir /vincular.
  assert.match(env.decir('/desvincular', 777), /Vincula de nuevo/);
  assert.equal(env.props.CHAT_ID, undefined);
  assert.equal(env.decir('/ayuda', 777), '');
});

test('gasto sin cuenta pregunta en vez de adivinar; /defecto resuelve', () => {
  const env = preparar();
  env.decir('/nc p nequi nequi 4321 100k');
  env.decir('/nc p bancolombia ahorros 1234 200k');

  const pregunta = env.decir('/gasto 35000 almuerzo');
  assert.match(pregunta, /¿A qué cuenta va ese gasto/);
  assert.match(pregunta, /#nequi/);
  assert.match(pregunta, /#ahorros/);
  assert.equal(env.hojas.Movimientos._filas.length, 1, 'no registró nada a ciegas');

  assert.match(env.decir('/defecto nequi'), /van ahora a <b>Nequi \*4321<\/b>/);
  const ok = env.decir('/gasto 35000 almuerzo');
  assert.match(ok, /−\$35\.000 almuerzo[\s\S]*\$65\.000/);
});

test('movimientos bancarios: un solo aviso agrupado y el escaneo no se corta si falla el envío', () => {
  const env = preparar({
    correos: [
      { id: 'm1', de: 'alertas@notificacionesbancolombia.com', cuerpo: 'Bancolombia: Compraste $80.000,00 en EXITO con tu T.Deb *1234, el 01/10/2026' },
      { id: 'm2', de: 'alertas@notificacionesbancolombia.com', cuerpo: 'Recibiste una transferencia por $10.000 de JUAN en tu cuenta *1234' },
    ],
  });
  env.decir('/nuevacuenta bancolombia ahorros 1234 1000000');
  env.enviados.length = 0;
  env.ctx.escanearGmail();
  assert.equal(env.enviados.length, 1, 'un solo mensaje con los dos movimientos');
  assert.match(env.enviados[0].text, /Movimientos bancarios[\s\S]*\$80\.000 EXITO[\s\S]*\$10\.000/);
  assert.equal(env.hojas.Movimientos._filas.length, 3, 'los dos movimientos quedaron registrados');
});
