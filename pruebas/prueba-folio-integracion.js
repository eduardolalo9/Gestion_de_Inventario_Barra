/**
 * prueba-folio-integracion.js — FASE 12: folio consecutivo, anti-solapamiento
 * y el mismo inventario en todos los dispositivos.
 * ═══════════════════════════════════════════════════════════════════════════
 * Contra Firestore REAL (emulador) con firestore.rules aplicadas y con el
 * código REAL de la app (js/40-firestore.js y js/75-auditoria-flujo.js
 * completos, más las funciones de sesión de js/45-inventario-datos.js).
 * Cada "dispositivo" es una instancia separada del código, con su propia
 * memoria, como un teléfono y una laptop reales.
 *
 *   F1 ★ El primer folio es #1001 y el siguiente #1002 (también desde un
 *        contador anterior, #7 → #1001).
 *   F2 ★ Al crear, todas las áreas y todos los usuarios quedan en cero.
 *   F3 ★ Con un inventario ACTIVO no se crea otro — ni saltándose la
 *        pantalla (lo rechaza el servidor), ni con dos admins a la vez.
 *   F4 ★ Una laptop desfasada ya no regresa el servidor al inventario
 *        anterior al sincronizar.
 *   F5 ★ Un teléfono reiniciado y una laptop recién abierta ven el mismo
 *        inventario.
 *   F6   Un conteo viejo que llega tarde no aparece en el inventario nuevo.
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-folio-integracion.js"
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
        requestAnimationFrame: (f) => f(), setTimeout: setTimeout, clearTimeout: clearTimeout
    };
    deps.window = deps;
    const codigo =
        extraerFuncion(leer('js/00-nucleo.js'), 'estadoAreasVacio') + '\n' +
        extraerFuncion(leer('js/10-multiusuario.js'), 'inventarioAbierto') + '\n' +
        leer('js/15-ciclo-semanal.js') + '\n' +
        leer('js/46-arrastre.js') + '\n' +   // FASE 14
        ['_suscribirInventarioActivo', 'handleAuditSessionChange', 'subscribeAllUsersAuditoria', '_abiertasDivergen',
         '_recalcAdminAggregatedConteo', '_obtenerSiguienteNumeroInventario', '_opcNuevoInv', '_areasDelNuevoInventario',
         '_adminIniciarSesionFirestore'].map(n => extraerFuncion(datos, n)).join('\n') + '\n' +
        leer('js/40-firestore.js') + '\n' + leer('js/75-auditoria-flujo.js') + '\n' +
        '; return { handleAuditSessionChange, auditoriaResetear, syncToCloud, subscribeAllUsersAuditoria, ' +
        '           _obtenerSiguienteNumeroInventario, _adminIniciarSesionFirestore, cerrarInventarioFisico: (typeof cerrarInventarioFisico === "function" ? cerrarInventarioFisico : null) };';
    const api = new Function('deps', 'with (deps) {\n' + codigo + '\n}')(deps);
    api.deps = deps; api.avisos = avisos;
    api.crear = async function() {
        deps._pendiente = null;
        api.auditoriaResetear();
        for (let i = 0; i < 6 && deps._pendiente; i++) { const p = deps._pendiente; deps._pendiente = null; await p; }
        await esperar(250);
    };
    api.soltar = function() {
        if (typeof deps._unsubInventarioActivo === 'function') deps._unsubInventarioActivo();
        if (typeof deps._unsubAllUsers === 'function') deps._unsubAllUsers();
    };
    return api;
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: leer('firestore.rules'), host: 'localhost', port: 8080 }
    });
    const dbAdmin = () => testEnv.authenticatedContext('jefe').firestore();

    // Base: un inventario anterior (#7) ya CERRADO, con conteos de dos personas.
    async function sembrar(opts) {
        opts = opts || {};
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
            await d.doc('usuarios/jefe2').set({ uid: 'jefe2', role: 'ADMIN', status: 'activo' });
            await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
            await d.doc(R).set({ _auditoriaSessionId: 'S7', _auditoriaStartedBy: 'jefe', _lastModified: 1,
                                 auditoriaStatus: { almacen: 'completada', barra1: 'completada', barra2: 'completada' } });
            if (opts.contador !== null) await d.doc(R + '/contadores/inventarios').set({ ultimoNumero: opts.contador === undefined ? 7 : opts.contador });
            await d.doc(R + '/inventories/S7').set({ inventoryId: 'S7', numero: 7, estado: opts.estadoS7 || 'CERRADO',
                fechaCreacion: 1, semanaId: '2026-09-21', fechaRecuento: '2026-09-27' });
            const conteo = { P1: { almacen: { enteras: 12, abiertas: [0.5], _ts: 1 }, barra1: { enteras: 3, abiertas: [], _ts: 1 } } };
            await d.doc(R + '/userAuditoria/jefe').set({ uid: 'jefe', sessionId: 'S7', isAdmin: true, updatedAt: 1,
                status: { almacen: 'completada', barra1: 'completada', barra2: 'completada' }, conteo: conteo });
            await d.doc(R + '/userAuditoria/bart1').set({ uid: 'bart1', sessionId: 'S7', isAdmin: false, updatedAt: 1,
                status: { almacen: 'completada', barra1: 'completada', barra2: 'completada' }, conteo: conteo });
            for (let i = 2; i < 2 + (opts.masPersonas || 0); i++) {
                await d.doc(R + '/userAuditoria/bart' + i).set({ uid: 'bart' + i, sessionId: 'S7', isAdmin: false, updatedAt: 1,
                    status: { almacen: 'completada' }, conteo: conteo });
            }
        });
    }
    async function servidor() {
        let r = {};
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            const p = (await d.doc(R).get()).data() || {};
            const ua = await d.collection(R + '/userAuditoria').get();
            const invs = await d.collection(R + '/inventories').get();
            const cont = await d.doc(R + '/contadores/inventarios').get();
            r = {
                sesion: p._auditoriaSessionId, status: p.auditoriaStatus || {}, conteoAgregado: p.auditoriaConteo,
                ua: ua.docs.map(x => ({ id: x.id, sesion: x.data().sessionId, n: Object.keys(x.data().conteo || {}).length })),
                invs: invs.docs.map(x => ({ id: x.id, numero: x.data().numero, estado: x.data().estado })),
                abiertos: invs.docs.filter(x => x.data().estado === 'SINCRONIZADO').length,
                contador: cont.exists ? cont.data().ultimoNumero : null
            };
        });
        return r;
    }
    // Deja al "teléfono" como el administrador que ya estaba en el inventario #7.
    function telefono(uid) {
        // Cada administrador con SU propia sesión de Firebase.
        const app = montar(testEnv.authenticatedContext(uid || 'jefe').firestore(), uid || 'jefe', 'tel-' + (uid || 'jefe'));
        app.deps._auditoriaSessionId = 'S7';
        app.deps._inventarioActivo = { numero: 7, estado: 'CERRADO' };
        return app;
    }

    console.log('\n  ── FASE 12 · folio, anti-solapamiento y mismo inventario en todos los dispositivos ──\n');

    // ── F1 · Folio consecutivo desde #1001 ────────────────────────────────
    await sembrar({ contador: 7 });
    let tel = telefono();
    await tel.crear();
    let s = await servidor();
    const inv1 = s.invs.find(x => x.id === s.sesion) || {};
    chk('★ F1 · Desde un contador anterior (#7), el nuevo folio es #1001', inv1.numero === 1001 && s.contador === 1001, JSON.stringify(s.invs) + ' contador=' + s.contador);
    chk('F1 · …y el aviso lo dice', tel.avisos.some(a => /#1001/.test(a)), JSON.stringify(tel.avisos));
    // Se cierra y se crea el siguiente: #1002
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc(R + '/inventories/' + s.sesion).update({ estado: 'CERRADO' });
    });
    tel.deps._inventarioActivo = Object.assign({}, tel.deps._inventarioActivo || {}, { estado: 'CERRADO', numero: 1001 });
    await tel.crear();
    s = await servidor();
    const inv2 = s.invs.find(x => x.id === s.sesion) || {};
    chk('★ F1 · El siguiente es #1002 (consecutivo, sin repetir)', inv2.numero === 1002 && s.contador === 1002, JSON.stringify(s.invs));
    chk('F1 · Ningún folio repetido', new Set(s.invs.map(x => x.numero)).size === s.invs.length, JSON.stringify(s.invs));
    tel.soltar();

    await sembrar({ contador: null });
    tel = telefono(); await tel.crear(); s = await servidor();
    chk('F1 · Sin contador previo (base nueva), el primer folio también es #1001',
        (s.invs.find(x => x.id === s.sesion) || {}).numero === 1001, JSON.stringify(s.invs));
    tel.soltar();

    // Reglas: el contador solo avanza de uno en uno (ni atrás ni saltos)
    await sembrar({ contador: 1005 });
    const cont = dbAdmin().doc(R + '/contadores/inventarios');
    let atras = true, salto = true, uno = false;
    try { await cont.set({ ultimoNumero: 1003 }); atras = false; } catch (_) {}
    try { await cont.set({ ultimoNumero: 1010 }); salto = false; } catch (_) {}
    try { await cont.set({ ultimoNumero: 1006 }); uno = true; } catch (_) {}
    chk('★ F1 · El servidor no deja regresar ni saltar el contador (solo +1)', atras && salto && uno, 'atras=' + atras + ' salto=' + salto + ' +1=' + uno);
    let invInventado = true;
    try {
        await dbAdmin().doc(R + '/inventories/falso').set({ inventoryId: 'falso', numero: 1003, estado: 'SINCRONIZADO' });
        invInventado = false;
    } catch (_) {}
    chk('★ F1 · Un inventario con un folio que no es el del contador se rechaza (no hay duplicados)', invInventado, '');

    // ── F2 · Todo en cero al crear ────────────────────────────────────────
    await sembrar();
    tel = telefono();
    tel.deps.myAuditoriaConteo = { P1: { almacen: { enteras: 12, abiertas: [0.5] } } };
    tel.deps.auditoriaConteo = { P1: { almacen: { enteras: 12, abiertas: [0.5] } } };
    tel.deps.auditoriaStatus = { almacen: 'completada', barra1: 'completada', barra2: 'completada' };
    await tel.crear();
    s = await servidor();
    chk('★ F2 · En el servidor: el conteo agregado queda vacío y las tres áreas "pendiente"',
        JSON.stringify(s.conteoAgregado) === '{}' && ['almacen', 'barra1', 'barra2'].every(a => s.status[a] === 'pendiente'), JSON.stringify(s));
    chk('★ F2 · Los conteos de los demás usuarios se borran y el del admin queda en cero',
        s.ua.length === 1 && s.ua[0].id === 'jefe' && s.ua[0].n === 0 && s.ua[0].sesion === s.sesion, JSON.stringify(s.ua));
    chk('F2 · En el teléfono también: conteo propio, agregado y estados en cero',
        Object.keys(tel.deps.myAuditoriaConteo).length === 0 && Object.keys(tel.deps.auditoriaConteo).length === 0 &&
        Object.values(tel.deps.auditoriaStatus).every(v => v === 'pendiente'), JSON.stringify(tel.deps.auditoriaStatus));
    chk('★ F2 · Al crear, la app se queda en la primera pantalla de Conteo',
        tel.deps.activeTab === 'inventario' && tel.deps.auditoriaView === 'selection', tel.deps.activeTab + '/' + tel.deps.auditoriaView);
    await esperarQue(() => tel.deps._inventarioActivo && tel.deps._inventarioActivo.numero === 1001);
    chk('F2 · …mostrando el inventario nuevo (#1001, activo)',
        tel.deps._inventarioActivo && tel.deps._inventarioActivo.numero === 1001 && tel.deps._inventarioActivo.estado === 'SINCRONIZADO',
        JSON.stringify(tel.deps._inventarioActivo));
    tel.soltar();

    // Un turno real: muchas personas contaron el inventario anterior. Crear el
    // siguiente borra TODOS sus conteos en la misma escritura; las reglas nuevas
    // no pueden hacer que eso falle por exceso de lecturas del servidor.
    await sembrar({ masPersonas: 12 });
    tel = telefono(); await tel.crear(); s = await servidor();
    chk('★ F2 · Con 14 personas en el inventario anterior, crear funciona y deja solo el conteo del admin, en cero',
        (s.invs.find(x => x.id === s.sesion) || {}).numero === 1001 && s.ua.length === 1 && s.ua[0].n === 0,
        JSON.stringify({ sesion: s.sesion, ua: s.ua.length, avisos: tel.avisos }));
    tel.soltar();

    // ── F3 · Anti-solapamiento ────────────────────────────────────────────
    await sembrar({ estadoS7: 'SINCRONIZADO' });   // #7 sigue ACTIVO
    tel = telefono();
    tel.deps._inventarioActivo = null;             // la pantalla "no sabe"
    await tel.crear();
    s = await servidor();
    chk('★ F3 · Con #7 activo, crear se niega y no se borra ningún conteo',
        s.sesion === 'S7' && s.abiertos === 1 && s.ua.length === 2, JSON.stringify(s));
    // Saltándose la pantalla: la escritura directa la rechaza el SERVIDOR
    let rechazado = false;
    try {
        const n = await tel._obtenerSiguienteNumeroInventario();
        await tel._adminIniciarSesionFirestore('SX', n);
    } catch (e) { rechazado = /permission|PERMISSION/.test(String(e && (e.code || e.message))); }
    s = await servidor();
    chk('★ F3 · Aunque se salte la pantalla, el servidor rechaza otro inventario mientras #7 está activo',
        rechazado && s.sesion === 'S7' && s.abiertos === 1 && s.ua.length === 2, 'rechazado=' + rechazado + ' ' + JSON.stringify(s));
    tel.soltar();

    // Dos administradores a la vez (#7 cerrado): solo uno crea
    await sembrar();
    const a = telefono('jefe'), b = telefono('jefe2');
    const [na, nb] = [await a._obtenerSiguienteNumeroInventario(), await b._obtenerSiguienteNumeroInventario()];
    const res = await Promise.allSettled([a._adminIniciarSesionFirestore('SA' + Date.now(), na),
                                          b._adminIniciarSesionFirestore('SB' + Date.now(), nb)]);
    if (process.env.DEPURAR) console.error('[carrera]', na, nb, res.map(r => r.status === 'rejected' ? String(r.reason && (r.reason.code + ' ' + r.reason.message)).slice(0, 300) : 'ok'));
    s = await servidor();
    chk('★ F3 · Dos administradores creando a la vez: queda UN solo inventario activo',
        s.abiertos === 1 && res.filter(r => r.status === 'fulfilled').length === 1, JSON.stringify(res.map(r => r.status)) + ' ' + JSON.stringify(s.invs));
    a.soltar(); b.soltar();

    // ── F4 · La laptop desfasada ya no regresa al inventario anterior ────
    await sembrar();
    tel = telefono();
    const lap = montar(dbAdmin(), 'jefe', 'laptop');
    lap.deps._auditoriaSessionId = 'S7';           // se quedó abierta en el #7
    lap.deps.auditoriaStatus = { almacen: 'completada', barra1: 'completada', barra2: 'completada' };
    await tel.crear();
    const nueva = (await servidor()).sesion;
    // La laptop toca algo ANTES de enterarse (o su reloj va adelantado): su
    // cambio local es "más nuevo" que el del servidor y sincroniza.
    lap.deps.localStorage.setItem('inventarioApp_lastModified', String(Date.now() + 60000));
    lap.deps._syncInProgress = false;
    await lap.syncToCloud();
    await esperar(200);
    s = await servidor();
    chk('★ F4 · Tras sincronizar la laptop, el servidor SIGUE en el inventario nuevo (#1001)',
        s.sesion === nueva && (s.invs.find(x => x.id === s.sesion) || {}).numero === 1001, 'sesion=' + s.sesion + ' esperada=' + nueva);
    chk('★ F4 · …y las áreas del inventario nuevo siguen "pendiente" (la laptop no las marca completadas)',
        ['almacen', 'barra1', 'barra2'].every(ar => s.status[ar] === 'pendiente'), JSON.stringify(s.status));
    // Una escritura vieja directa (versión anterior de la app) también se rechaza
    let viejaRechazada = false;
    try { await dbAdmin().doc(R).set({ _auditoriaSessionId: 'S7', _lastModified: Date.now() }, { merge: true }); }
    catch (_) { viejaRechazada = true; }
    chk('★ F4 · El servidor rechaza que cualquier copia vieja regrese la sesión a #7', viejaRechazada && (await servidor()).sesion === nueva, '');

    // ── F5 · Teléfono reiniciado y laptop recién abierta ─────────────────
    // Teléfono reiniciado: la sesión se restaura de su almacenamiento local.
    const telReinicio = montar(dbAdmin(), 'jefe', 'tel-jefe');
    telReinicio.deps._auditoriaSessionId = nueva;
    telReinicio.handleAuditSessionChange(nueva, 'applyCloudData', 'jefe', 'tel-jefe');
    // Laptop recién abierta: sin nada local; la sesión llega del servidor.
    const lapNueva = montar(dbAdmin(), 'jefe', 'laptop-2');
    lapNueva.handleAuditSessionChange(nueva, 'applyCloudData', 'jefe', 'tel-jefe');
    // La laptop desfasada, cuando por fin recibe el cambio:
    lap.handleAuditSessionChange(nueva, 'applyCloudData', 'jefe', 'tel-jefe');
    const ok3 = await esperarQue(() => [telReinicio, lapNueva, lap].every(x => x.deps._inventarioActivo && x.deps._inventarioActivo.numero === 1001));
    chk('★ F5 · Teléfono reiniciado, laptop nueva y laptop desfasada muestran el MISMO inventario (#1001, activo)',
        ok3 && [telReinicio, lapNueva, lap].every(x => x.deps._inventarioActivo.estado === 'SINCRONIZADO' && x.deps._auditoriaSessionId === nueva),
        JSON.stringify([telReinicio, lapNueva, lap].map(x => [x.deps._auditoriaSessionId, x.deps._inventarioActivo && x.deps._inventarioActivo.numero])));
    chk('F5 · La laptop desfasada vacía su conteo local del inventario anterior',
        Object.keys(lap.deps.myAuditoriaConteo || {}).length === 0, JSON.stringify(lap.deps.myAuditoriaConteo));
    [tel, lap, telReinicio, lapNueva].forEach(x => x.soltar());

    // ── F6 · Un conteo viejo que llega tarde no aparece en el nuevo ──────
    const admin = montar(dbAdmin(), 'jefe', 'tel-jefe');
    admin.deps._auditoriaSessionId = nueva;
    admin.subscribeAllUsersAuditoria();
    // El bartender estaba sin señal: su teléfono sube su conteo del #7 tarde.
    await testEnv.authenticatedContext('bart1').firestore().doc(R + '/userAuditoria/bart1').set({
        uid: 'bart1', sessionId: 'S7', isAdmin: false, updatedAt: Date.now(),
        status: { almacen: 'completada' }, conteo: { P1: { almacen: { enteras: 12, abiertas: [0.5], _ts: 1 } } }
    }).catch(() => {});
    await esperar(600);
    chk('★ F6 · El conteo del #7 que llegó tarde NO aparece en el inventario nuevo (sigue en cero)',
        !admin.deps.allUsersAuditoria.bart1 && !(admin.deps.auditoriaConteo.P1 && admin.deps.auditoriaConteo.P1.almacen && admin.deps.auditoriaConteo.P1.almacen.enteras),
        JSON.stringify(admin.deps.auditoriaConteo));
    admin.soltar();

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones de integración · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
