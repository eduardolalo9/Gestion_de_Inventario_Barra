/**
 * js/storage.js — v2.2 CORREGIDO
 * ══════════════════════════════════════════════════════════════
 * Persistencia local con localStorage (offline-first).
 *
 * CORRECCIONES v2.2:
 * • Añadida función smartAutoSave() — importada por app.js en
 *   setInterval(smartAutoSave, AUTO_SAVE_INTERVAL_MS) pero que
 *   NO existía → SyntaxError al cargar el módulo → pantalla en blanco.
 * • Añadido state.searchTerm a dataToSave — se perdía en cada recarga.
 * ══════════════════════════════════════════════════════════════
 */

import { state } from './state.js';

const STORAGE_KEY = 'inventarioApp_data';

/**
 * Guarda todo el estado en localStorage.
 */
export function saveToLocalStorage() {
  try {
    const dataToSave = {
      products:                  state.products,
      cart:                      state.cart,
      orders:                    state.orders,
      inventories:               state.inventories,
      activeTab:                 state.activeTab,
      selectedArea:              state.selectedArea,
      selectedGroup:             state.selectedGroup,
      searchTerm:                state.searchTerm,   // FIX: se perdía en cada recarga
      inventarioConteo:          state.inventarioConteo,
      auditoriaConteo:           state.auditoriaConteo,
      auditoriaStatus:           state.auditoriaStatus,
      auditoriaConteoPorUsuario: state.auditoriaConteoPorUsuario,
      ajustes:                   state.ajustes,
      syncEnabled:               state.syncEnabled,
      _lastModified:             Date.now(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    localStorage.setItem('inventarioApp_lastModified', String(Date.now()));

    // Actualizar hash para detección de cambios
    state._lastDataHash =
      JSON.stringify(state.products)        +
      JSON.stringify(state.orders)          +
      JSON.stringify(state.inventories)     +
      JSON.stringify(state.inventarioConteo);

  } catch (e) {
    console.error('[Storage] Error al guardar:', e);
  }
}

/**
 * Carga el estado desde localStorage.
 */
export function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      console.info('[Storage] No hay datos guardados — estado inicial.');
      return;
    }

    const data = JSON.parse(raw);

    if (Array.isArray(data.products))          state.products                  = data.products;
    if (Array.isArray(data.cart))              state.cart                      = data.cart;
    if (Array.isArray(data.orders))            state.orders                    = data.orders;
    if (Array.isArray(data.inventories))       state.inventories               = data.inventories;
    if (data.activeTab)                        state.activeTab                 = data.activeTab;
    if (data.selectedArea)                     state.selectedArea              = data.selectedArea;
    if (data.selectedGroup)                    state.selectedGroup             = data.selectedGroup;
    if (data.searchTerm  !== undefined)        state.searchTerm                = data.searchTerm;
    if (data.inventarioConteo)                 state.inventarioConteo          = data.inventarioConteo;
    if (data.auditoriaConteo)                  state.auditoriaConteo           = data.auditoriaConteo;
    if (data.auditoriaStatus)                  state.auditoriaStatus           = data.auditoriaStatus;
    if (data.auditoriaConteoPorUsuario)        state.auditoriaConteoPorUsuario = data.auditoriaConteoPorUsuario;
    if (data.ajustes)                          state.ajustes                   = data.ajustes;
    if (data.syncEnabled !== undefined)        state.syncEnabled               = data.syncEnabled;

    // Restaurar toggle de sync desde localStorage independiente
    // (tiene prioridad sobre el valor guardado en el objeto principal)
    try {
      const syncFlag = localStorage.getItem('inventarioApp_syncEnabled');
      if (syncFlag !== null) state.syncEnabled = syncFlag === '1';
    } catch (_) {}

    // Recalcular hash
    state._lastDataHash =
      JSON.stringify(state.products)        +
      JSON.stringify(state.orders)          +
      JSON.stringify(state.inventories)     +
      JSON.stringify(state.inventarioConteo);

    console.info(`[Storage] ✓ ${state.products.length} productos cargados desde localStorage.`);

  } catch (e) {
    console.error('[Storage] Error al cargar:', e);
  }
}

/**
 * smartAutoSave — FIX CRÍTICO (v2.2)
 * ──────────────────────────────────────────────────────────────
 * Versión inteligente de saveToLocalStorage que solo escribe si
 * el estado realmente cambió (comparando hash). Evita escrituras
 * redundantes cada 30 s cuando no hay cambios.
 *
 * Era importada por app.js pero NO existía en este módulo →
 * SyntaxError al cargar → la aplicación nunca arrancaba.
 *
 * Llamada por: app.js → setInterval(smartAutoSave, AUTO_SAVE_INTERVAL_MS)
 */
export function smartAutoSave() {
  try {
    // Calcular hash actual del estado
    const currentHash =
      JSON.stringify(state.products)        +
      JSON.stringify(state.orders)          +
      JSON.stringify(state.inventories)     +
      JSON.stringify(state.inventarioConteo);

    // Solo guardar si hubo cambios reales
    if (currentHash === state._lastDataHash) {
      console.debug('[Storage] smartAutoSave — sin cambios, omitiendo escritura.');
      return;
    }

    saveToLocalStorage();
    console.info('[Storage] smartAutoSave — cambios detectados, guardado.');

  } catch (e) {
    console.error('[Storage] smartAutoSave — error:', e);
  }
}

/**
 * Limpia todos los datos guardados.
 */
export function clearLocalStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('inventarioApp_lastModified');
    localStorage.removeItem('inventarioApp_syncEnabled');
    console.info('[Storage] ✓ localStorage limpiado.');
  } catch (e) {
    console.error('[Storage] Error al limpiar:', e);
  }
}
