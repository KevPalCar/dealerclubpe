// ============================================================
// CAMPUS — material didáctico, tareas y progreso de cada alumno
// El progreso (nivel, calendario de asistencia y notas) se abre también
// desde Alumnos y desde Trabajo del día.
// ============================================================

import { db, dbPath } from '../firebase.js';
import { collection, addDoc, doc, updateDoc, onSnapshot, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { esc, showToast, pState, renderPaged, openModal, closeModal, showMsg, confirmDelete, deleteItem, viewImage, registerSection, unsubscribeListeners } from './core.js';

// ══════════════════════════════════════════════════════════
// CAMPUS VIRTUAL — MATERIAL DIDÁCTICO
// ══════════════════════════════════════════════════════════
const renderMaterialRow = (m) => {
    const tbody = document.getElementById('materials-table-body');
    const tr = tbody.insertRow();
    const typeIcons = { Video: 'fa-play-circle', Documento: 'fa-file-alt', Enlace: 'fa-link' };
    tr.innerHTML = `
        <td><strong>${m.title}</strong></td>
        <td>${m.category || '-'}</td>
        <td><i class="fas ${typeIcons[m.type] || 'fa-file'}" style="margin-right:5px;"></i>${m.type || '-'}</td>
        <td>${m.courseName || 'Todos'}</td>
        <td><a href="${m.url}" target="_blank" style="color:#ffc107; text-decoration:underline;">Abrir enlace</a></td>
        <td class="action-buttons">
            <button class="btn btn-secondary btn-sm btn-edit" data-id="${m.id}"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm btn-delete" data-id="${m.id}"><i class="fas fa-trash"></i></button>
        </td>
    `;
    tr.querySelector('.btn-edit').addEventListener('click', () => {
        document.getElementById('materialId').value       = m.id;
        document.getElementById('materialTitle').value    = m.title || '';
        document.getElementById('materialCategory').value = m.category || '';
        document.getElementById('materialType').value     = m.type || 'Video';
        document.getElementById('materialUrl').value      = m.url || '';
        populateMaterialCourseSelect(m.courseId || 'all');
        document.getElementById('material-modal-action').textContent = 'Editar';
        openModal(document.getElementById('materialModal'));
    });
    tr.querySelector('.btn-delete').addEventListener('click', () =>
        confirmDelete(`¿Eliminar el material "${m.title}"?`, () => deleteItem('materials', m.id))
    );
};

const loadMaterials = () => {
    document.getElementById('materials-table-body').innerHTML =
        `<tr><td colspan="6" class="spinner-cell"><div class="spinner"></div></td></tr>`;
    unsubscribeListeners.materials = onSnapshot(collection(db, dbPath('materials')), (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        pState.materials.data = data;
        renderPaged('materials', renderMaterialRow, 'No hay materiales subidos aún.');
    });
};

// Rellena el selector de cursos en el modal de material
const populateMaterialCourseSelect = async (selectedCourseId = 'all') => {
    const select = document.getElementById('materialCourse');
    select.innerHTML = '<option value="all">Todos los cursos</option>';
    try {
        const snap = await getDocs(collection(db, dbPath('courses')));
        snap.docs.forEach(d => {
            const c    = d.data();
            const opt  = document.createElement('option');
            opt.value  = d.id;
            opt.text   = c.name;
            if (d.id === selectedCourseId) opt.selected = true;
            select.appendChild(opt);
        });
    } catch { /* sin internet: queda solo "Todos" */ }
};

document.getElementById('add-material-btn').addEventListener('click', async () => {
    document.getElementById('materialForm').reset();
    document.getElementById('materialId').value = '';
    document.getElementById('material-modal-action').textContent = 'Añadir';
    await populateMaterialCourseSelect('all');
    openModal(document.getElementById('materialModal'));
});

document.getElementById('materialForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg    = document.getElementById('materialFormMessage');
    const id     = document.getElementById('materialId').value;
    const select = document.getElementById('materialCourse');
    const courseId  = select.value;
    const courseName= select.options[select.selectedIndex].text;

    const data = {
        title:       document.getElementById('materialTitle').value,
        category:    document.getElementById('materialCategory').value,
        type:        document.getElementById('materialType').value,
        courseId,
        courseName:  courseId === 'all' ? 'Todos' : courseName,
        url:         document.getElementById('materialUrl').value,
        createdAt:   new Date()
    };

    showMsg(msg, 'Guardando…', 'loading');
    try {
        if (id) await updateDoc(doc(db, dbPath(`materials/${id}`)), data);
        else     await addDoc(collection(db, dbPath('materials')), data);
        closeModal(document.getElementById('materialModal'));
        showMsg(msg, '', '');
        showToast(id ? 'Material actualizado.' : 'Material añadido al campus.', 'success');
    } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
});
document.getElementById('closeMaterialModalBtn').addEventListener('click', () =>
    closeModal(document.getElementById('materialModal'))
);


