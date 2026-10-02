/**
 * Instalación sin terminal, desde la hoja (copia de la plantilla):
 *   menú 🤖 Asistente → Instalar → pegar el token de @BotFather → desplegar la app web → pegar su URL
 *   → botón "Abrir en Telegram", que vincula el chat solo (t.me/<bot>?start=<código>).
 *
 * Lo demás (IA, cuentas, trabajo, Jira, preferencias) se configura desde Telegram con /configurar.
 */

const REGEX_TOKEN_ = /^\d{6,}:[\w-]{30,}$/;
const REGEX_WEBAPP_ = /^https:\/\/script\.google\.com\/(?:a\/[\w.-]+\/)?macros\/s\/[\w-]+\/exec$/;

function abrirInstalador_() {
  const html = HtmlService.createHtmlOutput(htmlInstalador_()).setWidth(520).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Instalar tu asistente');
}

/** Paso 1: valida el token con Telegram, prepara la hoja y los triggers. */
function instalarConToken_(token) {
  token = String(token || '').trim();
  if (!REGEX_TOKEN_.test(token)) throw new Error('Ese no parece un token de @BotFather. Debe verse como 123456789:AAH…');
  setProp_('TELEGRAM_TOKEN', token);
  let yo;
  try {
    yo = tg_('getMe');
  } catch (err) {
    borrarProp_('TELEGRAM_TOKEN');
    throw new Error('Telegram rechazó el token. Cópialo de nuevo desde @BotFather (/mybots → API Token).');
  }
  setProp_('BOT_NOMBRE', yo.first_name || yo.username);
  setProp_('BOT_USUARIO', yo.username);
  setup();
  instalarTriggers();
  const r = { nombre: nombreBot_(), usuario: yo.username, conectado: false };
  if (urlWebApp_()) return Object.assign(r, conectarWebApp_(urlWebApp_()));
  return r;
}

/** Paso 2: guarda la URL /exec de la app web y conecta el webhook de Telegram. */
function conectarWebApp_(url) {
  url = String(url || '').trim();
  if (!REGEX_WEBAPP_.test(url)) {
    throw new Error('La URL debe empezar por https://script.google.com/macros/s/ y terminar en /exec.');
  }
  if (!prop_('TELEGRAM_TOKEN')) throw new Error('Primero pega el token del bot (paso 1).');
  setProp_('WEBAPP_URL', url);
  registrarWebhook();
  return { conectado: true, usuario: prop_('BOT_USUARIO'), enlace: enlaceVinculacion_() };
}

/** Deep link que abre el bot y lo vincula con el código (Telegram envía "/start <código>"). */
function enlaceVinculacion_() {
  return `https://t.me/${prop_('BOT_USUARIO')}?start=${prop_('CODIGO_VINCULACION')}`;
}

/** Al abrir la URL /exec en el navegador: confirma que el bot está activo. */
function doGet() {
  const listo = Boolean(prop_('TELEGRAM_TOKEN') && prop_('WEBAPP_URL'));
  const cuerpo = listo
    ? `<h1>✅ ${esc_(nombreBot_())} está activo</h1><p><a href="${enlaceVinculacion_()}">Abrir en Telegram</a></p>`
    : '<h1>Falta terminar la instalación</h1><p>Vuelve a la hoja y usa el menú 🤖 Asistente → Instalar.</p>';
  return HtmlService.createHtmlOutput(`<div style="font-family:Montserrat,Arial,sans-serif;padding:24px">${cuerpo}</div>`).setTitle(nombreBot_());
}

