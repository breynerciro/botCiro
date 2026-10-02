// Simulación mínima en memoria de los servicios de Apps Script usados por el bot.
const fs = require('node:fs');
const path = require('node:path');
const { cargarConTransformacion } = require('./helpers');

// bandeja: correos en el inbox personal { id, hilo, de, para, asunto, cuerpo, fecha, listaBaja }
// gemini(payload) y jira(url) devuelven { codigo, cuerpo } para simular esas APIs.
// transformar(nombre, codigo): modifica el código antes de cargarlo (tests del build de biblioteca).
function crearEntorno({ eventos = [], correos = [], bandeja = [], gemini = null, jira = null, telegram = null, transformar = null } = {}) {
  const props = {};
  const llamadas = { gemini: [], jira: [] };
  const cache = {};
  const enviados = [];
  const tgLlamadas = [];
  const calendario = [];
  const triggers = [];
  const hojas = {};

  const crearHoja = (nombre) => {
    const filas = [];
    const sh = {
      getName: () => nombre,
      getDataRange: () => ({ getValues: () => filas.map((f) => f.slice()) }),
      appendRow: (f) => filas.push(f.slice()),
      getRange: (fila, col, nf, nc) => {
        const r = {
          getValue: () => (filas[fila - 1] || [])[col - 1],
          setValue: (v) => {
            while (filas.length < fila) filas.push([]);
            filas[fila - 1][col - 1] = v;
            return r;
          },
          setValues: (vals) => {
            vals.forEach((v, i) => {
              while (filas.length < fila + i) filas.push([]);
              v.forEach((x, j) => (filas[fila - 1 + i][col - 1 + j] = x));
            });
            return r;
          },
          clearContent: () => {
            filas.splice(fila - 1, nf);
            return r;
          },
          setFontWeight: () => r, setBackground: () => r, setFontColor: () => r, setNumberFormat: () => r,
        };
        return r;
      },
      setFrozenRows: () => {},
      getLastRow: () => filas.length,
      getLastColumn: () => (filas[0] || []).length,
      _filas: filas,
    };
    hojas[nombre] = sh;
    return sh;
  };

  const ss = {
    getId: () => 'ss1',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/ss1',
    getSheetByName: (n) => hojas[n] || null,
    insertSheet: (n) => crearHoja(n),
    getSheets: () => Object.values(hojas),
    deleteSheet: (sh) => delete hojas[sh.getName()],
    copy: (nombre) => ({ getId: () => 'copia1', getUrl: () => 'https://docs.google.com/spreadsheets/d/copia1', nombre }),
  };
  crearHoja('Hoja 1');

  const pad = (n) => String(n).padStart(2, '0');
  const globals = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => (props[k] = String(v)),
        deleteProperty: (k) => delete props[k],
      }),
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => (cache[k] = v), remove: (k) => delete cache[k] }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: { create: () => ss, openById: () => ss },
    Session: {
      getScriptTimeZone: () => 'America/Bogota',
      getEffectiveUser: () => ({ getEmail: () => 'ana@gmail.com' }),
    },
    Utilities: {
      formatDate: (d, tz, patron) =>
        patron
          .replace('yyyy', String(d.getFullYear()))
          .replace('dd', pad(d.getDate()))
          .replace('MM', pad(d.getMonth() + 1))
          .replace('HH', pad(d.getHours()))
          .replace('mm', pad(d.getMinutes())),
      getUuid: () => 'aaaa-bbbb',
      base64EncodeWebSafe: (s) => Buffer.from(s).toString('base64url'),
      base64Encode: (s) => Buffer.from(s).toString('base64'),
      sleep: () => {},
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        const respuesta = (codigo, cuerpo) => ({ getResponseCode: () => codigo, getContentText: () => JSON.stringify(cuerpo) });
        if (url.includes('generativelanguage.googleapis.com')) {
          const cuerpo = opts.payload ? JSON.parse(opts.payload) : { metodo: 'GET', url: url };
          llamadas.gemini.push(cuerpo);
          const r = gemini(cuerpo);
          return respuesta(r.codigo, r.cuerpo);
        }
        if (url.includes('atlassian.net')) {
          llamadas.jira.push(url);
          const r = jira(url);
          return respuesta(r.codigo, r.cuerpo);
        }
        const payload = JSON.parse(opts.payload);
        const metodo = url.split('/').pop();
        tgLlamadas.push({ metodo: metodo, payload: payload });
        if (telegram) {
          const simulado = telegram(metodo, payload);
          if (simulado) return respuesta(simulado.codigo, simulado.cuerpo);
        }
        if (metodo === 'sendMessage') enviados.push(payload);
        return respuesta(200, { ok: true, result: {} });
      },
    },
    CalendarApp: {
      GuestStatus: { NO: 'NO' },
      getDefaultCalendar: () => ({
        getEvents: (desde, hasta) => eventos.filter((e) => e.inicio < hasta && e.fin > desde).map(evento),
        createEvent: (titulo, inicio, fin) => {
          eventos.push({ titulo, inicio, fin });
          if (calendario) calendario.push({ titulo, inicio, fin });
          return evento({ titulo, inicio, fin });
        },
      }),
      getCalendarById: () => null,
    },
    GmailApp: {
      search: (q) => {
        if (q.startsWith('from:')) return [{ getId: () => 'h1', getMessages: () => correos.map(mensaje) }];
        if (q.startsWith('in:inbox')) {
          const hilos = {};
          bandeja.forEach((c) => (hilos[c.hilo || c.id] = hilos[c.hilo || c.id] || []).push(c));
          return Object.keys(hilos).map((h) => ({ getId: () => h, getMessages: () => hilos[h].map(mensaje) }));
        }
        return [];
      },
      getThreadById: () => null,
      getUserLabelByName: () => null,
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/x/exec' }),
      getProjectTriggers: () => triggers.map((f) => ({ getHandlerFunction: () => f })),
      deleteTrigger: (t) => {
        const i = triggers.indexOf(t.getHandlerFunction());
        if (i >= 0) triggers.splice(i, 1);
      },
      newTrigger: (f) => {
        const cadena = {};
        ['timeBased', 'everyMinutes', 'atHour', 'nearMinute', 'everyDays', 'inTimezone'].forEach((m) =>
          (cadena[m] = () => cadena)
        );
        cadena.create = () => {
          if (triggers.indexOf(f) < 0) triggers.push(f);
          return cadena;
        };
        return cadena;
      },
    },
    DriveApp: { getFileById: () => ({ setTrashed: () => {} }) },
  };

  function evento(e) {
    return {
      getTitle: () => e.titulo, getStartTime: () => e.inicio, getEndTime: () => e.fin, getId: () => e.titulo,
      isAllDayEvent: () => false, getMyStatus: () => 'YES', getLocation: () => '', getDescription: () => e.descripcion || '',
    };
  }
  function mensaje(c) {
    return {
      getId: () => c.id, getDate: () => c.fecha || new Date(), getFrom: () => c.de,
      getSubject: () => c.asunto || 'Alertas y Notificaciones', getPlainBody: () => c.cuerpo,
      getTo: () => c.para || 'ana@gmail.com', getHeader: (h) => (h === 'List-Unsubscribe' && c.listaBaja ? '<mailto:x>' : ''),
    };
  }

  const archivos = fs.readdirSync(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.js')).sort();
  const ctx = cargarConTransformacion(archivos, transformar);
  Object.assign(ctx, globals);
  return { ctx, props, enviados, tgLlamadas, calendario, triggers, hojas, llamadas, cache, globals };
}

module.exports = { crearEntorno };
