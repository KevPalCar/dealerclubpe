// ============================================================
// Definición de los brochures (catálogos PDF) que envía el bot.
// El caption lleva un disclaimer con la FECHA DE ENVÍO para que
// los precios/datos no queden desactualizados con el tiempo.
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

const BROCHURES = {
  escuela: {
    file: path.join(__dirname, "..", "brochures", "escuela.pdf"),
    filename: "DealerClub - Escuela de Dealers.pdf",
    caption: () =>
      `Catálogo de la Escuela de Dealers ♠️♥️\n` +
      `Nota: los precios mostrados son vigentes al ${fechaLima()} y pueden variar con el tiempo. Confírmalo con uno de nuestros asesores antes de inscribirte.`,
  },
  eventos: {
    file: path.join(__dirname, "..", "brochures", "eventos.pdf"),
    filename: "DealerClub - Casino de Fantasia.pdf",
    caption: () =>
      `Catálogo de Casino de Fantasía ♠️♦️\n` +
      `Información referencial al ${fechaLima()}. El servicio se cotiza a medida según su evento.`,
  },
};

module.exports = { BROCHURES };
