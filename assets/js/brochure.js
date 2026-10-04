// ============================================================
// BROCHURE — página pública (/brochure-eventos, /brochure-escuela)
// ============================================================
// El contenido es datos: páginas con bloques (tarjetas, pasos,
// listas, fotos…). Sale del archivo base /assets/data/brochure-*.json
// o, si el admin ya lo editó, de Firestore (brochures/{tipo}).
// "Descargar PDF" usa la impresión del navegador: una hoja A4 por
// página del brochure, con el mismo diseño.
// ============================================================

import { db, dbPath } from './firebase.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const esc = (v) => String(v ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// *palabra* dentro de un título se pinta en dorado.
const rich = (v) => esc(v).replace(/\*(.+?)\*/g, '<span class="bp-hl">$1</span>');
const chipsOf = (v) => String(v || '').split(',').map(x => x.trim()).filter(Boolean);

// Las fotos subidas desde el admin se guardan aparte ("img:ID").
const resolveImage = async (src) => {
    if (!src || !src.startsWith('img:')) return src || '';
    try {
        const snap = await getDoc(doc(db, dbPath(`brochure_images/${src.slice(4)}`)));
        return snap.exists() ? snap.data().data : '';
    } catch { return ''; }
};

const BLOCKS = {
    tagline: (b) => `<p class="bp-tagline"><b>${esc(b.strong)}</b> <i>${esc(b.text)}</i></p>`,
    image:   (b) => `<figure class="bp-image"><img data-src="${esc(b.src)}" alt=""></figure>`,
    note:    (b) => `<p class="bp-note"><strong>${esc(b.strong)}</strong> ${esc(b.text)}</p>`,
    banner:  (b) => `<div class="bp-banner"><span>${esc(b.label)}</span><div><strong>${esc(b.title)}</strong><p>${esc(b.text)}</p></div></div>`,
    chips:   (b) => `<div class="bp-chips-box">
                        ${b.title ? `<h3>${esc(b.title)}</h3>` : ''}
                        <ul class="bp-chips">${(b.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>
                        ${b.foot ? `<p class="bp-foot">${esc(b.foot)}</p>` : ''}
                     </div>`,
    cards:   (b) => `${b.title ? `<h3 class="bp-subtitle">${esc(b.title)}</h3>` : ''}
                     <div class="bp-cards">${(b.items || []).map(i =>
                        `<div class="bp-card"><strong>${esc(i.title)}</strong><p>${esc(i.text)}</p></div>`).join('')}</div>`,
    checks:  (b) => `<div class="bp-checks">${(b.items || []).map(i =>
                        `<div class="bp-check"><span>✓</span><div><strong>${esc(i.title)}</strong><p>${esc(i.text)}</p></div></div>`).join('')}</div>`,
    steps:   (b) => `<ol class="bp-steps">${(b.items || []).map((i, n) =>
                        `<li><span>${n + 1}</span><div><strong>${esc(i.title)}</strong><p>${esc(i.text)}</p></div></li>`).join('')}</ol>`,
    games:   (b) => `<div class="bp-games">${(b.items || []).map(i =>
                        `<div class="bp-game"><h3>${esc(i.title)}</h3><em>${esc(i.sub)}</em><p>${esc(i.text)}</p>
                         <ul class="bp-chips">${chipsOf(i.chips).map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>`).join('')}</div>`
};

export const renderBrochure = async (data, root) => {
    const footer = data.footer || {};
    root.innerHTML = (data.pages || []).map((p, n) => `
        <section class="bp-page${p.cover ? ' bp-cover' : ''}">
            ${p.cover ? `<header class="bp-brand"><img src="/assets/images/isotipo_principal.png" alt=""><strong>DEALER<em>CLUB</em></strong><span>LIMA · PERÚ</span></header>` : ''}
            <div class="bp-body">
                ${p.kicker ? `<p class="bp-kicker">${esc(p.kicker)}</p>` : ''}
                ${p.title ? `<h2 class="bp-title">${rich(p.title)}</h2>` : ''}
                ${p.text ? `<p class="bp-lead">${esc(p.text)}</p>` : ''}
                ${(p.blocks || []).filter(b => !b.hidden).map(b => (BLOCKS[b.type] ? BLOCKS[b.type](b) : '')).join('')}
            </div>
            <footer class="bp-pagefoot">
                ${n === 0 || n === (data.pages.length - 1)
                    ? `<span>${esc(footer.web)}</span><span>WhatsApp <b>${esc(footer.whatsapp)}</b></span>`
                    : `<span>${esc(footer.legal)}</span><span>${n + 1}</span>`}
            </footer>
        </section>`).join('');

    await Promise.all([...root.querySelectorAll('img[data-src]')].map(async (img) => {
        img.src = await resolveImage(img.dataset.src);
    }));
};

// Contenido vigente: el editado en el admin o, si no hay, el archivo base.
export const loadBrochure = async (tipo) => {
    try {
        // Si la base tarda, no se deja al visitante esperando: se usa el archivo base.
        const snap = await Promise.race([
            getDoc(doc(db, dbPath(`brochures/${tipo}`))),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500))
        ]);
        if (snap.exists() && (snap.data().pages || []).length) return snap.data();
    } catch { /* sin conexión a la base o sin permiso: se usa el archivo base */ }
    const res = await fetch(`/assets/data/brochure-${tipo}.json`);
    if (!res.ok) throw new Error('sin contenido');
    return res.json();
};

// ── Página pública ───────────────────────────────────────────
const root = document.getElementById('brochure-root');
if (root) {
    const tipo = document.body.dataset.brochure;
    loadBrochure(tipo)
        .then(async (data) => {
            document.title = `${data.name || 'Brochure'} - DealerClub`;
            await renderBrochure(data, root);
            document.getElementById('bp-status').style.display = 'none';
            document.getElementById('bp-bar').style.display = 'flex';
        })
        .catch(() => {
            document.getElementById('bp-status').textContent =
                'No se pudo cargar el brochure. Revisa tu conexión e inténtalo de nuevo.';
        });
    document.getElementById('bp-print')?.addEventListener('click', () => window.print());
}
