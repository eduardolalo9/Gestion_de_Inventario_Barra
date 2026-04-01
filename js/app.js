/**
 * js/app.js — Punto de entrada principal.
 *
 * CICLO DE VIDA DE LISTENERS:
 *   DOMContentLoaded → initAuth()
 *     └─ onAuthStateChanged(user)
 *          ├─ user LOGIN  → startRealtimeListeners()   [en auth.js]
 *          └─ user LOGOUT → stopRealtimeListeners()    [en auth.js]
 *
 * app.js ya NO llama loadFromCloud(), loadConflictos… ni
 * loadConteoPorUsuario… — todo eso es responsabilidad de
 * los 10 listeners onSnapshot registrados en sync.js.
 */

import { initTheme }                             from './ui.js';
import { loadFromLocalStorage, smartAutoSave,
         saveToLocalStorage }                    from './storage.js';
import { syncStockByAreaFromConteo }             from './products.js';
import { initAuditUser }                         from './audit.js';
import { initAuth }                              from './auth.js';
import { switchTab }                             from './render.js';
import { updateNetworkStatus, syncToCloud,
         stopRealtimeListeners }                 from './sync.js';
import { state }                                 from './state.js';
import { INITIAL_PRODUCTS,
         AUTO_SAVE_INTERVAL_MS,
         SYNC_RECOVERY_INTERVAL_MS }             from './constants.js';

console.info('[App] BarInventory arrancando…');

// ── Service Worker ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(reg => {
                console.info('[SW] Registrado — scope:', reg.scope);
                reg.addEventListener('updatefound', () => {
                    const nw = reg.installing;
                    nw.addEventListener('statechange', () => {
                        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                            console.info('[SW] Nueva versión disponible.');
                            window.showNotification?.('🔄 Nueva versión disponible — recarga la página');
                        }
                    });
                });
            })
            .catch(err => console.warn('[SW] Error al registrar:', err));

        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data?.type === 'SYNC_PENDING' && window._db && navigator.onLine) {
                syncToCloud().catch(e => console.warn('[SW→App] syncToCloud falló:', e));
            }
        });
    });
} else {
    console.info('[SW] Service Workers no soportados.');
}

// ── ESC cierra sidebar si no hay modal abierto ────────────────
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const anyOpen = ['productModal', 'orderModal', 'inventarioModal']
        .some(id => !document.getElementById(id)?.classList.contains('hidden'));
    if (!anyOpen) window.sbClose?.();
});

// ── Limpieza al cerrar la pestaña (evita fugas de listeners) ──
window.addEventListener('beforeunload', () => {
    // Detener listeners de Firestore antes de que el navegador cierre
    stopRealtimeListeners();
    try { saveToLocalStorage(); } catch (_) {}
});

// ═════════════════════════════════════════════════════════════
//  DOMContentLoaded — Secuencia de arranque
// ═════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    console.info('[App] DOM listo — iniciando secuencia…');

    /* 1. Tema — primero para evitar FOUC */
    initTheme();

    /* 2. Identidad multiusuario ANTES de cargar localStorage */
    initAuditUser();

    /* 3. Estado local */
    loadFromLocalStorage();
    syncStockByAreaFromConteo();

    /* 4. Productos de ejemplo (primera vez) */
    if (state.products.length === 0) {
        console.info('[App] Primera ejecución — cargando productos de ejemplo.');
        state.products = INITIAL_PRODUCTS;
        saveToLocalStorage();
    }

    /* 5. Renderizar tab activo */
    switchTab(state.activeTab);

    /* 6. Auth Firebase
          onAuthStateChanged → startRealtimeListeners / stopRealtimeListeners
          Los listeners de onSnapshot se inician AQUÍ de forma indirecta. */
    initAuth();

    /* 7. Inputs de archivo */
    document.getElementById('fileInput')?.addEventListener('change', e => {
        window.handleFileImport?.(e);
    });
    document.getElementById('importDataInput')?.addEventListener('change', e => {
        window.importFullData?.(e);
    });

    /* 8. Red online/offline */
    window.addEventListener('online',  updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    updateNetworkStatus();

    /* 9. Auto-guardado local cada 30 s */
    setInterval(smartAutoSave, AUTO_SAVE_INTERVAL_MS);

    /* 10. Sync de recuperación cada 3 min
           Solo actúa si hay cambios pendientes Y los listeners están activos.
           Los listeners ya manejan la recepción; esto cubre el caso en que
           se perdió la conexión antes de que el listener enviara la escritura. */
    setInterval(() => {
        if (navigator.onLine && window._db &&
            state._cloudSyncPending && !state._syncInProgress) {
            console.info('[App] Sync de recuperación — había cambios pendientes.');
            syncToCloud().catch(e => console.warn('[App] Sync periódico falló:', e));
        }
    }, SYNC_RECOVERY_INTERVAL_MS);

    /* 11. Guard anti doble-click para exportToExcel */
    let _exportingExcel = false;
    const origExport = window.exportToExcel;
    if (origExport) {
        window.exportToExcel = function(modo) {
            if (_exportingExcel) { window.showNotification?.('⏳ Exportación en proceso…'); return; }
            _exportingExcel = true;
            try { origExport(modo); }
            catch (e) { window.showNotification?.('❌ Error al exportar Excel'); console.error(e); }
            setTimeout(() => { _exportingExcel = false; }, 3000);
        };
    }

    /* 12. Label de tema en sidebar */
    const sbLabel = document.getElementById('sbThemeLabel');
    if (sbLabel) {
        sbLabel.textContent =
            document.documentElement.getAttribute('data-theme') === 'dark'
                ? 'Modo claro' : 'Modo oscuro';
    }

    /* 13. Enter en campos del login */
    document.getElementById('loginEmail')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('loginPassword')?.focus(); }
    });
    document.getElementById('loginPassword')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); window.handleLogin?.(); }
    });

    console.info('[App] ✓ Arranque completo. Esperando auth para activar listeners.');
});
