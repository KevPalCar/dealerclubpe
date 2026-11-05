// Respaldo de Firestore a JSON (sin gcloud export, sin bucket, sin costo).
// Usa la sesión de `firebase login` del equipo para pedir un token y lee por la API REST.
//
//   node scripts/respaldo-firestore.js backups/2026-11-05
//
// Guarda cada colección en <carpeta>/<nombre>.json con los documentos en el formato
// REST de Firestore (tipos exactos: timestamps, números, mapas), para poder restaurarlos
// tal cual con PATCH si algo sale mal. Ver backups/LEEME.md.
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROJECT = "dealerclubpe";
const BASE = "artifacts/default-app-id/public/data";
// Lo que se va a tocar en los cambios del 5 nov (cursos, bot, configuración, brochures)
// y los leads (se agregan etiquetas nuevas).
const COLECCIONES = [
  `${BASE}/courses`,
  `${BASE}/bot_settings`,
  `${BASE}/config`,
  `${BASE}/brochures`,
  `${BASE}/tables`,
  "wa_leads",
];

const FT = path.join(process.env.APPDATA || os.homedir(), "npm", "node_modules", "firebase-tools");
const auth = require(path.join(FT, "lib", "auth.js"));

async function token() {
  const cuenta = auth.getGlobalDefaultAccount();
  if (!cuenta) throw new Error("No hay sesión de Firebase CLI. Ejecuta: firebase login");
  const t = await auth.getAccessToken(cuenta.tokens.refresh_token, ["https://www.googleapis.com/auth/cloud-platform"]);
  return t.access_token;
}

async function listar(tk, coleccion) {
  const docs = [];
  let pageToken = "";
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coleccion}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } });
    if (!r.ok) throw new Error(`${coleccion}: HTTP ${r.status} ${await r.text()}`);
    const j = await r.json();
    docs.push(...(j.documents || []));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return docs;
}

(async () => {
  const carpeta = process.argv[2];
  if (!carpeta) throw new Error("Uso: node scripts/respaldo-firestore.js <carpeta>");
  fs.mkdirSync(carpeta, { recursive: true });
  const tk = await token();
  const resumen = { proyecto: PROJECT, fecha: new Date().toISOString(), colecciones: {} };
  for (const c of COLECCIONES) {
    const docs = await listar(tk, c);
    const nombre = c.split("/").pop();
    fs.writeFileSync(path.join(carpeta, `${nombre}.json`), JSON.stringify({ coleccion: c, documentos: docs }, null, 2));
    resumen.colecciones[c] = { archivo: `${nombre}.json`, documentos: docs.length, ids: docs.map((d) => d.name.split("/").pop()) };
    console.log(`${c}: ${docs.length} documentos`);
  }
  fs.writeFileSync(path.join(carpeta, "_resumen.json"), JSON.stringify(resumen, null, 2));
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
