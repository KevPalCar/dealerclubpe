/*
 * Seccion "Nuestro Trabajo" (inicio): carrusel de fotos + video de presentacion.
 *
 * Dos responsabilidades:
 *
 * 1. Encaje automatico de medios. Si una foto o un video es mas angosto que su
 *    marco, se muestra completo y centrado, y las alas se rellenan con una copia
 *    difuminada de si mismo. No descarga nada extra: reutiliza el archivo que ya
 *    esta en cache. Asi se puede mezclar material horizontal y vertical sin
 *    tocar codigo.
 *
 * 2. Video perezoso. Un video no descarga un solo byte hasta que entra en
 *    pantalla (y, si vive dentro del carrusel, hasta que su slide esta activo).
 *    Se pausa al salir de pantalla, al cambiar de slide y al cambiar de pestaña.
 *    Con Ahorro de datos, red 2G o "reducir movimiento" se queda en el poster.
 */
(function () {
    var section = document.querySelector('.our-work-section');
    if (!section) return;

    var conn = navigator.connection || {};
    var allowVideo =
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        conn.saveData !== true &&
        !/2g/.test(conn.effectiveType || '');

    function eachVideo(fn) {
        section.querySelectorAll('video[data-src]').forEach(fn);
    }

    /* ---------- 1. Encaje automatico ---------- */

    function fit(media) {
        var frame = media.parentElement;
        if (!frame || !frame.clientHeight) return;

        // Los atributos width/height del HTML mandan: un <video> no expone
        // videoWidth hasta cargar metadata, y sin ellos el poster parpadearia
        // recortado antes de acomodarse.
        var w = +media.getAttribute('width') || media.naturalWidth || media.videoWidth;
        var h = +media.getAttribute('height') || media.naturalHeight || media.videoHeight;
        if (!w || !h) return;

        // 0.02 de tolerancia para no activar el fondo por errores de redondeo.
        var narrower = w / h < frame.clientWidth / frame.clientHeight - 0.02;
        frame.classList.toggle('is-pillarboxed', narrower);
        if (!narrower) return;

        var src = media.tagName === 'VIDEO'
            ? media.getAttribute('poster')
            : media.currentSrc || media.getAttribute('src');
        if (!src) return;

        var backdrop = frame.querySelector('.slide-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'slide-backdrop';
            backdrop.setAttribute('aria-hidden', 'true');
            frame.insertBefore(backdrop, frame.firstChild);
        }
        backdrop.style.backgroundImage = 'url("' + src + '")';
    }

    function fitAll() {
        section.querySelectorAll('.slide-media').forEach(fit);
    }

    function watch(media) {
        if (media.tagName === 'VIDEO') {
            fit(media); // ya encuadrado por sus atributos width/height
            media.addEventListener('loadedmetadata', function () { fit(media); });
        } else if (media.complete) {
            fit(media);
        } else {
            media.addEventListener('load', function () { fit(media); }, { once: true });
        }
    }

    /* ---------- 2. Video perezoso ---------- */

    function play(video) {
        if (!video.getAttribute('src')) {
            video.addEventListener('error', function () {
                // Sin archivo o formato no soportado: se queda el poster.
                video.classList.add('is-unavailable');
            }, { once: true });
            video.setAttribute('src', video.dataset.src);
        }
        var started = video.play();
        if (started && started.catch) started.catch(function () {});
    }

    function update(video) {
        var slide = video.closest('.swiper-slide');
        var ready =
            allowVideo &&
            video.isInView &&
            !document.hidden &&
            (!slide || slide.classList.contains('swiper-slide-active'));

        if (ready) play(video);
        else if (!video.paused) video.pause();
    }

    function updateAll() { eachVideo(update); }

    /* ---------- Arranque ---------- */

    if (typeof Swiper !== 'undefined' && section.querySelector('.mySwiper')) {
        new Swiper('.mySwiper', {
            slidesPerView: 'auto',
            centeredSlides: true,
            spaceBetween: 30,
            loop: true,
            navigation: {
                nextEl: '.swiper-button-next',
                prevEl: '.swiper-button-prev'
            }
        }).on('slideChangeTransitionEnd', updateAll);
    }

    // Despues de Swiper para alcanzar tambien los slides clonados por loop:true.
    section.querySelectorAll('.slide-media').forEach(watch);

    var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            entry.target.isInView = entry.isIntersecting;
            update(entry.target);
        });
    }, { rootMargin: '200px 0px' });
    eachVideo(function (video) { observer.observe(video); });

    document.addEventListener('visibilitychange', updateAll);

    var resizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(fitAll, 150);
    });
})();
