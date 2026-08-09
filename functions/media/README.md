# Capturas / imágenes que el bot puede enviar

El bot puede mandar imágenes (capturas de la web, precios, horarios, ubicación, etc.)
cuando el Cerebro incluye una etiqueta `[[IMG:nombre]]`.

## Cómo agregar una captura
1. Guarda la imagen en esta carpeta con un nombre corto en minúsculas, sin espacios.
   Ej.: `precios.png`, `horarios.jpg`, `ubicacion.png`, `juegos.webp`.
2. Avísame el nombre para instruir al bot a usar `[[IMG:precios]]` cuando corresponda,
   y para volver a desplegar (`firebase deploy --only functions`).

Formatos aceptados: png, jpg, jpeg, webp. El nombre del archivo (sin extensión)
es el que se usa en la etiqueta `[[IMG:nombre]]`.
