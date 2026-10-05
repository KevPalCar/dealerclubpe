// ============================================================
// REFERIDOS — registro y ranking de quién trae alumnos
// ============================================================

import { db, dbPath } from '../firebase.js';
import { collection, addDoc, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { showToast, showMsg, confirmDelete, deleteItem, registerSection, unsubscribeListeners } from './core.js';

// ══════════════════════════════════════════════════════════
// REFERIDOS & MARKETING
// ══════════════════════════════════════════════════════════
let _refRows  = [];
let _refNames = {};   // código → nombre del referidor

const renderReferralsSummary = () => {
    const tbody = document.getElementById('referrals-summary-body');
    const groups = {};
    _refRows.forEach(r => {
        const k = r.referrerCode || '—';
        groups[k] = groups[k] || { count: 0, total: 0 };
        groups[k].count++;
        groups[k].total += (+r.amount || 0);
    });
    const keys = Object.keys(groups).sort((a, b) => groups[b].count - groups[a].count);
    tbody.innerHTML = keys.length
        ? keys.map(k => `
            <tr>
                <td><code style="color:#ffc107;">${k}</code></td>
                <td>${_refNames[k] || '—'}</td>
                <td>${groups[k].count}</td>
                <td>S/ ${groups[k].total.toFixed(2)}</td>
            </tr>`).join('')
        : `<tr><td colspan="4" class="empty-msg">Aún no hay referidos registrados.</td></tr>`;
};

const renderReferralsList = () => {
    const tbody = document.getElementById('referrals-list-body');
    if (!_refRows.length) { tbody.innerHTML = `<tr><td colspan="5" class="empty-msg">Sin registros.</td></tr>`; return; }
    tbody.innerHTML = '';
    [..._refRows].sort((a, b) => (b.date?.seconds ?? 0) - (a.date?.seconds ?? 0)).forEach(r => {
        const tr = tbody.insertRow();
        const dateStr = r.date ? new Date(r.date.seconds * 1000).toLocaleDateString('es-PE') : '-';
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td><code style="color:#ffc107;">${r.referrerCode || '—'}</code></td>
            <td>${r.newStudentName || '—'}</td>
            <td>S/ ${(+r.amount || 0).toFixed(2)}</td>
            <td class="action-buttons"><button class="btn btn-danger btn-sm btn-del-ref" data-id="${r.id}"><i class="fas fa-trash"></i></button></td>`;
        tr.querySelector('.btn-del-ref').addEventListener('click', () =>
            confirmDelete('¿Eliminar este referido?', () => deleteItem('referrals', r.id)));
    });
};

const loadReferrals = async () => {
    _refNames = {};
    try {
        const es = await getDocs(collection(db, dbPath('course_enrollments')));
        es.forEach(d => { const e = d.data(); if (e.studentCode) _refNames[e.studentCode] = e.fullName; });
    } catch { /* ignora */ }
    unsubscribeListeners.referrals = onSnapshot(collection(db, dbPath('referrals')), (snap) => {
        _refRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderReferralsSummary();
        renderReferralsList();
    });
};

document.getElementById('referralForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('referralFormMessage');
    const referrerCode   = document.getElementById('refReferrerCode').value.trim().toUpperCase();
    const newStudentName = document.getElementById('refNewStudent').value.trim();
    const amount         = parseFloat(document.getElementById('refAmount').value) || 0;
    if (!referrerCode || !newStudentName) { showMsg(msg, 'Completa el código y el nombre.', 'error'); return; }
    showMsg(msg, 'Guardando…', 'loading');
    try {
        await addDoc(collection(db, dbPath('referrals')), { referrerCode, newStudentName, amount, date: new Date() });
        document.getElementById('referralForm').reset();
        showMsg(msg, 'Referido registrado.', 'success');
        showToast('Referido registrado.', 'success');
        setTimeout(() => showMsg(msg, '', ''), 2500);
    } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
});

registerSection('referrals', { title: 'Referidos & Marketing', load: loadReferrals });
