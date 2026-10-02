/**
 * Recepción de datos del satélite: el script instalado en otra cuenta de Google (la de trabajo)
 * que cada 10 min envía sus eventos de calendario y sus correos nuevos.
 *
 * De los correos de trabajo solo llegan remitente, asunto, fecha y banderas (directo, lista de correo):
 * nunca el cuerpo, y nunca pasan por la IA. Se clasifican con reglas en Correos.js.
 */

function respuestaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function recibirSync_(datos) {
  const perfil = normalizar_(datos.perfil);
  if (PERFILES.indexOf(perfil) < 0) throw new Error('Perfil inválido: ' + datos.perfil);

  sincronizarEventos_(perfil, datos.eventos || []);
  const correos = (datos.correos || []).map((c) => Object.assign({}, c, { cuerpo: '' }));
  const encolados = encolarCorreos_(perfil, correos);

  const primeraVez = !prop_('SYNC_ULTIMA_' + perfil);
  setProp_('SYNC_ULTIMA_' + perfil, Date.now());
  if (datos.cuenta) setProp_('SYNC_CUENTA_' + perfil, datos.cuenta);
  if (primeraVez && hayChats_()) enviar_(`🔗 Cuenta <b>${esc_(datos.cuenta || perfil)}</b> conectada al perfil ${perfil}.`);

  return { ok: true, eventos: (datos.eventos || []).length, correos: encolados };
}

function sincronizarEventos_(perfil, eventos) {
  const ahora = new Date();
  const otros = leer_('Eventos').filter((e) => e.perfil !== perfil);
  const propios = eventos.map((e) => ({
    perfil: perfil,
    id: e.id,
    titulo: e.titulo || '(sin título)',
    inicio: new Date(e.inicio),
    fin: new Date(e.fin),
    todo_el_dia: Boolean(e.todoElDia),
    enlace: e.enlace || extraerEnlace_(e.texto),
    actualizado: ahora,
  }));
  reescribir_('Eventos', otros.concat(propios));
}

/** Imprime el valor que debes poner como SYNC_URL en el script satélite. */
function datosSatelite() {
  setup();
  const url = prop_('WEBAPP_URL') || ScriptApp.getService().getUrl();
  console.log('Copia este valor como propiedad SYNC_URL en el satélite (no lo compartas):');
  console.log(url + '?sync=' + prop_('SYNC_SECRET'));
}
