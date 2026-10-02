/**
 * Configuración: secretos en Script Properties y preferencias editables en la pestaña Config.
 *
 * Script Properties usadas:
 *   TELEGRAM_TOKEN      token del bot (lo pones tú en Configuración del proyecto)
 *   SPREADSHEET_ID      hoja de datos (la crea setup())
 *   WEBHOOK_SECRET      secreto en la URL del webhook (lo genera setup())
 *   SYNC_SECRET         secreto que usa el satélite de la otra cuenta (lo genera setup())
 *   CODIGO_VINCULACION  código para /vincular tu chat (lo genera setup())
 *   CHAT_ID             chat autorizado (se guarda al vincular)
 *   WEBAPP_URL          opcional: URL /exec del despliegue si getService().getUrl() no la da bien
 *   GEMINI_API_KEY      API key de Google AI Studio (análisis de correos personales)
 *   JIRA_SITIO, JIRA_CORREO, JIRA_TOKEN   acceso a Jira Cloud
 */

const ESQUEMAS = {
  Config: ['clave', 'valor', 'nota'],
  Cuentas: ['id', 'perfil', 'banco', 'alias', 'ultimos4', 'saldo_base', 'fecha_base'],
  Movimientos: ['id', 'fecha', 'perfil', 'cuenta_id', 'tipo', 'monto', 'descripcion', 'fuente', 'gmail_msg_id', 'categoria'],
  Pendientes: ['id', 'perfil', 'texto', 'fecha_limite', 'estado', 'fuente', 'ref', 'creado', 'cerrado', 'sync', 'avisado'],
  Eventos: ['perfil', 'id', 'titulo', 'inicio', 'fin', 'todo_el_dia', 'enlace', 'actualizado'],
  Correos: ['id', 'perfil', 'fecha', 'remitente', 'asunto', 'categoria', 'importante', 'prioridad', 'resumen', 'monto',
    'fecha_limite', 'accion', 'origen', 'estado', 'intentos', 'directo', 'lista_baja', 'cuerpo', 'hilo', 'pendiente_id', 'feedback'],
  Log: ['fecha', 'nivel', 'origen', 'mensaje', 'detalle'],
  Tasas: ['clave', 'valor', 'actualizada'],
};

const CONFIG_INICIAL = [
  ['PERFIL_ACTIVO', 'personal', 'Perfil usado al crear tareas o movimientos sin indicarlo (personal | trabajo)'],
  ['CAL_personal', 'primary', 'Calendario personal ("primary" = el principal de esta cuenta)'],
  ['CAL_trabajo', 'satelite', '"satelite" = lo sincroniza el script satélite de la cuenta de trabajo; o el ID de un calendario compartido'],
  ['HORA_RESUMEN', '6:30', 'Hora del resumen diario (H:MM). Al cambiarla, ejecuta instalarTriggers()'],
  ['MINUTOS_RECORDATORIO', '10', 'Minutos de anticipación para avisar reuniones'],
  ['IA_ACTIVA', 'si', 'Analizar con Gemini los correos PERSONALES que las reglas no clasifican (nunca los de trabajo)'],
  ['GEMINI_MODELO', 'gemini-3.5-flash-lite', 'Modelo de Gemini; ejecuta modelosGemini() para ver los disponibles'],
  ['GEMINI_PAUSA_MS', '4000', 'Pausa entre llamadas a Gemini para respetar el límite gratuito por minuto'],
  ['IGNORAR_REMITENTES', '', 'Correos o dominios a ignorar, separados por coma (también con /ignorar)'],
  ['IMPORTANTES_TRABAJO', '', 'Correos o dominios (clientes, jefe) que siempre generan aviso + pendiente'],
  ['AVISAR_DIRECTOS_TRABAJO', 'si', 'Avisar correos de trabajo que alguien de tu dominio te envía directamente'],
  ['JIRA_JQL', 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC', 'Consulta de Jira para tus actividades'],
  ['TASA_USD', '4100', 'Respaldo: pesos por 1 USD solo si no se puede leer la tasa real de GOOGLEFINANCE("USD/COP")'],
  ['AVISO_VENCIMIENTOS', 'si', 'Avisar cuando un pendiente vence hoy o está vencido'],
  ['DIAS_RETENCION_CORREOS', '60', 'Días que se conservan los correos analizados (los viejos se archivan)'],
  ['DIAS_RETENCION_LOG', '30', 'Días que se conserva la pestaña Log'],
  ['MAX_FILAS_LOG', '5000', 'Máximo de filas en la pestaña Log'],
  ['DURACION_REUNION', '60', 'Duración por defecto (min) de los eventos creados con /reunion'],
  ['CATEGORIAS_EXTRA', '', 'Palabras clave para categorizar gastos: "taxi=Transporte, domicilio=Alimentos"'],
  ['DESVIACION_GASTOS', '25', 'Aviso si los gastos de 30 días suben más de este % respecto al mes anterior'],
];

function prop_(clave) {
  return PropertiesService.getScriptProperties().getProperty(clave);
}

function setProp_(clave, valor) {
  PropertiesService.getScriptProperties().setProperty(clave, String(valor));
}

function borrarProp_(clave) {
  PropertiesService.getScriptProperties().deleteProperty(clave);
}

let CONFIG_CACHE_ = null;

function getConfig_(clave, porDefecto) {
  if (!CONFIG_CACHE_) {
    CONFIG_CACHE_ = {};
    leer_('Config').forEach((r) => (CONFIG_CACHE_[r.clave] = r));
  }
  const fila = CONFIG_CACHE_[clave];
  const valor = fila ? String(fila.valor).trim() : '';
  return valor !== '' ? valor : porDefecto;
}

function setConfig_(clave, valor) {
  getConfig_(clave); // asegura el caché
  const fila = CONFIG_CACHE_[clave];
  if (fila) actualizar_('Config', fila._fila, { valor: valor });
  else agregar_('Config', { clave: clave, valor: valor, nota: '' });
  CONFIG_CACHE_ = null;
}

function perfilActivo_() {
  const p = normalizar_(getConfig_('PERFIL_ACTIVO', 'personal'));
  return PERFILES.indexOf(p) >= 0 ? p : 'personal';
}

function zonaHoraria_() {
  return Session.getScriptTimeZone();
}

function fmtFecha_(d, patron) {
  return Utilities.formatDate(new Date(d), zonaHoraria_(), patron);
}

const DIAS_CORTOS_ = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** "vie 02/10" (Utilities.formatDate con EEE devuelve los días en inglés). */
function fmtDia_(d, patron) {
  d = new Date(d);
  return DIAS_CORTOS_[d.getDay()] + ' ' + fmtFecha_(d, patron || 'dd/MM');
}
