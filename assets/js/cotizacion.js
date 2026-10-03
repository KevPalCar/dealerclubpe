// ============================================================
// HOJA DE COTIZACIÓN — vista del cliente (/cotizacion?id=…)
// ============================================================
// Lee una cotización por su id (enlace enviado por WhatsApp o
// correo) y la dibuja con el formato de DealerClub. "Descargar
// PDF" usa la impresión del navegador (cabe en una hoja A4).
// ============================================================

import { db, dbPath } from './firebase.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const WHATSAPP = '51929610747';

const $ = (id) => document.getElementById(id);
const money = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (ymd) => ymd
    ? new Date(`${ymd}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';
const todayYmd = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Celda de precio: monto, "Incluido" o "A cotizar".
const priceLabel = (line) =>
    line.price != null ? money(line.price) : line.included ? 'Incluido' : 'A cotizar';

const cell = (text, cls) => {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text ?? '';
    return td;
};

const render = (q) => {
    document.title = `Cotización N.° ${q.number} - DealerClub`;
    $('cz-number').textContent  = q.number || '';
    $('cz-date').textContent    = fmtDate(q.date);
    $('cz-valid').textContent   = fmtDate(q.validUntil);
    $('cz-advisor').textContent = q.advisor || 'DealerClub';

    const expired = q.validUntil && q.validUntil < todayYmd() && q.status !== 'Aceptada';
    $('cz-expired').style.display = expired ? 'block' : 'none';

    // Datos del cliente y del evento (solo los que tienen valor)
    const c = q.client || {}, e = q.event || {};
    const data = [
        ['Cliente / Empresa', c.name],
        [c.type === 'empresa' ? 'RUC' : 'DNI', c.doc],
        ['Tipo de evento', e.type],
        ['Fecha del evento', e.date ? fmtDate(e.date) : ''],
        ['Hora de inicio', e.time],
        ['Distrito', e.district],
        ['Dirección', e.address],
        ['Piso y acceso', e.floor],
        ['N.° aprox. de invitados', e.guests]
    ].filter(([, v]) => v);
    const dl = $('cz-data');
    data.forEach(([k, v]) => {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        dl.append(dt, dd);
    });

    // Tu evento: líneas + ajustes
    const body = $('cz-items');
    (q.items || []).forEach(line => {
        const tr = document.createElement('tr');
        if (line.included) tr.className = 'cz-incl';
        tr.append(cell(line.name, 'cz-name'), cell(line.detail, 'cz-detail'),
                  cell(line.qty || '', 'cz-qty'), cell(priceLabel(line), 'cz-price'));
        body.appendChild(tr);
    });
    (q.adjustments || []).filter(a => a.amount).forEach(a => {
        const tr = document.createElement('tr');
        tr.className = a.amount < 0 ? 'cz-adj cz-discount' : 'cz-adj';
        const name = cell(a.name, 'cz-name');
        name.colSpan = 3;
        tr.append(name, cell(`${a.amount < 0 ? '− ' : '+ '}${money(Math.abs(a.amount))}`, 'cz-price'));
        body.appendChild(tr);
    });

    const t = q.totals || {};
    $('cz-subtotal').textContent = money(t.subtotal);
    $('cz-igv-label').textContent = `IGV (${q.igvRate ?? 18}%)`;
    $('cz-igv').textContent      = money(t.igv);
    $('cz-total').textContent    = money(t.total);
    $('cz-deposit-label').textContent = `Adelanto para reservar (${q.depositPct ?? 30}%)`;
    $('cz-deposit').textContent  = money(t.deposit);
    $('cz-balance').textContent  = money(t.balance);

    // Puedes agregar
    if ((q.addons || []).length) {
        const list = $('cz-addons');
        q.addons.forEach(a => {
            const li = document.createElement('li');
            const name = document.createElement('strong'); name.textContent = a.name;
            const det  = document.createElement('span');   det.textContent  = a.detail || '';
            const pr   = document.createElement('b');      pr.textContent   = a.price != null ? `+ ${money(a.price)}` : 'A cotizar';
            li.append(name, det, pr);
            list.appendChild(li);
        });
        $('cz-addons-wrap').style.display = 'block';
    }

    // Observaciones (una por línea)
    const notes = (q.notes || '').split('\n').map(n => n.trim()).filter(Boolean);
    if (notes.length) {
        notes.forEach(n => { const p = document.createElement('p'); p.textContent = n; $('cz-notes').appendChild(p); });
        $('cz-notes-wrap').style.display = 'block';
    }

    // Acciones
    const msg = `Hola DealerClub, quiero reservar con la cotización N.° ${q.number}` +
                (e.date ? ` para el ${fmtDate(e.date)}` : '') + '.';
    $('cz-accept').href = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`;
    $('cz-print').addEventListener('click', () => window.print());

    $('cz-status').style.display = 'none';
    $('cz-bar').style.display    = 'flex';
    $('cz-sheet').style.display  = 'block';
};

const fail = (text) => { $('cz-status').textContent = text; };

const id = new URLSearchParams(window.location.search).get('id');
if (!id) {
    fail('El enlace de la cotización está incompleto. Pídenos que te lo reenviemos por WhatsApp.');
} else {
    getDoc(doc(db, dbPath(`quotes/${id}`)))
        .then(snap => snap.exists()
            ? render(snap.data())
            : fail('No encontramos esta cotización. Es posible que haya sido reemplazada; escríbenos por WhatsApp.'))
        .catch(() => fail('No se pudo cargar la cotización. Revisa tu conexión e inténtalo de nuevo.'));
}
