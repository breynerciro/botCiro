/**
 * /configurar: lo que antes se hacía en el editor de Apps Script, ahora con botones en Telegram.
 *
 * Botones: callback "cfg:<acción>[:<arg>]" (procesarCallback_). Los menús se editan en el mismo mensaje.
 * Cuando el bot espera un texto (una API key, los últimos 4…), guarda ESPERA_<chat> = { campo, datos, expira }.
 * Cualquier comando o botón cancela la espera. Los secretos se borran del chat apenas se leen.
 */

const MINUTOS_ESPERA_ = 10;
const URL_GEMINI_KEY_ = 'https://aistudio.google.com/apikey';
const URL_JIRA_TOKEN_ = 'https://id.atlassian.com/manage-profile/security/api-tokens';

const PREFERENCIAS_ = [
  { clave: 'HORA_RESUMEN', tipo: 'hora', nombre: 'Hora del resumen diario' },
  { clave: 'MINUTOS_RECORDATORIO', tipo: 'numero', nombre: 'Aviso antes de cada reunión (min)' },
  { clave: 'AVISO_VENCIMIENTOS', tipo: 'sino', nombre: 'Avisar pendientes que vencen' },
  { clave: 'DURACION_REUNION', tipo: 'numero', nombre: 'Duración de reuniones que creo (min)' },
];

const boton_ = (text, accion) => ({ text: text, callback_data: 'cfg:' + accion });
const volver_ = (destino) => [boton_('⬅️ Volver', destino || 'menu')];
const marca_ = (ok) => (ok ? '✅' : '⚪');
const conTeclado_ = (lineas, filas) => ({ texto: lineas.filter((l) => l !== null).join('\n'), teclado: { inline_keyboard: filas } });

// ── Espera de texto ──────────────────────────────────────────────────────────

function espera_(chatId) {
  let e = null;
  try {
    e = JSON.parse(prop_('ESPERA_' + chatId) || 'null');
  } catch (err) {
    e = null;
  }
  if (e && Date.now() > e.expira) {
    borrarProp_('ESPERA_' + chatId);
    return null;
  }
  return e;
}

function esperar_(chatId, campo, datos) {
  setProp_('ESPERA_' + chatId, JSON.stringify({ campo: campo, datos: datos || {}, expira: Date.now() + MINUTOS_ESPERA_ * 60000 }));
}

function cancelarEspera_(chatId) {
  if (chatId) borrarProp_('ESPERA_' + chatId);
}

function esPrivado_(msg) {
  return !msg.chat.type || msg.chat.type === 'private';
}

// ── Menú principal ───────────────────────────────────────────────────────────

function cmdConfigurar_() {
  cancelarEspera_(CHAT_ACTUAL_);
  return menuConfigurar_();
}

function cmdCancelar_() {
  cancelarEspera_(CHAT_ACTUAL_);
  return 'Listo, cancelado. Vuelve cuando quieras con /configurar.';
}

function menuConfigurar_() {
  const cuentas = leer_('Cuentas').length;
  return conTeclado_(
    [
      `⚙️ <b>Configuración de ${esc_(nombreBot_())}</b>`,
      '',
      `${marca_(iaDisponible_())} <b>IA</b>: entiendo preguntas normales y analizo tus correos.`,
      `${marca_(cuentas > 0)} <b>Cuentas</b>: ${cuentas} registrada(s).`,
      `${marca_(trabajoActivo_())} <b>Trabajo</b> <i>(opcional)</i>: reuniones y correos de tu cuenta de trabajo.`,
      `${marca_(jiraConfigurado_())} <b>Jira</b> <i>(opcional)</i>: tus actividades como pendientes.`,
      `⏰ <b>Preferencias</b>: resumen diario a las ${esc_(getConfig_('HORA_RESUMEN', '6:30'))}.`,
    ],
    [
      [boton_('🤖 IA', 'ia'), boton_('🏦 Cuentas', 'cuentas')],
      [boton_('💼 Trabajo', 'trabajo'), boton_('🧩 Jira', 'jira')],
      [boton_('⏰ Preferencias', 'pref')],
    ]
  );
}

