// v5.47 — Precio vigente = costo de la última compra (costos/ultimos). Capa pura + guardas estáticas.
//   · costosDeCompra / _costoEsMasNuevo / costosAplicar son PURAS: se prueban con el código real de js/88.
//   · precioProducto (js/00-nucleo) es el único que decide el precio; una guarda cuenta las lecturas crudas
//     de product.precio que quedan y falla si aparece una nueva (para que no vuelva a salir un precio viejo).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
function extraerFuncion(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    const m = /\n        (?:async )?function /.exec(src.slice(ini + 10));
    return m ? src.slice(ini, ini + 10 + m.index) : src.slice(ini);
}
const compras88 = leer('js/88-compras.js');
const ctx = { console, Math, Date, String, Number, Array, Object, JSON, isFinite, window: {} };
vm.createContext(ctx);
vm.runInContext(require('./_precio-producto'), ctx);
vm.runInContext(['compraCancelada', 'costosDeCompra', '_costoEsMasNuevo', '_sinPrevio', 'costosAplicar'].map(n => extraerFuncion(compras88, n)).join('\n'), ctx);
const r = (code) => vm.runInContext(code, ctx);
const comp = (id, fecha, lineas, extra) => Object.assign({ compraId: id, folio: id.toUpperCase(), fechaIngreso: fecha, lineas, creadoEn: 1000 }, extra || {});
const L = (pid, costo, extra) => Object.assign({ productoId: pid, costoUnitario: costo, enCatalogo: true }, extra || {});
ctx.__c = comp; ctx.__L = L;

// ═══ 1 · costosDeCompra ═════════════════════════════════════════════════
const m1 = r(`costosDeCompra(__c('c1', '2026-11-10', [__L('A', 100), __L('B', 0), __L('C', -5), __L('D', 50, { enCatalogo: false }), __L('E', 'abc'), __L('A', 120)]), 7)`);
chk('★ Un costo de 0, negativo, no numérico o de un producto fuera del catálogo NUNCA es precio', Object.keys(m1).join() === 'A', JSON.stringify(m1));
chk('Si el producto repite línea en la misma compra, manda la última', m1.A.costo === 120 && m1.A.fecha === '2026-11-10' && m1.A.compraId === 'c1' && m1.A.ts === 7 && m1.A.folio === 'C1');
chk('★ Una compra cancelada no deja ningún costo', Object.keys(r(`costosDeCompra(__c('c9', '2026-11-10', [__L('A', 100)], { cancelada: true }))`)).length === 0);

// ═══ 2 · costosAplicar: la más reciente manda ═══════════════════════════
const e = (costo, fecha, compraId, ts) => ({ costo, fecha, compraId, folio: compraId.toUpperCase(), ts: ts || 0 });
ctx.__e = e;
let a = r(`costosAplicar({}, { nuevas: { A: __e(100, '2026-11-01', 'c1', 1) } })`);
chk('Sin precio previo: la compra fija el precio y no hay «previo»', a.mapa.A.costo === 100 && a.mapa.A.previo === null && a.cambios.join() === 'A');
a = r(`costosAplicar({ A: Object.assign(__e(100, '2026-11-01', 'c1', 1), { previo: null }) }, { nuevas: { A: __e(130, '2026-11-08', 'c2', 2) } })`);
chk('★ Una compra más nueva (por fecha de ingreso) reemplaza y guarda la anterior como «previo»', a.mapa.A.costo === 130 && a.mapa.A.previo.costo === 100 && a.mapa.A.previo.compraId === 'c1' && a.mapa.A.previo.previo === undefined);
a = r(`costosAplicar({ A: Object.assign(__e(130, '2026-11-08', 'c2', 2), { previo: null }) }, { nuevas: { A: __e(90, '2026-10-20', 'c0', 99) } })`);
chk('★ Importar tarde una compra VIEJA no regresa el precio (aunque se registre después)', a.mapa.A.costo === 130 && a.cambios.length === 0);
a = r(`costosAplicar({ A: Object.assign(__e(130, '2026-11-08', 'c2', 5), { previo: null }) }, { nuevas: { A: __e(140, '2026-11-08', 'c3', 9) } })`);
chk('Misma fecha de ingreso: gana la registrada después', a.mapa.A.costo === 140 && a.mapa.A.previo.costo === 130);
a = r(`costosAplicar({ A: Object.assign(__e(130, '2026-11-08', 'c2', 9), { previo: null }) }, { nuevas: { A: __e(140, '2026-11-08', 'c3', 5) } })`);
chk('Misma fecha y registrada antes: no reemplaza', a.mapa.A.costo === 130 && a.cambios.length === 0);
a = r(`costosAplicar({ A: Object.assign(__e(130, '2026-11-08', 'c2', 5), { previo: __e(100, '2026-11-01', 'c1', 1) }) }, { nuevas: { A: __e(135, '2026-11-08', 'c2', 5) } })`);
chk('★ La MISMA compra reingresada con otro costo actualiza sin anidar el «previo»', a.mapa.A.costo === 135 && a.mapa.A.previo.compraId === 'c1');
a = r(`costosAplicar({ A: __e(130, '2026-11-08', 'c2', 5) }, { nuevas: { A: __e(130, '2026-11-08', 'c2', 5) } })`);
chk('Aplicar dos veces la misma compra no cambia nada (idempotente)', a.cambios.length === 0);

