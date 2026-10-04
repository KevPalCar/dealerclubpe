// ============================================================
// Informe de chats: dónde se pierden los leads y qué mejorar
// ------------------------------------------------------------
// Lee las conversaciones recientes de WhatsApp, calcula el embudo
// (cuántos llegaron, recibieron catálogo, siguieron conversando…)
// y pide al modelo un diagnóstico con sugerencias concretas. El
// informe se guarda para el admin web; Kevin decide qué sugerencia
// pasa a las notas del bot. El bot NO se modifica solo.
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
  "sugerencias": [
    { "titulo": "nombre corto de la mejora", "nota": "instrucción clara y directa para el bot, en una o dos frases, lista para agregarse a sus reglas" }
  ]
}

Reglas:
- Basa todo en lo que ves en las conversaciones. Si algo no aparece, no lo inventes; deja la lista vacía.
- Máximo 5 elementos por lista. Sé concreto: cita el tipo de situación, no generalidades.
- No incluyas nombres, teléfonos ni datos personales de los clientes.
- Las sugerencias deben ser cambios de comportamiento del bot (qué decir, cuándo, cómo), no tareas para el dueño.
- Escribe en español.
`;

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
    escuela: convs.filter((c) => (c.brochuresSent || []).includes("escuela")).length,
    eventos: convs.filter((c) => (c.brochuresSent || []).includes("eventos")).length,
  };
}

function transcripcion(convs) {
  return convs
    .map((c, i) => {
      const lineas = (c.history || []).map((m) => {
        const quien = m.role === "user" ? "CLIENTE" : m.followUp ? "BOT (seguimiento)" : "BOT";
        const texto = (m.type && m.type !== "text" ? `[${m.type}] ` : "") + (m.text || "");
        return `${quien}: ${texto.replace(/\s+/g, " ").slice(0, MAX_CARACTERES)}`;
      });
      return `### Conversación ${i + 1}${c.humanTakeover ? " (derivada a un asesor humano)" : ""}\n${lineas.join("\n")}`;
    })
    .join("\n\n");
}

async function run({ days = 7 } = {}) {
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
  return { id: ref.id, ...informe };
}

module.exports = { run, embudo };
