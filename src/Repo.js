/**
 * Acceso genérico a las pestañas de la hoja. Cada fila se lee como objeto { columna: valor, _fila }.
 */

let SS_ = null;

function ss_() {
  if (!SS_) {
    const id = prop_('SPREADSHEET_ID');
    if (!id) throw new Error('Falta SPREADSHEET_ID: ejecuta setup() primero.');
    SS_ = SpreadsheetApp.openById(id);
  }
  return SS_;
}

function hoja_(nombre) {
  let sh = ss_().getSheetByName(nombre);
  if (!sh) {
    // Pestañas agregadas en versiones nuevas se crean solas, sin tener que volver a ejecutar setup().
    if (!ESQUEMAS[nombre]) throw new Error('No existe la pestaña ' + nombre);
    sh = ss_().insertSheet(nombre);
    sh.getRange(1, 1, 1, ESQUEMAS[nombre].length).setValues([ESQUEMAS[nombre]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (ESQUEMAS[nombre] && !HOJAS_REVISADAS_[nombre]) {
    // Columnas agregadas en versiones nuevas: completa el encabezado (una vez por ejecución).
    if (sh.getLastColumn() < ESQUEMAS[nombre].length) {
      sh.getRange(1, 1, 1, ESQUEMAS[nombre].length).setValues([ESQUEMAS[nombre]]);
    }
  }
  HOJAS_REVISADAS_[nombre] = true;
  return sh;
}

const HOJAS_REVISADAS_ = {};

function leer_(nombre) {
  const valores = hoja_(nombre).getDataRange().getValues();
  const encabezados = valores.shift() || [];
  return valores
    .map((fila, i) => {
      const o = { _fila: i + 2 };
      encabezados.forEach((h, j) => (o[h] = fila[j]));
      return o;
    })
    .filter((o) => encabezados.some((h) => o[h] !== ''));
}

function agregar_(nombre, obj) {
  const fila = ESQUEMAS[nombre].map((c) => (obj[c] === undefined || obj[c] === null ? '' : obj[c]));
  hoja_(nombre).appendRow(fila);
  return obj;
}

function actualizar_(nombre, numFila, cambios) {
  const columnas = ESQUEMAS[nombre];
  const sh = hoja_(nombre);
  Object.keys(cambios).forEach((k) => {
    const j = columnas.indexOf(k);
    if (j >= 0) sh.getRange(numFila, j + 1).setValue(cambios[k]);
  });
}

/** Reescribe una fila completa en una sola llamada (filaObj viene de leer_ y trae _fila). */
function guardarFila_(nombre, filaObj, cambios) {
  const columnas = ESQUEMAS[nombre];
  const o = Object.assign({}, filaObj, cambios);
  hoja_(nombre)
    .getRange(filaObj._fila, 1, 1, columnas.length)
    .setValues([columnas.map((c) => (o[c] == null ? '' : o[c]))]);
  Object.assign(filaObj, cambios);
}

/** Reemplaza todas las filas de datos de una pestaña. */
function reescribir_(nombre, objs) {
  const columnas = ESQUEMAS[nombre];
  const sh = hoja_(nombre);
  const ultima = sh.getLastRow();
  if (ultima > 1) sh.getRange(2, 1, ultima - 1, columnas.length).clearContent();
  if (objs.length) {
    sh.getRange(2, 1, objs.length, columnas.length).setValues(objs.map((o) => columnas.map((c) => (o[c] == null ? '' : o[c]))));
  }
}

function siguienteId_(nombre, filas) {
  const ids = (filas || leer_(nombre)).map((r) => Number(r.id) || 0);
  return ids.length ? Math.max.apply(null, ids) + 1 : 1;
}

function registrarLog_(nivel, origen, mensaje, detalle) {
  console.log(`[${nivel}] ${origen}: ${mensaje}`);
  try {
    agregar_('Log', { fecha: new Date(), nivel: nivel, origen: origen, mensaje: mensaje, detalle: detalle || '' });
  } catch (e) {
    console.error('No se pudo escribir en Log: ' + e);
  }
}

function registrarError_(origen, err) {
  registrarLog_('error', origen, String((err && err.message) || err), (err && err.stack) || '');
}

let PROFUNDIDAD_BLOQUEO_ = 0;

/** Serializa operaciones que escriben en la hoja (webhook y triggers pueden coincidir). Reentrante. */
function conBloqueo_(fn) {
  if (PROFUNDIDAD_BLOQUEO_ > 0) return fn();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  PROFUNDIDAD_BLOQUEO_++;
  try {
    return fn();
  } finally {
    PROFUNDIDAD_BLOQUEO_--;
    lock.releaseLock();
  }
}
