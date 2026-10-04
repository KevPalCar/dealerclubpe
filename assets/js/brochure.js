// ============================================================
// BROCHURES — /brochure-eventos y /brochure-escuela
// ============================================================
// Cada página es el diseño ORIGINAL del brochure (el mismo HTML con
// que se hizo el PDF). Este módulo solo:
//   1. aplica los cambios que el admin guardó (textos y fotos);
//   2. ajusta la hoja a pantallas angostas y permite "Descargar PDF";
//   3. con ?editar=1 y sesión de admin, deja editar sobre la propia
//      página: clic en un texto para escribir, clic en una foto para
//      cambiarla, y Guardar.
// Los cambios viven en Firestore (brochures/{tipo}) como parches
// sobre el diseño base; si el diseño base cambia de versión, los
// parches viejos se ignoran para no descuadrar nada.
// ============================================================

import { auth, db, dbPath } from './firebase.js';
import { compressImage } from './image.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc, deleteDoc, addDoc, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const tipo    = document.body.dataset.brochure;
const VERSION = document.body.dataset.version || '1';
const pages   = [...document.querySelectorAll('.page')];
const A4_W = 794, A4_H = 1123;   // 210 × 297 mm en px de pantalla

// ── Elementos editables ──────────────────────────────────────
// Texto: cada elemento con texto propio (no los contenedores).
// El orden en el documento da su clave (t0, t1…), estable mientras
// no cambie el diseño base.
const textEls = [];
const walk = (el) => {
    if (el.tagName.toLowerCase() === 'svg') return;
    const hasOwnText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (hasOwnText) { textEls.push(el); return; }
    [...el.children].forEach(walk);
};
pages.forEach(walk);
textEls.forEach((el, i) => { el.dataset.e = `t${i}`; el._base = el.innerHTML; });

// Fotos: todas menos logos, marca de agua y QR.
const imgEls = [...document.querySelectorAll('.page img')]
    .filter(img => !img.closest('.wm, .brand, .legal, .qrbox, .logo-lockup'));
imgEls.forEach((el, i) => { el.dataset.e = `i${i}`; });

// Solo se conserva el formato que usa el diseño (negritas, saltos, cursivas…).
const ALLOWED = new Set(['B', 'BR', 'EM', 'I', 'SMALL', 'SPAN', 'STRONG']);
const sanitize = (html) => {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const clean = (node) => {
        [...node.childNodes].forEach(child => {
            if (child.nodeType === 1) {
                if (!ALLOWED.has(child.tagName)) { child.replaceWith(document.createTextNode(child.textContent)); return; }
                [...child.attributes].forEach(a => { if (!['class', 'style'].includes(a.name)) child.removeAttribute(a.name); });
                clean(child);
            } else if (child.nodeType !== 3) child.remove();
        });
    };
    clean(tpl.content);
    return tpl.innerHTML;
};
// La base se compara ya normalizada, para detectar solo cambios reales.
textEls.forEach(el => { el._base = sanitize(el._base); });

const resolveImage = async (src) => {
    if (!src.startsWith('img:')) return src;
    const snap = await getDoc(doc(db, dbPath(`brochure_images/${src.slice(4)}`)));
    return snap.exists() ? snap.data().data : null;
};

// ── 1. Cambios guardados por el admin ────────────────────────
const applyOverrides = async () => {
    try {
        // Si la base tarda, no se deja al visitante esperando: se queda el diseño base.
        const snap = await Promise.race([
            getDoc(doc(db, dbPath(`brochures/${tipo}`))),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500))
        ]);
        if (!snap.exists() || String(snap.data().version) !== VERSION) return;
        const { texts = {}, images = {} } = snap.data();
        textEls.forEach(el => { if (texts[el.dataset.e] != null) el.innerHTML = sanitize(texts[el.dataset.e]); });
        await Promise.all(imgEls.map(async (el) => {
            const src = images[el.dataset.e];
            if (!src) return;
            const url = await resolveImage(src);
            if (url) { el.src = url; el.dataset.saved = src; }
        }));
    } catch { /* sin conexión o sin cambios: se muestra el diseño base */ }
};

// ── 2. Ajuste a pantalla y PDF ───────────────────────────────
const fit = () => document.documentElement.style.setProperty(
    '--bx-zoom', Math.min(1, (window.innerWidth - 12) / A4_W).toFixed(4));
fit();
window.addEventListener('resize', fit);
document.getElementById('bx-print')?.addEventListener('click', () => window.print());

