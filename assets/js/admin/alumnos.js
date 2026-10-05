// ============================================================
// ALUMNOS — alta, estados, pagos mensuales y constancias
// Único lugar donde se activa, suspende, reactiva o elimina a un alumno
// y donde se lleva su plan de pagos.
// ============================================================

import { db, dbPath, generateStudentCode } from '../firebase.js';
import { toYmd, fmtDate, nextMonday, billingSchedule, billingSummary, daysLabel } from '../billing.js';
import { collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot, getDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { esc, showToast, pState, renderPaged, openModal, closeModal, showMsg, confirmModal, confirmDelete, viewImage, DAY_LABELS, registerSection, unsubscribeListeners, onVouchersChange } from './core.js';
import { openProgressModal } from './campus.js';

// ── EMAILJS — notificaciones automáticas al aprobar inscripciones ──
// Credenciales del proyecto DealerClub en emailjs.com (cuenta gratuita, 200/mes).
// Si necesitas cambiar la plantilla o el servicio, actualiza solo estas 3 constantes.
import emailjs from 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/+esm';
const EJS_SERVICE  = 'service_w76xi5m';
const EJS_TEMPLATE = 'template_n6t2bx8';
emailjs.init('_S-T8AGnU-LZveZ7y');

// ══════════════════════════════════════════════════════════
// ALTA DE ALUMNOS — helpers de código y activación
// (la aprobación vive en la sección Alumnos, más abajo)
// ══════════════════════════════════════════════════════════
// Cuentas (user_roles) de un alumno, buscadas por correo y/o código.
const findStudentAccounts = async ({ code, email }) => {
    const col     = collection(db, dbPath('user_roles'));
    const emails  = [...new Set([email, (email || '').trim().toLowerCase()].filter(Boolean))];
    const lookups = emails.map(em => getDocs(query(col, where('email', '==', em))));
    if (code) lookups.push(getDocs(query(col, where('studentCode', '==', code))));

    const accounts = new Map();
    (await Promise.all(lookups)).forEach(snap => snap.forEach(d => accounts.set(d.id, d.data())));
    return accounts;
};

// Código del alumno al aprobar: el que ya tenga (en la inscripción o en
// su cuenta, p. ej. por un curso anterior) o uno nuevo que no se repita.
const resolveStudentCode = async ({ existingCode, email }) => {
    if (existingCode) return existingCode;
    for (const data of (await findStudentAccounts({ email })).values()) {
        if (data.studentCode) return data.studentCode;
    }
    for (let i = 0; i < 5; i++) {
        const code  = generateStudentCode();
        const clash = await getDocs(query(
            collection(db, dbPath('user_roles')), where('studentCode', '==', code)));
        if (clash.empty) return code;
    }
    throw new Error('No se pudo generar un código único. Inténtalo de nuevo.');
};

// Activa en user_roles la cuenta del alumno de una inscripción aprobada.
// Busca por código y por correo (las cuentas antiguas no tenían código).
// No toca a los suspendidos: esos solo se reactivan a mano.
const activateStudent = async ({ code, email }) => {
    const accounts = await findStudentAccounts({ code, email });

    let activated = 0;
    for (const [uid, data] of accounts) {
        if (data.role !== 'student' || ['active', 'suspended'].includes(data.status)) continue;
        const patch = { status: 'active' };
        if (!data.studentCode && code) patch.studentCode = code;
        await updateDoc(doc(db, dbPath(`user_roles/${uid}`)), patch);
        activated++;
    }
    return { found: accounts.size, activated };
};

// Repara a los alumnos con inscripción aprobada cuya cuenta quedó sin
// activar (antes el campus se abría solo con la inscripción; ahora las
// reglas exigen status 'active'). Corre una vez al entrar al admin.
const reconcileApprovedStudents = async () => {
    try {
        const snap = await getDocs(query(
            collection(db, dbPath('course_enrollments')), where('status', '==', 'Aprobado')));
        let activated = 0;
        for (const d of snap.docs) {
            const e = d.data();
            activated += (await activateStudent({ code: e.referralCode || e.studentCode, email: e.email })).activated;
        }
        if (activated) showToast(`${activated} alumno(s) aprobados quedaron con el campus activado.`, 'info');
    } catch (err) { console.warn('No se pudo sincronizar alumnos aprobados:', err); }
};


// ══════════════════════════════════════════════════════════
// CAMPUS VIRTUAL — ALUMNOS
// Estados: pending → active → suspended. Suspender nunca borra
// el progreso; eliminar es definitivo y solo para no activos.
// ══════════════════════════════════════════════════════════
// Datos de alumnos en memoria. Los comparten Alumnos y Trabajo del día.
const S = {
    courses:     [],   // cursos (precio y duración sugieren el plan de pagos)
    students:    [],   // user_roles con role 'student'
    enrollments: [],   // course_enrollments (para curso y aprobación)
    reported:    []    // constancias de pago por revisar
};

const STUDENT_STATUS = {
    pending:   { label: 'Inscrito',    badge: 'badge-warning' },
    active:    { label: 'Matriculado', badge: 'badge-success' },
    suspended: { label: 'Suspendido', badge: 'badge-danger'  }
};
const statusOf = (s) => (STUDENT_STATUS[s.status] ? s.status : 'pending');
const lower    = (v) => (v || '').trim().toLowerCase();


const enrollmentsOf = (s) => S.enrollments.filter(e => lower(e.email) === lower(s.email));
const coursesOf = (s) => [...new Set(enrollmentsOf(s)
    .filter(e => e.type !== 'Lista de Espera')
    .map(e => e.courseName).filter(Boolean))];
// Solo espera cupo: tiene inscripciones y todas son de lista de espera.
const isWaitlisted = (s) => {
    const list = enrollmentsOf(s);
    return list.length > 0 && list.every(e => e.type === 'Lista de Espera');
};

const sendApprovalEmail = async ({ name, email, course, code }) => {
    if (!email) return;
    try {
        await emailjs.send(EJS_SERVICE, EJS_TEMPLATE, {
            to_name: name, to_email: email, course_name: course, student_code: code
        });
        showToast(`Email de confirmación enviado a ${esc(email)}`, 'info');
    } catch {
        showToast('Alumno aprobado, pero el email no se pudo enviar. Revisa EmailJS.', 'warning');
    }
};

// Plan sugerido según el curso del alumno: mensualidad y número de cuotas.
const courseDefaults = (s) => {
    const name   = coursesOf(s)[0] || enrollmentsOf(s)[0]?.courseName;
    const course = S.courses.find(c => c.name === name) || {};
    const months = /(\d+)\s*mes/i.exec(course.duration || '');
    return {
        amount:       parseFloat(String(course.price || '').replace(/[^\d.]/g, '')) || '',
        installments: months ? +months[1] : 1
    };
};

// Registra una cuota pagada: deja la constancia en payments (confirmando
// la que subió el alumno o creando una del admin) y devuelve el plan
// actualizado, listo para guardarse en user_roles.
const recordInstallment = async (s, billing, { n, amount, paidAt, voucher }) => {
    const data = { type: 'mensualidad', installment: n, amount, paidAt, status: 'confirmed', reviewedAt: new Date() };
    let paymentId;
    if (voucher) {
        await updateDoc(doc(db, dbPath(`payments/${voucher.id}`)), data);
        paymentId = voucher.id;
    } else {
        const ref = await addDoc(collection(db, dbPath('payments')), {
            uid: s.uid, email: s.email || '', studentName: s.fullName || '',
            note: 'Registrado por el admin', createdAt: new Date(), ...data
        });
        paymentId = ref.id;
    }
    const paid = [...(billing.paid || []).filter(p => p.n !== n), { n, amount, paidAt, paymentId }]
        .sort((a, b) => a.n - b.n);
    return { ...billing, paid };
};

// Aprobar a un alumno abre el modal de activación: ahí se confirma su
// primer pago y se define su plan (inicio de clases, mensualidad, cuotas).
let activateCtx = null;
const approveStudent = async (s, payment = null) => {
    let code;
    try { code = await resolveStudentCode({ existingCode: s.studentCode, email: s.email }); }
    catch (err) { showToast(`Error al aprobar: ${esc(err.message)}`, 'error'); return; }

    const fromWaitlist = isWaitlisted(s);
    activateCtx = { s, payment, code, fromWaitlist };

    const defaults = courseDefaults(s);
    document.getElementById('activateSummary').textContent =
        `${s.fullName || s.email || 'El alumno'} se activará con el código ${code}.`;
    const warnings = [];
    if (!payment)     warnings.push('No hay constancia de pago subida: activa solo si verificaste el pago por otro medio.');
    if (fromWaitlist) warnings.push('Está en lista de espera: al activarlo pasa a matriculado.');
    const warnEl = document.getElementById('activateWarning');
    warnEl.textContent   = warnings.join(' ');
    warnEl.style.display = warnings.length ? 'block' : 'none';
    document.getElementById('activateStart').value        = nextMonday();
    document.getElementById('activateAmount').value       = defaults.amount;
    document.getElementById('activateInstallments').value = defaults.installments;
    showMsg(document.getElementById('activateFormMessage'), '', '');
    openModal(document.getElementById('activateModal'));
};

document.getElementById('activateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activateCtx) return;
    const { s, payment, code, fromWaitlist } = activateCtx;
    const msg          = document.getElementById('activateFormMessage');
    const name         = s.fullName || s.email || 'Alumno';
    const startDate    = document.getElementById('activateStart').value;
    const amount       = parseFloat(document.getElementById('activateAmount').value);
    const installments = parseInt(document.getElementById('activateInstallments').value);
    if (!startDate || !(amount >= 0) || !(installments >= 1)) {
        showMsg(msg, 'Completa el inicio de clases, la mensualidad y las cuotas.', 'error');
        return;
    }

    showMsg(msg, 'Activando…', 'loading');
    try {
        const pendings = enrollmentsOf(s).filter(en =>
            en.status !== 'Aprobado' && (fromWaitlist || en.type !== 'Lista de Espera'));
        for (const en of pendings) {
            await updateDoc(doc(db, dbPath(`course_enrollments/${en.id}`)), {
                status: 'Aprobado', type: 'Matrícula', studentCode: code, referralCode: code, approvedAt: new Date()
            });
        }
        const billing = await recordInstallment(s, { startDate, amount, installments, paid: [] },
            { n: 1, amount, paidAt: toYmd(new Date()), voucher: payment });
        await updateDoc(doc(db, dbPath(`user_roles/${s.uid}`)), {
            status: 'active', studentCode: code, statusReason: '', statusChangedAt: new Date(),
            billing, courseStartDate: startDate
        });
        activateCtx = null;
        closeModal(document.getElementById('activateModal'));
        showToast(`${esc(name)} quedó activo. Código: ${code}`, 'success');
        sendApprovalEmail({ name, email: s.email, course: coursesOf(s).join(', ') || 'Curso DealerClub', code });
    } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
});
document.getElementById('closeActivateModalBtn').addEventListener('click', () =>
    closeModal(document.getElementById('activateModal'))
);

