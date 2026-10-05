# DealerClub — mapa del proyecto

Dónde está cada cosa y qué archivo tocar para cada cambio. Web estática (HTML, CSS y JS sin compilar) + Firebase (cuentas, base de datos y el bot de WhatsApp).

## Reglas de orden

1. **Un archivo por página.** Cada página tiene su `.html` en la raíz, su `.css` y su `.js` con el mismo nombre.
2. **Firebase se configura en un solo sitio:** `assets/js/firebase.js`. Ningún otro archivo vuelve a inicializarlo.
3. **Lo que se comparte va en su módulo:** `image.js`, `billing.js`, `chip-rain.js`. No se copia código entre páginas.
4. **Los permisos viven en `firestore.rules`.** Se publican con `firebase deploy --only firestore:rules`; nunca se editan en la consola.
5. **Nada generado ni temporal entra al repositorio** (`node_modules`, cachés, pruebas sueltas).
6. **Cada función nueva del admin lleva su icono de ayuda** (`<span class="info-tip" data-tip="…">i</span>`).

## Páginas del sitio

| Dirección | Archivo | Estilos | Lógica |
|---|---|---|---|
| `/` | `index.html` | `index.css` | `index.js`, `gallery.js` |
| `/cursos` | `cursos.html` | `cursos.css` | `cursos.js` (inscripción en 3 pasos) |
| `/servicios` | `servicios.html` | `servicios.css` | `servicios.js` (cotizador de eventos) |
| `/nosotros` | `nosotros.html` | `nosotros.css` | `nosotros.js` |
| `/iniciar-sesion` | `iniciar-sesion.html` | `auth.css` | `login.js`, `chip-rain.js` |
| `/registro` | `registro.html` | `auth.css` | `register.js` |
| `/panel-estudiante` | `panel-estudiante.html` | `student_dashboard.css` | `student_dashboard.js` |
| `/admin` | `admin.html` | `admin.css` | `admin.js` |
| `/cotizacion?id=…` | `cotizacion.html` | `cotizacion.css` | `cotizacion.js` (hoja que ve el cliente) |
| `/brochure-eventos`, `/brochure-escuela` | `brochure-*.html` | diseño propio dentro de cada archivo + `brochure.css` | `brochure.js` |
| `/legal/…` | `legal/*.html` | dentro de cada archivo | — |

Todos los estilos están en `assets/css/` y la lógica en `assets/js/`. `main.css` tiene lo común a todas las páginas.

## Módulos compartidos (`assets/js/`)

| Archivo | Para qué sirve |
|---|---|
| `firebase.js` | Conexión a Firebase, `dbPath()` y `generateStudentCode()` |
| `image.js` | Comprime fotos antes de guardarlas (constancias, evidencias, fotos de brochure) |
| `billing.js` | Cuotas, vencimientos y estado de pago de un alumno |
| `chip-rain.js` | Lluvia de fichas del inicio de sesión |

## El admin (`assets/js/admin/`)

`assets/js/admin.js` solo carga las secciones y comprueba que quien entra sea admin. Cada sección del menú vive en su propio archivo:

| Menú | Archivo |
|---|---|
| Trabajo del día | `admin/diario.js` |
| Alumnos (activar, suspender, pagos, constancias) | `admin/alumnos.js` |
| Material, Tareas, Progreso | `admin/campus.js` |
| Referidos | `admin/referidos.js` |
| Cotizaciones (solicitudes, editor, tarifario, historial) | `admin/cotizaciones.js` |
| Cursos, Profesores, Egresados, Dealers, Juegos del Casino | `admin/contenido.js` |
| Brochures | `admin/brochures.js` |
| Bot y seguimiento | `admin/bot.js` |
| Config & Anuncios | `admin/config.js` |
| Lo común a todas: avisos, tablas con buscador, ventanas, menú | `admin/core.js` |

Para agregar una sección nueva: se crea su archivo en `admin/`, se registra con `registerSection(...)` al final y se añade su `import` en `admin.js`.

## Datos (Firestore)

Todo cuelga de `/artifacts/default-app-id/public/data/`. Quién puede leer o escribir cada colección está en `firestore.rules`.

| Colección | Contenido | Lectura pública |
|---|---|---|
| `courses`, `professors`, `alumni`, `dealers`, `tables`, `config` | Contenido del sitio | Sí |
| `brochures`, `brochure_images` | Cambios hechos a los brochures | Sí |
| `user_roles` | Cuenta de cada persona: rol, estado, plan de pagos, asistencia, notas | No |
| `course_enrollments` | Inscripciones a cursos | No |
| `payments` | Constancias y cuotas | No |
| `materials`, `tasks`, `task_submissions` | Campus del alumno | Solo alumnos activos |
| `referrals`, `class_log` | Referidos y días en que se pasó lista | No |
| `service_requests` | Pedidos de cotización que llegan por la web | No |
| `quotes`, `quote_settings` | Cotizaciones emitidas y tarifario | Solo con el enlace de cada cotización |
| `brochure_files` | PDF que envía el bot | No |
| `bot_settings`, `bot_insights` | Ajustes e informes del bot | No |

El bot guarda sus chats aparte, en `wa_conversations`, `wa_leads` y `wa_processed`.

## El bot de WhatsApp (`functions/`)

| Archivo | Para qué sirve |
|---|---|
| `index.js` | Recibe cada mensaje y decide qué responder y qué enviar; tareas programadas |
| `knowledge/cerebro.md` | Instrucciones del bot: tono, flujo de venta, reglas |
| `lib/brain.js` | Llama al modelo de IA |
| `lib/catalog.js` | Le pasa al bot los cursos vigentes y el texto de los brochures |
| `lib/brochures.js` | Qué PDF envía (el subido en el admin o el de `brochures/`) |
| `lib/followup.js` | Mensaje activador a quien dejó de responder |
| `lib/insights.js` | Informe semanal de chats |
| `lib/botsettings.js` | Lee los ajustes que se cambian en el admin |
| `lib/whatsapp.js`, `lib/store.js`, `lib/notify.js`, `lib/config.js` | Envío por WhatsApp, guardado de chats, avisos al celular, claves |
| `lib/admin.js` | Funciones del panel de atención |
| `brochures/` | PDF de respaldo de cada brochure |
| `test/` | Pruebas que no envían nada a nadie |

El panel de atención de WhatsApp es aparte: `panel/index.html`, publicado en `dealerclubpe.web.app`.

## Cómo se publica

| Qué cambió | Cómo sale a producción |
|---|---|
| Web (HTML, CSS, JS, imágenes) | `git push` a `main`; Render lo despliega solo |
| Permisos | `firebase deploy --only firestore:rules` |
| Bot | `firebase deploy --only functions` |
| Panel de WhatsApp | `firebase deploy --only hosting` |

Si un cambio toca web y permisos a la vez, primero va el que no rompe al otro: los permisos que solo agregan acceso van antes; los que quitan, después de que la web nueva esté en vivo.

## Herramientas

- `optimize_images.py`: reduce las fotos pesadas de `assets/images/`.
- Escritorio → "Optimizar video DealerClub": reduce un video y lo publica como bienvenida del campus.
