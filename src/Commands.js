/**
 * Enrutamiento de comandos, ayuda y mensajes libres.
 *
 * Un solo lugar define cada comando (COMANDOS_META_); de ahí salen:
 *   - el enrutador (responder_),
 *   - la ayuda de /ayuda,
 *   - el menú de Telegram (comandosMenu_, usado por registrarWebhook()).
 */

const COMANDOS_META_ = [
  { cmd: 'resumen', alias: 'r', grupo: 'Resumen', desc: 'saldos, reuniones de hoy y pendientes', uso: '/resumen [perfil]', fn: (a, p) => armarResumen_(p ? [p] : PERFILES) },
  { cmd: 'agenda', alias: 'a', grupo: 'Agenda', desc: 'reuniones: hoy | mañana | semana', uso: '/agenda [perfil] [hoy|semana]', fn: (a, p) => cmdAgenda_(a, p) },
  { cmd: 'reunion', alias: 'ru', grupo: 'Agenda', desc: 'crea un evento en tu calendario', uso: '/reunion [perfil] Comité el jueves 3pm', fn: (a, p) => crearEventoComando_(a, p || perfilActivo_()) },
  { cmd: 'tarea', alias: 't', grupo: 'Pendientes', desc: 'crear pendiente con fecha y hora opcionales', uso: '/tarea [perfil] texto [viernes|15/10] [10am]', fn: (a, p) => crearTarea_(a, p || perfilActivo_()) },
  { cmd: 'pendientes', alias: 'p', grupo: 'Pendientes', desc: 'pendientes abiertos', uso: '/pendientes [perfil]', fn: (a, p) => listarPendientes_(p ? [p] : PERFILES) },
  { cmd: 'hecho', alias: 'h', grupo: 'Pendientes', desc: 'cerrar pendientes', uso: '/hecho 3 5', fn: (a) => completarTarea_(a) },
  { cmd: 'saldo', alias: 's', grupo: 'Finanzas', desc: 'saldos estimados por cuenta', uso: '/saldo [perfil]', fn: (a, p) => listarSaldos_(p ? [p] : PERFILES) },
  { cmd: 'gasto', alias: 'g', grupo: 'Finanzas', desc: 'registrar gasto', uso: '/gasto 50000 mercado #cuenta', fn: (a, p) => registrarManual_('debito', a, p) },
  { cmd: 'ingreso', alias: 'i', grupo: 'Finanzas', desc: 'registrar ingreso', uso: '/ingreso 2000000 nómina', fn: (a, p) => registrarManual_('credito', a, p) },
  { cmd: 'ajustar', alias: 'aj', grupo: 'Finanzas', desc: 'fijar el saldo real de una cuenta', uso: '/ajustar cuenta 2300000', fn: (a, p) => ajustarSaldo_(a, p) },
  { cmd: 'movimientos', alias: 'm', grupo: 'Finanzas', desc: 'últimos movimientos', uso: '/movimientos [n]', fn: (a, p) => listarMovimientos_(p ? [p] : PERFILES, a) },
  { cmd: 'nuevacuenta', alias: 'nc', grupo: 'Finanzas', desc: 'crear una cuenta', uso: '/nuevacuenta banco alias 1234 saldo', fn: (a, p) => crearCuenta_(a, p || perfilActivo_()) },
  { cmd: 'defecto', alias: 'df', grupo: 'Finanzas', desc: 'cuenta por defecto para gastos sin #cuenta', uso: '/defecto [perfil] nu', fn: (a, p) => cmdDefecto_(a, p || perfilActivo_()) },
  { cmd: 'informe', alias: 'inf', grupo: 'Finanzas', desc: 'gastos del mes por categoría vs. mes anterior', uso: '/informe [perfil] [octubre]', fn: (a, p) => cmdInforme_(a, p || perfilActivo_()) },
  { cmd: 'perfil', alias: 'pf', grupo: 'Cuenta', desc: 'cambiar el perfil por defecto', uso: '/perfil personal|trabajo', fn: (a, p) => cambiarPerfil_(p || a) },
  { cmd: 'correos', alias: 'c', grupo: 'Correos', desc: 'correos analizados en las últimas 24 h', uso: '/correos [perfil]', fn: (a, p) => cmdCorreos_(p) },
  { cmd: 'metricas', alias: 'mt', grupo: 'Correos', desc: 'qué tan acertado está el análisis de correos', uso: '/metricas', fn: () => cmdMetricas_() },
  { cmd: 'ignorar', alias: 'ig', grupo: 'Correos', desc: 'no volver a analizar un remitente', uso: '/ignorar tienda.com', fn: (a) => cmdIgnorar_(a) },
  { cmd: 'jira', alias: 'j', grupo: 'Correos', desc: 'revisar tus actividades en Jira ahora', uso: '/jira', fn: () => cmdJira_() },
  { cmd: 'revisar', alias: 'rv', grupo: 'Correos', desc: 'revisar Gmail ahora', uso: '/revisar', fn: () => cmdRevisar_() },
  { cmd: 'estado', alias: 'e', grupo: 'Otros', desc: 'salud del sistema: triggers, errores y sincronizaciones', uso: '/estado', fn: () => estadoSistema_() },
  { cmd: 'desvincular', alias: 'dv', grupo: 'Otros', desc: 'quitar este chat de los autorizados', uso: '/desvincular', fn: () => cmdDesvincular_() },
  { cmd: 'vincular', alias: '', grupo: 'Otros', desc: 'vincular este chat con el código', uso: '/vincular 123456', fn: (a) => cmdVincular_(a) },
  { cmd: 'ayuda', alias: '?', grupo: 'Otros', desc: 'ver todos los comandos', uso: '/ayuda', fn: () => ayuda_() },
];

