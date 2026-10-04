/**
 * prueba-fase5-integracion.js — FASE 5 (5A + 5B) de punta a punta contra Firestore REAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Esto NO es una simulación. Se monta el archivo js/40-firestore.js tal como
 * se publica (para 5B), y se AÍSLA la función real subscribeMyAuditoria() de
 * js/45-inventario-datos.js (para 5A) contra el emulador oficial de Firestore
 * con firestore.rules aplicadas byte a byte.
 *
 * prueba-fase5.js ya prueba, a nivel ESTRUCTURAL, que el código tiene la forma
 * correcta (orden de operaciones, uso de sessionAnterior en vez de la variable
 * mutable, guardas presentes). Esta prueba demuestra con EJECUCIÓN que el
 * comportamiento realmente ocurre — mismo criterio de cierre que FASE 3
 * (prueba-f3-integracion.js) y FASE 4 (prueba-p2-integracion.js), y aquí con
 * más razón: FASE 5 toca "cero pérdida de datos" (prioridad #1 del proyecto).
 *
 *   ── 5B: conteo de auditoría huérfano ──
 *   H1   Con _auditSyncPending y conteo con contenido → se archiva en Firestore.
 *   H2   El bartender recibe aviso de que su conteo se guardó aparte.
 *   H3   Queda registrado en la cola de auditoría (_registrarEnSyncQueue).
 *   H4   ★ Sin _auditSyncPending, NO se archiva nada aunque haya conteo.
 *   H5   ★ Con _auditSyncPending pero conteo vacío, NO se archiva.
 *   H6   ★ Sin conexión: se encola localmente, NO llega a Firestore.
 *   H7   Al reconectar, reintentarConteosHuerfanosPendientes() sube lo
 *        encolado y limpia la cola local.
 *   H8   ★ userAuditoria/{uid} NUNCA se toca desde esta ruta — no hay mezcla
 *        automática con la sesión nueva.
 *   H9   ★ Reintentar archivar la misma sesión no corrompe el documento ya
 *        archivado (las reglas rechazan el update; el código no revienta).
 *   H10  El id del documento es exactamente uid_sessionId.
 *
 *   ── 5A: reapertura de área real (listener en vivo) ──
 *   J1   Estado inicial coincidente (servidor y local en 'completada') → el
 *        listener no reacciona.
 *   J2   ★ El admin reabre el área con la ESCRITURA REAL de reabrirArea()
 *        (docPrincipal.collection('userAuditoria').doc(uid).update({...})) y
 *        el listener EN VIVO del bartender lo refleja solo, sin recargar.
 *   J3   myAuditoriaFinalizadas[area] se borra tras la reapertura.
 *   J4   Se dispara showNotification y renderTab.
 *   J5   ★ El sentido inverso (servidor sigue 'completada') NO reescribe el
 *        estado local — alcance deliberado, no un olvido.
 *   J6   Regresión: Path C (unlocks) del mismo listener sigue funcionando.
 *
 * ── CÓMO EJECUTAR ──
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-fase5-integracion.js"
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
const R          = 'inventarioApp/' + DOC_ID;

let fallos = 0, total = 0;
function chk(nombre, ok, detalle) {
    total++;
    if (ok) { console.log('  ✅ ' + nombre); }
    else    { fallos++; console.error('  ❌ ' + nombre + (detalle ? '  ← ' + detalle : '')); }
}

// Espera activa con timeout — no hay precedente en este repo para probar un
// onSnapshot en vivo, así que este helper es nuevo. Sondea cada `paso` ms
// hasta que `condicion()` sea verdadera o se agote `timeoutMs`.
function esperarHasta(condicion, timeoutMs, paso) {
    timeoutMs = timeoutMs || 4000;
    paso = paso || 40;
    const limite = Date.now() + timeoutMs;
    return new Promise(function(resolve) {
        (function intentar() {
            if (condicion()) { resolve(true); return; }
            if (Date.now() > limite) { resolve(false); return; }
            setTimeout(intentar, paso);
        })();
    });
}
// Pausa simple: usada solo para dar tiempo a que un listener en vivo procese
// un evento antes de comprobar que NO pasó nada (caso J5, J1).
function pausa(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ═══════════════════════════════════════════════════════════════════════
//  5B — Monta js/40-firestore.js REAL, sin recortar nada.
//  Mismo criterio que montarCompras() en prueba-p2-integracion.js: el
//  archivo entero se mueve solo, con un doble mínimo del resto de la app.
// ═══════════════════════════════════════════════════════════════════════
function montarFirestoreAuditoria(db, uid, opciones) {
    opciones = opciones || {};
    const avisos = [];
    const eventos = [];

    const firest = fs.readFileSync(path.join(RAIZ, 'js/40-firestore.js'), 'utf8');

    const deps = {
        navigator: { onLine: opciones.onLine !== false },
        _db: db,
        FIRESTORE_DOC_ID: DOC_ID,
        currentUserUid: uid,
        _deviceId: 'disp-' + uid,
        products: [],
        AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
        myAuditoriaConteo:      opciones.conteo      || {},
        myAuditoriaStatus:      opciones.status      || { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' },
        myAuditoriaFinalizadas: opciones.finalizadas || {},
        auditoriaConteo: {}, inventarioConteo: {},
        _auditoriaSessionId: opciones.sessionId || null,
        isAdmin: () => !!opciones.admin,
        hasPermission: (p) => opciones.admin || (opciones.permisos || []).indexOf(p) !== -1,
        showNotification: (t) => avisos.push(String(t)),
        renderTab() {}, saveToLocalStorage() {}, updateCloudSyncBadge() {},
        _registrarEnSyncQueue(e) { eventos.push(e); },
        _registrarConflictos() {}, escapeHtml: (s) => String(s),
        firebase: fb, _auth: { currentUser: { uid: uid, email: uid + '@local' } },
        localStorage: opciones.localStorage || {
            _d: {}, getItem(k) { return this._d[k] || null; },
            setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
        },
        console: { warn() {}, error() {}, info() {}, log() {} },
        document: {
            getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
            createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} },
                                    appendChild() {}, setAttribute() {}, remove() {} }),
            body: { appendChild() {}, removeChild() {} }, addEventListener() {}
        },
        requestAnimationFrame: (f) => f(),
        setTimeout: (f) => { try { f(); } catch (_) {} return 0; },
        clearTimeout() {}
    };
    deps.window = deps;

    const montar = new Function('deps', 'with (deps) {\n' + firest +
        '\n; return { _archivarConteoHuerfanoSiAplica: _archivarConteoHuerfanoSiAplica,' +
        '            _construirConteoHuerfano: _construirConteoHuerfano,' +
        '            _conteoHuerfanoTieneContenido: _conteoHuerfanoTieneContenido,' +
        '            _intentarSubirConteoHuerfano: _intentarSubirConteoHuerfano,' +
        '            _leerColaConteosHuerfanos: _leerColaConteosHuerfanos,' +
        '            reintentarConteosHuerfanosPendientes: reintentarConteosHuerfanosPendientes,' +
        '            syncMyAuditoriaToFirestore: syncMyAuditoriaToFirestore }; }');

    let api;
    try { api = montar(deps); }
    catch (e) { throw new Error('No se pudo montar js/40-firestore.js: ' + e.message); }

    api._avisos = avisos;
    api._eventos = eventos;
    api._deps = deps;
    return api;
}

// ═══════════════════════════════════════════════════════════════════════
//  5A — Aísla SOLO subscribeMyAuditoria() de js/45-inventario-datos.js.
//  Mismo criterio que la extracción de convertirOzAPuntos en
//  prueba-f3-integracion.js: montar el archivo completo no es viable (tiene
//  demasiadas dependencias cruzadas de UI/orquestación — ver auditoría de
//  esta fase), así que se aísla por texto la función que se necesita.
//  handleAuditSessionChange se deja como stub inerte a propósito: esta
//  prueba existe para demostrar Path D (reapertura), no para reprobar Path B
//  (cambio de sesión), que ya tiene su propia prueba de integración (FASE 3).
// ═══════════════════════════════════════════════════════════════════════
function extraerFuncion(fuente, nombre) {
    const i = fuente.indexOf('function ' + nombre + '(');
    if (i === -1) throw new Error('No se encontró ' + nombre + ' en el archivo fuente');
    let nivel = 0, dentro = false;
    for (let j = i; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(i, j + 1); }
    }
    throw new Error('No se pudo delimitar ' + nombre);
}

function montarListenerPropio(db, uid, opciones) {
    opciones = opciones || {};
    const avisos = [];
    const renders = { n: 0 };

    const fuente = fs.readFileSync(path.join(RAIZ, 'js/45-inventario-datos.js'), 'utf8');
    const cuerpo = extraerFuncion(fuente, 'subscribeMyAuditoria');

    const deps = {
        _db: db,
        FIRESTORE_DOC_ID: DOC_ID,
        currentUserUid: uid,
        myAuditoriaStatus:      opciones.status      || {},
        myAuditoriaUnlocks:     opciones.unlocks     || {},
        myAuditoriaFinalizadas: opciones.finalizadas || {},
        _unsubMyAuditoria: null,
        // Stub deliberado: Path B (cambio de sesión) no es lo que esta
        // prueba cubre. Se limita a reportar "sin cambio" para no interferir
        // con Path D, exactamente como ocurre en producción cuando el
        // sessionId del doc coincide con el vigente (ver comentario en el
        // propio subscribeMyAuditoria: la idempotencia de handleAuditSessionChange
        // ya intercepta ese caso antes de llegar a Path C/D).
        handleAuditSessionChange: function() { return { procesado: false, motivo: 'sin_cambio' }; },
        showNotification: (t) => avisos.push(String(t)),
        saveToLocalStorage() {},
        renderTab() { renders.n++; },
        console: { warn() {}, error() {}, info() {}, log() {} }
    };
    deps.window = deps;

    const montar = new Function('deps', 'with (deps) {\n' + cuerpo +
        '\n; return subscribeMyAuditoria; }');

    let subscribeMyAuditoria;
    try { subscribeMyAuditoria = montar(deps); }
    catch (e) { throw new Error('No se pudo montar subscribeMyAuditoria: ' + e.message); }

    return {
        conectar: function() { subscribeMyAuditoria(); },
        desconectar: function() { if (typeof deps._unsubMyAuditoria === 'function') deps._unsubMyAuditoria(); },
        _deps: deps,
        _avisos: avisos,
        _renders: renders
    };
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8'),
            host: 'localhost', port: 8080
        }
    });

    async function sembrarBase() {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
            await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
            await d.doc('usuarios/reabridor1').set({
                uid: 'reabridor1', role: 'BARTENDER', status: 'activo',
                permissionOverrides: { 'inventory.reopenArea': 'allow' }
            });
        });
    }

    async function leerHuerfano(id) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/conteosAuditoriaHuerfanos/' + id).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function leerUserAuditoria(uid) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/userAuditoria/' + uid).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function escribirUserAuditoria(uid, data) {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc(R + '/userAuditoria/' + uid).set(data);
        });
    }

    const dbJefe  = testEnv.authenticatedContext('jefe').firestore();
    const dbBart1 = testEnv.authenticatedContext('bart1').firestore();

    console.log('\n  ── FASE 5 · 5B (conteo huérfano) contra Firestore real ──\n');

    // ═══════════════════════════════════════════════════════════════════
    //  H1-H3 · Camino feliz: pending + contenido + online → se archiva
    // ═══════════════════════════════════════════════════════════════════
    await sembrarBase();
    const conteoConContenido = { 'PRD001': { almacen: { enteras: 3, abiertas: [] } } };
    const statusConContenido = { almacen: 'completada', barra1: 'pendiente', barra2: 'pendiente' };
    const finalizadasConContenido = { almacen: { finalizadoEn: Date.now(), finalizadoPor: 'bart1' } };

    const appH1 = montarFirestoreAuditoria(dbBart1, 'bart1', {
        conteo: conteoConContenido, status: statusConContenido, finalizadas: finalizadasConContenido,
        onLine: false // primero offline para forzar _auditSyncPending=true de verdad
    });
    await appH1.syncMyAuditoriaToFirestore(); // falla por falta de conexión → marca _auditSyncPending=true
    appH1._deps.navigator.onLine = true;      // ahora sí hay señal para archivar
    const SESSION_VIEJA = '1788115846917';
    await appH1._archivarConteoHuerfanoSiAplica(SESSION_VIEJA);

    const huerfano1 = await leerHuerfano('bart1_' + SESSION_VIEJA);
    chk('H1 · el conteo se archivó en Firestore con el sessionId VIEJO explícito',
        !!huerfano1 && huerfano1.sessionId === SESSION_VIEJA && huerfano1.uid === 'bart1',
        JSON.stringify(huerfano1 && { uid: huerfano1.uid, sessionId: huerfano1.sessionId }));
    chk('H1 · el payload conserva el conteo, el status y las finalizadas tal cual estaban',
        !!huerfano1 &&
        JSON.stringify(huerfano1.conteo) === JSON.stringify(conteoConContenido) &&
        JSON.stringify(huerfano1.status) === JSON.stringify(statusConContenido) &&
        JSON.stringify(huerfano1.finalizadas) === JSON.stringify(finalizadasConContenido),
        JSON.stringify(huerfano1));
    chk('H1 · el id del documento es exactamente uid_sessionId (H10)',
        !!huerfano1, 'se leyó por esa ruta exacta, así que si existe, el id es correcto');
    chk('H2 · el bartender recibe aviso de que su conteo se guardó aparte',
        appH1._avisos.some(a => /guard[oó] aparte/i.test(a)), JSON.stringify(appH1._avisos));
    chk('H3 · queda registrado en la cola de auditoría con el tipo correcto',
        appH1._eventos.some(e => e.tipo === 'conteo_auditoria_huerfano' && e.detalle.indexOf(SESSION_VIEJA) !== -1),
        JSON.stringify(appH1._eventos));
    chk('H8 · userAuditoria/bart1 NO se tocó desde esta ruta (nunca existió, nunca se creó)',
        (await leerUserAuditoria('bart1')) === null);

    // ═══════════════════════════════════════════════════════════════════
    //  H4 · ★ Sin _auditSyncPending, NO se archiva aunque haya conteo
    // ═══════════════════════════════════════════════════════════════════
    await sembrarBase();
    const appH4 = montarFirestoreAuditoria(dbBart1, 'bart1', {
        conteo: conteoConContenido, status: statusConContenido, finalizadas: finalizadasConContenido
    });
    // Nunca se llamó a syncMyAuditoriaToFirestore(): _auditSyncPending sigue en false.
    await appH4._archivarConteoHuerfanoSiAplica('sesion-sin-pendiente');
    chk('H4 · ★ sin sincronización pendiente, no se crea ningún huérfano',
        (await leerHuerfano('bart1_sesion-sin-pendiente')) === null);
    chk('H4 · y no se avisa nada al usuario (no hubo nada que archivar)',
        appH4._avisos.length === 0, JSON.stringify(appH4._avisos));

    // ═══════════════════════════════════════════════════════════════════
    //  H5 · ★ Con _auditSyncPending pero conteo vacío, NO se archiva
    // ═══════════════════════════════════════════════════════════════════
    await sembrarBase();
    const appH5 = montarFirestoreAuditoria(dbBart1, 'bart1', {
        conteo: {}, status: { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' }, finalizadas: {},
        onLine: false
    });
    await appH5.syncMyAuditoriaToFirestore(); // marca pending=true, pero no hay nada que subir
    appH5._deps.navigator.onLine = true;
    await appH5._archivarConteoHuerfanoSiAplica('sesion-vacia');
    chk('H5 · ★ conteo vacío + status todo pendiente + sin finalizadas → no se archiva nada',
        (await leerHuerfano('bart1_sesion-vacia')) === null);

    // ═══════════════════════════════════════════════════════════════════
    //  H6-H7 · Sin conexión: se encola local, y se sube al reconectar
    // ═══════════════════════════════════════════════════════════════════
    await sembrarBase();
    const localStorageCompartido = {
        _d: {}, getItem(k) { return this._d[k] || null; },
        setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
    };
    const appH6 = montarFirestoreAuditoria(dbBart1, 'bart1', {
        conteo: conteoConContenido, status: statusConContenido, finalizadas: finalizadasConContenido,
        onLine: false, localStorage: localStorageCompartido
    });
    await appH6.syncMyAuditoriaToFirestore(); // pending=true
    // OJO: navigator.onLine sigue en false — _archivarConteoHuerfanoSiAplica
    // pasa la guarda de _auditSyncPending, pero _intentarSubirConteoHuerfano
    // debe cortar por falta de señal y encolar, NO intentar escribir.
    await appH6._archivarConteoHuerfanoSiAplica('sesion-offline');
    chk('H6 · ★ sin conexión, el huérfano NO llega a Firestore',
        (await leerHuerfano('bart1_sesion-offline')) === null);
    const colaLocal = appH6._leerColaConteosHuerfanos();
    chk('H6 · ★ pero queda encolado localmente para reintentar',
        colaLocal.length === 1 && colaLocal[0].sessionId === 'sesion-offline',
        JSON.stringify(colaLocal));

    // Se reconecta: nuevo montaje (como sería un nuevo arranque de la app),
    // mismo localStorage compartido para simular la persistencia real.
    const appH7 = montarFirestoreAuditoria(dbBart1, 'bart1', {
        onLine: true, localStorage: localStorageCompartido
    });
    await appH7.reintentarConteosHuerfanosPendientes();
    chk('H7 · ★ al reconectar, el huérfano encolado sube a Firestore',
        !!(await leerHuerfano('bart1_sesion-offline')));
    chk('H7 · y la cola local queda vacía tras subir',
        appH7._leerColaConteosHuerfanos().length === 0,
        JSON.stringify(appH7._leerColaConteosHuerfanos()));

    // ═══════════════════════════════════════════════════════════════════
    //  H9 · ★ Reintentar archivar la MISMA sesión no corrompe lo ya escrito
    //  Las reglas prohíben update/delete sobre este documento — un segundo
    //  intento (p.ej. un reinicio de la app antes de que _auditSyncPending
    //  se limpiara) tiene que fallar en silencio, sin tumbar la app y sin
    //  alterar el documento original.
    // ═══════════════════════════════════════════════════════════════════
    await sembrarBase();
    const appH9a = montarFirestoreAuditoria(dbBart1, 'bart1', {
        conteo: conteoConContenido, status: statusConContenido, finalizadas: finalizadasConContenido, onLine: false
    });
    await appH9a.syncMyAuditoriaToFirestore();
    appH9a._deps.navigator.onLine = true;
    await appH9a._archivarConteoHuerfanoSiAplica('sesion-doble');
    const original = await leerHuerfano('bart1_sesion-doble');
    chk('H9 · el primer archivado quedó escrito', !!original);

    // Segundo intento: mismo conteo pero con una entrada distinta, para
    // detectar si por error SÍ se sobrescribiera (no debería).
    const appH9b = montarFirestoreAuditoria(dbBart1, 'bart1', {
        conteo: { 'PRD999': { almacen: { enteras: 99, abiertas: [] } } },
        status: statusConContenido, finalizadas: finalizadasConContenido, onLine: false
    });
    await appH9b.syncMyAuditoriaToFirestore();
    appH9b._deps.navigator.onLine = true;
    let segundoIntentoLanzoError = false;
    try {
        await appH9b._archivarConteoHuerfanoSiAplica('sesion-doble');
    } catch (e) {
        segundoIntentoLanzoError = true;
    }
    chk('H9 · ★ el segundo intento NO lanza una excepción sin capturar (la app no se cae)',
        segundoIntentoLanzoError === false);
    const trasSegundoIntento = await leerHuerfano('bart1_sesion-doble');
    chk('H9 · ★ y el documento original queda exactamente igual — sin mezclar con el segundo conteo',
        JSON.stringify(trasSegundoIntento) === JSON.stringify(original),
        'original=' + JSON.stringify(original) + ' tras=' + JSON.stringify(trasSegundoIntento));

    console.log('\n  ── FASE 5 · 5A (reapertura de área) contra Firestore real ──\n');

    // ═══════════════════════════════════════════════════════════════════
    //  J1 · Estado inicial coincidente → el listener no reacciona
    // ═══════════════════════════════════════════════════════════════════
    const SESSION = '1788200000000';
    await sembrarBase();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc(R + '/inventories/' + SESSION).set({
            inventoryId: SESSION, estado: 'SINCRONIZADO'
        });
    });
    await escribirUserAuditoria('bart1', {
        uid: 'bart1', sessionId: SESSION,
        status: { almacen: 'completada', barra1: 'pendiente', barra2: 'pendiente' },
        conteo: {}, finalizadas: { almacen: { finalizadoEn: Date.now(), finalizadoPor: 'bart1' } },
        updatedAt: Date.now()
    });

    const listener1 = montarListenerPropio(dbBart1, 'bart1', {
        status: { almacen: 'completada', barra1: 'pendiente', barra2: 'pendiente' },
        finalizadas: { almacen: { finalizadoEn: Date.now(), finalizadoPor: 'bart1' } }
    });
    listener1.conectar();
    // Deja que el snapshot inicial (el estado que ya sembramos) se procese.
    await pausa(600);
    chk('J1 · el snapshot inicial (coincidente) no dispara ninguna notificación de reapertura',
        !listener1._avisos.some(a => /reabri/i.test(a)), JSON.stringify(listener1._avisos));
    chk('J1 · myAuditoriaStatus.almacen sigue en completada, sin cambios espurios',
        listener1._deps.myAuditoriaStatus.almacen === 'completada');
    listener1.desconectar();

    // ═══════════════════════════════════════════════════════════════════
    //  J2-J4 · ★ El admin reabre con la escritura REAL de reabrirArea()
    //  y el listener en vivo del bartender lo refleja sin recargar.
    // ═══════════════════════════════════════════════════════════════════
    const listener2 = montarListenerPropio(dbBart1, 'bart1', {
        status: { almacen: 'completada', barra1: 'pendiente', barra2: 'pendiente' },
        finalizadas: { almacen: { finalizadoEn: Date.now(), finalizadoPor: 'bart1' } }
    });
    listener2.conectar();
    await pausa(600); // deja asentar el snapshot inicial antes de escribir el cambio

    // Exactamente la escritura que hace reabrirArea() (js/75-auditoria-flujo.js):
    // docPrincipal.collection('userAuditoria').doc(uid).update({['status.'+area]: 'pendiente', updatedAt: Date.now()})
    // — con el admin real (dbJefe), bajo las reglas reales (no deshabilitadas).
    await dbJefe.doc(R + '/userAuditoria/bart1').update({
        'status.almacen': 'pendiente', updatedAt: Date.now()
    });

    const seActualizo = await esperarHasta(
        () => listener2._deps.myAuditoriaStatus.almacen === 'pendiente', 4000, 40);
    chk('J2 · ★ el listener en vivo del bartender refleja la reapertura sin recargar la página',
        seActualizo, 'myAuditoriaStatus.almacen=' + listener2._deps.myAuditoriaStatus.almacen);
    chk('J3 · myAuditoriaFinalizadas.almacen se borró tras la reapertura',
        !listener2._deps.myAuditoriaFinalizadas.almacen,
        JSON.stringify(listener2._deps.myAuditoriaFinalizadas));
    chk('J4 · se avisó al bartender de que su área fue reabierta',
        listener2._avisos.some(a => /reabri/i.test(a)), JSON.stringify(listener2._avisos));
    chk('J4 · y se volvió a renderizar la pantalla',
        listener2._renders.n > 0, 'renders=' + listener2._renders.n);
    listener2.desconectar();

    // ═══════════════════════════════════════════════════════════════════
    //  J5 · ★ El sentido inverso NO se refleja — alcance deliberado
    //  barra1 está 'pendiente' localmente (nunca finalizada) mientras el
    //  servidor la tiene 'completada' (otro dispositivo del mismo bartender
    //  ya la finalizó). Path D solo reacciona en el sentido "reabrir".
    // ═══════════════════════════════════════════════════════════════════
    await escribirUserAuditoria('bart1', {
        uid: 'bart1', sessionId: SESSION,
        status: { almacen: 'pendiente', barra1: 'completada', barra2: 'pendiente' },
        conteo: {}, finalizadas: {}, updatedAt: Date.now()
    });
    const listener3 = montarListenerPropio(dbBart1, 'bart1', {
        status: { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' },
        finalizadas: {}
    });
    listener3.conectar();
    await pausa(800); // tiempo de sobra para que, si fuera a reaccionar, ya lo hubiera hecho
    chk('J5 · ★ el servidor en "completada" con local en "pendiente" NO se reescribe localmente',
        listener3._deps.myAuditoriaStatus.barra1 === 'pendiente',
        'myAuditoriaStatus.barra1=' + listener3._deps.myAuditoriaStatus.barra1);
    chk('J5 · y no se disparó ninguna notificación de reapertura para ese caso',
        !listener3._avisos.some(a => /reabri/i.test(a)), JSON.stringify(listener3._avisos));
    listener3.desconectar();

    // ═══════════════════════════════════════════════════════════════════
    //  J6 · Regresión — Path C (unlocks) sigue funcionando en el mismo
    //  listener después del fix de Path D.
    // ═══════════════════════════════════════════════════════════════════
    await escribirUserAuditoria('bart1', {
        uid: 'bart1', sessionId: SESSION,
        status: { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' },
        conteo: {}, finalizadas: {}, updatedAt: Date.now()
    });
    const listener4 = montarListenerPropio(dbBart1, 'bart1', {
        status: { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' },
        unlocks: {}
    });
    listener4.conectar();
    await pausa(500);
    await dbJefe.doc(R + '/userAuditoria/bart1').update({
        'unlocks.PRD001': { unlockedAt: Date.now(), unlockedBy: 'jefe' }
    });
    const seDesbloqueo = await esperarHasta(
        () => !!(listener4._deps.myAuditoriaUnlocks.PRD001 && listener4._deps.myAuditoriaUnlocks.PRD001.unlockedAt),
        4000, 40);
    chk('J6 · regresión — Path C (desbloqueo de producto) sigue funcionando tras el fix de Path D',
        seDesbloqueo, JSON.stringify(listener4._deps.myAuditoriaUnlocks));
    listener4.desconectar();

    await testEnv.cleanup();

    console.log('\n  ' + total + ' comprobaciones de integración · ' +
                (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
