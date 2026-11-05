// ============================================================
// Seguimiento automático a leads que dejaron de responder
// ------------------------------------------------------------
// Si el último mensaje de la conversación es del bot y el lead
// lleva varias horas sin contestar, se le escribe UNA vez para
// reavivar la conversación. Solo dentro de la ventana de 24 h
// desde su último mensaje (ahí WhatsApp no cobra); pasado ese
// plazo haría falta una plantilla de pago, así que no se envía.
// ============================================================
const logger = require("firebase-functions/logger");
const store = require("./store");
const brain = require("./brain");
const wa = require("./whatsapp");
const { getBotSettings } = require("./botsettings");

const HORA = 60 * 60 * 1000;
const VENTANA_MS = 23 * HORA; // margen de 1 h bajo las 24 h de WhatsApp
const MAX_POR_CONVERSACION = 2; // seguimientos en total por lead
const MAX_POR_EJECUCION = 4; // el modelo gratuito admite ~5 peticiones/min

// Turno ficticio para que el modelo sepa que le toca escribir a él.
const DISPARADOR =
  "[SISTEMA: el cliente ya recibió la información y no ha vuelto a escribir. Escribe ahora tu mensaje activador.]";

// El modelo deducía el servicio del historial y a veces se equivocaba (le
// ofreció "¿le espero a las 8 o a las 9?" a un cliente de eventos).
function servicioDelChat(conv) {
  let seg = conv.segment;
  if (!seg) {
    const b = conv.brochuresSent || [];
    seg = b.includes("eventos") && !b.includes("escuela") ? "eventos" : b.includes("escuela") ? "escuela" : null;
  }
  if (seg === "eventos") return "\n\nESTE CHAT ES DE EVENTOS (Casino de Fantasía): trata de USTED y NUNCA ofrezcas Pase VIP, visitas ni citas con horario.";
  if (seg === "escuela") return "\n\nESTE CHAT ES DE LA ESCUELA DE DEALERS: trata de tú.";
  return "";
}

const INSTRUCCION = `
## MODO ACTIVADOR (solo para este mensaje)
El cliente recibió nuestra información y no ha vuelto a escribir. Tu mensaje NO es un recordatorio ni una súplica: es un ACTIVADOR. Su objetivo es hacerlo pensar en lo que busca y llevarlo a dar el siguiente paso.

Estructura (en este orden, 5 líneas como máximo):
1. Su nombre, si lo sabes. Mantén el trato que venías usando (tú en Escuela, usted en eventos).
2. Nuestros TRES puntos más fuertes PARA LO QUE ESA PERSONA BUSCA, uno por línea y muy cortos (máximo 8 palabras cada uno). Elígelos según lo que dijo: su meta, su evento, su duda. Si no dijo nada, usa los tres más fuertes de ese servicio. En Escuela, si el punto está en el catálogo y ya se le envió, puedes citar la página. En Eventos, si ayuda, remite a https://dealerclubpe.com/servicios (o al catálogo, solo si ya se le envió).
3. La pregunta que lo hace decidir. En ESCUELA es siempre la cita: ofrece su Pase VIP con dos horarios concretos y reales (mira el Contexto temporal y los horarios de visita), ej.: "¿Te espero mañana a las 10 a. m. o a las 4 p. m.?". En EVENTOS: de lo que vio, qué es lo que más se acerca a lo que busca y qué le genera dudas, para poder avanzar.

Hazlo PERSONAL: usa lo que ESA persona contó (su juego, el programa que le recomendaste, su problema de horario, lo que preguntó de la ubicación). Un mensaje que podría mandarse a cualquiera no sirve. En Escuela solo cites páginas del catálogo si en la conversación consta que ya se le envió.

Puntos fuertes de donde elegir:
- Escuela: todo incluido con certificación · bolsa de trabajo · se empieza desde cero, sin experiencia · clases que arrancan todos los lunes · horario personalizado si trabajas o estudias · Pase VIP: 30 minutos en una clase real sin costo. Si la persona habló de cruceros o llegó por ese anuncio, úsalo en positivo (el primer paso hacia esa meta), sin prometer el embarque.
- Eventos: dealers profesionales formados en nuestra escuela · traslado, montaje y desmontaje incluidos · la dirección de DealerClub presente en su evento · 3 h de evento con hasta 3 mesas a la vez · empresa formal con contrato · reserva incluso con 48 h de anticipación. En eventos NUNCA des precios.

Tono: seguro y directo, de quien ofrece algo bueno y no necesita insistir.
PROHIBIDO: mencionar que no respondió ("no me respondiste", "¿sigue ahí?", "quedé a la espera", "le recuerdo", "retomando"), pedir por favor que conteste, disculparte por escribir, crear urgencia ("últimos cupos", "solo por hoy"), ofrecer descuentos, volver a enviar el catálogo o poner etiquetas [[...]].

Ejemplos del tono (no los copies literal; adapta los tres puntos a la persona):
- Eventos: "Sra. Torres, para un cumpleaños como el suyo, esto es lo que más valoran nuestros clientes:\n• Dealers profesionales que enseñan a jugar a sus invitados\n• Traslado, montaje y desmontaje a nuestro cargo\n• Hasta 3 mesas funcionando a la vez\nDe lo que conversamos, ¿qué es lo que más se acerca a lo que busca y qué le genera dudas? Indíqueme para poder avanzar."
- Escuela: "Carlos, para lo que buscas (Blackjack y empezar desde cero), esto es lo que más te sirve:\n• Practicas en mesa real desde la primera semana\n• Certificación y bolsa de trabajo incluidas\n• Arrancas cualquier lunes\nVen a verlo con tu Pase VIP, 30 minutos en una clase real: ¿te espero mañana a las 10 a. m. o a las 4 p. m.?"

Si la conversación ya se cerró de forma natural (se despidió, ya agendó su Pase VIP, ya tiene su cotización en manos de un asesor, o pidió que no le escriban), NO hay nada que activar: responde únicamente con la palabra NO.
`;

