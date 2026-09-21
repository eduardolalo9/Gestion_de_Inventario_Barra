/**
 * prueba-reconteo-integracion.js — RECONTEO contra Firestore REAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Ejecuta el código REAL de la app contra el emulador con firestore.rules
 * aplicadas: js/87-reconteo.js y js/40-firestore.js montados completos (la
 * corrección viaja por syncMyAuditoriaToFirestore, la sincronización de
 * siempre), y la consolidación real _recalcAdminAggregatedConteo extraída de
 * js/45-inventario-datos.js para comprobar el efecto final: que el valor
 * oficial del inventario cambia.
 *
 *   I1  Iniciar reconteo crea un registro abierto (sin subir nada aún).
 *   I2  Agregar productos sube el borrador; el cierre lo ve como abierto.
 *   I3  ★ Anotar una corrección NO toca el conteo antes de finalizar.
 *   I4  ★ Finalizar escribe la corrección en userAuditoria del admin.
 *   I5  ★ La consolidación real pasa a dar el valor corregido (0.85 → 0.5)
 *       por encima del bartender: "se actualiza automáticamente".
 *   I6  El registro queda finalizado con fecha, quién recontó y antes→después.
 *   I7  Ya no bloquea el cierre.
 *   I8  Reabrir: ronda 2, la corrección anterior pasa al historial.
 *   I9  Segunda ronda: corregir otra vez y finalizar deja ronda 2 en el registro.
 *   I10 Sin conexión, finalizar no aplica nada.
 *   I11 ★ Con el inventario CERRADO, finalizar se niega y el servidor rechaza
 *       el registro (queda congelado).
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-reconteo-integracion.js"
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const compat = require('firebase/compat/app');
require('firebase/compat/firestore');
const fb = compat.default || compat;
const fs   = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const PROJECT_ID = 'demo-barinventory';
const DOC_ID = 'barra-principal';
const R = 'inventarioApp/' + DOC_ID;

let fallos = 0, total = 0;
function chk(nombre, ok, detalle) {
    total++;
    if (ok) console.log('  ✅ ' + nombre);
    else { fallos++; console.error('  ❌ ' + nombre + (detalle ? '  ← ' + detalle : '')); }
}
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

function extraerFuncion(fuente, nombre) {
    const i = fuente.indexOf('function ' + nombre + '(');
    if (i === -1) throw new Error('No se encontró ' + nombre);
    let nivel = 0, dentro = false;
    for (let j = i; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(i, j + 1); }
    }
    throw new Error('No se pudo delimitar ' + nombre);
}

function montar(db, uid) {
    const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
    const conv = leer('js/70-conversion-render.js');
    const idb  = leer('js/30-indexeddb.js');
    const datos = leer('js/45-inventario-datos.js');
    const avisos = [];
    const deps = {
        navigator: { onLine: true }, _db: db, FIRESTORE_DOC_ID: DOC_ID, currentUserUid: uid,
        _deviceId: 'disp-' + uid, AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
        areasAuditoria: { almacen: 'Almacén', barra1: 'Barra 1', barra2: 'Barra 2' },
        areas: { almacen: 'Almacén', barra1: 'Barra 1', barra2: 'Barra 2' },
        products: [
            { id: 'P1', name: 'GOLOS', unit: 'KGS', group: 'Botanas' },
            { id: 'P2', name: 'RON X', unit: 'PZA', group: 'Ron', capacidadMl: 750, pesoBotellaLlenaOz: 35, conteoOzHabilitado: true }
        ],
        myAuditoriaConteo: {}, myAuditoriaStatus: {}, myAuditoriaFinalizadas: {},
        auditoriaConteo: {}, allUsersAuditoria: {}, inventarioConteo: {},
        _auditoriaSessionId: 'inv-1', _inventarioActivo: { estado: 'SINCRONIZADO', numero: 101 },
        auditoriaView: 'selection', auditCurrentUser: { userName: 'Eduardo' },
        isAdmin: () => true, hasPermission: () => true,
        showNotification: (t) => avisos.push(String(t)), showConfirm: (m, cb) => cb(),
        renderTab() {}, saveToLocalStorage() {}, updateCloudSyncBadge() {}, renderAuditoriaSeleccion: () => '',
        _registrarEnSyncQueue() {}, _registrarConflictos() {}, escapeHtml: (s) => String(s),
        resaltarBusqueda: (s) => String(s), openInventarioModal() {},
        BusquedaUI: { registrar() {}, limpiar() {}, refrescar() {}, barra: () => '', region: () => '', vacio: () => '' },
        _motorProductos: { buscar: () => ({ items: [] }), indexar() {} },
        firebase: fb, _auth: { currentUser: { uid: uid, email: uid + '@barra.mx' } },
        localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
        console: { warn() {}, error() {}, info() {}, log() {} },
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
                    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, remove() {} }),
                    body: { appendChild() {}, removeChild() {} }, addEventListener() {} },
        requestAnimationFrame: (f) => f(), setTimeout: setTimeout, clearTimeout: clearTimeout
    };
    deps.window = deps;
    const codigo =
        extraerFuncion(conv, 'convertirOzAPuntos') + '\n' +
        extraerFuncion(conv, 'tieneDatosConversion') + '\n' +
        extraerFuncion(conv, 'tieneConversion') + '\n' +
        extraerFuncion(idb, '_contarEntradasConteo') + '\n' +
        extraerFuncion(datos, '_recalcAdminAggregatedConteo') + '\n' +
        leer('js/40-firestore.js') + '\n' + leer('js/87-reconteo.js') + '\n' +
        '; return { reconteoIniciar, reconteoAgregarProducto, _rcAplicarEdicion, _rcFinalizarConfirmado, reconteoFinalizar,' +
        ' reconteoVerDetalle, reconteoReabrir, _hayReconteoAbierto, _recalcAdminAggregatedConteo,' +
        ' activo: function() { return _reconteoActivo; }, pendiente: function() { return _auditSyncPending; } };';
    const api = new Function('deps', 'with (deps) {\n' + codigo + '\n}')(deps);
    api.deps = deps; api.avisos = avisos;
    return api;
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8'), host: 'localhost', port: 8080 }
    });
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
        await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
        await d.doc(R + '/inventories/inv-1').set({ inventoryId: 'inv-1', numero: 101, estado: 'SINCRONIZADO', fechaCreacion: 1 });
        // Lo que contó el bartender: 0.85 kg de golos en almacén
        await d.doc(R + '/userAuditoria/bart1').set({ uid: 'bart1', sessionId: 'inv-1', isAdmin: false, updatedAt: 1000,
            status: {}, conteo: { P1: { almacen: { enteras: 0.85, abiertas: [], _ts: 1000 } } } });
    });
    const dbJefe = testEnv.authenticatedContext('jefe').firestore();
    const app = montar(dbJefe, 'jefe');
    const D = app.deps;

    async function consolidar() {
        let usuarios = {};
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().collection(R + '/userAuditoria').get();
            s.forEach(doc => { const x = doc.data(); usuarios[doc.id] = { email: doc.id, isAdmin: !!x.isAdmin, updatedAt: x.updatedAt, conteo: x.conteo || {} }; });
        });
        D.allUsersAuditoria = usuarios;
        app._recalcAdminAggregatedConteo();
        return D.auditoriaConteo;
    }
    async function leerRc(id) {
        let d = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/reconteos/' + id).get();
            d = s.exists ? s.data() : null;
        });
        return d;
    }

    console.log('\n  ── RECONTEO · código real contra Firestore real ──\n');
    await consolidar();   // el admin ve 0.85 como valor oficial

    await app.reconteoIniciar();
    const rc = app.activo();
    chk('I1  Iniciar crea un reconteo abierto para el inventario activo',
        rc && rc.estado === 'abierto' && rc.inventoryId === 'inv-1' && D.auditoriaView === 'reconteo' && rc.recontadoPor === 'Eduardo');

    app.reconteoAgregarProducto('P1');
    app.reconteoAgregarProducto('P2');
    await esperar(1800);
    const subido = await leerRc(rc.id);
    chk('I2  Agregar productos sube el borrador y el cierre lo ve abierto',
        subido && subido.estado === 'abierto' && subido.orden.length === 2 && await app._hayReconteoAbierto('inv-1'),
        JSON.stringify(subido && subido.orden));

    app._rcAplicarEdicion('P1', 'almacen', 0.5, []);
    chk('I3  ★ Anotar una corrección NO toca el conteo antes de finalizar',
        !D.myAuditoriaConteo.P1 && app.activo().items.P1.areas.almacen.despues.enteras === 0.5 &&
        app.activo().items.P1.areas.almacen.antes.enteras === 0.85);

    await app._rcFinalizarConfirmado();
    let docJefe = null;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const s = await ctx.firestore().doc(R + '/userAuditoria/jefe').get();
        docJefe = s.exists ? s.data() : null;
    });
    chk('I4  ★ Finalizar escribe la corrección en el conteo del admin (userAuditoria)',
        docJefe && docJefe.conteo.P1.almacen.enteras === 0.5 && docJefe.conteo.P1.almacen._reconteoId === rc.id && !app.pendiente(),
        JSON.stringify(docJefe && docJefe.conteo));

    const oficial = await consolidar();
    chk('I5  ★ La consolidación real da el valor corregido (0.85 → 0.5) por encima del bartender',
        oficial.P1.almacen.enteras === 0.5, JSON.stringify(oficial.P1));

    const fin = await leerRc(rc.id);
    const a = fin && fin.items.P1.areas.almacen;
    chk('I6  El registro queda finalizado con fecha, quién recontó y antes → después',
        fin && fin.estado === 'finalizado' && typeof fin.finalizadoEn === 'number' && fin.finalizadoPorUid === 'jefe' &&
        fin.recontadoPor === 'Eduardo' && fin.rondas.length === 1 && fin.rondas[0].correcciones === 1 &&
        a.antes.enteras === 0.85 && a.despues.enteras === 0.5 && fin.items.P2.areas.barra1.despues === null,
        JSON.stringify(fin && fin.rondas));

    chk('I7  Un reconteo finalizado ya no bloquea el cierre', !(await app._hayReconteoAbierto('inv-1')) && app.activo() === null);

    await app.reconteoVerDetalle(rc.id);
    await esperar(200);
    await app.reconteoReabrir(rc.id);
    const re = await leerRc(rc.id);
    chk('I8  Reabrir: ronda 2 abierta y la corrección anterior pasa al historial',
        re && re.estado === 'abierto' && re.ronda === 2 && re.items.P1.areas.almacen.despues === null &&
        re.items.P1.areas.almacen.historial.length === 1 && re.items.P1.areas.almacen.historial[0].despues.enteras === 0.5 &&
        await app._hayReconteoAbierto('inv-1'), JSON.stringify(re && re.items.P1));

    await consolidar();
    app._rcAplicarEdicion('P1', 'almacen', 0.62, []);
    await app._rcFinalizarConfirmado();
    const r2 = await leerRc(rc.id);
    const ofi2 = await consolidar();
    chk('I9  Segunda ronda: 0.5 → 0.62 aplicado y registrado como ronda 2',
        r2.estado === 'finalizado' && r2.rondas.length === 2 && r2.rondas[1].ronda === 2 &&
        r2.items.P1.areas.almacen.antes.enteras === 0.5 && r2.items.P1.areas.almacen.despues.enteras === 0.62 &&
        ofi2.P1.almacen.enteras === 0.62, JSON.stringify(r2 && r2.rondas));

    // I10 — sin conexión
    await app.reconteoIniciar();
    app.reconteoAgregarProducto('P1');
    app._rcAplicarEdicion('P1', 'barra1', 3, []);
    D.navigator.onLine = false;
    const antesOffline = JSON.stringify(D.myAuditoriaConteo);
    app.reconteoFinalizar();
    await esperar(100);
    chk('I10 Sin conexión, finalizar no aplica nada y sigue abierto',
        JSON.stringify(D.myAuditoriaConteo) === antesOffline && app.activo().estado === 'abierto' &&
        app.avisos.some(t => /Sin conexión/.test(t)));
    D.navigator.onLine = true;
    await esperar(1500);

    // I11 — inventario cerrado
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc(R + '/inventories/inv-1').update({ estado: 'CERRADO' });
    });
    D._inventarioActivo = { estado: 'CERRADO', numero: 101 };
    const antesCerrado = JSON.stringify(D.myAuditoriaConteo);
    app.reconteoFinalizar();
    let rechazado = false;
    try {
        await dbJefe.doc(R + '/reconteos/' + app.activo().id).set({ estado: 'abierto' }, { merge: true });
    } catch (e) { rechazado = /permission/i.test(String(e.code || e.message)); }
    chk('I11 ★ Inventario CERRADO: finalizar se niega y el servidor congela el registro',
        JSON.stringify(D.myAuditoriaConteo) === antesCerrado && rechazado &&
        app.avisos.some(t => /ya no está abierto/.test(t)));

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones de integración · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