// ── Pagos del alumno: plan, cuotas, registrar y anular ────
let payCtx = null;   // { uid, voucher } mientras el modal está abierto

const paymentsStudent = () => payCtx && S.students.find(x => x.uid === payCtx.uid);

const renderPaymentsModal = () => {
    const s = paymentsStudent();
    if (!s) return;
    const b        = s.billing || {};
    const defaults = courseDefaults(s);
    document.getElementById('paymentsStudentName').textContent = s.fullName || s.email || 'Alumno';

    const note = document.getElementById('paymentsVoucherNote');
    note.textContent   = payCtx.voucher ? 'Estás confirmando la constancia que subió el alumno: al registrar el pago quedará vinculada a la cuota.' : '';
    note.style.display = payCtx.voucher ? 'block' : 'none';

    document.getElementById('billingStart').value        = b.startDate || s.courseStartDate || nextMonday();
    document.getElementById('billingAmount').value       = b.amount ?? defaults.amount;
    document.getElementById('billingInstallments').value = b.installments ?? defaults.installments;

    const schedule = billingSchedule(b);
    const lastPaid = Math.max(0, ...(b.paid || []).map(p => p.n));
    const box      = document.getElementById('paymentsSchedule');
    box.innerHTML  = schedule.length ? '' : '<p style="color:#888;">Guarda el plan para ver las cuotas.</p>';

    schedule.forEach(c => {
        const row = document.createElement('div');
        row.className = `pay-row ${c.state}`;
        const detail = c.state === 'paid'
            ? `Pagado el ${fmtDate(c.payment.paidAt)} · S/ ${c.payment.amount}`
            : c.days != null ? daysLabel(c.days) : 'Pendiente';
        row.innerHTML = `
            <b>Cuota ${c.n}</b>
            <div>Vence el ${fmtDate(c.due)}<small>${detail}</small></div>
            <div class="pay-row-actions">
                ${c.state === 'paid' && c.payment.paymentId ? '<a href="#" class="pay-view">Ver constancia</a>' : ''}
                ${c.state === 'paid' && c.n === lastPaid ? '<button type="button" class="btn btn-danger btn-sm pay-void">Anular</button>' : ''}
            </div>`;
        row.querySelector('.pay-view')?.addEventListener('click', async (evt) => {
            evt.preventDefault();
            try {
                const snap = await getDoc(doc(db, dbPath(`payments/${c.payment.paymentId}`)));
                if (snap.exists() && snap.data().imageUrl) viewImage(snap.data().imageUrl);
                else showToast('Este pago se registró sin constancia.', 'info');
            } catch (err) { showToast(`Error: ${esc(err.message)}`, 'error'); }
        });
        row.querySelector('.pay-void')?.addEventListener('click', async () => {
            if (!confirm(`¿Anular el pago de la cuota ${c.n}? Volverá a figurar como pendiente.`)) return;
            try {
                await updateDoc(doc(db, dbPath(`user_roles/${s.uid}`)), {
                    billing: { ...b, paid: (b.paid || []).filter(p => p.n !== c.n) }
                });
                if (c.payment.paymentId) {
                    await updateDoc(doc(db, dbPath(`payments/${c.payment.paymentId}`)), { status: 'voided', reviewedAt: new Date() });
                }
                showToast(`Pago de la cuota ${c.n} anulado.`, 'info');
            } catch (err) { showToast(`Error: ${esc(err.message)}`, 'error'); }
        });
        box.appendChild(row);
    });

    // Formulario para registrar la primera cuota sin pagar
    const current = schedule.find(c => c.state !== 'paid');
    const form    = document.getElementById('registerPaymentForm');
    form.style.display = current ? 'flex' : 'none';
    if (current) {
        form.dataset.n = current.n;
        document.getElementById('registerPaymentLabel').textContent = `Registrar pago de la cuota ${current.n} (vence el ${fmtDate(current.due)})`;
        document.getElementById('registerPaymentDate').value   = toYmd(new Date());
        document.getElementById('registerPaymentAmount').value = b.amount ?? '';
    }
};

