// Importamos todas las herramientas necesarias, incluyendo las nuevas para el AnnounceBar (doc, getDoc, onSnapshot)
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Tu configuración de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyA3YsyUDmLeAvvgWwvCnjeJt-HbGGk--PY",
    authDomain: "dealerclubpe.firebaseapp.com",
    projectId: "dealerclubpe",
    storageBucket: "dealerclubpe.firebasestorage.app",
    messagingSenderId: "330568352415",
    appId: "1:330568352415:web:9fcd7651698bfafac998aa"
};

// Inicialización segura (evita el error de "App already exists")
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'default-app-id'; // Mantenemos tu bóveda original para que carguen los profes

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Lógica Inteligente del Header (Mi Cuenta / Admin)
    const studentAccessLink = document.getElementById('student-access-link');
    if (studentAccessLink) {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                const userRoleRef = doc(db, `/artifacts/${appId}/public/data/user_roles/${user.uid}`);
                try {
                    const userRoleSnap = await getDoc(userRoleRef);
                    if (userRoleSnap.exists() && userRoleSnap.data().role === 'admin') {
                        studentAccessLink.textContent = 'Panel Admin';
                        studentAccessLink.href = 'admin.html';
                    } else {
                        studentAccessLink.textContent = 'Mi Dashboard';
                        studentAccessLink.href = 'student_dashboard.html';
                    }
                } catch (e) {
                    studentAccessLink.textContent = 'Mi Dashboard';
                    studentAccessLink.href = 'student_dashboard.html';
                }
            } else {
                studentAccessLink.textContent = 'Iniciar Sesión';
                studentAccessLink.href = 'login.html';
            }
        });
    }

    // 2. Lógica de la Barra de Anuncios (Announce Bar) - 🔥 PERSONALIZADO PARA 'NOSOTROS'
    const announceBar = document.getElementById('announce-bar');
    const announceTextElement = document.getElementById('announce-text');
    const closeAnnounceBarBtn = document.getElementById('close-announce-bar');

    if (announceBar && db) {
        const announceDocRef = doc(db, `/artifacts/${appId}/public/data/config/announceBar`);
        onSnapshot(announceDocRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                const data = docSnapshot.data();
                // Aquí le indicamos que busque el campo específico de 'nosotros'
                const mensajeNosotros = data.nosotros;

                if (data.status === 'active' && mensajeNosotros) {
                    announceTextElement.textContent = mensajeNosotros;
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

    // 3. Carga dinámica de Profesores desde la Base de Datos
    const gridContainer = document.getElementById('professors-grid-container');
    const loadProfessors = async () => {
        try {
            const profCollection = collection(db, `/artifacts/${appId}/public/data/professors`);
            const profSnapshot = await getDocs(profCollection);

            gridContainer.innerHTML = ''; 

            if (profSnapshot.empty) {
                gridContainer.innerHTML = '<p style="text-align:center; width:100%; color:#ccc;">Próximamente conocerás a nuestro equipo docente.</p>';
                return;
            }

            const profs = profSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            profs.sort((a, b) => (a.order || 99) - (b.order || 99));

            profs.forEach(p => {
                const card = document.createElement('div');
                card.className = 'profesor-card'; 
                
                const imgUrl = p.imageUrl || 'https://placehold.co/400x400/333333/ffffff?text=Top';

                card.innerHTML = `
                    <img src="${imgUrl}" alt="${p.name}" class="circular-img" onerror="this.onerror=null;this.src='https://placehold.co/400x400/333333/ffffff?text=Foto';">
                    <h3>${p.name}</h3>
                    <p>Especialidad: ${p.specialty}</p>
                    <p class="profesor-bio">${p.bio}</p>
                `;
                gridContainer.appendChild(card);
            });

        } catch (error) {
            console.error("Error cargando profesores:", error);
            gridContainer.innerHTML = '<p style="text-align:center; width:100%; color:#dc3545;">Error al cargar el equipo docente.</p>';
        }
    };

    // 4. Carga dinámica de Egresados desde la Base de Datos
    const gridAlumniContainer = document.getElementById('alumni-grid-container');
    const loadAlumni = async () => {
        try {
            const alumniCollection = collection(db, `/artifacts/${appId}/public/data/alumni`);
            const alumniSnapshot = await getDocs(alumniCollection);

            gridAlumniContainer.innerHTML = ''; 

            if (alumniSnapshot.empty) {
                gridAlumniContainer.innerHTML = '<p style="text-align:center; width:100%; color:#ccc;">Muy pronto conocerás las historias de éxito de nuestros egresados.</p>';
                return;
            }

            const alumni = alumniSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            alumni.sort((a, b) => (a.order || 99) - (b.order || 99));

            alumni.forEach(a => {
                const card = document.createElement('div');
                card.className = 'alumno-card';
                
                const imgUrl = a.imageUrl || 'https://placehold.co/400x400/333333/ffffff?text=Foto';

                card.innerHTML = `
                    <img src="${imgUrl}" alt="${a.name}" class="circular-img" onerror="this.onerror=null;this.src='https://placehold.co/400x400/333333/ffffff?text=Foto';">
                    <h3>${a.name}</h3>
                    <p class="alumno-info">${a.info}</p>
                    <p class="alumno-testimonio">"${a.testimonial}"</p>
                `;
                gridAlumniContainer.appendChild(card);
            });

        } catch (error) {
            console.error("Error cargando egresados:", error);
            gridAlumniContainer.innerHTML = '<p style="text-align:center; width:100%; color:#dc3545;">Error al cargar los egresados.</p>';
        }
    };

    // Ejecutamos ambas funciones
    loadProfessors();
    loadAlumni();
});