// Hora y día de la semana en Lima (0 = domingo … 6 = sábado).
function ahoraLima(ms = Date.now()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima", hour: "numeric", hour12: false, weekday: "short",
  }).formatToParts(new Date(ms));
  const hora = Number(partes.find((p) => p.type === "hour").value) % 24;
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(partes.find((p) => p.type === "weekday").value);
  return { hora, dia };
}

// Lunes la gente arranca cargada y los viernes por la tarde ya desconectó:
// esos días se escribe solo en la franja en que es más probable que lean.
// (No se puede esperar a mitad de semana: la ventana gratuita dura 24 h.)
const LUNES_DESDE = 11;
const VIERNES_HASTA = 16;
function enHorario(followUp, { hora, dia } = ahoraLima()) {
  const desde = dia === 1 ? Math.max(followUp.from, LUNES_DESDE) : followUp.from;
  const hasta = dia === 5 ? Math.min(followUp.to, VIERNES_HASTA) : followUp.to;
  return hora >= desde && hora < hasta;
}

// Decide si a esta conversación le toca seguimiento. Devuelve el ts del
// último mensaje del lead (para no repetir en el mismo silencio) o null.
function tocaSeguimiento(conv, ahora, horasSilencio) {
  if (!conv || conv.humanTakeover) return null;
  if (conv.vipAt && conv.vipAt > ahora) return null; // ya tiene cita: de eso se ocupa la confirmación
  if (conv.pactadoAt && conv.pactadoAt > ahora) return null; // ya quedamos en escribirle a una hora
  const history = conv.history || [];
  const ultimo = history[history.length - 1];
  if (!ultimo || ultimo.role !== "assistant") return null; // el lead tiene la palabra
  const ultimoLead = [...history].reverse().find((h) => h.role === "user");
  if (!ultimoLead || !ultimoLead.ts) return null;
  if (ahora - ultimo.ts < horasSilencio * HORA) return null; // aún es pronto
  if (ahora - ultimoLead.ts > VENTANA_MS) return null; // ventana gratuita cerrada
  if (conv.followUpForTs === ultimoLead.ts) return null; // ya se le escribió en este silencio
  if ((conv.followUps || 0) >= MAX_POR_CONVERSACION) return null;
  return ultimoLead.ts;
}