// ══════════════════════════════════════════════════════════
// CAMPUS VIRTUAL — TAREAS
// ══════════════════════════════════════════════════════════
const renderTaskRow = (t) => {
    const tbody = document.getElementById('tasks-table-body');
    const tr = tbody.insertRow();
    const dateStr = t.createdAt ? new Date(t.createdAt.seconds * 1000).toLocaleDateString('es-PE') : '-';
    const assignedLabel = t.assignedTo === 'all'
        ? '<span style="color:#ffc107;">Todos los alumnos</span>'
        : `<span style="color:#a78bfa;">${t.studentName || t.assignedTo}</span>`;

    tr.innerHTML = `
        <td>${dateStr}</td>
        <td><strong>${t.title}</strong>${t.dueDate ? `<br><small style="color:#ff9800;">Vence: ${t.dueDate}</small>` : ''}</td>
        <td>${assignedLabel}</td>
        <td>${(t.description || '').substring(0, 50)}${t.description?.length > 50 ? '…' : ''}</td>
        <td class="action-buttons">
            <button class="btn btn-secondary btn-sm btn-subs" data-id="${t.id}"><i class="fas fa-inbox"></i> Entregas</button>
            <button class="btn btn-danger btn-sm btn-delete" data-id="${t.id}"><i class="fas fa-trash"></i></button>
        </td>
    `;
    tr.querySelector('.btn-subs').addEventListener('click', () => openSubmissions(t.id, t.title));
    tr.querySelector('.btn-delete').addEventListener('click', () =>
        confirmDelete(`¿Eliminar la tarea "${t.title}"?`, () => deleteItem('tasks', t.id))
    );
};

// ── ENTREGAS: revisión y calificación por el admin ───────
const openSubmissions = (taskId, title) => {
    document.getElementById('submissionsTaskTitle').textContent = title || '';
    const list = document.getElementById('submissionsList');
    list.innerHTML = '<div class="spinner"></div>';
    openModal(document.getElementById('submissionsModal'));

    unsubscribeListeners.submissions?.();
    unsubscribeListeners.submissions = onSnapshot(
        query(collection(db, dbPath('task_submissions')), where('taskId', '==', taskId)),
        (snap) => {
            if (snap.empty) { list.innerHTML = '<p style="color:#888;">Aún no hay entregas para esta tarea.</p>'; return; }
            list.innerHTML = '';
            snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.studentName || '').localeCompare(b.studentName || ''))
                .forEach(s => {
                    const ev = s.imageUrl
                        ? `<a href="#" class="sub-view-img">Ver foto</a>`
                        : /^https?:\/\//i.test(s.link || '') ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.link)}</a>`
                        : s.link ? esc(s.link)
                        : '<span style="color:#888;">Sin evidencia (marcada como hecha)</span>';
                    const card = document.createElement('div');
                    card.className = 'submission-card';
                    card.innerHTML = `
                        <div class="submission-head">
                            <strong>${esc(s.studentName || s.studentCode) || 'Alumno'}</strong>
                            <span class="sub-status ${s.status === 'reviewed' ? 'reviewed' : 'submitted'}">${s.status === 'reviewed' ? 'Revisada' : 'Entregada'}</span>
                        </div>
                        <p class="submission-ev">Evidencia: ${ev}</p>
                        <div class="submission-grade">
                            <input type="number" class="sub-grade" min="0" max="20" step="0.1" placeholder="/20" value="${s.grade ?? ''}">
                            <input type="text" class="sub-feedback" placeholder="Feedback para el alumno" value="${esc(s.feedback)}">
                            <button type="button" class="btn btn-primary btn-sm sub-save"><i class="fas fa-check"></i></button>
                        </div>
                    `;
                    card.querySelector('.sub-view-img')?.addEventListener('click', (evt) => {
                        evt.preventDefault();
                        viewImage(s.imageUrl);
                    });
                    card.querySelector('.sub-save').addEventListener('click', async () => {
                        const g = card.querySelector('.sub-grade').value;
                        try {
                            await updateDoc(doc(db, dbPath(`task_submissions/${s.id}`)), {
                                status: 'reviewed',
                                grade: g === '' ? null : parseFloat(g),
                                feedback: card.querySelector('.sub-feedback').value.trim(),
                                reviewedAt: new Date()
                            });
                            showToast('Revisión guardada.', 'success');
                        } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
                    });
                    list.appendChild(card);
                });
        }
    );
};
document.getElementById('closeSubmissionsModalBtn').addEventListener('click', () => {
    unsubscribeListeners.submissions?.();
    closeModal(document.getElementById('submissionsModal'));
});

