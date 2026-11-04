// ============================================================
// Funciones para el PANEL ADMIN (callable, seguras).
// El panel web las llama tras iniciar sesión. Cada una verifica
// que quien llama sea el correo admin. Usan Admin SDK (no tocan
// las reglas de Firestore de la web).
// ============================================================
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const cfg = require("./config");
const store = require("./store");
const wa = require("./whatsapp");
const { BROCHURES, enviarBrochure } = require("./brochures");

function assertAdmin(request) {
  const email = request.auth && request.auth.token && request.auth.token.email;
  const admin = (cfg.ADMIN_EMAIL.value() || "").toLowerCase();
  if (!email || email.toLowerCase() !== admin) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }
}

const onlyDigits = (s) => (s || "").replace(/\D/g, "");

// Texto de vista previa para la lista, según el tipo de mensaje.
function previewOf(m) {
  const iconos = { image: "📷 Imagen", document: "📄 Documento", audio: "🎤 Audio", video: "🎬 Video", sticker: "🩹 Sticker" };
  return iconos[m.type] || m.text || "";
}

// Lista de conversaciones (más recientes primero).
const adminListConversations = onCall(async (request) => {
  assertAdmin(request);
  const snap = await store.db
    .collection("wa_conversations")
    .orderBy("updatedAt", "desc")
    .limit(60)
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    const last = (x.history || []).slice(-1)[0];
    return {
      phone: x.phone,
      name: x.name || null,
      humanTakeover: !!x.humanTakeover,
      // Anuncio de Meta por el que llegó ("escuela" | "eventos" | "otro"), si vino por uno.
      anuncio: x.origen ? x.origen.campana || "otro" : null,
      last: last ? previewOf(last) : "",
      lastRole: last ? last.role : null,
      lastFailed: !!(last && last.status === "failed"),
      updatedAt: x.updatedAt ? x.updatedAt._seconds * 1000 : null,
    };
  });
});

// Detalle de una conversación (historial + datos del lead).
const adminGetConversation = onCall(async (request) => {
  assertAdmin(request);
  const phone = onlyDigits(request.data && request.data.phone);
  if (!phone) throw new HttpsError("invalid-argument", "Falta el número.");
  const conv = await store.getConversation(phone);
  const leadSnap = await store.db.collection("wa_leads").doc(phone).get();
  return {
    phone,
    name: conv && conv.name,
    humanTakeover: !!(conv && conv.humanTakeover),
    history: (conv && conv.history) || [],
    // "open" | "closed" | "unknown": si WhatsApp aún deja escribirle gratis.
    window: store.windowState(conv),
    lastInboundAt: store.lastInboundOf(conv),
    lead: leadSnap.exists ? leadSnap.data() : {},
  };
});

const COLD_MSG = "No se envió. " + store.VENTANA_CERRADA;
const ES_VENTANA = (e) => e.waCode === 131047 || e.waCode === 131026 || e.waCode === 470;

// WhatsApp ACEPTA un envío fuera de la ventana de 24 h y lo descarta después,
// así que se corta antes: si no, el panel lo mostraría como enviado.
async function assertWindowOpen(phone) {
  if (store.windowState(await store.getConversation(phone)) === "closed") {
    throw new HttpsError("failed-precondition", COLD_MSG);
  }
}
const waIdOf = (r) => (r && r.messages && r.messages[0] && r.messages[0].id) || null;

// Responder a un lead DESDE el número de empresa (pausa el bot ahí).
const adminSendReply = onCall({ secrets: cfg.ALL_SECRETS }, async (request) => {
  assertAdmin(request);
  const phone = onlyDigits(request.data && request.data.phone);
  const text = (request.data && request.data.text ? request.data.text : "").trim();
  if (!phone || !text) throw new HttpsError("invalid-argument", "Faltan datos.");
  await assertWindowOpen(phone);
  let r;
  try {
    r = await wa.sendText(phone, text);
  } catch (e) {
    if (ES_VENTANA(e)) throw new HttpsError("failed-precondition", COLD_MSG);
    throw new HttpsError("internal", "No se pudo enviar el mensaje.");
  }
  await store.setHumanTakeover(phone, true);
  await store.appendMessages(phone, [{ role: "assistant", text, ts: Date.now(), waId: waIdOf(r), by: "asesor" }]);
  return { ok: true };
});

// Enviar un archivo (imagen/pdf/audio/video) desde el panel al cliente.
const adminSendMedia = onCall({ secrets: cfg.ALL_SECRETS }, async (request) => {
  assertAdmin(request);
  const d = request.data || {};
  const phone = onlyDigits(d.phone);
  if (!phone || !d.dataBase64) throw new HttpsError("invalid-argument", "Faltan datos.");
  await assertWindowOpen(phone);
  const buffer = Buffer.from(d.dataBase64, "base64");
  let r;
  try {
    r = await wa.sendMediaBuffer(phone, buffer, d.mime, d.filename, d.caption);
  } catch (e) {
    if (ES_VENTANA(e)) throw new HttpsError("failed-precondition", COLD_MSG);
    throw new HttpsError("internal", "No se pudo enviar el archivo.");
  }
  await store.setHumanTakeover(phone, true);
  // Guardar en Storage para verlo también en el panel (best-effort).
  const entry = {
    role: "assistant",
    text: d.caption || `[${r.waType || "archivo"} enviado]`,
    ts: Date.now(),
    waId: waIdOf(r),
    by: "asesor",
  };
  try {
    const path = await store.saveMedia(phone, "out_" + Date.now(), buffer, d.mime);
    entry.type = r.waType;
    entry.storagePath = path;
    entry.mime = d.mime;
    if (d.filename) entry.filename = d.filename;
    if (d.caption) entry.caption = d.caption;
  } catch (e) {
    logger.warn("No se pudo guardar copia de la media enviada", { error: e.message });
  }
  await store.appendMessages(phone, [entry]);
  return { ok: true };
});