const openPaymentsModal = (s, voucher = null) => {
    payCtx = { uid: s.uid, voucher };
    showMsg(document.getElementById('paymentsFormMessage'), '', '');
    renderPaymentsModal();
    openModal(document.getElementById('paymentsModal'));
};
document.getElementById('closePaymentsModalBtn').addEventListener('click', () => {
    payCtx = null;
    closeModal(document.getElementById('paymentsModal'));
});

document.getElementById('billingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s   = paymentsStudent();
    const msg = document.getElementById('paymentsFormMessage');
    if (!s) return;
    const startDate    = document.getElementById('billingStart').value;
    const amount       = parseFloat(document.getElementById('billingAmount').value);
    const installments = parseInt(document.getElementById('billingInstallments').value);
    if (!startDate || !(amount >= 0) || !(installments >= 1)) {
        showMsg(msg, 'Completa el inicio de clases, la mensualidad y las cuotas.', 'error');
        return;
    }
    try {
        await updateDoc(doc(db, dbPath(`user_roles/${s.uid}`)), {
            billing: {
                startDate, amount, installments,
                paid: (s.billing?.paid || []).filter(p => p.n <= installments)
            },
            courseStartDate: startDate
        });
        showMsg(msg, 'Plan guardado.', 'success');
    } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
});

