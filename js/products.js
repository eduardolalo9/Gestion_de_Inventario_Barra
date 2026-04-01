/**
 * js/products.js
 * CRUD de productos, lógica de carrito, conversión oz→puntos,
 * auditoría física ciega y exportación/importación Excel/JSON.
 */
import { state }                from './state.js';
import { AREAS, AREAS_AUDITORIA, AREA_KEYS, ML_POR_OZ, INTEGER_UNITS } from './constants.js';
import { showNotification, showConfirm, escapeHtml, updateHeaderActions } from './ui.js';
import { saveToLocalStorage }   from './storage.js';

/* ── Conversión oz → fracción de botella ─────────────────────
 * liquidoOz    = capacidadMl / ML_POR_OZ
 * pesoVidrio   = pesoBotellaLlenaOz - liquidoOz
 * liquidoActual= pesoActualOz - pesoVidrio
 * puntos       = liquidoActual / liquidoOz   (0–1)
 */
export function convertirOzAPuntos(pesoActualOz, capacidadMl, pesoBotellaLlenaOz) {
    // FIX BUG-5: guard contra divisón por cero si capacidadMl fuera 0
    if (!capacidadMl || capacidadMl <= 0) return 0;
    const liquidoOz       = capacidadMl / ML_POR_OZ;
    const pesoVidrio      = pesoBotellaLlenaOz - liquidoOz;
    const liquidoActualOz = pesoActualOz - pesoVidrio;
    const puntos          = liquidoActualOz / liquidoOz;
    const clamped         = Math.min(1, Math.max(0, puntos));
    return Math.round(clamped * 10000) / 10000; // 4 decimales, evita IEEE-754 ruido
}

export function tieneConversion(product) {
    return product &&
        typeof product.capacidadMl === 'number'        && product.capacidadMl > 0 &&
        typeof product.pesoBotellaLlenaOz === 'number' && product.pesoBotellaLlenaOz > 0;
}

export function calcularTotalConAbiertas(productId, area) {
    const product  = state.products.find(p => p.id === productId);
    if (!product) return 0;
    const areaData = (state.inventarioConteo[productId] && state.inventarioConteo[productId][area]) || { enteras: 0, abiertas: [] };
    const enteras  = areaData.enteras || 0;
    const abiertas = areaData.abiertas || [];
    let sumaAbiertas = 0;
    if (tieneConversion(product)) {
        abiertas.forEach(pesoOz => { sumaAbiertas += convertirOzAPuntos(pesoOz, product.capacidadMl, product.pesoBotellaLlenaOz); });
    } else {
        abiertas.forEach(val => { sumaAbiertas += (val || 0); });
    }
    return enteras + sumaAbiertas;
}

export function syncStockByAreaFromConteo() {
    state.products.forEach(p => {
        if (!p.stockByArea) p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
        AREA_KEYS.forEach(area => {
            const d = state.inventarioConteo[p.id] && state.inventarioConteo[p.id][area];
            if (d && typeof d.enteras === 'number') {
                p.stockByArea[area] = calcularTotalConAbiertas(p.id, area);
            }
        });
    });
}

export function getTotalStock(product) {
    if (!product.stockByArea) return 0;
    return (product.stockByArea.almacen || 0) + (product.stockByArea.barra1 || 0) + (product.stockByArea.barra2 || 0);
}

export function getAvailableGroups() {
    const groups = new Set(state.products.map(p => p.group).filter(g => g && g.trim() !== ''));
    return ['Todos', ...Array.from(groups).sort()];
}

export function filterByGroup() {
    let filtered = state.products;
    if (state.selectedGroup !== 'Todos') filtered = filtered.filter(p => p.group === state.selectedGroup);
    if (state.searchTerm) {
        const term = state.searchTerm.toLowerCase();
        filtered = filtered.filter(p => (p.name||'').toLowerCase().includes(term) || (p.id||'').toLowerCase().includes(term));
    }
    return filtered;
}

export function generateProductId() {
    let maxNum = 0;
    state.products.forEach(p => { const m = p.id.match(/^PRD-(\d+)$/); if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10)); });
    return 'PRD-' + String(maxNum + 1).padStart(3, '0');
}

/* ── CRUD ───────────────────────────────────────────────────── */
export function openProductModal(productId) {
    const modal = document.getElementById('productModal');
    const title = document.getElementById('productModalTitle');
    document.getElementById('productId').value            = '';
    document.getElementById('productName').value          = '';
    document.getElementById('productUnit').value          = 'Botellas';
    document.getElementById('productGroup').value         = '';
    document.getElementById('productCapacidadMl').value   = '';
    document.getElementById('productPesoLlenaOz').value   = '';
    if (productId) {
        const product = state.products.find(p => p.id === productId);
        if (product) {
            state.editingProductId = product.id;
            title.textContent = 'Editar Producto';
            document.getElementById('productId').value    = product.id;
            document.getElementById('productName').value  = product.name || '';
            document.getElementById('productUnit').value  = product.unit || 'Botellas';
            document.getElementById('productGroup').value = product.group || '';
            if (product.capacidadMl)       document.getElementById('productCapacidadMl').value = product.capacidadMl;
            if (product.pesoBotellaLlenaOz) document.getElementById('productPesoLlenaOz').value = product.pesoBotellaLlenaOz;
        } else { showNotification('Producto no encontrado'); return; }
    } else {
        state.editingProductId = null;
        title.textContent = 'Agregar Producto';
        document.getElementById('productId').value = generateProductId();
    }
    modal.classList.remove('hidden');
    setTimeout(() => { const fi = modal.querySelector('input, select, button'); if (fi) fi.focus(); }, 50);
    _setupFocusTrap(modal);
}

