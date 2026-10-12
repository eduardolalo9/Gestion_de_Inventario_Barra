#!/usr/bin/env node
/**
 * prueba-v527-compras-fvs.js — v5.27 · Compras (cancelar, fecha de ingreso,
 * duplicados, lista por día/proveedor/producto) y Físico vs Sistema (tarjetas
 * por grupo y corrección directa)
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedido de Eduardo (12-oct-2026) con sus decisiones:
 *   · Cancelar = MARCAR cancelada (queda en el historial, deja de sumar al
 *     Total, se borran sus asientos), solo administración; reimportarla la
 *     reingresa conservando el rastro.
 *   · Fecha de ingreso obligatoria en cada importación, INFORMATIVA (la
 *     semana y el Total siguen con la fecha de SAP).
 *   · Duplicados bloqueados en la vista previa (mismo id, Doc SAP o folio +
 *     proveedor; repetidos en el archivo; mismo contenido salvo que se marque).
 *   · Físico vs Sistema por grupo, ordenado por diferencia, tarjeta con todas
 *     las áreas y corrección DIRECTA en el conteo del administrador.
 *
 * Ejecuta el código REAL (js/88, js/47, js/49, js/54, js/85) contra un
 * Firestore simulado; además, comprobaciones estáticas de reglas y permisos.
 *   node pruebas/prueba-v527-compras-fvs.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

function extraerFuncion(fuente, nombre) {
    const m = new RegExp('(async\\s+)?function ' + nombre + '\\(').exec(fuente);
    if (!m) throw new Error('No se encontró ' + nombre);
    let nivel = 0, dentro = false;
    for (let j = m.index; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(m.index, j + 1); }
    }
    throw new Error('No cerró ' + nombre);
}

const comp = leer('js/88-compras.js'), exis = leer('js/47-existencia.js'), fvsSrc = leer('js/49-fisico-vs-sistema.js'),
      sync = leer('js/54-sync-vivo.js'), ui85 = leer('js/85-ui-inventario-fisico.js'), r70 = leer('js/70-conversion-render.js'),
      det = leer('js/89-compras-detalle.js'), roles = leer('js/50-roles-permisos.js'), reglas = leer('firestore.rules'),
      css = leer('css/utilidades.css'), busc = leer('js/80-buscador.js'), panel = leer('js/83-panel.js');

// ── Firestore simulado (lecturas + batch) ────────────────────────────────────
function crearDb(docsIniciales) {
    const docs = Object.assign({}, docsIniciales || {});   // 'compras/ID' → data
    const ops = [];
    const snapDoc = (ruta) => ({ exists: !!docs[ruta], data: () => docs[ruta] ? JSON.parse(JSON.stringify(docs[ruta])) : undefined });
    const consulta = (col, filtros) => ({
        where: (c, op, v) => consulta(col, filtros.concat([[c, v]])),
        limit: () => consulta(col, filtros),
        get: async () => {
            const lista = Object.keys(docs).filter(k => k.indexOf(col + '/') === 0)
                .map(k => docs[k]).filter(d => filtros.every(f => String(d[f[0]]) === String(f[1])));
            return { forEach: fn => lista.forEach(d => fn({ data: () => JSON.parse(JSON.stringify(d)) })) };
        }
    });
    const db = {
        collection: col => Object.assign(consulta(col, []), {
            doc: id => ({ _ruta: col + '/' + id, get: async () => snapDoc(col + '/' + id) })
        }),
        batch: () => {
            const pend = [];
            return {
                set: (ref, data) => pend.push(['set', ref._ruta, data]),
                update: (ref, data) => pend.push(['update', ref._ruta, data]),
                delete: ref => pend.push(['delete', ref._ruta]),
                commit: async () => {
                    if (db.fallarCommit) { const e = new Error('x'); e.code = db.fallarCommit; throw e; }
                    pend.forEach(o => {
                        ops.push(o);
                        if (o[0] === 'set') docs[o[1]] = JSON.parse(JSON.stringify(o[2]));
                        else if (o[0] === 'update') docs[o[1]] = Object.assign({}, docs[o[1]], o[2]);
                        else delete docs[o[1]];
                    });
                }
            };
        }
    };
    return { db, docs, ops };
}

// ── Monta js/88 REAL con su entorno ─────────────────────────────────────────
function montarCompras(opts) {
    opts = opts || {};
    const f = crearDb(opts.docs);
    const reg = { notifs: [], registros: [], guardados: 0, olvidadas: [], repintados: 0 };
    const ctx = {
        console: { warn() {}, info() {}, log() {}, error() {} },
        compras: opts.compras || [], movimientos: opts.movimientos || [],
        products: [{ id: 'TEQ', name: 'TEQUILA DON JULIO', unit: 'PZA', group: 'TEQUILA' },
                   { id: 'LIM', name: 'LIMON', unit: 'KGS', group: 'FRUTA' }],
        _db: f.db, navigator: { onLine: opts.offline ? false : true },
        currentUserUid: 'jefe', auditCurrentUser: { userName: 'Eduardo' },
        isAdmin: () => opts.admin !== false,
        hasPermission: p => (opts.permisos || ['purchases.read', 'purchases.import', 'purchases.create', 'purchases.delete']).indexOf(p) !== -1,
        saveToLocalStorage: () => { reg.guardados++; },
        _registrarEnSyncQueue: e => reg.registros.push(e),
        showNotification: m => reg.notifs.push(m),
        existenciaOlvidarCompra: id => reg.olvidadas.push(id),
        existenciaRepintarSeguro: () => { reg.repintados++; },
        semanaId: iso => '2026-10-05', fechaISOLocal: d => '2026-10-12',
        escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        _crearBackupNombrado: () => {}, renderTab: () => {}
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(extraerFuncion(leer('js/40-firestore.js'), '_escribirCompraEnBatch') + '\nvar COMPRA_MAX_OPS = 450;', ctx);
    vm.runInContext(comp, ctx, { filename: 'js/88-compras.js' });
    return { ctx, f, reg, run: code => vm.runInContext(code, ctx) };
}

const compraBase = (id, extra) => Object.assign({
    compraId: id, folio: id.replace(/^\D+-/, ''), docSap: null, fecha: '2026-10-08', semanaId: '2026-10-05',
    proveedorCodigo: 'P01', proveedorNombre: 'VINOTECA', importe: 700, origen: 'excel',
    lineas: [{ productoId: 'TEQ', cantidadInventario: 2, costoUnitario: 350, importe: 700, enCatalogo: true, unidadDocumento: 'PZA' }]
}, extra || {});

(async function main() {
    // ═══ 1 · Cancelación: guardas y efecto ══════════════════════════════════
    {
        const m = montarCompras();
        const c = m.run('compraCancelada');
        chk('compraCancelada() solo es true con cancelada === true', c({ cancelada: true }) === true && c({ cancelada: 'si' }) === false && c(null) === false);
        const as = m.run('_asientosDesdeCompra');
        chk('★ Una compra cancelada no genera asientos (no suma al Total por ninguna ruta)',
            as(compraBase('folio-1')).length === 1 && as(compraBase('folio-1', { cancelada: true })).length === 0);
    }
    {
        const act = compraBase('sap-500', { docSap: '500' });
        const m = montarCompras({ docs: { 'compras/sap-500': act, 'movimientos/compra_sap-500_TEQ': { movId: 'compra_sap-500_TEQ' } },
                                  compras: [JSON.parse(JSON.stringify(act))],
                                  movimientos: [{ movId: 'compra_sap-500_TEQ', tipo: 'compra', productoId: 'TEQ', cantidad: 2, origen: { compraId: 'sap-500' } },
                                                { movId: 'compra_otra_LIM', tipo: 'compra', productoId: 'LIM', cantidad: 1, origen: { compraId: 'otra' } }] });
        const corto = await m.run('cancelarCompra')('sap-500', 'no');
        chk('Cancelar exige motivo (mínimo 5 caracteres)', !corto.ok && corto.motivo === 'motivo_corto' && m.f.ops.length === 0);
        const res = await m.run('cancelarCompra')('sap-500', '  Se importó con la fecha equivocada  ');
        const doc = m.f.docs['compras/sap-500'];
        chk('★ Cancelar MARCA la compra (no la borra): cancelada, quién, cuándo y motivo', res.ok && res.motivo === 'cancelada' && doc
            && doc.cancelada === true && doc.canceladaPor === 'jefe' && typeof doc.canceladaEn === 'number'
            && doc.motivoCancelacion === 'Se importó con la fecha equivocada' && doc.canceladaPorNombre === 'Eduardo');
        chk('★ El mismo batch borra sus asientos de movimientos/ (el libro no respalda mercancía cancelada)',
            m.f.ops.some(o => o[0] === 'update' && o[1] === 'compras/sap-500') && m.f.ops.some(o => o[0] === 'delete' && o[1] === 'movimientos/compra_sap-500_TEQ')
            && !m.f.docs['movimientos/compra_sap-500_TEQ']);
        chk('★ En el dispositivo: la compra queda cancelada y sus asientos salen del libro (los de otras compras no)',
            m.ctx.compras[0].cancelada === true && m.ctx.movimientos.length === 1 && m.ctx.movimientos[0].movId === 'compra_otra_LIM');
        chk('Se purga la caché del arrastre de esa compra y se registra en el historial', m.reg.olvidadas.indexOf('sap-500') !== -1
            && m.reg.registros.some(r => r.tipo === 'compra_cancelada' && /fecha equivocada/.test(r.detalle)));
        const otra = await m.run('cancelarCompra')('sap-500', 'segundo intento de cancelar');
        chk('Cancelar dos veces no es error: "ya_cancelada" y no vuelve a escribir', otra.ok && otra.motivo === 'ya_cancelada'
            && m.f.ops.filter(o => o[0] === 'update').length === 1);
    }
    {
        const m1 = montarCompras({ admin: false, docs: { 'compras/x': compraBase('x') } });
        const r1 = await m1.run('cancelarCompra')('x', 'motivo suficiente');
        chk('★ Solo administración: un no-admin no puede cancelar aunque tenga el permiso', !r1.ok && r1.motivo === 'sin_permiso' && m1.f.ops.length === 0);
        const m2 = montarCompras({ permisos: ['purchases.read'], docs: { 'compras/x': compraBase('x') } });
        const r2 = await m2.run('cancelarCompra')('x', 'motivo suficiente');
        chk('Sin purchases.delete tampoco (admin con el permiso revocado)', !r2.ok && r2.motivo === 'sin_permiso');
        const m3 = montarCompras({ offline: true, docs: { 'compras/x': compraBase('x') } });
        const r3 = await m3.run('cancelarCompra')('x', 'motivo suficiente');
        chk('★ Cancelar exige conexión (si no, el Total quedaría distinto entre dispositivos)', !r3.ok && r3.motivo === 'sin_conexion' && m3.f.ops.length === 0);
        const m4 = montarCompras({ docs: { 'compras/x': compraBase('x') } });
        m4.f.db.fallarCommit = 'permission-denied';
        const r4 = await m4.run('cancelarCompra')('x', 'motivo suficiente');
        chk('Si el servidor rechaza, no se toca el dispositivo', !r4.ok && r4.motivo === 'permiso_denegado' && m4.ctx.compras.length === 0);
    }

    // ═══ 2 · Reingreso de una cancelada ═════════════════════════════════════
    {
        const canc = compraBase('sap-700', { docSap: '700', cancelada: true, canceladaEn: 111, canceladaPor: 'jefe',
                                             canceladaPorNombre: 'Eduardo', motivoCancelacion: 'fecha mal', fechaIngreso: '2026-10-01' });
        const m = montarCompras({ docs: { 'compras/sap-700': canc }, compras: [JSON.parse(JSON.stringify(canc))] });
        const nueva = compraBase('sap-700', { docSap: '700', fechaIngreso: '2026-10-09' });
        const r = await m.run('guardarCompra')(nueva);
        const doc = m.f.docs['compras/sap-700'];
        chk('★ Reimportar una compra CANCELADA la reingresa (motivo "reingresada"), no la deja en "ya existía"', r.ok && r.motivo === 'reingresada'
            && doc.cancelada === false && doc.fechaIngreso === '2026-10-09');
        chk('★ El rastro de la cancelación viaja en `cancelaciones`', Array.isArray(doc.cancelaciones) && doc.cancelaciones.length === 1
            && doc.cancelaciones[0].motivo === 'fecha mal' && doc.cancelaciones[0].fechaIngreso === '2026-10-01');
        chk('Vuelve a escribir sus asientos y el dispositivo la reemplaza (no la duplica)', !!m.f.docs['movimientos/compra_sap-700_TEQ']
            && m.ctx.compras.length === 1 && m.ctx.compras[0].cancelada === false && m.ctx.movimientos.length === 1);
        const act = compraBase('sap-800', { docSap: '800' });
        const m2 = montarCompras({ docs: { 'compras/sap-800': act } });
        const r2 = await m2.run('guardarCompra')(compraBase('sap-800', { docSap: '800', importe: 1 }));
        chk('Una ACTIVA sigue siendo "ya existía": nunca se sobrescribe', r2.ok && r2.motivo === 'ya_existia' && m2.f.docs['compras/sap-800'].importe === 700);
    }

    // ═══ 3 · Mezcla local (otro dispositivo canceló) ═════════════════════════
    {
        const act = compraBase('folio-9');
        const m = montarCompras({ compras: [JSON.parse(JSON.stringify(act))],
                                  movimientos: [{ movId: 'compra_folio-9_TEQ', tipo: 'compra', productoId: 'TEQ', cantidad: 2, origen: { compraId: 'folio-9' } }] });
        const cambio = m.run('_agregarCompraLocal')(Object.assign({}, act, { cancelada: true, motivoCancelacion: 'x' }), []);
        chk('★ _agregarCompraLocal reemplaza una compra que cambió en el servidor y purga sus asientos', cambio === true
            && m.ctx.compras[0].cancelada === true && m.ctx.movimientos.length === 0 && m.reg.olvidadas.indexOf('folio-9') !== -1);
        chk('La misma versión otra vez no cambia nada', m.run('_agregarCompraLocal')(m.ctx.compras[0], []) === false);
    }
    {
        // syncVivoMezclarCompra REAL (js/54) — "el libro solo crece" ya no aplica a una compra que cambió.
        const ctx = { console, window: {} };
        vm.createContext(ctx);
        vm.runInContext(extraerFuncion(sync, 'syncVivoMezclarCompra'), ctx);
        const lista = [{ compraId: 'C1', v: 1 }], libro = [{ movId: 'compra_C1_A', cantidad: 1, origen: { compraId: 'C1' } },
                                                           { movId: 'compra_C2_A', cantidad: 5, origen: { compraId: 'C2' } }];
        const der = c => c.cancelada ? [] : [{ movId: 'compra_C1_A', cantidad: c.v, origen: { compraId: 'C1' } }];
        ctx.syncVivoMezclarCompra({ compraId: 'C1', v: 3 }, lista, libro, der, () => {});
        chk('★ Sync en vivo: si la compra cambia, su asiento se reconstruye con el valor nuevo', libro.length === 2
            && libro.find(x => x.movId === 'compra_C1_A').cantidad === 3);
        ctx.syncVivoMezclarCompra({ compraId: 'C1', v: 3, cancelada: true }, lista, libro, der, () => {});
        chk('★ Sync en vivo: una compra cancelada en otro dispositivo deja de sumar aquí', libro.length === 1 && libro[0].movId === 'compra_C2_A');
    }
    {
        // existenciaOlvidarCompra REAL (js/47) sobre la caché del arrastre.
        const ctx = { console };
        vm.createContext(ctx);
        vm.runInContext('var _existenciaArrastre = { compras: [{ movId: "a", origen: { compraId: "X" } }, { movId: "b", origen: { compraId: "Y" } }], version: 4 };'
            + 'var _existenciaArrastreMemo = { clave: "k" }; var _existenciaEntradasMemo = { n: 3, mapa: {} };'
            + extraerFuncion(exis, 'existenciaOlvidarCompra'), ctx);
        const r = vm.runInContext('existenciaOlvidarCompra("X")', ctx);
        chk('★ existenciaOlvidarCompra quita esa compra de la caché del arrastre e invalida los memos', r === true
            && vm.runInContext('_existenciaArrastre.compras.length === 1 && _existenciaArrastre.version === 5 && _existenciaArrastreMemo.clave === null && _existenciaEntradasMemo.mapa === null', ctx));
    }

    // ═══ 4 · Duplicados (capa pura) ═════════════════════════════════════════
    {
        const m = montarCompras();
        const clasificar = m.run('comprasClasificarDuplicados');
        const g = (id, extra) => Object.assign({ compraId: id, folio: '', docSap: null, proveedorCodigo: 'P01', proveedorNombre: 'VINOTECA',
            lineas: [{ productoId: 'TEQ', cantidadInventario: 2 }] }, extra || {});
        const existentes = [
            compraBase('sap-1', { docSap: '1', folio: '100', fechaIngreso: '2026-10-07' }),
            compraBase('sap-2', { docSap: '2', folio: '200', cancelada: true }),
            compraBase('folio-300', { folio: '300', proveedorCodigo: 'P09', lineas: [{ productoId: 'LIM', cantidadInventario: 4 }] })
        ];
        const grupos = [
            g('sap-1', { docSap: '1', folio: '100' }),                         // mismo id activo
            g('sap-2', { docSap: '2', folio: '200' }),                         // mismo id cancelado
            g('folio-100', { folio: '100' }),                                   // mismo folio+prov que sap-1 (export sin Doc SAP)
            g('sap-555', { docSap: '555', folio: '555', lineas: [{ productoId: 'TEQ', cantidadInventario: 7 }] }),  // nueva
            g('folio-555', { folio: '555', lineas: [{ productoId: 'TEQ', cantidadInventario: 7 }] }),                // repetida en el archivo
            g('sap-9', { docSap: '9', folio: '900', proveedorCodigo: 'P09', lineas: [{ productoId: 'LIM', cantidadInventario: 4 }] }), // mismo contenido
            g('folio-300b', { folio: '300', proveedorCodigo: 'P77', lineas: [{ productoId: 'TEQ', cantidadInventario: 9 }] })        // mismo folio, OTRO proveedor
        ];
        const r = clasificar(grupos, existentes);
        chk('★ Mismo id ya activo → "ya ingresada", bloquea', grupos[0].duplicado && grupos[0].duplicado.tipo === 'activa' && grupos[0].duplicado.bloquea === true);
        chk('Mismo id pero cancelado → se reingresa (no bloquea)', grupos[1].duplicado && grupos[1].duplicado.tipo === 'reingreso' && grupos[1].duplicado.bloquea === false);
        chk('★ Mismo folio + proveedor con OTRO id (un export sin Doc SAP) → bloquea: era el hueco real', grupos[2].duplicado
            && grupos[2].duplicado.tipo === 'activa' && grupos[2].duplicado.compraId === 'sap-1');
        chk('Una entrada nueva no se marca', grupos[3].duplicado === null);
        chk('★ Repetida dentro del mismo archivo → la segunda se bloquea', grupos[4].duplicado && grupos[4].duplicado.tipo === 'archivo' && grupos[4].duplicado.bloquea);
        chk('Mismo proveedor y mismos productos/cantidades con otro folio → posible duplicado, bloquea por defecto', grupos[5].duplicado
            && grupos[5].duplicado.tipo === 'contenido' && grupos[5].duplicado.bloquea === true);
        chk('Mismo folio de OTRO proveedor no es duplicado', grupos[6].duplicado === null);
        chk('El resumen cuenta cada caso', r.activas === 2 && r.reingresos === 1 && r.archivo === 1 && r.contenido === 1);
        grupos[5].importarAunAsi = true;
        clasificar(grupos, existentes);
        chk('"Importar de todos modos" libera solo el posible duplicado por contenido', grupos[5].duplicado.bloquea === false && grupos[0].duplicado.bloquea === true);
        const importables = m.run('_comprasGruposImportables')({ grupos: grupos });
        chk('Solo pasan a guardarse las no bloqueadas', importables.map(x => x.compraId).join(',') === 'sap-2,sap-555,sap-9,folio-300b');
    }
    {
        // Lectura del servidor para la verificación: acotada, nunca la colección entera.
        const enServidor = compraBase('sap-77', { docSap: '77', folio: '7700' });
        const m = montarCompras({ docs: { 'compras/sap-77': enServidor } });
        const parsed = { grupos: [{ compraId: 'folio-7700', folio: '7700', docSap: null, semanaId: '2026-10-05', proveedorCodigo: 'P01', proveedorNombre: 'VINOTECA', lineas: [] }] };
        await m.run('comprasVerificarDuplicados')(parsed);
        chk('★ La verificación consulta el servidor: detecta una compra que NO está en el dispositivo', parsed.verificacionCompleta === true
            && parsed.grupos[0].duplicado && parsed.grupos[0].duplicado.compraId === 'sap-77' && parsed.verificando === false);
        const m2 = montarCompras({ offline: true });
        const p2 = { grupos: [{ compraId: 'folio-1', folio: '1', lineas: [] }] };
        await m2.run('comprasVerificarDuplicados')(p2);
        chk('Sin conexión la verificación queda incompleta (y la importación no se permite)', p2.verificacionCompleta === false);
    }

    // ═══ 5 · Fecha de ingreso ══════════════════════════════════════════════
    {
        const m = montarCompras();
        const v = m.run('comprasValidarFechaIngreso');
        chk('★ La fecha de ingreso es obligatoria', v('', '2026-10-12').ok === false && v(null, '2026-10-12').ok === false);
        chk('No puede ser futura ni inexistente', v('2026-10-13', '2026-10-12').ok === false && v('2026-02-30', '2026-10-12').ok === false);
        chk('Hoy o antes es válida', v('2026-10-12', '2026-10-12').ok === true && v('2026-09-30', '2026-10-12').ok === true);
        const conf = extraerFuncion(comp, 'confirmarImportacionCompras');
        chk('★ Confirmar valida la fecha, RE-verifica duplicados justo antes de escribir y omite los bloqueados',
            /comprasValidarFechaIngreso\(parsed\.fechaIngreso/.test(conf) && /await comprasVerificarDuplicados\(parsed\)/.test(conf)
            && /g\.duplicado && g\.duplicado\.bloquea/.test(conf) && /verificacionCompleta === false/.test(conf));
        chk('★ La fecha de ingreso se guarda en la compra; `fecha` (SAP) y `semanaId` no cambian (informativa)',
            /fechaIngreso: parsed\.fechaIngreso/.test(conf) && /fecha: g\.fecha, semanaId: g\.semanaId/.test(conf));
        chk('La importación empieza con la fecha VACÍA (no se adivina)', /parsed\.fechaIngreso = '';/.test(comp));
        const prev = extraerFuncion(comp, 'renderVistaPreviaCompras');
        chk('La vista previa pide la fecha (input date con máximo hoy) y desactiva Confirmar sin ella', /type="date" max="/.test(prev)
            && /Elige la fecha de ingreso para continuar/.test(prev) && /disabled aria-disabled="true"/.test(prev));
    }

    // ═══ 6 · Lista: fecha de ingreso, proveedor y producto ════════════════════
    {
        const lista = [
            compraBase('a', { fechaIngreso: '2026-10-05', proveedorNombre: 'ALFA', proveedorCodigo: 'A1', folio: '1' }),
            compraBase('b', { fecha: '2026-10-09', proveedorNombre: 'BETA', proveedorCodigo: 'B1', folio: '2',
                               lineas: [{ productoId: 'LIM', cantidadInventario: 3, descripcionSap: 'LIMON PERSA' }] }),
            compraBase('c', { fechaIngreso: '2026-10-11', proveedorNombre: 'ALFA', proveedorCodigo: 'A1', folio: '3', cancelada: true })
        ];
        const m = montarCompras({ compras: lista });
        const ord = m.run('_comprasOrdenadas')().map(c => c.compraId).join(',');
        chk('★ Ordenadas por FECHA DE INGRESO (más reciente primero; sin fechaIngreso cae a la de SAP)', ord === 'c,b,a', ord);
        m.ctx._motorCompras = { buscar: (base, q) => ({ items: base.filter(c => JSON.stringify(c).toUpperCase().indexOf(q.toUpperCase()) !== -1) }) };
        const porProv = m.run('comprasFiltrar')(lista, '', 'cod:A1');
        chk('★ Filtro por proveedor', porProv.items.map(c => c.compraId).join(',') === 'c,a' && porProv.total === 2);
        const porProd = m.run('comprasFiltrar')(lista, 'limon', '');
        chk('★ Búsqueda por producto (encuentra la compra que trae ese producto)', porProd.items.map(c => c.compraId).join(',') === 'b');
        const provs = m.run('comprasProveedores')(lista);
        chk('El selector lista cada proveedor una vez, con su número de entradas', provs.length === 2 && provs[0].nombre === 'ALFA' && provs[0].n === 2);
        const res = m.run('_resumenCompras')();
        chk('El resumen no cuenta canceladas (y las informa aparte)', res.documentos === 2 && res.canceladas === 1 && res.importe === 1400);
        chk('El motor de búsqueda de Compras indexa los productos de las líneas y folio/Doc SAP como código',
            /var _motorCompras = crearMotorBusqueda/.test(busc) && /nombre: 'productos', peso: 3/.test(busc)
            && /nombre: 'folio',  peso: 2, codigo: true/.test(busc) && /BusquedaUI\.registrar\('compras'/.test(busc));
        const tab = extraerFuncion(comp, 'renderComprasTab');
        chk('La pestaña tiene barra de búsqueda y selector de proveedor', /BusquedaUI\.barra\('compras'/.test(tab) && /_comprasSelectorProveedor\(\)/.test(tab));
        const resu = extraerFuncion(comp, '_renderComprasResultados');
        chk('Se agrupa por día de ingreso con el total del día (sin canceladas)', /cp-dia__cab/.test(resu) && /activasDia/.test(resu));
        const tarj = extraerFuncion(comp, '_comprasTarjetaHtml');
        chk('Una cancelada se ve tachada, con su motivo', /cp-tarjeta--cancelada/.test(tarj) && /cp-badge-cancelada/.test(tarj) && /motivoCancelacion/.test(tarj));
    }

    // ═══ 7 · Detalle y otras pantallas ══════════════════════════════════════
    chk('★ El detalle ofrece "Cancelar esta entrada" solo a quien puede y solo si sigue activa',
        /puedeCancelarCompras\(\)/.test(extraerFuncion(det, '_cdHtmlFormCancelar')) && /c\.cancelada === true\) return ''/.test(extraerFuncion(det, '_cdHtmlFormCancelar')));
    chk('El detalle pide el motivo y delega en cancelarCompra (no escribe por su cuenta)', /cancelarCompra\(compraId, motivo\)/.test(det) && /id="cd-motivo"/.test(det));
    chk('Lo recibido del proveedor y la ficha de producto no cuentan canceladas',
        /_cdClaveProveedor\(c\) === clave && !\(c && c\.cancelada === true\)/.test(det) && /c\.cancelada === true\) return;/.test(panel));

    // ═══ 8 · Reglas y permiso ═══════════════════════════════════════════════
    const bloqueCompras = reglas.slice(reglas.indexOf('match /compras/{compraId}'), reglas.indexOf('match /movimientos/{movId}'));
    const bloqueMov = reglas.slice(reglas.indexOf('match /movimientos/{movId}'), reglas.indexOf('match /contadores/compras'));
    chk('★ Reglas: cancelar exige isAdminUser() + purchases.delete y solo toca los campos de la cancelación',
        /isAdminUser\(\)\s*&& hasPerm\('purchases\.delete'\)/.test(bloqueCompras)
        && /affectedKeys\(\)\s*\.hasOnly\(\['cancelada', 'canceladaEn', 'canceladaPor', 'canceladaPorNombre', 'motivoCancelacion'\]\)/.test(bloqueCompras)
        && /resource\.data\.get\('cancelada', false\) != true/.test(bloqueCompras));
    chk('★ Reglas: reingresar solo sobre una CANCELADA, con los requisitos de un alta y el rastro', /resource\.data\.get\('cancelada', false\) == true/.test(bloqueCompras)
        && /request\.resource\.data\.cancelaciones is list/.test(bloqueCompras));
    chk('Reglas: una compra sigue sin poder borrarse', /allow delete: if false;/.test(bloqueCompras));
    chk('★ Reglas: un asiento solo se borra si su compra queda cancelada al terminar el batch (getAfter)',
        /allow delete: if isAdminUser\(\)/.test(bloqueMov) && /getAfter\(\/databases\/\$\(database\)\/documents\/compras\/\$\(resource\.data\.origen\.compraId\)\)\.data\.get\('cancelada', false\) == true/.test(bloqueMov)
        && /allow update: if false;/.test(bloqueMov));
    chk('Reglas: fechaIngreso opcional, y si viene es AAAA-MM-DD', /function _fechaIngresoValida\(\)/.test(bloqueCompras) && /matches\('\^\[0-9\]\{4\}-/.test(bloqueCompras));
    chk('★ Permiso purchases.delete ahora es "Cancelar entradas de compra": efectivo y NO delegable',
        /'purchases\.delete':\s*\{ nombre: 'Cancelar entradas de compra'[^}]*delegable: false[^}]*efectivo: true/.test(roles));

    // ═══ 9 · Físico vs Sistema ══════════════════════════════════════════════
    {
        const ctx = { console, products: [], AREAS_CONTEO: ['almacen', 'barra1', 'barra2', 'bodega'], auditoriaConteo: {},
                      tieneConversion: p => !!p.capacidadMl, convertirOzAPuntos: (oz) => oz / 10 };
        vm.createContext(ctx);
        vm.runInContext(fvsSrc, ctx);
        ctx.products.push({ id: 'TEQ', name: 'TEQ', capacidadMl: 750 });
        ctx.auditoriaConteo.TEQ = { almacen: { enteras: 2, abiertas: [5] }, barra1: { enteras: 1, abiertas: [] } };
        const pa = vm.runInContext('fvsConteoPorArea("TEQ")', ctx);
        chk('★ El conteo se entrega ÁREA POR ÁREA (las 4 áreas; sin dato = null, no 0)', pa.tocado && pa.areas.almacen.total === 2.5
            && pa.areas.barra1.total === 1 && pa.areas.barra2 === null && pa.areas.bodega === null);
        chk('El total físico sigue siendo la suma de las áreas', vm.runInContext('fvsConteoFisicoProducto("TEQ")', ctx) === 3.5);
        const filas = [
            { id: 'a', nombre: 'A', grupo: 'WHISKY', estado: 'contado', diferencia: 2, neto: 10 },
            { id: 'b', nombre: 'B', grupo: 'WHISKY', estado: 'contado', diferencia: -3, neto: -30 },
            { id: 'c', nombre: 'C', grupo: 'WHISKY', estado: 'pendiente', diferencia: null, neto: null },
            { id: 'd', nombre: 'D', grupo: 'WHISKY', estado: 'contado', diferencia: 0, neto: 0 },
            { id: 'e', nombre: 'E', grupo: 'GIN', estado: 'contado', diferencia: 1, neto: 5 }
        ];
        const agr = vm.runInContext('fisicoVsSistemaAgrupar', ctx);
        const g1 = agr(filas, 'menor_mayor');
        chk('★ Agrupado por grupo del catálogo (alfabético)', g1.map(g => g.grupo).join(',') === 'GIN,WHISKY');
        chk('★ Dentro del grupo: diferencia de menor a mayor; lo sin contar al final', g1[1].filas.map(f => f.id).join(',') === 'b,d,a,c');
        chk('El orden se puede invertir (mayor → menor)', agr(filas, 'mayor_menor')[1].filas.map(f => f.id).join(',') === 'a,d,b,c');
        chk('Cada grupo trae su neto y sus contados/pendientes', g1[1].neto === -20 && g1[1].contados === 3 && g1[1].pendientes === 1);
    }
    {
        // Corrección directa (js/85 REAL): escribe en el conteo del admin y sincroniza.
        const llamadas = { sync: 0, guardar: 0, render: 0, notifs: [] };
        const mk = (opts) => {
            const ctx = {
                console, products: [{ id: 'TEQ', name: 'TEQUILA' }], AREAS_CONTEO: ['almacen', 'barra1'], areasAuditoria: { almacen: 'Almacén', barra1: 'Barra 1' },
                auditoriaConteo: { TEQ: { almacen: { enteras: 2, abiertas: [] } } }, myAuditoriaConteo: {},
                isAdmin: () => opts.admin !== false, _inventarioActivo: { estado: 'SINCRONIZADO' }, inventarioAbierto: inv => inv.estado === 'SINCRONIZADO',
                _auditoriaSessionId: 's1', navigator: { onLine: opts.offline ? false : true }, _auditSyncPending: false,
                saveToLocalStorage: () => { llamadas.guardar++; }, syncMyAuditoriaToFirestore: async () => { llamadas.sync++; },
                renderTab: () => { llamadas.render++; }, showNotification: m => llamadas.notifs.push(m),
                openInventarioModal: (pid, o) => { ctx._abierto = { pid, o }; }
            };
            vm.createContext(ctx);
            ['_fvsAreasLista', '_fvsEtiquetaArea', '_fvsPuedeCorregir', 'fvsEditarArea', '_fvsMismoConteo', 'fvsAplicarCorreccion']
                .forEach(n => vm.runInContext(extraerFuncion(ui85, n), ctx));
            vm.runInContext('var _fvsGuardando = false;', ctx);
            return ctx;
        };
        const c1 = mk({});
        vm.runInContext('fvsEditarArea("TEQ", "almacen")', c1);
        chk('★ Tocar un área abre el MISMO modal de conteo, precargado con el valor oficial de esa área', c1._abierto && c1._abierto.pid === 'TEQ'
            && c1._abierto.o.fvs.area === 'almacen' && c1._abierto.o.fvs.valor.enteras === 2);
        await vm.runInContext('fvsAplicarCorreccion("TEQ", "almacen", 5, [])', c1);
        chk('★ Guardar escribe DIRECTO en el conteo del administrador (autoridad de la consolidación) y sincroniza', c1.myAuditoriaConteo.TEQ.almacen.enteras === 5
            && c1.myAuditoriaConteo.TEQ.almacen._fvs === true && llamadas.sync === 1 && llamadas.guardar === 1);
        const antesSync = llamadas.sync;
        await vm.runInContext('fvsAplicarCorreccion("TEQ", "almacen", 2, [])', mk({}));
        chk('Si coincide con lo contado no escribe nada', llamadas.sync === antesSync);
        const c3 = mk({ admin: false });
        vm.runInContext('fvsEditarArea("TEQ", "almacen")', c3);
        await vm.runInContext('fvsAplicarCorreccion("TEQ", "almacen", 9, [])', c3);
        chk('★ Un no-admin no puede corregir (solo lectura)', !c3._abierto && !c3.myAuditoriaConteo.TEQ);
        const c4 = mk({ offline: true });
        await vm.runInContext('fvsAplicarCorreccion("TEQ", "almacen", 9, [])', c4);
        chk('★ Sin conexión no se corrige (como el reconteo: no se arriesga perderla al cerrar)', !c4.myAuditoriaConteo.TEQ);
        const c5 = mk({}); c5._inventarioActivo = { estado: 'CERRADO' };
        await vm.runInContext('fvsAplicarCorreccion("TEQ", "almacen", 9, [])', c5);
        chk('Con el inventario cerrado no se corrige (es inmutable)', !c5.myAuditoriaConteo.TEQ);
    }
    chk('★ saveInventarioModal: la corrección de FvS pasa por las MISMAS validaciones y luego va a fvsAplicarCorreccion',
        (function() { const s = extraerFuncion(r70, 'saveInventarioModal'); return s.indexOf('if (_fvsEdicion)') > s.indexOf('Las botellas enteras deben ser número entero') && /fvsAplicarCorreccion\(_ctxFv\.prodId, _ctxFv\.area, enteras, abiertas\)/.test(s); })());
    chk('El modal de FvS no salta al "siguiente" y se limpia al cerrar', /_reconteoEdicion \|\| !isAuditoriaMode \|\| !auditoriaAreaActiva \|\| _fvsEdicion\) return null;/.test(r70)
        && /_fvsEdicion = null;/.test(extraerFuncion(r70, 'closeInventarioModal')));
    {
        const tj = extraerFuncion(ui85, '_fvsTarjetaHtml');
        chk('La tarjeta es la del reconteo (rc-card / rc-areas) con un botón por área solo si se puede editar', /rc-card fvs-card/.test(tj)
            && /rc-areas fvs-areas/.test(tj) && /editable && p/.test(tj) && /data-fvs-accion="editar"/.test(tj));
        const rr = extraerFuncion(ui85, '_renderFvsResultados');
        chk('La lista se pinta por grupos con fisicoVsSistemaAgrupar y paginada', /fisicoVsSistemaAgrupar\(r\.items, orden\)/.test(rr) && /BusquedaUI\.centinela\('fvs'/.test(rr));
        chk('Chip para invertir el orden (predeterminado: menor → mayor)', /orden_desc/.test(extraerFuncion(ui85, '_chipsFvs')) && /'mayor_menor' : 'menor_mayor'/.test(ui85));
    }

    // ═══ 10 · Estilos ═══════════════════════════════════════════════════════
    const bloqueCss = css.slice(css.indexOf('v5.27 — Compras'));
    chk('Los estilos nuevos viven en utilidades.css y solo usan tokens (cero hex a mano)', bloqueCss.length > 100
        && !/#[0-9a-fA-F]{3,8}\b/.test(bloqueCss.replace(/url\("data:[^"]*"\)/g, '')));
    chk('Los iconos nuevos existen en el kit (ban, truck, hand-pointer, calendar-check)',
        ['fa-ban', 'fa-truck', 'fa-hand-pointer', 'fa-calendar-check'].every(i => new RegExp('^\\.' + i + '\\s', 'm').test(css)));
    chk('Botones táctiles nuevos de al menos 44 px', /\.cp-fi__hoy \{[^}]*min-height: 48px/.test(css) && /\.cp-filtro__sel \{[^}]*min-height: 44px/.test(css)
        && /\.cp-dup__opcion \{[^}]*min-height: 44px/.test(css));

    const w = Math.max.apply(null, casos.map(c => c.n.length));
    console.log('\n  ── v5.27 · Compras (cancelar, fecha de ingreso, duplicados, lista) y Físico vs Sistema ──\n');
    casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
    console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
