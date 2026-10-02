/**
 * Instalación de triggers programados. Ejecutar instalarTriggers() desde el editor
 * (y de nuevo si cambias HORA_RESUMEN en Config).
 */

const FUNCIONES_TRIGGER_ = ['escanearGmail', 'escanearJira', 'revisarReuniones', 'enviarResumenDiario', 'pollUpdates'];

function borrarTriggers_(nombres) {
  ScriptApp.getProjectTriggers()
    .filter((t) => nombres.indexOf(t.getHandlerFunction()) >= 0)
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

function instalarTriggers() {
  borrarTriggers_(['escanearGmail', 'escanearJira', 'revisarReuniones', 'enviarResumenDiario']);

  ScriptApp.newTrigger('escanearGmail').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('escanearJira').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('revisarReuniones').timeBased().everyMinutes(5).create();

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
