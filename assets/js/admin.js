document.addEventListener('DOMContentLoaded', () => {
    // Referencias a elementos del DOM (Login y Navegación)
    const loginSection = document.getElementById('login-section');
    const adminNavMenu = document.getElementById('admin-nav-menu');
    const loginForm = document.getElementById('login-form');
    const passwordInput = document.getElementById('password');
    const loginMessage = document.getElementById('login-message');
    const showQuotesBtn = document.getElementById('show-quotes-btn');
    const showCoursesBtn = document.getElementById('show-courses-btn');

    // Referencias a elementos del DOM (Sección de Cotizaciones)
    const quotesDashboardSection = document.getElementById('quotes-dashboard-section');
    const quotesTableBody = document.querySelector('#quotes-table tbody');
    const loadingQuotesMessage = document.getElementById('loading-quotes');
    const noQuotesMessage = document.getElementById('no-quotes-message');
    const globalTableMessage = document.getElementById('global-table-message');

    // Referencias a elementos del DOM (Sección de Gestión de Cursos)
    const coursesManagementSection = document.getElementById('courses-management-section');
    const addCourseBtn = document.getElementById('add-course-btn');
    const coursesTableBody = document.querySelector('#courses-table tbody');
    const loadingCoursesMessage = document.getElementById('loading-courses');
    const noCoursesMessage = document.getElementById('no-courses-message');
    const globalCourseMessage = document.getElementById('global-course-message');

    // Referencias a elementos del DOM (Modal de Curso)
    const courseModal = document.getElementById('courseModal');
    const courseModalTitle = document.getElementById('courseModalTitle');
    const courseForm = document.getElementById('courseForm');
    const courseIdInput = document.getElementById('courseId');
    const courseOrderInput = document.getElementById('courseOrder');
    const courseNameInput = document.getElementById('courseName');
    const courseDescriptionInput = document.getElementById('courseDescription');
    const coursePriceInput = document.getElementById('coursePrice');
    const courseScheduleInput = document.getElementById('courseSchedule');
    const courseDurationInput = document.getElementById('courseDuration');
    const courseGamesInput = document.getElementById('courseGames');
    const saveCourseBtn = document.getElementById('saveCourseBtn');
    const courseFormMessage = document.getElementById('courseFormMessage');
    const closeCourseModalBtn = courseModal.querySelector('.close-button');


    // 🚨 ATENCIÓN: Esta contraseña es solo para DEMOSTRACIÓN y pruebas locales.
    // NO uses una contraseña hardcodeada como esta en un entorno de producción real.
    const ADMIN_PASSWORD = 'miproyecto2025$'; // <-- ¡CAMBIA ESTA CONTRASEÑA!

    // Variables de Firebase
    let db;
    let collection;
    let getDocs;
    let docRef; 
    let updateDoc; 
    let addDoc; // Asegúrate de que addDoc esté disponible
    let deleteDoc; // Asegúrate de que deleteDoc esté disponible
    let appId;
    let initialAuthToken;
    let signInAnonymously;
    let signInWithCustomToken;

    // Función para mostrar mensajes globales en la tabla de cotizaciones
    const showGlobalQuoteMessage = (message, type) => {
        globalTableMessage.textContent = message;
        globalTableMessage.className = `message ${type}`;
        globalTableMessage.style.display = 'block';
        setTimeout(() => {
            globalTableMessage.style.display = 'none';
        }, 3000); 
    };

    // Función para mostrar mensajes globales en la tabla de cursos
    const showGlobalCourseMessage = (message, type) => {
        globalCourseMessage.textContent = message;
        globalCourseMessage.className = `message ${type}`;
        globalCourseMessage.style.display = 'block';
        setTimeout(() => {
            globalCourseMessage.style.display = 'none';
        }, 3000); 
    };

    // Función para inicializar Firebase (centralizada)
    const initializeFirebase = async () => {
        if (window.firebaseDb && window.firebaseCollection && window.firebaseGetDocs && 
            window.firebaseDoc && window.firebaseUpdateDoc && window.firebaseAddDoc && window.firebaseDeleteDoc) {
            
            db = window.firebaseDb;
            collection = window.firebaseCollection;
            getDocs = window.firebaseGetDocs; 
            docRef = window.firebaseDoc; 
            updateDoc = window.firebaseUpdateDoc; 
            addDoc = window.firebaseAddDoc; 
            deleteDoc = window.firebaseDeleteDoc; 
            appId = window.appId;
            initialAuthToken = window.initialAuthToken;
            signInAnonymously = window.signInAnonymously;
            signInWithCustomToken = window.signInWithCustomToken;

            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(window.firebaseAuth, initialAuthToken);
                    console.log("Firebase: Sesión iniciada con token personalizado para admin.");
                } else {
                    await signInAnonymously(window.firebaseAuth);
                    console.log("Firebase: Sesión iniciada anónimamente para admin.");
                }
                // Si la autenticación anónima es exitosa, carga las cotizaciones por defecto
                showSection('quotes');
            } catch (error) {
                console.error("Firebase: Error al iniciar sesión en Firebase para admin:", error);
                loginMessage.textContent = 'Error de conexión con la base de datos. Intente recargar.';
                loginMessage.className = 'message error';
            }
        } else {
            console.error("Firebase SDK global variables not found for admin.js. Retrying in 100ms...");
            setTimeout(initializeFirebase, 100);
        }
    };

    // Manejo del formulario de login
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const enteredPassword = passwordInput.value;

        if (enteredPassword === ADMIN_PASSWORD) {
            loginSection.style.display = 'none';
            adminNavMenu.style.display = 'flex'; // Mostrar la navegación del admin
            initializeFirebase(); // Inicia Firebase y carga los datos después del login
        } else {
            loginMessage.textContent = 'Contraseña incorrecta. Inténtelo de nuevo.';
            loginMessage.className = 'message error';
            passwordInput.value = ''; // Limpiar el campo de contraseña
        }
    });

    // Función para cambiar de sección en el panel de administración
    const showSection = (sectionId) => {
        // Ocultar todas las secciones del dashboard
        quotesDashboardSection.style.display = 'none';
        coursesManagementSection.style.display = 'none';

        // Eliminar clase 'current' de todos los botones de navegación
        showQuotesBtn.classList.remove('current');
        showCoursesBtn.classList.remove('current');

        // Mostrar la sección correspondiente y añadir 'current' al botón
        if (sectionId === 'quotes') {
            quotesDashboardSection.style.display = 'block';
            showQuotesBtn.classList.add('current');
            fetchQuotes(); // Recargar cotizaciones
        } else if (sectionId === 'courses') {
            coursesManagementSection.style.display = 'block';
            showCoursesBtn.classList.add('current');
            fetchCourses(); // Recargar cursos
        }
    };

    // Event Listeners para la navegación del panel
    showQuotesBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('quotes');
    });

    showCoursesBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('courses');
    });


    // --- Lógica de Gestión de COTIZACIONES ---

    // Función para cargar las cotizaciones desde Firestore
    const fetchQuotes = async () => {
        loadingQuotesMessage.style.display = 'block';
        quotesTableBody.innerHTML = ''; 
        noQuotesMessage.style.display = 'none';
        globalTableMessage.style.display = 'none'; 

        try {
            const collectionPath = `artifacts/${appId}/public/data/service_requests`;
            const quotesCol = collection(db, collectionPath);
            const quotesSnapshot = await getDocs(quotesCol);

            if (quotesSnapshot.empty) {
                loadingQuotesMessage.style.display = 'none';
                noQuotesMessage.style.display = 'block';
                return;
            }

            loadingQuotesMessage.style.display = 'none';

            const quotes = quotesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            quotes.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0)); 

            quotes.forEach(quote => {
                const row = quotesTableBody.insertRow();
                row.dataset.docId = quote.id; 

                if (quote.status === 'processed') {
                    row.classList.add('processed-row');
                }

                row.insertCell().textContent = quote.timestamp ? new Date(quote.timestamp.seconds * 1000).toLocaleString() : 'N/A';
                row.insertCell().textContent = quote.fullName || 'N/A';
                row.insertCell().textContent = quote.email || 'N/A';
                row.insertCell().textContent = quote.phone || 'N/A';
                row.insertCell().textContent = quote.eventType || 'N/A';
                row.insertCell().textContent = quote.eventDate || 'N/A';
                row.insertCell().textContent = quote.details || 'N/A';
                row.insertCell().textContent = quote.quoteContext || 'General'; 
                
                const statusCell = row.insertCell();
                statusCell.className = 'status-cell';
                statusCell.textContent = quote.status === 'processed' ? 'Procesada' : 'Pendiente';

                const actionsCell = row.insertCell();
                const processButton = document.createElement('button');
                processButton.textContent = quote.status === 'processed' ? 'Marcar como Pendiente' : 'Marcar como Procesada';
                processButton.className = 'btn btn-secondary btn-action';
                processButton.disabled = quote.status === 'processing'; 
                processButton.addEventListener('click', () => toggleQuoteStatus(quote.id, quote.status, processButton, row, statusCell));
                actionsCell.appendChild(processButton);
            });

        } catch (error) {
            console.error("Error al cargar las cotizaciones desde Firestore:", error);
            loadingQuotesMessage.textContent = 'Error al cargar las solicitudes. Por favor, asegúrese de que Firestore esté configurado y las reglas de seguridad lo permitan.';
            loadingQuotesMessage.style.color = '#dc3545';
        }
    };

    // Función para alternar el estado de una cotización
    const toggleQuoteStatus = async (docId, currentStatus, button, row, statusCell) => {
        const newStatus = currentStatus === 'processed' ? 'pending' : 'processed';
        const newButtonText = newStatus === 'processed' ? 'Marcar como Pendiente' : 'Marcar como Procesada';
        const newDisplayStatus = newStatus === 'processed' ? 'Procesada' : 'Pendiente';

        button.disabled = true; 
        button.textContent = 'Actualizando...';
        showGlobalQuoteMessage('Actualizando estado de la solicitud...', 'loading');

        try {
            const quoteRef = docRef(db, `artifacts/${appId}/public/data/service_requests`, docId);
            await updateDoc(quoteRef, {
                status: newStatus,
                lastUpdated: new Date() 
            });

            statusCell.textContent = newDisplayStatus;
            button.textContent = newButtonText;
            
            if (newStatus === 'processed') {
                row.classList.add('processed-row');
            } else {
                row.classList.remove('processed-row');
            }
            showGlobalQuoteMessage('Estado actualizado con éxito.', 'success');

        } catch (error) {
            console.error("Error al actualizar el estado de la cotización:", error);
            showGlobalQuoteMessage('Error al actualizar el estado. Inténtelo de nuevo.', 'error');
            button.textContent = currentStatus === 'processed' ? 'Marcar como Pendiente' : 'Marcar como Procesada'; 
        } finally {
            button.disabled = false; 
        }
    };

    // --- Lógica de Gestión de CURSOS ---

    // Función para cargar los cursos desde Firestore
    const fetchCourses = async () => {
        loadingCoursesMessage.style.display = 'block';
        coursesTableBody.innerHTML = ''; // Limpiar filas anteriores
        noCoursesMessage.style.display = 'none';
        globalCourseMessage.style.display = 'none';

        try {
            const collectionPath = `artifacts/${appId}/public/data/courses`;
            const coursesCol = collection(db, collectionPath);
            const coursesSnapshot = await getDocs(coursesCol);

            if (coursesSnapshot.empty) {
                loadingCoursesMessage.style.display = 'none';
                noCoursesMessage.style.display = 'block';
                return;
            }

            loadingCoursesMessage.style.display = 'none';

            const courses = coursesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            courses.sort((a, b) => (a.order || Infinity) - (b.order || Infinity)); // Ordenar por campo 'order'

            courses.forEach(course => {
                const row = coursesTableBody.insertRow();
                row.dataset.docId = course.id;

                row.insertCell().textContent = course.order || 'N/A';
                row.insertCell().textContent = course.name || 'N/A';
                row.insertCell().textContent = course.description || 'N/A';
                row.insertCell().textContent = course.price || 'N/A';
                row.insertCell().textContent = course.schedule || 'N/A';
                row.insertCell().textContent = course.duration || 'N/A';
                row.insertCell().textContent = Array.isArray(course.gamesIncluded) ? course.gamesIncluded.join(', ') : (course.gamesIncluded || 'N/A');
                
                const actionsCell = row.insertCell();
                const editButton = document.createElement('button');
                editButton.textContent = 'Editar';
                editButton.className = 'btn btn-action edit';
                editButton.addEventListener('click', () => openCourseModalForEdit(course));
                actionsCell.appendChild(editButton);

                const deleteButton = document.createElement('button');
                deleteButton.textContent = 'Eliminar';
                deleteButton.className = 'btn btn-action delete';
                deleteButton.addEventListener('click', () => deleteCourse(course.id, course.name));
                actionsCell.appendChild(deleteButton);
            });

        } catch (error) {
            console.error("Error al cargar los cursos desde Firestore:", error);
            showGlobalCourseMessage('Error al cargar los cursos. Por favor, revise la consola para más detalles.', 'error');
        }
    };

    // Abre el modal para añadir un nuevo curso
    addCourseBtn.addEventListener('click', () => {
        courseForm.reset(); // Limpiar formulario
        courseIdInput.value = ''; // Asegurarse de que no haya ID de curso para edición
        courseModalTitle.textContent = 'Añadir Nuevo Curso';
        saveCourseBtn.textContent = 'Guardar Curso';
        courseFormMessage.style.display = 'none';
        courseModal.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Evitar scroll de fondo
    });

    // Cierra el modal de curso
    closeCourseModalBtn.addEventListener('click', () => {
        courseModal.style.display = 'none';
        document.body.style.overflow = 'auto'; // Habilitar scroll de fondo
    });

    // Cierra el modal al hacer clic fuera del contenido
    window.addEventListener('click', (event) => {
        if (event.target == courseModal) {
            courseModal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    });

    // Abre el modal para editar un curso existente
    const openCourseModalForEdit = (course) => {
        courseForm.reset();
        courseIdInput.value = course.id;
        courseOrderInput.value = course.order || '';
        courseNameInput.value = course.name || '';
        courseDescriptionInput.value = course.description || '';
        coursePriceInput.value = course.price || '';
        courseScheduleInput.value = course.schedule || '';
        courseDurationInput.value = course.duration || '';
        courseGamesInput.value = Array.isArray(course.gamesIncluded) ? course.gamesIncluded.join(', ') : (course.gamesIncluded || '');

        courseModalTitle.textContent = 'Editar Curso';
        saveCourseBtn.textContent = 'Actualizar Curso';
        courseFormMessage.style.display = 'none';
        courseModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    // Maneja el envío del formulario de curso (añadir o editar)
    courseForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        saveCourseBtn.disabled = true;
        saveCourseBtn.textContent = 'Guardando...';
        courseFormMessage.textContent = '';
        courseFormMessage.style.display = 'block';
        courseFormMessage.className = 'message loading';

        const courseData = {
            order: parseInt(courseOrderInput.value), // Asegúrate de que sea número
            name: courseNameInput.value,
            description: courseDescriptionInput.value,
            price: coursePriceInput.value,
            schedule: courseScheduleInput.value,
            duration: courseDurationInput.value,
            gamesIncluded: courseGamesInput.value.split(',').map(game => game.trim()).filter(game => game.length > 0) // Convertir a array
        };

        try {
            const collectionPath = `artifacts/${appId}/public/data/courses`;
            if (courseIdInput.value) { // Si hay un ID, es una edición
                const courseRef = docRef(db, collectionPath, courseIdInput.value);
                await updateDoc(courseRef, courseData);
                showGlobalCourseMessage('Curso actualizado con éxito.', 'success');
            } else { // Si no hay ID, es un nuevo curso
                await addDoc(collection(db, collectionPath), courseData);
                showGlobalCourseMessage('Curso añadido con éxito.', 'success');
            }
            courseForm.reset();
            courseModal.style.display = 'none';
            document.body.style.overflow = 'auto';
            fetchCourses(); // Recargar la tabla de cursos
        } catch (error) {
            console.error("Error al guardar el curso:", error);
            courseFormMessage.textContent = 'Error al guardar el curso. Revise la consola.';
            courseFormMessage.className = 'message error';
        } finally {
            saveCourseBtn.disabled = false;
            saveCourseBtn.textContent = courseIdInput.value ? 'Actualizar Curso' : 'Guardar Curso';
        }
    });

    // Función para eliminar un curso
    const deleteCourse = async (docId, courseName) => {
        // Pedir confirmación antes de eliminar
        // Usaremos una confirmación básica ya que alert() no es ideal.
        // Para una app real, implementarías un modal de confirmación personalizado.
        if (!confirm(`¿Estás seguro de que quieres eliminar el curso "${courseName}"? Esta acción es irreversible.`)) {
            return;
        }

        showGlobalCourseMessage(`Eliminando curso "${courseName}"...`, 'loading');
        try {
            const collectionPath = `artifacts/${appId}/public/data/courses`;
            const courseRef = docRef(db, collectionPath, docId);
            await deleteDoc(courseRef);

            showGlobalCourseMessage(`Curso "${courseName}" eliminado con éxito.`, 'success');
            fetchCourses(); // Recargar la tabla de cursos
        } catch (error) {
            console.error("Error al eliminar el curso:", error);
            showGlobalCourseMessage(`Error al eliminar el curso "${courseName}".`, 'error');
        }
    };
});