// ── 3. Modo edición ──────────────────────────────────────────
const checkOverflow = () => pages.forEach(p => {
    const inner = p.querySelector('.layer') || p;
    const over = inner.scrollHeight > inner.clientHeight + 2 || p.scrollHeight > A4_H + 2;
    p.classList.toggle('bx-overflow', over);
});

const enableEditing = () => {
    document.body.classList.add('bx-editing');
    const bar = document.getElementById('bx-bar');
    bar.innerHTML = `
        <span class="bx-label">Modo edición</span>
        <span class="bx-msg" id="bx-msg">Clic en un texto para escribir · clic en una foto para cambiarla</span>
        <div class="bx-actions">
            <button type="button" class="bx-btn bx-ghost" id="bx-reset">Restaurar original</button>
            <a href="${location.pathname}" class="bx-btn bx-ghost">Salir sin guardar</a>
            <button type="button" class="bx-btn bx-gold" id="bx-save">Guardar cambios</button>
        </div>`;
    const msg = document.getElementById('bx-msg');

    textEls.forEach(el => {
        el.contentEditable = 'true';
        el.spellcheck = true;
        el.addEventListener('input', checkOverflow);
        // Pegar siempre como texto simple, sin el formato de origen.
        el.addEventListener('paste', (e) => {
            e.preventDefault();
            document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
        });
    });

    const picker = document.createElement('input');
    picker.type = 'file'; picker.accept = 'image/*'; picker.hidden = true;
    document.body.appendChild(picker);
    let target = null;
    imgEls.forEach(img => img.addEventListener('click', () => { target = img; picker.click(); }));
    picker.addEventListener('change', async () => {
        const file = picker.files[0];
        picker.value = '';
        if (!file || !target) return;
        msg.textContent = 'Cargando la foto…';
        try {
            const data = await compressImage(file, 1600, 0.82);
            if (data.length > 950000) { msg.textContent = 'La foto pesa demasiado incluso comprimida. Prueba con otra.'; return; }
            const ref = await addDoc(collection(db, dbPath('brochure_images')), { data, createdAt: new Date() });
            target.src = data;
            target.dataset.saved = `img:${ref.id}`;
            msg.textContent = 'Foto cambiada. Pulsa "Guardar cambios" para publicarla.';
        } catch { msg.textContent = 'No se pudo cargar la foto. Inténtalo de nuevo.'; }
    });

    document.getElementById('bx-save').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        checkOverflow();
        if (document.querySelector('.bx-overflow') &&
            !confirm('Hay una página donde el contenido no cabe y se cortará en el PDF. ¿Guardar de todos modos?')) return;
        btn.disabled = true;
        try {
            const texts = {}, images = {};
            textEls.forEach(el => { const html = sanitize(el.innerHTML); if (html !== el._base) texts[el.dataset.e] = html; });
            imgEls.forEach(el => { if (el.dataset.saved) images[el.dataset.e] = el.dataset.saved; });
            await setDoc(doc(db, dbPath(`brochures/${tipo}`)), {
                version: VERSION, texts, images,
                // Texto completo, para que el bot conozca el contenido vigente.
                plain: pages.map(p => p.innerText.replace(/\n{2,}/g, '\n').trim()).join('\n\n'),
                updatedAt: new Date()
            });
            msg.textContent = 'Guardado. Ahora descarga el PDF y súbelo en el admin para el bot.';
        } catch (err) { msg.textContent = `No se pudo guardar: ${err.message}`; }
        btn.disabled = false;
    });

    document.getElementById('bx-reset').addEventListener('click', async () => {
        if (!confirm('¿Volver al brochure original? Se perderán todos los cambios guardados.')) return;
        await deleteDoc(doc(db, dbPath(`brochures/${tipo}`)));
        location.reload();
    });

    checkOverflow();
};

applyOverrides().then(() => {
    if (!new URLSearchParams(location.search).has('editar')) return;
    onAuthStateChanged(auth, async (user) => {
        let isAdmin = false;
        if (user && !user.isAnonymous) {
            try {
                const role = await getDoc(doc(db, dbPath(`user_roles/${user.uid}`)));
                isAdmin = role.exists() && role.data().role === 'admin';
            } catch { /* sin permiso: no es admin */ }
        }
        if (isAdmin) enableEditing();
        else alert('Para editar el brochure, inicia sesión en el admin y vuelve a abrirlo desde la sección Brochures.');
    });
});
