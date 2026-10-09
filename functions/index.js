// ============================================================
// Webhook de WhatsApp — DealerClub
// ------------------------------------------------------------
// Cloud Function HTTP que recibe los mensajes de la WhatsApp
// Cloud API, valida la firma, evita duplicados, respeta el flag
// de intervención humana, llama al cerebro y responde.
// ============================================================
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");

const cfg = require("./lib/config");
const store = require("./lib/store");
const brain = require("./lib/brain");
const wa = require("./lib/whatsapp");
const notify = require("./lib/notify");
const { BROCHURES, enviarBrochure } = require("./lib/brochures");

// Región cercana a Perú y límites razonables para v1.
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// --- Verificación de firma (X-Hub-Signature-256) ------------
function isValidSignature(req) {
  const appSecret = cfg.META_APP_SECRET.value();
  if (!appSecret || appSecret === "__PENDIENTE__") {
    logger.warn("META_APP_SECRET no configurado: se omite validación de firma");
    return true; // permite pruebas locales sin secret; en prod siempre estará
  }
  const signature = req.get("x-hub-signature-256");
  if (!signature || !req.rawBody) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Parseo del mensaje entrante ----------------------------
function parseIncoming(body) {
  try {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return null; // p.ej. notificaciones de estado (entregado/leído)

    const profileName = value?.contacts?.[0]?.profile?.name || null;
    const MEDIA_TYPES = ["image", "document", "audio", "video", "sticker"];
    const LABELS = { image: "imagen", document: "documento", audio: "audio", video: "video", sticker: "sticker" };
    let text = "";
    let mediaId = null;
    let caption = null;
    let filename = null;
    let mime = null;
    if (message.type === "text") {
      text = message.text?.body || "";
    } else if (MEDIA_TYPES.includes(message.type)) {
      const obj = message[message.type] || {};
      mediaId = obj.id || null;
      caption = obj.caption || null;
      filename = obj.filename || null;
      mime = obj.mime_type || null;
      const label = LABELS[message.type] || message.type;
      text = filename ? `[${label}] ${filename}` : caption ? `[${label}] ${caption}` : `[${label}]`;
    } else {
      text = `[mensaje de tipo ${message.type}]`;
    }

    return { from: message.from, id: message.id, type: message.type, text, profileName, mediaId, caption, filename, mime };
  } catch (err) {
    logger.error("Error parseando entrante", err);
    return null;
  }
}

// --- Estados de entrega de lo que enviamos ------------------
// Meta avisa aparte si cada mensaje saliente se entregó, se leyó o falló.
// OJO: fuera de la ventana de 24 h acepta el envío y el fallo llega SOLO por
// aquí; sin leerlo, un mensaje perdido se vería como enviado.
function parseStatuses(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      for (const s of change.value?.statuses || []) {
        if (!s.id || !s.recipient_id) continue;
        const e = s.errors?.[0];
        out.push({
          waId: s.id,
          phone: s.recipient_id,
          status: s.status,
          code: e?.code || null,
          detail: e?.error_data?.details || e?.title || e?.message || null,
        });
      }
    }
  }
  return out;
}

// Motivo del fallo en palabras de Kevin (se muestra en el panel y en la alerta).
function motivoFallo(code, detail) {
  const conocidos = {
    131047: "Pasaron más de 24 h desde su último mensaje: WhatsApp solo deja escribirle con plantilla de pago. Pídele que te escriba primero.",
    131026: "WhatsApp no pudo entregarlo: el número no tiene WhatsApp, lo tiene desactualizado o no acepta mensajes de empresas.",
    131049: "WhatsApp decidió no entregarlo para no saturar a esta persona. Vuelve a intentarlo más tarde.",
    131056: "Demasiados mensajes seguidos a este número. Espera un momento y reenvíalo.",
    131052: "WhatsApp no pudo procesar el archivo. Prueba con otro formato o un archivo más liviano.",
    131053: "WhatsApp no pudo procesar el archivo. Prueba con otro formato o un archivo más liviano.",
    131042: "Hay un problema con el método de pago de la cuenta de WhatsApp Business. Revísalo en Meta.",
  };
  return conocidos[code] || `WhatsApp no lo entregó (${detail || "sin detalle"}${code ? `, código ${code}` : ""}).`;
}