// Enviar el catálogo vigente (el mismo PDF y texto que manda el bot) con un
// clic. Sirve con el bot en pausa; no cambia si el bot está pausado o no, y
// queda anotado como enviado para que el bot no lo repita.
const adminSendBrochure = onCall({ secrets: cfg.ALL_SECRETS }, async (request) => {
  assertAdmin(request);
  const phone = onlyDigits(request.data && request.data.phone);
  const tipo = String((request.data && request.data.tipo) || "").toLowerCase();
  if (!phone || !BROCHURES[tipo]) throw new HttpsError("invalid-argument", "Faltan datos.");
  await assertWindowOpen(phone);
  const r = await enviarBrochure(phone, tipo);
  if (!r.ok) {
    if (ES_VENTANA(r)) throw new HttpsError("failed-precondition", COLD_MSG);
    throw new HttpsError("internal", "No se pudo enviar el catálogo. Inténtalo de nuevo.");
  }
  return { ok: true };
});

// Abrir/crear una conversación con cualquier número (para escribirle).
const adminStartChat = onCall(async (request) => {
  assertAdmin(request);
  const phone = onlyDigits(request.data && request.data.phone);
  if (!phone || phone.length < 8) throw new HttpsError("invalid-argument", "Número inválido.");
  await store.ensureConversation(phone, null);
  return { ok: true, phone };
});

// Devuelve una imagen entrante como data URL (para mostrarla en el panel).
const adminGetMedia = onCall(async (request) => {
  assertAdmin(request);
  const path = (request.data && request.data.path) || "";
  if (!/^wa_media\/[0-9]+\//.test(path)) {
    throw new HttpsError("invalid-argument", "Ruta de media inválida.");
  }
  const dataUrl = await store.getMediaBase64(path);
  return { dataUrl };
});

// Pausar / reactivar el bot en una conversación.
const adminSetTakeover = onCall(async (request) => {
  assertAdmin(request);
  const phone = onlyDigits(request.data && request.data.phone);
  const value = !!(request.data && request.data.value);
  await store.setHumanTakeover(phone, value);
  return { ok: true, value };
});

// Informe de chats a pedido (el semanal corre solo los lunes).
const adminAnalyzeChats = onCall({ secrets: cfg.ALL_SECRETS, timeoutSeconds: 120 }, async (request) => {
  assertAdmin(request);
  const days = Math.min(30, Math.max(1, Number(request.data && request.data.days) || 7));
  const informe = await require("./insights").run({ days });
  return { id: informe.id, conversaciones: informe.embudo.conversaciones };
});

// Interruptor del mensaje ACTIVADOR (el que el bot manda solo tras unas horas
// de silencio). Es el mismo ajuste que Admin web → Bot y seguimiento.
const adminFollowUp = onCall(async (request) => {
  assertAdmin(request);
  const { db, BASE } = require("./botsettings");
  const ref = db.doc(`${BASE}/bot_settings/main`);
  const d = request.data || {};
  if (typeof d.enabled === "boolean") {
    await ref.set({ followUp: { enabled: d.enabled } }, { merge: true });
    return { enabled: d.enabled };
  }
  const snap = await ref.get();
  return { enabled: !!(snap.exists && snap.data().followUp && snap.data().followUp.enabled) };
});

// Llamadas de WhatsApp desde el panel. Una sola función con `accion`:
//   entrantes | permiso | pedirPermiso | llamar | contestar | rechazar | colgar | estado
const calls = require("./calls");
const adminCall = onCall({ secrets: cfg.ALL_SECRETS }, async (request) => {
  assertAdmin(request);
  const d = request.data || {};
  const phone = onlyDigits(d.phone);
  try {
    switch (d.accion) {
      case "entrantes":
        return (await calls.entrantes()).map(({ id, phone, nombre, oferta }) => ({ id, phone, nombre, oferta }));
      case "permiso":
        return await calls.permiso(phone);
      case "pedirPermiso": {
        const waId = await calls.pedirPermiso(phone, d.texto || "Para resolver tus dudas más rápido, ¿te podemos llamar por WhatsApp? Son unos minutos.");
        await store.appendMessages(phone, [{ role: "assistant", by: "asesor", text: "📞 Se le pidió permiso para llamarle", ts: Date.now(), waId }]);
        return { ok: true };
      }
      case "llamar":
        return { id: await calls.llamar(phone, d.sdp) };
      case "contestar":
        await calls.contestar(d.id, d.sdp);
        return { ok: true };
      case "rechazar":
        await calls.rechazar(d.id);
        return { ok: true };
      case "colgar":
        await calls.colgar(d.id);
        return { ok: true };
      case "estado": {
        const c = await calls.get(d.id);
        return c ? { estado: c.estado, respuesta: c.respuesta || null, duracion: c.duracion || 0 } : { estado: "desconocido" };
      }
      default:
        throw new HttpsError("invalid-argument", "Acción desconocida.");
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    const motivos = {
      138006: "Esta persona aún no aceptó recibir llamadas. Usa \"Pedir permiso\" primero.",
      131047: "Pasaron más de 24 h desde su último mensaje: no se le puede pedir permiso ahora.",
    };
    throw new HttpsError("failed-precondition", motivos[e.waCode] || e.message);
  }
});

module.exports = {
  adminCall,
  adminFollowUp,
  adminAnalyzeChats,
  adminListConversations,
  adminGetConversation,
  adminSendReply,
  adminSendMedia,
  adminSendBrochure,
  adminStartChat,
  adminSetTakeover,
  adminGetMedia,
};
