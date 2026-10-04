/**
 * prueba-f1-integracion.js — F1 de punta a punta contra Firestore REAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Esto NO es una simulación. Se carga el archivo js/40-firestore.js tal como
 * se publica y se le inyecta una instancia REAL de Firestore (el emulador
 * oficial de Google, con firestore.rules aplicadas byte a byte). Después se
 * llama a syncConteoProductoAtomico() exactamente como la llama la app cuando
 * un bartender guarda un conteo, y se comprueba qué quedó escrito en la base.
 *
 * Responde, con evidencia de ejecución, a lo que se pidió para cerrar F1:
 *
 *   A. Guardar un conteo funciona y escribe el documento correcto.
 *   B. Un SEGUNDO dispositivo recibe el cambio.
 *   C. El reintento funciona.
 *   D. No se crean documentos duplicados.
 *   E. La ruta userAuditoria del Inventario Físico NO se altera.
 *   F. Sin conexión no se escribe, y al reconectar sí.
 *
 * ── CÓMO EJECUTAR ──
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-f1-integracion.js"
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
 * Monta el archivo REAL js/40-firestore.js en un contexto con un Firestore de
 * verdad. Cada llamada devuelve un "dispositivo" independiente: su propio
 * contexto, su propia caché de versiones y su propia sesión — que es justo lo
 * que hace falta para probar dos teléfonos a la vez.
 */
