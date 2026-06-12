import { auth, db, dbPath } from './firebase.js';
import { onAuthStateChanged, createUserWithEmailAndPassword, sendEmailVerification, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

function generateStudentCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return `DC-${new Date().getFullYear().toString().slice(-2)}${code}`;
}

document.addEventListener('DOMContentLoaded', () => {
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
    const enrollVoucherUrl        = document.getElementById('enrollVoucherUrl');
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
        updateWizard();
    };

    document.querySelectorAll('.btn-next').forEach(btn => btn.addEventListener('click', (e) => {
        if (currentStep === 1) {
            const enrollPassword = document.getElementById('enrollPassword');
            if (!enrollFullName.value || !enrollEmail.value || !enrollPhone.value || !enrollPassword.value) {
                showFormMessage(enrollFormMessage, 'Por favor completa todos tus datos personales.', 'error');
                return;
            }
            if (enrollPassword.value.length < 6) {
                showFormMessage(enrollFormMessage, 'La contraseña debe tener al menos 6 caracteres.', 'error');
                return;
            }
        }
        currentStep = parseInt(e.currentTarget.dataset.next);
        updateWizard();
    }));
    document.querySelectorAll('.btn-prev').forEach(btn => btn.addEventListener('click', (e) => {
        currentStep = parseInt(e.currentTarget.dataset.prev);
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
    const loadCourses = () => {
        onSnapshot(collection(db, dbPath('courses')), (snap) => {
            if (coursesGridContainer) coursesGridContainer.innerHTML = '';
            if (loadingCoursesMessage) loadingCoursesMessage.style.display = 'none';

            if (snap.empty) {
                if (noCoursesMessage) noCoursesMessage.style.display = 'block';
                return;
            }

            const courses = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order || 999) - (b.order || 999));

            courses.forEach(course => {
                const isClosed   = course.status === 'Cerrado';
                const isWaitlist = course.status === 'Próximamente';
                let btnText   = isWaitlist ? 'Unirse a Lista de Espera' : '¡Inscríbete ahora!';
                let btnClass  = isWaitlist ? 'btn-secondary' : 'btn-primary';
                let disabledA = isClosed ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : '';
                if (isClosed) btnText = 'Cupos Agotados';

                const statusClass  = `status-${(course.status || 'default').toLowerCase().replace(/\s/g, '-')}`;
                const statusHtml   = `<span class="course-status ${statusClass}">${course.status || 'N/A'}</span>`;
                const marketingHtml= course.tag ? `<div class="marketing-tag"><i class="fas fa-fire"></i> ${course.tag}</div>` : '';
                const gamesHtml    = Array.isArray(course.gamesIncluded)
                    ? course.gamesIncluded.map(g => `<li>${g}</li>`).join('')
                    : `<li>${course.gamesIncluded || ''}</li>`;

                const card = document.createElement('div');
                card.className = 'paquete-card';
                card.innerHTML = `
                    ${marketingHtml}${statusHtml}
                    <div class="card-content-wrapper">
                        <h3 class="course-title">${course.name || 'Curso'}</h3>
                        <p class="course-description">${course.description || ''}</p>
                        <p class="price">${course.price || 'N/A'}</p>
                        <ul class="course-details">
                            <li><strong>Horario:</strong> ${course.schedule || 'N/A'}</li>
                            <li><strong>Juegos:</strong></li>
                            <ol>${gamesHtml}</ol>
                        </ul>
                        <p class="course-duration"><strong>Duración:</strong> ${course.duration || 'N/A'}</p>
                    </div>
                    <button class="btn ${btnClass} enroll-btn"
                        data-course-id="${course.id}"
                        data-course-name="${course.name}"
                        data-waitlist="${isWaitlist}" ${disabledA}>
                        ${btnText}
                    </button>
                `;
                coursesGridContainer?.appendChild(card);
            });

            document.querySelectorAll('.enroll-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const isWl = e.target.dataset.waitlist === 'true';
                    if (enrollCourseName) enrollCourseName.textContent = `Curso: ${e.target.dataset.courseName}`;
                    if (enrollCourseId)   enrollCourseId.value = e.target.dataset.courseId;
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
                });
            });
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
    enrollmentForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('submitEnrollmentBtn');
        if (submitBtn) submitBtn.disabled = true;
        showFormMessage(enrollFormMessage, 'Generando tu código de alumno…', 'loading');

        const isWl           = enrollIsWaitlist?.value === 'true';
        const newStudentCode = generateStudentCode();
        const enrollPassword = document.getElementById('enrollPassword').value;

        const enrollmentData = {
            studentCode: newStudentCode,
            courseId:    enrollCourseId?.value || '',
            courseName:  enrollCourseName?.textContent.replace('Curso: ', '') || '',
            type:        isWl ? 'Lista de Espera' : 'Matrícula',
            fullName:    enrollFullName?.value || '',
            email:       enrollEmail?.value    || '',
            phone:       enrollPhone?.value    || '',
            comments:    enrollComments?.value || '',
            voucherUrl:  enrollVoucherUrl?.value || null,
            timestamp:   new Date(),
            status:      'Pendiente'
        };

        try {
            // 1. Crear cuenta Firebase Auth
            const { user } = await createUserWithEmailAndPassword(auth, enrollmentData.email, enrollPassword);

            // 2. Guardar rol en Firestore
            await setDoc(doc(db, dbPath(`user_roles/${user.uid}`)), {
                role:        'student',
                status:      'pending',
                studentCode: newStudentCode,
                fullName:    enrollmentData.fullName,
                email:       enrollmentData.email
            });

            // 3. Guardar inscripción
            await addDoc(collection(db, dbPath('course_enrollments')), enrollmentData);

            // 4. Enviar correo de verificación (no bloquea el registro si falla)
            try { await sendEmailVerification(user); } catch (err) { console.warn('No se pudo enviar la verificación:', err); }

            // 5. Cerrar sesión (el alumno debe iniciar sesión explícitamente)
            await signOut(auth);

            const successMsg = `¡Todo listo! Tu código de alumno es:<br>
                <strong style="font-size:1.5em;color:#fff;display:block;margin-top:10px;letter-spacing:3px;">
                    ${newStudentCode}
                </strong><br>
                <span style="font-size:0.8em;">Haz una captura. Te enviamos un correo de verificación: revísalo (incluida la carpeta de spam) y confirma tu cuenta. Ya puedes iniciar sesión con tu correo y contraseña.</span>`;
            showFormMessage(enrollFormMessage, successMsg, 'success');

            setTimeout(() => {
                if (enrollCourseModal) enrollCourseModal.style.display = 'none';
                document.body.style.overflow = 'auto';
                if (submitBtn) submitBtn.disabled = false;
                window.location.href = '/iniciar-sesion';
            }, 7000);

        } catch (error) {
            let msg = 'Error al procesar tu inscripción. Inténtalo de nuevo.';
            if (error.code === 'auth/email-already-in-use') msg = 'Este correo ya está registrado. Por favor, inicia sesión.';
            if (error.code === 'auth/weak-password')        msg = 'La contraseña debe tener al menos 6 caracteres.';
            showFormMessage(enrollFormMessage, msg, 'error');
            if (submitBtn) submitBtn.disabled = false;
        }
    });

    loadCourses();
});
