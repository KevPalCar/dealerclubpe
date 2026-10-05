// ============================================================
// COTIZACIONES — solicitudes de la web, editor, tarifario e historial
// ============================================================

import { db, dbPath } from '../firebase.js';
import { toYmd, fromYmd, fmtDate } from '../billing.js';
import { collection, addDoc, setDoc, doc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { esc, showToast, pState, renderPaged, openModal, closeModal, showMsg, confirmDelete, deleteItem, numOrNull, registerSection, registerSearch, unsubscribeListeners } from './core.js';

// ══════════════════════════════════════════════════════════
// COTIZACIONES — SOLICITUDES RECIBIDAS
// ══════════════════════════════════════════════════════════
const REQUEST_STATUSES = ['Nuevo', 'Respondido', 'Cerrado'];

// Correo oficial de la empresa (cuenta desde la que se responde)
const COMPANY_EMAIL = 'dealerclubpe@gmail.com';

// Abre la ventana de redacción de Gmail directamente en la cuenta de la
// empresa, con destinatario, asunto y cuerpo autollenados con los datos de
// la solicitud. Si esa cuenta no está logueada en el navegador, Gmail
// pedirá iniciar sesión (queda garantizado que se responde desde la empresa).
const buildGmailCompose = (r) => {
    const subject = `DealerClub — Respuesta a tu solicitud${r.quoteContext ? ` (${r.quoteContext})` : ''}`;
    const body =
        `Hola ${r.fullName || ''},\n\n` +
        `Gracias por tu interés en nuestro Casino de Fantasía. Sobre tu solicitud:\n` +
        (r.eventType ? `• Tipo de evento: ${r.eventType}\n` : '') +
        (r.eventDate ? `• Fecha del evento: ${r.eventDate}\n` : '') +
        (r.details   ? `• Detalle: ${r.details}\n`           : '') +
        `\n[Escribe aquí tu respuesta]\n\nSaludos cordiales,\nEquipo DealerClub`;
    const params = new URLSearchParams({ view: 'cm', fs: '1', to: r.email || '', su: subject, body });
    return `https://mail.google.com/mail/?authuser=${encodeURIComponent(COMPANY_EMAIL)}&${params.toString()}`;
};
// URL del panel de atención de WhatsApp (bandeja de la empresa).
const WA_PANEL_URL = 'https://dealerclubpe.web.app/';
// Construye un enlace al PANEL (no al WhatsApp personal): abre el chat de ese
// número y autollena un mensaje con los datos de la solicitud, listo para enviar
// desde el número de la empresa.
const buildWa = (r) => {
    const phone = (r.phone || '').replace(/\D/g, '');
    if (!phone) return '';
    const text = `Hola ${r.fullName || ''}, te escribo de DealerClub 👋 sobre tu solicitud` +
        (r.eventType ? ` de ${r.eventType}` : '') +
        (r.eventDate ? ` (fecha tentativa: ${r.eventDate})` : '') + '.';
    return `${WA_PANEL_URL}?to=${phone}&msg=${encodeURIComponent(text)}`;
};
// Registra que se tomó acción (marca como 'Respondido' si seguía 'Nuevo')
const markRequestResponded = async (r) => {
    if ((r.status || 'Nuevo') === 'Nuevo') {
        try { await updateDoc(doc(db, dbPath(`service_requests/${r.id}`)), { status: 'Respondido', respondedAt: new Date() }); }
        catch { /* ignora */ }
    }
};

const openRequestDetail = (r) => {
    const date = r.timestamp ? new Date(r.timestamp.seconds * 1000).toLocaleString('es-PE') : '-';
    document.getElementById('requestDetailBody').innerHTML = `
        <p><strong>Nombre:</strong> ${esc(r.fullName) || '-'}</p>
        <p><strong>Email:</strong> <a href="mailto:${esc(r.email)}">${esc(r.email) || '-'}</a></p>
        <p><strong>Teléfono:</strong> ${esc(r.phone) || '-'}</p>
        <p><strong>Tipo de evento:</strong> ${esc(r.eventType) || '-'}</p>
        <p><strong>Fecha del evento:</strong> ${esc(r.eventDate) || '-'}</p>
        ${r.quoteContext ? `<p><strong>Contexto:</strong> ${esc(r.quoteContext)}</p>` : ''}
        <p><strong>Recibido:</strong> ${date}</p>
        <p><strong>Estado:</strong> ${esc(r.status) || 'Nuevo'}</p>
        <p><strong>Detalle / Mensaje:</strong></p>
        <pre class="request-detail-msg">${esc(r.details || r.message) || '-'}</pre>
    `;
    const mailBtn = document.getElementById('requestDetailMail');
    const waBtn   = document.getElementById('requestDetailWa');
    mailBtn.href = buildGmailCompose(r);
    mailBtn.target = '_blank';
    mailBtn.rel = 'noopener';
    mailBtn.onclick = () => markRequestResponded(r);
    const wa = buildWa(r);
    if (wa) { waBtn.style.display = ''; waBtn.href = wa; waBtn.onclick = () => markRequestResponded(r); }
    else    { waBtn.style.display = 'none'; }
    openModal(document.getElementById('requestDetailModal'));
};
document.getElementById('closeRequestDetailBtn').addEventListener('click', () =>
    closeModal(document.getElementById('requestDetailModal'))
);

const renderRequestRow = (r) => {
    const tbody  = document.getElementById('requests-table-body');
    const tr     = tbody.insertRow();
    const status = r.status || 'Nuevo';
    const dateStr = r.timestamp ? new Date(r.timestamp.seconds * 1000).toLocaleDateString('es-PE') : '-';
    tr.innerHTML = `
        <td>${dateStr}</td>
        <td>${esc(r.fullName) || '-'}</td><td>${esc(r.email) || '-'}</td>
        <td>${esc(r.eventType || r.subject || r.quoteContext) || '-'}</td>
        <td>
            <select class="status-select req-status" data-id="${r.id}">
                ${REQUEST_STATUSES.map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
        </td>
        <td class="action-buttons">
            <button class="btn btn-sm btn-approve btn-req-quote" title="Crear cotización"><i class="fas fa-file-invoice-dollar"></i> Cotizar</button>
            <button class="btn btn-secondary btn-sm btn-req-view" title="Ver detalle"><i class="fas fa-eye"></i></button>
            <button class="btn btn-secondary btn-sm btn-req-mail" title="Responder por correo"><i class="fas fa-envelope"></i></button>
            <button class="btn btn-secondary btn-sm btn-req-wa" title="Responder por WhatsApp" ${r.phone ? '' : 'disabled'}><i class="fab fa-whatsapp"></i></button>
            <button class="btn btn-danger btn-sm btn-delete" title="Eliminar"><i class="fas fa-trash"></i></button>
        </td>
    `;
    tr.querySelector('.req-status').addEventListener('change', async (e) => {
        await updateDoc(doc(db, dbPath(`service_requests/${e.target.dataset.id}`)), { status: e.target.value });
        showToast('Estado de la solicitud actualizado.', 'success');
    });
    tr.querySelector('.btn-req-quote').addEventListener('click', () => openQuoteEditor(quoteFromRequest(r)));
    tr.querySelector('.btn-req-view').addEventListener('click', () => openRequestDetail(r));
    tr.querySelector('.btn-req-mail').addEventListener('click', () => { window.open(buildGmailCompose(r), '_blank'); markRequestResponded(r); });
    tr.querySelector('.btn-req-wa').addEventListener('click', () => { const u = buildWa(r); if (u) { window.open(u, '_blank'); markRequestResponded(r); } });
    tr.querySelector('.btn-delete').addEventListener('click', () =>
        confirmDelete('¿Eliminar esta solicitud?', () => deleteItem('service_requests', r.id))
    );
};

// Filtros por estado y rango de fechas (se combinan con la búsqueda de texto)
let _requestsRaw = [];
const applyRequestFilters = () => {
    const status = document.getElementById('filter-request-status')?.value || '';
    const from   = document.getElementById('filter-request-from')?.value || '';
    const to     = document.getElementById('filter-request-to')?.value || '';
    let data = [..._requestsRaw];
    if (status) data = data.filter(r => (r.status || 'Nuevo') === status);
    if (from)   { const f = new Date(`${from}T00:00:00`).getTime() / 1000; data = data.filter(r => (r.timestamp?.seconds ?? 0) >= f); }
    if (to)     { const t = new Date(`${to}T23:59:59`).getTime() / 1000;   data = data.filter(r => (r.timestamp?.seconds ?? 0) <= t); }
    if (pState.requests) { pState.requests.data = data; pState.requests.page = 1; }
    renderPaged('requests', renderRequestRow, 'No hay solicitudes que coincidan.');
};

['filter-request-status', 'filter-request-from', 'filter-request-to'].forEach(id =>
    document.getElementById(id)?.addEventListener('change', applyRequestFilters));
document.getElementById('clear-request-filters')?.addEventListener('click', () => {
    document.getElementById('filter-request-status').value = '';
    document.getElementById('filter-request-from').value   = '';
    document.getElementById('filter-request-to').value     = '';
    const search = document.getElementById('search-requests');
    if (search) search.value = '';
    if (pState.requests) pState.requests.term = '';
    applyRequestFilters();
});

const loadRequests = () => {
    document.getElementById('requests-table-body').innerHTML =
        `<tr><td colspan="6" class="spinner-cell"><div class="spinner"></div></td></tr>`;
    unsubscribeListeners.requests = onSnapshot(collection(db, dbPath('service_requests')), (snap) => {
        _requestsRaw = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0));
        applyRequestFilters();
    });
    loadQuotes();
};


