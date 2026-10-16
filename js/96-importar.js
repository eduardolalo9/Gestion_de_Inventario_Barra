        // ══════════════════════════════════════════════════════════════════════
        //  v5.18 — MÓDULO "IMPORTAR DESDE EXCEL"
        //  ────────────────────────────────────────────────────────────────────
        //  Pedido de Eduardo (6-oct-2026): agilizar la carga inicial o la
        //  actualización masiva sin digitar a mano, con:
        //    · plantillas descargables (.xlsx / .csv) con las cabeceras exactas;
        //    · validación PREVIA en el teléfono: códigos duplicados, categorías
        //      vacías y números erróneos se detectan ANTES de tocar la base;
        //    · carga transaccional: cada importación se escribe en un solo
        //      commit atómico (catálogo: un documento; corte: un documento;
        //      compras: un batch por folio, idempotente).
        //  Decisión: TODAS las importaciones viven aquí; los botones de
        //  importar se quitaron de cada pestaña.
        //
        //  Secciones:
        //    catalogo    → valida aquí y aplica con las reglas de siempre
        //                  (_catalogoAplicarFilas, js/90) + publica en un paso.
        //    recetas     → el importador de RECETARIO-2 (js/92), con su vista previa.
        //    existencias → NUEVO: corte de existencias (enteras + fracción
        //                  abierta). Se guarda como ancla del Total
        //                  (anclasExistencia/{fecha}_{HHmm}): desde ahí,
        //                  Total = corte + compras posteriores − consumo posterior.
        //    compras     → el importador de FASE 4 (js/88), con su vista previa.
        //    ventas      → el importador de FASE 10B (js/93) con Simular/Procesar.
        // ══════════════════════════════════════════════════════════════════════

        var IMPORTAR_SECCIONES = [
            { id: 'catalogo', titulo: 'Catálogo de productos', icono: 'fa-boxes-stacked', permiso: 'catalog.publish',
              desc: 'Altas y actualizaciones por ID: nombre, grupo, unidad, precio, conversión, mínimo, proveedor, PV y datos de botella. Se valida, se aplica y se publica a todos los dispositivos en un paso.',
              formatos: ['xlsx', 'csv'] },
            { id: 'recetas', titulo: 'Recetario', icono: 'fa-book', permiso: 'recipe.edit',
              desc: 'Recetas por PV con sus insumos (solo almacén 12 · barra). Vista previa con incidencias antes de guardar.',
              formatos: ['xlsx', 'csv'] },
            { id: 'existencias', titulo: 'Corte de existencias', icono: 'fa-warehouse', permiso: 'inventory.post',
              desc: 'Inventario actual: unidades cerradas y fracción abierta, o el reporte de existencias de SBO (columna "En Stock" = total). Crea un corte con fecha y hora y recalcula el Total desde esa línea base.',
              formatos: ['xlsx', 'csv'] },
            { id: 'compras', titulo: 'Compras (entrada de mercancía SAP)', icono: 'fa-receipt', permiso: 'purchases.import',
              desc: 'El Excel de entrada de mercancía de SAP. Agrupa por folio, valida códigos y precios, y suma al Total.',
              formatos: ['xlsx', 'csv'] },
            { id: 'ventas', titulo: 'Ventas del POS (Parrot)', icono: 'fa-file-chart-column', permiso: 'sales.import',
              desc: 'El reporte de ventas de Parrot (hoja "Detalle"). Simula contra recetas y procesa para bajar el Total.',
              formatos: ['xlsx'] }
        ];

        var importarSeccion = null;   // sección abierta (null = el menú del módulo)
        var _impPendiente   = null;   // { seccion, archivo, filas, validacion, ... } en vista previa
        var _impResultado   = null;   // resultado de la última aplicación
        var _impSeccionArchivo = null;

        // ══════════════════════════════════════════════════════════════════════
        //  UTILIDADES PURAS
        // ══════════════════════════════════════════════════════════════════════

        function _impNorm(s) {
            return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '');
        }

        /** Valor de una columna por sus nombres posibles (exacto, luego normalizado). */
        function _impCol(fila, nombres) {
            if (!fila || !nombres) return undefined;
            for (var i = 0; i < nombres.length; i++) {
                var v = fila[nombres[i]];
                if (v !== undefined && v !== null && v !== '') return v;
            }
            var mapa = {};
            Object.keys(fila).forEach(function(k) { mapa[_impNorm(k)] = k; });
            for (var j = 0; j < nombres.length; j++) {
                var real = mapa[_impNorm(nombres[j])];
                if (real !== undefined && fila[real] !== undefined && fila[real] !== null && fila[real] !== '') return fila[real];
            }
            return undefined;
        }

        /** ¿La hoja trae una columna con alguno de esos nombres? */
        function _impTieneColumna(cabeceras, nombres) {
            var norm = cabeceras.map(_impNorm);
            return nombres.some(function(n) { return norm.indexOf(_impNorm(n)) !== -1; });
        }

        /**
         * Número estricto: número nativo, o texto como "12", "0.35", "0,35".
         * Devuelve null si viene vacío y NaN si trae algo que no es número
         * ("dos", "1.2.3", "12 pzas"): eso es un error que se reporta, nunca
         * un cero silencioso.
         */
        function _impNumero(v) {
            if (v === undefined || v === null || v === '') return null;
            if (typeof v === 'number') return isFinite(v) ? v : NaN;
            var t = String(v).trim().replace(/\s+/g, '');
            if (t === '') return null;
            if (!/^-?\d+([.,]\d+)?$/.test(t)) return NaN;
            return Number(t.replace(',', '.'));
        }

        function _impCabeceras(filas) {
            var set = {};
            (filas || []).forEach(function(f) { Object.keys(f || {}).forEach(function(k) { if (k.indexOf('__') !== 0) set[k] = true; }); });
            return Object.keys(set);
        }

        function _impRed(n, d) { var f = Math.pow(10, d === undefined ? 3 : d); var x = Number(n); return isFinite(x) ? Math.round(x * f) / f : 0; }

        // ══════════════════════════════════════════════════════════════════════
        //  PLANTILLAS
        // ══════════════════════════════════════════════════════════════════════

        /**
         * importarPlantilla(seccion, productos, areasDef) — capa pura.
         * Devuelve { archivo, hoja, cabeceras, filas, instrucciones }.
         * La del catálogo y la del corte vienen PRELLENADAS con el catálogo
         * actual: actualizar precios o capturar el inventario es llenar
         * columnas, no teclear 424 códigos.
         */
        function importarPlantilla(seccion, productos, areasDef) {
            productos = Array.isArray(productos) ? productos : [];
            var hoy = (typeof fechaISOLocal === 'function') ? fechaISOLocal(new Date()) : '';
            if (seccion === 'catalogo') {
                var cab = ['ID', 'Nombre', 'Grupo', 'Unidad', 'Precio', 'Conversion', 'Stock minimo', 'Proveedor', 'PV', 'CapacidadML', 'PesoBotellaOz', 'ConteoOz'];
                var filas = productos.length ? productos.map(function(p) {
                    return [p.id || '', p.name || '', p.group || '', p.unit || '',
                            (typeof p.precio === 'number') ? p.precio : '', (typeof p.conversion === 'number') ? p.conversion : '',
                            (typeof p.stockMinimo === 'number') ? p.stockMinimo : '', p.proveedor || '', p.pv || '',
                            (typeof p.capacidadMl === 'number') ? p.capacidadMl : '', (typeof p.pesoBotellaLlenaOz === 'number') ? p.pesoBotellaLlenaOz : '',
                            (typeof p.conteoOzHabilitado === 'boolean') ? (p.conteoOzHabilitado ? 'Si' : 'No') : ''];
                }) : [['1180001', 'TEQUILA EJEMPLO 750 ML', 'TEQUILA', 'PZA', 350, 750, 2, 'DISTRIBUIDORA', 'PVB1000001', 750, 42.5, 'Si']];
                return { archivo: 'plantilla-catalogo', hoja: 'Catalogo', cabeceras: cab, filas: filas, instrucciones: [
                    'Una fila por producto. El ID manda: si ya existe, se actualiza; si no, es un alta.',
                    'Obligatorios: Nombre y Grupo. Unidad: PZA, KGS, LTS…',
                    'Números con punto decimal (350.50). Sin signo de pesos ni texto.',
                    'Una columna que falte NO borra lo que ya tiene el producto.',
                    'El conteo por área (stock) NO se toca desde aquí: para eso está el Corte de existencias.'] };
            }
            if (seccion === 'existencias') {
                var cabE = ['Código', 'Producto', 'Unidad', 'Área', 'Enteras', 'Abierta'];
                var filasE = productos.map(function(p) { return [p.id || '', p.name || '', p.unit || '', '', '', '']; });
                if (!filasE.length) filasE = [['1180001', 'TEQUILA EJEMPLO 750 ML', 'PZA', '', 3, 0.35]];
                var nombresAreas = (areasDef || []).map(function(a) { return a.nombre + ' (' + a.id + ')'; }).join(', ');
                return { archivo: 'plantilla-corte-existencias-' + hoy, hoja: 'Existencias', cabeceras: cabE, filas: filasE, instrucciones: [
                    'Enteras: unidades CERRADAS (botellas, piezas, kilos completos).',
                    'Abierta: lo que queda de las abiertas, como FRACCIÓN decimal de una unidad (media botella = 0.5). Si hay varias abiertas, súmalas (0.5 + 0.25 = 0.75).',
                    'Área es opcional. Si la usas, repite el producto en una fila por área y se suman. Áreas válidas: ' + (nombresAreas || 'las configuradas'),
                    'Deja vacía la fila de un producto que NO contaste: conserva su Total actual. Un 0 escrito sí significa cero.',
                    'Código y Producto vienen de tu catálogo: no los cambies. Unidad es solo referencia.',
                    'También puedes subir directo el reporte de existencias de SBO: su columna "En Stock" se toma como el TOTAL del producto (sin Enteras ni Abierta) y solo se leen las filas del almacén 12.'] };
            }
            if (seccion === 'recetas') {
                return { archivo: 'plantilla-recetario', hoja: 'Recetas',
                    cabeceras: ['PV', 'Receta', 'Categoría', 'Activa', 'Código insumo', 'Descripción insumo', 'Cantidad', 'UoM', 'Almacén'],
                    filas: [['PVB1000006', 'MARGARITA', 'COCTELERIA', 'Si', '1180001', 'TEQUILA EJEMPLO 750 ML', 0.06, 'PZA', '12'],
                            ['PVB1000006', 'MARGARITA', 'COCTELERIA', 'Si', '1020064', 'LIMON KG', 0.03, 'KGS', '12']],
                    instrucciones: ['Una fila por insumo; las filas con el mismo PV forman una receta.',
                                    'Cantidad en la unidad del insumo (0.06 PZA = 6 % de la botella).',
                                    'Solo se importan las líneas con Almacén = 12 (barra).'] };
            }
            if (seccion === 'compras') {
                return { archivo: 'plantilla-compras', hoja: 'Entradas',
                    cabeceras: ['Folio', 'Doc SAP', 'Proveedor', 'Fecha', 'Código', 'Artículo', 'UoM', 'Almacén', 'Cantidad', 'Precio', 'Total línea'],
                    filas: [['F-1001', '5000123', 'P0012 — DISTRIBUIDORA', hoy, '1180001', 'TEQUILA EJEMPLO 750 ML', 'PZA', '12 — BARRA', 6, 350, 2100]],
                    instrucciones: ['Es el mismo formato del Excel de entrada de mercancía de SAP.',
                                    'Solo se importan las líneas del almacén 12 (barra).',
                                    'Un mismo folio en varias filas forma una sola compra.'] };
            }
            if (seccion === 'ventas') {
                return { archivo: 'plantilla-ventas', hoja: 'Detalle',
                    cabeceras: ['Nombre', 'Tipo de artículo', 'Tipo', 'Precio actual', 'Cantidad', 'Precio promedio', 'Total artículos', 'Descuentos de artículo', 'Venta total', 'Impuestos', 'Venta neta', 'SKU'],
                    filas: [['Margarita', 'Bebidas', 'Artículo', 150, 7, 150, 1050, 0, 1050, 144.83, 905.17, 'PVB1000006']],
                    instrucciones: ['Es la hoja "Detalle" del reporte de ventas de Parrot.',
                                    'El periodo (fechas) se elige en la vista previa: el reporte no lo trae.'] };
            }
            return null;
        }

        function _impCsvCelda(v) {
            var s = (v === undefined || v === null) ? '' : String(v);
            return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }

        /** Texto CSV (con BOM para que Excel lea bien los acentos). */
        function importarPlantillaCsv(pl) {
            var lineas = [pl.cabeceras.map(_impCsvCelda).join(',')];
            pl.filas.forEach(function(f) { lineas.push(f.map(_impCsvCelda).join(',')); });
            return '﻿' + lineas.join('\r\n') + '\r\n';
        }

        function _impAreasDef() {
            var ids = (typeof AREAS_CONTEO !== 'undefined' && AREAS_CONTEO.length) ? AREAS_CONTEO : ['almacen', 'barra1', 'barra2'];
            return ids.map(function(id) {
                var nombre = (typeof areas !== 'undefined' && areas && areas[id]) ? areas[id]
                           : ((typeof areasAuditoria !== 'undefined' && areasAuditoria[id]) ? areasAuditoria[id] : id);
                return { id: id, nombre: String(nombre) };
            });
        }

        /** Descarga la plantilla de una sección en .xlsx o .csv. */
        function importarDescargarPlantilla(seccion, formato) {
            var pl = importarPlantilla(seccion, (typeof products !== 'undefined') ? products : [], _impAreasDef());
            if (!pl) return;
            if (formato === 'csv') {
                var blob = new Blob([importarPlantillaCsv(pl)], { type: 'text/csv;charset=utf-8' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = pl.archivo + '.csv';
                document.body.appendChild(a); a.click();
                setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
                showNotification('📥 Plantilla descargada: ' + pl.archivo + '.csv');
                return;
            }
            if (typeof XLSX === 'undefined') {
                showNotification('⏳ La librería de Excel todavía no carga. Intenta en unos segundos o descarga la versión .csv');
                return;
            }
            var wb = XLSX.utils.book_new();
            var hoja = XLSX.utils.aoa_to_sheet([pl.cabeceras].concat(pl.filas));
            hoja['!cols'] = pl.cabeceras.map(function(c) { return { wch: Math.max(10, String(c).length + 4) }; });
            XLSX.utils.book_append_sheet(wb, hoja, pl.hoja);
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Instrucciones']].concat(pl.instrucciones.map(function(t) { return [t]; }))), 'Instrucciones');
            XLSX.writeFile(wb, pl.archivo + '.xlsx');
            showNotification('📥 Plantilla descargada: ' + pl.archivo + '.xlsx');
        }

        // ══════════════════════════════════════════════════════════════════════
        //  VALIDACIÓN DEL CATÁLOGO (antes de tocar nada)
        // ══════════════════════════════════════════════════════════════════════

        /**
         * importarValidarCatalogo(filas, productos) — capa pura.
         * Usa COLUMNAS_CATALOGO (js/90): los mismos nombres que la importación.
         * errores → bloquean la aplicación; avisos → informan.
         */
        function importarValidarCatalogo(filas, productos) {
            var C = (typeof COLUMNAS_CATALOGO !== 'undefined') ? COLUMNAS_CATALOGO : null;
            var r = { errores: [], avisos: [], altas: 0, actualizaciones: 0, filasValidas: 0, total: (filas || []).length, columnasIgnoradas: [] };
            if (!C) { r.errores.push('No se encontró el mapa de columnas del catálogo.'); return r; }
            if (!filas || !filas.length) { r.errores.push('El archivo no trae filas con datos.'); return r; }
            var cab = _impCabeceras(filas);
            if (!_impTieneColumna(cab, C.name))  r.errores.push('Falta la columna obligatoria "Nombre".');
            if (!_impTieneColumna(cab, C.group)) r.errores.push('Falta la columna obligatoria "Grupo" (categoría).');
            if (!_impTieneColumna(cab, C.id))    r.avisos.push('No hay columna "ID": todas las filas serán ALTAS con un ID nuevo.');
            var conocidas = [];
            Object.keys(C).forEach(function(k) { conocidas = conocidas.concat(C[k]); });
            var conocidasN = conocidas.map(_impNorm);
            r.columnasIgnoradas = cab.filter(function(c) { return conocidasN.indexOf(_impNorm(c)) === -1; });
            if (r.columnasIgnoradas.length) r.avisos.push('Columnas que no se usan y se ignoran: ' + r.columnasIgnoradas.join(', ') + '.');
            if (r.errores.length) return r;

            var existentes = {};
            (productos || []).forEach(function(p) { if (p && p.id) existentes[String(p.id)] = p; });
            var vistosId = {}, vistosPv = {}, pvDeIdArchivo = {};
            var numericos = [['precio', 'Precio', false], ['conversion', 'Conversión', false], ['stockMinimo', 'Stock mínimo', true],
                             ['capacidadMl', 'CapacidadML', false], ['pesoBotellaLlenaOz', 'PesoBotellaOz', false], ['stock', 'Cantidad/Stock', true]];
            filas.forEach(function(f, i) {
                var n = i + 2;   // fila de Excel (la 1 es la cabecera)
                var errFila = 0;
                var nombre = _impCol(f, C.name);
                var id = _impCol(f, C.id);
                id = (id === undefined || id === null) ? '' : String(id).trim();
                if (nombre === undefined || String(nombre).trim() === '') { r.errores.push('Fila ' + n + (id ? ' (ID ' + id + ')' : '') + ': sin nombre.'); errFila++; }
                var grupo = _impCol(f, C.group);
                if (grupo === undefined || String(grupo).trim() === '') { r.errores.push('Fila ' + n + (id ? ' (ID ' + id + ')' : '') + ': sin Grupo (categoría).'); errFila++; }
                if (_impCol(f, C.unit) === undefined) r.avisos.push('Fila ' + n + ': sin Unidad — se usará "Unidad".');
                if (id) {
                    if (vistosId[id]) { r.errores.push('Fila ' + n + ': el ID ' + id + ' está duplicado (también en la fila ' + vistosId[id] + ').'); errFila++; }
                    else vistosId[id] = n;
                }
                numericos.forEach(function(d) {
                    var crudo = _impCol(f, C[d[0]]);
                    if (crudo === undefined) return;
                    var v = _impNumero(crudo);
                    if (v === null) return;
                    if (isNaN(v)) { r.errores.push('Fila ' + n + ': ' + d[1] + ' no es un número ("' + crudo + '").'); errFila++; return; }
                    if (v < 0) { r.errores.push('Fila ' + n + ': ' + d[1] + ' negativo (' + v + ').'); errFila++; return; }
                    if (v === 0 && !d[2]) r.avisos.push('Fila ' + n + ': ' + d[1] + ' en 0 — se ignora (no es un valor físico).');
                });
                var pv = _impCol(f, C.pv);
                if (pv !== undefined) {
                    var k = String(pv).toUpperCase().replace(/\s+/g, '');
                    if (k) {
                        if (vistosPv[k] && vistosPv[k] !== id) r.avisos.push('Fila ' + n + ': el PV ' + k + ' se repite (fila ' + vistosPv[k + '#'] + '): las ventas no cruzarán bien.');
                        else { vistosPv[k] = id || ('fila' + n); vistosPv[k + '#'] = n; }
                        if (id) pvDeIdArchivo[id] = k;
                    }
                }
                if (!errFila) {
                    r.filasValidas++;
                    if (id && existentes[id]) r.actualizaciones++; else r.altas++;
                }
            });
            // PV del archivo que ya usa OTRO producto del catálogo (y el archivo no le cambia el PV).
            Object.keys(existentes).forEach(function(pid) {
                var p = existentes[pid];
                if (!p.pv || pvDeIdArchivo[pid] !== undefined) return;
                var kp = String(p.pv).toUpperCase().replace(/\s+/g, '');
                var due = vistosPv[kp];
                if (due && due !== pid) r.avisos.push('Fila ' + vistosPv[kp + '#'] + ': el PV ' + kp + ' se repite con el producto ' + pid + ' (' + (p.name || '') + ') del catálogo: las ventas no cruzarán bien.');
            });
            return r;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  CORTE DE EXISTENCIAS — validación y armado (capa pura)
        // ══════════════════════════════════════════════════════════════════════

        var COLUMNAS_EXISTENCIAS = {
            codigo:  ['Código', 'Codigo', 'ID', 'Id', 'Código insumo', 'Clave'],
            nombre:  ['Producto', 'Nombre', 'Descripción', 'Descripcion', 'Artículo', 'Articulo'],
            area:    ['Área', 'Area', 'Almacén', 'Almacen'],
            enteras: ['Enteras', 'Cerradas', 'Unidades cerradas', 'Cantidad'],
            abierta: ['Abierta', 'Abiertas', 'Fracción abierta', 'Fraccion abierta', 'Fracción', 'Fraccion'],
            // v5.21 — reporte de existencias de SBO: "En Stock" ya es el TOTAL
            // (cerradas + fracción abierta juntas). Sin Enteras ni Abierta.
            total:   ['En Stock', 'Stock', 'Existencia', 'Existencias', 'Cantidad total'],
            // En ese reporte "Almacén" es el CÓDIGO del almacén SAP (12 = barra),
            // no un área de conteo: se usa para dejar fuera otros almacenes.
            almacenSbo: ['Almacén', 'Almacen', 'Código almacén', 'Codigo almacen']
        };
        var COLUMNAS_AREA_EXISTENCIAS_TOTAL = ['Área', 'Area'];

        /**
         * importarValidarExistencias(filas, productos, areasDef, existenciaDe) — pura.
         * existenciaDe(producto) → { valor, origen } (el Total de hoy).
         * Devuelve saldos por producto (enteras + abierta, sumado por área), la
         * comparación contra el Total actual, y qué productos no vienen.
         *
         * v5.21 · DOS FORMAS de archivo (se detecta por las cabeceras):
         *   · Plantilla:  Código + Enteras (+ Abierta) (+ Área)      → modo 'enteras_abierta'
         *   · Total:      Código + "En Stock" (reporte de SBO)        → modo 'total'
         *     El valor ya es el TOTAL del producto. En este modo:
         *       – un código que no está en el catálogo se OMITE con aviso (el
         *         reporte es de todo el almacén; no nace del catálogo);
         *       – las filas de un almacén distinto de 12 se omiten con aviso;
         *       – opciones.faltantes decide qué pasa con los productos del
         *         catálogo que el reporte no lista: 'conservar' (por defecto:
         *         conservan su Total oficial) o 'cero' (SBO no lista lo que no
         *         tiene existencia → se registran en 0).
         */
        function importarValidarExistencias(filas, productos, areasDef, existenciaDe, opciones) {
            var opc = opciones || {};
            var r = { errores: [], avisos: [], saldos: {}, porArea: {}, contados: 0, total: (filas || []).length,
                      vacias: 0, noVienen: [], arrastrables: {}, comparacion: [], resumen: null,
                      modo: 'enteras_abierta', faltantes: 'conservar', enCero: [], ajenos: [], otroAlmacen: 0, cobertura: null };
            if (!filas || !filas.length) { r.errores.push('El archivo no trae filas.'); return r; }
            var cab = _impCabeceras(filas);
            var tieneEnt = _impTieneColumna(cab, COLUMNAS_EXISTENCIAS.enteras);
            var tieneTot = _impTieneColumna(cab, COLUMNAS_EXISTENCIAS.total);
            var modoTotal = tieneTot && !tieneEnt;
            r.modo = modoTotal ? 'total' : 'enteras_abierta';
            if (!_impTieneColumna(cab, COLUMNAS_EXISTENCIAS.codigo))  r.errores.push('Falta la columna "Código".');
            if (tieneTot && tieneEnt) r.errores.push('El archivo trae "En Stock" (total) y también "Enteras": usa una sola forma para no sumar dos veces.');
            else if (!tieneEnt && !tieneTot) r.errores.push('Falta la columna "Enteras" (o "En Stock" si el archivo trae el total).');
            if (tieneEnt && !_impTieneColumna(cab, COLUMNAS_EXISTENCIAS.abierta)) r.avisos.push('No hay columna "Abierta": se toma 0 en fracciones abiertas.');
            if (r.errores.length) return r;
            var colCant = modoTotal ? COLUMNAS_EXISTENCIAS.total : COLUMNAS_EXISTENCIAS.enteras;
            var colArea = modoTotal ? COLUMNAS_AREA_EXISTENCIAS_TOTAL : COLUMNAS_EXISTENCIAS.area;
            var almBarra = (typeof ALMACEN_BARRA_CODIGO !== 'undefined') ? String(ALMACEN_BARRA_CODIGO) : '12';

            var porId = {};
            (productos || []).forEach(function(p) { if (p && p.id) porId[String(p.id)] = p; });
            var areaPorClave = {};
            (areasDef || []).forEach(function(a) { areaPorClave[_impNorm(a.id)] = a.id; areaPorClave[_impNorm(a.nombre)] = a.id; });
            var vistos = {};   // id|area → fila

            filas.forEach(function(f, i) {
                var n = i + 2;
                var codigo = _impCol(f, COLUMNAS_EXISTENCIAS.codigo);
                codigo = (codigo === undefined || codigo === null) ? '' : String(codigo).trim();
                var entCrudo = _impCol(f, colCant);
                var abCrudo  = modoTotal ? undefined : _impCol(f, COLUMNAS_EXISTENCIAS.abierta);
                if (modoTotal) {
                    var alm = _impCol(f, COLUMNAS_EXISTENCIAS.almacenSbo);
                    var almT = (alm === undefined || alm === null) ? '' : String(alm).trim();
                    if (/^\d+$/.test(almT) && almT !== almBarra) { r.otroAlmacen++; return; }
                }
                if (!codigo) {
                    if (entCrudo !== undefined || abCrudo !== undefined) r.errores.push('Fila ' + n + ': trae cantidades pero no Código.');
                    return;
                }
                if (entCrudo === undefined && abCrudo === undefined) { r.vacias++; return; }   // no contado: se respeta
                var p = porId[codigo];
                if (!p) {
                    if (modoTotal) { r.ajenos.push({ codigo: codigo, nombre: String(_impCol(f, COLUMNAS_EXISTENCIAS.nombre) || '').trim(), fila: n }); return; }
                    r.errores.push('Fila ' + n + ': el código ' + codigo + ' no está en el catálogo.'); return;
                }
                var ent = _impNumero(entCrudo), ab = _impNumero(abCrudo);
                var mal = false;
                var etq = modoTotal ? 'En Stock' : 'Enteras';
                if (ent !== null && isNaN(ent)) { r.errores.push('Fila ' + n + ' (' + codigo + '): ' + etq + ' no es un número ("' + entCrudo + '").'); mal = true; }
                if (ab !== null && isNaN(ab))   { r.errores.push('Fila ' + n + ' (' + codigo + '): Abierta no es un número ("' + abCrudo + '").'); mal = true; }
                if (!mal && ent !== null && ent < 0) { r.errores.push('Fila ' + n + ' (' + codigo + '): ' + etq + (modoTotal ? ' negativo.' : ' negativas.')); mal = true; }
                if (!mal && ab !== null && ab < 0)   { r.errores.push('Fila ' + n + ' (' + codigo + '): Abierta negativa.'); mal = true; }
                if (mal) return;
                ent = ent || 0; ab = ab || 0;
                if (!modoTotal) {
                    var unidadPieza = /^(pza|pz|pieza|piezas|botella|botellas|unidad)$/i.test(String(p.unit || '').trim());
                    if (unidadPieza && Math.round(ent) !== ent) r.avisos.push('Fila ' + n + ' (' + codigo + '): ' + ent + ' enteras con decimales en un producto por pieza — ¿iba en "Abierta"?');
                    if (ab >= 1) r.avisos.push('Fila ' + n + ' (' + codigo + '): Abierta = ' + ab + ' (más de una unidad): se toma como suma de varias abiertas.');
                }

                var areaCrudo = _impCol(f, colArea);
                var area = '';
                if (areaCrudo !== undefined && String(areaCrudo).trim() !== '') {
                    area = areaPorClave[_impNorm(areaCrudo)] || '';
                    if (!area) { r.errores.push('Fila ' + n + ' (' + codigo + '): el área "' + areaCrudo + '" no existe.'); return; }
                }
                var clave = codigo + '|' + area;
                if (vistos[clave]) {
                    r.errores.push('Fila ' + n + ': el código ' + codigo + (area ? ' en ' + area : '') + ' está duplicado (también en la fila ' + vistos[clave] + ').');
                    return;
                }
                if ((area && vistos[codigo + '|']) || (!area && Object.keys(vistos).some(function(k) { return k.indexOf(codigo + '|') === 0 && k !== clave; }))) {
                    r.errores.push('Fila ' + n + ': el código ' + codigo + ' mezcla filas con área y sin área: usa una sola forma.');
                    return;
                }
                vistos[clave] = n;
                var cant = _impRed(ent + ab);
                r.saldos[codigo] = _impRed((r.saldos[codigo] || 0) + cant);
                if (area) { r.porArea[codigo] = r.porArea[codigo] || {}; r.porArea[codigo][area] = _impRed((r.porArea[codigo][area] || 0) + cant); }
            });

            r.contados = Object.keys(r.saldos).length;
            if (!r.contados && !r.errores.length) {
                r.errores.push(modoTotal && r.ajenos.length ? 'Ningún código del archivo coincide con tu catálogo: no hay nada que cortar.'
                                                            : 'Ninguna fila trae cantidades: no hay nada que cortar.');
            }
            if (modoTotal) {
                if (r.otroAlmacen) r.avisos.push(r.otroAlmacen + ' fila(s) son de un almacén distinto del ' + almBarra + ' (barra) y se omiten.');
                if (r.ajenos.length) {
                    var ej = r.ajenos.slice(0, 8).map(function(a) { return a.codigo + (a.nombre ? ' ' + a.nombre : ''); }).join('; ');
                    r.avisos.push(r.ajenos.length + ' código(s) del archivo no están en tu catálogo y se omiten: ' + ej + (r.ajenos.length > 8 ? '; y ' + (r.ajenos.length - 8) + ' más' : '') + '.');
                }
                r.cobertura = { archivo: r.contados, catalogo: (productos || []).length };
                // SBO no lista lo que no tiene existencia: el jefe decide en la vista previa.
                if (opc.faltantes === 'cero' && r.contados) {
                    r.faltantes = 'cero';
                    (productos || []).forEach(function(p) {
                        if (p && p.id && !Object.prototype.hasOwnProperty.call(r.saldos, p.id)) { r.saldos[p.id] = 0; r.enCero.push(p.id); }
                    });
                }
            }

            // Comparación contra el Total de hoy, y los que no vienen.
            var faltante = 0, sobrante = 0, sinPrecio = 0;
            (productos || []).forEach(function(p) {
                var ex = existenciaDe ? existenciaDe(p) : { valor: 0, origen: 'operativo_no_reconciliado' };
                var antes = _impRed(ex && typeof ex.valor === 'number' ? ex.valor : 0);
                if (Object.prototype.hasOwnProperty.call(r.saldos, p.id)) {
                    var dif = _impRed(r.saldos[p.id] - antes);
                    var precio = (typeof p.precio === 'number') ? p.precio : null;
                    if (dif && precio === null) sinPrecio++;
                    var dinero = (precio !== null) ? _impRed(dif * precio, 2) : null;
                    if (dinero !== null) { if (dinero < 0) faltante += dinero; else sobrante += dinero; }
                    r.comparacion.push({ id: p.id, nombre: p.name || p.id, unidad: p.unit || '', antes: antes, corte: r.saldos[p.id],
                                         dif: dif, origenAntes: ex.origen, dinero: dinero });
                } else {
                    r.noVienen.push(p.id);
                    // Conserva su Total actual SOLO si es oficial; si ya estaba en
                    // respaldo, sigue en respaldo (no se inventa una línea base).
                    if (ex && ex.origen === 'oficial') r.arrastrables[p.id] = antes;
                }
            });
            r.comparacion.sort(function(a, b) { return Math.abs(b.dinero || b.dif) - Math.abs(a.dinero || a.dif); });
            r.resumen = { faltante: _impRed(faltante, 2), sobrante: _impRed(sobrante, 2), neto: _impRed(faltante + sobrante, 2),
                          sinPrecio: sinPrecio, conDiferencia: r.comparacion.filter(function(c) { return Math.abs(c.dif) > 0.0005; }).length };
            if (r.enCero.length) {
                var bajan = r.comparacion.filter(function(c) { return r.enCero.indexOf(c.id) !== -1 && c.antes > 0.0005; }).length;
                r.avisos.push(r.enCero.length + ' producto(s) del catálogo no vienen en el archivo y se registran en 0 (' + bajan + ' tenían Total mayor a 0).');
            }
            if (r.noVienen.length) {
                r.avisos.push(r.noVienen.length + ' producto(s) del catálogo no vienen con cantidades: '
                    + Object.keys(r.arrastrables).length + ' conservan su Total actual dentro del corte; el resto sigue con la suma de áreas.');
            }
            return r;
        }

        /**
         * importarArmarCorte(validacion, opciones) — pura.
         * opciones: { fecha:'YYYY-MM-DD', hora:'HH:mm', archivo, uid, productos, existenciaDe }
         * Arma el documento de anclasExistencia/{fecha}_{HHmm}.
         */
        function importarArmarCorte(v, o) {
            var id = o.fecha + '_' + String(o.hora).replace(':', '');
            var saldos = {};
            Object.keys(v.saldos).forEach(function(k) { saldos[k] = v.saldos[k]; });
            Object.keys(v.arrastrables).forEach(function(k) { if (!(k in saldos)) saldos[k] = v.arrastrables[k]; });
            var previo = {};
            (o.productos || []).forEach(function(p) {
                var ex = o.existenciaDe ? o.existenciaDe(p) : null;
                if (ex) previo[p.id] = { valor: _impRed(ex.valor), origen: ex.origen === 'oficial' ? 'oficial' : 'respaldo' };
            });
            return {
                id: id,
                doc: {
                    fecha: o.fecha, hora: o.hora, tipo: 'importacion_excel',
                    semanaId: (typeof semanaId === 'function') ? semanaId(o.fecha) : null,
                    origen: { tipo: 'importacion_excel', inventoryId: 'excel:' + id, archivo: String(o.archivo || '').slice(0, 200) },
                    saldos: saldos,
                    porArea: v.porArea,
                    totalProductos: Object.keys(saldos).length,
                    productosContados: v.contados,
                    productosArrastrados: Object.keys(v.arrastrables).filter(function(k) { return !(k in v.saldos); }),
                    modoArchivo: v.modo || 'enteras_abierta',          // 'total' = reporte SBO ("En Stock")
                    faltantes: v.faltantes || 'conservar',
                    productosEnCero: (v.enCero || []).length,
                    previo: previo,                                    // el Total de cada producto ANTES del corte (histórico)
                    anclaAnterior: o.anclaAnterior || null,
                    resumen: v.resumen,
                    contabilizadoPor: o.uid || null,
                    contabilizadoEn: Date.now()
                }
            };
        }

        // ══════════════════════════════════════════════════════════════════════
        //  ARCHIVO → FILAS → VISTA PREVIA
        // ══════════════════════════════════════════════════════════════════════

        function _impExistenciaDe(p) {
            if (typeof existenciaOficial === 'function' && typeof EXISTENCIA_FUENTE_OFICIAL_ACTIVA !== 'undefined' && EXISTENCIA_FUENTE_OFICIAL_ACTIVA) {
                return existenciaOficial(p);
            }
            return { valor: (typeof getTotalStock === 'function') ? getTotalStock(p) : 0, origen: 'operativo_no_reconciliado' };
        }

        function _impAhora() {
            var d = new Date();
            return { fecha: (typeof fechaISOLocal === 'function') ? fechaISOLocal(d) : '',
                     hora: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') };
        }

        /** Abre el selector de archivo de una sección. */
        function importarElegirArchivo(seccion) {
            var s = IMPORTAR_SECCIONES.find(function(x) { return x.id === seccion; });
            if (!s) return;
            if (!hasPermission(s.permiso)) { showNotification('⚠️ No tienes permiso para importar ' + s.titulo.toLowerCase()); return; }
            importarSeccion = seccion;
            // Recetas, compras y ventas usan su importador de siempre (con su
            // vista previa); el módulo solo los reúne en un lugar.
            if (seccion === 'recetas') { recetarioImportView = 'lista'; recetarioImportarExcel(); return; }
            if (seccion === 'compras') { comprasImportView = 'lista'; comprasImportarExcel(); return; }
            if (seccion === 'ventas')  { ventasImportView = 'lista'; ventasImportarExcel(); return; }
            _impSeccionArchivo = seccion;
            var input = document.getElementById('impArchivo');
            if (input) { input.value = ''; input.click(); }
        }

        /** onchange de #impArchivo (catálogo y existencias). */
        function importarArchivoElegido(event) {
            var file = event && event.target && event.target.files && event.target.files[0];
            if (!file) return;
            var seccion = _impSeccionArchivo;
            if (typeof XLSX === 'undefined') { showNotification('⏳ Cargando la librería de Excel… intenta en unos segundos'); event.target.value = ''; return; }
            showNotification('⏳ Leyendo ' + file.name + '…');
            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    var nombre = (wb.SheetNames || []).find(function(n) { return _impNorm(n) !== 'instrucciones'; }) || (wb.SheetNames || [])[0];
                    if (!nombre) { showNotification('El archivo no contiene hojas'); return; }
                    var filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { defval: '' });
                    // Celdas vacías llegan como '' (defval): se dejan como "no viene".
                    filas = filas.map(function(f) { var o = {}; Object.keys(f).forEach(function(k) { if (f[k] !== '') o[k] = f[k]; }); return o; });
                    importarProcesarFilas(seccion, filas, file.name, file);
                } catch (err) {
                    console.error('[Importar] Error leyendo el archivo:', err);
                    showNotification('❌ No se pudo leer el archivo: ' + (err && err.message ? err.message : 'formato no reconocido'));
                }
            };
            reader.onerror = function() { showNotification('❌ Error leyendo el archivo'); };
            reader.readAsArrayBuffer(file);
            event.target.value = '';
        }

        /** Filas ya leídas → validación → vista previa. (Punto de entrada probado aparte.) */
        function importarProcesarFilas(seccion, filas, archivo, file) {
            importarSeccion = seccion;
            _impResultado = null;
            if (seccion === 'catalogo') {
                _impPendiente = { seccion: seccion, archivo: archivo, file: file || { name: archivo }, filas: filas,
                                  validacion: importarValidarCatalogo(filas, (typeof products !== 'undefined') ? products : []) };
            } else if (seccion === 'existencias') {
                var ahora = _impAhora();
                _impPendiente = { seccion: seccion, archivo: archivo, filas: filas, fecha: ahora.fecha, hora: ahora.hora, faltantes: 'conservar',
                                  validacion: importarValidarExistencias(filas, (typeof products !== 'undefined') ? products : [], _impAreasDef(), _impExistenciaDe, { faltantes: 'conservar' }) };
            } else {
                return;
            }
            activeTab = 'importar';
            renderTab();
        }

        function importarCancelar() {
            _impPendiente = null;
            _impResultado = null;
            importarSeccion = null;
            renderTab();
        }

        function importarVolver() {
            importarSeccion = null;
            _impPendiente = null;
            _impResultado = null;
            if (typeof recetarioImportView !== 'undefined') recetarioImportView = 'lista';
            if (typeof comprasImportView !== 'undefined') comprasImportView = 'lista';
            if (typeof ventasImportView !== 'undefined') ventasImportView = 'lista';
            renderTab();
        }

        function importarCambiarMomento(campo, valor) {
            if (!_impPendiente || _impPendiente.seccion !== 'existencias') return;
            _impPendiente[campo] = valor;
            renderTab();
        }

        /** v5.21 — Qué hacer con los productos del catálogo que el reporte de SBO no lista. */
        function importarCambiarFaltantes(valor) {
            if (!_impPendiente || _impPendiente.seccion !== 'existencias') return;
            _impPendiente.faltantes = (valor === 'cero') ? 'cero' : 'conservar';
            _impPendiente.validacion = importarValidarExistencias(_impPendiente.filas, (typeof products !== 'undefined') ? products : [], _impAreasDef(),
                                                                 _impExistenciaDe, { faltantes: _impPendiente.faltantes });
            renderTab();
        }

        /** ¿La fecha y hora del corte son válidas (no futuras)? */
        function importarValidarMomento(fecha, hora, ahora) {
            ahora = ahora || _impAhora();
            if (!fecha || !(typeof parseFechaLocal === 'function' ? parseFechaLocal(fecha) : /^\d{4}-\d{2}-\d{2}$/.test(fecha))) return 'Elige una fecha válida.';
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hora || ''))) return 'Elige una hora válida (HH:mm).';
            if (fecha > ahora.fecha || (fecha === ahora.fecha && hora > ahora.hora)) return 'El corte no puede ser en el futuro.';
            return null;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  APLICAR
        // ══════════════════════════════════════════════════════════════════════

        /** Catálogo: aplica con las reglas de siempre y publica en el mismo paso. */
        function importarAplicarCatalogo() {
            var p = _impPendiente;
            if (!p || p.seccion !== 'catalogo') return;
            if (!hasPermission('catalog.publish')) { showNotification('⚠️ No tienes permiso para importar el catálogo'); return; }
            if (p.validacion.errores.length) { showNotification('🛑 Corrige los errores del archivo antes de aplicar'); return; }
            var v = p.validacion;
            showConfirm('📦 APLICAR Y PUBLICAR CATÁLOGO\n\n' + v.altas + ' alta(s) · ' + v.actualizaciones + ' actualización(es)\n'
                + (v.avisos.length ? v.avisos.length + ' aviso(s) revisados\n' : '')
                + '\nSe crea un respaldo antes de aplicar. Una columna que falte no borra datos, y el conteo por área no se toca.\n'
                + 'Al terminar se publica a todos los dispositivos.\n\n¿Continuar?', function() {
                var evento = {
                    target: { files: [p.file || { name: p.archivo }], value: '' },
                    _filas: p.filas, _desdeModulo: true,
                    _alTerminar: async function(stats) {
                        var publicado = false;
                        if (typeof _db !== 'undefined' && _db && typeof publicarCatalogoFirestore === 'function') {
                            try { publicado = (await publicarCatalogoFirestore()) === true; } catch (e) { publicado = false; }
                        }
                        _impPendiente = null;
                        _impResultado = { seccion: 'catalogo', ok: true, stats: stats, publicado: publicado, archivo: p.archivo };
                        renderTab();
                    }
                };
                handleFileImport(evento);
            });
        }

        /** Corte de existencias: un solo documento (atómico), inmutable. */
        async function importarAplicarExistencias() {
            var p = _impPendiente;
            if (!p || p.seccion !== 'existencias') return;
            if (!hasPermission('inventory.post')) { showNotification('⚠️ No tienes permiso para registrar un corte de existencias'); return; }
            var errM = importarValidarMomento(p.fecha, p.hora);
            if (errM) { showNotification('🛑 ' + errM); return; }
            // Se vuelve a validar contra el Total de este instante: la vista
            // previa pudo quedar vieja (llegó una venta o una compra).
            p.validacion = importarValidarExistencias(p.filas, products, _impAreasDef(), _impExistenciaDe, { faltantes: p.faltantes });
            if (p.validacion.errores.length) { renderTab(); showNotification('🛑 Corrige los errores del archivo antes de aplicar'); return; }
            if (typeof _db === 'undefined' || !_db) { showNotification('📴 Sin conexión a Firestore'); return; }
            if (!navigator.onLine) { showNotification('📴 Sin conexión — conecta a internet para registrar el corte'); return; }
            if (typeof _anclaPosteriorA === 'function') {
                var post = await _anclaPosteriorA(p.fecha);
                if (post.error) { showNotification('📴 No se pudo comprobar si hay un corte más nuevo. No se guardó nada.'); return; }
                if (post.hay) { showNotification('🛑 Ya existe un corte más nuevo (' + post.desc + '): este no cambiaría el Total.'); return; }
            }
            var est = (typeof existenciaInicialEstado === 'function') ? existenciaInicialEstado() : null;
            var corte = importarArmarCorte(p.validacion, {
                fecha: p.fecha, hora: p.hora, archivo: p.archivo, uid: (typeof currentUserUid !== 'undefined') ? currentUserUid : null,
                productos: products, existenciaDe: _impExistenciaDe,
                anclaAnterior: (est && est.ancla) ? { id: est.ancla.id, tipo: est.ancla.tipo, fecha: est.ancla.fecha } : null
            });
            var v = p.validacion;
            showConfirm('🏷️ REGISTRAR CORTE DE EXISTENCIAS\n\nFecha y hora: ' + p.fecha + ' ' + p.hora + ' (vale al cierre de ese día)\n'
                + v.contados + ' producto(s) contados · ' + corte.doc.productosArrastrados.length + ' conservan su Total actual\n'
                + (v.modo === 'total' ? 'Archivo de SBO: "En Stock" tomado como el total de cada producto.\n' : '')
                + (v.enCero.length ? v.enCero.length + ' producto(s) que no vienen en el archivo quedan en 0\n' : '')
                + (v.resumen.conDiferencia ? v.resumen.conDiferencia + ' con diferencia contra el sistema · neto ' + _impDinero(v.resumen.neto) + '\n' : '')
                + '\nEl Total de cada producto partirá de este corte: se le sumarán las compras y se le restará el consumo por recetas POSTERIORES.\n'
                + 'El Total anterior queda guardado como histórico dentro del corte. Es INMUTABLE: no se edita ni se borra.\n\n¿Registrar?',
                async function() {
                    try {
                        if (typeof _crearBackupNombrado === 'function') _crearBackupNombrado('pre_corte_existencias_' + Date.now());
                        await _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID).collection('anclasExistencia').doc(corte.id).set(corte.doc);
                        if (typeof _registrarEnSyncQueue === 'function') {
                            _registrarEnSyncQueue({ tipo: 'corte_existencias', detalle: 'Corte de existencias importado ' + corte.id + ' (' + v.contados + ' productos)',
                                                    corteId: corte.id, archivo: p.archivo, motivo: 'Importación de existencias desde Excel' });
                        }
                        if (typeof existenciaInvalidarInicial === 'function') existenciaInvalidarInicial();
                        if (typeof existenciaCargarInicial === 'function') existenciaCargarInicial(function() { renderTab(); });
                        _impPendiente = null;
                        _impResultado = { seccion: 'existencias', ok: true, id: corte.id, contados: v.contados, enCero: v.enCero.length,
                                          arrastrados: corte.doc.productosArrastrados.length, resumen: v.resumen, archivo: p.archivo };
                        showNotification('✅ Corte ' + corte.id + ' registrado — el Total se recalcula desde aquí');
                        renderTab();
                    } catch (e) {
                        console.error('[Importar] Error guardando el corte:', e);
                        var denegado = e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
                        showNotification(denegado ? '🛑 El servidor rechazó el corte: ya existe uno con esa fecha y hora, o faltan las reglas de Firestore (despliega firestore.rules).'
                                                  : '❌ No se pudo guardar el corte: ' + (e && e.message ? e.message : 'error'));
                    }
                });
        }

        function _impDinero(n) {
            if (typeof n !== 'number' || !isFinite(n)) return '—';
            var s = Math.abs(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return (n < 0 ? '-$' : '$') + s;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  RENDER
        // ══════════════════════════════════════════════════════════════════════

        function _impMensajes(lista, tono, icono, max) {
            if (!lista || !lista.length) return '';
            var h = '<ul class="imp-msgs imp-msgs--' + tono + '" role="list">';
            lista.slice(0, max || 40).forEach(function(m) {
                h += '<li><i class="fa-solid ' + icono + '" aria-hidden="true"></i> <span>' + escapeHtml(m) + '</span></li>';
            });
            if (lista.length > (max || 40)) h += '<li><span>… y ' + (lista.length - (max || 40)) + ' más.</span></li>';
            return h + '</ul>';
        }

        function _impCabSeccion(titulo, sub) {
            return '<div class="imp-cab"><button type="button" class="imp-volver" onclick="importarVolver()" aria-label="Volver a Importar desde Excel">'
                 + '<i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>'
                 + '<div><div class="imp-cab__tit">' + escapeHtml(titulo) + '</div>'
                 + (sub ? '<div class="imp-cab__sub">' + sub + '</div>' : '') + '</div></div>';
        }

        function _renderImpCatalogo(p) {
            var v = p.validacion;
            var h = _impCabSeccion('Catálogo de productos', 'Vista previa de <b>' + escapeHtml(p.archivo || '') + '</b>');
            h += '<div class="imp-kpis">'
               + '<div class="imp-kpi"><span>Filas</span><b class="num">' + v.total + '</b></div>'
               + '<div class="imp-kpi"><span>Altas</span><b class="num">' + v.altas + '</b></div>'
               + '<div class="imp-kpi"><span>Actualizaciones</span><b class="num">' + v.actualizaciones + '</b></div>'
               + '<div class="imp-kpi' + (v.errores.length ? ' imp-kpi--mal' : '') + '"><span>Errores</span><b class="num">' + v.errores.length + '</b></div></div>';
            if (v.errores.length) {
                h += '<div class="imp-sub">Errores — corrígelos en el archivo y vuelve a subirlo</div>' + _impMensajes(v.errores, 'error', 'fa-circle-exclamation');
            } else {
                h += '<div class="imp-ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Sin errores: el archivo se puede aplicar.</div>';
            }
            if (v.avisos.length) h += '<div class="imp-sub">Avisos</div>' + _impMensajes(v.avisos, 'aviso', 'fa-triangle-exclamation', 20);
            h += '<div class="imp-acc">'
               + '<button type="button" class="bt bt--primario" id="impBtnAplicar" onclick="importarAplicarCatalogo()"' + (v.errores.length ? ' disabled aria-disabled="true"' : '') + '>'
               + '<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> Aplicar y publicar</button>'
               + '<button type="button" class="bt bt--secundario" onclick="importarCancelar()">Cancelar</button></div>';
            return h;
        }

        function _renderImpExistencias(p) {
            var v = p.validacion;
            var errM = importarValidarMomento(p.fecha, p.hora);
            var hoy = _impAhora().fecha;
            var h = _impCabSeccion('Corte de existencias', 'Vista previa de <b>' + escapeHtml(p.archivo || '') + '</b>');
            h += '<section class="imp-momento" aria-labelledby="impMomTit"><div id="impMomTit" class="imp-sub">Fecha y hora del corte</div>'
               + '<div class="imp-momento__campos">'
               + '<label class="imp-campo">Fecha<input type="date" id="impFecha" value="' + escapeHtml(p.fecha || '') + '" max="' + hoy + '" onchange="importarCambiarMomento(\'fecha\', this.value)"></label>'
               + '<label class="imp-campo">Hora<input type="time" id="impHora" value="' + escapeHtml(p.hora || '') + '" onchange="importarCambiarMomento(\'hora\', this.value)"></label></div>'
               + '<div class="imp-ayuda">El corte vale <b>al cierre de ese día</b>: lo vendido y comprado ese mismo día ya está dentro del conteo. '
               + 'La hora queda guardada para el histórico.</div>'
               + (errM ? _impMensajes([errM], 'error', 'fa-circle-exclamation') : '') + '</section>';
            if (v.modo === 'total') {
                var nFalt = v.enCero.length || v.noVienen.length;
                h += '<section class="imp-momento" aria-labelledby="impFaltTit"><div id="impFaltTit" class="imp-sub">Archivo de SBO · total por producto</div>'
                   + '<div class="imp-ayuda">Se tomó <b>"En Stock"</b> como el total de cada producto (cerradas y abiertas juntas), solo del almacén 12. '
                   + (v.cobertura ? 'Cubre <b>' + v.cobertura.archivo + '</b> de <b>' + v.cobertura.catalogo + '</b> productos de tu catálogo.' : '') + '</div>'
                   + '<div class="imp-sub">Productos del catálogo que el archivo no lista (' + nFalt + ')</div>'
                   + '<div class="imp-opciones" role="radiogroup" aria-labelledby="impFaltTit">'
                   + '<label class="imp-opcion"><input type="radio" name="impFalt" value="conservar"' + (v.faltantes !== 'cero' ? ' checked' : '') + ' onchange="importarCambiarFaltantes(this.value)">'
                   + '<span><b>Conservar su Total actual</b><small>No se tocan: siguen con el Total de hoy (si es oficial).</small></span></label>'
                   + '<label class="imp-opcion"><input type="radio" name="impFalt" value="cero"' + (v.faltantes === 'cero' ? ' checked' : '') + ' onchange="importarCambiarFaltantes(this.value)">'
                   + '<span><b>Ponerlos en 0</b><small>SBO solo lista lo que tiene existencia: lo que no aparece, vale 0.</small></span></label></div></section>';
            }
            h += '<div class="imp-kpis">'
               + '<div class="imp-kpi"><span>Contados</span><b class="num">' + v.contados + '</b></div>'
               + (v.enCero.length ? '<div class="imp-kpi"><span>En 0 (no vienen)</span><b class="num">' + v.enCero.length + '</b></div>'
                                   : '<div class="imp-kpi"><span>Sin capturar</span><b class="num">' + v.noVienen.length + '</b></div>')
               + '<div class="imp-kpi' + (v.resumen && v.resumen.neto < 0 ? ' imp-kpi--mal' : '') + '"><span>Neto vs sistema</span><b class="num">' + (v.resumen ? _impDinero(v.resumen.neto) : '—') + '</b></div>'
               + '<div class="imp-kpi' + (v.errores.length ? ' imp-kpi--mal' : '') + '"><span>Errores</span><b class="num">' + v.errores.length + '</b></div></div>';
            if (v.errores.length) h += '<div class="imp-sub">Errores — corrígelos en el archivo y vuelve a subirlo</div>' + _impMensajes(v.errores, 'error', 'fa-circle-exclamation');
            else h += '<div class="imp-ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Sin errores: el corte se puede registrar.</div>';
            if (v.avisos.length) h += '<div class="imp-sub">Avisos</div>' + _impMensajes(v.avisos, 'aviso', 'fa-triangle-exclamation', 20);
            var conDif = v.comparacion.filter(function(c) { return Math.abs(c.dif) > 0.0005; });
            if (conDif.length) {
                h += '<div class="imp-sub">Corte contra el Total de hoy (' + conDif.length + ' con diferencia)</div>'
                   + '<table class="imp-tabla"><thead><tr><th scope="col">Producto</th><th scope="col" class="imp-num">Corte</th><th scope="col" class="imp-num">Dif.</th></tr></thead><tbody>';
                conDif.slice(0, 50).forEach(function(c) {
                    h += '<tr><td>' + escapeHtml(c.nombre) + '<div class="imp-meta">Sistema <span class="num">' + c.antes + '</span> ' + escapeHtml(c.unidad)
                       + (c.origenAntes !== 'oficial' ? ' · respaldo' : '') + '</div></td>'
                       + '<td class="imp-num">' + c.corte + '</td>'
                       + '<td class="imp-num ' + (c.dif < 0 ? 'imp-mal' : 'imp-bien') + '">' + (c.dif > 0 ? '+' : (c.dif < 0 ? '−' : '')) + Math.abs(c.dif)
                       + (c.dinero !== null ? '<div class="imp-meta">' + _impDinero(c.dinero) + '</div>' : '') + '</td></tr>';
                });
                h += '</tbody></table>' + (conDif.length > 50 ? '<div class="imp-ayuda">Se muestran las 50 de mayor importe.</div>' : '');
            }
            var bloqueado = v.errores.length || errM;
            h += '<div class="imp-acc">'
               + '<button type="button" class="bt bt--primario" id="impBtnAplicar" onclick="importarAplicarExistencias()"' + (bloqueado ? ' disabled aria-disabled="true"' : '') + '>'
               + '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Registrar corte</button>'
               + '<button type="button" class="bt bt--secundario" onclick="importarCancelar()">Cancelar</button></div>';
            return h;
        }

        function _renderImpResultado(r) {
            var h = _impCabSeccion(r.seccion === 'catalogo' ? 'Catálogo de productos' : 'Corte de existencias', 'Resultado');
            if (r.seccion === 'catalogo') {
                var s = r.stats || {};
                h += '<div class="imp-ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Catálogo aplicado: <b>' + (s.nuevos || 0) + '</b> alta(s), <b>' + (s.actualizados || 0) + '</b> actualización(es).</div>';
                h += r.publicado
                    ? '<div class="imp-ok"><i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> Publicado a todos los dispositivos.</div>'
                    : _impMensajes(['Se aplicó en este dispositivo, pero NO se pudo publicar (sin conexión o sin permiso). Publícalo desde Productos con "Publicar catálogo" cuando haya conexión.'], 'aviso', 'fa-triangle-exclamation');
                if (s.pvRepetidos && s.pvRepetidos.length) h += _impMensajes(['PV repetidos: ' + s.pvRepetidos.slice(0, 6).join(', ') + ' — las ventas no cruzarán bien hasta corregirlos.'], 'aviso', 'fa-triangle-exclamation');
            } else {
                h += '<div class="imp-ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Corte <b>' + escapeHtml(r.id) + '</b> registrado: '
                   + r.contados + ' producto(s) contados, ' + r.arrastrados + ' conservan su Total'
                   + (r.enCero ? ', ' + r.enCero + ' quedaron en 0' : '') + '.</div>'
                   + '<div class="imp-ayuda">Desde ahora el Total = este corte + compras posteriores − consumo por recetas posterior. '
                   + 'Lo ves en Inicio → "Origen del Total" y en la ficha de cada producto.</div>';
            }
            h += '<div class="imp-acc"><button type="button" class="bt bt--primario" onclick="importarVolver()">Listo</button></div>';
            return h;
        }

        function _renderImpHub() {
            var h = '<div class="imp-cab"><div><div class="imp-cab__tit">Importar desde Excel</div>'
                  + '<div class="imp-cab__sub">Descarga la plantilla, llénala y súbela. Todo se valida antes de guardar: duplicados, categorías vacías y números erróneos se marcan y no se aplica nada hasta corregirlos.</div></div></div>';
            h += '<div class="imp-grid">';
            IMPORTAR_SECCIONES.forEach(function(s) {
                var puede = hasPermission(s.permiso);
                h += '<section class="imp-sec' + (puede ? '' : ' imp-sec--bloq') + '" aria-labelledby="impSec-' + s.id + '">'
                   + '<div class="imp-sec__cab"><i class="fa-solid ' + s.icono + ' imp-sec__ico" aria-hidden="true"></i>'
                   + '<div id="impSec-' + s.id + '" class="imp-sec__tit">' + escapeHtml(s.titulo) + '</div></div>'
                   + '<div class="imp-sec__desc">' + escapeHtml(s.desc) + '</div>';
                if (!puede) {
                    h += '<div class="imp-sec__lock"><i class="fa-solid fa-lock" aria-hidden="true"></i> Sin permiso</div></section>';
                    return;
                }
                h += '<div class="imp-sec__acc">'
                   + '<button type="button" class="bt bt--primario" data-imp-subir="' + s.id + '" onclick="importarElegirArchivo(\'' + s.id + '\')">'
                   + '<i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i> Subir archivo</button>';
                s.formatos.forEach(function(f) {
                    h += '<button type="button" class="bt bt--secundario" data-imp-plantilla="' + s.id + ':' + f + '" onclick="importarDescargarPlantilla(\'' + s.id + '\', \'' + f + '\')">'
                       + '<i class="fa-solid fa-download" aria-hidden="true"></i> Plantilla .' + f + '</button>';
                });
                h += '</div></section>';
            });
            return h + '</div>';
        }

        function renderImportarTab() {
            var alguna = IMPORTAR_SECCIONES.some(function(s) { return hasPermission(s.permiso); });
            if (!alguna) return '<div class="imp-wrap"><div class="imp-vacio"><i class="fa-solid fa-lock" aria-hidden="true"></i> No tienes permiso para importar.</div></div>';
            var cuerpo;
            // Las vistas previas de recetas, compras y ventas son las de su
            // importador de siempre: se muestran aquí, dentro del módulo.
            if (importarSeccion === 'recetas' && typeof recetarioImportView !== 'undefined' && recetarioImportView !== 'lista') {
                cuerpo = _impCabSeccion('Recetario', null) + renderRecetarioTab();
            } else if (importarSeccion === 'compras' && typeof comprasImportView !== 'undefined' && comprasImportView !== 'lista') {
                cuerpo = _impCabSeccion('Compras (entrada de mercancía SAP)', null) + renderComprasTab();
            } else if (importarSeccion === 'ventas' && typeof ventasImportView !== 'undefined' && ventasImportView !== 'lista') {
                cuerpo = _impCabSeccion('Ventas del POS (Parrot)', null) + renderVentasTab();
            } else if (_impResultado) {
                cuerpo = _renderImpResultado(_impResultado);
            } else if (_impPendiente && _impPendiente.seccion === 'catalogo') {
                cuerpo = _renderImpCatalogo(_impPendiente);
            } else if (_impPendiente && _impPendiente.seccion === 'existencias') {
                cuerpo = _renderImpExistencias(_impPendiente);
            } else {
                cuerpo = _renderImpHub();
            }
            return '<div class="imp-wrap">' + cuerpo + '</div>';
        }

        (function _impConectarInput() {
            var el = document.getElementById('impArchivo');
            if (el) el.addEventListener('change', importarArchivoElegido);
        })();

        window.IMPORTAR_SECCIONES        = IMPORTAR_SECCIONES;
        window.importarPlantilla         = importarPlantilla;
        window.importarPlantillaCsv      = importarPlantillaCsv;
        window.importarDescargarPlantilla = importarDescargarPlantilla;
        window.importarValidarCatalogo   = importarValidarCatalogo;
        window.importarValidarExistencias = importarValidarExistencias;
        window.importarArmarCorte        = importarArmarCorte;
        window.importarValidarMomento    = importarValidarMomento;
        window.importarElegirArchivo     = importarElegirArchivo;
        window.importarArchivoElegido    = importarArchivoElegido;
        window.importarCambiarFaltantes  = importarCambiarFaltantes;
        window.importarProcesarFilas     = importarProcesarFilas;
        window.importarAplicarCatalogo   = importarAplicarCatalogo;
        window.importarAplicarExistencias = importarAplicarExistencias;
        window.importarCancelar          = importarCancelar;
        window.importarVolver            = importarVolver;
        window.importarCambiarMomento    = importarCambiarMomento;
        window.renderImportarTab         = renderImportarTab;