export function closeProductModal() {
    const modal = document.getElementById('productModal');
    _removeFocusTrap(modal);
    modal.classList.add('hidden');
    state.editingProductId = null;
}

export function saveProduct() {
    const name = document.getElementById('productName').value.trim();
    if (!name) { showNotification('La descripción es requerida'); return; }
    let productId = document.getElementById('productId').value.trim();
    if (!productId) productId = generateProductId();
    if (state.products.some(p => p.id === productId && p.id !== state.editingProductId)) { showNotification('El ID ya existe'); return; }
    const group = document.getElementById('productGroup').value.trim() || 'General';
    if (state.products.some(p => (p.name||'').toLowerCase()===name.toLowerCase() && (p.group||'').toLowerCase()===group.toLowerCase() && p.id!==state.editingProductId)) {
        showNotification('Ya existe un producto con ese nombre en el mismo grupo'); return;
    }
    const unit            = document.getElementById('productUnit').value;
    const capacidadMlRaw  = parseFloat(document.getElementById('productCapacidadMl').value);
    const pesoLlenaOzRaw  = parseFloat(document.getElementById('productPesoLlenaOz').value);
    const capacidadMl     = isNaN(capacidadMlRaw) || capacidadMlRaw <= 0 ? undefined : capacidadMlRaw;
    const pesoBotellaLlenaOz = isNaN(pesoLlenaOzRaw) || pesoLlenaOzRaw <= 0 ? undefined : pesoLlenaOzRaw;
    if (capacidadMl !== undefined && pesoBotellaLlenaOz !== undefined) {
        const pesoVidrio = pesoBotellaLlenaOz - (capacidadMl / ML_POR_OZ);
        if (pesoVidrio < 0) { showNotification(`⚠️ Error: peso de botella llena (${pesoBotellaLlenaOz}oz) menor que el líquido. ¿Invertiste los campos?`); return; }
    }
    if (state.editingProductId) {
        const product = state.products.find(p => p.id === state.editingProductId);
        if (product) {
            if (state.editingProductId !== productId && state.inventarioConteo[state.editingProductId]) {
                state.inventarioConteo[productId] = state.inventarioConteo[state.editingProductId];
                delete state.inventarioConteo[state.editingProductId];
            }
            Object.assign(product, { id: productId, name, unit, group });
            if (capacidadMl !== undefined) product.capacidadMl = capacidadMl; else delete product.capacidadMl;
            if (pesoBotellaLlenaOz !== undefined) product.pesoBotellaLlenaOz = pesoBotellaLlenaOz; else delete product.pesoBotellaLlenaOz;
            syncStockByAreaFromConteo();
        }
        showNotification('Producto actualizado');
    } else {
        const newProduct = { id: productId, name, unit, group, stockByArea: { almacen: 0, barra1: 0, barra2: 0 } };
        if (capacidadMl !== undefined)       newProduct.capacidadMl = capacidadMl;
        if (pesoBotellaLlenaOz !== undefined) newProduct.pesoBotellaLlenaOz = pesoBotellaLlenaOz;
        state.products.push(newProduct);
        showNotification('Producto agregado');
    }
    saveToLocalStorage();
    closeProductModal();
    import('./render.js').then(m => m.renderTab());
}

export function editProduct(id) { openProductModal(id); }

export function deleteProduct(id) {
    showConfirm('¿Está seguro de eliminar este producto?', () => {
        state.products = state.products.filter(p => p.id !== id);
        state.cart = state.cart.filter(item => item.id !== id);
        delete state.inventarioConteo[id];
        delete state.auditoriaConteo[id];
        delete state.auditoriaConteoPorUsuario[id]; // FIX BUG-8: evitar datos huérfanos multiusuario
        saveToLocalStorage();
        showNotification('Producto eliminado');
        import('./render.js').then(m => m.renderTab());
    });
}

export function deleteAllProducts() {
    if (state.products.length === 0) { showNotification('No hay productos para eliminar'); return; }
    showConfirm('¿Eliminar TODOS los productos? Esta acción no se puede deshacer.', () => {
        state.products = []; state.cart = []; state.inventarioConteo = {};
        state.auditoriaConteo = {}; // FIX BUG-9: limpiar datos de auditoría
        state.auditoriaConteoPorUsuario = {};
        saveToLocalStorage();
        showNotification('Todos los productos han sido eliminados');
        import('./render.js').then(m => m.renderTab());
    });
}

/* ── Carrito / Pedidos ──────────────────────────────────────── */
export function addToCart(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product || !product.id) return;
    const existingItem = state.cart.find(item => item.id === productId);
    if (existingItem) existingItem.quantity++;
    else state.cart.push({ id: product.id, name: product.name, unit: product.unit || '', group: product.group || 'General', quantity: 1 });
    saveToLocalStorage();
    showNotification(product.name + ' agregado al carrito');
    updateHeaderActions();
}

export function openOrderModal() {
    if (state.cart.length === 0) { showNotification('Agrega productos al carrito primero'); return; }
    document.getElementById('orderSupplier').value    = '';
    document.getElementById('orderDeliveryDate').value = '';
    document.getElementById('orderNote').value        = '';
    const modal = document.getElementById('orderModal');
    modal.classList.remove('hidden');
    renderOrderTable();
    setTimeout(() => { const fi = modal.querySelector('input, select, textarea, button'); if (fi) fi.focus(); }, 50);
    _setupFocusTrap(modal);
}

