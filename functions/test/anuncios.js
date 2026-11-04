// ============================================================
// DRY-RUN de leads que llegan por los anuncios de Meta.
// Arma el historial y el foco igual que el webhook (bienvenida del anuncio
// + bloque ORIGEN) y muestra la respuesta del cerebro. No usa Firestore ni
// envía a WhatsApp. Gasta cuota de Gemini: una llamada por escenario.
//   node test/anuncios.js            (todos)
//   node test/anuncios.js 2 4        (solo esos)
// ============================================================
const fs = require("fs");
const path = require("path");

for (const file of [".env", ".secret.local"]) {
  const p = path.join(__dirname, "..", file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#") && !process.env[line.slice(0, i).trim()]) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}

// En local el Admin SDK no tiene credenciales: el catálogo vigente (precios,
// horarios) se lee por REST con la sesión del CLI de Firebase.
const catalog = require("../lib/catalog.js");
catalog.getCatalogoTexto = async () => {
  try {
    const tok = require(path.join(process.env.USERPROFILE || process.env.HOME, ".config/configstore/firebase-tools.json")).tokens.access_token;
    const r = await fetch("https://firestore.googleapis.com/v1/projects/dealerclubpe/databases/(default)/documents/artifacts/default-app-id/public/data/courses?pageSize=50", { headers: { Authorization: `Bearer ${tok}` } });
    const val = (v) => v.stringValue ?? v.integerValue ?? v.doubleValue ?? v.booleanValue ?? (v.arrayValue ? (v.arrayValue.values || []).map(val) : v.mapValue ? obj(v.mapValue.fields) : null);
    const obj = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, val(v)]));
    return catalog.formatear(((await r.json()).documents || []).map((d) => obj(d.fields)));
  } catch (e) {
    console.log("(sin catálogo: " + e.message + ")");
    return null;
  }
};
const brain = require("../lib/brain.js");
const t = require("../index.js")._test;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ANUNCIO = {
  escuela: { source_type: "ad", source_id: "1", body: "¿Te imaginas que te paguen por conocer el mundo? 🌍🚢" },
  eventos: { source_type: "ad", source_id: "2", body: "Lleva un casino de Las Vegas a tu celebración 🎰" },
};

// [título, anuncio | null, mensajes previos [{role,text}], mensaje del lead, segmento]
const ESCENARIOS = [
  ["Anuncio Escuela + 'Hola'", "escuela", [], "Hola"],
  ["Anuncio Eventos + 'Hola, quiero más información'", "eventos", [], "Hola, quiero más información"],
  ["Anuncio Escuela + '1'", "escuela", [], "1"],
  ["Anuncio Escuela + pregunta frecuente 3", "escuela", [], "Tengo experiencia como Dealer, quiero embarcar."],
  ["Anuncio Escuela + pregunta por cruceros", "escuela", [], "Hola, ¿esto es para trabajar en cruceros? no sé inglés"],
  ["Eventos: da su nombre (no debe ir catálogo)", "eventos",
    [{ role: "user", text: "Quiero mi celebración como Las Vegas, quiero cotizar." },
     { role: "assistant", text: "Buenas, con gusto le ayudo con su evento de Casino de Fantasía. Para registrar su cotización, ¿con quién tengo el gusto?" }],
    "Soy Carla Méndez", "eventos"],
  ["Eventos: pide material (sí va catálogo)", "eventos",
    [{ role: "user", text: "Quiero mi celebración como Las Vegas, quiero cotizar." },
     { role: "assistant", text: "Buenas, con gusto le ayudo con su evento de Casino de Fantasía. Para registrar su cotización, ¿con quién tengo el gusto?" },
     { role: "user", text: "Carla Méndez" },
     { role: "assistant", text: "Gracias, señora Méndez. Un asesor le preparará su cotización a medida; para adelantar: ¿qué tipo de evento tiene pensado?" }],
    "Un cumpleaños. ¿Tendrás algún material para verlo más a detalle?", "eventos"],
];

// Escuela: "desde cero" + "dame información" (caso Marcko), elige meta, y precio de entrada.
const MENU = "¡Hola! Te damos la bienvenida a DealerClub ♠️♥️. ¿En cuál de nuestros servicios estás interesado hoy?\n1️⃣ Escuela de Dealers\n2️⃣ Casino de Fantasía";
const PARTIDA = "Buena elección. Para orientarte bien: ¿ya tienes experiencia en casinos o empezarías desde cero?";
const META = "Claro, Marcko. Te formamos desde cero como dealer profesional: práctica en mesa real, certificación y bolsa de trabajo. Tenemos programas según tu meta: *Trotamundos*, pensado para llegar a cruceros, y *Spin a la Carta*, con los juegos más comerciales para entrar a casinos aquí. ¿Cuál de las dos va más contigo, o te cuento las demás opciones?";
ESCENARIOS.push(
  ["Escuela: desde cero + 'podrías brindarme información'", null,
    [{ role: "user", text: "Buen dia" }, { role: "assistant", text: MENU }, { role: "user", text: "1" }, { role: "assistant", text: PARTIDA }, { role: "user", text: "Desde 0" }],
    "Podrías brindarme información porfa", "escuela"],
  ["Escuela: elige la meta de cruceros (debe ir Pase VIP)", null,
    [{ role: "user", text: "1" }, { role: "assistant", text: PARTIDA }, { role: "user", text: "Desde 0" }, { role: "user", text: "Podrías brindarme información" }, { role: "assistant", text: META }],
    "La de cruceros", "escuela"],
  ["Escuela: pregunta el precio de entrada", null,
    [{ role: "user", text: "Hola necesito mas información sobre casino dealer" }, { role: "assistant", text: MENU }],
    "Cuanto esta el curso", null],
);

(async () => {
  const solo = process.argv.slice(2).map(Number);
  for (const [i, [titulo, anuncio, previos, texto, segment]] of ESCENARIOS.entries()) {
    if (solo.length && !solo.includes(i + 1)) continue;
    const primero = previos.length ? previos[0] : { role: "user", text: texto };
    const historia = [...previos.map((h, k) => ({ ...h, ts: k + 1 })), ...(previos.length ? [{ role: "user", text: texto, ts: 99 }] : [])];
    if (!previos.length) historia.push({ ...primero, ts: 1 });
    historia[0].mid = "m1";
    const conv = { history: historia, segment, ultimoAnuncio: anuncio ? t.origenDeAnuncio(ANUNCIO[anuncio], "m1") : null };
    if (conv.ultimoAnuncio) conv.ultimoAnuncio.ts = 0;
    const extra = [segment === "eventos" ? t.EVENTOS_FOCO : "", t.recienLlegadoDeAnuncio(conv) ? t.focoAnuncio(conv.ultimoAnuncio) : ""].filter(Boolean).join("\n");
    const history = t.conBienvenidaAnuncio(conv.history, conv).map((h) => ({ role: h.role, text: h.text }));
    console.log(`\n=== ${i + 1}. ${titulo} ===`);
    for (const h of history) console.log(`${h.role === "user" ? "CLIENTE" : "DEALERCLUB"}: ${h.text.replace(/\n/g, "\n   ")}`);
    try {
      const r = await brain.generateReply(history, extra ? { extra } : {});
      console.log(`BOT ▶ ${r.replace(/\n/g, "\n      ")}`);
    } catch (e) {
      console.log(`(error del modelo: ${e.message})`);
    }
    await sleep(13000);
  }
})();
