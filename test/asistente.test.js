// P1/P2: lo que convierte el bot en asistente: conversación, proactividad, botones,
// estado del sistema, retención, analítica y creación de eventos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('./gasMocks');

function respuestaGemini(obj) {
  return { codigo: 200, cuerpo: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } };
}

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
  env.pulsar = (data) => {
    env.tgLlamadas.length = 0;
    env.ctx.doPost({
      parameter: { key: env.props.WEBHOOK_SECRET },
      postData: { contents: JSON.stringify({ update_id: 900000 + updateId++, callback_query: { id: 'cb' + updateId, data, message: { message_id: 9, chat: { id: 777 } } } }) },
    });
    const r = env.tgLlamadas.find((l) => l.metodo === 'answerCallbackQuery');
    return r ? r.payload.text : '';
  };
  env.decir('/vincular ' + env.props.CODIGO_VINCULACION);
  return env;
}

// ── Conversación en lenguaje natural ────────────────────────────────────────

test('sin IA el texto libre sigue pidiendo ayuda (nada de respuestas inventadas)', () => {
  const env = preparar({ gemini: () => assert.fail('sin API key no debe llamar a Gemini') });
  assert.match(env.decir('hola, ¿cómo estás?'), /No te entendí/);
  assert.equal(env.llamadas.gemini.length, 0);
});

test('la conversación llama a las funciones existentes', () => {
  const env = preparar({
    gemini: (payload) => {
      const sistema = payload.systemInstruction.parts[0].text;
      assert.match(sistema, /Contexto actual/, 'el modelo ve el contexto real de la hoja');
      assert.match(sistema, /saldo:/, 'y la lista de herramientas');
      return respuestaGemini({ tipo: 'funcion', funcion: 'saldo', argumentos: { perfil: 'personal' } });
    },
  });
  Object.assign(env.props, { GEMINI_API_KEY: 'k' });
  env.decir('/nc p nequi nequi 4321 150000');

  const r = env.decir('¿cuánto me queda en la cuenta?');
  assert.match(r, /💰 <b>Saldos estimados<\/b>/);
  assert.match(r, /\$150\.000/);
  assert.equal(env.llamadas.gemini.length, 1, 'una sola llamada (sin ida y vuelta)');
});

test('la conversación responde directo cuando puede, y guarda el hilo', () => {
  const env = preparar({
    gemini: () => respuestaGemini({ tipo: 'respuesta', respuesta: 'Puedo ver saldos, agenda, pendientes y registrar gastos.' }),
  });
  Object.assign(env.props, { GEMINI_API_KEY: 'k' });

  const r = env.decir('hola, ¿qué sabes hacer?');
  assert.match(r, /Puedo ver saldos, agenda, pendientes/);
  const memoria = JSON.parse(env.props.CONTEXTO_CHAT);
  assert.equal(memoria.length, 1, 'queda el turno anterior');
  assert.match(memoria[0].u, /qué sabes hacer/);
});

test('si la IA falla o devuelve basura, se avisa y no se rompe nada', () => {
  const env = preparar({ gemini: () => ({ codigo: 200, cuerpo: { candidates: [{ content: { parts: [{ text: 'esto no es json' }] } }] } }) });
  Object.assign(env.props, { GEMINI_API_KEY: 'k' });
  assert.match(env.decir('cuéntame un chiste'), /No pude procesar tu mensaje con la IA/);

  const cuota = preparar({ gemini: () => ({ codigo: 429, cuerpo: { error: { message: 'quota' } } }) });
  Object.assign(cuota.props, { GEMINI_API_KEY: 'k' });
  assert.match(cuota.decir('cuéntame un chiste'), /cuota de IA/);
});

test('buscar correos analizados por palabra clave', () => {
  const env = preparar();
  env.ctx.agregar_('Correos', {
    id: 'c1', perfil: 'personal', fecha: new Date(), remitente: 'Netflix <info@netflix.com>',
    asunto: 'Tu recibo', resumen: 'Netflix: Tu recibo', estado: 'procesado', accion: 'resumen', monto: 44900, origen: 'regla:suscripcion',
  });
  assert.match(env.ctx.buscarCorreos_('netflix'), /1 coincidencia/);
  assert.match(env.ctx.buscarCorreos_('recibo'), /\$44\.900/);
  assert.match(env.ctx.buscarCorreos_('gmail'), /No encontré correos/);
});

