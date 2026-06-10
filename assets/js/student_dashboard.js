// ============================================================
// DASHBOARD DE ESTUDIANTE — DealerClub
// ============================================================
// Importa desde firebase.js. No re-inicialices Firebase aquí.
// ============================================================

import { auth, db, dbPath } from './firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    doc, getDoc, collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Protege el botón "Atrás" del BFCache (el usuario quedaría
// logueado visualmente aunque su sesión ya haya caducado)
window.addEventListener('pageshow', (e) => {
    if (e.persisted) window.location.reload();
});

document.addEventListener('DOMContentLoaded', () => {

    // ── OVERLAY DE AUTENTICACIÓN ─────────────────────────────
    const overlay   = document.getElementById('auth-overlay');
    const hideOverlay = () => { if (overlay) overlay.style.display = 'none'; };

    // ── ANNOUNCE BAR ─────────────────────────────────────────
    const announceBar   = document.getElementById('announce-bar');
    const announceText  = document.getElementById('announce-text');
    const closeAnnounce = document.getElementById('close-announce-bar');

    onSnapshot(doc(db, dbPath('config/announceBar')), (snap) => {
        if (snap.exists()) {
            const d = snap.data();
            if (d.dashboard?.trim()) {
                announceText.textContent = d.dashboard;
                announceBar.style.display = 'flex';
            } else {
                announceBar.style.display = 'none';
            }
        }
    });
    closeAnnounce?.addEventListener('click', () => announceBar.style.display = 'none');

    // ── GUARD DE AUTENTICACIÓN ───────────────────────────────
    onAuthStateChanged(auth, async (user) => {
        if (!user || user.isAnonymous) {
            window.location.replace('login.html');
            return;
        }

        try {
            const roleSnap = await getDoc(doc(db, dbPath(`user_roles/${user.uid}`)));
            if (!roleSnap.exists()) throw new Error('no-role');

            const roleData = roleSnap.data();
            if (roleData.role !== 'student' && roleData.role !== 'admin') throw new Error('unauthorized');

            // Rellena cabecera
            document.getElementById('dash-welcome-name').textContent =
                (roleData.fullName || user.email || 'Estudiante').split(' ')[0];
            document.getElementById('dash-student-code').textContent =
                roleData.studentCode ? `Código: ${roleData.studentCode}` : '';

            const levelEl = document.getElementById('dash-level-pill');
            levelEl.textContent = roleData.level || 'Rookie';
            const levelColors = { 'Pro Dealer': 'level-pro', 'Élite VIP': 'level-elite' };
            levelEl.classList.add(levelColors[roleData.level] || 'level-rookie');

            hideOverlay();
            document.getElementById('dash-body').style.visibility = 'visible';

            // Inicia los listeners de cada tab
            listenCourses(user.email);
            listenProgress(user.uid);
            listenTasks(roleData.studentCode);
            listenMaterials();

            switchTab('courses');

        } catch {
            await signOut(auth);
            window.location.replace('login.html');
        }
    });

    // ── SISTEMA DE TABS ──────────────────────────────────────
    const switchTab = (tabName) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelector(`.tab-btn[data-tab="${tabName}"]`)?.classList.add('active');
        document.getElementById(`panel-${tabName}`)?.classList.add('active');
    };

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // ── LOGOUT ───────────────────────────────────────────────
    document.getElementById('dash-logout-btn').addEventListener('click', async (e) => {
        e.preventDefault();
        await signOut(auth);
        window.location.replace('login.html');
    });

    // ════════════════════════════════════════════════════════
    // TAB 1 — MIS CURSOS
    // ════════════════════════════════════════════════════════
    const listenCourses = (email) => {
        const container = document.getElementById('courses-panel-content');
        const q = query(collection(db, dbPath('course_enrollments')), where('email', '==', email));

        onSnapshot(q, (snap) => {
            container.innerHTML = '';
            if (snap.empty) {
                container.innerHTML = emptyState('No tienes cursos inscritos aún.', 'fa-graduation-cap');
                return;
            }
            snap.docs
                .map(d => d.data())
                .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0))
                .forEach(enrollment => {
                    const rawStatus = (enrollment.status || '').toLowerCase();
                    let cardClass = 'card-pending';
                    let badgeText = '<i class="fas fa-lock"></i> Validando Pago';
                    let btnHtml = `<button class="card-action-btn btn-locked" disabled>
                                       <i class="fas fa-clock"></i> Esperando Verificación
                                   </button>`;

                    if (['waitlist', 'lista_espera'].includes(rawStatus)) {
                        cardClass = 'card-waitlist';
                        badgeText = '<i class="fas fa-hourglass-half"></i> Lista de Espera';
                        btnHtml = `<button class="card-action-btn btn-locked" disabled>
                                       <i class="fas fa-lock"></i> Cupos Cerrados
                                   </button>`;
                    } else if (['active', 'activo', 'aprobado'].includes(rawStatus)) {
                        cardClass = 'card-active';
                        badgeText = '<i class="fas fa-check-circle"></i> Curso Activo';
                        btnHtml = `<button class="card-action-btn btn-enter">
                                       <i class="fas fa-play"></i> Entrar al Curso
                                   </button>`;
                    }

                    const dateStr = enrollment.timestamp
                        ? new Date(enrollment.timestamp.seconds * 1000).toLocaleDateString('es-PE')
                        : 'N/A';

                    const card = document.createElement('div');
                    card.className = `course-card ${cardClass}`;
                    card.innerHTML = `
                        <div class="status-badge">${badgeText}</div>
                        <h4>${enrollment.courseName || 'Curso DealerClub'}</h4>
                        <p class="date">Inscrito el: ${dateStr}</p>
                        ${enrollment.studentCode
                            ? `<p class="enroll-code"><i class="fas fa-id-badge"></i> ${enrollment.studentCode}</p>`
                            : ''}
                        ${btnHtml}
                    `;
                    container.appendChild(card);
                });
        });
    };

    // ════════════════════════════════════════════════════════
    // TAB 2 — MI PROGRESO
    // ════════════════════════════════════════════════════════
    const listenProgress = (uid) => {
        onSnapshot(doc(db, dbPath(`user_roles/${uid}`)), (snap) => {
            if (!snap.exists()) return;
            const d = snap.data();

            // Nivel
            const levelEl = document.getElementById('prog-level-val');
            if (levelEl) {
                levelEl.textContent = d.level || 'Rookie';
                levelEl.className = 'prog-val ' + ({'Pro Dealer':'level-pro','Élite VIP':'level-elite'}[d.level] || 'level-rookie');
            }

            // Asistencia
            const att    = d.attendance ?? null;
            const attBar = document.getElementById('prog-att-bar');
            const attPct = document.getElementById('prog-att-pct');
            const attVal = document.getElementById('prog-att-val');
            if (attBar && att !== null) {
                const pct = Math.min(100, Math.max(0, att));
                attBar.style.width = `${pct}%`;
                if (attPct) attPct.textContent = `${pct}%`;
                if (attVal) attVal.textContent = `${pct}%`;
            } else if (attVal) {
                attVal.textContent = 'Sin datos';
            }

            // Notas
            const grade    = d.grades ?? null;
            const gradeBar = document.getElementById('prog-grade-bar');
            const gradePct = document.getElementById('prog-grade-pct');
            const gradeVal = document.getElementById('prog-grade-val');
            if (gradeBar && grade !== null) {
                const pct = Math.min(100, Math.max(0, (grade / 20) * 100));
                gradeBar.style.width = `${pct}%`;
                if (gradePct) gradePct.textContent = `${pct.toFixed(0)}%`;
                if (gradeVal) gradeVal.textContent = `${grade}/20`;
            } else if (gradeVal) {
                gradeVal.textContent = 'Sin datos';
            }
        });
    };

    // ════════════════════════════════════════════════════════
    // TAB 3 — MIS TAREAS
    // ════════════════════════════════════════════════════════
    const listenTasks = (studentCode) => {
        const container = document.getElementById('tasks-panel-content');

        // Firestore 'in' operator acepta hasta 10 valores.
        // Siempre incluimos 'all'; si hay código, también lo añadimos.
        const assigneeCodes = studentCode ? ['all', studentCode] : ['all'];
        const q = query(
            collection(db, dbPath('tasks')),
            where('assignedTo', 'in', assigneeCodes)
        );

        onSnapshot(q, (snap) => {
            container.innerHTML = '';
            if (snap.empty) {
                container.innerHTML = emptyState('No tienes tareas asignadas aún.', 'fa-tasks');
                return;
            }
            snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
                .forEach(task => {
                    const dateStr = task.createdAt
                        ? new Date(task.createdAt.seconds * 1000).toLocaleDateString('es-PE')
                        : '';
                    const isForAll = task.assignedTo === 'all';
                    const card = document.createElement('div');
                    card.className = 'task-card';
                    card.innerHTML = `
                        <div class="task-header">
                            <span class="task-date">${dateStr}</span>
                            <span class="task-assigned ${isForAll ? 'tag-all' : 'tag-personal'}">
                                <i class="fas ${isForAll ? 'fa-users' : 'fa-user'}"></i>
                                ${isForAll ? 'Todos' : 'Personal'}
                            </span>
                        </div>
                        <h4 class="task-title">${task.title}</h4>
                        ${task.description ? `<p class="task-desc">${task.description}</p>` : ''}
                        ${task.url ? `<a href="${task.url}" target="_blank" rel="noopener" class="task-link">
                            <i class="fas fa-external-link-alt"></i> Ver recurso
                        </a>` : ''}
                    `;
                    container.appendChild(card);
                });
        });
    };

    // ════════════════════════════════════════════════════════
    // TAB 4 — MATERIAL DIDÁCTICO
    // ════════════════════════════════════════════════════════
    const listenMaterials = () => {
        const container = document.getElementById('materials-panel-content');

        onSnapshot(collection(db, dbPath('materials')), (snap) => {
            container.innerHTML = '';
            if (snap.empty) {
                container.innerHTML = emptyState('No hay material disponible por ahora.', 'fa-book-open');
                return;
            }
            const materials = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

            const typeIcons  = { Video: 'fa-play-circle', Documento: 'fa-file-alt', Enlace: 'fa-link' };
            const typeColors = { Video: '#dc3545', Documento: '#007bff', Enlace: '#28a745' };

            materials.forEach(m => {
                const icon  = typeIcons[m.type]  || 'fa-file';
                const color = typeColors[m.type] || '#ffc107';
                const card  = document.createElement('div');
                card.className = 'material-card';
                card.innerHTML = `
                    <div class="material-icon" style="color:${color};">
                        <i class="fas ${icon}"></i>
                    </div>
                    <div class="material-body">
                        <p class="material-category">${m.courseName || 'General'}</p>
                        <h4 class="material-title">${m.title}</h4>
                        ${m.category ? `<span class="material-type">${m.category}</span>` : ''}
                        <a href="${m.url}" target="_blank" rel="noopener" class="material-btn">
                            <i class="fas ${icon}"></i> Abrir
                        </a>
                    </div>
                `;
                container.appendChild(card);
            });
        });
    };

    // ── HELPER: EMPTY STATE ──────────────────────────────────
    const emptyState = (msg, icon = 'fa-inbox') =>
        `<div class="empty-state">
            <i class="fas ${icon}"></i>
            <p>${msg}</p>
        </div>`;
});
