// ============================================================
// Configuración central — secretos y parámetros
// ------------------------------------------------------------
// Definimos los secretos con defineSecret. En local se leen del
// archivo functions/.env; en producción de Firebase Secrets.
// Ningún valor sensible vive en el código ni en Git.
// ============================================================
const { defineSecret, defineString } = require("firebase-functions/params");

// Secretos (sensibles) ---------------------------------------
const META_VERIFY_TOKEN = defineSecret("META_VERIFY_TOKEN");
const META_APP_SECRET = defineSecret("META_APP_SECRET");
const WHATSAPP_TOKEN = defineSecret("WHATSAPP_TOKEN");
const LLM_API_KEY = defineSecret("LLM_API_KEY");
// Tópico privado de ntfy.sh para alertas de "atender lead" (push al celular).
const NTFY_TOPIC = defineSecret("NTFY_TOPIC");
// Número personal de Kevin (admin): desde él se controla el bot por WhatsApp.
const ADMIN_PHONE = defineSecret("ADMIN_PHONE");

// Lista para enlazar a las funciones (options.secrets)
const ALL_SECRETS = [META_VERIFY_TOKEN, META_APP_SECRET, WHATSAPP_TOKEN, LLM_API_KEY, NTFY_TOPIC, ADMIN_PHONE];

// Parámetros no sensibles (con valor por defecto) ------------
const WHATSAPP_PHONE_NUMBER_ID = defineString("WHATSAPP_PHONE_NUMBER_ID", {
  default: "1208752195657914",
});
const GRAPH_API_VERSION = defineString("GRAPH_API_VERSION", { default: "v23.0" });
// Número visible de la empresa (para el enlace wa.me del comando admin).
// Por ahora el número de PRUEBA (+1 555 659 3283). Al migrar -> 51929610747.
const WHATSAPP_DISPLAY_NUMBER = defineString("WHATSAPP_DISPLAY_NUMBER", { default: "51929610747" });
const LLM_PROVIDER = defineString("LLM_PROVIDER", { default: "gemini" });
const LLM_MODEL = defineString("LLM_MODEL", { default: "" });
// Correo autorizado para entrar al panel admin.
const ADMIN_EMAIL = defineString("ADMIN_EMAIL", { default: "dealerclubpe@gmail.com" });

module.exports = {
  META_VERIFY_TOKEN,
  META_APP_SECRET,
  WHATSAPP_TOKEN,
  LLM_API_KEY,
  NTFY_TOPIC,
  ADMIN_PHONE,
  ALL_SECRETS,
  WHATSAPP_PHONE_NUMBER_ID,
  GRAPH_API_VERSION,
  WHATSAPP_DISPLAY_NUMBER,
  LLM_PROVIDER,
  LLM_MODEL,
  ADMIN_EMAIL,
};
