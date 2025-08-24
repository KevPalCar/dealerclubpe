document.addEventListener('DOMContentLoaded', () => {
    // Referencias a elementos del DOM
    const sidebarNav = document.querySelector('.sidebar-nav ul');
    const adminMainTitle = document.getElementById('admin-main-title');
    const adminUserInfo = document.getElementById('admin-user-info');
    const adminLogoutBtn = document.getElementById('admin-logout-btn');

    // Secciones de gestión
    const coursesManagementSection = document.getElementById('courses-management');
    const enrollmentsManagementSection = document.getElementById('enrollments-management');
    const servicesManagementSection = document.getElementById('services-management');
    const dealersManagementSection = document.getElementById('dealers-management');
    const requestsManagementSection = document.getElementById('requests-management');
    const announcementsManagementSection = document.getElementById('announcements-management');

    // Cuerpos de tabla
    const coursesTableBody = document.getElementById('courses-table-body');
    const enrollmentsTableBody = document.getElementById('enrollments-table-body');
    const servicesTableBody = document.getElementById('services-table-body');
    const dealersTableBody = document.getElementById('dealers-table-body');
    const requestsTableBody = document.getElementById('requests-table-body');

    // Mensajes de no hay datos
    const noCoursesMessage = document.getElementById('no-courses-message');
    const noEnrollmentsMessage = document.getElementById('no-enrollments-message');
    const noServicesMessage = document.getElementById('no-services-message');
    const noDealersMessage = document.getElementById('no-dealers-message');
    const noRequestsMessage = document.getElementById('no-requests-message');

    // Botones de añadir
    const addCourseBtn = document.getElementById('add-course-btn');
    const addServiceBtn = document.getElementById('add-service-btn');
    const addDealerBtn = document.getElementById('add-dealer-btn');

    // Modales y sus elementos - Curso
    const courseModal = document.getElementById('courseModal');
    const closeCourseModalBtn = document.getElementById('closeCourseModalBtn');
    const modalTitleAction = document.getElementById('modal-title-action');
    const courseForm = document.getElementById('courseForm');
    const courseIdInput = document.getElementById('courseId');
    const courseNameInput = document.getElementById('courseName');
    const courseOrderInput = document.getElementById('courseOrder');
    const courseDescriptionInput = document.getElementById('courseDescription');
    const coursePriceInput = document.getElementById('coursePrice');
    const courseScheduleInput = document.getElementById('courseSchedule');
    const courseDurationInput = document.getElementById('courseDuration');
    const courseGamesInput = document.getElementById('courseGames');
    const courseStatusSelect = document.getElementById('courseStatus');
    const courseFormMessage = document.getElementById('courseFormMessage');

    // Modales y sus elementos - Dealer
    const dealerModal = document.getElementById('dealerModal');
    const closeDealerModalBtn = document.getElementById('closeDealerModalBtn');
    const dealerModalTitleAction = document.getElementById('dealer-modal-title-action');
    const dealerForm = document.getElementById('dealerForm');
    const dealerIdInput = document.getElementById('dealerId');
    const dealerNameInput = document.getElementById('dealerName');
    const dealerOrderInput = document.getElementById('dealerOrder');
    const dealerSpecialtyInput = document.getElementById('dealerSpecialty');
    const dealerExperienceInput = document.getElementById('dealerExperience');
    const dealerBioInput = document.getElementById('dealerBio');
    const dealerImageUrlInput = document.getElementById('dealerImageUrl');
    const dealerFormMessage = document.getElementById('dealerFormMessage');

    // Elementos del formulario de Anuncios
    const announceBarForm = document.getElementById('announceBarForm');
    const announceText = document.getElementById('announceText');
    const announceStatus = document.getElementById('announceStatus');
    const announceFormMessage = document.getElementById('announceFormMessage');

    // Modal de Confirmación
    const confirmationModal = document.getElementById('confirmationModal');
    const closeConfirmationModalBtn = document.getElementById('closeConfirmationModalBtn');
    const confirmationMessage = document.getElementById('confirmationMessage');
    const cancelConfirmBtn = document.getElementById('cancelConfirmBtn');
    const confirmActionBtn = document.getElementById('confirmActionBtn');

    // Variables de Firebase
    let db;
    let auth;
    let appId;
    let firebaseCollection;
    let firebaseGetDocs;
    let firebaseAddDoc;
    let firebaseSetDoc;
    let firebaseDoc;
    let firebaseUpdateDoc;
    let firebaseDeleteDoc;
    let firebaseOnSnapshot;
    let firebaseSignOut;
    let firebaseOnAuthStateChanged;

    let currentUserId = null;
    const unsubscribeListeners = {}; // Objeto para almacenar las funciones de desuscripción de onSnapshot

    // --- Funciones de Utilidad del Modal ---
    const openModal = (modalElement) => {
        modalElement.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    const closeModal = (modalElement) => {
        modalElement.style.display = 'none';
        document.body.style.overflow = 'auto';
    };

    const showFormMessage = (messageElement, message, type) => {
        messageElement.textContent = message;
        messageElement.className = `form-message ${type}`;
    };

    // --- Inicialización de Firebase ---
    const initializeFirebaseAndAdmin = async () => {
        // Esperar a que las variables globales de Firebase estén disponibles desde admin.html
        // Ya que estas variables son exportadas de un script de módulo antes de cargar admin.js,
        // esperamos que estén listas o reintentamos.
        if (window.firebaseDb && window.firebaseAuth && window.appId) {
            db = window.firebaseDb;
            auth = window.firebaseAuth;
            appId = window.appId;
            firebaseCollection = window.firebaseCollection;
            firebaseGetDocs = window.firebaseGetDocs;
            firebaseAddDoc = window.firebaseAddDoc;
            firebaseSetDoc = window.firebaseSetDoc;
            firebaseDoc = window.firebaseDoc;
            firebaseUpdateDoc = window.firebaseUpdateDoc;
            firebaseDeleteDoc = window.firebaseDeleteDoc;
            firebaseOnSnapshot = window.firebaseOnSnapshot;
            firebaseSignOut = window.firebaseSignOut;
            firebaseOnAuthStateChanged = window.firebaseOnAuthStateChanged;

            // Escuchar cambios en el estado de autenticación de Firebase
            firebaseOnAuthStateChanged(auth, (user) => {
                if (user) {
                    currentUserId = user.uid;
                    adminUserInfo.innerHTML = `<span>Bienvenido, Administrador (${user.uid.substring(0, 8)}...)</span><i class="fas fa-user-circle"></i>`;
                    console.log("Admin.js: Usuario autenticado como administrador:", user.uid);
                    // IMPORTANTE: Solo cargar la sección inicial DESPUÉS de que el usuario esté autenticado.
                    loadSection('courses');
                } else {
                    currentUserId = null;
                    console.warn("Admin.js: No hay usuario autenticado. Redirigiendo a login.");
                    window.location.href = 'login.html';
                }
            });

            // No necesitamos un bloque `if (auth.currentUser)` aquí debido al `onAuthStateChanged` arriba,
            // que manejará la carga inicial una vez que el estado de autenticación se resuelva.
            // Esto evita condiciones de carrera.

        } else {
            console.error("Firebase SDK global variables not found for admin.js. Reintentando en 100ms...");
            setTimeout(initializeFirebaseAndAdmin, 100);
        }
    };

    // --- Lógica para cargar y mostrar secciones ---
    const loadSection = (sectionName) => {
        console.log(`Intentando cargar sección: ${sectionName}`);

        // Desuscribirse de todos los listeners de Firestore activos
        Object.values(unsubscribeListeners).forEach(unsubscribe => unsubscribe());
        for (const key in unsubscribeListeners) {
            delete unsubscribeListeners[key];
        }

        // Ocultar todas las secciones de contenido
        document.querySelectorAll('.admin-content .content-section').forEach(section => {
            section.style.display = 'none';
            section.classList.remove('active');
        });

        // Eliminar 'active' de todos los elementos de navegación
        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            link.classList.remove('active');
        });

        // Mostrar la sección y cargar datos según el nombre
        switch (sectionName) {
            case 'courses':
                coursesManagementSection.style.display = 'block';
                coursesManagementSection.classList.add('active');
                adminMainTitle.textContent = 'Gestión de Cursos';
                document.getElementById('nav-courses').classList.add('active');
                loadCoursesRealtime();
                break;
            case 'enrollments':
                enrollmentsManagementSection.style.display = 'block';
                enrollmentsManagementSection.classList.add('active');
                adminMainTitle.textContent = 'Gestión de Inscripciones';
                document.getElementById('nav-enrollments').classList.add('active');
                loadEnrollmentsRealtime();
                break;
            case 'services':
                servicesManagementSection.style.display = 'block';
                servicesManagementSection.classList.add('active');
                adminMainTitle.textContent = 'Gestión de Servicios';
                document.getElementById('nav-services').classList.add('active');
                loadServicesRealtime();
                break;
            case 'dealers':
                dealersManagementSection.style.display = 'block';
                dealersManagementSection.classList.add('active');
                adminMainTitle.textContent = 'Gestión de Dealers Destacados';
                document.getElementById('nav-dealers').classList.add('active');
                loadDealersRealtime();
                break;
            case 'requests':
                requestsManagementSection.style.display = 'block';
                requestsManagementSection.classList.add('active');
                adminMainTitle.textContent = 'Gestión de Solicitudes';
                document.getElementById('nav-requests').classList.add('active');
                loadRequestsRealtime();
                break;
            case 'announcements':
                announcementsManagementSection.style.display = 'block';
                announcementsManagementSection.classList.add('active');
                adminMainTitle.textContent = 'Gestión de Anuncios';
                document.getElementById('nav-announcements').classList.add('active');
                loadAnnouncementsRealtime();
                break;
            default:
                console.warn(`Sección '${sectionName}' no reconocida. Recargando cursos.`);
                loadSection('courses'); // Fallback a cursos
                break;
        }
    };


    // --- Gestión de Cursos (CRUD) ---
    const loadCoursesRealtime = () => {
        console.log("Cargando cursos en tiempo real...");
        if (!db || !appId || !firebaseOnSnapshot || !currentUserId) {
            console.warn("No se puede iniciar el listener de cursos en tiempo real. Firebase no inicializado o usuario no autenticado.");
            coursesTableBody.innerHTML = `<tr><td colspan="8" class="error-message">Error: Firebase no está listo o usuario no autenticado.</td></tr>`;
            noCoursesMessage.style.display = 'none'; // Ocultar mensaje de no cursos
            return;
        }

        const coursesCollectionRef = firebaseCollection(db, `/artifacts/${appId}/public/data/courses`);

        if (unsubscribeListeners.courses) {
            unsubscribeListeners.courses();
        }

        unsubscribeListeners.courses = firebaseOnSnapshot(coursesCollectionRef, (querySnapshot) => {
            coursesTableBody.innerHTML = '';
            if (querySnapshot.empty) {
                noCoursesMessage.style.display = 'block';
                return;
            }
            noCoursesMessage.style.display = 'none';

            const courses = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            courses.sort((a, b) => (a.order || 999) - (b.order || 999));

            courses.forEach(course => {
                const row = coursesTableBody.insertRow();
                row.dataset.courseId = course.id;

                row.innerHTML = `
                    <td>${course.order || '-'}</td>
                    <td>${course.name || 'N/A'}</td>
                    <td>${(course.description && course.description.length > 50) ? course.description.substring(0, 50) + '...' : course.description || 'N/A'}</td>
                    <td>${course.price || 'N/A'}</td>
                    <td>${course.schedule || 'N/A'}</td>
                    <td>${course.duration || 'N/A'}</td>
                    <td>
                        <select class="status-select" data-course-id="${course.id}">
                            <option value="Abierto" ${course.status === 'Abierto' ? 'selected' : ''}>Abierto</option>
                            <option value="En Progreso" ${course.status === 'En Progreso' ? 'selected' : ''}>En Progreso</option>
                            <option value="Próximamente" ${course.status === 'Próximamente' ? 'selected' : ''}>Próximamente</option>
                            <option value="Cerrado" ${course.status === 'Cerrado' ? 'selected' : ''}>Cerrado</option>
                        </select>
                    </td>
                    <td class="action-buttons">
                        <button class="btn btn-secondary btn-edit" data-collection="courses" data-id="${course.id}"><i class="fas fa-edit"></i> Editar</button>
                        <button class="btn btn-danger btn-delete" data-collection="courses" data-id="${course.id}"><i class="fas fa-trash-alt"></i> Eliminar</button>
                    </td>
                `;
            });

            // Asegurarse de adjuntar eventos a los elementos recién creados
            document.querySelectorAll('#courses-table-body .status-select').forEach(select => {
                select.addEventListener('change', async (event) => {
                    const courseId = event.target.dataset.courseId;
                    const newStatus = event.target.value;
                    await updateCourseStatus(courseId, newStatus);
                });
            });

            document.querySelectorAll('#courses-table-body .btn-edit').forEach(button => {
                button.addEventListener('click', (event) => {
                    const courseId = event.target.dataset.id;
                    openEditCourseModal(courseId, courses);
                });
            });
            document.querySelectorAll('#courses-table-body .btn-delete').forEach(button => {
                button.addEventListener('click', (event) => {
                    const courseId = event.target.dataset.id;
                    openConfirmationModal('¿Estás seguro de que quieres eliminar este curso?', () => deleteItem('courses', courseId));
                });
            });

        }, (error) => {
            console.error("Error al escuchar cursos en tiempo real:", error);
            coursesTableBody.innerHTML = `<tr><td colspan="8" class="error-message">Error al cargar cursos: ${error.message}</td></tr>`;
        });
    };

    const updateCourseStatus = async (courseId, newStatus) => {
        try {
            const courseRef = firebaseDoc(db, `/artifacts/${appId}/public/data/courses/${courseId}`);
            await firebaseUpdateDoc(courseRef, { status: newStatus });
            console.log(`Status del curso ${courseId} actualizado a ${newStatus}`);
        } catch (error) {
            console.error("Error al actualizar el status del curso:", error);
            showFormMessage(courseFormMessage, `Error al actualizar el estado: ${error.message}`, 'error');
        }
    };

    addCourseBtn.addEventListener('click', () => {
        courseForm.reset();
        courseIdInput.value = '';
        modalTitleAction.textContent = 'Añadir';
        showFormMessage(courseFormMessage, '', '');
        openModal(courseModal);
    });

    const openEditCourseModal = (courseId, coursesList) => {
        const courseToEdit = coursesList.find(c => c.id === courseId);
        if (courseToEdit) {
            courseIdInput.value = courseToEdit.id;
            courseNameInput.value = courseToEdit.name || '';
            courseOrderInput.value = courseToEdit.order || 0;
            courseDescriptionInput.value = courseToEdit.description || '';
            coursePriceInput.value = courseToEdit.price || '';
            courseScheduleInput.value = courseToEdit.schedule || '';
            courseDurationInput.value = courseToEdit.duration || '';
            courseGamesInput.value = (courseToEdit.gamesIncluded && Array.isArray(courseToEdit.gamesIncluded)) ? courseToEdit.gamesIncluded.join(', ') : '';
            courseStatusSelect.value = courseToEdit.status || 'Abierto';

            modalTitleAction.textContent = 'Editar';
            showFormMessage(courseFormMessage, '', '');
            openModal(courseModal);
        } else {
            console.error("Curso no encontrado para editar:", courseId);
            showFormMessage(courseFormMessage, 'Error: Curso no encontrado para editar.', 'error');
        }
    };

    courseForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        showFormMessage(courseFormMessage, 'Guardando curso...', 'loading');

        const isEditing = !!courseIdInput.value;
        const courseData = {
            name: courseNameInput.value,
            order: parseInt(courseOrderInput.value, 10),
            description: courseDescriptionInput.value,
            price: coursePriceInput.value,
            schedule: courseScheduleInput.value,
            duration: courseDurationInput.value,
            gamesIncluded: courseGamesInput.value.split(',').map(game => game.trim()).filter(game => game !== ''),
            status: courseStatusSelect.value,
            lastUpdated: new Date()
        };

        try {
            if (isEditing) {
                const courseRef = firebaseDoc(db, `/artifacts/${appId}/public/data/courses/${courseIdInput.value}`);
                await firebaseUpdateDoc(courseRef, courseData);
                showFormMessage(courseFormMessage, 'Curso actualizado exitosamente.', 'success');
            } else {
                const coursesCollectionRef = firebaseCollection(db, `/artifacts/${appId}/public/data/courses`);
                await firebaseAddDoc(coursesCollectionRef, courseData);
                showFormMessage(courseFormMessage, 'Curso añadido exitosamente.', 'success');
            }
            setTimeout(() => closeModal(courseModal), 1500);
        } catch (error) {
            console.error("Error al guardar el curso:", error);
            showFormMessage(courseFormMessage, `Error al guardar el curso: ${error.message}`, 'error');
        }
    });

    // --- Gestión de Inscripciones ---
    const loadEnrollmentsRealtime = () => {
        console.log("Cargando inscripciones en tiempo real...");
        if (!db || !appId || !firebaseOnSnapshot || !currentUserId) {
            console.warn("No se puede iniciar el listener de inscripciones. Firebase no inicializado o usuario no autenticado.");
            enrollmentsTableBody.innerHTML = `<tr><td colspan="8" class="error-message">Error: Firebase no está listo o usuario no autenticado.</td></tr>`;
            noEnrollmentsMessage.style.display = 'none';
            return;
        }

        const enrollmentsCollectionRef = firebaseCollection(db, `/artifacts/${appId}/public/data/course_enrollments`);

        if (unsubscribeListeners.enrollments) {
            unsubscribeListeners.enrollments();
        }

        unsubscribeListeners.enrollments = firebaseOnSnapshot(enrollmentsCollectionRef, (querySnapshot) => {
            enrollmentsTableBody.innerHTML = '';
            if (querySnapshot.empty) {
                noEnrollmentsMessage.style.display = 'block';
                return;
            }
            noEnrollmentsMessage.style.display = 'none';

            querySnapshot.docs.forEach(doc => {
                const enrollment = doc.data();
                const row = enrollmentsTableBody.insertRow();
                row.innerHTML = `
                    <td>${enrollment.courseName || 'N/A'}</td>
                    <td>${enrollment.fullName || 'N/A'}</td>
                    <td>${enrollment.email || 'N/A'}</td>
                    <td>${enrollment.phone || 'N/A'}</td>
                    <td>${(enrollment.comments && enrollment.comments.length > 50) ? enrollment.comments.substring(0, 50) + '...' : enrollment.comments || 'N/A'}</td>
                    <td>${enrollment.timestamp ? new Date(enrollment.timestamp.seconds * 1000).toLocaleDateString() : 'N/A'}</td>
                    <td>${enrollment.status || 'N/A'}</td>
                    <td class="action-buttons">
                        <button class="btn btn-danger btn-delete" data-collection="course_enrollments" data-id="${doc.id}"><i class="fas fa-trash-alt"></i> Eliminar</button>
                    </td>
                `;
            });
             document.querySelectorAll('#enrollments-table-body .btn-delete').forEach(button => {
                button.addEventListener('click', (event) => {
                    const id = event.target.dataset.id;
                    openConfirmationModal('¿Estás seguro de que quieres eliminar esta inscripción?', () => deleteItem('course_enrollments', id));
                });
            });
        }, (error) => {
            console.error("Error al escuchar inscripciones en tiempo real:", error);
            enrollmentsTableBody.innerHTML = `<tr><td colspan="8" class="error-message">Error al cargar inscripciones: ${error.message}</td></tr>`;
        });
    };

    // --- Gestión de Servicios ---
    const loadServicesRealtime = () => {
        console.log("Cargando servicios en tiempo real...");
        if (!db || !appId || !firebaseOnSnapshot || !currentUserId) {
            console.warn("No se puede iniciar el listener de servicios. Firebase no inicializado o usuario no autenticado.");
            servicesTableBody.innerHTML = `<tr><td colspan="6" class="error-message">Error: Firebase no está listo o usuario no autenticado.</td></tr>`;
            noServicesMessage.style.display = 'none';
            return;
        }

        const servicesCollectionRef = firebaseCollection(db, `/artifacts/${appId}/public/data/services`);

        if (unsubscribeListeners.services) {
            unsubscribeListeners.services();
        }

        unsubscribeListeners.services = firebaseOnSnapshot(servicesCollectionRef, (querySnapshot) => {
            servicesTableBody.innerHTML = '';
            if (querySnapshot.empty) {
                noServicesMessage.style.display = 'block';
                return;
            }
            noServicesMessage.style.display = 'none';

            querySnapshot.docs.forEach(doc => {
                const service = doc.data();
                const row = servicesTableBody.insertRow();
                row.innerHTML = `
                    <td>${service.order || '-'}</td>
                    <td>${service.name || 'N/A'}</td>
                    <td>${(service.description && service.description.length > 50) ? service.description.substring(0, 50) + '...' : service.description || 'N/A'}</td>
                    <td>${service.price || 'N/A'}</td>
                    <td>${service.status || 'N/A'}</td>
                    <td class="action-buttons">
                        <button class="btn btn-secondary btn-edit" data-collection="services" data-id="${doc.id}"><i class="fas fa-edit"></i> Editar</button>
                        <button class="btn btn-danger btn-delete" data-collection="services" data-id="${doc.id}"><i class="fas fa-trash-alt"></i> Eliminar</button>
                    </td>
                `;
            });
            document.querySelectorAll('#services-table-body .btn-edit').forEach(button => {
                button.addEventListener('click', (event) => {
                    const id = event.target.dataset.id;
                    alert('Funcionalidad de edición de servicio aún no implementada.');
                });
            });
            document.querySelectorAll('#services-table-body .btn-delete').forEach(button => {
                button.addEventListener('click', (event) => {
                    const id = event.target.dataset.id;
                    openConfirmationModal('¿Estás seguro de que quieres eliminar este servicio?', () => deleteItem('services', id));
                });
            });
        }, (error) => {
            console.error("Error al escuchar servicios en tiempo real:", error);
            servicesTableBody.innerHTML = `<tr><td colspan="6" class="error-message">Error al cargar servicios: ${error.message}</td></tr>`;
        });
    };
    addServiceBtn.addEventListener('click', () => {
        alert('Funcionalidad de añadir servicio aún no implementada.');
    });

    // --- Gestión de Dealers Destacados ---
    const loadDealersRealtime = () => {
        console.log("Cargando dealers en tiempo real...");
        if (!db || !appId || !firebaseOnSnapshot || !currentUserId) {
            console.warn("No se puede iniciar el listener de dealers. Firebase no inicializado o usuario no autenticado.");
            dealersTableBody.innerHTML = `<tr><td colspan="6" class="error-message">Error: Firebase no está listo o usuario no autenticado.</td></tr>`;
            noDealersMessage.style.display = 'none';
            return;
        }

        const dealersCollectionRef = firebaseCollection(db, `/artifacts/${appId}/public/data/dealers`);

        if (unsubscribeListeners.dealers) {
            unsubscribeListeners.dealers();
        }

        unsubscribeListeners.dealers = firebaseOnSnapshot(dealersCollectionRef, (querySnapshot) => {
            dealersTableBody.innerHTML = '';
            if (querySnapshot.empty) {
                noDealersMessage.style.display = 'block';
                return;
            }
            noDealersMessage.style.display = 'none';

            const dealers = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            dealers.sort((a, b) => (a.order || 999) - (b.order || 999));

            dealers.forEach(dealer => {
                const row = dealersTableBody.insertRow();
                row.innerHTML = `
                    <td>${dealer.order || '-'}</td>
                    <td>${dealer.name || 'N/A'}</td>
                    <td>${dealer.specialty || 'N/A'}</td>
                    <td>${dealer.experience || 'N/A'}</td>
                    <td>${(dealer.bio && dealer.bio.length > 50) ? dealer.bio.substring(0, 50) + '...' : dealer.bio || 'N/A'}</td>
                    <td class="action-buttons">
                        <button class="btn btn-secondary btn-edit" data-collection="dealers" data-id="${dealer.id}"><i class="fas fa-edit"></i> Editar</button>
                        <button class="btn btn-danger btn-delete" data-collection="dealers" data-id="${dealer.id}"><i class="fas fa-trash-alt"></i> Eliminar</button>
                    </td>
                `;
            });
             document.querySelectorAll('#dealers-table-body .btn-edit').forEach(button => {
                button.addEventListener('click', (event) => {
                    const id = event.target.dataset.id;
                    openEditDealerModal(id, dealers);
                });
            });
            document.querySelectorAll('#dealers-table-body .btn-delete').forEach(button => {
                button.addEventListener('click', (event) => {
                    const id = event.target.dataset.id;
                    openConfirmationModal('¿Estás seguro de que quieres eliminar este dealer?', () => deleteItem('dealers', id));
                });
            });
        }, (error) => {
            console.error("Error al escuchar dealers en tiempo real:", error);
            dealersTableBody.innerHTML = `<tr><td colspan="6" class="error-message">Error al cargar dealers: ${error.message}</td></tr>`;
        });
    };
    
    addDealerBtn.addEventListener('click', () => {
        dealerForm.reset();
        dealerIdInput.value = '';
        dealerModalTitleAction.textContent = 'Añadir';
        showFormMessage(dealerFormMessage, '', '');
        openModal(dealerModal);
    });

    const openEditDealerModal = (dealerId, dealersList) => {
        const dealerToEdit = dealersList.find(d => d.id === dealerId);
        if (dealerToEdit) {
            dealerIdInput.value = dealerToEdit.id;
            dealerNameInput.value = dealerToEdit.name || '';
            dealerOrderInput.value = dealerToEdit.order || 0;
            dealerSpecialtyInput.value = dealerToEdit.specialty || '';
            dealerExperienceInput.value = dealerToEdit.experience || '';
            dealerBioInput.value = dealerToEdit.bio || '';
            dealerImageUrlInput.value = dealerToEdit.imageUrl || '';

            dealerModalTitleAction.textContent = 'Editar';
            showFormMessage(dealerFormMessage, '', '');
            openModal(dealerModal);
        } else {
            console.error("Dealer no encontrado para editar:", dealerId);
            showFormMessage(dealerFormMessage, 'Error: Dealer no encontrado para editar.', 'error');
        }
    };

    dealerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        showFormMessage(dealerFormMessage, 'Guardando dealer...', 'loading');

        const isEditing = !!dealerIdInput.value;
        const dealerData = {
            name: dealerNameInput.value,
            order: parseInt(dealerOrderInput.value, 10),
            specialty: dealerSpecialtyInput.value,
            experience: parseInt(dealerExperienceInput.value, 10),
            bio: dealerBioInput.value,
            imageUrl: dealerImageUrlInput.value,
            lastUpdated: new Date()
        };

        try {
            if (isEditing) {
                const dealerRef = firebaseDoc(db, `/artifacts/${appId}/public/data/dealers/${dealerIdInput.value}`);
                await firebaseUpdateDoc(dealerRef, dealerData);
                showFormMessage(dealerFormMessage, 'Dealer actualizado exitosamente.', 'success');
            } else {
                const dealersCollectionRef = firebaseCollection(db, `/artifacts/${appId}/public/data/dealers`);
                await firebaseAddDoc(dealersCollectionRef, dealerData);
                showFormMessage(dealerFormMessage, 'Dealer añadido exitosamente.', 'success');
            }
            setTimeout(() => closeModal(dealerModal), 1500);
        } catch (error) {
            console.error("Error al guardar el dealer:", error);
            showFormMessage(dealerFormMessage, `Error al guardar el dealer: ${error.message}`, 'error');
        }
    });

    // --- Gestión de Solicitudes ---
    const loadRequestsRealtime = () => {
        console.log("Cargando solicitudes en tiempo real...");
        if (!db || !appId || !firebaseOnSnapshot || !currentUserId) {
            console.warn("No se puede iniciar el listener de solicitudes. Firebase no inicializado o usuario no autenticado.");
            requestsTableBody.innerHTML = `<tr><td colspan="8" class="error-message">Error: Firebase no está listo o usuario no autenticado.</td></tr>`;
            noRequestsMessage.style.display = 'none';
            return;
        }

        const requestsCollectionRef = firebaseCollection(db, `/artifacts/${appId}/public/data/service_requests`);

        if (unsubscribeListeners.requests) {
            unsubscribeListeners.requests();
        }

        unsubscribeListeners.requests = firebaseOnSnapshot(requestsCollectionRef, (querySnapshot) => {
            requestsTableBody.innerHTML = '';
            if (querySnapshot.empty) {
                noRequestsMessage.style.display = 'block';
                return;
            }
            noRequestsMessage.style.display = 'none';

            querySnapshot.docs.forEach(doc => {
                const request = doc.data();
                const row = requestsTableBody.insertRow();
                row.innerHTML = `
                    <td>${doc.id.substring(0, 8)}...</td>
                    <td>${request.fullName || 'N/A'}</td>
                    <td>${request.email || 'N/A'}</td>
                    <td>${request.subject || 'N/A'}</td>
                    <td>${(request.message && request.message.length > 50) ? request.message.substring(0, 50) + '...' : request.message || 'N/A'}</td>
                    <td>${request.timestamp ? new Date(request.timestamp.seconds * 1000).toLocaleDateString() : 'N/A'}</td>
                    <td>${request.status || 'N/A'}</td>
                    <td class="action-buttons">
                        <button class="btn btn-danger btn-delete" data-collection="service_requests" data-id="${doc.id}"><i class="fas fa-trash-alt"></i> Eliminar</button>
                    </td>
                `;
            });
            document.querySelectorAll('#requests-table-body .btn-delete').forEach(button => {
                button.addEventListener('click', (event) => {
                    const id = event.target.dataset.id;
                    openConfirmationModal('¿Estás seguro de que quieres eliminar esta solicitud?', () => deleteItem('service_requests', id));
                });
            });
        }, (error) => {
            console.error("Error al escuchar solicitudes en tiempo real:", error);
            requestsTableBody.innerHTML = `<tr><td colspan="8" class="error-message">Error al cargar solicitudes: ${error.message}</td></tr>`;
        });
    };

    // --- Gestión de Anuncios ---
    const loadAnnouncementsRealtime = () => {
        console.log("Cargando anuncio en tiempo real...");
        if (!db || !appId || !firebaseOnSnapshot || !firebaseDoc || !currentUserId) {
            console.warn("Firebase no está completamente inicializado o usuario no autenticado para anuncios.");
            showFormMessage(announceFormMessage, 'Error al cargar anuncio: Firebase no listo o usuario no autenticado.', 'error');
            return;
        }

        const announcementsDocRef = firebaseDoc(db, `/artifacts/${appId}/public/data/config/announceBar`);

        if (unsubscribeListeners.announcements) {
            unsubscribeListeners.announcements();
        }

        unsubscribeListeners.announcements = firebaseOnSnapshot(announcementsDocRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                const data = docSnapshot.data();
                announceText.value = data.text || '';
                announceStatus.value = data.status || 'inactive';
                console.log("Anuncio cargado:", data);
            } else {
                announceText.value = '';
                announceStatus.value = 'inactive';
                console.log("No se encontró el documento de anuncio, inicializando campos.");
            }
            showFormMessage(announceFormMessage, '', ''); // Limpiar mensaje previo al cargar el formulario
        }, (error) => {
            console.error("Error al escuchar anuncio en tiempo real:", error);
            showFormMessage(announceFormMessage, `Error al cargar anuncio: ${error.message}`, 'error');
        });
    };

    announceBarForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        showFormMessage(announceFormMessage, 'Guardando anuncio...', 'loading');

        const announceData = {
            text: announceText.value,
            status: announceStatus.value,
            lastUpdated: new Date()
        };

        try {
            const announcementsDocRef = firebaseDoc(db, `/artifacts/${appId}/public/data/config/announceBar`);
            await firebaseSetDoc(announcementsDocRef, announceData, { merge: true });
            showFormMessage(announceFormMessage, 'Anuncio guardado exitosamente.', 'success');
            console.log("Anuncio guardado:", announceData);
        } catch (error) {
            console.error("Error al guardar el anuncio:", error);
            showFormMessage(announceFormMessage, `Error al guardar el anuncio: ${error.message}`, 'error');
        }
    });

    // --- Función Genérica para Eliminar Item ---
    const deleteItem = async (collectionName, itemId) => {
        try {
            const itemRef = firebaseDoc(db, `/artifacts/${appId}/public/data/${collectionName}/${itemId}`);
            await firebaseDeleteDoc(itemRef);
            console.log(`Documento ${itemId} de la colección ${collectionName} eliminado.`);
            showFormMessage(courseFormMessage, `Item eliminado de ${collectionName} exitosamente.`, 'success');
            setTimeout(() => closeModal(confirmationModal), 500);
        } catch (error) {
            console.error(`Error al eliminar el item de ${collectionName}:`, error);
            showFormMessage(courseFormMessage, `Error al eliminar el item: ${error.message}`, 'error');
        }
    };


    // --- Cierre de Modales ---
    closeCourseModalBtn.addEventListener('click', () => closeModal(courseModal));
    closeDealerModalBtn.addEventListener('click', () => closeModal(dealerModal));
    closeConfirmationModalBtn.addEventListener('click', () => closeModal(confirmationModal));

    window.addEventListener('click', (event) => {
        if (event.target === courseModal) closeModal(courseModal);
        if (event.target === dealerModal) closeModal(dealerModal);
        if (event.target === confirmationModal) closeModal(confirmationModal);
    });

    // --- Navegación del Sidebar ---
    sidebarNav.addEventListener('click', (event) => {
        event.preventDefault();
        const target = event.target.closest('a');

        if (target) {
            if (target.id === 'admin-logout-btn') {
                handleAdminLogout();
                return;
            }
            // Mapear IDs de navegación a nombres de sección
            const sectionMap = {
                'nav-courses': 'courses',
                'nav-enrollments': 'enrollments',
                'nav-services': 'services',
                'nav-dealers': 'dealers',
                'nav-requests': 'requests',
                'nav-announcements': 'announcements', // Nuevo mapeo
            };
            const sectionName = sectionMap[target.id];
            if (sectionName) {
                loadSection(sectionName);
            }
        }
    });

    // --- Manejo del Logout ---
    const handleAdminLogout = async () => {
        try {
            if (auth.currentUser) {
                await firebaseSignOut(auth);
                console.log("Admin.js: Sesión cerrada exitosamente.");
                window.location.href = 'login.html';
            }
        } catch (error) {
            console.error("Admin.js: Error al cerrar sesión:", error);
            alert("Error al cerrar sesión. Por favor, inténtalo de nuevo.");
        }
    };

    initializeFirebaseAndAdmin(); // Inicia la inicialización de Firebase y la carga de datos del admin
});
