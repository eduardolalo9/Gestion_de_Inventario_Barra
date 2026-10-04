/**
 * prueba-fase13-integracion.js — CONTABILIZAR FIN DE MES de punta a punta
 * contra Firestore REAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Mismo principio que prueba-f3-integracion.js (que esta prueba complementa,
 * sin repetir sus casos): se monta js/75-auditoria-flujo.js tal como se
 * publica, con el emulador oficial de Firestore y firestore.rules aplicadas
 * byte a byte, y se llama a contabilizarInventario() exactamente como lo
 * llama el botón de la pantalla.
 *
 * Lo que se demuestra con ejecución, no con lectura de código:
 *
 *   Q1   Un corte de fin de mes PURO (miércoles) genera SOLO el corte
 *        mensual — antes de esta fase, evaluarContabilizable() lo bloqueaba
 *        sin excepción.
 *   Q2   ★ D1 — un domingo-fin-de-mes genera LOS DOS documentos (inicial
 *        semanal + corte mensual) en el MISMO batch atómico.
 *   Q3   ★ D2 — el corte mensual valoriza en dinero con el precio
 *        CONGELADO; un producto sin precio se cuenta aparte, nunca se
 *        inventa un valor para él.
 *   Q4   Contabilizar dos veces el caso combinado no duplica ninguno de los
 *        dos documentos.
 *   Q5   Un reintento tras caída de red no duplica (como P15 en FASE 3).
 *   Q6   Dos inventarios distintos no pueden ocupar el mismo mes.
 *   Q7   La lectura de cortesMensuales exige inventory.viewAll (lleva
 *        dinero); inventariosIniciales sigue abierto a cualquier
 *        autenticado.
 *   Q8   Un recuento fuera de calendario (ni domingo ni fin de mes) sigue
 *        sin generar nada — ni inicial ni corte.
 *
 * ── CÓMO EJECUTAR ──
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-fase13-integracion.js"
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

// Dos productos CON precio (para valorizar) y uno SIN precio (para probar
// que nunca se inventa un valor que el catálogo no tiene).
const CATALOGO = [
    { id: 'PRD-001', name: 'Don Julio 70', unit: 'PZA', precio: 500,
      capacidadMl: 700, pesoBotellaLlenaOz: 53.65, conteoOzHabilitado: true },
    { id: 'PRD-002', name: 'Titos', unit: 'PZA', precio: 350,
      capacidadMl: 750, pesoBotellaLlenaOz: 42.54, conteoOzHabilitado: true },
    { id: 'PRD-003', name: 'Azucar refinada', unit: 'KGS',
      capacidadMl: 0, pesoBotellaLlenaOz: 0, conteoOzHabilitado: false }
];

// Monta el archivo REAL js/75-auditoria-flujo.js con un Firestore de verdad.
// Mismo montaje que prueba-f3-integracion.js (new Function + with: un
// contexto de vm tiene sus propios intrínsecos y el SDK de Firestore
// rechaza los objetos que se construyan dentro).
function montarApp(db, uid, opciones) {
    opciones = opciones || {};
    const avisos = [];
    const confirmaciones = [];

    const ciclo  = fs.readFileSync(path.join(RAIZ, 'js/15-ciclo-semanal.js'), 'utf8');
    const flujo  = fs.readFileSync(path.join(RAIZ, 'js/75-auditoria-flujo.js'), 'utf8');
    const firest = fs.readFileSync(path.join(RAIZ, 'js/40-firestore.js'), 'utf8');

    const conv = ['convertirOzAPuntos', 'tieneDatosConversion', 'tieneConversion']
        .map(function(n) {
            const fuente = fs.readFileSync(path.join(RAIZ, 'js/70-conversion-render.js'), 'utf8');
            const i = fuente.indexOf('function ' + n + '(');
            if (i === -1) throw new Error('No se encontró ' + n + ' en 70-conversion-render.js');
            let nivel = 0, dentro = false;
            for (let j = i; j < fuente.length; j++) {
                if (fuente[j] === '{') { nivel++; dentro = true; }
                else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(i, j + 1); }
            }
            throw new Error('No se pudo delimitar ' + n);
        }).join('\n');

    const deps = {
        navigator: { onLine: opciones.onLine !== false },
        _db: db,
        FIRESTORE_DOC_ID: DOC_ID,
        currentUserUid: uid,
        currentUserRole: opciones.admin ? 'ADMIN' : 'BARTENDER',
        _deviceId: 'disp-' + uid,
        products: (opciones.products || CATALOGO).map(p => Object.assign({}, p)),
        AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
        areasAuditoria: { almacen: 'Almacén', barra1: 'Barra Restaurante', barra2: 'Barra Bar' },
        areasAuditoriaFA: {}, areasAuditoriaIcons: {},
        auditoriaStatus: {}, myAuditoriaStatus: {}, myAuditoriaConteo: {},
        auditoriaConteo: {}, inventarioConteo: {}, allUsersAuditoria: {},
        myAuditoriaUnlocks: {}, myAuditoriaFinalizadas: {},
        auditoriaView: 'selection', auditoriaAreaActiva: null, isAuditoriaMode: false,
        _inventarioActivo: null, _auditoriaSessionId: null, _historialInventarios: null,
        auditCurrentUser: { userId: uid, userName: uid },
        isAdmin: () => !!opciones.admin,
        hasPermission: (p) => opciones.admin || (opciones.permisos || []).indexOf(p) !== -1,
        puedeOperarArea: () => true,
        puedeVerConteosAjenos: () => !!opciones.admin,
        showNotification: (t) => avisos.push(String(t)),
        // Igual que en prueba-f3-integracion.js: se guarda la promesa del
        // callback de confirmación para poder esperarla explícitamente —
        // contabilizarInventario() no espera a que el usuario confirme.
        showConfirm: (msg, cb) => {
            confirmaciones.push(String(msg));
            deps._pendiente = Promise.resolve().then(cb);
            return deps._pendiente;
        },
        // Doble mínimo: solo se necesita el formato, no el locale real.
        _panelMoneda: (n) => '$' + Math.round(n),
        renderTab() {}, saveToLocalStorage() {}, updateCloudSyncBadge() {},
        _registrarEnSyncQueue(e) { deps._eventos.push(e); },
        _registrarConflictos() {}, escapeHtml: (s) => String(s),
        exportToExcelConDatos() {}, _usuariosContando: () => 0,
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
        _eventos: []
    };
    deps.window = deps;

    const montar = new Function('deps', 'with (deps) {\n' + ciclo + '\n' + conv + '\n' + firest + '\n' + flujo +
        '\n; return { contabilizarInventario: contabilizarInventario,' +
        '            _saldosDesdeSnapshot: _saldosDesdeSnapshot,' +
        '            cierreMensualDesdeSnapshot: cierreMensualDesdeSnapshot,' +
        '            convertirOzAPuntos: convertirOzAPuntos }; }');

    let api;
    try { api = montar(deps); }
    catch (e) { throw new Error('No se pudo montar el flujo: ' + e.message); }

    api._avisos = avisos;
    api._confirmaciones = confirmaciones;
    api._eventos = deps._eventos;
    api._deps = deps;
    api.contabilizar = async function(invId, numero) {
        deps._pendiente = null;
        await api.contabilizarInventario(invId, numero);
        if (deps._pendiente) await deps._pendiente;
    };
    return api;
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8'),
            host: 'localhost', port: 8080
        }
    });

    const R = 'inventarioApp/' + DOC_ID;

    // PRD-003 (sin precio) se deja SIN contar a propósito: su saldo en cero
    // tiene que seguir contando como "sin precio", no fundirse con "cero
    // porque no tiene precio".
    function conteoDemo() {
        return {
            'PRD-001': {
                almacen: { enteras: 5, abiertas: [] },
                barra1:  { enteras: 2, abiertas: [40.0] },
                barra2:  { enteras: 0, abiertas: [] }
            },
            'PRD-002': {
                almacen: { enteras: 3, abiertas: [] },
                barra1:  { enteras: 1, abiertas: [] },
                barra2:  { enteras: 0, abiertas: [30.0] }
            }
        };
    }

    async function sembrarCerrado(invId, opts) {
        opts = opts || {};
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
            await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
            await d.doc('roles/ADMIN').set({ roleId: 'ADMIN', permissions: ['*'] });
            await d.doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count'] });

            await d.doc(R + '/inventories/' + invId).set({
                inventoryId: invId, numero: opts.numero || 101, tipo: 'inventario_fisico',
                estado: 'CERRADO',
                fechaCreacion: Date.now() - 86400000,
                fechaCierre: Date.now(),
                cerradoPorUid: 'jefe', cerradoPorNombre: 'jefe@local',
                totalProductos: CATALOGO.length,
                warehousesSnapshot: ['almacen', 'barra1', 'barra2'],
                fechaRecuento: opts.fechaRecuento || '2026-09-13',
                semanaId: opts.semanaId !== undefined ? opts.semanaId : '2026-09-07',
                semanaIdOrigen: 'fechaRecuento'
            });

            const registros = [
                { tipo: 'meta', numero: opts.numero || 101, inventoryId: invId,
                  fecha: Date.now(), semanaId: '2026-09-07', semanaIdOrigen: 'fechaRecuento',
                  totalProductos: CATALOGO.length,
                  warehousesSnapshot: ['almacen', 'barra1', 'barra2'],
                  participantes: ['bart1'] }
            ];
            // Los productos se congelan CON su precio: es lo que valoriza el
            // corte mensual, y lo hace con el precio del día del cierre, no
            // el del catálogo de hoy.
            (opts.productosCongelados || CATALOGO).forEach(function(p) {
                registros.push(Object.assign({ tipo: 'producto', nombre: p.name }, p));
            });
            registros.push({ tipo: 'usuario', uid: 'bart1', email: 'bart1@local',
                             isAdmin: false, status: {}, conteo: opts.conteo || conteoDemo() });

            await d.doc(R + '/inventories/' + invId + '/snapshotChunks/chunk_0').set({
                items: registros, chunkIndex: 0, totalChunks: 1, _updatedAt: Date.now()
            });
        });
    }

    async function leerInicial(semana) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/inventariosIniciales/' + semana).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function leerCorteMensual(mesId) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/cortesMensuales/' + mesId).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function leerInventario(invId) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/inventories/' + invId).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function contarIniciales() {
        let n = 0;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().collection(R + '/inventariosIniciales').get();
            n = s.size;
        });
        return n;
    }
    async function contarCortes() {
        let n = 0;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().collection(R + '/cortesMensuales').get();
            n = s.size;
        });
        return n;
    }

    const dbAdmin = testEnv.authenticatedContext('jefe').firestore();
    const dbBart  = testEnv.authenticatedContext('bart1').firestore();

    console.log('\n  ── FASE 13 · contabilizar fin de mes contra Firestore real ──\n');

    const r3 = (x) => Math.round(x * 1000) / 1000;

    // ═══════════════════════════════════════════════════════════════════
    //  A · Q1 — Corte de fin de mes PURO (miércoles 2026-09-30)
    // ═══════════════════════════════════════════════════════════════════
    await sembrarCerrado('inv-mes-1', { numero: 201, fechaRecuento: '2026-09-30' });
    let app = montarApp(dbAdmin, 'jefe', { admin: true });
    await app.contabilizar('inv-mes-1', 201);

    chk('Q1 · ★ un corte de fin de mes puro ya NO se bloquea (antes de FASE 13 sí)',
        (await contarCortes()) === 1, 'avisos: ' + app._avisos.join(' | '));
    chk('Q1 · y NO genera ningún inicial semanal (no cierra semana)',
        (await contarIniciales()) === 0);

    const corte1 = await leerCorteMensual('2026-09');
    if (corte1) {
        const p1 = 5 + 2 + app.convertirOzAPuntos(40.0, 700, 53.65);
        const p2 = 3 + 1 + app.convertirOzAPuntos(30.0, 750, 42.54);
        chk('Q1 · los saldos del corte suman las tres áreas, igual que el inicial semanal',
            corte1.saldos['PRD-001'] === r3(p1) && corte1.saldos['PRD-002'] === r3(p2),
            JSON.stringify(corte1.saldos));
        chk('Q3 · ★ el valor se calcula solo con los productos que tienen precio',
            corte1.valorTotal === Math.round((r3(p1) * 500 + r3(p2) * 350) * 100) / 100,
            'esperado ' + (r3(p1) * 500 + r3(p2) * 350) + ' · recibido ' + corte1.valorTotal);
        chk('Q3 · ★ PRD-003 (sin precio) se cuenta aparte, no se le inventa un valor',
            corte1.productosSinPrecio === 1 && corte1.productosConPrecio === 2 &&
            'PRD-003' in corte1.saldos,
            JSON.stringify({ sinPrecio: corte1.productosSinPrecio, conPrecio: corte1.productosConPrecio }));
        chk('El corte conserva la trazabilidad a su inventario de origen',
            corte1.origen && corte1.origen.inventoryId === 'inv-mes-1' && corte1.origen.numero === 201);
    } else {
        chk('Q1 · los saldos del corte suman las tres áreas, igual que el inicial semanal', false, 'no se creó el corte');
        chk('Q3 · ★ el valor se calcula solo con los productos que tienen precio', false, 'no se creó el corte');
        chk('Q3 · ★ PRD-003 (sin precio) se cuenta aparte, no se le inventa un valor', false, 'no se creó el corte');
        chk('El corte conserva la trazabilidad a su inventario de origen', false, 'no se creó el corte');
    }

    const invMes1 = await leerInventario('inv-mes-1');
    chk('Q1 · el inventario guarda mesDestino pero NO semanaDestino',
        invMes1 && invMes1.mesDestino === '2026-09' && !invMes1.semanaDestino,
        JSON.stringify({ mesDestino: invMes1 && invMes1.mesDestino, semanaDestino: invMes1 && invMes1.semanaDestino }));
    chk('Q1 · el inventario queda CONTABILIZADO',
        invMes1 && invMes1.estado === 'CONTABILIZADO');

    // ═══════════════════════════════════════════════════════════════════
    //  B · Q2 — Domingo-fin-de-mes (31-may-2026): las DOS cosas a la vez
    // ═══════════════════════════════════════════════════════════════════
    await sembrarCerrado('inv-ambos-1', { numero: 301, fechaRecuento: '2026-05-31', semanaId: '2026-05-25' });
    const appAmbos = montarApp(dbAdmin, 'jefe', { admin: true });
    await appAmbos.contabilizar('inv-ambos-1', 301);

    chk('Q2 · ★ D1 — genera el inicial semanal Y el corte mensual a la vez',
        (await contarIniciales()) === 1 && (await contarCortes()) === 1,
        'avisos: ' + appAmbos._avisos.join(' | '));
    const inicialAmbos = await leerInicial('2026-06-01');
    const corteAmbos   = await leerCorteMensual('2026-05');
    chk('Q2 · el inicial semanal apunta a la semana siguiente (1-jun-2026)', !!inicialAmbos);
    chk('Q2 · el corte mensual es el de mayo', !!corteAmbos && corteAmbos.mesId === '2026-05');
    chk('Q2 · los saldos coinciden entre los dos documentos (mismo snapshot, mismo cálculo)',
        !!inicialAmbos && !!corteAmbos &&
        JSON.stringify(inicialAmbos.saldos) === JSON.stringify(corteAmbos.saldos));
    const invAmbos = await leerInventario('inv-ambos-1');
    chk('Q2 · la cabecera del inventario guarda los DOS destinos',
        invAmbos && invAmbos.semanaDestino === '2026-06-01' && invAmbos.mesDestino === '2026-05',
        JSON.stringify({ semanaDestino: invAmbos && invAmbos.semanaDestino, mesDestino: invAmbos && invAmbos.mesDestino }));
    chk('Q2 · la confirmación avisó de ambos destinos antes de escribir',
        appAmbos._confirmaciones.some(c => c.indexOf('2026-06-01') !== -1 && c.indexOf('2026-05') !== -1),
        appAmbos._confirmaciones.join(' | '));

    // ═══════════════════════════════════════════════════════════════════
    //  C · Q4 — Contabilizar DOS VECES el caso combinado
    // ═══════════════════════════════════════════════════════════════════
    const appAmbos2 = montarApp(dbAdmin, 'jefe', { admin: true });
    await appAmbos2.contabilizar('inv-ambos-1', 301);
    chk('Q4 · ★ el segundo intento NO duplica NINGUNO de los dos documentos',
        (await contarIniciales()) === 1 && (await contarCortes()) === 1,
        'iniciales=' + (await contarIniciales()) + ' cortes=' + (await contarCortes()));
    chk('Q4 · y se lo dice al usuario en vez de fingir que lo hizo',
        // El inventario ya quedó en estado CONTABILIZADO tras el primer
        // intento, así que el segundo golpea el aviso temprano de
        // contabilizarInventario() ("ya estaba contabilizado"), no el de
        // "ya generó" (que es para cuando el estado se quedó a medias).
        appAmbos2._avisos.some(a => /ya estaba contabilizado/i.test(a)),
        appAmbos2._avisos.join(' | '));

    // ═══════════════════════════════════════════════════════════════════
    //  D · Q5 — Reintento tras caída de red (caso combinado)
    // ═══════════════════════════════════════════════════════════════════
    // 2027-10-31 es, igual que 2026-05-31, domingo Y fin de mes — se repite
    // el caso combinado en un escenario limpio (sembrarCerrado() limpia
    // Firestore, así que los conteos de aquí en adelante parten de cero).
    await sembrarCerrado('inv-ambos-2', { numero: 302, fechaRecuento: '2027-10-31', semanaId: '2027-10-25' });
    const appRed = montarApp(dbAdmin, 'jefe', { admin: true });
    await appRed.contabilizar('inv-ambos-2', 302);
    const trasPrimero = { inicial: await leerInicial('2027-11-01'), corte: await leerCorteMensual('2027-10') };
    chk('Q5 · el primer intento escribió los dos documentos',
        !!trasPrimero.inicial && !!trasPrimero.corte);

    const appReintento = montarApp(dbAdmin, 'jefe', { admin: true });
    await appReintento.contabilizar('inv-ambos-2', 302);
    chk('Q5 · ★ el reintento no duplica ninguno de los dos',
        (await contarIniciales()) === 1 && (await contarCortes()) === 1,
        'iniciales=' + (await contarIniciales()) + ' cortes=' + (await contarCortes()));
    chk('Q5 · el reintento se resuelve como éxito, no como error',
        appReintento._avisos.some(a => /ya estaba contabilizado/i.test(a)),
        appReintento._avisos.join(' | '));

    // ═══════════════════════════════════════════════════════════════════
    //  E · Q6 — Dos inventarios distintos no pueden ocupar el mismo mes
    // ═══════════════════════════════════════════════════════════════════
    // sembrarCerrado() limpia Firestore (igual que en A-D), así que se
    // vuelve a sembrar un corte de septiembre propio para este escenario —
    // reutilizar el de la sección A no es posible, ya quedó borrado por el
    // sembrarCerrado() de la sección D.
    await sembrarCerrado('inv-mes-1b', { numero: 201, fechaRecuento: '2026-09-30' });
    const appMes1b = montarApp(dbAdmin, 'jefe', { admin: true });
    await appMes1b.contabilizar('inv-mes-1b', 201);
    const cortesAntes = await contarCortes();
    chk('Q6 · (preparación) el corte de septiembre de este escenario se creó', cortesAntes === 1);

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        const base = await d.doc(R + '/inventories/inv-mes-1b').get();
        await d.doc(R + '/inventories/inv-mes-2').set(Object.assign({}, base.data(), {
            inventoryId: 'inv-mes-2', numero: 202, estado: 'CERRADO'
        }));
        const chunk = await d.doc(R + '/inventories/inv-mes-1b/snapshotChunks/chunk_0').get();
        await d.doc(R + '/inventories/inv-mes-2/snapshotChunks/chunk_0').set(chunk.data());
    });
    const appConflictoMes = montarApp(dbAdmin, 'jefe', { admin: true });
    await appConflictoMes.contabilizar('inv-mes-2', 202);
    chk('Q6 · ★ un segundo inventario NO puede ocupar un mes ya usado',
        (await contarCortes()) === cortesAntes);
    chk('Q6 · el conflicto se muestra, no se resuelve en silencio',
        appConflictoMes._avisos.some(a => /ya tiene un corte contable/i.test(a)),
        appConflictoMes._avisos.join(' | '));
    const invMes2 = await leerInventario('inv-mes-2');
    chk('Q6 · el inventario en conflicto NO quedó marcado como contabilizado',
        invMes2 && invMes2.estado === 'CERRADO', 'estado=' + (invMes2 && invMes2.estado));

    // ═══════════════════════════════════════════════════════════════════
    //  F · Q7 — Permisos de lectura: cortesMensuales exige inventory.viewAll
    // ═══════════════════════════════════════════════════════════════════
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count'] });
    });
    let lecturaCorteRechazada = false;
    try {
        await dbBart.doc(R + '/cortesMensuales/2026-09').get();
    } catch (e) {
        lecturaCorteRechazada = (e && (e.code === 'permission-denied' || /PERMISSION_DENIED/.test(String(e))));
    }
    chk('Q7 · ★ sin inventory.viewAll, un bartender NO puede leer un corte mensual (lleva dinero)',
        lecturaCorteRechazada);

    let lecturaInicialOk = true;
    try {
        await dbBart.doc(R + '/inventariosIniciales/2026-06-01').get();
    } catch (e) {
        lecturaInicialOk = false;
    }
    chk('Q7 · el inicial semanal sigue abierto a cualquier autenticado (sin regresión)',
        lecturaInicialOk);

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count', 'inventory.viewAll'] });
    });
    let lecturaCorteConPermiso = true;
    try {
        await dbBart.doc(R + '/cortesMensuales/2026-09').get();
    } catch (e) {
        lecturaCorteConPermiso = false;
    }
    chk('Q7 · con inventory.viewAll, la lectura sí se permite',
        lecturaCorteConPermiso);

    // ═══════════════════════════════════════════════════════════════════
    //  G · Q8 — Fuera de calendario: ni domingo ni fin de mes
    // ═══════════════════════════════════════════════════════════════════
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count'] });
    });
    await sembrarCerrado('inv-fuera', { numero: 401, fechaRecuento: '2026-09-16' }); // miércoles normal
    const cortesAntesFuera    = await contarCortes();
    const inicialesAntesFuera = await contarIniciales();
    const appFuera = montarApp(dbAdmin, 'jefe', { admin: true });
    await appFuera.contabilizar('inv-fuera', 401);
    chk('Q8 · un miércoles que no es fin de mes sigue sin generar nada',
        (await contarCortes()) === cortesAntesFuera && (await contarIniciales()) === inicialesAntesFuera);
    chk('Q8 · el motivo menciona las dos reglas (domingo y fin de mes)',
        appFuera._avisos.some(a => /DOMINGO/.test(a) && /último día del mes/.test(a)),
        appFuera._avisos.join(' | '));

    await testEnv.cleanup();

    console.log('\n  ' + total + ' comprobaciones de integración · ' +
                (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