// ══════════════════════════════════════════════════════════
// COTIZACIONES DE EVENTOS — tarifario, editor e historial
// Una cotización tiene dos bloques: "Tu evento" (lo que se cobra)
// y "Puedes agregar" (otros juegos y extras, solo informativo).
// El cliente la abre en /cotizacion?id=… y la descarga en PDF.
// ══════════════════════════════════════════════════════════
const SITE_URL = 'https://dealerclubpe.com';
const QUOTE_STATUSES = ['Borrador', 'Enviada', 'Aceptada', 'Rechazada'];
const TARIFF_KINDS = [['mesa', 'Mesa'], ['incluido', 'Incluido'], ['extra', 'Extra']];
const DEFAULT_QUOTE_SETTINGS = {
    advisor: 'Kevin', validityDays: 4, depositPct: 30, igvRate: 18, extraHour: 150,
    notes: 'Beneficio por confirmación rápida: si confirma su reserva dentro de las 48 h siguientes a esta cotización, se incluye el trofeo "The Chip Leader" para el ganador.\n' +
           'Si el acceso es solo por escaleras, se coordina un ajuste en "Traslado y acceso".',
    // Textos de la hoja que ve el cliente (editables en el Tarifario).
    tagline: 'Casino de Fantasía · EL JUEGO a otro nivel',
    balanceLabel: 'Saldo, antes de iniciar el montaje',
    payment: 'Transferencia bancaria a la cuenta de la empresa (se emite boleta o factura).\n' +
             'Interbank Soles: 200-3008147025 · CCI: 003-200-003008147025-31\n' +
             'Titular: DEALERCLUB E.I.R.L. · RUC 20615317315',
    legal: 'El cliente es responsable por daños, pérdida o deterioro del equipo durante el evento. ' +
           'Una vez abonado el adelanto no se realizan devoluciones.',
    footer: 'WhatsApp +51 929 610 747 · www.dealerclubpe.com\n' +
            'Lima Metropolitana · 09:00–18:00\n' +
            'IG dealerclubpe · TikTok @dealerclubpe · FB dealerclubperu',
    items: [
        { kind: 'mesa', name: 'Mesa de Ruleta Profesional', detail: 'Disco profesional premium · 7 a 10 posturas, con accesorios.', price: 1300 },
        { kind: 'mesa', name: 'Mesa en "D" Profesional',    detail: "Blackjack (7 posturas) o Ultimate Texas Hold'em (6 posturas), con accesorios.", price: 800 },
        { kind: 'mesa', name: 'Mesa óvalo Profesional',     detail: 'Póker (10 posturas) o Baccarat (9 posturas), con accesorios.', price: 1000 },
        { kind: 'incluido', name: 'Dealers uniformados',             detail: 'Un dealer profesional por mesa.', price: null },
        { kind: 'incluido', name: 'Dirección del propio DealerClub', detail: 'Presente en cada evento, desde una sola mesa.', price: null },
        { kind: 'incluido', name: 'Fichas, montaje y desmontaje',             detail: 'Fichas y artefactos de casino; armado y retiro de todo el equipo.', price: null },
        { kind: 'incluido', name: '3 h de evento · 2 h 30 de juego efectivo', detail: 'El montaje y el desmontaje no descuentan tiempo.', price: null },
        { kind: 'incluido', name: 'Traslado en Lima Metropolitana',           detail: 'Con acceso a nivel de calle o por ascensor.', price: null },
        { kind: 'extra', name: 'Sillas / taburetes',     detail: 'Las mesas no incluyen sillas.', price: null },
        { kind: 'extra', name: 'Hora extra de juego',    detail: 'Por mesa y por hora.', price: 150 },
        { kind: 'extra', name: 'Fichas personalizadas',  detail: 'Con el logo o motivo de su evento.', price: null },
        { kind: 'extra', name: 'Barman / mesero',        detail: '', price: null },
        { kind: 'extra', name: 'Fotos y grabación',      detail: '', price: null },
        { kind: 'extra', name: 'Decoración temática',    detail: '', price: null },
        { kind: 'extra', name: 'Cobertura fuera de Lima', detail: '', price: null }
    ]
};
let _qs     = DEFAULT_QUOTE_SETTINGS;   // tarifario vigente
let _quotes = [];
let qEdit   = null;                     // cotización abierta en el editor