async function handleStatuses(statuses) {
  for (const s of statuses) {
    if (!["delivered", "read", "failed"].includes(s.status)) continue;
    const fallo = s.status === "failed";
    const error = fallo ? motivoFallo(s.code, s.detail) : null;
    try {
      // Un fallo puede llegar antes de que el mensaje quede guardado: se reintenta.
      let r = await store.setMessageStatus(s.phone, s.waId, s.status, error);
      for (let i = 0; fallo && !r && i < 2; i++) {
        await new Promise((ok) => setTimeout(ok, 1500));
        r = await store.setMessageStatus(s.phone, s.waId, s.status, error);
      }
      if (!fallo) continue;
      logger.error("Mensaje NO entregado", { to: s.phone, code: s.code, detail: s.detail });
      if (r === "unchanged") continue; // Meta repitió el aviso: ya se alertó
      await notify.notifyHuman(cfg.NTFY_TOPIC.value(), {
        title: "Mensaje NO entregado",
        message: `Un mensaje a +${s.phone} no llegó.\n${error}`,
        click: PANEL_URL + "?to=" + s.phone,
      });
    } catch (e) {
      logger.error("No se pudo anotar el estado de entrega", { error: e.message });
    }
  }
}

// Resuelve el archivo de una captura por nombre en functions/media/.
function resolveMedia(nombre) {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const p = path.join(__dirname, "media", `${nombre}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// WhatsApp no entiende markdown: el modelo a veces se escapa y manda
// "**negrita**" o viñetas "*   item", que el cliente ve tal cual.
function normalizarWhatsapp(texto) {
  return (
    texto
      // Viñetas de lista -> punto medio (antes que las negritas, para no
      // confundir el asterisco de viñeta con el de énfasis).
      .replace(/^[ \t]*[*-][ \t]{2,}/gm, "• ")
      .replace(/^[ \t]*[*-][ \t]+(?=\S)/gm, "• ")
      // **negrita** -> *negrita* (el formato real de WhatsApp)
      .replace(/\*\*(.+?)\*\*/gs, "*$1*")
      // Títulos markdown -> texto normal
      .replace(/^#{1,6}[ \t]*/gm, "")
      // La línea de la oferta debe ir sola, nunca pegada a una frase.
      .replace(/[ \t]*(🎟️\s*Oferta gratuita)/g, "\n\n$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// ¿El mensaje del bot ENTREGA el catálogo en este momento?
// "Te comparto el catálogo" es una entrega; "para enviarte el catálogo,
// ¿me das tu nombre?" es una promesa a futuro y NO debe disparar el envío.
function anunciaEntrega(texto) {
  const t = (texto || "").toLowerCase();
  if (!/(cat[aá]logo|brochure|folleto|dossier)/.test(t)) return false;
  const entrega =
    /\b(te|le|les)\s+(comparto|env[ií]o|adjunto|dejo|paso|mando|hago llegar|acabo de (enviar|compartir))\b/.test(t) ||
    /aqu[ií]\s+(tienes|tiene|va|est[aá]|te dejo|le dejo)/.test(t) ||
    /\badjunt[oa]\b/.test(t);
  if (!entrega) return false;
  const pideNombre =
    /\?/.test(t) && /(tu|su) nombre|nombre y apellido|con qui[eé]n tengo|c[oó]mo (te llamas|se llama)/.test(t);
  return !pideNombre;
}

// Red de seguridad: si el bot ENTREGA el catálogo en su mensaje pero olvidó la
// etiqueta [[BROCHURE:…]], deducimos cuál corresponde por lo que dijo él y por
// lo que pidió el lead en la conversación. Devuelve "escuela" | "eventos" | null.
function inferirBrochure(respuestaBot, mensajesLead) {
  if (!anunciaEntrega(respuestaBot)) return null;
  const bot = (respuestaBot || "").toLowerCase();

  // Pistas explícitas en lo que dijo el bot.
  if (/casino de fantas|evento|alquiler de mesas/.test(bot)) return "eventos";
  if (/escuela|curso|programa|dealer/.test(bot)) return "escuela";

  // Si no, por lo que eligió el lead (del mensaje más reciente al más antiguo).
  const leads = [].concat(mensajesLead || []).map((m) => (m || "").toLowerCase().trim()).reverse();
  for (const lead of leads) {
    if (/^2\b|2️⃣|casino de fantas|evento/.test(lead)) return "eventos";
    if (/^1\b|1️⃣|escuela|curso/.test(lead)) return "escuela";
  }
  return null;
}

// Panel de atención (bandeja de la empresa). Con ?to=<número> abre ese chat.
const PANEL_URL = "https://dealerclubpe.web.app/";

// Enlace que abre WhatsApp hacia el número de empresa con el comando
// "@<lead> " ya escrito, para que Kevin solo complete su mensaje.
function adminReplyLink(leadPhone) {
  const empresa = cfg.WHATSAPP_DISPLAY_NUMBER.value();
  return `https://wa.me/${empresa}?text=${encodeURIComponent("@" + leadPhone + " ")}`;
}

// Comandos de Kevin (admin) por WhatsApp:
//   @<numero> <mensaje>  -> el bot reenvía <mensaje> al lead (como empresa) y pausa el bot ahí.
//   @<numero> /bot       -> reactiva el bot en ese chat.
const ADMIN_HELP =
  "👋 Para atender a un lead tienes 2 formas:\n\n" +
  `1) PANEL (lo más fácil): ${PANEL_URL} — botones para responder, enviar el catálogo y pausar/reactivar el bot.\n\n` +
  "2) Por aquí (WhatsApp):\n" +
  "• Responder:  @<número del lead> tu mensaje\n" +
  "• Reactivar el bot:  @<número del lead> bot\n\n" +
  "Ejemplo:  @51999888777 Hola, soy Kevin de DealerClub";

async function handleAdminCommand(msg) {
  const text = (msg.text || "").trim();
  const m = text.match(/^@?(\d{6,15})\s+([\s\S]+)$/);
  if (!m) {
    // No es un comando válido (texto suelto, imagen, audio, etc.): manda ayuda.
    await wa.sendText(msg.from, ADMIN_HELP);
    return;
  }
  const lead = m[1];
  const body = m[2].trim();

  // Reactivar el bot: acepta "bot", "/bot", "activar", "reactivar".
  if (/^\/?(bot|activar|reactivar)$/i.test(body)) {
    await store.setHumanTakeover(lead, false);
    await wa.sendText(msg.from, `▶️ Bot REACTIVADO para +${lead}. Ya vuelve a responder solo en ese chat.`);
    logger.info("Admin reactivó el bot", { lead });
    return;
  }

  // Con la ventana de 24 h cerrada WhatsApp lo aceptaría y lo descartaría.
  if (store.windowState(await store.getConversation(lead)) === "closed") {
    await wa.sendText(msg.from, `⚠️ NO se envió a +${lead}. ${store.VENTANA_CERRADA}`);
    return;
  }

  try {
    const r = await wa.sendText(lead, body);
    await store.setHumanTakeover(lead, true);
    await store.appendMessages(lead, [
      { role: "assistant", text: body, ts: Date.now(), waId: r?.messages?.[0]?.id || null },
    ]);
    await wa.sendText(
      msg.from,
      `✅ Enviado al cliente +${lead} como DealerClub (tu número personal NO se mostró). Si WhatsApp no logra entregarlo, te llega una alerta.\n` +
        `⏸️ El bot quedó en pausa en ese chat.\n` +
        `▶️ Para que el bot vuelva a responder ahí, escribe:  @${lead} bot`
    );
    logger.info("Admin respondió a lead", { lead });
  } catch (e) {
    logger.error("Fallo al reenviar mensaje de admin", { lead, error: e.message });
    await wa.sendText(msg.from, `⚠️ No pude enviar a +${lead}: ${e.message}`);
  }
}

exports.webhook = onRequest({ secrets: cfg.ALL_SECRETS }, async (req, res) => {
  // ---- GET: verificación del webhook (Meta) ----------------
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === cfg.META_VERIFY_TOKEN.value()) {
      logger.info("Webhook verificado por Meta");
      return res.status(200).send(challenge);
    }
    logger.warn("Verificación de webhook fallida");
    return res.sendStatus(403);
  }

  if (req.method !== "POST") return res.sendStatus(405);

  // ---- POST: mensaje entrante ------------------------------
  if (!isValidSignature(req)) {
    logger.warn("Firma inválida: petición rechazada");
    return res.sendStatus(401);
  }

  // Responde 200 cuanto antes para que Meta no reintente.
  res.sendStatus(200);

  logger.info("POST recibido de Meta", {
    object: req.body?.object,
    field: req.body?.entry?.[0]?.changes?.[0]?.field,
  });

  const msg = parseIncoming(req.body);
  if (!msg || !msg.text) {
    // Sin mensaje: es un aviso de estado (entregado / leído / falló).
    await handleStatuses(parseStatuses(req.body));
    return;
  }
  logger.info("Mensaje entrante", { from: msg.from, type: msg.type });

  try {
    // 1) Anti-duplicados
    if (await store.isDuplicate(msg.id)) {
      logger.info("Mensaje duplicado ignorado", { id: msg.id });
      return;
    }

    // 1.5) ¿Es Kevin (admin) dando un comando? Entonces NO es un lead:
    //      controla el bot por WhatsApp (responder como empresa / pausar).
    if (msg.from === cfg.ADMIN_PHONE.value()) {
      await handleAdminCommand(msg);
      return;
    }

    // 2) Estado de conversación
    await store.ensureConversation(msg.from, msg.profileName);

    // 3) Guarda el mensaje del usuario (si trae archivo, lo descarga a Storage)
    const userEntry = { role: "user", text: msg.text, ts: Date.now() };
    if (msg.mediaId) {
      try {
        const media = await wa.downloadMedia(msg.mediaId);
        const path = await store.saveMedia(msg.from, msg.id, media.buffer, media.mimeType || msg.mime);
        userEntry.type = msg.type; // image | document | audio | video | sticker
        userEntry.storagePath = path;
        userEntry.mime = media.mimeType || msg.mime || null;
        if (msg.filename) userEntry.filename = msg.filename;
        if (msg.caption) userEntry.caption = msg.caption;
      } catch (e) {
        logger.error("No se pudo guardar el archivo entrante", { type: msg.type, error: e.message });
      }
    }
    await store.appendMessages(msg.from, [userEntry]);

    // 4) Lead base (se enriquecerá con extracción más adelante)
    await store.upsertLead(msg.from, {
      nombre: msg.profileName || null,
      ultimoMensaje: msg.text,
    });

    // 5) Intervención humana: si está activa, el bot calla
    if (await store.isHumanTakeover(msg.from)) {
      logger.info("Takeover activo: el bot no responde", { from: msg.from });
      return;
    }

    // 6) Cerebro -> respuesta (con respaldo si el modelo falla)
    const conv = await store.getConversation(msg.from);
    const history = (conv?.history || []).map((h) => ({ role: h.role, text: h.text }));
    let reply;
    try {
      reply = await brain.generateReply(history);
    } catch (err) {
      logger.error("Cerebro falló tras reintentos; enviando respaldo", err);
      reply =
        "Disculpa, estamos con alta demanda en este momento. En breve te atiende un asesor de DealerClub. 🎲";
      // Avisa a Kevin que el bot no pudo responder (para que intervenga).
      await notify.notifyHuman(cfg.NTFY_TOPIC.value(), {
        title: "Bot con problemas - atiende tu",
        message: `El bot no pudo responder a ${msg.profileName || "un lead"} (+${msg.from}).\nUltimo mensaje: ${msg.text}`,
        click: adminReplyLink(msg.from),
      });
    }
    if (!reply) return;

    // 7) Detectar etiquetas del cerebro: [[ESCALAR]] (derivar a humano)
    //    y [[BROCHURE:escuela|eventos]] (enviar PDF). Se quitan del texto.
    let escalar = false;
    const pedidos = [];
    const imagenes = [];
    const sinEtiquetas = reply
      .replace(/\[\[ESCALAR\]\]/gi, () => {
        escalar = true;
        return "";
      })
      .replace(/\[\[BROCHURE:(escuela|eventos)\]\]/gi, (_m, tipo) => {
        pedidos.push(tipo.toLowerCase());
        return "";
      })
      .replace(/\[\[IMG:([a-z0-9_-]+)\]\]/gi, (_m, nombre) => {
        imagenes.push(nombre.toLowerCase());
        return "";
      })
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const cleanReply = normalizarWhatsapp(sinEtiquetas);

    // 8) Enviar el texto (si quedó algo) y guardarlo en el historial.
    if (cleanReply) {
      const sendResult = await wa.sendText(msg.from, cleanReply);
      logger.info("Respuesta enviada", {
        to: msg.from,
        dryRun: !!sendResult?.dryRun,
        id: sendResult?.messages?.[0]?.id,
      });
      await store.appendMessages(msg.from, [
        { role: "assistant", text: cleanReply, ts: Date.now(), waId: sendResult?.messages?.[0]?.id || null },
      ]);
    }

    // 8.5) Promesa cumplida: el cerebro decide CUÁNDO enviar el catálogo con la
    //      etiqueta, pero a veces lo ENTREGA de palabra ("te comparto el
    //      catálogo") y olvida la etiqueta. En ese caso se envía igual. No aplica
    //      a la bienvenida ni cuando solo lo promete a cambio del nombre.
    const esBienvenida = !(conv?.history || []).some((h) => h.role === "assistant");
    if (!pedidos.length && !esBienvenida) {
      const delLead = (conv?.history || []).filter((h) => h.role === "user").map((h) => h.text);
      const inferido = inferirBrochure(cleanReply, delLead);
      if (inferido) {
        pedidos.push(inferido);
        logger.info("Brochure inferido (el cerebro lo entregó sin etiqueta)", { tipo: inferido, from: msg.from });
      }
    }

    // 9) Enviar los brochures pedidos que aún no se hayan enviado.
    const yaEnviados = conv?.brochuresSent || [];
    const nuevos = [...new Set(pedidos)].filter(
      (t) => BROCHURES[t] && !yaEnviados.includes(t)
    );
    const enviados = [];
    for (const t of nuevos) {
      try {
        const r = await enviarBrochure(msg.from, t);
        if (r.ok) {
          enviados.push(t);
          continue;
        }
        // El bot ya dijo que lo compartía: avisa a Kevin para que lo mande a mano.
        logger.error("Brochure NO enviado tras reintento", { tipo: t, error: r.error });
        await notify.notifyHuman(cfg.NTFY_TOPIC.value(), {
          title: "El bot no pudo enviar el catalogo",
          message: `A ${msg.profileName || "un lead"} (+${msg.from}) se le anunció el catálogo de ${t} pero el PDF no salió (${r.error}). Envíaselo desde el panel con el botón Catálogo.`,
          click: PANEL_URL + "?to=" + msg.from,
        });
      } catch (e) {
        logger.error("No se pudo enviar el brochure", { tipo: t, error: e.message });
      }
    }

    // 9.2) Casino de Fantasía: TODA cotización la arma un humano (depende del
    //      lugar, invitados, mesas, extras). Avisamos a Kevin apenas entra el
    //      lead —una sola vez— pero SIN pausar el bot: mientras él se organiza,
    //      el bot sigue conversando y recogiendo los datos del evento.
    if (enviados.includes("eventos")) {
      const primeraVez = await store.marcarAvisoUnico(msg.from, "eventAlertSent");
      if (primeraVez) {
        await notify.notifyHuman(cfg.NTFY_TOPIC.value(), {
          title: "Lead de eventos - Casino de Fantasia",
          message:
            `${msg.profileName || "Un lead"} (+${msg.from}) pidió información de Casino de Fantasía.\n` +
            `El bot ya le envió el catálogo y está recogiendo los datos del evento (fecha, lugar, invitados, mesas).\n` +
            `Entra cuando puedas para cotizar: el bot NO está pausado.`,
          click: adminReplyLink(msg.from),
          tags: "tada",
        });
        logger.info("Alerta de lead de eventos enviada", { from: msg.from });
      }
    }

    // 9.5) Enviar capturas/imágenes solicitadas por el cerebro ([[IMG:nombre]]).
    for (const nombre of [...new Set(imagenes)]) {
      const filePath = resolveMedia(nombre);
      if (!filePath) {
        logger.warn("Imagen no disponible", { nombre });
        continue;
      }
      try {
        await wa.sendImage(msg.from, filePath);
      } catch (e) {
        logger.error("No se pudo enviar la imagen", { nombre, error: e.message });
      }
    }

    // 10) Escalación a humano: pausa el bot en esta conversación y
    //     avisa a Kevin por push (ntfy) para que intervenga rápido.
    if (escalar) {
      await store.setHumanTakeover(msg.from, true);
      await notify.notifyHuman(cfg.NTFY_TOPIC.value(), {
        title: "Lead necesita atencion humana",
        message: `${msg.profileName || "Lead"} (+${msg.from}) pidió/necesita un asesor.\nUltimo mensaje: ${msg.text}\n(El bot quedó en pausa en este chat.)`,
        click: adminReplyLink(msg.from),
      });
      logger.info("Escalado a humano + alerta enviada", { from: msg.from });
    }
  } catch (err) {
    logger.error("Error procesando mensaje", err);
  }
});

