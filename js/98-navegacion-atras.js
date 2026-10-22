        // ══════════════════════════════════════════════════════════════════════
        //  v5.31 — BOTÓN ATRÁS DE ANDROID (navegación interna)
        //  ────────────────────────────────────────────────────────────────────
        //  Encargo de Eduardo (20-oct-2026). Antes la app no tenía historial
        //  propio: una sola entrada, así que Atrás (botón o gesto de Android)
        //  cerraba la PWA instalada o salía del sitio en el navegador.
        //
        //  Cómo funciona — UNA entrada "guardia" en el historial:
        //    · La entrada actual queda como base y, al primer toque, se añade
        //      UNA guardia encima (history.pushState). Nunca hay más de dos: no
        //      se crean ciclos ni el historial crece al navegar.
        //    · Atrás quita la guardia y dispara popstate. Aquí se decide qué
        //      significa "atrás" DENTRO de la app y se vuelve a poner la guardia.
        //
        //  Qué hace Atrás, en este orden (lo de más arriba primero):
        //    1. Confirmación abierta → su botón "Cancelar".
        //    2. Modal abierto → su función de cierre de siempre (la misma del
        //       botón Cancelar / X o de Escape). Ninguna se modificó.
        //    3. Ficha de producto, detalle de compra o menú lateral → su cierre.
        //    4. Vista previa de una importación sin confirmar → NO se descarta
        //       (sería perder la revisión sin querer): se queda y lo avisa.
        //    5. Pantalla secundaria con botón Volver visible → se pulsa ESE
        //       botón: hace exactamente lo mismo que si lo tocaras.
        //    6. Otra pestaña → Inicio (destino principal, regla de Android).
        //    7. Inicio → "Pulsa Atrás otra vez para salir". Un segundo Atrás en
        //       2 s sale (decisión de Eduardo: doble Atrás para salir).
        //
        //  No cambia ninguna función existente ni su firma: solo las LLAMA.
        //  Los conteos guardados no dependen de esto (se guardan al capturar).
        // ══════════════════════════════════════════════════════════════════════

        var NAV_ATRAS_VENTANA_MS = 2000;
        var _navAtras = { iniciado: false, rearme: null, ultimoEnInicio: 0 };

        function _navVisible(id) {
            var e = (typeof document !== 'undefined') ? document.getElementById(id) : null;
            return !!e && !e.classList.contains('hidden');
        }
        function _navLlamar(nombre) {
            var f = (typeof window !== 'undefined') ? window[nombre] : null;
            if (typeof f === 'function') { f(); return true; }
            return false;
        }

        /** Capas que cierra Atrás, de la de más arriba a la de más abajo. */
        var NAV_CAPAS = [
            { nombre: 'confirmación', abierta: function() { return !!document.getElementById('_cfmCancel'); },
              cerrar: function() { document.getElementById('_cfmCancel').click(); } },
            { nombre: 'fecha de recuento', abierta: function() { return _navVisible('regFechaRecuentoModal'); },
              cerrar: function() { return _navLlamar('cerrarModalRegistrarFechaRecuento'); } },
            { nombre: 'nuevo inventario', abierta: function() { return _navVisible('nuevoInventarioModal'); },
              cerrar: function() { return _navLlamar('cerrarModalNuevoInventario'); } },
            { nombre: 'receta', abierta: function() { return _navVisible('recetaModal'); },
              cerrar: function() { return _navLlamar('closeRecetaModal'); } },
            { nombre: 'captura de conteo', abierta: function() { return _navVisible('inventarioModal'); },
              cerrar: function() { return _navLlamar('closeInventarioModal'); } },
            { nombre: 'pedido', abierta: function() { return _navVisible('orderModal'); },
              cerrar: function() { return _navLlamar('closeOrderModal'); } },
            { nombre: 'producto', abierta: function() { return _navVisible('productModal'); },
              cerrar: function() { return _navLlamar('closeProductModal'); } },
            { nombre: 'detalle de compra', abierta: function() { return !!document.getElementById('cd-wrap'); },
              cerrar: function() { return _navLlamar('comprasCerrarDetalle'); } },
            { nombre: 'ficha de producto', abierta: function() { return !!document.getElementById('pm-ficha-wrap'); },
              cerrar: function() { return _navLlamar('cerrarFichaProducto'); } },
            { nombre: 'menú', abierta: function() { var s = document.getElementById('sidebar'); return !!s && s.classList.contains('sb-open'); },
              cerrar: function() { return _navLlamar('sbClose'); } }
        ];

        /** ¿Hay una importación revisándose sin confirmar? Atrás no la descarta. */
        function _navImportacionPendiente() {
            var previa = function(x) { return x === 'vista_previa' || x === 'incidencias_previa'; };
            return previa(typeof ventasImportView !== 'undefined' ? ventasImportView : null)
                || previa(typeof comprasImportView !== 'undefined' ? comprasImportView : null)
                || previa(typeof recetarioImportView !== 'undefined' ? recetarioImportView : null)
                || !!(typeof _impPendiente !== 'undefined' && _impPendiente);
        }

        /** Botón Volver visible de la pantalla actual (el mismo que tocaría la persona). */
        var NAV_VOLVER = ['.mc-cab__volver', '.audit-back-btn', '.imp-volver'];
        function _navBotonVolver() {
            var cont = document.getElementById('tabContent');
            if (!cont) return null;
            for (var i = 0; i < NAV_VOLVER.length; i++) {
                var bs = cont.querySelectorAll(NAV_VOLVER[i]);
                for (var j = 0; j < bs.length; j++) {
                    if (bs[j].offsetParent !== null && !bs[j].disabled) return bs[j];
                }
            }
            return null;
        }

        /**
         * Aviso con el toast de siempre (showNotification). Ese toast ignora
         * mensajes normales si hubo otro en el último segundo; si este no se
         * llegó a mostrar, se reintenta una vez pasado ese segundo.
         */
        function _navAviso(msg) {
            if (typeof showNotification !== 'function') return;
            showNotification(msg);
            var t = document.getElementById('toastMessage');
            if (t && t.textContent !== msg) {
                setTimeout(function() { var t2 = document.getElementById('toastMessage'); if (!t2 || t2.textContent !== msg) showNotification(msg); }, 1050);
            }
        }

        function _navEnLogin() {
            var l = document.getElementById('loginScreen');
            return !!l && !l.classList.contains('auth-hidden');
        }

        function _navPonerGuardia() {
            if (_navAtras.rearme) { clearTimeout(_navAtras.rearme); _navAtras.rearme = null; }
            try { history.pushState({ bi: 'guardia' }, ''); } catch (_) {}
        }

        /**
         * navegacionAtras() — qué hace Atrás dentro de la app. Devuelve qué
         * hizo ('capa:<nombre>' | 'importacion' | 'volver' | 'inicio' | 'salir?').
         * La llama el listener de popstate; también sirve para pruebas.
         */
        function navegacionAtras() {
            for (var i = 0; i < NAV_CAPAS.length; i++) {
                var c = NAV_CAPAS[i];
                var abierta = false;
                try { abierta = c.abierta(); } catch (_) {}
                if (abierta) { c.cerrar(); return 'capa:' + c.nombre; }
            }
            if (_navEnLogin()) return 'salir?';
            var tab = (typeof activeTab !== 'undefined') ? activeTab : 'inicio';
            if (_navImportacionPendiente() && (tab === 'importar' || tab === 'ventas' || tab === 'compras' || tab === 'recetario')) {
                _navAviso('Termina o cancela la importación con sus botones');
                return 'importacion';
            }
            var volver = _navBotonVolver();
            if (volver) { volver.click(); return 'volver'; }
            if (tab !== 'inicio' && typeof switchTab === 'function') { switchTab('inicio'); return 'inicio'; }
            return 'salir?';
        }

        function _navAlPopstate() {
            var r = navegacionAtras();
            if (r !== 'salir?') { _navPonerGuardia(); return; }
            // En Inicio (o en el login) sin nada que cerrar: doble Atrás para salir.
            var ahora = Date.now();
            if (ahora - _navAtras.ultimoEnInicio <= NAV_ATRAS_VENTANA_MS) {
                // Segundo Atrás dentro de la ventana: no se vuelve a poner la
                // guardia y se retrocede una vez más → Android cierra la PWA
                // (o el navegador sale del sitio).
                _navAtras.ultimoEnInicio = 0;
                try { history.back(); } catch (_) {}
                return;
            }
            _navAtras.ultimoEnInicio = ahora;
            _navAviso('Pulsa Atrás otra vez para salir');
            // Se queda en la entrada base: el próximo Atrás (dentro de la
            // ventana) sale. Pasada la ventana, la guardia vuelve a ponerse.
            _navAtras.rearme = setTimeout(function() {
                _navAtras.rearme = null;
                if (!(history.state && history.state.bi === 'guardia')) _navPonerGuardia();
            }, NAV_ATRAS_VENTANA_MS);
        }

        /**
         * La guardia se pone al PRIMER toque o tecla, no al cargar: Chrome
         * (Android incluido) salta con Atrás las entradas que una página añade
         * sin que la persona haya interactuado ("history manipulation
         * intervention"). Puesta tras un toque, Atrás sí la respeta.
         * El mismo listener sirve para cancelar la ventana de "salir" si,
         * tras el aviso en Inicio, la persona sigue usando la app.
         */
        function _navAlInteractuar() {
            if (_navAtras.rearme) _navAtras.ultimoEnInicio = 0;
            if (!(history.state && history.state.bi === 'guardia')) _navPonerGuardia();
        }

        function iniciarNavegacionAtras() {
            if (_navAtras.iniciado) return;   // un solo juego de listeners, aunque se llame dos veces
            if (typeof window === 'undefined' || !window.history || typeof history.pushState !== 'function') return;
            _navAtras.iniciado = true;
            try {
                if (!(history.state && (history.state.bi === 'guardia' || history.state.bi === 'base'))) {
                    history.replaceState({ bi: 'base' }, '');
                }
            } catch (_) { return; }
            window.addEventListener('popstate', _navAlPopstate);
            document.addEventListener('pointerdown', _navAlInteractuar, true);
            document.addEventListener('keydown', _navAlInteractuar, true);
        }

        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
            window.navegacionAtras = navegacionAtras;
            window.iniciarNavegacionAtras = iniciarNavegacionAtras;
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarNavegacionAtras);
            else iniciarNavegacionAtras();
        }