const money  = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// Suma N días hábiles (sin sábados ni domingos) a una fecha YYYY-MM-DD.
const addBusinessDays = (ymd, n) => {
    const d = fromYmd(ymd);
    while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
    return toYmd(d);
};

// Subtotal = líneas con precio + ajustes. Adelanto redondeado a decenas.
// Todo en soles enteros: sin céntimos. Adelanto redondeado a decenas.
const quoteTotals = (q) => {
    const subtotal = (q.items || []).reduce((s, i) => s + (i.price || 0), 0)
                   + (q.adjustments || []).reduce((s, a) => s + (a.amount || 0), 0);
    const igv     = Math.round(subtotal * (q.igvRate ?? 18) / 100);
    const total   = subtotal + igv;
    const deposit = Math.ceil(total * (q.depositPct ?? 30) / 100 / 10) * 10;
    return { subtotal, igv, total, deposit, balance: total - deposit };
};

// Campo que solo admite números enteros: sin decimales, signos ni texto.
const intInput = (value, placeholder = '') => {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.className = 'qe-num';
    input.placeholder = placeholder;
    input.value = value ?? '';
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); });
    return input;
};

// ── Filas editables genéricas (líneas, ajustes, tarifario) ─
// cols: [{ key, type: 'text' | 'number' | 'select', placeholder, options }]
const renderRows = (boxId, rows, cols, layout, onChange, emptyMsg) => {
    const box = document.getElementById(boxId);
    box.innerHTML = rows.length ? '' : `<p class="qe-empty">${emptyMsg}</p>`;
    rows.forEach((row, idx) => {
        const el = document.createElement('div');
        el.className = `qe-row ${layout}`;
        cols.forEach(col => {
            let input;
            if (col.type === 'select') {
                input = document.createElement('select');
                col.options.forEach(([v, l]) => input.add(new Option(l, v, false, row[col.key] === v)));
            } else if (col.type === 'number') {
                input = intInput(row[col.key], col.placeholder);
            } else {
                input = document.createElement('input');
                input.type = 'text';
                input.placeholder = col.placeholder || '';
                input.value = row[col.key] ?? '';
            }
            input.addEventListener('input', () => {
                row[col.key] = col.type === 'number' ? numOrNull(input.value) : input.value;
                onChange();
            });
            el.appendChild(input);
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'qe-del';
        del.title = 'Quitar';
        del.innerHTML = '<i class="fas fa-times"></i>';
        del.addEventListener('click', () => {
            rows.splice(idx, 1);
            renderRows(boxId, rows, cols, layout, onChange, emptyMsg);
            onChange();
        });
        el.appendChild(del);
        box.appendChild(el);
    });
};

// ── Editor: lista fija del tarifario ──────────────────────
// No se agregan ni quitan filas: cada mesa y cada extra del tarifario
// tiene su fila y solo se escribe la cantidad. Lo que queda en cero
// pasa solo al bloque "Puedes agregar" de la hoja.
const AUTO_DISCOUNT = 'Descuento por más de una mesa (10 %)';
const ADJ_ROWS = [
    { name: 'Fecha de alta demanda',            sign:  1 },
    { name: 'Servicio express (menos de 48 h)', sign:  1 },
    { name: 'Traslado y acceso',                sign:  1 },
    { name: 'Tarifa corporativa',               sign:  1 },
    { name: AUTO_DISCOUNT,                      sign: -1 },
    { name: 'Descuento especial',               sign: -1 }
];
// Juegos posibles de cada mesa (paños intercambiables).
const gamesOf = (mesaName) =>
    /ruleta/i.test(mesaName)        ? []
    : /"d"|en d\b/i.test(mesaName)  ? ['Blackjack', "Ultimate Texas Hold'em"]
    : /[oó]valo/i.test(mesaName)    ? ['Póker', 'Baccarat']
    : null;   // mesa nueva del tarifario: juego en texto libre
// "Dealers" se cuenta por mesa; la dirección de DealerClub solo se incluye o no.
const isPerMesa = (name) => /dealer/i.test(name) && !/direcci[oó]n/i.test(name);

const tariffForm = () => ({
    mesas:    _qs.items.filter(i => i.kind === 'mesa').map(i => ({ name: i.name, detail: i.detail, game: '', qty: 0, unit: i.price })),
    includes: _qs.items.filter(i => i.kind === 'incluido').map(i => ({ name: i.name, detail: i.detail, on: true })),
    extras:   _qs.items.filter(i => i.kind === 'extra').map(i => ({ name: i.name, detail: i.detail, qty: 0, unit: i.price })),
    other:    { name: '', qty: 1, unit: null },
    adj:      ADJ_ROWS.map(a => ({ ...a, amount: null })),
    autoDiscount: false,
    showAddons:   true
});

const totalMesas = (f) => f.mesas.reduce((s, m) => s + (m.qty || 0), 0);
// 10 % de la mesa de menor precio, cuando se llevan dos o más.
const autoDiscountAmount = (f) => {
    const units = f.mesas.flatMap(m => Array(m.qty || 0).fill(m.unit || 0)).sort((a, b) => a - b);
    return units.length >= 2 ? Math.round(units[0] * 0.10) : 0;
};
const lineAmount = (x) => (x.unit != null ? (x.qty || 0) * x.unit : null);

// Del formulario a lo que se guarda y ve el cliente.
const deriveQuote = (f) => {
    const n = totalMesas(f);
    const line = (x, detail) => ({ name: x.name, detail, qty: x.qty, unit: x.unit, price: lineAmount(x), included: false });
    const items = [
        ...f.mesas.filter(m => m.qty > 0).map(m => line(m, m.game ? `Juego: ${m.game}` : m.detail)),
        ...f.includes.filter(i => i.on).map(i => ({
            name: i.name, detail: i.detail, qty: isPerMesa(i.name) ? n : null, unit: null, price: null, included: true })),
        ...f.extras.filter(x => x.qty > 0).map(x => line(x, x.detail)),
        ...(f.other.name.trim() ? [line({ ...f.other, name: f.other.name.trim(), qty: f.other.qty || 1 }, '')] : [])
    ];
    const adjustments = f.adj
        .map(a => ({ name: a.name, amount: a.sign * (a.name === AUTO_DISCOUNT && f.autoDiscount ? autoDiscountAmount(f) : (a.amount || 0)) }))
        .filter(a => a.amount);
    const addons = f.showAddons
        ? [...f.mesas.filter(m => !m.qty), ...f.extras.filter(x => !x.qty)].map(x => ({ name: x.name, detail: x.detail, price: x.unit }))
        : [];
    return { items, adjustments, addons };
};

// Lo que depende de otros campos (importes, dealers, descuento, totales)
// se refresca sin redibujar las filas, para no perder el cursor.
let qRefreshers = [];
const refreshQuote = () => {
    qRefreshers.forEach(fn => fn());
    const f = qEdit.form;
    const t = quoteTotals({ ...deriveQuote(f), igvRate: qEdit.igvRate, depositPct: qEdit.depositPct });
    document.getElementById('quoteTotals').innerHTML = `
        <div><span>Subtotal</span><b>${money(t.subtotal)}</b></div>
        <div><span>IGV ${qEdit.igvRate}%</span><b>${money(t.igv)}</b></div>
        <div class="qe-total"><span>Total</span><b>${money(t.total)}</b></div>
        <div><span>Adelanto ${qEdit.depositPct}%</span><b>${money(t.deposit)}</b></div>
        <div><span>Saldo al llegar</span><b>${money(t.balance)}</b></div>`;
};

const intOrNull = (v) => (v === '' ? null : parseInt(v, 10));
const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
};

// Fila "cantidad · nombre · [juego] · precio unitario · importe"
const quoteLine = (x, { extra = false, nameInput = false } = {}) => {
    const row = el('div', `qe-line${extra ? ' qe-line-extra' : ''}`);
    const qty = intInput(x.qty || '', '0');
    qty.classList.add('qe-qty');
    qty.addEventListener('input', () => { x.qty = intOrNull(qty.value) || 0; refreshQuote(); });
    row.appendChild(qty);

    if (nameInput) {
        const name = document.createElement('input');
        name.type = 'text';
        name.placeholder = 'Otro concepto (opcional)';
        name.value = x.name;
        name.addEventListener('input', () => { x.name = name.value; refreshQuote(); });
        row.appendChild(name);
    } else {
        const name = el('span', 'qe-name', x.name);
        name.title = x.detail || x.name;
        row.appendChild(name);
    }

    if (!extra) {
        const games = gamesOf(x.name);
        if (games === null) {
            const game = document.createElement('input');
            game.type = 'text';
            game.placeholder = 'Juego';
            game.value = x.game;
            game.addEventListener('input', () => { x.game = game.value; });
            row.appendChild(game);
        } else if (games.length) {
            const game = document.createElement('select');
            game.add(new Option('Juego por definir', ''));
            games.forEach(g => game.add(new Option(g, g, false, x.game === g)));
            game.addEventListener('change', () => { x.game = game.value; });
            row.appendChild(game);
        } else {
            row.appendChild(el('span', 'qe-amount muted', '—'));
        }
    }

    const unit = intInput(x.unit, extra ? 'A cotizar' : 'S/');
    unit.addEventListener('input', () => { x.unit = intOrNull(unit.value); refreshQuote(); });
    row.appendChild(unit);

    const amount = el('span', 'qe-amount');
    row.appendChild(amount);
    qRefreshers.push(() => {
        const on = nameInput ? !!x.name.trim() : x.qty > 0;
        row.classList.toggle('on', on);
        const a = lineAmount(nameInput ? { ...x, qty: x.qty || 1 } : x);
        amount.textContent = !on ? '—' : a != null ? money(a) : 'A cotizar';
        amount.classList.toggle('muted', !on);
    });
    return row;
};

const renderQuoteForm = () => {
    const f = qEdit.form;
    qRefreshers = [];

    const mesas = document.getElementById('quoteMesas');
    mesas.replaceChildren(...f.mesas.map(m => quoteLine(m)));

    // Incluye: casillas; los dealers muestran cuántos van (uno por mesa)
    const inc = document.getElementById('quoteIncludes');
    inc.replaceChildren(...f.includes.map(i => {
        const chip  = el('label', 'qe-chip');
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = i.on;
        const text = el('span');
        check.addEventListener('change', () => { i.on = check.checked; refreshQuote(); });
        chip.append(check, text);
        qRefreshers.push(() => {
            chip.classList.toggle('on', i.on);
            text.textContent = isPerMesa(i.name) ? `${i.name} (${totalMesas(f)})` : i.name;
        });
        return chip;
    }));

    const extras = document.getElementById('quoteExtras');
    extras.replaceChildren(
        ...f.extras.map(x => quoteLine(x, { extra: true })),
        quoteLine(f.other, { extra: true, nameInput: true }));

    // Recargos (+) y descuentos (−): se escribe el monto en positivo
    const adj = document.getElementById('quoteAdj');
    adj.replaceChildren(...f.adj.map(a => {
        const row   = el('div', `qe-adj ${a.sign > 0 ? 'plus' : 'minus'}`);
        const label = el('span', '', a.name);
        const input = intInput(a.amount, 'S/');
        input.addEventListener('input', () => { a.amount = intOrNull(input.value); refreshQuote(); });
        if (a.name === AUTO_DISCOUNT) {
            const auto  = el('label', 'qe-auto');
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.checked = f.autoDiscount;
            check.addEventListener('change', () => { f.autoDiscount = check.checked; refreshQuote(); });
            auto.append(check, 'calcular');
            label.appendChild(auto);
            qRefreshers.push(() => {
                input.disabled = f.autoDiscount;
                if (f.autoDiscount) input.value = autoDiscountAmount(f) || '';
            });
        }
        row.append(label, input);
        return row;
    }));

    const show = document.getElementById('quoteShowAddons');
    show.checked = f.showAddons;
    show.onchange = () => { f.showAddons = show.checked; };

    refreshQuote();
};

const nextQuoteNumber = () => {
    const year = new Date().getFullYear();
    const last = Math.max(0, ..._quotes
        .map(q => new RegExp(`^${year}-(\\d+)$`).exec(q.number || ''))
        .filter(Boolean).map(m => +m[1]));
    return `${year}-${String(last + 1).padStart(3, '0')}`;
};

const blankQuote = () => {
    const today = toYmd(new Date());
    return {
        id: null, requestId: null, status: 'Borrador',
        number: nextQuoteNumber(), date: today, validUntil: addBusinessDays(today, _qs.validityDays),
        advisor: _qs.advisor, igvRate: _qs.igvRate, depositPct: _qs.depositPct, extraHour: _qs.extraHour,
        client: { name: '', type: 'persona', doc: '', phone: '', email: '' },
        event:  { type: '', date: '', time: '', district: '', address: '', floor: '', guests: '' },
        form: tariffForm(), notes: _qs.notes
    };
};

// A partir de una solicitud de la web: datos del cliente y mesas pedidas.
const quoteFromRequest = (r) => {
    const q = blankQuote();
    q.requestId = r.id;
    q.client = { name: r.fullName || '', type: /factura/i.test(r.receipt || '') ? 'empresa' : 'persona', doc: '', phone: r.phone || '', email: r.email || '' };
    q.event  = {
        type: r.eventType || '', date: r.eventDate || '', time: r.eventTime || '', district: r.district || '', address: '',
        floor: [r.floor, r.access].filter(Boolean).join(' · '), guests: r.guests || ''
    };
    // Cada juego pedido marca su mesa (cantidad 1) y, si es el primero, su juego.
    (r.tables || []).forEach(game => {
        const g = String(game).toLowerCase();
        const mesa = q.form.mesas.find(m =>
            /ruleta/.test(g)                        ? /ruleta/i.test(m.name)
            : /black|ultimate|texas|uth/.test(g)    ? /"d"|en d\b/i.test(m.name)
            : /p[oó]ker|poker|baccarat|bacar/.test(g) ? /[oó]valo/i.test(m.name)
            : false);
        if (!mesa) return;
        mesa.qty = 1;
        if (!mesa.game) mesa.game = (gamesOf(mesa.name) || []).find(x => g.includes(x.toLowerCase().slice(0, 5))) || '';
    });
    // Los extras que pidió quedan con cantidad 1 (precio por definir si no lo tiene).
    (r.extras || []).forEach(x => {
        const key   = String(x).toLowerCase().slice(0, 6);
        const extra = q.form.extras.find(e => e.name.toLowerCase().includes(key));
        if (extra) extra.qty = 1;
    });
    return q;
};

// Cotizaciones guardadas antes de la lista fija: se reconstruye el formulario por nombre.
const formFromLegacy = (q) => {
    const f = tariffForm();
    (q.items || []).forEach(it => {
        const row = [...f.mesas, ...f.extras].find(x => x.name === it.name);
        if (row) { row.qty = it.qty || 1; if (it.price != null) row.unit = Math.round(it.price / row.qty); }
    });
    f.includes.forEach(i => { i.on = (q.items || []).some(it => it.name === i.name); });
    (q.adjustments || []).forEach(a => {
        const row = f.adj.find(x => x.name === a.name);
        if (row) row.amount = Math.abs(a.amount);
    });
    return f;
};

const openQuoteEditor = (q) => {
    qEdit = JSON.parse(JSON.stringify(q));   // copia: cancelar no altera el historial
    if (!qEdit.form) qEdit.form = formFromLegacy(qEdit);
    const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
    set('quoteNumber', qEdit.number);        set('quoteDate', qEdit.date);
    set('quoteValidUntil', qEdit.validUntil); set('quoteStatus', qEdit.status);
    set('quoteClientName', qEdit.client.name);   set('quoteClientType', qEdit.client.type);
    set('quoteClientDoc', qEdit.client.doc);     set('quoteClientPhone', qEdit.client.phone);
    set('quoteClientEmail', qEdit.client.email);
    set('quoteEventType', qEdit.event.type);     set('quoteEventDate', qEdit.event.date);
    set('quoteEventTime', qEdit.event.time);     set('quoteEventDistrict', qEdit.event.district);
    set('quoteEventAddress', qEdit.event.address); set('quoteEventFloor', qEdit.event.floor);
    set('quoteEventGuests', qEdit.event.guests);
    set('quoteNotes', qEdit.notes);
    renderQuoteForm();
    showMsg(document.getElementById('quoteFormMessage'), '', '');
    openModal(document.getElementById('quoteModal'));
};

// Lee el formulario, guarda y devuelve la cotización (o null si falta algo).
const saveQuote = async () => {
    const msg = document.getElementById('quoteFormMessage');
    const val = (id) => document.getElementById(id).value.trim();
    if (!val('quoteClientName')) { showMsg(msg, 'Escribe el nombre del cliente.', 'error'); return null; }
    if (!totalMesas(qEdit.form)) { showMsg(msg, 'Indica la cantidad de al menos una mesa.', 'error'); return null; }

    const data = {
        number: val('quoteNumber'), date: val('quoteDate'), validUntil: val('quoteValidUntil'),
        status: val('quoteStatus'), advisor: qEdit.advisor,
        igvRate: qEdit.igvRate, depositPct: qEdit.depositPct, extraHour: qEdit.extraHour,
        requestId: qEdit.requestId || null,
        client: { name: val('quoteClientName'), type: val('quoteClientType'), doc: val('quoteClientDoc'),
                  phone: val('quoteClientPhone'), email: val('quoteClientEmail') },
        event:  { type: val('quoteEventType'), date: val('quoteEventDate'), time: val('quoteEventTime'),
                  district: val('quoteEventDistrict'), address: val('quoteEventAddress'),
                  floor: val('quoteEventFloor'), guests: val('quoteEventGuests') },
        form: qEdit.form,
        ...deriveQuote(qEdit.form),
        // Copia de los textos de la plantilla: la hoja pública no lee el tarifario.
        texts: { tagline: _qs.tagline, balanceLabel: _qs.balanceLabel, payment: _qs.payment, legal: _qs.legal, footer: _qs.footer },
        notes: val('quoteNotes'),
        updatedAt: new Date()
    };
    data.totals = quoteTotals(data);
    try {
        if (qEdit.id) {
            await updateDoc(doc(db, dbPath(`quotes/${qEdit.id}`)), data);
        } else {
            const ref = await addDoc(collection(db, dbPath('quotes')), { ...data, createdAt: new Date() });
            qEdit.id = ref.id;
        }
        Object.assign(qEdit, data);
        showMsg(msg, 'Cotización guardada.', 'success');
        return qEdit;
    } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); return null; }
};

