// Carga en Firestore los cursos del 5 nov 2026 (scripts/cursos-5nov.json):
// tarjetas de dos caras, Bienvenidos a Bordo, combo de Trotamundos y
// condiciones comunes; elimina Al Asador. Respaldo previo en backups/2026-11-05.
//
//   node scripts/cursos-5nov.js          → muestra lo que haría (no escribe)
//   node scripts/cursos-5nov.js aplicar  → escribe en Firestore
//
// Solo toca los campos de la tarjeta: classDays y lo demás de cada curso se conserva.
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROJECT = "dealerclubpe";
const BASE = `projects/${PROJECT}/databases/(default)/documents/artifacts/default-app-id/public/data`;
const URL_BASE = `https://firestore.googleapis.com/v1/${BASE}`;
const CAMPOS = ["name", "order", "tag", "status", "description", "price", "priceNote", "schedule", "duration",
  "gamesIncluded", "gamesLabel", "isNew", "ctaText", "ctaWhatsapp", "backRules", "backWarning", "combo"];
const ELIMINAR = ["Al Asador"];
const BASURA = ["order "]; // campo con espacio que quedó en Sabelotodo

const auth = require(path.join(process.env.APPDATA || os.homedir(), "npm", "node_modules", "firebase-tools", "lib", "auth.js"));
async function token() {
  const c = auth.getGlobalDefaultAccount();
  return (await auth.getAccessToken(c.tokens.refresh_token, ["https://www.googleapis.com/auth/cloud-platform"])).access_token;
}

// Valor JS → formato REST de Firestore.
function val(v) {
  if (Array.isArray(v)) return { arrayValue: { values: v.map(val) } };
  if (v && typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === "number") return { doubleValue: v };
  return { stringValue: String(v ?? "") };
}
const ruta = (campo) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(campo) ? campo : "`" + campo.replace(/`/g, "\\`") + "`");

(async () => {
  const aplicar = process.argv[2] === "aplicar";
  const datos = JSON.parse(fs.readFileSync(path.join(__dirname, "cursos-5nov.json"), "utf8"));
  const tk = await token();
  const H = { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" };

  for (const c of datos.courses) {
    const fields = {};
    for (const k of CAMPOS) if (c[k] !== undefined) fields[k] = val(c[k]);
    fields.lastUpdated = { timestampValue: new Date().toISOString() };
    // updateMask: los campos de la tarjeta (los ausentes se BORRAN, ej. combo en un curso sin combo) + basura.
    const mask = [...CAMPOS, "lastUpdated", ...BASURA].map((f) => "updateMask.fieldPaths=" + encodeURIComponent(ruta(f))).join("&");
    const url = `${URL_BASE}/courses/${encodeURIComponent(c.id)}?${mask}`;
    console.log(`${aplicar ? "ESCRIBE" : "haría  "}  courses/${c.id}  (orden ${c.order}, ${c.status}, ${c.price || "a cotizar"}${c.combo ? ", con combo" : ""})`);
    if (aplicar) {
      const r = await fetch(url, { method: "PATCH", headers: H, body: JSON.stringify({ fields }) });
      if (!r.ok) throw new Error(`courses/${c.id}: ${r.status} ${await r.text()}`);
    }
  }
  for (const id of ELIMINAR) {
    console.log(`${aplicar ? "BORRA  " : "haría  "}  courses/${id}`);
    if (aplicar) {
      const r = await fetch(`${URL_BASE}/courses/${encodeURIComponent(id)}`, { method: "DELETE", headers: H });
      if (!r.ok) throw new Error(`borrar ${id}: ${r.status} ${await r.text()}`);
    }
  }
  console.log(`${aplicar ? "ESCRIBE" : "haría  "}  config/cursos.comunes (${datos.comunes.length} puntos)`);
  if (aplicar) {
    const r = await fetch(`${URL_BASE}/config/cursos?updateMask.fieldPaths=comunes&updateMask.fieldPaths=updatedAt`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ fields: { comunes: val(datos.comunes), updatedAt: { timestampValue: new Date().toISOString() } } }),
    });
    if (!r.ok) throw new Error(`config/cursos: ${r.status} ${await r.text()}`);
  }
  console.log(aplicar ? "\nListo." : "\nNada escrito. Para aplicar: node scripts/cursos-5nov.js aplicar");
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