// ── Proactividad: vencimientos y reuniones ──────────────────────────────────

test('recordatorio de vencimientos con botón de cierre (una sola vez)', () => {
  const env = preparar();
  env.decir('/tarea Pagar tarjeta hoy');

  env.enviados.length = 0;
  env.ctx.avisarVencimientos();
  assert.equal(env.enviados.length, 1, 'avisa que vence hoy');
  assert.match(env.enviados[0].text, /Pendientes que vencen hoy/);
  assert.equal(env.enviados[0].reply_markup.inline_keyboard[0][0].callback_data, 'hecho:1');

  env.enviados.length = 0;
  env.ctx.avisarVencimientos();
  assert.equal(env.enviados.length, 0, 'no vuelve a avisar la misma tarea');
});

test('el botón ✅ cierra el pendiente y responde al toque', () => {
  const env = preparar();
  env.decir('/tarea Enviar informe hoy');

  const respuesta = env.pulsar('hecho:1');
  assert.match(respuesta, /✔️ #1 Enviar informe/);
  assert.match(env.decir('/pendientes'), /No tienes pendientes abiertos/);

  assert.match(env.pulsar('hecho:1'), /ya estaba cerrado/);
  assert.match(env.pulsar('cmd:pendientes'), /Enviado/);
});

test('aviso de reunión con botón para unirse', () => {
  const inicio = new Date(Date.now() + 5 * 60000);
  const env = preparar({
    eventos: [{ titulo: 'Comité comercial', inicio, fin: new Date(inicio.getTime() + 1800000), descripcion: 'Únete: https://meet.google.com/abc-defg-hij' }],
  });
  env.enviados.length = 0;
  env.ctx.revisarReuniones();
  assert.equal(env.enviados.length, 1);
  assert.match(env.enviados[0].text, /En 5 min/);
  assert.equal(env.enviados[0].reply_markup.inline_keyboard[0][0].url, 'https://meet.google.com/abc-defg-hij');
});

// ── Estado del sistema, retención y analítica ───────────────────────────────

test('/estado diagnostica triggers, IA, cola y errores', () => {
  const env = preparar();
  const e = env.decir('/estado');
  assert.match(e, /🩺 <b>Estado del sistema<\/b>/);
  assert.match(e, /• Triggers:/);
  assert.match(e, /• Correos en cola: <b>0<\/b>/);
  assert.match(e, /• IA \(Gemini\):/);
  assert.match(e, /• Jira:/);
  assert.match(e, /Atención/, 'sin triggers instalados hay alerta');
});

test('la retención archiva correos y log viejos, pero nunca la cola ni el historial', () => {
  const env = preparar();
  const viejo = new Date(Date.now() - 90 * 86400000);
  env.ctx.agregar_('Correos', { id: 'v1', perfil: 'personal', fecha: viejo, remitente: 'a@b.com', asunto: 'viejo', estado: 'procesado', accion: 'resumen' });
  env.ctx.agregar_('Correos', { id: 'c1', perfil: 'personal', fecha: viejo, remitente: 'a@b.com', asunto: 'en cola', estado: 'cola' });
  env.ctx.agregar_('Log', { fecha: viejo, nivel: 'error', origen: 'x', mensaje: 'falló', detalle: '' });

  const borrados = env.ctx.purgarDatos_();
  assert.ok(borrados >= 2, 'borró el correo viejo y el log viejo');

  const correos = env.ctx.leer_('Correos');
  assert.equal(correos.length, 1, 'se conserva el que sigue en cola');
  assert.equal(correos[0].id, 'c1');
  const log = env.ctx.leer_('Log');
  assert.equal(log.filter((l) => l.nivel === 'error').length, 0);
  assert.equal(log.filter((l) => l.nivel === 'info').length, 1, 'queda el parte de la purga');
});

test('backup crea la copia y solo conserva las últimas N', () => {
  const env = preparar();
  assert.match(env.ctx.backupDatos_(), /docs\.google\.com/);
  assert.equal(JSON.parse(env.props.BACKUPS).length, 1);
});

test('/informe agrupa gastos por categoría y compara con el mes anterior', () => {
  const env = preparar();
  env.decir('/nc p nequi nequi 4321 500000');
  env.decir('/gasto 45000 mercado');
  env.decir('/gasto 20000 taxi');
  env.decir('/ingreso 2000000 nómina');

  const inf = env.decir('/informe');
  assert.match(inf, /💸 <b>Informe · /);
  assert.match(inf, /• Alimentos: <b>\$45\.000<\/b> \(69%\)/);
  assert.match(inf, /• Transporte: <b>\$20\.000<\/b> \(31%\)/);
  assert.match(inf, /Gastos: <b>\$65\.000<\/b>/);
  assert.match(inf, /Ingresos: <b>\$2\.000\.000<\/b>/);

  // El resumen solo trae saldos, reuniones y pendientes: nada de gastos ni correos.
  assert.doesNotMatch(env.decir('/resumen'), /Gastos \(30 d\)|Correos \(24 h\)/);
});

test('/metricas mide la precisión según tus 👍👎', () => {
  const env = preparar();
  env.ctx.agregar_('Correos', { id: 'c1', perfil: 'personal', fecha: new Date(), remitente: 'ofertas@tienda.com', asunto: 'Promo', resumen: 'Promo', estado: 'procesado', accion: 'aviso', origen: 'ia' });
  env.ctx.agregar_('Correos', { id: 'c2', perfil: 'personal', fecha: new Date(), remitente: 'extractos@rappi.co', asunto: 'Extracto', resumen: 'Extracto Rappi', estado: 'procesado', accion: 'pendiente', origen: 'regla:extracto' });

  assert.match(env.pulsar('fb:mal:c1'), /Anotado/);
  assert.match(env.pulsar('fb:ok:c2'), /Gracias/);

  const m = env.decir('/metricas');
  assert.match(m, /Analizados: <b>2<\/b>/);
  assert.match(m, /👍 1 · 👎 1 · precisión <b>50%<\/b>/);
  assert.match(m, /Los que más fallan:[\s\S]*tienda\.com/);
  assert.match(m, /\/ignorar tienda\.com/);
});

// ── Calendario y scheduler ──────────────────────────────────────────────────

test('/reunion crea el evento en el calendario con fecha y hora', () => {
  const env = preparar();
  const r = env.decir('/reunion Comité hoy 5pm');
  assert.match(r, /📅 Creado: <b>Comité<\/b>/);
  assert.equal(env.calendario.length, 1);
  assert.equal(env.calendario[0].titulo, 'Comité');
  assert.equal(env.calendario[0].inicio.getHours(), 17);
  assert.equal(env.calendario[0].fin.getHours(), 18, 'duración por defecto 60 min');
  assert.match(env.decir('/agenda personal'), /Comité/);

  // Sin hora no se inventa: pide que la completes.
  assert.match(env.decir('/reunion Reunión con Juan'), /¿A qué hora es/);
});

test('scheduler: corre lo que toca y no repite dentro de su ventana', () => {
  const env = preparar();
  env.ctx.scheduler();
  assert.ok(env.props.ULT_JIRA, 'marcó la revisión de Jira');
  assert.ok(env.props.ULT_SALUD, 'revisó la salud');

  const jira = env.props.ULT_JIRA;
  const salud = env.props.ULT_SALUD;
  env.ctx.scheduler();
  assert.equal(env.props.ULT_JIRA, jira, 'Jira solo cada 10 min');
  assert.equal(env.props.ULT_SALUD, salud, 'salud una vez al día');
});

test('instalarTriggers deja un solo scheduler y borra los triggers viejos', () => {
  const env = preparar();
  env.triggers.push('escanearGmail', 'escanearJira', 'revisarReuniones'); // instalación antigua

  env.ctx.instalarTriggers();
  assert.deepEqual(env.triggers.slice().sort(), ['enviarResumenDiario', 'scheduler']);
  assert.match(env.decir('/estado'), /• Triggers: enviarResumenDiario, scheduler|• Triggers: scheduler, enviarResumenDiario/);
});

// ── Pendientes con hora y peticiones compuestas ─────────────────────────────

function proximoLunes() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7 || 7));
  return d;
}
const ddmm = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

