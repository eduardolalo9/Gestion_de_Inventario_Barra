/**
 * prueba-v536-corte-eliminar-integracion.js — v5.36 · Eliminar el último corte
 * importado, contra Firestore REAL (emulador + firestore.rules byte a byte).
 * ═══════════════════════════════════════════════════════════════════════════
 *   E1  Un corte IMPORTADO se puede borrar con inventory.post (el admin).
 *   E2  El bartender (sin inventory.post) NO lo borra.
 *   E3  Un corte contabilizado (mitad de semana / fin de mes) NO se puede
 *       borrar, ni siquiera el admin con permiso total.
 *   E4  Los cortes NUNCA se actualizan (ni los importados).
 *   E5  La papelera acepta origen 'corte' con inventory.post y la rechaza al bartender.
 *   E6  El batch de la app (copia en papelera + borrado) funciona completo, y
 *       si la copia en papelera es inválida el batch ENTERO falla y el corte
 *       sigue ahí (cero pérdida de datos).
 *   E7  Restaurar: el corte se vuelve a crear idéntico desde la papelera.
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-v536-corte-eliminar-integracion.js"
 * Necesita el emulador de Firestore (descarga su .jar la primera vez).
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const PROJECT_ID = 'demo-barinventory', DOC_ID = 'barra-principal';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
let fallos = 0, total = 0;
function chk(n, ok, d) { total++; if (ok) console.log('  ✅ ' + n); else { fallos++; console.error('  ❌ ' + n + (d ? '  ← ' + d : '')); } }

// Funciones REALES de la app (sin DOM): registro de papelera y elección del último corte.
const reg = (() => {
    const deps = { window: {}, console: { warn() {}, info() {}, log() {}, error() {} }, document: { getElementById: () => null, addEventListener() {} } };
    const f = (rel, nombre) => { const s = leer(rel); const i = s.indexOf('function ' + nombre + '('); let n = 0, d = false;
        for (let j = i; j < s.length; j++) { if (s[j] === '{') { n++; d = true; } else if (s[j] === '}') { n--; if (d && n === 0) return s.slice(i, j + 1); } } };
    return new Function('deps', 'with (deps) {\n' + require('./_precio-producto') + '\n' +   /* v5.47: precio vigente */  f('js/53-papelera.js', 'papeleraRegistroCorte') + '\n' + f('js/96-importar.js', 'importarElegirUltimoCorte') +
        '\n; return { registro: papeleraRegistroCorte, elegir: importarElegirUltimoCorte }; }')(deps);
})();

async function main() {
    const testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: leer('firestore.rules'), host: 'localhost', port: 8080 } });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
        await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
        await d.doc('roles/ADMIN').set({ roleId: 'ADMIN', permissions: ['*'] });
        await d.doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count'] });
    });
    const dbAdmin = testEnv.authenticatedContext('jefe').firestore();
    const dbBart = testEnv.authenticatedContext('bart1').firestore();
    const intento = async (fn) => { try { await fn(); return true; } catch (e) { return false; } };
    const base = (db) => db.collection('inventarioApp').doc(DOC_ID);
    const ancla = (db, id) => base(db).collection('anclasExistencia').doc(id);
    const papel = (db, id) => base(db).collection('papelera').doc(id);
    const existe = async (id) => { let ok = false; await testEnv.withSecurityRulesDisabled(async (c) => { ok = (await c.firestore().doc('inventarioApp/' + DOC_ID + '/anclasExistencia/' + id).get()).exists; }); return ok; };
    const docImp = (fecha, hora) => ({ fecha, hora, tipo: 'importacion_excel', origen: { tipo: 'importacion_excel', inventoryId: 'excel:' + fecha + '_' + hora.replace(':', ''), archivo: 'corte.xlsx' },
                                       saldos: { TEQ: 3 }, totalProductos: 1, productosContados: 1, contabilizadoEn: Date.now() });

    await intento(() => ancla(dbAdmin, '2026-10-05_2340').set(docImp('2026-10-05', '23:40')));
    await intento(() => ancla(dbAdmin, '2026-10-06_1000').set(docImp('2026-10-06', '10:00')));
    await intento(() => ancla(dbAdmin, '2026-10-04').set({ fecha: '2026-10-04', tipo: 'mitad_de_semana', origen: { inventoryId: 'n' }, saldos: { TEQ: 1 } }));

    chk('E2 · ★ el bartender NO borra un corte importado', !(await intento(() => ancla(dbBart, '2026-10-06_1000').delete())) && await existe('2026-10-06_1000'));
    chk('E3 · ★ un corte contabilizado (mitad de semana) NO se borra, ni el admin', !(await intento(() => ancla(dbAdmin, '2026-10-04').delete())) && await existe('2026-10-04'));
    chk('E4 · ★ nadie actualiza un corte (ni el importado)', !(await intento(() => ancla(dbAdmin, '2026-10-06_1000').update({ saldos: { TEQ: 99 } }))));
    chk('E5 · la papelera acepta origen "corte" con inventory.post', await intento(() => papel(dbAdmin, 'corte_prueba').set(reg.registro('2026-10-05_2340', docImp('2026-10-05', '23:40'), { uidActor: 'jefe' }).data)));
    chk('E5 · ★ el bartender no escribe en la papelera un registro "corte"', !(await intento(() => papel(dbBart, 'corte_bart').set(reg.registro('2026-10-05_2340', docImp('2026-10-05', '23:40'), { uidActor: 'bart1' }).data))));

    // E6 — el batch de la app
    const elegido = reg.elegir([{ id: '2026-10-05_2340', data: docImp('2026-10-05', '23:40') }, { id: '2026-10-06_1000', data: docImp('2026-10-06', '10:00') }, { id: '2026-10-04', data: { fecha: '2026-10-04', tipo: 'mitad_de_semana' } }]);
    chk('E6 · el último corte IMPORTADO es el más reciente por fecha y hora (ignora los contabilizados)', elegido && elegido.id === '2026-10-06_1000');
    const r = reg.registro(elegido.id, elegido.data, { uidActor: 'jefe' });
    const malo = Object.assign({}, r.data, { borradoPor: 'otra-persona' });   // la regla de la papelera lo rechaza
    const b1 = base(dbAdmin).firestore.batch();
    b1.set(papel(dbAdmin, r.id + '_mal'), malo); b1.delete(ancla(dbAdmin, elegido.id));
    chk('E6 · ★ si la copia en papelera es inválida, el batch ENTERO falla y el corte sigue ahí', !(await intento(() => b1.commit())) && await existe(elegido.id));
    const b2 = base(dbAdmin).firestore.batch();
    b2.set(papel(dbAdmin, r.id), r.data); b2.delete(ancla(dbAdmin, elegido.id));
    chk('E1 · ★ copia en papelera + borrado en el mismo batch: el admin elimina el último corte importado', await intento(() => b2.commit()));
    chk('E1 · el corte ya no existe y la copia está en la papelera', !(await existe(elegido.id)) && (await intento(() => papel(dbAdmin, r.id).get())));
    chk('E1 · el corte anterior y el contabilizado siguen intactos', await existe('2026-10-05_2340') && await existe('2026-10-04'));

    // E7 — restaurar
    const copia = (await papel(dbAdmin, r.id).get()).data();
    chk('E7 · ★ restaurar: el corte se vuelve a crear idéntico desde la papelera', await intento(() => ancla(dbAdmin, elegido.id).set(copia.contenido)) && await existe(elegido.id));

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones de integración · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos === 0 ? 0 : 1);
}
main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
