// v5.50 — Pedido sugerido con la base «conteo de todas las áreas» (además de la existencia del sistema).
// Capa pura con el código REAL de js/49 y js/73 (vm) + guardas estáticas.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
function extraer(src, nombre) {
    let ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    const m = /\n        (?:\/\*\*|(?:async )?function )/.exec(src.slice(ini + 10));
    return m ? src.slice(ini, ini + 10 + m.index) : src.slice(ini);
}
const s49 = leer('js/49-fisico-vs-sistema.js'), s73 = leer('js/73-pedido-sugerido.js'), s70 = leer('js/70-conversion-render.js');
const ctx = { console, Math, Number, String, Array, Object, isFinite, window: {}, AREAS_CONTEO: ['almacen', 'barra1', 'barra2'] };
vm.createContext(ctx);
vm.runInContext(require('./_precio-producto'), ctx);
vm.runInContext(['pedidoSugeridoProducto', 'pedidoSugeridoDesdeTotal'].map(n => extraer(s49, n)).join('\n'), ctx);
vm.runInContext(['_psRed', 'pedidoSugeridoConteoTotal', 'pedidoSugeridoFilas'].map(n => extraer(s73, n)).join('\n'), ctx);
vm.runInContext(extraer(s70, 'getTotalStock'), ctx);
// existencia del SISTEMA simulada (inicial + compras − ventas): un número por producto, distinto del conteo
ctx.__sis = { A: 20, B: 2, C: 5, D: 3 };
vm.runInContext('function existenciaMostrada(p) { return __sis[p.id]; }', ctx);
const r = (c) => vm.runInContext(c, ctx);

// ═══ 1 · pedidoSugeridoDesdeTotal (misma fórmula, otro total) ═══
const P = (o) => Object.assign({ id: 'X', name: 'X', stockMinimo: 10, conversion: 1 }, o);
ctx.__p = P({ conversion: 0.567 });
chk('★ Ejemplo verificado de Eduardo (lychees): mín 10.68, total 7.52, conv 0.567 → 6 (TECHO)',
    r("pedidoSugeridoDesdeTotal({ stockMinimo: 10.68, conversion: 0.567 }, 7.52)") === 6);
chk('Total ≥ mínimo → 0 (no hace falta pedir)', r("pedidoSugeridoDesdeTotal({ stockMinimo: 10, conversion: 1 }, 10)") === 0 && r("pedidoSugeridoDesdeTotal({ stockMinimo: 10, conversion: 1 }, 12)") === 0);
chk('Sin conversión válida → null (no se inventa un factor)', r("pedidoSugeridoDesdeTotal({ stockMinimo: 10 }, 3)") === null && r("pedidoSugeridoDesdeTotal({ stockMinimo: 10, conversion: 0 }, 3)") === null);
chk('Total no numérico → null', r("pedidoSugeridoDesdeTotal({ stockMinimo: 10, conversion: 1 }, null)") === null && r("pedidoSugeridoDesdeTotal({ stockMinimo: 10, conversion: 1 }, NaN)") === null && r("pedidoSugeridoDesdeTotal({ stockMinimo: 10, conversion: 1 }, undefined)") === null);
chk('Sin stock mínimo → null', r("pedidoSugeridoDesdeTotal({ conversion: 1 }, 3)") === null && r("pedidoSugeridoDesdeTotal({ stockMinimo: 0, conversion: 1 }, 3)") === null);
chk('★ pedidoSugeridoProducto (base sistema) sigue dando lo mismo: delega en la misma fórmula',
    r("pedidoSugeridoProducto({ id: 'B', stockMinimo: 10, conversion: 1 })") === 8 && r("pedidoSugeridoProducto({ id: 'A', stockMinimo: 10, conversion: 1 })") === 0);

// ═══ 2 · pedidoSugeridoConteoTotal ═══
chk('Sin stockByArea → null (no se cuenta como 0)', r("pedidoSugeridoConteoTotal({ id: 'Z' })") === null);
chk('stockByArea vacío → null', r("pedidoSugeridoConteoTotal({ id: 'Z', stockByArea: {} })") === null);
chk('★ Suma TODAS las áreas configuradas (3.5 = 2 + 1.5 + 0)', r("pedidoSugeridoConteoTotal({ id: 'Z', stockByArea: { almacen: 2, barra1: 1.5, barra2: 0 } })") === 3.5);
chk('Un área contada y las demás sin dato → suma lo contado', r("pedidoSugeridoConteoTotal({ id: 'Z', stockByArea: { barra2: 4 } })") === 4);
ctx.AREAS_CONTEO = ['almacen', 'barra1', 'barra2', 'terraza'];
chk('Un área nueva configurada (R6) también cuenta', r("pedidoSugeridoConteoTotal({ id: 'Z', stockByArea: { terraza: 2.25, almacen: 1 } })") === 3.25);
ctx.AREAS_CONTEO = ['almacen', 'barra1', 'barra2'];

