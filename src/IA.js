/**
 * Clasificación de correos personales con Gemini (Google AI Studio, nivel gratuito).
 * Solo se usa para lo que las reglas de Clasificador.js no resuelven, y nunca para la cuenta de trabajo.
 *
 * Script Properties: GEMINI_API_KEY. Config: IA_ACTIVA, GEMINI_MODELO.
 */

const GEMINI_URL_ = 'https://generativelanguage.googleapis.com/v1beta/models/';
const CATEGORIAS_IA_ = ['accion_requerida', 'reunion', 'finanzas', 'suscripcion', 'compra_envio', 'seguridad', 'informativo', 'promocion', 'spam'];

const INSTRUCCION_IA_ = [
  'Clasificas correos de la cuenta PERSONAL de un profesional en Bogotá, Colombia. Respondes solo con el JSON pedido.',
  '',
  'Es importante (importante=true) si requiere que la persona haga algo o se entere pronto:',
  '- pagos, cobros o vencimientos (servicios públicos, administración, impuestos DIAN, SOAT, créditos);',
  '- citas médicas, trámites, notaría, reservas, vuelos, entregas que requieren acción;',
  '- alertas de seguridad de sus cuentas (inicio de sesión nuevo, cambio de contraseña, códigos no solicitados);',
  '- mensajes escritos por una persona real que espera respuesta.',
  'No es importante: publicidad, boletines, notificaciones automáticas sin acción, redes sociales, encuestas.',
  '',
  'Campos:',
  '- resumen: una frase de máximo 120 caracteres, en español, con el dato clave (quién, qué, cuánto, cuándo).',
  '- tarea: solo si hay una acción concreta; verbo en infinitivo, máximo 80 caracteres ("Pagar recibo de Enel $185.000"). Si no hay acción, null.',
  '- fecha_limite: solo si el correo dice una fecha explícita para actuar, formato YYYY-MM-DD; si no, null.',
  '- monto: valor principal en pesos si aplica, número sin formato; si no, null.',
  '- prioridad: alta (hoy o en riesgo de multa/pérdida), media (esta semana), baja (lo demás).',
].join('\n');

const ESQUEMA_IA_ = {
  type: 'OBJECT',
  properties: {
    categoria: { type: 'STRING', enum: CATEGORIAS_IA_ },
    importante: { type: 'BOOLEAN' },
    prioridad: { type: 'STRING', enum: ['alta', 'media', 'baja'] },
    resumen: { type: 'STRING' },
    tarea: { type: 'STRING', nullable: true },
    fecha_limite: { type: 'STRING', nullable: true },
    monto: { type: 'NUMBER', nullable: true },
  },
  required: ['categoria', 'importante', 'prioridad', 'resumen'],
};

/** Error de cuota (429): se reintenta en la siguiente ejecución sin contar como fallo del correo. */
function ErrorCuotaIA_(mensaje) {
  this.message = mensaje;
  this.cuota = true;
}

function iaDisponible_() {
  return normalizar_(getConfig_('IA_ACTIVA', 'si')) === 'si' && Boolean(prop_('GEMINI_API_KEY'));
}

function textoParaIA_(msg) {
  return [
    'Fecha: ' + (msg.fecha ? new Date(msg.fecha).toISOString().slice(0, 10) : ''),
    'De: ' + redactar_(nombreRemitente_(msg.de)) + ' (' + String(msg.de || '').replace(/.*@/, '@').replace(/>.*/, '') + ')',
    'Asunto: ' + redactar_(msg.asunto),
    '',
    redactar_(msg.cuerpo).replace(/\s+/g, ' ').slice(0, 2500),
  ].join('\n');
}

/** Valida y normaliza el JSON devuelto por el modelo. Pura (probada en Node). */
function interpretarRespuestaIA_(texto) {
  let d;
  try {
    d = JSON.parse(String(texto || '').replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (e) {
    throw new Error('Respuesta de IA no es JSON válido');
  }
  const categoria = CATEGORIAS_IA_.indexOf(d.categoria) >= 0 ? d.categoria : 'informativo';
  const importante = d.importante === true || d.importante === 'true';
  const tarea = d.tarea && String(d.tarea).trim() ? String(d.tarea).trim().slice(0, 120) : null;
  let fecha = null;
  const mf = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.fecha_limite || ''));
  if (mf) fecha = new Date(+mf[1], +mf[2] - 1, +mf[3]);
  const monto = typeof d.monto === 'number' && isFinite(d.monto) && d.monto > 0 ? d.monto : null;

  let accion = 'resumen';
  if (categoria === 'promocion' || categoria === 'spam') accion = 'omitir';
  else if (importante && tarea) accion = 'pendiente';
  else if (importante) accion = 'aviso';

  return {
    regla: 'ia',
    categoria: categoria,
    accion: accion,
    prioridad: ['alta', 'media', 'baja'].indexOf(d.prioridad) >= 0 ? d.prioridad : 'baja',
    resumen: String(d.resumen || '').slice(0, 160),
    tarea: accion === 'pendiente' ? tarea : null,
    fecha_limite: fecha,
    monto: monto,
  };
}

function clasificarConIA_(msg) {
  const modelo = getConfig_('GEMINI_MODELO', 'gemini-3.5-flash-lite');
  const resp = UrlFetchApp.fetch(GEMINI_URL_ + encodeURIComponent(modelo) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': prop_('GEMINI_API_KEY') },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      systemInstruction: { parts: [{ text: INSTRUCCION_IA_ }] },
      contents: [{ role: 'user', parts: [{ text: textoParaIA_(msg) }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: ESQUEMA_IA_ },
    }),
  });
  const codigo = resp.getResponseCode();
  if (codigo === 429) throw new ErrorCuotaIA_('Cuota de Gemini agotada por ahora');
  const data = JSON.parse(resp.getContentText() || '{}');
  if (codigo !== 200) throw new Error('Gemini ' + codigo + ': ' + ((data.error && data.error.message) || 'error'));
  const partes = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  if (!partes || !partes.length) throw new Error('Gemini no devolvió contenido (posible bloqueo de seguridad)');
  return interpretarRespuestaIA_(partes.map((p) => p.text || '').join(''));
}

/** Desde el editor: lista los modelos que tu API key puede usar con generateContent. */
function modelosGemini() {
  const resp = UrlFetchApp.fetch(GEMINI_URL_ + '?pageSize=200', {
    headers: { 'x-goog-api-key': prop_('GEMINI_API_KEY') },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(resp.getContentText());
  if (!data.models) throw new Error('No se pudieron listar modelos: ' + resp.getContentText().slice(0, 200));
  const nombres = data.models
    .filter((m) => (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0)
    .map((m) => m.name.replace('models/', ''));
  console.log('Modelos disponibles (pon uno en Config → GEMINI_MODELO):\n' + nombres.join('\n'));
}