document.getElementById('registerPaymentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s   = paymentsStudent();
    const msg = document.getElementById('paymentsFormMessage');
    if (!s) return;
    if (!s.billing?.startDate) { showMsg(msg, 'Primero guarda el plan de pagos.', 'error'); return; }
    const n      = parseInt(e.currentTarget.dataset.n);
    const amount = parseFloat(document.getElementById('registerPaymentAmount').value);
    const paidAt = document.getElementById('registerPaymentDate').value;
    if (!paidAt || !(amount >= 0)) { showMsg(msg, 'Completa la fecha y el monto.', 'error'); return; }
    try {
        const billing = await recordInstallment(s, s.billing, { n, amount, paidAt, voucher: payCtx.voucher });
        payCtx.voucher = null;
        await updateDoc(doc(db, dbPath(`user_roles/${s.uid}`)), { billing });
        showMsg(msg, `Cuota ${n} registrada.`, 'success');
    } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
});

const setStudentStatus = async (s, status, reason = '') => {
    try {
        await updateDoc(doc(db, dbPath(`user_roles/${s.uid}`)), {
            status, statusReason: reason, statusChangedAt: new Date()
        });
        showToast(status === 'suspended'
            ? `${esc(s.fullName || 'Alumno')} quedó suspendido. Su progreso se conserva.`
            : `${esc(s.fullName || 'Alumno')} fue reactivado.`, 'success');
    } catch (err) { showToast(`Error: ${esc(err.message)}`, 'error'); }
};

