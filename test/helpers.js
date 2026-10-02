// Carga archivos de src/ en un mismo contexto global, igual que lo hace Apps Script.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cargarGas(...archivos) {
  const ctx = vm.createContext({ console });
  for (const f of archivos) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

// Fecha local en formato YYYY-MM-DD (los Date del contexto vm no son comparables con deepEqual).
function ymd(d) {
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = { cargarGas, ymd };
