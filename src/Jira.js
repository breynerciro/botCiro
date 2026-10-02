/**
 * Actividades asignadas en Jira Cloud → pendientes del perfil trabajo.
 *
 * Script Properties: JIRA_SITIO (miempresa.atlassian.net), JIRA_CORREO, JIRA_TOKEN
 * (token en https://id.atlassian.com/manage-profile/security/api-tokens). Config: JIRA_JQL.
 *
 *   Issue asignado y abierto    → pendiente nuevo + aviso
 *   Issue resuelto o reasignado → el pendiente se cierra + aviso
 *   /hecho en el bot            → se cierra aquí y no se recrea mientras el issue siga abierto
 */

const JQL_POR_DEFECTO_ = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';

function jiraConfigurado_() {
  return Boolean(prop_('JIRA_SITIO') && prop_('JIRA_CORREO') && prop_('JIRA_TOKEN'));
}

function sitioJira_() {
  return String(prop_('JIRA_SITIO')).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function consultarJira_() {
  const jql = getConfig_('JIRA_JQL', JQL_POR_DEFECTO_);
  const url = `https://${sitioJira_()}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}` +
    '&maxResults=100&fields=summary,status,priority,duedate';
  const resp = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(prop_('JIRA_CORREO') + ':' + prop_('JIRA_TOKEN')),
      Accept: 'application/json',
    },
    muteHttpExceptions: true,
  });
  const codigo = resp.getResponseCode();
  if (codigo === 401 || codigo === 403) {
    const err = new Error('Jira rechazó las credenciales (¿venció el token?)');
    err.credenciales = true;
    throw err;
  }
  if (codigo !== 200) throw new Error('Jira ' + codigo + ': ' + resp.getContentText().slice(0, 200));
  return (JSON.parse(resp.getContentText()).issues || []).map((i) => ({
    clave: i.key,
    resumen: (i.fields && i.fields.summary) || '',
    prioridad: (i.fields && i.fields.priority && i.fields.priority.name) || '',
    vence: (i.fields && i.fields.duedate) || null,
  }));
}

function fechaJira_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : '';
}

/** Concilia los issues abiertos con los pendientes de fuente jira. Devuelve { nuevos, cerrados }. */
function sincronizarJira_(issues) {
  const filas = leer_('Pendientes');
  // Las filas "limpio" ya cerraron su ciclo: si el issue vuelve a asignarse, se crea un pendiente nuevo.
  const activos = filas.filter((t) => t.fuente === 'jira' && t.sync !== 'limpio');
  const porClave = {};
  activos.forEach((t) => (porClave[String(t.ref)] = t));
  const abiertosEnJira = new Set(issues.map((i) => i.clave));
  let siguiente = siguienteId_('Pendientes', filas);
  const nuevos = [];
  const cerrados = [];

  issues.forEach((i) => {
    const existente = porClave[i.clave];
    const vence = fechaJira_(i.vence);
    if (existente) {
      const actual = existente.fecha_limite ? new Date(existente.fecha_limite).getTime() : 0;
      if (existente.estado === 'abierto' && (vence ? vence.getTime() : 0) !== actual) {
        actualizar_('Pendientes', existente._fila, { fecha_limite: vence });
      }
      return;
    }
    const tarea = {
      id: siguiente++,
      perfil: 'trabajo',
      texto: `${i.clave} · ${i.resumen}`.slice(0, 200),
      fecha_limite: vence,
      estado: 'abierto',
      fuente: 'jira',
      ref: i.clave,
      creado: new Date(),
    };
    agregar_('Pendientes', tarea);
    nuevos.push(Object.assign({ prioridad: i.prioridad }, tarea));
  });

  activos.forEach((t) => {
    if (abiertosEnJira.has(String(t.ref))) return;
    if (t.estado === 'abierto') {
      actualizar_('Pendientes', t._fila, { estado: 'hecho', cerrado: new Date(), sync: 'limpio' });
      cerrados.push(t);
    } else {
      actualizar_('Pendientes', t._fila, { sync: 'limpio' });
    }
  });
  return { nuevos: nuevos, cerrados: cerrados };
}

function enlaceJira_(clave) {
  return `<a href="https://${sitioJira_()}/browse/${encodeURIComponent(clave)}">${esc_(clave)}</a>`;
}

function escanearJira_() {
  if (!jiraConfigurado_()) return null;
  const res = sincronizarJira_(consultarJira_());
  const partes = [];
  if (res.nuevos.length) {
    partes.push(
      '🎫 <b>Jira: asignado a ti</b>\n' +
        res.nuevos
          .map((t) => {
            const vence = t.fecha_limite ? ` · vence ${fmtDia_(t.fecha_limite)}` : '';
            const prioridad = t.prioridad ? ` <i>(${esc_(t.prioridad)})</i>` : '';
            return `#${t.id} ${enlaceJira_(t.ref)} ${esc_(t.texto.replace(t.ref + ' · ', ''))}${prioridad}${vence}`;
          })
          .join('\n')
    );
  }
  if (res.cerrados.length) {
    partes.push('✔️ Cerrados en Jira: ' + res.cerrados.map((t) => `#${t.id} ${esc_(t.ref)}`).join(', '));
  }
  if (partes.length && hayChats_()) enviar_(partes.join('\n\n'));
  return res;
}

/** Trigger cada 10 min. */
function escanearJira() {
  try {
    conBloqueo_(() => escanearJira_());
  } catch (err) {
    registrarError_('escanearJira', err);
    // Avisar una vez al día si las credenciales fallan.
    if (err.credenciales && !CacheService.getScriptCache().get('jira_aviso')) {
      CacheService.getScriptCache().put('jira_aviso', '1', 21600);
      enviar_('⚠️ ' + esc_(err.message) + '. Genera uno nuevo y actualiza JIRA_TOKEN en las propiedades del script.');
    }
  }
}

function cmdJira_() {
  if (!jiraConfigurado_()) return 'Jira no está configurado: agrega JIRA_SITIO, JIRA_CORREO y JIRA_TOKEN en las propiedades del script.';
  const res = escanearJira_();
  return `🎫 Jira revisado: ${res.nuevos.length} nuevo(s), ${res.cerrados.length} cerrado(s).`;
}
