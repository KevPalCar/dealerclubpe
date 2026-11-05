// ============================================================
// Agenda de citas que el bot puede ofrecer (decisión de Kevin, 5 nov 2026)
// ------------------------------------------------------------
// El modelo se equivocaba calculando fechas: aquí se calculan los próximos
// horarios REALES y se le entregan listos para copiar.
//   Pase VIP (presencial, 30 min): lun-vie 12:00 y 16:00 · sáb 16:00
//   Evaluación gratis (videollamada, 30 min): lun-sáb 17:00
// Se puede cambiar sin tocar código en bot_settings/main.agenda:
//   { vip: { "1": [12,16], …, "6": [16] }, evaluacion: { "1": [17], … } }
// (clave = día de la semana, 0 domingo … 6 sábado; valor = horas en punto).
// ============================================================
const HORA = 60 * 60 * 1000;
const MARGEN_MS = 5 * HORA; // no se ofrece una cita que empiece en menos de 5 h (Kevin, 5 nov)

const POR_DEFECTO = {
  vip: { 1: [12, 16], 2: [12, 16], 3: [12, 16], 4: [12, 16], 5: [12, 16], 6: [16] },
  evaluacion: { 1: [17], 2: [17], 3: [17], 4: [17], 5: [17], 6: [17] },
};

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Lima es UTC-5 todo el año.
const aLima = (ms) => new Date(ms - 5 * HORA);
const desdeLima = (y, m, d, h) => Date.UTC(y, m, d, h + 5);

function hora12(h) {
  if (h === 12) return "12:00 p. m. (mediodía)";
  return `${h % 12}:00 ${h < 12 ? "a. m." : "p. m."}`;
}

// "hoy", "mañana jueves 6 de noviembre" o "el sábado 8 de noviembre".
function etiquetaDia(ms, ahora) {
  const l = aLima(ms), hoy = aLima(ahora);
  const dias = Math.round((Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) -
    Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate())) / (24 * HORA));
  const fecha = `${DIAS[l.getUTCDay()]} ${l.getUTCDate()} de ${MESES[l.getUTCMonth()]}`;
  if (dias === 0) return `hoy ${fecha}`;
  if (dias === 1) return `mañana ${fecha}`;
  return `el ${fecha}`;
}

// Próximos `n` horarios de un tipo de cita, en orden, desde `ahora`.
function proximos(tipo, ahora = Date.now(), n = 2, agenda = POR_DEFECTO) {
  const tabla = agenda[tipo] || POR_DEFECTO[tipo];
  const out = [];
  const base = aLima(ahora);
  for (let d = 0; d < 14 && out.length < n; d++) {
    const dia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + d));
    for (const h of [...(tabla[dia.getUTCDay()] || [])].sort((a, b) => a - b)) {
      const ms = desdeLima(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), h);
      if (ms - ahora < MARGEN_MS) continue;
      out.push({ ms, texto: `${etiquetaDia(ms, ahora)} a las ${hora12(h)}`, etiqueta: sello(ms) });
      if (out.length >= n) break;
    }
  }
  return out;
}

// "2026-11-06T12:00" (hora de Lima) para la etiqueta [[CITA:…]].
function sello(ms) {
  return aLima(ms).toISOString().slice(0, 16);
}

// Bloque para el system prompt.
function bloqueAgenda(ahora = Date.now(), agenda = POR_DEFECTO) {
  const vip = proximos("vip", ahora, 2, agenda);
  const ev = proximos("evaluacion", ahora, 2, agenda);
  const linea = (s) => `- ${s.texto}  → etiqueta [[CITA:${s.etiqueta}]]`;
  return (
    "## PRÓXIMOS HORARIOS DISPONIBLES (calculados por el sistema: cópialos tal cual)\n" +
    "Pase VIP (presencial en la escuela, 30 min, gratis) — ofrece estos dos:\n" + vip.map(linea).join("\n") + "\n" +
    "Evaluación gratis (por videollamada, 30 min) — ofrece estos dos:\n" + ev.map((s) => linea(s).replace("]]", ":video]]")).join("\n") + "\n" +
    "Si la persona pide otro día u hora DENTRO de la agenda fija (Pase VIP: lunes a viernes 12:00 p. m. o 4:00 p. m., sábado 4:00 p. m.; " +
    "evaluación: lunes a sábado 5:00 p. m.), acéptalo. Si no puede en NINGUNO de esos horarios, no inventes otro: ver \"Si no puede en ningún horario\"."
  );
}

module.exports = { proximos, bloqueAgenda, POR_DEFECTO, sello };
