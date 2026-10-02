// Reglas de clasificación de correos (sin IA), redacción de datos y lectura de la respuesta de Gemini.
// Los textos son ilustrativos; ajústalos con correos reales anonimizados.
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarGas, ymd } = require('./helpers');

const g = cargarGas('Parsing.js', 'BankParsers.js', 'Clasificador.js', 'IA.js');
const AHORA = new Date(2026, 9, 1, 10, 0);
const OPC = { ignorar: ['tienda.com'], importantes: ['cliente-importante.com'], avisarDirectos: true, iaActiva: true, tasaUSD: 4000 };

function clasificar(msg, opciones = OPC) {
  const r = g.clasificarPorReglas_(Object.assign({ perfil: 'personal', cuerpo: '' }, msg), opciones, AHORA);
  return { regla: r.regla, accion: r.accion, categoria: r.categoria, tarea: r.tarea, fecha: ymd(r.fecha_limite), monto: r.monto, resumen: r.resumen };
}

test('extracto de tarjeta: crea pendiente con monto y fecha límite', () => {
  const r = clasificar({
    de: 'RappiCard <notificaciones@rappicard.co>',
    asunto: 'Tu extracto de octubre ya está disponible',
    cuerpo: 'Pago total: $2.345.600\nPago mínimo: $210.400\nFecha límite de pago: 15/10/2026',
  });
  assert.equal(r.accion, 'pendiente');
  assert.equal(r.tarea, 'Pagar tarjeta Rappi $2.345.600 (mínimo $210.400)');
  assert.equal(r.fecha, '2026-10-15');
  assert.equal(r.monto, 2345600);
});

test('extracto con fecha en texto ("15 de octubre")', () => {
  const r = clasificar({
    de: 'Davivienda <extractos@davivienda.com>',
    asunto: 'Estado de cuenta Tarjeta de Crédito',
    cuerpo: 'Valor a pagar $320.000. Págala antes del 15 de octubre de 2026.',
  });
  assert.equal(r.regla, 'extracto');
  assert.equal(r.fecha, '2026-10-15');
  assert.equal(r.monto, 320000);
});

test('movimiento bancario se omite (lo registra escanearBancos_)', () => {
  const r = clasificar({ de: 'alertas@notificacionesbancolombia.com', asunto: 'Alertas', cuerpo: 'Bancolombia: Compraste $50.000,00 en EXITO con tu T.Deb *1234' });
  assert.equal(r.accion, 'omitir');
  assert.equal(r.regla, 'banco');
});

test('suscripciones y cobros van al resumen con monto (moneda local)', () => {
  const r = clasificar({ de: 'Netflix <info@account.netflix.com>', asunto: 'Tu recibo de Netflix', cuerpo: 'Total: COP 44.900' });
  assert.deepEqual([r.regla, r.accion, r.monto], ['suscripcion', 'resumen', 44900]);
  // En dólares se convierte a COP con la tasa de Config TASA_USD (aquí 4000).
  const usd = clasificar({ de: 'OpenAI <noreply@tm.openai.com>', asunto: 'Your ChatGPT receipt', cuerpo: 'Amount paid US$20.00' });
  assert.deepEqual([usd.regla, usd.monto], ['suscripcion', 80000]);
  assert.match(usd.resumen, /US\$20 ≈ \$80\.000/);
});

test('pago rechazado avisa al instante', () => {
  const r = clasificar({ de: 'Spotify <no-reply@spotify.com>', asunto: 'No pudimos procesar tu pago', cuerpo: '' });
  assert.deepEqual([r.regla, r.accion], ['pago_fallido', 'aviso']);
});

test('invitaciones y cancelaciones de reuniones', () => {
  const inv = clasificar({ de: 'Google Calendar <calendar-notification@google.com>', asunto: 'Invitación: Cita odontólogo @ jue 2 oct 2026 3pm', cuerpo: 'factura pendiente' });
  assert.deepEqual([inv.regla, inv.accion], ['invitacion', 'aviso'], 'una invitación de Google no se confunde con un cobro');
  assert.match(inv.resumen, /^Invitación: Cita odontólogo/);
  assert.equal(clasificar({ de: 'calendar@google.com', asunto: 'Evento cancelado: Almuerzo' }).accion, 'aviso');
  assert.equal(clasificar({ de: 'calendar@google.com', asunto: 'Aceptado: Weekly @ lun' }).accion, 'resumen');
});

