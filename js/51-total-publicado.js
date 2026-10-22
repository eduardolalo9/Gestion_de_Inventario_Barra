        // ══════════════════════════════════════════════════════════════════════
        //  v5.19 — TOTAL PUBLICADO: el mismo Total para todo el equipo
        //  ────────────────────────────────────────────────────────────────────
        //  Problema (FASE 14, riesgo "medio" que quedó abierto): el Total se
        //  CALCULA en cada teléfono = saldo del último corte + compras − consumo
        //  por recetas. Para eso hay que leer compras y ventas, y las reglas solo
        //  dejan leerlas a quien tiene purchases.read / sales.read, porque esos
        //  documentos llevan dinero (costos, venta neta). Un bartender calculaba
        //  su Total sin compras ni ventas: un número distinto al del jefe.
        //
        //  Solución (decisión de Eduardo, 6-oct-2026: "solo cantidades, sin
        //  importes"): el teléfono de quien SÍ puede leer todo publica el
        //  resultado en UN documento, inventarioApp/{doc}/totalPublicado/actual,
        //  con cantidades por producto y nada de dinero. Quien no tiene esos
        //  permisos lo lee (un solo listener) y usa ese número.
        //
        //  Reglas del juego:
        //    · Solo se publica un Total COMPLETO: ancla vigente y compras y
        //      ventas leídas sin error. Un Total a medias no se publica.
        //    · Solo se escribe si cambió (huella): batería y datos móviles.
        //    · La hora de publicación la pone el SERVIDOR (request.time): el
        //      reloj atrasado de un teléfono no puede hacerlo pasar por nuevo.
        //    · Si el teléfono del bartender ya conoce un corte MÁS NUEVO que el
        //      del documento publicado, el publicado está viejo y no se usa.
        //    · Quien tiene los permisos sigue calculando su propio Total, igual
        //      que antes: esta capa solo cambia lo que ve quien no los tiene.
        // ══════════════════════════════════════════════════════════════════════

        var TOTAL_PUBLICADO_VERSION = 1;
        var TOTAL_PUBLICADO_MAX_DIAS = 62;          // días faltantes que viajan (más ya no aporta)
        var TOTAL_PUBLICADO_DEBOUNCE_MS = 4000;      // espera tras el último cambio antes de publicar
        var TOTAL_PUBLICADO_MIN_INTERVALO_MS = 20000; // como mucho un cálculo cada 20 s por repintado

        var _totalPublicado = { estado: 'sin_cargar', datos: null, unsub: null };
        var _totalPubUltimaHuella = null;
        var _totalPubTimer = null;
        var _totalPubEnVuelo = false;
        var _totalPubUltimoCalculo = 0;

        function _tpRed(n) { var x = Number(n); return isFinite(x) ? Math.round(x * 1000) / 1000 : 0; }

        /** djb2 sobre texto: basta para saber si algo cambió (no es seguridad). */
        function _tpHuella(txt) {
            var h = 5381;
            for (var i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0;
            return (h >>> 0).toString(36) + '.' + txt.length.toString(36);
        }

        function _tpAuthzListo() {
            return (typeof _authzState !== 'undefined' && _authzState && _authzState.loaded && typeof hasPermission === 'function');
        }

        /** ¿Este usuario puede calcular el Total completo (y por tanto publicarlo)? */
        function totalPublicadoPuedePublicar() {
            return _tpAuthzListo() && hasPermission('sales.read') && hasPermission('purchases.read');
        }

        /** ¿Este usuario debe usar el Total publicado? (le falta alguno de los dos permisos) */
        function totalPublicadoDebeUsar() {
            return _tpAuthzListo() && !(hasPermission('sales.read') && hasPermission('purchases.read'));
        }

        /**
         * totalPublicadoArmar(productos, existenciaDe, resumen, ancla, uid) — capa pura.
         * Arma el documento: por producto con Total OFICIAL, [valor, saldo del
         * corte, entradas, consumo]. Sin precios, sin importes. Los productos en
         * respaldo operativo no viajan: cada teléfono ya tiene su suma de áreas.
         */
        function totalPublicadoArmar(productos, existenciaDe, resumen, ancla, uid) {
            var valores = {}, n = 0, conEntradas = 0;
            (productos || []).forEach(function(p) {
                if (!p || !p.id) return;
                var r = existenciaDe(p);
                if (!r || r.origen !== 'oficial') return;
                var ent = _tpRed(r.entradas), ven = _tpRed(r.ventas);
                valores[String(p.id)] = [_tpRed(r.valor), _tpRed(r.inicial), ent, ven];
                if (ent) conEntradas++;
                n++;
            });
            var faltan = (resumen && Array.isArray(resumen.diasFaltantes)) ? resumen.diasFaltantes.slice(0, TOTAL_PUBLICADO_MAX_DIAS) : [];
            var doc = {
                version:           TOTAL_PUBLICADO_VERSION,
                ancla:             { tipo: ancla.tipo || null, fecha: ancla.fecha || null, id: ancla.id || null, hora: ancla.hora || null },
                valores:           valores,
                productos:         n,
                conEntradas:       conEntradas,
                diasEsperados:     resumen ? (resumen.diasEsperados || 0) : 0,
                diasFaltantes:     faltan,
                periodosIncluidos: resumen ? (resumen.periodosIncluidos || 0) : 0,
                periodosPartidos:  resumen && Array.isArray(resumen.periodosPartidos)
                                   ? resumen.periodosPartidos.slice(0, 10).map(function(x) { return { inicio: x.inicio, fin: x.fin }; }) : [],
                sinReceta:         (resumen && resumen.avisosConsumo && resumen.avisosConsumo.sinReceta) ? resumen.avisosConsumo.sinReceta.length : 0,
                publicadoPor:      uid || null
            };
            doc.huella = _tpHuella(JSON.stringify([doc.ancla, valores, faltan, doc.periodosPartidos]));
            return doc;
        }

        /**
         * ¿El publicado sirve frente a lo que este teléfono sabe del corte?
         * Si aquí ya se conoce un ancla más nueva (otro día, o el mismo día pero
         * distinta), el publicado es de antes de ese corte: no se usa.
         */
        function totalPublicadoVigente(datos, anclaLocal) {
            if (!datos || !datos.ancla || !datos.ancla.fecha || !datos.valores) return false;
            if (!anclaLocal || !anclaLocal.fecha) return true;
            if (anclaLocal.id && anclaLocal.id === datos.ancla.id) return true;
            return datos.ancla.fecha > anclaLocal.fecha;
        }

        /** Valor publicado para un producto, o null. Capa pura. */
        function totalPublicadoValor(datos, producto) {
            if (!datos || !datos.valores || !producto || !producto.id) return null;
            var v = datos.valores[String(producto.id)];
            if (!Array.isArray(v) || typeof v[0] !== 'number') return null;
            return { valor: v[0], inicial: v[1], entradas: v[2] || 0, ventas: v[3] || 0 };
        }

        function _tpAnclaLocal() {
            var est = (typeof existenciaInicialEstado === 'function') ? existenciaInicialEstado() : null;
            return (est && est.estado === 'ok' && est.ancla) ? est.ancla : null;
        }

        /** ¿En este teléfono, ahora, manda el Total publicado? */
        function totalPublicadoEnUso() {
            if (!totalPublicadoDebeUsar()) return false;
            if (_totalPublicado.estado !== 'ok') return false;
            // Solo con el corte vigente ya cargado en este teléfono: así un
            // publicado de un corte que ya caducó (más de 8 semanas) o que este
            // teléfono no puede confirmar (sin red) nunca se toma por bueno.
            var local = _tpAnclaLocal();
            if (!local) return false;
            return totalPublicadoVigente(_totalPublicado.datos, local);
        }

        /**
         * Lo que js/47 pregunta por cada producto. null = sigue el cálculo local
         * de siempre (tiene permisos, no hay publicado, está viejo, o el
         * producto no entró al corte).
         */
        function _totalPublicadoParaProducto(producto) {
            if (!totalPublicadoEnUso()) return null;
            var v = totalPublicadoValor(_totalPublicado.datos, producto);
            if (!v) return null;
            var d = _totalPublicado.datos;
            return { valor: v.valor, inicial: v.inicial, entradas: v.entradas, ventas: v.ventas,
                     ancla: { tipo: d.ancla.tipo, fecha: d.ancla.fecha, id: d.ancla.id, hora: d.ancla.hora || null, ruta: 'arrastre' },
                     publicadoEn: _tpMs(d.publicadoEn) };
        }

        /** Resumen para la tarjeta "Origen del Total" cuando manda el publicado. */
        function _totalPublicadoResumen() {
            if (!totalPublicadoEnUso()) return null;
            var d = _totalPublicado.datos;
            return {
                ancla:                { tipo: d.ancla.tipo, fecha: d.ancla.fecha, id: d.ancla.id, hora: d.ancla.hora || null, ruta: 'arrastre' },
                diasEsperados:        d.diasEsperados || 0,
                diasFaltantes:        Array.isArray(d.diasFaltantes) ? d.diasFaltantes.slice() : [],
                periodosIncluidos:    d.periodosIncluidos || 0,
                periodosPartidos:     Array.isArray(d.periodosPartidos) ? d.periodosPartidos.slice() : [],
                comprasNoDisponibles: false,
                ventasNoDisponibles:  false,
                avisosConsumo:        { sinReceta: [], sinCatalogo: [], uomDistinta: [] },
                publicado:            { en: _tpMs(d.publicadoEn), productos: d.productos || 0, conEntradas: d.conEntradas || 0 }
            };
        }

        function _tpMs(ts) {
            if (!ts) return null;
            if (typeof ts === 'number') return ts;
            if (typeof ts.toMillis === 'function') return ts.toMillis();
            if (typeof ts.seconds === 'number') return ts.seconds * 1000;
            return null;
        }

        function _tpRef() {
            return _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID).collection('totalPublicado').doc('actual');
        }

        // ── Quien NO tiene los permisos: escucha el documento ─────────────────
        function totalPublicadoSuscribir() {
            if (_totalPublicado.unsub || typeof _db === 'undefined' || !_db) return;
            if (!totalPublicadoDebeUsar()) return;
            _totalPublicado.estado = 'cargando';
            try {
                _totalPublicado.unsub = _tpRef().onSnapshot(function(snap) {
                    var antes = _totalPublicado.datos ? _totalPublicado.datos.huella : null;
                    if (!snap.exists) { _totalPublicado.estado = 'no_existe'; _totalPublicado.datos = null; }
                    else { _totalPublicado.estado = 'ok'; _totalPublicado.datos = snap.data() || null; }
                    var ahora = _totalPublicado.datos ? _totalPublicado.datos.huella : null;
                    if (antes !== ahora && typeof existenciaRepintarSeguro === 'function') existenciaRepintarSeguro();
                }, function(e) {
                    console.warn('[TotalPublicado] No se pudo escuchar el Total publicado:', e && (e.code || e.message));
                    _totalPublicado.estado = 'error';
                    _totalPublicado.unsub = null;
                });
            } catch (e) {
                console.warn('[TotalPublicado] Suscripción falló:', e);
                _totalPublicado.estado = 'error';
            }
        }

        function totalPublicadoDesuscribir() {
            if (_totalPublicado.unsub) { try { _totalPublicado.unsub(); } catch (_) {} }
            _totalPublicado = { estado: 'sin_cargar', datos: null, unsub: null };
        }

        // ── Quien SÍ tiene los permisos: publica cuando cambia ────────────────

        /** Documento a publicar ahora, o null con el motivo. Sin efectos. */
        function totalPublicadoPreparar() {
            if (!totalPublicadoPuedePublicar()) return { doc: null, motivo: 'sin_permiso' };
            var est = (typeof existenciaInicialEstado === 'function') ? existenciaInicialEstado() : null;
            if (!est || est.estado !== 'ok' || !est.ancla || est.ancla.ruta !== 'arrastre') return { doc: null, motivo: 'sin_ancla' };
            var res = (typeof existenciaArrastreResumen === 'function') ? existenciaArrastreResumen() : null;
            if (!res) return { doc: null, motivo: 'sin_resumen' };
            if (res.comprasNoDisponibles || res.ventasNoDisponibles) return { doc: null, motivo: 'incompleto' };
            var ent = existenciaEntradas(), ven = existenciaVentas();
            var doc = totalPublicadoArmar((typeof products !== 'undefined') ? products : [],
                                          function(p) { return existenciaOficial(p, ent, ven); },
                                          res, est.ancla, (typeof currentUserUid !== 'undefined') ? currentUserUid : null);
            if (!doc.productos) return { doc: null, motivo: 'sin_productos' };
            return { doc: doc, motivo: null };
        }

        async function totalPublicadoPublicarAhora() {
            if (_totalPubEnVuelo) return { ok: false, motivo: 'en_vuelo' };
            if (typeof _db === 'undefined' || !_db) return { ok: false, motivo: 'sin_db' };
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, motivo: 'sin_conexion' };
            var prep = totalPublicadoPreparar();
            if (!prep.doc) return { ok: false, motivo: prep.motivo };
            if (prep.doc.huella === _totalPubUltimaHuella) return { ok: false, motivo: 'sin_cambios' };
            _totalPubEnVuelo = true;
            try {
                var doc = Object.assign({}, prep.doc, { publicadoEn: firebase.firestore.FieldValue.serverTimestamp() });
                await _tpRef().set(doc);
                _totalPubUltimaHuella = prep.doc.huella;
                return { ok: true, huella: prep.doc.huella, productos: prep.doc.productos };
            } catch (e) {
                console.warn('[TotalPublicado] No se pudo publicar:', e && (e.code || e.message));
                return { ok: false, motivo: 'error', error: e };
            } finally {
                _totalPubEnVuelo = false;
            }
        }

        /**
         * Pide publicar (con espera): lo llaman la carga del Total y el
         * repintado. `forzar` salta el intervalo mínimo (cambió el ancla, se
         * guardó una venta o una compra).
         */
        function totalPublicadoQuizasPublicar(forzar) {
            if (!totalPublicadoPuedePublicar()) {
                // Si perdió los permisos (o es bartender), escucha en vez de publicar.
                if (totalPublicadoDebeUsar()) totalPublicadoSuscribir();
                return;
            }
            var ahora = Date.now();
            if (!forzar && ahora - _totalPubUltimoCalculo < TOTAL_PUBLICADO_MIN_INTERVALO_MS) return;
            if (_totalPubTimer) clearTimeout(_totalPubTimer);
            _totalPubTimer = setTimeout(function() {
                _totalPubTimer = null;
                _totalPubUltimoCalculo = Date.now();
                totalPublicadoPublicarAhora();
            }, TOTAL_PUBLICADO_DEBOUNCE_MS);
        }

        /** Lo llama js/47 cada vez que el Total queda cargado (o recargado). */
        function totalPublicadoAlCambiarExistencia() {
            if (totalPublicadoDebeUsar()) { totalPublicadoSuscribir(); return; }
            totalPublicadoQuizasPublicar(true);
        }

        /** Para la tarjeta del panel: ¿quién manda y desde cuándo? */
        function totalPublicadoInfo() {
            return {
                debeUsar:  totalPublicadoDebeUsar(),
                enUso:     totalPublicadoEnUso(),
                estado:    _totalPublicado.estado,
                publicadoEn: _totalPublicado.datos ? _tpMs(_totalPublicado.datos.publicadoEn) : null,
                anclaPublicada: _totalPublicado.datos ? _totalPublicado.datos.ancla : null
            };
        }

        window.totalPublicadoArmar        = totalPublicadoArmar;
        window.totalPublicadoValor        = totalPublicadoValor;
        window.totalPublicadoVigente      = totalPublicadoVigente;
        window.totalPublicadoPuedePublicar = totalPublicadoPuedePublicar;
        window.totalPublicadoDebeUsar     = totalPublicadoDebeUsar;
        window.totalPublicadoEnUso        = totalPublicadoEnUso;
        window.totalPublicadoSuscribir    = totalPublicadoSuscribir;
        window.totalPublicadoDesuscribir  = totalPublicadoDesuscribir;
        window.totalPublicadoPreparar     = totalPublicadoPreparar;
        window.totalPublicadoPublicarAhora = totalPublicadoPublicarAhora;
        window.totalPublicadoQuizasPublicar = totalPublicadoQuizasPublicar;
        window.totalPublicadoAlCambiarExistencia = totalPublicadoAlCambiarExistencia;
        window.totalPublicadoInfo         = totalPublicadoInfo;
        window._totalPublicadoParaProducto = _totalPublicadoParaProducto;
        window._totalPublicadoResumen     = _totalPublicadoResumen;
