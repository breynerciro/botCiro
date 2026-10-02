/**
 * Reuniones de cada perfil. Dos fuentes:
 *   - Calendar directo (CAL_<perfil> = "primary" o un ID de calendario compartido con esta cuenta).
 *   - Satélite (CAL_<perfil> vacío o "satelite"): eventos que envía el script instalado en la otra cuenta.
 * Ambas se convierten a { id, titulo, inicio, fin, todoElDia, enlace }.
 */

const MINUTOS_SYNC_VIEJA_ = 30;

function fuenteCalendario_(perfil) {
  const id = getConfig_('CAL_' + perfil, perfil === 'personal' ? 'primary' : 'satelite');
  return normalizar_(id) === 'satelite' ? 'satelite' : id;
}

function extraerEnlace_(texto) {
  const m = /https:\/\/(?:meet\.google\.com\/[a-z0-9-]+|[\w.-]*zoom\.us\/j\/\S+|teams\.microsoft\.com\/l\/meetup-join\/\S+)/i.exec(texto || '');
  return m ? m[0].replace(/[)"'<>]+$/, '') : '';
}

function eventoPlano_(ev) {
  return {
    id: ev.getId() + '_' + ev.getStartTime().getTime(),
    titulo: ev.getTitle() || '(sin título)',
    inicio: ev.getStartTime(),
    fin: ev.getEndTime(),
    todoElDia: ev.isAllDayEvent(),
    enlace: extraerEnlace_((ev.getLocation() || '') + ' ' + (ev.getDescription() || '')),
  };
}

function rechazado_(ev) {
  try {
    return ev.getMyStatus() === CalendarApp.GuestStatus.NO;
  } catch (e) {
    return false;
  }
}

/** Eventos del perfil que se cruzan con [desde, hasta), o null si no hay fuente disponible. */
function eventosPerfil_(perfil, desde, hasta) {
  const fuente = fuenteCalendario_(perfil);
  if (fuente === 'satelite') {
    if (!prop_('SYNC_ULTIMA_' + perfil)) return null;
    return leer_('Eventos')
      .filter((e) => e.perfil === perfil && new Date(e.inicio) < hasta && new Date(e.fin) > desde)
      .map((e) => ({
        id: e.id,
        titulo: e.titulo,
        inicio: new Date(e.inicio),
        fin: new Date(e.fin),
        todoElDia: e.todo_el_dia === true || e.todo_el_dia === 'TRUE',
        enlace: e.enlace,
      }))
      .sort((a, b) => a.inicio - b.inicio);
  }
  const cal = fuente === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(fuente);
  if (!cal) return null;
  return cal.getEvents(desde, hasta).filter((ev) => !rechazado_(ev)).map(eventoPlano_);
}

function lineaEvento_(ev, conDia) {
  const titulo = esc_(ev.titulo);
  const dia = conDia ? fmtDia_(ev.inicio, 'dd') + ' ' : '';
  if (ev.todoElDia) return `• ${dia}Todo el día · ${titulo}`;
  const horas = fmtFecha_(ev.inicio, 'HH:mm') + '–' + fmtFecha_(ev.fin, 'HH:mm');
  return `• ${dia}${horas} ${titulo}` + (ev.enlace ? ` · <a href="${esc_(ev.enlace)}">unirse</a>` : '');
}

function rangoAgenda_(arg) {
  const hoy = inicioDia_(new Date());
  const a = { h: 'hoy', m: 'manana', s: 'semana' }[normalizar_(arg)] || normalizar_(arg);
  if (a === 'manana') return { desde: sumarDias_(hoy, 1), hasta: sumarDias_(hoy, 2), nombre: 'Mañana', conDia: false };
  if (a === 'semana') return { desde: new Date(), hasta: sumarDias_(hoy, 7), nombre: 'Próximos 7 días', conDia: true };
  return { desde: hoy, hasta: sumarDias_(hoy, 1), nombre: 'Hoy', conDia: false };
}

/** Aviso si el satélite de un perfil lleva rato sin sincronizar. */
function avisoSync_(perfil) {
  if (fuenteCalendario_(perfil) !== 'satelite') return '';
  const ultima = Number(prop_('SYNC_ULTIMA_' + perfil) || 0);
  const minutos = Math.round((Date.now() - ultima) / 60000);
  return minutos > MINUTOS_SYNC_VIEJA_ ? `<i>⚠️ Última sincronización de ${perfil}: hace ${minutos} min</i>` : '';
}

/** Líneas de agenda de un perfil (usadas por /agenda y el resumen). */
function lineasAgenda_(perfil, rango) {
  const evs = eventosPerfil_(perfil, rango.desde, rango.hasta);
  if (evs === null) {
    return fuenteCalendario_(perfil) === 'satelite'
      ? [`<i>El satélite de ${perfil} aún no ha sincronizado. Revisa la sección "Cuenta de trabajo" del README.</i>`]
      : [`<i>Sin acceso al calendario de ${perfil}; revisa CAL_${perfil} en Config.</i>`];
  }
  const lineas = evs.map((ev) => lineaEvento_(ev, rango.conDia));
  const aviso = avisoSync_(perfil);
  if (aviso) lineas.push(aviso);
  return lineas;
}

function cmdAgenda_(args, perfil) {
  const rango = rangoAgenda_(args);
  const perfiles = perfil ? [perfil] : perfilesActivos_();
  const bloques = perfiles.map((p) => {
    const l = lineasAgenda_(p, rango);
    return `<b>${p.toUpperCase()}</b>\n` + (l.length ? l.join('\n') : '<i>Sin reuniones</i>');
  });
  return `📅 <b>${rango.nombre}</b>\n\n` + bloques.join('\n\n');
}

/** Trigger: avisa las reuniones que empiezan en los próximos MINUTOS_RECORDATORIO minutos. */
function revisarReuniones() {
  try {
    const minutos = Number(getConfig_('MINUTOS_RECORDATORIO', '10')) || 10;
    const ahora = new Date();
    const hasta = new Date(ahora.getTime() + minutos * 60000);
    const cache = cache_();
    perfilesActivos_().forEach((p) => {
      (eventosPerfil_(p, ahora, hasta) || []).forEach((ev) => {
        if (ev.todoElDia || ev.inicio < ahora) return;
        const clave = 'rec_' + Utilities.base64EncodeWebSafe(String(ev.id)).slice(0, 200);
        if (cache.get(clave)) return;
        cache.put(clave, '1', 21600);
        const faltan = Math.max(1, Math.round((ev.inicio - ahora) / 60000));
        const teclado = ev.enlace ? { inline_keyboard: [[{ text: '🔗 Unirse a la reunión', url: ev.enlace }]] } : null;
        enviar_(`⏰ En ${faltan} min (${p}): <b>${esc_(ev.titulo)}</b>`, null, teclado);
      });
    });
  } catch (err) {
    registrarError_('revisarReuniones', err);
  }
}

/**
 * Crea un evento en el calendario del perfil (solo lectura el del satélite).
 * `fechaTxt` y `horaTxt` vienen del modelo; si no, se leen de la frase del título.
 */
function crearEventoDatos_(titulo, fechaTxt, horaTxt, duracion, perfil) {
  const fuente = fuenteCalendario_(perfil);
  if (fuente === 'satelite') {
    return `ℹ️ El calendario de <b>${esc_(perfil)}</b> lo administra el satélite (solo lectura). Créalo en tu calendario de trabajo y aparecerá en /agenda.`;
  }
  const frase = [titulo, fechaTxt].filter(Boolean).join(' ');
  if (!String(frase).trim()) return '¿Qué evento creo? Ej: <code>/reunion Comité el jueves 3pm</code>..';
  const pf = parseFechaLimite_(frase, new Date());
  const fecha = pf.fecha || inicioDia_(new Date());
  let base = pf.texto || String(titulo).trim();

  let hora = null;
  let minuto = 0;
  const fuenteHora = horaTxt || base;
  const ph = parseHora_(fuenteHora, null);
  if (ph.hora !== null && ph.hora !== undefined) {
    hora = ph.hora;
    minuto = ph.minuto || 0;
    if (!horaTxt) base = ph.texto;
  }
  if (hora === null) {
    return '❓ ¿A qué hora es? Ej: <code>/reunion ' + esc_(base || titulo) + ' 3pm</code>. (hora formato 3pm o 15:00)';
  }

  const dur = Number(duracion) || Number(getConfig_('DURACION_REUNION', '60')) || 60;
  const inicio = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), hora, minuto);
  const fin = new Date(inicio.getTime() + dur * 60000);
  const cal = fuente === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(fuente);
  if (!cal) return `No encuentro el calendario de ${esc_(perfil)}; revisa <code>CAL_${esc_(perfil)}</code> en Config.`;
  const nombre = base || String(titulo).trim();
  cal.createEvent(nombre, inicio, fin);
  return `📅 Creado: <b>${esc_(nombre)}</b> · ${fmtDia_(inicio)} ${fmtFecha_(inicio, 'HH:mm')}–${fmtFecha_(fin, 'HH:mm')} (${esc_(perfil)})`;
}

/** /reunion [perfil] Comité el jueves 3pm */
function crearEventoComando_(args, perfil) {
  return crearEventoDatos_(String(args || '').trim(), null, null, null, perfil);
}
