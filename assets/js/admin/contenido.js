// ============================================================
// CONTENIDO DEL SITIO — cursos, profesores, egresados, dealers y juegos
// Lo que se muestra en las páginas públicas. Cada bloque es una tabla con su
// ventana para crear y editar.
// ============================================================

import { db, dbPath } from '../firebase.js';
import { compressImage } from '../image.js';
import { collection, addDoc, doc, updateDoc, onSnapshot, getDoc, setDoc, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { showToast, pState, renderPaged, openModal, closeModal, showMsg, confirmDelete, deleteItem, DAY_LABELS, guessClassDays, registerSection, unsubscribeListeners } from './core.js';
import { COMUNES_POR_DEFECTO } from '../cursos-comunes.js';

// ══════════════════════════════════════════════════════════
// CRUD: CURSOS
// Lo que se edita aquí es lo que muestran las tarjetas de /cursos y lo que
// lee el bot de WhatsApp (misma colección `courses`).
// ══════════════════════════════════════════════════════════
let cursosTodos = [];   // todos los cursos (sin filtro de búsqueda), ordenados

// Orden: si el lugar elegido ya lo tiene otro curso, INTERCAMBIAN posiciones
// (Bienvenidos 6 → 1 deja a Trotamundos en 6). Un curso nuevo se INSERTA en
// ese lugar y los siguientes bajan uno. Luego se renumera 1..n sin huecos ni
// repetidos. Devuelve los cambios {id: order} sin escribirlos.
const calcularOrden = (lista, id, destino, esNuevo) => {
    const n = lista.length + (esNuevo ? 1 : 0);
    destino = Math.min(Math.max(parseInt(destino, 10) || n, 1), n);
    const pos = new Map(lista.map(c => [c.id, Number(c.order) || 999]));
    const actual = esNuevo ? null : pos.get(id);
    const ocupante = lista.find(c => c.id !== id && pos.get(c.id) === destino);
    if (esNuevo) {
        lista.forEach(c => { if (pos.get(c.id) >= destino) pos.set(c.id, pos.get(c.id) + 1); });
    } else if (ocupante) {
        pos.set(ocupante.id, actual ?? n);
    }
    pos.set(id, destino);
    // Renumerar 1..n respetando lo decidido (en empates gana el que se movió).
    const ids = [...pos.keys()].sort((a, b) => (pos.get(a) - pos.get(b)) || (a === id ? -1 : b === id ? 1 : 0));
    const final = {};
    ids.forEach((cid, i) => { final[cid] = i + 1; });
    return final;
};

// Escribe en un solo paso el curso (si hay datos) y el nuevo orden de los demás.
const guardarConOrden = async (id, destino, datos) => {
    const esNuevo = !id;
    const ref = esNuevo ? doc(collection(db, dbPath('courses'))) : doc(db, dbPath(`courses/${id}`));
    const orden = calcularOrden(cursosTodos, ref.id, destino, esNuevo);
    const batch = writeBatch(db);
    if (datos) batch[esNuevo ? 'set' : 'update'](ref, { ...datos, order: orden[ref.id] });
    else batch.update(ref, { order: orden[ref.id] });
    cursosTodos.forEach(c => {
        if (c.id !== ref.id && Number(c.order) !== orden[c.id]) {
            batch.update(doc(db, dbPath(`courses/${c.id}`)), { order: orden[c.id] });
        }
    });
    await batch.commit();
    return orden[ref.id];
};

const lineas = (id) => document.getElementById(id).value.split('\n').map(s => s.trim()).filter(Boolean);

const renderCourseRow = (c) => {
    const tbody = document.getElementById('courses-table-body');
    const tr = tbody.insertRow();
    tr.innerHTML = `
        <td><input type="number" class="order-input" min="1" value="${c.order ?? ''}" title="Escribe la nueva posición: si la tenía otro curso, intercambian lugares" style="width:58px"></td>
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
    tr.querySelector('.order-input').addEventListener('change', async (e) => {
        const antes = c.order;
        try {
            const final = await guardarConOrden(c.id, e.target.value, null);
            showToast(final === Number(antes) ? 'El orden no cambió.' : `«${c.name}» quedó en la posición ${final}.`, 'success');
        } catch (err) {
            e.target.value = antes ?? '';
            showToast(`No se pudo cambiar el orden: ${err.message}`, 'error');
        }
    });
    tr.querySelector('.btn-edit').addEventListener('click', () => {
        const v = (id, val) => { document.getElementById(id).value = val ?? ''; };
        v('courseId', c.id);
        v('courseName', c.name);
        v('courseTag', c.tag);
        v('courseOrder', c.order);
        v('courseDescription', c.description);
        v('coursePrice', c.price);
        v('coursePriceNote', c.priceNote);
        v('courseSchedule', c.schedule);
        v('courseDuration', c.duration);
        v('courseGames', (c.gamesIncluded || []).join(', '));
        v('courseStatus', c.status);
        document.getElementById('courseIsNew').checked = !!c.isNew;
        v('courseGamesLabel', c.gamesLabel);
        v('courseCtaText', c.ctaText);
        v('courseCtaWhatsapp', c.ctaWhatsapp);
        v('courseBackRules', (c.backRules || []).join('\n'));
        v('courseBackWarning', c.backWarning);
        const k = c.combo || {};
        document.getElementById('courseComboOn').checked = !!c.combo;
        v('comboName', k.name); v('comboSwitchTitle', k.switchTitle); v('comboSwitchSub', k.switchSub);
        v('comboPrice', k.price); v('comboWasPrice', k.wasPrice); v('comboPriceNote', k.priceNote);
        v('comboAddLines', (k.addLines || []).join('\n'));
        v('comboBackRules', (k.backRules || []).join('\n'));
        v('comboBackWarning', k.backWarning);
        mostrarCombo();
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
            .sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));
        cursosTodos = data;
        pState.courses.data = data;
        renderPaged('courses', renderCourseRow, 'No hay cursos registrados.');
    });
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

const mostrarCombo = () => {
    document.getElementById('courseComboFields').style.display =
        document.getElementById('courseComboOn').checked ? '' : 'none';
};
document.getElementById('courseComboOn').addEventListener('change', mostrarCombo);

document.getElementById('add-course-btn').addEventListener('click', () => {
    document.getElementById('courseForm').reset();
    _courseDays = new Set([1, 2, 3, 4, 5]);
    renderCourseDays();
    document.getElementById('courseId').value = '';
    document.getElementById('courseOrder').value = cursosTodos.length + 1;   // al final, salvo que elijas otro lugar
    mostrarCombo();
    document.getElementById('modal-title-action').textContent = 'Añadir';
    openModal(document.getElementById('courseModal'));
});

document.getElementById('courseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('courseId').value;
    const val = (k) => document.getElementById(k).value.trim();
    // Campo opcional vacío: al editar se borra del documento; en un curso nuevo ni se escribe.
    const BORRAR = Symbol('borrar');
    const opcional = (valor) => (valor ? valor : BORRAR);
    const data = {
        name: val('courseName'),
        tag: val('courseTag'),
        description: val('courseDescription'),
        price: val('coursePrice'),
        priceNote: val('coursePriceNote'),
        schedule: val('courseSchedule'),
        duration: val('courseDuration'),
        gamesIncluded: document.getElementById('courseGames').value.split(',').map(g => g.trim()).filter(Boolean),
        status: document.getElementById('courseStatus').value,
        classDays: [..._courseDays].sort(),
        isNew: document.getElementById('courseIsNew').checked,
        gamesLabel: opcional(val('courseGamesLabel')),
        ctaText: opcional(val('courseCtaText')),
        ctaWhatsapp: opcional(val('courseCtaWhatsapp')),
        backRules: lineas('courseBackRules'),
        backWarning: opcional(val('courseBackWarning')),
        lastUpdated: new Date()
    };
    if (document.getElementById('courseComboOn').checked) {
        if (!val('comboName') || !val('comboPrice')) {
            showToast('El combo necesita al menos nombre y precio.', 'error');
            return;
        }
        data.combo = {
            name: val('comboName'), switchTitle: val('comboSwitchTitle'), switchSub: val('comboSwitchSub'),
            price: val('comboPrice'), wasPrice: val('comboWasPrice'), priceNote: val('comboPriceNote'),
            addLines: lineas('comboAddLines'), backRules: lineas('comboBackRules'),
            ...(val('comboBackWarning') ? { backWarning: val('comboBackWarning') } : {}),
        };
    } else {
        data.combo = BORRAR;
    }
    Object.keys(data).forEach(k => {
        if (data[k] === BORRAR) { if (id) data[k] = deleteField(); else delete data[k]; }
    });
    try {
        const pos = await guardarConOrden(id, document.getElementById('courseOrder').value, data);
        closeModal(document.getElementById('courseModal'));
        showToast(`${id ? 'Curso actualizado' : 'Curso añadido'} en la posición ${pos}.`, 'success');
    } catch (err) { showToast(`Error guardando curso: ${err.message}`, 'error'); }
});
document.getElementById('closeCourseModalBtn').addEventListener('click', () =>
    closeModal(document.getElementById('courseModal'))
);

// Condiciones comunes (reverso de todas las tarjetas) → config/cursos.comunes
document.getElementById('course-common-btn').addEventListener('click', async () => {
    const ta = document.getElementById('courseCommonText');
    ta.value = 'Cargando…';
    openModal(document.getElementById('courseCommonModal'));
    try {
        const snap = await getDoc(doc(db, dbPath('config/cursos')));
        const lista = snap.exists() && Array.isArray(snap.data().comunes) && snap.data().comunes.length
            ? snap.data().comunes : COMUNES_POR_DEFECTO;
        ta.value = lista.join('\n');
    } catch (err) { ta.value = COMUNES_POR_DEFECTO.join('\n'); }
});
document.getElementById('courseCommonForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const comunes = lineas('courseCommonText');
    if (!comunes.length) { showToast('Escribe al menos una condición.', 'error'); return; }
    try {
        await setDoc(doc(db, dbPath('config/cursos')), { comunes, updatedAt: new Date() }, { merge: true });
        closeModal(document.getElementById('courseCommonModal'));
        showToast('Condiciones comunes guardadas: ya se ven en /cursos.', 'success');
    } catch (err) { showToast(`No se pudo guardar: ${err.message}`, 'error'); }
});
document.getElementById('closeCourseCommonBtn').addEventListener('click', () =>
    closeModal(document.getElementById('courseCommonModal'))
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

registerSection('courses', { title: 'Gestión de Cursos', load: loadCourses, row: renderCourseRow, empty: 'No hay cursos registrados.' });
registerSection('professors', { title: 'Gestión de Profesores', load: loadProfessors, row: renderProfRow, empty: 'No hay profesores registrados.' });
registerSection('alumni', { title: 'Gestión de Egresados', load: loadAlumni, row: renderAlumniRow, empty: 'No hay egresados registrados.' });
registerSection('dealers', { title: 'Gestión de Dealers', load: loadDealers, row: renderDealerRow, empty: 'No hay dealers registrados.' });
registerSection('tables', { title: 'Juegos del Casino', load: loadTables, row: renderTableRow, empty: 'No hay juegos registrados.' });
