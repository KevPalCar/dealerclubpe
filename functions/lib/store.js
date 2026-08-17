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
    tx.set(
      ref,
      { history, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
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
  isHumanTakeover,
  setHumanTakeover,
  marcarAvisoUnico,
  addBrochuresSent,
  upsertLead,
  saveMedia,
  getMediaBase64,
};
