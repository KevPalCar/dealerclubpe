// ============================================================
// Llamadas de WhatsApp (Calling API) desde el panel
// ------------------------------------------------------------
// El audio va directo entre el navegador de Kevin (WebRTC) y WhatsApp;
// aquí solo pasa la señalización: el SDP del navegador se manda a Meta
// y el de Meta llega por el webhook (campo "calls") y se guarda en
// Firestore (wa_calls/{callId}) para que el panel lo recoja.
//
// Costos (nov 2026): las llamadas que HACE el cliente son gratis. Las que
// hace la empresa se cobran por minuto (~US$ 0.012/min a Perú) y requieren
// que el cliente acepte antes recibir llamadas (dura 7 días).
// ============================================================
const logger = require("firebase-functions/logger");
const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, GRAPH_API_VERSION } = require("./config");
const store = require("./store");

const COL = "wa_calls";

async function graph(method, pathAndQuery, body) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION.value()}/${WHATSAPP_PHONE_NUMBER_ID.value()}${pathAndQuery}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN.value()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error("Calling API", { pathAndQuery, action: body?.action, status: res.status, data });
    const err = new Error(data?.error?.error_user_msg || data?.error?.message || `Calling API ${res.status}`);
    err.waCode = data?.error?.code;
    throw err;
  }
  return data;
}

// ¿Puede la empresa llamarle? { status: no_permission|temporary|permanent, expira, puedePedir, puedeLlamar }
async function permiso(phone) {
  const d = await graph("GET", `/call_permissions?user_wa_id=${phone}`);
  const accion = (n) => (d.actions || []).find((a) => a.action_name === n);
  return {
    status: d.permission?.status || "no_permission",
    expira: d.permission?.expiration_time || d.permission?.expiration || null,
    puedePedir: accion("send_call_permission_request")?.can_perform_action !== false,
    puedeLlamar: accion("start_call")?.can_perform_action !== false,
  };
}

// Mensaje con botón para que el cliente acepte recibir llamadas (dentro de las 24 h).
async function pedirPermiso(phone, texto) {
  const r = await graph("POST", "/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "interactive",
    interactive: {
      type: "call_permission_request",
      action: { name: "call_permission_request" },
      body: { text: texto },
    },
  });
  return r?.messages?.[0]?.id || null;
}

// La empresa llama: `sdp` es la oferta del navegador. La respuesta de
// WhatsApp llega luego por el webhook.
async function llamar(phone, sdp) {
  const r = await graph("POST", "/calls", {
    messaging_product: "whatsapp",
    to: phone,
    action: "connect",
    session: { sdp_type: "offer", sdp },
  });
  const id = r?.calls?.[0]?.id;
  if (!id) throw new Error("WhatsApp no devolvió el id de la llamada.");
  await store.db.collection(COL).doc(id).set({
    id, phone, direction: "saliente", estado: "llamando", createdAt: Date.now(),
  });
  return id;
}

// Contestar una llamada entrante con la respuesta SDP del navegador.
async function contestar(callId, sdp) {
  const session = { sdp_type: "answer", sdp };
  await graph("POST", "/calls", { messaging_product: "whatsapp", call_id: callId, action: "pre_accept", session });
  await graph("POST", "/calls", { messaging_product: "whatsapp", call_id: callId, action: "accept", session });
  await store.db.collection(COL).doc(callId).set({ estado: "en curso", inicio: Date.now() }, { merge: true });
}

async function rechazar(callId) {
  await graph("POST", "/calls", { messaging_product: "whatsapp", call_id: callId, action: "reject" });
}

async function colgar(callId) {
  await graph("POST", "/calls", { messaging_product: "whatsapp", call_id: callId, action: "terminate" }).catch((e) => {
    // Si ya terminó del otro lado, Meta responde error: no es problema.
    logger.info("Terminate sin efecto", { callId, error: e.message });
  });
}

async function get(callId) {
  const snap = await store.db.collection(COL).doc(callId).get();
  return snap.exists ? snap.data() : null;
}

// Entrantes que aún suenan (las de hace más de 60 s ya las cortó WhatsApp).
async function entrantes() {
  const snap = await store.db.collection(COL).where("estado", "==", "sonando").get();
  return snap.docs.map((d) => d.data()).filter((c) => c.direction === "entrante" && Date.now() - c.createdAt < 60000);
}

// Texto para el historial del chat al terminar una llamada.
function resumen(c, duracion) {
  const quien = c.direction === "entrante" ? "Llamada entrante" : "Llamada saliente";
  if (!duracion) return `📞 ${quien} sin contestar`;
  const m = Math.floor(duracion / 60), s = duracion % 60;
  return `📞 ${quien} · ${m ? `${m} min ` : ""}${s} s`;
}

// --- Webhook: eventos de llamada ---------------------------------------
// Devuelve las llamadas entrantes nuevas (para avisar a Kevin).
async function onWebhook(body) {
  const nuevas = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const c of v.calls || []) {
        const ref = store.db.collection(COL).doc(c.id);
        if (c.event === "connect" && c.direction === "USER_INITIATED") {
          const phone = c.from || v.contacts?.[0]?.wa_id || null;
          const doc = {
            id: c.id, phone, direction: "entrante", estado: "sonando",
            nombre: v.contacts?.[0]?.profile?.name || null, oferta: c.session?.sdp || null, createdAt: Date.now(),
          };
          await ref.set(doc);
          nuevas.push(doc);
        } else if (c.event === "connect") {
          // Saliente: WhatsApp manda su respuesta SDP.
          await ref.set({ respuesta: c.session?.sdp || null }, { merge: true });
        } else if (c.event === "terminate") {
          const prev = (await ref.get()).data() || {};
          const duracion = c.duration || 0;
          await ref.set({ estado: "terminada", duracion, fin: Date.now(), fallo: c.status === "FAILED" }, { merge: true });
          const phone = prev.phone || c.from || c.to;
          if (phone) await store.appendMessages(phone, [{ role: "assistant", by: "asesor", type: "call", text: resumen(prev, duracion), ts: Date.now() }]);
        }
      }
      // Estado de una saliente: RINGING / ACCEPTED / REJECTED.
      for (const s of v.statuses || []) {
        if (s.type !== "call") continue;
        const estado = { RINGING: "sonando", ACCEPTED: "en curso", REJECTED: "rechazada" }[s.status];
        if (estado) await store.db.collection(COL).doc(s.id).set({ estado, ...(estado === "en curso" ? { inicio: Date.now() } : {}) }, { merge: true });
      }
    }
  }
  return nuevas;
}

function esEventoDeLlamada(body) {
  return (body?.entry || []).some((e) => (e.changes || []).some((c) =>
    c.field === "calls" || (c.value?.calls || []).length || (c.value?.statuses || []).some((s) => s.type === "call")));
}

module.exports = { permiso, pedirPermiso, llamar, contestar, rechazar, colgar, get, entrantes, onWebhook, esEventoDeLlamada };
