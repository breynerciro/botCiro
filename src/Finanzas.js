/**
 * Cuentas, movimientos y saldos estimados.
 * Saldo = saldo_base + créditos − débitos registrados después de fecha_base.
 */

function ultimos4_(v) {
  const s = String(v == null ? '' : v).replace(/\D/g, '');
  return s ? s.padStart(4, '0') : '';
}

function nombreCuenta_(c) {
  const sufijo = c.ultimos4 ? ' *' + ultimos4_(c.ultimos4) : '';
  return c.alias && normalizar_(c.alias) !== normalizar_(c.banco) ? `${c.banco} ${c.alias}${sufijo}` : `${c.banco}${sufijo}`;
}

function buscarCuenta_(token, perfil, cuentas) {
  const t = normalizar_(token);
  const lista = (cuentas || leer_('Cuentas')).filter((c) => !perfil || c.perfil === perfil);
  return (
    lista.find((c) => normalizar_(c.alias) === t) ||
    lista.find((c) => ultimos4_(c.ultimos4) === t) ||
    lista.find((c) => normalizar_(c.banco) === t) ||
    lista.find((c) => normalizar_(c.alias).indexOf(t) >= 0 || normalizar_(c.banco).indexOf(t) >= 0) ||
    null
  );
}

function saldoCuenta_(cuenta, movimientos) {
  const base = Number(cuenta.saldo_base) || 0;
  const desde = cuenta.fecha_base ? new Date(cuenta.fecha_base).getTime() : 0;
  return movimientos
    .filter((m) => String(m.cuenta_id) === String(cuenta.id) && new Date(m.fecha).getTime() >= desde)
    .reduce((s, m) => s + (m.tipo === 'credito' ? 1 : -1) * (Number(m.monto) || 0), base);
}

/** Registra un movimiento y devuelve el saldo estimado resultante de la cuenta (o null si no hay cuenta). */
function registrarMovimiento_(mov) {
  const movimientos = leer_('Movimientos');
  const fila = {
    id: siguienteId_('Movimientos', movimientos),
    fecha: mov.fecha || new Date(),
    perfil: mov.cuenta ? mov.cuenta.perfil : mov.perfil || 'personal',
    cuenta_id: mov.cuenta ? mov.cuenta.id : '',
    tipo: mov.tipo,
    monto: mov.monto,
    descripcion: mov.descripcion || '',
    categoria: mov.categoria || categoriaDeGasto_(mov.descripcion),
    fuente: mov.fuente,
    gmail_msg_id: mov.gmail_msg_id || '',
  };
  agregar_('Movimientos', fila);
  movimientos.push(fila);
  return mov.cuenta ? saldoCuenta_(mov.cuenta, movimientos) : null;
}

function registrarManual_(tipo, args, perfil) {
  const datos = parseMovimiento_(args);
  if (!datos) {
    return tipo === 'debito'
      ? 'Uso: <code>/gasto 50000 mercado #cuenta</code> (también entiendo "50 mil", "80k", "2 millones")'
      : 'Uso: <code>/ingreso 2000000 nómina #cuenta</code>';
  }
  return registrarManualDatos_(tipo, datos, perfil);
}

function registrarManualDatos_(tipo, datos, perfil) {
  const cuentas = leer_('Cuentas');
  let cuenta = null;
  if (datos.cuenta) {
    cuenta = buscarCuenta_(datos.cuenta, perfil, cuentas);
    if (!cuenta && !datos.cuentaInferida) return `No encontré la cuenta "${esc_(datos.cuenta)}". Mira tus cuentas con /saldo.`;
    // "pagué 35 mil en Rappi" sin cuenta Rappi: Rappi era el comercio, no la cuenta.
    if (!cuenta) datos = Object.assign({}, datos, { cuenta: null, descripcion: datos.descripcionCompleta || datos.descripcion });
  }
  if (!cuenta) {
    const p = perfil || perfilActivo_();
    const propias = cuentas.filter((c) => c.perfil === p);
    if (!propias.length) return `No tienes cuentas en el perfil ${p}. Crea una con <code>/nuevacuenta banco alias 1234 saldo</code>.`;
    // Nunca se adivina: si hay más de una, se usa la cuenta por defecto o se pregunta con botones.
    const porDefecto = getConfig_('DEFECTO_' + p, '');
    cuenta = (porDefecto && buscarCuenta_(porDefecto, p, cuentas)) || (propias.length === 1 ? propias[0] : null);
    if (!cuenta) return preguntarCuenta_(tipo, datos, propias);
  }
  return registrarEnCuenta_(tipo, datos, cuenta);
}

