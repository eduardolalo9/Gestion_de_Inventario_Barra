        // ══════════════════════════════════════════════════════════════════════
        //  MÓDULO DE COMPRAS
        //  ────────────────────────────────────────────────────────────────────
        //  FASE 4A — persistencia real y libro de movimientos (guardarCompra,
        //  cargarComprasDeLaSemana, cargarComprasIniciales).
        //  FASE 4B — importación desde el Excel real de "Entrada de mercancía"
        //  (columnas verificadas contra archivos reales de SAP — ver
        //  claude/fase4-anexo-excel-real-2026-09-20.md).
        //
        //  Modelo del negocio, tal como lo describió Eduardo:
        //  el almacén "12 — BARRA MOCHOMOS MONTERREY" de SAP NO es ninguna de las
        //  tres zonas de conteo. Es la barra entera, un único stock. Las zonas
        //  almacen / barra1 / barra2 solo existen para contar físicamente y se
        //  totalizan al cerrar. El ciclo es semanal:
        //
        //      inicial de la semana + compras − ventas = teórico
        //      suma de los tres conteos              = físico
        //
        //  Por eso una compra NO se reparte entre zonas: entra al stock de la
        //  barra y punto. Es la razón de que aquí no haya ningún campo de área.
        //
        //  DOS CAPAS, NO UNA (ver diseño §2.2):
        //    compras/{compraId}     EL HECHO — inmutable, tal cual lo dijo SAP.
        //    movimientos/{movId}    EL EFECTO — un asiento por línea, id
        //                           determinista compra_{compraId}_{productoId}.
        //
        //  LO QUE ESTE MÓDULO DELIBERADAMENTE NO HACE (§2.4 del diseño):
        //    no escribe en stockAreas, no mete compras en el payload de
        //    syncToCloud, no persiste el stock teórico (se calcula, no se
        //    guarda), no borra nada. v5.27: purchases.delete CANCELA (marca cancelada,
        //    no borra) — ver cancelarCompra() más abajo.
        //
        //  ALCANCE DE ESTA FASE — nada de lo siguiente se toca aquí:
        //  ventas, recetas, consumo_venta, stockTeorico, calcularDesviacion,
        //  stockAreas, pv, sku, pvParrot. El libro de movimientos solo admite
        //  tipo:'compra' (firestore.rules ya lo exige en el servidor).
        // ══════════════════════════════════════════════════════════════════════

        // ── D-2: el único almacén de SAP que le compete a BarInventory ─────────
        const ALMACEN_BARRA_CODIGO = '12';

        // ══════════════════════════════════════════════════════════════════════
        //  UTILIDADES DE FORMATO (ya existían, sin cambios de comportamiento)
        // ══════════════════════════════════════════════════════════════════════

        function _comprasOrdenadas(lista) {
            // v5.27 — por FECHA DE INGRESO, la más reciente primero (pedido de
            // Eduardo, 12-oct-2026). Misma fecha de ingreso → fecha del
            // documento SAP; y luego folio descendente, el orden en que SAP
            // los genera. `lista` es opcional (por defecto, todas).
            return (lista || compras).slice().sort(function(a, b) {
                var fa = _fechaIngresoDe(a), fb = _fechaIngresoDe(b);
                if (fa !== fb) return fb.localeCompare(fa);
                if ((a.fecha || '') !== (b.fecha || '')) return (b.fecha || '').localeCompare(a.fecha || '');
                return String(b.folio || '').localeCompare(String(a.folio || ''), 'es', { numeric: true });
            });
        }

        function _dineroMX(n) {
            var v = (typeof n === 'number' && isFinite(n)) ? n : 0;
            return '$' + v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        function _fechaLarga(iso) {
            // Las fechas llegan como '2026-09-09'. Se formatean SIN pasar por
            // new Date(iso), que interpreta la cadena como UTC y en México
            // muestra el día anterior.
            var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
            if (!m) return String(iso || '—');
            var meses = ['enero','febrero','marzo','abril','mayo','junio',
                         'julio','agosto','septiembre','octubre','noviembre','diciembre'];
            return parseInt(m[3], 10) + ' de ' + meses[parseInt(m[2], 10) - 1] + ' de ' + m[1];
        }

        // ── v5.27 — estado y fecha de ingreso de una compra ────────────────────
        /** true si la entrada fue cancelada (sigue en el historial, no suma al Total). */
        function compraCancelada(c) {
            return !!(c && c.cancelada === true);
        }

        /**
         * Fecha de ingreso de una compra: la que se pidió al importar
         * (fechaIngreso, v5.27). Las compras importadas antes no la tienen y
         * caen a la fecha del documento de SAP. Decisión de Eduardo
         * (12-oct-2026): la fecha de ingreso es INFORMATIVA — ordena y se
         * muestra, pero la semana y el Total siguen usando `fecha` (SAP).
         */
        function _fechaIngresoDe(c) {
            return (c && (c.fechaIngreso || c.fecha)) || '';
        }

        // ── Total de unidades de una compra: suma de cantidadInventario de sus
        //    líneas. FASE 4 cambió `lineas` de número (conteo, esquema P1) a
        //    ARRAY de renglones reales — este helper es la única fuente de la
        //    verdad para "cuántas unidades trae" y evita repetir el reduce en
        //    cada punto que lo necesita.
        function _unidadesCompra(c) {
            if (!c || !Array.isArray(c.lineas)) return 0;
            return c.lineas.reduce(function(a, l) { return a + (l.cantidadInventario || 0); }, 0);
        }

        // ── Resumen de la cabecera ────────────────────────────────────────────
        function _resumenCompras() {
            // v5.27 — las canceladas no cuentan como documentos ni importe:
            // se informan aparte.
            var activas = compras.filter(function(c) { return !compraCancelada(c); });
            var r = { documentos: activas.length, lineas: 0, importe: 0,
                      proveedores: {}, ultima: null,
                      canceladas: compras.length - activas.length };
            activas.forEach(function(c) {
                r.lineas  += Array.isArray(c.lineas) ? c.lineas.length : 0;
                r.importe += (c.importe || 0);
                if (c.proveedorNombre) r.proveedores[c.proveedorNombre] = true;
                if (!r.ultima || (c.fecha || '') > r.ultima) r.ultima = c.fecha;
            });
            r.proveedores = Object.keys(r.proveedores).length;
            return r;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  IDENTIDAD E IDEMPOTENCIA
        // ══════════════════════════════════════════════════════════════════════

        /**
         * _compraId(docSap, folio)
         * Id determinista del documento — la llave de idempotencia. Firestore
         * rechaza en el servidor un create sobre un id que ya existe (ver
         * firestore.rules: compras/{compraId}, allow update, delete: if false),
         * así que reimportar el mismo archivo dos veces no duplica nada.
         *
         * Prioridad: Doc SAP sobre Folio (hallazgo (c) del anexo del 20/09):
         * el Doc SAP ata la entrada a un movimiento YA confirmado en el sistema
         * contable; el Folio es previo a esa confirmación y en teoría podría
         * reasignarse. Si algún día llega una entrada sin Doc SAP (una captura
         * manual, o una del portal que aún no sincronizó), cae al folio.
         */
        function _compraId(docSap, folio) {
            if (docSap !== undefined && docSap !== null && String(docSap).trim() !== '') {
                return 'sap-' + String(docSap).trim();
            }
            return 'folio-' + String(folio || '').trim();
        }

        /**
         * _parsearCodigoNombre(cadena, soloDigitos)
         * El proveedor Y el almacén viajan en el Excel real como una sola
         * celda "código — nombre" (p.ej. "P00106 — VINOTECA MEXICO",
         * "12 — BARRA MOCHOMOS MONTERREY"), separados por un guion largo con
         * espacios. Si el separador no aparece, toda la cadena se guarda como
         * nombre y el código queda vacío — no se descarta la fila por esto.
         *
         * v5.26 (hallazgo #15) — EXCEPCIÓN para el Almacén: su código es
         * siempre puramente numérico ("12"), y algún export lo trae SIN el
         * " — nombre" (solo "12", o "12" con espacios). Sin esta excepción,
         * _parsearExcelCompras() comparaba almacen.codigo ('') contra
         * ALMACEN_BARRA_CODIGO ('12'), nunca coincidía, y la fila se
         * descartaba en silencio como "de otro almacén" — perdiendo una
         * compra real de la barra por un formato de celda más corto, no por
         * pertenecer a otro almacén (D-2). Con soloDigitos:true, una cadena
         * sin separador que son TODO dígitos se trata como código, no como
         * nombre. El proveedor (letras + dígitos, "P00106") no pide esto y
         * sigue exactamente igual que antes.
         */
        function _parsearCodigoNombre(cadena, soloDigitos) {
            var s = String(cadena == null ? '' : cadena).trim();
            var partes = s.split(/\s+—\s+/);
            if (partes.length >= 2) {
                return { codigo: partes[0].trim(), nombre: partes.slice(1).join(' — ').trim() };
            }
            // Respaldo: algún export podría usar un guion simple en vez de em-dash.
            partes = s.split(/\s+-\s+/);
            if (partes.length >= 2) {
                return { codigo: partes[0].trim(), nombre: partes.slice(1).join(' - ').trim() };
            }
            if (soloDigitos && /^\d+$/.test(s)) return { codigo: s, nombre: '' };
            return { codigo: '', nombre: s };
        }

        // ══════════════════════════════════════════════════════════════════════
        //  EL LIBRO DE MOVIMIENTOS — el efecto, derivado del hecho
        // ══════════════════════════════════════════════════════════════════════

        /**
         * _asientosDesdeCompra(compra)
         * Traduce cada línea EN CATÁLOGO a un asiento del libro. Una línea
         * cuyo producto no existe en el catálogo (enCatalogo:false) no genera
         * asiento — se queda registrada en la compra (el hecho no se altera)
         * pero no puede sumar a ningún stock que no exista.
         */
        function _asientosDesdeCompra(compra) {
            if (!compra || !Array.isArray(compra.lineas)) return [];
            // v5.27 — una compra CANCELADA no genera efecto: sigue siendo un
            // hecho registrado (con quién, cuándo y por qué), pero no suma a
            // ningún stock. Como TODO el cálculo del Total pasa por aquí
            // (memoria, arrastre leído de Firestore, sync en vivo), basta con
            // esta guarda para que ninguna ruta la cuente.
            if (compraCancelada(compra)) return [];
            return compra.lineas
                .filter(function(l) { return l.enCatalogo !== false; })
                .map(function(l) {
                    return {
                        movId:       'compra_' + compra.compraId + '_' + l.productoId,
                        tipo:        'compra',
                        productoId:  l.productoId,
                        cantidad:    l.cantidadInventario,
                        fecha:       compra.fecha,
                        semanaId:    compra.semanaId,
                        origen: {
                            tipo:            'compra',
                            compraId:        compra.compraId,
                            folio:           compra.folio,
                            proveedorNombre: compra.proveedorNombre
                        },
                        costoUnitario: l.costoUnitario,
                        creadoPor:     compra.creadoPor,
                        creadoEn:      compra.creadoEn
                    };
                });
        }

        // ══════════════════════════════════════════════════════════════════════
        //  GUARDADO — el batch por folio
        // ══════════════════════════════════════════════════════════════════════

        /**
         * _verificarCompraExistente(compraId)
         * Espejo de _verificarInicialExistente (FASE 3), con una diferencia
         * real: el id de una compra SALE del propio Doc SAP/Folio, así que no
         * existe el caso "otro origen distinto ocupó este id" que sí existe en
         * inventariosIniciales (una semana puede, en teoría, disputarse entre
         * dos inventarios). Si el documento existe, es inequívocamente la
         * misma entrada — por eso `mismoOrigen` siempre es `true` cuando
         * `existe` lo es.
         */
        async function _verificarCompraExistente(compraId) {
            try {
                const snap = await _db.collection('compras').doc(compraId).get();
                if (!snap.exists) return { existe: false };
                return { existe: true, mismoOrigen: true, datos: snap.data() };
            } catch (e) {
                console.warn('[Compras] No se pudo verificar si la compra ya existía:', e);
                return { existe: false, error: true };
            }
        }

        // Aplica una compra ya confirmada por el servidor al estado local, sin
        // duplicar si ya estaba (p.ej. porque cargarComprasIniciales() la trajo
        // primero, o porque guardarCompra() se reintentó tras un timeout).
        //
        // v5.27 — ahora también REEMPLAZA: desde que una compra se puede
        // cancelar (y una cancelada volver a ingresarse), la versión del
        // servidor puede ser distinta de la que guarda el dispositivo. Si
        // difiere, gana el servidor y los asientos de esa compra se
        // reconstruyen desde cero (una cancelada se queda sin ninguno).
        // Devuelve true si cambió algo en `compras`.
        function _agregarCompraLocal(compra, asientos) {
            if (!compra || !compra.compraId) return false;
            var i = -1;
            for (var k = 0; k < compras.length; k++) {
                if (compras[k] && compras[k].compraId === compra.compraId) { i = k; break; }
            }
            var cambio = false;
            if (i === -1) {
                compras.push(compra);
                cambio = true;
            } else {
                var igual = false;
                try { igual = JSON.stringify(compras[i]) === JSON.stringify(compra); } catch (_) { igual = false; }
                if (!igual) {
                    compras[i] = compra;
                    _quitarAsientosDeCompra(compra.compraId);
                    if (typeof existenciaOlvidarCompra === 'function') existenciaOlvidarCompra(compra.compraId);
                    cambio = true;
                }
            }
            (asientos || []).forEach(function(m) {
                if (!movimientos.some(function(x) { return x.movId === m.movId; })) {
                    movimientos.push(m);
                }
            });
            return cambio;
        }

        /**
         * Quita del libro local los asientos de una compra. EN SU LUGAR
         * (splice), no reasignando `movimientos`: js/54 sostiene una
         * referencia al mismo arreglo mientras mezcla un lote del servidor.
         */
        function _quitarAsientosDeCompra(compraId) {
            if (typeof movimientos === 'undefined' || !Array.isArray(movimientos)) return 0;
            var quitados = 0;
            for (var j = movimientos.length - 1; j >= 0; j--) {
                var m = movimientos[j];
                if (m && m.origen && m.origen.compraId === compraId) { movimientos.splice(j, 1); quitados++; }
            }
            return quitados;
        }

        /**
         * guardarCompra(compra)
         * El batch por folio. Un batch, no uno por archivo: el límite real de
         * Firestore son 500 operaciones y una importación interrumpida a
         * medias debe poder reanudarse simplemente reintentando — el id
         * determinista hace que los folios ya escritos se rechacen solos.
         *
         * `compra` ya debe traer compraId, semanaId, lineas[] y demás campos
         * completos (ver _parsearExcelCompras para el camino de importación).
         */
        async function guardarCompra(compra) {
            // v5.26 (hallazgo #15) — purchases.import TAMBIÉN habilita este
            // guardado, no solo purchases.create. guardarCompra() es la
            // única función que escribe en compras/movimientos, y la usan
            // DOS flujos con DOS permisos ya delegables: "Capturar a mano"
            // (purchases.create) y "confirmar importación" al final de
            // Importar desde Excel (purchases.import). Antes, delegar solo
            // purchases.import (más sensible, pensado para esto) dejaba leer
            // el Excel y ver la vista previa, pero CADA fila fallaba aquí al
            // confirmar — la importación nunca se completaba. Decisión de
            // Eduardo (11-oct-2026): alinear, no exigir los dos a la vez.
            if (!hasPermission('purchases.create') && !hasPermission('purchases.import')) {
                return { ok: false, motivo: 'sin_permiso' };
            }
            if (!_db)              return { ok: false, motivo: 'sin_firestore' };
            if (!navigator.onLine) return { ok: false, motivo: 'sin_conexion' };
            if (!compra || !compra.compraId) return { ok: false, motivo: 'compra_invalida' };

            const previo = await _verificarCompraExistente(compra.compraId);
            let reingreso = false;
            if (previo.existe && !compraCancelada(previo.datos)) {
                // Idempotencia real: reimportar el mismo folio no es un error,
                // es un no-op informado.
                _agregarCompraLocal(previo.datos, _asientosDesdeCompra(previo.datos));
                return { ok: true, motivo: 'ya_existia', datos: previo.datos };
            }
            if (previo.existe && compraCancelada(previo.datos)) {
                // v5.27 — REINGRESO: la misma entrada se canceló antes (p.ej. se
                // importó con un dato equivocado) y ahora vuelve. El id es el
                // mismo (Doc SAP / folio), así que se sobrescribe la cancelada
                // — nunca hay dos activas — y el rastro de la cancelación
                // viaja en `cancelaciones` para que no se pierda.
                const d = previo.datos;
                compra = Object.assign({}, compra, {
                    cancelada: false,
                    cancelaciones: (Array.isArray(d.cancelaciones) ? d.cancelaciones : []).concat([{
                        canceladaEn:        d.canceladaEn || null,
                        canceladaPor:       d.canceladaPor || null,
                        canceladaPorNombre: d.canceladaPorNombre || '',
                        motivo:             d.motivoCancelacion || '',
                        fechaIngreso:       d.fechaIngreso || null
                    }]).slice(-20)
                });
                reingreso = true;
            }

            const asientos = _asientosDesdeCompra(compra);
            try {
                const batch = _db.batch();
                const res = _escribirCompraEnBatch(batch, compra, asientos);
                if (!res.ok) return { ok: false, motivo: res.motivo, totalOps: res.totalOps };
                await batch.commit();

                // Solo tras la confirmación del servidor se refleja localmente
                // (mismo principio que contabilizarInventario en FASE 3: nunca
                // avanzar el estado local por delante de lo que el servidor
                // ya aceptó).
                _agregarCompraLocal(compra, asientos);
                saveToLocalStorage();

                _registrarEnSyncQueue({
                    tipo: (compra.origen === 'manual') ? 'compra_manual' : 'compra_importada',
                    detalle: (reingreso ? 'Reingreso de entrada cancelada ' : 'Entrada de mercancía ') +
                             (compra.docSap ? 'Doc SAP ' + compra.docSap : 'folio ' + compra.folio) +
                             ' — ' + compra.proveedorNombre + ' — ' + compra.lineas.length + ' línea(s) — ' +
                             _dineroMX(compra.importe),
                    compraId: compra.compraId,
                    importe:  compra.importe,
                    motivo:   'Registro de compra'
                });

                return { ok: true, motivo: reingreso ? 'reingresada' : 'creada', compra: compra };
            } catch (err) {
                console.error('[Compras] Error guardando compra ' + compra.compraId + ':', err);
                // Mismo manejo que FASE 3: un permission-denied puede significar
                // que el batch SÍ llegó a confirmarse y solo se perdió la
                // respuesta (corte de red justo después del commit).
                if (err && err.code === 'permission-denied') {
                    const post = await _verificarCompraExistente(compra.compraId);
                    // v5.27 — si sigue CANCELADA, el reingreso no llegó: es un rechazo real.
                    if (post.existe && !compraCancelada(post.datos)) {
                        _agregarCompraLocal(post.datos, _asientosDesdeCompra(post.datos));
                        saveToLocalStorage();
                        return { ok: true, motivo: 'ya_existia', datos: post.datos };
                    }
                    return { ok: false, motivo: 'permiso_denegado' };
                }
                return { ok: false, motivo: (typeof _esErrorDeRed === 'function' && _esErrorDeRed(err)) ? 'error_red' : 'error' };
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  v5.27 — CANCELAR UNA ENTRADA
        //  ────────────────────────────────────────────────────────────────────
        //  Decisiones de Eduardo (12-oct-2026):
        //    · Se MARCA como cancelada, no se borra: el documento queda en
        //      compras/{id} con cancelada:true, quién, cuándo y el motivo
        //      (obligatorio), y la pantalla la sigue mostrando tachada.
        //    · Deja de sumar al Total en todos los dispositivos (ver la guarda
        //      en _asientosDesdeCompra) y sus asientos de movimientos/ se
        //      BORRAN en el mismo batch: el libro no puede decir que entró
        //      mercancía que la compra ya no respalda.
        //    · Solo administración (isAdmin + purchases.delete, no delegable).
        //      Las reglas lo exigen igual en el servidor (isAdminUser()).
        //    · Si la misma entrada se vuelve a importar, se reingresa (ver
        //      guardarCompra) conservando el rastro en `cancelaciones`.
        //  Integridad: exige conexión (cancelar a medias entre dispositivos
        //  movería el Total de unos y no de otros) y decide con la versión del
        //  SERVIDOR, no con la copia local, que puede estar vieja.
        // ══════════════════════════════════════════════════════════════════════

        const MOTIVO_CANCELACION_MIN = 5;
        const MOTIVO_CANCELACION_MAX = 200;

        function puedeCancelarCompras() {
            return typeof isAdmin === 'function' && isAdmin()
                && typeof hasPermission === 'function' && hasPermission('purchases.delete');
        }

        function _nombreSesionCompras() {
            var n = (typeof auditCurrentUser !== 'undefined' && auditCurrentUser && auditCurrentUser.userName) || '';
            if (!n && typeof _auth !== 'undefined' && _auth && _auth.currentUser) {
                n = _auth.currentUser.displayName || _auth.currentUser.email || '';
            }
            return String(n || '').trim().slice(0, 60);
        }

        /**
         * cancelarCompra(compraId, motivo)
         * @returns {Promise<{ok, motivo, compra?}>} motivo ∈ cancelada |
         *   ya_cancelada | sin_permiso | motivo_corto | sin_firestore |
         *   sin_conexion | compra_invalida | no_existe | permiso_denegado |
         *   error_red | error
         */
        async function cancelarCompra(compraId, motivo) {
            if (!puedeCancelarCompras()) return { ok: false, motivo: 'sin_permiso' };
            var texto = String(motivo == null ? '' : motivo).replace(/\s+/g, ' ').trim();
            if (texto.length < MOTIVO_CANCELACION_MIN) return { ok: false, motivo: 'motivo_corto' };
            texto = texto.slice(0, MOTIVO_CANCELACION_MAX);
            if (!_db)              return { ok: false, motivo: 'sin_firestore' };
            if (!navigator.onLine) return { ok: false, motivo: 'sin_conexion' };
            if (!compraId)         return { ok: false, motivo: 'compra_invalida' };

            var ref = _db.collection('compras').doc(String(compraId));
            var actual;
            try {
                var snap = await ref.get();
                if (!snap.exists) return { ok: false, motivo: 'no_existe' };
                actual = snap.data();
            } catch (e) {
                console.warn('[Compras] No se pudo leer la compra a cancelar:', e);
                return { ok: false, motivo: (typeof _esErrorDeRed === 'function' && _esErrorDeRed(e)) ? 'error_red' : 'error' };
            }
            if (compraCancelada(actual)) {
                // Otro dispositivo se adelantó: no es error, solo se pone al día.
                _agregarCompraLocal(actual, []);
                saveToLocalStorage();
                return { ok: true, motivo: 'ya_cancelada', compra: actual };
            }

            var cambios = {
                cancelada:          true,
                canceladaEn:        Date.now(),
                canceladaPor:       (typeof currentUserUid !== 'undefined' && currentUserUid) || null,
                canceladaPorNombre: _nombreSesionCompras(),
                motivoCancelacion:  texto
            };
            // Los asientos que se borran salen de la versión del servidor
            // (todas sus líneas en catálogo), no de la copia local.
            var asientos = _asientosDesdeCompra(actual);
            try {
                var batch = _db.batch();
                batch.update(ref, cambios);
                asientos.forEach(function(m) {
                    batch.delete(_db.collection('movimientos').doc(m.movId));
                });
                await batch.commit();
            } catch (err) {
                console.error('[Compras] Error cancelando la compra ' + compraId + ':', err);
                if (err && err.code === 'permission-denied') return { ok: false, motivo: 'permiso_denegado' };
                return { ok: false, motivo: (typeof _esErrorDeRed === 'function' && _esErrorDeRed(err)) ? 'error_red' : 'error' };
            }

            // Solo tras la confirmación del servidor se refleja localmente.
            var cancelada = Object.assign({}, actual, cambios);
            _agregarCompraLocal(cancelada, []);
            saveToLocalStorage();
            try {
                _registrarEnSyncQueue({
                    tipo: 'compra_cancelada',
                    detalle: 'Entrada cancelada ' +
                             (cancelada.docSap ? 'Doc SAP ' + cancelada.docSap : 'folio ' + cancelada.folio) +
                             ' — ' + (cancelada.proveedorNombre || 'Sin proveedor') + ' — ' + _dineroMX(cancelada.importe) +
                             ' — motivo: ' + texto,
                    compraId: cancelada.compraId,
                    importe:  cancelada.importe,
                    motivo:   'Cancelación de compra'
                });
            } catch (_) { /* el registro nunca interrumpe */ }
            if (typeof existenciaRepintarSeguro === 'function') existenciaRepintarSeguro();
            if (typeof totalPublicadoAlCambiarExistencia === 'function') {
                try { totalPublicadoAlCambiarExistencia(); } catch (_) {}
            }
            return { ok: true, motivo: 'cancelada', compra: cancelada };
        }

        // ══════════════════════════════════════════════════════════════════════
        //  CARGA — siempre acotada, nunca "todas las compras"
        // ══════════════════════════════════════════════════════════════════════

        /** Consulta las compras de UNA semana. Nunca se pide la colección entera. */
        async function cargarComprasDeLaSemana(idSemana) {
            if (!_db || !idSemana) return [];
            try {
                const snap = await _db.collection('compras').where('semanaId', '==', idSemana).get();
                return snap.docs.map(function(d) { return d.data(); });
            } catch (e) {
                console.warn('[Compras] No se pudieron cargar las compras de la semana ' + idSemana + ':', e);
                return [];
            }
        }

        /**
         * cargarComprasIniciales()
         * Se llama UNA vez al arrancar (ver js/60-arranque.js, después de
         * loadFromCloud()). Trae la semana en curso y la anterior — suficiente
         * para que la pestaña no arranque vacía sin violar "nunca todas las
         * compras". Los asientos de movimientos NO se leen de Firestore aparte:
         * son una función determinista de cada compra, así que se derivan
         * localmente con _asientosDesdeCompra (misma fuente de verdad que
         * escribe guardarCompra()).
         */
        async function cargarComprasIniciales() {
            if (!_db || !navigator.onLine) return;
            try {
                const hoy      = semanaId(new Date());
                const anterior = semanaAnterior(hoy);
                const [actual, previa] = await Promise.all([
                    cargarComprasDeLaSemana(hoy),
                    anterior ? cargarComprasDeLaSemana(anterior) : Promise.resolve([])
                ]);
                const traidas = actual.concat(previa);
                let nuevas = 0;
                traidas.forEach(function(c) {
                    // v5.27 — cuenta también las que cambiaron (p.ej. se
                    // cancelaron en otro dispositivo mientras este no estaba).
                    if (_agregarCompraLocal(c, _asientosDesdeCompra(c))) nuevas++;
                });
                if (nuevas > 0) {
                    saveToLocalStorage();
                    if (typeof activeTab !== 'undefined' && activeTab === 'compras') renderTab();
                    console.info('[Compras] ' + nuevas + ' compra(s) cargada(s) desde Firestore al arrancar.');
                }
            } catch (e) {
                console.warn('[Compras] Error en cargarComprasIniciales:', e);
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  DIFERENCIA DE COSTO — solo avisa, nunca reescribe el catálogo (§2.5)
        // ══════════════════════════════════════════════════════════════════════

        /**
         * _diferenciasDeCosto(compra)
         * Compara el costo de cada línea contra product.precio. Devuelve solo
         * diferencias ≥ 1% para no llenar la pantalla de ruido por centavos de
         * redondeo. IMPORTANTE (hallazgo f del anexo): el costo que trae el
         * Excel es precio de LISTA, sin descuento ni IVA — casi siempre será
         * MAYOR que el costo real pagado. Este aviso informa, nunca actualiza
         * product.precio por su cuenta.
         */
        function _diferenciasDeCosto(compra) {
            if (!compra || !Array.isArray(compra.lineas)) return [];
            var out = [];
            compra.lineas.forEach(function(l) {
                if (!l.enCatalogo) return;
                var prod = products.find(function(p) { return p.id === l.productoId; });
                if (!prod || typeof prod.precio !== 'number' || prod.precio <= 0) return;
                var pct = ((l.costoUnitario - prod.precio) / prod.precio) * 100;
                if (Math.abs(pct) >= 1) {
                    out.push({
                        productoId:     l.productoId,
                        nombre:         prod.name,
                        precioCatalogo: prod.precio,
                        costoCompra:    l.costoUnitario,
                        pct:            Math.round(pct * 10) / 10
                    });
                }
            });
            return out;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  IMPORTACIÓN DESDE EXCEL — mapa de columnas verificado contra el
        //  archivo real de SAP (folio 3646/doc 27615, folio 3350/doc 27568).
        // ══════════════════════════════════════════════════════════════════════

        // _normCabCompras/_findColCompras son una COPIA deliberada de
        // _normCab/findCol (js/90-ciclo-admin.js:104,109), no un reuso. Esas dos
        // viven dentro de la clausura de handleFileImport() y elevarlas al
        // ámbito del módulo tocaría la ruta de importación del catálogo — código
        // en producción por el que pasan 424 productos reales. El plan (§4 del
        // diseño de FASE 4) condicionaba ese refactor a poder correr
        // prueba-p0.js antes y después con las mismas cifras; la red de este
        // entorno bloquea cdnjs.cloudflare.com (verificado: CONNECT tunnel
        // failed, 403), de donde se carga XLSX, así que prueba-p0.js no puede
        // ejecutarse aquí. Se documenta como deuda técnica visible en vez de
        // arriesgar un refactor sin red de seguridad.
        function _normCabCompras(s) {
            return String(s == null ? '' : s)
                .replace(/\s+/g, ' ').trim().toLowerCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '');
        }
        function _findColCompras(row, keys) {
            if (!keys) return undefined;
            for (var i = 0; i < keys.length; i++) {
                if (row[keys[i]] !== undefined && row[keys[i]] !== null && row[keys[i]] !== '') return row[keys[i]];
            }
            if (!row.__cabNormCompras) {
                var mapa = {};
                Object.keys(row).forEach(function(k) { mapa[_normCabCompras(k)] = k; });
                Object.defineProperty(row, '__cabNormCompras', { value: mapa, enumerable: false });
            }
            for (var j = 0; j < keys.length; j++) {
                var real = row.__cabNormCompras[_normCabCompras(keys[j])];
                if (real !== undefined && row[real] !== undefined && row[real] !== null && row[real] !== '') return row[real];
            }
            return undefined;
        }

        const COLUMNAS_EXCEL_COMPRAS = {
            folio:        ['Folio', 'folio'],
            docSap:       ['Doc SAP', 'DocSAP', 'Doc Sap', 'docSap', 'Doc. SAP'],
            proveedor:    ['Proveedor', 'proveedor'],
            fecha:        ['Fecha', 'fecha'],
            codigo:       ['Código', 'Codigo', 'codigo'],
            articulo:     ['Artículo', 'Articulo', 'articulo'],
            uom:          ['UoM', 'uom', 'Unidad', 'UOM'],
            almacen:      ['Almacén', 'Almacen', 'almacen'],
            cantidad:     ['Cantidad', 'cantidad'],
            precio:       ['Precio', 'precio'],
            importeLinea: ['Total línea', 'Total linea', 'TotalLinea', 'Total Línea', 'Total Linea']
        };

        /** Parseo numérico tolerante: acepta número nativo de XLSX o texto con comas. */
        function _numeroExcel(v) {
            if (typeof v === 'number' && isFinite(v)) return v;
            if (v === null || v === undefined || v === '') return null;
            var n = parseFloat(String(v).replace(/,/g, '').trim());
            return isFinite(n) ? n : null;
        }

        /** Fecha del Excel a 'YYYY-MM-DD': admite Date, texto ISO o serial de Excel. */
        function _fechaExcelAISO(v) {
            if (v instanceof Date) return fechaISOLocal(v);
            var s = String(v == null ? '' : v).trim();
            var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
            if (m) return m[1] + '-' + m[2] + '-' + m[3];
            var n = _numeroExcel(v);
            if (n !== null && n > 20000 && n < 80000) {
                // Serial de Excel: días desde 1899-12-30.
                var base = new Date(Date.UTC(1899, 11, 30));
                var d = new Date(base.getTime() + n * 86400000);
                return fechaISOLocal(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
            }
            return null;
        }

        /**
         * _normalizarLineaCompra(cruda, producto)
         * Valida cantidad/costo/importe, resuelve el producto contra el
         * catálogo y decide si la línea entra al asiento (enCatalogo) o solo
         * queda registrada en el hecho.
         *
         * factorConversion = 1 SIEMPRE en esta fase (hallazgo (a) del anexo):
         * la Cantidad del Excel ya viene en unidad de conteo — el sistema de
         * origen explota cajas a piezas antes de exportar. El campo
         * `conversion` del catálogo NUNCA se usa para multiplicar aquí; solo
         * dispara una incidencia informativa si la UoM de la línea no
         * coincide con la unidad de conteo del producto, para que un caso
         * fuera de PZA (no hay muestras de KG/LTS todavía) se revise a mano
         * en vez de asumirse silenciosamente.
         */
        function _normalizarLineaCompra(cruda, producto) {
            var cantidad = _numeroExcel(cruda.cantidad);
            var precio   = _numeroExcel(cruda.precio);
            var importe  = _numeroExcel(cruda.importeLinea);

            if (cantidad === null || cantidad <= 0) {
                return { ok: false, incidencia: {
                    tipo: 'cantidad_invalida', codigo: cruda.codigo, articulo: cruda.articulo,
                    detalle: 'Cantidad no numérica o ≤ 0: "' + cruda.cantidad + '" — línea omitida'
                }};
            }
            if (precio === null || precio < 0) {
                return { ok: false, incidencia: {
                    tipo: 'precio_invalido', codigo: cruda.codigo, articulo: cruda.articulo,
                    detalle: 'Precio no numérico: "' + cruda.precio + '" — línea omitida'
                }};
            }
            if (importe === null) importe = Math.round(cantidad * precio * 100) / 100;

            if (!producto) {
                return {
                    ok: true,
                    linea: {
                        productoId: String(cruda.codigo || ''),
                        descripcionSap: String(cruda.articulo || ''),
                        cantidadDocumento: cantidad,
                        unidadDocumento: String(cruda.uom || ''),
                        factorConversion: 1,
                        cantidadInventario: cantidad,
                        costoUnitario: precio,
                        importe: importe,
                        enCatalogo: false
                    },
                    incidencia: {
                        tipo: 'sin_catalogo', codigo: cruda.codigo, articulo: cruda.articulo,
                        detalle: 'Código "' + cruda.codigo + '" (' + (cruda.articulo || '—') +
                                 ') no está en el catálogo — se guardó en la compra pero NO generó asiento de movimiento'
                    }
                };
            }

            var incidenciaUnidad = null;
            var uomLinea        = _normCabCompras(cruda.uom);
            var unidadProducto  = _normCabCompras(producto.unit);
            if (uomLinea && unidadProducto && uomLinea !== unidadProducto) {
                incidenciaUnidad = {
                    tipo: 'unidad_distinta', codigo: cruda.codigo, articulo: cruda.articulo,
                    detalle: 'La línea trae UoM "' + cruda.uom + '" pero "' + producto.name + '" se cuenta en "' +
                             producto.unit + '" — se importó tal cual (factor 1). Revisa manualmente si corresponde otra conversión.'
                };
            }

            return {
                ok: true,
                linea: {
                    productoId: producto.id,
                    descripcionSap: String(cruda.articulo || ''),
                    cantidadDocumento: cantidad,
                    unidadDocumento: String(cruda.uom || ''),
                    factorConversion: 1,
                    cantidadInventario: cantidad,
                    costoUnitario: precio,
                    importe: importe,
                    enCatalogo: true
                },
                incidencia: incidenciaUnidad
            };
        }

        /**
         * _parsearExcelCompras(filas)
         * Agrupa las filas por compra (Doc SAP o Folio) — un archivo puede
         * traer varios folios, y cada uno se convierte en un documento propio
         * (batch por folio, §2.3 del diseño). Descarta sin incidencia la fila
         * de totales del pie (sin Código) y sin incidencia las filas de otro
         * almacén (D-2: no le compete a BarInventory — cocina/cava/desechables).
         */
        function _parsearExcelCompras(filas) {
            const grupos = {};
            const orden = [];
            let fueraDeAlcance = 0;
            let filasIgnoradas = 0;

            (filas || []).forEach(function(fila) {
                const codigo = _findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.codigo);
                if (codigo === undefined || codigo === null || String(codigo).trim() === '') {
                    filasIgnoradas++; // fila de totales del pie u otra sin código
                    return;
                }

                const almacen = _parsearCodigoNombre(_findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.almacen), true);
                if (almacen.codigo !== ALMACEN_BARRA_CODIGO) {
                    fueraDeAlcance++; // D-2: compra real, pero no de la barra
                    return;
                }

                const docSap = _findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.docSap);
                const folio  = _findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.folio);
                const compraId = _compraId(docSap, folio);

                if (!grupos[compraId]) {
                    const proveedor = _parsearCodigoNombre(_findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.proveedor));
                    const fechaISO  = _fechaExcelAISO(_findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.fecha));
                    grupos[compraId] = {
                        compraId: compraId,
                        folio: (folio !== undefined && folio !== null) ? String(folio) : '',
                        docSap: (docSap !== undefined && docSap !== null && String(docSap).trim() !== '') ? String(docSap) : null,
                        fecha: fechaISO,
                        semanaId: fechaISO ? semanaId(fechaISO) : null,
                        proveedorCodigo: proveedor.codigo || null,
                        proveedorNombre: proveedor.nombre || 'Sin proveedor',
                        lineas: [],
                        incidencias: []
                    };
                    orden.push(compraId);
                }
                const g = grupos[compraId];

                const productoId = String(codigo).trim();
                const producto = products.find(function(p) { return String(p.id) === productoId; });
                const cruda = {
                    codigo: productoId,
                    articulo: _findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.articulo),
                    uom: _findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.uom),
                    cantidad: _findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.cantidad),
                    precio: _findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.precio),
                    importeLinea: _findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.importeLinea)
                };
                const norm = _normalizarLineaCompra(cruda, producto);
                if (!norm.ok) { g.incidencias.push(norm.incidencia); return; }
                g.lineas.push(norm.linea);
                if (norm.incidencia) g.incidencias.push(norm.incidencia);
            });

            const gruposList = orden.map(function(compraId) {
                const g = grupos[compraId];
                const importe = g.lineas.reduce(function(a, l) { return a + (l.importe || 0); }, 0);
                return {
                    compraId: g.compraId, folio: g.folio, docSap: g.docSap,
                    fecha: g.fecha, semanaId: g.semanaId,
                    proveedorCodigo: g.proveedorCodigo, proveedorNombre: g.proveedorNombre,
                    importe: Math.round(importe * 100) / 100,
                    lineas: g.lineas, totalLineas: g.lineas.length,
                    origen: 'excel', incidencias: g.incidencias,
                    // D-4/sin fecha: si el Excel no trae una fecha reconocible,
                    // no se inventa "hoy" — se marca y se bloquea en la vista previa.
                    fechaInvalida: !g.fecha
                };
            });

            return { grupos: gruposList, fueraDeAlcance: fueraDeAlcance, filasIgnoradas: filasIgnoradas, totalFilas: (filas || []).length };
        }

        // ══════════════════════════════════════════════════════════════════════
        //  v5.27 — DUPLICADOS: detectarlos ANTES de ingresar
        //  ────────────────────────────────────────────────────────────────────
        //  Pedido de Eduardo (12-oct-2026): "no se puede duplicar la misma
        //  compra; detectar en la importación si es duplicado y no permitir
        //  ingresarla si ya está en el sistema".
        //
        //  El id determinista ya impedía escribir dos veces el MISMO id, pero
        //  había un hueco real: si un export trae el Doc SAP y otro no, la
        //  misma entrada recibe dos ids distintos ('sap-27615' y 'folio-3646')
        //  y entraría dos veces. Además, la vista previa no avisaba: el
        //  "ya existía" solo aparecía DESPUÉS de confirmar.
        //
        //  Criterios, en orden (el primero que aplique decide):
        //    · mismo id, activa        → 'activa'    BLOQUEA ("ya ingresada")
        //    · mismo id, cancelada     → 'reingreso' se vuelve a ingresar
        //    · mismo Doc SAP (activa)  → 'activa'    BLOQUEA (otro registro, mismo documento)
        //    · mismo folio + proveedor → 'activa'    BLOQUEA
        //    · repetida en el archivo  → 'archivo'   BLOQUEA (la 2ª aparición)
        //    · mismo proveedor y mismos productos/cantidades que una activa,
        //      con otro folio          → 'contenido' BLOQUEA salvo que se
        //      marque "importar de todos modos" (puede ser un pedido que se
        //      repite igual cada semana: eso solo lo sabe quien importa).
        // ══════════════════════════════════════════════════════════════════════

        function _claveProveedorCompra(c) {
            if (!c) return '';
            if (c.proveedorCodigo) return 'cod:' + String(c.proveedorCodigo).trim().toUpperCase();
            return 'nom:' + String(c.proveedorNombre || 'Sin proveedor').trim().toUpperCase();
        }

        /** Huella del CONTENIDO: productos y cantidades, sin importar el orden de las líneas. */
        function _huellaContenidoCompra(c) {
            if (!c || !Array.isArray(c.lineas) || !c.lineas.length) return '';
            return c.lineas.map(function(l) {
                return String(l.productoId || '') + '=' + (Math.round((Number(l.cantidadInventario) || 0) * 1000) / 1000);
            }).sort().join('|');
        }

        function _folioNorm(f) { return String(f == null ? '' : f).trim().toUpperCase(); }

        /**
         * comprasClasificarDuplicados(grupos, existentes) — capa PURA.
         * Marca cada grupo con `duplicado` = null | { tipo, compraId, folio,
         * docSap, fechaIngreso, proveedor, bloquea } y devuelve el resumen.
         * `existentes`: compras ya en el sistema (memoria + servidor), en
         * cualquier estado. No muta `existentes`.
         */
        function comprasClasificarDuplicados(grupos, existentes) {
            var porId = {}, activas = [];
            (existentes || []).forEach(function(c) {
                if (!c || !c.compraId) return;
                porId[c.compraId] = c;
            });
            Object.keys(porId).forEach(function(k) { if (!compraCancelada(porId[k])) activas.push(porId[k]); });
            var ref = function(tipo, c, bloquea) {
                return { tipo: tipo, compraId: c.compraId, folio: c.folio || '', docSap: c.docSap || null,
                         fechaIngreso: _fechaIngresoDe(c), proveedor: c.proveedorNombre || '', bloquea: bloquea };
            };
            var vistos = [];   // grupos anteriores del mismo archivo
            var r = { activas: 0, reingresos: 0, archivo: 0, contenido: 0 };
            (grupos || []).forEach(function(g) {
                var d = null;
                var mismo = porId[g.compraId];
                if (mismo) {
                    d = compraCancelada(mismo) ? ref('reingreso', mismo, false) : ref('activa', mismo, true);
                }
                if (!d && g.docSap) {
                    var porDoc = activas.find(function(c) { return c.docSap && String(c.docSap).trim() === String(g.docSap).trim(); });
                    if (porDoc) d = ref('activa', porDoc, true);
                }
                if (!d && _folioNorm(g.folio)) {
                    var kp = _claveProveedorCompra(g);
                    var porFolio = activas.find(function(c) {
                        return _folioNorm(c.folio) === _folioNorm(g.folio) && _claveProveedorCompra(c) === kp;
                    });
                    if (porFolio) d = ref('activa', porFolio, true);
                }
                if (!d) {
                    var enArchivo = vistos.find(function(v) {
                        return (g.docSap && v.docSap && String(v.docSap) === String(g.docSap))
                            || (_folioNorm(g.folio) && _folioNorm(v.folio) === _folioNorm(g.folio)
                                && _claveProveedorCompra(v) === _claveProveedorCompra(g));
                    });
                    if (enArchivo) d = { tipo: 'archivo', compraId: enArchivo.compraId, folio: enArchivo.folio || '',
                                         docSap: enArchivo.docSap || null, fechaIngreso: '', proveedor: enArchivo.proveedorNombre || '', bloquea: true };
                }
                if (!d) {
                    var huella = _huellaContenidoCompra(g);
                    if (huella) {
                        var kp2 = _claveProveedorCompra(g);
                        var porContenido = activas.find(function(c) {
                            return c.compraId !== g.compraId && _claveProveedorCompra(c) === kp2 && _huellaContenidoCompra(c) === huella;
                        });
                        if (porContenido) d = ref('contenido', porContenido, !g.importarAunAsi);
                    }
                }
                g.duplicado = d;
                if (d) {
                    if (d.tipo === 'activa') r.activas++;
                    else if (d.tipo === 'reingreso') r.reingresos++;
                    else if (d.tipo === 'archivo') r.archivo++;
                    else if (d.tipo === 'contenido') r.contenido++;
                }
                vistos.push(g);
            });
            return r;
        }

        /**
         * Junta las compras contra las que hay que comparar: las del
         * dispositivo y, del servidor, solo lo necesario — por grupo, su id,
         * su Doc SAP y su folio; y las semanas SAP del archivo (para la huella
         * de contenido). Unas pocas lecturas por importación, nunca la
         * colección entera. Si el servidor no responde, `completa:false`: la
         * confirmación vuelve a verificar antes de escribir.
         */
        async function _comprasExistentesParaDuplicados(grupos) {
            var mapa = {};
            (typeof compras !== 'undefined' && Array.isArray(compras) ? compras : []).forEach(function(c) {
                if (c && c.compraId) mapa[c.compraId] = c;
            });
            var completa = true;
            if (typeof _db === 'undefined' || !_db || (typeof navigator !== 'undefined' && !navigator.onLine)) {
                return { lista: Object.keys(mapa).map(function(k) { return mapa[k]; }), completa: false };
            }
            var col = _db.collection('compras');
            var tareas = [];
            var semanas = {};
            var agregarDoc = function(doc) {
                if (!doc || doc.exists === false) return;
                var d = (typeof doc.data === 'function') ? doc.data() : null;
                if (d && d.compraId) mapa[d.compraId] = d;
            };
            var agregarSnap = function(snap) {
                if (!snap) return;
                if (typeof snap.forEach === 'function') snap.forEach(agregarDoc);
                else agregarDoc(snap);
            };
            var leer = function(p) {
                tareas.push(Promise.resolve(p).then(agregarSnap).catch(function(e) {
                    console.warn('[Compras] Verificación de duplicados incompleta:', e);
                    completa = false;
                }));
            };
            (grupos || []).forEach(function(g) {
                if (g.compraId) leer(col.doc(g.compraId).get());
                if (g.docSap)   leer(col.where('docSap', '==', String(g.docSap)).limit(10).get());
                if (_folioNorm(g.folio)) leer(col.where('folio', '==', String(g.folio)).limit(20).get());
                if (g.semanaId) semanas[g.semanaId] = true;
            });
            Object.keys(semanas).slice(0, 6).forEach(function(w) {
                leer(col.where('semanaId', '==', w).get());
            });
            await Promise.all(tareas);
            return { lista: Object.keys(mapa).map(function(k) { return mapa[k]; }), completa: completa };
        }

        /** Verifica (o re-verifica) una importación pendiente. No pinta. */
        async function comprasVerificarDuplicados(parsed) {
            if (!parsed || !parsed.grupos) return null;
            parsed.verificando = true;
            var ex = await _comprasExistentesParaDuplicados(parsed.grupos);
            var resumen = comprasClasificarDuplicados(parsed.grupos, ex.lista);
            parsed.verificando = false;
            parsed.verificacionCompleta = ex.completa;
            parsed.resumenDuplicados = resumen;
            return resumen;
        }

        // ── Fecha de ingreso (una para todo el archivo) ────────────────────
        /**
         * comprasValidarFechaIngreso(iso, hoyISO) — capa pura.
         * Obligatoria, 'YYYY-MM-DD' real, no futura. Devuelve { ok, error }.
         */
        function comprasValidarFechaIngreso(iso, hoyISO) {
            var s = String(iso || '').trim();
            var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
            if (!m) return { ok: false, error: 'Elige la fecha de ingreso de esta mercancía.' };
            var d = new Date(+m[1], +m[2] - 1, +m[3]);
            if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) {
                return { ok: false, error: 'La fecha de ingreso no es una fecha válida.' };
            }
            if (hoyISO && s > hoyISO) return { ok: false, error: 'La fecha de ingreso no puede ser futura.' };
            return { ok: true, error: null };
        }

        function _comprasHoyISO() {
            return (typeof fechaISOLocal === 'function') ? fechaISOLocal(new Date()) : new Date().toISOString().slice(0, 10);
        }

        function comprasCambiarFechaIngreso(valor) {
            if (!_comprasImportPendiente) return;
            _comprasImportPendiente.fechaIngreso = String(valor || '').trim();
            renderTab();
        }

        function comprasFechaIngresoHoy() { comprasCambiarFechaIngreso(_comprasHoyISO()); }

        function comprasAlternarImportarAunAsi(compraId, valor) {
            if (!_comprasImportPendiente) return;
            var g = _comprasImportPendiente.grupos.find(function(x) { return x.compraId === compraId; });
            if (!g) return;
            g.importarAunAsi = !!valor;
            if (g.duplicado && g.duplicado.tipo === 'contenido') g.duplicado.bloquea = !g.importarAunAsi;
            renderTab();
        }

        /** Grupos que SÍ se guardarían ahora mismo. */
        function _comprasGruposImportables(parsed) {
            return (parsed && parsed.grupos ? parsed.grupos : []).filter(function(g) {
                return !g.fechaInvalida && !(g.duplicado && g.duplicado.bloquea);
            });
        }

        // ══════════════════════════════════════════════════════════════════════
        //  VISTA PREVIA E INCIDENCIAS (D-4)
        // ══════════════════════════════════════════════════════════════════════

        /** Texto de una marca de duplicado, para la tarjeta y para el resultado. */
        function _comprasTextoDuplicado(d) {
            if (!d) return '';
            var ref = (d.folio ? 'folio ' + d.folio : '') + (d.docSap ? (d.folio ? ' · ' : '') + 'Doc SAP ' + d.docSap : '');
            if (d.tipo === 'activa') {
                return 'Ya está ingresada' + (ref ? ' (' + ref + ')' : '')
                     + (d.fechaIngreso ? ', ingreso del ' + _fechaLarga(d.fechaIngreso) : '') + ' — no se importará';
            }
            if (d.tipo === 'reingreso') return 'Esta entrada se canceló antes: se volverá a ingresar con los datos de este archivo';
            if (d.tipo === 'archivo')   return 'Repetida dentro de este archivo' + (ref ? ' (' + ref + ')' : '') + ' — se importa una sola vez';
            if (d.tipo === 'contenido') {
                return 'Posible duplicado: mismo proveedor, mismos productos y cantidades que ' + (ref || 'otra entrada')
                     + (d.fechaIngreso ? ' del ' + _fechaLarga(d.fechaIngreso) : '');
            }
            return '';
        }

        function renderVistaPreviaCompras(parsed) {
            if (!parsed || !parsed.grupos || parsed.grupos.length === 0) {
                return '<div style="text-align:center;padding:32px 18px;background:var(--surface);'
                     + 'border:1px solid var(--border-mid);border-radius:12px">'
                     + '<div style="font-weight:600;margin-bottom:6px">No hay ninguna entrada para la barra en este archivo</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.86rem">'
                     + (parsed && parsed.fueraDeAlcance
                         ? parsed.fueraDeAlcance + ' fila(s) eran de otro almacén (cocina, cava o desechables).'
                         : 'Revisa que el archivo sea la exportación de "Entrada de mercancía".')
                     + '</div></div>'
                     + '<div style="margin-top:14px"><button type="button" onclick="cancelarImportacionCompras()" '
                     + 'style="padding:0 15px;min-height:44px;border-radius:var(--r-md);background:var(--surface);'
                     + 'border:1px solid var(--border-mid);color:var(--txt-primary);cursor:pointer">Cerrar</button></div>';
            }

            var totalIncidencias = parsed.grupos.reduce(function(a, g) { return a + g.incidencias.length; }, 0);
            var conFechaInvalida = parsed.grupos.filter(function(g) { return g.fechaInvalida; }).length;
            var hoy = _comprasHoyISO();
            var valFecha = comprasValidarFechaIngreso(parsed.fechaIngreso, hoy);
            var importables = _comprasGruposImportables(parsed);
            var bloqueadas = parsed.grupos.filter(function(g) { return g.duplicado && g.duplicado.bloquea; }).length;

            var html = '<div style="margin-bottom:14px">'
                      + '<div style="font-weight:700;font-size:1.05rem;margin-bottom:4px">Vista previa de la importación</div>'
                      + '<div style="color:var(--txt-secondary);font-size:.86rem;line-height:1.5">'
                      + parsed.grupos.length + ' entrada(s) para la barra'
                      + (parsed.fueraDeAlcance ? ' · ' + parsed.fueraDeAlcance + ' fila(s) de otro almacén (descartadas)' : '')
                      + (totalIncidencias ? ' · <b style="color:var(--warn)">' + totalIncidencias + ' incidencia(s)</b>' : '')
                      + '</div></div>';

            // ── v5.27 — Fecha de ingreso: obligatoria, una para todo el archivo ──
            html += '<div class="cp-fi' + (valFecha.ok ? ' cp-fi--ok' : '') + '">'
                  + '<label class="cp-fi__etq" for="cp-fecha-ingreso"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i> '
                  + 'Fecha de ingreso <span class="cp-fi__req">obligatoria</span></label>'
                  + '<div class="cp-fi__fila">'
                  + '<input id="cp-fecha-ingreso" class="cp-fi__input" type="date" max="' + escapeHtml(hoy) + '" required'
                  + ' value="' + escapeHtml(parsed.fechaIngreso || '') + '" onchange="comprasCambiarFechaIngreso(this.value)"'
                  + ' aria-describedby="cp-fi-ayuda">'
                  + '<button type="button" class="cp-fi__hoy" onclick="comprasFechaIngresoHoy()">Hoy</button>'
                  + '</div>'
                  + '<div class="cp-fi__ayuda" id="cp-fi-ayuda">Día en que la mercancía entró a la barra; se aplica a todas las entradas de este archivo. '
                  + 'Es informativa: la semana y el Total siguen usando la fecha del documento de SAP.</div>'
                  + (!valFecha.ok && parsed.fechaIngreso ? '<div class="cp-fi__error" role="alert">' + escapeHtml(valFecha.error) + '</div>' : '')
                  + '</div>';

            // ── v5.27 — Duplicados ────────────────────────────────────────────
            if (parsed.verificando) {
                html += '<div class="cp-aviso cp-aviso--info" role="status"><i class="fa-solid fa-hourglass" aria-hidden="true"></i> '
                      + 'Verificando contra lo que ya está ingresado…</div>';
            } else if (parsed.verificacionCompleta === false) {
                html += '<div class="cp-aviso cp-aviso--warn" role="status"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> '
                      + 'No se pudo verificar contra el servidor (sin conexión o sin el permiso "Ver compras"). '
                      + 'No se puede importar hasta poder comprobar que no hay duplicados.</div>';
            }
            if (bloqueadas) {
                html += '<div class="cp-aviso cp-aviso--peligro" role="status"><i class="fa-solid fa-ban" aria-hidden="true"></i> '
                      + bloqueadas + ' entrada(s) ya están en el sistema o repetidas: no se importarán.</div>';
            }

            html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                  + 'background:var(--warn-dim);border:1px solid var(--warn-dim);'
                  + 'color:var(--warn);font-size:.82rem;line-height:1.5">'
                  + '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> El costo que trae este archivo es precio de <b>lista</b>, sin descuento ni IVA — '
                  + 'no es necesariamente el monto que se pagó. Se importa así, tal cual lo declara SAP, '
                  + 'y el catálogo NO se actualiza automáticamente con él.</div>';

            if (conFechaInvalida > 0) {
                html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                      + 'background:var(--danger-dim);border:1px solid var(--danger-dim);color:var(--danger);font-size:.82rem">'
                      + '<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> ' + conFechaInvalida + ' entrada(s) no tienen una fecha reconocible y no se pueden guardar '
                      + '(no se les puede asignar semana). Corrige el archivo y vuelve a intentar.</div>';
            }

            parsed.grupos.forEach(function(g) {
                var diferencias = _diferenciasDeCosto(g);
                var d = g.duplicado;
                var bloq = !!(d && d.bloquea);
                html += '<div class="cp-prev' + (bloq ? ' cp-prev--bloqueada' : '') + '" style="background:var(--surface);border:1px solid var(--border-mid);'
                      + 'border-radius:12px;padding:14px 16px;margin-bottom:10px">'
                      + '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">'
                      + '<span style="font-weight:700">' + escapeHtml(g.proveedorNombre)
                      + (g.proveedorCodigo ? ' <span style="color:var(--txt-secondary);font-weight:400;font-size:.82rem">('
                        + escapeHtml(g.proveedorCodigo) + ')</span>' : '') + '</span>'
                      + '<span style="color:var(--txt-secondary);font-size:.84rem">'
                      + escapeHtml(g.fechaInvalida ? 'sin fecha válida' : 'Doc. SAP: ' + _fechaLarga(g.fecha)) + '</span></div>'
                      + '<div style="color:var(--txt-secondary);font-size:.82rem;margin-top:5px">'
                      + 'Folio ' + escapeHtml(g.folio || '—') + (g.docSap ? ' · Doc SAP ' + escapeHtml(g.docSap) : '')
                      + '</div>'
                      + '<div style="margin-top:7px;font-size:.9rem">'
                      + '<b>' + g.totalLineas + '</b> línea' + (g.totalLineas === 1 ? '' : 's')
                      + ' · <b>' + _dineroMX(g.importe) + '</b> (precio de lista)</div>';

                if (d) {
                    var tono = d.tipo === 'reingreso' ? 'info' : (bloq ? 'bloq' : 'warn');
                    var icono = d.tipo === 'reingreso' ? 'fa-rotate-left' : (bloq ? 'fa-ban' : 'fa-triangle-exclamation');
                    html += '<div class="cp-dup cp-dup--' + tono + '"><i class="fa-solid ' + icono + '" aria-hidden="true"></i> '
                          + escapeHtml(_comprasTextoDuplicado(d)) + '</div>';
                    if (d.tipo === 'contenido') {
                        html += '<label class="cp-dup__opcion"><input type="checkbox" data-compra-id="' + escapeHtml(g.compraId) + '"'
                              + (g.importarAunAsi ? ' checked' : '')
                              + ' onchange="comprasAlternarImportarAunAsi(this.getAttribute(\'data-compra-id\'), this.checked)"> '
                              + 'Importar de todos modos (es otra entrega)</label>';
                    }
                }

                if (g.incidencias.length) {
                    html += '<div style="margin-top:8px;font-size:.8rem;color:var(--warn)">'
                          + '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' + g.incidencias.length + ' incidencia(s) — '
                          + '<a href="javascript:void(0)" onclick="_comprasVerIncidenciasGrupo(\'' + escapeHtml(g.compraId) + '\')" '
                          + 'style="color:var(--warn);text-decoration:underline">ver detalle</a></div>';
                }
                if (diferencias.length) {
                    html += '<div style="margin-top:6px;font-size:.8rem;color:var(--txt-secondary)">'
                          + '<i class="fa-solid fa-coins" aria-hidden="true"></i> ' + diferencias.length + ' producto(s) con costo distinto al del catálogo (≥1%)</div>';
                }
                html += '</div>';
            });

            var motivoNo = !valFecha.ok ? 'Elige la fecha de ingreso para continuar.'
                         : parsed.verificando ? 'Esperando la verificación de duplicados…'
                         : parsed.verificacionCompleta === false ? 'Sin verificación de duplicados no se importa.'
                         : !importables.length ? 'No queda ninguna entrada nueva que importar.' : '';
            var puede = !motivoNo;
            html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;align-items:center">';
            html += '<button type="button" onclick="confirmarImportacionCompras()"' + (puede ? '' : ' disabled aria-disabled="true"')
                  + ' style="padding:0 15px;min-height:44px;border-radius:var(--r-md);background:var(--ok-dim);'
                  + 'border:1px solid var(--ok-dim);color:var(--ok);font-weight:600;cursor:' + (puede ? 'pointer' : 'not-allowed') + ';'
                  + (puede ? '' : 'opacity:.5;') + '">'
                  + 'Confirmar e importar' + (importables.length ? ' (' + importables.length + ')' : '') + '</button>';
            html += '<button type="button" onclick="cancelarImportacionCompras()" '
                  + 'style="padding:0 15px;min-height:44px;border-radius:var(--r-md);background:var(--surface);'
                  + 'border:1px solid var(--border-mid);color:var(--txt-primary);cursor:pointer">Cancelar</button>';
            if (motivoNo) html += '<span style="font-size:.8rem;color:var(--txt-secondary)">' + escapeHtml(motivoNo) + '</span>';
            html += '</div>';
            return html;
        }

        function renderIncidenciasImportacion(resultado) {
            if (!resultado) return '';
            var duplicadas = resultado.duplicadas || [];
            var html = '<div style="margin-bottom:14px">'
                     + '<div style="font-weight:700;font-size:1.05rem;margin-bottom:4px">Resultado de la importación</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.86rem">'
                     + resultado.creadas + ' entrada(s) guardada(s)'
                     + (resultado.reingresadas ? ' · ' + resultado.reingresadas + ' reingresada(s) (estaban canceladas)' : '')
                     + (resultado.yaExistian ? ' · ' + resultado.yaExistian + ' ya existía(n) (sin duplicar)' : '')
                     + (duplicadas.length ? ' · <b style="color:var(--danger)">' + duplicadas.length + ' duplicada(s) no importada(s)</b>' : '')
                     + (resultado.fallidas.length ? ' · <b style="color:var(--danger)">' + resultado.fallidas.length + ' no se pudieron guardar</b>' : '')
                     + (resultado.fechaIngreso ? '<br>Fecha de ingreso: <b>' + escapeHtml(_fechaLarga(resultado.fechaIngreso)) + '</b>' : '')
                     + '</div></div>';

            if (duplicadas.length) {
                html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                      + 'background:var(--danger-dim);border:1px solid var(--danger-dim);color:var(--danger);font-size:.84rem">';
                duplicadas.forEach(function(f) {
                    html += '<div style="margin-bottom:4px">Folio ' + escapeHtml(f.folio || f.compraId) + ': ' + escapeHtml(f.motivo) + '</div>';
                });
                html += '</div>';
            }

            if (resultado.fallidas.length) {
                html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                      + 'background:var(--danger-dim);border:1px solid var(--danger-dim);color:var(--danger);font-size:.84rem">';
                resultado.fallidas.forEach(function(f) {
                    html += '<div style="margin-bottom:4px">Folio ' + escapeHtml(f.folio || f.compraId) + ': ' + escapeHtml(f.motivo) + '</div>';
                });
                html += '</div>';
            }

            var todasIncidencias = [];
            (resultado.grupos || []).forEach(function(g) {
                (g.incidencias || []).forEach(function(inc) {
                    todasIncidencias.push(Object.assign({ folio: g.folio, proveedor: g.proveedorNombre }, inc));
                });
            });
            if (todasIncidencias.length) {
                html += '<div style="font-weight:600;margin-bottom:8px">Incidencias (' + todasIncidencias.length + ')</div>';
                todasIncidencias.forEach(function(inc) {
                    html += '<div style="background:var(--surface);border:1px solid var(--border-mid);'
                          + 'border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:.84rem">'
                          + '<div style="color:var(--txt-secondary);font-size:.76rem;margin-bottom:2px">'
                          + 'Folio ' + escapeHtml(inc.folio) + ' · ' + escapeHtml(inc.proveedor) + '</div>'
                          + escapeHtml(inc.detalle) + '</div>';
                });
            } else {
                html += '<div style="color:var(--txt-secondary);font-size:.86rem">Sin incidencias.</div>';
            }

            html += '<div style="margin-top:16px"><button type="button" onclick="cerrarResultadoImportacionCompras()" '
                  + 'style="padding:0 15px;min-height:44px;border-radius:var(--r-md);background:var(--surface);'
                  + 'border:1px solid var(--border-mid);color:var(--txt-primary);cursor:pointer">Aceptar</button></div>';
            return html;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  ORQUESTACIÓN DE LA PANTALLA (estado de importación + acciones)
        // ══════════════════════════════════════════════════════════════════════

        function comprasImportarExcel() {
            if (!hasPermission('purchases.import')) {
                showNotification('⚠️ No tienes permiso para importar compras');
                return;
            }
            const input = document.getElementById('fileInputCompras');
            if (input) input.click();
        }

        function handleFileImportCompras(event) {
            const file = event.target.files[0];
            if (!file) return;
            if (!hasPermission('purchases.import')) {
                showNotification('⚠️ No tienes permiso para importar compras');
                event.target.value = '';
                return;
            }
            if (typeof XLSX === 'undefined') {
                showNotification('⏳ Cargando librería Excel… intenta en unos segundos');
                event.target.value = '';
                return;
            }
            showNotification('⏳ Leyendo ' + file.name + '…');
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                        showNotification('El archivo no contiene hojas válidas'); return;
                    }
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    if (!sheet) { showNotification('La primera hoja del archivo está vacía o es inválida'); return; }
                    const filas = XLSX.utils.sheet_to_json(sheet);
                    if (!filas || filas.length === 0) { showNotification('El archivo no contiene datos'); return; }

                    const parsed = _parsearExcelCompras(filas);
                    // v5.27 — la fecha de ingreso empieza VACÍA a propósito: se
                    // pide en cada importación y no se adivina. Y antes de dejar
                    // confirmar se verifica qué entradas ya están ingresadas.
                    parsed.fechaIngreso = '';
                    parsed.verificando = true;
                    _comprasImportPendiente = parsed;
                    comprasImportView = 'vista_previa';
                    renderTab();
                    comprasVerificarDuplicados(parsed).then(function() {
                        if (_comprasImportPendiente === parsed) renderTab();
                    }).catch(function(err) {
                        console.warn('[Compras] Verificación de duplicados falló:', err);
                        parsed.verificando = false;
                        parsed.verificacionCompleta = false;
                        if (_comprasImportPendiente === parsed) renderTab();
                    });
                } catch (err) {
                    console.error('[Compras] Error leyendo el Excel:', err);
                    showNotification('❌ No se pudo leer el archivo — revisa que sea la exportación de "Entrada de mercancía"');
                }
            };
            reader.onerror = function() { showNotification('❌ Error leyendo el archivo'); };
            reader.readAsArrayBuffer(file);
            event.target.value = '';
        }

        var _comprasConfirmando = false;   // evita doble toque en "Confirmar e importar"

        async function confirmarImportacionCompras() {
            const parsed = _comprasImportPendiente;
            if (!parsed || !parsed.grupos || parsed.grupos.length === 0) return;
            if (_comprasConfirmando) return;

            // v5.27 — fecha de ingreso obligatoria (una para todo el archivo).
            const vf = comprasValidarFechaIngreso(parsed.fechaIngreso, _comprasHoyISO());
            if (!vf.ok) {
                showNotification('⚠️ ' + vf.error);
                const el = document.getElementById('cp-fecha-ingreso');
                if (el) el.focus();
                return;
            }

            _comprasConfirmando = true;
            try {
                // v5.27 — se vuelve a verificar JUSTO antes de escribir: entre la
                // vista previa y este toque, otro dispositivo pudo importar lo mismo.
                showNotification('⏳ Verificando duplicados…');
                await comprasVerificarDuplicados(parsed);
                if (parsed.verificacionCompleta === false) {
                    showNotification('⚠️ No se pudo comprobar contra el servidor que no haya duplicados — revisa la conexión');
                    renderTab();
                    return;
                }
                const importables = _comprasGruposImportables(parsed);
                if (!importables.length) {
                    showNotification('⚠️ No queda ninguna entrada nueva que importar');
                    renderTab();
                    return;
                }

                _crearBackupNombrado('pre_importacion_compras_' + Date.now());
                showNotification('⏳ Guardando ' + importables.length + ' entrada(s)…');

                const resultado = { creadas: 0, reingresadas: 0, yaExistian: 0, duplicadas: [], fallidas: [],
                                    grupos: parsed.grupos, fechaIngreso: parsed.fechaIngreso };
                for (const g of parsed.grupos) {
                    if (g.fechaInvalida) {
                        resultado.fallidas.push({ compraId: g.compraId, folio: g.folio, motivo: 'sin fecha válida — no se pudo asignar semana' });
                        continue;
                    }
                    if (g.duplicado && g.duplicado.bloquea) {
                        resultado.duplicadas.push({ compraId: g.compraId, folio: g.folio, motivo: _comprasTextoDuplicado(g.duplicado) });
                        continue;
                    }
                    const compra = {
                        compraId: g.compraId, folio: g.folio, docSap: g.docSap,
                        fecha: g.fecha, semanaId: g.semanaId,
                        fechaIngreso: parsed.fechaIngreso,
                        proveedorCodigo: g.proveedorCodigo, proveedorNombre: g.proveedorNombre,
                        importe: g.importe, lineas: g.lineas, totalLineas: g.totalLineas,
                        origen: 'excel', creadoPor: currentUserUid || null, creadoEn: Date.now()
                    };
                    const res = await guardarCompra(compra);
                    if (res.ok && res.motivo === 'creada')            resultado.creadas++;
                    else if (res.ok && res.motivo === 'reingresada')  resultado.reingresadas++;
                    else if (res.ok && res.motivo === 'ya_existia')   resultado.yaExistian++;
                    else resultado.fallidas.push({ compraId: g.compraId, folio: g.folio, motivo: res.motivo || 'error desconocido' });
                }

                _comprasImportPendiente = null;
                _comprasImportResultado = resultado;
                comprasImportView = 'incidencias';
                const guardadas = resultado.creadas + resultado.reingresadas;
                const msg = guardadas + ' entrada(s) guardada(s)'
                          + (resultado.duplicadas.length ? ', ' + resultado.duplicadas.length + ' duplicada(s) omitida(s)' : '')
                          + (resultado.fallidas.length ? ', ' + resultado.fallidas.length + ' con error' : '');
                showNotification((resultado.fallidas.length ? '⚠️ ' : '✅ ') + msg);
                renderTab();
            } finally {
                _comprasConfirmando = false;
            }
        }

        function cancelarImportacionCompras() {
            _comprasImportPendiente = null;
            comprasImportView = 'lista';
            renderTab();
        }

        function cerrarResultadoImportacionCompras() {
            _comprasImportResultado = null;
            comprasImportView = 'lista';
            renderTab();
        }

        // Enlace "ver detalle" de una tarjeta de la vista previa: reutiliza la
        // misma pantalla de incidencias mostrando solo ese grupo.
        function _comprasVerIncidenciasGrupo(compraId) {
            if (!_comprasImportPendiente) return;
            var g = _comprasImportPendiente.grupos.find(function(x) { return x.compraId === compraId; });
            if (!g) return;
            _comprasImportResultado = { creadas: 0, yaExistian: 0, fallidas: [], grupos: [g] };
            comprasImportView = 'incidencias_previa';
            renderTab();
        }

        // ── Captura a mano: todavía no implementada en esta fase (ver §9/4C
        //    del diseño — queda para después de la importación por Excel).
        function comprasNuevaManual() {
            showNotification('La captura a mano todavía no está disponible — próximamente.');
        }

        // ══════════════════════════════════════════════════════════════════════
        //  RENDER PRINCIPAL DE LA PESTAÑA
        // ══════════════════════════════════════════════════════════════════════

        function renderComprasTab() {
            if (!hasPermission('purchases.read')) {
                return '<div class="p-6 text-center" style="color:var(--txt-secondary)">'
                     + 'No tienes permiso para ver las compras.</div>';
            }

            if (typeof comprasImportView === 'undefined') comprasImportView = 'lista';

            if (comprasImportView === 'vista_previa' && _comprasImportPendiente) {
                return '<div style="padding:4px 0 8px">' + renderVistaPreviaCompras(_comprasImportPendiente) + '</div>';
            }
            if ((comprasImportView === 'incidencias' || comprasImportView === 'incidencias_previa') && _comprasImportResultado) {
                var html = '<div style="padding:4px 0 8px">' + renderIncidenciasImportacion(_comprasImportResultado) + '</div>';
                return html;
            }

            var html = '<div style="padding:4px 0 8px">';

            // ── Cabecera con el resumen ───────────────────────────────────────
            var r = _resumenCompras();
            html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">';
            [['Documentos', r.documentos],
             ['Líneas', r.lineas],
             ['Proveedores', r.proveedores],
             ['Importe', _dineroMX(r.importe)]
            ].forEach(function(par) {
                html += '<div class="cmp-kpi" style="flex:1;min-width:120px;background:var(--surface);'
                      + 'border:1px solid var(--border-mid);border-radius:12px;padding:12px 14px">'
                      + '<div style="font-size:1.25rem;font-weight:700;letter-spacing:-.02em">'
                      + escapeHtml(String(par[1])) + '</div>'
                      + '<div style="font-size:.72rem;color:var(--txt-secondary);'
                      + 'text-transform:uppercase;letter-spacing:.05em;margin-top:3px">'
                      + escapeHtml(par[0]) + '</div></div>';
            });
            html += '</div>';
            if (r.canceladas) {
                html += '<div class="cp-nota-canceladas"><i class="fa-solid fa-ban" aria-hidden="true"></i> '
                      + r.canceladas + ' entrada' + (r.canceladas === 1 ? ' cancelada' : 's canceladas')
                      + ' (no cuentan en el resumen ni en el Total)</div>';
            }

            // ── Acciones ──────────────────────────────────────────────────────
            html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">';
            // v5.18 — importar ya no vive aquí: todas las importaciones se
            // hacen desde el módulo "Importar desde Excel" (js/96-importar.js),
            // decisión de Eduardo (6-oct-2026).
            if (hasPermission('purchases.create')) {
                html += '<button type="button" onclick="comprasNuevaManual()" '
                      + 'style="display:flex;align-items:center;gap:7px;padding:0 15px;min-height:44px;'
                      + 'border-radius:var(--r-md);background:var(--surface);'
                      + 'border:1px solid var(--border-mid);color:var(--txt-primary);'
                      + 'font-weight:600;cursor:pointer">Capturar a mano</button>';
            }
            html += '</div>';

            // ── Lista ─────────────────────────────────────────────────────────
            if (compras.length === 0) {
                html += '<div class="cmp-vacio" style="text-align:center;padding:42px 18px;'
                      + 'background:var(--surface);border:1px solid var(--border-mid);'
                      + 'border-radius:12px">'
                      + '<div style="font-size:2.2rem;margin-bottom:10px;color:var(--txt-muted);opacity:.55"><i class="fa-solid fa-receipt" aria-hidden="true"></i></div>'
                      + '<div style="font-weight:600;margin-bottom:6px">Todavía no hay compras registradas</div>'
                      + '<div style="color:var(--txt-secondary);font-size:.88rem;max-width:420px;'
                      + 'margin:0 auto;line-height:1.55">'
                      + 'Importa el Excel de entrada de mercancía de SAP desde el módulo Importar desde Excel (menú Más), o captura una a mano. '
                      + 'Antes de guardar nada verás un resumen por proveedor y fecha para revisarlo.'
                      + '</div></div>';
            } else {
                // v5.27 — buscador por producto y filtro por proveedor (pedido de
                // Eduardo, 12-oct-2026). Misma barra unificada que el resto de
                // la app (06-busqueda-ui.js); el filtro de proveedor es un
                // selector porque la lista de proveedores crece sin tope.
                html += BusquedaUI.barra('compras', {
                    placeholder: 'Buscar producto, código o folio…',
                    etiqueta: 'Buscar compras por producto, código o folio',
                    sticky: true
                });
                html += _comprasSelectorProveedor();
                html += BusquedaUI.region('compras', _renderComprasResultados().html);
            }

            html += '</div>';
            return html;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  v5.27 — LISTA: por fecha de ingreso, filtro por proveedor y búsqueda
        // ══════════════════════════════════════════════════════════════════════

        var _DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

        /** "lunes 12 de octubre de 2026" — sin pasar por new Date(iso) (UTC). */
        function _fechaConDia(iso) {
            var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
            if (!m) return _fechaLarga(iso);
            var d = new Date(+m[1], +m[2] - 1, +m[3]);
            var dia = _DIAS_SEMANA[d.getDay()];
            return dia.charAt(0).toUpperCase() + dia.slice(1) + ' ' + _fechaLarga(iso);
        }

        /** Nombre visible de un producto de una línea (catálogo, o lo que dijo SAP). */
        function _nombreLineaCompra(l) {
            var p = (typeof products !== 'undefined' && Array.isArray(products))
                ? products.find(function(x) { return String(x.id) === String(l.productoId); }) : null;
            return p ? (p.name || l.productoId) : (l.descripcionSap || l.productoId || '—');
        }

        /** Proveedores presentes en la lista: [{ clave, nombre, n }], por nombre. */
        function comprasProveedores(lista) {
            var acc = {};
            (lista || []).forEach(function(c) {
                var k = _claveProveedorCompra(c);
                if (!acc[k]) acc[k] = { clave: k, nombre: c.proveedorNombre || 'Sin proveedor', n: 0 };
                acc[k].n++;
            });
            return Object.keys(acc).map(function(k) { return acc[k]; })
                .sort(function(a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
        }

        function _comprasSelectorProveedor() {
            var provs = comprasProveedores(compras);
            // Un proveedor elegido que ya no está (p.ej. tras recargar) no deja la lista vacía.
            if (_comprasFiltroProveedor && !provs.some(function(p) { return p.clave === _comprasFiltroProveedor; })) {
                _comprasFiltroProveedor = '';
            }
            var h = '<div class="cp-filtro">'
                  + '<label class="cp-filtro__etq" for="cp-filtro-prov"><i class="fa-solid fa-truck" aria-hidden="true"></i> Proveedor</label>'
                  + '<select id="cp-filtro-prov" class="cp-filtro__sel" onchange="comprasFiltrarProveedor(this.value)">'
                  + '<option value="">Todos los proveedores (' + compras.length + ')</option>';
            provs.forEach(function(p) {
                h += '<option value="' + escapeHtml(p.clave) + '"' + (p.clave === _comprasFiltroProveedor ? ' selected' : '') + '>'
                   + escapeHtml(p.nombre) + ' (' + p.n + ')</option>';
            });
            return h + '</select></div>';
        }

        function comprasFiltrarProveedor(clave) {
            _comprasFiltroProveedor = String(clave || '');
            if (typeof BusquedaUI !== 'undefined') BusquedaUI.refrescar('compras');
        }

        /**
         * comprasFiltrar(lista, consulta, claveProveedor) — capa de datos.
         * Aplica el proveedor y la búsqueda, y devuelve las compras en orden
         * de FECHA DE INGRESO (no por relevancia: la pantalla se lee por día).
         */
        function comprasFiltrar(lista, consulta, claveProveedor) {
            var base = (lista || []).filter(function(c) {
                return !claveProveedor || _claveProveedorCompra(c) === claveProveedor;
            });
            var coinciden = base;
            if (consulta && typeof _motorCompras !== 'undefined') {
                coinciden = _motorCompras.buscar(base, consulta).items;
            }
            return { items: _comprasOrdenadas(coinciden), total: base.length };
        }

        /** Líneas de una compra que contienen TODAS las palabras buscadas. */
        function _comprasLineasQueCoinciden(c, consulta) {
            if (!consulta || typeof tokenizarBusqueda !== 'function' || typeof normalizarBusqueda !== 'function') return [];
            var tokens = tokenizarBusqueda(consulta);
            if (!tokens.length) return [];
            return (Array.isArray(c.lineas) ? c.lineas : []).filter(function(l) {
                var t = normalizarBusqueda(_nombreLineaCompra(l) + ' ' + (l.productoId || '') + ' ' + (l.descripcionSap || ''));
                return tokens.every(function(k) { return t.indexOf(k) !== -1; });
            });
        }

        function _comprasTarjetaHtml(c, consulta) {
            var totalLineas = Array.isArray(c.lineas) ? c.lineas.length : 0;
            var cancel = compraCancelada(c);
            // v5.18 — la tarjeta abre el detalle (js/89). El id va en
            // data-compra-id: un apóstrofo en el folio no rompe el onclick.
            var _idC = escapeHtml(String(c.compraId || ''));
            var h = '<div class="cp-tarjeta' + (cancel ? ' cp-tarjeta--cancelada' : '') + '" role="button" tabindex="0" data-sbx-item data-compra-id="' + _idC + '"'
                  + ' aria-label="Ver los productos de esta entrada de ' + escapeHtml(c.proveedorNombre || 'Sin proveedor') + (cancel ? ' (cancelada)' : '') + '"'
                  + ' onclick="comprasVerDetalle(this.getAttribute(\'data-compra-id\'))"'
                  + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();comprasVerDetalle(this.getAttribute(\'data-compra-id\'));}">'
                  + '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">'
                  + '<span class="cp-tarjeta__prov">' + (consulta && typeof resaltarBusqueda === 'function'
                        ? resaltarBusqueda(c.proveedorNombre || 'Sin proveedor', consulta) : escapeHtml(c.proveedorNombre || 'Sin proveedor'))
                  + (c.proveedorCodigo
                      ? ' <span style="color:var(--txt-secondary);font-weight:400;font-size:.82rem">(' + escapeHtml(c.proveedorCodigo) + ')</span>' : '')
                  + '</span>'
                  + (cancel ? '<span class="cp-badge-cancelada">Cancelada</span>' : '')
                  + '</div>'
                  + '<div style="color:var(--txt-secondary);font-size:.82rem;margin-top:5px">'
                  + 'Folio ' + escapeHtml(String(c.folio || '—'))
                  + (c.docSap ? ' · Doc SAP ' + escapeHtml(String(c.docSap)) : '')
                  + ' · ' + (c.origen === 'manual' ? 'capturada a mano' : 'importada de Excel')
                  + (c.fecha && c.fecha !== _fechaIngresoDe(c) ? ' · documento SAP del ' + escapeHtml(_fechaLarga(c.fecha)) : '')
                  + '</div>'
                  + '<div style="margin-top:7px;font-size:.9rem">'
                  + '<b>' + totalLineas + '</b> línea' + (totalLineas === 1 ? '' : 's')
                  + ' · ' + _unidadesCompra(c) + ' unidades'
                  + ' · <b>' + _dineroMX(c.importe) + '</b></div>';
            if (cancel) {
                h += '<div class="cp-tarjeta__motivo"><i class="fa-solid fa-ban" aria-hidden="true"></i> '
                   + escapeHtml(c.motivoCancelacion || 'Sin motivo') + '</div>';
            }
            var coinc = _comprasLineasQueCoinciden(c, consulta);
            if (coinc.length) {
                h += '<div class="cp-coinc">';
                coinc.slice(0, 3).forEach(function(l) {
                    h += '<div class="cp-coinc__fila"><span>' + (typeof resaltarBusqueda === 'function'
                            ? resaltarBusqueda(_nombreLineaCompra(l), consulta) : escapeHtml(_nombreLineaCompra(l))) + '</span>'
                       + '<b class="num">' + (Math.round((Number(l.cantidadInventario) || 0) * 1000) / 1000) + ' ' + escapeHtml(l.unidadDocumento || '') + '</b></div>';
                });
                if (coinc.length > 3) h += '<div class="cp-coinc__mas">y ' + (coinc.length - 3) + ' más</div>';
                h += '</div>';
            }
            h += '<div class="cp-tarjeta__ver">Ver productos <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></div>'
               + '</div>';
            return h;
        }

        function _renderComprasResultados() {
            var consulta = (typeof _comprasSearchTerm !== 'undefined') ? _comprasSearchTerm : '';
            var r = comprasFiltrar(compras, consulta, _comprasFiltroProveedor);
            if (!r.items.length) {
                return { html: BusquedaUI.vacio('compras', 'compras'), coincidencias: 0, total: r.total };
            }
            var lim = BusquedaUI.limite('compras');
            var visibles = r.items.slice(0, lim);
            var html = BusquedaUI.resumen('compras', r.items.length, r.total, 'entrada', 'entradas');
            var fechaActual = null;
            visibles.forEach(function(c) {
                var f = _fechaIngresoDe(c);
                if (f !== fechaActual) {
                    if (fechaActual !== null) html += '</div>';
                    fechaActual = f;
                    // Totales del día sobre TODO lo filtrado, no solo lo visible.
                    var delDia = r.items.filter(function(x) { return _fechaIngresoDe(x) === f; });
                    var activasDia = delDia.filter(function(x) { return !compraCancelada(x); });
                    var importeDia = activasDia.reduce(function(a, x) { return a + (x.importe || 0); }, 0);
                    html += '<div class="cp-dia">'
                          + '<div class="cp-dia__cab"><span class="cp-dia__fecha"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i> '
                          + 'Ingreso: ' + escapeHtml(f ? _fechaConDia(f) : 'sin fecha') + '</span>'
                          + '<span class="cp-dia__tot">' + activasDia.length + ' entrada' + (activasDia.length === 1 ? '' : 's')
                          + ' · ' + _dineroMX(importeDia)
                          + (delDia.length > activasDia.length ? ' · ' + (delDia.length - activasDia.length)
                             + (delDia.length - activasDia.length === 1 ? ' cancelada' : ' canceladas') : '')
                          + '</span></div>';
                }
                html += _comprasTarjetaHtml(c, consulta);
            });
            if (fechaActual !== null) html += '</div>';
            html += BusquedaUI.centinela('compras', r.items.length - lim);
            return { html: html, coincidencias: r.items.length, total: r.total };
        }
