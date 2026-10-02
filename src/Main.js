/**
 * Entrada de mensajes de Telegram: webhook (doPost) o polling (plan B).
 */

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

  const msg = update.message;
  if (!msg || typeof msg.text !== 'string') return;
  const chatId = String(msg.chat.id);
  const autorizado = prop_('CHAT_ID');

  if (!autorizado) {
    const codigo = prop_('CODIGO_VINCULACION');
    if (codigo && msg.text.trim() === '/vincular ' + codigo) {
      setProp_('CHAT_ID', chatId);
      enviar_('✅ Listo, este chat quedó vinculado. Escribe /ayuda para ver lo que puedo hacer.', chatId);
    }
    return;
  }
  if (chatId !== autorizado) return; // cualquier otro chat se ignora en silencio

  let respuesta;
  try {
    respuesta = conBloqueo_(() => responder_(msg.text));
  } catch (err) {
    registrarError_('comando', err);
    respuesta = '⚠️ ' + esc_(err.message);
  }
  if (respuesta) enviar_(respuesta);
}

/** Plan B si el webhook falla: lee mensajes con getUpdates (trigger cada minuto). */
function pollUpdates() {
  const offset = Number(prop_('TG_OFFSET') || 0);
  const updates = tg_('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message'] });
  updates.forEach((u) => {
    try {
      procesarUpdate_(u);
    } catch (err) {
      registrarError_('pollUpdates', err);
    }
    setProp_('TG_OFFSET', u.update_id + 1);
  });
}