function montarDispositivo(db, uid, opciones) {
    opciones = opciones || {};
    const avisos = [];

    // OJO — por qué NO se usa vm.createContext aquí:
    // un contexto de vm tiene sus PROPIOS intrínsecos, así que el objeto que
    // el código de la app construye para escribir ({enteras, abiertas, ...})
    // lleva el Object.prototype de ESE contexto. El SDK de Firestore lo
    // rechaza como tipo no soportado y devuelve invalid-argument, que no
    // tiene nada que ver con la app. Envolviendo el archivo en una función
    // del realm principal, los objetos que crea son objetos normales y lo
    // que se prueba es el comportamiento real.
    //
    // El `with` además hace que cada dispositivo tenga su propia copia de las
    // variables de módulo del archivo — incluida la caché de versiones
    // _versionesConteoProducto — que es justo lo que distingue a dos
    // teléfonos distintos.
    const deps = {
        navigator: { onLine: opciones.onLine !== false },
        _db: db,
        FIRESTORE_DOC_ID: DOC_ID,
        currentUserUid: uid,
        currentUser: { uid: uid, email: uid + '@local' },
        _deviceId: 'disp-' + uid,
        products: [{ id: 'PRD-001', name: 'Don Julio 70' }],
        AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
        isAdmin: () => !!opciones.admin,
        showNotification: (t) => avisos.push(String(t)),
        updateCloudSyncBadge() {},
        saveToLocalStorage() {},
        _registrarEnSyncQueue() {},
        _registrarConflictos() {},
        firebase: fb,
        _auth: null,
        localStorage: {
            _d: {}, getItem(k) { return this._d[k] || null; },
            setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
        },
        console: { warn() {}, error() {}, info() {}, log() {} },
    };

    // El archivo tiene bloques de arranque que miran window._auth. Se apunta
    // window a las propias dependencias para que resuelvan sin tocar nada más.
    deps.window = deps;

    const fuente = fs.readFileSync(path.join(RAIZ, 'js/40-firestore.js'), 'utf8');
    const montar = new Function('deps', 'with (deps) {\n' + fuente +
        '\n; return { syncConteoProductoAtomico: syncConteoProductoAtomico,' +
        '            _leerConteoProducto: _leerConteoProducto }; }');

    let api;
    try { api = montar(deps); }
    catch (e) { throw new Error('No se pudo montar 40-firestore.js: ' + e.message); }

    api._avisos    = avisos;
    api._navigator = deps.navigator;
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

    // Siembra mínima: el bartender necesita su documento usuarios/{uid} para
    // que isAdminUser() de las reglas se evalúe sin error.
    async function sembrar() {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            await d.doc('usuarios/bart1').set({ role: 'user',  status: 'activo' });
            await d.doc('usuarios/bart2').set({ role: 'user',  status: 'activo' });
            await d.doc('usuarios/jefe').set({ role: 'admin', status: 'activo' });
        });
    }

    const RUTA_CONTEO = 'inventarioApp/' + DOC_ID + '/stockAreas/almacen/productos/PRD-001';

    console.log('\n  ── F1 · integración contra el emulador real de Firestore ──\n');

    // ══════════════════════════════════════════════════════════════════════
    //  A · Guardar un conteo funciona y escribe el documento correcto
    // ══════════════════════════════════════════════════════════════════════
    await sembrar();
    {
        const db  = testEnv.authenticatedContext('bart1').firestore();
        const tel = montarDispositivo(db, 'bart1');

        chk('La función está definida tras cargar el archivo real',
            typeof tel.syncConteoProductoAtomico === 'function');

        let res, err = null;
        try { res = await tel.syncConteoProductoAtomico('PRD-001', 'almacen', 2, [33.45]); }
        catch (e) { err = e; }

        chk('A1 · Guardar un conteo NO lanza excepción', err === null,
            err ? err.constructor.name + ': ' + err.message : '');
        chk('A2 · Devuelve ok:true', res && res.ok === true, JSON.stringify(res));
        chk('A3 · Devuelve version 1 en el primer conteo', res && res.version === 1);

        let leido = null;
        await testEnv.withSecurityRulesDisabled(async (c) => {
            const s = await c.firestore().doc(RUTA_CONTEO).get();
            leido = s.exists ? s.data() : null;
        });
        chk('A4 · El documento EXISTE en Firestore', leido !== null,
            'esto es lo que antes nunca ocurría');
        chk('A5 · Guardó las 2 botellas enteras', leido && leido.enteras === 2, JSON.stringify(leido));
        chk('A6 · Guardó las 33.45 oz abiertas',
            leido && Array.isArray(leido.abiertas) && leido.abiertas[0] === 33.45);
        chk('A7 · Guardó quién lo capturó', leido && leido.actualizadoPor === 'bart1');
        chk('A8 · Guardó la marca de tiempo del servidor', leido && leido.ts !== undefined && leido.ts !== null);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  B · Un segundo dispositivo recibe el cambio
    // ══════════════════════════════════════════════════════════════════════
    {
        const db2  = testEnv.authenticatedContext('bart2').firestore();
        const tel2 = montarDispositivo(db2, 'bart2');
        const visto = await tel2._leerConteoProducto('PRD-001', 'almacen');

        chk('B1 · El segundo dispositivo LEE el conteo del primero',
            visto && visto.enteras === 2 && visto.abiertas[0] === 33.45,
            JSON.stringify(visto));
        chk('B2 · Y ve la misma versión', visto && visto.version === 1);

        // Ese segundo teléfono ahora corrige el conteo.
        const res2 = await tel2.syncConteoProductoAtomico('PRD-001', 'almacen', 5, []);
        chk('B3 · El segundo dispositivo puede escribir encima', res2 && res2.ok === true,
            JSON.stringify(res2));
        chk('B4 · Y la versión avanza a 2, no se reinicia', res2 && res2.version === 2,
            'el optimistic locking exige version+1');

        // El primero vuelve a leer y ve la corrección.
        const db1  = testEnv.authenticatedContext('bart1').firestore();
        const tel1 = montarDispositivo(db1, 'bart1');
        const vuelta = await tel1._leerConteoProducto('PRD-001', 'almacen');
        chk('B5 · El primer dispositivo ve la corrección del segundo',
            vuelta && vuelta.enteras === 5, JSON.stringify(vuelta));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  C · El reintento funciona (conflicto de versión y recuperación)
    // ══════════════════════════════════════════════════════════════════════
    await sembrar();
    {
        const telA = montarDispositivo(testEnv.authenticatedContext('bart1').firestore(), 'bart1');
        const telB = montarDispositivo(testEnv.authenticatedContext('bart2').firestore(), 'bart2');

        // Para que haya conflicto de verdad, B tiene que tener una versión
        // CACHEADA y quedarse atrás. Solo leer no basta: si el dispositivo no
        // tiene versión en caché, el código pregunta al servidor antes de
        // escribir — precisamente para no provocar rechazos evitables. Así que
        // B escribe primero (queda con versión 1 en caché) y A avanza después.
        await telB.syncConteoProductoAtomico('PRD-001', 'almacen', 1, []);   // servidor v1, caché B = 1
        await telA.syncConteoProductoAtomico('PRD-001', 'almacen', 2, []);   // servidor v2 (A leyó antes)

        // B escribe creyendo que sigue en la 1 → el servidor lo rechaza.
        const choque = await telB.syncConteoProductoAtomico('PRD-001', 'almacen', 9, []);
        chk('C1 · Una escritura con versión vieja es RECHAZADA',
            choque && choque.ok === false && choque.motivo === 'conflicto_version',
            JSON.stringify(choque && { ok: choque.ok, motivo: choque.motivo }));
        chk('C2 · Al usuario se le avisa del conflicto, no falla en silencio',
            telB._avisos.some(t => /actualiz/i.test(t)),
            JSON.stringify(telB._avisos));

        // El reintento: tras el rechazo, la caché de versión se refrescó sola.
        const reintento = await telB.syncConteoProductoAtomico('PRD-001', 'almacen', 9, []);
        chk('C3 · El REINTENTO sí entra', reintento && reintento.ok === true,
            JSON.stringify(reintento));
        chk('C4 · Y lo hace con la versión correcta (3)', reintento && reintento.version === 3);

        let final = null;
        await testEnv.withSecurityRulesDisabled(async (c) => {
            const s = await c.firestore().doc(RUTA_CONTEO).get();
            final = s.data();
        });
        chk('C5 · El valor del reintento es el que quedó', final && final.enteras === 9,
            JSON.stringify(final));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  D · No se crean documentos duplicados
    // ══════════════════════════════════════════════════════════════════════
    await sembrar();
    {
        const tel = montarDispositivo(testEnv.authenticatedContext('bart1').firestore(), 'bart1');
        for (let i = 1; i <= 5; i++) {
            await tel.syncConteoProductoAtomico('PRD-001', 'almacen', i, []);
        }
        let docs = [];
        await testEnv.withSecurityRulesDisabled(async (c) => {
            const s = await c.firestore()
                .collection('inventarioApp/' + DOC_ID + '/stockAreas/almacen/productos').get();
            docs = s.docs.map(d => ({ id: d.id, enteras: d.data().enteras, version: d.data().version }));
        });
        chk('D1 · Cinco guardados dejan UN solo documento', docs.length === 1,
            'documentos: ' + JSON.stringify(docs));
        chk('D2 · Con el último valor capturado', docs[0] && docs[0].enteras === 5);
        chk('D3 · Y la versión avanzó una vez por guardado', docs[0] && docs[0].version === 5);

        // Otra área del mismo producto es OTRO documento, no una sobrescritura.
        await tel.syncConteoProductoAtomico('PRD-001', 'barra1', 7, []);
        let porArea = {};
        await testEnv.withSecurityRulesDisabled(async (c) => {
            for (const a of ['almacen', 'barra1']) {
                const s = await c.firestore()
                    .doc('inventarioApp/' + DOC_ID + '/stockAreas/' + a + '/productos/PRD-001').get();
                porArea[a] = s.exists ? s.data().enteras : null;
            }
        });
        chk('D4 · Cada área guarda su propio conteo sin pisar la otra',
            porArea.almacen === 5 && porArea.barra1 === 7, JSON.stringify(porArea));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  E · La ruta userAuditoria del Inventario Físico NO se altera
    // ══════════════════════════════════════════════════════════════════════
    await sembrar();
    {
        // Se siembra un conteo de Inventario Físico como lo deja la app.
        await testEnv.withSecurityRulesDisabled(async (c) => {
            await c.firestore().doc('inventarioApp/' + DOC_ID + '/userAuditoria/bart1').set({
                sessionId: 'inv-activo', email: 'bart1@local', isAdmin: false,
                conteo: { 'PRD-001': { almacen: { enteras: 4, abiertas: [12.0], _ts: 111 } } },
                status: { almacen: 'completada' }, updatedAt: 111
            });
        });

        const tel = montarDispositivo(testEnv.authenticatedContext('bart1').firestore(), 'bart1');
        await tel.syncConteoProductoAtomico('PRD-001', 'almacen', 99, [1.5]);

        let aud = null;
        await testEnv.withSecurityRulesDisabled(async (c) => {
            const s = await c.firestore().doc('inventarioApp/' + DOC_ID + '/userAuditoria/bart1').get();
            aud = s.data();
        });
        chk('E1 · El conteo del Inventario Físico sigue intacto',
            aud && aud.conteo['PRD-001'].almacen.enteras === 4 &&
            aud.conteo['PRD-001'].almacen.abiertas[0] === 12.0,
            JSON.stringify(aud && aud.conteo));
        chk('E2 · Su estado de área sigue intacto',
            aud && aud.status.almacen === 'completada');
        chk('E3 · Y su sesión sigue siendo la misma', aud && aud.sessionId === 'inv-activo',
            'son dos rutas distintas y F1 solo tocó una');
    }

    // ══════════════════════════════════════════════════════════════════════
    //  F · Sin conexión no escribe; al reconectar sí
    // ══════════════════════════════════════════════════════════════════════
    await sembrar();
    {
        const sinRed = montarDispositivo(
            testEnv.authenticatedContext('bart1').firestore(), 'bart1', { onLine: false });
        const res = await sinRed.syncConteoProductoAtomico('PRD-001', 'almacen', 3, []);
        chk('F1 · Sin conexión devuelve offline, no un falso éxito',
            res && res.ok === false && res.motivo === 'offline', JSON.stringify(res));

        let existe = true;
        await testEnv.withSecurityRulesDisabled(async (c) => {
            existe = (await c.firestore().doc(RUTA_CONTEO).get()).exists;
        });
        chk('F2 · Y no dejó nada a medias en la base', existe === false);

        // Vuelve la red: el mismo dispositivo reintenta.
        sinRed._navigator.onLine = true;
        const res2 = await sinRed.syncConteoProductoAtomico('PRD-001', 'almacen', 3, []);
        chk('F3 · Al reconectar, el mismo conteo sube', res2 && res2.ok === true,
            JSON.stringify(res2));

        let leido = null;
        await testEnv.withSecurityRulesDisabled(async (c) => {
            leido = (await c.firestore().doc(RUTA_CONTEO).get()).data();
        });
        chk('F4 · Y el valor en la base es el capturado sin red',
            leido && leido.enteras === 3, JSON.stringify(leido));
    }

    await testEnv.cleanup();

    console.log('\n  ' + total + ' comprobaciones de integración · ' +
                (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error('Error fatal en la prueba:', e); process.exit(1); });