/** Botón "cfg:…". Devuelve { texto, teclado } para editar el mensaje del menú. */
function accionConfigurar_(datos, chatId) {
  const partes = String(datos).split(':');
  const accion = partes[0];
  const arg = partes.slice(1).join(':');
  const previa = espera_(chatId);
  cancelarEspera_(chatId);
  const acciones = {
    menu: () => menuConfigurar_(),
    ia: () => seccionIA_(),
    ia_key: () => pedirTexto_(chatId, 'gemini_key', {}, '🔑 Envíame la API key en tu próximo mensaje. La borro del chat apenas la lea.', 'ia'),
    ia_onoff: () => {
      setConfig_('IA_ACTIVA', normalizar_(getConfig_('IA_ACTIVA', 'si')) === 'si' ? 'no' : 'si');
      return seccionIA_();
    },
    ia_quitar: () => {
      borrarProp_('GEMINI_API_KEY');
      return seccionIA_();
    },
    cuentas: () => seccionCuentas_(),
    cta_nueva: () => elegirBanco_(),
    cta_otro: () => pedirTexto_(chatId, 'cuenta_banco', {}, '✏️ Escribe el nombre del banco o billetera.', 'cuentas'),
    cta_b: () => bancoElegido_(chatId, arg),
    cta_t: () => tipoElegido_(chatId, previa, arg),
    cta_sin4: () => pedirSaldo_(chatId, (previa && previa.datos) || {}),
    cta_def: () => elegirDefecto_(),
    cta_d: () => fijarDefecto_(arg),
    trabajo: () => seccionTrabajo_(),
    tr_con: () => conectarTrabajo_(),
    tr_onoff: () => {
      setConfig_('PERFIL_TRABAJO', trabajoActivo_() ? 'no' : 'si');
      return seccionTrabajo_();
    },
    jira: () => seccionJira_(),
    jira_con: () => pedirTexto_(chatId, 'jira_sitio', {}, '🌐 ¿Cuál es tu sitio de Jira? Ej: <code>miempresa.atlassian.net</code>', 'jira'),
    jira_off: () => {
      ['JIRA_SITIO', 'JIRA_CORREO', 'JIRA_TOKEN'].forEach(borrarProp_);
      return seccionJira_();
    },
    pref: () => seccionPreferencias_(),
    pf: () => editarPreferencia_(chatId, arg),
    pf_perfil: () => {
      setConfig_('PERFIL_ACTIVO', perfilActivo_() === 'trabajo' ? 'personal' : 'trabajo');
      return seccionPreferencias_();
    },
  };
  const fn = acciones[accion];
  return fn ? fn() : menuConfigurar_();
}

function pedirTexto_(chatId, campo, datos, pregunta, volverA) {
  esperar_(chatId, campo, datos);
  return conTeclado_([pregunta, '', `<i>Tienes ${MINUTOS_ESPERA_} min. Escribe /cancelar para salir.</i>`], [volver_(volverA)]);
}

