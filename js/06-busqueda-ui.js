        // ═════════════════════════════════════════════════════════════════════
        //  FASE 6 — CONTROLADOR DE LA BARRA DE BÚSQUEDA (DOM)
        //  ───────────────────────────────────────────────────────────────────
        //  Un solo componente para todos los buscadores de la app. La lógica de
        //  coincidencia vive en 05-busqueda-motor.js; aquí solo hay interfaz.
        //
        //  El problema principal que resuelve NO es la velocidad del filtro,
        //  es lo que pasaba después: cada búsqueda llamaba a renderTab(), que
        //  reconstruye la pestaña entera con innerHTML —incluido el propio
        //  input donde se está escribiendo—, reproducía la animación de
        //  entrada escalonada de cada tarjeta y, en Inicio/Productos, además
        //  serializaba TODO el estado (conteos, catálogo, compras, historial) a
        //  IndexedDB y localStorage en cada tecla.
        //
        //  Ahora cada vista declara una "región de resultados" y la búsqueda
        //  solo reescribe esa región. El input nunca se destruye mientras se
        //  escribe: el teclado del teléfono no parpadea ni se cierra.
        //
        //  Uso desde una vista (render en cadena, como el resto de la app):
        //      BusquedaUI.registrar('catalogo', { alAplicar, refrescar, ... })
        //      html += BusquedaUI.barra('catalogo', { placeholder, etiqueta });
        //      html += BusquedaUI.region('catalogo', htmlDeResultados);
        //
        //  Eventos: delegados en `document` e instalados UNA vez. No hay
        //  handlers en línea: sobreviven a cualquier re-render sin reconectar.
        // ═════════════════════════════════════════════════════════════════════

        var BusquedaUI = (function() {
            var registros = Object.create(null);
            var estados   = Object.create(null);
            var HIST_MAX  = 8;
            var _observador = null;

            // ── Almacenamiento local tolerante a fallos ──────────────────────
            // Modo privado, cuota llena o almacenamiento bloqueado: la búsqueda
            // tiene que seguir funcionando igual, solo sin recordar nada.
            function _lsGet(k, def) {
                try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); }
                catch (_) { return def; }
            }
            function _lsSet(k, v) {
                try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* sin almacenamiento */ }
            }

            function _esc(x) {
                return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            }
            function _idSeguro(key) { return String(key).replace(/[^a-zA-Z0-9_-]/g, '_'); }

            function _estado(key) {
                if (!estados[key]) {
                    estados[key] = {
                        borrador: '',      // lo que hay escrito AHORA (sin esperar el debounce)
                        consulta: '',      // lo último aplicado a los resultados
                        filtros:  Object.create(null),
                        limite:   0,
                        activo:   -1,      // índice del resultado resaltado con el teclado
                        recActivo: -1,     // índice en la lista de recientes
                        timer:    null,
                        ultimo:   { coincidencias: 0, total: 0 }
                    };
                }
                return estados[key];
            }

            /**
             * Registra (o actualiza) un buscador. Se puede llamar en cada render:
             * es idempotente y conserva el estado.
             *
             * cfg.alAplicar(consulta)  sincroniza la variable global de la vista.
             * cfg.refrescar()          reescribe la región; devuelve
             *                          { coincidencias, total }.
             * cfg.debounceMs           200 por defecto (rango pedido 150-250).
             * cfg.paso                 elementos por tanda de render incremental.
             * cfg.consultaInicial      valor con el que arranca si es la 1ª vez.
             */
            function registrar(key, cfg) {
                var previo = registros[key];
                registros[key] = Object.assign({
                    debounceMs: 200,
                    paso: 60,
                    historial: true,
                    modoNumerico: true
                }, previo || {}, cfg || {});
                var st = _estado(key);
                if (!previo) {
                    var ini = (cfg && cfg.consultaInicial) || '';
                    st.borrador = ini;
                    st.consulta = ini;
                    st.limite   = registros[key].paso;
                }
                return st;
            }

            function consulta(key) { return _estado(key).consulta; }
            function limite(key)   { var st = _estado(key); return st.limite || (registros[key] ? registros[key].paso : 60); }
            function filtros(key)  { return _estado(key).filtros; }
            function filtroActivo(key, id) { return !!_estado(key).filtros[id]; }

            // ── Marcado ──────────────────────────────────────────────────────

            var ICONO_LUPA = '<svg class="sbx__icono" aria-hidden="true" focusable="false" fill="none" viewBox="0 0 24 24">'
                + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>';

            /**
             * Barra de búsqueda. opts: { placeholder, etiqueta, sticky }
             */
            function barra(key, opts) {
                opts = opts || {};
                var st  = _estado(key);
                var cfg = registros[key] || {};
                var id  = _idSeguro(key);
                // Si otra parte de la app cambió la variable de la vista (salir
                // del conteo la vacía, restaurar un respaldo la pisa), esa gana —
                // salvo que el usuario esté escribiendo en este momento.
                if (typeof cfg.obtenerConsulta === 'function' && !st.timer) {
                    var externa = cfg.obtenerConsulta() || '';
                    if (externa !== st.consulta) {
                        st.consulta = externa;
                        st.borrador = externa;
                        st.limite   = cfg.paso || 60;
                    }
                }
                var numerico = cfg.modoNumerico && _lsGet('inventarioApp_busqModo_' + key, false) === true;
                var conTexto = st.borrador !== '';
                var h = '';
                h += '<div class="sbx' + (conTexto ? ' sbx--texto' : '') + (opts.sticky ? ' sbx--sticky' : '') + '"'
                   + ' id="sbx-' + id + '" data-sbx="' + _esc(key) + '" role="search">';
                h += '<label class="sbx-sr" for="sbx-input-' + id + '">' + _esc(opts.etiqueta || 'Buscar') + '</label>';
                h += ICONO_LUPA;
                h += '<input id="sbx-input-' + id + '" class="sbx__input" type="search"'
                   + ' value="' + _esc(st.borrador) + '"'
                   + ' placeholder="' + _esc(opts.placeholder || 'Buscar…') + '"'
                   + ' inputmode="' + (numerico ? 'numeric' : 'search') + '"'
                   + ' enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"'
                   + ' role="combobox" aria-autocomplete="list" aria-expanded="false"'
                   + ' aria-controls="sbx-res-' + id + '" aria-describedby="sbx-estado-' + id + '">';
                if (cfg.modoNumerico) {
                    h += '<button type="button" class="sbx__modo' + (numerico ? ' sbx__modo--on' : '') + '" data-sbx-accion="modo"'
                       + ' aria-pressed="' + numerico + '" title="Teclado numérico para buscar por código o SKU"'
                       + ' aria-label="Teclado numérico para buscar por código">123</button>';
                }
                h += '<button type="button" class="sbx__limpiar" data-sbx-accion="limpiar" aria-label="Limpiar búsqueda" title="Limpiar (Esc)">'
                   + '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none"><path stroke-linecap="round" stroke-width="2.4" d="M6 6l12 12M18 6L6 18"/></svg></button>';
                h += '<div class="sbx__recientes" id="sbx-rec-' + id + '" role="listbox" aria-label="Búsquedas recientes" hidden></div>';
                h += '</div>';
                h += '<div class="sbx-sr" id="sbx-estado-' + id + '" role="status" aria-live="polite"></div>';
                return h;
            }

            /**
             * Chips de filtro. lista: [{ id, etiqueta, contador?, grupo? }]
             * Los chips del mismo `grupo` son excluyentes (tipo segmento).
             */
            function chips(key, lista) {
                if (!lista || !lista.length) return '';
                var st = _estado(key);
                var h = '<div class="sbx-chips" role="group" aria-label="Filtros rápidos" data-sbx-chips="' + _esc(key) + '">';
                lista.forEach(function(c) {
                    var on = !!st.filtros[c.id];
                    h += '<button type="button" class="sbx-chip' + (on ? ' sbx-chip--on' : '') + '"'
                       + ' data-sbx-accion="filtro" data-sbx-filtro="' + _esc(c.id) + '"'
                       + (c.grupo ? ' data-sbx-grupo="' + _esc(c.grupo) + '"' : '')
                       + ' aria-pressed="' + on + '">'
                       + _esc(c.etiqueta)
                       + (typeof c.contador === 'number' ? ' <span class="sbx-chip__n">' + c.contador + '</span>' : '')
                       + '</button>';
                });
                return h + '</div>';
            }

            /** Envoltura de la región de resultados de una vista. */
            function region(key, htmlInterior) {
                var id = _idSeguro(key);
                return '<div class="sbx-res" id="sbx-res-' + id + '" data-sbx-results="' + _esc(key) + '">'
                     + (htmlInterior || '') + '</div>';
            }

            /** "12 de 487 productos" — o el total solo si no hay búsqueda ni filtro. */
            function resumen(key, coincidencias, total, singular, plural) {
                var st = _estado(key);
                st.ultimo = { coincidencias: coincidencias, total: total };
                var hayFiltro = st.consulta !== '' || Object.keys(st.filtros).length > 0;
                var sust = function(n) { return n === 1 ? singular : plural; };
                var h = '<div class="sbx-resumen" aria-hidden="true">';
                if (hayFiltro) {
                    h += '<span class="sbx-resumen__n">' + coincidencias + '</span> de ' + total + ' ' + _esc(sust(total));
                    if (st.consulta) h += ' <span class="sbx-resumen__q">para “' + _esc(st.consulta) + '”</span>';
                } else {
                    h += '<span class="sbx-resumen__n">' + total + '</span> ' + _esc(sust(total));
                }
                h += '<span class="sbx-resumen__kbd">↑↓ navegar · Enter abrir · Esc limpiar</span>';
                return h + '</div>';
            }

            /** Estado vacío profesional, con salida explícita. */
            function vacio(key, sustantivoPlural) {
                var st = _estado(key);
                var hayFiltros = Object.keys(st.filtros).length > 0;
                var h = '<div class="sbx-vacio" role="note">';
                h += '<div class="sbx-vacio__icono" aria-hidden="true">🔍</div>';
                if (st.consulta) {
                    h += '<div class="sbx-vacio__titulo">No se encontró “' + _esc(st.consulta) + '”</div>';
                    h += '<div class="sbx-vacio__texto">Prueba con otra palabra, el código del producto'
                       + (hayFiltros ? ' o revisa los filtros activos' : '') + '.</div>';
                } else {
                    h += '<div class="sbx-vacio__titulo">Ningún ' + _esc(sustantivoPlural || 'resultado') + ' con estos filtros</div>';
                    h += '<div class="sbx-vacio__texto">Quita un filtro para ver más.</div>';
                }
                h += '<div class="sbx-vacio__acciones">';
                if (st.consulta) h += '<button type="button" class="sbx-btn" data-sbx-accion="limpiar" data-sbx-key="' + _esc(key) + '">Limpiar búsqueda</button>';
                if (hayFiltros)  h += '<button type="button" class="sbx-btn" data-sbx-accion="quitar-filtros" data-sbx-key="' + _esc(key) + '">Quitar filtros</button>';
                h += '</div></div>';
                return h;
            }

            /**
             * Botón "Mostrar N más" + centinela para carga automática al llegar
             * al final (IntersectionObserver). Render incremental: con 2000
             * productos no se pintan 2000 tarjetas de golpe.
             */
            function centinela(key, restantes) {
                if (!(restantes > 0)) return '';
                var cfg = registros[key] || {};
                var n = Math.min(restantes, cfg.paso || 60);
                return '<div class="sbx-mas" data-sbx-mas="' + _esc(key) + '">'
                     + '<button type="button" class="sbx-btn" data-sbx-accion="mas" data-sbx-key="' + _esc(key) + '">'
                     + 'Mostrar ' + n + ' más <span class="sbx-mas__resto">(' + restantes + ' restantes)</span></button></div>';
            }

            // ── Acciones ─────────────────────────────────────────────────────

            function _anunciar(key, texto) {
                var el = document.getElementById('sbx-estado-' + _idSeguro(key));
                if (el) el.textContent = texto;
            }

            function refrescar(key, opciones) {
                var cfg = registros[key];
                if (!cfg || typeof cfg.refrescar !== 'function') return;
                var reg = document.getElementById('sbx-res-' + _idSeguro(key));
                if (!reg) return;   // la vista no está en pantalla: nada que pintar
                var st = _estado(key);
                st.activo = -1;
                _ponerActivo(key, -1);
                var r = cfg.refrescar() || st.ultimo;
                if (!(opciones && opciones.sinAnimacion === false)) {
                    // Solo un fundido de la región completa; nada de cascadas
                    // por tarjeta en cada tecla.
                    reg.classList.remove('sbx-res--refresco');
                    void reg.offsetWidth;
                    reg.classList.add('sbx-res--refresco');
                }
                _observarCentinelas();
                if (st.consulta || Object.keys(st.filtros).length) {
                    _anunciar(key, r.coincidencias === 0
                        ? 'Sin resultados'
                        : r.coincidencias + ' de ' + r.total + ' resultados');
                } else {
                    _anunciar(key, '');
                }
            }

            function _aplicar(key, valor, opciones) {
                var st  = _estado(key);
                var cfg = registros[key];
                clearTimeout(st.timer);
                st.timer = null;
                var v = (valor || '').replace(/\s+/g, ' ').trim();
                var forzar = opciones && opciones.forzar;
                if (v === st.consulta && !forzar) return;
                st.consulta = v;
                st.limite   = cfg ? cfg.paso : 60;
                if (cfg && typeof cfg.alAplicar === 'function') {
                    try { cfg.alAplicar(v); } catch (e) { console.warn('[Busqueda] alAplicar', e); }
                }
                refrescar(key);
            }

            function establecer(key, valor) {
                var st = _estado(key);
                st.borrador = valor || '';
                var wrap = document.getElementById('sbx-' + _idSeguro(key));
                if (wrap) {
                    var inp = wrap.querySelector('.sbx__input');
                    if (inp && inp.value !== st.borrador) inp.value = st.borrador;
                    wrap.classList.toggle('sbx--texto', st.borrador !== '');
                }
                _aplicar(key, st.borrador);
            }

            function limpiar(key, enfocar) {
                establecer(key, '');
                if (enfocar !== false) {
                    var inp = document.getElementById('sbx-input-' + _idSeguro(key));
                    if (inp) {
                        inp.focus();
                        // Si ya tenía el foco no hay focusin: se ofrecen aquí.
                        _mostrarRecientes(key, true);
                    }
                }
            }

            function alternarFiltro(key, id, grupo) {
                var st = _estado(key);
                var on = !st.filtros[id];
                if (grupo) {
                    // Excluyentes: apagar los demás del mismo grupo.
                    var chipsDom = document.querySelectorAll('[data-sbx-chips="' + key + '"] [data-sbx-grupo="' + grupo + '"]');
                    Array.prototype.forEach.call(chipsDom, function(b) { delete st.filtros[b.getAttribute('data-sbx-filtro')]; });
                }
                if (on) st.filtros[id] = true; else delete st.filtros[id];
                _pintarChips(key);
                st.limite = (registros[key] || {}).paso || 60;
                refrescar(key);
            }

            function quitarFiltros(key) {
                _estado(key).filtros = Object.create(null);
                _pintarChips(key);
                refrescar(key);
            }

            function _pintarChips(key) {
                var st = _estado(key);
                var cont = document.querySelector('[data-sbx-chips="' + key + '"]');
                if (!cont) return;
                Array.prototype.forEach.call(cont.querySelectorAll('.sbx-chip'), function(b) {
                    var on = !!st.filtros[b.getAttribute('data-sbx-filtro')];
                    b.classList.toggle('sbx-chip--on', on);
                    b.setAttribute('aria-pressed', String(on));
                });
            }

            function mas(key) {
                var st = _estado(key);
                st.limite += (registros[key] || {}).paso || 60;
                refrescar(key, { sinAnimacion: false });
            }

            // ── Historial de búsquedas recientes ─────────────────────────────

            function _histClave(key) { return 'inventarioApp_busqRecientes_' + key; }
            function historial(key) {
                var h = _lsGet(_histClave(key), []);
                return Array.isArray(h) ? h.filter(function(x) { return typeof x === 'string' && x; }).slice(0, HIST_MAX) : [];
            }
            function _guardarHistorial(key) {
                var cfg = registros[key];
                var st  = _estado(key);
                if (!cfg || !cfg.historial) return;
                var q = st.consulta;
                if (!q || q.length < 2 || !(st.ultimo && st.ultimo.coincidencias > 0)) return;
                var normQ = typeof normalizarBusqueda === 'function' ? normalizarBusqueda(q) : q.toLowerCase();
                var lista = historial(key).filter(function(x) {
                    var nx = typeof normalizarBusqueda === 'function' ? normalizarBusqueda(x) : x.toLowerCase();
                    // "tequila" y luego "tequila don": se queda solo la más completa.
                    return nx !== normQ && normQ.indexOf(nx) !== 0;
                });
                lista.unshift(q);
                _lsSet(_histClave(key), lista.slice(0, HIST_MAX));
            }
            function _borrarHistorial(key) { _lsSet(_histClave(key), []); }

            function _mostrarRecientes(key, mostrar) {
                var id = _idSeguro(key);
                var cont = document.getElementById('sbx-rec-' + id);
                var inp  = document.getElementById('sbx-input-' + id);
                if (!cont || !inp) return;
                var st = _estado(key);
                var lista = mostrar ? historial(key) : [];
                if (!lista.length) {
                    cont.hidden = true; cont.innerHTML = '';
                    inp.setAttribute('aria-expanded', 'false');
                    st.recActivo = -1;
                    return;
                }
                var h = '<div class="sbx__rec-cab"><span>Recientes</span>'
                      + '<button type="button" class="sbx__rec-borrar" data-sbx-accion="borrar-recientes">Borrar</button></div>';
                lista.forEach(function(q, i) {
                    h += '<button type="button" role="option" id="sbx-rec-' + id + '-' + i + '" class="sbx__rec-item"'
                       + ' data-sbx-accion="reciente" data-sbx-valor="' + _esc(q) + '" aria-selected="false">'
                       + '<span aria-hidden="true">↺</span> ' + _esc(q) + '</button>';
                });
                cont.innerHTML = h;
                cont.hidden = false;
                inp.setAttribute('aria-expanded', 'true');
                st.recActivo = -1;
            }
            function _recientesAbiertos(key) {
                var cont = document.getElementById('sbx-rec-' + _idSeguro(key));
                return !!(cont && !cont.hidden);
            }

            // ── Navegación con teclado sobre los resultados ──────────────────

            function _items(key) {
                var reg = document.getElementById('sbx-res-' + _idSeguro(key));
                return reg ? reg.querySelectorAll('[data-sbx-item]') : [];
            }
            function _ponerActivo(key, i) {
                var id  = _idSeguro(key);
                var its = _items(key);
                var inp = document.getElementById('sbx-input-' + id);
                Array.prototype.forEach.call(its, function(el, k) {
                    if (!el.id) el.id = 'sbx-item-' + id + '-' + k;
                    var on = k === i;
                    el.classList.toggle('sbx-activo', on);
                    el.setAttribute('aria-selected', String(on));
                });
                if (inp) {
                    if (i >= 0 && its[i]) {
                        inp.setAttribute('aria-activedescendant', its[i].id);
                        its[i].scrollIntoView({ block: 'nearest' });
                    } else {
                        inp.removeAttribute('aria-activedescendant');
                    }
                }
            }
            function _moverActivo(key, delta) {
                var st  = _estado(key);
                var its = _items(key);
                if (!its.length) return;
                var n = its.length;
                var i = st.activo + delta;
                if (i < 0) i = n - 1;
                if (i >= n) i = 0;
                st.activo = i;
                _ponerActivo(key, i);
            }
            function _elegirActivo(key) {
                var st  = _estado(key);
                var its = _items(key);
                var el  = its[st.activo];
                if (!el) return false;
                _guardarHistorial(key);
                var principal = el.querySelector('[data-sbx-principal]') || el;
                principal.click();
                return true;
            }

            function _recMover(key, delta) {
                var id = _idSeguro(key);
                var cont = document.getElementById('sbx-rec-' + id);
                var inp  = document.getElementById('sbx-input-' + id);
                if (!cont) return;
                var ops = cont.querySelectorAll('[role="option"]');
                if (!ops.length) return;
                var st = _estado(key);
                var i = st.recActivo + delta;
                if (i < 0) i = ops.length - 1;
                if (i >= ops.length) i = 0;
                st.recActivo = i;
                Array.prototype.forEach.call(ops, function(o, k) {
                    o.classList.toggle('sbx-activo', k === i);
                    o.setAttribute('aria-selected', String(k === i));
                });
                if (inp) inp.setAttribute('aria-activedescendant', ops[i].id);
            }

            // ── Carga incremental automática ─────────────────────────────────

            function _observarCentinelas() {
                if (typeof IntersectionObserver === 'undefined') return;   // queda el botón
                if (!_observador) {
                    _observador = new IntersectionObserver(function(entradas) {
                        entradas.forEach(function(e) {
                            if (!e.isIntersecting) return;
                            _observador.unobserve(e.target);
                            var key = e.target.getAttribute('data-sbx-mas');
                            if (key) mas(key);
                        });
                    }, { rootMargin: '600px 0px' });
                }
                Array.prototype.forEach.call(document.querySelectorAll('[data-sbx-mas]'), function(el) {
                    _observador.observe(el);
                });
            }

            // ── Altura del encabezado fijo, para la barra pegajosa en móvil ──
            function _medirEncabezado() {
                // Solo cuenta si de verdad está pegado arriba: en el teléfono el
                // tema lo deja estático y el desplazamiento ocurre en otro
                // contenedor; ahí la barra debe pegarse en 0.
                var head = document.querySelector('.sticky.top-0.z-50');
                var pos  = head ? getComputedStyle(head).position : '';
                var alto = (head && (pos === 'sticky' || pos === 'fixed')) ? head.getBoundingClientRect().height : 0;
                // Franja "PRUEBAS · …" (solo fuera de producción): es fija arriba.
                var banda = document.getElementById('bannerEntorno');
                if (banda) alto += banda.getBoundingClientRect().height;
                document.documentElement.style.setProperty('--sbx-top', Math.round(alto) + 'px');
            }

            /** renderTab() lo llama después de cada innerHTML. */
            function trasRender() {
                Object.keys(estados).forEach(function(k) { estados[k].activo = -1; estados[k].recActivo = -1; });
                _observarCentinelas();
                _medirEncabezado();
            }

            // ── Eventos delegados ────────────────────────────────────────────

            function _keyDe(el) {
                var w = el && el.closest ? el.closest('[data-sbx]') : null;
                if (w) return w.getAttribute('data-sbx');
                var k = el && el.closest ? el.closest('[data-sbx-key],[data-sbx-chips],[data-sbx-results]') : null;
                if (!k) return null;
                return k.getAttribute('data-sbx-key') || k.getAttribute('data-sbx-chips') || k.getAttribute('data-sbx-results');
            }
            function _esTactil() {
                try { return window.matchMedia && window.matchMedia('(pointer: coarse)').matches; }
                catch (_) { return false; }
            }

            function _alEscribir(e) {
                var inp = e.target;
                if (!inp.classList || !inp.classList.contains('sbx__input')) return;
                var key = _keyDe(inp);
                if (!key || !registros[key]) return;
                var st  = _estado(key);
                var cfg = registros[key];
                // No se ignora `isComposing`: Gboard en Android compone CADA
                // palabra en español; ignorarlo dejaría la búsqueda muda hasta
                // tocar espacio.
                st.borrador = inp.value;
                var wrap = inp.closest('.sbx');
                if (wrap) wrap.classList.toggle('sbx--texto', inp.value !== '');
                _mostrarRecientes(key, inp.value === '');
                clearTimeout(st.timer);
                if (inp.value.trim() === '') { _aplicar(key, ''); return; }   // borrar es instantáneo
                st.timer = setTimeout(function() { _aplicar(key, st.borrador); }, cfg.debounceMs);
            }

            function _alTecla(e) {
                var inp = e.target;
                if (!inp.classList || !inp.classList.contains('sbx__input')) return;
                var key = _keyDe(inp);
                if (!key || !registros[key]) return;
                var st = _estado(key);
                var rec = _recientesAbiertos(key);
                switch (e.key) {
                    case 'ArrowDown':
                        e.preventDefault();
                        if (rec) _recMover(key, 1); else { _aplicar(key, st.borrador); _moverActivo(key, 1); }
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        if (rec) _recMover(key, -1); else _moverActivo(key, -1);
                        break;
                    case 'Enter':
                        e.preventDefault();
                        if (rec && st.recActivo >= 0) {
                            var op = document.getElementById('sbx-rec-' + _idSeguro(key) + '-' + st.recActivo);
                            if (op) op.click();
                            break;
                        }
                        _aplicar(key, st.borrador);           // sin esperar el debounce
                        if (st.activo >= 0 && _elegirActivo(key)) break;
                        _guardarHistorial(key);
                        // En el teléfono, "buscar" esconde el teclado para ver resultados.
                        if (_esTactil()) inp.blur();
                        break;
                    case 'Escape':
                        e.preventDefault();
                        e.stopPropagation();   // el conteo escucha Escape para salir del área
                        if (rec) { _mostrarRecientes(key, false); break; }
                        if (inp.value !== '') limpiar(key, true);
                        else inp.blur();
                        break;
                    case 'Home':
                    case 'End':
                        if (st.activo >= 0) {
                            e.preventDefault();
                            var n = _items(key).length;
                            st.activo = e.key === 'Home' ? 0 : n - 1;
                            _ponerActivo(key, st.activo);
                        }
                        break;
                }
            }

            function _alClick(e) {
                var btn = e.target.closest ? e.target.closest('[data-sbx-accion]') : null;
                if (!btn) {
                    // Elegir un resultado con el dedo también cuenta como búsqueda útil.
                    var item = e.target.closest ? e.target.closest('[data-sbx-item]') : null;
                    if (item) { var kk = _keyDe(item); if (kk) _guardarHistorial(kk); }
                    return;
                }
                var key = _keyDe(btn);
                if (!key) return;
                var accion = btn.getAttribute('data-sbx-accion');
                var id = _idSeguro(key);
                switch (accion) {
                    case 'limpiar':
                        e.preventDefault();
                        limpiar(key, true);
                        break;
                    case 'modo': {
                        e.preventDefault();
                        var inp = document.getElementById('sbx-input-' + id);
                        var on = !(inp && inp.getAttribute('inputmode') === 'numeric');
                        _lsSet('inventarioApp_busqModo_' + key, on);
                        if (inp) {
                            inp.setAttribute('inputmode', on ? 'numeric' : 'search');
                            // Para que el teclado cambie hay que volver a enfocar.
                            inp.blur(); inp.focus();
                        }
                        btn.classList.toggle('sbx__modo--on', on);
                        btn.setAttribute('aria-pressed', String(on));
                        break;
                    }
                    case 'reciente': {
                        e.preventDefault();
                        var v = btn.getAttribute('data-sbx-valor') || '';
                        _mostrarRecientes(key, false);
                        establecer(key, v);
                        var inp2 = document.getElementById('sbx-input-' + id);
                        if (inp2) inp2.focus();
                        break;
                    }
                    case 'borrar-recientes':
                        e.preventDefault();
                        _borrarHistorial(key);
                        _mostrarRecientes(key, false);
                        break;
                    case 'filtro':
                        e.preventDefault();
                        alternarFiltro(key, btn.getAttribute('data-sbx-filtro'), btn.getAttribute('data-sbx-grupo'));
                        break;
                    case 'quitar-filtros':
                        e.preventDefault();
                        quitarFiltros(key);
                        break;
                    case 'mas':
                        e.preventDefault();
                        mas(key);
                        break;
                }
            }

            function _alEnfocar(e) {
                var inp = e.target;
                if (!inp.classList || !inp.classList.contains('sbx__input')) return;
                var key = _keyDe(inp);
                if (!key) return;
                if (inp.value === '') _mostrarRecientes(key, true);
                var cfg = registros[key];
                // Precalentar el índice mientras el usuario piensa qué escribir:
                // el primer resultado ya no paga el costo de normalizar todo.
                if (cfg && typeof cfg.precalentar === 'function') {
                    var ric = window.requestIdleCallback || function(f) { return setTimeout(f, 30); };
                    ric(function() { try { cfg.precalentar(); } catch (_) {} });
                }
            }

            function _alDesenfocar(e) {
                var inp = e.target;
                if (!inp.classList || !inp.classList.contains('sbx__input')) return;
                var key = _keyDe(inp);
                if (!key) return;
                var wrap = inp.closest('.sbx');
                // Si el foco se va a un botón de la propia barra (recientes,
                // limpiar), no se cierra todavía o el clic no llegaría.
                if (wrap && e.relatedTarget && wrap.contains(e.relatedTarget)) return;
                setTimeout(function() { _mostrarRecientes(key, false); }, 120);
                _guardarHistorial(key);
            }

            if (typeof document !== 'undefined' && document.addEventListener) {
                document.addEventListener('input',    _alEscribir,    true);
                document.addEventListener('keydown',  _alTecla,       true);
                document.addEventListener('click',    _alClick,       false);
                document.addEventListener('focusin',  _alEnfocar,     false);
                document.addEventListener('focusout', _alDesenfocar,  false);
                if (typeof window !== 'undefined' && window.addEventListener) {
                    window.addEventListener('resize', _medirEncabezado, { passive: true });
                }
            }

            return {
                registrar: registrar,
                barra: barra,
                chips: chips,
                region: region,
                resumen: resumen,
                vacio: vacio,
                centinela: centinela,
                consulta: consulta,
                limite: limite,
                filtros: filtros,
                filtroActivo: filtroActivo,
                establecer: establecer,
                limpiar: limpiar,
                refrescar: refrescar,
                historial: historial,
                trasRender: trasRender,
                // Expuestos para pruebas:
                _estado: _estado,
                _aplicar: _aplicar
            };
        })();
