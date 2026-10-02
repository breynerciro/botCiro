const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarGas, ymd } = require('./helpers');

const g = cargarGas('Parsing.js');
const plano = (o) => JSON.parse(JSON.stringify(o));

test('parseNumeroCOP_ entiende formatos colombianos y anglosajones', () => {
  assert.equal(g.parseNumeroCOP_('50.000,00'), 50000);
  assert.equal(g.parseNumeroCOP_('50,000.00'), 50000);
  assert.equal(g.parseNumeroCOP_('1.234.567'), 1234567);
  assert.equal(g.parseNumeroCOP_('50.000'), 50000);
  assert.equal(g.parseNumeroCOP_('50000'), 50000);
  assert.equal(g.parseNumeroCOP_('1.5'), 1.5);
  assert.equal(g.parseNumeroCOP_('50.000.'), 50000);
});

test('parseMonto_ con multiplicadores', () => {
  assert.equal(g.parseMonto_('50 mil').monto, 50000);
  assert.equal(g.parseMonto_('80k').monto, 80000);
  assert.equal(g.parseMonto_('2 millones').monto, 2000000);
  assert.equal(g.parseMonto_('1.5 millones').monto, 1500000);
  assert.equal(g.parseMonto_('2 palos').monto, 2000000);
  assert.equal(g.parseMonto_('$2.300.000').monto, 2300000);
  assert.equal(g.parseMonto_('20 lucas en taxi').resto, 'en taxi');
  assert.equal(g.parseMonto_('sin números'), null);
});

test('formatCOP_', () => {
  assert.equal(g.formatCOP_(2300000), '$2.300.000');
  assert.equal(g.formatCOP_(-50000), '-$50.000');
  assert.equal(g.formatCOP_(0), '$0');
});

test('parseFechaLimite_', () => {
  const ahora = new Date(2026, 9, 1, 10, 0); // jueves 1 oct 2026
  let r = g.parseFechaLimite_('Enviar cotización a cliente X el viernes', ahora);
  assert.equal(ymd(r.fecha), '2026-10-02');
  assert.equal(r.texto, 'Enviar cotización a cliente X');

  r = g.parseFechaLimite_('Llamar al banco mañana', ahora);
  assert.equal(ymd(r.fecha), '2026-10-02');
  assert.equal(r.texto, 'Llamar al banco');

  r = g.parseFechaLimite_('Pagar arriendo pasado mañana', ahora);
  assert.equal(ymd(r.fecha), '2026-10-03');

  r = g.parseFechaLimite_('Revisar BL para el 15/10', ahora);
  assert.equal(ymd(r.fecha), '2026-10-15');
  assert.equal(r.texto, 'Revisar BL');

  r = g.parseFechaLimite_('Renovar SOAT 20/01', ahora);
  assert.equal(ymd(r.fecha), '2027-01-20');

  r = g.parseFechaLimite_('Reunión de cierre el miércoles', ahora);
  assert.equal(ymd(r.fecha), '2026-10-07');

  r = g.parseFechaLimite_('Comité el jueves', ahora); // mismo día de la semana → el siguiente
  assert.equal(ymd(r.fecha), '2026-10-08');

  r = g.parseFechaLimite_('Algo sin fecha', ahora);
  assert.equal(r.fecha, null);
  assert.equal(r.texto, 'Algo sin fecha');
});

test('parseComando_ y extraerPerfil_', () => {
  assert.deepEqual(plano(g.parseComando_('/agenda@CiroBot trabajo semana')), { cmd: 'agenda', args: 'trabajo semana' });
  assert.deepEqual(plano(g.parseComando_('/resumen')), { cmd: 'resumen', args: '' });
  assert.equal(g.parseComando_('hola'), null);
  assert.deepEqual(plano(g.extraerPerfil_('Trabajo semana')), { perfil: 'trabajo', resto: 'semana' });
  assert.deepEqual(plano(g.extraerPerfil_('semana')), { perfil: null, resto: 'semana' });
});

test('parseMovimiento_ con cuenta', () => {
  assert.deepEqual(plano(g.parseMovimiento_('50000 mercado #nu')), { monto: 50000, descripcion: 'mercado', cuenta: 'nu' });
  assert.deepEqual(plano(g.parseMovimiento_('2 millones nómina')), { monto: 2000000, descripcion: 'nómina', cuenta: null });
  assert.equal(g.parseMovimiento_('mercado'), null);
});

test('parseTextoLibre_', () => {
  assert.deepEqual(plano(g.parseTextoLibre_('gasté 50 mil en almuerzo')), {
    tipo: 'gasto', monto: 50000, descripcion: 'almuerzo', cuenta: null,
  });
  assert.deepEqual(plano(g.parseTextoLibre_('Pagué en Rappi 35.000 #nu')), {
    tipo: 'gasto', monto: 35000, descripcion: 'Rappi', cuenta: 'nu',
  });
  assert.deepEqual(plano(g.parseTextoLibre_('me pagaron 2 millones de nómina')), {
    tipo: 'ingreso', monto: 2000000, descripcion: 'nómina', cuenta: null,
  });
  assert.deepEqual(plano(g.parseTextoLibre_('tarea: llamar a Juan mañana')), { tipo: 'tarea', texto: 'llamar a Juan mañana' });
  assert.equal(g.parseTextoLibre_('hola, cómo vas'), null);
  assert.equal(g.parseTextoLibre_('gasté un montón'), null);
});

function saldos(texto, extras) {
  const r = g.parseTextoLibre_(texto, extras);
  if (!r || r.tipo !== 'saldos') return r;
  return plano({ items: r.items.map((i) => `${i.entidad.id}=${i.monto}${i.deuda ? ' deuda' : ''}`), sinAsignar: r.sinAsignar });
}

test('reporte de saldos: listas, deudas y errores de tipeo', () => {
  assert.deepEqual(
    saldos('Me quedan 80.000 en efectivo, tengo 0 pesos en nequi, nu y bbva, debo en la tarjeta de crédito de Falabella 950.000 y 0 en la tarjeta de credito Bancolombi'),
    {
      items: ['efectivo=80000', 'nequi=0', 'nu=0', 'bbva=0', 'falabella=950000 deuda', 'bancolombia=0 deuda'],
      sinAsignar: [],
    },
  );
});

test('reporte de saldos: variantes', () => {
  assert.deepEqual(saldos('tengo 200 mil en nequi y debo 1.5 millones en la TC Rappi').items, ['nequi=200000', 'rappi=1500000 deuda']);
  assert.deepEqual(saldos('Saldos: Bancolombia 2.300.000, Nu 500k, efectivo cero').items, ['bancolombia=2300000', 'nu=500000', 'efectivo=0']);
  assert.deepEqual(saldos('en el banco de bogotá tengo 1 millón').items, ['bogota=1000000']);
  assert.deepEqual(saldos('quedan 80 mil en mi cuenta de ahorros Coopcentral', ['Coopcentral']).items, ['coopcentral=80000']);
  assert.deepEqual(saldos('tengo 50 mil en nequi y 30 mil sueltos').sinAsignar, ['30 mil']);
});

test('reporte de saldos: no confunde otros mensajes', () => {
  assert.equal(saldos('almuerzo 20 mil nequi'), null, 'sin palabra clave de saldo no se toca nada');
  assert.equal(saldos('tengo reunión a las 3'), null);
  assert.equal(saldos('gasté 20 mil en nequi').items, undefined, 'un gasto sigue siendo gasto');
});
