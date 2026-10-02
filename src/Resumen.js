/**
 * Resumen consolidado (comando /resumen y envío diario).
 */

function armarResumen_(perfiles) {
  const cuentas = leer_('Cuentas');
  const movimientos = leer_('Movimientos');
  const pendientes = leer_('Pendientes');
  const hoy = rangoAgenda_('hoy');

  const encabezado = `☀️ <b>Resumen · ${fmtDia_(new Date())}</b>`;
  const bloques = perfiles.map((p) => {
    const partes = [`👤 <b>${p.toUpperCase()}</b>`];

    const saldos = lineasSaldos_(p, cuentas, movimientos);
    if (saldos.length) partes.push('💰 <b>Saldos</b>\n' + saldos.join('\n'));

    const agenda = lineasAgenda_(p, hoy);
    partes.push('📅 <b>Hoy</b>\n' + (agenda.length ? agenda.join('\n') : '<i>Sin reuniones</i>'));

    const abiertos = abiertos_([p], pendientes);
    if (abiertos.length) {
      const visibles = abiertos.slice(0, 8).map(lineaPendiente_);
      if (abiertos.length > 8) visibles.push(`<i>…y ${abiertos.length - 8} más (/pendientes ${p})</i>`);
      partes.push(`✅ <b>Pendientes (${abiertos.length})</b>\n` + visibles.join('\n'));
    } else {
      partes.push('✅ <i>Sin pendientes</i>');
    }

    const correos = lineasCorreos_([p], 24, false);
    if (correos.length) partes.push('📬 <b>Correos (24 h)</b>\n' + correos.join('\n'));
    return partes.join('\n\n');
  });

  const cuerpo = [encabezado].concat(bloques).join('\n\n───────\n\n');
  // Comparación de gastos 30 días vs. los 30 anteriores (solo sube la voz si se disparó).
  const desviacion = lineaDesviacionGastos_();
  return desviacion ? cuerpo + '\n\n' + desviacion : cuerpo;
}

/** Trigger diario. */
function enviarResumenDiario() {
  try {
    enviar_(armarResumen_(perfilesActivos_()));
  } catch (err) {
    registrarError_('enviarResumenDiario', err);
  }
}
