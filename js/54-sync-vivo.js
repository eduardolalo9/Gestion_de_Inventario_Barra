        // ══════════════════════════════════════════════════════════════════════
        //  v5.22 — SINCRONIZACIÓN EN VIVO DE COMPRAS, VENTAS Y CORTES
        //  ────────────────────────────────────────────────────────────────────
        //  Pedido de Eduardo (9-oct-2026): "lo que hago en mi PC se refleje en mi
        //  celular y de mi celular cada modificación, o importe de ventas o
        //  compras, se muestre también en mi PC".
        //
        //  Qué ya era en vivo: catálogo, recetario, conteos, ajustes, notifica-
        //  ciones, usuarios y el Total publicado (onSnapshot).
        //  Qué NO lo era: compras, ventas y cortes de existencias. Se escribían
        //  en Firestore, pero cada dispositivo los leía UNA vez al abrir la app
        //  (.get()). Lo importado en una PC no aparecía en el celular hasta
        //  cerrar y abrir la app, y el Total (que depende de ellos) tampoco.
        //
        //  Qué hace este módulo (no cambia ningún cálculo):
        //    · Escucha, en vivo, las compras y ventas de la semana en curso y la
        //      anterior, y el último corte / inicial semanal.
        //    · Un cambio hecho por OTRO dispositivo se mezcla en memoria y se
        //      recalcula el Total con los mismos caminos de siempre
        //      (existenciaInvalidarInicial + existenciaCargarInicial).
        //    · Lo escrito por este mismo dispositivo se ignora (ya lo refrescó
        //      su propio flujo): no hay lecturas dobles.
        //    · Una pantalla con una importación en curso NO se repinta (el
        //      jefe no pierde la vista previa que está revisando): solo avisa.
        //
        //  Batería y datos móviles (instrucción del proyecto):
        //    · Solo escucha con la app visible. Oculta más de 5 min → suelta las
        //      escuchas; al volver, recupera lo que haya cambiado en UNA pasada.
        //    · Un solo flujo por colección (consulta con `in`), no uno por semana.
        //    · Cambios seguidos (una importación escribe varios folios) se
        //      agrupan: un solo recálculo cada 1.2 s como mucho.
        //    · Sin el permiso de leer compras o ventas ni se pregunta (las reglas
        //      lo negarían): ese usuario sigue con el Total publicado.
        //
        //  Cero pérdida de datos: este módulo SOLO LEE. No escribe en Firestore.
        // ══════════════════════════════════════════════════════════════════════

        var SYNC_VIVO_DEBOUNCE_MS     = 1200;
        var SYNC_VIVO_OCULTO_MS       = 5 * 60 * 1000;    // oculta más de esto → se sueltan las escuchas
        var SYNC_VIVO_RECUPERA_MS     = 60 * 1000;        // al volver tras más de esto → una pasada de recuperación
        var SYNC_VIVO_SEMANA_MS       = 15 * 60 * 1000;   // revisa si cambió la semana (app abierta días seguidos)
        var SYNC_VIVO_MIN_RECUPERA_MS = 20 * 1000;        // como mucho una recuperación cada 20 s
        var SYNC_VIVO_AVISO_MS        = 10 * 1000;        // como mucho un aviso en pantalla cada 10 s
        var SYNC_VIVO_MAX_REINTENTOS  = 3;

        function _svNuevoPend() { return { compras: [], motivos: {} }; }

        var _syncVivo = {
            activo: false, claveSemanas: null, escuchas: {}, base: {}, reintentos: {},
            pend: _svNuevoPend(), timer: null, ocultoDesde: 0, ocultoTimer: null, semanaTimer: null,
            enlazado: false, ultimaRecuperacion: 0, ultimoAviso: 0, intentosAuth: 0, ultimoCambio: null,
            cuenta: { cambios: 0, refrescos: 0 }
        };

        // ── Capa pura (probada aparte) ────────────────────────────────────────

        /** Semana en curso y la anterior: lo que el Total necesita en memoria. */
        function syncVivoSemanas(fecha) {
            var hoy = semanaId(fecha || new Date());
            var ant = (typeof semanaAnterior === 'function') ? semanaAnterior(hoy) : null;
            return ant ? [hoy, ant] : [hoy];
        }

        /**
         * Qué hacer con un snapshot. meta = snap.metadata.
         *   'propio'    → escritura de ESTE dispositivo aún en tránsito: ya la refrescó su flujo.
         *   'cache'     → datos del caché local: nunca se actúa sobre ellos.
         *   'base'      → primera respuesta del servidor: es lo que ya cargó el arranque.
         *   'refrescar' → otro dispositivo cambió algo.
         *   'nada'      → confirmación de una escritura propia (solo metadatos): sin cambios de datos.
         */
        function syncVivoDecidir(meta, baseLista, nCambios) {
            if (meta && meta.hasPendingWrites) return 'propio';
            if (meta && meta.fromCache) return 'cache';
            if (!baseLista) return 'base';
            return nCambios > 0 ? 'refrescar' : 'nada';
        }

        /**
         * Mezcla una compra de la nube en la lista local. Devuelve true si cambió algo.
         * Las compras no se pierden: una alta nueva se agrega (con sus asientos),
         * y una existente solo se reemplaza si la nube trae algo distinto.
         */
        function syncVivoMezclarCompra(c, lista, libro, derivar, agregar) {
            if (!c || !c.compraId) return false;
            var i = -1;
            for (var k = 0; k < lista.length; k++) { if (lista[k] && lista[k].compraId === c.compraId) { i = k; break; } }
            var asientos = (typeof derivar === 'function') ? derivar(c) : [];
            if (i === -1) { agregar(c, asientos); return true; }
            var igual = false;
            try { igual = JSON.stringify(lista[i]) === JSON.stringify(c); } catch (_) { igual = false; }
            if (igual) return false;
            lista[i] = c;                                   // la nube gana en un mismo folio
            (asientos || []).forEach(function(m) {          // el libro solo CRECE: asientos nuevos, nunca se editan
                if (!libro.some(function(x) { return x.movId === m.movId; })) libro.push(m);
            });
            return true;
        }

        // ── Escuchas ──────────────────────────────────────────────────────────

        /** FieldPath.documentId() del SDK, o null si no está (nunca lanza). */
        function _svIdDoc() {
            try { return firebase.firestore.FieldPath.documentId(); } catch (_) { return null; }
        }

        function _svAuthListo() {
            return (typeof _authzState !== 'undefined' && _authzState && _authzState.loaded && typeof hasPermission === 'function');
        }

        function _svAgregarCompraLocal(c) {
            return syncVivoMezclarCompra(c, compras, movimientos,
                (typeof _asientosDesdeCompra === 'function') ? _asientosDesdeCompra : null,
                (typeof _agregarCompraLocal === 'function') ? _agregarCompraLocal
                    : function(x, as) { compras.push(x); (as || []).forEach(function(m) { movimientos.push(m); }); });
        }

        function _svAlSnapshot(clave, snap) {
            var cambios = [];
            try { cambios = snap.docChanges(); } catch (_) { cambios = []; }
            var accion = syncVivoDecidir(snap.metadata, !!_syncVivo.base[clave], cambios.length);
            if (accion === 'base') {
                _syncVivo.base[clave] = true;
                if (clave === 'compras') {
                    // Lo que ya existía entre la carga de arranque y esta escucha: se mezcla, sin repintar de más.
                    var nuevas = 0;
                    snap.forEach(function(d) { if (_svAgregarCompraLocal(d.data())) nuevas++; });
                    if (nuevas) { _syncVivo.pend.motivos.compras = (_syncVivo.pend.motivos.compras || 0) + nuevas; _svProgramar(); }
                }
                return;
            }
            if (accion !== 'refrescar') return;
            if (clave === 'compras') {
                cambios.forEach(function(c) { if (c.type !== 'removed') _syncVivo.pend.compras.push(c.doc.data()); });
            }
            _syncVivo.pend.motivos[clave] = (_syncVivo.pend.motivos[clave] || 0) + cambios.length;
            _syncVivo.cuenta.cambios += cambios.length;
            _syncVivo.ultimoCambio = Date.now();
            _svProgramar();
        }

        function _svProgramar() {
            if (_syncVivo.timer) clearTimeout(_syncVivo.timer);
            _syncVivo.timer = setTimeout(_svRefrescar, SYNC_VIVO_DEBOUNCE_MS);
        }

        function _svEtiqueta(motivos) {
            var n = [];
            if (motivos.compras)    n.push('compras');
            if (motivos.ventas)     n.push('ventas');
            if (motivos.anclas || motivos.iniciales) n.push('corte de existencias');
            return n.join(', ');
        }

        /** Repinta lo que se ve, SIN pisar una captura o una vista previa en curso. */
        function _svRepintar() {
            if (typeof existenciaRepintarSeguro === 'function') existenciaRepintarSeguro();   // Inicio / Productos
            if (typeof activeTab === 'undefined' || typeof renderTab !== 'function') return;
            if (typeof document !== 'undefined' && document.body && document.body.classList.contains('modal-open')) return;
            var enLista = function(v) { return typeof v === 'undefined' || v === 'lista'; };
            var ok = (activeTab === 'compras' && enLista(typeof comprasImportView !== 'undefined' ? comprasImportView : undefined))
                  || (activeTab === 'ventas'  && enLista(typeof ventasImportView  !== 'undefined' ? ventasImportView  : undefined));
            if (ok) { try { renderTab(); } catch (e) { console.warn('[SyncVivo] Repintado falló:', e); } }
        }

        function _svRefrescar() {
            _syncVivo.timer = null;
            var pend = _syncVivo.pend; _syncVivo.pend = _svNuevoPend();
            var motivos = pend.motivos;
            if (!Object.keys(motivos).length && !pend.compras.length) return;
            var comprasCambiaron = false;
            pend.compras.forEach(function(c) { if (_svAgregarCompraLocal(c)) comprasCambiaron = true; });
            if (comprasCambiaron && typeof saveToLocalStorage === 'function') saveToLocalStorage();
            _syncVivo.cuenta.refrescos++;

            var soloCompras = Object.keys(motivos).every(function(k) { return k === 'compras'; });
            if (soloCompras) {
                // Las compras ya están en memoria (y su libro de asientos): el Total las toma por
                // su huella (n.º de asientos). Sin releer nada de Firestore.
                _svRepintar();
                if (typeof totalPublicadoAlCambiarExistencia === 'function') {
                    try { totalPublicadoAlCambiarExistencia(); } catch (e) { console.warn('[SyncVivo] Total publicado:', e); }
                }
            } else {
                // Ventas o corte: cambia la base del Total → mismo recálculo de siempre.
                if (typeof existenciaInvalidarInicial === 'function') existenciaInvalidarInicial();
                if (typeof existenciaCargarInicial === 'function') existenciaCargarInicial(_svRepintar);
            }
            var etiqueta = _svEtiqueta(motivos);
            if (etiqueta && typeof showNotification === 'function' && Date.now() - _syncVivo.ultimoAviso > SYNC_VIVO_AVISO_MS) {
                _syncVivo.ultimoAviso = Date.now();
                showNotification('🔄 Se actualizó desde otro dispositivo: ' + etiqueta);
            }
        }

        function _svEscuchar(clave, consulta) {
            _syncVivo.base[clave] = false;
            try {
                _syncVivo.escuchas[clave] = consulta.onSnapshot(function(snap) {
                    _syncVivo.reintentos[clave] = 0;
                    _svAlSnapshot(clave, snap);
                }, function(e) {
                    var codigo = e && (e.code || e.message);
                    console.warn('[SyncVivo] Escucha "' + clave + '" detenida:', codigo);
                    delete _syncVivo.escuchas[clave];
                    if (e && e.code === 'permission-denied') return;       // sin permiso: no se insiste
                    var n = (_syncVivo.reintentos[clave] || 0) + 1;
                    _syncVivo.reintentos[clave] = n;
                    if (n <= SYNC_VIVO_MAX_REINTENTOS && _syncVivo.activo) {
                        setTimeout(function() { if (_syncVivo.activo && !_syncVivo.escuchas[clave]) syncVivoIniciar(true); }, 15000 * n);
                    }
                });
            } catch (e) {
                console.warn('[SyncVivo] No se pudo escuchar "' + clave + '":', e);
            }
        }

        function _svSoltar() {
            Object.keys(_syncVivo.escuchas).forEach(function(k) { try { _syncVivo.escuchas[k](); } catch (_) {} });
            _syncVivo.escuchas = {}; _syncVivo.base = {};
        }

        /**
         * Enciende las escuchas. Idempotente: si ya están encendidas para esta semana no hace nada;
         * si cambió la semana (app abierta varios días) las vuelve a armar.
         */
        function syncVivoIniciar(forzar) {
            // Nunca debe tumbar el arranque: sin escucha en vivo la app sigue como antes.
            try { return _syncVivoIniciar(forzar); }
            catch (e) { console.warn('[SyncVivo] No se pudo iniciar:', e); return false; }
        }

        function _syncVivoIniciar(forzar) {
            if (typeof _db === 'undefined' || !_db || typeof currentUserUid === 'undefined' || !currentUserUid) return false;
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
            if (!_svAuthListo()) {
                // Los permisos llegan un poco después del arranque: se reintenta sin bloquear nada.
                if (_syncVivo.intentosAuth < 15) { _syncVivo.intentosAuth++; setTimeout(function() { syncVivoIniciar(forzar); }, 2000); }
                return false;
            }
            _syncVivo.intentosAuth = 0;
            var sem = syncVivoSemanas();
            var clave = sem.join('|');
            var faltan = (hasPermission('purchases.read') && !_syncVivo.escuchas.compras) || (hasPermission('sales.read') && !_syncVivo.escuchas.ventas)
                      || (!!_svIdDoc() && !_syncVivo.escuchas.anclas);
            if (_syncVivo.activo && _syncVivo.claveSemanas === clave && !forzar && !faltan) { _svEnlazar(); return true; }
            if (_syncVivo.activo && _syncVivo.claveSemanas !== clave) _svSoltar();

            _syncVivo.activo = true; _syncVivo.claveSemanas = clave;
            var base = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID);
            var idDoc = _svIdDoc();
            if (hasPermission('purchases.read') && !_syncVivo.escuchas.compras)
                _svEscuchar('compras', _db.collection('compras').where('semanaId', 'in', sem));
            if (hasPermission('sales.read') && !_syncVivo.escuchas.ventas)
                _svEscuchar('ventas', base.collection('ventas').where('semanaId', 'in', sem));
            // Cortes: el id es la fecha (o fecha_HHmm), así que ordenar por id es ordenar por tiempo.
            if (idDoc) {
                if (!_syncVivo.escuchas.anclas)
                    _svEscuchar('anclas', base.collection('anclasExistencia').orderBy(idDoc, 'desc').limit(3));
                if (!_syncVivo.escuchas.iniciales)
                    _svEscuchar('iniciales', base.collection('inventariosIniciales').orderBy(idDoc, 'desc').limit(1));
            } else {
                console.warn('[SyncVivo] Sin FieldPath.documentId: no se escuchan los cortes (sí compras y ventas).');
            }
            _svEnlazar();
            console.info('[SyncVivo] Escuchando ' + Object.keys(_syncVivo.escuchas).join(', ') + ' · semanas ' + clave);
            return true;
        }

        /** Apaga todo (cierre de sesión u oculta mucho rato). Solo suelta escuchas: no borra datos. */
        function syncVivoDetener() {
            _svSoltar();
            _syncVivo.activo = false; _syncVivo.claveSemanas = null; _syncVivo.pend = _svNuevoPend();
            if (_syncVivo.timer) { clearTimeout(_syncVivo.timer); _syncVivo.timer = null; }
        }

        /**
         * Una pasada de recuperación: lo que cambió mientras no se escuchaba (app oculta, sin red, o el
         * hueco entre la carga de arranque y la escucha). Las compras se mezclan (idempotente) y el
         * Total se recalcula desde Firestore con el camino de siempre.
         */
        function syncVivoRecuperar(motivo) {
            if (typeof _db === 'undefined' || !_db || !currentUserUid) return;
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
            if (Date.now() - _syncVivo.ultimaRecuperacion < SYNC_VIVO_MIN_RECUPERA_MS) return;
            _syncVivo.ultimaRecuperacion = Date.now();
            if (typeof cargarComprasIniciales === 'function') {
                cargarComprasIniciales().catch(function(e) { console.warn('[SyncVivo] Recuperar compras:', e); });
            }
            if (typeof existenciaInvalidarInicial === 'function') existenciaInvalidarInicial();
            if (typeof existenciaCargarInicial === 'function') existenciaCargarInicial(_svRepintar);
            console.info('[SyncVivo] Recuperación (' + (motivo || '') + ')');
        }

        function _svEnlazar() {
            if (_syncVivo.enlazado || typeof document === 'undefined') return;
            _syncVivo.enlazado = true;
            document.addEventListener('visibilitychange', function() {
                if (document.visibilityState === 'hidden') {
                    _syncVivo.ocultoDesde = Date.now();
                    if (_syncVivo.ocultoTimer) clearTimeout(_syncVivo.ocultoTimer);
                    _syncVivo.ocultoTimer = setTimeout(function() { if (document.visibilityState === 'hidden') _svSoltar(); }, SYNC_VIVO_OCULTO_MS);
                } else {
                    if (_syncVivo.ocultoTimer) { clearTimeout(_syncVivo.ocultoTimer); _syncVivo.ocultoTimer = null; }
                    var fuera = _syncVivo.ocultoDesde ? Date.now() - _syncVivo.ocultoDesde : 0;
                    _syncVivo.ocultoDesde = 0;
                    if (!currentUserUid) return;
                    syncVivoIniciar();
                    if (fuera > SYNC_VIVO_RECUPERA_MS) syncVivoRecuperar('volvió a la app');
                }
            });
            if (typeof window !== 'undefined') {
                window.addEventListener('online', function() {
                    if (!currentUserUid) return;
                    setTimeout(function() { syncVivoIniciar(true); syncVivoRecuperar('volvió la red'); }, 1500);
                });
            }
            // App abierta días seguidos (la PC de la barra): al cambiar la semana se vuelven a armar.
            _syncVivo.semanaTimer = setInterval(function() {
                if (currentUserUid && document.visibilityState !== 'hidden') syncVivoIniciar();
            }, SYNC_VIVO_SEMANA_MS);
        }

        function syncVivoEstado() {
            return { activo: _syncVivo.activo, semanas: _syncVivo.claveSemanas, escuchas: Object.keys(_syncVivo.escuchas),
                     ultimoCambio: _syncVivo.ultimoCambio, cambios: _syncVivo.cuenta.cambios, refrescos: _syncVivo.cuenta.refrescos };
        }

        if (typeof window !== 'undefined') {
            window.syncVivoIniciar = syncVivoIniciar;
            window.syncVivoDetener = syncVivoDetener;
            window.syncVivoRecuperar = syncVivoRecuperar;
            window.syncVivoEstado = syncVivoEstado;
            window.syncVivoDecidir = syncVivoDecidir;
            window.syncVivoSemanas = syncVivoSemanas;
            window.syncVivoMezclarCompra = syncVivoMezclarCompra;
        }
