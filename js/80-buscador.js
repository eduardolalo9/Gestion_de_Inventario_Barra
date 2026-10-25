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

        // FASE 11B — "Físico vs Sistema". Mismo criterio que el catálogo
        // (nombre manda, id es código exacto): es la misma lista de
        // productos, solo que aquí cada fila ya trae su comparación.
        var _motorFvs = crearMotorBusqueda({
            claves: [
                { nombre: 'nombre', peso: 3 },
                { nombre: 'id',     peso: 2, codigo: true }
            ]
        });

        // REDISEÑO — Recetario. El nombre manda igual que en el catálogo; el
        // PV (código único, solo existe si la receta vino de una importación
        // — ver RECETARIO-2) se trata como código exacto; la categoría pesa
        // como el grupo del catálogo. Antes el Recetario tenía su propio
        // <input> con una comparación de subcadena a mano (sin tildes, sin
        // puntaje, sin paginación) — ver claude/rediseno-r7b... (este cambio).
        var _motorRecetas = crearMotorBusqueda({
            claves: [
                { nombre: 'nombre',    peso: 3 },
                { nombre: 'pv',        peso: 2, codigo: true },
                { nombre: 'categoria', peso: 1 }
            ]
        });

        // ── Catálogo (Inicio + Productos comparten estado) ──────────────────

        function _bajoMinimo(p) {
            // Misma regla que ya marcaba en rojo la columna Stock del catálogo.
            if (!(typeof p.stockMinimo === 'number' && p.stockMinimo > 0)) return false;
            // FASE 8 — se pregunta por la cifra que la app da por buena
            // (existenciaMostrada: oficial si está encendida, operativa si
            // no, con el mismo respaldo honesto sin inicial en cualquier caso).
            var total = (typeof existenciaMostrada === 'function') ? existenciaMostrada(p)
                      : ((typeof getTotalStock === 'function') ? getTotalStock(p) : null);
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
                if (d && d._hayConflicto) conflicto++; // FASE 8C: campo legacy retirado → _hayConflicto
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
                    if (f.conflicto && !(d && d._hayConflicto)) return false; // FASE 8C
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

        // ── Recetario ────────────────────────────────────────────────────────

        function _buscarRecetario() {
            return _motorRecetas.buscar(recetas, _recetarioSearchTerm);
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
            alAplicar:  function(v) { searchTerm = v; _hdrBuscaSincronizarAviso(); },
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
            // FASE 7 — corrección de FASE 6: en el conteo NO hay carga por
            // tandas. El botón "Finalizar área" va después de la lista; con
            // tandas quedaba visible tras los primeros 120 y se podía cerrar
            // el área sin haber visto el resto. Aquí se pinta todo, como antes
            // de FASE 6 (la búsqueda sigue refrescando solo la región).
            paso: 100000
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

        // FASE 11B — Físico vs Sistema. La lista a indexar es la tabla ya
        // calculada (fisicoVsSistemaCalcular), no el catálogo: se recalcula
        // en cada refrescar() porque el conteo en vivo cambia constantemente
        // mientras el equipo sigue contando.
        BusquedaUI.registrar('fvs', {
            obtenerConsulta: function() { return _fvsSearchTerm; },
            alAplicar:  function(v) { _fvsSearchTerm = v; },
            refrescar:  function() { return _pintarRegionBusqueda('fvs', _renderFvsResultados()); },
            precalentar: function() {
                var d = (typeof fisicoVsSistemaCalcular === 'function') ? fisicoVsSistemaCalcular() : null;
                if (d) _motorFvs.indexar(d.filas);
            },
            paso: 40
        });

        // REDISEÑO — Recetario comparte el mismo buscador que Inicio: misma
        // barra, mismo motor difuso, mismo resaltado, misma paginación por
        // tandas y navegación con teclado. _renderRecetarioResultados() vive
        // en js/91-recetario.js, junto al resto del módulo.
        BusquedaUI.registrar('recetario', {
            obtenerConsulta: function() { return _recetarioSearchTerm; },
            alAplicar:  function(v) { _recetarioSearchTerm = v; },
            refrescar:  function() { return _pintarRegionBusqueda('recetario', _renderRecetarioResultados()); },
            precalentar: function() { _motorRecetas.indexar(recetas); },
            paso: 60
        });

        // ═════════════════════════════════════════════════════════════════════
        //  LUPA DE LA CABECERA — búsqueda del catálogo sin bajar por Inicio
        //  ───────────────────────────────────────────────────────────────────
        //  Antes el buscador del catálogo estaba en Inicio, debajo del panel y
        //  los grupos: había que hacer scroll. Ahora vive en la cabecera: la
        //  lupa abre un panel FLOTANTE (position:fixed, no empuja nada) con la
        //  MISMA barra de BusquedaUI y la MISMA clave 'catalogo', así que el
        //  motor, los recientes, los chips y los resultados son los de siempre;
        //  los resultados se siguen pintando en la región de Inicio.
        //
        //  · Productos conserva su barra propia (es la pantalla del catálogo):
        //    allí la lupa solo enfoca esa barra. Evita ids duplicados.
        //  · En cualquier otra pestaña la lupa lleva primero a Inicio.
        //  · La barra se pinta al abrir y se borra al cerrar: sus ids nunca
        //    coexisten con los de Productos.
        //  · Cerrar = vaciar la consulta (si no, Inicio quedaría filtrado sin
        //    ninguna barra visible que lo explique).
        // ═════════════════════════════════════════════════════════════════════

        var _hdrBuscaAbierta = false;

        // El aviso "Búsqueda: … · editar" de Inicio solo tiene sentido mientras haya
        // consulta: se retira en cuanto se vacía (por la X, al cerrar o con "Quitar").
        function _hdrBuscaSincronizarAviso() {
            if (searchTerm) return;
            var a = document.querySelector('.hdr-search-aviso');
            if (a && a.parentNode) a.parentNode.removeChild(a);
        }

        function _hdrBuscaPosicionar() {
            var panel = document.getElementById('hdrSearchPanel');
            var head  = document.querySelector('.sticky.top-0.z-50');
            if (!panel || !head) return;
            var b = head.getBoundingClientRect().bottom;
            panel.style.top = Math.max(0, Math.round(b)) + 'px';
        }

        function abrirBusquedaCabecera() {
            // Productos ya tiene su barra: se enfoca en vez de duplicarla.
            if (activeTab === 'productos') {
                var propia = document.getElementById('sbx-input-catalogo');
                if (propia) {
                    try { propia.scrollIntoView({ block: 'center' }); } catch (_) {}
                    propia.focus();
                }
                return;
            }
            if (activeTab !== 'inicio') switchTab('inicio');
            var panel = document.getElementById('hdrSearchPanel');
            if (!panel) return;
            // Idempotente: abrir con el panel abierto solo devuelve el foco.
            if (!_hdrBuscaAbierta) {
                panel.innerHTML =
                    '<div class="hdr-search__fila">'
                    + BusquedaUI.barra('catalogo', {
                        placeholder: 'Buscar por nombre, código, PV o grupo…',
                        etiqueta: 'Buscar productos del catálogo'
                    })
                    + '<button type="button" class="hdr-search__cerrar" onclick="cerrarBusquedaCabecera()"'
                    + ' aria-label="Cerrar búsqueda" title="Cerrar (Esc)">'
                    + '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor">'
                    + '<path stroke-linecap="round" stroke-width="2" d="M6 6l12 12M18 6L6 18"/></svg></button>'
                    + '</div>';
                _hdrBuscaPosicionar();
                panel.hidden = false;
                _hdrBuscaAbierta = true;
                var btn = document.getElementById('searchToggleBtn');
                if (btn) btn.setAttribute('aria-expanded', 'true');
            }
            var inp = document.getElementById('sbx-input-catalogo');
            if (inp) inp.focus();
        }

        // La lupa alterna: un segundo toque cierra el panel.
        function alternarBusquedaCabecera() {
            if (_hdrBuscaAbierta) cerrarBusquedaCabecera();
            else abrirBusquedaCabecera();
        }

        function cerrarBusquedaCabecera() {
            if (!_hdrBuscaAbierta) return;
            var panel = document.getElementById('hdrSearchPanel');
            var hayConsulta = !!(typeof searchTerm !== 'undefined' && searchTerm);
            // 1º se retira la barra (libera los ids), 2º se vacía la consulta.
            if (panel) { panel.hidden = true; panel.innerHTML = ''; }
            _hdrBuscaAbierta = false;
            var btn = document.getElementById('searchToggleBtn');
            if (btn) btn.setAttribute('aria-expanded', 'false');
            if (hayConsulta) BusquedaUI.establecer('catalogo', '');
            try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (_) {}
        }

        // Cierres: la X, un segundo toque a la lupa, Esc (con el foco fuera del
        // input; dentro, BusquedaUI lo usa para vaciar/soltar) y salir de Inicio
        // (switchTab). NO se cierra por tocar fuera: se buscan varios productos
        // seguidos (agregar al carrito, "Mostrar más", chips) sin perder la consulta.
        document.addEventListener('keydown', function(e) {
            if (!_hdrBuscaAbierta || e.key !== 'Escape') return;
            if (e.target && e.target.classList && e.target.classList.contains('sbx__input')) return;
            cerrarBusquedaCabecera();
        });
        window.addEventListener('resize', function() { if (_hdrBuscaAbierta) _hdrBuscaPosicionar(); }, { passive: true });
        window.addEventListener('scroll', function() { if (_hdrBuscaAbierta) _hdrBuscaPosicionar(); }, { passive: true, capture: true });