const quoteUrl = (q) => `${SITE_URL}/cotizacion?id=${q.id}`;
const quoteMessage = (q) =>
    `Hola ${q.client.name}, te comparto tu cotización N.° ${q.number} de Casino de Fantasía (DealerClub):\n${quoteUrl(q)}\n\n` +
    `Total: ${money(q.totals.total)} (incluye IGV). Para reservar tu fecha, el adelanto es de ${money(q.totals.deposit)}.\n` +
    `Válida hasta el ${fmtDate(q.validUntil)}. Quedo atento a cualquier consulta.`;

// Marca como enviada (si seguía en borrador) y la solicitud de origen como respondida.
const markQuoteSent = async (q) => {
    try {
        if (q.status === 'Borrador') {
            await updateDoc(doc(db, dbPath(`quotes/${q.id}`)), { status: 'Enviada', sentAt: new Date() });
            q.status = 'Enviada';
            if (qEdit && qEdit.id === q.id) document.getElementById('quoteStatus').value = 'Enviada';
        }
        if (q.requestId) {
            await updateDoc(doc(db, dbPath(`service_requests/${q.requestId}`)), { status: 'Respondido', respondedAt: new Date() });
        }
    } catch { /* el envío ya se abrió; el estado se puede corregir a mano */ }
};

