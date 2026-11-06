// v5.41 — Compras: rango de fechas de ingreso (capa pura + consulta acotada con Firestore simulado)
// y garantías estáticas del botón «Importar Excel».
//   node pruebas/prueba-v541.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });

// ── Firestore simulado: respeta where(>=, <=), orderBy(desc) y limit, y cuenta cada consulta ──
function crearDb(docs) {
  const log = [];
  // Inmutable como el SDK real: cada where/orderBy/limit devuelve una consulta NUEVA.
  const crear = (q) => ({
    where(campo, op, v) { return crear({ f: q.f.concat([[campo, op, v]]), ord: q.ord, lim: q.lim }); },
    orderBy(campo, dir) { return crear({ f: q.f, ord: [campo, dir], lim: q.lim }); },
    limit(n) { return crear({ f: q.f, ord: q.ord, lim: n }); },
    async get() {
      log.push({ filtros: q.f.slice(), orden: q.ord, limite: q.lim });
      let r = docs.filter(d => q.f.every(([c, op, v]) => d[c] !== undefined && (op === '>=' ? d[c] >= v : d[c] <= v)));
      if (q.ord) r.sort((a, b) => q.ord[1] === 'desc' ? String(b[q.ord[0]]).localeCompare(String(a[q.ord[0]])) : String(a[q.ord[0]]).localeCompare(String(b[q.ord[0]])));
      if (q.lim) r = r.slice(0, q.lim);
      return { docs: r.map(d => ({ data: () => d })) };
    }
  });
  const db = { collection() { return crear({ f: [], ord: null, lim: null }); } };
  return { db, log };
}

const ctx = { console, Math, Date, String, Number, Array, Object, JSON, isFinite, parseInt, parseFloat, Promise, Set, RegExp,
  window: {}, navigator: { onLine: true }, document: { getElementById: () => null }, hasPermission: () => true,
  escapeHtml: (x) => String(x), _dineroMX: (n) => '$' + Number(n).toFixed(2), _fechaLarga: (x) => x,
  compras: [], movimientos: [], products: [], _db: null, XLSX: undefined };
vm.createContext(ctx);
vm.runInContext(leer('js/15-ciclo-semanal.js'), ctx);
vm.runInContext(leer('js/88-compras.js'), ctx);
const call = (nombre, ...a) => vm.runInContext(nombre, ctx)(...a);
const set = (code) => vm.runInContext(code, ctx);

const mk = (id, ing, prov, nl, imp, extra) => Object.assign({ compraId: id, fecha: ing, fechaIngreso: ing, proveedorNombre: prov,
  lineas: Array.from({ length: nl }, (_, i) => ({ productoId: 'P' + i, cantidadInventario: 1, importe: imp / nl })), importe: imp }, extra || {});
const L = [
  mk('a', '2026-10-31', 'ALFA', 2, 100), mk('b', '2026-11-01', 'ALFA', 3, 300), mk('c', '2026-11-02', 'BETA', 1, 50),
  mk('d', '2026-11-05', 'BETA', 4, 400), mk('e', '2026-11-03', 'GAMA', 2, 999, { cancelada: true }),
  { compraId: 'f', fecha: '2026-11-02', proveedorNombre: 'ALFA', lineas: [{}], importe: 10 },          // legado: sin fechaIngreso → cuenta su fecha SAP
  { compraId: 'g', proveedorNombre: 'ALFA', lineas: [], importe: 5 }                                      // sin fecha: no se puede ubicar
];
const ids = (x) => x.map(c => c.compraId).sort().join('');

