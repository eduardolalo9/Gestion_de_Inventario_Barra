        function getTotalStock(product) {
            if (!product.stockByArea) return 0;
            return (product.stockByArea.almacen || 0) + (product.stockByArea.barra1 || 0) + (product.stockByArea.barra2 || 0);
        }

        // ══════════════════════════════════════════════════════════════════════
        //  CONVERSIÓN OZ → PUNTOS DE BOTELLA
        // ══════════════════════════════════════════════════════════════════════

        /**
         * convertirOzAPuntos(pesoActualOz, capacidadMl, pesoBotellaLlenaOz)
         * ────────────────────────────────────────────────────────────────────
         * Convierte el peso actual de una botella abierta (en oz) a una fracción
         * de botella (0 = vacía, 1 = llena).
         *
         * Lógica:
         *   liquidoOz    = capacidadMl / 29.5735          (capacidad en oz)
         *   pesoVidrio   = pesoBotellaLlenaOz - liquidoOz  (peso del vidrio)
         *   liquidoActual= pesoActualOz - pesoVidrio        (líquido restante en oz)
         *   puntos       = liquidoActual / liquidoOz         (fracción 0–1)
         *
         * @param {number} pesoActualOz      Peso que marca la báscula ahora (oz)
         * @param {number} capacidadMl       Capacidad nominal de la botella (ml)
         * @param {number} pesoBotellaLlenaOz Peso de la botella cuando estaba llena (oz)
         * @returns {number} Fracción entre 0 y 1 (limitada)
         */
        function convertirOzAPuntos(pesoActualOz, capacidadMl, pesoBotellaLlenaOz) {
            const ML_POR_OZ = 29.5735;
            const liquidoOz       = capacidadMl / ML_POR_OZ;
            const pesoVidrio      = pesoBotellaLlenaOz - liquidoOz;
            const liquidoActualOz = pesoActualOz - pesoVidrio;
            const puntos          = liquidoActualOz / liquidoOz;
            // FIX 3 — PRECISIÓN MATEMÁTICA
            // Math.min/max con aritmética de punto flotante IEEE-754 puede generar
            // resultados como 0.30000000000000004 que se propagan al acumular
            // múltiples botellas y distorsionan los totales de inventario.
            // Solución: redondear el resultado FINAL a exactamente 4 decimales
            // usando multiplicación-entero-división, que es más fiable que
            // parseFloat(toFixed(4)) en todos los motores JS.
            const clamped = Math.min(1, Math.max(0, puntos));
            return Math.round(clamped * 10000) / 10000;
        }

        /**
         * tieneConversion(product)
         * Devuelve true si el producto tiene los datos para convertir oz→puntos.
         */
        function tieneConversion(product) {
            return product &&
                   typeof product.capacidadMl === 'number' && product.capacidadMl > 0 &&
                   typeof product.pesoBotellaLlenaOz === 'number' && product.pesoBotellaLlenaOz > 0;
        }

        /**
         * calcularTotalConAbiertas(productId, area)
         * ─────────────────────────────────────────
         * Calcula total = enteras + Σ(puntos de cada abierta).
         * Si el producto no tiene datos de conversión, las abiertas se suman
         * tal cual (compatible con comportamiento anterior).
         */
        function calcularTotalConAbiertas(productId, area) {
            const product  = products.find(p => p.id === productId);
            if (!product) return 0;
            const areaData = (inventarioConteo[productId] && inventarioConteo[productId][area]) || { enteras: 0, abiertas: [] };
            const enteras  = areaData.enteras || 0;
            const abiertas = areaData.abiertas || [];

            let sumaAbiertas = 0;
            if (tieneConversion(product)) {
                abiertas.forEach(pesoOz => {
                    sumaAbiertas += convertirOzAPuntos(pesoOz, product.capacidadMl, product.pesoBotellaLlenaOz);
                });
            } else {
                // Fallback: sumar como fracciones directas (comportamiento anterior)
                abiertas.forEach(val => { sumaAbiertas += (val || 0); });
            }

            return enteras + sumaAbiertas;
        }

        // FIX 1 — Fuente única de verdad: inventarioConteo → stockByArea
        // Reconstruye product.stockByArea para todos los productos a partir de
        // inventarioConteo. Ahora incluye la conversión oz→puntos de abiertas.
        function syncStockByAreaFromConteo() {
            products.forEach(p => {
                if (!p.stockByArea) p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
                Object.keys(areas).forEach(area => {
                    const d = inventarioConteo[p.id] && inventarioConteo[p.id][area];
                    // Solo sobreescribir si hay un dato explícito en conteo
                    if (d && typeof d.enteras === 'number') {
                        // Almacenar el total real (enteras + puntos de abiertas)
                        p.stockByArea[area] = calcularTotalConAbiertas(p.id, area);
                    }
                });
            });
        }

        function getAvailableGroups() {
            const groups = new Set(products.map(p => p.group).filter(g => g && g.trim() !== ''));
            return ['Todos', ...Array.from(groups).sort()];
        }

        function sbOpen() {
            document.getElementById('sidebar').classList.add('sb-open');
            document.getElementById('sbOverlay').classList.add('sb-open');
            document.getElementById('hamburgerBtn').setAttribute('aria-expanded','true');
            document.body.style.overflow = 'hidden';
        }
        function sbClose() {
            document.getElementById('sidebar').classList.remove('sb-open');
            document.getElementById('sbOverlay').classList.remove('sb-open');
            document.getElementById('hamburgerBtn').setAttribute('aria-expanded','false');
            document.body.style.overflow = '';
            // Devolver foco al botón hamburguesa para accesibilidad
            document.getElementById('hamburgerBtn').focus();
        }
        // BUG-FIX C4: ESC solo cierra el sidebar si ningún modal está abierto
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            const anyModal = ['productModal','orderModal','inventarioModal'].some(
                id => !document.getElementById(id).classList.contains('hidden')
            );
            if (!anyModal) sbClose();
        });

        function switchTab(tab) {
            activeTab = tab;
            document.querySelectorAll('.tab-btn').forEach(btn => {
                const indicator = btn.querySelector('.tab-indicator');
                if (btn.dataset.tab === tab) {
                    btn.classList.remove('text-gray-600');
                    btn.classList.add('text-gray-900');
                    if (!indicator) {
                        const div = document.createElement('div');
                        div.className = 'tab-indicator absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-orange-500 rounded-t-full animate-slideIn';
                        btn.appendChild(div);
                    }
                } else {
                    btn.classList.remove('text-gray-900');
                    btn.classList.add('text-gray-600');
                    if (indicator) indicator.remove();
                }
            });
            document.querySelectorAll('.sb-item').forEach(btn => {
                if (btn.dataset.sbTab === tab) btn.classList.add('sb-active');
                else btn.classList.remove('sb-active');
            });
            // Sincronizar bottom tab bar
            document.querySelectorAll('#bottomTabBar .btab-item').forEach(btn => {
                if (btn.dataset.btab === tab) btn.classList.add('btab-active');
                else btn.classList.remove('btab-active');
            });
            saveToLocalStorage();
            renderTab();
        }

        function switchArea(area) {
            if (isInventarioModalOpen) {
                showNotification('Cierra el modal de inventario antes de cambiar de área');
                return;
            }
            selectedArea = area;
            saveToLocalStorage();
            renderTab();
        }

        // Throttling para notificaciones (mínimo 1s entre cada una)
        let notificationTimeout = null;
        // Timer externo para el toast (evita asignar propiedades en elementos DOM)
        let toastHideTimer = null;
        function showNotification(message) {
            // Bug #9 fix: alertas críticas siempre pasan, independiente del throttle
            const isCritical = message.startsWith('⚠️') || message.startsWith('❌');
            if (notificationTimeout && !isCritical) return;
            const toast = document.getElementById('toast');
            const toastMessage = document.getElementById('toastMessage');
            if (!toast || !toastMessage) return;
            toastMessage.textContent = message;
            toast.classList.remove('hidden');
            toast.style.animation = 'none';
            void toast.offsetWidth;
            toast.style.animation = '';
            clearTimeout(toastHideTimer);
            toastHideTimer = setTimeout(() => {
                toast.classList.add('hidden');
            }, 3000);
            notificationTimeout = setTimeout(() => { notificationTimeout = null; }, 1000);
        }

        // Debounce para búsqueda: evita re-renders y escrituras en localStorage en cada tecla
        let _searchDebounceTimer = null;
        function updateSearchTerm(value) {
            searchTerm = value;
            clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(() => {
        saveToLocalStorage();
        renderTab();
        // CORRECCIÓN BUG 1: restaurar foco y cursor al final del input de búsqueda
        // tras el re-render que destruye y recrea el DOM
        const searchInput = document.querySelector('#tabContent input[type="text"]');
        if (searchInput) {
            searchInput.focus();
            const len = searchInput.value.length;
            searchInput.setSelectionRange(len, len);
        }
    }, 300);
        }

        function updateSelectedGroup(value) {
            selectedGroup = value;
            saveToLocalStorage();
            renderTab();
        }

        // FIX 4 — Re-render: preservar scroll y foco; evitar salto visual innecesario
        // BUG-FIX m4: _getElementSelector también detecta input de búsqueda por placeholder
        function _getElementSelector(el) {
            if (!el || el === document.body) return null;
            if (el.id) return '#' + el.id;
            // Detectar el input de búsqueda por su placeholder único
            if (el.tagName === 'INPUT' && el.placeholder === 'Buscar...') {
                return '#tabContent input[placeholder="Buscar..."]';
            }
            // Para inputs dentro de tabContent: guardar posición en el formulario
            const parent = el.closest('[data-render-key]');
            if (parent) return '[data-render-key="' + parent.dataset.renderKey + '"] ' + el.tagName.toLowerCase();
            return null;
        }

        function renderTab() {
            updateHeaderActions();
            const content = document.getElementById('tabContent');

            // FIX 4: capturar estado antes del re-render
            const scrollY  = window.scrollY || window.pageYOffset;
            const focused  = document.activeElement;
            const focusedSelector = _getElementSelector(focused);
            // Preservar cursor en inputs de texto (p.ej. buscador)
            const cursorPos = (focused && focused.selectionStart !== undefined) ? focused.selectionStart : null;
            const focusedValue = (focused && focused.tagName === 'INPUT') ? focused.value : null;

            content.style.animation = 'none';
            void content.offsetWidth;
            content.style.animation = '';

            switch(activeTab) {
                case 'inicio':          content.innerHTML = renderInicioTab(); break;
                case 'productos':       content.innerHTML = renderProductosTab(); break;
                case 'pedidos':         content.innerHTML = renderPedidosTab(); break;
                case 'inventario':      content.innerHTML = renderInventarioTab(); break;
                case 'historia':        content.innerHTML = renderHistoriaTab(); break;
                case 'ajustes':         content.innerHTML = renderAjustesTab(); break;
                case 'notificaciones':  content.innerHTML = renderNotificacionesTab(); break;
                case 'admin':           content.innerHTML = isAdmin() ? renderAdminTab() : renderInicioTab(); break;
            }

            // FIX 4: restaurar scroll (en siguiente frame para no luchar con el layout)
            if (scrollY > 0) {
                requestAnimationFrame(() => { window.scrollTo(0, scrollY); });
            }

            // FIX 4: restaurar foco y cursor si el elemento existe en el nuevo DOM
            if (focusedSelector) {
                requestAnimationFrame(() => {
                    try {
                        const restored = document.querySelector(focusedSelector);
                        if (restored && typeof restored.focus === 'function') {
                            restored.focus({ preventScroll: true });
                            if (cursorPos !== null && restored.setSelectionRange) {
                                const len = (focusedValue !== null ? focusedValue : restored.value).length;
                                const pos = Math.min(cursorPos, len);
                                restored.setSelectionRange(pos, pos);
                            }
                        }
                    } catch (_) { /* selector inválido — ignorar */ }
                });
            }
        }

        function updateHeaderActions() {
            const headerActions = document.getElementById('headerActions');
            if (activeTab === 'inicio') {
                // En inicio: header limpio — acciones en las tarjetas y stats
                headerActions.innerHTML = '';
            } else if (activeTab === 'inventario') {
                // Conteo — botón Excel para exportar
                headerActions.innerHTML = '<button onclick="exportarAuditoriaExcel()" style="display:flex;align-items:center;gap:6px;padding:7px 13px;border-radius:var(--r-md);background:#065f46;border:1px solid rgba(34,197,94,.28);color:#86efac;font-size:.75rem;font-weight:600;cursor:pointer;"><svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>Excel</button>';
            } else if (activeTab === 'productos') {
                if (isAdmin()) {
                    headerActions.innerHTML = '<div class="flex gap-2 sm:gap-3 flex-wrap"><button onclick="openProductModal()" class="bg-gradient-to-r from-purple-500 to-orange-500 text-white px-3 sm:px-6 py-2 sm:py-3 rounded-full flex items-center gap-1 sm:gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 transition-all duration-200 text-xs sm:text-base whitespace-nowrap"><svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg><span class="hidden sm:inline">Agregar</span><span class="sm:hidden">+</span></button><button onclick="document.getElementById(\'fileInput\').click()" class="flex items-center gap-1 sm:gap-2 px-3 sm:px-5 py-2 sm:py-3 rounded-full text-xs sm:text-base whitespace-nowrap font-medium transition-all duration-200 shadow-md hover:scale-105 active:scale-95" style="background:#1a4731;border:1px solid rgba(34,197,94,0.28);color:#86efac;"><i class="fa-solid fa-file-arrow-up"></i><span class="hidden sm:inline">Importar Excel</span><span class="sm:hidden">Importar</span></button><button onclick="publicarCatalogoFirestore()" class="flex items-center gap-1 sm:gap-2 px-3 sm:px-5 py-2 sm:py-3 rounded-full text-xs sm:text-base whitespace-nowrap font-medium transition-all duration-200 shadow-md hover:scale-105 active:scale-95" style="background:#1a3a5f;border:1px solid rgba(59,130,246,0.28);color:#93c5fd;"><i class="fa-solid fa-cloud-arrow-up"></i><span class="hidden sm:inline">Publicar catálogo</span><span class="sm:hidden">Publicar</span></button><button onclick="deleteAllProducts()" class="bg-gradient-to-r from-red-500 to-orange-600 text-white px-3 sm:px-6 py-2 sm:py-3 rounded-full flex items-center gap-1 sm:gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 transition-all duration-200 text-xs sm:text-base whitespace-nowrap" title="Eliminar todos"><svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg><span class="hidden sm:inline">Eliminar Todos</span><span class="sm:hidden">Del</span></button></div>';
                } else {
                    headerActions.innerHTML = '<span style="font-size:.72rem;color:rgba(255,255,255,.55);padding:6px 10px;background:rgba(255,255,255,.08);border-radius:6px;">📋 Solo lectura</span>';
                }
            } else {
                headerActions.innerHTML = '';
            }
        }

        /**
         * _getAuditConteoParaProducto(prodId)
         * ─────────────────────────────────────
         * Devuelve los datos de auditoría para un producto desglosados por área.
         * Fuente: auditoriaConteo (admin) o myAuditoriaConteo (usuario regular),
         * exactamente la misma lógica que usa renderAuditoriaConteo().
         *
         * Retorna un objeto { almacen, barra1, barra2, _hayDatos } donde cada área es:
         *   null  → sin datos contados
         *   { enteras, numAbiertas, sumaAbiertas } → con datos
         */
        function _getAuditConteoParaProducto(prodId) {
            // Misma fuente de verdad que renderAuditoriaConteo
            const conteoFuente = isAdmin() ? auditoriaConteo : myAuditoriaConteo;
            const AREAS        = AREAS_CONTEO;
            var result         = { _hayDatos: false };
            // FIX: buscar el producto para aplicar conversión oz→puntos si corresponde.
            // Sin esto, sumaAbiertas era la suma cruda de oz (ej. 33.45) en lugar de
            // la fracción de botella (ej. 0.86), haciendo que el total en el chip
            // mostrara valores absurdos como "2 + 33 = 35" en vez de "2.86 botellas".
            const product = products.find(function(p) { return p.id === prodId; });
            const usaConv = product ? tieneConversion(product) : false;

            AREAS.forEach(function(area) {
                var d = conteoFuente[prodId] && conteoFuente[prodId][area];
                if (!d) { result[area] = null; return; }

                var enteras     = d.enteras || 0;
                var abiertasArr = d.abiertas || [];
                // FIX: aplicar conversión oz→puntos si el producto la soporta.
                // Para productos sin conversión, sumamos directo (fracciones ya normalizadas).
                var suma = 0;
                if (usaConv) {
                    abiertasArr.forEach(function(oz) {
                        suma += convertirOzAPuntos(oz || 0, product.capacidadMl, product.pesoBotellaLlenaOz);
                    });
                    suma = Math.round(suma * 10000) / 10000;
                } else {
                    suma = abiertasArr.reduce(function(s, v) { return s + (v || 0); }, 0);
                }
                var hayValor = enteras > 0 || abiertasArr.some(function(v) { return v > 0; });

                if (hayValor) {
                    result[area]     = { enteras: enteras, numAbiertas: abiertasArr.length, sumaAbiertas: suma };
                    result._hayDatos = true;
                } else {
                    result[area] = null;
                }
            });

            return result;
        }

        function renderInicioTab() {
            const filteredProducts = filterByGroup();
            const totalProducts    = products.length;
            const totalStockAll    = products.reduce((s, p) => s + getTotalStock(p), 0);
            const cartCount        = cart.reduce((s, c) => s + (c.quantity || 1), 0); // FIX: era c.qty (undefined), debe ser c.quantity
            const ordersCount      = orders.length;
            const syncOn           = typeof _syncEnabled !== 'undefined' ? _syncEnabled : true;

            // ── Stats 2×2 ─────────────────────────────────────────────────────
            let html = '<div class="stat-grid">';
            html += '<div class="stat-card" onclick="void(0)">'
                  + '<div class="stat-card__icon" style="background:rgba(59,130,246,0.12);">📦</div>'
                  + '<div><div class="stat-card__val" style="color:#60a5fa;">' + totalProducts + '</div>'
                  + '<div class="stat-card__label">Productos</div></div></div>';
            html += '<div class="stat-card" onclick="void(0)">'
                  + '<div class="stat-card__icon" style="background:rgba(34,197,94,0.12);">📊</div>'
                  + '<div><div class="stat-card__val" style="color:#4ade80;">' + totalStockAll.toFixed(1) + '</div>'
                  + '<div class="stat-card__label">Stock Total</div></div></div>';
            html += '<div class="stat-card" style="cursor:pointer;" onclick="openOrderModal()">'
                  + '<div class="stat-card__icon" style="background:rgba(245,158,11,0.12);">🛒</div>'
                  + '<div><div class="stat-card__val" style="color:#fb923c;">' + cartCount + '</div>'
                  + '<div class="stat-card__label">En Carrito</div></div></div>';
            html += '<div class="stat-card" onclick="switchTab(\'pedidos\')"  style="cursor:pointer;">'
                  + '<div class="stat-card__icon" style="background:rgba(59,130,246,0.12);">📋</div>'
                  + '<div><div class="stat-card__val" style="color:#60a5fa;">' + ordersCount + '</div>'
                  + '<div class="stat-card__label">Pedidos</div></div></div>';
            html += '</div>';

            // ── Búsqueda + filtro de grupo ─────────────────────────────────────
             // Buscador inteligente con clear button y feedback visual
    html += '<div class="csb-wrap' + (searchTerm ? ' csb-wrap--active' : '') + '">';
    html += '<svg class="csb-icon" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
        + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>';
    html += '<input id="inicio-search-input" type="search" class="csb-input"'
        + ' placeholder="Buscar por nombre, código o grupo\u2026"'
        + ' value="' + escapeHtml(searchTerm) + '"'
        + ' oninput="updateSearchTerm(this.value)"'
        + ' onkeydown="if(event.key===\'Escape\'){event.preventDefault();this.value=\'\';updateSearchTerm(\'\');}"'
        + ' autocomplete="off" autocorrect="off" spellcheck="false">';
    html += '<button class="csb-clear" onclick="document.getElementById(\'inicio-search-input\').value=\'\';updateSearchTerm(\'\');" title="Limpiar (Esc)" aria-label="Limpiar búsqueda">✕</button>';
    html += '</div>';

            // ── Pill-rail de grupos (horizontal, sin select) ───────────────────
            html += '<div class="grp-rail-wrap"><div class="grp-rail">';
            getAvailableGroups().forEach(function(g) {
                var isActive = selectedGroup === g;
                html += '<button type="button" class="grp-pill' + (isActive ? ' grp-pill--active' : '') + '"'
                      + ' onclick="updateSelectedGroup(\'' + escapeHtml(g).replace(/'/g, '&#39;') + '\')">'
                      + escapeHtml(g)
                      + '</button>';
            });
            html += '</div></div>';

            // ── Botones de acción (admin) ─────────────────────────────────────
            if (isAdmin()) {
                html += '<div class="inicio-btn-row">';
                html += '<button class="inicio-btn primary" onclick="openProductModal()">'
                      + '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>'
                      + 'Producto</button>';
                html += '<button class="inicio-btn success" onclick="document.getElementById(\'fileInput\').click()">'
                      + '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>'
                      + 'Excel</button>';
                html += '</div>';
            }

            // ── Tarjetas de productos ─────────────────────────────────────────
            if (filteredProducts.length === 0) {
                html += '<div style="text-align:center;padding:40px 20px;color:var(--txt-muted);">'
                      + '<div style="font-size:2.5rem;margin-bottom:12px;">📦</div>'
                      + '<p style="font-size:.88rem;">No se encontraron productos</p></div>';
            } else {
                filteredProducts.forEach((product, idx) => {
                    // FIX: sba (stockByArea) eliminada — ya no se usa en los chips.
                    // hasData ahora refleja si hay datos de auditoría, que es lo que
                    // muestran los chips (antes usaba getTotalStock/stockByArea, inconsistente).
                    const total   = getTotalStock(product);   // sigue usándose en la línea meta
                    const adCheck = _getAuditConteoParaProducto(product.id);
                    const hasData = adCheck._hayDatos || total > 0;
                    const delay   = Math.min(idx * 30, 400);

                    html += '<div class="prd-card' + (hasData ? ' has-data' : '') + '" style="animation-delay:' + delay + 'ms">';
                    // Top row: nombre + botones
                    html += '<div class="prd-card__top">';
                    html += '<div class="prd-card__name">' + escapeHtml(product.name) + '</div>';
                    html += '<div class="prd-card__actions">';
                    html += '<button class="prd-action-btn cart" onclick="addToCart(\'' + escapeHtml(product.id) + '\')" title="Agregar al carrito">'
                          + '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg></button>';
                    if (isAdmin()) {
                        html += '<button class="prd-action-btn edit" onclick="editProduct(\'' + escapeHtml(product.id) + '\')" title="Editar producto">'
                              + '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>';
                        html += '<button class="prd-action-btn del" onclick="deleteProduct(\'' + escapeHtml(product.id) + '\')" title="Eliminar producto">'
                              + '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>';
                    }
                    html += '</div></div>';
                    // Group badge
                    html += '<div class="prd-card__group-badge">' + escapeHtml(product.group || 'General') + '</div>';
                    // Meta: ID · Unit · Total
                    html += '<div class="prd-card__meta">' + escapeHtml(product.id) + ' · ' + escapeHtml(product.unit || '') + ' · Total: ' + total.toFixed(2) + '</div>';
                    // Area chips — total contado de auditoría por área
                    var ad           = adCheck;   // reutilizar el resultado ya calculado arriba
                    var CHIP_LABELS  = { almacen: 'Almacén', barra1: 'Barra 1', barra2: 'Barra 2' };
                    html += '<div class="prd-card__areas">';
                    AREAS_CONTEO.forEach(function(area) {
                        var d          = ad[area];
                        var totalAudit = d ? (d.enteras + d.sumaAbiertas) : null;
                        html += '<div class="prd-area-chip">';
                        html += '<span class="prd-area-chip__label">' + CHIP_LABELS[area] + '</span>';
                        if (totalAudit !== null) {
                            html += '<span class="prd-area-chip__val">' + totalAudit.toFixed(2) + '</span>';
                        } else {
                            html += '<span class="prd-area-chip__val" style="color:var(--txt-muted);font-size:0.78rem;font-weight:500;">—</span>';
                        }
                        html += '</div>';
                    });
                    html += '</div>';

                    html += '</div>';
                });
            }

            // ── Zona admin: eliminar todos ─────────────────────────────────────
            if (isAdmin() && filteredProducts.length > 0) {
                html += '<button class="inicio-btn danger" onclick="deleteAllProducts()" style="margin-top:10px;">'
                      + '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:15px;height:15px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>'
                      + 'Eliminar todos los productos</button>';
            }

            // ── Sincronización ─────────────────────────────────────────────────
            html += '<div class="sync-card" style="margin-top:14px;">';
            html += '<h3><span>⚙️</span> Sincronización</h3>';
            html += '<div class="sync-card__row">';
            html += '<div><div class="sync-status-text">☁️ ' + (syncOn ? 'Activa' : 'Pausada') + '</div>'
                  + '<div class="sync-status-sub">' + (syncOn ? 'Datos subiéndose automáticamente a la nube.' : 'Sincronización en pausa.') + '</div></div>';
            html += '<button class="sync-pause-btn" onclick="toggleSyncEnabled(); renderTab();">'
                  + '<svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + (syncOn ? 'M10 9v6m4-6v6' : 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z') + 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
                  + (syncOn ? 'Pausar' : 'Reanudar') + '</button>';
            html += '</div></div>';

            // ── Reportes publicados (solo admin) ──────────────────────────────
            if (isAdmin()) {
                html += '<div class="sync-card">';
                html += '<h3><span>📊</span> Reportes Publicados</h3>';
                html += '<button class="inicio-btn success" style="width:100%;justify-content:center;" onclick="generarYPublicarReporte()">'
                      + '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:15px;height:15px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>'
                      + 'Generar y publicar reporte final</button>';
                html += '<div id="inicioReportesLista" style="margin-top:10px;"></div>';
                html += '</div>';
                // Cargar lista de reportes desde admin tab si está disponible
                setTimeout(() => {
                    const el = document.getElementById('inicioReportesLista');
                    if (el && _db) {
                        _db.collection('reportes').orderBy('fechaTs', 'desc').limit(3).get() // FIX: .get() estaba dentro del comentario — cadena rota
                            .then(snap => {
                                if (snap.empty) { el.innerHTML = '<p style="font-size:.75rem;color:var(--txt-muted);">Sin reportes publicados aún.</p>'; return; }
                                let rows = '';
                                snap.forEach(doc => {
                                    const d = doc.data();
                                    const f = d.fecha || '—'; // FIX-4: d.fecha ya es string legible; no reparsear con new Date()
                                    rows += '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:.75rem;">'
                                          + '<span style="color:var(--txt-secondary);">' + escapeHtml(f) + '</span>'
                                          + '<span style="color:var(--txt-muted);">' + escapeHtml(String(d.totalProductos || 0)) + ' prods</span></div>';
                                });
                                el.innerHTML = rows;
                            }).catch(() => { el.innerHTML = ''; });
                    }
                }, 100);
            }

            return html;
        }

        function renderProductosTab() {
            const filteredProducts = filterByGroup();
            let html = '';
            // ── Pill-rail de grupos ───────────────────────────────────────────
            html += '<div class="grp-rail-wrap"><div class="grp-rail">';
            getAvailableGroups().forEach(function(group) {
                var isActive = selectedGroup === group;
                html += '<button type="button" class="grp-pill' + (isActive ? ' grp-pill--active' : '') + '"'
                      + ' onclick="updateSelectedGroup(\'' + escapeHtml(group).replace(/'/g, '&#39;') + '\')">'
                      + escapeHtml(group)
                      + '</button>';
            });
            html += '</div></div>';
            if (!isAdmin()) {
                html += '<div style="background:var(--accent-dim);border:1px solid var(--accent-dim2);border-radius:var(--r-md);padding:8px 12px;margin-bottom:12px;font-size:.78rem;color:var(--accent);">📋 Catálogo de solo lectura — solo el administrador puede modificar productos</div>';
            }
            html += '<div class="bg-white rounded-xl sm:rounded-2xl shadow-md overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm sm:text-base"><thead class="bg-gradient-to-r from-purple-600 to-blue-600"><tr><th class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-left text-xs sm:text-sm font-semibold text-white">Nombre del Producto</th><th class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-left text-xs sm:text-sm font-semibold text-white hidden md:table-cell">Grupo</th><th class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-left text-xs sm:text-sm font-semibold text-white">Unidad</th>';
            if (isAdmin()) html += '<th class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-center text-xs sm:text-sm font-semibold text-white">Acc</th>';
            html += '</tr></thead><tbody class="divide-y divide-gray-200">';
            filteredProducts.forEach((product, idx) => {
                const delay = Math.min(idx * 35, 350);
                html += '<tr class="hover:bg-purple-50 transition-colors" style="animation: rowIn 0.25s ease-out both; animation-delay:' + delay + 'ms">';
                html += '<td class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 font-medium text-gray-900 text-xs sm:text-sm">' + escapeHtml(product.name) + '</td>';
                html += '<td class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-600 hidden md:table-cell text-xs sm:text-sm">' + escapeHtml(product.group || 'General') + '</td>';
                html += '<td class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-600 text-xs sm:text-sm">' + escapeHtml((product.unit || '').substring(0, 8)) + '</td>';
                if (isAdmin()) {
                    html += '<td class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4"><div class="flex items-center justify-center gap-1">';
                    html += '<button onclick="editProduct(\'' + escapeHtml(product.id) + '\')" class="p-1.5 sm:p-2.5 bg-gradient-to-br from-blue-500 to-purple-500 text-white rounded-lg sm:rounded-xl hover:shadow-lg transition-all transform active:scale-95 min-w-[36px] sm:min-w-[48px] min-h-[36px] sm:min-h-[48px] flex items-center justify-center"><svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>';
                    html += '<button onclick="deleteProduct(\'' + escapeHtml(product.id) + '\')" class="p-1.5 sm:p-2.5 bg-gradient-to-br from-red-500 to-orange-500 text-white rounded-lg sm:rounded-xl hover:shadow-lg transition-all transform active:scale-95 min-w-[36px] sm:min-w-[48px] min-h-[36px] sm:min-h-[48px] flex items-center justify-center"><svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>';
                    html += '</div></td>';
                }
                html += '</tr>';
            });
            html += '</tbody></table></div></div>';
            return html;
        }

        function renderPedidosTab() {
            let headerHtml = '<div style="margin-bottom:14px;"><h2 style="font-size:1.05rem;font-weight:700;color:var(--txt-primary);">Pedidos WhatsApp</h2><p style="font-size:.75rem;color:var(--txt-muted);">Solo en este dispositivo</p></div>';
            if (orders.length === 0) {
                return headerHtml + '<div class="bg-white rounded-2xl shadow-md" style="padding:50px 20px;text-align:center;"><div style="font-size:3rem;margin-bottom:12px;">🛒</div><p style="font-size:.95rem;font-weight:600;color:var(--txt-secondary);margin-bottom:6px;">No hay pedidos todavía</p><p style="font-size:.78rem;color:var(--txt-muted);">Ve a Inicio, agrega productos con 🛒 y genera un pedido</p></div>';
            }
            // FIX-BUSCADOR-PEDIDOS (BarInventario): buscador fuzzy — mismo motor
            // que Inicio (_csBigrams) — sobre folio, proveedor, nota y productos.
            let html = headerHtml;
            html += '<div class="csb-wrap' + (_pedidosSearchTerm ? ' csb-wrap--active' : '') + '" id="pedidos-csb-wrap">'
                + '<svg class="csb-icon" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
                + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>'
                + '<input id="pedidos-search-input" type="search" class="csb-input"'
                + ' placeholder="Buscar por folio, proveedor o producto\u2026"'
                + ' value="' + escapeHtml(_pedidosSearchTerm) + '"'
                + ' oninput="updatePedidosSearch(this.value)"'
                + ' onkeydown="if(event.key===\'Escape\'){event.preventDefault();clearPedidosSearch();}"'
                + ' autocomplete="off" autocorrect="off" spellcheck="false">'
                + '<button class="csb-clear" onclick="clearPedidosSearch()" title="Limpiar (Esc)" aria-label="Limpiar búsqueda">✕</button>'
                + '</div>';
            html += '<div class="mb-6">';
            if (isAdmin()) {
            html += '<button onclick="deleteAllOrders()" class="bg-gradient-to-r from-red-500 to-orange-600 text-white px-6 py-3 rounded-xl flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 transition-all duration-200" title="Eliminar todos los pedidos"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg><span class="font-medium">Eliminar todos los pedidos</span></button>';
            }
            html += '</div><div class="space-y-4">';
            const filteredOrders = _filtrarPedidos();
            if (_pedidosSearchTerm && filteredOrders.length === 0) {
                html += '<div class="bg-white rounded-2xl shadow-md" style="padding:40px 20px;text-align:center;"><p style="font-size:.85rem;color:var(--txt-muted);">Sin resultados para "' + escapeHtml(_pedidosSearchTerm) + '"</p></div>';
            }
            filteredOrders.forEach((order, idx) => {
                const delay = Math.min(idx * 50, 400);
                html += '<div class="bg-white rounded-2xl p-6 shadow-md" style="animation: tabContentIn 0.3s ease-out both; animation-delay:' + delay + 'ms"><div class="flex justify-between items-start mb-4"><div><h3 class="text-xl font-bold text-gray-900">' + escapeHtml(order.id) + '</h3><p class="text-gray-600">Proveedor: ' + escapeHtml(order.supplier) + '</p><p class="text-sm text-gray-600">Fecha: ' + escapeHtml(order.date) + '</p>';
                if (order.deliveryDate) html += '<p class="text-sm text-gray-600">Entrega: ' + escapeHtml(order.deliveryDate) + '</p>';
                html += '</div><div class="flex gap-2"><button onclick="shareOrderWhatsApp(\'' + escapeHtml(order.id) + '\')" class="p-2.5 bg-gradient-to-br from-green-500 to-emerald-500 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg></button><button onclick="deleteOrder(\'' + escapeHtml(order.id) + '\')" class="p-2.5 bg-gradient-to-br from-red-500 to-orange-500 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></div></div><div class="overflow-x-auto"><table class="w-full"><thead class="bg-gradient-to-r from-purple-600 to-blue-600"><tr><th class="px-4 py-3 text-left text-sm font-semibold text-white">Nombre de Producto</th><th class="px-4 py-3 text-center text-sm font-semibold text-white">Unidad de Medida</th><th class="px-4 py-3 text-center text-sm font-semibold text-white">Cantidad</th></tr></thead><tbody class="divide-y divide-gray-200">';
                order.products.forEach(p => {
                    html += '<tr><td class="px-4 py-3 text-gray-900">' + escapeHtml(p.name) + '</td><td class="px-4 py-3 text-center text-gray-600">' + escapeHtml(p.unit) + '</td><td class="px-4 py-3 text-center font-semibold text-gray-900">' + p.quantity + '</td></tr>';
                });
                html += '</tbody></table></div><div class="mt-4 pt-4 border-t border-gray-200"><div class="text-right mb-2"><span class="text-lg font-bold text-gray-900">Total Productos: ' + (order.total || 0).toFixed(2) + '</span></div>';
                if (order.note) html += '<div class="mt-3 p-3 bg-purple-50 rounded-xl"><p class="text-sm font-medium text-gray-600 mb-1">Nota:</p><p class="text-gray-900">' + escapeHtml(order.note) + '</p></div>';
                html += '</div></div>';
            });
            html += '</div>';
            return html;
        }

        // Bug #11 fix: modal de confirmación propio — reemplaza confirm() nativo que
        // puede bloquearse silenciosamente en Safari PWA y algunos navegadores en fullscreen.
        function showConfirm(message, onConfirm) {
            // ═══ FIX #5: Prevenir modales de confirmación duplicados ═══
            // Si se llama showConfirm mientras otro ya está abierto (ej. doble clic
            // en un botón de eliminar), el anterior se elimina antes de crear el nuevo.
            var existing = document.getElementById('_confirmOverlay');
            if (existing) existing.remove();
            const overlay = document.createElement('div');
            overlay.id = '_confirmOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease-out;';
            overlay.innerHTML =
                '<div style="background:var(--card);border:1px solid var(--border-mid);border-radius:10px;' +
                'padding:24px 24px 20px;max-width:360px;width:90%;box-shadow:var(--shadow-modal);">' +
                '<p style="color:var(--txt-primary);font-family:\'IBM Plex Sans\',sans-serif;font-size:0.875rem;' +
                'line-height:1.55;margin:0 0 20px;white-space:pre-wrap;">' + message.replace(/</g, '&lt;') + '</p>' +
                '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
                '<button id="_cfmCancel" style="padding:7px 18px;border:1px solid var(--border-mid);border-radius:6px;' +
                'background:transparent;color:var(--txt-secondary);font-family:\'IBM Plex Sans\',sans-serif;' +
                'font-size:0.8125rem;cursor:pointer;">Cancelar</button>' +
                '<button id="_cfmOk" style="padding:7px 18px;background:var(--red);color:#fff;border:none;' +
                'border-radius:6px;font-family:\'IBM Plex Sans\',sans-serif;font-size:0.8125rem;' +
                'font-weight:600;cursor:pointer;">Confirmar</button>' +
                '</div></div>';
document.body.appendChild(overlay);
    // FIX-3: escHandler se limpia en close() para TODOS los paths (ESC, Cancel, OK)
    const escHandler = function(e) { if (e.key === 'Escape') { close(); } };
    const close = () => {
        document.removeEventListener('keydown', escHandler);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };
    overlay.querySelector('#_cfmCancel').onclick = close;
    overlay.querySelector('#_cfmOk').onclick = function() { close(); onConfirm(); };
    document.addEventListener('keydown', escHandler);
                // Foco automático en Cancelar (más seguro)
            setTimeout(() => { const btn = overlay.querySelector('#_cfmCancel'); if (btn) btn.focus(); }, 30);
        }

        function resetAllInventario() {
            showConfirm('⚠️ ¿Estás seguro de que quieres borrar TODAS las cantidades de Almacén, Barra 1 y Barra 2?\n\nEsta acción no se puede deshacer.', function() {
                products.forEach(p => {
                    if (!p.stockByArea) p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
                    p.stockByArea.almacen = 0;
                    p.stockByArea.barra1 = 0;
                    p.stockByArea.barra2 = 0;
                });
                inventarioConteo = {};
                saveToLocalStorage();
                showNotification('Todas las cantidades han sido borradas');
                renderTab();
            });
        }

        function disableAreaButtons(disable) {
            const areaBtns = document.querySelectorAll('.area-btn');
            areaBtns.forEach(btn => {
                if (disable) btn.classList.add('disabled');
                else btn.classList.remove('disabled');
            });
        }

        function openInventarioModal(productId) {
            const product = products.find(p => p.id === productId);
            if (!product) return;
            inventarioModalProductId = productId;

            // ── Seleccionar fuente de datos (auditoría o conteo regular) ──
            let areaKey, areaLabel, conteoSource;
            if (isAuditoriaMode && auditoriaAreaActiva) {
                areaKey   = auditoriaAreaActiva;
                areaLabel = areasAuditoria[areaKey] || areaKey;
                if (!myAuditoriaConteo[productId]) myAuditoriaConteo[productId] = {};

                const yaConteoPropioAdmin = myAuditoriaConteo[productId][areaKey];

                if (isAdmin() && !yaConteoPropioAdmin) {
                    // ─────────────────────────────────────────────────────────
                    // FIX ADMIN-MERGE: El admin NO tiene conteo propio aún para
                    // este producto/área. Pre-cargar el conteo AGREGADO (ya suma
                    // lo que contaron todos los usuarios) para que el admin:
                    //   1. Vea lo que el usuario ya contó (no empiece desde 0)
                    //   2. Solo agregue lo que faltó (e.g. la botella abierta)
                    //   3. Al guardar, su conteo incluya TODO → no se pierde nada
                    //
                    // Si el admin ya contó antes (yaConteoPropioAdmin es truthy),
                    // se usa su propio conteo para que pueda seguir editando sin
                    // regresar al estado del usuario.
                    // ─────────────────────────────────────────────────────────
                    const agregado = auditoriaConteo[productId] && auditoriaConteo[productId][areaKey];
                    conteoSource = agregado
                        ? { enteras: agregado.enteras || 0, abiertas: (agregado.abiertas || []).slice() }
                        : { enteras: 0, abiertas: [] };
                } else {
                    // Usuario regular o admin que ya contó → usar su propio conteo
                    conteoSource = yaConteoPropioAdmin || { enteras: 0, abiertas: [] };
                }
            } else {
                areaKey = selectedArea;
                areaLabel = areas[areaKey] || areaKey;
                if (!inventarioConteo[productId]) inventarioConteo[productId] = {};
                conteoSource = inventarioConteo[productId][areaKey] || { enteras: 0, abiertas: [] };
            }

            document.getElementById('inventarioModalTitle').textContent = product.name;
            document.getElementById('inventarioModalSubtitle').textContent = (product.group || 'General') + ' · ' + (product.unit || '') + ' — ' + areaLabel;

            // Mostrar hint de unidad en botellas abiertas
            const hintEl = document.getElementById('inv_abiertasUnidadHint');
            if (hintEl) {
                hintEl.textContent = tieneConversion(product) ? '— ingresa el peso en oz' : '';
            }

            document.getElementById('inv_enteras').value = conteoSource.enteras || 0;
            const container = document.getElementById('inv_abiertasContainer');
            container.innerHTML = '';
            const abiertas = (conteoSource.abiertas && conteoSource.abiertas.length > 0) ? conteoSource.abiertas : [0];
            // Pasar si usa oz para el placeholder del input
            abiertas.forEach((val, idx) => renderAbiertaInput(val, idx, tieneConversion(product)));

            // ── CORRECCIÓN 4: Motivo obligatorio cuando hay valor previo ──────
            // Si ya existe un conteo para este producto/área, mostrar el selector de motivo.
            // Para un primer conteo (sin valor previo), se auto-selecciona "Conteo inicial".
            const motivoContainer = document.getElementById('inv_motivoContainer');
            const motivoSelect    = document.getElementById('inv_motivo');
            const prevEnteras     = conteoSource.enteras || 0;
            const hasPrevData     = prevEnteras > 0 ||
                                    (conteoSource.abiertas && conteoSource.abiertas.some(function(v) { return v > 0; }));
            if (motivoContainer && motivoSelect) {
                if (hasPrevData) {
                    // Hay valor previo → mostrar selector y exigir elección
                    motivoContainer.style.display = '';
                    motivoSelect.value = '';
                } else {
                    // Primer conteo → ocultar selector, pre-seleccionar "Conteo inicial"
                    motivoContainer.style.display = 'none';
                    motivoSelect.value = 'Conteo inicial';
                }
                // Limpiar error previo
                const errEl = document.getElementById('inv_motivoError');
                if (errEl) errEl.classList.add('hidden');
            }

            isInventarioModalOpen = true;
            disableAreaButtons(true);
            const modal = document.getElementById('inventarioModal');
            modal.classList.remove('hidden');
            document.body.classList.add('modal-open');
            setTimeout(() => {
                const firstInput = modal.querySelector('input, button');
                if (firstInput) firstInput.focus();
            }, 50);
            modal._trapHandler = function(e) {
                if (e.key !== 'Tab') return;
                const focusable = Array.from(modal.querySelectorAll('input, select, textarea, button'));
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
                else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
            };
            modal.addEventListener('keydown', modal._trapHandler);
        }

        function renderAbiertaInput(val, idx, usaOz) {
            const container = document.getElementById('inv_abiertasContainer');
            const div = document.createElement('div');
            div.className = 'flex items-center gap-2';
            div.id = 'abierta_row_' + idx;
            const unidadLabel = usaOz ? ' (oz)' : '';
            const placeholder = usaOz ? 'ej: 33.45 oz' : '0.0';
            div.innerHTML = '<span class="text-xs font-medium text-gray-500 w-20 flex-shrink-0">Abierta ' + (idx + 1) + unidadLabel + '</span>' +
                '<input type="number" id="inv_abierta_' + idx + '" min="0" step="0.01" value="' + val + '" ' +
                'oninput="if(parseFloat(this.value)<0||isNaN(parseFloat(this.value)))this.value=0;" ' +
                'class="flex-1 px-3 py-2 bg-white text-gray-900 border-2 border-orange-200 rounded-xl focus:ring-2 focus:ring-orange-400 focus:border-transparent text-center font-bold" ' +
                'placeholder="' + placeholder + '">' +
                (idx > 0 ? '<button onclick="removeAbiertaInModal(' + idx + ')" class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>' : '<div class="w-8"></div>');
            container.appendChild(div);
        }

        function addAbiertaInModal() {
            const container = document.getElementById('inv_abiertasContainer');
            if (container.children.length >= 10) {
                showNotification('Máximo 10 botellas abiertas permitidas');
                return;
            }
            const idx = container.children.length;
            const product = products.find(p => p.id === inventarioModalProductId);
            renderAbiertaInput(0, idx, tieneConversion(product));
        }

        function removeAbiertaInModal(idx) {
            const container = document.getElementById('inv_abiertasContainer');
            const vals = [];
            for (let i = 0; i < container.children.length; i++) {
                const input = document.getElementById('inv_abierta_' + i);
                if (input && i !== idx) vals.push(parseFloat(input.value) || 0);
            }
            container.innerHTML = '';
            const product = products.find(p => p.id === inventarioModalProductId);
            vals.forEach((v, i) => renderAbiertaInput(v, i, tieneConversion(product)));
        }

        saveInventarioModal._auditSyncTimer = null; // timer de debounce para sync parcial de auditoría

        function closeInventarioModal() {
            const modal = document.getElementById('inventarioModal');
            if (modal._trapHandler) { modal.removeEventListener('keydown', modal._trapHandler); modal._trapHandler = null; }
            modal.classList.add('hidden');
            document.body.classList.remove('modal-open');
            inventarioModalProductId = null;
            isInventarioModalOpen = false;
            disableAreaButtons(false);
        }

        function saveInventarioModal() {
            if (!inventarioModalProductId) return;

            // ── CICLO CERRADO: bloquear cualquier modificación ───────────────
            // El administrador cierra el ciclo cuando el inventario está listo;
            // después de eso nadie puede modificar conteos hasta que se reabra.
            if (isCicloBloqueado()) {
                showNotification('🔒 El inventario está CERRADO. Solo el administrador puede reabrir el ciclo.');
                closeInventarioModal();
                return;
            }

            // Validación: solo números positivos
            const enterasRaw = parseFloat(document.getElementById('inv_enteras').value);
            if (isNaN(enterasRaw) || enterasRaw < 0) {
                showNotification('⚠️ Las botellas enteras deben ser un número mayor o igual a 0');
                document.getElementById('inv_enteras').focus();
                return;
            }
            // Bug #7 fix: enteras debe ser entero — fracciones van en la sección Abiertas
            if (!Number.isInteger(enterasRaw)) {
                showNotification('⚠️ Las botellas enteras deben ser número entero. Usa la sección "Abiertas" para fracciones.');
                document.getElementById('inv_enteras').focus();
                return;
            }
            // ── CORRECCIÓN 4: Validar motivo obligatorio ─────────────────────
            const motivoSelect = document.getElementById('inv_motivo');
            const motivoVal    = motivoSelect ? motivoSelect.value.trim() : 'Conteo inicial';
            const motivoContainer = document.getElementById('inv_motivoContainer');
            const isMotivVisible  = motivoContainer && motivoContainer.style.display !== 'none';
            if (isMotivVisible && !motivoVal) {
                const errEl = document.getElementById('inv_motivoError');
                if (errEl) errEl.classList.remove('hidden');
                motivoSelect.focus();
                showNotification('⚠️ Debes seleccionar un motivo para modificar el conteo.');
                return;
            }
            const motivoFinal = motivoVal || 'Conteo inicial';

            // FIX-UPPER-BOUND: límite máximo razonable para evitar errores de tipeo (ej. 99 → 9999)
            if (enterasRaw > 9999) {
                showNotification('⚠️ Cantidad muy alta (' + enterasRaw + '). Verifica el valor antes de guardar.');
                document.getElementById('inv_enteras').focus();
                return;
            }
            const enteras = Math.max(0, enterasRaw);
            const container = document.getElementById('inv_abiertasContainer');
            const abiertas = [];
            let invalidAbierta = false;
            for (let i = 0; i < container.children.length; i++) {
                const input = document.getElementById('inv_abierta_' + i);
                if (input) {
                    const raw = input.value.trim();
                    // FIX-SCIENTIFIC: rechazar notación científica que parseFloat acepta (ej. 1e5 = 100000)
                    if (/e/i.test(raw)) { invalidAbierta = true; break; }
                    const v = parseFloat(raw);
                    if (isNaN(v) || v < 0 || v > 9999) { invalidAbierta = true; break; }
                    abiertas.push(v);
                }
            }
            if (invalidAbierta) {
                showNotification('⚠️ Los valores de botellas abiertas deben ser números positivos (máx. 9999)');
                return;
            }

            // ── CORRECCIÓN 8: Detección de cambios anómalos ─────────────────
            // Se avisa cuando el nuevo valor difiere > 50% del anterior
            // (protege de errores de tipeo: 10 → 100, 15 → 5, etc.)
            (function checkAnomaly() {
                const targetArea  = (isAuditoriaMode && auditoriaAreaActiva) ? auditoriaAreaActiva : selectedArea;
                const fuente      = isAuditoriaMode ? myAuditoriaConteo : inventarioConteo;
                const prevData    = fuente[inventarioModalProductId] && fuente[inventarioModalProductId][targetArea];
                const prevEnteras = prevData ? (prevData.enteras || 0) : 0;

                if (prevEnteras > 0 && enteras > 0) {
                    const cambio = Math.abs(enteras - prevEnteras) / prevEnteras;
                    if (enteras >= prevEnteras * 10) {
                        // Cambio muy grande (≥ 10×): bloquear y exigir confirmación
                        console.warn('[Anomalía] Cambio ≥10×:', prevEnteras, '→', enteras);
                        // Ya cubierto por el límite de 9999, pero registrar igualmente
                    } else if (cambio > 0.5 && Math.abs(enteras - prevEnteras) >= 3) {
                        // Cambio > 50% y diferencia absoluta ≥ 3 unidades → advertir
                        // (diferencia < 3 no se advierte para no interrumpir conteos normales)
                        _anomalyWarningPending = {
                            prevEnteras: prevEnteras,
                            newEnteras:  enteras,
                            cambio:      Math.round(cambio * 100)
                        };
                    }
                }
            })();

            // Si hay advertencia de anomalía, mostrar confirmación antes de guardar
            if (_anomalyWarningPending) {
                const aw = _anomalyWarningPending;
                _anomalyWarningPending = null;
                showConfirm(
                    '⚠️ CAMBIO INUSUAL DETECTADO\n\n' +
                    'Valor anterior: ' + aw.prevEnteras + '\n' +
                    'Valor nuevo:    ' + aw.newEnteras + '\n' +
                    'Diferencia:     ' + aw.cambio + '%\n\n' +
                    '¿Confirmar este cambio?',
                    function() {
                        // Usuario confirmó → guardar normalmente (llamar de nuevo sin anomalía)
                        saveInventarioModal();
                    }
                );
                return; // esperar confirmación del usuario
            }

            if (isAuditoriaMode && auditoriaAreaActiva) {
                // ── Guardar en objeto propio del usuario ──────────────────────────────
                if (!myAuditoriaConteo[inventarioModalProductId]) myAuditoriaConteo[inventarioModalProductId] = {};
                myAuditoriaConteo[inventarioModalProductId][auditoriaAreaActiva] = { enteras, abiertas, _ts: Date.now() }; // BUG-2 FIX: timestamp para last-write-wins

                // ── Guardar en estructura multiusuario (sin sobreescribir otros) ──
                // Cada usuario escribe SOLO su propia clave; los demás quedan intactos.
                const cuUser = auditCurrentUser || { userId: 'local-' + Date.now(), userName: 'Local' }; // FIX-07
                if (!auditoriaConteoPorUsuario[inventarioModalProductId])
                    auditoriaConteoPorUsuario[inventarioModalProductId] = {};
                if (!auditoriaConteoPorUsuario[inventarioModalProductId][auditoriaAreaActiva])
                    auditoriaConteoPorUsuario[inventarioModalProductId][auditoriaAreaActiva] = {};

                auditoriaConteoPorUsuario[inventarioModalProductId][auditoriaAreaActiva][cuUser.userId] = {
                    userId:   cuUser.userId,
                    userName: cuUser.userName,
                    enteras:  enteras,
                    abiertas: abiertas.slice(),  // copia defensiva del array
                    ts:       Date.now()         // timestamp exacto del guardado
                };

                saveToLocalStorage();
                showNotification('Conteo guardado en ' + areasAuditoria[auditoriaAreaActiva]);

                // FIX BUG 3: Sync parcial a Firestore → admin ve progreso en tiempo real.
                // Se usa un debounce ligero (800ms) para no saturar Firestore en conteos
                // rápidos de múltiples productos consecutivos.
                clearTimeout(saveInventarioModal._auditSyncTimer);
                saveInventarioModal._auditSyncTimer = setTimeout(function() {
                    if (_db && navigator.onLine) {
                        syncMyAuditoriaToFirestore().catch(function(e) {
                            console.warn('[AuditUser] Error en sync parcial al guardar producto:', e);
                        });
                    }
                }, 800);
            } else {
                // FIX-CHANGELOG: Registrar el cambio en el log de auditoría antes de sobreescribir.
                // Así siempre se puede saber quién cambió qué y cuándo.
                (function logChange() {
                    try {
                        const prevData    = inventarioConteo[inventarioModalProductId] &&
                                            inventarioConteo[inventarioModalProductId][selectedArea];
                        const prevEnteras = prevData ? (prevData.enteras || 0) : null;
                        // Solo registrar si el valor realmente cambió
                        if (prevEnteras === null && enteras === 0) return; // primer conteo en cero = no relevante
                        if (prevEnteras === enteras) return;
                        const product = products.find(function(p) { return p.id === inventarioModalProductId; });
                        const entry = {
                            ts:         Date.now(),
                            prodId:     inventarioModalProductId,
                            prodName:   product ? product.name : inventarioModalProductId,
                            area:       selectedArea,
                            valorAntes: prevEnteras,
                            valorDespues: enteras,
                            motivo:     motivoFinal,
                            usuario:    (auditCurrentUser ? auditCurrentUser.userName : null) ||
                                        (currentUserUid ? currentUserUid.slice(0,8) : 'local'),
                            uid:        currentUserUid || null,
                            deviceId:   _deviceId,
                            hora:       new Date().toLocaleTimeString('es-MX')
                        };
                        let log = [];
                        try {
                            const raw = localStorage.getItem('inventarioApp_changeLog');
                            if (raw) log = JSON.parse(raw);
                            if (!Array.isArray(log)) log = [];
                        } catch (_) { log = []; }
                        log.push(entry);
                        // Mantener solo las últimas 500 entradas para no crecer indefinidamente
                        if (log.length > 500) log = log.slice(-500);
                        localStorage.setItem('inventarioApp_changeLog', JSON.stringify(log));

                        // Registrar también en la cola de sincronización (incluye deviceId, motivo, uid)
                        _registrarEnSyncQueue({
                            tipo:         'inventario',
                            prodId:       inventarioModalProductId,
                            prodName:     product ? product.name : inventarioModalProductId,
                            area:         selectedArea,
                            valorAntes:   prevEnteras,
                            valorDespues: enteras,
                            motivo:       motivoFinal,
                            abiertas:     abiertas.slice()
                        });
                    } catch (_) { /* el log nunca interrumpe el flujo principal */ }
                })();

                // Guardar en el inventario operativo regular
                if (!inventarioConteo[inventarioModalProductId]) inventarioConteo[inventarioModalProductId] = {};
                inventarioConteo[inventarioModalProductId][selectedArea] = { enteras, abiertas };
                syncStockByAreaFromConteo();
                saveToLocalStorage();
                showNotification('Conteo guardado en ' + areas[selectedArea]);

                // MIGRACIÓN MÍNIMA — sincronización atómica y versionada de
                // ESTE producto únicamente (nunca un snapshot del área
                // completa). Debounce corto por si el usuario ajusta el
                // mismo producto varias veces seguidas antes de cambiar de
                // ítem; el valor ya está seguro en local desde la línea
                // anterior, este envío solo confirma contra el servidor.
                (function(pid, area, ent, abi) {
                    const clave = pid + '|' + area;
                    clearTimeout(_conteoProductoSyncTimers[clave]);
                    _conteoProductoSyncTimers[clave] = setTimeout(function() {
                        syncConteoProductoAtomico(pid, area, ent, abi);
                    }, 800);
                })(inventarioModalProductId, selectedArea, enteras, abiertas);
            }

            closeInventarioModal();
            renderTab();
        }


        // Toggle expansión de tarjeta de inventario (botellas abiertas adicionales)