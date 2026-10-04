// ============================================================
// Ajustes del bot editables desde el admin web
// ------------------------------------------------------------
// Admin → Bot de WhatsApp guarda aquí:
//   notes     -> aprendizajes aprobados por Kevin (se suman al cerebro)
//   followUp  -> seguimiento automático a leads que dejaron de responder
// Ruta: /artifacts/{APP_SCOPE}/public/data/bot_settings/main
// (solo el admin la lee/escribe desde la web; aquí se usa el Admin SDK).
// ============================================================
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const BASE = "artifacts/default-app-id/public/data";

const DEFAULTS = {
  notes: "",
  followUp: {
    enabled: false, // apagado hasta que Kevin lo active desde el admin
    hours: 3, // horas de silencio antes de escribirle
    from: 9, // hora de Lima desde la que se puede enviar
    to: 20, // hora de Lima hasta la que se puede enviar
  },
};

const TTL_MS = 60 * 1000;
let cache = { value: null, ts: 0 };

async function getBotSettings() {
  if (cache.value && Date.now() - cache.ts < TTL_MS) return cache.value;
  try {
    const snap = await db.doc(`${BASE}/bot_settings/main`).get();
    const data = snap.exists ? snap.data() : {};
    const value = {
      notes: (data.notes || "").trim(),
      followUp: { ...DEFAULTS.followUp, ...(data.followUp || {}) },
    };
    cache = { value, ts: Date.now() };
    return value;
  } catch (err) {
    logger.error("No se pudieron leer los ajustes del bot", err);
    return cache.value || DEFAULTS; // último bueno, o los valores por defecto
  }
}

module.exports = { getBotSettings, BASE, db };
