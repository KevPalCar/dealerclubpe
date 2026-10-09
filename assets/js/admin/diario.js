// ============================================================
// TRABAJO DEL DÍA — lista de asistencia y pendientes en una sola vista
// ============================================================

import { db, dbPath } from '../firebase.js';
import { toYmd, fromYmd, fmtDate, billingSummary } from '../billing.js';
import { collection, doc, onSnapshot, query, where, writeBatch, getCountFromServer } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { esc, showToast, guessClassDays, registerSection, unsubscribeListeners, loadSection, onPendingChange, navCount } from './core.js';
import { attPct, openProgressModal } from './campus.js';
import { S, coursesOf, inStudentTab, statusOf } from './alumnos.js';

// ══════════════════════════════════════════════════════════
// TRABAJO DEL DÍA — lista de asistencia de todos en una vista
// Se marca a cada alumno con un toque, se ajusta su nivel y se
// guarda todo junto. Solo aparecen los matriculados con clase
// ese día (según su curso o sus días personalizados).
// ══════════════════════════════════════════════════════════
const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const LEVELS = ['Rookie', 'Pro Dealer', 'Élite VIP'];
let _dailyDate   = toYmd(new Date());
let _dailyMarks  = {};   // uid → 'present' | 'absent' | '' (cambios sin guardar)
let _dailyLevels = {};   // uid → nivel (cambios sin guardar)
let _toGrade     = 0;    // entregas de tareas por calificar

// Días de clase del alumno; null = sin días fijos (aparece siempre).
const classDaysOf = (s) => {
    if (s.modality === 'personalizado' && (s.customDays || []).length) return s.customDays;
    const course = S.courses.find(c => c.name === coursesOf(s)[0]);
    if (!course) return null;
    const days = course.classDays ?? guessClassDays(course.schedule);
    return days.length ? days : null;
};

// Faltas seguidas hasta la fecha indicada (se corta en la última asistencia).
const absenceStreak = (log, upTo) => {
    let n = 0;
    for (const d of Object.keys(log || {}).filter(d => d <= upTo).sort().reverse()) {
        if (log[d] === 'absent') n++; else break;
    }
    return n;
};

const dailyMarkOf  = (s) => _dailyMarks[s.uid]  ?? s.attendanceLog?.[_dailyDate] ?? '';
const dailyLevelOf = (s) => _dailyLevels[s.uid] ?? s.level ?? 'Rookie';
const dailyDirty   = () => new Set([...Object.keys(_dailyMarks), ...Object.keys(_dailyLevels)]);

const renderDailyAlerts = () => {
    const box     = document.getElementById('daily-alerts');
    const actives = S.students.filter(s => statusOf(s) === 'active');
    const pays    = actives.map(s => billingSummary(s.billing).state);
    const count   = (state) => pays.filter(p => p === state).length;
    const alerts  = [
        [navCount('students', 'nuevos'), 'danger', 'registros nuevos',                       'students'],
        [navCount('requests', 'nuevas'), 'danger', 'solicitudes de cotización sin responder', 'requests'],
        [S.reported.length,   'warn',   'constancias de pago por revisar', 'students'],
        [count('overdue'),   'danger', 'pagos vencidos',                  'students'],
        [count('soon'),      'warn',   'pagos vencen en 7 días o menos',  'students'],
        [actives.filter(s => absenceStreak(s.attendanceLog, toYmd(new Date())) >= 3).length,
                             'danger', 'alumnos con 3 o más faltas seguidas', null],
        [_toGrade,           'warn',   'entregas de tareas por calificar', 'tasks'],
        [S.students.filter(s => inStudentTab(s, 'pending')).length,
                             '',       'inscritos que aún no pagan',       'students']
    ].filter(([n]) => n > 0);

    box.innerHTML = alerts.length ? '' : '<span class="daily-alert ok"><i class="fas fa-check-circle"></i> Sin pendientes por ahora</span>';
    alerts.forEach(([n, cls, text, section]) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `daily-alert ${cls}`;
        chip.innerHTML = `<b>${n}</b> ${text}`;
        if (section) chip.addEventListener('click', () => loadSection(section));
        else chip.style.cursor = 'default';
        box.appendChild(chip);
    });
};