// --- Chats en pausa sin respuesta ----------------------------
// REGLA DE KEVIN (5 nov 2026): en un chat en pausa (humanTakeover) el bot
// NUNCA escribe solo: ni respuesta, ni seguimiento, ni recordatorio. Antes
// existía un "rescate" que a las 2 h le contestaba al cliente y quitaba la
// pausa; se eliminó. Ahora, si el cliente escribió y nadie le contestó en
// AVISO_PAUSA_HORAS, solo se le avisa a Kevin (ntfy), una vez por silencio.
const AVISO_PAUSA_HORAS = 2;
// ¿El mensaje solo agradece, asiente o se despide? ("ok, gracias", "listo 👍",
// "perfecto, muchas gracias"). No pide nada: la conversación terminó bien y
// contestarle de nuevo la estira sin necesidad.
const PALABRAS_ACUSE = new Set(("ok okay oki okis okey vale listo perfecto genial excelente super súper entendido entiendo de acuerdo dale ya " +
  "bueno buenisimo buenísimo gracias muchas mil muchisimas muchísimas thanks thank you igualmente a ti usted ustedes saludos bendiciones " +
  "chévere chevere bacán bacan claro sí si y que tenga tengan buen buena día dia tarde noche").split(" "));
function esAcuse(texto) {
  const t = (texto || "").toLowerCase().replace(/[^\p{L}\s]/gu, " ").trim();
  if (!t) return /\p{Extended_Pictographic}/u.test(texto || ""); // solo emojis
  const palabras = t.split(/\s+/);
  return palabras.length <= 8 && palabras.every((p) => PALABRAS_ACUSE.has(p));
}

// "Ok, gracias, lo converso y le aviso", "lo reviso y le confirmo", "quedo
// atenta": deja la decisión en sus manos. Escribirle de nuevo es insistir.
const FRASE_CIERRE = new RegExp(
  "\\b(l[oae]s?|te)\\s+(reviso|revisamos|converso|conversamos|consulto|consultamos|coordino|coordinamos|comento|comentamos|" +
  "pienso|pensamos|evaluo|evalúo|evaluamos|analizo|analizamos|veo|vemos|aviso|avisamos|confirmo|confirmamos|escribo|escribimos)\\b" +
  "|\\b(estamos|quedamos)\\s+en\\s+contacto\\b|\\bquedo\\s+(atenta|atento|pendiente)\\b|\\bcualquier\\s+cosa\\s+(le|te)\\s+(escribo|aviso)\\b", "i");
// Si pide o pregunta algo, no es un cierre aunque agradezca.
const PIDE_ALGO = /\?|(?<!\p{L})(consulta|pregunta|duda|cu[aá]nto|c[oó]mo|qu[eé]|d[oó]nde|cu[aá]ndo|podr[ií]a|puede[ns]?|quisiera|necesito|me\s+env[ií]a|env[ií]e)(?!\p{L})/iu;
function esCierre(texto) {
  if (esAcuse(texto)) return true;
  const t = texto || "";
  return t.split(/\s+/).length <= 20 && FRASE_CIERRE.test(t) && !PIDE_ALGO.test(t);
}

// ¿La conversación terminó con el último mensaje del lead? Un "ok" suelto a
// una pregunta nuestra puede ser un sí que pide el siguiente paso; un "lo
// converso y le aviso" cierra siempre.
function cerroConversacion(history) {
  const ultimo = history[history.length - 1];
  if (!ultimo || ultimo.role !== "user") return false;
  if (!esAcuse(ultimo.text)) return esCierre(ultimo.text);
  const anterior = history[history.length - 2];
  return anterior?.role === "assistant" && !(anterior.text || "").includes("?");
}

// Para lo que la lista de frases no alcanza a ver (lo usa el webhook al
// recibir un mensaje): el modelo lee el final del
// chat y decide si al lead le hace falta una respuesta. Ante un error, se
// responde (es peor dejar a alguien sin respuesta que una de más).
const ENCARGO_CIERRE =
  "Lees el final de una conversación de WhatsApp entre DealerClub (asesor o bot) y un cliente. Decide si el ÚLTIMO mensaje del cliente necesita una respuesta nuestra. " +
  "NO la necesita si solo agradece, asiente, se despide, confirma que recibió la información o la cotización, o dice que lo va a revisar, conversar o pensar y que avisará: " +
  "ahí la conversación quedó en sus manos y volver a escribirle es insistir. " +
  "SÍ la necesita si pregunta o pide algo, da un dato nuevo que hay que atender, pone una objeción, o responde a una pregunta nuestra con algo que exige el siguiente paso (por ejemplo, acepta separar la fecha). " +
  'Devuelve SOLO un JSON: {"responder": true} o {"responder": false}.';
