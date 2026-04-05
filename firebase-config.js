/**
 * firebase-config.js — CORREGIDO
 * ══════════════════════════════════════════════════════════════
 * Inicialización de Firebase con SDK COMPAT v10 (cargado globalmente).
 *
 * CORRECCIONES:
 * ① Eliminados `import` y `export` — este archivo se carga como
 *   <script> normal (NO módulo). Los `export` dentro del IIFE
 *   causaban "Unexpected token 'export'" en el navegador.
 * ② Corregido `initializeApp(firebaseConfig)` → `firebase.initializeApp(FIREBASE_CONFIG)`
 *   El SDK compat expone `firebase` como global; no hay imports.
 * ③ Corregido `window._db` y `window._auth` — se asignan tras inicializar,
 *   no con `initializeFirestore` del SDK modular.
 * ④ Persistencia offline con try/catch aislado para no bloquear _auth/_db.
 *
 * IMPORTANTE: index.html debe cargarlo DESPUÉS de los scripts compat:
 *   <script src="firebase-app-compat.js"></script>
 *   <script src="firebase-firestore-compat.js"></script>
 *   <script src="firebase-auth-compat.js"></script>
 *   <script src="firebase-config.js"></script>   ← sin type="module"
 * ══════════════════════════════════════════════════════════════
 */

window.FIRESTORE_DOC_ID = "barra-principal";

window._db            = null;
window._auth          = null;
window._firebaseReady = false;

(function initFirebase() {
    'use strict';

    const FIREBASE_CONFIG = {
        apiKey:            "AIzaSyDugu23uEgacqMUTsoBF8i7xfyDIDbiv0M",
        authDomain:        "bar-inventario-1109e.firebaseapp.com",
        databaseURL:       "https://bar-inventario-1109e-default-rtdb.firebaseio.com",
        projectId:         "bar-inventario-1109e",
        storageBucket:     "bar-inventario-1109e.firebasestorage.app",
        messagingSenderId: "450765028668",
        appId:             "1:450765028668:web:54fdb19714d374ff02b239"
    };

    // Verificar que la config no tiene valores de placeholder
    const configured = Object.values(FIREBASE_CONFIG).every(
        v => typeof v === 'string' && v.length > 0 && !v.startsWith('REEMPLAZA')
    );
    if (!configured) {
        console.warn('[Firebase] Config incompleta — solo localStorage.');
        return;
    }

    // Verificar que el SDK compat está disponible
    if (typeof firebase === 'undefined') {
        console.error('[Firebase] SDK compat no cargado — verifica el orden de scripts en index.html.');
        return;
    }

    try {
        // ── 1. Inicializar App (compat) ───────────────────────
        // Evitar doble-inicialización si el módulo se recarga
        const app = firebase.apps.length === 0
            ? firebase.initializeApp(FIREBASE_CONFIG)
            : firebase.apps[0];

        // ── 2. Auth ───────────────────────────────────────────
        window._auth = firebase.auth(app);

        // ── 3. Firestore ──────────────────────────────────────
        window._db = firebase.firestore(app);

        // ── 4. Persistencia offline (aislada — no bloquea si falla) ──
        try {
            window._db.enableIndexedDbPersistence()
                .then(() => console.info('[Firebase] ✓ Persistencia offline habilitada.'))
                .catch(err => {
                    if (err.code === 'failed-precondition') {
                        console.warn('[Firebase] Persistencia: múltiples pestañas activas.');
                    } else if (err.code === 'unimplemented') {
                        console.warn('[Firebase] Persistencia no soportada en este navegador.');
                    } else {
                        console.warn('[Firebase] Persistencia error:', err.code);
                    }
                });
        } catch (persistErr) {
            console.warn('[Firebase] Persistencia falló (no crítico):', persistErr.message);
        }

        window._firebaseReady = true;
        console.info('[Firebase] ✓ Inicializado — proyecto:', FIREBASE_CONFIG.projectId);
        console.info('[Firebase] ✓ Auth:', window._auth ? 'OK' : 'FALLO');
        console.info('[Firebase] ✓ Firestore:', window._db ? 'OK' : 'FALLO');

    } catch (e) {
        console.error('[Firebase] Error crítico al inicializar:', e);
        window._db            = null;
        window._auth          = null;
        window._firebaseReady = false;
    }

})();
