// ============================================================
// NIVEL DE DEALER — Rookie → Pro Dealer → Elite Crew
// ============================================================
// Compartido por el campus del alumno y el admin. El nivel sale de
// cuatro factores que ya se registran: tiempo en el curso, asistencia,
// promedio de notas semanales y tareas entregadas.
//   · Pro Dealer se gana solo al cumplir sus requisitos.
//   · Elite Crew, además, necesita el visto bueno de la escuela: quien
//     llega aparece en la web como Dealer Destacado y entra a la lista
//     para los eventos del Casino de Fantasía.
//   · El nivel guardado en user_roles.level es un piso: nunca se baja
//     de ahí. El admin lo graba al abrir Progreso y puede fijarlo a mano.
// ============================================================

export const LEVELS = ['Rookie', 'Pro Dealer', 'Elite Crew'];

// "Élite VIP" es el nombre anterior de Elite Crew en fichas ya guardadas.
export const normLevel = (level) =>
    level === 'Élite VIP' ? 'Elite Crew' : LEVELS.includes(level) ? level : 'Rookie';

// Requisitos de cada nivel. `time` es la parte del plazo estimado del
// curso que debe haber pasado (0.5 = la mitad); el resto son mínimos.
export const LEVEL_RULES = {
    'Pro Dealer': { time: 0.5, attendance: 85, average: 14, tasks: 80 },
    'Elite Crew': { time: 1,   attendance: 90, average: 17, tasks: 90 }
};

const WEEKS_PER_MONTH = 4.345;
const DEFAULT_MONTHS  = 3;      // si el alumno aún no tiene plan de cuotas

// Cifras del alumno. `s` es su ficha (user_roles); `tasks` es
// { total, done } o null mientras las tareas no terminan de cargar.
export const levelStats = (s, tasks, today = new Date()) => {
    const log    = Object.values(s.attendanceLog || {});
    const scored = (s.weeklyGrades || []).filter(g => g && g.score != null);
    const start  = s.courseStartDate ? new Date(`${s.courseStartDate}T00:00:00`) : null;
    return {
        // El plazo estimado del curso son sus cuotas mensuales.
        courseWeeks: Math.round((+s.billing?.installments || DEFAULT_MONTHS) * WEEKS_PER_MONTH),
        weeks:       start ? Math.max(0, Math.floor((today - start) / (7 * 86400000))) : 0,
        attendance:  log.length ? Math.round(log.filter(v => v === 'present').length / log.length * 100) : (s.attendance ?? null),
        average:     scored.length ? +(scored.reduce((sum, g) => sum + (+g.score || 0), 0) / scored.length).toFixed(1) : (s.grades ?? null),
        tasksPct:    !tasks ? null : tasks.total ? Math.round(tasks.done / tasks.total * 100) : 100
    };
};

// Lista de requisitos de un nivel con lo que el alumno lleva en cada uno.
const checksFor = (level, st) => {
    const r         = LEVEL_RULES[level];
    const needWeeks = Math.round(st.courseWeeks * r.time);
    const pct       = (v) => (v == null ? 'sin registros' : `${v}%`);
    return [
        { label: 'Tiempo en el curso', ok: st.weeks >= needWeeks,
          text: `${Math.min(st.weeks, needWeeks)} de ${needWeeks} semanas` },
        { label: 'Asistencia', ok: st.attendance != null && st.attendance >= r.attendance,
          text: `${pct(st.attendance)} (mínimo ${r.attendance}%)` },
        { label: 'Promedio de notas', ok: st.average != null && st.average >= r.average,
          text: `${st.average ?? 'sin notas'} (mínimo ${r.average})` },
        { label: 'Tareas entregadas', ok: st.tasksPct != null && st.tasksPct >= r.tasks,
          text: `${pct(st.tasksPct)} (mínimo ${r.tasks}%)` }
    ];
};

// Estado completo del nivel de un alumno:
//   level       nivel que le corresponde hoy (nunca menor al guardado)
//   stored      el guardado en su ficha
//   next        siguiente nivel, o null si ya es Elite Crew
//   checks      requisitos del siguiente nivel: [{ label, ok, text }]
//   eliteReady  cumple todo para Elite Crew y espera el visto bueno
//   progress    0 a 1: avance en el camino completo (para la barra)
export const levelProgress = (s, tasks, today = new Date()) => {
    const st     = levelStats(s, tasks, today);
    const stored = normLevel(s.level);
    const meets  = (level) => checksFor(level, st).every(c => c.ok);

    const earned = meets('Pro Dealer') ? 'Pro Dealer' : 'Rookie';
    const level  = LEVELS[Math.max(LEVELS.indexOf(stored), LEVELS.indexOf(earned))];
    const next   = LEVELS[LEVELS.indexOf(level) + 1] || null;
    const checks = next ? checksFor(next, st) : [];
    const done   = checks.length ? checks.filter(c => c.ok).length / checks.length : 1;

    return {
        level, stored, next, checks, stats: st,
        eliteReady: level === 'Pro Dealer' && meets('Elite Crew'),
        progress:   next ? (LEVELS.indexOf(level) + done) / (LEVELS.length - 1) : 1
    };
};
