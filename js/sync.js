/**
 * js/sync.js — v2.1 (corregido)
 * ══════════════════════════════════════════════════════════════
 * Sincronización bidireccional en tiempo real con Firebase Firestore.
 *
 * ─── CORRECCIONES APLICADAS (v2.1) ───────────────────────────
 *
 * BUG-1 (CRÍTICO) syncToCloud — efectos secundarios dentro del
 *   callback de runTransaction. Firestore puede reintentar el
 *   callback varias veces; los efectos (_lastLocalWriteTs,
 *   _storeLocalAreaTs) deben ejecutarse UNA SOLA VEZ, después de
 *   que la transacción confirme. Se movieron fuera del callback.
 *
 * BUG-2 _applyStockAreaData — aplicaba datos de productos que
 *   ya no existen en state.products (eliminados localmente).
 *   Ahora filtra solo productos existentes Y omite campos
 *   internos que empiecen con '_'.
 *
 * BUG-3 txCloseZone línea 568 — ternario muerto:
 *   `result.wasAlreadyClosed ? 'listening' : 'listening'`
 *   Ambas ramas idénticas. Eliminado; se llama directamente.
 *
 * BUG-4 _storeLocalAreaTs('mainDoc', writeTs) — la clave
 *   'mainDoc' nunca se lee. El anti-eco del doc principal
 *   usa _lastLocalWriteTs. Línea eliminada.
 *
 * BUG-5 _txMergeStockArea — función definida pero nunca llamada
 *   (la fusión ya ocurre inline en syncToCloud). Eliminada para
 *   evitar confusión.
 *
 * BUG-6 Checks de timestamp duplicados en los listeners
 *   (_shouldIgnoreSnapshot ya verifica el timestamp; la
 *   comparación posterior `cloudTs <= _getLocalAreaTs(...)` era
 *   idéntica y redundante). Eliminada la duplicación.
 *
 * ─── ARQUITECTURA DE LISTENERS (10 onSnapshot activos) ───────
 *   [1]    inventarioApp/{DOC_ID}                  → doc principal
 *   [2-4]  inventarioApp/{DOC_ID}/stockAreas/{area} x3
 *   [5-7]  inventarioApp/{DOC_ID}/conteoAreas/{area} x3
 *   [8-10] inventarioApp/{DOC_ID}/conteoPorUsuario/{area} x3
 *
 * ─── GARANTÍAS TRANSACCIONALES (runTransaction) ──────────────
 *   [T1] txCloseZone(area)       — cierre atómico con dot-notation
 *   [T3] syncConteoAtomicoPorArea — _userEntradas sin acumulación
 *   [T4] syncConteoPorUsuarioToFirestore — por userId, con _version
 *   [T5] syncToCloud             — transaccional, "completada wins"
 *   [T6] resetConteoAtomicoEnFirestore — batch + transaction
 *
 * ─── ANTI-BUCLE (dos capas) ──────────────────────────────────
 *   Capa 1 — metadata.hasPendingWrites
 *   Capa 2 — _lastLocalWriteTs / _storeLocalAreaTs (sessionStorage)
 *
 * ─── CICLO DE VIDA ───────────────────────────────────────────
 *   startRealtimeListeners()  ← auth.js al confirmar login
 *   stopRealtimeListeners()   ← auth.js al cerrar sesión
 * ══════════════════════════════════════════════════════════════
 */

import { state }                        from './state.js';
import { AREA_KEYS, MAX_CHUNK_SIZE }    from './constants.js';
import { showNotification }             from './ui.js';
import { syncStockByAreaFromConteo }    from './products.js';

// ─── Registro de listeners ────────────────────────────────────
const _activeListeners = new Map();

// ─── Anti-bucle: timestamp de la última escritura local ───────
// Se actualiza DESPUÉS de que runTransaction confirme (fuera del callback).
let _lastLocalWriteTs = 0;

// ─── Debounce de re-render (múltiples snapshots simultáneos) ──
let _renderDebounceTimer = null;
const RENDER_DEBOUNCE_MS = 150;

function _scheduleRender() {
    clearTimeout(_renderDebounceTimer);
    _renderDebounceTimer = setTimeout(async () => {
        try {
            const { renderTab } = await import('./render.js');
            renderTab();
        } catch (e) {
            console.error('[Snapshot] Error en renderTab diferido:', e);
        }
    }, RENDER_DEBOUNCE_MS);
}

// ═════════════════════════════════════════════════════════════
//  HELPERS DE CHUNK
// ═════════════════════════════════════════════════════════════

async function _writeChunkedSubcollection(docRef, subcollName, dataArray) {
    const colRef      = docRef.collection(subcollName);
    const totalChunks = Math.max(1, Math.ceil(dataArray.length / MAX_CHUNK_SIZE));

    const writeBatch = window._db.batch();
    for (let i = 0; i < totalChunks; i++) {
        writeBatch.set(colRef.doc('new_chunk_' + i), {
            items:       dataArray.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
            chunkIndex:  i,
            totalChunks: totalChunks,
            _updatedAt:  Date.now(),
        });
    }
    await writeBatch.commit();

    const existingSnap = await colRef.get();
    const cleanBatch   = window._db.batch();
    existingSnap.forEach(d => {
        if (d.id.startsWith('new_')) {
            cleanBatch.set(colRef.doc(d.id.replace('new_', '')), d.data());
            cleanBatch.delete(d.ref);
        } else {
            cleanBatch.delete(d.ref);
        }
    });
    if (!existingSnap.empty) await cleanBatch.commit();
    console.info(`[Firebase][Chunk] ${subcollName} → ${totalChunks} chunk(s) escritos.`);
}

