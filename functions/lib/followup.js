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
  "[SISTEMA: el cliente no ha respondido en varias horas. Escribe ahora tu mensaje de seguimiento.]";

const INSTRUCCION = `
## MODO SEGUIMIENTO (solo para este mensaje)
El cliente dejó de responder hace varias horas. Escribe UN mensaje para reavivar la conversación.

Cómo debe ser:
- Corto: 2 o 3 líneas como máximo.
- Empieza por su nombre si lo sabes. Mantén el trato que venías usando (tú en Escuela, usted en eventos).
- Aporta UN dato útil y nuevo, ligado a lo que esa persona dijo o preguntó (su meta, su evento, su duda). Que el mensaje valga por sí mismo.
- Termina con UNA pregunta fácil de contestar, que incluya una salida sin compromiso ("…o prefieres verlo más adelante").
- Tono tranquilo y seguro: quien ofrece algo bueno no persigue. Nada de urgencia, descuentos improvisados ni "últimos cupos".
- PROHIBIDO: reprochar el silencio ("no me respondiste", "¿sigues ahí?", "quedé esperando"), disculparte por escribir, repetir lo que ya dijiste, volver a ofrecer el catálogo o poner etiquetas [[...]].
- En eventos no des precios. En Escuela puedes apoyarte en el Pase VIP si aún no lo ofreciste.

Ejemplos del tono (no los copies literal):
- Escuela: "Carlos, un dato por si te sirve: antes de decidir puedes vivir 30 minutos de una clase real, sin costo. ¿Te separo un cupo esta semana o prefieres verlo más adelante?"
- Eventos: "Sra. Torres, para avanzar con su cotización solo me falta un dato: ¿para qué fecha tiene pensado el evento? Si aún lo está definiendo, lo retomamos cuando guste."

Si la conversación ya se cerró de forma natural (se despidió, ya agendó su Pase VIP, ya tiene su cotización en manos de un asesor, o pidió que no le escriban), NO hay nada que retomar: responde únicamente con la palabra NO.
`;

function horaLima() {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", hour: "numeric", hour12: false }).format(new Date())
  );
}

// Decide si a esta conversación le toca seguimiento. Devuelve el ts del
// último mensaje del lead (para no repetir en el mismo silencio) o null.
function tocaSeguimiento(conv, ahora, horasSilencio) {
  if (!conv || conv.humanTakeover) return null;
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

async function run() {
  const { followUp } = await getBotSettings();
  if (!followUp.enabled) return { enviados: 0, motivo: "desactivado" };

  const hora = horaLima();
  if (hora < followUp.from || hora >= followUp.to) return { enviados: 0, motivo: "fuera de horario" };

  const ahora = Date.now();
  const desde = new Date(ahora - 24 * HORA);
  const snap = await store.db.collection("wa_conversations").where("updatedAt", ">=", desde).get();

  let enviados = 0;
  for (const doc of snap.docs) {
    if (enviados >= MAX_POR_EJECUCION) break;
    const conv = doc.data();
    const tsLead = tocaSeguimiento(conv, ahora, followUp.hours);
    if (!tsLead) continue;

    const phone = doc.id;
    try {
      const history = (conv.history || []).map((h) => ({ role: h.role, text: h.text }));
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
      await store.appendMessages(phone, [{ role: "assistant", text: texto, followUp: true, ts: Date.now() }]);
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
  return { enviados };
}

module.exports = { run, tocaSeguimiento, INSTRUCCION };