// ── Rango (capa de datos) ──
chk('★ Rango con ambos extremos INCLUIDOS: 01/11 → 02/11 = b, c, f', ids(call('comprasEnRango', L, '2026-11-01', '2026-11-02')) === 'bcf', ids(call('comprasEnRango', L, '2026-11-01', '2026-11-02')));
chk('Un solo día (desde = hasta)', ids(call('comprasEnRango', L, '2026-11-05', '2026-11-05')) === 'd');
chk('Solo «desde» deja el final abierto; solo «hasta» deja el inicio abierto', ids(call('comprasEnRango', L, '2026-11-03', '')) === 'de' && ids(call('comprasEnRango', L, '', '2026-10-31')) === 'a');
chk('★ Con rango activo, una entrada sin fecha no entra (no se puede ubicar); sin rango entran todas', !ids(call('comprasEnRango', L, '2026-01-01', '2026-12-31')).includes('g') && call('comprasEnRango', L, '', '').length === 7);
chk('Un extremo inválido se ignora (queda abierto), nunca rompe', ids(call('comprasEnRango', L, 'basura', '2026-10-31')) === 'a');
chk('★ Una entrada LEGADA (sin fechaIngreso) se ubica por la fecha del documento SAP', ids(call('comprasEnRango', L, '2026-11-02', '2026-11-02')) === 'cf');

// ── Resumen: entradas, proveedores, total, líneas — sobre la lista pedida ──
const rr = call('_resumenCompras', call('comprasEnRango', L, '2026-10-31', '2026-11-05'));
chk('★ Resumen del rango: 5 entradas activas, 2 proveedores sin contar la cancelada… (ALFA, BETA)', rr.documentos === 5 && rr.proveedores === 2 && rr.canceladas === 1, JSON.stringify(rr));
chk('★ Total = suma de importes activos (100+300+50+400+10) y líneas = 2+3+1+4+1', rr.importe === 860 && rr.lineas === 11, JSON.stringify(rr));
chk('Sin argumento, _resumenCompras sigue usando `compras` (compatibilidad)', (set('compras = [' + JSON.stringify(L[0]) + ']'), call('_resumenCompras').documentos === 1));

// ── Combinación local + consultado: gana lo local ──
set('compras = []; _comprasFiltroDesde = "2026-11-01"; _comprasFiltroHasta = "2026-11-02"; _comprasFiltroProveedor = "";');
set('_comprasRangoCache = { clave: _comprasClaveRango(), items: ' + JSON.stringify([L[1], L[2]]) + ', estado: "ok", truncado: false, motivo: "" };');
set('compras = [' + JSON.stringify(Object.assign({}, L[1], { cancelada: true })) + ']');
const base = call('_comprasListaBase');
chk('★ La base del rango une lo local y lo consultado, y la versión LOCAL gana (cancelación hecha aquí)', ids(base) === 'bc' && base.find(c => c.compraId === 'b').cancelada === true);
set('_comprasRangoCache = { clave: "otra|clave", items: ' + JSON.stringify([L[3]]) + ', estado: "ok", truncado: false, motivo: "" };');
chk('Una caché de OTRO rango no se mezcla', ids(call('_comprasListaBase')) === 'b');