function registrarEnCuenta_(tipo, datos, cuenta) {
  const saldo = registrarMovimiento_({
    cuenta: cuenta,
    tipo: tipo,
    monto: datos.monto,
    descripcion: datos.descripcion,
    fuente: 'manual',
  });
  const signo = tipo === 'credito' ? '+' : '−';
  return (
    `${tipo === 'credito' ? '💵' : '💸'} ${signo}${formatCOP_(datos.monto)} ${esc_(datos.descripcion)}\n` +
    `${esc_(nombreCuenta_(cuenta))} (${cuenta.perfil}) · saldo est. <b>${formatCOP_(saldo)}</b>`
  );
}

/**
 * Varias cuentas y ninguna por defecto: guarda el movimiento como borrador (10 min) y pregunta
 * con un botón por cuenta. El botón llega a procesarCallback_ como "mov:<borrador>:<cuentaId>".
 */
function preguntarCuenta_(tipo, datos, propias) {
  const borrador = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  CacheService.getScriptCache().put('mov_' + borrador, JSON.stringify({ tipo: tipo, monto: datos.monto, descripcion: datos.descripcion }), 600);
  const botones = propias.map((c) => ({ text: nombreCuenta_(c), callback_data: `mov:${borrador}:${c.id}` }));
  const filas = [];
  for (let i = 0; i < botones.length; i += 2) filas.push(botones.slice(i, i + 2));
  const ejemplo = esc_(propias[0].alias || propias[0].banco);
  return {
    texto:
      `❓ ¿De qué cuenta ${tipo === 'debito' ? 'salió' : 'es'} ${tipo === 'debito' ? '−' : '+'}${formatCOP_(datos.monto)} ${esc_(datos.descripcion)}?\n` +
      `<i>Para no tener que elegir: <code>/defecto ${ejemplo}</code></i>`,
    teclado: { inline_keyboard: filas },
  };
}

/** Botón de preguntarCuenta_: registra el borrador en la cuenta elegida. */
function confirmarCuentaBorrador_(borrador, cuentaId) {
  const cache = CacheService.getScriptCache();
  const crudo = cache.get('mov_' + borrador);
  if (!crudo) return '⌛ Ese registro ya venció. Envíalo de nuevo.';
  const cuenta = leer_('Cuentas').find((c) => String(c.id) === String(cuentaId));
  if (!cuenta) return 'No encontré esa cuenta.';
  cache.remove('mov_' + borrador);
  const d = JSON.parse(crudo);
  return registrarEnCuenta_(d.tipo, d, cuenta);
}

/** /nuevacuenta bancolombia ahorros 1234 2300000 */
function crearCuenta_(args, perfil) {
  const tokens = String(args).trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 1) return 'Uso: <code>/nuevacuenta [perfil] banco alias [últimos 4] [saldo actual]</code>';
  const banco = tokens.shift();
  const alias = tokens.length && !/^\d/.test(tokens[0]) ? tokens.shift() : banco;
  let ult = '';
  if (tokens.length && /^\d{4}$/.test(tokens[0])) ult = tokens.shift();
  const m = parseMonto_(tokens.join(' '));
  const cuentas = leer_('Cuentas');
  const cuenta = {
    id: siguienteId_('Cuentas', cuentas),
    perfil: perfil,
    banco: banco.charAt(0).toUpperCase() + banco.slice(1),
    alias: alias,
    ultimos4: ult,
    saldo_base: m ? m.monto : 0,
    fecha_base: new Date(),
  };
  agregar_('Cuentas', cuenta);
  return `🏦 Cuenta creada: <b>${esc_(nombreCuenta_(cuenta))}</b> (${perfil}) con saldo ${formatCOP_(cuenta.saldo_base)}`;
}

