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
        //    guarda), no borra nada (purchases.delete queda sin implementar).
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

        function _comprasOrdenadas() {
            // Más reciente primero. Ante misma fecha, folio descendente, que es
            // el orden en que se generan en SAP.
            return compras.slice().sort(function(a, b) {
                if (a.fecha !== b.fecha) return (b.fecha || '').localeCompare(a.fecha || '');
                return String(b.folio || '').localeCompare(String(a.folio || ''));
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
            var r = { documentos: compras.length, lineas: 0, importe: 0,
                      proveedores: {}, ultima: null };
            compras.forEach(function(c) {
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
         * _parsearCodigoNombre(cadena)
         * El proveedor Y el almacén viajan en el Excel real como una sola
         * celda "código — nombre" (p.ej. "P00106 — VINOTECA MEXICO",
         * "12 — BARRA MOCHOMOS MONTERREY"), separados por un guion largo con
         * espacios. Si el separador no aparece, toda la cadena se guarda como
         * nombre y el código queda vacío — no se descarta la fila por esto.
         */
        function _parsearCodigoNombre(cadena) {
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
        function _agregarCompraLocal(compra, asientos) {
            if (!compras.some(function(c) { return c.compraId === compra.compraId; })) {
                compras.push(compra);
            }
            (asientos || []).forEach(function(m) {
                if (!movimientos.some(function(x) { return x.movId === m.movId; })) {
                    movimientos.push(m);
                }
            });
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
            if (!hasPermission('purchases.create')) {
                return { ok: false, motivo: 'sin_permiso' };
            }
            if (!_db)              return { ok: false, motivo: 'sin_firestore' };
            if (!navigator.onLine) return { ok: false, motivo: 'sin_conexion' };
            if (!compra || !compra.compraId) return { ok: false, motivo: 'compra_invalida' };

            const previo = await _verificarCompraExistente(compra.compraId);
            if (previo.existe) {
                // Idempotencia real: reimportar el mismo folio no es un error,
                // es un no-op informado.
                _agregarCompraLocal(previo.datos, _asientosDesdeCompra(previo.datos));
                return { ok: true, motivo: 'ya_existia', datos: previo.datos };
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
                    detalle: 'Entrada de mercancía ' +
                             (compra.docSap ? 'Doc SAP ' + compra.docSap : 'folio ' + compra.folio) +
                             ' — ' + compra.proveedorNombre + ' — ' + compra.lineas.length + ' línea(s) — ' +
                             _dineroMX(compra.importe),
                    compraId: compra.compraId,
                    importe:  compra.importe,
                    motivo:   'Registro de compra'
                });

                return { ok: true, motivo: 'creada', compra: compra };
            } catch (err) {
                console.error('[Compras] Error guardando compra ' + compra.compraId + ':', err);
                // Mismo manejo que FASE 3: un permission-denied puede significar
                // que el batch SÍ llegó a confirmarse y solo se perdió la
                // respuesta (corte de red justo después del commit).
                if (err && err.code === 'permission-denied') {
                    const post = await _verificarCompraExistente(compra.compraId);
                    if (post.existe) {
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
                    const antes = compras.length;
                    _agregarCompraLocal(c, _asientosDesdeCompra(c));
                    if (compras.length > antes) nuevas++;
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

                const almacen = _parsearCodigoNombre(_findColCompras(fila, COLUMNAS_EXCEL_COMPRAS.almacen));
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
        //  VISTA PREVIA E INCIDENCIAS (D-4)
        // ══════════════════════════════════════════════════════════════════════

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
                     + 'style="padding:9px 15px;border-radius:var(--r-md);background:var(--surface);'
                     + 'border:1px solid var(--border-mid);color:var(--txt-primary);cursor:pointer">Cerrar</button></div>';
            }

            var totalIncidencias = parsed.grupos.reduce(function(a, g) { return a + g.incidencias.length; }, 0);
            var conFechaInvalida = parsed.grupos.filter(function(g) { return g.fechaInvalida; }).length;

            var html = '<div style="margin-bottom:14px">'
                      + '<div style="font-weight:700;font-size:1.05rem;margin-bottom:4px">Vista previa de la importación</div>'
                      + '<div style="color:var(--txt-secondary);font-size:.86rem;line-height:1.5">'
                      + parsed.grupos.length + ' entrada(s) para la barra'
                      + (parsed.fueraDeAlcance ? ' · ' + parsed.fueraDeAlcance + ' fila(s) de otro almacén (descartadas)' : '')
                      + (totalIncidencias ? ' · <b style="color:#fbbf24">' + totalIncidencias + ' incidencia(s)</b>' : '')
                      + '</div></div>';

            html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                  + 'background:rgba(251,191,36,.10);border:1px solid rgba(251,191,36,.28);'
                  + 'color:#fbbf24;font-size:.82rem;line-height:1.5">'
                  + '⚠️ El costo que trae este archivo es precio de <b>lista</b>, sin descuento ni IVA — '
                  + 'no es necesariamente el monto que se pagó. Se importa así, tal cual lo declara SAP, '
                  + 'y el catálogo NO se actualiza automáticamente con él.</div>';

            if (conFechaInvalida > 0) {
                html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                      + 'background:rgba(239,68,68,.10);border:1px solid rgba(239,68,68,.28);color:#f87171;font-size:.82rem">'
                      + '🛑 ' + conFechaInvalida + ' entrada(s) no tienen una fecha reconocible y no se pueden guardar '
                      + '(no se les puede asignar semana). Corrige el archivo y vuelve a intentar.</div>';
            }

            parsed.grupos.forEach(function(g) {
                var diferencias = _diferenciasDeCosto(g);
                html += '<div style="background:var(--surface);border:1px solid var(--border-mid);'
                      + 'border-radius:12px;padding:14px 16px;margin-bottom:10px">'
                      + '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">'
                      + '<span style="font-weight:700">' + escapeHtml(g.proveedorNombre)
                      + (g.proveedorCodigo ? ' <span style="color:var(--txt-secondary);font-weight:400;font-size:.82rem">('
                        + escapeHtml(g.proveedorCodigo) + ')</span>' : '') + '</span>'
                      + '<span style="color:var(--txt-secondary);font-size:.84rem">'
                      + escapeHtml(g.fechaInvalida ? 'sin fecha válida' : _fechaLarga(g.fecha)) + '</span></div>'
                      + '<div style="color:var(--txt-secondary);font-size:.82rem;margin-top:5px">'
                      + 'Folio ' + escapeHtml(g.folio || '—') + (g.docSap ? ' · Doc SAP ' + escapeHtml(g.docSap) : '')
                      + '</div>'
                      + '<div style="margin-top:7px;font-size:.9rem">'
                      + '<b>' + g.totalLineas + '</b> línea' + (g.totalLineas === 1 ? '' : 's')
                      + ' · <b>' + _dineroMX(g.importe) + '</b> (precio de lista)</div>';

                if (g.incidencias.length) {
                    html += '<div style="margin-top:8px;font-size:.8rem;color:#fbbf24">'
                          + '⚠️ ' + g.incidencias.length + ' incidencia(s) — '
                          + '<a href="javascript:void(0)" onclick="_comprasVerIncidenciasGrupo(\'' + escapeHtml(g.compraId) + '\')" '
                          + 'style="color:#fbbf24;text-decoration:underline">ver detalle</a></div>';
                }
                if (diferencias.length) {
                    html += '<div style="margin-top:6px;font-size:.8rem;color:var(--txt-secondary)">'
                          + '💲 ' + diferencias.length + ' producto(s) con costo distinto al del catálogo (≥1%)</div>';
                }
                html += '</div>';
            });

            var hayGuardables = parsed.grupos.some(function(g) { return !g.fechaInvalida; });
            html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">';
            if (hayGuardables) {
                html += '<button type="button" onclick="confirmarImportacionCompras()" '
                      + 'style="padding:9px 15px;border-radius:var(--r-md);background:#065f46;'
                      + 'border:1px solid rgba(34,197,94,.28);color:#86efac;font-weight:600;cursor:pointer">'
                      + 'Confirmar e importar</button>';
            }
            html += '<button type="button" onclick="cancelarImportacionCompras()" '
                  + 'style="padding:9px 15px;border-radius:var(--r-md);background:var(--surface);'
                  + 'border:1px solid var(--border-mid);color:var(--txt-primary);cursor:pointer">Cancelar</button>'
                  + '</div>';
            return html;
        }

        function renderIncidenciasImportacion(resultado) {
            if (!resultado) return '';
            var html = '<div style="margin-bottom:14px">'
                     + '<div style="font-weight:700;font-size:1.05rem;margin-bottom:4px">Resultado de la importación</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.86rem">'
                     + resultado.creadas + ' entrada(s) guardada(s)'
                     + (resultado.yaExistian ? ' · ' + resultado.yaExistian + ' ya existía(n) (sin duplicar)' : '')
                     + (resultado.fallidas.length ? ' · <b style="color:#f87171">' + resultado.fallidas.length + ' no se pudieron guardar</b>' : '')
                     + '</div></div>';

            if (resultado.fallidas.length) {
                html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                      + 'background:rgba(239,68,68,.10);border:1px solid rgba(239,68,68,.28);color:#f87171;font-size:.84rem">';
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
                  + 'style="padding:9px 15px;border-radius:var(--r-md);background:var(--surface);'
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
                    _comprasImportPendiente = parsed;
                    comprasImportView = 'vista_previa';
                    renderTab();
                } catch (err) {
                    console.error('[Compras] Error leyendo el Excel:', err);
                    showNotification('❌ No se pudo leer el archivo — revisa que sea la exportación de "Entrada de mercancía"');
                }
            };
            reader.onerror = function() { showNotification('❌ Error leyendo el archivo'); };
            reader.readAsArrayBuffer(file);
            event.target.value = '';
        }

        async function confirmarImportacionCompras() {
            const parsed = _comprasImportPendiente;
            if (!parsed || !parsed.grupos || parsed.grupos.length === 0) return;

            _crearBackupNombrado('pre_importacion_compras_' + Date.now());
            showNotification('⏳ Guardando ' + parsed.grupos.length + ' entrada(s)…');

            const resultado = { creadas: 0, yaExistian: 0, fallidas: [], grupos: parsed.grupos };
            for (const g of parsed.grupos) {
                if (g.fechaInvalida) {
                    resultado.fallidas.push({ compraId: g.compraId, folio: g.folio, motivo: 'sin fecha válida — no se pudo asignar semana' });
                    continue;
                }
                const compra = {
                    compraId: g.compraId, folio: g.folio, docSap: g.docSap,
                    fecha: g.fecha, semanaId: g.semanaId,
                    proveedorCodigo: g.proveedorCodigo, proveedorNombre: g.proveedorNombre,
                    importe: g.importe, lineas: g.lineas, totalLineas: g.totalLineas,
                    origen: 'excel', creadoPor: currentUserUid || null, creadoEn: Date.now()
                };
                const res = await guardarCompra(compra);
                if (res.ok && res.motivo === 'creada')        resultado.creadas++;
                else if (res.ok && res.motivo === 'ya_existia') resultado.yaExistian++;
                else resultado.fallidas.push({ compraId: g.compraId, folio: g.folio, motivo: res.motivo || 'error desconocido' });
            }

            _comprasImportPendiente = null;
            _comprasImportResultado = resultado;
            comprasImportView = 'incidencias';
            const msg = resultado.creadas + ' entrada(s) guardada(s)'
                      + (resultado.fallidas.length ? ', ' + resultado.fallidas.length + ' con error' : '');
            showNotification((resultado.fallidas.length ? '⚠️ ' : '✅ ') + msg);
            renderTab();
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
            html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">';
            [['Documentos', r.documentos],
             ['Líneas', r.lineas],
             ['Proveedores', r.proveedores],
             ['Importe', _dineroMX(r.importe)]
            ].forEach(function(par) {
                html += '<div style="flex:1;min-width:120px;background:var(--surface);'
                      + 'border:1px solid var(--border-mid);border-radius:12px;padding:12px 14px">'
                      + '<div style="font-size:1.25rem;font-weight:700;letter-spacing:-.02em">'
                      + escapeHtml(String(par[1])) + '</div>'
                      + '<div style="font-size:.72rem;color:var(--txt-secondary);'
                      + 'text-transform:uppercase;letter-spacing:.05em;margin-top:3px">'
                      + escapeHtml(par[0]) + '</div></div>';
            });
            html += '</div>';

            // ── Acciones ──────────────────────────────────────────────────────
            html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">';
            if (hasPermission('purchases.import')) {
                html += '<button type="button" onclick="comprasImportarExcel()" '
                      + 'style="display:flex;align-items:center;gap:7px;padding:9px 15px;'
                      + 'border-radius:var(--r-md);background:#065f46;'
                      + 'border:1px solid rgba(34,197,94,.28);color:#86efac;font-weight:600;'
                      + 'cursor:pointer">Importar entrada de mercancía</button>';
            }
            if (hasPermission('purchases.create')) {
                html += '<button type="button" onclick="comprasNuevaManual()" '
                      + 'style="display:flex;align-items:center;gap:7px;padding:9px 15px;'
                      + 'border-radius:var(--r-md);background:var(--surface);'
                      + 'border:1px solid var(--border-mid);color:var(--txt-primary);'
                      + 'font-weight:600;cursor:pointer">Capturar a mano</button>';
            }
            html += '</div>';

            // ── Lista ─────────────────────────────────────────────────────────
            var lista = _comprasOrdenadas();
            if (lista.length === 0) {
                html += '<div style="text-align:center;padding:42px 18px;'
                      + 'background:var(--surface);border:1px solid var(--border-mid);'
                      + 'border-radius:12px">'
                      + '<div style="font-size:2.2rem;margin-bottom:10px">📦</div>'
                      + '<div style="font-weight:600;margin-bottom:6px">Todavía no hay compras registradas</div>'
                      + '<div style="color:var(--txt-secondary);font-size:.88rem;max-width:420px;'
                      + 'margin:0 auto;line-height:1.55">'
                      + 'Importa el Excel de entrada de mercancía de SAP, o captura una a mano. '
                      + 'Antes de guardar nada verás un resumen por proveedor y fecha para revisarlo.'
                      + '</div></div>';
            } else {
                lista.forEach(function(c) {
                    var totalLineas = Array.isArray(c.lineas) ? c.lineas.length : 0;
                    html += '<div style="background:var(--surface);border:1px solid var(--border-mid);'
                          + 'border-radius:12px;padding:14px 16px;margin-bottom:10px">'
                          + '<div style="display:flex;justify-content:space-between;gap:10px;'
                          + 'flex-wrap:wrap;align-items:baseline">'
                          + '<span style="font-weight:700">' + escapeHtml(c.proveedorNombre || 'Sin proveedor')
                          + (c.proveedorCodigo
                              ? ' <span style="color:var(--txt-secondary);font-weight:400;font-size:.82rem">('
                                + escapeHtml(c.proveedorCodigo) + ')</span>' : '')
                          + '</span>'
                          + '<span style="color:var(--txt-secondary);font-size:.84rem">'
                          + escapeHtml(_fechaLarga(c.fecha)) + '</span></div>'
                          + '<div style="color:var(--txt-secondary);font-size:.82rem;margin-top:5px">'
                          + 'Folio ' + escapeHtml(String(c.folio || '—'))
                          + (c.docSap ? ' · Doc SAP ' + escapeHtml(String(c.docSap)) : '')
                          + ' · ' + (c.origen === 'manual' ? 'capturada a mano' : 'importada de Excel')
                          + '</div>'
                          + '<div style="margin-top:7px;font-size:.9rem">'
                          + '<b>' + totalLineas + '</b> línea' + (totalLineas === 1 ? '' : 's')
                          + ' · ' + _unidadesCompra(c) + ' unidades'
                          + ' · <b>' + _dineroMX(c.importe) + '</b></div>'
                          + '</div>';
                });
            }

            html += '</div>';
            return html;
        }
