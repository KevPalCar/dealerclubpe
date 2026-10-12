import { auth, db, dbPath } from './firebase.js';
import { onAuthStateChanged, createUserWithEmailAndPassword, sendEmailVerification, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const registerForm    = document.getElementById('register-form');
    const fullNameInput   = document.getElementById('registerFullName');
    const emailInput      = document.getElementById('registerEmail');
    const passwordInput   = document.getElementById('registerPassword');
    const phoneInput      = document.getElementById('registerPhone');
    const registerMessage = document.getElementById('register-message');
    // Mientras se crea la cuenta, la sesión nueva no debe disparar la redirección
    // de abajo: tras registrarse, el alumno se queda en el "último paso".
    let registering = false;

    // Número de WhatsApp de la empresa (editable en el admin, Configuración)
    let waNumber = '51929610747';
    getDoc(doc(db, dbPath('config/announceBar')))
        .then(snap => { const n = (snap.data()?.whatsapp || '').replace(/\D/g, ''); if (n) waNumber = n; })
        .catch(() => { /* se queda el número por defecto */ });

    const showMessage = (msg, type) => {
        registerMessage.textContent = msg;
        registerMessage.className   = `message ${type}`;
    };

    // Redirige si ya hay sesión activa
    onAuthStateChanged(auth, async (user) => {
        if (registering) return;
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
        const phone    = phoneInput.value.replace(/\D/g, '');

        if (password.length < 6) {
            showMessage('La contraseña debe tener al menos 6 caracteres.', 'error');
            return;
        }

        showMessage('Creando cuenta…', 'loading');
        registering = true;

        try {
            const { user } = await createUserWithEmailAndPassword(auth, email, password);

            await setDoc(doc(db, dbPath(`user_roles/${user.uid}`)), {
                role:        'student',
                status:      'pending',
                email:       user.email,
                fullName,
                ...(phone ? { phone } : {}),
                createdAt:   new Date()
            });

            // Enviar correo de verificación (no bloquea el registro si falla)
            try { await sendEmailVerification(user); } catch (err) { console.warn('No se pudo enviar la verificación:', err); }

            // Último paso: que el alumno nos escriba por WhatsApp. Al abrir él la
            // conversación, el bot lo atiende y podemos responderle sin costo.
            const text = `Hola DealerClub, soy ${fullName}. Me registré en el campus y quiero información para inscribirme.`;
            document.getElementById('register-wa-btn').href = `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`;
            document.getElementById('register-done-name').textContent = fullName.split(' ')[0];
            registerForm.style.display = 'none';
            document.getElementById('register-done').style.display = 'flex';

        } catch (error) {
            registering = false;
            const msgs = {
                'auth/email-already-in-use': 'Este correo ya está registrado. Inicia sesión.',
                'auth/invalid-email':        'El formato del correo es inválido.',
                'auth/weak-password':        'La contraseña es demasiado débil (mín. 6 caracteres).'
            };
            showMessage(msgs[error.code] || 'Error al crear la cuenta. Inténtalo de nuevo.', 'error');
        }
    });
});
