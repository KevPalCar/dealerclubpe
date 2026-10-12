// ============================================================
// Citas de Pase VIP: enlace de calendario y confirmación
// ------------------------------------------------------------
// WhatsApp solo deja escribirle a alguien durante las 24 h siguientes a
// su último mensaje. Para que la cita no se olvide sin depender de eso:
//  1) al agendar se le manda un enlace para guardarla en SU calendario
//     (su teléfono se lo recuerda aunque nosotros ya no podamos escribir);
//  2) antes de que se cierre la ventana se le pide confirmar: su respuesta
//     la renueva;
//  3) si la ventana sigue abierta el día de la cita, se le recuerda.
// ============================================================
const HORA = 60 * 60 * 1000;
const VENTANA_MS = 23 * HORA; // margen de 1 h bajo las 24 h de WhatsApp
const PEDIR_DESDE_MS = 18 * HORA; // silencio a partir del cual se pide confirmar
const DIA_DE_MS = 3 * HORA; // el recordatorio final sale hasta 3 h antes
const DIRECCION = "Coyllur 167, 2.º piso, Zárate, San Juan de Lurigancho";
const COMO_LLEGAR = "Referencia: Puente Nuevo; de ahí sigues por Av. Gran Chimú (cuadra 18) o Malecón Checa.";

// Campo de la conversación donde se anota que ese aviso ya salió para esa cita.
const MARCA = { confirmar: "vipConfirmAskedFor", hoy: "vipDayRemindedFor" };

const enLima = (ms, opciones) => new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", ...opciones }).format(new Date(ms));
const diaDe = (ms) => enLima(ms, { weekday: "long", day: "numeric", month: "long" });
const horaDe = (ms) => enLima(ms, { hour: "numeric", minute: "2-digit", hour12: true });

// "20261014T160000" en hora de Lima (UTC-5 todo el año).
function sello(ms) {
  return new Date(ms - 5 * HORA).toISOString().replace(/[-:]/g, "").slice(0, 15);
}

// Enlace que abre Google Calendar con la cita ya llena (30 minutos).
function enlaceCalendario(cita, numeroEmpresa) {
  const confirmar = `https://wa.me/${numeroEmpresa}?text=${encodeURIComponent("Confirmo mi Pase VIP")}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "Pase VIP DealerClub" + (cita.video ? " (videollamada)" : ""),
    dates: `${sello(cita.at)}/${sello(cita.at + 30 * 60 * 1000)}`,
    ctz: "America/Lima",
    details: `30 minutos en una clase real. Confirma tu asistencia aquí: ${confirmar}`,
    location: cita.video ? "Videollamada" : DIRECCION,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ¿Toca escribirle por su cita? Devuelve "confirmar" | "hoy" | null.
//  - "hoy": faltan 3 h o menos y aún podemos escribirle.
//  - "confirmar": lleva 18 h callado (la ventana está por cerrarse) y la cita
//    es más adelante. Solo de 8:00 a 21:00, hora de Lima.
function tocaRecordatorio(conv, ahora, horaLima, ultimoDelLead) {
  if (!conv || !conv.vipAt || conv.vipAt <= ahora + 30 * 60 * 1000) return null;
  if (!ultimoDelLead || ahora - ultimoDelLead > VENTANA_MS) return null; // ya no podemos escribirle
  if (horaLima < 8 || horaLima >= 21) return null;
  if (conv.vipAt - ahora <= DIA_DE_MS) return conv[MARCA.hoy] === conv.vipAt ? null : "hoy";
  if (ahora - ultimoDelLead >= PEDIR_DESDE_MS) return conv[MARCA.confirmar] === conv.vipAt ? null : "confirmar";
  return null;
}

function textoRecordatorio(tipo, conv) {
  const hora = horaDe(conv.vipAt);
  const lugar = conv.vipVideo ? "por videollamada" : `en ${DIRECCION}`;
  if (tipo === "hoy") {
    return (
      `Hoy es tu Pase VIP 🎟️ Te esperamos a las ${hora} ${lugar}.` +
      (conv.vipVideo ? "" : `\n${COMO_LLEGAR}`) +
      `\n¿Vienes en camino?`
    );
  }
  return (
    `Tu Pase VIP quedó para el ${diaDe(conv.vipAt)} a las ${hora}, ${lugar} 🎟️\n` +
    `¿Me confirmas que vienes? Respóndeme *confirmo* y te dejo todo listo.`
  );
}

// --- Google Calendar del negocio ----------------------------
// La cita se anota en el calendario de la empresa para que a Kevin no se le
// pase. El bot entra con su propia cuenta de servicio (sin claves que
// guardar): basta con que ese calendario esté compartido con ella.
const METADATA = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default";
async function tokenCalendario() {
  const res = await fetch(`${METADATA}/token?scopes=https://www.googleapis.com/auth/calendar.events`, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!res.ok) throw new Error(`sin token (${res.status})`);
  return (await res.json()).access_token;
}

// Crea el evento, o lo mueve si la cita ya tenía uno (eventId). Devuelve su id.
async function anotarEnCalendario(calendarId, { cita, titulo, detalle, eventId }) {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const fecha = (ms) => ({ dateTime: new Date(ms).toISOString(), timeZone: "America/Lima" });
  const evento = {
    summary: titulo,
    description: detalle,
    location: cita.video ? "Videollamada" : DIRECCION,
    start: fecha(cita.at),
    end: fecha(cita.at + 30 * 60 * 1000),
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 24 * 60 }, { method: "popup", minutes: 60 }] },
  };
  const res = await fetch(eventId ? `${base}/${eventId}` : base, {
    method: eventId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${await tokenCalendario()}`, "Content-Type": "application/json" },
    body: JSON.stringify(evento),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${data?.error?.message || ""}`.trim());
  return data.id;
}

module.exports = { enlaceCalendario, tocaRecordatorio, textoRecordatorio, anotarEnCalendario, MARCA, sello };
