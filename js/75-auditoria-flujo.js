        function toggleCardExpand(productId, event) {
            event.stopPropagation(); // no abrir el modal
            if (expandedCards.has(productId)) {
                expandedCards.delete(productId);
            } else {
                expandedCards.add(productId);
            }
            // Actualizar UI sin re-render completo (más eficiente)
            const btn   = document.getElementById('card-expand-btn-' + productId);
            const extra = document.getElementById('card-extra-' + productId);
            if (!btn || !extra) return;
            const isOpen = expandedCards.has(productId);
            extra.classList.toggle('open', isOpen);
            btn.classList.toggle('open', isOpen);
            btn.setAttribute('aria-expanded', isOpen);
            btn.querySelector('span').textContent = isOpen ? 'Ocultar' : 'Ver más abiertas';
        }

        // ══════════════════════════════════════════════════════════════════════
        //  AUDITORÍA FÍSICA CIEGA — Funciones de control de flujo
        // ══════════════════════════════════════════════════════════════════════

        function auditoriaFinalizarConteo() {
            if (!auditoriaAreaActiva) return;
            const area = auditoriaAreaActiva;
            const nombreArea = areasAuditoria[area];

            showConfirm('¿Finalizar conteo de ' + nombreArea + '?\n\nEsto guardará y bloqueará tu conteo del área. Solo el administrador podrá habilitar correcciones.', function() {
                // Marcar MI área como completada (por usuario, no global)
                myAuditoriaStatus[area] = 'completada';
                // Admin también actualiza el status global del área
                if (isAdmin()) auditoriaStatus[area] = 'completada';
                auditoriaView       = 'selection';
                auditoriaAreaActiva = null;
                isAuditoriaMode     = false;
                saveToLocalStorage();

                // ── SINCRONIZACIÓN A FIREBASE ──────────────────────────────────
                // Estas llamadas son fire-and-forget pero con mecanismos de retry:
                //  • syncMyAuditoriaToFirestore tiene su propio retry vía _auditSyncPending
                //  • syncConteoAtomicoPorArea y syncConteoPorUsuarioToFirestore se marcan
                //    en _pendingAreaSyncs para reintento en el próximo sync periódico.
                // El dato está seguro en localStorage; Firebase es la capa de distribución.

                // Subir conteo propio a Firestore (bajo mi UID, aislado)
                // syncMyAuditoriaToFirestore tiene retry automático vía _auditSyncPending.
                syncMyAuditoriaToFirestore().catch(err => {
                    console.warn('[AuditUser] Error sync al finalizar:', err);
                    // _auditSyncPending ya se setea internamente en syncMyAuditoriaToFirestore
                });

                // FIX 2: Registrar áreas pendientes de sync para retry en caso de fallo.
                // Si el dispositivo está offline o Firebase falla en este momento,
                // _pendingAreaSyncs garantiza que el conteo llega al admin en el próximo
                // ciclo de sincronización (updateNetworkStatus → online → reintento).
                if (!window._pendingAreaSyncs) window._pendingAreaSyncs = new Set();
                window._pendingAreaSyncs.add(area);

                syncConteoAtomicoPorArea(area)
                    .then(function() { window._pendingAreaSyncs.delete(area); })
                    .catch(err => {
                        console.warn('[Atomico] Error en sync final — reintento pendiente:', err);
                        // El área queda en _pendingAreaSyncs para reintento
                        _cloudSyncPending = true; // activa sync periódico de 3 min
                    });
                syncConteoPorUsuarioToFirestore(area)
                    .catch(err => {
                        console.warn('[MultiUser] Error en sync multiusuario — reintento pendiente:', err);
                        _cloudSyncPending = true;
                    });

                showNotification('✅ Conteo de ' + nombreArea + ' guardado y bloqueado');
                renderTab();
            });
        }

        function auditoriaVolverSeleccion() {
            auditoriaView = 'selection';
            auditoriaAreaActiva = null;
            isAuditoriaMode = false;
            _conteoSearchTerm = '';   // limpiar búsqueda al salir del conteo
            saveToLocalStorage();
            renderTab();
        }

        function auditoriaTotalAreasCompletadas() {
            // Usuarios ven su propio progreso; admin ve estado global agregado
            const statusRef = isAdmin() ? auditoriaStatus : myAuditoriaStatus;
            return Object.values(statusRef).filter(s => s === 'completada').length;
        }

        function auditoriaTodasCompletas() {
            const statusRef = isAdmin() ? auditoriaStatus : myAuditoriaStatus;
            return Object.values(statusRef).every(s => s === 'completada');
        }

        // ══════════════════════════════════════════════════════════════════════
        //  ETAPA 15 — INVENTARIO FÍSICO: snapshot, cierre, reapertura, historial
        //  ────────────────────────────────────────────────────────────────────
        //  Ninguna de estas funciones toca stockAreas/userAuditoria como
        //  autoridad — solo LEEN su estado actual (vía products/allUsersAuditoria,
        //  ya mantenidos en memoria por los listeners existentes) para congelar
        //  una fotografía en el momento del cierre. stockAreas sigue siendo el
        //  stock operativo continuo de la sucursal (aclaración de negocio de
        //  esta etapa) — el cierre de un inventario NUNCA lo modifica ni lo
        //  pone en cero.
        // ══════════════════════════════════════════════════════════════════════

        // Aplana el estado actual en un array de registros homogéneos, listo
        // para _writeChunkedSubcollection (que chunkea por CANTIDAD de items,
        // no por tamaño de un objeto único — por eso se aplana en vez de
        // escribir un solo objeto grande).
        function _construirSnapshotInventario() {
            const registros = [];
            registros.push({
                tipo: 'meta',
                numero: _inventarioActivo ? _inventarioActivo.numero : null,
                inventoryId: _auditoriaSessionId,
                fecha: Date.now(),
                totalProductos: products.length,
                warehousesSnapshot: AREAS_CONTEO.slice(),
                participantes: Object.keys(allUsersAuditoria)
            });
            products.forEach(function(p) {
                registros.push({
                    tipo: 'producto',
                    id: p.id,
                    nombre: p.nombre || '',
                    grupo: p.grupo || p.categoria || '',
                    capacidadMl: (typeof p.capacidadMl === 'number') ? p.capacidadMl : null,
                    pesoBotellaLlenaOz: (typeof p.pesoBotellaLlenaOz === 'number') ? p.pesoBotellaLlenaOz : null,
                    // Fotografía del stock POR ÁREA tal como estaba en el momento
                    // del cierre — esto es lo que queda congelado; stockAreas en
                    // Firestore sigue existiendo y evolucionando después.
                    stockByArea: p.stockByArea || {}
                });
            });
            Object.keys(allUsersAuditoria).forEach(function(uid) {
                const u = allUsersAuditoria[uid];
                registros.push({
                    tipo: 'usuario',
                    uid: uid,
                    email: u.email || uid,
                    isAdmin: !!u.isAdmin,
                    status: u.status || {},
                    conteo: u.conteo || {}
                });
            });
            return registros;
        }

        // Reabre un almacén de UN usuario específico (distinto de reabrirArea(),
        // que reabre el área agregada del propio admin — ver informe). Requiere
        // inventory.reopenArea, solo mientras el Inventario Físico esté
        // SINCRONIZADO (nunca si está CERRADO), y deja trazabilidad explícita.
        async function reabrirAlmacenAdmin(uid, area) {
            if (!hasPermission('inventory.reopenArea')) {
                showNotification('⚠️ No tienes permiso para reabrir almacenes');
                return;
            }
            if (!_inventarioActivo || _inventarioActivo.estado !== 'SINCRONIZADO') {
                showNotification('⚠️ Solo se puede reabrir un almacén mientras el Inventario Físico está SINCRONIZADO');
                return;
            }
            const u = allUsersAuditoria[uid];
            if (!u) return;
            const nombreArea = (typeof areasAuditoria !== 'undefined' && areasAuditoria[area]) ? areasAuditoria[area] : area;
            showConfirm(
                '¿Reabrir "' + nombreArea + '" para ' + (u.email || uid) + '?\n\nPodrá volver a modificar su conteo de esta área.',
                async function() {
                    try {
                        await _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                                 .collection('userAuditoria').doc(uid)
                                 .update({ ['status.' + area]: 'pendiente', updatedAt: Date.now() });
                        _registrarEnSyncQueue({
                            tipo:         'reapertura_almacen',
                            detalle:      'Almacén "' + nombreArea + '" reabierto para ' + (u.email || uid) + ' (uid: ' + uid + ') por ' + currentUserUid,
                            valorAntes:   JSON.stringify({ area: area, status: 'completada' }),
                            valorDespues: JSON.stringify({ area: area, status: 'pendiente' }),
                            motivo:       'Reapertura de almacén por administrador'
                        });
                        showNotification('🔄 "' + nombreArea + '" reabierto para ' + (u.email || uid));
                    } catch (err) {
                        console.error('[InventarioFisico] Error al reabrir almacén:', err);
                        showNotification('❌ Error al reabrir — revisa la conexión');
                    }
                }
            );
        }

        // Cierre global — SOLO admin (inventory.closeGlobal). Congela el
        // snapshot y marca estado=CERRADO; a partir de ahí la propia Rule de
        // Firestore hace el resto (ningún update posterior pasa, ni de admin).
        async function cerrarInventarioFisico() {
            if (!hasPermission('inventory.closeGlobal')) {
                showNotification('⚠️ No tienes permiso para cerrar el Inventario Físico');
                return;
            }
            if (!_inventarioActivo || _inventarioActivo.estado === 'CERRADO') {
                showNotification('⚠️ No hay un Inventario Físico activo para cerrar');
                return;
            }
            if (!navigator.onLine) {
                showNotification('📴 Sin conexión — conecta a internet antes de cerrar el inventario');
                return;
            }

            const usuarios = Object.values(allUsersAuditoria);
            const resumenTxt = usuarios.map(function(u) {
                const completas = AREAS_CONTEO.filter(function(a) { return u.status && u.status[a] === 'completada'; }).length;
                return '• ' + (u.email || '?') + ': ' + completas + '/' + AREAS_CONTEO.length + ' áreas';
            }).join('\n');
            const hayPendientes = usuarios.some(function(u) {
                return AREAS_CONTEO.some(function(a) { return !u.status || u.status[a] !== 'completada'; });
            });

            showConfirm(
                '🔒 CERRAR INVENTARIO FÍSICO #' + _inventarioActivo.numero + '\n\n' +
                (resumenTxt || 'Sin participantes registrados todavía') + '\n\n' +
                (hayPendientes ? '⚠️ Hay áreas/usuarios pendientes — el cierre sería forzoso e irreversible.\n\n' : '') +
                'Productos en catálogo: ' + products.length + '\n\n' +
                'Una vez cerrado, el inventario queda INMUTABLE — nadie podrá modificarlo, ni siquiera un administrador.\n\n' +
                '¿Confirmar cierre?',
                async function() {
                    showNotification('⏳ Cerrando Inventario Físico…');
                    const numeroParaLog = _inventarioActivo.numero;
                    try {
                        const inventoryRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                                                 .collection('inventories').doc(_auditoriaSessionId);
                        const registros = _construirSnapshotInventario();
                        // El snapshot se escribe ANTES de marcar CERRADO — si
                        // esto falla, el inventario sigue SINCRONIZADO y el
                        // admin puede reintentar con seguridad (escribir los
                        // chunks de nuevo es seguro: _writeChunkedSubcollection
                        // borra los anteriores antes de escribir).
                        await _writeChunkedSubcollection(inventoryRef, 'snapshotChunks', registros);
                        await inventoryRef.update({
                            estado:           'CERRADO',
                            fechaCierre:      Date.now(),
                            cerradoPorUid:    currentUserUid,
                            cerradoPorNombre: (_auth && _auth.currentUser) ? _auth.currentUser.email : currentUserUid,
                            totalProductos:   products.length,
                            participantesUids: Object.keys(allUsersAuditoria) // ETAPA 15: para filtrar "mis inventarios" barato en el historial, sin leer el snapshot
                        });
                        _registrarEnSyncQueue({
                            tipo:         'cierre_inventario_fisico',
                            detalle:      'Inventario Físico #' + numeroParaLog + ' cerrado' + (hayPendientes ? ' (forzoso, con pendientes)' : ''),
                            valorAntes:   JSON.stringify({ numero: numeroParaLog, estado: 'SINCRONIZADO' }),
                            valorDespues: JSON.stringify({ estado: 'CERRADO' }),
                            motivo:       'Cierre de Inventario Físico'
                        });
                        showNotification('🔒 Inventario Físico #' + numeroParaLog + ' cerrado correctamente');
                    } catch (err) {
                        console.error('[InventarioFisico] Error al cerrar:', err);
                        showNotification('❌ Error al cerrar el inventario — revisa la conexión y vuelve a intentarlo');
                    }
                }
            );
        }

        // Exporta un inventario CERRADO reutilizando el motor Excel EXISTENTE
        // (exportToExcelConDatos) — nunca crea productos ni toca el catálogo
        // real (esa función ya restaura products/inventarioConteo al terminar).
        async function exportarInventarioCerrado(inventoryId, numero) {
            if (!hasPermission('inventory.export')) {
                showNotification('⚠️ No tienes permiso para exportar');
                return;
            }
            showNotification('⏳ Preparando exportación del Inventario Físico #' + numero + '…');
            try {
                const inventoryRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                                         .collection('inventories').doc(inventoryId);
                const registros = await _readChunkedSubcollection(inventoryRef, 'snapshotChunks');
                if (!registros || registros.length === 0) {
                    showNotification('❌ No se encontró el snapshot de este inventario');
                    return;
                }
                const productosCongelados = registros.filter(function(r) { return r.tipo === 'producto'; })
                    .map(function(r) {
                        return { id: r.id, nombre: r.nombre, grupo: r.grupo, capacidadMl: r.capacidadMl, pesoBotellaLlenaOz: r.pesoBotellaLlenaOz, stockByArea: r.stockByArea };
                    });
                const conteoData = {};
                productosCongelados.forEach(function(p) { conteoData[p.id] = p.stockByArea || {}; });
                const nombreArchivo = 'InventarioFisico_' + numero + '_' + new Date().toISOString().split('T')[0] + '.xlsx';
                exportToExcelConDatos('completo', conteoData, productosCongelados, nombreArchivo);
            } catch (err) {
                console.error('[InventarioFisico] Error exportando:', err);
                showNotification('❌ Error al exportar — revisa la conexión');
            }
        }

        // Historial — carga BAJO DEMANDA (no listener en vivo, ver
        // "RENDIMIENTO" del ticket: evitar escuchar toda la colección).
        let _historialInventarios = null; // cache en memoria de la última carga
        async function _cargarHistorialInventarios() {
            if (!_db) return [];
            try {
                const snap = await _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                                       .collection('inventories')
                                       .where('estado', '==', 'CERRADO')
                                       .orderBy('numero', 'desc')
                                       .limit(30)
                                       .get();
                _historialInventarios = snap.docs.map(function(d) { return d.data(); });
                return _historialInventarios;
            } catch (err) {
                console.warn('[InventarioFisico] Error cargando historial:', err);
                return _historialInventarios || [];
            }
        }


        function auditoriaEntrarArea(area) {
            // ETAPA 15: un Inventario Físico CERRADO es de solo lectura — nadie
            // puede volver a entrar a contar, ni siquiera el admin. La Rule de
            // Firestore ya lo protege a nivel de datos (inventories/{id}
            // inmutable); este chequeo evita además que la UI intente
            // siquiera ofrecer la acción.
            if (_inventarioActivo && _inventarioActivo.estado === 'CERRADO') {
                showNotification('🔒 Este Inventario Físico está CERRADO — solo lectura');
                return;
            }
            // Bloquear entrada si el usuario ya finalizó esa área (solo admin puede entrar igual)
            if (!isAdmin() && myAuditoriaStatus[area] === 'completada') {
                // Ver si hay unlock para algún producto
                const tieneUnlock = Object.keys(myAuditoriaUnlocks)
                    .some(k => k.endsWith('__' + area) && !myAuditoriaUnlocks[k].used);
                if (!tieneUnlock) {
                    showNotification('🔒 Área completada — solicita al administrador habilitar una corrección');
                    return;
                }
            }
            auditoriaAreaActiva = area;
            auditoriaView = 'counting';
            isAuditoriaMode = true;
            selectedArea = area;
            _conteoSearchTerm = '';
            saveToLocalStorage();
            renderTab();
        }

        // FIX P0.1 (DOBLE CLIC / REENTRADA): flag en memoria que marca que una
        // creación de auditoría ya está en curso. Se activa justo antes de la
        // primera escritura real a Firestore y se libera SIEMPRE en el
        // finally, tanto en éxito como en error — evita que dos confirmaciones
        // casi simultáneas disparen dos escrituras atómicas con dos sessionId
        // distintos compitiendo entre sí.
        let _auditoriaCreandoEnProgreso = false;

        function auditoriaResetear() {
            if (!isAdmin()) {
                showNotification('⚠️ Solo el administrador puede iniciar un nuevo ciclo de inventario');
                return;
            }
                        if (!navigator.onLine) {
                showNotification('📴 Sin conexión — conecta a internet antes de iniciar nueva auditoría');
                return;
            }
            if (_inventarioActivo && _inventarioActivo.estado !== 'CERRADO') {
                showNotification('🔒 Debes cerrar el Inventario Físico #' + _inventarioActivo.numero + ' antes de iniciar uno nuevo — los conteos en curso se perderían');
                return;
            }
            // FIX P0.1 (DOBLE CLIC): si ya hay una creación en curso, no se abre
            // un segundo flujo de confirmación.
            if (_auditoriaCreandoEnProgreso) {
                showNotification('⏳ Ya se está iniciando una nueva auditoría — espera a que termine');
                return;
            }
            // CORRECCIÓN 4: Primera confirmación
            showConfirm(
                '⚠️ ¿Iniciar nuevo Inventario Físico?\n\n' +
                'Se borrarán todos los conteos actuales de TODOS los usuarios y áreas ' +
                '(el stock operativo actual de cada producto NO se toca — sigue exactamente igual).\n\n' +
                'Se creará un respaldo automático antes de continuar.\n' +
                'Esta acción no se puede deshacer.',
                function() {
                    // FIX P0.1: re-chequeo — cierra la ventana entre el primer
                    // diálogo y el segundo (p.ej. dos clics casi simultáneos en
                    // el botón original, cada uno abriendo su propia cadena de
                    // confirmaciones).
                    if (_auditoriaCreandoEnProgreso) {
                        showNotification('⏳ Ya se está iniciando una nueva auditoría — espera a que termine');
                        return;
                    }
                    // Segunda confirmación (acción crítica irreversible)
                    showConfirm(
                        '🔁 CONFIRMACIÓN FINAL — NUEVO INVENTARIO FÍSICO\n\n' +
                        'Se eliminarán los conteos de auditoría de:\n' +
                        '• ' + Object.keys(auditoriaConteoPorUsuario).length + ' producto(s) ya contado(s)\n' +
                        '• Todas las áreas (Almacén, Barra 1, Barra 2)\n\n' +
                        '¿Confirmar inicio del nuevo Inventario Físico?',
                        async function() {
                            // FIX P0.1: última comprobación justo antes de escribir.
                            if (_auditoriaCreandoEnProgreso) {
                                showNotification('⏳ Ya se está iniciando una nueva auditoría — espera a que termine');
                                return;
                            }
                            _auditoriaCreandoEnProgreso = true;

                            // Crear respaldo antes de resetear. Se hace con el
                            // estado AÚN vigente (sesión anterior) — nada se ha
                            // tocado todavía.
                            _crearBackupNombrado('pre_reset_auditoria_' + new Date().toISOString().split('T')[0]);

                            const newSessionId = String(Date.now());

                            // CORRECCIÓN 3: Auditoría del reset. Se registra la
                            // INTENCIÓN antes de escribir — _auditoriaSessionId
                            // todavía es el valor anterior en este punto, porque
                            // (ver FIX P0.1 abajo) el estado local ya no se muta
                            // hasta que Firestore confirme.
                            _registrarEnSyncQueue({
                                tipo:         'reset_auditoria',
                                detalle:      'Nueva auditoría iniciada. Sesión anterior: ' + (_auditoriaSessionId || 'N/A'),
                                valorAntes:   JSON.stringify({
                                    productosContados: Object.keys(auditoriaConteoPorUsuario).length,
                                    sessionId: _auditoriaSessionId
                                }),
                                valorDespues: newSessionId,
                                motivo:       'Inicio de nuevo ciclo de auditoría'
                            });

                            showNotification('⏳ Iniciando nuevo Inventario Físico…');

                            // ══════════════════════════════════════════════════════════════
                            // FIX P0.1 (REGLA PRINCIPAL — CONSISTENCIA Y ROLLBACK):
                            // Antes, el estado local (memoria + localStorage + IndexedDB, vía
                            // saveToLocalStorage) se declaraba "nueva auditoría" de forma
                            // INCONDICIONAL, ANTES de intentar cualquier escritura a Firestore.
                            // Si _adminIniciarSesionFirestore() fallaba a mitad de camino (o
                            // simplemente por pérdida de conexión), este dispositivo quedaba
                            // mostrando una auditoría "fantasma" — sessionId nuevo, conteos en
                            // cero — que Firestore NUNCA confirmó, sin ningún mecanismo de
                            // rollback: el catch original solo mostraba un error y dejaba el
                            // estado local tal cual había quedado.
                            //
                            // Ahora el orden se invierte: el estado local SOLO avanza a la
                            // nueva sesión DESPUÉS de que el batch atómico de Firestore se
                            // confirme. Si falla, el bloque de mutación de abajo nunca se
                            // ejecuta — el estado local permanece intacto en la sesión
                            // anterior. Esto es un "rollback" trivial por construcción: nunca
                            // hay nada que revertir, porque nunca se avanzó de más. El admin
                            // puede reintentar la misma acción con seguridad (no hay estado
                            // parcial que limpiar).
                            // ══════════════════════════════════════════════════════════════

                            // ETAPA 15: número visible seguro ANTES del batch — si esto
                            // falla, ni siquiera se intenta el batch principal, y el guard
                            // de doble-clic se libera limpiamente (nada quedó a medias).
                            let numeroInventario;
                            try {
                                numeroInventario = await _obtenerSiguienteNumeroInventario();
                            } catch (errNum) {
                                console.error('[InventarioFisico] Error obteniendo número de inventario:', errNum);
                                showNotification('❌ No se pudo generar el número de inventario — revisa la conexión y vuelve a intentarlo');
                                _auditoriaCreandoEnProgreso = false;
                                return;
                            }

                            try {
                                await _adminIniciarSesionFirestore(newSessionId, numeroInventario); // atómico: todo o nada

                                // Firestore confirmó la nueva sesión — ahora sí es seguro
                                // reflejarla localmente.
                                _auditoriaSessionId       = newSessionId;
                                auditoriaStatus           = estadoAreasVacio('pendiente');
                                auditoriaConteo           = {};
                                auditoriaConteoPorUsuario = {};
                                allUsersAuditoria         = {};
                                // Reiniciar estado propio del admin (él también cuenta)
                                myAuditoriaConteo  = {};
                                myAuditoriaStatus  = estadoAreasVacio('pendiente');
                                myAuditoriaUnlocks = {};
                                auditoriaView      = 'selection';
                                auditoriaAreaActiva = null;
                                isAuditoriaMode    = false;
                                // ETAPA 15: este dispositivo (el iniciador) fija su propio
                                // _auditoriaSessionId directamente aquí, sin pasar por
                                // handleAuditSessionChange() (mismo patrón preexistente de
                                // P0/P0.1) — por eso necesita suscribirse al inventario
                                // activo también aquí explícitamente; los DEMÁS dispositivos
                                // lo reciben vía el snapshot entrante, que sí pasa por
                                // handleAuditSessionChange() y ya lo hace por su cuenta.
                                _suscribirInventarioActivo(newSessionId);
                                saveToLocalStorage();
                                renderTab();

                                // FIX P0.1: la limpieza de colecciones LEGACY
                                // (conteoAreas/dispositivos, conteoMultiUsuario — usadas
                                // solo por generarYPublicarReporte(), ver comentarios en
                                // resetConteoAtomicoEnFirestore) se trata como paso
                                // SECUNDARIO y NO bloqueante: la sesión de auditoría ya
                                // quedó confirmada en Firestore aunque este paso falle, así
                                // que NO se revierte la sesión por un fallo aquí. Si falla,
                                // se avisa honestamente (nunca se muestra un "✅" que
                                // implique éxito total) y queda marcado para reintento.
                                try {
                                    await resetConteoAtomicoEnFirestore();
                                    try { localStorage.removeItem('inventarioApp_legacyCleanupPending'); } catch(_) {}
                                    showNotification('✅ Inventario Físico #' + numeroInventario + ' iniciado — todos los conteos en ceros');
                                } catch (errLegacy) {
                                    console.error('[AuditReset] Sesión ' + newSessionId + ' confirmada en Firestore, pero falló la limpieza de conteos legacy (conteoAreas/conteoMultiUsuario):', errLegacy);
                                    try { localStorage.setItem('inventarioApp_legacyCleanupPending', newSessionId); } catch(_) {}
                                    showNotification('⚠️ Nueva auditoría iniciada, pero algunos datos históricos de reportes no se limpiaron — reintenta desde Ajustes o contacta soporte');
                                }
                            } catch (err) {
                                // La sesión NUNCA se confirmó en Firestore — el estado local
                                // NO se tocó, sigue en la sesión anterior. No hay nada que
                                // revertir.
                                console.error('[AuditReset] Error crítico al iniciar sesión en Firestore — estado local NO modificado, sesión anterior sigue activa:', err);
                                showNotification('❌ No se pudo iniciar la nueva auditoría — la auditoría anterior sigue activa. Revisa la conexión y vuelve a intentarlo');
                            } finally {
                                _auditoriaCreandoEnProgreso = false;
                            }
                        }
                    );
                }
            );
        }

        /**
         * reabrirArea(area)
         * FIX #7 — Permite al administrador reabrir un área completada para corrección.
         * Los bartenders que ya contaron conservan sus datos; solo cambia el estado.
         */
        function reabrirArea(area) {
            if (!isAdmin()) {
                showNotification('⚠️ Solo el administrador puede reabrir áreas');
                return;
            }
            const nombreArea = areasAuditoria[area] || area;
            showConfirm('¿Reabrir el área "' + nombreArea + '"?\n\nLos conteos existentes se conservan. Los bartenders podrán modificar sus datos.', function() {
                auditoriaStatus[area] = 'pendiente';
                saveToLocalStorage();
                // Sincronizar nuevo estado a Firestore si hay conexión
                if (_db && navigator.onLine) {
                    _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                        .update({ ['auditoriaStatus.' + area]: 'pendiente' }) // FIX-2: campo anidado correcto para que _applyCloudData lo lea
                        .catch(err => console.warn('[Reabrir] Error sync:', err));
                }
                showNotification('↩️ Área "' + nombreArea + '" reabierta para corrección');
                renderTab();
            });
        }

        /**
         * Exportar inventario consolidado de auditoría — misma lógica que exportToExcel
         * pero toma los datos de auditoriaConteo en lugar de inventarioConteo.
         */
        function exportarAuditoriaExcel() {
            if (isAdmin()) {
                exportarExcelAdminTotal();
            } else {
                exportarExcelMiConteo();
            }
        }

        // ── BÚSQUEDA EN CONTEO ────────────────────────────────────────────────
        // ── Utilidad: extrae bigramas de un string ────────────────────────────────
        function _csBigrams(str) {
            const b = [];
            for (let i = 0; i < str.length - 1; i++) b.push(str.slice(i, i + 2));
            return b;
        }

        /**
         * Búsqueda fuzzy/multi-palabra.
         * Normaliza acentos, divide la query en palabras y para cada una:
         *   10pts  → substring exacto en cualquier campo
         *    7pts  → prefijo de token (startsWith)
         *   1-6pts → similitud de bigramas ≥ 0.45 (tolerancia a typos)
         *    0pts  → sin coincidencia → el producto se descarta
         * Retorna score > 0 si hay match, 0 si no.
         */
        function _csFuzzyMatch(product, query) {
            if (!query) return 1;
            const norm = s => (s || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const words = norm(query.trim()).split(/\s+/).filter(Boolean);
            if (!words.length) return 1;

            const fields = [norm(product.name), norm(product.id), norm(product.group)];
            const haystack = fields.join(' ');
            const tokens   = haystack.split(/\s+/).filter(Boolean);

            let totalScore = 0;
            for (const word of words) {
                // Nota: words ya fue filtrado con .filter(Boolean); la guarda redundante se eliminó.
                let wordScore = 0;

                // Substring exacto (mejor)
                if (haystack.includes(word)) {
                    wordScore = 10;
                }
                // Prefijo de algún token
                else if (tokens.some(t => t.startsWith(word))) {
                    wordScore = 7;
                }
                // Tolerancia a typos vía bigramas (solo para palabras ≥ 3 chars)
                else if (word.length >= 3) {
                    const qBig = _csBigrams(word);
                    let bestSim = 0;
                    for (const token of tokens) {
                        if (Math.abs(token.length - word.length) > 3) continue;
                        const tBig   = _csBigrams(token);
                        const common = qBig.filter(b => tBig.includes(b)).length;
                        if (common === 0) continue;
                        const sim = (2 * common) / (qBig.length + tBig.length);
                        if (sim > bestSim) bestSim = sim;
                    }
                    if (bestSim >= 0.45) wordScore = Math.max(1, Math.round(bestSim * 6));
                }

                // Si alguna palabra no matchea, el producto queda excluido
                if (wordScore === 0) return 0;
                totalScore += wordScore;
            }
            return totalScore;
        }

        /**
         * Resalta en el nombre del producto TODAS las palabras de la query.
         * Soporta búsqueda multi-palabra: "tequila rep" resalta ambas palabras.
         */
        function highlightConteoMatch(name, query) {
            if (!name) return '';
            if (!query) return escapeHtml(name);
            const words = query.trim().split(/\s+/).filter(w => w.length >= 2);
            if (!words.length) return escapeHtml(name);
            let result = escapeHtml(name);
            for (const word of words) {
                const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                try {
                    result = result.replace(new RegExp('(' + esc + ')', 'gi'),
                        '<mark class="csb-match">$1</mark>');
                } catch (_) { /* regex inválida — ignorar */ }
            }
            return result;
        }

        /**
         * updateConteoSearch — con debounce (180ms) y skip si el término no cambió.
         * Restaura foco al input después del render (manejado por _getElementSelector via id).
         */
        function updateConteoSearch(val) {
            const next = (val || '').trimStart();
            clearTimeout(_csSearchTimer);
            _csSearchTimer = setTimeout(function() {
                const trimmed = next.trimEnd();
                if (trimmed === _conteoSearchTerm) return; // sin cambio → no re-render
                _conteoSearchTerm = trimmed;
                // Actualizar clase del wrapper sin esperar re-render completo
                const wrap = document.getElementById('csb-wrap');
                if (wrap) wrap.classList.toggle('csb-wrap--active', !!_conteoSearchTerm);
                renderTab();
            }, 180);
        }
