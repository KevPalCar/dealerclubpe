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

  // --- 2.5) Catálogo: entregar de palabra vs. prometerlo ----
  const entrega = _test.anunciaEntrega;
  check("entrega: 'te comparto el catálogo'", entrega("Gracias, Carlos. Te comparto el catálogo de la Escuela.") === true);
  check("entrega: 'aquí tiene el catálogo'", entrega("Perfecto, señor Díaz. Aquí tiene el catálogo de Casino de Fantasía.") === true);
  check("entrega aunque pida el apellido", entrega("Te envío el catálogo, Carlos. ¿Me confirmas tu apellido?") === true);
  check("promesa a cambio del nombre NO es entrega", entrega("Para enviarte el catálogo, ¿me das tu nombre y apellido?") === false);
  check("'te envío el catálogo en cuanto me des tu nombre' NO es entrega", entrega("Te envío el catálogo apenas me digas tu nombre, ¿con quién tengo el gusto?") === false);
  check("citar el catálogo ya enviado NO es entrega", entrega("Lo tienes en la página 3 del catálogo que te envié.") === false);
  check("sin mencionar catálogo NO es entrega", entrega("Te comparto la dirección: Coyllur 167.") === false);
  check("infiere escuela por el texto del bot", _test.inferirBrochure("Te comparto el catálogo de la Escuela de Dealers.", ["1"]) === "escuela");
  check("infiere eventos por el texto del bot", _test.inferirBrochure("Le comparto el catálogo de Casino de Fantasía.", ["hola"]) === "eventos");
  check("infiere por la elección anterior del lead", _test.inferirBrochure("Gracias, Ana. Te comparto el catálogo.", ["2", "Ana Pérez"]) === "eventos");
  check("no infiere nada si solo lo promete", _test.inferirBrochure("Para enviarle el catálogo de eventos, ¿con quién tengo el gusto?", ["2"]) === null);

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