// Eliminación definitiva: ficha, progreso, inscripciones, entregas y constancias.
const deleteStudent = (s) => {
    const name = s.fullName || s.email || 'este alumno';
    confirmDelete(
        `¿Eliminar DEFINITIVAMENTE a "${name}"? Se borrarán su ficha, progreso, inscripciones, entregas y constancias. No se puede deshacer.`,
        async () => {
            const msg = document.getElementById('deleteFormMessage');
            if (prompt('Para confirmar, escribe ELIMINAR') !== 'ELIMINAR') {
                showMsg(msg, 'Eliminación cancelada.', 'error');
                return;
            }
            showMsg(msg, 'Eliminando...', 'loading');
            try {
                const refs = S.enrollments
                    .filter(e => lower(e.email) === lower(s.email))
                    .map(e => doc(db, dbPath(`course_enrollments/${e.id}`)));
                const pays = await getDocs(query(collection(db, dbPath('payments')), where('uid', '==', s.uid)));
                pays.forEach(d => refs.push(d.ref));
                if (s.studentCode) {
                    const subs = await getDocs(query(
                        collection(db, dbPath('task_submissions')), where('studentCode', '==', s.studentCode)));
                    subs.forEach(d => refs.push(d.ref));
                }
                for (const ref of refs) await deleteDoc(ref);
                await deleteDoc(doc(db, dbPath(`user_roles/${s.uid}`)));
                showMsg(msg, 'Eliminado.', 'success');
                setTimeout(() => closeModal(confirmModal), 900);
            } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
        }
    );
};

// ── Ficha del alumno (datos, modalidad y días propios) ────
let _studentDays = new Set();
const renderStudentDays = () => {
    const box = document.getElementById('studentDays');
    box.innerHTML = DAY_LABELS.map(([v, l]) =>
        `<button type="button" class="day-pick ${_studentDays.has(v) ? 'on' : ''}" data-day="${v}">${l}</button>`).join('');
    box.querySelectorAll('.day-pick').forEach(b => b.addEventListener('click', () => {
        const v = +b.dataset.day;
        if (_studentDays.has(v)) _studentDays.delete(v); else _studentDays.add(v);
        renderStudentDays();
    }));
};
const toggleStudentDays = () => {
    document.getElementById('studentDaysGroup').style.display =
        document.getElementById('studentModality').value === 'personalizado' ? 'block' : 'none';
};
document.getElementById('studentModality').addEventListener('change', toggleStudentDays);

const openStudentModal = (s) => {
    document.getElementById('studentUid').value      = s.uid;
    document.getElementById('studentFullName').value = s.fullName || '';
    document.getElementById('studentDni').value      = s.dni || '';
    document.getElementById('studentPhone').value    = s.phone || '';
    document.getElementById('studentModality').value = s.modality === 'personalizado' ? 'personalizado' : 'regular';
    const comments = enrollmentsOf(s).map(e => (e.comments || '').trim()).filter(Boolean);
    document.getElementById('studentComments').textContent = comments.join(' · ');
    document.getElementById('studentCommentsGroup').style.display = comments.length ? 'block' : 'none';
    _studentDays = new Set(s.customDays || []);
    renderStudentDays();
    toggleStudentDays();
    showMsg(document.getElementById('studentFormMessage'), '', '');
    openModal(document.getElementById('studentModal'));
};

