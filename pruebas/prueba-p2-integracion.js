/**
 * prueba-p2-integracion.js — COMPRAS de punta a punta contra Firestore REAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Esto NO es una simulación. Se montan los archivos js/88-compras.js y
 * js/40-firestore.js tal como se publican, se les inyecta el emulador oficial
 * de Firestore con firestore.rules aplicadas byte a byte, y se llama a
 * guardarCompra() exactamente como la llama la pantalla de importación.
 *
 * Cubre el hueco que el informe de cierre de FASE 4 dejó señalado: hasta
 * ahora, compras estaba probada a nivel de REGLAS (run-rules-tests.js, C1-C14)
 * y de RENDER (prueba-p1.js), pero el camino cliente→batch→Firestore nunca se
 * había ejecutado de verdad.
 *
 * Lo que se demuestra con ejecución, no con lectura de código:
 *
 *   I1   Una compra con permiso se escribe, con su documento y sus asientos.
 *   I2   ★ Guardar el mismo Doc SAP dos veces no duplica nada.
 *   I3   ★ Una compra que YA estaba en el servidor se detecta antes de escribir.
 *   I4   Sin purchases.create no queda absolutamente nada escrito.
 *   I5   Una línea fuera de catálogo entra en la compra pero NO genera asiento.
 *   I6   El id del asiento es determinista y está en Firestore con ese id.
 *   I7   ★ El batch es todo-o-nada: un asiento inválido no deja la compra escrita.
 *   I8   cargarComprasDeLaSemana() trae una semana, no la colección entera.
 *   I9   cargarComprasIniciales() trae semana en curso + anterior, sin duplicar.
 *   I10  Sin conexión no se escribe ni se avanza el estado local.
 *   I11  costos/ultimos se escribe con merge: una importación no pisa la otra.
 *   I12  El folio manual es transaccional: dos llamadas, dos números distintos.
 *   I13  El evento de auditoría distingue importada de manual.
 *   I14  Las líneas guardadas son las que se enviaron, campo a campo.
 *   I15  ★ El Excel real (folio 3646 / Doc SAP 27615) parseado Y guardado.
 *
 * ── CÓMO EJECUTAR ──
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-p2-integracion.js"
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const compat = require('firebase/compat/app');
require('firebase/compat/firestore');
const fb = compat.default || compat;

const fs   = require('fs');
const path = require('path');

const RAIZ       = path.resolve(__dirname, '..');
const PROJECT_ID = 'demo-barinventory';
const DOC_ID     = 'barra-principal';

let fallos = 0, total = 0;
function chk(nombre, ok, detalle) {
    total++;
    if (ok) { console.log('  ✅ ' + nombre); }
    else    { fallos++; console.error('  ❌ ' + nombre + (detalle ? '  ← ' + detalle : '')); }
}

// Catálogo mínimo, con códigos REALES del Excel de SAP que analizamos: así la
// correspondencia código→producto no es una invención de la prueba.
const CATALOGO = [
    { id: '1180015', name: 'DON JULIO 70 700 ML', unit: 'PZA', precio: 620.00 },
    { id: '1060023', name: 'SANGRITA VIUDA DE SANCHEZ', unit: 'PZA', precio: 75.00 },
    { id: '1150008', name: 'AGUA MINERAL 330 ML PERRIER', unit: 'PZA', precio: 22.50 }
];

/**
 * Monta los archivos REALES de compras con un Firestore de verdad.
 * Igual que en prueba-f3-integracion.js se usa new Function + with en vez de
 * vm.createContext: un contexto de vm tiene sus propios intrínsecos y el SDK
 * de Firestore rechaza los objetos que se construyan dentro.
 */