// Helpers expuestos solo para pruebas locales (no afecta a producción).
exports._test = { parseIncoming, parseStatuses, motivoFallo, isValidSignature, inferirBrochure, anunciaEntrega };

// ---- Tareas programadas ------------------------------------
// Seguimiento a leads en silencio: revisa cada 30 min, solo escribe dentro
// del horario y de la ventana gratuita de 24 h (ver lib/followup.js).
exports.followUps = onSchedule(
  { schedule: "every 30 minutes", timeZone: "America/Lima", secrets: cfg.ALL_SECRETS },
  async () => {
    const r = await require("./lib/followup").run();
    logger.info("Seguimientos", r);
  }
);

// Informe semanal de chats (lunes 8:00, hora de Lima) + aviso a Kevin.
exports.weeklyInsights = onSchedule(
  { schedule: "every monday 08:00", timeZone: "America/Lima", secrets: cfg.ALL_SECRETS },
  async () => {
    const informe = await require("./lib/insights").run({ days: 7 });
    await notify.notifyHuman(cfg.NTFY_TOPIC.value(), {
      title: "Informe semanal del bot listo",
      message: `${informe.embudo.conversaciones} conversaciones esta semana. ${informe.resumen}`,
      click: "https://dealerclubpe.com/admin",
      priority: "default",
      tags: "bar_chart",
    });
  }
);

// Funciones del panel admin (callable).
const adminFns = require("./lib/admin");
exports.adminListConversations = adminFns.adminListConversations;
exports.adminGetConversation = adminFns.adminGetConversation;
exports.adminSendReply = adminFns.adminSendReply;
exports.adminSetTakeover = adminFns.adminSetTakeover;
exports.adminGetMedia = adminFns.adminGetMedia;
exports.adminSendMedia = adminFns.adminSendMedia;
exports.adminSendBrochure = adminFns.adminSendBrochure;
exports.adminStartChat = adminFns.adminStartChat;
exports.adminAnalyzeChats = adminFns.adminAnalyzeChats;