const loadTasks = () => {
    document.getElementById('tasks-table-body').innerHTML =
        `<tr><td colspan="5" class="spinner-cell"><div class="spinner"></div></td></tr>`;
    unsubscribeListeners.tasks = onSnapshot(collection(db, dbPath('tasks')), (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        pState.tasks.data = data;
        renderPaged('tasks', renderTaskRow, 'No hay tareas creadas todavía.');
    });
};

// Toggle del selector de alumno específico
document.getElementById('taskAssigneeType').addEventListener('change', (e) => {
    const div = document.getElementById('specificStudentDiv');
    div.style.display = e.target.value === 'specific' ? 'block' : 'none';
    if (e.target.value === 'specific') loadActiveStudentsForTask();
});

const loadActiveStudentsForTask = async () => {
    const select = document.getElementById('taskSpecificStudent');
    select.innerHTML = '<option value="">Cargando…</option>';
    try {
        const snap = await getDocs(collection(db, dbPath('course_enrollments')));
        const seen = new Set();
        const options = [];
        snap.docs.forEach(d => {
            const e = d.data();
            if (e.status === 'Aprobado' && !seen.has(e.email)) {
                seen.add(e.email);
                options.push({ code: e.studentCode, name: e.fullName, email: e.email });
            }
        });
        select.innerHTML = '<option value="">Selecciona un alumno…</option>';
        options.sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.code || s.email;
            opt.text  = `${s.name} (${s.code || s.email})`;
            opt.dataset.name = s.name;
            select.appendChild(opt);
        });
        if (options.length === 0) select.innerHTML = '<option value="">Sin alumnos aprobados</option>';
    } catch (err) {
        select.innerHTML = '<option value="">Error cargando alumnos</option>';
    }
};

document.getElementById('add-task-btn').addEventListener('click', () => {
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = '';
    document.getElementById('specificStudentDiv').style.display = 'none';
    document.getElementById('task-modal-action') && (document.getElementById('task-modal-action').textContent = 'Crear');
    openModal(document.getElementById('taskModal'));
});

document.getElementById('taskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg          = document.getElementById('taskFormMessage');
    const assigneeType = document.getElementById('taskAssigneeType').value;
    const isSpecific   = assigneeType === 'specific';

    let assignedTo  = 'all';
    let studentName = null;

    if (isSpecific) {
        const sel   = document.getElementById('taskSpecificStudent');
        assignedTo  = sel.value;
        studentName = sel.options[sel.selectedIndex]?.dataset.name || assignedTo;
        if (!assignedTo) { showMsg(msg, 'Selecciona un alumno.', 'error'); return; }
    }

    const data = {
        title:       document.getElementById('taskTitle').value,
        description: document.getElementById('taskDescription').value,
        url:         document.getElementById('taskUrl').value || null,
        dueDate:     document.getElementById('taskDueDate').value || null,
        assignedTo,
        studentName,
        createdAt:   new Date()
    };

    showMsg(msg, 'Guardando tarea…', 'loading');
    try {
        await addDoc(collection(db, dbPath('tasks')), data);
        closeModal(document.getElementById('taskModal'));
        showMsg(msg, '', '');
        showToast(`Tarea "${data.title}" asignada correctamente.`, 'success');
    } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
});
document.getElementById('closeTaskModalBtn').addEventListener('click', () =>
    closeModal(document.getElementById('taskModal'))
);