async function necesitaRespuesta(history) {
  const texto = history.slice(-12).map((h) => `${h.role === "user" ? "Cliente" : "DealerClub"}: ${h.text || ""}`).join("\n");
  try {
    const r = await brain.generateJson(ENCARGO_CIERRE, texto);
    return r?.responder !== false;
  } catch (e) {
    logger.warn("No se pudo evaluar si el mensaje pide respuesta", { error: e.message });
    return true;
  }
}

// ¿Hay que avisarle a Kevin que un chat en pausa espera respuesta?
// Devuelve el ts del mensaje del cliente (para avisar una sola vez) o null.
function tocaAvisoPausa(conv, ahora) {
  if (!conv || !conv.humanTakeover) return null;
  const history = conv.history || [];
  const ultimo = history[history.length - 1];
  if (!ultimo || ultimo.role !== "user" || !ultimo.ts) return null; // ya le respondieron
  if (/^\[reacción/.test(ultimo.text || "")) return null;
  if (cerroConversacion(history)) return null;
  if (ahora - ultimo.ts < AVISO_PAUSA_HORAS * HORA) return null; // el asesor aún tiene tiempo
  if (ahora - ultimo.ts > VENTANA_MS) return null; // ya no se le puede escribir gratis
  if (conv.rescueForTs === ultimo.ts) return null; // ya se avisó por este mensaje
  return ultimo.ts;
}
// Solo avisa a Kevin. NUNCA le escribe al cliente ni quita la pausa.
async function avisarPausados(snap, ahora) {
  const notify = require("./notify");
  const cfg = require("./config");
  let avisados = 0;
  for (const doc of snap.docs) {
    const conv = doc.data();
    const ts = tocaAvisoPausa(conv, ahora);
    if (!ts) continue;
    const phone = doc.id;
    try {
      await store.db.collection("wa_conversations").doc(phone).set({ rescueForTs: ts }, { merge: true });
      const horas = Math.floor((ahora - ts) / HORA);
      const quedan = Math.max(0, Math.floor((ts + VENTANA_MS - ahora) / HORA));
      await notify.notifyHuman(cfg.NTFY_TOPIC.value(), {
        title: "Chat en pausa sin responder",
        message: `${conv.name || "Un lead"} (+${phone}) escribió hace ${horas} h y nadie le contestó. ` +
          `El bot sigue en pausa y no le escribirá. Te quedan unas ${quedan} h para responderle gratis.`,
        click: "https://dealerclubpe.web.app/?to=" + phone,
        priority: "default",
        tags: "hourglass",
      });
      avisados++;
      logger.info("Aviso a Kevin: chat en pausa sin respuesta", { phone });
    } catch (err) {
      logger.error("No se pudo avisar del chat en pausa", { phone, error: err.message });
    }
  }
  return avisados;
}

// Última barrera antes de CUALQUIER envío automático: se vuelve a leer el
// chat en ese instante (el modelo tarda unos segundos y Kevin puede haberlo
// pausado mientras tanto). true = se puede enviar.
async function puedeEnviarAuto(phone, motivo) {
  if (await store.isHumanTakeover(phone)) {
    logger.info("Envío automático cancelado: el chat está en pausa", { phone, motivo });
    return false;
  }
  return true;
}

// --- Seguimiento pactado --------------------------------------
// Cuando el cliente aceptó "mañana a las 11 le escribo", se le escribe a esa
// hora (si la ventana de 24 h sigue abierta), esté o no encendido el activador:
// es un compromiso que tomamos con él.
const PACTADO = `
## MODO SEGUIMIENTO PACTADO (solo para este mensaje)
Quedaste con el cliente en escribirle a esta hora. Retoma como quien cumple lo que prometió: salúdalo por su nombre, recuerda en una línea lo que estaba evaluando (su cotización, su programa, su Pase VIP) y haz UNA pregunta que pida el siguiente paso concreto (en eventos: si separamos la fecha con el adelanto; en Escuela: qué día viene a su Pase VIP). Breve, máximo 3 líneas, con el mismo trato (tú o usted) que se venía usando. No pongas etiquetas [[...]].`;
function tocaPactado(conv, ahora, ultimoDelLead) {
  if (!conv || conv.humanTakeover || !conv.pactadoAt || conv.pactadoAt > ahora) return false;
  if (conv.pactadoDoneFor === conv.pactadoAt) return false;
  return !!ultimoDelLead && ahora - ultimoDelLead <= VENTANA_MS;
}
async function enviarPactados(snap, ahora) {
  let enviados = 0;
  for (const doc of snap.docs) {
    const conv = doc.data();
    if (!tocaPactado(conv, ahora, store.lastInboundOf(conv))) continue;
    const phone = doc.id;
    const ref = store.db.collection("wa_conversations").doc(phone);
    try {
      await ref.set({ pactadoDoneFor: conv.pactadoAt }, { merge: true });
      const history = (conv.history || []).slice(-40).map((h) => ({ role: h.role, text: h.text }));
      history.push({ role: "user", text: "[SISTEMA: es la hora que acordaste con el cliente para escribirle. Escribe ahora tu mensaje.]" });
      const texto = ((await brain.generateReply(history, { extra: PACTADO + servicioDelChat(conv) })) || "")
        .replace(/\[\[[^\]]*\]\]/g, "").replace(/\*\*(.+?)\*\*/gs, "*$1*").trim();
      if (!texto) continue;
      if (store.repiteUltimo(conv, texto)) continue;
      if (!(await puedeEnviarAuto(phone, "pactado"))) continue;
      const r = await wa.sendText(phone, texto);
      if (r && r.error) throw new Error(JSON.stringify(r.error));
      await store.appendMessages(phone, [{ role: "assistant", text: texto, ts: Date.now(), waId: r?.messages?.[0]?.id || null, followUp: true, auto: "pactado" }]);
      enviados++;
      logger.info("Seguimiento pactado enviado", { phone });
    } catch (err) {
      logger.error("No se pudo enviar el seguimiento pactado", { phone, error: err.message });
    }
  }
  return enviados;
}

