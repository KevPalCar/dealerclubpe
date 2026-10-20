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

const INSTRUCCION = `
## MODO ACTIVADOR (solo para este mensaje)
El cliente recibió nuestra información y no ha vuelto a escribir. Tu mensaje NO es un recordatorio ni una súplica: es un ACTIVADOR. Su objetivo es hacerlo pensar en lo que busca y llevarlo a dar el siguiente paso.

Estructura (en este orden, 5 líneas como máximo):
1. Su nombre, si lo sabes. Mantén el trato que venías usando (tú en Escuela, usted en eventos).
2. Nuestros TRES puntos más fuertes PARA LO QUE ESA PERSONA BUSCA, uno por línea y muy cortos (máximo 8 palabras cada uno). Elígelos según lo que dijo: su meta, su evento, su duda. Si no dijo nada, usa los tres más fuertes de ese servicio. Si el punto está en el catálogo, dilo ("lo ve en el catálogo"; en Escuela puedes citar la página).
3. La pregunta que lo hace decidir. En ESCUELA es siempre la cita: ofrece su Pase VIP con dos horarios concretos y reales (mira el Contexto temporal y los horarios de visita), ej.: "¿Te espero mañana a las 10 a. m. o a las 4 p. m.?". En EVENTOS: de lo que vio, qué es lo que más se acerca a lo que busca y qué le genera dudas, para poder avanzar.

Hazlo PERSONAL: usa lo que ESA persona contó (su juego, el programa que le recomendaste, su problema de horario, lo que preguntó de la ubicación). Un mensaje que podría mandarse a cualquiera no sirve. En Escuela solo cites páginas del catálogo si en la conversación consta que ya se le envió.

Puntos fuertes de donde elegir:
- Escuela: todo incluido con certificación · bolsa de trabajo · se empieza desde cero, sin experiencia · clases que arrancan todos los lunes · horario personalizado si trabajas o estudias · Pase VIP: 30 minutos en una clase real sin costo. No uses cruceros como gancho.
- Eventos: dealers profesionales formados en nuestra escuela · traslado, montaje y desmontaje incluidos · la dirección de DealerClub presente en su evento · 3 h de evento con hasta 3 mesas a la vez · empresa formal con contrato · reserva incluso con 48 h de anticipación. En eventos NUNCA des precios.

Tono: seguro y directo, de quien ofrece algo bueno y no necesita insistir.
PROHIBIDO: mencionar que no respondió ("no me respondiste", "¿sigue ahí?", "quedé a la espera", "le recuerdo", "retomando"), pedir por favor que conteste, disculparte por escribir, crear urgencia ("últimos cupos", "solo por hoy"), ofrecer descuentos, volver a enviar el catálogo o poner etiquetas [[...]].

Ejemplos del tono (no los copies literal; adapta los tres puntos a la persona):
- Eventos: "Sra. Torres, para un cumpleaños como el suyo, esto es lo que más valoran nuestros clientes:\n• Dealers profesionales que enseñan a jugar a sus invitados\n• Traslado, montaje y desmontaje a nuestro cargo\n• Hasta 3 mesas funcionando a la vez\nDe lo que vio en el catálogo, ¿qué es lo que más se acerca a lo que busca y qué le genera dudas? Indíqueme para poder avanzar."
- Escuela: "Carlos, para lo que buscas (Blackjack y empezar desde cero), esto es lo que más te sirve:\n• Practicas en mesa real desde la primera semana\n• Certificación y bolsa de trabajo incluidas\n• Arrancas cualquier lunes\nVen a verlo con tu Pase VIP, 30 minutos en una clase real: ¿te espero mañana a las 10 a. m. o a las 4 p. m.?"

Si la conversación ya se cerró de forma natural (se despidió, ya agendó su Pase VIP, ya tiene su cotización en manos de un asesor, o pidió que no le escriban), NO hay nada que activar: responde únicamente con la palabra NO.
`;

// Hora y día de la semana en Lima (0 = domingo … 6 = sábado).
function ahoraLima() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima", hour: "numeric", hour12: false, weekday: "short",
  }).formatToParts(new Date());
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

// --- Rescate de chats en pausa ------------------------------
// Con el bot en pausa responde una persona. Si el lead escribió y nadie le
// contestó en RESCATE_HORAS, el bot retoma el chat (una vez por silencio)
// antes de que se cierre la ventana gratuita de 24 h.
const RESCATE_HORAS = 2;
const RESCATE = `
## MODO RELEVO (solo para este mensaje)
Un asesor humano estaba atendiendo este chat y no ha podido responder el último mensaje del cliente. Retomas tú.
- Responde lo último que escribió, con datos reales. No contradigas nada de lo que el asesor ya dijo en la conversación (precios, horarios acordados, condiciones): eso manda.
- Si lo que pide solo puede decidirlo el asesor (una cotización, el adicional de un horario personalizado, un caso especial), dilo con claridad, sin inventar el dato, y avanza con lo que sí puedes: en Escuela, la cita del Pase VIP con dos horarios; en eventos, el dato que falte para cotizar.
- No pongas etiquetas [[...]].
Si su último mensaje no necesita respuesta (agradece, se despide, solo confirma), responde únicamente con la palabra NO.
`;
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

