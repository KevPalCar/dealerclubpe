// ============================================================
// PANEL DE ADMINISTRACIÓN — DealerClub
// ============================================================
// Depende de firebase.js para la inicialización de Firebase.
// Nunca dupliques la config ni llames initializeApp aquí.
// ============================================================

import { auth, db, dbPath, generateStudentCode } from './firebase.js';
import { compressImage } from './image.js';
import { toYmd, fromYmd, fmtDate, nextMonday, billingSchedule, billingSummary, daysLabel } from './billing.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    collection, addDoc, setDoc, doc, updateDoc, deleteDoc,
    onSnapshot, getDoc, query, where, getDocs, writeBatch, getCountFromServer
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

// ── EMAILJS — notificaciones automáticas al aprobar inscripciones ──
// Credenciales del proyecto DealerClub en emailjs.com (cuenta gratuita, 200/mes).
// Si necesitas cambiar la plantilla o el servicio, actualiza solo estas 3 constantes.
import emailjs from 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/+esm';
const EJS_SERVICE  = 'service_w76xi5m';
const EJS_TEMPLATE = 'template_n6t2bx8';
emailjs.init('_S-T8AGnU-LZveZ7y');

// ── ESCAPE DE HTML ──────────────────────────────────────────
// Todo dato escrito por un visitante o alumno (nombres, correos,
// comentarios) pasa por aquí antes de insertarse en el panel.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── SISTEMA DE NOTIFICACIONES TOAST ─────────────────────────
// Reemplaza todos los alert() con mensajes no bloqueantes.
const showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 350); }, 4000);
};

// ── PAGINACIÓN GENÉRICA ──────────────────────────────────────
// Un objeto de estado por sección (key = nombre de sección).
// renderPaged() dibuja la página actual y actualiza controles.
// initSearch() conecta el input de búsqueda y los botones de página.
const PAGE_SIZE = 20;
const pState = {};