async function _readChunkedSubcollection(docRef, subcollName) {
    if (!docRef) return [];
    try {
        const snap = await docRef.collection(subcollName).orderBy('chunkIndex').get();
        if (snap.empty) return [];
        const result = [];
        snap.forEach(d => {
            const items = d.data().items;
            if (Array.isArray(items)) items.forEach(i => result.push(i));
        });
        return result;
    } catch (e) {
        console.warn(`[Firebase][Chunk] Error leyendo ${subcollName}:`, e);
        return [];
    }
}

// ═════════════════════════════════════════════════════════════
//  BADGE DE SINCRONIZACIÓN
// ═════════════════════════════════════════════════════════════

export function updateCloudSyncBadge(status) {
    const badge = document.getElementById('cloudSyncBadge');
    const dot   = document.getElementById('syncDot');

    const cfg = {
        ok:        { bg: '#06d6a0', icon: '☁️',  text: 'Sincronizado',    pulse: false, dotState: 'ok',      dotTitle: 'Sincronizado ✓' },
        syncing:   { bg: '#4cc9f0', icon: '🔄',  text: 'Sincronizando…',  pulse: true,  dotState: 'syncing', dotTitle: 'Subiendo datos…' },
        pending:   { bg: '#ffd166', icon: '⏳',  text: 'Pendiente',        pulse: false, dotState: 'pending', dotTitle: 'Cambios pendientes' },
        listening: { bg: '#a78bfa', icon: '👂',  text: 'En tiempo real',  pulse: false, dotState: 'ok',      dotTitle: 'Escuchando cambios en vivo' },
        tx:        { bg: '#38bdf8', icon: '🔒',  text: 'Transacción…',    pulse: true,  dotState: 'syncing', dotTitle: 'Transacción en curso' },
        error:     { bg: '#ff6b6b', icon: '⚠️',  text: 'Error sync',      pulse: false, dotState: 'error',   dotTitle: 'Error de sincronización' },
        conflict:  { bg: '#fb923c', icon: '⚡',  text: 'Conflicto',       pulse: false, dotState: 'error',   dotTitle: 'Conflicto detectado' },
        offline:   { bg: '#8b8ca8', icon: '📴',  text: 'Sin conexión',    pulse: false, dotState: 'offline', dotTitle: 'Sin conexión' },
        none:      { bg: '#50516a', icon: '☁️',  text: 'Sin Firebase',    pulse: false, dotState: 'none',    dotTitle: 'Sin Firebase' },
    };

    if (!window._db) status = 'none';
    const c = cfg[status] || cfg.none;

    if (badge) {
        badge.style.background   = c.bg + '22';
        badge.style.borderColor  = c.bg + '66';
        badge.style.color        = c.bg;
        badge.innerHTML          = `<span style="margin-right:4px">${c.icon}</span>${c.text}`;
        badge.style.animation    = c.pulse ? 'pulse 1.5s ease-in-out infinite' : 'none';
    }
    if (dot) {
        dot.setAttribute('data-state', c.dotState);
        dot.setAttribute('title',      c.dotTitle);
        dot.setAttribute('aria-label', 'Sync: ' + c.dotTitle);
    }
}

// ═════════════════════════════════════════════════════════════
//  BARRA DE RED
// ═════════════════════════════════════════════════════════════

export function updateNetworkStatus() {
    const existing = document.getElementById('networkStatus');
    if (existing) existing.remove();

    if (!navigator.onLine) {
        const bar = document.createElement('div');
        bar.id = 'networkStatus';
        bar.style.cssText =
            'position:fixed;bottom:0;left:0;right:0;background:#f59e0b;color:#fff;' +
            'text-align:center;padding:6px;font-size:13px;font-weight:600;z-index:9999;';
        bar.textContent = '⚠️ Sin conexión — los datos están guardados localmente';
        document.body.appendChild(bar);
        updateCloudSyncBadge('offline');
        console.info('[Network] Modo offline activado.');
    } else {
        if (state._cloudSyncPending && window._db) {
            console.info('[Network] Reconectado — sincronizando cambios pendientes…');
            syncToCloud().catch(e => console.warn('[Network] Sync al reconectar falló:', e));
        } else {
            updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : (window._db ? 'ok' : 'none'));
        }
    }
}

// ═════════════════════════════════════════════════════════════
//  HELPERS: anti-eco
// ═════════════════════════════════════════════════════════════

/**
 * Decide si un snapshot debe ignorarse.
 * Capa 1: hasPendingWrites → eco optimista local.
 * Capa 2: timestamp del snapshot ≤ localLastModified → eco de confirmación.
 */
function _shouldIgnoreSnapshot(snap, localLastModified = _lastLocalWriteTs) {
    if (snap.metadata.hasPendingWrites) {
        console.debug('[Snapshot] Ignorando eco local (hasPendingWrites).');
        return true;
    }
    const snapTs = snap.data()?._lastModified || 0;
    if (snapTs > 0 && snapTs <= localLastModified) {
        console.debug(`[Snapshot] Ignorando eco de confirmación (snapTs=${snapTs} ≤ local=${localLastModified}).`);
        return true;
    }
    return false;
}

// Timestamps por área en sessionStorage (aislados de localStorage)
function _getLocalAreaTs(key) {
    try { return parseInt(sessionStorage.getItem(`_areaTs:${key}`) || '0', 10); } catch (_) { return 0; }
}
function _storeLocalAreaTs(key, ts) {
    try { sessionStorage.setItem(`_areaTs:${key}`, String(ts)); } catch (_) {}
}

