// Flujo completo con servicios de Google simulados: webhook → comando → hoja → respuesta.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('./gasMocks');

function preparar(opciones) {
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

test('vinculación y seguridad del webhook', () => {
  const env = preparar();
  assert.equal(env.props.CHAT_ID, '777');
  assert.equal(env.decir('/ayuda', 999), '', 'otro chat se ignora');
  env.enviados.length = 0;
  env.ctx.doPost({ parameter: { key: 'malo' }, postData: { contents: '{"update_id":99,"message":{"chat":{"id":777},"text":"/ayuda"}}' } });
  assert.equal(env.enviados.length, 0, 'secreto incorrecto se ignora');
  assert.match(env.decir('/ayuda'), /botCiro/);
});

test('cuentas, gastos, ingresos y ajuste de saldo', () => {
  const env = preparar();
  assert.match(env.decir('/gasto 50000 mercado'), /No tienes cuentas/);
  assert.match(env.decir('/nuevacuenta bancolombia ahorros 1234 2.300.000'), /Bancolombia ahorros \*1234.*\$2\.300\.000/);
  assert.match(env.decir('/nuevacuenta trabajo nu tarjeta 4321 500k'), /\(trabajo\)/);

  assert.match(env.decir('/gasto 50000 mercado'), /−\$50\.000 mercado[\s\S]*\$2\.250\.000/);
  assert.match(env.decir('gasté 20 mil en taxi #nu'), /Nu tarjeta \*4321 \(trabajo\)[\s\S]*\$480\.000/);
  assert.match(env.decir('me pagaron 1 millón de nómina'), /\+\$1\.000\.000[\s\S]*\$3\.250\.000/);

  const saldo = env.decir('/saldo personal');
  assert.match(saldo, /\$3\.250\.000/);
  assert.doesNotMatch(saldo, /TRABAJO/);

  assert.match(env.decir('/ajustar ahorros 3.000.000'), /\$3\.000\.000[\s\S]*diferencia vs\. estimado: -\$250\.000/);
  assert.match(env.decir('/movimientos 2'), /taxi/);
});

test('perfiles y pendientes', () => {
  const env = preparar();
  assert.match(env.decir('/tarea Llamar al banco mañana'), /#1 \(personal\) Llamar al banco · vence/);
  assert.match(env.decir('/perfil trabajo'), /Perfil activo: <b>trabajo<\/b>/);
  assert.match(env.decir('tarea: enviar cotización al forwarder'), /#2 \(trabajo\)/);
  assert.match(env.decir('/tarea personal pagar arriendo'), /#3 \(personal\)/);

  const trabajo = env.decir('/pendientes trabajo');
  assert.match(trabajo, /cotización/);
  assert.doesNotMatch(trabajo, /arriendo/);

  assert.match(env.decir('/hecho 1 3 9'), /✔️ #1[\s\S]*✔️ #3[\s\S]*#9 no existe/);
  assert.match(env.decir('/hecho 1'), /ya estaba cerrado/);
  assert.doesNotMatch(env.decir('/pendientes'), /arriendo/);
});

test('agenda y resumen', () => {
  const hoy = new Date();
  const enUnaHora = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 8, 0); // siempre dentro de "hoy"
  const env = preparar({
    eventos: [{ titulo: 'Comité comercial', inicio: enUnaHora, fin: new Date(enUnaHora.getTime() + 1800000), descripcion: 'Únete: https://meet.google.com/abc-defg-hij' }],
  });
  const agenda = env.decir('/agenda personal');
  assert.match(agenda, /Comité comercial · <a href="https:\/\/meet\.google\.com\/abc-defg-hij">/);
  assert.match(env.decir('/agenda trabajo'), /satélite de trabajo aún no ha sincronizado/);
  env.decir('/tarea revisar demurrage hoy');
  const resumen = env.decir('/resumen');
  assert.match(resumen, /PERSONAL[\s\S]*Comité comercial[\s\S]*demurrage[\s\S]*TRABAJO/);
});

test('escaneo de correos bancarios sin duplicar', () => {
  const env = preparar({
    correos: [
      { id: 'm1', de: 'alertas@notificacionesbancolombia.com', cuerpo: 'Bancolombia: Compraste $80.000,00 en EXITO con tu T.Deb *1234, el 01/10/2026' },
      { id: 'm2', de: 'alertas@notificacionesbancolombia.com', cuerpo: 'Conoce nuestros beneficios' },
      { id: 'm3', de: 'alertas@notificacionesbancolombia.com', cuerpo: 'Recibiste una transferencia por $10.000 de JUAN en tu cuenta *5555' },
    ],
  });
  env.decir('/nuevacuenta bancolombia ahorros 1234 1000000');

  env.enviados.length = 0;
  env.ctx.escanearGmail();
  const avisos = env.enviados.map((m) => m.text).join('\n');
  assert.match(avisos, /−\$80\.000 EXITO[\s\S]*\$920\.000/);
  assert.match(avisos, /\*5555[\s\S]*No tengo esa cuenta registrada/);
  assert.equal(env.hojas.Movimientos._filas.length, 3); // encabezado + 2

  env.enviados.length = 0;
  env.ctx.escanearGmail();
  assert.equal(env.enviados.length, 0, 'segunda pasada no duplica');
  assert.equal(env.hojas.Movimientos._filas.length, 3);
});

test('reporte de saldos en texto libre crea y luego actualiza cuentas', () => {
  const env = preparar();
  const r1 = env.decir('Me quedan 80.000 en efectivo, tengo 0 pesos en nequi, nu y bbva, debo en la tarjeta de crédito de Falabella 950.000 y 0 en la tarjeta de credito Bancolombi');
  assert.match(r1, /Efectivo: <b>\$80\.000<\/b> <i>\(nueva\)/);
  assert.match(r1, /Falabella TC: debes <b>\$950\.000/);
  assert.match(r1, /Bancolombia TC: sin deuda/);
  assert.match(r1, /Disponible: <b>\$80\.000<\/b> · Deuda: <b>\$950\.000/);
  assert.equal(env.hojas.Cuentas._filas.length, 7); // encabezado + 6

  // Un segundo reporte actualiza (no duplica) y distingue cuenta vs. tarjeta del mismo banco.
  const r2 = env.decir('tengo 300 mil en bancolombia y debo 700 mil en la tc falabella');
  assert.match(r2, /Bancolombia: <b>\$300\.000<\/b> <i>\(nueva\)/);
  assert.match(r2, /Falabella TC: debes <b>\$700\.000<\/b>\n/);
  assert.equal(env.hojas.Cuentas._filas.length, 8);

  // Una compra con la TC aumenta la deuda.
  assert.match(env.decir('/gasto 100000 mercado #tc'), /−\$100\.000/);
  const saldo = env.decir('/saldo');
  assert.match(saldo, /Falabella TC: debes <b>\$800\.000/);
  assert.match(saldo, /Bancolombia TC: sin deuda/);
  assert.match(saldo, /Disponible: \$380\.000 · Deuda: \$800\.000/);
});

test('abreviaturas de comandos, perfiles y rangos', () => {
  const hoy = new Date();
  const ocho = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1, 8, 0); // mañana: siempre dentro de "semana"
  const env = preparar({ eventos: [{ titulo: 'Comité', inicio: ocho, fin: new Date(ocho.getTime() + 3600000) }] });
  assert.match(env.decir('/?'), /\/resumen \(\/r\)/);
  assert.match(env.decir('/t t revisar BL mañana'), /#1 \(trabajo\) revisar BL · vence/);
  assert.match(env.decir('/t p pagar arriendo'), /#2 \(personal\) pagar arriendo/);
  assert.match(env.decir('/p t'), /revisar BL/);
  assert.doesNotMatch(env.decir('/p t'), /arriendo/);
  assert.match(env.decir('/h 2'), /✔️ #2/);
  assert.match(env.decir('/nc p nequi nequi 200 mil'), /Nequi.*\$200\.000/);
  assert.match(env.decir('/g 20k taxi'), /−\$20\.000 taxi/);
  assert.match(env.decir('/s'), /\$180\.000/);
  assert.match(env.decir('/a p s'), /Próximos 7 días[\s\S]*Comité/);
  assert.match(env.decir('/a p m'), /Mañana[\s\S]*Comité/);
  assert.match(env.decir('/pf t'), /Perfil activo: <b>trabajo<\/b>/);
  assert.match(env.decir('/r'), /Resumen/);
  assert.match(env.decir('/zz'), /No conozco ese comando/);
});
