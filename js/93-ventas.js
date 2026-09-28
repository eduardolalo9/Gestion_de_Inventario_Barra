

        // ══════════════════════════════════════════════════════════════════════
        //  FASE 10 — VENTAS DEL POS (27/09/2026)
        //  ────────────────────────────────────────────────────────────────────
        //  Importa la hoja "Venta" del Excel real (export de Parrot), que es el
        //  insumo que le falta a la cadena del negocio:
        //
        //      Recetas!VENTA   = IF(Almacén="12", SUMIF(Venta!SKU, PV, Venta!Cantidad), 0)
        //      Recetas!CONSUMO = VENTA × Cantidad del ingrediente
        //      Tabla!Venta     = SUMIF(Recetas!Código insumo, Sap, Recetas!CONSUMO)
        //      Tabla!Total     = En Stock − Venta          ← stock teórico
        //      Pedido sugerido = IF(Total < Stock Mínimo, (Stock Mínimo − Total)/Conversión, 0)
        //
        //  ESTA FASE SOLO CARGA EL DATO. El cruce contra el Recetario (CONSUMO,
        //  stock teórico, desviación, pedido sugerido) es FASE 11 — decisión
        //  del propietario, para no mezclar importar con calcular.
        //
        //  Columnas reales verificadas (196 filas):
        //    Nombre, Tipo de artículo, Tipo, Precio actual, Cantidad,
        //    Precio promedio, Total artículos, Descuentos de artículo,
        //    Venta total, Impuestos, Venta neta, SKU
        //
        //  TRES COSAS QUE SE VERIFICARON EN EL ARCHIVO REAL Y QUE UN IMPORTADOR
        //  INGENUO SE COME:
        //
        //  1. Hay SKU REPETIDOS, y son legítimos: PVB1001270 aparece como
        //     "St Germain Sprit" (13) y "St Germain Spritz promo 2x1" (3).
        //     El SUMIF del Excel los SUMA: 16. Un mapa "el último gana"
        //     subcontaría en silencio, que es la peor clase de error. Aquí se
        //     suman, y hay prueba dedicada.
        //  2. La última fila es una NOTA al pie ("Nota: Esta tabla no toma en
        //     cuenta los descuentos de orden."), no un dato. Se descarta sin
        //     incidencia, igual que la fila de totales en Compras.
        //  3. NO se filtran las ventas por tipo de artículo. Importa TODO,
        //     incluidos alimentos: el filtro de barra ya se aplicó del lado de
        //     la receta (almacén 12). Si aquí se importara solo PVB, se
        //     perdería la BOHEMIA que consume la BARBACOA DE SHORT RIB.
        //
        //  EL PERIODO NO VIENE EN EL ARCHIVO. La hoja "Venta" no trae fecha en
        //  ninguna columna. La app propone la semana del inventario abierto y
        //  el admin la confirma o la cambia en la vista previa antes de
        //  guardar — mismo criterio que H-40 con la fecha de recuento: se
        //  propone algo válido, nunca se impone en silencio.
        // ══════════════════════════════════════════════════════════════════════

        const COLUMNAS_EXCEL_VENTAS = {
            nombre:     ['Nombre', 'nombre'],
            tipo:       ['Tipo de artículo', 'Tipo de articulo', 'tipo de articulo'],
            cantidad:   ['Cantidad', 'cantidad'],
            ventaNeta:  ['Venta neta', 'venta neta', 'VentaNeta'],
            sku:        ['SKU', 'sku', 'PV', 'pv']
        };

        // Tope defensivo alineado con la regla de Firestore (3,000 líneas):
        // la carta actual tiene 1,359 SKU, así que da holgura de sobra sin
        // acercarse al límite de 1 MB por documento.
        const VENTAS_MAX_LINEAS = 3000;

        /**
         * semanaVentasPorDefecto()
         * La semana que la app PROPONE al importar: la del inventario abierto
         * si lo hay (por su fecha de recuento), y si no, la semana en curso.
         * Es una propuesta — la vista previa la muestra y se puede cambiar.
         */
        function semanaVentasPorDefecto() {
            try {
                if (typeof _inventarioActivo !== 'undefined' && _inventarioActivo && _inventarioActivo.fechaRecuento) {
                    var s = semanaId(_inventarioActivo.fechaRecuento);
                    if (s) return s;
                }
            } catch (_) { /* sin inventario cargado: se cae a la semana en curso */ }
            return semanaId(new Date());
        }
        window.semanaVentasPorDefecto = semanaVentasPorDefecto;

        /**
         * _parsearExcelVentas(filas)
         * Agrupa por SKU SUMANDO las cantidades (ver punto 1 de la cabecera).
         * Devuelve las líneas listas para guardar más el detalle de lo que se
         * descartó, para que la vista previa no esconda nada.
         */
        function _parsearExcelVentas(filas) {
            const porSku = {};
            const orden = [];
            const incidencias = [];
            let filasSinSku = 0;
            let filasIgnoradas = 0;   // nota al pie y filas totalmente vacías

            (filas || []).forEach(function(fila) {
                const skuCrudo = _findColCompras(fila, COLUMNAS_EXCEL_VENTAS.sku);
                const nombre = _findColCompras(fila, COLUMNAS_EXCEL_VENTAS.nombre);
                const cantidadCruda = _findColCompras(fila, COLUMNAS_EXCEL_VENTAS.cantidad);

                if (skuCrudo === undefined || skuCrudo === null || String(skuCrudo).trim() === '') {
                    // Sin SKU y sin cantidad no es una venta: es la nota al pie
                    // del reporte o una fila en blanco. Se descarta en silencio.
                    if (cantidadCruda === undefined || cantidadCruda === null || String(cantidadCruda).trim() === '') {
                        filasIgnoradas++;
                    } else {
                        filasSinSku++;
                        incidencias.push({
                            tipo: 'sin_sku', sku: '', nombre: String(nombre || ''),
                            detalle: 'Fila con cantidad (' + cantidadCruda + ') pero sin SKU: "' +
                                     String(nombre || '—') + '" — no se puede cruzar con ninguna receta, se omite'
                        });
                    }
                    return;
                }

                const sku = String(skuCrudo).trim();
                const cantidad = _numeroExcel(cantidadCruda);
                if (cantidad === null) {
                    incidencias.push({
                        tipo: 'cantidad_invalida', sku: sku, nombre: String(nombre || ''),
                        detalle: 'Cantidad no numérica: "' + cantidadCruda + '" en "' + String(nombre || sku) + '" — línea omitida'
                    });
                    return;
                }

                if (!porSku[sku]) {
                    porSku[sku] = {
                        sku: sku,
                        nombre: String(nombre || '').trim(),
                        tipo: String(_findColCompras(fila, COLUMNAS_EXCEL_VENTAS.tipo) || '').trim(),
                        cantidad: 0,
                        ventaNeta: 0,
                        filas: 0
                    };
                    orden.push(sku);
                }
                const g = porSku[sku];
                // ── El punto 1 de la cabecera: se SUMA, nunca se reemplaza ──
                g.cantidad += cantidad;
                g.filas++;
                const neta = _numeroExcel(_findColCompras(fila, COLUMNAS_EXCEL_VENTAS.ventaNeta));
                if (neta !== null) g.ventaNeta += neta;
                // El nombre de la variante promo es menos útil que el base:
                // se conserva el primero que llegó, que es el de mayor venta
                // porque el reporte viene ordenado de mayor a menor.
            });

            const lineas = orden.map(function(sku) {
                const g = porSku[sku];
                return {
                    sku: g.sku, nombre: g.nombre, tipo: g.tipo,
                    cantidad: Math.round(g.cantidad * 1000) / 1000,
                    ventaNeta: Math.round(g.ventaNeta * 100) / 100
                };
            });

            const agrupadas = orden.filter(function(sku) { return porSku[sku].filas > 1; })
                                   .map(function(sku) { return { sku: sku, nombre: porSku[sku].nombre, filas: porSku[sku].filas }; });

            return {
                lineas: lineas,
                incidencias: incidencias,
                skusAgrupados: agrupadas,
                filasSinSku: filasSinSku,
                filasIgnoradas: filasIgnoradas,
                totalFilas: (filas || []).length,
                totalUnidades: Math.round(lineas.reduce(function(a, l) { return a + l.cantidad; }, 0) * 1000) / 1000,
                excedeTope: lineas.length > VENTAS_MAX_LINEAS
            };
        }

        // ══════════════════════════════════════════════════════════════════════
        //  CAPA DE DATOS — un documento por semana
        // ══════════════════════════════════════════════════════════════════════

        /**
         * guardarVentasSemana(semana, lineas)
         * Escribe inventarioApp/{docId}/ventas/{semanaId}. `set` sin merge a
         * propósito: reimportar una semana REEMPLAZA su contenido (decisión
         * del propietario) — un reporte de ventas es una foto que el POS puede
         * volver a exportar corregida, no un asiento contable.
         */
        async function guardarVentasSemana(semana, lineas) {
            if (!_db) return { ok: false, motivo: 'sin conexión a Firestore' };
            if (!hasPermission('sales.import')) return { ok: false, motivo: 'sin permiso sales.import' };
            try {
                const total = lineas.reduce(function(a, l) { return a + (l.cantidad || 0); }, 0);
                await _docPrincipal().collection('ventas').doc(semana).set({
                    semanaId: semana,
                    lineas: lineas,
                    totalSkus: lineas.length,
                    totalUnidades: Math.round(total * 1000) / 1000,
                    origen: 'excel',
                    importadoPor: currentUserUid || null,
                    importadoEn: Date.now()
                });
                return { ok: true };
            } catch (e) {
                console.error('[Ventas] Error guardando la semana ' + semana + ':', e);
                return { ok: false, motivo: (e && e.message) ? e.message : 'error desconocido' };
            }
        }
        window.guardarVentasSemana = guardarVentasSemana;

        /**
         * cargarVentasSemana(semana)
         * Trae una semana a memoria (`ventas` + `ventasSemanaId`). Devuelve
         * true si el documento existía. No lanza: sin permiso o sin red deja
         * lo que ya hubiera en memoria y lo reporta como false.
         */
        async function cargarVentasSemana(semana) {
            if (!_db || !semana) return false;
            try {
                const snap = await _docPrincipal().collection('ventas').doc(semana).get();
                if (!snap.exists) {
                    ventas = [];
                    ventasSemanaId = semana;
                    saveToLocalStorage();
                    return false;
                }
                const d = snap.data() || {};
                ventas = Array.isArray(d.lineas) ? d.lineas : [];
                ventasSemanaId = semana;
                saveToLocalStorage();
                return true;
            } catch (e) {
                console.warn('[Ventas] No se pudo leer la semana ' + semana + ':', e);
                return false;
            }
        }
        window.cargarVentasSemana = cargarVentasSemana;

        // ══════════════════════════════════════════════════════════════════════
        //  VISTA PREVIA E INCIDENCIAS
        // ══════════════════════════════════════════════════════════════════════

        function renderVistaPreviaVentas(parsed) {
            if (!parsed || !parsed.lineas || parsed.lineas.length === 0) {
                return '<div style="text-align:center;padding:32px 18px;background:var(--surface);'
                     + 'border:1px solid var(--border-mid);border-radius:12px">'
                     + '<div style="font-weight:600;margin-bottom:6px">No hay ninguna venta con SKU en este archivo</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.86rem">Revisa que sea la hoja "Venta" del reporte del POS.</div></div>'
                     + '<div style="margin-top:14px"><button type="button" onclick="cancelarImportacionVentas()" '
                     + 'style="padding:9px 15px;border-radius:var(--r-md);background:var(--surface);'
                     + 'border:1px solid var(--border-mid);color:var(--txt-primary);cursor:pointer">Cerrar</button></div>';
            }

            var semana = parsed.semanaDestino;
            var yaHabia = parsed.yaExistia;

            var html = '<div style="margin-bottom:14px">'
                     + '<div style="font-weight:700;font-size:1.05rem;margin-bottom:4px">Vista previa de la importación de ventas</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.86rem;line-height:1.5">'
                     + '<b>' + parsed.lineas.length + '</b> SKU · <b>' + parsed.totalUnidades + '</b> unidades vendidas'
                     + (parsed.filasIgnoradas ? ' · ' + parsed.filasIgnoradas + ' fila(s) sin datos (descartadas)' : '')
                     + (parsed.incidencias.length ? ' · <b style="color:#fbbf24">' + parsed.incidencias.length + ' incidencia(s)</b>' : '')
                     + '</div></div>';

            // ── El periodo: lo más importante de esta pantalla ──────────────
            html += '<div style="padding:12px 14px;margin-bottom:14px;border-radius:12px;'
                  + 'background:var(--surface);border:1px solid var(--border-mid)">'
                  + '<div style="font-weight:600;margin-bottom:6px">¿A qué semana pertenecen estas ventas?</div>'
                  + '<div style="color:var(--txt-secondary);font-size:.82rem;line-height:1.5;margin-bottom:8px">'
                  + 'El reporte del POS no trae la fecha en ninguna columna, así que la propone la app '
                  + '(la semana del inventario abierto). Cámbiala si estas ventas son de otra semana.</div>'
                  + '<input type="date" id="ventasSemanaInput" value="' + escapeHtml(semana) + '" '
                  + 'onchange="_ventasCambiarSemana(this.value)" '
                  + 'style="padding:8px 10px;border-radius:8px;border:1px solid var(--border-mid);'
                  + 'background:var(--card,#fff);color:var(--txt-primary);font-size:.9rem">'
                  + '<div style="color:var(--txt-secondary);font-size:.78rem;margin-top:6px">'
                  + 'Semana registrada: <b>' + escapeHtml(semana) + '</b> (lunes de esa semana)</div>'
                  + '</div>';

            if (yaHabia) {
                html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                      + 'background:rgba(251,191,36,.10);border:1px solid rgba(251,191,36,.28);'
                      + 'color:#fbbf24;font-size:.82rem;line-height:1.5">'
                      + '⚠️ Esta semana <b>ya tenía ' + yaHabia + ' SKU cargados</b>. Al confirmar se reemplazan por completo '
                      + 'con los de este archivo.</div>';
            }

            if (parsed.excedeTope) {
                html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                      + 'background:rgba(239,68,68,.10);border:1px solid rgba(239,68,68,.28);color:#f87171;font-size:.82rem">'
                      + '🛑 El archivo trae ' + parsed.lineas.length + ' SKU y el tope por semana es ' + VENTAS_MAX_LINEAS
                      + '. No se puede guardar: revisa que el reporte sea de un solo periodo.</div>';
            }

            if (parsed.skusAgrupados && parsed.skusAgrupados.length) {
                html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                      + 'background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.28);color:#60a5fa;font-size:.82rem;line-height:1.5">'
                      + 'ℹ️ ' + parsed.skusAgrupados.length + ' SKU venían en varias filas (variantes promo, 2x1) y '
                      + '<b>se sumaron</b>, como hace el Excel: '
                      + escapeHtml(parsed.skusAgrupados.slice(0, 4).map(function(s) { return s.nombre + ' (' + s.filas + ')'; }).join(', '))
                      + (parsed.skusAgrupados.length > 4 ? '…' : '') + '</div>';
            }

            // Las 12 más vendidas, para que se reconozca de un vistazo si el
            // archivo es el correcto sin pintar 200 filas en un teléfono.
            var top = parsed.lineas.slice().sort(function(a, b) { return b.cantidad - a.cantidad; }).slice(0, 12);
            html += '<div style="background:var(--surface);border:1px solid var(--border-mid);border-radius:12px;padding:12px 14px;margin-bottom:10px">'
                  + '<div style="font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--txt-secondary);margin-bottom:8px">Más vendidos en el archivo</div>'
                  + '<table style="width:100%;border-collapse:collapse;font-size:.85rem">';
            top.forEach(function(l) {
                html += '<tr style="border-bottom:1px solid var(--border-mid)">'
                      + '<td style="padding:6px 4px">' + escapeHtml(l.nombre || l.sku) + '</td>'
                      + '<td style="padding:6px 4px;text-align:right;color:var(--txt-secondary);white-space:nowrap">' + l.cantidad + '</td>'
                      + '</tr>';
            });
            html += '</table></div>';

            if (parsed.incidencias.length) {
                html += '<div style="margin-top:8px;font-size:.8rem;color:#fbbf24">'
                      + '⚠️ ' + parsed.incidencias.length + ' incidencia(s) — '
                      + '<a href="javascript:void(0)" onclick="_ventasVerIncidencias()" style="color:#fbbf24;text-decoration:underline">ver detalle</a></div>';
            }

            html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">';
            if (!parsed.excedeTope) {
                html += '<button type="button" onclick="confirmarImportacionVentas()" '
                      + 'style="padding:9px 15px;border-radius:var(--r-md);background:#065f46;'
                      + 'border:1px solid rgba(34,197,94,.28);color:#86efac;font-weight:600;cursor:pointer">'
                      + 'Confirmar e importar</button>';
            }
            html += '<button type="button" onclick="cancelarImportacionVentas()" '
                  + 'style="padding:9px 15px;border-radius:var(--r-md);background:var(--surface);'
                  + 'border:1px solid var(--border-mid);color:var(--txt-primary);cursor:pointer">Cancelar</button>'
                  + '</div>';
            return html;
        }

        function renderIncidenciasVentas(resultado) {
            if (!resultado) return '';
            var html = '<div style="margin-bottom:14px">'
                     + '<div style="font-weight:700;font-size:1.05rem;margin-bottom:4px">Resultado de la importación</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.86rem">'
                     + (resultado.guardado
                         ? resultado.totalSkus + ' SKU guardados en la semana ' + escapeHtml(resultado.semanaId)
                         : '<b style="color:#f87171">No se guardó: ' + escapeHtml(resultado.motivo || 'error desconocido') + '</b>')
                     + '</div></div>';

            if (resultado.incidencias && resultado.incidencias.length) {
                html += '<div style="font-weight:600;margin-bottom:8px">Incidencias (' + resultado.incidencias.length + ')</div>';
                resultado.incidencias.forEach(function(inc) {
                    html += '<div style="background:var(--surface);border:1px solid var(--border-mid);'
                          + 'border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:.84rem">'
                          + '<div style="color:var(--txt-secondary);font-size:.76rem;margin-bottom:2px">'
                          + escapeHtml(inc.sku || '(sin SKU)') + '</div>'
                          + escapeHtml(inc.detalle) + '</div>';
                });
            } else {
                html += '<div style="color:var(--txt-secondary);font-size:.86rem">Sin incidencias.</div>';
            }

            html += '<div style="margin-top:16px"><button type="button" onclick="cerrarResultadoImportacionVentas()" '
                  + 'style="padding:9px 15px;border-radius:var(--r-md);background:var(--surface);'
                  + 'border:1px solid var(--border-mid);color:var(--txt-primary);cursor:pointer">Aceptar</button></div>';
            return html;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  ORQUESTACIÓN DE LA PANTALLA
        // ══════════════════════════════════════════════════════════════════════

        function ventasImportarExcel() {
            if (!hasPermission('sales.import')) {
                showNotification('⚠️ No tienes permiso para importar ventas');
                return;
            }
            const input = document.getElementById('fileInputVentas');
            if (input) input.click();
        }
        window.ventasImportarExcel = ventasImportarExcel;

        function handleFileImportVentas(event) {
            const file = event.target.files[0];
            if (!file) return;
            if (!hasPermission('sales.import')) {
                showNotification('⚠️ No tienes permiso para importar ventas');
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
                    // Igual que el importador de recetas: la hoja se busca por
                    // NOMBRE, porque el Excel real trae 13 y "Venta" no es la
                    // primera. Si el POS exporta un archivo de una sola hoja,
                    // se usa esa.
                    var nombreHoja = workbook.SheetNames.find(function(n) {
                        return _normCabCompras(n) === 'venta' || _normCabCompras(n) === 'ventas';
                    }) || workbook.SheetNames[0];
                    const sheet = workbook.Sheets[nombreHoja];
                    if (!sheet) { showNotification('No se encontró una hoja "Venta" en el archivo'); return; }
                    const filas = XLSX.utils.sheet_to_json(sheet);
                    if (!filas || filas.length === 0) { showNotification('La hoja "Venta" no contiene datos'); return; }

                    const parsed = _parsearExcelVentas(filas);
                    parsed.semanaDestino = semanaVentasPorDefecto();
                    parsed.yaExistia = (ventasSemanaId === parsed.semanaDestino && ventas.length) ? ventas.length : 0;
                    _ventasImportPendiente = parsed;
                    ventasImportView = 'vista_previa';
                    renderTab();
                    // La semana propuesta puede tener ventas ya cargadas en el
                    // servidor aunque no estén en memoria: se consulta y se
                    // repinta el aviso si aparece.
                    _ventasRevisarSemanaExistente(parsed.semanaDestino);
                } catch (err) {
                    console.error('[Ventas] Error leyendo el Excel:', err);
                    showNotification('❌ No se pudo leer el archivo — revisa que sea el reporte de ventas del POS');
                }
            };
            reader.onerror = function() { showNotification('❌ Error leyendo el archivo'); };
            reader.readAsArrayBuffer(file);
            event.target.value = '';
        }
        window.handleFileImportVentas = handleFileImportVentas;

        /** Consulta si la semana destino ya tenía ventas y repinta el aviso. */
        async function _ventasRevisarSemanaExistente(semana) {
            if (!_db || !_ventasImportPendiente) return;
            try {
                const snap = await _docPrincipal().collection('ventas').doc(semana).get();
                if (!_ventasImportPendiente || _ventasImportPendiente.semanaDestino !== semana) return;
                const d = snap.exists ? (snap.data() || {}) : null;
                _ventasImportPendiente.yaExistia = (d && Array.isArray(d.lineas)) ? d.lineas.length : 0;
                if (ventasImportView === 'vista_previa') renderTab();
            } catch (_) { /* sin permiso de lectura o sin red: el aviso simplemente no se muestra */ }
        }

        /** Cambia la semana destino desde la vista previa. */
        function _ventasCambiarSemana(valor) {
            if (!_ventasImportPendiente) return;
            var s = semanaId(valor);
            if (!s) { showNotification('⚠️ Fecha no válida'); return; }
            _ventasImportPendiente.semanaDestino = s;
            _ventasImportPendiente.yaExistia = 0;
            renderTab();
            _ventasRevisarSemanaExistente(s);
        }
        window._ventasCambiarSemana = _ventasCambiarSemana;

        async function confirmarImportacionVentas() {
            const parsed = _ventasImportPendiente;
            if (!parsed || !parsed.lineas || parsed.lineas.length === 0) return;
            if (parsed.excedeTope) { showNotification('⚠️ El archivo excede el tope de ' + VENTAS_MAX_LINEAS + ' SKU'); return; }

            _crearBackupNombrado('pre_importacion_ventas_' + Date.now());
            showNotification('⏳ Guardando ' + parsed.lineas.length + ' SKU de la semana ' + parsed.semanaDestino + '…');

            const res = await guardarVentasSemana(parsed.semanaDestino, parsed.lineas);
            if (res.ok) {
                ventas = parsed.lineas;
                ventasSemanaId = parsed.semanaDestino;
                saveToLocalStorage();
                // FASE 11A — el cruce recetario×ventas cambió: se recalcula.
                if (typeof consumoTeoricoInvalidar === 'function') consumoTeoricoInvalidar();
            }

            _ventasImportPendiente = null;
            _ventasImportResultado = {
                guardado: res.ok, motivo: res.motivo || null,
                semanaId: parsed.semanaDestino, totalSkus: parsed.lineas.length,
                incidencias: parsed.incidencias
            };
            ventasImportView = 'incidencias';
            showNotification(res.ok
                ? '✅ Ventas de la semana ' + parsed.semanaDestino + ' guardadas'
                : '❌ No se pudieron guardar las ventas: ' + (res.motivo || 'error'));
            renderTab();
        }
        window.confirmarImportacionVentas = confirmarImportacionVentas;

        function cancelarImportacionVentas() {
            _ventasImportPendiente = null;
            ventasImportView = 'lista';
            renderTab();
        }
        window.cancelarImportacionVentas = cancelarImportacionVentas;

        function cerrarResultadoImportacionVentas() {
            _ventasImportResultado = null;
            ventasImportView = 'lista';
            renderTab();
        }
        window.cerrarResultadoImportacionVentas = cerrarResultadoImportacionVentas;

        function _ventasVerIncidencias() {
            if (!_ventasImportPendiente) return;
            _ventasImportResultado = {
                guardado: false, motivo: 'todavía no se ha importado (vista previa)',
                semanaId: _ventasImportPendiente.semanaDestino,
                totalSkus: _ventasImportPendiente.lineas.length,
                incidencias: _ventasImportPendiente.incidencias
            };
            ventasImportView = 'incidencias';
            renderTab();
        }
        window._ventasVerIncidencias = _ventasVerIncidencias;

        // ══════════════════════════════════════════════════════════════════════
        //  RENDER DE LA PESTAÑA
        // ══════════════════════════════════════════════════════════════════════

        function renderVentasTab() {
            if (!hasPermission('sales.read')) {
                return '<div style="text-align:center;padding:60px 20px;color:var(--txt-secondary);">' +
                       '<p style="font-size:1rem;">🔒 No tienes acceso a las ventas.</p></div>';
            }
            if (typeof ventasImportView === 'undefined') ventasImportView = 'lista';
            if (ventasImportView === 'vista_previa' && _ventasImportPendiente) {
                return '<div style="padding:4px 0 8px">' + renderVistaPreviaVentas(_ventasImportPendiente) + '</div>';
            }
            if (ventasImportView === 'incidencias' && _ventasImportResultado) {
                return '<div style="padding:4px 0 8px">' + renderIncidenciasVentas(_ventasImportResultado) + '</div>';
            }

            var puedeImportar = hasPermission('sales.import');
            var html = '<div style="padding:4px 0 8px">';

            if (!ventas.length) {
                html += '<div style="text-align:center;padding:50px 20px;color:var(--txt-secondary);">'
                      + '<p>📈 Todavía no hay ventas cargadas'
                      + (ventasSemanaId ? ' para la semana ' + escapeHtml(ventasSemanaId) : '') + '. '
                      + (puedeImportar ? 'Impórtalas desde el reporte del POS con el botón de arriba.'
                                       : 'El administrador todavía no las importa.')
                      + '</p></div></div>';
                return html;
            }

            var unidades = Math.round(ventas.reduce(function(a, l) { return a + (l.cantidad || 0); }, 0) * 1000) / 1000;
            html += '<div style="background:var(--surface);border:1px solid var(--border-mid);border-radius:12px;padding:14px 16px;margin-bottom:12px">'
                  + '<div style="font-weight:700">Semana ' + escapeHtml(ventasSemanaId || '—') + '</div>'
                  + '<div style="color:var(--txt-secondary);font-size:.86rem;margin-top:4px">'
                  + '<b>' + ventas.length + '</b> SKU · <b>' + unidades + '</b> unidades vendidas</div>'
                  + '<div style="color:var(--txt-secondary);font-size:.78rem;margin-top:6px">'
                  + 'El cruce contra el recetario (consumo teórico y desviación) llega en la siguiente fase.</div>'
                  + '</div>';

            // ── FASE 11A — consumo teórico calculado con el recetario ────────
            html += _renderConsumoTeorico();

            var ordenadas = ventas.slice().sort(function(a, b) { return (b.cantidad || 0) - (a.cantidad || 0); });
            html += '<table style="width:100%;border-collapse:collapse;font-size:.86rem">';
            ordenadas.forEach(function(l) {
                html += '<tr style="border-bottom:1px solid var(--border-mid)">'
                      + '<td style="padding:8px 4px;color:var(--txt-primary)">' + escapeHtml(l.nombre || l.sku)
                      + '<div style="color:var(--txt-secondary);font-size:.72rem">' + escapeHtml(l.sku) + '</div></td>'
                      + '<td style="padding:8px 4px;text-align:right;color:var(--txt-secondary);white-space:nowrap">' + (l.cantidad || 0) + '</td>'
                      + '</tr>';
            });
            html += '</table></div>';
            return html;
        }
        window.renderVentasTab = renderVentasTab;

        /**
         * _renderConsumoTeorico()
         * FASE 11A — la pantalla donde se verifica el cruce contra el Excel
         * antes de confiar en él. Muestra los insumos más consumidos y, sobre
         * todo, los avisos: un PV vendido sin receta no descuenta nada de
         * ningún insumo y haría que el stock teórico salga alto sin que nada
         * falle a la vista.
         */
        function _renderConsumoTeorico() {
            if (typeof consumoTeorico !== 'function') return '';
            var r = consumoTeorico();
            var html = '<div style="background:var(--surface);border:1px solid var(--border-mid);border-radius:12px;padding:14px 16px;margin-bottom:12px">'
                     + '<div style="font-weight:700;margin-bottom:2px">Consumo teórico</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.8rem;line-height:1.5;margin-bottom:8px">'
                     + 'Lo que el recetario dice que debió salir de la barra con estas ventas. '
                     + 'Es el mismo cálculo del Excel: unidades vendidas × cantidad de cada receta.</div>';

            if (!recetas || !recetas.length) {
                html += '<div style="color:#fbbf24;font-size:.84rem">⚠️ No hay recetario cargado: sin recetas no hay consumo que calcular.</div></div>';
                return html;
            }

            var top = consumoTeoricoTop(10);
            if (!top.length) {
                html += '<div style="color:var(--txt-secondary);font-size:.84rem">Ningún SKU vendido cruzó con una receta.</div>';
            } else {
                html += '<div style="color:var(--txt-secondary);font-size:.78rem;margin-bottom:6px">'
                      + Object.keys(r.consumo).length + ' insumo(s) con consumo · ' + r.lineasCalculadas + ' línea(s) de receta aplicadas</div>'
                      + '<table style="width:100%;border-collapse:collapse;font-size:.84rem">';
                top.forEach(function(x) {
                    html += '<tr style="border-bottom:1px solid var(--border-mid)">'
                          + '<td style="padding:6px 4px">' + escapeHtml(x.nombre)
                          + (x.enCatalogo ? '' : ' <span style="color:#dc2626;font-size:.72rem">(no está en el catálogo)</span>') + '</td>'
                          + '<td style="padding:6px 4px;text-align:right;color:var(--txt-secondary);white-space:nowrap">'
                          + x.cantidad + ' ' + escapeHtml(x.unidad) + '</td></tr>';
                });
                html += '</table>';
            }

            var a = r.avisos;
            if (a.sinReceta.length) {
                html += '<div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:rgba(251,191,36,.10);'
                      + 'border:1px solid rgba(251,191,36,.28);color:#fbbf24;font-size:.8rem;line-height:1.5">'
                      + '⚠️ <b>' + a.sinReceta.length + ' producto(s) vendidos sin receta</b> — su consumo NO se descuenta de ningún insumo, '
                      + 'así que el stock teórico de esos insumos saldrá alto: '
                      + escapeHtml(a.sinReceta.slice(0, 4).map(function(x) { return x.nombre; }).join(', '))
                      + (a.sinReceta.length > 4 ? '…' : '') + '</div>';
            }
            if (a.sinCatalogo.length) {
                html += '<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(239,68,68,.10);'
                      + 'border:1px solid rgba(239,68,68,.28);color:#f87171;font-size:.8rem;line-height:1.5">'
                      + '🛑 <b>' + a.sinCatalogo.length + ' insumo(s) de receta no están en el catálogo</b> — su consumo se calcula pero no hay stock del cual restarlo: '
                      + escapeHtml(a.sinCatalogo.slice(0, 4).map(function(x) { return x.descripcion; }).join(', '))
                      + (a.sinCatalogo.length > 4 ? '…' : '') + '</div>';
            }
            if (a.uomDistinta.length) {
                html += '<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(148,163,184,.10);'
                      + 'border:1px solid rgba(148,163,184,.28);color:var(--txt-secondary);font-size:.8rem;line-height:1.5">'
                      + 'ℹ️ ' + a.uomDistinta.length + ' insumo(s) con unidad de receta distinta a la del catálogo. Se calculan como hace el Excel '
                      + '(sin convertir), pero conviene revisarlos: '
                      + escapeHtml(a.uomDistinta.slice(0, 3).map(function(x) { return x.nombre + ' (' + x.uomReceta + ' vs ' + x.unidadProducto + ')'; }).join(', '))
                      + (a.uomDistinta.length > 3 ? '…' : '') + '</div>';
            }

            html += '<div style="margin-top:10px;color:var(--txt-secondary);font-size:.76rem">'
                  + 'La app todavía NO decide con esta cifra: la fuente oficial sigue apagada hasta que la compares con tu Excel.</div>';
            html += '</div>';
            return html;
        }
