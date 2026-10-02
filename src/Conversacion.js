/**
 * Conversación en lenguaje natural con Gemini.
 *
 * Lo que escribes sin comando no se pierde: el modelo decide si
 *   1. llama a una función que YA existe (saldo, agenda, gasto, tarea, informe...), o
 *   2. responde directamente con lo que ve en el contexto (saldos del día, próximo evento...).
 *
 * Solo funciona con GEMINI_API_KEY (Config IA_ACTIVA = no la apaga). Sin IA, el bot
 * conserva su comportamiento de siempre: texto libre de finanzas/tareas + ayuda.
 */

const ESQUEMA_CONVERSACION_ = {
  type: 'OBJECT',
  properties: {
    tipo: { type: 'STRING', enum: ['funcion', 'respuesta'] },
    funcion: { type: 'STRING', nullable: true },
    respuesta: { type: 'STRING', nullable: true },
    argumentos: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        perfil: { type: 'STRING', nullable: true },
        rango: { type: 'STRING', nullable: true },
        texto: { type: 'STRING', nullable: true },
        titulo: { type: 'STRING', nullable: true },
        fecha: { type: 'STRING', nullable: true },
        hora: { type: 'STRING', nullable: true },
        duracion: { type: 'NUMBER', nullable: true },
        monto: { type: 'NUMBER', nullable: true },
        cuenta: { type: 'STRING', nullable: true },
        descripcion: { type: 'STRING', nullable: true },
        ids: { type: 'STRING', nullable: true },
        consulta: { type: 'STRING', nullable: true },
        mes: { type: 'STRING', nullable: true },
      },
    },
  },
  required: ['tipo'],
};

/** Herramientas: cada una llama a una función real del bot. Nunca se ejecuta algo fuera de esta lista. */
const HERRAMIENTAS_IA_ = {
  saldo: {
    desc: 'Saldos estimados de todas las cuentas. argumentos: perfil ("personal" | "trabajo" | vacío = ambos)',
    ejecutar: (x) => listarSaldos_(x.perfil ? [perfilONulo_(x.perfil)] : PERFILES),
  },
  resumen: {
    desc: 'Resumen del día: saldos, reuniones de hoy y pendientes de ambos perfiles. Sin argumentos.',
    ejecutar: () => armarResumen_(PERFILES),
  },
  agenda: {
    desc: 'Reuniones del calendario. argumentos: perfil ("personal"|"trabajo"), rango ("hoy"|"manana"|"semana")',
    ejecutar: (x) => cmdAgenda_(x.rango || 'hoy', x.perfil || null),
  },
  pendientes: {
    desc: 'Lista de pendientes abiertos. argumentos: perfil (vacío = ambos)',
    ejecutar: (x) => listarPendientes_(x.perfil ? [perfilONulo_(x.perfil)] : PERFILES),
  },
  crear_tarea: {
    desc: 'Crea un pendiente nuevo. argumentos: texto (qué hay que hacer), perfil, fecha en texto libre ("viernes", "15/10", "mañana")',
    ejecutar: (x) => crearTarea_(x.texto || '', x.perfil || perfilActivo_()),
  },
  cerrar_tarea: {
    desc: 'Cierra pendientes por número. argumentos: ids ("3 5")',
    ejecutar: (x) => completarTarea_(x.ids || x.texto || ''),
  },
  gasto: {
    desc: 'Registra un gasto en pesos. argumentos: monto (número en pesos), descripcion (qué fue), cuenta (alias, opcional), perfil',
    ejecutar: (x) => {
      if (!x.monto || x.monto <= 0) return '❓ ¿Cuánto fue el gasto? Ej: <code>gasté 35 mil en almuerzo</code>.';
      return registrarManualDatos_('debito', { monto: Math.round(x.monto), descripcion: x.descripcion || x.texto || '', cuenta: x.cuenta || null }, x.perfil || null);
    },
  },
  ingreso: {
    desc: 'Registra un ingreso en pesos. argumentos: monto, descripcion, cuenta, perfil',
    ejecutar: (x) => {
      if (!x.monto || x.monto <= 0) return '❓ ¿Cuánto fue el ingreso? Ej: <code>me pagaron 2 millones</code>.';
      return registrarManualDatos_('credito', { monto: Math.round(x.monto), descripcion: x.descripcion || x.texto || '', cuenta: x.cuenta || null }, x.perfil || null);
    },
  },
  ajustar: {
    desc: 'Fija el saldo real de una cuenta (conciliación). argumentos: cuenta (alias), monto, perfil',
    ejecutar: (x) => {
      if (!x.cuenta || !x.monto) return '❓ Para ajustar necesito la cuenta y el monto: <code>/ajustar nu 500000</code>.';
      return ajustarSaldo_(`${x.cuenta} ${Math.round(x.monto)}`, x.perfil || null);
    },
  },
  correos: {
    desc: 'Correos analizados en las últimas 24 horas. argumentos: perfil (vacío = ambos)',
    ejecutar: (x) => cmdCorreos_(x.perfil || null),
  },
  buscar_correos: {
    desc: 'Busca entre los correos ya analizados (por remitente, asunto o resumen). argumentos: consulta',
    ejecutar: (x) => buscarCorreos_(x.consulta || x.texto || ''),
  },
  informe: {
    desc: 'Informe de gastos de un mes por categoría, comparado con el mes anterior. argumentos: perfil, mes ("octubre" | "2026-10")',
    ejecutar: (x) => cmdInforme_(`${x.mes || ''} ${x.texto || ''}`.trim(), x.perfil || perfilActivo_()),
  },
  metricas: {
    desc: 'Qué tan acertado ha sido el análisis de correos (feedback 👍👎). Sin argumentos.',
    ejecutar: () => cmdMetricas_(),
  },
  reunion: {
    desc: 'Crea un evento en el calendario personal. argumentos: titulo, fecha ("2026-10-05" u hoy/mañana/viernes), hora ("15:00"), duracion (minutos), perfil',
    ejecutar: (x) =>
      crearEventoDatos_(x.titulo || x.texto || '', x.fecha || null, x.hora || null, x.duracion || null, x.perfil || perfilActivo_()),
  },
  jira: { desc: 'Revisa tus actividades asignadas en Jira. Sin argumentos.', ejecutar: () => cmdJira_() },
  ayuda: { desc: 'Lista de comandos disponibles. Sin argumentos.', ejecutar: () => ayuda_() },
};

