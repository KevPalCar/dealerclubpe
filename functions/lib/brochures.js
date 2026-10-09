// ============================================================
// Definición de los brochures (catálogos PDF) que envía el bot.
// TODO envío lleva el mismo disclaimer al pie: el archivo es la
// versión MÁS ACTUAL a la fecha de envío y puede cambiar después.
// Así ningún PDF reenviado meses más tarde se lee como definitivo.
// ============================================================
const path = require("path");
const fs = require("fs");
const logger = require("firebase-functions/logger");
const { db, BASE } = require("./botsettings");
const store = require("./store");
const wa = require("./whatsapp");

function fechaLima() {
  return new Date().toLocaleDateString("es-PE", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Disclaimer común a CUALQUIER brochure que se envíe.
function disclaimer() {
  return (
    `📌 Este archivo es la versión más actualizada a la fecha (${fechaLima()}). ` +
    `Su contenido puede estar sujeto a cambios o actualizaciones posteriores, ` +
    `así que confírmanos las condiciones vigentes antes de decidir.`
  );
}

const BROCHURES = {
  escuela: {
    file: path.join(__dirname, "..", "brochures", "escuela.pdf"),
    filename: "DealerClub - Escuela de Dealers.pdf",
    caption: () =>
      `Catálogo de la Escuela de Dealers ♠️♥️\n\n` + disclaimer(),
  },
  eventos: {
    file: path.join(__dirname, "..", "brochures", "eventos.pdf"),
    filename: "DealerClub - Casino de Fantasia.pdf",
    caption: () =>
      `Catálogo de Casino de Fantasía ♠️♦️\n` +
      `El servicio se cotiza a medida según su evento.\n\n` + disclaimer(),
  },
};

// PDF vigente de un brochure. Si Kevin subió uno desde el admin (queda en
// Firestore troceado en brochure_files/{tipo}_{n}), se usa ese; si no, o si
// la lectura falla, el archivo original que viaja con el bot.
const cachePdf = {}; // tipo -> { stamp, buffer }
async function getBrochureBuffer(tipo) {
  const local = () => fs.readFileSync(BROCHURES[tipo].file);
  try {
    const meta = await db.doc(`${BASE}/brochure_files/${tipo}`).get();
    if (!meta.exists || !meta.data().chunks) return local();
    const { chunks, updatedAt } = meta.data();
    const stamp = updatedAt && updatedAt.toMillis ? updatedAt.toMillis() : 0;
    if (cachePdf[tipo] && cachePdf[tipo].stamp === stamp) return cachePdf[tipo].buffer;

    const refs = Array.from({ length: chunks }, (_, i) => db.doc(`${BASE}/brochure_files/${tipo}_${i}`));
    const partes = await db.getAll(...refs);
    if (partes.some((p) => !p.exists)) throw new Error("faltan partes del PDF");
    const buffer = Buffer.from(partes.map((p) => p.data().data).join(""), "base64");
    if (buffer.slice(0, 4).toString() !== "%PDF") throw new Error("el archivo subido no es un PDF");
    cachePdf[tipo] = { stamp, buffer };
    return buffer;
  } catch (err) {
    logger.error("No se pudo leer el PDF del admin; se usa el original", { tipo, error: err.message });
    return local();
  }
}

// Envía el catálogo `tipo` a un número y lo deja anotado en su chat. Lo usan
// el bot (cuando el cerebro lo pide) y el panel (botón "Catálogo").
// Dos intentos: un fallo puntual de WhatsApp no debe dejar al lead sin su PDF.
// Devuelve { ok: true } o { ok: false, error, waCode }.
async function enviarBrochure(phone, tipo) {
  const b = BROCHURES[tipo];
  const caption = b.caption();
  let r, pdf = null, fallo = null, waCode = null;
  for (let intento = 1; intento <= 2; intento++) {
    try {
      pdf = pdf || (await getBrochureBuffer(tipo));
      r = await wa.sendDocument(phone, pdf, b.filename, caption);
      fallo = r && r.error ? r.error : null;
    } catch (e) {
      fallo = e.message;
      waCode = e.waCode || null;
    }
    if (!fallo) break;
    logger.warn("Fallo enviando el brochure", { tipo, intento, error: fallo });
  }
  if (fallo) return { ok: false, error: fallo, waCode };

  // Copia en Storage para que en el panel se VEA y se pueda abrir.
  const entry = {
    role: "assistant",
    type: "document",
    text: `[documento] ${b.filename}`,
    filename: b.filename,
    mime: "application/pdf",
    caption,
    ts: Date.now(),
  };
  const waId = r && r.messages && r.messages[0] && r.messages[0].id;
  if (waId) entry.waId = waId;
  try {
    entry.storagePath = await store.saveMedia(phone, "brochure_" + tipo + "_" + Date.now(), pdf, "application/pdf");
  } catch (e) {
    logger.warn("No se pudo guardar copia del brochure en Storage", { error: e.message });
  }
  await store.appendMessages(phone, [entry]);
  await store.addBrochuresSent(phone, [tipo]);
  logger.info("Brochure enviado", { tipo, phone });
  return { ok: true };
}

module.exports = { BROCHURES, getBrochureBuffer, enviarBrochure };
