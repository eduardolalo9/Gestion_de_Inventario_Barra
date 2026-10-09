        // ══════════════════════════════════════════════════════════════════════
        //  FASE 14 — VENTA DEL TURNO: SIMULAR Y PROCESAR (5-oct-2026)
        //  ────────────────────────────────────────────────────────────────────
        //  Lo que pidió Eduardo, textual: "Descarga la venta del turno, la
        //  revienta contra las recetas y señala los insumos que el stock de
        //  sistema no alcanza a cubrir, con lo que cuesta esa desviación.
        //  Simular no toca nada; procesar sí baja el inventario."
        //
        //  · SIMULAR — con el archivo todavía en vista previa: cruza cada SKU
        //    vendido con su receta (el mismo motor de js/48), compara lo que
        //    debió salir de cada insumo contra su Total de sistema (js/47) y
        //    marca lo que no alcanza, con su costo. NO escribe nada.
        //  · PROCESAR — guarda el periodo de ventas (ventas/{inicio}_{fin}, la
        //    misma escritura de FASE 10B, create-only en el servidor). Al
        //    quedar guardado, el Total oficial lo resta solo, porque el Total
        //    se CALCULA: saldo del último corte + compras − consumo teórico.
        //
        //  LO QUE "BAJAR EL INVENTARIO" NO HACE, A PROPÓSITO: no escribe en
        //  stockByArea (el conteo por área) ni en el conteo físico. Mezclar lo
        //  calculado con lo contado ya corrompió datos una vez
        //  (js/40-firestore.js documenta el caso de auditoriaConteo). La venta
        //  baja el Total de sistema; el conteo sigue siendo lo que la gente
        //  cuenta, y la diferencia entre los dos es Físico vs Sistema.
        //
        //  CUÁNDO PROCESAR NO MUEVE EL TOTAL — y la pantalla lo dice antes:
        //    · ventas de fechas ANTERIORES (o iguales) al último corte: ya están
        //      reflejadas en ese conteo físico;
        //    · un periodo que CRUZA la fecha del corte: no se puede repartir
        //      por día, así que no se deja procesar (se pide dividirlo);
        //    · sin ningún corte contabilizado: el Total es el respaldo
        //      operativo (suma de áreas), que no resta ventas.
        //    · un insumo que no entró al último corte usa el respaldo operativo
        //      y tampoco baja (se marca en su fila).
        //
        //  "TURNO" = el periodo que cubre el reporte: un día (inicio = fin) o
        //  un rango dentro de la misma semana. Una fecha ya cargada no se
        //  vuelve a subir (regla de FASE 10B).
        // ══════════════════════════════════════════════════════════════════════

        function _vtRed(n, dec) {
            var f = Math.pow(10, dec === undefined ? 3 : dec);
            var x = Number(n);
            return isFinite(x) ? Math.round(x * f) / f : 0;
        }

        /**
         * ventaTurnoEfecto(periodo, anclaFecha)
         * Qué le hará al Total procesar este periodo, sin mirar productos.
         *   'baja_total'        — todo el periodo es posterior al corte.
         *   'anterior_al_corte' — termina el día del corte o antes.
         *   'cruza_corte'       — empieza antes y termina después: NO se procesa.
         *   'sin_ancla'         — no hay corte vigente: el Total es el respaldo.
         */
        function ventaTurnoEfecto(periodo, anclaFecha) {
            if (!periodo || !periodo.inicio || !periodo.fin) return 'sin_ancla';
            if (!anclaFecha) return 'sin_ancla';
            if (periodo.inicio > anclaFecha) return 'baja_total';
            if (periodo.fin <= anclaFecha) return 'anterior_al_corte';
            return 'cruza_corte';
        }

        /**
         * ventaTurnoAnalizar(lineas, opciones) — capa pura (no pinta, no escribe).
         *
         * opciones: {
         *   periodo:     { inicio, fin },
         *   anclaFecha:  'YYYY-MM-DD' | null,
         *   productos:   [ {id, name, unit, precio} ],
         *   existencia:  function(producto) → { valor, origen }   (Total de sistema)
         *   consumir:    function(lineas) → { consumo, avisos }    (motor de js/48)
         * }
         *
         * Devuelve el consumo por insumo, qué insumos NO alcanza a cubrir el
         * Total, y el costo de esa desviación (faltante × precio). Un insumo
         * sin precio se cuenta aparte: nunca se le inventa un valor.
         */
        function ventaTurnoAnalizar(lineas, opciones) {
            opciones = opciones || {};
            var consumir = opciones.consumir || (typeof consumoTeoricoDeLineas === 'function' ? consumoTeoricoDeLineas : null);
            var cruce = consumir ? consumir(lineas || []) : { consumo: {}, avisos: { sinReceta: [], sinCatalogo: [], uomDistinta: [] } };
            var consumo = cruce.consumo || {};
            var avisos = cruce.avisos || { sinReceta: [], sinCatalogo: [], uomDistinta: [] };
            var porId = {};
            (opciones.productos || []).forEach(function(p) { if (p && p.id) porId[String(p.id)] = p; });

            var efecto = ventaTurnoEfecto(opciones.periodo, opciones.anclaFecha);
            // Ventas anteriores al corte ya están dentro de ese conteo físico:
            // compararlas contra el Total de hoy inventaría faltantes. Se
            // muestran los consumos, sin juzgar cobertura.
            var aplica = (efecto !== 'anterior_al_corte');
            var insumos = [];
            Object.keys(consumo).forEach(function(pid) {
                var c = consumo[pid];
                if (!c) return;
                var p = porId[pid];
                if (!p) return;   // ya reportado en avisos.sinCatalogo: no hay Total del cual restar
                var ex = opciones.existencia ? opciones.existencia(p) : { valor: 0, origen: 'operativo_no_reconciliado' };
                var disponible = _vtRed(ex && typeof ex.valor === 'number' ? ex.valor : 0);
                var despues = aplica ? _vtRed(disponible - c) : disponible;
                var alcanza = !aplica || despues >= -0.0005;
                var faltante = alcanza ? 0 : _vtRed(c - Math.max(disponible, 0));
                var precio = (typeof p.precio === 'number' && isFinite(p.precio)) ? p.precio : null;
                insumos.push({
                    productoId: pid, nombre: p.name || pid, unidad: p.unit || '',
                    consumo: _vtRed(c), disponible: disponible, despues: despues,
                    origen: (ex && ex.origen) || 'operativo_no_reconciliado',
                    alcanza: alcanza, faltante: faltante, precio: precio,
                    costoFaltante: (!alcanza && precio !== null) ? _vtRed(faltante * precio, 2) : null
                });
            });
            insumos.sort(function(a, b) { return b.consumo - a.consumo; });

            var noAlcanzan = insumos.filter(function(x) { return !x.alcanza; });
            noAlcanzan.sort(function(a, b) {
                return (b.costoFaltante === null ? -1 : b.costoFaltante) - (a.costoFaltante === null ? -1 : a.costoFaltante);
            });
            var costo = 0, sinPrecio = 0;
            noAlcanzan.forEach(function(x) { if (x.costoFaltante === null) sinPrecio++; else costo += x.costoFaltante; });
            var unidades = (lineas || []).reduce(function(a, l) { return a + (Number(l && l.cantidad) || 0); }, 0);

            return {
                periodo:          opciones.periodo || null,
                anclaFecha:       opciones.anclaFecha || null,
                efecto:           efecto,
                skus:             (lineas || []).length,
                unidades:         _vtRed(unidades),
                insumos:          insumos,
                noAlcanzan:       noAlcanzan,
                totalInsumos:     insumos.length,
                totalNoAlcanzan:  noAlcanzan.length,
                costoDesviacion:  _vtRed(costo, 2),
                noAlcanzanSinPrecio: sinPrecio,
                enRespaldo:       insumos.filter(function(x) { return x.origen !== 'oficial'; }).length,
                avisos:           avisos,
                // v5.19 — cortesías y copas de regalo 2x1, con su costo (control)
                cortesias:        ventaCortesiasAnalizar(lineas, { productos: opciones.productos, consumir: consumir }),
                calculadoEn:      Date.now()
            };
        }

        /**
         * v5.19 — ventaCortesiasAnalizar(lineas, opciones) — capa pura.
         * Cortesías y copas de regalo de promos 2x1: cuántas unidades, qué
         * insumos consumieron y cuánto cuestan a precio de insumo. Es CONTROL:
         * no cambia el consumo (que ya las incluye, D-5) ni se costea contra la
         * venta. Un insumo sin precio se cuenta aparte, sin inventar valor.
         *
         * opciones: { productos, consumir: function(lineas) → { consumo } }
         */
        function ventaCortesiasAnalizar(lineas, opciones) {
            opciones = opciones || {};
            var partes = (typeof ventaPartesLinea === 'function') ? ventaPartesLinea
                       : function(l) { return { cortesia: Number(l && l.cortesia) || 0, promo: Number(l && l.promo) || 0 }; };
            var consumir = opciones.consumir || (typeof consumoTeoricoDeLineas === 'function' ? consumoTeoricoDeLineas : null);
            var porId = {};
            (opciones.productos || []).forEach(function(p) { if (p && p.id) porId[String(p.id)] = p; });

            function grupo(campo) {
                var items = [], sub = [];
                (lineas || []).forEach(function(l) {
                    if (!l || !l.sku) return;
                    var n = partes(l)[campo];
                    if (!(n > 0)) return;
                    items.push({ sku: l.sku, nombre: l.nombre || l.sku, unidades: _vtRed(n), totalSku: _vtRed(Number(l.cantidad) || 0) });
                    sub.push({ sku: l.sku, nombre: l.nombre, cantidad: n });
                });
                items.sort(function(a, b) { return b.unidades - a.unidades; });
                var consumo = (consumir && sub.length) ? (consumir(sub).consumo || {}) : {};
                var insumos = [], costo = 0, sinPrecio = 0;
                Object.keys(consumo).forEach(function(pid) {
                    var p = porId[pid];
                    var c = _vtRed(consumo[pid]);
                    if (!c) return;
                    var precio = (p && typeof p.precio === 'number' && isFinite(p.precio)) ? p.precio : null;
                    var imp = precio !== null ? _vtRed(c * precio, 2) : null;
                    if (imp === null) sinPrecio++; else costo += imp;
                    insumos.push({ productoId: pid, nombre: p ? (p.name || pid) : pid, unidad: p ? (p.unit || '') : '',
                                   consumo: c, precio: precio, costo: imp, enCatalogo: !!p });
                });
                insumos.sort(function(a, b) { return (b.costo === null ? -1 : b.costo) - (a.costo === null ? -1 : a.costo); });
                return { items: items, unidades: _vtRed(items.reduce(function(a, x) { return a + x.unidades; }, 0)),
                         insumos: insumos, costo: _vtRed(costo, 2), sinPrecio: sinPrecio };
            }
            var cortesias = grupo('cortesia'), promos = grupo('promo');
            return { cortesias: cortesias, promos: promos,
                     hay: cortesias.items.length > 0 || promos.items.length > 0,
                     costoTotal: _vtRed(cortesias.costo + promos.costo, 2) };
        }

        /** Panel "Cortesías y promociones 2x1" (simulación y pestaña Ventas). */
        function renderCortesiasVenta(cz, opciones) {
            opciones = opciones || {};
            if (!cz || !cz.hay) return '';
            var h = '<section class="vt-panel vt-cz" aria-labelledby="vtCzTit">'
                  + '<div id="vtCzTit" class="vt-panel__tit">Cortesías y promociones 2x1</div>'
                  + '<div class="vt-ayuda vt-ayuda--chica">Salieron de la barra a $0. <b>Sí descuentan inventario</b> (ya están en el consumo de arriba) '
                  + 'y <b>no se costean contra la venta</b>: el costo es a precio de insumo, para control.</div>'
                  + '<div class="vt-sim__kpis">'
                  + '<div class="vt-sim__kpi"><span>Cortesías</span><b class="num">' + cz.cortesias.unidades + '</b></div>'
                  + '<div class="vt-sim__kpi"><span>Copas de regalo 2x1</span><b class="num">' + cz.promos.unidades + '</b></div>'
                  + '<div class="vt-sim__kpi"><span>Costo a precio de insumo</span><b class="num">' + _vtMoneda(cz.costoTotal) + '</b></div></div>';
            [['cortesias', 'Cortesías'], ['promos', 'Promos 2x1 (copa de regalo)']].forEach(function(par) {
                var g = cz[par[0]];
                if (!g.items.length) return;
                h += '<div class="vt-subtit">' + par[1] + ' · ' + _vtMoneda(g.costo) + '</div>'
                   + '<table class="vt-tabla vt-tabla--densa"><tbody>';
                g.items.slice(0, 12).forEach(function(x) {
                    h += '<tr><td>' + escapeHtml(x.nombre) + '<div class="vt-sku">' + escapeHtml(x.sku)
                       + (par[0] === 'promos' ? ' · ' + x.totalSku + ' en total con las cobradas' : '') + '</div></td>'
                       + '<td class="vt-num">' + x.unidades + '</td></tr>';
                });
                h += '</tbody></table>';
                if (g.insumos.length) {
                    h += '<details class="vt-sim__det"><summary>Insumos que consumieron (' + g.insumos.length + ')</summary>'
                       + '<table class="vt-tabla vt-tabla--densa"><tbody>';
                    g.insumos.slice(0, 40).forEach(function(i) {
                        h += '<tr><td>' + escapeHtml(i.nombre) + (i.enCatalogo ? '' : ' <span class="vt-txt-chico vt-txt-error">(no está en el catálogo)</span>')
                           + '<div class="vt-sku"><span class="num">' + i.consumo + '</span> ' + escapeHtml(i.unidad) + '</div></td>'
                           + '<td class="vt-num">' + (i.costo === null ? 'sin precio' : _vtMoneda(i.costo)) + '</td></tr>';
                    });
                    h += '</tbody></table></details>';
                }
                if (g.sinPrecio) h += '<div class="vt-ayuda vt-ayuda--chica">' + g.sinPrecio + ' insumo(s) sin precio no entran al costo.</div>';
            });
            if (opciones.notaHistorica) h += '<div class="vt-ayuda vt-ayuda--chica">' + opciones.notaHistorica + '</div>';
            return h + '</section>';
        }
        window.ventaCortesiasAnalizar = ventaCortesiasAnalizar;
        window.renderCortesiasVenta = renderCortesiasVenta;

        // ══════════════════════════════════════════════════════════════════════
        //  CONEXIÓN CON LA APP
        // ══════════════════════════════════════════════════════════════════════

        /** Fecha del corte vigente (ancla del Total), o null si no hay. */
        function ventaTurnoAnclaFecha() {
            var est = (typeof existenciaInicialEstado === 'function') ? existenciaInicialEstado() : null;
            return (est && est.estado === 'ok' && est.ancla && est.ancla.fecha) ? est.ancla.fecha : null;
        }

        /** Analiza el archivo en vista previa contra el Total actual. */
        function _ventaTurnoCalcular(parsed) {
            return ventaTurnoAnalizar(parsed.lineas, {
                periodo:    { inicio: parsed.periodo.inicio, fin: parsed.periodo.fin || parsed.periodo.inicio },
                anclaFecha: ventaTurnoAnclaFecha(),
                productos:  (typeof products !== 'undefined' && Array.isArray(products)) ? products : [],
                existencia: function(p) {
                    if (typeof existenciaOficial === 'function' && typeof EXISTENCIA_FUENTE_OFICIAL_ACTIVA !== 'undefined'
                        && EXISTENCIA_FUENTE_OFICIAL_ACTIVA) {
                        return existenciaOficial(p);
                    }
                    return { valor: (typeof getTotalStock === 'function') ? getTotalStock(p) : 0, origen: 'operativo_no_reconciliado' };
                }
            });
        }

        /** SIMULAR — no escribe nada: solo calcula y pinta. */
        function ventaTurnoSimular() {
            var parsed = (typeof _ventasImportPendiente !== 'undefined') ? _ventasImportPendiente : null;
            if (!parsed || !parsed.lineas || !parsed.lineas.length) return;
            if (!recetas || !recetas.length) {
                showNotification('⚠️ No hay recetario cargado: sin recetas no hay nada que reventar');
            }
            parsed.simulacion = _ventaTurnoCalcular(parsed);
            renderTab();
            setTimeout(function() {
                var el = document.getElementById('vtSimulacion');
                if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 60);
        }
        window.ventaTurnoSimular = ventaTurnoSimular;

        function _vtMoneda(n) {
            try { return Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }); }
            catch (_) { return '$' + _vtRed(n, 2).toFixed(2); }
        }

        function _vtTextoEfecto(sim) {
            var corte = sim.anclaFecha ? _ventasFmtFecha(sim.anclaFecha) : '';
            if (sim.efecto === 'baja_total') {
                return { tono: 'info', icono: 'fa-circle-info',
                         txt: 'Al procesar, estas ventas <b>bajan el Total</b> (son posteriores al último corte, del ' + escapeHtml(corte) + ').' };
            }
            if (sim.efecto === 'anterior_al_corte') {
                return { tono: 'aviso', icono: 'fa-triangle-exclamation',
                         txt: 'Estas ventas son del ' + escapeHtml(corte) + ' o antes: <b>ya están reflejadas</b> en el último conteo contabilizado. '
                            + 'Procesarlas guarda el registro pero <b>no baja el Total</b>.' };
            }
            if (sim.efecto === 'cruza_corte') {
                return { tono: 'error', icono: 'fa-circle-exclamation',
                         txt: 'El periodo cruza la fecha del último corte (' + escapeHtml(corte) + ') y el reporte no se puede repartir por día. '
                            + '<b>No se puede procesar así</b>: importa un reporte hasta el ' + escapeHtml(corte) + ' y otro desde el día siguiente.' };
            }
            return { tono: 'aviso', icono: 'fa-triangle-exclamation',
                     txt: 'No hay ningún corte contabilizado: el Total es el respaldo operativo (suma de áreas), que <b>no resta ventas</b>. '
                        + 'Procesar guarda la venta; empezará a bajar el Total en cuanto contabilices un recuento.' };
        }

        /** Panel de la simulación, dentro de la vista previa de la importación. */
        function renderSimulacionVentaTurno(parsed) {
            if (!parsed || !parsed.lineas || !parsed.lineas.length) return '';
            var sim = parsed.simulacion;
            var h = '<section class="vt-panel vt-sim" id="vtSimulacion" aria-labelledby="vtSimTit">'
                  + '<div id="vtSimTit" class="vt-panel__tit">Reventar contra recetas</div>';
            if (!sim) {
                h += '<div class="vt-ayuda vt-ayuda--chica">Calcula cuánto debió salir de cada insumo con estas ventas y marca '
                   + 'los que el Total de sistema no alcanza a cubrir, con lo que cuesta esa desviación. <b>Simular no guarda nada.</b></div>'
                   + '<button type="button" class="bt bt--secundario" id="vtBtnSimular" onclick="ventaTurnoSimular()">'
                   + '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Simular</button></section>';
                return h;
            }
            var ef = _vtTextoEfecto(sim);
            h += '<div class="vt-nota vt-nota--' + ef.tono + '"><i class="fa-solid ' + ef.icono + '" aria-hidden="true"></i> ' + ef.txt + '</div>';

            h += '<div class="vt-sim__kpis">'
               + '<div class="vt-sim__kpi"><span>Insumos afectados</span><b class="num">' + sim.totalInsumos + '</b></div>'
               + '<div class="vt-sim__kpi' + (sim.totalNoAlcanzan ? ' vt-sim__kpi--mal' : '') + '"><span>No alcanzan</span><b class="num">' + sim.totalNoAlcanzan + '</b></div>'
               + '<div class="vt-sim__kpi' + (sim.costoDesviacion ? ' vt-sim__kpi--mal' : '') + '"><span>Costo de la desviación</span><b class="num">' + _vtMoneda(sim.costoDesviacion) + '</b></div>'
               + '</div>';
            if (sim.noAlcanzanSinPrecio) {
                h += '<div class="vt-ayuda vt-ayuda--chica">' + sim.noAlcanzanSinPrecio + ' insumo(s) que no alcanzan no tienen precio en el catálogo: '
                   + 'no entran al costo (no se inventa un valor).</div>';
            }

            if (sim.noAlcanzan.length) {
                // Tres columnas: en un teléfono de 390 px cinco no caben y la del
                // costo —la que importa— quedaba fuera de la pantalla. Consumo y
                // Total viajan como detalle bajo el nombre.
                h += '<div class="vt-subtit">Insumos que el Total no cubre</div>'
                   + '<table class="vt-tabla vt-tabla--densa vt-sim__tabla">'
                   + '<thead><tr><th scope="col">Insumo</th>'
                   + '<th scope="col" class="vt-num">Faltante</th><th scope="col" class="vt-num">Costo</th></tr></thead><tbody>';
                sim.noAlcanzan.forEach(function(x) {
                    h += '<tr><td>' + escapeHtml(x.nombre)
                       + (x.origen !== 'oficial' ? ' <span class="vt-txt-chico vt-txt-aviso">(respaldo)</span>' : '')
                       + '<div class="vt-sku">Consumo <span class="num">' + x.consumo + '</span> · Total <span class="num">' + x.disponible + '</span> '
                       + escapeHtml(x.unidad) + '</div></td>'
                       + '<td class="vt-num vt-txt-error">−' + x.faltante + '</td>'
                       + '<td class="vt-num">' + (x.costoFaltante === null ? 'sin precio' : _vtMoneda(x.costoFaltante)) + '</td></tr>';
                });
                h += '</tbody></table>';
                h += '<div class="vt-ayuda vt-ayuda--chica">Un faltante significa que, según el sistema, salió más de lo que había: '
                   + 'suele ser una compra sin registrar, un conteo bajo o una receta que pide de más. Revísalo en Físico vs Sistema.</div>';
            } else if (sim.totalInsumos) {
                h += '<div class="vt-nota vt-nota--info"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> El Total de sistema cubre todos los insumos de esta venta.</div>';
            }

            if (sim.insumos.length) {
                h += '<details class="vt-sim__det"><summary>Ver los ' + sim.insumos.length + ' insumos (Total antes → después)</summary>'
                   + '<table class="vt-tabla vt-tabla--densa"><tbody>';
                sim.insumos.slice(0, 60).forEach(function(x) {
                    h += '<tr><td>' + escapeHtml(x.nombre) + '</td>'
                       + '<td class="vt-num">−' + x.consumo + '</td>'
                       + '<td class="vt-num">' + x.disponible + ' → <span class="' + (x.alcanza ? '' : 'vt-txt-error') + '">' + x.despues + '</span></td></tr>';
                });
                h += '</tbody></table>' + (sim.insumos.length > 60 ? '<div class="vt-ayuda vt-ayuda--chica">Se muestran los 60 de mayor consumo.</div>' : '')
                   + '</details>';
            }

            var a = sim.avisos || {};
            if (a.sinReceta && a.sinReceta.length) {
                h += '<div class="vt-nota vt-nota--aviso"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> <b>'
                   + a.sinReceta.length + ' producto(s) sin receta</b> — su consumo no se descuenta de ningún insumo: '
                   + escapeHtml(a.sinReceta.slice(0, 4).map(function(x) { return x.nombre; }).join(', ')) + (a.sinReceta.length > 4 ? '…' : '') + '</div>';
            }
            if (a.sinCatalogo && a.sinCatalogo.length) {
                h += '<div class="vt-nota vt-nota--error"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> <b>'
                   + a.sinCatalogo.length + ' insumo(s) de receta no están en el catálogo</b> — no hay Total del cual restarlos: '
                   + escapeHtml(a.sinCatalogo.slice(0, 4).map(function(x) { return x.descripcion; }).join(', ')) + (a.sinCatalogo.length > 4 ? '…' : '') + '</div>';
            }
            if (sim.enRespaldo && sim.efecto === 'baja_total') {
                h += '<div class="vt-ayuda vt-ayuda--chica">' + sim.enRespaldo + ' insumo(s) marcados "(respaldo)" no entraron al último corte: '
                   + 'su Total es la suma de áreas y no baja al procesar.</div>';
            }
            h += renderCortesiasVenta(sim.cortesias);
            h += '<button type="button" class="bt bt--secundario" onclick="ventaTurnoSimular()"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Volver a simular</button>';
            h += '</section>';
            return h;
        }
        window.renderSimulacionVentaTurno = renderSimulacionVentaTurno;

        /**
         * PROCESAR — confirma con el resumen de la simulación y guarda el
         * periodo (confirmarImportacionVentas, sin cambios en su regla). Lo
         * que se muestra en la confirmación es exactamente lo que se procesa.
         */
        function ventaTurnoProcesar() {
            var parsed = (typeof _ventasImportPendiente !== 'undefined') ? _ventasImportPendiente : null;
            if (!parsed || !parsed.lineas || !parsed.lineas.length) return;
            if (!hasPermission('sales.import')) { showNotification('⚠️ No tienes permiso para procesar ventas'); return; }
            var v = (typeof _ventasValidacionPendiente === 'function') ? _ventasValidacionPendiente(parsed) : { puedeConfirmar: true, errores: [] };
            if (!v.puedeConfirmar) {
                showNotification('🛑 ' + (v.errores && v.errores[0] ? v.errores[0] : 'Todavía no se puede procesar: espera la comprobación de fechas.'));
                return;
            }
            var sim = _ventaTurnoCalcular(parsed);
            parsed.simulacion = sim;
            if (sim.efecto === 'cruza_corte') {
                showNotification('🛑 El periodo cruza la fecha del último corte: divídelo en dos importaciones.');
                renderTab();
                return;
            }
            var rango = (typeof _ventasTextoRango === 'function') ? _ventasTextoRango(sim.periodo.inicio, sim.periodo.fin) : '';
            var msg = '🧾 PROCESAR VENTA DEL ' + rango + '\n\n'
                    + sim.skus + ' SKU · ' + sim.unidades + ' unidades vendidas\n'
                    + sim.totalInsumos + ' insumo(s) se descuentan del Total\n';
            if (sim.totalNoAlcanzan) {
                msg += '⚠️ ' + sim.totalNoAlcanzan + ' insumo(s) no alcanzan · desviación ' + _vtMoneda(sim.costoDesviacion)
                     + (sim.noAlcanzanSinPrecio ? ' (+' + sim.noAlcanzanSinPrecio + ' sin precio)' : '') + '\n';
            }
            if (sim.cortesias && sim.cortesias.hay) {
                msg += '🎁 ' + sim.cortesias.cortesias.unidades + ' cortesía(s) y ' + sim.cortesias.promos.unidades + ' copa(s) de regalo 2x1 · '
                     + _vtMoneda(sim.cortesias.costoTotal) + ' a precio de insumo (descuentan inventario, no se costean contra la venta)\n';
            }
            if (sim.efecto === 'anterior_al_corte') msg += 'ℹ️ Son ventas anteriores al último corte: se guardan, pero NO bajan el Total.\n';
            if (sim.efecto === 'sin_ancla')         msg += 'ℹ️ No hay corte contabilizado: se guardan, pero el Total (respaldo) no baja todavía.\n';
            msg += '\nLas fechas procesadas no se pueden volver a cargar ni deshacer.\n¿Procesar?';

            showConfirm(msg, async function() {
                var resumen = { efecto: sim.efecto, totalInsumos: sim.totalInsumos, totalNoAlcanzan: sim.totalNoAlcanzan,
                                costoDesviacion: sim.costoDesviacion, noAlcanzanSinPrecio: sim.noAlcanzanSinPrecio,
                                noAlcanzan: sim.noAlcanzan.slice(0, 10) };
                await confirmarImportacionVentas();
                if (typeof _ventasImportResultado !== 'undefined' && _ventasImportResultado) {
                    _ventasImportResultado.descargo = resumen;
                    if (_ventasImportResultado.guardado) {
                        // El Total se recalcula con el periodo recién guardado.
                        if (typeof existenciaInvalidarInicial === 'function') existenciaInvalidarInicial();
                        if (typeof existenciaCargarInicial === 'function') existenciaCargarInicial(function() {});
                    }
                    renderTab();
                }
            });
        }
        window.ventaTurnoProcesar = ventaTurnoProcesar;

        /** Resumen del descargo en la pantalla de resultado. */
        function renderDescargoVentaTurno(resultado) {
            var d = resultado && resultado.descargo;
            if (!d || !resultado.guardado) return '';
            var h = '<div class="vt-panel vt-sim">'
                  + '<div class="vt-panel__tit">Inventario descontado</div>';
            if (d.efecto === 'baja_total') {
                h += '<div class="vt-ayuda">' + d.totalInsumos + ' insumo(s) bajaron su Total de sistema.</div>';
            } else {
                h += '<div class="vt-ayuda">Venta guardada. ' + (d.efecto === 'anterior_al_corte'
                     ? 'Era anterior al último corte: el Total no cambia.'
                     : 'Sin corte contabilizado: el Total (respaldo) no cambia todavía.') + '</div>';
            }
            if (d.totalNoAlcanzan) {
                h += '<div class="vt-nota vt-nota--aviso"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> '
                   + d.totalNoAlcanzan + ' insumo(s) quedaron por debajo de cero · desviación <b>' + _vtMoneda(d.costoDesviacion) + '</b>'
                   + (d.noAlcanzanSinPrecio ? ' (+' + d.noAlcanzanSinPrecio + ' sin precio)' : '') + ': '
                   + escapeHtml(d.noAlcanzan.slice(0, 4).map(function(x) { return x.nombre; }).join(', ')) + (d.noAlcanzan.length > 4 ? '…' : '') + '</div>';
            }
            return h + '</div>';
        }
        window.renderDescargoVentaTurno = renderDescargoVentaTurno;
        window.ventaTurnoAnalizar = ventaTurnoAnalizar;
        window.ventaTurnoEfecto = ventaTurnoEfecto;
        window.ventaTurnoAnclaFecha = ventaTurnoAnclaFecha;
