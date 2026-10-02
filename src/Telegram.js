/**
 * Cliente mínimo de la Bot API de Telegram.
 */

const LIMITE_MENSAJE_ = 4000;

/** Chats autorizados: CHAT_ID guarda una lista separada por coma (varios dispositivos). */
function chats_() {
  return String(prop_('CHAT_ID') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function hayChats_() {
  return chats_().length > 0;
}

/**
 * Llamada a la Bot API con reintentos: 429 (flood) y 5xx esperan y vuelven a intentar.
 * Los demás errores se lanzan de inmediato (mensaje inválido, token malo, etc.).
 */
function tg_(metodo, payload) {
  const token = prop_('TELEGRAM_TOKEN');
  if (!token) throw new Error('Falta TELEGRAM_TOKEN en las propiedades del script.');
  let ultimoError = null;
  for (let intento = 0; intento < 3; intento++) {
    const resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + metodo, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload || {}),
      muteHttpExceptions: true,
    });
    let data = null;
    try {
      data = JSON.parse(resp.getContentText());
    } catch (e) {
      data = null;
    }
    if (data && data.ok) return data.result;
    const codigo = (data && data.error_code) || resp.getResponseCode() || 500;
    ultimoError = new Error('Telegram ' + metodo + ': ' + ((data && data.description) || 'HTTP ' + codigo));
    if (codigo === 429 || codigo >= 500) {
      const espera = (data && data.parameters && data.parameters.retry_after) || Math.pow(2, intento) * 2;
      Utilities.sleep(Math.min(espera, 30) * 1000);
      continue;
    }
    throw ultimoError;
  }
  throw ultimoError;
}

/** Escapa texto para parse_mode HTML. */
function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Parte un mensaje en trozos dentro del límite de Telegram.
 * También corta una sola línea que supere el límite (antes se enviaba y Telegram lo rechazaba).
 */
function partirMensaje_(texto) {
  const partes = [];
  let actual = '';
  String(texto == null ? '' : texto).split('\n').forEach((linea) => {
    let l = linea;
    while (l.length > LIMITE_MENSAJE_) {
      if (actual) {
        partes.push(actual);
        actual = '';
      }
      partes.push(l.slice(0, LIMITE_MENSAJE_));
      l = l.slice(LIMITE_MENSAJE_);
    }
    if (actual && (actual + '\n' + l).length > LIMITE_MENSAJE_) {
      partes.push(actual);
      actual = l;
    } else {
      actual = actual ? actual + '\n' + l : l;
    }
  });
  if (actual) partes.push(actual);
  return partes.filter(Boolean);
}

/**
 * Envía un mensaje HTML a un chat (o a todos los vinculados si no se indica).
 * `teclado` es un inline keyboard de Telegram ({ inline_keyboard: [[...]] }).
 */
function enviar_(texto, chatId, teclado) {
  const destinos = chatId ? [String(chatId)] : chats_();
  if (!destinos.length) throw new Error('No hay chat vinculado: envía /vincular <código> al bot.');
  const partes = partirMensaje_(texto);
  destinos.forEach((id) => {
    partes.forEach((p, i) => {
      const payload = { chat_id: id, text: p, parse_mode: 'HTML', disable_web_page_preview: true };
      if (teclado && i === partes.length - 1) payload.reply_markup = teclado;
      tg_('sendMessage', payload);
    });
  });
}

/** Contesta al usuario que pulsó un botón (sin HTML: Telegram lo muestra en un toast). */
function responderCallback_(callbackId, texto) {
  tg_('answerCallbackQuery', {
    callback_query_id: callbackId,
    text: String(texto || '').replace(/<[^>]+>/g, '').slice(0, 200),
  });
}