/** /ajustar nu 500000 → fija el saldo real desde ahora (conciliación). */
function ajustarSaldo_(args, perfil) {
  const tokens = String(args).trim().split(/\s+/);
  const token = tokens.shift();
  const m = parseMonto_(tokens.join(' '));
  if (!token || !m) return 'Uso: <code>/ajustar cuenta 2300000</code>';
  const cuenta = buscarCuenta_(token, perfil);
  if (!cuenta) return `No encontré la cuenta "${esc_(token)}".`;
  const anterior = saldoCuenta_(cuenta, leer_('Movimientos'));
  actualizar_('Cuentas', cuenta._fila, { saldo_base: m.monto, fecha_base: new Date() });
  const dif = m.monto - anterior;
  return (
    `✅ ${esc_(nombreCuenta_(cuenta))}: saldo fijado en <b>${formatCOP_(m.monto)}</b>` +
    (dif ? `\n(diferencia vs. estimado: ${formatCOP_(dif)})` : '')
  );
}

/** /defecto nu → los gastos sin #cuenta caen en esa cuenta del perfil. */
function cmdDefecto_(args, perfil) {
  const token = String(args || '').trim();
  if (!token) {
    const actual = getConfig_('DEFECTO_' + perfil, '');
    return `Cuenta por defecto de <b>${perfil}</b>: ${actual ? `<code>${esc_(actual)}</code>` : '<i>ninguna</i>'}.
Cámbiala con <code>/defecto ${perfil} cuenta</code>.`;
  }
  const cuenta = buscarCuenta_(token, perfil);
  if (!cuenta) return `No encontré la cuenta "${esc_(token)}" en ${perfil}. Mira tus cuentas con /saldo.`;
  setConfig_('DEFECTO_' + perfil, cuenta.alias || cuenta.banco);
  return `🏦 Los gastos sin <code>#cuenta</code> del perfil <b>${perfil}</b> van ahora a <b>${esc_(nombreCuenta_(cuenta))}</b>.`;
}

/** Tarjetas de crédito / deudas: su saldo es negativo (lo que debes). */
function esCuentaDeuda_(c) {
  return /(^|\s)(tc|tarjeta|credito)(\s|$)/.test(normalizar_(c.alias));
}

function cuentaDeEntidad_(entidad, deuda, cuentas, perfil) {
  const coincide = (c) => {
    const banco = normalizar_(c.banco);
    return (banco === entidad.id || banco === normalizar_(entidad.nombre) || entidad.claves.indexOf(banco) >= 0) && esCuentaDeuda_(c) === deuda;
  };
  return cuentas.find((c) => c.perfil === perfil && coincide(c)) || cuentas.find(coincide) || null;
}

