# botCiro

Asistente personal en Telegram que reúne en un solo chat **saldos, reuniones y pendientes**, separados en perfil `personal` y, si quieres, `trabajo`.

- Corre gratis en la nube de Google (Apps Script) con tu cuenta personal de Gmail. No depende de tu PC.
- Los datos viven en una Google Sheet privada en tu Drive, que puedes revisar y corregir a mano.
- No guarda credenciales bancarias: los saldos se calculan con los correos de alerta del banco y lo que registras por chat.

## Qué hace

| Necesidad | Cómo |
|---|---|
| Saldo de tus cuentas | Lee cada 5 min las alertas del banco en Gmail y te avisa cada movimiento. También registras gastos por chat. |
| Reuniones | Lee tu calendario personal y el de trabajo (vía satélite). Avisa 10 min antes con el link de Meet/Zoom/Teams. |
| Correos | Analiza solo los correos de ambas cuentas: extractos de tarjeta → pendiente de pago con fecha límite; suscripciones y cobros → resumen; reuniones, pagos rechazados y lo importante → aviso al instante. |
| Jira | Solo por API: tus actividades en estado **En curso** se vuelven pendientes de trabajo y se cierran solas cuando salen de ese estado (Config `JIRA_ESTADOS`). |
| Pendientes | Creados por chat, detectados en correos o asignados en Jira. Te avisa solo cuando vencen, con botón ✅ para cerrarlos. |
| Resumen | Todos los días a las 6:30 a. m. (configurable) y con `/resumen`. Incluye cómo van tus gastos vs. el mes anterior. |
| Conversación | Escribe sin comando: *"¿qué tengo mañana?"*, *"¿cuánto llevo gastado este mes?"*, *"redáctame una respuesta"*. Entiende varias cosas en un mensaje (*"cierra el 3 y crea el mismo para el lunes 10am"*). Gemini lo convierte en acciones reales o te contesta con los datos de la hoja. |
| Informes | `/informe` agrupa tus gastos por categoría (mercado, transporte, salud…) y los compara con el mes anterior. |
| Salud | `/estado` muestra triggers, errores, cola, tasa USD y sincronizaciones; un watchdog diario te avisa **solo** si algo falla. |

## Instalar (sin saber programar, ~15 min)

### 👉 [Abrir la plantilla y hacer una copia](https://docs.google.com/spreadsheets/d/19hycxoiEc7gdt3ZX6P8HvdIsJ--K_m9PETil2GUMEao/copy)

Cada persona tiene **su propia copia**: su bot, su Google y su hoja. Nadie más ve sus datos, ni siquiera el autor de la plantilla.

**Necesitas:**
- Un **computador** (la instalación no se puede hacer desde el celular).
- Tu **Gmail personal**.
- **Telegram** instalado en el celular o el computador.

### Paso 1. Crea tu bot en Telegram (3 min)
1. En Telegram, busca **@BotFather** (tiene un chulito azul) y ábrelo.
2. Toca **Iniciar** y escribe `/newbot`.
3. Te pide un **nombre**: escribe el que quieras, por ejemplo *Asistente de Ana*.
4. Te pide un **usuario**: tiene que terminar en `bot`, por ejemplo *ana_asistente_bot*. Si dice que ya existe, prueba con otro.
5. Te responde con un texto que incluye un código parecido a `123456789:AAH...`. Ese es tu **token**: cópialo y tenlo a mano. **No se lo compartas a nadie.**

