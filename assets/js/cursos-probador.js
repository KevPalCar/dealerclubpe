// Probador de estados para la VISTA PREVIA LOCAL de /cursos (cursos.html?maqueta).
// Solo se carga en localhost; nunca en la web publicada. Permite cambiar el
// estado de cada curso y ver al instante cómo reacciona su tarjeta, sin tocar
// Firestore.
export function montarProbador(cursos, repintar) {
    const caja = document.createElement('div');
    caja.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;background:#111;border:1px solid #ffc107;border-radius:10px;' +
        'padding:10px 12px;color:#eee;font:13px Montserrat,sans-serif;max-width:min(92vw,330px);box-shadow:0 6px 24px rgba(0,0,0,.6)';
    const estados = ['Abierto', 'Próximamente', 'Cerrado', 'En Progreso'];
    caja.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px">
        <b style="color:#ffc107">Probador (solo vista previa)</b><button type="button" data-min style="background:none;border:0;color:#aaa;cursor:pointer">▁</button></div>
      <div data-cuerpo>${[...cursos].sort((a, b) => a.order - b.order).map(c => `
        <label style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin:4px 0">
          <span>${c.name}</span>
          <select data-id="${c.id}" style="background:#222;color:#eee;border:1px solid #444;border-radius:5px;padding:2px 4px">
            ${estados.map(e => `<option ${c.status === e ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
        </label>`).join('')}</div>`;
    caja.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => {
        cursos.find(c => c.id === sel.dataset.id).status = sel.value;
        repintar(cursos);
    }));
    caja.querySelector('[data-min]').addEventListener('click', () => {
        const cuerpo = caja.querySelector('[data-cuerpo]');
        cuerpo.hidden = !cuerpo.hidden;
    });
    document.body.appendChild(caja);
}