// ═══ 3 · costosAplicar: cancelar ════════════════════════════════════════
a = r(`costosAplicar({ A: Object.assign(__e(130, '2026-11-08', 'c2', 5), { previo: __e(100, '2026-11-01', 'c1', 1) }) }, { revertir: ['c2'] })`);
chk('★ Cancelar la compra vigente REGRESA el precio de la anterior', a.mapa.A.costo === 100 && a.mapa.A.compraId === 'c1' && a.mapa.A.previo === null && a.cambios.join() === 'A' && a.eliminar.length === 0);
a = r(`costosAplicar({ A: Object.assign(__e(130, '2026-11-08', 'c2', 5), { previo: null }) }, { revertir: ['c2'] })`);
chk('★ Cancelar la única compra quita el costo (vuelve el precio del catálogo)', !('A' in a.mapa) && a.eliminar.join() === 'A');
a = r(`costosAplicar({ A: Object.assign(__e(130, '2026-11-08', 'c2', 5), { previo: __e(100, '2026-11-01', 'c1', 1) }) }, { revertir: ['c1'] })`);
chk('Cancelar la compra que era solo la «previa» deja el precio vigente y limpia el «previo»', a.mapa.A.costo === 130 && a.mapa.A.previo === null);
a = r(`costosAplicar({ A: __e(130, '2026-11-08', 'c2', 5) }, { revertir: ['otra'] })`);
chk('Cancelar una compra que no fijaba el precio no toca nada', a.mapa.A.costo === 130 && a.cambios.length === 0);
a = r(`costosAplicar({ A: __e(130, '2026-11-08', 'c2', 5) }, { revertir: ['c2'], nuevas: { A: __e(110, '2026-11-02', 'c1', 1) } })`);
chk('Cancelar + una compra anterior conocida: el precio pasa a esa compra', a.mapa.A.costo === 110 && a.mapa.A.compraId === 'c1');
const orig = JSON.stringify({ A: { costo: 1, fecha: '2026-01-01', compraId: 'x', ts: 1 } });
ctx.__orig = JSON.parse(orig);
r(`costosAplicar(__orig, { nuevas: { A: __e(2, '2026-02-01', 'y', 2) }, revertir: ['x'] })`);
chk('Las funciones puras no modifican el mapa que reciben', JSON.stringify(ctx.__orig) === orig);

// ═══ 4 · precioProducto ═════════════════════════════════════════════════
ctx.costosUltimos = { A: { costo: 1480, fecha: '2026-11-10', folio: '3646', compraId: 'c1' }, Z: { costo: 0, compraId: 'cz' }, N: { costo: 'x' } };
chk('★ precioProducto: con compra manda el costo de la última compra, no el del catálogo', r(`precioProducto({ id: 'A', precio: 1400 })`) === 1480);
chk('Sin compra: el precio del catálogo', r(`precioProducto({ id: 'B', precio: 90 })`) === 90);
chk('★ Un costo de 0 o inválido guardado NO pisa el catálogo', r(`precioProducto({ id: 'Z', precio: 55 })`) === 55 && r(`precioProducto({ id: 'N', precio: 56 })`) === 56);
chk('Sin compra y sin precio de catálogo: undefined (nunca se inventa un 0)', r(`precioProducto({ id: 'Q' })`) === undefined && r(`precioProducto(null)`) === undefined);
chk('precioProductoOrigen dice de dónde sale', r(`precioProductoOrigen({ id: 'A', precio: 1 }).origen`) === 'compra' && r(`precioProductoOrigen({ id: 'B', precio: 1 }).origen`) === 'catalogo' && r(`precioProductoOrigen({ id: 'Q' }).origen`) === 'ninguno'
    && r(`precioProductoOrigen({ id: 'A' }).folio`) === '3646');

