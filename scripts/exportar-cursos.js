// Descarga los cursos EN VIVO (lo que hoy muestra dealerclubpe.com/cursos) a
// maqueta/cursos.json, en el formato que usa la vista previa local y la página
// de pantallazos. Lectura pública: no necesita sesión.
//   node scripts/exportar-cursos.js
const fs = require("fs");
const path = require("path");

const BASE = "https://firestore.googleapis.com/v1/projects/dealerclubpe/databases/(default)/documents/artifacts/default-app-id/public/data";

// Formato REST de Firestore → valor JS.
function js(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(js);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, js(x)]));
  return null;
}

(async () => {
  const cursos = await (await fetch(`${BASE}/courses?pageSize=100`)).json();
  if (cursos.error) throw new Error(cursos.error.message);
  const config = await (await fetch(`${BASE}/config/cursos`)).json();
  const courses = (cursos.documents || []).map((d) => ({ id: decodeURIComponent(d.name.split("/").pop()), ...js({ mapValue: { fields: d.fields } }) }));
  const comunes = config.fields ? js(config.fields.comunes) : null;
  const out = path.join(__dirname, "..", "maqueta", "cursos.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ _nota: "Exportado en vivo " + new Date().toISOString(), comunes, courses }, null, 2));
  console.log(courses.map((c) => `${c.id}${c.combo ? " (+combo)" : ""}`).join("\n"));
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