function tocaRescate(conv, ahora) {
  if (!conv || !conv.humanTakeover) return null;
  const history = conv.history || [];
  const ultimo = history[history.length - 1];
  if (!ultimo || ultimo.role !== "user" || !ultimo.ts) return null; // ya le respondieron
  if (/^\[reacción/.test(ultimo.text || "")) return null;
  // Un "ok, gracias" a un mensaje que no preguntaba nada cierra la conversación.
  const anterior = history[history.length - 2];
  if (esAcuse(ultimo.text) && anterior?.role === "assistant" && !(anterior.text || "").includes("?")) return null;
  if (ahora - ultimo.ts < RESCATE_HORAS * HORA) return null; // el asesor aún tiene tiempo
  if (ahora - ultimo.ts > VENTANA_MS) return null; // ventana gratuita cerrada
  if (conv.rescueForTs === ultimo.ts) return null;
  return ultimo.ts;
}
async function rescatar(snap, ahora) {
  const notify = require("./notify");
  const cfg = require("./config");
  let rescatados = 0;
  for (const doc of snap.docs) {
    if (rescatados >= MAX_POR_EJECUCION) break;
    const conv = doc.data();
    const ts = tocaRescate(conv, ahora);
    if (!ts) continue;
    const phone = doc.id;
    const ref = store.db.collection("wa_conversations").doc(phone);
    try {
      const history = (conv.history || []).slice(-40).map((h) => ({ role: h.role, text: h.text }));
      const reply = await brain.generateReply(history, { extra: RESCATE });
      const texto = (reply || "").replace(/\[\[[^\]]*\]\]/g, "").replace(/\*\*(.+?)\*\*/gs, "*$1*").trim();
      await ref.set({ rescueForTs: ts }, { merge: true });
      if (!texto || /^NO\b[.!]?$/i.test(texto)) continue;
      const r = await wa.sendText(phone, texto);
      if (r && r.error) throw new Error(JSON.stringify(r.error));
      await store.appendMessages(phone, [{ role: "assistant", text: texto, ts: Date.now(), waId: r?.messages?.[0]?.id || null }]);
      await store.setHumanTakeover(phone, false);
      rescatados++;
      await notify.notifyHuman(cfg.NTFY_TOPIC.value(), {
        title: "El bot retomo un chat en pausa",
        message: `${conv.name || "Un lead"} (+${phone}) llevaba ${RESCATE_HORAS} h sin respuesta. El bot le contestó y quedó activo en ese chat.`,
        click: "https://dealerclubpe.web.app/?to=" + phone,
        priority: "default",
        tags: "robot",
      });
      logger.info("Chat en pausa retomado por el bot", { phone });
    } catch (err) {
      logger.error("No se pudo retomar el chat en pausa", { phone, error: err.message });
    }
  }
  return rescatados;
}

// --- Confirmación de citas (Pase VIP) -----------------------
// No podemos escribirle a nadie pasadas 24 h de su último mensaje, así que
// la confirmación se pide ANTES de que ese plazo se cierre; su respuesta lo
// renueva y permite el recordatorio del mismo día. Ver lib/citas.js.
async function confirmarCitas(snap, ahora) {
  const citas = require("./citas");
  let enviados = 0;
  for (const doc of snap.docs) {
    const conv = doc.data();
    const tipo = citas.tocaRecordatorio(conv, ahora, ahoraLima().hora, store.lastInboundOf(conv));
    if (!tipo) continue;
    const phone = doc.id;
    try {
      const texto = citas.textoRecordatorio(tipo, conv);
      const r = await wa.sendText(phone, texto);
      if (r && r.error) throw new Error(JSON.stringify(r.error));
      await store.appendMessages(phone, [{ role: "assistant", text: texto, ts: Date.now(), waId: r?.messages?.[0]?.id || null }]);
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
  const rescatados = await rescatar(recientes, ahora0);

  const { followUp } = await getBotSettings();
  if (!followUp.enabled) return { enviados: 0, rescatados, motivo: "desactivado" };

  if (!enHorario(followUp)) return { enviados: 0, rescatados, motivo: "fuera de horario" };

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
      const reply = await brain.generateReply(history, { extra: INSTRUCCION });
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

      const r = await wa.sendText(phone, texto);
      if (r && r.error) throw new Error(JSON.stringify(r.error));
      await store.appendMessages(phone, [
        { role: "assistant", text: texto, followUp: true, ts: Date.now(), waId: r?.messages?.[0]?.id || null },
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
  return { enviados, rescatados, citasConfirmadas };
}

module.exports = { run, tocaSeguimiento, tocaRescate, esAcuse, enHorario, INSTRUCCION, RESCATE_HORAS };
