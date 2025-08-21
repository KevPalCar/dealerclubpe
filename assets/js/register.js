document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('register-form');
    const registerEmailInput = document.getElementById('registerEmail');
    const registerPasswordInput = document.getElementById('registerPassword');
    const registerFullNameInput = document.getElementById('registerFullName');
    const registerMessage = document.getElementById('register-message');

    // Variables de Firebase (se espera que estén exportadas globalmente desde el HTML)
    let auth;
    let createUserWithEmailAndPassword;
    let db;
    let collection;
    let docRef;
    let setDoc;
    let appId;

    // Función para inicializar Firebase (espera a que el script module en HTML se cargue)
    const initializeFirebase = async () => {
        if (window.firebaseAuth && window.firebaseCreateUserWithEmailAndPassword && 
            window.firebaseDb && window.firebaseCollection && window.firebaseDoc && window.firebaseSetDoc && window.appId) {
            
            auth = window.firebaseAuth;
            createUserWithEmailAndPassword = window.firebaseCreateUserWithEmailAndPassword;
            db = window.firebaseDb;
            collection = window.firebaseCollection;
            docRef = window.firebaseDoc;
            setDoc = window.firebaseSetDoc;
            appId = window.appId;
            console.log("Firebase SDK para registro inicializado.");
        } else {
            console.error("Firebase SDK global variables not found for register.js. Retrying in 100ms...");
            setTimeout(initializeFirebase, 100);
        }
    };

    initializeFirebase();

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = registerEmailInput.value;
        const password = registerPasswordInput.value;
        const fullName = registerFullNameInput.value;

        // Validaciones básicas (puedes añadir más)
        if (password.length < 6) {
            registerMessage.textContent = 'La contraseña debe tener al menos 6 caracteres.';
            registerMessage.className = 'message error';
            return;
        }

        registerMessage.textContent = 'Creando cuenta...';
        registerMessage.className = 'message loading';

        try {
            // 1. Crear usuario en Firebase Authentication
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            console.log("Usuario de Firebase Auth creado:", user.uid);

            // 2. Guardar datos adicionales del usuario en Firestore
            // Path: /artifacts/{appId}/users/{userId}
            const userDocRef = docRef(db, `artifacts/${appId}/users`, user.uid);
            await setDoc(userDocRef, {
                email: email,
                fullName: fullName,
                isStudent: true, // Marcar como estudiante por defecto
                registeredAt: new Date()
            });
            console.log("Perfil de usuario guardado en Firestore para:", user.uid);

            registerMessage.textContent = '¡Cuenta creada con éxito! Redirigiendo al inicio de sesión...';
            registerMessage.className = 'message success';
            registerForm.reset();

            // Redirigir al usuario a la página de login
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 2000);

        } catch (error) {
            console.error("Error al registrar el usuario:", error);
            let errorMessage = 'Error al crear la cuenta. Por favor, inténtalo de nuevo.';
            if (error.code === 'auth/email-already-in-use') {
                errorMessage = 'El correo electrónico ya está registrado. Intenta iniciar sesión.';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'El formato del correo electrónico es inválido.';
            } else if (error.code === 'auth/weak-password') {
                errorMessage = 'La contraseña es demasiado débil. Usa una más fuerte.';
            }
            registerMessage.textContent = errorMessage;
            registerMessage.className = 'message error';
        }
    });
});
