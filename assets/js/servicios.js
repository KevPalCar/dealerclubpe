// Espera a que el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', () => {
    // Referencias a elementos del DOM para el Modal de Cotización
    const quoteModal = document.getElementById('quoteModal');
    const closeQuoteModalBtn = document.getElementById('closeQuoteModalBtn');
    const openGeneralQuoteModalBtn = document.getElementById('openGeneralQuoteModal');
    const quoteForm = document.getElementById('quoteForm');
    const modalQuoteFor = document.getElementById('modalQuoteFor');
    const detailsTextarea = document.getElementById('details');
    const submitQuoteBtn = document.getElementById('submitQuoteBtn');
    const formMessage = document.getElementById('formMessage');

    // Referencias a elementos del DOM para el Nuevo Modal de WhatsApp
    const whatsappPreChatModal = document.getElementById('whatsappPreChatModal');
    const closeWhatsappModalBtn = document.getElementById('closeWhatsappModalBtn');
    const openWhatsappPreChatModalBtn = document.getElementById('openWhatsappPreChatModal');
    const whatsappPreChatForm = document.getElementById('whatsappPreChatForm');
    const whatsappNameInput = document.getElementById('whatsappName');
    const whatsappMessageInput = document.getElementById('whatsappMessage');
    const sendWhatsappBtn = document.getElementById('sendWhatsappBtn');
    const goToQuoteFormBtn = document.getElementById('goToQuoteFormBtn');
    const whatsappMessageStatus = document.getElementById('whatsappMessageStatus');

    // Referencias para la sección de Dealers Destacados
    const dealersGridContainer = document.getElementById('dealers-grid-container');
    const loadingDealers = document.getElementById('loading-dealers');

    // Referencia para el enlace de acceso a la cuenta de estudiante (en la barra de navegación)
    const studentAccessLink = document.getElementById('student-access-link');

    // Variables de Firebase
    let db;
    let collection;
    let addDoc;
    let getDocs; // Necesario para cargar los dealers
    let appId;
    let initialAuthToken;
    let signInAnonymously;
    let signInWithCustomToken;
    let auth; // Referencia a Firebase Auth
    let onAuthStateChanged; // Referencia a onAuthStateChanged

    // Número de teléfono de WhatsApp de DealerClub (ajusta si es necesario)
    const WHATSAPP_PHONE_NUMBER = '51936437502';

    // Función para inicializar Firebase y configurar el listener de autenticación
    const initializeFirebase = async () => {
        // Verifica si las variables globales de Firebase ya están disponibles
        if (window.firebaseDb && window.firebaseCollection && window.firebaseAddDoc && window.firebaseGetDocs &&
            window.firebaseAuth && window.firebaseOnAuthStateChanged && window.appId) {
            
            db = window.firebaseDb;
            collection = window.firebaseCollection;
            addDoc = window.firebaseAddDoc;
            getDocs = window.firebaseGetDocs; // Asigna getDocs
            appId = window.appId;
            initialAuthToken = window.initialAuthToken;
            signInAnonymously = window.signInAnonymously;
            signInWithCustomToken = window.signInWithCustomToken;
            auth = window.firebaseAuth;
            onAuthStateChanged = window.firebaseOnAuthStateChanged;

            // Escuchar cambios en el estado de autenticación de Firebase (para el enlace 'Mi Cuenta')
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    // Usuario está logueado
                    studentAccessLink.textContent = 'Mi Dashboard';
                    studentAccessLink.href = 'student_dashboard.html';
                } else {
                    // Usuario NO está logueado
                    studentAccessLink.textContent = 'Iniciar Sesión';
                    studentAccessLink.href = 'login.html';
                }
            });

            // Lógica para garantizar que haya un usuario autenticado (incluso anónimo) antes de cargar dealers
            try {
                // Esperar un breve momento para que onAuthStateChanged tenga la oportunidad de detectar un usuario persistente
                await new Promise(resolve => setTimeout(resolve, 50)); 

                if (!auth.currentUser) { // Si después del pequeño retraso, todavía no hay un usuario
                     if (initialAuthToken) { // Si hay un token inicial de Canvas, úsalo
                         await signInWithCustomToken(auth, initialAuthToken);
                         console.log("Firebase (Servicios): Sesión inicial con token personalizado establecida.");
                     } else { // De lo contrario, intenta iniciar sesión anónimamente
                        await signInAnonymously(auth);
                        console.log("Firebase (Servicios): Sesión anónima establecida para lectura de datos.");
                     }
                } else {
                    console.log("Firebase (Servicios): Usuario ya autenticado, no se requiere sign-in adicional.");
                }
                
                // Ahora que estamos seguros de un estado de autenticación, intentamos cargar los dealers
                fetchDealers(); // Llama a la función para cargar los dealers
            } catch (error) {
                console.error("Firebase (Servicios): Error al inicializar Firebase/autenticación:", error);
                formMessage.textContent = 'Error al inicializar el servicio de cotización. Inténtelo más tarde.';
                formMessage.className = 'form-message error';
                submitQuoteBtn.disabled = true;
                whatsappMessageStatus.textContent = 'Error al inicializar el servicio de WhatsApp. Inténtelo más tarde.';
                whatsappMessageStatus.className = 'form-message error';
                sendWhatsappBtn.disabled = true;
            }
        } else {
            console.error("Firebase SDK global variables not found for servicios.js. Retrying in 100ms...");
            setTimeout(initializeFirebase, 100); // Reintentar si no está listo
        }
    };

    initializeFirebase(); // Inicia la inicialización de Firebase

    // --- Funciones para el Modal de Cotización ---
    function openQuoteModal(quoteInfo = '') {
        quoteModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        formMessage.textContent = '';
        formMessage.className = 'form-message';
        submitQuoteBtn.disabled = false;
        
        if (quoteInfo) {
            modalQuoteFor.textContent = `Cotización para: ${quoteInfo}`;
            detailsTextarea.value = `Interesado en: ${quoteInfo}`;
        } else {
            modalQuoteFor.textContent = 'Cotización General de Servicios';
            detailsTextarea.value = '';
        }
    }

    function closeQuoteModal() {
        quoteModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        quoteForm.reset();
    }

    // Event Listener para abrir el modal de cotización (botón general)
    openGeneralQuoteModalBtn.addEventListener('click', () => openQuoteModal());
    
    // NOTA: Los event listeners para los botones de las mesas/dealers se añadirán
    //       después de que el contenido dinámico sea cargado por fetchDealers().

    // Event Listener para cerrar el modal de cotización
    closeQuoteModalBtn.addEventListener('click', closeQuoteModal);

    // Manejo del envío del formulario de cotización
    quoteForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!db) {
            formMessage.textContent = 'Error: Servicio de base de datos no inicializado.';
            formMessage.className = 'form-message error';
            return;
        }

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

        if (modalQuoteFor.textContent && modalQuoteFor.textContent !== 'Cotización General de Servicios') {
            formData.quoteContext = modalQuoteFor.textContent;
        }

        try {
            const collectionPath = `artifacts/${appId}/public/data/service_requests`;
            await addDoc(collection(db, collectionPath), formData);

            formMessage.textContent = '¡Cotización enviada con éxito! Nos pondremos en contacto pronto.';
            formMessage.className = 'form-message success';
            quoteForm.reset();

            setTimeout(closeQuoteModal, 3000); 

        } catch (error) {
            console.error("Error al guardar la cotización en Firestore:", error);
            formMessage.textContent = 'Hubo un error al enviar tu cotización. Por favor, inténtalo de nuevo.';
            formMessage.className = 'form-message error';
        } finally {
            submitQuoteBtn.disabled = false;
        }
    });

    // --- Funciones para el Nuevo Modal de Pre-interacción de WhatsApp ---

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

    openWhatsappPreChatModalBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openWhatsappModal();
    });

    closeWhatsappModalBtn.addEventListener('click', closeWhatsappModal);

    whatsappPreChatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = whatsappNameInput.value.trim();
        const message = whatsappMessageInput.value.trim();

        let whatsappMessage = 'Hola DealerClub,';
        if (name) {
            whatsappMessage += ` soy ${name}.`;
        }
        if (message) {
            whatsappMessage += ` ${message}`;
        } else {
            whatsappMessage += ` Me gustaría obtener más información.`;
        }

        const whatsappUrl = `https://wa.me/${WHATSAPP_PHONE_NUMBER}?text=${encodeURIComponent(whatsappMessage)}`;
        
        window.open(whatsappUrl, '_blank');

        whatsappMessageStatus.textContent = 'Abriendo WhatsApp...';
        whatsappMessageStatus.className = 'form-message loading';
        whatsappMessageStatus.style.display = 'block';

        setTimeout(() => {
            closeWhatsappModal();
            whatsappMessageStatus.style.display = 'none';
        }, 1500);
    });

    goToQuoteFormBtn.addEventListener('click', () => {
        closeWhatsappModal();
        openQuoteModal();
    });

    window.addEventListener('click', (event) => {
        if (event.target == quoteModal) {
            closeQuoteModal();
        } else if (event.target == whatsappPreChatModal) {
            closeWhatsappModal();
        }
    });

    // --- NUEVA FUNCIÓN PARA CARGAR DEALERS DESTACADOS DESDE FIRESTORE ---
    const fetchDealers = async () => {
        loadingDealers.style.display = 'block'; // Muestra el mensaje de carga
        dealersGridContainer.innerHTML = ''; // Limpia el contenedor

        try {
            // Ruta de la colección de dealers en Firestore
            // Path: /artifacts/{appId}/public/data/dealers
            const collectionPath = `artifacts/${appId}/public/data/dealers`;
            console.log("DEBUG (Servicios): Intentando cargar dealers de la ruta:", collectionPath);
            const dealersCol = collection(db, collectionPath);
            const dealerSnapshot = await getDocs(dealersCol);

            if (dealerSnapshot.empty) {
                loadingDealers.textContent = 'No hay dealers destacados disponibles en este momento.';
                loadingDealers.style.color = '#ffc107';
                dealersGridContainer.appendChild(loadingDealers); // Asegura que el mensaje se muestre en el contenedor correcto
                return;
            }

            loadingDealers.style.display = 'none'; // Oculta el mensaje de carga

            const dealers = dealerSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Opcional: ordenar dealers si tienen un campo 'order' o 'name'
            dealers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            dealers.forEach(dealer => {
                const dealerCard = document.createElement('div');
                dealerCard.className = 'dealer-card';

                // Usamos una imagen de placeholder si no hay URL de imagen, o si la URL falla
                const imageUrl = dealer.imageUrl || `https://placehold.co/400x300/333333/ffffff?text=${encodeURIComponent(dealer.name || 'Dealer')}`;

                dealerCard.innerHTML = `
                    <img src="${imageUrl}" alt="${dealer.name || 'Dealer Destacado'}" 
                         onerror="this.onerror=null;this.src='https://placehold.co/400x300/333333/ffffff?text=Imagen+No+Disp.'">
                    <h3>${dealer.name || 'Dealer'}</h3>
                    <p>Especialidad: ${dealer.specialty || 'Varias'}</p>
                    <button type="button" class="btn btn-primary open-quote-modal" data-dealer-name="${dealer.name || 'Dealer'}">Solicitar a ${dealer.name ? dealer.name.split(' ')[0] : 'este Dealer'}</button>
                `;
                dealersGridContainer.appendChild(dealerCard);
            });

            // Re-asignar Event Listeners a los botones "Cotizar" y "Solicitar Dealer"
            // Esto es crucial porque los botones se crean dinámicamente.
            document.querySelectorAll('.open-quote-modal').forEach(button => {
                // Elimina cualquier listener duplicado si esta función se llama más de una vez
                button.removeEventListener('click', handleOpenQuoteModal); 
                button.addEventListener('click', handleOpenQuoteModal);
            });

        } catch (error) {
            console.error("Error al cargar los dealers destacados desde Firestore:", error);
            loadingDealers.textContent = 'Error al cargar los dealers. Por favor, asegúrate de que Firestore esté configurado y los datos existan.';
            loadingDealers.style.color = '#dc3545';
            dealersGridContainer.appendChild(loadingDealers);
        }
    };

    // Función manejadora para los botones de cotización (mesas y dealers)
    function handleOpenQuoteModal() {
        const tableName = this.dataset.tableName; // 'this' se refiere al botón que fue clickeado
        const dealerName = this.dataset.dealerName;
        let quoteInfo = '';
        if (tableName) {
            quoteInfo = `Mesa de ${tableName}`;
        } else if (dealerName) {
            quoteInfo = `Dealer: ${dealerName}`;
        }
        openQuoteModal(quoteInfo);
    }
});
