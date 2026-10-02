/**
 * Interpretación de correos de notificación bancaria. Funciones puras (probadas en Node).
 *
 * En lugar de un parser rígido por banco, se usa uno genérico basado en las frases
 * que usan los bancos colombianos ("Compraste", "Recibiste", "Transferiste"...).
 * Si un banco necesita reglas propias, se agrega `parser` en su entrada de BANCOS.
 */

const BANCOS = [
  { id: 'bancolombia', nombre: 'Bancolombia', remitentes: ['notificacionesbancolombia.com', 'bancolombia.com.co'] },
  { id: 'davivienda', nombre: 'Davivienda', remitentes: ['davivienda.com'] },
  { id: 'daviplata', nombre: 'Daviplata', remitentes: ['daviplata.com'] },
  { id: 'nequi', nombre: 'Nequi', remitentes: ['nequi.com.co'] },
  { id: 'nu', nombre: 'Nu', remitentes: ['nu.com.co'] },
  { id: 'bbva', nombre: 'BBVA', remitentes: ['bbva.com.co'] },
  { id: 'bogota', nombre: 'Banco de Bogotá', remitentes: ['bancodebogota.com.co'] },
  { id: 'occidente', nombre: 'Banco de Occidente', remitentes: ['bancooccidente.com.co'] },
  { id: 'popular', nombre: 'Banco Popular', remitentes: ['bancopopular.com.co'] },
  { id: 'avvillas', nombre: 'AV Villas', remitentes: ['avvillas.com.co'] },
  { id: 'colpatria', nombre: 'Scotiabank Colpatria', remitentes: ['colpatria.com', 'scotiabankcolpatria.com'] },
  { id: 'falabella', nombre: 'Falabella', remitentes: ['bancfalabella.com'] },
  { id: 'itau', nombre: 'Itaú', remitentes: ['itau.com.co'] },
  { id: 'cajasocial', nombre: 'Caja Social', remitentes: ['cajasocial.com.co'] },
  { id: 'lulo', nombre: 'Lulo Bank', remitentes: ['lulobank.com'] },
  { id: 'movii', nombre: 'Movii', remitentes: ['movii.co'] },
  { id: 'uala', nombre: 'Ualá', remitentes: ['uala.com.co', 'uala.co'] },
  { id: 'rappi', nombre: 'Rappi', remitentes: ['rappicard.co'] },
];

// Si tu banco no está aquí, suma su dominio (el mismo nombre de ENTIDADES_ en Parsing.js)
// y en unos minutos sus alertas empiezan a registrarse.

// La palabra clave que aparece primero en el texto define si es débito o crédito.
const CLAVES_MOVIMIENTO_ = [
  { re: /recibiste|te\s+transfirieron|transferencia\s+recibida|abono|consignaci[oó]n|reintegro|devoluci[oó]n/iu, tipo: 'credito', etiqueta: 'Recibido' },
  { re: /compraste|compra/iu, tipo: 'debito', etiqueta: 'Compra' },
  { re: /pagaste|pago/iu, tipo: 'debito', etiqueta: 'Pago' },
  { re: /transferiste|transferencia/iu, tipo: 'debito', etiqueta: 'Transferencia' },
  { re: /retiraste|retiro|avance/iu, tipo: 'debito', etiqueta: 'Retiro' },
];

const REGEX_VALOR_ = /(?:\$|COP)\s?(\d[\d.,]*)/iu;
const REGEX_ULTIMOS4_ = /(?:\*+|x{2,}|terminad[ao]\s+en\s*|finalizad[ao]\s+en\s*)(\d{4})(?!\d)/iu;
const REGEX_COMERCIO_ =
  /^\s*(?:en|a|de|por)\s+(.+?)(?=\s+(?:con|desde)\s|\s+el\s+\d|\s+a\s+las\s|\s+en\s+(?:tu|su)\s|\s+\d{1,2}[:/]|[,.;](?:\s|$)|\s*$)/iu;

function identificarBanco_(remitente) {
  const r = normalizar_(remitente);
  return BANCOS.find((b) => b.remitentes.some((d) => r.indexOf(d) >= 0)) || null;
}

function parseMovimientoGenerico_(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').slice(0, 2000);

  let clave = null;
  let posClave = Infinity;
  for (const c of CLAVES_MOVIMIENTO_) {
    const m = c.re.exec(t);
    if (m && m.index < posClave) {
      clave = c;
      posClave = m.index;
    }
  }
  if (!clave) return null;

  const tras = t.slice(posClave);
  const v = REGEX_VALOR_.exec(tras);
  if (!v) return null;
  const monto = Math.round(parseNumeroCOP_(v[1]));
  if (!isFinite(monto) || monto <= 0) return null;

  const despuesValor = tras.slice(v.index + v[0].length);
  const c = REGEX_COMERCIO_.exec(despuesValor);
  const comercio = c ? c[1].trim().slice(0, 40) : '';
  const u = REGEX_ULTIMOS4_.exec(t);

  return {
    tipo: clave.tipo,
    monto: monto,
    ultimos4: u ? u[1] : '',
    comercio: comercio,
    descripcion: comercio ? clave.etiqueta + ' · ' + comercio : clave.etiqueta,
  };
}

/**
 * Un extracto o estado de cuenta no es un movimiento: lo maneja Clasificador.js
 * (crea el pendiente de pago). Sin esta guardia, un "Pago total: $2.345.600"
 * se registraría como una compra de ese valor.
 */
function esExtracto_(texto) {
  return /extracto|estado de cuenta|fecha l[ií]mite de pago|pago total|total a pagar|valor a pagar|pago m[ií]nimo|resumen de (tu )?tarjeta/i.test(
    String(texto || '')
  );
}

/** Devuelve { banco, tipo, monto, ultimos4, comercio, descripcion } o null si el correo no es un movimiento. */
function parseCorreoBanco_(remitente, texto) {
  const banco = identificarBanco_(remitente);
  if (!banco) return null;
  if (esExtracto_(texto)) return null;
  const mov = (banco.parser || parseMovimientoGenerico_)(texto);
  if (!mov) return null;
  mov.banco = banco.id;
  mov.bancoNombre = banco.nombre;
  return mov;
}
