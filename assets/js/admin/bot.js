// ============================================================
// BOT DE WHATSAPP — mensaje activador, notas e informes de chats
// ============================================================

import { auth, db, dbPath } from '../firebase.js';
import { collection, setDoc, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { esc, showToast, showMsg, numOrNull, registerSection, unsubscribeListeners } from './core.js';

// ══════════════════════════════════════════════════════════
// BOT DE WHATSAPP — seguimiento, notas aprendidas e informes
// El bot (Cloud Functions) lee bot_settings/main y guarda sus
// informes semanales en bot_insights. Aquí Kevin los revisa y
// decide qué sugerencia pasa a las notas: el bot no se cambia solo.
// ══════════════════════════════════════════════════════════
const BOT_DEFAULTS = { enabled: false, hours: 3, from: 9, to: 20 };
let botLoaded = false;

const saveBotSettings = async () => {
    const num = (id, fallback) => numOrNull(document.getElementById(id).value) ?? fallback;
    await setDoc(doc(db, dbPath('bot_settings/main')), {
        notes: document.getElementById('botNotes').value.trim(),
        followUp: {
            enabled: document.getElementById('botFollowEnabled').checked,
            hours:   num('botFollowHours', BOT_DEFAULTS.hours),
            from:    num('botFollowFrom', BOT_DEFAULTS.from),
            to:      num('botFollowTo', BOT_DEFAULTS.to)
        },
        updatedAt: new Date()
    }, { merge: true });
};

document.getElementById('botSettingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('botSettingsMessage');
    try {
        await saveBotSettings();
        showMsg(msg, 'Guardado. El bot lo aplica en un minuto.', 'success');
    } catch (err) { showMsg(msg, `Error: ${err.message}`, 'error'); }
});

const FUNNEL_LABELS = [
    ['conversaciones', 'conversaciones'], ['recibieronCatalogo', 'recibieron el catálogo'],
    ['respondieronTrasCatalogo', 'siguieron tras el catálogo'], ['quedaronEnSilencio', 'quedaron en silencio'],
    ['conSeguimiento', 'con seguimiento'], ['derivadosAHumano', 'derivados a ti']
];
const INSIGHT_LISTS = [
    ['dondeSePierden', 'Dónde se pierden'], ['objeciones', 'Objeciones'],
    ['preguntasFrecuentes', 'Preguntas frecuentes'], ['erroresDelBot', 'Fallos del bot']
];

const renderInsights = (list) => {
    const box = document.getElementById('bot-insights');
    if (!list.length) {
        box.innerHTML = '<p style="color:#888;">Aún no hay informes. El primero llega el lunes, o pulsa "Analizar chats ahora".</p>';
        return;
    }
    box.innerHTML = '';
    list.forEach(r => {
        const card = document.createElement('div');
        card.className = 'insight';
        const date = r.createdAt ? new Date(r.createdAt.seconds * 1000).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        card.innerHTML = `
            <div class="insight-head"><b>${date}</b><span>Últimos ${r.days || 7} días</span></div>
            <div class="insight-funnel">${FUNNEL_LABELS.map(([k, l]) => `<span><b>${r.embudo?.[k] ?? 0}</b>${l}</span>`).join('')}</div>
            <p>${esc(r.resumen)}</p>
            ${INSIGHT_LISTS.filter(([k]) => (r[k] || []).length).map(([k, title]) =>
                `<h4>${title}</h4><ul>${r[k].map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}
            ${(r.sugerencias || []).length ? '<h4>Sugerencias para el bot</h4><div class="insight-sug"></div>' : ''}`;
        const sugBox = card.querySelector('.insight-sug');
        (r.sugerencias || []).forEach(sg => {
            const row = document.createElement('div');
            row.className = 'insight-suggestion';
            row.innerHTML = `<div><strong>${esc(sg.titulo)}</strong><span>${esc(sg.nota)}</span></div>
                             <button type="button" class="btn btn-secondary btn-sm"><i class="fas fa-plus"></i> A las notas</button>`;
            row.querySelector('button').addEventListener('click', async (evt) => {
                const notes = document.getElementById('botNotes');
                if (notes.value.includes(sg.nota)) { showToast('Esa nota ya está en el bot.', 'info'); return; }
                notes.value = `${notes.value.trim()}${notes.value.trim() ? '\n' : ''}- ${sg.nota}`;
                try {
                    await saveBotSettings();
                    evt.currentTarget.disabled = true;
                    showToast('Nota agregada al bot.', 'success');
                } catch (err) { showToast(`Error: ${esc(err.message)}`, 'error'); }
            });
            sugBox.appendChild(row);
        });
        box.appendChild(card);
    });
};

document.getElementById('bot-analyze-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    showToast('Analizando los chats de los últimos 7 días… puede tardar un minuto.', 'info');
    try {
        const analyze = httpsCallable(getFunctions(auth.app, 'us-central1'), 'adminAnalyzeChats', { timeout: 130000 });
        const res = await analyze({ days: 7 });
        showToast(`Informe listo: ${res.data.conversaciones} conversaciones analizadas.`, 'success');
    } catch (err) { showToast(`No se pudo analizar: ${esc(err.message)}`, 'error'); }
    btn.disabled = false;
});

const loadBot = () => {
    unsubscribeListeners.botSettings = onSnapshot(doc(db, dbPath('bot_settings/main')), (snap) => {
        if (botLoaded) return;   // no pisa lo que estés escribiendo
        botLoaded = true;
        const d  = snap.exists() ? snap.data() : {};
        const fu = { ...BOT_DEFAULTS, ...(d.followUp || {}) };
        document.getElementById('botNotes').value           = d.notes || '';
        document.getElementById('botFollowEnabled').checked = fu.enabled;
        document.getElementById('botFollowHours').value     = fu.hours;
        document.getElementById('botFollowFrom').value      = fu.from;
        document.getElementById('botFollowTo').value        = fu.to;
    });
    unsubscribeListeners.botInsights = onSnapshot(collection(db, dbPath('bot_insights')), (snap) => {
        renderInsights(snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)).slice(0, 8));
    });
};

registerSection('bot', { title: 'Bot de WhatsApp', load: loadBot });
