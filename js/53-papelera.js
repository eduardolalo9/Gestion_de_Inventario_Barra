        // ══════════════════════════════════════════════════════════════════════
        //  v5.19 — PAPELERA DE SERVIDOR (FASE B de la auditoría del 26-sep)
        //  ────────────────────────────────────────────────────────────────────
        //  Hasta hoy, tres borrados eran definitivos en el servidor:
        //    1. Al crear un inventario se BORRAN los conteos (userAuditoria) de
        //       los demás y se REESCRIBE el del admin. Si el candado de 4.8
        //       fallara, no había marcha atrás desde la nube.
        //    2. Eliminar un producto o TODO el catálogo (el respaldo previo vivía
        //       solo en el localStorage del teléfono que borraba).
        //    3. Eliminar un reporte publicado.
        //
        //  Ahora, ANTES de borrar, se escribe lo que se va a perder en
        //  inventarioApp/{doc}/papelera/{id}. La regla de oro:
        //    · Conteos y reporte: la papelera va en el MISMO batch que el
        //      borrado. Si la papelera no se puede escribir, el batch entero
        //      falla y NO se borra nada.
        //    · Productos: el borrado es local (y viaja después por la
        //      sincronización), así que primero se confirma la papelera en el
        //      servidor y solo entonces se borra. Sin conexión no se borra.
        //
        //  La papelera NO se edita (solo se marca "restaurado") y solo se puede
        //  vaciar lo que tiene más de 30 días. Lee y restaura administración.
        // ══════════════════════════════════════════════════════════════════════

        var PAPELERA_ORIGENES = {
            conteos:  { titulo: 'Conteos de un inventario anterior', icono: 'fa-clipboard-list' },
            producto: { titulo: 'Producto eliminado',                icono: 'fa-box' },
            catalogo: { titulo: 'Catálogo completo eliminado',       icono: 'fa-boxes-stacked' },
            reporte:  { titulo: 'Reporte publicado eliminado',       icono: 'fa-file-chart-column' }
        };
        var PAPELERA_MAX_BYTES = 700000;               // margen bajo el límite de 1 MiB por documento
        var PAPELERA_DIAS_PURGA = 30;
        var PAPELERA_DIAS_PURGA_MS = PAPELERA_DIAS_PURGA * 86400000;

        var _papelera = { estado: 'sin_cargar', items: [], error: null, accion: null };

        function _papTam(obj) { try { return JSON.stringify(obj).length; } catch (_) { return Infinity; } }

        /**
         * Parte una lista en trozos que quepan en un documento (por tamaño en
         * JSON, no por número: un producto con historial pesa más que otro).
         */
        function papeleraTrozos(lista, maxBytes) {
            maxBytes = maxBytes || PAPELERA_MAX_BYTES;
            var trozos = [], actual = [], tam = 2;
            (lista || []).forEach(function(x) {
                var t = _papTam(x) + 1;
                if (actual.length && tam + t > maxBytes) { trozos.push(actual); actual = []; tam = 2; }
                actual.push(x); tam += t;
            });
            if (actual.length) trozos.push(actual);
            return trozos;
        }

        /** Cuántos productos y cuántas capturas (producto × área) trae un conteo. */
        function papeleraContarConteo(conteo) {
            var productos = 0, entradas = 0;
            Object.keys(conteo || {}).forEach(function(pid) {
                var areas = conteo[pid];
                if (!areas || typeof areas !== 'object') return;
                var n = Object.keys(areas).length;
                if (n) { productos++; entradas += n; }
            });
            return { productos: productos, entradas: entradas };
        }

        /**
         * Registros de papelera para el userAuditoria de una persona. [] si no
         * hay nada que perder (sin conteo). Si el conteo no cabe en un
         * documento, se reparte en partes del mismo grupo.
         */
        function papeleraRegistrosConteo(uid, data, opts) {
            opts = opts || {};
            data = data || {};
            var conteo = (data.conteo && typeof data.conteo === 'object') ? data.conteo : {};
            var cuenta = papeleraContarConteo(conteo);
            if (!cuenta.entradas) return [];
            var ts = opts.ts || Date.now();
            var grupo = 'conteos_' + uid + '_' + ts;
            var resto = {};
            Object.keys(data).forEach(function(k) { if (k !== 'conteo') resto[k] = data[k]; });
            var partes;
            if (_papTam(data) <= PAPELERA_MAX_BYTES) {
                partes = [conteo];
            } else {
                partes = papeleraTrozos(Object.keys(conteo).map(function(pid) { return [pid, conteo[pid]]; }))
                    .map(function(tr) { var o = {}; tr.forEach(function(par) { o[par[0]] = par[1]; }); return o; });
            }
            return partes.map(function(c, i) {
                return {
                    id: grupo + (partes.length > 1 ? '_p' + (i + 1) : ''),
                    data: {
                        origen: 'conteos', grupo: grupo, parte: i + 1, partes: partes.length,
                        rutaOriginal: 'userAuditoria/' + uid,
                        uidAfectado: uid,
                        emailAfectado: data.email || null,
                        sessionId: data.sessionId || null,
                        sessionNueva: opts.sessionNueva || null,
                        contenido: Object.assign({}, resto, { conteo: c }),
                        resumen: papeleraContarConteo(c),
                        borradoPor: opts.uidActor || null,
                        borradoEn: ts
                    }
                };
            });
        }

        /** Registros de papelera para uno o varios productos del catálogo. */
        function papeleraRegistrosProductos(lista, origen, opts) {
            opts = opts || {};
            var ts = opts.ts || Date.now();
            var grupo = origen + '_' + ts;
            var trozos = papeleraTrozos(lista || []);
            return trozos.map(function(tr, i) {
                return {
                    id: grupo + (trozos.length > 1 ? '_p' + (i + 1) : ''),
                    data: {
                        origen: origen, grupo: grupo, parte: i + 1, partes: trozos.length,
                        rutaOriginal: 'products',
                        contenido: { productos: tr },
                        resumen: { productos: tr.length, total: (lista || []).length,
                                   nombres: tr.slice(0, 5).map(function(p) { return String(p.name || p.id); }) },
                        borradoPor: opts.uidActor || null,
                        borradoEn: ts
                    }
                };
            });
        }

        /** Registro de papelera para un reporte publicado. */
        function papeleraRegistroReporte(reporteId, data, opts) {
            opts = opts || {};
            var ts = opts.ts || Date.now();
            data = data || {};
            return {
                id: 'reporte_' + reporteId + '_' + ts,
                data: {
                    origen: 'reporte', grupo: 'reporte_' + reporteId + '_' + ts, parte: 1, partes: 1,
                    rutaOriginal: 'reportes/' + reporteId,
                    reporteId: String(reporteId),
                    contenido: data,
                    resumen: { titulo: String(data.titulo || data.nombre || data.tipo || 'Reporte'), fechaTs: data.fechaTs || null },
                    borradoPor: opts.uidActor || null,
                    borradoEn: ts
                }
            };
        }

        /**
         * Lo recuperado que NO choca con lo que la persona ya contó en el
         * inventario abierto. Nunca se pisa una captura nueva: si el mismo
         * producto y área ya tienen conteo, gana el actual.
         */
        function papeleraFusionConteos(recuperado, actual) {
            var agregar = {}, agregadas = 0, omitidas = 0;
            actual = actual || {};
            Object.keys(recuperado || {}).forEach(function(pid) {
                var areas = recuperado[pid] || {};
                Object.keys(areas).forEach(function(area) {
                    if (actual[pid] && actual[pid][area] !== undefined) { omitidas++; return; }
                    if (!agregar[pid]) agregar[pid] = {};
                    agregar[pid][area] = areas[area];
                    agregadas++;
                });
            });
            return { agregar: agregar, agregadas: agregadas, omitidas: omitidas };
        }

        /** Agrupa los registros por `grupo` (las partes de un mismo borrado van juntas). */
        function papeleraAgrupar(items) {
            var porGrupo = {}, orden = [];
            (items || []).forEach(function(it) {
                var g = it.grupo || it.id;
                if (!porGrupo[g]) { porGrupo[g] = { grupo: g, origen: it.origen, borradoEn: it.borradoEn, borradoPor: it.borradoPor, partes: [] }; orden.push(g); }
                porGrupo[g].partes.push(it);
            });
            return orden.map(function(g) {
                var x = porGrupo[g];
                x.partes.sort(function(a, b) { return (a.parte || 1) - (b.parte || 1); });
                x.completo = x.partes.length === (x.partes[0].partes || 1);
                x.restaurado = x.partes.every(function(p) { return !!p.restauradoEn; });
                x.restauradoEn = x.restaurado ? Math.max.apply(null, x.partes.map(function(p) { return p.restauradoEn || 0; })) : null;
                return x;
            }).sort(function(a, b) { return (b.borradoEn || 0) - (a.borradoEn || 0); });
        }

        // ══════════════════════════════════════════════════════════════════════
        //  ESCRITURA (antes de borrar)
        // ══════════════════════════════════════════════════════════════════════

        function _papCol() {
            return _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID).collection('papelera');
        }

        function _papUid() { return (typeof currentUserUid !== 'undefined') ? currentUserUid : null; }

        /** Agrega a un batch los registros de conteo de quien se va a borrar. Devuelve cuántos. */
        function papeleraAgregarConteosABatch(batch, docs, sessionNueva) {
            var ts = Date.now(), n = 0;
            (docs || []).forEach(function(d) {
                papeleraRegistrosConteo(d.id, d.data, { ts: ts, uidActor: _papUid(), sessionNueva: sessionNueva }).forEach(function(r) {
                    batch.set(_papCol().doc(r.id), r.data);
                    n++;
                });
            });
            return n;
        }

        /**
         * Guarda en la papelera del servidor los productos que se van a borrar
         * y SOLO si eso se confirma, ejecuta `alContinuar`. Sin Firebase (uso
         * solo local) sigue como antes: no hay servidor donde guardar.
         */
        async function papeleraProtegerProductos(lista, origen, alContinuar) {
            if (typeof _db === 'undefined' || !_db) { alContinuar(); return true; }
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                showNotification('📴 Sin conexión: para borrar primero se guarda una copia en la papelera del servidor. Inténtalo con señal.');
                return false;
            }
            var regs = papeleraRegistrosProductos(lista, origen, { uidActor: _papUid() });
            try {
                var batch = _db.batch();
                regs.forEach(function(r) { batch.set(_papCol().doc(r.id), r.data); });
                await batch.commit();
            } catch (e) {
                console.error('[Papelera] No se pudo guardar la copia; no se borra nada:', e);
                var denegado = e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
                showNotification(denegado
                    ? '🛑 No se borró nada: el servidor rechazó la copia en la papelera (¿faltan desplegar las reglas de Firestore?).'
                    : '🛑 No se borró nada: no se pudo guardar la copia en la papelera. Revisa la conexión.');
                return false;
            }
            alContinuar();
            return true;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  LECTURA, RESTAURACIÓN Y PURGA (administración)
        // ══════════════════════════════════════════════════════════════════════

        async function papeleraCargar() {
            if (typeof _db === 'undefined' || !_db) { _papelera = { estado: 'sin_db', items: [], error: null, accion: null }; return; }
            _papelera.estado = 'cargando';
            try {
                var snap = await _papCol().orderBy('borradoEn', 'desc').limit(200).get();
                var items = [];
                snap.forEach(function(doc) { items.push(Object.assign({ id: doc.id }, doc.data())); });
                _papelera = { estado: 'ok', items: items, error: null, accion: null };
            } catch (e) {
                console.warn('[Papelera] No se pudo leer:', e);
                _papelera = { estado: 'error', items: [], error: (e && (e.code || e.message)) || 'error', accion: null };
            }
        }

        function _papGrupo(grupo) {
            return papeleraAgrupar(_papelera.items).find(function(g) { return g.grupo === grupo; }) || null;
        }

        async function _papMarcarRestaurado(g) {
            var batch = _db.batch();
            var ahora = Date.now();
            g.partes.forEach(function(p) { batch.update(_papCol().doc(p.id), { restauradoEn: ahora, restauradoPor: _papUid() }); });
            await batch.commit();
        }

        /** Productos: vuelven al catálogo los que no existan ya, y se publica. */
        async function _papRestaurarProductos(g) {
            var lista = [];
            g.partes.forEach(function(p) { (p.contenido && p.contenido.productos || []).forEach(function(x) { lista.push(x); }); });
            var existentes = {};
            products.forEach(function(p) { existentes[String(p.id)] = true; });
            var nuevos = lista.filter(function(p) { return p && p.id && !existentes[String(p.id)]; });
            var omitidos = lista.length - nuevos.length;
            if (!nuevos.length) return { restaurados: 0, omitidos: omitidos, publicado: false };
            nuevos.forEach(function(p) {
                var copia = JSON.parse(JSON.stringify(p));
                copia._v = (typeof _versionProducto === 'function') ? _versionProducto(copia._v) : Date.now();
                products.push(copia);
                // Quitar la lápida de este teléfono: si no, la fusión con la nube
                // lo seguiría tratando como borrado.
                if (typeof _deletedProductIds !== 'undefined' && Array.isArray(_deletedProductIds)) {
                    var i = _deletedProductIds.indexOf(copia.id);
                    if (i !== -1) _deletedProductIds.splice(i, 1);
                }
            });
            try { localStorage.setItem('inventarioApp_deletedProductIds', JSON.stringify(_deletedProductIds)); } catch (_) {}
            if (typeof _registrarEnSyncQueue === 'function') {
                _registrarEnSyncQueue({ tipo: 'restauracion_productos', detalle: nuevos.length + ' producto(s) restaurados de la papelera (' + g.grupo + ')',
                                        uid: _papUid() });
            }
            if (typeof saveToLocalStorage === 'function') saveToLocalStorage();
            var publicado = false;
            if (typeof publicarCatalogoFirestore === 'function' && typeof hasPermission === 'function' && hasPermission('catalog.publish')) {
                publicado = (await publicarCatalogoFirestore()) === true;
            }
            return { restaurados: nuevos.length, omitidos: omitidos, publicado: publicado };
        }

        /** Reporte: se vuelve a crear si no existe. */
        async function _papRestaurarReporte(g) {
            var p = g.partes[0];
            var ref = _db.collection('reportes').doc(p.reporteId || String(p.rutaOriginal || '').split('/')[1]);
            var s = await ref.get();
            if (s.exists) return { restaurados: 0, omitidos: 1 };
            await ref.set(p.contenido || {});
            return { restaurados: 1, omitidos: 0 };
        }

        /**
         * Conteos: entran al inventario ABIERTO, en el documento de la persona,
         * sin pisar nada de lo que ya contó en él. Transacción: lo que se lee
         * es lo que se compara.
         */
        async function _papRestaurarConteos(g) {
            var sesion = (typeof _auditoriaSessionId !== 'undefined') ? _auditoriaSessionId : null;
            if (!sesion) throw new Error('No hay un inventario abierto donde devolver los conteos.');
            var inv = await _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID).collection('inventories').doc(String(sesion)).get();
            var estado = inv.exists ? (inv.data() || {}).estado : null;
            if (!inv.exists || estado === 'CERRADO' || estado === 'CONTABILIZADO') {
                throw new Error('El inventario actual ya está cerrado: los conteos solo se devuelven a un inventario abierto.');
            }
            var recuperado = {}, base = g.partes[0];
            g.partes.forEach(function(p) {
                var c = (p.contenido && p.contenido.conteo) || {};
                Object.keys(c).forEach(function(pid) { recuperado[pid] = Object.assign({}, recuperado[pid] || {}, c[pid]); });
            });
            var uid = base.uidAfectado;
            var ref = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID).collection('userAuditoria').doc(uid);
            var r = await _db.runTransaction(async function(tx) {
                var s = await tx.get(ref);
                var d = s.exists ? (s.data() || {}) : {};
                var mismaSesion = s.exists && String(d.sessionId) === String(sesion);
                var fusion = papeleraFusionConteos(recuperado, mismaSesion ? (d.conteo || {}) : {});
                if (!fusion.agregadas) return fusion;
                if (mismaSesion) {
                    tx.set(ref, { conteo: fusion.agregar, updatedAt: Date.now() }, { merge: true });
                } else {
                    // Documento de otra sesión (o inexistente): se crea limpio en la
                    // sesión actual con lo recuperado. Las áreas quedan "pendiente".
                    tx.set(ref, {
                        uid: uid, email: base.emailAfectado || uid, sessionId: sesion,
                        status: (typeof estadoAreasVacio === 'function') ? estadoAreasVacio('pendiente') : {},
                        conteo: fusion.agregar, unlocks: {}, updatedAt: Date.now(),
                        isAdmin: !!(base.contenido && base.contenido.isAdmin)
                    });
                }
                return fusion;
            });
            if (typeof _registrarEnSyncQueue === 'function') {
                _registrarEnSyncQueue({ tipo: 'restauracion_conteos', detalle: r.agregadas + ' captura(s) de ' + (base.emailAfectado || uid)
                                        + ' devueltas al inventario abierto desde la papelera', uid: _papUid() });
            }
            return { restaurados: r.agregadas, omitidos: r.omitidas };
        }

        function _papTextoGrupo(g) {
            var o = PAPELERA_ORIGENES[g.origen] || { titulo: g.origen };
            var p = g.partes[0], rs = p.resumen || {};
            if (g.origen === 'conteos') {
                var tot = g.partes.reduce(function(a, x) { return a + ((x.resumen || {}).entradas || 0); }, 0);
                return o.titulo + ' — ' + (p.emailAfectado || p.uidAfectado || '') + ' · ' + tot + ' captura(s)';
            }
            if (g.origen === 'producto' || g.origen === 'catalogo') {
                return o.titulo + ' — ' + (rs.total || rs.productos || 0) + ' producto(s)';
            }
            return o.titulo + ' — ' + (rs.titulo || p.reporteId || '');
        }

        function papeleraRestaurar(grupo) {
            if (!(typeof isAdmin === 'function' && isAdmin())) { showNotification('⚠️ Solo administración puede restaurar'); return; }
            var g = _papGrupo(grupo);
            if (!g) return;
            if (!g.completo) { showNotification('⚠️ Faltan partes de este registro: no se restaura a medias'); return; }
            if (g.restaurado) { showNotification('Ya se restauró el ' + _papFecha(g.restauradoEn)); return; }
            var detalle = g.origen === 'conteos'
                ? 'Las capturas vuelven al INVENTARIO ABIERTO, en el conteo de esa persona. Lo que ya contó en este inventario NO se pisa.'
                : (g.origen === 'reporte' ? 'El reporte se vuelve a publicar si no existe.'
                   : 'Vuelven al catálogo los productos que no existan ya (los que existen no se tocan) y se publica el catálogo.');
            showConfirm('♻️ RESTAURAR DESDE LA PAPELERA\n\n' + _papTextoGrupo(g) + '\nBorrado el ' + _papFecha(g.borradoEn) + '\n\n' + detalle + '\n\n¿Restaurar?', async function() {
                _papelera.accion = grupo; renderTab();
                try {
                    var r;
                    if (g.origen === 'conteos') r = await _papRestaurarConteos(g);
                    else if (g.origen === 'reporte') r = await _papRestaurarReporte(g);
                    else r = await _papRestaurarProductos(g);
                    if (r.restaurados) await _papMarcarRestaurado(g);
                    showNotification(r.restaurados
                        ? '✅ Restaurado: ' + r.restaurados + (r.omitidos ? ' · ' + r.omitidos + ' ya existían y no se tocaron' : '')
                          + (r.publicado === false && (g.origen === 'producto' || g.origen === 'catalogo') ? ' · publica el catálogo cuando haya conexión' : '')
                        : 'Nada que restaurar: todo ya existe (' + r.omitidos + ')');
                    await papeleraCargar();
                } catch (e) {
                    console.error('[Papelera] Restauración falló:', e);
                    showNotification('❌ ' + (e && e.message ? e.message : 'No se pudo restaurar'));
                    _papelera.accion = null;
                }
                renderTab();
            });
        }

        /** Descarga el contenido tal cual (JSON) para revisarlo o guardarlo aparte. */
        function papeleraDescargar(grupo) {
            var g = _papGrupo(grupo);
            if (!g) return;
            var blob = new Blob([JSON.stringify({ grupo: g.grupo, origen: g.origen, borradoEn: g.borradoEn, partes: g.partes }, null, 2)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'papelera_' + g.grupo + '.json';
            document.body.appendChild(a); a.click();
            setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        }

        /** Registros que ya se pueden vaciar (más de 30 días). Capa pura. */
        function papeleraVencidos(items, ahora) {
            ahora = ahora || Date.now();
            return (items || []).filter(function(it) { return typeof it.borradoEn === 'number' && it.borradoEn < ahora - PAPELERA_DIAS_PURGA_MS; });
        }

        function papeleraPurgar() {
            if (!(typeof isAdmin === 'function' && isAdmin())) return;
            var venc = papeleraVencidos(_papelera.items);
            if (!venc.length) { showNotification('No hay registros de más de ' + PAPELERA_DIAS_PURGA + ' días'); return; }
            showConfirm('🗑️ VACIAR PAPELERA\n\nSe borran DEFINITIVAMENTE ' + venc.length + ' registro(s) de más de ' + PAPELERA_DIAS_PURGA + ' días.\n'
                      + 'Lo más reciente se conserva.\n\n¿Vaciar?', async function() {
                try {
                    for (var i = 0; i < venc.length; i += 400) {
                        var batch = _db.batch();
                        venc.slice(i, i + 400).forEach(function(it) { batch.delete(_papCol().doc(it.id)); });
                        await batch.commit();
                    }
                    showNotification('🗑️ ' + venc.length + ' registro(s) vaciados');
                } catch (e) {
                    console.error('[Papelera] Purga falló:', e);
                    showNotification('❌ No se pudo vaciar la papelera');
                }
                await papeleraCargar();
                renderTab();
            });
        }

        // ══════════════════════════════════════════════════════════════════════
        //  PANTALLA
        // ══════════════════════════════════════════════════════════════════════

        function _papFecha(ms) {
            if (!ms) return '—';
            var f = new Date(ms);
            return String(f.getDate()).padStart(2, '0') + '/' + String(f.getMonth() + 1).padStart(2, '0') + '/' + f.getFullYear()
                 + ' ' + String(f.getHours()).padStart(2, '0') + ':' + String(f.getMinutes()).padStart(2, '0');
        }

        function abrirPapelera() {
            if (typeof switchTab === 'function') switchTab('papelera'); else { activeTab = 'papelera'; renderTab(); }
        }

        function renderPapeleraTab() {
            if (!(typeof isAdmin === 'function' && isAdmin())) {
                return '<div class="pap-wrap"><div class="pap-vacio"><i class="fa-solid fa-lock" aria-hidden="true"></i> Solo administración ve la papelera.</div></div>';
            }
            if (_papelera.estado === 'sin_cargar') {
                _papelera.estado = 'cargando';   // antes de pedir: un repintado no vuelve a pedir
                papeleraCargar().then(function() { if (activeTab === 'papelera') renderTab(); });
            }
            var h = '<div class="pap-wrap"><div class="pap-cab"><div class="pap-cab__tit">Papelera</div>'
                  + '<div class="pap-cab__sub">Lo que se borró en el servidor se guarda aquí antes de borrarse: conteos al crear un inventario, '
                  + 'productos y reportes. Se puede restaurar o descargar. Se vacía a mano, solo lo de más de ' + PAPELERA_DIAS_PURGA + ' días.</div></div>';
            if (_papelera.estado === 'cargando' || _papelera.estado === 'sin_cargar') {
                return h + '<div class="pap-vacio">Cargando…</div></div>';
            }
            if (_papelera.estado === 'sin_db') return h + '<div class="pap-vacio">Sin conexión a la base de datos.</div></div>';
            if (_papelera.estado === 'error') {
                return h + '<div class="pap-vacio">No se pudo leer la papelera (' + escapeHtml(String(_papelera.error)) + '). '
                     + '¿Ya se desplegaron las reglas de Firestore de la v5.19?</div>'
                     + '<div class="pap-acc"><button type="button" class="bt bt--secundario" onclick="papeleraCargar().then(renderTab)">Reintentar</button></div></div>';
            }
            var grupos = papeleraAgrupar(_papelera.items);
            if (!grupos.length) {
                h += '<div class="pap-vacio"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> La papelera está vacía.</div>';
            } else {
                h += '<ul class="pap-lista" role="list">';
                grupos.forEach(function(g) {
                    var o = PAPELERA_ORIGENES[g.origen] || { titulo: g.origen, icono: 'fa-trash' };
                    var p = g.partes[0];
                    var ocupado = _papelera.accion === g.grupo;
                    h += '<li class="pap-item' + (g.restaurado ? ' pap-item--hecho' : '') + '">'
                       + '<div class="pap-item__cab"><i class="fa-solid ' + o.icono + ' pap-item__ico" aria-hidden="true"></i>'
                       + '<div class="pap-item__txt"><div class="pap-item__tit">' + escapeHtml(o.titulo) + '</div>'
                       + '<div class="pap-item__meta">' + escapeHtml(_papDetalle(g)) + '</div>'
                       + '<div class="pap-item__meta">Borrado el ' + escapeHtml(_papFecha(g.borradoEn))
                       + (g.partes.length > 1 ? ' · ' + g.partes.length + ' partes' : '')
                       + (g.completo ? '' : ' · <b>incompleto</b>') + '</div>'
                       + (g.restaurado ? '<div class="pap-item__ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Restaurado el ' + escapeHtml(_papFecha(g.restauradoEn)) + '</div>' : '')
                       + '</div></div>'
                       + '<div class="pap-item__acc">'
                       + (g.restaurado ? '' : '<button type="button" class="bt bt--primario" data-pap-restaurar="' + escapeHtml(g.grupo) + '"'
                           + (ocupado || !g.completo ? ' disabled aria-disabled="true"' : '')
                           + ' onclick="papeleraRestaurar(this.getAttribute(\'data-pap-restaurar\'))"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> '
                           + (ocupado ? 'Restaurando…' : 'Restaurar') + '</button>')
                       + '<button type="button" class="bt bt--secundario" data-pap-descargar="' + escapeHtml(g.grupo) + '" onclick="papeleraDescargar(this.getAttribute(\'data-pap-descargar\'))">'
                       + '<i class="fa-solid fa-download" aria-hidden="true"></i> Descargar</button>'
                       + '</div></li>';
                });
                h += '</ul>';
            }
            var venc = papeleraVencidos(_papelera.items).length;
            h += '<div class="pap-acc">'
               + '<button type="button" class="bt bt--secundario" onclick="papeleraCargar().then(renderTab)"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Actualizar</button>'
               + (venc ? '<button type="button" class="bt bt--secundario" onclick="papeleraPurgar()"><i class="fa-solid fa-trash" aria-hidden="true"></i> Vaciar ' + venc + ' de más de ' + PAPELERA_DIAS_PURGA + ' días</button>' : '')
               + '</div></div>';
            return h;
        }

        function _papDetalle(g) {
            var p = g.partes[0], rs = p.resumen || {};
            if (g.origen === 'conteos') {
                var e = g.partes.reduce(function(a, x) { return a + ((x.resumen || {}).entradas || 0); }, 0);
                var pr = g.partes.reduce(function(a, x) { return a + ((x.resumen || {}).productos || 0); }, 0);
                return (p.emailAfectado || p.uidAfectado || '—') + ' · ' + pr + ' producto(s), ' + e + ' captura(s)';
            }
            if (g.origen === 'producto' || g.origen === 'catalogo') {
                var nombres = [];
                g.partes.forEach(function(x) { ((x.resumen || {}).nombres || []).forEach(function(n) { if (nombres.length < 3) nombres.push(n); }); });
                var total = rs.total || g.partes.reduce(function(a, x) { return a + ((x.resumen || {}).productos || 0); }, 0);
                return total + ' producto(s)' + (nombres.length ? ': ' + nombres.join(', ') + (total > nombres.length ? '…' : '') : '');
            }
            return String(rs.titulo || p.reporteId || '');
        }

        window.PAPELERA_ORIGENES            = PAPELERA_ORIGENES;
        window.papeleraTrozos               = papeleraTrozos;
        window.papeleraContarConteo         = papeleraContarConteo;
        window.papeleraRegistrosConteo      = papeleraRegistrosConteo;
        window.papeleraRegistrosProductos   = papeleraRegistrosProductos;
        window.papeleraRegistroReporte      = papeleraRegistroReporte;
        window.papeleraFusionConteos        = papeleraFusionConteos;
        window.papeleraAgrupar              = papeleraAgrupar;
        window.papeleraVencidos             = papeleraVencidos;
        window.papeleraAgregarConteosABatch = papeleraAgregarConteosABatch;
        window.papeleraProtegerProductos    = papeleraProtegerProductos;
        window.papeleraCargar               = papeleraCargar;
        window.papeleraRestaurar            = papeleraRestaurar;
        window.papeleraDescargar            = papeleraDescargar;
        window.papeleraPurgar               = papeleraPurgar;
        window.abrirPapelera                = abrirPapelera;
        window.renderPapeleraTab            = renderPapeleraTab;
