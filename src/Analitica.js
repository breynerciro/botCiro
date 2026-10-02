/**
 * Analítica del asistente: categorías de gasto, informe mensual,
 * búsqueda en los correos analizados y métricas de clasificación (feedback 👍👎).
 */

const CATEGORIAS_GASTO_ = {
  Alimentos: ['mercado', 'almuerzo', 'comida', 'restaurante', 'domicilio', 'cafeteria', 'panaderia', 'rappi', 'ifood', 'verduleria', 'carniceria', 'deli'],
  Transporte: ['taxi', 'uber', 'didi', 'indrive', 'gasolina', 'peaje', 'parking', 'parqueadero', 'transporte', 'metro', 'bus', 'vuelo', 'aerolinea'],
  Vivienda: ['arriendo', 'administracion', 'condominio', 'enel', 'codensa', 'gas natural', 'acueducto', 'internet', 'claro', 'movistar', 'wom', 'etb', 'mantenimiento'],
  Salud: ['salud', 'medico', 'dentista', 'odontolog', 'farmacia', 'eps', 'consulta', 'examen', 'medicina', 'optica', 'gimnasio'],
  Suscripciones: ['netflix', 'spotify', 'suscripcion', 'membresia', 'prime video', 'disney', 'hbo', 'openai', 'chatgpt', 'github', 'notion', 'canva', 'figma', 'platzi', 'coursera'],
  Ropa: ['ropa', 'zapato', 'falabella', 'ripley', 'alamano'],
  Otros: [],
};

const MESES_CORTOS_ = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Mapa palabra clave → categoría. CATEGORIAS_EXTRA permite sumar las tuyas ("taxi=Transporte"). */
function mapaCategorias_() {
  const mapa = {};
  Object.keys(CATEGORIAS_GASTO_).forEach((cat) => CATEGORIAS_GASTO_[cat].forEach((k) => (mapa[normalizar_(k)] = cat)));
  listaConfig_(getConfig_('CATEGORIAS_EXTRA', '')).forEach((par) => {
    const partes = par.split('=');
    if (partes[0] && partes[1]) mapa[normalizar_(partes[0].trim())] = partes[1].trim();
  });
  return mapa;
}

function categoriaDeGasto_(descripcion) {
  const d = normalizar_(descripcion);
  const mapa = mapaCategorias_();
  const clave = Object.keys(mapa).find((k) => k && d.indexOf(k) >= 0);
  return clave ? mapa[clave] : 'Otros';
}

