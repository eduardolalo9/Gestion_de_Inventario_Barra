        // ═════════════════════════════════════════════════════
        //  v5.54 — EXPORTAR / COMPARTIR EL CONTEO ACTIVO (PDF y Excel)
        //  ────────────────────────────────────────────────────
        //  Pedido de Eduardo (19-nov-2026): en la ventana Inventario, descargar en
        //  PDF y compartir en PDF o Excel el conteo físico ACTIVO de las áreas.
        //  PDF en A4 vertical, ajustado a la hoja para imprimir, con el total de
        //  cada área CONVERTIDO (enteras + botellas abiertas en puntos de botella)
        //  y bandas por grupo para ubicar el producto de un vistazo.
        //  Decisiones suyas: A4 vertical · con detalle «enteras + abiertas» · los
        //  productos sin conteo salen en CEROS (nunca vacíos).
        //
        //  FUENTE — fvsConteoPorArea() de js/49 (el conteo vivo que agrega el
        //  administrador, `auditoriaConteo`), la misma que usan Físico vs Sistema
        //  y Pedidos con el conteo de todas las áreas. Este módulo NO calcula una
        //  conversión propia: si lo hiciera, el PDF y la pantalla podrían decir
        //  cosas distintas.
        //
        //  SOLO LEE. No escribe en products, conteos, stockByArea, movimientos,
        //  localStorage ni Firestore. Permiso: inventory.export (el mismo del resto
        //  de las salidas) + inventory.viewAll: el conteo es ciego y quien no ve
        //  los conteos ajenos no puede sacarlos en un archivo.
        //
        //  LIBRERÍA — jsPDF 4.2.1 (MIT) propia en js/jspdf.umd.min.js, sin CDN
        //  (la CSP solo permite 'self'). Solo dibuja texto, rectángulos y líneas
        //  (fuentes estándar Helvetica y Courier): nada de html(), imágenes ni SVG.
        //  Se carga al abrir la hoja de exportar, no al arrancar la app.
        // ═════════════════════════════════════════════════════

        var CX_COLORES_GRUPO = ['#10B981', '#3B82F6', '#F59E0B', '#A855F7', '#EF4444', '#06B6D4', '#EC4899', '#84CC16', '#F97316', '#6366F1', '#14B8A6', '#94A3B8'];

        function _cxRed3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

        /** Número corto: hasta 2 decimales, sin ceros sobrantes («3», «3.4», «0.25»). */
        function _cxNum(n) {
            var v = Math.round((Number(n) || 0) * 100) / 100;
            if (Object.is(v, -0)) v = 0;
            return String(v);
        }

        /** Texto seguro para las fuentes estándar del PDF (Latin-1): lo demás se vuelve «?». */
        function _cxTexto(s) {
            return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim()
                .replace(/[\u2013\u2014\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, '...')
                .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
        }

        function _cxRgb(hex) {
            var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
            return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [100, 116, 139];
        }

        function conteoExportNombre(fecha, extension, base) {
            var d = fecha instanceof Date ? fecha : new Date();
            var p = function(n) { return (n < 10 ? '0' : '') + n; };
            return (base || 'Conteo_activo') + '_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.' + extension;
        }

        // ── Capa pura: datos ─────────────────────────────────────────────────

        /**
         * conteoExportFilas(productos, conteoDe, areas)
         *   productos: arreglo de productos {id, name, group, unit}
         *   conteoDe(p): { tocado, areas: { area: { enteras, abiertas[], total } | null } }  (fvsConteoPorArea)
         *   areas: claves de área a incluir, en el orden de las columnas
         * Devuelve filas ordenadas por grupo y nombre:
         *   { id, nombre, grupo, unidad, contado, total, cols: [{ enteras, abiertas, total, contado }] }
         * `abiertas` es lo que aportan las botellas abiertas YA CONVERTIDO (total − enteras).
         * Un área o un producto sin conteo vale 0 (regla de Eduardo: nunca vacío), con contado=false.
         */
        function conteoExportFilas(productos, conteoDe, areas) {
            var filas = [];
            (productos || []).forEach(function(p) {
                if (!p) return;
                var c = conteoDe(p) || { tocado: false, areas: {} };
                var alguna = false;
                var cols = (areas || []).map(function(a) {
                    var d = c.areas ? c.areas[a] : null;
                    if (!d) return { enteras: 0, abiertas: 0, total: 0, contado: false };
                    alguna = true;
                    var enteras = _cxRed3(d.enteras);
                    var total = _cxRed3(d.total);
                    return { enteras: enteras, abiertas: _cxRed3(total - enteras), total: total, contado: true };
                });
                var total = _cxRed3(cols.reduce(function(a, x) { return a + x.total; }, 0));
                filas.push({
                    id: String(p.id === undefined || p.id === null ? '' : p.id),
                    nombre: String(p.name || p.nombre || ''),
                    grupo: String(p.group || 'General'),
                    unidad: String(p.unit || ''),
                    contado: alguna, total: total, cols: cols
                });
            });
            var cmp = function(a, b) { return String(a).localeCompare(String(b), 'es', { sensitivity: 'base', numeric: true }); };
            filas.sort(function(a, b) { return cmp(a.grupo, b.grupo) || cmp(a.nombre, b.nombre) || cmp(a.id, b.id); });
            return filas;
        }

        /** Totales para el encabezado, el índice de grupos y los subtotales por banda. */
        function conteoExportResumen(filas, nAreas) {
            var r = { productos: filas.length, contados: 0, pendientes: 0, total: 0, grupos: [], porArea: [] };
            for (var i = 0; i < nAreas; i++) r.porArea.push(0);
            var idx = {};
            filas.forEach(function(f) {
                if (f.contado) r.contados++; else r.pendientes++;
                r.total += f.total;
                f.cols.forEach(function(c, i) { r.porArea[i] += c.total; });
                var g = idx[f.grupo];
                if (!g) {
                    g = idx[f.grupo] = { nombre: f.grupo, n: 0, subtotal: 0, color: CX_COLORES_GRUPO[r.grupos.length % CX_COLORES_GRUPO.length] };
                    r.grupos.push(g);
                }
                g.n++; g.subtotal += f.total;
            });
            r.total = _cxRed3(r.total);
            r.porArea = r.porArea.map(_cxRed3);
            r.grupos.forEach(function(g) { g.subtotal = _cxRed3(g.subtotal); });
            return r;
        }

        // ── Capa pura: PDF (A4 vertical) ─────────────────────────────────────

        var CX_PDF = {
            ancho: 210, alto: 297, margen: 11,
            colCod: 17, colTotal: 22, colAreaMax: 25, colAreaMin: 17,
            filaH: 6.7, bandaH: 6.4, cabTablaH: 10.4,
            pieH: 13, cabContH: 17,
            verde: [6, 78, 59], verdeClaro: [236, 253, 245], gris: [100, 116, 139], grisClaro: [148, 163, 184],
            texto: [15, 23, 42], zebra: [250, 251, 252], banda: [241, 245, 249], linea: [226, 232, 240]
        };

        /** Ajusta un texto a un ancho: baja el cuerpo hasta `min` y, si aún no cabe, lo recorta con «...». */
        function _cxAjustar(doc, texto, ancho, cuerpo, min) {
            var t = _cxTexto(texto), s = cuerpo;
            doc.setFontSize(s);
            while (doc.getTextWidth(t) > ancho && s > min) { s = Math.round((s - 0.2) * 10) / 10; doc.setFontSize(s); }
            if (doc.getTextWidth(t) > ancho) {
                while (t.length > 1 && doc.getTextWidth(t + '...') > ancho) t = t.slice(0, -1);
                t = t.replace(/\s+$/, '') + '...';
            }
            return t;
        }

        /**
         * conteoExportPdf(J, filas, areasInfo, info)
         *   J: constructor jsPDF (window.jspdf.jsPDF)
         *   areasInfo: [{ clave, nombre }] — mismas áreas y orden que las columnas de `filas`
         *   info: { titulo, subtitulo, derecha:[líneas], version, generado }
         * Devuelve { doc, paginas, resumen }. Una sola pasada de maquetación y otra para «Hoja X de Y».
         */
        function conteoExportPdf(J, filas, areasInfo, info) {
            var C = CX_PDF;
            var doc = new J({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
            doc.setProperties({ title: _cxTexto(info.titulo || 'Conteo activo'), subject: 'Conteo físico activo',
                                author: _cxTexto(info.usuario || 'BarInventory'), creator: 'BarInventory ' + _cxTexto(info.version || '') });
            var N = areasInfo.length;
            var res = conteoExportResumen(filas, N);
            var util = C.ancho - 2 * C.margen;
            var colArea = Math.max(C.colAreaMin, Math.min(C.colAreaMax, (util - C.colCod - C.colTotal - 56) / Math.max(1, N)));
            var colNom = util - C.colCod - C.colTotal - colArea * N;
            var x0 = C.margen, xNom = x0 + C.colCod, xArea0 = xNom + colNom, xTot = xArea0 + colArea * N;
            var colorDe = {}; res.grupos.forEach(function(g) { colorDe[g.nombre] = g.color; });

            var pagina = 0, y = 0;
            var nuevaPagina = function() { if (pagina > 0) doc.addPage('a4', 'portrait'); pagina++; };

            var cabeceraTabla = function() {
                doc.setFillColor(C.verde[0], C.verde[1], C.verde[2]);
                doc.rect(x0, y, util, C.cabTablaH, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
                doc.text('COD.', x0 + 2, y + 6.1);
                doc.text('PRODUCTO', xNom + 1, y + 6.1);
                areasInfo.forEach(function(a, i) {
                    var cx = xArea0 + colArea * (i + 1) - 2;
                    // El nombre del área puede ocupar dos líneas («Barra Restaurante»): nunca letra diminuta.
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8);
                    var lin = doc.splitTextToSize(_cxTexto(a.nombre).toUpperCase(), colArea - 3).slice(0, 2);
                    lin = lin.map(function(t) { return _cxAjustar(doc, t, colArea - 3, 6.8, 5.6); });
                    var y1 = lin.length === 1 ? y + 4.4 : y + 3.5;
                    lin.forEach(function(t, k) { doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.text(t, cx, y1 + k * 2.7, { align: 'right' }); });
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.4);
                    doc.text('enteras + abiertas', cx, lin.length === 1 ? y + 8 : y + 9.2, { align: 'right' });
                });
                doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
                doc.text('TOTAL CONV.', xTot + C.colTotal - 2, y + 6.1, { align: 'right' });
                y += C.cabTablaH;
            };

            var cabeceraPrimera = function() {
                doc.setTextColor(C.verde[0], C.verde[1], C.verde[2]);
                doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
                doc.text(_cxTexto(info.titulo), x0, C.margen + 8);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(C.gris[0], C.gris[1], C.gris[2]);
                doc.text(_cxTexto(info.subtitulo), x0, C.margen + 13.2);
                doc.setFontSize(8);
                (info.derecha || []).forEach(function(l, i) { doc.text(_cxTexto(l), C.ancho - C.margen, C.margen + 5.4 + i * 4.2, { align: 'right' }); });
                doc.setDrawColor(4, 120, 87); doc.setLineWidth(0.7);
                doc.line(x0, C.margen + 16, C.ancho - C.margen, C.margen + 16);
                y = C.margen + 20;
                // Tarjetas
                var tarj = [['PRODUCTOS', String(res.productos), C.verde], ['CONTADOS', String(res.contados), C.verde],
                            ['PENDIENTES (EN 0)', String(res.pendientes), res.pendientes ? [180, 83, 9] : C.verde],
                            ['TOTAL GENERAL (CONV.)', _cxNum(res.total), C.verde]];
                var gap = 3, w = (util - gap * 3) / 4;
                tarj.forEach(function(t, i) {
                    var x = x0 + i * (w + gap);
                    doc.setFillColor(248, 250, 252); doc.setDrawColor(C.linea[0], C.linea[1], C.linea[2]); doc.setLineWidth(0.2);
                    doc.roundedRect(x, y, w, 13, 1.6, 1.6, 'FD');
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8); doc.setTextColor(C.gris[0], C.gris[1], C.gris[2]);
                    doc.text(t[0], x + 2.6, y + 4.4);
                    doc.setFontSize(13); doc.setTextColor(t[2][0], t[2][1], t[2][2]);
                    doc.text(t[1], x + 2.6, y + 10.6);
                });
                y += 16.5;
                // Índice de grupos (píldoras de color)
                var px = x0, py = y;
                doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6);
                res.grupos.forEach(function(g) {
                    var et = _cxTexto(g.nombre).toUpperCase(), w2 = doc.getTextWidth(et) + 5;
                    if (px + w2 > C.ancho - C.margen) { px = x0; py += 5.6; }
                    var c = _cxRgb(g.color);
                    doc.setFillColor(c[0], c[1], c[2]); doc.roundedRect(px, py, w2, 4.4, 2.2, 2.2, 'F');
                    doc.setTextColor(255, 255, 255); doc.text(et, px + 2.5, py + 3.1);
                    px += w2 + 1.8;
                });
                y = py + 8;
            };

            var cabeceraContinuacion = function() {
                doc.setTextColor(C.verde[0], C.verde[1], C.verde[2]);
                doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
                doc.text(_cxTexto(info.titulo), x0, C.margen + 5);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4); doc.setTextColor(C.gris[0], C.gris[1], C.gris[2]);
                doc.text(_cxTexto(info.subtitulo), C.ancho - C.margen, C.margen + 5, { align: 'right' });
                doc.setDrawColor(4, 120, 87); doc.setLineWidth(0.5);
                doc.line(x0, C.margen + 7.4, C.ancho - C.margen, C.margen + 7.4);
                y = C.margen + 10.4;
            };

            var limite = C.alto - C.pieH - 4;
            var abrirPagina = function(primera) {
                nuevaPagina();
                if (primera) cabeceraPrimera(); else cabeceraContinuacion();
                cabeceraTabla();
            };

            var dibujarBanda = function(g, cont, subtotal) {
                var c = _cxRgb(g.color);
                doc.setFillColor(C.banda[0], C.banda[1], C.banda[2]); doc.rect(x0, y, util, C.bandaH, 'F');
                doc.setFillColor(c[0], c[1], c[2]); doc.rect(x0, y, 1.6, C.bandaH, 'F');
                doc.roundedRect(x0 + 3.2, y + 1.9, 2.6, 2.6, 0.6, 0.6, 'F');
                doc.setTextColor(C.texto[0], C.texto[1], C.texto[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2);
                var t = _cxTexto(g.nombre).toUpperCase();
                doc.text(t, x0 + 8, y + 4.4);
                var w = doc.getTextWidth(t);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(C.gris[0], C.gris[1], C.gris[2]);
                doc.text(g.n + ' producto' + (g.n === 1 ? '' : 's') + (cont ? ' · continúa' : ''), x0 + 8 + w + 2.4, y + 4.3);
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2); doc.setTextColor(C.texto[0], C.texto[1], C.texto[2]);
                doc.text(_cxNum(subtotal), xTot + C.colTotal - 2, y + 4.4, { align: 'right' });
                doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.2); doc.line(x0, y + C.bandaH, x0 + util, y + C.bandaH);
                y += C.bandaH;
            };

            var dibujarFila = function(f, par, color) {
                var c = _cxRgb(color);
                if (par) { doc.setFillColor(C.zebra[0], C.zebra[1], C.zebra[2]); doc.rect(x0, y, util, C.filaH, 'F'); }
                doc.setFillColor(C.verdeClaro[0], C.verdeClaro[1], C.verdeClaro[2]); doc.rect(xTot, y, C.colTotal, C.filaH, 'F');
                doc.setFillColor(c[0], c[1], c[2]); doc.rect(x0, y, 0.9, C.filaH, 'F');
                var gris = !f.contado;
                // código
                doc.setFont('courier', 'normal'); doc.setTextColor(C.gris[0], C.gris[1], C.gris[2]);
                doc.text(_cxAjustar(doc, f.id, C.colCod - 3, 7, 5.6), x0 + 2.2, y + 4.4);
                // nombre
                doc.setFont('helvetica', 'bold'); doc.setTextColor(gris ? 148 : C.texto[0], gris ? 163 : C.texto[1], gris ? 184 : C.texto[2]);
                doc.text(_cxAjustar(doc, f.nombre, colNom - 3, 8.2, 6.4), xNom + 1, y + 4.4);
                // áreas
                f.cols.forEach(function(col, i) {
                    var cx = xArea0 + colArea * (i + 1) - 2;
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2);
                    if (col.contado && col.total !== 0) {
                        doc.setTextColor(C.texto[0], C.texto[1], C.texto[2]);
                        doc.text(_cxNum(col.total), cx, y + 3.3, { align: 'right' });
                        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.6); doc.setTextColor(C.gris[0], C.gris[1], C.gris[2]);
                        doc.text(_cxNum(col.enteras) + ' ent' + (col.abiertas > 0 ? ' + ' + _cxNum(col.abiertas) : ''), cx, y + 5.9, { align: 'right' });
                    } else {
                        doc.setTextColor(col.contado ? C.texto[0] : 190, col.contado ? C.texto[1] : 198, col.contado ? C.texto[2] : 208);
                        doc.text('0', cx, y + 4.4, { align: 'right' });
                    }
                });
                // total
                doc.setFont('helvetica', 'bold'); doc.setFontSize(9.4);
                if (gris) doc.setTextColor(148, 163, 184); else doc.setTextColor(6, 95, 70);
                doc.text(_cxNum(f.total), xTot + C.colTotal - 2, y + 4.5, { align: 'right' });
                doc.setDrawColor(C.linea[0], C.linea[1], C.linea[2]); doc.setLineWidth(0.15); doc.line(x0, y + C.filaH, x0 + util, y + C.filaH);
                doc.setDrawColor(167, 243, 208); doc.setLineWidth(0.3); doc.line(xTot, y, xTot, y + C.filaH);
                y += C.filaH;
            };

            if (!filas.length) {
                abrirPagina(true);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(C.gris[0], C.gris[1], C.gris[2]);
                doc.text('No hay productos para mostrar.', x0, y + 8);
            } else {
                abrirPagina(true);
                var grupoActual = null, n = 0;
                filas.forEach(function(f) {
                    var g = res.grupos.filter(function(x) { return x.nombre === f.grupo; })[0];
                    var nuevoGrupo = (grupoActual !== f.grupo);
                    // Una banda de grupo no se queda sola al pie: necesita sitio para ella y 2 filas.
                    var necesita = (nuevoGrupo ? C.bandaH + C.filaH * 2 : C.filaH);
                    if (y + necesita > limite) { abrirPagina(false); if (!nuevoGrupo) dibujarBanda(g, true, g.subtotal); }
                    if (nuevoGrupo) { grupoActual = f.grupo; n = 0; dibujarBanda(g, false, g.subtotal); }
                    dibujarFila(f, n % 2 === 1, g.color);
                    n++;
                });
            }

            // Pie en cada hoja: nota, versión y «Hoja X de Y»
            var total = doc.getNumberOfPages();
            for (var p = 1; p <= total; p++) {
                doc.setPage(p);
                var yp = C.alto - C.pieH;
                doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.25); doc.line(x0, yp, C.ancho - C.margen, yp);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.setTextColor(C.gris[0], C.gris[1], C.gris[2]);
                doc.text('Total = botellas enteras + botellas abiertas convertidas a puntos de botella (según capacidad y peso).', x0, yp + 4.2);
                doc.text('Los productos sin conteo aparecen en 0 y en gris.  Generado ' + _cxTexto(info.generado || ''), x0, yp + 7.6);
                doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(C.texto[0], C.texto[1], C.texto[2]);
                doc.text('Hoja ' + p + ' de ' + total, C.ancho - C.margen, yp + 7.6, { align: 'right' });
                doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.setTextColor(C.gris[0], C.gris[1], C.gris[2]);
                doc.text('BarInventory v' + _cxTexto(info.version || ''), C.ancho - C.margen, yp + 4.2, { align: 'right' });
            }
            return { doc: doc, paginas: total, resumen: res };
        }

        // ── Capa pura: Excel ─────────────────────────────────────────────────

        /**
         * Hoja «Conteo activo»: Grupo · Código · Producto · Unidad · por área (Enteras · Abiertas conv. · Total) · Total conv.
         * Hoja «Información»: de dónde salen las cifras y quién lo generó.
         */
        function conteoExportLibro(X, filas, areasInfo, info) {
            var enc = ['Grupo', 'Código', 'Producto', 'Unidad'];
            areasInfo.forEach(function(a) { enc.push(a.nombre + ' · enteras', a.nombre + ' · abiertas (conv.)', a.nombre + ' · total'); });
            enc.push('Total conv.', 'Estado');
            var aoa = [enc];
            filas.forEach(function(f) {
                var fila = [f.grupo, f.id, f.nombre, f.unidad];
                f.cols.forEach(function(c) { fila.push(c.enteras, c.abiertas, c.total); });
                fila.push(f.total, f.contado ? 'Contado' : 'Sin conteo (0)');
                aoa.push(fila);
            });
            var ws = X.utils.aoa_to_sheet(aoa);
            for (var r = 1; r < aoa.length; r++) {      // el código siempre como texto («0012» no puede volverse 12)
                var ref = X.utils.encode_cell({ r: r, c: 1 });
                if (ws[ref]) { ws[ref].t = 's'; ws[ref].v = String(filas[r - 1].id); delete ws[ref].w; }
            }
            var ancho = function(i, min, max) {
                var m = min;
                aoa.forEach(function(fila) { var s = fila[i] === null || fila[i] === undefined ? '' : String(fila[i]); if (s.length > m) m = s.length; });
                return { wch: Math.min(max, m + 2) };
            };
            var cols = [ancho(0, 8, 24), ancho(1, 7, 14), ancho(2, 16, 52), ancho(3, 7, 12)];
            for (var i = 0; i < areasInfo.length * 3; i++) cols.push({ wch: 15 });
            cols.push({ wch: 13 }, { wch: 15 });
            ws['!cols'] = cols;
            ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, aoa.length - 1), c: enc.length - 1 } }) };

            var res = conteoExportResumen(filas, areasInfo.length);
            var inf = [['Concepto', 'Valor'],
                ['Generado', info.generado || ''],
                ['Usuario', info.usuario || ''],
                ['Versión de la app', info.version || ''],
                ['Inventario', info.inventario || ''],
                ['Áreas incluidas', areasInfo.map(function(a) { return a.nombre; }).join(' · ')],
                ['Productos', res.productos],
                ['Contados (en al menos un área)', res.contados],
                ['Sin conteo (salen en 0)', res.pendientes],
                ['Total general (conv.)', res.total],
                ['Cómo se calcula el total', 'Botellas enteras + botellas abiertas convertidas a puntos de botella (según capacidad y peso). Es la misma conversión de Físico vs Sistema.']];
            areasInfo.forEach(function(a, i) { inf.push(['Total ' + a.nombre, res.porArea[i]]); });
            var wsI = X.utils.aoa_to_sheet(inf);
            wsI['!cols'] = [{ wch: 32 }, { wch: 100 }];
            var wb = X.utils.book_new();
            X.utils.book_append_sheet(wb, ws, 'Conteo activo');
            X.utils.book_append_sheet(wb, wsI, 'Información');
            wb.Props = { Title: 'Conteo activo BarInventory', Author: info.usuario || 'BarInventory', CreatedDate: new Date() };
            return wb;
        }

        // ── Capa de aplicación (lee el estado de la app; no escribe datos) ───

        var _cx = { abierto: false, areas: null, ocupado: false, cargando: null, previo: null, origen: null, lectura: null };

        function _cxAreasDisponibles() {
            var claves = (typeof AREAS_CONTEO !== 'undefined' && AREAS_CONTEO && AREAS_CONTEO.length) ? AREAS_CONTEO.slice() : ['almacen', 'barra1', 'barra2'];
            return claves.map(function(a) {
                var nom = (typeof areasAuditoria === 'object' && areasAuditoria && areasAuditoria[a]) ? areasAuditoria[a] : a;
                return { clave: a, nombre: String(nom) };
            });
        }

        /**
         * ¿Se ofrece exportar? Permiso de exportar + ver todos los conteos y:
         *   · sin `origen`: un inventario ABIERTO (el conteo activo);
         *   · con `origen` { inventoryId }: un inventario CERRADO/CONTABILIZADO, leído de su snapshot (necesita nube).
         */
        function conteoExportAplicable(origen) {
            if (typeof hasPermission !== 'function' || !hasPermission('inventory.export')) return false;
            if (typeof puedeVerConteosAjenos === 'function' && !puedeVerConteosAjenos()) return false;
            if (origen && origen.inventoryId) return typeof _db !== 'undefined' && !!_db;
            return typeof _inventarioActivo !== 'undefined' && !!_inventarioActivo
                && typeof inventarioAbierto === 'function' && !!inventarioAbierto(_inventarioActivo);
        }

        function _cxVersionApp() {
            var s = (typeof document !== 'undefined') ? document.querySelector('script[src*="97-exportar-conteo.js?v="]') : null;
            return s ? String(s.getAttribute('src')).split('?v=')[1] || '' : '';
        }

        /** Botón de la ventana Inventario (lo inserta renderAuditoriaSeleccion). Vacío si no aplica. */
        function conteoExportBotonHtml() {
            if (!conteoExportAplicable()) return '';
            return '<div class="cx-fila"><button type="button" id="cxAbrirBtn" class="bt bt--primario cx-btn" onclick="conteoExportAbrir()"'
                 + ' aria-haspopup="dialog" aria-label="Exportar o compartir el conteo activo en PDF o Excel">'
                 + '<i class="fa-solid fa-download" aria-hidden="true"></i> Exportar / Compartir conteo</button></div>';
        }

        /**
         * Botón «Descargar / Compartir» de un inventario CERRADO o CONTABILIZADO (la tarjeta de Contabilizar y el detalle del
         * Historial). Abre la misma hoja de opciones, con el conteo que quedó guardado al cierre. Vacío si no aplica.
         */
        function conteoExportBotonInventarioHtml(inventoryId, numero) {
            if (!inventoryId || !conteoExportAplicable({ inventoryId: inventoryId })) return '';
            return '<button type="button" class="bt bt--secundario cx-btn-inv" onclick="conteoExportAbrirInventario(\'' + jsArg(inventoryId) + '\', ' + (Number(numero) || 0) + ')"'
                 + ' aria-haspopup="dialog" aria-label="Descargar o compartir el inventario #' + (Number(numero) || 0) + ' en PDF o Excel">'
                 + '<i class="fa-solid fa-download" aria-hidden="true"></i> Descargar / Compartir</button>';
        }

        /** Carga jsPDF bajo demanda. Resuelve con el constructor o rechaza con un motivo legible. */
        function _cxCargarJsPdf() {
            if (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
            if (_cx.cargando) return _cx.cargando;
            _cx.cargando = new Promise(function(resolve, reject) {
                var s = document.createElement('script');
                var v = _cxVersionApp();
                s.src = 'js/jspdf.umd.min.js' + (v ? '?v=' + v : '');
                s.async = true;
                s.onload = function() {
                    if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
                    else { _cx.cargando = null; reject(new Error('La librería de PDF no se inicializó')); }
                };
                s.onerror = function() { _cx.cargando = null; reject(new Error('No se pudo cargar la librería de PDF (¿sin conexión?)')); };
                document.head.appendChild(s);
            });
            return _cx.cargando;
        }

        function conteoExportPrecargar() { _cxCargarJsPdf().catch(function() {}); }

        function _cxCerrarHoja() {
            var ov = document.getElementById('cxOverlay');
            if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
            document.removeEventListener('keydown', _cxTecla, true);
            _cx.abierto = false;
            if (_cx.previo && _cx.previo.focus) { try { _cx.previo.focus(); } catch (_) {} }
            _cx.previo = null;
        }
        function _cxTecla(e) { if (e.key === 'Escape' && _cx.abierto && !_cx.ocupado) { e.stopPropagation(); _cxCerrarHoja(); } }
        function conteoExportCerrar() { _cxCerrarHoja(); }

        function _cxHojaHtml() {
            var disp = _cxAreasDisponibles();
            var cerrado = !!(_cx.origen && _cx.origen.inventoryId);
            var num = cerrado ? _cx.origen.numero
                    : ((typeof _inventarioActivo !== 'undefined' && _inventarioActivo && _inventarioActivo.numero) ? _inventarioActivo.numero : '');
            var h = '<div class="cx-velo" onclick="conteoExportCerrar()"></div>'
                  + '<div class="cx-hoja" role="dialog" aria-modal="true" aria-labelledby="cxTit">'
                  + '<div class="cx-asa" aria-hidden="true"></div>'
                  + '<h2 id="cxTit" class="cx-tit">' + (cerrado ? 'Exportar inventario' + (num ? ' #' + escapeHtml(String(num)) : '') : 'Exportar conteo activo') + '</h2>'
                  + '<p class="cx-sub">' + (!cerrado && num ? 'Inventario #' + escapeHtml(String(num)) + ' · ' : '')
                  + (cerrado ? 'conteo al cierre' : 'conteo físico') + ' · incluye las botellas abiertas convertidas</p>'
                  + '<div class="cx-areas" role="group" aria-label="Áreas a incluir">';
            disp.forEach(function(a) {
                var on = _cx.areas.indexOf(a.clave) !== -1;
                h += '<button type="button" class="cx-area' + (on ? ' cx-area--on' : '') + '" aria-pressed="' + (on ? 'true' : 'false') + '"'
                   + ' onclick="conteoExportAlternarArea(\'' + jsArg(a.clave) + '\')"><span>' + escapeHtml(a.nombre) + '</span><small>'
                   + (on ? '✓ incluida' : 'no incluida') + '</small></button>';
            });
            var oc = _cx.ocupado ? ' disabled aria-busy="true"' : '';
            h += '</div>'
               + '<button type="button" class="cx-opc cx-opc--pri" onclick="conteoExportEjecutar(\'pdf\',\'descargar\')"' + oc + '>'
               + '<span class="cx-ico cx-ico--pdf">PDF</span><span class="cx-opc__t"><b>Descargar PDF</b><small>Hoja lista para imprimir · A4 vertical</small></span></button>'
               + '<div class="cx-par">'
               + '<button type="button" class="cx-opc" onclick="conteoExportEjecutar(\'pdf\',\'compartir\')"' + oc + '>'
               + '<span class="cx-ico cx-ico--pdf">PDF</span><span class="cx-opc__t"><b>Compartir PDF</b><small>WhatsApp, correo…</small></span></button>'
               + '<button type="button" class="cx-opc" onclick="conteoExportEjecutar(\'xlsx\',\'compartir\')"' + oc + '>'
               + '<span class="cx-ico cx-ico--xls">XLS</span><span class="cx-opc__t"><b>Compartir Excel</b><small>WhatsApp, correo…</small></span></button></div>'
               + '<button type="button" class="cx-opc" onclick="conteoExportEjecutar(\'xlsx\',\'descargar\')"' + oc + '>'
               + '<span class="cx-ico cx-ico--xls">XLS</span><span class="cx-opc__t"><b>Descargar Excel</b><small>Detalle por área: enteras, abiertas y total</small></span></button>'
               + '<p class="cx-nota" id="cxNota" role="status">' + (_cx.ocupado ? 'Generando el archivo…' : 'Si tu aparato no permite compartir archivos, se descarga.') + '</p>'
               + '<button type="button" class="cx-cerrar" onclick="conteoExportCerrar()">Cerrar</button></div>';
            return h;
        }

        function _cxPintarHoja() {
            var ov = document.getElementById('cxOverlay');
            if (ov) ov.innerHTML = _cxHojaHtml();
        }

        function conteoExportAbrir(origen) {
            if (origen && typeof origen !== 'object') origen = null;   // un clic por el despachador de eventos no trae argumentos útiles
            if (!conteoExportAplicable(origen)) { showNotification('⚠️ No tienes permiso para exportar el conteo' + (origen ? '' : ' o no hay un inventario abierto')); return; }
            if (document.getElementById('cxOverlay')) return;
            _cx.origen = origen && origen.inventoryId ? { inventoryId: String(origen.inventoryId), numero: origen.numero } : null;
            _cx.lectura = null;
            _cx.areas = _cxAreasDisponibles().map(function(a) { return a.clave; });
            _cx.previo = document.activeElement;
            var ov = document.createElement('div');
            ov.id = 'cxOverlay'; ov.className = 'cx-ov';
            document.body.appendChild(ov);
            _cx.abierto = true;
            _cxPintarHoja();
            document.addEventListener('keydown', _cxTecla, true);
            var primero = ov.querySelector('.cx-area'); if (primero && primero.focus) primero.focus();
            conteoExportPrecargar();
            if (_cx.origen) { _cx.lectura = _cxLeerSnapshot(_cx.origen); _cx.lectura.catch(function() {}); }   // se lee ya, para que Compartir no espere a la red
        }
        function conteoExportAbrirInventario(inventoryId, numero) { conteoExportAbrir({ inventoryId: inventoryId, numero: numero }); }

        function conteoExportAlternarArea(clave) {
            var i = _cx.areas.indexOf(clave);
            if (i === -1) _cx.areas.push(clave);
            else if (_cx.areas.length > 1) _cx.areas.splice(i, 1);
            else { showNotification('⚠️ Deja al menos un área incluida'); return; }
            // conservar el orden de las columnas = orden de las áreas de la app
            var orden = _cxAreasDisponibles().map(function(a) { return a.clave; });
            _cx.areas.sort(function(a, b) { return orden.indexOf(a) - orden.indexOf(b); });
            _cxPintarHoja();
        }

        /**
         * Lee el inventario CERRADO/CONTABILIZADO: su cabecera y el snapshot que se congeló al cerrar (inventories/{id} +
         * snapshotChunks, los mismos que usa el Historial). SOLO LEE. Devuelve una promesa { meta, registros }.
         */
        function _cxLeerSnapshot(origen) {
            if (typeof _db === 'undefined' || !_db) return Promise.reject(new Error('Sin conexión a la nube'));
            var ref = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID).collection('inventories').doc(origen.inventoryId);
            return Promise.all([ref.get(), _readChunkedSubcollection(ref, 'snapshotChunks')]).then(function(res) {
                var meta = res[0] && res[0].exists ? (res[0].data() || {}) : null;
                var registros = res[1] || [];
                if (!meta) throw new Error('No se encontró el inventario');
                if (!registros.length) throw new Error('No se encontró el snapshot de este inventario');
                return { meta: meta, registros: registros };
            });
        }

        /** Fecha corta es-MX de un sello de tiempo, o ''. */
        function _cxFecha(ms) { return ms ? new Date(ms).toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''; }

        /**
         * Foto de un inventario CERRADO/CONTABILIZADO: el conteo consolidado con la MISMA regla que el Excel del Historial
         * (_consolidarConteoCongelado) y la MISMA conversión de botellas abiertas (convertirOzAPuntos) aplicada con los datos
         * del producto congelados al cierre. Un área sin nada contado vale 0.
         */
        function _cxInstantaneaCerrada(origen) {
            // Si la lectura adelantada falló (red), se reintenta una vez antes de rendirse.
            var lectura = (_cx.lectura || _cxLeerSnapshot(origen)).catch(function() { return _cxLeerSnapshot(origen); });
            return lectura.then(function(d) {
                var meta = d.meta, registros = d.registros;
                var snapMeta = registros.filter(function(r) { return r.tipo === 'meta'; })[0] || {};
                var hist = (Array.isArray(snapMeta.warehousesSnapshot) && snapMeta.warehousesSnapshot.length) ? snapMeta.warehousesSnapshot
                         : ((Array.isArray(meta.warehousesSnapshot) && meta.warehousesSnapshot.length) ? meta.warehousesSnapshot : _cxAreasDisponibles().map(function(a) { return a.clave; }));
                var catalogo = (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];
                var prods = registros.filter(function(r) { return r.tipo === 'producto'; }).map(function(r) {
                    var nom = r.name || r.nombre || '';
                    if (!nom) { var vivo = catalogo.filter(function(p) { return p.id === r.id; })[0]; nom = vivo ? (vivo.name || '') : ''; }
                    return { id: r.id, name: nom, group: r.group || r.grupo || '', unit: r.unit || '',
                             capacidadMl: r.capacidadMl, pesoBotellaLlenaOz: r.pesoBotellaLlenaOz, conteoOzHabilitado: r.conteoOzHabilitado };
                });
                var usuarios = registros.filter(function(r) { return r.tipo === 'usuario'; });
                var agregado = _consolidarConteoCongelado(usuarios, hist, prods);
                var disp = _cxAreasDisponibles().filter(function(a) { return _cx.areas.indexOf(a.clave) !== -1; });
                var conteoDe = function(p) {
                    var out = { tocado: false, areas: {} };
                    var botella = (typeof tieneConversion === 'function') && tieneConversion(p);
                    disp.forEach(function(a) {
                        var x = agregado[p.id] ? agregado[p.id][a.clave] : null;
                        var abiertas = x && Array.isArray(x.abiertas) ? x.abiertas : [];
                        if (!x || (!(x.enteras > 0) && !abiertas.length)) { out.areas[a.clave] = null; return; }
                        var suma = 0;
                        abiertas.forEach(function(v) { suma += botella ? convertirOzAPuntos(v, p.capacidadMl, p.pesoBotellaLlenaOz) : (Number(v) || 0); });
                        out.tocado = true;
                        out.areas[a.clave] = { enteras: x.enteras || 0, abiertas: abiertas.slice(), total: _cxRed3((x.enteras || 0) + suma) };
                    });
                    return out;
                };
                var filas = conteoExportFilas(prods, conteoDe, disp.map(function(a) { return a.clave; }));
                var ahora = new Date();
                var perfil = (typeof _lastUserData !== 'undefined' && _lastUserData) ? _lastUserData : null;
                var usuario = (perfil && (perfil.displayName || perfil.email)) || '';
                var num = meta.numero || origen.numero || '';
                var contab = meta.estado === 'CONTABILIZADO';
                var fecha = ahora.toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
                var hora = ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                var destino = [meta.semanaDestino ? 'inicial de la semana ' + meta.semanaDestino : '', meta.mesDestino ? 'corte del mes ' + meta.mesDestino : '', meta.anclaDestino ? 'ancla del Total ' + meta.anclaDestino : ''].filter(Boolean).join(' · ');
                return {
                    filas: filas, areas: disp, ahora: ahora, nombreBase: 'Inventario_fisico_' + num,
                    info: {
                        titulo: 'Inventario físico #' + num + ' — ' + (contab ? 'Contabilizado' : 'Cerrado') + (meta.anulado ? ' (ANULADO)' : ''),
                        subtitulo: disp.map(function(a) { return a.nombre; }).join(' · ') + (destino ? '  |  ' + destino : ''),
                        derecha: ['Inventario #' + num + ' · ' + (contab ? 'contabilizado' : 'cerrado') + (meta.anulado ? ' · anulado' : ''),
                                  (meta.fechaCierre ? 'Cierre ' + _cxFecha(meta.fechaCierre) + ' · ' : '') + 'Generado ' + fecha + ' ' + hora,
                                  usuario ? 'Por ' + usuario : ''].filter(Boolean),
                        version: _cxVersionApp(), generado: fecha + ' ' + hora, usuario: usuario, inventario: '#' + num
                    }
                };
            });
        }

        /** Foto de datos para exportar: filas + áreas + info del encabezado (promesa). Lee, no escribe. */
        function _cxInstantanea() {
            if (_cx.origen && _cx.origen.inventoryId) return _cxInstantaneaCerrada(_cx.origen);
            try { return Promise.resolve(_cxInstantaneaActiva()); } catch (e) { return Promise.reject(e); }
        }

        /** Foto del conteo ACTIVO (inventario abierto). */
        function _cxInstantaneaActiva() {
            var disp = _cxAreasDisponibles().filter(function(a) { return _cx.areas.indexOf(a.clave) !== -1; });
            var filas = conteoExportFilas(typeof products !== 'undefined' && Array.isArray(products) ? products : [],
                                          function(p) { return fvsConteoPorArea(p.id); }, disp.map(function(a) { return a.clave; }));
            var ahora = new Date();
            var perfil = (typeof _lastUserData !== 'undefined' && _lastUserData) ? _lastUserData : null;
            var authU = null;
            try { authU = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null; } catch (_) { authU = null; }
            var inv = (typeof _inventarioActivo !== 'undefined' && _inventarioActivo) ? _inventarioActivo : {};
            var sem = '';
            try { if (typeof etiquetaSemana === 'function') sem = etiquetaSemana(typeof fechaISOLocal === 'function' ? fechaISOLocal(ahora) : ''); } catch (_) { sem = ''; }
            var fecha = ahora.toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
            var hora = ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
            var usuario = (perfil && (perfil.displayName || perfil.email)) || (authU && (authU.displayName || authU.email)) || '';
            return {
                filas: filas, areas: disp, ahora: ahora,
                info: {
                    titulo: 'Inventario físico — Conteo activo',
                    subtitulo: disp.map(function(a) { return a.nombre; }).join(' · '),
                    derecha: [(inv.numero ? 'Inventario #' + inv.numero + (sem ? ' · ' : '') : '') + sem, fecha + ' · ' + hora, usuario ? 'Generado por ' + usuario : ''].filter(Boolean),
                    version: _cxVersionApp(), generado: fecha + ' ' + hora, usuario: usuario,
                    inventario: inv.numero ? ('#' + inv.numero) : ''
                }
            };
        }

        function _cxEntregar(bytes, nombre, mime, accion) {
            var blob = new Blob([bytes], { type: mime });
            var descargar = function() {
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url; a.download = nombre; a.style.display = 'none';
                document.body.appendChild(a); a.click();
                setTimeout(function() { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
                return { ok: true, modo: 'descarga' };
            };
            if (accion !== 'compartir') return Promise.resolve(descargar());
            var archivo = null;
            try { archivo = new File([blob], nombre, { type: mime }); } catch (_) { archivo = null; }
            if (archivo && typeof navigator !== 'undefined' && typeof navigator.share === 'function'
                && typeof navigator.canShare === 'function' && navigator.canShare({ files: [archivo] })) {
                return navigator.share({ files: [archivo], title: nombre }).then(function() {
                    return { ok: true, modo: 'compartido' };
                }).catch(function(e) {
                    if (e && e.name === 'AbortError') return { ok: false, modo: 'cancelado' };   // la persona cerró el menú: no es un error
                    var r = descargar(); r.aviso = 'No se pudo abrir el menú de compartir; se descargó el archivo.'; return r;
                });
            }
            var r = descargar(); r.aviso = 'Tu aparato no permite compartir archivos; se descargó.';
            return Promise.resolve(r);
        }

        /**
         * conteoExportEjecutar(formato, accion) — formato: 'pdf' | 'xlsx'; accion: 'descargar' | 'compartir'.
         * Devuelve una promesa (las pruebas la esperan) con { ok, motivo?, nombre?, modo?, filas? }.
         */
        function conteoExportEjecutar(formato, accion) {
            if (_cx.ocupado) return Promise.resolve({ ok: false, motivo: 'en_curso' });
            if (!conteoExportAplicable(_cx.origen)) { showNotification('⚠️ No tienes permiso para exportar el conteo' + (_cx.origen ? '' : ' o no hay un inventario abierto')); return Promise.resolve({ ok: false, motivo: 'sin_permiso' }); }
            if (!_cx.areas || !_cx.areas.length) { showNotification('⚠️ Deja al menos un área incluida'); return Promise.resolve({ ok: false, motivo: 'sin_areas' }); }
            if (typeof products === 'undefined' || !Array.isArray(products) || !products.length) { showNotification('⚠️ No hay productos para exportar'); return Promise.resolve({ ok: false, motivo: 'sin_productos' }); }
            if (formato === 'xlsx' && typeof XLSX === 'undefined') { showNotification('⏳ Cargando la librería de Excel… intenta en unos segundos'); return Promise.resolve({ ok: false, motivo: 'sin_xlsx' }); }
            _cx.ocupado = true; _cxPintarHoja();
            var ext = formato === 'pdf' ? 'pdf' : 'xlsx';
            var mime = formato === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            var preparar = Promise.all([(formato === 'pdf') ? _cxCargarJsPdf() : null, _cxInstantanea()]);
            return preparar.then(function(par) {
                var J = par[0], foto = par[1];
                var nombre = conteoExportNombre(foto.ahora, ext, foto.nombreBase), bytes, paginas = null;
                if (formato === 'pdf') {
                    var r = conteoExportPdf(J, foto.filas, foto.areas, foto.info);
                    bytes = r.doc.output('arraybuffer'); paginas = r.paginas;
                } else {
                    var wb = conteoExportLibro(XLSX, foto.filas, foto.areas, foto.info);
                    bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
                    var fijo = (typeof existenciasExportCongelar === 'function') ? existenciasExportCongelar(XLSX, bytes, 1) : null;
                    if (fijo) bytes = fijo;
                }
                return _cxEntregar(bytes, nombre, mime, accion).then(function(e) {
                    _cx.ocupado = false;
                    if (e.ok) {
                        showNotification((e.aviso ? 'ℹ️ ' : '✅ ') + nombre + ' — ' + foto.filas.length + ' producto(s)' + (e.aviso ? ' · ' + e.aviso : ''));
                        _cxCerrarHoja();
                    } else { _cxPintarHoja(); }
                    return { ok: e.ok, modo: e.modo, nombre: nombre, filas: foto.filas.length, paginas: paginas, bytes: bytes.byteLength };
                });
            }).catch(function(e) {
                console.error('[ExportarConteo]', e);
                _cx.ocupado = false; _cxPintarHoja();
                showNotification('❌ No se pudo generar el archivo: ' + (e && e.message ? e.message : e));
                return { ok: false, motivo: 'error', mensaje: e && e.message };
            });
        }

        if (typeof window !== 'undefined') {
            window.conteoExportFilas      = conteoExportFilas;
            window.conteoExportResumen    = conteoExportResumen;
            window.conteoExportNombre     = conteoExportNombre;
            window.conteoExportPdf        = conteoExportPdf;
            window.conteoExportLibro      = conteoExportLibro;
            window.conteoExportAplicable  = conteoExportAplicable;
            window.conteoExportBotonHtml  = conteoExportBotonHtml;
            window.conteoExportAbrir      = conteoExportAbrir;
            window.conteoExportAbrirInventario = conteoExportAbrirInventario;
            window.conteoExportBotonInventarioHtml = conteoExportBotonInventarioHtml;
            window.conteoExportCerrar     = conteoExportCerrar;
            window.conteoExportAlternarArea = conteoExportAlternarArea;
            window.conteoExportEjecutar   = conteoExportEjecutar;
            window.conteoExportPrecargar  = conteoExportPrecargar;
        }
