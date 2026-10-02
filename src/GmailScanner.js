/**
 * Trigger periódico: movimientos desde correos del banco y análisis de correos (Correos.js).
 */

const MAX_IGNORADOS_ = 500;
const VENTANA_DIAS_ = 3;

function escanearGmail() {
  try {
    conBloqueo_(() => {
      escanearBancos_();
      escanearCorreosPersonales_();
    });
    // Sin bloqueo global: la IA puede tardar y bloquearía los comandos de Telegram.
    // procesarColaCorreos_ bloquea solo al escribir cada correo.
    procesarColaCorreos_();
  } catch (err) {
    registrarError_('escanearGmail', err);
  }
}

/** Busca la cuenta del correo: por banco + últimos 4; si el banco tiene una sola cuenta, esa. */
function cuentaDeCorreo_(mov, cuentas) {
  const delBanco = cuentas.filter((c) => normalizar_(c.banco) === mov.banco || normalizar_(c.banco) === normalizar_(mov.bancoNombre));
  if (mov.ultimos4) {
    const exacta = delBanco.find((c) => ultimos4_(c.ultimos4) === mov.ultimos4);
    if (exacta) return exacta;
  }
  return delBanco.length === 1 && !ultimos4_(delBanco[0].ultimos4) ? delBanco[0] : null;
}

function escanearBancos_() {
  const dominios = BANCOS.reduce((acc, b) => acc.concat(b.remitentes), []);
  const query = `from:(${dominios.join(' OR ')}) newer_than:${VENTANA_DIAS_}d`;
  const hilos = GmailApp.search(query, 0, 50);
  if (!hilos.length) return 0;

  const cuentas = leer_('Cuentas');
  const vistos = new Set(leer_('Movimientos').map((m) => String(m.gmail_msg_id)).filter(Boolean));
  const ignorados = JSON.parse(prop_('GMAIL_IGNORADOS') || '[]');
  const setIgnorados = new Set(ignorados);
  const limite = Date.now() - VENTANA_DIAS_ * 86400000;
  const avisos = [];
  let nuevos = 0;

  hilos.forEach((hilo) => {
    // Gmail agrupa en un mismo hilo las alertas con igual asunto: se revisa mensaje por mensaje.
    hilo.getMessages().forEach((msg) => {
      const id = msg.getId();
      if (vistos.has(id) || setIgnorados.has(id) || msg.getDate().getTime() < limite) return;

      const texto = msg.getSubject() + '\n' + msg.getPlainBody();
      const mov = parseCorreoBanco_(msg.getFrom(), texto);
      if (!mov) {
        ignorados.push(id);
        setIgnorados.add(id);
        // Los extractos los procesa el pipeline de correos; solo queda en Log lo realmente desconocido.
        if (!esExtracto_(texto) && /(?:\$|COP)\s?\d/.test(texto)) {
          registrarLog_('revisar', 'escanearBancos_', 'Correo de banco con monto que no pude interpretar: ' + msg.getSubject(), redactar_(texto).slice(0, 1000));
        }
        return;
      }

      const cuenta = cuentaDeCorreo_(mov, cuentas);
      const saldo = registrarMovimiento_({
        cuenta: cuenta,
        perfil: 'personal',
        fecha: msg.getDate(),
        tipo: mov.tipo,
        monto: mov.monto,
        descripcion: mov.descripcion,
        fuente: 'correo',
        gmail_msg_id: id,
      });
      vistos.add(id);
      nuevos++;

      const signo = mov.tipo === 'credito' ? '+' : '−';
      let aviso = `${mov.tipo === 'credito' ? '💵' : '💳'} ${esc_(mov.bancoNombre)}${mov.ultimos4 ? ' *' + mov.ultimos4 : ''}: ${signo}${formatCOP_(mov.monto)} ${esc_(mov.comercio)}`;
      if (cuenta) {
        aviso += `\nSaldo est. ${esc_(nombreCuenta_(cuenta))}: <b>${formatCOP_(saldo)}</b>`;
      } else {
        aviso += `\n⚠️ No tengo esa cuenta registrada. Créala con <code>/nuevacuenta ${mov.banco} alias ${mov.ultimos4 || '1234'} saldo</code>`;
      }
      avisos.push(aviso);
    });
  });

  setProp_('GMAIL_IGNORADOS', JSON.stringify(ignorados.slice(-MAX_IGNORADOS_)));
  enviarAgrupado_('💳 <b>Movimientos bancarios</b>', avisos);
  return nuevos;
}

/** Un solo mensaje con todos los avisos; si Telegram falla, no se pierde el resto del escaneo. */
function enviarAgrupado_(titulo, avisos) {
  if (!avisos.length || !hayChats_()) return;
  try {
    enviar_(titulo + '\n' + avisos.join('\n\n'));
  } catch (err) {
    registrarError_('enviarAgrupado_', err);
  }
}