/** Texto que llega mientras el bot espera un dato. */
function recibirEspera_(e, msg) {
  const chatId = String(msg.chat.id);
  const texto = String(msg.text || '').trim();
  const d = e.datos || {};
  const secreto = e.campo === 'gemini_key' || e.campo === 'jira_token';
  if (secreto) {
    borrarMensaje_(chatId, msg.message_id);
    cancelarEspera_(chatId);
    if (!esPrivado_(msg)) return '⚠️ Por seguridad, las claves solo se configuran en un chat privado conmigo.';
  }
  if (e.campo === 'gemini_key') return guardarGemini_(texto);
  if (e.campo === 'jira_sitio') {
    const sitio = texto.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(sitio)) return pedirTexto_(chatId, 'jira_sitio', d, 'Ese sitio no se ve bien. Ej: <code>miempresa.atlassian.net</code>', 'jira');
    return pedirTexto_(chatId, 'jira_correo', { sitio: sitio }, '📧 ¿Con qué correo entras a Jira?', 'jira');
  }
  if (e.campo === 'jira_correo') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) return pedirTexto_(chatId, 'jira_correo', d, 'Ese correo no se ve bien. Escríbelo de nuevo.', 'jira');
    return pedirTexto_(
      chatId,
      'jira_token',
      { sitio: d.sitio, correo: texto },
      `🔑 Crea un token en <a href="${URL_JIRA_TOKEN_}">Atlassian → API tokens</a> y envíamelo. Lo borro del chat apenas lo lea.`,
      'jira'
    );
  }
  if (e.campo === 'jira_token') return guardarJira_(d.sitio, d.correo, texto);
  if (e.campo === 'cuenta_banco') return tipoDeCuenta_(chatId, { banco: texto.slice(0, 40) });
  if (e.campo === 'cuenta_ult4') {
    if (!/^\d{4}$/.test(texto)) return pedirUltimos4_(chatId, d, 'Deben ser exactamente 4 dígitos. Inténtalo de nuevo o toca Omitir.');
    return pedirSaldo_(chatId, Object.assign({}, d, { ultimos4: texto }));
  }
  if (e.campo === 'cuenta_saldo') {
    const cero = /^(0|cero|nada)$/i.test(texto);
    const m = cero ? { monto: 0 } : parseMonto_(texto);
    if (!m) return pedirSaldo_(chatId, d, 'No entendí el monto. Escríbelo así: <code>250000</code> o <code>250 mil</code>.');
    return guardarCuenta_(d, m.monto);
  }
  if (e.campo.indexOf('pref:') === 0) return guardarPreferencia_(chatId, e.campo.slice(5), texto);
  return 'Se me perdió lo que estábamos configurando. Empieza de nuevo con /configurar.';
}

// ── IA ───────────────────────────────────────────────────────────────────────

function seccionIA_() {
  const tieneKey = Boolean(prop_('GEMINI_API_KEY'));
  const activa = normalizar_(getConfig_('IA_ACTIVA', 'si')) === 'si';
  const estado = !tieneKey ? 'sin API key' : activa ? 'activa ✅' : 'apagada';
  const filas = [[boton_(tieneKey ? '🔑 Cambiar API key' : '🔑 Pegar API key', 'ia_key')]];
  if (tieneKey) filas.push([boton_(activa ? '⏸ Apagar IA' : '▶️ Encender IA', 'ia_onoff'), boton_('🗑 Quitar API key', 'ia_quitar')]);
  filas.push(volver_());
  return conTeclado_(
    [
      `🤖 <b>IA (Gemini, gratis)</b> · ${estado}`,
      '',
      'Con la IA entiendo mensajes como <i>"¿qué tengo mañana?"</i> y analizo los correos personales que mis reglas no reconocen.',
      'Antes de enviarlos tapo correos, teléfonos y números largos. Los correos de trabajo nunca pasan por la IA.',
      tieneKey ? null : '',
      tieneKey ? null : `1. Abre <a href="${URL_GEMINI_KEY_}">Google AI Studio</a> con tu Gmail.`,
      tieneKey ? null : '2. Toca <b>Create API key</b> y cópiala.',
      tieneKey ? null : '3. Toca <b>🔑 Pegar API key</b> y envíamela.',
    ],
    filas
  );
}

function validarGemini_(key) {
  const resp = UrlFetchApp.fetch(GEMINI_URL_ + '?pageSize=1', { headers: { 'x-goog-api-key': key }, muteHttpExceptions: true });
  return resp.getResponseCode() === 200;
}

function guardarGemini_(key) {
  if (!/^[\w-]{20,}$/.test(key) || !validarGemini_(key)) {
    return conTeclado_(['❌ Google no aceptó esa API key. Revisa que la copiaste completa.'], [[boton_('🔑 Intentar de nuevo', 'ia_key')], volver_('ia')]);
  }
  setProp_('GEMINI_API_KEY', key);
  setConfig_('IA_ACTIVA', 'si');
  return conTeclado_(['✅ IA activada. Ahora puedes escribirme normal: <i>"¿cuánto llevo gastado este mes?"</i>'], [volver_()]);
}

// ── Cuentas ──────────────────────────────────────────────────────────────────

