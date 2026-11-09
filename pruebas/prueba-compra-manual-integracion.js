/**
 * prueba-compra-manual-integracion.js — «Captura manual» de compras, contra el
 * emulador de Firestore REAL con firestore.rules aplicadas.
 *
 * Contrato (reutiliza lo que ya existe, sin cambiar su lógica):
 *   · comprasValidarManual(datos, hoyISO) — capa PURA: valida y arma el grupo.
 *   · comprasGuardarManual(datos)         — folio manual transaccional
 *                                           (_obtenerSiguienteFolioCompra) +
 *                                           guardarCompra() con origen 'manual'.
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-compra-manual-integracion.js"
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
        '            comprasValidarManual: (typeof comprasValidarManual === "function" ? comprasValidarManual : null),' +
        '            comprasGuardarManual: (typeof comprasGuardarManual === "function" ? comprasGuardarManual : null),' +
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
    { id: '1180015', name: 'DON JULIO 70 700 ML', unit: 'PZA', precio: 620 },
    { id: '1060023', name: 'SANGRITA VIUDA DE SANCHEZ', unit: 'PZA', precio: 75 }
];
const HOY = '2026-11-08';
const base = () => ({
    proveedorNombre: 'VINOTECA MEXICO', proveedorCodigo: 'P00106', referencia: 'FAC-889',
    fechaIngreso: '2026-11-06',
    lineas: [ { productoId: '1180015', cantidad: '2', costo: '600' }, { productoId: '1060023', cantidad: '3,5', costo: '70.50' } ]
});

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
            permissionOverrides: { 'purchases.read': 'allow', 'purchases.create': 'allow' } });
        await d0.doc('usuarios/sinpermiso').set({ uid: 'sinpermiso', role: 'BARTENDER', status: 'activo' });
    });
    const app = montarCompras(testEnv.authenticatedContext('comprador').firestore(), 'comprador',
                              { permisos: ['purchases.read', 'purchases.create'], products: CATALOGO });
    const contar = async (col) => {
        let ids = [];
        await testEnv.withSecurityRulesDisabled(async (ctx) => { ids = (await ctx.firestore().collection(col).get()).docs.map(x => x.id); });
        return ids;
    };
    console.log('\n  ── Captura manual de compras (Firestore real) ──\n');

    // ── A · Validación (capa pura) ─────────────────────────────────────────
    const V = app.comprasValidarManual;
    chk('A0 · existe comprasValidarManual (la función de validación)', typeof V === 'function');
    if (typeof V !== 'function') { console.error('  → falta implementar; se detiene aquí.'); await testEnv.cleanup(); process.exit(1); }
    const ok = V(base(), HOY, CATALOGO);
    chk('A1 · datos correctos → ok, con importe 2×600 + 3.5×70.50 = 1446.75',
        ok.ok === true && ok.grupo && ok.grupo.importe === 1446.75, JSON.stringify(ok).slice(0, 200));
    chk('A2 · la coma decimal se acepta (3,5 → 3.5, sin ×10)', ok.grupo && ok.grupo.lineas[1].cantidadInventario === 3.5);
    chk('A3 · fecha de ingreso = fecha del documento y semana = lunes de esa semana',
        ok.grupo && ok.grupo.fecha === '2026-11-06' && ok.grupo.fechaIngreso === '2026-11-06' && ok.grupo.semanaId === '2026-11-02',
        ok.grupo && JSON.stringify([ok.grupo.fecha, ok.grupo.fechaIngreso, ok.grupo.semanaId]));
    chk('A4 · origen manual, sin Doc SAP, y las líneas traen la forma del importador',
        ok.grupo && ok.grupo.origen === 'manual' && ok.grupo.docSap === null && ok.grupo.totalLineas === 2
        && ok.grupo.lineas[0].enCatalogo === true && ok.grupo.lineas[0].factorConversion === 1
        && ok.grupo.lineas[0].descripcionSap === 'DON JULIO 70 700 ML' && ok.grupo.lineas[0].importe === 1200);
    const sinProv = V(Object.assign(base(), { proveedorNombre: '  ' }), HOY, CATALOGO);
    chk('A5 · sin proveedor → error en el campo proveedor', sinProv.ok === false && !!sinProv.errores.proveedorNombre);
    const sinLin = V(Object.assign(base(), { lineas: [] }), HOY, CATALOGO);
    chk('A6 · sin líneas → error, no se guarda una compra vacía', sinLin.ok === false && !!sinLin.errores.lineas);
    const cantMala = V(Object.assign(base(), { lineas: [{ productoId: '1180015', cantidad: '0', costo: '10' }] }), HOY, CATALOGO);
    chk('A7 · cantidad 0 o vacía → error en esa línea (índice 0)', cantMala.ok === false && !!(cantMala.errores.lineasDetalle && cantMala.errores.lineasDetalle[0] && cantMala.errores.lineasDetalle[0].cantidad));
    const costoMalo = V(Object.assign(base(), { lineas: [{ productoId: '1180015', cantidad: '1', costo: '-5' }] }), HOY, CATALOGO);
    chk('A8 · costo negativo → error; costo 0 sí se permite (regalo/muestra)',
        costoMalo.ok === false && V(Object.assign(base(), { lineas: [{ productoId: '1180015', cantidad: '1', costo: '0' }] }), HOY, CATALOGO).ok === true);
    chk('A9 · fecha futura → error', V(Object.assign(base(), { fechaIngreso: '2026-11-09' }), HOY, CATALOGO).ok === false);
    chk('A10 · fecha vacía o inválida → error', V(Object.assign(base(), { fechaIngreso: '' }), HOY, CATALOGO).ok === false && V(Object.assign(base(), { fechaIngreso: '2026-02-31' }), HOY, CATALOGO).ok === false);
    const dup = V(Object.assign(base(), { lineas: [{ productoId: '1180015', cantidad: '1', costo: '1' }, { productoId: '1180015', cantidad: '2', costo: '1' }] }), HOY, CATALOGO);
    chk('A11 · ★ el mismo producto dos veces se rechaza (el id del asiento colisionaría)', dup.ok === false && !!dup.errores.lineasDetalle && !!dup.errores.lineasDetalle[1]);
    chk('A12 · producto que no está en el catálogo → error (la captura manual es solo de catálogo)',
        V(Object.assign(base(), { lineas: [{ productoId: 'NOEXISTE', cantidad: '1', costo: '1' }] }), HOY, CATALOGO).ok === false);
    chk('A13 · validar es puro: no escribe nada', (await contar('compras')).length === 0);

    // ── B · Guardar contra Firestore real ──────────────────────────────────
    const G = app.comprasGuardarManual;
    chk('B0 · existe comprasGuardarManual', typeof G === 'function');
    const r1 = await G(base());
    const c1 = await contar('compras'); const m1 = await contar('movimientos');
    chk('B1 · ★ guarda la compra: ok y 1 documento en compras', r1 && r1.ok === true && c1.length === 1, JSON.stringify(r1).slice(0, 200));
    chk('B2 · ★ el folio es correlativo M-0001 y el id es folio-M-0001', c1[0] === 'folio-M-0001', JSON.stringify(c1));
    chk('B3 · ★ un asiento por línea (2) con el id determinista', m1.length === 2 && m1.indexOf('compra_folio-M-0001_1180015') !== -1, JSON.stringify(m1));
    const r2 = await G(Object.assign(base(), { referencia: 'FAC-890' }));
    chk('B4 · ★ la segunda captura recibe M-0002 (nunca repite folio)', r2 && r2.ok === true && (await contar('compras')).indexOf('folio-M-0002') !== -1);
    const antes = (await contar('compras')).length;
    const rMala = await G(Object.assign(base(), { proveedorNombre: '' }));
    chk('B5 · ★ datos inválidos → no se escribe nada ni se consume un folio',
        rMala && rMala.ok === false && (await contar('compras')).length === antes);
    const r3 = await G(base());
    chk('B6 · el folio no se quemó con la captura inválida: sigue M-0003', r3.ok === true && (await contar('compras')).indexOf('folio-M-0003') !== -1);

    // ── C · Permisos y red ─────────────────────────────────────────────────
    const appSin = montarCompras(testEnv.authenticatedContext('sinpermiso').firestore(), 'sinpermiso', { permisos: [], products: CATALOGO });
    const nPrev = (await contar('compras')).length;
    const rSin = await appSin.comprasGuardarManual(base());
    chk('C1 · ★ sin purchases.create no se escribe nada', rSin && rSin.ok === false && (await contar('compras')).length === nPrev, JSON.stringify(rSin));
    const appOff = montarCompras(testEnv.authenticatedContext('comprador').firestore(), 'comprador', { permisos: ['purchases.create'], products: CATALOGO, onLine: false });
    const rOff = await appOff.comprasGuardarManual(base());
    chk('C2 · sin conexión no se escribe y se dice por qué', rOff && rOff.ok === false && /conexi/i.test(String(rOff.motivo || rOff.mensaje || '')) && (await contar('compras')).length === nPrev, JSON.stringify(rOff));

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
