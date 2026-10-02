/**
 * Configuración inicial. Ejecutar desde el editor de Apps Script, en este orden:
 *   1. setup()             crea la hoja, las pestañas y los secretos
 *   2. (desplegar como aplicación web)
 *   3. registrarWebhook()  conecta Telegram con el despliegue
 *   4. instalarTriggers()  activa escaneo de Gmail, recordatorios y resumen diario
 */

/** Pestaña de bienvenida de la plantilla: setup() no la borra. */
const HOJA_INICIO_ = 'Inicio';

function setup() {
  const props = props_();

  // Copia de la plantilla: los datos van en la misma hoja. Proyecto standalone: crea una hoja nueva.
  let ss;
  if (props.getProperty('SPREADSHEET_ID')) {
    ss = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  } else {
    ss = hojaContenedor_() || SpreadsheetApp.create(nombreBot_() + ' · datos');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  SS_ = ss;

  Object.keys(ESQUEMAS).forEach((nombre) => {
    let sh = ss.getSheetByName(nombre);
    if (!sh) sh = ss.insertSheet(nombre);
    const columnas = ESQUEMAS[nombre];
    sh.getRange(1, 1, 1, columnas.length).setValues([columnas]).setFontWeight('bold').setBackground('#161535').setFontColor('#00FFCE');
    sh.setFrozenRows(1);
  });

  // Formatos: últimos 4 como texto (conserva ceros a la izquierda) y montos en pesos.
  const col = (hoja, nombre) => ss.getSheetByName(hoja).getRange(2, ESQUEMAS[hoja].indexOf(nombre) + 1, 999, 1);
  col('Cuentas', 'ultimos4').setNumberFormat('@');
  col('Cuentas', 'saldo_base').setNumberFormat('$#,##0');
  col('Movimientos', 'monto').setNumberFormat('$#,##0');

  ss.getSheets()
    .filter((sh) => !ESQUEMAS[sh.getName()] && sh.getName() !== HOJA_INICIO_)
    .forEach((sh) => ss.deleteSheet(sh));

  const existentes = new Set(leer_('Config').map((r) => r.clave));
  CONFIG_INICIAL.filter((c) => !existentes.has(c[0])).forEach((c) => agregar_('Config', { clave: c[0], valor: c[1], nota: c[2] }));

  if (!props.getProperty('WEBHOOK_SECRET')) props.setProperty('WEBHOOK_SECRET', Utilities.getUuid().replace(/-/g, ''));
  if (!props.getProperty('SYNC_SECRET')) props.setProperty('SYNC_SECRET', Utilities.getUuid().replace(/-/g, ''));
  if (!props.getProperty('CODIGO_VINCULACION')) props.setProperty('CODIGO_VINCULACION', String(Math.floor(100000 + Math.random() * 900000)));

  console.log('Hoja de datos: ' + ss.getUrl());
  console.log('Código de vinculación: envía al bot  /vincular ' + props.getProperty('CODIGO_VINCULACION'));
  if (!props.getProperty('TELEGRAM_TOKEN')) {
    console.log('Falta TELEGRAM_TOKEN: agrégalo en Configuración del proyecto → Propiedades del script.');
  }
}

function registrarWebhook() {
  const url = urlWebApp_();
  if (!url) {
    throw new Error('No encontré la URL /exec del despliegue. Despliega como aplicación web y guarda la URL en la propiedad WEBAPP_URL.');
  }
  tg_('setWebhook', {
    url: url + '?key=' + prop_('WEBHOOK_SECRET'),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  tg_('setMyCommands', { commands: comandosMenu_() });
  estadoWebhook();
}

function estadoWebhook() {
  const info = tg_('getWebhookInfo');
  // No imprimir la URL completa: contiene el secreto.
  console.log(
    JSON.stringify(
      {
        url_configurada: Boolean(info.url),
        pendientes: info.pending_update_count,
        ultimo_error: info.last_error_message || null,
        fecha_ultimo_error: info.last_error_date ? new Date(info.last_error_date * 1000) : null,
      },
      null,
      2
    )
  );
}

/** Prueba rápida desde el editor: manda el resumen ahora. */
function probarResumen() {
  enviar_(armarResumen_(PERFILES));
}
