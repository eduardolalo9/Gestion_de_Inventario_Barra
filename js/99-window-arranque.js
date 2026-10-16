        function importFullData(event) {
            // v5.26 (hallazgo #7, Cero Pérdida de Datos) — esta función reemplaza
            // TODO el estado local (catálogo, pedidos, inventarios, auditoría…) con
            // lo que venga en el JSON, y hasta ahora no pedía ningún permiso: el
            // botón "Importar datos" del menú lateral es visible para cualquier
            // autenticado (a diferencia de "Panel Admin"/"Papelera", que sí se
            // ocultan), así que cualquier bartender podía borrar el inventario de
            // todos con un archivo cualquiera. Mismo candado que ya usa
            // restaurarBackup() para la misma clase de operación.
            if (!hasPermission('settings.update')) {
                showNotification('⚠️ No tienes permiso para importar datos');
                event.target.value = '';
                return;
            }
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = JSON.parse(e.target.result);
                    // Validar estructura básica
                    if (!Array.isArray(data.products) || !Array.isArray(data.orders) || !Array.isArray(data.inventories) || !Array.isArray(data.cart) || (data.inventarioConteo !== null && data.inventarioConteo !== undefined && typeof data.inventarioConteo !== 'object')) {
                        showNotification('El archivo no tiene el formato correcto');
                        return;
                    }
                    showConfirm('¿Estás seguro de reemplazar todos los datos actuales con los del archivo?', function() {
                        // v5.26 (hallazgo #7) — antes no quedaba ningún respaldo
                        // previo: si el JSON traía basura, no había forma de volver
                        // al estado de antes salvo que otro dispositivo aún no
                        // hubiera sincronizado. Mismo patrón que cada import de
                        // Excel (recetario/compras/ventas): respaldar justo antes.
                        if (typeof _crearBackupNombrado === 'function') _crearBackupNombrado('pre_importacion_json_' + Date.now());
                        products = data.products;
                        orders = data.orders;
                        inventories = data.inventories;
                        cart = data.cart;

                        // CORRECCIÓN BUG 3: aplicar la misma migración de formato que
                        // loadFromLocalStorage usa, para soportar backups de versiones antiguas
                        // donde inventarioConteo era plano { productId: { enteras, abiertas } }
                        // en lugar del nuevo formato por área { productId: { almacen: {...}, ... } }
                        const rawConteo = data.inventarioConteo || {};
                        const migrated = {};
                        Object.keys(rawConteo).forEach(prodId => {
                            const val = rawConteo[prodId];
                            if (!val || typeof val !== 'object') return;
                            if (typeof val.enteras !== 'undefined' && val.almacen === undefined && val.barra1 === undefined && val.barra2 === undefined) {  // BUG-FIX M3: usar === undefined para no fallar cuando area vale 0
                                migrated[prodId] = { almacen: val };
                            } else {
                                migrated[prodId] = val;
                            }
                        });
                        inventarioConteo = migrated;
                        // FIX 1 — reconstruir stockByArea después de importar
                        syncStockByAreaFromConteo();

                        // Bug #3 fix: restaurar campos de auditoría si existen en el backup
                        if (data.auditoriaConteo && typeof data.auditoriaConteo === 'object')
                            auditoriaConteo = data.auditoriaConteo;
                        // Restaurar conteos multiusuario si el backup los contiene
                        if (data.auditoriaConteoPorUsuario && typeof data.auditoriaConteoPorUsuario === 'object')
                            auditoriaConteoPorUsuario = data.auditoriaConteoPorUsuario;
                        if (data.auditoriaStatus && typeof data.auditoriaStatus === 'object')
                            auditoriaStatus = data.auditoriaStatus;
                        auditoriaView       = data.auditoriaView       || 'selection';
                        auditoriaAreaActiva = data.auditoriaAreaActiva || null;
                        isAuditoriaMode     = (auditoriaView === 'counting' && !!auditoriaAreaActiva);
                        // BUG-10 FIX: restaurar conteo propio del usuario desde backup
                        if (data.myAuditoriaConteo && typeof data.myAuditoriaConteo === 'object')
                            myAuditoriaConteo = data.myAuditoriaConteo;
                        if (data.myAuditoriaStatus && typeof data.myAuditoriaStatus === 'object')
                            myAuditoriaStatus = data.myAuditoriaStatus;
                        if (data.myAuditoriaUnlocks && typeof data.myAuditoriaUnlocks === 'object')
                            myAuditoriaUnlocks = data.myAuditoriaUnlocks;
                        if (data._auditoriaSessionId) _auditoriaSessionId = data._auditoriaSessionId;

                        activeTab = data.activeTab || 'inicio';
                        searchTerm = '';   // FASE 6: un respaldo no trae la búsqueda aplicada
                        selectedGroup = data.selectedGroup || 'Todos';
                        selectedArea = data.selectedArea || AREAS_CONTEO[0] || 'almacen';   // R6
                        expandedInventories = new Set(data.expandedInventories || []);

                        saveToLocalStorage();
                        switchTab(activeTab);
                        showNotification('Datos importados correctamente');
                    });
                } catch (error) {
                    showNotification('Error al leer el archivo: ' + error.message);
                    console.error(error);
                }
                event.target.value = ''; // Limpiar input
            };
            reader.readAsText(file);
        }

        // ══════════════════════════════════════════════════════════════════════
        //  EXPONER FUNCIONES CRÍTICAS EN window
        //  Garantiza acceso cross-script desde el auth IIFE cuando Firebase
        //  dispara onAuthStateChanged de forma asíncrona.
        // ══════════════════════════════════════════════════════════════════════
        window.loadUserRole             = loadUserRole;
        window.syncToCloud              = syncToCloud;
        window.loadFromCloud            = loadFromCloud;
        window.renderTab                = renderTab;
        window.showNotification         = showNotification;
        window.isAdmin                  = isAdmin;
        window.saveToLocalStorage       = saveToLocalStorage;
        window.subscribeMainDoc         = subscribeMainDoc;
        window.subscribeMyAuditoria     = subscribeMyAuditoria;
        window.subscribeAllUsersAuditoria = subscribeAllUsersAuditoria;

        // ==================== INICIALIZACIÓN UNIFICADA ====================
        // Un único listener DOMContentLoaded que centraliza toda la lógica de arranque
        // (incluye el patch de seguridad que antes era un bloque separado).
        // CORRECCIÓN BUG 6: los listeners de fileInput e importDataInput se registran
        // aquí dentro (no a nivel de script suelto) para garantizar que los elementos
        // ya existen en el DOM independientemente de dónde esté colocado el <script>.
        window.addEventListener('DOMContentLoaded', function() {
            // --- Inicializar tema antes que todo lo demás ---
            initTheme();

            // --- Listeners de archivos ---
            document.getElementById('fileInput').addEventListener('change', function(e) { window.handleFileImport(e); });
            document.getElementById('importDataInput').addEventListener('change', function(e) { window.importFullData(e); });
            // FASE 4B — input propio de compras (nunca comparte #fileInput con el catálogo).
            const fileInputCompras = document.getElementById('fileInputCompras');
            if (fileInputCompras) fileInputCompras.addEventListener('change', function(e) { window.handleFileImportCompras(e); });
            // RECETARIO-2 — mismo criterio: input propio, nunca comparte #fileInput.
            const fileInputRecetario = document.getElementById('fileInputRecetario');
            if (fileInputRecetario) fileInputRecetario.addEventListener('change', function(e) { window.handleFileImportRecetario(e); });
            // FASE 10 — input propio del reporte de ventas del POS.
            const fileInputVentas = document.getElementById('fileInputVentas');
            if (fileInputVentas) fileInputVentas.addEventListener('change', function(e) { window.handleFileImportVentas(e); });

            // --- App principal ---
            // R6: la configuracion de areas se carga antes que nada. Si se
            // cargara despues, el primer render usaria las tres por defecto.
            if (typeof cargarAreasLocal === 'function') cargarAreasLocal();
            initializeApp();

            // --- Patch de seguridad: guardar referencia a exportToExcel DESPUÉS de que initializeApp la defina ---
            let exportingExcel = false;
            const originalExport = window.exportToExcel;
            if (originalExport) {
                window.exportToExcel = function(modo) {
                    // FIX #14: showNotification en lugar de alert() nativo bloqueante
                    if (exportingExcel) { showNotification('⏳ Exportación en proceso…'); return; }
                    exportingExcel = true;
                    try { originalExport(modo); } catch(e) { showNotification('❌ Error al exportar Excel'); console.error(e); }
                    setTimeout(() => exportingExcel = false, 3000);
                };
            }

            const originalImport = window.handleFileImport;
            if (originalImport) {
                window.handleFileImport = function(e) {
                    // FIX #14: showNotification en lugar de alert() nativo bloqueante
                    try { originalImport(e); } catch(err) { showNotification('❌ Archivo Excel inválido o corrupto'); console.error(err); }
                };
            }

            // --- Auto-guardado inteligente (mínimo 30s entre guardados en local) ---
            // syncToCloud ya NO se llama aquí directamente.
            // saveToLocalStorage() calcula el hash y solo sincroniza si algo cambió.
            let lastSave = 0;
            function smartAutoSave() {
                const now = Date.now();
                if (now - lastSave < 30000) return; // 30s mínimo entre autoguardados
                lastSave = now;
                if (window.saveToLocalStorage) {
                    try { saveToLocalStorage(); } catch(e) { console.warn('Error guardando'); }
                }
            }
            // ═══ FIX #6b: Guardar referencia para cleanup en logout ═══
            window._autoSaveInterval = setInterval(smartAutoSave, 30000);
        });
    