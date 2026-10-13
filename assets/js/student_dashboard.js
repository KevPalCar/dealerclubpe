// ============================================================
// DASHBOARD DE ESTUDIANTE — DealerClub
// ============================================================
// Importa desde firebase.js. No re-inicialices Firebase aquí.
// ============================================================

import { auth, db, dbPath } from './firebase.js';
import { compressImage } from './image.js';
import {
    fmtDate, billingSchedule, billingSummary, daysLabel,
    referralDiscount, referralsInMonth, REFERRAL_FIRST, REFERRAL_EXTRA, REFERRAL_MAX
} from './billing.js';
import { normLevel, levelProgress } from './level.js';
import { chipBurst, chipCascade } from './chip-rain.js';
import { initCopyButtons } from './copy.js';
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
    initCopyButtons();

    // ── OVERLAY DE AUTENTICACIÓN ─────────────────────────────
    const overlay   = document.getElementById('auth-overlay');
    const hideOverlay = () => { if (overlay) overlay.style.display = 'none'; };

    // ── ESTADO DE ONBOARDING (alumno pendiente de aprobación) ─
    let pendingInfo   = null;   // {fullName, studentCode, email, suspended} si NO tiene acceso
    let campusStarted = false;  // tareas/material solo se cargan con acceso activo
    let isAdminUser   = false;
    let onboardingCfg = {};     // {videoUrl, title, text, whatsapp}
    const levelClass  = (level) => ({ 'Pro Dealer': 'level-pro', 'Elite Crew': 'level-elite' }[level] || 'level-rookie');

    // Video de bienvenida propio: si existe /assets/video/bienvenida.mp4 en el
    // sitio, se usa ese; si no, el video de presentación. Se comprueba una vez.
    const WELCOME_FILE = '/assets/video/bienvenida.mp4';
    let welcomeFile = null;     // null = aún comprobando; true/false = resultado
    fetch(WELCOME_FILE, { method: 'HEAD' })
        .then(r => r.ok && (r.headers.get('content-type') || '').startsWith('video/'))
        .catch(() => false)
        .then(found => { welcomeFile = found; renderPendingHero(); });

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
            levelEl.textContent = normLevel(roleData.level);
            levelEl.className   = `level-pill ${levelClass(normLevel(roleData.level))}`;

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
                renderPendingHero();
                if (!pendingInfo.suspended) initVoucherUpload(user, roleData);
            } else {
                renderActiveHome(roleData);
            }

            hideOverlay();
            document.getElementById('dash-body').style.visibility = 'visible';

            // Inicia los listeners de cada tab
            listenCourses(user.email);
            listenProgress(user.uid);
            if (isApproved) startCampus(roleData, user);
            else            lockCampusPanels();

            switchTab('home');

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
        if (roleData.studentCode) { renderReferral(roleData.studentCode); listenReferrals(roleData.studentCode); }
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

        // El aviso de vista previa acompaña a las pestañas bloqueadas, no al inicio.
        document.getElementById('preview-notice').style.display =
            pendingInfo && tabName !== 'home' ? 'block' : 'none';
        // El video de bienvenida no sigue sonando en otra pestaña.
        if (tabName === 'home') renderPendingHero();
        else stopWelcomeVideo();
    };

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === 'courses') closeCourse();   // la pestaña siempre abre la lista
            switchTab(btn.dataset.tab);
        });
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
            return { kind: 'iframe', src: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed`, vertical: true, insta: true };
        if ((m = url.match(/tiktok\.com\/.*\/video\/(\d+)/)))
            return { kind: 'iframe', src: `https://www.tiktok.com/embed/v2/${m[1]}`, vertical: true };
        if (/facebook\.com|fb\.watch/i.test(url))
            return { kind: 'iframe', src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false` };
        if ((m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/)))
            return { kind: 'iframe', src: `https://drive.google.com/file/d/${m[1]}/preview` };
        if (/\.(mp4|webm|mov)([?#]|$)/i.test(url)) return { kind: 'video', src: url };
        return { kind: 'link', src: url };
    };

    // Los navegadores solo permiten la reproducción automática SIN sonido.
    // El video arranca en silencio y el alumno activa el audio con un toque.
    // YouTube, Vimeo y Facebook aceptan la orden por parámetro; Instagram
    // y TikTok no la admiten y requieren que el alumno pulse reproducir.
    const withAutoplay = (src) => {
        const add = (params) => src + (src.includes('?') ? '&' : '?') + params;
        if (src.includes('youtube.com/embed/'))  return add('autoplay=1&mute=1&playsinline=1&rel=0');
        if (src.includes('player.vimeo.com/'))   return add('autoplay=1&muted=1');
        if (src.includes('facebook.com/plugins')) return add('autoplay=1&mute=1');
        return src;
    };

    const buildVideoEl = (v) => {
        let el;
        if (v.kind === 'iframe') {
            el = document.createElement('iframe');
            el.title = 'Bienvenida DealerClub';
            el.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
            el.allowFullscreen = true;
            el.setAttribute('frameborder', '0');
            // Sin barra de desplazamiento propia: el recorte de Instagram depende del ancho completo.
            if (v.insta) el.scrolling = 'no';
            el.src = withAutoplay(v.src);
        } else if (v.kind === 'video') {
            el = document.createElement('video');
            el.controls = true;
            el.playsInline = true;
            el.muted = true;
            el.autoplay = true;
            el.loop = true;
            el.preload = 'auto';
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

    // ── INICIO: qué piezas se ven en cada momento del alumno ──
    // La estructura es una sola (columna fija + columna de lectura);
    // cambian las piezas que la llenan.
    const homeHero = document.getElementById('home-hero');
    const HOME_PARTS = {
        pending:   ['home-media', 'pending-video-wrap', 'pending-steps', 'home-pay', 'pending-pay-area', 'pending-perks', 'pending-voucher-btn'],
        suspended: ['home-pay', 'pending-voucher-btn'],
        active:    ['home-media', 'home-card', 'home-invite', 'home-stats', 'home-alerts']
    };
    const HOME_ALL = [...new Set(Object.values(HOME_PARTS).flat())];
    let homeMode   = '';
    let videoShape = 'tall';    // 'tall' | 'wide' | 'link'

    // El video vertical llena la columna fija. Uno horizontal comparte su
    // columna con el curso, y un simple enlace deja todo en una columna.
    const applyHomeLayout = () => {
        const pending = homeMode === 'pending';
        homeHero.classList.toggle('is-wide', pending && videoShape === 'wide');
        homeHero.classList.toggle('is-stacked', homeMode === 'suspended' || (pending && videoShape === 'link'));
    };
    const setHomeMode = (mode) => {
        homeMode = mode;
        HOME_ALL.forEach(id => {
            document.getElementById(id).style.display = HOME_PARTS[mode].includes(id) ? '' : 'none';
        });
        // "Vas a dominar" es parte de la bienvenida y aparece cuando llega el curso.
        document.getElementById('home-course').style.display = mode === 'pending' && homeCourseLoaded ? '' : 'none';
        applyHomeLayout();
    };
    const setVideoShape = (shape) => { videoShape = shape; applyHomeLayout(); };

    const stopWelcomeVideo = () => {
        const box = document.getElementById('pending-video');
        box.querySelector('video')?.pause();
        // Un video incrustado no se puede pausar desde fuera: se retira y vuelve al regresar.
        if (box.querySelector('iframe')) { box.replaceChildren(); delete box.dataset.src; }
    };

    const renderPendingHero = () => {
        if (!pendingInfo) return;                       // solo aplica a no aprobados
        setHomeMode(pendingInfo.suspended ? 'suspended' : 'pending');

        if (pendingInfo.suspended) {
            document.getElementById('pending-tag').innerHTML = '<i class="fas fa-pause-circle"></i> Acceso suspendido';
            document.getElementById('pending-title').textContent = 'Tu acceso al campus está suspendido';
            document.getElementById('pending-text').textContent =
                (pendingInfo.reason ? `Motivo: ${pendingInfo.reason}. ` : '') +
                'Tu progreso sigue guardado. Escríbenos para reactivar tu acceso y retomar donde te quedaste.';
            document.getElementById('pending-wa-text').textContent = 'Reactivar mi acceso por WhatsApp';
        } else {
            document.getElementById('pending-title').textContent =
                onboardingCfg.title?.trim() || `¡Bienvenido a DealerClub, ${pendingInfo.fullName}!`;
            if (onboardingCfg.text?.trim())
                document.getElementById('pending-text').textContent = onboardingCfg.text;

            // Video: el enlace configurado en el admin; si no hay, el video
            // de presentación del sitio (nunca se reproduce solo).
            // Orden: enlace del admin → archivo bienvenida.mp4 → video de presentación.
            const box   = document.getElementById('pending-video');
            const video = resolveVideo(onboardingCfg.videoUrl)
                || (welcomeFile ? { kind: 'video', src: WELCOME_FILE } : {
                    kind: 'video',
                    src: '/assets/video/presentacion-dealerclub.mp4',
                    poster: '/assets/video/presentacion-dealerclub-poster.webp'
                });
            // Espera a saber si hay archivo propio para no cargar dos videos.
            if (welcomeFile !== null && box.dataset.src !== video.src) {   // evita recargar el reproductor
                box.dataset.src = video.src;
                const el = buildVideoEl(video);
                box.replaceChildren(el);

                // Forma del video: un enlace la trae en su dirección; un archivo
                // la dice al cargar (mientras tanto se asume vertical).
                const setWide = (wide) => {
                    box.classList.toggle('is-vertical', !wide);
                    setVideoShape(wide ? 'wide' : 'tall');
                };
                box.classList.toggle('is-link', video.kind === 'link');
                box.classList.toggle('is-insta', !!video.insta);
                // Un archivo de video propio lleva la cabecera de la escuela encima.
                document.getElementById('pending-video-wrap').classList.toggle('has-brand', video.kind === 'video');
                if (video.kind === 'link') setVideoShape('link');
                else if (video.kind === 'iframe') setWide(!video.vertical);
                else {
                    setWide(false);
                    el.addEventListener('loadedmetadata', () => setWide(el.videoWidth > el.videoHeight));
                }

                // Sonido: botón propio para un archivo de video; aviso para los incrustados.
                const soundBtn  = document.getElementById('pending-sound-btn');
                const soundHint = document.getElementById('pending-sound-hint');
                soundBtn.style.display  = video.kind === 'video'  ? 'inline-flex' : 'none';
                soundHint.style.display = video.kind === 'iframe' ? 'block' : 'none';
                if (video.kind === 'video') {
                    soundBtn.onclick = () => { el.muted = false; el.play(); soundBtn.style.display = 'none'; };
                    el.addEventListener('volumechange', () => { if (!el.muted) soundBtn.style.display = 'none'; });
                }
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
        const review   = document.getElementById('pending-review');
        const rejected  = document.getElementById('pending-rejected');
        const fileInput = document.getElementById('pending-file');
        const nameEl    = document.getElementById('pending-file-name');
        const btn       = document.getElementById('pending-upload-btn');
        const msg       = document.getElementById('pending-upload-msg');
        const stepLabel = document.querySelector('.pending-steps .step.current .step-label');

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
            } else {
                rejected.style.display = 'none';
            }
        });
    };

    // ── DATOS DE UN CURSO (se piden una sola vez por curso) ──
    // Juegos, descripción, horario y duración: lo que el admin edita en Cursos.
    const _courseCache = {};
    const courseInfo = (courseId) => _courseCache[courseId] ||=
        getDoc(doc(db, dbPath(`courses/${courseId}`)))
            .then(s => (s.exists() ? s.data() : null))
            .catch(() => null);
    const courseGames = (c) =>
        (Array.isArray(c.gamesIncluded) ? c.gamesIncluded : [c.gamesIncluded]).filter(Boolean);
    const fillGames = (list, games) => {
        list.innerHTML = '';
        games.forEach(g => { const li = document.createElement('li'); li.textContent = g; list.appendChild(li); });
    };
    const metaLine = (el, icon, text) => {
        el.textContent = '';
        if (!text) return;
        el.innerHTML = `<i class="fas ${icon}"></i> `;
        el.append(text);
    };

    // ── SU CURSO EN LA BIENVENIDA (alumno pendiente) ─────────
    // Lo que va a dominar en el curso al que se inscribió. Al alumno
    // activo ese detalle le aparece en Mis Cursos; aquí solo su carné.
    let homeCourseId     = null;
    let homeCourseLoaded = false;

    const renderHomeCourse = async (enrollment) => {
        if (enrollment?.courseName) document.getElementById('home-card-course').textContent = enrollment.courseName;
        if (!enrollment?.courseId || enrollment.courseId === homeCourseId) return;
        homeCourseId = enrollment.courseId;
        const c = await courseInfo(enrollment.courseId);
        if (!c) return;
        const name = c.name || enrollment.courseName || 'tu curso';
        document.getElementById('home-course-name').textContent = name;
        document.getElementById('home-card-course').textContent = name;
        fillGames(document.getElementById('home-course-games'), courseGames(c));
        document.getElementById('home-course-desc').textContent = c.description || '';
        metaLine(document.getElementById('home-course-schedule'), 'fa-clock', c.schedule);
        metaLine(document.getElementById('home-course-duration'), 'fa-calendar-alt', c.duration ? `Duración: ${c.duration}` : '');
        // El precio del curso acompaña a las cuentas donde se deposita.
        document.getElementById('pending-price').textContent = c.price ? ` (${c.price})` : '';
        homeCourseLoaded = true;
        if (homeMode) setHomeMode(homeMode);
    };

    // ── INICIO DEL ALUMNO ACTIVO ─────────────────────────────
    // Misma estructura que la bienvenida: el carné ocupa el lugar del
    // video y, a su lado, el avance y los pendientes que llevan a cada sección.
    const DEFAULT_PHOTO = '/assets/images/isotipo_principal.png';

    const renderActiveHome = (d) => {
        setHomeMode('active');
        const first = (d.fullName || '').split(' ')[0];
        document.getElementById('pending-tag').innerHTML = '<i class="fas fa-check-circle"></i> Alumno activo';
        document.getElementById('pending-title').textContent = `¡Hola de nuevo${first ? `, ${first}` : ''}!`;
        document.getElementById('pending-text').textContent = 'Esto es lo que tienes pendiente. Toca cualquier aviso para ir a su sección.';

        const photo = document.getElementById('home-card-photo');
        photo.src = d.photoUrl || DEFAULT_PHOTO;
        photo.parentElement.classList.toggle('has-photo', !!d.photoUrl);
        document.getElementById('home-card-name').textContent = d.fullName || 'Alumno DealerClub';
        const code = document.getElementById('home-card-code');
        code.textContent   = d.studentCode || '';
        code.style.display = d.studentCode ? '' : 'none';
        document.getElementById('home-card-start').textContent =
            d.courseStartDate ? fmtDate(d.courseStartDate) : 'Por confirmar';
        // Sin código no hay nada que compartir.
        if (!d.studentCode) document.getElementById('home-invite').style.display = 'none';
        renderHomeAlerts();
    };

    // Foto del carné: el alumno la cambia tocándola. Se guarda reducida
    // en su propia ficha (las reglas solo le dejan tocar ese campo).
    document.getElementById('home-card-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        const msg  = document.getElementById('home-card-msg');
        if (!file || !auth.currentUser) return;
        msg.textContent = 'Guardando tu foto…';
        try {
            await setDoc(doc(db, dbPath(`user_roles/${auth.currentUser.uid}`)),
                { photoUrl: await compressImage(file, 320) }, { merge: true });
            msg.textContent = '';
        } catch { msg.textContent = 'No se pudo guardar la foto. Inténtalo de nuevo.'; }
        e.target.value = '';
    });

    // ── PENDIENTES DEL INICIO ────────────────────────────────
    // Cada sección anota aquí su parte (pagos, tareas, notas) y el inicio
    // la convierte en avisos que llevan a donde se resuelven.
    const homeState = { billing: null, tasksDue: 0, tasksOverdue: 0, lastGrade: null, referral: null };
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    // Para avisar solo de lo nuevo (tareas calificadas, material) se recuerda
    // en este dispositivo cuándo abrió el alumno cada sección por última vez.
    const seenKey  = () => `dc-seen-${auth.currentUser?.uid || ''}`;
    const getSeen  = () => { try { return JSON.parse(localStorage.getItem(seenKey())) || {}; } catch { return {}; } };
    const markSeen = (section) => {
        try { localStorage.setItem(seenKey(), JSON.stringify({ ...getSeen(), [section]: Date.now() / 1000 })); }
        catch { /* navegador sin almacenamiento: el aviso simplemente no se apaga */ }
        renderHomeAlerts();
    };

    const renderHomeAlerts = () => {
        const alerts = [];   // { tone: 'danger' | 'warn' | 'info', icon, title, sub, go }
        const seen   = getSeen();
        const graded = Object.values(_subs).filter(x =>
            x.status === 'reviewed' && (x.reviewedAt?.seconds ?? 0) > (seen.tasks ?? 0));
        const fresh  = _materials.filter(m => (m.createdAt?.seconds ?? 0) > (seen.materials ?? 0));
        const { billing, tasksDue, tasksOverdue, lastGrade, referral } = homeState;

        if (billing && billing.state !== 'complete') {
            alerts.push({
                tone: billing.state === 'overdue' ? 'danger' : billing.state === 'soon' ? 'warn' : 'info',
                icon: 'fa-wallet', title: billing.title, sub: billing.sub, go: 'payments'
            });
        }
        if (tasksOverdue) alerts.push({
            tone: 'danger', icon: 'fa-tasks', go: 'tasks',
            title: `Tienes ${plural(tasksOverdue, 'tarea vencida', 'tareas vencidas')}`,
            sub: 'Ya pasó la fecha límite: entrega cuanto antes.'
        });
        if (tasksDue) alerts.push({
            tone: 'warn', icon: 'fa-tasks', go: 'tasks',
            title: `Tienes ${plural(tasksDue, 'tarea por entregar', 'tareas por entregar')}`,
            sub: 'Revisa la fecha límite en Tareas.'
        });
        if (lastGrade) alerts.push({
            tone: 'info', icon: 'fa-star', go: 'progress',
            title: `Tu última evaluación: ${lastGrade.score}/20`,
            sub: `Semana ${lastGrade.week ?? '—'}${lastGrade.note ? ` · "${lastGrade.note}"` : ''}`
        });

        if (graded.length) alerts.push({
            tone: 'info', icon: 'fa-clipboard-check', go: 'tasks',
            title: graded.length > 1 ? `Te calificaron ${graded.length} tareas`
                 : `Te calificaron "${graded[0].taskTitle || 'tu tarea'}"${graded[0].grade != null ? `: ${graded[0].grade}/20` : ''}`,
            sub: 'Mira la nota y el comentario de tu profesor.'
        });
        if (fresh.length) alerts.push({
            tone: 'info', icon: 'fa-book-open', go: 'materials',
            title: `Hay ${plural(fresh.length, 'material nuevo', 'materiales nuevos')}`,
            sub: fresh.slice(0, 2).map(m => m.title).filter(Boolean).join(' · ')
        });
        if (referral) alerts.push({
            tone: 'info', icon: 'fa-gift', go: 'payments',
            title: `Tienes ${referral.pct}% de descuento en tu cuota de este mes`,
            sub: `Por ${plural(referral.count, 'referido que pagó', 'referidos que pagaron')} el mes pasado con tu código.`
        });

        const order = { danger: 0, warn: 1, info: 2 };
        alerts.sort((a, b) => order[a.tone] - order[b.tone]);

        const list = document.getElementById('home-alerts-list');
        list.replaceChildren(...alerts.map(a => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `home-alert tone-${a.tone}`;
            btn.dataset.go = a.go;
            btn.innerHTML = `<i class="fas ${a.icon}"></i><span><strong></strong><small></small></span><i class="fas fa-chevron-right"></i>`;
            btn.querySelector('strong').textContent = a.title;
            btn.querySelector('small').textContent  = a.sub;
            return btn;
        }));
        // "Estás al día" cuando nada pide una acción (los avisos informativos no cuentan).
        document.getElementById('home-alerts-ok').style.display =
            alerts.some(a => a.tone !== 'info') ? 'none' : '';
    };

    // Quita el modo vitrina y pasa el inicio a su versión de alumno activo
    // (se llama al detectar la aprobación en vivo, cuando el admin valida el pago).
    const unlockDashboard = () => {
        pendingInfo = null;
        document.getElementById('dash-body').classList.remove('dash-pending');
        const box = document.getElementById('pending-video');
        box.replaceChildren();                                        // detiene el video de bienvenida
        delete box.dataset.src;
        document.getElementById('preview-notice').style.display = 'none';
        chipCascade();
    };

    // Clics del inicio: fichas al pulsar y atajos a cada sección.
    homeHero.addEventListener('click', (e) => {
        if (e.target.matches('input')) return;      // el clic que la etiqueta le pasa a su archivo
        const el = e.target.closest('button, a, .pending-file');
        if (!el) return;
        chipBurst(el);
        if (el.dataset.go) goTo(el.dataset.go);
    });

    // ── REFERIDOS: promueve el código del alumno (marketing) ──
    // El código aparece bajo el carné y en Pagos; ambos se llenan aquí.
    let _refCode = '';
    const renderReferral = (code) => {
        if (!code) return;
        _refCode = code;
        const site = window.location.origin || '';
        const msg  = `¡Hola! Estudio en DealerClub, la escuela de dealers/croupiers en Lima. ` +
                     `Inscríbete con mi código ${code}: ${site}/cursos?ref=${code}`;
        document.querySelectorAll('[data-ref="code"]').forEach(el => { el.textContent = code; });
        document.querySelectorAll('[data-ref="copy"]').forEach(el => { el.dataset.copy = code; });
        document.querySelectorAll('[data-ref="share"]').forEach(el => {
            el.href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
        });
        document.getElementById('referral-card').style.display = 'flex';
        renderReferralDiscount();
    };

    // Descuento del mes por referidos (la regla vive en billing.js).
    let _myReferrals = [];
    let _billing     = null;

    const monthName = (offset) => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth() + offset, 1).toLocaleDateString('es-PE', { month: 'long' });
    };
    const feeAfter = (pct) => {
        const fee = +_billing?.amount || 0;
        return fee ? `Tu cuota de S/ ${fee} queda en S/ ${+(fee * (1 - pct / 100)).toFixed(2)}. ` : '';
    };

    const renderReferralDiscount = () => {
        if (!_refCode) return;                 // sin código no hay referidos que contar

        // Lo que ganó el mes pasado: se descuenta en la cuota de este mes.
        const last    = referralsInMonth(_myReferrals, 1);
        const pctNow  = referralDiscount(last.length);
        const applied = document.getElementById('referral-applied');
        applied.style.display = pctNow ? 'flex' : 'none';
        document.getElementById('referral-applied-pct').textContent   = `${pctNow}%`;
        document.getElementById('referral-applied-title').textContent = `Tienes ${pctNow}% de descuento en tu cuota de ${monthName(0)}`;
        document.getElementById('referral-applied-sub').textContent   =
            `${feeAfter(pctNow)}Lo ganaste por ${plural(last.length, 'referido que pagó', 'referidos que pagaron')} en ${monthName(-1)}.`;

        // Lo que va ganando este mes: se descontará en la cuota del mes siguiente.
        const month = referralsInMonth(_myReferrals, 0);
        const pct   = referralDiscount(month.length);
        const next  = referralDiscount(month.length + 1);
        let title, sub;
        if (!pct) {
            title = `Gana ${REFERRAL_FIRST}% de descuento en tu cuota de ${monthName(1)}`;
            sub   = `${REFERRAL_FIRST}% por tu primer referido del mes y ${REFERRAL_EXTRA}% más por cada uno adicional (hasta ${REFERRAL_MAX}%). ` +
                    'Tu referido cuenta cuando paga su primera cuota. Lo que ganas en un mes se descuenta en tu cuota del mes siguiente y no se acumula.';
        } else {
            title = `En ${monthName(0)} llevas ${plural(month.length, 'referido', 'referidos')}: ${pct}% de descuento para tu cuota de ${monthName(1)}`;
            sub   = feeAfter(pct) + (next > pct ? `Un referido más este mes y subes a ${next}%.` : 'Llegaste al descuento máximo.');
        }
        document.getElementById('referral-discount-pct').textContent   = `${pct || REFERRAL_FIRST}%`;
        document.getElementById('referral-discount-title').textContent = title;
        document.getElementById('referral-discount-sub').textContent   = sub;
        document.getElementById('referral-discount-names').textContent =
            month.length ? `Pagaron con tu código: ${month.map(r => r.newStudentName).filter(Boolean).join(', ')}` : '';
        document.getElementById('referral-discount').classList.toggle('is-earned', pct > 0);
        document.getElementById('referral-discount').style.display = 'flex';

        homeState.referral = pctNow ? { pct: pctNow, count: last.length } : null;
        renderHomeAlerts();
    };

    const listenReferrals = (code) => {
        onSnapshot(query(collection(db, dbPath('referrals')), where('referrerCode', '==', code)), (snap) => {
            _myReferrals = snap.docs.map(d => d.data());
            renderReferralDiscount();
        }, () => { /* sin permiso de lectura aún: se queda la invitación */ });
    };

    // ════════════════════════════════════════════════════════
    // TAB — MIS CURSOS (lista) y AULA (Progreso / Tareas / Material)
    // ════════════════════════════════════════════════════════
    let _enrollments  = [];
    let currentCourse = null;   // inscripción abierta en el aula
    let _materials    = [];     // poblado por listenMaterials()

    const isEnrolled = (e) => ['active', 'activo', 'aprobado'].includes((e?.status || '').toLowerCase());

    const switchSub = (name) => {
        document.querySelectorAll('.sub-btn').forEach(b => b.classList.toggle('active', b.dataset.sub === name));
        document.querySelectorAll('.sub-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
        if (name !== 'progress') markSeen(name);    // apaga el aviso de novedades de esa sección
    };

    // Entra al aula de un curso, en la subpestaña pedida.
    const openCourse = async (enrollment, sub = 'progress') => {
        currentCourse = enrollment || null;
        const meta = document.getElementById('course-view-meta');
        document.getElementById('course-view-name').textContent = enrollment?.courseName || 'Mi curso';
        meta.textContent = '';
        document.getElementById('courses-list-view').style.display = 'none';
        document.getElementById('course-view').style.display = 'block';
        renderMaterials();
        switchSub(sub);

        const c = enrollment?.courseId ? await courseInfo(enrollment.courseId) : null;
        if (c && currentCourse === enrollment) {
            meta.textContent = [c.schedule, c.duration && `Duración: ${c.duration}`].filter(Boolean).join(' · ');
        }
    };
    const closeCourse = () => {
        currentCourse = null;
        document.getElementById('course-view').style.display = 'none';
        document.getElementById('courses-list-view').style.display = 'block';
    };

    document.getElementById('course-back').addEventListener('click', closeCourse);
    document.querySelectorAll('.sub-btn').forEach(btn => {
        btn.addEventListener('click', () => switchSub(btn.dataset.sub));
    });

    // Lleva a una pestaña o, si es una sección del aula, entra al curso
    // activo del alumno y la abre.
    const goTo = (target) => {
        if (!['progress', 'tasks', 'materials'].includes(target)) { switchTab(target); return; }
        switchTab('courses');
        openCourse(_enrollments.find(isEnrolled) || null, target);
    };

    const listenCourses = (email) => {
        const container = document.getElementById('courses-panel-content');
        const q = query(collection(db, dbPath('course_enrollments')), where('email', '==', email));

        onSnapshot(q, (snap) => {
            _enrollments = snap.docs
                .map(d => d.data())
                .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0));

            if (!pendingInfo?.suspended) {
                renderHomeCourse(_enrollments.find(e => e.type !== 'Lista de Espera'));
            }

            container.classList.remove('panel-loading');
            container.innerHTML = '';
            if (!_enrollments.length) {
                container.innerHTML = emptyState('No tienes cursos inscritos aún.', 'fa-graduation-cap');
                return;
            }
            _enrollments.forEach(enrollment => {
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
                } else if (isEnrolled(enrollment)) {
                    cardClass = 'card-active';
                    badgeText = '<i class="fas fa-check-circle"></i> Curso Activo';
                    btnHtml = `<button class="card-action-btn btn-enter">
                                   <i class="fas fa-door-open"></i> Entrar al curso
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
                    <div class="course-card-info" style="display:none;">
                        <p class="course-card-label">Lo que vas a dominar</p>
                        <ul class="pending-games"></ul>
                        <p class="course-card-desc"></p>
                        <p class="pending-course-meta"><span class="cc-schedule"></span><span class="cc-duration"></span></p>
                    </div>
                    ${btnHtml}
                `;
                container.appendChild(card);

                // "Entrar al curso" abre su aula: Progreso, Tareas y Material.
                card.querySelector('.btn-enter')
                    ?.addEventListener('click', () => openCourse(enrollment));

                // Detalle real del curso (juegos, horario, duración).
                if (enrollment.courseId) courseInfo(enrollment.courseId).then(c => {
                    if (!c) return;
                    fillGames(card.querySelector('.pending-games'), courseGames(c));
                    card.querySelector('.course-card-desc').textContent = c.description || '';
                    metaLine(card.querySelector('.cc-schedule'), 'fa-clock', c.schedule);
                    metaLine(card.querySelector('.cc-duration'), 'fa-calendar-alt', c.duration ? `Duración: ${c.duration}` : '');
                    card.querySelector('.course-card-info').style.display = '';
                });
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

    // ════════════════════════════════════════════════════════
    // EVOLUCIÓN — junto a la tarjeta del curso, en Mis Cursos
    // Gráfico de la nota semanal y racha de asistencia. Salen de las
    // notas y la lista que el admin ya registra; tocar lleva a Progreso.
    // ════════════════════════════════════════════════════════
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svgEl  = (tag, attrs, text) => {
        const n = document.createElementNS(SVG_NS, tag);
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        if (text != null) n.textContent = text;
        return n;
    };

    const renderEvoChart = (grades) => {
        const pts = (grades || []).filter(g => g && g.score != null)
            .map(g => ({ week: g.week, score: +g.score }))
            .sort((a, b) => (a.week || 0) - (b.week || 0));
        const box   = document.getElementById('evo-chart');
        const tip   = document.getElementById('evo-tip');
        const empty = document.getElementById('evo-chart-empty');
        const last  = pts.at(-1), prev = pts.at(-2);

        // Cifra principal: la última nota y cuánto subió o bajó.
        document.getElementById('evo-score').textContent = last ? last.score : '—';
        const delta = document.getElementById('evo-delta');
        const diff  = last && prev ? +(last.score - prev.score).toFixed(1) : null;
        delta.textContent = diff == null ? ''
            : diff === 0 ? '= igual que la semana anterior'
            : `${diff > 0 ? '▲ +' : '▼ '}${diff} vs. la semana anterior`;
        delta.className = `evo-delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`;
        document.getElementById('evo-avg').textContent = pts.length
            ? `Promedio: ${+(pts.reduce((s, p) => s + p.score, 0) / pts.length).toFixed(1)}` : '';

        box.querySelector('svg')?.remove();
        tip.style.display   = 'none';
        empty.style.display = pts.length < 2 ? '' : 'none';
        if (pts.length < 2) return;

        // Una sola serie y un solo eje: de la decena o quincena inferior a 20.
        const W = 640, H = 190, L = 30, R = 40, T = 12, B = 26, MAX = 20;
        const MIN = Math.min(15, Math.floor(Math.min(...pts.map(p => p.score)) / 5) * 5);
        const x = (i) => L + i * (W - L - R) / (pts.length - 1);
        const y = (v) => T + (MAX - v) / (MAX - MIN) * (H - T - B);

        const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
            'aria-label': `Nota semanal: de ${pts[0].score} en la semana ${pts[0].week} a ${last.score} en la semana ${last.week}` });
        for (let v = MIN; v <= MAX; v += 5) {
            svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: '#262320', 'stroke-width': 1 }));
            svg.append(svgEl('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#a8a39a' }, v));
        }
        // Con muchas semanas no caben todas las etiquetas: se salta de a pocas.
        const step = Math.ceil(pts.length / 10);
        pts.forEach((p, i) => {
            if (i % step === 0 || i === pts.length - 1)
                svg.append(svgEl('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', 'font-size': 11, fill: '#a8a39a' }, `S${p.week ?? i + 1}`));
        });
        const line = pts.map((p, i) => `${x(i)},${y(p.score)}`).join(' ');
        svg.append(svgEl('polygon', { points: `${x(0)},${y(MIN)} ${line} ${x(pts.length - 1)},${y(MIN)}`, fill: '#ffc107', 'fill-opacity': 0.08 }));
        svg.append(svgEl('polyline', { points: line, fill: 'none', stroke: '#ffc107', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

        pts.forEach((p, i) => {
            const isLast = i === pts.length - 1;
            svg.append(svgEl('circle', { cx: x(i), cy: y(p.score), r: isLast ? 5.5 : 4, fill: '#ffc107', stroke: '#161616', 'stroke-width': 2 }));
            const hit  = svgEl('circle', { cx: x(i), cy: y(p.score), r: 16, fill: 'transparent' });
            const show = () => {
                const d = i ? +(p.score - pts[i - 1].score).toFixed(1) : null;
                tip.textContent   = `Semana ${p.week ?? i + 1}: ${p.score}/20${d == null ? '' : ` (${d >= 0 ? '+' : ''}${d})`}`;
                tip.style.left    = `${x(i) / W * 100}%`;
                tip.style.top     = `${y(p.score) / H * 100}%`;
                tip.style.display = 'block';
            };
            hit.addEventListener('mouseenter', show);
            hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
            svg.append(hit);
        });
        svg.append(svgEl('text', { x: x(pts.length - 1) + 10, y: y(last.score) + 4, 'font-size': 13, 'font-weight': 700, fill: '#f0f0f0' }, last.score));
        box.prepend(svg);
    };

    const renderEvoStreak = (log) => {
        const days = Object.keys(log || {}).sort();          // 'YYYY-MM-DD'
        let current = 0;
        for (let i = days.length - 1; i >= 0 && log[days[i]] === 'present'; i--) current++;
        let best = 0, run = 0;
        days.forEach(k => { run = log[k] === 'present' ? run + 1 : 0; best = Math.max(best, run); });

        document.getElementById('evo-streak-n').textContent = current;
        document.getElementById('evo-streak-label').textContent = current === 1 ? 'clase seguida' : 'clases seguidas';
        document.getElementById('evo-streak-note').textContent =
            !days.length          ? 'Tu racha empieza con tu primera clase.'
            : current === 0       ? 'Tu última clase figura como falta. La próxima empieza una racha nueva.'
            : current >= best     ? '¡Es tu mejor racha! No la rompas.'
            : `Tu mejor racha: ${best}. Vas por ${current}.`;

        const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        document.getElementById('evo-days').replaceChildren(...days.slice(-7).map(k => {
            const dt   = new Date(`${k}T00:00:00`);
            const cell = document.createElement('div');
            cell.className = log[k] === 'present' ? 'yes' : 'no';
            cell.title     = log[k] === 'present' ? 'Asististe' : 'Faltaste';
            cell.innerHTML = '<i></i>';
            cell.append(`${DOW[dt.getDay()]} ${dt.getDate()}`);
            return cell;
        }));
    };

    // ── NIVEL DE DEALER ──────────────────────────────────────
    // Se recalcula cuando cambia su ficha o sus tareas y se muestra en la
    // cabecera, el carné, Progreso y el camino de nivel de Mis Cursos.
    let _role        = null;     // última ficha recibida
    let _tasksLoaded = false;

    const renderLevel = () => {
        if (!_role) return;
        const info = levelProgress(_role, _tasksLoaded
            ? { total: _tasks.length, done: _tasks.filter(t => _subs[t.id]).length } : null);

        [['dash-level-pill', 'level-pill'], ['home-card-level', 'level-pill'], ['prog-level-val', 'prog-val']].forEach(([id, base]) => {
            const el = document.getElementById(id);
            el.textContent = info.level;
            el.className   = `${base} ${levelClass(info.level)}`;
        });

        document.getElementById('evo-level-fill').style.width = `${Math.round(info.progress * 100)}%`;
        document.querySelectorAll('#evo-level-stops span').forEach(el =>
            el.classList.toggle('cur', el.textContent === info.level));
        document.getElementById('evo-level-title').textContent =
            info.next ? `Para subir a ${info.next}:` : '¡Llegaste a Elite Crew, el nivel más alto!';

        const checks = [...info.checks];
        if (info.next === 'Elite Crew') checks.push({
            label: 'Visto bueno de la escuela', ok: false,
            text: info.eliteReady ? 'ya cumples todo: tu profesor lo está evaluando' : 'se evalúa cuando cumples lo demás'
        });
        document.getElementById('evo-level-checks').replaceChildren(...checks.map(c => {
            const li = document.createElement('li');
            li.className = c.ok ? 'ok' : '';
            li.innerHTML = `<i class="fas ${c.ok ? 'fa-check-circle' : 'fa-circle'}"></i><span><strong></strong> </span>`;
            li.querySelector('strong').textContent = `${c.label}:`;
            li.querySelector('span').append(c.text);
            return li;
        }));
        document.getElementById('evo-level-note').textContent =
            !info.next ? 'Puedes aparecer en nuestra web como Dealer Destacado y estás en la lista para los eventos del Casino de Fantasía.'
            : info.next === 'Elite Crew' ? 'Los Elite Crew aparecen en nuestra web como Dealers Destacados y entran a la lista para los eventos del Casino de Fantasía.'
            : 'Tu nivel sube solo cuando cumples todo. El tiempo es un estimado según la duración de tu curso.';
    };

    const renderEvolution = (d) => {
        renderEvoChart(d.weeklyGrades);
        renderEvoStreak(d.attendanceLog);
        document.getElementById('course-evo').style.display = '';
        document.getElementById('courses-layout').classList.add('has-evo');
    };
    document.getElementById('course-evo').addEventListener('click', () => goTo('progress'));

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
                    switchTab('home');
                } else if (!pendingInfo && d.status !== 'active') {
                    window.location.reload();
                    return;
                }
            }

            // Inicio y Mis Pagos: solo con acceso activo (el pendiente ve el candado)
            if (isAdminUser || d.status === 'active') {
                renderActiveHome(d);
                renderEvolution(d);
                renderPayments(d.billing);
            }

            // Nivel: sale de su tiempo, asistencia, notas y tareas (level.js)
            _role = d;
            renderLevel();

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
                document.getElementById('home-stat-att').textContent = `${pct}%`;
            } else if (attVal) {
                attVal.textContent = 'Sin datos';
            }

            // Notas: promedio de las notas semanales (fallback al promedio legado)
            const scored = (d.weeklyGrades || []).filter(g => g && g.score != null);
            homeState.lastGrade = [...scored].sort((a, b) => (a.week || 0) - (b.week || 0)).pop() || null;
            renderHomeAlerts();
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
                document.getElementById('home-stat-grade').textContent = `${avg}/20`;
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
        _billing = billing || null;
        renderReferralDiscount();
        const box      = document.getElementById('payments-panel-content');
        const badge    = document.getElementById('payments-badge');
        const sum      = billingSummary(billing);
        const schedule = billingSchedule(billing);
        box.classList.remove('panel-loading');

        if (sum.state === 'unset') {
            badge.style.display = 'none';
            box.innerHTML = emptyState('Aún no registramos tu plan de pagos. Aparecerá aquí en cuanto lo configuremos.', 'fa-wallet');
            homeState.billing = null;
            renderHomeAlerts();
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
        homeState.billing = { state: sum.state, title, sub };
        renderHomeAlerts();
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

    // Pendientes de entrega: insignia en Mis Cursos y en la subpestaña
    // Tareas, cifra y avisos del inicio.
    const updateTasksBadge = (n, overdue = 0) => {
        ['tasks-badge', 'courses-badge'].forEach(id => {
            const badge = document.getElementById(id);
            badge.textContent = n;
            badge.style.display = n > 0 ? 'inline-flex' : 'none';
        });
        document.getElementById('home-stat-tasks').textContent = n;
        homeState.tasksOverdue = overdue;
        homeState.tasksDue     = n - overdue;
        renderHomeAlerts();
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
        let pending = 0, overdue = 0;
        container.classList.remove('panel-loading');
        container.innerHTML = '';

        [..._tasks].sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)).forEach(task => {
            const sub = _subs[task.id];
            let key, label;
            if (sub?.status === 'reviewed') { key = 'reviewed';  label = 'Revisada'; }
            else if (sub)                   { key = 'submitted'; label = 'Entregada'; }
            else if (task.dueDate && task.dueDate < today) { key = 'overdue'; label = 'Vencida'; }
            else { key = 'pending'; label = 'Pendiente'; }
            if (key === 'pending' || key === 'overdue') pending++;
            if (key === 'overdue') overdue++;

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
        updateTasksBadge(pending, overdue);
    };

    const listenTasks = (studentCode, studentName) => {
        _scode = studentCode || '';
        _sname = studentName || '';

        // Tareas asignadas (a todos o a este alumno)
        const assigneeCodes = _scode ? ['all', _scode] : ['all'];
        onSnapshot(
            query(collection(db, dbPath('tasks')), where('assignedTo', 'in', assigneeCodes)),
            (snap) => {
                _tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                _tasksLoaded = true;
                renderTasks();
                renderLevel();
            }
        );

        // Entregas de este alumno (para estado, evidencia y calificación)
        if (_scode) {
            onSnapshot(
                query(collection(db, dbPath('task_submissions')), where('studentCode', '==', _scode)),
                (snap) => {
                    _subs = {};
                    snap.docs.forEach(d => { _subs[d.data().taskId] = d.data(); });
                    renderTasks();
                    renderLevel();
                }
            );
        }
    };

    // ════════════════════════════════════════════════════════
    // TAB 4 — MATERIAL DIDÁCTICO
    // ════════════════════════════════════════════════════════
    // Dentro del aula se muestra el material de ese curso y el general.
    const renderMaterials = () => {
        const container = document.getElementById('materials-panel-content');
        const cid   = currentCourse?.courseId;
        const cname = currentCourse?.courseName;
        const materials = _materials.filter(m =>
            !currentCourse || (!m.courseId && !m.courseName) ||
            (cid && m.courseId === cid) || (cname && m.courseName === cname));

        container.classList.remove('panel-loading');
        container.innerHTML = '';
        if (!materials.length) {
            container.innerHTML = emptyState('No hay material disponible por ahora.', 'fa-book-open');
            return;
        }
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
    };

    const listenMaterials = () => {
        onSnapshot(collection(db, dbPath('materials')), (snap) => {
            _materials = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            renderMaterials();
            renderHomeAlerts();
        });
    };

    // ── HELPER: EMPTY STATE ──────────────────────────────────
    const emptyState = (msg, icon = 'fa-inbox') =>
        `<div class="empty-state">
            <i class="fas ${icon}"></i>
            <p>${msg}</p>
        </div>`;
});
