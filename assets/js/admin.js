// ============================================================
// PANEL DE ADMINISTRACIÓN — DealerClub (punto de entrada)
// ============================================================
// El admin está dividido en un archivo por sección, dentro de
// assets/js/admin/. Este archivo solo los carga, comprueba que
// quien entra sea admin y arranca.
//
//   core.js          lo común: avisos, tablas, ventanas, menú
//   diario.js        Trabajo del día
//   alumnos.js       Alumnos, pagos y constancias
//   campus.js        Material, Tareas y Progreso
//   referidos.js     Referidos
//   cotizaciones.js  Cotizaciones de eventos y tarifario
//   contenido.js     Cursos, Profesores, Egresados, Dealers, Juegos
//   brochures.js     Brochures
//   bot.js           Bot de WhatsApp
//   config.js        Config & Anuncios
// ============================================================

import { auth, db, dbPath } from './firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { startAdmin } from './admin/core.js';
import './admin/contenido.js';
import './admin/config.js';
import './admin/referidos.js';
import './admin/campus.js';
import { reconcileApprovedStudents, watchVoucherQueue } from './admin/alumnos.js';
import './admin/diario.js';
import './admin/cotizaciones.js';
import './admin/bot.js';
import './admin/brochures.js';

// ── AUTENTICACIÓN Y SEGURIDAD ────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (user && !user.isAnonymous) {
        try {
            const snap = await getDoc(doc(db, dbPath(`user_roles/${user.uid}`)));
            if (snap.exists() && snap.data().role === 'admin') {
                document.getElementById('admin-user-info').innerHTML =
                    `<span>Bienvenido, Admin</span><i class="fas fa-user-circle"></i>`;
                startAdmin('daily');
                reconcileApprovedStudents();
                watchVoucherQueue();
            } else {
                await signOut(auth);
                window.location.replace('/iniciar-sesion');
            }
        } catch {
            await signOut(auth);
            window.location.replace('/iniciar-sesion');
        }
    } else {
        window.location.replace('/iniciar-sesion');
    }
});