function perfilONulo_(p) {
  const n = normalizar_(p);
  if (PERFILES.indexOf(n) >= 0) return n;
  return null;
}

/** Lo que el modelo necesita saber para responder sin inventar. */
function contextoConversacion_() {
  const cuentas = leer_('Cuentas');
  const movimientos = leer_('Movimientos');
  const pendientes = leer_('Pendientes');
  const hoy = inicioDia_(new Date());
  const lineas = [];

  const cuentasTxt = PERFILES.map((p) => {
    const l = lineasSaldos_(p, cuentas, movimientos);
    return l.length ? `${p}: ${l.map((s) => s.replace(/<[^>]+>/g, '')).join('; ')}` : '';
  }).filter(Boolean);
  if (cuentasTxt.length) lineas.push('Saldos: ' + cuentasTxt.join(' | '));

  const abiertos = pendientes.filter((t) => t.estado === 'abierto');
  const vencidos = abiertos.filter((t) => t.fecha_limite && inicioDia_(new Date(t.fecha_limite)) < hoy).length;
  lineas.push(`Pendientes abiertos: ${abiertos.length}` + (vencidos ? ` (${vencidos} vencidos)` : ''));

  const agenda = PERFILES.map((p) => {
    const evs = eventosPerfil_(p, hoy, sumarDias_(hoy, 2)) || [];
    return evs.slice(0, 5).map((e) => `${p} ${fmtFecha_(e.inicio, 'dd/MM HH:mm')} ${e.titulo}`).join('; ');
  }).filter(Boolean);
  if (agenda.length) lineas.push('Agenda (hoy y mañana): ' + agenda.join(' | '));

  lineas.push('Perfil activo: ' + perfilActivo_() + '. Moneda: pesos colombianos (COP).');
  return lineas.join('\n');
}

/** Últimos turnos guardados para mantener el hilo (solo en memoria reciente). */
function memoriaConversacion_() {
  try {
    const d = JSON.parse(prop_('CONTEXTO_CHAT') || '[]');
    return Array.isArray(d) ? d.slice(-4) : [];
  } catch (e) {
    return [];
  }
}

function guardarMemoria_(pregunta, respuesta) {
  try {
    const turnos = memoriaConversacion_();
    turnos.push({
      u: String(pregunta).slice(0, 200),
      b: String(respuesta).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
    });
    setProp_('CONTEXTO_CHAT', JSON.stringify(turnos.slice(-4)));
  } catch (e) {
    // La memoria es best-effort: nunca rompe la respuesta.
  }
}

