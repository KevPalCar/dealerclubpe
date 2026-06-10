import { auth, db, dbPath } from './firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {

    // ── ANNOUNCE BAR ─────────────────────────────────────────
    const announceBar  = document.getElementById('announce-bar');
    const announceText = document.getElementById('announce-text');
    const closeBtn     = document.getElementById('close-announce-bar');

    if (announceBar) {
        onSnapshot(doc(db, dbPath('config/announceBar')), (snap) => {
            if (snap.exists() && snap.data().login?.trim()) {
                announceText.textContent = snap.data().login;
                announceBar.style.display = 'flex';
            } else {
                announceBar.style.display = 'none';
            }
        }, () => { announceBar.style.display = 'none'; });
        closeBtn?.addEventListener('click', () => announceBar.style.display = 'none');
    }

    // ── REFERENCIAS DOM ───────────────────────────────────────
    const loginForm            = document.getElementById('login-form');
    const loginEmailInput      = document.getElementById('loginEmail');
    const loginPasswordInput   = document.getElementById('loginPassword');
    const loginMessage         = document.getElementById('login-message');
    const forgotPasswordLink   = document.getElementById('forgot-password-link');
    const resetPasswordModal   = document.getElementById('resetPasswordModal');
    const closeResetModalBtn   = document.getElementById('closeResetPasswordModalBtn');
    const resetPasswordForm    = document.getElementById('reset-password-form');
    const resetEmailInput      = document.getElementById('resetEmail');
    const resetMessage         = document.getElementById('reset-message');

    const showMessage = (el, msg, type) => {
        el.textContent = msg;
        el.className   = `message ${type}`;
    };
    const openModal  = (m) => { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; };
    const closeModal = (m) => { m.style.display = 'none'; document.body.style.overflow = 'auto'; };

    // ── REDIRECCIÓN SI YA HAY SESIÓN ──────────────────────────
    onAuthStateChanged(auth, async (user) => {
        if (user && !user.isAnonymous) {
            showMessage(loginMessage, 'Sesión activa. Redirigiendo…', 'loading');
            try {
                const snap = await getDoc(doc(db, dbPath(`user_roles/${user.uid}`)));
                if (snap.exists()) {
                    const role = snap.data().role;
                    if (role === 'admin')   { window.location.href = 'admin.html';            return; }
                    if (role === 'student') { window.location.href = 'student_dashboard.html'; return; }
                }
                await signOut(auth);
                showMessage(loginMessage, 'Rol de usuario no reconocido.', 'error');
            } catch {
                await signOut(auth);
                showMessage(loginMessage, 'Error de autenticación.', 'error');
            }
        } else {
            showMessage(loginMessage, '', '');
        }
    });

    // ── FORMULARIO LOGIN ──────────────────────────────────────
    loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        showMessage(loginMessage, 'Iniciando sesión…', 'loading');
        try {
            const { user } = await signInWithEmailAndPassword(auth, loginEmailInput.value, loginPasswordInput.value);
            const snap = await getDoc(doc(db, dbPath(`user_roles/${user.uid}`)));
            if (snap.exists()) {
                const role = snap.data().role;
                if (role === 'admin')   { showMessage(loginMessage, 'Redirigiendo al panel…', 'success');     window.location.href = 'admin.html';            return; }
                if (role === 'student') { showMessage(loginMessage, 'Redirigiendo al campus…', 'success');    window.location.href = 'student_dashboard.html'; return; }
            }
            await signOut(auth);
            showMessage(loginMessage, 'Rol de usuario no reconocido.', 'error');
        } catch (error) {
            const msgs = {
                'auth/user-not-found':     'Correo o contraseña incorrectos.',
                'auth/wrong-password':     'Correo o contraseña incorrectos.',
                'auth/invalid-credential': 'Correo o contraseña incorrectos.',
                'auth/too-many-requests':  'Demasiados intentos. Inténtalo más tarde.'
            };
            showMessage(loginMessage, msgs[error.code] || 'Error al iniciar sesión.', 'error');
        }
    });

    // ── RECUPERAR CONTRASEÑA ──────────────────────────────────
    forgotPasswordLink?.addEventListener('click', (e) => {
        e.preventDefault();
        resetEmailInput.value = '';
        showMessage(resetMessage, '', '');
        openModal(resetPasswordModal);
    });

    resetPasswordForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        showMessage(resetMessage, 'Enviando enlace…', 'loading');
        try {
            await sendPasswordResetEmail(auth, resetEmailInput.value);
            showMessage(resetMessage, `Enlace enviado a ${resetEmailInput.value}. Revisa tu correo.`, 'success');
            setTimeout(() => closeModal(resetPasswordModal), 3000);
        } catch {
            showMessage(resetMessage, 'Error al enviar el enlace. Verifica el correo.', 'error');
        }
    });

    closeResetModalBtn?.addEventListener('click', () => closeModal(resetPasswordModal));
    window.addEventListener('click', (e) => {
        if (e.target === resetPasswordModal) closeModal(resetPasswordModal);
    });
});
