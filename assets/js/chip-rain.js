// ============================================================
// LLUVIA 3D DE FICHAS — fondo decorativo (páginas de acceso)
// ============================================================
// Misma hoja de fichas y mismo movimiento que el cotizador de
// servicios.js: cada ficha rota en los tres ejes y cae en bucle.
// ============================================================

// Geometría de /assets/images/fichas-sheet.webp: 7 fichas de 150 px.
const HOJA_W = 792, HOJA_H = 783, FICHA_D = 150;
const FICHAS = [
    { x: 115, y: 157 }, { x: 332, y: 157 }, { x: 551, y: 157 }, { x: 114, y: 375 },
    { x: 330, y: 375 }, { x: 548, y: 375 }, { x: 339, y: 593 }
];

export function startChipRain(capa) {
    if (!capa || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let W = 0, H = 0;
    const medir = () => { const r = capa.getBoundingClientRect(); W = r.width; H = r.height; };
    medir();
    window.addEventListener('resize', medir);

    const lluvia = [];

    const crearFicha = () => {
        const d = 34 + Math.random() * 36;
        const f = FICHAS[(Math.random() * FICHAS.length) | 0], k = d / FICHA_D;
        const el = document.createElement('i');
        el.className = 'rain-ficha';
        el.style.width = el.style.height = d + 'px';
        el.style.backgroundSize = `${(HOJA_W * k).toFixed(1)}px ${(HOJA_H * k).toFixed(1)}px`;
        el.style.backgroundPosition = `${(-f.x * k).toFixed(1)}px ${(-f.y * k).toFixed(1)}px`;
        el.style.opacity = (.26 + Math.random() * .2).toFixed(2);
        capa.append(el);
        return {
            el, d,
            x: Math.random() * Math.max(1, W - d),
            y: -d - Math.random() * H,
            vy: .35 + Math.random() * .75,
            vx: (Math.random() - .5) * .25,
            rx: Math.random() * 360, ry: Math.random() * 360, rz: Math.random() * 360,
            vrx: (Math.random() - .5) * 1.6,
            vry: .5 + Math.random() * 1.5,
            vrz: (Math.random() - .5) * 1.2,
            z: -160 + Math.random() * 260
        };
    };

    const animar = () => {
        requestAnimationFrame(animar);
        if (document.hidden || !H) return;

        const objetivo = W < 600 ? 10 : 22;
        while (lluvia.length < objetivo) lluvia.push(crearFicha());

        for (const p of lluvia) {
            p.y += p.vy; p.x += p.vx;
            p.rx += p.vrx; p.ry += p.vry; p.rz += p.vrz;
            if (p.y > H + p.d) { p.y = -p.d * 1.6; p.x = Math.random() * Math.max(1, W - p.d); }
            if (p.x < -p.d) p.x = W; else if (p.x > W) p.x = -p.d;
            p.el.style.transform =
                `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,${p.z.toFixed(0)}px) ` +
                `rotateX(${p.rx.toFixed(1)}deg) rotateY(${p.ry.toFixed(1)}deg) rotateZ(${p.rz.toFixed(1)}deg)`;
        }
    };
    animar();
}
