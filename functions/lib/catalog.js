// ============================================================
// Catálogo en vivo (cursos y brochures) desde Firestore
// ------------------------------------------------------------
// El cerebro NO debe llevar precios escritos a mano: se
// desactualizan. Este módulo lee las MISMAS colecciones que
// edita el panel de admin y arma un bloque de texto que se
// inyecta en el system prompt en cada respuesta.
//
// Ruta: /artifacts/{APP_SCOPE}/public/data/{courses|brochures}
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

const porOrden = (a, b) => (Number(a.order) || 999) - (Number(b.order) || 999);

// "S/ 700" + priceNote "Mensual"  ->  "S/ 700 Mensual"
// Un precio vacío o un guion ("-", "—") significa que no hay tarifa publicada.
function precio(c) {
  const p = limpio(c.price);
  const nota = limpio(c.priceNote);
  if (!p) return nota && !/cotiz|consult/i.test(nota) ? `a cotizar (${nota})` : "a cotizar según lo que elija";
  return nota ? `${p} ${nota}` : p;
}

// Algún documento trae basura guardada desde el admin (la cadena
// "undefined", espacios sueltos). No debe llegar al cliente.
function limpio(v) {
  const s = (v ?? "").toString().trim();
  return !s || /^(undefined|null|n\/a|-|—)$/i.test(s) ? "" : s;
}
const textos = (arr) => (Array.isArray(arr) ? arr.map(limpio).filter(Boolean) : []);

// Estado del curso → cómo debe tratarlo el bot (regla de Kevin, 5 nov 2026).
function estadoDe(c) {
  const s = limpio(c.status).toLowerCase();
  if (/cerrad/.test(s)) return "CERRADO";
  if (/pr[oó]xim/.test(s)) return "PRÓXIMAMENTE";
  return "ABIERTO";
}

// Rango de mensualidades de los programas abiertos, para responder un
// "¿cuánto cuesta?" antes de saber qué programa le calza.
function rangoMensual(cursos) {
  const montos = cursos
    .filter((c) => /mensual/i.test(limpio(c.priceNote)) && !/pr[oó]ximamente|cerrado/i.test(limpio(c.status)))
    .map((c) => Number(limpio(c.price).replace(/[^\d.]/g, "")))
    .filter((n) => n > 0);
  if (!montos.length) return null;
  const min = Math.min(...montos), max = Math.max(...montos);
  return min === max
    ? `S/ ${min} al mes`
    : `desde S/ ${min} hasta S/ ${max} al mes, según el programa`;
}

// Bloque de un programa: lo mismo que muestra su tarjeta en /cursos, frente
// y reverso ("lo que debes saber"), más su combo si lo tiene.
function lineaCurso(c) {
  const juegos = Array.isArray(c.gamesIncluded) ? textos(c.gamesIncluded).join(", ") : limpio(c.gamesIncluded);
  const horario = limpio(c.schedule);
  const duracion = limpio(c.duration);
  const etiquetaLista = limpio(c.gamesLabel) || "Juegos";
  const cabecera = [
    `### ${limpio(c.name) || "Programa"} [${estadoDe(c)}]`,
    limpio(c.tag) ? `(${limpio(c.tag)})` : null,
    c.isNew ? "(NUEVO)" : null,
  ].filter(Boolean).join(" ");
  const lineas = [
    cabecera,
    limpio(c.description) ? `Para quién: ${limpio(c.description)}` : null,
    `Precio: ${precio(c)}`,
    `Horario: ${horario || "a coordinar"}`,
    duracion ? `Duración: ${duracion}` : null,
    juegos ? `${etiquetaLista}: ${juegos}` : null,
  ];
  const reglas = textos(c.backRules);
  if (reglas.length) lineas.push("Lo que debe saber de este programa:", ...reglas.map((r) => `  · ${r}`));
  if (limpio(c.backWarning)) lineas.push(`Aviso: ${limpio(c.backWarning)}`);
  const k = c.combo && limpio(c.combo.name) ? c.combo : null;
  if (k) {
    lineas.push(
      `COMBO disponible: ${limpio(k.name)} — ${limpio(k.price)}${limpio(k.priceNote) ? " " + limpio(k.priceNote) : ""}` +
        (limpio(k.wasPrice) ? ` (por separado costaría ${limpio(k.wasPrice)})` : "")
    );
    const extra = textos(k.addLines);
    if (extra.length) lineas.push(`  El combo suma: ${extra.join("; ")}`);
    const rk = textos(k.backRules);
    if (rk.length) lineas.push("  Lo que debe saber del combo:", ...rk.map((r) => `    · ${r}`));
    if (limpio(k.backWarning)) lineas.push(`  Aviso del combo: ${limpio(k.backWarning)}`);
  }
  return lineas.filter(Boolean).join("\n");
}

async function leerColeccion(nombre) {
  const snap = await db.collection(`${BASE}/${nombre}`).get();
  return snap.docs.map((d) => d.data());
}