// La ventana se abre en el mismo clic (si no, el navegador la bloquea)
// y recibe la dirección cuando la cotización ya está guardada.
const withSavedQuote = async (buildUrl, { markSent = false } = {}) => {
    const win = window.open('', '_blank');
    const q = await saveQuote();
    const url = q && buildUrl(q);
    if (!url) { win?.close(); return; }
    if (win) win.location = url; else window.location = url;
    if (markSent) markQuoteSent(q);
};
const quoteWaUrl = (q) => {
    const phone = (q.client.phone || '').replace(/\D/g, '');
    if (!phone) { showMsg(document.getElementById('quoteFormMessage'), 'Falta el WhatsApp del cliente.', 'error'); return ''; }
    return `${WA_PANEL_URL}?to=${phone.length === 9 ? `51${phone}` : phone}&msg=${encodeURIComponent(quoteMessage(q))}`;
};
const quoteMailUrl = (q) => {
    if (!q.client.email) { showMsg(document.getElementById('quoteFormMessage'), 'Falta el correo del cliente.', 'error'); return ''; }
    const params = new URLSearchParams({
        view: 'cm', fs: '1', to: q.client.email,
        su: `Cotización N.° ${q.number} — Casino de Fantasía DealerClub`,
        body: `${quoteMessage(q)}\n\nSaludos cordiales,\n${q.advisor || 'Equipo DealerClub'}\nDealerClub`
    });
    return `https://mail.google.com/mail/?authuser=${encodeURIComponent(COMPANY_EMAIL)}&${params.toString()}`;
};

