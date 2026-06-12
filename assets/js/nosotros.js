// ============================================================
// NOSOTROS — DealerClub
// ============================================================
import { auth, db, dbPath } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    collection, doc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {

    // ── HEADER: enlace inteligente según rol ─────────────────
    const studentAccessLink = document.getElementById('student-access-link');
    if (studentAccessLink) {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const snap = await getDoc(doc(db, dbPath(`user_roles/${user.uid}`)));
                    if (snap.exists() && snap.data().role === 'admin') {
                        studentAccessLink.textContent = 'Panel Admin';
                        studentAccessLink.href = '/admin';
                        return;
                    }
                } catch { /* silencioso */ }
                studentAccessLink.textContent = 'Mi Campus';
                studentAccessLink.href = '/panel-estudiante';
            } else {
                studentAccessLink.textContent = 'Iniciar Sesión';
                studentAccessLink.href = '/iniciar-sesion';
            }
        });
    }

    // ── ANNOUNCE BAR ─────────────────────────────────────────
    const announceBar  = document.getElementById('announce-bar');
    const announceText = document.getElementById('announce-text');
    const closeBtn     = document.getElementById('close-announce-bar');

    onSnapshot(doc(db, dbPath('config/announceBar')), (snap) => {
        if (!snap.exists()) { announceBar.style.display = 'none'; return; }
        const d = snap.data();
        if (d.nosotros?.trim()) {
            announceText.textContent = d.nosotros;
            announceBar.style.display = 'flex';
        } else {
            announceBar.style.display = 'none';
        }
    }, () => { announceBar.style.display = 'none'; });

    closeBtn?.addEventListener('click', () => announceBar.style.display = 'none');

    // ── PROFESORES — onSnapshot (tiempo real) ────────────────
    const gridContainer = document.getElementById('professors-grid-container');
    if (gridContainer) {
        onSnapshot(collection(db, dbPath('professors')), (snap) => {
            gridContainer.innerHTML = '';

            if (snap.empty) {
                gridContainer.innerHTML = '<p style="text-align:center;width:100%;color:#ccc;">Próximamente conocerás a nuestro equipo docente.</p>';
                return;
            }

            const profs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

            profs.forEach(p => {
                const imgUrl = p.imageUrl || 'https://placehold.co/400x400/333333/ffffff?text=Foto';
                const card = document.createElement('div');
                card.className = 'profesor-card';
                card.innerHTML = `
                    <img src="${imgUrl}" alt="${p.name}" class="circular-img"
                         onerror="this.onerror=null;this.src='https://placehold.co/400x400/333333/ffffff?text=Foto'">
                    <h3>${p.name}</h3>
                    <p>Especialidad: ${p.specialty}</p>
                    <p class="profesor-bio">${p.bio}</p>
                `;
                gridContainer.appendChild(card);
            });
        }, (err) => {
            gridContainer.innerHTML = '<p style="text-align:center;width:100%;color:#dc3545;">Error al cargar el equipo docente.</p>';
        });
    }

    // ── EGRESADOS — onSnapshot (tiempo real) ─────────────────
    const gridAlumni = document.getElementById('alumni-grid-container');
    if (gridAlumni) {
        onSnapshot(collection(db, dbPath('alumni')), (snap) => {
            gridAlumni.innerHTML = '';

            if (snap.empty) {
                gridAlumni.innerHTML = '<p style="text-align:center;width:100%;color:#ccc;">Muy pronto conocerás las historias de éxito de nuestros egresados.</p>';
                return;
            }

            const alumni = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

            alumni.forEach(a => {
                const imgUrl = a.imageUrl || 'https://placehold.co/400x400/333333/ffffff?text=Foto';
                const card = document.createElement('div');
                card.className = 'alumno-card';
                card.innerHTML = `
                    <img src="${imgUrl}" alt="${a.name}" class="circular-img"
                         onerror="this.onerror=null;this.src='https://placehold.co/400x400/333333/ffffff?text=Foto'">
                    <h3>${a.name}</h3>
                    <p class="alumno-info">${a.info}</p>
                    <p class="alumno-testimonio">"${a.testimonial}"</p>
                `;
                gridAlumni.appendChild(card);
            });
        }, () => {
            gridAlumni.innerHTML = '<p style="text-align:center;width:100%;color:#dc3545;">Error al cargar los egresados.</p>';
        });
    }
});
