        // ══════════════════════════════════════════════════════════════════════
        //  v5.40 — CONTROL DE NEGATIVOS (Ventas)
        //  ────────────────────────────────────────────────────────────────────
        //  Pedido de Eduardo (6-nov-2026), tomando como referencia la «guía de
        //  operación del control de negativos» del portal de su empresa
        //  (simular → revisar faltantes → procesar → pendientes → reprocesar /
        //  absorbidos por el siguiente conteo).
        //
        //  En BarInventory no hay SAP: «procesar» una venta es guardar el periodo
        //  (create-only) y el Total ya resta su consumo teórico. Un NEGATIVO es un
        //  insumo cuyo Total quedó por debajo de cero: se vendió (según receta)
        //  más de lo que el sistema tiene. Pasa por tres causas: una compra que no
        //  se capturó, una receta mal cargada, o un conteo anterior bajo.
        //
        //  Esta pantalla NO escribe nada. Calcula, desde el último corte:
        //    · qué insumos están en negativo y desde qué día (saldo del corte,
        //      + compras del día − consumo teórico del día, día por día);
        //    · cuánto falta (unidades y dinero al precio del catálogo);
        //    · si con el stock de hoy ALCANZA: días de cobertura con el consumo
        //      diario promedio de los días con venta cargada
        //      («Alcanza» · «Alcanza n días» · «No alcanza»);
        //    · qué quedó ABSORBIDO: lo anterior al corte vigente ya lo cubrió ese
        //      conteo (el Total vuelve a partir de lo contado).
        //  Acciones (no escriben aquí): ver las recetas que usan el insumo
        //  (buscador del Recetario por insumo) y capturar la compra faltante.
        //  Excel con la misma tabla.
        //
        //  Regla de cero (v5.40): un insumo que no está en el corte vigente
        //  arranca en 0 (nunca vacío), igual que el Total oficial.
        // ══════════════════════════════════════════════════════════════════════

        var _cn = { activo: false, filtro: 'negativos', enCurso: false };
        var CN_DIAS_ALERTA = 7;   // «Alcanza n días» por debajo de una semana

        function _cnRed(n) { var x = Number(n); return isFinite(x) ? Math.round(x * 1000) / 1000 : 0; }

        /**
         * Capa PURA. Entrada:
         *   productos       [{ id, name, group, unit, precio }]
         *   totalDe(p)      → Total oficial de hoy (el mismo del catálogo)
         *   inicialDe(p)    → saldo del corte (0 si no estaba: regla v5.40)
         *   dias            ['YYYY-MM-DD', …] del día siguiente al corte a hoy
         *   comprasPorDia   { id: { fecha: cant } }
         *   consumoPorDia   { id: { fecha: cant } }
         *   diasConVenta    número de días con ventas cargadas (para el promedio)
         * Salida: { filas: [...], resumen: {...} } — una fila por insumo con
         * consumo, compras o Total negativo.
         */
        function controlNegativosCalcular(e) {
            var tol = typeof e.tol === 'number' ? e.tol : 0.001;
            var dias = e.dias || [];
            var dcv = Math.max(0, e.diasConVenta || 0);
            var filas = [];
            (e.productos || []).forEach(function(p) {
                if (!p || !p.id) return;
                var cp = (e.comprasPorDia || {})[p.id] || {}, cs = (e.consumoPorDia || {})[p.id] || {};
                var total = _cnRed(e.totalDe(p));
                var consumo = 0, compras = 0;
                Object.keys(cs).forEach(function(f) { consumo += Number(cs[f]) || 0; });
                Object.keys(cp).forEach(function(f) { compras += Number(cp[f]) || 0; });
                consumo = _cnRed(consumo); compras = _cnRed(compras);
                if (!(consumo > tol) && !(total < -tol)) return;
                // Día por día desde el corte: ¿cuándo cruzó por debajo de cero?
                var bal = Number(e.inicialDe(p)) || 0, desde = null;
                for (var i = 0; i < dias.length; i++) {
                    bal += (Number(cp[dias[i]]) || 0) - (Number(cs[dias[i]]) || 0);
                    if (bal < -tol) { if (!desde) desde = dias[i]; } else desde = null;   // si se recuperó, vuelve a contar
                }
                var prom = dcv > 0 ? _cnRed(consumo / dcv) : 0;
                var estado, diasCob = null;
                if (total < -tol) estado = 'negativo';
                else if (!(prom > tol)) estado = 'alcanza';
                else {
                    diasCob = Math.floor(total / prom + 1e-9);
                    estado = diasCob < 1 ? 'no_alcanza' : (diasCob < CN_DIAS_ALERTA ? 'alcanza_n' : 'alcanza');
                }
                var precio = (typeof p.precio === 'number' && isFinite(p.precio) && p.precio >= 0) ? p.precio : null;
                var pendiente = total < -tol ? _cnRed(-total) : 0;
                filas.push({
                    id: p.id, nombre: p.name || p.id, grupo: p.group || 'General', unidad: p.unit || '',
                    total: total, consumo: consumo, compras: compras, promedio: prom,
                    estado: estado, dias: diasCob, desde: estado === 'negativo' ? desde : null,
                    pendiente: pendiente, precio: precio,
                    valor: (precio !== null && pendiente > 0) ? Math.round(pendiente * precio * 100) / 100 : (pendiente > 0 ? null : 0)
                });
            });
            var rango = { negativo: 0, no_alcanza: 1, alcanza_n: 2, alcanza: 3 };
            filas.sort(function(a, b) {
                return (rango[a.estado] - rango[b.estado]) || (b.pendiente - a.pendiente)
                    || ((a.dias === null ? 1e9 : a.dias) - (b.dias === null ? 1e9 : b.dias)) || String(a.nombre).localeCompare(String(b.nombre), 'es');
            });
            var neg = filas.filter(function(f) { return f.estado === 'negativo'; });
            return {
                filas: filas,
                resumen: {
                    negativos: neg.length,
                    noAlcanza: filas.filter(function(f) { return f.estado === 'no_alcanza'; }).length,
                    alcanzaN:  filas.filter(function(f) { return f.estado === 'alcanza_n'; }).length,
                    valorPendiente: Math.round(neg.reduce(function(a, f) { return a + (f.valor || 0); }, 0) * 100) / 100,
                    sinPrecio: neg.filter(function(f) { return f.precio === null; }).length
                }
            };
        }

        /** Etiqueta del estado (siempre con palabra, no solo color). */
        function controlNegativosEtiqueta(f) {
            if (f.estado === 'negativo')   return 'Negativo' + (f.desde ? ' desde ' + _cnFechaCorta(f.desde) : '');
            if (f.estado === 'no_alcanza') return 'No alcanza';
            if (f.estado === 'alcanza_n')  return 'Alcanza ' + f.dias + ' día' + (f.dias === 1 ? '' : 's');
            return 'Alcanza';
        }

        function _cnFechaCorta(iso) {
            var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
            return m ? m[3] + '/' + m[2] : String(iso || '');
        }

        // ── Capa de aplicación: arma la entrada desde el motor del Total ─────

        function _cnPuede() {
            return typeof hasPermission === 'function' && hasPermission('sales.read') && hasPermission('purchases.read');
        }

        /** null si no hay corte vigente con arrastre (no hay punto de partida). */
        function _cnDatos() {
            if (typeof _existenciaRuta !== 'function' || _existenciaRuta() !== 'arrastre') return null;
            if (typeof _existenciaInicial === 'undefined' || _existenciaInicial.estado !== 'ok' || !_existenciaInicial.ancla) return null;
            var ancla = _existenciaInicial.ancla;
            var hoy = fechaISOLocal(new Date());
            var c = _existenciaArrastreCalcular();
            var dias = [];
            for (var f = arrastreSumarDias(ancla.fecha, 1); f && f <= hoy && dias.length < 400; f = arrastreSumarDias(f, 1)) dias.push(f);
            // Compras por día (misma regla y deduplicación que arrastreEntradas).
            var comprasPorDia = {}, vistos = {};
            var mem = (typeof movimientos !== 'undefined' && Array.isArray(movimientos)) ? movimientos : [];
            (_existenciaArrastre.compras || []).concat(mem).forEach(function(m) {
                if (!m || m.tipo !== 'compra' || !m.productoId) return;
                if (m.movId) { if (vistos[m.movId]) return; vistos[m.movId] = true; }
                var fe = m.fecha || m.semanaId || null;
                if (!fe || fe <= ancla.fecha || fe > hoy) return;
                var o = comprasPorDia[m.productoId] || (comprasPorDia[m.productoId] = {});
                o[fe] = (o[fe] || 0) + (Number(m.cantidad) || 0);
            });
            // Consumo por día: el de cada periodo incluido, repartido por igual entre sus días.
            var consumoPorDia = {};
            (c.periodos.incluidos || []).forEach(function(per) {
                var r = (typeof consumoTeoricoDeLineas === 'function') ? consumoTeoricoDeLineas(per.lineas || [], 'control') : { consumo: {} };
                var dper = [];
                for (var d = per.inicio; d && d <= per.fin && dper.length < 62; d = arrastreSumarDias(d, 1)) dper.push(d);
                if (!dper.length) return;
                Object.keys(r.consumo || {}).forEach(function(pid) {
                    var porDia = (Number(r.consumo[pid]) || 0) / dper.length;
                    var o = consumoPorDia[pid] || (consumoPorDia[pid] = {});
                    dper.forEach(function(x) { o[x] = (o[x] || 0) + porDia; });
                });
            });
            var ent = existenciaEntradas(), ven = existenciaVentas();
            var calc = controlNegativosCalcular({
                productos: (typeof products !== 'undefined' && Array.isArray(products)) ? products : [],
                totalDe: function(p) { return existenciaOficial(p, ent, ven).valor; },
                inicialDe: function(p) { var s = _existenciaInicial.saldos || {}; return typeof s[p.id] === 'number' ? s[p.id] : 0; },
                dias: dias, comprasPorDia: comprasPorDia, consumoPorDia: consumoPorDia,
                diasConVenta: (c.periodos.diasCubiertos || []).length
            });
            calc.ancla = ancla;
            calc.diasEsperados = (c.periodos.diasEsperados || []).length;
            calc.diasCubiertos = (c.periodos.diasCubiertos || []).length;
            calc.diasFaltantes = (c.periodos.diasFaltantes || []).slice();
            calc.partidos = (c.periodos.partidos || []).length;
            calc.incompleto = !!(_existenciaArrastre.comprasNoDisponibles || _existenciaArrastre.ventasNoDisponibles);
            return calc;
        }

        // ── Pantalla ─────────────────────────────────────────────────────────

        function controlNegativosActivo() { return !!_cn.activo; }
        function controlNegativosAbrir() { _cn.activo = true; _cn.filtro = 'negativos'; renderTab(); if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0); }
        function controlNegativosCerrar() { _cn.activo = false; renderTab(); }
        function controlNegativosFiltro(f) { _cn.filtro = f; renderTab(); }

        /** Insignia para el botón de acceso en Ventas: cuántos negativos hay (o null si no se puede saber). */
        function controlNegativosConteo() {
            if (!_cnPuede()) return null;
            try { var d = _cnDatos(); return d ? d.resumen.negativos : null; } catch (_) { return null; }
        }

        function _cnNum(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 }); }
        function _cnMoneda(n) { return '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

        function _cnFilaHtml(f) {
            var id = escapeHtml(String(f.id));
            var tono = f.estado === 'negativo' ? 'neg' : (f.estado === 'no_alcanza' ? 'neg' : (f.estado === 'alcanza_n' ? 'warn' : 'ok'));
            var h = '<div class="cn-fila cn-fila--' + tono + '" data-cn-id="' + id + '">';
            h += '<div class="cn-fila__info"><div class="cn-fila__nom">' + escapeHtml(f.nombre) + '</div>'
               + '<div class="cn-fila__meta"><span class="num">' + id + '</span>' + (f.unidad ? ' · ' + escapeHtml(f.unidad) : '')
               + ' · <span class="cn-estado cn-estado--' + tono + '">' + escapeHtml(controlNegativosEtiqueta(f)) + '</span></div>'
               + '<div class="cn-fila__det">Consumo <b class="num">' + _cnNum(f.consumo) + '</b> · Compras <b class="num">' + _cnNum(f.compras) + '</b>'
               + (f.promedio > 0 ? ' · <b class="num">' + _cnNum(f.promedio) + '</b>/día' : '') + '</div></div>';
            h += '<div class="cn-fila__cifra"><span class="cn-fila__etq">Total</span><b class="num cn-total--' + tono + '">' + _cnNum(f.total) + '</b>'
               + (f.pendiente > 0 ? '<span class="cn-fila__val num">' + (f.valor === null ? 'sin precio' : '−' + _cnMoneda(f.valor)) + '</span>' : '') + '</div>';
            h += '<div class="cn-fila__acc">'
               + '<button type="button" class="cn-btn" onclick="controlNegativosVerRecetas(\'' + id + '\')" aria-label="Ver las recetas que usan ' + escapeHtml(f.nombre) + '" title="Recetas que lo usan"><i class="fa-solid fa-book" aria-hidden="true"></i></button>'
               + ((f.estado === 'negativo' && typeof hasPermission === 'function' && hasPermission('purchases.create'))
                    ? '<button type="button" class="cn-btn" onclick="controlNegativosCapturarCompra()" aria-label="Capturar la compra de ' + escapeHtml(f.nombre) + '" title="Capturar compra"><i class="fa-solid fa-receipt" aria-hidden="true"></i></button>' : '')
               + '</div>';
            return h + '</div>';
        }

        function renderControlNegativos() {
            var estadoSync = (typeof _syncEnabled !== 'undefined' && !_syncEnabled) ? 'pendiente' : 'ok';
            var h = '<div class="vt-wrap cn-pantalla">' + moduloCabecera('Control de negativos', 'controlNegativosCerrar()', estadoSync,
                'Insumos cuya existencia teórica quedó por debajo de cero.');
            if (!_cnPuede()) {
                return h + '<div class="vs-vacio"><div class="vs-vacio__t">Sin permiso</div><div class="vs-vacio__s">Hace falta ver compras y ventas para calcular los negativos.</div></div></div>';
            }
            var d = _cnDatos();
            if (!d) {
                return h + '<div class="vs-vacio"><div class="vs-vacio__t">Sin corte vigente</div>'
                     + '<div class="vs-vacio__s">Los negativos se calculan desde el último conteo contabilizado o corte importado. Contabiliza un inventario para empezar.</div></div></div>';
            }
            var r = d.resumen;
            h += '<div class="cn-corte"><i class="fa-solid fa-flag" aria-hidden="true"></i> Desde <b>' + escapeHtml(typeof anclaEtiqueta === 'function' ? anclaEtiqueta(d.ancla) : d.ancla.fecha) + '</b>'
               + ' · ventas cargadas <b class="num">' + d.diasCubiertos + ' de ' + d.diasEsperados + '</b> días. Lo anterior al corte quedó <b>absorbido</b> por ese conteo.</div>';
            if (d.diasFaltantes.length) {
                h += '<div class="vt-msg vt-msg--aviso"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Faltan ventas de '
                   + escapeHtml(d.diasFaltantes.slice(0, 6).map(_cnFechaCorta).join(', ')) + (d.diasFaltantes.length > 6 ? '…' : '')
                   + ': el consumo puede estar bajo y un negativo, no verse todavía.</div>';
            }
            if (d.incompleto) h += '<div class="vt-msg vt-msg--aviso"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> No se pudieron leer todas las compras o ventas: el cálculo es parcial.</div>';
            h += '<div class="kpi-fila">'
               + '<div class="kpi' + (r.negativos ? ' kpi--neg' : '') + '"><div class="kpi__n">' + r.negativos + '</div><div class="kpi__t">En negativo</div></div>'
               + '<div class="kpi"><div class="kpi__n">' + (r.noAlcanza + r.alcanzaN) + '</div><div class="kpi__t">Alcanza poco</div></div>'
               + '<div class="kpi"><div class="kpi__n">' + _cnMoneda(r.valorPendiente) + '</div><div class="kpi__t">Valor pendiente</div></div>'
               + '</div>';
            var filtros = [['negativos', 'Negativos', r.negativos], ['riesgo', 'No alcanza', r.noAlcanza + r.alcanzaN], ['todos', 'Con consumo', d.filas.length]];
            h += '<div class="sbx-chips" role="group" aria-label="Filtrar">' + filtros.map(function(x) {
                var on = _cn.filtro === x[0];
                return '<button type="button" class="sbx-chip' + (on ? ' sbx-chip--on' : '') + '" aria-pressed="' + on + '" onclick="controlNegativosFiltro(\'' + x[0] + '\')">'
                     + x[1] + ' <span class="sbx-chip__n">' + x[2] + '</span></button>';
            }).join('');
            if (typeof hasPermission === 'function' && hasPermission('inventory.export')) {
                h += '<button type="button" class="sbx-chip" id="cnExportBtn" onclick="controlNegativosExportarExcel()"><i class="fa-solid fa-file-excel" aria-hidden="true"></i> Excel</button>';
            }
            h += '</div>';
            var lista = d.filas.filter(function(f) {
                if (_cn.filtro === 'negativos') return f.estado === 'negativo';
                if (_cn.filtro === 'riesgo') return f.estado === 'no_alcanza' || f.estado === 'alcanza_n';
                return true;
            });
            if (!lista.length) {
                h += '<div class="vs-vacio"><div class="vs-vacio__t">' + (_cn.filtro === 'negativos' ? 'Sin negativos' : 'Nada en esta lista') + '</div>'
                   + '<div class="vs-vacio__s">' + (_cn.filtro === 'negativos' ? 'Ningún insumo quedó por debajo de cero desde el corte.' : 'Ningún insumo cumple este filtro.') + '</div></div>';
            } else {
                h += '<div class="cn-lista">' + lista.map(_cnFilaHtml).join('') + '</div>';
            }
            h += '<details class="cn-reglas"><summary>Reglas de oro</summary><ul>'
               + '<li><b>Simular</b> la venta (Importar ventas) no toca el inventario: puedes repetirlo.</li>'
               + '<li><b>Procesar</b> guarda el periodo y descuenta el consumo de las recetas; no se deshace.</li>'
               + '<li>Un periodo por día o turno cerrado; un periodo que cruza la fecha del corte no se acepta.</li>'
               + '<li>Un negativo se corrige capturando la compra que faltó, corrigiendo la receta, o lo <b>absorbe</b> el siguiente conteo contabilizado.</li>'
               + '<li>Un insumo que no se contó entra en 0: su Total es 0 + compras − ventas.</li>'
               + '</ul></details>';
            return h + '</div>';
        }

        /** Abre el Recetario buscando por insumo (las recetas que lo usan). */
        function controlNegativosVerRecetas(pid) {
            var p = (typeof products !== 'undefined' && Array.isArray(products)) ? products.find(function(x) { return x.id === pid; }) : null;
            _cn.activo = false;
            if (typeof recetarioView !== 'undefined') { recetarioView = 'lista'; recetarioFichaId = null; }
            var f = BusquedaUI.filtros('recetario');
            delete f.porReceta; f.porInsumo = true;
            if (typeof _recetarioSearchTerm !== 'undefined') _recetarioSearchTerm = p ? (p.name || pid) : pid;
            BusquedaUI.establecer('recetario', p ? (p.name || pid) : pid);
            switchTab('recetario');
        }

        function controlNegativosCapturarCompra() {
            _cn.activo = false;
            switchTab('compras');
            if (typeof comprasNuevaManual === 'function') comprasNuevaManual();
        }

        // ── Excel ────────────────────────────────────────────────────────────
        var CN_EXPORT_COLUMNAS = ['Grupo', 'ID', 'Insumo', 'Unidad', 'Total', 'Consumo desde el corte', 'Compras desde el corte',
                                  'Consumo diario', 'Estado', 'Negativo desde', 'Pendiente', 'Precio', 'Valor pendiente'];

        function controlNegativosExportarExcel() {
            if (_cn.enCurso) return { ok: false, motivo: 'en_curso' };
            if (!(typeof hasPermission === 'function' && hasPermission('inventory.export'))) { showNotification('⚠️ No tienes permiso para exportar'); return { ok: false, motivo: 'sin_permiso' }; }
            if (typeof XLSX === 'undefined') { showNotification('⏳ Cargando la librería de Excel… intenta en unos segundos'); return { ok: false, motivo: 'sin_xlsx' }; }
            var d = _cnDatos();
            if (!d || !d.filas.length) { showNotification('ℹ️ No hay insumos con consumo desde el corte'); return { ok: false, motivo: 'sin_filas' }; }
            _cn.enCurso = true;
            try {
                var aoa = [CN_EXPORT_COLUMNAS.slice()];
                d.filas.forEach(function(f) {
                    aoa.push([f.grupo, String(f.id), f.nombre, f.unidad, f.total, f.consumo, f.compras, f.promedio, controlNegativosEtiqueta(f),
                              f.desde || '', f.pendiente, f.precio, f.pendiente > 0 ? f.valor : 0]);
                });
                var ws = XLSX.utils.aoa_to_sheet(aoa);
                for (var r = 1; r < aoa.length; r++) {
                    ws[XLSX.utils.encode_cell({ r: r, c: 1 })] = { t: 's', v: aoa[r][1] };
                    [11, 12].forEach(function(c) { var ref = XLSX.utils.encode_cell({ r: r, c: c }); if (aoa[r][c] === null || aoa[r][c] === undefined) delete ws[ref]; });
                }
                ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 36 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 13 }, { wch: 11 }, { wch: 10 }, { wch: 14 }];
                ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: CN_EXPORT_COLUMNAS.length - 1 } }) };
                var inf = XLSX.utils.aoa_to_sheet([['Concepto', 'Valor'],
                    ['Corte de partida', (typeof anclaEtiqueta === 'function' ? anclaEtiqueta(d.ancla) : d.ancla.fecha)],
                    ['Días con ventas cargadas', d.diasCubiertos + ' de ' + d.diasEsperados],
                    ['Insumos en negativo', d.resumen.negativos], ['Valor pendiente', d.resumen.valorPendiente],
                    ['Total', 'Saldo del corte (0 si no se contó) + compras − consumo teórico de las ventas, desde el día siguiente al corte.'],
                    ['Consumo diario', 'Consumo desde el corte ÷ días con ventas cargadas.'],
                    ['Estado', 'Negativo · No alcanza (menos de un día) · Alcanza n días (menos de 7) · Alcanza.']]);
                var wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Control de negativos');
                XLSX.utils.book_append_sheet(wb, inf, 'Información');
                var hoy = new Date(), pad = function(n) { return (n < 10 ? '0' : '') + n; };
                var nombre = 'Control_de_negativos_' + hoy.getFullYear() + '-' + pad(hoy.getMonth() + 1) + '-' + pad(hoy.getDate()) + '.xlsx';
                var bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
                var fijo = (typeof existenciasExportCongelar === 'function') ? existenciasExportCongelar(XLSX, bytes, 1) : null;
                if (typeof _fvsDescargar === 'function') _fvsDescargar(fijo || bytes, nombre);
                showNotification('✅ ' + nombre + ' — ' + d.filas.length + ' insumo(s)');
                return { ok: true, nombre: nombre, filas: d.filas.length };
            } catch (e) {
                console.error('[ControlNegativos] Error al exportar:', e);
                showNotification('❌ No se pudo generar el Excel: ' + (e && e.message ? e.message : e));
                return { ok: false, motivo: 'error_generar' };
            } finally { _cn.enCurso = false; }
        }

        if (typeof window !== 'undefined') {
            window.controlNegativosCalcular = controlNegativosCalcular;
            window.controlNegativosAbrir = controlNegativosAbrir;
            window.controlNegativosCerrar = controlNegativosCerrar;
            window.controlNegativosFiltro = controlNegativosFiltro;
            window.controlNegativosVerRecetas = controlNegativosVerRecetas;
            window.controlNegativosCapturarCompra = controlNegativosCapturarCompra;
            window.controlNegativosExportarExcel = controlNegativosExportarExcel;
            window.renderControlNegativos = renderControlNegativos;
        }
