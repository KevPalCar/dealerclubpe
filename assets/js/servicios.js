// ==========================================
// ARCHIVO: servicios.js
// Lógica completa, Firebase y UI para Servicios
// ==========================================

// --- 1. IMPORTACIONES Y CONFIGURACIÓN DE FIREBASE ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyA3YsyUDmLeAvvgWwvCnjeJt-HbGGk--PY",
    authDomain: "dealerclubpe.firebaseapp.com",
    projectId: "dealerclubpe",
    storageBucket: "dealerclubpe.firebasestorage.app",
    messagingSenderId: "330568352415",
    appId: "1:330568352415:web:9fcd7651698bfafac998aa",
    measurementId: "G-PF3W9NDSDP"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const appId = 'default-app-id'; // Tu identificador de Firestore
const initialAuthToken = null;
const WHATSAPP_PHONE_NUMBER = '51936437502';

// --- INICIO DE LA LÓGICA DEL DOM ---
document.addEventListener('DOMContentLoaded', () => {
    // --- 2. REFERENCIAS AL DOM ---
    const quoteModal = document.getElementById('quoteModal');
    const closeQuoteModalBtn = document.getElementById('closeQuoteModalBtn');
    const openGeneralQuoteModalBtn = document.getElementById('openGeneralQuoteModal');
    const quoteForm = document.getElementById('quoteForm');
    const modalQuoteFor = document.getElementById('modalQuoteFor');
    const detailsTextarea = document.getElementById('details');
    const submitQuoteBtn = document.getElementById('submitQuoteBtn'); 
    const formMessage = document.getElementById('formMessage');

    const whatsappPreChatModal = document.getElementById('whatsappPreChatModal');
    const closeWhatsappModalBtn = document.getElementById('closeWhatsappModalBtn');
    const openWhatsappPreChatModalBtn = document.getElementById('openWhatsappPreChatModal');
    const whatsappPreChatForm = document.getElementById('whatsappPreChatForm');
    const whatsappNameInput = document.getElementById('whatsappName');
    const whatsappMessageInput = document.getElementById('whatsappMessage');
    const sendWhatsappBtn = document.getElementById('sendWhatsappBtn');
    const goToQuoteFormBtn = document.getElementById('goToQuoteFormBtn');
    const whatsappMessageStatus = document.getElementById('whatsappMessageStatus');

    const dealersGridContainer = document.getElementById('dealers-grid-container');
    const loadingDealers = document.getElementById('loading-dealers');
    const mesasGridContainer = document.getElementById('mesas-grid-container');
    const loadingMesas = document.getElementById('loading-mesas');
    const studentAccessLink = document.getElementById('student-access-link');
    
    const announceBar = document.getElementById('announce-bar');
    const announceTextElement = document.getElementById('announce-text');
    const closeAnnounceBarBtn = document.getElementById('close-announce-bar');
    const itemCards = document.querySelectorAll('.item-card');

    // --- 3. LÓGICA DE SELECCIÓN INTERACTIVA (ARMA TU PAQUETE) ---
    function updateDetailsText() {
        const selectedMesas = [];
        const selectedExtras = [];
        document.querySelectorAll('.item-card.selected').forEach(card => {
            if (card.dataset.type === 'Mesa') selectedMesas.push(card.dataset.name);
            else if (card.dataset.type === 'Extra') selectedExtras.push(card.dataset.name);
        });

        let resultText = "";
        if (selectedMesas.length > 0) resultText += "🎲 MESAS: " + selectedMesas.join(', ') + ".\n";
        if (selectedExtras.length > 0) resultText += "✨ EXTRAS: " + selectedExtras.join(', ') + ".\n";
        detailsTextarea.value = resultText;
    }

    itemCards.forEach(card => {
        card.addEventListener('click', function() {
            this.classList.toggle('selected');
            updateDetailsText();
        });
    });

    // --- 4. FUNCIONES DE MODALES ---
    function openQuoteModal(quoteInfo = '') {
        quoteModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        formMessage.textContent = '';
        formMessage.className = 'form-message';
        submitQuoteBtn.disabled = false;
        if (quoteInfo) {
            modalQuoteFor.textContent = `Cotización para: ${quoteInfo}`;
            detailsTextarea.value = `Interesado en: ${quoteInfo}\n` + detailsTextarea.value;
        } else {
            modalQuoteFor.textContent = 'Cotización General de Servicios';
        }
    }

    function closeQuoteModal() {
        quoteModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        quoteForm.reset();
        itemCards.forEach(card => card.classList.remove('selected'));
    }

    function openWhatsappModal() {
        whatsappPreChatModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        whatsappMessageStatus.style.display = 'none';
        whatsappPreChatForm.reset();
    }

    function closeWhatsappModal() {
        whatsappPreChatModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    function handleOpenQuoteModal() {
        const tableName = this.dataset.tableName;
        const dealerName = this.dataset.dealerName;
        let quoteInfo = '';
        if (tableName) quoteInfo = `Mesa de ${tableName}`;
        else if (dealerName) quoteInfo = `Dealer: ${dealerName}`;
        openQuoteModal(quoteInfo);
    }

    if(openGeneralQuoteModalBtn) openGeneralQuoteModalBtn.addEventListener('click', () => openQuoteModal());
    if(closeQuoteModalBtn) closeQuoteModalBtn.addEventListener('click', closeQuoteModal);
    if(openWhatsappPreChatModalBtn) openWhatsappPreChatModalBtn.addEventListener('click', (e) => { e.preventDefault(); openWhatsappModal(); });
    if(closeWhatsappModalBtn) closeWhatsappModalBtn.addEventListener('click', closeWhatsappModal);
    if(goToQuoteFormBtn) goToQuoteFormBtn.addEventListener('click', () => { closeWhatsappModal(); openQuoteModal(); });

    window.addEventListener('click', (event) => {
        if (event.target === quoteModal) closeQuoteModal();
        else if (event.target === whatsappPreChatModal) closeWhatsappModal();
    });

    whatsappPreChatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = whatsappNameInput.value.trim();
        const message = whatsappMessageInput.value.trim();
        let whatsappMessage = 'Hola DealerClub,';
        if (name) whatsappMessage += ` soy ${name}.`;
        if (message) whatsappMessage += ` ${message}`;
        else whatsappMessage += ` Me gustaría obtener más información.`;
        window.open(`https://wa.me/${WHATSAPP_PHONE_NUMBER}?text=${encodeURIComponent(whatsappMessage)}`, '_blank');
        whatsappMessageStatus.textContent = 'Abriendo WhatsApp...';
        whatsappMessageStatus.className = 'form-message loading';
        whatsappMessageStatus.style.display = 'block';
        setTimeout(() => { closeWhatsappModal(); whatsappMessageStatus.style.display = 'none'; }, 1500);
    });

    quoteForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!db) return;
        submitQuoteBtn.disabled = true;
        formMessage.textContent = 'Enviando cotización...';
        formMessage.className = 'form-message loading';
        const formData = {
            fullName: document.getElementById('fullName').value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
            eventType: document.getElementById('eventType').value,
            eventDate: document.getElementById('eventDate').value,
            details: document.getElementById('details').value,
            timestamp: new Date()
        };
        if (modalQuoteFor.textContent && modalQuoteFor.textContent !== 'Cotización General de Servicios') formData.quoteContext = modalQuoteFor.textContent;

        try {
            await addDoc(collection(db, `artifacts/${appId}/public/data/service_requests`), formData);
            formMessage.textContent = '¡Cotización enviada con éxito!';
            formMessage.className = 'form-message success';
            quoteForm.reset();
            setTimeout(closeQuoteModal, 3000); 
        } catch (error) {
            formMessage.textContent = 'Hubo un error al enviar tu cotización.';
            formMessage.className = 'form-message error';
        } finally {
            submitQuoteBtn.disabled = false;
        }
    });

    // --- 5. LECTURA DE BASE DE DATOS (MESAS, DEALERS Y ANNOUNCEBAR) ---
    const fetchMesas = async () => {
        if(!mesasGridContainer) return;
        loadingMesas.style.display = 'block';
        mesasGridContainer.innerHTML = '';
        try {
            const mesaSnapshot = await getDocs(collection(db, `artifacts/${appId}/public/data/tables`));
            if (mesaSnapshot.empty) {
                loadingMesas.textContent = 'No hay mesas disponibles.';
                return;
            }
            loadingMesas.style.display = 'none';
            const mesas = mesaSnapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            mesas.forEach(mesa => {
                const imageUrl = mesa.imageUrl || `https://placehold.co/400x200/333333/ffffff?text=${encodeURIComponent(mesa.name || 'Mesa')}`;
                const mesaCard = document.createElement('div');
                mesaCard.className = 'mesa-card';
                mesaCard.innerHTML = `
                    <img src="${imageUrl}" alt="${mesa.name || 'Mesa'}" onerror="this.onerror=null;this.src='https://eidk95seyu2.exactdn.com/en/blog/wp-content/uploads/2024/02/BetMGMCasino_Header_Apr01_Craps-Dice-Setting-and-Control-min.jpg?strip=all'">
                    <h3>${mesa.name || 'Mesa'}</h3>
                    <p>${mesa.description || 'Consulta para más detalles.'}</p>
                    <button type="button" class="btn btn-primary open-quote-modal" data-table-name="${mesa.name || 'Mesa'}">${mesa.status === 'Próximamente' ? 'Próximamente' : 'Cotizar'}</button>
                `;
                mesasGridContainer.appendChild(mesaCard);
            });
            document.querySelectorAll('.open-quote-modal').forEach(button => button.addEventListener('click', handleOpenQuoteModal));
        } catch (error) {
            loadingMesas.textContent = 'Error al cargar las mesas.';
            loadingMesas.style.color = '#dc3545';
        }
    };

    const fetchDealers = async () => {
        if(!dealersGridContainer) return;
        loadingDealers.style.display = 'block';
        dealersGridContainer.innerHTML = '';
        try {
            const dealerSnapshot = await getDocs(collection(db, `artifacts/${appId}/public/data/dealers`));
            if (dealerSnapshot.empty) {
                loadingDealers.textContent = 'No hay dealers disponibles.';
                return;
            }
            loadingDealers.style.display = 'none';
            const dealers = dealerSnapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            dealers.forEach(dealer => {
                const imageUrl = dealer.imageUrl || `https://placehold.co/400x300/333333/ffffff?text=${encodeURIComponent(dealer.name || 'Dealer')}`;
                const dealerCard = document.createElement('div');
                dealerCard.className = 'dealer-card';
                dealerCard.innerHTML = `
                    <img src="${imageUrl}" alt="${dealer.name || 'Dealer'}" onerror="this.onerror=null;this.src='https://placehold.co/400x300/333333/ffffff?text=No+Disp.'">
                    <h3>${dealer.name || 'Dealer'}</h3>
                    <p>Especialidad: ${dealer.specialty || 'Varias'}</p>
                    <button type="button" class="btn btn-primary open-quote-modal" data-dealer-name="${dealer.name || 'Dealer'}">Solicitar a ${dealer.name ? dealer.name.split(' ')[0] : 'este Dealer'}</button>
                `;
                dealersGridContainer.appendChild(dealerCard);
            });
            document.querySelectorAll('.open-quote-modal').forEach(button => button.addEventListener('click', handleOpenQuoteModal));
        } catch (error) {
            loadingDealers.textContent = 'Error al cargar los dealers.';
            loadingDealers.style.color = '#dc3545';
        }
    };

    const loadAnnounceBar = () => {
        if (announceBar && db && appId) {
            onSnapshot(doc(db, `/artifacts/${appId}/public/data/config/announceBar`), (docSnapshot) => {
                if (docSnapshot.exists()) {
                    const data = docSnapshot.data();
                    if (data.status === 'active' && data.servicios && data.servicios.trim() !== '') {
                        announceTextElement.textContent = data.servicios;
                        announceBar.style.display = 'flex';
                    } else announceBar.style.display = 'none';
                } else announceBar.style.display = 'none';
            });
            if (closeAnnounceBarBtn) closeAnnounceBarBtn.addEventListener('click', () => announceBar.style.display = 'none');
        }
    };

    // --- 6. INICIALIZACIÓN DIRECTA DE FIREBASE ---
    const initializeFirebase = async () => {
        if(studentAccessLink && auth) {
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    studentAccessLink.textContent = 'Iniciar Sesión';
                    studentAccessLink.href = 'student_dashboard.html';
                } else {
                    studentAccessLink.textContent = 'Iniciar Sesión';
                    studentAccessLink.href = 'login.html';
                }
            });
        }
        try {
            if (!auth.currentUser) {
                 if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);
                 else await signInAnonymously(auth);
            }
            // Ejecutamos las funciones directamente, sin esperas
            loadAnnounceBar();
            fetchMesas();
            fetchDealers();
        } catch (error) {
            console.error("Error Auth Firebase:", error);
        }
    };

    // ¡Arrancamos!
    initializeFirebase();
});