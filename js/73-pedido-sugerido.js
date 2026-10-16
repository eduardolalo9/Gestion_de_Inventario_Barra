        // ══════════════════════════════════════════════════════════════════════
        //  v5.28 — PEDIDO SUGERIDO (pantalla propia)
        //  ────────────────────────────────────────────────────────────────────
        //  Pedido de Eduardo (15-oct-2026): pantalla 390 px estilo Toast / Meta
        //  Business Suite con filtros, buscador, selección múltiple y cantidad
        //  editable por producto, y un botón fijo "Generar pedido".
        //  Decisión de Eduardo: SIN el filtro "Máximo stock" (el catálogo no
        //  tiene stock máximo); quedan "Bajo stock" y "Grupos".
        //
        //  No inventa números: la cantidad sugerida es pedidoSugeridoProducto()
        //  (js/49, fórmula verificada contra el Excel: TECHO del déficit en
        //  unidades de compra) y la existencia es existenciaMostrada() — la
        //  misma cifra del catálogo y de "Bajo mínimo". El total estimado usa
        //  product.precio (precio por unidad de compra); un producto sin precio
        //  no suma y se avisa.
        //
        //  "Generar pedido" usa el carrito de siempre (addToCart fija la
        //  cantidad, es idempotente) y abre el modal "Generar Pedido". No
        //  escribe nada por su cuenta: ni en Firestore ni en el catálogo.
        // ══════════════════════════════════════════════════════════════════════

        var _ps = {
            soloBajo:    true,       // filtro "Bajo stock" (predeterminado)
            grupo:       '',         // '' = todos
            orden:       { campo: 'nombre', dir: 1 },
            seleccion:   null,       // { pid: true } — null = aún no se inicializó en esta sesión
            cantidades:  {},         // { pid: n } — lo que la persona escribió
            busqueda:    ''
        };

        /** Cabecera de módulo: volver + título centrado + punto de estado. Compartida (Ventas, Equipo). */
        function moduloCabecera(titulo, onVolver, estado) {
            var tono = estado === 'pendiente' ? 'warn' : 'ok';
            return '<div class="mc-cab">'
                 + '<button type="button" class="mc-cab__volver" onclick="' + onVolver + '" aria-label="Volver">'
                 + '<i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>'
                 + '<h2 class="mc-cab__titulo">' + escapeHtml(titulo) + '</h2>'
                 + '<span class="mc-cab__punto mc-cab__punto--' + tono + '" role="img" aria-label="'
                 + (tono === 'ok' ? 'Sincronizado' : 'Sincronización pendiente') + '"></span>'
                 + '</div>';
        }

        function _psRed(n, d) { var f = Math.pow(10, d === undefined ? 3 : d); var x = Number(n); return isFinite(x) ? Math.round(x * f) / f : 0; }

        /**
         * pedidoSugeridoFilas(lista, opciones) — capa de datos (pura respecto
         * a la pantalla). Devuelve una fila por producto con mínimo definido:
         * { id, nombre, grupo, unidad, enStock, minimo, sugerido, precio, proveedor }.
         * `opciones.soloBajo` deja solo los que tienen sugerido > 0.
         */
        function pedidoSugeridoFilas(lista, opciones) {
            opciones = opciones || {};
            var out = [];
            (lista || []).forEach(function(p) {
                if (!p || typeof p.stockMinimo !== 'number' || p.stockMinimo <= 0) return;
                if (opciones.grupo && (p.group || 'General') !== opciones.grupo) return;
                var sug = (typeof pedidoSugeridoProducto === 'function') ? pedidoSugeridoProducto(p) : null;
                if (opciones.soloBajo && !(typeof sug === 'number' && sug > 0)) return;
                var stock = (typeof existenciaMostrada === 'function') ? existenciaMostrada(p) : null;
                out.push({
                    id: p.id, nombre: p.name || p.id, grupo: p.group || 'General', unidad: p.unit || '',
                    enStock: (typeof stock === 'number') ? _psRed(stock) : null,
                    minimo: p.stockMinimo,
                    sugerido: (typeof sug === 'number') ? sug : null,
                    precio: (typeof p.precio === 'number' && p.precio >= 0) ? p.precio : null,
                    proveedor: p.proveedor || ''
                });
            });
            return out;
        }

        /** Ordena filas por campo ('nombre'|'enStock'|'sugerido'|'proveedor'), dir 1 asc / -1 desc. Nulos al final. */
        function pedidoSugeridoOrdenar(filas, campo, dir) {
            dir = dir === -1 ? -1 : 1;
            return filas.slice().sort(function(a, b) {
                var va = a[campo], vb = b[campo];
                var na = (va === null || va === undefined || va === ''), nb = (vb === null || vb === undefined || vb === '');
                if (na !== nb) return na ? 1 : -1;
                var r = (typeof va === 'number' && typeof vb === 'number') ? (va - vb)
                      : String(va).localeCompare(String(vb), 'es');
                return (r * dir) || String(a.nombre).localeCompare(String(b.nombre), 'es');
            });
        }

        /** Cantidad efectiva de una fila: lo escrito, o el sugerido. */
        function _psCantidad(f) {
            var v = _ps.cantidades[f.id];
            if (typeof v === 'number' && isFinite(v)) return v;
            return (typeof f.sugerido === 'number') ? f.sugerido : 0;
        }

        /** Resumen de lo seleccionado: { productos, total, sinPrecio }. */
        function pedidoSugeridoResumen(filas, seleccion, cantidadDe) {
            var r = { productos: 0, total: 0, sinPrecio: 0 };
            (filas || []).forEach(function(f) {
                if (!seleccion || !seleccion[f.id]) return;
                var q = cantidadDe(f);
                if (!(q > 0)) return;
                r.productos++;
                if (typeof f.precio === 'number') r.total += q * f.precio;
                else r.sinPrecio++;
            });
            r.total = Math.round(r.total * 100) / 100;
            return r;
        }

        function _psFilasBase() {
            return pedidoSugeridoFilas(typeof products !== 'undefined' ? products : [], { soloBajo: _ps.soloBajo, grupo: _ps.grupo });
        }

        function _psInicializarSeleccion() {
            if (_ps.seleccion) return;
            // Primera vez en la sesión: todo lo que tiene sugerido > 0 ya va
            // marcado — es lo que se pide 9 de cada 10 veces; se desmarca lo que no.
            _ps.seleccion = {};
            pedidoSugeridoFilas(typeof products !== 'undefined' ? products : [], { soloBajo: true }).forEach(function(f) {
                _ps.seleccion[f.id] = true;
            });
        }

        function _psFiltradas() {
            var base = _psFilasBase();
            if (_ps.busqueda && typeof _motorPedidoSugerido !== 'undefined') {
                base = _motorPedidoSugerido.buscar(base, _ps.busqueda).items;
            }
            return pedidoSugeridoOrdenar(base, _ps.orden.campo, _ps.orden.dir);
        }

        function _psMoneda(n) {
            return '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        }

        function _psNum(n) {
            if (typeof n !== 'number') return '—';
            return String(Math.round(n * 100) / 100);
        }

        function _psTarjeta(f) {
            var sel = !!(_ps.seleccion && _ps.seleccion[f.id]);
            var q = _psCantidad(f);
            var id = escapeHtml(String(f.id));
            var h = '<div class="ps-card' + (sel ? ' ps-card--sel' : '') + '" data-sbx-item>';
            h += '<button type="button" class="ps-check' + (sel ? ' ps-check--on' : '') + '" role="checkbox" aria-checked="' + sel + '"'
               + ' data-ps-accion="marcar" data-ps-pid="' + id + '" aria-label="Incluir ' + escapeHtml(f.nombre) + ' en el pedido">'
               + '<span class="ps-check__c" aria-hidden="true">' + (sel ? '<i class="fa-solid fa-check"></i>' : '') + '</span></button>';
            h += '<div class="ps-card__info">';
            h += '<div class="ps-card__nom">' + (typeof resaltarBusqueda === 'function' ? resaltarBusqueda(f.nombre, _ps.busqueda) : escapeHtml(f.nombre)) + '</div>';
            h += '<div class="ps-card__meta"><span class="ps-card__cod">' + id + '</span>'
               + (f.unidad ? '<span class="ps-uom">' + escapeHtml(f.unidad) + '</span>' : '')
               + (f.proveedor ? '<span class="ps-card__prov">' + escapeHtml(f.proveedor) + '</span>' : '') + '</div>';
            h += '</div>';
            h += '<div class="ps-card__num"><span class="ps-card__etq">Stock</span><b class="num' + (typeof f.enStock === 'number' && f.enStock < f.minimo ? ' ps-bajo' : '') + '">' + _psNum(f.enStock) + '</b></div>';
            h += '<div class="ps-card__num ps-card__num--muted"><span class="ps-card__etq">Mín</span><span class="num">' + _psNum(f.minimo) + '</span></div>';
            h += '<label class="ps-card__cant"><span class="ps-card__etq">Pedir</span>'
               + '<input type="text" inputmode="decimal" class="ps-input" value="' + (q > 0 ? q : 0) + '"'
               + ' data-ps-pid="' + id + '" aria-label="Cantidad a pedir de ' + escapeHtml(f.nombre) + '"></label>';
            h += '</div>';
            return h;
        }

        function _psFlecha(campo) {
            if (_ps.orden.campo !== campo) return '<i class="fa-solid fa-sort" aria-hidden="true"></i>';
            return _ps.orden.dir === 1 ? '↑' : '↓';
        }

        function _renderPedidoSugeridoResultados() {
            var filas = _psFiltradas();
            var todas = _psFilasBase();
            var nSel = todas.filter(function(f) { return _ps.seleccion && _ps.seleccion[f.id]; }).length;
            var h = '<div class="ps-micro"><span>' + filas.length + ' producto' + (filas.length === 1 ? '' : 's') + ' sugerido' + (filas.length === 1 ? '' : 's') + '</span>'
                  + '<button type="button" class="ps-micro__sel" data-ps-accion="todos">' + nSel + ' seleccionado' + (nSel === 1 ? '' : 's')
                  + ' · ' + (nSel === todas.length && todas.length ? 'quitar todos' : 'marcar todos') + '</button></div>';
            h += '<div class="ps-orden" role="group" aria-label="Ordenar">'
               + '<button type="button" class="ps-orden__btn' + (_ps.orden.campo === 'nombre' ? ' ps-orden__btn--on' : '') + '" data-ps-orden="nombre">Producto ' + _psFlecha('nombre') + '</button>'
               + '<button type="button" class="ps-orden__btn' + (_ps.orden.campo === 'enStock' ? ' ps-orden__btn--on' : '') + '" data-ps-orden="enStock">En stock ' + _psFlecha('enStock') + '</button>'
               + '<button type="button" class="ps-orden__btn' + (_ps.orden.campo === 'sugerido' ? ' ps-orden__btn--on' : '') + '" data-ps-orden="sugerido">Sugerido ' + _psFlecha('sugerido') + '</button>'
               + '<button type="button" class="ps-orden__btn' + (_ps.orden.campo === 'proveedor' ? ' ps-orden__btn--on' : '') + '" data-ps-orden="proveedor">Proveedor ' + _psFlecha('proveedor') + '</button>'
               + '</div>';
            if (!filas.length) {
                h += '<div class="ps-vacio"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>'
                   + '<div class="ps-vacio__t">' + (_ps.busqueda ? 'Sin coincidencias' : (_ps.soloBajo ? 'Nada que pedir' : 'Sin productos con mínimo')) + '</div>'
                   + '<div class="ps-vacio__s">' + (_ps.busqueda ? 'Prueba con otra palabra o quita el filtro de grupo.'
                        : (_ps.soloBajo ? 'Ningún producto está por debajo de su stock mínimo.' : 'Define el stock mínimo en el catálogo para que aparezcan aquí.')) + '</div></div>';
            } else {
                h += '<div class="ps-lista">' + filas.map(_psTarjeta).join('') + '</div>';
            }
            return { html: h, coincidencias: filas.length, total: todas.length };
        }

        function _psBarraInferior() {
            var r = pedidoSugeridoResumen(_psFilasBase(), _ps.seleccion, _psCantidad);
            return '<div class="ps-pie" id="ps-pie">'
                 + '<div class="ps-pie__txt"><b>' + r.productos + ' producto' + (r.productos === 1 ? '' : 's') + '</b>'
                 + ' • Total est. <b class="num">' + _psMoneda(r.total) + '</b>'
                 + (r.sinPrecio ? '<span class="ps-pie__nota">' + r.sinPrecio + ' sin precio</span>' : '') + '</div>'
                 + '<button type="button" class="ps-pie__btn" data-ps-accion="generar"' + (r.productos ? '' : ' disabled') + '>'
                 + 'Generar pedido <i class="fa-solid fa-cart-shopping" aria-hidden="true"></i></button>'
                 + '</div>';
        }

        function renderPedidoSugeridoTab() {
            _psInicializarSeleccion();
            var grupos = [];
            (typeof products !== 'undefined' ? products : []).forEach(function(p) {
                if (typeof p.stockMinimo === 'number' && p.stockMinimo > 0) {
                    var g = p.group || 'General';
                    if (grupos.indexOf(g) === -1) grupos.push(g);
                }
            });
            grupos.sort(function(a, b) { return a.localeCompare(b, 'es'); });
            var h = '<div class="ps-pantalla">';
            h += moduloCabecera('Pedido Sugerido', "switchTab('inicio')", (typeof _syncEnabled !== 'undefined' && !_syncEnabled) ? 'pendiente' : 'ok');
            h += '<div class="ps-filtros" role="group" aria-label="Filtros">'
               + '<button type="button" class="mc-pill' + (_ps.soloBajo ? ' mc-pill--on' : '') + '" aria-pressed="' + _ps.soloBajo + '" data-ps-accion="bajo">Bajo stock</button>'
               + '<label class="mc-pill mc-pill--select' + (_ps.grupo ? ' mc-pill--on' : '') + '"><span class="sbx-sr">Grupo</span>'
               + '<select onchange="pedidoSugeridoGrupo(this.value)" aria-label="Filtrar por grupo">'
               + '<option value="">Grupos</option>'
               + grupos.map(function(g) { return '<option value="' + escapeHtml(g) + '"' + (g === _ps.grupo ? ' selected' : '') + '>' + escapeHtml(g) + '</option>'; }).join('')
               + '</select><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></label>'
               + '</div>';
            h += BusquedaUI.barra('pedsug', { placeholder: 'Buscar por nombre, código o proveedor', etiqueta: 'Buscar en el pedido sugerido' });
            h += BusquedaUI.region('pedsug', _renderPedidoSugeridoResultados().html);
            h += _psBarraInferior();
            h += '</div>';
            return h;
        }

        function _psRepintar() {
            if (typeof BusquedaUI !== 'undefined') BusquedaUI.refrescar('pedsug', { sinAnimacion: false });
            var pie = document.getElementById('ps-pie');
            if (pie) pie.outerHTML = _psBarraInferior();
        }

        function pedidoSugeridoGrupo(g) { _ps.grupo = String(g || ''); renderTab(); }

        function abrirPedidoSugerido() { switchTab('pedido_sugerido'); }

        function pedidoSugeridoGenerar() {
            var filas = _psFilasBase();
            var elegidas = filas.filter(function(f) { return _ps.seleccion && _ps.seleccion[f.id] && _psCantidad(f) > 0; });
            if (!elegidas.length) { showNotification('Marca al menos un producto con cantidad'); return; }
            elegidas.forEach(function(f) { addToCart(f.id, _psCantidad(f)); });
            showNotification(elegidas.length + ' producto' + (elegidas.length === 1 ? '' : 's') + ' en el pedido');
            if (typeof openOrderModal === 'function') openOrderModal();
        }

        // ── Eventos (delegados, una sola vez) ──────────────────────────────
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('click', function(e) {
                var el = e.target && e.target.closest ? e.target.closest('[data-ps-accion],[data-ps-orden]') : null;
                if (!el || el.disabled) return;
                var orden = el.getAttribute('data-ps-orden');
                if (orden) {
                    _ps.orden = (_ps.orden.campo === orden) ? { campo: orden, dir: -_ps.orden.dir } : { campo: orden, dir: 1 };
                    _psRepintar();
                    return;
                }
                var acc = el.getAttribute('data-ps-accion');
                if (acc === 'marcar') {
                    var pid = el.getAttribute('data-ps-pid');
                    _psInicializarSeleccion();
                    if (_ps.seleccion[pid]) delete _ps.seleccion[pid]; else _ps.seleccion[pid] = true;
                    _psRepintar();
                } else if (acc === 'todos') {
                    var todas = _psFilasBase();
                    var todasMarcadas = todas.length && todas.every(function(f) { return _ps.seleccion[f.id]; });
                    todas.forEach(function(f) { if (todasMarcadas) delete _ps.seleccion[f.id]; else _ps.seleccion[f.id] = true; });
                    _psRepintar();
                } else if (acc === 'bajo') {
                    _ps.soloBajo = !_ps.soloBajo;
                    renderTab();
                } else if (acc === 'generar') {
                    pedidoSugeridoGenerar();
                }
            });
            // Cantidad: se valida al salir del campo (no en cada tecla, para no
            // mover la lista bajo el dedo). Mismos límites que el conteo.
            document.addEventListener('change', function(e) {
                var t = e.target;
                if (!t || !t.classList || !t.classList.contains('ps-input')) return;
                var pid = t.getAttribute('data-ps-pid');
                var raw = String(t.value || '').trim().replace(/,/g, '.');
                var v = /e/i.test(raw) ? NaN : parseFloat(raw);
                if (!isFinite(v) || v < 0 || v > 9999) {
                    showNotification('⚠️ Cantidad no válida (0 a 9999)');
                    var f0 = _psFilasBase().find(function(x) { return x.id === pid; });
                    t.value = f0 ? _psCantidad(f0) : 0;
                    return;
                }
                _ps.cantidades[pid] = Math.round(v * 1000) / 1000;
                _psInicializarSeleccion();
                if (v > 0) _ps.seleccion[pid] = true;
                var pie = document.getElementById('ps-pie');
                if (pie) pie.outerHTML = _psBarraInferior();
            });
        }

        window.renderPedidoSugeridoTab = renderPedidoSugeridoTab;
        window.abrirPedidoSugerido = abrirPedidoSugerido;
        window.pedidoSugeridoGrupo = pedidoSugeridoGrupo;
        window.moduloCabecera = moduloCabecera;
