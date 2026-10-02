/**
 * Entrada de mensajes de Telegram: webhook (doPost) o polling (plan B).
 */

/** Chat desde el que llegó el mensaje que se está procesando (lo usa /desvincular). */
let CHAT_ACTUAL_ = '';

function doPost(e) {
  if (e && e.parameter && e.parameter.sync) {
    if (e.parameter.sync !== prop_('SYNC_SECRET')) return respuestaJson_({ ok: false, error: 'secreto inválido' });
    try {
      return respuestaJson_(conBloqueo_(() => recibirSync_(JSON.parse(e.postData.contents))));
    } catch (err) {
      registrarError_('sync', err);
      return respuestaJson_({ ok: false, error: String(err.message || err) });
    }
  }
  try {
    if (!e || !e.parameter || e.parameter.key !== prop_('WEBHOOK_SECRET')) return;
    procesarUpdate_(JSON.parse(e.postData.contents));
  } catch (err) {
    registrarError_('doPost', err);
  }
  // Sin return a propósito: devolver ContentService hace que Apps Script responda con un 302,
  // que Telegram trata como error y reintenta. Sin salida, la respuesta es 200.
}

function procesarUpdate_(update) {
  // Telegram puede reenviar el mismo update; se procesa una sola vez.
  const cache = CacheService.getScriptCache();
  const claveCache = 'upd_' + update.update_id;
  if (cache.get(claveCache)) return;
  cache.put(claveCache, '1', 21600);

  if (update.callback_query) return procesarCallback_(update.callback_query);

  const msg = update.message;
  if (!msg || typeof msg.text !== 'string') return;
  const chatId = String(msg.chat.id);
  const autorizados = chats_();

  if (autorizados.indexOf(chatId) < 0) {
    // /vincular <código> agrega este chat: sirve para vincular otro dispositivo
    // (tablet, PC) con el mismo código. Sin el código, cualquier chat se ignora.
    const codigo = prop_('CODIGO_VINCULACION');
    if (codigo && msg.text.trim() === '/vincular ' + codigo) {
      setProp_('CHAT_ID', autorizados.concat([chatId]).join(','));
      enviar_('✅ Este chat quedó vinculado. Escribe /ayuda para ver lo que puedo hacer.', chatId);
    }
    return;
  }

  let respuesta;
  try {
    CHAT_ACTUAL_ = chatId;
    respuesta = conBloqueo_(() => responder_(msg.text));
  } catch (err) {
    registrarError_('comando', err);
    respuesta = '⚠️ ' + esc_(err.message);
  }
  if (respuesta) enviar_(respuesta, chatId);
}

/**
 * Botones inline: cerrar pendiente (#id), ejecutar un comando o dar feedback del análisis.
 *   hecho:3   → cierra el pendiente #3
 *   cmd:p     → ejecuta /p (lista de pendientes) y la manda al chat
 *   fb:ok:12  → el correo 12 estaba bien clasificado (fb:mal = mal clasificado)
 */
function procesarCallback_(cb) {
  const chatId = String((cb.message && cb.message.chat && cb.message.chat.id) || '');
  const datos = String(cb.data || '');
  if (chats_().indexOf(chatId) < 0) return responderCallback_(cb.id, '⚠️ Chat no autorizado.');
  let texto = '';
  try {
    if (datos.indexOf('hecho:') === 0) {
      texto = conBloqueo_(() => completarTarea_(datos.slice(6)));
    } else if (datos.indexOf('cmd:') === 0) {
      const nombre = datos.slice(4).replace(/[^a-z]/g, '');
      texto = conBloqueo_(() => responder_('/' + nombre)) || '';
      if (texto) enviar_(texto, chatId);
      texto = '✅ Enviado';
    } else if (datos.indexOf('fb:') === 0) {
      const partes = datos.split(':');
      texto = conBloqueo_(() => registrarFeedback_(partes[2], partes[1] === 'ok' ? 'ok' : 'mal'));
    } else {
      texto = 'Acción no reconocida.';
    }
  } catch (err) {
    registrarError_('procesarCallback_', err);
    texto = '⚠️ ' + String(err.message || err);
  }
  responderCallback_(cb.id, texto);
}

/** Plan B si el webhook falla: lee mensajes con getUpdates (trigger cada minuto). */
function pollUpdates() {
  const offset = Number(prop_('TG_OFFSET') || 0);
  const updates = tg_('getUpdates', {
    offset: offset,
    timeout: 0,
    allowed_updates: ['message', 'callback_query'],
  });
  updates.forEach((u) => {
    try {
      procesarUpdate_(u);
    } catch (err) {
      registrarError_('pollUpdates', err);
    }
    setProp_('TG_OFFSET', u.update_id + 1);
  });
}
