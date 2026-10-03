// ============================================================
// DASHBOARD DE ESTUDIANTE — DealerClub
// ============================================================
// Importa desde firebase.js. No re-inicialices Firebase aquí.
// ============================================================

import { auth, db, dbPath } from './firebase.js';
import { compressImage } from './image.js';
import { fmtDate, billingSchedule, billingSummary, daysLabel } from './billing.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    doc, getDoc, setDoc, addDoc, deleteDoc, collection, query, where, onSnapshot
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

    // ── ESTADO DE ONBOARDING (alumno pendiente de aprobación) ─
    let pendingInfo   = null;   // {fullName, studentCode, email, suspended} si NO tiene acceso
    let campusStarted = false;  // tareas/material solo se cargan con acceso activo
    let isAdminUser   = false;
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

            // ¿Con acceso? El admin siempre; el alumno solo con status 'active'
            // (lo pone el admin al aprobar). Pendiente o suspendido ve la vitrina.
            // Las reglas de Firestore aplican el mismo criterio a tareas y material.
            isAdminUser = roleData.role === 'admin';
            const isApproved = isAdminUser || roleData.status === 'active';
            if (!isApproved) {
                pendingInfo = {
                    fullName:    (roleData.fullName || user.email || 'Estudiante').split(' ')[0],
                    studentCode: roleData.studentCode || '',
                    email:       user.email || '',
                    suspended:   roleData.status === 'suspended',
                    reason:      roleData.statusReason || ''
                };
                document.getElementById('dash-body').classList.add('dash-pending');
                document.getElementById('preview-notice').style.display = 'block';
                renderPendingHero();
                if (!pendingInfo.suspended) initVoucherUpload(user, roleData);
            }

            hideOverlay();
            document.getElementById('dash-body').style.visibility = 'visible';

            // Inicia los listeners de cada tab
            listenCourses(user.email);
            listenProgress(user.uid);
            if (isApproved) startCampus(roleData, user);
            else            lockCampusPanels();

            switchTab('courses');

        } catch {
            await signOut(auth);
            window.location.replace('/iniciar-sesion');
        }
    });

    // ── CONTENIDO DEL CAMPUS (solo con acceso activo) ────────
    const startCampus = (roleData, user = auth.currentUser) => {
        if (campusStarted) return;
        campusStarted = true;
        listenTasks(roleData.studentCode, roleData.fullName);
        listenMaterials();
        initPayReport(user, roleData);
        // Promoción de referidos: solo alumnos aprobados con código.
        if (roleData.studentCode) renderReferral(roleData.studentCode, roleData.fullName);
    };

    const lockCampusPanels = () => {
        document.getElementById('tasks-panel-content').innerHTML =
            emptyState('Tus tareas aparecerán aquí al activar tu acceso.', 'fa-lock');
        document.getElementById('materials-panel-content').innerHTML =
            emptyState('El material se desbloquea al activar tu acceso.', 'fa-lock');
        document.getElementById('payments-panel-content').innerHTML =
            emptyState('Tus pagos mes a mes aparecerán aquí al activar tu acceso.', 'fa-lock');
    };

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
    // Convierte el enlace del video de bienvenida en algo reproducible:
    //   { kind: 'iframe' | 'video' | 'link', src, vertical }
    // 'link' es el respaldo para sitios que no permiten incrustarse.
    const resolveVideo = (raw) => {
        let url = (raw || '').trim();
        if (!url.includes('.')) return null;
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;   // pegado sin "https://"
        let m;
        if (url.includes('youtube.com/embed/')) return { kind: 'iframe', src: url };
        if ((m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/)))
            return { kind: 'iframe', src: `https://www.youtube.com/embed/${m[1]}`, vertical: url.includes('/shorts/') };
        if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)))
            return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` };
        if ((m = url.match(/instagram\.com\/(?:[\w.]+\/)?(reels?|p|tv)\/([\w-]+)/)))
            return { kind: 'iframe', src: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed`, vertical: true };
        if ((m = url.match(/tiktok\.com\/.*\/video\/(\d+)/)))
            return { kind: 'iframe', src: `https://www.tiktok.com/embed/v2/${m[1]}`, vertical: true };
        if (/facebook\.com|fb\.watch/i.test(url))
            return { kind: 'iframe', src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false` };
        if ((m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/)))
            return { kind: 'iframe', src: `https://drive.google.com/file/d/${m[1]}/preview` };
        if (/\.(mp4|webm|mov)([?#]|$)/i.test(url)) return { kind: 'video', src: url };
        return { kind: 'link', src: url };
    };

    const buildVideoEl = (v) => {
        let el;
        if (v.kind === 'iframe') {
            el = document.createElement('iframe');
            el.title = 'Bienvenida DealerClub';
            el.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
            el.allowFullscreen = true;
            el.setAttribute('frameborder', '0');
            el.src = v.src;
        } else if (v.kind === 'video') {
            el = document.createElement('video');
            el.controls = true;
            el.playsInline = true;
            el.preload = 'none';
            if (v.poster) el.poster = v.poster;
            el.src = v.src;
        } else {
            el = document.createElement('a');
            el.className = 'pending-video-link';
            el.href = v.src;
            el.target = '_blank';
            el.rel = 'noopener';
            el.innerHTML = '<i class="fas fa-play-circle"></i> Ver el video de bienvenida';
        }
        return el;
    };

    const renderPendingHero = () => {
        if (!pendingInfo) return;                       // solo aplica a no aprobados
        document.getElementById('pending-hero').style.display = 'block';

        if (pendingInfo.suspended) {
            document.getElementById('pending-tag').innerHTML = '<i class="fas fa-pause-circle"></i> Acceso suspendido';
            document.getElementById('pending-title').textContent = 'Tu acceso al campus está suspendido';
            document.getElementById('pending-text').textContent =
                (pendingInfo.reason ? `Motivo: ${pendingInfo.reason}. ` : '') +
                'Tu progreso sigue guardado. Escríbenos para reactivar tu acceso y retomar donde te quedaste.';
            // La bienvenida, los pasos de alta y la activación no aplican a un suspendido.
            ['pending-video-wrap', 'pending-course', 'pending-activate'].forEach(id =>
                document.getElementById(id).style.display = 'none');
            document.querySelector('.pending-steps').style.display = 'none';
            document.getElementById('pending-wa-text').textContent = 'Reactivar mi acceso por WhatsApp';
        } else {
            document.getElementById('pending-title').textContent =
                onboardingCfg.title?.trim() || `¡Bienvenido a DealerClub, ${pendingInfo.fullName}!`;
            if (onboardingCfg.text?.trim())
                document.getElementById('pending-text').textContent = onboardingCfg.text;

            // Video: el enlace configurado en el admin; si no hay, el video
            // de presentación del sitio (nunca se reproduce solo).
            const box   = document.getElementById('pending-video');
            const video = resolveVideo(onboardingCfg.videoUrl) || {
                kind: 'video',
                src: '/assets/video/presentacion-dealerclub.mp4',
                poster: '/assets/video/presentacion-dealerclub-poster.webp'
            };
            if (box.dataset.src !== video.src) {        // evita recargar el reproductor
                box.dataset.src = video.src;
                box.className = `pending-video${video.vertical ? ' is-vertical' : ''}${video.kind === 'link' ? ' is-link' : ''}`;
                box.replaceChildren(buildVideoEl(video));
            }
        }

        // CTA: enviar voucher por WhatsApp con datos prellenados
        const phone    = onboardingCfg.whatsapp || '51929610747';
        const codePart = pendingInfo.studentCode ? ` (código ${pendingInfo.studentCode})` : '';
        const msg      = pendingInfo.suspended
            ? `Hola DealerClub, soy ${pendingInfo.fullName}${codePart}. Mi acceso al campus está suspendido y quiero reactivarlo.`
            : `Hola DealerClub, soy ${pendingInfo.fullName}. Me registré en el campus y tengo una consulta para activar mi acceso.`;
        const btn      = document.getElementById('pending-voucher-btn');
        btn.href   = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
        btn.target = '_blank';
        btn.rel    = 'noopener';
    };

    // ── CONSTANCIA DE PAGO (alumno pendiente) ────────────────
    // El alumno sube la foto de su depósito; el admin la valida en
    // Alumnos y el campus se abre solo. Si la rechaza, puede subir otra.
    const initVoucherUpload = (user, roleData) => {
        const box       = document.getElementById('pending-activate');
        const payBox    = document.getElementById('pending-pay');
        const openBtn   = document.getElementById('pending-activate-btn');
        const review    = document.getElementById('pending-review');
        const rejected  = document.getElementById('pending-rejected');
        const fileInput = document.getElementById('pending-file');
        const nameEl    = document.getElementById('pending-file-name');
        const btn       = document.getElementById('pending-upload-btn');
        const msg       = document.getElementById('pending-upload-msg');
        const stepLabel = document.querySelector('.pending-steps .step.current .step-label');

        const openPay = () => { payBox.style.display = 'block'; openBtn.style.display = 'none'; };
        openBtn.addEventListener('click', openPay);

        fileInput.addEventListener('change', () => {
            if (fileInput.files[0]) nameEl.textContent = fileInput.files[0].name;
        });

        btn.addEventListener('click', async () => {
            const file = fileInput.files[0];
            if (!file) { msg.textContent = 'Primero elige la foto de tu constancia.'; return; }
            if (file.size > 8 * 1024 * 1024) { msg.textContent = 'Imagen muy grande (máx 8MB).'; return; }
            btn.disabled = true;
            msg.textContent = 'Subiendo…';
            try {
                await addDoc(collection(db, dbPath('payments')), {
                    uid:         user.uid,
                    email:       user.email || '',
                    studentName: roleData.fullName || '',
                    type:        'matricula',
                    imageUrl:    await compressImage(file),
                    note:        '',
                    status:      'reported',
                    createdAt:   new Date()
                });
                fileInput.value = '';
                nameEl.textContent = 'Elegir foto de mi constancia';
            } catch { msg.textContent = 'No se pudo subir. Inténtalo de nuevo.'; }
            btn.disabled = false;
        });

        onSnapshot(query(collection(db, dbPath('payments')), where('uid', '==', user.uid)), (snap) => {
            const last = snap.docs.map(d => d.data())
                .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))[0];
            const inReview = last?.status === 'reported';
            box.style.display    = inReview ? 'none' : 'block';
            review.style.display = inReview ? 'flex' : 'none';
            if (stepLabel) stepLabel.textContent = inReview ? 'Constancia en revisión' : 'Activa tu acceso';
            if (last?.status === 'rejected') {
                rejected.textContent = `Tu constancia anterior no fue aceptada${last.rejectReason ? `: ${last.rejectReason}` : ''}. Sube una nueva.`;
                rejected.style.display = 'block';
                openPay();
            } else {
                rejected.style.display = 'none';
            }
        });
    };

    // ── LO QUE LE ESPERA EN SU CURSO (alumno pendiente) ──────
    // Juegos y horario reales del curso al que se inscribió.
    let pendingCourseId = null;
    const renderPendingCourse = async (enrollment) => {
        if (!enrollment?.courseId || enrollment.courseId === pendingCourseId) return;
        pendingCourseId = enrollment.courseId;
        try {
            const cs = await getDoc(doc(db, dbPath(`courses/${enrollment.courseId}`)));
            if (!cs.exists()) return;
            const c     = cs.data();
            const games = (Array.isArray(c.gamesIncluded) ? c.gamesIncluded : [c.gamesIncluded]).filter(Boolean);
            if (!games.length) return;

            document.getElementById('pending-course-name').textContent = c.name || enrollment.courseName || 'tu curso';
            const list = document.getElementById('pending-games');
            list.innerHTML = '';
            games.forEach(g => { const li = document.createElement('li'); li.textContent = g; list.appendChild(li); });
            const sched = document.getElementById('pending-schedule');
            sched.textContent = '';
            if (c.schedule) {
                sched.innerHTML = '<i class="fas fa-clock"></i> ';
                sched.append(c.schedule);
            }
            document.getElementById('pending-course').style.display = 'block';
        } catch { /* sin el bloque del curso, el resto de la bienvenida sigue igual */ }
    };

    // Quita el modo vitrina y oculta el hero (se llama al detectar aprobación,
    // incluso en vivo cuando el admin valida el pago).
    const unlockDashboard = () => {
        pendingInfo = null;
        document.getElementById('dash-body').classList.remove('dash-pending');
        document.getElementById('pending-hero').style.display = 'none';
        document.getElementById('pending-video').innerHTML = '';   // detiene el video de bienvenida
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
            if (pendingInfo && !pendingInfo.suspended) {
                renderPendingCourse(snap.docs.map(d => d.data())
                    .filter(e => e.type !== 'Lista de Espera')
                    .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0))[0]);
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

            // Acceso EN VIVO: se desbloquea cuando el admin aprueba y se
            // vuelve a bloquear si el alumno pasa a suspendido.
            if (!isAdminUser) {
                if (pendingInfo && d.status === 'active') {
                    // El código se asigna al aprobar: lo mostramos al momento.
                    document.getElementById('dash-student-code').textContent =
                        d.studentCode ? `Código: ${d.studentCode}` : '';
                    unlockDashboard();
                    startCampus(d);
                } else if (!pendingInfo && d.status !== 'active') {
                    window.location.reload();
                    return;
                }
            }

            // Mis Pagos: solo con acceso activo (el pendiente ve el candado)
            if (isAdminUser || d.status === 'active') renderPayments(d.billing);

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
    // TAB — MIS PAGOS (resumen, línea de tiempo y reporte de pago)
    // ════════════════════════════════════════════════════════
    const PAY_ICON = { paid: 'fa-check', overdue: 'fa-exclamation', soon: 'fa-clock', next: 'fa-clock', future: 'fa-circle' };

    const renderPayments = (billing) => {
        const box      = document.getElementById('payments-panel-content');
        const badge    = document.getElementById('payments-badge');
        const sum      = billingSummary(billing);
        const schedule = billingSchedule(billing);
        box.classList.remove('panel-loading');

        if (sum.state === 'unset') {
            badge.style.display = 'none';
            box.innerHTML = emptyState('Aún no registramos tu plan de pagos. Aparecerá aquí en cuanto lo configuremos.', 'fa-wallet');
            return;
        }
        badge.style.display = ['soon', 'overdue'].includes(sum.state) ? 'inline-flex' : 'none';

        // Tarjeta resumen
        const pct = Math.round(sum.paidCount / sum.total * 100);
        let big, title, sub;
        if (sum.state === 'complete') {
            big = '<i class="fas fa-trophy"></i>';
            title = '¡Completaste todos tus pagos!';
            sub = `${sum.total} de ${sum.total} cuotas pagadas`;
        } else {
            big = `<strong>${Math.abs(sum.days)}</strong><span>día${Math.abs(sum.days) === 1 ? '' : 's'}</span>`;
            title = sum.state === 'overdue'
                ? `Tu cuota ${sum.n} venció el ${fmtDate(sum.due)}`
                : `Tu próximo pago vence el ${fmtDate(sum.due)}`;
            sub = `Cuota ${sum.n} de ${sum.total}${billing.amount != null ? ` · S/ ${billing.amount}` : ''} · ${daysLabel(sum.days)}`;
        }
        box.innerHTML = `
            <div class="pay-summary pay-${sum.state}">
                <div class="pay-days">${big}</div>
                <div class="pay-summary-body">
                    <h3>${title}</h3>
                    <p>${sub}</p>
                    <div class="pay-bar"><div style="width:${pct}%"></div></div>
                    <small>Llevas ${sum.paidCount} de ${sum.total} cuotas pagadas</small>
                </div>
            </div>
            <ol class="pay-timeline">
                ${schedule.map(c => `
                    <li class="pay-item ${c.state}">
                        <span class="pay-dot"><i class="fas ${PAY_ICON[c.state]}"></i></span>
                        <div>
                            <strong>Cuota ${c.n}</strong>
                            <span>${c.state === 'paid'
                                ? `Pagado el ${fmtDate(c.payment.paidAt)} · S/ ${c.payment.amount}`
                                : `Vence el ${fmtDate(c.due)}${c.days != null ? ` · ${daysLabel(c.days)}` : ''}`}</span>
                        </div>
                    </li>`).join('')}
            </ol>`;
        document.getElementById('pay-report').style.display = sum.state === 'complete' ? 'none' : 'block';
    };

    // El alumno activo reporta el pago de su siguiente cuota subiendo la
    // constancia; el admin la confirma y la cuota se marca pagada aquí.
    const initPayReport = (user, roleData) => {
        if (!user || isAdminUser) return;
        const form      = document.getElementById('pay-report-form');
        const review    = document.getElementById('pay-report-review');
        const fileInput = document.getElementById('pay-report-file');
        const nameEl    = document.getElementById('pay-report-name');
        const btn       = document.getElementById('pay-report-btn');
        const msg       = document.getElementById('pay-report-msg');

        fileInput.addEventListener('change', () => {
            if (fileInput.files[0]) nameEl.textContent = fileInput.files[0].name;
        });
        btn.addEventListener('click', async () => {
            const file = fileInput.files[0];
            if (!file) { msg.textContent = 'Primero elige la foto de tu constancia.'; return; }
            if (file.size > 8 * 1024 * 1024) { msg.textContent = 'Imagen muy grande (máx 8MB).'; return; }
            btn.disabled = true;
            msg.textContent = 'Subiendo…';
            try {
                await addDoc(collection(db, dbPath('payments')), {
                    uid:         user.uid,
                    email:       user.email || '',
                    studentName: roleData.fullName || '',
                    type:        'mensualidad',
                    imageUrl:    await compressImage(file),
                    note:        '',
                    status:      'reported',
                    createdAt:   new Date()
                });
                fileInput.value = '';
                nameEl.textContent = 'Elegir foto de mi constancia';
                msg.textContent = '';
            } catch { msg.textContent = 'No se pudo subir. Inténtalo de nuevo.'; }
            btn.disabled = false;
        });

        onSnapshot(query(collection(db, dbPath('payments')), where('uid', '==', user.uid)), (snap) => {
            const last = snap.docs.map(d => d.data())
                .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))[0];
            const inReview = last?.status === 'reported';
            form.style.display   = inReview ? 'none' : 'block';
            review.style.display = inReview ? 'flex' : 'none';
            if (last?.status === 'rejected') {
                msg.textContent = `Tu constancia anterior no fue aceptada${last.rejectReason ? `: ${last.rejectReason}` : ''}. Sube una nueva.`;
            }
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
