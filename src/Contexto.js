/**
 * Servicios propios de cada instalación.
 *
 * botCiro corre de dos formas:
 *   - Proyecto propio (standalone o ligado a una hoja): usa sus propios servicios, como siempre.
 *   - Biblioteca: la copia de cada persona es un script mínimo (plantilla/) que llama a este código.
 *     En una biblioteca, Script Properties, Cache y Lock son COMPARTIDOS entre todos los que la usan,
 *     así que la copia pasa los suyos en `ctx` y aquí nunca se toca el almacén de la biblioteca.
 *
 * ctx = { props, cache, lock, ss, url }  (ver plantilla/Codigo.js)
 */

let CTX_ = null;

// true solo en el build de biblioteca (scripts/biblioteca.js lo reemplaza al publicar).
const MODO_BIBLIOTECA_ = false;

function sinContexto_() {
  if (MODO_BIBLIOTECA_) throw new Error('Llamada a la biblioteca sin contexto: actualiza el código de tu copia (plantilla).');
}

function props_() {
  if (CTX_ && CTX_.props) return CTX_.props;
  sinContexto_();
  return PropertiesService.getScriptProperties();
}

function cache_() {
  if (CTX_ && CTX_.cache) return CTX_.cache;
  sinContexto_();
  return CacheService.getScriptCache();
}

function lock_() {
  if (CTX_ && CTX_.lock) return CTX_.lock;
  sinContexto_();
  return LockService.getScriptLock();
}

/** Hoja del contenedor (copia de la plantilla) o null si el script no está ligado a una hoja. */
function hojaContenedor_() {
  if (CTX_ && CTX_.ss) return CTX_.ss;
  try {
    return SpreadsheetApp.getActiveSpreadsheet() || null;
  } catch (e) {
    return null;
  }
}

/** URL /exec de la aplicación web, si se conoce. */
function urlWebApp_() {
  const guardada = prop_('WEBAPP_URL');
  if (guardada) return guardada;
  let url = CTX_ && CTX_.url;
  if (!url && !MODO_BIBLIOTECA_) {
    try {
      url = ScriptApp.getService().getUrl();
    } catch (e) {
      url = '';
    }
  }
  return url && /\/exec$/.test(url) ? url : '';
}

/** Ejecuta `fn` con el contexto de la copia que llama (y lo limpia al terminar). */
function conContexto_(ctx, fn) {
  const previo = CTX_;
  CTX_ = ctx || null;
  try {
    return fn();
  } finally {
    CTX_ = previo;
  }
}
