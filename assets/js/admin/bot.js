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

// Números clave arriba (lo que acerca a la venta primero). Las cifras viejas
// del catálogo PDF ya no se muestran: el PDF de la Escuela está en pausa.
const KPIS = [
    ['conversaciones', 'chats', ''],
    ['desdeAnuncio', 'llegaron por anuncio', ''],
    ['pasesVip', 'Pases VIP agendados', 'good'],
    ['evaluaciones', 'evaluaciones agendadas', 'good'],
    ['derivadosAHumano', 'te los pasó a ti', 'warn'],
    ['quedaronEnSilencio', 'dejaron de responder', 'bad'],
];
const INSIGHT_LISTS = [
    ['dondeSePierden', 'Dónde se pierden'], ['objeciones', 'Objeciones'],
    ['preguntasFrecuentes', 'Preguntas frecuentes'], ['erroresDelBot', 'Fallos del bot'],
    ['loQueHizoElAsesor', 'Lo que hiciste tú y funcionó'], ['loQuePudoHacerMejor', 'Lo que pudiste hacer mejor']
];
let informes = [];
let autoNotes = [];

const fechaDe = (r) => r.createdAt ? new Date(r.createdAt.seconds * 1000)
    .toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short' }) : '';

const renderInforme = (r) => {
    const kpis = document.getElementById('bot-kpis');
    const resumen = document.getElementById('bot-summary');
    const box = document.getElementById('bot-insights');
    if (!r) {
        kpis.innerHTML = '';
        resumen.textContent = 'Aún no hay informes. El próximo sale solo a las 8:00 a. m., o pulsa «Analizar ahora».';
        box.innerHTML = '';
        return;
    }
    kpis.innerHTML = KPIS.map(([k, l, tono]) =>
        `<div class="bot-kpi ${tono}"><b>${r.embudo?.[k] ?? 0}</b><span>${l}</span></div>`).join('');
    resumen.innerHTML = `<span class="bot-summary-when">${esc(fechaDe(r))} · últimos ${r.days || 7} días</span> ${esc(r.resumen || '')}`;
    const listas = INSIGHT_LISTS.filter(([k]) => (r[k] || []).length);
    box.innerHTML = listas.length
        ? listas.map(([k, title]) => `<div class="bot-list"><h4>${title} <span>${r[k].length}</span></h4><ul>${r[k].map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')
        : '<p class="bot-empty">Este informe no trae detalle.</p>';
};

const renderInformes = () => {
    const sel = document.getElementById('bot-report-select');
    const actual = sel.value;
    sel.innerHTML = informes.map((r, i) => `<option value="${r.id}">${i === 0 ? 'Último · ' : ''}${esc(fechaDe(r))}</option>`).join('');
    sel.hidden = informes.length < 2;
    if (actual && informes.some(r => r.id === actual)) sel.value = actual;
    renderInforme(informes.find(r => r.id === sel.value) || informes[0]);
};
document.getElementById('bot-report-select').addEventListener('change', (e) =>
    renderInforme(informes.find(r => r.id === e.target.value)));

const renderAutoNotes = () => {
    const box = document.getElementById('bot-autonotes');
    if (!autoNotes.length) {
        box.innerHTML = '<p class="bot-empty">Todavía ninguna. Aparecen aquí después de cada análisis.</p>';
        return;
    }
    box.innerHTML = '';
    [...autoNotes].reverse().forEach(a => {
        const row = document.createElement('div');
        row.className = 'bot-autonote';
        const f = a.fecha ? new Date(a.fecha).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : '';
        row.innerHTML = `<div><strong>${esc(a.titulo)}</strong><span>${esc(a.nota)}</span></div>
            <small>${esc(f)}</small>
            <button type="button" class="btn btn-secondary btn-sm" title="El bot deja de usar esta mejora"><i class="fas fa-xmark"></i> Quitar</button>`;
        row.querySelector('button').addEventListener('click', async (evt) => {
            const btn = evt.currentTarget;
            btn.disabled = true;
            try {
                await setDoc(doc(db, dbPath('bot_settings/main')), {
                    autoNotes: autoNotes.filter(x => x.id !== a.id), updatedAt: new Date()
                }, { merge: true });
                showToast('Mejora quitada: el bot deja de usarla en un minuto.', 'success');
            } catch (err) { btn.disabled = false; showToast(`Error: ${esc(err.message)}`, 'error'); }
        });
        box.appendChild(row);
    });
};

document.getElementById('bot-analyze-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    showToast('Analizando los chats de los últimos 2 días… puede tardar un minuto.', 'info');
    try {
        const analyze = httpsCallable(getFunctions(auth.app, 'us-central1'), 'adminAnalyzeChats', { timeout: 130000 });
        const res = await analyze({ days: 2 });
        const n = res.data.aplicadas || 0;
        showToast(`Listo: ${res.data.conversaciones} chats analizados${n ? `, ${n} mejora${n > 1 ? 's' : ''} aplicada${n > 1 ? 's' : ''}` : ''}.`, 'success');
        document.getElementById('bot-report-select').value = '';
    } catch (err) { showToast(`No se pudo analizar: ${esc(err.message)}`, 'error'); }
    btn.disabled = false;
});

const loadBot = () => {
    unsubscribeListeners.botSettings = onSnapshot(doc(db, dbPath('bot_settings/main')), (snap) => {
        const d  = snap.exists() ? snap.data() : {};
        autoNotes = Array.isArray(d.autoNotes) ? d.autoNotes : [];
        renderAutoNotes();
        if (botLoaded) return;   // el formulario no pisa lo que estés escribiendo
        botLoaded = true;
        const fu = { ...BOT_DEFAULTS, ...(d.followUp || {}) };
        document.getElementById('botNotes').value           = d.notes || '';
        document.getElementById('botFollowEnabled').checked = fu.enabled;
        document.getElementById('botFollowHours').value     = fu.hours;
        document.getElementById('botFollowFrom').value      = fu.from;
        document.getElementById('botFollowTo').value        = fu.to;
    });
    unsubscribeListeners.botInsights = onSnapshot(collection(db, dbPath('bot_insights')), (snap) => {
        informes = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)).slice(0, 12);
        renderInformes();
    });
};

registerSection('bot', { title: 'Bot de WhatsApp', load: loadBot });
