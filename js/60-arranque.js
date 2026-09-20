        function initializeApp() {
            // ── Inicializar identidad del dispositivo (multiusuario) ──────────
            initAuditUser();

            // ── Ejecutar migraciones de esquema si es necesario ───────────────
            _runMigrations();

            // ══════════════════════════════════════════════════════════════════
            // BUG-1 + BUG-2 FIX: RACE CONDITION EN ARRANQUE
            // ─────────────────────────────────────────────────────────────────
            // PROBLEMA ORIGINAL:
            //   _initIndexedDB().then(async () => { cargar IDB/LS }) es ASÍNCRONO.
            //   Pero el código de abajo (if products.length===0, switchTab, loadFromCloud)
            //   corría SÍNCRONO antes de que el .then() terminara.
            //
            //   Consecuencia 1: products.length SIEMPRE es 0 en el if-guard →
            //     los 14 productos demo se cargaban en CADA arranque, sobreescribiendo
            //     el catálogo real del usuario antes de que IDB/LS restaurara sus datos.
            //
            //   Consecuencia 2: switchTab() y loadFromCloud() renderizaban con
            //     datos vacíos (flash de contenido vacío), y loadFromCloud podía
            //     descargar datos de Firebase y aplicarlos ANTES de que IDB
            //     hubiera restaurado el estado local, creando conflictos espurios.
            //
            // SOLUCIÓN: Todo el código de inicialización post-carga va DENTRO
            //   del callback .then() para garantizar orden de ejecución correcto:
            //   IDB/LS se carga → luego UI → luego Firebase.
            // ══════════════════════════════════════════════════════════════════
            _initIndexedDB().then(async function() {
                // ── FASE 1: Intentar carga desde IDB (fuente primaria) ────────
                const idbData = await _idbLoadAll();
                if (idbData && Array.isArray(idbData.products) && idbData.products.length > 0) {
                    const lsTs  = parseInt(localStorage.getItem('inventarioApp_lastModified') || '0', 10);
                    const idbTs = idbData._savedAt || 0;

                    // FIX-IDB-GUARD (BarInventory): un timestamp de IDB más nuevo
                    // NO garantiza que su contenido esté más completo — ver el
                    // comentario en _idbSaveAll(). Como defensa adicional,
                    // comparamos cuántas entradas de conteo propio tiene cada
                    // fuente. localStorage se escribe de forma síncrona en cada
                    // guardado, así que nunca debería tener MENOS entradas que
                    // una versión "más nueva" salvo que IDB esté incompleto.
                    const idbConteoSize = _contarEntradasConteo(idbData.myAuditoriaConteo);
                    const lsConteoSize  = _contarEntradasConteo(_leerJsonLS('inventarioApp_myAuditoriaConteo'));
                    const idbLuceIncompleto = (idbTs >= lsTs) && (idbConteoSize < lsConteoSize);

                    if (idbTs >= lsTs && !idbLuceIncompleto) {
                        _applyIDBData(idbData);
                        console.info('[Init] Datos cargados desde IDB (primario). LS queda como backup.');
                    } else {
                        loadFromLocalStorage();
                        if (idbLuceIncompleto) {
                            console.warn('[Init] IDB parecía más reciente pero tenía menos conteo propio (' +
                                idbConteoSize + ' < ' + lsConteoSize + ' entradas) que LS — se prefirió LS para evitar pérdida de datos.');
                        } else {
                            console.info('[Init] LS más reciente que IDB. Cargando LS y sincronizando a IDB.');
                        }
                        _idbSaveAll();
                    }
                } else {
                    // ── FASE 2: IDB vacío → cargar desde LS (secundario) ─────
                    loadFromLocalStorage();
                    console.info('[Init] IDB vacío o sin datos. Cargando desde LS.');

                    // ── FASE 3: LS también vacío → intentar recuperación ──────
                    if (products.length === 0) {
                        (function checkSnapshot() {
                            try {
                                const raw = localStorage.getItem('inventarioApp_emergencySnapshot');
                                if (!raw) return;
                                const snap = JSON.parse(raw);
                                if (!snap || !snap._ts) return;
                                if (Date.now() - snap._ts > 7 * 24 * 60 * 60 * 1000) return;
                                const snapProducts = Array.isArray(snap.products) ? snap.products : [];
                                if (snapProducts.length > 0) {
                                    products          = snapProducts;
                                    inventarioConteo  = snap.inventarioConteo  || {};
                                    myAuditoriaConteo = snap.myAuditoriaConteo || {};
                                    auditoriaConteo   = snap.auditoriaConteo   || {};
                                    showNotification('🔄 Datos recuperados desde snapshot de emergencia (' +
                                        new Date(snap._ts).toLocaleString('es-MX') + ')');
                                    saveToLocalStorage();
                                }
                            } catch(_) {}
                        })();
                    }

                    // 3b: Firebase como último recurso
                    if (products.length === 0) {
                        setTimeout(async function() {
                            const recoveredFromCloud = await _tryRecoverFromFirebase();
                            if (recoveredFromCloud) {
                                syncStockByAreaFromConteo();
                                renderTab();
                            }
                        }, 2000);
                    }
                }

                syncStockByAreaFromConteo();
                setTimeout(function() { _checkDataIntegrity(); }, 1500);

                // ── FASE 0 — CATÁLOGO VACÍO: NO SEMBRAR NADA ─────────────────
                // Antes, si products.length === 0 tras cargar, la app insertaba
                // 14 productos de demostración (Vodka Premium, Ron Añejo,
                // Limones, Hielo…) y llamaba a saveToLocalStorage(), que dispara
                // syncToCloud(). Bastaba UNA de estas situaciones —primera
                // instalación sin red, fallo de lectura de la nube, IndexedDB
                // bloqueada en modo privado— para que 14 productos falsos
                // entraran al catálogo REAL del bar y se propagaran a todos los
                // demás dispositivos. No hacía falta que nadie estuviera
                // probando nada: podía ocurrir en operación normal.
                //
                // Un catálogo vacío es un ESTADO VÁLIDO, no un error que
                // rellenar. Aquí no se escribe absolutamente nada: ni a
                // localStorage, ni a IndexedDB, ni a Firestore. Solo se deja
                // constancia en la consola. La interfaz ya sabe representar una
                // lista vacía (renderInicioTab / renderProductosTab).
                if (products.length === 0) {
                    console.info('[Init] Catálogo vacío — no se siembra ningún dato. ' +
                                 'Si esto no es una instalación nueva, revisa la conexión ' +
                                 'o el estado de la carga desde la nube.');
                }

                // ── BUG-2 FIX: switchTab() DENTRO del .then() ────────────────
                // Antes corría con products=[] → UI vacía + re-render posterior con flash.
                // Ahora corre con los datos ya cargados → render correcto desde el primer frame.
                switchTab(activeTab);

                // Restaurar flag de sync pendiente
                try {
                    if (localStorage.getItem('inventarioApp_auditSyncPending') === '1') {
                        _auditSyncPending = true;
                        localStorage.removeItem('inventarioApp_auditSyncPending');
                        console.info('[AuditUser] Sync de auditoría pendiente detectado.');
                    }
                } catch(_) {}

                // D — Conteos que quedaron sin confirmar contra el servidor:
                // sin señal, por batería, o porque la app se cerró antes de
                // que el envío saliera. El valor local ya es correcto (viene
                // de inventarioConteo, restaurado arriba); esto solo recupera
                // la lista y reintenta la confirmación.
                //
                // Antes esto solo cubría el caso de cerrar la pestaña, y
                // borraba la lista ANTES de reintentar: si el reintento
                // fallaba, la anotación ya no existía y nadie volvía a
                // intentarlo nunca. Ahora cada clave sale de la lista
                // únicamente cuando el servidor confirma.
                try {
                    const pendientes = _outboxCargar();
                    const cuantos = Object.keys(pendientes).length;
                    if (cuantos > 0) {
                        console.info('[ConteoProducto]', cuantos,
                            'conteo(s) sin confirmar recuperados al arrancar.');
                        if (typeof updateCloudSyncBadge === 'function') {
                            updateCloudSyncBadge('pending');
                        }
                    }
                } catch(_) {}

                if (inventarioCicloEstado === 'EN_CAPTURA') {
                    console.info('[Ciclo] Ciclo EN_CAPTURA restaurado al arranque.');
                }

                // ── BUG-2 FIX: Firebase DESPUÉS de cargar datos locales ───────
                // Antes: loadFromCloud() corría sin datos locales → conflictos espurios.
                // Ahora: Firebase se consulta después de tener el estado local completo,
                //   así _applyCloudData puede comparar correctamente local vs nube.
                if (_db) {
                    // M2a: esperar a que Auth resuelva. Antes estas tres llamadas
                    // salian con request.auth == null y las tres eran rechazadas.
                    _esperarSesion().then(function(_usr) {
                        if (!_usr) {
                            console.info('[Init] Sin sesion — no se consulta la nube.');
                            return;
                        }
                        loadFromCloud()
                            .then(function() {
                                // D — el drenaje va DESPUÉS de loadFromCloud,
                                // nunca antes: así compara contra la versión
                                // recién bajada y no contra una de ayer.
                                return drenarConteosPendientes();
                            })
                            .catch(err => console.warn('[Firebase] loadFromCloud silenciado:', err));
                        loadConflictosDesdeFirestore().catch(() => {});
                        loadConteoPorUsuarioFromFirestore().catch(err =>
                            console.warn('[MultiUser] loadConteoPorUsuarioFromFirestore silenciado:', err)
                        );
                        // FASE 4A — compras de la semana en curso y la anterior.
                        // Acotada a propósito (nunca "todas las compras"); ver
                        // cargarComprasIniciales() en js/88-compras.js.
                        if (typeof cargarComprasIniciales === 'function') {
                            cargarComprasIniciales().catch(err =>
                                console.warn('[Compras] cargarComprasIniciales silenciado:', err)
                            );
                        }
                    });
                }
            });

window.addEventListener('beforeunload', function() {
        saveToLocalStorage(); // LS síncrono: siempre se completa

        // FIX-4: Escritura síncrona a IDB para datos críticos.
        // _idbSaveAll() es async y se pierde al cerrar la página.
        if (_idb) {
            try {
                var tx = _idb.transaction('criticalData', 'readwrite');
                var store = tx.objectStore('criticalData');
                store.put(inventarioConteo, 'inventarioConteo');
                store.put(myAuditoriaConteo, 'myAuditoriaConteo');
                store.put(products, 'products');
                store.put(Date.now(), '_savedAt');
            } catch(_) {}
        }

        if (saveInventarioModal._auditSyncTimer) {
            clearTimeout(saveInventarioModal._auditSyncTimer);
            saveInventarioModal._auditSyncTimer = null;
            _auditSyncPending = true;
            try { localStorage.setItem('inventarioApp_auditSyncPending', '1'); } catch(_) {}
        }

        // D — cualquier conteo cuyo debounce de 800 ms no alcanzó a
        // dispararse queda anotado como pendiente. El dato ya está seguro en
        // localStorage/IndexedDB (líneas de arriba); esto solo asegura que la
        // próxima carga sepa que faltó confirmar contra el servidor.
        //
        // Ahora se anota en el mismo registro que usa todo lo demás, en vez
        // de en una clave aparte que solo se leía al arrancar.
        var clavesPendientes = Object.keys(_conteoProductoSyncTimers || {});
        if (clavesPendientes.length > 0) {
            clavesPendientes.forEach(function(clave) {
                clearTimeout(_conteoProductoSyncTimers[clave]);
                var corte = clave.indexOf('|');
                if (corte > 0) {
                    try { _outboxAnotar(clave.slice(0, corte), clave.slice(corte + 1)); } catch(_) {}
                }
            });
        }
    });
            window.addEventListener('online',  updateNetworkStatus);
            window.addEventListener('offline', updateNetworkStatus);
            updateNetworkStatus();

            // ── Sync periódico de recuperación: cada 3 min, solo si hay pendientes ──
            // ═══ FIX #6a: Guardar referencia para cleanup en logout ═══
            window._syncPeriodicInterval = setInterval(() => {
                if (!navigator.onLine || !_db) return;
                if (!_syncInProgress && _cloudSyncPending) {
                    console.info('[Firebase] Sync periódico — había cambios pendientes.');
                    syncToCloud();
                }
                // D — red de seguridad: si un conteo quedó sin confirmar y no
                // hubo ni reconexión ni reinicio (por ejemplo, un fallo suelto
                // del servidor con la señal intacta), esto lo recoge igual.
                if (_outboxPendientes().length > 0) {
                    drenarConteosPendientes().catch(function(e) {
                        console.warn('[ConteoProducto] Drenaje periódico silenciado:', e);
                    });
                }
            }, 3 * 60 * 1000);
        }
