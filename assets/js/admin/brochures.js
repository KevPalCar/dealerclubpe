// ============================================================
// BROCHURES — estado de cada brochure y PDF que envía el bot
// ============================================================

import { db, dbPath } from '../firebase.js';
import { setDoc, doc, deleteDoc, onSnapshot, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { esc, showToast, registerSection, unsubscribeListeners } from './core.js';

// ══════════════════════════════════════════════════════════
// BROCHURES — una tarjeta por brochure
// El brochure se edita sobre su propia página (/brochure-…?editar=1),
// que conserva el diseño original. Aquí solo se ve su estado y se
// sube el PDF que envía el bot (se guarda troceado en la base de
// datos, sin Firebase Storage).
// ══════════════════════════════════════════════════════════
const PDF_CHUNK = 700000;   // caracteres Base64 por documento (límite de Firestore: 1 MB)
const fmtWhen = (ts) => ts ? new Date(ts.seconds * 1000).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : '';

// El avance y el resultado quedan escritos en la propia tarjeta: el aviso
// flotante dura pocos segundos y la subida puede tardar más.
const uploadBrochurePdf = async (card, file) => {
    const tipo  = card.dataset.brochure;
    const label = card.querySelector('.bro-upload');
    const msg   = card.querySelector('.bro-upload-msg');
    const say   = (text, kind) => { msg.textContent = text; msg.className = `bro-upload-msg ${kind}`; };
    if (file.type !== 'application/pdf') { say('El archivo debe ser un PDF.', 'error'); showToast('El archivo debe ser un PDF.', 'error'); return; }
    if (file.size > 9 * 1024 * 1024) { say('El PDF pesa más de 9 MB.', 'error'); showToast('El PDF pesa más de 9 MB. Descárgalo de nuevo desde la página del brochure.', 'error'); return; }
    label.classList.add('disabled');
    say('Subiendo el PDF…', 'busy');
    showToast('Subiendo el PDF…', 'info');
    try {
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        const chunks = Math.ceil(base64.length / PDF_CHUNK);
        const prev   = await getDoc(doc(db, dbPath(`brochure_files/${tipo}`)));
        for (let i = 0; i < chunks; i++) {
            say(`Subiendo el PDF… ${Math.round((i / chunks) * 100)} %`, 'busy');
            await setDoc(doc(db, dbPath(`brochure_files/${tipo}_${i}`)), { data: base64.slice(i * PDF_CHUNK, (i + 1) * PDF_CHUNK) });
        }
        await setDoc(doc(db, dbPath(`brochure_files/${tipo}`)), { chunks, size: file.size, name: file.name, updatedAt: new Date() });
        for (let i = chunks; i < (prev.exists() ? prev.data().chunks : 0); i++) {
            await deleteDoc(doc(db, dbPath(`brochure_files/${tipo}_${i}`)));
        }
        say(`✓ "${file.name}" subido correctamente. El bot enviará esta versión desde ahora.`, 'ok');
        showToast('PDF subido correctamente. El bot enviará esta versión desde ahora.', 'success', 8000);
    } catch (err) {
        say(`No se pudo subir el PDF: ${err.message}`, 'error');
        showToast(`No se pudo subir el PDF: ${esc(err.message)}`, 'error', 8000);
    } finally {
        label.classList.remove('disabled');
    }
};

document.querySelectorAll('.bro-card').forEach(card => {
    card.querySelector('.bro-pdf-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (file) uploadBrochurePdf(card, file);
    });
});

const loadBrochures = () => {
    document.querySelectorAll('.bro-card').forEach(card => {
        const tipo = card.dataset.brochure;
        unsubscribeListeners[`broContent_${tipo}`] = onSnapshot(doc(db, dbPath(`brochures/${tipo}`)), (snap) => {
            card.querySelector('[data-role="content"]').textContent = snap.exists()
                ? `Contenido editado por última vez el ${fmtWhen(snap.data().updatedAt)}.`
                : 'Contenido original, sin cambios.';
        });
        unsubscribeListeners[`broPdf_${tipo}`] = onSnapshot(doc(db, dbPath(`brochure_files/${tipo}`)), (snap) => {
            const pdf = card.querySelector('[data-role="pdf"]');
            if (!snap.exists()) { pdf.textContent = 'El bot envía el PDF original.'; return; }
            const d = snap.data();
            pdf.textContent = `El bot envía el PDF que subiste el ${fmtWhen(d.updatedAt)} (${(d.size / 1048576).toFixed(1)} MB).`;
        });
    });
};

registerSection('brochures', { title: 'Brochures', load: loadBrochures });
