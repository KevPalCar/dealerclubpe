# Brochures en PDF (respaldo del bot)

Estos dos archivos son los que el bot envía por WhatsApp **mientras no se haya subido otro desde el admin**:

- `escuela.pdf` → Escuela de Dealers
- `eventos.pdf` → Casino de Fantasía

## Cómo se actualiza hoy un brochure

1. Admin → **Brochures** → "Editar brochure": se cambia el texto o las fotos sobre la propia página.
2. En la página del brochure, "Descargar PDF".
3. Admin → Brochures → "Subir PDF". Desde ese momento el bot envía ese archivo.

No hace falta tocar esta carpeta ni volver a publicar el bot. El PDF subido se guarda en la base de datos (`brochure_files`), y si algún día no se puede leer, el bot vuelve a estos dos archivos.

## Dónde está cada parte

- Diseño y contenido base de cada brochure: `brochure-eventos.html` y `brochure-escuela.html`, en la raíz del sitio.
- Fotos: `assets/images/brochure/`.
- Los nombres `escuela.pdf` y `eventos.pdf` no deben cambiar: el código los busca así.
