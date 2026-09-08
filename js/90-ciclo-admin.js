        function handleFileImport(event) {
            const file = event.target.files[0];
            if (!file) return;
            // ═══ FIX #3: Verificar que XLSX esté cargado (tiene defer) ═══
            // El script de SheetJS usa defer → puede no estar listo si el usuario
            // intenta importar muy rápido tras cargar la página.
            if (typeof XLSX === 'undefined') {
                showNotification('⏳ Cargando librería Excel... intenta en unos segundos');
                event.target.value = '';
                return;
            }
            const fileInput = event.target;
            // ── RESPALDO AUTOMÁTICO antes de importar ────────────────────────
            // Si la importación falla o trae datos incorrectos, el usuario puede
            // restaurar el estado anterior desde el panel de respaldos.
            _crearBackupNombrado('pre_importacion_' + Date.now());
            _registrarEnSyncQueue({
                tipo:    'importacion_excel',
                detalle: 'Importación desde archivo: ' + (file.name || 'desconocido'),
                usuario: (auditCurrentUser ? auditCurrentUser.userName : null) || currentUserUid || 'local',
                uid:     currentUserUid || null
            });
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    if (!workbook.SheetNames || workbook.SheetNames.length === 0) { showNotification('El archivo no contiene hojas válidas'); return; }
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    if (!firstSheet) { showNotification('La primera hoja del archivo está vacía o es inválida'); return; }
                    const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                    if (!jsonData || jsonData.length === 0) { showNotification('El archivo no contiene datos válidos'); return; }

                    // ── Mapeo flexible de columnas ───────────────────────────
                    // Acepta variantes de nombre para mayor compatibilidad
                    const columnMap = {
                        id:                 ['ID', 'Id', 'id', 'Código', 'codigo'],
                        name:               ['Nombre', 'Descripción', 'descripcion', 'Producto', 'producto', 'nombre'],
                        unit:               ['Unidad', 'unidad', 'Medida', 'medida'],
                        group:              ['Grupo', 'grupo', 'Categoría', 'categoria'],
                        stock:              ['Cantidad', 'cantidad', 'Stock', 'stock', 'Enteras'],
                        // ── Campos de conversión oz→puntos ──
                        // IMPORTANTE: se leen con parseFloat + null (no parseExcelNumber)
                        // para respetar exactamente los nombres del Excel exportado
                        capacidadMl:        ['CapacidadML', 'capacidadMl', 'CapacidadMl', 'Capacidad_ML', 'CapML'],
                        pesoBotellaLlenaOz: ['PesoBotellaOz', 'pesoBotellaOz', 'PesoLlenaOz', 'PesoBotella_Oz', 'PesoOz']
                    };

                    // ── Helper: buscar valor en la fila por mapa de claves ───
                    function findCol(row, keys) {
                        for (const key of keys) {
                            if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
                                return row[key];
                            }
                        }
                        return undefined;
                    }

                    const existingIds = new Set(products.map(p => p.id));
                    let maxNum = 0;
                    products.forEach(p => { const m = p.id.match(/^PRD-(\d+)$/); if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10)); });
                    let nextNum = maxNum + 1;
                    const toImport = [];
                    const usedInBatch = new Set();
                    let skipped = 0;
                    let valoresCorregidos = 0; // FIX AUDITORÍA MAESTRA: cuántas filas traían un valor no físico (negativo/cero) que se descartó

                    jsonData.forEach((row) => {
                        // ── Nombre (obligatorio) ──────────────────────────────
                        const nameRaw = findCol(row, columnMap.name);
                        const name = nameRaw !== undefined ? String(nameRaw).trim() : '';
                        if (!name) { skipped++; return; }

                        // ── ID ────────────────────────────────────────────────
                        const rawId = findCol(row, columnMap.id);
                        let id = rawId !== undefined ? String(rawId).trim() : '';
                        if (!id) {
                            do { id = 'PRD-' + String(nextNum++).padStart(3, '0'); } while (existingIds.has(id) || usedInBatch.has(id));
                        } else {
                            if (existingIds.has(id) || usedInBatch.has(id)) {
                                do { id = 'PRD-' + String(nextNum++).padStart(3, '0'); } while (existingIds.has(id) || usedInBatch.has(id));
                            }
                        }
                        usedInBatch.add(id);

                        // ── Unidad ────────────────────────────────────────────
                        const unitRaw = findCol(row, columnMap.unit);
                        const unit = unitRaw !== undefined ? String(unitRaw).trim() : 'Unidad';

                        // ── Grupo ─────────────────────────────────────────────
                        const groupRaw = findCol(row, columnMap.group);
                        const group = groupRaw !== undefined ? String(groupRaw).trim() : 'General';

                        // ── Stock (enteras almacén) ──────────────────────────
                        // FIX AUDITORÍA MAESTRA (Sección 20 — "no permitir
                        // valores negativos"): parseExcelNumber ya descarta
                        // NaN/Infinity/fechas, pero SÍ dejaba pasar negativos
                        // legítimos (ej. "-5" en una celda) directo al
                        // inventario. Un stock negativo no tiene sentido
                        // físico y corrompería calcularStockTotal() /
                        // calcularTotalMultiUsuario() aguas abajo.
                        const stockRaw = findCol(row, columnMap.stock);
                        let stock = stockRaw !== undefined ? parseExcelNumber(stockRaw) : 0;
                        if (stock < 0) { stock = 0; valoresCorregidos++; }

                        // ── CapacidadML — parseFloat + null si vacío ─────────
                        // Se usa parseFloat (no parseExcelNumber) para respetar
                        // exactamente el valor numérico del Excel sin conversiones.
                        // FIX AUDITORÍA MAESTRA: una capacidad ≤0 no es físicamente
                        // válida (rompería calcularContenidoMl/calcularStockTotal,
                        // que dividen usando este valor) — se descarta como si no
                        // se hubiera provisto, en vez de dejar pasar 0 o negativo.
                        const capRaw = findCol(row, columnMap.capacidadMl);
                        let capacidadMl = (capRaw !== undefined)
                            ? (isNaN(parseFloat(capRaw)) ? null : parseFloat(capRaw))
                            : null;
                        if (capacidadMl !== null && capacidadMl <= 0) { capacidadMl = null; valoresCorregidos++; }

                        // ── PesoBotellaOz — parseFloat + null si vacío ───────
                        // FIX AUDITORÍA MAESTRA: mismo criterio — un peso ≤0 no
                        // es físicamente válido.
                        const pesoRaw = findCol(row, columnMap.pesoBotellaLlenaOz);
                        let pesoBotellaLlenaOz = (pesoRaw !== undefined)
                            ? (isNaN(parseFloat(pesoRaw)) ? null : parseFloat(pesoRaw))
                            : null;
                        if (pesoBotellaLlenaOz !== null && pesoBotellaLlenaOz <= 0) { pesoBotellaLlenaOz = null; valoresCorregidos++; }

                        // ── Construir producto ────────────────────────────────
                        const product = {
                            id,
                            name,
                            stockByArea: { almacen: stock, barra1: 0, barra2: 0 },
                            unit,
                            group
                        };
                        // Solo añadir si tienen valor real (no null)
                        if (capacidadMl !== null)       product.capacidadMl       = capacidadMl;
                        if (pesoBotellaLlenaOz !== null) product.pesoBotellaLlenaOz = pesoBotellaLlenaOz;

                        toImport.push(product);
                    });

                    products = products.concat(toImport);
                    showNotification(toImport.length + ' productos importados.'
                        + (skipped ? ' ' + skipped + ' filas omitidas por falta de nombre.' : '')
                        + (valoresCorregidos ? ' ⚠️ ' + valoresCorregidos + ' valor(es) no físico(s) (negativo/cero) descartado(s).' : ''));
                    activeTab = 'inicio';
                    selectedGroup = 'Todos';
                    searchTerm = '';
                    selectedArea = 'almacen';
                    saveToLocalStorage();
                    renderTab();
                    fileInput.value = '';
                } catch (error) {
                    showNotification('Error al importar archivo: ' + error.message);
                    console.error(error);
                    fileInput.value = '';
                }
            };
            reader.readAsArrayBuffer(file);
        }

        // ══════════════════════════════════════════════════════════════════════
        //  GESTIÓN DEL CICLO DE INVENTARIO — Funciones públicas para el admin
        // ══════════════════════════════════════════════════════════════════════

        function iniciarCapturaInventario() {
            if (!isAdmin()) { showNotification('⚠️ Solo el administrador puede iniciar la captura'); return; }
            if (inventarioCicloEstado === 'EN_CAPTURA') { showNotification('ℹ️ La captura ya está en progreso'); return; }
            if (inventarioCicloEstado === 'CERRADO') { showNotification('🔒 El inventario está cerrado. Reabre el ciclo primero.'); return; }
            showConfirm('¿Iniciar captura de inventario?\n\nTodos los usuarios podrán registrar conteos.', function() {
                setCicloEstado('EN_CAPTURA');
            });
        }

        function finalizarCapturaInventario() {
            if (!isAdmin()) { showNotification('⚠️ Solo el administrador puede finalizar la captura'); return; }
            if (inventarioCicloEstado !== 'EN_CAPTURA') { showNotification('ℹ️ La captura no está activa'); return; }
            showConfirm('¿Finalizar la captura?\n\nPodrás revisar los resultados antes de cerrar el ciclo.', function() {
                setCicloEstado('FINALIZADO');
            });
        }

        function cerrarCicloInventario() {
            if (!isAdmin()) { showNotification('⚠️ Solo el administrador puede cerrar el ciclo'); return; }
            if (inventarioCicloEstado !== 'FINALIZADO') { showNotification('ℹ️ El ciclo debe estar FINALIZADO para cerrarlo'); return; }
            showConfirm(
                '🔒 ¿CERRAR el ciclo de inventario?\n\nSe bloqueará cualquier modificación.\nSolo el administrador podrá reabrir.\nSe exportará un respaldo automático.',
                function() {
                    try { if (typeof exportToExcel === 'function') exportToExcel('admin'); } catch(_) {}
                    setCicloEstado('CERRADO');
                    showNotification('🔒 Ciclo cerrado. Respaldo creado y exportado.');
                }
            );
        }

        function reabrirCicloInventario() {
            if (!isAdmin()) { showNotification('⚠️ Solo el administrador puede reabrir el ciclo'); return; }
            if (inventarioCicloEstado !== 'CERRADO') { showNotification('ℹ️ El ciclo debe estar CERRADO para reabrir'); return; }
            showConfirm(
                '🔓 ¿Reabrir el ciclo de inventario?\n\nSe iniciará un nuevo ciclo (v' + ((inventarioCicloInfo.version || 1) + 1) + ').\nLos datos anteriores se conservan en los respaldos.',
                function() {
                    setCicloEstado('ABIERTO');
                    showNotification('✅ Ciclo reabierto — v' + inventarioCicloInfo.version + ' iniciado.');
                }
            );
        }

        window.iniciarCapturaInventario   = iniciarCapturaInventario;
        window.finalizarCapturaInventario = finalizarCapturaInventario;
        window.cerrarCicloInventario      = cerrarCicloInventario;
        window.reabrirCicloInventario     = reabrirCicloInventario;
        window.setCicloEstado             = setCicloEstado;
        window.isCicloBloqueado           = isCicloBloqueado;
        window.getInventarioCicloEstado   = function() { return inventarioCicloEstado; };
        window._getPendingSyncCount       = _getPendingSyncCount;
        window.APP_VERSION                = APP_VERSION;
        window.DB_VERSION                 = DB_VERSION;

        // ══════════════════════════════════════════════════════════════════════
        //  FIX-CHANGELOG: Funciones de consulta y exportación del log de cambios
        //  El log registra automáticamente cada cambio al inventario operativo.
        //  Sirve para auditoría: quién cambió qué producto, cuándo y cuánto.
        // ══════════════════════════════════════════════════════════════════════

        /**
         * getChangeLog()
         * Retorna el log de cambios guardado en localStorage.
         * Formato: [{ ts, prodId, prodName, area, valorAntes, valorDespues, usuario, uid }]
         */
        function getChangeLog() {
            try {
                const raw = localStorage.getItem('inventarioApp_changeLog');
                if (!raw) return [];
                const log = JSON.parse(raw);
                return Array.isArray(log) ? log : [];
            } catch (_) { return []; }
        }

        /**
         * exportChangeLogExcel()
         * Exporta el log de cambios a un archivo .xlsx.
         * Accesible desde la consola del navegador: exportChangeLogExcel()
         */
        function exportChangeLogExcel() {
            if (typeof XLSX === 'undefined') {
                showNotification('⚠️ Librería Excel no cargada. Espera un momento y vuelve a intentarlo.');
                return;
            }
            const log = getChangeLog();
            if (log.length === 0) {
                showNotification('ℹ️ No hay cambios registrados en el log.');
                return;
            }
            const headers = ['Fecha/Hora', 'Producto', 'ID Producto', 'Área', 'Antes', 'Después', 'Usuario', 'UID'];
            const rows = log.map(function(e) {
                return [
                    new Date(e.ts).toLocaleString('es-MX'),
                    e.prodName || e.prodId,
                    e.prodId,
                    e.area,
                    e.valorAntes !== null && e.valorAntes !== undefined ? e.valorAntes : '—',
                    e.valorDespues,
                    e.usuario || '—',
                    e.uid || '—'
                ];
            });
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            ws['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 12 }, { wch: 14 },
                           { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 30 }];
            XLSX.utils.book_append_sheet(wb, ws, 'Log de Cambios');
            const fileName = 'log_cambios_inventario_' + new Date().toISOString().split('T')[0] + '.xlsx';
            XLSX.writeFile(wb, fileName);
            showNotification('✅ Log de ' + log.length + ' cambios exportado: ' + fileName);
        }
        // Exponer en window para acceso desde consola de debugging
        window.exportChangeLogExcel = exportChangeLogExcel;