// ══════════════════════════════════════════════════════════
// CAMPUS VIRTUAL — PROGRESO DE ALUMNOS
// ══════════════════════════════════════════════════════════
const LEVEL_COLORS = { 'Rookie': '#888', 'Pro Dealer': '#007bff', 'Élite VIP': '#ffc107' };

// ── Helpers de asistencia / notas ────────────────────────
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const attPct = (log) => {
    const vals = Object.values(log || {});
    if (!vals.length) return null;
    return Math.round(vals.filter(v => v === 'present').length / vals.length * 100);
};
const gradesAvg = (arr) => {
    const list = (arr || []).filter(g => g && g.score != null && g.score !== '');
    if (!list.length) return null;
    return +(list.reduce((s, g) => s + (+g.score || 0), 0) / list.length).toFixed(1);
};

// Estado del calendario mientras el modal de progreso está abierto
const attEdit = { log: {}, year: 0, month: 0 };

const renderAttSummary = () => {
    const vals = Object.values(attEdit.log);
    const present = vals.filter(v => v === 'present').length;
    document.getElementById('attSummary').textContent = vals.length
        ? `Asistencia: ${attPct(attEdit.log)}% (${present} de ${vals.length} días de clase)`
        : 'Sin días registrados aún.';
};

const renderAttCalendar = () => {
    const grid = document.getElementById('attCalGrid');
    const { year: y, month: m, log } = attEdit;
    document.getElementById('attCalLabel').textContent = `${MONTHS_ES[m]} ${y}`;
    const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;   // 0 = lunes
    const daysIn   = new Date(y, m + 1, 0).getDate();
    let html = ['L','M','M','J','V','S','D'].map(d => `<span class="att-dow">${d}</span>`).join('');
    for (let i = 0; i < firstDow; i++) html += `<span class="att-cell empty"></span>`;
    for (let d = 1; d <= daysIn; d++) {
        const ds  = ymd(y, m, d);
        const st  = log[ds];
        const cls = st === 'present' ? 'present' : st === 'absent' ? 'absent' : '';
        html += `<button type="button" class="att-cell ${cls}" data-date="${ds}">${d}</button>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.att-cell[data-date]').forEach(c =>
        c.addEventListener('click', () => {
            const cur = attEdit.log[c.dataset.date];
            if (!cur) attEdit.log[c.dataset.date] = 'present';
            else if (cur === 'present') attEdit.log[c.dataset.date] = 'absent';
            else delete attEdit.log[c.dataset.date];
            renderAttCalendar();
        }));
    renderAttSummary();
};

document.getElementById('attPrevMonth').addEventListener('click', () => {
    if (--attEdit.month < 0) { attEdit.month = 11; attEdit.year--; }
    renderAttCalendar();
});
document.getElementById('attNextMonth').addEventListener('click', () => {
    if (++attEdit.month > 11) { attEdit.month = 0; attEdit.year++; }
    renderAttCalendar();
});

const addGradeRow = (g = {}) => {
    const row = document.createElement('div');
    row.className = 'grade-row';
    const note = (g.note || '').replace(/"/g, '&quot;');
    row.innerHTML = `
        <input type="number" class="grade-week"  min="1" value="${g.week ?? ''}" placeholder="#">
        <input type="date"   class="grade-date"  value="${g.date || ''}">
        <input type="number" class="grade-score" min="0" max="20" step="0.1" value="${g.score ?? ''}" placeholder="/20">
        <input type="text"   class="grade-note"  value="${note}" placeholder="Comentario">
        <button type="button" class="grade-del"><i class="fas fa-times"></i></button>
    `;
    row.querySelector('.grade-del').addEventListener('click', () => row.remove());
    document.getElementById('progressGradesList').appendChild(row);
};
const collectGrades = () =>
    [...document.querySelectorAll('#progressGradesList .grade-row')].map(r => ({
        week:  parseInt(r.querySelector('.grade-week').value) || null,
        date:  r.querySelector('.grade-date').value || '',
        score: r.querySelector('.grade-score').value === '' ? null : parseFloat(r.querySelector('.grade-score').value),
        note:  r.querySelector('.grade-note').value.trim()
    })).filter(g => g.score != null || g.note);

document.getElementById('addGradeWeekBtn').addEventListener('click', () => {
    const next = document.querySelectorAll('#progressGradesList .grade-row').length + 1;
    addGradeRow({ week: next });
});

const renderProgressRow = (s) => {
    const tbody = document.getElementById('progress-table-body');
    const tr = tbody.insertRow();
    const levelColor = LEVEL_COLORS[s.level] || '#888';
    const aPct  = s.attendanceLog ? attPct(s.attendanceLog) : (s.attendance ?? null);
    const grade = (s.weeklyGrades && s.weeklyGrades.length) ? gradesAvg(s.weeklyGrades) : (s.grades ?? null);

    tr.innerHTML = `
        <td><code style="color:#ffc107;">${esc(s.studentCode) || '-'}</code></td>
        <td>${esc(s.fullName) || '-'}</td>
        <td>${esc(s.email) || '-'}</td>
        <td><span style="color:${levelColor}; font-weight:bold;">${s.level || 'Rookie'}</span></td>
        <td>${aPct  != null ? `${aPct}%`   : '--'}</td>
        <td>${grade != null ? `${grade}/20` : '--'}</td>
        <td class="action-buttons">
            <button class="btn btn-secondary btn-sm btn-edit" data-id="${s.uid}">
                <i class="fas fa-edit"></i> Editar
            </button>
        </td>
    `;
    tr.querySelector('.btn-edit').addEventListener('click', () => openProgressModal(s));
};

// Ficha de progreso de un alumno (nivel, calendario de asistencia y notas).
// Se abre desde Progreso, Alumnos o la lista del día.
const openProgressModal = (s) => {
    document.getElementById('progressStudentUid').value = s.uid;
    document.getElementById('progressStudentName').textContent = s.fullName || s.email || 'Alumno';
    document.getElementById('progressLevel').value     = s.level || 'Rookie';
    document.getElementById('progressStartDate').value = s.courseStartDate || '';

    // Asistencia: carga el registro y posiciona el calendario en el mes actual
    attEdit.log = { ...(s.attendanceLog || {}) };
    const base = new Date();
    attEdit.year  = base.getFullYear();
    attEdit.month = base.getMonth();
    renderAttCalendar();

    // Notas semanales
    document.getElementById('progressGradesList').innerHTML = '';
    (s.weeklyGrades || []).forEach(addGradeRow);

    openModal(document.getElementById('progressModal'));
};

const loadProgress = () => {
    document.getElementById('progress-table-body').innerHTML =
        `<tr><td colspan="7" class="spinner-cell"><div class="spinner"></div></td></tr>`;
    unsubscribeListeners.progress = onSnapshot(
        query(collection(db, dbPath('user_roles')), where('role', '==', 'student')),
        (snap) => {
            // Solo matriculados: un inscrito sin pago aún no tiene progreso que llevar.
            const data = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
                .filter(s => s.status === 'active')
                .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
            pState.progress.data = data;
            renderPaged('progress', renderProgressRow, 'No hay alumnos matriculados todavía.');
        }
    );
};

document.getElementById('progressForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('progressFormMessage');
    const uid = document.getElementById('progressStudentUid').value;
    if (!uid) return;

    const grades = collectGrades();
    const data = {
        level:           document.getElementById('progressLevel').value,
        courseStartDate: document.getElementById('progressStartDate').value || null,
        attendanceLog:   attEdit.log,
        weeklyGrades:    grades,
        attendance:      attPct(attEdit.log),   // derivado (compatibilidad con vistas previas)
        grades:          gradesAvg(grades)       // derivado (compatibilidad)
    };

    showMsg(msg, 'Guardando…', 'loading');
    try {
        await updateDoc(doc(db, dbPath(`user_roles/${uid}`)), data);
        closeModal(document.getElementById('progressModal'));
        showMsg(msg, '', '');
        showToast('Progreso del alumno actualizado.', 'success');
    } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
});
document.getElementById('closeProgressModalBtn').addEventListener('click', () =>
    closeModal(document.getElementById('progressModal'))
);

registerSection('materials', { title: 'Material Didáctico', load: loadMaterials, row: renderMaterialRow, empty: 'No hay materiales subidos aún.' });
registerSection('tasks', { title: 'Asignar Tareas', load: loadTasks, row: renderTaskRow, empty: 'No hay tareas asignadas.' });
registerSection('progress', { title: 'Progreso de Alumnos', load: loadProgress, row: renderProgressRow, empty: 'No hay alumnos matriculados.' });

export { attPct, openProgressModal };