// ═════════════════════════════════════════════════════════════
//  HELPERS: aplicar datos de la nube al estado local
// ═════════════════════════════════════════════════════════════

async function _applyMainDocData(data) {
    if (!data) return;
    const docRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);

    if (Array.isArray(data.products))  state.products        = data.products;
    if (Array.isArray(data.cart))      state.cart            = data.cart;
    if (data.activeTab)                state.activeTab       = data.activeTab;
    if (data.selectedArea)             state.selectedArea    = data.selectedArea;
    if (data.auditoriaConteo)          state.auditoriaConteo = data.auditoriaConteo;

    // "completada always wins" — ningún dispositivo puede re-abrir una zona
    if (data.auditoriaStatus) {
        const merged = { ...state.auditoriaStatus };
        AREA_KEYS.forEach(a => {
            if (data.auditoriaStatus[a] === 'completada') merged[a] = 'completada';
        });
        state.auditoriaStatus = merged;
    }

    if (data._ordersInChunks) {
        // BUG-FIX: orders de la nube NO se aplican — cada dispositivo
        // conserva su propio historial local de pedidos WhatsApp.
        // (bloque intencionalmente vacío)
    } else if (Array.isArray(data.orders)) {
        // ídem: ignorar orders del doc principal
    }

    if (data._inventoriesInChunks) {
        const r = await _readChunkedSubcollection(docRef, 'inventoriesChunks');
        if (r.length) state.inventories = r;
    } else if (Array.isArray(data.inventories)) {
        state.inventories = data.inventories;
    }
}

/**
 * Aplica datos de un área de stockAreas.
 *
 * FIX BUG-2: Solo procesa productos que existen en state.products.
 * Omite campos internos (empiezan con '_').
 * Esto evita que productos eliminados localmente sean "resucitados"
 * por datos de la nube de otro dispositivo.
 */
function _applyStockAreaData(area, areaData) {
    // Construir set de IDs existentes para filtrado O(1)
    const existingIds = new Set(state.products.map(p => p.id));

    Object.keys(areaData).forEach(prodId => {
        // Omitir campos internos (timestamps, flags)
        if (prodId.startsWith('_')) return;
        // Omitir productos que ya no existen localmente
        if (!existingIds.has(prodId)) {
            console.debug(`[Snapshot][stockArea:${area}] Ignorando producto eliminado localmente: ${prodId}`);
            return;
        }
        if (!state.inventarioConteo[prodId]) state.inventarioConteo[prodId] = {};
        state.inventarioConteo[prodId][area] = areaData[prodId];
    });
    syncStockByAreaFromConteo();
}

function _applyConteoAreaData(area, areaData) {
    state.products.forEach(p => {
        if (!areaData[p.id]) return;
        if (!state.auditoriaConteo[p.id])       state.auditoriaConteo[p.id] = {};
        if (!state.auditoriaConteo[p.id][area]) state.auditoriaConteo[p.id][area] = {};

        const cloudEntry = areaData[p.id];
        if (cloudEntry.alerta_conflicto) {
            state.auditoriaConteo[p.id][area]._conflictoAbiertas =
                cloudEntry.stock_abierto_alternativo;
            console.warn(`[Snapshot][conteoArea] Conflicto detectado: ${p.id}/${area}`);
        } else {
            delete state.auditoriaConteo[p.id][area]._conflictoAbiertas;
        }
        if (typeof cloudEntry.enteras === 'number') {
            state.auditoriaConteo[p.id][area].enteras = cloudEntry.enteras;
        }
    });
}

function _applyUserConteoData(area, areaData) {
    const myId = state.auditCurrentUser?.userId;
    state.products.forEach(p => {
        const prodData = areaData[p.id];
        if (!prodData) return;
        if (!state.auditoriaConteoPorUsuario[p.id])       state.auditoriaConteoPorUsuario[p.id] = {};
        if (!state.auditoriaConteoPorUsuario[p.id][area]) state.auditoriaConteoPorUsuario[p.id][area] = {};
        Object.keys(prodData).forEach(uid => {
            if (uid === myId)           return; // nunca sobreescribir el propio
            if (uid.startsWith('_'))    return; // ignorar campos internos
            state.auditoriaConteoPorUsuario[p.id][area][uid] = prodData[uid];
            console.debug(`[Snapshot][multiUser] Conteo de ${uid} para ${p.id}/${area}`);
        });
    });
}

async function _persistCloudUpdate(cloudTs) {
    const { saveToLocalStorage } = await import('./storage.js');
    // Hash actualizado ANTES de saveToLocalStorage para no disparar syncToCloud
    state._lastDataHash =
        JSON.stringify(state.products)  +
        JSON.stringify(state.orders)    +
        JSON.stringify(state.inventories) +
        JSON.stringify(state.inventarioConteo);
    state._cloudSyncPending = false;
    saveToLocalStorage();
    if (cloudTs) localStorage.setItem('inventarioApp_lastModified', String(cloudTs));
    state._lastCloudSync = Date.now();
}

// ═════════════════════════════════════════════════════════════
//  LISTENERS onSnapshot
// ═════════════════════════════════════════════════════════════

