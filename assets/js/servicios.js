// ============================================================
// SERVICIOS — DealerClub
// ============================================================
import { auth, db, dbPath } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    collection, addDoc, getDocs, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Número de fallback. El número real se carga desde Firestore.
// Para actualizar el número oficial, usa el panel admin → Config & Anuncios.
let WHATSAPP_PHONE_NUMBER = '51929610747';

document.addEventListener('DOMContentLoaded', () => {

    // ── REFERENCIAS AL DOM ────────────────────────────────────
    const quoteModal           = document.getElementById('quoteModal');
    const closeQuoteModalBtn   = document.getElementById('closeQuoteModalBtn');
    const openGeneralQuoteBtn  = document.getElementById('openGeneralQuoteModal');
    const quoteForm            = document.getElementById('quoteForm');
    const modalQuoteFor        = document.getElementById('modalQuoteFor');
    const detailsTextarea      = document.getElementById('details');
    const submitQuoteBtn       = document.getElementById('submitQuoteBtn');
    const formMessage          = document.getElementById('formMessage');

    const whatsappModal        = document.getElementById('whatsappPreChatModal');
    const closeWhatsappBtn     = document.getElementById('closeWhatsappModalBtn');
    const openWhatsappBtn      = document.getElementById('openWhatsappPreChatModal');
    const whatsappForm         = document.getElementById('whatsappPreChatForm');
    const whatsappNameInput    = document.getElementById('whatsappName');
    const whatsappMsgInput     = document.getElementById('whatsappMessage');
    const sendWhatsappBtn      = document.getElementById('sendWhatsappBtn');
    const goToQuoteBtn         = document.getElementById('goToQuoteFormBtn');
    const whatsappMsgStatus    = document.getElementById('whatsappMessageStatus');

    const dealersGrid          = document.getElementById('dealers-grid-container');
    const loadingDealers       = document.getElementById('loading-dealers');
    const mesasGrid            = document.getElementById('mesas-grid-container');
    const loadingMesas         = document.getElementById('loading-mesas');
    const modalMesasGrid       = document.getElementById('modal-mesas-grid');
    const studentAccessLink    = document.getElementById('student-access-link');
    const announceBar          = document.getElementById('announce-bar');
    const announceText         = document.getElementById('announce-text');
    const closeAnnounce        = document.getElementById('close-announce-bar');

    // ── CARGA NÚMERO WHATSAPP DESDE FIRESTORE ─────────────────
    // Usa merge:true en el admin para no perder otros campos del documento.
    onSnapshot(doc(db, dbPath('config/announceBar')), (snap) => {
        if (snap.exists() && snap.data().whatsapp) {
            WHATSAPP_PHONE_NUMBER = snap.data().whatsapp.replace(/\D/g, '');
        }
    });

    // ── HEADER: enlace inteligente ────────────────────────────
    if (studentAccessLink) {
        onAuthStateChanged(auth, (user) => {
            studentAccessLink.textContent = user ? 'Mi Campus' : 'Iniciar Sesión';
            studentAccessLink.href = user ? '/panel-estudiante' : '/iniciar-sesion';
        });
    }

    // ── ANNOUNCE BAR ─────────────────────────────────────────
    onSnapshot(doc(db, dbPath('config/announceBar')), (snap) => {
        if (snap.exists()) {
            const d = snap.data();
            if (d.servicios?.trim()) {
                announceText.textContent = d.servicios;
                announceBar.style.display = 'flex';
            } else {
                announceBar.style.display = 'none';
            }
        } else {
            announceBar.style.display = 'none';
        }
    });
    closeAnnounce?.addEventListener('click', () => announceBar.style.display = 'none');

    // ── SELECCIÓN INTERACTIVA (ARMA TU PAQUETE) ───────────────
    const updateDetailsText = () => {
        const mesas  = [];
        const extras = [];
        document.querySelectorAll('.item-card.selected').forEach(card => {
            if (card.dataset.type === 'Mesa')  mesas.push(card.dataset.name);
            if (card.dataset.type === 'Extra') extras.push(card.dataset.name);
        });
        let txt = '';
        if (mesas.length)  txt += '🎲 MESAS: '  + mesas.join(', ')  + '.\n';
        if (extras.length) txt += '✨ EXTRAS: ' + extras.join(', ') + '.\n';
        detailsTextarea.value = txt;
    };

    // Activa/desactiva una tarjeta seleccionable. Las mesas en estado
    // "Próximamente"/"Agotado" llevan la clase .item-disabled y no se togglean.
    const attachItemToggle = (card) => {
        card.addEventListener('click', function () {
            if (this.classList.contains('item-disabled')) return;
            this.classList.toggle('selected');
            updateDetailsText();
        });
    };

    // Los EXTRAS son estáticos en el HTML; las MESAS se generan dinámicamente
    // desde Firestore y reciben su toggle en fetchMesas().
    document.querySelectorAll('.item-card.extra-card').forEach(attachItemToggle);

    // ── MODALES ───────────────────────────────────────────────
    const openQuoteModal = (info = '') => {
        quoteModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        formMessage.textContent = '';
        formMessage.className = 'form-message';
        submitQuoteBtn.disabled = false;
        modalQuoteFor.textContent = info
            ? `Cotización para: ${info}`
            : 'Cotización General de Servicios';
        if (info && !detailsTextarea.value.includes(info)) {
            detailsTextarea.value = `Interesado en: ${info}\n` + detailsTextarea.value;
        }
    };

    const closeQuoteModal = () => {
        quoteModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        quoteForm.reset();
        document.querySelectorAll('.item-card.selected').forEach(c => c.classList.remove('selected'));
    };

    const openWhatsappModal = () => {
        whatsappModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        whatsappMsgStatus.style.display = 'none';
        whatsappForm.reset();
    };

    const closeWhatsappModal = () => {
        whatsappModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    };

    const handleOpenQuote = function () {
        const info = this.dataset.tableName
            ? `Mesa de ${this.dataset.tableName}`
            : this.dataset.dealerName ? `Dealer: ${this.dataset.dealerName}` : '';
        openQuoteModal(info);
    };

    openGeneralQuoteBtn?.addEventListener('click', () => openQuoteModal());
    closeQuoteModalBtn?.addEventListener('click', closeQuoteModal);
    openWhatsappBtn?.addEventListener('click', (e) => { e.preventDefault(); openWhatsappModal(); });
    closeWhatsappBtn?.addEventListener('click', closeWhatsappModal);
    goToQuoteBtn?.addEventListener('click', () => { closeWhatsappModal(); openQuoteModal(); });

    window.addEventListener('click', (e) => {
        if (e.target === quoteModal)    closeQuoteModal();
        if (e.target === whatsappModal) closeWhatsappModal();
    });

    // ── FORMULARIO WHATSAPP ───────────────────────────────────
    whatsappForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = whatsappNameInput.value.trim();
        const msg  = whatsappMsgInput.value.trim();
        let text = 'Hola DealerClub,';
        if (name) text += ` soy ${name}.`;
        text += msg ? ` ${msg}` : ' Me gustaría obtener más información.';
        window.open(`https://wa.me/${WHATSAPP_PHONE_NUMBER}?text=${encodeURIComponent(text)}`, '_blank');
        whatsappMsgStatus.textContent = 'Abriendo WhatsApp…';
        whatsappMsgStatus.className = 'form-message loading';
        whatsappMsgStatus.style.display = 'block';
        setTimeout(() => { closeWhatsappModal(); whatsappMsgStatus.style.display = 'none'; }, 1500);
    });

    // ── FORMULARIO COTIZACIÓN ─────────────────────────────────
    quoteForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        submitQuoteBtn.disabled = true;
        formMessage.textContent = 'Enviando cotización…';
        formMessage.className = 'form-message loading';

        const data = {
            fullName:  document.getElementById('fullName').value,
            email:     document.getElementById('email').value,
            phone:     document.getElementById('phone').value,
            eventType: document.getElementById('eventType').value,
            eventDate: document.getElementById('eventDate').value,
            details:   document.getElementById('details').value,
            timestamp: new Date()
        };
        if (modalQuoteFor.textContent && modalQuoteFor.textContent !== 'Cotización General de Servicios') {
            data.quoteContext = modalQuoteFor.textContent;
        }

        try {
            await addDoc(collection(db, dbPath('service_requests')), data);
            // Opción A: invitar a continuar por WhatsApp (el lead inicia el chat
            // → abre la ventana de 24 h y su pedido llega directo a nuestra bandeja).
            const waText = `Hola DealerClub, soy ${data.fullName || ''}. Acabo de enviar una solicitud de cotización` +
                (data.eventType ? ` para ${data.eventType}` : '') +
                (data.eventDate ? ` (fecha tentativa: ${data.eventDate})` : '') + '.' +
                (data.details ? ` ${data.details}` : '');
            const waUrl = `https://wa.me/${WHATSAPP_PHONE_NUMBER}?text=${encodeURIComponent(waText)}`;
            formMessage.innerHTML = '¡Cotización enviada con éxito! 🎉<br>Para una respuesta más rápida, continúa por WhatsApp:<br>' +
                `<a href="${waUrl}" target="_blank" rel="noopener" class="btn btn-primary" style="margin-top:12px;display:inline-block;">Continuar por WhatsApp</a>`;
            formMessage.className = 'form-message success';
            quoteForm.reset();
            setTimeout(closeQuoteModal, 15000);
        } catch {
            formMessage.textContent = 'Hubo un error al enviar. Inténtalo de nuevo.';
            formMessage.className = 'form-message error';
        } finally {
            submitQuoteBtn.disabled = false;
        }
    });

    // ── MESAS / JUEGOS DEL CASINO ─────────────────────────────
    // Normaliza el estado: cualquier valor que no sea "Próximamente"
    // o "Agotado" se considera "Disponible" (compatibilidad con datos viejos).
    const normalizeStatus = (s) =>
        ['Próximamente', 'Agotado'].includes(s) ? s : 'Disponible';

    const fetchMesas = async () => {
        if (!mesasGrid) return;
        loadingMesas.style.display = 'block';
        mesasGrid.innerHTML = '';
        if (modalMesasGrid) modalMesasGrid.innerHTML = '';
        try {
            const snap = await getDocs(collection(db, dbPath('tables')));
            const mesas = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || (a.name || '').localeCompare(b.name || ''));

            if (mesas.length === 0) {
                loadingMesas.textContent = 'No hay mesas disponibles.';
                if (modalMesasGrid) modalMesasGrid.innerHTML = '<p class="item-name" style="grid-column:1/-1;color:#888;">Pronto añadiremos mesas.</p>';
                return;
            }
            loadingMesas.style.display = 'none';

            mesas.forEach(mesa => {
                const name      = mesa.name || 'Mesa';
                const status    = normalizeStatus(mesa.status);
                const disabled  = status !== 'Disponible';
                const badgeCls  = mesa.tagStyle === 'gold' ? 'badge-gold' : 'badge-popular';
                const badgeHtml = mesa.tag ? `<span class="badge ${badgeCls}">${mesa.tag}</span>` : '';
                const players   = mesa.maxPlayers ? ` · Hasta ${mesa.maxPlayers} jugadores` : '';
                const imageUrl  = mesa.imageUrl || `https://placehold.co/400x200/333333/ffffff?text=${encodeURIComponent(name)}`;

                // ── Tarjeta de la grilla pública ──
                const stateCls = disabled ? (status === 'Agotado' ? 'mesa-out' : 'mesa-soon') : '';
                const btnHtml  = disabled
                    ? `<button type="button" class="btn btn-primary" disabled>${status}</button>`
                    : `<button type="button" class="btn btn-primary open-quote-modal" data-table-name="${name}">Cotizar</button>`;
                const card = document.createElement('div');
                card.className = `mesa-card ${stateCls}`;
                card.innerHTML = `
                    ${badgeHtml}
                    ${disabled ? `<span class="mesa-status-pill">${status}</span>` : ''}
                    <img src="${imageUrl}" alt="${name}"
                         onerror="this.onerror=null;this.src='https://eidk95seyu2.exactdn.com/en/blog/wp-content/uploads/2024/02/BetMGMCasino_Header_Apr01_Craps-Dice-Setting-and-Control-min.jpg?strip=all'">
                    <h3>${name}</h3>
                    <p>${(mesa.description || 'Consulta para más detalles.')}${players}</p>
                    ${btnHtml}
                `;
                mesasGrid.appendChild(card);

                // ── Tarjeta seleccionable del modal "Arma tu Experiencia" ──
                if (modalMesasGrid) {
                    const item = document.createElement('div');
                    item.className = `item-card${disabled ? ' item-disabled' : ''}`;
                    item.dataset.type = 'Mesa';
                    item.dataset.name = name;
                    item.innerHTML = `
                        ${badgeHtml}
                        <span class="item-name">${name}</span>
                        ${disabled ? `<span class="item-status">${status}</span>` : ''}
                    `;
                    attachItemToggle(item);
                    modalMesasGrid.appendChild(item);
                }
            });

            mesasGrid.querySelectorAll('.open-quote-modal').forEach(b => b.addEventListener('click', handleOpenQuote));
        } catch {
            loadingMesas.textContent = 'Error al cargar las mesas.';
            loadingMesas.style.color = '#dc3545';
        }
    };

    // ── DEALERS ───────────────────────────────────────────────
    const fetchDealers = async () => {
        if (!dealersGrid) return;
        loadingDealers.style.display = 'block';
        dealersGrid.innerHTML = '';
        try {
            const snap = await getDocs(collection(db, dbPath('dealers')));
            if (snap.empty) { loadingDealers.textContent = 'No hay dealers disponibles.'; return; }
            loadingDealers.style.display = 'none';
            snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .forEach(dealer => {
                    const imageUrl = dealer.imageUrl || `https://placehold.co/400x300/333333/ffffff?text=${encodeURIComponent(dealer.name || 'Dealer')}`;
                    const card = document.createElement('div');
                    card.className = 'dealer-card';
                    card.innerHTML = `
                        <img src="${imageUrl}" alt="${dealer.name || 'Dealer'}"
                             onerror="this.onerror=null;this.src='https://placehold.co/400x300/333333/ffffff?text=No+Disp.'">
                        <h3>${dealer.name || 'Dealer'}</h3>
                        <p>Especialidad: ${dealer.specialty || 'Varias'}</p>
                        <button type="button" class="btn btn-primary open-quote-modal"
                                data-dealer-name="${dealer.name || 'Dealer'}">
                            Solicitar a ${dealer.name ? dealer.name.split(' ')[0] : 'este Dealer'}
                        </button>
                    `;
                    dealersGrid.appendChild(card);
                });
            document.querySelectorAll('.open-quote-modal').forEach(b => b.addEventListener('click', handleOpenQuote));
        } catch {
            loadingDealers.textContent = 'Error al cargar los dealers.';
            loadingDealers.style.color = '#dc3545';
        }
    };

    fetchMesas();
    fetchDealers();
});
