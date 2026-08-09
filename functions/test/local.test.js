// ============================================================
// Pruebas locales SIN dependencias externas (sin Java/Firestore,
// sin login). Valida el núcleo del webhook: parseo + firma.
// Si defines LLM_API_KEY en el entorno, además prueba el cerebro.
//
// Ejecutar:  node test/local.test.js
// ============================================================
const crypto = require("crypto");
const assert = require("assert");

let pass = 0;
function check(name, cond) {
  assert.ok(cond, "FALLA: " + name);
  console.log("  OK  " + name);
  pass++;
}

(async () => {
  const { _test } = require("../index.js");

  // --- 1) Parseo de un mensaje entrante de WhatsApp ----------
  const fakePayload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "Kevin Test" } }],
              messages: [
                { from: "51999111222", id: "wamid.ABC123", type: "text", text: { body: "Hola, info de los cursos" } },
              ],
            },
          },
        ],
      },
    ],
  };
  const msg = _test.parseIncoming(fakePayload);
  check("parsea remitente", msg.from === "51999111222");
  check("parsea id", msg.id === "wamid.ABC123");
  check("parsea texto", msg.text === "Hola, info de los cursos");
  check("parsea nombre de perfil", msg.profileName === "Kevin Test");

  // Notificación de estado (sin messages) -> null
  check("ignora notificaciones de estado", _test.parseIncoming({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }) === null);

  // --- 2) Validación de firma X-Hub-Signature-256 -----------
  process.env.META_APP_SECRET = "secreto_de_prueba";
  const raw = Buffer.from(JSON.stringify(fakePayload));
  const goodSig = "sha256=" + crypto.createHmac("sha256", "secreto_de_prueba").update(raw).digest("hex");
  const mkReq = (sig) => ({ rawBody: raw, get: (h) => (h.toLowerCase() === "x-hub-signature-256" ? sig : undefined) });

  check("acepta firma válida", _test.isValidSignature(mkReq(goodSig)) === true);
  check("rechaza firma manipulada", _test.isValidSignature(mkReq("sha256=deadbeef")) === false);
  check("rechaza sin firma", _test.isValidSignature(mkReq(undefined)) === false);

  // --- 3) Cerebro (solo si hay clave) -----------------------
  if (process.env.LLM_API_KEY) {
    const brain = require("../lib/brain.js");
    const reply = await brain.generateReply([
      { role: "user", text: "Hola, ¿cuánto cuesta el curso Trotamundos?" },
    ]);
    check("el cerebro responde algo", reply && reply.length > 0);
    console.log("\n  Respuesta del bot:\n  ---\n  " + reply.replace(/\n/g, "\n  ") + "\n  ---");
  } else {
    console.log("  (omitido cerebro: define LLM_API_KEY para probarlo)");
  }

  console.log(`\n${pass} comprobaciones OK ✅`);
})().catch((e) => {
  console.error("\n❌", e.message);
  process.exit(1);
});
