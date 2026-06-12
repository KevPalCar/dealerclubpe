// ============================================================
// DASHBOARD DE ESTUDIANTE — DealerClub
// ============================================================
// Importa desde firebase.js. No re-inicialices Firebase aquí.
// ============================================================

import { auth, db, dbPath } from './firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    doc, getDoc, setDoc, deleteDoc, collection, query, where, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Comprime imágenes en el navegador antes de guardarlas como Base64
// (sin Firebase Storage). Máx 800px de ancho, 80% de calidad.
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

// Protege el botón "Atrás" del BFCache (el usuario quedaría
// logueado visualmente aunque su sesión ya haya caducado)
window.addEventListener('pageshow', (e) => {
    if (e.persisted) window.location.reload();
});

document.addEventListener('DOMContentLoaded', () => {

    // ── OVERLAY DE AUTENTICACIÓN ─────────────────────────────
    const overlay   = document.getElementById('auth-overlay');
    const hideOverlay = () => { if (overlay) overlay.style.display = 'none'; };

    // ── ESTADO DE ONBOARDING (alumno pendiente de aprobación) ─
    let pendingInfo   = null;   // {fullName, studentCode, email} si NO está aprobado
    let onboardingCfg = {};     // {videoUrl, title, text, whatsapp}

    // ── ANNOUNCE BAR + CONFIG DE BIENVENIDA ──────────────────
    const announceBar   = document.getElementById('announce-bar');
    const announceText  = document.getElementById('announce-text');
    const closeAnnounce = document.getElementById('close-announce-bar');

    onSnapshot(doc(db, dbPath('config/announceBar')), (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();

        // Announce bar del dashboard
        if (d.dashboard?.trim()) {
            announceText.textContent = d.dashboard;
            announceBar.style.display = 'flex';
        } else {
            announceBar.style.display = 'none';
        }

        // Config de la bienvenida del alumno pendiente
        onboardingCfg = {
            videoUrl: d.onboardingVideoUrl || '',
            title:    d.onboardingTitle    || '',
            text:     d.onboardingText     || '',
            whatsapp: (d.whatsapp || '51929610747').replace(/\D/g, '')
        };
        renderPendingHero();
    });
    closeAnnounce?.addEventListener('click', () => announceBar.style.display = 'none');

    // ── GUARD DE AUTENTICACIÓN ───────────────────────────────
    onAuthStateChanged(auth, async (user) => {
        if (!user || user.isAnonymous) {
            window.location.replace('/iniciar-sesion');
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

            // ¿Aprobado? El admin siempre; el alumno con status 'active'.
            // Si aún no tiene 'active', confirmamos contra sus inscripciones
            // ANTES de revelar la interfaz, para no mostrar el modo pendiente
            // por error y luego corregir (evita el parpadeo).
            let isApproved = roleData.role === 'admin' || roleData.status === 'active';
            if (!isApproved) {
                try {
                    const enrollSnap = await getDocs(query(
                        collection(db, dbPath('course_enrollments')),
                        where('email', '==', user.email)
                    ));
                    isApproved = enrollSnap.docs.some(d =>
                        ['active', 'activo', 'aprobado'].includes((d.data().status || '').toLowerCase()));
                } catch { /* ante un fallo de red, se trata como pendiente */ }
            }
            if (!isApproved) {
                pendingInfo = {
                    fullName:    (roleData.fullName || user.email || 'Estudiante').split(' ')[0],
                    studentCode: roleData.studentCode || '',
                    email:       user.email || ''
                };
                document.getElementById('dash-body').classList.add('dash-pending');
                document.getElementById('preview-notice').style.display = 'block';
                renderPendingHero();
            }

            hideOverlay();
            document.getElementById('dash-body').style.visibility = 'visible';

            // Inicia los listeners de cada tab
            listenCourses(user.email);
            listenProgress(user.uid);
            listenTasks(roleData.studentCode, roleData.fullName);
            listenMaterials();

            // Promoción de referidos: solo alumnos aprobados con código.
            if (isApproved && roleData.studentCode) renderReferral(roleData.studentCode, roleData.fullName);

            switchTab('courses');

        } catch {
            await signOut(auth);
            window.location.replace('/iniciar-sesion');
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
        window.location.replace('/iniciar-sesion');
    });

    // ════════════════════════════════════════════════════════
    // HERO DE ALUMNO PENDIENTE (vitrina + persuasión)
    // ════════════════════════════════════════════════════════
    // Convierte una URL de YouTube (watch / youtu.be / embed) a embed.
    const toYouTubeEmbed = (url) => {
        if (!url) return '';
        if (url.includes('/embed/')) return url;
        const yt    = url.match(/[?&]v=([^&]+)/);
        const short = url.match(/youtu\.be\/([^?&]+)/);
        const id    = yt ? yt[1] : (short ? short[1] : '');
        return id ? `https://www.youtube.com/embed/${id}` : '';
    };

    const renderPendingHero = () => {
        if (!pendingInfo) return;                       // solo aplica a no aprobados
        document.getElementById('pending-hero').style.display = 'block';

        if (onboardingCfg.title?.trim())
            document.getElementById('pending-title').textContent = onboardingCfg.title;
        if (onboardingCfg.text?.trim())
            document.getElementById('pending-text').textContent = onboardingCfg.text;

        // Video de bienvenida (opcional)
        const wrap  = document.getElementById('pending-video-wrap');
        const box   = document.getElementById('pending-video');
        const embed = toYouTubeEmbed(onboardingCfg.videoUrl);
        if (embed) {
            if (box.dataset.src !== embed) {            // evita recargar el iframe
                box.dataset.src = embed;
                box.innerHTML = `<iframe src="${embed}" title="Bienvenida DealerClub" frameborder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowfullscreen></iframe>`;
            }
            wrap.style.display = 'block';
        } else {
            wrap.style.display = 'none';
        }

        // CTA: enviar voucher por WhatsApp con datos prellenados
        const phone    = onboardingCfg.whatsapp || '51929610747';
        const codePart = pendingInfo.studentCode ? ` (código ${pendingInfo.studentCode})` : '';
        const msg      = `Hola DealerClub, soy ${pendingInfo.fullName}${codePart}. Acabo de hacer mi depósito y quiero enviar mi voucher de pago para activar mi acceso al campus virtual.`;
        const btn      = document.getElementById('pending-voucher-btn');
        btn.href   = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
        btn.target = '_blank';
        btn.rel    = 'noopener';
    };

    // Quita el modo vitrina y oculta el hero (se llama al detectar aprobación,
    // incluso en vivo cuando el admin valida el pago).
    const unlockDashboard = () => {
        pendingInfo = null;
        document.getElementById('dash-body').classList.remove('dash-pending');
        document.getElementById('pending-hero').style.display = 'none';
        document.getElementById('preview-notice').style.display = 'none';
    };

    // ── REFERIDOS: promueve el código del alumno (marketing) ──
    const renderReferral = (code, name) => {
        const card = document.getElementById('referral-card');
        if (!card || !code) return;
        card.style.display = 'flex';
        document.getElementById('referral-code').textContent = code;

        const site = window.location.origin || '';
        const msg  = `¡Hola! Estudio en DealerClub, la escuela de dealers/croupiers en Lima. ` +
                     `Inscríbete con mi código ${code} y ambos ganamos beneficios. ${site}`.trim();
        document.getElementById('referral-share').href = `https://wa.me/?text=${encodeURIComponent(msg)}`;

        const copyBtn = document.getElementById('referral-copy');
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(code);
                const i = copyBtn.querySelector('i');
                i.className = 'fas fa-check';
                setTimeout(() => { i.className = 'fas fa-copy'; }, 1500);
            } catch { /* navegador sin clipboard API */ }
        };
    };

    // ── AULA DEL CURSO (vista enfocada al entrar a un curso) ──
    let _materials = [];   // poblado por listenMaterials()

    const openAula = async (enrollment) => {
        const modal = document.getElementById('aula-modal');
        const cid   = enrollment.courseId;
        const cname = enrollment.courseName;

        document.getElementById('aula-course-name').textContent = cname || 'Curso DealerClub';
        const firstName = _sname ? _sname.split(' ')[0] : '';
        document.getElementById('aula-welcome').textContent =
            `¡Bienvenido de nuevo${firstName ? ', ' + firstName : ''}! Continúa donde lo dejaste.`;

        // Avance de tareas (entregadas / total) y pendientes
        const total = _tasks.length;
        const done  = _tasks.filter(t => _subs[t.id]).length;
        const pct   = total ? Math.round(done / total * 100) : 0;
        document.getElementById('aula-pending').textContent = total - done;
        document.getElementById('aula-progress-pct').textContent = `${pct}%`;
        document.getElementById('aula-progress-fill').style.width = `${pct}%`;

        // Material de este curso (filtra por courseId o courseName)
        const mats = _materials.filter(m =>
            (cid && m.courseId === cid) || (cname && m.courseName === cname));
        const box  = document.getElementById('aula-materials');
        if (!mats.length) {
            box.innerHTML = `<p class="aula-empty">Aún no hay material para este curso. Pronto se irá cargando.</p>`;
        } else {
            const icons = { Video: 'fa-play-circle', Documento: 'fa-file-alt', Enlace: 'fa-link' };
            box.innerHTML = mats.map(m => `
                <a href="${m.url}" target="_blank" rel="noopener" class="aula-mat">
                    <i class="fas ${icons[m.type] || 'fa-file'}"></i>
                    <span>${m.title}</span>
                </a>`).join('');
        }

        // Horario (de la colección courses, si la inscripción trae courseId)
        const schedBox = document.getElementById('aula-schedule-box');
        schedBox.style.display = 'none';
        if (cid) {
            try {
                const cs = await getDoc(doc(db, dbPath(`courses/${cid}`)));
                if (cs.exists() && cs.data().schedule) {
                    document.getElementById('aula-schedule').textContent = cs.data().schedule;
                    schedBox.style.display = 'flex';
                }
            } catch { /* ignora */ }
        }

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };
    const closeAula = () => {
        document.getElementById('aula-modal').style.display = 'none';
        document.body.style.overflow = 'auto';
    };

    document.getElementById('aula-close').addEventListener('click', closeAula);
    document.getElementById('aula-modal').addEventListener('click', (e) => {
        if (e.target.id === 'aula-modal') closeAula();
    });
    document.getElementById('aula-go-materials').addEventListener('click', () => { closeAula(); switchTab('materials'); });
    document.getElementById('aula-go-tasks').addEventListener('click', () => { closeAula(); switchTab('tasks'); });

    // ════════════════════════════════════════════════════════
    // TAB 1 — MIS CURSOS
    // ════════════════════════════════════════════════════════
    const listenCourses = (email) => {
        const container = document.getElementById('courses-panel-content');
        const q = query(collection(db, dbPath('course_enrollments')), where('email', '==', email));

        onSnapshot(q, (snap) => {
            // Red de seguridad: si hay una inscripción aprobada, desbloquea el
            // campus aunque user_roles.status no se haya marcado 'active'.
            // También desbloquea EN VIVO cuando el admin valida el pago.
            if (pendingInfo && snap.docs.some(d =>
                ['active', 'activo', 'aprobado'].includes((d.data().status || '').toLowerCase()))) {
                unlockDashboard();
            }

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

                    // "Entrar al Curso" abre el Aula enfocada de ese curso.
                    card.querySelector('.btn-enter')
                        ?.addEventListener('click', () => openAula(enrollment));
                });
        });
    };

    // ════════════════════════════════════════════════════════
    // TAB 2 — MI PROGRESO (asistencia calendario + notas semanales)
    // ════════════════════════════════════════════════════════
    const ES_MONTHS       = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const ES_MONTHS_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const pad2   = (n) => String(n).padStart(2, '0');
    const ymdStr = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const startOfWeek = (date) => {       // lunes como inicio
        const dt  = new Date(date);
        const dow = (dt.getDay() + 6) % 7;
        dt.setDate(dt.getDate() - dow);
        dt.setHours(0, 0, 0, 0);
        return dt;
    };

    let stuAttLog    = {};
    let stuAttMode   = 'month';           // 'month' | 'week'
    let stuAttAnchor = new Date();
    let stuAttInit   = false;

    const renderStuAttendance = () => {
        const grid  = document.getElementById('stu-att-grid');
        const label = document.getElementById('stu-att-label');
        if (!grid) return;
        const dowHead = ['L','M','M','J','V','S','D'].map(d => `<span class="att-dow">${d}</span>`).join('');
        const cellCls = (ds) => {
            const st = stuAttLog[ds];
            return st === 'present' ? 'present' : st === 'absent' ? 'absent' : '';
        };

        if (stuAttMode === 'week') {
            const start = startOfWeek(stuAttAnchor);
            let html = dowHead;
            for (let i = 0; i < 7; i++) {
                const dt = new Date(start); dt.setDate(start.getDate() + i);
                const ds = ymdStr(dt.getFullYear(), dt.getMonth(), dt.getDate());
                html += `<span class="att-cell ${cellCls(ds)}">${dt.getDate()}</span>`;
            }
            grid.innerHTML = html;
            const end = new Date(start); end.setDate(start.getDate() + 6);
            const fmt = (dt) => `${dt.getDate()} ${ES_MONTHS_SHORT[dt.getMonth()]}`;
            label.textContent = `${fmt(start)} – ${fmt(end)}`;
        } else {
            const y = stuAttAnchor.getFullYear(), m = stuAttAnchor.getMonth();
            const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
            const daysIn   = new Date(y, m + 1, 0).getDate();
            let html = dowHead;
            for (let i = 0; i < firstDow; i++) html += `<span class="att-cell empty"></span>`;
            for (let d = 1; d <= daysIn; d++) {
                html += `<span class="att-cell ${cellCls(ymdStr(y, m, d))}">${d}</span>`;
            }
            grid.innerHTML = html;
            label.textContent = `${ES_MONTHS[m]} ${y}`;
        }

        const vals = Object.values(stuAttLog);
        const present = vals.filter(v => v === 'present').length;
        const sum = document.getElementById('stu-att-summary');
        if (sum) sum.textContent = vals.length
            ? `· ${Math.round(present / vals.length * 100)}% (${present}/${vals.length} días)`
            : '· Sin registros aún';
    };

    const renderStuGrades = (grades) => {
        const list   = document.getElementById('stu-grades-list');
        const filter = document.getElementById('stu-grade-filter');
        if (!list || !filter) return;
        const arr = (grades || []).filter(g => g && (g.score != null || g.note));

        const weeks  = [...new Set(arr.map(g => g.week).filter(Boolean))].sort((a, b) => a - b);
        const curVal = filter.value || 'all';
        filter.innerHTML = '<option value="all">Todas las semanas</option>' +
            weeks.map(w => `<option value="${w}">Semana ${w}</option>`).join('');
        filter.value = [...filter.options].some(o => o.value === curVal) ? curVal : 'all';

        const show = () => {
            const sel  = filter.value;
            const rows = arr.filter(g => sel === 'all' || String(g.week) === sel)
                            .sort((a, b) => (a.week || 0) - (b.week || 0));
            if (!rows.length) { list.innerHTML = emptyState('Aún no tienes notas registradas.', 'fa-star'); return; }
            list.innerHTML = rows.map(g => {
                const score   = g.score != null ? `${g.score}/20` : '—';
                const dateStr = g.date ? new Date(`${g.date}T00:00:00`).toLocaleDateString('es-PE') : '';
                const pct     = g.score != null ? Math.min(100, Math.max(0, g.score / 20 * 100)) : 0;
                const tone    = g.score == null ? '' : g.score >= 13 ? 'good' : g.score >= 11 ? 'mid' : 'low';
                return `<div class="grade-card ${tone}">
                    <div class="grade-card-top">
                        <span class="grade-week-pill">Semana ${g.week ?? '—'}</span>
                        <span class="grade-score">${score}</span>
                    </div>
                    <div class="grade-bar-track"><div class="grade-bar-fill" style="width:${pct}%"></div></div>
                    ${g.note ? `<p class="grade-note-text">"${g.note}"</p>` : ''}
                    ${dateStr ? `<span class="grade-date-text"><i class="fas fa-calendar-day"></i> ${dateStr}</span>` : ''}
                </div>`;
            }).join('');
        };
        filter.onchange = show;
        show();
    };

    // Controles del calendario del alumno (una sola vez)
    document.querySelectorAll('.att-view-btn').forEach(b => b.addEventListener('click', () => {
        document.querySelectorAll('.att-view-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        stuAttMode = b.dataset.view;
        renderStuAttendance();
    }));
    document.getElementById('stu-att-prev')?.addEventListener('click', () => {
        if (stuAttMode === 'week') stuAttAnchor.setDate(stuAttAnchor.getDate() - 7);
        else stuAttAnchor.setMonth(stuAttAnchor.getMonth() - 1);
        renderStuAttendance();
    });
    document.getElementById('stu-att-next')?.addEventListener('click', () => {
        if (stuAttMode === 'week') stuAttAnchor.setDate(stuAttAnchor.getDate() + 7);
        else stuAttAnchor.setMonth(stuAttAnchor.getMonth() + 1);
        renderStuAttendance();
    });

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

            // Asistencia: % calculado del registro diario (fallback al % legado)
            const logVals = Object.values(d.attendanceLog || {});
            const att = logVals.length
                ? Math.round(logVals.filter(v => v === 'present').length / logVals.length * 100)
                : (d.attendance ?? null);
            const attBar   = document.getElementById('prog-att-bar');
            const attPctEl = document.getElementById('prog-att-pct');
            const attVal   = document.getElementById('prog-att-val');
            if (attBar && att !== null) {
                const pct = Math.min(100, Math.max(0, att));
                attBar.style.width = `${pct}%`;
                if (attPctEl) attPctEl.textContent = `${pct}%`;
                if (attVal)   attVal.textContent   = `${pct}%`;
            } else if (attVal) {
                attVal.textContent = 'Sin datos';
            }

            // Notas: promedio de las notas semanales (fallback al promedio legado)
            const scored = (d.weeklyGrades || []).filter(g => g && g.score != null);
            const avg = scored.length
                ? +(scored.reduce((s, g) => s + (+g.score || 0), 0) / scored.length).toFixed(1)
                : (d.grades ?? null);
            const gradeBar   = document.getElementById('prog-grade-bar');
            const gradePctEl = document.getElementById('prog-grade-pct');
            const gradeVal   = document.getElementById('prog-grade-val');
            if (gradeBar && avg !== null && !Number.isNaN(avg)) {
                const pct = Math.min(100, Math.max(0, (avg / 20) * 100));
                gradeBar.style.width = `${pct}%`;
                if (gradePctEl) gradePctEl.textContent = `${pct.toFixed(0)}%`;
                if (gradeVal)   gradeVal.textContent   = `${avg}/20`;
            } else if (gradeVal) {
                gradeVal.textContent = 'Sin datos';
            }

            // Calendario de asistencia + notas semanales
            stuAttLog = d.attendanceLog || {};
            if (!stuAttInit) {
                stuAttAnchor = d.courseStartDate ? new Date(`${d.courseStartDate}T00:00:00`) : new Date();
                stuAttInit = true;
            }
            renderStuAttendance();
            renderStuGrades(d.weeklyGrades);
        });
    };

    // ════════════════════════════════════════════════════════
    // TAB 3 — MIS TAREAS
    // ════════════════════════════════════════════════════════
    let _tasks = [];
    let _subs  = {};          // taskId -> submission del alumno
    let _scode = '';
    let _sname = '';

    const updateTasksBadge = (n) => {
        const badge = document.getElementById('tasks-badge');
        if (!badge) return;
        badge.textContent = n;
        badge.style.display = n > 0 ? 'inline-flex' : 'none';
    };

    const subId = (taskId) => `${taskId}_${_scode}`;

    const saveSubmission = async (task, extra) => {
        if (!_scode) return;
        await setDoc(doc(db, dbPath(`task_submissions/${subId(task.id)}`)), {
            taskId:      task.id,
            taskTitle:   task.title || '',
            studentCode: _scode,
            studentName: _sname || '',
            status:      'submitted',
            link:        extra.link || '',
            imageUrl:    extra.imageUrl || '',
            submittedAt: new Date()
        }, { merge: true });
    };
    const undoSubmission = async (task) => {
        if (_scode) await deleteDoc(doc(db, dbPath(`task_submissions/${subId(task.id)}`)));
    };

    const buildTaskActions = (area, task, sub, key) => {
        if (!_scode) {
            area.innerHTML = `<p class="task-note">Tu cuenta aún no tiene código de alumno; no puedes entregar todavía.</p>`;
            return;
        }
        if (key === 'reviewed') {
            area.innerHTML = `
                <div class="task-review">
                    <span class="task-grade">${sub.grade != null ? `${sub.grade}/20` : 'Revisada ✓'}</span>
                    ${sub.feedback ? `<p class="task-feedback">"${sub.feedback}"</p>` : ''}
                </div>`;
            return;
        }
        if (sub) {   // entregada, aún sin revisar
            const ev = sub.imageUrl
                ? `<a href="${sub.imageUrl}" target="_blank" rel="noopener">Ver foto enviada</a>`
                : sub.link ? `<a href="${sub.link}" target="_blank" rel="noopener">Ver enlace enviado</a>`
                : 'Marcada como hecha';
            area.innerHTML = `
                <p class="task-submitted-info"><i class="fas fa-check-circle"></i> Entregada — ${ev}</p>
                <button type="button" class="task-btn task-btn-ghost btn-undo">Deshacer entrega</button>`;
            area.querySelector('.btn-undo').addEventListener('click', () => undoSubmission(task));
            return;
        }
        // pendiente / vencida → acciones
        area.innerHTML = `
            <div class="task-actions">
                <button type="button" class="task-btn btn-done"><i class="fas fa-check"></i> Marcar como hecha</button>
                <button type="button" class="task-btn task-btn-alt btn-toggle-ev"><i class="fas fa-paper-plane"></i> Enviar evidencia</button>
            </div>
            <div class="task-evidence" style="display:none;">
                <input type="url" class="ev-link" placeholder="Pega un link (Drive, video, foto…)">
                <label class="ev-file-label"><i class="fas fa-image"></i> o sube una foto
                    <input type="file" class="ev-file" accept="image/*" hidden>
                </label>
                <span class="ev-status"></span>
                <button type="button" class="task-btn btn-send-ev">Enviar evidencia</button>
            </div>`;
        area.querySelector('.btn-done').addEventListener('click', () => saveSubmission(task, {}));
        const evBox     = area.querySelector('.task-evidence');
        const fileInput = area.querySelector('.ev-file');
        const evStatus  = area.querySelector('.ev-status');
        area.querySelector('.btn-toggle-ev').addEventListener('click', () => {
            evBox.style.display = evBox.style.display === 'none' ? 'block' : 'none';
        });
        area.querySelector('.ev-file-label').addEventListener('change', () => {
            if (fileInput.files[0]) { evStatus.textContent = fileInput.files[0].name; area.querySelector('.ev-link').value = ''; }
        });
        area.querySelector('.btn-send-ev').addEventListener('click', async () => {
            const link = area.querySelector('.ev-link').value.trim();
            const file = fileInput.files[0];
            if (!link && !file) { evStatus.textContent = 'Pega un link o elige una foto.'; return; }
            evStatus.textContent = 'Enviando…';
            try {
                let imageUrl = '';
                if (file) {
                    if (file.size > 8 * 1024 * 1024) { evStatus.textContent = 'Imagen muy grande (máx 8MB).'; return; }
                    imageUrl = await compressImage(file);
                }
                await saveSubmission(task, { link, imageUrl });
            } catch { evStatus.textContent = 'Error al enviar. Inténtalo de nuevo.'; }
        });
    };

    const renderTasks = () => {
        const container = document.getElementById('tasks-panel-content');
        if (!_tasks.length) {
            container.innerHTML = emptyState('No tienes tareas asignadas aún.', 'fa-tasks');
            updateTasksBadge(0);
            return;
        }
        // "Hoy" en hora LOCAL (no UTC) para que la tarea siga disponible
        // durante todo el día límite y se venza recién al día siguiente.
        const now = new Date();
        const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
        let pending = 0;
        container.innerHTML = '';

        [..._tasks].sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)).forEach(task => {
            const sub = _subs[task.id];
            let key, label;
            if (sub?.status === 'reviewed') { key = 'reviewed';  label = 'Revisada'; }
            else if (sub)                   { key = 'submitted'; label = 'Entregada'; }
            else if (task.dueDate && task.dueDate < today) { key = 'overdue'; label = 'Vencida'; }
            else { key = 'pending'; label = 'Pendiente'; }
            if (key === 'pending' || key === 'overdue') pending++;

            const isForAll = task.assignedTo === 'all';
            const dueStr   = task.dueDate ? new Date(`${task.dueDate}T00:00:00`).toLocaleDateString('es-PE') : '';

            const card = document.createElement('div');
            card.className = `task-card task-${key}`;
            card.innerHTML = `
                <div class="task-header">
                    <span class="task-status-pill ${key}">${label}</span>
                    <span class="task-assigned ${isForAll ? 'tag-all' : 'tag-personal'}">
                        <i class="fas ${isForAll ? 'fa-users' : 'fa-user'}"></i> ${isForAll ? 'Todos' : 'Personal'}
                    </span>
                </div>
                <h4 class="task-title">${task.title}</h4>
                ${task.description ? `<p class="task-desc">${task.description}</p>` : ''}
                ${dueStr ? `<p class="task-due"><i class="fas fa-calendar-day"></i> Vence: ${dueStr}</p>` : ''}
                ${task.url ? `<a href="${task.url}" target="_blank" rel="noopener" class="task-link">
                    <i class="fas fa-external-link-alt"></i> Ver recurso</a>` : ''}
                <div class="task-action-area"></div>
            `;
            buildTaskActions(card.querySelector('.task-action-area'), task, sub, key);
            container.appendChild(card);
        });
        updateTasksBadge(pending);
    };

    const listenTasks = (studentCode, studentName) => {
        _scode = studentCode || '';
        _sname = studentName || '';

        // Tareas asignadas (a todos o a este alumno)
        const assigneeCodes = _scode ? ['all', _scode] : ['all'];
        onSnapshot(
            query(collection(db, dbPath('tasks')), where('assignedTo', 'in', assigneeCodes)),
            (snap) => { _tasks = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderTasks(); }
        );

        // Entregas de este alumno (para estado, evidencia y calificación)
        if (_scode) {
            onSnapshot(
                query(collection(db, dbPath('task_submissions')), where('studentCode', '==', _scode)),
                (snap) => {
                    _subs = {};
                    snap.docs.forEach(d => { _subs[d.data().taskId] = d.data(); });
                    renderTasks();
                }
            );
        }
    };

    // ════════════════════════════════════════════════════════
    // TAB 4 — MATERIAL DIDÁCTICO
    // ════════════════════════════════════════════════════════
    const listenMaterials = () => {
        const container = document.getElementById('materials-panel-content');

        onSnapshot(collection(db, dbPath('materials')), (snap) => {
            container.innerHTML = '';
            if (snap.empty) {
                _materials = [];
                container.innerHTML = emptyState('No hay material disponible por ahora.', 'fa-book-open');
                return;
            }
            const materials = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            _materials = materials;   // disponible para el Aula del Curso

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
