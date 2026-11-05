// ============================================================
// Informe de chats: dónde se pierden los leads y qué mejorar
// ------------------------------------------------------------
// Lee las conversaciones recientes de WhatsApp, calcula el embudo
// (cuántos llegaron, recibieron catálogo, siguieron conversando…)
// y pide al modelo un diagnóstico con sugerencias concretas. El
// informe se guarda para el admin web. Desde el 5 nov 2026 (pedido de Kevin,
// por la campaña de anuncios) corre cada 2 días y las sugerencias que pasan
// los filtros de seguridad se APLICAN SOLAS como "mejoras automáticas"
// (bot_settings/main.autoNotes); Kevin ve cuáles y quita la que no le guste.
// ============================================================
const logger = require("firebase-functions/logger");
const store = require("./store");
const brain = require("./brain");
const { BASE } = require("./botsettings");

const DIA = 24 * 60 * 60 * 1000;
const MAX_CONVERSACIONES = 40;
const MAX_CARACTERES = 260; // por mensaje, para no enviar chats enormes

const ENCARGO = `
Eres un analista de ventas por WhatsApp. Recibes conversaciones reales entre el bot de DealerClub
(escuela de dealers de casino y servicio de casino de fantasía para eventos, en Lima, Perú) y sus
clientes potenciales. Tu trabajo es encontrar por qué no avanzan hacia la venta y proponer mejoras.

Responde SOLO con un JSON con esta forma exacta:
{
  "resumen": "2 o 3 frases con lo más importante de la semana",
  "dondeSePierden": ["momento concreto en que los clientes dejan de responder, con cuántos casos"],
  "preguntasFrecuentes": ["pregunta que se repite"],
  "objeciones": ["duda u objeción que frena la compra"],
  "erroresDelBot": ["respuesta del bot equivocada, repetitiva, fuera de lugar o que no contestó lo que se preguntó"],
  "loQueHizoElAsesor": ["algo concreto que hizo el ASESOR humano y que hizo avanzar la venta (cómo resumió, cómo cerró, qué ofreció), para que el bot lo imite"],
  "loQuePudoHacerMejor": ["momento clave en que el ASESOR humano dejó pasar una oportunidad (no pidió el siguiente paso, no pactó cuándo retomar, respondió tarde, no usó un beneficio para cerrar...) y qué debió decir, en una frase"],
  "sugerencias": [
    { "titulo": "nombre corto de la mejora", "nota": "instrucción clara y directa para el bot, en una o dos frases, lista para agregarse a sus reglas" }
  ]
}

Reglas:
- Basa todo en lo que ves en las conversaciones. Si algo no aparece, no lo inventes; deja la lista vacía.
- Máximo 5 elementos por lista. Sé concreto: cita el tipo de situación, no generalidades.
- No incluyas nombres, teléfonos ni datos personales de los clientes.
- Las sugerencias deben ser cambios de comportamiento del bot (qué decir, cuándo, cómo), no tareas para el dueño. Se aplican SOLAS al bot, así que:
  · Solo cómo responder mejor para llegar a la cita (Pase VIP o evaluación) o al pago: tono, orden, qué pregunta hacer, cómo responder una objeción frecuente.
  · NUNCA cambies ni menciones precios, montos, porcentajes, descuentos, promociones, becas, horarios de citas, direcciones, duración de programas ni promesas de trabajo o embarque.
  · NUNCA contradigas las reglas del bot (un mensaje por turno, una pregunta al final, dirección exacta solo al reservar, no mandar a la web salvo casos puntuales).
  · Máximo 3 sugerencias, las de mayor impacto en ventas. Si no hay una mejora clara, deja la lista vacía.
- Los mensajes marcados "ASESOR" los escribió el dueño en persona. Aprende de él en las dos direcciones: si resolvió algo mejor que el bot, conviértelo en una sugerencia para que el bot lo imite; si dejó pasar una oportunidad clave, anótalo en "loQuePudoHacerMejor" (con tono constructivo) y conviértelo en una sugerencia para que el bot sí lo haga en esa situación.
- Escribe en español.
`;

