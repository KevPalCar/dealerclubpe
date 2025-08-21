// Espera a que el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', () => {
    // Referencias a elementos del DOM para el Modal de Cotización
    const quoteModal = document.getElementById('quoteModal');
    const closeQuoteModalBtn = document.getElementById('closeQuoteModalBtn'); // ID específico para el botón de cerrar del modal de cotización
    const openQuoteButtons = document.querySelectorAll('.open-quote-modal'); // Selecciona todos los botones con esta clase
    const openGeneralQuoteModalBtn = document.getElementById('openGeneralQuoteModal');
    const quoteForm = document.getElementById('quoteForm');
    const modalQuoteFor = document.getElementById('modalQuoteFor');
    const detailsTextarea = document.getElementById('details');
    const submitQuoteBtn = document.getElementById('submitQuoteBtn');
    const formMessage = document.getElementById('formMessage');

    // Referencias a elementos del DOM para el Nuevo Modal de WhatsApp
    const whatsappPreChatModal = document.getElementById('whatsappPreChatModal');
    const closeWhatsappModalBtn = document.getElementById('closeWhatsappModalBtn'); // ID específico para el botón de cerrar del modal de WhatsApp
    const openWhatsappPreChatModalBtn = document.getElementById('openWhatsappPreChatModal'); // El icono flotante de WhatsApp
    const whatsappPreChatForm = document.getElementById('whatsappPreChatForm');
    const whatsappNameInput = document.getElementById('whatsappName');
    const whatsappMessageInput = document.getElementById('whatsappMessage');
    const sendWhatsappBtn = document.getElementById('sendWhatsappBtn');
    const goToQuoteFormBtn = document.getElementById('goToQuoteFormBtn');
    const whatsappMessageStatus = document.getElementById('whatsappMessageStatus');

    // Variables de Firebase
    let db;
    let collection;
    let addDoc;
    let appId;
    let initialAuthToken;
    let signInAnonymously;
    let signInWithCustomToken;

    // Número de teléfono de WhatsApp de DealerClub (ajusta si es necesario)
    const WHATSAPP_PHONE_NUMBER = '51936437502';

    // Función para inicializar Firebase (espera a que el script module en HTML se cargue)
    const initializeFirebase = async () => {
        // Verifica si las variables globales de Firebase ya están disponibles
        if (window.firebaseDb && window.firebaseCollection && window.firebaseAddDoc) {
            db = window.firebaseDb;
            collection = window.firebaseCollection;
            addDoc = window.firebaseAddDoc;
            appId = window.appId;
            initialAuthToken = window.initialAuthToken;
            signInAnonymously = window.signInAnonymously;
            signInWithCustomToken = window.signInWithCustomToken;

            // Iniciar sesión con el token de Canvas o anónimamente si no hay token
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(window.firebaseAuth, initialAuthToken);
                    console.log("Sesión iniciada con token personalizado.");
                } else {
                    await signInAnonymously(window.firebaseAuth);
                    console.log("Sesión iniciada anónimamente.");
                }
            } catch (error) {
                console.error("Error al iniciar sesión en Firebase:", error);
                formMessage.textContent = 'Error al inicializar el servicio de cotización. Inténtelo más tarde.';
                formMessage.className = 'form-message error';
                submitQuoteBtn.disabled = true; // Deshabilitar envío si falla la autenticación
                whatsappMessageStatus.textContent = 'Error al inicializar el servicio de WhatsApp. Inténtelo más tarde.';
                whatsappMessageStatus.className = 'form-message error';
                sendWhatsappBtn.disabled = true; // Deshabilitar envío de WhatsApp si falla la autenticación
            }
        } else {
            console.error("Firebase SDK global variables not found. Retrying in 100ms...");
            setTimeout(initializeFirebase, 100); // Reintentar si no está listo
        }
    };

    initializeFirebase();

    // --- Funciones para el Modal de Cotización ---
    function openQuoteModal(quoteInfo = '') {
        quoteModal.style.display = 'flex'; // Usamos 'flex' para centrar el modal con CSS
        document.body.style.overflow = 'hidden'; // Evita el scroll del fondo
        formMessage.textContent = ''; // Limpiar mensajes anteriores
        formMessage.className = 'form-message'; // Resetear clase de mensaje
        submitQuoteBtn.disabled = false; // Habilitar botón de envío
        
        // Pre-rellenar el campo de detalles si se cotiza una mesa o dealer específico
        if (quoteInfo) {
            modalQuoteFor.textContent = `Cotización para: ${quoteInfo}`;
            detailsTextarea.value = `Interesado en: ${quoteInfo}`;
        } else {
            modalQuoteFor.textContent = 'Cotización General de Servicios';
            detailsTextarea.value = ''; // Limpiar si es cotización general
        }
    }

    function closeQuoteModal() {
        quoteModal.style.display = 'none';
        document.body.style.overflow = 'auto'; // Habilita el scroll del fondo
        quoteForm.reset(); // Reinicia el formulario
    }

    // Event Listeners para abrir el modal de cotización (botón general y botones de mesas/dealers)
    openGeneralQuoteModalBtn.addEventListener('click', () => openQuoteModal());
    openQuoteButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tableName = button.dataset.tableName;
            const dealerName = button.dataset.dealerName;
            let quoteInfo = '';
            if (tableName) {
                quoteInfo = `Mesa de ${tableName}`;
            } else if (dealerName) {
                quoteInfo = `Dealer: ${dealerName}`;
            }
            openQuoteModal(quoteInfo);
        });
    });

    // Event Listener para cerrar el modal de cotización
    closeQuoteModalBtn.addEventListener('click', closeQuoteModal);

    // Manejo del envío del formulario de cotización
    quoteForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // Previene el envío por defecto del formulario

        if (!db) {
            formMessage.textContent = 'Error: Servicio de base de datos no inicializado.';
            formMessage.className = 'form-message error';
            return;
        }

        submitQuoteBtn.disabled = true; // Deshabilita el botón para evitar envíos duplicados
        formMessage.textContent = 'Enviando cotización...';
        formMessage.className = 'form-message loading';

        // Recopila los datos del formulario
        const formData = {
            fullName: document.getElementById('fullName').value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
            eventType: document.getElementById('eventType').value,
            eventDate: document.getElementById('eventDate').value,
            details: document.getElementById('details').value,
            timestamp: new Date() // Fecha y hora del envío
        };

        // Si hay un contexto de cotización, añádelo a los datos
        if (modalQuoteFor.textContent && modalQuoteFor.textContent !== 'Cotización General de Servicios') {
            formData.quoteContext = modalQuoteFor.textContent;
        }

        try {
            // Guarda los datos en Firestore
            const collectionPath = `artifacts/${appId}/public/data/service_requests`;
            await addDoc(collection(db, collectionPath), formData);

            formMessage.textContent = '¡Cotización enviada con éxito! Nos pondremos en contacto pronto.';
            formMessage.className = 'form-message success';
            quoteForm.reset(); // Limpia el formulario después del éxito

            // Cerrar modal automáticamente después de un tiempo
            setTimeout(closeQuoteModal, 3000); 

        } catch (error) {
            console.error("Error al guardar la cotización en Firestore:", error);
            formMessage.textContent = 'Hubo un error al enviar tu cotización. Por favor, inténtalo de nuevo.';
            formMessage.className = 'form-message error';
        } finally {
            submitQuoteBtn.disabled = false; // Vuelve a habilitar el botón
        }
    });

    // --- Funciones para el Nuevo Modal de Pre-interacción de WhatsApp ---

    function openWhatsappModal() {
        whatsappPreChatModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        whatsappMessageStatus.style.display = 'none'; // Limpiar mensajes previos
        whatsappPreChatForm.reset(); // Resetear formulario de WhatsApp
    }

    function closeWhatsappModal() {
        whatsappPreChatModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    // Event listener para abrir el modal de WhatsApp
    openWhatsappPreChatModalBtn.addEventListener('click', (e) => {
        e.preventDefault(); // Evita que el enlace de anclaje se comporte como tal
        openWhatsappModal();
    });

    // Event listener para cerrar el modal de WhatsApp
    closeWhatsappModalBtn.addEventListener('click', closeWhatsappModal);

    // Manejo del envío del formulario de pre-chat de WhatsApp
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
        
        // Abrir WhatsApp en una nueva pestaña
        window.open(whatsappUrl, '_blank');

        whatsappMessageStatus.textContent = 'Abriendo WhatsApp...';
        whatsappMessageStatus.className = 'form-message loading';
        whatsappMessageStatus.style.display = 'block';

        // Opcional: Cerrar el modal después de un breve retardo
        setTimeout(() => {
            closeWhatsappModal();
            whatsappMessageStatus.style.display = 'none';
        }, 1500);
    });

    // Botón "Ir al Formulario de Cotización" dentro del modal de WhatsApp
    goToQuoteFormBtn.addEventListener('click', () => {
        closeWhatsappModal(); // Cierra el modal de WhatsApp
        openQuoteModal(); // Abre el modal de cotización
    });

    // Cerrar cualquier modal al hacer clic fuera del contenido del modal
    window.addEventListener('click', (event) => {
        if (event.target == quoteModal) {
            closeQuoteModal();
        } else if (event.target == whatsappPreChatModal) {
            closeWhatsappModal();
        }
    });
});
