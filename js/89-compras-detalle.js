        // ══════════════════════════════════════════════════════════════════════
        //  v5.18 — COMPRAS: DETALLE POR PROVEEDOR
        //  ────────────────────────────────────────────────────────────────────
        //  Pedido de Eduardo (6-oct-2026): "Cada tarjeta del proveedor de las
        //  compras importadas, al seleccionar, muestre en una ventana todos los
        //  productos que se ingresaron por proveedor."
        //
        //  La ventana tiene dos partes:
        //    1. Los productos de ESA entrada (folio / Doc SAP): cantidad en la
        //       unidad del documento, cantidad que sumó al inventario, costo e
        //       importe, y si el código está o no en el catálogo.
        //    2. "Todo lo recibido de este proveedor": la suma por producto de
        //       TODAS las compras de ese proveedor que hay en el dispositivo
        //       (la app carga la semana en curso y la anterior; la ventana lo
        //       dice para que nadie lo tome por un histórico completo).
        //
        //  Solo lectura: no escribe nada, ni en Firestore ni en el dispositivo.
        // ══════════════════════════════════════════════════════════════════════

        function _cdRed(n, d) {
            var f = Math.pow(10, d === undefined ? 3 : d);
            var x = Number(n);
            return isFinite(x) ? Math.round(x * f) / f : 0;
        }

        /** Clave del proveedor: el código si existe, si no el nombre normalizado. */
        function _cdClaveProveedor(c) {
            if (!c) return '';
            if (c.proveedorCodigo) return 'cod:' + String(c.proveedorCodigo).trim();
            return 'nom:' + String(c.proveedorNombre || 'Sin proveedor').trim().toUpperCase();
        }

        /**
         * comprasDetalleDatos(compra, todas, productos) — capa pura.
         * Devuelve las líneas de la compra y el acumulado del proveedor.
         */
        function comprasDetalleDatos(compra, todas, productos) {
            var porId = {};
            (productos || []).forEach(function(p) { if (p && p.id) porId[String(p.id)] = p; });
            var lineas = (compra && Array.isArray(compra.lineas) ? compra.lineas : []).map(function(l) {
                var p = porId[String(l.productoId)];
                return {
                    productoId: String(l.productoId || ''),
                    nombre: p ? (p.name || l.productoId) : (l.descripcionSap || l.productoId || '—'),
                    descripcionSap: l.descripcionSap || '',
                    cantidadDocumento: _cdRed(l.cantidadDocumento),
                    unidadDocumento: l.unidadDocumento || '',
                    cantidadInventario: _cdRed(l.cantidadInventario),
                    unidadInventario: p ? (p.unit || '') : '',
                    costoUnitario: (typeof l.costoUnitario === 'number') ? l.costoUnitario : null,
                    importe: (typeof l.importe === 'number') ? _cdRed(l.importe, 2) : null,
                    enCatalogo: l.enCatalogo !== false
                };
            });
            lineas.sort(function(a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });

            var clave = _cdClaveProveedor(compra);
            var mismas = (todas || []).filter(function(c) { return _cdClaveProveedor(c) === clave; });
            var acc = {};
            mismas.forEach(function(c) {
                (Array.isArray(c.lineas) ? c.lineas : []).forEach(function(l) {
                    var id = String(l.productoId || '');
                    if (!id) return;
                    var p = porId[id];
                    var a = acc[id] || (acc[id] = {
                        productoId: id, nombre: p ? (p.name || id) : (l.descripcionSap || id),
                        unidad: p ? (p.unit || '') : (l.unidadDocumento || ''),
                        cantidad: 0, importe: 0, entradas: 0, folios: {},
                        ultimoCosto: null, ultimaFecha: '', enCatalogo: l.enCatalogo !== false
                    });
                    a.cantidad += Number(l.cantidadInventario) || 0;
                    a.importe  += Number(l.importe) || 0;
                    var folio = String(c.compraId || c.folio || '');
                    if (!a.folios[folio]) { a.folios[folio] = true; a.entradas++; }
                    var f = String(c.fecha || '');
                    if (f >= a.ultimaFecha && typeof l.costoUnitario === 'number') { a.ultimaFecha = f; a.ultimoCosto = l.costoUnitario; }
                });
            });
            var acumulado = Object.keys(acc).map(function(k) {
                var a = acc[k];
                return { productoId: a.productoId, nombre: a.nombre, unidad: a.unidad, cantidad: _cdRed(a.cantidad),
                         importe: _cdRed(a.importe, 2), entradas: a.entradas, ultimoCosto: a.ultimoCosto,
                         ultimaFecha: a.ultimaFecha, enCatalogo: a.enCatalogo };
            }).sort(function(a, b) { return b.importe - a.importe; });

            var fechas = mismas.map(function(c) { return String(c.fecha || ''); }).filter(Boolean).sort();
            return {
                proveedor: (compra && compra.proveedorNombre) || 'Sin proveedor',
                proveedorCodigo: (compra && compra.proveedorCodigo) || '',
                lineas: lineas,
                totalLineas: lineas.length,
                importeCompra: _cdRed(lineas.reduce(function(s, l) { return s + (l.importe || 0); }, 0), 2),
                acumulado: acumulado,
                documentosProveedor: mismas.length,
                importeProveedor: _cdRed(acumulado.reduce(function(s, a) { return s + a.importe; }, 0), 2),
                desde: fechas[0] || '', hasta: fechas[fechas.length - 1] || ''
            };
        }

        function _cdMoneda(n) {
            if (typeof n !== 'number' || !isFinite(n)) return '—';
            return (typeof _dineroMX === 'function') ? _dineroMX(n) : '$' + n.toFixed(2);
        }

        function _cdFecha(iso) {
            return (typeof _fechaLarga === 'function') ? _fechaLarga(iso) : String(iso || '—');
        }

        /** Abre la ventana con el detalle de una compra y su proveedor. */
        function comprasVerDetalle(compraId) {
            var lista = (typeof compras !== 'undefined' && Array.isArray(compras)) ? compras : [];
            var c = lista.find(function(x) { return String(x.compraId) === String(compraId); });
            if (!c) { showNotification('⚠️ No se encontró esa compra en este dispositivo'); return; }
            comprasCerrarDetalle();
            var d = comprasDetalleDatos(c, lista, (typeof products !== 'undefined') ? products : []);

            var h = '<div class="pm-ficha" role="dialog" aria-modal="true" aria-labelledby="cd-titulo">'
                  + '<div class="pm-ficha__caja">'
                  + '<div class="pm-ficha__cab"><div class="cd-cab__txt">'
                  + '<div id="cd-titulo" class="pm-ficha__titulo">' + escapeHtml(d.proveedor) + '</div>'
                  + '<div class="pm-ficha__sub">' + (d.proveedorCodigo ? 'Código ' + escapeHtml(d.proveedorCodigo) + ' · ' : '')
                  + 'Folio ' + escapeHtml(String(c.folio || '—')) + (c.docSap ? ' · Doc SAP ' + escapeHtml(String(c.docSap)) : '')
                  + ' · ' + escapeHtml(_cdFecha(c.fecha)) + '</div></div>'
                  + '<button type="button" class="pm-ficha__x" data-cd-cerrar aria-label="Cerrar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>';

            // ── 1 · Esta entrada ───────────────────────────────────────────
            h += '<div class="pm-ficha__sec">Productos de esta entrada</div>'
               + '<div class="cd-resumen"><span><b class="num">' + d.totalLineas + '</b> producto' + (d.totalLineas === 1 ? '' : 's') + '</span>'
               + '<span>Importe <b class="num">' + _cdMoneda(d.importeCompra) + '</b></span></div>';
            if (!d.lineas.length) {
                h += '<div class="pm-card__sub">Esta compra no tiene líneas.</div>';
            } else {
                h += '<ul class="cd-lista" role="list">';
                d.lineas.forEach(function(l) {
                    h += '<li class="cd-item">'
                       + '<div class="cd-item__nom">' + escapeHtml(l.nombre)
                       + (l.enCatalogo ? '' : ' <span class="cd-tag cd-tag--warn">no está en el catálogo</span>')
                       + '<div class="cd-item__meta">' + escapeHtml(l.productoId)
                       + (l.descripcionSap && l.descripcionSap !== l.nombre ? ' · ' + escapeHtml(l.descripcionSap) : '') + '</div></div>'
                       + '<div class="cd-item__cifras">'
                       + '<div class="num">' + l.cantidadDocumento + ' ' + escapeHtml(l.unidadDocumento) + '</div>'
                       + (l.unidadInventario && l.cantidadInventario !== l.cantidadDocumento
                          ? '<div class="cd-item__meta num">+' + l.cantidadInventario + ' ' + escapeHtml(l.unidadInventario) + ' al inventario</div>' : '')
                       + '<div class="cd-item__meta num">' + _cdMoneda(l.costoUnitario) + ' c/u · <b>' + _cdMoneda(l.importe) + '</b></div>'
                       + '</div></li>';
                });
                h += '</ul>';
            }

            // ── 2 · Todo lo recibido de este proveedor ──────────────────────
            h += '<div class="pm-ficha__sec">Todo lo recibido de este proveedor</div>'
               + '<div class="pm-card__sub">' + d.documentosProveedor + ' entrada' + (d.documentosProveedor === 1 ? '' : 's')
               + (d.desde ? ' del ' + escapeHtml(_cdFecha(d.desde)) + (d.hasta && d.hasta !== d.desde ? ' al ' + escapeHtml(_cdFecha(d.hasta)) : '') : '')
               + ' · ' + _cdMoneda(d.importeProveedor)
               + '. Incluye las compras cargadas en este dispositivo (semana en curso y anterior).</div>';
            if (d.acumulado.length) {
                h += '<ul class="cd-lista" role="list">';
                d.acumulado.forEach(function(a) {
                    h += '<li class="cd-item">'
                       + '<div class="cd-item__nom">' + escapeHtml(a.nombre)
                       + '<div class="cd-item__meta">' + a.entradas + ' entrada' + (a.entradas === 1 ? '' : 's')
                       + (a.ultimoCosto !== null ? ' · último costo ' + _cdMoneda(a.ultimoCosto) : '') + '</div></div>'
                       + '<div class="cd-item__cifras"><div class="num">' + a.cantidad + ' ' + escapeHtml(a.unidad) + '</div>'
                       + '<div class="cd-item__meta num">' + _cdMoneda(a.importe) + '</div></div></li>';
                });
                h += '</ul>';
            }
            h += '<div class="pm-ficha__acc"><button type="button" class="pm-btn" data-cd-cerrar>Cerrar</button></div>';
            h += '</div></div>';

            var wrap = document.createElement('div');
            wrap.id = 'cd-wrap';
            wrap.setAttribute('data-compra', String(compraId));
            wrap.innerHTML = h;
            wrap.addEventListener('click', function(e) {
                if (e.target === wrap.firstChild || (e.target.closest && e.target.closest('[data-cd-cerrar]'))) comprasCerrarDetalle();
            });
            document.body.appendChild(wrap);
            document.body.classList.add('modal-open');
            var x = wrap.querySelector('.pm-ficha__x');
            if (x) x.focus();
        }

        function comprasCerrarDetalle() {
            var w = document.getElementById('cd-wrap');
            if (w) { w.remove(); document.body.classList.remove('modal-open'); }
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && document.getElementById('cd-wrap')) comprasCerrarDetalle();
        });

        window.comprasDetalleDatos  = comprasDetalleDatos;
        window.comprasVerDetalle    = comprasVerDetalle;
        window.comprasCerrarDetalle = comprasCerrarDetalle;
