

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

        // ══════════════════════════════════════════════════════════════════════
        //  FASE 11A — EL COSTEO DEPENDE DE LA UNIDAD DE LA LÍNEA
        //  ────────────────────────────────────────────────────────────────────
        //  Recetario-1 asumió que la cantidad de un ingrediente venía en
        //  MILILITROS (45 ml de tequila), porque así se teclea a mano. El Excel
        //  real no funciona así: verificadas las 1,416 líneas de barra, la UoM
        //  es siempre PZA (1,099), LTS (167) o KGS (150) — nunca ml — y la
        //  cantidad es una FRACCIÓN de la unidad del propio insumo: una copa de
        //  1800 Añejo es 0.06 PZA, el 6 % de la botella. En 1,351 de esas 1,416
        //  líneas la UoM coincide exactamente con la UoM maestra del insumo.
        //
        //  Con la fórmula vieja, esa copa costaba 0.06 × (350/700) = $0.03 en
        //  vez de 0.06 × 350 = $21. Todas las recetas importadas mostraban el
        //  costo dividido entre la conversión.
        //
        //  factorAUnidadProducto() responde "cuántas unidades de inventario del
        //  producto vale 1 <uom>", que es lo único que hace falta para costear
        //  y para el consumo teórico:
        //    · UoM de stock (PZA/KGS/LTS/botella/pieza…) o igual a la unidad
        //      del producto → 1. La cantidad YA está en unidades de producto.
        //    · Sub-unidad (ml, oz) → se convierte con la conversión del
        //      catálogo, que es el caso de una receta tecleada a mano.
        //    · Cualquier otra cosa → null, y la receta se marca "incompleto".
        //      Nunca se adivina un factor.
        // ══════════════════════════════════════════════════════════════════════
        var _UOM_DE_STOCK = ['pza', 'pz', 'pieza', 'piezas', 'botella', 'botellas',
                             'kgs', 'kg', 'kilo', 'kilos', 'lts', 'lt', 'litro', 'litros',
                             'unidad', 'unidades', 'c/u', 'pieza(s)'];
        var _ML_POR_OZ = 29.5735;

        function _normUom(v) {
            return String(v == null ? '' : v).trim().toLowerCase()
                   .normalize('NFD').replace(/[̀-ͯ]/g, '');
        }

        function factorAUnidadProducto(uom, producto) {
            var u = _normUom(uom);
            // Sin unidad declarada se asume la del producto — es lo que hace el
            // Excel, que no convierte nada: la cantidad vive en la unidad del insumo.
            if (!u) return 1;
            if (_UOM_DE_STOCK.indexOf(u) !== -1) return 1;
            if (producto && _normUom(producto.unit) === u) return 1;

            var conv = null;
            if (producto && typeof producto.conversion === 'number' && producto.conversion > 0) conv = producto.conversion;
            else if (producto && typeof producto.capacidadMl === 'number' && producto.capacidadMl > 0) conv = producto.capacidadMl;
            if (conv === null) return null;

            if (u === 'ml' || u === 'mililitro' || u === 'mililitros') return 1 / conv;
            if (u === 'oz' || u === 'onza' || u === 'onzas') return _ML_POR_OZ / conv;
            return null;   // unidad que no sabemos interpretar: no se inventa
        }
        window.factorAUnidadProducto = factorAUnidadProducto;

        /**
         * costoLineaReceta(ing, producto)
         * Costo de UNA línea, en pesos. null si no se puede calcular con
         * honestidad (sin precio, sin cantidad o sin poder interpretar la UoM).
         */
        function costoLineaReceta(ing, producto) {
            if (!ing || !producto) return null;
            if (typeof producto.precio !== 'number' || producto.precio < 0) return null;
            var cant = (typeof ing.cantidad === 'number' && isFinite(ing.cantidad)) ? ing.cantidad : null;
            if (cant === null) return null;
            var factor = factorAUnidadProducto(ing.uom, producto);
            if (factor === null) return null;
            return cant * factor * producto.precio;
        }
        window.costoLineaReceta = costoLineaReceta;

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
                // FASE 11A — el costo depende de la unidad de la línea, no se
                // asume que la cantidad venga en mililitros.
                var costoLinea = producto ? costoLineaReceta(ing, producto) : null;
                if (costoLinea === null) {
                    // ing.descripcionExcel: solo la trae una línea importada (RECETARIO-2)
                    // cuyo código no existía en el catálogo al momento de importar — se
                    // preserva el nombre que traía el Excel en vez de mostrar solo el código.
                    faltantes.push((producto && producto.name) ? producto.name : (ing.descripcionExcel || ing.productoId || '(insumo desconocido)'));
                    continue;
                }
                total += costoLinea;
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

        // ══════════════════════════════════════════════════════════════════════
        //  MIGRACIÓN DEL ESQUEMA ANTERIOR (hotfix 4.14)
        //  ────────────────────────────────────────────────────────────────────
        //  RECETARIO-2 separó `pv` (código) de `nombre` (nombre visible), pero
        //  NO migró las recetas que ya existían. Una receta tecleada a mano con
        //  la versión 4.11 guardó el nombre en `pv` y no tiene `nombre`: tras
        //  actualizar, su tarjeta muestra "(sin nombre)" y su nombre aparece
        //  etiquetado como "Código". El dato nunca se perdió, pero se mostraba
        //  en el lugar equivocado — que es exactamente lo que reportó el
        //  propietario.
        //
        //  La migración es idempotente y se aplica en los TRES puntos por donde
        //  entran recetas a memoria (localStorage, IndexedDB y el documento
        //  publicado en Firestore), así que cada dispositivo se cura solo al
        //  abrir la app, sin depender de que alguien republique.
        //
        //  `pv` solo se borra cuando NO parece un código real: si una receta
        //  importada llegó sin nombre (columna "Receta" vacía), su `pv` sí es
        //  un código y debe conservarse además de copiarse al nombre.
        // ══════════════════════════════════════════════════════════════════════
        function _pareceCodigoPV(v) {
            return /^(PV[A-Z]?\d{3,}|SUB-\d+)$/i.test(String(v == null ? '' : v).trim());
        }
        window._pareceCodigoPV = _pareceCodigoPV;

        function _migrarRecetasNomenclatura(lista) {
            if (!Array.isArray(lista)) return 0;
            var migradas = 0;
            lista.forEach(function(r) {
                if (!r || typeof r !== 'object') return;
                if (r.nombre && String(r.nombre).trim()) return;   // ya está migrada
                var pv = (r.pv === undefined || r.pv === null) ? '' : String(r.pv).trim();
                if (!pv) return;                                    // nada que recuperar
                r.nombre = pv;
                if (!_pareceCodigoPV(pv)) delete r.pv;              // era un nombre tecleado, no un código
                migradas++;
            });
            if (migradas) {
                console.info('[Recetario] Migradas ' + migradas + ' receta(s) del esquema anterior (pv → nombre).');
            }
            return migradas;
        }
        window._migrarRecetasNomenclatura = _migrarRecetasNomenclatura;

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

        // REDISEÑO — el Recetario ahora comparte el buscador unificado (ver
        // js/80-buscador.js, registro 'recetario'). Estas dos funciones ya no
        // las llama la interfaz (la barra las reemplaza por BusquedaUI), pero
        // se conservan delegando en ella por si algo externo —consola, una
        // prueba— todavía las invoca por su nombre anterior.
        function updateRecetarioSearch(val) { BusquedaUI.establecer('recetario', val); }
        window.updateRecetarioSearch = updateRecetarioSearch;

        function clearRecetarioSearch() { BusquedaUI.limpiar('recetario'); }
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
                // FASE 11A — al elegir el insumo se prellena su unidad si el
                // campo está vacío. Sin unidad, "45" es ambiguo entre 45 ml y
                // 45 botellas, y el costeo depende de eso: mejor dejarlo
                // explícito desde el principio que adivinarlo después.
                if (!_recetaEditIngredientes[idx].uom) {
                    var prodElegido = products.find(function(p) { return p.id === _recetaEditIngredientes[idx].productoId; });
                    if (prodElegido && prodElegido.unit) _recetaEditIngredientes[idx].uom = prodElegido.unit;
                }
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
                    html += '<p class="text-xs mt-1" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> No existe en el catálogo' +
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
                        'style="height:38px;width:38px;margin-top:18px;border-radius:8px;border:1px solid var(--border-mid);background:transparent;color:var(--danger);cursor:pointer;flex-shrink:0;"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
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
                       '<p style="font-size:1rem;"><i class="fa-solid fa-lock" aria-hidden="true"></i> No tienes acceso al recetario.</p></div>';
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

        // REDISEÑO — la lista del Recetario ahora usa la misma barra de
        // búsqueda que Inicio (ver js/80-buscador.js, registro 'recetario'):
        // antes tenía su propio <input> con comparación de subcadena a mano
        // (sin tildes, sin puntaje por relevancia, sin paginación ni atajos
        // de teclado). La región de resultados se arma aparte en
        // _renderRecetarioResultados() para que BusquedaUI pueda refrescarla
        // sola en cada tecleo, sin repintar la barra entera.
        function _renderRecetarioLista() {
            var html = BusquedaUI.barra('recetario', {
                placeholder: 'Buscar receta por nombre, código o categoría…',
                etiqueta: 'Buscar recetas',
                sticky: true
            });
            html += BusquedaUI.region('recetario', _renderRecetarioResultados().html);
            return html;
        }

        function _renderRecetarioResultados() {
            var puedeEditar = hasPermission('recipe.edit');

            if (recetas.length === 0) {
                return {
                    html: '<div style="text-align:center;padding:50px 20px;color:var(--txt-secondary);">' +
                          '<p><i class="fa-solid fa-book" aria-hidden="true"></i> Aún no hay recetas. ' +
                          (puedeEditar ? 'Agrega la primera con el botón de arriba.' : 'El administrador todavía no publica el recetario.') +
                          '</p></div>',
                    coincidencias: 0, total: 0
                };
            }

            var res = _buscarRecetario();
            var lista = res.items;
            if (!(_recetarioSearchTerm || '').trim()) {
                // Sin búsqueda activa: alfabético, igual que mostraba siempre
                // esta pantalla. El motor compartido no reordena una lista sin
                // consulta (ver buscar() en 05-busqueda-motor.js — devuelve la
                // lista en su orden original); el alfabetizado es una decisión
                // de esta pantalla, no del buscador en sí.
                lista = lista.slice().sort(function(a, b) { return (a.nombre || '').localeCompare(b.nombre || ''); });
            }
            var lim = BusquedaUI.limite('recetario');

            if (lista.length === 0) {
                return { html: BusquedaUI.vacio('recetario', 'recetas'), coincidencias: 0, total: res.total };
            }

            var html = BusquedaUI.resumen('recetario', res.coincidencias, res.total, 'receta', 'recetas');
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;">';
            lista.slice(0, lim).forEach(function(receta) {
                var cr = costoReceta(receta);
                var costoTxt = cr.incompleto ? 'Costo incompleto' : ('$' + cr.costo.toFixed(2));
                html += '<div data-sbx-item onclick="_recetarioAbrirFicha(\'' + receta.id + '\')" ' +
                        'style="cursor:pointer;background:var(--card);border:1px solid var(--border-mid);border-radius:14px;padding:14px 16px;">';
                html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">';
                html += '<p style="font-weight:700;color:var(--txt-primary);margin:0;">' + resaltarBusqueda(receta.nombre || '(sin nombre)', _recetarioSearchTerm) + '</p>';
                if (!receta.activa) html += '<span style="font-size:.68rem;background:var(--card-high);color:var(--txt-muted);padding:2px 8px;border-radius:999px;white-space:nowrap;">Inactiva</span>';
                html += '</div>';
                if (receta.categoria) html += '<p style="font-size:.78rem;color:var(--txt-secondary);margin:4px 0 0;">' + resaltarBusqueda(receta.categoria, _recetarioSearchTerm) + '</p>';
                html += '<p style="font-size:.78rem;color:var(--txt-secondary);margin:6px 0 0;">' +
                        receta.ingredientes.length + ' insumo' + (receta.ingredientes.length === 1 ? '' : 's') + '</p>';
                if (puedeEditar) {
                    html += '<p style="font-size:.85rem;font-weight:600;margin:8px 0 0;color:' +
                            (cr.incompleto ? 'var(--warn)' : 'var(--accent)') + ';">' + costoTxt + '</p>';
                }
                html += '</div>';
            });
            html += '</div>';
            html += BusquedaUI.centinela('recetario', lista.length - lim);
            return { html: html, coincidencias: res.coincidencias, total: res.total };
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
                       'style="background:none;border:none;color:var(--accent);font-size:.85rem;cursor:pointer;margin-bottom:14px;padding:0;"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> Volver al recetario</button>';
            html += '<div style="background:var(--card);border:1px solid var(--border-mid);border-radius:16px;padding:20px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">';
            html += '<div><h2 style="font-size:1.4rem;font-weight:800;margin:0;color:var(--txt-primary);">' + escapeHtml(r.nombre || '') + '</h2>';
            if (r.categoria) html += '<p style="color:var(--txt-secondary);margin:4px 0 0;">' + escapeHtml(r.categoria) + '</p>';
            // r.pv (código, ej. PVB1000001) solo existe si la receta vino de una
            // importación (Recetario-2) — nunca lo llena el editor manual.
            if (r.pv) html += '<p style="color:var(--txt-secondary);font-size:.76rem;margin:4px 0 0;">Código: ' + escapeHtml(r.pv) + '</p>';
            html += '</div>';
            if (puedeEditar) {
                html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
                html += '<button onclick="openRecetaModal(\'' + r.id + '\')" style="padding:8px 16px;border-radius:999px;border:none;background:var(--accent);color:var(--accent-on);font-size:.8rem;font-weight:600;cursor:pointer;">Editar</button>';
                html += '<button onclick="toggleRecetaActiva(\'' + r.id + '\')" style="padding:8px 16px;border-radius:999px;border:1px solid var(--border-mid);background:transparent;color:var(--txt-secondary);font-size:.8rem;cursor:pointer;">' +
                        (r.activa ? 'Desactivar' : 'Activar') + '</button>';
                html += '<button onclick="eliminarReceta(\'' + r.id + '\')" style="padding:8px 16px;border-radius:999px;border:1px solid var(--danger-dim);background:transparent;color:var(--danger);font-size:.8rem;cursor:pointer;">Eliminar</button>';
                html += '</div>';
            }
            html += '</div>';

            html += '<div style="margin-top:18px;">';
            html += '<p style="font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--txt-secondary);margin-bottom:8px;">Ingredientes</p>';
            html += '<table style="width:100%;border-collapse:collapse;font-size:.85rem;">';
            r.ingredientes.forEach(function(ing) {
                var producto = products.find(function(p) { return p.id === ing.productoId; });
                var costoLinea = producto ? costoLineaReceta(ing, producto) : null;
                html += '<tr style="border-bottom:1px solid var(--border-mid);">';
                html += '<td style="padding:8px 4px;color:var(--txt-primary);">' + escapeHtml(producto ? producto.name : (ing.descripcionExcel || ing.productoId)) +
                        (producto ? '' : ' <span style="color:var(--danger);font-size:.72rem;">(no está en el catálogo)</span>') + '</td>';
                html += '<td style="padding:8px 4px;text-align:right;color:var(--txt-secondary);white-space:nowrap;">' +
                        escapeHtml(ing.cantidad) + ' ' + escapeHtml(ing.uom || '') + '</td>';
                if (puedeEditar) {
                    html += '<td style="padding:8px 4px;text-align:right;color:var(--txt-secondary);white-space:nowrap;">' +
                            (costoLinea === null ? '<span style="color:var(--warn);">sin costo</span>' : ('$' + costoLinea.toFixed(2))) + '</td>';
                }
                html += '</tr>';
            });
            html += '</table></div>';

            if (puedeEditar) {
                html += '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-mid);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">';
                html += '<span style="font-weight:700;color:var(--txt-primary);">Costo por porción</span>';
                html += '<span style="font-weight:800;font-size:1.05rem;color:' + (cr.incompleto ? 'var(--warn)' : 'var(--accent)') + ';">' +
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