// Condiciones comunes a todos los cursos (reverso de las tarjetas, editable en
// Admin → Cursos → Condiciones comunes).
async function leerComunes() {
  const snap = await db.doc(`${BASE}/config/cursos`).get();
  return snap.exists ? textos(snap.data().comunes) : [];
}

// Devuelve el bloque de texto para el system prompt, o null si
// Firestore falla (en ese caso el cerebro usa su copia de respaldo).
async function getCatalogoTexto() {
  if (cache.texto && Date.now() - cache.ts < TTL_MS) return cache.texto;

  try {
    const [cursos, mesas, brochureEventos, brochureEscuela, comunes] = await Promise.all([
      leerColeccion("courses"),
      leerColeccion("tables"),
      leerBrochure("eventos"),
      leerBrochure("escuela"),
      leerComunes().catch(() => []),
    ]);

    if (!cursos.length && !brochureEventos && !brochureEscuela) return cache.texto || null;

    // El catálogo en vivo (precios, horarios) va primero: manda sobre el brochure.
    const texto = [formatear(cursos, comunes), formatearMesas(mesas), brochureEscuela, brochureEventos].filter(Boolean).join("\n\n");
    cache = { texto, ts: Date.now() };
    return texto;
  } catch (err) {
    logger.error("No se pudo leer el catálogo de Firestore", err);
    return cache.texto || null; // último bueno, o nada
  }
}

// Texto del brochure tal como Kevin lo dejó en el admin (solo existe si lo
// editó). Así el bot dice lo mismo que el PDF vigente sin tocar el código.
async function leerBrochure(tipo) {
  const snap = await db.doc(`${BASE}/brochures/${tipo}`).get();
  const texto = snap.exists ? (snap.data().plain || "").trim() : "";
  if (!texto) return null;
  return (
    `## CONTENIDO VIGENTE DEL CATÁLOGO DE ${tipo.toUpperCase()} (el que recibe el cliente)\n` +
    "Si algo de tus instrucciones contradice este contenido, vale este." +
    (tipo === "eventos" ? " En eventos sigues SIN dar precios." : "") +
    `\n\n${texto.slice(0, 6000)}`
  );
}

// Separado de la lectura para poder probarlo con datos de ejemplo.
function formatear(cursos, comunes = []) {
  if (!cursos.length) return null;
  const ordenados = [...cursos].sort(porOrden);
  const rango = rangoMensual(ordenados);
  return (
    "## CATÁLOGO VIGENTE (fuente de verdad — leído en vivo del panel de admin)\n" +
    "Estos datos MANDAN sobre cualquier precio, horario, duración, programa o condición que aparezca en otra parte de tus instrucciones, " +
    "en ejemplos o en el catálogo PDF. Es lo mismo que el cliente ve en las tarjetas de dealerclubpe.com/cursos (frente y reverso). " +
    "Si algo no está aquí, no lo inventes.\n\n" +
    "REGLAS POR ESTADO (obligatorias):\n" +
    "- [ABIERTO]: se ofrece normalmente.\n" +
    "- [CERRADO]: NO lo ofrezcas ni lo recomiendes. Si lo piden, di \"Ese programa no tiene cupos por ahora\" y ofrece el programa ABIERTO más parecido a lo que busca.\n" +
    "- [PRÓXIMAMENTE]: si lo piden, di que aún no inicia y ofrece anotarlo en la lista de espera; si acepta, pon en línea aparte [[AVISO:Lista de espera - <nombre>, programa <X>]].\n" +
    "Nunca recomiendes por iniciativa propia un programa que no esté [ABIERTO].\n\n" +
    "### Programas de la Escuela (dato vivo)\n\n" +
    ordenados.map(lineaCurso).join("\n\n") +
    (comunes.length ? "\n\n### Condiciones para TODOS los programas\n" + comunes.map((t) => `- ${t}`).join("\n") : "") +
    (rango ? `\n\nSi preguntan "¿cuánto cuesta?" y aún no sabes qué programa le calza, responde con este rango, tal cual y primero: ${rango}, todo incluido.` : "") +
    "\n\nRecuerda: en eventos (Casino de Fantasía) NUNCA das precio, siempre se cotiza a medida."
  );
}

// Las mesas de Casino de Fantasía con la descripción que se ve en /servicios
// (se editan en el admin). Sirven para orientar a quien no sabe qué juego pedir.
function formatearMesas(mesas) {
  const lineas = mesas
    .filter((m) => limpio(m.name))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map((m) => {
      const desc = limpio(m.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const partes = [
        limpio(m.name),
        limpio(m.status) || "Disponible",
        m.maxPlayers ? `hasta ${m.maxPlayers} jugadores` : null,
        desc || null,
      ].filter(Boolean);
      return `- ${partes.join(" — ")}`;
    });
  if (!lineas.length) return null;
  return (
    "### Mesas de Casino de Fantasía (descripción de la web: https://dealerclubpe.com/servicios)\n" +
    "Úsalas para orientar a quien no sabe qué juego pedir. Sin precios.\n" +
    lineas.join("\n")
  );
}

module.exports = { getCatalogoTexto, formatear, formatearMesas };