const renderDaily = () => {
    if (document.getElementById('daily-management').style.display === 'none') return;
    renderDailyAlerts();

    const dow     = fromYmd(_dailyDate).getDay();
    const showAll = document.getElementById('daily-show-all').checked;
    document.getElementById('daily-date').value = _dailyDate;
    document.getElementById('daily-weekday').textContent = WEEKDAYS_ES[dow];

    const actives = S.students.filter(s => statusOf(s) === 'active');
    const list = actives.filter(s => {
        if (showAll || s.attendanceLog?.[_dailyDate]) return true;
        const days = classDaysOf(s);
        return !days || days.includes(dow);
    });

    const box = document.getElementById('daily-list');
    box.innerHTML = '';
    if (!list.length) {
        box.innerHTML = `<p class="daily-empty">${actives.length
            ? 'Ningún alumno matriculado tiene clase este día. Marca "Mostrar a todos los matriculados" si hubo una clase fuera de horario.'
            : 'Aún no hay alumnos matriculados. Aparecerán aquí cuando actives al primero desde Alumnos.'}</p>`;
    }

    // Agrupa por curso
    const groups = new Map();
    list.forEach(s => {
        const key = coursesOf(s)[0] || 'Sin curso asignado';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
    });
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([course, students]) => {
        const group = document.createElement('div');
        group.className = 'daily-group';
        group.innerHTML = `<h3>${esc(course)} <span>(${students.length})</span></h3>`;
        students.forEach(s => {
            const mark   = dailyMarkOf(s);
            const streak = absenceStreak({ ...(s.attendanceLog || {}), ...(mark ? { [_dailyDate]: mark } : {}) }, _dailyDate);
            const row    = document.createElement('div');
            row.className = `daily-row ${dailyDirty().has(s.uid) ? 'dirty' : ''}`;
            row.innerHTML = `
                <div class="daily-name">
                    <strong>${esc(s.fullName) || esc(s.email)}</strong>
                    <small>${esc(s.studentCode) || ''}${s.modality === 'personalizado' ? ' · Personalizado' : ''}</small>
                    ${streak >= 2 ? `<span class="daily-warn"><i class="fas fa-exclamation-triangle"></i> ${streak} faltas seguidas</span>` : ''}
                </div>
                <div class="daily-att">
                    <button type="button" class="att-btn present ${mark === 'present' ? 'on' : ''}" data-mark="present"><i class="fas fa-check"></i> Presente</button>
                    <button type="button" class="att-btn absent ${mark === 'absent' ? 'on' : ''}" data-mark="absent"><i class="fas fa-times"></i> Faltó</button>
                </div>
                <select class="daily-level" title="Nivel del alumno">
                    ${LEVELS.map(l => `<option ${dailyLevelOf(s) === l ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
                <button type="button" class="btn btn-secondary btn-sm daily-progress" title="Notas y calendario completo"><i class="fas fa-chart-line"></i></button>`;
            row.querySelectorAll('.att-btn').forEach(b => b.addEventListener('click', () => {
                // Un segundo toque en el mismo botón deja al alumno sin marcar.
                const next = dailyMarkOf(s) === b.dataset.mark ? '' : b.dataset.mark;
                if (next === (s.attendanceLog?.[_dailyDate] ?? '')) delete _dailyMarks[s.uid];
                else _dailyMarks[s.uid] = next;
                renderDaily();
            }));
            row.querySelector('.daily-level').addEventListener('change', (e) => {
                if (e.target.value === (s.level || 'Rookie')) delete _dailyLevels[s.uid];
                else _dailyLevels[s.uid] = e.target.value;
                renderDaily();
            });
            row.querySelector('.daily-progress').addEventListener('click', () => openProgressModal(s));
            group.appendChild(row);
        });
        box.appendChild(group);
    });

    const marked = list.filter(s => dailyMarkOf(s)).length;
    const dirty  = dailyDirty().size;
    document.getElementById('daily-count').textContent  = `${marked} de ${list.length} marcados`;
    document.getElementById('daily-status').textContent = dirty ? `${dirty} cambio${dirty === 1 ? '' : 's'} sin guardar` : '';
    document.getElementById('daily-save').disabled = !dirty;
    document.getElementById('daily-all-present').dataset.uids = list.map(s => s.uid).join(',');
};

const setDailyDate = (ymd) => {
    if (!ymd || ymd === _dailyDate) return;
    if (dailyDirty().size && !confirm('Tienes cambios sin guardar en esta fecha. ¿Descartarlos?')) {
        document.getElementById('daily-date').value = _dailyDate;
        return;
    }
    _dailyDate = ymd;
    _dailyMarks = {};
    _dailyLevels = {};
    renderDaily();
};
const shiftDailyDate = (delta) => {
    const d = fromYmd(_dailyDate);
    d.setDate(d.getDate() + delta);
    setDailyDate(toYmd(d));
};
document.getElementById('daily-date').addEventListener('change', (e) => setDailyDate(e.target.value));
document.getElementById('daily-prev').addEventListener('click', () => shiftDailyDate(-1));
document.getElementById('daily-next').addEventListener('click', () => shiftDailyDate(1));
document.getElementById('daily-show-all').addEventListener('change', renderDaily);

document.getElementById('daily-all-present').addEventListener('click', (e) => {
    // Marca presente solo a quien aún no tiene marca; no pisa una falta ya puesta.
    (e.currentTarget.dataset.uids || '').split(',').filter(Boolean).forEach(uid => {
        const s = S.students.find(x => x.uid === uid);
        if (s && !dailyMarkOf(s)) _dailyMarks[uid] = 'present';
    });
    renderDaily();
});
document.getElementById('daily-new-task').addEventListener('click', () => {
    loadSection('tasks');
    document.getElementById('add-task-btn').click();
});

document.getElementById('daily-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
        const batch = writeBatch(db);
        let present = 0, absent = 0;
        dailyDirty().forEach(uid => {
            const s = S.students.find(x => x.uid === uid);
            if (!s) return;
            const patch = {};
            if (uid in _dailyMarks) {
                const log = { ...(s.attendanceLog || {}) };
                if (_dailyMarks[uid]) log[_dailyDate] = _dailyMarks[uid]; else delete log[_dailyDate];
                patch.attendanceLog = log;
                patch.attendance    = attPct(log);   // derivado (compatibilidad)
            }
            if (uid in _dailyLevels) patch.level = _dailyLevels[uid];
            batch.update(doc(db, dbPath(`user_roles/${uid}`)), patch);
        });
        // Registro de que ese día se pasó lista (lo usará la suspensión automática).
        S.students.forEach(s => {
            const m = dailyMarkOf(s);
            if (m === 'present') present++; else if (m === 'absent') absent++;
        });
        batch.set(doc(db, dbPath(`class_log/${_dailyDate}`)), { date: _dailyDate, present, absent, takenAt: new Date() });
        await batch.commit();
        _dailyMarks = {};
        _dailyLevels = {};
        showToast(`Lista del ${fmtDate(_dailyDate)} guardada: ${present} presentes, ${absent} faltas.`, 'success');
    } catch (err) { showToast(`Error al guardar la lista: ${esc(err.message)}`, 'error'); }
    renderDaily();
});

const loadDaily = () => {
    unsubscribeListeners.dailyStudents = onSnapshot(
        query(collection(db, dbPath('user_roles')), where('role', '==', 'student')),
        (snap) => {
            S.students = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
                .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
            renderDaily();
        }
    );
    unsubscribeListeners.dailyEnrollments = onSnapshot(collection(db, dbPath('course_enrollments')), (snap) => {
        S.enrollments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderDaily();
    });
    unsubscribeListeners.dailyCourses = onSnapshot(collection(db, dbPath('courses')), (snap) => {
        S.courses = snap.docs.map(d => d.data());
        renderDaily();
    });
    getCountFromServer(query(collection(db, dbPath('task_submissions')), where('status', '==', 'submitted')))
        .then(res => { _toGrade = res.data().count; renderDaily(); })
        .catch(() => { /* sin el conteo, el resto de la pantalla funciona igual */ });
};

registerSection('daily', { title: 'Trabajo del día', load: loadDaily });
onPendingChange.push(renderDaily);
