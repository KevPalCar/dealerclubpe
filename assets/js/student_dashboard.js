document.addEventListener('DOMContentLoaded', () => {
    const welcomeMessage = document.getElementById('welcome-message');
    const authStatusMessage = document.getElementById('auth-status-message');
    const logoutBtn = document.getElementById('logout-btn');
    const enrolledCoursesList = document.getElementById('enrolled-courses-list');
    const loadingEnrolledCourses = document.getElementById('loading-enrolled-courses');
    const noEnrolledCourses = document.getElementById('no-enrolled-courses');

    // Variables de Firebase
    let auth;
    let onAuthStateChanged;
    let signOut;
    let db;
    let docRef;
    let getDoc;
    let collection;
    let queryFn;
    let whereFn;
    let getDocs;
    let appId;

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
            console.log("Firebase SDK para dashboard inicializado.");

            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    // 1. Verificar si es usuario anónimo (invitado)
                    if (user.isAnonymous) {
                        console.warn("Acceso denegado: Usuario anónimo intentando acceder al dashboard.");
                        await signOut(auth); // Cerrar la sesión anónima
                        window.location.href = 'login.html';
                        return;
                    }

                    // Usuario está logueado y no es anónimo
                    authStatusMessage.textContent = `Sesión iniciada como: ${user.email}`;
                    authStatusMessage.className = 'message success';

                    // Cargar nombre completo del usuario desde Firestore
                    const userDocRef = docRef(db, `artifacts/${appId}/users`, user.uid);
                    try {
                        const userDocSnap = await getDoc(userDocRef);
                        if (userDocSnap.exists()) {
                            const userData = userDocSnap.data();
                            welcomeMessage.textContent = `¡Bienvenido/a, ${userData.fullName || user.email}!`;
                            // Cargar cursos inscritos por el usuario
                            fetchEnrolledCourses(user.uid);
                        } else {
                            // 2. Verificar si el perfil existe en la base de datos
                            console.warn("Perfil de usuario no encontrado en Firestore para UID:", user.uid);
                            alert("Error: No se encontró tu perfil de estudiante. Contacta al soporte.");
                            await signOut(auth);
                            window.location.href = 'login.html';
                        }
                    } catch (error) {
                        console.error("Error al verificar perfil:", error);
                        authStatusMessage.textContent = 'Error de conexión. Inténtalo de nuevo.';
                    }

                } else {
                    // Usuario NO está logueado
                    console.log("Usuario no autenticado, redirigiendo a login.");
                    authStatusMessage.textContent = 'No has iniciado sesión. Redirigiendo...';
                    authStatusMessage.className = 'message error';
                    setTimeout(() => {
                        window.location.href = 'login.html'; // Redirigir a la página de login
                    }, 2000);
                }
            });
        } else {
            console.error("Firebase SDK global variables not found for student_dashboard.js. Retrying in 100ms...");
            setTimeout(initializeFirebaseAndAuth, 100);
        }
    };

    // Función para cargar los cursos en los que el usuario está inscrito
    const fetchEnrolledCourses = async (userId) => {
        loadingEnrolledCourses.style.display = 'block'; // Muestra el mensaje de carga
        enrolledCoursesList.innerHTML = ''; // Limpia la lista de cursos inscritos
        noEnrolledCourses.style.display = 'none'; // Oculta el mensaje de "no cursos"

        try {
            // Ruta a la colección de inscripciones de cursos
            const enrollmentsColRef = collection(db, `artifacts/${appId}/public/data/course_enrollments`);

            // Crear una consulta para filtrar las inscripciones por el ID de usuario
            const q = queryFn(enrollmentsColRef, whereFn("enrolledByUid", "==", userId));

            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                loadingEnrolledCourses.style.display = 'none';
                noEnrolledCourses.style.display = 'block'; // Muestra el mensaje de "no cursos"
                return;
            }

            loadingEnrolledCourses.style.display = 'none'; // Oculta el mensaje de carga

            querySnapshot.forEach(doc => {
                const enrollment = doc.data();
                const courseItem = document.createElement('div');
                courseItem.className = 'enrolled-course-item'; // Clase para estilizar cada curso inscrito

                // Formatear la fecha si existe
                const timestamp = enrollment.timestamp;
                const formattedDate = timestamp && timestamp.toDate ? timestamp.toDate().toLocaleDateString('es-ES', {
                    year: 'numeric', month: 'long', day: 'numeric'
                }) : 'N/A';

                courseItem.innerHTML = `
                    <h4>${enrollment.courseName || 'Curso Desconocido'}</h4>
                    <p><strong>Estado:</strong> <span style="color: ${enrollment.status === 'approved' ? '#28a745' : enrollment.status === 'rejected' ? '#dc3545' : '#ffc107'};">${enrollment.status ? enrollment.status.charAt(0).toUpperCase() + enrollment.status.slice(1) : 'Pendiente'}</span></p>
                    <p><strong>Solicitado el:</strong> ${formattedDate}</p>
                    ${enrollment.comments ? `<p><strong>Comentarios:</strong> ${enrollment.comments}</p>` : ''}
                `;
                enrolledCoursesList.appendChild(courseItem);
            });

        } catch (error) {
            console.error("Error al cargar cursos inscritos:", error);
            loadingEnrolledCourses.textContent = 'Error al cargar tus cursos inscritos.';
            loadingEnrolledCourses.className = 'message error';
            noEnrolledCourses.style.display = 'none'; // Asegura que este mensaje no se muestre en caso de error
        }
    };

    // Manejo del botón de cerrar sesión
    logoutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
            console.log("Sesión cerrada.");
            window.location.href = 'login.html'; // Redirigir al login después de cerrar sesión
        } catch (error) {
            console.error("Error al cerrar sesión:", error);
            authStatusMessage.textContent = 'Error al cerrar sesión. Inténtelo de nuevo.';
            authStatusMessage.className = 'message error';
        }
    });

    initializeFirebaseAndAuth();
});
