/**
 * prueba-arranque-integracion.js — HOTFIX 4.18: el inventario creado debe
 * reaparecer al cerrar y abrir la app, y verse igual en teléfono y laptop.
 * ═══════════════════════════════════════════════════════════════════════════
 * Nace del video del 30/09/2026: con el Inventario #122 abierto, al reabrir la
 * app la pantalla de Conteo no mostraba la tarjeta del inventario y volvía a
 * ofrecer "Crear Inventario Físico". La prueba F5 de FASE 12 NO lo detectó
 * porque llamaba a handleAuditSessionChange "a mano": aquí el arranque pasa
 * por las funciones REALES que lo disparan (loadFromCloud de js/45 y
 * subscribeMainDoc de js/50), con sus comparaciones de _lastModified y su
 * filtro por uid, contra Firestore real (emulador) con las reglas aplicadas.
 *
 *   A ★ Arranque de un admin cuyo teléfono tiene lo local MÁS NUEVO, IGUAL o
 *       MÁS VIEJO que la nube: en los tres casos aparece el inventario activo.
 *   B ★ Teléfono y laptop con LA MISMA CUENTA: lo que crea uno lo ve el otro
 *       (subscribeMainDoc ignoraba lo escrito por el mismo uid).
 *   C   Un documento rezagado (sesión más vieja) NO borra el conteo local.
 *   D   Con el inventario CERRADO, el arranque lo muestra cerrado (no "Crear"
 *       sobre uno abierto, ni uno abierto que ya no lo está).
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-arranque-integracion.js"
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
function montar(db, uid, deviceId) {
    const datos = leer('js/45-inventario-datos.js');
    const avisos = [];
    const almacen = { _d: {}, getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
                      setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
    const deps = {
        navigator: { onLine: true }, _db: db, FIRESTORE_DOC_ID: DOC_ID, currentUserUid: uid, currentUserRole: 'admin',
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
        isAdmin: () => true, hasPermission: () => true, puedeOperarArea: () => true, puedeVerConteosAjenos: () => true,
        showNotification: (t) => avisos.push(String(t)),
        showConfirm: (m, cb) => { deps._pendiente = Promise.resolve().then(cb); return deps._pendiente; },
        renderTab() {}, saveToLocalStorage() {}, updateCloudSyncBadge() {}, updateHeaderActions() {},
        switchTab(t) { deps.activeTab = t; },
        _registrarEnSyncQueue() {}, _registrarConflictos() {}, _crearBackupNombrado() {},
        escapeHtml: (s) => String(s), exportToExcelConDatos() {}, _usuariosContando: () => 0,
        // syncToCloud (js/40-firestore.js) y lo que lee
        orders: [], inventories: [], cart: [], activeTab: 'inicio', selectedArea: 'almacen',
        _syncEnabled: true, _syncInProgress: false, _cloudSyncPending: false, _lastCloudSync: 0,
        _syncQueue: [], _catalogoPurgadoEn: null, _haySesionFirebase: () => true, _flushSyncQueueToFirestore: () => Promise.resolve(), _deletedProductIds: [], _mergeArrayByIdPreferLocal: (l) => l, _purgaDeCatalogoVigente: () => false, _logSyncError() {},
        firebase: fb, _auth: { currentUser: { uid: uid, email: uid + '@barra.mx' } },
        localStorage: almacen,
        console: { warn() {}, error: (...a) => { if (process.env.DEPURAR) console.error('[app]', ...a); }, info: (...a) => { if (process.env.DEPURAR) console.error('[app-info]', ...a); }, log() {} },
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
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
        ['_suscribirInventarioActivo', 'handleAuditSessionChange', 'subscribeAllUsersAuditoria', '_abiertasDivergen',
         '_recalcAdminAggregatedConteo', '_obtenerSiguienteNumeroInventario', '_opcNuevoInv', '_areasDelNuevoInventario',
         '_adminIniciarSesionFirestore', 'loadFromCloud'].map(n => extraerFuncion(datos, n)).join('\n') + '\n' +
        opcional(datos, '_reconciliarSesionDesdeDocPrincipal') + '\n' + opcional(datos, '_aplicarReinicioSiCorresponde') + '\n' + extraerFuncion(roles, 'subscribeMainDoc') + '\n' +
        leer('js/40-firestore.js') + '\n' + leer('js/75-auditoria-flujo.js') + '\n' +
        '; return { handleAuditSessionChange, loadFromCloud, subscribeMainDoc, auditoriaResetear, syncToCloud, subscribeAllUsersAuditoria, ' +
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
    api.soltar = function() {
        if (typeof deps._unsubInventarioActivo === 'function') deps._unsubInventarioActivo();
        if (typeof deps._unsubAllUsers === 'function') deps._unsubAllUsers();
        if (typeof deps._unsubMainDoc === 'function') deps._unsubMainDoc();
    };
    return api;
}

async function main() {
    // Comprobación estática: la _applyCloudData real sigue delegando la sesión.
    const aplicar = extraerFuncion(leer('js/45-inventario-datos.js'), '_applyCloudData');
    chk('Base · la _applyCloudData real delega la sesión en handleAuditSessionChange (lo que simula esta prueba)',
        /if \(data\._auditoriaSessionId\) \{\s*[\s\S]{0,900}?handleAuditSessionChange\(\s*data\._auditoriaSessionId/.test(aplicar), '');

    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: leer('firestore.rules'), host: 'localhost', port: 8080 }
    });
    const db = (uid) => testEnv.authenticatedContext(uid || 'jefe').firestore();

    const S = '1790000000000';          // sesión del inventario #122
    const S_VIEJA = '1780000000000';    // una sesión anterior (#121)
    const CLOUD_TS = 1790000005000;

    async function sembrar(estado) {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
            await d.doc(R).set({ _auditoriaSessionId: S, _auditoriaStartedBy: 'jefe', _auditoriaStartedByDeviceId: 'tel-jefe',
                                 _lastModified: CLOUD_TS, _lastWrittenBy: 'jefe',
                                 auditoriaStatus: { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' } });
            await d.doc(R + '/contadores/inventarios').set({ ultimoNumero: 122 });
            await d.doc(R + '/inventories/' + S).set({ inventoryId: S, numero: 122, estado: estado || 'SINCRONIZADO',
                fechaCreacion: 1, semanaId: '2026-09-21', fechaRecuento: '2026-09-27' });
            await d.doc(R + '/userAuditoria/jefe').set({ uid: 'jefe', sessionId: S, isAdmin: true, updatedAt: 1,
                status: { almacen: 'pendiente' }, conteo: { P1: { almacen: { enteras: 6, abiertas: [], _ts: 1 } } } });
        });
    }
    // Un teléfono que ya tenía la sesión restaurada de su almacenamiento local.
    function telefonoReabierto(localTs, uid, dev) {
        const app = montar(db(uid || 'jefe'), uid || 'jefe', dev || 'tel-jefe');
        app.deps._auditoriaSessionId = S;                    // loadFromLocalStorage()
        app.deps.localStorage.setItem('inventarioApp_lastModified', String(localTs));
        return app;
    }
    const visible = (app, estado) => app.deps._inventarioActivo && app.deps._inventarioActivo.numero === 122 &&
                                     app.deps._inventarioActivo.estado === (estado || 'SINCRONIZADO');

    // ── A · Arranque de un admin, con lo local más nuevo / igual / más viejo ──
    for (const caso of [
        ['lo local MÁS NUEVO que la nube (el admin ya contó en este teléfono)', CLOUD_TS + 60000],
        ['lo local IGUAL a la nube', CLOUD_TS],
        ['lo local MÁS VIEJO que la nube', CLOUD_TS - 60000]
    ]) {
        await sembrar();
        const tel = telefonoReabierto(caso[1]);
        await tel.arrancar();
        const ok = await esperarQue(() => visible(tel), 3000);
        chk('★ A · Al reabrir la app con ' + caso[0] + ': aparece el Inventario #122 activo', ok,
            'carga=' + tel.deps._inventarioActivoCarga + ' inventario=' + JSON.stringify(tel.deps._inventarioActivo) + ' aplicaciones=' + tel.deps._applicaciones.length);
        tel.soltar();
    }

    // ── B · Teléfono y laptop con LA MISMA CUENTA ────────────────────────
    await sembrar('CERRADO');
    const tel = telefonoReabierto(CLOUD_TS + 60000, 'jefe', 'tel-jefe');
    tel.deps._inventarioActivo = { numero: 122, estado: 'CERRADO' };
    const lap = montar(db('jefe'), 'jefe', 'laptop-jefe');                 // mismo uid
    lap.deps._auditoriaSessionId = S;
    lap.deps._inventarioActivo = { numero: 122, estado: 'CERRADO' };
    lap.deps.myAuditoriaConteo = { P1: { almacen: { enteras: 6, abiertas: [] } } };
    lap.deps.localStorage.setItem('inventarioApp_lastModified', String(CLOUD_TS + 60000));
    await lap.arrancar();                                                   // la laptop ya está abierta y escuchando
    await tel.crear();                                                      // el teléfono crea el inventario nuevo
    const nuevaS = tel.deps._auditoriaSessionId;
    const okLap = await esperarQue(() => lap.deps._auditoriaSessionId === nuevaS && lap.deps._inventarioActivo && lap.deps._inventarioActivo.numero === 1001, 4000);
    chk('★ B · La laptop (MISMA cuenta) muestra el inventario nuevo #1001 creado desde el teléfono', okLap,
        'sesionLaptop=' + lap.deps._auditoriaSessionId + ' sesionTel=' + nuevaS + ' inv=' + JSON.stringify(lap.deps._inventarioActivo));
    chk('B · …y su conteo local del inventario anterior queda en cero', Object.keys(lap.deps.myAuditoriaConteo || {}).length === 0,
        JSON.stringify(lap.deps.myAuditoriaConteo));
    // La laptop se cierra y se vuelve a abrir: sigue viendo lo mismo.
    const lap2 = montar(db('jefe'), 'jefe', 'laptop-jefe');
    lap2.deps._auditoriaSessionId = nuevaS;
    lap2.deps.localStorage.setItem('inventarioApp_lastModified', String(Date.now() + 60000));
    await lap2.arrancar();
    const okLap2 = await esperarQue(() => lap2.deps._inventarioActivo && lap2.deps._inventarioActivo.numero === 1001 && lap2.deps._inventarioActivo.estado === 'SINCRONIZADO', 3000);
    chk('★ B · Laptop cerrada y reabierta (lo local más nuevo): sigue mostrando #1001 activo', okLap2, JSON.stringify(lap2.deps._inventarioActivo));
    [tel, lap, lap2].forEach(x => x.soltar());

    // ── C · Un documento rezagado no borra el conteo local ───────────────
    await sembrar();
    const reciente = String(Number(S) + 5000000);
    const c = telefonoReabierto(CLOUD_TS - 60000);
    c.deps._auditoriaSessionId = reciente;                   // el teléfono ya estaba en una sesión MÁS nueva
    c.deps.myAuditoriaConteo = { P1: { almacen: { enteras: 9, abiertas: [] } } };
    await c.arrancar();
    chk('C · Un documento con sesión más vieja no hace retroceder la sesión ni borra el conteo local',
        c.deps._auditoriaSessionId === reciente && c.deps.myAuditoriaConteo.P1 && c.deps.myAuditoriaConteo.P1.almacen.enteras === 9,
        c.deps._auditoriaSessionId + ' ' + JSON.stringify(c.deps.myAuditoriaConteo));
    c.soltar();

    // ── D · Inventario cerrado: se muestra cerrado ───────────────────────
    await sembrar('CERRADO');
    const d = telefonoReabierto(CLOUD_TS + 60000);
    await d.arrancar();
    const okD = await esperarQue(() => visible(d, 'CERRADO'), 3000);
    chk('D · Con el inventario CERRADO, al reabrir se muestra cerrado (no se ofrece crear sobre uno abierto)', okD, JSON.stringify(d.deps._inventarioActivo));
    d.soltar();

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones de integración · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