function _subscribeMainDoc() {
    if (!window._db) return;
    const docRef = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
    console.info('[Snapshot] Activando listener del doc principal…');

    const unsub = docRef.onSnapshot(
        { includeMetadataChanges: true },
        async snap => {
            try {
                if (!snap.exists) { await syncToCloud(); return; }
                if (_shouldIgnoreSnapshot(snap)) return; // usa _lastLocalWriteTs por defecto
                const data    = snap.data();
                const cloudTs = data._lastModified || 0;
                const localTs = parseInt(localStorage.getItem('inventarioApp_lastModified') || '0', 10);
                if (cloudTs <= localTs) return;
                console.info(`[Snapshot][main] Cambio recibido (Δts=${cloudTs - localTs}ms). Aplicando…`);
                await _applyMainDocData(data);
                await _persistCloudUpdate(cloudTs);
                updateCloudSyncBadge('listening');
                _scheduleRender();
            } catch (err) {
                console.error('[Snapshot][main] Error al procesar:', err);
                updateCloudSyncBadge('error');
            }
        },
        err => { console.error('[Snapshot][main] Error en listener:', err); updateCloudSyncBadge('error'); }
    );
    _activeListeners.set('main', unsub);
}

function _subscribeStockAreas() {
    if (!window._db) return;
    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('stockAreas');

    for (const area of AREA_KEYS) {
        console.info(`[Snapshot] Activando listener stockAreas/${area}…`);
        const unsub = baseRef.doc(area).onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    // FIX BUG-6: _shouldIgnoreSnapshot ya verifica el timestamp del área.
                    // La comparación posterior era idéntica y redundante. Eliminada.
                    if (_shouldIgnoreSnapshot(snap, _getLocalAreaTs(area))) return;
                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;
                    // Guardar nuevo timestamp para anti-eco futuro
                    _storeLocalAreaTs(area, cloudTs);
                    console.info(`[Snapshot][stockArea:${area}] Conteo actualizado por otro dispositivo.`);
                    _applyStockAreaData(area, areaData);
                    updateCloudSyncBadge('listening');
                    _scheduleRender();
                } catch (err) {
                    console.error(`[Snapshot][stockArea:${area}] Error:`, err);
                }
            },
            err => console.error(`[Snapshot][stockArea:${area}] Error en listener:`, err)
        );
        _activeListeners.set(`stockArea:${area}`, unsub);
    }
}

function _subscribeConteoAreas() {
    if (!window._db) return;
    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoAreas');

    for (const area of AREA_KEYS) {
        console.info(`[Snapshot] Activando listener conteoAreas/${area}…`);
        const unsub = baseRef.doc(area).onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    // FIX BUG-6: check duplicado eliminado
                    if (_shouldIgnoreSnapshot(snap, _getLocalAreaTs(`conteo:${area}`))) return;
                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;
                    _storeLocalAreaTs(`conteo:${area}`, cloudTs);
                    console.info(`[Snapshot][conteoArea:${area}] Conteo de auditoría actualizado.`);
                    _applyConteoAreaData(area, areaData);
                    updateCloudSyncBadge('listening');
                    _scheduleRender();
                } catch (err) {
                    console.error(`[Snapshot][conteoArea:${area}] Error:`, err);
                }
            },
            err => console.error(`[Snapshot][conteoArea:${area}] Error en listener:`, err)
        );
        _activeListeners.set(`conteoArea:${area}`, unsub);
    }
}

function _subscribeConteoPorUsuario() {
    if (!window._db) return;
    const baseRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoPorUsuario');

    for (const area of AREA_KEYS) {
        console.info(`[Snapshot] Activando listener conteoPorUsuario/${area}…`);
        const unsub = baseRef.doc(area).onSnapshot(
            { includeMetadataChanges: true },
            snap => {
                try {
                    if (!snap.exists) return;
                    // FIX BUG-6: check duplicado eliminado
                    if (_shouldIgnoreSnapshot(snap, _getLocalAreaTs(`user:${area}`))) return;
                    const areaData = snap.data();
                    const cloudTs  = areaData._lastModified || 0;
                    _storeLocalAreaTs(`user:${area}`, cloudTs);
                    console.info(`[Snapshot][userConteo:${area}] Conteo de otro dispositivo recibido.`);
                    _applyUserConteoData(area, areaData);
                    updateCloudSyncBadge('listening');
                    _scheduleRender();
                } catch (err) {
                    console.error(`[Snapshot][userConteo:${area}] Error:`, err);
                }
            },
            err => console.error(`[Snapshot][userConteo:${area}] Error en listener:`, err)
        );
        _activeListeners.set(`userConteo:${area}`, unsub);
    }
}

// ═════════════════════════════════════════════════════════════
//  CICLO DE VIDA DE LISTENERS
// ═════════════════════════════════════════════════════════════

