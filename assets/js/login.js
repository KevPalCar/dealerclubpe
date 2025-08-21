document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const loginEmailInput = document.getElementById('loginEmail');
    const loginPasswordInput = document.getElementById('loginPassword');
    const loginMessage = document.getElementById('login-message');

    // Variables de Firebase (se espera que estén exportadas globalmente desde el HTML)
    let auth;
    let signInWithEmailAndPassword;

    // Función para inicializar Firebase (espera a que el script module en HTML se cargue)
    const initializeFirebase = async () => {
        if (window.firebaseAuth && window.firebaseSignInWithEmailAndPassword) {
            auth = window.firebaseAuth;
            signInWithEmailAndPassword = window.firebaseSignInWithEmailAndPassword;
            console.log("Firebase SDK para login inicializado.");
        } else {
            console.error("Firebase SDK global variables not found for login.js. Retrying in 100ms...");
            setTimeout(initializeFirebase, 100);
        }
    };

    initializeFirebase();

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = loginEmailInput.value;
        const password = loginPasswordInput.value;

        loginMessage.textContent = 'Iniciando sesión...';
        loginMessage.className = 'message loading';

        try {
            // Iniciar sesión con Firebase Authentication
            await signInWithEmailAndPassword(auth, email, password);

            loginMessage.textContent = '¡Inicio de sesión exitoso! Redirigiendo al dashboard...';
            loginMessage.className = 'message success';
            loginForm.reset();

            // Redirigir al usuario al dashboard de estudiante
            setTimeout(() => {
                window.location.href = 'student_dashboard.html';
            }, 2000);

        } catch (error) {
            console.error("Error al iniciar sesión:", error);
            let errorMessage = 'Error al iniciar sesión. Por favor, inténtalo de nuevo.';
            if (error.code === 'auth/invalid-email') {
                errorMessage = 'El correo electrónico es inválido.';
            } else if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                errorMessage = 'Correo electrónico o contraseña incorrectos.';
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = 'Demasiados intentos fallidos. Inténtalo de nuevo más tarde.';
            }
            loginMessage.textContent = errorMessage;
            loginMessage.className = 'message error';
        }
    });
});
