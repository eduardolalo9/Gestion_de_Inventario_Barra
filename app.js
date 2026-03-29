import { db, auth, FIRESTORE_DOC_ID } from './firebase-config.js';

let products = [];
let inventarioConteo = {};
let activeTab = 'inicio';
let selectedGroup = 'Todos';
let editingProductId = null;
let inventarioModalProductId = null;

// ==================== AUTH Y NUBE ====================
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('loginScreen').classList.add('auth-hidden');
        document.getElementById('appWrapper').style.display = 'block';
        if(document.getElementById('sbUserEmail')) document.getElementById('sbUserEmail').textContent = user.email;
        loadFromLocalStorage();
        startRealTimeSync();
        renderTab();
    } else {
        document.getElementById('loginScreen').classList.remove('auth-hidden');
        document.getElementById('appWrapper').style.display = 'none';
    }
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
});

async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const pass = document.getElementById('loginPassword').value.trim();
    const err = document.getElementById('loginError');
    try {
        await auth.signInWithEmailAndPassword(email, pass);
        err.style.display = 'none';
    } catch (e) {
        err.textContent = "Error: " + e.message;
        err.style.display = 'block';
    }
}

async function signOutUser() {
    await auth.signOut();
    sbClose();
}

function startRealTimeSync() {
    if (!db) return;
    db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
      .onSnapshot((doc) => {
          if (doc.exists && !doc.metadata.hasPendingWrites) {
              const data = doc.data();
              if (data.products) products = data.products;
              if (data.inventarioConteo) inventarioConteo = data.inventarioConteo;
              saveToLocalStorage();
              renderTab();
          }
      });
}

async function syncToCloud() {
    if (!db || !navigator.onLine) return showNotification("Sin red. Guardado local.");
    try {
        await db.collection('inventarioApp').doc(FIRESTORE_DOC_ID).set({
            products,
            inventarioConteo,
            _lastModified: Date.now()
        }, { merge: true });
        showNotification("☁️ Sincronizado correctamente.");
        document.getElementById('syncDot').style.background = '#22c55e';
    } catch (error) {
        showNotification("Error sincronizando.");
    }
}

// ==================== INTERFAZ ====================
function showNotification(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toastMessage').textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

function sbOpen() { document.getElementById('sidebar').classList.add('sb-open'); document.getElementById('sbOverlay').classList.add('sb-open'); }
function sbClose() { document.getElementById('sidebar').classList.remove('sb-open'); document.getElementById('sbOverlay').classList.remove('sb-open'); }
function toggleTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    document.documentElement.setAttribute('data-theme', isLight ? 'dark' : 'light');
}

function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('sb-active'));
    document.querySelector(`[data-sb-tab="${tab}"]`)?.classList.add('sb-active');
    renderTab();
}

// ==================== MODALES ====================
function openProductModal(id = null) {
    document.getElementById('productModal').classList.remove('hidden');
    if (id) {
        const p = products.find(x => x.id === id);
        editingProductId = id;
        document.getElementById('productId').value = p.id;
        document.getElementById('productName').value = p.name;
        document.getElementById('productUnit').value = p.unit;
        document.getElementById('productGroup').value = p.group;
        document.getElementById('productModalTitle').textContent = "Editar Producto";
    } else {
        editingProductId = null;
        document.getElementById('productId').value = 'PRD-' + Date.now().toString().slice(-4);
        document.getElementById('productName').value = '';
        document.getElementById('productModalTitle').textContent = "Nuevo Producto";
    }
}

function closeProductModal() { document.getElementById('productModal').classList.add('hidden'); }

function saveProduct() {
    const id = document.getElementById('productId').value;
    const name = document.getElementById('productName').value;
    const unit = document.getElementById('productUnit').value;
    const group = document.getElementById('productGroup').value;

    if (!name) return showNotification("Ingresa un nombre.");

    if (editingProductId) {
        const idx = products.findIndex(x => x.id === editingProductId);
        if (idx !== -1) products[idx] = { id, name, unit, group };
    } else {
        products.push({ id, name, unit, group });
    }
    
    saveToLocalStorage();
    syncToCloud();
    closeProductModal();
    renderTab();
}

function deleteProduct(id) {
    if(confirm("¿Eliminar este producto?")) {
        products = products.filter(p => p.id !== id);
        delete inventarioConteo[id];
        saveToLocalStorage();
        syncToCloud();
        renderTab();
    }
}

// Modal Inventario
function openInventarioModal(id) {
    inventarioModalProductId = id;
    const p = products.find(x => x.id === id);
    document.getElementById('inventarioModalTitle').textContent = p.name;
    const data = inventarioConteo[id] || { enteras: 0, abiertas: [] };
    document.getElementById('inv_enteras').value = data.enteras || 0;
    
    const container = document.getElementById('inv_abiertasContainer');
    container.innerHTML = '';
    (data.abiertas || []).forEach((val, idx) => _crearFilaAbierta(idx, val));
    
    document.getElementById('inventarioModal').classList.remove('hidden');
}