function seccionCuentas_() {
  const cuentas = leer_('Cuentas');
  const movimientos = leer_('Movimientos');
  const lineas = ['🏦 <b>Tus cuentas</b>', ''];
  if (!cuentas.length) lineas.push('Aún no tienes cuentas. Agrega las que uses (bancos, billeteras, tarjetas o efectivo).');
  cuentas.forEach((c) => lineas.push(`• ${esc_(nombreCuenta_(c))} (${c.perfil}) · ${formatCOP_(saldoCuenta_(c, movimientos))}`));
  const defecto = getConfig_('DEFECTO_' + perfilActivo_(), '');
  if (cuentas.length > 1) {
    const c = defecto && buscarCuenta_(defecto, perfilActivo_(), cuentas);
    lineas.push('', `⭐ Por defecto: ${c ? esc_(nombreCuenta_(c)) : '<i>ninguna (te pregunto cada vez)</i>'}`);
  }
  lineas.push('', '<i>Los últimos 4 dígitos sirven para que las alertas del banco por correo caigan en la cuenta correcta.</i>');
  const filas = [[boton_('➕ Agregar cuenta', 'cta_nueva')]];
  if (cuentas.length > 1) filas[0].push(boton_('⭐ Por defecto', 'cta_def'));
  filas.push(volver_());
  return conTeclado_(lineas, filas);
}

function elegirBanco_() {
  const botones = ENTIDADES_.map((e) => boton_(e.nombre, 'cta_b:' + e.id)).concat([boton_('✏️ Otro', 'cta_otro')]);
  const filas = [];
  for (let i = 0; i < botones.length; i += 3) filas.push(botones.slice(i, i + 3));
  filas.push(volver_('cuentas'));
  return conTeclado_(['➕ <b>Nueva cuenta</b>: ¿de qué banco o billetera?'], filas);
}

function bancoElegido_(chatId, id) {
  const ent = ENTIDADES_.find((e) => e.id === id);
  if (!ent) return elegirBanco_();
  if (ent.id === 'efectivo') return pedirSaldo_(chatId, { banco: 'Efectivo', alias: 'efectivo' });
  return tipoDeCuenta_(chatId, { banco: ent.nombre });
}

function tipoDeCuenta_(chatId, d) {
  esperar_(chatId, 'cuenta_tipo', d);
  return conTeclado_(
    [`🏦 <b>${esc_(d.banco)}</b>: ¿qué tipo de cuenta es?`],
    [[boton_('💳 Ahorros / débito', 'cta_t:a'), boton_('🧾 Tarjeta de crédito', 'cta_t:tc')], volver_('cta_nueva')]
  );
}

function tipoElegido_(chatId, previa, tipo) {
  if (!previa || previa.campo !== 'cuenta_tipo') return elegirBanco_();
  const tc = tipo === 'tc';
  return pedirUltimos4_(chatId, Object.assign({}, previa.datos, { alias: tc ? 'TC' : 'ahorros', deuda: tc }));
}

function pedirUltimos4_(chatId, d, aviso) {
  esperar_(chatId, 'cuenta_ult4', d);
  return conTeclado_(
    [
      aviso || `🔢 Escribe los <b>últimos 4 dígitos</b> de tu ${d.deuda ? 'tarjeta' : 'cuenta'} ${esc_(d.banco)} (los que salen en las alertas del banco).`,
      '',
      '<i>Si el banco no te manda alertas por correo, toca Omitir.</i>',
    ],
    [[boton_('Omitir', 'cta_sin4')], volver_('cuentas')]
  );
}

function pedirSaldo_(chatId, d, aviso) {
  esperar_(chatId, 'cuenta_saldo', d);
  const pregunta = d.deuda ? `💰 ¿Cuánto debes hoy en la tarjeta ${esc_(d.banco)}?` : `💰 ¿Cuánto tienes hoy en ${esc_(d.banco)}?`;
  return conTeclado_([aviso || pregunta, '', '<i>Ej: <code>250 mil</code> o <code>0</code>. Si no sabes, pon 0 y luego lo ajustas.</i>'], [volver_('cuentas')]);
}

