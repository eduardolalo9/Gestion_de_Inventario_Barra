/**
 * js/app.js — Punto de entrada principal (CORREGIDO)
 */

import { initTheme } from './ui.js';
import { loadFromLocalStorage, smartAutoSave,
         saveToLocalStorage }          from './storage.js';
import { syncStockByAreaFromConteo, handleFileImport,
         importFullData }              from './products.js';
import { initAuditUser }              from './audit.js';
import { initAuth, onAuthReady }      from './auth.js';
import { switchTab }                  from './render.js';
import { updateNetworkStatus, syncToCloud,
         stopRealtimeListeners }       from './sync.js';
import { state }                      from './state.js';
import { INITIAL_PRODUCTS,
         AUTO_SAVE_INTERVAL_MS,
         SYNC_RECOVERY_INTERVAL_MS }   from './constants.js';
import './notificaciones.js';
import './ajustes.js';
import './reportes.js';
import './actions.js';   // FIX: expone en window todas las funciones de onClick

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

// ── Limpieza al cerrar la pestaña ─────────────────────────────
window.addEventListener('beforeunload', () => {
  stopRealtimeListeners();
  try { saveToLocalStorage(); } catch (_) {}
});

// ═══════════════════════════════════════════════════════════════
// DOMContentLoaded — Secuencia de arranque
// ═══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  console.info('[App] DOM listo — iniciando secuencia…');

  /* 1. Tema */
  initTheme();

  /* 2. Enter en campos del login */
  document.getElementById('loginEmail')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('loginPassword')?.focus(); }
  });
  document.getElementById('loginPassword')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); window.handleLogin?.(); }
  });

  /* 3. INICIAR AUTH */
  initAuth();

  /* 4. ESPERAR a que auth resuelva */
  onAuthReady.then(user => {
    if (!user) {
      console.info('[App] Sin usuario autenticado — esperando login.');
      return;
    }

    console.info('[App] Usuario confirmado — cargando aplicación…');

    /* A. Identidad multiusuario */
    initAuditUser();

    /* B. Estado local */
    loadFromLocalStorage();
    syncStockByAreaFromConteo();

    /* C. Productos de ejemplo (primera vez) */
    if (state.products.length === 0) {
      console.info('[App] Primera ejecución — cargando productos de ejemplo.');
      state.products = INITIAL_PRODUCTS;
      saveToLocalStorage();
    }

    /* D. Renderizar tab activo */
    switchTab(state.activeTab);

    /* E. DELEGACIÓN DE EVENTOS para inputs de archivo
     *    Esto funciona SIEMPRE, sin importar si el DOM se recrea.
     *    Usamos delegación en document.body para capturar change
     *    de cualquier input con esos IDs.
     */
    document.body.addEventListener('change', function(e) {
      const target = e.target;
      if (!target || target.tagName !== 'INPUT') return;

      if (target.id === 'fileInput') {
        console.info('[App] fileInput change — llamando handleFileImport');
        handleFileImport(e);
        return;
      }

      if (target.id === 'importDataInput') {
        console.info('[App] importDataInput change — llamando importFullData');
        importFullData(e);
        return;
      }
    });

    /* F. Red online/offline */
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    updateNetworkStatus();

    window.addEventListener('online', () => {
      if (state.adjustmentsPending?.length > 0) {
        import('./ajustes.js').then(m => m.subirAjustesPendientes()).catch(() => {});
      }
    });

    /* G. Auto-guardado local cada 30 s */
    setInterval(smartAutoSave, AUTO_SAVE_INTERVAL_MS);

    /* H. Sync de recuperación cada 3 min */
    setInterval(() => {
      if (navigator.onLine && window._db &&
          state._cloudSyncPending && !state._syncInProgress) {
        console.info('[App] Sync de recuperación — había cambios pendientes.');
        syncToCloud().catch(e => console.warn('[App] Sync periódico falló:', e));
      }
    }, SYNC_RECOVERY_INTERVAL_MS);

    /* I. Guard anti doble-click para exportToExcel */
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

    /* J. Label de tema en sidebar */
    const sbLabel = document.getElementById('sbThemeLabel');
    if (sbLabel) {
      sbLabel.textContent =
        document.documentElement.getAttribute('data-theme') === 'dark'
          ? 'Modo claro' : 'Modo oscuro';
    }

    console.info('[App] ✓ Arranque completo.');
  });
});