document.getElementById('studentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg      = document.getElementById('studentFormMessage');
    const modality = document.getElementById('studentModality').value;
    if (modality === 'personalizado' && !_studentDays.size) {
        showMsg(msg, 'Marca al menos un día de clase para el horario personalizado.', 'error');
        return;
    }
    showMsg(msg, 'Guardando…', 'loading');
    try {
        await updateDoc(doc(db, dbPath(`user_roles/${document.getElementById('studentUid').value}`)), {
            fullName:   document.getElementById('studentFullName').value.trim(),
            dni:        document.getElementById('studentDni').value.trim(),
            phone:      document.getElementById('studentPhone').value.trim(),
            modality,
            customDays: modality === 'personalizado' ? [..._studentDays].sort() : []
        });
        closeModal(document.getElementById('studentModal'));
        showToast('Ficha del alumno actualizada.', 'success');
    } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
});
document.getElementById('closeStudentModalBtn').addEventListener('click', () =>
    closeModal(document.getElementById('studentModal'))
);

// ── Tabla ─────────────────────────────────────────────────
const renderStudentRow = (s) => {
    const tr     = document.getElementById('students-table-body').insertRow();
    const st     = statusOf(s);
    const info   = STUDENT_STATUS[st];
    const custom = s.modality === 'personalizado';
    const days   = custom && (s.customDays || []).length
        ? DAY_LABELS.filter(([v]) => s.customDays.includes(v)).map(([, l]) => l).join(' ')
        : '';
    const hasVoucher = S.reported.some(p => p.uid === s.uid);

    // Pago: estado de la cuota vigente (solo alumnos ya activados)
    const pay = s.pay;
    const payCell = st === 'pending'        ? '<span style="color:#666;">—</span>'
        : pay.state === 'unset'             ? '<span style="color:#888;">Sin configurar</span>'
        : pay.state === 'complete'          ? '<span class="badge badge-success">Completo</span>'
        : `<span class="badge ${pay.state === 'overdue' ? 'badge-danger' : pay.state === 'soon' ? 'badge-warning' : 'badge-success'}">${
                pay.state === 'next' ? 'Al día' : daysLabel(pay.days)}</span>
           <span class="student-sub">Cuota ${pay.n} de ${pay.total} · ${fmtDate(pay.due)}</span>`;

    const btns = [];
    if (st === 'pending')   btns.push(`<button class="btn btn-sm btn-approve btn-stu-approve"><i class="fas fa-check"></i> Activar</button>`);
    if (st === 'suspended') btns.push(`<button class="btn btn-sm btn-approve btn-stu-reactivate"><i class="fas fa-undo"></i> Reactivar</button>`);
    if (st === 'active')    btns.push(`<button class="btn btn-secondary btn-sm btn-stu-progress" title="Asistencia, nivel y notas"><i class="fas fa-chart-line"></i> Progreso</button>`);
    if (st !== 'pending')   btns.push(`<button class="btn btn-secondary btn-sm btn-stu-pay" title="Pagos"><i class="fas fa-coins"></i> Pagos</button>`);
    btns.push(`<button class="btn btn-secondary btn-sm btn-stu-edit" title="Ficha"><i class="fas fa-id-card"></i></button>`);
    if (st === 'active')    btns.push(`<button class="btn btn-secondary btn-sm btn-stu-suspend" title="Suspender"><i class="fas fa-pause"></i> Suspender</button>`);
    if (st !== 'active')    btns.push(`<button class="btn btn-danger btn-sm btn-stu-delete" title="Eliminar definitivamente"><i class="fas fa-trash"></i></button>`);

    tr.innerHTML = `
        <td><code style="color:#ffc107;">${esc(s.studentCode) || '—'}</code></td>
        <td>${esc(s.fullName) || '-'}
            <span class="student-sub">${esc(s.email) || ''}${s.dni ? ` · DNI ${esc(s.dni)}` : ''}</span>
            ${s.phone ? `<span class="student-sub"><i class="fab fa-whatsapp"></i> ${esc(s.phone)}</span>` : ''}</td>
        <td>${s.courses.length ? s.courses.map(esc).join('<br>')
            : s.waitlist.length ? `${s.waitlist.map(esc).join('<br>')}<span class="student-sub" style="color:#17a2b8;">Lista de espera</span>`
            : '<span style="color:#888;">Sin inscripción</span>'}
            ${s.enrolledAt ? `<span class="student-sub">Inscrito el ${s.enrolledAt}</span>` : ''}</td>
        <td>${custom
            ? `<span class="badge badge-info">Personalizado</span>${days ? `<span class="student-sub">${days}</span>` : ''}`
            : 'Regular'}</td>
        <td><span class="badge ${info.badge}">${info.label}</span>
            ${hasVoucher ? '<span class="student-sub" style="color:#ffc107;">Constancia por revisar</span>' : ''}
            ${st === 'suspended' && s.statusReason ? `<span class="student-reason">${esc(s.statusReason)}</span>` : ''}</td>
        <td>${payCell}</td>
        <td class="action-buttons">${btns.join('')}</td>
    `;

    tr.querySelector('.btn-stu-progress')?.addEventListener('click', () => openProgressModal(s));
    tr.querySelector('.btn-stu-pay')?.addEventListener('click', () => openPaymentsModal(s));
    tr.querySelector('.btn-stu-approve')?.addEventListener('click', () =>
        approveStudent(s, S.reported.find(p => p.uid === s.uid) || null));
    tr.querySelector('.btn-stu-reactivate')?.addEventListener('click', () => {
        if (confirm(`¿Reactivar el campus de ${s.fullName || 'este alumno'}? Conserva todo su progreso.`)) setStudentStatus(s, 'active');
    });
    tr.querySelector('.btn-stu-edit').addEventListener('click', () => openStudentModal(s));
    tr.querySelector('.btn-stu-suspend')?.addEventListener('click', () => {
        const reason = prompt(`Motivo de la suspensión de ${s.fullName || 'este alumno'} (el alumno lo verá):`, 'Inasistencia');
        if (reason !== null) setStudentStatus(s, 'suspended', reason.trim());
    });
    tr.querySelector('.btn-stu-delete')?.addEventListener('click', () => deleteStudent(s));
};

