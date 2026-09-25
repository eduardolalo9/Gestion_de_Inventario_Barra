        // ═════════════════════════════════════════════════════════════════════
        //  PANEL PREMIUM — indicadores, gráficas y ficha de producto
        //  ───────────────────────────────────────────────────────────────────
        //  SOLO LECTURA. Este módulo no escribe nada: ni catálogo, ni conteos,
        //  ni compras. Lee lo que la app ya tiene en memoria (products,
        //  compras, movimientos, costosUltimos, _inventarioActivo) y, una vez
        //  por semana y sesión, el inventario inicial contabilizado
        //  (inventariosIniciales/{semanaId}, legible por cualquier usuario).
        //
        //  Gráficas en SVG en línea, sin librerías: la app es offline-first y
        //  una librería de gráficas por CDN no cargaría sin señal.
        //
        //  Existencia de la semana = inicial contabilizado + entradas por
        //  compras de esta semana. NO descuenta ventas: el módulo de ventas
        //  todavía no existe (FASE 10). Se dice así en pantalla, para que nadie
        //  lo confunda con un stock teórico.
        // ═════════════════════════════════════════════════════════════════════

        var PANEL_TOP = 8;

        // FASE 8 — el panel ya no guarda su propia copia del inicial ni su
        // propia forma de sumar compras: pregunta a la capa de existencia
        // (47-existencia.js). Una sola lectura de Firestore y un solo número,
        // compartidos con el catálogo, el buscador y la ficha.
        function _panelSemanaHoy() {
            return existenciaSemanaHoy();
        }

        function _panelMoneda(n) {
            try { return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }); }
            catch (_) { return '$' + Math.round(n); }
        }

        function _panelNum(n) {
            return String(Math.round((n || 0) * 100) / 100);
        }

        // Pide el inicial a la capa de existencia y se repinta cuando llegue.
        function _panelCargarInicial() {
            existenciaCargarInicial(_panelRepintar);
        }

        function _panelInicialEstado() {
            return existenciaInicialEstado();
        }

        function _panelRepintar() {
            var el = document.getElementById('pm-panel');
            if (el && typeof activeTab !== 'undefined' && activeTab === 'inicio') el.outerHTML = renderPanelInicio();
            // Si la ficha está abierta cuando llega el inicial, se vuelve a
            // dibujar: sin esto se quedaría con "—" en la comparación aunque el
            // dato ya esté en memoria.
            var f = document.getElementById('pm-ficha-wrap');
            if (f && f.getAttribute('data-pid')) abrirFichaProducto(f.getAttribute('data-pid'));
        }

        // Entradas por compras de la semana, por producto.
        function _panelEntradasSemana() {
            return existenciaEntradasSemana();
        }

        function _panelComprasSemana() {
            var sem = _panelSemanaHoy();
            return (typeof compras !== 'undefined' ? compras : []).filter(function(c) { return c && c.semanaId === sem; });
        }

        function _panelIndicadores() {
            var conPrecio = 0, valor = 0, bajo = [];
            products.forEach(function(p) {
                var st = existenciaMostrada(p);
                if (typeof p.precio === 'number') { conPrecio++; valor += st * p.precio; }
                if (typeof _bajoMinimo === 'function' && _bajoMinimo(p)) bajo.push(p);
            });
            var cs = _panelComprasSemana();
            return {
                productos:   products.length,
                bajo:        bajo,
                valor:       valor,
                conPrecio:   conPrecio,
                comprasN:    cs.length,
                comprasImp:  cs.reduce(function(a, c) { return a + (c.importe || 0); }, 0),
                carrito:     (typeof cart !== 'undefined' ? cart : []).reduce(function(s, c) { return s + (c.quantity || 1); }, 0),
                pedidos:     (typeof orders !== 'undefined' ? orders : []).length
            };
        }

        // ── Gráfica de barras horizontales (SVG en línea) ───────────────────
        // filas: [{ id, etiqueta, valor, max, texto, estado: 'critico'|'aviso'|null }]
        function _panelBarras(filas, titulo, ayuda) {
            if (!filas.length) return '';
            var h = '<figure class="pm-graf">';
            h += '<figcaption class="pm-graf__titulo">' + escapeHtml(titulo) + '</figcaption>';
            if (ayuda) h += '<div class="pm-graf__ayuda">' + escapeHtml(ayuda) + '</div>';
            h += '<div class="pm-barras" role="list">';
            filas.forEach(function(f) {
                var pct = f.max > 0 ? Math.max(2, Math.min(100, f.valor / f.max * 100)) : 0;
                var cls = f.estado === 'critico' ? ' pm-barra--critico' : (f.estado === 'aviso' ? ' pm-barra--aviso' : '');
                var ico = f.estado === 'critico' ? '⛔ ' : (f.estado === 'aviso' ? '⚠️ ' : '');
                h += '<button type="button" class="pm-barra' + cls + '" role="listitem"'
                   + (f.id ? ' data-pm-ficha="' + escapeHtml(f.id) + '"' : '')
                   + ' title="' + escapeHtml(f.etiqueta + ': ' + f.texto) + '">';
                h += '<span class="pm-barra__etq">' + ico + escapeHtml(f.etiqueta) + '</span>';
                h += '<svg class="pm-barra__svg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">'
                   + '<rect class="pm-barra__fondo" x="0" y="2" width="100" height="6" rx="3"></rect>'
                   + '<rect class="pm-barra__valor" x="0" y="2" width="' + pct.toFixed(1) + '" height="6" rx="3"></rect></svg>';
                h += '<span class="pm-barra__txt">' + escapeHtml(f.texto) + '</span>';
                h += '</button>';
            });
            h += '</div></figure>';
            return h;
        }

        function _panelTile(icono, valor, etiqueta, extra) {
            extra = extra || {};
            var tag = extra.accion ? 'button type="button" onclick="' + extra.accion + '"' : 'div';
            var cierre = extra.accion ? 'button' : 'div';
            return '<' + tag + ' class="pm-tile' + (extra.clase ? ' ' + extra.clase : '') + '">'
                 + '<span class="pm-tile__ico" aria-hidden="true">' + icono + '</span>'
                 + '<span class="pm-tile__val">' + valor + '</span>'
                 + '<span class="pm-tile__etq">' + escapeHtml(etiqueta) + '</span>'
                 + (extra.sub ? '<span class="pm-tile__sub">' + escapeHtml(extra.sub) + '</span>' : '')
                 + '</' + cierre + '>';
        }

        function _panelEstadoInventario() {
            var inv = (typeof _inventarioActivo !== 'undefined') ? _inventarioActivo : null;
            var h = '<div class="pm-inv">';
            if (!inv) {
                h += '<div><div class="pm-inv__titulo">Sin inventario físico abierto</div>'
                   + '<div class="pm-inv__sub">' + (isAdmin() ? 'Créalo desde Conteo para que el equipo empiece.' : 'El administrador aún no lo abre.') + '</div></div>';
            } else {
                var contados = {};
                Object.values(typeof allUsersAuditoria !== 'undefined' ? allUsersAuditoria : {}).forEach(function(u) {
                    Object.keys(u.conteo || {}).forEach(function(pid) { contados[pid] = 1; });
                });
                var n = Object.keys(contados).length;
                var pct = products.length ? Math.min(100, Math.round(n / products.length * 100)) : 0;
                var cerrado = inv.estado !== 'SINCRONIZADO';
                h += '<div style="flex:1;min-width:0;"><div class="pm-inv__titulo">Inventario #' + escapeHtml(String(inv.numero || '—'))
                   + ' · <span class="pm-estado ' + (cerrado ? 'pm-estado--cerrado' : 'pm-estado--abierto') + '">' + escapeHtml(inv.estado) + '</span></div>'
                   + '<div class="pm-inv__sub">' + n + ' de ' + products.length + ' productos contados</div>'
                   + '<div class="pm-progreso"><div class="pm-progreso__barra" style="width:' + pct + '%;"></div></div></div>';
            }
            h += '<button type="button" class="pm-btn" onclick="switchTab(\'inventario\')">Ir a Conteo →</button>';
            h += '</div>';
            return h;
        }

        function _panelExistenciaSemana() {
            _panelCargarInicial();
            var est = _panelInicialEstado();
            var ent = _panelEntradasSemana();
            var nEnt = Object.keys(ent).length;
            var h = '<div class="pm-card">';
            h += '<div class="pm-card__titulo">📦 Existencia de la semana</div>';
            if (est.estado === 'cargando' || est.estado === 'sin_cargar') {
                h += '<div class="pm-card__sub">Cargando inventario inicial…</div>';
            } else if (est.estado === 'ok') {
                var s = est.saldos || {};
                var ids = Object.keys(s);
                var total = ids.reduce(function(a, k) { return a + (s[k] || 0); }, 0);
                var o = est.origen || {};
                h += '<div class="pm-card__fila"><span>Inicial (inventario #' + escapeHtml(String(o.numero || '—')) + ')</span><b>' + _panelNum(total) + ' u · ' + ids.length + ' productos</b></div>';
                h += '<div class="pm-card__fila"><span>Entradas por compras</span><b>' + nEnt + ' productos</b></div>';
                h += '<div class="pm-card__sub">Toca un producto para ver su existencia. Aún no descuenta ventas (el módulo de ventas es una fase pendiente).</div>';
            } else if (est.estado === 'no_existe') {
                h += '<div class="pm-card__sub">Esta semana todavía no tiene inventario inicial. Se crea al <b>contabilizar</b> el inventario cerrado del domingo: en Conteo, botón 📘 Contabilizar.</div>';
                if (nEnt) h += '<div class="pm-card__fila"><span>Entradas por compras</span><b>' + nEnt + ' productos</b></div>';
            } else {
                h += '<div class="pm-card__sub">No se pudo consultar el inventario inicial (¿sin conexión?).</div>';
            }
            h += '</div>';
            return h;
        }

        // ── Comparación de las dos cifras (semana de observación, FASE 8) ────
        // Mientras EXISTENCIA_FUENTE_OFICIAL_ACTIVA siga en false, esta tarjeta
        // es el punto de la app donde se ve si las dos formas de contar lo
        // mismo coinciden. No decide nada: informa para poder decidir.
        function _panelComparacion() {
            _panelCargarInicial();
            var est = _panelInicialEstado();
            var h = '<div class="pm-card pm-card--compara">';
            h += '<div class="pm-card__titulo">🔍 Comparación de existencias</div>';

            if (est.estado === 'cargando' || est.estado === 'sin_cargar') {
                h += '<div class="pm-card__sub">Cargando el inventario inicial para comparar…</div></div>';
                return h;
            }
            if (est.estado === 'no_existe') {
                h += '<div class="pm-card__sub">No se puede comparar todavía: esta semana no tiene inventario inicial. '
                   + 'Se crea al <b>contabilizar</b> el inventario cerrado del domingo.</div></div>';
                return h;
            }
            if (est.estado !== 'ok') {
                h += '<div class="pm-card__sub">No se pudo leer el inventario inicial (¿sin conexión?).</div></div>';
                return h;
            }

            var c = existenciaComparacion();
            h += '<div class="pm-card__sub">Operativa (conteo continuo) contra oficial (inicial + compras'
               + (Object.keys(existenciaVentasSemana()).length ? ' − ventas' : ', aún sin ventas') + '). '
               + 'Manda la operativa hasta que confirmes el cambio.</div>';
            h += '<div class="pm-card__fila"><span>Coinciden</span><b>' + c.coinciden + ' de ' + c.comparados + '</b></div>';
            h += '<div class="pm-card__fila"><span>Difieren</span><b'
               + (c.difieren ? ' class="pm-dif"' : '') + '>' + c.difieren + '</b></div>';
            if (c.sinInicial) {
                h += '<div class="pm-card__fila"><span>Sin inicial <small>(no comparables)</small></span><b>' + c.sinInicial + '</b></div>';
            }

            if (c.filas.length) {
                var maxAbs = Math.abs(c.filas[0].dif) || 1;
                var filas = c.filas.slice(0, PANEL_TOP).map(function(f) {
                    var ref = Math.max(Math.abs(f.operativa), Math.abs(f.oficial), 1);
                    return {
                        id: f.id,
                        etiqueta: f.nombre,
                        valor: Math.abs(f.dif),
                        max: maxAbs,
                        texto: _panelNum(f.operativa) + ' → ' + _panelNum(f.oficial)
                               + ' (' + (f.dif > 0 ? '+' : '') + _panelNum(f.dif) + ')',
                        // Crítico = la diferencia pesa más de la cuarta parte de
                        // la cifra: ahí ya no es un redondeo, es otra historia.
                        estado: (Math.abs(f.dif) / ref) > 0.25 ? 'critico' : 'aviso'
                    };
                });
                h += _panelBarras(filas, 'Mayores diferencias',
                        c.filas.length > PANEL_TOP ? 'Las ' + PANEL_TOP + ' mayores de ' + c.filas.length : null);
            } else if (c.comparados) {
                h += '<div class="pm-card__sub">✅ Las dos cifras coinciden en los ' + c.comparados + ' productos comparables.</div>';
            }
            h += '</div>';
            return h;
        }

        /** Panel de la pestaña Inicio. */
        function renderPanelInicio() {
            var k = _panelIndicadores();
            var h = '<section id="pm-panel" class="pm-panel" aria-label="Panel de indicadores">';

            h += '<div class="pm-tiles">';
            h += _panelTile('📦', k.productos, 'Productos', { accion: "switchTab('productos')" });
            h += _panelTile(k.bajo.length ? '⛔' : '✅', k.bajo.length, 'Bajo mínimo',
                    { clase: k.bajo.length ? 'pm-tile--critico' : 'pm-tile--ok',
                      accion: k.bajo.length ? 'panelVerBajoMinimo()' : null });
            h += _panelTile('💰', k.conPrecio ? _panelMoneda(k.valor) : '—', 'Valor en existencia',
                    { sub: k.conPrecio < k.productos ? (k.productos - k.conPrecio) + ' sin precio' : null });
            h += _panelTile('🧾', k.comprasN ? _panelMoneda(k.comprasImp) : '0', 'Compras esta semana',
                    { sub: k.comprasN + ' documento' + (k.comprasN === 1 ? '' : 's'), accion: "switchTab('compras')" });
            h += _panelTile('🛒', k.carrito, 'En carrito', { accion: 'openOrderModal()' });
            h += _panelTile('📋', k.pedidos, 'Pedidos', { accion: "switchTab('pedidos')" });
            h += '</div>';

            h += _panelEstadoInventario();

            // Bajo mínimo: existencia como fracción del mínimo (peores primero)
            var filasBajo = k.bajo.map(function(p) {
                var st = existenciaMostrada(p);
                return { id: p.id, etiqueta: p.name || p.id, valor: st, max: p.stockMinimo,
                         texto: _panelNum(st) + ' / ' + _panelNum(p.stockMinimo),
                         estado: st <= p.stockMinimo * 0.5 ? 'critico' : 'aviso', r: p.stockMinimo ? st / p.stockMinimo : 0 };
            }).sort(function(a, b) { return a.r - b.r; }).slice(0, PANEL_TOP);
            h += '<div class="pm-grafs">';
            h += filasBajo.length
                ? _panelBarras(filasBajo, 'Bajo mínimo — existencia / mínimo', k.bajo.length > PANEL_TOP ? 'Los ' + PANEL_TOP + ' más urgentes de ' + k.bajo.length : null)
                : '<div class="pm-card"><div class="pm-card__titulo">✅ Sin productos bajo mínimo</div><div class="pm-card__sub">Ningún producto con mínimo definido está por debajo.</div></div>';

            // Productos por grupo (magnitud, un solo tono)
            var grupos = {};
            products.forEach(function(p) { var g = p.group || 'General'; grupos[g] = (grupos[g] || 0) + 1; });
            var filasG = Object.keys(grupos).map(function(g) { return { etiqueta: g, valor: grupos[g] }; })
                .sort(function(a, b) { return b.valor - a.valor; });
            var maxG = filasG.length ? filasG[0].valor : 0;
            filasG = filasG.slice(0, PANEL_TOP).map(function(f) { return { etiqueta: f.etiqueta, valor: f.valor, max: maxG, texto: String(f.valor) }; });
            h += _panelBarras(filasG, 'Productos por grupo', null);
            h += '</div>';

            h += _panelExistenciaSemana();
            h += _panelComparacion();
            h += '</section>';
            return h;
        }

        // Activa el chip "Bajo mínimo" del catálogo y lleva la vista a la lista.
        function panelVerBajoMinimo() {
            if (!BusquedaUI.filtroActivo('catalogo', 'bajoMin')) {
                var chip = document.querySelector('[data-sbx-filtro="bajoMin"]');
                if (chip) chip.click();
            }
            var reg = document.getElementById('sbx-res-catalogo');
            if (reg && reg.scrollIntoView) reg.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // ── Ficha de producto ───────────────────────────────────────────────

        function abrirFichaProducto(pid) {
            var p = products.find(function(x) { return x.id === pid; });
            if (!p) return;
            cerrarFichaProducto();
            var areasF = (typeof AREAS_CONTEO !== 'undefined' && AREAS_CONTEO.length) ? AREAS_CONTEO : ['almacen', 'barra1', 'barra2'];
            var etq = function(a) { return (typeof areasAuditoria !== 'undefined' && areasAuditoria[a]) || (typeof areas !== 'undefined' && areas[a]) || a; };
            var st = getTotalStock(p);
            var bajo = typeof _bajoMinimo === 'function' && _bajoMinimo(p);
            var costo = (typeof costosUltimos !== 'undefined' && costosUltimos && costosUltimos[pid]) || null;
            _panelCargarInicial();
            var ofic = existenciaOficial(p);
            var ent  = ofic.entradas;
            var ini  = ofic.hayInicial ? ofic.inicial : undefined;

            var h = '<div class="pm-ficha" role="dialog" aria-modal="true" aria-labelledby="pm-ficha-titulo">';
            h += '<div class="pm-ficha__caja">';
            h += '<div class="pm-ficha__cab"><div style="min-width:0;flex:1;"><div id="pm-ficha-titulo" class="pm-ficha__titulo">' + escapeHtml(p.name || pid) + '</div>'
               + '<div class="pm-ficha__sub">' + escapeHtml(p.group || 'General') + ' · ' + escapeHtml(p.unit || '') + ' · ID ' + escapeHtml(pid)
               + (p.pv ? ' · PV ' + escapeHtml(p.pv) : '') + '</div></div>'
               + '<button type="button" class="pm-ficha__x" data-pm-cerrar aria-label="Cerrar">✕</button></div>';

            h += '<div class="pm-ficha__sec">Existencia actual por área</div><div class="pm-ficha__areas">';
            areasF.forEach(function(a) {
                h += '<div class="pm-ficha__area"><span>' + escapeHtml(etq(a)) + '</span><b>' + _panelNum((p.stockByArea || {})[a] || 0) + '</b></div>';
            });
            h += '</div>';
            h += '<div class="pm-card__fila"><span>Total</span><b>' + _panelNum(st) + (bajo ? ' <span class="pm-estado pm-estado--critico">⛔ bajo mínimo</span>' : '') + '</b></div>';
            if (typeof p.stockMinimo === 'number') h += '<div class="pm-card__fila"><span>Mínimo</span><b>' + _panelNum(p.stockMinimo) + '</b></div>';
            if (typeof p.precio === 'number') h += '<div class="pm-card__fila"><span>Precio</span><b>' + _panelMoneda(p.precio) + '</b></div>';
            if (costo) h += '<div class="pm-card__fila"><span>Último costo</span><b>' + _panelMoneda(Number(costo.costo) || 0) + ' <small>(' + escapeHtml(costo.fecha || '') + ')</small></b></div>';

            h += '<div class="pm-ficha__sec">Semana actual</div>';
            h += '<div class="pm-card__fila"><span>Inicial contabilizado</span><b>' + (ini === undefined ? '—' : _panelNum(ini)) + '</b></div>';
            h += '<div class="pm-card__fila"><span>Entradas por compras</span><b>' + _panelNum(ent) + '</b></div>';
            if (ini !== undefined) {
                // Las dos cifras juntas, con su diferencia. Es el punto en el
                // que se ve, producto por producto, si el conteo operativo y el
                // arrastre semanal cuentan lo mismo.
                var dif = Math.round((ofic.valor - st) * 1000) / 1000;
                h += '<div class="pm-ficha__sec">Las dos cifras</div>';
                h += '<div class="pm-card__fila"><span>Operativa <small>(conteo por área)</small></span><b>' + _panelNum(st) + '</b></div>';
                h += '<div class="pm-card__fila"><span>Oficial <small>(inicial + entradas, sin ventas)</small></span><b>' + _panelNum(ofic.valor) + '</b></div>';
                h += '<div class="pm-card__fila"><span>Diferencia</span><b' + (dif ? ' class="pm-dif"' : '') + '>'
                   + (dif > 0 ? '+' : '') + _panelNum(dif) + '</b></div>';
                if (!EXISTENCIA_FUENTE_OFICIAL_ACTIVA) {
                    h += '<div class="pm-card__sub">Por ahora manda la operativa. La oficial se muestra para comprobarla antes de cambiar la fuente.</div>';
                }
            } else {
                h += '<div class="pm-card__sub">Sin inicial contabilizado para este producto esta semana: no hay arrastre con el que comparar.</div>';
            }

            var lineas = [];
            (typeof compras !== 'undefined' ? compras : []).forEach(function(c) {
                (Array.isArray(c.lineas) ? c.lineas : []).forEach(function(l) {
                    if (l.productoId === pid) lineas.push({ fecha: c.fecha || '', prov: c.proveedorNombre || '', cant: l.cantidadInventario || 0, costo: l.costoUnitario });
                });
            });
            lineas.sort(function(a, b) { return a.fecha < b.fecha ? 1 : -1; });
            h += '<div class="pm-ficha__sec">Compras recientes (semana actual y anterior)</div>';
            if (!lineas.length) {
                h += '<div class="pm-card__sub">Sin compras registradas de este producto en las últimas dos semanas.</div>';
            } else {
                h += '<div class="pm-ficha__compras">';
                lineas.slice(0, 12).forEach(function(l) {
                    h += '<div class="pm-card__fila"><span>' + escapeHtml(l.fecha) + ' · ' + escapeHtml(l.prov) + '</span><b>+' + _panelNum(l.cant)
                       + (typeof l.costo === 'number' ? ' · ' + _panelMoneda(l.costo) : '') + '</b></div>';
                });
                h += '</div>';
            }

            h += '<div class="pm-ficha__acc">';
            h += '<button type="button" class="pm-btn pm-btn--primario" data-pm-carrito="' + escapeHtml(pid) + '">🛒 Agregar al carrito</button>';
            if (typeof hasPermission === 'function' && hasPermission('catalog.edit')) {
                h += '<button type="button" class="pm-btn" data-pm-editar="' + escapeHtml(pid) + '">✏️ Editar</button>';
            }
            h += '</div></div></div>';

            var wrap = document.createElement('div');
            wrap.id = 'pm-ficha-wrap';
            wrap.setAttribute('data-pid', pid);   // para repintarla si llega el inicial
            wrap.innerHTML = h;
            document.body.appendChild(wrap);
            document.body.classList.add('modal-open');
            var x = wrap.querySelector('[data-pm-cerrar]');
            if (x) x.focus();
        }

        function cerrarFichaProducto() {
            var w = document.getElementById('pm-ficha-wrap');
            if (w) { w.remove(); document.body.classList.remove('modal-open'); }
        }

        document.addEventListener('click', function(e) {
            var t = e.target;
            if (!t || !t.closest) return;
            var f = t.closest('[data-pm-ficha]');
            if (f) { abrirFichaProducto(f.getAttribute('data-pm-ficha')); return; }
            if (t.closest('[data-pm-cerrar]') || (t.classList && t.classList.contains('pm-ficha'))) { cerrarFichaProducto(); return; }
            var c = t.closest('[data-pm-carrito]');
            if (c) { var pid = c.getAttribute('data-pm-carrito'); cerrarFichaProducto(); addToCart(pid); return; }
            var ed = t.closest('[data-pm-editar]');
            if (ed) { var pe = ed.getAttribute('data-pm-editar'); cerrarFichaProducto(); editProduct(pe); }
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && document.getElementById('pm-ficha-wrap')) { e.stopPropagation(); cerrarFichaProducto(); }
        }, true);

        // Versión instalada, visible en el menú lateral: sale del ?v= con que
        // se cargó la app, así que dice exactamente qué versión corre en ESTE
        // teléfono (útil para confirmar que una actualización ya llegó).
        (function() {
            try {
                var sc = document.querySelector('script[src*="00-nucleo.js"]');
                var m = sc && /[?&]v=([^&]+)/.exec(sc.getAttribute('src'));
                var el = document.getElementById('sbVersion');
                if (el && m) el.textContent = 'BarInventory · versión ' + m[1];
            } catch (_) {}
        })();