// Servicio del chat: el que marcó el bot; en chats antiguos, por el catálogo enviado.
function segmento(c) {
  if (c.segment) return c.segment;
  const b = c.brochuresSent || [];
  return b.includes("eventos") && !b.includes("escuela") ? "eventos" : b.includes("escuela") ? "escuela" : null;
}

const ORIGEN = { escuela: "llegó por el anuncio de la Escuela", eventos: "llegó por el anuncio de Eventos" };

// Embudo calculado con datos, no con el modelo.
function embudo(convs) {
  const tras = (c) => {
    const h = c.history || [];
    const i = h.findIndex((m) => m.type === "document" && m.role === "assistant");
    return i >= 0 && h.slice(i + 1).some((m) => m.role === "user");
  };
  const conCatalogo = convs.filter((c) => (c.brochuresSent || []).length);
  return {
    conversaciones: convs.length,
    recibieronCatalogo: conCatalogo.length,
    respondieronTrasCatalogo: conCatalogo.filter(tras).length,
    quedaronEnSilencio: convs.filter((c) => {
      const h = c.history || [];
      return h.length && h[h.length - 1].role === "assistant" && !c.humanTakeover;
    }).length,
    derivadosAHumano: convs.filter((c) => c.humanTakeover).length,
    conSeguimiento: convs.filter((c) => (c.followUps || 0) > 0).length,
    escuela: convs.filter((c) => segmento(c) === "escuela").length,
    eventos: convs.filter((c) => segmento(c) === "eventos").length,
    // Leads traídos por los anuncios de Meta, según el anuncio que tocaron.
    desdeAnuncio: convs.filter((c) => c.origen).length,
    anuncioEscuela: convs.filter((c) => c.origen?.campana === "escuela").length,
    anuncioEventos: convs.filter((c) => c.origen?.campana === "eventos").length,
    // Lo que acerca a la venta: citas agendadas por el bot.
    pasesVip: convs.filter((c) => c.vipAt && !c.vipVideo).length,
    evaluaciones: convs.filter((c) => c.vipAt && c.vipVideo).length,
  };
}

function transcripcion(convs) {
  return convs
    .map((c, i) => {
      const lineas = (c.history || []).map((m) => {
        const quien = m.role === "user" ? "CLIENTE" : m.by === "asesor" ? "ASESOR (Kevin, humano)" : m.followUp ? "BOT (seguimiento)" : "BOT";
        const texto = (m.type && m.type !== "text" ? `[${m.type}] ` : "") + (m.text || "");
        return `${quien}: ${texto.replace(/\s+/g, " ").slice(0, MAX_CARACTERES)}`;
      });
      const origen = c.origen ? ` (${ORIGEN[c.origen.campana] || "llegó por un anuncio"})` : "";
      return `### Conversación ${i + 1}${origen}${c.humanTakeover ? " (derivada a un asesor humano)" : ""}\n${lineas.join("\n")}`;
    })
    .join("\n\n");
}

