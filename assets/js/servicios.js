// ============================================================
// SERVICIOS — DealerClub
// ============================================================
import { auth, db, dbPath } from './firebase.js';
import { HOJA_W, HOJA_H, FICHA_D, FICHAS } from './chip-rain.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    collection, addDoc, getDocs, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Número de fallback. El número real se carga desde Firestore.
// Para actualizar el número oficial, usa el panel admin → Config & Anuncios.
let WHATSAPP_PHONE_NUMBER = '51929610747';

// ── SERVICIOS EXTRA ──────────────────────────────────────────
// Mismos ocho del brochure de Casino de Fantasía, en el mismo orden.
// Para añadir o quitar uno, edita solo esta lista y sube su imagen
// a /assets/images/extras/.
const EXTRAS = [
    { name: 'Barman',                  img: 'extra-barman.webp'     },
    { name: 'Fotos y grabación',       img: 'extra-fotos.webp'      },
    { name: 'Decoración temática',     img: 'extra-decoracion.webp' },
    { name: 'Mesas adicionales',       img: 'extra-mesas.webp'      },
    { name: 'Fichas personalizadas',   img: 'extra-fichas.webp'     },
    { name: 'Sillas / bancas',         img: 'extra-sillas.webp'     },
    { name: 'Horas extra de juego',    img: 'extra-horas.webp'      },
    { name: 'Cobertura fuera de Lima', img: 'extra-cobertura.webp'  }
];

// Lima Metropolitana y Callao. "Fuera de Lima" activa el extra de cobertura.
const DISTRITOS = [
    'Ancón', 'Ate', 'Barranco', 'Breña', 'Carabayllo', 'Cercado de Lima', 'Chaclacayo',
    'Chorrillos', 'Cieneguilla', 'Comas', 'El Agustino', 'Independencia', 'Jesús María',
    'La Molina', 'La Victoria', 'Lince', 'Los Olivos', 'Lurigancho-Chosica', 'Lurín',
    'Magdalena del Mar', 'Miraflores', 'Pachacámac', 'Pueblo Libre', 'Puente Piedra',
    'Punta Hermosa', 'Rímac', 'San Bartolo', 'San Borja', 'San Isidro',
    'San Juan de Lurigancho', 'San Juan de Miraflores', 'San Luis', 'San Martín de Porres',
    'San Miguel', 'Santa Anita', 'Santiago de Surco', 'Surquillo', 'Villa El Salvador',
    'Villa María del Triunfo', 'Callao', 'Fuera de Lima'
];


