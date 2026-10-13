// ============================================================
// FICHAS 3D — lluvia de fondo y estallidos al hacer clic
// ============================================================
// Cada ficha rota en los tres ejes. Este archivo se carga solo,
// sin esperar a Firebase, y arranca la lluvia en todo elemento
// marcado con data-chip-rain: así las fichas ya están cayendo
// en cuanto se ve la página. chipBurst y chipCascade sueltan
// fichas sobre toda la ventana (campus del alumno). El cotizador
// de servicios.js reutiliza de aquí la geometría de la hoja.
// ============================================================

// Geometría de /assets/images/fichas-sheet.webp: 7 fichas de 150 px.
export const HOJA_W = 792, HOJA_H = 783, FICHA_D = 150;
export const FICHAS = [
    { x: 115, y: 157 }, { x: 332, y: 157 }, { x: 551, y: 157 }, { x: 114, y: 375 },
    { x: 330, y: 375 }, { x: 548, y: 375 }, { x: 339, y: 593 }
];

const sinMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Ficha al azar de la hoja, con diámetro d, dentro de la capa.
const crearFicha = (capa, d) => {
    const f = FICHAS[(Math.random() * FICHAS.length) | 0], k = d / FICHA_D;
    const el = document.createElement('i');
    el.className = 'rain-ficha';
    el.style.width = el.style.height = d + 'px';
    el.style.backgroundSize = `${(HOJA_W * k).toFixed(1)}px ${(HOJA_H * k).toFixed(1)}px`;
    el.style.backgroundPosition = `${(-f.x * k).toFixed(1)}px ${(-f.y * k).toFixed(1)}px`;
    capa.append(el);
    return el;
};

// Giro propio de cada ficha: se pone de canto, como un disco real.
const giro = () => ({
    rx: Math.random() * 360, ry: Math.random() * 360, rz: Math.random() * 360,
    vrx: (Math.random() - .5) * 1.6,
    vry: .5 + Math.random() * 1.5,
    vrz: (Math.random() - .5) * 1.2,
    z: -160 + Math.random() * 260
});

const colocar = (p) => {
    p.el.style.transform =
        `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,${p.z.toFixed(0)}px) ` +
        `rotateX(${p.rx.toFixed(1)}deg) rotateY(${p.ry.toFixed(1)}deg) rotateZ(${p.rz.toFixed(1)}deg)`;
};

// ── LLUVIA DE FONDO ──────────────────────────────────────────
export function startChipRain(capa) {
    if (!capa || sinMovimiento()) return;

    let W = 0, H = 0;
    const medir = () => { const r = capa.getBoundingClientRect(); W = r.width; H = r.height; };
    medir();
    window.addEventListener('resize', medir);

    const lluvia = [];

    const nuevaGota = () => {
        const d  = 34 + Math.random() * 36;
        const el = crearFicha(capa, d);
        el.style.opacity = (.26 + Math.random() * .2).toFixed(2);
        return {
            el, d,
            x: Math.random() * Math.max(1, W - d),
            // Repartidas por toda la altura: se ven desde el primer instante.
            y: Math.random() * (H + d) - d,
            vy: .35 + Math.random() * .75,
            vx: (Math.random() - .5) * .25,
            ...giro()
        };
    };

    const animar = () => {
        requestAnimationFrame(animar);
        if (document.hidden || !H) return;

        const objetivo = W < 600 ? 18 : 40;
        while (lluvia.length < objetivo) lluvia.push(nuevaGota());

        for (const p of lluvia) {
            p.y += p.vy; p.x += p.vx;
            p.rx += p.vrx; p.ry += p.vry; p.rz += p.vrz;
            if (p.y > H + p.d) { p.y = -p.d * 1.6; p.x = Math.random() * Math.max(1, W - p.d); }
            if (p.x < -p.d) p.x = W; else if (p.x > W) p.x = -p.d;
            colocar(p);
        }
    };
    animar();
}

// ── ESTALLIDOS (clic) Y CASCADA (momento grande) ─────────────
// Las fichas vuelan por una capa fija sobre toda la ventana, que
// se crea al primer uso (.chip-burst, en el CSS de la página).
// El bucle solo corre mientras quedan fichas en el aire.
let capaBurst = null;
const volando = [];

const caer = () => {
    for (let i = volando.length - 1; i >= 0; i--) {
        const p = volando[i];
        p.vy += .42; p.y += p.vy; p.x += p.vx;
        p.rx += p.vrx; p.ry += p.vry; p.rz += p.vrz;
        colocar(p);
        if (p.y > window.innerHeight + 90) { p.el.remove(); volando.splice(i, 1); }
    }
    if (volando.length) requestAnimationFrame(caer);
};

const soltar = (x, y, d, impulso) => {
    if (!capaBurst) {
        capaBurst = document.createElement('div');
        capaBurst.className = 'chip-burst';
        capaBurst.setAttribute('aria-hidden', 'true');
        document.body.append(capaBurst);
    }
    const p = { el: crearFicha(capaBurst, d), x, y, d, vx: 0, vy: 0, ...giro(), ...impulso };
    colocar(p);
    if (volando.push(p) === 1) requestAnimationFrame(caer);
};

// Golpe corto de fichas desde el elemento que se acaba de pulsar.
export function chipBurst(target) {
    if (!target || sinMovimiento()) return;
    const r  = target.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < 7; i++) {
        const d = 22 + Math.random() * 16;
        soltar(cx - d / 2, cy - d / 2, d, {
            vy: -5 - Math.random() * 4.5,
            vx: (Math.random() - .5) * 9,
            vry: 4 + Math.random() * 7,
            vrx: (Math.random() - .5) * 9
        });
    }
}

// Cascada desde lo alto de la ventana: para celebrar un logro.
export function chipCascade() {
    if (sinMovimiento()) return;
    let n = 0;
    const id = setInterval(() => {
        for (let i = 0; i < 3; i++) {
            const d = 30 + Math.random() * 26;
            soltar(Math.random() * Math.max(1, window.innerWidth - d), -d - 20, d, {
                vy: 1 + Math.random() * 2,
                vx: (Math.random() - .5) * 1.6,
                vry: 2 + Math.random() * 4
            });
        }
        if (++n > 18) clearInterval(id);
    }, 80);
}

document.querySelectorAll('[data-chip-rain]').forEach(startChipRain);
