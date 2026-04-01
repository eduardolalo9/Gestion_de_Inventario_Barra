/**
 * js/storage.js
 * Capa de persistencia local (localStorage) + disparador de sync cloud.
 */

import { state }            from './state.js';
import { LS_WARN_BYTES }    from './constants.js';
import { showNotification, estimateStorageUsed } from './ui.js';

let _quotaWarned = false;

function safeGet(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        console.warn(`[Storage] Dato corrupto en "${key}", usando fallback.`, e);
        return fallback;
    }
}

function computeDataHash() {
    try {
        return (
            JSON.stringify(state.products) +
            JSON.stringify(state.orders) +
            JSON.stringify(state.inventories) +
            JSON.stringify(state.inventarioConteo)
        );
    } catch (_) { return ''; }
}

export function saveToLocalStorage() {
    console.debug('[Storage] Guardando en localStorage…');
    const entries = [
        ['inventarioApp_products',                  JSON.stringify(state.products)],
        ['inventarioApp_orders',                    JSON.stringify(state.orders)],
        ['inventarioApp_inventories',               JSON.stringify(state.inventories)],
        ['inventarioApp_cart',                      JSON.stringify(state.cart)],
        ['inventarioApp_activeTab',                 state.activeTab],
        ['inventarioApp_selectedGroup',             state.selectedGroup],
        ['inventarioApp_selectedArea',              state.selectedArea],
        ['inventarioApp_searchTerm',                state.searchTerm],
        ['inventarioApp_expandedInventories',       JSON.stringify(Array.from(state.expandedInventories))],
        ['inventarioApp_inventarioConteo',          JSON.stringify(state.inventarioConteo)],
        ['inventarioApp_auditoriaStatus',           JSON.stringify(state.auditoriaStatus)],
        ['inventarioApp_auditoriaConteo',           JSON.stringify(state.auditoriaConteo)],
        ['inventarioApp_auditoriaView',             state.auditoriaView],
        ['inventarioApp_auditoriaAreaActiva',       state.auditoriaAreaActiva || ''],
        ['inventarioApp_auditoriaConteoPorUsuario', JSON.stringify(state.auditoriaConteoPorUsuario)],
        ['inventarioApp_lastModified',              String(Date.now())],
    ];

    if (!_quotaWarned) {
        const used = estimateStorageUsed();
        if (used > LS_WARN_BYTES) {
            _quotaWarned = true;
            showNotification(`⚠️ Almacenamiento al ${Math.round(used/(5*1024*1024)*100)}%. Exporta y limpia historiales.`);
        }
    }

    for (const [key, value] of entries) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.error(`[Storage] Error al guardar "${key}":`, e);
            if (key === 'inventarioApp_inventories') {
                showNotification('⚠️ Historial muy grande. Usa "Exportar datos" y elimina historiales antiguos.');
            } else if (key === 'inventarioApp_inventarioConteo') {
                showNotification('⚠️ Conteo de inventario no pudo guardarse. Exporta tus datos ahora.');
            } else {
                showNotification('⚠️ Error al guardar datos. Exporta un respaldo inmediatamente.');
            }
            break;
        }
    }

    const newHash = computeDataHash();
    if (newHash !== state._lastDataHash) {
        state._lastDataHash = newHash;
        state._cloudSyncPending = true;
        import('./sync.js').then(({ updateCloudSyncBadge, syncToCloud }) => {
            updateCloudSyncBadge('pending');
            if (navigator.onLine && window._db) {
                syncToCloud().catch(err => console.warn('[Storage] syncToCloud falló:', err));
            }
        }).catch(e => console.error('[Storage] Error importando sync.js:', e));
    }

    console.debug('[Storage] ✓ Guardado local completado.');
}

export function loadFromLocalStorage() {
    console.info('[Storage] Cargando desde localStorage…');
    state.products    = safeGet('inventarioApp_products',    []);
    state.orders      = safeGet('inventarioApp_orders',      []);
    state.inventories = safeGet('inventarioApp_inventories', []);
    state.cart        = safeGet('inventarioApp_cart',        []);

    const storedTab    = localStorage.getItem('inventarioApp_activeTab');
    const storedGroup  = localStorage.getItem('inventarioApp_selectedGroup');
    const storedArea   = localStorage.getItem('inventarioApp_selectedArea');
    const storedSearch = localStorage.getItem('inventarioApp_searchTerm');
    if (storedTab)    state.activeTab     = storedTab;
    if (storedGroup)  state.selectedGroup = storedGroup;
    if (storedArea)   state.selectedArea  = storedArea;
    if (storedSearch) state.searchTerm    = storedSearch;

    const storedExpanded = safeGet('inventarioApp_expandedInventories', []);
    state.expandedInventories = new Set(Array.isArray(storedExpanded) ? storedExpanded : []);

    const storedAuditoriaStatus = safeGet('inventarioApp_auditoriaStatus',
        { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' });
    if (storedAuditoriaStatus && typeof storedAuditoriaStatus === 'object')
        state.auditoriaStatus = storedAuditoriaStatus;

    const storedAuditoriaConteo = safeGet('inventarioApp_auditoriaConteo', {});
    if (storedAuditoriaConteo && typeof storedAuditoriaConteo === 'object')
        state.auditoriaConteo = storedAuditoriaConteo;

    const storedAuditoriaView = localStorage.getItem('inventarioApp_auditoriaView');
    if (storedAuditoriaView) state.auditoriaView = storedAuditoriaView;
    const storedAuditoriaArea = localStorage.getItem('inventarioApp_auditoriaAreaActiva');
    if (storedAuditoriaArea) state.auditoriaAreaActiva = storedAuditoriaArea || null;
    state.isAuditoriaMode = (state.auditoriaView === 'counting' && !!state.auditoriaAreaActiva);

    const rawCPU = safeGet('inventarioApp_auditoriaConteoPorUsuario', {});
    if (rawCPU && typeof rawCPU === 'object') state.auditoriaConteoPorUsuario = rawCPU;

    // Migración legacy: inventarioConteo plano → por área
    const parsedConteo = safeGet('inventarioApp_inventarioConteo', {});
    const migrated = {};
    Object.keys(parsedConteo).forEach(prodId => {
        const val = parsedConteo[prodId];
        if (!val || typeof val !== 'object') return;
        if (typeof val.enteras !== 'undefined' &&
            val.almacen === undefined && val.barra1 === undefined && val.barra2 === undefined) {
            migrated[prodId] = { almacen: val };
        } else {
            migrated[prodId] = val;
        }
    });
    state.inventarioConteo = migrated;
    console.info(`[Storage] ✓ ${state.products.length} productos, ${state.orders.length} pedidos cargados.`);
}

let _lastSave = 0;
export function smartAutoSave() {
    const now = Date.now();
    if (now - _lastSave < 30_000) return;
    _lastSave = now;
    try { saveToLocalStorage(); } catch (e) { console.warn('[Storage] Error en autoguardado:', e); }
}

export { safeGet };