document.getElementById('quoteForm').addEventListener('submit', (e) => { e.preventDefault(); saveQuote(); });
document.getElementById('quoteViewBtn').addEventListener('click', () => withSavedQuote(quoteUrl));
document.getElementById('quoteWaBtn').addEventListener('click', () => withSavedQuote(quoteWaUrl, { markSent: true }));
document.getElementById('quoteMailBtn').addEventListener('click', () => withSavedQuote(quoteMailUrl, { markSent: true }));
document.getElementById('closeQuoteModalBtn').addEventListener('click', () => closeModal(document.getElementById('quoteModal')));
document.getElementById('new-quote-btn').addEventListener('click', () => openQuoteEditor(blankQuote()));

// ── Historial ─────────────────────────────────────────────
const renderQuoteRow = (q) => {
    const tr      = document.getElementById('quotes-table-body').insertRow();
    const expired = q.status === 'Enviada' && q.validUntil && q.validUntil < toYmd(new Date());
    tr.innerHTML = `
        <td><strong>${esc(q.number)}</strong></td>
        <td>${fmtDate(q.date)}</td>
        <td>${esc(q.client?.name)}<span class="student-sub">${esc(q.client?.phone)}</span></td>
        <td>${esc(q.event?.type) || '-'}<span class="student-sub">${q.event?.date ? fmtDate(q.event.date) : ''}${q.event?.district ? ` · ${esc(q.event.district)}` : ''}</span></td>
        <td><strong>${money(q.totals?.total)}</strong></td>
        <td>
            <select class="status-select quote-status">
                ${QUOTE_STATUSES.map(s => `<option ${q.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
            ${expired ? '<span class="student-sub" style="color:#f1a7ae;">Vencida</span>' : ''}
        </td>
        <td class="action-buttons">
            <button class="btn btn-secondary btn-sm q-edit" title="Editar"><i class="fas fa-edit"></i></button>
            <button class="btn btn-secondary btn-sm q-view" title="Ver hoja"><i class="fas fa-eye"></i></button>
            <button class="btn btn-secondary btn-sm q-copy" title="Duplicar como nueva"><i class="fas fa-copy"></i></button>
            <button class="btn btn-danger btn-sm q-del" title="Eliminar"><i class="fas fa-trash"></i></button>
        </td>`;
    tr.querySelector('.quote-status').addEventListener('change', async (e) => {
        await updateDoc(doc(db, dbPath(`quotes/${q.id}`)), { status: e.target.value });
        showToast('Estado de la cotización actualizado.', 'success');
    });
    tr.querySelector('.q-edit').addEventListener('click', () => openQuoteEditor(q));
    tr.querySelector('.q-view').addEventListener('click', () => window.open(quoteUrl(q), '_blank'));
    tr.querySelector('.q-copy').addEventListener('click', () => {
        const today = toYmd(new Date());
        openQuoteEditor({ ...q, id: null, status: 'Borrador', number: nextQuoteNumber(),
                          date: today, validUntil: addBusinessDays(today, _qs.validityDays) });
    });
    tr.querySelector('.q-del').addEventListener('click', () =>
        confirmDelete(`¿Eliminar la cotización N.° ${q.number} de "${q.client?.name || ''}"? Su enlace dejará de funcionar.`,
            () => deleteItem('quotes', q.id)));
};
const renderQuotesSummary = () => {
    const sum = (list) => list.reduce((s, q) => s + (q.totals?.total || 0), 0);
    const sent     = _quotes.filter(q => q.status !== 'Borrador');
    const accepted = _quotes.filter(q => q.status === 'Aceptada');
    document.getElementById('quotes-summary').innerHTML =
        `Cotizado: <b>${money(sum(sent))}</b> en ${sent.length} · Aceptado: <b>${money(sum(accepted))}</b> en ${accepted.length}`;
    document.getElementById('quotes-tab-count').textContent = `(${_quotes.length})`;
};

document.querySelectorAll('#quote-tabs .student-tab').forEach(btn =>
    btn.addEventListener('click', () => {
        document.querySelectorAll('#quote-tabs .student-tab').forEach(b => b.classList.toggle('active', b === btn));
        document.getElementById('requests-view').style.display = btn.dataset.view === 'requests' ? 'block' : 'none';
        document.getElementById('quotes-view').style.display   = btn.dataset.view === 'quotes'   ? 'block' : 'none';
    }));

const loadQuotes = () => {
    unsubscribeListeners.quotes = onSnapshot(collection(db, dbPath('quotes')), (snap) => {
        _quotes = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.number || '').localeCompare(a.number || ''));
        pState.quotes.data = _quotes;
        renderPaged('quotes', renderQuoteRow, 'Aún no has emitido cotizaciones.');
        renderQuotesSummary();
    });
    unsubscribeListeners.quoteSettings = onSnapshot(doc(db, dbPath('quote_settings/main')), (snap) => {
        _qs = snap.exists() ? { ...DEFAULT_QUOTE_SETTINGS, ...snap.data() } : DEFAULT_QUOTE_SETTINGS;
        // Tarifarios guardados antes de separar dealers y dirección
        _qs.items = _qs.items.flatMap(i => /dealer.*direcci[oó]n/i.test(i.name)
            ? DEFAULT_QUOTE_SETTINGS.items.filter(d => /^Dealers uniformados|^Dirección del propio/.test(d.name))
            : [i]);
    });
};

// ── Tarifario ─────────────────────────────────────────────
let tEdit = null;
const TARIFF_COLS = [
    { key: 'kind',   type: 'select', options: TARIFF_KINDS },
    { key: 'name',   type: 'text',   placeholder: 'Nombre' },
    { key: 'detail', type: 'text',   placeholder: 'Detalle' },
    { key: 'price',  type: 'number', placeholder: 'S/' }
];
const renderTariffRows = () =>
    renderRows('tariffItems', tEdit.items, TARIFF_COLS, 'cols-tariff', () => {}, 'El tarifario está vacío.');

document.getElementById('open-tariff-btn').addEventListener('click', () => {
    tEdit = JSON.parse(JSON.stringify(_qs));
    document.getElementById('tariffAdvisor').value   = tEdit.advisor;
    document.getElementById('tariffValidity').value  = tEdit.validityDays;
    document.getElementById('tariffDeposit').value   = tEdit.depositPct;
    document.getElementById('tariffIgv').value       = tEdit.igvRate;
    document.getElementById('tariffExtraHour').value = tEdit.extraHour;
    document.getElementById('tariffNotes').value     = tEdit.notes;
    document.getElementById('tariffPayment').value   = tEdit.payment;
    document.getElementById('tariffLegal').value     = tEdit.legal;
    document.getElementById('tariffFooter').value    = tEdit.footer;
    document.getElementById('tariffTagline').value   = tEdit.tagline;
    document.getElementById('tariffBalance').value   = tEdit.balanceLabel;
    renderTariffRows();
    showMsg(document.getElementById('tariffFormMessage'), '', '');
    openModal(document.getElementById('tariffModal'));
});
document.getElementById('tariffAddItem').addEventListener('click', () => {
    tEdit.items.push({ kind: 'extra', name: '', detail: '', price: null });
    renderTariffRows();
});
document.getElementById('tariffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('tariffFormMessage');
    const num = (id, fallback) => numOrNull(document.getElementById(id).value) ?? fallback;
    try {
        await setDoc(doc(db, dbPath('quote_settings/main')), {
            items:        tEdit.items.filter(i => (i.name || '').trim()),
            advisor:      document.getElementById('tariffAdvisor').value.trim(),
            validityDays: num('tariffValidity', 4),
            depositPct:   num('tariffDeposit', 30),
            igvRate:      num('tariffIgv', 18),
            extraHour:    num('tariffExtraHour', 150),
            notes:        document.getElementById('tariffNotes').value.trim(),
            payment:      document.getElementById('tariffPayment').value.trim(),
            legal:        document.getElementById('tariffLegal').value.trim(),
            footer:       document.getElementById('tariffFooter').value.trim(),
            tagline:      document.getElementById('tariffTagline').value.trim(),
            balanceLabel: document.getElementById('tariffBalance').value.trim(),
            updatedAt:    new Date()
        });
        closeModal(document.getElementById('tariffModal'));
        showToast('Tarifario guardado. Se aplicará a las cotizaciones nuevas.', 'success');
    } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
});
document.getElementById('closeTariffModalBtn').addEventListener('click', () => closeModal(document.getElementById('tariffModal')));

registerSection('requests', { title: 'Cotizaciones de eventos', load: loadRequests, row: renderRequestRow, empty: 'No hay solicitudes.' });
registerSearch('quotes', renderQuoteRow, 'Aún no has emitido cotizaciones.');