// Grupo visible: por defecto los matriculados, que es con quienes se
// trabaja a diario. Un inscrito aún no pagó; la lista de espera va aparte.
let _studentTab = 'active';
const inStudentTab = (s, tab) =>
    !tab                 ? true
    : tab === 'waitlist' ? isWaitlisted(s)
    : tab === 'pending'  ? statusOf(s) === 'pending' && !isWaitlisted(s)
    : statusOf(s) === tab;

document.querySelectorAll('#student-tabs .student-tab').forEach(btn =>
    btn.addEventListener('click', () => {
        _studentTab = btn.dataset.status;
        document.querySelectorAll('#student-tabs .student-tab').forEach(b => b.classList.toggle('active', b === btn));
        pState.students.page = 1;
        applyStudentFilters();
    }));

const applyStudentFilters = () => {
    if (!pState.students) return;
    const st  = _studentTab;
    document.querySelectorAll('#student-tabs .student-tab').forEach(b => {
        b.querySelector('span').textContent = `(${S.students.filter(x => inStudentTab(x, b.dataset.status)).length})`;
    });
    const mod = document.getElementById('filter-student-modality').value;
    const pay = document.getElementById('filter-student-pay').value;
    const payMatches = (s) => {
        if (!pay) return true;
        if (statusOf(s) === 'pending') return false;
        const state = billingSummary(s.billing).state;
        return pay === 'ok' ? ['next', 'complete'].includes(state) : state === pay;
    };
    pState.students.data = S.students
        .filter(payMatches)
        .filter(s => inStudentTab(s, st))
        .filter(s => !mod || (s.modality === 'personalizado' ? 'personalizado' : 'regular') === mod)
        .map(s => {
            const list  = enrollmentsOf(s);
            const first = list.map(e => e.timestamp?.seconds ?? 0).filter(Boolean).sort()[0];
            return {
                ...s,
                pay:        billingSummary(s.billing),
                courses:    coursesOf(s),
                waitlist:   [...new Set(list.filter(e => e.type === 'Lista de Espera').map(e => e.courseName).filter(Boolean))],
                phone:      s.phone || list.find(e => e.phone)?.phone || '',
                enrolledAt: first ? new Date(first * 1000).toLocaleDateString('es-PE') : ''
            };
        });
    renderPaged('students', renderStudentRow, 'No hay alumnos en este grupo.');
};
['filter-student-modality', 'filter-student-pay'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => {
        pState.students.page = 1;
        applyStudentFilters();
    }));