// ═══ 5 · Guardas estáticas ══════════════════════════════════════════════
// Lecturas crudas de product.precio permitidas (cuentan por archivo). Cualquiera nueva debe pasar por precioProducto().
//   00-nucleo: el propio acceso · 15/46/75: registros de snapshot que ya guardaron el precio vigente al cierre
//   85: formulario del catálogo (leer/escribir el precio del CATÁLOGO) · 90: importación del catálogo
//   95/96: Excel del catálogo (ida y vuelta: exporta el precio del catálogo, no el de compra)
const PERMITIDAS = { 'js/00-nucleo.js': 2, 'js/15-ciclo-semanal.js': 2, 'js/46-arrastre.js': 1, 'js/75-auditoria-flujo.js': 3,
                     'js/85-ui-inventario-fisico.js': 5, 'js/90-ciclo-admin.js': 1, 'js/95-exportacion.js': 2, 'js/96-importar.js': 2 };
const patron = /\b(?:p|prod|product|producto|newProduct|f\.p|hit\[0\])\.precio\b/g;
const exceso = [];
fs.readdirSync(path.join(RAIZ, 'js')).filter(f => /\.js$/.test(f)).forEach(f => {
    const rel = 'js/' + f;
    const codigo = leer(rel).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const n = (codigo.match(patron) || []).length;
    const ok = PERMITIDAS[rel] || 0;
    if (n > ok) exceso.push(rel + ': ' + n + ' (permitidas ' + ok + ')');
    if (n < ok) exceso.push(rel + ': ' + n + ' (se esperaban ' + ok + ': actualiza la lista de PERMITIDAS)');
});
chk('★ Ninguna pantalla, cálculo ni Excel lee product.precio por su cuenta (todo pasa por precioProducto)', exceso.length === 0, exceso.join(' | '));
chk('guardarCompra aplica los costos de la compra y cancelarCompra los revierte',
    /aplicarCostosDeCompra\(compra\)/.test(extraerFuncion(compras88, 'guardarCompra')) && /revertirCostosDeCompra\(cancelada\.compraId\)/.test(extraerFuncion(compras88, 'cancelarCompra')));
chk('★ Registrar la compra NO falla si el costo no se pudo guardar ni si el repintado falla (try/catch, .catch y sin await)',
    !/await aplicarCostosDeCompra/.test(compras88) && !/await revertirCostosDeCompra/.test(compras88)
    && /aplicarCostosDeCompra\(compra\)[\s\S]{0,200}\.catch\(/.test(compras88) && /revertirCostosDeCompra\(cancelada\.compraId\)[\s\S]{0,200}\.catch\(/.test(compras88)
    && /function _preciosRepintar\(\) \{[\s\S]{0,120}try \{/.test(compras88));
chk('La escritura de costos/ultimos es una transacción con FieldPath (un producto con punto en el id no rompe la ruta)',
    /runTransaction/.test(extraerFuncion(compras88, '_costosUltimosPersistir')) && /new FP\('productos', pid\)/.test(extraerFuncion(compras88, '_costosUltimosPersistir')));
chk('Solo escribe quien puede registrar compras (purchases.import / purchases.create): igual que firestore.rules',
    /purchases\.import/.test(extraerFuncion(compras88, '_puedeEscribirCostos')) && /purchases\.create/.test(extraerFuncion(compras88, '_puedeEscribirCostos'))
    && /match \/costos\/\{docId\}[\s\S]{0,200}hasPerm\('purchases\.import'\) \|\| hasPerm\('purchases\.create'\)/.test(leer('firestore.rules')));
chk('Los costos se cargan al arrancar y cuando cambian las compras (arranque y sync en vivo)',
    /cargarUltimosCostos/.test(leer('js/60-arranque.js')) && (leer('js/54-sync-vivo.js').match(/cargarUltimosCostos/g) || []).length >= 2);
chk('No se tocaron las reglas de Firestore (costos/ultimos ya estaba)', !/v5\.47/.test(leer('firestore.rules')));

const w = Math.max(...C.map(c => c.n.length));
console.log('\n  ── v5.47 · Precio vigente = costo de la última compra (capa pura) ──\n');
C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
const fallos = C.filter(c => !c.ok).length;
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
