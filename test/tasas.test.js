// Tasa de cambio: se lee de GOOGLEFINANCE("USD/COP") en la hoja (la tasa real de Google),
// con caché y respaldo en Config TASA_USD si Google no responde.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('./gasMocks');

function preparar() {
  const env = crearEntorno({});
  env.ctx.setup();
  env.props.TELEGRAM_TOKEN = 'tok';
  return env;
}

test('la tasa sale de GOOGLEFINANCE (Google) y se cachea 6 h', () => {
  const env = preparar();
  env.ctx.agregar_('Tasas', { clave: 'usd_cop', valor: 3306.81, actualizada: '' });

  assert.equal(env.ctx.tasaUSD_(), 3306.81);
  assert.equal(env.props.TASA_USD_VALOR, '3306.81', 'queda guardada');

  // Segunda llamada usa la caché: si la hoja cambia, no se vuelve a leer.
  env.hojas.Tasas._filas[1][1] = 9999;
  assert.equal(env.ctx.tasaUSD_(), 3306.81);
  assert.match(env.ctx.lineaTasaUSD_(), /Tasa USD→COP: <b>\$3\.307<\/b> \(Google/);
});

test('si GOOGLEFINANCE devuelve #N/A se usa el respaldo de Config', () => {
  const env = preparar();
  env.ctx.agregar_('Tasas', { clave: 'usd_cop', valor: '#N/A', actualizada: '' });
  assert.equal(env.ctx.tasaUSD_(), 4100);
  assert.match(env.ctx.lineaTasaUSD_(), /respaldo de Config/);
});

test('los montos en dólares se convierten a la moneda local con esa tasa', () => {
  const env = preparar();
  env.ctx.agregar_('Tasas', { clave: 'usd_cop', valor: 3306.81, actualizada: '' });
  assert.equal(env.ctx.aCOP_(20, 'USD', env.ctx.tasaUSD_()), 66136);
  assert.equal(env.ctx.aCOP_(44900, 'COP', env.ctx.tasaUSD_()), 44900, 'los pesos no se tocan');
});
