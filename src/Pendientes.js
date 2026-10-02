/**
 * Pendientes creados por chat, detectados en correos (Correos.js) o asignados en Jira (Jira.js).
 */

function crearTarea_(texto, perfil) {
  if (!String(texto || '').trim()) return 'Uso: <code>/tarea [perfil] texto [hoy|mañana|viernes|15/10] [10am]</code>';
  const ahora = new Date();
  const f = parseFechaLimite_(texto, ahora);
  const h = horaDeTarea_(f.texto);
  let fecha = f.fecha;
  if (h) {
    // "a las 10am" sin día: hoy si aún no pasó, si no mañana.
    fecha = new Date(fecha || inicioDia_(ahora));
    fecha.setHours(h.hora, h.minuto, 0, 0);
    if (!f.fecha && fecha <= ahora) fecha.setDate(fecha.getDate() + 1);
  }
  const filas = leer_('Pendientes');
  const tarea = {
    id: siguienteId_('Pendientes', filas),
    perfil: perfil,
    texto: h ? h.texto : f.texto,
    fecha_limite: fecha || '',
    estado: 'abierto',
    fuente: 'chat',
    creado: ahora,
  };
  if (!tarea.texto) return '¿Qué pendiente creo? Ej: <code>/tarea Llamar al banco el lunes 10am</code>';
  agregar_('Pendientes', tarea);
  return `📝 #${tarea.id} (${perfil}) ${esc_(tarea.texto)}` + (fecha ? ` · vence ${fmtVence_(fecha)}` : '');
}

/**
 * Hora de un pendiente, solo si es inequívoca: "10am", "3:30 pm", "15:00" o "a las 8".
 * Un número suelto no cuenta ("pagar 3 cuotas", "2.5 millones").
 */
function horaDeTarea_(texto) {
  const s = String(texto || '');
  const fin = '(?=\\s|$|[.,;!?])';
  const patrones = [
    new RegExp('(?:^|\\s)(?:a\\s+las?\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)' + fin, 'i'),
    new RegExp('(?:^|\\s)(?:a\\s+las?\\s+)?(\\d{1,2}):(\\d{2})()' + fin, 'i'),
    new RegExp('(?:^|\\s)a\\s+las?\\s+(\\d{1,2})()()' + fin, 'i'),
  ];
  for (const re of patrones) {
    const m = re.exec(s);
    if (!m) continue;
    let hora = +m[1];
    const minuto = m[2] ? +m[2] : 0;
    const suf = normalizar_(m[3] || '').replace(/[.\s]/g, '');
    if (minuto > 59 || hora > 23 || (suf && (hora < 1 || hora > 12))) continue;
    if (suf === 'pm' && hora < 12) hora += 12;
    else if (suf === 'am' && hora === 12) hora = 0;
    const resto = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return { hora: hora, minuto: minuto, texto: resto };
  }
  return null;
}

/** Un pendiente "tiene hora" si su fecha límite no es medianoche. */
function tieneHora_(fecha) {
  const d = new Date(fecha);
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}

function fmtVence_(fecha) {
  return fmtDia_(fecha) + (tieneHora_(fecha) ? ' ' + fmtFecha_(new Date(fecha), 'HH:mm') : '');
}

/** Cierra pendientes y crea uno igual (mismo texto y perfil) con nueva fecha/hora. */
function reprogramarTarea_(ids, cuando) {
  const lista = String(ids || '').match(/\d+/g);
  if (!lista) return 'Dime qué pendiente muevo. Ej: <i>"pasa el 3 para el lunes 10am"</i>.';
  if (!String(cuando || '').trim()) return `¿Para cuándo muevo el #${lista.join(', #')}? Ej: <i>"para el lunes 10am"</i>.`;
  const filas = leer_('Pendientes');
  return lista
    .map((id) => {
      const t = filas.find((f) => String(f.id) === id);
      if (!t) return `#${id} no existe`;
      if (t.estado === 'abierto') actualizar_('Pendientes', t._fila, { estado: 'hecho', cerrado: new Date() });
      return `✔️ #${id} cerrado\n` + crearTarea_(`${t.texto} ${cuando}`, t.perfil);
    })
    .join('\n');
}

