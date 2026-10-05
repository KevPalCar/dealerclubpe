// ============================================================
// CONFIG & ANUNCIOS — barra de anuncios, WhatsApp y bienvenida del alumno
// ============================================================

import { db, dbPath } from '../firebase.js';
import { setDoc, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { showToast, showMsg, registerSection, unsubscribeListeners } from './core.js';

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

registerSection('announcements', { title: 'Config & Anuncios', load: loadAnnouncements });
