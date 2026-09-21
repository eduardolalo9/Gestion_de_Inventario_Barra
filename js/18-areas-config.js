        // ══════════════════════════════════════════════════════════════════════
        //  ÁREAS DE CONTEO CONFIGURABLES — R6
        //  ────────────────────────────────────────────────────────────────────
        //  Hasta aquí las áreas eran tres constantes escritas a mano en cinco
        //  sitios distintos: el array AREAS_CONTEO y cuatro objetos de
        //  metadatos (nombres, nombres corporativos, emojis, iconos de
        //  FontAwesome). Agregar una cuarta área obligaba a editar los cinco
        //  de forma consistente, y olvidar uno produce el fallo más difícil de
        //  ver: un área que existe para contar pero no para totalizar.
        //
        //  ── La decisión de diseño que hace esto seguro ───────────────────────
        //  AREAS_CONTEO, areas, areasAuditoria, areasAuditoriaIcons y
        //  areasAuditoriaFA NO se reasignan: se MUTAN en su sitio. Son const y
        //  hay más de veinte lugares que ya las leen; reasignarlas obligaría a
        //  tocar esos veinte, y cada uno es una oportunidad de romper la
        //  sincronización. Mutándolas, todo el código existente sigue leyendo
        //  las mismas referencias y siempre ve la configuración vigente.
        //
        //  ── Lo que NO se puede tocar ────────────────────────────────────────
        //  Los identificadores almacen, barra1 y barra2 son los de producción:
        //  están dentro de cada conteo guardado, de cada inventario cerrado y
        //  de las rutas de Firestore. Renombrar uno desconectaría el histórico
        //  del presente sin dar ningún error. Por eso son áreas de sistema: se
        //  les puede cambiar la ETIQUETA que se ve en pantalla, nunca el id, y
        //  no se pueden eliminar.
        // ══════════════════════════════════════════════════════════════════════

        const AREAS_SISTEMA = ['almacen', 'barra1', 'barra2'];

        const AREAS_POR_DEFECTO = [
            { id: 'almacen', nombre: 'Almacén',           etiquetaCorta: 'Almacén',
              icono: '📦',  fa: 'fa-solid fa-warehouse',           orden: 1 },
            { id: 'barra1',  nombre: 'Barra Restaurante', etiquetaCorta: 'Barra 1',
              icono: '🍽️', fa: 'fa-solid fa-utensils',            orden: 2 },
            { id: 'barra2',  nombre: 'Barra Bar',         etiquetaCorta: 'Barra 2',
              icono: '🍸',  fa: 'fa-solid fa-martini-glass',       orden: 3 },
        ];

        // La definición viva. Se rellena en el arranque y cada vez que cambia.
        let areasConteoDef = AREAS_POR_DEFECTO.map(function(a) { return Object.assign({}, a); });

        function _esAreaDeSistema(id) { return AREAS_SISTEMA.indexOf(String(id)) !== -1; }

        /**
         * Objeto de stock inicial con TODAS las areas definidas.
         * Sustituye a los { almacen:0, barra1:0, barra2:0 } escritos a mano: con
         * una cuarta area, esos objetos la dejaban fuera y el producto no tenia
         * donde acumular lo contado alli.
         */
        function _stockInicialPorArea(valorPrimera) {
            var o = {};
            AREAS_CONTEO.forEach(function(a, i) { o[a] = (i === 0) ? (valorPrimera || 0) : 0; });
            return o;
        }

        /** Copia ordenada de la definición. Se devuelve copia para que nadie la mute por accidente. */
        function areasDefinidas() {
            return areasConteoDef
                .slice()
                .sort(function(a, b) { return (a.orden || 99) - (b.orden || 99); })
                .map(function(a) { return Object.assign({}, a); });
        }

        function areaInfo(id) {
            for (var i = 0; i < areasConteoDef.length; i++) {
                if (areasConteoDef[i].id === id) return Object.assign({}, areasConteoDef[i]);
            }
            return null;
        }

        /**
         * Vuelca la definición sobre las cinco estructuras que el resto de la
         * app ya lee. Mutación en sitio: se vacían y se rellenan, nunca se
         * reasignan.
         */
        function _sincronizarAreasDerivadas() {
            var def = areasDefinidas();

            AREAS_CONTEO.length = 0;
            def.forEach(function(a) { AREAS_CONTEO.push(a.id); });

            [areas, areasAuditoria, areasAuditoriaIcons, areasAuditoriaFA].forEach(function(o) {
                Object.keys(o).forEach(function(k) { delete o[k]; });
            });
            def.forEach(function(a) {
                areas[a.id]               = a.etiquetaCorta || a.nombre;
                areasAuditoria[a.id]      = a.nombre;
                areasAuditoriaIcons[a.id] = a.icono || '📍';
                areasAuditoriaFA[a.id]    = a.fa || 'fa-solid fa-location-dot';
            });

            // selectedArea puede estar apuntando a un área que ya no existe
            // (el administrador la eliminó desde otro dispositivo). Dejarla ahí
            // haría que el conteo se guardara bajo una clave huérfana.
            if (typeof selectedArea !== 'undefined' && AREAS_CONTEO.indexOf(selectedArea) === -1) {
                selectedArea = AREAS_CONTEO[0] || 'almacen';
            }
        }

        /**
         * Normaliza y valida una definición que llega de fuera (la nube, un
         * respaldo, localStorage). Devuelve null si no sirve: ante una
         * configuración corrupta es mejor quedarse con la de por defecto que
         * arrancar sin áreas y no poder contar.
         */
        function _normalizarDefinicionAreas(bruto) {
            if (!Array.isArray(bruto) || bruto.length === 0) return null;
            var vistos = {}, salida = [];
            bruto.forEach(function(a, i) {
                if (!a || typeof a !== 'object') return;
                var id = String(a.id || '').trim().toLowerCase();
                if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) return;
                if (vistos[id]) return;
                vistos[id] = true;
                salida.push({
                    id:            id,
                    nombre:        String(a.nombre || id).trim().slice(0, 40) || id,
                    etiquetaCorta: String(a.etiquetaCorta || a.nombre || id).trim().slice(0, 20) || id,
                    icono:         String(a.icono || '📍').slice(0, 4),
                    fa:            String(a.fa || 'fa-solid fa-location-dot').slice(0, 60),
                    orden:         (typeof a.orden === 'number' && isFinite(a.orden)) ? a.orden : (i + 1)
                });
            });
            if (!salida.length) return null;

            // Las tres de sistema tienen que estar siempre. Si una configuración
            // llega sin alguna, se repone: sin ella, los conteos históricos de
            // esa área quedarían fuera de todos los totales.
            AREAS_POR_DEFECTO.forEach(function(base) {
                if (!vistos[base.id]) salida.push(Object.assign({}, base));
            });
            return salida;
        }

        /** Aplica una definición (de la nube o de localStorage) y refresca lo derivado. */
        function aplicarDefinicionAreas(bruto) {
            var norm = _normalizarDefinicionAreas(bruto);
            if (!norm) return false;
            areasConteoDef = norm;
            _sincronizarAreasDerivadas();
            return true;
        }

        // ── Persistencia local ────────────────────────────────────────────────
        const AREAS_LS_KEY = 'inventarioApp_areasConteo';

        function _guardarAreasLocal() {
            try { localStorage.setItem(AREAS_LS_KEY, JSON.stringify(areasConteoDef)); }
            catch (_) { /* cuota llena: la app sigue funcionando con lo que hay en memoria */ }
        }

        function cargarAreasLocal() {
            try {
                var txt = localStorage.getItem(AREAS_LS_KEY);
                if (txt) aplicarDefinicionAreas(JSON.parse(txt));
            } catch (_) { /* json corrupto: se queda la de por defecto */ }
            _sincronizarAreasDerivadas();
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Alta, edición y baja
        //  Todas devuelven { ok, error } en vez de lanzar: quien llama es la
        //  interfaz y necesita el motivo para enseñarlo.
        // ══════════════════════════════════════════════════════════════════════

        /** Pasa 'Barra Terraza' a 'barra-terraza'. */
        function sugerirIdArea(nombre) {
            return String(nombre || '')
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // quitar acentos
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 32);
        }

        function crearAreaConteo(datos) {
            if (!isAdmin()) return { ok: false, error: 'Solo el administrador puede crear áreas de conteo.' };
            datos = datos || {};
            var nombre = String(datos.nombre || '').trim();
            if (!nombre) return { ok: false, error: 'El área necesita un nombre.' };

            var id = String(datos.id || sugerirIdArea(nombre)).trim().toLowerCase();
            if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) {
                return { ok: false, error: 'El identificador solo admite letras sin acento, números, guion y guion bajo.' };
            }
            if (areaInfo(id)) return { ok: false, error: 'Ya existe un área con el identificador "' + id + '".' };

            var maxOrden = 0;
            areasConteoDef.forEach(function(a) { maxOrden = Math.max(maxOrden, a.orden || 0); });

            areasConteoDef.push({
                id:            id,
                nombre:        nombre.slice(0, 40),
                etiquetaCorta: String(datos.etiquetaCorta || nombre).trim().slice(0, 20),
                icono:         String(datos.icono || '📍').slice(0, 4),
                fa:            String(datos.fa || 'fa-solid fa-location-dot').slice(0, 60),
                orden:         maxOrden + 1
            });
            _sincronizarAreasDerivadas();
            _guardarAreasLocal();
            return { ok: true, id: id };
        }

        function editarAreaConteo(id, cambios) {
            if (!isAdmin()) return { ok: false, error: 'Solo el administrador puede editar áreas de conteo.' };
            var i = -1;
            for (var k = 0; k < areasConteoDef.length; k++) if (areasConteoDef[k].id === id) { i = k; break; }
            if (i === -1) return { ok: false, error: 'No existe esa área.' };

            cambios = cambios || {};
            // El id NUNCA cambia, ni en las áreas nuevas: está escrito dentro de
            // cada conteo ya guardado. Cambiarlo dejaría esos conteos huérfanos
            // sin que nada avise.
            if (cambios.nombre !== undefined) {
                var n = String(cambios.nombre).trim();
                if (!n) return { ok: false, error: 'El nombre no puede quedar vacío.' };
                areasConteoDef[i].nombre = n.slice(0, 40);
            }
            if (cambios.etiquetaCorta !== undefined) {
                areasConteoDef[i].etiquetaCorta = String(cambios.etiquetaCorta).trim().slice(0, 20)
                                                  || areasConteoDef[i].nombre;
            }
            if (cambios.icono !== undefined) areasConteoDef[i].icono = String(cambios.icono).slice(0, 4) || '📍';
            if (cambios.fa    !== undefined) areasConteoDef[i].fa    = String(cambios.fa).slice(0, 60);
            if (typeof cambios.orden === 'number' && isFinite(cambios.orden)) {
                areasConteoDef[i].orden = cambios.orden;
            }
            _sincronizarAreasDerivadas();
            _guardarAreasLocal();
            return { ok: true };
        }

        /**
         * ¿Cuántos conteos hay registrados en esa área ahora mismo?
         * Se mira el conteo regular y el de auditoría: eliminar un área con
         * datos dentro los dejaría inalcanzables.
         */
        function conteosEnArea(id) {
            var n = 0;
            function contar(estructura) {
                if (!estructura) return;
                Object.keys(estructura).forEach(function(prodId) {
                    var d = estructura[prodId] && estructura[prodId][id];
                    if (!d) return;
                    var enteras  = d.enteras || 0;
                    var abiertas = (d.abiertas || []).some(function(v) { return (v || 0) > 0; });
                    if (enteras > 0 || abiertas) n++;
                });
            }
            if (typeof inventarioConteo   !== 'undefined') contar(inventarioConteo);
            if (typeof myAuditoriaConteo  !== 'undefined') contar(myAuditoriaConteo);
            return n;
        }

        function eliminarAreaConteo(id) {
            if (!isAdmin()) return { ok: false, error: 'Solo el administrador puede eliminar áreas de conteo.' };

            // Las tres de producción no se borran. Sus identificadores están
            // dentro de cada inventario cerrado; quitarlas dejaría el histórico
            // sin forma de interpretarse.
            if (_esAreaDeSistema(id)) {
                return { ok: false, error: 'Almacén, Barra Restaurante y Barra Bar no se pueden eliminar. Sí puedes cambiarles el nombre.' };
            }
            if (!areaInfo(id)) return { ok: false, error: 'No existe esa área.' };

            var conConteo = conteosEnArea(id);
            if (conConteo > 0) {
                return { ok: false, conteos: conConteo,
                         error: 'Esa área tiene ' + conConteo + ' producto(s) contados. Vacía el conteo antes de eliminarla.' };
            }
            // Con un inventario abierto no se toca el reparto de áreas: los
            // bartenders pueden estar contando en ella en este momento.
            if (typeof _inventarioActivo !== 'undefined' && _inventarioActivo &&
                _inventarioActivo.estado !== 'CERRADO') {
                return { ok: false, error: 'Hay un Inventario Físico abierto. Ciérralo antes de cambiar las áreas.' };
            }

            areasConteoDef = areasConteoDef.filter(function(a) { return a.id !== id; });
            _sincronizarAreasDerivadas();
            _guardarAreasLocal();
            return { ok: true };
        }

        // ══════════════════════════════════════════════════════════════════════
        //  R6 — Pantalla de administración de áreas (dentro de Ajustes)
        // ══════════════════════════════════════════════════════════════════════

        let _areaEditandoId = null;

        function uiEditarArea(id)   { _areaEditandoId = id;   renderTab(); }
        function uiCancelarEdicion(){ _areaEditandoId = null; renderTab(); }

        function uiGuardarArea(id) {
            var nom = document.getElementById('areaNom_' + id);
            var cor = document.getElementById('areaCor_' + id);
            var ico = document.getElementById('areaIco_' + id);
            var r = editarAreaConteo(id, {
                nombre:        nom ? nom.value : undefined,
                etiquetaCorta: cor ? cor.value : undefined,
                icono:         ico ? ico.value : undefined
            });
            if (!r.ok) { showNotification('⚠️ ' + r.error); return; }
            _areaEditandoId = null;
            saveToLocalStorage();
            showNotification('Área actualizada');
            renderTab();
        }

        function uiCrearArea() {
            var nom = document.getElementById('areaNuevaNombre');
            var ico = document.getElementById('areaNuevaIcono');
            var r = crearAreaConteo({
                nombre: nom ? nom.value : '',
                icono:  (ico && ico.value) ? ico.value : '📍'
            });
            if (!r.ok) { showNotification('⚠️ ' + r.error); return; }
            if (nom) nom.value = '';
            saveToLocalStorage();
            showNotification('Área "' + r.id + '" creada. Ya se puede contar en ella.');
            renderTab();
        }

        function uiEliminarArea(id) {
            var info = areaInfo(id);
            if (!info) return;
            // Se comprueba ANTES de preguntar: es feo pedir una confirmación para
            // luego decir que no se podía.
            var previo = eliminarAreaConteo.bind(null, id);
            var conteos = conteosEnArea(id);
            if (conteos > 0) {
                showNotification('⚠️ "' + info.nombre + '" tiene ' + conteos +
                                 ' producto(s) contados. Vacía el conteo antes de eliminarla.');
                return;
            }
            showConfirm('¿Eliminar el área "' + info.nombre + '"?\n\n' +
                        'No tiene conteos registrados, así que no se pierde nada.\n' +
                        'Puedes volver a crearla cuando quieras.',
                function() {
                    var r = previo();
                    if (!r.ok) { showNotification('⚠️ ' + r.error); return; }
                    saveToLocalStorage();
                    showNotification('Área eliminada');
                    renderTab();
                });
        }

        function renderAreasConteoAdmin() {
            if (!isAdmin()) return '';
            var def = areasDefinidas();
            var inp = 'width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-mid);'
                    + 'background:var(--surface);color:var(--txt-primary);font-family:inherit;font-size:.82rem;';
            var BTN_ACCION = 'min-height:44px;min-width:44px;display:inline-flex;align-items:center;'
                    + 'justify-content:center;padding:0 10px;border-radius:10px;'
                    + 'border:1px solid var(--border-mid);background:var(--surface);'
                    + 'cursor:pointer;font-size:1rem;line-height:1;';

            var html = '<div class="adm-card" style="margin-bottom:16px;padding:14px 16px;">';
            html += '<h3 style="font-size:.82rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;'
                 +  'color:var(--txt-secondary);margin-bottom:4px;">📍 Áreas de conteo</h3>';
            html += '<p style="font-size:.75rem;color:var(--txt-muted);margin-bottom:12px;line-height:1.5;">'
                 +  'Cada área es una zona que se cuenta por separado y luego se totaliza. '
                 +  'Almacén, Barra Restaurante y Barra Bar son fijas: puedes cambiarles el nombre, '
                 +  'pero no eliminarlas, porque sus conteos están dentro de todos los inventarios ya cerrados.</p>';

            def.forEach(function(a) {
                var sistema  = _esAreaDeSistema(a.id);
                var editando = (_areaEditandoId === a.id);
                var conteos  = conteosEnArea(a.id);

                html += '<div style="border:1px solid var(--border-mid);border-radius:10px;'
                     +  'padding:10px 12px;margin-bottom:8px;background:var(--surface);">';

                if (editando) {
                    html += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
                    html += '<input id="areaIco_' + escapeHtml(a.id) + '" value="' + escapeHtml(a.icono || '') + '" '
                         +  'maxlength="4" style="' + inp + 'width:60px;text-align:center;">';
                    html += '<input id="areaNom_' + escapeHtml(a.id) + '" value="' + escapeHtml(a.nombre) + '" '
                         +  'maxlength="40" placeholder="Nombre completo" style="' + inp + '">';
                    html += '</div>';
                    html += '<input id="areaCor_' + escapeHtml(a.id) + '" value="' + escapeHtml(a.etiquetaCorta || '') + '" '
                         +  'maxlength="20" placeholder="Etiqueta corta (para los botones)" style="' + inp + 'margin-bottom:8px;">';
                    html += '<div style="display:flex;gap:8px;">';
                    html += '<button class="adm-btn primary" style="min-height:44px;" onclick="uiGuardarArea(\'' + escapeHtml(a.id) + '\')">Guardar</button>';
                    html += '<button class="adm-btn" style="min-height:44px;" onclick="uiCancelarEdicion()">Cancelar</button>';
                    html += '</div>';
                } else {
                    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
                    html += '<span style="font-size:1.3rem;line-height:1;">' + escapeHtml(a.icono || '📍') + '</span>';
                    html += '<div style="flex:1;min-width:140px;">';
                    html += '<div style="font-weight:600;font-size:.9rem;">' + escapeHtml(a.nombre) + '</div>';
                    html += '<div style="font-size:.7rem;color:var(--txt-muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">'
                         +  escapeHtml(a.id)
                         +  (sistema ? ' · fija' : '')
                         +  (conteos ? ' · ' + conteos + ' contados' : '')
                         +  '</div></div>';
                    // Botones propios en vez de .adm-btn: esa clase es de bloque y
                    // dejaba las dos acciones apiladas a todo lo ancho de la tarjeta.
                    html += '<button type="button" style="' + BTN_ACCION + '" '
                         +  'title="Editar" aria-label="Editar ' + escapeHtml(a.nombre) + '" '
                         +  'onclick="uiEditarArea(\'' + escapeHtml(a.id) + '\')">✏️</button>';
                    if (!sistema) {
                        html += '<button type="button" style="' + BTN_ACCION + 'border-color:rgba(248,113,113,.3);" '
                             +  'title="Eliminar" aria-label="Eliminar ' + escapeHtml(a.nombre) + '" '
                             +  'onclick="uiEliminarArea(\'' + escapeHtml(a.id) + '\')">🗑️</button>';
                    }
                    html += '</div>';
                }
                html += '</div>';
            });

            // ── Alta ──────────────────────────────────────────────────────────
            html += '<div style="border:1px dashed var(--border-mid);border-radius:10px;padding:12px;margin-top:12px;">';
            html += '<div style="font-size:.78rem;font-weight:600;margin-bottom:8px;">Agregar área de conteo</div>';
            html += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
            html += '<input id="areaNuevaIcono" value="📍" maxlength="4" style="' + inp + 'width:60px;text-align:center;">';
            html += '<input id="areaNuevaNombre" placeholder="Ej: Barra Terraza" maxlength="40" style="' + inp + '">';
            html += '</div>';
            html += '<button class="adm-btn primary" style="min-height:44px;" onclick="uiCrearArea()">Crear área</button>';
            html += '<p style="font-size:.7rem;color:var(--txt-muted);margin-top:8px;line-height:1.5;">'
                 +  'El identificador se genera solo a partir del nombre y ya no cambia: '
                 +  'queda escrito dentro de cada conteo.</p>';
            html += '</div>';

            html += '</div>';
            return html;
        }
