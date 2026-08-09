// ============================================================
// DRY-RUN del cerebro — conversa con el bot en consola.
// Carga la clave desde .env / .secret.local (no la imprime),
// no usa Firestore ni envía nada a WhatsApp.
//
// Ejecutar:  node test/dryrun.js
// ============================================================
const fs = require("fs");
const path = require("path");

// Carga simple de archivos KEY=VALUE (ignora comentarios y vacíos).
function loadEnv(file) {
  const p = path.join(__dirname, "..", file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (v && !process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env");
loadEnv(".secret.local");

const brain = require("../lib/brain.js");

// Mensajes de prueba (simulan a un interesado escribiendo por WhatsApp).
const turnos = [
  "Hola",
  "¿Cuánto cuesta el curso Trotamundos?",
  "¿Y hay trabajo después de terminar?",
];

(async () => {
  if (!process.env.LLM_API_KEY) {
    console.error("Falta LLM_API_KEY en .secret.local");
    process.exit(1);
  }
  console.log(`Proveedor: ${process.env.LLM_PROVIDER || "gemini"}  (modo DRY-RUN, no se envía a WhatsApp)\n`);

  const history = [];
  for (const texto of turnos) {
    console.log("👤 Usuario:  " + texto);
    history.push({ role: "user", text: texto });
    const reply = await brain.generateReply(history);
    history.push({ role: "assistant", text: reply });
    console.log("🤖 Bot:      " + reply.replace(/\n/g, "\n             ") + "\n");
  }
})().catch((e) => {
  console.error("\n❌ Error:", e.message);
  process.exit(1);
});
