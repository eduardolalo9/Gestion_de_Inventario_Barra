#!/usr/bin/env node
/**
 * prueba-v533-blindaje-pestana.js — v5.33 · Etapa 0: blindaje de `activeTab`
 * ═══════════════════════════════════════════════════════════════════════════
 * La pestaña activa es estado de NAVEGACIÓN del dispositivo, no información
 * compartida del inventario. Esta prueba ejecuta el código REAL de las
 * funciones afectadas (extraído de los archivos, con dobles de Firestore y de
 * almacenamiento) y comprueba:
 *
 *   1 · Una única lista de pestañas válidas, igual a las pantallas reales.
 *   2 · La lista que puede viajar a la nube es la que conoce v5.32 (y nunca
 *       incluye 'perfil').
 *   3 · Restaurar desde localStorage, IndexedDB y respaldo JSON: un valor
 *       inválido da 'inicio'; uno válido se conserva; los datos del inventario
 *       restaurados son idénticos.
 *   4 · syncToCloud: el payload NO lleva `activeTab` si no es una pestaña
 *       compartible; el resto del payload es idéntico.
 *   5 · renderTab tiene un `default` que no deja la pantalla en blanco ni
 *       escribe nada.
 *   6 · Garantías estáticas (no se adopta la pestaña de la nube, versión 5.33).
 *
 * No toca Firebase: todo se ejecuta contra dobles en memoria.
 *   npm run test:v533
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

// Las 14 pestañas que existen en v5.32 (renderTab de b9378d4). Congeladas a propósito:
// es el universo que una copia v5.32 sabe pintar.
const V532_TABS = ['inicio', 'productos', 'pedidos', 'inventario', 'historia', 'compras', 'recetario',
    'ventas', 'pedido_sugerido', 'importar', 'papelera', 'ajustes', 'notificaciones', 'admin'];

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
function sinComentarios(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }

const nucleo = leer('js/00-nucleo.js');
const idb = leer('js/30-indexeddb.js');
const firest = leer('js/40-firestore.js');
const datos = leer('js/45-inventario-datos.js');
const render = leer('js/70-conversion-render.js');
const arranque = leer('js/99-window-arranque.js');
const html = leer('index.html');
const sw = leer('sw.js');

// ═══ 1 · Bloque de pestañas en js/00-nucleo.js ═════════════════════════════
let T = null;
{
    const m = /v5\.33-TABS-BEGIN[^\n]*\n([\s\S]*?)\n[^\n]*v5\.33-TABS-END/.exec(nucleo);
    if (m) {
        try { T = new Function(m[1] + '\n return { TABS_VALIDAS, TABS_COMPARTIBLES, tabValida, tabSegura, tabParaNube };')(); }
        catch (e) { chk('El bloque de pestañas de js/00-nucleo.js se evalúa', false, e.message); }
    }
}
chk('js/00-nucleo.js define el bloque único de pestañas (TABS_VALIDAS, TABS_COMPARTIBLES, tabValida, tabSegura, tabParaNube)', !!T);

const casesRender = [...new Set([...extraerFuncion(render, 'renderTab').matchAll(/case '([a-z_]+)':/g)].map(x => x[1]))];
chk('★ TABS_VALIDAS es exactamente el conjunto de `case` de renderTab (pantallas que realmente existen)',
    !!T && JSON.stringify([...T.TABS_VALIDAS].sort()) === JSON.stringify([...casesRender].sort()),
    T ? 'lista=' + T.TABS_VALIDAS.join(',') + ' | renderTab=' + casesRender.join(',') : 'sin bloque');
chk('Las 14 pestañas de v5.32 son las de renderTab hoy (etapa 0 no añade pantallas)',
    JSON.stringify([...casesRender].sort()) === JSON.stringify([...V532_TABS].sort()), casesRender.join(','));

const btab = [...html.matchAll(/data-btab="([a-z_]+)"/g)].map(x => x[1]);
const sbtab = [...html.matchAll(/data-sb-tab="([a-z_]+)"/g)].map(x => x[1]);
const literales = [];
[html, ...fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js')).map(f => leer('js/' + f))]
    .forEach(src => { for (const m of src.matchAll(/switchTab\(\\?'([a-z_]+)\\?'\)/g)) literales.push(m[1]); });
chk('★ Toda pestaña de la barra inferior, del menú y de los switchTab(\'…\') literales está en TABS_VALIDAS',
    !!T && [...btab, ...sbtab, ...literales].every(t => T.TABS_VALIDAS.indexOf(t) !== -1),
    T ? [...new Set([...btab, ...sbtab, ...literales])].filter(t => T.TABS_VALIDAS.indexOf(t) === -1).join(',') : 'sin bloque');

// ═══ 2 · Lista compartible congelada y funciones auxiliares ═══════════════
chk('★ TABS_COMPARTIBLES es exactamente la lista que conoce v5.32',
    !!T && JSON.stringify([...T.TABS_COMPARTIBLES].sort()) === JSON.stringify([...V532_TABS].sort()));
chk('★ \'perfil\' NO está (ni estará) en TABS_COMPARTIBLES y tabParaNube(\'perfil\') es nulo',
    !!T && T.TABS_COMPARTIBLES.indexOf('perfil') === -1 && !T.tabParaNube('perfil'));
chk('TABS_COMPARTIBLES está definida como lista literal (no derivada de TABS_VALIDAS: una pestaña nueva es local por defecto)',
    /TABS_COMPARTIBLES\s*=\s*(?:Object\.freeze\(\s*)?\[\s*'/.test(nucleo) && !/TABS_COMPARTIBLES\s*=\s*TABS_VALIDAS/.test(nucleo));
if (T) {
    const malos = [undefined, null, '', ' ', 5, {}, [], true, 'perfil', 'xyz', 'INICIO', ' inicio', 'inicio ', '__proto__', 'constructor', 'toString', 'hasOwnProperty'];
    chk('★ tabValida rechaza valores inválidos, de otro tipo y nombres de prototipo',
        malos.every(v => T.tabValida(v) === false), malos.filter(v => T.tabValida(v)).map(String).join(','));
    chk('tabSegura devuelve \'inicio\' para cualquiera de ellos', malos.every(v => T.tabSegura(v) === 'inicio'));
    chk('tabValida / tabSegura conservan las 14 válidas', V532_TABS.every(t => T.tabValida(t) && T.tabSegura(t) === t));
    chk('tabParaNube devuelve la pestaña si es compartible y null si no',
        V532_TABS.every(t => T.tabParaNube(t) === t) && malos.every(v => T.tabParaNube(v) === null));
} else {
    chk('tabValida / tabSegura / tabParaNube existen y se comportan', false, 'sin bloque');
}

// ═══ Dobles ════════════════════════════════════════════════════════════════
function fakeLS(inicial) {
    const d = Object.assign({}, inicial || {});
    return { _d: d, getItem(k) { return d[k] === undefined ? null : d[k]; }, setItem(k, v) { d[k] = String(v); },
             removeItem(k) { delete d[k]; }, get length() { return Object.keys(d).length; }, key(i) { return Object.keys(d)[i]; } };
}
const silencio = { info() {}, warn() {}, error() {}, log() {} };
function auxiliares(ctx) {
    if (T) { ctx.tabValida = T.tabValida; ctx.tabSegura = T.tabSegura; ctx.tabParaNube = T.tabParaNube; }
    return ctx;
}
function ejecutar(fnSrc, ctx) { return new Function('ctx', 'with (ctx) { return (' + fnSrc + '); }')(ctx); }
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const PROD = [{ id: 'P1', name: 'TEQUILA', unit: 'PZA', group: 'Tequila' }, { id: 'P2', name: 'VODKA', unit: 'PZA', group: 'Vodka' }];
const CONTEO = { P1: { almacen: { enteras: 3, abiertas: [0.5] } } };
const INVALIDOS = ['perfil', 'xyz', '   ', 'INICIO', '[object Object]'];

// ═══ 3a · localStorage: loadFromLocalStorage (js/40) ═══════════════════════
{
    const src = extraerFuncion(firest, 'loadFromLocalStorage');
    const estadoBase = () => auxiliares({
        console: silencio, estadoAreasVacio: (v) => ({ almacen: v, barra1: v, barra2: v }),
        products: [], orders: [], inventories: [], cart: [], compras: [], movimientos: [], costosUltimos: {}, recetas: [],
        ventas: [], ventasSemanaId: null, ventasPeriodos: [], _deletedProductIds: [], _deletedOrderIds: [], _deletedInventoryIds: [],
        _catalogoPurgadoEn: 0, activeTab: 'inicio', selectedGroup: 'Todos', selectedArea: 'almacen', expandedInventories: new Set(),
        auditoriaStatus: {}, auditoriaConteo: {}, auditoriaView: 'selection', auditoriaAreaActiva: null, isAuditoriaMode: false,
        auditoriaConteoPorUsuario: {}, myAuditoriaConteo: {}, myAuditoriaStatus: {}, myAuditoriaFinalizadas: {}, myAuditoriaUnlocks: {},
        _auditoriaSessionId: null, inventarioConteo: {}, _syncQueue: [], inventarioCicloEstado: 'ABIERTO', inventarioCicloInfo: {}
    });
    const correr = (ls) => { const c = estadoBase(); c.localStorage = fakeLS(ls); ejecutar(src, c)(); return c; };
    const base = { inventarioApp_products: JSON.stringify(PROD), inventarioApp_inventarioConteo: JSON.stringify(CONTEO) };

    INVALIDOS.forEach(v => {
        const c = correr(Object.assign({ inventarioApp_activeTab: v }, base));
        chk('★ localStorage con pestaña inválida ' + JSON.stringify(v) + ' → restaura \'inicio\'', c.activeTab === 'inicio', 'quedó ' + JSON.stringify(c.activeTab));
    });
    const cv = correr(Object.assign({ inventarioApp_activeTab: 'ventas' }, base));
    chk('localStorage con pestaña válida (ventas) → se conserva', cv.activeTab === 'ventas');
    const cs = correr(base);
    chk('localStorage sin pestaña guardada → queda en Inicio', cs.activeTab === 'inicio');
    const ci = correr(Object.assign({ inventarioApp_activeTab: 'perfil' }, base));
    chk('★ Con pestaña inválida, productos y conteo restaurados son idénticos a los guardados',
        igual(ci.products, PROD) && igual(ci.inventarioConteo, { P1: { almacen: { enteras: 3, abiertas: [0.5] } } }));
}

// ═══ 3b · IndexedDB: _applyIDBData (js/30) ═════════════════════════════════
{
    const src = extraerFuncion(idb, '_applyIDBData');
    const estadoBase = () => auxiliares({
        console: silencio, products: [], inventarioConteo: {}, myAuditoriaConteo: {}, auditoriaConteo: {}, auditoriaConteoPorUsuario: {},
        auditoriaStatus: {}, myAuditoriaStatus: {}, myAuditoriaUnlocks: {}, _auditoriaSessionId: null, inventarioCicloEstado: 'ABIERTO',
        inventarioCicloInfo: {}, _syncQueue: [], cart: [], activeTab: 'inicio', selectedArea: 'almacen', selectedGroup: 'Todos',
        compras: [], movimientos: [], costosUltimos: {}, recetas: [], ventas: [], ventasSemanaId: null, ventasPeriodos: [],
        auditoriaView: 'selection', auditoriaAreaActiva: null, isAuditoriaMode: false, myAuditoriaFinalizadas: {}, expandedInventories: new Set(), searchTerm: ''
    });
    const correr = (tab) => { const c = estadoBase(); ejecutar(src, c)({ products: JSON.parse(JSON.stringify(PROD)), inventarioConteo: JSON.parse(JSON.stringify(CONTEO)), activeTab: tab }); return c; };
    INVALIDOS.forEach(v => {
        const c = correr(v);
        chk('★ IndexedDB con pestaña inválida ' + JSON.stringify(v) + ' → \'inicio\'', c.activeTab === 'inicio', 'quedó ' + JSON.stringify(c.activeTab));
    });
    chk('IndexedDB con pestaña válida (productos) → se conserva', correr('productos').activeTab === 'productos');
    const c2 = correr('perfil');
    chk('★ Con pestaña inválida en IndexedDB, productos y conteo restaurados son idénticos',
        igual(c2.products, PROD) && igual(c2.inventarioConteo, CONTEO));
}

// ═══ 3c · Respaldo JSON: importFullData (js/99) ════════════════════════════
{
    const src = extraerFuncion(arranque, 'importFullData');
    function FakeFileReader() {}
    FakeFileReader.prototype.readAsText = function (file) { if (typeof this.onload === 'function') this.onload({ target: { result: file.texto } }); };
    const importar = (tab) => {
        const ctx = auxiliares({
            console: silencio, FileReader: FakeFileReader, hasPermission: () => true, showNotification() {}, showConfirm: (m, cb) => cb(),
            _crearBackupNombrado: () => 'b', saveToLocalStorage() {}, switchTab(t) { ctx._switch = t; }, syncStockByAreaFromConteo() {},
            AREAS_CONTEO: ['almacen'], products: [{ id: 'VIEJO' }], orders: [], inventories: [], cart: [], inventarioConteo: {},
            auditoriaConteo: {}, auditoriaConteoPorUsuario: {}, auditoriaStatus: {}, auditoriaView: 'selection', auditoriaAreaActiva: null,
            isAuditoriaMode: false, myAuditoriaConteo: {}, myAuditoriaStatus: {}, myAuditoriaUnlocks: {}, _auditoriaSessionId: null,
            activeTab: 'inicio', searchTerm: '', selectedGroup: 'Todos', selectedArea: 'almacen', expandedInventories: new Set()
        });
        const json = { products: JSON.parse(JSON.stringify(PROD)), orders: [], inventories: [], cart: [], inventarioConteo: JSON.parse(JSON.stringify(CONTEO)) };
        if (tab !== undefined) json.activeTab = tab;
        ejecutar(src, ctx)({ target: { files: [{ texto: JSON.stringify(json) }], value: 'a.json' } });
        return ctx;
    };
    INVALIDOS.forEach(v => {
        const c = importar(v);
        chk('★ Respaldo con pestaña desconocida ' + JSON.stringify(v) + ' → \'inicio\' (y switchTab recibe \'inicio\')',
            c.activeTab === 'inicio' && c._switch === 'inicio', 'tab=' + c.activeTab + ' switchTab=' + c._switch);
    });
    chk('Respaldo con pestaña válida (compras) → se conserva', importar('compras').activeTab === 'compras');
    chk('Respaldo sin pestaña → Inicio', importar(undefined).activeTab === 'inicio');
    const c3 = importar('perfil');
    chk('★ El respaldo con pestaña inválida importa los mismos productos y conteo', igual(c3.products, PROD) && igual(c3.inventarioConteo, CONTEO));
}

// ═══ 4 · syncToCloud: el payload no lleva pestañas inválidas ═══════════════
const DOC = 'barra-principal', RUTA = 'inventarioApp/' + DOC;
function dbFalsa(docNube) {
    const log = { sets: [], batches: [] };
    const vacio = { forEach() {}, empty: true, size: 0, docs: [] };
    function docRef(p) {
        return { path: p, id: p.split('/').pop(),
            get: async () => (p === RUTA && docNube) ? { exists: true, data: () => docNube } : { exists: false, data: () => undefined },
            set: async (data, opts) => { log.sets.push({ path: p, claves: Object.keys(data), activeTab: data.activeTab, tieneActiveTab: Object.prototype.hasOwnProperty.call(data, 'activeTab'), data, opts }); },
            update: async () => {}, collection: (n) => colRef(p + '/' + n) };
    }
    function colRef(p) { return { path: p, doc: (id) => docRef(p + '/' + id), get: async () => vacio, where() { return this; }, limit() { return this; } }; }
    return { log, collection: (n) => colRef(n), batch: () => ({ set(ref) { log.batches.push(ref.path); }, delete() {}, commit: async () => {} }) };
}
async function sincronizar(valorTab, admin, docNube) {
    const db = dbFalsa(docNube);
    const ctx = auxiliares({
        console: silencio, navigator: { onLine: true }, _db: db, FIRESTORE_DOC_ID: DOC, currentUserUid: 'u1', currentUserRole: admin ? 'admin' : 'user',
        isAdmin: () => admin, hasPermission: () => true, showNotification() {}, updateCloudSyncBadge() {}, _logSyncError() {},
        products: JSON.parse(JSON.stringify(PROD)), orders: [], inventories: [], cart: [{ id: 'P1', quantity: 2 }], activeTab: valorTab, selectedArea: 'almacen',
        _syncEnabled: true, _syncInProgress: false, _cloudSyncPending: false, _lastCloudSync: 0, _syncQueue: [], _catalogoPurgadoEn: 0,
        _haySesionFirebase: () => true, _flushSyncQueueToFirestore: () => Promise.resolve(), _deletedProductIds: [], _deletedOrderIds: [], _deletedInventoryIds: [],
        _mergeArrayByIdPreferLocal: (l) => l, _purgaDeCatalogoVigente: () => false, areasConteoDef: [{ id: 'almacen' }],
        localStorage: fakeLS({ inventarioApp_lastModified: '5' }), setTimeout: () => 0, clearTimeout() {}, window: {}, _auth: { currentUser: { uid: 'u1' } },
        saveToLocalStorage() {}, renderTab() {}, syncStockByAreaFromConteo() {}, _registrarConflictos() {}
    });
    const api = new Function('ctx', 'with (ctx) {\n' + firest + '\n; return { syncToCloud }; }')(ctx);
    await api.syncToCloud();
    const w = db.log.sets.find(s => s.path === RUTA);
    return { w, db, ctx };
}
(async () => {
    const compartibles = T ? T.TABS_COMPARTIBLES : V532_TABS;
    const base = await sincronizar('productos', false, null);
    chk('syncToCloud (doble de Firestore) escribe el documento principal con merge:true',
        !!base.w && base.w.opts && base.w.opts.merge === true, base.w ? JSON.stringify(base.w.opts) : 'no escribió (' + base.ctx._syncInProgress + ')');
    for (const t of compartibles) {
        const r = await sincronizar(t, false, null);
        chk('Payload con pestaña compartible \'' + t + '\' la conserva (compatible con v5.32)', !!r.w && r.w.tieneActiveTab && r.w.activeTab === t, r.w ? String(r.w.activeTab) : 'sin escritura');
    }
    const clavesValidas = base.w ? base.w.claves.filter(k => k !== 'activeTab').sort() : [];
    for (const v of ['perfil', 'xyz', '', null, undefined, 5, {}, 'INICIO', 'constructor']) {
        const r = await sincronizar(v, false, null);
        chk('★ Payload con pestaña ' + (typeof v === 'object' && v ? 'objeto' : JSON.stringify(v)) + ' NO incluye la clave activeTab',
            !!r.w && !r.w.tieneActiveTab, r.w ? ('tieneActiveTab=' + r.w.tieneActiveTab + ' valor=' + String(r.w.activeTab)) : 'sin escritura');
        chk('   …y el resto del payload es idéntico (mismas claves, cart, selectedArea)',
            !!r.w && igual(r.w.claves.sort(), clavesValidas) && igual(r.w.data.cart, [{ id: 'P1', quantity: 2 }]) && r.w.data.selectedArea === 'almacen');
    }
    const adm = await sincronizar('perfil', true, null);
    const admOk = await sincronizar('ventas', true, null);
    chk('★ También como administrador: \'perfil\' no viaja, y las claves de admin (products…) siguen enviándose igual',
        !!adm.w && !adm.w.tieneActiveTab && igual(adm.w.claves.sort(), admOk.w.claves.filter(k => k !== 'activeTab').sort()) && adm.w.claves.indexOf('products') !== -1);
    chk('Un payload con pestaña inválida no escribe otros documentos de más (mismos lotes que con una válida)',
        igual(adm.db.log.batches.sort(), admOk.db.log.batches.sort()));

    // ═══ 5 · renderTab: default seguro y sin escrituras ═══════════════════
    const rt = extraerFuncion(render, 'renderTab');
    const mDef = /default:\s*([^\n]*)/.exec(rt);
    chk('★ renderTab tiene `default:` que pinta Inicio', !!mDef && /renderInicioTab\(\)/.test(mDef[1]), mDef ? mDef[1] : 'sin default');
    chk('El `default` solo dibuja: no asigna activeTab ni guarda ni sincroniza',
        !!mDef && !/activeTab\s*=|saveToLocalStorage|syncToCloud|switchTab|localStorage/.test(mDef[1]));

    // ═══ 6 · Garantías estáticas ══════════════════════════════════════════
    chk('★ _applyCloudData ya no adopta la pestaña que llega de la nube', !/activeTab\s*=\s*data\.activeTab/.test(sinComentarios(extraerFuncion(datos, '_applyCloudData'))));
    chk('Ningún archivo asigna `activeTab = data.activeTab` sin validar (sólo se admite vía tabSegura)',
        fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js')).every(f => !/activeTab\s*=\s*data\.activeTab\s*(\|\||;)/.test(sinComentarios(leer('js/' + f)))));
    chk('El payload de syncToCloud ya no fija `activeTab: activeTab` directamente', !/activeTab:\s*activeTab\b/.test(sinComentarios(firest)));
    chk('Las restauraciones usan tabSegura (localStorage, IndexedDB y respaldo)',
        /tabSegura\(\s*storedTab/.test(sinComentarios(firest)) && /tabSegura\(\s*idbData\.activeTab/.test(sinComentarios(idb)) && /tabSegura\(\s*data\.activeTab/.test(sinComentarios(arranque)));
    chk('Los puntos tocados no dependen de que la función exista (guard typeof, compatible con pruebas que simulan sólo parte del código)',
        /typeof tabSegura === 'function'/.test(firest) && /typeof tabSegura === 'function'/.test(idb) && /typeof tabSegura === 'function'/.test(arranque) && /typeof tabParaNube === 'function'/.test(firest));

    const mV = /const\s+APP_VERSION\s*=\s*'([^']+)'/.exec(sw);
    const versionesHtml = [...new Set([...html.matchAll(/\?v=([0-9.]+)/g)].map(x => x[1]))];
    chk('★ Versión ≥ 5.33: sw.js y todas las etiquetas ?v= de index.html coinciden', !!mV && parseFloat(mV[1]) >= 5.33 && igual(versionesHtml, [mV[1]]), (mV ? mV[1] : '?') + ' / ' + versionesHtml.join(','));

    const w = Math.max.apply(null, casos.map(c => c.n.length));
    console.log('\n  ── v5.33 · Etapa 0: blindaje de activeTab (lógica) ──\n');
    casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(Math.min(w, 150)) + (c.ok ? '' : '   ← ' + c.d)));
    console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR en la prueba:', e); process.exit(2); });
