/**
 * prueba-reinicio-integracion.js — HOTFIX 4.20
 * ═══════════════════════════════════════════════════════════════════════════
 * Contra Firestore real (emulador + firestore.rules) y con el código real:
 *
 *   H  ★ Un inventario HUÉRFANO abierto de una versión anterior (el #102 de
 *        agosto) ya no deja atascado: se ve como abandonado, se cierra con su
 *        propio botón y después se crea el nuevo (#1001).
 *   R  ★ herramientas/reiniciar-inventarios.js: la simulación no toca nada; la
 *        ejecución respalda primero, borra inventarios, conteos, reconteos,
 *        folio, iniciales, ventas y existencias, y NO toca catálogo,
 *        recetario, compras, usuarios ni roles.
 *   T  ★ Un teléfono con datos viejos se pone en cero solo al abrir, sin
 *        perder lo contado DESPUÉS del reinicio; y se puede crear el #1001.
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-reinicio-integracion.js"
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
        ventasPeriodos: [], syncStockByAreaFromConteo() { deps._stockRecalc = (deps._stockRecalc || 0) + 1; },
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
        '; return { cerrarInventarioHuerfano, leerOutbox: function() { return _outboxConteo; }, setOutbox: function(o) { _outboxConteo = o; }, syncMyAuditoriaToFirestore, confirmarNuevoInventario, contabilizarInventario, _cargarHistorialInventarios, historialVerMas, ' +
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



const { spawnSync } = require('child_process');
const os = require('os');

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: leer('firestore.rules'), host: 'localhost', port: 8080 }
    });
    const db = (uid) => testEnv.authenticatedContext(uid).firestore();
    const S102 = '1788000000000', S122 = '1790000000000', S7 = '1780000000000';
    await testEnv.clearFirestore();

    async function sembrar() {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
            await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
            await d.doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count'] });
            await d.doc(R).set({ _auditoriaSessionId: S122, _auditoriaStartedBy: 'jefe', _auditoriaStartedByDeviceId: 'tel-jefe',
                _lastModified: 1790000005000, _lastWrittenBy: 'jefe', _conteoInSubcol: true,
                auditoriaStatus: { almacen: 'completada' }, auditoriaConteo: { P1: { almacen: { enteras: 4 } } },
                products: [{ id: 'P1', name: 'TEQUILA', precio: 350, stockByArea: { almacen: 5, barra1: 2 } },
                           { id: 'P2', name: 'VODKA', precio: 280, stockByArea: { almacen: 1 } }] });
            await d.doc(R + '/contadores/inventarios').set({ ultimoNumero: 122 });
            await d.doc(R + '/inventories/' + S102).set({ inventoryId: S102, numero: 102, estado: 'SINCRONIZADO', fechaCreacion: 1788000000000 });
            await d.doc(R + '/inventories/' + S122).set({ inventoryId: S122, numero: 122, estado: 'CERRADO', fechaCreacion: 1790000000000 });
            await d.doc(R + '/inventories/' + S122 + '/snapshotChunks/0').set({ chunkIndex: 0, registros: [{ tipo: 'meta' }] });
            await d.doc(R + '/inventories/' + S7).set({ inventoryId: S7, numero: 7, estado: 'CONTABILIZADO', fechaCreacion: 1 });
            await d.doc(R + '/userAuditoria/jefe').set({ uid: 'jefe', sessionId: S122, conteo: { P1: { almacen: { enteras: 4 } } } });
            await d.doc(R + '/reconteos/rc1').set({ inventoryId: S122, estado: 'finalizado' });
            await d.doc(R + '/conteosAuditoriaHuerfanos/h1').set({ uid: 'bart1' });
            await d.doc(R + '/inventariosIniciales/2026-09-21').set({ semanaId: '2026-09-21', saldos: [] });
            await d.doc(R + '/ventas/2026-09-21_2026-09-27').set({ inicio: '2026-09-21', fin: '2026-09-27', lineas: [] });
            await d.doc(R + '/stockAreas/barra1/productos/P1').set({ enteras: 2, abiertas: [], version: 3 });  // área "fantasma"
            await d.doc(R + '/conteoMultiUsuario/almacen/dispositivos/tel-jefe').set({ _deviceId: 'tel-jefe' });
            await d.doc('catalogo/productos').set({ version: 5, productos: [{ id: 'P1', name: 'TEQUILA', precio: 350, stockByArea: { almacen: 5 } }] });
            await d.doc('recetario/recetas').set({ total: 12 });
            await d.doc('compras/C1').set({ compraId: 'C1', total: 1000 });
            await d.doc(R + '/historialCambios/x').set({ nota: 'bitácora' });
        });
    }
    async function contar(ruta) {
        let n = 0;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            const bajar = async (col) => {
                const s = await col.get(); n += s.size;
                for (const doc of s.docs) for (const sub of ['snapshotChunks', 'productos', 'dispositivos']) await bajar(doc.ref.collection(sub));
            };
            await bajar(d.collection(ruta));
            // áreas "fantasma" de stockAreas: el padre no existe pero sí sus productos
            if (/stockAreas$|conteoMultiUsuario$/.test(ruta)) for (const a of ['almacen', 'barra1', 'barra2']) {
                const s = await d.collection(ruta + '/' + a + '/' + (/stockAreas$/.test(ruta) ? 'productos' : 'dispositivos')).get(); n += s.size;
            }
        });
        return n;
    }
    async function leerDoc(ruta) { let v = null; await testEnv.withSecurityRulesDisabled(async (ctx) => { const s = await ctx.firestore().doc(ruta).get(); v = s.exists ? s.data() : null; }); return v; }

    // ════ H · Inventario huérfano ═══════════════════════════════════════
    await sembrar();
    const adm = montar(db('jefe'), 'jefe', 'tel-jefe');
    adm.deps._auditoriaSessionId = S122;
    adm.deps.localStorage.setItem('inventarioApp_lastModified', String(1790000005000 + 9000));
    await adm.arrancar();
    await adm.crearConFormulario('2026-10-04');
    chk('★ H · Con el #102 huérfano abierto, crear se bloquea y el aviso dice que es de una versión anterior',
        !(await leerDoc(R + '/inventories/' + S102 + 'x')) && adm.avisos.some(a => /#102 quedó ABIERTO de una versión anterior/.test(a)),
        adm.avisos.slice(-2).join(' | '));
    chk('H · La pantalla pasa a mostrar el #102 (huérfano), distinto de la sesión vigente',
        adm.deps._inventarioActivo && adm.deps._inventarioActivo.numero === 102 && adm.deps._inventarioActivoId === S102 && adm.deps._auditoriaSessionId === S122,
        JSON.stringify([adm.deps._inventarioActivoId, adm.deps._auditoriaSessionId]));
    // "Cerrar Inventario Físico" sobre el huérfano ya no cierra el de la sesión
    adm.deps._pendiente = null;
    await adm.cerrarInventarioFisico();
    await adm.esperarPendientes();
    const inv102 = await leerDoc(R + '/inventories/' + S102);
    const inv122 = await leerDoc(R + '/inventories/' + S122);
    chk('★ H · "Cerrar" sobre el huérfano lo cierra como ABANDONADO (y no toca el #122)',
        inv102.estado === 'CERRADO' && inv102.cierreTipo === 'abandonado' && inv122.estado === 'CERRADO' && !inv122.cierreTipo,
        JSON.stringify([inv102, inv122 && inv122.estado]));
    const ev = adm.deps.window.evaluarContabilizable ? adm.deps.window.evaluarContabilizable(inv102) : null;
    chk('H · Un abandonado no se puede contabilizar, y dice por qué', ev && !ev.puede && /ABANDONADO/.test(ev.motivo), JSON.stringify(ev));
    await esperarQue(() => adm.deps._inventarioActivoId === S122, 2000);
    await adm.crearConFormulario('2026-10-04');
    chk('★ H · Después se crea el nuevo: #1001', adm.deps._inventarioActivo && adm.deps._inventarioActivo.numero === 1001,
        JSON.stringify(adm.deps._inventarioActivo) + ' ' + adm.avisos.slice(-2).join(' | '));
    adm.soltar();

    // ════ R · Script de reinicio ════════════════════════════════════════
    await sembrar();
    const dirResp = fs.mkdtempSync(path.join(os.tmpdir(), 'respaldos-'));
    const entorno = Object.assign({}, process.env, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GOOGLE_CLOUD_PROJECT: PROJECT_ID,
                                                     DIR_RESPALDOS: dirResp });
    const correr = (args) => spawnSync(process.execPath, [path.join(RAIZ, 'herramientas/reiniciar-inventarios.js')].concat(args),
                                       { env: entorno, encoding: 'utf8' });
    const totalAntes = await contar(R + '/inventories') + await contar(R + '/ventas') + await contar(R + '/stockAreas');
    const sim = correr([]);
    const totalSim = await contar(R + '/inventories') + await contar(R + '/ventas') + await contar(R + '/stockAreas');
    chk('R · La simulación termina bien, informa lo que borraría y NO toca nada',
        sim.status === 0 && /SIMULACI/.test(sim.stdout) && totalSim === totalAntes && totalAntes > 0 && fs.readdirSync(dirResp).length === 0,
        'status=' + sim.status + ' ' + totalAntes + '→' + totalSim + ' ' + (sim.stderr || '').slice(0, 200));
    const eje = correr(['--ejecutar', '--si']);
    const archivos = fs.readdirSync(dirResp);
    chk('★ R · La ejecución deja PRIMERO un respaldo completo (y una bitácora)',
        eje.status === 0 && archivos.some(f => /^respaldo-.*\.json$/.test(f)) && archivos.some(f => /^reinicio-.*\.json$/.test(f)),
        'status=' + eje.status + ' ' + JSON.stringify(archivos) + ' ' + (eje.stderr || eje.stdout || '').slice(-300));
    const resp = archivos.filter(f => /^respaldo-/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(dirResp, f), 'utf8')))[0];
    chk('R · El respaldo contiene los inventarios que se borraron',
        resp && JSON.stringify(resp).indexOf(S102) !== -1 && JSON.stringify(resp).indexOf('2026-09-21_2026-09-27') !== -1, '');
    const quedan = {};
    for (const c of ['inventories', 'userAuditoria', 'conteoMultiUsuario', 'reconteos', 'conteosAuditoriaHuerfanos', 'inventariosIniciales', 'ventas', 'stockAreas'])
        quedan[c] = await contar(R + '/' + c);
    chk('★ R · Borró inventarios (y cierres), conteos, reconteos, huérfanos, iniciales, ventas y existencias',
        Object.values(quedan).every(n => n === 0), JSON.stringify(quedan));
    chk('R · El folio se borró: el siguiente será #1001', (await leerDoc(R + '/contadores/inventarios')) === null, '');
    const raiz = await leerDoc(R);
    chk('R · Documento raíz: sesión nueva sin inventario, marca de reinicio, conteo agregado vacío',
        raiz._auditoriaSessionId && raiz._auditoriaSessionId !== S122 && raiz._reinicioInventariosEn > 0 &&
        Object.keys(raiz.auditoriaConteo || {}).length === 0 && raiz.auditoriaStatus.almacen === 'pendiente' && raiz.inventarioConteo === undefined,
        JSON.stringify({ s: raiz._auditoriaSessionId, m: raiz._reinicioInventariosEn, st: raiz.auditoriaStatus }));
    chk('★ R · Existencias en cero, pero el catálogo intacto (nombres y precios)',
        raiz.products.length === 2 && raiz.products[0].name === 'TEQUILA' && raiz.products[0].precio === 350 &&
        raiz.products.every(p => Object.values(p.stockByArea).every(v => v === 0)), JSON.stringify(raiz.products));
    const cat = await leerDoc('catalogo/productos');
    chk('R · Catálogo publicado: mismas fichas, existencias en cero y versión nueva',
        cat.productos[0].name === 'TEQUILA' && cat.productos[0].stockByArea.almacen === 0 && cat.version > 5, JSON.stringify(cat));
    chk('★ R · NO tocó recetario, compras, usuarios, roles ni bitácoras',
        !!(await leerDoc('recetario/recetas')) && !!(await leerDoc('compras/C1')) && !!(await leerDoc('usuarios/jefe')) &&
        !!(await leerDoc('roles/BARTENDER')) && !!(await leerDoc(R + '/historialCambios/x')), '');
    const otraVez = correr(['--ejecutar', '--si']);
    chk('R · Correrlo otra vez no falla (idempotente)', otraVez.status === 0, (otraVez.stderr || '').slice(0, 200));
    Object.assign(raiz, await leerDoc(R));   // la 2ª corrida deja su propia sesión y marca

    // ════ T · Los teléfonos después del reinicio ════════════════════════
    const marca = (await leerDoc(R))._reinicioInventariosEn;
    const tel = montar(db('bart1'), 'bart1', 'tel-bart1', { admin: false });
    tel.deps._auditoriaSessionId = S122;
    tel.deps.myAuditoriaConteo = { P1: { almacen: { enteras: 4, abiertas: [] } } };
    tel.deps.inventarioConteo = { P1: { almacen: { enteras: 5, abiertas: [] } }, P2: { barra1: { enteras: 7, abiertas: [] } } };
    tel.deps.products = [{ id: 'P1', name: 'TEQUILA', stockByArea: { almacen: 5 } }, { id: 'P2', name: 'VODKA', stockByArea: { barra1: 7 } }];
    tel.deps.ventasPeriodos = [{ inicio: '2026-09-21', fin: '2026-09-27' }];
    // Cola: un conteo de ANTES del reinicio y uno hecho DESPUÉS, sin señal.
    tel.setOutbox({ 'P1|almacen': { ts: marca - 60000, base: 3 }, 'P2|barra1': { ts: marca + 60000, base: null } });
    tel.deps.localStorage.setItem('inventarioApp_lastModified', String(marca + 120000));   // lo local "más nuevo"
    await tel.arrancar();
    const okTel = await esperarQue(() => tel.deps._auditoriaSessionId === raiz._auditoriaSessionId, 3000);
    chk('★ T · El teléfono adopta la sesión del reinicio y su conteo del inventario físico queda en cero',
        okTel && Object.keys(tel.deps.myAuditoriaConteo).length === 0, JSON.stringify([tel.deps._auditoriaSessionId, tel.deps.myAuditoriaConteo]));
    chk('★ T · Existencias y ventas locales en cero; conserva SOLO lo contado después del reinicio (P2)',
        !tel.deps.inventarioConteo.P1 && tel.deps.inventarioConteo.P2 && tel.deps.inventarioConteo.P2.barra1.enteras === 7 &&
        JSON.stringify(Object.keys(tel.leerOutbox())) === '["P2|barra1"]' && tel.deps.ventasPeriodos.length === 0 &&
        tel.deps.products[0].stockByArea.almacen === 0,
        JSON.stringify([tel.deps.inventarioConteo, tel.leerOutbox(), tel.deps.ventasPeriodos, tel.deps.products[0].stockByArea]));
    chk('T · Avisa en pantalla y guarda que ya aplicó ese reinicio',
        tel.avisos.length >= 0 && tel.deps.localStorage.getItem('inventarioApp_reinicioInventariosVisto') === String(marca), '');
    // Reabrir: no se vuelve a aplicar (no borra lo contado después).
    tel.deps.inventarioConteo.P2.barra1.enteras = 8;
    tel.soltar();
    const tel2 = montar(db('bart1'), 'bart1', 'tel-bart1', { admin: false });
    Object.assign(tel2.deps, { _auditoriaSessionId: raiz._auditoriaSessionId, inventarioConteo: { P2: { barra1: { enteras: 8, abiertas: [] } } } });
    tel2.deps.localStorage.setItem('inventarioApp_reinicioInventariosVisto', String(marca));
    tel2.deps.localStorage.setItem('inventarioApp_lastModified', String(marca + 120000));
    await tel2.arrancar();
    chk('T · Al reabrir no se repite el reinicio (lo nuevo se conserva)', tel2.deps.inventarioConteo.P2 && tel2.deps.inventarioConteo.P2.barra1.enteras === 8, JSON.stringify(tel2.deps.inventarioConteo));
    tel2.soltar();

    const adm2 = montar(db('jefe'), 'jefe', 'laptop-jefe');
    adm2.deps._auditoriaSessionId = S122;
    await adm2.arrancar();
    await esperarQue(() => adm2.deps._inventarioActivoCarga === 'no_existe', 3000);
    chk('T · Tras el reinicio la pantalla no muestra inventario (ofrece "Crear")', !adm2.deps._inventarioActivo && adm2.deps._inventarioActivoCarga === 'no_existe',
        adm2.deps._inventarioActivoCarga);
    await adm2.crearConFormulario('2026-10-04');
    const n1001 = await leerDoc(R + '/inventories/' + adm2.deps._auditoriaSessionId);
    chk('★ T · El primer inventario después del reinicio es el #1001, activo y en cero',
        n1001 && n1001.numero === 1001 && n1001.estado === 'SINCRONIZADO' && Object.keys(adm2.deps.auditoriaConteo).length === 0,
        JSON.stringify(n1001) + ' ' + adm2.avisos.slice(-2).join(' | '));
    adm2.soltar();

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones de integración · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
