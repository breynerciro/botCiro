# botCiro

Asistente personal en Telegram que reúne en un solo chat **saldos, reuniones y pendientes**, separados en perfil `personal` y `trabajo`.

- Corre gratis en la nube de Google (Apps Script) con tu cuenta personal de Gmail. No depende de tu PC.
- Los datos viven en una Google Sheet privada en tu Drive, que puedes revisar y corregir a mano.
- No guarda credenciales bancarias: los saldos se calculan con los correos de alerta del banco y lo que registras por chat.

## Qué hace

| Necesidad | Cómo |
|---|---|
| Saldo de tus cuentas | Lee cada 5 min las alertas del banco en Gmail y te avisa cada movimiento. También registras gastos por chat. |
| Reuniones | Lee tu calendario personal y el de trabajo (vía satélite). Avisa 10 min antes con el link de Meet/Zoom/Teams. |
| Correos | Analiza solo los correos de ambas cuentas: extractos de tarjeta → pendiente de pago con fecha límite; suscripciones y cobros → resumen; reuniones, pagos rechazados y lo importante → aviso al instante. |
| Jira | Tus actividades asignadas se vuelven pendientes de trabajo y se cierran solas cuando las resuelves en Jira. |
| Pendientes | Creados por chat, detectados en correos o asignados en Jira. |
| Resumen | Todos los días a las 6:30 a. m. (configurable) y con `/resumen`. |

## Instalación (una sola vez, ~20 min)

### 1. Crear el bot de Telegram
1. En Telegram, abre **@BotFather** → `/newbot` → ponle nombre.
2. Guarda el **token** que te entrega (no lo compartas ni lo subas a git).

### 2. Subir el código a Apps Script
```bash
npm i -g @google/clasp
clasp login                       # con tu Gmail PERSONAL
```
Activa la API en https://script.google.com/home/usersettings (Google Apps Script API → On). Luego:
```bash
cd /mnt/Disco/Proyectos/botCiro
clasp create --type standalone --title botCiro --rootDir src
git checkout src/appsscript.json  # clasp create puede sobrescribir el manifiesto
clasp push
clasp open                        # abre el editor en el navegador
```

### 3. Configurar en el editor de Apps Script
1. **Configuración del proyecto (⚙️) → Propiedades del script** → agrega `TELEGRAM_TOKEN` con el token del bot.
2. En el editor, selecciona la función **`setup`** → Ejecutar → acepta los permisos. En el registro verás el link de la hoja y tu **código de vinculación**.
3. **Implementar → Nueva implementación → Aplicación web**, con *Ejecutar como: Yo* y *Quién tiene acceso: Cualquier usuario*. Copia la URL que termina en `/exec` y guárdala como propiedad `WEBAPP_URL`.
4. Ejecuta **`registrarWebhook`**. El registro debe mostrar `ultimo_error: null`.
5. Ejecuta **`instalarTriggers`**.
6. En Telegram, escríbele a tu bot: `/vincular <código>`. Desde ese momento solo responde a tu chat.

### 4. Análisis de correos con IA (cuenta personal)
Las reglas fijas reconocen alertas del banco, extractos, suscripciones, invitaciones y boletines. Lo que no encaja en ninguna regla lo analiza **Gemini** (Google AI Studio, nivel gratuito) para decidir si es importante y qué hay que hacer.
1. Crea una API key en https://aistudio.google.com/apikey con tu cuenta personal.
2. Guárdala en las Propiedades del script como `GEMINI_API_KEY`.
3. Opcional: ejecuta `modelosGemini` para ver los modelos disponibles y elige uno en `Config` → `GEMINI_MODELO`.

Sin API key el bot sigue funcionando, solo con reglas.

> **Privacidad:** en el nivel gratuito, Google puede usar lo que se envía para mejorar sus productos. Por eso:
> - Solo se envían correos **personales** que las reglas no resolvieron, y antes se tapan correos electrónicos, teléfonos y números largos.
> - Los correos de **trabajo nunca pasan por la IA**: el satélite solo envía remitente, asunto y fecha, y se clasifican con reglas.
> - El cuerpo se guarda en la hoja solo mientras el correo espera en cola.
> - Para apagar la IA: `Config` → `IA_ACTIVA` = `no`.

### 5. Conectar la cuenta de trabajo (miempresa.co): satélite
El bot principal corre en tu cuenta personal y no puede leer otra cuenta de Google. Por eso se instala un **satélite** (`satelite/Satelite.js`) que corre **dentro de tu cuenta de trabajo** y cada 10 minutos le envía al bot:
- tus reuniones (desde ayer hasta 14 días adelante; solo título, horario y link),
- tus correos nuevos: **solo remitente, asunto y fecha**, nunca el cuerpo.

El bot clasifica los correos de trabajo con reglas:
- Asunto con *urgente, aprobación, vencimiento, acción requerida…* → **pendiente + aviso**.
- Remitentes en `Config` → `IMPORTANTES_TRABAJO` (clientes, jefe) → **pendiente + aviso**.
- Correos que alguien de tu dominio te envía directamente → **aviso**.
- Invitaciones y cancelaciones de reuniones → **aviso**.
- Lo demás → resumen diario. Las notificaciones de Jira se omiten porque las cubre la API.

