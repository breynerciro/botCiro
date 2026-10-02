/**
 * Triggers programados. Ejecutar instalarTriggers() desde el editor
 * (y de nuevo si cambias HORA_RESUMEN en Config).
 *
 * Todo lo periódico pasa por UN solo trigger (`scheduler`, cada 5 min) que decide
 * qué le toca según cuánto tiempo falte: así no se gastan triggers de Apps Script
 * por cada cosa (cuota de 90 min/día) y todo se revisa en una sola ejecución.
 */

const FUNCIONES_TRIGGER_ = ['scheduler', 'enviarResumenDiario', 'pollUpdates'];

/** Triggers viejos que este esquema reemplaza (se borran al reinstalar). */
const TRIGGERS_ANTIGUOS_ = ['escanearGmail', 'escanearJira', 'revisarReuniones'];

function borrarTriggers_(nombres) {
  ScriptApp.getProjectTriggers()
    .filter((t) => nombres.indexOf(t.getHandlerFunction()) >= 0)
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/** Ejecuta `fn` solo si pasó `minutos` desde la última vez (marca antes de ejecutar). */
function cadaMinutos_(nombre, minutos, fn) {
  const ult = Number(prop_('ULT_' + nombre) || 0);
  if (Date.now() - ult < minutos * 60000) return false;
  setProp_('ULT_' + nombre, Date.now());
  try {
    fn();
  } catch (err) {
    registrarError_(nombre, err);
  }
  return true;
}

/** Trigger principal: cada 5 minutos revisa todo lo que corresponda. */
function scheduler() {
  try {
    conBloqueo_(() => {
      escanearBancos_();
      escanearCorreosPersonales_();
    });
    // Sin bloqueo global: la IA puede tardar y bloquearía los comandos de Telegram.
    procesarColaCorreos_();
    revisarReuniones();

    cadaMinutos_('JIRA', 10, () => conBloqueo_(() => escanearJira_()));
    cadaMinutos_('VENCIMIENTOS', 5, avisarVencimientos);
    cadaMinutos_('SALUD', 1440, revisarSalud_);
    cadaMinutos_('PURGA', 1440, () => conBloqueo_(() => purgarDatos_()));
    cadaMinutos_('BACKUP', 10080, backupDatos_);
  } catch (err) {
    registrarError_('scheduler', err);
  }
}

function instalarTriggers() {
  borrarTriggers_(TRIGGERS_ANTIGUOS_.concat(['scheduler', 'enviarResumenDiario']));

  ScriptApp.newTrigger('scheduler').timeBased().everyMinutes(5).create();

  const [hora, minuto] = String(getConfig_('HORA_RESUMEN', '6:30')).split(':').map(Number);
  ScriptApp.newTrigger('enviarResumenDiario')
    .timeBased()
    .atHour(hora || 6)
    .nearMinute(minuto || 0)
    .everyDays(1)
    .inTimezone(zonaHoraria_())
    .create();

  console.log('Triggers instalados: ' + ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction()).join(', '));
}

/** Plan B: cambia de webhook a polling cada minuto (si Telegram no logra entregar al webhook). */
function activarPolling() {
  tg_('deleteWebhook', { drop_pending_updates: false });
  borrarTriggers_(['pollUpdates']);
  ScriptApp.newTrigger('pollUpdates').timeBased().everyMinutes(1).create();
  console.log('Polling activado: el bot revisará mensajes cada minuto.');
}

function desactivarPolling() {
  borrarTriggers_(['pollUpdates']);
  console.log('Polling desactivado. Ejecuta registrarWebhook() para volver al webhook.');
}
