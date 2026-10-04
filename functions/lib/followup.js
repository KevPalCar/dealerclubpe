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
3. La pregunta activadora, que lo hace decidir y te abre la puerta: de lo que vio, qué es lo que más se acerca a lo que busca y qué le genera dudas, para poder avanzar.

Puntos fuertes de donde elegir:
- Escuela: todo incluido con certificación · bolsa de trabajo para egresados · sueldos en cruceros desde US$ 1,500 · se empieza desde cero, sin experiencia · Pase VIP: 30 minutos en una clase real sin costo.
- Eventos: dealers profesionales formados en nuestra escuela · traslado, montaje y desmontaje incluidos · la dirección de DealerClub presente en su evento · 3 h de evento con hasta 3 mesas a la vez · empresa formal con contrato · reserva incluso con 48 h de anticipación. En eventos NUNCA des precios.

Tono: seguro y directo, de quien ofrece algo bueno y no necesita insistir.
PROHIBIDO: mencionar que no respondió ("no me respondiste", "¿sigue ahí?", "quedé a la espera", "le recuerdo", "retomando"), pedir por favor que conteste, disculparte por escribir, crear urgencia ("últimos cupos", "solo por hoy"), ofrecer descuentos, volver a enviar el catálogo o poner etiquetas [[...]].

Ejemplos del tono (no los copies literal; adapta los tres puntos a la persona):
- Eventos: "Sra. Torres, para un cumpleaños como el suyo, esto es lo que más valoran nuestros clientes:\n• Dealers profesionales que enseñan a jugar a sus invitados\n• Traslado, montaje y desmontaje a nuestro cargo\n• Hasta 3 mesas funcionando a la vez\nDe lo que vio en el catálogo, ¿qué es lo que más se acerca a lo que busca y qué le genera dudas? Indíqueme para poder avanzar."
- Escuela: "Carlos, para trabajar en cruceros esto es lo que más te sirve de nosotros:\n• Sueldos desde US$ 1,500 al mes (página 5 del catálogo)\n• Certificación y bolsa de trabajo incluidas\n• Empiezas desde cero, sin experiencia\nDe lo que viste, ¿qué programa se acerca más a lo que buscas y qué te genera dudas? Dime y avanzamos."

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

  if (!enHorario(followUp)) return { enviados: 0, motivo: "fuera de horario" };

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

module.exports = { run, tocaSeguimiento, enHorario, INSTRUCCION };
