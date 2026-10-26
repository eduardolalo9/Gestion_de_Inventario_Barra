        // ══════════════════════════════════════════════════════════════════════
        //  v5.35 — EXPORTAR DIFERENCIAS DE «FÍSICO VS SISTEMA» A EXCEL
        //  ────────────────────────────────────────────────────────────────────
        //  Encargo de Eduardo (26-oct-2026). Hoja «Diferencias» con EXACTAMENTE
        //  estas columnas, en este orden:
        //    Grupo · ID · Descripción · Unidad · Cantidad en sistema ·
        //    Cantidad contada · Diferencia · Precio · Precio total de diferencia
        //  Archivo: Diferencias_Fisico_y_Sistema_YYYY-MM-DD.xlsx
        //
        //  FUENTE — las filas que ya calculó fisicoVsSistemaCalcular() (js/49),
        //  la misma tabla que se ve en pantalla. Este módulo NO recalcula la
        //  existencia ni el conteo: lee f.sistema, f.fisico y f.diferencia.
        //    Diferencia                = contada − sistema (convención de la app:
        //                                negativo = faltante, positivo = sobrante)
        //    Precio total de diferencia = Diferencia × Precio, a 2 decimales
        //                                (la misma cuenta que el «Neto» de la app)
        //
        //  NUNCA un cero inventado:
        //    · producto sin contar → Cantidad contada, Diferencia y Precio total
        //      VACÍOS (no 0). La fila sí sale: no se excluye en silencio.
        //    · producto sin precio válido en el catálogo → Precio y Precio total
        //      VACÍOS. (La pantalla, como siempre, suma 0 a su Neto; el Excel no
        //      inventa un precio.) Se cuenta en la hoja «Información».
        //
        //  ALCANCE — el grupo elegido con «Grupo» (o todos), en el MISMO orden
        //  visible (por grupo o «Diferencias ↑»). La búsqueda de texto y el
        //  chip «Solo con diferencias» NO recortan el archivo: así nunca se
        //  quedan fuera, sin aviso, los productos en cero o sin contar.
        //
        //  SOLO LEE. No escribe en products, conteos, existencias,
        //  localStorage ni Firestore.
        // ══════════════════════════════════════════════════════════════════════

        var FVS_EXPORT_COLUMNAS = ['Grupo', 'ID', 'Descripción', 'Unidad', 'Cantidad en sistema',
                                   'Cantidad contada', 'Diferencia', 'Precio', 'Precio total de diferencia'];
        var FVS_FMT_CANT   = '#,##0.00#;-#,##0.00#;0.00';
        var FVS_FMT_DIF    = '+#,##0.00#;-#,##0.00#;0.00';
        var FVS_FMT_MONEDA = '"$"#,##0.00;-"$"#,##0.00;"$"0.00';
        var _fvsExport = { enCurso: false };

        // ── Capa pura (se prueba aislada, sin DOM ni Firebase) ───────────────

        /** Nombre con la fecha LOCAL. */
        function fvsExportNombre(fecha) {
            var d = fecha || new Date();
            var p = function(n) { return (n < 10 ? '0' : '') + n; };
            return 'Diferencias_Fisico_y_Sistema_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.xlsx';
        }

        function _fvsNumValido(v) { return typeof v === 'number' && isFinite(v); }

        /** Precio unitario del producto, o null si no hay uno válido (nunca se inventa). */
        function fvsExportPrecio(p) {
            return (p && _fvsNumValido(p.precio) && p.precio >= 0) ? p.precio : null;
        }

        /**
         * Filas del Excel, en el orden recibido (el visible).
         * productoDe(id) → el producto del catálogo (para el precio).
         */
        function fvsExportFilas(filasVista, productoDe) {
            return (filasVista || []).map(function(f) {
                var p = productoDe ? productoDe(f.id) : null;
                var contado = f.estado !== 'pendiente' && _fvsNumValido(f.fisico) && _fvsNumValido(f.diferencia);
                var precio = fvsExportPrecio(p);
                var dif = contado ? f.diferencia : null;
                var total = (dif !== null && precio !== null) ? Math.round(dif * precio * 100) / 100 : null;
                if (total === 0) total = 0;   // sin "-0"
                return {
                    grupo:       f.grupo || 'General',
                    id:          String(f.id),
                    descripcion: (f.nombre !== undefined && f.nombre !== null) ? String(f.nombre) : '',
                    unidad:      f.unidad ? String(f.unidad) : '',
                    sistema:     _fvsNumValido(f.sistema) ? f.sistema : null,
                    contada:     contado ? f.fisico : null,
                    diferencia:  dif,
                    precio:      precio,
                    total:       total,
                    estado:      contado ? 'contado' : 'pendiente'
                };
            });
        }

        /** Arma el libro (sin escribirlo). X = la librería XLSX. */
        function fvsExportLibro(X, filas, info) {
            var aoa = [FVS_EXPORT_COLUMNAS.slice()];
            filas.forEach(function(f) {
                aoa.push([f.grupo, f.id, f.descripcion, f.unidad, f.sistema, f.contada, f.diferencia, f.precio, f.total]);
            });
            var ws = X.utils.aoa_to_sheet(aoa);
            var formatos = { 4: FVS_FMT_CANT, 5: FVS_FMT_CANT, 6: FVS_FMT_DIF, 7: FVS_FMT_MONEDA, 8: FVS_FMT_MONEDA };
            for (var r = 1; r < aoa.length; r++) {
                // ID siempre como texto: un código "0012" no puede volverse 12.
                var refId = X.utils.encode_cell({ r: r, c: 1 });
                ws[refId] = { t: 's', v: filas[r - 1].id };
                for (var c = 4; c <= 8; c++) {
                    var ref = X.utils.encode_cell({ r: r, c: c });
                    if (aoa[r][c] === null || aoa[r][c] === undefined) { delete ws[ref]; continue; }   // vacío, nunca 0
                    ws[ref] = { t: 'n', v: aoa[r][c], z: formatos[c] };
                }
            }
            var ancho = function(i, min, max) {
                var m = min;
                aoa.forEach(function(fila) { var s = (fila[i] === null || fila[i] === undefined) ? '' : String(fila[i]); if (s.length > m) m = s.length; });
                return { wch: Math.min(max, m + 2) };
            };
            ws['!cols'] = [ancho(0, 8, 26), ancho(1, 6, 16), ancho(2, 14, 54), ancho(3, 7, 14),
                           { wch: 19 }, { wch: 17 }, { wch: 12 }, { wch: 12 }, { wch: 25 }];
            ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, aoa.length - 1), c: FVS_EXPORT_COLUMNAS.length - 1 } }) };

            var contados = filas.filter(function(f) { return f.estado === 'contado'; }).length;
            var sinPrecio = filas.filter(function(f) { return f.precio === null; }).length;
            var inf = [['Concepto', 'Valor'],
                ['Generado', info.generado || ''],
                ['Usuario', info.usuario || ''],
                ['Versión de la app', info.version || ''],
                ['Inventario Físico', info.inventario || ''],
                ['Alcance', info.alcance || ''],
                ['Orden', info.orden || ''],
                ['Productos exportados', filas.length],
                ['Contados', contados],
                ['Sin contar', filas.length - contados],
                ['Sin precio válido', sinPrecio],
                ['Diferencia', 'Cantidad contada − Cantidad en sistema. Negativo = faltante; positivo = sobrante.'],
                ['Precio total de diferencia', 'Diferencia × Precio, redondeado a 2 decimales (igual que el Neto de la app).'],
                ['Celdas vacías', 'Cantidad contada, Diferencia y Precio total vacíos = producto sin contar (no es cero). '
                                + 'Precio y Precio total vacíos = el producto no tiene precio válido en el catálogo (no se inventa).'],
                ['Cantidad en sistema', 'La misma cifra «Sistema» de la pantalla Físico vs Sistema.'
                                      + (info.sinInicial ? ' ' + info.sinInicial + ' producto(s) comparan contra el stock operativo: no hay inicial contabilizado para ellos esta semana.' : '')]];
            var wsI = X.utils.aoa_to_sheet(inf);
            wsI['!cols'] = [{ wch: 28 }, { wch: 110 }];

            var wb = X.utils.book_new();
            X.utils.book_append_sheet(wb, ws, 'Diferencias');
            X.utils.book_append_sheet(wb, wsI, 'Información');
            wb.Props = { Title: 'Diferencias Físico y Sistema', Author: info.usuario || 'BarInventory', CreatedDate: new Date() };
            return wb;
        }

        // ── Capa de aplicación (lee el estado de la app; no escribe datos) ───

        function _fvsPuedeExportar() {
            return typeof hasPermission === 'function' && hasPermission('inventory.viewAll') && hasPermission('inventory.export');
        }

        function _fvsTextoAlcance(op) { return op && op.grupo ? 'Grupo «' + op.grupo + '»' : 'Todos los grupos'; }
        function _fvsTextoOrden(op) {
            if (op && op.difAsc) return 'Diferencias de menor a mayor (sin agrupar)';
            return 'Por grupo · diferencia ' + (op && op.orden === 'mayor_menor' ? 'mayor → menor' : 'menor → mayor');
        }

        /** HTML del botón y de la nota de alcance (lo inserta _fvsControlesHtml). Vacío sin permiso. */
        function fvsExportBotonHtml(datos, op) {
            if (!_fvsPuedeExportar() || !datos) return '';
            var n = fisicoVsSistemaFiltrarGrupo(datos.filas, op && op.grupo).length;
            var oc = _fvsExport.enCurso;
            return '<button type="button" id="fvsExportBtn" class="fvs-ctl__btn fvs-ctl__btn--excel" onclick="exportarDiferenciasExcel()"'
                 + (oc ? ' disabled aria-busy="true"' : ' aria-busy="false"')
                 + ' title="Descargar Grupo, ID, Descripción, Unidad, Cantidad en sistema, Cantidad contada, Diferencia, Precio y Precio total de diferencia">'
                 + '<i class="fa-solid ' + (oc ? 'fa-arrows-rotate fa-spin' : 'fa-file-excel') + '" aria-hidden="true"></i>'
                 + '<span>' + (oc ? 'Generando Excel…' : 'Exportar diferencias a Excel') + '</span></button>'
                 + '<p class="fvs-ctl__alcance" id="fvsExportAlcance">Excel: ' + n + ' producto' + (n === 1 ? '' : 's') + ' · '
                 + escapeHtml(_fvsTextoAlcance(op)) + ' · en el orden de la tabla. Incluye los que coinciden y los sin contar; '
                 + 'no lo recortan la búsqueda ni «Solo con diferencias».</p>';
        }

        function _fvsPintarBoton(ocupado) {
            var b = document.getElementById('fvsExportBtn');
            if (!b) return;
            b.disabled = !!ocupado;
            b.setAttribute('aria-busy', ocupado ? 'true' : 'false');
            var ico = b.querySelector('i'), txt = b.querySelector('span');
            if (ico) ico.className = ocupado ? 'fa-solid fa-arrows-rotate fa-spin' : 'fa-solid fa-file-excel';
            if (txt) txt.textContent = ocupado ? 'Generando Excel…' : 'Exportar diferencias a Excel';
        }

        function _fvsDescargar(bytes, nombre) {
            if (typeof _exDescargar === 'function') { _exDescargar(bytes, nombre); return; }   // el de js/97
            var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = nombre; a.style.display = 'none';
            document.body.appendChild(a); a.click();
            setTimeout(function() { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
        }

        /**
         * Botón «Exportar diferencias a Excel». Devuelve { ok, motivo, nombre?, filas? }
         * (las pruebas lo leen). Una exportación a la vez.
         */
        function exportarDiferenciasExcel() {
            if (_fvsExport.enCurso) return { ok: false, motivo: 'en_curso' };
            if (!_fvsPuedeExportar()) {
                showNotification('⚠️ No tienes permiso para exportar el inventario');
                return { ok: false, motivo: 'sin_permiso' };
            }
            if (typeof XLSX === 'undefined') {
                showNotification('⏳ Cargando la librería de Excel… intenta en unos segundos');
                return { ok: false, motivo: 'sin_xlsx' };
            }
            var datos = (typeof fisicoVsSistemaCalcular === 'function') ? fisicoVsSistemaCalcular() : null;
            if (!datos) {
                showNotification('⚠️ No hay un Inventario Físico abierto para comparar');
                return { ok: false, motivo: 'sin_inventario' };
            }
            var op = (typeof _fvsOpcionesVista === 'function') ? _fvsOpcionesVista() : { grupo: null, difAsc: false, orden: 'menor_mayor' };
            var vista = fisicoVsSistemaOrdenVisible(datos.filas, op);
            if (!vista.filas.length) {
                showNotification('⚠️ No hay productos en este grupo para exportar');
                return { ok: false, motivo: 'sin_filas' };
            }
            _fvsExport.enCurso = true;
            _fvsPintarBoton(true);
            try {
                var porId = {};
                (Array.isArray(products) ? products : []).forEach(function(p) { if (p && !porId[p.id]) porId[p.id] = p; });
                var filas = fvsExportFilas(vista.filas, function(id) { return porId[id] || null; });
                var ahora = new Date();
                var cuenta = (typeof _auth !== 'undefined' && _auth && _auth.currentUser) ? _auth.currentUser : null;
                var info = {
                    generado:   ahora.toLocaleString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
                    usuario:    cuenta ? (cuenta.email || cuenta.uid) : ((typeof currentUserUid !== 'undefined' && currentUserUid) ? currentUserUid : 'Sin sesión'),
                    version:    (typeof _exVersionApp === 'function') ? _exVersionApp() : '',
                    inventario: datos.numero ? '#' + datos.numero : (datos.inventoryId || ''),
                    alcance:    _fvsTextoAlcance(op),
                    orden:      _fvsTextoOrden(op),
                    sinInicial: datos.sinInicial || 0
                };
                var nombre = fvsExportNombre(ahora);
                var wb = fvsExportLibro(XLSX, filas, info);
                var bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
                // Fila de encabezados fija: el mismo mecanismo probado de js/97.
                var fijo = (typeof existenciasExportCongelar === 'function') ? existenciasExportCongelar(XLSX, bytes, 1) : null;
                _fvsDescargar(fijo || bytes, nombre);
                var sinContar = filas.filter(function(f) { return f.estado === 'pendiente'; }).length;
                var sinPrecio = filas.filter(function(f) { return f.precio === null; }).length;
                showNotification('✅ ' + nombre + ' — ' + filas.length + ' producto(s)'
                    + (sinContar ? ' · ' + sinContar + ' sin contar' : '') + (sinPrecio ? ' · ' + sinPrecio + ' sin precio' : ''));
                return { ok: true, motivo: null, nombre: nombre, filas: filas, filaFija: !!fijo };
            } catch (e) {
                console.error('[ExportarDiferencias] Error al generar el Excel:', e);
                showNotification('❌ No se pudo generar el Excel de diferencias: ' + (e && e.message ? e.message : e));
                return { ok: false, motivo: 'error_generar' };
            } finally {
                _fvsExport.enCurso = false;
                _fvsPintarBoton(false);
            }
        }

        if (typeof window !== "undefined") window.exportarDiferenciasExcel = exportarDiferenciasExcel;
