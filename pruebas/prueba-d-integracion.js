/**
 * prueba-d-integracion.js — D de punta a punta contra Firestore REAL
 * ═══════════════════════════════════════════════════════════════════════════
 * No es una simulación. Se carga js/40-firestore.js tal como se publica y se
 * le inyecta el emulador oficial de Firestore, con firestore.rules aplicadas
 * byte a byte. Después se reproduce lo que pasa en la barra:
 *
 *   A. El bartender cuenta SIN SEÑAL. El conteo queda anotado como pendiente
 *      y NO se pierde.
 *   B. Vuelve la señal. El conteo llega a la nube solo, sin que nadie toque
 *      nada.
 *   C. Mientras estaba sin señal, otro contó el mismo producto. El reintento
 *      NO pisa ese conteo: lo registra como conflicto.
 *   D. Un conteo confirmado sale de pendientes; uno rechazado por versión
 *      también, pero por motivos opuestos.
 *   E. Un corte de red no se confunde con un conflicto de versión.
 *   F. El registro de pendientes sobrevive al cierre de la app.
 *   G. La ruta del Inventario Físico (userAuditoria) sigue intacta.
 *
 * ── CÓMO EJECUTAR ──
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-d-integracion.js"
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

/**
 * Monta js/40-firestore.js con un Firestore de verdad. Cada llamada devuelve
 * un "teléfono" independiente, con su propia caché de versiones y su propio
 * localStorage — que es exactamente lo que distingue a dos aparatos.
 *
 * Sobre el uso de `new Function` + `with` en vez de vm.createContext: un
 * contexto de vm tiene sus propios intrínsecos, y el SDK de Firestore rechaza
 * como tipo no soportado los objetos creados ahí. Envolviendo el archivo en
 * una función del realm principal, los objetos que crea son objetos normales
 * y lo que se prueba es el comportamiento real.
 */
