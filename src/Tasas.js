/**
 * Tasa de cambio real: la que usa Google (Google Finance), consultada con la función
 * GOOGLEFINANCE("USD/COP") dentro de la propia hoja de datos. Sin scrapers ni APIs de terceros.
 *
 * Se guarda en la pestaña Tasas (se crea sola), se memoriza por 6 h y, si Google no
 * responde, se usa el valor fijo de Config TASA_USD como respaldo.
 */

const TASA_VIGENCIA_MS_ = 6 * 3600000;
let TASA_CACHE_ = null;

function tasaUSD_() {
  if (TASA_CACHE_) return TASA_CACHE_;

  const guardada = Number(prop_('TASA_USD_VALOR') || 0);
  const fecha = Number(prop_('TASA_USD_FECHA') || 0);
  if (guardada > 0 && Date.now() - fecha < TASA_VIGENCIA_MS_) {
    TASA_CACHE_ = guardada;
    return guardada;
  }

  const tasa = consultarTasaGoogle_();
  if (tasa) {
    setProp_('TASA_USD_VALOR', tasa);
    setProp_('TASA_USD_FECHA', Date.now());
    TASA_CACHE_ = tasa;
    return tasa;
  }

  // Respaldo: la última tasa conocida o la fija de Config (nunca divide por cero).
  TASA_CACHE_ = guardada > 0 ? guardada : Number(getConfig_('TASA_USD', '4100')) || 4100;
  return TASA_CACHE_;
}

/** Lee (y crea si hace falta) la celda con =GOOGLEFINANCE("USD/COP"). */
function consultarTasaGoogle_() {
  try {
    const sh = hoja_('Tasas');
    if (sh.getRange(1, 1).getValue() !== 'clave') return null;
    if (sh.getRange(2, 1).getValue() !== 'usd_cop') {
      sh.getRange(2, 1, 1, 2).setValues([['usd_cop', '=GOOGLEFINANCE("USD/COP")']]);
    }
    const valor = sh.getRange(2, 2).getValue();
    const n = typeof valor === 'number' ? valor : parseNumeroCOP_(valor); // "#N/A" → NaN
    if (isFinite(n) && n > 100 && n < 100000) return Math.round(n * 100) / 100;
    return null; // Google todavía no calcula (o el mercado está cerrado): se reintenta en 6 h
  } catch (err) {
    registrarLog_('info', 'tasaUSD_', 'No se pudo leer GOOGLEFINANCE: ' + String(err.message || err), '');
    return null;
  }
}

/** "Tasa USD: $3.306,81 (Google, hace 2 h)" — para /estado. */
function lineaTasaUSD_() {
  const fecha = Number(prop_('TASA_USD_FECHA') || 0);
  const desde = fecha ? `hace ${Math.max(1, Math.round((Date.now() - fecha) / 60000))} min` : 'respaldo de Config';
  return `• Tasa USD→COP: <b>${formatCOP_(tasaUSD_())}</b> (Google · ${desde})`;
}
