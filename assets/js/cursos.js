document.addEventListener('DOMContentLoaded', () => {
    const coursesGridContainer = document.getElementById('courses-grid-container');
    const loadingCourses = document.getElementById('loading-courses');

    // Modal de Inscripción a Cursos
    const enrollCourseModal = document.getElementById('enrollCourseModal');
    const closeEnrollModalBtn = document.getElementById('closeEnrollModalBtn');
    const enrollCourseNameDisplay = document.getElementById('enrollCourseName');
    const enrollmentForm = document.getElementById('enrollmentForm');
    const enrollFormMessage = document.getElementById('enrollFormMessage');
    const submitEnrollmentBtn = document.getElementById('submitEnrollmentBtn');

    // Enlace de acceso a la cuenta de estudiante (en la barra de navegación)
    const studentAccessLink = document.getElementById('student-access-link');

    let db;
    let collection;
    let getDocs;
    let addDoc; 
    let appId;
    let initialAuthToken;
    let signInAnonymously;
    let signInWithCustomToken;
    let auth; // Referencia a Firebase Auth
    let onAuthStateChanged; // Referencia a onAuthStateChanged

    let currentUser = null; // Variable para almacenar el usuario actualmente logueado

    // Función para inicializar Firebase y configurar el listener de autenticación
    const initializeFirebase = async () => {
        // Verifica si las variables globales de Firebase ya están disponibles
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

            // Escuchar cambios en el estado de autenticación de Firebase
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    currentUser = user; // Almacena el objeto de usuario si está logueado
                    console.log("Cursos.js: Usuario autenticado detectado:", user.uid);
                    // Actualiza el texto y el enlace del botón 'Mi Cuenta'
                    studentAccessLink.textContent = 'Mi Dashboard';
                    studentAccessLink.href = 'student_dashboard.html';
                } else {
                    currentUser = null; // No hay usuario logueado
                    console.log("Cursos.js: Usuario no autenticado.");
                    // Actualiza el texto y el enlace del botón 'Mi Cuenta' para redirigir al login
                    studentAccessLink.textContent = 'Iniciar Sesión';
                    studentAccessLink.href = 'login.html';
                }
                // Una vez que el estado de autenticación se ha resuelto (incluso si es nulo),
                // podemos intentar cargar los cursos. Esto es para evitar race conditions.
                // Sin embargo, si `fetchCourses()` ya se llamó y falló por permisos,
                // no se volverá a llamar automáticamente aquí. Lo resolveremos en la lógica de abajo.
            });

            // Lógica para garantizar que haya un usuario autenticado (incluso anónimo) o se intente antes de cargar cursos
            try {
                // Esperar un breve momento para que onAuthStateChanged tenga la oportunidad de detectar un usuario persistente
                // (aunque no siempre es necesario si sign-in anónimo se ejecuta rápidamente)
                await new Promise(resolve => setTimeout(resolve, 50)); 

                if (!auth.currentUser) { // Si después del pequeño retraso, todavía no hay un usuario
                     if (initialAuthToken) { // Si hay un token inicial de Canvas, úsalo
                         await signInWithCustomToken(auth, initialAuthToken);
                         console.log("Firebase: Sesión inicial con token personalizado (cursos) establecida.");
                     } else { // De lo contrario, intenta iniciar sesión anónimamente
                        await signInAnonymously(auth);
                        console.log("Firebase: Sesión anónima establecida para lectura de cursos.");
                     }
                } else {
                    console.log("Firebase: Usuario ya autenticado (persistente o por token inicial), no se requiere sign-in adicional para cursos.");
                }
                
                // Ahora que estamos seguros de un estado de autenticación, intentamos cargar los cursos
                fetchCourses(); 
            } catch (error) {
                console.error("Firebase: Error al inicializar Firebase/autenticación para cursos:", error);
                loadingCourses.textContent = 'Error crítico al inicializar Firebase para cargar los cursos. Inténtelo más tarde.';
                loadingCourses.style.color = '#dc3545'; // Mensaje de error visual
            }
        } else {
            console.error("Firebase SDK global variables not found for cursos.js. Retrying in 100ms...");
            setTimeout(initializeFirebase, 100); // Reintentar la inicialización si no está listo
        }
    };

    // Función para cargar los cursos desde Firestore
    const fetchCourses = async () => {
        loadingCourses.style.display = 'block'; // Muestra el mensaje de carga
        coursesGridContainer.innerHTML = ''; // Limpia el contenedor de cursos

        try {
            // Define la ruta de la colección de cursos en Firestore
            const collectionPath = `artifacts/${appId}/public/data/courses`;
            console.log("DEBUG: Intentando cargar cursos de la ruta:", collectionPath, "con UID:", auth.currentUser ? auth.currentUser.uid : 'No autenticado'); // Log para depuración
            
            const coursesCol = collection(db, collectionPath);
            const courseSnapshot = await getDocs(coursesCol);

            if (courseSnapshot.empty) {
                loadingCourses.textContent = 'No hay cursos disponibles en este momento.';
                loadingCourses.style.color = '#ffc107'; // Mensaje informativo
                console.log("DEBUG: No se encontraron documentos en la colección de cursos."); // Log para depuración
                return;
            }

            loadingCourses.style.display = 'none'; // Oculta el mensaje de carga

            // Mapea los documentos y los ordena por el campo 'order' o por nombre
            const courses = courseSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            courses.sort((a, b) => {
                // Ordena numéricamente si ambos tienen un campo 'order' válido
                if (typeof a.order === 'number' && typeof b.order === 'number') {
                    return a.order - b.order;
                }
                // Si no hay 'order' o no es numérico, ordena alfabéticamente por 'name'
                return (a.name || '').localeCompare(b.name || '');
            });

            // Itera sobre los cursos para crear sus tarjetas HTML
            courses.forEach(course => {
                const courseCard = document.createElement('div');
                courseCard.className = 'paquete-card';

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

                // Inserta el contenido HTML de la tarjeta del curso
                courseCard.innerHTML = `
                    <h3>"${course.name}"</h3>
                    <p>${course.description || ''}</p>
                    <div class="price">${course.price || ''}</div>
                    <p>${course.schedule || ''}</p>
                    <ul>
                        ${gamesListHtml}
                    </ul>
                    <p><strong>Duración ESTIMADA:</strong> ${course.duration || ''}</p>
                    <button type="button" class="btn btn-primary enroll-btn" data-course-name="${course.name}">¡Inscríbete ahora!</button>
                `;
                coursesGridContainer.appendChild(courseCard);
            });

            // Asigna los event listeners a los botones de inscripción después de que se han creado
            document.querySelectorAll('.enroll-btn').forEach(button => {
                button.addEventListener('click', (event) => {
                    const courseName = event.target.dataset.courseName;
                    openEnrollmentModal(courseName);
                });
            });

        } catch (error) {
            console.error("Error al cargar los cursos desde Firestore:", error);
            loadingCourses.textContent = 'Error al cargar los cursos. Por favor, asegúrate de que Firestore esté configurado y los datos existan.';
            loadingCourses.style.color = '#dc3545'; // Mensaje de error visual
        }
    };

    // --- Lógica del Modal de Inscripción ---

    // Abre el modal de inscripción y pre-carga el nombre del curso
    const openEnrollmentModal = (courseName) => {
        enrollCourseNameDisplay.textContent = `Curso: ${courseName}`;
        enrollCourseModal.style.display = 'flex'; // Hace el modal visible (usando flexbox para centrar)
        enrollmentForm.reset(); // Limpia el formulario
        enrollFormMessage.textContent = ''; // Limpia mensajes previos
        enrollFormMessage.classList.remove('success', 'error', 'loading'); // Resetea clases de estilo
        submitEnrollmentBtn.disabled = false; // Habilita el botón de envío
        submitEnrollmentBtn.textContent = 'Confirmar Inscripción'; // Restablece el texto del botón
    };

    // Cierra el modal de inscripción
    const closeEnrollmentModal = () => {
        enrollCourseModal.style.display = 'none'; // Oculta el modal
    };

    // Event listener para cerrar el modal haciendo clic en la 'x'
    closeEnrollModalBtn.addEventListener('click', closeEnrollmentModal);

    // Event listener para cerrar el modal haciendo clic fuera de él
    window.addEventListener('click', (event) => {
        if (event.target == enrollCourseModal) {
            closeEnrollmentModal();
        }
    });

    // Maneja el envío del formulario de inscripción
    enrollmentForm.addEventListener('submit', async (event) => {
        event.preventDefault(); // Evita el envío por defecto del formulario

        // Muestra un mensaje de carga
        enrollFormMessage.textContent = 'Enviando solicitud...';
        enrollFormMessage.className = 'form-message loading';
        submitEnrollmentBtn.disabled = true; // Deshabilita el botón para evitar envíos duplicados

        const formData = new FormData(enrollmentForm);
        const enrollmentData = {
            courseName: enrollCourseNameDisplay.textContent.replace('Curso: ', ''), // Extrae el nombre del curso del texto del modal
            fullName: formData.get('fullName'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            comments: formData.get('comments'),
            timestamp: new Date(), // Marca de tiempo del envío
            status: 'pending' // Estado inicial de la inscripción
        };

        // Si hay un usuario logueado, añade su UID a los datos de inscripción
        if (currentUser) {
            enrollmentData.enrolledByUid = currentUser.uid;
            console.log("Inscripción realizada por usuario autenticado:", currentUser.uid);
        } else {
            console.log("Inscripción realizada por usuario no autenticado (anónimo).");
        }

        try {
            // Guarda los datos en la colección 'course_enrollments' en Firestore
            const collectionPath = `artifacts/${appId}/public/data/course_enrollments`;
            await addDoc(collection(db, collectionPath), enrollmentData);

            enrollFormMessage.textContent = '¡Inscripción confirmada! Nos pondremos en contacto contigo pronto.';
            enrollFormMessage.className = 'form-message success';
            enrollmentForm.reset(); // Limpia el formulario
            submitEnrollmentBtn.textContent = 'Enviado'; // Actualiza el texto del botón
            
            // Cierra el modal automáticamente después de un breve retraso
            setTimeout(closeEnrollmentModal, 3000);

        } catch (error) {
            console.error("Error al enviar la inscripción:", error);
            enrollFormMessage.textContent = 'Error al procesar tu inscripción. Por favor, inténtalo de nuevo.';
            enrollFormMessage.className = 'form-message error';
            submitEnrollmentBtn.disabled = false; // Re-habilita el botón en caso de error
            submitEnrollmentBtn.textContent = 'Reintentar Inscripción'; // Actualiza el texto del botón
        }
    });

    initializeFirebase(); // Inicia la inicialización de Firebase y la carga de cursos al cargar la página
});
