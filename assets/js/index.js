import { auth, db, dbPath } from './firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {

    // ── HEADER: enlace inteligente según rol ──────────────────
    const studentAccessLink = document.getElementById('student-access-link');
    if (studentAccessLink) {
        onAuthStateChanged(auth, async (user) => {
            if (user && !user.isAnonymous) {
                try {
                    const snap = await getDoc(doc(db, dbPath(`user_roles/${user.uid}`)));
                    if (snap.exists()) {
                        const role = snap.data().role;
                        if (role === 'admin') {
                            studentAccessLink.textContent = 'Panel Admin';
                            studentAccessLink.href = '/admin';
                            return;
                        }
                        if (role === 'student') {
                            studentAccessLink.textContent = 'Mi Campus';
                            studentAccessLink.href = '/panel-estudiante';
                            return;
                        }
                    }
                } catch { /* silencioso */ }
                await signOut(auth);
            }
            studentAccessLink.textContent = 'Iniciar Sesión';
            studentAccessLink.href = '/iniciar-sesion';
        });
    }

    // ── ANNOUNCE BAR ─────────────────────────────────────────
    const announceBar  = document.getElementById('announce-bar');
    const announceText = document.getElementById('announce-text');
    const closeBtn     = document.getElementById('close-announce-bar');
    const pageId       = document.body.getAttribute('data-page');

    if (announceBar && pageId) {
        onSnapshot(doc(db, dbPath('config/announceBar')), (snap) => {
            if (snap.exists()) {
                const mensaje = snap.data()[pageId];
                if (mensaje?.trim()) {
                    announceText.textContent = mensaje;
                    announceBar.style.display = 'flex';
                } else {
                    announceBar.style.display = 'none';
                }
            } else {
                announceBar.style.display = 'none';
            }
        }, () => { announceBar.style.display = 'none'; });

        closeBtn?.addEventListener('click', () => announceBar.style.display = 'none');
    }
});