function montarCompras(db, uid, opciones) {
    opciones = opciones || {};
    const avisos = [];

    const ciclo   = fs.readFileSync(path.join(RAIZ, 'js/15-ciclo-semanal.js'), 'utf8');
    const firest  = fs.readFileSync(path.join(RAIZ, 'js/40-firestore.js'), 'utf8');
    const compras = fs.readFileSync(path.join(RAIZ, 'js/88-compras.js'), 'utf8');

    const deps = {
        navigator: { onLine: opciones.onLine !== false },
        _db: db,
        FIRESTORE_DOC_ID: DOC_ID,
        currentUserUid: uid,
        _deviceId: 'disp-' + uid,
        products: (opciones.products || CATALOGO).map(p => Object.assign({}, p)),
        // El estado que js/00-nucleo.js declara en la app real.
        compras: [],
        movimientos: [],
        costosUltimos: {},
        comprasImportView: 'lista',
        _comprasImportPendiente: null,
        _comprasImportResultado: null,
        activeTab: 'compras',
        auditCurrentUser: { userId: uid, userName: uid },
        // El permiso se resuelve como en la app: solo lo que la prueba conceda.
        hasPermission: (p) => (opciones.permisos || []).indexOf(p) !== -1,
        showNotification: (t) => avisos.push(String(t)),
        renderTab() {}, saveToLocalStorage() { deps._guardadosLocales++; },
        updateCloudSyncBadge() {},
        _crearBackupNombrado() {},
        _registrarEnSyncQueue(e) { deps._eventos.push(e); return e; },
        escapeHtml: (s) => String(s),
        firebase: fb, _auth: { currentUser: { uid: uid, email: uid + '@local' } },
        localStorage: {
            _d: {}, getItem(k) { return this._d[k] || null; },
            setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
        },
        console: { warn() {}, error() {}, info() {}, log() {} },
        document: {
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} },
                                    appendChild() {}, setAttribute() {}, remove() {} }),
            body: { appendChild() {}, removeChild() {} },
            addEventListener() {}
        },
        requestAnimationFrame: (f) => f(),
        setTimeout: (f) => { try { f(); } catch (_) {} return 0; },
        clearTimeout() {},
        _eventos: [],
        _guardadosLocales: 0
    };
    deps.window = deps;

    const montar = new Function('deps', 'with (deps) {\n' + ciclo + '\n' + firest + '\n' + compras +
        '\n; return { guardarCompra: guardarCompra,' +
        '            _compraId: _compraId,' +
        '            _asientosDesdeCompra: _asientosDesdeCompra,' +
        '            _verificarCompraExistente: _verificarCompraExistente,' +
        '            _parsearExcelCompras: _parsearExcelCompras,' +
        '            _normalizarLineaCompra: _normalizarLineaCompra,' +
        '            _parsearCodigoNombre: _parsearCodigoNombre,' +
        '            _diferenciasDeCosto: _diferenciasDeCosto,' +
        '            cargarComprasDeLaSemana: cargarComprasDeLaSemana,' +
        '            cargarComprasIniciales: cargarComprasIniciales,' +
        '            _obtenerSiguienteFolioCompra: _obtenerSiguienteFolioCompra,' +
        '            _actualizarUltimosCostos: _actualizarUltimosCostos,' +
        '            semanaId: semanaId }; }');

    let api;
    try { api = montar(deps); }
    catch (e) { throw new Error('No se pudo montar el módulo de compras: ' + e.message); }

    api._avisos = avisos;
    api._eventos = deps._eventos;
    api._deps = deps;
    return api;
}