/** Menú → Estado del bot. */
function estadoEnHoja_() {
  const texto = prop_('TELEGRAM_TOKEN') ? estadoSistema_() : 'Aún no está instalado: usa 🤖 Asistente → Instalar.';
  SpreadsheetApp.getUi().alert(String(texto).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

function htmlInstalador_() {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  :root { --azul:#161535; --verde:#00FFCE; --gris:#F6F6F6; }
  body { font-family: Montserrat, Arial, sans-serif; color: var(--azul); margin: 0; padding: 4px 8px; font-size: 14px; }
  h2 { font-family: Merriweather, Georgia, serif; font-size: 17px; margin: 14px 0 6px; }
  ol { padding-left: 20px; margin: 6px 0; } li { margin: 4px 0; }
  input { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; }
  button, .boton { background: var(--azul); color: var(--verde); border: 0; border-radius: 6px; padding: 9px 16px;
    font-weight: 600; cursor: pointer; margin-top: 8px; text-decoration: none; display: inline-block; }
  .paso { background: var(--gris); border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; }
  .oculto { display: none; } .error { color: #b00020; } code { background: #fff; padding: 1px 4px; border-radius: 4px; }
</style></head><body>
<div id="p1" class="paso">
  <h2>1. Crea tu bot en Telegram</h2>
  <ol>
    <li>En Telegram abre <b>@BotFather</b> y envía <code>/newbot</code>.</li>
    <li>Ponle un nombre (ej. <i>Asistente de Ana</i>) y un usuario que termine en <code>bot</code>.</li>
    <li>Copia el <b>token</b> que te entrega y pégalo aquí:</li>
  </ol>
  <input id="token" placeholder="123456789:AAH...">
  <button id="b1" onclick="paso1()">Continuar</button>
  <div id="e1" class="error"></div>
</div>
<div id="p2" class="paso oculto">
  <h2>2. Publica tu bot (una sola vez)</h2>
  <ol>
    <li>En la hoja: <b>Extensiones → Apps Script</b>.</li>
    <li>Arriba a la derecha: <b>Implementar → Nueva implementación</b>.</li>
    <li>En el engranaje ⚙️ elige <b>Aplicación web</b>. <i>Ejecutar como:</i> <b>Yo</b>. <i>Quién tiene acceso:</i> <b>Cualquier usuario</b>.</li>
    <li>Clic en <b>Implementar</b>, autoriza y copia la <b>URL de la aplicación web</b> (termina en <code>/exec</code>).</li>
  </ol>
  <input id="url" placeholder="https://script.google.com/macros/s/.../exec">
  <button id="b2" onclick="paso2()">Conectar</button>
  <div id="e2" class="error"></div>
</div>
<div id="p3" class="paso oculto">
  <h2>3. ¡Listo! 🎉</h2>
  <p>Abre tu bot y toca <b>Iniciar</b>. Queda vinculado solo a tu chat.</p>
  <a id="enlace" class="boton" target="_blank">Abrir en Telegram</a>
  <p>Después escribe <code>/configurar</code> para activar la IA, tus cuentas y lo demás.</p>
</div>
<script>
  function $(id) { return document.getElementById(id); }
  function cargando(b, si) { $(b).disabled = si; $(b).textContent = si ? 'Un momento…' : $(b).dataset.texto; }
  ['b1', 'b2'].forEach(function (b) { $(b).dataset.texto = $(b).textContent; });
  function falla(e, b) { return function (err) { cargando(b, false); $(e).textContent = err.message || err; }; }
  function listo(r) { $('p1').classList.add('oculto'); $('p2').classList.add('oculto'); $('p3').classList.remove('oculto'); $('enlace').href = r.enlace; }
  function paso1() {
    $('e1').textContent = ''; cargando('b1', true);
    google.script.run.withFailureHandler(falla('e1', 'b1')).withSuccessHandler(function (r) {
      cargando('b1', false);
      if (r.conectado) return listo(r);
      $('p1').classList.add('oculto'); $('p2').classList.remove('oculto');
    }).instalarConToken($('token').value);
  }
  function paso2() {
    $('e2').textContent = ''; cargando('b2', true);
    google.script.run.withFailureHandler(falla('e2', 'b2')).withSuccessHandler(listo).conectarWebApp($('url').value);
  }
</script></body></html>`;
}