export function closeOrderModal() {
    const modal = document.getElementById('orderModal');
    _removeFocusTrap(modal);
    modal.classList.add('hidden');
}

export function renderOrderTable() {
    const tbody      = document.getElementById('orderProductsTable');
    const emptyCart  = document.getElementById('emptyCart');
    const orderTotal = document.getElementById('orderTotal');
    if (state.cart.length === 0) { tbody.innerHTML = ''; emptyCart.classList.remove('hidden'); orderTotal.textContent = 'Total: 0'; return; }
    emptyCart.classList.add('hidden');
    let html = ''; let total = 0;
    state.cart.forEach(item => {
        total += item.quantity;
        html += `<tr><td class="px-4 py-3 text-gray-900">${escapeHtml(item.name)}</td><td class="px-4 py-3 text-center text-gray-600">${escapeHtml(item.unit)}</td><td class="px-4 py-3 text-center"><input type="number" value="${item.quantity}" min="0.01" step="0.01" onchange="window.updateCartQuantity('${escapeHtml(item.id)}',this.value)" class="w-20 px-2 py-1 text-center bg-white text-gray-900 border border-gray-200 rounded focus:ring-2 focus:ring-purple-500 font-semibold"></td><td class="px-4 py-3 text-center"><button onclick="window.removeFromCart('${escapeHtml(item.id)}')" class="p-2 bg-gradient-to-br from-red-500 to-orange-500 text-white rounded-xl transition-all active:scale-95"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button></td></tr>`;
    });
    tbody.innerHTML = html;
    orderTotal.textContent = 'Total: ' + total.toFixed(2);
}

export function updateCartQuantity(productId, quantity) {
    const item = state.cart.find(i => i.id === productId);
    if (!item) return;
    let val = parseFloat(quantity);
    if (isNaN(val) || val <= 0) val = 0.01;
    const product = state.products.find(p => p.id === productId);
    if (product && INTEGER_UNITS.includes(product.unit)) { val = Math.round(val); if (val < 1) val = 1; }
    else if (val < 0.01) val = 0.01;
    item.quantity = val;
    saveToLocalStorage();
    renderOrderTable();
}

export function removeFromCart(productId) {
    state.cart = state.cart.filter(item => item.id !== productId);
    saveToLocalStorage();
    renderOrderTable();
    updateHeaderActions();
    if (state.cart.length === 0) showNotification('Carrito vacío');
}

export function createOrder() {
    const supplier = document.getElementById('orderSupplier').value.trim();
    if (!supplier) { showNotification('El proveedor es requerido'); return; }
    if (state.cart.length === 0) { showNotification('Agrega productos al carrito'); return; }
    const deliveryDate = document.getElementById('orderDeliveryDate').value;
    const note         = document.getElementById('orderNote').value.trim();
    let maxOrderNum = 0;
    state.orders.forEach(o => { const m = o.id.match(/^ORD-(\d+)$/); if (m) maxOrderNum = Math.max(maxOrderNum, parseInt(m[1], 10)); });
    const orderId = 'ORD-' + String(maxOrderNum + 1).padStart(4, '0');
    const newOrder = {
        id: orderId, supplier, date: new Date().toLocaleDateString('es-MX'),
        deliveryDate: deliveryDate || '', note,
        products: state.cart.map(item => ({ id: item.id, name: item.name, unit: item.unit, group: item.group, quantity: item.quantity })),
        total: state.cart.reduce((sum, item) => sum + item.quantity, 0),
    };
    state.orders.unshift(newOrder);
    state.cart = [];
    saveToLocalStorage();
    closeOrderModal();
    showNotification('Pedido creado: ' + orderId);
    import('./render.js').then(m => m.renderTab());
    shareOrderWhatsApp(orderId);
}

export function deleteOrder(orderId) {
    showConfirm('¿Eliminar este pedido del historial?', () => {
        state.orders = state.orders.filter(o => o.id !== orderId);
        saveToLocalStorage();
        showNotification('Pedido eliminado');
        import('./render.js').then(m => m.renderTab());
    });
}