export function startRealtimeListeners() {
    if (!window._db) {
        console.warn('[Snapshot] Firebase no disponible — listeners no iniciados.');
        return;
    }

    // Idempotente: si ya hay listeners activos, limpiar primero.
    if (_activeListeners.size > 0) {
        console.info('[Snapshot] Reiniciando listeners…');
        stopRealtimeListeners();
    }

    // ── Determinar el conjunto de listeners según el rol ──────────
    // state.userRole puede ser 'admin', 'user' o null.
    // null ocurre si Firebase Auth no está configurado (modo dev);
    // en ese caso se inician todos los listeners como admin.
    const role    = state.userRole;
    const isAdmin = (role === 'admin' || role === null);

    if (isAdmin) {
        // ── ADMIN: 10+2 listeners — acceso completo ───────────────
        console.info('[Snapshot] ══ Iniciando listeners (rol: admin) ══');

        _subscribeMainDoc();           // [1]    doc principal
        _subscribeStockAreas();        // [2-4]  conteo operativo
        _subscribeConteoAreas();       // [5-7]  auditoría atómica
        _subscribeConteoPorUsuario();  // [8-10] multiusuario

        // Módulos de arquitectura profesional
        import('./notificaciones.js').then(m => {
            const unsub = m.suscribirNotificaciones();
            if (unsub) _activeListeners.set('notificaciones', unsub);
        }).catch(e => console.warn('[Snapshot] Error al suscribir notificaciones:', e));

        import('./ajustes.js').then(m => {
            const unsub = m.suscribirAjustesAdmin();
            if (unsub) _activeListeners.set('ajustes', unsub);
        }).catch(e => console.warn('[Snapshot] Error al suscribir ajustes:', e));

        import('./reportes.js').then(m => {
            const unsub = m.suscribirReportesPublicados();
            if (unsub) _activeListeners.set('reportes', unsub);
        }).catch(e => console.warn('[Snapshot] Error al suscribir reportes:', e));

    } else {
        // ── USER: 4+2 listeners — catálogo + stock + feed propio ──
        console.info('[Snapshot] ══ Iniciando listeners (rol: user, modo ciego) ══');
        console.info('[Snapshot] Listeners de auditoría OMITIDOS (conteoAreas, conteoPorUsuario).');

        _subscribeMainDoc();    // [1]   doc principal (productos, cart, auditoriaStatus)
        _subscribeStockAreas(); // [2-4] conteo operativo (inventario diario)

        // ✗ _subscribeConteoAreas()       → OMITIDO (totales de auditoría ciega)
        // ✗ _subscribeConteoPorUsuario()  → OMITIDO (conteos individuales de otros)

        // Notificaciones propias + reportes publicados (lectura)
        import('./notificaciones.js').then(m => {
            const unsub = m.suscribirNotificaciones();
            if (unsub) _activeListeners.set('notificaciones', unsub);
        }).catch(e => console.warn('[Snapshot] Error al suscribir notificaciones (user):', e));

        import('./reportes.js').then(m => {
            const unsub = m.suscribirReportesPublicados();
            if (unsub) _activeListeners.set('reportes', unsub);
        }).catch(e => console.warn('[Snapshot] Error al suscribir reportes (user):', e));
    }

    updateCloudSyncBadge('listening');
    console.info(`[Snapshot] ✓ ${_activeListeners.size} listeners activos (rol: ${role ?? 'dev-admin'}).`);
}
export function stopRealtimeListeners() {
    if (_activeListeners.size === 0) return;
    console.info(`[Snapshot] Deteniendo ${_activeListeners.size} listeners…`);
    _activeListeners.forEach((unsub, key) => {
        try { unsub(); console.debug(`[Snapshot] Listener "${key}" detenido.`); }
        catch (e) { console.warn(`[Snapshot] Error al detener "${key}":`, e); }
    });
    _activeListeners.clear();
    clearTimeout(_renderDebounceTimer);
    _renderDebounceTimer = null;
    try {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k?.startsWith('_areaTs:')) keysToRemove.push(k);
        }
        keysToRemove.forEach(k => sessionStorage.removeItem(k));
    } catch (_) {}
    updateCloudSyncBadge('none');
    console.info('[Snapshot] ✓ Todos los listeners detenidos.');
}

export function isListening() {
    return _activeListeners.size > 0;
}

// ═════════════════════════════════════════════════════════════
//  TOGGLE DE SINCRONIZACIÓN (usuario puede pausar)
// ═════════════════════════════════════════════════════════════

/**
 * Activa o desactiva la sincronización automática con la nube.
 * Al activar: sube automáticamente todos los pendientes.
 * Al desactivar: los cambios se guardan solo en localStorage.
 * @param {boolean} [forzarValor] — si se pasa, usa ese valor; si no, alterna
 */
export async function toggleSync(forzarValor) {
    const nuevo = forzarValor !== undefined ? forzarValor : !state.syncEnabled;
    state.syncEnabled = nuevo;

    try { localStorage.setItem('inventarioApp_syncEnabled', nuevo ? '1' : '0'); } catch (_) {}

    if (nuevo) {
        showNotification('☁️ Sincronización activada');
        updateCloudSyncBadge('syncing');
        // Subir cambios pendientes y ajustes locales
        if (window._db && navigator.onLine) {
            syncToCloud().catch(e => console.warn('[toggleSync] syncToCloud falló:', e));
            import('./ajustes.js')
                .then(m => m.subirAjustesPendientes())
                .catch(() => {});
        }
    } else {
        showNotification('📴 Sincronización pausada — datos guardados localmente');
        updateCloudSyncBadge('pending');
    }

    // Actualizar UI del toggle
    import('./render.js').then(m => m.renderTab()).catch(() => {});
}

window.toggleSync = toggleSync;

// ═════════════════════════════════════════════════════════════
//  [T1] txCloseZone — CIERRE ATÓMICO DE ZONA
// ═════════════════════════════════════════════════════════════

/**
 * Cierra atómicamente una zona de auditoría en Firestore.
 * Usa dot-notation para NO sobreescribir las demás zonas.
 * Idempotente: si la zona ya estaba cerrada, no reescribe.
 *
 * @param {string} area - 'almacen' | 'barra1' | 'barra2'
 * @returns {{ wasAlreadyClosed: boolean, mergedStatus: object }}
 */
