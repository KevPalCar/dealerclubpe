// ============================================================
// PANEL DE ADMINISTRACIÓN — DealerClub
// ============================================================
// Depende de firebase.js para la inicialización de Firebase.
// Nunca dupliques la config ni llames initializeApp aquí.
// ============================================================

import { auth, db, dbPath } from './firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    collection, addDoc, setDoc, doc, updateDoc, deleteDoc,
    onSnapshot, getDoc, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ── EMAILJS — notificaciones automáticas al aprobar inscripciones ──
// Credenciales del proyecto DealerClub en emailjs.com (cuenta gratuita, 200/mes).
// Si necesitas cambiar la plantilla o el servicio, actualiza solo estas 3 constantes.
import emailjs from 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/+esm';
const EJS_SERVICE  = 'service_w76xi5m';
const EJS_TEMPLATE = 'template_n6t2bx8';
emailjs.init('_S-T8AGnU-LZveZ7y');

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

// ── COMPRESIÓN DE IMAGEN (Canvas API) ───────────────────────
// Reduce imágenes de la PC antes de guardarlas en Firestore como
// Base64. Limita a 800px de ancho y 80% de calidad JPEG.
// Evita documentos de varios MB que degradan la carga.
const compressImage = (file, maxWidth = 800, quality = 0.8) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale  = Math.min(1, maxWidth / img.width);
                canvas.width  = Math.round(img.width  * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

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
                    loadSection('courses');
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
            enrollments: 'Inscripciones',          referrals: 'Referidos & Marketing',
            requests: 'Solicitudes de Contacto',   announcements: 'Config & Anuncios',
            materials: 'Material Didáctico',        tasks: 'Asignar Tareas',
            progress: 'Progreso de Alumnos'
        };
        document.getElementById('admin-main-title').textContent = titles[sectionName] || sectionName;

        const loaders = {
            courses: loadCourses,      professors: loadProfessors,
            alumni: loadAlumni,        dealers: loadDealers,
            tables: loadTables,        services: loadServices,
            enrollments: loadEnrollments,  referrals: loadReferrals,
            requests: loadRequests,    announcements: loadAnnouncements,
            materials: loadMaterials,  tasks: loadTasks,
            progress: loadProgress
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
        initSearch('enrollments', renderEnrollmentRow, 'No hay inscripciones.');
        initSearch('requests',    renderRequestRow,    'No hay solicitudes.');
        initSearch('materials',   renderMaterialRow,   'No hay materiales subidos aún.');
        initSearch('tasks',       renderTaskRow,       'No hay tareas asignadas.');
        initSearch('progress',    renderProgressRow,   'No hay alumnos registrados.');
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

    document.getElementById('add-course-btn').addEventListener('click', () => {
        document.getElementById('courseForm').reset();
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
    // INSCRIPCIONES
    // ══════════════════════════════════════════════════════════
    const renderEnrollmentRow = (e) => {
        const tbody = document.getElementById('enrollments-table-body');
        const tr = tbody.insertRow();

        const statusBadge = e.status === 'Aprobado'
            ? `<span class="badge badge-success">Aprobado</span><br>
               <small style="color:#ffc107; font-weight:bold;">Cód: ${e.studentCode || e.referralCode || 'N/A'}</small>`
            : `<span class="badge badge-warning">Pendiente</span>`;

        const voucherLink = e.voucherUrl
            ? `<a href="${e.voucherUrl}" target="_blank" style="color:#007bff;">Ver Comprobante</a>`
            : `<span style="color:#888;">Por WhatsApp</span>`;

        const approveBtn = e.status !== 'Aprobado'
            ? `<button class="btn btn-sm btn-approve"
                   data-id="${e.id}"
                   data-name="${e.fullName}"
                   data-email="${e.email || ''}"
                   data-course="${e.courseName || ''}"
                   data-code="${e.studentCode || ''}">
                   <i class="fas fa-check"></i> Aprobar
               </button>`
            : '';

        tr.innerHTML = `
            <td>${e.timestamp ? new Date(e.timestamp.seconds * 1000).toLocaleDateString('es-PE') : '-'}</td>
            <td><strong>${e.courseName || '-'}</strong></td>
            <td>${e.fullName || '-'}<br><small>${e.email || '-'}</small></td>
            <td>${e.phone || '-'}</td>
            <td>${voucherLink}</td>
            <td>${statusBadge}</td>
            <td class="action-buttons">
                ${approveBtn}
                <button class="btn btn-danger btn-sm btn-delete" data-id="${e.id}"><i class="fas fa-trash"></i></button>
            </td>
        `;

        // Aprobar: usa el studentCode generado durante el registro como código de referido.
        // Así un solo código sirve tanto para identificar al alumno como para referidos.
        tr.querySelector('.btn-approve')?.addEventListener('click', async (evt) => {
            const btn          = evt.currentTarget;
            const id           = btn.dataset.id;
            const name         = btn.dataset.name   || 'Estudiante';
            const email        = btn.dataset.email  || '';
            const course       = btn.dataset.course || 'Curso DealerClub';
            const existingCode = btn.dataset.code;

            // Reutiliza el studentCode existente o genera uno nuevo con formato DC-
            const referralCode = existingCode || (() => {
                const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                let code = '';
                for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
                return `DC-${new Date().getFullYear().toString().slice(-2)}${code}`;
            })();

            if (!confirm(`¿Confirmas el pago de ${name}?\nSe activará con código: ${referralCode}`)) return;

            try {
                // 1. Actualizar inscripción en Firestore
                await updateDoc(doc(db, dbPath(`course_enrollments/${id}`)), {
                    status: 'Aprobado', referralCode, approvedAt: new Date()
                });

                // 2. Activar user_roles si el alumno ya se registró con cuenta
                const userRolesSnap = await getDocs(
                    query(collection(db, dbPath('user_roles')), where('studentCode', '==', referralCode))
                );
                userRolesSnap.forEach(async (userDoc) => {
                    await updateDoc(doc(db, dbPath(`user_roles/${userDoc.id}`)), { status: 'active' });
                });

                showToast(`Inscripción de ${name} aprobada. Código: ${referralCode}`, 'success');

                // 3. Enviar email de confirmación al alumno vía EmailJS
                if (email) {
                    try {
                        await emailjs.send(EJS_SERVICE, EJS_TEMPLATE, {
                            to_name:      name,
                            to_email:     email,
                            course_name:  course,
                            student_code: referralCode
                        });
                        showToast(`Email de confirmación enviado a ${email}`, 'info');
                    } catch {
                        // El email falló pero la inscripción ya fue aprobada en Firestore
                        showToast('Inscripción aprobada, pero el email no se pudo enviar. Revisa EmailJS.', 'warning');
                    }
                }

            } catch (err) { showToast(`Error al aprobar: ${err.message}`, 'error'); }
        });

        tr.querySelector('.btn-delete').addEventListener('click', () =>
            confirmDelete(`¿Eliminar la inscripción de "${e.fullName}"?`, () => deleteItem('course_enrollments', e.id))
        );
    };

    const loadEnrollments = () => {
        document.getElementById('enrollments-table-body').innerHTML =
            `<tr><td colspan="7" class="spinner-cell"><div class="spinner"></div></td></tr>`;
        unsubscribeListeners.enrollments = onSnapshot(collection(db, dbPath('course_enrollments')), (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0));
            pState.enrollments.data = data;
            renderPaged('enrollments', renderEnrollmentRow, 'No hay inscripciones todavía.');
        });
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
            <p><strong>Nombre:</strong> ${r.fullName || '-'}</p>
            <p><strong>Email:</strong> <a href="mailto:${r.email || ''}">${r.email || '-'}</a></p>
            <p><strong>Teléfono:</strong> ${r.phone || '-'}</p>
            <p><strong>Tipo de evento:</strong> ${r.eventType || '-'}</p>
            <p><strong>Fecha del evento:</strong> ${r.eventDate || '-'}</p>
            ${r.quoteContext ? `<p><strong>Contexto:</strong> ${r.quoteContext}</p>` : ''}
            <p><strong>Recibido:</strong> ${date}</p>
            <p><strong>Estado:</strong> ${r.status || 'Nuevo'}</p>
            <p><strong>Detalle / Mensaje:</strong></p>
            <pre class="request-detail-msg">${r.details || r.message || '-'}</pre>
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
            <td>${r.fullName || '-'}</td><td>${r.email || '-'}</td>
            <td>${r.eventType || r.subject || r.quoteContext || '-'}</td>
            <td>
                <select class="status-select req-status" data-id="${r.id}">
                    ${REQUEST_STATUSES.map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
            </td>
            <td class="action-buttons">
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
                            ? `<a href="${s.imageUrl}" target="_blank" rel="noopener">Ver foto</a>`
                            : s.link ? `<a href="${s.link}" target="_blank" rel="noopener">${s.link}</a>`
                            : '<span style="color:#888;">Sin evidencia (marcada como hecha)</span>';
                        const card = document.createElement('div');
                        card.className = 'submission-card';
                        card.innerHTML = `
                            <div class="submission-head">
                                <strong>${s.studentName || s.studentCode || 'Alumno'}</strong>
                                <span class="sub-status ${s.status}">${s.status === 'reviewed' ? 'Revisada' : 'Entregada'}</span>
                            </div>
                            <p class="submission-ev">Evidencia: ${ev}</p>
                            <div class="submission-grade">
                                <input type="number" class="sub-grade" min="0" max="20" step="0.1" placeholder="/20" value="${s.grade ?? ''}">
                                <input type="text" class="sub-feedback" placeholder="Feedback para el alumno" value="${(s.feedback || '').replace(/"/g, '&quot;')}">
                                <button type="button" class="btn btn-primary btn-sm sub-save"><i class="fas fa-check"></i></button>
                            </div>
                        `;
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
            <td><code style="color:#ffc107;">${s.studentCode || '-'}</code></td>
            <td>${s.fullName || '-'}</td>
            <td>${s.email || '-'}</td>
            <td><span style="color:${levelColor}; font-weight:bold;">${s.level || 'Rookie'}</span></td>
            <td>${aPct  != null ? `${aPct}%`   : '--'}</td>
            <td>${grade != null ? `${grade}/20` : '--'}</td>
            <td class="action-buttons">
                <button class="btn btn-secondary btn-sm btn-edit" data-id="${s.uid}">
                    <i class="fas fa-edit"></i> Editar
                </button>
            </td>
        `;
        tr.querySelector('.btn-edit').addEventListener('click', () => {
            document.getElementById('progressStudentUid').value = s.uid;
            document.getElementById('progressStudentName').textContent = s.fullName || s.email || 'Alumno';
            document.getElementById('progressLevel').value     = s.level || 'Rookie';
            document.getElementById('progressStartDate').value = s.courseStartDate || '';

            // Asistencia: carga el registro y posiciona el calendario
            attEdit.log = { ...(s.attendanceLog || {}) };
            const base = s.courseStartDate ? new Date(`${s.courseStartDate}T00:00:00`) : new Date();
            attEdit.year  = base.getFullYear();
            attEdit.month = base.getMonth();
            renderAttCalendar();

            // Notas semanales
            document.getElementById('progressGradesList').innerHTML = '';
            (s.weeklyGrades || []).forEach(addGradeRow);

            openModal(document.getElementById('progressModal'));
        });
    };

    const loadProgress = () => {
        document.getElementById('progress-table-body').innerHTML =
            `<tr><td colspan="7" class="spinner-cell"><div class="spinner"></div></td></tr>`;
        unsubscribeListeners.progress = onSnapshot(
            query(collection(db, dbPath('user_roles')), where('role', '==', 'student')),
            (snap) => {
                const data = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
                    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
                pState.progress.data = data;
                renderPaged('progress', renderProgressRow, 'No hay alumnos registrados todavía.');
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

}); // fin DOMContentLoaded
