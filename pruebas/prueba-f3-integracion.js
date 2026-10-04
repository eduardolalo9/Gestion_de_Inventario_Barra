/**
 * prueba-f3-integracion.js — CONTABILIZAR de punta a punta contra Firestore REAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Esto NO es una simulación. Se monta el archivo js/75-auditoria-flujo.js tal
 * como se publica, se le inyecta el emulador oficial de Firestore con
 * firestore.rules aplicadas byte a byte, y se llama a contabilizarInventario()
 * exactamente como lo llama el botón de la pantalla.
 *
 * Lo que se demuestra con ejecución, no con lectura de código:
 *
 *   P11  El admin contabiliza un inventario cerrado.
 *   P13  Se crea el inicial de la semana siguiente con los saldos correctos.
 *   P14  Contabilizar DOS VECES no duplica ni reaplica nada.
 *   P15  Un reintento tras caída de red no duplica.
 *   P16  El snapshot del inventario cerrado queda intacto, byte a byte.
 *   P17  El inicial conserva la referencia a su inventario de origen.
 *   F5   Dos inventarios distintos no pueden ocupar la misma semana.
 *   F7   La conversión usa los datos CONGELADOS, no el catálogo actual.
 *   F8   Un recuento que no cae en domingo no se contabiliza.
 *   F12  Un producto sin contar entra como cero explícito.
 *
 * ── CÓMO EJECUTAR ──
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-f3-integracion.js"
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

// Dos productos con datos de conversión distintos, para que el cálculo no sea
// trivial: una botella de 700 ml y otra de 750 ml, con pesos reales.
const CATALOGO = [
    { id: 'PRD-001', name: 'Don Julio 70', unit: 'PZA',
      capacidadMl: 700, pesoBotellaLlenaOz: 53.65, conteoOzHabilitado: true },
    { id: 'PRD-002', name: 'Titos', unit: 'PZA',
      capacidadMl: 750, pesoBotellaLlenaOz: 42.54, conteoOzHabilitado: true },
    { id: 'PRD-003', name: 'Azucar refinada', unit: 'KGS',
      capacidadMl: 0, pesoBotellaLlenaOz: 0, conteoOzHabilitado: false }
];

/**
 * Monta el archivo REAL js/75-auditoria-flujo.js con un Firestore de verdad.
 * Igual que en prueba-f1-integracion.js se usa new Function + with en vez de
 * vm.createContext: un contexto de vm tiene sus propios intrínsecos y el SDK
 * de Firestore rechaza los objetos que se construyan dentro.
 */
