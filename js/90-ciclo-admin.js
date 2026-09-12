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
                        pesoBotellaLlenaOz: ['PesoBotellaOz', 'pesoBotellaOz', 'PesoLlenaOz', 'PesoBotella_Oz', 'PesoOz'],

                        // R1 (regla 14) — columna OPCIONAL. Si el Excel no la trae,
                        // el modo se deduce de tener capacidad y peso, que es como se
                        // ha comportado la app hasta ahora.
                        conteoOz: ['ConteoOz', 'Conteo oz', 'ConteoBotellaOz', 'ContarEnOz', 'Habilitar conteo oz'],

                        // R2 (reglas 2 y 8) — el product_id de Parrot. En la hoja
                        // "Venta" la columna se llama SKU, asi que se aceptan los
                        // dos nombres: son el mismo dato.
                        pv: ['PV', 'SKU', 'PV de venta', 'PVVenta', 'ProductId', 'product_id'],

                        // ── P0: cuatro columnas que el Excel del catalogo YA trae ──
                        // Estaban en Productos_Barra15.xlsx desde siempre y la importacion
                        // las ignoraba, asi que el producto guardado no tenia con que
                        // costear una compra ni calcular un sugerido. Verificado sobre el
                        // archivo real: 424/424 traen Precio, 419 Conversion, 254 Stock
                        // minimo y 424 Proveedor.
                        // OJO: en ese Excel los dos ultimos nombres llevan un espacio
                        // FINAL ('Conversion de producto ', 'Proveedor '). Se aceptan las
                        // dos formas para no depender de que eso se mantenga.
                        precio:      ['Precio', 'precio', 'PrecioUnitario', 'Costo', 'costo'],
                        conversion:  ['Conversion de producto ', 'Conversion de producto',
                                      'Conversion', 'conversion', 'Conversi\u00f3n'],
                        stockMinimo: ['Stock minimo', 'Stock Minimo', 'StockMinimo',
                                      'stockMinimo', 'Minimo', 'M\u00ednimo'],
                        proveedor:   ['Proveedor ', 'Proveedor', 'proveedor']
                    };

                    // ── Helper: buscar valor en la fila por mapa de claves ───
                    //
                    // La coincidencia se hace NORMALIZANDO: sin espacios de sobra, sin
                    // acentos y sin distinguir mayusculas. Motivo real, no teorico:
                    // en Productos_Barra15.xlsx la cabecera del precio es " Precio "
                    // — con un espacio a cada lado — y la del proveedor "Proveedor ".
                    // Con comparacion exacta, esas dos columnas se importaban como
                    // vacias sin que nadie se enterara: no falla nada, simplemente el
                    // dato no llega. Normalizar cubre tambien mayusculas y acentos, que
                    // es la otra forma habitual de que un Excel reexportado deje de
                    // coincidir.
                    function _normCab(s) {
                        return String(s == null ? '' : s)
                            .replace(/\s+/g, ' ').trim().toLowerCase()
                            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    }
                    function findCol(row, keys) {
                        if (!keys) return undefined;
                        // 1) coincidencia exacta — comportamiento de siempre, sin cambios
                        for (const key of keys) {
                            if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
                                return row[key];
                            }
                        }
                        // 2) coincidencia normalizada — solo si la exacta no encontro nada
                        if (!row.__cabNorm) {
                            const mapa = {};
                            Object.keys(row).forEach(function(k) { mapa[_normCab(k)] = k; });
                            Object.defineProperty(row, '__cabNorm',
                                { value: mapa, enumerable: false });
                        }
                        for (const key of keys) {
                            const real = row.__cabNorm[_normCab(key)];
                            if (real !== undefined && row[real] !== undefined
                                && row[real] !== null && row[real] !== '') {
                                return row[real];
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

                        // ── P0: precio, conversion, stock minimo, proveedor ──────
                        // Mismo criterio que capacidadMl: un valor no numerico o
                        // fisicamente imposible se descarta como si no viniera, en vez
                        // de guardarse y corromper un costeo mas adelante.
                        function numeroPositivo(bruto, permitirCero) {
                            if (bruto === undefined || bruto === null || bruto === '') return null;
                            var n = parseFloat(bruto);
                            if (isNaN(n) || !isFinite(n)) return null;
                            if (n < 0) return null;
                            if (n === 0 && !permitirCero) return null;
                            return n;
                        }
                        var precio      = numeroPositivo(findCol(row, columnMap.precio), false);
                        var conversion  = numeroPositivo(findCol(row, columnMap.conversion), false);
                        // El minimo SI puede ser 0: significa 'no se repone'.
                        var stockMinimo = numeroPositivo(findCol(row, columnMap.stockMinimo), true);
                        var provRaw     = findCol(row, columnMap.proveedor);
                        var proveedor   = (provRaw !== undefined && provRaw !== null)
                                          ? String(provRaw).trim() : '';

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

                        // ── R1 (regla 14): modo de conteo ─────────────────────
                        // Sin capacidad y peso no hay conversion posible, asi que el
                        // producto se cuenta con una sola cantidad, pase lo que pase
                        // en la columna. Con los dos datos, manda la columna si viene;
                        // si no viene, se deduce true, que es el comportamiento que la
                        // app ha tenido siempre para un producto con esos datos.
                        var _ozRaw = findCol(row, columnMap.conteoOz);
                        if (capacidadMl === null || pesoBotellaLlenaOz === null) {
                            product.conteoOzHabilitado = false;
                        } else if (_ozRaw === undefined || _ozRaw === null || _ozRaw === '') {
                            product.conteoOzHabilitado = true;
                        } else {
                            var _ozTxt = String(_ozRaw).trim().toLowerCase();
                            product.conteoOzHabilitado =
                                ['1', 'si', 'sí', 'true', 'x', 'y', 'yes', 'verdadero'].indexOf(_ozTxt) !== -1;
                        }

                        // P0 — solo se guardan si traen valor real, igual que los de arriba.
                        if (precio      !== null) product.precio      = precio;
                        if (conversion  !== null) product.conversion  = conversion;
                        if (stockMinimo !== null) product.stockMinimo = stockMinimo;
                        if (proveedor)            product.proveedor   = proveedor;

                        // ── R2: PV de Parrot ──────────────────────────────────
                        // Mayusculas y sin espacios, igual que en la captura manual:
                        // un PV copiado de un Excel trae espacios al final mas veces
                        // de las que parece, y ' PVA1001169' no cruza con 'PVA1001169'.
                        var _pvRaw = findCol(row, columnMap.pv);
                        var _pv = (_pvRaw !== undefined && _pvRaw !== null)
                                  ? String(_pvRaw).toUpperCase().replace(/\s+/g, '') : '';
                        if (_pv) product.pv = _pv;

                        toImport.push(product);
                    });

                    products = products.concat(toImport);

                    // ── R2: avisar de PV repetidos ────────────────────────────
                    // Un PV duplicado no da ningun error visible: reparte mal las
                    // ventas y la desviacion sale torcida en los dos productos a la
                    // vez. Es de los fallos que se descubren un mes despues, cuando
                    // ya no se sabe de donde salio. Aqui no se borra nada —el
                    // administrador decide cual esta mal— pero se dice cuales son.
                    var _pvVistos = {}, _pvRepes = [];
                    products.forEach(function(p) {
                        if (!p.pv) return;
                        var k = String(p.pv).toUpperCase();
                        if (_pvVistos[k]) {
                            if (_pvRepes.indexOf(k) === -1) _pvRepes.push(k);
                        } else {
                            _pvVistos[k] = true;
                        }
                    });
                    if (_pvRepes.length) {
                        console.warn('[R2] PV repetidos tras importar:', _pvRepes.join(', '));
                    }

                    showNotification(toImport.length + ' productos importados.'
                        + (skipped ? ' ' + skipped + ' filas omitidas por falta de nombre.' : '')
                        + (valoresCorregidos ? ' ⚠️ ' + valoresCorregidos + ' valor(es) no físico(s) (negativo/cero) descartado(s).' : '')
                        + (_pvRepes.length ? ' ⚠️ ' + _pvRepes.length + ' PV repetido(s): ' + _pvRepes.slice(0, 3).join(', ')
                           + (_pvRepes.length > 3 ? '…' : '') + '. Las ventas no cruzarán bien hasta corregirlos.' : ''));
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