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

  // --- 2.7) Estados de entrega y ventana de 24 h ------------
  const estados = _test.parseStatuses({
    entry: [{ changes: [{ value: { statuses: [
      { id: "wamid.OUT1", recipient_id: "51999111222", status: "delivered" },
      { id: "wamid.OUT2", recipient_id: "51999111222", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] },
    ] } }] }],
  });
  check("lee los avisos de estado", estados.length === 2 && estados[0].status === "delivered");
  check("lee el código del fallo", estados[1].code === 131047 && estados[1].phone === "51999111222");
  check("un mensaje entrante no trae estados", _test.parseStatuses(fakePayload).length === 0);
  check("explica el fallo por ventana de 24 h", /24 h/.test(_test.motivoFallo(131047)));
  check("fallo desconocido muestra el código", /código 999/.test(_test.motivoFallo(999, "Algo raro")));

  const store = require("../lib/store.js");
  const HORA = 60 * 60 * 1000;
  const t0 = Date.now();
  check("ventana abierta si escribió hace 2 h", store.windowState({ lastInboundAt: t0 - 2 * HORA }, t0) === "open");
  check("ventana cerrada si escribió hace 25 h", store.windowState({ lastInboundAt: t0 - 25 * HORA }, t0) === "closed");
  check("chats antiguos: usa el último mensaje del lead", store.windowState({ history: [{ role: "user", ts: t0 - 30 * HORA }, { role: "assistant", ts: t0 }] }, t0) === "closed");
  check("sin datos no se afirma nada", store.windowState({ history: [] }, t0) === "unknown" && store.windowState(null, t0) === "unknown");

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