// --- Confirmación de citas (Pase VIP) -----------------------
// No podemos escribirle a nadie pasadas 24 h de su último mensaje, así que
// la confirmación se pide ANTES de que ese plazo se cierre; su respuesta lo
// renueva y permite el recordatorio del mismo día. Ver lib/citas.js.
const citas = require("./citas");
function tocaCita(conv, ahora) {
  if (!conv || conv.humanTakeover) return null;
  return citas.tocaRecordatorio(conv, ahora, ahoraLima(ahora).hora, store.lastInboundOf(conv));
}
async function confirmarCitas(snap, ahora) {
  let enviados = 0;
  for (const doc of snap.docs) {
    const conv = doc.data();
    const tipo = tocaCita(conv, ahora);
    if (!tipo) continue;
    const phone = doc.id;
    try {
      const texto = citas.textoRecordatorio(tipo, conv);
      if (store.repiteUltimo(conv, texto)) continue;
      if (!(await puedeEnviarAuto(phone, "cita"))) continue;
      const r = await wa.sendText(phone, texto);
      if (r && r.error) throw new Error(JSON.stringify(r.error));
      await store.appendMessages(phone, [{ role: "assistant", text: texto, ts: Date.now(), waId: r?.messages?.[0]?.id || null, auto: "cita" }]);
      await store.db.collection("wa_conversations").doc(phone).set({ [citas.MARCA[tipo]]: conv.vipAt }, { merge: true });
      enviados++;
      logger.info("Recordatorio de cita enviado", { phone, tipo });
    } catch (err) {
      logger.error("No se pudo enviar el recordatorio de cita", { phone, error: err.message });
    }
  }
  return enviados;
}

