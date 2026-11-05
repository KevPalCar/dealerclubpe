// Prueba los reintentos del cerebro SIN llamar a Gemini (fetch simulado):
// no gasta cuota. Uso: node test/reintentos.test.js
process.env.LLM_API_KEY = "clave-falsa";
process.env.LLM_PROVIDER = "gemini";
const catalog = require("../lib/catalog");
catalog.getCatalogoTexto = async () => "CATÁLOGO DE PRUEBA";
const settings = require("../lib/botsettings");
settings.getBotSettings = async () => ({ notes: "", followUp: { enabled: false } });

const brain = require("../lib/brain");
const ok = { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "hola" }] } }] }) };
const err = (status, quotaId) => ({
  ok: false, status,
  json: async () => ({ error: { code: status, details: quotaId ? [{ violations: [{ quotaId }] }] : [] } }),
});
const DIARIA = "GenerateRequestsPerDayPerProjectPerModel-FreeTier";

let llamadas = [];
function simular(respuestas) {
  llamadas = [];
  global.fetch = async (url) => {
    llamadas.push(url.match(/models\/([^:]+)/)[1]);
    return respuestas.shift() || ok;
  };
}
let fallos = 0;
const check = (n, c) => { console.log((c ? "  OK  " : "  FALLA ") + n); if (!c) fallos++; };

(async () => {
  const t0 = Date.now();
  simular([err(503), err(503), ok]);
  check("503 dos veces y luego responde", (await brain.generateReply([{ role: "user", text: "hola" }])) === "hola" && llamadas.length === 3);
  check("espera 1 s + 3 s entre reintentos", Date.now() - t0 >= 3900);

  simular([err(429, DIARIA), ok]);
  check("cuota diaria: no reintenta, pasa al otro modelo", (await brain.generateReply([{ role: "user", text: "x" }])) === "hola" &&
    llamadas.join() === "gemini-2.5-flash-lite,gemini-2.5-flash");

  simular([err(429, DIARIA), err(429, DIARIA)]);
  let e;
  try { await brain.generateReply([{ role: "user", text: "x" }]); } catch (x) { e = x; }
  check("ambos sin cuota del día: avisa la causa sin reintentar", e && e.cuotaDiaria === true && llamadas.length === 2);

  simular([err(400)]);
  e = null;
  try { await brain.generateReply([{ role: "user", text: "x" }]); } catch (x) { e = x; }
  check("error 400 (no pasajero): no reintenta ni cambia de modelo", e && !e.cuotaDiaria && llamadas.length === 1);

  console.log(fallos ? `\n${fallos} con fallas` : "\nTodo OK");
  process.exit(fallos ? 1 : 0);
})();
