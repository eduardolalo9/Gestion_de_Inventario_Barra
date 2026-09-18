        async function loadConteoPorUsuarioFromFirestore() {
            if (!_db || !navigator.onLine || !_haySesionFirebase()) return; // M2a
            // ── FASE 2B — CONTEO CIEGO ────────────────────────────────────
            // conteoMultiUsuario/{area} es UN SOLO documento que contiene
            // dentro el bloque de cada persona, con su nombre y sus
            // cantidades. Firestore no permite leer un documento a medias:
            // o se lee entero o nada. Por eso esta ruta no admite término
            // medio y queda reservada a quien puede ver conteos ajenos.
            if (!puedeVerConteosAjenos()) return;
            try {
                let changed = false;
                const AUDIT_AREAS = AREAS_CONTEO; // FIX-05: array declarado una sola vez
                for (let areaI = 0; areaI < AUDIT_AREAS.length; areaI++) {
                    const area = AUDIT_AREAS[areaI];
                    const snap = await _db
                        .collection('inventarioApp')
                        .doc(FIRESTORE_DOC_ID)
                        .collection('conteoMultiUsuario')
                        .doc(area)
                        .get();
                    if (!snap.exists) continue;
                    var areaData = snap.data();

                    Object.keys(areaData).forEach(function(safeId) {
                        const ud = areaData[safeId]; // FIX-07
                        if (!ud || typeof ud !== 'object' || !ud.userId || !ud.productos) return;

                        Object.keys(ud.productos).forEach(function(prodId) {
                            if (!auditoriaConteoPorUsuario[prodId])
                                auditoriaConteoPorUsuario[prodId] = {};
                            if (!auditoriaConteoPorUsuario[prodId][area])
                                auditoriaConteoPorUsuario[prodId][area] = {};

                            const existing = auditoriaConteoPorUsuario[prodId][area][ud.userId]; // FIX-07
                            const cloudTs  = ud.productos[prodId].ts || ud.ts || 0;
                            const localTs  = existing ? (existing.ts || 0) : 0;

                            // Gana el registro más reciente (último-gana por usuario)
                            if (!existing || localTs < cloudTs) {
                                auditoriaConteoPorUsuario[prodId][area][ud.userId] = Object.assign(
                                    {}, ud.productos[prodId],
                                    { userId: ud.userId, userName: ud.userName || ud.userId, ts: cloudTs }
                                );
                                changed = true;
                            }
                        });
                    });
                }

                if (changed) {
                    try {
                        localStorage.setItem(
                            'inventarioApp_auditoriaConteoPorUsuario',
                            JSON.stringify(auditoriaConteoPorUsuario)
                        );
                    } catch (_) {}
                    renderTab();
                    console.info('[MultiUser] Conteos legacy cargados ✓ (conteoMultiUsuario → auditoriaConteoPorUsuario).');
                    // NOTA: El sistema principal de conteo usa myAuditoriaConteo + userAuditoria/{uid}.
                    // conteoMultiUsuario es el sistema legacy que solo queda activo en syncConteoPorUsuarioToFirestore
                    // para compatibilidad con datos anteriores. BUG-1 FIX lo alineó para leer de myAuditoriaConteo.
                }
            } catch (err) {
                console.warn('[MultiUser] Error al cargar conteos desde Firestore:', err);
            }
        }

        // ==================== PERSISTENCIA ====================
        // FIX 2 — localStorage: guardado granular con control de cuota
        const LS_WARN_BYTES = 4 * 1024 * 1024; // advertir al superar 4 MB de los ~5 MB totales
        let _lsQuotaWarned = false;

        // ══════════════════════════════════════════════════════════════════════
        //  VERSIONING — Control de versión de la app y la estructura de datos
        // ══════════════════════════════════════════════════════════════════════
        /**
         * APP_VERSION : versión de la aplicación (semver). Se muestra en el pie y
         *               en los respaldos exportados. Incrementar en cada deploy.
         * DB_VERSION  : número de versión del esquema de localStorage/IndexedDB.
         *               Incrementar solo cuando cambia la estructura de los datos
         *               (no en cambios visuales). Se usa para ejecutar migraciones.
         */
        const APP_VERSION = '1.1.0';
        const DB_VERSION  = 2;     // v1: esquema original  v2: IDB + sync queue + ciclo

        /**
         * _runMigrations()
         * ─────────────────
         * Detecta si la versión guardada en localStorage es menor a DB_VERSION
         * y ejecuta las migraciones necesarias EN ORDEN, sin perder datos.
         * Las migraciones son idempotentes: se pueden correr varias veces sin daño.
         */
        function _runMigrations() {
            const storedVersion = parseInt(localStorage.getItem('inventarioApp_dbVersion') || '1', 10);
            if (storedVersion >= DB_VERSION) return; // ya en la versión más reciente

            console.info('[Migration] Esquema v' + storedVersion + ' → v' + DB_VERSION + '. Ejecutando migraciones…');

            // ── Migración v1 → v2 ──────────────────────────────────────────────
            // Cambios: inventarioCicloEstado, syncQueue, IDB como capa principal.
            // En v1, inventarioConteo se guardaba directamente en LS. Lo preservamos.
            if (storedVersion < 2) {
                try {
                    if (!localStorage.getItem('inventarioApp_cicloEstado')) {
                        localStorage.setItem('inventarioApp_cicloEstado', 'ABIERTO');
                    }
                    if (!localStorage.getItem('inventarioApp_syncQueue')) {
                        localStorage.setItem('inventarioApp_syncQueue', '[]');
                    }
                    console.info('[Migration] v1→v2: cicloEstado y syncQueue inicializados ✓');
                } catch (e) {
                    console.warn('[Migration] v1→v2 parcialmente fallida:', e);
                }
            }

            // CORRECCIÓN 9 — Registro de versión y log de migración
            try {
                const migrLog = JSON.parse(localStorage.getItem('inventarioApp_migrLog') || '[]');
                migrLog.push({
                    ts:         Date.now(),
                    from:       storedVersion,
                    to:         DB_VERSION,
                    appVersion: APP_VERSION
                });
                localStorage.setItem('inventarioApp_migrLog', JSON.stringify(migrLog.slice(-20)));
                localStorage.setItem('inventarioApp_dbVersion', String(DB_VERSION));
                console.info('[Migration] Completada → v' + DB_VERSION + ' ✓');
            } catch(_) {}
        }

        // ══════════════════════════════════════════════════════════════════════
        //  CORRECCIÓN 9 — Integridad de datos + compatibilidad futura
        // ══════════════════════════════════════════════════════════════════════

        /**
         * _checkDataIntegrity()
         * Verifica y repara la integridad de los datos locales.
         * Seguro: solo repara valores inválidos, nunca borra datos correctos.
         * Ejecutar desde consola: _checkDataIntegrity()
         */
        function _checkDataIntegrity() {
            const problemas = [];
            const reparados = [];

            // 1) Productos sin ID o sin nombre
            const sinId = products.filter(function(p) { return !p || !p.id || !p.name; });
            if (sinId.length > 0) {
                problemas.push('Productos inválidos (sin ID o nombre): ' + sinId.length);
                products = products.filter(function(p) { return p && p.id && p.name; });
                reparados.push('Eliminados ' + sinId.length + ' productos inválidos');
            }

            // 2) IDs duplicados — conservar la última versión
            const seenIds = new Set();
            const dupsRemoved = [];
            products = products.slice().reverse().filter(function(p) {
                if (seenIds.has(p.id)) { dupsRemoved.push(p.id); return false; }
                seenIds.add(p.id);
                return true;
            }).reverse();
            if (dupsRemoved.length > 0) {
                problemas.push('IDs duplicados: ' + dupsRemoved.join(', '));
                reparados.push('Deduplicados: ' + dupsRemoved.join(', '));
            }

            // 3) Valores negativos en inventarioConteo
            let negativos = 0;
            Object.keys(inventarioConteo).forEach(function(pid) {
                Object.keys(inventarioConteo[pid] || {}).forEach(function(area) {
                    const d = inventarioConteo[pid][area];
                    if (d && typeof d.enteras === 'number' && d.enteras < 0) {
                        inventarioConteo[pid][area].enteras = 0;
                        negativos++;
                    }
                });
            });
            if (negativos > 0) {
                reparados.push('Corregidos ' + negativos + ' valores negativos');
            }

            // 4) Conteos huérfanos (sin producto)
            const prodIds = new Set(products.map(function(p) { return p.id; }));
            const huerfanos = Object.keys(inventarioConteo).filter(function(id) {
                return !prodIds.has(id);
            });
            if (huerfanos.length > 0) {
                // Informar pero NO eliminar — pueden ser temporales durante sync
                problemas.push('Conteos sin producto asociado: ' + huerfanos.length +
                    ' (pueden ser temporales durante sincronización)');
            }

            // 5) Estado de ciclo inválido
            if (!['ABIERTO','EN_CAPTURA','FINALIZADO','CERRADO'].includes(inventarioCicloEstado)) {
                problemas.push('Estado de ciclo inválido: "' + inventarioCicloEstado + '"');
                inventarioCicloEstado = 'ABIERTO';
                reparados.push('Ciclo reseteado a ABIERTO');
            }

            // Guardar si hubo reparaciones
            if (reparados.length > 0) {
                _registrarEnSyncQueue({
                    tipo:     'integridad_datos',
                    detalle:  reparados.join(' | '),
                    motivo:   'Verificación automática de integridad'
                });
                saveToLocalStorage();
            }

            const reporte = {
                fecha:      new Date().toLocaleString('es-MX'),
                appVersion: APP_VERSION,
                dbVersion:  DB_VERSION,
                productos:  products.length,
                problemas:  problemas,
                reparados:  reparados,
                resultado:  problemas.length === 0 ? '✅ Datos íntegros' : '⚠️ ' + problemas.length + ' problema(s)'
            };

            console.group('[Integridad] Verificación de datos — ' + reporte.resultado);
            console.table([{
                'App':       APP_VERSION,
                'DB':        'v' + DB_VERSION,
                'Productos': products.length,
                'Problemas': problemas.length,
                'Reparados': reparados.length
            }]);
            if (problemas.length) console.warn('Problemas:', problemas);
            if (reparados.length) console.info('Reparado:',  reparados);
            console.groupEnd();
            return reporte;
        }
        window._checkDataIntegrity = _checkDataIntegrity;

        // ══════════════════════════════════════════════════════════════════════
        //  CICLO DE INVENTARIO — Estados del ciclo de conteo físico
        // ══════════════════════════════════════════════════════════════════════
        /**
         * Estados del ciclo:
         *   ABIERTO     — En operación normal, sin auditoría activa.
         *   EN_CAPTURA  — Auditoría en progreso (bartenders contando).
         *   FINALIZADO  — Todos los áreas completadas; admin puede revisar.
         *   CERRADO     — Ciclo sellado. Ningún usuario puede modificar datos.
         *                 Solo el admin puede reabrir → ABIERTO.
         *
         * Transiciones válidas:
         *   ABIERTO → EN_CAPTURA  (admin inicia auditoría)
         *   EN_CAPTURA → FINALIZADO (todas las áreas completadas)
         *   FINALIZADO → CERRADO  (admin cierra el ciclo)
         *   CERRADO → ABIERTO     (admin reabre → nuevo ciclo)
         */
        let inventarioCicloEstado = 'ABIERTO'; // 'ABIERTO'|'EN_CAPTURA'|'FINALIZADO'|'CERRADO'
        let inventarioCicloInfo = {
            estado:      'ABIERTO',
            abiertoPor:  null,
            abiertoTs:   null,
            capturaTs:   null,
            finalizadoTs: null,
            cerradoPor:  null,
            cerradoTs:   null,
            version:     1       // incrementa con cada ciclo cerrado
        };

        /**
         * isCicloBloqueado()
         * Retorna true si el ciclo está CERRADO → bloquea escrituras de conteo.
         */
        function isCicloBloqueado() {
            return inventarioCicloEstado === 'CERRADO';
        }

        /**
         * setCicloEstado(nuevoEstado)
         * Transiciona el ciclo y guarda en localStorage.
         * Solo el admin puede cerrar/reabrir; bartenders no llaman esta función.
         */
        function setCicloEstado(nuevoEstado) {
            const ESTADOS_VALIDOS = ['ABIERTO', 'EN_CAPTURA', 'FINALIZADO', 'CERRADO'];
            if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
                console.warn('[Ciclo] Estado inválido:', nuevoEstado);
                return;
            }
            const ts = Date.now();
            inventarioCicloEstado = nuevoEstado;
            inventarioCicloInfo.estado = nuevoEstado;

            if (nuevoEstado === 'EN_CAPTURA') {
                inventarioCicloInfo.capturaTs = ts;
            } else if (nuevoEstado === 'FINALIZADO') {
                inventarioCicloInfo.finalizadoTs = ts;
            } else if (nuevoEstado === 'CERRADO') {
                inventarioCicloInfo.cerradoPor = currentUserUid || 'admin';
                inventarioCicloInfo.cerradoTs  = ts;
                // Crear respaldo automático al cerrar ciclo
                _crearBackupNombrado('ciclo_cerrado_' + new Date(ts).toISOString().split('T')[0]);
            } else if (nuevoEstado === 'ABIERTO') {
                // Nuevo ciclo: incrementar versión
                inventarioCicloInfo.version = (inventarioCicloInfo.version || 1) + 1;
                inventarioCicloInfo.abiertoPor = currentUserUid || 'admin';
                inventarioCicloInfo.abiertoTs  = ts;
                inventarioCicloInfo.cerradoPor = null;
                inventarioCicloInfo.cerradoTs  = null;
                inventarioCicloInfo.finalizadoTs = null;
                inventarioCicloInfo.capturaTs  = null;
            }

            try {
                localStorage.setItem('inventarioApp_cicloEstado', nuevoEstado);
                localStorage.setItem('inventarioApp_cicloInfo',   JSON.stringify(inventarioCicloInfo));
            } catch(_) {}

            // Registrar en auditoría
            _registrarEnSyncQueue({
                tipo:     'ciclo_estado',
                detalle:  nuevoEstado,
                usuario:  (auditCurrentUser ? auditCurrentUser.userName : null) || currentUserUid || 'admin',
                uid:      currentUserUid || null
            });

            showNotification('📋 Ciclo de inventario: ' + nuevoEstado);
            renderTab();
        }

        // ══════════════════════════════════════════════════════════════════════
        //  SISTEMA DE RESPALDOS NOMBRADOS — Hasta 10 respaldos rotativos
        // ══════════════════════════════════════════════════════════════════════
        const MAX_BACKUPS = 10;

        /**
         * _crearBackupNombrado(etiqueta)
         * Crea un snapshot nombrado de los datos críticos.
         * Los respaldos rotan: si hay más de MAX_BACKUPS, el más viejo se elimina.
         * @param {string} etiqueta — nombre descriptivo (ej. 'antes_importacion')
         */
        function _crearBackupNombrado(etiqueta) {
            try {
                const key = 'inventarioApp_backup_' + (etiqueta || Date.now());
                const snapshot = {
                    etiqueta:         etiqueta || 'manual',
                    ts:               Date.now(),
                    appVersion:       APP_VERSION,
                    dbVersion:        DB_VERSION,
                    cicloEstado:      inventarioCicloEstado,
                    products:         products,
                    inventarioConteo: inventarioConteo,
                    myAuditoriaConteo:myAuditoriaConteo,
                    auditoriaConteo:  auditoriaConteo,
                    auditoriaStatus:  auditoriaStatus
                };
                localStorage.setItem(key, JSON.stringify(snapshot));

                // Rotar: mantener solo los últimos MAX_BACKUPS
                const allKeys = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('inventarioApp_backup_')) allKeys.push(k);
                }
                if (allKeys.length > MAX_BACKUPS) {
                    // Ordenar por timestamp de la key (el más viejo primero)
                    allKeys.sort();
                    for (let i = 0; i < allKeys.length - MAX_BACKUPS; i++) {
                        localStorage.removeItem(allKeys[i]);
                    }
                }
                console.info('[Backup] Respaldo creado:', key, '(' + allKeys.length + ' total)');
                return key;
            } catch (e) {
                console.warn('[Backup] No se pudo crear respaldo:', e);
                return null;
            }
        }

        /**
         * listarBackups()
         * Retorna array de objetos { key, etiqueta, ts, fecha } ordenados por fecha desc.
         */
        function listarBackups() {
            const backups = [];
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (!k || !k.startsWith('inventarioApp_backup_')) continue;
                    try {
                        const raw = localStorage.getItem(k);
                        const data = JSON.parse(raw);
                        backups.push({
                            key:     k,
                            etiqueta: data.etiqueta || k,
                            ts:      data.ts || 0,
                            fecha:   data.ts ? new Date(data.ts).toLocaleString('es-MX') : '—',
                            productos: Array.isArray(data.products) ? data.products.length : 0
                        });
                    } catch(_) {}
                }
            } catch(_) {}
            return backups.sort(function(a,b) { return b.ts - a.ts; });
        }

        /**
         * restaurarBackup(key)
         * Restaura los datos críticos desde un respaldo nombrado.
         * Solo admin puede llamar esta función.
         */
        function restaurarBackup(key) {
            // FASE 2A — settings.update no es delegable fuera de administración
            // (ver PERMISOS_METADATOS): restaurar un respaldo sobreescribe el
            // estado completo del dispositivo.
            if (!hasPermission('settings.update')) { showNotification('⚠️ No tienes permiso para restaurar respaldos'); return; }
            try {
                const raw = localStorage.getItem(key);
                if (!raw) { showNotification('❌ Respaldo no encontrado'); return; }
                const data = JSON.parse(raw);
                showConfirm(
                    '¿Restaurar el respaldo "' + (data.etiqueta || key) + '" del ' + (data.ts ? new Date(data.ts).toLocaleString('es-MX') : '?') + '?\n\n' +
                    'Se restaurarán ' + (Array.isArray(data.products) ? data.products.length : '?') + ' productos.\n' +
                    'El estado actual se guardará como respaldo antes de restaurar.',
                    function() {
                        // Crear backup del estado actual antes de sobreescribir
                        _crearBackupNombrado('pre_restauracion_' + Date.now());
                        if (Array.isArray(data.products))         products          = data.products;
                        if (data.inventarioConteo)                inventarioConteo  = data.inventarioConteo;
                        if (data.myAuditoriaConteo)               myAuditoriaConteo = data.myAuditoriaConteo;
                        if (data.auditoriaConteo)                 auditoriaConteo   = data.auditoriaConteo;
                        if (data.auditoriaStatus)                 auditoriaStatus   = data.auditoriaStatus;
                        saveToLocalStorage();
                        renderTab();
                        showNotification('✅ Respaldo restaurado: ' + (data.etiqueta || key));
                        _registrarEnSyncQueue({ tipo: 'restauracion_backup', detalle: key, uid: currentUserUid || null });
                    }
                );
            } catch(e) {
                showNotification('❌ Error al restaurar respaldo: ' + e.message);
            }
        }
        window.listarBackups  = listarBackups;
        window.restaurarBackup = restaurarBackup;

        // ══════════════════════════════════════════════════════════════════════
        //  COLA DE SINCRONIZACIÓN — Registro de cambios con ID único
        // ══════════════════════════════════════════════════════════════════════
        /**
         * Cada cambio al inventario genera un evento en la cola:
         * {
         *   id:          'chg_1718000000_abc1'      — ID único global
         *   ts:          1718000000000              — Unix ms
         *   tipo:        'inventario'|'auditoria'|'producto'|'ciclo_estado'|...
         *   prodId:      'PRD-001'
         *   prodName:    'Tequila Reposado'
         *   area:        'almacen'
         *   valorAntes:  10
         *   valorDespues:8
         *   motivo:      'Reconteo'                — capturado en el modal
         *   usuario:     'Carlos'
         *   uid:         'firebase-uid'
         *   deviceId:    'dev-xxx'
         *   estado:      'pendiente'|'sincronizado'|'error'
         * }
         *
         * La cola persiste en localStorage['inventarioApp_syncQueue'].
         * Máximo 1000 entradas (rota automáticamente).
         * Se sincroniza a Firestore en la colección 'cambios/{FIRESTORE_DOC_ID}/eventos'.
         */
        const SYNC_QUEUE_MAX = 1000;
        let _syncQueue = []; // cargado en loadFromLocalStorage

        // ═════════════════════════════════════════════════════════════════
        // FIX-CONCURRENCIA (BarInventory)
        // products/orders/inventories se escribían como array completo en
        // cada sync (ver syncToCloud) y se aplicaban igual desde la nube
        // (ver _applyCloudData) — a diferencia de inventarioConteo, que ya
        // está protegido por área. Si dos dispositivos agregaban un producto
        // o creaban un pedido casi al mismo tiempo, el que sincronizaba
        // último borraba por completo lo que había agregado el otro.
        //
        // SOLUCIÓN: antes de escribir, fusionar por id con la versión más
        // reciente de la nube (gana lo local en conflicto de mismo id, se
        // conserva lo que solo existe en la nube). Los "tombstones" evitan
        // que un elemento recién borrado en este dispositivo "resucite" si
        // la nube todavía no se entera del borrado.
        // ═════════════════════════════════════════════════════════════════
        let _deletedProductIds    = [];
        let _deletedOrderIds      = [];
        let _deletedInventoryIds  = [];
        const _TOMBSTONE_MAX = 300;

        // ══════════════════════════════════════════════════════════════════════
        //  D · DEFECTO CRÍTICO — "ELIMINAR TODO EL CATÁLOGO" NO BORRABA TODO
        //  ────────────────────────────────────────────────────────────────────
        //  Las lápidas de arriba están limitadas a 300 (_TOMBSTONE_MAX), y con
        //  razón: son una lista en localStorage y no puede crecer sin freno.
        //  Pero el catálogo del bar tiene 424 productos. Al borrarlos todos se
        //  generaban 424 lápidas y el recorte se quedaba con las ÚLTIMAS 300:
        //  las 124 primeras se caían de la lista.
        //
        //  Novecientos milisegundos después, la sincronización fusionaba el
        //  catálogo local (vacío) con el de la nube (424) filtrando por
        //  lápidas. Los 124 sin lápida no se filtraban y volvían a escribirse.
        //  El administrador leía "Todos los productos han sido eliminados" y
        //  el catálogo reaparecía con 124 productos.
        //
        //  Una lista de identificadores es la herramienta equivocada para
        //  "bórralo todo": no escala y por eso tiene tope. Lo correcto es una
        //  marca de purga — una fecha que dice "el catálogo se vació aquí".
        //  Ocupa un número, no crece nunca, y cubre cualquier tamaño de
        //  catálogo. Todo lo de la nube anterior a esa fecha se descarta
        //  entero, sin necesitar una lápida por producto.
        //
        //  Las lápidas siguen intactas para el caso normal: borrar un producto
        //  suelto, donde sí son la herramienta adecuada.
        // ══════════════════════════════════════════════════════════════════════
        let _catalogoPurgadoEn = 0;

        function _marcarCatalogoPurgado(ts) {
            _catalogoPurgadoEn = ts || Date.now();
            try {
                localStorage.setItem('inventarioApp_catalogoPurgadoEn', String(_catalogoPurgadoEn));
            } catch(_) {}
            return _catalogoPurgadoEn;
        }

        /**
         * _purgaDeCatalogoVigente(datosNube)
         * ──────────────────────────────────
         * ¿Este dispositivo tiene una purga que la nube todavía no refleja?
         * Si la respuesta es sí, el catálogo de la nube es anterior al vaciado
         * y no debe fusionarse: sería justamente la resurrección que se quiere
         * evitar.
         */
        function _purgaDeCatalogoVigente(datosNube) {
            if (!_catalogoPurgadoEn) return false;
            const purgaNube = (datosNube && datosNube._catalogoPurgadoEn) || 0;
            return _catalogoPurgadoEn > purgaNube;
        }

        function _marcarComoBorrado(listName, id) {
            if (!id) return;
            const list = ({
                producto:   _deletedProductIds,
                pedido:     _deletedOrderIds,
                inventario: _deletedInventoryIds
            })[listName];
            if (!list) return;
            if (!list.includes(id)) list.push(id);
            const trimmed = list.length > _TOMBSTONE_MAX ? list.slice(-_TOMBSTONE_MAX) : list;
            if (listName === 'producto')   _deletedProductIds   = trimmed;
            if (listName === 'pedido')     _deletedOrderIds     = trimmed;
            if (listName === 'inventario') _deletedInventoryIds = trimmed;
            try {
                localStorage.setItem('inventarioApp_deletedProductIds',   JSON.stringify(_deletedProductIds));
                localStorage.setItem('inventarioApp_deletedOrderIds',     JSON.stringify(_deletedOrderIds));
                localStorage.setItem('inventarioApp_deletedInventoryIds', JSON.stringify(_deletedInventoryIds));
            } catch(_) {}
        }

        /**
         * _mergeArrayByIdPreferLocal(localArr, cloudArr, deletedIds)
         * Fusiona dos arrays de objetos {id,...} sin perder altas concurrentes:
         *   - Id en ambos          → gana la versión LOCAL (la que se acaba de tocar aquí).
         *   - Id solo en la nube   → se conserva, salvo que esté en deletedIds (tombstone).
         *   - Id solo en local     → se conserva (es lo que este dispositivo acaba de crear).
         */
        function _mergeArrayByIdPreferLocal(localArr, cloudArr, deletedIds) {
            localArr  = Array.isArray(localArr) ? localArr : [];
            cloudArr  = Array.isArray(cloudArr) ? cloudArr : [];
            const deletedSet = new Set(Array.isArray(deletedIds) ? deletedIds : []);
            const localIds   = new Set(localArr.filter(function(x){return x && x.id;}).map(function(x){return x.id;}));
            const merged = localArr.slice();
            cloudArr.forEach(function(item) {
                if (!item || !item.id) return;
                if (deletedSet.has(item.id)) return;   // tombstone: no resucitar
                if (localIds.has(item.id)) return;      // ya presente localmente (gana local)
                merged.push(item);                      // solo existe en la nube → conservar
            });
            return merged;
        }

        /**
         * _mergeArrayByIdPreferCloud(localArr, cloudArr)
         * Contraparte de _mergeArrayByIdPreferLocal, para el sentido de DESCARGA
         * (onSnapshot → _applyCloudData). Aquí la nube debe ganar en conflictos
         * de mismo id (puede traer una EDICIÓN hecha por otro dispositivo, no
         * solo altas), pero se conservan los ids que solo existen localmente
         * (alta muy reciente de este dispositivo que aún no llegó a la nube).
         * No necesita tombstones: si este dispositivo borró algo, ya no está
         * en localArr, así que no hay nada que "resucitar" desde acá.
         */
        function _mergeArrayByIdPreferCloud(localArr, cloudArr) {
            localArr = Array.isArray(localArr) ? localArr : [];
            cloudArr = Array.isArray(cloudArr) ? cloudArr : [];
            const cloudIds = new Set(cloudArr.filter(function(x){return x && x.id;}).map(function(x){return x.id;}));
            const merged = cloudArr.slice();
            localArr.forEach(function(item) {
                if (!item || !item.id) return;
                if (cloudIds.has(item.id)) return; // la nube ya tiene este id → prevalece la nube
                merged.push(item);                  // solo existe localmente (alta aún no sincronizada)
            });
            return merged;
        }

        let _anomalyWarningPending = null; // CORRECCIÓN 8: advertencia de cambio anómalo pendiente

        // ══════════════════════════════════════════════════════════════════════
        //  FASE 0 — TIPOS DE EVENTO QUE VAN AL HISTORIAL PERMANENTE
        //  ────────────────────────────────────────────────────────────────────
        //  Lista obtenida enumerando los 'tipo:' que _registrarEnSyncQueue
        //  recibe realmente en todo el archivo. Antes solo se replicaba
        //  'inventario', así que las acciones más sensibles del sistema no
        //  quedaban registradas en ninguna parte consultable.
        //
        //  Al agregar un evento nuevo con _registrarEnSyncQueue, añade aquí su
        //  tipo si debe quedar en el historial permanente.
        // ══════════════════════════════════════════════════════════════════════
        const TIPOS_AUDITABLES = [
            'inventario',                 // conteo de un producto en un área
            'nuevo_producto',             // alta de catálogo
            'edicion_producto',           // modificación de catálogo
            'eliminacion_producto',       // baja de un producto
            'eliminacion_catalogo',       // borrado masivo del catálogo
            'importacion_excel',          // importación de productos
            'cierre_inventario_fisico',   // cierre de un Inventario Físico
            'reapertura_almacen',         // reapertura de un área a un usuario
            'ciclo_estado',               // cambio de estado del ciclo
            'restauracion_backup',        // restauración de un respaldo
            'reset_auditoria',            // inicio de una nueva sesión de conteo
            // FASE 2 — la auditoría de cambios de permisos NO estrena una
            // tubería propia: reutiliza esta, que ya es append-only y que las
            // reglas hacen imborrable (historialCambios: allow update, delete:
            // if false). Un tipo nuevo aquí basta para que el evento viaje a
            // Firestore por el mismo camino que todo lo demás.
            'permisos',                   // cambio de rol/permisos/áreas de un usuario
            'candado_local'               // desbloqueo del candado local de captura (D6)
        ];

        function _registrarEnSyncQueue(evento) {
            try {
                const entry = Object.assign({
                    id:          'chg_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
                    ts:          Date.now(),
                    deviceId:    _deviceId,
                    estado:      'pendiente',
                    usuario:     (auditCurrentUser ? auditCurrentUser.userName : null) ||
                                 (currentUserUid ? currentUserUid.slice(0,8) : 'local'),
                    uid:         currentUserUid || null
                }, evento);

                // ── 1. Cola operacional en memoria ────────────────────────────
                _syncQueue.push(entry);
                if (_syncQueue.length > SYNC_QUEUE_MAX) {
                    _syncQueue = _syncQueue.slice(-SYNC_QUEUE_MAX);
                }

                // ── 2. Cola operacional en localStorage (TIER 1) ─────────────
                try {
                    localStorage.setItem('inventarioApp_syncQueue', JSON.stringify(_syncQueue));
                } catch(_) {}

                // ── 3. Cola operacional en IDB (más durable que LS) ──────────
                // Fire-and-forget: no bloquea el hilo principal
                _idbQueuePush(entry).catch(function() {});

                // ── 4. Historial PERMANENTE en IDB — nunca se borra ──────────
                // Este store responde: "¿Quién cambió este producto y cuándo?"
                // A diferencia de _syncQueue (que rota a SYNC_QUEUE_MAX), el historial
                // IDB crece indefinidamente (solo limitado por la cuota del dispositivo).
                _idbHistorialPush(entry).catch(function() {});

                return entry;
            } catch(_) { return null; }
        }

        function _getPendingSyncCount() {
            return _syncQueue.filter(function(e) { return e.estado === 'pendiente'; }).length;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  CORRECCIÓN 2 — Registro y notificación de conflictos entre usuarios
        // ══════════════════════════════════════════════════════════════════════
        let _conflictos = []; // conflictos detectados en esta sesión

        /**
         * _registrarConflictos(lista)
         * Almacena conflictos detectados en memoria, LS e IDB.
         * Notifica al administrador para que revise.
         * @param {Array} lista — array de objetos de conflicto
         */
        function _registrarConflictos(lista) {
            if (!Array.isArray(lista) || lista.length === 0) return;

            // Añadir a memoria
            _conflictos = _conflictos.concat(lista);

            // Persistir en LS (últimos 100 conflictos)
            try {
                const raw = localStorage.getItem('inventarioApp_conflictos');
                const existing = raw ? JSON.parse(raw) : [];
                const merged   = existing.concat(lista).slice(-100);
                localStorage.setItem('inventarioApp_conflictos', JSON.stringify(merged));
            } catch(_) {}

            // Persistir en IDB
            _idbSet('conflictos', _conflictos).catch(function() {});

            // Subir conflictos a Firestore si hay conexión
            if (_db && navigator.onLine) {
                const colConflictos = _db
                    .collection('inventarioApp').doc(FIRESTORE_DOC_ID).collection('conflictos');
                lista.forEach(function(c) {
                    const id = 'conf_' + Date.now() + '_' + Math.random().toString(36).slice(2,5);
                    colConflictos.doc(id).set(Object.assign({ id: id }, c))
                        .catch(function(e) { console.warn('[Conflict] Error subiendo conflicto:', e); });
                });
            }

            // Notificar al admin
            const nombres = lista.map(function(c) { return c.prodName; }).join(', ');
            showNotification('⚠️ Conflicto detectado en: ' + nombres +
                '. Ambos valores guardados. Admin: revisa el panel de conflictos.');
            console.warn('[Conflict] ' + lista.length + ' conflicto(s) detectado(s):', lista);
        }

        /**
         * verConflictos()
         * Muestra los conflictos recientes en consola de forma legible.
         * Accesible desde consola: verConflictos()
         */
        function verConflictos() {
            let todos = [];
            try {
                const raw = localStorage.getItem('inventarioApp_conflictos');
                todos = raw ? JSON.parse(raw) : [];
            } catch(_) { todos = []; }
            if (todos.length === 0) {
                console.info('[Conflictos] Sin conflictos registrados ✓');
                return [];
            }
            console.group('[Conflictos] ' + todos.length + ' conflicto(s) encontrado(s)');
            console.table(todos.map(function(c) {
                return {
                    Fecha:       new Date(c.ts).toLocaleString('es-MX'),
                    Producto:    c.prodName,
                    Área:        c.area,
                    'Val.Original': c.valorOriginal,
                    'Val.Local':    c.valorLocal,
                    'Val.Nube':     c.valorNube,
                    'Usuario Local':c.usuarioLocal
                };
            }));
            console.groupEnd();
            return todos;
        }
        window.verConflictos = verConflictos;

        /**
         * _flushSyncQueueToFirestore()
         * Sube los eventos pendientes a Firestore en lote.
         * Se llama después de una sincronización exitosa.
         */
        async function _flushSyncQueueToFirestore() {
            if (!_db || !navigator.onLine) return;

            // Obtener pendientes desde IDB (más completo que solo _syncQueue en memoria)
            const pending = await _idbGetPendingQueue();
            if (pending.length === 0) return;

            const docRef  = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID);
            // ── COLA OPERACIONAL (cambios → estado sincronizado/error) ────────
            const colQueue = docRef.collection('cambios');
            // ── HISTORIAL PERMANENTE (append-only, nunca se borra) ────────────
            // Colección separada en Firestore: cada documento es un cambio inmutable.
            // Permite responder: "¿Quién cambió Tequila entre el 1 y el 30 de junio?"
            const colHistorial = _db.collection('historialCambios');

            try {
                const BATCH_SIZE = 20; // límite de Firestore por batch
                const syncedIds  = [];

                for (let i = 0; i < pending.length; i += BATCH_SIZE) {
                    const lote  = pending.slice(i, i + BATCH_SIZE);
                    const batch = _db.batch();

                    lote.forEach(function(e) {
                        // 1) Escribir en cola operacional (docRef/cambios/{id})
                        batch.set(colQueue.doc(e.id), e);

                        // 2) Escribir en historial permanente (historialCambios/{id})
                        // FASE 0 — PROBLEMA L-1
                        // Antes esta condición era ['inventario','auditoria'].
                        // El tipo 'auditoria' NO se emite en ninguna parte del
                        // código, así que en la práctica solo llegaba
                        // 'inventario'. Todo lo demás —crear o editar un
                        // producto, borrar el catálogo completo, importar un
                        // Excel, cerrar un inventario, reabrir un almacén,
                        // restaurar un respaldo— quedaba FUERA del historial
                        // permanente, que es justo lo que hay que poder
                        // auditar. Los once tipos de abajo son los que el
                        // código emite realmente, verificados uno por uno.
                        if (TIPOS_AUDITABLES.includes(e.tipo)) {
                            batch.set(colHistorial.doc(e.id), Object.assign({}, e, {
                                // Añadir referencia al doc principal para queries cruzadas
                                _docId: FIRESTORE_DOC_ID,
                                // FASE 0 — S-3: la regla exige uid == request.auth.uid
                                // para que nadie pueda falsificar la autoría de un
                                // evento. Un evento registrado ANTES de que la sesión
                                // estuviera lista (migraciones, chequeo de integridad)
                                // nace con uid null y sería rechazado; se le asigna el
                                // usuario que efectivamente lo está subiendo.
                                uid: e.uid || currentUserUid || null,
                                _subidoPor: currentUserUid || null
                            }));
                        }
                    });

                    await batch.commit();
                    lote.forEach(function(e) {
                        e.estado = 'sincronizado';
                        syncedIds.push(e.id);
                    });
                }

                // Marcar como sincronizados en IDB y en _syncQueue en memoria
                await _idbMarkQueueSynced(syncedIds);
                syncedIds.forEach(function(id) {
                    const ev = _syncQueue.find(function(e) { return e.id === id; });
                    if (ev) ev.estado = 'sincronizado';
                });

                try { localStorage.setItem('inventarioApp_syncQueue', JSON.stringify(_syncQueue)); } catch(_) {}
                console.info('[SyncQueue] ' + syncedIds.length + ' evento(s) subidos a Firestore ✓' +
            ' (historial permanente actualizado)');

        // FIX-10: Podar eventos sincronizados del store IDB
        _idbPruneSyncedQueue().catch(function() {});

            } catch(e) {
                console.warn('[SyncQueue] Error al subir eventos:', e);
                // Los eventos quedan como 'pendiente' y se reintentarán en el próximo sync
            }
        }
/**
 * FIX-10: _idbPruneSyncedQueue()
 * Elimina eventos ya sincronizados del store IDB.
 */
