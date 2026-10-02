/**
 * Salud y mantenimiento del asistente:
 *   - /estado        diagnóstico que puedes pedir cuando algo se ve raro
 *   - revisarSalud_  watchdog diario: te avisa solo si algo está mal
 *   - purgarDatos_   retención: archiva correos y log viejos (la hoja no crece para siempre)
 *   - backupDatos_   copia semanal de la hoja de datos
 */

const ERRORES_MIN_ALERTA_ = 5;

function colaPendiente_() {
  return leer_('Correos').filter((c) => c.estado === 'cola').length;
}

function erroresRecientes_(ms) {
  const desde = Date.now() - ms;
  const filas = leer_('Log').filter((l) => l.nivel === 'error' && new Date(l.fecha).getTime() >= desde);
  return filas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function triggersInstalados_() {
  try {
    return ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());
  } catch (e) {
    return [];
  }
}

/** Devuelve { datos, alertas }: lo que se ve en /estado y lo que hay que avisar. */
function diagnosticar_() {
  const alertas = [];
  const ahora = Date.now();

  const triggers = triggersInstalados_();
  if (triggers.indexOf('scheduler') < 0 && triggers.indexOf('escanearGmail') < 0) {
    alertas.push('No hay triggers de escaneo instalados: ejecuta instalarTriggers() desde el editor.');
  }

  const errores = erroresRecientes_(86400000);
  if (errores.length >= ERRORES_MIN_ALERTA_) {
    alertas.push(`${errores.length} errores en las últimas 24 h. Último: ${errores[0].origen}: ${errores[0].mensaje}`);
  }

  const cola = colaPendiente_();
  const masViejo = leer_('Correos')
    .filter((c) => c.estado === 'cola')
    .map((c) => new Date(c.fecha).getTime())
    .sort((a, b) => a - b)[0];
  if (cola && masViejo && ahora - masViejo > 2 * 3600000) {
    alertas.push(`${cola} correo(s) llevan más de 2 h en cola sin analizar.`);
  }

  perfilesActivos_().forEach((p) => {
    if (fuenteCalendario_(p) !== 'satelite') return;
    const ultima = Number(prop_('SYNC_ULTIMA_' + p) || 0);
    const minutos = Math.round((ahora - ultima) / 60000);
    if (!ultima) alertas.push(`El satélite de ${p} nunca ha sincronizado.`);
    else if (minutos > 60) alertas.push(`El satélite de ${p} lleva ${minutos} min sin sincronizar.`);
  });

  return { alertas: alertas, triggers: triggers, errores: errores, cola: cola };
}

function estadoSistema_() {
  const d = diagnosticar_();
  const ahora = Date.now();
  const lineas = ['🩺 <b>Estado del sistema</b>'];
  const nueva = hayActualizacion_();
  lineas.push(`• Versión: ${esc_(VERSION)}` + (nueva ? ` · 🆕 disponible ${esc_(nueva.version)} (/actualizar)` : ''));

  lineas.push('• Triggers: ' + (d.triggers.length ? d.triggers.join(', ') : '<b>ninguno</b> ⚠️'));

  const ultimaSync = perfilesActivos_().filter((p) => fuenteCalendario_(p) === 'satelite').map((p) => {
    const t = Number(prop_('SYNC_ULTIMA_' + p) || 0);
    if (!t) return `${p}: sin sync`;
    return `${p}: hace ${Math.round((ahora - t) / 60000)} min`;
  }).join(' · ');
  if (ultimaSync) lineas.push('• Satélite: ' + ultimaSync);

  lineas.push(`• Correos en cola: <b>${d.cola}</b>`);
  lineas.push(`• Errores (24 h): <b>${d.errores.length}</b>` + (d.errores.length ? ` — último: ${esc_(d.errores[0].origen)}: ${esc_(String(d.errores[0].mensaje).slice(0, 80))}` : ''));

  const ia = iaDisponible_();
  const soloReglas = normalizar_(getConfig_('IA_ACTIVA', 'si')) === 'no';
  lineas.push('• IA (Gemini): ' + (ia ? 'activa' : soloReglas ? 'apagada por Config' : 'sin API key (solo reglas)'));
  lineas.push(lineaTasaUSD_());
  lineas.push('• Jira: ' + (jiraConfigurado_() ? 'configurado' : 'no configurado'));

  const filas = ['Correos', 'Movimientos', 'Pendientes', 'Log']
    .map((h) => `${h} ${Math.max(0, leer_(h).length - 1)}`)
    .join(' · ');
  lineas.push('• Filas: ' + filas);

  const backups = JSON.parse(prop_('BACKUPS') || '[]');
  if (backups.length) {
    lineas.push('• Último backup: ' + fmtFecha_(new Date(backups[0].fecha), 'dd/MM/yyyy') + (backups[0].url ? ` · <a href="${esc_(backups[0].url)}">abrir</a>` : ''));
  }

  if (d.alertas.length) {
    lineas.push('', '⚠️ <b>Atención:</b>', d.alertas.map((a) => '• ' + esc_(a)).join('\n'));
  } else {
    lineas.push('', '✅ Todo en orden.');
  }
  return lineas.join('\n');
}

