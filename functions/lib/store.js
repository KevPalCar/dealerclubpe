// ============================================================
// Estado de conversación y leads en Firestore
// ------------------------------------------------------------
// Colecciones (separadas del espacio /artifacts de la web, para
// no interferir con el frontend existente):
//   wa_conversations/{phone}  -> estado + historial por número
//   wa_processed/{messageId}  -> anti-duplicados (idempotencia)
//   wa_leads/{phone}          -> ficha de lead (esquema hoja Leads)
// ============================================================
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const bucket = admin.storage().bucket("dealerclubpe.firebasestorage.app");

// Guarda un archivo entrante (ej. imagen) en Storage y devuelve su ruta.
async function saveMedia(phone, messageId, buffer, mimeType) {
  const clean = (mimeType || "").split(";")[0]; // "audio/ogg; codecs=opus" -> "audio/ogg"
  const ext = ((clean.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "")) || "bin";
  const path = `wa_media/${phone}/${messageId}.${ext}`;
  await bucket.file(path).save(buffer, { contentType: mimeType, resumable: false });
  return path;
}

// Lee un archivo de Storage y lo devuelve como data URL (para el panel).
async function getMediaBase64(path) {
  const file = bucket.file(path);
  const [buf] = await file.download();
  const [meta] = await file.getMetadata();
  const mime = meta.contentType || "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const MAX_HISTORY = 20; // pares de mensajes que recordamos

// --- Anti-duplicados ----------------------------------------
// Devuelve true si el mensaje YA fue procesado (duplicado).
// Usa create(): si el doc ya existe, lanza y sabemos que es repe.
async function isDuplicate(messageId) {
  if (!messageId) return false;
  const ref = db.collection("wa_processed").doc(messageId);
  try {
    await ref.create({ at: FieldValue.serverTimestamp() });
    return false; // se creó ahora -> es nuevo
  } catch (err) {
    if (err.code === 6 /* ALREADY_EXISTS */) return true;
    throw err;
  }
}

// --- Conversación -------------------------------------------
async function getConversation(phone) {
  const snap = await db.collection("wa_conversations").doc(phone).get();
  return snap.exists ? snap.data() : null;
}

async function ensureConversation(phone, profileName) {
  const ref = db.collection("wa_conversations").doc(phone);
  const snap = await ref.get();
  if (!snap.exists) {
    const data = {
      phone,
      name: profileName || null,
      history: [],
      humanTakeover: false,
      segment: null, // "escuela" | "eventos"
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(data);
    return data;
  }
  return snap.data();
}

async function appendMessages(phone, newEntries) {
  const ref = db.collection("wa_conversations").doc(phone);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data().history || [] : [];
    const history = [...prev, ...newEntries].slice(-MAX_HISTORY);
    const patch = { history, updatedAt: FieldValue.serverTimestamp() };
    // Último mensaje del lead: de ahí cuenta la ventana de 24 h de WhatsApp.
    const delLead = newEntries.filter((e) => e.role === "user" && e.ts).pop();
    if (delLead) patch.lastInboundAt = delLead.ts;
    tx.set(ref, patch, { merge: true });
  });
}

// --- Ventana de 24 h ----------------------------------------
// WhatsApp solo deja escribir texto libre durante las 24 h siguientes al
// último mensaje del lead. Fuera de ese plazo ACEPTA el envío y lo descarta
// después (el fallo llega por webhook), así que conviene saberlo antes.
// Devuelve "open" | "closed" | "unknown" (sin datos para afirmarlo).
const VENTANA_MS = 24 * 60 * 60 * 1000;
const VENTANA_CERRADA =
  "Esta persona no te ha escrito en las últimas 24 horas, y WhatsApp solo deja " +
  "escribirle con una plantilla aprobada (tiene costo). Alternativa gratis: que te " +
  "escriba primero (por ej. con un enlace wa.me); apenas lo haga, podrás responderle.";
function lastInboundOf(conv) {
  if (!conv) return null;
  if (conv.lastInboundAt) return conv.lastInboundAt;
  const delLead = [...(conv.history || [])].reverse().find((h) => h.role === "user" && h.ts);
  return delLead ? delLead.ts : null;
}
function windowState(conv, ahora = Date.now()) {
  const ultimo = lastInboundOf(conv);
  if (!ultimo) return "unknown";
  return ahora - ultimo < VENTANA_MS ? "open" : "closed";
}

// --- Estado de entrega --------------------------------------
// Meta avisa por webhook si cada mensaje saliente se entregó, se leyó o
// falló. Se anota en la entrada del historial que tenga ese id (waId).
// Devuelve "updated", "unchanged" (ya lo estaba) o null (no hay tal mensaje).
// El estado solo avanza: un "entregado" que llega tarde no pisa un "leído".
const RANGO = { sent: 1, delivered: 2, read: 3, failed: 4 };
async function setMessageStatus(phone, waId, status, error) {
  if (!phone || !waId || !RANGO[status]) return null;
  const ref = db.collection("wa_conversations").doc(phone);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const history = snap.data().history || [];
    const i = history.findIndex((h) => h.waId === waId);
    if (i === -1) return null;
    if ((RANGO[history[i].status] || 0) >= RANGO[status]) return "unchanged";
    history[i] = { ...history[i], status };
    if (error) history[i].error = error;
    // Sin updatedAt: un "leído" no debe reordenar la lista de chats.
    tx.update(ref, { history });
    return "updated";
  });
}

// Registra qué brochures ya se enviaron (para no repetirlos en la conversación).
async function addBrochuresSent(phone, tipos) {
  await db.collection("wa_conversations").doc(phone).set(
    {
      brochuresSent: FieldValue.arrayUnion(...tipos),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// Marca que ya se avisó a Kevin de este lead (alerta de una sola vez).
// Devuelve true si ESTA llamada fue la que lo marcó; false si ya estaba.
async function marcarAvisoUnico(phone, campo) {
  const ref = db.collection("wa_conversations").doc(phone);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()[campo]) return false;
    tx.set(
      ref,
      { [campo]: true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return true;
  });
}

async function isHumanTakeover(phone) {
  const conv = await getConversation(phone);
  return !!(conv && conv.humanTakeover);
}

async function setHumanTakeover(phone, value) {
  await db.collection("wa_conversations").doc(phone).set(
    { humanTakeover: !!value, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

// --- Leads (esquema de la hoja "Registro de Leads") ---------
async function upsertLead(phone, fields) {
  const ref = db.collection("wa_leads").doc(phone);
  const snap = await ref.get();
  const base = snap.exists
    ? {}
    : {
        phone,
        estado: "Nuevo",
        createdAt: FieldValue.serverTimestamp(),
      };
  await ref.set(
    { ...base, ...fields, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

module.exports = {
  db,
  FieldValue,
  isDuplicate,
  getConversation,
  ensureConversation,
  appendMessages,
  lastInboundOf,
  windowState,
  VENTANA_CERRADA,
  setMessageStatus,
  isHumanTakeover,
  setHumanTakeover,
  marcarAvisoUnico,
  addBrochuresSent,
  upsertLead,
  saveMedia,
  getMediaBase64,
};
