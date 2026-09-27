

        // ══════════════════════════════════════════════════════════════════════
        //  RECETARIO-1 (27/09/2026)
        //  ────────────────────────────────────────────────────────────────────
        //  Bill of materials PLANO (sin sub-recetas — decisión del propietario,
        //  ver claude/recetario-diseno-tecnico-2026-09-26.md y la verificación
        //  contra el Excel real en claude/verificacion-excel-formato-barra-2026-09-27.md).
        //
        //  Modelo (cada elemento del arreglo `recetas`, publicado como
        //  documento único en recetario/recetas — mismo patrón que catálogo,
        //  ver publicarRecetarioFirestore() en js/50-roles-permisos.js):
        //    { id, nombre, pv, categoria, activa, ingredientes:[{productoId,cantidad,uom}],
        //      metodo, cristaleria, hielo, decoracion, _v, creadoPor, creadoEn,
        //      actualizadoPor, actualizadoEn }
        //
        //  RECETARIO-2 (27/09/2026) — corrección de nomenclatura, antes de
        //  construir el importador: se verificó contra el Excel real que "PV"
        //  es un código único (ej. PVB1000001, igual significado que
        //  product.pv en el catálogo — el SKU de Parrot) y "Receta" es el
        //  nombre visible (ej. "1800 AÑEJO BOTELLA") — 1,326 de cada uno, sin
        //  cruces entre sí. El campo `pv` de este módulo originalmente hacía
        //  de nombre a mostrar, lo cual habría mostrado códigos en las
        //  tarjetas al importar. Se corrige: `nombre` es el nombre visible
        //  (obligatorio, lo llena el admin a mano o lo trae el importador) y
        //  `pv` vuelve a significar lo mismo que en el catálogo — el código,
        //  opcional, solo se llena vía importación (ver claude/recetario2-analisis-2026-09-27.md).
        //
        //  Decisiones confirmadas por el propietario (2026-09-27):
        //    - El nombre puede repetirse entre recetas creadas a mano (sin
        //      bloqueo de unicidad) — pero el importador SÍ usa `pv` (código
        //      único) como llave de coincidencia para actualizar en vez de
        //      duplicar (ver Recetario-2).
        //    - UoM es texto libre, sin lista cerrada — coincide con el Excel
        //      real (ml, oz, PZA, KGS, LTS mezclados sin una lista fija).
        //    - Sin sub-recetas por ahora. El Excel sí tiene la noción
        //      (columna Categoría = 'subreceta' en 45 códigos SUB-0XX), pero
        //      se verificó que esos códigos NUNCA aparecen como "Código
        //      insumo" de otra receta — no están conectados a ningún cálculo
        //      real, así que no se replica el anidamiento aquí.
        //    - El motor de consumo teórico (VENTA/CONSUMO del Excel, que
        //      cruza receta × ventas del POS) queda FUERA de esta fase — es
        //      la base de la futura FASE 11 (stock teórico y desviación),
        //      no de Recetario-1.
        // ══════════════════════════════════════════════════════════════════════

        // ── Motor de costeo ─────────────────────────────────────────────────
        /**
         * costoPorUnidadBase(producto)
         * Costo por UNA unidad base del producto (ej. 1 ml, 1 pza), o null si
         * no hay forma de calcularlo. Nunca inventa un número: null se
         * muestra como "sin costo" / "no disponible", nunca como $0.00.
         *
         * Orden (ver diseño técnico §2):
         *   1) producto.conversion > 0  → precio / conversion
         *   2) producto.capacidadMl > 0 → precio / capacidadMl (compatibilidad
         *      con el modelo de botellas ya existente)
         *   3) sin forma de calcularlo  → null
         */
        function costoPorUnidadBase(producto) {
            if (!producto || typeof producto.precio !== 'number' || producto.precio < 0) return null;
            if (typeof producto.conversion === 'number' && producto.conversion > 0) {
                return producto.precio / producto.conversion;
            }
            if (typeof producto.capacidadMl === 'number' && producto.capacidadMl > 0) {
                return producto.precio / producto.capacidadMl;
            }
            return null;
        }
        window.costoPorUnidadBase = costoPorUnidadBase;

        /**
         * costoReceta(receta)
         * Devuelve { costo, incompleto, faltantes }. `faltantes` lista los
         * insumos (nombre o id) que no se pudieron costear. Si `incompleto`
         * es true, `costo` es null: nunca se muestra un total parcial
         * disfrazado de total completo (mismo criterio que ya se aplicó al
         * reporte en FASE 8).
         */
        function costoReceta(receta) {
            var ingredientes = (receta && Array.isArray(receta.ingredientes)) ? receta.ingredientes : [];
            var total = 0;
            var faltantes = [];
            for (var i = 0; i < ingredientes.length; i++) {
                var ing = ingredientes[i];
                var producto = products.find(function(p) { return p.id === ing.productoId; });
                var cu = producto ? costoPorUnidadBase(producto) : null;
                if (cu === null) {
                    // ing.descripcionExcel: solo la trae una línea importada (RECETARIO-2)
                    // cuyo código no existía en el catálogo al momento de importar — se
                    // preserva el nombre que traía el Excel en vez de mostrar solo el código.
                    faltantes.push((producto && producto.name) ? producto.name : (ing.descripcionExcel || ing.productoId || '(insumo desconocido)'));
                    continue;
                }
                total += cu * (typeof ing.cantidad === 'number' ? ing.cantidad : 0);
            }
            if (faltantes.length > 0) return { costo: null, incompleto: true, faltantes: faltantes };
            return { costo: total, incompleto: false, faltantes: [] };
        }
        window.costoReceta = costoReceta;

        // ── Utilidades ──────────────────────────────────────────────────────
        function _generarRecetaId() {
            return 'rec_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        }

        function _recetaPorId(id) {
            return recetas.find(function(r) { return r.id === id; }) || null;
        }

        // ── Navegación de la pestaña ─────────────────────────────────────────
        function _recetarioAbrirFicha(id) {
            recetarioView = 'ficha';
            recetarioFichaId = id;
            renderTab();
        }
        window._recetarioAbrirFicha = _recetarioAbrirFicha;

        function _recetarioVolverALista() {
            recetarioView = 'lista';
            recetarioFichaId = null;
            renderTab();
        }
        window._recetarioVolverALista = _recetarioVolverALista;

        function updateRecetarioSearch(val) {
            _recetarioSearchTerm = val || '';
            renderTab();
        }
        window.updateRecetarioSearch = updateRecetarioSearch;

        function clearRecetarioSearch() {
            _recetarioSearchTerm = '';
            renderTab();
        }
        window.clearRecetarioSearch = clearRecetarioSearch;

        // ── Editor (modal) ───────────────────────────────────────────────────
        // editingRecetaId / _recetaEditIngredientes: estado de trabajo mientras
        // el modal está abierto. No tocan `recetas` hasta saveRecetaModal().
        let editingRecetaId = null;
        let _recetaEditIngredientes = [];

        function _recetaLineaVacia() { return { productoId: '', cantidad: '', uom: '' }; }

        function openRecetaModal(id) {
            if (!hasPermission('recipe.edit')) {
                showNotification('⚠️ No tienes permiso para editar el recetario');
                return;
            }
            var modal = document.getElementById('recetaModal');
            var title = document.getElementById('recetaModalTitle');
            if (!modal || !title) return;

            document.getElementById('recetaNombre').value = '';
            document.getElementById('recetaCategoria').value = '';
            document.getElementById('recetaActiva').checked = true;
            document.getElementById('recetaMetodo').value = '';
            document.getElementById('recetaCristaleria').value = '';
            document.getElementById('recetaHielo').value = '';
            document.getElementById('recetaDecoracion').value = '';
            editingRecetaId = null;
            _recetaEditIngredientes = [];

            if (id) {
                var receta = _recetaPorId(id);
                if (receta) {
                    editingRecetaId = receta.id;
                    title.textContent = 'Editar receta';
                    document.getElementById('recetaNombre').value = receta.nombre || '';
                    document.getElementById('recetaCategoria').value = receta.categoria || '';
                    document.getElementById('recetaActiva').checked = receta.activa !== false;
                    document.getElementById('recetaMetodo').value = receta.metodo || '';
                    document.getElementById('recetaCristaleria').value = receta.cristaleria || '';
                    document.getElementById('recetaHielo').value = receta.hielo || '';
                    document.getElementById('recetaDecoracion').value = receta.decoracion || '';
                    _recetaEditIngredientes = (receta.ingredientes || []).map(function(ing) {
                        return { productoId: ing.productoId, cantidad: ing.cantidad, uom: ing.uom || '' };
                    });
                }
            } else {
                title.textContent = 'Nueva receta';
            }
            if (_recetaEditIngredientes.length === 0) _recetaEditIngredientes.push(_recetaLineaVacia());

            _recetaRenderDatalist();
            _recetaRenderIngredientesLista();
            modal.classList.remove('hidden');
        }
        window.openRecetaModal = openRecetaModal;

        function closeRecetaModal() {
            var modal = document.getElementById('recetaModal');
            if (modal) modal.classList.add('hidden');
            editingRecetaId = null;
            _recetaEditIngredientes = [];
        }
        window.closeRecetaModal = closeRecetaModal;

        // El picker de insumo es un <input list> nativo contra un <datalist> con
        // TODOS los productos del catálogo — no existe un componente de
        // autocompletado propio que reutilizar (a diferencia de lo que asumía
        // el diseño original: Compras resuelve el insumo por código del Excel
        // importado, no por un picker manual). Un datalist nativo es simple y
        // no añade una dependencia nueva para ~424 productos.
        function _recetaRenderDatalist() {
            var dl = document.getElementById('recetaInsumosDatalist');
            if (!dl) return;
            var ordenados = products.slice().sort(function(a, b) {
                return (a.name || '').localeCompare(b.name || '');
            });
            var html = '';
            ordenados.forEach(function(p) {
                html += '<option value="' + escapeHtml(p.id) + ' — ' + escapeHtml(p.name || '') + '"></option>';
            });
            dl.innerHTML = html;
        }

        function _recetaAgregarIngrediente() {
            _recetaEditIngredientes.push(_recetaLineaVacia());
            _recetaRenderIngredientesLista();
        }
        window._recetaAgregarIngrediente = _recetaAgregarIngrediente;

        function _recetaQuitarIngrediente(idx) {
            _recetaEditIngredientes.splice(idx, 1);
            if (_recetaEditIngredientes.length === 0) _recetaEditIngredientes.push(_recetaLineaVacia());
            _recetaRenderIngredientesLista();
        }
        window._recetaQuitarIngrediente = _recetaQuitarIngrediente;

        function _recetaOnCambioIngrediente(idx, campo, valor) {
            if (!_recetaEditIngredientes[idx]) return;
            if (campo === 'insumo') {
                // El valor viene del datalist como "CODIGO — Descripción" — se
                // toma solo el código. Si el usuario escribe algo que no
                // coincide con ninguna opción, se guarda tal cual: saveRecetaModal
                // y la ficha avisan si el código no existe en el catálogo.
                _recetaEditIngredientes[idx].productoId = String(valor).split(' — ')[0].trim();
            } else if (campo === 'cantidad') {
                var n = parseFloat(valor);
                _recetaEditIngredientes[idx].cantidad = isNaN(n) ? '' : n;
            } else if (campo === 'uom') {
                _recetaEditIngredientes[idx].uom = valor;
            }
        }
        window._recetaOnCambioIngrediente = _recetaOnCambioIngrediente;

        function _recetaRenderIngredientesLista() {
            var cont = document.getElementById('recetaIngredientesLista');
            if (!cont) return;
            var html = '';
            _recetaEditIngredientes.forEach(function(ing, idx) {
                var producto = ing.productoId ? products.find(function(p) { return p.id === ing.productoId; }) : null;
                var valorInsumo = ing.productoId ? (ing.productoId + (producto ? ' — ' + producto.name : '')) : '';
                html += '<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:10px;flex-wrap:wrap;">';
                html += '<div style="flex:2;min-width:160px;">';
                html += '<label class="block text-xs font-medium text-gray-500 mb-1">Insumo</label>';
                html += '<input type="text" list="recetaInsumosDatalist" value="' + escapeHtml(valorInsumo) + '" ' +
                        'onchange="_recetaOnCambioIngrediente(' + idx + ',\'insumo\',this.value)" ' +
                        'class="w-full px-2 py-2 bg-white text-gray-900 border border-gray-200 rounded text-sm" placeholder="Código o nombre del insumo">';
                if (ing.productoId && !producto) {
                    html += '<p class="text-xs mt-1" style="color:#dc2626">⚠️ No existe en el catálogo' +
                            (ing.descripcionExcel ? ' — el Excel lo traía como "' + escapeHtml(ing.descripcionExcel) + '"' : '') + '</p>';
                }
                html += '</div>';
                html += '<div style="width:92px;">';
                html += '<label class="block text-xs font-medium text-gray-500 mb-1">Cantidad</label>';
                html += '<input type="number" step="0.001" min="0" value="' + (ing.cantidad === '' || ing.cantidad === undefined ? '' : escapeHtml(ing.cantidad)) + '" ' +
                        'onchange="_recetaOnCambioIngrediente(' + idx + ',\'cantidad\',this.value)" ' +
                        'class="w-full px-2 py-2 bg-white text-gray-900 border border-gray-200 rounded text-sm">';
                html += '</div>';
                html += '<div style="width:92px;">';
                html += '<label class="block text-xs font-medium text-gray-500 mb-1">UoM</label>';
                html += '<input type="text" value="' + escapeHtml(ing.uom || '') + '" ' +
                        'onchange="_recetaOnCambioIngrediente(' + idx + ',\'uom\',this.value)" ' +
                        'class="w-full px-2 py-2 bg-white text-gray-900 border border-gray-200 rounded text-sm" placeholder="ml, oz…">';
                html += '</div>';
                html += '<button type="button" onclick="_recetaQuitarIngrediente(' + idx + ')" title="Quitar insumo" ' +
                        'style="height:38px;width:38px;margin-top:18px;border-radius:8px;border:1px solid var(--border-mid,#e5e7eb);background:transparent;color:#dc2626;cursor:pointer;flex-shrink:0;">✕</button>';
                html += '</div>';
            });
            cont.innerHTML = html;
        }

        function saveRecetaModal() {
            if (!hasPermission('recipe.edit')) {
                showNotification('⚠️ No tienes permiso para editar el recetario');
                return;
            }
            var nombreInput = document.getElementById('recetaNombre');
            var nombre = (nombreInput.value || '').trim();
            if (!nombre) { showNotification('⚠️ El nombre de la receta es obligatorio'); return; }

            var ingredientesValidos = [];
            for (var i = 0; i < _recetaEditIngredientes.length; i++) {
                var ing = _recetaEditIngredientes[i];
                var vacia = !ing.productoId && (ing.cantidad === '' || ing.cantidad === undefined) && !ing.uom;
                if (vacia) continue; // línea sin llenar — se ignora, no bloquea el guardado
                if (!ing.productoId) { showNotification('⚠️ Falta el insumo en la línea ' + (i + 1)); return; }
                if (typeof ing.cantidad !== 'number' || !(ing.cantidad > 0)) {
                    showNotification('⚠️ La cantidad de la línea ' + (i + 1) + ' debe ser mayor a 0');
                    return;
                }
                ingredientesValidos.push({ productoId: ing.productoId, cantidad: ing.cantidad, uom: (ing.uom || '').trim() });
            }
            if (ingredientesValidos.length === 0) { showNotification('⚠️ Agrega al menos un ingrediente'); return; }

            var categoria   = (document.getElementById('recetaCategoria').value || '').trim();
            var activa      = document.getElementById('recetaActiva').checked;
            var metodo      = (document.getElementById('recetaMetodo').value || '').trim();
            var cristaleria = (document.getElementById('recetaCristaleria').value || '').trim();
            var hielo       = (document.getElementById('recetaHielo').value || '').trim();
            var decoracion  = (document.getElementById('recetaDecoracion').value || '').trim();
            var now = Date.now();

            if (editingRecetaId) {
                var receta = _recetaPorId(editingRecetaId);
                if (!receta) { showNotification('❌ La receta ya no existe — probablemente otro admin la eliminó'); closeRecetaModal(); return; }
                receta.nombre = nombre;
                receta.categoria = categoria;
                receta.activa = activa;
                receta.ingredientes = ingredientesValidos;
                receta.metodo = metodo;
                receta.cristaleria = cristaleria;
                receta.hielo = hielo;
                receta.decoracion = decoracion;
                receta._v = (receta._v || 1) + 1;
                receta.actualizadoPor = currentUserUid;
                receta.actualizadoEn = now;
            } else {
                recetas.push({
                    id: _generarRecetaId(), nombre: nombre, categoria: categoria, activa: activa,
                    ingredientes: ingredientesValidos, metodo: metodo, cristaleria: cristaleria,
                    hielo: hielo, decoracion: decoracion, _v: 1,
                    creadoPor: currentUserUid, creadoEn: now, actualizadoPor: currentUserUid, actualizadoEn: now
                });
            }
            saveToLocalStorage();
            closeRecetaModal();
            if (typeof activeTab !== 'undefined' && activeTab === 'recetario') renderTab();
            showNotification('✅ Receta guardada — publica el recetario para que todos la vean');
        }
        window.saveRecetaModal = saveRecetaModal;

        function toggleRecetaActiva(id) {
            if (!hasPermission('recipe.edit')) return;
            var receta = _recetaPorId(id);
            if (!receta) return;
            receta.activa = !receta.activa;
            receta._v = (receta._v || 1) + 1;
            receta.actualizadoPor = currentUserUid;
            receta.actualizadoEn = Date.now();
            saveToLocalStorage();
            renderTab();
        }
        window.toggleRecetaActiva = toggleRecetaActiva;

        function eliminarReceta(id) {
            if (!hasPermission('recipe.edit')) return;
            var receta = _recetaPorId(id);
            if (!receta) return;
            showConfirm('¿Eliminar la receta "' + receta.nombre + '"? No se puede deshacer una vez que publiques el recetario.', function() {
                recetas = recetas.filter(function(r) { return r.id !== id; });
                saveToLocalStorage();
                if (recetarioFichaId === id) { recetarioView = 'lista'; recetarioFichaId = null; }
                renderTab();
                showNotification('🗑️ Receta eliminada — publica el recetario para confirmar el borrado a todos');
            });
        }
        window.eliminarReceta = eliminarReceta;

        // ── Render de la pestaña ─────────────────────────────────────────────
        function renderRecetarioTab() {
            if (!hasPermission('recipe.read')) {
                return '<div style="text-align:center;padding:60px 20px;color:var(--txt-secondary);">' +
                       '<p style="font-size:1rem;">🔒 No tienes acceso al recetario.</p></div>';
            }
            // RECETARIO-2 — la vista de importación tiene prioridad sobre lista/ficha,
            // mismo patrón que renderComprasTab() con comprasImportView.
            if (typeof recetarioImportView === 'undefined') recetarioImportView = 'lista';
            if (recetarioImportView === 'vista_previa' && _recetarioImportPendiente) {
                return '<div style="padding:4px 0 8px">' + renderVistaPreviaRecetario(_recetarioImportPendiente) + '</div>';
            }
            if (recetarioImportView === 'incidencias' && _recetarioImportResultado) {
                return '<div style="padding:4px 0 8px">' + renderIncidenciasImportacionRecetario(_recetarioImportResultado) + '</div>';
            }
            if (recetarioView === 'ficha' && recetarioFichaId) {
                return _renderRecetaFicha(recetarioFichaId);
            }
            return _renderRecetarioLista();
        }
        window.renderRecetarioTab = renderRecetarioTab;

        function _renderRecetarioLista() {
            var puedeEditar = hasPermission('recipe.edit');
            var q = (_recetarioSearchTerm || '').trim().toLowerCase();
            var lista = recetas.filter(function(r) {
                if (!q) return true;
                return (r.nombre || '').toLowerCase().indexOf(q) !== -1 ||
                       (r.categoria || '').toLowerCase().indexOf(q) !== -1;
            }).sort(function(a, b) { return (a.nombre || '').localeCompare(b.nombre || ''); });

            var html = '<div style="margin-bottom:16px;">';
            html += '<input type="text" value="' + escapeHtml(_recetarioSearchTerm) + '" oninput="updateRecetarioSearch(this.value)" ' +
                    'placeholder="Buscar receta por nombre o categoría…" ' +
                    'class="w-full px-4 py-2.5 bg-white text-gray-900 border border-gray-200 rounded-full text-sm">';
            html += '</div>';

            if (lista.length === 0) {
                html += '<div style="text-align:center;padding:50px 20px;color:var(--txt-secondary);">';
                if (recetas.length === 0) {
                    html += '<p>📖 Aún no hay recetas. ' +
                            (puedeEditar ? 'Agrega la primera con el botón de arriba.' : 'El administrador todavía no publica el recetario.') +
                            '</p>';
                } else {
                    html += '<p>Sin resultados para "' + escapeHtml(_recetarioSearchTerm) + '".</p>';
                }
                html += '</div>';
                return html;
            }

            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;">';
            lista.forEach(function(r) {
                var cr = costoReceta(r);
                var costoTxt = cr.incompleto ? 'Costo incompleto' : ('$' + cr.costo.toFixed(2));
                html += '<div onclick="_recetarioAbrirFicha(\'' + r.id + '\')" ' +
                        'style="cursor:pointer;background:var(--card,#fff);border:1px solid var(--border-mid,#e5e7eb);border-radius:14px;padding:14px 16px;">';
                html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">';
                html += '<p style="font-weight:700;color:var(--txt-primary);margin:0;">' + escapeHtml(r.nombre || '(sin nombre)') + '</p>';
                if (!r.activa) html += '<span style="font-size:.68rem;background:#4b5563;color:#fff;padding:2px 8px;border-radius:999px;white-space:nowrap;">Inactiva</span>';
                html += '</div>';
                if (r.categoria) html += '<p style="font-size:.78rem;color:var(--txt-secondary);margin:4px 0 0;">' + escapeHtml(r.categoria) + '</p>';
                html += '<p style="font-size:.78rem;color:var(--txt-secondary);margin:6px 0 0;">' +
                        r.ingredientes.length + ' insumo' + (r.ingredientes.length === 1 ? '' : 's') + '</p>';
                if (puedeEditar) {
                    html += '<p style="font-size:.85rem;font-weight:600;margin:8px 0 0;color:' +
                            (cr.incompleto ? '#d97706' : 'var(--accent)') + ';">' + costoTxt + '</p>';
                }
                html += '</div>';
            });
            html += '</div>';
            return html;
        }

        function _renderRecetaFicha(id) {
            var r = _recetaPorId(id);
            if (!r) {
                recetarioView = 'lista';
                recetarioFichaId = null;
                return _renderRecetarioLista();
            }
            var puedeEditar = hasPermission('recipe.edit');
            var cr = costoReceta(r);

            var html = '<button type="button" onclick="_recetarioVolverALista()" ' +
                       'style="background:none;border:none;color:var(--accent);font-size:.85rem;cursor:pointer;margin-bottom:14px;padding:0;">← Volver al recetario</button>';
            html += '<div style="background:var(--card,#fff);border:1px solid var(--border-mid,#e5e7eb);border-radius:16px;padding:20px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">';
            html += '<div><h2 style="font-size:1.4rem;font-weight:800;margin:0;color:var(--txt-primary);">' + escapeHtml(r.nombre || '') + '</h2>';
            if (r.categoria) html += '<p style="color:var(--txt-secondary);margin:4px 0 0;">' + escapeHtml(r.categoria) + '</p>';
            // r.pv (código, ej. PVB1000001) solo existe si la receta vino de una
            // importación (Recetario-2) — nunca lo llena el editor manual.
            if (r.pv) html += '<p style="color:var(--txt-secondary);font-size:.76rem;margin:4px 0 0;">Código: ' + escapeHtml(r.pv) + '</p>';
            html += '</div>';
            if (puedeEditar) {
                html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
                html += '<button onclick="openRecetaModal(\'' + r.id + '\')" style="padding:8px 16px;border-radius:999px;border:none;background:var(--accent);color:var(--accent-on,#003063);font-size:.8rem;font-weight:600;cursor:pointer;">Editar</button>';
                html += '<button onclick="toggleRecetaActiva(\'' + r.id + '\')" style="padding:8px 16px;border-radius:999px;border:1px solid var(--border-mid,#e5e7eb);background:transparent;color:var(--txt-secondary);font-size:.8rem;cursor:pointer;">' +
                        (r.activa ? 'Desactivar' : 'Activar') + '</button>';
                html += '<button onclick="eliminarReceta(\'' + r.id + '\')" style="padding:8px 16px;border-radius:999px;border:1px solid rgba(220,38,38,.35);background:transparent;color:#dc2626;font-size:.8rem;cursor:pointer;">Eliminar</button>';
                html += '</div>';
            }
            html += '</div>';

            html += '<div style="margin-top:18px;">';
            html += '<p style="font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--txt-secondary);margin-bottom:8px;">Ingredientes</p>';
            html += '<table style="width:100%;border-collapse:collapse;font-size:.85rem;">';
            r.ingredientes.forEach(function(ing) {
                var producto = products.find(function(p) { return p.id === ing.productoId; });
                var cu = producto ? costoPorUnidadBase(producto) : null;
                html += '<tr style="border-bottom:1px solid var(--border-mid,#e5e7eb);">';
                html += '<td style="padding:8px 4px;color:var(--txt-primary);">' + escapeHtml(producto ? producto.name : (ing.descripcionExcel || ing.productoId)) +
                        (producto ? '' : ' <span style="color:#dc2626;font-size:.72rem;">(no está en el catálogo)</span>') + '</td>';
                html += '<td style="padding:8px 4px;text-align:right;color:var(--txt-secondary);white-space:nowrap;">' +
                        escapeHtml(ing.cantidad) + ' ' + escapeHtml(ing.uom || '') + '</td>';
                if (puedeEditar) {
                    html += '<td style="padding:8px 4px;text-align:right;color:var(--txt-secondary);white-space:nowrap;">' +
                            (cu === null ? '<span style="color:#d97706;">sin costo</span>' : ('$' + (cu * ing.cantidad).toFixed(2))) + '</td>';
                }
                html += '</tr>';
            });
            html += '</table></div>';

            if (puedeEditar) {
                html += '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-mid,#e5e7eb);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">';
                html += '<span style="font-weight:700;color:var(--txt-primary);">Costo por porción</span>';
                html += '<span style="font-weight:800;font-size:1.05rem;color:' + (cr.incompleto ? '#d97706' : 'var(--accent)') + ';">' +
                        (cr.incompleto ? 'Incompleto — falta: ' + escapeHtml(cr.faltantes.join(', ')) : ('$' + cr.costo.toFixed(2))) + '</span>';
                html += '</div>';
            }

            var etiquetas = { metodo: 'Método', cristaleria: 'Cristalería', hielo: 'Hielo', decoracion: 'Decoración' };
            ['metodo', 'cristaleria', 'hielo', 'decoracion'].forEach(function(campo) {
                if (!r[campo]) return;
                html += '<div style="margin-top:14px;">';
                html += '<p style="font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--txt-secondary);margin-bottom:4px;">' + etiquetas[campo] + '</p>';
                html += '<p style="color:var(--txt-primary);margin:0;white-space:pre-wrap;">' + escapeHtml(r[campo]) + '</p>';
                html += '</div>';
            });

            html += '</div>';
            return html;
        }
        window._renderRecetarioLista = _renderRecetarioLista;
        window._renderRecetaFicha = _renderRecetaFicha;
