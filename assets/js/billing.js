// ============================================================
// PAGOS MENSUALES — cálculo de cuotas y vencimientos
// ============================================================
// Compartido por el admin y el campus del alumno (también la regla del
// descuento por referidos, al final). El plan vive en
// user_roles/{uid}.billing:
//   { startDate: 'YYYY-MM-DD',   // inicio de clases: fija el día de pago
//     amount: 500,               // mensualidad en soles
//     installments: 3,           // número de cuotas del curso
//     paid: [{ n, amount, paidAt, paymentId }] }
// La cuota n vence el mismo día del mes que el inicio, n-1 meses
// después. La cuota 1 es el pago con el que el alumno se activa.
// ============================================================

const pad = (n) => String(n).padStart(2, '0');

export const toYmd   = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromYmd = (s) => new Date(`${s}T00:00:00`);
export const fmtDate = (ymd) => ymd
    ? fromYmd(ymd).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';

// Lunes siguiente a la fecha dada (si hoy es lunes, el de la próxima semana).
export const nextMonday = (from = new Date()) => {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return toYmd(d);
};

// Vencimiento de la cuota n. Si el mes no tiene ese día (p. ej. 31), usa el último.
export const dueDate = (startYmd, n) => {
    const s = fromYmd(startYmd);
    const d = new Date(s.getFullYear(), s.getMonth() + (n - 1), 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(s.getDate(), lastDay));
    return toYmd(d);
};

// Días de gracia tras el vencimiento antes de considerar la suspensión.
export const GRACE_DAYS = 5;
// Días de anticipación con los que se avisa de un vencimiento.
export const NOTICE_DAYS = 7;

// Calendario completo de cuotas. Estado de cada una:
//   'paid' | 'overdue' | 'soon' | 'next' | 'future'
// Solo la primera cuota sin pagar lleva estado y días restantes.
export const billingSchedule = (billing, today = new Date()) => {
    if (!billing?.startDate || !billing.installments) return [];
    const now  = fromYmd(toYmd(today));
    const paid = new Map((billing.paid || []).map(p => [p.n, p]));
    let currentFound = false;

    return Array.from({ length: billing.installments }, (_, i) => {
        const n       = i + 1;
        const due     = dueDate(billing.startDate, n);
        const payment = paid.get(n) || null;
        let state = 'future', days = null;
        if (payment) {
            state = 'paid';
        } else if (!currentFound) {
            currentFound = true;
            days  = Math.round((fromYmd(due) - now) / 86400000);
            state = days < 0 ? 'overdue' : days <= NOTICE_DAYS ? 'soon' : 'next';
        }
        return { n, due, payment, state, days };
    });
};

// Resumen para tablas y tarjetas:
//   { state: 'unset' }                         sin plan configurado
//   { state: 'complete', total, paidCount }    todas las cuotas pagadas
//   { state, n, due, days, total, paidCount }  cuota vigente
export const billingSummary = (billing, today = new Date()) => {
    const schedule = billingSchedule(billing, today);
    if (!schedule.length) return { state: 'unset' };
    const paidCount = schedule.filter(c => c.state === 'paid').length;
    const current   = schedule.find(c => c.state !== 'paid' && c.state !== 'future');
    if (!current) return { state: 'complete', total: schedule.length, paidCount };
    return { ...current, total: schedule.length, paidCount };
};

// ── DESCUENTO POR REFERIDOS ─────────────────────────────────
// Cuenta cada persona que indica el código del alumno al registrarse Y
// paga su primera cuota: el referido se anota solo al activarla en
// Alumnos (o a mano en Referidos, para casos anteriores).
// Por los referidos de un mes calendario: 10% por el primero y 5% más
// por cada uno adicional, hasta el tope. Ese descuento se aplica a la
// cuota del mes SIGUIENTE y ahí se agota: no se acumula de mes a mes.
export const REFERRAL_FIRST = 10;
export const REFERRAL_EXTRA = 5;
export const REFERRAL_MAX   = 50;

export const referralDiscount = (count) =>
    count > 0 ? Math.min(REFERRAL_MAX, REFERRAL_FIRST + REFERRAL_EXTRA * (count - 1)) : 0;

// Referidos registrados en un mes calendario: el actual (monthsAgo = 0,
// lo que va ganando) o el anterior (1, lo que se le descuenta ahora).
export const referralsInMonth = (referrals, monthsAgo = 0, today = new Date()) => {
    const ref = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
    return referrals.filter(r => {
        const d = r.date?.seconds ? new Date(r.date.seconds * 1000) : null;
        return d && d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
    });
};

// Código de quien recomendó al alumno, tal como lo escribe al registrarse.
// Devuelve '' si no escribió nada y null si lo escrito no es un código.
export const parseReferralCode = (raw) => {
    const code = (raw || '').trim().toUpperCase();
    if (!code) return '';
    return /^DC-[A-Z0-9]{7}$/.test(code) ? code : null;
};

// Texto corto de los días que faltan o que lleva vencida una cuota.
export const daysLabel = (days) =>
    days === 0 ? 'Vence hoy'
    : days > 0 ? `Vence en ${days} día${days === 1 ? '' : 's'}`
    : `Vencido hace ${-days} día${days === -1 ? '' : 's'}`;
