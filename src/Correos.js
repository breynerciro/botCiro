/**
 * Análisis automático de correos de ambas cuentas.
 *
 *   Gmail personal (escanearCorreosPersonales_) ─┐
 *   Gmail trabajo (satélite → encolarCorreos_) ──┴→ pestaña Correos (estado "cola")
 *     → procesarColaCorreos_: reglas (Clasificador.js) → Gemini solo para personales ambiguos (IA.js)
 *     → acción: pendiente + aviso | aviso | resumen diario | omitir
 *
 * El cuerpo del correo se guarda solo mientras está en cola y se borra al procesarlo.
 */

const MAX_IA_POR_EJECUCION_ = 12;
const MAX_INTENTOS_IA_ = 3;
const LARGO_CUERPO_ = 4000;
const CONSULTA_BANDEJA_ = 'in:inbox -category:promotions -category:social -from:me';

function opcionesClasificador_() {
  return {
    ignorar: listaConfig_(getConfig_('IGNORAR_REMITENTES', '')),
    importantes: listaConfig_(getConfig_('IMPORTANTES_TRABAJO', '')),
    avisarDirectos: normalizar_(getConfig_('AVISAR_DIRECTOS_TRABAJO', 'si')) === 'si',
    iaActiva: true, // la disponibilidad real de Gemini se revisa al procesar
  };
}

/** Agrega correos a la cola, sin duplicar por id de mensaje. */
function encolarCorreos_(perfil, lista) {
  if (!lista || !lista.length) return 0;
  const vistos = new Set(leer_('Correos').map((c) => String(c.id)));
  let n = 0;
  lista.forEach((m) => {
    const id = String(m.id);
    if (vistos.has(id)) return;
    vistos.add(id);
    agregar_('Correos', {
      id: id,
      perfil: perfil,
      fecha: m.fecha ? new Date(m.fecha) : new Date(),
      remitente: String(m.de || '').slice(0, 200),
      asunto: String(m.asunto || '').slice(0, 300),
      estado: 'cola',
      intentos: 0,
      directo: Boolean(m.directo),
      lista_baja: Boolean(m.listaBaja),
      cuerpo: String(m.cuerpo || '').slice(0, LARGO_CUERPO_),
      hilo: m.hilo || '',
    });
    n++;
  });
  return n;
}

/** Lee los correos nuevos de la bandeja personal desde la última revisión. */
function escanearCorreosPersonales_() {
  const inicio = Date.now();
  const desde = Number(prop_('CORREOS_DESDE_personal') || 0);
  if (!desde) {
    // Primera ejecución: no se procesa el histórico, solo lo que llegue desde ahora.
    setProp_('CORREOS_DESDE_personal', inicio);
    return 0;
  }
  const despuesDe = Math.floor(desde / 1000) - 3600; // margen de 1 h; los duplicados se descartan por id
  const yo = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const lista = [];
  GmailApp.search(`${CONSULTA_BANDEJA_} after:${despuesDe}`, 0, 50).forEach((hilo) => {
    hilo.getMessages().forEach((m) => {
      if (m.getDate().getTime() < desde - 3600000) return;
      if (String(m.getFrom()).toLowerCase().indexOf(yo) >= 0) return;
      lista.push({
        id: m.getId(),
        hilo: hilo.getId(),
        de: m.getFrom(),
        asunto: m.getSubject(),
        fecha: m.getDate(),
        cuerpo: m.getPlainBody(),
        listaBaja: Boolean(m.getHeader('List-Unsubscribe')),
        directo: String(m.getTo() || '').toLowerCase().indexOf(yo) >= 0,
      });
    });
  });
  const n = encolarCorreos_('personal', lista);
  setProp_('CORREOS_DESDE_personal', inicio);
  return n;
}

function mensajeDeFila_(c) {
  const dominioDe = (String(c.remitente).match(/@([\w.-]+)/) || [])[1] || '';
  const dominioMio = (String(prop_('SYNC_CUENTA_' + c.perfil) || '').match(/@([\w.-]+)/) || [])[1] || '';
  return {
    perfil: c.perfil,
    de: c.remitente,
    asunto: c.asunto,
    cuerpo: c.cuerpo,
    fecha: c.fecha,
    listaBaja: c.lista_baja === true || c.lista_baja === 'TRUE',
    directo: c.directo === true || c.directo === 'TRUE',
    mismoDominio: Boolean(dominioDe && dominioMio && normalizar_(dominioDe) === normalizar_(dominioMio)),
  };
}