export function shareOrderWhatsApp(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    let message = `🛒 *PEDIDO ${order.id}*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🏪 *Proveedor:* ${order.supplier}\n`;
    if (order.deliveryDate) message += `📅 *Entrega:* ${order.deliveryDate}\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n*PRODUCTOS:*\n`;
    order.products.forEach((p, i) => { message += `${i+1}. ${p.name}\n   • Cantidad: ${p.quantity} ${p.unit}\n`; });
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📦 *Total:* ${(order.total||0).toFixed(2)}\n`;
    if (order.note) message += `📝 *Nota:* ${order.note}\n`;
    window.open('https://wa.me/?text=' + encodeURIComponent(message), '_blank');
}

/* ── Modal de inventario ─────────────────────────────────────── */
export function openInventarioModal(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    state.inventarioModalProductId = productId;
    let areaKey, areaLabel, conteoSource;
    if (state.isAuditoriaMode && state.auditoriaAreaActiva) {
        areaKey = state.auditoriaAreaActiva;
        areaLabel = AREAS_AUDITORIA[areaKey] || areaKey;
        if (!state.auditoriaConteo[productId]) state.auditoriaConteo[productId] = {};
        conteoSource = state.auditoriaConteo[productId][areaKey] || { enteras: 0, abiertas: [] };
    } else {
        areaKey = state.selectedArea;
        areaLabel = AREAS[areaKey] || areaKey;
        if (!state.inventarioConteo[productId]) state.inventarioConteo[productId] = {};
        conteoSource = state.inventarioConteo[productId][areaKey] || { enteras: 0, abiertas: [] };
    }
    document.getElementById('inventarioModalTitle').textContent    = product.name;
    document.getElementById('inventarioModalSubtitle').textContent = `${product.group||'General'} · ${product.unit||''} — ${areaLabel}`;
    const hintEl = document.getElementById('inv_abiertasUnidadHint');
    if (hintEl) hintEl.textContent = tieneConversion(product) ? '— ingresa el peso en oz' : '';
    document.getElementById('inv_enteras').value = conteoSource.enteras || 0;
    const container = document.getElementById('inv_abiertasContainer');
    container.innerHTML = '';
    const abiertas = (conteoSource.abiertas && conteoSource.abiertas.length > 0) ? conteoSource.abiertas : [0];
    abiertas.forEach((val, idx) => renderAbiertaInput(val, idx, tieneConversion(product)));
    state.isInventarioModalOpen = true;
    disableAreaButtons(true);
    const modal = document.getElementById('inventarioModal');
    modal.classList.remove('hidden');
    setTimeout(() => { const fi = modal.querySelector('input, button'); if (fi) fi.focus(); }, 50);
    _setupFocusTrap(modal);
}

export function closeInventarioModal() {
    const modal = document.getElementById('inventarioModal');
    _removeFocusTrap(modal);
    modal.classList.add('hidden');
    state.inventarioModalProductId = null;
    state.isInventarioModalOpen    = false;
    disableAreaButtons(false);
}

export function renderAbiertaInput(val, idx, usaOz) {
    const container    = document.getElementById('inv_abiertasContainer');
    const div          = document.createElement('div');
    div.className      = 'flex items-center gap-2';
    div.id             = 'abierta_row_' + idx;
    const placeholder  = usaOz ? 'ej: 33.45 oz' : '0.0';
    const unidadLabel  = usaOz ? ' (oz)' : '';
    div.innerHTML =
        `<span class="text-xs font-medium text-gray-500 w-20 flex-shrink-0">Abierta ${idx+1}${unidadLabel}</span>` +
        `<input type="number" id="inv_abierta_${idx}" min="0" step="0.01" value="${val}" ` +
        `oninput="if(parseFloat(this.value)<0||isNaN(parseFloat(this.value)))this.value=0;" ` +
        `class="flex-1 px-3 py-2 bg-white text-gray-900 border-2 border-orange-200 rounded-xl focus:ring-2 focus:ring-orange-400 text-center font-bold" ` +
        `placeholder="${placeholder}">` +
        (idx > 0
            ? `<button onclick="window.removeAbiertaInModal(${idx})" class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>`
            : '<div class="w-8"></div>');
    container.appendChild(div);
}

export function addAbiertaInModal() {
    const container = document.getElementById('inv_abiertasContainer');
    if (container.children.length >= 10) { showNotification('Máximo 10 botellas abiertas'); return; }
    const idx     = container.children.length;
    const product = state.products.find(p => p.id === state.inventarioModalProductId);
    renderAbiertaInput(0, idx, tieneConversion(product));
}

export function removeAbiertaInModal(idx) {
    const container = document.getElementById('inv_abiertasContainer');
    const vals = [];
    for (let i = 0; i < container.children.length; i++) {
        const input = document.getElementById('inv_abierta_' + i);
        if (input && i !== idx) vals.push(parseFloat(input.value) || 0);
    }
    container.innerHTML = '';
    const product = state.products.find(p => p.id === state.inventarioModalProductId);
    vals.forEach((v, i) => renderAbiertaInput(v, i, tieneConversion(product)));
}

export function saveInventarioModal() {
    if (!state.inventarioModalProductId) return;
    const enterasRaw = parseFloat(document.getElementById('inv_enteras').value);
    if (isNaN(enterasRaw) || enterasRaw < 0) { showNotification('⚠️ Botellas enteras: número ≥ 0'); document.getElementById('inv_enteras').focus(); return; }
    if (!Number.isInteger(enterasRaw)) { showNotification('⚠️ Botellas enteras deben ser entero. Usa "Abiertas" para fracciones.'); document.getElementById('inv_enteras').focus(); return; }
    const enteras   = Math.max(0, enterasRaw);
    const container = document.getElementById('inv_abiertasContainer');
    const abiertas  = [];
    let invalidAbierta = false;
    for (let i = 0; i < container.children.length; i++) {
        const input = document.getElementById('inv_abierta_' + i);
        if (input) { const v = parseFloat(input.value); if (isNaN(v) || v < 0) { invalidAbierta = true; break; } abiertas.push(v); }
    }
    if (invalidAbierta) { showNotification('⚠️ Valores de botellas abiertas deben ser números positivos'); return; }
    if (state.isAuditoriaMode && state.auditoriaAreaActiva) {
        if (!state.auditoriaConteo[state.inventarioModalProductId]) state.auditoriaConteo[state.inventarioModalProductId] = {};
        state.auditoriaConteo[state.inventarioModalProductId][state.auditoriaAreaActiva] = { enteras, abiertas };
        // FIX BUG-10: userId estable — si auditCurrentUser es null, usar ID fijo de sesión
        if (!state.auditCurrentUser) {
            const sessionId = sessionStorage.getItem('_anonUserId') || ('anon-' + Math.random().toString(36).substr(2, 9));
            sessionStorage.setItem('_anonUserId', sessionId);
            state.auditCurrentUser = { userId: sessionId, userName: 'Local' };
        }
        const cuUser = state.auditCurrentUser;
        if (!state.auditoriaConteoPorUsuario[state.inventarioModalProductId]) state.auditoriaConteoPorUsuario[state.inventarioModalProductId] = {};
        if (!state.auditoriaConteoPorUsuario[state.inventarioModalProductId][state.auditoriaAreaActiva]) state.auditoriaConteoPorUsuario[state.inventarioModalProductId][state.auditoriaAreaActiva] = {};
        state.auditoriaConteoPorUsuario[state.inventarioModalProductId][state.auditoriaAreaActiva][cuUser.userId] = { userId: cuUser.userId, userName: cuUser.userName, enteras, abiertas: abiertas.slice(), ts: Date.now() };
        saveToLocalStorage();
        showNotification('Conteo guardado en ' + (AREAS_AUDITORIA[state.auditoriaAreaActiva] || state.auditoriaAreaActiva));
    } else {
        if (!state.inventarioConteo[state.inventarioModalProductId]) state.inventarioConteo[state.inventarioModalProductId] = {};
        state.inventarioConteo[state.inventarioModalProductId][state.selectedArea] = { enteras, abiertas };
        syncStockByAreaFromConteo();
        saveToLocalStorage();
        showNotification('Conteo guardado en ' + (AREAS[state.selectedArea] || state.selectedArea));
    }
    closeInventarioModal();
    import('./render.js').then(m => m.renderTab());
}

export function disableAreaButtons(disable) {
    document.querySelectorAll('.area-btn').forEach(btn => {
        if (disable) btn.classList.add('disabled'); else btn.classList.remove('disabled');
    });
}

export function switchArea(area) {
    if (state.isInventarioModalOpen) { showNotification('Cierra el modal de inventario antes de cambiar de área'); return; }
    state.selectedArea = area;
    saveToLocalStorage();
    import('./render.js').then(m => m.renderTab());
}

export function toggleCardExpand(productId, event) {
    event.stopPropagation();
    if (state.expandedCards.has(productId)) state.expandedCards.delete(productId);
    else state.expandedCards.add(productId);
    const btn   = document.getElementById('card-expand-btn-' + productId);
    const extra = document.getElementById('card-extra-' + productId);
    if (!btn || !extra) return;
    const isOpen = state.expandedCards.has(productId);
    extra.classList.toggle('open', isOpen);
    btn.classList.toggle('open', isOpen);
    btn.setAttribute('aria-expanded', isOpen);
    btn.querySelector('span').textContent = isOpen ? 'Ocultar' : 'Ver más abiertas';
}

export function resetAllInventario() {
    showConfirm('⚠️ ¿Borrar TODAS las cantidades de Almacén, Barra 1 y Barra 2?\n\nEsta acción no se puede deshacer.', () => {
        state.products.forEach(p => { if (!p.stockByArea) p.stockByArea={almacen:0,barra1:0,barra2:0}; p.stockByArea.almacen=0; p.stockByArea.barra1=0; p.stockByArea.barra2=0; });
        state.inventarioConteo = {};
        saveToLocalStorage();
        showNotification('Todas las cantidades han sido borradas');
        import('./render.js').then(m => m.renderTab());
    });
}

/* ── Inventario histórico ───────────────────────────────────── */
export function saveInventory(area) {
    const productsWithStock = state.products.filter(p => {
        const d = state.inventarioConteo[p.id] && state.inventarioConteo[p.id][area];
        return d && typeof d.enteras === 'number';
    });
    if (productsWithStock.length === 0) { showNotification('No hay datos de conteo para guardar'); return; }
    const newInventory = {
        id: 'INV-' + Date.now(),
        date: new Date().toLocaleDateString('es-MX'),
        area,
        products: productsWithStock.map(p => {
            const d = state.inventarioConteo[p.id][area] || { enteras: 0, abiertas: [] };
            return { id: p.id, name: p.name, unit: p.unit || '', group: p.group || 'General', stock: d.enteras || 0, abiertas: d.abiertas || [], total: calcularTotalConAbiertas(p.id, area) };
        }),
        totalProducts: productsWithStock.reduce((s, p) => s + calcularTotalConAbiertas(p.id, area), 0),
    };
    state.inventories.unshift(newInventory);
    saveToLocalStorage();
    showNotification('✅ Inventario guardado');
    import('./render.js').then(m => m.renderTab());
}

export function deleteInventory(id) {
    showConfirm('¿Eliminar este registro de inventario?', () => {
        state.inventories = state.inventories.filter(inv => inv.id !== id);
        saveToLocalStorage();
        showNotification('Inventario eliminado');
        import('./render.js').then(m => m.renderTab());
    });
}

export function shareInventoryWhatsApp(invId) {
    const inv = state.inventories.find(i => i.id === invId);
    if (!inv) return;
    let message = `📦 *INVENTARIO ${inv.id}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📅 *Fecha:* ${inv.date}\n📍 *Área:* ${AREAS[inv.area]||inv.area||'N/A'}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n*PRODUCTOS:*\n`;
    inv.products.forEach((p, i) => {
        message += `${i+1}. ${p.name}\n   • Enteras: ${p.stock} ${p.unit}\n`;
        if (p.abiertas && p.abiertas.length) message += `   • Abiertas: ${p.abiertas.map(a=>(a||0).toFixed(2)).join(' + ')}\n`;
    });
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📦 *Total:* ${(inv.totalProducts||0).toFixed(2)}\n`;
    window.open('https://wa.me/?text=' + encodeURIComponent(message), '_blank');
}