// --- Mejoras automáticas ----------------------------------------
// Filtro de seguridad: nada de dinero, horarios, direcciones ni promesas.
const PROHIBIDO = /S\/\s?\d|US\$|\$\s?\d|\d+\s?%|descuento|promoci|beca|oferta|gratis por|garantiz|asegur\w* (el|un|tu) (puesto|trabajo|embarque)|coyllur|direcci[oó]n exacta|\b\d{1,2}(:\d{2})?\s?(a\.?\s?m|p\.?\s?m)\b/i;
const MAX_AUTO = 15; // se conservan las más recientes
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
function filtrarMejoras(sugerencias, existentes) {
  const ya = new Set(existentes.map(norm));
  return sugerencias
    .filter((s) => s.nota.length >= 20 && s.nota.length <= 400 && !PROHIBIDO.test(s.nota) && !PROHIBIDO.test(s.titulo))
    .filter((s) => !ya.has(norm(s.nota)))
    .slice(0, 3);
}
async function aplicarMejoras(sugerencias, informeId) {
  const { db, BASE: B } = require("./botsettings");
  const ref = db.doc(`${B}/bot_settings/main`);
  const snap = await ref.get();
  const d = snap.exists ? snap.data() : {};
  const actuales = Array.isArray(d.autoNotes) ? d.autoNotes : [];
  const nuevas = filtrarMejoras(sugerencias, [...actuales.map((a) => a.nota), ...String(d.notes || "").split("\n")])
    .map((s, i) => ({ id: `${Date.now()}-${i}`, titulo: s.titulo, nota: s.nota, fecha: new Date().toISOString(), informeId }));
  if (nuevas.length) await ref.set({ autoNotes: [...actuales, ...nuevas].slice(-MAX_AUTO) }, { merge: true });
  return nuevas;
}

async function run({ days = 7, aplicar = false } = {}) {
  const ahora = Date.now();
  const snap = await store.db
    .collection("wa_conversations")
    .where("updatedAt", ">=", new Date(ahora - days * DIA))
    .orderBy("updatedAt", "desc")
    .limit(MAX_CONVERSACIONES)
    .get();
  const convs = snap.docs.map((d) => d.data()).filter((c) => (c.history || []).some((m) => m.role === "user"));

  const informe = {
    createdAt: new Date(),
    days,
    embudo: embudo(convs),
    resumen: "",
    dondeSePierden: [],
    preguntasFrecuentes: [],
    objeciones: [],
    erroresDelBot: [],
    loQueHizoElAsesor: [],
    loQuePudoHacerMejor: [],
    sugerencias: [],
  };

  if (!convs.length) {
    informe.resumen = `No hubo conversaciones en los últimos ${days} días.`;
  } else {
    try {
      const analisis = await brain.generateJson(ENCARGO, transcripcion(convs));
      const lista = (v) => (Array.isArray(v) ? v.filter(Boolean).slice(0, 5) : []);
      informe.resumen = String(analisis.resumen || "");
      informe.dondeSePierden = lista(analisis.dondeSePierden).map(String);
      informe.preguntasFrecuentes = lista(analisis.preguntasFrecuentes).map(String);
      informe.objeciones = lista(analisis.objeciones).map(String);
      informe.erroresDelBot = lista(analisis.erroresDelBot).map(String);
      informe.loQueHizoElAsesor = lista(analisis.loQueHizoElAsesor).map(String);
      informe.loQuePudoHacerMejor = lista(analisis.loQuePudoHacerMejor).map(String);
      informe.sugerencias = lista(analisis.sugerencias)
        .filter((s) => s && s.nota)
        .map((s) => ({ titulo: String(s.titulo || "Mejora"), nota: String(s.nota) }));
    } catch (err) {
      logger.error("El análisis de chats falló", err);
      informe.resumen = "No se pudo completar el análisis automático esta vez. Las cifras del embudo sí son correctas.";
    }
  }

  const ref = await store.db.collection(`${BASE}/bot_insights`).add(informe);
  logger.info("Informe de chats guardado", { id: ref.id, conversaciones: convs.length });
  if (aplicar && informe.sugerencias.length) {
    try {
      informe.aplicadas = await aplicarMejoras(informe.sugerencias, ref.id);
      await ref.set({ aplicadas: informe.aplicadas }, { merge: true });
      logger.info("Mejoras automáticas aplicadas", { n: informe.aplicadas.length });
    } catch (err) {
      logger.error("No se pudieron aplicar las mejoras automáticas", err);
    }
  }
  return { id: ref.id, ...informe };
}

module.exports = { run, embudo, filtrarMejoras };
