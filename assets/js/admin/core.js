// ============================================================
// NÚCLEO DEL ADMIN — lo que comparten todas las secciones
// Avisos, tablas con buscador y páginas, ventanas, confirmación de
// borrado, navegación del menú y utilidades comunes.
// ============================================================

import { auth, db, dbPath } from '../firebase.js';
import { signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ── ESCAPE DE HTML ──────────────────────────────────────────
// Todo dato escrito por un visitante o alumno (nombres, correos,
// comentarios) pasa por aquí antes de insertarse en el panel.
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── SISTEMA DE NOTIFICACIONES TOAST ─────────────────────────
// Reemplaza todos los alert() con mensajes no bloqueantes.
export const showToast = (message, type = 'success') => {
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
export const pState = {};

export const renderPaged = (key, renderRowFn, emptyMsg = 'Sin resultados.') => {
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

export const initSearch = (key, renderRowFn, emptyMsg) => {
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

// ── UTILIDADES MODALES ───────────────────────────────────
export const openModal  = (modal) => { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; };
export const closeModal = (modal) => { modal.style.display = 'none'; document.body.style.overflow = 'auto'; };
export const showMsg    = (el, msg, type) => {
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
export const confirmModal = document.getElementById('confirmationModal');

export const confirmDelete = (message, callback) => {
    document.getElementById('confirmationMessage').textContent = message;
    deleteCallback = callback;
    showMsg(document.getElementById('deleteFormMessage'), '', '');
    openModal(confirmModal);
};

export const deleteItem = async (collectionName, itemId) => {
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

// ── SECCIONES ────────────────────────────────────────────────
// Cada archivo de sección se registra aquí con su título, la función
// que carga sus datos y, si tiene tabla con buscador, cómo dibuja una fila.
// El menú lateral llama a loadSection con el nombre del enlace (nav-…).
const sections = {};
const searches = [];
export const registerSearch = (key, row, empty) => searches.push([key, row, empty]);
export const registerSection = (name, { title, load, row, empty }) => {
    sections[name] = { title, load };
    if (row) registerSearch(name, row, empty);
};

// Escuchas de datos de la sección abierta; se cortan al cambiar de sección.
export const unsubscribeListeners = {};

export const loadSection = (sectionName) => {
    Object.keys(unsubscribeListeners).forEach(key => { unsubscribeListeners[key](); delete unsubscribeListeners[key]; });

    document.querySelectorAll('.admin-content .content-section').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));

    const section = document.getElementById(`${sectionName}-management`);
    const link    = document.getElementById(`nav-${sectionName}`);
    if (!section || !link) return;

    section.style.display = 'block';
    link.classList.add('active');

    document.getElementById('admin-main-title').textContent = sections[sectionName]?.title || sectionName;
    sections[sectionName]?.load();
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

// Arranque tras confirmar que quien entra es admin: prepara los
// buscadores de todas las tablas y abre la sección inicial.
export const startAdmin = (firstSection) => {
    searches.forEach(([key, row, empty]) => initSearch(key, row, empty));
    loadSection(firstSection);
};

// ── UTILIDADES COMPARTIDAS POR VARIAS SECCIONES ──────────────
export const DAY_LABELS = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];   // valor = getDay()
export const numOrNull = (v) => (v === '' || v == null || Number.isNaN(+v) ? null : +v);

// Días de clase del curso (0 = domingo … 6 = sábado). Si el curso aún
// no los tiene guardados, se deducen del texto del horario.
export const guessClassDays = (schedule) => {
    const t = (schedule || '').toLowerCase();
    if (/lunes a s[áa]bado/.test(t))  return [1, 2, 3, 4, 5, 6];
    if (/lunes a viernes/.test(t))    return [1, 2, 3, 4, 5];
    const days = [];
    if (/s[áa]bado/.test(t)) days.push(6);
    if (/domingo/.test(t))   days.push(0);
    return days;   // vacío = sin días fijos (p. ej. "Consultar")
};

// ── MARCAS DEL MENÚ ──────────────────────────────────────────
// Número rojo junto a una sección cuando hay algo por atender. Varias
// fuentes pueden sumar en la misma sección (Alumnos: constancias por
// revisar + registros nuevos); el detalle sale al pasar el cursor.
// Quien se apunte en onPendingChange (Trabajo del día) se redibuja con
// cada cambio, sin que una sección dependa de otra.
const navBadges = {};
export const onPendingChange = [];
export const navCount = (section, source) => navBadges[section]?.[source]?.count || 0;
export const setNavBadge = (section, source, count, label) => {
    (navBadges[section] ??= {})[source] = { count, label };
    const parts = Object.values(navBadges[section]).filter(p => p.count > 0);
    const badge = document.getElementById(`nav-${section}-badge`);
    if (badge) {
        badge.textContent   = parts.reduce((sum, p) => sum + p.count, 0);
        badge.title         = parts.map(p => `${p.count} ${p.label}`).join(' · ');
        badge.style.display = parts.length ? 'inline-flex' : 'none';
    }
    onPendingChange.forEach(fn => fn());
};

// ══════════════════════════════════════════════════════════
// VISOR DE IMÁGENES (constancias y evidencias en Base64)
// El navegador bloquea abrir una imagen Base64 en pestaña nueva,
// así que se muestran en un modal.
// ══════════════════════════════════════════════════════════
export const viewImage = (src) => {
    document.getElementById('imageViewImg').src = src;
    openModal(document.getElementById('imageViewModal'));
};
document.getElementById('closeImageViewBtn').addEventListener('click', () =>
    closeModal(document.getElementById('imageViewModal'))
);
