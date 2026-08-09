// ============================================================
// DRY-RUN de escenarios — muestra al bot en 3 situaciones.
// No usa Firestore ni envía a WhatsApp. Carga clave de .secret.local.
//   node test/scenarios.js
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

// El free tier de Gemini permite ~5 peticiones/min. Espaciamos para no chocar.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const escenarios = [
  {
    titulo: '1) OBJECIÓN "está caro" (Escuela, registro tú)',
    turnos: [
      "Hola, vi el curso Sabelotodo pero está caro",
    ],
  },
  {
    titulo: "2) EVENTOS / Casino de Fantasía (registro usted)",
    turnos: [
      "Buenas, quiero un casino para la fiesta de aniversario de mi empresa",
      "¿Cuánto costaría?",
    ],
  },
  {
    titulo: "3) Conversación en INGLÉS",
    turnos: [
      "Hi! I saw your ad, I want to become a dealer. How does it work?",
    ],
  },
];

(async () => {
  if (!process.env.LLM_API_KEY) {
    console.error("Falta LLM_API_KEY en .secret.local");
    process.exit(1);
  }
  for (const esc of escenarios) {
    console.log("\n========================================");
    console.log(esc.titulo);
    console.log("========================================");
    const history = [];
    for (const texto of esc.turnos) {
      console.log("\n👤 " + texto);
      history.push({ role: "user", text: texto });
      const reply = await brain.generateReply(history);
      history.push({ role: "assistant", text: reply });
      console.log("🤖 " + reply.replace(/\n/g, "\n   "));
      await sleep(13000); // mantenerse bajo 5 req/min del free tier
    }
  }
})().catch((e) => {
  console.error("\n❌ Error:", e.message);
  process.exit(1);
});
