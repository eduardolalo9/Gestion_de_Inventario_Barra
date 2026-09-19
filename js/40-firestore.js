        function loadFromLocalStorage() {
            const safeGet = (key, fallback) => {
                try {
                    const raw = localStorage.getItem(key);
                    return raw ? JSON.parse(raw) : fallback;
                } catch (e) {
                    console.warn('Dato corrupto en localStorage para "' + key + '", usando valor por defecto.', e);
                    return fallback;
                }
            };

            products   = safeGet('inventarioApp_products',   []);
            orders     = safeGet('inventarioApp_orders',     []);
            inventories = safeGet('inventarioApp_inventories', []);
            cart       = safeGet('inventarioApp_cart',       []);

            // FIX-CONCURRENCIA: restaurar tombstones de borrado (ver _mergeArrayByIdPreferLocal)
            const rawDelProd = safeGet('inventarioApp_deletedProductIds',   []);
            const rawDelOrd  = safeGet('inventarioApp_deletedOrderIds',     []);
            const rawDelInv  = safeGet('inventarioApp_deletedInventoryIds', []);
            _deletedProductIds   = Array.isArray(rawDelProd) ? rawDelProd : [];
            _deletedOrderIds     = Array.isArray(rawDelOrd)  ? rawDelOrd  : [];
            _deletedInventoryIds = Array.isArray(rawDelInv)  ? rawDelInv  : [];

            // D — marca de purga del catálogo (ver _marcarCatalogoPurgado).
            // Sobrevive al cierre de la app: si el vaciado se hizo sin señal,
            // la purga sigue vigente al volver y no se resucita nada.
            const rawPurga = parseInt(localStorage.getItem('inventarioApp_catalogoPurgadoEn') || '0', 10);
            _catalogoPurgadoEn = isNaN(rawPurga) ? 0 : rawPurga;

            const storedTab   = localStorage.getItem('inventarioApp_activeTab');
            const storedGroup = localStorage.getItem('inventarioApp_selectedGroup');
            const storedArea  = localStorage.getItem('inventarioApp_selectedArea');
            const storedSearch = localStorage.getItem('inventarioApp_searchTerm');

            if (storedTab)    activeTab     = storedTab;
            if (storedGroup)  selectedGroup = storedGroup;
            if (storedArea)   selectedArea  = storedArea;
            if (storedSearch) searchTerm    = storedSearch;

            const storedExpanded = safeGet('inventarioApp_expandedInventories', []);
            expandedInventories = new Set(Array.isArray(storedExpanded) ? storedExpanded : []);

            // ── Auditoría Física Ciega ────────────────────────────────────────
            const storedAuditoriaStatus = safeGet('inventarioApp_auditoriaStatus', estadoAreasVacio('pendiente'));
            if (storedAuditoriaStatus && typeof storedAuditoriaStatus === 'object') auditoriaStatus = storedAuditoriaStatus;
            const storedAuditoriaConteo = safeGet('inventarioApp_auditoriaConteo', {});
            if (storedAuditoriaConteo && typeof storedAuditoriaConteo === 'object') auditoriaConteo = storedAuditoriaConteo;
            const storedAuditoriaView = localStorage.getItem('inventarioApp_auditoriaView');
            if (storedAuditoriaView) auditoriaView = storedAuditoriaView;
            const storedAuditoriaArea = localStorage.getItem('inventarioApp_auditoriaAreaActiva');
            if (storedAuditoriaArea) auditoriaAreaActiva = storedAuditoriaArea || null;
            // BUG FIX: isAuditoriaMode no se restauraba al recargar la pagina.
            // Resultado: el modal guardaba en inventarioConteo en vez de auditoriaConteo
            // y la tarjeta mostraba 0 porque lee de auditoriaConteo. SOLUCION:
            // reconstruir isAuditoriaMode desde auditoriaView y auditoriaAreaActiva.
            isAuditoriaMode = (auditoriaView === 'counting' && !!auditoriaAreaActiva);

            // ── Restaurar conteos multiusuario desde localStorage ─────────────
            const rawCPU = safeGet('inventarioApp_auditoriaConteoPorUsuario', {}); // FIX-07: var→const
            if (rawCPU && typeof rawCPU === 'object') {
                auditoriaConteoPorUsuario = rawCPU;
            }

            // ── Restaurar auditoría aislada por usuario ────────────────────────
            const storedMyConteo = safeGet('inventarioApp_myAuditoriaConteo', {});
            if (storedMyConteo && typeof storedMyConteo === 'object') {
                // BUG-7 FIX: migrar conteos viejos sin _ts para que BUG-5 FIX funcione
                // con datos ya almacenados en localStorage antes de esta versión.
                const fallbackTs = Date.now();
                Object.keys(storedMyConteo).forEach(function(prodId) {
                    Object.keys(storedMyConteo[prodId] || {}).forEach(function(area) {
                        if (!storedMyConteo[prodId][area]._ts) {
                            storedMyConteo[prodId][area]._ts = fallbackTs;
                        }
                    });
                });
                myAuditoriaConteo = storedMyConteo;
            }
            const storedMyStatus = safeGet('inventarioApp_myAuditoriaStatus', estadoAreasVacio('pendiente'));
            if (storedMyStatus && typeof storedMyStatus === 'object') myAuditoriaStatus = storedMyStatus;
            // D — rastro de finalización de área
            const storedFinalizadas = safeGet('inventarioApp_myAuditoriaFinalizadas', {});
            if (storedFinalizadas && typeof storedFinalizadas === 'object') myAuditoriaFinalizadas = storedFinalizadas;
            const storedMyUnlocks = safeGet('inventarioApp_myAuditoriaUnlocks', {});
            if (storedMyUnlocks && typeof storedMyUnlocks === 'object') myAuditoriaUnlocks = storedMyUnlocks;
            const storedSessionId = localStorage.getItem('inventarioApp_auditoriaSessionId');
            // BUG-8 FIX: solo restaurar si es string real y no vacío.
            // '' significa sin sesión previa → mantener null para que subscribeAllUsersAuditoria
            // muestre todos los usuarios (primer arranque del admin).
            if (storedSessionId && storedSessionId.trim().length > 0) {
                _auditoriaSessionId = storedSessionId;
            }

            const parsedConteo = safeGet('inventarioApp_inventarioConteo', {});
            const migrated = {};
            Object.keys(parsedConteo).forEach(prodId => {
                const val = parsedConteo[prodId];
                if (!val || typeof val !== 'object') return; // skip invalid entries
                if (typeof val.enteras !== 'undefined' && val.almacen === undefined && val.barra1 === undefined && val.barra2 === undefined) {  // BUG-FIX M3: usar === undefined para no fallar cuando area vale 0
                    migrated[prodId] = { almacen: val };
                } else {
                    migrated[prodId] = val;
                }
            });
            inventarioConteo = migrated;

            // ── Cargar cola de sincronización ────────────────────────────────
            const rawQueue = safeGet('inventarioApp_syncQueue', []);
            _syncQueue = Array.isArray(rawQueue) ? rawQueue : [];

            // ── Cargar estado del ciclo de inventario ────────────────────────
            const storedCiclo = localStorage.getItem('inventarioApp_cicloEstado');
            if (storedCiclo && ['ABIERTO','EN_CAPTURA','FINALIZADO','CERRADO'].includes(storedCiclo)) {
                inventarioCicloEstado = storedCiclo;
            }
            const storedCicloInfo = safeGet('inventarioApp_cicloInfo', null);
            if (storedCicloInfo && typeof storedCicloInfo === 'object') {
                inventarioCicloInfo = storedCicloInfo;
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  SINCRONIZACIÓN CLOUD — Firebase Firestore
        // ══════════════════════════════════════════════════════════════════════

        // ══════════════════════════════════════════════════════════════════════
        //  FIX #3 — FUNCIONES DE CHUNK ELEVADAS AL SCOPE GLOBAL
        //  Antes estaban declaradas DENTRO de syncToCloud/_applyCloudData, lo que
        //  creaba un nuevo objeto función en cada llamada y abría una ventana de
        //  race condition si syncToCloud se invocaba concurrentemente (dos closures
        //  distintos capturando el mismo docRef con resultados indeterminados).
        //  Ahora son funciones puras a nivel de módulo que reciben docRef como arg.
        // ══════════════════════════════════════════════════════════════════════

        /**
         * Borra los chunks anteriores de una subcolección y escribe el array
         * dataArray dividido en documentos de MAX_CHUNK_SIZE ítems.
         * @param {firebase.firestore.DocumentReference} docRef  Referencia al doc principal
         * @param {string}  subcollName  Nombre de la subcolección ('ordersChunks', etc.)
         * @param {Array}   dataArray    Array completo a persistir en chunks
         */
        async function _writeChunkedSubcollection(docRef, subcollName, dataArray) {
            // FIX 12: guard para _db null — evita crash si Firebase no está configurado
            if (!_db || !docRef) return;
            if (!Array.isArray(dataArray)) dataArray = [];
            const MAX_CHUNK_SIZE = 80;
            const colRef = docRef.collection(subcollName);
            const totalChunks = Math.max(1, Math.ceil(dataArray.length / MAX_CHUNK_SIZE));

            // FIX BUG CRÍTICO: La estrategia anterior con prefijo "new_chunk_N" causaba
            // pérdida de datos. Al tener set(chunk_N) y delete(chunk_N) en el MISMO batch,
            // el SDK de Firestore aplica el delete al final → los datos quedaban borrados.
            //
            // ESTRATEGIA CORREGIDA (write-first sin colisión de docs):
            // 1. Escribir directamente los docs finales "chunk_N" (sobrescribe los viejos).
            //    Cualquier lector sigue viendo datos válidos en todo momento.
            // 2. En un segundo batch separado, borrar únicamente los docs "chunk_N" con
            //    índice ≥ totalChunks (excess) y cualquier residuo "new_chunk_N" de ejecuciones
            //    anteriores con la lógica rota.
            const writeBatch = _db.batch();
            for (let i = 0; i < totalChunks; i++) {
                const chunk    = dataArray.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE);
                const chunkRef = colRef.doc('chunk_' + i);
                writeBatch.set(chunkRef, {
                    items:       chunk,
                    chunkIndex:  i,
                    totalChunks: totalChunks,
                    _updatedAt:  Date.now()
                });
            }
            await writeBatch.commit();

            // Eliminar docs obsoletos: chunks con índice mayor al nuevo total
            // y cualquier doc temporal "new_chunk_N" que haya quedado de la versión anterior.
            const existingSnap = await colRef.get();
            const toDelete = [];
            existingSnap.forEach(d => {
                if (d.id.startsWith('new_')) {
                    // Residuo de versión anterior con bug — eliminar siempre
                    toDelete.push(d.ref);
                } else {
                    const idx = parseInt(d.id.replace('chunk_', ''), 10);
                    if (isNaN(idx) || idx >= totalChunks) {
                        // Chunk de exceso (había más chunks antes) — eliminar
                        toDelete.push(d.ref);
                    }
                }
            });
            if (toDelete.length > 0) {
                const delBatch = _db.batch();
                toDelete.forEach(ref => delBatch.delete(ref));
                await delBatch.commit();
            }

            console.info('[Firebase][Chunk] ' + subcollName + ' → ' + totalChunks + ' chunk(s) escritos correctamente.');
        }

        // ══════════════════════════════════════════════════════════════════════
        //  _escribirSnapshotEnBatch(batch, docRef, registros)
        //  PASO PREVIO A FASE 3 — defecto H-1
        //  ────────────────────────────────────────────────────────────────────
        //  El snapshot del Inventario Físico NO puede usar
        //  _writeChunkedSubcollection(). Esa función sirve a ordersChunks e
        //  inventoriesChunks, donde sobrescribir es legítimo, y hace dos cosas
        //  que en snapshotChunks son ilegales: set() sobre documentos que ya
        //  existen (en Firestore eso es un 'update', prohibido por
        //  firestore.rules) y un segundo batch de borrado (también prohibido).
        //
        //  El resultado era un defecto silencioso y grave: si el cierre fallaba
        //  a mitad, el comentario del código afirmaba que reintentar era
        //  seguro, y NO lo era. El reintento chocaba con permission-denied y el
        //  inventario quedaba atascado —ni cerrado ni reabrible— con un
        //  snapshot parcial.
        //
        //  Esta función no escribe: AÑADE las operaciones a un batch que
        //  construye quien llama, para que los fragmentos y el cambio de estado
        //  a CERRADO viajen en una sola operación atómica. Así un fallo no deja
        //  nada escrito y el reintento parte siempre de cero.
        //
        //  Solo crea. Nunca borra, nunca sobrescribe.
        // ══════════════════════════════════════════════════════════════════════
        const SNAPSHOT_CHUNK_SIZE = 80;   // mismo tamaño que el resto del sistema
        const SNAPSHOT_MAX_OPS    = 450;  // margen bajo el límite de 500 de Firestore

        function _escribirSnapshotEnBatch(batch, docRef, registros) {
            if (!_db || !docRef || !batch) return { ok: false, motivo: 'sin_referencia' };
            if (!Array.isArray(registros)) registros = [];

            const colRef      = docRef.collection('snapshotChunks');
            const totalChunks = Math.max(1, Math.ceil(registros.length / SNAPSHOT_CHUNK_SIZE));

            // El batch lleva además el update del inventario a CERRADO, por eso
            // se reserva una operación. Con 424 productos salen 6 fragmentos;
            // el margen alcanza para unas 36.000 filas de snapshot. Si alguna
            // vez se superara, es mejor fallar aquí con un motivo claro que
            // recibir un error opaco de Firestore a mitad del cierre.
            if (totalChunks + 1 > SNAPSHOT_MAX_OPS) {
                return { ok: false, motivo: 'demasiados_fragmentos', totalChunks: totalChunks };
            }

            for (let i = 0; i < totalChunks; i++) {
                const chunk = registros.slice(i * SNAPSHOT_CHUNK_SIZE, (i + 1) * SNAPSHOT_CHUNK_SIZE);
                batch.set(colRef.doc('chunk_' + i), {
                    items:       chunk,
                    chunkIndex:  i,
                    totalChunks: totalChunks,
                    _updatedAt:  Date.now()
                });
            }
            return { ok: true, totalChunks: totalChunks, totalRegistros: registros.length };
        }

        /**
         * Lee todos los chunks de una subcolección y reconstruye el array original
         * ordenado por chunkIndex.
         * @param {firebase.firestore.DocumentReference} docRef
         * @param {string} subcollName
         * @returns {Promise<Array>}
         */
        async function _readChunkedSubcollection(docRef, subcollName) {
            if (!docRef) return [];
            try {
                const snap = await docRef.collection(subcollName).orderBy('chunkIndex').get();
                if (snap.empty) return [];
                const result = [];
                snap.forEach(d => {
                    const items = d.data().items;
                    if (Array.isArray(items)) items.forEach(item => result.push(item));
                });
                return result;
            } catch (e) {
                console.warn('[Firebase][Chunk] Error leyendo', subcollName, ':', e);
                return [];
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  CONTEO POR PRODUCTO — MIGRACIÓN MÍNIMA PARA CONCURRENCIA SEGURA
        //  ────────────────────────────────────────────────────────────────────
        //  Esquema nuevo:  stockAreas/{area}/productos/{productId}
        //                  { enteras, abiertas, version, actualizadoPor, ts }
        //
        //  Sustituye la escritura de snapshot completo por área (un solo
        //  documento con TODOS los productos, sobrescrito entero en cada sync)
        //  por una escritura atómica de UN producto a la vez, protegida con
        //  optimistic locking (campo `version`). Dos usuarios contando
        //  productos distintos en la misma área ya no compiten por el mismo
        //  documento; dos usuarios contando el MISMO producto casi al mismo
        //  tiempo son detectados y ninguno sobrescribe al otro en silencio.
        //
        //  No se usa runTransaction() a propósito: obliga a un viaje de ida y
        //  vuelta al servidor antes de poder escribir, y en la bodega del bar
        //  la señal se cae a media cuenta. En su lugar, cada escritura declara
        //  la versión que espera sobrescribir, y firestore.rules la rechaza si
        //  ya no coincide con la real.
        //
        //  D — CORRECCIÓN: aquí decía que los conteos quedaban "en cola del
        //  propio SDK de Firestore" al estar sin señal. Era falso por dos
        //  razones, y la segunda es la importante:
        //
        //    1. syncConteoProductoAtomico() cortaba por navigator.onLine
        //       ANTES de llamar a set(), así que el SDK nunca veía la
        //       escritura y su cola no llegaba a usarse nunca.
        //    2. Aunque se hubiera dejado pasar, apoyarse en esa cola sería
        //       incorrecto con bloqueo optimista. La versión que la escritura
        //       declara se fija en el momento de encolarla, pero solo se
        //       verifica al vaciarse, minutos u horas después. Si alguien más
        //       contó ese producto entretanto, la escritura sale rechazada y
        //       el SDK la descarta sin avisar: pérdida silenciosa, que es
        //       justo lo que este módulo existe para evitar.
        //
        //  La versión tiene que leerse en el momento de escribir, no en el de
        //  encolar. Por eso el corte por falta de señal se conserva, y lo que
        //  se añade es un registro propio de pendientes (_outboxConteo, abajo)
        //  que reintenta con lectura de versión fresca al volver la conexión.
        // ══════════════════════════════════════════════════════════════════════

        // Caché en memoria de la última versión conocida por producto+área.
        // Deliberadamente NO se persiste entre sesiones (se recarga sola la
        // primera vez que se toca cada producto) para mantener esta
        // migración mínima — ver _leerConteoProducto().
        let _versionesConteoProducto = {};
        let _conteoProductoSyncTimers = {};

        function _claveVersionProducto(productId, area) {
            return productId + '|' + area;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  D · DEFECTO CRÍTICO — EL CONTEO SIN SEÑAL NUNCA LLEGABA A LA NUBE
        //  ────────────────────────────────────────────────────────────────────
        //  Lo que pasaba en la barra: el bartender cuenta en la bodega, donde
        //  no hay señal. La app le dice "Guardado en el dispositivo — subiendo".
        //  El conteo entra en localStorage y ahí se queda. No había nada que
        //  lo reintentara: el corte por navigator.onLine devolvía 'offline' y
        //  el resultado se anunciaba al usuario, pero la clave no quedaba
        //  anotada en ningún sitio. Si además otro aparato sincronizaba
        //  mientras tanto, al reconectar _applyCloudData reemplazaba
        //  inventarioConteo entero y el conteo desaparecía sin dejar rastro.
        //
        //  Lo único que existía era un rescate parcial: al CERRAR la pestaña,
        //  las claves de los debounce que no habían alcanzado a dispararse se
        //  anotaban en localStorage. Solo cubría ese caso, y solo si el
        //  usuario cerraba la pestaña en vez de perder la señal.
        //
        //  _outboxConteo generaliza ese rescate: una clave `productId|area`
        //  entra ANTES de intentar subir y solo sale cuando el servidor
        //  confirma. Sobrevive al cierre de la app, a quedarse sin batería y
        //  a perder la señal. Se vacía al arrancar, al volver la conexión y
        //  en el sync periódico, releyendo la versión real cada vez.
        //
        //  El dato en sí nunca dependió de esto: ya estaba a salvo en
        //  localStorage/IndexedDB. Lo que faltaba era que alguien se acordara
        //  de volver a intentarlo.
        // ══════════════════════════════════════════════════════════════════════

        const _OUTBOX_CONTEO_KEY = 'inventarioApp_conteoPendiente';
        // Clave del rescate anterior (solo beforeunload). Se lee una vez al
        // arrancar para no perder lo que dejó la versión vieja, y se borra.
        const _OUTBOX_CONTEO_KEY_LEGACY = 'inventarioApp_conteoProductoPendiente';

        // { 'productId|area': { ts, base } }
        //   ts   — cuándo se anotó, para poder informar al usuario.
        //   base — la versión del servidor que este dispositivo creía vigente
        //          cuando guardó el conteo, o null si nunca la supo.
        //
        //  `base` es lo que impide que un reintento pise el trabajo de otro.
        //  Sin ella, un conteo hecho sin señal a las 6 de la tarde se subiría
        //  al reconectar leyendo la versión de ese momento y escribiendo la
        //  siguiente — borrando en silencio lo que otro bartender contó a las
        //  7. Con ella, el reintento compara: si el servidor sigue donde lo
        //  dejamos, sube; si se movió, no sube nada y registra un conflicto.
        let _outboxConteo = {};

        function _outboxGuardar() {
            try {
                localStorage.setItem(_OUTBOX_CONTEO_KEY, JSON.stringify(_outboxConteo));
            } catch (_) { /* cuota llena: el dato sigue en inventarioConteo */ }
        }

        function _outboxCargar() {
            try {
                const crudo = localStorage.getItem(_OUTBOX_CONTEO_KEY);
                const leido = crudo ? JSON.parse(crudo) : null;
                if (leido && typeof leido === 'object' && !Array.isArray(leido)) {
                    // Se normaliza por si viene de una versión que guardaba
                    // solo el timestamp: sin `base` conocida, el reintento
                    // será conservador y pedirá confirmación ante cualquier
                    // duda, que es el lado correcto en el que equivocarse.
                    Object.keys(leido).forEach(function(clave) {
                        const v = leido[clave];
                        _outboxConteo[clave] = (v && typeof v === 'object')
                            ? { ts: v.ts || Date.now(), base: (typeof v.base === 'number' ? v.base : null) }
                            : { ts: (typeof v === 'number' ? v : Date.now()), base: null };
                    });
                }
            } catch (_) { _outboxConteo = {}; }

            // Migración de la clave anterior, que guardaba un array de claves.
            try {
                const viejo = localStorage.getItem(_OUTBOX_CONTEO_KEY_LEGACY);
                if (viejo) {
                    const claves = JSON.parse(viejo);
                    if (Array.isArray(claves)) {
                        claves.forEach(function(clave) {
                            if (typeof clave === 'string' && clave.indexOf('|') > 0 &&
                                !(clave in _outboxConteo)) {
                                _outboxConteo[clave] = { ts: Date.now(), base: null };
                            }
                        });
                    }
                    localStorage.removeItem(_OUTBOX_CONTEO_KEY_LEGACY);
                    _outboxGuardar();
                }
            } catch (_) {}

            return _outboxConteo;
        }

        function _outboxAnotar(productId, area) {
            const clave = _claveVersionProducto(productId, area);
            if (!(clave in _outboxConteo)) {
                const base = (clave in _versionesConteoProducto)
                    ? _versionesConteoProducto[clave]
                    : null;
                _outboxConteo[clave] = { ts: Date.now(), base: base };
                _outboxGuardar();
            }
            return clave;
        }

        function _outboxQuitar(productId, area) {
            const clave = _claveVersionProducto(productId, area);
            if (clave in _outboxConteo) {
                delete _outboxConteo[clave];
                _outboxGuardar();
            }
        }

        function _outboxTienePendiente(productId, area) {
            return _claveVersionProducto(productId, area) in _outboxConteo;
        }

        function _outboxPendientes() {
            return Object.keys(_outboxConteo);
        }

        /**
         * drenarConteosPendientes()
         * ─────────────────────────
         * Reintenta contra el servidor todos los conteos anotados como
         * pendientes, leyendo la versión real de cada uno en el momento (no
         * la que tenía cuando se guardó). Se llama al arrancar, al volver la
         * conexión y en el sync periódico.
         *
         * No reintenta lo que ya no existe en el conteo local: si el producto
         * se borró o el conteo se revirtió al valor del servidor, la clave se
         * descarta en vez de resucitar un valor que el usuario ya no tiene.
         *
         * Y no sube nada a ciegas: antes de escribir comprueba que el
         * documento del servidor siga en la versión que este dispositivo
         * esperaba. Si se movió, alguien más contó ese producto mientras
         * tanto y el reintento se convierte en conflicto, no en sobrescritura.
         */
        async function drenarConteosPendientes() {
            if (!_db || !navigator.onLine) return { intentados: 0, confirmados: 0, conflictos: 0 };

            const claves = _outboxPendientes();
            if (claves.length === 0) return { intentados: 0, confirmados: 0, conflictos: 0 };

            console.info('[ConteoProducto] Reintentando', claves.length, 'conteo(s) pendiente(s)…');

            let confirmados = 0;
            let conflictos  = 0;

            for (const clave of claves) {
                const corte = clave.indexOf('|');
                if (corte <= 0) { delete _outboxConteo[clave]; continue; }
                const pid  = clave.slice(0, corte);
                const area = clave.slice(corte + 1);

                const valor = inventarioConteo[pid] && inventarioConteo[pid][area];
                if (!valor || typeof valor.enteras === 'undefined') {
                    // Ya no hay valor local que subir: la clave sobra.
                    delete _outboxConteo[clave];
                    continue;
                }

                const anotacion = _outboxConteo[clave] || { base: null };
                const remoto    = await _leerConteoProducto(pid, area);
                const versionServidor = remoto ? (remoto.version || 0) : 0;

                // ¿Se movió el servidor desde que guardamos sin señal?
                //   base null  → nunca supimos la versión. Solo es seguro si
                //                el producto sigue sin contar por nadie.
                //   base n     → seguro solo si el servidor sigue en n.
                const baseEsperada = (typeof anotacion.base === 'number') ? anotacion.base : 0;
                const servidorIntacto = (versionServidor === baseEsperada);

                if (!servidorIntacto) {
                    // Otro dispositivo contó este producto mientras este no
                    // tenía señal. Subir ahora borraría ese conteo. Se deja
                    // constancia y se saca de pendientes: lo resuelve una
                    // persona, no un reintento automático.
                    console.warn('[ConteoProducto] Conflicto al reintentar', pid, area,
                        '— esperaba v' + baseEsperada + ', el servidor va en v' + versionServidor);
                    delete _outboxConteo[clave];
                    conflictos++;
                    await _registrarConflictoVersion(pid, area, baseEsperada,
                        valor.enteras, valor.abiertas || []);
                    continue;
                }

                // El servidor sigue donde lo dejamos: se puede subir con la
                // versión correcta, sin adivinar.
                _versionesConteoProducto[clave] = versionServidor;
                const res = await syncConteoProductoAtomico(
                    pid, area, valor.enteras, valor.abiertas || []);
                if (res && res.ok) confirmados++;
            }
            _outboxGuardar();

            if (confirmados > 0) {
                console.info('[ConteoProducto]', confirmados, 'conteo(s) confirmado(s) al reconectar.');
                if (typeof syncStockByAreaFromConteo === 'function') syncStockByAreaFromConteo();
                if (typeof showNotification === 'function') {
                    showNotification('✅ ' + confirmados +
                        ' conteo(s) que estaban sin subir ya llegaron a la nube.');
                }
            }
            if (typeof updateCloudSyncBadge === 'function') {
                updateCloudSyncBadge(_outboxPendientes().length > 0 ? 'pending' : 'ok');
            }
            return { intentados: claves.length, confirmados: confirmados, conflictos: conflictos };
        }

        /**
         * _esErrorDeRed(err)
         * ──────────────────
         * Distingue "el servidor me rechazó" de "no pude hablar con el
         * servidor". Antes todo error caía en el mismo saco y se anunciaba
         * como conflicto de versión, así que un corte de red producía el
         * mensaje "alguien más actualizó este producto" — falso, y además
         * ensuciaba el registro de conflictos con ruido.
         *
         * La diferencia importa para el reintento: un rechazo por versión NO
         * se debe reintentar solo (reintentarlo pisaría el conteo del otro),
         * pero un fallo de red SÍ.
         */
        function _esErrorDeRed(err) {
            const codigo = err && (err.code || err.name || '');
            return codigo === 'unavailable'
                || codigo === 'deadline-exceeded'
                || codigo === 'internal'
                || codigo === 'resource-exhausted'
                || codigo === 'cancelled'
                || codigo === 'aborted';
        }

        // F1 — DEFECTO CRÍTICO 1: las tres funciones de abajo usaban una
        // variable `docRef` que NO existe en este ámbito. Las únicas
        // declaraciones de ese nombre en todo el proyecto son `const` locales
        // DENTRO de otras funciones (_flushSyncQueueToFirestore,
        // subscribeMainDoc, etc.), así que aquí resolvía a un identificador
        // libre y lanzaba ReferenceError antes de intentar escribir nada.
        //
        // Consecuencia real, verificada ejecutando la función: cada conteo
        // guardado desde la pestaña Inicio se quedaba en el dispositivo y el
        // usuario veía "no se pudo subir — se reintentará". El reintento
        // fallaba por lo mismo. El bug es anterior a la partición en 17
        // archivos (ya estaba en el commit 0283ddd).
        //
        // Se corrige con un ayudante explícito en vez de declarar otra global:
        // una global más sería una cuarta forma de nombrar lo mismo, y el
        // origen del fallo fue justamente esa ambigüedad. Devuelve null si
        // todavía no hay conexión a la base, que es la condición que las tres
        // funciones ya comprobaban.
        function _docPrincipal() {
            if (!_db) return null;
            return _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID);
        }

        // Lee el documento actual de un producto/área directo de Firestore.
        // Devuelve null si nunca se ha escrito (primer conteo de ese producto
        // en esa área, desde ningún dispositivo).
        async function _leerConteoProducto(productId, area) {
            const docRef = _docPrincipal();
            if (!_db || !docRef) return null;
            try {
                const snap = await docRef.collection('stockAreas').doc(area)
                    .collection('productos').doc(productId).get();
                return snap.exists ? snap.data() : null;
            } catch (e) {
                console.warn('[ConteoProducto] Error leyendo', productId, area, e);
                return null;
            }
        }

        /**
         * syncConteoProductoAtomico(productId, area, enteras, abiertas)
         * ───────────────────────────────────────────────────────────
         * Escritura atómica de UN producto en UNA área, con optimistic
         * locking. Es la única forma correcta de sincronizar un conteo
         * regular hacia Firestore — reemplaza al bloque `areaWrites` que
         * syncToCloud() usaba antes (snapshot completo del área, sin
         * protección alguna ante escritura concurrente).
         *
         * Devuelve { ok: true, version } en éxito, o
         *          { ok: false, motivo, error? } si no se pudo confirmar.
         * Un `ok:false` NUNCA significa pérdida de datos: el valor ya vive
         * en localStorage/IndexedDB vía saveToLocalStorage() antes de que
         * esta función se invoque — solo significa que la nube todavía no
         * lo confirmó como autoritativo.
         */
        async function syncConteoProductoAtomico(productId, area, enteras, abiertas) {
            // D: la clave se anota ANTES de cualquier intento. Si la app se
            // cierra, se queda sin batería o pierde la señal a partir de aquí,
            // al volver se sabe que este conteo quedó sin confirmar.
            _outboxAnotar(productId, area);

            const docRef = _docPrincipal();
            if (!_db || !docRef) return { ok: false, motivo: 'sin_conexion_bd' };
            if (!navigator.onLine) {
                // Queda pendiente en el outbox; drenarConteosPendientes() lo
                // reintenta al volver la conexión, releyendo la versión real.
                return { ok: false, motivo: 'offline' };
            }

            const clave = _claveVersionProducto(productId, area);
            const ref = docRef.collection('stockAreas').doc(area)
                               .collection('productos').doc(productId);

            try {
                // Si esta sesión nunca tocó este producto/área, se pregunta
                // primero al servidor la versión real — evita adivinar
                // version:1 sobre un documento que ya existía y provocar un
                // rechazo evitable en el caso más común (primer conteo desde
                // ESTE dispositivo, aunque OTROS ya hayan contado antes).
                if (!(clave in _versionesConteoProducto)) {
                    const actual = await _leerConteoProducto(productId, area);
                    _versionesConteoProducto[clave] = actual ? (actual.version || 0) : 0;
                }

                const versionEsperada = _versionesConteoProducto[clave];
                const nuevaVersion    = versionEsperada + 1;

                await ref.set({
                    enteras:        enteras,
                    abiertas:       abiertas,
                    version:        nuevaVersion,
                    actualizadoPor: currentUserUid || 'anonymous',
                    ts:             firebase.firestore.FieldValue.serverTimestamp()
                });

                _versionesConteoProducto[clave] = nuevaVersion;
                // Confirmado por el servidor: es el único punto donde la
                // clave sale de pendientes.
                _outboxQuitar(productId, area);
                return { ok: true, version: nuevaVersion };

            } catch (err) {
                // D: antes cualquier error se anunciaba como conflicto de
                // versión, incluido un simple corte de red. Ahora se separan,
                // porque el reintento debe comportarse al revés en cada caso.
                if (_esErrorDeRed(err)) {
                    // No se pudo hablar con el servidor. El conteo sigue
                    // pendiente y se reintenta solo al recuperar la conexión.
                    console.warn('[ConteoProducto] Sin respuesta del servidor para', productId, area, err);
                    return { ok: false, motivo: 'offline', error: err };
                }

                // Rechazado por firestore.rules: la versión ya no coincide,
                // o sea que otro dispositivo contó este mismo producto. NO se
                // reintenta solo: reintentarlo pisaría el conteo del otro sin
                // que nadie lo decida. Sale de pendientes y queda registrado
                // como conflicto para que el jefe de barra lo resuelva.
                console.warn('[ConteoProducto] Escritura rechazada para', productId, area, err);
                _outboxQuitar(productId, area);
                await _registrarConflictoVersion(productId, area, _versionesConteoProducto[clave] || 0, enteras, abiertas);
                return { ok: false, motivo: 'conflicto_version', error: err };
            }
        }

        // ── Log de conflictos ───────────────────────────────────────────────
        // Reutiliza el mecanismo ya existente (_registrarConflictos: memoria +
        // localStorage + IDB + Firestore) para que verConflictos() y el resto
        // de la infraestructura de conflictos ya construida sigan funcionando
        // sin cambios sobre este nuevo tipo de conflicto.
        async function _registrarConflictoVersion(productId, area, versionEsperada, enterasLocal, abiertasLocal) {
            const remoto  = await _leerConteoProducto(productId, area);
            const product = products.find(function(p) { return p.id === productId; });

            _registrarConflictos([{
                tipo:          'version_mismatch',
                ts:            Date.now(),
                prodId:        productId,
                prodName:      product ? product.name : productId,
                area:          area,
                valorOriginal: versionEsperada,
                valorLocal:    enterasLocal,
                valorNube:     remoto ? remoto.enteras : null,
                usuarioLocal:  currentUserUid || 'local'
            }]);

            // Refrescar el caché con la versión real, para que el próximo
            // intento de guardado (manual o automático) parta de la base
            // correcta en vez de repetir el mismo rechazo.
            if (remoto) {
                _versionesConteoProducto[_claveVersionProducto(productId, area)] = remoto.version;
            }

            showNotification('⚠️ ' + (product ? product.name : productId) +
                ': alguien más actualizó este producto en ' + area +
                '. Tu valor no se guardó — revisa el conteo actual antes de reintentar.');
        }

        // ── Rollback simple ──────────────────────────────────────────────────
        // Descarta el valor local no confirmado y adopta el valor actual del
        // servidor para un producto/área específico. Es la acción que se
        // ofrece al usuario tras un conflicto de versión, y también sirve
        // como recuperación manual ante cualquier duda sobre el conteo local.
        async function revertirConteoProductoAServidor(productId, area) {
            const remoto = await _leerConteoProducto(productId, area);
            if (!remoto) {
                showNotification('No hay valor en el servidor todavía para ' + productId + ' — se conserva el local.');
                return false;
            }
            if (!inventarioConteo[productId]) inventarioConteo[productId] = {};
            inventarioConteo[productId][area] = { enteras: remoto.enteras, abiertas: remoto.abiertas || [] };
            _versionesConteoProducto[_claveVersionProducto(productId, area)] = remoto.version;
            syncStockByAreaFromConteo();
            saveToLocalStorage();
            renderTab();
            showNotification('Conteo de ' + productId + ' revertido al valor del servidor (v' + remoto.version + ').');
            return true;
        }

        // ── Migración de datos existentes ───────────────────────────────────
        // Traslada, una sola vez, el contenido de los documentos antiguos
        // stockAreas/{area} (un documento con TODOS los productos) hacia el
        // nuevo esquema stockAreas/{area}/productos/{productId}. Idempotente:
        // puede ejecutarse más de una vez sin duplicar ni corromper nada,
        // porque siempre escribe version:1 solo si el producto nuevo aún no
        // existe. Pensada para ejecutarse una vez, por un admin, desde la
        // consola (migrarStockAreasAProductos()), no automáticamente.
        async function migrarStockAreasAProductos() {
            const docRef = _docPrincipal();
            if (!_db || !docRef || !hasPermission('settings.update')) {
                console.warn('[Migración] Requiere permiso settings.update y conexión.');
                return { ok: false };
            }
            const areasConocidas = AREAS_CONTEO;
            let migrados = 0, yaExistian = 0, errores = 0;

            for (const area of areasConocidas) {
                const snapArea = await docRef.collection('stockAreas').doc(area).get();
                if (!snapArea.exists) continue;
                const data = snapArea.data();
                const colProductos = docRef.collection('stockAreas').doc(area).collection('productos');

                for (const prodId of Object.keys(data)) {
                    if (prodId.startsWith('_')) continue; // metadatos (_lastModified, etc.)
                    const valor = data[prodId];
                    if (!valor || typeof valor !== 'object') continue;
                    try {
                        const destino = colProductos.doc(prodId);
                        const yaExiste = await destino.get();
                        if (yaExiste.exists) { yaExistian++; continue; }
                        await destino.set({
                            enteras:        valor.enteras || 0,
                            abiertas:       valor.abiertas || [],
                            version:        1,
                            actualizadoPor: 'migracion',
                            ts:             firebase.firestore.FieldValue.serverTimestamp()
                        });
                        migrados++;
                    } catch (e) {
                        console.warn('[Migración] Error migrando', prodId, area, e);
                        errores++;
                    }
                }
            }
            console.info('[Migración] Completa — migrados:', migrados, 'ya existían:', yaExistian, 'errores:', errores);
            showNotification('Migración de conteo completa: ' + migrados + ' productos migrados.');
            return { ok: true, migrados: migrados, yaExistian: yaExistian, errores: errores };
        }

        /**
         * syncToCloud()
         * ─────────────
         * Sube el estado actual a Firestore usando SET (merge: false).
         * Estrategia de conflictos: "último-gana" basado en _lastModified.
         * Solo escribe si el timestamp local es ≥ al que ya está en la nube.
         *
         * Seguridades:
         *   • Semáforo _syncInProgress evita escrituras concurrentes
         *   • Si no hay _db o no hay conexión, marca _cloudSyncPending = true
         *     y espera al evento 'online' para reintentar
         *   • Reintentos con back-off exponencial (max 3 intentos)
         *
         * NOTA — MIGRACIÓN MÍNIMA DE CONCURRENCIA (ver bloque anterior):
         * esta función YA NO escribe el snapshot completo de stockAreas por
         * área. El conteo regular se sincroniza producto por producto, de
         * forma atómica, vía syncConteoProductoAtomico() — invocado
         * directamente desde saveInventarioModal(), no desde aquí.
         */
        // ════════════════════════════════════════════════════════
        //  M2a — SESIÓN DE FIREBASE RESUELTA
        //  ────────────────────────────────────────────────────
        //  Firebase Auth restaura la sesion desde IndexedDB de forma ASINCRONA.
        //  Hasta que eso termina, _auth.currentUser es null y las Rules rechazan
        //  cualquier lectura o escritura (request.auth == null). Medido en
        //  produccion el 2026-09-06: ~8 peticiones condenadas por arranque, mas
        //  tres reintentos con back-off (2+4+8 s) que ademas llenaban
        //  _syncErrorLog de permission-denied falsos, enterrando los errores
        //  reales. Nada de esto era un fallo de permisos: era una carrera.
        // ════════════════════════════════════════════════════════
        function _haySesionFirebase() {
            // window._auth y el _auth lexico son DOS enlaces distintos: el
            // primero es una copia hecha al inicializar Firebase. Hay que
            // comprobar y leer sobre la MISMA referencia o, si una de las dos
            // esta a null (Firebase no cargo), esto revienta.
            var a = window._auth || _auth;
            return !!(a && a.currentUser);
        }

        // Resuelve UNA sola vez, con el usuario restaurado o null. En cuanto
        // resuelve, vacia la sincronizacion que se haya quedado pendiente
        // durante la carrera — sin esperar al sync periodico de 3 minutos.
        const _esperarSesion = (function() {
            const p = new Promise(function(resolve) {
                const a = window._auth || _auth;   // misma referencia (ver arriba)
                if (!a || typeof a.onAuthStateChanged !== 'function') { resolve(null); return; }
                const cancelar = a.onAuthStateChanged(function(user) {
                    cancelar();
                    resolve(user || null);
                });
            });
            p.then(function(user) {
                if (user && _db && navigator.onLine && _cloudSyncPending) {
                    console.info('[Init] Sesion resuelta — vaciando sincronizacion pendiente.');
                    syncToCloud();
                }
            });
            return function() { return p; };
        })();

        async function syncToCloud(retryCount = 0) {
            if (!_db) return; // Firebase no configurado
            // M2a: sin sesion resuelta la escritura esta condenada. Se marca
            // pendiente y se vacia desde _esperarSesion, sin quemar el back-off.
            if (!_haySesionFirebase()) {
                _cloudSyncPending = true;
                updateCloudSyncBadge('pending');
                return;
            }
            if (!_syncEnabled) { _cloudSyncPending = true; updateCloudSyncBadge('pending'); return; } // sync desactivado
            if (_syncInProgress) return; // Ya hay una sincronización en curso
            if (!navigator.onLine) {
                _cloudSyncPending = true;
                updateCloudSyncBadge('pending');
                return;
            }

            _syncInProgress = true;
            updateCloudSyncBadge('syncing');

            try {
                const localTs = parseInt(localStorage.getItem('inventarioApp_lastModified') || '0', 10);

                // ── Verificar timestamp de la nube antes de escribir ───────────
                // Evita sobrescribir con datos más viejos si otro dispositivo
                // guardó algo más reciente mientras estábamos offline.
                const docRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID);
                const snap = await docRef.get();

                if (snap.exists) {
                    const cloudTs = snap.data()._lastModified || 0;
                    if (cloudTs > localTs) {
                        // ── RESOLUCIÓN DE CONFLICTOS BASADA EN EVENTOS ────────────────
                        // ANTES: descargábamos la nube y descartábamos todos los cambios locales.
                        // AHORA: si hay eventos locales más nuevos que cloudTs, los preservamos.
                        //
                        // Algoritmo:
                        //   1) Identificar eventos locales con ts > cloudTs (cambios locales nuevos)
                        //   2) Descargar y aplicar datos de la nube
                        //   3) Re-aplicar sobre los datos descargados solo los eventos locales nuevos
                        //   4) Resultado: ambos conjuntos de cambios coexisten
                        const localEventsNewer = _syncQueue.filter(function(e) {
                            return (e.ts || 0) > cloudTs &&
                                   e.estado === 'pendiente' &&
                                   e.tipo === 'inventario' &&
                                   e.prodId && e.area;
                        });

                        console.info('[Firebase] Nube más reciente (cloudTs=' + cloudTs + ' > localTs=' + localTs + ').');
                        if (localEventsNewer.length > 0) {
                            console.info('[Firebase] Preservando ' + localEventsNewer.length +
                                ' evento(s) local(es) más nuevos que la nube → merge inteligente.');
                        }

                        // Aplicar datos de la nube
                        _syncInProgress = false;
                        await _applyCloudData(snap.data());

                        // Re-aplicar eventos locales más nuevos encima de los datos de la nube
                        if (localEventsNewer.length > 0) {
                            // ── CORRECCIÓN 2: Detección de conflictos entre usuarios ────────
                            // Un conflicto ocurre cuando dos usuarios modificaron el MISMO
                            // producto/área. Se detecta comparando los eventos locales contra
                            // los valores que llegaron de la nube.
                            const conflictos = [];
                            localEventsNewer.forEach(function(ev) {
                                const cloudConteo = snap.data().inventarioConteo;
                                // Verificar si la nube tiene un valor diferente al "antes" local
                                // Si es diferente, alguien más también modificó ese producto/área
                                const cloudVal = cloudConteo &&
                                                 cloudConteo[ev.prodId] &&
                                                 cloudConteo[ev.prodId][ev.area];
                                if (cloudVal && typeof cloudVal.enteras === 'number' &&
                                    cloudVal.enteras !== ev.valorAntes) {
                                    conflictos.push({
                                        prodId:       ev.prodId,
                                        prodName:     ev.prodName || ev.prodId,
                                        area:         ev.area,
                                        valorNubeTs:  cloudTs,
                                        valorNube:    cloudVal.enteras,
                                        valorLocal:   ev.valorDespues,
                                        valorOriginal:ev.valorAntes,
                                        usuarioLocal: ev.usuario || 'local',
                                        ts:           Date.now()
                                    });
                                }
                                // Aplicar el valor local (preservar trabajo local)
                                if (!inventarioConteo[ev.prodId]) inventarioConteo[ev.prodId] = {};
                                inventarioConteo[ev.prodId][ev.area] = {
                                    enteras:  ev.valorDespues,
                                    abiertas: ev.abiertas || [],
                                    _ts:      ev.ts
                                };
                            });

                            // Registrar conflictos detectados
                            if (conflictos.length > 0) {
                                _registrarConflictos(conflictos);
                            }

                            syncStockByAreaFromConteo();
                            saveToLocalStorage({ skipSyncTrigger: true });
                            setTimeout(function() { syncToCloud(); }, 2000);
                        }
                        return;
                    }
                }

                // ══════════════════════════════════════════════════════════════
                // FIX-CONCURRENCIA (BarInventory)
                // ──────────────────────────────────────────────────────────────
                // products/orders/inventories se escribían como el array LOCAL
                // completo, sobreescribiendo lo que otro dispositivo hubiera
                // agregado entre la última descarga y este momento (ej. dos
                // bartenders creando un pedido casi al mismo tiempo → el que
                // sincronizaba último borraba el pedido del otro). Se fusiona
                // por id con la versión más reciente conocida de la nube —
                // reutilizando el `snap` ya leído arriba, sin lecturas extra
                // para 'products'; para 'orders'/'inventories' se usa la misma
                // _readChunkedSubcollection ya empleada en _applyCloudData.
                // ══════════════════════════════════════════════════════════════
                const cloudDataForMerge = snap.exists ? snap.data() : null;
                const cloudProductsForMerge = (cloudDataForMerge && Array.isArray(cloudDataForMerge.products))
                    ? cloudDataForMerge.products : [];
                if (_purgaDeCatalogoVigente(cloudDataForMerge)) {
                    // D — el catálogo se vació en este dispositivo y la nube
                    // todavía no se ha enterado. Fusionar aquí devolvería los
                    // productos que no alcanzaron lápida (ver la nota larga en
                    // 20-persistencia.js). La purga sube tal cual y la nube
                    // queda vacía de verdad.
                    console.info('[Catalogo] Purga vigente — no se fusiona el catálogo de la nube.');
                } else {
                    products = _mergeArrayByIdPreferLocal(products, cloudProductsForMerge, _deletedProductIds);
                }

                try {
                    const cloudOrdersForMerge = cloudDataForMerge
                        ? (cloudDataForMerge._ordersInChunks
                            ? await _readChunkedSubcollection(docRef, 'ordersChunks')
                            : (cloudDataForMerge.orders || []))
                        : [];
                    orders = _mergeArrayByIdPreferLocal(orders, cloudOrdersForMerge, _deletedOrderIds);
                } catch (e) {
                    console.warn('[Sync] No se pudo fusionar orders con la nube antes de escribir, se usa versión local:', e);
                }
                try {
                    const cloudInventoriesForMerge = cloudDataForMerge
                        ? (cloudDataForMerge._inventoriesInChunks
                            ? await _readChunkedSubcollection(docRef, 'inventoriesChunks')
                            : (cloudDataForMerge.inventories || []))
                        : [];
                    inventories = _mergeArrayByIdPreferLocal(inventories, cloudInventoriesForMerge, _deletedInventoryIds);
                } catch (e) {
                    console.warn('[Sync] No se pudo fusionar inventories con la nube antes de escribir, se usa versión local:', e);
                }

                // ══════════════════════════════════════════════════════════════
                // FIX 1 — LÍMITE 1 MB EN FIRESTORE
                // ──────────────────────────────────────────────────────────────
                // Un documento Firestore tiene un límite estricto de 1 MiB.
                // Los arrays `orders` e `inventories` crecen indefinidamente con
                // el histórico de operaciones y son los responsables del colapso.
                //
                // Estrategia:
                //   • El documento principal solo almacena datos OPERATIVOS.
                //   • `orders` e `inventories` se escriben en subcolecciones
                //     independientes por chunks de MAX_CHUNK_SIZE ítems.
                //   • _writeChunkedSubcollection / _readChunkedSubcollection son
                //     funciones globales (FIX #3) que reciben docRef como argumento.
                // ══════════════════════════════════════════════════════════════

                // ── Preparar payload OPERATIVO (sin orders ni inventories) ─────
                // FASE 0 — S-1: el payload se divide en dos partes.
                //
                // Parte común: los campos que CUALQUIER dispositivo necesita
                // escribir en su sincronización normal. Coinciden exactamente
                // con la lista blanca _camposSyncNoAdmin() de firestore.rules;
                // si se agrega un campo aquí, hay que agregarlo también allá o
                // la escritura será rechazada.
                const payload = {
                    cart:              cart,
                    // inventarioConteo → en subcolección stockAreas (no en doc principal)
                    // auditoriaConteo → NO se persiste en Firestore porque es dato
                    //   CALCULADO en memoria a partir de allUsersAuditoria. Guardarlo
                    //   como canónico causaba corrupción al cargar en otro dispositivo.
                    activeTab:         activeTab,
                    selectedArea:      selectedArea,
                    _lastModified:     Date.now(), // FIX 10: timestamp actual, no el del LS
                    _syncedAt:         Date.now(),
                    _ordersInChunks:      true,
                    _inventoriesInChunks: true,
                    _conteoInSubcol:      true,
                    _lastWrittenBy:    currentUserUid || 'anonymous',
                    _lastWrittenRole:  currentUserRole || 'user'
                };

                // Parte de administrador: catálogo y estado global de auditoría.
                //
                // Antes se enviaban desde TODOS los dispositivos. Eso no solo
                // era el vector de la vulnerabilidad S-1: era además un bug de
                // datos real, porque un bartender con una copia local
                // desactualizada podía revertir un cambio hecho por el admin
                // (p. ej. devolver a 'completada' un área que el admin acababa
                // de reabrir). Ahora solo el admin los propaga.
                if (isAdmin()) {
                    payload.products        = products;
                    payload.auditoriaStatus = auditoriaStatus;
                    // D — la marca de purga viaja con el catálogo. Sin ella,
                    // otro dispositivo con los 424 productos todavía en local
                    // los volvería a subir en su siguiente sincronización.
                    if (_catalogoPurgadoEn) payload._catalogoPurgadoEn = _catalogoPurgadoEn;
                    // R6: la definicion de areas viaja con el resto de lo global.
                    // Sin esto, el admin crea un area y los bartenders no la ven:
                    // contarian en tres areas mientras el panel espera cuatro.
                    if (typeof areasConteoDef !== 'undefined') payload.areasConteo = areasConteoDef;
                    // FIX-SESSION: incluir _auditoriaSessionId para que otros dispositivos
                    // detecten cambios de ciclo de auditoría incluso sin pasar por
                    // _adminIniciarSesionFirestore (p.ej., reconexiones tardías).
                    // Solo el admin inicia sesiones, así que solo él debe anunciarlas.
                    payload._auditoriaSessionId = _auditoriaSessionId || null;
                }

                // MIGRACIÓN MÍNIMA DE CONCURRENCIA: el conteo por producto/área
                // (stockAreas/{area}/productos/{id}) YA NO se sincroniza aquí.
                // Se escribe de forma atómica y versionada, producto por
                // producto, desde syncConteoProductoAtomico() — invocada
                // directamente al guardar cada conteo en saveInventarioModal().
                // Escribir aquí un snapshot completo por área (como antes)
                // reintroduciría exactamente el riesgo que esta migración
                // elimina: dos usuarios contando productos distintos en la
                // misma área podían sobrescribirse el uno al otro.

                // Escritura paralela: doc principal + subcolecciones históricas
                // merge:true en docRef.set() evita sobrescribir campos de otros dispositivos
                await Promise.all([
                    docRef.set(payload, { merge: true }),
                    _writeChunkedSubcollection(docRef, 'ordersChunks', orders),
                    _writeChunkedSubcollection(docRef, 'inventoriesChunks', inventories)
                ]);

                _cloudSyncPending = false;
                _lastCloudSync    = Date.now();
                _syncInProgress   = false;
                updateCloudSyncBadge('ok');
                console.info('[Firebase] Sincronizado ✓ (' + new Date(_lastCloudSync).toLocaleTimeString() + ')');

                // Subir eventos pendientes de la cola de sincronización a Firestore
                _flushSyncQueueToFirestore().catch(function(e) {
                    console.warn('[SyncQueue] Error al subir cola:', e);
                });

            } catch (err) {
                _syncInProgress = false;
                _logSyncError('syncToCloud', err.message || String(err), err.code || '');
                console.error('[Firebase] Error en syncToCloud:', err);

                // Back-off exponencial: 2s, 4s, 8s
                // FIX-7: Marcar pendiente para que el sync periódico lo reintente
        if (retryCount < 3) {
            const delay = Math.pow(2, retryCount + 1) * 1000;
            _cloudSyncPending = true;
            console.info('[Firebase] Reintentando en ' + (delay/1000) + 's… (intento ' + (retryCount + 1) + '/3)');
            setTimeout(() => syncToCloud(retryCount + 1), delay);
        } else {
                    _cloudSyncPending = true;
                    updateCloudSyncBadge('error');
                    showNotification('☁️ Sin sync — se guardó localmente');
                }
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  ESCRITURA ATÓMICA DE CONTEO POR ÁREA (Anticolisión)
        // ══════════════════════════════════════════════════════════════════════
        /**
         * syncConteoAtomicoPorArea(area)
         * ──────────────────────────────
         * Escribe el conteo de auditoría de UN área en Firestore de forma atómica,
         * usando FieldValue.increment() para sumar cantidades en paralelo y
         * detección de conflictos para botellas abiertas.
         *
         * Documento de destino (subcolección independiente del doc principal):
         *   inventarioApp/{FIRESTORE_DOC_ID}/conteoAreas/{area}
         *
         * Estrategia por campo:
         *  • enteras: FieldValue.increment(valor) → dos escrituras simultáneas SUMAN
         *  • abiertas: transacción que detecta divergencia → si el valor difiere,
         *    escribe stock_abierto_alternativo y marca alerta_conflicto: true
         *  • Si la colección del área no existe aún, se crea con set({merge:true})
         *
         * @param {string} area - clave del área ('almacen' | 'barra1' | 'barra2')
         */
       async function syncConteoAtomicoPorArea(area) {
            if (!_db) {
                console.info('[MultiDisp] Firebase no disponible — conteo guardado solo en local.');
                return;
            }
            if (!navigator.onLine) {
                showNotification('📴 Sin conexión — conteo guardado localmente');
                updateCloudSyncBadge('offline');
                return;
            }

            updateCloudSyncBadge('syncing');

            // Sub-documento exclusivo de este dispositivo.
            // Nunca compite con el documento de otro bartender.
            const dispositivoRef = _db
                .collection('inventarioApp')
                .doc(FIRESTORE_DOC_ID)
                .collection('conteoAreas')
                .doc(area)
                .collection('dispositivos')
                .doc(_deviceId);

            try {
                // FIX 1 CRÍTICO: Leer de myAuditoriaConteo (conteo propio del usuario)
                // y NO de auditoriaConteo (vista agregada del admin, calculada en memoria).
                // FASE 2B — AQUÍ SE DEJA isAdmin() A PROPÓSITO. Esta no es una
                // ruta de lectura sino de ESCRITURA: decide qué sube este
                // dispositivo a su propio documento. Cambiar el criterio no
                // aportaría privacidad (nadie lee datos ajenos aquí) y sí
                // alteraría qué se guarda para un supervisor con viewAll.
                const conteoFuente = isAdmin() ? auditoriaConteo : myAuditoriaConteo;
                const productosConDatos = products.filter(p =>
                    conteoFuente[p.id] && conteoFuente[p.id][area]
                );

                if (productosConDatos.length === 0) {
                    updateCloudSyncBadge('ok');
                    return;
                }

                const txTimestamp = Date.now();

                // Payload de ESTE dispositivo: valores locales absolutos.
                const payload = {
                    _deviceId:  _deviceId,
                    _lastWrite: txTimestamp,
                    _area:      area,
                    _userUid:   currentUserUid || 'anonymous',
                };

                productosConDatos.forEach(p => {
                    const localArea = conteoFuente[p.id][area];
                    payload[p.id] = {
                        enteras:   typeof localArea.enteras  === 'number'  ? localArea.enteras  : 0,
                        abiertas:  Array.isArray(localArea.abiertas)       ? localArea.abiertas : [],
                        _lastWrite: localArea._ts || txTimestamp, // BUG-3 FIX: timestamp por producto para last-write-wins correcto
                    };
                });

                // set() SIN merge: reemplaza SOLO el documento de este dispositivo.
                await dispositivoRef.set(payload);

                // Leer TODOS los dispositivos y calcular los totales agregados en memoria.
                await _cargarYAgeregarConteos(area);

                updateCloudSyncBadge('ok');
                showNotification('☁️ Conteo de ' + areasAuditoria[area] + ' guardado en la nube.');
                console.info('[MultiDisp] Área', area, 'sincronizada. deviceId:', _deviceId);

            } catch (err) {
                updateCloudSyncBadge('error');
                console.error('[MultiDisp] Error al guardar conteo:', err);
                showNotification('⚠️ Error al subir conteo a la nube — guardado localmente');
            }
        }

        /**
         * _cargarYAgeregarConteos(area)
         * ──────────────────────────────
         * Descarga los documentos de TODOS los dispositivos desde
         * conteoAreas/{area}/dispositivos y los fusiona en auditoriaConteo.
         * Estrategia: los valores del dispositivo más reciente (_lastWrite) ganan.
         * Se llama después de subir el propio conteo y al arranque de la app.
         *
         * @param {string} area - 'almacen' | 'barra1' | 'barra2'
         */
        async function _cargarYAgeregarConteos(area) {
            if (!_db || !navigator.onLine) return;
            // ── FASE 2B — CONTEO CIEGO ────────────────────────────────────
            // Esta función descarga el conteo de TODOS los dispositivos, es
            // decir el de otras personas. Hasta ahora se ejecutaba para
            // cualquier usuario: un bartender se bajaba el conteo de sus
            // compañeros al arranque y después de subir su área, y no lo
            // mostraba en ninguna parte — lo descargaba para nada.
            //
            // Se corta AQUÍ, en la consulta, no solo en la regla: si se
            // dejara correr, la regla nueva la rechazaría y el dispositivo
            // acumularía errores de permisos en cada arranque.
            if (!puedeVerConteosAjenos()) return;
            try {
                const dispositivosSnap = await _db
                    .collection('inventarioApp')
                    .doc(FIRESTORE_DOC_ID)
                    .collection('conteoAreas')
                    .doc(area)
                    .collection('dispositivos')
                    .get();

                if (dispositivosSnap.empty) return;

                // Para cada documento de dispositivo, mezclar sus productos
                // en auditoriaConteo sin borrar lo que ya hay de otros dispositivos.
                dispositivosSnap.docs.forEach(function(doc) {
                    const data = doc.data();
                    // Ignorar campos de metadatos (_deviceId, _lastWrite, _area)
                    Object.keys(data).forEach(function(key) {
                        if (key.startsWith('_')) return;
                        const devEntry = data[key];
                        if (!devEntry || typeof devEntry !== 'object') return;

                        if (!auditoriaConteo[key]) auditoriaConteo[key] = {};
                        if (!auditoriaConteo[key][area]) {
                            auditoriaConteo[key][area] = { enteras: 0, abiertas: [] };
                        }

                        // Actualizar solo si el dato del dispositivo es más reciente
                        const cloudTs  = devEntry._lastWrite || data._lastWrite || 0;
                        const localTs  = auditoriaConteo[key][area]._lastWrite || 0;
                        if (cloudTs >= localTs) {
                            if (typeof devEntry.enteras === 'number') {
                                auditoriaConteo[key][area].enteras = devEntry.enteras;
                            }
                            if (Array.isArray(devEntry.abiertas)) {
                                auditoriaConteo[key][area].abiertas = devEntry.abiertas;
                            }
                            if (devEntry.alerta_conflicto !== undefined) {
                                auditoriaConteo[key][area].alerta_conflicto = devEntry.alerta_conflicto;
                            }
                            if (devEntry.stock_abierto_alternativo !== undefined) {
                                auditoriaConteo[key][area].stock_abierto_alternativo = devEntry.stock_abierto_alternativo;
                            }
                            auditoriaConteo[key][area]._lastWrite = cloudTs;
                        }
                    });
                });

                console.info('[MultiDisp] Conteos del área ' + area + ' agregados desde ' + dispositivosSnap.size + ' dispositivo(s) ✓');
            } catch (err) {
                console.warn('[MultiDisp] Error al cargar conteos de área ' + area + ':', err);
            }
        }

        /**
         * resetConteoAtomicoEnFirestore()
         * ───────────────────────────────
         * Elimina los documentos de conteoAreas en Firestore al iniciar nueva auditoría.
         * Así los increment() del siguiente ciclo parten de cero.
         */
        async function resetConteoAtomicoEnFirestore() {
            // FIX-PROP-2 (CRÍTICO, mismo patrón que _adminIniciarSesionFirestore):
            // esta función se llama justo después, en la misma secuencia de
            // auditoriaResetear(). Si también traga sus errores, el admin ve
            // "✅" aunque las áreas legacy (conteoAreas/dispositivos,
            // conteoMultiUsuario) —de donde depende generarYPublicarReporte()—
            // queden con datos del ciclo anterior sin que nadie se entere.
            if (!_db) return;
            if (!navigator.onLine) {
                throw new Error('sin_conexion: no se puede resetear el conteo atómico offline');
            }
            const AREAS = AREAS_CONTEO;
            const batch = _db.batch();

            for (const area of AREAS) {
                const dispositivosRef = _db
                    .collection('inventarioApp')
                    .doc(FIRESTORE_DOC_ID)
                    .collection('conteoAreas')
                    .doc(area)
                    .collection('dispositivos');

                // Listar y borrar todos los documentos de dispositivos para esta área
                const snap = await dispositivosRef.get();
                snap.docs.forEach(doc => batch.delete(doc.ref));

                // También borrar el documento padre del área por compatibilidad
                batch.delete(_db
                    .collection('inventarioApp')
                    .doc(FIRESTORE_DOC_ID)
                    .collection('conteoAreas')
                    .doc(area)
                );
            }

            // FIX-03 (preservado): borrar también conteoMultiUsuario
            for (const area of AREAS) {
                batch.delete(_db
                    .collection('inventarioApp')
                    .doc(FIRESTORE_DOC_ID)
                    .collection('conteoMultiUsuario')
                    .doc(area)
                );
            }

            // BUG-11 FIX: borrar los documentos individuales de conteoMultiUsuario/{area}
            // (el borrado anterior solo borraba el doc padre, no sus contenidos).
            // Nota: Firestore NO borra subcolecciones automáticamente al borrar el padre.
            // Los datos de área en conteoMultiUsuario son documentos planos sin subcolección,
            // así que el borrado del doc es suficiente — verificado.
            await batch.commit();
            console.info('[MultiDisp] conteoAreas/dispositivos + conteoMultiUsuario eliminados ✓');
            // Sin try/catch — el error se propaga a auditoriaResetear().
        }

        // ══════════════════════════════════════════════════════════════════════
        //  MÓDULO: AUDITORÍA AISLADA POR USUARIO
        //  Firestore path: inventarioApp/{docId}/userAuditoria/{uid}
        // ══════════════════════════════════════════════════════════════════════

        // FIX BUG 2: Flag de sincronización pendiente para conteos de auditoría.
        // Si syncMyAuditoriaToFirestore falla, se marca true y se reintenta
        // automáticamente cuando el dispositivo recupere conexión.
        let _auditSyncPending = false;

        /** Guarda el conteo propio del usuario en Firestore (solo escribe su UID) */
        async function syncMyAuditoriaToFirestore() {
            if (!_db || !currentUserUid || !navigator.onLine) {
                // Offline: marcar pendiente para reintento al reconectar
                _auditSyncPending = true;
                return;
            }
            try {
                const ref = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                               .collection('userAuditoria').doc(currentUserUid);
                // FIX BUG 1 CRÍTICO: usar merge:true para NO borrar campos escritos
                // por otros (en especial los 'unlocks' que el admin escribe para
                // habilitar correcciones). merge:false sobreescribía el doc completo
                // y eliminaba los unlocks en cada guardado del bartender.
                // BUG-5 FIX: enriquecer cada entrada de conteo con _ts para
                // que _recalcAdminAggregatedConteo use el timestamp correcto por producto
                // (el campo _ts se escribe en saveInventarioModal, BUG-2 FIX).
                // Si un producto no tiene _ts (conteos viejos), usar updatedAt como fallback.
                const now = Date.now();
                const conteoConTs = {};
                Object.keys(myAuditoriaConteo).forEach(function(prodId) {
                    conteoConTs[prodId] = {};
                    Object.keys(myAuditoriaConteo[prodId] || {}).forEach(function(area) {
                        const src = myAuditoriaConteo[prodId][area];
                        conteoConTs[prodId][area] = Object.assign({}, src, {
                            _ts: src._ts || now
                        });
                    });
                });

                // FIX-SYNC-GUARD (BarInventory): si el conteo que estamos por
                // subir tiene muchas MENOS entradas que la última versión que sí
                // se confirmó sincronizada, es señal de que el estado local pudo
                // restaurarse incompleto (ver FIX-IDB-GUARD más arriba). No
                // bloqueamos la sincronización — podría ser una corrección
                // legítima del usuario — pero avisamos de inmediato para que se
                // note en el momento, en vez de descubrirlo después de que ya
                // se sobreescribió lo que había en la nube.
                const entradasActuales  = _contarEntradasConteo(conteoConTs);
                const ultimoConfirmado  = parseInt(localStorage.getItem('inventarioApp_lastSyncedConteoSize') || '0', 10);
                if (ultimoConfirmado > 0 && entradasActuales < ultimoConfirmado * 0.5) {
                    console.warn('[AuditUser] El conteo a sincronizar (' + entradasActuales +
                        ' entradas) es mucho menor que el último confirmado (' + ultimoConfirmado + ').');
                    showNotification('⚠️ Tu conteo bajó de ' + ultimoConfirmado + ' a ' + entradasActuales + ' productos contados — revisa antes de seguir');
                }

                await ref.set({
                    uid:        currentUserUid,
                    email:      (_auth && _auth.currentUser) ? _auth.currentUser.email : currentUserUid,
                    sessionId:  _auditoriaSessionId,
                    status:     myAuditoriaStatus,
                    // D — quién finalizó cada área y cuándo. Viaja con el
                    // conteo porque pertenece al mismo acto: cerrar el área.
                    finalizadas: (typeof myAuditoriaFinalizadas !== 'undefined')
                                 ? myAuditoriaFinalizadas : {},
                    conteo:     conteoConTs,   // BUG-5 FIX: conteo con _ts por producto
                    updatedAt:  now,
                    isAdmin:    isAdmin()
                }, { merge: true }); // merge:true → preserva 'unlocks' y otros campos del admin
                _auditSyncPending = false;
                try { localStorage.setItem('inventarioApp_lastSyncedConteoSize', String(entradasActuales)); } catch(_) {}
                console.info('[AuditUser] Mi conteo sincronizado ✓');
    } catch (err) {
        // FIX BUG 2: marcar pendiente para reintento automático al reconectar
        _auditSyncPending = true;
        // FIX-9: Persistir flag en LS inmediatamente por si el browser crashea
        try { localStorage.setItem('inventarioApp_auditSyncPending', '1'); } catch(_) {}
        console.warn('[AuditUser] Error sync propio — reintento al reconectar:', err);
        showNotification('⚠️ Conteo guardado localmente — subirá al reconectar');
    }
}

    /**
     * Escucha el doc propio del usuario en userAuditoria/{myUid}
         * para detectar desbloqueos otorgados por el admin en tiempo real.
         */

        /** Helper: reiniciar el conteo propio del usuario (FIX 9) */
