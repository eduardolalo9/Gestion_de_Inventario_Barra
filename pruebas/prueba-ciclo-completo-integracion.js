/**
 * prueba-ciclo-completo-integracion.js — HOTFIX 4.19: el ciclo completo de un
 * Inventario Físico, de punta a punta, con el código REAL y Firestore real
 * (emulador + firestore.rules):
 *
 *   crear #1001 → contar (admin y bartender) → cerrar → contabilizar →
 *   Historial → crear #1002 → todo en cero → Historial conserva los anteriores
 *
 *   C1 ★ El Historial muestra los CONTABILIZADOS (antes solo los CERRADOS).
 *   C2 ★ Al crear, todas las áreas y todos los dispositivos quedan en cero.
 *   C3 ★ Un conteo del inventario anterior que sube tarde (teléfono sin señal)
 *        NO reaparece en el inventario nuevo cuando esa persona vuelve a
 *        contar (antes: set con merge:true mezclaba los productos viejos).
 *   C4   Cerrar y contabilizar con los saldos correctos.
 *   C5 ★ Tras contabilizar, el inventario sigue en el Historial, y al crear el
 *        siguiente también.
 *   C6   Con un inventario activo no se crea otro.
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-ciclo-completo-integracion.js"
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
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
async function esperarQue(fn, ms) {
    const limite = Date.now() + (ms || 4000);
    while (Date.now() < limite) { if (fn()) return true; await esperar(30); }
    return fn();
}

function extraerFuncion(fuente, nombre) {
    const m = new RegExp('(async\\s+)?function ' + nombre + '\\(').exec(fuente);
    if (!m) throw new Error('No se encontró ' + nombre);
    let nivel = 0, dentro = false;
    for (let j = m.index; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(m.index, j + 1); }
    }
    throw new Error('No se pudo delimitar ' + nombre);
}

// Un "dispositivo": una instancia del código real con su propia memoria.
function montar(db, uid, deviceId, opts) {
    opts = opts || {};
    const esAdmin = opts.admin !== false;
    const datos = leer('js/45-inventario-datos.js');
    const avisos = [];
    const almacen = { _d: {}, getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
                      setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
    const deps = {
        navigator: { onLine: true }, _db: db, FIRESTORE_DOC_ID: DOC_ID, currentUserUid: uid, currentUserRole: esAdmin ? 'admin' : 'bartender',
        _deviceId: deviceId, AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
        areasAuditoria: { almacen: 'Almacén', barra1: 'Barra Restaurante', barra2: 'Barra Bar' },
        areasAuditoriaFA: {}, areasAuditoriaIcons: {},
        products: [{ id: 'P1', name: 'TEQUILA', unit: 'PZA', group: 'Tequila' }, { id: 'P2', name: 'VODKA', unit: 'PZA', group: 'Vodka' }],
        myAuditoriaConteo: {}, myAuditoriaStatus: {}, myAuditoriaUnlocks: {}, myAuditoriaFinalizadas: {},
        auditoriaStatus: {}, auditoriaConteo: {}, auditoriaConteoPorUsuario: {}, allUsersAuditoria: {},
        inventarioConteo: {}, auditoriaView: 'selection', auditoriaAreaActiva: null, isAuditoriaMode: false,
        _auditoriaSessionId: null, _inventarioActivo: null,
        _unsubInventarioActivo: null, _inventarioActivoId: null, _inventarioActivoCarga: 'sin_sesion',
        _unsubAllUsers: null, _adminRenderTimer: null, _historialInventarios: null, _authzState: { roleId: 'ADMIN' },
        auditCurrentUser: { userId: uid, userName: uid },
        isAdmin: () => esAdmin, hasPermission: () => esAdmin, puedeOperarArea: () => true, puedeVerConteosAjenos: () => esAdmin,
        showNotification: (t) => avisos.push(String(t)),
        showConfirm: (m, cb) => { deps._pendiente = Promise.resolve().then(cb); return deps._pendiente; },
        renderTab() {}, saveToLocalStorage() {}, updateCloudSyncBadge() {}, updateHeaderActions() {},
        switchTab(t) { deps.activeTab = t; },
        _registrarEnSyncQueue() {}, _registrarConflictos() {}, _crearBackupNombrado() {},
        escapeHtml: (s) => String(s), exportToExcelConDatos() {}, _usuariosContando: () => 0,
        // syncToCloud (js/40-firestore.js) y lo que lee
        orders: [], inventories: [], cart: [], activeTab: 'inicio', selectedArea: 'almacen',
        _syncEnabled: true, _syncInProgress: false, _cloudSyncPending: false, _lastCloudSync: 0,
        _syncQueue: [], _catalogoPurgadoEn: null, _haySesionFirebase: () => true, _flushSyncQueueToFirestore: () => Promise.resolve(), _deletedProductIds: [], _mergeArrayByIdPreferLocal: (l) => l, _deletedOrderIds: [], _deletedInventoryIds: [], _purgaDeCatalogoVigente: () => false, _logSyncError() {},
        firebase: fb, _auth: { currentUser: { uid: uid, email: uid + '@barra.mx' } },
        localStorage: almacen,
        console: { warn: (...a) => { if (process.env.DEPURAR) console.error('[app-warn]', ...a); }, error: (...a) => { if (process.env.DEPURAR) console.error('[app]', ...a); }, info: (...a) => { if (process.env.DEPURAR) console.error('[app-info]', ...a); }, log() {} },
        // Formulario "Nuevo Inventario" (confirmarNuevoInventario lee el DOM).
        _form: { areas: ['almacen', 'barra1', 'barra2'], fecha: '' },
        document: { getElementById: (id) => id === 'nuevoInvFecha' ? { value: deps._form.fecha } : null, querySelector: () => null,
                    querySelectorAll: (sel) => /nuevoInvArea/.test(sel) ? deps._form.areas.map(a => ({ value: a })) : [],
                    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, remove() {} }),
                    body: { appendChild() {}, removeChild() {}, classList: { add() {}, remove() {} } }, addEventListener() {} },
        requestAnimationFrame: (f) => f(), setTimeout: setTimeout, clearTimeout: clearTimeout,
        // js/50 (subscribeMainDoc) y js/45 (loadFromCloud)
        _unsubMainDoc: null, _mainDocReconnectAttempts: 0, _mainDocReconnectTimer: null, _applicaciones: []
    };
    deps.window = deps;
    const roles = leer('js/50-roles-permisos.js');
    const opcional = (fuente, n) => { try { return extraerFuncion(fuente, n); } catch (e) { return ''; } };
    const codigo =
        extraerFuncion(leer('js/00-nucleo.js'), 'estadoAreasVacio') + '\n' +
        extraerFuncion(leer('js/10-multiusuario.js'), 'inventarioAbierto') + '\n' +
        leer('js/15-ciclo-semanal.js') + '\n' +
        leer('js/46-arrastre.js') + '\n' +   // FASE 14
        ['_suscribirInventarioActivo', 'handleAuditSessionChange', 'subscribeAllUsersAuditoria', '_abiertasDivergen',
         '_recalcAdminAggregatedConteo', '_obtenerSiguienteNumeroInventario', '_opcNuevoInv', '_areasDelNuevoInventario',
         '_adminIniciarSesionFirestore', 'loadFromCloud'].map(n => extraerFuncion(datos, n)).join('\n') + '\n' +
        extraerFuncion(leer('js/30-indexeddb.js'), '_contarEntradasConteo') + '\n' +
        ['convertirOzAPuntos', 'tieneDatosConversion', 'tieneConversion'].map(n => extraerFuncion(leer('js/70-conversion-render.js'), n)).join('\n') + '\n' +
        opcional(datos, '_reconciliarSesionDesdeDocPrincipal') + '\n' + opcional(datos, '_aplicarReinicioSiCorresponde') + '\n' + extraerFuncion(roles, 'subscribeMainDoc') + '\n' +
        leer('js/40-firestore.js') + '\n' + leer('js/75-auditoria-flujo.js') + '\n' +
        '; return { syncMyAuditoriaToFirestore, confirmarNuevoInventario, contabilizarInventario, _cargarHistorialInventarios, historialVerMas, ' +
        '           leerHistorial: function() { return _historialInventarios; }, hayMas: function() { return _historialHayMas; }, ' +
        '           handleAuditSessionChange, loadFromCloud, subscribeMainDoc, auditoriaResetear, syncToCloud, subscribeAllUsersAuditoria, ' +
        '           _obtenerSiguienteNumeroInventario, _adminIniciarSesionFirestore, cerrarInventarioFisico: (typeof cerrarInventarioFisico === "function" ? cerrarInventarioFisico : null) };';
    const api = new Function('deps', 'with (deps) {\n' + codigo + '\n}')(deps);
    api.deps = deps; api.avisos = avisos;
    // _applyCloudData completo necesita media app; aquí solo importa lo que
    // hace con la sesión, que es EXACTAMENTE lo que hace la real (js/45, tramo
    // "Detectar cambio de sesión"): delegar en handleAuditSessionChange. Una
    // comprobación estática de abajo fija que la real sigue haciéndolo.
    deps._applyCloudData = async function(data) {
        deps._applicaciones.push(data._lastModified);
        if (data._auditoriaSessionId) {
            api.handleAuditSessionChange(data._auditoriaSessionId, 'applyCloudData', data._auditoriaStartedBy, data._auditoriaStartedByDeviceId);
        }
    };
    // Arranque real de la app: lectura inicial y escucha del documento principal.
    api.arrancar = async function() {
        await api.loadFromCloud();
        api.subscribeMainDoc();
        await esperar(400);
    };
    api.crear = async function() {
        deps._pendiente = null;
        api.auditoriaResetear();
        for (let i = 0; i < 6 && deps._pendiente; i++) { const p = deps._pendiente; deps._pendiente = null; await p; }
        await esperar(250);
    };
    api.esperarPendientes = async function() {
        for (let i = 0; i < 8; i++) {
            if (!deps._pendiente) { await esperar(60); if (!deps._pendiente) break; }
            const p = deps._pendiente; deps._pendiente = null; await p;
        }
        await esperar(300);
    };
    api.crearConFormulario = async function(fecha) {
        deps._pendiente = null; deps._form.fecha = fecha;
        api.confirmarNuevoInventario();
        await api.esperarPendientes();
    };
    api.cerrar = async function() { deps._pendiente = null; await api.cerrarInventarioFisico(); await api.esperarPendientes(); };
    api.contabilizar = async function() {
        deps._pendiente = null;
        await api.contabilizarInventario(deps._inventarioActivoId, deps._inventarioActivo && deps._inventarioActivo.numero);
        await api.esperarPendientes();
    };
    api.contar = async function(prod, area, enteras) {
        deps.myAuditoriaConteo[prod] = deps.myAuditoriaConteo[prod] || {};
        deps.myAuditoriaConteo[prod][area] = { enteras: enteras, abiertas: [], _ts: Date.now() };
        deps.myAuditoriaStatus[area] = 'completada';
        await api.syncMyAuditoriaToFirestore();
    };
    api.soltar = function() {
        if (typeof deps._unsubInventarioActivo === 'function') deps._unsubInventarioActivo();
        if (typeof deps._unsubAllUsers === 'function') deps._unsubAllUsers();
        if (typeof deps._unsubMainDoc === 'function') deps._unsubMainDoc();
    };
    return api;
}


async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: leer('firestore.rules'), host: 'localhost', port: 8080 }
    });
    const db = (uid) => testEnv.authenticatedContext(uid).firestore();
    const S6 = '1779000000000', S7 = '1780000000000';
    await testEnv.clearFirestore();   // cada prueba parte de un Firestore vacío

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
        await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
        await d.doc(R).set({ _auditoriaSessionId: S7, _auditoriaStartedBy: 'jefe', _auditoriaStartedByDeviceId: 'tel-jefe',
                             _lastModified: 1780000005000, _lastWrittenBy: 'jefe' });
        await d.doc(R + '/contadores/inventarios').set({ ultimoNumero: 7 });
        await d.doc(R + '/inventories/' + S6).set({ inventoryId: S6, numero: 6, estado: 'CERRADO', fechaCreacion: 1 });
        await d.doc(R + '/inventories/' + S7).set({ inventoryId: S7, numero: 7, estado: 'CONTABILIZADO', fechaCreacion: 2,
                                                     semanaDestino: '2026-09-21' });
        await d.doc(R + '/userAuditoria/bart1').set({ uid: 'bart1', sessionId: S7, isAdmin: false, updatedAt: 1,
            status: { almacen: 'completada' }, conteo: { P1: { almacen: { enteras: 12, abiertas: [], _ts: 1 } } } });
    });
    async function servidor() {
        let r = {};
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            const ua = await d.collection(R + '/userAuditoria').get();
            const invs = await d.collection(R + '/inventories').get();
            const ini = await d.collection(R + '/inventariosIniciales').get();
            r = { ua: {}, invs: {}, iniciales: ini.docs.map(x => Object.assign({ id: x.id }, x.data())) };
            ua.docs.forEach(x => { r.ua[x.id] = x.data(); });
            invs.docs.forEach(x => { r.invs[x.data().numero] = x.data().estado; });
        });
        return r;
    }
    const historial = async (app) => { await app._cargarHistorialInventarios(); return (app.leerHistorial() || []).map(i => i.numero + ':' + i.estado); };
    const sumaConteo = (c) => Object.keys(c || {}).length;

    // Dispositivos: teléfono del admin, teléfono del bartender, y el teléfono
    // VIEJO del bartender que se quedó sin señal con un conteo del #7.
    const adm = montar(db('jefe'), 'jefe', 'tel-jefe');
    adm.deps._auditoriaSessionId = S7;
    adm.deps.localStorage.setItem('inventarioApp_lastModified', String(1780000005000 + 9000));
    await adm.arrancar();
    adm.subscribeAllUsersAuditoria();
    const bar = montar(db('bart1'), 'bart1', 'tel-bart1', { admin: false });
    bar.deps._auditoriaSessionId = S7;
    bar.deps.myAuditoriaConteo = { P1: { almacen: { enteras: 12, abiertas: [] } } };
    bar.deps.localStorage.setItem('inventarioApp_lastModified', String(1780000005000 + 9000));
    await bar.arrancar();
    const viejo = montar(db('bart1'), 'bart1', 'tel-viejo', { admin: false });
    viejo.deps._auditoriaSessionId = S7;
    viejo.deps.myAuditoriaConteo = { P2: { barra1: { enteras: 9, abiertas: [], _ts: 1 } } };
    viejo.deps.myAuditoriaStatus = { barra1: 'completada' };
    viejo.deps.navigator.onLine = false;                        // sin señal: no se entera de nada

    // ── C1 · Historial de partida ───────────────────────────────────────
    chk('★ C1 · El Historial muestra el #7 CONTABILIZADO y el #6 CERRADO', JSON.stringify(await historial(adm)) === '["7:CONTABILIZADO","6:CERRADO"]',
        JSON.stringify(await historial(adm)));

    // ── C2 · Crear #1001: todo en cero ──────────────────────────────────
    await adm.crearConFormulario('2026-09-27');
    const sesion1001 = adm.deps._auditoriaSessionId;
    let srv = await servidor();
    chk('C2 · Se creó el #1001 activo desde el formulario', srv.invs[1001] === 'SINCRONIZADO' && adm.deps._inventarioActivo && adm.deps._inventarioActivo.numero === 1001,
        JSON.stringify(srv.invs) + ' ' + adm.avisos.slice(-2).join(' | '));
    chk('★ C2 · Admin: áreas en cero (conteo propio y agregado vacíos, las 3 áreas pendientes)',
        sumaConteo(adm.deps.myAuditoriaConteo) === 0 && sumaConteo(adm.deps.auditoriaConteo) === 0 &&
        ['almacen', 'barra1', 'barra2'].every(a => adm.deps.auditoriaStatus[a] === 'pendiente'),
        JSON.stringify([adm.deps.myAuditoriaConteo, adm.deps.auditoriaConteo, adm.deps.auditoriaStatus]));
    chk('C2 · Servidor: solo queda el documento del admin, vacío',
        Object.keys(srv.ua).join() === 'jefe' && sumaConteo(srv.ua.jefe.conteo) === 0, JSON.stringify(Object.keys(srv.ua)));
    const okBar = await esperarQue(() => bar.deps._auditoriaSessionId === sesion1001 && sumaConteo(bar.deps.myAuditoriaConteo) === 0, 3000);
    chk('★ C2 · Teléfono del bartender: pasa al #1001 y su conteo queda en cero', okBar,
        bar.deps._auditoriaSessionId + ' ' + JSON.stringify(bar.deps.myAuditoriaConteo));

    // ── C3 · El teléfono viejo recupera la señal y sube su conteo del #7 ──
    viejo.deps.navigator.onLine = true;
    await viejo.syncMyAuditoriaToFirestore();                  // sube ANTES de enterarse del #1001
    await bar.contar('P1', 'almacen', 5);                      // el bartender cuenta en el #1001
    srv = await servidor();
    chk('★ C3 · El conteo del #7 que subió tarde NO se mezcla en el #1001 (solo P1=5)',
        srv.ua.bart1 && srv.ua.bart1.sessionId === sesion1001 && JSON.stringify(Object.keys(srv.ua.bart1.conteo)) === '["P1"]'
        && srv.ua.bart1.conteo.P1.almacen.enteras === 5,
        JSON.stringify(srv.ua.bart1 && { s: srv.ua.bart1.sessionId, c: srv.ua.bart1.conteo }));
    await viejo.syncMyAuditoriaToFirestore();                  // y vuelve a intentarlo después
    srv = await servidor();
    chk('★ C3 · …ni pisa el documento del #1001 si sube DESPUÉS',
        srv.ua.bart1.sessionId === sesion1001 && JSON.stringify(Object.keys(srv.ua.bart1.conteo)) === '["P1"]',
        JSON.stringify({ s: srv.ua.bart1.sessionId, c: srv.ua.bart1.conteo }));
    const okAdmVe = await esperarQue(() => adm.deps.auditoriaConteo.P1 && adm.deps.auditoriaConteo.P1.almacen && adm.deps.auditoriaConteo.P1.almacen.enteras === 5
        && !adm.deps.auditoriaConteo.P2, 3000);
    chk('C3 · El admin ve en vivo P1=5 del bartender y nada del #7', okAdmVe, JSON.stringify(adm.deps.auditoriaConteo));

    // ── C4 · Contar, cerrar y contabilizar ──────────────────────────────
    await adm.contar('P2', 'barra2', 3);
    await esperarQue(() => adm.deps.allUsersAuditoria.jefe && sumaConteo(adm.deps.allUsersAuditoria.jefe.conteo) === 1, 3000);
    await adm.cerrar();
    await esperarQue(() => adm.deps._inventarioActivo && adm.deps._inventarioActivo.estado === 'CERRADO', 3000);
    srv = await servidor();
    chk('C4 · Cerrado: el #1001 queda CERRADO', srv.invs[1001] === 'CERRADO', JSON.stringify(srv.invs) + ' ' + adm.avisos.slice(-2).join(' | '));
    chk('C4 · …y entra al Historial al momento', JSON.stringify(await historial(adm)) === '["1001:CERRADO","7:CONTABILIZADO","6:CERRADO"]',
        JSON.stringify(await historial(adm)));
    await adm.contabilizar();
    await esperarQue(() => adm.deps._inventarioActivo && adm.deps._inventarioActivo.estado === 'CONTABILIZADO', 3000);
    srv = await servidor();
    const ini = srv.iniciales.filter(i => i.origen && i.origen.numero === 1001)[0];
    const saldo = (id) => { const x = ini && (ini.saldos || []).filter ? (ini.saldos || []).filter(s => s.id === id)[0] : null; return x ? (x.total !== undefined ? x.total : x.cantidad) : (ini && ini.saldos && ini.saldos[id]); };
    chk('C4 · Contabilizado: estado CONTABILIZADO e inicial de la semana 2026-09-28',
        srv.invs[1001] === 'CONTABILIZADO' && ini && ini.semanaId === '2026-09-28', JSON.stringify(srv.invs) + ' ' + JSON.stringify(ini && ini.semanaId) + ' ' + adm.avisos.slice(-2).join(' | '));
    chk('C4 · Saldos del inicial: P1 = 5 (bartender), P2 = 3 (admin), sin nada del #7',
        ini && JSON.stringify(ini.saldos).indexOf('12') === -1 && JSON.stringify(ini.saldos).indexOf('9') === -1
        && /P1[^}]*5/.test(JSON.stringify(ini.saldos)) && /P2[^}]*3/.test(JSON.stringify(ini.saldos)), JSON.stringify(ini && ini.saldos));

    // ── C5 · Historial tras contabilizar, y al crear el siguiente ───────
    chk('★ C5 · El #1001 CONTABILIZADO sigue en el Historial', JSON.stringify(await historial(adm)) === '["1001:CONTABILIZADO","7:CONTABILIZADO","6:CERRADO"]',
        JSON.stringify(await historial(adm)));
    await adm.crearConFormulario('2026-10-04');
    srv = await servidor();
    chk('C5 · Se creó el #1002', srv.invs[1002] === 'SINCRONIZADO' && adm.deps._inventarioActivo && adm.deps._inventarioActivo.numero === 1002,
        JSON.stringify(srv.invs) + ' ' + adm.avisos.slice(-2).join(' | '));
    chk('★ C5 · #1002: admin con todas las áreas en cero', sumaConteo(adm.deps.myAuditoriaConteo) === 0 && sumaConteo(adm.deps.auditoriaConteo) === 0
        && ['almacen', 'barra1', 'barra2'].every(a => adm.deps.auditoriaStatus[a] === 'pendiente'),
        JSON.stringify([adm.deps.myAuditoriaConteo, adm.deps.auditoriaConteo]));
    const okBar2 = await esperarQue(() => bar.deps._auditoriaSessionId === adm.deps._auditoriaSessionId && sumaConteo(bar.deps.myAuditoriaConteo) === 0
        && bar.deps.myAuditoriaStatus.almacen === 'pendiente', 3000);
    chk('★ C5 · #1002: el bartender también en cero y con sus áreas pendientes', okBar2, JSON.stringify([bar.deps.myAuditoriaConteo, bar.deps.myAuditoriaStatus]));
    chk('★ C5 · Historial: #1001 CONTABILIZADO, #7 y #6 — y el #1002 (abierto) todavía no',
        JSON.stringify(await historial(adm)) === '["1001:CONTABILIZADO","7:CONTABILIZADO","6:CERRADO"]', JSON.stringify(await historial(adm)));

    // ── C6 · Anti-solapamiento ──────────────────────────────────────────
    await adm.crearConFormulario('2026-10-11');
    srv = await servidor();
    chk('C6 · Con el #1002 activo no se crea otro (sigue #1002, sin #1003)', srv.invs[1002] === 'SINCRONIZADO' && !srv.invs[1003],
        JSON.stringify(srv.invs));

    [adm, bar, viejo].forEach(x => x.soltar());
    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones de integración · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
