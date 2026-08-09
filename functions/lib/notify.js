// ============================================================
// Alertas push a Kevin vía ntfy.sh (gratis, instantáneo).
// El bot hace POST al tópico privado; Kevin lo recibe en la app
// ntfy de su celular. Al tocar la alerta, abre WhatsApp del lead.
// ============================================================
const logger = require("firebase-functions/logger");

// Quita acentos/no-ASCII para cabeceras HTTP (Title), que deben ser ASCII.
function ascii(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

async function notifyHuman(topic, { title, message, click, priority = "high", tags = "rotating_light" }) {
  if (!topic || topic === "__PENDIENTE__") {
    logger.warn("NTFY_TOPIC no configurado; no se envía alerta push");
    return;
  }
  const headers = {
    Title: ascii(title) || "DealerClub",
    Priority: priority,
    Tags: tags,
  };
  // Al tocar la notificación se abre el enlace indicado (chat al número de empresa).
  if (click) headers.Click = click;

  try {
    const res = await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers,
      body: message || "",
    });
    if (!res.ok) logger.error("ntfy respondió error", { status: res.status });
  } catch (e) {
    logger.error("No se pudo enviar la alerta ntfy", { error: e.message });
  }
}

module.exports = { notifyHuman };