export async function txCloseZone(area) {
    if (!window._db) {
        console.info('[TxCloseZone] Firebase no disponible — solo local.');
        return { wasAlreadyClosed: false, mergedStatus: state.auditoriaStatus };
    }
    if (!navigator.onLine) {
        console.info('[TxCloseZone] Sin conexión — cierre guardado localmente.');
        return { wasAlreadyClosed: false, mergedStatus: state.auditoriaStatus };
    }

    const docRef  = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
    const writeTs = Date.now();
    updateCloudSyncBadge('tx');

    try {
        const result = await window._db.runTransaction(async tx => {
            const snap        = await tx.get(docRef);
            const cloudStatus = snap.exists ? (snap.data()?.auditoriaStatus || {}) : {};

            if (cloudStatus[area] === 'completada') {
                console.info(`[TxCloseZone] Zona "${area}" ya cerrada (idempotente).`);
                return { wasAlreadyClosed: true, mergedStatus: cloudStatus };
            }

            // dot-notation: solo toca este campo, no las demás zonas
            tx.update(docRef, {
                [`auditoriaStatus.${area}`]: 'completada',
                _lastModified: writeTs,
            });

            const mergedStatus = {
                almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente',
                ...cloudStatus,
                [area]: 'completada',
            };
            return { wasAlreadyClosed: false, mergedStatus };
        });

        // FIX BUG-1: efectos secundarios FUERA del callback de la transacción
        _lastLocalWriteTs = writeTs;
        // FIX BUG-4: eliminada llamada a _storeLocalAreaTs('mainDoc', writeTs)
        //            'mainDoc' nunca se leía; el anti-eco usa _lastLocalWriteTs

        if (result.mergedStatus) {
            state.auditoriaStatus = result.mergedStatus;
        }

        // FIX BUG-3: ternario muerto eliminado; ambas ramas eran 'listening'
        updateCloudSyncBadge('listening');
        console.info(`[TxCloseZone] ✓ Zona "${area}" ${result.wasAlreadyClosed ? 'ya estaba cerrada' : 'cerrada en Firestore'}.`);
        return result;

    } catch (err) {
        console.error('[TxCloseZone] Error en transacción:', err.code || err.message, err);
        updateCloudSyncBadge('error');
        showNotification('⚠️ Error al cerrar zona — estado guardado localmente');
        return { wasAlreadyClosed: false, mergedStatus: state.auditoriaStatus, error: err };
    }
}

// ═════════════════════════════════════════════════════════════
//  [T5] syncToCloud — SUBIDA PRINCIPAL (TRANSACCIONAL)
// ═════════════════════════════════════════════════════════════

/**
 * Sube el estado local a Firestore con runTransaction.
 *
 * FIX BUG-1 (CRÍTICO):
 *   Los efectos secundarios _lastLocalWriteTs y _storeLocalAreaTs
 *   estaban DENTRO del callback de runTransaction. Firestore puede
 *   reintentar ese callback varias veces en caso de contención; si
 *   el eco se registraba en el primer intento fallido, el listener
 *   ignoraba el snapshot del intento exitoso (falso anti-eco).
 *   Ambos efectos se mueven a DESPUÉS del await runTransaction().
 *   Se usa `writtenAreas` en transactionResult para saber qué áreas
 *   se escribieron en el intento que finalmente confirmó.
 *
 * @param {number} [retryCount=0]
 */
