// Los textos de muestra son ilustrativos (formato típico de alertas en Colombia).
// Reemplázalos por correos reales anonimizados de tus bancos para validar los parsers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarGas } = require('./helpers');

const g = cargarGas('Parsing.js', 'BankParsers.js');
const BCO = 'Bancolombia <alertasynotificaciones@notificacionesbancolombia.com>';

function parse(remitente, texto) {
  const r = g.parseCorreoBanco_(remitente, texto);
  return r && { tipo: r.tipo, monto: r.monto, ultimos4: r.ultimos4, comercio: r.comercio, banco: r.banco };
}

test('compra con tarjeta débito', () => {
  assert.deepEqual(
    parse(BCO, 'Bancolombia: Compraste $50.000,00 en EXITO COLOMBIA con tu T.Deb *1234, el 01/10/2026 a las 15:30. Si tienes dudas...'),
    { tipo: 'debito', monto: 50000, ultimos4: '1234', comercio: 'EXITO COLOMBIA', banco: 'bancolombia' },
  );
});

test('compra en formato antiguo', () => {
  assert.deepEqual(
    parse(BCO, 'Bancolombia le informa Compra por $125.900 en RAPPI COLOMBIA 15:30. 01/10/2026 T.Cred *9876. Inquietudes al 018000931987.'),
    { tipo: 'debito', monto: 125900, ultimos4: '9876', comercio: 'RAPPI COLOMBIA', banco: 'bancolombia' },
  );
});

test('transferencia recibida', () => {
  assert.deepEqual(
    parse(BCO, 'Bancolombia: Recibiste una transferencia por $2.500.000 de ACME SAS en tu cuenta **1234, el 30/09/2026 a las 10:00.'),
    { tipo: 'credito', monto: 2500000, ultimos4: '1234', comercio: 'ACME SAS', banco: 'bancolombia' },
  );
});

test('transferencia enviada', () => {
  assert.deepEqual(
    parse(BCO, 'Bancolombia: Transferiste $100.000 desde tu cuenta *1234 a la cuenta *5678 el 01/10/2026 a las 10:00.'),
    { tipo: 'debito', monto: 100000, ultimos4: '1234', comercio: '', banco: 'bancolombia' },
  );
});

test('compra Nu con "terminada en"', () => {
  assert.deepEqual(
    parse('Nu <notificaciones@nu.com.co>', 'Hiciste una compra de $35.000 en UBER con tu tarjeta terminada en 4321.'),
    { tipo: 'debito', monto: 35000, ultimos4: '4321', comercio: 'UBER', banco: 'nu' },
  );
});

test('correo publicitario del banco no es movimiento', () => {
  assert.equal(parse(BCO, 'Conoce los nuevos beneficios de tu tarjeta. Aplican términos y condiciones.'), null);
});

test('remitente que no es banco se ignora', () => {
  assert.equal(parse('amigo@gmail.com', 'Compraste $50.000 en EXITO'), null);
});