async function run() {
  const ahora0 = Date.now();
  const recientes = await store.db
    .collection("wa_conversations")
    .where("updatedAt", ">=", new Date(ahora0 - 24 * HORA))
    .get();
  const citasConfirmadas = await confirmarCitas(recientes, ahora0);
  const pactados = await enviarPactados(recientes, ahora0);
  const avisosPausa = await avisarPausados(recientes, ahora0);

  const { followUp } = await getBotSettings();
  if (!followUp.enabled) return { enviados: 0, avisosPausa, citasConfirmadas, pactados, motivo: "desactivado" };

  if (!enHorario(followUp)) return { enviados: 0, avisosPausa, citasConfirmadas, pactados, motivo: "fuera de horario" };

  const ahora = Date.now();
  const snap = recientes;

  let enviados = 0;
  for (const doc of snap.docs) {
    if (enviados >= MAX_POR_EJECUCION) break;
    const conv = doc.data();
    const tsLead = tocaSeguimiento(conv, ahora, followUp.hours);
    if (!tsLead) continue;

    const phone = doc.id;
    try {
      const history = (conv.history || []).slice(-40).map((h) => ({ role: h.role, text: h.text }));
      history.push({ role: "user", text: DISPARADOR });
      const reply = await brain.generateReply(history, { extra: INSTRUCCION + servicioDelChat(conv) });
      const texto = (reply || "")
        .replace(/\[\[[^\]]*\]\]/g, "")
        .replace(/\*\*(.+?)\*\*/gs, "*$1*")
        .trim();

      // Se marca el silencio como atendido incluso si el modelo decidió no escribir.
      const marca = { followUpForTs: tsLead };
      if (!texto || /^NO\b[.!]?$/i.test(texto)) {
        await store.db.collection("wa_conversations").doc(phone).set(marca, { merge: true });
        logger.info("Seguimiento omitido: conversación cerrada", { phone });
        continue;
      }

      if (store.repiteUltimo(conv, texto)) continue;
      if (!(await puedeEnviarAuto(phone, "seguimiento"))) continue;
      const r = await wa.sendText(phone, texto);
      if (r && r.error) throw new Error(JSON.stringify(r.error));
      await store.appendMessages(phone, [
        { role: "assistant", text: texto, followUp: true, auto: "seguimiento", ts: Date.now(), waId: r?.messages?.[0]?.id || null },
      ]);
      await store.db
        .collection("wa_conversations")
        .doc(phone)
        .set({ ...marca, followUps: store.FieldValue.increment(1) }, { merge: true });
      enviados++;
      logger.info("Seguimiento enviado", { phone });
    } catch (err) {
      logger.error("No se pudo enviar el seguimiento", { phone, error: err.message });
    }
  }
  return { enviados, avisosPausa, citasConfirmadas, pactados };
}

// --- Lo que el bot tiene programado en un chat (para el panel) ----
// Recorre las próximas 24 h en pasos de 30 min (lo que tarda la tarea en
// volver a pasar) con las MISMAS reglas que deciden el envío, suponiendo que
// nadie escribe antes. Un chat en pausa nunca tiene nada programado.
const PASO_MS = 30 * 60 * 1000;
function proximosAutomaticos(conv, followUp, ahora = Date.now()) {
  if (!conv || conv.humanTakeover) return [];
  const ultimoDelLead = store.lastInboundOf(conv);
  const encontrados = {};
  for (let t = ahora; t <= ahora + 24 * HORA; t += PASO_MS) {
    if (!encontrados.seguimiento && followUp.enabled && enHorario(followUp, ahoraLima(t)) && tocaSeguimiento(conv, t, followUp.hours)) {
      encontrados.seguimiento = { tipo: "seguimiento", at: t };
    }
    if (!encontrados.pactado && tocaPactado(conv, t, ultimoDelLead)) {
      encontrados.pactado = { tipo: "pactado", at: t };
    }
    const cita = !encontrados.cita && tocaCita(conv, t);
    if (cita) encontrados.cita = { tipo: "cita", at: t, detalle: cita };
  }
  return Object.values(encontrados).sort((a, b) => a.at - b.at);
}

// Cancela lo programado de un tipo marcándolo como ya atendido (las mismas
// marcas que deja el envío). Devuelve el parche para el documento del chat.
function parcheCancelar(conv, tipo) {
  if (tipo === "seguimiento") {
    const ultimoLead = [...(conv.history || [])].reverse().find((h) => h.role === "user" && h.ts);
    return ultimoLead ? { followUpForTs: ultimoLead.ts } : null;
  }
  if (tipo === "pactado") return conv.pactadoAt ? { pactadoDoneFor: conv.pactadoAt } : null;
  if (tipo === "cita") return conv.vipAt ? { [citas.MARCA.confirmar]: conv.vipAt, [citas.MARCA.hoy]: conv.vipAt } : null;
  return null;
}

module.exports = {
  run, tocaSeguimiento, tocaAvisoPausa, tocaPactado, tocaCita, esAcuse, esCierre, cerroConversacion, necesitaRespuesta,
  enHorario, proximosAutomaticos, parcheCancelar, INSTRUCCION, AVISO_PAUSA_HORAS, MAX_POR_CONVERSACION,
};
