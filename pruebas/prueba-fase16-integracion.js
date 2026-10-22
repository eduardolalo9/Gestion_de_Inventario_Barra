/**
 * prueba-fase16-integracion.js — v5.19 contra Firestore REAL
 * (emulador + firestore.rules byte a byte)
 * ═══════════════════════════════════════════════════════════════════════════
 *   W1  totalPublicado: escribe quien lee ventas y compras; campos cerrados
 *       (no se cuela un precio); hora del servidor; nadie lo borra; cualquier
 *       cuenta activa lo lee.
 *   W2  ★ De punta a punta: el teléfono de administración (js/47 + js/51
 *       reales) calcula y PUBLICA; el del bartender lo ESCUCHA y muestra el
 *       mismo Total.
 *   W3  papelera: lee admin; crea quien borra (con su permiso) y a ±10 min de
 *       la hora del servidor; no se edita salvo "restaurado"; solo se vacía lo
 *       de más de 30 días.
 *   W4  ★ Atomicidad: papelera + borrado en un batch. Si la papelera no pasa
 *       las reglas, el batch falla y NO se borra nada.
 *   W5  ★ Restaurar conteos (js/53 real): vuelven al inventario abierto sin
 *       pisar lo que la persona ya contó.
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-fase16-integracion.js"
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const compat = require('firebase/compat/app');
require('firebase/compat/firestore');
const fb = compat.default || compat;
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const PROJECT_ID = 'demo-barinventory';
const DOC_ID = 'barra-principal';
const R = 'inventarioApp/' + DOC_ID;
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let fallos = 0, total = 0;
function chk(nombre, ok, detalle) {
    total++;
    if (ok) console.log('  ✅ ' + nombre);
    else { fallos++; console.error('  ❌ ' + nombre + (detalle ? '  ← ' + detalle : '')); }
}
function extraerFuncion(rel, nombre) {
    const fuente = leer(rel);
    const i = fuente.indexOf('function ' + nombre + '(');
    if (i === -1) throw new Error('No se encontró ' + nombre + ' en ' + rel);
    let nivel = 0, dentro = false;
    for (let j = i; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(i, j + 1); }
    }
    throw new Error('No se pudo delimitar ' + nombre);
}

// js/15 + 46 + 48 + 47 + 51 reales, con un Firestore real y unos permisos dados.
function montarTotal(db, uid, permisos, productos, recetasLista) {
    const deps = {
        _db: db, FIRESTORE_DOC_ID: DOC_ID, products: productos, recetas: recetasLista, currentUserUid: uid,
        movimientos: [], ventas: [], ventasSemanaId: null, firebase: fb, navigator: { onLine: true },
        getTotalStock: (p) => (p && p.operativa) || 0,
        _authzState: { loaded: true }, hasPermission: (p) => permisos === '*' || permisos.indexOf(p) !== -1,
        console: { warn() {}, info() {}, log() {}, error() {} }, setTimeout, clearTimeout
    };
    deps.window = deps;
    const cuerpo = leer('js/15-ciclo-semanal.js') + '\n' + leer('js/46-arrastre.js') + '\n' +
                   extraerFuncion('js/88-compras.js', '_asientosDesdeCompra') + '\n' +
                   extraerFuncion('js/93-ventas.js', '_ventasPeriodoDeDoc') + '\n' +
                   leer('js/48-consumo-teorico.js') + '\n' + leer('js/47-existencia.js') + '\n' + leer('js/51-total-publicado.js');
    return new Function('deps', 'with (deps) {\n' + cuerpo + '\n; return { cargar: existenciaCargarInicial, estado: existenciaInicialEstado, ' +
        'oficial: existenciaOficial, publicar: totalPublicadoPublicarAhora, enUso: totalPublicadoEnUso, info: totalPublicadoInfo, ' +
        'desuscribir: totalPublicadoDesuscribir, fechaISOLocal: fechaISOLocal, semanaId: semanaId }; }')(deps);
}

function montarPapelera(db, uid, sesion) {
    const deps = { _db: db, FIRESTORE_DOC_ID: DOC_ID, currentUserUid: uid, _auditoriaSessionId: sesion,
                   estadoAreasVacio: (v) => ({ almacen: v, barra1: v, barra2: v }), console: { warn() {}, error() {}, log() {} } };
    deps.window = deps;
    return new Function('deps', 'with (deps) {\n' + leer('js/53-papelera.js') + '\n; return { agrupar: papeleraAgrupar, restaurarConteos: _papRestaurarConteos, ' +
        'registrosConteo: papeleraRegistrosConteo }; }')(deps);
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: leer('firestore.rules'), host: 'localhost', port: 8080 }
    });
    const sembrarUsuarios = () => testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
        await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
        await d.doc('roles/ADMIN').set({ roleId: 'ADMIN', permissions: ['*'] });
        await d.doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count', 'catalog.read'] });
    });
    await sembrarUsuarios();
    const dbAdmin = testEnv.authenticatedContext('jefe').firestore();
    const dbBart = testEnv.authenticatedContext('bart1').firestore();
    const intento = async (fn) => { try { await fn(); return true; } catch (e) { return false; } };
    const TS = fb.firestore.FieldValue.serverTimestamp;

    // ═══ W1 — reglas de totalPublicado ═══════════════════════════════════════
    const tpRef = (db, id) => db.collection('inventarioApp').doc(DOC_ID).collection('totalPublicado').doc(id || 'actual');
    const tpDoc = (uid) => ({ version: 1, ancla: { tipo: 'mitad_de_semana', fecha: '2026-10-03', id: '2026-10-03', hora: null },
        valores: { TEQ: [4.4, 3, 2, 0.6] }, productos: 1, conEntradas: 1, diasEsperados: 2, diasFaltantes: [], periodosIncluidos: 1,
        periodosPartidos: [], sinReceta: 0, publicadoPor: uid, huella: 'h1', publicadoEn: TS() });
    chk('W1 · ★ administración publica el Total', await intento(() => tpRef(dbAdmin).set(tpDoc('jefe'))));
    chk('W1 · y lo puede volver a publicar (update)', await intento(() => tpRef(dbAdmin).set(Object.assign(tpDoc('jefe'), { huella: 'h2' }))));
    chk('W1 · ★ el bartender lo LEE', await intento(() => tpRef(dbBart).get()));
    chk('W1 · ★ el bartender NO lo escribe', !(await intento(() => tpRef(dbBart).set(tpDoc('bart1')))));
    chk('W1 · ★ un campo de dinero (precio) se rechaza', !(await intento(() => tpRef(dbAdmin).set(Object.assign(tpDoc('jefe'), { precio: { TEQ: 350 } })))));
    chk('W1 · la hora del cliente (número) se rechaza: la pone el servidor', !(await intento(() => tpRef(dbAdmin).set(Object.assign(tpDoc('jefe'), { publicadoEn: Date.now() })))));
    chk('W1 · publicar a nombre de otro se rechaza', !(await intento(() => tpRef(dbAdmin).set(tpDoc('bart1')))));
    chk('W1 · otro documento que no sea "actual" se rechaza', !(await intento(() => tpRef(dbAdmin, 'otro').set(tpDoc('jefe')))));
    chk('W1 · nadie lo borra', !(await intento(() => tpRef(dbAdmin).delete())));

    // ═══ W2 — de punta a punta con el código real ═════════════════════════════
    await testEnv.clearFirestore(); await sembrarUsuarios();
    const E0 = montarTotal(null, 'x', [], [], []);
    const hoyD = new Date();
    const dia = (n) => E0.fechaISOLocal(new Date(hoyD.getFullYear(), hoyD.getMonth(), hoyD.getDate() + n));
    const fCorte = dia(-6), fPost = dia(-2);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await d.doc(R + '/anclasExistencia/' + fCorte).set({ fecha: fCorte, tipo: 'mitad_de_semana', origen: { inventoryId: 'n' }, saldos: { TEQ: 3, LIM: 2 }, contabilizadoEn: 1 });
        await d.doc(R + '/ventas/' + fPost + '_' + fPost).set({ semanaId: E0.semanaId(fPost), fechaInicio: fPost, fechaFin: fPost,
            lineas: [{ sku: 'PV1', cantidad: 10, ventaNeta: 1500 }], origen: 'excel' });
        await d.doc('compras/C1').set({ compraId: 'C1', fecha: fPost, semanaId: E0.semanaId(fPost), folio: 'C1',
            lineas: [{ productoId: 'TEQ', cantidadInventario: 2, enCatalogo: true, costoUnitario: 300 }] });
    });
    const prods = () => [{ id: 'TEQ', name: 'TEQUILA', unit: 'PZA', precio: 350, operativa: 0 }, { id: 'LIM', name: 'LIMON', unit: 'KGS', precio: 38, operativa: 0 }];
    const recs = [{ pv: 'PV1', ingredientes: [{ productoId: 'TEQ', cantidad: 0.06, uom: 'PZA' }] }];
    const cargar = (E) => new Promise((res) => { E.cargar(res); setTimeout(res, 8000); });
    const EA = montarTotal(dbAdmin, 'jefe', '*', prods(), recs);
    await cargar(EA);
    chk('W2 · administración calcula 3 + 2 − 10×0.06 = 4.4', EA.oficial(prods()[0]).valor === 4.4, JSON.stringify(EA.oficial(prods()[0])));
    await new Promise(r => setTimeout(r, 300));
    const rPub = await EA.publicar();
    chk('W2 · ★ y lo publica en el emulador (reglas reales)', rPub.ok || rPub.motivo === 'sin_cambios', JSON.stringify(rPub));
    let guardado = null;
    await testEnv.withSecurityRulesDisabled(async (ctx) => { const s = await ctx.firestore().doc(R + '/totalPublicado/actual').get(); guardado = s.exists ? s.data() : null; });
    chk('W2 · el documento guardado no trae dinero', guardado && !/precio|costo|importe|ventaNeta/.test(JSON.stringify(Object.keys(guardado))) && guardado.valores.TEQ[0] === 4.4, JSON.stringify(guardado && guardado.valores));
    const EB = montarTotal(dbBart, 'bart1', ['inventory.count', 'catalog.read'], prods(), recs);
    await cargar(EB);
    await new Promise(r => setTimeout(r, 1500));
    chk('W2 · ★ el bartender ve EL MISMO Total (4.4), leído del documento publicado', EB.enUso() && EB.oficial(prods()[0]).valor === 4.4 && EB.oficial(prods()[0]).fuente === 'publicado',
        JSON.stringify([EB.info(), EB.oficial(prods()[0])]));
    EB.desuscribir(); EA.desuscribir();

    // ═══ W3 — reglas de la papelera ══════════════════════════════════════════
    await testEnv.clearFirestore(); await sembrarUsuarios();
    const papRef = (db, id) => db.collection('inventarioApp').doc(DOC_ID).collection('papelera').doc(id);
    const reg = (uid, origen, extra) => Object.assign({ origen: origen, grupo: 'g', parte: 1, partes: 1, rutaOriginal: 'userAuditoria/b',
        contenido: { conteo: { T: { almacen: { enteras: 1 } } } }, resumen: {}, borradoPor: uid, borradoEn: Date.now() }, extra || {});
    chk('W3 · ★ administración guarda conteos en la papelera', await intento(() => papRef(dbAdmin, 'c1').set(reg('jefe', 'conteos'))));
    chk('W3 · administración guarda un producto', await intento(() => papRef(dbAdmin, 'p1').set(reg('jefe', 'producto', { rutaOriginal: 'products', contenido: { productos: [{ id: 'T' }] } }))));
    chk('W3 · el bartender no puede escribir conteos ni productos', !(await intento(() => papRef(dbBart, 'c2').set(reg('bart1', 'conteos'))))
        && !(await intento(() => papRef(dbBart, 'p2').set(reg('bart1', 'producto')))));
    chk('W3 · a nombre de otro se rechaza', !(await intento(() => papRef(dbAdmin, 'c3').set(reg('bart1', 'conteos')))));
    chk('W3 · una fecha de borrado de hace 1 h se rechaza (±10 min del servidor)', !(await intento(() => papRef(dbAdmin, 'c4').set(reg('jefe', 'conteos', { borradoEn: Date.now() - 3600000 })))));
    chk('W3 · crearlo ya "restaurado" se rechaza', !(await intento(() => papRef(dbAdmin, 'c5').set(reg('jefe', 'conteos', { restauradoEn: 1 })))));
    chk('W3 · un origen desconocido se rechaza', !(await intento(() => papRef(dbAdmin, 'c6').set(reg('jefe', 'otro')))));
    chk('W3 · ★ el bartender NO la lee; administración sí', !(await intento(() => papRef(dbBart, 'c1').get())) && await intento(() => papRef(dbAdmin, 'c1').get()));
    chk('W3 · ★ marcar "restaurado" (solo esos dos campos) se permite', await intento(() => papRef(dbAdmin, 'c1').update({ restauradoEn: Date.now(), restauradoPor: 'jefe' })));
    chk('W3 · ★ editar el contenido se rechaza', !(await intento(() => papRef(dbAdmin, 'p1').update({ contenido: { productos: [] } }))));
    chk('W3 · ★ borrar un registro reciente se rechaza', !(await intento(() => papRef(dbAdmin, 'p1').delete())));
    await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc(R + '/papelera/viejo').set(reg('jefe', 'conteos', { borradoEn: Date.now() - 31 * 86400000 })); });
    chk('W3 · lo de más de 30 días sí se puede vaciar (administración)', await intento(() => papRef(dbAdmin, 'viejo').delete()));

    // ═══ W4 — atomicidad: papelera + borrado en el mismo batch ═══════════════
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await d.doc(R).set({ _auditoriaSessionId: '1001' });
        await d.doc(R + '/inventories/1001').set({ inventoryId: '1001', estado: 'SINCRONIZADO', numero: 1001 });
        await d.doc(R + '/userAuditoria/bart1').set({ uid: 'bart1', sessionId: '1001', conteo: { T: { almacen: { enteras: 5 } } } });
    });
    const uaRef = (db) => db.collection('inventarioApp').doc(DOC_ID).collection('userAuditoria').doc('bart1');
    const leerUA = async () => { let x = null; await testEnv.withSecurityRulesDisabled(async (ctx) => { const s = await ctx.firestore().doc(R + '/userAuditoria/bart1').get(); x = s.exists ? s.data() : null; }); return x; };
    const malo = await intento(async () => { const b = dbAdmin.batch(); b.set(papRef(dbAdmin, 'malo'), reg('bart1', 'conteos')); b.delete(uaRef(dbAdmin)); await b.commit(); });
    chk('W4 · ★ si la papelera no pasa las reglas, el batch falla…', !malo);
    chk('W4 · ★ …y el conteo NO se borró', !!(await leerUA()));
    const bueno = await intento(async () => { const b = dbAdmin.batch(); b.set(papRef(dbAdmin, 'bueno'), reg('jefe', 'conteos')); b.delete(uaRef(dbAdmin)); await b.commit(); });
    chk('W4 · con la papelera válida, copia y borrado entran juntos', bueno && !(await leerUA()));

    // ═══ W5 — restaurar conteos (js/53 real) ══════════════════════════════════
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc(R + '/userAuditoria/bart1').set({ uid: 'bart1', sessionId: '1001', conteo: { T1: { almacen: { enteras: 9 } } } });
    });
    const P = montarPapelera(dbAdmin, 'jefe', '1001');
    const regs = P.registrosConteo('bart1', { uid: 'bart1', email: 'bar@x.com', sessionId: '1000',
        conteo: { T1: { almacen: { enteras: 2 }, barra1: { enteras: 1 } }, L1: { almacen: { enteras: 3 } } } }, { ts: Date.now(), uidActor: 'jefe', sessionNueva: '1001' });
    const g = P.agrupar(regs.map(r => Object.assign({ id: r.id }, r.data)))[0];
    let rr = null, errR = null;
    try { rr = await P.restaurarConteos(g); } catch (e) { errR = e; }
    const ua = await leerUA();
    chk('W5 · ★ restaura en el inventario abierto (2 capturas devueltas, 1 omitida)', rr && rr.restaurados === 2 && rr.omitidos === 1, JSON.stringify(rr || String(errR)));
    chk('W5 · ★ lo ya contado NO se pisa (T1/almacén sigue en 9) y lo demás vuelve', ua && ua.conteo.T1.almacen.enteras === 9 && ua.conteo.T1.barra1.enteras === 1 && ua.conteo.L1.almacen.enteras === 3, JSON.stringify(ua && ua.conteo));
    await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc(R + '/inventories/1001').update({ estado: 'CERRADO' }); });
    let cerrado = null; try { await P.restaurarConteos(g); } catch (e) { cerrado = e; }
    chk('W5 · con el inventario cerrado no se restaura (se dice por qué)', cerrado && /cerrado/.test(cerrado.message), String(cerrado));

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones de integración · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
