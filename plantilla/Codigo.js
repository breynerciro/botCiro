/**
 * Tu asistente personal en Telegram.
 *
 * Este archivo NO necesitas editarlo: usa el menú 🤖 Asistente de la hoja.
 * Todo el código vive en la biblioteca BotCiro; aquí solo se le pasan los servicios de TU copia
 * (tus propiedades, tu caché, tu hoja), para que tus datos nunca se mezclen con los de nadie más.
 */

function ctx_() {
  let url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    url = '';
  }
  return {
    props: PropertiesService.getScriptProperties(),
    cache: CacheService.getScriptCache(),
    lock: LockService.getScriptLock(),
    ss: SpreadsheetApp.getActiveSpreadsheet(),
    url: url,
  };
}

function onOpen() {
  // Sin llamar a la biblioteca: así el menú aparece incluso antes de autorizar.
  SpreadsheetApp.getUi()
    .createMenu('🤖 Asistente')
    .addItem('Instalar', 'instalar')
    .addItem('Estado del bot', 'estado')
    .addItem('Buscar actualización', 'actualizar')
    .addToUi();
}

// Telegram y el satélite
function doPost(e) { return BotCiro.ejecutar(ctx_(), 'doPost', [e]); }
function doGet(e) { return BotCiro.ejecutar(ctx_(), 'doGet', [e]); }

// Triggers (los crea el instalador)
function scheduler() { BotCiro.ejecutar(ctx_(), 'scheduler'); }
function enviarResumenDiario() { BotCiro.ejecutar(ctx_(), 'enviarResumenDiario'); }
function pollUpdates() { BotCiro.ejecutar(ctx_(), 'pollUpdates'); }

// Menú de la hoja y diálogo de instalación
function instalar() { BotCiro.ejecutar(ctx_(), 'instalar'); }
function instalarConToken(token) { return BotCiro.ejecutar(ctx_(), 'instalarConToken', [token]); }
function conectarWebApp(url) { return BotCiro.ejecutar(ctx_(), 'conectarWebApp', [url]); }
function estado() { BotCiro.ejecutar(ctx_(), 'estado'); }
function actualizar() { BotCiro.ejecutar(ctx_(), 'actualizar'); }

// Para ejecutar a mano desde el editor si algo falla
function instalarTriggers() { BotCiro.ejecutar(ctx_(), 'instalarTriggers'); }
function registrarWebhook() { BotCiro.ejecutar(ctx_(), 'registrarWebhook'); }
function estadoWebhook() { BotCiro.ejecutar(ctx_(), 'estadoWebhook'); }
function probarResumen() { BotCiro.ejecutar(ctx_(), 'probarResumen'); }