test('"cierra el 3 y crea el mismo para el lunes 10am" se reprograma en una acción', () => {
  const env = preparar({
    gemini: () =>
      respuestaGemini({ tipo: 'funcion', acciones: [{ funcion: 'reprogramar_tarea', argumentos: { ids: '1', fecha: 'lunes', hora: '10:00' } }] }),
  });
  env.props.GEMINI_API_KEY = 'k';
  env.decir('/tarea Llamar al contador');
  const r = env.decir('Marca como completado el pendiente 1 y crea el mismo para lunes a las 10am');
  assert.match(r, /✔️ #1 cerrado/);
  assert.match(r, new RegExp(`📝 #2 \\(personal\\) Llamar al contador · vence lun ${ddmm(proximoLunes())} 10:00`));
  const p = env.decir('/pendientes');
  assert.doesNotMatch(p, /#1 /);
  assert.match(p, new RegExp(`#2 Llamar al contador <i>\\(${ddmm(proximoLunes())} 10:00\\)</i>`));
});

test('la IA puede encadenar varias acciones y crear_tarea respeta fecha y hora', () => {
  const env = preparar({
    gemini: () =>
      respuestaGemini({
        tipo: 'funcion',
        acciones: [
          { funcion: 'cerrar_tarea', argumentos: { ids: '1' } },
          { funcion: 'crear_tarea', argumentos: { texto: 'Revisar extracto', fecha: 'lunes', hora: '15:30' } },
        ],
      }),
  });
  env.props.GEMINI_API_KEY = 'k';
  env.decir('/tarea Pagar arriendo');
  const r = env.decir('cierra el 1 y créame revisar extracto el lunes 3:30 pm');
  assert.match(r, /✔️ #1 Pagar arriendo/);
  assert.match(r, new RegExp(`#2 \\(personal\\) Revisar extracto · vence lun ${ddmm(proximoLunes())} 15:30`));
});

test('al contexto de la IA solo va el texto de pendientes personales', () => {
  let sistema = '';
  const env = preparar({
    gemini: (payload) => {
      sistema = payload.systemInstruction.parts[0].text;
      return respuestaGemini({ tipo: 'respuesta', respuesta: 'ok' });
    },
  });
  env.props.GEMINI_API_KEY = 'k';
  env.decir('/tarea personal Comprar regalo');
  env.decir('/tarea trabajo Cotización cliente secreto');
  env.decir('hola');
  assert.match(sistema, /#1 personal "Comprar regalo"/);
  assert.match(sistema, /#2 trabajo/);
  assert.doesNotMatch(sistema, /Cotización cliente secreto/);
});

test('/tarea entiende la hora solo cuando es inequívoca', () => {
  const env = preparar();
  assert.match(env.decir('/tarea Llamar al banco el lunes a las 10am'), new RegExp(`Llamar al banco · vence lun ${ddmm(proximoLunes())} 10:00`));
  assert.match(env.decir('/tarea Pagar 3 cuotas el lunes'), new RegExp(`Pagar 3 cuotas · vence lun ${ddmm(proximoLunes())}$`));
  assert.match(env.decir('/tarea Ahorrar 2.5 millones'), /Ahorrar 2\.5 millones$/);
});

test('el pendiente con hora se avisa a esa hora, no al inicio del día', () => {
  const env = preparar();
  const enUnaHora = new Date(Date.now() + 3600000);
  const hh = String(enUnaHora.getHours()).padStart(2, '0');
  // Si en una hora ya es mañana, el pendiente queda para mañana y tampoco debe avisarse.
  env.decir(`/tarea Llamada con proveedor a las ${hh}:${String(enUnaHora.getMinutes()).padStart(2, '0')}`);
  env.enviados.length = 0;
  env.ctx.avisarVencimientos();
  assert.equal(env.enviados.length, 0, 'todavía no es la hora');

  const t = env.hojas.Pendientes._filas[1];
  t[3] = new Date(Date.now() - 60000); // la hora ya pasó
  env.ctx.avisarVencimientos();
  assert.equal(env.enviados.length, 1);
});
