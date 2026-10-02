/**
 * Actualizaciones para quien usa botCiro como biblioteca (copia de la plantilla).
 *
 * Cómo se entera de que hay versión nueva: después de publicar, el autor ejecuta anunciarVersion()
 * en el editor de la biblioteca. Eso escribe ULTIMA_VERSION en las Script Properties de la
 * BIBLIOTECA, que todas las copias pueden leer (es el único dato que se lee de ese almacén compartido;
 * los datos de cada persona van siempre en ctx.props).
 *
 * La copia no puede cambiarse de versión sola (Google exige un proyecto de Cloud para eso), así que el
 * bot avisa una vez y guía los clics. Nunca se actualiza sin que la persona lo haga.
 */

/** Ejecutar en el editor de la BIBLIOTECA después de `npm run biblioteca:publicar`. */
function anunciarVersion() {
  const datos = { version: VERSION, numero: NUMERO_BIBLIOTECA, notas: NOTAS_VERSION_, fecha: new Date().toISOString() };
  PropertiesService.getScriptProperties().setProperty('ULTIMA_VERSION', JSON.stringify(datos));
  console.log('Anunciada: ' + JSON.stringify(datos));
}

// Novedades de esta versión (las ve cada persona en el aviso de actualización).
const NOTAS_VERSION_ = 'Instalación desde la hoja, /configurar en Telegram y gastos en texto natural.';

/** Última versión anunciada por el autor, o null (proyecto propio o sin anuncio). */
function ultimaVersion_() {
  if (!MODO_BIBLIOTECA_) return null;
  try {
    const d = JSON.parse(PropertiesService.getScriptProperties().getProperty('ULTIMA_VERSION') || 'null');
    return d && Number(d.numero) ? d : null;
  } catch (e) {
    return null;
  }
}

function hayActualizacion_() {
  const u = ultimaVersion_();
  return u && Number(u.numero) > NUMERO_BIBLIOTECA ? u : null;
}

function pasosActualizacion_(u) {
  return [
    `🆕 <b>Hay una versión nueva: ${esc_(u.version)}</b> (tienes ${esc_(VERSION)}).`,
    u.notas ? `<i>${esc_(u.notas)}</i>` : '',
    '',
    'Para instalarla (2 min, tu configuración y tus datos se conservan):',
    '1. Abre tu hoja → <b>Extensiones → Apps Script</b>.',
    `2. A la izquierda, en <b>Bibliotecas</b>, toca <b>BotCiro</b> → Versión <b>${Number(u.numero)}</b> → Guardar.`,
    '3. <b>Implementar → Gestionar implementaciones</b> → ✏️ → Versión: <b>Nueva versión</b> → Implementar.',
    '',
    'La dirección del bot no cambia. Al terminar, escribe /estado para confirmar.',
  ].filter((l, i) => l || i > 1).join('\n');
}

/** /actualizar */
function cmdActualizar_() {
  if (!MODO_BIBLIOTECA_) return `Versión ${esc_(VERSION)}. Este bot es un proyecto propio: se actualiza con <code>npm run push</code>.`;
  const u = hayActualizacion_();
  if (!u) return `✅ Tienes la última versión (${esc_(VERSION)}).`;
  return pasosActualizacion_(u);
}

/** Menú de la hoja → Actualizar… */
function guiaActualizacion_() {
  SpreadsheetApp.getUi().alert(String(cmdActualizar_()).replace(/<[^>]+>/g, ''));
}

/** Diario (scheduler): avisa una sola vez por versión nueva y migra la hoja tras actualizar. */
function revisarVersion_() {
  if (prop_('VERSION_INSTALADA') !== VERSION) {
    if (prop_('SPREADSHEET_ID')) setup(); // agrega claves de Config y columnas nuevas
    setProp_('VERSION_INSTALADA', VERSION);
  }
  const u = hayActualizacion_();
  if (!u || prop_('AVISO_VERSION') === String(u.numero) || !hayChats_()) return;
  setProp_('AVISO_VERSION', String(u.numero));
  enviar_(pasosActualizacion_(u));
}