### Paso 2. Copia la hoja del asistente (1 min)
1. En el computador, abre el [enlace de la plantilla](https://docs.google.com/spreadsheets/d/19hycxoiEc7gdt3ZX6P8HvdIsJ--K_m9PETil2GUMEao/copy).
2. Si te lo pide, entra con tu **Gmail personal**.
3. Toca el botón azul **Hacer una copia**. Se abre tu propia hoja de cálculo.
4. Espera unos 10 segundos: arriba, junto a "Ayuda", aparece un menú **🤖 Asistente**. Si no aparece, recarga la página.

### Paso 3. Instala (5 min)
1. Toca **🤖 Asistente → Instalar**.
2. Google te pide permisos:
   - Toca **Continuar** y elige tu Gmail.
   - Si sale **"Google no ha verificado esta aplicación"**, es normal: es tu propia copia. Toca **Configuración avanzada** y luego **Ir a … (no seguro)**.
   - Toca **Permitir**.
3. Si no se abre ninguna ventana, toca otra vez **🤖 Asistente → Instalar**.
4. En la ventana que aparece, pega tu **token** del Paso 1 y toca **Continuar**.

### Paso 4. Publica tu bot (4 min)
La ventana te muestra estos pasos. **No la cierres**: haz esto en una pestaña nueva.
1. En la hoja, toca el menú **Extensiones → Apps Script**. Se abre una pestaña nueva.
2. Arriba a la derecha, toca el botón azul **Implementar → Nueva implementación**.
3. Toca el engranaje ⚙️ al lado de "Seleccionar tipo" y elige **Aplicación web**.
4. Llena así:
   - **Ejecutar como:** Yo
   - **Quién tiene acceso:** Cualquier usuario
5. Toca **Implementar**. Si vuelve a pedir permisos, acéptalos igual que en el Paso 3.
6. Aparece una **URL de la aplicación web** que termina en `/exec`. Toca **Copiar**.
7. Vuelve a la pestaña de la hoja, pega esa URL en la ventana y toca **Conectar**.

### Paso 5. Abre tu bot (1 min)
1. Toca **Abrir en Telegram** y luego **Iniciar**.
2. El bot te saluda por tu nombre. ¡Ya quedó! Solo te responde a ti.

### Paso 6. Configúralo desde Telegram
Ya puedes escribirle normal: *"compra por nequi 40000"*, *"tarea: pagar el arriendo el viernes"* o `/resumen`.

Lo demás se configura **desde el chat** con `/configurar`:

| Botón | Qué hace |
|---|---|
| 🤖 IA | Pegas la API key gratis de [Google AI Studio](https://aistudio.google.com/apikey); el bot la valida y borra tu mensaje. |
| 🏦 Cuentas | Agregas bancos, billeteras, tarjetas o efectivo paso a paso, y eliges la cuenta por defecto. |
| 💼 Trabajo | *Opcional.* Te da un código para conectar tu cuenta de trabajo con la plantilla del satélite (menú **🔗 Satélite → Conectar**). |
| 🧩 Jira | *Opcional.* Sitio, correo y token, validados contra Jira. |
| ⏰ Preferencias | Hora del resumen, avisos de reuniones y vencimientos. Al cambiar la hora, el trigger se reprograma solo. |

Si no tienes cuenta de trabajo, el perfil `trabajo` no aparece en ningún lado.

### Si algo sale mal
- **No aparece el menú 🤖 Asistente:** recarga la hoja y espera unos segundos.
- **"Ese no parece un token":** cópialo otra vez completo desde @BotFather (`/mybots` → tu bot → *API Token*).
- **El bot no contesta:** revisa que en el Paso 4 elegiste **Cualquier usuario**. En la hoja, toca **🤖 Asistente → Estado del bot**.

### Actualizar
Cuando hay una versión nueva, el bot te avisa **una vez** con los pasos (2 min, se conservan tus datos y tu configuración). También puedes revisar con `/actualizar` o con el menú **🤖 Asistente → Buscar actualización**:
1. En la hoja: **Extensiones → Apps Script**.
2. **Bibliotecas → BotCiro** → elige la versión nueva → Guardar.
3. **Implementar → Gestionar implementaciones** → ✏️ → *Versión: Nueva versión* → Implementar. La URL no cambia.

> Google no deja que un script se actualice solo sin un proyecto propio de Google Cloud, por eso estos clics son manuales.

> **Confianza:** tu copia ejecuta el código de la biblioteca de quien te compartió la plantilla, con acceso a tu Gmail y tu calendario. Instálalo solo si confías en esa persona. Tus datos quedan en tu hoja y en tu copia, nunca en la biblioteca.

## Para el autor: publicar la biblioteca y las plantillas
Una sola vez, con `clasp login` en tu cuenta personal:
```bash
npm run biblioteca:crear       # proyecto "BotCiro (biblioteca)"; compártelo como Lector (cualquiera con el enlace)
npm run biblioteca:publicar    # tests → build → nueva versión → actualiza la plantilla
npm run plantilla:crear        # hoja plantilla con su script; comparte el enlace .../copy de arriba
npm run satelite:plantilla     # hoja plantilla del satélite (opcional)
```
Los IDs quedan en `biblioteca.json`. En cada versión nueva: sube `VERSION` y `NOTAS_VERSION_` (`src/Version.js`, `src/Actualizar.js`), corre `npm run biblioteca:publicar` y ejecuta `anunciarVersion()` en el editor de la biblioteca para que las copias reciban el aviso.

> **Nunca guardes secretos en las Propiedades del script de la biblioteca:** todas las copias pueden leerlas. Cada copia guarda sus datos en su propio almacén (`src/Contexto.js`).

<details>
<summary>Instalación avanzada: proyecto propio con clasp (sin plantilla)</summary>


#### 1. Crear el bot de Telegram
1. En Telegram, abre **@BotFather** → `/newbot` → ponle nombre.
2. Guarda el **token** que te entrega (no lo compartas ni lo subas a git).

#### 2. Subir el código a Apps Script
```bash
npm i -g @google/clasp
clasp login                       # con tu Gmail PERSONAL
```
Activa la API en https://script.google.com/home/usersettings (Google Apps Script API → On). Luego:
```bash
clasp create --type standalone --title botCiro --rootDir src
git checkout src/appsscript.json  # clasp create puede sobrescribir el manifiesto
clasp push
clasp open                        # abre el editor en el navegador
```

#### 3. Configurar en el editor de Apps Script
1. **Configuración del proyecto (⚙️) → Propiedades del script** → agrega `TELEGRAM_TOKEN` con el token del bot.
2. En el editor, selecciona la función **`setup`** → Ejecutar → acepta los permisos. En el registro verás el link de la hoja y tu **código de vinculación**.
3. **Implementar → Nueva implementación → Aplicación web**, con *Ejecutar como: Yo* y *Quién tiene acceso: Cualquier usuario*. Copia la URL que termina en `/exec` y guárdala como propiedad `WEBAPP_URL`.
4. Ejecuta **`registrarWebhook`**. El registro debe mostrar `ultimo_error: null`.
5. Ejecuta **`instalarTriggers`**.
6. En Telegram, escríbele a tu bot: `/vincular <código>`. Desde ese momento solo responde a tu chat.

#### 4. Análisis de correos con IA (cuenta personal)
Las reglas fijas reconocen alertas del banco, extractos, suscripciones, invitaciones y boletines. Lo que no encaja en ninguna regla lo analiza **Gemini** (Google AI Studio, nivel gratuito) para decidir si es importante y qué hay que hacer.
1. Crea una API key en https://aistudio.google.com/apikey con tu cuenta personal.
2. Guárdala en las Propiedades del script como `GEMINI_API_KEY`.
3. Opcional: ejecuta `modelosGemini` para ver los modelos disponibles y elige uno en `Config` → `GEMINI_MODELO`.

Sin API key el bot sigue funcionando, solo con reglas.

La misma API key enciende la **conversación**: lo que escribas sin comando (y que no sea un gasto o una tarea) lo interpreta Gemini y lo ejecuta con las mismas funciones del bot (saldo, agenda, pendientes, informe, búsqueda de correos…) o te contesta con el contexto real de la hoja. También puede redactarte un correo o un mensaje para que lo copies: **nunca envía nada solo**.

> **Tasa de cambio:** los montos en dólares se convierten a pesos con la **tasa real de Google** (`GOOGLEFINANCE("USD/COP")`, pestaña `Tasas` de la hoja), guardada 6 h. Si Google no responde, se usa `Config` → `TASA_USD` como respaldo. La ves en `/estado`.

> **Privacidad:** en el nivel gratuito, Google puede usar lo que se envía para mejorar sus productos. Por eso:
> - Solo se envían correos **personales** que las reglas no resolvieron, y antes se tapan correos electrónicos, teléfonos y números largos.
> - Los correos de **trabajo nunca pasan por la IA**: el satélite solo envía remitente, asunto y fecha, y se clasifican con reglas.
> - El cuerpo se guarda en la hoja solo mientras el correo espera en cola.
> - Para apagar la IA: `Config` → `IA_ACTIVA` = `no`.

#### 5. Conectar la cuenta de trabajo: satélite
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
   npm run satelite:login     # si se abre una ventana de navegador nueva, entra con tu cuenta de trabajo
   npm run satelite:crear     # crea el proyecto en tu cuenta de trabajo y sube el código
   npm run satelite:abrir
   ```
3. En el editor del satélite: ⚙️ → Propiedades del script → `SYNC_URL` = el valor del paso 1.
4. Ejecuta `instalar` y autoriza. A los segundos te llega por Telegram: *"Cuenta … conectada al perfil trabajo"*.

Para actualizar el satélite más adelante: `npm run satelite:push`.

#### 6. Jira
1. Crea un token en https://id.atlassian.com/manage-profile/security/api-tokens. Vence: el bot te avisa cuando deje de funcionar.
2. En las Propiedades del script del bot principal agrega `JIRA_SITIO` (p. ej. `miempresa.atlassian.net`), `JIRA_CORREO` (tu correo de Atlassian) y `JIRA_TOKEN`.
3. Prueba con `/jira` en Telegram. Solo se vuelven pendientes las actividades en **En curso**. Para cambiar los estados, edita `Config` → `JIRA_ESTADOS` (p. ej. `En curso, En revisión`; `todos` = todas las abiertas). Para cambiar qué se consulta, edita `JIRA_JQL`.

#### 7. Registrar tus cuentas
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

</details>

## Uso diario

```
/resumen                         saldos + reuniones de hoy + pendientes
/agenda trabajo semana           reuniones de los próximos 7 días
/tarea Enviar cotización al forwarder viernes 10am
/pendientes                      /hecho 3 5
/gasto 45000 almuerzo #nu        o en texto libre: "compra por nequi 45000", "almuerzo 25k con la nu"
"tengo 200 mil en nequi y debo 1.5 millones en la TC Rappi"   actualiza varios saldos
/ingreso 2 millones nómina
/ajustar ahorros 2310000         cuando veas el saldo real en la app del banco
/perfil trabajo                  lo que crees sin indicar perfil va a trabajo
/correos                         lo que el bot analizó en las últimas 24 h
/ignorar tienda.com              no volver a analizar ese remitente
/jira                            revisar ya tus actividades asignadas
/reunion Comité el jueves 3pm    crea el evento en tu calendario personal
/informe                         gastos del mes por categoría vs. mes anterior
/metricas                        qué tan acertado está el análisis (👍👎 de cada aviso)
/estado                          salud del sistema: versión, triggers, errores, tasa USD, sync
/configurar                      IA, cuentas, trabajo, Jira y preferencias con botones
/actualizar                      ver si hay versión nueva y cómo instalarla
/defecto nu                      cuenta por defecto cuando no pones #cuenta
/desvincular                     quitar este chat (para añadir tablet/PC, /vincular de nuevo)
"¿qué tengo mañana?"            con GEMINI_API_KEY, también entiendo preguntas normales
```

> El saldo es un **estimado**: suma lo que llega por correo y por chat. Si un banco no manda alerta de algún movimiento (cuota de manejo, intereses), concilia de vez en cuando con `/ajustar`.

## Varios chats y botones

- **Varios dispositivos:** el mismo código de `/vincular` sirve para agregar el chat de tu tablet o PC (el bot manda los avisos a todos). `/desvincular` quita el que estás usando.
- **Botones:** los avisos traen botones — ✅ para cerrar un pendiente, 👍/👎 para calificar el análisis, 🔗 para unirte a una reunión — sin tener que escribir nada.

## Mantenimiento automático

- **Recordatorios:** avisa una sola vez cuando un pendiente vence hoy o está vencido.
- **Retención:** los correos analizados se archivan pasados `DIAS_RETENCION_CORREOS` (60) y el `Log` en `DIAS_RETENCION_LOG` (30) con tope de `MAX_FILAS_LOG` (5000). Pendientes y movimientos **nunca** se borran.
- **Copia de seguridad:** copia semanal de la hoja a tu Drive (`backupDatos()`), conserva las últimas `BACKUPS_MAX` (8).
- **Un solo trigger:** todo lo periódico corre en `scheduler` (cada 5 min) con su propia frecuencia (Jira cada 10, salud y purga una vez al día, backup semanal), así se gasta mucha menos cuota de Apps Script.
- **Watchdog:** `revisarSalud()` corre a diario y solo te escribe si detecta alertas (triggers faltantes, errores seguidos, satélite desconectado, correos atascados).

## Bancos soportados
El parser es genérico y entiende las frases típicas de las alertas en Colombia ("Compraste", "Recibiste", "Transferiste", "Pagaste", "Retiraste"). Los remitentes reconocidos están en `src/BankParsers.js` → `BANCOS`. Para agregar un banco, suma su dominio ahí.

Los correos de banco que tienen un monto pero que no se pudieron interpretar quedan en la pestaña `Log` con nivel `revisar`. Si ves alguno, pégalo (anonimizado) en `test/bankParsers.test.js` y ajusta el parser.

## Desarrollo
```bash
npm test          # pruebas de parsers + flujo completo con servicios de Google simulados
npm run check     # revisa la sintaxis de src/, satelite/ y test/
npm run push      # sube cambios a Apps Script
```
En GitHub Actions (`.github/workflows/test.yml`) corren `npm run check` y `npm test` en cada push y PR.
`npm run push` solo actualiza el código del editor. Para que el bot use los cambios, ejecuta `npm run deploy`: crea una nueva versión sobre la misma implementación, así que la URL `/exec` y el webhook no cambian.
`npm run deploy` lee el ID de tu implementación del archivo local `.deployment-id`, que no se sube a git. Créalo una vez con el ID que muestra `clasp deployments`, el que termina en `@N` de tu app web, sin el `@N`.

> **Actualizaciones que cambian permisos:** el bot solo pide `gmail.readonly` (antes era Gmail completo). Si ya lo tenías instalado, vuelve a ejecutar `setup()` y acepta los permisos nuevos.

## Solución de problemas
- **Algo falla o se ve raro:** manda `/estado` en el chat: ahí ves triggers activos, errores de las últimas 24 h, correos en cola, IA, Jira, tasa USD y la última sincronización.
- **El bot no responde**: ejecuta `estadoWebhook()`. Si `ultimo_error` muestra un 302 u otro error recurrente, ejecuta `activarPolling()`: el bot pasa a leer mensajes cada minuto, sin webhook.
- **Errores en general**: revisa la pestaña `Log` de la hoja y el panel **Ejecuciones** del editor.
- **Cuotas gratuitas** (cuenta personal): 90 min/día de triggers. El uso estimado es de ~15 min/día.
