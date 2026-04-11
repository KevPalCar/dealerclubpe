import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, setDoc, doc, updateDoc, deleteDoc, onSnapshot, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Configuración de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyA3YsyUDmLeAvvgWwvCnjeJt-HbGGk--PY", 
    authDomain: "dealerclubpe.firebaseapp.com",
    projectId: "dealerclubpe",
    storageBucket: "dealerclubpe.firebasestorage.app",
    messagingSenderId: "330568352415",
    appId: "1:330568352415:web:9fcd7651698bfafac998aa"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const appId = 'default-app-id'; 

document.addEventListener('DOMContentLoaded', () => {
    const adminUserInfo = document.getElementById('admin-user-info');
    const adminMainTitle = document.getElementById('admin-main-title');
    const sidebarNav = document.querySelector('.sidebar-nav ul');
    
    let unsubscribeListeners = {};

    // --- SEGURIDAD ESTRICTA (PUNTO 2) ---
    onAuthStateChanged(auth, async (user) => {
        if (user && !user.isAnonymous) {
            const userRoleRef = doc(db, `/artifacts/${appId}/public/data/user_roles/${user.uid}`);
            try {
                const userRoleSnap = await getDoc(userRoleRef);
                if (userRoleSnap.exists() && userRoleSnap.data().role === 'admin') {
                    adminUserInfo.innerHTML = `<span>Bienvenido, Admin</span><i class="fas fa-user-circle"></i>`;
                    loadSection('courses');
                } else {
                    await signOut(auth);
                    window.location.replace('login.html'); // Evita historial
                }
            } catch (error) {
                await signOut(auth);
                window.location.replace('login.html');
            }
        } else {
            window.location.replace('login.html'); // Si no hay sesión, expulsa sin dejar historial
        }
    });

    // --- UTILIDADES ---
    const openModal = (modal) => { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; };
    const closeModal = (modal) => { modal.style.display = 'none'; document.body.style.overflow = 'auto'; };
    const showMsg = (element, msg, type) => { element.textContent = msg; element.className = `form-message ${type}`; };

    // --- FUNCIÓN GENÉRICA PARA ELIMINAR ---
    let deleteCallback = null;
    const confirmationModal = document.getElementById('confirmationModal');
    
    const openConfirmationModal = (message, callback) => {
        document.getElementById('confirmationMessage').textContent = message;
        deleteCallback = callback;
        showMsg(document.getElementById('deleteFormMessage'), '', '');
        openModal(confirmationModal);
    };

    const deleteItem = async (collectionName, itemId) => {
        showMsg(document.getElementById('deleteFormMessage'), 'Eliminando...', 'loading');
        try {
            await deleteDoc(doc(db, `/artifacts/${appId}/public/data/${collectionName}/${itemId}`));
            showMsg(document.getElementById('deleteFormMessage'), 'Eliminado con éxito.', 'success');
            setTimeout(() => closeModal(confirmationModal), 1000);
        } catch (error) {
            showMsg(document.getElementById('deleteFormMessage'), `Error: ${error.message}`, 'error');
        }
    };

    document.getElementById('confirmActionBtn').addEventListener('click', () => { if (deleteCallback) deleteCallback(); });
    document.getElementById('cancelConfirmBtn').addEventListener('click', () => closeModal(confirmationModal));
    document.getElementById('closeConfirmationModalBtn').addEventListener('click', () => closeModal(confirmationModal));

    // --- NAVEGACIÓN ---
    const loadSection = (sectionName) => {
        Object.values(unsubscribeListeners).forEach(unsub => unsub());
        document.querySelectorAll('.admin-content .content-section').forEach(sec => sec.style.display = 'none');
        document.querySelectorAll('.sidebar-nav a').forEach(link => link.classList.remove('active'));

        const activeSection = document.getElementById(`${sectionName}-management`);
        const activeLink = document.getElementById(`nav-${sectionName}`);
        
        if (activeSection && activeLink) {
            activeSection.style.display = 'block';
            activeLink.classList.add('active');

            switch (sectionName) {
                case 'courses': adminMainTitle.textContent = 'Gestión de Cursos'; loadCourses(); break;
                case 'professors': adminMainTitle.textContent = 'Gestión de Profesores'; loadProfessors(); break; // PUNTO 3
                case 'alumni': adminMainTitle.textContent = 'Gestión de Egresados'; loadAlumni(); break;
                case 'dealers': adminMainTitle.textContent = 'Gestión de Dealers'; loadDealers(); break;
                case 'services': adminMainTitle.textContent = 'Gestión de Servicios'; loadServices(); break;
                case 'enrollments': adminMainTitle.textContent = 'Gestión de Inscripciones'; loadEnrollments(); break;
                case 'requests': adminMainTitle.textContent = 'Gestión de Solicitudes'; loadRequests(); break;
                case 'announcements': adminMainTitle.textContent = 'Gestión de Anuncios'; loadAnnouncements(); break;
            }
        }
    };

    sidebarNav.addEventListener('click', async (e) => {
        e.preventDefault();
        const target = e.target.closest('a');
        if (!target) return;

        if (target.id === 'admin-logout-btn') {
            await signOut(auth);
            window.location.replace('login.html'); // PUNTO 2: Destruye el historial al salir
            return;
        }
        loadSection(target.id.replace('nav-', ''));
    });

    // ==========================================
    // CRUD: INSCRIPCIONES Y SOLICITUDES (PUNTO 1)
    // ==========================================
    const loadEnrollments = () => {
        const tbody = document.getElementById('enrollments-table-body');
        unsubscribeListeners.enrollments = onSnapshot(collection(db, `/artifacts/${appId}/public/data/course_enrollments`), (snap) => {
            if (snap.empty) {
                // PUNTO 1: Mensaje limpio dentro de la tabla en lugar de div externo
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#ccc;">🎉 No hay inscripciones pendientes.</td></tr>`;
                return;
            }
            tbody.innerHTML = '';
            snap.docs.forEach(docSnap => {
                const e = docSnap.data();
                const tr = tbody.insertRow();
                tr.innerHTML = `
                    <td>${e.courseName || '-'}</td><td>${e.fullName || '-'}</td><td>${e.email || '-'}</td>
                    <td>${e.phone || '-'}</td><td>${e.comments || '-'}</td>
                    <td>${e.timestamp ? new Date(e.timestamp.seconds * 1000).toLocaleDateString() : '-'}</td>
                    <td><button class="btn btn-danger btn-delete" data-id="${docSnap.id}"><i class="fas fa-trash"></i></button></td>
                `;
            });
            tbody.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', (e) => {
                openConfirmationModal('¿Eliminar inscripción?', () => deleteItem('course_enrollments', e.target.closest('button').dataset.id));
            }));
        });
    };

    const loadRequests = () => {
        const tbody = document.getElementById('requests-table-body');
        unsubscribeListeners.requests = onSnapshot(collection(db, `/artifacts/${appId}/public/data/service_requests`), (snap) => {
            if (snap.empty) {
                // PUNTO 1: Mensaje limpio dentro de la tabla
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#ccc;">📬 No tienes solicitudes nuevas.</td></tr>`;
                return;
            }
            tbody.innerHTML = '';
            snap.docs.forEach(docSnap => {
                const r = docSnap.data();
                const tr = tbody.insertRow();
                tr.innerHTML = `
                    <td>${docSnap.id.substring(0,8)}</td><td>${r.fullName || '-'}</td><td>${r.email || '-'}</td>
                    <td>${r.eventType || r.subject || '-'}</td><td>${(r.details || r.message || '').substring(0,40)}...</td>
                    <td>${r.timestamp ? new Date(r.timestamp.seconds * 1000).toLocaleDateString() : '-'}</td>
                    <td><button class="btn btn-danger btn-delete" data-id="${docSnap.id}"><i class="fas fa-trash"></i></button></td>
                `;
            });
            tbody.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', (e) => {
                openConfirmationModal('¿Eliminar solicitud?', () => deleteItem('service_requests', e.target.closest('button').dataset.id));
            }));
        });
    };


    // ==========================================
    // CRUD NUEVO: PROFESORES (PUNTO 3)
    // ==========================================
    const loadProfessors = () => {
        const tbody = document.getElementById('professors-table-body');
        unsubscribeListeners.professors = onSnapshot(collection(db, `/artifacts/${appId}/public/data/professors`), (snap) => {
            if (snap.empty) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ccc;">No hay profesores registrados.</td></tr>`;
                return;
            }
            tbody.innerHTML = '';
            const profs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 99) - (b.order || 99));
            
            profs.forEach(p => {
                const tr = tbody.insertRow();
                tr.innerHTML = `
                    <td>${p.order || '-'}</td><td>${p.name}</td><td>${p.specialty}</td>
                    <td>${(p.bio || '').substring(0,40)}...</td>
                    <td>
                        <button class="btn btn-secondary btn-edit" data-id="${p.id}"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-danger btn-delete" data-id="${p.id}"><i class="fas fa-trash"></i></button>
                    </td>
                `;
            });

            tbody.querySelectorAll('.btn-edit').forEach(btn => btn.addEventListener('click', (e) => {
                const p = profs.find(x => x.id === e.target.closest('button').dataset.id);
                document.getElementById('professorId').value = p.id;
                document.getElementById('professorName').value = p.name || '';
                document.getElementById('professorOrder').value = p.order || 0;
                document.getElementById('professorSpecialty').value = p.specialty || '';
                document.getElementById('professorBio').value = p.bio || '';
                document.getElementById('professorImageUrl').value = p.imageUrl || '';
                document.getElementById('professor-modal-title-action').textContent = 'Editar';
                openModal(document.getElementById('professorModal'));
            }));

            tbody.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', (e) => {
                openConfirmationModal('¿Eliminar profesor?', () => deleteItem('professors', e.target.closest('button').dataset.id));
            }));
        });
    };

    document.getElementById('add-professor-btn').addEventListener('click', () => {
        document.getElementById('professorForm').reset();
        document.getElementById('professorId').value = '';
        document.getElementById('professor-modal-title-action').textContent = 'Añadir';
        openModal(document.getElementById('professorModal'));
    });

    document.getElementById('professorForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgBox = document.getElementById('professorFormMessage');
        showMsg(msgBox, 'Guardando...', 'loading');
        
        const id = document.getElementById('professorId').value;
        const data = {
            name: document.getElementById('professorName').value,
            order: parseInt(document.getElementById('professorOrder').value),
            specialty: document.getElementById('professorSpecialty').value,
            bio: document.getElementById('professorBio').value,
            imageUrl: document.getElementById('professorImageUrl').value,
            lastUpdated: new Date()
        };

        try {
            if (id) await updateDoc(doc(db, `/artifacts/${appId}/public/data/professors/${id}`), data);
            else await addDoc(collection(db, `/artifacts/${appId}/public/data/professors`), data);
            closeModal(document.getElementById('professorModal'));
            showMsg(msgBox, '', '');
        } catch (err) { showMsg(msgBox, "Error guardando", "error"); }
    });
    document.getElementById('closeProfessorModalBtn').addEventListener('click', () => closeModal(document.getElementById('professorModal')));

    // ==========================================
    // CRUD NUEVO: EGRESADOS
    // ==========================================
    const loadAlumni = () => {
        const tbody = document.getElementById('alumni-table-body');
        unsubscribeListeners.alumni = onSnapshot(collection(db, `/artifacts/${appId}/public/data/alumni`), (snap) => {
            if (snap.empty) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ccc;">No hay egresados registrados.</td></tr>`;
                return;
            }
            tbody.innerHTML = '';
            const alumni = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 99) - (b.order || 99));
            
            alumni.forEach(a => {
                const tr = tbody.insertRow();
                tr.innerHTML = `
                    <td>${a.order || '-'}</td><td>${a.name}</td><td>${a.info}</td>
                    <td>"${(a.testimonial || '').substring(0,40)}..."</td>
                    <td>
                        <button class="btn btn-secondary btn-edit" data-id="${a.id}"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-danger btn-delete" data-id="${a.id}"><i class="fas fa-trash"></i></button>
                    </td>
                `;
            });

            tbody.querySelectorAll('.btn-edit').forEach(btn => btn.addEventListener('click', (e) => {
                const a = alumni.find(x => x.id === e.target.closest('button').dataset.id);
                document.getElementById('alumniId').value = a.id;
                document.getElementById('alumniName').value = a.name || '';
                document.getElementById('alumniOrder').value = a.order || 0;
                document.getElementById('alumniInfo').value = a.info || '';
                document.getElementById('alumniTestimonial').value = a.testimonial || '';
                document.getElementById('alumniImageUrl').value = a.imageUrl || '';
                document.getElementById('alumni-modal-title-action').textContent = 'Editar';
                openModal(document.getElementById('alumniModal'));
            }));

            tbody.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', (e) => {
                openConfirmationModal('¿Eliminar egresado?', () => deleteItem('alumni', e.target.closest('button').dataset.id));
            }));
        });
    };

    document.getElementById('add-alumni-btn').addEventListener('click', () => {
        document.getElementById('alumniForm').reset();
        document.getElementById('alumniId').value = '';
        document.getElementById('alumni-modal-title-action').textContent = 'Añadir';
        openModal(document.getElementById('alumniModal'));
    });

    document.getElementById('alumniForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgBox = document.getElementById('alumniFormMessage');
        showMsg(msgBox, 'Guardando...', 'loading');
        
        const id = document.getElementById('alumniId').value;
        const data = {
            name: document.getElementById('alumniName').value,
            order: parseInt(document.getElementById('alumniOrder').value),
            info: document.getElementById('alumniInfo').value,
            testimonial: document.getElementById('alumniTestimonial').value,
            imageUrl: document.getElementById('alumniImageUrl').value,
            lastUpdated: new Date()
        };

        try {
            if (id) await updateDoc(doc(db, `/artifacts/${appId}/public/data/alumni/${id}`), data);
            else await addDoc(collection(db, `/artifacts/${appId}/public/data/alumni`), data);
            closeModal(document.getElementById('alumniModal'));
            showMsg(msgBox, '', '');
        } catch (err) { showMsg(msgBox, "Error guardando", "error"); }
    });
    document.getElementById('closeAlumniModalBtn').addEventListener('click', () => closeModal(document.getElementById('alumniModal')));

    // ==========================================
    // RESTO DE CRUDS (Cursos, Dealers, Servicios, Anuncios)
    // ==========================================
    
    // Cursos
    const loadCourses = () => {
        const tbody = document.getElementById('courses-table-body');
        unsubscribeListeners.courses = onSnapshot(collection(db, `/artifacts/${appId}/public/data/courses`), (snap) => {
            if (snap.empty) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No hay cursos.</td></tr>`; return; }
            tbody.innerHTML = '';
            const courses = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 99) - (b.order || 99));
            courses.forEach(c => {
                const tr = tbody.insertRow();
                tr.innerHTML = `
                    <td>${c.order || '-'}</td><td>${c.name}</td><td>${(c.description||'').substring(0,30)}...</td>
                    <td>${c.price}</td><td>${c.schedule}</td><td>${c.duration}</td>
                    <td>
                        <select class="status-select" data-id="${c.id}">
                            <option value="Abierto" ${c.status==='Abierto'?'selected':''}>Abierto</option>
                            <option value="En Progreso" ${c.status==='En Progreso'?'selected':''}>En Progreso</option>
                            <option value="Próximamente" ${c.status==='Próximamente'?'selected':''}>Próximamente</option>
                            <option value="Cerrado" ${c.status==='Cerrado'?'selected':''}>Cerrado</option>
                        </select>
                    </td>
                    <td>
                        <button class="btn btn-secondary btn-edit" data-id="${c.id}"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-danger btn-delete" data-id="${c.id}"><i class="fas fa-trash"></i></button>
                    </td>
                `;
            });
            tbody.querySelectorAll('.status-select').forEach(sel => sel.addEventListener('change', async (e) => {
                await updateDoc(doc(db, `/artifacts/${appId}/public/data/courses/${e.target.dataset.id}`), { status: e.target.value });
            }));
            tbody.querySelectorAll('.btn-edit').forEach(btn => btn.addEventListener('click', (e) => {
                const c = courses.find(x => x.id === e.target.closest('button').dataset.id);
                document.getElementById('courseId').value = c.id;
                document.getElementById('courseName').value = c.name;
                document.getElementById('courseOrder').value = c.order;
                document.getElementById('courseDescription').value = c.description;
                document.getElementById('coursePrice').value = c.price;
                document.getElementById('courseSchedule').value = c.schedule;
                document.getElementById('courseDuration').value = c.duration;
                document.getElementById('courseGames').value = (c.gamesIncluded || []).join(', ');
                document.getElementById('courseStatus').value = c.status;
                document.getElementById('modal-title-action').textContent = 'Editar';
                openModal(document.getElementById('courseModal'));
            }));
            tbody.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', (e) => {
                openConfirmationModal('¿Eliminar curso?', () => deleteItem('courses', e.target.closest('button').dataset.id));
            }));
        });
    };

    document.getElementById('add-course-btn').addEventListener('click', () => {
        document.getElementById('courseForm').reset();
        document.getElementById('courseId').value = '';
        document.getElementById('modal-title-action').textContent = 'Añadir';
        openModal(document.getElementById('courseModal'));
    });

    document.getElementById('courseForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('courseId').value;
        const data = {
            name: document.getElementById('courseName').value,
            order: parseInt(document.getElementById('courseOrder').value),
            description: document.getElementById('courseDescription').value,
            price: document.getElementById('coursePrice').value,
            schedule: document.getElementById('courseSchedule').value,
            duration: document.getElementById('courseDuration').value,
            gamesIncluded: document.getElementById('courseGames').value.split(',').map(g => g.trim()),
            status: document.getElementById('courseStatus').value,
            lastUpdated: new Date()
        };
        try {
            if (id) await updateDoc(doc(db, `/artifacts/${appId}/public/data/courses/${id}`), data);
            else await addDoc(collection(db, `/artifacts/${appId}/public/data/courses`), data);
            closeModal(document.getElementById('courseModal'));
        } catch (err) { alert("Error guardando curso"); }
    });
    document.getElementById('closeCourseModalBtn').addEventListener('click', () => closeModal(document.getElementById('courseModal')));


    // Dealers
    const loadDealers = () => {
        const tbody = document.getElementById('dealers-table-body');
        unsubscribeListeners.dealers = onSnapshot(collection(db, `/artifacts/${appId}/public/data/dealers`), (snap) => {
            if (snap.empty) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No hay dealers.</td></tr>`; return; }
            tbody.innerHTML = '';
            const dealers = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 99) - (b.order || 99));
            dealers.forEach(d => {
                const tr = tbody.insertRow();
                tr.innerHTML = `
                    <td>${d.order || '-'}</td><td>${d.name}</td><td>${d.specialty}</td>
                    <td>${d.experience} años</td><td>${(d.bio||'').substring(0,30)}...</td>
                    <td>
                        <button class="btn btn-secondary btn-edit" data-id="${d.id}"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-danger btn-delete" data-id="${d.id}"><i class="fas fa-trash"></i></button>
                    </td>
                `;
            });
            tbody.querySelectorAll('.btn-edit').forEach(btn => btn.addEventListener('click', (e) => {
                const d = dealers.find(x => x.id === e.target.closest('button').dataset.id);
                document.getElementById('dealerId').value = d.id;
                document.getElementById('dealerName').value = d.name;
                document.getElementById('dealerOrder').value = d.order;
                document.getElementById('dealerSpecialty').value = d.specialty;
                document.getElementById('dealerExperience').value = d.experience;
                document.getElementById('dealerBio').value = d.bio;
                document.getElementById('dealerImageUrl').value = d.imageUrl || '';
                document.getElementById('dealer-modal-title-action').textContent = 'Editar';
                openModal(document.getElementById('dealerModal'));
            }));
            tbody.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', (e) => {
                openConfirmationModal('¿Eliminar dealer?', () => deleteItem('dealers', e.target.closest('button').dataset.id));
            }));
        });
    };

    document.getElementById('add-dealer-btn').addEventListener('click', () => {
        document.getElementById('dealerForm').reset();
        document.getElementById('dealerId').value = '';
        document.getElementById('dealer-modal-title-action').textContent = 'Añadir';
        openModal(document.getElementById('dealerModal'));
    });

    document.getElementById('dealerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('dealerId').value;
        const data = {
            name: document.getElementById('dealerName').value,
            order: parseInt(document.getElementById('dealerOrder').value),
            specialty: document.getElementById('dealerSpecialty').value,
            experience: parseInt(document.getElementById('dealerExperience').value),
            bio: document.getElementById('dealerBio').value,
            imageUrl: document.getElementById('dealerImageUrl').value,
            lastUpdated: new Date()
        };
        try {
            if (id) await updateDoc(doc(db, `/artifacts/${appId}/public/data/dealers/${id}`), data);
            else await addDoc(collection(db, `/artifacts/${appId}/public/data/dealers`), data);
            closeModal(document.getElementById('dealerModal'));
        } catch (err) { alert("Error guardando dealer"); }
    });
    document.getElementById('closeDealerModalBtn').addEventListener('click', () => closeModal(document.getElementById('dealerModal')));


    // Servicios
    const loadServices = () => {
        const tbody = document.getElementById('services-table-body');
        unsubscribeListeners.services = onSnapshot(collection(db, `/artifacts/${appId}/public/data/services`), (snap) => {
            if (snap.empty) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No hay servicios.</td></tr>`; return; }
            tbody.innerHTML = '';
            const services = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 99) - (b.order || 99));
            services.forEach(s => {
                const tr = tbody.insertRow();
                tr.innerHTML = `
                    <td>${s.order || '-'}</td><td>${s.name}</td><td>${(s.description||'').substring(0,30)}...</td>
                    <td>${s.price || 'Consultar'}</td><td>${s.status || 'Activo'}</td>
                    <td>
                        <button class="btn btn-secondary btn-edit" data-id="${s.id}"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-danger btn-delete" data-id="${s.id}"><i class="fas fa-trash"></i></button>
                    </td>
                `;
            });
            tbody.querySelectorAll('.btn-edit').forEach(btn => btn.addEventListener('click', (e) => {
                const s = services.find(x => x.id === e.target.closest('button').dataset.id);
                document.getElementById('serviceId').value = s.id;
                document.getElementById('serviceName').value = s.name || '';
                document.getElementById('serviceOrder').value = s.order || 0;
                document.getElementById('serviceDescription').value = s.description || '';
                document.getElementById('servicePrice').value = s.price || '';
                document.getElementById('serviceStatus').value = s.status || 'Activo';
                document.getElementById('service-modal-title-action').textContent = 'Editar';
                openModal(document.getElementById('serviceModal'));
            }));
            tbody.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', (e) => {
                openConfirmationModal('¿Eliminar servicio?', () => deleteItem('services', e.target.closest('button').dataset.id));
            }));
        });
    };

    document.getElementById('add-service-btn').addEventListener('click', () => {
        document.getElementById('serviceForm').reset();
        document.getElementById('serviceId').value = '';
        document.getElementById('service-modal-title-action').textContent = 'Añadir';
        openModal(document.getElementById('serviceModal'));
    });

    document.getElementById('serviceForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('serviceId').value;
        const data = {
            name: document.getElementById('serviceName').value,
            order: parseInt(document.getElementById('serviceOrder').value),
            description: document.getElementById('serviceDescription').value,
            price: document.getElementById('servicePrice').value,
            status: document.getElementById('serviceStatus').value,
            lastUpdated: new Date()
        };
        try {
            if (id) await updateDoc(doc(db, `/artifacts/${appId}/public/data/services/${id}`), data);
            else await addDoc(collection(db, `/artifacts/${appId}/public/data/services`), data);
            closeModal(document.getElementById('serviceModal'));
        } catch (err) { alert("Error guardando servicio"); }
    });
    document.getElementById('closeServiceModalBtn').addEventListener('click', () => closeModal(document.getElementById('serviceModal')));


    // Anuncios
    const loadAnnouncements = () => {
        unsubscribeListeners.announcements = onSnapshot(doc(db, `/artifacts/${appId}/public/data/config/announceBar`), (docSnap) => {
            if (docSnap.exists()) {
                document.getElementById('announceText').value = docSnap.data().text || '';
                document.getElementById('announceStatus').value = docSnap.data().status || 'inactive';
            }
        });
    };

    document.getElementById('announceBarForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('announceFormMessage');
        showMsg(msg, 'Guardando...', 'loading');
        try {
            await setDoc(doc(db, `/artifacts/${appId}/public/data/config/announceBar`), {
                text: document.getElementById('announceText').value,
                status: document.getElementById('announceStatus').value,
                lastUpdated: new Date()
            }, { merge: true });
            showMsg(msg, 'Anuncio guardado.', 'success');
        } catch (err) { showMsg(msg, 'Error guardando.', 'error'); }
    });

    // Cerrar cualquier modal al dar clic fuera de él
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeModal(e.target);
        }
    });
});