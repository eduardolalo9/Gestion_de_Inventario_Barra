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
            if (_inventarioActivo && !inventarioAbierto(_inventarioActivo)) {
                showNotification('🔒 El inventario está ' + (_inventarioActivo.estado || 'cerrado') + ' — ya no se cuenta');
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
                //  • syncConteoPorUsuarioToFirestore, si falla, activa _cloudSyncPending
                //    (sync periódico de 3 min).
                // El dato está seguro en localStorage; Firebase es la capa de distribución.
                //
                // FASE 8C (26/09/2026): aquí vivía también syncConteoAtomicoPorArea(area)
                // —la escritura a la colección heredada conteoAreas— con su propio
                // registro en _pendingAreaSyncs. Se retiró: ver el comentario de cabecera
                // en js/40-firestore.js (sección "FASE 8C — RETIRO DE conteoAreas") para
                // la evidencia de por qué ya no tenía consumidor.

                // Subir conteo propio a Firestore (bajo mi UID, aislado)
                // syncMyAuditoriaToFirestore tiene retry automático vía _auditSyncPending.
                syncMyAuditoriaToFirestore().catch(err => {
                    console.warn('[AuditUser] Error sync al finalizar:', err);
                    // _auditSyncPending ya se setea internamente en syncMyAuditoriaToFirestore
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
            if (_inventarioActivo && !inventarioAbierto(_inventarioActivo)) {
                showNotification('🔒 El inventario está ' + (_inventarioActivo.estado || 'cerrado') + ' — ya no se cuenta');
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
                async function() {
                    // FASE 12 — antes se cambiaba solo en local y viajaba con la
                    // sincronización general, que mandaba el MAPA COMPLETO de
                    // estados de este dispositivo (y con él, estados viejos de
                    // otro inventario). Ahora se escribe SOLO este campo, en una
                    // transacción que comprueba que el servidor sigue en la
                    // misma sesión que esta pantalla. Sin conexión no se cierra:
                    // igual que reabrir, es una orden para todos los teléfonos.
                    if (!_db || !navigator.onLine) {
                        showNotification('📴 Sin conexión — cerrar un área para todos necesita internet');
                        return;
                    }
                    const sesion = _auditoriaSessionId;
                    try {
                        const ref = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID);
                        await _db.runTransaction(async function(tx) {
                            const snap = await tx.get(ref);
                            const vigente = snap.exists ? (snap.data() || {})._auditoriaSessionId : null;
                            if (!sesion || String(vigente) !== String(sesion)) {
                                throw new Error('sesion_distinta');
                            }
                            tx.update(ref, { ['auditoriaStatus.' + area]: 'completada', _lastModified: Date.now() });
                        });
                    } catch (e) {
                        showNotification(e && e.message === 'sesion_distinta'
                            ? '⚠️ Esta pantalla estaba en otro inventario. Se actualizó; revisa y vuelve a intentarlo.'
                            : '❌ No se pudo cerrar el área — revisa la conexión. No se cambió nada.');
                        renderTab();
                        return;
                    }
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
        // ══════════════════════════════════════════════════════════════════════
        //  _semanaIdDelInventario(inv)
        //  PASO PREVIO A FASE 3 — defecto H-3
        //  ────────────────────────────────────────────────────────────────────
        //  La semana del cierre se calculaba con clasificarRecuento(new Date()),
        //  es decir con el RELOJ DEL DISPOSITIVO en el instante de pulsar
        //  cerrar. Cerrar el lunes de madrugada un inventario contado el domingo
        //  asignaba la semana siguiente. Como "contabilizar" se apoyará en ese
        //  identificador para arrastrar el stock inicial, el error se heredaría
        //  desde el primer ciclo y nadie lo notaría hasta cuadrar la semana.
        //
        //  Orden de preferencia:
        //    1. inv.fechaRecuento — la fecha que el administrador eligió en el
        //       formulario. Es un hecho de negocio, no un accidente del reloj.
        //    2. La fecha del cierre, como respaldo para el camino antiguo (sin
        //       formulario), donde fechaRecuento nace en null.
        //
        //  Devuelve también el ORIGEN, para que dentro de un año se pueda saber
        //  de dónde salió la semana de un inventario concreto sin adivinarlo.
        // ══════════════════════════════════════════════════════════════════════
        function _semanaIdDelInventario(inv) {
            if (typeof clasificarRecuento !== 'function') {
                return { clase: null, origen: 'no_disponible' };
            }
            const fechaForm = inv && inv.fechaRecuento;
            if (fechaForm) {
                const clase = clasificarRecuento(fechaForm);
                if (clase && clase.semanaId) return { clase: clase, origen: 'fechaRecuento' };
            }
            // Respaldo explícito: queda registrado que NO se usó la fecha del
            // formulario, en vez de fingir que sí.
            return { clase: clasificarRecuento(new Date()), origen: 'fechaCierre' };
        }
        window._semanaIdDelInventario = _semanaIdDelInventario;

        function _construirSnapshotInventario() {
            const registros = [];
            // R4 (reglas 4 y 5) — a qué semana pertenece este cierre.
            // Se calcula UNA vez, aquí, y se congela. Volver a deducirlo después
            // a partir del timestamp daría un resultado distinto si alguien abre
            // el histórico desde un dispositivo en otro huso horario.
            //
            // H-3: la fecha ya NO es new Date(). Sale de la fecha de recuento
            // que eligió el administrador; el reloj del dispositivo es solo el
            // respaldo, y queda constancia de cuál se usó.
            var _semana  = _semanaIdDelInventario(_inventarioActivo);
            var _claseR4 = _semana.clase;

            registros.push({
                tipo: 'meta',
                numero: _inventarioActivo ? _inventarioActivo.numero : null,
                inventoryId: _auditoriaSessionId,
                fecha: Date.now(),
                // Metadatos del ciclo semanal. De momento solo se guardan: el
                // arrastre del inicial (regla 5) se activa cuando esté lista la
                // pantalla de inventario físico.
                semanaId:       _claseR4 ? _claseR4.semanaId : null,
                // H-3 — 'fechaRecuento' (lo normal) o 'fechaCierre' (respaldo).
                semanaIdOrigen: _semana.origen,
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
            if (!inventarioAbierto(_inventarioActivo)) {
                showNotification('⚠️ No hay un Inventario Físico abierto para cerrar');
                return;
            }
            if (!navigator.onLine) {
                showNotification('📴 Sin conexión — conecta a internet antes de cerrar el inventario');
                return;
            }
            // HOTFIX 4.20 — el cierre congela los conteos de la sesión vigente
            // y escribe en inventories/{sesión vigente}. Si lo que está en
            // pantalla es OTRO inventario (un huérfano de una versión
            // anterior, como el #102 de agosto), cerrarlo así fallaba contra
            // el servidor o, peor, congelaría conteos que no son suyos.
            if (_inventarioActivoId && String(_inventarioActivoId) !== String(_auditoriaSessionId)) {
                cerrarInventarioHuerfano(_inventarioActivoId);
                return;
            }
            // RECONTEO — cerrar con un reconteo sin finalizar congelaría los
            // valores anteriores a las correcciones anotadas.
            if (typeof _hayReconteoAbierto === 'function' && await _hayReconteoAbierto(_auditoriaSessionId)) {
                showNotification('⚠️ Hay un reconteo abierto — finalízalo o descártalo antes de cerrar el inventario');
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
                        const _semanaCierre = _semanaIdDelInventario(_inventarioActivo);

                        // ══════════════════════════════════════════════════════
                        //  H-1 — CIERRE ATÓMICO
                        //  ────────────────────────────────────────────────────
                        //  Antes eran dos await independientes (los fragmentos y
                        //  luego el cambio de estado), y el escritor de
                        //  fragmentos eran a su vez dos batches más. Si fallaba
                        //  entre medias, el inventario quedaba SINCRONIZADO con
                        //  el snapshot ya escrito. Y el comentario que había
                        //  aquí afirmaba que reintentar era seguro: NO lo era.
                        //  Reescribir un fragmento existente es un 'update' para
                        //  Firestore, y las reglas lo prohíben, así que el
                        //  reintento moría con permission-denied y el inventario
                        //  quedaba atascado: ni cerrado ni reabrible.
                        //
                        //  Ahora los fragmentos y el paso a CERRADO viajan en UN
                        //  SOLO batch: o queda todo escrito, o no queda nada.
                        //  Un fallo deja el inventario exactamente como estaba y
                        //  el reintento parte de cero.
                        //
                        //  Las reglas evalúan cada escritura del batch contra el
                        //  estado YA CONFIRMADO, así que durante el cierre el
                        //  inventario todavía es SINCRONIZADO y los fragmentos
                        //  se crean; en cuanto el batch se confirma, pasa a
                        //  CERRADO y ya no se le puede añadir nada (H-2).
                        //  Comprobado contra el emulador real.
                        // ══════════════════════════════════════════════════════
                        const batch = _db.batch();
                        const resSnap = _escribirSnapshotEnBatch(batch, inventoryRef, registros);
                        if (!resSnap.ok) {
                            console.error('[InventarioFisico] No se pudo preparar el snapshot:', resSnap);
                            showNotification(resSnap.motivo === 'demasiados_fragmentos'
                                ? '❌ El inventario es demasiado grande para cerrarse en una sola operación. Avisa a soporte.'
                                : '❌ No se pudo preparar el cierre — revisa la conexión');
                            return;
                        }
                        batch.update(inventoryRef, {
                            estado:           'CERRADO',
                            fechaCierre:      Date.now(),
                            cerradoPorUid:    currentUserUid,
                            cerradoPorNombre: (_auth && _auth.currentUser) ? _auth.currentUser.email : currentUserUid,
                            totalProductos:   products.length,
                            participantesUids: Object.keys(allUsersAuditoria), // ETAPA 15: para filtrar "mis inventarios" barato en el historial, sin leer el snapshot
                            // H-3 — la semana queda también en la CABECERA, no
                            // solo dentro del snapshot: contabilizar necesita
                            // leerla sin abrir los fragmentos.
                            semanaId:         _semanaCierre.clase ? _semanaCierre.clase.semanaId : null,
                            semanaIdOrigen:   _semanaCierre.origen
                        });
                        await batch.commit();
                        _registrarEnSyncQueue({
                            tipo:         'cierre_inventario_fisico',
                            detalle:      'Inventario Físico #' + numeroParaLog + ' cerrado' + (hayPendientes ? ' (forzoso, con pendientes)' : ''),
                            valorAntes:   JSON.stringify({ numero: numeroParaLog, estado: 'SINCRONIZADO' }),
                            valorDespues: JSON.stringify({ estado: 'CERRADO' }),
                            motivo:       'Cierre de Inventario Físico'
                        });
                        showNotification('🔒 Inventario Físico #' + numeroParaLog + ' cerrado correctamente');
                        _historialInventarios = null;   // el recién cerrado entra al Historial
                    } catch (err) {
                        console.error('[InventarioFisico] Error al cerrar:', err);
                        showNotification('❌ Error al cerrar el inventario — revisa la conexión y vuelve a intentarlo');
                    }
                }
            );
        }

        // ══════════════════════════════════════════════════════════════════════
        //  HOTFIX 4.20 — CERRAR UN INVENTARIO ABANDONADO (HUÉRFANO)
        //  Versiones anteriores a FASE 12 permitían abrir un inventario nuevo
        //  dejando el anterior en SINCRONIZADO. Ese "huérfano" ya no tiene
        //  conteos (se borraron al abrir el siguiente) y bloqueaba crear otro
        //  sin que ningún botón pudiera cerrarlo. Se cierra marcado como
        //  abandonado, SIN snapshot: no hay conteo que congelar, así que
        //  tampoco se puede contabilizar (evaluarContabilizable lo explica).
        //  Las reglas ya permiten al admin pasar SINCRONIZADO → CERRADO.
        // ══════════════════════════════════════════════════════════════════════
        async function cerrarInventarioHuerfano(inventoryId) {
            if (!hasPermission('inventory.closeGlobal')) {
                showNotification('⚠️ No tienes permiso para cerrar inventarios');
                return;
            }
            if (!inventoryId || String(inventoryId) === String(_auditoriaSessionId)) return;
            if (!navigator.onLine) {
                showNotification('📴 Sin conexión — conecta a internet antes de cerrar el inventario');
                return;
            }
            const ref = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID).collection('inventories').doc(String(inventoryId));
            let inv;
            try {
                const snap = await ref.get({ source: 'server' });
                if (!snap.exists) { showNotification('❌ No se encontró ese inventario'); return; }
                inv = snap.data() || {};
            } catch (e) {
                showNotification('❌ No se pudo leer el inventario — revisa la conexión');
                return;
            }
            if (!inventarioAbierto(inv)) {
                showNotification('ℹ️ El Inventario #' + (inv.numero || '—') + ' ya estaba cerrado');
                return;
            }
            showConfirm(
                '🗂️ CERRAR INVENTARIO ABANDONADO #' + (inv.numero || '—') + '\n\n' +
                'Quedó abierto de una versión anterior y no pertenece a la sesión actual: ' +
                'sus conteos ya no existen.\n\n' +
                'Se cerrará como ABANDONADO (sin conteo congelado) y no se podrá contabilizar. ' +
                'Después podrás crear el inventario nuevo.\n\n¿Confirmar?',
                async function() {
                    try {
                        await ref.update({
                            estado:           'CERRADO',
                            cierreTipo:       'abandonado',
                            fechaCierre:      Date.now(),
                            cerradoPorUid:    currentUserUid,
                            cerradoPorNombre: (_auth && _auth.currentUser) ? _auth.currentUser.email : currentUserUid
                        });
                        _registrarEnSyncQueue({
                            tipo: 'cierre_inventario_abandonado',
                            detalle: 'Inventario Físico #' + (inv.numero || '—') + ' cerrado como abandonado',
                            valorAntes: JSON.stringify({ estado: 'SINCRONIZADO' }),
                            valorDespues: JSON.stringify({ estado: 'CERRADO', cierreTipo: 'abandonado' }),
                            motivo: 'Inventario huérfano de una versión anterior'
                        });
                        _historialInventarios = null;
                        // Vuelve a escuchar el inventario de la sesión vigente.
                        if (typeof _suscribirInventarioActivo === 'function') _suscribirInventarioActivo(_auditoriaSessionId);
                        showNotification('✅ Inventario #' + (inv.numero || '—') + ' cerrado como abandonado. Ya puedes crear el nuevo.');
                        renderTab();
                    } catch (err) {
                        console.error('[InventarioFisico] Error al cerrar abandonado:', err);
                        showNotification('❌ No se pudo cerrar — revisa la conexión y vuelve a intentarlo');
                    }
                }
            );
        }
        window.cerrarInventarioHuerfano = cerrarInventarioHuerfano;

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

        // ══════════════════════════════════════════════════════════════════════
        //  FASE 3 — CONTABILIZAR
        //  ────────────────────────────────────────────────────────────────────
        //  Convierte el resultado físico de un inventario CERRADO en el stock
        //  inicial del ciclo siguiente.
        //
        //  Lo que NO hace, y es la mitad del diseño:
        //   · NO toca el snapshot congelado. Ni un byte.
        //   · NO toca stockAreas, que es el stock operativo continuo.
        //   · NO recalcula nada con el catálogo actual: usa los valores que
        //     quedaron congelados el día del cierre.
        //
        //  La idempotencia NO la comprueba el cliente: la garantiza el servidor.
        //  El documento del inicial se llama como la semana destino y las reglas
        //  solo permiten crearlo, nunca actualizarlo. Dos administradores
        //  pulsando a la vez, el segundo recibe permission-denied de Firestore.
        // ══════════════════════════════════════════════════════════════════════

        // ── Saldos por producto desde el snapshot congelado ──────────────────
        // Tres pasos: consolidar entre usuarios con la MISMA regla que usa el
        // Excel del cierre (admin manda; si no, el más reciente), convertir las
        // onzas a fracción de botella con los datos CONGELADOS, y sumar las
        // áreas. Decisión D-1: un total por producto, sin desglose de área.
        //
        // Usar los datos congelados y no el catálogo actual no es un detalle:
        // si alguien corrige el peso de una botella en marzo, un inicial de
        // enero recalculado con el peso nuevo daría otro número.
        function _saldosDesdeSnapshot(registros) {
            const meta = (registros || []).filter(function(r) { return r.tipo === 'meta'; })[0] || {};
            const areas = (Array.isArray(meta.warehousesSnapshot) && meta.warehousesSnapshot.length)
                          ? meta.warehousesSnapshot.slice()
                          : AREAS_CONTEO.slice();
            const productosCongelados = (registros || []).filter(function(r) { return r.tipo === 'producto'; });
            const usuarios            = (registros || []).filter(function(r) { return r.tipo === 'usuario'; });

            if (productosCongelados.length === 0) {
                return { ok: false, motivo: 'snapshot_sin_productos' };
            }

            const conteo = _consolidarConteoCongelado(usuarios, areas, productosCongelados);

            // Decisión de Eduardo (4-oct-2026, corrige R11/F12 de FASE 3):
            // "nadie lo contó" y "se contó y dio cero" ya NO se tratan igual
            // aquí — mismo criterio que fvsConteoFisicoProducto()
            // (49-fisico-vs-sistema.js), que ya distingue las dos cosas desde
            // FASE 11B. _consolidarConteoCongelado() rellena cada área con
            // {enteras:0, abiertas:[]} cuando nadie la tocó (es lo correcto
            // para el Excel del cierre: una fila en cero ahí sigue siendo
            // información). Por eso "tocado" se calcula ANTES de ese relleno,
            // mirando el conteo crudo de cada usuario, no el consolidado.
            const tocados = {};
            usuarios.forEach(function(u) {
                Object.keys(u.conteo || {}).forEach(function(id) { tocados[id] = true; });
            });

            let enCero = 0, noContados = 0;
            const productos = productosCongelados.map(function(p) {
                let total = 0;
                areas.forEach(function(area) {
                    const d = (conteo[p.id] && conteo[p.id][area]) || { enteras: 0, abiertas: [] };
                    let suma = d.enteras || 0;
                    const abiertas = d.abiertas || [];
                    if (tieneConversion(p)) {
                        abiertas.forEach(function(pesoOz) {
                            suma += convertirOzAPuntos(pesoOz, p.capacidadMl, p.pesoBotellaLlenaOz);
                        });
                    } else {
                        // Mismo respaldo que el resto del sistema: sin datos de
                        // conversión, las abiertas ya vienen como fracción.
                        abiertas.forEach(function(v) { suma += (v || 0); });
                    }
                    total += suma;
                });
                const contado = !!tocados[p.id];
                if (!contado) { noContados++; }
                else if (total === 0) { enCero++; }
                // FASE 13 — se arrastra también el precio CONGELADO (el que
                // tenía el producto el día del cierre, no el del catálogo de
                // hoy): lo necesita cierreMensualDesdeSnapshot() para
                // valorizar el corte sin recalcular nada con datos de otra
                // fecha. id/total/contado son los únicos campos que arman el
                // inicial semanal.
                return { id: p.id, total: total, contado: contado,
                         precio: (typeof p.precio === 'number') ? p.precio : null };
            });

            return {
                ok: true,
                productos: productos,
                areas: areas,
                enCero: enCero,
                noContados: noContados,
                totalProductos: productos.length
            };
        }

        // ── ¿Esta semana ya tiene un inicial? ────────────────────────────────
        // Distingue dos cosas que NO son lo mismo: "ya lo contabilicé yo"
        // (éxito, no hay nada que hacer) de "otro inventario ocupa esa semana"
        // (conflicto real, que se muestra y no se resuelve en silencio).
        async function _verificarInicialExistente(semanaId, inventoryId) {
            try {
                const snap = await _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                                      .collection('inventariosIniciales').doc(semanaId).get();
                if (!snap.exists) return { existe: false };
                const d = snap.data() || {};
                const origenId = (d.origen && d.origen.inventoryId) || null;
                return {
                    existe: true,
                    mismoOrigen: origenId === inventoryId,
                    origenId: origenId,
                    origenNumero: (d.origen && d.origen.numero) || null,
                    datos: d
                };
            } catch (e) {
                console.warn('[Contabilizar] No se pudo leer el inicial existente:', e);
                return { existe: false, error: true };
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  FASE 13 — CONTABILIZAR, CORTE DE FIN DE MES
        //  ────────────────────────────────────────────────────────────────────
        //  R4 (js/15-ciclo-semanal.js) ya distinguía un corte de fin de mes de
        //  un cierre de semana: el primero NO arrastra inicial (partiría la
        //  semana en dos), pero hasta esta fase tampoco generaba nada —
        //  evaluarContabilizable() lo bloqueaba sin excepción (decisión N-1
        //  original). Esta fase le da un destino propio: un documento
        //  mensual, separado del inicial semanal, que valoriza el cierre en
        //  dinero para contabilidad. Un domingo que además es fin de mes
        //  genera los dos documentos en el mismo clic (decisión confirmada
        //  con Eduardo, 1-oct-2026).
        //
        //  Mismo principio que el inicial semanal: NO recalcula con el
        //  catálogo de hoy. El precio que valoriza este corte es el que
        //  quedó CONGELADO en el snapshot el día del cierre (ver
        //  'producto'.precio más arriba) — si en marzo se corrige un precio,
        //  el corte de enero no cambia.
        //
        //  "Nunca se inventa un número": un producto sin precio congelado no
        //  se valoriza en cero ni se le asigna el precio de otro. Se cuenta
        //  aparte (productosSinPrecio) y se excluye del total, igual que
        //  "Valor en existencia" en el panel (83-panel.js, _panelIndicadores).
        // ══════════════════════════════════════════════════════════════════════

        /**
         * cierreMensualDesdeSnapshot(cierre) — construye el corte contable del mes.
         *
         * Devuelve null si la fecha del cierre no es un corte de fin de mes
         * (clasificarRecuento().esCorteMensual === false): un miércoles
         * cualquiera no genera nada aquí, igual que el inicial semanal
         * devuelve null si la fecha no cierra semana.
         *
         * Decisión de Eduardo (4-oct-2026): mismo criterio que su hermano del
         * inicial semanal (15-ciclo-semanal.js) — un producto que nadie contó
         * (p.contado === false) tampoco entra aquí. No es "sin precio" (eso YA se excluye, ver arriba);
         * es "no hay físico que valorizar", y valorizarlo en $0 sería justo el
         * número inventado que esta función existe para evitar.
         *
         * @param {object} cierre { fecha, inventoryId, numero, productos: [{id, total, precio, contado?}] }
         */
        function cierreMensualDesdeSnapshot(cierre) {
            if (!cierre || !cierre.fecha) return null;
            var clase = (typeof clasificarRecuento === 'function') ? clasificarRecuento(cierre.fecha) : null;
            if (!clase || !clase.esCorteMensual) return null;

            var saldos = {};
            var conPrecio = 0, sinPrecio = 0, valorTotal = 0, noContados = 0;
            (cierre.productos || []).forEach(function(p) {
                if (!p || !p.id) return;
                if (p.contado === false) { noContados++; return; }
                var t = Number(p.total);
                if (!isFinite(t)) t = 0;
                // Mismo redondeo a 3 decimales que el inicial semanal, por la
                // misma razón: sin esto, sumar tres áreas en coma flotante
                // deja colas de 0.30000000000000004 escritas para siempre en
                // un documento inmutable.
                var saldo = Math.round(t * 1000) / 1000;
                saldos[p.id] = saldo;
                if (typeof p.precio === 'number') {
                    conPrecio++;
                    valorTotal += saldo * p.precio;
                } else {
                    sinPrecio++;
                }
            });

            return {
                // 'YYYY-MM' derivado de la fecha del recuento, ya validada por
                // clasificarRecuento() — el string ISO ya está en hora local,
                // no hace falta volver a partirlo con cuidado de huso horario.
                mesId: String(clase.fecha).slice(0, 7),
                origen: {
                    tipo:          'cierre_inventario',
                    inventoryId:   cierre.inventoryId || null,
                    numero:        (cierre.numero !== undefined) ? cierre.numero : null,
                    fechaCierre:   clase.fecha,
                    semanaCerrada: clase.semanaId
                },
                saldos:              saldos,
                totalProductos:      Object.keys(saldos).length,
                productosConPrecio:  conPrecio,
                productosSinPrecio:  sinPrecio,
                productosNoContados: noContados,
                // Redondeado a centavos: es dinero, no un conteo de botellas.
                valorTotal:         Math.round(valorTotal * 100) / 100
            };
        }
        window.cierreMensualDesdeSnapshot = cierreMensualDesdeSnapshot;

        // ── ¿Este mes ya tiene un corte contable? — mismo patrón que la semana ──
        async function _verificarCorteMensualExistente(mesId, inventoryId) {
            try {
                const snap = await _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                                      .collection('cortesMensuales').doc(mesId).get();
                if (!snap.exists) return { existe: false };
                const d = snap.data() || {};
                const origenId = (d.origen && d.origen.inventoryId) || null;
                return {
                    existe: true,
                    mismoOrigen: origenId === inventoryId,
                    origenId: origenId,
                    origenNumero: (d.origen && d.origen.numero) || null,
                    datos: d
                };
            } catch (e) {
                console.warn('[Contabilizar] No se pudo leer el corte mensual existente:', e);
                return { existe: false, error: true };
            }
        }

        // ── ¿Se puede contabilizar este inventario? — LA regla, en un sitio ──
        //
        //  La usan tres lugares: el encabezado de Conteo (para decidir si
        //  dibuja el botón o explica por qué no), el detalle del Historial, y
        //  contabilizarInventario() — que la vuelve a aplicar sobre el
        //  documento recién leído del servidor, porque lo que hay en pantalla
        //  puede ir un paso por detrás. Antes cada uno tenía su propia copia de
        //  las condiciones, y dos copias de una regla acaban diciendo cosas
        //  distintas.
        //
        //  Pura: no lee Firestore ni toca el DOM.
        //  @returns { puede, hecho?, motivo?, semanaDestino? }
        function evaluarContabilizable(inv) {
            if (!inv) return { puede: false, motivo: 'No hay inventario.' };
            if (inv.estado === 'CONTABILIZADO') {
                return { puede: false, hecho: true,
                         semanaDestino: inv.semanaDestino || null,
                         mesDestino:    inv.mesDestino || null,
                         motivo: 'Este inventario ya está contabilizado.' };
            }
            if (inv.estado !== 'CERRADO') {
                return { puede: false, motivo: 'Primero hay que cerrar el inventario: solo se contabiliza uno CERRADO.' };
            }
            if (inv.cierreTipo === 'abandonado') {
                return { puede: false, motivo: 'Se cerró como ABANDONADO (quedó abierto de una versión anterior, sin conteos): no hay nada que contabilizar.' };
            }
            // Decisión N-4: FASE 3 opera sobre inventarios cerrados a partir
            // del paso previo, que es cuando semanaId empezó a guardarse en
            // la cabecera. Un inventario anterior se bloquea con un motivo
            // legible en vez de inventarle una semana.
            if (!inv.semanaId) {
                return { puede: false, motivo: 'Este inventario se cerró antes de que se guardara la semana '
                                             + 'en su cabecera, así que no se puede contabilizar.' };
            }
            // Decisión N-1 (FASE 3) ampliada en FASE 13: un recuento fechado
            // en DOMINGO cierra semana; uno fechado en el ÚLTIMO DÍA DEL MES
            // es un corte contable mensual; un domingo que además es fin de
            // mes hace las dos cosas a la vez. Fuera de esas fechas sigue
            // bloqueado: un corte a media semana que no es fin de mes no
            // tiene nada que arrastrar ni que valorizar.
            const clase = (typeof clasificarRecuento === 'function' && inv.fechaRecuento)
                          ? clasificarRecuento(inv.fechaRecuento) : null;
            if (!clase || clase.tipo === 'fuera_de_calendario') {
                return { puede: false, motivo: 'Solo se contabiliza un recuento fechado en DOMINGO (cierre semanal) '
                                             + 'o en el último día del mes (corte mensual). Este está fechado '
                                             + (inv.fechaRecuento || 'sin fecha de recuento')
                                             + ', y un corte a media semana no arrastra ni valoriza nada.' };
            }
            const haceSemanal = !!clase.cierraSemana;
            const haceMensual = !!clase.esCorteMensual;
            const semanaDestino = haceSemanal && typeof semanaSiguiente === 'function'
                                  ? semanaSiguiente(inv.fechaRecuento) : null;
            if (haceSemanal && !semanaDestino) return { puede: false, motivo: 'No se pudo calcular la semana destino.' };
            const mesId = haceMensual ? String(inv.fechaRecuento).slice(0, 7) : null;
            return { puede: true, tipo: clase.tipo, haceSemanal: haceSemanal, haceMensual: haceMensual,
                     semanaDestino: semanaDestino, mesId: mesId };
        }
        window.evaluarContabilizable = evaluarContabilizable;

        async function contabilizarInventario(inventoryId, numero) {
            if (!hasPermission('inventory.post')) {
                showNotification('⚠️ No tienes permiso para contabilizar inventarios');
                return;
            }
            if (!_db)              { showNotification('📴 Sin conexión a Firestore'); return; }
            if (!navigator.onLine) { showNotification('📴 Sin conexión — conecta a internet antes de contabilizar'); return; }

            showNotification('⏳ Preparando la contabilización…');
            const inventoryRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                                    .collection('inventories').doc(inventoryId);
            try {
                const invSnap = await inventoryRef.get();
                if (!invSnap.exists) { showNotification('❌ No se encontró el inventario'); return; }
                const inv = invSnap.data() || {};

                if (inv.estado === 'CONTABILIZADO') {
                    showNotification('ℹ️ Este inventario ya estaba contabilizado'
                        + (inv.semanaDestino ? ' — semana ' + inv.semanaDestino : '')
                        + (inv.mesDestino ? (inv.semanaDestino ? ' · mes ' : ' — mes ') + inv.mesDestino : ''));
                    return;
                }
                if (inv.estado !== 'CERRADO') {
                    showNotification('⚠️ Solo se puede contabilizar un inventario CERRADO');
                    return;
                }

                // ── Semana destino y/o mes de corte ───────────────────────────
                // Semana en cabecera (N-4), domingo y/o fin de mes (N-1,
                // FASE 13): la misma regla que decide si la pantalla ofrece
                // el botón, aplicada aquí al documento recién leído del
                // servidor.
                const ev = evaluarContabilizable(inv);
                if (!ev.puede) {
                    showNotification('⚠️ ' + ev.motivo);
                    return;
                }
                const haceSemanal   = ev.haceSemanal;
                const haceMensual   = ev.haceMensual;
                const semanaDestino = ev.semanaDestino;
                const mesId         = ev.mesId;

                // ── ¿Ya está hecho? ──────────────────────────────────────────
                // Cada destino se comprueba por separado: un domingo-fin-de-
                // mes escribe dos documentos independientes, y uno de los dos
                // pudo haber quedado ya hecho de un intento anterior que
                // falló a medio camino (el batch es atómico, así que en
                // condiciones normales esto no pasa — pero la comprobación no
                // le cuesta nada al caso normal y cubre el caso raro).
                let previoSemana = { existe: false };
                let previoMes    = { existe: false };
                if (haceSemanal) previoSemana = await _verificarInicialExistente(semanaDestino, inventoryId);
                if (haceMensual) previoMes    = await _verificarCorteMensualExistente(mesId, inventoryId);

                const semanaHecha = !haceSemanal || (previoSemana.existe && previoSemana.mismoOrigen);
                const mesHecho    = !haceMensual || (previoMes.existe && previoMes.mismoOrigen);
                if (semanaHecha && mesHecho) {
                    const partes = [];
                    if (haceSemanal) partes.push('el inicial de la semana ' + semanaDestino);
                    if (haceMensual) partes.push('el corte mensual ' + mesId);
                    showNotification('ℹ️ Este inventario ya generó ' + partes.join(' y '));
                    return;
                }
                if (haceSemanal && previoSemana.existe && !previoSemana.mismoOrigen) {
                    showNotification('🛑 La semana ' + semanaDestino + ' ya tiene un inicial generado por el '
                        + 'Inventario Físico #' + (previoSemana.origenNumero || previoSemana.origenId)
                        + '. No se sobrescribe nada.');
                    return;
                }
                if (haceMensual && previoMes.existe && !previoMes.mismoOrigen) {
                    showNotification('🛑 El mes ' + mesId + ' ya tiene un corte contable generado por el '
                        + 'Inventario Físico #' + (previoMes.origenNumero || previoMes.origenId)
                        + '. No se sobrescribe nada.');
                    return;
                }
                // A partir de aquí: lo que faltaba (uno de los dos, o ambos)
                // se puede generar.
                const faltaSemana = haceSemanal && !semanaHecha;
                const faltaMes    = haceMensual && !mesHecho;

                // ── El físico congelado ──────────────────────────────────────
                const registros = await _readChunkedSubcollection(inventoryRef, 'snapshotChunks');
                if (!registros || registros.length === 0) {
                    showNotification('❌ No se encontró el snapshot de este inventario');
                    return;
                }
                const saldos = _saldosDesdeSnapshot(registros);
                if (!saldos.ok) {
                    showNotification('❌ El snapshot no contiene productos — no se puede contabilizar');
                    return;
                }

                let inicial = null, corteMensual = null;
                if (faltaSemana) {
                    inicial = inicialDesdeCierre({
                        fecha:       inv.fechaRecuento,
                        inventoryId: inventoryId,
                        numero:      inv.numero,
                        productos:   saldos.productos
                    });
                    if (!inicial) {
                        showNotification('⚠️ El cierre no arrastra a la semana siguiente (no cierra semana)');
                        return;
                    }
                }
                if (faltaMes) {
                    corteMensual = cierreMensualDesdeSnapshot({
                        fecha:       inv.fechaRecuento,
                        inventoryId: inventoryId,
                        numero:      inv.numero,
                        productos:   saldos.productos
                    });
                    if (!corteMensual) {
                        showNotification('⚠️ El cierre no es un corte de fin de mes');
                        return;
                    }
                }

                const totalUnidades = saldos.productos.reduce(function(a, p) { return a + p.total; }, 0);

                // ── Mensaje de confirmación — solo menciona lo que de verdad se va a escribir ──
                let msg = '📘 CONTABILIZAR INVENTARIO FÍSICO #' + (inv.numero || numero) + '\n\n'
                         + 'Recuento: ' + inv.fechaRecuento + '\n';
                if (faltaSemana) msg += 'Semana destino: ' + inicial.semanaId + '\n';
                if (faltaMes)    msg += 'Corte mensual: '  + corteMensual.mesId + '\n';
                msg += 'Productos: ' + saldos.totalProductos
                     + (saldos.enCero ? '  (' + saldos.enCero + ' en cero)' : '') + '\n'
                     + 'Total de unidades: ' + (Math.round(totalUnidades * 1000) / 1000) + '\n';
                if (saldos.noContados) {
                    msg += '⚠️ ' + saldos.noContados + ' producto(s) sin contar — conservan su stock '
                         + 'operativo actual (suma de las áreas), NO entran con cero.\n';
                }
                if (faltaMes) {
                    msg += 'Valor estimado del corte: '
                         + (corteMensual.productosConPrecio
                             ? (typeof _panelMoneda === 'function' ? _panelMoneda(corteMensual.valorTotal) : ('$' + corteMensual.valorTotal))
                             : 'sin datos de precio')
                         + (corteMensual.productosSinPrecio
                             ? '  (' + corteMensual.productosSinPrecio + ' producto(s) sin precio, no incluidos)'
                             : '')
                         + '\n';
                }
                msg += '\n';
                if (faltaSemana) msg += 'El resultado físico pasará a ser el stock inicial de esa semana.\n';
                if (faltaMes)    msg += 'El corte mensual queda guardado para contabilidad, valorizado en dinero.\n';
                msg += '\nEl inventario cerrado NO se modifica: su conteo queda intacto.\n'
                     + 'Lo que se genere aquí es INMUTABLE — una vez creado no se puede corregir ni deshacer.\n\n'
                     + '¿Confirmar?';

                showConfirm(
                    msg,
                    async function() {
                        showNotification('⏳ Contabilizando…');
                        try {
                            // Un solo batch: o queda todo, o no queda nada —
                            // incluso cuando son dos documentos a la vez.
                            const batch = _db.batch();
                            if (faltaSemana) {
                                const inicialRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                                                      .collection('inventariosIniciales').doc(inicial.semanaId);
                                batch.set(inicialRef, {
                                    semanaId:            inicial.semanaId,
                                    origen:              inicial.origen,
                                    saldos:              inicial.saldos,
                                    totalProductos:      inicial.totalProductos,
                                    productosEnCero:     saldos.enCero,
                                    productosNoContados: inicial.productosNoContados,
                                    areas:               saldos.areas,
                                    contabilizadoPor:    currentUserUid,
                                    contabilizadoEn:     Date.now(),
                                    semanaOrigenDato:    inv.semanaIdOrigen || 'cabecera'
                                });
                            }
                            if (faltaMes) {
                                const corteRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                                                    .collection('cortesMensuales').doc(corteMensual.mesId);
                                batch.set(corteRef, {
                                    mesId:               corteMensual.mesId,
                                    origen:              corteMensual.origen,
                                    saldos:              corteMensual.saldos,
                                    totalProductos:      corteMensual.totalProductos,
                                    productosConPrecio:  corteMensual.productosConPrecio,
                                    productosSinPrecio:  corteMensual.productosSinPrecio,
                                    productosNoContados: corteMensual.productosNoContados,
                                    valorTotal:          corteMensual.valorTotal,
                                    productosEnCero:     saldos.enCero,
                                    areas:               saldos.areas,
                                    contabilizadoPor:    currentUserUid,
                                    contabilizadoEn:     Date.now(),
                                    semanaOrigenDato:    inv.semanaIdOrigen || 'cabecera'
                                });
                            }
                            const estadoUpdate = {
                                estado:           'CONTABILIZADO',
                                contabilizadoEn:  Date.now(),
                                contabilizadoPor: currentUserUid
                            };
                            if (faltaSemana) estadoUpdate.semanaDestino = inicial.semanaId;
                            if (faltaMes)    estadoUpdate.mesDestino    = corteMensual.mesId;
                            batch.update(inventoryRef, estadoUpdate);
                            await batch.commit();

                            _registrarEnSyncQueue({
                                tipo:         'contabilizacion',
                                detalle:      'Inventario Físico #' + (inv.numero || numero) + ' contabilizado'
                                              + (faltaSemana ? ' → inicial de la semana ' + inicial.semanaId : '')
                                              + (faltaMes ? ' → corte mensual ' + corteMensual.mesId : ''),
                                inventoryId:    inventoryId,
                                numero:         inv.numero || numero,
                                semanaOrigen:   (inicial && inicial.origen.semanaCerrada)
                                                || (corteMensual && corteMensual.origen.semanaCerrada) || null,
                                semanaDestino:  faltaSemana ? inicial.semanaId : null,
                                mesDestino:     faltaMes ? corteMensual.mesId : null,
                                totalProductos: saldos.totalProductos,
                                motivo:       'Contabilización de Inventario Físico'
                            });

                            showNotification('✅ Contabilizado'
                                + (faltaSemana ? ' — inicial de la semana ' + inicial.semanaId : '')
                                + (faltaMes ? (faltaSemana ? ' y corte mensual ' : ' — corte mensual ') + corteMensual.mesId : ''));
                            _historialInventarios = null;
                            // El detalle abierto se relee para que diga
                            // "📘 Contabilizado" en vez de seguir ofreciendo el botón.
                            if (typeof _detalleInventarioCerradoData !== 'undefined') _detalleInventarioCerradoData = null;
                            // Si se contabilizó tarde (ya en la semana destino),
                            // el panel tenía guardado "esta semana no tiene
                            // inicial". Se olvida para que lo vuelva a leer.
                            if (typeof existenciaInvalidarInicial === 'function') existenciaInvalidarInicial();
                            renderTab();
                        } catch (err) {
                            // ── El manejo que hace que la idempotencia funcione ──
                            // Un permission-denied aquí NO es necesariamente un
                            // fallo: puede ser que la operación ya se completara
                            // en un intento anterior cuya confirmación se perdió.
                            // Se distingue leyendo cada documento por separado.
                            console.error('[Contabilizar] Error:', err);
                            if (err && err.code === 'permission-denied') {
                                const postSemana = faltaSemana
                                    ? await _verificarInicialExistente(inicial.semanaId, inventoryId)
                                    : { existe: true, mismoOrigen: true };
                                const postMes = faltaMes
                                    ? await _verificarCorteMensualExistente(corteMensual.mesId, inventoryId)
                                    : { existe: true, mismoOrigen: true };
                                const semanaOk = !faltaSemana || (postSemana.existe && postSemana.mismoOrigen);
                                const mesOk    = !faltaMes    || (postMes.existe && postMes.mismoOrigen);
                                if (semanaOk && mesOk) {
                                    showNotification('✅ Ya estaba contabilizado — la operación se había '
                                        + 'completado antes. No se duplicó nada.');
                                    _historialInventarios = null;
                                    if (typeof _detalleInventarioCerradoData !== 'undefined') _detalleInventarioCerradoData = null;
                                    renderTab();
                                    return;
                                }
                                if (faltaSemana && postSemana.existe && !postSemana.mismoOrigen) {
                                    showNotification('🛑 Otro inventario ocupó la semana ' + inicial.semanaId
                                        + ' mientras confirmabas. No se sobrescribió nada.');
                                    return;
                                }
                                if (faltaMes && postMes.existe && !postMes.mismoOrigen) {
                                    showNotification('🛑 Otro inventario ocupó el mes ' + corteMensual.mesId
                                        + ' mientras confirmabas. No se sobrescribió nada.');
                                    return;
                                }
                                showNotification('❌ El servidor rechazó la contabilización — revisa tus permisos');
                                return;
                            }
                            showNotification('❌ No se pudo contabilizar — revisa la conexión e inténtalo de nuevo');
                        }
                    }
                );
            } catch (err) {
                console.error('[Contabilizar] Error preparando:', err);
                showNotification('❌ No se pudo preparar la contabilización — revisa la conexión');
            }
        }
        window.contabilizarInventario = contabilizarInventario;
        window._saldosDesdeSnapshot   = _saldosDesdeSnapshot;

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
        //
        // HOTFIX 4.19 (30/09/2026) — LOS CONTABILIZADOS DESAPARECÍAN.
        // La consulta era where('estado','==','CERRADO'): en cuanto un
        // inventario pasaba a CONTABILIZADO dejaba de cumplirla y se esfumaba
        // del Historial, justo cuando más importa consultarlo. El dato nunca
        // se perdió (inventories/{id} es inmutable y no se borra); lo que
        // fallaba era la lista. Ahora se piden los más recientes por folio y
        // se muestran TODOS los que ya no se cuentan (CERRADO y CONTABILIZADO).
        //
        // Además, igualdad + orderBy sobre otro campo exige un índice
        // compuesto que el emulador no pide y producción sí: si faltaba, la
        // consulta fallaba en silencio y el Historial salía vacío. orderBy
        // sobre un solo campo usa el índice automático: no depende de nada.
        let _historialInventarios = null;      // cache en memoria de la última carga
        let _historialCargando    = false;     // evita dos cargas a la vez
        let _historialHayMas      = false;     // ¿hay inventarios más antiguos?
        let _historialLimite      = 30;        // cuántos mostrar ("Ver más antiguos" suma 30)
        const _HISTORIAL_ESTADOS  = ['CERRADO', 'CONTABILIZADO'];

        async function _cargarHistorialInventarios() {
            // Sin Firestore se marca vacío (no null): si se quedara en null,
            // renderHistorialInventarios lo volvería a pedir en cada repintado.
            if (!_db) { _historialInventarios = []; _historialHayMas = false; return []; }
            _historialCargando = true;
            try {
                // +5: el inventario abierto (y algún huérfano de versiones
                // anteriores) ocupan lugar en la consulta y se descartan abajo.
                const snap = await _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                                       .collection('inventories')
                                       .orderBy('numero', 'desc')
                                       .limit(_historialLimite + 5)
                                       .get();
                const terminados = snap.docs.map(function(d) {
                    const x = d.data() || {};
                    if (!x.inventoryId) x.inventoryId = d.id;
                    return x;
                }).filter(function(x) { return _HISTORIAL_ESTADOS.indexOf(x.estado) !== -1; });
                _historialHayMas = snap.size >= _historialLimite + 5 || terminados.length > _historialLimite;
                _historialInventarios = terminados.slice(0, _historialLimite);
                return _historialInventarios;
            } catch (err) {
                console.warn('[InventarioFisico] Error cargando historial:', err);
                if (_historialInventarios === null) _historialInventarios = [];
                return _historialInventarios;
            } finally {
                _historialCargando = false;
            }
        }
        window._cargarHistorialInventarios = _cargarHistorialInventarios;

        // Cualquier pantalla que invalide el historial (contabilizar, cerrar)
        // lo pone en null; esta función lo vuelve a pedir una sola vez y
        // repinta. Antes, volver al Historial después de contabilizar se
        // quedaba para siempre en "⏳ Cargando historial…".
        function _asegurarHistorialCargado() {
            if (_historialInventarios !== null || _historialCargando) return;
            _cargarHistorialInventarios().then(function() { renderTab(); });
        }
        function historialVerMas() {
            _historialLimite += 30;
            _historialInventarios = null;
            renderTab();
        }
        window.historialVerMas = historialVerMas;


        function auditoriaEntrarArea(area) {
            // ETAPA 15: un Inventario Físico CERRADO es de solo lectura — nadie
            // puede volver a entrar a contar, ni siquiera el admin. La Rule de
            // Firestore ya lo protege a nivel de datos (inventories/{id}
            // inmutable); este chequeo evita además que la UI intente
            // siquiera ofrecer la acción.
            if (_inventarioActivo && !inventarioAbierto(_inventarioActivo)) {
                showNotification('🔒 Este Inventario Físico está ' + (_inventarioActivo.estado || 'CERRADO') + ' — solo lectura');
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

        // ── ¿Hay un Inventario Físico ABIERTO según el servidor? ─────────────
        //  Lee la sesión vigente del documento principal y su inventario, SIEMPRE
        //  del servidor (source: 'server'): la caché local es justo lo que puede
        //  ir desfasado. Dos lecturas, solo al crear un inventario (una vez por
        //  semana), así que el coste es despreciable frente a lo que protege.
        //  @returns { abierto, sesion?, numero?, estado? } | { error: true }
        async function _inventarioAbiertoEnServidor() {
            try {
                const raiz = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID);
                const principal = await raiz.get({ source: 'server' });
                const sesion = principal.exists ? (principal.data() || {})._auditoriaSessionId : null;
                const inv = sesion ? await raiz.collection('inventories').doc(String(sesion)).get({ source: 'server' }) : null;
                const d = (inv && inv.exists) ? (inv.data() || {}) : {};
                if (inv && inv.exists && inventarioAbierto(d)) {
                    return { abierto: true, sesion: String(sesion), numero: d.numero || null, estado: d.estado || null };
                }
                // FASE 12 — además de la sesión vigente, CUALQUIER inventario
                // activo bloquea: si alguna vez quedó uno huérfano (versiones
                // anteriores, sin la regla del servidor), no se crea otro
                // encima. Consulta de un solo campo: no necesita índice.
                const activos = await raiz.collection('inventories').where('estado', '==', 'SINCRONIZADO').limit(1).get({ source: 'server' });
                if (!activos.empty) {
                    const otro = activos.docs[0];
                    // Si no es el de la sesión vigente, es un HUÉRFANO de una
                    // versión anterior: su "Cerrar" normal no lo alcanza.
                    return { abierto: true, sesion: otro.id, numero: (otro.data() || {}).numero || null, estado: 'SINCRONIZADO',
                             huerfano: String(otro.id) !== String(sesion || '') };
                }
                return { abierto: false, sesion: sesion ? String(sesion) : null, numero: d.numero || null, estado: d.estado || null };
            } catch (e) {
                console.warn('[InventarioFisico] No se pudo comprobar el inventario vigente en el servidor:', e);
                return { error: true };
            }
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
            if (inventarioAbierto(_inventarioActivo)) {
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

                            // ── GUARDA DE SERVIDOR (sep 2026) ────────────────────
                            // Lo que sigue BORRA los conteos de todos los usuarios
                            // de la sesión actual. La única protección era
                            // `inventarioAbierto(_inventarioActivo)`, una variable en
                            // memoria — y esa variable se quedaba en null tras
                            // reabrir la app (ver handleAuditSessionChange). Con un
                            // inventario ABIERTO y contado, la pantalla ofrecía
                            // "Crear" y esta función lo habría vaciado sin cerrarlo
                            // ni congelarlo. Por el formulario de R7, además, sin
                            // pasar por los dos avisos de arriba.
                            //
                            // Una acción que destruye datos no se decide con lo que
                            // la pantalla cree: se pregunta al servidor. Si no se
                            // puede preguntar, no se borra nada.
                            const vigente = await _inventarioAbiertoEnServidor();
                            if (vigente.error) {
                                _auditoriaCreandoEnProgreso = false;
                                _opcionesNuevoInventario = null;
                                showNotification('📴 No se pudo comprobar en el servidor si hay un inventario abierto. '
                                    + 'No se borró nada — revisa la conexión e inténtalo de nuevo.');
                                return;
                            }
                            if (vigente.abierto) {
                                _auditoriaCreandoEnProgreso = false;
                                _opcionesNuevoInventario = null;
                                showNotification(vigente.huerfano
                                    ? ('🛑 El Inventario Físico #' + (vigente.numero || '—') + ' quedó ABIERTO de una versión anterior '
                                       + 'y no pertenece a la sesión actual. En Conteo aparece "Cerrar inventario abandonado": '
                                       + 'ciérralo y después crea el nuevo. No se borró nada.')
                                    : ('🛑 El Inventario Físico #' + (vigente.numero || '—')
                                       + ' sigue ABIERTO, con sus conteos. Para empezar de cero: primero "Cerrar Inventario Físico" '
                                       + '(al final de la pantalla de Conteo) y después "Crear". No se borró nada.'));
                                // Y se engancha a ese inventario, para que la
                                // pantalla deje de decir que no hay ninguno.
                                if (typeof _suscribirInventarioActivo === 'function') _suscribirInventarioActivo(vigente.sesion);
                                renderTab();
                                return;
                            }

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
                                // FASE 12 — el inventario recién creado se muestra en la
                                // PRIMERA pantalla de Conteo, venga de donde venga la
                                // creación (Historial, "Crear el siguiente", Inicio).
                                if (typeof switchTab === 'function') switchTab('inventario');
                                else activeTab = 'inventario';
                                saveToLocalStorage();
                                renderTab();

                                // FIX P0.1: la limpieza de la colección LEGACY conteoMultiUsuario
                                // (usada por renderAuditComparePanel(), ver comentarios en
                                // resetConteoMultiUsuarioEnFirestore) se trata como paso
                                // SECUNDARIO y NO bloqueante: la sesión de auditoría ya
                                // quedó confirmada en Firestore aunque este paso falle, así
                                // que NO se revierte la sesión por un fallo aquí. Si falla,
                                // se avisa honestamente (nunca se muestra un "✅" que
                                // implique éxito total) y queda marcado para reintento.
                                //
                                // FASE 8C (26/09/2026): esta llamada limpiaba también
                                // conteoAreas/dispositivos. Esa colección dejó de escribirse
                                // (ver js/40-firestore.js) así que ya no hace falta borrarla
                                // aquí — la función se renombró a
                                // resetConteoMultiUsuarioEnFirestore() para reflejar su
                                // alcance real.
                                try {
                                    await resetConteoMultiUsuarioEnFirestore();
                                    try { localStorage.removeItem('inventarioApp_legacyCleanupPending'); } catch(_) {}
                                    showNotification('✅ Inventario Físico #' + numeroInventario + ' iniciado — todos los conteos en ceros');
                                } catch (errLegacy) {
                                    console.error('[AuditReset] Sesión ' + newSessionId + ' confirmada en Firestore, pero falló la limpieza de conteoMultiUsuario:', errLegacy);
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
        // FASE 6 — La puntuación difusa que vivía aquí pasó al motor unificado
        // (js/05-busqueda-motor.js) y la barra a js/06-busqueda-ui.js. Estas
        // tres funciones quedan como puentes con el nombre de siempre.

        /** @deprecated usar el motor: devuelve > 0 si el producto coincide. */
        function _csFuzzyMatch(product, query) {
            if (!query) return 1;
            return _motorProductos.buscar([product], query).coincidencias;
        }

        /** @deprecated usar resaltarBusqueda(): ya escapa y entiende acentos. */
        function highlightConteoMatch(name, query) {
            return resaltarBusqueda(name, query);
        }

        function updateConteoSearch(val) {
            BusquedaUI.establecer('conteo', val);
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

        let _saltarAvisoContabilizar = false;

        function abrirModalNuevoInventario() {
            if (!isAdmin() || !hasPermission('inventory.create')) {
                showNotification('⚠️ Solo el administrador puede crear un Inventario Físico');
                return;
            }
            if (inventarioAbierto(_inventarioActivo)) {
                showNotification('🔒 Cierra el Inventario Físico #' + _inventarioActivo.numero + ' antes de crear otro');
                return;
            }
            if (!navigator.onLine) {
                showNotification('📴 Sin conexión — el número de inventario se pide al servidor');
                return;
            }
            // El inventario cerrado cierra semana y todavía no se contabilizó.
            // Crear el siguiente no lo impide (se puede contabilizar después
            // desde Historial), pero lo saca del encabezado de Conteo, que es
            // donde está el botón. Se pregunta una vez, no se bloquea.
            // (evaluarContabilizable solo dice "puede" de un CERRADO que cierra
            // semana, así que un CONTABILIZADO no pasa por aquí.)
            if (!_saltarAvisoContabilizar && _inventarioActivo
                && hasPermission('inventory.post') && evaluarContabilizable(_inventarioActivo).puede) {
                showConfirm('📘 El Inventario Físico #' + (_inventarioActivo.numero || '—') + ' cierra semana '
                    + 'y todavía NO está contabilizado.\n\n'
                    + 'Si creas el siguiente ahora, lo podrás contabilizar después desde Historial.\n\n'
                    + '¿Crear el siguiente de todos modos?',
                    function() {
                        _saltarAvisoContabilizar = true;
                        try { abrirModalNuevoInventario(); }
                        finally { _saltarAvisoContabilizar = false; }
                    });
                return;
            }

            // H-40 (hotfix 4.9): 'hoy' casi nunca sirve — solo domingo o fin de
            // mes cierran algo. Proponer 'hoy' llevaba a crear inventarios que
            // después nunca se podían contabilizar, sin que nadie lo notara
            // hasta el momento de cerrar. Se propone la próxima fecha válida.
            var hoy = (typeof proximaFechaRecuentoValida === 'function')
                      ? proximaFechaRecuentoValida(new Date())
                      : ((typeof fechaISOLocal === 'function') ? fechaISOLocal(new Date())
                                                                : new Date().toISOString().slice(0, 10));

            var cont = document.getElementById('nuevoInvAreas');
            if (cont) {
                cont.innerHTML = areasDefinidas().map(function(a) {
                    // FASE 10B — cada área es una fila de 56 px que se marca
                    // tocándola completa, no solo la casilla.
                    // REDISEÑO R7 — este checklist era el único lugar que pintaba
                    // el icono de área con el emoji configurable (a.icono) en vez
                    // del icono real del kit (areasAuditoriaFA), que es lo que ya
                    // usan las otras dos pantallas que muestran estas mismas áreas
                    // (js/85-ui-inventario-fisico.js líneas 665 y 1111).
                    return '<label class="ni-area">'
                         + '<input type="checkbox" class="nuevoInvArea" value="' + escapeHtml(a.id) + '" checked>'
                         + '<span><i class="' + (areasAuditoriaFA[a.id] || 'fa-solid fa-location-dot') + '" aria-hidden="true"></i> ' + escapeHtml(a.nombre) + '</span>'
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
         * H-40 (hotfix 4.9): antes solo avisaba de color; un inventario podía
         * crearse con cualquier fecha y quedar, tras cerrarlo, sin ninguna vía
         * para contabilizarse (evaluarContabilizable lo rechaza para siempre).
         * Ahora, si la fecha no cierra semana ni es corte de mes, se BLOQUEA
         * la creación: se explica por qué y se deshabilita 'Crear inventario'.
         * Un corte de fin de mes entre semana sigue permitido (no cierra
         * semana, pero sirve de corte contable — evaluarContabilizable lo
         * distingue igual que antes).
         */
        function _pintarAvisoFechaNuevoInv() {
            var el  = document.getElementById('nuevoInvAvisoFecha');
            var f   = document.getElementById('nuevoInvFecha');
            var btn = document.getElementById('nuevoInvBtnCrear');
            if (!el || !f || typeof clasificarRecuento !== 'function') return;
            var cl = clasificarRecuento(f.value);

            if (!cl) {
                el.style.color = 'var(--red)';
                el.textContent = 'Elige una fecha válida.';
                if (btn) btn.disabled = true;
                return;
            }

            var semana = (typeof etiquetaSemana === 'function') ? etiquetaSemana(f.value) : cl.semanaId;
            if (cl.cierraSemana) {
                el.style.color = 'var(--ok)';
                el.textContent = 'Domingo — cierra la ' + semana +
                                 (cl.esCorteMensual ? ' y además es corte de fin de mes.' : '.');
                if (btn) btn.disabled = false;
            } else if (cl.esCorteMensual) {
                el.style.color = 'var(--amber)';
                el.textContent = 'Corte de fin de mes. No cierra semana — el inicial del lunes seguirá saliendo '
                                + 'del domingo, pero este corte sí se podrá contabilizar como corte mensual.';
                if (btn) btn.disabled = false;
            } else {
                el.style.color = 'var(--red)';
                // textContent, no innerHTML: no hace falta escapeHtml aquí.
                el.textContent = f.value + ' no es domingo ni fin de mes. Un inventario con esta fecha '
                                + 'no se podrá contabilizar nunca. Elige un domingo (por ejemplo, ' + semana
                                + ') o el último día del mes.';
                if (btn) btn.disabled = true;
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
            // Defensa en profundidad: _pintarAvisoFechaNuevoInv ya deshabilita
            // el botón, pero esto es lo que de verdad decide si se crea.
            var _cl = (typeof clasificarRecuento === 'function') ? clasificarRecuento(fecha) : null;
            if (!_cl || (!_cl.cierraSemana && !_cl.esCorteMensual)) {
                showNotification('⚠️ Esa fecha no es domingo ni fin de mes — elige una de esas para poder '
                    + 'contabilizar este inventario después');
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

        // ══════════════════════════════════════════════════════════════════════
        //  H-40 (hotfix 4.9) — REGISTRAR FECHA DE RECUENTO EN UN INVENTARIO
        //  ANTIGUO SIN ESE CAMPO
        //  ────────────────────────────────────────────────────────────────────
        //  Los inventarios creados antes de R7/FASE 3 no tienen fechaRecuento
        //  ni semanaId. Sin ellos, evaluarContabilizable() los rechaza para
        //  siempre en cuanto se cierran — no hay forma de arreglarlo después.
        //  Esto deja completar esos dos campos UNA sola vez, mientras el
        //  inventario sigue abierto (nunca sobre uno CERRADO/CONTABILIZADO:
        //  eso violaría la inmutabilidad de FASE 7). Las reglas de Firestore
        //  ya permiten esta escritura (admin + estado != CERRADO/CONTABILIZADO,
        //  ver inventories/{id}), así que no hace falta tocarlas.
        // ══════════════════════════════════════════════════════════════════════

        function abrirModalRegistrarFechaRecuento() {
            if (!isAdmin() || !hasPermission('inventory.create')) {
                showNotification('⚠️ Solo el administrador puede registrar la fecha de recuento');
                return;
            }
            if (!_inventarioActivo || !inventarioAbierto(_inventarioActivo)) {
                showNotification('⚠️ No hay un inventario abierto al que registrarle la fecha');
                return;
            }
            if (_inventarioActivo.fechaRecuento) {
                showNotification('ℹ️ Este inventario ya tiene fecha de recuento registrada');
                return;
            }
            var f = document.getElementById('regFechaRecuentoInput');
            if (f) {
                f.value = (typeof proximaFechaRecuentoValida === 'function')
                          ? proximaFechaRecuentoValida(new Date()) : '';
            }
            _pintarAvisoFechaRegistrar();
            var m = document.getElementById('regFechaRecuentoModal');
            if (m) { m.classList.remove('hidden'); document.body.classList.add('modal-open'); }
        }

        function cerrarModalRegistrarFechaRecuento() {
            var m = document.getElementById('regFechaRecuentoModal');
            if (m) { m.classList.add('hidden'); document.body.classList.remove('modal-open'); }
        }

        function _pintarAvisoFechaRegistrar() {
            var el  = document.getElementById('regFechaRecuentoAviso');
            var f   = document.getElementById('regFechaRecuentoInput');
            var btn = document.getElementById('regFechaRecuentoBtnGuardar');
            if (!el || !f || typeof clasificarRecuento !== 'function') return;
            var cl = clasificarRecuento(f.value);
            if (!cl || (!cl.cierraSemana && !cl.esCorteMensual)) {
                el.style.color = 'var(--red)';
                el.textContent = 'Debe ser domingo o fin de mes — si no, este inventario tampoco podrá '
                                + 'contabilizarse después.';
                if (btn) btn.disabled = true;
                return;
            }
            el.style.color = 'var(--ok)';
            el.textContent = cl.cierraSemana ? 'Domingo — cierra semana.' : 'Corte de fin de mes.';
            if (btn) btn.disabled = false;
        }

        async function confirmarRegistrarFechaRecuento() {
            if (!isAdmin() || !hasPermission('inventory.create')) return;
            if (!_db) { showNotification('📴 Sin conexión a Firestore'); return; }

            var f     = document.getElementById('regFechaRecuentoInput');
            var fecha = f ? f.value : '';
            var cl    = (typeof clasificarRecuento === 'function') ? clasificarRecuento(fecha) : null;
            if (!cl || (!cl.cierraSemana && !cl.esCorteMensual)) {
                showNotification('⚠️ Elige domingo o fin de mes');
                return;
            }
            var invId = _inventarioActivoId;
            if (!invId) { showNotification('❌ No se encontró el inventario activo'); return; }

            showNotification('⏳ Guardando…');
            try {
                var ref  = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                              .collection('inventories').doc(invId);
                // Se relee del servidor: entre abrir el modal y pulsar Guardar
                // pudo haberse cerrado el inventario, o (dos admins a la vez)
                // ya haberle puesto fecha. No se confía en el estado en memoria
                // para decidir si se escribe.
                var snap = await ref.get();
                if (!snap.exists) { showNotification('❌ No se encontró el inventario'); return; }
                var inv = snap.data() || {};
                if (inv.fechaRecuento) {
                    showNotification('ℹ️ Ya tenía una fecha registrada — no se cambió nada');
                    cerrarModalRegistrarFechaRecuento();
                    return;
                }
                if (!inventarioAbierto(inv)) {
                    showNotification('⚠️ Este inventario ya no está abierto — no se puede registrar aquí');
                    cerrarModalRegistrarFechaRecuento();
                    return;
                }
                await ref.update({ fechaRecuento: fecha, semanaId: cl.semanaId });
                showNotification('✅ Fecha de recuento registrada: ' + fecha);
                cerrarModalRegistrarFechaRecuento();
            } catch (e) {
                console.error('confirmarRegistrarFechaRecuento', e);
                showNotification('❌ No se pudo guardar: ' + (e && e.message ? e.message : e));
            }
        }

        // ── Glosario y tarjeta de estado ──────────────────────────────────────

        //  REDISEÑO R2 — este diccionario llevaba sus propios colores fijos
        //  (#60a5fa, #4ade80, #818cf8) y dibujaba su propia píldora, en
        //  paralelo a los badges del resto de la app: era uno de los sitios
        //  donde el MISMO estado se veía distinto según la pantalla.
        //  Ahora el color y la palabra los decide UI.ESTADOS (js/03-ui-kit.js)
        //  y aquí solo queda lo que es propio de este glosario: la explicación
        //  de qué significa cada estado, que no vive en ningún otro lado.
        const ESTADOS_INVENTARIO = {
            SINCRONIZADO: {
                estadoKit: 'sincronizado',
                texto: 'Conteo en curso. El stock todavía no se ha afectado.'
            },
            CERRADO: {
                estadoKit: 'cerrado',
                texto: 'Cerrado e inmutable. Queda como histórico y nadie puede modificarlo, ni el administrador.'
            },
            // FASE 3 — el estado nuevo TAMBIÉN va aquí. Sin esta entrada el
            // historial mostraba "CONTABILIZADO" y el glosario seguía
            // explicando solo dos estados: la pantalla decía una cosa y la
            // ayuda otra. Lo detectó la comprobación de alcance de R7.
            CONTABILIZADO: {
                estadoKit: 'contabilizado',
                texto: 'Su resultado ya es el stock inicial de la semana siguiente. Además de inmutable, no se puede volver a contabilizar.'
            }
        };

        function _pillEstadoInventario(estado) {
            var e = ESTADOS_INVENTARIO[estado];
            if (typeof UI !== 'undefined' && UI.badge) {
                // Un estado que no esté en el glosario se muestra tal cual
                // llegó, en gris: no se le inventa un color.
                return e ? UI.badge(e.estadoKit)
                         : UI.badge({ texto: estado || '—', tono: 'neutral', vivo: false });
            }
            return '<span class="bi-badge bi-badge--neutral">' + escapeHtml(estado || '—') + '</span>';
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
