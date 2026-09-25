/**
 * prueba-sesion-integracion.js — El inventario abierto no se pierde al
 * reabrir la app, y crear uno nuevo no puede vaciar sus conteos.
 * ═══════════════════════════════════════════════════════════════════════════
 * Contra Firestore REAL (emulador) con firestore.rules aplicadas, y con el
 * código REAL de la app: js/75-auditoria-flujo.js y js/40-firestore.js
 * completos, más las funciones de sesión de js/45-inventario-datos.js y
 * inventarioAbierto() de js/10-multiusuario.js.
 *
 * EL DEFECTO (visto en producción el 25-sep-2026, versión 4.7):
 *   Con un inventario abierto y las tres áreas contadas, Conteo mostraba
 *   "Crear Inventario Físico" en vez del inventario, y no ofrecía ni
 *   "Cerrar" ni "Contabilizar". Causa: al abrir la app la sesión se restaura
 *   de localStorage; la que llega de Firestore es la misma y
 *   handleAuditSessionChange() salía por "sin cambio" SIN suscribirse al
 *   inventario. Y la única barrera contra borrar esos conteos era esa misma
 *   variable en memoria.
 *
 *   S1  ★ Reabrir la app con la sesión ya guardada engancha el inventario.
 *   S2  ★ Aunque la pantalla crea que no hay inventario, crear uno nuevo se
 *       niega y NO borra ningún conteo (lo decide el servidor).
 *   S3  ★ Si no se puede consultar el servidor, tampoco se borra nada.
 *   S4  Con el inventario CERRADO, crear el siguiente sí funciona (la guarda
 *       no bloquea de más).
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-sesion-integracion.js"
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

function montar(db, uid) {
    const datos = leer('js/45-inventario-datos.js');
    const avisos = [];
    const deps = {
        navigator: { onLine: true }, _db: db, FIRESTORE_DOC_ID: DOC_ID, currentUserUid: uid,
        _deviceId: 'disp-' + uid, AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
        areasAuditoria: { almacen: 'Almacén', barra1: 'Barra Restaurante', barra2: 'Barra Bar' },
        areasAuditoriaFA: {}, areasAuditoriaIcons: {},
        products: [{ id: 'P1', name: 'TEQUILA', unit: 'PZA', group: 'Tequila' }],
        myAuditoriaConteo: {}, myAuditoriaStatus: {}, myAuditoriaUnlocks: {}, myAuditoriaFinalizadas: {},
        auditoriaStatus: {}, auditoriaConteo: {}, auditoriaConteoPorUsuario: {}, allUsersAuditoria: {},
        inventarioConteo: {}, auditoriaView: 'selection', auditoriaAreaActiva: null, isAuditoriaMode: false,
        // Estado de un teléfono que ACABA DE ABRIR la app: la sesión viene de
        // localStorage, el inventario todavía no se ha leído.
        _auditoriaSessionId: null, _inventarioActivo: null,
        _unsubInventarioActivo: null, _inventarioActivoId: null, _inventarioActivoCarga: 'sin_sesion',
        _historialInventarios: null, _authzState: { roleId: 'ADMIN' },
        auditCurrentUser: { userId: uid, userName: uid },
        isAdmin: () => true, hasPermission: () => true, puedeOperarArea: () => true, puedeVerConteosAjenos: () => true,
        showNotification: (t) => avisos.push(String(t)),
        // Todas las confirmaciones se aceptan: se prueba lo que hace la app
        // cuando el administrador DICE QUE SÍ, que es el caso peligroso.
        showConfirm: (m, cb) => { deps._pendiente = Promise.resolve().then(cb); return deps._pendiente; },
        renderTab() {}, saveToLocalStorage() {}, updateCloudSyncBadge() {},
        _registrarEnSyncQueue() {}, _registrarConflictos() {}, _crearBackupNombrado() {},
        escapeHtml: (s) => String(s), exportToExcelConDatos() {}, _usuariosContando: () => 0,
        firebase: fb, _auth: { currentUser: { uid: uid, email: uid + '@barra.mx' } },
        localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
        console: { warn() {}, error() {}, info() {}, log() {} },
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
        extraerFuncion(datos, '_suscribirInventarioActivo') + '\n' +
        extraerFuncion(datos, 'handleAuditSessionChange') + '\n' +
        extraerFuncion(datos, '_obtenerSiguienteNumeroInventario') + '\n' +
        extraerFuncion(datos, '_opcNuevoInv') + '\n' +
        extraerFuncion(datos, '_areasDelNuevoInventario') + '\n' +
        extraerFuncion(datos, '_adminIniciarSesionFirestore') + '\n' +
        leer('js/40-firestore.js') + '\n' + leer('js/75-auditoria-flujo.js') + '\n' +
        // Sin nombrar funciones nuevas: así la prueba corre también contra el
        // código anterior y demuestra qué fallaba.
        '; return { handleAuditSessionChange, auditoriaResetear };';
    const api = new Function('deps', 'with (deps) {\n' + codigo + '\n}')(deps);
    api.deps = deps; api.avisos = avisos;
    // Lanza la creación y espera a que la cadena de confirmaciones termine.
    api.crear = async function() {
        deps._pendiente = null;
        api.auditoriaResetear();
        for (let i = 0; i < 5 && deps._pendiente; i++) {
            const p = deps._pendiente; deps._pendiente = null; await p;
        }
        await esperar(300);
    };
    return api;
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: leer('firestore.rules'), host: 'localhost', port: 8080 }
    });

    async function sembrar(estadoInv) {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
            await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
            await d.doc(R).set({ _auditoriaSessionId: 'S1', _auditoriaStartedBy: 'jefe', _lastModified: 1 });
            await d.doc(R + '/contadores/inventarios').set({ ultimoNumero: 7 });
            await d.doc(R + '/inventories/S1').set({ inventoryId: 'S1', numero: 7, estado: estadoInv,
                fechaCreacion: 1, semanaId: '2026-09-21', fechaRecuento: '2026-09-27' });
            // Las tres áreas contadas por dos personas, como en la captura.
            const conteo = { P1: { almacen: { enteras: 12, abiertas: [], _ts: 1 }, barra1: { enteras: 3, abiertas: [0.5], _ts: 1 } } };
            await d.doc(R + '/userAuditoria/jefe').set({ uid: 'jefe', sessionId: 'S1', isAdmin: true, updatedAt: 1,
                status: { almacen: 'completada', barra1: 'completada', barra2: 'completada' }, conteo: conteo });
            await d.doc(R + '/userAuditoria/bart1').set({ uid: 'bart1', sessionId: 'S1', isAdmin: false, updatedAt: 1,
                status: { almacen: 'completada', barra1: 'completada', barra2: 'completada' }, conteo: conteo });
        });
    }
    async function leerServidor() {
        let r = {};
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            const principal = await d.doc(R).get();
            const ua = await d.collection(R + '/userAuditoria').get();
            const invs = await d.collection(R + '/inventories').get();
            r = {
                sesion: principal.data()._auditoriaSessionId,
                conteos: ua.docs.filter(x => Object.keys((x.data() || {}).conteo || {}).length > 0).map(x => x.id).sort(),
                inventarios: invs.docs.map(x => x.id + ':' + x.data().estado).sort()
            };
        });
        return r;
    }

    console.log('\n  ── Sesión e inventario activo contra Firestore real ──\n');

    // ── S1 · Reabrir la app ────────────────────────────────────────────────
    await sembrar('SINCRONIZADO');
    let app = montar(testEnv.authenticatedContext('jefe').firestore(), 'jefe');
    app.deps._auditoriaSessionId = 'S1';                 // restaurada de localStorage
    const r1 = app.handleAuditSessionChange('S1', 'applyCloudData', 'jefe', 'otro-dispositivo');
    await esperar(600);
    chk('Reabrir con la misma sesión no reprocesa nada (no borra el conteo local)',
        r1 && r1.procesado === false && r1.motivo === 'sin_cambio', JSON.stringify(r1));
    chk('★ S1 · …pero ahora SÍ engancha el inventario abierto (#7)',
        app.deps._inventarioActivo && app.deps._inventarioActivo.numero === 7 &&
        app.deps._inventarioActivo.estado === 'SINCRONIZADO', JSON.stringify(app.deps._inventarioActivo));
    chk('El estado de carga pasa a "ok"', app.deps._inventarioActivoCarga === 'ok', app.deps._inventarioActivoCarga);
    if (typeof app.deps._unsubInventarioActivo === 'function') app.deps._unsubInventarioActivo();

    // ── S2 · La pantalla no sabe del inventario, el administrador pulsa "Crear" ─
    await sembrar('SINCRONIZADO');
    app = montar(testEnv.authenticatedContext('jefe').firestore(), 'jefe');
    app.deps._auditoriaSessionId = 'S1';
    app.deps._inventarioActivo = null;                   // lo que veía la 4.7 tras reabrir
    await app.crear();
    const s2 = await leerServidor();
    chk('★ S2 · Crear se niega: la sesión sigue siendo la del inventario abierto',
        s2.sesion === 'S1', JSON.stringify(s2));
    chk('★ S2 · Los conteos de las dos personas siguen intactos',
        JSON.stringify(s2.conteos) === JSON.stringify(['bart1', 'jefe']), JSON.stringify(s2.conteos));
    chk('S2 · No se creó ningún inventario nuevo',
        JSON.stringify(s2.inventarios) === JSON.stringify(['S1:SINCRONIZADO']), JSON.stringify(s2.inventarios));
    chk('S2 · Avisa por qué, con el número del inventario abierto',
        app.avisos.some(a => /#7 sigue ABIERTO/.test(a) && /No se borró nada/.test(a)), JSON.stringify(app.avisos));
    await esperar(300);
    chk('S2 · Y engancha la pantalla a ese inventario',
        app.deps._inventarioActivo && app.deps._inventarioActivo.numero === 7, JSON.stringify(app.deps._inventarioActivo));
    if (typeof app.deps._unsubInventarioActivo === 'function') app.deps._unsubInventarioActivo();

    // ── S3 · Sin poder consultar el servidor ─────────────────────────────
    await sembrar('SINCRONIZADO');
    app = montar(testEnv.authenticatedContext('jefe').firestore(), 'jefe');
    app.deps._auditoriaSessionId = 'S1';
    const dbReal = app.deps._db;
    // Un _db cuya lectura falla (sin red a medias, servidor caído…).
    app.deps._db = { collection: () => ({ doc: () => ({ get: () => Promise.reject(new Error('unavailable')),
                     collection: () => ({ doc: () => ({ get: () => Promise.reject(new Error('unavailable')) }) }) }) }) };
    await app.crear();
    app.deps._db = dbReal;
    const s3 = await leerServidor();
    chk('★ S3 · Si no se puede consultar el servidor, no se borra nada',
        s3.sesion === 'S1' && s3.conteos.length === 2, JSON.stringify(s3));
    chk('S3 · …y lo dice', app.avisos.some(a => /No se pudo comprobar en el servidor/.test(a)), JSON.stringify(app.avisos));

    // ── S4 · Inventario CERRADO: crear el siguiente funciona ──────────────
    await sembrar('CERRADO');
    app = montar(testEnv.authenticatedContext('jefe').firestore(), 'jefe');
    app.deps._auditoriaSessionId = 'S1';
    await app.crear();
    await esperar(400);
    const s4 = await leerServidor();
    chk('S4 · Con el inventario cerrado, se crea el siguiente (#8)',
        s4.sesion !== 'S1' && s4.inventarios.some(x => /:SINCRONIZADO$/.test(x)) && s4.inventarios.indexOf('S1:CERRADO') !== -1,
        JSON.stringify(s4) + ' ' + JSON.stringify(app.avisos));
    if (typeof app.deps._unsubInventarioActivo === 'function') app.deps._unsubInventarioActivo();

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones de integración · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