// ═══ 3 · pedidoSugeridoFilas con cada base ═══
const lista = [
    P({ id: 'A', name: 'A', stockByArea: { almacen: 3, barra1: 1 } }),            // sistema 20 (no pide) · conteo 4 → pide 6
    P({ id: 'B', name: 'B', stockByArea: { almacen: 8, barra1: 7, barra2: 0 } }), // sistema 2 (pide 8) · conteo 15 → no pide
    P({ id: 'C', name: 'C' }),                                                    // sin conteo
    P({ id: 'D', name: 'D', stockByArea: { almacen: 3 } })                        // sistema 3 → 7 · conteo 3 → 7
];
ctx.__l = lista;
const ids = (f) => f.map(x => x.id).join(',');
ctx.__o = {};
const sis = r("pedidoSugeridoFilas(__l, { soloBajo: true })");
const sis2 = r("pedidoSugeridoFilas(__l, { soloBajo: true, fuente: 'sistema' })");
const con = r("pedidoSugeridoFilas(__l, { soloBajo: true, fuente: 'conteo' })");
chk('★ Sin indicar base (o con «sistema») el resultado es el de siempre: B (8), C (5) y D (7) con el stub del sistema',
    ids(sis) === 'B,C,D' && ids(sis) === ids(sis2) && sis.find(f => f.id === 'B').sugerido === 8, ids(sis));
chk('★ Con «conteo» pide lo que falta según el conteo: A (6) y D (7); B ya NO (tiene 15) y C (sin conteo) tampoco',
    ids(con) === 'A,D' && con.find(f => f.id === 'A').sugerido === 6 && con.find(f => f.id === 'D').sugerido === 7, JSON.stringify(con.map(f => [f.id, f.sugerido])));
chk('En «conteo» la existencia de la fila es el conteo total (A = 4, D = 3)', con.find(f => f.id === 'A').enStock === 4 && con.find(f => f.id === 'D').enStock === 3);
const todas = r("pedidoSugeridoFilas(__l, { soloBajo: false, fuente: 'conteo' })");
const c = todas.find(f => f.id === 'C');
chk('★ Sin ningún conteo: la fila existe (soloBajo apagado) pero enStock = null, sugerido = null y sinConteo = true — nunca se sugiere el mínimo entero',
    !!c && c.enStock === null && c.sugerido === null && c.sinConteo === true);
chk('Con base «sistema» ninguna fila lleva sinConteo', r("pedidoSugeridoFilas(__l, { soloBajo: false })").every(f => !f.sinConteo));

// ═══ 4 · Guardas estáticas de la pantalla ═══
chk('La base por defecto es «sistema» (no cambia el comportamiento de quien no toca nada)', /fuente:\s*'sistema'/.test(s73));
chk('Cambiar de base reinicia selección y cantidades escritas (ya no corresponden)', /_ps\.fuente = nueva; _ps\.seleccion = null; _ps\.cantidades = \{\};/.test(s73));
chk('La exportación a Excel usa la misma base que la pantalla y la anota en la hoja Información',
    /soloBajo: true, fuente: _ps\.fuente/.test(s73) && /\['Base de la existencia'/.test(s73));
chk('Los dos botones de base son píldoras accesibles (aria-pressed) con data-ps-fuente',
    (s73.match(/data-ps-accion="fuente" data-ps-fuente="(sistema|conteo)"/g) || []).length === 2 && /aria-pressed="' \+ !_psConteo/.test(s73));
chk('El pedido se sigue generando con el carrito de siempre (addToCart) — sin escrituras nuevas', /addToCart\(f\.id, _psCantidad\(f\)\)/.test(s73) && !/\.set\(|\.update\(|batch/.test(extraer(s73, 'pedidoSugeridoGenerar')));

const fallos = C.filter(x => !x.ok);
C.forEach(x => console.log((x.ok ? '  ✅ ' : '  ❌ ') + x.n + (x.ok ? '' : '  ← ' + x.d)));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
process.exit(fallos.length ? 1 : 0);