// ── Constancias por revisar ───────────────────────────────
const renderVoucherQueue = () => {
    const box = document.getElementById('voucher-queue');
    if (!S.reported.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'block';
    box.innerHTML = `<h3><i class="fas fa-file-invoice-dollar"></i> Constancias de pago por revisar (${S.reported.length})</h3>
                     <div class="voucher-cards"></div>`;
    const cards = box.querySelector('.voucher-cards');

    S.reported.forEach(p => {
        const student = S.students.find(s => s.uid === p.uid);
        const date    = p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('es-PE') : '';
        const card    = document.createElement('div');
        card.className = 'voucher-card';
        card.innerHTML = `
            <img class="voucher-thumb" alt="Constancia" title="Ver en grande">
            <div class="voucher-info">
                <strong>${esc(student?.fullName || p.studentName || p.email)}</strong>
                <small>${date}${p.courseName ? ` · ${esc(p.courseName)}` : ''}</small>
                <div class="voucher-actions">
                    <button class="btn btn-sm btn-approve btn-v-ok"><i class="fas fa-check"></i> Aprobar</button>
                    <button class="btn btn-danger btn-sm btn-v-no"><i class="fas fa-times"></i> Rechazar</button>
                </div>
            </div>`;
        const img = card.querySelector('.voucher-thumb');
        img.src = p.imageUrl;
        img.addEventListener('click', () => viewImage(p.imageUrl));

        card.querySelector('.btn-v-ok').addEventListener('click', async () => {
            if (!student) { showToast('Esa cuenta ya no existe. Rechaza la constancia para quitarla de la lista.', 'warning'); return; }
            if (statusOf(student) === 'pending') { approveStudent(student, p); return; }
            // Alumno ya activado: la constancia se asigna a su cuota vigente.
            openPaymentsModal(student, p);
        });
        card.querySelector('.btn-v-no').addEventListener('click', async () => {
            const reason = prompt('Motivo del rechazo (el alumno lo verá):', 'La imagen no se lee bien');
            if (reason === null) return;
            try {
                await updateDoc(doc(db, dbPath(`payments/${p.id}`)), {
                    status: 'rejected', rejectReason: reason.trim(), reviewedAt: new Date()
                });
                showToast('Constancia rechazada. El alumno podrá subir otra.', 'info');
            } catch (err) { showToast(`Error: ${esc(err.message)}`, 'error'); }
        });
        cards.appendChild(card);
    });
};

// Vigila las constancias por revisar desde cualquier sección (contador
// en el menú). Arranca una vez al entrar al admin y no se detiene.
const watchVoucherQueue = () => {
    onSnapshot(
        query(collection(db, dbPath('payments')), where('status', '==', 'reported')),
        (snap) => {
            S.reported = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
            const badge = document.getElementById('nav-students-badge');
            badge.textContent   = S.reported.length;
            badge.style.display = S.reported.length ? 'inline-flex' : 'none';
            if (document.getElementById('students-management').style.display === 'block') {
                renderVoucherQueue();
                applyStudentFilters();
            }
            onVouchersChange.forEach(fn => fn());
        }
    );
};

const loadStudents = () => {
    document.getElementById('students-table-body').innerHTML =
        `<tr><td colspan="7" class="spinner-cell"><div class="spinner"></div></td></tr>`;
    getDocs(collection(db, dbPath('courses')))
        .then(snap => { S.courses = snap.docs.map(d => d.data()); })
        .catch(() => { /* sin cursos no hay plan sugerido; se escribe a mano */ });
    unsubscribeListeners.students = onSnapshot(
        query(collection(db, dbPath('user_roles')), where('role', '==', 'student')),
        (snap) => {
            S.students = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
                .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
            renderVoucherQueue();
            applyStudentFilters();
            if (payCtx) renderPaymentsModal();
        }
    );
    unsubscribeListeners.studentEnrollments = onSnapshot(collection(db, dbPath('course_enrollments')), (snap) => {
        S.enrollments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        applyStudentFilters();
    });
};

registerSection('students', { title: 'Alumnos', load: loadStudents, row: renderStudentRow, empty: 'No hay alumnos registrados.' });

export { S, coursesOf, inStudentTab, reconcileApprovedStudents, statusOf, watchVoucherQueue };
