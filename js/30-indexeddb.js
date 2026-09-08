function _idbPruneSyncedQueue() {
    if (!_idb || !_idb.objectStoreNames.contains('syncQueue')) return Promise.resolve();
    return new Promise(function(resolve) {
        try {
            var tx = _idb.transaction('syncQueue', 'readwrite');
            var store = tx.objectStore('syncQueue');
            var idx = store.index('byEstado');
            var req = idx.openCursor(IDBKeyRange.only('sincronizado'));
            var count = 0;
            req.onsuccess = function() {
                var cursor = req.result;
                if (cursor && count < 500) {
                    cursor.delete();
                    count++;
                    cursor.continue();
                } else {
                    if (count > 0) console.info('[IDB] Podados ' + count + ' eventos sincronizados');
                    resolve();
                }
            };
            req.onerror = function() { resolve(); };
        } catch(e) { resolve(); }
    });
}
        // ══════════════════════════════════════════════════════════════════════
        //  IndexedDB — Capa de persistencia secundaria para datos críticos
        // ══════════════════════════════════════════════════════════════════════
        /**
         * IndexedDB se usa como capa secundaria de respaldo para:
         *   - inventarioConteo     (conteo operativo de áreas)
         *   - myAuditoriaConteo    (conteo de auditoría del usuario)
         *
         * localStorage sigue siendo la fuente primaria (más rápido, síncrono).
         * IndexedDB es el respaldo: si localStorage falla o se borra,
         * IDB tiene una copia reciente de los datos críticos.
         *
         * Sin IndexedDB disponible, la app funciona exactamente igual que antes.
         */
        let _idb = null; // referencia a la BD IDB abierta

        function _initIndexedDB() {
            return new Promise(function(resolve) {
                if (!window.indexedDB) { resolve(null); return; }
                try {
                    // ── IDB v2: tiendas específicas por tipo de dato ───────────────
                    // v1: solo 'criticalData' (key-value genérico)
                    // v2: + 'syncQueue' (cola operacional) + 'historial' (permanente)
                    const req = indexedDB.open('BarInventoryDB', 2);
                    req.onupgradeneeded = function(e) {
                        const db = e.target.result;
                        const oldVersion = e.oldVersion || 0;

                        // Store genérico (creado en v1, compatible con código existente)
                        if (!db.objectStoreNames.contains('criticalData')) {
                            db.createObjectStore('criticalData');
                        }

                        // v2 → Cola de sincronización con índices para queries eficientes
                        if (oldVersion < 2) {
                            if (!db.objectStoreNames.contains('syncQueue')) {
                                const sqStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
                                sqStore.createIndex('byEstado', 'estado', { unique: false });
                                sqStore.createIndex('byTs',     'ts',     { unique: false });
                            }
                            // v2 → Historial PERMANENTE: nunca se borra, ni al rotar el queue
                            if (!db.objectStoreNames.contains('historial')) {
                                const histStore = db.createObjectStore('historial', { keyPath: 'id' });
                                histStore.createIndex('byProdId',  'prodId',  { unique: false });
                                histStore.createIndex('byTs',      'ts',      { unique: false });
                                histStore.createIndex('byUsuario', 'usuario', { unique: false });
                            }
                            console.info('[IDB] Migración v1→v2: stores syncQueue + historial creados ✓');
                        }
                    };
                    req.onsuccess = function(e) {
                        _idb = e.target.result;
                        // Manejar cierre inesperado de la conexión IDB (p.ej. upgrade en otra pestaña)
                       // FIX-6: Reconectar IDB automáticamente tras upgrade en otra pestaña
                _idb.onversionchange = function() {
                    _idb.close();
                    _idb = null;
                    console.warn('[IDB] Versión actualizada en otra pestaña. Reconectando…');
                    setTimeout(function() {
                        _initIndexedDB().then(function(db) {
                            if (db) console.info('[IDB] Reconectado tras upgrade ✓');
                        });
                    }, 1000);
                };
                        console.info('[IDB] BarInventoryDB v2 abierto ✓');
                        resolve(_idb);
                    };
                    req.onerror = function(e) {
                        console.warn('[IDB] No se pudo abrir IndexedDB:', e.target.error);
                        resolve(null);
                    };
                    req.onblocked = function() {
                        console.warn('[IDB] Upgrade bloqueado — otra pestaña tiene la BD abierta.');
                        resolve(null);
                    };
                } catch(e) {
                    console.warn('[IDB] IndexedDB no disponible:', e);
                    resolve(null);
                }
            });
        }

        /**
         * _idbSet(key, value) / _idbGet(key)
         * Wrappers async de IDB. Silencian errores para no romper el flujo principal.
         */
        function _idbSet(key, value) {
            if (!_idb) return Promise.resolve();
            return new Promise(function(resolve) {
                try {
                    const tx  = _idb.transaction('criticalData', 'readwrite');
                    const req = tx.objectStore('criticalData').put(value, key);
                    req.onsuccess = function() { resolve(); };
                    req.onerror   = function(e) { console.warn('[IDB] set error:', e); resolve(); };
                } catch(e) { resolve(); }
            });
        }

        function _idbGet(key) {
            if (!_idb) return Promise.resolve(null);
            return new Promise(function(resolve) {
                try {
                    const tx  = _idb.transaction('criticalData', 'readonly');
                    const req = tx.objectStore('criticalData').get(key);
                    req.onsuccess = function() { resolve(req.result !== undefined ? req.result : null); };
                    req.onerror   = function()  { resolve(null); };
                } catch(e) { resolve(null); }
            });
        }

        // ── IDB: operaciones sobre los stores v2 ─────────────────────────────

        /**
         * _idbQueuePush(evento)
         * Escribe un evento en el store 'syncQueue'.
         * La cola IDB es más durable que la cola en LS: sobrevive a limpiezas del navegador
         * porque IDB tiene su propia cuota separada de localStorage.
         */
        function _idbQueuePush(evento) {
            if (!_idb || !_idb.objectStoreNames.contains('syncQueue')) return Promise.resolve();
            return new Promise(function(resolve) {
                try {
                    const tx  = _idb.transaction('syncQueue', 'readwrite');
                    const req = tx.objectStore('syncQueue').put(evento); // put = insert or update
                    req.onsuccess = function() { resolve(); };
                    req.onerror   = function(e) { console.warn('[IDB] syncQueue put error:', e); resolve(); };
                } catch(e) { resolve(); }
            });
        }

        /**
         * _idbHistorialPush(evento)
         * Escribe un evento en el store 'historial' (PERMANENTE — NUNCA se borra).
         * Responde a: "¿Quién cambió este producto y cuándo?"
         * Complementa la vista en Firebase con una copia local offline.
         */
        function _idbHistorialPush(evento) {
            if (!_idb || !_idb.objectStoreNames.contains('historial')) return Promise.resolve();
            return new Promise(function(resolve) {
                try {
                    const tx  = _idb.transaction('historial', 'readwrite');
                    const req = tx.objectStore('historial').put(evento);
                    req.onsuccess = function() { resolve(); };
                    req.onerror   = function(e) { console.warn('[IDB] historial put error:', e); resolve(); };
                } catch(e) { resolve(); }
            });
        }

        /**
         * _idbGetPendingQueue()
         * Retorna todos los eventos pendientes del store 'syncQueue'.
         * Se usa en _flushSyncQueueToFirestore para subir solo lo que falta.
         */
        function _idbGetPendingQueue() {
            // ── FIX: UNION de IDB store + memoria ────────────────────────────
            // Problema original: los eventos pendientes de SESIONES ANTERIORES se
            // cargan en _syncQueue (memoria) vía _idbLoadAll() → criticalData.
            // PERO el IDB store 'syncQueue' (con índice byEstado) NO los contiene
            // porque se crearon antes de que IDB v2 existiera, o porque solo
            // _idbQueuePush() escribe allí (y solo se llama en _registrarEnSyncQueue,
            // no al restaurar desde criticalData).
            //
            // Resultado del bug: _flushSyncQueueToFirestore leía solo el store IDB
            // → 0 pendientes → nunca subía los eventos de sesiones anteriores.
            //
            // FIX: devolver la UNIÓN de ambas fuentes (IDB store + memoria),
            // deduplicando por id. Así no se pierden eventos históricos.
            const inMemoryPending = _syncQueue.filter(function(e) { return e.estado === 'pendiente'; });

            if (!_idb || !_idb.objectStoreNames.contains('syncQueue')) {
                // IDB no disponible o store no existe → usar solo memoria
                return Promise.resolve(inMemoryPending);
            }
            return new Promise(function(resolve) {
                try {
                    const tx    = _idb.transaction('syncQueue', 'readonly');
                    const store = tx.objectStore('syncQueue');
                    const index = store.index('byEstado');
                    const req   = index.getAll(IDBKeyRange.only('pendiente'));
                    req.onsuccess = function() {
                        const idbPending = req.result || [];
                        // Merge: IDB store (fuente principal) UNION memoria (sesiones previas)
                        // Deduplicar por id para no subir el mismo evento dos veces
                        const seenIds = new Set(idbPending.map(function(e) { return e.id; }));
                        const onlyInMemory = inMemoryPending.filter(function(e) {
                            return e.id && !seenIds.has(e.id);
                        });
                        if (onlyInMemory.length > 0) {
                            console.info('[SyncQueue] ' + onlyInMemory.length +
                                ' evento(s) recuperado(s) de sesión anterior (solo en memoria).');
                            // Re-persistir en IDB store para futuros arranques
                            onlyInMemory.forEach(function(e) {
                                _idbQueuePush(e).catch(function() {});
                            });
                        }
                        resolve(idbPending.concat(onlyInMemory));
                    };
                    req.onerror = function() {
                        // Error en IDB → usar memoria como fallback completo
                        resolve(inMemoryPending);
                    };
                } catch(e) {
                    resolve(inMemoryPending);
                }
            });
        }

        /**
         * _idbMarkQueueSynced(ids)
         * Marca como 'sincronizado' los eventos con los IDs dados en el store 'syncQueue'.
         */
        function _idbMarkQueueSynced(ids) {
            if (!_idb || !_idb.objectStoreNames.contains('syncQueue') || ids.length === 0) {
                return Promise.resolve();
            }
            return new Promise(function(resolve) {
                try {
                    const tx    = _idb.transaction('syncQueue', 'readwrite');
                    const store = tx.objectStore('syncQueue');
                    let pending = ids.length;
                    ids.forEach(function(id) {
                        const getReq = store.get(id);
                        getReq.onsuccess = function() {
                            if (getReq.result) {
                                getReq.result.estado = 'sincronizado';
                                store.put(getReq.result);
                            }
                            if (--pending === 0) resolve();
                        };
                        getReq.onerror = function() { if (--pending === 0) resolve(); };
                    });
                } catch(e) { resolve(); }
            });
        }

        /**
         * consultarHistorialProducto(prodId)
         * Retorna todos los cambios históricos de un producto, del más reciente al más viejo.
         * Accesible desde consola: consultarHistorialProducto('PRD-001')
         */
        async function consultarHistorialProducto(prodId) {
            const resultado = [];
            // 1) Buscar en IDB local
            if (_idb && _idb.objectStoreNames.contains('historial')) {
                await new Promise(function(resolve) {
                    try {
                        const tx  = _idb.transaction('historial', 'readonly');
                        const idx = tx.objectStore('historial').index('byProdId');
                        const req = idx.getAll(IDBKeyRange.only(prodId));
                        req.onsuccess = function() {
                            (req.result || []).forEach(function(e) { resultado.push(e); });
                            resolve();
                        };
                        req.onerror = function() { resolve(); };
                    } catch(e) { resolve(); }
                });
            }
            // 2) Buscar en LS changeLog
            try {
                const log = JSON.parse(localStorage.getItem('inventarioApp_changeLog') || '[]');
                log.filter(function(e) { return e.prodId === prodId; })
                   .forEach(function(e) {
                       // Evitar duplicados si ya está en IDB
                       if (!resultado.find(function(r) { return r.id === e.id; })) {
                           resultado.push(e);
                       }
                   });
            } catch(_) {}
            // Ordenar del más reciente al más viejo
            resultado.sort(function(a,b) { return (b.ts||0) - (a.ts||0); });
            console.table(resultado.map(function(e) {
                return {
                    Fecha:    new Date(e.ts||0).toLocaleString('es-MX'),
                    Producto: e.prodName || e.prodId,
                    Área:     e.area || '—',
                    Antes:    e.valorAntes !== undefined ? e.valorAntes : '—',
                    Después:  e.valorDespues !== undefined ? e.valorDespues : '—',
                    Motivo:   e.motivo || '—',
                    Usuario:  e.usuario || '—',
                    Device:   e.deviceId || '—',
                    Estado:   e.estado || '—'
                };
            }));
            return resultado;
        }
        window.consultarHistorialProducto = consultarHistorialProducto;

        /**
         * _saveConteoToIDB()
         * Persiste los conteos críticos en IndexedDB como capa secundaria.
         * Se llama de forma asíncrona después de saveToLocalStorage, sin bloquear.
         */
        function _saveConteoToIDB() {
            if (!_idb) return;
            // Fire-and-forget: no bloqueamos el hilo principal
            Promise.all([
                _idbSet('inventarioConteo',  inventarioConteo),
                _idbSet('myAuditoriaConteo', myAuditoriaConteo),
                _idbSet('products',          products),
                _idbSet('_savedAt',          Date.now())
            ]).catch(function(e) { console.warn('[IDB] Error en _saveConteoToIDB:', e); });
        }

        // ══════════════════════════════════════════════════════════════════════
        //  CORRECCIÓN 1 — IDB como almacenamiento PRINCIPAL
        //  _idbSaveAll: escribe TODOS los datos críticos en IDB.
        //  Se llama al INICIO de saveToLocalStorage, antes que LS.
        //  LS queda como respaldo secundario.
        //  Ambas capas coexisten: IDB primaria, LS secundaria.
        // ══════════════════════════════════════════════════════════════════════

        /**
         * _idbSaveAll()
         * Guarda el estado completo de la app en IndexedDB.
         * Estructura paralela a saveToLocalStorage pero en IDB.
         * Fire-and-forget: no bloquea el hilo principal.
         */
        // FIX-IDB-ATOMIC (BarInventory): _idbSaveAll() antes escribía cada campo
        // en su PROPIA transacción IDB independiente (20 transacciones paralelas
        // por llamada, vía Promise.all de _idbSet()). Si dos guardados ocurrían
        // muy seguidos (ej. el usuario guardando el conteo de dos productos casi
        // al mismo tiempo durante una auditoría), las transacciones de ambas
        // llamadas podían intercalarse entre sí: el campo '_savedAt' de la
        // llamada más reciente podía terminar escrito ANTES que el campo
        // 'myAuditoriaConteo' de esa misma llamada, dejando en IDB una
        // combinación inconsistente (timestamp nuevo + conteo viejo/incompleto).
        // Al recargar, _initIndexedDB confiaba en IDB por tener el timestamp más
        // reciente aunque su contenido real fuera más viejo que localStorage.
        //
        // SOLUCIÓN: una sola transacción atómica para todos los campos. Todas
        // las escrituras comparten el mismo objeto de transacción, así que dos
        // llamadas a _idbSaveAll() quedan estrictamente serializadas en el
        // orden en que se invocaron — ya no pueden intercalar campos entre sí.
        function _idbSaveAll() {
            if (!_idb) return Promise.resolve();
            const nowMs = Date.now();
            return new Promise(function(resolve) {
                try {
                    const tx    = _idb.transaction('criticalData', 'readwrite');
                    const store = tx.objectStore('criticalData');
                    // TIER 1 — Conteos críticos
                    store.put(inventarioConteo,          'inventarioConteo');
                    store.put(myAuditoriaConteo,         'myAuditoriaConteo');
                    store.put(auditoriaConteo,           'auditoriaConteo');
                    store.put(auditoriaConteoPorUsuario, 'auditoriaConteoPorUsuario');
                    // TIER 2 — Catálogo y auditoría
                    store.put(products,                  'products');
                    store.put(auditoriaStatus,           'auditoriaStatus');
                    store.put(myAuditoriaStatus,         'myAuditoriaStatus');
                    store.put(myAuditoriaUnlocks,        'myAuditoriaUnlocks');
                    store.put(_auditoriaSessionId || '', 'auditoriaSessionId');
                    store.put(inventarioCicloEstado,     'cicloEstado');
                    store.put(inventarioCicloInfo,       'cicloInfo');
                    store.put(_syncQueue,                'syncQueue');
                    // TIER 3 — Estado UI
                    store.put(cart,                      'cart');
                    store.put(activeTab,                 'activeTab');
                    store.put(selectedArea,              'selectedArea');
                    store.put(selectedGroup,             'selectedGroup');
                    // Metadata — _savedAt va en la MISMA transacción que el resto,
                    // así que si el conteo no se alcanzó a escribir, tampoco se
                    // actualiza el timestamp (ambos viven o mueren juntos).
                    store.put(nowMs,                     '_savedAt');
                    store.put(APP_VERSION,                '_appVersion');
                    store.put(DB_VERSION,                 '_dbVersion');

                    tx.oncomplete = function() { resolve(); };
                    tx.onerror = function() {
                        console.warn('[IDB] Error en _idbSaveAll (transacción atómica):', tx.error);
                        resolve();
                    };
                    tx.onabort = function() {
                        console.warn('[IDB] _idbSaveAll abortada:', tx.error);
                        resolve();
                    };
                } catch(e) {
                    console.warn('[IDB] Error en _idbSaveAll:', e);
                    resolve();
                }
            });
        }

        /**
         * _contarEntradasConteo(conteo)
         * FIX-IDB-GUARD (BarInventory): cuenta cuántas entradas producto×área
         * tiene un objeto de conteo (myAuditoriaConteo / inventarioConteo).
         * Se usa para detectar si una fuente de datos (IDB) está incompleta
         * respecto a otra (localStorage) aunque su timestamp parezca más nuevo.
         */
        function _contarEntradasConteo(conteo) {
            if (!conteo || typeof conteo !== 'object') return 0;
            let n = 0;
            Object.keys(conteo).forEach(function(prodId) {
                const areas = conteo[prodId];
                if (areas && typeof areas === 'object') n += Object.keys(areas).length;
            });
            return n;
        }

        /** Lee y parsea una clave JSON de localStorage de forma segura (sin lanzar). */
        function _leerJsonLS(key) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch(e) { return null; }
        }

        /**
         * _idbLoadAll()
         * Lee el estado completo desde IndexedDB.
         * Retorna un objeto con todos los campos, o null si IDB está vacío/viejo.
         * Se llama ANTES de loadFromLocalStorage para priorizar IDB.
         */
        async function _idbLoadAll() {
            if (!_idb) return null;
            try {
                const savedAt = await _idbGet('_savedAt');
                if (!savedAt) return null;
                const age = Date.now() - savedAt;
                if (age > 60 * 24 * 60 * 60 * 1000) {
                    console.info('[IDB] Datos en IDB tienen más de 60 días, ignorando para lectura principal.');
                    return null; // IDB muy viejo → preferir LS o Firebase
                }
                const [
                    idbProducts, idbInventarioConteo, idbMyAuditoriaConteo,
                    idbAuditoriaConteo, idbAuditoriaConteoPorUsuario,
                    idbAuditoriaStatus, idbMyAuditoriaStatus, idbMyAuditoriaUnlocks,
                    idbSessionId, idbCicloEstado, idbCicloInfo,
                    idbSyncQueue, idbCart, idbActiveTab, idbSelectedArea, idbSelectedGroup
                ] = await Promise.all([
                    _idbGet('products'),              _idbGet('inventarioConteo'),
                    _idbGet('myAuditoriaConteo'),     _idbGet('auditoriaConteo'),
                    _idbGet('auditoriaConteoPorUsuario'), _idbGet('auditoriaStatus'),
                    _idbGet('myAuditoriaStatus'),     _idbGet('myAuditoriaUnlocks'),
                    _idbGet('auditoriaSessionId'),    _idbGet('cicloEstado'),
                    _idbGet('cicloInfo'),             _idbGet('syncQueue'),
                    _idbGet('cart'),                  _idbGet('activeTab'),
                    _idbGet('selectedArea'),          _idbGet('selectedGroup')
                ]);
                return {
                    products:                  idbProducts,
                    inventarioConteo:          idbInventarioConteo,
                    myAuditoriaConteo:         idbMyAuditoriaConteo,
                    auditoriaConteo:           idbAuditoriaConteo,
                    auditoriaConteoPorUsuario: idbAuditoriaConteoPorUsuario,
                    auditoriaStatus:           idbAuditoriaStatus,
                    myAuditoriaStatus:         idbMyAuditoriaStatus,
                    myAuditoriaUnlocks:        idbMyAuditoriaUnlocks,
                    auditoriaSessionId:        idbSessionId,
                    cicloEstado:               idbCicloEstado,
                    cicloInfo:                 idbCicloInfo,
                    syncQueue:                 idbSyncQueue,
                    cart:                      idbCart,
                    activeTab:                 idbActiveTab,
                    selectedArea:              idbSelectedArea,
                    selectedGroup:             idbSelectedGroup,
                    _savedAt:                  savedAt
                };
            } catch(e) {
                console.warn('[IDB] Error en _idbLoadAll:', e);
                return null;
            }
        }

        /**
         * _applyIDBData(idbData)
         * Aplica los datos leídos de IDB a las variables globales.
         * Solo aplica campos con valores válidos (no null/undefined).
         * Respeta la estructura de migraciones de loadFromLocalStorage.
         */
        function _applyIDBData(idbData) {
            if (!idbData) return;
            if (Array.isArray(idbData.products) && idbData.products.length > 0)
                products = idbData.products;
            if (idbData.inventarioConteo && typeof idbData.inventarioConteo === 'object')
                inventarioConteo = idbData.inventarioConteo;
            if (idbData.myAuditoriaConteo && typeof idbData.myAuditoriaConteo === 'object')
                myAuditoriaConteo = idbData.myAuditoriaConteo;
            if (idbData.auditoriaConteo && typeof idbData.auditoriaConteo === 'object')
                auditoriaConteo = idbData.auditoriaConteo;
            if (idbData.auditoriaConteoPorUsuario && typeof idbData.auditoriaConteoPorUsuario === 'object')
                auditoriaConteoPorUsuario = idbData.auditoriaConteoPorUsuario;
            if (idbData.auditoriaStatus && typeof idbData.auditoriaStatus === 'object')
                auditoriaStatus = idbData.auditoriaStatus;
            if (idbData.myAuditoriaStatus && typeof idbData.myAuditoriaStatus === 'object')
                myAuditoriaStatus = idbData.myAuditoriaStatus;
            if (idbData.myAuditoriaUnlocks && typeof idbData.myAuditoriaUnlocks === 'object')
                myAuditoriaUnlocks = idbData.myAuditoriaUnlocks;
            if (idbData.auditoriaSessionId && idbData.auditoriaSessionId.length > 0)
                _auditoriaSessionId = idbData.auditoriaSessionId;
            if (idbData.cicloEstado && ['ABIERTO','EN_CAPTURA','FINALIZADO','CERRADO'].includes(idbData.cicloEstado))
                inventarioCicloEstado = idbData.cicloEstado;
            if (idbData.cicloInfo && typeof idbData.cicloInfo === 'object')
                inventarioCicloInfo = idbData.cicloInfo;
            if (Array.isArray(idbData.syncQueue))
                _syncQueue = idbData.syncQueue;
            if (Array.isArray(idbData.cart))
                cart = idbData.cart;
            if (idbData.activeTab)  activeTab   = idbData.activeTab;
            if (idbData.selectedArea) selectedArea = idbData.selectedArea;
            if (idbData.selectedGroup) selectedGroup = idbData.selectedGroup;
            isAuditoriaMode = (auditoriaView === 'counting' && !!auditoriaAreaActiva);
            console.info('[IDB] Estado restaurado desde IndexedDB (' +
                new Date(idbData._savedAt).toLocaleString('es-MX') + ') — ' +
                (Array.isArray(idbData.products) ? idbData.products.length : 0) + ' productos');
        }

        /**
         * _tryRecoverFromIDB()
         * Intenta recuperar conteos desde IDB si localStorage está vacío.
         * Se llama al arranque, después de loadFromLocalStorage.
         */
        async function _tryRecoverFromIDB() {
            if (!_idb) return false;
            try {
                const savedAt = await _idbGet('_savedAt');
                if (!savedAt) return false;

                const idbAge = Date.now() - savedAt;
                if (idbAge > 30 * 24 * 60 * 60 * 1000) return false; // IDB > 30 días, ignorar

                const idbProducts  = await _idbGet('products');
                const idbConteo    = await _idbGet('inventarioConteo');
                const idbAuditoria = await _idbGet('myAuditoriaConteo');

                const hayProductos   = Array.isArray(idbProducts) && idbProducts.length > 0;
                const hayConteo      = idbConteo && Object.keys(idbConteo).length > 0;
                const localVacio     = products.length === 0;
                const conteoVacio    = Object.keys(inventarioConteo).length === 0;

                if (localVacio && hayProductos) {
                    console.warn('[IDB] localStorage vacío, recuperando desde IndexedDB…');
                    products          = idbProducts;
                    if (hayConteo)     inventarioConteo  = idbConteo;
                    if (idbAuditoria)  myAuditoriaConteo = idbAuditoria;
                    showNotification('🔄 Datos recuperados desde IndexedDB (' +
                        new Date(savedAt).toLocaleString('es-MX') + ')');
                    saveToLocalStorage();
                    return true;
                }

                // Caso: localStorage tiene productos pero conteo está vacío
                if (!localVacio && conteoVacio && hayConteo) {
                    console.warn('[IDB] Conteo vacío en LS, recuperando desde IDB…');
                    inventarioConteo = idbConteo;
                    if (idbAuditoria) myAuditoriaConteo = idbAuditoria;
                    saveToLocalStorage();
                    return true;
                }
            } catch(e) {
                console.warn('[IDB] Error en recuperación desde IDB:', e);
            }
            return false;
        }

        /**
         * _tryRecoverFromFirebase()
         * CORRECCIÓN 5: Recuperación de ÚLTIMO RECURSO desde Firestore.
         * Se llama cuando tanto localStorage como IndexedDB están vacíos.
         * Escenario: usuario limpió el navegador completamente + cambió dispositivo.
         * Requiere que el usuario esté autenticado.
         */
        async function _tryRecoverFromFirebase() {
            if (!_db || !navigator.onLine || !currentUserUid) return false;
            if (products.length > 0) return false; // ya hay datos locales

            try {
                console.info('[Recovery] Intentando recuperación desde Firebase…');
                const docRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID);
                const snap   = await docRef.get();

                if (!snap.exists) {
                    console.info('[Recovery] Sin datos en Firebase todavía.');
                    return false;
                }

                const data = snap.data();
                const cloudProducts = data.products || [];
                if (!Array.isArray(cloudProducts) || cloudProducts.length === 0) return false;

                // Aplicar datos de Firebase
                await _applyCloudData(data);
                showNotification('🔄 Datos recuperados desde la nube (' + cloudProducts.length + ' productos)');
                console.info('[Recovery] Recuperación desde Firebase exitosa:', cloudProducts.length, 'productos');
                return true;
            } catch(e) {
                console.warn('[Recovery] Error en recuperación desde Firebase:', e);
                return false;
            }
        }
        window._tryRecoverFromFirebase = _tryRecoverFromFirebase;

        function estimateStorageUsed() {
            let total = 0;
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    const val = localStorage.getItem(key) || '';
                    total += (key.length + val.length) * 2; // UTF-16: 2 bytes/char
                }
            } catch (_) {}
            return total;
        }

        // Guard de reentrada para _applyCloudData — previene que dos snapshots simultáneos
        // la ejecuten en paralelo y dejen el estado inconsistente (FIX 7).
        // BUG-H9 FIX: el guard se resetea en finally para no quedar bloqueado ante excepciones.
        let _applyingCloudData = false;

        /**
         * saveToLocalStorage(opts)
         * @param {object} [opts]
         * @param {boolean} [opts.skipSyncTrigger=false] - Si true, no dispara syncToCloud.
         *   Usar cuando la llamada viene de _applyCloudData para evitar el loop:
         *   cloud → _applyCloudData → saveToLocalStorage → syncToCloud → cloud… (FIX 8)
         */
        function saveToLocalStorage(opts) {
            // ══════════════════════════════════════════════════════════════════
            // CORRECCIÓN 1: IDB como almacenamiento PRINCIPAL.
            // _idbSaveAll() se dispara PRIMERO (asíncrono, no bloquea).
            // LocalStorage escribe después como capa secundaria de compatibilidad.
            // Si LS falla por cuota, IDB ya tiene los datos seguros.
            // ══════════════════════════════════════════════════════════════════
            _idbSaveAll(); // Fire-and-forget: IDB principal, LS secundario

            // ── FIX-PRIORITY: Entradas ordenadas por PRIORIDAD CRÍTICA.
            // Si el almacenamiento se llena, los datos más importantes se salvan primero.
            // ANTES: inventories (histórico grande) estaba en posición 3 → bloqueaba todo lo demás.
            // AHORA: inventories va al final porque puede recortarse sin perder el conteo activo.
            // ─────────────────────────────────────────────────────────────────────────────────
            // TIER 1 — CRÍTICO: Conteo activo. Nunca puede perderse.
            // TIER 2 — IMPORTANTE: Catálogo de productos y estado de auditoría.
            // TIER 3 — UTILITARIO: UI state que puede reconstruirse.
            // TIER 4 — HISTÓRICO: Puede crecer indefinidamente; va al final.
            const entries = [
                // ── TIER 1: Conteos (máxima prioridad) ──────────────────────────────────
                ['inventarioApp_inventarioConteo',         JSON.stringify(inventarioConteo)],
                ['inventarioApp_myAuditoriaConteo',        JSON.stringify(myAuditoriaConteo)],
                ['inventarioApp_auditoriaConteo',          JSON.stringify(auditoriaConteo)],
                ['inventarioApp_auditoriaConteoPorUsuario',JSON.stringify(auditoriaConteoPorUsuario)],
                // ── TIER 2: Catálogo y estado de auditoría ───────────────────────────────
                ['inventarioApp_products',                 JSON.stringify(products)],
                ['inventarioApp_auditoriaStatus',          JSON.stringify(auditoriaStatus)],
                ['inventarioApp_myAuditoriaStatus',        JSON.stringify(myAuditoriaStatus)],
                ['inventarioApp_myAuditoriaUnlocks',       JSON.stringify(myAuditoriaUnlocks)],
                ['inventarioApp_auditoriaSessionId',       _auditoriaSessionId || ''],
                // ── TIER 3: Estado de UI ─────────────────────────────────────────────────
                ['inventarioApp_cart',                     JSON.stringify(cart)],
                ['inventarioApp_activeTab',                activeTab],
                ['inventarioApp_selectedGroup',            selectedGroup],
                ['inventarioApp_selectedArea',             selectedArea],
                ['inventarioApp_searchTerm',               searchTerm],
                ['inventarioApp_auditoriaView',            auditoriaView],
                ['inventarioApp_auditoriaAreaActiva',      auditoriaAreaActiva || ''],
                ['inventarioApp_expandedInventories',      JSON.stringify(Array.from(expandedInventories))],
                // BUG-3 FIX: cicloEstado y cicloInfo nunca estaban en este array.
                // Antes solo se guardaban vía setCicloEstado() directamente.
                // Si algo fallaba en setCicloEstado (ej. cuota llena en ese momento),
                // el estado del ciclo se perdía entre sesiones.
                // Ahora se guardan aquí como respaldo adicional.
                ['inventarioApp_cicloEstado',              inventarioCicloEstado || 'ABIERTO'],
                ['inventarioApp_cicloInfo',                JSON.stringify(inventarioCicloInfo || {})],
                // ── TIER 4: Histórico (puede ser grande; al final) ───────────────────────
                ['inventarioApp_orders',                   JSON.stringify(orders)],
                ['inventarioApp_inventories',              JSON.stringify(inventories)],
            ];

            // Marca temporal (resolución de conflictos: último-gana)
            const nowMs = Date.now();
            entries.push(['inventarioApp_lastModified', String(nowMs)]);

            // Advertir si nos acercamos al límite (solo una vez por sesión)
            if (!_lsQuotaWarned) {
                const used = estimateStorageUsed();
                if (used > LS_WARN_BYTES) {
                    _lsQuotaWarned = true;
                    showNotification('⚠️ Almacenamiento al ' + Math.round(used / (5*1024*1024) * 100) + '%. Exporta y limpia historiales.');
                }
            }

            for (const [key, value] of entries) {
                try {
                    localStorage.setItem(key, value);
                } catch (e) {
                    // ── FIX-RECOVERY: Cuota excedida → intentar liberar espacio automáticamente.
                    // Estrategia: recortar el histórico (inventories) a las últimas 5 entradas
                    // y reintentar UNA sola vez. El histórico es el dato más grande y menos
                    // crítico. Los conteos y productos se salvan antes (TIER 1/2) y ya están OK.
                    console.error('[LS] Cuota excedida al guardar "' + key + '". Intentando liberar espacio…', e);
                    let recovered = false;
                    if (key === 'inventarioApp_inventories' || key === 'inventarioApp_orders') {
                        try {
                            // Recortar historial a las últimas 5 entradas y reintentar
                            if (key === 'inventarioApp_inventories' && inventories.length > 5) {
                                const trimmed = inventories.slice(-5);
                                localStorage.setItem(key, JSON.stringify(trimmed));
                                recovered = true;
                                showNotification('⚠️ Historial recortado para liberar espacio. Exporta datos ahora.');
                                console.warn('[LS] Inventories recortado a 5 entradas para liberar cuota.');
                            } else if (key === 'inventarioApp_orders' && orders.length > 10) {
                                const trimmed = orders.slice(-10);
                                localStorage.setItem(key, JSON.stringify(trimmed));
                                recovered = true;
                                showNotification('⚠️ Pedidos recortados para liberar espacio. Exporta datos ahora.');
                            }
                        } catch (e2) {
                            console.error('[LS] Recuperación falló:', e2);
                        }
                    }
                    if (!recovered) {
                        if (key === 'inventarioApp_inventarioConteo' || key === 'inventarioApp_myAuditoriaConteo') {
                            showNotification('🚨 CRÍTICO: El conteo activo no pudo guardarse. Exporta datos INMEDIATAMENTE.');
                        } else {
                            showNotification('⚠️ Error al guardar datos. Exporta un respaldo inmediatamente.');
                        }
                        break; // detener para no corromper estado parcial
                    }
                }
            }

            // ── FIX-BACKUP: Crear snapshot de emergencia periódico ───────────────────────
            // Un backup de los datos críticos bajo una clave separada garantiza que,
            // si la próxima sesión arranca con localStorage corrupto o vacío, se puede
            // recuperar el estado de la última sesión buena.
            // Solo se escribe si pasaron ≥ 2 minutos desde el último backup.
            try {
                const lastBackup = parseInt(localStorage.getItem('inventarioApp_lastBackupTs') || '0', 10);
                if ((nowMs - lastBackup) >= 2 * 60 * 1000) {
                    const snapshot = JSON.stringify({
                        products:         products,
                        inventarioConteo: inventarioConteo,
                        myAuditoriaConteo:myAuditoriaConteo,
                        auditoriaConteo:  auditoriaConteo,
                        auditoriaStatus:  auditoriaStatus,
                        _ts:              nowMs
                    });
                    localStorage.setItem('inventarioApp_emergencySnapshot', snapshot);
                    localStorage.setItem('inventarioApp_lastBackupTs', String(nowMs));
                }
            } catch (_) { /* si falla el backup, no interrumpir */ }

            // ── Disparar sync a la nube SOLO si los datos cambiaron ──────────
            const newHash = _computeDataHash();
            if (newHash !== _lastDataHash) {
                _lastDataHash = newHash;
                _cloudSyncPending = true;
                updateCloudSyncBadge('pending');
                const skipSync = opts && opts.skipSyncTrigger;
                if (!skipSync && navigator.onLine && _db) {
                    clearTimeout(saveToLocalStorage._syncTimer);
                    saveToLocalStorage._syncTimer = setTimeout(() => syncToCloud(), 900);
                }
            }
            // BUG-4 FIX: eliminada llamada redundante a _saveConteoToIDB() que
            // existía aquí. _idbSaveAll() al inicio de esta función ya cubre
            // todos los datos (incluyendo conteos). Doble escritura innecesaria.
        }
        saveToLocalStorage._syncTimer = null;