test('Jira, ignorados y boletines', () => {
  assert.equal(clasificar({ de: 'Jira <jira@miempresa.atlassian.net>', asunto: '[JIRA] EMP-12 asignado' }).regla, 'jira');
  assert.equal(clasificar({ de: 'ofertas@tienda.com', asunto: 'Promo' }).regla, 'ignorado');
  assert.deepEqual(
    (({ regla, accion }) => [regla, accion])(clasificar({ de: 'news@medio.co', asunto: 'Boletín semanal', listaBaja: true })),
    ['boletin', 'resumen'],
  );
});

test('personal ambiguo va a la IA; si la IA está apagada, al resumen', () => {
  assert.equal(clasificar({ de: 'Juan <juan@gmail.com>', asunto: 'Lo del apartamento' }).accion, 'ia');
  assert.equal(clasificar({ de: 'Juan <juan@gmail.com>', asunto: 'Lo del apartamento' }, Object.assign({}, OPC, { iaActiva: false })).accion, 'resumen');
});

test('trabajo nunca va a la IA', () => {
  const t = (msg) => clasificar(Object.assign({ perfil: 'trabajo' }, msg));
  assert.deepEqual(
    (({ regla, accion, tarea }) => [regla, accion, tarea])(t({ de: 'Ana <ana@naviera.com>', asunto: 'URGENTE: corrección HBL antes del zarpe' })),
    ['urgente', 'pendiente', 'Revisar: URGENTE: corrección HBL antes del zarpe (Ana)'],
  );
  assert.equal(t({ de: 'Gerente <ger@cliente-importante.com>', asunto: 'Cotización FCL' }).accion, 'pendiente');
  assert.equal(t({ de: 'Pedro <pedro@miempresa.co>', asunto: 'Revisión sprint', directo: true, mismoDominio: true }).accion, 'aviso');
  assert.equal(t({ de: 'Pedro <pedro@miempresa.co>', asunto: 'Revisión sprint', directo: false, mismoDominio: true }).accion, 'resumen');
  assert.equal(t({ de: 'x@proveedor.com', asunto: 'Hola' }).accion, 'resumen');
});

test('redactar_ tapa datos sensibles pero conserva montos', () => {
  const r = g.redactar_('Escríbeme a juan.perez@gmail.com o al 300 123 4567. Cuenta 12345678. Total $2.345.600 https://x.co/a?b=1');
  assert.equal(r, 'Escríbeme a [correo] o al [teléfono]. Cuenta [número]. Total $2.345.600 [enlace]');
});

test('interpretarRespuestaIA_', () => {
  const ok = g.interpretarRespuestaIA_(JSON.stringify({
    categoria: 'finanzas', importante: true, prioridad: 'alta', resumen: 'Enel: recibo de $185.000 vence el 10/10',
    tarea: 'Pagar recibo de Enel $185.000', fecha_limite: '2026-10-10', monto: 185000,
  }));
  assert.deepEqual([ok.accion, ok.tarea, ymd(ok.fecha_limite), ok.monto], ['pendiente', 'Pagar recibo de Enel $185.000', '2026-10-10', 185000]);

  const aviso = g.interpretarRespuestaIA_('{"categoria":"seguridad","importante":true,"prioridad":"alta","resumen":"Nuevo inicio de sesión","tarea":null}');
  assert.deepEqual([aviso.accion, aviso.tarea], ['aviso', null]);

  const promo = g.interpretarRespuestaIA_('```json\n{"categoria":"promocion","importante":false,"prioridad":"baja","resumen":"x"}\n```');
  assert.equal(promo.accion, 'omitir');

  const raro = g.interpretarRespuestaIA_('{"categoria":"otra","importante":"si","prioridad":"urgente","resumen":"x","fecha_limite":"mañana"}');
  assert.deepEqual([raro.categoria, raro.accion, raro.prioridad, raro.fecha_limite], ['informativo', 'resumen', 'baja', null]);

  assert.throws(() => g.interpretarRespuestaIA_('no es json'), /no es JSON válido/);
});
