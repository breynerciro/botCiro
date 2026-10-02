/**
 * Cliente mínimo de la Bot API de Telegram.
 */

const LIMITE_MENSAJE_ = 4000;

function tg_(metodo, payload) {
  const token = prop_('TELEGRAM_TOKEN');
  if (!token) throw new Error('Falta TELEGRAM_TOKEN en las propiedades del script.');
  const resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + metodo, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(resp.getContentText());
  if (!data.ok) throw new Error('Telegram ' + metodo + ': ' + data.description);
  return data.result;
}

/** Escapa texto para parse_mode HTML. */
function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Envía un mensaje HTML al chat autorizado (o al indicado), partiéndolo si excede el límite. */
function enviar_(texto, chatId) {
  chatId = chatId || prop_('CHAT_ID');
  if (!chatId) throw new Error('No hay chat vinculado: envía /vincular <código> al bot.');
  const partes = [];
  let actual = '';
  String(texto).split('\n').forEach((linea) => {
    if ((actual + '\n' + linea).length > LIMITE_MENSAJE_) {
      partes.push(actual);
      actual = linea;
    } else {
      actual = actual ? actual + '\n' + linea : linea;
    }
  });
  if (actual) partes.push(actual);
  partes.forEach((p) =>
    tg_('sendMessage', { chat_id: chatId, text: p, parse_mode: 'HTML', disable_web_page_preview: true })
  );
}

const COMANDOS_MENU_ = [
  ['resumen', '(/r) Saldos, agenda de hoy y pendientes'],
  ['agenda', '(/a) Reuniones: hoy | mañana | semana'],
  ['pendientes', '(/p) Pendientes abiertos'],
  ['tarea', '(/t) Crear pendiente: /tarea texto [fecha]'],
  ['hecho', '(/h) Cerrar pendientes: /hecho 3 5'],
  ['saldo', '(/s) Saldos estimados por cuenta'],
  ['gasto', '(/g) Registrar gasto: /gasto 50000 mercado #cuenta'],
  ['ingreso', '(/i) Registrar ingreso: /ingreso 2000000 nómina'],
  ['ajustar', '(/aj) Fijar saldo real: /ajustar cuenta 2300000'],
  ['movimientos', '(/m) Últimos movimientos'],
  ['nuevacuenta', '(/nc) Crear cuenta: /nuevacuenta banco alias 1234 saldo'],
  ['perfil', '(/pf) Cambiar perfil activo: personal | trabajo'],
  ['correos', '(/c) Correos analizados en las últimas 24 h'],
  ['jira', '(/j) Revisar actividades asignadas en Jira'],
  ['ignorar', '(/ig) Ignorar un remitente: /ignorar tienda.com'],
  ['revisar', '(/rv) Revisar Gmail ahora'],
  ['ayuda', '(/?) Ver todos los comandos'],
];
