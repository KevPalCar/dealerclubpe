import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Configuración de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyA3YsyUDmLeAvvgWwvCnjeJt-HbGGk--PY", 
    authDomain: "dealerclubpe.firebaseapp.com",
    projectId: "dealerclubpe",
    storageBucket: "dealerclubpe.firebasestorage.app",
    messagingSenderId: "330568352415",
    appId: "1:330568352415:web:9fcd7651698bfafac998aa"
};

// Inicialización segura
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'default-app-id'; 

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Lógica de la Barra de Anuncios (Announce Bar) ---
    const announceBar = document.getElementById('announce-bar');
    const announceTextElement = document.getElementById('announce-text');
    const closeAnnounceBarBtn = document.getElementById('close-announce-bar');

    if (announceBar && db) {
        const announceDocRef = doc(db, `/artifacts/${appId}/public/data/config/announceBar`);
        onSnapshot(announceDocRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                const data = docSnapshot.data();
                // 🔥 EL CAMBIO ESTÁ AQUÍ: Ahora busca específicamente data.login
                if (data.status === 'active' && data.login && data.login.trim() !== '') {
                    announceTextElement.textContent = data.login;
                    announceBar.style.display = 'flex';
                } else {
                    announceBar.style.display = 'none';
                }
            } else {
                announceBar.style.display = 'none';
            }
        }, (error) => {
            console.error("Error cargando AnnounceBar:", error);
            announceBar.style.display = 'none';
        });

        if (closeAnnounceBarBtn) {
            closeAnnounceBarBtn.addEventListener('click', () => {
                announceBar.style.display = 'none';
            });
        }
    }

    // --- 2. Variables del DOM para el Login y Reset ---
    const loginForm = document.getElementById('login-form');
    const loginEmailInput = document.getElementById('loginEmail');
    const loginPasswordInput = document.getElementById('loginPassword');
    const loginMessage = document.getElementById('login-message');
    const forgotPasswordLink = document.getElementById('forgot-password-link');

    const resetPasswordModal = document.getElementById('resetPasswordModal');
    const closeResetPasswordModalBtn = document.getElementById('closeResetPasswordModalBtn');
    const resetPasswordForm = document.getElementById('reset-password-form');
    const resetEmailInput = document.getElementById('resetEmail');
    const resetMessage = document.getElementById('reset-message');

    const showMessage = (element, message, type) => {
        element.textContent = message;
        element.className = `message ${type}`; 
    };

    const openModal = (modalElement) => {
        modalElement.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    const closeModal = (modalElement) => {
        modalElement.style.display = 'none';
        document.body.style.overflow = 'auto';
    };

    // --- 3. Verificación de sesión activa (Auto-Redirección) ---
    onAuthStateChanged(auth, async (user) => {
        if (user && !user.isAnonymous) {
            showMessage(loginMessage, 'Sesión activa. Redirigiendo...', 'loading');
            const userRoleRef = doc(db, `/artifacts/${appId}/public/data/user_roles/${user.uid}`);
            try {
                const userRoleSnap = await getDoc(userRoleRef);
                if (userRoleSnap.exists()) {
                    const role = userRoleSnap.data().role;
                    if (role === 'admin') {
                        window.location.href = 'admin.html';
                    } else if (role === 'student') {
                        window.location.href = 'student_dashboard.html';
                    } else {
                        await signOut(auth);
                        showMessage(loginMessage, 'Rol de usuario desconocido.', 'error');
                    }
                } else {
                    await signOut(auth);
                    showMessage(loginMessage, 'No se pudo verificar tu rol.', 'error');
                }
            } catch (error) {
                await signOut(auth);
                showMessage(loginMessage, `Error de autenticación.`, 'error');
            }
        } else {
            showMessage(loginMessage, '', ''); 
        }
    });

    // --- 4. Manejo del Formulario de Inicio de Sesión ---
    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const email = loginEmailInput.value;
            const password = loginPasswordInput.value;
            showMessage(loginMessage, 'Iniciando sesión...', 'loading');

            try {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                const userRoleRef = doc(db, `/artifacts/${appId}/public/data/user_roles/${user.uid}`);
                const userRoleSnap = await getDoc(userRoleRef);

                if (userRoleSnap.exists()) {
                    const role = userRoleSnap.data().role;
                    if (role === 'admin') {
                        showMessage(loginMessage, 'Redirigiendo al panel...', 'success');
                        window.location.href = 'admin.html';
                    } else if (role === 'student') {
                        showMessage(loginMessage, 'Redirigiendo al dashboard...', 'success');
                        window.location.href = 'student_dashboard.html';
                    } else {
                        await signOut(auth);
                        showMessage(loginMessage, 'Rol de usuario desconocido.', 'error');
                    }
                } else {
                    await signOut(auth);
                    showMessage(loginMessage, 'No se pudo verificar tu rol.', 'error');
                }
            } catch (error) {
                let errorMessage = 'Error al iniciar sesión.';
                if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                    errorMessage = 'Correo o contraseña incorrectos.';
                } else if (error.code === 'auth/too-many-requests') {
                    errorMessage = 'Demasiados intentos fallidos. Inténtalo más tarde.';
                }
                showMessage(loginMessage, errorMessage, 'error');
            }
        });
    }

    // --- 5. Lógica del Modal "¿Olvidaste tu contraseña?" ---
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (event) => {
            event.preventDefault();
            resetEmailInput.value = ''; 
            showMessage(resetMessage, '', ''); 
            openModal(resetPasswordModal);
        });
    }

    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const email = resetEmailInput.value;
            showMessage(resetMessage, 'Enviando enlace...', 'loading');

            try {
                await sendPasswordResetEmail(auth, email);
                showMessage(resetMessage, `Enlace enviado a ${email}. Revisa tu correo.`, 'success');
                setTimeout(() => closeModal(resetPasswordModal), 3000); 
            } catch (error) {
                showMessage(resetMessage, 'Error al enviar el enlace.', 'error');
            }
        });
    }

    if (closeResetPasswordModalBtn) {
        closeResetPasswordModalBtn.addEventListener('click', () => closeModal(resetPasswordModal));
    }
    
    window.addEventListener('click', (event) => {
        if (event.target === resetPasswordModal) closeModal(resetPasswordModal);
    });
});