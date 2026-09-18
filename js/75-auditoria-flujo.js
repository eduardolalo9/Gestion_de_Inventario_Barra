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

        // ══════════════════════════════════════════════════════════════════════
        //  FASE 2A — FINALIZAR CONTEO PROPIO ≠ CERRAR EL ÁREA
        //  ────────────────────────────────────────────────────────────────────
        //  Hasta ahora esta única función hacía DOS cosas distintas según
        //  quién pulsaba el botón: marcaba el conteo propio como terminado
        //  y, si el que pulsaba era administrador, marcaba ADEMÁS el área
        //  como completada para TODAS las personas (la línea
        //  `if (isAdmin()) auditoriaStatus[area] = 'completada';`).
        //
        //  Esa mezcla ya causó un defecto documentado más abajo en este
        //  mismo archivo (la puerta de entrada miraba myAuditoriaStatus
        //  mientras el administrador operaba sobre auditoriaStatus, de modo
        //  que "Reabrir" no desbloqueaba a nadie).
        //
        //  Ahora son dos operaciones con dos permisos:
        //    auditoriaFinalizarConteo()  → inventory.closeOwn
        //    auditoriaCerrarArea(area)   → inventory.closeOther
        //
        //  Para el bartender el camino es idéntico al de antes: la línea
        //  retirada solo se ejecutaba para administradores.
        // ══════════════════════════════════════════════════════════════════════
        function auditoriaFinalizarConteo() {
            if (!auditoriaAreaActiva) return;
            const area = auditoriaAreaActiva;
            const nombreArea = areasAuditoria[area];

            // FASE 2A — esta función no verificaba NADA: ni permiso, ni
            // estado del inventario. Cualquier usuario autenticado que
            // llegara a la pantalla podía finalizar.
            if (!hasPermission('inventory.closeOwn')) {
                showNotification('⚠️ No tienes permiso para finalizar el conteo');
                return;
            }
            if (!puedeOperarArea(area)) {
                showNotification('⚠️ No tienes asignada el área ' + nombreArea);
                return;
            }
            if (_inventarioActivo && _inventarioActivo.estado === 'CERRADO') {
                showNotification('🔒 El inventario está cerrado');
                return;
            }

            showConfirm('¿Finalizar conteo de ' + nombreArea + '?\n\nEsto guardará y bloqueará tu conteo del área. Solo el administrador podrá habilitar correcciones.', function() {
                // Marcar MI área como completada (por usuario, no global)
                myAuditoriaStatus[area] = 'completada';

                // ── D · Quién la finalizó y cuándo ──────────────────────────
                // Antes de esto, finalizar un área solo escribía la palabra
                // 'completada'. No quedaba constancia de quién la cerró ni a
                // qué hora: si el lunes el conteo de la barra no cuadraba, no
                // había forma de saber quién lo dio por terminado ni cuándo.
                // El único dato era un updatedAt a nivel de todo el documento
                // del usuario, que cambia con cualquier cosa que haga.
                //
                // El registro vive en el documento del propio usuario
                // (userAuditoria/{uid}), que ya está aislado por uid del lado
                // del servidor y que el administrador sí puede leer.
                if (typeof myAuditoriaFinalizadas === 'undefined' || !myAuditoriaFinalizadas) {
                    myAuditoriaFinalizadas = {};
                }
                myAuditoriaFinalizadas[area] = {
                    uid:    currentUserUid || null,
                    nombre: ((_auth && _auth.currentUser && _auth.currentUser.email)
                            || (auditCurrentUser && auditCurrentUser.userName)
                            || currentUserUid || 'desconocido'),
                    ts:     Date.now(),
                    rol:    currentUserRole || 'user'
                };

                // FASE 2A — aquí vivía `if (isAdmin()) auditoriaStatus[area] =
                // 'completada';`. Cerrar el área para todas las personas es
                // ahora una acción propia y explícita: auditoriaCerrarArea().
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

        // ══════════════════════════════════════════════════════════════════════
        //  auditoriaCerrarArea(area) — FASE 2A
        //  ────────────────────────────────────────────────────────────────────
        //  Da por terminada un área para TODAS las personas que cuentan en
        //  ella. No es "finalizar mi conteo" ni es "cerrar el inventario":
        //  es el escalón intermedio que hasta ahora existía escondido como
        //  efecto secundario del botón de finalizar.
        //
        //  No toca el conteo de nadie: solo marca el estado global del área.
        //  Reabrirla sigue siendo competencia de inventory.reopenArea.
        // ══════════════════════════════════════════════════════════════════════
        function auditoriaCerrarArea(area) {
            if (!area) return;
            if (!hasPermission('inventory.closeOther')) {
                showNotification('⚠️ No tienes permiso para cerrar el área completa');
                return;
            }
            if (_inventarioActivo && _inventarioActivo.estado === 'CERRADO') {
                showNotification('🔒 El inventario está cerrado');
                return;
            }
            const nombreArea = areasAuditoria[area] || area;
            if (auditoriaStatus[area] === 'completada') {
                showNotification('El área ' + nombreArea + ' ya estaba cerrada');
                return;
            }
            showConfirm(
                '¿Cerrar el área ' + nombreArea + ' para TODAS las personas?\n\n' +
                'Nadie podrá seguir capturando en esta área hasta que se reabra. ' +
                'Los conteos ya guardados no se modifican.\n\n¿Continuar?',
                function() {
                    auditoriaStatus[area] = 'completada';
                    saveToLocalStorage();
                    _registrarEnSyncQueue({
                        tipo:    'reapertura_almacen',
                        detalle: 'Cierre de área ' + area + ' para todos los usuarios',
                        area:    area,
                        accion:  'cierre_area'
                    });
                    showNotification('🔒 Área ' + nombreArea + ' cerrada para todos');
                    renderTab();
                }
            );
        }
        window.auditoriaCerrarArea = auditoriaCerrarArea;

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
            // R4 (reglas 4 y 5) — a qué semana pertenece este cierre.
            // Se calcula UNA vez, aquí, y se congela. Volver a deducirlo después
            // a partir del timestamp daría un resultado distinto si alguien abre
            // el histórico desde un dispositivo en otro huso horario.
            var _claseR4 = (typeof clasificarRecuento === 'function')
                           ? clasificarRecuento(new Date()) : null;

            registros.push({
                tipo: 'meta',
                numero: _inventarioActivo ? _inventarioActivo.numero : null,
                inventoryId: _auditoriaSessionId,
                fecha: Date.now(),
                // Metadatos del ciclo semanal. De momento solo se guardan: el
                // arrastre del inicial (regla 5) se activa cuando esté lista la
                // pantalla de inventario físico.
                semanaId:       _claseR4 ? _claseR4.semanaId : null,
                fechaLocal:     _claseR4 ? _claseR4.fecha : null,
                tipoRecuento:   _claseR4 ? _claseR4.tipo : null,
                cierraSemana:   _claseR4 ? _claseR4.cierraSemana : null,
                esCorteMensual: _claseR4 ? _claseR4.esCorteMensual : null,
                totalProductos: products.length,
                warehousesSnapshot: AREAS_CONTEO.slice(),
                participantes: Object.keys(allUsersAuditoria)
            });
            products.forEach(function(p) {
                registros.push({
                    tipo: 'producto',
                    id: p.id,
                    // F1 — aqui se leia p.nombre y p.grupo, pero un producto del
                    // catalogo usa p.name y p.group (ver saveProduct y la
                    // importacion). El snapshot llevaba anos guardando cadena
                    // vacia en los dos campos. Se leen ambos nombres para no
                    // depender de cual use el objeto, y se guardan tambien como
                    // name/unit/group, que es lo que el generador de Excel lee.
                    nombre: p.name || p.nombre || '',
                    name:   p.name || p.nombre || '',
                    unit:   p.unit || '',
                    grupo:  p.group || p.grupo || p.categoria || '',
                    group:  p.group || p.grupo || p.categoria || '',
                    precio:      (typeof p.precio      === 'number') ? p.precio      : null,
                    stockMinimo: (typeof p.stockMinimo === 'number') ? p.stockMinimo : null,
                    conversion:  (typeof p.conversion  === 'number') ? p.conversion  : null,
                    proveedor:   p.proveedor || '',
                    pv:          p.pv || '',
                    capacidadMl: (typeof p.capacidadMl === 'number') ? p.capacidadMl : null,
                    pesoBotellaLlenaOz: (typeof p.pesoBotellaLlenaOz === 'number') ? p.pesoBotellaLlenaOz : null,
                    // R1 (regla 14) — el modo de conteo se congela junto con el stock.
                    // Un cierre guardado tiene que poder releerse anos despues con la
                    // misma interpretacion que tenia el dia que se cerro.
                    conteoOzHabilitado: (typeof p.conteoOzHabilitado === 'boolean') ? p.conteoOzHabilitado : null,
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
        // F1 — Reconstruye { producto: { area: {enteras, abiertas[]} } } a partir
        // de los registros de usuario congelados en el snapshot, con la MISMA
        // regla de consolidación que _recalcAdminAggregatedConteo usa en vivo:
        //
        //   1. Si algún ADMIN contó ese producto en esa área, manda el admin
        //      (el más reciente por updatedAt). El admin ya resolvió el conflicto
        //      al guardar su conteo final.
        //   2. Si no, gana el conteo más reciente entre los usuarios regulares,
        //      desempatando por el timestamp DEL PRODUCTO (_ts / _lastWrite), no
        //      por el del documento del usuario.
        //
        // Reusar la regla, en vez de inventar otra, es lo que hace que el Excel
        // diga lo mismo que el admin vio en pantalla el día del cierre.
        // No modifica el snapshot: solo lee.
        function _consolidarConteoCongelado(usuarios, areas, productos) {
            var agregado  = {};
            var admins    = usuarios.filter(function(u) { return u.isAdmin; });
            var regulares = usuarios.filter(function(u) { return !u.isAdmin; });

            // Todos los productos del inventario, aunque nadie los haya contado:
            // una fila en cero es información, una fila ausente es un hueco.
            var ids = {};
            (productos || []).forEach(function(p) { ids[p.id] = true; });
            usuarios.forEach(function(u) {
                Object.keys(u.conteo || {}).forEach(function(id) { ids[id] = true; });
            });

            Object.keys(ids).forEach(function(prodId) {
                agregado[prodId] = {};
                areas.forEach(function(area) {
                    function _entradas(lista) {
                        return lista.map(function(u) {
                            return { u: u, d: u.conteo && u.conteo[prodId] && u.conteo[prodId][area] };
                        }).filter(function(e) { return e.d; });
                    }

                    var conAdmin = _entradas(admins);
                    if (conAdmin.length > 0) {
                        conAdmin.sort(function(a, b) { return (b.u.updatedAt || 0) - (a.u.updatedAt || 0); });
                        agregado[prodId][area] = {
                            enteras:  conAdmin[0].d.enteras  || 0,
                            abiertas: conAdmin[0].d.abiertas || []
                        };
                        return;
                    }

                    var entradas = _entradas(regulares);
                    if (entradas.length === 0) {
                        agregado[prodId][area] = { enteras: 0, abiertas: [] };
                        return;
                    }
                    entradas.sort(function(a, b) {
                        var tsA = (a.d._ts || a.d._lastWrite || a.u.updatedAt || 0);
                        var tsB = (b.d._ts || b.d._lastWrite || b.u.updatedAt || 0);
                        return tsB - tsA;
                    });
                    agregado[prodId][area] = {
                        enteras:  entradas[0].d.enteras  || 0,
                        abiertas: entradas[0].d.abiertas || []
                    };
                });
            });
            return agregado;
        }

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
                // ── F1 — DEFECTO CRITICO 3 ────────────────────────────────
                // Antes se entregaba `stockByArea` como si fuera el conteo. No lo
                // es: stockByArea es UN NUMERO por area (el total ya convertido),
                // mientras que el generador de Excel espera { enteras, abiertas[] }
                // y lee `.enteras` de el. Un numero no tiene `.enteras`, asi que
                // TODAS las cantidades salian en cero. Ademas el producto
                // congelado guarda `nombre` y el generador lee `name`, asi que la
                // columna Nombre salia vacia.
                //
                // El conteo fisico de verdad esta en los registros tipo 'usuario'.
                // Se consolida con la MISMA regla que usa la pantalla del admin
                // (admin manda; si no, gana el mas reciente), para que el Excel
                // diga exactamente lo que el admin vio el dia que cerro.
                const meta = registros.filter(function(r) { return r.tipo === 'meta'; })[0] || {};
                const areasHistoricas = (Array.isArray(meta.warehousesSnapshot) && meta.warehousesSnapshot.length)
                                        ? meta.warehousesSnapshot.slice()
                                        : AREAS_CONTEO.slice();

                var _sinNombre = 0;
                const productosCongelados = registros.filter(function(r) { return r.tipo === 'producto'; })
                    .map(function(r) {
                        // Los inventarios cerrados ANTES de F1 no tienen nombre
                        // guardado (se grababa vacio). Para esos se recurre al
                        // catalogo actual, que es la unica fuente que queda; se
                        // cuenta cuantos fueron para avisarlo al terminar.
                        var nom = r.name || r.nombre || '';
                        if (!nom) {
                            var vivo = products.filter(function(p) { return p.id === r.id; })[0];
                            nom = vivo ? (vivo.name || '') : '';
                            if (nom) _sinNombre++;
                        }
                        return {
                            id: r.id,
                            name: nom,
                            unit: r.unit || '',
                            group: r.group || r.grupo || '',
                            capacidadMl: r.capacidadMl,
                            pesoBotellaLlenaOz: r.pesoBotellaLlenaOz,
                            conteoOzHabilitado: r.conteoOzHabilitado,
                            precio:      (typeof r.precio      === 'number') ? r.precio      : undefined,
                            stockMinimo: (typeof r.stockMinimo === 'number') ? r.stockMinimo : undefined,
                            conversion:  (typeof r.conversion  === 'number') ? r.conversion  : undefined,
                            proveedor:   r.proveedor || '',
                            pv:          r.pv || '',
                            stockByArea: r.stockByArea
                        };
                    });

                const usuariosCongelados = registros.filter(function(r) { return r.tipo === 'usuario'; });
                const conteoData = _consolidarConteoCongelado(usuariosCongelados, areasHistoricas,
                                                              productosCongelados);

                const nombreArchivo = 'InventarioFisico_' + numero + '_' + new Date().toISOString().split('T')[0] + '.xlsx';
                exportToExcelConDatos('completo', conteoData, productosCongelados, nombreArchivo,
                                      areasHistoricas);
                if (_sinNombre > 0) {
                    showNotification('ℹ️ ' + _sinNombre + ' nombre(s) se tomaron del catálogo actual: '
                                   + 'este inventario se cerró antes de que el nombre quedara congelado.');
                }
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

        // ── R7 ────────────────────────────────────────────────────────────────
        // El formulario de creacion YA es la confirmacion: pedir ademas los dos
        // showConfirm de texto serian tres dialogos seguidos para una sola
        // accion. En vez de partir auditoriaResetear —que es la funcion mas
        // delicada de este archivo— se sustituyen sus dos confirmaciones por
        // este envoltorio. Con la bandera apagada el comportamiento es
        // identico al de siempre, asi que el camino antiguo no cambia.
        let _saltarConfirmacionNuevoInv = false;

        // Lo que el formulario deja preparado para la creacion. Se limpia
        // siempre al terminar, con exito o sin el.
        let _opcionesNuevoInventario = null;

        function _confirmarOSaltar(mensaje, alAceptar) {
            if (_saltarConfirmacionNuevoInv) { alAceptar(); return; }
            showConfirm(mensaje, alAceptar);
        }

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
            _confirmarOSaltar(
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
                    _confirmarOSaltar(
                        '🔁 CONFIRMACIÓN FINAL — NUEVO INVENTARIO FÍSICO\n\n' +
                        'Se eliminarán los conteos de auditoría de:\n' +
                        '• ' + Object.keys(auditoriaConteoPorUsuario).length + ' producto(s) ya contado(s)\n' +
                        '• Todas las áreas (' + AREAS_CONTEO.map(function(a) { return areasAuditoria[a]; }).join(', ') + ')\n\n' +
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
         * ─────────────────
         * Reabre un área completada para que se pueda corregir el conteo.
         *
         * D — ESTA FUNCIÓN NO REABRÍA NADA PARA EL BARTENDER.
         *
         * Había tres caminos distintos para reabrir un área, y estaban
         * desalineados entre sí:
         *
         *   1. reabrirArea(area)          — esta, la que se ofrece en la
         *      tarjeta del área. Solo comprobaba isAdmin(), no pedía el
         *      permiso inventory.reopenArea, no miraba si el inventario ya
         *      estaba cerrado, no dejaba rastro, y escribía en
         *      `auditoriaStatus` del documento principal.
         *   2. reabrirAlmacenAdmin(uid, area) — la correcta: pide permiso,
         *      exige inventario SINCRONIZADO, deja rastro, y escribe en
         *      `userAuditoria/{uid}.status`.
         *   3. adminUnlockAreaUsuario(uid, area) — desbloqueo producto a
         *      producto, otro mecanismo distinto.
         *
         * El problema de fondo: la puerta de entrada al conteo
         * (auditoriaEntrarArea) mira `myAuditoriaStatus[area]`, que vive en el
         * documento de CADA usuario. `auditoriaStatus` del documento principal
         * no lo consulta nadie para decidir si se puede contar. O sea que el
         * jefe de barra pulsaba "Reabrir", veía el área en pendiente en su
         * pantalla, le decía al bartender que ya podía corregir — y al
         * bartender le seguía saliendo bloqueada. Sin ningún mensaje de error:
         * simplemente no pasaba nada.
         *
         * Ahora esta función es la única puerta y hace lo que promete: aplica
         * las mismas comprobaciones que el camino correcto, y reabre el área
         * para todas las personas que la tenían finalizada, no solo en la
         * vista del administrador.
         */
        async function reabrirArea(area) {
            // Mismas comprobaciones que reabrirAlmacenAdmin, en vez de un
            // isAdmin() suelto: el permiso existía y esta ruta lo ignoraba.
            if (!hasPermission('inventory.reopenArea')) {
                showNotification('⚠️ No tienes permiso para reabrir áreas');
                return;
            }
            if (_inventarioActivo && _inventarioActivo.estado !== 'SINCRONIZADO') {
                showNotification('⚠️ El Inventario Físico está ' + _inventarioActivo.estado +
                    ' — no se puede reabrir un área');
                return;
            }

            const nombreArea = areasAuditoria[area] || area;

            // Personas que tienen ESTA área finalizada. Son a quienes hay que
            // reabrírsela de verdad, en su propio documento.
            const afectados = Object.keys(allUsersAuditoria || {}).filter(function(uid) {
                const u = allUsersAuditoria[uid];
                return u && u.status && u.status[area] === 'completada';
            });

            const detalleQuienes = afectados.length === 0
                ? '\n\nAhora mismo nadie la tiene finalizada.'
                : '\n\nSe reabrirá para ' + afectados.length + ' persona(s).';

            showConfirm('¿Reabrir el área "' + nombreArea + '"?\n\n' +
                'Los conteos existentes se conservan; solo se permite volver a modificarlos.' +
                detalleQuienes,
            async function() {
                const docPrincipal = _db
                    ? _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                    : null;

                // 1) Estado agregado que ve el administrador.
                auditoriaStatus[area] = 'pendiente';
                // 2) Mi propio estado, si soy yo quien había finalizado.
                if (myAuditoriaStatus[area] === 'completada') {
                    myAuditoriaStatus[area] = 'pendiente';
                    if (typeof myAuditoriaFinalizadas !== 'undefined' && myAuditoriaFinalizadas) {
                        delete myAuditoriaFinalizadas[area];
                    }
                }
                saveToLocalStorage();

                if (!docPrincipal || !navigator.onLine) {
                    showNotification('📴 Sin conexión — el área se reabrió aquí, ' +
                        'pero los demás no lo verán hasta que vuelva la señal');
                    renderTab();
                    return;
                }

                let fallidos = 0;
                try {
                    await docPrincipal.update({ ['auditoriaStatus.' + area]: 'pendiente' });
                } catch (err) {
                    console.warn('[Reabrir] Error al sincronizar el estado agregado:', err);
                }

                // 3) Lo que de verdad desbloquea el conteo: el estado dentro
                //    del documento de cada persona.
                for (const uid of afectados) {
                    try {
                        await docPrincipal.collection('userAuditoria').doc(uid)
                            .update({ ['status.' + area]: 'pendiente', updatedAt: Date.now() });
                    } catch (err) {
                        fallidos++;
                        console.warn('[Reabrir] No se pudo reabrir para', uid, err);
                    }
                }

                // 4) Rastro. Reabrir un área permite cambiar cantidades ya
                //    contadas; tiene que quedar escrito quién lo autorizó.
                _registrarEnSyncQueue({
                    tipo:         'reapertura_almacen',
                    detalle:      'Área "' + nombreArea + '" reabierta para ' +
                                  afectados.length + ' persona(s) por ' + (currentUserUid || 'admin'),
                    valorAntes:   JSON.stringify({ area: area, status: 'completada', usuarios: afectados }),
                    valorDespues: JSON.stringify({ area: area, status: 'pendiente' }),
                    motivo:       'Reapertura de área por administrador'
                });

                if (fallidos > 0) {
                    showNotification('⚠️ "' + nombreArea + '" se reabrió, pero ' + fallidos +
                        ' persona(s) no recibieron el cambio — reintenta con señal');
                } else {
                    showNotification('↩️ Área "' + nombreArea + '" reabierta para corrección');
                }
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

        // ══════════════════════════════════════════════════════════════════════
        //  R7 — FORMULARIO DE NUEVO INVENTARIO FÍSICO
        //  ────────────────────────────────────────────────────────────────────
        //  Antes, crear un inventario eran dos cuadros de texto seguidos con
        //  "¿estás seguro?". No se elegía nada: ni las áreas, ni la fecha, ni
        //  quedaba dicho para qué era ese conteo. Ahora es un formulario, y el
        //  propio formulario hace de confirmación.
        //
        //  El número NO se escribe: lo asigna Firestore con una transacción,
        //  que es lo que garantiza que dos administradores creando a la vez no
        //  se lleven el mismo número.
        // ══════════════════════════════════════════════════════════════════════

        function abrirModalNuevoInventario() {
            if (!isAdmin() || !hasPermission('inventory.create')) {
                showNotification('⚠️ Solo el administrador puede crear un Inventario Físico');
                return;
            }
            if (_inventarioActivo && _inventarioActivo.estado !== 'CERRADO') {
                showNotification('🔒 Cierra el Inventario Físico #' + _inventarioActivo.numero + ' antes de crear otro');
                return;
            }
            if (!navigator.onLine) {
                showNotification('📴 Sin conexión — el número de inventario se pide al servidor');
                return;
            }

            var hoy = (typeof fechaISOLocal === 'function')
                      ? fechaISOLocal(new Date())
                      : new Date().toISOString().slice(0, 10);

            var cont = document.getElementById('nuevoInvAreas');
            if (cont) {
                cont.innerHTML = areasDefinidas().map(function(a) {
                    return '<label style="display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer;">'
                         + '<input type="checkbox" class="nuevoInvArea" value="' + escapeHtml(a.id) + '" checked '
                         + 'style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0;cursor:pointer;">'
                         + '<span style="font-size:.88rem;">' + escapeHtml(a.icono || '📍') + ' ' + escapeHtml(a.nombre) + '</span>'
                         + '</label>';
                }).join('');
            }
            var f = document.getElementById('nuevoInvFecha');       if (f) f.value = hoy;
            var c = document.getElementById('nuevoInvComentario');  if (c) c.value = '';
            var n = document.getElementById('nuevoInvNombre');      if (n) n.value = 'BARRA INVENTARIO FÍSICO';

            var cre = document.getElementById('nuevoInvCreadoPor');
            if (cre) {
                cre.textContent = (_auth && _auth.currentUser && _auth.currentUser.email)
                                  ? _auth.currentUser.email : (currentUserUid || 'administrador');
            }
            _pintarAvisoFechaNuevoInv();

            var m = document.getElementById('nuevoInventarioModal');
            if (m) { m.classList.remove('hidden'); document.body.classList.add('modal-open'); }
        }

        function cerrarModalNuevoInventario() {
            var m = document.getElementById('nuevoInventarioModal');
            if (m) { m.classList.add('hidden'); document.body.classList.remove('modal-open'); }
        }

        /**
         * Dice a qué semana pertenece la fecha elegida y si ese día cierra
         * semana. No bloquea nada: un conteo a media semana es legítimo, pero
         * el administrador debe saber que ese NO arrastra el inicial.
         */
        function _pintarAvisoFechaNuevoInv() {
            var el = document.getElementById('nuevoInvAvisoFecha');
            var f  = document.getElementById('nuevoInvFecha');
            if (!el || !f || typeof clasificarRecuento !== 'function') return;
            var cl = clasificarRecuento(f.value);
            if (!cl) { el.textContent = ''; return; }

            var semana = (typeof etiquetaSemana === 'function') ? etiquetaSemana(f.value) : cl.semanaId;
            if (cl.cierraSemana) {
                el.style.color = 'var(--green, #4ade80)';
                el.textContent = '✓ Domingo — cierra la ' + semana +
                                 (cl.esCorteMensual ? ' y además es corte de fin de mes.' : '.');
            } else if (cl.esCorteMensual) {
                el.style.color = 'var(--amber, #fbbf24)';
                el.textContent = 'Corte de fin de mes. No cierra semana: el inicial del lunes seguirá saliendo del domingo.';
            } else {
                el.style.color = 'var(--txt-muted)';
                el.textContent = 'Pertenece a la ' + semana + '. Al no ser domingo, no arrastra el inicial.';
            }
        }

        function confirmarNuevoInventario() {
            var areas = [].slice.call(document.querySelectorAll('.nuevoInvArea:checked'))
                          .map(function(i) { return i.value; });
            if (!areas.length) {
                showNotification('⚠️ Elige al menos un área de conteo');
                return;
            }
            var fechaEl = document.getElementById('nuevoInvFecha');
            var fecha   = fechaEl ? fechaEl.value : '';
            if (typeof parseFechaLocal === 'function' && !parseFechaLocal(fecha)) {
                showNotification('⚠️ La fecha no es válida');
                return;
            }

            _opcionesNuevoInventario = {
                areas:         areas,
                fechaRecuento: fecha,
                nombre:        (document.getElementById('nuevoInvNombre') || {}).value || 'BARRA INVENTARIO FÍSICO',
                comentario:    ((document.getElementById('nuevoInvComentario') || {}).value || '').trim().slice(0, 300)
            };

            cerrarModalNuevoInventario();

            // El formulario ya fue la confirmación. La bandera se apaga sola en
            // cuanto auditoriaResetear la consume, y aquí se repone por si esa
            // función se corta antes de llegar (sin conexión, por ejemplo): una
            // bandera encendida haría que el SIGUIENTE intento se saltara los
            // avisos sin que nadie lo pidiera.
            _saltarConfirmacionNuevoInv = true;
            try {
                auditoriaResetear();
            } finally {
                _saltarConfirmacionNuevoInv = false;
            }
        }

        // ── Glosario y tarjeta de estado ──────────────────────────────────────

        const ESTADOS_INVENTARIO = {
            SINCRONIZADO: {
                etiqueta: 'Sincronizado',
                color:    '#60a5fa',
                fondo:    'rgba(96,165,250,.12)',
                texto:    'Conteo en curso. El stock todavía no se ha afectado.'
            },
            CERRADO: {
                etiqueta: 'Cerrado',
                color:    '#4ade80',
                fondo:    'rgba(74,222,128,.12)',
                texto:    'Cerrado e inmutable. Queda como histórico y nadie puede modificarlo, ni el administrador.'
            }
        };

        function _pillEstadoInventario(estado) {
            var e = ESTADOS_INVENTARIO[estado] || { etiqueta: estado || '—', color: '#9aa2b4', fondo: 'rgba(154,162,180,.12)' };
            return '<span style="display:inline-block;padding:3px 10px;border-radius:999px;'
                 + 'background:' + e.fondo + ';color:' + e.color + ';font-size:.68rem;font-weight:700;'
                 + 'text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;">'
                 + escapeHtml(e.etiqueta) + '</span>';
        }

        /** Cuántas personas tienen algo contado en este inventario ahora mismo. */
        function _usuariosContando() {
            var n = 0;
            Object.keys(allUsersAuditoria || {}).forEach(function(uid) {
                var u = allUsersAuditoria[uid];
                if (!u) return;
                var tieneAlgo = u.status && Object.keys(u.status).some(function(a) {
                    return u.status[a] === 'completada' || u.status[a] === 'en_progreso';
                });
                if (tieneAlgo || (u.conteo && Object.keys(u.conteo).length)) n++;
            });
            return n;
        }

        function renderGlosarioEstados() {
            var html = '<details style="margin-top:10px;">';
            html += '<summary style="cursor:pointer;font-size:.72rem;color:var(--txt-muted);min-height:32px;'
                 +  'display:flex;align-items:center;">¿Qué significa cada estado?</summary>';
            html += '<div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">';
            Object.keys(ESTADOS_INVENTARIO).forEach(function(k) {
                var e = ESTADOS_INVENTARIO[k];
                html += '<div style="display:flex;gap:8px;align-items:flex-start;">'
                     +  _pillEstadoInventario(k)
                     +  '<span style="font-size:.72rem;color:var(--txt-secondary);line-height:1.5;flex:1;">'
                     +  escapeHtml(e.texto) + '</span></div>';
            });
            html += '</div></details>';
            return html;
        }
