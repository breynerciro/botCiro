/**
 * Interpretación de texto: montos, fechas, comandos y mensajes libres.
 * Solo JavaScript puro (sin servicios de Apps Script) para poder probarlo en Node.
 */

const PERFILES = ['personal', 'trabajo'];

function normalizar_(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Convierte un número escrito en formato colombiano o anglosajón a Number.
 * "50.000,00" → 50000 · "50,000.00" → 50000 · "1.234.567" → 1234567 · "1.5" → 1.5
 */
function parseNumeroCOP_(raw) {
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const ultPunto = s.lastIndexOf('.');
  const ultComa = s.lastIndexOf(',');
  if (ultPunto >= 0 && ultComa >= 0) {
    const dec = ultPunto > ultComa ? '.' : ',';
    const mil = dec === '.' ? ',' : '.';
    s = s.split(mil).join('').replace(dec, '.');
  } else if (ultPunto >= 0 || ultComa >= 0) {
    const sep = ultPunto >= 0 ? '.' : ',';
    const partes = s.split(sep);
    const ultima = partes[partes.length - 1];
    // Varios separadores o grupos de 3 dígitos → separador de miles; si no, decimal.
    s = partes.length > 2 || ultima.length === 3 ? partes.join('') : partes.join('.');
  }
  return parseFloat(s);
}

const REGEX_MONTO_ = /\$?\s*(\d[\d.,]*)\s*(k|mill[oó]n(?:es)?|mm|palos?|mil|lucas?)?(?![\p{L}\d])/iu;

function multiplicador_(sufijo) {
  if (!sufijo) return 1;
  const s = normalizar_(sufijo);
  if (s.startsWith('mill') || s === 'mm' || s.startsWith('palo')) return 1e6;
  return 1e3; // k, mil, luca(s)
}

/** Busca el primer monto del texto ("50 mil", "$2.000.000", "1.5 millones", "80k"). */
function parseMonto_(texto) {
  const m = REGEX_MONTO_.exec(texto);
  if (!m) return null;
  const valor = parseNumeroCOP_(m[1]) * multiplicador_(m[2]);
  if (!isFinite(valor) || valor <= 0) return null;
  const resto = (texto.slice(0, m.index) + ' ' + texto.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  return { monto: Math.round(valor), resto: resto };
}

function formatCOP_(n) {
  const v = Math.round(Number(n) || 0);
  const abs = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (v < 0 ? '-$' : '$') + abs;
}

function inicioDia_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sumarDias_(d, n) {
  const r = inicioDia_(d);
  r.setDate(r.getDate() + n);
  return r;
}

const DIAS_ = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const PREFIJO_FECHA_ = '(?:^|\\s)(?:(?:para|hasta)\\s+)?(?:el\\s+)?';
const FIN_FECHA_ = '(?=\\s|$|[.,;!?])';

const PATRONES_FECHA_ = [
  {
    re: new RegExp(PREFIJO_FECHA_ + '(\\d{4})-(\\d{1,2})-(\\d{1,2})' + FIN_FECHA_, 'iu'),
    fecha: (m) => new Date(+m[1], +m[2] - 1, +m[3]),
  },
  {
    re: new RegExp(PREFIJO_FECHA_ + '(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?' + FIN_FECHA_, 'iu'),
    fecha: (m, ahora) => {
      const dia = +m[1];
      const mes = +m[2];
      if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
      if (m[3]) {
        const anio = m[3].length === 2 ? 2000 + +m[3] : +m[3];
        return new Date(anio, mes - 1, dia);
      }
      let f = new Date(ahora.getFullYear(), mes - 1, dia);
      if (f < inicioDia_(ahora)) f = new Date(ahora.getFullYear() + 1, mes - 1, dia);
      return f;
    },
  },
  {
    re: new RegExp(PREFIJO_FECHA_ + 'pasado\\s+ma[nñ]ana' + FIN_FECHA_, 'iu'),
    fecha: (m, ahora) => sumarDias_(ahora, 2),
  },
  {
    re: new RegExp(PREFIJO_FECHA_ + '(hoy|ma[nñ]ana)' + FIN_FECHA_, 'iu'),
    fecha: (m, ahora) => sumarDias_(ahora, normalizar_(m[1]) === 'hoy' ? 0 : 1),
  },
  {
    re: new RegExp(PREFIJO_FECHA_ + '(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)' + FIN_FECHA_, 'iu'),
    fecha: (m, ahora) => {
      const objetivo = DIAS_.indexOf(normalizar_(m[1]));
      const delta = (objetivo - ahora.getDay() + 7) % 7 || 7; // "el viernes" dicho un viernes = el siguiente
      return sumarDias_(ahora, delta);
    },
  },
];

/** Extrae una fecha límite del texto de una tarea. Devuelve { fecha: Date|null, texto }. */
function parseFechaLimite_(texto, ahora) {
  ahora = ahora || new Date();
  for (const p of PATRONES_FECHA_) {
    const m = p.re.exec(texto);
    if (!m) continue;
    const fecha = p.fecha(m, ahora);
    if (!fecha) continue;
    const resto = (texto.slice(0, m.index) + ' ' + texto.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return { fecha: fecha, texto: resto };
  }
  return { fecha: null, texto: String(texto).trim() };
}

/** "/agenda@MiBot trabajo semana" → { cmd: 'agenda', args: 'trabajo semana' } */
function parseComando_(texto) {
  const m = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(String(texto).trim());
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), args: (m[2] || '').trim() };
}

const ABREVIATURAS_PERFIL_ = { p: 'personal', t: 'trabajo' };

/** Si el primer argumento es un perfil (o su abreviatura p/t), lo separa: "t semana" → { perfil: 'trabajo', resto: 'semana' } */
function extraerPerfil_(args) {
  const partes = String(args || '').trim().split(/\s+/);
  const primero = normalizar_(partes[0]);
  const perfil = ABREVIATURAS_PERFIL_[primero] || primero;
  if (PERFILES.indexOf(perfil) >= 0) return { perfil: perfil, resto: partes.slice(1).join(' ') };
  return { perfil: null, resto: String(args || '').trim() };
}

/** "mercado #nu" → { cuenta: 'nu', resto: 'mercado' } */
function extraerCuenta_(texto) {
  const m = /(?:^|\s)#([\p{L}\d_-]+)/u.exec(texto);
  if (!m) return { cuenta: null, resto: String(texto).trim() };
  const resto = (texto.slice(0, m.index) + ' ' + texto.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  return { cuenta: m[1], resto: resto };
}

/** Quita prefijos de respuesta/reenvío: "RV: Fwd: Cotización" → "Cotización" */
function asuntoLimpio_(asunto) {
  return String(asunto || '(sin asunto)').replace(/^\s*((re|rv|fw|fwd|reenviar|enc)\s*:\s*)+/i, '').trim() || '(sin asunto)';
}

function limpiarDescripcion_(s) {
  return String(s || '')
    .replace(/^(?:(?:en|de|por|para|a|el|la|un|una)\s+)+/iu, '')
    .replace(/[\s.,;:!-]+$/u, '')
    .trim();
}

/** Argumentos de /gasto o /ingreso: "50000 mercado #nu" → { monto, descripcion, cuenta } */
function parseMovimiento_(args) {
  const c = extraerCuenta_(args);
  const m = parseMonto_(c.resto);
  if (!m) return null;
  return { monto: m.monto, descripcion: limpiarDescripcion_(m.resto), cuenta: c.cuenta };
}

const LIBRE_GASTO_ = /^(?:gast[eé]|pagu[eé]|compr[eé]|gasto|pago)(?=\s|$)/iu;
const LIBRE_INGRESO_ = /^(?:recib[ií]|me\s+pagaron|me\s+consignaron|me\s+transfirieron|ingreso|cobr[eé])(?=\s|$)/iu;
const LIBRE_TAREA_ = /^(?:tarea|pendiente|recordar|recu[eé]rdame)\s*[:-]?\s+/iu;

/**
 * Mensajes sin comando: "gasté 50 mil en almuerzo", "me pagaron 2 millones nómina", "tarea: llamar a Juan",
 * o un reporte de saldos: "tengo 80 mil en efectivo y debo 950 mil en la tarjeta Falabella".
 * `extras` son nombres de bancos de las cuentas del usuario, para reconocerlas aunque no estén en ENTIDADES_.
 */
function parseTextoLibre_(texto, extras) {
  const t = String(texto || '').trim();
  let m;
  if ((m = LIBRE_TAREA_.exec(t))) {
    const resto = t.slice(m[0].length).trim();
    return resto ? { tipo: 'tarea', texto: resto } : null;
  }
  const tipo = LIBRE_GASTO_.test(t) ? 'gasto' : LIBRE_INGRESO_.test(t) ? 'ingreso' : null;
  if (!tipo) {
    const saldos = parseSaldosLibre_(t, extras);
    return saldos ? { tipo: 'saldos', items: saldos.items, sinAsignar: saldos.sinAsignar } : null;
  }
  const sinVerbo = t.replace(tipo === 'gasto' ? LIBRE_GASTO_ : LIBRE_INGRESO_, '').trim();
  const mov = parseMovimiento_(sinVerbo);
  if (!mov) return null;
  return { tipo: tipo, monto: mov.monto, descripcion: mov.descripcion, cuenta: mov.cuenta };
}

// ── Reporte de saldos en texto libre ─────────────────────────────────────────

const ENTIDADES_ = [
  { id: 'efectivo', nombre: 'Efectivo', claves: ['efectivo', 'cash', 'billetera'] },
  { id: 'nequi', nombre: 'Nequi', claves: ['nequi'] },
  { id: 'daviplata', nombre: 'Daviplata', claves: ['daviplata'] },
  { id: 'bancolombia', nombre: 'Bancolombia', claves: ['bancolombia'] },
  { id: 'davivienda', nombre: 'Davivienda', claves: ['davivienda'] },
  { id: 'nu', nombre: 'Nu', claves: ['nu', 'nubank'] },
  { id: 'rappi', nombre: 'Rappi', claves: ['rappi', 'rappipay', 'rappicard'] },
  { id: 'bbva', nombre: 'BBVA', claves: ['bbva'] },
  { id: 'bogota', nombre: 'Banco de Bogotá', claves: ['banco de bogota', 'bogota'] },
  { id: 'occidente', nombre: 'Banco de Occidente', claves: ['banco de occidente', 'occidente'] },
  { id: 'popular', nombre: 'Banco Popular', claves: ['banco popular'] },
  { id: 'avvillas', nombre: 'AV Villas', claves: ['av villas', 'avvillas'] },
  { id: 'colpatria', nombre: 'Scotiabank Colpatria', claves: ['colpatria', 'scotiabank'] },
  { id: 'falabella', nombre: 'Falabella', claves: ['falabella'] },
  { id: 'itau', nombre: 'Itaú', claves: ['itau'] },
  { id: 'cajasocial', nombre: 'Caja Social', claves: ['caja social'] },
  { id: 'lulo', nombre: 'Lulo Bank', claves: ['lulo', 'lulo bank'] },
  { id: 'movii', nombre: 'Movii', claves: ['movii'] },
  { id: 'uala', nombre: 'Ualá', claves: ['uala'] },
];

// Debe aparecer alguna de estas palabras para tratar el mensaje como reporte de saldos.
const SALDO_CLAVE_ = /(?:^|[^a-z])(tengo|tiene|hay|queda|quedan|restante|saldo|saldos|debo|deuda|dinero|disponible|plata)(?![a-z])/;
const DEUDA_ = /(?:^|[^a-z])(debo|deuda|debe|tarjeta de credito|tarjetas de credito|tc|credito)(?![a-z])/;
const VERBO_ = /(?:^|[^a-z])(tengo|debo|hay|queda|quedan)(?![a-z])/;
const CONECTOR_LISTA_ = /^[\s,]*(?:(?:y|e|la|el|las|los|mi|mis|en|de|del|tarjeta|tarjetas|credito|cuenta|cuentas|ahorros|tc)[\s,]*)*$/;
const MONTOS_GLOBAL_ = /(\$\s?)?(\d[\d.,]*)(\s*(?:k|millon(?:es)?|mm|palos?|mil|lucas?))?(?![a-z\d])|(?:^|[^a-z])(cero)(?![a-z])/g;

/** Minúsculas y sin tildes, conservando la longitud (para que los índices coincidan con el original). */
function normalizarIgualLargo_(s) {
  return Array.from(String(s).toLowerCase(), (c) => c.normalize('NFD').charAt(0)).join('');
}

function contarPalabras_(s) {
  return (s.match(/[a-z]+/g) || []).length;
}

function buscarMenciones_(n, entidades) {
  const menciones = [];
  entidades.forEach((ent) => {
    ent.claves.forEach((clave) => {
      const re = new RegExp('(^|[^a-z0-9])' + clave.replace(/\s+/g, '\\s+') + '(?![a-z0-9])', 'g');
      let m;
      while ((m = re.exec(n))) {
        const inicio = m.index + m[1].length;
        menciones.push({ ent: ent, inicio: inicio, fin: m.index + m[0].length });
      }
    });
  });
  // Coincidencia aproximada para errores de tipeo ("daviviend" → davivienda).
  const re = /[a-z]{5,}/g;
  let w;
  while ((w = re.exec(n))) {
    const palabra = w[0];
    const inicio = w.index;
    if (menciones.some((x) => inicio < x.fin && inicio + palabra.length > x.inicio)) continue;
    const ent = entidades.find((e) => e.claves.some((c) => c.length >= 6 && !/\s/.test(c) && (c.startsWith(palabra) || palabra.startsWith(c))));
    if (ent) menciones.push({ ent: ent, inicio: inicio, fin: inicio + palabra.length });
  }
  // Si dos menciones se cruzan ("banco de bogota" y "bogota"), queda la más larga.
  menciones.sort((a, b) => a.inicio - b.inicio || b.fin - a.fin);
  return menciones.filter((m, i) => !menciones.some((o, j) => j !== i && o.inicio <= m.inicio && o.fin >= m.fin && o.fin - o.inicio > m.fin - m.inicio));
}

function buscarMontos_(n) {
  const montos = [];
  let m;
  MONTOS_GLOBAL_.lastIndex = 0;
  while ((m = MONTOS_GLOBAL_.exec(n))) {
    if (m[4]) {
      const inicio = m.index + m[0].indexOf('cero');
      montos.push({ valor: 0, inicio: inicio, fin: inicio + 4 });
      continue;
    }
    const valor = parseNumeroCOP_(m[2]) * multiplicador_(m[3] && m[3].trim());
    if (isFinite(valor)) montos.push({ valor: Math.round(valor), inicio: m.index, fin: m.index + m[0].length });
  }
  return montos;
}

/**
 * Interpreta un reporte de saldos y devuelve { items: [{ entidad, monto, deuda }], sinAsignar } o null.
 * Cada monto se asigna hacia adelante si va seguido de "en/de" ("0 pesos en nequi y daviplata")
 * o, si no, a la cuenta o lista de cuentas que lo precede ("efectivo 80.000").
 */
function parseSaldosLibre_(texto, extras) {
  const n = normalizarIgualLargo_(texto);
  if (!SALDO_CLAVE_.test(n)) return null;

  const entidades = ENTIDADES_.slice();
  (extras || []).forEach((nombre) => {
    const clave = normalizar_(nombre);
    if (clave && !entidades.some((e) => e.id === clave || e.claves.indexOf(clave) >= 0)) {
      entidades.push({ id: clave, nombre: String(nombre), claves: [clave] });
    }
  });

  const menciones = buscarMenciones_(n, entidades);
  const montos = buscarMontos_(n);
  if (!menciones.length || !montos.length) return null;

  const tokens = menciones.map((m) => Object.assign({ tipo: 'cuenta' }, m))
    .concat(montos.map((m) => Object.assign({ tipo: 'monto' }, m)))
    .sort((a, b) => a.inicio - b.inicio);

  // Extiende una lista de cuentas unidas por comas, "y", "la tarjeta de"...
  const lista = (desde, paso) => {
    const grupo = [tokens[desde]];
    for (let i = desde + paso; i >= 0 && i < tokens.length; i += paso) {
      const t = tokens[i];
      const previo = grupo[grupo.length - 1];
      if (t.tipo !== 'cuenta' || t.asignado) break;
      const hueco = paso > 0 ? n.slice(previo.fin, t.inicio) : n.slice(t.fin, previo.inicio);
      if (!CONECTOR_LISTA_.test(hueco)) break;
      grupo.push(t);
    }
    return grupo;
  };

  const asignaciones = [];
  tokens.forEach((tok, idx) => {
    if (tok.tipo !== 'monto') return;
    let grupo = null;
    const sig = tokens[idx + 1];
    const ant = tokens[idx - 1];
    const haciaAdelante = /^\s*(?:pesos|cop)?\s*(?:en|de|para)(?![a-z])/.test(n.slice(tok.fin));
    if (haciaAdelante && sig && sig.tipo === 'cuenta' && !sig.asignado) {
      const hueco = n.slice(tok.fin, sig.inicio);
      if (contarPalabras_(hueco) <= 6 && !VERBO_.test(hueco)) grupo = lista(idx + 1, 1);
    }
    if (!grupo && ant && ant.tipo === 'cuenta' && !ant.asignado && contarPalabras_(n.slice(ant.fin, tok.inicio)) <= 4) {
      grupo = lista(idx - 1, -1);
    }
    if (!grupo) return;
    grupo.forEach((g) => (g.asignado = true));
    tok.asignado = true;
    asignaciones.push({ monto: tok, grupo: grupo });
  });

  const items = [];
  asignaciones.forEach((a) => {
    const inicio = Math.min(a.monto.inicio, ...a.grupo.map((g) => g.inicio));
    const fin = Math.max(a.monto.fin, ...a.grupo.map((g) => g.fin));
    const previo = tokens.filter((t) => t.fin <= inicio).pop();
    const contexto = n.slice(previo ? previo.fin : 0, fin);
    const deuda = DEUDA_.test(contexto);
    a.grupo.forEach((g) => {
      // Si la misma cuenta aparece dos veces, vale la última mención.
      const existente = items.findIndex((x) => x.entidad.id === g.ent.id && x.deuda === deuda);
      if (existente >= 0) items.splice(existente, 1);
      items.push({ entidad: g.ent, monto: a.monto.valor, deuda: deuda });
    });
  });
  if (!items.length) return null;

  const sinAsignar = tokens
    .filter((t) => !t.asignado)
    .map((t) => String(texto).slice(t.inicio, t.fin).trim());
  return { items: items, sinAsignar: sinAsignar };
}
