#!/usr/bin/env node
/**
 * prueba-sync-vivo.js — v5.22 · Compras, ventas y cortes en vivo entre dispositivos
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedido de Eduardo (9-oct-2026): lo que se hace/importa en la PC debe verse en
 * el celular y al revés, sin recargar. Compras, ventas y cortes se leían UNA vez.
 * Esta prueba corre el js/54-sync-vivo.js REAL contra un Firestore simulado que
 * puede emitir cambios "de otro dispositivo", y comprueba:
 *   · qué se escucha (según permisos), una escucha por colección;
 *   · que un cambio ajeno se mezcla y recalcula el Total; uno propio se ignora;
 *   · batería: agrupa cambios, suelta las escuchas al ocultarse, no escribe nada.
 *   node pruebas/prueba-sync-vivo.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const casos = []; let fallos = 0;
function chk(n, ok, d) { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; }
const dormir = ms => new Promise(r => setTimeout(r, ms));

const src = leer('js/54-sync-vivo.js'), ciclo = leer('js/15-ciclo-semanal.js'), comp = leer('js/88-compras.js').replace(/\r\n/g, '\n'),
      html = leer('index.html'), sw = leer('sw.js'), arr = leer('js/60-arranque.js').replace(/\r\n/g, '\n'), auth = leer('js/auth.js').replace(/\r\n/g, '\n');

// ── Firestore simulado ────────────────────────────────────────────────────────
function crearDb() {
    const escuchas = [];      // { ruta, filtros, cb, err, viva }
    const mk = (ruta, filtros) => ({
        where: (c, op, v) => mk(ruta, filtros.concat(['where ' + c + ' ' + op + ' ' + JSON.stringify(v)])),
        orderBy: (c, d) => mk(ruta, filtros.concat(['orderBy ' + (c && c.__id ? '__name__' : c) + ' ' + (d || 'asc')])),
        limit: n => mk(ruta, filtros.concat(['limit ' + n])),
        doc: id => ({ collection: c => mk(ruta + '/' + id + '/' + c, []) }),
        collection: c => mk(ruta + '/' + c, []),
        onSnapshot: (cb, err) => { const e = { ruta, filtros, cb, err, viva: true }; escuchas.push(e); return () => { e.viva = false; }; }
    });
    const db = { collection: c => mk(c, []), doc: id => ({ collection: c => mk(id + '/' + c, []) }) };
    db.collection = c => { const r = mk(c, []); r.doc = id => ({ collection: cc => mk(c + '/' + id + '/' + cc, []) }); return r; };
    return { db, escuchas };
}
const doc = (id, data) => ({ id, data: () => data });
const snap = (docs, cambios, meta) => ({ metadata: Object.assign({ hasPendingWrites: false, fromCache: false }, meta || {}),
    docChanges: () => cambios || [], forEach: fn => docs.forEach(fn), docs });
const cambio = (tipo, d) => ({ type: tipo, doc: d });

// extrae _agregarCompraLocal REAL de js/88-compras.js
const mAgr = comp.match(/function _agregarCompraLocal\(compra, asientos\) \{[\s\S]*?\n        \}\n/);
chk('Se encontró _agregarCompraLocal real en js/88-compras.js', !!mAgr);

function montar(opts) {
    opts = opts || {};
    const { db, escuchas } = crearDb();
    const llamadas = { invalidar: 0, cargar: 0, repintar: 0, avisos: [], recuperarCompras: 0, publicar: 0, render: 0, guardar: 0 };
    const handlers = {};
    const ctx = {
        window: { addEventListener(ev, fn) { handlers[ev] = fn; } },
        console: { warn() {}, info() {}, log() {}, error() {} },
        _db: opts.sinDb ? null : db, currentUserUid: 'u1', FIRESTORE_DOC_ID: 'principal',
        firebase: { firestore: { FieldPath: { documentId: () => ({ __id: true }) } } },
        _authzState: { loaded: true }, hasPermission: p => (opts.permisos || ['purchases.read', 'sales.read']).indexOf(p) !== -1,
        compras: [], movimientos: [],
        _asientosDesdeCompra: c => (c.lineas || []).map(l => ({ movId: c.compraId + ':' + l.productoId, tipo: 'compra', productoId: l.productoId, cantidad: l.cantidad, fecha: c.fecha })),
        saveToLocalStorage() { llamadas.guardar++; },
        showNotification(m) { llamadas.avisos.push(m); },
        existenciaInvalidarInicial() { llamadas.invalidar++; },
        existenciaCargarInicial(cb) { llamadas.cargar++; if (cb) cb(); },
        existenciaRepintarSeguro() { llamadas.repintar++; },
        totalPublicadoAlCambiarExistencia() { llamadas.publicar++; },
        cargarComprasIniciales() { llamadas.recuperarCompras++; return Promise.resolve(); },
        activeTab: 'inicio', renderTab() { llamadas.render++; }, comprasImportView: 'lista', ventasImportView: 'lista',
        document: { visibilityState: opts.oculto ? 'hidden' : 'visible', body: { classList: { contains: () => !!opts.modal } },
                    addEventListener(ev, fn) { handlers[ev] = fn; } },
        navigator: { onLine: true },
        setInterval() { return 0; }
    };
    const f = new Function('ctx', 'with (ctx) {' + ciclo + '\n' + mAgr[0] + '\n' + src + `
      SYNC_VIVO_DEBOUNCE_MS = 15; SYNC_VIVO_OCULTO_MS = 40; SYNC_VIVO_RECUPERA_MS = 30; SYNC_VIVO_MIN_RECUPERA_MS = 0; SYNC_VIVO_AVISO_MS = 0;
      return { syncVivoIniciar, syncVivoDetener, syncVivoRecuperar, syncVivoEstado, syncVivoDecidir, syncVivoSemanas, syncVivoMezclarCompra, ctx };
    }`);
    return Object.assign(f(ctx), { escuchas, llamadas, handlers, db, ctx });
}
const por = (m, ruta) => m.escuchas.find(e => e.viva && e.ruta === ruta);
const compra = (id, prod, cant, extra) => Object.assign({ compraId: id, semanaId: '2026-10-05', fecha: '2026-10-08', lineas: [{ productoId: prod, cantidad: cant }] }, extra || {});

(async () => {
    // ═══ 1 · Capa pura ═══════════════════════════════════════════════════════
    {
        const m = montar();
        const sem = m.syncVivoSemanas(new Date(2026, 9, 9));   // viernes 9-oct-2026
        chk('★ Escucha la semana en curso y la anterior (2 semanas)', sem.length === 2 && sem[0] > sem[1], JSON.stringify(sem));
        const D = m.syncVivoDecidir;
        chk('★ Una escritura propia en tránsito se ignora ("propio")', D({ hasPendingWrites: true, fromCache: false }, true, 1) === 'propio');
        chk('Datos del caché local nunca se actúan ("cache")', D({ hasPendingWrites: false, fromCache: true }, true, 3) === 'cache');
        chk('La primera respuesta del servidor es la base que ya cargó el arranque ("base")', D({ hasPendingWrites: false, fromCache: false }, false, 9) === 'base');
        chk('★ Después de la base, un cambio ajeno pide refrescar', D({ hasPendingWrites: false, fromCache: false }, true, 1) === 'refrescar');
        chk('Una notificación sin cambios de datos no hace nada', D({ hasPendingWrites: false, fromCache: false }, true, 0) === 'nada');

        const lista = [], libro = [];
        const agr = (c, as) => { lista.push(c); (as || []).forEach(x => libro.push(x)); };
        const der = c => [{ movId: c.compraId + ':P', productoId: 'P', cantidad: 1 }];
        chk('Una compra nueva se agrega con sus asientos', m.syncVivoMezclarCompra(compra('C1', 'P', 1), lista, libro, der, agr) === true && lista.length === 1 && libro.length === 1);
        chk('★ La misma compra otra vez no cambia nada (idempotente, sin duplicar asientos)', m.syncVivoMezclarCompra(compra('C1', 'P', 1), lista, libro, der, agr) === false && lista.length === 1 && libro.length === 1);
        chk('★ Si la nube trae la misma compra distinta, la nube gana (y el libro solo crece)', m.syncVivoMezclarCompra(compra('C1', 'P', 5), lista, libro, der, agr) === true && lista[0].lineas[0].cantidad === 5 && libro.length === 1);
        chk('Una compra sin compraId se descarta', m.syncVivoMezclarCompra({}, lista, libro, der, agr) === false);
    }

    // ═══ 2 · Qué se escucha ═════════════════════════════════════════════════
    {
        const m = montar();
        m.syncVivoIniciar();
        const rutas = m.escuchas.filter(e => e.viva).map(e => e.ruta);
        chk('★ Con permisos completos escucha 4 flujos: compras, ventas, cortes e iniciales',
            rutas.join(',') === 'compras,inventarioApp/principal/ventas,inventarioApp/principal/anclasExistencia,inventarioApp/principal/inventariosIniciales', rutas.join(','));
        const sem = m.syncVivoSemanas();
        chk('★ UN solo flujo por colección para las dos semanas (consulta "in"), no uno por semana',
            por(m, 'compras').filtros[0] === 'where semanaId in ' + JSON.stringify(sem) && por(m, 'inventarioApp/principal/ventas').filtros[0] === 'where semanaId in ' + JSON.stringify(sem));
        chk('Los cortes se piden por id descendente con límite (el id es fecha o fecha_HHmm: es orden de tiempo)',
            por(m, 'inventarioApp/principal/anclasExistencia').filtros.join('|') === 'orderBy __name__ desc|limit 3');
        const antes = m.escuchas.length; m.syncVivoIniciar(); m.syncVivoIniciar();
        chk('★ Llamarlo varias veces no duplica escuchas (idempotente)', m.escuchas.length === antes, antes + ' → ' + m.escuchas.length);
        chk('El estado dice qué escucha y para qué semanas', m.syncVivoEstado().activo && m.syncVivoEstado().escuchas.length === 4);

        const sinPerm = montar({ permisos: [] });
        sinPerm.syncVivoIniciar();
        const r2 = sinPerm.escuchas.map(e => e.ruta);
        chk('★ Sin purchases.read ni sales.read NO se pregunta por compras ni ventas (las reglas lo negarían; usa el Total publicado)',
            r2.indexOf('compras') === -1 && r2.indexOf('inventarioApp/principal/ventas') === -1 && r2.length === 2, r2.join(','));
        const soloCompras = montar({ permisos: ['purchases.read'] }); soloCompras.syncVivoIniciar();
        chk('Con solo purchases.read escucha compras pero no ventas', soloCompras.escuchas.some(e => e.ruta === 'compras') && !soloCompras.escuchas.some(e => /ventas/.test(e.ruta)));
        const sinDb = montar({ sinDb: true });
        chk('Sin Firestore o sin sesión no hace nada', sinDb.syncVivoIniciar() === false && sinDb.escuchas.length === 0);
        const oculto = montar({ oculto: true });
        chk('★ Con la app oculta no enciende escuchas (batería)', oculto.syncVivoIniciar() === false && oculto.escuchas.length === 0);
    }

    // ═══ 3 · Compras de otro dispositivo ════════════════════════════════════
    {
        const m = montar(); m.syncVivoIniciar();
        const e = por(m, 'compras');
        e.cb(snap([doc('C0', compra('C0', 'A', 2))], [cambio('added', doc('C0', compra('C0', 'A', 2)))]));
        await dormir(40);
        chk('★ La primera respuesta del servidor mezcla lo que faltaba (compra C0) y avisa una vez', m.ctx.compras.length === 1 && m.ctx.movimientos.length === 1, JSON.stringify(m.ctx.compras.map(c => c.compraId)));
        const inv0 = m.llamadas.invalidar;
        const c1 = compra('C1', 'B', 6);
        e.cb(snap([], [cambio('added', doc('C1', c1))]));
        await dormir(40);
        chk('★ Una compra importada en OTRO dispositivo aparece aquí sin recargar (lista y libro de asientos)', m.ctx.compras.some(c => c.compraId === 'C1') && m.ctx.movimientos.some(x => x.movId === 'C1:B'), JSON.stringify(m.ctx.compras.map(c => c.compraId)));
        chk('Se guarda en el dispositivo (sobrevive si se cierra la app)', m.llamadas.guardar >= 1);
        chk('★ Solo compras: NO relee Firestore (el Total las toma del libro), pero repinta y republica', m.llamadas.invalidar === inv0 && m.llamadas.repintar >= 1 && m.llamadas.publicar >= 1);
        chk('Avisa en pantalla qué cambió', m.llamadas.avisos.some(a => /compras/.test(a) && /otro dispositivo/.test(a)), JSON.stringify(m.llamadas.avisos));

        // varios folios seguidos (una importación) → un solo recálculo
        const antes = m.llamadas.repintar, av = m.llamadas.avisos.length;
        for (let i = 2; i <= 6; i++) e.cb(snap([], [cambio('added', doc('C' + i, compra('C' + i, 'B', 1)))]));
        await dormir(60);
        chk('★ 5 folios seguidos se agrupan: un solo repintado y un solo aviso (batería)', m.llamadas.repintar - antes === 1 && m.llamadas.avisos.length - av === 1 && m.ctx.compras.length === 7,
            (m.llamadas.repintar - antes) + ' repintados · ' + (m.llamadas.avisos.length - av) + ' avisos · ' + m.ctx.compras.length + ' compras');
        chk('El libro no duplica asientos si el mismo folio llega dos veces', (() => {
            e.cb(snap([], [cambio('modified', doc('C1', c1))])); return m.ctx.movimientos.filter(x => x.movId === 'C1:B').length === 1; })());
    }

    // ═══ 4 · Lo propio y lo del caché se ignoran ═════════════════════════════
    {
        const m = montar(); m.syncVivoIniciar();
        const e = por(m, 'compras'), ev = por(m, 'inventarioApp/principal/ventas');
        e.cb(snap([], []));   // base
        ev.cb(snap([], []));
        e.cb(snap([], [cambio('added', doc('X1', compra('X1', 'A', 1)))], { hasPendingWrites: true }));
        ev.cb(snap([], [cambio('added', doc('V1', { semanaId: 's' }))], { hasPendingWrites: true }));
        await dormir(40);
        chk('★ Lo que escribe ESTE dispositivo (importar compras/ventas aquí) no dispara lecturas dobles', m.ctx.compras.length === 0 && m.llamadas.invalidar === 0 && m.llamadas.cargar === 0);
        e.cb(snap([], [cambio('added', doc('X2', compra('X2', 'A', 1)))], { fromCache: true }));
        await dormir(40);
        chk('Un snapshot del caché local no se toma por un cambio ajeno', m.ctx.compras.length === 0);
    }

    // ═══ 5 · Ventas y cortes de otro dispositivo ═════════════════════════════
    {
        const m = montar(); m.syncVivoIniciar();
        const ev = por(m, 'inventarioApp/principal/ventas'), ea = por(m, 'inventarioApp/principal/anclasExistencia');
        ev.cb(snap([], [])); ea.cb(snap([], []));      // bases
        ev.cb(snap([], [cambio('added', doc('2026-10-06_2026-10-06', { semanaId: '2026-10-05' }))]));
        await dormir(40);
        chk('★ Ventas importadas en otro dispositivo → el Total se recalcula (invalida y recarga, UNA vez)', m.llamadas.invalidar === 1 && m.llamadas.cargar === 1, m.llamadas.invalidar + '/' + m.llamadas.cargar);
        chk('…y se repinta lo que se ve', m.llamadas.repintar >= 1);
        ea.cb(snap([], [cambio('added', doc('2026-10-08_2200', { tipo: 'importacion_excel' }))]));
        ev.cb(snap([], [cambio('added', doc('V2', {}))]));
        await dormir(40);
        chk('★ Un corte de existencias registrado en otro dispositivo + ventas a la vez → un solo recálculo', m.llamadas.invalidar === 2 && m.llamadas.cargar === 2, m.llamadas.invalidar + '/' + m.llamadas.cargar);
        chk('El aviso nombra "ventas" y "corte de existencias"', m.llamadas.avisos.some(a => /ventas/.test(a) && /corte de existencias/.test(a)), JSON.stringify(m.llamadas.avisos));
    }

    // ═══ 6 · No pisar lo que el usuario está haciendo ════════════════════════
    {
        const m = montar(); m.syncVivoIniciar();
        const ev = por(m, 'inventarioApp/principal/ventas'); ev.cb(snap([], []));
        m.ctx.activeTab = 'ventas'; m.ctx.ventasImportView = 'vista_previa';
        ev.cb(snap([], [cambio('added', doc('V9', {}))])); await dormir(40);
        chk('★ Con una vista previa de importación abierta NO se repinta (no se pierde lo que se está revisando)', m.llamadas.render === 0 && m.llamadas.avisos.length === 1);
        m.ctx.ventasImportView = 'lista';
        ev.cb(snap([], [cambio('added', doc('V10', {}))])); await dormir(40);
        chk('En la lista de ventas sí se repinta', m.llamadas.render === 1);
        m.ctx.activeTab = 'conteo';
        ev.cb(snap([], [cambio('added', doc('V11', {}))])); await dormir(40);
        chk('★ En Conteo (captura en curso) no se repinta nada', m.llamadas.render === 1);
        const mm = montar({ modal: true }); mm.syncVivoIniciar(); const e2 = por(mm, 'inventarioApp/principal/ventas'); e2.cb(snap([], []));
        mm.ctx.activeTab = 'compras'; e2.cb(snap([], [cambio('added', doc('V1', {}))])); await dormir(40);
        chk('Con un modal abierto no se repinta', mm.llamadas.render === 0);
    }

    // ═══ 7 · Errores, batería y ciclo de vida ════════════════════════════════
    {
        const m = montar(); m.syncVivoIniciar();
        const e = por(m, 'compras'); const n0 = m.escuchas.length;
        e.err({ code: 'permission-denied' }); await dormir(30);
        chk('★ Un permiso denegado no se reintenta (no gasta batería en un muro)', m.escuchas.length === n0 && !m.syncVivoEstado().escuchas.includes('compras'));
        const e2 = por(m, 'inventarioApp/principal/ventas'); e2.err({ code: 'unavailable' });
        chk('Un error de red suelta esa escucha para reintentarla luego', !m.syncVivoEstado().escuchas.includes('ventas'));

        const d = montar(); d.syncVivoIniciar();
        d.syncVivoDetener();
        chk('★ Detener (cierre de sesión) suelta TODAS las escuchas', d.escuchas.every(x => !x.viva) && !d.syncVivoEstado().activo);

        const v = montar(); v.syncVivoIniciar();
        v.ctx.document.visibilityState = 'hidden'; v.handlers.visibilitychange();
        await dormir(80);
        chk('★ Oculta más de 5 min (aquí 40 ms) → suelta las escuchas (batería y datos)', v.escuchas.every(x => !x.viva), v.escuchas.map(x => x.viva).join());
        const vivasAntes = v.escuchas.length;
        v.ctx.document.visibilityState = 'visible'; v.handlers.visibilitychange();
        chk('★ Al volver las enciende otra vez', v.escuchas.length > vivasAntes && v.syncVivoEstado().escuchas.length === 4, JSON.stringify(v.syncVivoEstado()));
        chk('★ …y hace UNA pasada de recuperación de lo que cambió mientras no escuchaba', v.llamadas.recuperarCompras === 1 && v.llamadas.invalidar === 1 && v.llamadas.cargar === 1, JSON.stringify([v.llamadas.recuperarCompras, v.llamadas.invalidar]));

        const w = montar(); w.syncVivoIniciar();
        w.ctx.document.visibilityState = 'hidden'; w.handlers.visibilitychange();
        w.ctx.document.visibilityState = 'visible'; w.handlers.visibilitychange();
        chk('Un cambio rápido de pestaña (vuelve antes del límite) no suelta ni recupera nada', w.llamadas.recuperarCompras === 0 && w.escuchas.filter(x => x.viva).length === 4);

        const o = montar(); o.syncVivoIniciar();
        o.handlers.online(); await dormir(1700);
        chk('Al volver la red hace la pasada de recuperación', o.llamadas.recuperarCompras === 1);
    }

    // ═══ 8 · Solo lee ═══════════════════════════════════════════════════════
    const codigo = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    chk('★ El módulo SOLO LEE: no hay set/add/update/delete/batch/transaction contra Firestore',
        !/\.(set|add|update|delete)\(|\bbatch\(|runTransaction/.test(codigo.replace(/_syncVivo\.[a-z]+\.delete|delete _syncVivo\.escuchas\[clave\]/g, '')));
    chk('No toca los cálculos: no define nada de existencia ni de consumo', !/function existencia[A-Z]|function consumoTeorico|function arrastre/.test(src));

    // ═══ 9 · Conexión con la app ═════════════════════════════════════════════
    chk('★ index.html carga 54 tras 53 y antes de 60', /53-papelera\.js\?v=[\d.]+"><\/script>[^\n]*\n\s*<script src="js\/54-sync-vivo\.js\?v=[\d.]+"><\/script>/.test(html) && html.indexOf('54-sync-vivo') < html.indexOf('60-arranque'));
    chk('★ sw.js lo precarga', /'\.\/js\/54-sync-vivo\.js\?v=' \+ APP_VERSION/.test(sw));
    chk('★ El arranque enciende las escuchas tras cargar el Total', /existenciaCargarInicial[\s\S]{0,800}syncVivoIniciar\(\)/.test(arr));
    chk('★ El cierre de sesión las apaga', /syncVivoDetener\(\)/.test(auth));
    const vH = (html.match(/\?v=([\d.]+)/) || [])[1], vS = (sw.match(/APP_VERSION = '([\d.]+)'/) || [])[1];
    chk('La versión de index.html y sw.js coincide', vH && vH === vS, vH + ' / ' + vS);
    chk('La versión avanzó (>= 5.22)', vS && Number(vS.split('.')[0]) >= 5 && Number(vS.split('.')[1]) >= 22, vS);
    chk('Las reglas no cambian: leer compras/ventas ya exige purchases.read / sales.read y los cortes cualquier cuenta activa',
        /match \/compras\/\{compraId\} \{\s*allow read:\s+if hasPerm\('purchases\.read'\)/.test(leer('firestore.rules')) && /match \/anclasExistencia\/\{fecha\} \{\s*allow read:\s+if request\.auth != null/.test(leer('firestore.rules')));

    console.log('\n  ── v5.22 · Compras, ventas y cortes en vivo entre dispositivos (estática) ──\n');
    casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(104) + (c.ok ? '' : '  ← ' + c.d)));
    console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron');
    process.exit(fallos ? 1 : 0);
})();