/* ── Importación/Exportación ─────────────────────────────────── */
function parseExcelNumber(val) {
    if (typeof val === 'number') return val;
    const str = String(val || '').trim();
    if (!str || str === '-' || str === '+') return 0;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(str)) return parseFloat(str.replace(/\./g,'').replace(',','.')) || 0;
    if (/^\d+(,\d+)$/.test(str)) return parseFloat(str.replace(',','.')) || 0;
    if (/^\d{1,3}(\.\d{3})+$/.test(str)) return parseFloat(str.replace(/\./g,'')) || 0;
    return parseFloat(str) || 0;
}

export function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const fileInput = event.target;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = window.XLSX.read(data, { type: 'array' });
            if (!workbook.SheetNames || workbook.SheetNames.length === 0) { showNotification('El archivo no contiene hojas válidas'); return; }
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            if (!firstSheet) { showNotification('La primera hoja del archivo está vacía'); return; }
            const jsonData = window.XLSX.utils.sheet_to_json(firstSheet);
            if (!jsonData || jsonData.length === 0) { showNotification('El archivo no contiene datos válidos'); return; }
            const columnMap = {
                id: ['ID','Id','id','Código','codigo'], name: ['Nombre','Descripción','descripcion','Producto','producto','nombre'],
                unit: ['Unidad','unidad','Medida','medida'], group: ['Grupo','grupo','Categoría','categoria'],
                stock: ['Cantidad','cantidad','Stock','stock','Enteras'],
                capacidadMl: ['CapacidadML','capacidadMl','CapacidadMl','Capacidad_ML','CapML'],
                pesoBotellaLlenaOz: ['PesoBotellaOz','pesoBotellaOz','PesoLlenaOz','PesoBotella_Oz','PesoOz'],
            };
            const findCol = (row, keys) => { for (const key of keys) { if (row[key]!==undefined && row[key]!==null && row[key]!=='') return row[key]; } return undefined; };
            const existingIds = new Set(state.products.map(p => p.id));
            let maxNum = 0;
            state.products.forEach(p => { const m = p.id.match(/^PRD-(\d+)$/); if (m) maxNum = Math.max(maxNum, parseInt(m[1],10)); });
            let nextNum = maxNum + 1;
            const toImport = []; const usedInBatch = new Set(); let skipped = 0;
            jsonData.forEach(row => {
                const nameRaw = findCol(row, columnMap.name);
                const name = nameRaw !== undefined ? String(nameRaw).trim() : '';
                if (!name) { skipped++; return; }
                const rawId = findCol(row, columnMap.id);
                let id = rawId !== undefined ? String(rawId).trim() : '';
                if (!id || existingIds.has(id) || usedInBatch.has(id)) { do { id = 'PRD-' + String(nextNum++).padStart(3,'0'); } while (existingIds.has(id) || usedInBatch.has(id)); }
                usedInBatch.add(id);
                const unitRaw  = findCol(row, columnMap.unit);  const unit  = unitRaw  !== undefined ? String(unitRaw).trim()  : 'Unidad';
                const groupRaw = findCol(row, columnMap.group); const group = groupRaw !== undefined ? String(groupRaw).trim() : 'General';
                const stockRaw = findCol(row, columnMap.stock); const stock = stockRaw !== undefined ? parseExcelNumber(stockRaw) : 0;
                const capRaw   = findCol(row, columnMap.capacidadMl);
                const capacidadMl = (capRaw !== undefined) ? (isNaN(parseFloat(capRaw)) ? null : parseFloat(capRaw)) : null;
                const pesoRaw  = findCol(row, columnMap.pesoBotellaLlenaOz);
                const pesoBotellaLlenaOz = (pesoRaw !== undefined) ? (isNaN(parseFloat(pesoRaw)) ? null : parseFloat(pesoRaw)) : null;
                const product  = { id, name, stockByArea: { almacen: stock, barra1: 0, barra2: 0 }, unit, group };
                if (capacidadMl !== null)       product.capacidadMl       = capacidadMl;
                if (pesoBotellaLlenaOz !== null) product.pesoBotellaLlenaOz = pesoBotellaLlenaOz;
                toImport.push(product);
            });
            state.products = state.products.concat(toImport);
            showNotification(`${toImport.length} productos importados.${skipped ? ' '+skipped+' filas omitidas.' : ''}`);
            state.activeTab = 'inicio'; state.selectedGroup = 'Todos'; state.searchTerm = ''; state.selectedArea = 'almacen';
            saveToLocalStorage();
            import('./render.js').then(m => m.renderTab());
            fileInput.value = '';
        } catch (error) { showNotification('Error al importar archivo: ' + error.message); console.error('[Import]', error); fileInput.value = ''; }
    };
    reader.readAsArrayBuffer(file);
}