// Una compra completa y válida, con la forma que produce la importación.
function compraDemo(over) {
    return Object.assign({
        compraId: 'sap-27615',
        folio: '3646',
        docSap: '27615',
        fecha: '2026-09-16',          // miércoles → semana del lunes 2026-09-14
        semanaId: '2026-09-14',
        proveedorCodigo: 'P00106',
        proveedorNombre: 'VINOTECA MEXICO',
        importe: 1322.66,
        totalLineas: 2,
        origen: 'excel',
        creadoPor: 'comprador',
        creadoEn: Date.now(),
        lineas: [
            { productoId: '1180015', descripcionSap: 'DON JULIO 70 700 ML', cantidadDocumento: 2,
              unidadDocumento: 'PZA', factorConversion: 1, cantidadInventario: 2,
              costoUnitario: 661.33, importe: 1322.66, enCatalogo: true },
            { productoId: '1060023', descripcionSap: 'SANGRITA VIUDA DE SANCHEZ', cantidadDocumento: 2,
              unidadDocumento: 'PZA', factorConversion: 1, cantidadInventario: 2,
              costoUnitario: 75.565, importe: 151.13, enCatalogo: true }
        ]
    }, over || {});
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8'),
            host: 'localhost', port: 8080
        }
    });

    // ── Siembra: un comprador con los tres permisos y un bartender sin ninguno.
    async function sembrar() {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            await d.doc('roles/ADMIN').set({ roleId: 'ADMIN', permissions: ['*'] });
            await d.doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count'] });
            await d.doc('usuarios/comprador').set({
                uid: 'comprador', role: 'BARTENDER', status: 'activo',
                permissionOverrides: {
                    'purchases.read': 'allow', 'purchases.create': 'allow', 'purchases.import': 'allow'
                }
            });
            await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
        });
    }

    // OJO: withSecurityRulesDisabled() devuelve Promise<void> — NO propaga lo
    // que retorne su callback. El valor se recoge en una variable de cierre,
    // igual que en prueba-f3-integracion.js. Devolverlo directamente hace que
    // toda comprobación que lo use compare contra undefined y falle en falso.
    async function leerCompra(id) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc('compras/' + id).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function contarCompras() {
        let n = 0;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().collection('compras').get();
            n = s.size;
        });
        return n;
    }
    async function contarMovimientos() {
        let n = 0;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().collection('movimientos').get();
            n = s.size;
        });
        return n;
    }
    async function leerMovimiento(id) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc('movimientos/' + id).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function leerCostos() {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc('costos/ultimos').get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }

    const dbComprador = testEnv.authenticatedContext('comprador').firestore();
    const dbBart      = testEnv.authenticatedContext('bart1').firestore();
    const PERMISOS    = ['purchases.read', 'purchases.create', 'purchases.import'];

    // ═══════════════════════════════════════════════════════════════════
    //  I1 · La compra se escribe, con su documento y sus asientos
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    let app = montarCompras(dbComprador, 'comprador', { permisos: PERMISOS });
    let res = await app.guardarCompra(compraDemo());
    chk('I1 · guardarCompra() devuelve ok/creada',
        res.ok === true && res.motivo === 'creada', JSON.stringify(res));
    const c1 = await leerCompra('sap-27615');
    chk('I1 · el documento de compra existe en Firestore',
        !!c1 && c1.docSap === '27615' && c1.proveedorNombre === 'VINOTECA MEXICO',
        JSON.stringify(c1 && { docSap: c1.docSap, prov: c1.proveedorNombre }));
    chk('I1 · se escribió un asiento por cada línea en catálogo',
        (await contarMovimientos()) === 2, 'movimientos=' + (await contarMovimientos()));
    chk('I1 · el estado local refleja la compra SOLO después de confirmar',
        app._deps.compras.length === 1 && app._deps.movimientos.length === 2,
        'compras=' + app._deps.compras.length + ' movimientos=' + app._deps.movimientos.length);

    // ═══════════════════════════════════════════════════════════════════
    //  I2 · ★ Idempotencia: el mismo Doc SAP dos veces no duplica
    // ═══════════════════════════════════════════════════════════════════
    const res2 = await app.guardarCompra(compraDemo());
    chk('I2 · ★ el segundo intento se reporta como "ya_existia", no como error',
        res2.ok === true && res2.motivo === 'ya_existia', JSON.stringify(res2));
    chk('I2 · ★ y Firestore sigue teniendo UNA sola compra',
        (await contarCompras()) === 1 && (await contarMovimientos()) === 2,
        'compras=' + (await contarCompras()) + ' movimientos=' + (await contarMovimientos()));
    chk('I2 · el estado local tampoco se duplicó',
        app._deps.compras.length === 1 && app._deps.movimientos.length === 2,
        'compras=' + app._deps.compras.length);

    // ═══════════════════════════════════════════════════════════════════
    //  I3 · ★ Una compra que ya estaba en el servidor se detecta antes de escribir
    //  (el caso real: otro dispositivo la importó primero)
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc('compras/sap-27615').set(compraDemo({ creadoPor: 'otro-dispositivo' }));
    });
    const appOtro = montarCompras(dbComprador, 'comprador', { permisos: PERMISOS });
    const res3 = await appOtro.guardarCompra(compraDemo());
    chk('I3 · ★ se detecta lo ya escrito por otro dispositivo, sin intentar sobrescribir',
        res3.ok === true && res3.motivo === 'ya_existia', JSON.stringify(res3));
    const c3 = await leerCompra('sap-27615');
    chk('I3 · ★ y el documento conserva su autor original (no se pisó)',
        !!c3 && c3.creadoPor === 'otro-dispositivo', c3 && c3.creadoPor);
    chk('I3 · el dispositivo que llegó tarde igual se queda con la compra en local',
        appOtro._deps.compras.length === 1, 'compras=' + appOtro._deps.compras.length);

    // ═══════════════════════════════════════════════════════════════════
    //  I4 · Sin purchases.create no queda nada escrito
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    const appSinPermiso = montarCompras(dbBart, 'bart1', { permisos: ['inventory.count'] });
    const res4 = await appSinPermiso.guardarCompra(compraDemo());
    chk('I4 · el cliente rechaza la operación por falta de permiso',
        res4.ok === false && res4.motivo === 'sin_permiso', JSON.stringify(res4));
    chk('I4 · y Firestore sigue vacío',
        (await contarCompras()) === 0 && (await contarMovimientos()) === 0);

    // I4b · Aunque el cliente CREA tener el permiso, el servidor manda.
    await sembrar();
    const appMiente = montarCompras(dbBart, 'bart1', { permisos: PERMISOS });
    const res4b = await appMiente.guardarCompra(compraDemo());
    chk('I4b · ★ un cliente manipulado no escribe: el servidor lo rechaza',
        res4b.ok === false && (await contarCompras()) === 0 && (await contarMovimientos()) === 0,
        JSON.stringify(res4b));
    chk('I4b · y el estado local no avanzó',
        appMiente._deps.compras.length === 0, 'compras=' + appMiente._deps.compras.length);

    // ═══════════════════════════════════════════════════════════════════
    //  I5 · Una línea fuera de catálogo entra en la compra, no en el libro
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    const appFuera = montarCompras(dbComprador, 'comprador', { permisos: PERMISOS });
    const conHuerfana = compraDemo({
        compraId: 'sap-30001', docSap: '30001', folio: '4001', totalLineas: 3,
        lineas: compraDemo().lineas.concat([{
            productoId: '9999999', descripcionSap: 'PRODUCTO QUE NO ESTA EN EL CATALOGO',
            cantidadDocumento: 5, unidadDocumento: 'PZA', factorConversion: 1,
            cantidadInventario: 5, costoUnitario: 10, importe: 50, enCatalogo: false
        }])
    });
    await appFuera.guardarCompra(conHuerfana);
    const c5 = await leerCompra('sap-30001');
    chk('I5 · la compra conserva las TRES líneas (el hecho no se altera)',
        !!c5 && c5.lineas.length === 3, c5 && ('lineas=' + c5.lineas.length));
    chk('I5 · ★ pero solo se generaron DOS asientos (el producto huérfano no suma stock)',
        (await contarMovimientos()) === 2, 'movimientos=' + (await contarMovimientos()));
    chk('I5 · no existe asiento para el producto fuera de catálogo',
        (await leerMovimiento('compra_sap-30001_9999999')) === null);

    // ═══════════════════════════════════════════════════════════════════
    //  I6 · El id del asiento es determinista
    // ═══════════════════════════════════════════════════════════════════
    const mov = await leerMovimiento('compra_sap-30001_1180015');
    chk('I6 · el asiento vive en compra_{compraId}_{productoId}', !!mov);
    chk('I6 · y apunta a su compra de origen',
        !!mov && mov.origen && mov.origen.compraId === 'sap-30001' &&
        mov.tipo === 'compra' && mov.cantidad === 2,
        JSON.stringify(mov && { tipo: mov.tipo, cant: mov.cantidad, orig: mov.origen }));
    chk('I6 · el asiento hereda la semana de la compra, no la fecha de hoy',
        !!mov && mov.semanaId === '2026-09-14', mov && mov.semanaId);

    // ═══════════════════════════════════════════════════════════════════
    //  I7 · ★ El batch es todo-o-nada
    //  Un asiento que las reglas rechazan (cantidad no numérica) tiene que
    //  tumbar TAMBIÉN el documento de compra: nada a medias.
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    const appAtomico = montarCompras(dbComprador, 'comprador', { permisos: PERMISOS });
    const rota = compraDemo({
        compraId: 'sap-40001', docSap: '40001', folio: '5001',
        lineas: [
            { productoId: '1180015', cantidadDocumento: 1, unidadDocumento: 'PZA',
              factorConversion: 1, cantidadInventario: 'dos', // ← las reglas exigen number
              costoUnitario: 661.33, importe: 661.33, enCatalogo: true }
        ]
    });
    const res7 = await appAtomico.guardarCompra(rota);
    chk('I7 · ★ el batch entero se rechaza', res7.ok === false, JSON.stringify(res7));
    chk('I7 · ★ y NO queda la compra escrita sin sus asientos',
        (await contarCompras()) === 0 && (await contarMovimientos()) === 0,
        'compras=' + (await contarCompras()) + ' movimientos=' + (await contarMovimientos()));
    chk('I7 · el estado local tampoco se contaminó',
        appAtomico._deps.compras.length === 0);

    // ═══════════════════════════════════════════════════════════════════
    //  I8 · La consulta es por semana, no por colección entera
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await d.doc('compras/sap-1').set(compraDemo({ compraId: 'sap-1', docSap: '1', semanaId: '2026-09-14' }));
        await d.doc('compras/sap-2').set(compraDemo({ compraId: 'sap-2', docSap: '2', semanaId: '2026-09-14' }));
        await d.doc('compras/sap-3').set(compraDemo({ compraId: 'sap-3', docSap: '3', semanaId: '2026-09-07' }));
        await d.doc('compras/sap-4').set(compraDemo({ compraId: 'sap-4', docSap: '4', semanaId: '2026-08-31' }));
    });
    const appConsulta = montarCompras(dbComprador, 'comprador', { permisos: PERMISOS });
    const deLaSemana = await appConsulta.cargarComprasDeLaSemana('2026-09-14');
    chk('I8 · cargarComprasDeLaSemana() trae solo esa semana',
        deLaSemana.length === 2 && deLaSemana.every(c => c.semanaId === '2026-09-14'),
        'trajo ' + deLaSemana.length);
    const otraSemana = await appConsulta.cargarComprasDeLaSemana('2026-08-31');
    chk('I8 · y otra semana devuelve lo suyo, no lo de la anterior',
        otraSemana.length === 1 && otraSemana[0].compraId === 'sap-4',
        'trajo ' + otraSemana.length);

    // ═══════════════════════════════════════════════════════════════════
    //  I9 · La carga de arranque: semana en curso + anterior, sin duplicar
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    const appArranque = montarCompras(dbComprador, 'comprador', { permisos: PERMISOS });
    const semanaHoy    = appArranque.semanaId(new Date());
    const semanaPrevia = appArranque.semanaId(new Date(Date.now() - 7 * 86400000));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await d.doc('compras/sap-hoy').set(compraDemo({ compraId: 'sap-hoy', docSap: 'hoy', semanaId: semanaHoy }));
        await d.doc('compras/sap-previa').set(compraDemo({ compraId: 'sap-previa', docSap: 'previa', semanaId: semanaPrevia }));
        await d.doc('compras/sap-vieja').set(compraDemo({ compraId: 'sap-vieja', docSap: 'vieja', semanaId: '2020-01-06' }));
    });
    await appArranque.cargarComprasIniciales();
    chk('I9 · trae la semana en curso y la anterior, y no la vieja',
        appArranque._deps.compras.length === 2 &&
        !appArranque._deps.compras.some(c => c.compraId === 'sap-vieja'),
        'cargó ' + appArranque._deps.compras.length);
    chk('I9 · y derivó los asientos de cada compra cargada',
        appArranque._deps.movimientos.length === 4,
        'movimientos=' + appArranque._deps.movimientos.length);
    await appArranque.cargarComprasIniciales();
    chk('I9 · ★ llamarla otra vez no duplica nada',
        appArranque._deps.compras.length === 2 && appArranque._deps.movimientos.length === 4,
        'compras=' + appArranque._deps.compras.length + ' movimientos=' + appArranque._deps.movimientos.length);

    // ═══════════════════════════════════════════════════════════════════
    //  I10 · Sin conexión no se escribe ni se avanza el estado local
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    const appOffline = montarCompras(dbComprador, 'comprador', { permisos: PERMISOS, onLine: false });
    const res10 = await appOffline.guardarCompra(compraDemo());
    chk('I10 · se avisa de la falta de conexión en vez de intentar a ciegas',
        res10.ok === false && res10.motivo === 'sin_conexion', JSON.stringify(res10));
    chk('I10 · y no queda nada escrito ni en el servidor ni en local',
        (await contarCompras()) === 0 && appOffline._deps.compras.length === 0);

    // ═══════════════════════════════════════════════════════════════════
    //  I11 · costos/ultimos se escribe con merge
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    const appCostos = montarCompras(dbComprador, 'comprador', { permisos: PERMISOS });
    await appCostos._actualizarUltimosCostos({
        '1180015': { costo: 661.33, fecha: '2026-09-16', folio: '3646', compraId: 'sap-27615' }
    });
    await appCostos._actualizarUltimosCostos({
        '1060023': { costo: 75.565, fecha: '2026-09-18', folio: '3700', compraId: 'sap-27700' }
    });
    const costos = await leerCostos();
    chk('I11 · ★ la segunda importación NO borró el costo de la primera',
        !!costos && costos.productos && costos.productos['1180015'] &&
        costos.productos['1180015'].costo === 661.33 &&
        costos.productos['1060023'] && costos.productos['1060023'].costo === 75.565,
        JSON.stringify(costos && costos.productos));
    chk('I11 · y el espejo local quedó con los dos productos',
        Object.keys(appCostos._deps.costosUltimos).length === 2,
        JSON.stringify(Object.keys(appCostos._deps.costosUltimos)));

    // ═══════════════════════════════════════════════════════════════════
    //  I12 · El folio manual es transaccional
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    const appFolio = montarCompras(dbComprador, 'comprador', { permisos: PERMISOS });
    const f1 = await appFolio._obtenerSiguienteFolioCompra();
    const f2 = await appFolio._obtenerSiguienteFolioCompra();
    chk('I12 · dos folios consecutivos son distintos y crecientes',
        f1 === 1 && f2 === 2, 'f1=' + f1 + ' f2=' + f2);

    // ═══════════════════════════════════════════════════════════════════
    //  I13 · El evento de auditoría distingue el origen
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    const appAudit = montarCompras(dbComprador, 'comprador', { permisos: PERMISOS });
    await appAudit.guardarCompra(compraDemo({ compraId: 'sap-50001', docSap: '50001', origen: 'excel' }));
    await appAudit.guardarCompra(compraDemo({ compraId: 'folio-M1', docSap: null, folio: 'M-0001', origen: 'manual' }));
    const tipos = appAudit._eventos.map(e => e.tipo);
    chk('I13 · una importación registra compra_importada y una captura, compra_manual',
        tipos.indexOf('compra_importada') !== -1 && tipos.indexOf('compra_manual') !== -1,
        JSON.stringify(tipos));
    chk('I13 · el evento nombra el documento para poder rastrearlo',
        appAudit._eventos.some(e => e.compraId === 'sap-50001' && /27615|50001/.test(e.detalle || '')),
        JSON.stringify(appAudit._eventos.map(e => e.detalle)));

    // ═══════════════════════════════════════════════════════════════════
    //  I14 · Las líneas guardadas son las que se enviaron, campo a campo
    // ═══════════════════════════════════════════════════════════════════
    const c14 = await leerCompra('sap-50001');
    const esperada = compraDemo().lineas[0];
    chk('I14 · la línea guardada conserva todos sus campos sin recalcularse',
        !!c14 && c14.lineas[0].productoId === esperada.productoId &&
        c14.lineas[0].cantidadInventario === esperada.cantidadInventario &&
        c14.lineas[0].costoUnitario === esperada.costoUnitario &&
        c14.lineas[0].factorConversion === 1 &&
        c14.lineas[0].enCatalogo === true,
        JSON.stringify(c14 && c14.lineas[0]));

    // ═══════════════════════════════════════════════════════════════════
    //  I15 · ★ El Excel REAL: parseado y guardado de verdad
    //  Filas con la forma exacta del export de SAP (folio 3646 / Doc 27615),
    //  incluida una de otro almacén y la fila de totales del pie.
    // ═══════════════════════════════════════════════════════════════════
    await sembrar();
    const appExcel = montarCompras(dbComprador, 'comprador', { permisos: PERMISOS });
    const FILAS_EXCEL = [
        { 'Folio': 3646, 'Doc SAP': 27615, 'Sucursal': 'MOCHOMOS MONTERREY',
          'Proveedor': 'P00106 — VINOTECA MEXICO', 'Fecha': '2026-09-16', 'Entrega': '2026-09-16',
          'Estado': 'Sincronizado', 'Código': 1180015, 'Artículo': 'DON JULIO 70 700 ML',
          'UoM': 'PZA', 'Almacén': '12 — BARRA MOCHOMOS MONTERREY',
          'Cantidad': 2, 'Precio': 661.33, 'Total línea': 1322.66 },
        { 'Folio': 3646, 'Doc SAP': 27615, 'Sucursal': 'MOCHOMOS MONTERREY',
          'Proveedor': 'P00106 — VINOTECA MEXICO', 'Fecha': '2026-09-16', 'Entrega': '2026-09-16',
          'Estado': 'Sincronizado', 'Código': 1060023, 'Artículo': 'SANGRITA VIUDA DE SANCHEZ',
          'UoM': 'PZA', 'Almacén': '12 — BARRA MOCHOMOS MONTERREY',
          'Cantidad': 2, 'Precio': 75.565, 'Total línea': 151.13 },
        // Cocina: compra real, pero no le compete a BarInventory (D-2).
        { 'Folio': 3646, 'Doc SAP': 27615, 'Proveedor': 'P00106 — VINOTECA MEXICO',
          'Fecha': '2026-09-16', 'Estado': 'Sincronizado', 'Código': 2000111,
          'Artículo': 'ACEITE DE OLIVA', 'UoM': 'PZA', 'Almacén': '11 — COCINA MOCHOMOS MONTERREY',
          'Cantidad': 6, 'Precio': 300, 'Total línea': 1800 },
        // Otro folio del mismo archivo: tiene que salir como compra aparte.
        { 'Folio': 3350, 'Doc SAP': 27568, 'Proveedor': 'PCC00722 — FULL TRADING',
          'Fecha': '2026-09-15', 'Estado': 'Sincronizado', 'Código': 1150008,
          'Artículo': 'AGUA MINERAL 330 ML CAJA 24 PZS PERRIER', 'UoM': 'PZA',
          'Almacén': '12 — BARRA MOCHOMOS MONTERREY',
          'Cantidad': 24, 'Precio': 22.50, 'Total línea': 540 },
        // Fila de totales del pie: sin Código, se descarta sin incidencia.
        { 'Precio': 'TOTAL', 'Total línea': 3813.79 }
    ];
    const parsed = appExcel._parsearExcelCompras(FILAS_EXCEL);
    chk('I15 · el archivo produce DOS compras (una por folio)',
        parsed.grupos.length === 2, 'grupos=' + parsed.grupos.length);
    chk('I15 · ★ la fila de cocina se descarta como fuera de alcance, no como error',
        parsed.fueraDeAlcance === 1 && parsed.grupos.every(g => g.incidencias.length === 0),
        'fueraDeAlcance=' + parsed.fueraDeAlcance);
    chk('I15 · la fila de totales del pie se ignora sin ensuciar nada',
        parsed.filasIgnoradas === 1, 'filasIgnoradas=' + parsed.filasIgnoradas);
    const g27615 = parsed.grupos.find(g => g.docSap === '27615');
    chk('I15 · el id sale del Doc SAP, no del folio',
        !!g27615 && g27615.compraId === 'sap-27615', g27615 && g27615.compraId);
    chk('I15 · el proveedor se separa en código y nombre',
        !!g27615 && g27615.proveedorCodigo === 'P00106' && g27615.proveedorNombre === 'VINOTECA MEXICO',
        JSON.stringify(g27615 && { cod: g27615.proveedorCodigo, nom: g27615.proveedorNombre }));
    chk('I15 · la semana se deriva de la fecha del documento (lunes 2026-09-14)',
        !!g27615 && g27615.semanaId === '2026-09-14', g27615 && g27615.semanaId);
    chk('I15 · el importe suma solo las líneas de la barra (1322.66 + 151.13)',
        !!g27615 && Math.abs(g27615.importe - 1473.79) < 0.005, g27615 && String(g27615.importe));

    // Y ahora se guardan de verdad, como haría confirmarImportacionCompras().
    for (const g of parsed.grupos) {
        await appExcel.guardarCompra(Object.assign({}, g, {
            creadoPor: 'comprador', creadoEn: Date.now()
        }));
    }
    chk('I15 · ★ las dos compras quedaron escritas en Firestore',
        (await contarCompras()) === 2, 'compras=' + (await contarCompras()));
    chk('I15 · ★ con tres asientos en total (2 + 1)',
        (await contarMovimientos()) === 3, 'movimientos=' + (await contarMovimientos()));
    const cajaExplotada = await leerMovimiento('compra_sap-27568_1150008');
    chk('I15 · ★ la caja de 24 entra como 24 piezas: factor 1, sin multiplicar',
        !!cajaExplotada && cajaExplotada.cantidad === 24,
        cajaExplotada && String(cajaExplotada.cantidad));

    // Reimportar el MISMO archivo no duplica: es el caso real de "lo mandé dos veces".
    for (const g of parsed.grupos) {
        await appExcel.guardarCompra(Object.assign({}, g, {
            creadoPor: 'comprador', creadoEn: Date.now()
        }));
    }
    chk('I15 · ★ reimportar el mismo archivo no duplica ni una compra ni un asiento',
        (await contarCompras()) === 2 && (await contarMovimientos()) === 3,
        'compras=' + (await contarCompras()) + ' movimientos=' + (await contarMovimientos()));

    // La diferencia de costo se detecta, pero NO toca el catálogo.
    const difs = appExcel._diferenciasDeCosto(g27615);
    chk('I15 · detecta que el costo importado difiere del precio del catálogo',
        difs.length >= 1 && difs.some(d => d.productoId === '1180015'),
        JSON.stringify(difs));
    chk('I15 · ★ y el catálogo en memoria sigue con su precio original',
        appExcel._deps.products.find(p => p.id === '1180015').precio === 620.00,
        String(appExcel._deps.products.find(p => p.id === '1180015').precio));

    await testEnv.cleanup();

    console.log('\n  ' + total + ' comprobaciones de integración · ' +
                (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
