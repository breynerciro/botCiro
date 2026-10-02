// Satélite (cuenta de trabajo) → bot principal, con ambos lados simulados.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { crearEntorno } = require('./gasMocks');

function crearSatelite(bot, { eventos = [], bandeja = [] }) {
  const props = { SYNC_URL: 'https://script.google.com/macros/s/x/exec?sync=' + bot.props.SYNC_SECRET };
  const triggers = [];
  const enviosAlBot = [];
  const mensaje = (c) => ({
    getId: () => c.id, getDate: () => c.fecha, getFrom: () => c.de, getTo: () => c.para || 'ana@miempresa.co',
    getSubject: () => c.asunto, getPlainBody: () => assert.fail('el satélite no debe leer el cuerpo'),
    getHeader: (h) => (h === 'List-Unsubscribe' && c.listaBaja ? '<mailto:x>' : ''),
  });
  const ctx = vm.createContext({
    console: { log: () => {}, error: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => (props[k] = v) }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'ana@miempresa.co' }) },
    CalendarApp: {
      GuestStatus: { NO: 'NO' },
      getDefaultCalendar: () => ({
        getEvents: () => eventos.map((e) => ({
          getId: () => e.titulo, getTitle: () => e.titulo, getStartTime: () => e.inicio, getEndTime: () => e.fin,
          isAllDayEvent: () => false, getMyStatus: () => e.estado || 'YES', getLocation: () => '', getDescription: () => e.descripcion || '',
        })),
      }),
    },
    GmailApp: {
      search: (q) => {
        assert.match(q, /^in:inbox -category:promotions -category:social -from:me after:\d+$/);
        return bandeja.map((c) => ({ getId: () => c.hilo || c.id, getMessages: () => [mensaje(c)] }));
      },
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        enviosAlBot.push(JSON.parse(opts.payload));
        const sync = new URL(url).searchParams.get('sync');
        const out = bot.ctx.doPost({ parameter: { sync }, postData: { contents: opts.payload } });
        return { getContentText: () => out.getContent(), getResponseCode: () => 200 };
      },
    },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: (f) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push(f) }) }) }) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'satelite', 'Satelite.js'), 'utf8'), ctx);
  return { ctx, props, triggers, enviosAlBot };
}

function botVinculado() {
  const bot = crearEntorno({ gemini: () => assert.fail('los correos de trabajo nunca van a Gemini') });
  bot.ctx.setup();
  Object.assign(bot.props, { TELEGRAM_TOKEN: 'tok', CHAT_ID: '777', GEMINI_API_KEY: 'clave' });
  bot.decir = (t) => bot.ctx.responder_(t);
  bot.avisos = () => bot.enviados.map((m) => m.text).join('\n');
  return bot;
}

const enMinutos = (m) => new Date(Date.now() + m * 60000);

test('instalación: conecta la cuenta, sincroniza agenda y no envía el histórico de correos', () => {
  const bot = botVinculado();
  assert.match(bot.decir('/agenda trabajo'), /aún no ha sincronizado/);

  const hoy = new Date();
  const ocho = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 8, 0);
  const sat = crearSatelite(bot, {
    eventos: [
      { titulo: 'Weekly comercial', inicio: ocho, fin: new Date(ocho.getTime() + 3600000), descripcion: 'Meet: https://meet.google.com/kil-abcd-xyz' },
      { titulo: 'Rechazada', inicio: ocho, fin: new Date(ocho.getTime() + 3600000), estado: 'NO' },
    ],
    bandeja: [{ id: 'viejo', de: 'x@cliente.com', asunto: 'Histórico', fecha: enMinutos(-600) }],
  });
  sat.ctx.instalar();
  assert.deepEqual(sat.triggers, ['sincronizar']);
  assert.deepEqual(sat.enviosAlBot[0].correos, [], 'la primera sincronización no envía correos viejos');
  assert.match(bot.avisos(), /ana@miempresa\.co<\/b> conectada al perfil trabajo/);

  const agenda = bot.decir('/agenda trabajo');
  assert.match(agenda, /08:00–09:00 Weekly comercial · <a href="https:\/\/meet\.google\.com\/kil-abcd-xyz">/);
  assert.doesNotMatch(agenda, /Rechazada/);
});

test('correos de trabajo: solo metadatos, clasificados con reglas', () => {
  const bot = botVinculado();
  bot.ctx.setConfig_('IMPORTANTES_TRABAJO', 'importador-abc.com');
  const bandeja = [];
  const sat = crearSatelite(bot, { bandeja });
  sat.ctx.sincronizar(); // fija la marca de tiempo

  bandeja.push(
    { id: 'w1', de: 'Ana <ana@naviera.com>', asunto: 'URGENTE: corrección HBL antes del zarpe', fecha: enMinutos(1) },
    { id: 'w2', de: 'Gerente <g@importador-abc.com>', asunto: 'Cotización FCL Shanghai - Buenaventura', fecha: enMinutos(1) },
    { id: 'w3', de: 'Pedro <pedro@miempresa.co>', asunto: 'Revisión del sprint', fecha: enMinutos(1) },
    { id: 'w4', de: 'Pedro <pedro@miempresa.co>', asunto: 'Para el equipo', para: 'equipo@miempresa.co', fecha: enMinutos(1) },
    { id: 'w5', de: 'Jira <jira@miempresa.atlassian.net>', asunto: '[JIRA] EMP-9 asignado', fecha: enMinutos(1) },
    { id: 'w6', de: 'news@logistica.com', asunto: 'Boletín', listaBaja: true, fecha: enMinutos(1) },
  );
  sat.ctx.sincronizar();
  const enviado = sat.enviosAlBot[1].correos;
  assert.equal(enviado.length, 6);
  assert.ok(enviado.every((c) => !('cuerpo' in c)), 'el satélite no envía cuerpos');

  bot.enviados.length = 0;
  bot.ctx.escanearGmail();
  const avisos = bot.avisos();
  assert.match(avisos, /🔴 <i>trabajo<\/i> · Ana: URGENTE: corrección HBL[\s\S]*→ #\d+ Revisar: URGENTE: corrección HBL antes del zarpe \(Ana\)/);
  assert.match(avisos, /Gerente: Cotización FCL[\s\S]*→ #\d+ Responder a Gerente: Cotización FCL/);
  assert.match(avisos, /🟡 <i>trabajo<\/i> · Pedro: Revisión del sprint/);
  assert.doesNotMatch(avisos, /Para el equipo|EMP-9|Boletín/);
  assert.match(bot.decir('/pendientes trabajo'), /corrección HBL[\s\S]*Cotización FCL/);

  // Reenvío por margen de tiempo: el bot descarta duplicados.
  sat.ctx.sincronizar();
  assert.equal(bot.ctx.leer_('Correos').length, 6);
});

test('secreto de sincronización inválido se rechaza', () => {
  const bot = botVinculado();
  const out = bot.ctx.doPost({ parameter: { sync: 'malo' }, postData: { contents: '{}' } });
  assert.deepEqual(JSON.parse(out.getContent()), { ok: false, error: 'secreto inválido' });
});