function montarTelefono(db, uid, opciones) {
    opciones = opciones || {};
    const avisos = [];
    const almacenamiento = Object.assign({}, opciones.localStorage || {});

    const deps = {
        navigator: { onLine: opciones.onLine !== false },
        _db: db,
        FIRESTORE_DOC_ID: DOC_ID,
        currentUserUid: uid,
        currentUserRole: opciones.admin ? 'admin' : 'user',
        currentUser: { uid: uid, email: uid + '@local' },
        _deviceId: 'disp-' + uid,
        products: [{ id: 'PRD-001', name: 'Don Julio 70' }],
        AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
        inventarioConteo: opciones.inventarioConteo || {},
        isAdmin: () => !!opciones.admin,
        showNotification: (t) => avisos.push(String(t)),
        updateCloudSyncBadge() {},
        saveToLocalStorage() {},
        syncStockByAreaFromConteo() {},
        _registrarEnSyncQueue() {},
        _registrarConflictos(lista) { deps._conflictos.push(...lista); },
        _conflictos: [],
        firebase: fb,
        _auth: null,
        localStorage: {
            _d: almacenamiento,
            getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
            setItem(k, v) { this._d[k] = String(v); },
            removeItem(k) { delete this._d[k]; }
        },
        console: { warn() {}, error() {}, info() {}, log() {} },
    };
    deps.window = deps;

    const fuente = fs.readFileSync(path.join(RAIZ, 'js/40-firestore.js'), 'utf8');
    const montar = new Function('deps', 'with (deps) {\n' + fuente +
        '\n; return {' +
        '   syncConteoProductoAtomico: syncConteoProductoAtomico,' +
        '   drenarConteosPendientes:   drenarConteosPendientes,' +
        '   _leerConteoProducto:       _leerConteoProducto,' +
        '   _outboxCargar:             _outboxCargar,' +
        '   _outboxPendientes:         _outboxPendientes,' +
        '   _outboxAnotar:             _outboxAnotar,' +
        '   _esErrorDeRed:             _esErrorDeRed' +
        ' }; }');

    let api;
    try { api = montar(deps); }
    catch (e) { throw new Error('No se pudo montar 40-firestore.js: ' + e.message); }

    api._avisos      = avisos;
    api._navigator   = deps.navigator;
    api._deps        = deps;
    api._localStore  = almacenamiento;
    return api;
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8'),
            host: 'localhost',
            port: 8080
        }
    });

    async function sembrar() {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            await d.doc('usuarios/bart1').set({ role: 'user',  status: 'activo' });
            await d.doc('usuarios/bart2').set({ role: 'user',  status: 'activo' });
            await d.doc('usuarios/jefe').set({ role: 'admin', status: 'activo' });
        });
    }

    const RUTA = 'inventarioApp/' + DOC_ID + '/stockAreas/almacen/productos/PRD-001';
    const leerServidor = async () => {
        let datos = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(RUTA).get();
            datos = s.exists ? s.data() : null;
        });
        return datos;
    };

    console.log('\n  ── D · integración contra el emulador real de Firestore ──\n');

    // ══════════════════════════════════════════════════════════════════════
    //  A · El bartender cuenta SIN SEÑAL
    // ══════════════════════════════════════════════════════════════════════
    await sembrar();
    let guardadoOffline;
    {
        const db  = testEnv.authenticatedContext('bart1').firestore();
        const tel = montarTelefono(db, 'bart1', {
            onLine: false,
            inventarioConteo: { 'PRD-001': { almacen: { enteras: 7, abiertas: [0.5] } } }
        });

        chk('drenarConteosPendientes existe en el archivo real',
            typeof tel.drenarConteosPendientes === 'function');

        const res = await tel.syncConteoProductoAtomico('PRD-001', 'almacen', 7, [0.5]);

        chk('Sin señal la función avisa que no subió',
            res && res.ok === false && res.motivo === 'offline',
            JSON.stringify(res));

        chk('Sin señal NO se escribe nada en el servidor',
            (await leerServidor()) === null);

        chk('El conteo queda anotado como pendiente',
            tel._outboxPendientes().includes('PRD-001|almacen'),
            'pendientes: ' + JSON.stringify(tel._outboxPendientes()));

        chk('El pendiente queda guardado en el aparato, no solo en memoria',
            !!tel._localStore['inventarioApp_conteoPendiente'] &&
            tel._localStore['inventarioApp_conteoPendiente'].includes('PRD-001|almacen'));

        guardadoOffline = tel._localStore;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  B · Vuelve la señal (y la app se había cerrado entretanto)
    // ══════════════════════════════════════════════════════════════════════
    {
        const db  = testEnv.authenticatedContext('bart1').firestore();
        // Teléfono nuevo: caché de versiones vacía, pero el registro de
        // pendientes sobrevivió en el aparato. Es el caso real de cerrar la
        // app en la bodega y volver a abrirla en la barra.
        const tel = montarTelefono(db, 'bart1', {
            onLine: true,
            localStorage: guardadoOffline,
            inventarioConteo: { 'PRD-001': { almacen: { enteras: 7, abiertas: [0.5] } } }
        });

        tel._outboxCargar();
        chk('Al arrancar se recupera el pendiente que dejó la sesión anterior',
            tel._outboxPendientes().includes('PRD-001|almacen'));

        const r = await tel.drenarConteosPendientes();

        chk('El drenaje confirma el conteo',
            r.confirmados === 1 && r.conflictos === 0, JSON.stringify(r));

        const doc = await leerServidor();
        chk('El conteo hecho sin señal YA está en la nube',
            doc && doc.enteras === 7, JSON.stringify(doc));
        chk('Con sus onzas intactas',
            doc && Array.isArray(doc.abiertas) && doc.abiertas[0] === 0.5);
        chk('Y con versión 1, como un conteo nuevo',
            doc && doc.version === 1, 'versión: ' + (doc && doc.version));

        chk('Ya no queda nada pendiente',
            tel._outboxPendientes().length === 0);
        chk('El aparato tampoco guarda pendientes',
            tel._localStore['inventarioApp_conteoPendiente'] === '{}');
        chk('Se avisa al usuario de que el conteo ya subió',
            tel._avisos.some(a => /ya llegaron a la nube/.test(a)),
            JSON.stringify(tel._avisos));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  C · Sin señal, y mientras tanto OTRO contó el mismo producto
    //      Este es el caso que decide si el arreglo sirve o destruye datos.
    // ══════════════════════════════════════════════════════════════════════
    await sembrar();
    {
        // El servidor ya tiene el conteo de otro bartender, versión 1.
        const dbOtro  = testEnv.authenticatedContext('bart2').firestore();
        const telOtro = montarTelefono(dbOtro, 'bart2');
        await telOtro.syncConteoProductoAtomico('PRD-001', 'almacen', 3, []);

        const antes = await leerServidor();
        chk('Punto de partida: el compañero dejó 3 en el servidor',
            antes && antes.enteras === 3 && antes.version === 1);

        // Nuestro bartender contó 7 sin señal, sin saber nada de eso.
        const db  = testEnv.authenticatedContext('bart1').firestore();
        const tel = montarTelefono(db, 'bart1', {
            onLine: false,
            inventarioConteo: { 'PRD-001': { almacen: { enteras: 7, abiertas: [] } } }
        });
        await tel.syncConteoProductoAtomico('PRD-001', 'almacen', 7, []);
        chk('Quedó pendiente, sin conocer la versión del servidor',
            tel._outboxPendientes().includes('PRD-001|almacen'));

        // Vuelve la señal.
        tel._navigator.onLine = true;
        const r = await tel.drenarConteosPendientes();

        chk('El reintento NO sube el conteo: detecta que el servidor se movió',
            r.confirmados === 0 && r.conflictos === 1, JSON.stringify(r));

        const despues = await leerServidor();
        chk('El conteo del compañero SIGUE INTACTO en el servidor',
            despues && despues.enteras === 3 && despues.version === 1,
            'quedó: ' + JSON.stringify(despues));

        chk('Queda registrado como conflicto para que lo resuelva una persona',
            tel._deps._conflictos.length === 1 &&
            tel._deps._conflictos[0].tipo === 'version_mismatch',
            JSON.stringify(tel._deps._conflictos));

        chk('El conflicto guarda ambos valores, el local y el de la nube',
            tel._deps._conflictos[0].valorLocal === 7 &&
            tel._deps._conflictos[0].valorNube === 3);

        chk('Se avisa al usuario en vez de dejarlo creer que subió',
            tel._avisos.some(a => /alguien más actualizó/.test(a)),
            JSON.stringify(tel._avisos));

        chk('El pendiente no se reintenta en bucle: sale de la lista',
            tel._outboxPendientes().length === 0);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  D · Dos aparatos con señal: el bloqueo optimista sigue funcionando
    // ══════════════════════════════════════════════════════════════════════
    await sembrar();
    {
        const db1 = testEnv.authenticatedContext('bart1').firestore();
        const db2 = testEnv.authenticatedContext('bart2').firestore();
        const t1  = montarTelefono(db1, 'bart1');
        const t2  = montarTelefono(db2, 'bart2');

        const r1 = await t1.syncConteoProductoAtomico('PRD-001', 'almacen', 4, []);
        chk('El primero escribe y queda confirmado',
            r1.ok === true && r1.version === 1);
        chk('Y sale de pendientes al confirmarse',
            t1._outboxPendientes().length === 0);

        const r2 = await t2.syncConteoProductoAtomico('PRD-001', 'almacen', 9, []);
        chk('El segundo también, porque lee la versión real antes de escribir',
            r2.ok === true && r2.version === 2);

        // Ahora el primero, con su caché desactualizada, intenta de nuevo.
        const r3 = await t1.syncConteoProductoAtomico('PRD-001', 'almacen', 5, []);
        chk('El que tenía la versión vieja es rechazado',
            r3.ok === false && r3.motivo === 'conflicto_version', JSON.stringify(r3));

        const doc = await leerServidor();
        chk('El servidor conserva el valor del que sí iba al día',
            doc.enteras === 9 && doc.version === 2, JSON.stringify(doc));

        chk('Un rechazo por versión NO se queda reintentándose solo',
            t1._outboxPendientes().length === 0,
            'reintentarlo pisaría el conteo del otro');
    }

    // ══════════════════════════════════════════════════════════════════════
    //  E · Un corte de red no es un conflicto de versión
    // ══════════════════════════════════════════════════════════════════════
    {
        const tel = montarTelefono(null, 'bart1');
        chk('Un error de red se reconoce como tal',
            tel._esErrorDeRed({ code: 'unavailable' }) === true &&
            tel._esErrorDeRed({ code: 'deadline-exceeded' }) === true);
        chk('Un rechazo de las reglas NO se confunde con red',
            tel._esErrorDeRed({ code: 'permission-denied' }) === false,
            'si se confundieran, un rechazo de versión se reintentaría solo');
    }

    // ══════════════════════════════════════════════════════════════════════
    //  F · Lo que anotó la versión anterior no se pierde
    // ══════════════════════════════════════════════════════════════════════
    await sembrar();
    {
        const db  = testEnv.authenticatedContext('bart1').firestore();
        const tel = montarTelefono(db, 'bart1', {
            onLine: true,
            // Formato antiguo: un array bajo la clave vieja.
            localStorage: {
                'inventarioApp_conteoProductoPendiente': JSON.stringify(['PRD-001|almacen'])
            },
            inventarioConteo: { 'PRD-001': { almacen: { enteras: 6, abiertas: [] } } }
        });

        tel._outboxCargar();
        chk('Se migra lo que dejó anotado la versión anterior',
            tel._outboxPendientes().includes('PRD-001|almacen'));
        chk('Y se borra la clave vieja para no migrarlo dos veces',
            tel._localStore['inventarioApp_conteoProductoPendiente'] === undefined);

        const r = await tel.drenarConteosPendientes();
        chk('Ese conteo heredado también llega a la nube',
            r.confirmados === 1, JSON.stringify(r));
        chk('Con el valor correcto',
            (await leerServidor()).enteras === 6);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  G · Lo que D no debía tocar
    // ══════════════════════════════════════════════════════════════════════
    await sembrar();
    {
        const db = testEnv.authenticatedContext('bart1').firestore();

        // El Inventario Físico escribe por otra ruta, que D no modifica.
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore()
                .doc('inventarioApp/' + DOC_ID + '/inventories/inv-activo')
                .set({ inventoryId: 'inv-activo', estado: 'SINCRONIZADO', numero: 101 });
        });

        let ok = true;
        try {
            await db.doc('inventarioApp/' + DOC_ID + '/userAuditoria/bart1').set({
                uid: 'bart1', sessionId: 'inv-activo', conteo: {},
                status: { almacen: 'completada' },
                finalizadas: { almacen: { uid: 'bart1', nombre: 'bart1@local', ts: Date.now() } }
            });
        } catch (e) { ok = false; }
        chk('El conteo del Inventario Físico sigue funcionando igual', ok);

        let denegado = false;
        try {
            await db.doc('inventarioApp/' + DOC_ID + '/userAuditoria/bart2')
                .set({ uid: 'bart2', sessionId: 'inv-activo', conteo: {} });
        } catch (e) { denegado = true; }
        chk('Y sigue sin poderse escribir el de otro', denegado);

        const tel = montarTelefono(db, 'bart1');
        const r = await tel.syncConteoProductoAtomico('PRD-001', 'barra2', 1, []);
        chk('El conteo del día a día tampoco cambió de ruta',
            r.ok === true && r.version === 1);
        let existe = false;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore()
                .doc('inventarioApp/' + DOC_ID + '/stockAreas/barra2/productos/PRD-001').get();
            existe = s.exists;
        });
        chk('Se escribió donde siempre: stockAreas/{area}/productos/{id}', existe);
    }

    await testEnv.cleanup();

    console.log('\n  ' + total + ' comprobaciones · ' + (total - fallos) +
                ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
