/**
 * Enrutamiento de comandos y mensajes libres.
 */

const AYUDA_ = [
  '🤖 <b>botCiro</b>. Entre paréntesis, la abreviatura de cada comando.',
  'Perfil opcional: <code>personal</code> (p) o <code>trabajo</code> (t). Ej: <code>/a t s</code> = agenda de trabajo de la semana.',
  '',
  '<b>Resumen</b>',
  '/resumen (/r): saldos, reuniones de hoy y pendientes',
  '',
  '<b>Agenda</b>',
  '/agenda (/a) [perfil] [hoy|mañana|semana] o [h|m|s]',
  '',
  '<b>Pendientes</b>',
  '/tarea (/t) [perfil] texto [hoy|mañana|viernes|15/10]',
  '/pendientes (/p) [perfil]',
  '/hecho (/h) 3 5: cierra pendientes',
  '',
  '<b>Finanzas</b>',
  '/saldo (/s) [perfil]',
  '/gasto (/g) 50000 mercado #cuenta',
  '/ingreso (/i) 2 millones nómina #cuenta',
  '/ajustar (/aj) cuenta 2300000: fija el saldo real',
  '/movimientos (/m) [n]',
  '/nuevacuenta (/nc) [perfil] banco alias 1234 saldo',
  '',
  '<b>Correos y Jira</b>',
  '/correos (/c) [perfil]: lo analizado en las últimas 24 h',
  '/ignorar (/ig) remitente.com: no volver a analizar ese remitente',
  '/jira (/j): revisa tus actividades asignadas ahora',
  '/revisar (/rv): revisa Gmail ahora',
  '',
  '<b>Otros</b>',
  '/perfil (/pf) personal|trabajo: perfil por defecto (actual: {PERFIL})',
  '/ayuda (/?): esta ayuda',
  '',
  'También entiendo texto libre: <i>"gasté 50 mil en almuerzo"</i>, <i>"me pagaron 2 millones"</i>, <i>"tarea: llamar a Juan mañana"</i>,',
  'y reportes de saldo: <i>"tengo 80 mil en efectivo, 0 en nequi y debo 950 mil en la tarjeta de crédito Falabella"</i>.',
].join('\n');

const COMANDOS_ = {
  start: () => ayuda_(),
  ayuda: () => ayuda_(),
  help: () => ayuda_(),
  resumen: (a, p) => armarResumen_(p ? [p] : PERFILES),
  agenda: (a, p) => cmdAgenda_(a, p),
  pendientes: (a, p) => listarPendientes_(p ? [p] : PERFILES),
  tarea: (a, p) => crearTarea_(a, p || perfilActivo_()),
  hecho: (a) => completarTarea_(a),
  saldo: (a, p) => listarSaldos_(p ? [p] : PERFILES),
  saldos: (a, p) => listarSaldos_(p ? [p] : PERFILES),
  gasto: (a, p) => registrarManual_('debito', a, p),
  ingreso: (a, p) => registrarManual_('credito', a, p),
  ajustar: (a, p) => ajustarSaldo_(a, p),
  movimientos: (a, p) => listarMovimientos_(p ? [p] : PERFILES, a),
  nuevacuenta: (a, p) => crearCuenta_(a, p || perfilActivo_()),
  perfil: (a, p) => cambiarPerfil_(p || a),
  correos: (a, p) => cmdCorreos_(p),
  ignorar: (a) => cmdIgnorar_(a),
  jira: () => cmdJira_(),
  revisar: () => {
    const movs = escanearBancos_();
    const nuevos = escanearCorreosPersonales_();
    const procesados = procesarColaCorreos_();
    return `🔄 Gmail revisado: ${movs} movimiento(s) bancario(s), ${nuevos} correo(s) nuevo(s), ${procesados} analizado(s).`;
  },
};

function ayuda_() {
  return AYUDA_.replace('{PERFIL}', perfilActivo_());
}

function cambiarPerfil_(args) {
  const p = normalizar_(args);
  if (PERFILES.indexOf(p) < 0) return `Perfil activo: <b>${perfilActivo_()}</b>. Cámbialo con <code>/perfil personal</code> o <code>/perfil trabajo</code>.`;
  setConfig_('PERFIL_ACTIVO', p);
  return `👤 Perfil activo: <b>${p}</b>`;
}

const ABREVIATURAS_ = {
  r: 'resumen', a: 'agenda', t: 'tarea', p: 'pendientes', h: 'hecho',
  s: 'saldo', g: 'gasto', i: 'ingreso', aj: 'ajustar', m: 'movimientos', nc: 'nuevacuenta',
  c: 'correos', ig: 'ignorar', j: 'jira', rv: 'revisar', pf: 'perfil',
};

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
  if (!r) return 'No te entendí 🤔. Escribe /ayuda para ver los comandos.';
  if (r.tipo === 'tarea') return crearTarea_(r.texto, perfilActivo_());
  if (r.tipo === 'saldos') return aplicarSaldosLibre_(r.items, r.sinAsignar, perfilActivo_());
  return registrarManualDatos_(r.tipo === 'gasto' ? 'debito' : 'credito', r, null);
}
