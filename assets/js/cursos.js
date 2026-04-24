import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// 1. Configuración Calcada de tu index.js (100% funcional)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "AIzaSyA3YsyUDmLeAvvgWwvCnjeJt-HbGGk--PY",
    authDomain: "dealerclubpe.firebaseapp.com",
    projectId: "dealerclubpe",
    storageBucket: "dealerclubpe.firebasestorage.app",
    messagingSenderId: "330568352415",
    appId: "1:330568352415:web:9fcd7651698bfafac998aa",
    measurementId: "G-PF3W9NDSDP"
};

// 2. Inicialización de Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

// --- FUNCIÓN: GENERADOR DE CÓDIGO ÚNICO DE ALUMNO ---
function generateStudentCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `DC-${new Date().getFullYear().toString().slice(-2)}${code}`;
}

document.addEventListener('DOMContentLoaded', () => {
    // Referencias del DOM
    const studentAccessLink = document.getElementById('student-access-link');
    const coursesGridContainer = document.getElementById('courses-grid-container');
    const loadingCoursesMessage = document.getElementById('loading-courses');
    const noCoursesMessage = document.getElementById('no-courses-message');

    const enrollCourseModal = document.getElementById('enrollCourseModal');
    const closeEnrollModalBtn = document.getElementById('closeEnrollModalBtn');
    const enrollCourseName = document.getElementById('enrollCourseName');
    const enrollmentForm = document.getElementById('enrollmentForm');
    const enrollCourseId = document.getElementById('enrollCourseId');
    const enrollFullName = document.getElementById('enrollFullName');
    const enrollEmail = document.getElementById('enrollEmail');
    const enrollPhone = document.getElementById('enrollPhone');
    const enrollComments = document.getElementById('enrollComments');
    const enrollVoucherUrl = document.getElementById('enrollVoucherUrl'); 
    const enrollIsWaitlist = document.getElementById('enrollIsWaitlist');
    const enrollFormMessage = document.getElementById('enrollFormMessage');

    // --- ANNOUNCE BAR INTELIGENTE ---
    const announceBar = document.getElementById('announce-bar');
    const announceTextElement = document.getElementById('announce-text');
    const closeAnnounceBarBtn = document.getElementById('close-announce-bar');

    // Leemos tu etiqueta <body data-page="cursos">
    const pageName = document.body.getAttribute('data-page'); 

    if (announceBar && db && appId && pageName) {
        const announceDocRef = doc(db, `/artifacts/${appId}/public/data/config/announceBar`);
        
        onSnapshot(announceDocRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                const data = docSnapshot.data();
                const mensaje = data[pageName]; // Busca el texto exacto para "cursos"

                if (mensaje && mensaje.trim() !== '') {
                    announceTextElement.textContent = mensaje;
                    announceBar.style.display = 'flex';
                } else {
                    announceBar.style.display = 'none';
                }
            } else {
                announceBar.style.display = 'none';
            }
        });

        if (closeAnnounceBarBtn) {
            closeAnnounceBarBtn.addEventListener('click', () => {
                announceBar.style.display = 'none';
            });
        }
    }

    // --- Lógica del Wizard ---
    let currentStep = 1;
    const updateWizard = () => {
        document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
        const stepElement = document.getElementById(`step${currentStep}`);
        if(stepElement) stepElement.classList.add('active');
        
        document.querySelectorAll('.wizard-progress .step').forEach((el, index) => {
            el.classList.toggle('active', index + 1 <= currentStep);
        });
    };

    const resetWizard = () => {
        currentStep = 1;
        if(enrollmentForm) enrollmentForm.reset();
        showFormMessage(enrollFormMessage, '', '');
        updateWizard();
    };

    document.querySelectorAll('.btn-next').forEach(btn => btn.addEventListener('click', (e) => {
        if(currentStep === 1) {
            const enrollPassword = document.getElementById('enrollPassword');
            
            if(!enrollFullName.value || !enrollEmail.value || !enrollPhone.value || !enrollPassword.value) {
                alert("Por favor completa todos tus datos personales y crea tu contraseña."); 
                return;
            }
            if(enrollPassword.value.length < 6) {
                alert("La contraseña debe tener al menos 6 caracteres."); 
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

    const showFormMessage = (messageElement, message, type) => {
        if(!messageElement) return;
        if (message.includes('<')) {
            messageElement.innerHTML = message;
        } else {
            messageElement.textContent = message;
        }
        messageElement.className = `form-message ${type}`;
        if(type === 'error') {
            setTimeout(() => messageElement.textContent = '', 4000);
        }
    };

    // --- Autenticación ---
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userRoleRef = doc(db, `/artifacts/${appId}/public/data/user_roles/${user.uid}`);
            try {
                const userRoleSnap = await getDoc(userRoleRef);
                if (userRoleSnap.exists() && studentAccessLink) {
                    const role = userRoleSnap.data().role;
                    if (role === 'admin') {
                        studentAccessLink.textContent = 'Panel Admin';
                        studentAccessLink.href = 'admin.html';
                    } else if (role === 'student') {
                        studentAccessLink.textContent = 'Mi Dashboard';
                        studentAccessLink.href = 'student_dashboard.html';
                    }
                }
            } catch (error) { console.error(error); }
        } else {
            signInAnonymously(auth); 
        }
    });

    // --- Carga de Cursos ---
    const loadCourses = () => {
        if (!db || !appId) return;
        onSnapshot(collection(db, `/artifacts/${appId}/public/data/courses`), (querySnapshot) => {
            if(coursesGridContainer) coursesGridContainer.innerHTML = '';
            if(loadingCoursesMessage) loadingCoursesMessage.style.display = 'none';

            if (querySnapshot.empty) {
                if(noCoursesMessage) noCoursesMessage.style.display = 'block'; 
                return;
            }

            const courses = [];
            querySnapshot.docs.forEach(doc => courses.push({ id: doc.id, ...doc.data() }));
            courses.sort((a, b) => (a.order || 999) - (b.order || 999));

            courses.forEach(course => {
                const courseCard = document.createElement('div');
                courseCard.className = 'paquete-card';

                const isClosed = course.status === 'Cerrado';
                const isWaitlist = course.status === 'Próximamente';
                
                let btnText = isWaitlist ? 'Unirse a Lista de Espera' : '¡Inscríbete ahora!';
                let btnClass = isWaitlist ? 'btn-secondary' : 'btn-primary';
                let disabledAttr = isClosed ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : '';
                if (isClosed) btnText = 'Cupos Agotados';

                const statusClass = course.status ? `status-${course.status.toLowerCase().replace(/\s/g, '-')}` : 'status-default';
                
                const statusHtml = `<span class="course-status ${statusClass}">${course.status || 'N/A'}</span>`;
                const marketingHtml = course.tag ? `<div class="marketing-tag"><i class="fas fa-fire"></i> ${course.tag}</div>` : '';

                const gamesHtml = Array.isArray(course.gamesIncluded)
                    ? course.gamesIncluded.map(g => `<li>${g}</li>`).join('')
                    : `<li>${course.gamesIncluded || ''}</li>`;

                courseCard.innerHTML = `
                    ${marketingHtml}
                    ${statusHtml}
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
                    <button class="btn ${btnClass} enroll-btn" data-course-id="${course.id}" data-course-name="${course.name}" data-waitlist="${isWaitlist}" ${disabledAttr}>${btnText}</button>
                `;
                if(coursesGridContainer) coursesGridContainer.appendChild(courseCard);
            });

            // Eventos a botones
            document.querySelectorAll('.enroll-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const isWaitlist = e.target.dataset.waitlist === 'true';
                    if(enrollCourseName) enrollCourseName.textContent = `Curso: ${e.target.dataset.courseName}`;
                    if(enrollCourseId) enrollCourseId.value = e.target.dataset.courseId;
                    if(enrollIsWaitlist) enrollIsWaitlist.value = isWaitlist;

                    const wizardMainTitle = document.getElementById('wizardMainTitle');
                    const paymentBox = document.getElementById('paymentBox');
                    
                    if(wizardMainTitle) wizardMainTitle.textContent = isWaitlist ? 'Lista de Espera' : 'Inscripción al Curso';
                    if(paymentBox) paymentBox.style.display = isWaitlist ? 'none' : 'block';

                    resetWizard();
                    if(enrollCourseModal) {
                        enrollCourseModal.style.display = 'flex';
                        document.body.style.overflow = 'hidden';
                    }
                });
            });
        });
    };

    // --- Envío de Formulario a Firestore ---
    if(closeEnrollModalBtn) {
        closeEnrollModalBtn.addEventListener('click', () => { 
            if(enrollCourseModal) enrollCourseModal.style.display = 'none'; 
            document.body.style.overflow = 'auto'; 
        });
    }
    window.addEventListener('click', (e) => { 
        if (e.target === enrollCourseModal) { 
            enrollCourseModal.style.display = 'none'; 
            document.body.style.overflow = 'auto'; 
        } 
    });

    if(enrollmentForm) {
        enrollmentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById('submitEnrollmentBtn');
            if(submitBtn) submitBtn.disabled = true;
            showFormMessage(enrollFormMessage, 'Generando tu bóveda y código de alumno...', 'loading');

            const isWaitlist = enrollIsWaitlist ? enrollIsWaitlist.value === 'true' : false;
            const newStudentCode = generateStudentCode(); 
            const enrollPassword = document.getElementById('enrollPassword').value; 

            const enrollmentData = {
                studentCode: newStudentCode, 
                courseId: enrollCourseId ? enrollCourseId.value : '',
                courseName: enrollCourseName ? enrollCourseName.textContent.replace('Curso: ', '') : '',
                type: isWaitlist ? 'Lista de Espera' : 'Matrícula',
                fullName: enrollFullName ? enrollFullName.value : '',
                email: enrollEmail ? enrollEmail.value : '',
                phone: enrollPhone ? enrollPhone.value : '',
                comments: enrollComments ? enrollComments.value : '',
                voucherUrl: enrollVoucherUrl ? enrollVoucherUrl.value : null,
                timestamp: new Date(),
                status: 'Pendiente'
            };

            try {
                // 1. Crear el usuario
                const userCredential = await createUserWithEmailAndPassword(auth, enrollmentData.email, enrollPassword);
                const user = userCredential.user;

                // 2. Guardar su Rol y Estado
                await setDoc(doc(db, `/artifacts/${appId}/public/data/user_roles/${user.uid}`), {
                    role: 'student',
                    status: 'pending',
                    studentCode: newStudentCode,
                    fullName: enrollmentData.fullName,
                    email: enrollmentData.email
                });

                // 3. Guardar la matrícula
                await addDoc(collection(db, `/artifacts/${appId}/public/data/course_enrollments`), enrollmentData);
                
                // 4. Cerrar sesión
                await signOut(auth);
                
                const successMsg = `¡Todo Listo! Tu código de alumno es: <br><strong style="font-size:1.5em; color:#fff; display:block; margin-top:10px;">${newStudentCode}</strong><br><span style="font-size:0.8em;">Haz una captura. Ya puedes Iniciar Sesión con tu correo y contraseña.</span>`;
                showFormMessage(enrollFormMessage, successMsg, 'success');
                
                setTimeout(() => {
                    if(enrollCourseModal) enrollCourseModal.style.display = 'none';
                    document.body.style.overflow = 'auto';
                    if(submitBtn) submitBtn.disabled = false;
                    window.location.href = 'login.html'; 
                }, 7000); 
            } catch (error) {
                let errorText = error.message;
                if(error.code === 'auth/email-already-in-use') errorText = "Este correo ya está registrado. Por favor, inicia sesión.";
                if(error.code === 'auth/weak-password') errorText = "La contraseña debe tener al menos 6 caracteres.";
                
                showFormMessage(enrollFormMessage, `Error: ${errorText}`, 'error');
                if(submitBtn) submitBtn.disabled = false;
            }
        });
    }

    loadCourses(); 
});