// v5.36 — Eliminar el último corte importado (con respaldo en papelera).
//   node pruebas/prueba-v536-corte-eliminar.js
// Ejecuta el código REAL de js/53 y js/96 contra un Firestore SIMULADO (sin red,
// sin emulador): qué se escribe, qué NO se escribe y en qué orden. Las reglas de
// Firestore de verdad las cubre prueba-v536-corte-eliminar-integracion.js (emulador).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src53 = leer('js/53-papelera.js'), src96 = leer('js/96-importar.js'), reglas = leer('firestore.rules');

// ── Entorno simulado ────────────────────────────────────────────────────
function entorno(opc) {
    opc = opc || {};
    const reg = { ops: [], commits: 0, notas: [], confirms: [], renders: 0, sync: [], invalidado: 0, backups: 0 };
    const cortes = (opc.cortes || []).map(c => ({ id: c.id, data: c.data }));
    const db = {
        collection(n) { return { doc(i) { return { _ruta: 'inventarioApp/b/' + n + '/' + i,
            collection(n2) { return { doc(i2) { return { _ruta: 'inventarioApp/' + i + '/' + n2 + '/' + i2 }; },
                orderBy() { return { limit() { return { get: async () => { if (opc.falloLectura) throw new Error('sin red'); return { forEach(f) { cortes.forEach(c => f({ id: c.id, data: () => c.data })); } }; } }; } }; } }; } }; } }; },
        batch() { const ops = []; return { set(ref, d) { ops.push({ op: 'set', ruta: ref._ruta, data: d }); }, delete(ref) { ops.push({ op: 'delete', ruta: ref._ruta }); },
            update(ref) { ops.push({ op: 'update', ruta: ref._ruta }); },
            commit: async () => { if (opc.falloCommit) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' }); reg.commits++; reg.ops.push.apply(reg.ops, ops); } }; }
    };
    const ctx = {
        console: { warn() {}, info() {}, log() {}, error() {} }, Math, Date, String, Number, Array, Object, JSON, isFinite, Promise,
        window: {}, document: { getElementById: () => null, addEventListener() {} }, navigator: { onLine: opc.sinConexion ? false : true },
        FIRESTORE_DOC_ID: 'b', currentUserUid: 'jefe', activeTab: 'importar',
        hasPermission: (p) => opc.permisos ? opc.permisos.indexOf(p) !== -1 : true,
        showNotification: (m) => reg.notas.push(m),
        showConfirm: (m, ok) => { reg.confirms.push(m); if (opc.confirmar !== false) return ok(); },
        renderTab: () => { reg.renders++; }, escapeHtml: (s) => String(s),
        _registrarEnSyncQueue: (e) => reg.sync.push(e), _crearBackupNombrado: () => { reg.backups++; },
        existenciaInvalidarInicial: () => { reg.invalidado++; }, existenciaCargarInicial: () => {},
        existenciaInicialEstado: () => ({ ancla: opc.anclaVigente || null }),
        _db: opc.sinDb ? undefined : db, products: [], recetas: []
    };
    ctx.window = ctx; vm.createContext(ctx);
    vm.runInContext(src53 + '\n' + src96, ctx);
    return { ctx, reg, run: (cod) => vm.runInContext(cod, ctx) };
}
const imp = (f, h, extra) => Object.assign({ fecha: f, hora: h, tipo: 'importacion_excel', origen: { tipo: 'importacion_excel', inventoryId: 'excel:' + f, archivo: 'sbo.xlsx' },
    saldos: { A: 1, B: 2 }, totalProductos: 2, productosContados: 2, contabilizadoEn: 1000, resumen: { neto: -50 } }, extra || {});
const CORTES = [
    { id: '2026-10-05_2340', data: imp('2026-10-05', '23:40', { contabilizadoEn: 1 }) },
    { id: '2026-10-06_1000', data: imp('2026-10-06', '10:00', { contabilizadoEn: 2 }) },
    { id: '2026-10-07', data: { fecha: '2026-10-07', tipo: 'fin_de_mes', saldos: {}, contabilizadoEn: 9 } }
];
const esperar = () => new Promise(r => setTimeout(r, 20));

(async () => {
    // ═══ 1 · Elegir el último corte IMPORTADO (función pura real) ════════════
    const E0 = entorno();
    E0.ctx._d = CORTES;
    const el = E0.run('importarElegirUltimoCorte(_d)');
    chk('★ El último importado es el de fecha y hora más recientes, e IGNORA los contabilizados (aunque sean más nuevos)', el && el.id === '2026-10-06_1000', el && el.id);
    E0.ctx._d2 = [{ id: '2026-10-05_0900', data: imp('2026-10-05', '09:00', { contabilizadoEn: 5 }) }, { id: '2026-10-05_2300', data: imp('2026-10-05', '23:00', { contabilizadoEn: 1 }) }];
    chk('Mismo día: gana la hora más tarde', E0.run('importarElegirUltimoCorte(_d2)').id === '2026-10-05_2300');
    chk('Sin cortes importados → null (no inventa uno)', E0.run('importarElegirUltimoCorte([])') === null && E0.run('importarElegirUltimoCorte([{id:"x",data:{tipo:"fin_de_mes"}}])') === null && E0.run('importarElegirUltimoCorte(null)') === null);
    chk('Un documento vacío o basura no rompe la elección', E0.run('importarElegirUltimoCorte([null,{id:"a"},{id:"b",data:null}])') === null);

    // ═══ 2 · Registro de papelera (puro) ═════════════════════════════════════
    const orig = CORTES[1].data;
    const pr = E0.run('papeleraRegistroCorte("2026-10-06_1000", ' + JSON.stringify(orig) + ', { uidActor: "jefe", ts: 123 })');
    chk('★ El registro guarda el corte COMPLETO y idéntico (se puede volver a crear tal cual)', JSON.stringify(pr.data.contenido) === JSON.stringify(orig));
    chk('Registro: origen "corte", id/grupo con timestamp, ruta original, quién y cuándo',
        pr.data.origen === 'corte' && pr.id === 'corte_2026-10-06_1000_123' && pr.data.grupo === pr.id && pr.data.rutaOriginal === 'anclasExistencia/2026-10-06_1000'
        && pr.data.borradoPor === 'jefe' && pr.data.borradoEn === 123 && pr.data.parte === 1 && pr.data.partes === 1 && pr.data.corteId === '2026-10-06_1000');
    chk('Registro: resumen legible (archivo, productos, neto)', pr.data.resumen.archivo === 'sbo.xlsx' && pr.data.resumen.productos === 2 && pr.data.resumen.neto === -50);
    chk('La papelera conoce el origen "corte"', E0.run('PAPELERA_ORIGENES.corte.titulo').indexOf('Corte') === 0);

    // ═══ 3 · Eliminar: camino feliz ══════════════════════════════════════════
    let E = entorno({ cortes: CORTES, anclaVigente: { id: '2026-10-06_1000', fecha: '2026-10-06' } });
    E.ctx._impUltimoCorte = { estado: 'ok', corte: { id: '2026-10-06_1000', data: orig } };
    await E.run('importarEliminarUltimoCorte()'); await esperar();
    const o = E.reg.ops;
    chk('★ UN solo batch con exactamente 2 operaciones: copia en papelera (set) + borrado del corte (delete)',
        E.reg.commits === 1 && o.length === 2 && o[0].op === 'set' && /\/papelera\/corte_2026-10-06_1000_/.test(o[0].ruta) && o[1].op === 'delete' && o[1].ruta.endsWith('/anclasExistencia/2026-10-06_1000'), JSON.stringify(o.map(x => x.op + ' ' + x.ruta)));
    chk('★ La copia va ANTES del borrado dentro del batch y trae el corte intacto', o[0].data && JSON.stringify(o[0].data.contenido) === JSON.stringify(orig));
    chk('Pide confirmación antes de tocar nada y la confirmación dice el efecto sobre el Total y la papelera',
        E.reg.confirms.length === 1 && /ELIMINAR EL ÚLTIMO CORTE/.test(E.reg.confirms[0]) && /VIGENTE/.test(E.reg.confirms[0]) && /Papelera/.test(E.reg.confirms[0]));
    chk('Deja rastro (cola de sincronización), respaldo previo local, invalida el Total y avisa', E.reg.sync.length === 1 && E.reg.sync[0].tipo === 'corte_existencias_eliminado'
        && E.reg.backups === 1 && E.reg.invalidado === 1 && E.reg.notas.some(n => /eliminado/.test(n)));
    chk('★ Solo toca anclasExistencia y papelera: ni productos, ni conteos, ni stock',
        o.every(x => /\/(papelera|anclasExistencia)\//.test(x.ruta)) && !o.some(x => x.op === 'update'));

    // Corte NO vigente
    E = entorno({ cortes: CORTES, anclaVigente: { id: '2026-10-07', fecha: '2026-10-07' } });
    E.ctx._impUltimoCorte = { estado: 'ok', corte: { id: '2026-10-06_1000', data: orig } };
    await E.run('importarEliminarUltimoCorte()'); await esperar();
    chk('Si hay un corte más nuevo vigente, avisa que el Total NO cambia', /NO cambia/.test(E.reg.confirms[0] || ''));

    // ═══ 4 · Eliminar: protecciones (no se escribe NADA) ═════════════════════
    const nada = async (nombre, opc, pre) => {
        const X = entorno(opc); if (pre) pre(X);
        await X.run('importarEliminarUltimoCorte()'); await esperar();
        chk('★ ' + nombre + ' → no se escribe nada', X.reg.commits === 0 && X.reg.ops.length === 0 && X.reg.notas.length >= 1, JSON.stringify(X.reg.notas));
        return X;
    };
    await nada('Sin permiso inventory.post', { cortes: CORTES, permisos: ['inventory.count'] });
    await nada('Sin conexión', { cortes: CORTES, sinConexion: true });
    await nada('Sin Firestore', { cortes: CORTES, sinDb: true });
    await nada('Falla la lectura del servidor', { cortes: CORTES, falloLectura: true });
    await nada('No hay cortes importados', { cortes: [{ id: '2026-10-07', data: { fecha: '2026-10-07', tipo: 'fin_de_mes' } }] });
    const stale = await nada('El «último» cambió desde que se mostró (pantalla vieja)', { cortes: CORTES }, (X) => { X.ctx._impUltimoCorte = { estado: 'ok', corte: { id: '2026-10-05_2340', data: CORTES[0].data } }; });
    chk('…y la pantalla se refresca con el corte real', stale.ctx._impUltimoCorte.corte.id === '2026-10-06_1000' && stale.reg.renders >= 1);
    const grande = { fecha: '2026-10-08', hora: '09:00', tipo: 'importacion_excel', origen: { archivo: 'x' }, saldos: {}, relleno: 'x'.repeat(800000) };
    await nada('Corte demasiado grande para la papelera', { cortes: [{ id: '2026-10-08_0900', data: grande }] });
    const cancel = entorno({ cortes: CORTES, confirmar: false });
    await cancel.run('importarEliminarUltimoCorte()'); await esperar();
    chk('★ Si la persona cancela la confirmación, no se escribe nada', cancel.reg.commits === 0 && cancel.reg.confirms.length === 1);
    const rechazo = entorno({ cortes: CORTES, falloCommit: true });
    rechazo.ctx._impUltimoCorte = { estado: 'ok', corte: { id: '2026-10-06_1000', data: orig } };
    await rechazo.run('importarEliminarUltimoCorte()'); await esperar();
    chk('★ Si el servidor rechaza el batch: avisa que NO se borró nada, no registra en la cola ni invalida el Total',
        rechazo.reg.notas.some(n => /No se borr|rechaz/.test(n)) && rechazo.reg.sync.length === 0 && rechazo.reg.invalidado === 0);

    // ═══ 5 · Panel del hub ═══════════════════════════════════════════════════
    const P = entorno({ cortes: CORTES });
    P.ctx._impUltimoCorte = { estado: 'ok', corte: { id: '2026-10-06_1000', data: orig } };
    const h = P.run('_renderImpUltimoCorte()');
    chk('Con permiso: el panel muestra el corte y el botón «Eliminar último corte»', /2026-10-06_1000/.test(h) && /id="impBtnEliminarCorte"/.test(h) && /importarEliminarUltimoCorte\(\)/.test(h));
    const Q = entorno({ cortes: CORTES, permisos: ['inventory.count'] });
    Q.ctx._impUltimoCorte = { estado: 'ok', corte: { id: '2026-10-06_1000', data: orig } };
    chk('★ Sin inventory.post el panel no se dibuja (ni consulta)', Q.run('_renderImpUltimoCorte()') === '');
    P.ctx._impUltimoCorte = { estado: 'ninguno', corte: null };
    chk('Sin cortes importados: lo dice y no ofrece borrar', /Todavía no hay cortes/.test(P.run('_renderImpUltimoCorte()')) && !/impBtnEliminarCorte/.test(P.run('_renderImpUltimoCorte()')));
    P.ctx._impUltimoCorte = { estado: 'error', corte: null };
    chk('Con error: ofrece reintentar y NO se repinta en bucle', /data-imp-reintentar/.test(P.run('_renderImpUltimoCorte()')) && P.reg.renders === 0);

    // ═══ 6 · Garantías estáticas ═════════════════════════════════════════════
    const fn = (src, nombre) => { const i = src.indexOf('async function ' + nombre + '('); const j = src.indexOf('\n        function _renderImpUltimoCorte', i); return src.slice(i, j); };
    const del = sinCom(fn(src96, 'importarEliminarUltimoCorte'));
    chk('★ Papelera y borrado comparten el MISMO batch (set antes de delete, un solo commit)', /batch\.set\([\s\S]*?papelera[\s\S]*?batch\.delete\([\s\S]*?anclasExistencia[\s\S]*?await batch\.commit\(\)/.test(del) && (del.match(/batch\.commit\(\)/g) || []).length === 1);
    chk('Relee el servidor antes de borrar y exige el permiso', /_impLeerCortesServidor\(\)/.test(del) && /hasPermission\('inventory\.post'\)/.test(del));
    chk('No toca stockByArea, products, auditoriaConteo ni localStorage', !/stockByArea|products\.|auditoriaConteo|localStorage|saveToLocalStorage|syncToCloud/.test(del));
    chk('Solo se borra por la vía de este botón: ningún otro archivo escribe delete() en anclasExistencia',
        leer('index.html') && fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f !== '96-importar.js').every(f => !/anclasExistencia'\)\.doc\([^)]*\)\.delete\(|anclasExistencia[\s\S]{0,80}\.delete\(/.test(sinCom(leer('js/' + f)))));
    const bloque = (reglas.match(/match \/anclasExistencia\/\{fecha\} \{[\s\S]*?\n                 \}/) || [''])[0];
    chk('★ Reglas: update sigue prohibido; delete SOLO con inventory.post, tipo importacion_excel e id con hora', /allow update: if false;/.test(bloque)
        && /allow delete: if hasPerm\('inventory\.post'\)\s*&&\s*resource\.data\.tipo == 'importacion_excel'\s*&&\s*fecha\.matches\(/.test(bloque) && !/allow update, delete/.test(bloque));
    chk('Reglas: la papelera acepta origen "corte" solo con inventory.post', /origen == 'corte' && hasPerm\('inventory\.post'\)/.test(reglas));
    chk('Reglas: los demás cortes y colecciones siguen inmutables (inicial semanal, cortes mensuales)', /match \/inventariosIniciales\/\{semanaId\} \{[\s\S]{0,600}?allow update, delete: if false;/.test(reglas));
    const rest = sinCom(src53.slice(src53.indexOf('async function _papRestaurarCorte'), src53.indexOf('async function _papRestaurarConteos')));
    chk('★ Restaurar solo crea si el id NO existe (nunca pisa) y no toca nada más', /s\.exists\) return \{ restaurados: 0, omitidos: 1 \}/.test(rest) && /ref\.set\(p\.contenido\)/.test(rest) && !/\.update\(|\.delete\(|stockByArea/.test(rest));
    chk('La restauración está enlazada en la papelera (dispatch y texto)', /origen === 'corte'\) r = await _papRestaurarCorte\(g\)/.test(src53) && /g\.origen === 'corte'/.test(src53));
    chk('Exportaciones globales de los botones', ['importarEliminarUltimoCorte', 'importarReintentarUltimoCorte', 'importarElegirUltimoCorte'].every(n => new RegExp('window\\.' + n + '\\s*=').test(src96)) && /window\.papeleraRegistroCorte\s*=/.test(src53));

    let mal = 0;
    C.forEach(c => { console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '  → ' + c.d)); if (!c.ok) mal++; });
    console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron\n');
    process.exit(mal ? 1 : 0);
})();
