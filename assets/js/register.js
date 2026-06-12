import { auth, db, dbPath } from './firebase.js';
import { onAuthStateChanged, createUserWithEmailAndPassword, sendEmailVerification, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const registerForm    = document.getElementById('register-form');
    const fullNameInput   = document.getElementById('registerFullName');
    const emailInput      = document.getElementById('registerEmail');
    const passwordInput   = document.getElementById('registerPassword');
    const registerMessage = document.getElementById('register-message');

    const showMessage = (msg, type) => {
        registerMessage.textContent = msg;
        registerMessage.className   = `message ${type}`;
    };

    // Redirige si ya hay sesión activa
    onAuthStateChanged(auth, async (user) => {
        if (user && !user.isAnonymous) {
            showMessage('Sesión activa. Redirigiendo…', 'loading');
            try {
                const snap = await getDoc(doc(db, dbPath(`user_roles/${user.uid}`)));
                if (snap.exists()) {
                    const role = snap.data().role;
                    if (role === 'admin')   { window.location.href = '/admin';            return; }
                    if (role === 'student') { window.location.href = '/panel-estudiante'; return; }
                }
            } catch { /* silencioso */ }
            await signOut(auth);
        } else {
            showMessage('', '');
        }
    });

    registerForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullName = fullNameInput.value.trim();
        const email    = emailInput.value.trim();
        const password = passwordInput.value;

        if (password.length < 6) {
            showMessage('La contraseña debe tener al menos 6 caracteres.', 'error');
            return;
        }

        showMessage('Creando cuenta…', 'loading');

        try {
            const { user } = await createUserWithEmailAndPassword(auth, email, password);

            await setDoc(doc(db, dbPath(`user_roles/${user.uid}`)), {
                role:      'student',
                email,
                fullName,
                createdAt: new Date()
            });

            // Enviar correo de verificación (no bloquea el registro si falla)
            try { await sendEmailVerification(user); } catch (err) { console.warn('No se pudo enviar la verificación:', err); }

            showMessage('¡Cuenta creada! Te enviamos un correo de verificación: revísalo (y la carpeta de spam) para confirmar tu cuenta. Redirigiendo…', 'success');
            setTimeout(() => window.location.href = '/panel-estudiante', 2500);

        } catch (error) {
            const msgs = {
                'auth/email-already-in-use': 'Este correo ya está registrado. Inicia sesión.',
                'auth/invalid-email':        'El formato del correo es inválido.',
                'auth/weak-password':        'La contraseña es demasiado débil (mín. 6 caracteres).'
            };
            showMessage(msgs[error.code] || 'Error al crear la cuenta. Inténtalo de nuevo.', 'error');
        }
    });
});