document.addEventListener('DOMContentLoaded', () => {

    const $  = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];

    // ── REFERENCIAS AL DOM ────────────────────────────────────
    const quoteModal           = $('#quoteModal');
    const quoteSplit           = $('.quote-split');
    const closeQuoteModalBtn   = $('#closeQuoteModalBtn');
    const openGeneralQuoteBtn  = $('#openGeneralQuoteModal');
    const quoteForm            = $('#quoteForm');
    const modalQuoteFor        = $('#modalQuoteFor');
    const submitQuoteBtn       = $('#submitQuoteBtn');
    const formMessage          = $('#formMessage');
    const quoteCount           = $('#quoteCount');
    const quoteDone            = $('#quoteDone');
    const quoteDoneText        = $('#quoteDoneText');
    const quoteWaBtn           = $('#quoteWaBtn');
    const quoteCloseDone       = $('#quoteCloseDone');
    const modalMesasGrid       = $('#modal-mesas-grid');
    const modalExtrasGrid      = $('#modal-extras-grid');
    const districtSel          = $('#district');
    const floorGroup           = $('[data-group="floor"]');
    const floorMore            = $('#floorMore');
    const accessBlock          = $('#accessBlock');
    const quoteRain            = $('#quoteRain');
    const quoteBurst           = $('#quoteBurst');

    const whatsappModal        = $('#whatsappPreChatModal');
    const closeWhatsappBtn     = $('#closeWhatsappModalBtn');
    const openWhatsappBtn      = $('#openWhatsappPreChatModal');
    const whatsappForm         = $('#whatsappPreChatForm');
    const whatsappNameInput    = $('#whatsappName');
    const whatsappMsgInput     = $('#whatsappMessage');
    const goToQuoteBtn         = $('#goToQuoteFormBtn');
    const whatsappMsgStatus    = $('#whatsappMessageStatus');

    const dealersGrid          = $('#dealers-grid-container');
    const loadingDealers       = $('#loading-dealers');
    const mesasGrid            = $('#mesas-grid-container');
    const loadingMesas         = $('#loading-mesas');
    const modalMesasLoading    = $('#modal-mesas-loading');
    const studentAccessLink    = $('#student-access-link');
    const announceBar          = $('#announce-bar');
    const announceText         = $('#announce-text');
    const closeAnnounce        = $('#close-announce-bar');

    // ── CONFIG DESDE FIRESTORE (número de WhatsApp + anuncio) ─
    onSnapshot(doc(db, dbPath('config/announceBar')), (snap) => {
        if (!snap.exists()) { if (announceBar) announceBar.style.display = 'none'; return; }
        const d = snap.data();
        if (d.whatsapp) WHATSAPP_PHONE_NUMBER = d.whatsapp.replace(/\D/g, '');
        if (announceBar && announceText) {
            const txt = d.servicios?.trim();
            announceText.textContent = txt || '';
            announceBar.style.display = txt ? 'flex' : 'none';
        }
    });
    closeAnnounce?.addEventListener('click', () => announceBar.style.display = 'none');

    // ── HEADER: enlace inteligente ────────────────────────────
    if (studentAccessLink) {
        onAuthStateChanged(auth, (user) => {
            studentAccessLink.textContent = user ? 'Mi Campus' : 'Iniciar Sesión';
            studentAccessLink.href = user ? '/panel-estudiante' : '/iniciar-sesion';
        });
    }

    // ══════════════════════════════════════════════════════════
    //  COTIZADOR
    // ══════════════════════════════════════════════════════════
    const state = { eventType: '', floor: '', access: '', guests: '', mesas: [], extras: [] };

    const showErr = (k) => { const e = $(`[data-err="${k}"]`); if (e) e.hidden = false; };
    const hideErr = (k) => { const e = $(`[data-err="${k}"]`); if (e) e.hidden = true; };

    // ── Distritos ─────────────────────────────────────────────
    DISTRITOS.forEach(d => districtSel.add(new Option(d, d)));

    // ── Servicios extra ───────────────────────────────────────
    modalExtrasGrid.innerHTML = EXTRAS.map(e => `
        <button type="button" class="q-extra" aria-pressed="false" data-n="${e.name}">
            <span class="q-tick">✓</span>
            <img class="q-extra-img" src="/assets/images/extras/${e.img}" alt="${e.name}" loading="lazy">
            <span class="q-extra-name">${e.name}</span>
        </button>`).join('');

    // ── Piso / nivel: 0 a 20, clickeable ──────────────────────
    const mkFloor = (label, value, wide) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'q-floor' + (wide ? ' wide' : '');
        b.setAttribute('aria-pressed', 'false');
        if (value) b.dataset.v = value;
        b.textContent = label;
        return b;
    };
    floorGroup.append(mkFloor('A nivel de calle', 'A nivel de calle', true));
    for (let i = 1; i <= 6; i++) floorGroup.append(mkFloor(String(i), 'Piso ' + i));
    const moreBtn = mkFloor('7 al 20 ▾', null, true);
    floorGroup.append(moreBtn);
    for (let i = 7; i <= 20; i++) floorMore.append(mkFloor(String(i), 'Piso ' + i));

    // El bloque de acceso solo existe para quien no está a nivel de calle:
    // es lo que define la línea "Traslado y acceso" de la cotización.
    const onFloorChange = () => {
        const arriba = state.floor && state.floor !== 'A nivel de calle';
        accessBlock.hidden = !arriba;
        if (!arriba) {
            state.access = '';
            $$('[data-group="access"] .q-chip').forEach(b => b.setAttribute('aria-pressed', 'false'));
            hideErr('access');
        }
    };

    // ── Grupos de opción única (chips y pisos) ────────────────
    $$('[data-group]').forEach(group => {
        const key = group.dataset.group;
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('button[aria-pressed]');
            if (!btn || !group.contains(btn)) return;
            if (btn === moreBtn) {
                floorMore.hidden = !floorMore.hidden;
                moreBtn.textContent = floorMore.hidden ? '7 al 20 ▾' : '7 al 20 ▴';
                return;
            }
            $$('[aria-pressed]', group).forEach(b => b.setAttribute('aria-pressed', 'false'));
            if (key === 'floor') $$('[aria-pressed]', floorMore).forEach(b => b.setAttribute('aria-pressed', 'false'));
            btn.setAttribute('aria-pressed', 'true');
            state[key] = btn.dataset.v || btn.textContent.trim();
            hideErr(key);
            if (key === 'floor') onFloorChange();
        });
    });

    // Los pisos 7-20 viven fuera del grupo principal.
    floorMore.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        $$('[aria-pressed]', floorGroup).forEach(b => b.setAttribute('aria-pressed', 'false'));
        $$('[aria-pressed]', floorMore).forEach(b => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        moreBtn.setAttribute('aria-pressed', 'true');
        state.floor = btn.dataset.v;
        hideErr('floor');
        onFloorChange();
    });

    // ── Selección múltiple: mesas y extras ────────────────────
    const attachMulti = (grid, key) => {
        grid.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-n]');
            if (!btn || btn.disabled) return;
            const on = btn.getAttribute('aria-pressed') === 'true';
            btn.setAttribute('aria-pressed', String(!on));
            state[key] = $$('[aria-pressed="true"]', grid).map(b => b.dataset.n);
            if (!on) lanzarFichas(btn);
            updateCount();
        });
    };
    attachMulti(modalMesasGrid, 'mesas');
    attachMulti(modalExtrasGrid, 'extras');

    function updateCount() {
        const m = state.mesas.length, x = state.extras.length;
        if (!m && !x) { quoteCount.textContent = 'Aún no has elegido mesas ni extras.'; return; }
        const partes = [];
        if (m) partes.push(`<b>${m}</b> ${m === 1 ? 'mesa' : 'mesas'}`);
        if (x) partes.push(`<b>${x}</b> ${x === 1 ? 'extra' : 'extras'}`);
        quoteCount.innerHTML = 'Has elegido ' + partes.join(' y ') + '.';
    }

    // ── Validación ────────────────────────────────────────────
    ['fullName', 'phone', 'eventDate', 'eventTime', 'district'].forEach(id =>
        $('#' + id).addEventListener('input', () => hideErr(id)));
    districtSel.addEventListener('change', () => hideErr('district'));

    function validate() {
        const bad = [];
        if ($('#fullName').value.trim().split(/\s+/).filter(Boolean).length < 2) bad.push('fullName');
        if ($('#phone').value.replace(/\D/g, '').length < 9) bad.push('phone');
        if (!state.eventType)        bad.push('eventType');
        if (!$('#eventDate').value)  bad.push('eventDate');
        if (!$('#eventTime').value)  bad.push('eventTime');
        if (!districtSel.value)      bad.push('district');
        if (!state.floor)            bad.push('floor');
        if (!accessBlock.hidden && !state.access) bad.push('access');
        bad.forEach(showErr);
        return bad;
    }

    // ── Mensaje para el asesor, en el orden de la plantilla ───
    const fmtFecha = (v) => { if (!v) return ''; const [y, m, d] = v.split('-'); return `${d}/${m}/${y}`; };

    function buildResumen() {
        const L = ['NUEVA SOLICITUD DE COTIZACIÓN', '', 'DATOS DEL CLIENTE'];
        L.push('Cliente / empresa: ' + $('#fullName').value.trim());
        L.push('WhatsApp: ' + $('#phone').value.trim());
        if ($('#email').value.trim())   L.push('Correo: ' + $('#email').value.trim());
        if ($('#receipt').value)        L.push('Comprobante: ' + $('#receipt').value);
        L.push('', 'DATOS DEL EVENTO');
        L.push('Tipo de evento: ' + state.eventType);
        L.push('Fecha del evento: ' + fmtFecha($('#eventDate').value));
        L.push('Horario (inicio): ' + $('#eventTime').value);
        L.push('Distrito / lugar: ' + districtSel.value);
        L.push('Piso / nivel: ' + state.floor + (state.access ? ' — ' + state.access.toLowerCase() : ''));
        L.push('N.º aprox. invitados: ' + (state.guests || 'por confirmar'));
        L.push('', 'SERVICIOS SOLICITADOS');
        L.push('Mesas: ' + (state.mesas.join(', ') || 'por definir con el asesor'));
        L.push('Adicionales: ' + (state.extras.join(', ') || 'ninguno'));
        if ($('#notes').value.trim()) L.push('', 'OBSERVACIONES', $('#notes').value.trim());
        return L.join('\n');
    }

    // ── Envío ─────────────────────────────────────────────────
    quoteForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const bad = validate();
        if (bad.length) {
            submitQuoteBtn.classList.remove('q-shake');
            void submitQuoteBtn.offsetWidth;
            submitQuoteBtn.classList.add('q-shake');
            $(`[data-err="${bad[0]}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        submitQuoteBtn.disabled = true;
        formMessage.textContent = 'Enviando solicitud…';
        formMessage.className = 'form-message loading';

        const resumen = buildResumen();
        const data = {
            fullName:  $('#fullName').value.trim(),
            phone:     $('#phone').value.trim(),
            email:     $('#email').value.trim(),
            receipt:   $('#receipt').value,
            eventType: state.eventType,
            eventDate: $('#eventDate').value,
            eventTime: $('#eventTime').value,
            district:  districtSel.value,
            floor:     state.floor,
            access:    state.access,
            guests:    state.guests,
            tables:    state.mesas,
            extras:    state.extras,
            notes:     $('#notes').value.trim(),
            details:   resumen,          // compatibilidad con el panel admin
            timestamp: new Date()
        };
        if (modalQuoteFor.textContent) data.quoteContext = modalQuoteFor.textContent;

        try {
            await addDoc(collection(db, dbPath('service_requests')), data);

            // El lead inicia el chat → abre la ventana de 24 h y su pedido
            // llega a nuestra bandeja ya ordenado como la plantilla.
            quoteWaBtn.href = `https://wa.me/${WHATSAPP_PHONE_NUMBER}?text=${encodeURIComponent(resumen)}`;
            quoteDoneText.textContent =
                `Gracias, ${data.fullName.split(/\s+/)[0]}. Un asesor prepara tu cotización a medida. ` +
                'Para una respuesta más rápida, continúa por WhatsApp.';
            formMessage.textContent = '';
            formMessage.className = 'form-message';
            quoteDone.hidden = false;
            cascadaFichas();
        } catch {
            formMessage.textContent = 'Hubo un error al enviar. Inténtalo de nuevo.';
            formMessage.className = 'form-message error';
        } finally {
            submitQuoteBtn.disabled = false;
        }
    });

    // ── Abrir / cerrar ────────────────────────────────────────
    const openQuoteModal = (info = '') => {
        quoteModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        formMessage.textContent = '';
        formMessage.className = 'form-message';
        submitQuoteBtn.disabled = false;
        quoteDone.hidden = true;

        if (info) {
            modalQuoteFor.textContent = info;
            modalQuoteFor.style.display = 'block';
        } else {
            modalQuoteFor.textContent = '';
            modalQuoteFor.style.display = 'none';
        }
        medirCapas();
    };

    const closeQuoteModal = () => {
        quoteModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        quoteForm.reset();
        quoteDone.hidden = true;
        Object.assign(state, { eventType: '', floor: '', access: '', guests: '', mesas: [], extras: [] });
        $$('#quoteModal [aria-pressed="true"]').forEach(b => b.setAttribute('aria-pressed', 'false'));
        $$('#quoteModal .q-err').forEach(e => e.hidden = true);
        accessBlock.hidden = true;
        floorMore.hidden = true;
        moreBtn.textContent = '7 al 20 ▾';
        updateCount();
    };

    // Preselecciona la mesa desde la que se abrió el cotizador.
    const preseleccionarMesa = (nombre) => {
        const card = $$('.q-card', modalMesasGrid).find(c => c.dataset.n === nombre);
        if (card && !card.disabled && card.getAttribute('aria-pressed') !== 'true') {
            card.setAttribute('aria-pressed', 'true');
            state.mesas = $$('[aria-pressed="true"]', modalMesasGrid).map(b => b.dataset.n);
            updateCount();
        }
    };

    const handleOpenQuote = function () {
        const mesa   = this.dataset.tableName;
        const dealer = this.dataset.dealerName;
        openQuoteModal(mesa ? `Cotización para: Mesa de ${mesa}` : dealer ? `Cotización para: Dealer ${dealer}` : '');
        if (mesa) preseleccionarMesa(mesa);
    };

    openGeneralQuoteBtn?.addEventListener('click', () => openQuoteModal());
    closeQuoteModalBtn?.addEventListener('click', closeQuoteModal);
    quoteCloseDone?.addEventListener('click', closeQuoteModal);
    quoteModal.addEventListener('mousedown', (e) => { if (e.target === quoteModal) closeQuoteModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && quoteModal.style.display === 'flex') closeQuoteModal();
    });

    // ══════════════════════════════════════════════════════════
    //  LLUVIA 3D DE FICHAS DEALERCLUB
    //  Cada ficha es un elemento dentro de una capa con perspectiva:
    //  rota en los tres ejes y se pone de canto, como un disco real.
    // ══════════════════════════════════════════════════════════
    const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let RW = 0, RH = 0, BW = 0, BH = 0;
    const lluvia = [], volando = [];

    function medirCapas() {
        if (!quoteRain) return;
        const r = quoteRain.getBoundingClientRect(), b = quoteBurst.getBoundingClientRect();
        RW = r.width; RH = r.height; BW = b.width; BH = b.height;
    }
    window.addEventListener('resize', () => { if (quoteModal.style.display === 'flex') medirCapas(); });

    function crearFicha(capa, x, y, d) {
        const f = FICHAS[(Math.random() * FICHAS.length) | 0], k = d / FICHA_D;
        const el = document.createElement('i');
        el.className = 'q-ficha';
        el.style.width = el.style.height = d + 'px';
        el.style.backgroundSize = `${(HOJA_W * k).toFixed(1)}px ${(HOJA_H * k).toFixed(1)}px`;
        el.style.backgroundPosition = `${(-f.x * k).toFixed(1)}px ${(-f.y * k).toFixed(1)}px`;
        capa.append(el);
        return {
            el, x, y, d, vy: 0, vx: 0,
            rx: Math.random() * 360, ry: Math.random() * 360, rz: Math.random() * 360,
            vrx: (Math.random() - .5) * 1.6,
            vry: .5 + Math.random() * 1.5,
            vrz: (Math.random() - .5) * 1.2,
            z: -160 + Math.random() * 260
        };
    }

    const colocar = (p) => {
        p.el.style.transform =
            `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,${p.z.toFixed(0)}px) ` +
            `rotateX(${p.rx.toFixed(1)}deg) rotateY(${p.ry.toFixed(1)}deg) rotateZ(${p.rz.toFixed(1)}deg)`;
    };

    function animar() {
        requestAnimationFrame(animar);
        if (quoteModal.style.display !== 'flex' || !RH) return;

        const objetivo = RW < 420 ? 14 : 24;
        while (lluvia.length < objetivo) {
            const d = 30 + Math.random() * 30;
            // Repartidas por toda la altura: se ven en cuanto se abre el cotizador.
            const p = crearFicha(quoteRain, Math.random() * Math.max(1, RW - d), Math.random() * (RH + d) - d, d);
            p.vy = .35 + Math.random() * .75;
            p.vx = (Math.random() - .5) * .25;
            p.el.style.opacity = (.26 + Math.random() * .2).toFixed(2);
            lluvia.push(p);
        }

        for (const p of lluvia) {
            p.y += p.vy; p.x += p.vx;
            p.rx += p.vrx; p.ry += p.vry; p.rz += p.vrz;
            if (p.y > RH + p.d) { p.y = -p.d * 1.6; p.x = Math.random() * Math.max(1, RW - p.d); }
            if (p.x < -p.d) p.x = RW; else if (p.x > RW) p.x = -p.d;
            colocar(p);
        }

        for (let i = volando.length - 1; i >= 0; i--) {
            const p = volando[i];
            p.vy += .42; p.y += p.vy; p.x += p.vx;
            p.rx += p.vrx; p.ry += p.vry; p.rz += p.vrz;
            colocar(p);
            if (p.y > BH + 90) { p.el.remove(); volando.splice(i, 1); }
        }
    }
    if (!sinMovimiento) animar();

    // Golpe corto de fichas desde la tarjeta recién elegida.
    function lanzarFichas(target) {
        if (sinMovimiento || quoteModal.style.display !== 'flex') return;
        medirCapas();
        const b = quoteBurst.getBoundingClientRect(), r = target.getBoundingClientRect();
        const cx = r.left + r.width / 2 - b.left, cy = r.top + r.height / 2 - b.top;
        for (let i = 0; i < 7; i++) {
            const d = 22 + Math.random() * 16;
            const p = crearFicha(quoteBurst, cx - d / 2, cy - d / 2, d);
            p.vy = -5 - Math.random() * 4.5;
            p.vx = (Math.random() - .5) * 9;
            p.vry = 4 + Math.random() * 7;
            p.vrx = (Math.random() - .5) * 9;
            volando.push(p);
        }
    }

    // El momento grande: la cascada al enviar la solicitud.
    function cascadaFichas() {
        if (sinMovimiento) return;
        medirCapas();
        let n = 0;
        const id = setInterval(() => {
            for (let i = 0; i < 3; i++) {
                const d = 30 + Math.random() * 26;
                const p = crearFicha(quoteBurst, Math.random() * Math.max(1, BW - d), -d - 20, d);
                p.vy = 1 + Math.random() * 2;
                p.vx = (Math.random() - .5) * 1.6;
                p.vry = 2 + Math.random() * 4;
                volando.push(p);
            }
            if (++n > 18) clearInterval(id);
        }, 80);
    }

    // ══════════════════════════════════════════════════════════
    //  MODAL DE WHATSAPP (consulta rápida)
    // ══════════════════════════════════════════════════════════
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

    openWhatsappBtn?.addEventListener('click', (e) => { e.preventDefault(); openWhatsappModal(); });
    closeWhatsappBtn?.addEventListener('click', closeWhatsappModal);
    goToQuoteBtn?.addEventListener('click', () => { closeWhatsappModal(); openQuoteModal(); });
    window.addEventListener('click', (e) => { if (e.target === whatsappModal) closeWhatsappModal(); });

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

    // ══════════════════════════════════════════════════════════
    //  MESAS / JUEGOS (Firestore)
    // ══════════════════════════════════════════════════════════
    // Cualquier estado que no sea "Próximamente" o "Agotado" cuenta
    // como "Disponible" (compatibilidad con datos antiguos).
    const normalizeStatus = (s) =>
        ['Próximamente', 'Agotado'].includes(s) ? s : 'Disponible';

    const fetchMesas = async () => {
        if (!mesasGrid && !modalMesasGrid) return;
        if (loadingMesas) loadingMesas.style.display = 'block';
        if (mesasGrid) mesasGrid.innerHTML = '';

        try {
            const snap = await getDocs(collection(db, dbPath('tables')));
            const mesas = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || (a.name || '').localeCompare(b.name || ''));

            if (!mesas.length) {
                if (loadingMesas) loadingMesas.textContent = 'No hay mesas disponibles.';
                if (modalMesasLoading) modalMesasLoading.textContent = 'Pronto añadiremos mesas.';
                return;
            }
            if (loadingMesas) loadingMesas.style.display = 'none';
            if (modalMesasLoading) modalMesasLoading.remove();

            const tarjetasModal = [];

            mesas.forEach(mesa => {
                const name     = mesa.name || 'Mesa';
                const status   = normalizeStatus(mesa.status);
                const disabled = status !== 'Disponible';
                const badgeCls = mesa.tagStyle === 'gold' ? 'badge-gold' : 'badge-popular';
                const players  = mesa.maxPlayers ? `Hasta ${mesa.maxPlayers} jugadores` : 'Consulta detalles';
                const imageUrl = mesa.imageUrl || `https://placehold.co/400x200/333333/ffffff?text=${encodeURIComponent(name)}`;

                // ── Tarjeta de la grilla pública ──
                if (mesasGrid) {
                    const stateCls = disabled ? (status === 'Agotado' ? 'mesa-out' : 'mesa-soon') : '';
                    const btnHtml  = disabled
                        ? `<button type="button" class="btn btn-primary" disabled>${status}</button>`
                        : `<button type="button" class="btn btn-primary open-quote-modal" data-table-name="${name}">Cotizar</button>`;
                    const card = document.createElement('div');
                    card.className = `mesa-card ${stateCls}`;
                    card.innerHTML = `
                        ${mesa.tag ? `<span class="badge ${badgeCls}">${mesa.tag}</span>` : ''}
                        ${disabled ? `<span class="mesa-status-pill">${status}</span>` : ''}
                        <img src="${imageUrl}" alt="${name}" loading="lazy"
                             onerror="this.onerror=null;this.src='https://placehold.co/400x200/333333/ffffff?text=DealerClub'">
                        <h3>${name}</h3>
                        <p>${(mesa.description || 'Consulta para más detalles.')}</p>
                        ${btnHtml}
                    `;
                    mesasGrid.appendChild(card);
                }

                // ── Tarjeta seleccionable del cotizador ──
                // La etiqueta va en su propia franja: nunca tapa el nombre.
                tarjetasModal.push(`
                    <button type="button" class="q-card${disabled ? ' off' : ''}"
                            aria-pressed="false" data-n="${name}"${disabled ? ' disabled' : ''}>
                        ${disabled ? `<span class="q-pill">${status}</span>` : '<span class="q-tick">✓</span>'}
                        <img class="q-card-img" src="${imageUrl}" alt="" loading="lazy"
                             onerror="this.onerror=null;this.src='https://placehold.co/300x130/1a1a1a/ffc107?text=DealerClub'">
                        ${mesa.tag ? `<span class="q-tag${mesa.tagStyle === 'gold' ? ' gold' : ''}">${mesa.tag}</span>` : ''}
                        <span class="q-card-body">
                            <span class="q-card-name">${name}</span>
                            <span class="q-card-meta">${players}</span>
                        </span>
                    </button>`);
            });

            if (modalMesasGrid) modalMesasGrid.innerHTML = tarjetasModal.join('');
            mesasGrid?.querySelectorAll('.open-quote-modal')
                .forEach(b => b.addEventListener('click', handleOpenQuote));

        } catch {
            if (loadingMesas) {
                loadingMesas.textContent = 'Error al cargar las mesas.';
                loadingMesas.style.color = '#dc3545';
            }
            if (modalMesasLoading) modalMesasLoading.textContent = 'No pudimos cargar las mesas.';
        }
    };

    // ══════════════════════════════════════════════════════════
    //  DEALERS DESTACADOS
    // ══════════════════════════════════════════════════════════
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
                        <img src="${imageUrl}" alt="${dealer.name || 'Dealer'}" loading="lazy"
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
            dealersGrid.querySelectorAll('.open-quote-modal')
                .forEach(b => b.addEventListener('click', handleOpenQuote));
        } catch {
            loadingDealers.textContent = 'Error al cargar los dealers.';
            loadingDealers.style.color = '#dc3545';
        }
    };

    updateCount();
    fetchMesas();
    fetchDealers();
});