function guardarCuenta_(d, monto) {
  const cuenta = crearCuentaDatos_({
    perfil: perfilActivo_(),
    banco: d.banco,
    alias: d.alias,
    ultimos4: d.ultimos4 || '',
    saldo: d.deuda ? -Math.abs(monto) : monto,
  });
  const valor = d.deuda ? `debes ${formatCOP_(monto)}` : `saldo ${formatCOP_(monto)}`;
  return conTeclado_(
    [`🏦 Listo: <b>${esc_(nombreCuenta_(cuenta))}</b> (${cuenta.perfil}), ${valor}.`, '', 'Ya puedes escribirme <i>"compra por ' + esc_(String(d.banco).toLowerCase()) + ' 40000"</i>.'],
    [[boton_('➕ Otra cuenta', 'cta_nueva'), boton_('🏦 Ver cuentas', 'cuentas')], volver_()]
  );
}

function elegirDefecto_() {
  const p = perfilActivo_();
  const propias = leer_('Cuentas').filter((c) => c.perfil === p);
  const filas = propias.map((c) => [boton_(nombreCuenta_(c), 'cta_d:' + c.id)]);
  filas.push(volver_('cuentas'));
  return conTeclado_([`⭐ ¿A qué cuenta van los gastos de <b>${p}</b> cuando no me dices cuál?`], filas);
}

function fijarDefecto_(id) {
  const cuenta = leer_('Cuentas').find((c) => String(c.id) === String(id));
  if (cuenta) setConfig_('DEFECTO_' + cuenta.perfil, 'id:' + cuenta.id);
  return seccionCuentas_();
}

// ── Trabajo (satélite) ───────────────────────────────────────────────────────

function seccionTrabajo_() {
  const activo = trabajoActivo_();
  const cuenta = prop_('SYNC_CUENTA_trabajo');
  return conTeclado_(
    [
      `💼 <b>Perfil de trabajo</b> · ${activo ? 'activo ✅' : 'inactivo'}`,
      cuenta ? `Cuenta conectada: <b>${esc_(cuenta)}</b>` : null,
      '',
      'Separo tus reuniones, pendientes y gastos de trabajo de los personales.',
      'Si tu trabajo usa Google, instalo un <b>satélite</b> en esa cuenta: me envía tus reuniones y solo el remitente y asunto de los correos, nunca el contenido.',
    ],
    [
      [boton_('🔗 Conectar cuenta de trabajo', 'tr_con')],
      [boton_(activo ? '⏸ Desactivar perfil' : '▶️ Activar perfil', 'tr_onoff')],
      volver_(),
    ]
  );
}

function conectarTrabajo_() {
  const url = urlWebApp_();
  if (!url) return conTeclado_(['⚠️ Primero termina la instalación en la hoja (menú 🤖 Asistente → Instalar).'], [volver_('trabajo')]);
  const codigo = url + '?sync=' + prop_('SYNC_SECRET');
  const plantilla = URL_PLANTILLA_SATELITE
    ? `1. Con tu cuenta <b>de trabajo</b>, abre <a href="${URL_PLANTILLA_SATELITE}">la plantilla del satélite</a> y toca <b>Hacer una copia</b>.`
    : '1. Con tu cuenta <b>de trabajo</b>, abre la plantilla del satélite que te compartieron y toca <b>Hacer una copia</b>.';
  return conTeclado_(
    [
      '🔗 <b>Conectar tu cuenta de trabajo</b>',
      '',
      plantilla,
      '2. En la copia: menú <b>🔗 Satélite → Conectar</b> y pega este código:',
      `<code>${esc_(codigo)}</code>`,
      '3. Autoriza los permisos. Te aviso aquí cuando quede conectada.',
      '',
      '🔒 <i>Este código es privado: no lo compartas.</i>',
    ],
    [volver_('trabajo')]
  );
}

// ── Jira ─────────────────────────────────────────────────────────────────────