export async function syncToCloud(retryCount = 0) {
    if (!window._db)             return;
    if (state._syncInProgress)   return;
    // Respetar el toggle de sincronización del usuario
    if (!state.syncEnabled) {
        state._cloudSyncPending = true;
        updateCloudSyncBadge('pending');
        console.info('[Firebase] syncToCloud omitido — sincronización desactivada por el usuario.');
        return;
    }
    if (!navigator.onLine) {
        state._cloudSyncPending = true;
        updateCloudSyncBadge('pending');
        return;
    }

    state._syncInProgress = true;
    updateCloudSyncBadge('syncing');
    console.info('[Firebase] syncToCloud (transaccional) iniciado…');

    try {
        const localTs  = parseInt(localStorage.getItem('inventarioApp_lastModified') || '0', 10);
        const docRef   = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
        const stockRef = docRef.collection('stockAreas');
        const areaRefs = AREA_KEYS.map(a => stockRef.doc(a));

        let transactionResult = null;

        await window._db.runTransaction(async tx => {
            // ── Lectura paralela: doc principal + 3 stockAreas ───────────
            const [mainSnap, ...areaSnaps] = await Promise.all([
                tx.get(docRef),
                ...areaRefs.map(r => tx.get(r)),
            ]);

            // ── ¿La nube tiene datos más recientes? ──────────────────────
            if (mainSnap.exists) {
                const cloudTs = mainSnap.data()._lastModified || 0;
                if (cloudTs > localTs) {
                    console.info(`[Firebase][Tx] Nube más reciente (Δ${cloudTs - localTs}ms). Sin escritura.`);
                    transactionResult = { action: 'applyCloud', cloudData: mainSnap.data() };
                    return; // transacción solo-lectura; no escribe nada
                }
            }

            // ── Fusionar auditoriaStatus: "completada always wins" ────────
            const cloudStatus  = mainSnap.exists ? (mainSnap.data()?.auditoriaStatus || {}) : {};
            const mergedStatus = {};
            AREA_KEYS.forEach(a => {
                mergedStatus[a] =
                    (cloudStatus[a] === 'completada' || state.auditoriaStatus[a] === 'completada')
                        ? 'completada'
                        : (state.auditoriaStatus[a] || cloudStatus[a] || 'pendiente');
            });

            // ── Payload del doc principal ─────────────────────────────────
            // NOTA: _lastLocalWriteTs se asigna FUERA del callback (abajo)
            // BUG-FIX: orders NO se incluyen en el payload — quedan solo en
            // localStorage del dispositivo (no se sincronizan entre teléfonos).
            const payload = {
                products:             state.products,
                cart:                 state.cart,
                activeTab:            state.activeTab,
                selectedArea:         state.selectedArea,
                auditoriaStatus:      mergedStatus,
                auditoriaConteo:      state.auditoriaConteo,
                _lastModified:        localTs,
                _syncedAt:            Date.now(),
                _ordersInChunks:      false,   // ← orders NO suben a la nube
                _inventoriesInChunks: true,
                _conteoInSubcol:      true,
            };
            tx.set(docRef, payload, { merge: true });

            // ── Fusionar stockAreas producto a producto ───────────────────
            // Registrar qué áreas se escribieron para actualizar anti-eco fuera
            const writtenAreas = [];
            areaSnaps.forEach((areaSnap, idx) => {
                const area      = AREA_KEYS[idx];
                const cloudArea = areaSnap.exists ? areaSnap.data() : {};
                if ((cloudArea._lastModified || 0) > localTs) {
                    console.debug(`[Firebase][Tx] stockArea "${area}" más reciente en nube — preservando.`);
                    return;
                }
                const mergedArea = { ...cloudArea, _lastModified: localTs };
                Object.keys(state.inventarioConteo).forEach(prodId => {
                    if (state.inventarioConteo[prodId]?.[area]) {
                        mergedArea[prodId] = state.inventarioConteo[prodId][area];
                    }
                });
                tx.set(areaRefs[idx], mergedArea);
                writtenAreas.push(area);
                // FIX BUG-1: _storeLocalAreaTs eliminado de aquí; se llama abajo
            });

            transactionResult = { action: 'wrote', mergedStatus, writtenAreas };
        });

        // ── FIX BUG-1: efectos secundarios DESPUÉS de que la transacción confirme ──
        if (transactionResult?.action === 'wrote') {
            _lastLocalWriteTs = localTs; // ← ahora sí, una sola vez tras el commit
            transactionResult.writtenAreas.forEach(area => {
                _storeLocalAreaTs(area, localTs); // ← ídem
            });
        }

        // ── Acciones post-transacción ─────────────────────────────────────
        if (transactionResult?.action === 'applyCloud') {
            state._syncInProgress = false;
            await _applyMainDocData(transactionResult.cloudData);
            await _persistCloudUpdate(transactionResult.cloudData._lastModified);
            _scheduleRender();
            return;
        }

        if (transactionResult?.mergedStatus) {
            state.auditoriaStatus = transactionResult.mergedStatus;
        }

        // Historiales chunkeados (append-only, fuera de la transacción es seguro)
        // BUG-FIX: orders NO se suben — solo inventories se sincronizan a la nube
        await _writeChunkedSubcollection(docRef, 'inventoriesChunks', state.inventories);

        state._cloudSyncPending = false;
        state._lastCloudSync    = Date.now();
        state._syncInProgress   = false;
        updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : 'ok');
        console.info(`[Firebase] ✓ syncToCloud completado: ${new Date(state._lastCloudSync).toLocaleTimeString()}`);

    } catch (err) {
        state._syncInProgress = false;
        console.error('[Firebase] Error en syncToCloud:', err.code || err.message, err);

        if (retryCount < 3) {
            const delay = Math.pow(2, retryCount + 1) * 1000;
            console.info(`[Firebase] Reintentando en ${delay / 1000}s… (${retryCount + 1}/3)`);
            setTimeout(() => syncToCloud(retryCount + 1), delay);
        } else {
            state._cloudSyncPending = true;
            updateCloudSyncBadge('error');
            showNotification('☁️ Sin sync — datos guardados localmente');
        }
    }
}

// ═════════════════════════════════════════════════════════════
//  [T3] syncConteoAtomicoPorArea — SIN ACUMULACIÓN
// ═════════════════════════════════════════════════════════════

/**
 * Sincroniza el conteo de auditoría de un área.
 * _userEntradas: mapa {userId → enteras}. Re-envío REEMPLAZA, no acumula.
 * _abiertasByUser: mapa {userId → [oz]}. Detecta conflictos entre usuarios.
 *
 * @param {string} area
 */
export async function syncConteoAtomicoPorArea(area) {
    if (!window._db) { console.info('[TxConteo] Firebase no disponible.'); return; }
    if (!navigator.onLine) {
        showNotification('📴 Sin conexión — conteo guardado localmente');
        updateCloudSyncBadge('offline');
        return;
    }

    const userId   = state.auditCurrentUser?.userId   || 'usr-anon';
    const userName = state.auditCurrentUser?.userName  || 'Anónimo';

    const areaRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoAreas')
        .doc(area);

    const productosConDatos = state.products.filter(p =>
        state.auditoriaConteo[p.id]?.[area]
    );
    if (productosConDatos.length === 0) return;

    const writeTs = Date.now();
    updateCloudSyncBadge('tx');

    try {
        await window._db.runTransaction(async tx => {
            const snap     = await tx.get(areaRef);
            const existing = snap.exists ? snap.data() : {};
            const newData  = { _lastModified: writeTs, _area: area };

            for (const p of productosConDatos) {
                const localConteo = state.auditoriaConteo[p.id][area];
                const cloudEntry  = existing[p.id] || {};

                // REEMPLAZAR entrada propia, preservar las de otros
                const userEntradas = { ...(cloudEntry._userEntradas || {}) };
                userEntradas[userId] = localConteo.enteras || 0;
                const totalEnteras  = Object.values(userEntradas)
                    .reduce((acc, n) => acc + (typeof n === 'number' ? n : 0), 0);

                const abiertasByUser = { ...(cloudEntry._abiertasByUser || {}) };
                abiertasByUser[userId] = localConteo.abiertas || [];

                // Detectar conflicto en abiertas
                let alertaConflicto  = false;
                let stockAlternativo = null;
                const userAbiertas   = Object.entries(abiertasByUser);
                if (userAbiertas.length >= 2) {
                    const sums   = userAbiertas.map(([, arr]) =>
                        (Array.isArray(arr) ? arr : []).reduce((a, b) => a + b, 0));
                    const minSum = Math.min(...sums);
                    const maxSum = Math.max(...sums);
                    if (maxSum - minSum > 0.01) {
                        alertaConflicto  = true;
                        const other      = userAbiertas.find(([uid]) => uid !== userId);
                        stockAlternativo = other ? other[1] : [];
                        console.warn(`[TxConteo] Conflicto en abiertas — ${p.id}/${area}:`,
                            `sums=[${sums.map(s => s.toFixed(2)).join(',')}]`);
                    }
                }

                newData[p.id] = {
                    enteras:       totalEnteras,
                    abiertas:      localConteo.abiertas || [],
                    _userEntradas:     userEntradas,
                    _abiertasByUser:   abiertasByUser,
                    _lastContadorId:   userId,
                    _lastContadorName: userName,
                    _lastTs:           writeTs,
                    _totalContadores:  Object.keys(userEntradas).length,
                    alerta_conflicto:          alertaConflicto,
                    stock_abierto_alternativo: alertaConflicto ? stockAlternativo : null,
                };
            }

            tx.set(areaRef, newData, { merge: true });
        });

        // Anti-eco FUERA del callback
        _storeLocalAreaTs(`conteo:${area}`, writeTs);

        updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : 'ok');
        console.info(`[TxConteo] ✓ "${userName}" → "${area}" (${productosConDatos.length} productos)`);

    } catch (err) {
        console.error('[TxConteo] Error:', err.code || err.message, err);
        updateCloudSyncBadge('error');
        showNotification('⚠️ Error al sincronizar conteo — guardado localmente');
        throw err;
    }
}