const renderPaged = (key, renderRowFn, emptyMsg = 'Sin resultados.') => {
    const cfg = pState[key];
    if (!cfg) return;

    const term = cfg.term || '';
    cfg.filtered = term
        ? cfg.data.filter(item => JSON.stringify(item).toLowerCase().includes(term))
        : [...cfg.data];

    const total      = cfg.filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (cfg.page > totalPages) cfg.page = 1;

    const start    = (cfg.page - 1) * PAGE_SIZE;
    const pageData = cfg.filtered.slice(start, start + PAGE_SIZE);
    const tbody    = document.getElementById(`${key}-table-body`);
    if (!tbody) return;

    tbody.innerHTML = '';
    if (pageData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="20" class="empty-msg">${emptyMsg}</td></tr>`;
    } else {
        pageData.forEach((item, i) => renderRowFn(item, i));
    }

    const countEl    = document.getElementById(`count-${key}`);
    const pageInfoEl = document.getElementById(`page-info-${key}`);
    const prevBtn    = document.getElementById(`prev-${key}`);
    const nextBtn    = document.getElementById(`next-${key}`);
    const bar        = document.getElementById(`pagination-${key}`);

    if (countEl)    countEl.textContent    = `${total} registro${total !== 1 ? 's' : ''}`;
    if (pageInfoEl) pageInfoEl.textContent = `Página ${cfg.page} de ${totalPages}`;
    if (prevBtn)    prevBtn.disabled       = cfg.page <= 1;
    if (nextBtn)    nextBtn.disabled       = cfg.page >= totalPages;
    if (bar)        bar.style.display      = total > PAGE_SIZE ? 'flex' : 'none';
};

const initSearch = (key, renderRowFn, emptyMsg) => {
    pState[key] = { page: 1, data: [], filtered: [], term: '' };

    const input = document.getElementById(`search-${key}`);
    if (input) {
        input.addEventListener('input', () => {
            pState[key].term = input.value.toLowerCase().trim();
            pState[key].page = 1;
            renderPaged(key, renderRowFn, emptyMsg);
        });
    }
    const prevBtn = document.getElementById(`prev-${key}`);
    const nextBtn = document.getElementById(`next-${key}`);
    if (prevBtn) prevBtn.addEventListener('click', () => { pState[key].page--; renderPaged(key, renderRowFn, emptyMsg); });
    if (nextBtn) nextBtn.addEventListener('click', () => { pState[key].page++; renderPaged(key, renderRowFn, emptyMsg); });
};

// ── INICIALIZACIÓN DEL DOM ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    let unsubscribeListeners = {};

    // ── AUTENTICACIÓN Y SEGURIDAD ────────────────────────────
    onAuthStateChanged(auth, async (user) => {
        if (user && !user.isAnonymous) {
            try {
                const snap = await getDoc(doc(db, dbPath(`user_roles/${user.uid}`)));
                if (snap.exists() && snap.data().role === 'admin') {
                    document.getElementById('admin-user-info').innerHTML =
                        `<span>Bienvenido, Admin</span><i class="fas fa-user-circle"></i>`;
                    initSearches();
                    loadSection('daily');
                    reconcileApprovedStudents();
                    watchVoucherQueue();
                } else {
                    await signOut(auth);
                    window.location.replace('/iniciar-sesion');
                }
            } catch {
                await signOut(auth);
                window.location.replace('/iniciar-sesion');
            }
        } else {
            window.location.replace('/iniciar-sesion');
        }
    });

    // ── UTILIDADES MODALES ───────────────────────────────────
    const openModal  = (modal) => { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; };
    const closeModal = (modal) => { modal.style.display = 'none'; document.body.style.overflow = 'auto'; };
    const showMsg    = (el, msg, type) => {
        if (!el) return;
        el.textContent  = msg;
        el.className    = `form-message${type ? ` ${type}` : ''}`;
        el.style.display = msg ? 'block' : 'none';
    };

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) closeModal(e.target);
    });

    // ── MODAL DE CONFIRMACIÓN ────────────────────────────────
    let deleteCallback = null;
    const confirmModal = document.getElementById('confirmationModal');

    const confirmDelete = (message, callback) => {
        document.getElementById('confirmationMessage').textContent = message;
        deleteCallback = callback;
        showMsg(document.getElementById('deleteFormMessage'), '', '');
        openModal(confirmModal);
    };

    const deleteItem = async (collectionName, itemId) => {
        showMsg(document.getElementById('deleteFormMessage'), 'Eliminando...', 'loading');
        try {
            await deleteDoc(doc(db, dbPath(`${collectionName}/${itemId}`)));
            showMsg(document.getElementById('deleteFormMessage'), 'Eliminado.', 'success');
            setTimeout(() => closeModal(confirmModal), 900);
        } catch (err) {
            showMsg(document.getElementById('deleteFormMessage'), `Error: ${err.message}`, 'error');
        }
    };

    document.getElementById('confirmActionBtn').addEventListener('click', () => { if (deleteCallback) deleteCallback(); });
    document.getElementById('cancelConfirmBtn').addEventListener('click', () => closeModal(confirmModal));
    document.getElementById('closeConfirmationModalBtn').addEventListener('click', () => closeModal(confirmModal));

    // ── NAVEGACIÓN ───────────────────────────────────────────
    const loadSection = (sectionName) => {
        Object.values(unsubscribeListeners).forEach(fn => fn());
        unsubscribeListeners = {};

        document.querySelectorAll('.admin-content .content-section').forEach(s => s.style.display = 'none');
        document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));

        const section = document.getElementById(`${sectionName}-management`);
        const link    = document.getElementById(`nav-${sectionName}`);
        if (!section || !link) return;

        section.style.display = 'block';
        link.classList.add('active');

        const titles = {
            courses: 'Gestión de Cursos',         professors: 'Gestión de Profesores',
            alumni: 'Gestión de Egresados',        dealers: 'Gestión de Dealers',
            tables: 'Juegos del Casino',           services: 'Gestión de Servicios',
            referrals: 'Referidos & Marketing',
            requests: 'Cotizaciones de eventos',   announcements: 'Config & Anuncios',
            materials: 'Material Didáctico',        tasks: 'Asignar Tareas',
            progress: 'Progreso de Alumnos',      students: 'Alumnos',
            daily: 'Trabajo del día',             bot: 'Bot de WhatsApp'
        };
        document.getElementById('admin-main-title').textContent = titles[sectionName] || sectionName;

        const loaders = {
            courses: loadCourses,      professors: loadProfessors,
            alumni: loadAlumni,        dealers: loadDealers,
            tables: loadTables,        services: loadServices,
            referrals: loadReferrals,
            requests: loadRequests,    announcements: loadAnnouncements,
            materials: loadMaterials,  tasks: loadTasks,
            progress: loadProgress,    students: loadStudents,
            daily: loadDaily,          bot: loadBot
        };
        if (loaders[sectionName]) loaders[sectionName]();
    };

    document.querySelector('.sidebar-nav ul').addEventListener('click', async (e) => {
        e.preventDefault();
        const target = e.target.closest('a');
        if (!target) return;
        if (target.id === 'admin-logout-btn') {
            await signOut(auth);
            window.location.replace('/iniciar-sesion');
            return;
        }
        loadSection(target.id.replace('nav-', ''));
    });

    // ── INIT BÚSQUEDAS + PAGINACIÓN (llamado al autenticar) ──
    const initSearches = () => {
        initSearch('courses',     renderCourseRow,     'No hay cursos registrados.');
        initSearch('professors',  renderProfRow,       'No hay profesores registrados.');
        initSearch('alumni',      renderAlumniRow,     'No hay egresados registrados.');
        initSearch('dealers',     renderDealerRow,     'No hay dealers registrados.');
        initSearch('tables',      renderTableRow,      'No hay juegos registrados.');
        initSearch('services',    renderServiceRow,    'No hay servicios registrados.');
        initSearch('requests',    renderRequestRow,    'No hay solicitudes.');
        initSearch('materials',   renderMaterialRow,   'No hay materiales subidos aún.');
        initSearch('tasks',       renderTaskRow,       'No hay tareas asignadas.');
        initSearch('progress',    renderProgressRow,   'No hay alumnos matriculados.');
        initSearch('students',    renderStudentRow,    'No hay alumnos registrados.');
        initSearch('quotes',      renderQuoteRow,      'Aún no has emitido cotizaciones.');
    };


    // ══════════════════════════════════════════════════════════
    // CRUD: CURSOS
    // ══════════════════════════════════════════════════════════
    const renderCourseRow = (c) => {
        const tbody = document.getElementById('courses-table-body');
        const tr = tbody.insertRow();
        tr.innerHTML = `
            <td>${c.order ?? '-'}</td>
            <td><strong>${c.name}</strong><br><small style="color:#ffc107;">${c.tag || ''}</small></td>
            <td>${(c.description || '').substring(0, 35)}…</td>
            <td>${c.price}${c.priceNote ? `<br><small style="color:#999;">${c.priceNote}</small>` : ''}</td><td>${c.schedule}</td><td>${c.duration}</td>
            <td>
                <select class="status-select" data-id="${c.id}">
                    <option value="Abierto"      ${c.status === 'Abierto'       ? 'selected' : ''}>Abierto</option>
                    <option value="En Progreso"  ${c.status === 'En Progreso'   ? 'selected' : ''}>En Progreso</option>
                    <option value="Próximamente" ${c.status === 'Próximamente'  ? 'selected' : ''}>Próximamente</option>
                    <option value="Cerrado"      ${c.status === 'Cerrado'       ? 'selected' : ''}>Cerrado</option>
                </select>
            </td>
            <td class="action-buttons">
                <button class="btn btn-secondary btn-edit" data-id="${c.id}"><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger btn-delete" data-id="${c.id}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tr.querySelector('.status-select').addEventListener('change', async (e) => {
            await updateDoc(doc(db, dbPath(`courses/${e.target.dataset.id}`)), { status: e.target.value });
            showToast('Estado del curso actualizado.', 'success');
        });
        tr.querySelector('.btn-edit').addEventListener('click', () => {
            document.getElementById('courseId').value          = c.id;
            document.getElementById('courseName').value        = c.name;
            document.getElementById('courseTag').value         = c.tag || '';
            document.getElementById('courseOrder').value       = c.order;
            document.getElementById('courseDescription').value = c.description;
            document.getElementById('coursePrice').value       = c.price;
            document.getElementById('coursePriceNote').value   = c.priceNote || '';
            document.getElementById('courseSchedule').value    = c.schedule;
            document.getElementById('courseDuration').value    = c.duration;
            document.getElementById('courseGames').value       = (c.gamesIncluded || []).join(', ');
            document.getElementById('courseStatus').value      = c.status;
            _courseDays = new Set(c.classDays ?? guessClassDays(c.schedule));
            renderCourseDays();
            document.getElementById('modal-title-action').textContent = 'Editar';
            openModal(document.getElementById('courseModal'));
        });
        tr.querySelector('.btn-delete').addEventListener('click', () =>
            confirmDelete(`¿Eliminar el curso "${c.name}"?`, () => deleteItem('courses', c.id))
        );
    };

    const loadCourses = () => {
        document.getElementById('courses-table-body').innerHTML =
            `<tr><td colspan="8" class="spinner-cell"><div class="spinner"></div></td></tr>`;
        unsubscribeListeners.courses = onSnapshot(collection(db, dbPath('courses')), (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
            pState.courses.data = data;
            renderPaged('courses', renderCourseRow, 'No hay cursos registrados.');
        });
    };

    // Días de clase del curso (0 = domingo … 6 = sábado). Si el curso aún
    // no los tiene guardados, se deducen del texto del horario.
    const guessClassDays = (schedule) => {
        const t = (schedule || '').toLowerCase();
        if (/lunes a s[áa]bado/.test(t))  return [1, 2, 3, 4, 5, 6];
        if (/lunes a viernes/.test(t))    return [1, 2, 3, 4, 5];
        const days = [];
        if (/s[áa]bado/.test(t)) days.push(6);
        if (/domingo/.test(t))   days.push(0);
        return days;   // vacío = sin días fijos (p. ej. "Consultar")
    };
    let _courseDays = new Set();
    const renderCourseDays = () => {
        const box = document.getElementById('courseDays');
        box.innerHTML = DAY_LABELS.map(([v, l]) =>
            `<button type="button" class="day-pick ${_courseDays.has(v) ? 'on' : ''}" data-day="${v}">${l}</button>`).join('');
        box.querySelectorAll('.day-pick').forEach(b => b.addEventListener('click', () => {
            const v = +b.dataset.day;
            if (_courseDays.has(v)) _courseDays.delete(v); else _courseDays.add(v);
            renderCourseDays();
        }));
    };

    document.getElementById('add-course-btn').addEventListener('click', () => {
        document.getElementById('courseForm').reset();
        _courseDays = new Set([1, 2, 3, 4, 5]);
        renderCourseDays();
        document.getElementById('courseId').value = '';
        document.getElementById('modal-title-action').textContent = 'Añadir';
        openModal(document.getElementById('courseModal'));
    });

    document.getElementById('courseForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('courseId').value;
        const data = {
            name: document.getElementById('courseName').value,
            tag: document.getElementById('courseTag').value,
            order: parseInt(document.getElementById('courseOrder').value) || 0,
            description: document.getElementById('courseDescription').value,
            price: document.getElementById('coursePrice').value,
            priceNote: document.getElementById('coursePriceNote').value.trim(),
            schedule: document.getElementById('courseSchedule').value,
            duration: document.getElementById('courseDuration').value,
            gamesIncluded: document.getElementById('courseGames').value.split(',').map(g => g.trim()).filter(Boolean),
            status: document.getElementById('courseStatus').value,
            classDays: [..._courseDays].sort(),
            lastUpdated: new Date()
        };
        try {
            if (id) await updateDoc(doc(db, dbPath(`courses/${id}`)), data);
            else     await addDoc(collection(db, dbPath('courses')), data);
            closeModal(document.getElementById('courseModal'));
            showToast(id ? 'Curso actualizado.' : 'Curso añadido correctamente.', 'success');
        } catch (err) { showToast(`Error guardando curso: ${err.message}`, 'error'); }
    });
    document.getElementById('closeCourseModalBtn').addEventListener('click', () =>
        closeModal(document.getElementById('courseModal'))
    );


    // ══════════════════════════════════════════════════════════
    // CRUD: PROFESORES
    // ══════════════════════════════════════════════════════════
    const renderProfRow = (p) => {
        const tbody = document.getElementById('professors-table-body');
        const tr = tbody.insertRow();
        tr.innerHTML = `
            <td>${p.order ?? '-'}</td><td>${p.name}</td><td>${p.specialty}</td>
            <td>${(p.bio || '').substring(0, 40)}…</td>
            <td class="action-buttons">
                <button class="btn btn-secondary btn-edit" data-id="${p.id}"><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger btn-delete" data-id="${p.id}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tr.querySelector('.btn-edit').addEventListener('click', () => {
            document.getElementById('professorId').value       = p.id;
            document.getElementById('professorName').value     = p.name || '';
            document.getElementById('professorOrder').value    = p.order || 0;
            document.getElementById('professorSpecialty').value= p.specialty || '';
            document.getElementById('professorBio').value      = p.bio || '';
            document.getElementById('professorImageUrl').value = p.imageUrl || '';
            document.getElementById('professorImageFile').value= '';
            const preview = document.getElementById('prof-img-preview');
            preview.src          = p.imageUrl || '';
            preview.style.display= p.imageUrl ? 'block' : 'none';
            document.getElementById('professor-modal-title-action').textContent = 'Editar';
            openModal(document.getElementById('professorModal'));
        });
        tr.querySelector('.btn-delete').addEventListener('click', () =>
            confirmDelete(`¿Eliminar al profesor "${p.name}"?`, () => deleteItem('professors', p.id))
        );
    };

    const loadProfessors = () => {
        document.getElementById('professors-table-body').innerHTML =
            `<tr><td colspan="5" class="spinner-cell"><div class="spinner"></div></td></tr>`;
        unsubscribeListeners.professors = onSnapshot(collection(db, dbPath('professors')), (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
            pState.professors.data = data;
            renderPaged('professors', renderProfRow, 'No hay profesores registrados.');
        });
    };

    // Previsualización de imagen (archivo local)
    document.getElementById('professorImageFile').addEventListener('change', (e) => {
        const file    = e.target.files[0];
        const preview = document.getElementById('prof-img-preview');
        const urlInput= document.getElementById('professorImageUrl');
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                preview.src = ev.target.result;
                preview.style.display = 'block';
                urlInput.value = '';
            };
            reader.readAsDataURL(file);
        } else {
            preview.style.display = 'none';
        }
    });

    // Previsualización de imagen (URL manual)
    document.getElementById('professorImageUrl').addEventListener('input', (e) => {
        const preview = document.getElementById('prof-img-preview');
        preview.src          = e.target.value;
        preview.style.display= e.target.value.trim() ? 'block' : 'none';
    });

    document.getElementById('add-professor-btn').addEventListener('click', () => {
        document.getElementById('professorForm').reset();
        document.getElementById('professorId').value = '';
        document.getElementById('prof-img-preview').style.display = 'none';
        document.getElementById('professor-modal-title-action').textContent = 'Añadir';
        openModal(document.getElementById('professorModal'));
    });

    document.getElementById('professorForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgBox = document.getElementById('professorFormMessage');
        showMsg(msgBox, 'Procesando imagen…', 'loading');

        const id        = document.getElementById('professorId').value;
        const fileInput = document.getElementById('professorImageFile');
        let finalUrl    = document.getElementById('professorImageUrl').value.trim();

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            if (file.size > 8 * 1024 * 1024) {
                showMsg(msgBox, 'Imagen demasiado grande (máx 8MB).', 'error');
                return;
            }
            try { finalUrl = await compressImage(file); }
            catch { showMsg(msgBox, 'Error al procesar la imagen.', 'error'); return; }
        }

        const data = {
            name:        document.getElementById('professorName').value,
            order:       parseInt(document.getElementById('professorOrder').value) || 0,
            specialty:   document.getElementById('professorSpecialty').value,
            bio:         document.getElementById('professorBio').value,
            imageUrl:    finalUrl,
            lastUpdated: new Date()
        };

        try {
            if (id) await updateDoc(doc(db, dbPath(`professors/${id}`)), data);
            else     await addDoc(collection(db, dbPath('professors')), data);
            closeModal(document.getElementById('professorModal'));
            showMsg(msgBox, '', '');
            showToast(id ? 'Profesor actualizado.' : 'Profesor añadido.', 'success');
        } catch (err) { showMsg(msgBox, `Error: ${err.message}`, 'error'); }
    });
    document.getElementById('closeProfessorModalBtn').addEventListener('click', () =>
        closeModal(document.getElementById('professorModal'))
    );


    // ══════════════════════════════════════════════════════════
    // CRUD: EGRESADOS
    // ══════════════════════════════════════════════════════════
    const renderAlumniRow = (a) => {
        const tbody = document.getElementById('alumni-table-body');
        const tr = tbody.insertRow();
        tr.innerHTML = `
            <td>${a.order ?? '-'}</td><td>${a.name}</td><td>${a.info}</td>
            <td>"${(a.testimonial || '').substring(0, 40)}…"</td>
            <td class="action-buttons">
                <button class="btn btn-secondary btn-edit" data-id="${a.id}"><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger btn-delete" data-id="${a.id}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tr.querySelector('.btn-edit').addEventListener('click', () => {
            document.getElementById('alumniId').value          = a.id;
            document.getElementById('alumniName').value        = a.name || '';
            document.getElementById('alumniOrder').value       = a.order || 0;
            document.getElementById('alumniInfo').value        = a.info || '';
            document.getElementById('alumniTestimonial').value = a.testimonial || '';
            document.getElementById('alumniImageUrl').value    = a.imageUrl || '';
            document.getElementById('alumni-modal-title-action').textContent = 'Editar';
            openModal(document.getElementById('alumniModal'));
        });
        tr.querySelector('.btn-delete').addEventListener('click', () =>
            confirmDelete(`¿Eliminar al egresado "${a.name}"?`, () => deleteItem('alumni', a.id))
        );
    };

    const loadAlumni = () => {
        document.getElementById('alumni-table-body').innerHTML =
            `<tr><td colspan="5" class="spinner-cell"><div class="spinner"></div></td></tr>`;
        unsubscribeListeners.alumni = onSnapshot(collection(db, dbPath('alumni')), (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
            pState.alumni.data = data;
            renderPaged('alumni', renderAlumniRow, 'No hay egresados registrados.');
        });
    };

    document.getElementById('add-alumni-btn').addEventListener('click', () => {
        document.getElementById('alumniForm').reset();
        document.getElementById('alumniId').value = '';
        document.getElementById('alumni-modal-title-action').textContent = 'Añadir';
        openModal(document.getElementById('alumniModal'));
    });
    document.getElementById('alumniForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('alumniId').value;
        const data = {
            name: document.getElementById('alumniName').value, order: parseInt(document.getElementById('alumniOrder').value) || 0,
            info: document.getElementById('alumniInfo').value, testimonial: document.getElementById('alumniTestimonial').value,
            imageUrl: document.getElementById('alumniImageUrl').value, lastUpdated: new Date()
        };
        try {
            if (id) await updateDoc(doc(db, dbPath(`alumni/${id}`)), data);
            else     await addDoc(collection(db, dbPath('alumni')), data);
            closeModal(document.getElementById('alumniModal'));
            showToast(id ? 'Egresado actualizado.' : 'Egresado añadido.', 'success');
        } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
    });
    document.getElementById('closeAlumniModalBtn').addEventListener('click', () =>
        closeModal(document.getElementById('alumniModal'))
    );


    // ══════════════════════════════════════════════════════════
    // CRUD: DEALERS
    // ══════════════════════════════════════════════════════════
    const renderDealerRow = (d) => {
        const tbody = document.getElementById('dealers-table-body');
        const tr = tbody.insertRow();
        tr.innerHTML = `
            <td>${d.order ?? '-'}</td><td>${d.name}</td><td>${d.specialty}</td>
            <td>${d.experience} años</td><td>${(d.bio || '').substring(0, 30)}…</td>
            <td class="action-buttons">
                <button class="btn btn-secondary btn-edit" data-id="${d.id}"><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger btn-delete" data-id="${d.id}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tr.querySelector('.btn-edit').addEventListener('click', () => {
            document.getElementById('dealerId').value        = d.id;
            document.getElementById('dealerName').value      = d.name;
            document.getElementById('dealerOrder').value     = d.order;
            document.getElementById('dealerSpecialty').value = d.specialty;
            document.getElementById('dealerExperience').value= d.experience;
            document.getElementById('dealerBio').value       = d.bio;
            document.getElementById('dealerImageUrl').value  = d.imageUrl || '';
            document.getElementById('dealer-modal-title-action').textContent = 'Editar';
            openModal(document.getElementById('dealerModal'));
        });
        tr.querySelector('.btn-delete').addEventListener('click', () =>
            confirmDelete(`¿Eliminar al dealer "${d.name}"?`, () => deleteItem('dealers', d.id))
        );
    };

    const loadDealers = () => {
        document.getElementById('dealers-table-body').innerHTML =
            `<tr><td colspan="6" class="spinner-cell"><div class="spinner"></div></td></tr>`;
        unsubscribeListeners.dealers = onSnapshot(collection(db, dbPath('dealers')), (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
            pState.dealers.data = data;
            renderPaged('dealers', renderDealerRow, 'No hay dealers registrados.');
        });
    };

    document.getElementById('add-dealer-btn').addEventListener('click', () => {
        document.getElementById('dealerForm').reset();
        document.getElementById('dealerId').value = '';
        document.getElementById('dealer-modal-title-action').textContent = 'Añadir';
        openModal(document.getElementById('dealerModal'));
    });
    document.getElementById('dealerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('dealerId').value;
        const data = {
            name: document.getElementById('dealerName').value, order: parseInt(document.getElementById('dealerOrder').value) || 0,
            specialty: document.getElementById('dealerSpecialty').value, experience: parseInt(document.getElementById('dealerExperience').value),
            bio: document.getElementById('dealerBio').value, imageUrl: document.getElementById('dealerImageUrl').value, lastUpdated: new Date()
        };
        try {
            if (id) await updateDoc(doc(db, dbPath(`dealers/${id}`)), data);
            else     await addDoc(collection(db, dbPath('dealers')), data);
            closeModal(document.getElementById('dealerModal'));
            showToast(id ? 'Dealer actualizado.' : 'Dealer añadido.', 'success');
        } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
    });
    document.getElementById('closeDealerModalBtn').addEventListener('click', () =>
        closeModal(document.getElementById('dealerModal'))
    );


    // ══════════════════════════════════════════════════════════
    // CRUD: JUEGOS DEL CASINO (colección 'tables')
    // ══════════════════════════════════════════════════════════
    const renderTableRow = (t) => {
        const tbody = document.getElementById('tables-table-body');
        const tr = tbody.insertRow();
        const thumb = t.imageUrl
            ? `<img src="${t.imageUrl}" alt="${t.name || 'Juego'}" style="width:60px;height:40px;object-fit:cover;border-radius:4px;">`
            : '<span style="color:#777;">—</span>';
        tr.innerHTML = `
            <td>${t.order ?? '-'}</td>
            <td>${thumb}</td>
            <td><strong>${t.name || ''}</strong></td>
            <td><small style="color:#ffc107;">${t.tag || ''}</small></td>
            <td>
                <select class="status-select" data-id="${t.id}">
                    <option value="Disponible"   ${t.status === 'Disponible'   ? 'selected' : ''}>Disponible</option>
                    <option value="Próximamente" ${t.status === 'Próximamente' ? 'selected' : ''}>Próximamente</option>
                    <option value="Agotado"      ${t.status === 'Agotado'      ? 'selected' : ''}>Agotado</option>
                </select>
            </td>
            <td>${t.maxPlayers ? `${t.maxPlayers} jug.` : '—'}</td>
            <td class="action-buttons">
                <button class="btn btn-secondary btn-edit" data-id="${t.id}"><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger btn-delete" data-id="${t.id}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tr.querySelector('.status-select').addEventListener('change', async (e) => {
            await updateDoc(doc(db, dbPath(`tables/${e.target.dataset.id}`)), { status: e.target.value });
            showToast('Estado del juego actualizado.', 'success');
        });
        tr.querySelector('.btn-edit').addEventListener('click', () => {
            document.getElementById('tableId').value          = t.id;
            document.getElementById('tableName').value        = t.name || '';
            document.getElementById('tableTag').value         = t.tag || '';
            document.getElementById('tableTagStyle').value    = t.tagStyle || 'popular';
            document.getElementById('tableOrder').value       = t.order ?? 0;
            document.getElementById('tableDescription').value = t.description || '';
            document.getElementById('tableMaxPlayers').value  = t.maxPlayers || '';
            document.getElementById('tableStatus').value      = t.status || 'Disponible';
            document.getElementById('tableImageUrl').value    = t.imageUrl || '';
            document.getElementById('tableImageFile').value   = '';
            const preview = document.getElementById('table-img-preview');
            preview.src           = t.imageUrl || '';
            preview.style.display = t.imageUrl ? 'block' : 'none';
            document.getElementById('table-modal-title-action').textContent = 'Editar';
            openModal(document.getElementById('tableModal'));
        });
        tr.querySelector('.btn-delete').addEventListener('click', () =>
            confirmDelete(`¿Eliminar el juego "${t.name}"?`, () => deleteItem('tables', t.id))
        );
    };

    const loadTables = () => {
        document.getElementById('tables-table-body').innerHTML =
            `<tr><td colspan="7" class="spinner-cell"><div class="spinner"></div></td></tr>`;
        unsubscribeListeners.tables = onSnapshot(collection(db, dbPath('tables')), (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
            pState.tables.data = data;
            renderPaged('tables', renderTableRow, 'No hay juegos registrados.');
        });
    };

    // Previsualización de imagen (archivo local)
    document.getElementById('tableImageFile').addEventListener('change', (e) => {
        const file    = e.target.files[0];
        const preview = document.getElementById('table-img-preview');
        const urlInput= document.getElementById('tableImageUrl');
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                preview.src = ev.target.result;
                preview.style.display = 'block';
                urlInput.value = '';
            };
            reader.readAsDataURL(file);
        } else {
            preview.style.display = 'none';
        }
    });

    // Previsualización de imagen (URL manual)
    document.getElementById('tableImageUrl').addEventListener('input', (e) => {
        const preview = document.getElementById('table-img-preview');
        preview.src           = e.target.value;
        preview.style.display = e.target.value.trim() ? 'block' : 'none';
    });

    document.getElementById('add-table-btn').addEventListener('click', () => {
        document.getElementById('tableForm').reset();
        document.getElementById('tableId').value = '';
        document.getElementById('table-img-preview').style.display = 'none';
        document.getElementById('table-modal-title-action').textContent = 'Añadir';
        openModal(document.getElementById('tableModal'));
    });

    document.getElementById('tableForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgBox = document.getElementById('tableFormMessage');
        showMsg(msgBox, 'Procesando imagen…', 'loading');

        const id        = document.getElementById('tableId').value;
        const fileInput = document.getElementById('tableImageFile');
        let finalUrl    = document.getElementById('tableImageUrl').value.trim();

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            if (file.size > 8 * 1024 * 1024) {
                showMsg(msgBox, 'Imagen demasiado grande (máx 8MB).', 'error');
                return;
            }
            try { finalUrl = await compressImage(file); }
            catch { showMsg(msgBox, 'Error al procesar la imagen.', 'error'); return; }
        }

        const maxPlayers = parseInt(document.getElementById('tableMaxPlayers').value);
        const data = {
            name:        document.getElementById('tableName').value,
            tag:         document.getElementById('tableTag').value.trim(),
            tagStyle:    document.getElementById('tableTagStyle').value,
            order:       parseInt(document.getElementById('tableOrder').value) || 0,
            description: document.getElementById('tableDescription').value,
            maxPlayers:  Number.isNaN(maxPlayers) ? null : maxPlayers,
            status:      document.getElementById('tableStatus').value,
            imageUrl:    finalUrl,
            lastUpdated: new Date()
        };

        try {
            if (id) await updateDoc(doc(db, dbPath(`tables/${id}`)), data);
            else     await addDoc(collection(db, dbPath('tables')), data);
            closeModal(document.getElementById('tableModal'));
            showMsg(msgBox, '', '');
            showToast(id ? 'Juego actualizado.' : 'Juego añadido.', 'success');
        } catch (err) { showMsg(msgBox, `Error: ${err.message}`, 'error'); }
    });
    document.getElementById('closeTableModalBtn').addEventListener('click', () =>
        closeModal(document.getElementById('tableModal'))
    );


    // ══════════════════════════════════════════════════════════
    // CRUD: SERVICIOS
    // ══════════════════════════════════════════════════════════
    const renderServiceRow = (s) => {
        const tbody = document.getElementById('services-table-body');
        const tr = tbody.insertRow();
        tr.innerHTML = `
            <td>${s.order ?? '-'}</td><td>${s.name}</td>
            <td>${(s.description || '').substring(0, 30)}…</td>
            <td>${s.price || 'Consultar'}</td><td>${s.status || 'Activo'}</td>
            <td class="action-buttons">
                <button class="btn btn-secondary btn-edit" data-id="${s.id}"><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger btn-delete" data-id="${s.id}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tr.querySelector('.btn-edit').addEventListener('click', () => {
            document.getElementById('serviceId').value          = s.id;
            document.getElementById('serviceName').value        = s.name || '';
            document.getElementById('serviceOrder').value       = s.order || 0;
            document.getElementById('serviceDescription').value = s.description || '';
            document.getElementById('servicePrice').value       = s.price || '';
            document.getElementById('serviceStatus').value      = s.status || 'Activo';
            document.getElementById('service-modal-title-action').textContent = 'Editar';
            openModal(document.getElementById('serviceModal'));
        });
        tr.querySelector('.btn-delete').addEventListener('click', () =>
            confirmDelete(`¿Eliminar el servicio "${s.name}"?`, () => deleteItem('services', s.id))
        );
    };

    const loadServices = () => {
        document.getElementById('services-table-body').innerHTML =
            `<tr><td colspan="6" class="spinner-cell"><div class="spinner"></div></td></tr>`;
        unsubscribeListeners.services = onSnapshot(collection(db, dbPath('services')), (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
            pState.services.data = data;
            renderPaged('services', renderServiceRow, 'No hay servicios registrados.');
        });
    };

    document.getElementById('add-service-btn').addEventListener('click', () => {
        document.getElementById('serviceForm').reset();
        document.getElementById('serviceId').value = '';
        document.getElementById('service-modal-title-action').textContent = 'Añadir';
        openModal(document.getElementById('serviceModal'));
    });
    document.getElementById('serviceForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('serviceId').value;
        const data = {
            name: document.getElementById('serviceName').value, order: parseInt(document.getElementById('serviceOrder').value) || 0,
            description: document.getElementById('serviceDescription').value, price: document.getElementById('servicePrice').value,
            status: document.getElementById('serviceStatus').value, lastUpdated: new Date()
        };
        try {
            if (id) await updateDoc(doc(db, dbPath(`services/${id}`)), data);
            else     await addDoc(collection(db, dbPath('services')), data);
            closeModal(document.getElementById('serviceModal'));
            showToast(id ? 'Servicio actualizado.' : 'Servicio añadido.', 'success');
        } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
    });
    document.getElementById('closeServiceModalBtn').addEventListener('click', () =>
        closeModal(document.getElementById('serviceModal'))
    );


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
    // SOLICITUDES DE CONTACTO
    // ══════════════════════════════════════════════════════════
    const REQUEST_STATUSES = ['Nuevo', 'Respondido', 'Cerrado'];

    // Correo oficial de la empresa (cuenta desde la que se responde)
    const COMPANY_EMAIL = 'dealerclubpe@gmail.com';

    // Abre la ventana de redacción de Gmail directamente en la cuenta de la
    // empresa, con destinatario, asunto y cuerpo autollenados con los datos de
    // la solicitud. Si esa cuenta no está logueada en el navegador, Gmail
    // pedirá iniciar sesión (queda garantizado que se responde desde la empresa).
    const buildGmailCompose = (r) => {
        const subject = `DealerClub — Respuesta a tu solicitud${r.quoteContext ? ` (${r.quoteContext})` : ''}`;
        const body =
            `Hola ${r.fullName || ''},\n\n` +
            `Gracias por tu interés en nuestro Casino de Fantasía. Sobre tu solicitud:\n` +
            (r.eventType ? `• Tipo de evento: ${r.eventType}\n` : '') +
            (r.eventDate ? `• Fecha del evento: ${r.eventDate}\n` : '') +
            (r.details   ? `• Detalle: ${r.details}\n`           : '') +
            `\n[Escribe aquí tu respuesta]\n\nSaludos cordiales,\nEquipo DealerClub`;
        const params = new URLSearchParams({ view: 'cm', fs: '1', to: r.email || '', su: subject, body });
        return `https://mail.google.com/mail/?authuser=${encodeURIComponent(COMPANY_EMAIL)}&${params.toString()}`;
    };
    // URL del panel de atención de WhatsApp (bandeja de la empresa).
    const WA_PANEL_URL = 'https://dealerclubpe.web.app/';
    // Construye un enlace al PANEL (no al WhatsApp personal): abre el chat de ese
    // número y autollena un mensaje con los datos de la solicitud, listo para enviar
    // desde el número de la empresa.
    const buildWa = (r) => {
        const phone = (r.phone || '').replace(/\D/g, '');
        if (!phone) return '';
        const text = `Hola ${r.fullName || ''}, te escribo de DealerClub 👋 sobre tu solicitud` +
            (r.eventType ? ` de ${r.eventType}` : '') +
            (r.eventDate ? ` (fecha tentativa: ${r.eventDate})` : '') + '.';
        return `${WA_PANEL_URL}?to=${phone}&msg=${encodeURIComponent(text)}`;
    };
    // Registra que se tomó acción (marca como 'Respondido' si seguía 'Nuevo')
    const markRequestResponded = async (r) => {
        if ((r.status || 'Nuevo') === 'Nuevo') {
            try { await updateDoc(doc(db, dbPath(`service_requests/${r.id}`)), { status: 'Respondido', respondedAt: new Date() }); }
            catch { /* ignora */ }
        }
    };

    const openRequestDetail = (r) => {
        const date = r.timestamp ? new Date(r.timestamp.seconds * 1000).toLocaleString('es-PE') : '-';
        document.getElementById('requestDetailBody').innerHTML = `
            <p><strong>Nombre:</strong> ${esc(r.fullName) || '-'}</p>
            <p><strong>Email:</strong> <a href="mailto:${esc(r.email)}">${esc(r.email) || '-'}</a></p>
            <p><strong>Teléfono:</strong> ${esc(r.phone) || '-'}</p>
            <p><strong>Tipo de evento:</strong> ${esc(r.eventType) || '-'}</p>
            <p><strong>Fecha del evento:</strong> ${esc(r.eventDate) || '-'}</p>
            ${r.quoteContext ? `<p><strong>Contexto:</strong> ${esc(r.quoteContext)}</p>` : ''}
            <p><strong>Recibido:</strong> ${date}</p>
            <p><strong>Estado:</strong> ${esc(r.status) || 'Nuevo'}</p>
            <p><strong>Detalle / Mensaje:</strong></p>
            <pre class="request-detail-msg">${esc(r.details || r.message) || '-'}</pre>
        `;
        const mailBtn = document.getElementById('requestDetailMail');
        const waBtn   = document.getElementById('requestDetailWa');
        mailBtn.href = buildGmailCompose(r);
        mailBtn.target = '_blank';
        mailBtn.rel = 'noopener';
        mailBtn.onclick = () => markRequestResponded(r);
        const wa = buildWa(r);
        if (wa) { waBtn.style.display = ''; waBtn.href = wa; waBtn.onclick = () => markRequestResponded(r); }
        else    { waBtn.style.display = 'none'; }
        openModal(document.getElementById('requestDetailModal'));
    };
    document.getElementById('closeRequestDetailBtn').addEventListener('click', () =>
        closeModal(document.getElementById('requestDetailModal'))
    );

    const renderRequestRow = (r) => {
        const tbody  = document.getElementById('requests-table-body');
        const tr     = tbody.insertRow();
        const status = r.status || 'Nuevo';
        const dateStr = r.timestamp ? new Date(r.timestamp.seconds * 1000).toLocaleDateString('es-PE') : '-';
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${esc(r.fullName) || '-'}</td><td>${esc(r.email) || '-'}</td>
            <td>${esc(r.eventType || r.subject || r.quoteContext) || '-'}</td>
            <td>
                <select class="status-select req-status" data-id="${r.id}">
                    ${REQUEST_STATUSES.map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
            </td>
            <td class="action-buttons">
                <button class="btn btn-sm btn-approve btn-req-quote" title="Crear cotización"><i class="fas fa-file-invoice-dollar"></i> Cotizar</button>
                <button class="btn btn-secondary btn-sm btn-req-view" title="Ver detalle"><i class="fas fa-eye"></i></button>
                <button class="btn btn-secondary btn-sm btn-req-mail" title="Responder por correo"><i class="fas fa-envelope"></i></button>
                <button class="btn btn-secondary btn-sm btn-req-wa" title="Responder por WhatsApp" ${r.phone ? '' : 'disabled'}><i class="fab fa-whatsapp"></i></button>
                <button class="btn btn-danger btn-sm btn-delete" title="Eliminar"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tr.querySelector('.req-status').addEventListener('change', async (e) => {
            await updateDoc(doc(db, dbPath(`service_requests/${e.target.dataset.id}`)), { status: e.target.value });
            showToast('Estado de la solicitud actualizado.', 'success');
        });
        tr.querySelector('.btn-req-quote').addEventListener('click', () => openQuoteEditor(quoteFromRequest(r)));
        tr.querySelector('.btn-req-view').addEventListener('click', () => openRequestDetail(r));
        tr.querySelector('.btn-req-mail').addEventListener('click', () => { window.open(buildGmailCompose(r), '_blank'); markRequestResponded(r); });
        tr.querySelector('.btn-req-wa').addEventListener('click', () => { const u = buildWa(r); if (u) { window.open(u, '_blank'); markRequestResponded(r); } });
        tr.querySelector('.btn-delete').addEventListener('click', () =>
            confirmDelete('¿Eliminar esta solicitud?', () => deleteItem('service_requests', r.id))
        );
    };

    // Filtros por estado y rango de fechas (se combinan con la búsqueda de texto)
    let _requestsRaw = [];
    const applyRequestFilters = () => {
        const status = document.getElementById('filter-request-status')?.value || '';
        const from   = document.getElementById('filter-request-from')?.value || '';
        const to     = document.getElementById('filter-request-to')?.value || '';
        let data = [..._requestsRaw];
        if (status) data = data.filter(r => (r.status || 'Nuevo') === status);
        if (from)   { const f = new Date(`${from}T00:00:00`).getTime() / 1000; data = data.filter(r => (r.timestamp?.seconds ?? 0) >= f); }
        if (to)     { const t = new Date(`${to}T23:59:59`).getTime() / 1000;   data = data.filter(r => (r.timestamp?.seconds ?? 0) <= t); }
        if (pState.requests) { pState.requests.data = data; pState.requests.page = 1; }
        renderPaged('requests', renderRequestRow, 'No hay solicitudes que coincidan.');
    };

    ['filter-request-status', 'filter-request-from', 'filter-request-to'].forEach(id =>
        document.getElementById(id)?.addEventListener('change', applyRequestFilters));
    document.getElementById('clear-request-filters')?.addEventListener('click', () => {
        document.getElementById('filter-request-status').value = '';
        document.getElementById('filter-request-from').value   = '';
        document.getElementById('filter-request-to').value     = '';
        const search = document.getElementById('search-requests');
        if (search) search.value = '';
        if (pState.requests) pState.requests.term = '';
        applyRequestFilters();
    });

    const loadRequests = () => {
        document.getElementById('requests-table-body').innerHTML =
            `<tr><td colspan="6" class="spinner-cell"><div class="spinner"></div></td></tr>`;
        unsubscribeListeners.requests = onSnapshot(collection(db, dbPath('service_requests')), (snap) => {
            _requestsRaw = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0));
            applyRequestFilters();
        });
        loadQuotes();
    };


    // ══════════════════════════════════════════════════════════
    // CONFIG & ANUNCIOS (incluye WhatsApp)
    // ══════════════════════════════════════════════════════════
    const loadAnnouncements = () => {
        unsubscribeListeners.announcements = onSnapshot(
            doc(db, dbPath('config/announceBar')), (snap) => {
                if (!snap.exists()) return;
                const d = snap.data();
                document.getElementById('announceInicio').value    = d.inicio    || '';
                document.getElementById('announceCursos').value    = d.cursos    || '';
                document.getElementById('announceServicios').value = d.servicios || '';
                document.getElementById('announceNosotros').value  = d.nosotros  || '';
                document.getElementById('announceLogin').value     = d.login     || '';
                document.getElementById('announceDashboard').value = d.dashboard || '';
                document.getElementById('configWhatsapp').value    = d.whatsapp  || '';
                document.getElementById('onboardingTitle').value    = d.onboardingTitle    || '';
                document.getElementById('onboardingText').value     = d.onboardingText     || '';
                document.getElementById('onboardingVideoUrl').value = d.onboardingVideoUrl  || '';
            }
        );
    };

    document.getElementById('announceBarForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('announceFormMessage');
        showMsg(msg, 'Guardando…', 'loading');
        try {
            await setDoc(doc(db, dbPath('config/announceBar')), {
                inicio:    document.getElementById('announceInicio').value,
                cursos:    document.getElementById('announceCursos').value,
                servicios: document.getElementById('announceServicios').value,
                nosotros:  document.getElementById('announceNosotros').value,
                login:     document.getElementById('announceLogin').value,
                dashboard: document.getElementById('announceDashboard').value,
                lastUpdated: new Date()
            }, { merge: true });
            showMsg(msg, 'Anuncios guardados.', 'success');
            showToast('Anuncios actualizados correctamente.', 'success');
            setTimeout(() => showMsg(msg, '', ''), 3000);
        } catch (err) {
            showMsg(msg, 'Error al guardar. Revisa tu conexión.', 'error');
        }
    });

    document.getElementById('whatsappForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg    = document.getElementById('whatsappFormMessage');
        const number = document.getElementById('configWhatsapp').value.trim();
        if (!number) { showMsg(msg, 'Ingresa un número válido.', 'error'); return; }
        showMsg(msg, 'Guardando…', 'loading');
        try {
            await setDoc(doc(db, dbPath('config/announceBar')), { whatsapp: number }, { merge: true });
            showMsg(msg, `Número guardado: +${number}`, 'success');
            showToast(`WhatsApp actualizado: +${number}`, 'success');
            setTimeout(() => showMsg(msg, '', ''), 3000);
        } catch (err) { showMsg(msg, 'Error al guardar.', 'error'); }
    });

    document.getElementById('onboardingForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('onboardingFormMessage');
        showMsg(msg, 'Guardando…', 'loading');
        try {
            await setDoc(doc(db, dbPath('config/announceBar')), {
                onboardingTitle:    document.getElementById('onboardingTitle').value.trim(),
                onboardingText:     document.getElementById('onboardingText').value.trim(),
                onboardingVideoUrl: document.getElementById('onboardingVideoUrl').value.trim()
            }, { merge: true });
            showMsg(msg, 'Bienvenida guardada.', 'success');
            showToast('Bienvenida del alumno actualizada.', 'success');
            setTimeout(() => showMsg(msg, '', ''), 3000);
        } catch (err) { showMsg(msg, 'Error al guardar.', 'error'); }
    });


    // ══════════════════════════════════════════════════════════
    // REFERIDOS & MARKETING
    // ══════════════════════════════════════════════════════════
    let _refRows  = [];
    let _refNames = {};   // código → nombre del referidor

    const renderReferralsSummary = () => {
        const tbody = document.getElementById('referrals-summary-body');
        const groups = {};
        _refRows.forEach(r => {
            const k = r.referrerCode || '—';
            groups[k] = groups[k] || { count: 0, total: 0 };
            groups[k].count++;
            groups[k].total += (+r.amount || 0);
        });
        const keys = Object.keys(groups).sort((a, b) => groups[b].count - groups[a].count);
        tbody.innerHTML = keys.length
            ? keys.map(k => `
                <tr>
                    <td><code style="color:#ffc107;">${k}</code></td>
                    <td>${_refNames[k] || '—'}</td>
                    <td>${groups[k].count}</td>
                    <td>S/ ${groups[k].total.toFixed(2)}</td>
                </tr>`).join('')
            : `<tr><td colspan="4" class="empty-msg">Aún no hay referidos registrados.</td></tr>`;
    };

    const renderReferralsList = () => {
        const tbody = document.getElementById('referrals-list-body');
        if (!_refRows.length) { tbody.innerHTML = `<tr><td colspan="5" class="empty-msg">Sin registros.</td></tr>`; return; }
        tbody.innerHTML = '';
        [..._refRows].sort((a, b) => (b.date?.seconds ?? 0) - (a.date?.seconds ?? 0)).forEach(r => {
            const tr = tbody.insertRow();
            const dateStr = r.date ? new Date(r.date.seconds * 1000).toLocaleDateString('es-PE') : '-';
            tr.innerHTML = `
                <td>${dateStr}</td>
                <td><code style="color:#ffc107;">${r.referrerCode || '—'}</code></td>
                <td>${r.newStudentName || '—'}</td>
                <td>S/ ${(+r.amount || 0).toFixed(2)}</td>
                <td class="action-buttons"><button class="btn btn-danger btn-sm btn-del-ref" data-id="${r.id}"><i class="fas fa-trash"></i></button></td>`;
            tr.querySelector('.btn-del-ref').addEventListener('click', () =>
                confirmDelete('¿Eliminar este referido?', () => deleteItem('referrals', r.id)));
        });
    };

    const loadReferrals = async () => {
        _refNames = {};
        try {
            const es = await getDocs(collection(db, dbPath('course_enrollments')));
            es.forEach(d => { const e = d.data(); if (e.studentCode) _refNames[e.studentCode] = e.fullName; });
        } catch { /* ignora */ }
        unsubscribeListeners.referrals = onSnapshot(collection(db, dbPath('referrals')), (snap) => {
            _refRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderReferralsSummary();
            renderReferralsList();
        });
    };

    document.getElementById('referralForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('referralFormMessage');
        const referrerCode   = document.getElementById('refReferrerCode').value.trim().toUpperCase();
        const newStudentName = document.getElementById('refNewStudent').value.trim();
        const amount         = parseFloat(document.getElementById('refAmount').value) || 0;
        if (!referrerCode || !newStudentName) { showMsg(msg, 'Completa el código y el nombre.', 'error'); return; }
        showMsg(msg, 'Guardando…', 'loading');
        try {
            await addDoc(collection(db, dbPath('referrals')), { referrerCode, newStudentName, amount, date: new Date() });
            document.getElementById('referralForm').reset();
            showMsg(msg, 'Referido registrado.', 'success');
            showToast('Referido registrado.', 'success');
            setTimeout(() => showMsg(msg, '', ''), 2500);
        } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
    });


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

    // ══════════════════════════════════════════════════════════
    // VISOR DE IMÁGENES (constancias y evidencias en Base64)
    // El navegador bloquea abrir una imagen Base64 en pestaña nueva,
    // así que se muestran en un modal.
    // ══════════════════════════════════════════════════════════
    const viewImage = (src) => {
        document.getElementById('imageViewImg').src = src;
        openModal(document.getElementById('imageViewModal'));
    };
    document.getElementById('closeImageViewBtn').addEventListener('click', () =>
        closeModal(document.getElementById('imageViewModal'))
    );

    // ══════════════════════════════════════════════════════════
    // CAMPUS VIRTUAL — ALUMNOS
    // Estados: pending → active → suspended. Suspender nunca borra
    // el progreso; eliminar es definitivo y solo para no activos.
    // ══════════════════════════════════════════════════════════
    const STUDENT_STATUS = {
        pending:   { label: 'Inscrito',    badge: 'badge-warning' },
        active:    { label: 'Matriculado', badge: 'badge-success' },
        suspended: { label: 'Suspendido', badge: 'badge-danger'  }
    };
    const statusOf = (s) => (STUDENT_STATUS[s.status] ? s.status : 'pending');
    const lower    = (v) => (v || '').trim().toLowerCase();
    const DAY_LABELS = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];   // valor = getDay()

    let _courses        = [];   // cursos (precio y duración sugieren el plan de pagos)
    let _students       = [];   // user_roles con role 'student'
    let _stuEnrollments = [];   // course_enrollments (para curso y aprobación)
    let _reported       = [];   // constancias de pago por revisar

    const enrollmentsOf = (s) => _stuEnrollments.filter(e => lower(e.email) === lower(s.email));
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
        const course = _courses.find(c => c.name === name) || {};
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

    const paymentsStudent = () => payCtx && _students.find(x => x.uid === payCtx.uid);

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
                    const refs = _stuEnrollments
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
        const hasVoucher = _reported.some(p => p.uid === s.uid);

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
            approveStudent(s, _reported.find(p => p.uid === s.uid) || null));
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
            b.querySelector('span').textContent = `(${_students.filter(x => inStudentTab(x, b.dataset.status)).length})`;
        });
        const mod = document.getElementById('filter-student-modality').value;
        const pay = document.getElementById('filter-student-pay').value;
        const payMatches = (s) => {
            if (!pay) return true;
            if (statusOf(s) === 'pending') return false;
            const state = billingSummary(s.billing).state;
            return pay === 'ok' ? ['next', 'complete'].includes(state) : state === pay;
        };
        pState.students.data = _students
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
        if (!_reported.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
        box.style.display = 'block';
        box.innerHTML = `<h3><i class="fas fa-file-invoice-dollar"></i> Constancias de pago por revisar (${_reported.length})</h3>
                         <div class="voucher-cards"></div>`;
        const cards = box.querySelector('.voucher-cards');

        _reported.forEach(p => {
            const student = _students.find(s => s.uid === p.uid);
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
                _reported = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
                const badge = document.getElementById('nav-students-badge');
                badge.textContent   = _reported.length;
                badge.style.display = _reported.length ? 'inline-flex' : 'none';
                if (document.getElementById('students-management').style.display === 'block') {
                    renderVoucherQueue();
                    applyStudentFilters();
                }
                renderDaily();
            }
        );
    };

    const loadStudents = () => {
        document.getElementById('students-table-body').innerHTML =
            `<tr><td colspan="7" class="spinner-cell"><div class="spinner"></div></td></tr>`;
        getDocs(collection(db, dbPath('courses')))
            .then(snap => { _courses = snap.docs.map(d => d.data()); })
            .catch(() => { /* sin cursos no hay plan sugerido; se escribe a mano */ });
        unsubscribeListeners.students = onSnapshot(
            query(collection(db, dbPath('user_roles')), where('role', '==', 'student')),
            (snap) => {
                _students = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
                    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
                renderVoucherQueue();
                applyStudentFilters();
                if (payCtx) renderPaymentsModal();
            }
        );
        unsubscribeListeners.studentEnrollments = onSnapshot(collection(db, dbPath('course_enrollments')), (snap) => {
            _stuEnrollments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            applyStudentFilters();
        });
    };

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
        const course = _courses.find(c => c.name === coursesOf(s)[0]);
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
        const actives = _students.filter(s => statusOf(s) === 'active');
        const pays    = actives.map(s => billingSummary(s.billing).state);
        const count   = (state) => pays.filter(p => p === state).length;
        const alerts  = [
            [_reported.length,   'warn',   'constancias de pago por revisar', 'students'],
            [count('overdue'),   'danger', 'pagos vencidos',                  'students'],
            [count('soon'),      'warn',   'pagos vencen en 7 días o menos',  'students'],
            [actives.filter(s => absenceStreak(s.attendanceLog, toYmd(new Date())) >= 3).length,
                                 'danger', 'alumnos con 3 o más faltas seguidas', null],
            [_toGrade,           'warn',   'entregas de tareas por calificar', 'tasks'],
            [_students.filter(s => inStudentTab(s, 'pending')).length,
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

        const actives = _students.filter(s => statusOf(s) === 'active');
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
            const s = _students.find(x => x.uid === uid);
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
                const s = _students.find(x => x.uid === uid);
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
            _students.forEach(s => {
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
                _students = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
                    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
                renderDaily();
            }
        );
        unsubscribeListeners.dailyEnrollments = onSnapshot(collection(db, dbPath('course_enrollments')), (snap) => {
            _stuEnrollments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderDaily();
        });
        unsubscribeListeners.dailyCourses = onSnapshot(collection(db, dbPath('courses')), (snap) => {
            _courses = snap.docs.map(d => d.data());
            renderDaily();
        });
        getCountFromServer(query(collection(db, dbPath('task_submissions')), where('status', '==', 'submitted')))
            .then(res => { _toGrade = res.data().count; renderDaily(); })
            .catch(() => { /* sin el conteo, el resto de la pantalla funciona igual */ });
    };

    // ══════════════════════════════════════════════════════════
    // COTIZACIONES DE EVENTOS — tarifario, editor e historial
    // Una cotización tiene dos bloques: "Tu evento" (lo que se cobra)
    // y "Puedes agregar" (otros juegos y extras, solo informativo).
    // El cliente la abre en /cotizacion?id=… y la descarga en PDF.
    // ══════════════════════════════════════════════════════════
    const SITE_URL = 'https://dealerclubpe.com';
    const QUOTE_STATUSES = ['Borrador', 'Enviada', 'Aceptada', 'Rechazada'];
    const ADJUSTMENT_PRESETS = [
        'Fecha de alta demanda',
        'Servicio express (menos de 48 h)',
        'Traslado y acceso',
        'Tarifa corporativa',
        'Descuento por más de una mesa (10 %)',
        'Descuento especial'
    ];
    const TARIFF_KINDS = [['mesa', 'Mesa'], ['incluido', 'Incluido'], ['extra', 'Extra']];
    const DEFAULT_QUOTE_SETTINGS = {
        advisor: 'Kevin', validityDays: 4, depositPct: 30, igvRate: 18, extraHour: 150,
        notes: 'Beneficio por confirmación rápida: si confirma su reserva dentro de las 48 h siguientes a esta cotización, se incluye el trofeo "The Chip Leader" para el ganador.\n' +
               'Si el acceso es solo por escaleras, se coordina un ajuste en "Traslado y acceso".',
        // Textos de la hoja que ve el cliente (editables en el Tarifario).
        tagline: 'Casino de Fantasía · EL JUEGO a otro nivel',
        balanceLabel: 'Saldo, antes de iniciar el montaje',
        payment: 'Transferencia bancaria a la cuenta de la empresa (se emite boleta o factura).\n' +
                 'Interbank Soles: 200-3008147025 · CCI: 003-200-003008147025-31\n' +
                 'Titular: DEALERCLUB E.I.R.L. · RUC 20615317315',
        legal: 'El cliente es responsable por daños, pérdida o deterioro del equipo durante el evento. ' +
               'Una vez abonado el adelanto no se realizan devoluciones.',
        footer: 'WhatsApp +51 929 610 747 · www.dealerclubpe.com\n' +
                'Lima Metropolitana · 09:00–18:00\n' +
                'IG dealerclubpe · TikTok @dealerclubpe · FB dealerclubperu',
        items: [
            { kind: 'mesa', name: 'Mesa de Ruleta Profesional', detail: 'Disco profesional premium · 7 a 10 posturas, con accesorios.', price: 1300 },
            { kind: 'mesa', name: 'Mesa en "D" Profesional',    detail: "Blackjack (7 posturas) o Ultimate Texas Hold'em (6 posturas), con accesorios.", price: 800 },
            { kind: 'mesa', name: 'Mesa óvalo Profesional',     detail: 'Póker (10 posturas) o Baccarat (9 posturas), con accesorios.', price: 1000 },
            { kind: 'incluido', name: 'Dealers uniformados',             detail: 'Un dealer profesional por mesa.', price: null },
            { kind: 'incluido', name: 'Dirección del propio DealerClub', detail: 'Presente en cada evento, desde una sola mesa.', price: null },
            { kind: 'incluido', name: 'Fichas, montaje y desmontaje',             detail: 'Fichas y artefactos de casino; armado y retiro de todo el equipo.', price: null },
            { kind: 'incluido', name: '3 h de evento · 2 h 30 de juego efectivo', detail: 'El montaje y el desmontaje no descuentan tiempo.', price: null },
            { kind: 'incluido', name: 'Traslado en Lima Metropolitana',           detail: 'Con acceso a nivel de calle o por ascensor.', price: null },
            { kind: 'extra', name: 'Sillas / taburetes',     detail: 'Las mesas no incluyen sillas.', price: null },
            { kind: 'extra', name: 'Hora extra de juego',    detail: 'Por mesa y por hora.', price: 150 },
            { kind: 'extra', name: 'Fichas personalizadas',  detail: 'Con el logo o motivo de su evento.', price: null },
            { kind: 'extra', name: 'Barman / mesero',        detail: '', price: null },
            { kind: 'extra', name: 'Fotos y grabación',      detail: '', price: null },
            { kind: 'extra', name: 'Decoración temática',    detail: '', price: null },
            { kind: 'extra', name: 'Cobertura fuera de Lima', detail: '', price: null }
        ]
    };
    let _qs     = DEFAULT_QUOTE_SETTINGS;   // tarifario vigente
    let _quotes = [];
    let qEdit   = null;                     // cotización abierta en el editor

    const money  = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    const numOrNull = (v) => (v === '' || v == null || Number.isNaN(+v) ? null : +v);

    // Suma N días hábiles (sin sábados ni domingos) a una fecha YYYY-MM-DD.
    const addBusinessDays = (ymd, n) => {
        const d = fromYmd(ymd);
        while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
        return toYmd(d);
    };

    // Subtotal = líneas con precio + ajustes. Adelanto redondeado a decenas.
    // Todo en soles enteros: sin céntimos. Adelanto redondeado a decenas.
    const quoteTotals = (q) => {
        const subtotal = (q.items || []).reduce((s, i) => s + (i.price || 0), 0)
                       + (q.adjustments || []).reduce((s, a) => s + (a.amount || 0), 0);
        const igv     = Math.round(subtotal * (q.igvRate ?? 18) / 100);
        const total   = subtotal + igv;
        const deposit = Math.ceil(total * (q.depositPct ?? 30) / 100 / 10) * 10;
        return { subtotal, igv, total, deposit, balance: total - deposit };
    };

    // Campo que solo admite números enteros: sin decimales, signos ni texto.
    const intInput = (value, placeholder = '') => {
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.className = 'qe-num';
        input.placeholder = placeholder;
        input.value = value ?? '';
        input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); });
        return input;
    };

    // ── Filas editables genéricas (líneas, ajustes, tarifario) ─
    // cols: [{ key, type: 'text' | 'number' | 'select', placeholder, options }]
    const renderRows = (boxId, rows, cols, layout, onChange, emptyMsg) => {
        const box = document.getElementById(boxId);
        box.innerHTML = rows.length ? '' : `<p class="qe-empty">${emptyMsg}</p>`;
        rows.forEach((row, idx) => {
            const el = document.createElement('div');
            el.className = `qe-row ${layout}`;
            cols.forEach(col => {
                let input;
                if (col.type === 'select') {
                    input = document.createElement('select');
                    col.options.forEach(([v, l]) => input.add(new Option(l, v, false, row[col.key] === v)));
                } else if (col.type === 'number') {
                    input = intInput(row[col.key], col.placeholder);
                } else {
                    input = document.createElement('input');
                    input.type = 'text';
                    input.placeholder = col.placeholder || '';
                    input.value = row[col.key] ?? '';
                }
                input.addEventListener('input', () => {
                    row[col.key] = col.type === 'number' ? numOrNull(input.value) : input.value;
                    onChange();
                });
                el.appendChild(input);
            });
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'qe-del';
            del.title = 'Quitar';
            del.innerHTML = '<i class="fas fa-times"></i>';
            del.addEventListener('click', () => {
                rows.splice(idx, 1);
                renderRows(boxId, rows, cols, layout, onChange, emptyMsg);
                onChange();
            });
            el.appendChild(del);
            box.appendChild(el);
        });
    };

    // ── Editor: lista fija del tarifario ──────────────────────
    // No se agregan ni quitan filas: cada mesa y cada extra del tarifario
    // tiene su fila y solo se escribe la cantidad. Lo que queda en cero
    // pasa solo al bloque "Puedes agregar" de la hoja.
    const AUTO_DISCOUNT = 'Descuento por más de una mesa (10 %)';
    const ADJ_ROWS = [
        { name: 'Fecha de alta demanda',            sign:  1 },
        { name: 'Servicio express (menos de 48 h)', sign:  1 },
        { name: 'Traslado y acceso',                sign:  1 },
        { name: 'Tarifa corporativa',               sign:  1 },
        { name: AUTO_DISCOUNT,                      sign: -1 },
        { name: 'Descuento especial',               sign: -1 }
    ];
    // Juegos posibles de cada mesa (paños intercambiables).
    const gamesOf = (mesaName) =>
        /ruleta/i.test(mesaName)        ? []
        : /"d"|en d\b/i.test(mesaName)  ? ['Blackjack', "Ultimate Texas Hold'em"]
        : /[oó]valo/i.test(mesaName)    ? ['Póker', 'Baccarat']
        : null;   // mesa nueva del tarifario: juego en texto libre
    // "Dealers" se cuenta por mesa; la dirección de DealerClub solo se incluye o no.
    const isPerMesa = (name) => /dealer/i.test(name) && !/direcci[oó]n/i.test(name);

    const tariffForm = () => ({
        mesas:    _qs.items.filter(i => i.kind === 'mesa').map(i => ({ name: i.name, detail: i.detail, game: '', qty: 0, unit: i.price })),
        includes: _qs.items.filter(i => i.kind === 'incluido').map(i => ({ name: i.name, detail: i.detail, on: true })),
        extras:   _qs.items.filter(i => i.kind === 'extra').map(i => ({ name: i.name, detail: i.detail, qty: 0, unit: i.price })),
        other:    { name: '', qty: 1, unit: null },
        adj:      ADJ_ROWS.map(a => ({ ...a, amount: null })),
        autoDiscount: false,
        showAddons:   true
    });

    const totalMesas = (f) => f.mesas.reduce((s, m) => s + (m.qty || 0), 0);
    // 10 % de la mesa de menor precio, cuando se llevan dos o más.
    const autoDiscountAmount = (f) => {
        const units = f.mesas.flatMap(m => Array(m.qty || 0).fill(m.unit || 0)).sort((a, b) => a - b);
        return units.length >= 2 ? Math.round(units[0] * 0.10) : 0;
    };
    const lineAmount = (x) => (x.unit != null ? (x.qty || 0) * x.unit : null);

    // Del formulario a lo que se guarda y ve el cliente.
    const deriveQuote = (f) => {
        const n = totalMesas(f);
        const line = (x, detail) => ({ name: x.name, detail, qty: x.qty, unit: x.unit, price: lineAmount(x), included: false });
        const items = [
            ...f.mesas.filter(m => m.qty > 0).map(m => line(m, m.game ? `Juego: ${m.game}` : m.detail)),
            ...f.includes.filter(i => i.on).map(i => ({
                name: i.name, detail: i.detail, qty: isPerMesa(i.name) ? n : null, unit: null, price: null, included: true })),
            ...f.extras.filter(x => x.qty > 0).map(x => line(x, x.detail)),
            ...(f.other.name.trim() ? [line({ ...f.other, name: f.other.name.trim(), qty: f.other.qty || 1 }, '')] : [])
        ];
        const adjustments = f.adj
            .map(a => ({ name: a.name, amount: a.sign * (a.name === AUTO_DISCOUNT && f.autoDiscount ? autoDiscountAmount(f) : (a.amount || 0)) }))
            .filter(a => a.amount);
        const addons = f.showAddons
            ? [...f.mesas.filter(m => !m.qty), ...f.extras.filter(x => !x.qty)].map(x => ({ name: x.name, detail: x.detail, price: x.unit }))
            : [];
        return { items, adjustments, addons };
    };

    // Lo que depende de otros campos (importes, dealers, descuento, totales)
    // se refresca sin redibujar las filas, para no perder el cursor.
    let qRefreshers = [];
    const refreshQuote = () => {
        qRefreshers.forEach(fn => fn());
        const f = qEdit.form;
        const t = quoteTotals({ ...deriveQuote(f), igvRate: qEdit.igvRate, depositPct: qEdit.depositPct });
        document.getElementById('quoteTotals').innerHTML = `
            <div><span>Subtotal</span><b>${money(t.subtotal)}</b></div>
            <div><span>IGV ${qEdit.igvRate}%</span><b>${money(t.igv)}</b></div>
            <div class="qe-total"><span>Total</span><b>${money(t.total)}</b></div>
            <div><span>Adelanto ${qEdit.depositPct}%</span><b>${money(t.deposit)}</b></div>
            <div><span>Saldo al llegar</span><b>${money(t.balance)}</b></div>`;
    };

    const intOrNull = (v) => (v === '' ? null : parseInt(v, 10));
    const el = (tag, cls, text) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    };

    // Fila "cantidad · nombre · [juego] · precio unitario · importe"
    const quoteLine = (x, { extra = false, nameInput = false } = {}) => {
        const row = el('div', `qe-line${extra ? ' qe-line-extra' : ''}`);
        const qty = intInput(x.qty || '', '0');
        qty.classList.add('qe-qty');
        qty.addEventListener('input', () => { x.qty = intOrNull(qty.value) || 0; refreshQuote(); });
        row.appendChild(qty);

        if (nameInput) {
            const name = document.createElement('input');
            name.type = 'text';
            name.placeholder = 'Otro concepto (opcional)';
            name.value = x.name;
            name.addEventListener('input', () => { x.name = name.value; refreshQuote(); });
            row.appendChild(name);
        } else {
            const name = el('span', 'qe-name', x.name);
            name.title = x.detail || x.name;
            row.appendChild(name);
        }

        if (!extra) {
            const games = gamesOf(x.name);
            if (games === null) {
                const game = document.createElement('input');
                game.type = 'text';
                game.placeholder = 'Juego';
                game.value = x.game;
                game.addEventListener('input', () => { x.game = game.value; });
                row.appendChild(game);
            } else if (games.length) {
                const game = document.createElement('select');
                game.add(new Option('Juego por definir', ''));
                games.forEach(g => game.add(new Option(g, g, false, x.game === g)));
                game.addEventListener('change', () => { x.game = game.value; });
                row.appendChild(game);
            } else {
                row.appendChild(el('span', 'qe-amount muted', '—'));
            }
        }

        const unit = intInput(x.unit, extra ? 'A cotizar' : 'S/');
        unit.addEventListener('input', () => { x.unit = intOrNull(unit.value); refreshQuote(); });
        row.appendChild(unit);

        const amount = el('span', 'qe-amount');
        row.appendChild(amount);
        qRefreshers.push(() => {
            const on = nameInput ? !!x.name.trim() : x.qty > 0;
            row.classList.toggle('on', on);
            const a = lineAmount(nameInput ? { ...x, qty: x.qty || 1 } : x);
            amount.textContent = !on ? '—' : a != null ? money(a) : 'A cotizar';
            amount.classList.toggle('muted', !on);
        });
        return row;
    };

    const renderQuoteForm = () => {
        const f = qEdit.form;
        qRefreshers = [];

        const mesas = document.getElementById('quoteMesas');
        mesas.replaceChildren(...f.mesas.map(m => quoteLine(m)));

        // Incluye: casillas; los dealers muestran cuántos van (uno por mesa)
        const inc = document.getElementById('quoteIncludes');
        inc.replaceChildren(...f.includes.map(i => {
            const chip  = el('label', 'qe-chip');
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.checked = i.on;
            const text = el('span');
            check.addEventListener('change', () => { i.on = check.checked; refreshQuote(); });
            chip.append(check, text);
            qRefreshers.push(() => {
                chip.classList.toggle('on', i.on);
                text.textContent = isPerMesa(i.name) ? `${i.name} (${totalMesas(f)})` : i.name;
            });
            return chip;
        }));

        const extras = document.getElementById('quoteExtras');
        extras.replaceChildren(
            ...f.extras.map(x => quoteLine(x, { extra: true })),
            quoteLine(f.other, { extra: true, nameInput: true }));

        // Recargos (+) y descuentos (−): se escribe el monto en positivo
        const adj = document.getElementById('quoteAdj');
        adj.replaceChildren(...f.adj.map(a => {
            const row   = el('div', `qe-adj ${a.sign > 0 ? 'plus' : 'minus'}`);
            const label = el('span', '', a.name);
            const input = intInput(a.amount, 'S/');
            input.addEventListener('input', () => { a.amount = intOrNull(input.value); refreshQuote(); });
            if (a.name === AUTO_DISCOUNT) {
                const auto  = el('label', 'qe-auto');
                const check = document.createElement('input');
                check.type = 'checkbox';
                check.checked = f.autoDiscount;
                check.addEventListener('change', () => { f.autoDiscount = check.checked; refreshQuote(); });
                auto.append(check, 'calcular');
                label.appendChild(auto);
                qRefreshers.push(() => {
                    input.disabled = f.autoDiscount;
                    if (f.autoDiscount) input.value = autoDiscountAmount(f) || '';
                });
            }
            row.append(label, input);
            return row;
        }));

        const show = document.getElementById('quoteShowAddons');
        show.checked = f.showAddons;
        show.onchange = () => { f.showAddons = show.checked; };

        refreshQuote();
    };

    const nextQuoteNumber = () => {
        const year = new Date().getFullYear();
        const last = Math.max(0, ..._quotes
            .map(q => new RegExp(`^${year}-(\\d+)$`).exec(q.number || ''))
            .filter(Boolean).map(m => +m[1]));
        return `${year}-${String(last + 1).padStart(3, '0')}`;
    };

    const blankQuote = () => {
        const today = toYmd(new Date());
        return {
            id: null, requestId: null, status: 'Borrador',
            number: nextQuoteNumber(), date: today, validUntil: addBusinessDays(today, _qs.validityDays),
            advisor: _qs.advisor, igvRate: _qs.igvRate, depositPct: _qs.depositPct, extraHour: _qs.extraHour,
            client: { name: '', type: 'persona', doc: '', phone: '', email: '' },
            event:  { type: '', date: '', time: '', district: '', address: '', floor: '', guests: '' },
            form: tariffForm(), notes: _qs.notes
        };
    };

    // A partir de una solicitud de la web: datos del cliente y mesas pedidas.
    const quoteFromRequest = (r) => {
        const q = blankQuote();
        q.requestId = r.id;
        q.client = { name: r.fullName || '', type: /factura/i.test(r.receipt || '') ? 'empresa' : 'persona', doc: '', phone: r.phone || '', email: r.email || '' };
        q.event  = {
            type: r.eventType || '', date: r.eventDate || '', time: r.eventTime || '', district: r.district || '', address: '',
            floor: [r.floor, r.access].filter(Boolean).join(' · '), guests: r.guests || ''
        };
        // Cada juego pedido marca su mesa (cantidad 1) y, si es el primero, su juego.
        (r.tables || []).forEach(game => {
            const g = String(game).toLowerCase();
            const mesa = q.form.mesas.find(m =>
                /ruleta/.test(g)                        ? /ruleta/i.test(m.name)
                : /black|ultimate|texas|uth/.test(g)    ? /"d"|en d\b/i.test(m.name)
                : /p[oó]ker|poker|baccarat|bacar/.test(g) ? /[oó]valo/i.test(m.name)
                : false);
            if (!mesa) return;
            mesa.qty = 1;
            if (!mesa.game) mesa.game = (gamesOf(mesa.name) || []).find(x => g.includes(x.toLowerCase().slice(0, 5))) || '';
        });
        // Los extras que pidió quedan con cantidad 1 (precio por definir si no lo tiene).
        (r.extras || []).forEach(x => {
            const key   = String(x).toLowerCase().slice(0, 6);
            const extra = q.form.extras.find(e => e.name.toLowerCase().includes(key));
            if (extra) extra.qty = 1;
        });
        return q;
    };

    // Cotizaciones guardadas antes de la lista fija: se reconstruye el formulario por nombre.
    const formFromLegacy = (q) => {
        const f = tariffForm();
        (q.items || []).forEach(it => {
            const row = [...f.mesas, ...f.extras].find(x => x.name === it.name);
            if (row) { row.qty = it.qty || 1; if (it.price != null) row.unit = Math.round(it.price / row.qty); }
        });
        f.includes.forEach(i => { i.on = (q.items || []).some(it => it.name === i.name); });
        (q.adjustments || []).forEach(a => {
            const row = f.adj.find(x => x.name === a.name);
            if (row) row.amount = Math.abs(a.amount);
        });
        return f;
    };

    const openQuoteEditor = (q) => {
        qEdit = JSON.parse(JSON.stringify(q));   // copia: cancelar no altera el historial
        if (!qEdit.form) qEdit.form = formFromLegacy(qEdit);
        const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
        set('quoteNumber', qEdit.number);        set('quoteDate', qEdit.date);
        set('quoteValidUntil', qEdit.validUntil); set('quoteStatus', qEdit.status);
        set('quoteClientName', qEdit.client.name);   set('quoteClientType', qEdit.client.type);
        set('quoteClientDoc', qEdit.client.doc);     set('quoteClientPhone', qEdit.client.phone);
        set('quoteClientEmail', qEdit.client.email);
        set('quoteEventType', qEdit.event.type);     set('quoteEventDate', qEdit.event.date);
        set('quoteEventTime', qEdit.event.time);     set('quoteEventDistrict', qEdit.event.district);
        set('quoteEventAddress', qEdit.event.address); set('quoteEventFloor', qEdit.event.floor);
        set('quoteEventGuests', qEdit.event.guests);
        set('quoteNotes', qEdit.notes);
        renderQuoteForm();
        showMsg(document.getElementById('quoteFormMessage'), '', '');
        openModal(document.getElementById('quoteModal'));
    };

    // Lee el formulario, guarda y devuelve la cotización (o null si falta algo).
    const saveQuote = async () => {
        const msg = document.getElementById('quoteFormMessage');
        const val = (id) => document.getElementById(id).value.trim();
        if (!val('quoteClientName')) { showMsg(msg, 'Escribe el nombre del cliente.', 'error'); return null; }
        if (!totalMesas(qEdit.form)) { showMsg(msg, 'Indica la cantidad de al menos una mesa.', 'error'); return null; }

        const data = {
            number: val('quoteNumber'), date: val('quoteDate'), validUntil: val('quoteValidUntil'),
            status: val('quoteStatus'), advisor: qEdit.advisor,
            igvRate: qEdit.igvRate, depositPct: qEdit.depositPct, extraHour: qEdit.extraHour,
            requestId: qEdit.requestId || null,
            client: { name: val('quoteClientName'), type: val('quoteClientType'), doc: val('quoteClientDoc'),
                      phone: val('quoteClientPhone'), email: val('quoteClientEmail') },
            event:  { type: val('quoteEventType'), date: val('quoteEventDate'), time: val('quoteEventTime'),
                      district: val('quoteEventDistrict'), address: val('quoteEventAddress'),
                      floor: val('quoteEventFloor'), guests: val('quoteEventGuests') },
            form: qEdit.form,
            ...deriveQuote(qEdit.form),
            // Copia de los textos de la plantilla: la hoja pública no lee el tarifario.
            texts: { tagline: _qs.tagline, balanceLabel: _qs.balanceLabel, payment: _qs.payment, legal: _qs.legal, footer: _qs.footer },
            notes: val('quoteNotes'),
            updatedAt: new Date()
        };
        data.totals = quoteTotals(data);
        try {
            if (qEdit.id) {
                await updateDoc(doc(db, dbPath(`quotes/${qEdit.id}`)), data);
            } else {
                const ref = await addDoc(collection(db, dbPath('quotes')), { ...data, createdAt: new Date() });
                qEdit.id = ref.id;
            }
            Object.assign(qEdit, data);
            showMsg(msg, 'Cotización guardada.', 'success');
            return qEdit;
        } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); return null; }
    };

    const quoteUrl = (q) => `${SITE_URL}/cotizacion?id=${q.id}`;
    const quoteMessage = (q) =>
        `Hola ${q.client.name}, te comparto tu cotización N.° ${q.number} de Casino de Fantasía (DealerClub):\n${quoteUrl(q)}\n\n` +
        `Total: ${money(q.totals.total)} (incluye IGV). Para reservar tu fecha, el adelanto es de ${money(q.totals.deposit)}.\n` +
        `Válida hasta el ${fmtDate(q.validUntil)}. Quedo atento a cualquier consulta.`;

    // Marca como enviada (si seguía en borrador) y la solicitud de origen como respondida.
    const markQuoteSent = async (q) => {
        try {
            if (q.status === 'Borrador') {
                await updateDoc(doc(db, dbPath(`quotes/${q.id}`)), { status: 'Enviada', sentAt: new Date() });
                q.status = 'Enviada';
                if (qEdit && qEdit.id === q.id) document.getElementById('quoteStatus').value = 'Enviada';
            }
            if (q.requestId) {
                await updateDoc(doc(db, dbPath(`service_requests/${q.requestId}`)), { status: 'Respondido', respondedAt: new Date() });
            }
        } catch { /* el envío ya se abrió; el estado se puede corregir a mano */ }
    };

    // La ventana se abre en el mismo clic (si no, el navegador la bloquea)
    // y recibe la dirección cuando la cotización ya está guardada.
    const withSavedQuote = async (buildUrl, { markSent = false } = {}) => {
        const win = window.open('', '_blank');
        const q = await saveQuote();
        const url = q && buildUrl(q);
        if (!url) { win?.close(); return; }
        if (win) win.location = url; else window.location = url;
        if (markSent) markQuoteSent(q);
    };
    const quoteWaUrl = (q) => {
        const phone = (q.client.phone || '').replace(/\D/g, '');
        if (!phone) { showMsg(document.getElementById('quoteFormMessage'), 'Falta el WhatsApp del cliente.', 'error'); return ''; }
        return `${WA_PANEL_URL}?to=${phone.length === 9 ? `51${phone}` : phone}&msg=${encodeURIComponent(quoteMessage(q))}`;
    };
    const quoteMailUrl = (q) => {
        if (!q.client.email) { showMsg(document.getElementById('quoteFormMessage'), 'Falta el correo del cliente.', 'error'); return ''; }
        const params = new URLSearchParams({
            view: 'cm', fs: '1', to: q.client.email,
            su: `Cotización N.° ${q.number} — Casino de Fantasía DealerClub`,
            body: `${quoteMessage(q)}\n\nSaludos cordiales,\n${q.advisor || 'Equipo DealerClub'}\nDealerClub`
        });
        return `https://mail.google.com/mail/?authuser=${encodeURIComponent(COMPANY_EMAIL)}&${params.toString()}`;
    };

    document.getElementById('quoteForm').addEventListener('submit', (e) => { e.preventDefault(); saveQuote(); });
    document.getElementById('quoteViewBtn').addEventListener('click', () => withSavedQuote(quoteUrl));
    document.getElementById('quoteWaBtn').addEventListener('click', () => withSavedQuote(quoteWaUrl, { markSent: true }));
    document.getElementById('quoteMailBtn').addEventListener('click', () => withSavedQuote(quoteMailUrl, { markSent: true }));
    document.getElementById('closeQuoteModalBtn').addEventListener('click', () => closeModal(document.getElementById('quoteModal')));
    document.getElementById('new-quote-btn').addEventListener('click', () => openQuoteEditor(blankQuote()));

    // ── Historial ─────────────────────────────────────────────
    const renderQuoteRow = (q) => {
        const tr      = document.getElementById('quotes-table-body').insertRow();
        const expired = q.status === 'Enviada' && q.validUntil && q.validUntil < toYmd(new Date());
        tr.innerHTML = `
            <td><strong>${esc(q.number)}</strong></td>
            <td>${fmtDate(q.date)}</td>
            <td>${esc(q.client?.name)}<span class="student-sub">${esc(q.client?.phone)}</span></td>
            <td>${esc(q.event?.type) || '-'}<span class="student-sub">${q.event?.date ? fmtDate(q.event.date) : ''}${q.event?.district ? ` · ${esc(q.event.district)}` : ''}</span></td>
            <td><strong>${money(q.totals?.total)}</strong></td>
            <td>
                <select class="status-select quote-status">
                    ${QUOTE_STATUSES.map(s => `<option ${q.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
                ${expired ? '<span class="student-sub" style="color:#f1a7ae;">Vencida</span>' : ''}
            </td>
            <td class="action-buttons">
                <button class="btn btn-secondary btn-sm q-edit" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="btn btn-secondary btn-sm q-view" title="Ver hoja"><i class="fas fa-eye"></i></button>
                <button class="btn btn-secondary btn-sm q-copy" title="Duplicar como nueva"><i class="fas fa-copy"></i></button>
                <button class="btn btn-danger btn-sm q-del" title="Eliminar"><i class="fas fa-trash"></i></button>
            </td>`;
        tr.querySelector('.quote-status').addEventListener('change', async (e) => {
            await updateDoc(doc(db, dbPath(`quotes/${q.id}`)), { status: e.target.value });
            showToast('Estado de la cotización actualizado.', 'success');
        });
        tr.querySelector('.q-edit').addEventListener('click', () => openQuoteEditor(q));
        tr.querySelector('.q-view').addEventListener('click', () => window.open(quoteUrl(q), '_blank'));
        tr.querySelector('.q-copy').addEventListener('click', () => {
            const today = toYmd(new Date());
            openQuoteEditor({ ...q, id: null, status: 'Borrador', number: nextQuoteNumber(),
                              date: today, validUntil: addBusinessDays(today, _qs.validityDays) });
        });
        tr.querySelector('.q-del').addEventListener('click', () =>
            confirmDelete(`¿Eliminar la cotización N.° ${q.number} de "${q.client?.name || ''}"? Su enlace dejará de funcionar.`,
                () => deleteItem('quotes', q.id)));
    };
    const renderQuotesSummary = () => {
        const sum = (list) => list.reduce((s, q) => s + (q.totals?.total || 0), 0);
        const sent     = _quotes.filter(q => q.status !== 'Borrador');
        const accepted = _quotes.filter(q => q.status === 'Aceptada');
        document.getElementById('quotes-summary').innerHTML =
            `Cotizado: <b>${money(sum(sent))}</b> en ${sent.length} · Aceptado: <b>${money(sum(accepted))}</b> en ${accepted.length}`;
        document.getElementById('quotes-tab-count').textContent = `(${_quotes.length})`;
    };

    document.querySelectorAll('#quote-tabs .student-tab').forEach(btn =>
        btn.addEventListener('click', () => {
            document.querySelectorAll('#quote-tabs .student-tab').forEach(b => b.classList.toggle('active', b === btn));
            document.getElementById('requests-view').style.display = btn.dataset.view === 'requests' ? 'block' : 'none';
            document.getElementById('quotes-view').style.display   = btn.dataset.view === 'quotes'   ? 'block' : 'none';
        }));

    const loadQuotes = () => {
        unsubscribeListeners.quotes = onSnapshot(collection(db, dbPath('quotes')), (snap) => {
            _quotes = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.number || '').localeCompare(a.number || ''));
            pState.quotes.data = _quotes;
            renderPaged('quotes', renderQuoteRow, 'Aún no has emitido cotizaciones.');
            renderQuotesSummary();
        });
        unsubscribeListeners.quoteSettings = onSnapshot(doc(db, dbPath('quote_settings/main')), (snap) => {
            _qs = snap.exists() ? { ...DEFAULT_QUOTE_SETTINGS, ...snap.data() } : DEFAULT_QUOTE_SETTINGS;
            // Tarifarios guardados antes de separar dealers y dirección
            _qs.items = _qs.items.flatMap(i => /dealer.*direcci[oó]n/i.test(i.name)
                ? DEFAULT_QUOTE_SETTINGS.items.filter(d => /^Dealers uniformados|^Dirección del propio/.test(d.name))
                : [i]);
        });
    };

    // ── Tarifario ─────────────────────────────────────────────
    let tEdit = null;
    const TARIFF_COLS = [
        { key: 'kind',   type: 'select', options: TARIFF_KINDS },
        { key: 'name',   type: 'text',   placeholder: 'Nombre' },
        { key: 'detail', type: 'text',   placeholder: 'Detalle' },
        { key: 'price',  type: 'number', placeholder: 'S/' }
    ];
    const renderTariffRows = () =>
        renderRows('tariffItems', tEdit.items, TARIFF_COLS, 'cols-tariff', () => {}, 'El tarifario está vacío.');

    document.getElementById('open-tariff-btn').addEventListener('click', () => {
        tEdit = JSON.parse(JSON.stringify(_qs));
        document.getElementById('tariffAdvisor').value   = tEdit.advisor;
        document.getElementById('tariffValidity').value  = tEdit.validityDays;
        document.getElementById('tariffDeposit').value   = tEdit.depositPct;
        document.getElementById('tariffIgv').value       = tEdit.igvRate;
        document.getElementById('tariffExtraHour').value = tEdit.extraHour;
        document.getElementById('tariffNotes').value     = tEdit.notes;
        document.getElementById('tariffPayment').value   = tEdit.payment;
        document.getElementById('tariffLegal').value     = tEdit.legal;
        document.getElementById('tariffFooter').value    = tEdit.footer;
        document.getElementById('tariffTagline').value   = tEdit.tagline;
        document.getElementById('tariffBalance').value   = tEdit.balanceLabel;
        renderTariffRows();
        showMsg(document.getElementById('tariffFormMessage'), '', '');
        openModal(document.getElementById('tariffModal'));
    });
    document.getElementById('tariffAddItem').addEventListener('click', () => {
        tEdit.items.push({ kind: 'extra', name: '', detail: '', price: null });
        renderTariffRows();
    });
    document.getElementById('tariffForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('tariffFormMessage');
        const num = (id, fallback) => numOrNull(document.getElementById(id).value) ?? fallback;
        try {
            await setDoc(doc(db, dbPath('quote_settings/main')), {
                items:        tEdit.items.filter(i => (i.name || '').trim()),
                advisor:      document.getElementById('tariffAdvisor').value.trim(),
                validityDays: num('tariffValidity', 4),
                depositPct:   num('tariffDeposit', 30),
                igvRate:      num('tariffIgv', 18),
                extraHour:    num('tariffExtraHour', 150),
                notes:        document.getElementById('tariffNotes').value.trim(),
                payment:      document.getElementById('tariffPayment').value.trim(),
                legal:        document.getElementById('tariffLegal').value.trim(),
                footer:       document.getElementById('tariffFooter').value.trim(),
                tagline:      document.getElementById('tariffTagline').value.trim(),
                balanceLabel: document.getElementById('tariffBalance').value.trim(),
                updatedAt:    new Date()
            });
            closeModal(document.getElementById('tariffModal'));
            showToast('Tarifario guardado. Se aplicará a las cotizaciones nuevas.', 'success');
        } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
    });
    document.getElementById('closeTariffModalBtn').addEventListener('click', () => closeModal(document.getElementById('tariffModal')));

    // ══════════════════════════════════════════════════════════
    // BOT DE WHATSAPP — seguimiento, notas aprendidas e informes
    // El bot (Cloud Functions) lee bot_settings/main y guarda sus
    // informes semanales en bot_insights. Aquí Kevin los revisa y
    // decide qué sugerencia pasa a las notas: el bot no se cambia solo.
    // ══════════════════════════════════════════════════════════
    const BOT_DEFAULTS = { enabled: false, hours: 3, from: 9, to: 20 };
    let botLoaded = false;

    const saveBotSettings = async () => {
        const num = (id, fallback) => numOrNull(document.getElementById(id).value) ?? fallback;
        await setDoc(doc(db, dbPath('bot_settings/main')), {
            notes: document.getElementById('botNotes').value.trim(),
            followUp: {
                enabled: document.getElementById('botFollowEnabled').checked,
                hours:   num('botFollowHours', BOT_DEFAULTS.hours),
                from:    num('botFollowFrom', BOT_DEFAULTS.from),
                to:      num('botFollowTo', BOT_DEFAULTS.to)
            },
            updatedAt: new Date()
        }, { merge: true });
    };

    document.getElementById('botSettingsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('botSettingsMessage');
        try {
            await saveBotSettings();
            showMsg(msg, 'Guardado. El bot lo aplica en un minuto.', 'success');
        } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
    });

    const FUNNEL_LABELS = [
        ['conversaciones', 'conversaciones'], ['recibieronCatalogo', 'recibieron el catálogo'],
        ['respondieronTrasCatalogo', 'siguieron tras el catálogo'], ['quedaronEnSilencio', 'quedaron en silencio'],
        ['conSeguimiento', 'con seguimiento'], ['derivadosAHumano', 'derivados a ti']
    ];
    const INSIGHT_LISTS = [
        ['dondeSePierden', 'Dónde se pierden'], ['objeciones', 'Objeciones'],
        ['preguntasFrecuentes', 'Preguntas frecuentes'], ['erroresDelBot', 'Fallos del bot']
    ];

    const renderInsights = (list) => {
        const box = document.getElementById('bot-insights');
        if (!list.length) {
            box.innerHTML = '<p style="color:#888;">Aún no hay informes. El primero llega el lunes, o pulsa "Analizar chats ahora".</p>';
            return;
        }
        box.innerHTML = '';
        list.forEach(r => {
            const card = document.createElement('div');
            card.className = 'insight';
            const date = r.createdAt ? new Date(r.createdAt.seconds * 1000).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
            card.innerHTML = `
                <div class="insight-head"><b>${date}</b><span>Últimos ${r.days || 7} días</span></div>
                <div class="insight-funnel">${FUNNEL_LABELS.map(([k, l]) => `<span><b>${r.embudo?.[k] ?? 0}</b>${l}</span>`).join('')}</div>
                <p>${esc(r.resumen)}</p>
                ${INSIGHT_LISTS.filter(([k]) => (r[k] || []).length).map(([k, title]) =>
                    `<h4>${title}</h4><ul>${r[k].map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}
                ${(r.sugerencias || []).length ? '<h4>Sugerencias para el bot</h4><div class="insight-sug"></div>' : ''}`;
            const sugBox = card.querySelector('.insight-sug');
            (r.sugerencias || []).forEach(sg => {
                const row = document.createElement('div');
                row.className = 'insight-suggestion';
                row.innerHTML = `<div><strong>${esc(sg.titulo)}</strong><span>${esc(sg.nota)}</span></div>
                                 <button type="button" class="btn btn-secondary btn-sm"><i class="fas fa-plus"></i> A las notas</button>`;
                row.querySelector('button').addEventListener('click', async (evt) => {
                    const notes = document.getElementById('botNotes');
                    if (notes.value.includes(sg.nota)) { showToast('Esa nota ya está en el bot.', 'info'); return; }
                    notes.value = `${notes.value.trim()}${notes.value.trim() ? '\n' : ''}- ${sg.nota}`;
                    try {
                        await saveBotSettings();
                        evt.currentTarget.disabled = true;
                        showToast('Nota agregada al bot.', 'success');
                    } catch (err) { showToast(`Error: ${esc(err.message)}`, 'error'); }
                });
                sugBox.appendChild(row);
            });
            box.appendChild(card);
        });
    };

    document.getElementById('bot-analyze-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        showToast('Analizando los chats de los últimos 7 días… puede tardar un minuto.', 'info');
        try {
            const analyze = httpsCallable(getFunctions(auth.app, 'us-central1'), 'adminAnalyzeChats', { timeout: 130000 });
            const res = await analyze({ days: 7 });
            showToast(`Informe listo: ${res.data.conversaciones} conversaciones analizadas.`, 'success');
        } catch (err) { showToast(`No se pudo analizar: ${esc(err.message)}`, 'error'); }
        btn.disabled = false;
    });

    const loadBot = () => {
        unsubscribeListeners.botSettings = onSnapshot(doc(db, dbPath('bot_settings/main')), (snap) => {
            if (botLoaded) return;   // no pisa lo que estés escribiendo
            botLoaded = true;
            const d  = snap.exists() ? snap.data() : {};
            const fu = { ...BOT_DEFAULTS, ...(d.followUp || {}) };
            document.getElementById('botNotes').value           = d.notes || '';
            document.getElementById('botFollowEnabled').checked = fu.enabled;
            document.getElementById('botFollowHours').value     = fu.hours;
            document.getElementById('botFollowFrom').value      = fu.from;
            document.getElementById('botFollowTo').value        = fu.to;
        });
        unsubscribeListeners.botInsights = onSnapshot(collection(db, dbPath('bot_insights')), (snap) => {
            renderInsights(snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)).slice(0, 8));
        });
    };

}); // fin DOMContentLoaded
