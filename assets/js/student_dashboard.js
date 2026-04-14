document.addEventListener('DOMContentLoaded', () => {
    const welcomeMessage = document.getElementById('welcome-message');
    const authStatusMessage = document.getElementById('auth-status-message');
    const logoutBtn = document.getElementById('logout-btn');
    const enrolledCoursesList = document.getElementById('enrolled-courses-list');
    const loadingEnrolledCourses = document.getElementById('loading-enrolled-courses');
    const noEnrolledCourses = document.getElementById('no-enrolled-courses');

    // Variables de Firebase
    let auth, onAuthStateChanged, signOut, db, docRef, getDoc, collection, queryFn, whereFn, getDocs, appId;
    
    // Control de reintentos para evitar bucles infinitos
    let retryCount = 0;
    const MAX_RETRIES = 50; // 5 segundos máximo esperando a Firebase

    // Diccionario para traducir estados al español
    const statusConfig = {
        'approved': { text: 'Aprobado', color: '#28a745' },
        'rejected': { text: 'Rechazado', color: '#dc3545' },
        'pending': { text: 'Pendiente', color: '#ffc107' }
    };

    // Función para inicializar Firebase y verificar el estado de autenticación
    const initializeFirebaseAndAuth = async () => {
        if (window.firebaseAuth && window.firebaseOnAuthStateChanged && window.firebaseSignOut &&
            window.firebaseDb && window.firebaseDoc && window.firebaseGetDoc &&
            window.firebaseCollection && window.firebaseQuery && window.firebaseWhere && window.firebaseGetDocs &&
            window.appId) {
            
            auth = window.firebaseAuth;
            onAuthStateChanged = window.firebaseOnAuthStateChanged;
            signOut = window.firebaseSignOut;
            db = window.firebaseDb;
            docRef = window.firebaseDoc;
            getDoc = window.firebaseGetDoc;
            collection = window.firebaseCollection;
            queryFn = window.firebaseQuery;
            whereFn = window.firebaseWhere;
            getDocs = window.firebaseGetDocs;
            appId = window.appId;
            console.log("Firebase SDK para dashboard inicializado correctamente.");

            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    // Usuario logueado
                    authStatusMessage.textContent = `Sesión iniciada como: ${user.email}`;
                    authStatusMessage.className = 'message success';
                    
                    // Cargar perfil del usuario
                    try {
                        const userDocRef = docRef(db, `artifacts/${appId}/users`, user.uid);
                        const userDocSnap = await getDoc(userDocRef);
                        
                        if (userDocSnap.exists()) {
                            const userData = userDocSnap.data();
                            welcomeMessage.textContent = `¡Bienvenido/a, ${userData.fullName || user.email}!`;
                        } else {
                            welcomeMessage.textContent = `¡Bienvenido/a, ${user.email}!`;
                            console.warn("Perfil de usuario no encontrado en Firestore.");
                        }
                    } catch (error) {
                        console.error("Error obteniendo datos del usuario:", error);
                        welcomeMessage.textContent = `¡Bienvenido/a, ${user.email}!`;
                    }

                    // Cargar cursos
                    fetchEnrolledCourses(user.uid);

                } else {
                    // Usuario NO logueado
                    console.log("Usuario no autenticado, redirigiendo a login.");
                    authStatusMessage.textContent = 'No has iniciado sesión. Redirigiendo...';
                    authStatusMessage.className = 'message error';
                    setTimeout(() => {
                        window.location.href = 'login.html';
                    }, 2000);
                }
            });
        } else {
            retryCount++;
            if (retryCount <= MAX_RETRIES) {
                console.warn(`Esperando Firebase SDK... Intento ${retryCount}/${MAX_RETRIES}`);
                setTimeout(initializeFirebaseAndAuth, 100);
            } else {
                console.error("Error crítico: No se pudo cargar Firebase SDK después de varios intentos.");
                authStatusMessage.textContent = 'Error de conexión con el servidor. Recarga la página.';
                authStatusMessage.className = 'message error';
            }
        }
    };

    // Función para cargar los cursos en los que el usuario está inscrito
    const fetchEnrolledCourses = async (userId) => {
        loadingEnrolledCourses.style.display = 'block';
        enrolledCoursesList.innerHTML = '';
        noEnrolledCourses.style.display = 'none';

        try {
            const enrollmentsColRef = collection(db, `artifacts/${appId}/public/data/course_enrollments`);
            const q = queryFn(enrollmentsColRef, whereFn("enrolledByUid", "==", userId));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                loadingEnrolledCourses.style.display = 'none';
                noEnrolledCourses.style.display = 'block';
                return;
            }

            loadingEnrolledCourses.style.display = 'none';

            querySnapshot.forEach(doc => {
                const enrollment = doc.data();
                const courseItem = document.createElement('div');
                courseItem.className = 'enrolled-course-item'; 

                // Formateo seguro de fecha
                let formattedDate = 'N/A';
                if (enrollment.timestamp && typeof enrollment.timestamp.toDate === 'function') {
                    formattedDate = enrollment.timestamp.toDate().toLocaleDateString('es-ES', { 
                        year: 'numeric', month: 'long', day: 'numeric' 
                    });
                }

                // Obtener estado formateado (por defecto 'pending')
                const currentStatus = enrollment.status ? enrollment.status.toLowerCase() : 'pending';
                const statusInfo = statusConfig[currentStatus] || statusConfig['pending'];

                courseItem.innerHTML = `
                    <h4>${enrollment.courseName || 'Curso Desconocido'}</h4>
                    <p><strong>Estado:</strong> <span style="color: ${statusInfo.color}; font-weight: bold;">${statusInfo.text}</span></p>
                    <p><strong>Solicitado el:</strong> ${formattedDate}</p>
                    ${enrollment.comments ? `<p><strong>Comentarios:</strong> ${enrollment.comments}</p>` : ''}
                `;
                enrolledCoursesList.appendChild(courseItem);
            });

        } catch (error) {
            console.error("Error al cargar cursos inscritos:", error);
            loadingEnrolledCourses.textContent = 'Error al cargar tus cursos inscritos.';
            loadingEnrolledCourses.className = 'message error';
            noEnrolledCourses.style.display = 'none';
        }
    };

    // Manejo del botón de cerrar sesión
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
                console.log("Sesión cerrada.");
                window.location.href = 'login.html'; 
            } catch (error) {
                console.error("Error al cerrar sesión:", error);
                authStatusMessage.textContent = 'Error al cerrar sesión. Inténtelo de nuevo.';
                authStatusMessage.className = 'message error';
            }
        });
    }

    // Iniciar el proceso
    initializeFirebaseAndAuth();
});