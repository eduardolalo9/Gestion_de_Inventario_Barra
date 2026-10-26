        // ══════════════════════════════════════════════════════════════════════
        //  v5.34 — MI PERFIL (Etapa 1) · overlay de SOLO LECTURA
        //  ────────────────────────────────────────────────────────────────────
        //  Decisiones de Eduardo (26-oct-2026):
        //    · Es un overlay/modal. NO es una pestaña: no pasa por switchTab(),
        //      no toca activeTab, TABS_VALIDAS ni TABS_COMPARTIBLES, y renderTab()
        //      no tiene un case 'perfil'. Por eso no se guarda ni se sincroniza.
        //    · Nombre visible = usuarios/{uid}.displayName, campo deshabilitado.
        //    · Si se recarga con el overlay abierto, la app abre en Inicio: el
        //      estado del overlay vive solo en el DOM (nada en localStorage,
        //      IndexedDB ni Firestore).
        //    · Acceso: icono de persona en la cabecera y "Mi perfil" en Más.
        //    · Áreas de conteo: aquí solo se MUESTRAN. Crear/editar sigue en
        //      Ajustes hasta demostrar la consistencia entre dispositivos.
        //    · Unidades de medida (nivel 1): informativo — las que el catálogo
        //      ya usa, con cuántos productos. No hay catálogo editable.
        //
        //  Este módulo SOLO LEE: _lastUserData, currentUserRole, areasConteoDef,
        //  products y auditCurrentUser. No escribe en ninguno, no llama a
        //  saveToLocalStorage() ni a syncToCloud().
        // ══════════════════════════════════════════════════════════════════════

        var _perfilAbridor = null;     // elemento que tenía el foco al abrir
        var _perfilEscHandler = null;

        function _pfT(v) { return escapeHtml(String(v == null ? '' : v)); }

        function _perfilEnLogin() {
            var l = document.getElementById('loginScreen');
            return !!l && !l.classList.contains('auth-hidden');
        }

        /** Reúne lo que se muestra. Cada lectura tolera que el dato aún no exista. */
        function _perfilDatos() {
            var u = (typeof _lastUserData !== 'undefined' && _lastUserData) ? _lastUserData : null;
            var authUser = null;
            try { authUser = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null; } catch (_) { authUser = null; }

            var email  = (u && u.email) || (authUser && authUser.email) || '';
            var nombre = (u && u.displayName) || email || '';
            var rolRaw = (u && u.role) || (typeof currentUserRole !== 'undefined' ? currentUserRole : null) || '';
            var rolId  = (rolRaw && typeof _roleCanonico === 'function') ? _roleCanonico(rolRaw) : '';
            var rolNom = (rolId && typeof ROLES_SISTEMA_DEFECTO !== 'undefined' && ROLES_SISTEMA_DEFECTO[rolId] && ROLES_SISTEMA_DEFECTO[rolId].nombre) || rolId || '';

            return {
                cargado:  !!(u || authUser),
                nombre:   nombre,
                email:    email,
                rolId:    rolId,
                rolNom:   rolNom,
                inactivo: !!(u && u.status === 'inactivo'),
                alias:    (typeof auditCurrentUser !== 'undefined' && auditCurrentUser && auditCurrentUser.userName) || ''
            };
        }

        function _perfilIniciales(texto) {
            var partes = String(texto || '?').trim().split(/[\s@._-]+/).filter(Boolean);
            return ((partes[0] || '?').charAt(0) + ((partes[1] || '').charAt(0) || '')).toUpperCase();
        }

        /** Áreas de conteo definidas, en su orden. Solo lectura. */
        function _perfilAreas() {
            if (typeof areasConteoDef === 'undefined' || !Array.isArray(areasConteoDef)) return [];
            return areasConteoDef.slice().sort(function(a, b) { return (a.orden || 0) - (b.orden || 0); });
        }

        /** Unidades que el catálogo usa hoy, de más a menos productos. */
        function _perfilUnidades() {
            var cuenta = {};
            var lista = (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];
            lista.forEach(function(p) {
                var u = String((p && p.unit) || '').trim();
                if (!u) u = '(sin unidad)';
                cuenta[u] = (cuenta[u] || 0) + 1;
            });
            return Object.keys(cuenta).map(function(k) { return { unidad: k, n: cuenta[k] }; })
                .sort(function(a, b) { return b.n - a.n || a.unidad.localeCompare(b.unidad, 'es'); });
        }

        function _perfilPuedeAdministrarAreas() {
            return typeof hasPermission === 'function' &&
                   (hasPermission('warehouses.create') || hasPermission('warehouses.update'));
        }

        function _perfilHtml() {
            var d = _perfilDatos();
            var h = '';

            // Identidad
            h += '<div class="pf-id">'
               + '<span class="eq-avatar eq-avatar--g" aria-hidden="true">' + _pfT(_perfilIniciales(d.nombre || d.email)) + '</span>'
               + '<div class="pf-id__txt"><div class="pf-id__nom">' + _pfT(d.nombre || 'Sin nombre') + '</div>'
               + (d.email && d.email !== d.nombre ? '<div class="pf-id__mail">' + _pfT(d.email) + '</div>' : '')
               + '</div></div>';

            if (!d.cargado) {
                h += '<p class="pf-aviso">Aún no se cargan los datos de tu cuenta. Revisa tu conexión y vuelve a abrir esta pantalla.</p>';
            }

            // Cuenta
            h += '<section class="pf-sec" aria-labelledby="pfSecCuenta"><h3 class="pf-sec__tit" id="pfSecCuenta">Cuenta</h3>'
               + '<label class="pf-campo" for="perfilNombreVisible"><span class="pf-campo__et">Nombre visible</span>'
               + '<input type="text" id="perfilNombreVisible" class="pf-input" value="' + _pfT(d.nombre) + '" disabled aria-disabled="true">'
               + '<span class="pf-campo__ayuda">Solo lectura.</span></label>'
               + '<div class="pf-fila"><span class="pf-fila__et">Correo</span><span class="pf-fila__val">' + _pfT(d.email || '—') + '</span></div>'
               + '<div class="pf-fila"><span class="pf-fila__et">Rol</span><span class="pf-fila__val">'
               + (d.rolNom ? '<span class="eq-rol eq-rol--' + _pfT(String(d.rolId).toLowerCase()) + '">' + _pfT(d.rolNom) + '</span>' : '—') + '</span></div>'
               + '<div class="pf-fila"><span class="pf-fila__et">Estado</span><span class="pf-fila__val">'
               + (d.cargado ? '<span class="eq-estado eq-estado--' + (d.inactivo ? 'inactiva' : 'activa') + '">' + (d.inactivo ? 'Inactiva' : 'Activa') + '</span>' : '—') + '</span></div>'
               + '</section>';

            // Este dispositivo (alias de conteo: es otra cosa que el nombre visible)
            if (d.alias) {
                h += '<section class="pf-sec" aria-labelledby="pfSecDisp"><h3 class="pf-sec__tit" id="pfSecDisp">Este dispositivo</h3>'
                   + '<div class="pf-fila"><span class="pf-fila__et">Nombre en el conteo</span><span class="pf-fila__val">' + _pfT(d.alias) + '</span></div>'
                   + '<p class="pf-nota">Es el nombre con el que se firman tus conteos en este equipo. No es tu nombre visible.</p></section>';
            }

            // Áreas de conteo
            var areas = _perfilAreas();
            h += '<section class="pf-sec" aria-labelledby="pfSecAreas"><h3 class="pf-sec__tit" id="pfSecAreas">Áreas de conteo</h3>';
            if (areas.length) {
                h += '<ul class="pf-lista">' + areas.map(function(a) {
                    return '<li><span aria-hidden="true">' + _pfT(a.icono || '📍') + '</span> ' + _pfT(a.nombre || a.id) + '</li>';
                }).join('') + '</ul>';
            } else {
                h += '<p class="pf-nota">No hay áreas definidas.</p>';
            }
            if (_perfilPuedeAdministrarAreas()) {
                h += '<button type="button" class="pf-btn pf-btn--sec" onclick="perfilIrAAjustes()">Administrar áreas en Ajustes</button>';
            }
            h += '</section>';

            // Unidades de medida (informativo)
            var unidades = _perfilUnidades();
            h += '<section class="pf-sec" aria-labelledby="pfSecUni"><h3 class="pf-sec__tit" id="pfSecUni">Unidades de medida en uso</h3>';
            if (unidades.length) {
                h += '<ul class="pf-lista pf-lista--uni">' + unidades.map(function(x) {
                    return '<li><span>' + _pfT(x.unidad) + '</span><span class="pf-n">' + x.n + ' producto' + (x.n === 1 ? '' : 's') + '</span></li>';
                }).join('') + '</ul>';
            } else {
                h += '<p class="pf-nota">El catálogo aún no tiene productos.</p>';
            }
            h += '</section>';

            h += '<button type="button" class="pf-btn pf-btn--salir" onclick="cerrarMiPerfil(); signOutUser()">Cerrar sesión</button>';
            return h;
        }

        function abrirMiPerfil() {
            if (_perfilEnLogin()) return;
            var ov = document.getElementById('perfilOverlay');
            var cuerpo = document.getElementById('perfilCuerpo');
            if (!ov || !cuerpo) return;

            var yaAbierto = !ov.classList.contains('hidden');
            if (!yaAbierto) _perfilAbridor = document.activeElement;

            try { cuerpo.innerHTML = _perfilHtml(); }
            catch (e) {
                console.warn('[Perfil] No se pudo pintar:', e);
                cuerpo.innerHTML = '<p class="pf-aviso">No se pudo mostrar tu perfil. Cierra e intenta de nuevo.</p>';
            }
            ov.classList.remove('hidden');
            if (yaAbierto) return;

            _perfilEscHandler = function(ev) { if (ev.key === 'Escape') cerrarMiPerfil(); };
            document.addEventListener('keydown', _perfilEscHandler);
            setTimeout(function() { var b = document.getElementById('perfilCerrarBtn'); if (b) b.focus(); }, 30);
        }

        function cerrarMiPerfil() {
            var ov = document.getElementById('perfilOverlay');
            if (!ov || ov.classList.contains('hidden')) return;
            ov.classList.add('hidden');
            if (_perfilEscHandler) { document.removeEventListener('keydown', _perfilEscHandler); _perfilEscHandler = null; }
            var a = _perfilAbridor; _perfilAbridor = null;
            if (a && typeof a.focus === 'function' && document.body.contains(a)) { try { a.focus(); } catch (_) {} }
        }

        /** Único camino de salida hacia una pestaña: usa la navegación de siempre. */
        function perfilIrAAjustes() {
            cerrarMiPerfil();
            if (typeof switchTab === 'function') switchTab('ajustes');
        }

        window.abrirMiPerfil     = abrirMiPerfil;
        window.cerrarMiPerfil    = cerrarMiPerfil;
        window.perfilIrAAjustes  = perfilIrAAjustes;
