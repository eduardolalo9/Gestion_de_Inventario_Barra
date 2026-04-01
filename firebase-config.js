/**
 * firebase-config.js
 * ══════════════════════════════════════════════════════════════
 * Inicialización de Firebase (SDK compat v10, cargado globalmente).
 * Este script es NO-MODULE para poder acceder a window.firebase
 * antes que los módulos ES sean evaluados.
 *
 * Expone en window:
 *   window._db             — instancia de Firestore (o null)
 *   window._auth           — instancia de Auth (o null)
 *   window.FIRESTORE_DOC_ID — ID del documento principal
 * ══════════════════════════════════════════════════════════════
 */

/* ── ADVERTENCIA DE SEGURIDAD ─────────────────────────────────
   Esta clave es visible en el código fuente. Restricción OBLIGATORIA:
   https://console.cloud.google.com → Credenciales → Restricciones de clave
   (dominio HTTP Referrer + solo Firestore API)
   ─────────────────────────────────────────────────────────── */
const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyDugu23uEgacqMUTsoBF8i7xfyDIDbiv0M",
    authDomain:        "bar-inventario-1109e.firebaseapp.com",
    projectId:         "bar-inventario-1109e",
    storageBucket:     "bar-inventario-1109e.firebasestorage.app",
    messagingSenderId: "450765028668",
    appId:             "1:450765028668:web:54fdb19714d374ff02b239"
};

/**
 * ID del documento Firestore que almacena el estado de ESTA instalación.
 * Cambia este valor para múltiples instancias ("barra-norte", "barra-sur").
 */
window.FIRESTORE_DOC_ID = "barra-principal";

// ─── Estado global de Firebase (accedido por los módulos vía window) ─────────
window._db   = null;
window._auth = null;

(function initFirebase() {
    'use strict';

    // Verificar que la config sea válida (ningún valor comience con "REEMPLAZA")
    const configured = Object.values(FIREBASE_CONFIG).every(
        v => typeof v === 'string' && !v.startsWith("REEMPLAZA")
    );

    if (!configured) {
        console.warn("[Firebase] Config incompleta — solo se usará localStorage.");
        return;
    }

    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        window._db   = firebase.firestore();
        window._auth = firebase.auth();

        // Persistencia offline nativa de Firestore (caché local automático)
        window._db.settings({
  cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED
});

window._db.enableIndexedDbPersistence()
  .catch(err => {
    if (err.code === 'failed-precondition') {
      console.warn('[Firebase] Persistencia: múltiples pestañas abiertas — solo una pestaña usa caché offline.');
    } else if (err.code === 'unimplemented') {
      console.warn('[Firebase] Persistencia no soportada en este navegador.');
    } else {
      console.warn('[Firebase] Error persistencia:', err.code);
    }
  });

        console.info("[Firebase] ✓ Inicializado correctamente — proyecto:", FIREBASE_CONFIG.projectId);

    } catch (e) {
        console.error("[Firebase] Error crítico al inicializar:", e);
        window._db   = null;
        window._auth = null;
    }
})();
