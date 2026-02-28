<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Control de Inventario - Barra</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <style>
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes slideIn {
            from { transform: scaleX(0); }
            to { transform: scaleX(1); }
        }
        @keyframes slideUp {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
        }
        .animate-fadeIn {
            animation: fadeIn 0.3s ease-out;
        }
        .animate-slideIn {
            animation: slideIn 0.3s ease-out;
            transform-origin: left;
        }
        .animate-slideUp {
            animation: slideUp 0.3s ease-out;
        }
        .hidden { display: none !important; }
        
        /* Responsive mejoras */
        @media (max-width: 768px) {
            .px-6 { padding-left: 0.75rem !important; padding-right: 0.75rem !important; }
            body { font-size: 14px; }
            button { font-size: 14px; }
            input, select, textarea { font-size: 16px; /* Evita zoom en iOS */ }
        }
        
        @media (min-width: 640px) {
            .px-6 { padding-left: 1.5rem !important; padding-right: 1.5rem !important; }
        }
        
        /* Asegurar botones tocables en móvil */
        button { min-height: 44px; }
        input, select, textarea { min-height: 44px; }
        
        /* Tablas responsivas */
        @media (max-width: 640px) {
            table { font-size: 13px; }
            th, td { padding: 0.5rem !important; }
        }
        
        
        @media (prefers-color-scheme: dark) {
            body {
                background-color: #111827;
                color: #f3f4f6;
            }
            .bg-white { background-color: #1f2937 !important; }
            .bg-gray-50 { background-color: #111827 !important; }
            .text-gray-900 { color: #f3f4f6 !important; }
            .text-gray-600 { color: #9ca3af !important; }
            .text-gray-400 { color: #6b7280 !important; }
            .border-gray-200 { border-color: #374151 !important; }
            .divide-gray-200 > * + * { border-color: #374151 !important; }
            .hover\:bg-gray-50:hover { background-color: #374151 !important; }
            .hover\:bg-purple-50:hover { background-color: rgba(139, 92, 246, 0.1) !important; }
            .hover\:bg-blue-50:hover { background-color: rgba(59, 130, 246, 0.1) !important; }
            .bg-purple-50 { background-color: rgba(139, 92, 246, 0.1) !important; }
            input, select, textarea {
                background-color: #374151 !important;
                color: #f3f4f6 !important;
                border-color: #4b5563 !important;
            }
            input:disabled {
                background-color: #1f2937 !important;
                color: #6b7280 !important;
            }
        }
    </style>
</head>
<body class="min-h-screen bg-gray-50 transition-colors duration-300">
    <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" class="hidden">

    <div class="sticky top-0 z-50 bg-gradient-to-r from-purple-600 via-blue-600 to-orange-500 shadow-lg animate-fadeIn">
        <div class="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-5">
            <div class="flex justify-between items-center gap-2">
                <div>
                    <h1 class="text-lg sm:text-xl md:text-2xl font-bold text-white">Control de Inventario</h1>
                    <p class="text-white text-opacity-90 text-xs sm:text-sm mt-0.5 hidden sm:block">Gestión profesional de barra</p>
                </div>
                <div id="headerActions" class="flex gap-2 sm:gap-3 flex-shrink-0"></div>
            </div>
        </div>
    </div>

    <div class="bg-white shadow-sm sticky top-[64px] sm:top-[88px] z-40 overflow-x-auto">
        <div class="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 flex-shrink-0">
            <div class="flex gap-1 sm:gap-2 md:gap-8 overflow-x-auto" id="tabs">
                <button onclick="switchTab('inicio')" data-tab="inicio" class="tab-btn py-3 sm:py-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-300 relative whitespace-nowrap text-gray-900">
                    Inicio
                    <div class="tab-indicator absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-orange-500 rounded-t-full animate-slideIn"></div>
                </button>
                <button onclick="switchTab('productos')" data-tab="productos" class="tab-btn py-3 sm:py-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-300 relative whitespace-nowrap text-gray-600">
                    Productos
                </button>
                <button onclick="switchTab('pedidos')" data-tab="pedidos" class="tab-btn py-3 sm:py-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-300 relative whitespace-nowrap text-gray-600">
                    Pedidos
                </button>
                <button onclick="switchTab('inventario')" data-tab="inventario" class="tab-btn py-3 sm:py-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-300 relative whitespace-nowrap text-gray-600">
                    Inventario
                </button>
                <button onclick="switchTab('historia')" data-tab="historia" class="tab-btn py-3 sm:py-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-300 relative whitespace-nowrap text-gray-600">
                    Historia
                </button>
            </div>
        </div>
    </div>

    <div class="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 animate-fadeIn">
        <div id="tabContent"></div>
    </div>

    <div id="productModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50 animate-fadeIn hidden">
        <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl max-w-md w-full p-6 animate-slideUp">
            <div class="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-6"></div>
            <h2 class="text-2xl font-bold text-gray-900 mb-6" id="productModalTitle">Agregar Producto</h2>
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-600 mb-2">ID <span class="text-xs text-gray-500">(Obligatorio - Se genera automáticamente si está vacío)</span></label>
                    <input type="text" id="productId" class="w-full px-4 py-3 bg-white text-gray-900 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent" placeholder="Ingresa el ID o déjalo vacío para generar uno automáticamente">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-600 mb-2">Descripción *</label>
                    <input type="text" id="productName" class="w-full px-4 py-3 bg-white text-gray-900 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent" placeholder="Nombre del producto">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-600 mb-2">Unidad *</label>
                    <select id="productUnit" class="w-full px-4 py-3 bg-white text-gray-900 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                        <option>Piezas</option>
                        <option>Kilos</option>
                        <option>Gramos</option>
                        <option>Paquete</option>
                        <option>Unidad</option>
                        <option>Tapas</option>
                        <option>Cartones</option>
                        <option>Botellas</option>
                        <option>Litros</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-600 mb-2">Grupo</label>
                    <input type="text" id="productGroup" class="w-full px-4 py-3 bg-white text-gray-900 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500" placeholder="Ej: Premium, Bebidas, Insumos">
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-600 mb-2">Stock Actual</label>
                        <input type="number" id="productStock" class="w-full px-4 py-3 bg-white text-gray-900 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500" min="0" step="0.01" value="0">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 mb-2">Stock Mínimo</label>
                        <input type="number" id="productMinStock" class="w-full px-4 py-3 bg-white text-gray-900 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500" min="0" step="0.01" value="0">
                    </div>
                </div>
                <div class="flex gap-3 mt-6 pt-4">
                    <button onclick="closeProductModal()" class="flex-1 px-6 py-3.5 border-2 border-gray-200 text-gray-900 rounded-xl hover:bg-gray-50 transition-all font-medium min-h-[48px]">
                        Cancelar
                    </button>
                    <button onclick="saveProduct()" class="flex-1 px-6 py-3.5 bg-gradient-to-r from-purple-500 to-orange-500 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95 font-medium min-h-[48px]">
                        Guardar
                    </button>
                </div>
            </div>
        </div>
    </div>

    <div id="orderModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50 animate-fadeIn hidden">
        <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl max-w-4xl w-full p-6 animate-slideUp max-h-[95vh] overflow-y-auto">
            <div class="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-6"></div>
            <h2 class="text-2xl font-bold text-gray-900 mb-6">Generar Pedido</h2>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                    <label class="block text-sm font-medium text-gray-600 mb-2">Proveedor *</label>
                    <input type="text" id="orderSupplier" class="w-full px-4 py-3 bg-white text-gray-900 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500" placeholder="Nombre del proveedor">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-600 mb-2">Fecha de Entrega (Opcional)</label>
                    <input type="date" id="orderDeliveryDate" class="w-full px-4 py-3 bg-white text-gray-900 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500">
                </div>
                <div class="md:col-span-2">
                    <label class="block text-sm font-medium text-gray-600 mb-2">Nota (Opcional)</label>
                    <textarea id="orderNote" class="w-full px-4 py-3 bg-white text-gray-900 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500" placeholder="Agregar nota o comentarios" rows="2"></textarea>
                </div>
            </div>

            <div class="mb-6">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="font-semibold text-gray-900">Productos en el Pedido</h3>
                    <span class="text-sm font-medium text-purple-600 bg-purple-50 px-3 py-1 rounded-lg" id="orderTotal">Total: 0</span>
                </div>
                <div class="bg-gray-50 rounded-xl overflow-hidden border border-gray-200">
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead class="bg-gradient-to-r from-purple-600 to-blue-600">
                                <tr>
                                    <th class="px-4 py-3 text-left text-sm font-semibold text-white">Producto</th>
                                    <th class="px-4 py-3 text-center text-sm font-semibold text-white">Unidad</th>
                                    <th class="px-4 py-3 text-center text-sm font-semibold text-white">Cantidad</th>
                                    <th class="px-4 py-3 text-center text-sm font-semibold text-white">Acciones</th>
                                </tr>
                            </thead>
                            <tbody id="orderProductsTable" class="divide-y divide-gray-200"></tbody>
                        </table>
                    </div>
                </div>
                <div id="emptyCart" class="text-center py-8 text-gray-500 hidden">
                    <svg class="w-12 h-12 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path>
                    </svg>
                    <p>No hay productos en el carrito</p>
                </div>
            </div>

            <div class="flex gap-3">
                <button onclick="closeOrderModal()" class="flex-1 px-6 py-3.5 border-2 border-gray-200 text-gray-900 rounded-xl hover:bg-gray-50 transition-all font-medium min-h-[48px]">
                    Cancelar
                </button>
                <button onclick="createOrder()" class="flex-1 px-6 py-3.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95 font-medium min-h-[48px] flex items-center justify-center gap-2">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>
                    </svg>
                    Compartir WhatsApp
                </button>
            </div>
        </div>
    </div>

    <div id="toast" class="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 animate-slideUp hidden">
        <div class="bg-purple-600 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-2">
            <div class="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            <span class="font-medium" id="toastMessage"></span>
        </div>
    </div>

    <!-- Modal de conteo de botellas para inventario -->
    <div id="inventarioModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50 animate-fadeIn hidden">
        <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl max-w-md w-full p-6 animate-slideUp max-h-[90vh] overflow-y-auto">
            <div class="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-4"></div>
            <h2 class="text-xl font-bold text-gray-900 mb-1" id="inventarioModalTitle">Contar botellas</h2>
            <p class="text-sm text-gray-500 mb-5" id="inventarioModalSubtitle"></p>

            <!-- Botellas Enteras -->
            <div class="mb-5">
                <label class="block text-sm font-semibold text-gray-700 mb-2">🍾 Botellas Enteras</label>
                <input type="number" id="inv_enteras" min="0" step="1" value="0"
                    class="w-full px-4 py-3 bg-white text-gray-900 border-2 border-purple-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent text-center text-lg font-bold">
            </div>

            <!-- Botellas Abiertas -->
            <div class="mb-5">
                <div class="flex items-center justify-between mb-2">
                    <label class="block text-sm font-semibold text-gray-700">🍷 Botellas Abiertas</label>
                    <button onclick="addAbiertaInModal()" class="flex items-center gap-1 text-xs bg-gradient-to-r from-purple-500 to-blue-500 text-white px-3 py-1.5 rounded-lg hover:shadow-md transition-all active:scale-95 font-medium">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg>
                        Agregar
                    </button>
                </div>
                <div id="inv_abiertasContainer" class="space-y-2"></div>
            </div>

            <div class="flex gap-3 pt-2">
                <button onclick="closeInventarioModal()" class="flex-1 px-4 py-3 border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-all font-medium">
                    Cancelar
                </button>
                <button onclick="saveInventarioModal()" class="flex-1 px-4 py-3 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95 font-medium">
                    Guardar
                </button>
            </div>
        </div>
    </div>

    <script>
        let products = [];
        let cart = [];
        let orders = [];
        let inventories = [];
        let activeTab = 'inicio';
        let editingProductId = null;
        let searchTerm = '';
        let selectedGroup = 'Todos';
        let selectedArea = 'almacen';
        let expandedInventories = new Set();
        let inventarioConteo = {}; // Estructura: { productId: { area: { enteras: 0, abiertas: [] } } }
        let inventarioModalProductId = null;

        const areas = {
            almacen: 'Almacén',
            barra1: 'Barra 1',
            barra2: 'Barra 2'
        };

        // ==================== PERSISTENCIA DE DATOS ====================
        function saveToLocalStorage() {
            localStorage.setItem('inventarioApp_products', JSON.stringify(products));
            localStorage.setItem('inventarioApp_orders', JSON.stringify(orders));
            localStorage.setItem('inventarioApp_inventories', JSON.stringify(inventories));
            localStorage.setItem('inventarioApp_cart', JSON.stringify(cart));
            localStorage.setItem('inventarioApp_activeTab', activeTab);
            localStorage.setItem('inventarioApp_selectedGroup', selectedGroup);
            localStorage.setItem('inventarioApp_selectedArea', selectedArea);
            localStorage.setItem('inventarioApp_searchTerm', searchTerm);
            localStorage.setItem('inventarioApp_expandedInventories', JSON.stringify(Array.from(expandedInventories)));
            localStorage.setItem('inventarioApp_inventarioConteo', JSON.stringify(inventarioConteo));
        }

        function loadFromLocalStorage() {
            const storedProducts = localStorage.getItem('inventarioApp_products');
            const storedOrders = localStorage.getItem('inventarioApp_orders');
            const storedInventories = localStorage.getItem('inventarioApp_inventories');
            const storedCart = localStorage.getItem('inventarioApp_cart');
            const storedActiveTab = localStorage.getItem('inventarioApp_activeTab');
            const storedSelectedGroup = localStorage.getItem('inventarioApp_selectedGroup');
            const storedSelectedArea = localStorage.getItem('inventarioApp_selectedArea');
            const storedSearchTerm = localStorage.getItem('inventarioApp_searchTerm');
            const storedExpandedInventories = localStorage.getItem('inventarioApp_expandedInventories');
            
            if (storedProducts) products = JSON.parse(storedProducts);
            if (storedOrders) orders = JSON.parse(storedOrders);
            if (storedInventories) inventories = JSON.parse(storedInventories);
            if (storedCart) cart = JSON.parse(storedCart);
            if (storedActiveTab) activeTab = storedActiveTab;
            if (storedSelectedGroup) selectedGroup = storedSelectedGroup;
            if (storedSelectedArea) selectedArea = storedSelectedArea;
            if (storedSearchTerm) searchTerm = storedSearchTerm;
            if (storedExpandedInventories) expandedInventories = new Set(JSON.parse(storedExpandedInventories));
            const storedInventarioConteo = localStorage.getItem('inventarioApp_inventarioConteo');
            if (storedInventarioConteo) {
                const parsed = JSON.parse(storedInventarioConteo);
                // BUG 8 FIX: Migrar formato antiguo plano {prodId:{enteras,abiertas}}
                // al nuevo formato por área {prodId:{area:{enteras,abiertas}}}
                const migrated = {};
                Object.keys(parsed).forEach(prodId => {
                    const val = parsed[prodId];
                    // Si el valor tiene directamente 'enteras' es formato viejo (plano)
                    if (val && typeof val.enteras !== 'undefined' && !val.almacen && !val.barra1 && !val.barra2) {
                        migrated[prodId] = { almacen: val };
                    } else {
                        migrated[prodId] = val;
                    }
                });
                inventarioConteo = migrated;
            }
        }

        function initializeApp() {
            loadFromLocalStorage();
            
            // Si no hay productos guardados, usar los iniciales
            if (products.length === 0) {
                const initialProducts = [
                    { id: 'PRD-001', name: 'Vodka Premium', stockByArea: { almacen: 12, barra1: 5, barra2: 3 }, minStock: 6, unit: 'Botellas', group: 'Premium' },
                    { id: 'PRD-002', name: 'Ron Añejo', stockByArea: { almacen: 8, barra1: 4, barra2: 2 }, minStock: 5, unit: 'Botellas', group: 'Premium' },
                    { id: 'PRD-003', name: 'Whisky Escocés', stockByArea: { almacen: 4, barra1: 2, barra2: 1 }, minStock: 4, unit: 'Botellas', group: 'Premium' },
                    { id: 'PRD-004', name: 'Gin London Dry', stockByArea: { almacen: 10, barra1: 3, barra2: 2 }, minStock: 6, unit: 'Botellas', group: 'Premium' },
                    { id: 'PRD-005', name: 'Tequila Reposado', stockByArea: { almacen: 3, barra1: 2, barra2: 1 }, minStock: 5, unit: 'Botellas', group: 'Premium' },
                    { id: 'PRD-006', name: 'Cerveza Nacional', stockByArea: { almacen: 48, barra1: 24, barra2: 18 }, minStock: 24, unit: 'Unidades', group: 'Bebidas' },
                    { id: 'PRD-007', name: 'Cerveza Importada', stockByArea: { almacen: 18, barra1: 12, barra2: 6 }, minStock: 12, unit: 'Unidades', group: 'Bebidas' },
                    { id: 'PRD-008', name: 'Vino Tinto Reserva', stockByArea: { almacen: 15, barra1: 6, barra2: 4 }, minStock: 8, unit: 'Botellas', group: 'Vinos' },
                    { id: 'PRD-009', name: 'Vino Blanco', stockByArea: { almacen: 12, barra1: 5, barra2: 3 }, minStock: 6, unit: 'Botellas', group: 'Vinos' },
                    { id: 'PRD-010', name: 'Coca Cola', stockByArea: { almacen: 36, barra1: 20, barra2: 15 }, minStock: 24, unit: 'Unidades', group: 'Bebidas' },
                    { id: 'PRD-011', name: 'Agua Mineral', stockByArea: { almacen: 42, barra1: 25, barra2: 18 }, minStock: 30, unit: 'Unidades', group: 'Bebidas' },
                    { id: 'PRD-012', name: 'Jugo de Naranja', stockByArea: { almacen: 8, barra1: 4, barra2: 3 }, minStock: 6, unit: 'Litros', group: 'Bebidas' },
                    { id: 'PRD-013', name: 'Limones', stockByArea: { almacen: 5, barra1: 2, barra2: 1.5 }, minStock: 3, unit: 'Kg', group: 'Frutas' },
                    { id: 'PRD-014', name: 'Hielo', stockByArea: { almacen: 20, barra1: 10, barra2: 8 }, minStock: 15, unit: 'Kg', group: 'Insumos' }
                ];
                products = initialProducts;
                saveToLocalStorage();
            }
            
            // Actualizar la UI para mostrar la pestaña activa correctamente
            switchTab(activeTab);
        }

        // ==================== FUNCIONES UTILITARIAS ====================
        function getTotalStock(product) {
            return product.stockByArea.almacen + product.stockByArea.barra1 + product.stockByArea.barra2;
        }

        function getAvailableGroups() {
            const groups = new Set(products.map(p => p.group).filter(g => g));
            return ['Todos', ...Array.from(groups).sort()];
        }

        function switchTab(tab) {
            activeTab = tab;
            // No resetear selectedGroup al cambiar de tab
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
                    if (indicator) {
                        indicator.remove();
                    }
                }
            });
            saveToLocalStorage();
            renderTab();
        }

        function switchArea(area) {
            // Guardar cambios actuales antes de cambiar de área
            saveToLocalStorage();
            selectedArea = area;
            renderTab();
        }

        function showNotification(message) {
            const toast = document.getElementById('toast');
            const toastMessage = document.getElementById('toastMessage');
            toastMessage.textContent = message;
            toast.classList.remove('hidden');
            setTimeout(() => {
                toast.classList.add('hidden');
            }, 3000);
        }

        function updateSearchTerm(value) {
            searchTerm = value;
            saveToLocalStorage();
            renderTab();
        }

        function updateSelectedGroup(value) {
            selectedGroup = value;
            saveToLocalStorage();
            renderTab();
        }

        function renderTab() {
            updateHeaderActions();
            const content = document.getElementById('tabContent');
            
            switch(activeTab) {
                case 'inicio':
                    content.innerHTML = renderInicioTab();
                    break;
                case 'productos':
                    content.innerHTML = renderProductosTab();
                    break;
                case 'pedidos':
                    content.innerHTML = renderPedidosTab();
                    break;
                case 'inventario':
                    content.innerHTML = renderInventarioTab();
                    break;
                case 'historia':
                    content.innerHTML = renderHistoriaTab();
                    break;
            }
        }

        function updateHeaderActions() {
            const headerActions = document.getElementById('headerActions');
            
            if (activeTab === 'inicio') {
                headerActions.innerHTML = '<div class="flex gap-2 sm:gap-3"><div class="bg-white bg-opacity-20 backdrop-blur-sm rounded-full px-2 sm:px-4 py-1 sm:py-2 flex items-center gap-1 sm:gap-2 text-xs sm:text-base"><svg class="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg><span class="text-white font-bold">' + cart.length + '</span></div><button onclick="openOrderModal()" class="bg-gradient-to-r from-purple-500 to-orange-500 text-white px-3 sm:px-6 py-2 sm:py-3 rounded-full flex items-center gap-1 sm:gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 transition-all duration-200 text-xs sm:text-base whitespace-nowrap"><svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg><span class="hidden sm:inline">Gen. Pedido</span><span class="sm:hidden">Pedido</span></button></div>';
            } else if (activeTab === 'productos') {
                headerActions.innerHTML = '<div class="flex gap-2 sm:gap-3 flex-wrap"><button onclick="openProductModal()" class="bg-gradient-to-r from-purple-500 to-orange-500 text-white px-3 sm:px-6 py-2 sm:py-3 rounded-full flex items-center gap-1 sm:gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 transition-all duration-200 text-xs sm:text-base whitespace-nowrap"><svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg><span class="hidden sm:inline">Agregar Producto</span><span class="sm:hidden">Agregar</span></button><button onclick="deleteAllProducts()" class="bg-gradient-to-r from-red-500 to-orange-600 text-white px-3 sm:px-6 py-2 sm:py-3 rounded-full flex items-center gap-1 sm:gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 transition-all duration-200 text-xs sm:text-base whitespace-nowrap" title="Eliminar todos"><svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg><span class="hidden sm:inline">Eliminar Todos</span><span class="sm:hidden">Eliminar</span></button></div>';
            } else {
                headerActions.innerHTML = '';
            }
        }

        function renderInicioTab() {
            const filteredProducts = filterByGroup();
            
            let html = '<div class="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-5 mb-4 sm:mb-6 shadow-md"><div class="flex flex-col gap-2 sm:gap-3"><div class="relative"><svg class="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 text-gray-600 w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg><input type="text" placeholder="Buscar..." value="' + searchTerm + '" onkeyup="updateSearchTerm(this.value);" class="w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-2 sm:py-3 bg-white text-gray-900 border border-gray-200 rounded-lg sm:rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-sm sm:text-base"></div><select onchange="updateSelectedGroup(this.value);" class="px-3 sm:px-4 py-2 sm:py-3 bg-white text-gray-900 border border-gray-200 rounded-lg sm:rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-sm sm:text-base">';
            
            getAvailableGroups().forEach(group => {
                html += '<option value="' + group + '"' + (selectedGroup === group ? ' selected' : '') + '>' + group + '</option>';
            });
            html += '</select></div></div>';
            
            html += '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">';
            filteredProducts.forEach(product => {
                const totalStock = getTotalStock(product);
                html += '<div class="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-5 shadow-md hover:shadow-lg transition-all"><div class="flex justify-between items-start mb-2 sm:mb-3"><div><h3 class="font-semibold text-gray-900 text-base sm:text-lg">' + product.name + '</h3><p class="text-xs sm:text-sm text-gray-600">' + product.id + '</p></div></div><div class="space-y-1 sm:space-y-2 mb-3 sm:mb-4"><div class="flex justify-between text-xs sm:text-sm"><span class="text-gray-600">Stock:</span><span class="font-semibold ' + (totalStock <= product.minStock ? 'text-orange-500' : 'text-gray-900') + '">' + totalStock + ' ' + product.unit + '</span></div><div class="flex justify-between text-xs sm:text-sm"><span class="text-gray-600">Grupo:</span><span class="font-semibold text-gray-900">' + product.group + '</span></div></div><button onclick="addToCart(\'' + product.id + '\')" class="w-full bg-gradient-to-r from-purple-500 to-blue-500 text-white py-2 sm:py-3 text-sm sm:text-base rounded-lg sm:rounded-xl font-medium hover:shadow-lg transition-all transform active:scale-95">Agregar</button></div>';
            });
            html += '</div>';
            
            return html;
        }

        function renderProductosTab() {
            const filteredProducts = filterByGroup();
            
            let html = '<div class="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-5 mb-4 sm:mb-6 shadow-md"><select onchange="updateSelectedGroup(this.value);" class="w-full px-3 sm:px-4 py-2 sm:py-3 bg-white text-gray-900 border border-gray-200 rounded-lg sm:rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-sm sm:text-base">';
            
            getAvailableGroups().forEach(group => {
                html += '<option value="' + group + '"' + (selectedGroup === group ? ' selected' : '') + '>' + group + '</option>';
            });
            html += '</select></div>';
            
            // MODIFICACIÓN: Columna ID oculta, Descripción visible
            html += '<div class="bg-white rounded-xl sm:rounded-2xl shadow-md overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm sm:text-base"><thead class="bg-gradient-to-r from-purple-600 to-blue-600"><tr><th class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-left text-xs sm:text-sm font-semibold text-white">Nombre del Producto</th><th class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-left text-xs sm:text-sm font-semibold text-white hidden md:table-cell">Grupo</th><th class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-left text-xs sm:text-sm font-semibold text-white">Unit</th><th class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-center text-xs sm:text-sm font-semibold text-white">Stock</th><th class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-center text-xs sm:text-sm font-semibold text-white">Acc</th></tr></thead><tbody class="divide-y divide-gray-200">';
            
            filteredProducts.forEach(product => {
                const totalStock = getTotalStock(product);
                html += '<tr class="hover:bg-purple-50 transition-colors"><td class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 font-medium text-gray-900 text-xs sm:text-sm">' + product.name + '</td><td class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-600 hidden md:table-cell text-xs sm:text-sm">' + product.group + '</td><td class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-600 text-xs sm:text-sm">' + product.unit.substring(0, 3) + '</td><td class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-center font-semibold text-xs sm:text-sm ' + (totalStock <= product.minStock ? 'text-orange-500' : 'text-gray-900') + '">' + totalStock + '</td><td class="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4"><div class="flex items-center justify-center gap-1"><button onclick="editProduct(\'' + product.id + '\')" class="p-1.5 sm:p-2.5 bg-gradient-to-br from-blue-500 to-purple-500 text-white rounded-lg sm:rounded-xl hover:shadow-lg transition-all transform active:scale-95 min-w-[36px] sm:min-w-[48px] min-h-[36px] sm:min-h-[48px] flex items-center justify-center"><svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button><button onclick="deleteProduct(\'' + product.id + '\')" class="p-1.5 sm:p-2.5 bg-gradient-to-br from-red-500 to-orange-500 text-white rounded-lg sm:rounded-xl hover:shadow-lg transition-all transform active:scale-95 min-w-[36px] sm:min-w-[48px] min-h-[36px] sm:min-h-[48px] flex items-center justify-center"><svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></div></td></tr>';
            });
            
            html += '</tbody></table></div></div>';
            return html;
        }

        function renderPedidosTab() {
            if (orders.length === 0) {
                return '<div class="bg-white rounded-2xl p-12 text-center shadow-md"><svg class="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg><p class="text-gray-600">No hay pedidos registrados</p></div>';
            }
            
            let html = '<div class="mb-6">';
            html += '<button onclick="deleteAllOrders()" class="bg-gradient-to-r from-red-500 to-orange-600 text-white px-6 py-3 rounded-xl flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 transition-all duration-200" title="Eliminar todos los pedidos"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg><span class="font-medium">Eliminar todos los pedidos</span></button>';
            html += '</div>';
            html += '<div class="space-y-4">';
            orders.forEach(order => {
                html += '<div class="bg-white rounded-2xl p-6 shadow-md"><div class="flex justify-between items-start mb-4"><div><h3 class="text-xl font-bold text-gray-900">' + order.id + '</h3><p class="text-gray-600">Proveedor: ' + order.supplier + '</p><p class="text-sm text-gray-600">Fecha: ' + order.date + '</p>';
                if (order.deliveryDate) {
                    html += '<p class="text-sm text-gray-600">Entrega: ' + order.deliveryDate + '</p>';
                }
                html += '</div><div class="flex gap-2"><button onclick="shareOrderWhatsApp(\'' + order.id + '\')" class="p-2.5 bg-gradient-to-br from-green-500 to-emerald-500 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg></button><button onclick="deleteOrder(\'' + order.id + '\')" class="p-2.5 bg-gradient-to-br from-red-500 to-orange-500 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></div></div><div class="overflow-x-auto"><table class="w-full"><thead class="bg-gradient-to-r from-purple-600 to-blue-600"><tr><th class="px-4 py-3 text-left text-sm font-semibold text-white">Nombre de Producto</th><th class="px-4 py-3 text-center text-sm font-semibold text-white">Unidad de Medida</th><th class="px-4 py-3 text-center text-sm font-semibold text-white">Cantidad</th></tr></thead><tbody class="divide-y divide-gray-200">';
                
                order.products.forEach(p => {
                    html += '<tr><td class="px-4 py-3 text-gray-900">' + p.name + '</td><td class="px-4 py-3 text-center text-gray-600">' + p.unit + '</td><td class="px-4 py-3 text-center font-semibold text-gray-900">' + p.quantity + '</td></tr>';
                });
                
                html += '</tbody></table></div><div class="mt-4 pt-4 border-t border-gray-200"><div class="text-right mb-2"><span class="text-lg font-bold text-gray-900">Total Productos: ' + order.total.toFixed(2) + '</span></div>';
                if (order.note) {
                    html += '<div class="mt-3 p-3 bg-purple-50 rounded-xl"><p class="text-sm font-medium text-gray-600 mb-1">Nota:</p><p class="text-gray-900">' + order.note + '</p></div>';
                }
                html += '</div></div>';
            });
            html += '</div>';
            
            return html;
        }

        function resetAllInventario() {
            if (!confirm('⚠️ ¿Estás seguro de que quieres borrar TODAS las cantidades de Almacén, Barra 1 y Barra 2?\n\nEsta acción no se puede deshacer.')) return;
            products.forEach(p => {
                p.stockByArea.almacen = 0;
                p.stockByArea.barra1 = 0;
                p.stockByArea.barra2 = 0;
            });
            inventarioConteo = {};
            saveToLocalStorage();
            showNotification('Todas las cantidades han sido borradas');
            renderTab();
        }

        function openInventarioModal(productId) {
            const product = products.find(p => p.id === productId);
            if (!product) return;
            inventarioModalProductId = productId;

            // Estructura por área: inventarioConteo[productId][area] = { enteras, abiertas }
            if (!inventarioConteo[productId]) inventarioConteo[productId] = {};
            const areaData = inventarioConteo[productId][selectedArea] || { enteras: 0, abiertas: [] };

            document.getElementById('inventarioModalTitle').textContent = product.name;
            document.getElementById('inventarioModalSubtitle').textContent = product.group + ' · ' + product.unit + ' — ' + areas[selectedArea];
            document.getElementById('inv_enteras').value = areaData.enteras || 0;

            const container = document.getElementById('inv_abiertasContainer');
            container.innerHTML = '';
            const abiertas = (areaData.abiertas && areaData.abiertas.length > 0) ? areaData.abiertas : [0];
            abiertas.forEach((val, idx) => renderAbiertaInput(val, idx));

            document.getElementById('inventarioModal').classList.remove('hidden');
        }

        function renderAbiertaInput(val, idx) {
            const container = document.getElementById('inv_abiertasContainer');
            const div = document.createElement('div');
            div.className = 'flex items-center gap-2';
            div.id = 'abierta_row_' + idx;
            div.innerHTML = '<span class="text-xs font-medium text-gray-500 w-16 flex-shrink-0">Abierta ' + (idx + 1) + '</span>' +
                '<input type="number" id="inv_abierta_' + idx + '" min="0" step="0.01" value="' + val + '" ' +
                'class="flex-1 px-3 py-2 bg-white text-gray-900 border-2 border-orange-200 rounded-xl focus:ring-2 focus:ring-orange-400 focus:border-transparent text-center font-bold" ' +
                'placeholder="0.0">' +
                (idx > 0 ? '<button onclick="removeAbiertaInModal(' + idx + ')" class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>' : '<div class="w-8"></div>');
            container.appendChild(div);
        }

        function addAbiertaInModal() {
            const container = document.getElementById('inv_abiertasContainer');
            const idx = container.children.length;
            renderAbiertaInput(0, idx);
        }

        function removeAbiertaInModal(idx) {
            const container = document.getElementById('inv_abiertasContainer');
            // Recollect current values before removing
            const rows = container.children.length;
            const vals = [];
            for (let i = 0; i < rows; i++) {
                const input = document.getElementById('inv_abierta_' + i);
                if (input && i !== idx) vals.push(parseFloat(input.value) || 0);
            }
            container.innerHTML = '';
            vals.forEach((v, i) => renderAbiertaInput(v, i));
        }

        function closeInventarioModal() {
            document.getElementById('inventarioModal').classList.add('hidden');
            inventarioModalProductId = null;
        }

        function saveInventarioModal() {
            if (!inventarioModalProductId) return;
            const enteras = parseFloat(document.getElementById('inv_enteras').value) || 0;
            const container = document.getElementById('inv_abiertasContainer');
            const abiertas = [];
            for (let i = 0; i < container.children.length; i++) {
                const input = document.getElementById('inv_abierta_' + i);
                if (input) abiertas.push(parseFloat(input.value) || 0);
            }
            // Guardar por área
            if (!inventarioConteo[inventarioModalProductId]) inventarioConteo[inventarioModalProductId] = {};
            inventarioConteo[inventarioModalProductId][selectedArea] = { enteras, abiertas };
            // Sync enteras to current area stock
            const product = products.find(p => p.id === inventarioModalProductId);
            if (product) product.stockByArea[selectedArea] = enteras;
            saveToLocalStorage();
            showNotification('Conteo guardado en ' + areas[selectedArea]);
            closeInventarioModal();
            renderTab();
        }

        function renderInventarioTab() {
            const filteredProducts = filterByGroup();
            
            let html = '<div class="mb-4 sm:mb-6">';
            html += '<div class="flex flex-col gap-3 mb-3 sm:mb-4">';
            html += '<h2 class="text-xl sm:text-2xl font-bold text-gray-900">Gestión de Inventario</h2>';
            html += '<div class="flex flex-wrap gap-2 sm:gap-3">';
            // Botón NUEVO
            html += '<button onclick="resetAllInventario()" class="bg-gradient-to-r from-red-500 to-orange-500 text-white px-3 sm:px-6 py-2 sm:py-3 text-xs sm:text-base rounded-lg sm:rounded-xl font-medium hover:shadow-lg transition-all transform active:scale-95 whitespace-nowrap flex items-center gap-1 sm:gap-2"><svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg><span>Nuevo</span></button>';
            html += '<button onclick="document.getElementById(\'fileInput\').click()" class="border-2 border-purple-500 text-purple-600 px-3 sm:px-6 py-2 sm:py-3 text-xs sm:text-base rounded-lg sm:rounded-xl flex items-center gap-1 sm:gap-2 hover:bg-purple-50 transition-all font-medium whitespace-nowrap"><svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg><span class="hidden sm:inline">Importar</span></button>';
            html += '<button onclick="saveInventorySnapshot()" class="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-3 sm:px-6 py-2 sm:py-3 text-xs sm:text-base rounded-lg sm:rounded-xl font-medium hover:shadow-lg transition-all transform active:scale-95 whitespace-nowrap">Guardar</button>';
            html += '<button onclick="exportToExcel()" class="border-2 border-blue-500 text-blue-600 px-3 sm:px-6 py-2 sm:py-3 text-xs sm:text-base rounded-lg sm:rounded-xl flex items-center gap-1 sm:gap-2 hover:bg-blue-50 transition-all font-medium whitespace-nowrap"><svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg><span class="hidden sm:inline">Exportar</span></button>';
            html += '</div></div>';
            
            html += '<div class="flex flex-wrap gap-2 mb-3 sm:mb-4">';
            Object.keys(areas).forEach(area => {
                const isActive = selectedArea === area;
                html += '<button onclick="switchArea(\'' + area + '\')" class="px-3 sm:px-6 py-2 sm:py-3 text-xs sm:text-base rounded-lg sm:rounded-xl font-medium transition-all transform active:scale-95 ' + (isActive ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white shadow-lg' : 'border-2 border-gray-300 text-gray-700 hover:border-purple-300') + '">' + areas[area] + '</button>';
            });
            html += '</div>';
            
            html += '<div class="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-5 mb-4 sm:mb-6 shadow-md"><select onchange="updateSelectedGroup(this.value);" class="w-full px-3 sm:px-4 py-2 sm:py-3 bg-white text-gray-900 border border-gray-200 rounded-lg sm:rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-sm sm:text-base">';
            getAvailableGroups().forEach(group => {
                html += '<option value="' + group + '"' + (selectedGroup === group ? ' selected' : '') + '>' + group + '</option>';
            });
            html += '</select></div>';

            // Verificar si algún producto tiene más de 1 botella abierta en el área actual
            const anyHasExtra = filteredProducts.some(p => {
                const c = inventarioConteo[p.id] && inventarioConteo[p.id][selectedArea];
                return c && c.abiertas && c.abiertas.length > 1;
            });

            html += '<div class="bg-white rounded-xl sm:rounded-2xl shadow-md overflow-hidden">';
            html += '<p class="text-xs text-gray-400 px-4 pt-3 pb-1">Toca un producto para ingresar cantidades</p>';
            html += '<div class="overflow-x-auto"><table class="w-full text-xs sm:text-base"><thead class="bg-gradient-to-r from-purple-600 to-blue-600"><tr>';
            html += '<th class="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs sm:text-sm font-semibold text-white">Descripción</th>';
            html += '<th class="px-2 sm:px-4 py-2 sm:py-3 text-center text-xs sm:text-sm font-semibold text-white">🍾 Entera</th>';
            html += '<th class="px-2 sm:px-4 py-2 sm:py-3 text-center text-xs sm:text-sm font-semibold text-white">🍷 Abierta 1</th>';
            if (anyHasExtra) {
                html += '<th class="px-2 sm:px-4 py-2 sm:py-3 text-center text-xs sm:text-sm font-semibold text-white">🍷+ Más</th>';
            }
            html += '</tr></thead><tbody class="divide-y divide-gray-200">';

            filteredProducts.forEach(product => {
                const areaData = (inventarioConteo[product.id] && inventarioConteo[product.id][selectedArea]) || { enteras: 0, abiertas: [] };
                const enteras = areaData.enteras || 0;
                const abierta1 = (areaData.abiertas && areaData.abiertas.length > 0) ? areaData.abiertas[0] : null;
                const extraAbiertas = (areaData.abiertas && areaData.abiertas.length > 1)
                    ? areaData.abiertas.slice(1).map((v, i) => 'A' + (i + 2) + ': ' + v).join(' | ')
                    : '';

                const hasData = enteras > 0 || (areaData.abiertas && areaData.abiertas.some(a => a > 0));
                const rowBg = hasData ? 'bg-purple-50 hover:bg-purple-100' : 'hover:bg-purple-50';

                html += '<tr class="' + rowBg + ' transition-colors cursor-pointer active:bg-purple-100" onclick="openInventarioModal(\'' + product.id + '\')">';
                html += '<td class="px-2 sm:px-4 py-3 font-medium text-gray-900 text-xs sm:text-sm">';
                html += '<div>' + product.name + '</div>';
                html += '<div class="text-xs text-gray-400">' + product.group + '</div>';
                html += '</td>';
                html += '<td class="px-2 sm:px-4 py-3 text-center font-bold ' + (enteras > 0 ? 'text-purple-700' : 'text-gray-300') + ' text-sm sm:text-base">' + (enteras > 0 ? enteras : '—') + '</td>';
                html += '<td class="px-2 sm:px-4 py-3 text-center font-semibold ' + (abierta1 !== null && abierta1 > 0 ? 'text-orange-600' : 'text-gray-300') + ' text-sm sm:text-base">' + (abierta1 !== null && abierta1 > 0 ? abierta1 : '—') + '</td>';
                if (anyHasExtra) {
                    html += '<td class="px-2 sm:px-4 py-3 text-center text-xs text-orange-500 font-medium">' + (extraAbiertas || '—') + '</td>';
                }
                html += '</tr>';
            });

            html += '</tbody></table></div></div>';
            return html;
        }

        function renderHistoriaTab() {
            if (inventories.length === 0) {
                return '<div class="bg-white rounded-2xl p-12 text-center shadow-md"><svg class="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><p class="text-gray-600">No hay inventarios guardados</p></div>';
            }
            
            // MODIFICACIÓN: Vista compacta con expansión al hacer clic
            let html = '<div class="space-y-4">';
            inventories.forEach(inv => {
                const isExpanded = expandedInventories.has(inv.id);
                
                html += '<div class="bg-white rounded-2xl shadow-md overflow-hidden">';
                
                // Header con descripción y botones
                html += '<div class="p-4 sm:p-6 cursor-pointer hover:bg-gray-50 transition-colors" onclick="toggleInventory(\'' + inv.id + '\')">';
                html += '<div class="flex items-center justify-between gap-4">';
                html += '<div class="flex-1">';
                html += '<div class="flex items-center gap-3 mb-1">';
                html += '<h3 class="text-lg font-bold text-gray-900">' + inv.id + '</h3>';
                html += '<span class="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-full font-medium">' + areas[inv.area] + '</span>';
                html += '</div>';
                html += '<p class="text-sm text-gray-600">' + inv.date + ' • ' + inv.products.length + ' productos • Total: ' + inv.totalProducts.toFixed(2) + '</p>';
                html += '</div>';
                
                // Botones de acción
                html += '<div class="flex items-center gap-2">';
                html += '<button onclick="event.stopPropagation(); downloadInventory(\'' + inv.id + '\')" class="p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95" title="Descargar"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg></button>';
                html += '<button onclick="event.stopPropagation(); shareInventoryWhatsApp(\'' + inv.id + '\')" class="p-2.5 bg-gradient-to-br from-green-500 to-emerald-500 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95" title="Compartir"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg></button>';
                html += '<svg class="w-5 h-5 text-gray-600 transition-transform ' + (isExpanded ? 'rotate-180' : '') + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';
                html += '</div>';
                html += '</div>';
                html += '</div>';
                
                // Tabla expandible
                if (isExpanded) {
                    html += '<div class="border-t border-gray-200 p-4 sm:p-6 bg-gray-50 animate-fadeIn">';
                    html += '<div class="overflow-x-auto">';
                    html += '<table class="w-full"><thead class="bg-gradient-to-r from-purple-600 to-blue-600"><tr><th class="px-4 py-3 text-left text-sm font-semibold text-white">Producto</th><th class="px-4 py-3 text-center text-sm font-semibold text-white">Stock</th><th class="px-4 py-3 text-center text-sm font-semibold text-white">Grupo</th></tr></thead><tbody class="divide-y divide-gray-200 bg-white">';
                    
                    inv.products.forEach(p => {
                        html += '<tr><td class="px-4 py-3 text-gray-900">' + p.name + '</td><td class="px-4 py-3 text-center text-gray-600">' + p.stock + ' ' + p.unit + '</td><td class="px-4 py-3 text-center font-semibold text-gray-900">' + p.group + '</td></tr>';
                    });
                    
                    html += '</tbody></table>';
                    html += '</div>';
                    html += '</div>';
                }
                
                html += '</div>';
            });
            html += '</div>';
            
            return html;
        }

        function toggleInventory(invId) {
            if (expandedInventories.has(invId)) {
                expandedInventories.delete(invId);
            } else {
                expandedInventories.add(invId);
            }
            saveToLocalStorage();
            renderTab();
        }

        function downloadInventory(invId) {
            const inv = inventories.find(i => i.id === invId);
            if (!inv) return;

            const headers = ['Producto', 'Stock', 'Unidad', 'Grupo'];
            const rows = inv.products.map(p => [
                p.name,
                p.stock,
                p.unit,
                p.group
            ]);
            
            const csv = [headers].concat(rows).map(row => row.join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // BUG 6 FIX: sanitizar el nombre del archivo eliminando caracteres inválidos (comas, espacios, etc.)
            const safeDate = inv.date.replace(/[/:,\s]/g, '-').replace(/-+/g, '-').replace(/-$/, '');
            a.download = inv.id + '_' + safeDate + '.csv';
            a.click();
            showNotification('Inventario descargado');
        }

        function shareInventoryWhatsApp(invId) {
            const inv = inventories.find(i => i.id === invId);
            if (!inv) return;

            let message = '*INVENTARIO ' + inv.id + '*\n';
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            message += '📅 *Fecha:* ' + inv.date + '\n';
            // BUG 7 FIX: acceso seguro a areas[] por si inv.area es undefined en snapshots antiguos
            message += '📍 *Área:* ' + (areas[inv.area] || inv.area || 'N/A') + '\n';
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            message += '*PRODUCTOS:*\n';
            inv.products.forEach((p, i) => {
                message += (i + 1) + '. ' + p.name + '\n';
                message += '   • Stock: ' + p.stock + ' ' + p.unit + '\n';
                message += '   • Grupo: ' + p.group + '\n\n';
            });
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            message += '📦 *Total Stock:* ' + inv.totalProducts.toFixed(2) + '\n';

            const url = 'https://wa.me/?text=' + encodeURIComponent(message);
            window.open(url, '_blank');
        }

        function generateProductId() {
            // Busca el número más alto entre IDs existentes para evitar colisiones al eliminar/reordenar
            let maxNum = 0;
            products.forEach(p => {
                const match = p.id.match(/^PRD-(\d+)$/);
                if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
            });
            return 'PRD-' + String(maxNum + 1).padStart(3, '0');
        }

        function openProductModal(productId) {
            const modal = document.getElementById('productModal');
            const title = document.getElementById('productModalTitle');
            
            // Limpiar el modal primero
            document.getElementById('productId').value = '';
            document.getElementById('productName').value = '';
            document.getElementById('productUnit').value = 'Botellas';
            document.getElementById('productGroup').value = '';
            document.getElementById('productStock').value = '0';
            document.getElementById('productMinStock').value = '0';
            
            if (productId) {
                const product = products.find(p => p.id === productId);
                if (product) {
                    editingProductId = product.id;
                    title.textContent = 'Editar Producto';
                    // Cargar todos los datos del producto
                    document.getElementById('productId').value = product.id;
                    document.getElementById('productName').value = product.name || '';
                    document.getElementById('productUnit').value = product.unit || 'Botellas';
                    document.getElementById('productGroup').value = product.group || '';
                    document.getElementById('productStock').value = getTotalStock(product) || 0;
                    document.getElementById('productMinStock').value = product.minStock || 0;
                } else {
                    showNotification('Producto no encontrado');
                    return;
                }
            } else {
                editingProductId = null;
                title.textContent = 'Agregar Producto';
                document.getElementById('productId').value = generateProductId();
            }
            
            modal.classList.remove('hidden');
        }

        function closeProductModal() {
            document.getElementById('productModal').classList.add('hidden');
            editingProductId = null;
        }

        function saveProduct() {
            const name = document.getElementById('productName').value.trim();
            if (!name) {
                showNotification('La descripción es requerida');
                return;
            }

            let productId = document.getElementById('productId').value.trim();
            
            // Si no hay ID, generar uno automáticamente
            if (!productId) {
                productId = generateProductId();
            }

            // Validar que el ID no sea duplicado (excepto si es el mismo producto en edición)
            const idExists = products.some(p => p.id === productId && p.id !== editingProductId);
            if (idExists) {
                showNotification('El ID ya existe');
                return;
            }

            const unit = document.getElementById('productUnit').value;
            const group = document.getElementById('productGroup').value.trim() || 'General';
            const totalStock = parseFloat(document.getElementById('productStock').value) || 0;
            const minStock = parseFloat(document.getElementById('productMinStock').value) || 0;

            if (editingProductId) {
                const product = products.find(p => p.id === editingProductId);
                if (product) {
                    // Mantener la distribución proporcional del stock
                    const currentTotal = getTotalStock(product);
                    const ratio = currentTotal > 0 ? totalStock / currentTotal : 1;
                    
                    // BUG 2 FIX: Si el ID cambió, migrar el conteo de botellas al nuevo ID
                    if (editingProductId !== productId) {
                        if (inventarioConteo[editingProductId]) {
                            inventarioConteo[productId] = inventarioConteo[editingProductId];
                            delete inventarioConteo[editingProductId];
                        }
                    }

                    product.id = productId;
                    product.name = name;
                    product.unit = unit;
                    product.group = group;
                    product.minStock = minStock;
                    
                    if (ratio !== 1) {
                        product.stockByArea.almacen = product.stockByArea.almacen * ratio;
                        product.stockByArea.barra1 = product.stockByArea.barra1 * ratio;
                        product.stockByArea.barra2 = product.stockByArea.barra2 * ratio;
                    }
                }
                showNotification('Producto actualizado');
            } else {
                const newProduct = {
                    id: productId,
                    name: name,
                    unit: unit,
                    group: group,
                    minStock: minStock,
                    stockByArea: {
                        almacen: totalStock,
                        barra1: 0,
                        barra2: 0
                    }
                };
                products.push(newProduct);
                showNotification('Producto agregado');
            }

            saveToLocalStorage();
            closeProductModal();
            renderTab();
        }

        function editProduct(id) {
            openProductModal(id);
        }

        function deleteProduct(id) {
            if (confirm('¿Está seguro de eliminar este producto?')) {
                products = products.filter(p => p.id !== id);
                cart = cart.filter(item => item.id !== id);
                // BUG 3 FIX: limpiar conteo de botellas huérfano
                delete inventarioConteo[id];
                saveToLocalStorage();
                showNotification('Producto eliminado');
                renderTab();
            }
        }

        function deleteAllProducts() {
            if (products.length === 0) {
                showNotification('No hay productos para eliminar');
                return;
            }
            
            if (confirm('¿Está seguro de que desea eliminar TODOS los productos? Esta acción no se puede deshacer.')) {
                products = [];
                cart = [];
                // BUG 4 FIX: limpiar todo el conteo de botellas
                inventarioConteo = {};
                saveToLocalStorage();
                showNotification('Todos los productos han sido eliminados');
                renderTab();
            }
        }

        function filterByGroup() {
            let filtered = products;
            
            if (selectedGroup !== 'Todos') {
                filtered = filtered.filter(p => p.group === selectedGroup);
            }
            
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                filtered = filtered.filter(p => 
                    p.name.toLowerCase().includes(term) || 
                    p.id.toLowerCase().includes(term)
                );
            }
            
            return filtered;
        }

        function addToCart(productId) {
            const product = products.find(p => p.id === productId);
            if (!product) return;

            const existingItem = cart.find(item => item.id === productId);
            if (existingItem) {
                existingItem.quantity++;
            } else {
                cart.push({
                    id: product.id,
                    name: product.name,
                    unit: product.unit,
                    group: product.group,
                    quantity: 1
                });
            }
            
            saveToLocalStorage();
            showNotification(product.name + ' agregado al carrito');
            updateHeaderActions();
        }

        function openOrderModal() {
            if (cart.length === 0) {
                showNotification('Agrega productos al carrito primero');
                return;
            }

            document.getElementById('orderSupplier').value = '';
            document.getElementById('orderDeliveryDate').value = '';
            document.getElementById('orderNote').value = '';
            document.getElementById('orderModal').classList.remove('hidden');
            
            renderOrderTable();
        }

        function closeOrderModal() {
            document.getElementById('orderModal').classList.add('hidden');
        }

        function renderOrderTable() {
            const tbody = document.getElementById('orderProductsTable');
            const emptyCart = document.getElementById('emptyCart');
            const orderTotal = document.getElementById('orderTotal');
            
            if (cart.length === 0) {
                tbody.innerHTML = '';
                emptyCart.classList.remove('hidden');
                orderTotal.textContent = 'Total: 0';
                return;
            }

            emptyCart.classList.add('hidden');
            let html = '';
            let total = 0;

            cart.forEach(item => {
                total += item.quantity;
                html += '<tr><td class="px-4 py-3 text-gray-900">' + item.name + '</td><td class="px-4 py-3 text-center text-gray-600">' + item.unit + '</td><td class="px-4 py-3 text-center"><input type="number" value="' + item.quantity + '" min="0.01" step="0.01" onchange="updateCartQuantity(\'' + item.id + '\', this.value)" class="w-20 px-2 py-1 text-center bg-white text-gray-900 border border-gray-200 rounded focus:ring-2 focus:ring-purple-500 font-semibold"></td><td class="px-4 py-3 text-center"><button onclick="removeFromCart(\'' + item.id + '\')" class="p-2 bg-gradient-to-br from-red-500 to-orange-500 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></td></tr>';
            });

            tbody.innerHTML = html;
            orderTotal.textContent = 'Total: ' + total.toFixed(2);
        }

        function updateCartQuantity(productId, quantity) {
            const item = cart.find(i => i.id === productId);
            if (item) {
                item.quantity = Math.max(0.01, parseFloat(quantity) || 0.01);
                saveToLocalStorage();
                renderOrderTable();
            }
        }

        function removeFromCart(productId) {
            cart = cart.filter(item => item.id !== productId);
            saveToLocalStorage();
            renderOrderTable();
            updateHeaderActions();
            if (cart.length === 0) {
                showNotification('Carrito vacío');
            }
        }

        function createOrder() {
            const supplier = document.getElementById('orderSupplier').value.trim();
            if (!supplier) {
                showNotification('El proveedor es requerido');
                return;
            }

            if (cart.length === 0) {
                showNotification('Agrega productos al carrito');
                return;
            }

            const deliveryDate = document.getElementById('orderDeliveryDate').value;
            const note = document.getElementById('orderNote').value.trim();

            const order = {
                id: 'PED-' + String(orders.length + 1).padStart(3, '0'),
                date: new Date().toLocaleString(),
                supplier: supplier,
                deliveryDate: deliveryDate || null,
                note: note || null,
                products: [...cart],
                total: cart.reduce((sum, item) => sum + item.quantity, 0)
            };

            orders.push(order);
            saveToLocalStorage();
            
            shareOrderWhatsApp(order.id);
            
            cart = [];
            saveToLocalStorage();
            closeOrderModal();
            showNotification('Pedido creado');
            updateHeaderActions();
        }

        function deleteOrder(orderId) {
            if (confirm('¿Está seguro de eliminar este pedido?')) {
                orders = orders.filter(o => o.id !== orderId);
                saveToLocalStorage();
                showNotification('Pedido eliminado');
                renderTab();
            }
        }

        function deleteAllOrders() {
            if (orders.length === 0) {
                showNotification('No hay pedidos para eliminar');
                return;
            }
            
            if (confirm('¿Está seguro de que desea eliminar TODOS los pedidos? Esta acción no se puede deshacer.')) {
                orders = [];
                saveToLocalStorage();
                showNotification('Todos los pedidos han sido eliminados');
                renderTab();
            }
        }

        function shareOrderWhatsApp(orderId) {
            const order = orders.find(o => o.id === orderId);
            if (!order) return;

            let message = '*PEDIDO BARRA ' + order.id + '*\n';
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            message += '📋 *Proveedor:* ' + order.supplier + '\n';
            message += '🗓️ *Fecha:* ' + order.date + '\n';
            if (order.deliveryDate) {
                message += '🚚 *Entrega:* ' + order.deliveryDate + '\n';
            }
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            message += '*PRODUCTOS:*\n';
            order.products.forEach((p, i) => {
                message += (i + 1) + '. ' + p.name + '\n';
                message += '   • Cantidad: ' + p.quantity + ' ' + p.unit + '\n';
           
            });
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            message += '📦 *Total Productos:* ' + order.total.toFixed(2) + '\n';
            if (order.note) {
                message += '\n💬 *Nota:*\n' + order.note + '\n';
            }

            const url = 'https://wa.me/?text=' + encodeURIComponent(message);
            window.open(url, '_blank');
        }

        function updateStock(id, change) {
            const product = products.find(p => p.id === id);
            if (product) {
                product.stockByArea[selectedArea] = Math.max(0, product.stockByArea[selectedArea] + change);
                saveToLocalStorage();
                renderTab();
            }
        }

        function updateStockDirect(id, value) {
            const product = products.find(p => p.id === id);
            if (product) {
                const numValue = Math.max(0, parseFloat(value) || 0);
                product.stockByArea[selectedArea] = numValue;
                // Guardar inmediatamente en localStorage
                saveToLocalStorage();
            }
        }

        function saveInventorySnapshot() {
            const snapshot = {
                id: 'INV-' + String(inventories.length + 1).padStart(3, '0'),
                date: new Date().toLocaleString(),
                area: selectedArea,
                products: products.map(p => ({
                    id: p.id,
                    name: p.name,
                    stock: p.stockByArea[selectedArea],
                    unit: p.unit,
                    group: p.group
                })),
                totalProducts: products.reduce((sum, p) => sum + p.stockByArea[selectedArea], 0)
            };
            inventories.push(snapshot);
            saveToLocalStorage();
            showNotification('Inventario de ' + areas[selectedArea] + ' guardado');
        }

        function handleFileImport(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(firstSheet);

                    if (!jsonData || jsonData.length === 0) {
                        showNotification('El archivo no contiene datos válidos');
                        return;
                    }

                    const importedProducts = jsonData.map((row, index) => {
                        return {
                            id: String(row['ID'] || row['id'] || 'PRD-' + String(products.length + index + 1).padStart(3, '0')),
                            name: String(row['Descripción'] || row['descripcion'] || row['Producto'] || row['producto'] || 'Sin nombre'),
                            stockByArea: {
                                almacen: parseFloat(row['Cantidad'] || row['cantidad'] || row['Stock'] || row['stock'] || 0) || 0,
                                barra1: 0,
                                barra2: 0
                            },
                            unit: String(row['Unidad'] || row['unidad'] || row['Medida'] || row['medida'] || 'Unidades'),
                            group: String(row['Grupo'] || row['grupo'] || 'General'),
                            minStock: 0
                        };
                    });

                    products = products.concat(importedProducts);
                    saveToLocalStorage();
                    showNotification(importedProducts.length + ' productos importados correctamente');
                    
                    // Resetear filtros y cambiar a tab inicio para ver los productos
                    activeTab = 'inicio';
                    selectedGroup = 'Todos';
                    searchTerm = '';
                    selectedArea = 'almacen';
                    
                    // Actualizar todo
                    renderTab();
                    event.target.value = '';
                } catch (error) {
                    showNotification('Error al importar archivo: ' + error.message);
                    console.error(error);
                }
            };
            reader.readAsArrayBuffer(file);
        }

        function exportToExcel() {
            const areaKeys = ['almacen', 'barra1', 'barra2'];
            const areaNames = { almacen: 'Almacén', barra1: 'Barra 1', barra2: 'Barra 2' };

            // Calcular máximo de botellas abiertas por área para construir headers dinámicos
            const maxAbiertas = { almacen: 1, barra1: 1, barra2: 1 };
            products.forEach(p => {
                areaKeys.forEach(area => {
                    const d = inventarioConteo[p.id] && inventarioConteo[p.id][area];
                    if (d && d.abiertas) maxAbiertas[area] = Math.max(maxAbiertas[area], d.abiertas.length);
                });
            });

            // Construir headers
            const headers = ['Producto', 'Grupo', 'Unidad'];
            areaKeys.forEach(area => {
                headers.push(areaNames[area] + ' – Bot. Entera');
                for (let i = 1; i <= maxAbiertas[area]; i++) {
                    headers.push(areaNames[area] + ' – Bot. Abierta ' + i);
                }
            });

            // Construir filas
            const rows = products.map(p => {
                const row = [p.name, p.group, p.unit];
                areaKeys.forEach(area => {
                    const d = (inventarioConteo[p.id] && inventarioConteo[p.id][area]) || { enteras: 0, abiertas: [] };
                    row.push(d.enteras || 0);
                    for (let i = 0; i < maxAbiertas[area]; i++) {
                        row.push((d.abiertas && d.abiertas[i] !== undefined) ? d.abiertas[i] : 0);
                    }
                });
                return row;
            });

            const csv = [headers].concat(rows).map(row =>
                row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')
            ).join('\n');

            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'inventario_' + new Date().toISOString().split('T')[0] + '.csv';
            a.click();
            showNotification('Datos exportados con desglose por área');
        }

        document.getElementById('fileInput').addEventListener('change', handleFileImport);

        window.addEventListener('DOMContentLoaded', initializeApp);
    </script>
</body>
</html>
