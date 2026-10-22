/**
 * prueba-importar-integracion.js — v5.18 · Corte de existencias importado
 * desde Excel, contra Firestore REAL (emulador + firestore.rules byte a byte)
 * ═══════════════════════════════════════════════════════════════════════════
 *   K1  ★ El documento que arma el módulo REAL (js/96: validar + armar corte)
 *       pasa las reglas: anclasExistencia/{fecha}_{HHmm}, tipo importacion_excel.
 *   K2  Reglas: id ≠ fecha_hora, hora inválida, id sin hora, tipo inválido y
 *       bartender → rechazados. Nadie actualiza ni borra. Un segundo corte con
 *       la MISMA fecha y hora se rechaza (no pisa al primero).
 *   K3  ★ El Total REAL (js/47 leyendo del emulador): parte del corte importado
 *       y le suma las compras posteriores y le resta el consumo por recetas
 *       posterior; lo del mismo día del corte ya está dentro del conteo.
 *   K4  ★ Mismo día que un recuento de mitad de semana: gana el registrado
 *       DESPUÉS (registradoEn), en los dos sentidos.
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-importar-integracion.js"
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const fs   = require('fs');
const path = require('path');

const RAIZ       = path.resolve(__dirname, '..');
const PROJECT_ID = 'demo-barinventory';
const DOC_ID     = 'barra-principal';
const R          = 'inventarioApp/' + DOC_ID;
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let fallos = 0, total = 0;
function chk(nombre, ok, detalle) {
    total++;
    if (ok) { console.log('  ✅ ' + nombre); }
    else    { fallos++; console.error('  ❌ ' + nombre + (detalle ? '  ← ' + detalle : '')); }
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

// Módulo REAL de importación (15 + 46 + 96), sin DOM.
function montarImportar() {
    const deps = { window: {}, console: { warn() {}, info() {}, log() {}, error() {} },
                   document: { getElementById: () => null, addEventListener() {} } };
    return new Function('deps', 'with (deps) {\n' + leer('js/15-ciclo-semanal.js') + '\n' + leer('js/46-arrastre.js') + '\n' +
        leer('js/96-importar.js') + '\n; return { validar: importarValidarExistencias, armar: importarArmarCorte, ' +
        'fechaISOLocal: fechaISOLocal, semanaId: semanaId }; }')(deps);
}

// Capa de existencia REAL (15 + 46 + 48 + 47) con un Firestore real.
function montarExistencia(db, productos, recetasLista) {
    const deps = {
        _db: db, FIRESTORE_DOC_ID: DOC_ID, products: productos, recetas: recetasLista,
        movimientos: [], ventas: [], ventasSemanaId: null,
        getTotalStock: (p) => (p && p.operativa) || 0,
        console: { warn() {}, info() {}, log() {}, error() {} }
    };
    deps.window = deps;
    const cuerpo = leer('js/15-ciclo-semanal.js') + '\n' + leer('js/46-arrastre.js') + '\n' +
                   extraerFuncion('js/88-compras.js', '_asientosDesdeCompra') + '\n' +
                   extraerFuncion('js/93-ventas.js', '_ventasPeriodoDeDoc') + '\n' +
                   leer('js/48-consumo-teorico.js') + '\n' + leer('js/47-existencia.js');
    return new Function('deps', 'with (deps) {\n' + cuerpo + '\n; return { cargar: existenciaCargarInicial, ' +
        'estado: existenciaInicialEstado, oficial: existenciaOficial }; }')(deps);
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: leer('firestore.rules'), host: 'localhost', port: 8080 }
    });
    const sembrarUsuarios = async () => testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
        await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
        await d.doc('roles/ADMIN').set({ roleId: 'ADMIN', permissions: ['*'] });
        await d.doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count'] });
    });
    await sembrarUsuarios();
    const dbAdmin = testEnv.authenticatedContext('jefe').firestore();
    const dbBart  = testEnv.authenticatedContext('bart1').firestore();
    const intento = async (fn) => { try { await fn(); return true; } catch (e) { return false; } };
    const ancla = (db, id) => db.collection('inventarioApp').doc(DOC_ID).collection('anclasExistencia').doc(id);

    // ═══ K1 — el documento REAL del módulo pasa las reglas ═══════════════════
    const M = montarImportar();
    const prods = [{ id: 'TEQ', name: 'TEQUILA', unit: 'PZA', group: 'TEQUILA', precio: 350 },
                   { id: 'LIM', name: 'LIMON', unit: 'KGS', group: 'FRUTA', precio: 38 },
                   { id: 'FRE', name: 'FRESCA', unit: 'PZA', group: 'REFRESCOS', precio: 12 }];
    const areasDef = [{ id: 'almacen', nombre: 'Almacén' }, { id: 'barra1', nombre: 'Barra Restaurante' }, { id: 'barra2', nombre: 'Barra Bar' }];
    const exist = { TEQ: { valor: 3, origen: 'oficial' }, LIM: { valor: 2, origen: 'oficial' }, FRE: { valor: 10, origen: 'oficial' } };
    const v = M.validar([
        { 'Código': 'TEQ', 'Área': 'Almacén', Enteras: 2, Abierta: 0.5 },
        { 'Código': 'TEQ', 'Área': 'Barra Bar', Enteras: 0, Abierta: 0.25 },
        { 'Código': 'LIM', Enteras: 1.5 }
    ], prods, areasDef, (p) => exist[p.id]);
    chk('K1 · el archivo de prueba valida sin errores', v.errores.length === 0, v.errores.join(' | '));
    const corte = M.armar(v, { fecha: '2026-10-05', hora: '23:40', archivo: 'corte.xlsx', uid: 'jefe', productos: prods,
                               existenciaDe: (p) => exist[p.id], anclaAnterior: null });
    chk('K1 · id = fecha_HHmm', corte.id === '2026-10-05_2340', corte.id);
    chk('K1 · ★ el admin registra el corte que arma el módulo (las reglas lo aceptan)',
        await intento(() => ancla(dbAdmin, corte.id).set(corte.doc)));
    let guardado = null;
    await testEnv.withSecurityRulesDisabled(async (ctx) => { const s = await ctx.firestore().doc(R + '/anclasExistencia/' + corte.id).get(); guardado = s.exists ? s.data() : null; });
    chk('K1 · guarda enteras + fracción (TEQ 2.5 + 0.25 = 2.75; LIM 1.5) y FRE conserva su Total (oficial)',
        guardado && guardado.saldos.TEQ === 2.75 && guardado.saldos.LIM === 1.5 && guardado.saldos.FRE === 10, JSON.stringify(guardado && guardado.saldos));
    chk('K1 · lo previo queda como histórico (previo) y el detalle por área',
        guardado && guardado.previo.TEQ.valor === 3 && guardado.porArea && guardado.productosArrastrados.indexOf('FRE') !== -1, JSON.stringify(guardado && guardado.previo));

    // ═══ K2 — reglas ═══════════════════════════════════════════════════════
    const base = (fecha, hora) => ({ fecha, hora, tipo: 'importacion_excel', origen: { tipo: 'importacion_excel', inventoryId: 'excel:x' }, saldos: { TEQ: 1 } });
    chk('K2 · ★ un segundo corte con la MISMA fecha y hora se rechaza (no pisa al primero)',
        !(await intento(() => ancla(dbAdmin, '2026-10-05_2340').set(base('2026-10-05', '23:40')))));
    chk('K2 · id que no coincide con fecha y hora → rechazado',
        !(await intento(() => ancla(dbAdmin, '2026-10-05_2341').set(base('2026-10-05', '23:40')))));
    chk('K2 · id con otra fecha → rechazado',
        !(await intento(() => ancla(dbAdmin, '2026-10-04_2340').set(base('2026-10-05', '23:40')))));
    chk('K2 · hora inválida (24:00) → rechazado',
        !(await intento(() => ancla(dbAdmin, '2026-10-05_2400').set(base('2026-10-05', '24:00')))));
    chk('K2 · hora sin formato HH:mm (7:05) → rechazado',
        !(await intento(() => ancla(dbAdmin, '2026-10-05_0705').set(base('2026-10-05', '7:05')))));
    chk('K2 · un corte importado sin hora en el id → rechazado',
        !(await intento(() => ancla(dbAdmin, '2026-10-03').set(base('2026-10-03', '10:00')))));
    chk('K2 · tipo inválido → rechazado',
        !(await intento(() => ancla(dbAdmin, '2026-10-02_1000').set(Object.assign(base('2026-10-02', '10:00'), { tipo: 'excel' })))));
    chk('K2 · sin origen.inventoryId → rechazado',
        !(await intento(() => ancla(dbAdmin, '2026-10-02_1100').set(Object.assign(base('2026-10-02', '11:00'), { origen: {} })))));
    chk('K2 · ★ el bartender NO puede registrar un corte', !(await intento(() => ancla(dbBart, '2026-10-02_1200').set(base('2026-10-02', '12:00')))));
    chk('K2 · el bartender sí lo puede leer', await intento(() => ancla(dbBart, corte.id).get()));
    chk('K2 · ★ nadie lo actualiza', !(await intento(() => ancla(dbAdmin, corte.id).update({ saldos: { TEQ: 99 } }))));
    chk('K2 · ★ nadie lo borra', !(await intento(() => ancla(dbAdmin, corte.id).delete())));
    chk('K2 · un corte válido de otra hora sí entra', await intento(() => ancla(dbAdmin, '2026-10-02_0930').set(base('2026-10-02', '09:30'))));
    chk('K2 · los tipos de siempre siguen funcionando (mitad de semana, id = fecha)',
        await intento(() => ancla(dbAdmin, '2026-10-01').set({ fecha: '2026-10-01', tipo: 'mitad_de_semana', origen: { inventoryId: 'n' }, saldos: { TEQ: 1 } })));

    // ═══ K3 — el Total real parte del corte importado ═══════════════════════
    await testEnv.clearFirestore();
    await sembrarUsuarios();
    const hoyD = new Date();
    const dia = (n) => { const d = new Date(hoyD.getFullYear(), hoyD.getMonth(), hoyD.getDate() + n); return M.fechaISOLocal(d); };
    const fCorte = dia(-6), fViejo = dia(-15), fPost1 = dia(-5), fPost2 = dia(-1);
    const recs = [{ pv: 'PV1', ingredientes: [{ productoId: 'TEQ', cantidad: 0.06, uom: 'PZA' }, { productoId: 'LIM', cantidad: 0.02, uom: 'KGS' }] }];
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        // Un ancla más VIEJA (mitad de semana): no debe ganar.
        await d.doc(R + '/anclasExistencia/' + fViejo).set({ fecha: fViejo, tipo: 'mitad_de_semana', origen: { inventoryId: 'v' },
                                                             saldos: { TEQ: 100, LIM: 100 }, contabilizadoEn: 1 });
        await d.doc(R + '/anclasExistencia/' + fCorte + '_2340').set({ fecha: fCorte, hora: '23:40', tipo: 'importacion_excel',
            origen: { tipo: 'importacion_excel', inventoryId: 'excel:' + fCorte + '_2340' }, saldos: { TEQ: 3, LIM: 2 }, contabilizadoEn: 2000 });
        const per = (ini, lineas) => d.doc(R + '/ventas/' + ini + '_' + ini).set({ semanaId: M.semanaId(ini), fechaInicio: ini, fechaFin: ini, lineas, origen: 'excel' });
        await per(fCorte, [{ sku: 'PV1', cantidad: 100 }]);    // mismo día del corte: ya está dentro del conteo
        await per(fPost1, [{ sku: 'PV1', cantidad: 10 }]);
        await per(fPost2, [{ sku: 'PV1', cantidad: 5 }]);
        const compra = (id, f, cant) => d.doc('compras/' + id).set({ compraId: id, fecha: f, semanaId: M.semanaId(f), folio: id,
            lineas: [{ productoId: 'TEQ', cantidadInventario: cant, enCatalogo: true, costoUnitario: 300 }] });
        await compra('C-corte', fCorte, 50);                    // mismo día: no cuenta
        await compra('C-post', fPost1, 2);
    });
    const pE = [{ id: 'TEQ', name: 'TEQUILA', unit: 'PZA', operativa: 0 }, { id: 'LIM', name: 'LIMON', unit: 'KGS', operativa: 0 }];
    const cargar = async (E) => new Promise((res) => { E.cargar(res); setTimeout(res, 8000); });
    const E = montarExistencia(dbAdmin, pE, recs);
    await cargar(E);
    const est = E.estado();
    chk('K3 · ★ el Total se ancla en el corte importado (el más nuevo), no en el ancla vieja',
        est.estado === 'ok' && est.ancla && est.ancla.tipo === 'importacion_excel' && est.ancla.fecha === fCorte, JSON.stringify(est.ancla) + ' ' + est.estado);
    const teq = E.oficial(pE[0]);
    chk('K3 · ★ Total = corte + compras posteriores − consumo por recetas posterior (3 + 2 − 15×0.06 = 4.1)',
        teq.valor === 4.1 && teq.entradas === 2 && teq.ventas === 0.9 && teq.origen === 'oficial', JSON.stringify(teq));
    chk('K3 · lo vendido y comprado el día del corte NO se vuelve a contar (LIM: 2 − 15×0.02 = 1.7)', E.oficial(pE[1]).valor === 1.7, JSON.stringify(E.oficial(pE[1])));

    // ═══ K4 — empate el mismo día: gana el registrado después ═══════════════
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc(R + '/anclasExistencia/' + fCorte).set({ fecha: fCorte, tipo: 'mitad_de_semana', origen: { inventoryId: 'r' },
                                                                           saldos: { TEQ: 50, LIM: 50 }, contabilizadoEn: 1000 });
    });
    const E2 = montarExistencia(dbAdmin, pE, recs);
    await cargar(E2);
    chk('K4 · ★ mismo día: el corte importado registrado DESPUÉS gana al recuento',
        E2.estado().ancla && E2.estado().ancla.tipo === 'importacion_excel' && E2.oficial(pE[0]).valor === 4.1, JSON.stringify(E2.estado().ancla));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc(R + '/anclasExistencia/' + fCorte).set({ fecha: fCorte, tipo: 'mitad_de_semana', origen: { inventoryId: 'r' },
                                                                           saldos: { TEQ: 50, LIM: 50 }, contabilizadoEn: 3000 });
    });
    const E3 = montarExistencia(dbAdmin, pE, recs);
    await cargar(E3);
    chk('K4 · ★ y si el recuento se registró después, gana el recuento (50 + 2 − 0.9 = 51.1)',
        E3.estado().ancla && E3.estado().ancla.tipo === 'mitad_de_semana' && E3.oficial(pE[0]).valor === 51.1, JSON.stringify([E3.estado().ancla, E3.oficial(pE[0]).valor]));

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones de integración · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