function closeInventarioModal() { document.getElementById('inventarioModal').classList.add('hidden'); }

function _crearFilaAbierta(idx, val = 0) {
    const container = document.getElementById('inv_abiertasContainer');
    const div = document.createElement('div');
    div.id = `abierta_row_${idx}`;
    div.className = "flex gap-2";
    div.innerHTML = `<input type="number" id="inv_abierta_${idx}" class="w-full px-2 py-1 border rounded" value="${val}" step="0.01">
                     <button onclick="removeAbiertaInModal(${idx})" class="text-red-500">❌</button>`;
    container.appendChild(div);
}

function addAbiertaInModal() {
    const idx = document.getElementById('inv_abiertasContainer').children.length;
    _crearFilaAbierta(idx, 0);
}

function removeAbiertaInModal(idx) { document.getElementById(`abierta_row_${idx}`)?.remove(); }

function saveInventarioModal() {
    const enteras = parseInt(document.getElementById('inv_enteras').value) || 0;
    const container = document.getElementById('inv_abiertasContainer');
    const abiertas = [];
    
    for (let i = 0; i < container.children.length; i++) {
        const input = container.children[i].querySelector('input');
        if (input) abiertas.push(parseFloat(input.value) || 0);
    }

    inventarioConteo[inventarioModalProductId] = { enteras, abiertas };
    saveToLocalStorage();
    syncToCloud();
    closeInventarioModal();
    renderTab();
    showNotification("Conteo guardado.");
}

// ==================== RENDERS ====================
function renderTab() {
    const content = document.getElementById('tabContent');
    if (activeTab === 'inicio') {
        content.innerHTML = `<div class="mb-4 flex justify-between items-center"><h2 class="text-2xl font-bold">Dashboard</h2> <button onclick="openProductModal()" class="bg-blue-600 text-white px-4 py-2 rounded">+ Nuevo Producto</button></div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${products.map(p => `<div class="bg-white dark:bg-slate-800 p-4 rounded shadow">
                <h3 class="font-bold text-lg">${p.name}</h3><p class="text-gray-500">${p.group}</p>
            </div>`).join('') || '<p>No hay productos.</p>'}
        </div>`;
    } 
    else if (activeTab === 'productos') {
        content.innerHTML = `<h2 class="text-2xl font-bold mb-4">Gestión de Productos</h2>
        <div class="bg-white rounded shadow overflow-hidden"><table class="w-full text-left">
            <thead class="bg-blue-600 text-white"><tr><th class="p-3">Nombre</th><th class="p-3">Grupo</th><th class="p-3 text-center">Acciones</th></tr></thead>
            <tbody>${products.map(p => `<tr class="border-b"><td class="p-3">${p.name}</td><td class="p-3">${p.group}</td>
                <td class="p-3 text-center"><button onclick="editProduct('${p.id}')" class="text-blue-500 mr-2">✏️</button><button onclick="deleteProduct('${p.id}')" class="text-red-500">🗑️</button></td>
            </tr>`).join('')}</tbody>
        </table></div>`;
    }
    else if (activeTab === 'inventario') {
        content.innerHTML = `<h2 class="text-2xl font-bold mb-4">Conteo de Inventario</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            ${products.map(p => {
                const c = inventarioConteo[p.id] || { enteras: 0, abiertas: [] };
                return `<div class="bg-white p-4 rounded shadow border cursor-pointer hover:border-blue-500" onclick="openInventarioModal('${p.id}')">
                    <h3 class="font-bold">${p.name}</h3>
                    <p class="text-sm text-gray-500 mt-2">Enteras: <span class="font-bold text-black">${c.enteras}</span> | Abiertas: <span class="font-bold text-black">${c.abiertas.length}</span></p>
                </div>`;
            }).join('') || '<p>Añade productos primero.</p>'}
        </div>`;
    }
}

// ==================== STORAGE ====================
function saveToLocalStorage() {
    localStorage.setItem('inv_products', JSON.stringify(products));
    localStorage.setItem('inv_conteo', JSON.stringify(inventarioConteo));
}
function loadFromLocalStorage() {
    products = JSON.parse(localStorage.getItem('inv_products')) || [];
    inventarioConteo = JSON.parse(localStorage.getItem('inv_conteo')) || {};
}

// ==================== EXPORTACIONES AL DOM ====================
Object.assign(window, {
    handleLogin, signOutUser, syncToCloud,
    switchTab, sbOpen, sbClose, toggleTheme,
    openProductModal, closeProductModal, saveProduct, editProduct, deleteProduct,
    openInventarioModal, closeInventarioModal, saveInventarioModal, addAbiertaInModal, removeAbiertaInModal
});