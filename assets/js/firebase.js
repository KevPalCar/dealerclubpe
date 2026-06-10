// ============================================================
// MÓDULO CENTRAL DE FIREBASE — DealerClub
// ============================================================
// Importa { auth, db, dbPath } desde este archivo en TODOS los
// módulos JS del proyecto. Nunca inicialices Firebase en otro
// archivo; este patrón evita el error "App already exists" y
// garantiza una sola instancia en toda la aplicación.
// ============================================================

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth }      from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ── ESPACIO DE TRABAJO FIRESTORE ─────────────────────────────
// Todos los documentos viven bajo:
//   /artifacts/{APP_SCOPE}/public/data/...
//
// IMPORTANTE: APP_SCOPE NO es el appId de Firebase (ese va en
// el objeto firebaseConfig de abajo). Es simplemente el nombre
// de la "bóveda" de datos que usamos en Firestore.
const APP_SCOPE = 'default-app-id';

// ── CONFIGURACIÓN DEL PROYECTO FIREBASE ─────────────────────
// Estos datos son públicos (API key de cliente, no de servidor).
// La seguridad real se gestiona con Firebase Security Rules en
// la consola de Firebase: https://console.firebase.google.com
const firebaseConfig = {
    apiKey:            "AIzaSyA3YsyUDmLeAvvgWwvCnjeJt-HbGGk--PY",
    authDomain:        "dealerclubpe.firebaseapp.com",
    projectId:         "dealerclubpe",
    storageBucket:     "dealerclubpe.firebasestorage.app",
    messagingSenderId: "330568352415",
    appId:             "1:330568352415:web:9fcd7651698bfafac998aa"
};

// getApps().length previene re-inicialización cuando múltiples
// módulos importan este archivo en la misma pestaña.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);

// ── HELPER DE RUTAS ──────────────────────────────────────────
// Construye la ruta completa de Firestore para cualquier
// colección o documento dentro del espacio de trabajo.
//
// Ejemplos:
//   dbPath('courses')            → /artifacts/default-app-id/public/data/courses
//   dbPath('config/announceBar') → /artifacts/default-app-id/public/data/config/announceBar
//   dbPath(`user_roles/${uid}`)  → /artifacts/default-app-id/public/data/user_roles/{uid}
export const dbPath = (path) => `/artifacts/${APP_SCOPE}/public/data/${path}`;