export function exportToExcel(modo) {
    if (!Array.isArray(state.products) || state.products.length === 0) { showNotification('⚠️ No hay productos para exportar'); return; }
    const areaNames = modo==='AUDITORIA' ? { almacen:'Almacén', barra1:'Barra Restaurante', barra2:'Barra Bar' } : { almacen:'Almacén', barra1:'Barra1', barra2:'Barra2' };
    const maxAbiertas = { almacen: 1, barra1: 1, barra2: 1 };
    state.products.forEach(p => { AREA_KEYS.forEach(area => { const d = state.inventarioConteo[p.id]&&state.inventarioConteo[p.id][area]; if (d&&d.abiertas&&d.abiertas.length>maxAbiertas[area]) maxAbiertas[area]=d.abiertas.length; }); });
    const headerRow = []; const colMeta = [];
    ['ID','Nombre','Unidad','Grupo'].forEach(h => { headerRow.push(h); colMeta.push({tipo:'fixed'}); });
    headerRow.push('CapacidadML'); colMeta.push({tipo:'tecnico'});
    headerRow.push('PesoBotellaOz'); colMeta.push({tipo:'tecnico'});
    const FIXED_COLS = headerRow.length;
    AREA_KEYS.forEach(area => {
        const label = areaNames[area];
        headerRow.push(label+' Enteras'); colMeta.push({area,tipo:'entera'});
        for (let i=1;i<=maxAbiertas[area];i++) { headerRow.push(label+' Abierta '+i+' (oz)'); colMeta.push({area,tipo:'abierta'}); }
        headerRow.push(label+' Total'); colMeta.push({area,tipo:'total_area'});
    });
    const TOTAL_GENERAL_COL = headerRow.length;
    headerRow.push('Total General'); colMeta.push({tipo:'total_general'});
    const ESTADO_COL = headerRow.length;
    headerRow.push('Estado'); colMeta.push({tipo:'estado'});
    function buildRow(p) {
        const usaConv = tieneConversion(p);
        const cells = [p.id, p.name, p.unit||'', p.group||'General', (p.capacidadMl!=null?p.capacidadMl:''), (p.pesoBotellaLlenaOz!=null?p.pesoBotellaLlenaOz:'')];
        let totalGeneral = 0;
        AREA_KEYS.forEach(area => {
            const d = (state.inventarioConteo[p.id]&&state.inventarioConteo[p.id][area])||{enteras:0,abiertas:[]};
            const enteras=d.enteras||0; const abiertas=d.abiertas||[];
            cells.push(enteras);
            let sumaAb=0;
            for (let i=0;i<maxAbiertas[area];i++) {
                const ozVal=(abiertas[i]!==undefined&&abiertas[i]!==null)?abiertas[i]:'';
                cells.push(ozVal);
                if (typeof ozVal==='number'&&ozVal>0) sumaAb+=usaConv?convertirOzAPuntos(ozVal,p.capacidadMl,p.pesoBotellaLlenaOz):ozVal;
            }
            const totalArea=parseFloat((enteras+sumaAb).toFixed(2));
            cells.push(totalArea); totalGeneral+=totalArea;
        });
        totalGeneral=parseFloat(totalGeneral.toFixed(2)); cells.push(totalGeneral);
        cells.push(usaConv?'Conversión realizada':'Falta capacidadMl o pesoBotellaLlenaOz');
        return { cells, totalGeneral };
    }
    const sorted = [...state.products].sort((a,b)=>(a.group||'').localeCompare(b.group||''));
    const groups = [...new Set(sorted.map(p=>p.group||'General'))];
    const wsRows = [];
    const NUM_COLS = TOTAL_GENERAL_COL - FIXED_COLS;
    const grandNums = Array(NUM_COLS).fill(0); let grandTotal = 0;
    groups.forEach(group => {
        const gProds = sorted.filter(p=>(p.group||'General')===group);
        const groupNums = Array(NUM_COLS).fill(0); let groupTotal = 0; let even = 0;
        gProds.forEach(p => {
            const {cells,totalGeneral} = buildRow(p);
            wsRows.push({type:'data',even:even%2===0,data:cells});
            for (let ci=FIXED_COLS;ci<TOTAL_GENERAL_COL;ci++) { const v=cells[ci]; if (typeof v==='number') { groupNums[ci-FIXED_COLS]=parseFloat((groupNums[ci-FIXED_COLS]+v).toFixed(4)); grandNums[ci-FIXED_COLS]=parseFloat((grandNums[ci-FIXED_COLS]+v).toFixed(4)); } }
            groupTotal=parseFloat((groupTotal+totalGeneral).toFixed(4)); grandTotal=parseFloat((grandTotal+totalGeneral).toFixed(4)); even++;
        });
        const subtotalRow = Array(headerRow.length).fill('');
        subtotalRow[0]='SUBTOTAL'; subtotalRow[1]=group;
        for (let ci=0;ci<NUM_COLS;ci++) subtotalRow[FIXED_COLS+ci]=parseFloat(groupNums[ci].toFixed(2));
        subtotalRow[TOTAL_GENERAL_COL]=parseFloat(groupTotal.toFixed(2));
        wsRows.push({type:'subtotal',data:subtotalRow});
    });
    const grandRow = Array(headerRow.length).fill('');
    grandRow[0]='GRAN TOTAL';
    for (let ci=0;ci<NUM_COLS;ci++) grandRow[FIXED_COLS+ci]=parseFloat(grandNums[ci].toFixed(2));
    grandRow[TOTAL_GENERAL_COL]=parseFloat(grandTotal.toFixed(2));
    wsRows.push({type:'grand',data:grandRow});
    // Construir worksheet
    const sheetData = [headerRow];
    wsRows.forEach(r => sheetData.push(r.data));
    const ws = window.XLSX.utils.aoa_to_sheet(sheetData);
    const wb = window.XLSX.utils.book_new();
    const sheetName = modo==='AUDITORIA' ? 'Auditoría Física' : 'Inventario';
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const prefix = modo==='AUDITORIA' ? 'AUDITORIA_' : 'INVENTARIO_';
    window.XLSX.writeFile(wb, prefix + new Date().toISOString().split('T')[0] + '.xlsx');
    showNotification(modo==='AUDITORIA' ? '✅ Auditoría exportada a Excel' : '✅ Excel exportado');
}

