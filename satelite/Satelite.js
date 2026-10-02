/**
 * Satélite del asistente (botCiro)
 *
 * Se instala en tu cuenta de Google de trabajo y cada 10 min envía al bot principal:
 *   - los eventos de tu calendario (desde ayer hasta DIAS_ADELANTE días adelante),
 *   - los correos nuevos de la bandeja: SOLO remitente, asunto, fecha y si te llegaron directo.
 *     El cuerpo nunca sale de esta cuenta; el bot los clasifica con reglas, sin IA.
 *
 * Instalación fácil (copia de la plantilla del satélite): menú 🔗 Satélite → Conectar y pegar el código
 * que da el bot en /configurar → Trabajo.
 * Instalación manual (proyecto standalone): propiedad SYNC_URL (la imprime datosSatelite() en el bot)
 * y ejecutar instalar() una vez.
 */

const PERFIL = 'trabajo';
const DIAS_ADELANTE = 14;
const MAX_HILOS = 50;
const CONSULTA_BANDEJA = 'in:inbox -category:promotions -category:social -from:me';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🔗 Satélite').addItem('Conectar', 'conectar').addItem('Sincronizar ahora', 'sincronizar').addToUi();
}

/** Menú → Conectar: pide el código del bot, lo guarda e instala el trigger. */
function conectar() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Conectar con tu asistente', 'Pega el código que te dio el bot en /configurar → Trabajo:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const codigo = r.getResponseText().trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec\?sync=[\w-]+$/.test(codigo)) {
    ui.alert('Ese código no se ve bien. Cópialo completo desde Telegram (empieza por https://script.google.com).');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('SYNC_URL', codigo);
  instalar();
  ui.alert('✅ Listo. En unos segundos te llega la confirmación por Telegram.');
}

function instalar() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'sincronizar')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(10).create();
  sincronizar();
  console.log('Satélite instalado: sincroniza cada 10 minutos.');
}

function sincronizar() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SYNC_URL');
  if (!url) throw new Error('Falta la propiedad SYNC_URL: ejecuta datosSatelite() en el bot principal y copia el valor.');

  const inicio = Date.now();
  const datos = {
    perfil: PERFIL,
    cuenta: Session.getEffectiveUser().getEmail(),
    eventos: leerEventos_(),
    correos: leerCorreosNuevos_(props),
  };
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(datos),
    muteHttpExceptions: true,
  });

  let r;
  try {
    r = JSON.parse(resp.getContentText());
  } catch (e) {
    throw new Error('Respuesta inesperada del bot (' + resp.getResponseCode() + '): ' + resp.getContentText().slice(0, 200));
  }
  if (!r.ok) throw new Error('El bot rechazó la sincronización: ' + r.error);

  // Solo se avanza la marca si el bot recibió los correos; si falla, se reenvían la próxima vez.
  props.setProperty('CORREOS_DESDE', String(inicio));
  console.log(`Sincronizado: ${datos.eventos.length} eventos, ${datos.correos.length} correos leídos, ${r.correos} nuevos en el bot.`);
}

function enlaceReunion_(texto) {
  const m = /https:\/\/(?:meet\.google\.com\/[a-z0-9-]+|[\w.-]*zoom\.us\/j\/\S+|teams\.microsoft\.com\/l\/meetup-join\/\S+)/i.exec(texto || '');
  return m ? m[0].replace(/[)"'<>]+$/, '') : '';
}

/** Solo se envía lo necesario: título, horario y link de la reunión (no la descripción). */
function leerEventos_() {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
  const hasta = new Date(desde.getTime() + (DIAS_ADELANTE + 1) * 86400000);
  return CalendarApp.getDefaultCalendar()
    .getEvents(desde, hasta)
    .filter((ev) => {
      try {
        return ev.getMyStatus() !== CalendarApp.GuestStatus.NO;
      } catch (e) {
        return true;
      }
    })
    .map((ev) => ({
      id: ev.getId() + '_' + ev.getStartTime().getTime(),
      titulo: ev.getTitle(),
      inicio: ev.getStartTime().toISOString(),
      fin: ev.getEndTime().toISOString(),
      todoElDia: ev.isAllDayEvent(),
      enlace: enlaceReunion_((ev.getLocation() || '') + ' ' + (ev.getDescription() || '')),
    }));
}

/**
 * Correos nuevos desde la última sincronización (con 1 h de margen; el bot descarta duplicados por id).
 * En la primera ejecución no se envía el histórico.
 */
function leerCorreosNuevos_(props) {
  const desde = Number(props.getProperty('CORREOS_DESDE') || 0);
  if (!desde) return [];
  const yo = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const dominio = yo.split('@')[1] || '';
  const lista = [];
  GmailApp.search(`${CONSULTA_BANDEJA} after:${Math.floor(desde / 1000) - 3600}`, 0, MAX_HILOS).forEach((hilo) => {
    hilo.getMessages().forEach((m) => {
      if (m.getDate().getTime() < desde - 3600000) return;
      const de = String(m.getFrom() || '');
      if (de.toLowerCase().indexOf(yo) >= 0) return;
      lista.push({
        id: m.getId(),
        hilo: hilo.getId(),
        de: de,
        asunto: m.getSubject(),
        fecha: m.getDate().toISOString(),
        directo: String(m.getTo() || '').toLowerCase().indexOf(yo) >= 0,
        mismoDominio: Boolean(dominio) && de.toLowerCase().indexOf('@' + dominio) >= 0,
        listaBaja: Boolean(m.getHeader('List-Unsubscribe')),
      });
    });
  });
  return lista;
}