function montarApp(db, uid, opciones) {
    opciones = opciones || {};
    const avisos = [];
    const confirmaciones = [];

    const ciclo  = fs.readFileSync(path.join(RAIZ, 'js/15-ciclo-semanal.js'), 'utf8');
    const flujo  = fs.readFileSync(path.join(RAIZ, 'js/75-auditoria-flujo.js'), 'utf8');
    const firest = fs.readFileSync(path.join(RAIZ, 'js/40-firestore.js'), 'utf8');

    // De js/70-conversion-render.js se extraen SOLO las tres funciones de
    // conversión. Montar el archivo entero sería contraproducente: declara sus
    // propias showNotification(), showConfirm() y renderTab(), que dentro del
    // `with` ensombrecen a los dobles de esta prueba — y la showConfirm real
    // construye un modal y nunca llama al callback, así que la operación no
    // llegaría a ejecutarse nunca. Se extraen del archivo real, no se copian.
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
        // El permiso se resuelve como en la app: el admin lo tiene todo.
        hasPermission: (p) => opciones.admin || (opciones.permisos || []).indexOf(p) !== -1,
        puedeOperarArea: () => true,
        puedeVerConteosAjenos: () => !!opciones.admin,
        showNotification: (t) => avisos.push(String(t)),
        // Confirmación automática: el objetivo es probar la OPERACIÓN, no el
        // diálogo. Se guarda el texto para poder comprobar qué se le enseñó al
        // administrador antes de escribir nada.
        // OJO CON LA CARRERA. contabilizarInventario() llama a showConfirm() y
        // NO espera al callback —en la app real el usuario tarda lo que tarda—,
        // así que si la prueba solo hiciera `await contabilizarInventario(...)`
        // seguiría adelante antes de que la escritura terminara y comprobaría
        // una base de datos todavía vacía. Se guarda la promesa del callback
        // para poder esperarla explícitamente.
        showConfirm: (msg, cb) => {
            confirmaciones.push(String(msg));
            deps._pendiente = Promise.resolve().then(cb);
            return deps._pendiente;
        },
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
        // js/70-conversion-render.js toca el DOM en su arranque. Aquí solo se
        // necesitan sus funciones de conversión, así que basta un doble mínimo:
        // lo que se prueba es la aritmética y la escritura, no la interfaz.
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
        '            _readChunkedSubcollection: _readChunkedSubcollection,' +
        '            convertirOzAPuntos: convertirOzAPuntos }; }');

    let api;
    try { api = montar(deps); }
    catch (e) { throw new Error('No se pudo montar el flujo: ' + e.message); }

    api._avisos = avisos;
    api._confirmaciones = confirmaciones;
    api._eventos = deps._eventos;
    api._deps = deps;
    // Llama a la operación Y espera a que la confirmación termine de escribir.
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

    // Conteo repartido en las tres áreas, con botellas abiertas en oz.
    // PRD-003 se deja SIN contar a propósito (prueba F12).
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

    // Siembra un inventario CERRADO con su snapshot, como lo dejaría el cierre.
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
                // Domingo 2026-09-13 salvo que la prueba pida otra cosa.
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
            // Los productos se congelan CON sus datos de conversión.
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
    async function leerInventario(invId) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/inventories/' + invId).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function leerSnapshotCrudo(invId) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/inventories/' + invId + '/snapshotChunks/chunk_0').get();
            out = s.exists ? JSON.stringify(s.data()) : null;
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

    const dbAdmin = testEnv.authenticatedContext('jefe').firestore();
    const dbBart  = testEnv.authenticatedContext('bart1').firestore();

    console.log('\n  ── FASE 3 · contabilizar contra Firestore real ──\n');

    // ═══════════════════════════════════════════════════════════════════
    //  A · El camino feliz
    // ═══════════════════════════════════════════════════════════════════
    await sembrarCerrado('inv-1');
    const snapAntes = await leerSnapshotCrudo('inv-1');
    let app = montarApp(dbAdmin, 'jefe', { admin: true });
    await app.contabilizar('inv-1', 101);

    const inicial = await leerInicial('2026-09-14');
    chk('P11 · el admin contabiliza y se crea el inicial', !!inicial,
        'avisos: ' + app._avisos.join(' | '));

    if (inicial) {
        chk('P13 · el inicial es de la semana SIGUIENTE al recuento',
            inicial.semanaId === '2026-09-14',
            'semanaId=' + inicial.semanaId);

        // El cálculo esperado, a mano:
        //   PRD-001 = 5 + (2 + puntos(40 oz)) + 0
        //   PRD-002 = 3 + 1 + puntos(30 oz)
        const p1 = 5 + 2 + app.convertirOzAPuntos(40.0, 700, 53.65);
        const p2 = 3 + 1 + app.convertirOzAPuntos(30.0, 750, 42.54);
        const r3 = (x) => Math.round(x * 1000) / 1000;
        chk('P13 · los saldos suman las tres áreas con la conversión oz→botella',
            inicial.saldos['PRD-001'] === r3(p1) && inicial.saldos['PRD-002'] === r3(p2),
            'esperado ' + r3(p1) + '/' + r3(p2) + ' · recibido ' +
            inicial.saldos['PRD-001'] + '/' + inicial.saldos['PRD-002']);

        chk('F12 · un producto sin contar entra como CERO explícito, no ausente',
            inicial.saldos['PRD-003'] === 0 && ('PRD-003' in inicial.saldos),
            'una fila en cero es información; una fila ausente es un hueco');
        chk('F12 · el inicial reporta cuántos productos quedaron en cero',
            inicial.productosEnCero === 1, 'recibido ' + inicial.productosEnCero);

        chk('P17 · el inicial conserva la referencia a su inventario de origen',
            inicial.origen && inicial.origen.inventoryId === 'inv-1' &&
            inicial.origen.numero === 101 &&
            inicial.origen.fechaCierre === '2026-09-13' &&
            inicial.origen.semanaCerrada === '2026-09-07',
            JSON.stringify(inicial.origen));
        chk('P17 · el inicial registra quién y cuándo',
            inicial.contabilizadoPor === 'jefe' && typeof inicial.contabilizadoEn === 'number');
    }

    const inv1 = await leerInventario('inv-1');
    chk('P11 · el inventario queda en estado CONTABILIZADO',
        inv1 && inv1.estado === 'CONTABILIZADO', 'estado=' + (inv1 && inv1.estado));
    chk('P11 · el inventario apunta a su semana destino',
        inv1 && inv1.semanaDestino === '2026-09-14');
    chk('P16 · ★ el snapshot del cierre queda intacto, byte a byte',
        (await leerSnapshotCrudo('inv-1')) === snapAntes,
        'contabilizar NO puede tocar la evidencia física');
    chk('P11 · queda registrado en la cola de auditoría',
        app._eventos.some(e => e.tipo === 'contabilizacion'));
    chk('P11 · la confirmación muestra la semana destino antes de escribir',
        app._confirmaciones.some(c => c.indexOf('2026-09-14') !== -1),
        'el administrador tiene que ver los números antes de una operación irreversible');

    // ═══════════════════════════════════════════════════════════════════
    //  B · P14 — Contabilizar dos veces
    // ═══════════════════════════════════════════════════════════════════
    const app2 = montarApp(dbAdmin, 'jefe', { admin: true });
    await app2.contabilizar('inv-1', 101);
    chk('P14 · ★ el segundo intento NO crea un segundo inicial',
        (await contarIniciales()) === 1, 'iniciales en la base: ' + (await contarIniciales()));
    chk('P14 · y se lo dice al usuario en vez de fingir que lo hizo',
        app2._avisos.some(a => /ya (estaba|generó)/i.test(a)),
        'avisos: ' + app2._avisos.join(' | '));

    const inicialTrasSegundo = await leerInicial('2026-09-14');
    chk('P14 · el inicial no se reaplicó ni cambió',
        JSON.stringify(inicialTrasSegundo) === JSON.stringify(inicial));

    // ═══════════════════════════════════════════════════════════════════
    //  C · P15 — Reintento tras caída de red
    // ═══════════════════════════════════════════════════════════════════
    // Se simula el caso real: el batch se confirmó en el servidor pero la
    // respuesta nunca llegó al teléfono, así que el usuario vuelve a pulsar.
    await sembrarCerrado('inv-2', { numero: 102 });
    const appRed = montarApp(dbAdmin, 'jefe', { admin: true });
    await appRed.contabilizar('inv-2', 102);   // primer intento: escribe
    const trasPrimero = await leerInicial('2026-09-14');

    const appReintento = montarApp(dbAdmin, 'jefe', { admin: true });
    await appReintento.contabilizar('inv-2', 102);  // el usuario reintenta

    chk('P15 · ★ el reintento no duplica: sigue habiendo un solo inicial',
        (await contarIniciales()) === 1);
    chk('P15 · el inicial es exactamente el mismo que dejó el primer intento',
        JSON.stringify(await leerInicial('2026-09-14')) === JSON.stringify(trasPrimero));
    chk('P15 · el reintento se resuelve como éxito, no como error',
        appReintento._avisos.some(a => /ya (estaba|generó)/i.test(a)),
        'avisos: ' + appReintento._avisos.join(' | '));

    // ═══════════════════════════════════════════════════════════════════
    //  D · F5 — Dos inventarios distintos a la misma semana
    // ═══════════════════════════════════════════════════════════════════
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        // Un segundo inventario cerrado, mismo domingo, distinto número.
        const d = ctx.firestore();
        const base = await d.doc(R + '/inventories/inv-2').get();
        await d.doc(R + '/inventories/inv-3').set(Object.assign({}, base.data(), {
            inventoryId: 'inv-3', numero: 103, estado: 'CERRADO'
        }));
        const chunk = await d.doc(R + '/inventories/inv-2/snapshotChunks/chunk_0').get();
        await d.doc(R + '/inventories/inv-3/snapshotChunks/chunk_0').set(chunk.data());
    });
    const appConflicto = montarApp(dbAdmin, 'jefe', { admin: true });
    await appConflicto.contabilizar('inv-3', 103);
    chk('F5 · ★ un segundo inventario NO puede ocupar una semana ya usada',
        (await contarIniciales()) === 1);
    chk('F5 · el conflicto se muestra, no se resuelve en silencio',
        appConflicto._avisos.some(a => /ya tiene un inicial/i.test(a)),
        'avisos: ' + appConflicto._avisos.join(' | '));
    const inv3 = await leerInventario('inv-3');
    chk('F5 · el inventario en conflicto NO quedó marcado como contabilizado',
        inv3 && inv3.estado === 'CERRADO', 'estado=' + (inv3 && inv3.estado));

    // ═══════════════════════════════════════════════════════════════════
    //  E · F7 — La conversión usa los datos CONGELADOS
    // ═══════════════════════════════════════════════════════════════════
    await sembrarCerrado('inv-4', { numero: 104 });
    // El catálogo actual del dispositivo trae un peso de botella DISTINTO del
    // que quedó congelado. Si el cálculo mirara el catálogo, el saldo saldría
    // otro — y un inicial de enero cambiaría al corregir un peso en marzo.
    const catalogoAlterado = CATALOGO.map(p => Object.assign({}, p,
        p.id === 'PRD-001' ? { pesoBotellaLlenaOz: 99.99, capacidadMl: 1000 } : {}));
    const appCongelado = montarApp(dbAdmin, 'jefe', { admin: true, products: catalogoAlterado });
    await appCongelado.contabilizar('inv-4', 104);
    const inicial4 = await leerInicial('2026-09-14');
    const esperado1 = Math.round((5 + 2 + appCongelado.convertirOzAPuntos(40.0, 700, 53.65)) * 1000) / 1000;
    chk('F7 · ★ el saldo se calcula con los datos congelados, no con el catálogo actual',
        !!inicial4 && inicial4.saldos['PRD-001'] === esperado1,
        'esperado ' + esperado1 + ' · recibido ' + (inicial4 && inicial4.saldos['PRD-001']));

    // ═══════════════════════════════════════════════════════════════════
    //  F · F8 — Solo domingo (decisión N-1)
    // ═══════════════════════════════════════════════════════════════════
    await sembrarCerrado('inv-5', { numero: 105, fechaRecuento: '2026-09-16' }); // miércoles
    const appMiercoles = montarApp(dbAdmin, 'jefe', { admin: true });
    await appMiercoles.contabilizar('inv-5', 105);
    chk('F8 · un recuento en miércoles NO genera inicial',
        (await contarIniciales()) === 0);
    chk('F8 · y el motivo se explica, no se deja un botón mudo',
        appMiercoles._avisos.some(a => /DOMINGO/i.test(a)),
        'avisos: ' + appMiercoles._avisos.join(' | '));

    // ═══════════════════════════════════════════════════════════════════
    //  G · N-4 — Inventarios sin semanaId en la cabecera
    // ═══════════════════════════════════════════════════════════════════
    await sembrarCerrado('inv-6', { numero: 106, semanaId: null });
    const appViejo = montarApp(dbAdmin, 'jefe', { admin: true });
    await appViejo.contabilizar('inv-6', 106);
    chk('N-4 · un inventario cerrado antes del paso previo se bloquea con motivo',
        (await contarIniciales()) === 0 &&
        appViejo._avisos.some(a => /antes de que se guardara la semana/i.test(a)),
        'avisos: ' + appViejo._avisos.join(' | '));

    // ═══════════════════════════════════════════════════════════════════
    //  H · Permisos — el servidor manda
    // ═══════════════════════════════════════════════════════════════════
    await sembrarCerrado('inv-7', { numero: 107 });
    const appBart = montarApp(dbBart, 'bart1', { admin: false, permisos: ['inventory.post'] });
    await appBart.contabilizar('inv-7', 107);
    chk('P9 · ★ aunque el cliente crea tener el permiso, el servidor lo rechaza',
        (await contarIniciales()) === 0,
        'la seguridad no depende de que el botón esté oculto');
    const inv7 = await leerInventario('inv-7');
    chk('P9 · y el inventario no queda a medias',
        inv7 && inv7.estado === 'CERRADO', 'estado=' + (inv7 && inv7.estado));

    // ═══════════════════════════════════════════════════════════════════
    //  I · Un inventario que no está cerrado
    // ═══════════════════════════════════════════════════════════════════
    await sembrarCerrado('inv-8', { numero: 108 });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc(R + '/inventories/inv-8').update({ estado: 'SINCRONIZADO' });
    });
    const appAbierto = montarApp(dbAdmin, 'jefe', { admin: true });
    await appAbierto.contabilizar('inv-8', 108);
    chk('P12 · un inventario abierto no se puede contabilizar',
        (await contarIniciales()) === 0 &&
        appAbierto._avisos.some(a => /CERRADO/i.test(a)),
        'avisos: ' + appAbierto._avisos.join(' | '));

    await testEnv.cleanup();

    console.log('\n  ' + total + ' comprobaciones de integración · ' +
                (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