function seccionJira_() {
  const ok = jiraConfigurado_();
  const filas = [[boton_(ok ? '🔑 Cambiar credenciales' : '🔑 Conectar Jira', 'jira_con')]];
  if (ok) filas[0].push(boton_('🗑 Desconectar', 'jira_off'));
  filas.push(volver_());
  return conTeclado_(
    [
      `🧩 <b>Jira</b> · ${ok ? `conectado a ${esc_(sitioJira_())} ✅` : 'no conectado'}`,
      '',
      'Tus actividades asignadas se vuelven pendientes de trabajo y se cierran solas cuando las resuelves.',
      'Te voy a pedir tu sitio, tu correo y un token de Atlassian (vence: te aviso cuando deje de funcionar).',
    ],
    filas
  );
}

function guardarJira_(sitio, correo, token) {
  const resp = UrlFetchApp.fetch(`https://${sitio}/rest/api/3/myself`, {
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(correo + ':' + token), Accept: 'application/json' },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    return conTeclado_([`❌ Jira no aceptó esos datos (${resp.getResponseCode()}). Revisa el sitio, el correo y el token.`], [[boton_('🔑 Intentar de nuevo', 'jira_con')], volver_('jira')]);
  }
  let nombre = correo;
  try {
    nombre = JSON.parse(resp.getContentText()).displayName || correo;
  } catch (e) {
    nombre = correo;
  }
  setProp_('JIRA_SITIO', sitio);
  setProp_('JIRA_CORREO', correo);
  setProp_('JIRA_TOKEN', token);
  return conTeclado_([`✅ Jira conectado como <b>${esc_(nombre)}</b>. En unos minutos te llegan tus actividades. También puedes usar /jira.`], [volver_()]);
}

// ── Preferencias ─────────────────────────────────────────────────────────────

function seccionPreferencias_() {
  const lineas = ['⏰ <b>Preferencias</b>', ''];
  const filas = [];
  PREFERENCIAS_.forEach((p) => {
    const valor = getConfig_(p.clave, '');
    lineas.push(`• ${p.nombre}: <b>${esc_(valor || '—')}</b>`);
    filas.push([boton_(p.tipo === 'sino' ? `${normalizar_(valor) === 'si' ? '⏸ No avisar' : '▶️ Avisar'}: ${p.nombre}` : `✏️ ${p.nombre}`, 'pf:' + p.clave)]);
  });
  if (trabajoActivo_()) {
    lineas.push(`• Perfil por defecto: <b>${perfilActivo_()}</b>`);
    filas.push([boton_(`🔁 Perfil por defecto → ${perfilActivo_() === 'trabajo' ? 'personal' : 'trabajo'}`, 'pf_perfil')]);
  }
  filas.push(volver_());
  return conTeclado_(lineas, filas);
}

function editarPreferencia_(chatId, clave) {
  const p = PREFERENCIAS_.find((x) => x.clave === clave);
  if (!p) return seccionPreferencias_();
  if (p.tipo === 'sino') {
    setConfig_(clave, normalizar_(getConfig_(clave, 'si')) === 'si' ? 'no' : 'si');
    return seccionPreferencias_();
  }
  const ejemplo = p.tipo === 'hora' ? 'Ej: <code>7:00</code> o <code>18:30</code>' : 'Escribe solo el número.';
  return pedirTexto_(chatId, 'pref:' + clave, {}, `✏️ <b>${p.nombre}</b> (ahora: ${esc_(getConfig_(clave, '—'))}). ${ejemplo}`, 'pref');
}

function guardarPreferencia_(chatId, clave, texto) {
  const p = PREFERENCIAS_.find((x) => x.clave === clave);
  if (!p) return seccionPreferencias_();
  let valor = null;
  if (p.tipo === 'hora') {
    const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(texto);
    if (m && Number(m[1]) < 24 && Number(m[2] || 0) < 60) valor = `${Number(m[1])}:${m[2] || '00'}`;
  } else if (/^\d{1,4}$/.test(texto)) {
    valor = String(Number(texto));
  }
  if (valor === null) return editarPreferencia_(chatId, clave);
  setConfig_(clave, valor);
  if (clave === 'HORA_RESUMEN') instalarTriggers(); // el trigger del resumen se reprograma solo
  const r = seccionPreferencias_();
  r.texto = `✅ Guardado.\n\n` + r.texto;
  return r;
}
