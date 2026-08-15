// ============================================================
// Definición de los brochures (catálogos PDF) que envía el bot.
// TODO envío lleva el mismo disclaimer al pie: el archivo es la
// versión MÁS ACTUAL a la fecha de envío y puede cambiar después.
// Así ningún PDF reenviado meses más tarde se lee como definitivo.
// ============================================================
const path = require("path");

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

module.exports = { BROCHURES };
