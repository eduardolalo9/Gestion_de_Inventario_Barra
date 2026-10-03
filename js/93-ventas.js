

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
        //
        //  ── FASE 10B (30/09/2026) ─────────────────────────────────────────
        //  1. LA HOJA ES "Detalle". El reporte que exporta Parrot trae tres
        //     hojas: Resumen, Detalle y Cargos (verificado en los tres
        //     archivos reales: Ventas_05092026 y dos Ventas_17-09-2026). Las
        //     ventas por SKU están en "Detalle", con las mismas columnas que la
        //     hoja "Venta" del Formato. El importador anterior buscaba "Venta"
        //     y, al no encontrarla, tomaba la PRIMERA hoja — "Resumen" — y
        //     decía que no había ventas. Ya no se cae nunca a la primera hoja:
        //     sin "Detalle" (o "Venta" del Formato) no se importa y se dice.
        //  2. EL PERIODO ES UN RANGO DE FECHAS (inicio–fin); un solo día es
        //     inicio = fin. Un documento por periodo:
        //         ventas/{fechaInicio}_{fechaFin}
        //     Reglas del propietario:
        //       · Una fecha ya cargada NO se vuelve a subir: se bloquea con un
        //         mensaje que nombra la fecha ("La fecha 23/09/2026 ya se
        //         encuentra en el sistema"). Ya no existe "reimportar
        //         reemplaza" — el servidor lo refuerza: create sí, update no.
        //       · El rango debe caer dentro de una semana lunes–domingo: el
        //         reporte trae las cantidades sumadas, así que no se puede
        //         repartir por día entre dos semanas.
        //       · No se aceptan fechas futuras: cargar hoy "lunes a domingo"
        //         bloquearía para siempre los días que todavía no pasan.
        //     `ventas` en memoria es la SUMA de todos los periodos de la
        //     semana; así el consumo teórico (js/48) no cambia.
        //     Los documentos anteriores (id = semanaId, sin fechas) se leen
        //     como la semana completa: sus fechas cuentan como cargadas.
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

        // ══════════════════════════════════════════════════════════════════════
        //  FASE 10B — HOJA Y PERIODO (funciones puras, probadas aparte)
        // ══════════════════════════════════════════════════════════════════════

        /**
         * _ventasElegirHoja(nombres)
         * "Detalle" es la hoja del reporte de Parrot; "Venta"/"Ventas" es la
         * del Formato de barra, con las mismas columnas. Devuelve null si no
         * hay ninguna: NUNCA la primera hoja, que en el reporte es "Resumen".
         */
        function _ventasElegirHoja(nombres) {
            var lista = Array.isArray(nombres) ? nombres : [];
            var buscar = function(objetivos) {
                return lista.find(function(n) { return objetivos.indexOf(_normCabCompras(n)) !== -1; }) || null;
            };
            return buscar(['detalle']) || buscar(['venta', 'ventas']);
        }
        window._ventasElegirHoja = _ventasElegirHoja;

        /** 'YYYY-MM-DD' → '23/09/2026'. */
        function _ventasFmtFecha(iso) {
            var f = parseFechaLocal(iso);
            if (!f) return String(iso || '—');
            return String(f.getDate()).padStart(2, '0') + '/' + String(f.getMonth() + 1).padStart(2, '0') + '/' + f.getFullYear();
        }
        window._ventasFmtFecha = _ventasFmtFecha;

        /** Id del documento de un periodo. Un día: '2026-09-23_2026-09-23'. */
        function _ventasPeriodoId(inicio, fin) { return inicio + '_' + fin; }

        /** Todas las fechas ISO de inicio a fin, ambas incluidas. */
        function _ventasFechasDelRango(inicio, fin) {
            var a = parseFechaLocal(inicio), b = parseFechaLocal(fin);
            if (!a || !b || a > b) return [];
            var out = [];
            for (var d = new Date(a); d <= b && out.length < 400; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
                out.push(fechaISOLocal(d));
            }
            return out;
        }
        window._ventasFechasDelRango = _ventasFechasDelRango;

        /**
         * Normaliza un documento de ventas a periodo. Los anteriores a 10B
         * (id = semanaId, sin fechas) cubren la semana completa.
         */
        function _ventasPeriodoDeDoc(id, d) {
            d = d || {};
            var legado = !d.fechaInicio || !d.fechaFin;
            var semana = d.semanaId || semanaId(d.fechaInicio || id);
            var inicio = legado ? semana : d.fechaInicio;
            var fin    = d.fechaFin;
            if (legado) {
                var l = parseFechaLocal(semana);
                fin = l ? fechaISOLocal(new Date(l.getFullYear(), l.getMonth(), l.getDate() + 6)) : semana;
            }
            return {
                id: id, semanaId: semana, inicio: inicio, fin: fin, legado: legado,
                totalSkus: d.totalSkus || (Array.isArray(d.lineas) ? d.lineas.length : 0),
                totalUnidades: d.totalUnidades || 0,
                importadoEn: d.importadoEn || null
            };
        }
        window._ventasPeriodoDeDoc = _ventasPeriodoDeDoc;

        /**
         * periodoVentasPorDefecto(hoyISO?)
         * Propone de lunes a domingo de la semana del inventario abierto, pero
         * nunca más allá de hoy: si la semana está en curso, el fin es hoy.
         */
        function periodoVentasPorDefecto(hoyISO) {
            var semana = semanaVentasPorDefecto();
            var lunes = parseFechaLocal(semana);
            var domingo = fechaISOLocal(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6));
            var hoy = hoyISO || fechaISOLocal(new Date());
            var fin = domingo < hoy ? domingo : hoy;
            if (fin < semana) fin = semana;
            return { inicio: semana, fin: fin };
        }
        window.periodoVentasPorDefecto = periodoVentasPorDefecto;

        /**
         * validarPeriodoVentas(inicio, fin, periodosExistentes, hoyISO?)
         * La regla completa del periodo, sin tocar la pantalla ni la red.
         * Fin vacío = un solo día (fin = inicio).
         * Devuelve { ok, errores[], avisos[], inicio, fin, semanaId, dias[], conflictos[] }.
         */
        function validarPeriodoVentas(inicio, fin, periodosExistentes, hoyISO) {
            var r = { ok: false, errores: [], avisos: [], inicio: inicio || '', fin: fin || inicio || '',
                      semanaId: null, dias: [], conflictos: [] };
            var hoy = hoyISO || fechaISOLocal(new Date());
            if (!parseFechaLocal(r.inicio)) { r.errores.push('Elige la fecha de inicio.'); return r; }
            if (!parseFechaLocal(r.fin))    { r.errores.push('La fecha fin no es válida.'); return r; }
            if (r.fin < r.inicio) { r.errores.push('La fecha fin (' + _ventasFmtFecha(r.fin) + ') es anterior a la de inicio (' + _ventasFmtFecha(r.inicio) + ').'); return r; }
            r.semanaId = semanaId(r.inicio);
            if (semanaId(r.fin) !== r.semanaId) {
                r.errores.push('El rango cruza de semana (' + etiquetaSemana(r.inicio) + ' y ' + etiquetaSemana(r.fin)
                             + '). Las ventas se cargan por semana, de lunes a domingo: importa cada semana con su propio reporte.');
            }
            if (r.fin > hoy) {
                r.errores.push('No se pueden cargar fechas futuras (' + _ventasFmtFecha(r.fin) + '). Si las cargas ahora, '
                             + 'esos días quedarían bloqueados y sus ventas reales ya no se podrían subir.');
            }
            r.dias = _ventasFechasDelRango(r.inicio, r.fin);
            var ocupadas = {};
            (periodosExistentes || []).forEach(function(p) {
                _ventasFechasDelRango(p.inicio, p.fin).forEach(function(f) { ocupadas[f] = true; });
            });
            r.conflictos = r.dias.filter(function(f) { return ocupadas[f]; });
            if (r.conflictos.length === 1) {
                r.errores.push('La fecha ' + _ventasFmtFecha(r.conflictos[0]) + ' ya se encuentra en el sistema. No se puede cargar.');
            } else if (r.conflictos.length > 1) {
                r.errores.push('Las fechas ' + r.conflictos.map(_ventasFmtFecha).join(', ') + ' ya se encuentran en el sistema. No se pueden cargar.');
            }
            if (!r.errores.length && r.fin === hoy) {
                r.avisos.push('Incluye hoy (' + _ventasFmtFecha(hoy) + '). Si el día no ha terminado, las ventas que falten de hoy ya no se podrán cargar después.');
            }
            r.ok = r.errores.length === 0;
            return r;
        }
        window.validarPeriodoVentas = validarPeriodoVentas;

        /** Suma por SKU las líneas de varios periodos (misma regla que el parser: se suma). */
        function _ventasAgregarLineas(listas) {
            var porSku = {}, orden = [];
            (listas || []).forEach(function(lineas) {
                (lineas || []).forEach(function(l) {
                    if (!l || !l.sku) return;
                    if (!porSku[l.sku]) { porSku[l.sku] = { sku: l.sku, nombre: l.nombre || '', tipo: l.tipo || '', cantidad: 0, ventaNeta: 0 }; orden.push(l.sku); }
                    porSku[l.sku].cantidad  += Number(l.cantidad)  || 0;
                    porSku[l.sku].ventaNeta += Number(l.ventaNeta) || 0;
                });
            });
            return orden.map(function(s) {
                var g = porSku[s];
                return { sku: g.sku, nombre: g.nombre, tipo: g.tipo,
                         cantidad: Math.round(g.cantidad * 1000) / 1000,
                         ventaNeta: Math.round(g.ventaNeta * 100) / 100 };
            });
        }
        window._ventasAgregarLineas = _ventasAgregarLineas;

        /** Días de la semana con ventas cargadas, a partir de los periodos. */
        function ventasCoberturaSemana(periodos) {
            var dias = {};
            (periodos || []).forEach(function(p) { _ventasFechasDelRango(p.inicio, p.fin).forEach(function(f) { dias[f] = true; }); });
            return Object.keys(dias).sort();
        }
        window.ventasCoberturaSemana = ventasCoberturaSemana;

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
        //  CAPA DE DATOS — un documento por PERIODO (FASE 10B)
        // ══════════════════════════════════════════════════════════════════════

        /**
         * leerPeriodosVentasSemana(semana, opts)
         * Todos los documentos de ventas de esa semana: los periodos nuevos y
         * el documento semanal anterior a 10B (también lleva semanaId).
         * opts.servidor = true obliga a preguntar al servidor y no a la caché:
         * es la lectura que decide si una fecha ya está cargada.
         * LANZA si no se puede leer — quien decide bloquear necesita saberlo.
         */
        async function leerPeriodosVentasSemana(semana, opts) {
            if (!_db) throw new Error('sin conexión a Firestore');
            var q = _docPrincipal().collection('ventas').where('semanaId', '==', semana);
            var snap = (opts && opts.servidor) ? await q.get({ source: 'server' }) : await q.get();
            var out = [];
            snap.forEach(function(doc) { out.push({ id: doc.id, data: doc.data() || {} }); });
            return out;
        }
        window.leerPeriodosVentasSemana = leerPeriodosVentasSemana;

        /**
         * guardarVentasPeriodo(periodo, lineas, archivo)
         * CREA ventas/{inicio}_{fin}. Solo crear: si el documento ya existe el
         * servidor lo rechaza (regla create-only). Una fecha cargada no se
         * vuelve a subir — decisión del propietario (30/09/2026).
         */
        async function guardarVentasPeriodo(periodo, lineas, archivo) {
            if (!_db) return { ok: false, motivo: 'sin conexión a Firestore' };
            if (!hasPermission('sales.import')) return { ok: false, motivo: 'sin permiso sales.import' };
            var id = _ventasPeriodoId(periodo.inicio, periodo.fin);
            try {
                const total = lineas.reduce(function(a, l) { return a + (l.cantidad || 0); }, 0);
                await _docPrincipal().collection('ventas').doc(id).set({
                    semanaId: periodo.semanaId,
                    fechaInicio: periodo.inicio,
                    fechaFin: periodo.fin,
                    lineas: lineas,
                    totalSkus: lineas.length,
                    totalUnidades: Math.round(total * 1000) / 1000,
                    origen: 'excel',
                    archivo: archivo ? String(archivo).slice(0, 200) : null,
                    importadoPor: currentUserUid || null,
                    importadoEn: Date.now()
                });
                return { ok: true, id: id };
            } catch (e) {
                console.error('[Ventas] Error guardando el periodo ' + id + ':', e);
                var denegado = !!e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
                return { ok: false, motivo: denegado
                    ? 'el servidor rechazó el guardado: esas fechas ya se encuentran en el sistema, o no tienes permiso'
                    : ((e && e.message) ? e.message : 'error desconocido') };
            }
        }
        window.guardarVentasPeriodo = guardarVentasPeriodo;

        /**
         * Deja en memoria la semana: `ventas` = suma por SKU de todos sus
         * periodos, `ventasPeriodos` = qué días cubren.
         */
        function _ventasAplicarSemana(semana, docs) {
            ventas = _ventasAgregarLineas((docs || []).map(function(x) { return (x.data || {}).lineas; }));
            ventasPeriodos = (docs || []).map(function(x) { return _ventasPeriodoDeDoc(x.id, x.data); })
                .sort(function(a, b) { return a.inicio < b.inicio ? -1 : (a.inicio > b.inicio ? 1 : 0); });
            ventasSemanaId = semana;
            saveToLocalStorage();
            // El memo del consumo se huellea con ventas.length: con varios
            // periodos la longitud puede no cambiar aunque las cantidades sí.
            if (typeof consumoTeoricoInvalidar === 'function') consumoTeoricoInvalidar();
        }
        window._ventasAplicarSemana = _ventasAplicarSemana;

        /**
         * cargarVentasSemana(semana)
         * Trae la semana a memoria sumando todos sus periodos. Devuelve true si
         * había al menos uno. No lanza: sin permiso o sin red deja lo que ya
         * hubiera en memoria y devuelve false.
         */
        async function cargarVentasSemana(semana) {
            if (!_db || !semana) return false;
            try {
                var docs = await leerPeriodosVentasSemana(semana);
                _ventasAplicarSemana(semana, docs);
                return docs.length > 0;
            } catch (e) {
                console.warn('[Ventas] No se pudo leer la semana ' + semana + ':', e);
                return false;
            }
        }
        window.cargarVentasSemana = cargarVentasSemana;

        // ══════════════════════════════════════════════════════════════════════
        //  VISTA PREVIA E INCIDENCIAS
        // ══════════════════════════════════════════════════════════════════════

        /** Resultado de validar el periodo de la vista previa con lo que se sabe del servidor. */
        function _ventasValidacionPendiente(parsed) {
            var ex = parsed.existentes || { estado: 'verificando', periodos: [] };
            var v = validarPeriodoVentas(parsed.periodo.inicio, parsed.periodo.fin,
                                         ex.estado === 'ok' ? ex.periodos : []);
            v.verificado = (ex.estado === 'ok' && ex.semanaId === v.semanaId);
            v.puedeConfirmar = v.ok && v.verificado && !parsed.excedeTope;
            return v;
        }

        function _ventasTextoRango(inicio, fin) {
            return inicio === fin ? _ventasFmtFecha(inicio)
                                  : _ventasFmtFecha(inicio) + ' al ' + _ventasFmtFecha(fin);
        }

        function _ventasBloquePeriodo(parsed) {
            var p = parsed.periodo;
            var ex = parsed.existentes || { estado: 'verificando', periodos: [] };
            var v = _ventasValidacionPendiente(parsed);
            var hoy = fechaISOLocal(new Date());

            var html = '<section class="vt-periodo" aria-labelledby="vtPeriodoTitulo">'
                     + '<div id="vtPeriodoTitulo" class="vt-periodo__titulo">¿De qué fechas son estas ventas?</div>'
                     + '<div class="vt-ayuda">El reporte de Parrot no trae la fecha. Elige el rango que cubre el archivo. '
                     + '<b>Para un solo día</b>, deja la misma fecha en inicio y fin.</div>'
                     + '<label class="vt-campo">Fecha inicio'
                     + '<input type="date" id="ventasFechaInicio" value="' + escapeHtml(p.inicio || '') + '" max="' + hoy + '" '
                     + 'onchange="_ventasCambiarPeriodo(\'inicio\', this.value)"></label>'
                     + '<label class="vt-campo">Fecha fin'
                     + '<input type="date" id="ventasFechaFin" value="' + escapeHtml(p.fin || '') + '" '
                     + (p.inicio ? 'min="' + escapeHtml(p.inicio) + '" ' : '') + 'max="' + hoy + '" '
                     + 'onchange="_ventasCambiarPeriodo(\'fin\', this.value)"></label>'
                     + '<button type="button" class="bt bt--secundario" onclick="_ventasUnSoloDia()"'
                     + (p.inicio && p.fin === p.inicio ? ' aria-pressed="true"' : '') + '>📍 Un solo día (fin = inicio)</button>';

            // ¿A qué semana pertenece esta fecha?
            if (v.semanaId) {
                html += '<div class="vt-semana" role="status">📅 Pertenece a la <b>' + escapeHtml(etiquetaSemana(v.inicio)) + '</b>'
                      + '<br>' + (v.dias.length === 1 ? '1 día: ' : v.dias.length + ' días: ') + escapeHtml(_ventasTextoRango(v.inicio, v.fin))
                      + '</div>';
            }

            if (ex.estado === 'verificando') {
                html += '<div class="vt-msg vt-msg--info" role="status">⏳ Comprobando en el servidor qué fechas ya están cargadas…</div>';
            } else if (ex.estado === 'error') {
                html += '<div class="vt-msg vt-msg--error" role="alert">🛑 ' + escapeHtml(ex.mensaje || 'No se pudo comprobar qué fechas ya están cargadas.') + '</div>';
            } else if (ex.periodos && ex.periodos.length) {
                html += '<div class="vt-msg vt-msg--info">Ya cargadas en esa semana: <b>'
                      + escapeHtml(ex.periodos.map(function(x) { return _ventasTextoRango(x.inicio, x.fin); }).join(' · ')) + '</b></div>';
            }

            v.errores.forEach(function(e) {
                html += '<div class="vt-msg vt-msg--error" role="alert">🛑 ' + escapeHtml(e) + '</div>';
            });
            v.avisos.forEach(function(a) {
                html += '<div class="vt-msg vt-msg--aviso">⚠️ ' + escapeHtml(a) + '</div>';
            });
            html += '</section>';
            return html;
        }

        function renderVistaPreviaVentas(parsed) {
            if (!parsed || !parsed.lineas || parsed.lineas.length === 0) {
                return '<div style="text-align:center;padding:32px 18px;background:var(--surface);'
                     + 'border:1px solid var(--border-mid);border-radius:12px">'
                     + '<div style="font-weight:600;margin-bottom:6px">No hay ninguna venta con SKU en este archivo</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.9rem">Revisa que sea el reporte de ventas de Parrot (hoja "Detalle").</div></div>'
                     + '<div class="bt-pila" style="margin-top:16px"><button type="button" class="bt bt--secundario" onclick="cancelarImportacionVentas()">Cerrar</button></div>';
            }

            var html = '<div style="margin-bottom:14px">'
                     + '<div style="font-weight:700;font-size:1.1rem;margin-bottom:4px">Vista previa de la importación de ventas</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.9rem;line-height:1.5">'
                     + (parsed.hoja ? 'Hoja <b>' + escapeHtml(parsed.hoja) + '</b>' + (parsed.archivo ? ' de ' + escapeHtml(parsed.archivo) : '') + '<br>' : '')
                     + '<b>' + parsed.lineas.length + '</b> SKU · <b>' + parsed.totalUnidades + '</b> unidades vendidas'
                     + (parsed.filasIgnoradas ? ' · ' + parsed.filasIgnoradas + ' fila(s) sin datos (descartadas)' : '')
                     + (parsed.incidencias.length ? ' · <b style="color:var(--amber)">' + parsed.incidencias.length + ' incidencia(s)</b>' : '')
                     + '</div></div>';

            // ── El periodo: lo más importante de esta pantalla ──────────────
            html += _ventasBloquePeriodo(parsed);

            if (parsed.excedeTope) {
                html += '<div class="vt-msg vt-msg--error" style="margin-bottom:14px">'
                      + '🛑 El archivo trae ' + parsed.lineas.length + ' SKU y el tope por periodo es ' + VENTAS_MAX_LINEAS
                      + '. No se puede guardar: revisa que el reporte sea de un solo periodo.</div>';
            }

            if (parsed.skusAgrupados && parsed.skusAgrupados.length) {
                html += '<div class="vt-msg vt-msg--info" style="margin-bottom:14px">'
                      + 'ℹ️ ' + parsed.skusAgrupados.length + ' SKU venían en varias filas (variantes promo, 2x1) y '
                      + '<b>se sumaron</b>, como hace el Excel: '
                      + escapeHtml(parsed.skusAgrupados.slice(0, 4).map(function(s) { return s.nombre + ' (' + s.filas + ')'; }).join(', '))
                      + (parsed.skusAgrupados.length > 4 ? '…' : '') + '</div>';
            }

            // Las 12 más vendidas, para que se reconozca de un vistazo si el
            // archivo es el correcto sin pintar 200 filas en un teléfono.
            var top = parsed.lineas.slice().sort(function(a, b) { return b.cantidad - a.cantidad; }).slice(0, 12);
            html += '<div style="background:var(--surface);border:1px solid var(--border-mid);border-radius:12px;padding:12px 14px;margin-bottom:10px">'
                  + '<div style="font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--txt-secondary);margin-bottom:8px">Más vendidos en el archivo</div>'
                  + '<table style="width:100%;border-collapse:collapse;font-size:.9rem">';
            top.forEach(function(l) {
                html += '<tr style="border-bottom:1px solid var(--border-mid)">'
                      + '<td style="padding:8px 4px">' + escapeHtml(l.nombre || l.sku) + '</td>'
                      + '<td style="padding:8px 4px;text-align:right;color:var(--txt-secondary);white-space:nowrap">' + l.cantidad + '</td>'
                      + '</tr>';
            });
            html += '</table></div>';

            var v = _ventasValidacionPendiente(parsed);
            html += '<div class="bt-pila" style="margin-top:18px">';
            if (parsed.incidencias.length) {
                html += '<button type="button" class="bt bt--secundario" onclick="_ventasVerIncidencias()">⚠️ Ver ' + parsed.incidencias.length + ' incidencia(s)</button>';
            }
            if (!parsed.excedeTope) {
                html += '<button type="button" id="ventasBtnConfirmar" class="bt bt--exito" onclick="confirmarImportacionVentas()"'
                      + (v.puedeConfirmar ? '' : ' disabled aria-disabled="true"') + '>✅ Confirmar e importar</button>';
                if (!v.puedeConfirmar) {
                    html += '<p class="bt-nota">' + (v.errores.length ? 'Corrige las fechas marcadas en rojo para poder importar.'
                          : 'Se habilita en cuanto termine la comprobación de fechas.') + '</p>';
                }
            }
            html += '<button type="button" class="bt bt--secundario" onclick="cancelarImportacionVentas()">Cancelar</button>'
                  + '</div>';
            return html;
        }

        function renderIncidenciasVentas(resultado) {
            if (!resultado) return '';
            var periodoTxt = (resultado.inicio && resultado.fin) ? _ventasTextoRango(resultado.inicio, resultado.fin) : '';
            var html = '<div style="margin-bottom:14px">'
                     + '<div style="font-weight:700;font-size:1.1rem;margin-bottom:4px">Resultado de la importación</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.9rem;line-height:1.5">'
                     + (resultado.guardado
                         ? resultado.totalSkus + ' SKU guardados · periodo <b>' + escapeHtml(periodoTxt) + '</b>'
                           + (resultado.semanaId ? ' (' + escapeHtml(etiquetaSemana(resultado.semanaId)) + ')' : '')
                         : '<b style="color:var(--red-text)">No se guardó: ' + escapeHtml(resultado.motivo || 'error desconocido') + '</b>')
                     + '</div></div>';

            if (resultado.incidencias && resultado.incidencias.length) {
                html += '<div style="font-weight:600;margin-bottom:8px">Incidencias (' + resultado.incidencias.length + ')</div>';
                resultado.incidencias.forEach(function(inc) {
                    html += '<div style="background:var(--surface);border:1px solid var(--border-mid);'
                          + 'border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:.88rem">'
                          + '<div style="color:var(--txt-secondary);font-size:.78rem;margin-bottom:2px">'
                          + escapeHtml(inc.sku || '(sin SKU)') + '</div>'
                          + escapeHtml(inc.detalle) + '</div>';
                });
            } else {
                html += '<div style="color:var(--txt-secondary);font-size:.9rem">Sin incidencias.</div>';
            }

            html += '<div class="bt-pila" style="margin-top:18px"><button type="button" class="bt bt--primario" onclick="cerrarResultadoImportacionVentas()">Aceptar</button></div>';
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
                    const nombreHoja = _ventasElegirHoja(workbook.SheetNames);
                    const sheet = nombreHoja ? workbook.Sheets[nombreHoja] : null;
                    if (!sheet) {
                        showNotification('❌ El archivo no tiene una hoja "Detalle". Usa el reporte de ventas de Parrot '
                                       + '(hojas encontradas: ' + workbook.SheetNames.join(', ') + ')');
                        return;
                    }
                    const filas = XLSX.utils.sheet_to_json(sheet);
                    if (!filas || filas.length === 0) { showNotification('La hoja "' + nombreHoja + '" no contiene datos'); return; }

                    const parsed = _parsearExcelVentas(filas);
                    parsed.hoja = nombreHoja;
                    parsed.archivo = file.name;
                    parsed.periodo = periodoVentasPorDefecto();
                    parsed.existentes = { semanaId: null, estado: 'verificando', periodos: [] };
                    _ventasImportPendiente = parsed;
                    ventasImportView = 'vista_previa';
                    renderTab();
                    // Qué fechas de esa semana ya están en el servidor: sin esta
                    // respuesta no se habilita "Confirmar".
                    _ventasRevisarPeriodos();
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

        /**
         * Pregunta al servidor qué periodos tiene ya la semana del periodo
         * elegido. Un fallo NO se trata como "no hay nada": se bloquea.
         */
        async function _ventasRevisarPeriodos() {
            var p = _ventasImportPendiente;
            if (!p || !p.periodo) return;
            var semana = semanaId(p.periodo.inicio);
            if (!semana) return;
            if (p.existentes && p.existentes.semanaId === semana && p.existentes.estado === 'ok') return;
            p.existentes = { semanaId: semana, estado: 'verificando', periodos: [] };
            try {
                var docs = await leerPeriodosVentasSemana(semana, { servidor: true });
                if (_ventasImportPendiente !== p || semanaId(p.periodo.inicio) !== semana) return;
                p.existentes = { semanaId: semana, estado: 'ok',
                                 periodos: docs.map(function(x) { return _ventasPeriodoDeDoc(x.id, x.data); }) };
            } catch (e) {
                if (_ventasImportPendiente !== p) return;
                p.existentes = { semanaId: semana, estado: 'error', periodos: [],
                                 mensaje: 'No se pudo comprobar en el servidor qué fechas ya están cargadas (sin conexión o sin permiso). '
                                        + 'Sin esa comprobación no se puede importar.' };
            }
            if (ventasImportView === 'vista_previa') renderTab();
        }
        window._ventasRevisarPeriodos = _ventasRevisarPeriodos;

        /** Cambia inicio o fin desde la vista previa. Fin vacío o anterior al inicio → un solo día. */
        function _ventasCambiarPeriodo(campo, valor) {
            var p = _ventasImportPendiente;
            if (!p || !p.periodo) return;
            if (campo === 'inicio') {
                p.periodo.inicio = valor || '';
                if (!p.periodo.fin || p.periodo.fin < p.periodo.inicio) p.periodo.fin = p.periodo.inicio;
            } else {
                p.periodo.fin = valor || p.periodo.inicio;
            }
            renderTab();
            _ventasRevisarPeriodos();
        }
        window._ventasCambiarPeriodo = _ventasCambiarPeriodo;

        function _ventasUnSoloDia() {
            var p = _ventasImportPendiente;
            if (!p || !p.periodo || !p.periodo.inicio) return;
            p.periodo.fin = p.periodo.inicio;
            renderTab();
        }
        window._ventasUnSoloDia = _ventasUnSoloDia;

        async function confirmarImportacionVentas() {
            const parsed = _ventasImportPendiente;
            if (!parsed || !parsed.lineas || parsed.lineas.length === 0) return;
            if (parsed.excedeTope) { showNotification('⚠️ El archivo excede el tope de ' + VENTAS_MAX_LINEAS + ' SKU'); return; }
            if (parsed._guardando) return;
            parsed._guardando = true;
            try {
                // 1. La forma del periodo (semana, futuro) sin red.
                var previa = validarPeriodoVentas(parsed.periodo.inicio, parsed.periodo.fin, []);
                if (!previa.ok) { showNotification('🛑 ' + previa.errores[0]); renderTab(); return; }

                // 2. Lectura FRESCA del servidor justo antes de escribir: lo que
                //    se vio en la vista previa pudo cambiar (otro dispositivo).
                var docs;
                try {
                    docs = await leerPeriodosVentasSemana(previa.semanaId, { servidor: true });
                } catch (e) {
                    parsed.existentes = { semanaId: previa.semanaId, estado: 'error', periodos: [],
                        mensaje: 'No se pudo comprobar en el servidor qué fechas ya están cargadas. No se guardó nada.' };
                    showNotification('❌ Sin comprobación del servidor no se importa. No se guardó nada.');
                    renderTab();
                    return;
                }
                var existentes = docs.map(function(x) { return _ventasPeriodoDeDoc(x.id, x.data); });
                parsed.existentes = { semanaId: previa.semanaId, estado: 'ok', periodos: existentes };
                var v = validarPeriodoVentas(parsed.periodo.inicio, parsed.periodo.fin, existentes);
                if (!v.ok) { showNotification('🛑 ' + v.errores[0]); renderTab(); return; }

                _crearBackupNombrado('pre_importacion_ventas_' + Date.now());
                showNotification('⏳ Guardando ' + parsed.lineas.length + ' SKU del ' + _ventasTextoRango(v.inicio, v.fin) + '…');

                const res = await guardarVentasPeriodo({ inicio: v.inicio, fin: v.fin, semanaId: v.semanaId }, parsed.lineas, parsed.archivo);
                if (res.ok) {
                    // La semana en memoria es la SUMA de todos sus periodos:
                    // se relee; si no se puede, se suma lo recién guardado a lo
                    // que ya se sabía del servidor.
                    var tras = null;
                    try { tras = await leerPeriodosVentasSemana(v.semanaId); } catch (_) { tras = null; }
                    _ventasAplicarSemana(v.semanaId, tras || docs.concat([{ id: res.id, data: {
                        semanaId: v.semanaId, fechaInicio: v.inicio, fechaFin: v.fin,
                        lineas: parsed.lineas, totalSkus: parsed.lineas.length } }]));
                }

                _ventasImportPendiente = null;
                _ventasImportResultado = {
                    guardado: res.ok, motivo: res.motivo || null,
                    semanaId: v.semanaId, inicio: v.inicio, fin: v.fin,
                    totalSkus: parsed.lineas.length,
                    incidencias: parsed.incidencias
                };
                ventasImportView = 'incidencias';
                showNotification(res.ok
                    ? '✅ Ventas del ' + _ventasTextoRango(v.inicio, v.fin) + ' guardadas'
                    : '❌ No se pudieron guardar las ventas: ' + (res.motivo || 'error'));
                renderTab();
            } finally {
                parsed._guardando = false;
            }
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
                semanaId: semanaId(_ventasImportPendiente.periodo.inicio),
                inicio: _ventasImportPendiente.periodo.inicio, fin: _ventasImportPendiente.periodo.fin,
                totalSkus: _ventasImportPendiente.lineas.length,
                incidencias: _ventasImportPendiente.incidencias,
                desdeVistaPrevia: true
            };
            ventasImportView = 'incidencias';
            renderTab();
        }
        window._ventasVerIncidencias = _ventasVerIncidencias;

        // ══════════════════════════════════════════════════════════════════════
        //  RENDER DE LA PESTAÑA
        // ══════════════════════════════════════════════════════════════════════

        /** Tira de los 7 días de la semana: cuáles tienen ventas cargadas. */
        function _ventasTiraSemana(semana, cubiertos) {
            var l = parseFechaLocal(semana);
            if (!l) return '';
            var letras = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
            var set = {};
            (cubiertos || []).forEach(function(f) { set[f] = true; });
            var html = '<div class="vt-dias" role="list" aria-label="Días con ventas cargadas">';
            for (var i = 0; i < 7; i++) {
                var f = fechaISOLocal(new Date(l.getFullYear(), l.getMonth(), l.getDate() + i));
                var ok = !!set[f];
                html += '<div role="listitem" class="vt-dia' + (ok ? ' vt-dia--ok' : '') + '" title="' + _ventasFmtFecha(f)
                      + (ok ? ' · cargado' : ' · sin ventas') + '">' + letras[i] + '<br>' + parseFechaLocal(f).getDate() + '</div>';
            }
            return html + '</div>';
        }

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
                      + (ventasSemanaId ? ' para la ' + escapeHtml(etiquetaSemana(ventasSemanaId)) : '') + '. '
                      + (puedeImportar ? 'Impórtalas desde el reporte del POS con el botón de arriba.'
                                       : 'El administrador todavía no las importa.')
                      + '</p></div></div>';
                return html;
            }

            var unidades = Math.round(ventas.reduce(function(a, l) { return a + (l.cantidad || 0); }, 0) * 1000) / 1000;
            var cubiertos = ventasCoberturaSemana(ventasPeriodos || []);
            html += '<div style="background:var(--surface);border:1px solid var(--border-mid);border-radius:14px;padding:16px;margin-bottom:12px;display:flex;flex-direction:column;gap:10px">'
                  + '<div style="font-weight:700;font-size:1.02rem">Ventas de la ' + escapeHtml(ventasSemanaId ? etiquetaSemana(ventasSemanaId) : '—') + '</div>'
                  + '<div style="color:var(--txt-secondary);font-size:.9rem">'
                  + '<b>' + ventas.length + '</b> SKU · <b>' + unidades + '</b> unidades vendidas</div>';
            if (ventasPeriodos && ventasPeriodos.length && ventasSemanaId) {
                html += '<div style="font-size:.9rem;font-weight:600">Días cargados: ' + cubiertos.length + ' de 7</div>'
                      + _ventasTiraSemana(ventasSemanaId, cubiertos)
                      + '<div style="color:var(--txt-secondary);font-size:.84rem;line-height:1.5">Periodos: '
                      + escapeHtml(ventasPeriodos.map(function(x) { return _ventasTextoRango(x.inicio, x.fin); }).join(' · ')) + '</div>';
                if (cubiertos.length < 7) {
                    html += '<div class="vt-msg vt-msg--aviso">⚠️ Faltan ' + (7 - cubiertos.length) + ' día(s) de esta semana: '
                          + 'el consumo teórico de abajo es parcial.</div>';
                }
            }
            html += '</div>';

            // ── FASE 11A — consumo teórico calculado con el recetario ────────
            html += _renderConsumoTeorico();

            var ordenadas = ventas.slice().sort(function(a, b) { return (b.cantidad || 0) - (a.cantidad || 0); });
            html += '<table style="width:100%;border-collapse:collapse;font-size:.9rem">';
            ordenadas.forEach(function(l) {
                html += '<tr style="border-bottom:1px solid var(--border-mid)">'
                      + '<td style="padding:10px 4px;color:var(--txt-primary)">' + escapeHtml(l.nombre || l.sku)
                      + '<div style="color:var(--txt-secondary);font-size:.76rem">' + escapeHtml(l.sku) + '</div></td>'
                      + '<td style="padding:10px 4px;text-align:right;color:var(--txt-secondary);white-space:nowrap">' + (l.cantidad || 0) + '</td>'
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
                  + (EXISTENCIA_FUENTE_OFICIAL_ACTIVA
                     ? 'La fuente oficial ya está encendida: en cuanto haya un inicial contabilizado para esta semana, '
                       + 'esta cifra pasa a decidir "bajo mínimo" y la existencia en catálogo. Compárala contra tu Excel '
                       + 'antes de cerrar y contabilizar el inventario — después de eso ya no es solo informativa.'
                     : 'La app todavía NO decide con esta cifra: la fuente oficial sigue apagada hasta que la compares con tu Excel.')
                  + '</div>';
            html += '</div>';
            return html;
        }
