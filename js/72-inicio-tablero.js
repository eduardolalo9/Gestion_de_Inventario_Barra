        // ══════════════════════════════════════════════════════════════════════
        //  v5.23 — INICIO: TABLERO DE ARRANQUE (rediseño "Carbón & Latón")
        //  ────────────────────────────────────────────────────────────────────
        //  Pedido de Eduardo (9-oct-2026): aplicar el diseño de Inicio y Conteo.
        //  Esto es SOLO presentación: no calcula existencias, no guarda nada y
        //  no toca la lógica de conteo. Lee lo que la app ya tiene en memoria
        //  (el inventario activo, el conteo por área, el nivel de alerta y el
        //  pedido sugerido) y lo ordena así, de arriba abajo:
        //    1. Saludo
        //    2. Tarjeta del Inventario Físico (avance, áreas, "Continuar conteo")
        //    3. Existencias en alerta (Limitado / Advertencia / Bajo mínimo)
        //    4. Pedido sugerido listo
        //    5. Operación (acceso a los módulos)
        //  La barra inferior NO cambia. El catálogo y los indicadores de siempre
        //  siguen debajo, intactos.
        // ══════════════════════════════════════════════════════════════════════

        var INICIO_SEGMENTOS = 12;

        function _itEsc(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v == null ? '' : v) : String(v == null ? '' : v); }

        /** ¿Tiene este producto algo contado en esta área? (mismo criterio que la pantalla de Conteo) */
        function _itTieneConteo(d) {
            return !!(d && (d.enteras > 0 || (d.abiertas || []).some(function(a) { return a > 0; })));
        }

        /** Cuántos segmentos del medidor (0..total) corresponden a contados/total. */
        function inicioSegmentosLlenos(contados, total, segmentos) {
            var n = segmentos || INICIO_SEGMENTOS;
            if (!total || total <= 0 || !contados || contados <= 0) return 0;
            return Math.max(1, Math.min(n, Math.round(contados / total * n)));
        }

        /** El medidor segmentado del diseño. Es decorativo: el dato va en el texto de al lado. */
        function inicioMedidor(contados, total, segmentos) {
            var n = segmentos || INICIO_SEGMENTOS;
            var llenos = inicioSegmentosLlenos(contados, total, n);
            var h = '<div class="it-medidor" aria-hidden="true">';
            for (var i = 0; i < n; i++) h += '<span class="it-medidor__seg' + (i < llenos ? ' it-medidor__seg--on' : '') + '"></span>';
            return h + '</div>';
        }

        /**
         * Datos del tablero. Función pura sobre el estado en memoria: se puede
         * probar sin pintar nada.
         */
        function inicioTableroDatos() {
            var lista = (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];
            var inv   = (typeof _inventarioActivo !== 'undefined') ? _inventarioActivo : null;
            var d = { inv: inv, total: lista.length, contados: 0, areas: [], alertas: { limitado: 0, advertencia: 0, bajo: 0 }, pedido: { productos: 0, proveedores: 0 } };

            // Productos contados = unión entre todas las personas (igual que el encabezado de Conteo).
            var uni = {};
            Object.values(typeof allUsersAuditoria !== 'undefined' ? allUsersAuditoria : {}).forEach(function(u) {
                Object.keys((u && u.conteo) || {}).forEach(function(pid) { uni[pid] = 1; });
            });
            d.contados = Math.min(Object.keys(uni).length, d.total);

            // Áreas: cuántos productos con cantidad y en qué estado va cada una.
            var conteoRef = (typeof puedeVerConteosAjenos === 'function' && puedeVerConteosAjenos()) ? auditoriaConteo : myAuditoriaConteo;
            var statusRef = (typeof isAdmin === 'function' && isAdmin()) ? auditoriaStatus : myAuditoriaStatus;
            var lstAreas  = (typeof AREAS_CONTEO !== 'undefined' && AREAS_CONTEO.length) ? AREAS_CONTEO : [];
            lstAreas.forEach(function(area) {
                var n = 0;
                lista.forEach(function(p) { if (_itTieneConteo(conteoRef && conteoRef[p.id] && conteoRef[p.id][area])) n++; });
                var completa = !!(statusRef && statusRef[area] === 'completada');
                d.areas.push({ clave: area, nombre: (typeof areasAuditoria !== 'undefined' && areasAuditoria[area]) || area,
                               contados: n, estado: completa ? 'completada' : (n > 0 ? 'en_conteo' : 'pendiente') });
            });

            // Alertas y pedido sugerido: las MISMAS funciones que usan las tarjetas del catálogo.
            var provs = {};
            lista.forEach(function(p) {
                var nivel = (typeof nivelAlertaProducto === 'function') ? nivelAlertaProducto(p) : null;
                if (nivel && d.alertas[nivel] !== undefined) d.alertas[nivel]++;
                var ped = (typeof pedidoSugeridoProducto === 'function') ? pedidoSugeridoProducto(p) : null;
                if (typeof ped === 'number' && ped > 0) { d.pedido.productos++; provs[p.proveedor || '—'] = 1; }
            });
            d.pedido.proveedores = Object.keys(provs).filter(function(k) { return k !== '—'; }).length;
            return d;
        }

        function _itSaludo() {
            // El nombre sale de la cuenta (Firebase Auth). El "Contador-XXXX" de
            // auditCurrentUser es un apodo generado por dispositivo: no se usa.
            var cuenta = (typeof _auth !== 'undefined' && _auth && _auth.currentUser) ? _auth.currentUser : null;
            var nombre = (cuenta && cuenta.displayName) ? String(cuenta.displayName).trim() : '';
            var primero = nombre ? nombre.split(/\s+/)[0] : '';
            var rol = (typeof isAdmin === 'function' && isAdmin()) ? 'Administrador' : 'Equipo de barra';
            return '<header class="it-saludo"><h2 class="it-saludo__titulo">' + (primero ? 'Hola, ' + _itEsc(primero) : 'Hola') + '</h2>'
                 + '<p class="it-saludo__rol">' + rol + '</p></header>';
        }

        function _itEstadoArea(estado) {
            if (estado === 'completada') return '<span class="it-area__estado it-area__estado--ok">Completada</span>';
            if (estado === 'en_conteo')  return '<span class="it-area__estado it-area__estado--info">En conteo</span>';
            return '<span class="it-area__estado">Pendiente</span>';
        }

        function _itTarjetaInventario(d) {
            var inv = d.inv;
            var carga = (typeof _inventarioActivoSinResolver === 'function') && !inv && _inventarioActivoSinResolver();
            var h = '<section class="it-inv" aria-label="Inventario físico">';
            if (carga) {
                h += '<p class="it-inv__etq">Inventario físico</p><p class="it-inv__vacio" role="status">Leyendo el inventario de la sesión actual…</p>';
            } else if (!inv) {
                h += '<p class="it-inv__etq">Inventario físico</p>'
                   + '<p class="it-inv__vacio">Sin inventario físico abierto</p>'
                   + '<p class="it-inv__sub">' + ((typeof isAdmin === 'function' && isAdmin()) ? 'Créalo desde Conteo para que el equipo empiece.' : 'El administrador aún no lo abre.') + '</p>'
                   + '<button type="button" class="it-btn it-btn--primario" onclick="switchTab(\'inventario\')">Ir a Conteo <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>';
            } else {
                var abierto = (typeof inventarioAbierto === 'function') ? inventarioAbierto(inv) : inv.estado === 'SINCRONIZADO';
                var pastilla = abierto
                    ? ((typeof UI !== 'undefined' && UI.badge) ? UI.badge('sincronizado') : 'Sincronizado')
                    : '<span class="it-pill it-pill--neutro">' + _itEsc(String(inv.estado || 'Cerrado')) + '</span>';
                h += '<div class="it-inv__cab"><div><p class="it-inv__etq">Inventario físico</p>'
                   + '<p class="it-inv__num num">#' + _itEsc(String(inv.numero || '—')) + '</p></div>' + pastilla + '</div>';
                h += '<p class="it-inv__cifra" role="status"><span class="num it-inv__grande">' + d.contados + '</span>'
                   + '<span class="num it-inv__de">/ ' + d.total + '</span><span class="it-inv__u">contados</span></p>';
                h += inicioMedidor(d.contados, d.total);
                if (d.areas.length) {
                    h += '<ul class="it-areas">';
                    d.areas.forEach(function(a) {
                        h += '<li class="it-area"><span class="it-area__nombre">' + _itEsc(a.nombre) + '</span>'
                           + '<span class="it-area__n num">' + a.contados + '</span>' + _itEstadoArea(a.estado) + '</li>';
                    });
                    h += '</ul>';
                }
                h += '<button type="button" class="it-btn it-btn--primario" onclick="switchTab(\'inventario\')">'
                   + (abierto ? 'Continuar conteo' : 'Ver inventario') + ' <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>';
            }
            return h + '</section>';
        }

        function _itAlertas(d) {
            var a = d.alertas;
            var h = '<section aria-label="Existencias en alerta"><div class="it-seccion"><h3 class="it-seccion__titulo">Existencias en alerta</h3>'
                  + '<button type="button" class="it-enlace" onclick="panelVerBajoMinimo()">Ver todo</button></div>';
            h += '<div class="it-alertas">';
            h += '<div class="it-alerta it-alerta--danger"><span class="it-alerta__n num">' + a.limitado + '</span><span class="it-alerta__t">Limitado</span></div>';
            h += '<div class="it-alerta it-alerta--warn"><span class="it-alerta__n num">' + a.advertencia + '</span><span class="it-alerta__t">Advertencia</span></div>';
            h += '<div class="it-alerta"><span class="it-alerta__n num">' + a.bajo + '</span><span class="it-alerta__t">Bajo mínimo</span></div>';
            return h + '</div></section>';
        }

        function _itPedido(d) {
            var p = d.pedido;
            if (!p.productos) return '';
            var det = p.productos + ' producto' + (p.productos === 1 ? '' : 's') + ' por reponer'
                    + (p.proveedores ? ' · ' + p.proveedores + ' proveedor' + (p.proveedores === 1 ? '' : 'es') : '');
            return '<section class="it-pedido" aria-label="Pedido sugerido"><div class="it-pedido__txt"><p class="it-pedido__t">Pedido sugerido listo</p>'
                 + '<p class="it-pedido__s">' + _itEsc(det) + '</p></div>'
                 + '<button type="button" class="it-btn it-btn--sec" onclick="inicioGenerarPedidoSugerido()">Generar</button></section>';
        }

        function _itModulos() {
            var mods = [
                { tab: 'inventario', icono: 'fa-boxes-stacked', t: 'Inventario',  s: 'Físico y cierres' },
                { tab: 'productos',  icono: 'fa-box',           t: 'Catálogo',    s: (typeof products !== 'undefined' ? products.length : 0) + ' productos' },
                { tab: 'pedidos',    icono: 'fa-clipboard-list', t: 'Pedidos',    s: (typeof orders !== 'undefined' ? orders.length : 0) + ' en este dispositivo' }
            ];
            if (typeof hasPermission === 'function' && hasPermission('inventory.viewAll')) {
                mods.push({ tab: 'fisico', icono: 'fa-file-chart-column', t: 'Físico vs Sistema', s: 'Diferencias' });
            }
            mods.push({ tab: 'recetario', icono: 'fa-book',    t: 'Recetario', s: 'Recetas y costos' });
            mods.push({ tab: 'ventas',    icono: 'fa-receipt', t: 'Ventas',    s: 'Importar y consumo' });
            var h = '<section aria-label="Operación"><div class="it-seccion"><h3 class="it-seccion__titulo">Operación</h3></div><div class="it-modulos">';
            mods.forEach(function(m) {
                h += '<button type="button" class="it-modulo" onclick="inicioIrModulo(\'' + m.tab + '\')">'
                   + '<i class="fa-solid ' + m.icono + ' it-modulo__ico" aria-hidden="true"></i>'
                   + '<span class="it-modulo__t">' + _itEsc(m.t) + '</span><span class="it-modulo__s">' + _itEsc(m.s) + '</span></button>';
            });
            return h + '</div></section>';
        }

        /** Navega a un módulo. "fisico" abre Físico vs Sistema dentro de Conteo (igual que el botón de siempre). */
        function inicioIrModulo(tab) {
            if (tab === 'fisico') { auditoriaView = 'fisico_vs_sistema'; switchTab('inventario'); return; }
            if (tab === 'inventario') { auditoriaView = 'selection'; }
            switchTab(tab);
        }

        /**
         * "Generar": agrega al carrito la cantidad sugerida de cada producto
         * bajo mínimo —con la MISMA función que el botón "Al carrito" de cada
         * tarjeta— y abre el pedido. Pide confirmación porque toca el carrito.
         */
        function inicioGenerarPedidoSugerido() {
            var ids = [];
            (typeof products !== 'undefined' ? products : []).forEach(function(p) {
                var ped = (typeof pedidoSugeridoProducto === 'function') ? pedidoSugeridoProducto(p) : null;
                if (typeof ped === 'number' && ped > 0) ids.push(p.id);
            });
            if (!ids.length) { showNotification('Ya no hay pedido sugerido'); renderTab(); return; }
            showConfirm('Se agregarán al carrito ' + ids.length + ' producto' + (ids.length === 1 ? '' : 's')
                      + ' con la cantidad sugerida. Después puedes ajustar y generar el pedido.', function() {
                ids.forEach(function(id) { agregarPedidoSugerido(id); });
                showNotification(ids.length + ' producto' + (ids.length === 1 ? '' : 's') + ' agregado' + (ids.length === 1 ? '' : 's') + ' al carrito');
                renderTab();
                if (typeof openOrderModal === 'function') openOrderModal();
            });
        }

        /** El tablero completo. Lo llama renderInicioTab() antes del panel de indicadores. */
        function renderInicioTablero() {
            var d = inicioTableroDatos();
            return '<div class="it-tablero">' + _itSaludo() + _itTarjetaInventario(d) + _itAlertas(d) + _itPedido(d) + _itModulos() + '</div>';
        }

        window.inicioTableroDatos = inicioTableroDatos;
        window.inicioSegmentosLlenos = inicioSegmentosLlenos;
        window.inicioMedidor = inicioMedidor;
        window.inicioIrModulo = inicioIrModulo;
        window.inicioGenerarPedidoSugerido = inicioGenerarPedidoSugerido;
        window.renderInicioTablero = renderInicioTablero;
