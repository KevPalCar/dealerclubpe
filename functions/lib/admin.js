// ============================================================
// Funciones para el PANEL ADMIN (callable, seguras).
// El panel web las llama tras iniciar sesión. Cada una verifica
// que quien llama sea el correo admin. Usan Admin SDK (no tocan
// las reglas de Firestore de la web).
// ============================================================
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const cfg = require("./config");
const store = require("./store");
const wa = require("./whatsapp");

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
      last: last ? previewOf(last) : "",
      lastRole: last ? last.role : null,
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
    lead: leadSnap.exists ? leadSnap.data() : {},
  };
});

const COLD_MSG =
  "No se pudo enviar. Si esta persona no te ha escrito en las últimas 24 horas, " +
  "WhatsApp exige una plantilla aprobada (tiene costo) para iniciar tú la conversación. " +
  "Alternativa gratis: que te escriba primero (por ej. un enlace wa.me).";

// Responder a un lead DESDE el número de empresa (pausa el bot ahí).
const adminSendReply = onCall({ secrets: cfg.ALL_SECRETS }, async (request) => {
  assertAdmin(request);
  const phone = onlyDigits(request.data && request.data.phone);
  const text = (request.data && request.data.text ? request.data.text : "").trim();
  if (!phone || !text) throw new HttpsError("invalid-argument", "Faltan datos.");
  try {
    await wa.sendText(phone, text);
  } catch (e) {
    if (e.waCode === 131047 || e.waCode === 131026 || e.waCode === 470) {
      throw new HttpsError("failed-precondition", COLD_MSG);
    }
    throw new HttpsError("internal", "No se pudo enviar el mensaje.");
  }
  await store.setHumanTakeover(phone, true);
  await store.appendMessages(phone, [{ role: "assistant", text, ts: Date.now() }]);
  return { ok: true };
});

// Enviar un archivo (imagen/pdf/audio/video) desde el panel al cliente.
const adminSendMedia = onCall({ secrets: cfg.ALL_SECRETS }, async (request) => {
  assertAdmin(request);
  const d = request.data || {};
  const phone = onlyDigits(d.phone);
  if (!phone || !d.dataBase64) throw new HttpsError("invalid-argument", "Faltan datos.");
  const buffer = Buffer.from(d.dataBase64, "base64");
  let r;
  try {
    r = await wa.sendMediaBuffer(phone, buffer, d.mime, d.filename, d.caption);
  } catch (e) {
    if (e.waCode === 131047 || e.waCode === 131026 || e.waCode === 470) {
      throw new HttpsError("failed-precondition", COLD_MSG);
    }
    throw new HttpsError("internal", "No se pudo enviar el archivo.");
  }
  await store.setHumanTakeover(phone, true);
  // Guardar en Storage para verlo también en el panel (best-effort).
  const entry = { role: "assistant", text: d.caption || `[${r.waType || "archivo"} enviado]`, ts: Date.now() };
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

module.exports = {
  adminListConversations,
  adminGetConversation,
  adminSendReply,
  adminSendMedia,
  adminStartChat,
  adminSetTakeover,
  adminGetMedia,
};
