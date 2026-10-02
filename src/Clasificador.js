/**
 * Clasificación de correos por reglas (sin IA). Funciones puras, probadas en Node.
 *
 * Entrada: { perfil, de, asunto, cuerpo, listaBaja, directo, mismoDominio }
 * Salida:  { regla, categoria, accion, prioridad, resumen, tarea, fecha_limite, monto }
 *   accion: 'omitir' | 'resumen' | 'aviso' | 'pendiente' | 'ia'
 */

const EMISORES_TARJETA_ = [
  { nombre: 'Rappi', claves: ['rappi'] },
  { nombre: 'Falabella', claves: ['falabella'] },
  { nombre: 'Nu', claves: ['nu.com.co', 'nubank'] },
  { nombre: 'Colpatria', claves: ['colpatria', 'scotiabank'] },
  { nombre: 'Itaú', claves: ['itau'] },
];

const SERVICIOS_ = [
  'netflix', 'spotify', 'apple', 'itunes', 'google', 'youtube', 'amazon', 'primevideo', 'disney', 'hbo', 'max.com',
  'openai', 'chatgpt', 'anthropic', 'claude', 'microsoft', 'xbox', 'playstation', 'adobe', 'notion', 'canva',
  'dropbox', 'github', 'deezer', 'crunchyroll', 'paramount', 'smartfit', 'bodytech', 'uber', 'rappi', 'didi',
  'platzi', 'coursera', 'linkedin', 'icloud', 'figma', 'cursor', 'vercel',
];

const RE_EXTRACTO_ = /extracto|estado de cuenta|fecha l[ií]mite de pago|resumen de (tu )?tarjeta|factura de (tu )?tarjeta|tu tarjeta de cr[eé]dito.*(pagar|vence)/i;
const RE_PAGO_FALLIDO_ = /no (pudimos|fue posible) (procesar|cobrar)|pago (rechazado|fallido|declinado)|payment (failed|declined)|update your payment|actualiza tu (m[eé]todo|medio) de pago/i;
const RE_COBRO_ = /recibo|factura|renovaci[oó]n|se renovar[aá]|suscripci[oó]n|membres[ií]a|cobro|cargo|pago (recibido|realizado|procesado|exitoso)|receipt|invoice|your (payment|subscription|order|plan)|renewal|billing/i;
const RE_INVITACION_ = /^\s*(invitaci[oó]n( actualizada)?|updated invitation|invitation|nuevo evento|new event)\b/i;
const RE_CANCELACION_ = /^\s*(evento cancelado|canceled event|cancelled event|invitaci[oó]n cancelada)\b/i;
const RE_RESPUESTA_INVITACION_ = /^\s*(aceptad[oa]|rechazad[oa]|accepted|declined|tentative|tentativ[oa])\s*:/i;
const RE_URGENTE_ = /urgente|urgent|asap|importante|para hoy|aprobaci[oó]n|aprobar|vencimiento|requiere (tu|su) (respuesta|aprobaci[oó]n)|action required|acci[oó]n requerida/i;

const MESES_ = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function contieneAlguno_(texto, lista) {
  const t = normalizar_(texto);
  return lista.some((x) => x && t.indexOf(normalizar_(x)) >= 0);
}

