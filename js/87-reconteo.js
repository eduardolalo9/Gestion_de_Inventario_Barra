        // ═════════════════════════════════════════════════════════════════════
        //  RECONTEO — segunda revisión de productos dudosos ANTES del cierre
        //  ───────────────────────────────────────────────────────────────────
        //  Decisiones de negocio (autorizadas por el dueño, sep 2026):
        //    · El reconteo solo existe mientras el Inventario Físico está
        //      SINCRONIZADO. Un inventario CERRADO es inmutable por diseño y
        //      así sigue: el reconteo no abre ninguna puerta nueva sobre él.
        //    · Solo el administrador reconta. Ver lo que ya se contó rompe el
        //      conteo ciego, y el conteo del administrador ya es la autoridad
        //      en la consolidación (_recalcAdminAggregatedConteo): su
        //      corrección gana sin inventar una regla de prioridad nueva.
        //
        //  Flujo:
        //    1. Se agregan productos a mano con el buscador.
        //    2. Cada tarjeta muestra lo contado en cada almacén y el total.
        //       Tocar un almacén abre el MISMO modal de conteo de siempre
        //       (botella/oz o cantidad con decimales), precargado con ese
        //       almacén, y la corrección queda ANOTADA en el borrador.
        //    3. "Finalizar reconteo" aplica todas las correcciones de una vez:
        //       pasan al conteo propio del administrador (myAuditoriaConteo),
        //       que viaja por la misma sincronización probada de siempre
        //       (syncMyAuditoriaToFirestore). Nada se aplica antes.
        //    4. El registro queda como histórico (fecha, quién reconta, antes →
        //       después por almacén) y puede reabrirse para una segunda ronda
        //       mientras el inventario siga abierto.
        //
        //  Integridad (premisa "cero pérdida de datos"):
        //    · El borrador vive en el dispositivo (localStorage) ANTES de subir;
        //      la subida a Firestore es de mejor esfuerzo y no bloquea.
        //    · Finalizar exige conexión: las correcciones tienen que estar en el
        //      servidor antes de que alguien cierre el inventario, o el cierre
        //      congelaría los valores viejos.
        //    · Cerrar el inventario con un reconteo abierto queda bloqueado
        //      (ver _hayReconteoAbierto, usado por cerrarInventarioFisico).
        //    · Todas las acciones van por delegación de eventos con atributos
        //      data-*; ningún id de producto se interpola dentro de un onclick.
        // ═════════════════════════════════════════════════════════════════════

        var RECONTEO_LS            = 'inventarioApp_reconteoBorrador';
        var RECONTEO_MAX_PRODUCTOS = 300;     // mismo tope que valida firestore.rules
        var RECONTEO_RESULTADOS    = 8;       // filas del buscador para agregar

        var _reconteoActivo        = null;    // registro en edición (abierto)
        var _reconteoEdicion       = null;    // { prodId, area } mientras el modal edita un almacén
        var _reconteoLista         = null;    // histórico cargado bajo demanda
        var _reconteoListaCargando = false;
        var _reconteoDetalleId     = null;
        var _reconteoDetalle       = null;
        var _reconteoSubidaTimer   = null;
        var _reconteoAvisoRechazo  = false;
        var _reconteoSearchTerm    = '';
        var _reconteoOcupado       = false;   // evita doble toque en finalizar/reabrir

        // ── Utilidades ───────────────────────────────────────────────────────

        function _rcColeccion() {
            return _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID).collection('reconteos');
        }

        function _rcPuede() {
            return typeof isAdmin === 'function' && isAdmin();
        }

        function _rcInventarioAbierto() {
            return !!(_inventarioActivo && _inventarioActivo.estado === 'SINCRONIZADO' && _auditoriaSessionId);
        }

        function _rcNombreSesion() {
            var n = (typeof auditCurrentUser !== 'undefined' && auditCurrentUser && auditCurrentUser.userName) || '';
            if (!n && typeof _auth !== 'undefined' && _auth && _auth.currentUser) {
                n = _auth.currentUser.displayName || _auth.currentUser.email || '';
            }
            return String(n || '').trim().slice(0, 60);
        }

        function _rcEmail() {
            return (typeof _auth !== 'undefined' && _auth && _auth.currentUser && _auth.currentUser.email) || currentUserUid || '';
        }

        function _rcAreas() {
            return (typeof AREAS_CONTEO !== 'undefined' && AREAS_CONTEO.length) ? AREAS_CONTEO.slice() : ['almacen', 'barra1', 'barra2'];
        }

        function _rcEtiquetaArea(a) {
            if (typeof areasAuditoria !== 'undefined' && areasAuditoria && areasAuditoria[a]) return areasAuditoria[a];
            if (typeof areas !== 'undefined' && areas && areas[a]) return areas[a];
            return a;
        }

        function _rcCopia(reg) {
            return {
                enteras:  (reg && typeof reg.enteras === 'number') ? reg.enteras : 0,
                abiertas: (reg && Array.isArray(reg.abiertas)) ? reg.abiertas.slice() : []
            };
        }

        // Valor OFICIAL vigente de un producto/almacén: la consolidación que el
        // administrador ya ve en el conteo (auditoriaConteo). null = sin contar.
        function _rcOficial(pid, area) {
            var d = (typeof auditoriaConteo !== 'undefined') && auditoriaConteo[pid] && auditoriaConteo[pid][area];
            if (!d) return null;
            var tieneAlgo = (d.enteras || 0) > 0 || (d.abiertas || []).some(function(v) { return v > 0; });
            return tieneAlgo ? _rcCopia(d) : null;
        }

        function _rcProducto(pid) {
            return products.find(function(p) { return p.id === pid; }) || null;
        }

        function _rcUsaBotella(p) {
            return !!(p && typeof tieneConversion === 'function' && tieneConversion(p));
        }

        // Total de un registro {enteras, abiertas} con la MISMA regla del
        // conteo: en modo botella las abiertas se convierten de oz a fracción.
        function _rcTotal(p, reg) {
            if (!reg) return 0;
            var t = reg.enteras || 0;
            var botella = _rcUsaBotella(p);
            (reg.abiertas || []).forEach(function(v) {
                t += botella ? convertirOzAPuntos(v, p.capacidadMl, p.pesoBotellaLlenaOz) : (v || 0);
            });
            return Math.round(t * 1000) / 1000;
        }

        function _rcFmt(p, n) {
            return _rcUsaBotella(p) ? Number(n).toFixed(2) : String(Math.round(n * 1000) / 1000);
        }

        function _rcDesglose(p, reg) {
            if (!reg) return 'sin contar';
            if (_rcUsaBotella(p)) {
                var ab = (reg.abiertas || []).filter(function(v) { return v > 0; });
                return (reg.enteras || 0) + ' ent' + (ab.length ? ' · ' + ab.length + ' ab' : '');
            }
            return (p && p.unit) ? String(p.unit) : '';
        }

        function _rcIgual(a, b) {
            var x = _rcCopia(a), y = _rcCopia(b);
            if (x.enteras !== y.enteras) return false;
            var ax = x.abiertas.filter(function(v) { return v > 0; });
            var ay = y.abiertas.filter(function(v) { return v > 0; });
            if (ax.length !== ay.length) return false;
            for (var i = 0; i < ax.length; i++) if (ax[i] !== ay[i]) return false;
            return true;
        }

        function _rcFecha(ts) {
            if (!ts) return '—';
            var d = new Date(ts);
            return d.toLocaleDateString('es-MX') + ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        }

        function _rcNCorr(n) { return n + (n === 1 ? ' corrección' : ' correcciones'); }

        function _rcCorrecciones(r) {
            var n = 0;
            if (!r || !r.items) return 0;
            Object.keys(r.items).forEach(function(pid) {
                var ar = r.items[pid].areas || {};
                Object.keys(ar).forEach(function(a) { if (ar[a] && ar[a].despues) n++; });
            });
            return n;
        }

        // ── Registro: creación, borrador local y subida ──────────────────────

        function _rcNuevo() {
            var now = Date.now();
            return {
                id:               _rcColeccion().doc().id,
                inventoryId:      _auditoriaSessionId,
                inventarioNumero: (_inventarioActivo && typeof _inventarioActivo.numero === 'number') ? _inventarioActivo.numero : null,
                estado:           'abierto',
                ronda:            1,
                recontadoPor:     _rcNombreSesion(),
                creadoPorUid:     currentUserUid,
                creadoPorEmail:   _rcEmail(),
                creadoEn:         now,
                actualizadoEn:    now,
                finalizadoEn:     null,
                finalizadoPorUid: null,
                rondas:           [],
                orden:            [],
                items:            {}
            };
        }

        // Forma EXACTA que valida firestore.rules (hasOnly). El id no viaja
        // dentro del documento: es la ruta.
        function _rcDocParaNube(r) {
            return {
                inventoryId:      r.inventoryId,
                inventarioNumero: (typeof r.inventarioNumero === 'number') ? r.inventarioNumero : null,
                estado:           r.estado,
                ronda:            r.ronda,
                recontadoPor:     String(r.recontadoPor || '').slice(0, 60),
                creadoPorUid:     r.creadoPorUid,
                creadoPorEmail:   r.creadoPorEmail || '',
                creadoEn:         r.creadoEn,
                actualizadoEn:    r.actualizadoEn,
                finalizadoEn:     (typeof r.finalizadoEn === 'number') ? r.finalizadoEn : null,
                finalizadoPorUid: r.finalizadoPorUid || null,
                rondas:           r.rondas || [],
                orden:            r.orden || [],
                items:            r.items || {}
            };
        }

        function _rcDesdeNube(id, d) {
            var r = Object.assign({}, d);
            r.id = id;
            r.rondas = Array.isArray(d.rondas) ? d.rondas : [];
            r.orden  = Array.isArray(d.orden) ? d.orden : Object.keys(d.items || {});
            r.items  = d.items || {};
            return r;
        }

        function _rcLeerBorrador() {
            try {
                var raw = localStorage.getItem(RECONTEO_LS);
                if (!raw) return null;
                var b = JSON.parse(raw);
                return (b && b.id && b.inventoryId) ? b : null;
            } catch (_) { return null; }
        }

        function _rcGuardarBorrador() {
            try {
                if (_reconteoActivo) localStorage.setItem(RECONTEO_LS, JSON.stringify(_reconteoActivo));
                else localStorage.removeItem(RECONTEO_LS);
            } catch (_) { /* sin almacenamiento: queda en memoria y en la nube */ }
        }

        // Cada cambio: primero el dispositivo, después la nube (debounce). Un
        // registro sin productos no se sube: no hay nada que proteger y
        // bloquearía el cierre sin motivo.
        function _rcTocar() {
            if (!_reconteoActivo) return;
            _reconteoActivo.actualizadoEn = Date.now();
            _rcGuardarBorrador();
            clearTimeout(_reconteoSubidaTimer);
            if (!_reconteoActivo.orden.length) return;
            _reconteoSubidaTimer = setTimeout(function() { _rcSubir(_reconteoActivo); }, 1200);
        }

        function _rcSubir(r) {
            if (!r || !_db) return Promise.resolve(false);
            return _rcColeccion().doc(r.id).set(_rcDocParaNube(r)).then(function() {
                _reconteoAvisoRechazo = false;
                return true;
            }).catch(function(err) {
                console.warn('[Reconteo] No se pudo subir el borrador:', err);
                if (!_reconteoAvisoRechazo && err && err.code === 'permission-denied') {
                    _reconteoAvisoRechazo = true;
                    showNotification('⚠️ El servidor rechazó el reconteo: el inventario ya no está abierto');
                }
                return false;
            });
        }

        async function _rcBuscarAbiertoEnNube(inventoryId) {
            if (!_db) return null;
            try {
                var snap = await _rcColeccion()
                    .where('inventoryId', '==', inventoryId)
                    .where('estado', '==', 'abierto')
                    .limit(5).get();
                var mejor = null;
                snap.forEach(function(doc) {
                    var r = _rcDesdeNube(doc.id, doc.data());
                    if (!mejor || (r.actualizadoEn || 0) > (mejor.actualizadoEn || 0)) mejor = r;
                });
                return mejor;
            } catch (e) {
                console.warn('[Reconteo] No se pudo consultar reconteos abiertos:', e);
                return null;
            }
        }

        /**
         * ¿Hay un reconteo abierto (con productos) en este inventario? La usa
         * cerrarInventarioFisico(): cerrar con un reconteo sin finalizar
         * congelaría los valores anteriores a las correcciones.
         */
        async function _hayReconteoAbierto(inventoryId) {
            if (!inventoryId) return false;
            if (_reconteoActivo && _reconteoActivo.inventoryId === inventoryId &&
                _reconteoActivo.estado === 'abierto' && _reconteoActivo.orden.length > 0) return true;
            var nube = await _rcBuscarAbiertoEnNube(inventoryId);
            return !!(nube && (nube.orden || []).length > 0);
        }

        // ── Entrada a la pantalla ────────────────────────────────────────────

        async function reconteoIniciar() {
            if (!_rcPuede()) { showNotification('⚠️ Solo el administrador puede hacer reconteo'); return; }
            if (!_db) { showNotification('⚠️ Sin conexión con la base de datos'); return; }
            if (!_rcInventarioAbierto()) {
                showNotification('⚠️ El reconteo solo es posible con un Inventario Físico abierto');
                return;
            }
            var inv = _auditoriaSessionId;
            if (!(_reconteoActivo && _reconteoActivo.inventoryId === inv && _reconteoActivo.estado === 'abierto')) {
                var local = _rcLeerBorrador();
                if (local && (local.inventoryId !== inv || local.estado !== 'abierto')) {
                    // Borrador de otro inventario: ya no aplica. No se sube a
                    // ninguna parte; solo deja de estar en el dispositivo.
                    local = null;
                    try { localStorage.removeItem(RECONTEO_LS); } catch (_) {}
                }
                var nube = await _rcBuscarAbiertoEnNube(inv);
                // Si hay copia local y en la nube, gana la más reciente: pudo
                // editarse en otro aparato del administrador.
                if (local && nube) {
                    _reconteoActivo = (local.actualizadoEn || 0) >= (nube.actualizadoEn || 0) ? local : nube;
                } else {
                    _reconteoActivo = local || nube || _rcNuevo();
                }
                _rcGuardarBorrador();
            }
            auditoriaView = 'reconteo';
            renderTab();
        }

        // Retoma un registro ABIERTO concreto desde el histórico (por ejemplo,
        // uno que quedó abierto en otro aparato), para finalizarlo o
        // descartarlo y que deje de bloquear el cierre.
        function reconteoContinuar(id) {
            var r = (_reconteoDetalle && _reconteoDetalle.id === id) ? _reconteoDetalle : null;
            if (!_rcPuede() || !r || r.estado !== 'abierto') return;
            if (!_rcInventarioAbierto() || r.inventoryId !== _auditoriaSessionId) {
                showNotification('⚠️ Su inventario ya no está abierto');
                return;
            }
            var local = _rcLeerBorrador();
            _reconteoActivo = (local && local.id === r.id && (local.actualizadoEn || 0) >= (r.actualizadoEn || 0))
                ? local : JSON.parse(JSON.stringify(r));
            _rcGuardarBorrador();
            auditoriaView = 'reconteo';
            renderTab();
        }

        function reconteoSalir() {
            auditoriaView = 'selection';
            renderTab();
        }

        function reconteoAbrirHistorial() {
            _reconteoLista = null;
            auditoriaView = 'reconteo_historial';
            renderTab();
        }

        // ── Edición ──────────────────────────────────────────────────────────

        function reconteoCambiarNombre(valor) {
            if (!_reconteoActivo) return;
            _reconteoActivo.recontadoPor = String(valor || '').slice(0, 60);
            _rcTocar();
        }

        function reconteoAgregarProducto(pid) {
            if (!_reconteoActivo || _reconteoActivo.estado !== 'abierto') return;
            var p = _rcProducto(pid);
            if (!p) return;
            if (_reconteoActivo.items[pid]) { showNotification('Ya está en el reconteo'); return; }
            if (_reconteoActivo.orden.length >= RECONTEO_MAX_PRODUCTOS) {
                showNotification('⚠️ Máximo ' + RECONTEO_MAX_PRODUCTOS + ' productos por reconteo');
                return;
            }
            _reconteoActivo.items[pid] = {
                nombre:     String(p.name || pid).slice(0, 120),
                unidad:     String(p.unit || '').slice(0, 20),
                agregadoEn: Date.now(),
                areas:      {}
            };
            _reconteoActivo.orden.unshift(pid);   // lo último agregado, arriba
            _rcTocar();
            _rcPintarLista();
            if (typeof BusquedaUI !== 'undefined') BusquedaUI.limpiar('reconteo');
        }

        function reconteoQuitarProducto(pid) {
            if (!_reconteoActivo || !_reconteoActivo.items[pid]) return;
            var it = _reconteoActivo.items[pid];
            var conCorreccion = Object.keys(it.areas || {}).some(function(a) { return it.areas[a] && it.areas[a].despues; });
            var historial = Object.keys(it.areas || {}).some(function(a) { return it.areas[a] && (it.areas[a].historial || []).length; });
            if (historial) {
                showNotification('⚠️ Este producto ya se corrigió en una ronda anterior: queda en el registro');
                return;
            }
            var quitar = function() {
                delete _reconteoActivo.items[pid];
                _reconteoActivo.orden = _reconteoActivo.orden.filter(function(x) { return x !== pid; });
                _rcTocar();
                // Si el registro ya estaba en la nube y se queda sin productos,
                // se sube igual para que el cierre no lo vea como pendiente.
                if (!_reconteoActivo.orden.length) _rcSubir(_reconteoActivo);
                _rcPintarLista();
                if (typeof BusquedaUI !== 'undefined') BusquedaUI.refrescar('reconteo');
            };
            if (conCorreccion) showConfirm('¿Quitar "' + it.nombre + '" del reconteo?\n\nSe pierde la corrección anotada (todavía no se había aplicado).', quitar);
            else quitar();
        }

        // Abre el modal de conteo de siempre, precargado con el valor vigente
        // de ESE almacén (o con la corrección ya anotada, si la hay).
        function reconteoEditarArea(pid, area) {
            if (!_reconteoActivo || _reconteoActivo.estado !== 'abierto') return;
            if (!_rcInventarioAbierto() || _reconteoActivo.inventoryId !== _auditoriaSessionId) {
                showNotification('⚠️ El inventario ya no está abierto: no se puede corregir');
                return;
            }
            var it = _reconteoActivo.items[pid];
            if (!it || _rcAreas().indexOf(area) === -1) return;
            if (!_rcProducto(pid)) { showNotification('⚠️ El producto ya no existe en el catálogo'); return; }
            var a = it.areas[area];
            var valor = (a && a.despues) ? _rcCopia(a.despues) : (_rcOficial(pid, area) || { enteras: 0, abiertas: [] });
            openInventarioModal(pid, { reconteo: { area: area, valor: valor } });
        }

        /**
         * La llama saveInventarioModal() cuando el modal se abrió desde el
         * reconteo: los valores ya pasaron por la MISMA validación del conteo
         * normal (decimales, negativos, notación científica, tope 9999).
         * Aquí solo se ANOTAN; se aplican al finalizar.
         */
        function _rcAplicarEdicion(pid, area, enteras, abiertas) {
            if (!_reconteoActivo || !_reconteoActivo.items[pid]) return;
            var it = _reconteoActivo.items[pid];
            var a = it.areas[area] || (it.areas[area] = { antes: null, despues: null, corregidoEn: null, historial: [] });
            if (!a.historial) a.historial = [];
            // "antes" se congela en la PRIMERA corrección de la ronda: es el
            // valor oficial que se está corrigiendo, no el que haya después.
            if (!a.despues) a.antes = _rcOficial(pid, area) || { enteras: 0, abiertas: [] };
            var nuevo = { enteras: enteras, abiertas: (abiertas || []).slice() };
            if (_rcIgual(nuevo, a.antes)) {
                a.despues = null; a.corregidoEn = null; a.antes = null;
                showNotification('Sin cambios: coincide con lo contado');
            } else {
                a.despues = nuevo;
                a.corregidoEn = Date.now();
                showNotification('✏️ Corrección anotada — se aplica al finalizar el reconteo');
            }
            _rcTocar();
            renderTab();
        }

        // ── Finalizar ────────────────────────────────────────────────────────

        function reconteoFinalizar() {
            var r = _reconteoActivo;
            if (!r || r.estado !== 'abierto' || _reconteoOcupado) return;
            if (!_rcPuede()) return;
            if (!_rcInventarioAbierto() || r.inventoryId !== _auditoriaSessionId) {
                showNotification('⚠️ El inventario ya no está abierto: este reconteo no puede aplicarse');
                return;
            }
            if (!navigator.onLine) {
                showNotification('📴 Sin conexión — las correcciones deben llegar al servidor antes de que alguien cierre el inventario');
                return;
            }
            var nombre = String(r.recontadoPor || '').trim();
            if (!nombre) {
                showNotification('⚠️ Escribe el nombre de quien reconta');
                var inp = document.getElementById('rc-nombre');
                if (inp) inp.focus();
                return;
            }
            if (!r.orden.length) { showNotification('⚠️ Agrega al menos un producto'); return; }
            var n = _rcCorrecciones(r);
            var productosCorregidos = r.orden.filter(function(pid) {
                var ar = (r.items[pid] && r.items[pid].areas) || {};
                return Object.keys(ar).some(function(a) { return ar[a] && ar[a].despues; });
            }).length;
            var msg = n
                ? '✅ FINALIZAR RECONTEO\n\nSe aplicarán ' + _rcNCorr(n) + ' en ' +
                  productosCorregidos + ' producto' + (productosCorregidos === 1 ? '' : 's') + '.\n\n' +
                  'Pasan a ser el conteo oficial del inventario #' + (r.inventarioNumero || '—') + '.\n' +
                  'Recontó: ' + nombre + '\n\n¿Confirmar?'
                : 'Ningún conteo cambió: se registrará que los ' + r.orden.length + ' productos se recontaron y coincidieron.\n\n¿Finalizar?';
            showConfirm(msg, function() { _rcFinalizarConfirmado(); });
        }

        async function _rcFinalizarConfirmado() {
            var r = _reconteoActivo;
            if (!r || _reconteoOcupado) return;
            _reconteoOcupado = true;
            try {
                var now = Date.now();
                var correcciones = [];
                r.orden.forEach(function(pid) {
                    var ar = (r.items[pid] && r.items[pid].areas) || {};
                    Object.keys(ar).forEach(function(area) {
                        if (ar[area] && ar[area].despues) correcciones.push({ pid: pid, area: area, a: ar[area] });
                    });
                });

                // 1) Aplicar: el conteo del administrador es la autoridad en la
                //    consolidación. Primero en el dispositivo (a salvo aunque se
                //    corte la red), después al servidor por la vía de siempre.
                if (correcciones.length) {
                    correcciones.forEach(function(c) {
                        if (!myAuditoriaConteo[c.pid]) myAuditoriaConteo[c.pid] = {};
                        myAuditoriaConteo[c.pid][c.area] = {
                            enteras:     c.a.despues.enteras,
                            abiertas:    c.a.despues.abiertas.slice(),
                            _ts:         now,
                            _reconteoId: r.id
                        };
                    });
                    saveToLocalStorage();
                    showNotification('⏳ Aplicando correcciones…');
                    await syncMyAuditoriaToFirestore();
                    if (typeof _auditSyncPending !== 'undefined' && _auditSyncPending) {
                        // Quedaron en el dispositivo y subirán solas al
                        // reconectar. El reconteo sigue abierto a propósito:
                        // así el cierre queda bloqueado hasta confirmarlas.
                        showNotification('⚠️ Correcciones guardadas en el dispositivo; no llegaron al servidor. Vuelve a pulsar Finalizar con conexión.');
                        return;
                    }
                }

                // 2) Registro final: para los almacenes no corregidos se guarda
                //    el valor vigente, para que el histórico muestre la tarjeta
                //    completa tal como quedó.
                r.orden.forEach(function(pid) {
                    var it = r.items[pid];
                    if (!it) return;
                    _rcAreas().forEach(function(area) {
                        var a = it.areas[area];
                        if (a && a.despues) return;
                        var hist = (a && a.historial) || [];
                        it.areas[area] = { antes: _rcOficial(pid, area), despues: null, corregidoEn: null, historial: hist };
                    });
                });
                r.estado = 'finalizado';
                r.finalizadoEn = now;
                r.finalizadoPorUid = currentUserUid;
                r.actualizadoEn = now;
                r.recontadoPor = String(r.recontadoPor || '').trim().slice(0, 60);
                r.rondas = (r.rondas || []).concat([{
                    ronda:        r.ronda,
                    recontadoPor: r.recontadoPor,
                    uid:          currentUserUid,
                    finalizadoEn: now,
                    productos:    r.orden.length,
                    correcciones: correcciones.length
                }]);
                clearTimeout(_reconteoSubidaTimer);
                try {
                    await _rcColeccion().doc(r.id).set(_rcDocParaNube(r));
                } catch (err) {
                    console.error('[Reconteo] Error al registrar el cierre del reconteo:', err);
                    // Las correcciones YA son oficiales; solo falta el registro.
                    // Se deja abierto para reintentar (reaplicar es idempotente).
                    r.estado = 'abierto'; r.finalizadoEn = null; r.finalizadoPorUid = null;
                    r.rondas = r.rondas.slice(0, -1);
                    _rcGuardarBorrador();
                    showNotification('⚠️ Correcciones aplicadas, pero no se pudo guardar el registro. Vuelve a pulsar Finalizar.');
                    return;
                }

                if (typeof _registrarEnSyncQueue === 'function') {
                    try {
                        _registrarEnSyncQueue({
                            tipo:         'reconteo',
                            detalle:      'Reconteo ronda ' + r.ronda + ' del inventario #' + (r.inventarioNumero || '—') +
                                          ': ' + correcciones.length + ' correcciones en ' + r.orden.length + ' productos (recontó ' + r.recontadoPor + ')',
                            valorAntes:   JSON.stringify(correcciones.map(function(c) { return { p: c.pid, a: c.area, v: c.a.antes }; })),
                            valorDespues: JSON.stringify(correcciones.map(function(c) { return { p: c.pid, a: c.area, v: c.a.despues }; })),
                            motivo:       'Reconteo'
                        });
                    } catch (_) { /* el registro de auditoría nunca interrumpe */ }
                }

                var finalizado = r;
                _reconteoActivo = null;
                _rcGuardarBorrador();
                _reconteoLista = null;
                _reconteoDetalleId = finalizado.id;
                _reconteoDetalle = finalizado;
                auditoriaView = 'reconteo_detalle';
                showNotification('✅ Reconteo finalizado — ' + _rcNCorr(correcciones.length) + ' aplicada' + (correcciones.length === 1 ? '' : 's'));
                renderTab();
            } finally {
                _reconteoOcupado = false;
            }
        }

        function reconteoDescartar() {
            var r = _reconteoActivo;
            if (!r || r.estado !== 'abierto') return;
            if ((r.rondas || []).length) {
                showNotification('⚠️ Es una ronda reabierta: finalízala (aunque no cambies nada) para cerrarla');
                return;
            }
            showConfirm('¿Descartar este reconteo?\n\nNo se aplicó ninguna corrección todavía; el registro queda como descartado.', async function() {
                clearTimeout(_reconteoSubidaTimer);
                if (r.orden.length) {
                    r.estado = 'descartado';
                    r.actualizadoEn = Date.now();
                    var ok = await _rcSubir(r);
                    if (!ok) {
                        r.estado = 'abierto';
                        showNotification('⚠️ No se pudo descartar — revisa la conexión');
                        return;
                    }
                }
                _reconteoActivo = null;
                _rcGuardarBorrador();
                _reconteoLista = null;
                auditoriaView = 'selection';
                showNotification('Reconteo descartado');
                renderTab();
            });
        }

        // ── Reabrir (segunda ronda) ──────────────────────────────────────────

        async function reconteoReabrir(id) {
            if (!_rcPuede() || _reconteoOcupado) return;
            var r = (_reconteoDetalle && _reconteoDetalle.id === id) ? _reconteoDetalle : null;
            if (!r) return;
            if (r.estado !== 'finalizado') return;
            if (!_rcInventarioAbierto() || r.inventoryId !== _auditoriaSessionId) {
                showNotification('⚠️ Solo se puede reabrir mientras su inventario siga abierto');
                return;
            }
            if (!navigator.onLine) { showNotification('📴 Sin conexión — conéctate para reabrir'); return; }
            _reconteoOcupado = true;
            try {
                if (await _hayReconteoAbierto(r.inventoryId)) {
                    showNotification('⚠️ Ya hay otro reconteo abierto: finalízalo o descártalo primero');
                    return;
                }
                var copia = JSON.parse(JSON.stringify(r));
                var now = Date.now();
                Object.keys(copia.items || {}).forEach(function(pid) {
                    var ar = copia.items[pid].areas || {};
                    Object.keys(ar).forEach(function(area) {
                        var a = ar[area];
                        if (!a) return;
                        var hist = a.historial || [];
                        if (a.despues) hist = hist.concat([{ ronda: copia.ronda, antes: a.antes, despues: a.despues, ts: a.corregidoEn || copia.finalizadoEn }]);
                        ar[area] = { antes: null, despues: null, corregidoEn: null, historial: hist };
                    });
                });
                copia.estado = 'abierto';
                copia.ronda = (copia.ronda || 1) + 1;
                copia.finalizadoEn = null;
                copia.finalizadoPorUid = null;
                copia.recontadoPor = _rcNombreSesion() || copia.recontadoPor;
                copia.actualizadoEn = now;
                try {
                    await _rcColeccion().doc(copia.id).set(_rcDocParaNube(copia));
                } catch (err) {
                    console.error('[Reconteo] Error al reabrir:', err);
                    showNotification('❌ No se pudo reabrir — revisa la conexión');
                    return;
                }
                _reconteoActivo = copia;
                _rcGuardarBorrador();
                _reconteoLista = null;
                auditoriaView = 'reconteo';
                showNotification('🔁 Reconteo reabierto — ronda ' + copia.ronda);
                renderTab();
            } finally {
                _reconteoOcupado = false;
            }
        }

        // ── Histórico ────────────────────────────────────────────────────────

        async function _rcCargarLista() {
            if (_reconteoListaCargando || !_db) return;
            _reconteoListaCargando = true;
            try {
                var snap = await _rcColeccion().orderBy('creadoEn', 'desc').limit(50).get();
                var lista = [];
                snap.forEach(function(doc) { lista.push(_rcDesdeNube(doc.id, doc.data())); });
                _reconteoLista = lista;
            } catch (e) {
                console.warn('[Reconteo] No se pudo cargar el histórico:', e);
                _reconteoLista = [];
                showNotification('⚠️ No se pudo cargar el histórico de reconteos');
            } finally {
                _reconteoListaCargando = false;
            }
            if (auditoriaView === 'reconteo_historial') renderTab();
        }

        async function reconteoVerDetalle(id) {
            var enLista = (_reconteoLista || []).find(function(x) { return x.id === id; });
            _reconteoDetalleId = id;
            _reconteoDetalle = enLista || null;
            auditoriaView = 'reconteo_detalle';
            renderTab();
            if (!enLista && _db) {
                try {
                    var doc = await _rcColeccion().doc(id).get();
                    if (doc.exists) _reconteoDetalle = _rcDesdeNube(doc.id, doc.data());
                } catch (e) { console.warn('[Reconteo] No se pudo leer el registro:', e); }
                if (auditoriaView === 'reconteo_detalle') renderTab();
            }
        }

        // ── Render ───────────────────────────────────────────────────────────

        function _rcAttr(x) { return escapeHtml(String(x == null ? '' : x)); }

        function _rcTarjetaHtml(pid, it, modo) {
            var p = _rcProducto(pid);
            var edicion = modo === 'edicion';
            var areasRc = _rcAreas();
            var totalAntes = 0, totalDespues = 0, hayCorreccion = false;
            var filas = '';
            areasRc.forEach(function(area) {
                var a = (it.areas || {})[area] || null;
                var corregido = !!(a && a.despues);
                var base = edicion
                    ? (corregido ? a.antes : _rcOficial(pid, area))
                    : (a ? a.antes : null);
                var tBase = _rcTotal(p, base);
                var tNuevo = corregido ? _rcTotal(p, a.despues) : tBase;
                totalAntes += tBase;
                totalDespues += tNuevo;
                if (corregido) hayCorreccion = true;

                var cuerpo = '<span class="rc-area__nombre">' + escapeHtml(_rcEtiquetaArea(area)) + '</span>';
                if (corregido) {
                    cuerpo += '<span class="rc-area__valor"><s>' + _rcFmt(p, tBase) + '</s> → <b>' + _rcFmt(p, tNuevo) + '</b></span>'
                            + '<span class="rc-area__det">' + escapeHtml(_rcDesglose(p, a.despues)) + '</span>';
                } else {
                    cuerpo += '<span class="rc-area__valor">' + (base ? _rcFmt(p, tBase) : '0') + '</span>'
                            + '<span class="rc-area__det">' + escapeHtml(_rcDesglose(p, base)) + '</span>';
                }
                if (!edicion && a && (a.historial || []).length) {
                    a.historial.forEach(function(h) {
                        cuerpo += '<span class="rc-area__hist">R' + (h.ronda || '?') + ': ' + _rcFmt(p, _rcTotal(p, h.antes)) + ' → ' + _rcFmt(p, _rcTotal(p, h.despues)) + '</span>';
                    });
                }
                if (edicion) {
                    filas += '<button type="button" class="rc-area' + (corregido ? ' rc-area--corregida' : '') + '"'
                           + ' data-rc-accion="editar" data-rc-pid="' + _rcAttr(pid) + '" data-rc-area="' + _rcAttr(area) + '"'
                           + ' aria-label="Corregir ' + _rcAttr(it.nombre) + ' en ' + _rcAttr(_rcEtiquetaArea(area)) + '">' + cuerpo + '</button>';
                } else {
                    filas += '<div class="rc-area' + (corregido ? ' rc-area--corregida' : '') + '">' + cuerpo + '</div>';
                }
            });

            var h = '<div class="rc-card' + (hayCorreccion ? ' rc-card--corregida' : '') + '">';
            h += '<div class="rc-card__cab"><div style="min-width:0;flex:1;">';
            h += '<div class="rc-card__nombre">' + escapeHtml(it.nombre || pid) + '</div>';
            h += '<div class="rc-card__sub">' + escapeHtml((p && p.group) || '') + (it.unidad ? ' · ' + escapeHtml(it.unidad) : '')
               + (!p ? ' · <span style="color:var(--amber);">ya no está en el catálogo</span>' : '') + '</div>';
            h += '</div>';
            if (edicion) {
                h += '<button type="button" class="rc-card__quitar" data-rc-accion="quitar" data-rc-pid="' + _rcAttr(pid) + '"'
                   + ' aria-label="Quitar ' + _rcAttr(it.nombre) + ' del reconteo" title="Quitar">✕</button>';
            }
            h += '</div>';
            h += '<div class="rc-areas" style="grid-template-columns:repeat(' + Math.min(areasRc.length, 3) + ',minmax(0,1fr));">' + filas + '</div>';
            h += '<div class="rc-card__total">Total: '
               + (hayCorreccion
                    ? '<s>' + _rcFmt(p, totalAntes) + '</s> → <b>' + _rcFmt(p, totalDespues) + '</b>'
                    : '<b>' + _rcFmt(p, totalAntes) + '</b>')
               + '</div>';
            h += '</div>';
            return h;
        }

        function _rcListaHtml() {
            var r = _reconteoActivo;
            if (!r || !r.orden.length) {
                return '<div class="rc-vacio">Busca un producto arriba y agrégalo. Después toca un almacén para corregir lo que se contó ahí.</div>';
            }
            return r.orden.map(function(pid) { return r.items[pid] ? _rcTarjetaHtml(pid, r.items[pid], 'edicion') : ''; }).join('');
        }

        function _rcPieHtml() {
            var r = _reconteoActivo;
            var n = _rcCorrecciones(r);
            var editable = _rcInventarioAbierto() && r.inventoryId === _auditoriaSessionId;
            var h = '<div class="rc-pie">';
            h += '<div class="rc-pie__resumen">' + r.orden.length + ' producto' + (r.orden.length === 1 ? '' : 's')
               + ' · <b>' + _rcNCorr(n) + '</b></div>';
            h += '<button type="button" class="rc-btn rc-btn--primario" data-rc-accion="finalizar"'
               + ((!editable || !r.orden.length) ? ' disabled' : '') + '>✅ Finalizar reconteo</button>';
            h += '</div>';
            return h;
        }

        function _rcPintarLista() {
            var el = document.getElementById('rc-lista');
            if (el) el.innerHTML = _rcListaHtml();
            var pie = document.getElementById('rc-pie');
            if (pie && _reconteoActivo) pie.innerHTML = _rcPieHtml();
        }

        function _rcResultadosHtml() {
            var q = _reconteoSearchTerm;
            if (!q) {
                return { html: '<div class="rc-ayuda">Escribe nombre, código o PV para agregar un producto.</div>', coincidencias: 0, total: products.length };
            }
            var r = _motorProductos.buscar(products, q);
            var html = '';
            if (!r.items.length) {
                html = BusquedaUI.vacio('reconteo', 'productos');
            } else {
                html += '<div class="rc-resultados">';
                r.items.slice(0, RECONTEO_RESULTADOS).forEach(function(p) {
                    var ya = !!(_reconteoActivo && _reconteoActivo.items[p.id]);
                    html += '<div class="rc-res" data-sbx-item>';
                    html += '<div style="min-width:0;flex:1;"><div class="rc-res__nombre">' + resaltarBusqueda(p.name || p.id, q) + '</div>'
                          + '<div class="rc-res__sub">' + escapeHtml(p.group || '') + (p.unit ? ' · ' + escapeHtml(p.unit) : '') + '</div></div>';
                    html += '<button type="button" class="rc-btn' + (ya ? ' rc-btn--hecho' : '') + '" data-sbx-principal'
                          + ' data-rc-accion="agregar" data-rc-pid="' + _rcAttr(p.id) + '"' + (ya ? ' disabled' : '') + '>'
                          + (ya ? 'Agregado ✓' : '+ Agregar') + '</button>';
                    html += '</div>';
                });
                if (r.items.length > RECONTEO_RESULTADOS) {
                    html += '<div class="rc-ayuda">' + (r.items.length - RECONTEO_RESULTADOS) + ' coincidencias más — afina la búsqueda.</div>';
                }
                html += '</div>';
            }
            return { html: html, coincidencias: r.items.length, total: products.length };
        }

        function renderReconteo() {
            if (!_rcPuede()) { auditoriaView = 'selection'; return renderAuditoriaSeleccion(); }
            if (!_reconteoActivo) {
                var b = _rcLeerBorrador();
                if (b && b.inventoryId === _auditoriaSessionId && b.estado === 'abierto') _reconteoActivo = b;
            }
            if (!_reconteoActivo) { auditoriaView = 'selection'; return renderAuditoriaSeleccion(); }
            var r = _reconteoActivo;
            var editable = _rcInventarioAbierto() && r.inventoryId === _auditoriaSessionId;

            var h = '<div class="rc-screen">';
            h += '<div class="rc-cab">';
            h += '<button type="button" class="audit-back-btn" data-rc-accion="salir"><i class="fa-solid fa-chevron-left"></i> Inventario</button>';
            h += '<div style="min-width:0;flex:1;">';
            h += '<div class="rc-titulo">🔁 Reconteo · Inventario #' + escapeHtml(String(r.inventarioNumero || '—'))
               + (r.ronda > 1 ? ' <span class="rc-badge">Ronda ' + r.ronda + '</span>' : '') + '</div>';
            h += '<div class="rc-sub">Iniciado: ' + escapeHtml(_rcFecha(r.creadoEn)) + '</div>';
            h += '</div>';
            h += '<button type="button" class="rc-btn" data-rc-accion="historial">📋 Histórico</button>';
            h += '</div>';

            if (!editable) {
                h += '<div class="rc-aviso">El inventario ya no está abierto: este reconteo no puede aplicarse.</div>';
            }

            h += '<label class="rc-label" for="rc-nombre">Nombre de quien reconta</label>';
            h += '<input id="rc-nombre" class="rc-input" type="text" maxlength="60" autocomplete="off" value="' + _rcAttr(r.recontadoPor) + '"'
               + (editable ? '' : ' disabled') + '>';

            if (editable) {
                h += '<div class="rc-label" style="margin-top:14px;">Agregar producto</div>';
                h += BusquedaUI.barra('reconteo', { placeholder: 'Buscar producto para recontar…', etiqueta: 'Buscar producto para agregar al reconteo' });
                h += BusquedaUI.region('reconteo', _rcResultadosHtml().html);
            }

            h += '<div class="rc-label" style="margin-top:14px;">Productos en reconteo</div>';
            h += '<div id="rc-lista" class="rc-lista">' + _rcListaHtml() + '</div>';
            if (editable && !(r.rondas || []).length) {
                h += '<button type="button" class="rc-enlace" data-rc-accion="descartar">Descartar reconteo</button>';
            }
            h += '<div id="rc-pie">' + _rcPieHtml() + '</div>';
            h += '</div>';
            return h;
        }

        function _rcEstadoBadge(r) {
            if (r.estado === 'finalizado') return '<span class="rc-estado rc-estado--ok">Finalizado</span>';
            if (r.estado === 'descartado') return '<span class="rc-estado">Descartado</span>';
            return '<span class="rc-estado rc-estado--abierto">Abierto</span>';
        }

        function renderReconteoHistorial() {
            if (!_rcPuede()) { auditoriaView = 'selection'; return renderAuditoriaSeleccion(); }
            if (_reconteoLista === null && !_reconteoListaCargando) setTimeout(_rcCargarLista, 0);
            var h = '<div class="rc-screen">';
            h += '<div class="rc-cab">';
            h += '<button type="button" class="audit-back-btn" data-rc-accion="salir"><i class="fa-solid fa-chevron-left"></i> Inventario</button>';
            h += '<div style="min-width:0;flex:1;"><div class="rc-titulo">📋 Histórico de reconteos</div></div>';
            h += '</div>';
            if (_reconteoLista === null) {
                h += '<div class="rc-vacio">Cargando…</div>';
            } else if (!_reconteoLista.length) {
                h += '<div class="rc-vacio">Todavía no hay reconteos registrados.</div>';
            } else {
                _reconteoLista.forEach(function(r) {
                    var ultima = (r.rondas || [])[r.rondas.length - 1];
                    var fecha = r.finalizadoEn || (ultima && ultima.finalizadoEn) || r.actualizadoEn || r.creadoEn;
                    var n = (r.estado === 'finalizado' && ultima) ? ultima.correcciones : _rcCorrecciones(r);
                    h += '<button type="button" class="rc-hist" data-rc-accion="ver" data-rc-id="' + _rcAttr(r.id) + '">';
                    h += '<div class="rc-hist__fila"><span class="rc-hist__titulo">Inventario #' + escapeHtml(String(r.inventarioNumero || '—'))
                       + (r.ronda > 1 ? ' · Ronda ' + r.ronda : '') + '</span>' + _rcEstadoBadge(r) + '</div>';
                    h += '<div class="rc-hist__dato">📅 ' + escapeHtml(_rcFecha(fecha)) + '</div>';
                    h += '<div class="rc-hist__dato">👤 Recontó: ' + escapeHtml(r.recontadoPor || '—') + '</div>';
                    h += '<div class="rc-hist__dato">' + (r.orden || []).length + ' productos · ' + (n || 0) + ' correcciones</div>';
                    h += '</button>';
                });
            }
            h += '</div>';
            return h;
        }

        function renderReconteoDetalle() {
            if (!_rcPuede()) { auditoriaView = 'selection'; return renderAuditoriaSeleccion(); }
            var r = _reconteoDetalle;
            var h = '<div class="rc-screen">';
            h += '<div class="rc-cab">';
            h += '<button type="button" class="audit-back-btn" data-rc-accion="historial"><i class="fa-solid fa-chevron-left"></i> Histórico</button>';
            h += '<div style="min-width:0;flex:1;"><div class="rc-titulo">Reconteo · Inventario #' + escapeHtml(String((r && r.inventarioNumero) || '—'))
               + (r && r.ronda > 1 ? ' <span class="rc-badge">Ronda ' + r.ronda + '</span>' : '') + '</div></div>';
            h += '</div>';
            if (!r) {
                h += '<div class="rc-vacio">Cargando…</div></div>';
                return h;
            }
            h += '<div class="rc-resumen">';
            h += '<div>' + _rcEstadoBadge(r) + '</div>';
            (r.rondas || []).forEach(function(ro) {
                h += '<div class="rc-hist__dato">Ronda ' + ro.ronda + ' · 📅 ' + escapeHtml(_rcFecha(ro.finalizadoEn))
                   + ' · 👤 ' + escapeHtml(ro.recontadoPor || '—') + ' · ' + (ro.correcciones || 0) + ' correcciones</div>';
            });
            if (r.estado !== 'finalizado') {
                h += '<div class="rc-hist__dato">👤 Recontando: ' + escapeHtml(r.recontadoPor || '—') + '</div>';
            }
            h += '</div>';

            var puedeReabrir = r.estado === 'finalizado' && _rcInventarioAbierto() && r.inventoryId === _auditoriaSessionId;
            var puedeSeguir  = r.estado === 'abierto' && _rcInventarioAbierto() && r.inventoryId === _auditoriaSessionId;
            if (puedeReabrir) {
                h += '<button type="button" class="rc-btn rc-btn--primario" style="width:100%;margin:10px 0;" data-rc-accion="reabrir" data-rc-id="'
                   + _rcAttr(r.id) + '">🔁 Reabrir reconteo (segunda ronda)</button>';
            } else if (puedeSeguir) {
                h += '<button type="button" class="rc-btn rc-btn--primario" style="width:100%;margin:10px 0;" data-rc-accion="continuar" data-rc-id="'
                   + _rcAttr(r.id) + '">Continuar reconteo</button>';
            } else if (r.estado === 'finalizado') {
                h += '<div class="rc-ayuda" style="margin:10px 0;">Su inventario ya se cerró: el registro es de solo lectura.</div>';
            }

            h += '<div class="rc-lista">';
            (r.orden || Object.keys(r.items || {})).forEach(function(pid) {
                if (r.items && r.items[pid]) h += _rcTarjetaHtml(pid, r.items[pid], 'detalle');
            });
            h += '</div></div>';
            return h;
        }

        // ── Buscador ─────────────────────────────────────────────────────────

        BusquedaUI.registrar('reconteo', {
            obtenerConsulta: function() { return _reconteoSearchTerm; },
            alAplicar:  function(v) { _reconteoSearchTerm = v; },
            refrescar:  function() {
                var r = _rcResultadosHtml();
                var reg = document.getElementById('sbx-res-reconteo');
                if (reg) reg.innerHTML = r.html;
                return r;
            },
            precalentar: function() { if (typeof _motorProductos !== 'undefined') _motorProductos.indexar(products); },
            paso: RECONTEO_RESULTADOS
        });

        // ── Eventos (delegados, instalados una sola vez) ─────────────────────

        document.addEventListener('click', function(e) {
            var el = e.target && e.target.closest ? e.target.closest('[data-rc-accion]') : null;
            if (!el || el.disabled) return;
            var acc  = el.getAttribute('data-rc-accion');
            var pid  = el.getAttribute('data-rc-pid');
            var area = el.getAttribute('data-rc-area');
            var id   = el.getAttribute('data-rc-id');
            switch (acc) {
                case 'agregar':   reconteoAgregarProducto(pid); break;
                case 'quitar':    reconteoQuitarProducto(pid); break;
                case 'editar':    reconteoEditarArea(pid, area); break;
                case 'finalizar': reconteoFinalizar(); break;
                case 'descartar': reconteoDescartar(); break;
                case 'historial': reconteoAbrirHistorial(); break;
                case 'salir':     reconteoSalir(); break;
                case 'ver':       reconteoVerDetalle(id); break;
                case 'reabrir':   reconteoReabrir(id); break;
                case 'continuar': reconteoContinuar(id); break;
                case 'iniciar':   reconteoIniciar(); break;
            }
        });

        document.addEventListener('input', function(e) {
            if (e.target && e.target.id === 'rc-nombre') reconteoCambiarNombre(e.target.value);
        });