const ICONO_PRIORIDAD_ = { alta: '🔴', media: '🟡', baja: '⚪' };

/** Clasifica un correo de la cola: reglas y, si hace falta, Gemini. Devuelve { res, origen } o null para dejarlo en cola. */
function clasificarFila_(c, opciones, estadoIA) {
  const msg = mensajeDeFila_(c);
  const res = clasificarPorReglas_(msg, opciones, new Date());
  if (res.accion !== 'ia') return { res: res, origen: 'regla:' + res.regla };
  if (!estadoIA.disponible) return { res: Object.assign(res, { categoria: 'informativo', accion: 'resumen' }), origen: 'sin_ia' };
  if (estadoIA.cuotaAgotada || estadoIA.usos >= MAX_IA_POR_EJECUCION_) return null;
  try {
    if (estadoIA.usos > 0) Utilities.sleep(Number(getConfig_('GEMINI_PAUSA_MS', '4000')) || 4000);
    estadoIA.usos++;
    return { res: clasificarConIA_(msg), origen: 'ia' };
  } catch (err) {
    if (err && err.cuota) {
      estadoIA.cuotaAgotada = true;
      return null;
    }
    const intentos = (Number(c.intentos) || 0) + 1;
    if (intentos < MAX_INTENTOS_IA_) {
      conBloqueo_(() => guardarFila_('Correos', c, { intentos: intentos }));
      return null;
    }
    registrarError_('clasificarConIA_', err);
    return { res: Object.assign(res, { categoria: 'sin_analizar', accion: 'resumen' }), origen: 'error' };
  }
}

/** Crea el pendiente (si aplica, sin duplicar por hilo) y marca el correo como procesado. Va bajo bloqueo. */
function aplicarClasificacion_(c, res, origen) {
  let pendienteId = '';
  if (res.accion === 'pendiente' && res.tarea) {
    const pendientes = leer_('Pendientes');
    const ref = String(c.hilo || c.id);
    const existente = pendientes.find((t) => t.fuente === 'correo' && t.estado === 'abierto' && String(t.ref) === ref);
    if (existente) {
      pendienteId = existente.id; // respuesta en un hilo que ya tiene pendiente: solo se avisa
    } else {
      pendienteId = siguienteId_('Pendientes', pendientes);
      agregar_('Pendientes', {
        id: pendienteId,
        perfil: c.perfil,
        texto: res.tarea,
        fecha_limite: res.fecha_limite || '',
        estado: 'abierto',
        fuente: 'correo',
        ref: ref,
        creado: new Date(),
      });
    }
  }
  guardarFila_('Correos', c, {
    categoria: res.categoria,
    importante: res.accion === 'pendiente' || res.accion === 'aviso',
    prioridad: res.prioridad,
    resumen: res.resumen,
    monto: res.monto || '',
    fecha_limite: res.fecha_limite || '',
    accion: res.accion,
    origen: origen,
    estado: 'procesado',
    cuerpo: '',
    pendiente_id: pendienteId,
  });
  return pendienteId;
}

/** Procesa la cola: clasifica, crea pendientes y envía un solo aviso agrupado. */
function procesarColaCorreos_() {
  // Evita que dos ejecuciones (trigger y /revisar) procesen la misma cola a la vez.
  const cache = CacheService.getScriptCache();
  if (cache.get('procesando_cola')) return 0;
  cache.put('procesando_cola', '1', 300);
  try {
    const cola = leer_('Correos').filter((c) => c.estado === 'cola');
    if (!cola.length) return 0;
    const opciones = opcionesClasificador_();
    const estadoIA = { disponible: iaDisponible_(), usos: 0, cuotaAgotada: false };
    const avisos = [];
    let procesados = 0;

    cola.forEach((c) => {
      const r = clasificarFila_(c, opciones, estadoIA);
      if (!r) return;
      const pendienteId = conBloqueo_(() => aplicarClasificacion_(c, r.res, r.origen));
      if (r.res.accion === 'pendiente' || r.res.accion === 'aviso') {
        avisos.push({ perfil: c.perfil, res: r.res, pendienteId: pendienteId });
      }
      procesados++;
    });

    if (avisos.length && prop_('CHAT_ID')) enviar_(textoAvisos_(avisos));
    return procesados;
  } finally {
    cache.remove('procesando_cola');
  }
}

