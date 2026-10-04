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

module.exports = { BROCHURES, getBrochureBuffer };