/** Aplica un reporte de saldos en texto libre: fija el saldo de cada cuenta y crea las que no existan. */
function aplicarSaldosLibre_(items, sinAsignar, perfil) {
  const cuentas = leer_('Cuentas');
  const ahora = new Date();
  let siguiente = siguienteId_('Cuentas', cuentas);
  let disponible = 0;
  let deudaTotal = 0;

  const lineas = items.map((it) => {
    const saldo = it.deuda ? -it.monto : it.monto;
    let cuenta = cuentaDeEntidad_(it.entidad, it.deuda, cuentas, perfil);
    let nueva = false;
    if (cuenta) {
      actualizar_('Cuentas', cuenta._fila, { saldo_base: saldo, fecha_base: ahora });
    } else {
      cuenta = {
        id: siguiente++,
        perfil: perfil,
        banco: it.entidad.nombre,
        alias: it.deuda ? 'TC' : it.entidad.nombre,
        ultimos4: '',
        saldo_base: saldo,
        fecha_base: ahora,
      };
      agregar_('Cuentas', cuenta);
      cuentas.push(cuenta);
      nueva = true;
    }
    if (it.deuda) deudaTotal += it.monto;
    else disponible += it.monto;
    const valor = it.deuda ? (it.monto ? `debes <b>${formatCOP_(it.monto)}</b>` : 'sin deuda') : `<b>${formatCOP_(it.monto)}</b>`;
    return `• ${esc_(nombreCuenta_(cuenta))}: ${valor}${nueva ? ' <i>(nueva)</i>' : ''}`;
  });

  let texto = `💰 <b>Saldos actualizados</b> (${perfil})\n${lineas.join('\n')}\n\n` +
    `Disponible: <b>${formatCOP_(disponible)}</b> · Deuda: <b>${formatCOP_(deudaTotal)}</b>`;
  if (sinAsignar && sinAsignar.length) {
    texto += `\n\n⚠️ No supe a qué cuenta asignar: ${sinAsignar.map(esc_).join(', ')}. Usa <code>/ajustar cuenta monto</code>.`;
  }
  return texto;
}

/** Líneas de saldos por perfil, usadas por /saldo y el resumen. */
function lineasSaldos_(perfil, cuentas, movimientos) {
  const propias = cuentas.filter((c) => c.perfil === perfil);
  if (!propias.length) return [];
  let disponible = 0;
  let deuda = 0;
  const lineas = propias.map((c) => {
    const s = saldoCuenta_(c, movimientos);
    if (esCuentaDeuda_(c)) {
      deuda += -s;
      const valor = s < 0 ? `debes <b>${formatCOP_(-s)}</b>` : s > 0 ? `<b>${formatCOP_(s)}</b> a favor` : 'sin deuda';
      return `• ${esc_(nombreCuenta_(c))}: ${valor}`;
    }
    disponible += s;
    return `• ${esc_(nombreCuenta_(c))}: <b>${formatCOP_(s)}</b>`;
  });
  if (propias.length > 1) lineas.push(`<i>Disponible: ${formatCOP_(disponible)}` + (deuda ? ` · Deuda: ${formatCOP_(deuda)}` : '') + '</i>');
  return lineas;
}

function listarSaldos_(perfiles) {
  const cuentas = leer_('Cuentas');
  const movimientos = leer_('Movimientos');
  const bloques = perfiles
    .map((p) => {
      const l = lineasSaldos_(p, cuentas, movimientos);
      return l.length ? `<b>${p.toUpperCase()}</b>\n${l.join('\n')}` : '';
    })
    .filter(Boolean);
  if (!bloques.length) return 'No tienes cuentas registradas. Crea una con <code>/nuevacuenta banco alias 1234 saldo</code>.';
  return '💰 <b>Saldos estimados</b>\n\n' + bloques.join('\n\n');
}

function listarMovimientos_(perfiles, args) {
  const n = Math.min(Number(args) || 10, 50);
  const cuentas = leer_('Cuentas');
  const porId = {};
  cuentas.forEach((c) => (porId[c.id] = c));
  const movs = leer_('Movimientos')
    .filter((m) => perfiles.indexOf(m.perfil) >= 0)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha) || b.id - a.id)
    .slice(0, n);
  if (!movs.length) return 'No hay movimientos registrados.';
  const lineas = movs.map((m) => {
    const c = porId[m.cuenta_id];
    const signo = m.tipo === 'credito' ? '+' : '−';
    return `${fmtFecha_(m.fecha, 'dd/MM')} ${signo}${formatCOP_(m.monto)} ${esc_(m.descripcion)}` + (c ? ` <i>(${esc_(nombreCuenta_(c))})</i>` : '');
  });
  return `🧾 <b>Últimos ${movs.length} movimientos</b>\n` + lineas.join('\n');
}