function inicioMes_(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** "octubre", "oct", "2026-10" o vacío (= mes en curso) → primer día del mes. */
function parseMes_(texto, ahora) {
  ahora = ahora || new Date();
  const t = normalizar_(texto);
  const iso = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (iso) return new Date(+iso[1], +iso[2] - 1, 1);
  const m = MESES_CORTOS_.findIndex((m2) => t.indexOf(m2) === 0);
  if (m >= 0) {
    const anio = /(\d{4})/.exec(t);
    return new Date(anio ? +anio[1] : ahora.getFullYear(), m, 1);
  }
  return inicioMes_(ahora);
}

function movimientosEnRango_(perfiles, desde, hasta, soloDebitos) {
  return leer_('Movimientos').filter(
    (m) =>
      perfiles.indexOf(m.perfil) >= 0 &&
      (!soloDebitos || m.tipo === 'debito') &&
      new Date(m.fecha).getTime() >= desde &&
      new Date(m.fecha).getTime() < hasta
  );
}

function total_(movs) {
  return movs.reduce((s, m) => s + (Number(m.monto) || 0), 0);
}

/**
 * /informe [perfil] [mes] → gastos del mes por categoría, comercios top,
 * ingresos y comparación con el mes anterior.
 */
function cmdInforme_(args, perfil) {
  const partes = String(args || '').trim().split(/\s+/).filter(Boolean);
  let perfilArg = perfil;
  if (partes.length && (PERFILES.indexOf(normalizar_(partes[0])) >= 0 || ABREVIATURAS_PERFIL_[normalizar_(partes[0])])) {
    const p = ABREVIATURAS_PERFIL_[normalizar_(partes[0])] || normalizar_(partes[0]);
    perfilArg = p;
    partes.shift();
  }
  const mes = parseMes_(partes.join(' '));
  const siguiente = new Date(mes.getFullYear(), mes.getMonth() + 1, 1);
  const mesAnterior = new Date(mes.getFullYear(), mes.getMonth() - 1, 1);
  const perfiles = perfilArg ? [perfilArg] : PERFILES;

  const movs = leer_('Movimientos').filter((m) => perfiles.indexOf(m.perfil) >= 0);
  const enRango = (desde, hasta, soloDebitos) =>
    movs.filter(
      (m) =>
        (!soloDebitos || m.tipo === 'debito') &&
        new Date(m.fecha).getTime() >= desde &&
        new Date(m.fecha).getTime() < hasta
    );
  const gastos = enRango(mes, siguiente, true);
  const ingresos = enRango(mes, siguiente, false).filter((m) => m.tipo === 'credito');
  const anteriores = enRango(mesAnterior, mes, true);

  if (!gastos.length && !ingresos.length) {
    return `📭 No hay movimientos de <b>${esc_(perfilArg)}</b> en ${MESES_CORTOS_[mes.getMonth()]}${mes.getFullYear()}.`;
  }

  const porCategoria = {};
  gastos.forEach((m) => {
    const cat = m.categoria || categoriaDeGasto_(m.descripcion);
    porCategoria[cat] = (porCategoria[cat] || 0) + (Number(m.monto) || 0);
  });
  const cats = Object.keys(porCategoria).sort((a, b) => porCategoria[b] - porCategoria[a]);
  const lineasCat = cats.map((c) => `• ${esc_(c)}: <b>${formatCOP_(porCategoria[c])}</b> (${Math.round((porCategoria[c] / total_(gastos)) * 100)}%)`);

  const porDescripcion = {};
  gastos.forEach((m) => {
    const d = String(m.descripcion || 'sin detalle').toLowerCase();
    porDescripcion[d] = (porDescripcion[d] || 0) + (Number(m.monto) || 0);
  });
  const top = Object.keys(porDescripcion)
    .sort((a, b) => porDescripcion[b] - porDescripcion[a])
    .slice(0, 5)
    .map((d) => `  · ${esc_(d)}: ${formatCOP_(porDescripcion[d])}`);

  const totalGastos = total_(gastos);
  const totalIngresos = total_(ingresos);
  const totalAnt = total_(anteriores);
  const dif = totalAnt ? Math.round(((totalGastos - totalAnt) / totalAnt) * 100) : null;

  const bloques = [
    `💸 <b>Informe · ${MESES_CORTOS_[mes.getMonth()].toUpperCase()} ${mes.getFullYear()}</b> (${esc_(perfilArg)})`,
    `Gastos: <b>${formatCOP_(totalGastos)}</b> en ${gastos.length} movimientos` +
      (totalAnt ? `\nMes anterior: ${formatCOP_(totalAnt)} → <b>${dif >= 0 ? '+' : ''}${dif}%</b>` : ''),
    'Por categoría:\n' + (lineasCat.length ? lineasCat.join('\n') : '<i>sin gastos</i>'),
    'Lo que más repite:\n' + top.join('\n'),
    `Ingresos: <b>${formatCOP_(totalIngresos)}</b> · Neto: <b>${formatCOP_(totalIngresos - totalGastos)}</b>`,
  ];
  return bloques.join('\n\n');
}

/**
 * Línea de desviación de gastos para el resumen diario:
 * compara los últimos 30 días con los 30 anteriores.
 */
function lineaDesviacionGastos_() {
  const ahora = Date.now();
  const gastos = movimientosEnRango_(PERFILES, ahora - 30 * 86400000, ahora, true);
  if (gastos.length < 2) return '';
  const anteriores = movimientosEnRango_(PERFILES, ahora - 60 * 86400000, ahora - 30 * 86400000, true);
  const total = total_(gastos);
  const totalAnt = total_(anteriores);
  if (!totalAnt) return `💸 Gastos (30 d): <b>${formatCOP_(total)}</b>`;
  const dif = Math.round(((total - totalAnt) / totalAnt) * 100);
  const umbral = Number(getConfig_('DESVIACION_GASTOS', '25')) || 25;
  const aviso = dif > umbral ? ` ⚠️ <b>+${dif}%</b> respecto a los 30 días anteriores` : ` (${dif >= 0 ? '+' : ''}${dif}%)`;
  return `💸 Gastos (30 d): <b>${formatCOP_(total)}</b>${aviso}`;
}

/** /metricas: qué tan acertado ha sido el análisis de correos según tus 👍👎. */
function cmdMetricas_() {
  const desde = Date.now() - 30 * 86400000;
  const filas = leer_('Correos').filter(
    (c) => c.estado === 'procesado' && c.accion !== 'omitir' && new Date(c.fecha).getTime() >= desde
  );
  if (!filas.length) return '📊 Aún no hay correos analizados en los últimos 30 días.';

  const conFb = filas.filter((c) => c.feedback === 'ok' || c.feedback === 'mal');
  const ok = conFb.filter((c) => c.feedback === 'ok').length;
  const mal = conFb.filter((c) => c.feedback === 'mal').length;
  const porOrigen = (pref) => filas.filter((c) => String(c.origen || '').indexOf(pref) === 0).length;

  const lineas = [
    `📊 <b>Métricas de correos (30 días)</b>`,
    `Analizados: <b>${filas.length}</b> · Avisos: ${filas.filter((c) => c.accion === 'aviso').length} · Pendientes: ${filas.filter((c) => c.accion === 'pendiente').length}`,
    `Origen: reglas ${porOrigen('regla')} · IA ${porOrigen('ia')} · sin IA ${porOrigen('sin_ia')}`,
    `Feedback: 👍 ${ok} · 👎 ${mal}` + (conFb.length ? ` · precisión <b>${Math.round((ok / conFb.length) * 100)}%</b>` : ''),
  ];

  const fallos = {};
  filas
    .filter((c) => c.feedback === 'mal')
    .forEach((c) => {
      const dominio = (String(c.remitente).match(/@([\w.-]+)/) || [])[1] || String(c.remitente);
      fallos[dominio] = (fallos[dominio] || 0) + 1;
    });
  const topFallos = Object.keys(fallos).sort((a, b) => fallos[b] - fallos[a]).slice(0, 5);
  if (topFallos.length) {
    lineas.push('Los que más fallan:\n' + topFallos.map((d) => `  ⚠️ ${esc_(d)} (${fallos[d]})`).join('\n'));
    lineas.push(`Para que deje de analizar alguno: <code>/ignorar ${esc_(topFallos[0])}</code>`);
  }
  if (!conFb.length) {
    lineas.push('\nMarca con 👍/👎 los avisos de correos para alimentar estas métricas.');
  }
  return lineas.join('\n');
}

/** Busca entre los correos ya analizados (últimos 90 días) por remitente, asunto o resumen. */
function buscarCorreos_(consulta) {
  const q = normalizar_(consulta).replace(/^(busca|buscar|encuentra|revisa)\s+/, '');
  const tokens = q.split(/\s+/).filter((t) => t.length > 2);
  if (!tokens.length) return '🔍 ¿Qué busco? Ej: <code>buscar cotización</code> o <code>buscar enel</code>.';
  const desde = Date.now() - 90 * 86400000;
  const filas = leer_('Correos')
    .filter((c) => c.estado === 'procesado' && c.accion !== 'omitir' && new Date(c.fecha).getTime() >= desde)
    .filter((c) => {
      const todo = normalizar_(`${c.asunto} ${c.resumen} ${c.remitente} ${c.categoria}`);
      return tokens.every((t) => todo.indexOf(t) >= 0);
    })
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  if (!filas.length) return `📭 No encontré correos con "${esc_(consulta)}" en los últimos 90 días.`;
  const lineas = filas.slice(0, 8).map((c) => {
    const monto = c.monto ? ` · <b>${formatCOP_(c.monto)}</b>` : '';
    const cat = ETIQUETAS_CATEGORIA_[c.categoria] || c.categoria || '';
    return `• ${fmtFecha_(c.fecha, 'dd/MM')} ${esc_(String(cat))} · ${esc_(nombreRemitente_(c.remitente))}: ${esc_(String(c.resumen || c.asunto).slice(0, 90))}${monto}`;
  });
  const resto = filas.length > 8 ? `\n\n<i>…y ${filas.length - 8} más</i>` : '';
  return `🔍 <b>${filas.length} coincidencia(s)</b>\n` + lineas.join('\n') + resto;
}
