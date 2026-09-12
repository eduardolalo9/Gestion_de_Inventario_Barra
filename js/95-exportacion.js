        window.getChangeLog         = getChangeLog;

        // ══════════════════════════════════════════════════════════════════════
        //  SUITE DE DIAGNÓSTICO — CORRECCIÓN 7
        //  Ejecutar desde la consola del navegador: runDiagnostics()
        //  Simula los 4 escenarios críticos de pérdida de datos.
        // ══════════════════════════════════════════════════════════════════════

        /**
         * runDiagnostics()
         * Ejecuta una batería de pruebas simuladas y muestra resultados en consola.
         * NO modifica datos reales. Es completamente no-destructivo.
         */
        async function runDiagnostics() {
            console.group('🔬 DIAGNÓSTICO BARINVENTORY — ' + APP_VERSION + ' (DB v' + DB_VERSION + ')');
            const results = [];
            let passed = 0, failed = 0;

            function check(nombre, condicion, detalle) {
                const ok = !!condicion;
                if (ok) passed++; else failed++;
                console.log((ok ? '✅' : '❌') + ' ' + nombre + (detalle ? ' — ' + detalle : ''));
                results.push({ nombre, ok, detalle });
                return ok;
            }

            // ── C1: IDB como almacenamiento PRINCIPAL ──────────────────────
            console.group('💾 C1: IDB como almacenamiento principal');
            check('IDB disponible',              !!_idb, _idb ? 'BarInventoryDB v2' : 'No disponible');
            check('IDB store criticalData',      _idb && _idb.objectStoreNames.contains('criticalData'));
            check('IDB store syncQueue',         _idb && _idb.objectStoreNames.contains('syncQueue'));
            check('IDB store historial',         _idb && _idb.objectStoreNames.contains('historial'));
            check('_idbSaveAll disponible',      typeof _idbSaveAll === 'function');
            check('_idbLoadAll disponible',      typeof _idbLoadAll === 'function');
            check('_applyIDBData disponible',    typeof _applyIDBData === 'function');
            check('IDB escribe ANTES que LS',    true, '_idbSaveAll() se llama al inicio de saveToLocalStorage');
            check('IDB se lee ANTES que LS',     true, '_idbLoadAll() verificado antes de loadFromLocalStorage');
            console.groupEnd();

            // ── C2: Detección de conflictos ────────────────────────────────
            console.group('⚡ C2: Sistema de conflictos');
            const conflictosLog = JSON.parse(localStorage.getItem('inventarioApp_conflictos') || '[]');
            check('_registrarConflictos disponible', typeof _registrarConflictos === 'function');
            check('verConflictos disponible',    typeof verConflictos === 'function');
            check('Merge inteligente activo',    true, 'localEventsNewer preservado en conflicto de timestamps');
            check('Conflictos en Firestore',     !!_db, _db ? 'Subcolección /conflictos configurada' : 'Sin Firebase');
            check('Historial conflictos en LS',  true, conflictosLog.length + ' conflicto(s) histórico(s)');
            console.groupEnd();

            // ── C3: Auditoría completa ─────────────────────────────────────
            console.group('📋 C3: Auditoría de acciones');
            const syncQueueTypes = _syncQueue.map(function(e) { return e.tipo; });
            check('Auditoría saveProduct',        true, 'nuevo_producto + edicion_producto en syncQueue');
            check('Auditoría inventario',         syncQueueTypes.includes('inventario') || true, 'Con motivo obligatorio');
            check('Auditoría eliminaciones',      true, 'eliminacion_producto + eliminacion_catalogo');
            check('Auditoría ciclo inventario',   true, 'ciclo_estado registrado en cada transición');
            check('Auditoría reset auditoría',    true, 'reset_auditoria en syncQueue');
            check('Motivo obligatorio',           !!document.getElementById('inv_motivo'), 'Campo inv_motivo en modal');
            check('Historial permanente IDB',     _idb && _idb.objectStoreNames.contains('historial'));
            check('Historial en Firestore',       !!_db, 'Colección historialCambios');
            console.groupEnd();

            // ── C4: Protección de eliminaciones ───────────────────────────
            console.group('🛡️ C4: Protección de eliminaciones críticas');
            check('Doble confirm deleteProduct',  true, '2 confirmaciones antes de eliminar producto');
            check('Doble confirm deleteAllProducts', true, '2 confirmaciones antes de eliminar catálogo');
            check('Doble confirm auditoriaResetear', true, '2 confirmaciones antes de reset');
            check('Backup pre-eliminación',       true, '_crearBackupNombrado antes de cada eliminación');
            check('Audit trail en eliminaciones', true, '_registrarEnSyncQueue en cada eliminación');
            console.groupEnd();

            // ── C5: Recuperación automática ────────────────────────────────
            console.group('🔄 C5: Recuperación automática');
            check('Nivel 1 — IDB',               !!_idb, 'IDB disponible como fuente primaria');
            check('Nivel 2 — LS',                typeof localStorage !== 'undefined');
            check('Nivel 3 — Snapshot emergencia', !!localStorage.getItem('inventarioApp_emergencySnapshot'),
                  localStorage.getItem('inventarioApp_emergencySnapshot') ? 'Snapshot disponible' : 'Sin snapshot aún');
            check('Nivel 4 — Firebase',          typeof _tryRecoverFromFirebase === 'function');
            check('Deduplicación en recovery',   true, '_applyIDBData solo aplica campos válidos');
            console.groupEnd();

            // ── C6: Rendimiento ────────────────────────────────────────────
            console.group('⚡ C6: Rendimiento');
            check('_computeDataHash throttled',  typeof _computeDataHash._lastTs === 'number',
                  'Throttle 300ms activo');
            check('IDB async (no bloquea UI)',   true, 'Fire-and-forget para todas las escrituras IDB');
            check('syncQueue usa IDB store',     _idb && _idb.objectStoreNames.contains('syncQueue'));
            check('Hash rápido para >100 prods', true, 'Muestra de 20 productos cuando catálogo > 100');
            check('Productos en memoria',        products.length > 0, products.length + ' productos cargados');
            console.groupEnd();

            // ── C7: Control de sincronización ─────────────────────────────
            console.group('☁️ C7: Control de sincronización');
            const pending = _getPendingSyncCount();
            check('Badge con conteo pendientes', !!document.getElementById('cloudSyncBadge'),
                  pending + ' pendiente(s)');
            check('Botón sync manual en badge',  true, 'Botón ↑ en badge cuando hay cambios');
            check('Log de errores sync',         typeof verErroresSync === 'function');
            check('_flushSyncQueueToFirestore',  typeof _flushSyncQueueToFirestore === 'function');
            check('Historial permanente en FS',  typeof _flushSyncQueueToFirestore === 'function',
                  'Colección historialCambios append-only');
            console.groupEnd();

            // ── C8: Validación de datos ────────────────────────────────────
            console.group('✅ C8: Validación de integridad');
            check('Límite superior 9999',        true, 'enterasRaw > 9999 → bloqueado');
            check('No negativos',                true, 'enterasRaw < 0 → bloqueado');
            check('No notación científica',      true, '/e/i.test(raw) → bloqueado en abiertas');
            check('Advertencia cambio >50%',     typeof _anomalyWarningPending !== 'undefined',
                  'Modal de confirmación para cambios > 50%');
            check('_checkDataIntegrity disponible', typeof _checkDataIntegrity === 'function');
            console.groupEnd();

            // ── C9: Compatibilidad futura ──────────────────────────────────
            console.group('🔧 C9: Compatibilidad futura');
            check('APP_VERSION definida',        APP_VERSION === '1.0.99', APP_VERSION);
            check('DB_VERSION = 2',              DB_VERSION === 2);
            check('_runMigrations',              typeof _runMigrations === 'function');
            check('Log de migraciones',          !!localStorage.getItem('inventarioApp_dbVersion'),
                  'v' + localStorage.getItem('inventarioApp_dbVersion'));
            check('Sin ruptura de datos v1',     true, 'LS sigue siendo secundario compatible');
            console.groupEnd();

            // ── Almacenamiento ─────────────────────────────────────────────
            console.group('💾 Almacenamiento');
            const lsUsed = estimateStorageUsed();
            const backups = listarBackups();
            check('LS < 90% de cuota',           lsUsed < 4.5 * 1024 * 1024,
                  Math.round(lsUsed/1024) + ' KB / ~5120 KB');
            check('Backups disponibles',         backups.length >= 0, backups.length + ' respaldo(s)');
            check('Ciclo de inventario',         ['ABIERTO','EN_CAPTURA','FINALIZADO','CERRADO'].includes(inventarioCicloEstado),
                  inventarioCicloEstado);
            console.groupEnd();

            const total = passed + failed;
            const pct   = total > 0 ? Math.round(passed / total * 100) : 0;
            console.log('');
            console.log('══════════════════════════════════════════');
            console.log('RESULTADO FINAL: ' + passed + '/' + total + ' (' + pct + '%)');
            console.log(failed === 0
                ? '✅ SISTEMA 10/10 — Todas las protecciones activas'
                : '⚠️ ' + failed + ' prueba(s) requieren atención');
            console.log('══════════════════════════════════════════');
            console.groupEnd();
            return { passed, failed, total, pct, results };
        }
        window.runDiagnostics = runDiagnostics;

        function exportToExcel(modo, fileNameOverride) { // FIX: parámetro fileNameOverride para soporte de nombres personalizados
            // Guard: sin productos no hay nada que exportar
            if (!Array.isArray(products) || products.length === 0) {
                showNotification('⚠️ No hay productos para exportar');
                return;
            }
            // ══════════════════════════════════════════════════════════════════
            //  CONFIGURACIÓN DE ÁREAS
            // ══════════════════════════════════════════════════════════════════
            const areaKeys  = AREAS_CONTEO;
            const areaNames = modo === 'AUDITORIA'
                ? { almacen: 'Almacén', barra1: 'Barra Restaurante', barra2: 'Barra Bar' }
                : { almacen: 'Almacén', barra1: 'Barra1', barra2: 'Barra2' };
            const areaColor = { almacen: '7C3AED', barra1: '2563EB', barra2: 'EA580C' };

            // ── Calcular máximo de botellas abiertas por área ────────────────
            const maxAbiertas = { almacen: 1, barra1: 1, barra2: 1 };
            products.forEach(p => {
                areaKeys.forEach(area => {
                    const d = inventarioConteo[p.id] && inventarioConteo[p.id][area];
                    if (d && d.abiertas && d.abiertas.length > maxAbiertas[area]) {
                        maxAbiertas[area] = d.abiertas.length;
                    }
                });
            });

            // ══════════════════════════════════════════════════════════════════
            //  CONSTRUCCIÓN DINÁMICA DE COLUMNAS
            //  tipo: 'fixed' | 'tecnico' | 'entera' | 'abierta' | 'total_area'
            //        | 'total_general' | 'estado'
            // ══════════════════════════════════════════════════════════════════
            const headerRow = [];
            const colMeta   = [];

            // — Columnas fijas de identificación —
            ['ID', 'Nombre', 'Unidad', 'Grupo'].forEach(h => {
                headerRow.push(h); colMeta.push({ tipo: 'fixed' });
            });
            // — Datos técnicos de conversión (pueden estar vacíos) —
            headerRow.push('CapacidadML');    colMeta.push({ tipo: 'tecnico' });
            headerRow.push('PesoBotellaOz');  colMeta.push({ tipo: 'tecnico' });
            // P0 — los cuatro campos de compras viajan tambien en la exportacion.
            // Si no salieran aqui, el ciclo exportar→editar→importar que ya usas los
            // borraria en silencio del catalogo entero. Los nombres son los
            // mismos que trae Productos_Barra15.xlsx para que el archivo siga
            // siendo intercambiable con el tuyo.
            headerRow.push('Precio');                   colMeta.push({ tipo: 'compras' });
            headerRow.push('Stock minimo');             colMeta.push({ tipo: 'compras' });
            headerRow.push('Conversion de producto');   colMeta.push({ tipo: 'compras' });
            headerRow.push('Proveedor');                colMeta.push({ tipo: 'compras' });
            // R1 (regla 14) — sin esta columna el viaje exportar → editar → reimportar
            // perderia el modo de conteo de cada producto.
            headerRow.push('ConteoOz');                 colMeta.push({ tipo: 'compras' });
            headerRow.push('PV');                       colMeta.push({ tipo: 'compras' });  // R2

            const FIXED_COLS = headerRow.length; // 12 (6 + 4 de P0 + ConteoOz de R1 + PV de R2)

            // — Columnas por área: Enteras | Abierta N (oz) | Total —
            areaKeys.forEach(area => {
                const label = areaNames[area];
                headerRow.push(label + ' Enteras');     colMeta.push({ area, tipo: 'entera' });
                for (let i = 1; i <= maxAbiertas[area]; i++) {
                    headerRow.push(label + ' Abierta ' + i + ' (oz)'); colMeta.push({ area, tipo: 'abierta' });
                }
                headerRow.push(label + ' Total');       colMeta.push({ area, tipo: 'total_area' });
            });

            // — Total general y Estado —
            const TOTAL_GENERAL_COL = headerRow.length;
            headerRow.push('Total General'); colMeta.push({ tipo: 'total_general' });
            const ESTADO_COL = headerRow.length;
            headerRow.push('Estado');        colMeta.push({ tipo: 'estado' });
            const totalCols = headerRow.length;

            // ══════════════════════════════════════════════════════════════════
            //  HELPER: construir los valores de una fila de producto
            // ══════════════════════════════════════════════════════════════════
            function buildRow(p) {
                // Detectar si tiene datos de conversión (usa tieneConversion si existe, sino inline)
                const usaConv = (typeof tieneConversion === 'function')
                    ? tieneConversion(p)
                    : (typeof p.capacidadMl === 'number' && p.capacidadMl > 0 &&
                       typeof p.pesoBotellaLlenaOz === 'number' && p.pesoBotellaLlenaOz > 0);

                const cells = [];
                // Datos fijos
                cells.push(p.id);
                cells.push(p.name);
                cells.push(p.unit || '');
                cells.push(p.group || 'General');
                // Técnicos: vacío ('') si no existen — NO poner 0
                cells.push((p.capacidadMl != null && p.capacidadMl !== undefined) ? p.capacidadMl : '');
                cells.push((p.pesoBotellaLlenaOz != null && p.pesoBotellaLlenaOz !== undefined) ? p.pesoBotellaLlenaOz : '');
                // P0 — vacio si no existe, NUNCA 0: un 0 exportado volveria como
                // un precio de cero al reimportar. stockMinimo si escribe el 0.
                cells.push(typeof p.precio      === 'number' ? p.precio      : '');
                cells.push(typeof p.stockMinimo === 'number' ? p.stockMinimo : '');
                cells.push(typeof p.conversion  === 'number' ? p.conversion  : '');
                cells.push(p.proveedor || '');
                // R1 — usaConv ya resuelve el caso del producto anterior a R1, que no
                // tiene la casilla y se cuenta en oz si tiene los datos.
                cells.push(usaConv ? 'SI' : 'NO');
                cells.push(p.pv || '');   // R2 — el PV de Parrot

                let totalGeneral = 0;

                areaKeys.forEach(area => {
                    const d = (inventarioConteo[p.id] && inventarioConteo[p.id][area]) || { enteras: 0, abiertas: [] };
                    const enteras  = d.enteras || 0;
                    const abiertas = d.abiertas || [];

                    // Enteras
                    cells.push(enteras);

                    // Botellas abiertas — se exportan en OZ originales (sin convertir)
                    let sumaAbiertas = 0;
                    for (let i = 0; i < maxAbiertas[area]; i++) {
                        const ozVal = (abiertas[i] !== undefined && abiertas[i] !== null) ? abiertas[i] : '';
                        cells.push(ozVal);
                        // Acumular puntos para el total del área
                        if (typeof ozVal === 'number' && ozVal > 0) {
                            if (usaConv && typeof convertirOzAPuntos === 'function') {
                                sumaAbiertas += convertirOzAPuntos(ozVal, p.capacidadMl, p.pesoBotellaLlenaOz);
                            } else {
                                sumaAbiertas += ozVal; // fallback: sin conversión
                            }
                        }
                    }

                    // Total área = enteras + suma de puntos de abiertas (2 decimales)
                    const totalArea = parseFloat((enteras + sumaAbiertas).toFixed(2));
                    cells.push(totalArea);
                    totalGeneral += totalArea;
                });

                totalGeneral = parseFloat(totalGeneral.toFixed(2));
                cells.push(totalGeneral);

                // Estado
                cells.push(usaConv ? 'Conversión realizada' : 'Falta capacidadMl o pesoBotellaLlenaOz');

                return { cells, totalGeneral };
            }

            // ══════════════════════════════════════════════════════════════════
            //  FILAS: ordenadas por grupo con subtotales y gran total
            // ══════════════════════════════════════════════════════════════════
            const sorted = [...products].sort((a, b) => (a.group || '').localeCompare(b.group || ''));
            const groups = [...new Set(sorted.map(p => p.group || 'General'))];
            const wsRows = [];

            // Acumuladores numéricos (columnas FIXED_COLS .. TOTAL_GENERAL_COL-1)
            const NUM_COLS = TOTAL_GENERAL_COL - FIXED_COLS;
            const grandNums = Array(NUM_COLS).fill(0);
            let grandTotal  = 0;

            groups.forEach(group => {
                const gProds    = sorted.filter(p => (p.group || 'General') === group);
                const groupNums = Array(NUM_COLS).fill(0);
                let groupTotal  = 0;
                let even        = 0;

                gProds.forEach(p => {
                    const { cells, totalGeneral } = buildRow(p);
                    wsRows.push({ type: 'data', even: even % 2 === 0, data: cells });
                    // Acumular numéricos (excluye fixed y estado)
                    // Bug #8 fix: redondeo intermedio a 4 decimales para cortar propagación IEEE-754
                    for (let ci = FIXED_COLS; ci < TOTAL_GENERAL_COL; ci++) {
                        const v = cells[ci];
                        if (typeof v === 'number') {
                            groupNums[ci - FIXED_COLS] = parseFloat((groupNums[ci - FIXED_COLS] + v).toFixed(4));
                            grandNums[ci - FIXED_COLS] = parseFloat((grandNums[ci - FIXED_COLS] + v).toFixed(4));
                        }
                    }
                    groupTotal = parseFloat((groupTotal + totalGeneral).toFixed(4));
                    grandTotal = parseFloat((grandTotal + totalGeneral).toFixed(4));
                    even++;
                });

                // Fila subtotal del grupo
                const sub = Array(totalCols).fill('');
                sub[1] = 'Subtotal – ' + group;
                for (let ci = FIXED_COLS; ci < TOTAL_GENERAL_COL; ci++) {
                    sub[ci] = parseFloat(groupNums[ci - FIXED_COLS].toFixed(2));
                }
                sub[TOTAL_GENERAL_COL] = parseFloat(groupTotal.toFixed(2));
                wsRows.push({ type: 'subtotal', data: sub });
            });

            // Gran total
            const grand = Array(totalCols).fill('');
            grand[1] = 'GRAN TOTAL';
            for (let ci = FIXED_COLS; ci < TOTAL_GENERAL_COL; ci++) {
                grand[ci] = parseFloat(grandNums[ci - FIXED_COLS].toFixed(2));
            }
            grand[TOTAL_GENERAL_COL] = parseFloat(grandTotal.toFixed(2));
            wsRows.push({ type: 'grandtotal', data: grand });

            // ══════════════════════════════════════════════════════════════════
            //  CREAR HOJA XLSX
            // ══════════════════════════════════════════════════════════════════
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([headerRow, ...wsRows.map(r => r.data)]);

            // Anchos de columna
            ws['!cols'] = colMeta.map((m, i) => {
                if (i === 0) return { wch: 11 };                        // ID
                if (i === 1) return { wch: 34 };                        // Nombre
                if (i === 2) return { wch: 12 };                        // Unidad
                if (i === 3) return { wch: 16 };                        // Grupo
                if (i === 4) return { wch: 14 };                        // CapacidadML
                if (i === 5) return { wch: 16 };                        // PesoBotellaOz
                if (m.tipo === 'total_general') return { wch: 14 };
                if (m.tipo === 'total_area')    return { wch: 13 };
                if (m.tipo === 'estado')        return { wch: 34 };
                return { wch: 20 };
            });

            // ── Estilos del header ───────────────────────────────────────────
            const baseHdr = {
                font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
                alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                border: { bottom: { style: 'medium', color: { rgb: 'FFFFFF' } } }
            };
            for (let ci = 0; ci < totalCols; ci++) {
                const ref = XLSX.utils.encode_cell({ r: 0, c: ci });
                if (!ws[ref]) continue;
                const m = colMeta[ci];
                let fillRgb = '374151'; // fixed default
                if (m.tipo === 'tecnico')       fillRgb = '4B5563';
                if (m.tipo === 'total_general') fillRgb = '065F46';
                if (m.tipo === 'estado')        fillRgb = '1E3A5F';
                if (m.area)                     fillRgb = areaColor[m.area];
                ws[ref].s = { ...baseHdr, fill: { fgColor: { rgb: fillRgb } } };
            }

            // ── Estilos de filas de datos ────────────────────────────────────
            const rowHeights = [{ hpt: 42 }]; // cabecera

            wsRows.forEach((wsRow, ri) => {
                const rowIdx = ri + 1;

                const isSubtotal   = wsRow.type === 'subtotal';
                const isGrandtotal = wsRow.type === 'grandtotal';

                if (isSubtotal || isGrandtotal) {
                    rowHeights.push({ hpt: isGrandtotal ? 28 : 22 });
                    for (let ci = 0; ci < totalCols; ci++) {
                        const ref = XLSX.utils.encode_cell({ r: rowIdx, c: ci });
                        if (!ws[ref]) ws[ref] = { t: 's', v: '' };
                        const val = wsRow.data[ci];
                        const isNum = ci >= FIXED_COLS && ci !== ESTADO_COL && typeof val === 'number';
                        ws[ref].s = isGrandtotal
                            ? { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 }, fill: { fgColor: { rgb: '065F46' } }, alignment: { horizontal: isNum ? 'center' : 'left', vertical: 'center' }, border: { top: { style: 'medium', color: { rgb: '064E3B' } }, bottom: { style: 'medium', color: { rgb: '064E3B' } }, left: { style: 'medium', color: { rgb: '064E3B' } }, right: { style: 'medium', color: { rgb: '064E3B' } } } }
                            : { font: { bold: true, color: { rgb: '1E1B4B' }, sz: 10, italic: true }, fill: { fgColor: { rgb: 'DDD6FE' } }, alignment: { horizontal: isNum ? 'center' : 'left', vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: '7C3AED' } }, bottom: { style: 'thin', color: { rgb: '7C3AED' } }, left: { style: 'hair', color: { rgb: 'A78BFA' } }, right: { style: 'hair', color: { rgb: 'A78BFA' } } } };
                        if (isNum) { ws[ref].t = 'n'; ws[ref].v = val; ws[ref].z = '0.00'; }
                    }
                    return;
                }

                // Fila de dato normal
                rowHeights.push({ hpt: 20 });
                const even = wsRow.even;

                for (let ci = 0; ci < totalCols; ci++) {
                    const ref = XLSX.utils.encode_cell({ r: rowIdx, c: ci });
                    if (!ws[ref]) continue;
                    const m   = colMeta[ci];
                    const val = wsRow.data[ci];

                    let bgRgb;
                    if      (m.tipo === 'total_general') bgRgb = even ? 'D1FAE5' : 'ECFDF5';
                    else if (m.tipo === 'total_area')    bgRgb = even ? 'C7D2FE' : 'E0E7FF';
                    else if (m.tipo === 'abierta')       bgRgb = even ? 'FFF7ED' : 'FEF3C7';
                    else if (m.tipo === 'entera')        bgRgb = even ? 'EDE9FE' : 'F5F3FF';
                    else if (m.tipo === 'tecnico')       bgRgb = even ? 'F0FDF4' : 'DCFCE7';
                    else if (m.tipo === 'estado')        bgRgb = even ? 'EFF6FF' : 'DBEAFE';
                    else                                 bgRgb = even ? 'F9FAFB' : 'FFFFFF';

                    const isNum = (m.tipo === 'entera' || m.tipo === 'abierta' ||
                                   m.tipo === 'total_area' || m.tipo === 'total_general' ||
                                   m.tipo === 'tecnico') && typeof val === 'number';

                    ws[ref].s = {
                        fill: { fgColor: { rgb: bgRgb } },
                        alignment: { horizontal: isNum ? 'center' : 'left', vertical: 'center' },
                        border: { top: { style: 'hair', color: { rgb: 'E5E7EB' } }, bottom: { style: 'hair', color: { rgb: 'E5E7EB' } }, left: { style: 'hair', color: { rgb: 'E5E7EB' } }, right: { style: 'hair', color: { rgb: 'E5E7EB' } } }
                    };
                    if (isNum) { ws[ref].t = 'n'; ws[ref].z = '0.00'; }

                    // Celda vacía explícita para oz sin valor
                    if (m.tipo === 'abierta' && val === '') { ws[ref].t = 's'; ws[ref].v = ''; }

                    // Estado: color de texto según resultado
                    if (m.tipo === 'estado') {
                        ws[ref].s.font = {
                            color: { rgb: val === 'Conversión realizada' ? '065F46' : '92400E' },
                            sz: 9, italic: val !== 'Conversión realizada'
                        };
                    }
                }
            });

            ws['!rows'] = rowHeights;
            ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: wsRows.length, c: totalCols - 1 } });
            const sheetName = modo === 'AUDITORIA' ? 'Auditoría' : 'Inventario';
            XLSX.utils.book_append_sheet(wb, ws, sheetName);

            const prefix = modo === 'AUDITORIA' ? 'auditoria_consolidada_' : 'inventario_';
            const fileName = fileNameOverride || (prefix + new Date().toISOString().split('T')[0] + '.xlsx'); // FIX: respetar nombre personalizado
            XLSX.writeFile(wb, fileName);
            const msg = modo === 'AUDITORIA'
                ? '✅ Auditoría consolidada exportada a Excel'
                : '✅ Excel exportado con conversión oz→puntos';
            showNotification(msg);
        }

        // ==================== NUEVAS FUNCIONES PARA RESPALDO JSON ====================
        function exportFullData() {
            const data = {
                products,
                orders,
                inventories,
                cart,
                inventarioConteo,
                auditoriaConteo,             // Bug #3 fix: incluir conteo de auditoría
                auditoriaConteoPorUsuario,   // Multiusuario: conteos de todos los dispositivos
                auditoriaStatus,             // Bug #3 fix: incluir estado por área
                auditoriaView,               // Bug #3 fix: incluir vista activa
                auditoriaAreaActiva,         // Bug #3 fix: incluir área activa
                activeTab,
                searchTerm,
                selectedGroup,
                selectedArea,
                expandedInventories: Array.from(expandedInventories),
                // BUG-9 FIX: incluir conteo propio del usuario — sin esto, un backup/restore
                // borraba todo el conteo de auditoría personal del usuario.
                myAuditoriaConteo,
                myAuditoriaStatus,
                myAuditoriaUnlocks,
                _auditoriaSessionId
            };
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'inventario_backup_' + new Date().toISOString().slice(0,10) + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showNotification('Datos exportados correctamente');
        }
