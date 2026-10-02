/**
 * Pendientes creados por chat, detectados en correos (Correos.js) o asignados en Jira (Jira.js).
 */

function crearTarea_(texto, perfil) {
  if (!String(texto || '').trim()) return 'Uso: <code>/tarea [perfil] texto [hoy|mañana|viernes|15/10]</code>';
  const f = parseFechaLimite_(texto, new Date());
  const filas = leer_('Pendientes');
  const tarea = {
    id: siguienteId_('Pendientes', filas),
    perfil: perfil,
    texto: f.texto,
    fecha_limite: f.fecha || '',
    estado: 'abierto',
    fuente: 'chat',
    creado: new Date(),
  };
  agregar_('Pendientes', tarea);
  return `📝 #${tarea.id} (${perfil}) ${esc_(tarea.texto)}` + (f.fecha ? ` · vence ${fmtDia_(f.fecha)}` : '');
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
    vence = ` <i>(${f < hoy ? 'venció ' : ''}${fmtFecha_(f, 'dd/MM')})</i>`;
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
