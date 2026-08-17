// ============================================================
// Catálogo en vivo (cursos y servicios) desde Firestore
// ------------------------------------------------------------
// El cerebro NO debe llevar precios escritos a mano: se
// desactualizan. Este módulo lee las MISMAS colecciones que
// edita el panel de admin y arma un bloque de texto que se
// inyecta en el system prompt en cada respuesta.
//
// Ruta: /artifacts/{APP_SCOPE}/public/data/{courses|services}
// (ver assets/js/firebase.js — dbPath()).
// ============================================================
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const APP_SCOPE = "default-app-id";
const BASE = `artifacts/${APP_SCOPE}/public/data`;

// Caché en memoria de la instancia: evita releer Firestore en cada
// mensaje sin dejar de reflejar rápido lo que Kevin cambia en el admin.
const TTL_MS = 60 * 1000;
let cache = { texto: null, ts: 0 };

const porOrden = (a, b) => (a.order ?? 999) - (b.order ?? 999);

// "S/ 700" + priceNote "Mensual"  ->  "S/ 700 Mensual"
// Un precio vacío o un guion ("-", "—") significa que no hay tarifa publicada.
function precio(c) {
  const p = limpio(c.price);
  const nota = limpio(c.priceNote);
  if (!p) return nota ? `a consultar (${nota})` : "a consultar";
  return nota ? `${p} ${nota}` : p;
}

// Algún documento trae basura guardada desde el admin (la cadena
// "undefined", espacios sueltos). No debe llegar al cliente.
function limpio(v) {
  const s = (v ?? "").toString().trim();
  return !s || /^(undefined|null|n\/a|-)$/i.test(s) ? "" : s;
}

function lineaCurso(c) {
  const juegos = Array.isArray(c.gamesIncluded)
    ? c.gamesIncluded.map(limpio).filter(Boolean).join(", ")
    : limpio(c.gamesIncluded);
  const horario = limpio(c.schedule);
  const duracion = limpio(c.duration);
  const partes = [
    limpio(c.name) || "Programa",
    limpio(c.tag) ? `(${limpio(c.tag)})` : null,
    limpio(c.status) || "Abierto",
    precio(c),
    horario ? `Horario: ${horario}` : "Horario: a coordinar",
    juegos ? `Juegos: ${juegos}` : null,
    duracion ? `Duración: ${duracion}` : null,
  ].filter(Boolean);
  return `- ${partes.join(" — ")}`;
}

function lineaServicio(s) {
  const partes = [
    s.name || "Servicio",
    s.status || "Activo",
    s.price ? s.price : "se cotiza a medida",
    s.description ? s.description.replace(/\s+/g, " ").trim() : null,
  ].filter(Boolean);
  return `- ${partes.join(" — ")}`;
}

async function leerColeccion(nombre) {
  const snap = await db.collection(`${BASE}/${nombre}`).get();
  return snap.docs.map((d) => d.data());
}

// Devuelve el bloque de texto para el system prompt, o null si
// Firestore falla (en ese caso el cerebro usa su copia de respaldo).
async function getCatalogoTexto() {
  if (cache.texto && Date.now() - cache.ts < TTL_MS) return cache.texto;

  try {
    const [cursos, servicios] = await Promise.all([
      leerColeccion("courses"),
      leerColeccion("services"),
    ]);

    if (!cursos.length && !servicios.length) return cache.texto || null;

    const texto = formatear(cursos, servicios);
    cache = { texto, ts: Date.now() };
    return texto;
  } catch (err) {
    logger.error("No se pudo leer el catálogo de Firestore", err);
    return cache.texto || null; // último bueno, o nada
  }
}

// Separado de la lectura para poder probarlo con datos de ejemplo.
function formatear(cursos, servicios) {
  const bloques = [];
  if (cursos.length) {
    bloques.push(
      "### Programas de la Escuela (dato vivo)\n" +
        cursos.sort(porOrden).map(lineaCurso).join("\n")
    );
  }
  if (servicios.length) {
    bloques.push(
      "### Servicios de Casino de Fantasía (dato vivo)\n" +
        servicios.sort(porOrden).map(lineaServicio).join("\n") +
        "\nRecuerda: en eventos NUNCA das precio, siempre se cotiza a medida."
    );
  }

  return (
    "## CATÁLOGO VIGENTE (fuente de verdad — leído del panel de admin)\n" +
    "Estos datos MANDAN sobre cualquier precio, horario o duración que aparezca en otra parte de tus instrucciones o en el catálogo PDF. " +
    "Si algo no está aquí, no lo inventes.\n\n" +
    bloques.join("\n\n")
  );
}

module.exports = { getCatalogoTexto, formatear };
