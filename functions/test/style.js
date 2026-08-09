// Prueba rápida del nuevo estilo (menú + Pase VIP). node test/style.js
const fs = require("fs"), path = require("path");
for (const f of [".env", ".secret.local"]) {
  const p = path.join(__dirname, "..", f);
  if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = l.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i < 0) continue;
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
    if (v && !process.env[k]) process.env[k] = v;
  }
}
const brain = require("../lib/brain.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const turnos = ["Hola", "1", "está algo caro la verdad"];
(async () => {
  const history = [];
  for (const texto of turnos) {
    console.log("\n👤 " + texto);
    history.push({ role: "user", text: texto });
    const reply = await brain.generateReply(history);
    history.push({ role: "assistant", text: reply });
    console.log("🤖 " + reply.replace(/\n/g, "\n   "));
    await sleep(13000);
  }
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