export function exportarAuditoriaExcel() {
    if (!Object.values(state.auditoriaStatus).every(s => s === 'completada')) { showNotification('⚠️ Completa las 3 áreas antes de exportar'); return; }
    const backupConteo = state.inventarioConteo;
    state.inventarioConteo = state.auditoriaConteo;
    try { exportToExcel('AUDITORIA'); } finally { state.inventarioConteo = backupConteo; }
}

export function exportFullData() {
    const data = { products:state.products, orders:state.orders, inventories:state.inventories, cart:state.cart, inventarioConteo:state.inventarioConteo, auditoriaConteo:state.auditoriaConteo, auditoriaConteoPorUsuario:state.auditoriaConteoPorUsuario, auditoriaStatus:state.auditoriaStatus, auditoriaView:state.auditoriaView, auditoriaAreaActiva:state.auditoriaAreaActiva, activeTab:state.activeTab, searchTerm:state.searchTerm, selectedGroup:state.selectedGroup, selectedArea:state.selectedArea, expandedInventories:Array.from(state.expandedInventories) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'inventario_backup_' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showNotification('Datos exportados correctamente');
}

export function importFullData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data.products)||!Array.isArray(data.orders)||!Array.isArray(data.inventories)||!Array.isArray(data.cart)) { showNotification('El archivo no tiene el formato correcto'); return; }
            showConfirm('¿Reemplazar todos los datos actuales con los del archivo?', () => {
                state.products=data.products; state.orders=data.orders; state.inventories=data.inventories; state.cart=data.cart;
                const rawConteo = data.inventarioConteo||{};
                const migrated = {};
                Object.keys(rawConteo).forEach(prodId => { const val=rawConteo[prodId]; if (!val||typeof val!=='object') return; if (typeof val.enteras!=='undefined'&&val.almacen===undefined&&val.barra1===undefined&&val.barra2===undefined) migrated[prodId]={almacen:val}; else migrated[prodId]=val; });
                state.inventarioConteo = migrated;
                syncStockByAreaFromConteo();
                if (data.auditoriaConteo) state.auditoriaConteo = data.auditoriaConteo;
                if (data.auditoriaConteoPorUsuario) state.auditoriaConteoPorUsuario = data.auditoriaConteoPorUsuario;
                if (data.auditoriaStatus) state.auditoriaStatus = data.auditoriaStatus;
                state.auditoriaView = data.auditoriaView || 'selection';
                state.auditoriaAreaActiva = data.auditoriaAreaActiva || null;
                state.isAuditoriaMode = (state.auditoriaView==='counting' && !!state.auditoriaAreaActiva);
                state.activeTab=data.activeTab||'inicio'; state.searchTerm=data.searchTerm||''; state.selectedGroup=data.selectedGroup||'Todos'; state.selectedArea=data.selectedArea||'almacen';
                state.expandedInventories = new Set(data.expandedInventories||[]);
                saveToLocalStorage();
                import('./render.js').then(m => m.switchTab(state.activeTab));
                showNotification('Datos importados correctamente');
            });
        } catch (error) { showNotification('Error al leer el archivo: '+error.message); console.error('[Import JSON]', error); }
        event.target.value = '';
    };
    reader.readAsText(file);
}

