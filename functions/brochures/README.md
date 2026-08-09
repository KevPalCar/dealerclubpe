# Brochures (catálogos en PDF)

El bot envía estos PDF por WhatsApp cuando el usuario elige una ruta:
- **Escuela de Dealers** → `escuela.pdf`
- **Casino de Fantasía** → `eventos.pdf`

## Cómo actualizarlos
1. Reemplaza el archivo PDF en esta carpeta **manteniendo el mismo nombre** (`escuela.pdf` o `eventos.pdf`).
2. Avísame para volver a desplegar (`firebase deploy --only functions`) y que el bot use la versión nueva.

## Nombres EXACTOS que espera el código
- `c:\DealerClub\functions\brochures\escuela.pdf`
- `c:\DealerClub\functions\brochures\eventos.pdf`

> El bot agrega automáticamente un texto (caption) indicando que los precios/datos
> son **vigentes a la fecha de envío**, así no quedan desactualizados con el tiempo.
