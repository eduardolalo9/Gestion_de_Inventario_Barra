        // ══════════════════════════════════════════════════════════════════════
        //  v5.32 — EXPORTAR EXISTENCIAS ACTUALES A EXCEL
        //  ────────────────────────────────────────────────────────────────────
        //  Encargo de Eduardo (21-oct-2026): botón «Exportar existencias a
        //  Excel» en Productos. Hoja principal con EXACTAMENTE estas columnas:
        //      Grupo · ID · Descripción · Unidad · En existencia
        //  Encabezado, filtros, primera fila fija y anchos de columna.
        //  Archivo: Existencias_BarInventory_YYYY-MM-DD.xlsx
        //
        //  FUENTE — la misma cifra que la app muestra en la columna Stock del
        //  catálogo, en Inicio y en el pedido sugerido: existenciaOficial()
        //  de js/47 (corte contabilizado + compras − consumo teórico; o, si
        //  el producto no tiene saldo en el corte, la suma de áreas del
        //  conteo, marcada como respaldo). Este módulo NO calcula una
        //  existencia propia: si lo hiciera, el Excel y la pantalla podrían
        //  decir cosas distintas.
        //
        //  SOLO LEE. No escribe en products, stockByArea, conteos, compras,
        //  movimientos, localStorage ni Firestore. Las únicas lecturas a la
        //  nube son las que la app ya hace (existenciaCargarInicial y el
        //  Total publicado), y solo si todavía no se habían hecho.
        //
        //  NUNCA un cero silencioso:
        //    · si el corte o el Total publicado no se pudieron leer, NO se
        //      exporta (se dice por qué);
        //    · si siguen cargando, se espera unos segundos y, si no llegan,
        //      NO se exporta;
        //    · lo que sí se exporta con salvedades (respaldo por área, compras
        //      que el Total todavía no refleja, ventas sin cargar, cambios sin
        //      sincronizar) se pide confirmar antes y queda escrito en las
        //      hojas «Auditoría» e «Información» del mismo archivo.
        // ══════════════════════════════════════════════════════════════════════

        var EXISTENCIAS_EXPORT_COLUMNAS = ['Grupo', 'ID', 'Descripción', 'Unidad', 'En existencia'];
        var EXISTENCIAS_EXPORT_ESPERA_MS = 15000;   // tope para esperar el corte / Total publicado
        var _exExport = { enCurso: false };

        function _exRed(n) { return Math.round(n * 1000) / 1000; }

        // ── Capa pura (se prueba aislada, sin DOM ni Firebase) ───────────────

        /** Nombre del archivo con la fecha LOCAL (no UTC: a las 11 pm sería mañana). */
        function existenciasExportNombre(fecha) {
            var d = fecha || new Date();
            var p = function(n) { return (n < 10 ? '0' : '') + n; };
            return 'Existencias_BarInventory_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.xlsx';
        }

        /**
         * Filas del Excel, una por producto, en el orden del catálogo.
         * existenciaDe(p) → el objeto de existenciaOficial().
         * Un ID repetido sale UNA vez (la primera, igual que el catálogo) y se
         * reporta; un producto sin ID no se puede identificar y se reporta.
         * Una cifra que no es un número finito se deja VACÍA (nunca 0) y se
         * reporta.
         */
        function existenciasExportFilas(productos, existenciaDe) {
            var filas = [], vistos = {}, duplicados = [], sinId = 0, noNumericos = [];
            (Array.isArray(productos) ? productos : []).forEach(function(p) {
                if (!p || p.id === undefined || p.id === null || String(p.id).trim() === '') { sinId++; return; }
                var id = String(p.id);
                if (vistos[id]) { duplicados.push(id); return; }
                vistos[id] = true;
                var r = existenciaDe(p) || {};
                var v = Number(r.valor);
                var valido = (typeof r.valor === 'number') && isFinite(v);
                if (!valido) noNumericos.push(id);
                filas.push({
                    grupo:       (p.group && String(p.group).trim()) ? String(p.group) : 'General',
                    id:          id,
                    descripcion: (p.name !== undefined && p.name !== null) ? String(p.name) : '',
                    unidad:      (p.unit !== undefined && p.unit !== null) ? String(p.unit) : '',
                    existencia:  valido ? _exRed(v) : null,
                    origen:      r.fuente === 'publicado' ? 'publicado' : (r.origen === 'oficial' ? 'oficial' : 'respaldo'),
                    inicial:     (typeof r.inicial === 'number') ? r.inicial : null,
                    entradas:    Number(r.entradas) || 0,
                    ventas:      Number(r.ventas) || 0,
                    operativa:   (typeof r.operativa === 'number' && isFinite(r.operativa)) ? _exRed(r.operativa) : null
                });
            });
            return { filas: filas, duplicados: duplicados, sinId: sinId, noNumericos: noNumericos };
        }

        /**
         * Avisos del archivo. Cada uno: { texto, grave }. "grave" = se pide
         * confirmar antes de descargar, porque alguna cifra del archivo no
         * es la existencia completa.
         * ctx: { filas, duplicados, sinId, noNumericos, estado, motivo, resumen,
         *        nube, enLinea, pendientes, sync, debeUsarPublicado, publicadoEnUso }
         */
        function existenciasExportAvisos(ctx) {
            var av = [];
            var filas = ctx.filas || [];
            var respaldo = filas.filter(function(f) { return f.origen === 'respaldo'; });
            var noReflejadas = respaldo.filter(function(f) { return f.entradas > 0; });
            var negativos = filas.filter(function(f) { return typeof f.existencia === 'number' && f.existencia < 0; });

            if (!ctx.nube) {
                av.push({ grave: true, texto: 'Sin conexión a la nube (Firebase): las cifras son las de este dispositivo, sin reconciliar con el corte contabilizado.' });
            } else {
                if (!ctx.enLinea) av.push({ grave: true, texto: 'Dispositivo sin conexión: puede haber compras, ventas o conteos de otros teléfonos que todavía no llegaron.' });
                if (ctx.pendientes > 0) av.push({ grave: true, texto: ctx.pendientes + ' cambio(s) de este dispositivo sin sincronizar.' });
                if (ctx.sync === 'error') av.push({ grave: true, texto: 'La última sincronización falló.' });
            }
            if (ctx.estado === 'no_existe') {
                av.push({ grave: false, texto: ctx.motivo === 'ancla_vieja'
                    ? 'El último corte contabilizado tiene más de 8 semanas: toda la existencia sale de la suma de áreas del conteo (respaldo).'
                    : 'No hay corte contabilizado: toda la existencia sale de la suma de áreas del conteo (respaldo).' });
            }
            if (ctx.debeUsarPublicado && !ctx.publicadoEnUso && ctx.nube) {
                av.push({ grave: true, texto: 'Tu usuario no lee compras ni ventas y no hay un Total publicado vigente: las compras y el consumo posteriores al corte no están incluidos.' });
            }
            var res = ctx.resumen;
            if (res) {
                if (res.comprasNoDisponibles) av.push({ grave: true, texto: 'No se pudieron leer todas las compras desde el corte: las entradas pueden estar incompletas.' });
                if (res.ventasNoDisponibles)  av.push({ grave: true, texto: 'No se pudieron leer todas las ventas desde el corte: el consumo puede estar incompleto.' });
                if (res.diasFaltantes && res.diasFaltantes.length) {
                    av.push({ grave: false, texto: res.diasFaltantes.length + ' día(s) sin ventas cargadas desde el corte (' + res.diasFaltantes.slice(0, 7).join(', ')
                        + (res.diasFaltantes.length > 7 ? '…' : '') + '): su consumo no se restó.' });
                }
                if (res.periodosPartidos && res.periodosPartidos.length) {
                    av.push({ grave: false, texto: res.periodosPartidos.length + ' periodo(s) de ventas cruzan la fecha del corte y no se restaron.' });
                }
            }
            if (noReflejadas.length) {
                av.push({ grave: true, texto: noReflejadas.length + ' producto(s) sin saldo en el corte tienen compras que su existencia todavía NO suma (sale de la suma de áreas del conteo): '
                    + noReflejadas.slice(0, 5).map(function(f) { return f.id; }).join(', ') + (noReflejadas.length > 5 ? '…' : '') + '. Ver hoja Auditoría.' });
            }
            if (respaldo.length && ctx.estado === 'ok') {
                av.push({ grave: false, texto: respaldo.length + ' producto(s) sin saldo en el corte: su existencia es la suma de áreas del conteo (respaldo).' });
            }
            if (negativos.length) av.push({ grave: false, texto: negativos.length + ' producto(s) con existencia negativa (el consumo teórico supera corte + compras).' });
            if (ctx.noNumericos && ctx.noNumericos.length) av.push({ grave: true, texto: ctx.noNumericos.length + ' producto(s) sin cifra válida: la celda queda vacía, no en 0.' });
            if (ctx.duplicados && ctx.duplicados.length) av.push({ grave: false, texto: 'ID repetido en el catálogo, exportado una sola vez: ' + ctx.duplicados.join(', ') + '.' });
            if (ctx.sinId) av.push({ grave: false, texto: ctx.sinId + ' producto(s) sin ID no se exportaron.' });
            return av;
        }

        /** Texto de la fuente para la hoja Información. */
        function _exTextoOrigen(origen) {
            if (origen === 'oficial')   return 'Oficial: corte + compras − consumo';
            if (origen === 'publicado') return 'Total publicado (oficial)';
            return 'Respaldo: suma de áreas del conteo';
        }

        /**
         * Arma el libro (sin escribirlo). X = la librería XLSX.
         * info: { generado, usuario, version, fuente, corte, estado, avisos[] }
         */
        function existenciasExportLibro(X, filas, info) {
            var aoa = [EXISTENCIAS_EXPORT_COLUMNAS.slice()];
            filas.forEach(function(f) { aoa.push([f.grupo, f.id, f.descripcion, f.unidad, f.existencia === null ? '' : f.existencia]); });
            var ws = X.utils.aoa_to_sheet(aoa);
            // ID siempre como texto: un código "0012" no puede volverse 12.
            for (var r = 1; r < aoa.length; r++) {
                var ref = X.utils.encode_cell({ r: r, c: 1 });
                if (ws[ref]) { ws[ref].t = 's'; ws[ref].v = String(filas[r - 1].id); delete ws[ref].w; }
                if (filas[r - 1].existencia === null) {
                    var refV = X.utils.encode_cell({ r: r, c: 4 });
                    delete ws[refV];
                }
            }
            var ancho = function(i, min, max) {
                var m = min;
                aoa.forEach(function(fila) { var s = fila[i] === null || fila[i] === undefined ? '' : String(fila[i]); if (s.length > m) m = s.length; });
                return { wch: Math.min(max, m + 2) };
            };
            ws['!cols'] = [ancho(0, 8, 28), ancho(1, 6, 18), ancho(2, 14, 60), ancho(3, 7, 16), ancho(4, 13, 16)];
            ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, aoa.length - 1), c: EXISTENCIAS_EXPORT_COLUMNAS.length - 1 } }) };

            // Auditoría: de dónde sale cada cifra (misma fila, mismo ID).
            var aud = [['ID', 'Descripción', 'En existencia', 'Origen', 'Saldo del corte', 'Entradas por compra', 'Consumo teórico', 'Suma de áreas (conteo)', 'Observación']];
            filas.forEach(function(f) {
                var obs = '';
                if (f.origen === 'respaldo' && f.entradas > 0) obs = 'Compras no reflejadas en la existencia: ' + f.entradas;
                else if (f.existencia === null) obs = 'Sin cifra válida';
                else if (f.existencia < 0) obs = 'Existencia negativa';
                aud.push([f.id, f.descripcion, f.existencia === null ? '' : f.existencia, _exTextoOrigen(f.origen),
                          f.inicial === null ? '' : f.inicial, f.entradas, f.ventas, f.operativa === null ? '' : f.operativa, obs]);
            });
            var wsA = X.utils.aoa_to_sheet(aud);
            for (var a = 1; a < aud.length; a++) {
                var refA = X.utils.encode_cell({ r: a, c: 0 });
                if (wsA[refA]) { wsA[refA].t = 's'; wsA[refA].v = String(aud[a][0]); delete wsA[refA].w; }
            }
            wsA['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 13 }, { wch: 34 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 44 }];
            wsA['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, aud.length - 1), c: 8 } }) };

            var inf = [['Concepto', 'Valor'],
                ['Generado', info.generado || ''],
                ['Usuario', info.usuario || ''],
                ['Versión de la app', info.version || ''],
                ['Fuente', info.fuente || ''],
                ['Corte (ancla)', info.corte || 'Sin corte contabilizado'],
                ['Productos exportados', filas.length],
                ['Con cifra oficial', filas.filter(function(f) { return f.origen !== 'respaldo'; }).length],
                ['En respaldo (suma de áreas)', filas.filter(function(f) { return f.origen === 'respaldo'; }).length],
                ['Avisos', (info.avisos || []).length ? (info.avisos || []).length : 'Ninguno']];
            (info.avisos || []).forEach(function(av, i) { inf.push(['Aviso ' + (i + 1) + (av.grave ? ' (importante)' : ''), av.texto]); });
            var wsI = X.utils.aoa_to_sheet(inf);
            wsI['!cols'] = [{ wch: 28 }, { wch: 110 }];

            var wb = X.utils.book_new();
            X.utils.book_append_sheet(wb, ws, 'Existencias');
            X.utils.book_append_sheet(wb, wsA, 'Auditoría');
            X.utils.book_append_sheet(wb, wsI, 'Información');
            wb.Props = { Title: 'Existencias BarInventory', Author: info.usuario || 'BarInventory', CreatedDate: new Date() };
            return wb;
        }

        /**
         * Fila 1 fija en las hojas indicadas. La edición gratuita de SheetJS
         * (0.18.5) no escribe paneles congelados: se añade el <pane> al XML
         * de la hoja con su propio lector/escritor de zip (XLSX.CFB).
         * Devuelve los bytes nuevos, o null si no se pudo (entonces se
         * descarga sin fila fija; nunca se pierde el archivo por esto).
         */
        function existenciasExportCongelar(X, bytes, nHojas) {
            try {
                if (!X || !X.CFB) return null;
                var z = X.CFB.read(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { type: 'array' });
                var dec = new TextDecoder(), enc = new TextEncoder(), hechas = 0;
                for (var i = 1; i <= nHojas; i++) {
                    var f = X.CFB.find(z, '/xl/worksheets/sheet' + i + '.xml');
                    if (!f || !f.content) continue;
                    var s = dec.decode(f.content);
                    var pane = '<sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
                             + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>';
                    var n = s.replace('<sheetView workbookViewId="0"/>', pane);
                    if (n === s) continue;
                    f.content = enc.encode(n); f.size = f.content.length; hechas++;
                }
                if (!hechas) return null;
                return X.CFB.write(z, { fileType: 'zip', type: 'array' });
            } catch (e) {
                console.warn('[ExportarExistencias] No se pudo fijar la primera fila:', e);
                return null;
            }
        }

        // ── Capa de aplicación (lee el estado de la app; no escribe datos) ───

        /** Espera a que el corte (y, si toca, el Total publicado) dejen de cargar. */
        function _exEsperarFuente(maxMs) {
            return new Promise(function(resolve) {
                if (typeof _db === 'undefined' || !_db || typeof existenciaCargarInicial !== 'function') { resolve(); return; }
                var inicio = Date.now();
                var listo = function() {
                    var e = existenciaInicialEstado().estado;
                    if (e === 'cargando' || e === 'sin_cargar') return false;
                    if (typeof totalPublicadoInfo === 'function') {
                        var tp = totalPublicadoInfo();
                        if (tp.debeUsar && (tp.estado === 'cargando' || tp.estado === 'sin_cargar')) return false;
                    }
                    return true;
                };
                // Lanza la lectura que la app haría de todos modos (una sola vez:
                // existenciaCargarInicial no repite una consulta resuelta ni en vuelo).
                try { existenciaCargarInicial(); } catch (e) { console.warn('[ExportarExistencias]', e); }
                (function revisar() {
                    if (listo() || Date.now() - inicio >= maxMs) { resolve(); return; }
                    // Si no hay semana todavía (arranque), sin_cargar no cambiará: no esperar.
                    if (existenciaInicialEstado().estado === 'sin_cargar' && typeof existenciaSemanaHoy === 'function' && !existenciaSemanaHoy()) { resolve(); return; }
                    setTimeout(revisar, 250);
                })();
            });
        }

        var EX_TIPOS_ANCLA = { inicial_semanal: 'Inicial semanal', fin_de_mes: 'Fin de mes', mitad_de_semana: 'Mitad de semana' };
        function _exTipoAncla(t) { return EX_TIPOS_ANCLA[t] || (t ? String(t) : 'Corte'); }

        /** Versión cargada (la del ?v= de este mismo archivo, que sube con cada versión). */
        function _exVersionApp() {
            var s = (typeof document !== 'undefined') ? document.querySelector('script[src*="97-exportar-existencias.js?v="]') : null;
            return s ? String(s.getAttribute('src')).split('?v=')[1] || '' : '';
        }

        function _exBoton() { return document.getElementById('exExistenciasBtn'); }

        function _exPintarBoton(ocupado) {
            var b = _exBoton();
            if (!b) return;
            b.disabled = !!ocupado;
            b.setAttribute('aria-busy', ocupado ? 'true' : 'false');
            var ico = b.querySelector('i'), txt = b.querySelector('span');
            if (ico) ico.className = ocupado ? 'fa-solid fa-arrows-rotate fa-spin' : 'fa-solid fa-file-excel';
            if (txt) txt.textContent = ocupado ? 'Generando Excel…' : 'Exportar existencias a Excel';
        }

        function _exTerminar() { _exExport.enCurso = false; _exPintarBoton(false); }

        /** HTML del botón (lo inserta renderProductosTab). Vacío sin permiso. */
        function existenciasExportBotonHtml() {
            if (typeof hasPermission !== 'function' || !hasPermission('inventory.export')) return '';
            var oc = _exExport.enCurso;
            return '<div class="ex-fila">'
                 + '<button type="button" id="exExistenciasBtn" class="ex-btn" onclick="exportarExistenciasExcel()"'
                 + (oc ? ' disabled aria-busy="true"' : ' aria-busy="false"')
                 + ' aria-label="Exportar existencias a Excel" title="Descargar Grupo, ID, Descripción, Unidad y En existencia de todo el catálogo">'
                 + '<i class="fa-solid ' + (oc ? 'fa-arrows-rotate fa-spin' : 'fa-file-excel') + '" aria-hidden="true"></i>'
                 + '<span>' + (oc ? 'Generando Excel…' : 'Exportar existencias a Excel') + '</span></button></div>';
        }

        function _exDescargar(bytes, nombre) {
            var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = nombre; a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(function() { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
        }

        /**
         * Botón «Exportar existencias a Excel». Una exportación a la vez.
         * Devuelve una promesa (las pruebas la esperan) que resuelve con
         * { ok, motivo, nombre?, filas?, avisos? }.
         */
        function exportarExistenciasExcel() {
            if (_exExport.enCurso) { showNotification('⏳ Ya se está generando el Excel de existencias'); return Promise.resolve({ ok: false, motivo: 'en_curso' }); }
            if (typeof hasPermission !== 'function' || !hasPermission('inventory.export')) {
                showNotification('⚠️ No tienes permiso para exportar el inventario');
                return Promise.resolve({ ok: false, motivo: 'sin_permiso' });
            }
            if (!Array.isArray(products) || products.length === 0) {
                showNotification('⚠️ No hay productos para exportar');
                return Promise.resolve({ ok: false, motivo: 'sin_productos' });
            }
            if (typeof XLSX === 'undefined') {
                showNotification('⏳ Cargando la librería de Excel… intenta en unos segundos');
                return Promise.resolve({ ok: false, motivo: 'sin_xlsx' });
            }
            _exExport.enCurso = true;
            _exPintarBoton(true);

            return _exEsperarFuente(EXISTENCIAS_EXPORT_ESPERA_MS).then(function() {
                var nube = (typeof _db !== 'undefined' && !!_db);
                var est = existenciaInicialEstado();
                var tp = (typeof totalPublicadoInfo === 'function') ? totalPublicadoInfo() : { debeUsar: false, enUso: false, estado: 'sin_cargar' };
                if (nube && (est.estado === 'cargando' || est.estado === 'sin_cargar')) {
                    showNotification('⏳ Las existencias siguen cargando. No se exportó; intenta de nuevo en unos segundos.');
                    _exTerminar(); return { ok: false, motivo: 'cargando' };
                }
                if (nube && est.estado === 'error') {
                    showNotification('❌ No se pudo leer el corte de existencias. No se exportó para no darte cifras incompletas. Revisa la conexión e intenta de nuevo.');
                    _exTerminar(); return { ok: false, motivo: 'error_corte' };
                }
                if (nube && tp.debeUsar && tp.estado === 'error') {
                    showNotification('❌ No se pudo leer el Total publicado. No se exportó para no darte cifras incompletas.');
                    _exTerminar(); return { ok: false, motivo: 'error_publicado' };
                }
                if (nube && tp.debeUsar && (tp.estado === 'cargando' || tp.estado === 'sin_cargar')) {
                    showNotification('⏳ El Total publicado sigue cargando. No se exportó; intenta de nuevo en unos segundos.');
                    _exTerminar(); return { ok: false, motivo: 'cargando' };
                }

                // Una sola foto de entradas y consumo para todo el archivo: la
                // misma que usa el catálogo (y así 400 productos no recalculan).
                var ent = existenciaEntradas(), ven = existenciaVentas();
                var r = existenciasExportFilas(products, function(p) { return existenciaOficial(p, ent, ven); });
                var resumen = (typeof existenciaArrastreResumen === 'function') ? existenciaArrastreResumen() : null;
                var syncBadge = document.getElementById('cloudSyncBadge');
                var avisos = existenciasExportAvisos({
                    filas: r.filas, duplicados: r.duplicados, sinId: r.sinId, noNumericos: r.noNumericos,
                    estado: est.estado, motivo: est.motivo || null, resumen: resumen,
                    nube: nube, enLinea: (typeof navigator === 'undefined') ? true : navigator.onLine !== false,
                    pendientes: (typeof _getPendingSyncCount === 'function') ? _getPendingSyncCount() : 0,
                    sync: syncBadge ? syncBadge.getAttribute('data-sync') : null,
                    debeUsarPublicado: !!tp.debeUsar, publicadoEnUso: !!tp.enUso
                });
                if (!r.filas.length) {
                    showNotification('⚠️ Ningún producto tiene ID: no hay nada que exportar');
                    _exTerminar(); return { ok: false, motivo: 'sin_filas' };
                }

                var ancla = est.ancla || (resumen && resumen.ancla) || null;
                var ahora = new Date();
                var cuenta = (typeof _auth !== 'undefined' && _auth && _auth.currentUser) ? _auth.currentUser : null;
                var info = {
                    generado: ahora.toLocaleString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
                    usuario:  cuenta ? (cuenta.email || cuenta.uid) : ((typeof currentUserUid !== 'undefined' && currentUserUid) ? currentUserUid : 'Sin sesión'),
                    version:  _exVersionApp(),
                    fuente:   tp.enUso ? 'Total publicado por administración (corte + compras − consumo)'
                            : (est.estado === 'ok' ? 'Corte contabilizado + compras − consumo teórico (misma cifra de la columna Stock)'
                            : 'Suma de áreas del conteo (no hay corte contabilizado vigente)'),
                    corte:    ancla ? (_exTipoAncla(ancla.tipo) + ' · ' + (ancla.fecha || '') + (ancla.hora ? ' ' + ancla.hora : '')) : '',
                    avisos:   avisos
                };
                var nombre = existenciasExportNombre(ahora);

                var generar = function() {
                    try {
                        var wb = existenciasExportLibro(XLSX, r.filas, info);
                        var bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
                        var fijo = existenciasExportCongelar(XLSX, bytes, 2);
                        _exDescargar(fijo || bytes, nombre);
                        var graves = avisos.filter(function(a) { return a.grave; }).length;
                        showNotification('✅ ' + nombre + ' — ' + r.filas.length + ' producto(s)'
                            + (avisos.length ? ' · ' + avisos.length + ' aviso(s): revisa la hoja Información' : ''));
                        _exTerminar();
                        return { ok: true, motivo: null, nombre: nombre, filas: r.filas, avisos: avisos, graves: graves, filaFija: !!fijo };
                    } catch (e) {
                        console.error('[ExportarExistencias] Error al generar el Excel:', e);
                        showNotification('❌ No se pudo generar el Excel de existencias: ' + (e && e.message ? e.message : e));
                        _exTerminar();
                        return { ok: false, motivo: 'error_generar' };
                    }
                };

                var graves = avisos.filter(function(a) { return a.grave; });
                if (!graves.length) return generar();
                // Hay cifras que no son la existencia completa: se dice ANTES de
                // descargar y la persona decide. El archivo lleva los mismos avisos.
                return new Promise(function(resolve) {
                    var msg = 'El Excel se puede generar, pero:\n\n• ' + graves.map(function(a) { return a.texto; }).join('\n• ')
                            + '\n\nLos avisos quedan en la hoja «Información» del archivo. ¿Exportar de todos modos?';
                    showConfirm(msg, function() { resolve(generar()); });
                    // Cancelar / Escape: showConfirm solo quita el modal; se libera aquí.
                    var vigilar = setInterval(function() {
                        if (!document.getElementById('_confirmOverlay')) {
                            clearInterval(vigilar);
                            if (_exExport.enCurso) {
                                _exTerminar();
                                showNotification('Exportación cancelada');
                                resolve({ ok: false, motivo: 'cancelada', avisos: avisos });
                            }
                        }
                    }, 200);
                });
            }).catch(function(e) {
                console.error('[ExportarExistencias]', e);
                showNotification('❌ No se pudo exportar: ' + (e && e.message ? e.message : e));
                _exTerminar();
                return { ok: false, motivo: 'error' };
            });
        }

        if (typeof window !== 'undefined') {
            window.exportarExistenciasExcel   = exportarExistenciasExcel;
            window.existenciasExportBotonHtml = existenciasExportBotonHtml;
            window.existenciasExportFilas     = existenciasExportFilas;
            window.existenciasExportAvisos    = existenciasExportAvisos;
            window.existenciasExportLibro     = existenciasExportLibro;
            window.existenciasExportNombre    = existenciasExportNombre;
            window.existenciasExportCongelar  = existenciasExportCongelar;
        }