const INSTRUCCION_CONVERSACION_ = [
  'Eres el asistente personal de un usuario en Bogotá, Colombia, dentro de Telegram. Respondes en español, corto y directo.',
  'Toda la plata está en pesos colombianos (COP). Nunca inventes montos, fechas ni saldos: usa el contexto o llama a una función.',
  '',
  'Responde con el JSON pedido. Elige:',
  '- tipo="funcion" cuando la petición requiera hacer algo o pedir datos detallados (crear, cerrar, registrar, buscar, informes).',
  '- tipo="respuesta" cuando puedas contestar con el contexto dado o sea una conversación (saludos, explicaciones, dudas sobre cómo usar el bot).',
  '- Si te piden algo que no está en las funciones, responde tipo="respuesta" explicando qué sí puedes hacer.',
  '- Si te piden redactar un correo o un mensaje para enviarlo, escríbelo tú en el campo respuesta (nunca se envía solo; tú lo copias y pegas).',
  '- Si falta un dato obligatorio (por ejemplo el monto de un gasto), responde tipo="respuesta" preguntándolo.',
  '- En argumentos pasa solo lo que el usuario dijo, sin rellenar: fechas y horas en texto ("viernes", "15:00").',
].join('\n');

function textoDeHerramientas_() {
  return Object.keys(HERRAMIENTAS_IA_)
    .map((k) => `- ${k}: ${HERRAMIENTAS_IA_[k].desc}`)
    .join('\n');
}

function llamadaConversacion_(texto) {
  const modelo = getConfig_('GEMINI_MODELO', 'gemini-3.5-flash-lite');
  const memoria = memoriaConversacion_();
  const historial = memoria.length
    ? '\n\nConversación reciente:\n' + memoria.map((t) => `Tú: ${t.u}\nAsistente: ${t.b}`).join('\n')
    : '';
  const resp = UrlFetchApp.fetch(GEMINI_URL_ + encodeURIComponent(modelo) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': prop_('GEMINI_API_KEY') },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              INSTRUCCION_CONVERSACION_ +
              '\n\nFunciones disponibles:\n' +
              textoDeHerramientas_() +
              '\n\nContexto actual:\n' +
              contextoConversacion_() +
              historial,
          },
        ],
      },
      contents: [{ role: 'user', parts: [{ text: String(texto).slice(0, 2000) }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: ESQUEMA_CONVERSACION_ },
    }),
  });
  const codigo = resp.getResponseCode();
  if (codigo === 429) throw new ErrorCuotaIA_('Cuota de Gemini agotada');
  const data = JSON.parse(resp.getContentText() || '{}');
  if (codigo !== 200) throw new Error('Gemini ' + codigo + ': ' + ((data.error && data.error.message) || 'error'));
  const partes = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  if (!partes || !partes.length) throw new Error('Gemini no devolvió contenido');
  const crudo = partes.map((p) => p.text || '').join('');
  let d;
  try {
    d = JSON.parse(String(crudo).replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (e) {
    throw new Error('Respuesta de IA no es JSON válido');
  }
  return {
    tipo: d.tipo === 'funcion' ? 'funcion' : 'respuesta',
    funcion: d.funcion ? String(d.funcion) : null,
    respuesta: d.respuesta ? String(d.respuesta) : null,
    argumentos: d.argumentos && typeof d.argumentos === 'object' ? d.argumentos : {},
  };
}

/**
 * Punto de entrada del texto libre cuando ni comandos ni finanzas/tareas lo resolvieron.
 * Sin IA contesta con la ayuda (como antes), con IA lo entiende y ejecuta.
 */
function conversar_(texto) {
  const sinIA = 'No te entendí 🤔. Escribe /ayuda para ver los comandos, o prueba con una pregunta como ' +
    '<i>"¿qué tengo mañana?"</i> / <i>"gasté 40 mil en almuerzo"</i>.';
  if (!iaDisponible_()) return sinIA;
  let r;
  try {
    r = llamadaConversacion_(texto);
  } catch (err) {
    if (err && err.cuota) return '⏳ Se acabó por ahora la cuota de IA. Intenta en un minuto o usa los comandos (/ayuda).';
    registrarError_('conversar_', err);
    return '⚠️ No pude procesar tu mensaje con la IA. Usa los comandos (/ayuda) o inténtalo otra vez.';
  }
  try {
    if (r && r.tipo === 'funcion' && r.funcion && HERRAMIENTAS_IA_[r.funcion]) {
      const salida = String(HERRAMIENTAS_IA_[r.funcion].ejecutar(r.argumentos || {}));
      guardarMemoria_(texto, salida);
      return salida;
    }
    if (r && r.tipo === 'respuesta' && r.respuesta) {
      const salida = esc_(String(r.respuesta).slice(0, 1500));
      guardarMemoria_(texto, salida);
      return salida;
    }
    return sinIA;
  } catch (err) {
    registrarError_('conversar_.ejecutar', err);
    return '⚠️ ' + esc_(err.message);
  }
}