/* ── Focus trap helper ───────────────────────────────────────── */
function _setupFocusTrap(modal) {
    modal._trapHandler = function(e) {
        if (e.key !== 'Tab') return;
        const focusable = Array.from(modal.querySelectorAll('input, select, textarea, button'));
        const first = focusable[0]; const last = focusable[focusable.length-1];
        if (e.shiftKey) { if (document.activeElement===first) { e.preventDefault(); last.focus(); } }
        else { if (document.activeElement===last) { e.preventDefault(); first.focus(); } }
    };
    modal.addEventListener('keydown', modal._trapHandler);
}
function _removeFocusTrap(modal) {
    if (modal._trapHandler) { modal.removeEventListener('keydown', modal._trapHandler); modal._trapHandler = null; }
}

/* ── Bindings globales (onclick en HTML) ─────────────────────── */
window.openProductModal      = openProductModal;
window.closeProductModal     = closeProductModal;
window.saveProduct           = saveProduct;
window.editProduct           = editProduct;
window.deleteProduct         = deleteProduct;
window.deleteAllProducts     = deleteAllProducts;
window.addToCart             = addToCart;
window.openOrderModal        = openOrderModal;
window.closeOrderModal       = closeOrderModal;
window.updateCartQuantity    = updateCartQuantity;
window.removeFromCart        = removeFromCart;
window.createOrder           = createOrder;
window.deleteOrder           = deleteOrder;
window.shareOrderWhatsApp    = shareOrderWhatsApp;
window.openInventarioModal   = openInventarioModal;
window.closeInventarioModal  = closeInventarioModal;
window.saveInventarioModal   = saveInventarioModal;
window.addAbiertaInModal     = addAbiertaInModal;
window.removeAbiertaInModal  = removeAbiertaInModal;
window.toggleCardExpand      = toggleCardExpand;
window.switchArea            = switchArea;
window.resetAllInventario    = resetAllInventario;
window.saveInventory         = saveInventory;
window.deleteInventory       = deleteInventory;
window.shareInventoryWhatsApp = shareInventoryWhatsApp;
window.exportToExcel         = exportToExcel;
window.exportarAuditoriaExcel = exportarAuditoriaExcel;
window.exportFullData        = exportFullData;
window.importFullData        = importFullData;
window.handleFileImport      = handleFileImport;
