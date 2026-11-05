// Tarjeta de curso de dos caras: la usa /cursos (cursos.js) y la página que
// genera los pantallazos que envía el bot (maqueta/tarjeta.html).
// ════════════════════════════════════════════════════════════
// TARJETA DE CURSO (dos caras)
// Campos de cada documento de `courses` (los nuevos son opcionales):
//   name, description, price ("S/ 700"), priceNote ("Mensual"), schedule,
//   duration, gamesIncluded[], status (Abierto|Cerrado|Próximamente), tag, order
//   isNew        → pastilla NUEVO
//   gamesLabel   → título de la lista ("Juegos" por defecto, ej. "Incluye")
//   ctaText      → texto del botón principal
//   ctaWhatsapp  → si existe, el botón abre WhatsApp con ese mensaje
//   backRules[]  → reverso: "De este programa"
//   backWarning  → reverso: aviso en recuadro
//   combo        → { name, price, wasPrice, priceNote, addLines[], backRules[],
//                    backWarning, switchTitle, switchSub }  (interruptor del frente)
// ════════════════════════════════════════════════════════════
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const numero = (precio) => { const n = parseInt(String(precio ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };
const soles = (n) => 'S/ ' + n.toLocaleString('en-US');
const sinMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const lista = (items, cls = '') => (items || []).map(t => `<li${cls ? ` class="${cls}"` : ''}>${esc(t)}</li>`).join('');

export function renderCourseCard(course, { comunes, waNumber, onEnroll }) {
    const status     = course.status || 'Abierto';
    const isClosed   = status === 'Cerrado';
    const isWaitlist = status === 'Próximamente';
    const statusCls  = `status-${status.toLowerCase().replace(/\s/g, '-')}`;
    const precio     = String(course.price ?? '').trim();
    const games      = Array.isArray(course.gamesIncluded) ? course.gamesIncluded : (course.gamesIncluded ? [course.gamesIncluded] : []);
    const combo      = course.combo && course.combo.name ? course.combo : null;
    const ctaText    = isClosed ? 'Cupos Agotados' : isWaitlist ? 'Unirse a Lista de Espera' : (course.ctaText || '¡Inscríbete ahora!');

    const card = document.createElement('article');
    card.className = 'dc-card';
    card.innerHTML = `
      <div class="dc-inner">
        <div class="dc-face dc-front">
          ${course.tag ? `<span class="dc-hot">${esc(course.tag)}</span>` : ''}
          <div class="dc-pills">
            ${course.isNew ? '<span class="dc-pill dc-pill-new">Nuevo</span>' : ''}
            <span class="course-status ${statusCls} dc-pill">${esc(status)}</span>
          </div>
          <h3 class="dc-title" data-name>${esc(course.name || 'Curso')}</h3>
          <p class="dc-desc">${esc(course.description || '')}</p>
          <div class="dc-was" data-was></div>
          <div class="dc-price" data-price>${precio ? esc(precio) : '—'}</div>
          <div class="dc-unit" data-unit>${esc(course.priceNote || '')}</div>
          <div class="dc-meta"><strong>Horario:</strong> ${esc(course.schedule || 'Consultar')}</div>
          <div class="dc-meta"><strong>Duración:</strong> ${esc(course.duration || 'Consultar')}</div>
          <div class="dc-meta dc-games-label"><strong>${esc(course.gamesLabel || 'Juegos')}:</strong></div>
          <ol class="dc-games" data-games>${lista(games)}</ol>
          <div class="dc-cta">
            ${combo && !isClosed ? `
            <button class="dc-combo" type="button" aria-pressed="false" data-combo>
              <span><b>${esc(combo.switchTitle || '＋ ' + combo.name)}</b><small>${esc(combo.switchSub || '')}</small></span>
              <span class="dc-switch" aria-hidden="true"></span>
            </button>` : ''}
            <button class="btn ${isWaitlist ? 'btn-secondary' : 'btn-primary'} dc-enroll" type="button" ${isClosed ? 'disabled' : ''}>${esc(ctaText)}</button>
            <button class="dc-flip" type="button" data-flip aria-label="Ver a detalle ${esc(course.name || '')}">Ver a detalle ↻</button>
          </div>
        </div>
        <div class="dc-face dc-back" aria-hidden="true">
          <h4 data-bname>${esc(course.name || 'Curso')}: lo que debes saber</h4>
          ${course.backRules?.length ? `<div class="dc-k">De este programa</div><ul data-rules>${lista(course.backRules)}</ul>` : '<ul data-rules hidden></ul>'}
          <div class="dc-k">Para todos los cursos</div>
          <ul>${lista(comunes)}</ul>
          <div class="dc-warn" data-warn ${course.backWarning ? '' : 'hidden'}>${esc(course.backWarning || '')}</div>
          <div class="dc-cta"><button class="dc-flip" type="button" data-unflip>↺ Volver</button></div>
        </div>
      </div>`;

    const front = card.querySelector('.dc-front');
    const back  = card.querySelector('.dc-back');
    const voltear = (aReverso) => {
        card.classList.toggle('flipped', aReverso);
        back.setAttribute('aria-hidden', String(!aReverso));
        front.setAttribute('aria-hidden', String(aReverso));
        // Que el teclado no recorra la cara oculta.
        front.querySelectorAll('button').forEach(b => { b.tabIndex = aReverso ? -1 : 0; });
        back.querySelectorAll('button').forEach(b => { b.tabIndex = aReverso ? 0 : -1; });
        (aReverso ? back.querySelector('[data-unflip]') : front.querySelector('[data-flip]')).focus({ preventScroll: true });
        if (aReverso) back.scrollTop = 0;
    };
    back.querySelectorAll('button').forEach(b => { b.tabIndex = -1; });
    card.querySelector('[data-flip]').addEventListener('click', () => voltear(true));
    card.querySelector('[data-unflip]').addEventListener('click', () => voltear(false));

    // Botón principal: inscripción (modal) o WhatsApp (ej. evaluación gratis).
    let nombreActual = course.name || 'Curso';
    card.querySelector('.dc-enroll').addEventListener('click', () => {
        if (isClosed) return;
        if (course.ctaWhatsapp && !isWaitlist) {
            window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(course.ctaWhatsapp)}`, '_blank', 'noopener');
            return;
        }
        onEnroll(course.id, nombreActual, isWaitlist);
    });

    if (combo && !isClosed) {
        const btn    = card.querySelector('[data-combo]');
        const base   = numero(precio);
        const precioCombo = numero(combo.price);
        const rules  = card.querySelector('[data-rules]');
        const warn   = card.querySelector('[data-warn]');
        btn.addEventListener('click', () => {
            const on = !card.classList.contains('is-combo');
            card.classList.toggle('is-combo', on);
            btn.setAttribute('aria-pressed', String(on));
            nombreActual = on ? combo.name : (course.name || 'Curso');
            card.querySelector('[data-name]').textContent = nombreActual;
            card.querySelector('[data-bname]').textContent = `${nombreActual}: lo que debes saber`;
            card.querySelector('[data-was]').textContent = on && combo.wasPrice ? `Por separado ${combo.wasPrice}` : '';
            card.querySelector('[data-unit]').textContent = on ? (combo.priceNote || '') : (course.priceNote || '');
            const ol = card.querySelector('[data-games]');
            ol.querySelectorAll('.dc-add').forEach(li => li.remove());
            if (on) ol.insertAdjacentHTML('beforeend', lista(combo.addLines, 'dc-add'));
            const reglas = on ? combo.backRules : course.backRules;
            rules.innerHTML = lista(reglas);
            rules.hidden = !reglas?.length;
            const aviso = on ? (combo.backWarning ?? course.backWarning) : course.backWarning;
            warn.textContent = aviso || '';
            warn.hidden = !aviso;
            const priceEl = card.querySelector('[data-price]');
            if (base && precioCombo) contarHasta(priceEl, on ? base : precioCombo, on ? precioCombo : base);
            else priceEl.textContent = on ? combo.price : precio;
            if (on) lluviaDeFichas(front);
        });
    }
    return card;
}

function contarHasta(nodo, desde, hasta) {
    if (sinMovimiento()) { nodo.textContent = soles(hasta); return; }
    const t0 = performance.now(), dur = 550;
    const paso = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        nodo.textContent = soles(Math.round((desde + (hasta - desde) * e) / 10) * 10);
        if (k < 1) requestAnimationFrame(paso); else nodo.textContent = soles(hasta);
    };
    requestAnimationFrame(paso);
}

// Ráfaga corta de fichas al activar el combo (~1.5 s). No queda permanente.
function lluviaDeFichas(cara) {
    if (sinMovimiento()) return;
    const colores = ['#ffc107', '#c62828', '#1e88e5', '#2e7d32', '#111'];
    for (let i = 0; i < 14; i++) {
        const f = document.createElement('span');
        f.className = 'dc-chip';
        f.style.left = (5 + Math.random() * 90) + '%';
        f.style.setProperty('--c', colores[i % colores.length]);
        f.style.setProperty('--r', (Math.random() * 540 - 270) + 'deg');
        f.style.animationDelay = (Math.random() * 0.35) + 's';
        cara.appendChild(f);
        setTimeout(() => f.remove(), 1900);
    }
}
