// ============================================================
// Cliente de WhatsApp Cloud API (envío de mensajes salientes)
// ============================================================
const fs = require("fs");
const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, GRAPH_API_VERSION } = require("./config");
const logger = require("firebase-functions/logger");

// Node 22 trae fetch global; no hace falta dependencia extra.
async function sendText(to, body) {
  const phoneId = WHATSAPP_PHONE_NUMBER_ID.value();
  const version = GRAPH_API_VERSION.value();
  const token = WHATSAPP_TOKEN.value();

  // Modo dry-run (desarrollo local o secreto aún pendiente): sin token
  // real no llamamos a Meta, solo registramos la respuesta.
  if (!token || token === "__PENDIENTE__") {
    logger.info("[DRY-RUN] Respuesta del bot (sin enviar a WhatsApp)", { to, body });
    return { dryRun: true };
  }

  const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error("Error al enviar WhatsApp", { status: res.status, data });
    const err = new Error(`WhatsApp send failed: ${res.status}`);
    err.waCode = data?.error?.code;
    throw err;
  }
  return data;
}

// Envía un PDF (documento): lo sube a la media API y luego lo manda.
async function sendDocument(to, filePath, filename, caption) {
  const phoneId = WHATSAPP_PHONE_NUMBER_ID.value();
  const version = GRAPH_API_VERSION.value();
  const token = WHATSAPP_TOKEN.value();

  if (!token || token === "__PENDIENTE__") {
    logger.info("[DRY-RUN] Brochure no enviado (sin token)", { to, filename });
    return { dryRun: true };
  }
  if (!fs.existsSync(filePath)) {
    logger.error("Brochure no encontrado en el servidor", { filePath });
    return { error: "missing_file" };
  }

  // 1) Subir el PDF a la media API → obtener media id
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([buf], { type: "application/pdf" }), filename);

  const up = await fetch(`https://graph.facebook.com/${version}/${phoneId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const upData = await up.json().catch(() => ({}));
  if (!up.ok || !upData.id) {
    logger.error("Error subiendo el PDF a WhatsApp", { status: up.status, upData });
    throw new Error(`media upload failed: ${up.status}`);
  }

  // 2) Enviar el documento por su media id
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "document",
    document: { id: upData.id, filename, caption },
  };
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error("Error enviando el documento", { status: res.status, data });
    throw new Error(`send document failed: ${res.status}`);
  }
  return data;
}

// Envía una imagen (captura) al cliente: la sube a la media API y la manda.
async function sendImage(to, filePath, caption) {
  const phoneId = WHATSAPP_PHONE_NUMBER_ID.value();
  const version = GRAPH_API_VERSION.value();
  const token = WHATSAPP_TOKEN.value();
  if (!token || token === "__PENDIENTE__") {
    logger.info("[DRY-RUN] Imagen no enviada", { to, filePath });
    return { dryRun: true };
  }
  if (!fs.existsSync(filePath)) {
    logger.error("Imagen no encontrada", { filePath });
    return { error: "missing_file" };
  }
  const buf = fs.readFileSync(filePath);
  const ext = (filePath.split(".").pop() || "png").toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([buf], { type: mime }), `img.${ext}`);
  const up = await fetch(`https://graph.facebook.com/${version}/${phoneId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const upData = await up.json().catch(() => ({}));
  if (!up.ok || !upData.id) {
    logger.error("Error subiendo imagen", { status: up.status, upData });
    throw new Error(`image upload failed: ${up.status}`);
  }
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: caption ? { id: upData.id, caption } : { id: upData.id },
  };
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error("Error enviando imagen", { status: res.status, data });
    throw new Error(`send image failed: ${res.status}`);
  }
  return data;
}

// Envía cualquier archivo (buffer) al cliente, eligiendo el tipo por su mime.
async function sendMediaBuffer(to, buffer, mime, filename, caption) {
  const phoneId = WHATSAPP_PHONE_NUMBER_ID.value();
  const version = GRAPH_API_VERSION.value();
  const token = WHATSAPP_TOKEN.value();
  if (!token || token === "__PENDIENTE__") {
    logger.info("[DRY-RUN] Media saliente no enviada", { to, filename });
    return { dryRun: true };
  }
  const clean = (mime || "application/octet-stream").split(";")[0];
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", clean);
  form.append("file", new Blob([buffer], { type: clean }), filename || "archivo");
  const up = await fetch(`https://graph.facebook.com/${version}/${phoneId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const upData = await up.json().catch(() => ({}));
  if (!up.ok || !upData.id) {
    logger.error("Error subiendo media saliente", { status: up.status, upData });
    throw new Error(`media upload failed: ${up.status}`);
  }
  let type = "document";
  if (clean.startsWith("image/")) type = "image";
  else if (clean.startsWith("video/")) type = "video";
  else if (clean.startsWith("audio/")) type = "audio";
  const mediaObj = { id: upData.id };
  if (type === "document") { mediaObj.filename = filename || "archivo"; if (caption) mediaObj.caption = caption; }
  else if ((type === "image" || type === "video") && caption) mediaObj.caption = caption;
  const payload = { messaging_product: "whatsapp", to, type, [type]: mediaObj };
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error("Error enviando media saliente", { status: res.status, data });
    const err = new Error(`send media failed: ${res.status}`);
    err.waCode = data?.error?.code;
    throw err;
  }
  return { ...data, waType: type, mime: clean };
}

// Descarga un archivo entrante (imagen, etc.) de la API de WhatsApp.
async function downloadMedia(mediaId) {
  const token = WHATSAPP_TOKEN.value();
  const version = GRAPH_API_VERSION.value();
  // 1) obtener la URL temporal del archivo
  const metaRes = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok || !meta.url) {
    logger.error("No se pudo obtener la URL del media", { status: metaRes.status, meta });
    throw new Error(`media meta failed: ${metaRes.status}`);
  }
  // 2) descargar el binario (requiere el token en el header)
  const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!binRes.ok) throw new Error(`media download failed: ${binRes.status}`);
  const arr = await binRes.arrayBuffer();
  return { buffer: Buffer.from(arr), mimeType: meta.mime_type || "application/octet-stream" };
}

module.exports = { sendText, sendImage, sendDocument, sendMediaBuffer, downloadMedia };