// ═════════════════════════════════════════════════════════════
//  [T4] syncConteoPorUsuarioToFirestore — TRANSACCIONAL
// ═════════════════════════════════════════════════════════════

export async function syncConteoPorUsuarioToFirestore(area) {
    if (!window._db || !state.auditCurrentUser || !navigator.onLine) return;

    const { userId, userName } = state.auditCurrentUser;
    const userRef = window._db
        .collection('inventarioApp')
        .doc(window.FIRESTORE_DOC_ID)
        .collection('conteoPorUsuario')
        .doc(area);

    const writeTs    = Date.now();
    const misConteos = {};
    state.products.forEach(p => {
        const byArea = state.auditoriaConteoPorUsuario[p.id]?.[area];
        if (byArea?.[userId]) misConteos[p.id] = byArea[userId];
    });
    if (Object.keys(misConteos).length === 0) return;

    try {
        await window._db.runTransaction(async tx => {
            const snap     = await tx.get(userRef);
            const existing = snap.exists ? snap.data() : {};
            const merged   = { ...existing, _lastModified: writeTs, _area: area };

            Object.entries(misConteos).forEach(([prodId, conteo]) => {
                if (!merged[prodId]) merged[prodId] = {};
                const prevVersion = existing[prodId]?.[userId]?._version || 0;
                merged[prodId][userId] = {
                    ...conteo,
                    userId, userName, ts: writeTs,
                    _version: prevVersion + 1,
                };
            });

            tx.set(userRef, merged);
        });

        _storeLocalAreaTs(`user:${area}`, writeTs);
        console.info(`[TxUserConteo] ✓ "${userName}" → conteoPorUsuario/${area}`);

    } catch (err) {
        console.warn('[TxUserConteo] Error:', err.code || err.message, err);
    }
}

// ═════════════════════════════════════════════════════════════
//  [T6] resetConteoAtomicoEnFirestore — BATCH + TRANSACTION
// ═════════════════════════════════════════════════════════════

export async function resetConteoAtomicoEnFirestore() {
    if (!window._db) return;

    const docRef  = window._db.collection('inventarioApp').doc(window.FIRESTORE_DOC_ID);
    const baseRef = docRef.collection('conteoAreas');
    const userRef = docRef.collection('conteoPorUsuario');

    const resetTs = Date.now();
    updateCloudSyncBadge('tx');

    try {
        // Batch atómico: 6 deletes simultáneos (sin ventanas de estado parcial)
        const batch = window._db.batch();
        AREA_KEYS.forEach(area => {
            batch.delete(baseRef.doc(area));
            batch.delete(userRef.doc(area));
        });
        await batch.commit();
        console.info('[TxReset] Batch de deletes completado (6 documentos).');

        // Transaction: resetear auditoriaStatus con dot-notation
        await window._db.runTransaction(async tx => {
            const snap = await tx.get(docRef);
            if (!snap.exists) return;
            tx.update(docRef, {
                'auditoriaStatus.almacen': 'pendiente',
                'auditoriaStatus.barra1':  'pendiente',
                'auditoriaStatus.barra2':  'pendiente',
                auditoriaConteo:           {},
                _lastModified:             resetTs,
            });
        });

        // Limpiar anti-eco locales
        _lastLocalWriteTs = resetTs;
        AREA_KEYS.forEach(area => {
            _storeLocalAreaTs(`conteo:${area}`, 0);
            _storeLocalAreaTs(`user:${area}`,   0);
        });

        updateCloudSyncBadge(_activeListeners.size > 0 ? 'listening' : 'ok');
        console.info('[TxReset] ✓ Auditoría reseteada (batch + transaction).');

    } catch (err) {
        console.error('[TxReset] Error:', err.code || err.message, err);
        updateCloudSyncBadge('error');
        throw err;
    }
}

// ── Binding global ────────────────────────────────────────────
window.syncToCloud = syncToCloud;
