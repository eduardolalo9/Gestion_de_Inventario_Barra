        // ═════════════════════════════════════════════════════════════════════
        //  v5.17 — LA PANTALLA NO SE MUEVE BAJO LOS DEDOS (conteo por área)
        //  ───────────────────────────────────────────────────────────────────
        //  Pedido de Eduardo (5-oct-2026), en la ventana de Conteo de las tres
        //  áreas:
        //    1. "Después de contar no me mande el primer producto de arriba: se
        //       debe mantener en la última ubicación que se capturó."
        //    2. "Cada deslizamiento hacia abajo para ubicar un producto y
        //       ingresar el conteo se mantenga en la misma ubicación."
        //    3. "En el desplazamiento por grupo se mantenga en cada selección."
        //
        //  CAUSA REAL DE 1 y 2 (reproducida en Chromium a 390 px: antes 1500 px,
        //  con el modal abierto 0, al guardar 0): para que el fondo no se
        //  desplace detrás de un modal, `body.modal-open` usa
        //  `position: fixed` (el truco que exige iOS). Al fijar el body, el
        //  navegador pone la página en 0; al quitar la clase NO la regresa.
        //  Además renderTab() lee window.scrollY justo después de cerrar el
        //  modal — ya en 0 — y "restaura" 0. Resultado: después de cada captura,
        //  vuelta al primer producto.
        //
        //  CAUSA DE 3: cada selección de grupo vuelve a pintar el riel de
        //  grupos, y un riel nuevo empieza con scrollLeft = 0: el grupo elegido
        //  (si estaba a la derecha) desaparece de la vista.
        //
        //  SOLUCIÓN, en un solo lugar y para TODOS los modales:
        //    · Se recuerda la última posición mientras la página está libre.
        //    · Al abrir cualquier modal se fija `top: -Y` (el fondo se queda
        //      donde estaba, también a la vista) y al cerrarlo se vuelve a Y.
        //    · El riel de grupos recuerda su desplazamiento por pantalla y el
        //      grupo activo siempre queda visible.
        //    · Cada grupo recuerda su propia posición vertical: volver a un
        //      grupo te deja donde ibas; un grupo nuevo empieza al inicio de su
        //      lista (no al final de la anterior).
        //
        //  NO toca datos, conteos ni sincronización: solo dónde está la vista.
        //  Sin almacenamiento: las posiciones viven en memoria de la sesión.
        // ═════════════════════════════════════════════════════════════════════

        var _posUltimoY   = 0;      // última posición vertical con la página libre
        var _posBloqueo   = null;   // { y, tab } guardado al abrir un modal
        var _posRielX     = {};     // scrollLeft del riel de grupos, por pantalla
        var _posYGrupo    = {};     // posición vertical por pantalla + grupo
        var _posAncla     = null;   // { clave, top, t } tarjeta de producto que abrió el modal

        /** Ir a una posición SIN animación (html tiene scroll-behavior: smooth). */
        function posicionIrA(y) {
            var h = document.documentElement;
            var previo = h.style.scrollBehavior;
            h.style.scrollBehavior = 'auto';
            window.scrollTo(0, Math.max(0, Math.round(y || 0)));
            h.style.scrollBehavior = previo;
        }

        /** Identifica la pantalla: pestaña, y en Conteo además la vista y el área. */
        function posicionClavePantalla() {
            var tab = (typeof activeTab !== 'undefined') ? activeTab : '';
            if (tab === 'inventario') {
                var vista = (typeof auditoriaView !== 'undefined') ? auditoriaView : '';
                var area  = (typeof auditoriaAreaActiva !== 'undefined' && auditoriaAreaActiva) ? auditoriaAreaActiva : '';
                return tab + '|' + vista + '|' + area;
            }
            return tab;
        }

        function _posModalAbierto() {
            return !!(document.body && document.body.classList.contains('modal-open'));
        }

        // 1 · La última posición, solo mientras la página está libre. Cuando un
        //     modal fija el body, el navegador emite un scroll a 0: se ignora.
        window.addEventListener('scroll', function() {
            if (!_posModalAbierto()) _posUltimoY = window.scrollY || window.pageYOffset || 0;
        }, { passive: true });

        // 2 · El riel de grupos: los eventos de scroll de un elemento no suben,
        //     pero sí se ven en la fase de captura del documento.
        document.addEventListener('scroll', function(e) {
            var t = e.target;
            if (t && t.classList && t.classList.contains('grp-rail')) {
                _posRielX[posicionClavePantalla()] = t.scrollLeft;
            }
        }, { passive: true, capture: true });

        // 2b · La tarjeta que se tocó para contar. Al guardar, lo que hay ARRIBA
        //      de ella puede crecer (p. ej. aparece la barra "1 dispositivo
        //      contó esta área" con el primer conteo): regresar a la misma Y la
        //      dejaría ~35 px más abajo. Se ancla la TARJETA, no el número.
        // Posición de LAYOUT (sin transformaciones): las tarjetas entran con una
        // animación (cardIn) que las desplaza unos píxeles durante 200 ms, y
        // getBoundingClientRect() mediría esa animación, no su lugar real.
        function _posTopDocumento(el) {
            var y = 0;
            for (var n = el; n; n = n.offsetParent) y += n.offsetTop || 0;
            return y;
        }

        function _posRecordarTarjeta(e) {
            var c = e.target && e.target.closest ? e.target.closest('.inv-card') : null;
            if (!c) return;
            _posAncla = { clave: c.getAttribute('onclick'), top: _posTopDocumento(c) - (window.scrollY || 0), t: Date.now() };
        }
        document.addEventListener('click', _posRecordarTarjeta, true);
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') _posRecordarTarjeta(e);
        }, true);

        function _posAjustarAncla(ancla) {
            if (!ancla || !ancla.clave) return;
            var tarjetas = document.querySelectorAll('#tabContent .inv-card');
            for (var i = 0; i < tarjetas.length; i++) {
                if (tarjetas[i].getAttribute('onclick') === ancla.clave) {
                    var d = (_posTopDocumento(tarjetas[i]) - (window.scrollY || 0)) - ancla.top;
                    if (Math.abs(d) > 1) posicionIrA((window.scrollY || 0) + d);
                    _posUltimoY = window.scrollY || 0;
                    return;
                }
            }
        }

        // 3 · Abrir / cerrar cualquier modal (todos ponen body.modal-open).
        function _posAlCambiarModal(abierto) {
            var b = document.body;
            if (abierto) {
                if (_posBloqueo) return;               // ya estaba bloqueado
                // La tarjeta cuenta como origen solo si se tocó justo antes de abrir.
                var ancla = (_posAncla && Date.now() - _posAncla.t < 1500) ? _posAncla : null;
                _posAncla = null;
                _posBloqueo = { y: _posUltimoY, tab: (typeof activeTab !== 'undefined') ? activeTab : '', ancla: ancla };
                b.style.top = (-_posBloqueo.y) + 'px'; // el fondo se queda a la vista donde estaba
            } else {
                if (!_posBloqueo) return;
                var g = _posBloqueo;
                _posBloqueo = null;
                b.style.top = '';
                // Si el modal llevó a otra pestaña (p. ej. "Editar" desde la
                // ficha), la posición anterior ya no significa nada.
                var mismaPantalla = (typeof activeTab === 'undefined') || activeTab === g.tab;
                var y = mismaPantalla ? g.y : 0;
                posicionIrA(y);
                _posUltimoY = y;
                if (mismaPantalla) _posAjustarAncla(g.ancla);
                // Una segunda vez en el siguiente cuadro: si renderTab() acaba de
                // reconstruir la lista, su altura final llega con el layout.
                requestAnimationFrame(function() {
                    if (!_posModalAbierto() && mismaPantalla) { posicionIrA(y); _posUltimoY = y; _posAjustarAncla(g.ancla); }
                });
            }
        }

        (function _posObservarBody() {
            if (!document.body || typeof MutationObserver === 'undefined') return;
            var estaba = _posModalAbierto();
            new MutationObserver(function() {
                var ahora = _posModalAbierto();
                if (ahora !== estaba) { estaba = ahora; _posAlCambiarModal(ahora); }
            }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        })();

        /**
         * renderTab() lo llama después de pintar: el riel de grupos recupera
         * su desplazamiento y el grupo activo queda a la vista.
         */
        function posicionTrasRender() {
            var riel = document.querySelector('#tabContent .grp-rail');
            if (!riel) return;
            var x = _posRielX[posicionClavePantalla()];
            if (typeof x === 'number') riel.scrollLeft = x;
            var activo = riel.querySelector('.grp-pill--active');
            if (activo) {
                var izq = activo.offsetLeft - riel.offsetLeft;
                var der = izq + activo.offsetWidth;
                if (izq < riel.scrollLeft) riel.scrollLeft = Math.max(0, izq - 12);
                else if (der > riel.scrollLeft + riel.clientWidth) riel.scrollLeft = der - riel.clientWidth + 12;
            }
            _posRielX[posicionClavePantalla()] = riel.scrollLeft;
        }

        /** Antes de cambiar de grupo: lo que llevabas en el grupo que dejas. */
        function posicionGuardarGrupo(grupo) {
            _posYGrupo[posicionClavePantalla() + '|' + grupo] = window.scrollY || window.pageYOffset || 0;
        }

        /** Alto de lo que queda pegado arriba (encabezado de la app y del área). */
        function _posAltoPegado() {
            var alto = 0;
            ['.sticky.top-0.z-50', '.audit-count-header', '#bannerEntorno'].forEach(function(sel) {
                var el = document.querySelector(sel);
                if (!el) return;
                var cs = getComputedStyle(el);
                if (cs.position !== 'sticky' && cs.position !== 'fixed') return;
                var r = el.getBoundingClientRect();
                if (r.height > 0 && r.top <= 1) alto = Math.max(alto, r.bottom);
            });
            return alto;
        }

        /**
         * Después de cambiar de grupo: si ya lo habías visitado, vuelves a
         * donde ibas; si es nuevo, al inicio de su lista (justo bajo el riel de
         * grupos). Si estabas más arriba que el riel, no se mueve nada.
         */
        function posicionRestaurarGrupo(grupo) {
            var guardada = _posYGrupo[posicionClavePantalla() + '|' + grupo];
            var yInicial = window.scrollY || window.pageYOffset || 0;
            // Destino de un grupo nuevo: el riel de grupos justo bajo lo pegado.
            // Se mide de nuevo en cada intento: el área puede reacomodarse un
            // cuadro después (chips, barra de estado) y un número viejo dejaría
            // el riel escondido bajo el encabezado.
            function inicioDeLista() {
                var wrap = document.querySelector('#tabContent .grp-rail-wrap');
                if (!wrap) return null;
                var y = window.scrollY || window.pageYOffset || 0;
                return wrap.getBoundingClientRect().top + y - _posAltoPegado() - 8;
            }
            function aplicar() {
                var destino = (typeof guardada === 'number') ? guardada : inicioDeLista();
                if (destino === null) return;
                if (typeof guardada !== 'number' && yInicial < destino) destino = yInicial; // estaba más arriba: no se mueve
                posicionIrA(destino);
                _posUltimoY = window.scrollY || 0;
            }
            aplicar();
            // renderTab() programó su propia restauración para el siguiente
            // cuadro; esta va después y es la que manda. La última (120 ms) solo
            // corrige si la persona no ha movido la lista mientras tanto.
            requestAnimationFrame(function() { requestAnimationFrame(aplicar); });
            setTimeout(function() {
                if (Math.abs((window.scrollY || 0) - _posUltimoY) < 2) aplicar();
            }, 120);
        }

        window.posicionIrA            = posicionIrA;
        window.posicionTrasRender     = posicionTrasRender;
        window.posicionGuardarGrupo   = posicionGuardarGrupo;
        window.posicionRestaurarGrupo = posicionRestaurarGrupo;
        window.posicionClavePantalla  = posicionClavePantalla;