// ── Consulta acotada al servidor ──
(async () => {
  const servidor = [].concat(L.slice(0, 6), Array.from({ length: 3 }, (_, i) => mk('z' + i, '2026-09-1' + i, 'VIEJO', 1, 10)));
  let { db, log } = crearDb(servidor);
  ctx._db = db; ctx.navigator.onLine = true;
  let r = await call('comprasConsultarRango', '2026-09-10', '2026-09-12');
  chk('★ Consulta un rango VIEJO (que la app no tiene cargado) y devuelve esas entradas', r.completo === true && ids(r.items) === 'z0z1z2', ids(r.items));
  chk('★ Dos consultas de UN solo campo (fechaIngreso y fecha), ordenadas desc y con tope (sin índice compuesto)',
    log.length === 2 && log.map(q => q.filtros.map(f => f[0]).filter((v, i, a) => a.indexOf(v) === i).join()).sort().join('|') === 'fecha|fechaIngreso'
    && log.every(q => q.orden && q.orden[1] === 'desc' && q.limite === 500 && q.filtros.length === 2), JSON.stringify(log));
  r = await call('comprasConsultarRango', '2026-11-02', '');
  chk('Con solo «desde» la consulta lleva un único filtro por campo', r.completo && log.slice(2).every(q => q.filtros.length === 1 && q.filtros[0][1] === '>='));
  ({ db, log } = crearDb([mk('w', '2026-11-20', 'ALFA', 1, 1, { fecha: '2026-11-02' }), mk('v', '2026-11-02', 'ALFA', 1, 1)]));
  ctx._db = db; r = await call('comprasConsultarRango', '2026-11-01', '2026-11-03');
  chk('★ Una entrada con fechaIngreso FUERA del rango, aunque su fecha SAP caiga dentro, NO se cuenta (solo «v»)', ids(r.items) === 'v', ids(r.items));
  // tope
  const muchas = Array.from({ length: 700 }, (_, i) => mk('m' + i, '2026-08-01', 'P', 1, 1));
  ({ db, log } = crearDb(muchas)); ctx._db = db;
  r = await call('comprasConsultarRango', '2026-08-01', '2026-08-01');
  chk('★ Con más de 500 resultados avisa «truncado» (no presenta el total como completo)', r.truncado === true && r.items.length === 500 && r.completo === true);
  // sin conexión / error / permiso
  ctx.navigator.onLine = false;
  r = await call('comprasConsultarRango', '2026-08-01', '2026-08-01');
  chk('★ Sin conexión: no inventa datos, devuelve completo=false con motivo', r.completo === false && r.motivo === 'sin_conexion' && r.items.length === 0);
  ctx.navigator.onLine = true; ctx._db = { collection() { const a = { where: () => a, orderBy: () => a, limit: () => a, get: async () => { const e = new Error('x'); e.code = 'permission-denied'; throw e; } }; return a; } };
  r = await call('comprasConsultarRango', '2026-08-01', '2026-08-01');
  chk('Servidor que rechaza: completo=false, motivo permiso_denegado (no se traga el error)', r.completo === false && r.motivo === 'permiso_denegado');
  ctx.hasPermission = () => false;
  r = await call('comprasConsultarRango', '2026-08-01', '2026-08-01');
  chk('Sin purchases.read ni siquiera consulta', r.completo === false && r.motivo === 'sin_permiso');
  ctx.hasPermission = () => true;

  // ── Rango al revés ──
  ctx._db = crearDb([]).db; set('_comprasFiltroDesde = ""; _comprasFiltroHasta = "";');
  await call('comprasCambiarRango', 'hasta', '2026-11-02');
  await call('comprasCambiarRango', 'desde', '2026-11-05');
  chk('★ Si «desde» pasa de «hasta», «hasta» se alinea (nunca un rango al revés)', set('_comprasFiltroDesde') === '2026-11-05' && set('_comprasFiltroHasta') === '2026-11-05');
  await call('comprasCambiarRango', 'hasta', '2026-11-01');
  chk('…y al revés: «hasta» antes de «desde» mueve «desde»', set('_comprasFiltroDesde') === '2026-11-01' && set('_comprasFiltroHasta') === '2026-11-01');
  await call('comprasLimpiarRango');
  chk('Quitar fechas limpia el rango y la caché', !set('comprasRangoActivo()') && set('_comprasRangoCache.estado') === 'ninguno');

  // ── Estático: botón, permiso y solo lectura ──
  const s88 = leer('js/88-compras.js');
  const bloque = s88.slice(s88.indexOf('v5.41 — RANGO DE FECHAS'), s88.indexOf('IDENTIDAD E IDEMPOTENCIA'));
  chk('★ El rango SOLO LEE: ninguna escritura a Firestore, a `compras`/`movimientos` ni al dispositivo', !/\.set\(|\.update\(|\.add\(|\.delete\(|batch\(|saveToLocalStorage|syncToCloud|localStorage|_agregarCompraLocal|compras\.push|movimientos\.push/.test(bloque.replace(/\/\/.*$/gm, '')));
  chk('★ «Importar Excel» solo con purchases.import y llama al flujo de siempre (mismo input y permiso)', /hasPermission\('purchases\.import'\)\) \{\s*html \+= '<button[^']*onclick="comprasImportarExcel\(\)"/.test(s88) && /function comprasImportarExcel\(\) \{\s*if \(!hasPermission\('purchases\.import'\)\)/.test(s88));
  chk('Las reglas de Firestore no cambiaron (el rango usa el permiso de lectura existente)', /match \/compras\/\{compraId\} \{\s*allow read:\s+if hasPerm\('purchases\.read'\);/.test(leer('firestore.rules')));
  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── v5.41 · Compras: rango de fechas e Importar Excel ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const f = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - f) + ' pasaron · ' + f + ' fallaron\n');
  process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