function textoAvisos_(avisos) {
  const lineas = avisos.map((a) => {
    let l = `${ICONO_PRIORIDAD_[a.res.prioridad] || '⚪'} <i>${a.perfil}</i> · ${esc_(a.res.resumen)}`;
    if (a.pendienteId) {
      l += `\n    → #${a.pendienteId} ${esc_(a.res.tarea || '')}`;
      if (a.res.fecha_limite) l += ` · vence ${fmtDia_(a.res.fecha_limite)}`;
    }
    return l;
  });
  return `📬 <b>Correos importantes</b>\n` + lineas.join('\n');
}

const ETIQUETAS_CATEGORIA_ = {
  extracto: '💳 Extractos',
  suscripcion: '🔁 Suscripciones y cobros',
  reunion: '📅 Reuniones',
  accion_requerida: '❗ Requieren acción',
  mensaje: '💬 Mensajes directos',
  finanzas: '💰 Finanzas',
  compra_envio: '📦 Compras y envíos',
  seguridad: '🔐 Seguridad',
  informativo: '📄 Informativos',
  boletin: '📰 Boletines',
  sin_analizar: '❔ Sin analizar',
};

/** Correos procesados en las últimas `horas`, agrupados por categoría (omitidos fuera). */
function lineasCorreos_(perfiles, horas, detallado) {
  const desde = Date.now() - horas * 3600000;
  const filas = leer_('Correos').filter(
    (c) => c.estado === 'procesado' && c.accion !== 'omitir' && perfiles.indexOf(c.perfil) >= 0 && new Date(c.fecha).getTime() >= desde
  );
  if (!filas.length) return [];
  const grupos = {};
  filas.forEach((c) => (grupos[c.categoria] = grupos[c.categoria] || []).push(c));
  const orden = Object.keys(ETIQUETAS_CATEGORIA_);
  return Object.keys(grupos)
    .sort((a, b) => (orden.indexOf(a) + 1 || 99) - (orden.indexOf(b) + 1 || 99))
    .map((cat) => {
      const lista = grupos[cat];
      const titulo = `${ETIQUETAS_CATEGORIA_[cat] || cat} (${lista.length})`;
      // Boletines e informativos solo se cuentan en el resumen; el resto se detalla.
      if (!detallado && (cat === 'boletin' || cat === 'informativo')) return titulo;
      const items = lista.slice(0, 6).map((c) => {
        const monto = c.monto ? ` · ${formatCOP_(c.monto)}` : '';
        return `  • ${esc_(String(c.resumen || c.asunto).slice(0, 100))}${monto}`;
      });
      if (lista.length > 6) items.push(`  <i>…y ${lista.length - 6} más</i>`);
      return titulo + '\n' + items.join('\n');
    });
}

function cmdCorreos_(perfil) {
  const perfiles = perfil ? [perfil] : PERFILES;
  const lineas = lineasCorreos_(perfiles, 24, true);
  if (!lineas.length) return '📭 No hay correos analizados en las últimas 24 horas.';
  return '📬 <b>Correos de las últimas 24 h</b>\n\n' + lineas.join('\n\n');
}

function cmdIgnorar_(args) {
  const valor = String(args || '').trim().toLowerCase();
  if (!valor) return 'Uso: <code>/ignorar boletines@tienda.com</code> o <code>/ignorar tienda.com</code>';
  const lista = listaConfig_(getConfig_('IGNORAR_REMITENTES', ''));
  if (lista.indexOf(valor) < 0) lista.push(valor);
  setConfig_('IGNORAR_REMITENTES', lista.join(', '));
  return `🔇 Ignoraré los correos de <b>${esc_(valor)}</b>.`;
}