const COMANDOS_ = {};
const ABREVIATURAS_ = {};
COMANDOS_META_.forEach((c) => {
  COMANDOS_[c.cmd] = c.fn;
  if (c.alias) ABREVIATURAS_[c.alias] = c.cmd;
});

const INTRO_AYUDA_ = [
  '🤖 <b>botCiro</b>. Entre paréntesis, la abreviatura de cada comando.',
  'Perfil opcional: <code>personal</code> (p) o <code>trabajo</code> (t). Ej: <code>/a t s</code> = agenda de trabajo de la semana.',
  '',
].join('\n');

const FINAL_AYUDA_ = [
  '',
  'También entiendo texto libre: <i>"gasté 50 mil en almuerzo"</i>, <i>"me pagaron 2 millones"</i>, <i>"tarea: llamar a Juan mañana"</i>,',
  'y reportes de saldo: <i>"tengo 80 mil en efectivo, 0 en nequi y debo 950 mil en la tarjeta de crédito Falabella"</i>.',
  'Si tienes <code>GEMINI_API_KEY</code>, también respondo preguntas normales: <i>"¿cuánto llevó gastado este mes?"</i>, <i>"¿qué tengo mañana?"</i>.',
].join('\n');

/** Ayuda generada desde COMANDOS_META_ (siempre al día con los comandos reales). */
function ayuda_() {
  const grupos = [];
  const porGrupo = {};
  COMANDOS_META_.forEach((c) => {
    if (!porGrupo[c.grupo]) {
      porGrupo[c.grupo] = [];
      grupos.push(c.grupo);
    }
    porGrupo[c.grupo].push(c);
  });
  const bloques = grupos.map((g) => {
    const lineas = porGrupo[g]
      .filter((c) => c.cmd !== 'vincular')
      .map((c) => `/${c.cmd}${c.alias ? ` (/${c.alias})` : ''}: ${c.desc}`);
    return `<b>${g}</b>\n` + lineas.join('\n');
  });
  return INTRO_AYUDA_ + bloques.join('\n\n') + '\n' + FINAL_AYUDA_ + `\n\n👤 Perfil activo: <b>${perfilActivo_()}</b>`;
}

/** Menú de comandos de Telegram (setMyCommands). */
function comandosMenu_() {
  return COMANDOS_META_.filter((c) => c.alias && c.cmd !== 'vincular').map((c) => ({
    command: c.cmd,
    description: `(${c.alias}) ${c.desc.charAt(0).toUpperCase() + c.desc.slice(1)}`,
  }));
}

function cambiarPerfil_(args) {
  const p = normalizar_(args);
  if (PERFILES.indexOf(p) < 0) return `Perfil activo: <b>${perfilActivo_()}</b>. Cámbialo con <code>/perfil personal</code> o <code>/perfil trabajo</code>.`;
  setConfig_('PERFIL_ACTIVO', p);
  return `👤 Perfil activo: <b>${p}</b>`;
}

function cmdVincular_(args) {
  const codigo = prop_('CODIGO_VINCULACION');
  if (codigo && String(args).trim() === codigo) {
    if (chats_().indexOf(CHAT_ACTUAL_) >= 0) return '✅ Este chat ya estaba vinculado.';
    setProp_('CHAT_ID', chats_().concat([CHAT_ACTUAL_]).join(','));
    return '✅ Chat vinculado.';
  }
  return 'Para vincular un chat nuevo, envía <code>/vincular &lt;código&gt;</code> desde ese chat (el código lo ves al ejecutar setup()).';
}

function cmdDesvincular_() {
  const chats = chats_();
  const i = chats.indexOf(CHAT_ACTUAL_);
  if (i < 0) return 'Este chat no estaba vinculado.';
  chats.splice(i, 1);
  if (chats.length) {
    setProp_('CHAT_ID', chats.join(','));
    return '🔕 Este chat quedó desvinculado. Los demás siguen activos.';
  }
  borrarProp_('CHAT_ID');
  return '🔕 Chat desvinculado. Vincula de nuevo con <code>/vincular &lt;código&gt;</code>.';
}

function cmdRevisar_() {
  const movs = escanearBancos_();
  const nuevos = escanearCorreosPersonales_();
  const procesados = procesarColaCorreos_();
  return `🔄 Gmail revisado: ${movs} movimiento(s) bancario(s), ${nuevos} correo(s) nuevo(s), ${procesados} analizado(s).`;
}

function responder_(texto) {
  const c = parseComando_(String(texto).trim().replace(/^\/\?(?=\s|$)/, '/ayuda'));
  if (!c) return responderTextoLibre_(texto);
  const manejador = COMANDOS_[ABREVIATURAS_[c.cmd] || c.cmd];
  if (!manejador) return 'No conozco ese comando. Escribe /ayuda.';
  const e = extraerPerfil_(c.args);
  return manejador(e.resto, e.perfil);
}

function responderTextoLibre_(texto) {
  const r = parseTextoLibre_(texto, leer_('Cuentas').map((c) => c.banco));
  if (r) {
    if (r.tipo === 'tarea') return crearTarea_(r.texto, perfilActivo_());
    if (r.tipo === 'saldos') return aplicarSaldosLibre_(r.items, r.sinAsignar, perfilActivo_());
    return registrarManualDatos_(r.tipo === 'gasto' ? 'debito' : 'credito', r, null);
  }
  // Nada de lo anterior: si hay IA, se entiende en lenguaje natural; si no, la ayuda.
  return conversar_(texto);
}
