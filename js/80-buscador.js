        // ═════════════════════════════════════════════════════════════════════
        //  FASE 6 — BUSCADORES DE LA APP: motores, filtros y registro
        //  ───────────────────────────────────────────────────────────────────
        //  Este archivo une el motor puro (05-busqueda-motor.js) y la barra
        //  (06-busqueda-ui.js) con el estado real de cada pantalla. Antes
        //  había aquí dos copias de la puntuación difusa (pedidos e historia)
        //  y una tercera en 75-auditoria-flujo.js (productos); ahora hay un
        //  solo motor configurado tres veces.
        //
        //  Fuente de verdad de la consulta aplicada: siguen siendo las mismas
        //  variables globales de siempre (searchTerm, _conteoSearchTerm,
        //  _pedidosSearchTerm, _historiaSearchTerm), para no romper a quien
        //  las lea. BusquedaUI solo las actualiza vía `alAplicar`.
        // ═════════════════════════════════════════════════════════════════════

        // ── Motores ─────────────────────────────────────────────────────────
        // Pesos: el nombre manda; los códigos pesan menos por palabra pero, si
        // se escriben completos, puntúan 100 × peso y van primero siempre.
        var _motorProductos = crearMotorBusqueda({
            claves: [
                { nombre: 'name',      peso: 3 },
                { nombre: 'id',        peso: 2, codigo: true },
                { nombre: 'pv',        peso: 2, codigo: true },
                { nombre: 'sku',       peso: 2, codigo: true },
                { nombre: 'pvParrot',  peso: 2, codigo: true },
                { nombre: 'group',     peso: 1 },
                { nombre: 'proveedor', peso: 1 }
            ]
        });

        var _motorPedidos = crearMotorBusqueda({
            claves: [
                { nombre: 'id',       peso: 3, codigo: true },
                { nombre: 'supplier', peso: 2 },
                { nombre: 'note',     peso: 1 },
                { nombre: 'productos', peso: 1,
                  obtener: function(o) { return (o.products || []).map(function(p) { return p.name || ''; }).join(' '); } }
            ]
        });

        var _motorInventarios = crearMotorBusqueda({
            claves: [
                { nombre: 'id',   peso: 3, codigo: true },
                { nombre: 'area', peso: 2,
                  obtener: function(inv) { return (typeof areas !== 'undefined' && areas[inv.area]) ? areas[inv.area] : (inv.area || ''); } },
                { nombre: 'date', peso: 1 },
                { nombre: 'productos', peso: 1,
                  obtener: function(inv) { return (inv.products || []).map(function(p) { return p.name || ''; }).join(' '); } }
            ]
        });

        // ── Catálogo (Inicio + Productos comparten estado) ──────────────────

        function _bajoMinimo(p) {
            // Misma regla que ya marcaba en rojo la columna Stock del catálogo.
            if (!(typeof p.stockMinimo === 'number' && p.stockMinimo > 0)) return false;
            var total = (typeof getTotalStock === 'function') ? getTotalStock(p) : null;
            return typeof total === 'number' && total < p.stockMinimo;
        }

        function _enGrupo(p) {
            return selectedGroup === 'Todos' || p.group === selectedGroup;
        }

        function _pasaFiltrosCatalogo(p, f) {
            if (f.bajoMin   && !_bajoMinimo(p)) return false;
            if (f.oz        && !(typeof tieneConversion === 'function' && tieneConversion(p))) return false;
            if (f.sinPrecio && typeof p.precio === 'number') return false;
            if (f.sinPV     && p.pv) return false;
            return true;
        }

        /**
         * Chips del catálogo. Los de "sin precio" / "sin PV" solo para quien
         * administra el catálogo: son pendientes de captura, no algo que el
         * bartender pueda resolver.
         *
         * No hay chip "activo / inactivo": el catálogo no tiene ese campo (hoy
         * un producto se elimina, no se desactiva — decisión pendiente §8-N de
         * la auditoría maestra). Inventarlo aquí filtraría por un dato que no
         * existe.
         */
        function _chipsCatalogo(admin) {
            var enG = products.filter(_enGrupo);
            var n = { bajoMin: 0, oz: 0, sinPrecio: 0, sinPV: 0 };
            enG.forEach(function(p) {
                if (_bajoMinimo(p)) n.bajoMin++;
                if (typeof tieneConversion === 'function' && tieneConversion(p)) n.oz++;
                if (typeof p.precio !== 'number') n.sinPrecio++;
                if (!p.pv) n.sinPV++;
            });
            var lista = [
                { id: 'bajoMin', etiqueta: 'Bajo mínimo', contador: n.bajoMin },
                { id: 'oz',      etiqueta: 'Conteo en oz', contador: n.oz }
            ];
            if (admin) {
                lista.push({ id: 'sinPrecio', etiqueta: 'Sin precio', contador: n.sinPrecio });
                lista.push({ id: 'sinPV',     etiqueta: 'Sin PV',     contador: n.sinPV });
            }
            return lista;
        }

        function _buscarCatalogo() {
            var f = BusquedaUI.filtros('catalogo');
            return _motorProductos.buscar(products, searchTerm, {
                filtro: function(p) { return _enGrupo(p) && _pasaFiltrosCatalogo(p, f); }
            });
        }

        // ── Conteo de inventario físico ─────────────────────────────────────

        function _datoConteo(p, area, conteoRef) {
            return (conteoRef && conteoRef[p.id] && conteoRef[p.id][area]) || null;
        }
        function _estaContado(d) {
            return !!d && ((d.enteras || 0) > 0 || (d.abiertas || []).some(function(a) { return a > 0; }));
        }

        /**
         * "Sin contar" es el filtro que más tiempo ahorra al cerrar un área:
         * responde "¿qué me falta?" sin recorrer 400 tarjetas.
         */
        function _chipsConteo(area, conteoRef) {
            var enG = products.filter(_enGrupo);
            var contados = 0, conflicto = 0;
            enG.forEach(function(p) {
                var d = _datoConteo(p, area, conteoRef);
                if (_estaContado(d)) contados++;
                if (d && d.alerta_conflicto) conflicto++;
            });
            var lista = [
                { id: 'sinContar', etiqueta: 'Sin contar', contador: enG.length - contados, grupo: 'estado' },
                { id: 'contados',  etiqueta: 'Contados',   contador: contados,              grupo: 'estado' }
            ];
            // Los conflictos salen de comparar conteos de varias personas: solo
            // quien puede ver conteos ajenos (conteo ciego, FASE 2B).
            if (typeof puedeVerConteosAjenos === 'function' && puedeVerConteosAjenos() && conflicto > 0) {
                lista.push({ id: 'conflicto', etiqueta: 'Con conflicto', contador: conflicto });
            }
            return lista;
        }

        /**
         * Productos del conteo. IMPORTANTE (corrección de FASE 6): ya NO aplica
         * `searchTerm`, la búsqueda del catálogo. Antes el conteo usaba
         * filterByGroup(), que filtraba también por lo último escrito en
         * Inicio/Productos —y ese texto se guardaba y sobrevivía a recargas—:
         * un bartender podía entrar a contar con productos escondidos por un
         * filtro que no veía en ninguna parte de la pantalla.
         */
        function _buscarConteo(area, conteoRef) {
            var f = BusquedaUI.filtros('conteo');
            return _motorProductos.buscar(products, _conteoSearchTerm, {
                filtro: function(p) {
                    if (!_enGrupo(p)) return false;
                    var d = _datoConteo(p, area, conteoRef);
                    if (f.sinContar && _estaContado(d)) return false;
                    if (f.contados  && !_estaContado(d)) return false;
                    if (f.conflicto && !(d && d.alerta_conflicto)) return false;
                    return true;
                }
            });
        }

        // ── Pedidos e Historia ──────────────────────────────────────────────

        function _buscarPedidos() {
            return _motorPedidos.buscar(orders, _pedidosSearchTerm);
        }

        function _chipsHistoria() {
            var cuenta = {};
            inventories.forEach(function(inv) { var a = inv.area || 'general'; cuenta[a] = (cuenta[a] || 0) + 1; });
            var ids = Object.keys(cuenta);
            if (ids.length < 2) return [];   // un solo área: el chip no filtra nada
            return ids.map(function(a) {
                return {
                    id: 'area:' + a,
                    etiqueta: (typeof areas !== 'undefined' && areas[a]) ? areas[a] : (a === 'general' ? 'General' : a),
                    contador: cuenta[a],
                    grupo: 'area'
                };
            });
        }

        function _buscarHistoria() {
            var f = BusquedaUI.filtros('historia');
            var areaSel = null;
            Object.keys(f).forEach(function(k) { if (k.indexOf('area:') === 0) areaSel = k.slice(5); });
            return _motorInventarios.buscar(inventories, _historiaSearchTerm, {
                filtro: areaSel ? function(inv) { return (inv.area || 'general') === areaSel; } : null
            });
        }

        // ── Compatibilidad con los nombres anteriores ───────────────────────
        // Siguen existiendo por si algún botón, script de consola o prueba las
        // llama. Todas delegan en el buscador unificado.
        function _filtrarPedidos()             { return _buscarPedidos().items; }
        function _filtrarHistoriaInventarios() { return _buscarHistoria().items; }
        function clearConteoSearch()           { BusquedaUI.limpiar('conteo'); }
        function updatePedidosSearch(val)      { BusquedaUI.establecer('pedidos', val); }
        function clearPedidosSearch()          { BusquedaUI.limpiar('pedidos'); }
        function updateHistoriaSearch(val)     { BusquedaUI.establecer('historia', val); }
        function clearHistoriaSearch()         { BusquedaUI.limpiar('historia'); }

        // ── Registro ────────────────────────────────────────────────────────

        function _pintarRegionBusqueda(key, r) {
            var reg = document.getElementById('sbx-res-' + key);
            if (reg) reg.innerHTML = r.html;
            return r;
        }

        BusquedaUI.registrar('catalogo', {
            obtenerConsulta: function() { return searchTerm; },
            alAplicar:  function(v) { searchTerm = v; },
            refrescar:  function() {
                return _pintarRegionBusqueda('catalogo',
                    activeTab === 'productos' ? _renderProductosResultados() : _renderInicioResultados());
            },
            precalentar: function() { _motorProductos.indexar(products); },
            paso: 60
        });

        BusquedaUI.registrar('conteo', {
            obtenerConsulta: function() { return _conteoSearchTerm; },
            alAplicar:  function(v) { _conteoSearchTerm = v; },
            refrescar:  function() { return _pintarRegionBusqueda('conteo', _renderConteoResultados()); },
            precalentar: function() { _motorProductos.indexar(products); },
            // Tandas más grandes: en el conteo se recorre la lista completa.
            paso: 120
        });

        BusquedaUI.registrar('pedidos', {
            obtenerConsulta: function() { return _pedidosSearchTerm; },
            alAplicar:  function(v) { _pedidosSearchTerm = v; },
            refrescar:  function() { return _pintarRegionBusqueda('pedidos', _renderPedidosResultados()); },
            precalentar: function() { _motorPedidos.indexar(orders); },
            modoNumerico: true,
            paso: 40
        });

        BusquedaUI.registrar('historia', {
            obtenerConsulta: function() { return _historiaSearchTerm; },
            alAplicar:  function(v) { _historiaSearchTerm = v; },
            refrescar:  function() { return _pintarRegionBusqueda('historia', _renderHistoriaResultados()); },
            precalentar: function() { _motorInventarios.indexar(inventories); },
            paso: 40
        });
