// ============================================================
// BOTONES DE COPIAR
// ============================================================
// Todo botón con data-copy="texto" copia ese texto al pulsarlo y
// cambia su icono a un visto por un momento. Se usa en las cuentas
// bancarias (campus e inscripción) y en el código de referido.
// ============================================================

export function initCopyButtons(root = document) {
    root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-copy]');
        if (!btn) return;
        try { await navigator.clipboard.writeText(btn.dataset.copy); }
        catch { return; }                       // navegador sin permiso para copiar
        const icon = btn.querySelector('i');
        if (!icon) return;
        icon.className = 'fas fa-check';
        setTimeout(() => { icon.className = 'fas fa-copy'; }, 1500);
    });
}
