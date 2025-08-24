document.addEventListener('DOMContentLoaded', async () => {
    const coursesGridContainer = document.getElementById('courses-grid-container');
    const loadingCourses = document.getElementById('loading-courses');

    const enrollCourseModal = document.getElementById('enrollCourseModal');
    const closeEnrollModalBtn = document.getElementById('closeEnrollModalBtn');
    const enrollCourseNameDisplay = document.getElementById('enrollCourseName');
    const enrollmentForm = document.getElementById('enrollmentForm');
    const enrollFormMessage = document.getElementById('enrollFormMessage');
    const submitEnrollmentBtn = document.getElementById('submitEnrollmentBtn');

    const studentAccessLink = document.getElementById('student-access-link');

    let db;
    let collection;
    let getDocs;
    let addDoc; 
    let appId;
    let initialAuthToken;
    let signInAnonymously;
    let signInWithCustomToken;
    let auth;
    let onAuthStateChanged;

    let currentUser = null;

    const initializeFirebase = async () => {
        if (window.firebaseDb && window.firebaseCollection && window.firebaseGetDocs && 
            window.firebaseAddDoc && window.firebaseAuth && window.firebaseOnAuthStateChanged && window.appId) {
            
            db = window.firebaseDb;
            collection = window.firebaseCollection;
            getDocs = window.firebaseGetDocs;
            addDoc = window.firebaseAddDoc; 
            appId = window.appId;
            initialAuthToken = window.initialAuthToken;
            signInAnonymously = window.signInAnonymously;
            signInWithCustomToken = window.signInWithCustomToken;
            auth = window.firebaseAuth;
            onAuthStateChanged = window.firebaseOnAuthStateChanged;

            onAuthStateChanged(auth, (user) => {
                if (user) {
                    currentUser = user;
                    console.log("Cursos.js: Usuario autenticado detectado:", user.uid);
                    studentAccessLink.textContent = 'Mi Dashboard';
                    studentAccessLink.href = 'student_dashboard.html';
                } else {
                    currentUser = null;
                    console.log("Cursos.js: Usuario no autenticado.");
                    studentAccessLink.textContent = 'Iniciar Sesión';
                    studentAccessLink.href = 'login.html';
                }
            });

            try {
                await new Promise(resolve => setTimeout(resolve, 50)); 

                if (!auth.currentUser) {
                     if (initialAuthToken) {
                         await signInWithCustomToken(auth, initialAuthToken);
                         console.log("Firebase: Sesión inicial con token personalizado (cursos) establecida.");
                     } else {
                        await signInAnonymously(auth);
                        console.log("Firebase: Sesión anónima establecida para lectura de cursos.");
                     }
                } else {
                    console.log("Firebase: Usuario ya autenticado (persistente o por token inicial), no se requiere sign-in adicional para cursos.");
                }
                
                fetchCourses(); 
            } catch (error) {
                console.error("Firebase: Error al inicializar Firebase/autenticación para cursos:", error);
                loadingCourses.textContent = 'Error crítico al inicializar Firebase para cargar los cursos. Inténtelo más tarde.';
                loadingCourses.style.color = '#dc3545';
            }
        } else {
            console.error("Firebase SDK global variables not found for cursos.js. Retrying in 100ms...");
            setTimeout(initializeFirebase, 100);
        }
    };

    const fetchCourses = async () => {
        loadingCourses.style.display = 'block';
        coursesGridContainer.innerHTML = '';

        try {
            const collectionPath = `artifacts/${appId}/public/data/courses`;
            console.log("DEBUG: Intentando cargar cursos de la ruta:", collectionPath, "con UID:", auth.currentUser ? auth.currentUser.uid : 'No autenticado');
            
            const coursesCol = collection(db, collectionPath);
            const courseSnapshot = await getDocs(coursesCol);

            if (courseSnapshot.empty) {
                loadingCourses.textContent = 'No hay cursos disponibles en este momento.';
                loadingCourses.style.color = '#ffc107';
                console.log("DEBUG: No se encontraron documentos en la colección de cursos.");
                return;
            }

            loadingCourses.style.display = 'none';

            const courses = courseSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            courses.sort((a, b) => {
                if (typeof a.order === 'number' && typeof b.order === 'number') {
                    return a.order - b.order;
                }
                return (a.name || '').localeCompare(b.name || '');
            });

            courses.forEach(course => {
                const courseId = course.id;
                const courseCard = document.createElement('div');
                courseCard.className = 'paquete-card';
                
                // Determinar la clase y texto de estado
                const statusText = course.status || 'Desconocido';
                const statusClass = statusText ? `status-${statusText.toLowerCase().replace(/\s+/g, '-')}` : 'status-default';

                let gamesListHtml = '';
                if (course.gamesIncluded && Array.isArray(course.gamesIncluded) && course.gamesIncluded.length > 0) {
                    gamesListHtml = `
                        <p>Juegos Incluidos:</p>
                        <ul>
                            ${course.gamesIncluded.map(game => `<li>- ${game}</li>`).join('')}
                        </ul>
                    `;
                } else {
                    gamesListHtml = '<p>Juegos: Consulta para más detalles</p>';
                }

                // Estructura HTML que replica tu diseño original + el status
                courseCard.innerHTML = `
                    <div class="course-status ${statusClass}">${statusText}</div> <!-- NUEVO: EL STATUS -->
                    <h3>"${course.name || 'Nombre del Curso'}"</h3>
                    <p>${course.description || ''}</p>
                    <div class="price">${course.price || ''}</div>
                    <p>${course.schedule || ''}</p>
                    ${gamesListHtml}
                    <p><strong>Duración ESTIMADA:</strong> ${course.duration || ''}</p>
                    <button type="button" class="btn btn-primary enroll-btn" data-course-id="${courseId}" data-course-name="${course.name}">¡Inscríbete ahora!</button>
                `;
                coursesGridContainer.appendChild(courseCard);
            });

            document.querySelectorAll('.enroll-btn').forEach(button => {
                button.addEventListener('click', (event) => {
                    const courseId = event.target.dataset.courseId; // Obtener el ID del curso
                    const courseName = event.target.dataset.courseName;
                    openEnrollmentModal(courseName, courseId); // Pasar el ID al modal
                });
            });

        } catch (error) {
            console.error("Error al cargar los cursos desde Firestore:", error);
            loadingCourses.textContent = 'Error al cargar los cursos. Por favor, asegúrate de que Firestore esté configurado y los datos existan.';
            loadingCourses.style.color = '#dc3545';
        }
    };

    const openEnrollmentModal = (courseName, courseId) => { // Recibir courseId
        enrollCourseNameDisplay.textContent = `Curso: ${courseName}`;
        enrollCourseModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        enrollmentForm.reset();
        enrollFormMessage.textContent = '';
        enrollFormMessage.classList.remove('success', 'error', 'loading');
        submitEnrollmentBtn.disabled = false;
        submitEnrollmentBtn.textContent = 'Confirmar Inscripción';
        currentCourseId = courseId; // Asignar el ID al currentCourseId
    };

    const closeEnrollmentModal = () => {
        enrollCourseModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    };

    closeEnrollModalBtn.addEventListener('click', closeEnrollmentModal);

    window.addEventListener('click', (event) => {
        if (event.target == enrollCourseModal) {
            closeEnrollmentModal();
        }
    });

    enrollmentForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        enrollFormMessage.textContent = 'Enviando solicitud...';
        enrollFormMessage.className = 'form-message loading';
        submitEnrollmentBtn.disabled = true;

        const formData = new FormData(enrollmentForm);
        const enrollmentData = {
            courseId: currentCourseId, // Usar currentCourseId
            courseName: enrollCourseNameDisplay.textContent.replace('Curso: ', ''),
            fullName: formData.get('fullName'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            comments: formData.get('comments'),
            timestamp: new Date(),
            status: 'pending'
        };

        if (currentUser) {
            enrollmentData.enrolledByUid = currentUser.uid;
            console.log("Inscripción realizada por usuario autenticado:", currentUser.uid);
        } else {
            console.log("Inscripción realizada por usuario no autenticado (anónimo).");
        }

        try {
            const enrollmentsCollectionPath = `artifacts/${appId}/public/data/course_enrollments`; // Colección pública
            await addDoc(collection(db, enrollmentsCollectionPath), enrollmentData);


            enrollFormMessage.textContent = '¡Inscripción confirmada! Nos pondremos en contacto contigo pronto.';
            enrollFormMessage.className = 'form-message success';
            enrollmentForm.reset();
            submitEnrollmentBtn.textContent = 'Enviado';
            
            setTimeout(() => {
                closeEnrollmentModal();
            }, 3000);

        } catch (error) {
            console.error("Error al enviar la inscripción:", error);
            enrollFormMessage.textContent = 'Error al procesar tu inscripción. Por favor, inténtalo de nuevo.';
            enrollFormMessage.className = 'form-message error';
            submitEnrollmentBtn.disabled = false;
            submitEnrollmentBtn.textContent = 'Reintentar Inscripción';
        }
    });

    initializeFirebase();
});
