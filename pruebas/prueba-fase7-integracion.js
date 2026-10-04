/**
 * prueba-fase7-integracion.js — FASE 7 (seguridad) contra Firestore REAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Las reglas nuevas de FASE 7 son más estrictas. El riesgo de endurecer reglas
 * no es de seguridad: es que una escritura LEGÍTIMA de la app empiece a ser
 * rechazada y un dato deje de guardarse. Esta prueba ejecuta el código REAL
 * de la app (js/40-firestore.js montado completo; solicitarAjuste() aislada de
 * js/50-roles-permisos.js) contra el emulador con firestore.rules aplicadas,
 * como bartender y como admin.
 *
 *   K1  Un bartender sincroniza 200 pedidos (3 fragmentos) sin rechazo.
 *   K2  ★ Su lista baja a 50: la escritura NO falla aunque ya no puede borrar.
 *   K3  ★ La lectura devuelve EXACTAMENTE 50: los fragmentos sobrantes que
 *       quedaron en Firestore no resucitan pedidos.
 *   K4  Los sobrantes siguen ahí (el bartender no borró nada).
 *   K5  El admin, al sincronizar, sí los limpia.
 *   K6  Un residuo "new_chunk_*" de la versión vieja se ignora al leer.
 *   K7  Mismo comportamiento en inventoriesChunks.
 *   A1  ★ solicitarAjuste() real crea el ajuste bajo las reglas nuevas.
 *   A2  ★ Una cantidad sugerida de 0 se guarda como 0 (antes se perdía).
 *   A3  Sin cantidad → null; motivo > 500 se avisa y no se envía.
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-fase7-integracion.js"
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

function montarFirestore(db, uid, admin) {
    const src = fs.readFileSync(path.join(RAIZ, 'js/40-firestore.js'), 'utf8');
    const deps = {
        navigator: { onLine: true }, _db: db, FIRESTORE_DOC_ID: DOC_ID, currentUserUid: uid,
        _deviceId: 'disp-' + uid, products: [], AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
        myAuditoriaConteo: {}, myAuditoriaStatus: {}, myAuditoriaFinalizadas: {},
        auditoriaConteo: {}, inventarioConteo: {}, _auditoriaSessionId: null,
        isAdmin: () => !!admin, hasPermission: () => !!admin,
        showNotification() {}, renderTab() {}, saveToLocalStorage() {}, updateCloudSyncBadge() {},
        _registrarEnSyncQueue() {}, _registrarConflictos() {}, escapeHtml: (s) => String(s),
        firebase: fb, _auth: { currentUser: { uid: uid } },
        localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
        console: { warn() {}, error() {}, info() {}, log() {} },
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
                    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, remove() {} }),
                    body: { appendChild() {}, removeChild() {} }, addEventListener() {} },
        requestAnimationFrame: (f) => f(), setTimeout: (f) => { try { f(); } catch (_) {} return 0; }, clearTimeout() {}
    };
    deps.window = deps;
    const montar = new Function('deps', 'with (deps) {\n' + src +
        '\n; return { _writeChunkedSubcollection: _writeChunkedSubcollection, _readChunkedSubcollection: _readChunkedSubcollection }; }');
    return montar(deps);
}

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

function montarSolicitarAjuste(db, uid) {
    const fuente = fs.readFileSync(path.join(RAIZ, 'js/50-roles-permisos.js'), 'utf8');
    const cuerpo = 'async ' + extraerFuncion(fuente, 'solicitarAjuste');
    const avisos = [];
    const deps = { _db: db, currentUserUid: uid, showNotification: (t) => avisos.push(String(t)),
                   crearNotificacion: async () => {}, console: { error() {}, warn() {}, info() {} } };
    const f = new Function('deps', 'with (deps) {\n' + cuerpo + '\n; return solicitarAjuste; }')(deps);
    f._avisos = avisos;
    return f;
}

const pedidos = (n, pre) => Array.from({ length: n }, (_, k) => ({ id: (pre || 'PED-') + k, supplier: 'S', products: [] }));

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
    });
    async function idsEnFirestore(sub) {
        let out = [];
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().collection(R + '/' + sub).get();
            out = s.docs.map(x => x.id).sort();
        });
        return out;
    }

    const dbBart = testEnv.authenticatedContext('bart1').firestore();
    const dbJefe = testEnv.authenticatedContext('jefe').firestore();
    const bart = montarFirestore(dbBart, 'bart1', false);
    const jefe = montarFirestore(dbJefe, 'jefe', true);
    const refB = dbBart.doc(R), refJ = dbJefe.doc(R);

    console.log('\n  ── FASE 7 · fragmentos del historial bajo las reglas nuevas ──\n');

    let err = null;
    try { await bart._writeChunkedSubcollection(refB, 'ordersChunks', pedidos(200)); } catch (e) { err = e; }
    chk('K1  Un bartender sincroniza 200 pedidos (3 fragmentos) sin rechazo', !err, err && err.message);

    err = null;
    try { await bart._writeChunkedSubcollection(refB, 'ordersChunks', pedidos(50, 'NUEVO-')); } catch (e) { err = e; }
    chk('K2  ★ Su lista baja a 50 y la escritura NO falla (ya no intenta borrar)', !err, err && err.message);

    let leidos = await bart._readChunkedSubcollection(refB, 'ordersChunks');
    chk('K3  ★ La lectura devuelve EXACTAMENTE los 50 actuales: los sobrantes no resucitan pedidos',
        leidos.length === 50 && leidos.every(p => p.id.indexOf('NUEVO-') === 0), leidos.length + ' leídos');

    chk('K4  Los fragmentos sobrantes siguen en Firestore (el bartender no borró nada)',
        JSON.stringify(await idsEnFirestore('ordersChunks')) === JSON.stringify(['chunk_0', 'chunk_1', 'chunk_2']));

    err = null;
    try { await jefe._writeChunkedSubcollection(refJ, 'ordersChunks', pedidos(50, 'NUEVO-')); } catch (e) { err = e; }
    chk('K5  El admin, al sincronizar, limpia los sobrantes',
        !err && JSON.stringify(await idsEnFirestore('ordersChunks')) === JSON.stringify(['chunk_0']), err && err.message);

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc(R + '/ordersChunks/new_chunk_0').set({ items: pedidos(5, 'VIEJO-'), chunkIndex: 0, totalChunks: 1, _updatedAt: 1 });
    });
    leidos = await bart._readChunkedSubcollection(refB, 'ordersChunks');
    chk('K6  Un residuo "new_chunk_*" de la versión vieja se ignora al leer',
        leidos.length === 50 && !leidos.some(p => p.id.indexOf('VIEJO-') === 0), leidos.length + ' leídos');

    err = null;
    try {
        await bart._writeChunkedSubcollection(refB, 'inventoriesChunks', pedidos(170, 'INV-'));
        await bart._writeChunkedSubcollection(refB, 'inventoriesChunks', pedidos(10, 'INV2-'));
    } catch (e) { err = e; }
    leidos = await bart._readChunkedSubcollection(refB, 'inventoriesChunks');
    chk('K7  Mismo comportamiento en inventoriesChunks (170 → 10, se leen 10)',
        !err && leidos.length === 10 && leidos.every(p => p.id.indexOf('INV2-') === 0), (err && err.message) || leidos.length);

    console.log('\n  ── FASE 7 · ajustes con la función real ──\n');
    const solicitar = montarSolicitarAjuste(dbBart, 'bart1');
    async function ajustes() {
        let out = [];
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().collection('ajustes').get();
            out = s.docs.map(d => Object.assign({ _id: d.id }, d.data()));
        });
        return out;
    }
    await solicitar('PRD-001', 'DON JULIO 70', 'Botella rota', 3);
    let a = await ajustes();
    chk('A1  ★ solicitarAjuste() real crea el ajuste bajo las reglas nuevas',
        a.length === 1 && a[0].solicitanteUid === 'bart1' && a[0].estado === 'pendiente' && /^[A-Za-z0-9]{20}$/.test(a[0]._id),
        JSON.stringify(solicitar._avisos));
    await solicitar('PRD-002', 'CAMPARI', 'Se terminó', 0);
    a = await ajustes();
    const cero = a.find(x => x.productoId === 'PRD-002');
    chk('A2  ★ Una cantidad sugerida de 0 se guarda como 0 (antes se convertía en "sin sugerencia")',
        !!cero && cero.cantidadSugerida === 0, JSON.stringify(cero));
    await solicitar('PRD-003', 'APEROL', 'Sin cantidad', null);
    const antes = (await ajustes()).length;
    await solicitar('PRD-004', 'X', 'm'.repeat(501), 1);
    a = await ajustes();
    chk('A3  Sin cantidad se guarda null; un motivo de más de 500 se avisa y no se envía',
        a.some(x => x.productoId === 'PRD-003' && x.cantidadSugerida === null) && a.length === antes &&
        solicitar._avisos.some(t => /500/.test(t)), JSON.stringify(solicitar._avisos));

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones de integración · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
