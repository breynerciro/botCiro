/**
 * Puerta de entrada cuando este código se usa como biblioteca (identificador BotCiro).
 *
 * Las funciones que terminan en "_" son privadas en una biblioteca, así que la copia de cada
 * persona (plantilla/Codigo.js) llama a todo por aquí:  BotCiro.ejecutar(ctx, 'scheduler')
 * Solo se pueden ejecutar las entradas de esta lista.
 */

function entradas_() {
  return {
    doPost: doPost,
    doGet: doGet,
    scheduler: scheduler,
    enviarResumenDiario: enviarResumenDiario,
    pollUpdates: pollUpdates,
    instalar: abrirInstalador_,
    instalarConToken: instalarConToken_,
    conectarWebApp: conectarWebApp_,
    estado: estadoEnHoja_,
    actualizar: guiaActualizacion_,
    setup: setup,
    instalarTriggers: instalarTriggers,
    registrarWebhook: registrarWebhook,
    estadoWebhook: estadoWebhook,
    datosSatelite: datosSatelite,
    modelosGemini: modelosGemini,
    probarResumen: probarResumen,
  };
}

/** Ejecuta una entrada con los servicios (props, cache, lock, hoja, url) de la copia que llama. */
function ejecutar(ctx, nombre, args) {
  const fn = entradas_()[nombre];
  if (!fn) throw new Error('Entrada desconocida: ' + nombre);
  return conContexto_(ctx, () => fn.apply(null, args || []));
}

/** Versión del código que corre (la muestra /estado y la usa /actualizar). */
function version() {
  return VERSION;
}