Pasos (una sola vez):
1. En el editor del **bot principal**, ejecuta `datosSatelite` (en `Sync.gs`) y copia la `SYNC_URL` que aparece en el registro.
2. Inicia sesión en clasp con tu cuenta **de trabajo**. Queda en un perfil aparte, así que tu sesión personal no se toca:
   ```bash
   npm run satelite:login     # si se abre una ventana de navegador nueva, entra con @miempresa.co
   npm run satelite:crear     # crea el proyecto en tu cuenta de trabajo y sube el código
   npm run satelite:abrir
   ```
3. En el editor del satélite: ⚙️ → Propiedades del script → `SYNC_URL` = el valor del paso 1.
4. Ejecuta `instalar` y autoriza. A los segundos te llega por Telegram: *"Cuenta … conectada al perfil trabajo"*.

Para actualizar el satélite más adelante: `npm run satelite:push`.

### 6. Jira
1. Crea un token en https://id.atlassian.com/manage-profile/security/api-tokens. Vence: el bot te avisa cuando deje de funcionar.
2. En las Propiedades del script del bot principal agrega `JIRA_SITIO` (p. ej. `miempresa.atlassian.net`), `JIRA_CORREO` (tu correo de Atlassian) y `JIRA_TOKEN`.
3. Prueba con `/jira` en Telegram. Para cambiar qué se consulta, edita `Config` → `JIRA_JQL`.

### 7. Registrar tus cuentas
En Telegram:
```
/nuevacuenta bancolombia ahorros 1234 2300000
/nuevacuenta nu tarjeta 4321 1500000
/nuevacuenta trabajo bancolombia corriente 9876 0
```
Los `1234` son los últimos 4 dígitos que aparecen en las alertas del banco; con eso el bot asocia cada correo a su cuenta.

También puedes poner al día todas tus cuentas en un solo mensaje. Las que no existan se crean solas:
```
Me quedan 80.000 en efectivo, tengo 0 pesos en nequi, nu y bbva, debo en la tarjeta de crédito de Falabella 950.000 y 0 en la tarjeta de crédito Bancolombia
```
Las tarjetas de crédito quedan como cuentas `TC` con saldo negativo (lo que debes): las compras aumentan la deuda y los pagos la reducen. Si un banco tiene cuenta y TC, agrega los últimos 4 dígitos en la hoja para que las alertas por correo caigan en la correcta.

## Uso diario

```
/resumen                         saldos + reuniones de hoy + pendientes
/agenda trabajo semana           reuniones de los próximos 7 días
/tarea Enviar cotización al forwarder viernes
/pendientes                      /hecho 3 5
/gasto 45000 almuerzo #nu        o en texto libre: "gasté 45 mil en almuerzo"
"tengo 200 mil en nequi y debo 1.5 millones en la TC Rappi"   actualiza varios saldos
/ingreso 2 millones nómina
/ajustar ahorros 2310000         cuando veas el saldo real en la app del banco
/perfil trabajo                  lo que crees sin indicar perfil va a trabajo
/correos                         lo que el bot analizó en las últimas 24 h
/ignorar tienda.com              no volver a analizar ese remitente
/jira                            revisar ya tus actividades asignadas
```

> El saldo es un **estimado**: suma lo que llega por correo y por chat. Si un banco no manda alerta de algún movimiento (cuota de manejo, intereses), concilia de vez en cuando con `/ajustar`.

## Bancos soportados
El parser es genérico y entiende las frases típicas de las alertas en Colombia ("Compraste", "Recibiste", "Transferiste", "Pagaste", "Retiraste"). Los remitentes reconocidos están en `src/BankParsers.js` → `BANCOS`. Para agregar un banco, suma su dominio ahí.

Los correos de banco que tienen un monto pero que no se pudieron interpretar quedan en la pestaña `Log` con nivel `revisar`. Si ves alguno, pégalo (anonimizado) en `test/bankParsers.test.js` y ajusta el parser.

## Desarrollo
```bash
npm test          # pruebas de parsers + flujo completo con servicios de Google simulados
npm run push      # sube cambios a Apps Script
```
`npm run push` solo actualiza el código del editor. Para que el bot use los cambios, ejecuta `npm run deploy`: crea una nueva versión sobre la misma implementación, así que la URL `/exec` y el webhook no cambian.

## Solución de problemas
- **El bot no responde**: ejecuta `estadoWebhook()`. Si `ultimo_error` muestra un 302 u otro error recurrente, ejecuta `activarPolling()`: el bot pasa a leer mensajes cada minuto, sin webhook.
- **Errores en general**: revisa la pestaña `Log` de la hoja y el panel **Ejecuciones** del editor.
- **Cuotas gratuitas** (cuenta personal): 90 min/día de triggers. El uso estimado es de ~15 min/día.
