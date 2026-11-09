/**
 * prueba-importacion-mixta-integracion.js — R7b · importación de compras con grupos
 * válidos e inválidos, contra el emulador de Firestore REAL.
 *
 * Regla que se verifica (la que ya tiene la app en js/88-compras.js):
 *   · Un grupo con fecha inválida NO bloquea a los válidos.
 *   · El grupo inválido queda IDENTIFICADO en el resultado ("sin fecha válida"),
 *     para corregirlo en el Excel y reimportarlo.
 *   · Los válidos se guardan (compra + asientos) tal cual.
 *   · Si NINGÚN grupo es importable, no se escribe nada.
 *   · Reimportar un grupo válido no lo duplica.
 *
 * Se llama a confirmarImportacionCompras() REAL, no a una copia.
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-importacion-mixta-integracion.js"
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
        '            confirmarImportacionCompras: confirmarImportacionCompras,' +
        '            comprasVerificarDuplicados: comprasVerificarDuplicados,' +
        '            _comprasGruposImportables: _comprasGruposImportables,' +
        '            comprasValidarFechaIngreso: comprasValidarFechaIngreso,' +
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


let fallos = 0, total = 0;
function chk(nombre, ok, detalle) {
    total++;
    if (ok) { console.log('  ✅ ' + nombre); }
    else    { fallos++; console.error('  ❌ ' + nombre + (detalle ? '  ← ' + detalle : '')); }
}

const CATALOGO = [
    { id: '1180015', name: 'DON JULIO 70 700 ML', unit: 'PZA', precio: 620.00 },
    { id: '1060023', name: 'SANGRITA VIUDA DE SANCHEZ', unit: 'PZA', precio: 75.00 }
];
const PERMISOS = ['purchases.read', 'purchases.import', 'purchases.create'];

function grupoValido() {
    return { compraId: 'sap-27615', folio: '3646', docSap: '27615', fecha: '2026-09-14', semanaId: '2026-09-14',
             proveedorCodigo: 'P00106', proveedorNombre: 'VINOTECA MEXICO', importe: 3600, totalLineas: 1,
             incidencias: [], fechaInvalida: false,
             lineas: [{ productoId: '1180015', cantidadInventario: 6, enCatalogo: true, costoUnitario: 600 }] };
}
function grupoInvalido() {
    return { compraId: 'sap-99', folio: '9999', docSap: '99', fecha: '', semanaId: null, fechaInvalida: true,
             proveedorCodigo: 'P1', proveedorNombre: 'PROVEEDOR X', importe: 210, totalLineas: 1,
             incidencias: [], lineas: [{ productoId: '1060023', cantidadInventario: 3, enCatalogo: true, costoUnitario: 70 }] };
}
function pendiente(grupos) {
    return { grupos: grupos, fechaIngreso: '2026-09-15', verificacionCompleta: undefined, verificando: false };
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8'), host: 'localhost', port: 8080 }
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d0 = ctx.firestore();
        await d0.doc('roles/ADMIN').set({ roleId: 'ADMIN', permissions: ['*'] });
        await d0.doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count'] });
        await d0.doc('usuarios/comprador').set({ uid: 'comprador', role: 'BARTENDER', status: 'activo',
            permissionOverrides: { 'purchases.read': 'allow', 'purchases.create': 'allow', 'purchases.import': 'allow' } });
    });
    const db = testEnv.authenticatedContext('comprador').firestore();
    const app = montarCompras(db, 'comprador', { permisos: PERMISOS, products: CATALOGO });
    const d = app._deps;
    const contar = async (col) => {
        let n = 0, ids = [];
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().collection(col).get();
            n = s.size; ids = s.docs.map(x => x.id);
        });
        return { n, ids };
    };

    console.log('\n  ── R7b · importación con grupos válidos e inválidos (Firestore real) ──\n');

    // 1 · Regla actual: los válidos son importables; el inválido queda fuera.
    const mixta = pendiente([grupoValido(), grupoInvalido()]);
    chk('1 · ★ solo el grupo válido es importable (el inválido queda fuera)',
        app._comprasGruposImportables(mixta).length === 1 && app._comprasGruposImportables(mixta)[0].compraId === 'sap-27615');

    // 2 · Confirmar la mezcla: se guardan los válidos y el inválido se reporta.
    d._comprasImportPendiente = mixta;
    await app.confirmarImportacionCompras();
    const res = d._comprasImportResultado || {};
    const c1 = await contar('compras');
    const m1 = await contar('movimientos');
    chk('2 · ★ el grupo válido SÍ se guarda aunque haya uno inválido',
        c1.ids.indexOf('sap-27615') !== -1, 'compras=' + JSON.stringify(c1.ids));
    chk('2 · ★ el grupo inválido NO se escribe en Firestore',
        c1.ids.indexOf('sap-99') === -1, 'compras=' + JSON.stringify(c1.ids));
    chk('2 · ★ el grupo inválido queda identificado en el resultado (sin fecha válida, con folio)',
        (res.fallidas || []).some(f => f.compraId === 'sap-99' && /sin fecha válida/.test(f.motivo) && f.folio === '9999'),
        JSON.stringify(res.fallidas));
    chk('2 · el resultado cuenta 1 entrada guardada (creadas + reingresadas)',
        (res.creadas || 0) + (res.reingresadas || 0) === 1, JSON.stringify({ creadas: res.creadas, reingresadas: res.reingresadas }));
    chk('2 · solo se generan asientos del grupo válido (1 línea de catálogo)',
        m1.n === 1 && m1.ids.every(id => id.indexOf('sap-27615') !== -1), 'movimientos=' + JSON.stringify(m1.ids));
    chk('2 · la vista pasa a incidencias y la vista previa se limpia',
        d._comprasImportPendiente === null && d.comprasImportView === 'incidencias');

    // 3 · Solo grupos inválidos: no se escribe nada y se avisa.
    const antes = (await contar('compras')).n;
    d._comprasImportPendiente = pendiente([grupoInvalido()]);
    await app.confirmarImportacionCompras();
    chk('3 · ★ con solo grupos inválidos no se escribe nada',
        (await contar('compras')).n === antes, 'antes=' + antes);

    // 4 · Reimportar un grupo válido ya guardado no lo duplica.
    d._comprasImportPendiente = pendiente([grupoValido()]);
    await app.confirmarImportacionCompras();
    const c4 = await contar('compras');
    chk('4 · ★ reimportar el mismo grupo válido no duplica la compra',
        c4.n === antes && c4.ids.filter(x => x === 'sap-27615').length === 1, 'compras=' + JSON.stringify(c4.ids));

    // 5 · Sin fecha de ingreso válida no se importa nada (regla existente).
    d._comprasImportPendiente = Object.assign(pendiente([grupoValido()]), { fechaIngreso: '' });
    await app.confirmarImportacionCompras();
    chk('5 · sin fecha de ingreso no se importa ningún grupo',
        (await contar('compras')).n === c4.n);

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