function abiertos_(perfiles, filas) {
  return (filas || leer_('Pendientes'))
    .filter((t) => t.estado === 'abierto' && perfiles.indexOf(t.perfil) >= 0)
    .sort((a, b) => (a.fecha_limite ? new Date(a.fecha_limite) : Infinity) - (b.fecha_limite ? new Date(b.fecha_limite) : Infinity) || a.id - b.id);
}

function lineaPendiente_(t) {
  let marca = '▫️';
  let vence = '';
  if (t.fecha_limite) {
    const f = inicioDia_(new Date(t.fecha_limite));
    const hoy = inicioDia_(new Date());
    marca = f < hoy ? '⚠️' : f.getTime() === hoy.getTime() ? '📌' : '▫️';
    const hora = tieneHora_(t.fecha_limite) ? ' ' + fmtFecha_(new Date(t.fecha_limite), 'HH:mm') : '';
    vence = ` <i>(${f < hoy ? 'venció ' : ''}${fmtFecha_(f, 'dd/MM')}${hora})</i>`;
  }
  const origen = t.fuente === 'jira' ? ' 🎫' : t.fuente === 'correo' || t.fuente === 'gmail' || t.fuente === 'satelite' ? ' ✉️' : '';
  return `${marca} #${t.id} ${esc_(t.texto)}${vence}${origen}`;
}

function listarPendientes_(perfiles) {
  const filas = leer_('Pendientes');
  const bloques = perfiles
    .map((p) => {
      const lista = abiertos_([p], filas);
      return lista.length ? `<b>${p.toUpperCase()}</b> (${lista.length})\n${lista.map(lineaPendiente_).join('\n')}` : '';
    })
    .filter(Boolean);
  if (!bloques.length) return '🎉 No tienes pendientes abiertos.';
  return '✅ <b>Pendientes</b>\n\n' + bloques.join('\n\n') + '\n\nCierra con <code>/hecho 3</code>';
}

function completarTarea_(args) {
  const ids = String(args).match(/\d+/g);
  if (!ids) return 'Uso: <code>/hecho 3</code> o <code>/hecho 3 5 8</code>';
  const filas = leer_('Pendientes');
  const resultado = ids.map((id) => {
    const t = filas.find((f) => String(f.id) === id);
    if (!t) return `#${id} no existe`;
    if (t.estado !== 'abierto') return `#${id} ya estaba cerrado`;
    actualizar_('Pendientes', t._fila, { estado: 'hecho', cerrado: new Date() });
    return `✔️ #${id} ${esc_(t.texto)}` + (t.fuente === 'jira' ? ' <i>(recuerda moverlo también en Jira)</i>' : '');
  });
  return resultado.join('\n');
}

/**
 * Proactividad: avisa los pendientes que vencen hoy o ya vencieron.
 * Cada tarea se avisa una sola vez (columna `avisado`), así que no hay spam.
 */
function avisarVencimientos() {
  try {
    if (normalizar_(getConfig_('AVISO_VENCIMIENTOS', 'si')) !== 'si') return;
    if (!hayChats_()) return;
    const hoy = inicioDia_(new Date());
    const porAvisar = abiertos_(PERFILES).filter(
      (t) =>
        t.fecha_limite &&
        !t.avisado &&
        (tieneHora_(t.fecha_limite) ? new Date(t.fecha_limite) <= new Date() : inicioDia_(new Date(t.fecha_limite)) <= hoy)
    );
    if (!porAvisar.length) return;

    const vencidos = porAvisar.filter((t) => inicioDia_(new Date(t.fecha_limite)) < hoy).length;
    const titulo = vencidos
      ? `⏰ <b>Pendientes vencidos y de hoy</b> (${porAvisar.length})`
      : `📌 <b>Pendientes que vencen hoy</b> (${porAvisar.length})`;
    const teclado = {
      inline_keyboard: porAvisar
        .map((t) => [{ text: `✅ Cerrar #${t.id}`, callback_data: `hecho:${t.id}` }])
        .concat([[{ text: '📌 Ver todos', callback_data: 'cmd:pendientes' }]]),
    };
    // Si el envío falla, la próxima ejecución vuelve a intentarlo (sigue sin `avisado`).
    enviar_(titulo + '\n' + porAvisar.map(lineaPendiente_).join('\n'), null, teclado);
    conBloqueo_(() => porAvisar.forEach((t) => guardarFila_('Pendientes', t, { avisado: new Date() })));
  } catch (err) {
    registrarError_('avisarVencimientos', err);
  }
}