function listaConfig_(valor) {
  return String(valor || '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "15/10/2026", "15-10", "15 de octubre de 2026", "15 oct" → Date (o null). */
function parseFechaTexto_(s, ahora) {
  ahora = ahora || new Date();
  let m = /(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/.exec(s);
  let dia, mes, anio;
  if (m) {
    dia = +m[1];
    mes = +m[2];
    anio = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
  } else {
    m = /(\d{1,2})\s+(?:de\s+)?([a-zA-ZáéíóúÁÉÍÓÚ]{3,})(?:\.?\s+(?:de\s+|del\s+)?(\d{4}))?/.exec(s);
    if (!m) return null;
    mes = MESES_.indexOf(normalizar_(m[2]).slice(0, 3)) + 1;
    if (!mes) return null;
    dia = +m[1];
    anio = m[3] ? +m[3] : null;
  }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  let f = new Date(anio || ahora.getFullYear(), mes - 1, dia);
  if (!anio && f < sumarDias_(ahora, -60)) f = new Date(ahora.getFullYear() + 1, mes - 1, dia);
  return f;
}

/** Valor que sigue a una etiqueta: "Pago mínimo: $123.456" → 123456 */
function montoTrasEtiqueta_(texto, etiqueta) {
  const m = new RegExp(etiqueta + '[^$\\d]{0,40}(?:\\$|COP)?\\s?(\\d[\\d.,]*)', 'i').exec(texto);
  if (!m) return null;
  const v = Math.round(parseNumeroCOP_(m[1]));
  return isFinite(v) && v > 0 ? v : null;
}

function primerMonto_(texto) {
  // Moneda local (COP) por defecto; detecta también dólares para convertirlos.
  const m = /(?:US\$|USD|COP|\$)\s?(\d[\d.,]*)/i.exec(texto || '');
  if (!m) return null;
  const moneda = /^(?:US\$|USD)/i.test(m[0]) ? 'USD' : 'COP';
  const v = parseNumeroCOP_(m[1]);
  if (!isFinite(v) || v <= 0) return null;
  return { valor: Math.round(v * 100) / 100, moneda: moneda };
}

/** Convierte a la moneda local (COP): los montos en USD se multiplican por Config TASA_USD. */
function aCOP_(valor, moneda, tasaUSD) {
  if (moneda === 'USD') return Math.round(valor * (Number(tasaUSD) || 4100));
  return Math.round(valor);
}

function emisorTarjeta_(de) {
  const banco = identificarBanco_(de);
  if (banco) return banco.nombre;
  const emisor = EMISORES_TARJETA_.find((e) => contieneAlguno_(de, e.claves));
  return emisor ? emisor.nombre : null;
}

function datosExtracto_(texto, ahora) {
  const total = montoTrasEtiqueta_(texto, '(?:pago total|total a pagar|valor total a pagar|saldo total|valor a pagar|total)');
  const minimo = montoTrasEtiqueta_(texto, 'pago m[ií]nimo');
  const mf = /(?:fecha l[ií]mite(?: de pago)?|p[aá]ga(?:la|lo)? antes del?|paga hasta el|vence el|fecha de pago)[^\d]{0,25}([^\n]{0,30})/i.exec(texto);
  return { total: total, minimo: minimo, fecha: mf ? parseFechaTexto_(mf[1], ahora) : null };
}

function nombreRemitente_(de) {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(de || '');
  return (m ? m[1] : String(de || '').replace(/[<>]/g, '')).trim();
}

function quitarPrefijoInvitacion_(asunto) {
  return String(asunto || '')
    .replace(RE_INVITACION_, '')
    .replace(RE_CANCELACION_, '')
    .replace(/^[\s:]+/, '')
    .trim();
}

/**
 * Aplica las reglas en orden. `opciones`: { ignorar: [..], importantes: [..], avisarDirectos: bool, iaActiva: bool }
 */
function clasificarPorReglas_(msg, opciones, ahora) {
  opciones = opciones || {};
  const de = msg.de || '';
  const asunto = msg.asunto || '';
  const cuerpo = msg.cuerpo || '';
  const texto = asunto + '\n' + cuerpo;
  const r = (regla, categoria, accion, extra) =>
    Object.assign({ regla: regla, categoria: categoria, accion: accion, prioridad: 'baja', resumen: asunto, tarea: null, fecha_limite: null, monto: null }, extra || {});

  if (/atlassian\.net|jira@/i.test(de)) return r('jira', 'jira', 'omitir');
  if (contieneAlguno_(de, opciones.ignorar || [])) return r('ignorado', 'ignorado', 'omitir');
  if (parseCorreoBanco_(de, texto)) return r('banco', 'banco', 'omitir'); // ya lo registra escanearBancos_

  const emisor = emisorTarjeta_(de);
  if (emisor && RE_EXTRACTO_.test(texto)) {
    const d = datosExtracto_(cuerpo || asunto, ahora);
    const monto = d.total || d.minimo;
    let tarea = `Pagar tarjeta ${emisor}`;
    if (d.total) tarea += ` ${formatCOP_(d.total)}`;
    if (d.minimo) tarea += ` (mínimo ${formatCOP_(d.minimo)})`;
    return r('extracto', 'extracto', 'pendiente', { prioridad: 'alta', resumen: `Extracto ${emisor}`, tarea: tarea, fecha_limite: d.fecha, monto: monto });
  }

  if (RE_RESPUESTA_INVITACION_.test(asunto)) return r('respuesta_invitacion', 'reunion', 'resumen');
  if (RE_CANCELACION_.test(asunto)) {
    return r('cancelacion', 'reunion', 'aviso', { prioridad: 'media', resumen: `Cancelada: ${quitarPrefijoInvitacion_(asunto)}` });
  }
  if (RE_INVITACION_.test(asunto)) {
    return r('invitacion', 'reunion', 'aviso', { prioridad: 'media', resumen: `Invitación: ${quitarPrefijoInvitacion_(asunto)}` });
  }

  if (RE_PAGO_FALLIDO_.test(texto)) {
    return r('pago_fallido', 'suscripcion', 'aviso', { prioridad: 'alta', resumen: `Pago rechazado: ${nombreRemitente_(de)} · ${asunto}` });
  }

  if (contieneAlguno_(de, SERVICIOS_) && RE_COBRO_.test(texto)) {
    const pm = primerMonto_(texto);
    const monto = pm ? aCOP_(pm.valor, pm.moneda, opciones.tasaUSD) : null;
    // Un monto en otra moneda se muestra convertido a la moneda local (COP).
    const nota = pm && pm.moneda === 'USD' ? ` · US$${Number.isInteger(pm.valor) ? pm.valor : pm.valor.toFixed(2)} ≈ ${formatCOP_(monto)}` : '';
    return r('suscripcion', 'suscripcion', 'resumen', { resumen: `${nombreRemitente_(de)}: ${asunto}${nota}`, monto: monto });
  }

  if (contieneAlguno_(de, opciones.importantes || [])) {
    return r('remitente_importante', 'accion_requerida', 'pendiente', {
      prioridad: 'alta',
      resumen: `${nombreRemitente_(de)}: ${asunto}`,
      tarea: `Responder a ${nombreRemitente_(de)}: ${asuntoLimpio_(asunto)}`,
    });
  }

  if (msg.perfil === 'trabajo') {
    if (!msg.listaBaja && RE_URGENTE_.test(asunto)) {
      return r('urgente', 'accion_requerida', 'pendiente', {
        prioridad: 'alta',
        resumen: `${nombreRemitente_(de)}: ${asunto}`,
        tarea: `Revisar: ${asuntoLimpio_(asunto)} (${nombreRemitente_(de)})`,
      });
    }
    if (!msg.listaBaja && msg.directo && msg.mismoDominio && opciones.avisarDirectos) {
      return r('directo', 'mensaje', 'aviso', { prioridad: 'media', resumen: `${nombreRemitente_(de)}: ${asunto}` });
    }
    return r(msg.listaBaja ? 'boletin' : 'otro', msg.listaBaja ? 'boletin' : 'informativo', 'resumen');
  }

  if (msg.listaBaja) return r('boletin', 'boletin', 'resumen');
  return opciones.iaActiva ? r('ia', 'pendiente_ia', 'ia') : r('otro', 'informativo', 'resumen');
}

/** Tapa datos sensibles antes de enviar texto a un servicio externo. Conserva montos con formato ($2.345.600). */
function redactar_(texto) {
  return String(texto || '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]')
    .replace(/https?:\/\/\S+/g, '[enlace]')
    .replace(/\+?\d{2,3}[\s-]?\(?\d{3}\)?[\s-]\d{3}[\s-]?\d{4}\b/g, '[teléfono]')
    .replace(/\b\d{3}[\s-]\d{3}[\s-]\d{4}\b/g, '[teléfono]')
    .replace(/\d{6,}/g, '[número]');
}
