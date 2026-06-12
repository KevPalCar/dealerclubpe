# URLs limpias — pasos de despliegue

Se reestructuró el sitio para usar URLs limpias (sin `.html`, sin `/sections/`, sin `#`).
Los archivos se movieron de `/sections/` a la raíz y todos los enlaces internos ahora usan
rutas absolutas (`/cursos`, `/servicios`, etc.). Render ya sirve estas rutas sin `.html`.

## Mapa de URLs

| URL vieja (indexada en Google)              | URL nueva limpia            |
|---------------------------------------------|-----------------------------|
| `/index.html`                               | `/`                         |
| `/sections/cursos.html`                     | `/cursos`                   |
| `/sections/servicios.html`                  | `/servicios`                |
| `/sections/nosotros.html`                   | `/nosotros`                 |
| `/sections/login.html`                      | `/iniciar-sesion`           |
| `/sections/register.html`                   | `/registro`                 |
| `/sections/student_dashboard.html`          | `/panel-estudiante`         |
| `/sections/admin.html`                      | `/admin`                    |
| `/sections/legal/terminos-condiciones.html` | `/legal/terminos-condiciones` |
| `/sections/legal/politica-privacidad.html`  | `/legal/politica-privacidad`  |
| `/sections/legal/preguntas-frecuentes.html` | `/legal/preguntas-frecuentes` |
| `/sections/legal/libro-reclamaciones.html`  | `/legal/libro-reclamaciones`  |

## 1) Reglas de redirección 301 en Render (IMPORTANTE para no perder SEO)

En el dashboard de Render:
**Tu Static Site → pestaña "Redirects/Rewrites" → "Add Rule"**

Por cada fila: **Source** = ruta vieja, **Destination** = ruta nueva, **Action** = `Redirect`, **Status** = `301`.

| Source                                       | Destination                   |
|----------------------------------------------|-------------------------------|
| `/index.html`                                | `/`                           |
| `/sections/cursos.html`                      | `/cursos`                     |
| `/sections/cursos`                           | `/cursos`                     |
| `/sections/servicios.html`                   | `/servicios`                  |
| `/sections/servicios`                        | `/servicios`                  |
| `/sections/nosotros.html`                    | `/nosotros`                   |
| `/sections/nosotros`                         | `/nosotros`                   |
| `/sections/login.html`                       | `/iniciar-sesion`             |
| `/sections/register.html`                    | `/registro`                   |
| `/sections/student_dashboard.html`           | `/panel-estudiante`           |
| `/sections/admin.html`                       | `/admin`                      |
| `/sections/legal/terminos-condiciones.html`  | `/legal/terminos-condiciones` |
| `/sections/legal/politica-privacidad.html`   | `/legal/politica-privacidad`  |
| `/sections/legal/preguntas-frecuentes.html`  | `/legal/preguntas-frecuentes` |
| `/sections/legal/libro-reclamaciones.html`   | `/legal/libro-reclamaciones`  |

> Atajo opcional para las legales: una sola regla con comodín
> Source `/sections/legal/*` → Destination `/legal/*` (Redirect 301)
> reemplaza las 4 filas de `/legal/...`.

## 2) Purgar caché de Cloudflare

Cloudflare cachea las páginas (vimos `cf-cache-status: HIT`). Tras el deploy:
**Cloudflare → tu dominio → Caching → Configuration → "Purge Everything"**
Así los visitantes ven las nuevas URLs de inmediato.

## 3) Avisar a Google (opcional pero recomendado)

En **Google Search Console**: reenviar el sitemap `https://dealerclubpe.com/sitemap.xml`
(ya actualizado con las URLs limpias) para acelerar la reindexación.

## Verificación rápida tras desplegar

- `https://dealerclubpe.com/cursos` → 200 (la página de cursos)
- `https://dealerclubpe.com/sections/cursos.html` → 301 → `/cursos`
- `https://dealerclubpe.com/iniciar-sesion` → 200 (login)
