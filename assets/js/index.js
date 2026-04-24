import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Estas variables se usarán para la inicialización y rutas de Firestore
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "AIzaSyA3YsyUDmLeAvvgWwvCnjeJt-HbGGk--PY",
    authDomain: "dealerclubpe.firebaseapp.com",
    projectId: "dealerclubpe",
    storageBucket: "dealerclubpe.firebasestorage.app",
    messagingSenderId: "330568352415",
    appId: "1:330568352415:web:9fcd7651698bfafac998aa",
    measurementId: "G-PF3W9NDSDP"
};

// Inicialización de Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. Lógica para el enlace del Dashboard en el HEADER
    // ==========================================
    const studentAccessLink = document.getElementById('student-access-link');
    onAuthStateChanged(auth, async (user) => {
        if (user && studentAccessLink) {
            const userRoleRef = doc(db, `/artifacts/${appId}/public/data/user_roles/${user.uid}`);
            try {
                const userRoleSnap = await getDoc(userRoleRef);
                if (userRoleSnap.exists()) {
                    const role = userRoleSnap.data().role;
                    if (role === 'admin') {
                        studentAccessLink.textContent = 'Panel Admin';
                        studentAccessLink.href = 'sections/admin.html';
                    } else if (role === 'student') {
                        studentAccessLink.textContent = 'Mi Dashboard';
                        studentAccessLink.href = 'sections/student_dashboard.html';
                    } else {
                        studentAccessLink.textContent = 'Iniciar Sesión';
                        studentAccessLink.href = 'sections/login.html';
                        console.warn("Index.html: Rol de usuario desconocido. Cerrando sesión.");
                        await signOut(auth);
                    }
                } else {
                    studentAccessLink.textContent = 'Iniciar Sesión';
                    studentAccessLink.href = 'sections/login.html';
                    console.warn("Index.html: Documento de rol no encontrado. Cerrando sesión.");
                    await signOut(auth);
                }
            } catch (error) {
                console.error("Index.html: Error al obtener el rol del usuario:", error);
                studentAccessLink.textContent = 'Iniciar Sesión';
                studentAccessLink.href = 'sections/login.html';
                await signOut(auth);
            }
        } else if (studentAccessLink) {
            studentAccessLink.textContent = 'Iniciar Sesión';
            studentAccessLink.href = 'sections/login.html';
        }
    });

    // ==========================================
    // 2. Nueva Lógica Dinámica para el Announce Bar
    // ==========================================
    const announceBar = document.getElementById('announce-bar');
    const announceTextElement = document.getElementById('announce-text');
    const closeAnnounceBarBtn = document.getElementById('close-announce-bar');
    
    // Leemos el identificador de la página desde el HTML
    const pageId = document.body.getAttribute('data-page');

    if (db && appId && pageId && announceBar && announceTextElement) {
        const announceDocRef = doc(db, `/artifacts/${appId}/public/data/config/announceBar`);

        onSnapshot(announceDocRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                const data = docSnapshot.data();
                const mensaje = data[pageId]; // Extrae "data.inicio" en este caso

                // Si existe un mensaje para esta página y no está en blanco
                if (mensaje && mensaje.trim() !== "") {
                    announceTextElement.textContent = mensaje;
                    announceBar.style.display = 'flex'; // Se muestra
                } else {
                    announceBar.style.display = 'none'; // Se oculta si no hay texto
                }
            } else {
                announceBar.style.display = 'none';
            }
        }, (error) => {
            console.error("Index.js: Error al escuchar el announce bar:", error);
            announceBar.style.display = 'none';
        });
    }

    if (closeAnnounceBarBtn) {
        closeAnnounceBarBtn.addEventListener('click', () => {
            announceBar.style.display = 'none';
        });
    }
});