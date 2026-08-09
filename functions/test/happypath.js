// ============================================================
// DRY-RUN "camino feliz" de la Escuela de Dealers.
// Verifica que el bot: califica (nombre, programa, zona, fuente),
// informa, y cierra ofreciendo el Pase VIP (oferta 24h).
// No usa Firestore ni envía a WhatsApp.
//   node test/happypath.js
// ============================================================
const fs = require("fs");
const path = require("path");

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Turnos del usuario interesado (se responden uno a uno).
const turnos = [
  "Hola, vi su página y quiero ser dealer",
  "Me interesa el curso Trotamundos",
  "Me llamo Carlos",
  "Soy de San Juan de Lurigancho y los conocí por Instagram",
  "Sí, me encantaría ir a esa clase gratis",
  "El sábado por la mañana estaría bien",
];

(async () => {
  if (!process.env.LLM_API_KEY) {
    console.error("Falta LLM_API_KEY en .secret.local");
    process.exit(1);
  }
  console.log("CAMINO FELIZ — Escuela de Dealers (DRY-RUN)\n");
  const history = [];
  for (const texto of turnos) {
    console.log("👤 " + texto);
    history.push({ role: "user", text: texto });
    const reply = await brain.generateReply(history);
    history.push({ role: "assistant", text: reply });
    console.log("🤖 " + reply.replace(/\n/g, "\n   ") + "\n");
    await sleep(13000); // bajo 5 req/min del free tier
  }
})().catch((e) => {
  console.error("\n❌ Error:", e.message);
  process.exit(1);
});
