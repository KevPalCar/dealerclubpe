import { auth, db, dbPath } from './firebase.js';
import { compressImage } from './image.js';
import { initCopyButtons } from './copy.js';
import { parseReferralCode } from './billing.js';
import { COMUNES_POR_DEFECTO } from './cursos-comunes.js';
import { renderCourseCard } from './cursos-tarjeta.js';
import { onAuthStateChanged, createUserWithEmailAndPassword, sendEmailVerification } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { collection, addDoc, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    initCopyButtons();
    // Quien llega por el enlace de un alumno ya trae su código de referido.
    const enrollReferral = document.getElementById('enrollReferral');
    enrollReferral.value = new URLSearchParams(location.search).get('ref') || '';
    const studentAccessLink       = document.getElementById('student-access-link');
    const coursesGridContainer    = document.getElementById('courses-grid-container');
    const loadingCoursesMessage   = document.getElementById('loading-courses');
    const noCoursesMessage        = document.getElementById('no-courses-message');
    const enrollCourseModal       = document.getElementById('enrollCourseModal');
    const closeEnrollModalBtn     = document.getElementById('closeEnrollModalBtn');
    const enrollCourseName        = document.getElementById('enrollCourseName');
    const enrollmentForm          = document.getElementById('enrollmentForm');
    const enrollCourseId          = document.getElementById('enrollCourseId');
    const enrollFullName          = document.getElementById('enrollFullName');
    const enrollEmail             = document.getElementById('enrollEmail');
    const enrollPhone             = document.getElementById('enrollPhone');
    const enrollComments          = document.getElementById('enrollComments');
    const enrollDni               = document.getElementById('enrollDni');
    const enrollVoucherFile       = document.getElementById('enrollVoucherFile');
    const enrollIsWaitlist        = document.getElementById('enrollIsWaitlist');
    const enrollFormMessage       = document.getElementById('enrollFormMessage');
    const announceBar             = document.getElementById('announce-bar');
    const announceTextElement     = document.getElementById('announce-text');
    const closeAnnounceBarBtn     = document.getElementById('close-announce-bar');
    const pageName                = document.body.getAttribute('data-page');

    // ── ANNOUNCE BAR ─────────────────────────────────────────
    if (announceBar && pageName) {
        onSnapshot(doc(db, dbPath('config/announceBar')), (snap) => {
            if (snap.exists()) {
                const mensaje = snap.data()[pageName];
                if (mensaje?.trim()) {
                    announceTextElement.textContent = mensaje;
                    announceBar.style.display = 'flex';
                } else {
                    announceBar.style.display = 'none';
                }
            } else {
                announceBar.style.display = 'none';
            }
        });
        closeAnnounceBarBtn?.addEventListener('click', () => announceBar.style.display = 'none');
    }

    // ── WIZARD DE INSCRIPCIÓN ─────────────────────────────────
    let currentStep = 1;
    const updateWizard = () => {
        document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
        document.getElementById(`step${currentStep}`)?.classList.add('active');
        document.querySelectorAll('.wizard-progress .step').forEach((el, i) => {
            el.classList.toggle('active', i + 1 <= currentStep);
        });
    };
    const resetWizard = () => {
        currentStep = 1;
        enrollmentForm?.reset();
        showFormMessage(enrollFormMessage, '', '');
        showFormMessage(document.getElementById('enrollPayMessage'), '', '');
        const voucherBtn = document.getElementById('enrollVoucherBtn');
        if (voucherBtn) { voucherBtn.style.display = ''; voucherBtn.disabled = false; }
        const laterLink = document.getElementById('enrollLaterLink');
        if (laterLink) laterLink.textContent = 'Lo haré después';
        updateWizard();
    };

    document.querySelectorAll('.btn-next').forEach(btn => btn.addEventListener('click', (e) => {
        currentStep = parseInt(e.currentTarget.dataset.next);
        updateWizard();
    }));

    const showFormMessage = (el, message, type) => {
        if (!el) return;
        if (message.includes('<')) el.innerHTML = message;
        else el.textContent = message;
        el.className = `form-message ${type}`;
        if (type === 'error') setTimeout(() => { if (el) el.textContent = ''; }, 4000);
    };

    // ── HEADER: enlace inteligente ────────────────────────────
    onAuthStateChanged(auth, async (user) => {
        if (user && !user.isAnonymous && studentAccessLink) {
            try {
                const snap = await getDoc(doc(db, dbPath(`user_roles/${user.uid}`)));
                if (snap.exists()) {
                    const role = snap.data().role;
                    if (role === 'admin') {
                        studentAccessLink.textContent = 'Panel Admin';
                        studentAccessLink.href = '/admin';
                    } else if (role === 'student') {
                        studentAccessLink.textContent = 'Mi Campus';
                        studentAccessLink.href = '/panel-estudiante';
                    }
                }
            } catch { /* silencioso */ }
        } else if (studentAccessLink) {
            studentAccessLink.textContent = 'Iniciar Sesión';
            studentAccessLink.href = '/iniciar-sesion';
        }
    });

    // ── CARGA DE CURSOS ───────────────────────────────────────
    // Tarjetas de dos caras (frente / reverso con "lo que debes saber").
    // Todo sale de Firestore (colección courses + config/cursos), la misma
    // fuente que lee el bot de WhatsApp. Ver renderCourseCard().
    let comunes = COMUNES_POR_DEFECTO;
    let waNumber = '51929610747';
    let ultimosCursos = [];

    const abrirInscripcion = (courseId, courseName, isWl) => {
        if (enrollCourseName) enrollCourseName.textContent = `Curso: ${courseName}`;
        if (enrollCourseId)   enrollCourseId.value = courseId;
        if (enrollIsWaitlist) enrollIsWaitlist.value = isWl;
        const wizardTitle = document.getElementById('wizardMainTitle');
        const paymentBox  = document.getElementById('paymentBox');
        if (wizardTitle) wizardTitle.textContent = isWl ? 'Lista de Espera' : 'Inscripción al Curso';
        if (paymentBox)  paymentBox.style.display = isWl ? 'none' : 'block';
        resetWizard();
        if (enrollCourseModal) {
            enrollCourseModal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    };

    const pintarCursos = (courses) => {
        ultimosCursos = courses;
        if (!coursesGridContainer) return;
        coursesGridContainer.innerHTML = '';
        if (loadingCoursesMessage) loadingCoursesMessage.style.display = 'none';
        if (noCoursesMessage) noCoursesMessage.style.display = courses.length ? 'none' : 'block';
        coursesGridContainer.classList.add('flip-grid');
        [...courses]
            .sort((a, b) => (Number(a.order) || 999) - (Number(b.order) || 999))
            .forEach(course => coursesGridContainer.appendChild(
                renderCourseCard(course, { comunes, waNumber, onEnroll: abrirInscripcion })
            ));
    };

    const loadCourses = () => {
        // Vista previa local con datos de prueba: http://localhost:8000/cursos.html?maqueta
        // (solo en este equipo; nunca en la web publicada).
        const esLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
        if (esLocal && new URLSearchParams(location.search).has('maqueta')) {
            fetch('/maqueta/cursos.json', { cache: 'no-store' })
                .then(r => r.json())
                .then(async d => {
                    if (d.comunes) comunes = d.comunes;
                    pintarCursos(d.courses || []);
                    const { montarProbador } = await import('./cursos-probador.js');
                    montarProbador(d.courses || [], pintarCursos);
                })
                .catch(err => console.error('Maqueta no disponible', err));
            return;
        }
        onSnapshot(doc(db, dbPath('config/cursos')), (snap) => {
            const lista = snap.exists() && snap.data().comunes;
            comunes = Array.isArray(lista) && lista.length ? lista : COMUNES_POR_DEFECTO;
            if (ultimosCursos.length) pintarCursos(ultimosCursos);
        }, () => { /* sin config: se usan los textos por defecto */ });
        onSnapshot(doc(db, dbPath('config/announceBar')), (snap) => {
            const n = snap.exists() && String(snap.data().whatsapp || '').replace(/\D/g, '');
            if (n) waNumber = n.length === 9 ? '51' + n : n;
        }, () => {});
        onSnapshot(collection(db, dbPath('courses')), (snap) => {
            pintarCursos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
    };

    // ── MODAL CERRAR ─────────────────────────────────────────
    closeEnrollModalBtn?.addEventListener('click', () => {
        if (enrollCourseModal) enrollCourseModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    });
    window.addEventListener('click', (e) => {
        if (e.target === enrollCourseModal) {
            enrollCourseModal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    });

    // ── FORMULARIO DE INSCRIPCIÓN ─────────────────────────────
    // Paso 1 crea la cuenta y la inscripción; el alumno queda con sesión
    // iniciada y su campus en modo limitado. Paso 2 se lo confirma y
    // paso 3 le deja enviar la constancia de pago ahora o más tarde.
    let createdUser = null, createdEnrollment = null;

    enrollmentForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn      = document.getElementById('submitEnrollmentBtn');
        const enrollPassword = document.getElementById('enrollPassword').value;

        if (!enrollFullName.value || !enrollEmail.value || !enrollPhone.value || !enrollPassword) {
            showFormMessage(enrollFormMessage, 'Por favor completa todos tus datos personales.', 'error');
            return;
        }
        if (!/^[A-Za-z0-9]{8,12}$/.test(enrollDni.value.trim())) {
            showFormMessage(enrollFormMessage, 'Ingresa un DNI o carné de extranjería válido (8 a 12 caracteres).', 'error');
            return;
        }
        if (enrollPassword.length < 6) {
            showFormMessage(enrollFormMessage, 'La contraseña debe tener al menos 6 caracteres.', 'error');
            return;
        }
        const referredBy = parseReferralCode(enrollReferral.value);
        if (referredBy === null) {
            showFormMessage(enrollFormMessage, 'El código de quien te recomendó no es válido. Debe verse así: DC-26ABCDE. Si no tienes uno, deja ese campo vacío.', 'error');
            return;
        }

        if (submitBtn) submitBtn.disabled = true;
        showFormMessage(enrollFormMessage, 'Creando tu cuenta…', 'loading');

        const isWl = enrollIsWaitlist?.value === 'true';
        const enrollmentData = {
            courseId:    enrollCourseId?.value || '',
            courseName:  enrollCourseName?.textContent.replace('Curso: ', '') || '',
            type:        isWl ? 'Lista de Espera' : 'Matrícula',
            fullName:    enrollFullName?.value || '',
            email:       (enrollEmail?.value || '').trim().toLowerCase(),
            phone:       enrollPhone?.value    || '',
            comments:    enrollComments?.value || '',
            dni:         enrollDni?.value.trim() || '',
            timestamp:   new Date(),
            status:      'Pendiente'
        };

        try {
            // 1. Crear cuenta Firebase Auth
            const { user } = await createUserWithEmailAndPassword(auth, enrollmentData.email, enrollPassword);

            // 2. Guardar rol en Firestore (sin código: se asigna al confirmar el pago)
            await setDoc(doc(db, dbPath(`user_roles/${user.uid}`)), {
                role:        'student',
                status:      'pending',
                fullName:    enrollmentData.fullName,
                email:       enrollmentData.email,
                dni:         enrollmentData.dni,
                phone:       enrollmentData.phone,
                ...(referredBy ? { referredBy } : {}),
                createdAt:   new Date()
            });

            // 3. Guardar inscripción
            await addDoc(collection(db, dbPath('course_enrollments')), enrollmentData);

            // 4. Enviar correo de verificación (no bloquea el registro si falla)
            try { await sendEmailVerification(user); } catch (err) { console.warn('No se pudo enviar la verificación:', err); }

            createdUser = user;
            createdEnrollment = enrollmentData;
            if (studentAccessLink) {
                studentAccessLink.textContent = 'Mi Campus';
                studentAccessLink.href = '/panel-estudiante';
            }

            // 5. Paso 2: registro confirmado
            document.getElementById('enrollDoneText').innerHTML = isWl
                ? 'Ya estás en la <strong>lista de espera</strong> de este curso. Te avisaremos apenas se abra un cupo. Mientras tanto, tu campus ya está disponible en modo limitado.'
                : 'Tu campus ya está abierto en <strong>modo limitado</strong>: puedes entrar y conocerlo desde ahora. Solo falta tu pago; al validarlo se desbloquea por completo y recibes tu código de alumno.';
            document.getElementById('enrollGoPayBtn').style.display = isWl ? 'none' : '';
            showFormMessage(enrollFormMessage, '', '');
            currentStep = 2;
            updateWizard();

        } catch (error) {
            let msg = 'Error al procesar tu inscripción. Inténtalo de nuevo.';
            if (error.code === 'auth/email-already-in-use') msg = 'Este correo ya está registrado. Por favor, inicia sesión.';
            if (error.code === 'auth/weak-password')        msg = 'La contraseña debe tener al menos 6 caracteres.';
            if (error.code === 'auth/invalid-email')        msg = 'El formato del correo es inválido.';
            showFormMessage(enrollFormMessage, msg, 'error');
        }
        if (submitBtn) submitBtn.disabled = false;
    });

    // ── PASO 3: CONSTANCIA DE PAGO ────────────────────────────
    document.getElementById('enrollVoucherBtn')?.addEventListener('click', async (e) => {
        const btn  = e.currentTarget;
        const msg  = document.getElementById('enrollPayMessage');
        const file = enrollVoucherFile?.files[0];
        if (!createdUser) return;
        if (!file) { showFormMessage(msg, 'Elige la foto o captura de tu constancia.', 'error'); return; }
        if (file.size > 8 * 1024 * 1024) { showFormMessage(msg, 'Imagen muy grande (máx 8MB).', 'error'); return; }

        btn.disabled = true;
        showFormMessage(msg, 'Enviando tu constancia…', 'loading');
        try {
            await addDoc(collection(db, dbPath('payments')), {
                uid:         createdUser.uid,
                email:       createdEnrollment.email,
                studentName: createdEnrollment.fullName,
                type:        'matricula',
                courseName:  createdEnrollment.courseName,
                imageUrl:    await compressImage(file),
                note:        '',
                status:      'reported',
                createdAt:   new Date()
            });
            showFormMessage(msg, '¡Constancia recibida! Activaremos tu campus completo y tu código de alumno al validarla.', 'success');
            btn.style.display = 'none';
            document.getElementById('enrollLaterLink').textContent = 'Ir a mi campus';
        } catch {
            showFormMessage(msg, 'No se pudo enviar. Inténtalo de nuevo o súbela desde tu campus.', 'error');
            btn.disabled = false;
        }
    });

    loadCourses();
});