/** Watchdog diario: solo escribe si hay alertas. */
function revisarSalud_() {
  try {
    const d = diagnosticar_();
    if (d.alertas.length && hayChats_()) {
      enviar_('⚠️ <b>El asistente necesita atención</b>\n' + d.alertas.map((a) => '• ' + esc_(a)).join('\n'));
    }
    registrarLog_('info', 'revisarSalud_', `Salud revisada: ${d.alertas.length} alerta(s)`, d.alertas.join(' | '));
  } catch (err) {
    registrarError_('revisarSalud_', err);
  }
}

/**
 * Retención: los correos viejos se archivan y el Log no crece sin límite.
 * Los pendientes y movimientos nunca se borran (son tu historial).
 */
function purgarDatos_() {
  const diasCorreos = Number(getConfig_('DIAS_RETENCION_CORREOS', '60')) || 60;
  const diasLog = Number(getConfig_('DIAS_RETENCION_LOG', '30')) || 30;
  const maxLog = Number(getConfig_('MAX_FILAS_LOG', '5000')) || 5000;
  const ahora = Date.now();
  let borrados = 0;

  const correos = leer_('Correos');
  const conservarCorreos = correos.filter(
    (c) => c.estado === 'cola' || new Date(c.fecha).getTime() >= ahora - diasCorreos * 86400000
  );
  borrados += correos.length - conservarCorreos.length;
  if (borrados > 0) reescribir_('Correos', conservarCorreos);

  const log = leer_('Log');
  let conservarLog = log.filter((l) => new Date(l.fecha).getTime() >= ahora - diasLog * 86400000);
  if (conservarLog.length > maxLog) conservarLog = conservarLog.slice(-maxLog);
  const borradosLog = log.length - conservarLog.length;
  borrados += borradosLog;
  if (borradosLog > 0) reescribir_('Log', conservarLog);

  if (borrados > 0) registrarLog_('info', 'purgarDatos_', `Retención aplicada: ${borrados} fila(s) archivadas`, '');
  return borrados;
}

/** Copia de seguridad semanal de la hoja de datos (mantiene las últimas N). */
function backupDatos_() {
  try {
    const copia = ss_().copy(nombreBot_() + ' · backup ' + fmtFecha_(new Date(), 'yyyy-MM-dd'));
    const maximo = Number(getConfig_('BACKUPS_MAX', '8')) || 8;
    const viejos = JSON.parse(prop_('BACKUPS') || '[]');
    const nuevos = [{ id: copia.getId(), fecha: Date.now(), url: copia.getUrl() }].concat(viejos);
    nuevos.slice(maximo).forEach((b) => {
      try {
        DriveApp.getFileById(b.id).setTrashed(true);
      } catch (e) {
        // Sin permiso de Drive no se borra: mejor dejar copias de más que perder datos.
      }
    });
    setProp_('BACKUPS', JSON.stringify(nuevos.slice(0, maximo)));
    registrarLog_('info', 'backupDatos_', 'Copia de seguridad creada', copia.getUrl());
    return copia.getUrl();
  } catch (err) {
    registrarError_('backupDatos_', err);
    return null;
  }
}
