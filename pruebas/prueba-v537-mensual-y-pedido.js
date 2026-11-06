// v5.37 — (A) el inventario MENSUAL cierra la semana; (B) exportar el pedido sugerido a Excel.
//   node pruebas/prueba-v537-mensual-y-pedido.js
// Capa pura (js/15, js/46, js/73) + garantías estáticas (js/47, js/75, firestore.rules).
// La prueba en navegador (contabilizar con Firestore simulado y descarga real) es prueba-v537-navegador.js.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const ctx = { console, Math, Date, String, Number, Array, Object, JSON, isFinite, parseFloat, window: {} };
vm.createContext(ctx);
vm.runInContext(leer('js/15-ciclo-semanal.js'), ctx);
vm.runInContext(leer('js/46-arrastre.js'), ctx);
const r = (code) => vm.runInContext(code, ctx);

// ── A · pura ──
const m = r(`inicialDesdeCierreMensual({ fecha: '2026-10-31', inventoryId: 'INV-M', numero: 50,
  productos: [{ id: 'A', total: 4.00049 }, { id: 'B', total: 0 }, { id: 'C', total: 9, contado: false }] })`);
chk('★ Mensual del sábado 31-oct → inicial de la semana 2026-11-02 con fechaAncla 2026-10-31', m && m.semanaId === '2026-11-02' && m.fechaAncla === '2026-10-31', JSON.stringify(m));
chk('Origen trazable: tipo cierre_mensual, inventario, número, semana cerrada', m.origen.tipo === 'cierre_mensual' && m.origen.inventoryId === 'INV-M' && m.origen.numero === 50 && m.origen.semanaCerrada === '2026-10-26');
// v5.40 — regla de Eduardo: lo que nadie contó entra en 0.
chk('★ Mismo criterio que el domingo: «nadie lo contó» entra en 0 (v5.40); cero contado también; 3 decimales', m.saldos.A === 4 && m.saldos.B === 0 && m.saldos.C === 0 && m.productosNoContados === 1, JSON.stringify(m.saldos));
chk('Un domingo-fin-de-mes NO usa esta vía (lo resuelve inicialDesdeCierre)', r(`inicialDesdeCierreMensual({ fecha: '2026-05-31', productos: [] })`) === null);
chk('Un día que no es fin de mes NO cierra la semana', r(`inicialDesdeCierreMensual({ fecha: '2026-10-28', productos: [] })`) === null);
chk('inicialDesdeCierre (domingo) no cambió: un fin de mes entre semana sigue sin arrastrar por esa vía', r(`inicialDesdeCierre({ fecha: '2026-10-31', productos: [] })`) === null);
chk('★ Fecha del conteo de un inicial normal = el domingo anterior', r(`fechaConteoDeInicial('2026-11-02', {})`) === '2026-11-01');
chk('★ Fecha del conteo de un inicial del mensual = fechaAncla', r(`fechaConteoDeInicial('2026-11-02', { fechaAncla: '2026-10-31' })`) === '2026-10-31');
chk('Una fechaAncla inválida o de otra semana se IGNORA (se usa el domingo)',
    r(`fechaConteoDeInicial('2026-11-02', { fechaAncla: '2026-10-20' })`) === '2026-11-01' && r(`fechaConteoDeInicial('2026-11-02', { fechaAncla: 'basura' })`) === '2026-11-01'
    && r(`fechaConteoDeInicial('2026-11-02', { fechaAncla: '2026-11-03' })`) === '2026-11-01');
chk('anclaDesdeCierre acepta «cierre_semanal» y sigue rechazando tipos desconocidos', r(`anclaDesdeCierre({ fecha: '2026-11-01', productos: [{ id: 'A', total: 3 }] }, 'cierre_semanal')`).tipo === 'cierre_semanal'
    && r(`anclaDesdeCierre({ fecha: '2026-11-01', productos: [] }, 'otro')`) === null);
chk('Etiqueta legible del corte del domingo', /Cierre del domingo/.test(r(`anclaEtiqueta({ tipo: 'cierre_semanal', fecha: '2026-11-01' })`)));

// ── A · estático ──
const s47 = leer('js/47-existencia.js'), s75 = leer('js/75-auditoria-flujo.js'), reglas = leer('firestore.rules');
chk('★ El motor del Total usa la fecha del conteo del inicial (fechaConteoDeInicial)', /fecha: \(typeof fechaConteoDeInicial === 'function'\) \? fechaConteoDeInicial\(doc\.id, d\)/.test(s47));
chk('★ «¿Hay un corte más nuevo?» compara con la fecha real del conteo del inicial', /fechaConteoDeInicial\(d\.id, d\.data\(\) \|\| \{\}\)[\s\S]{0,40}if \(!fe \|\| fe > fecha\)/.test(s75));
chk('evaluarContabilizable: el mensual entre semana cierra la semana', /const semanalDesdeMensual = !clase\.cierraSemana && !!clase\.esCorteMensual;/.test(s75) && /const haceSemanal = !!clase\.cierraSemana \|\| semanalDesdeMensual;/.test(s75));
chk('★ El inicial del mensual guarda fechaAncla; uno normal no', /if \(inicial\.fechaAncla\) docInicial\.fechaAncla = inicial\.fechaAncla;/.test(s75));
chk('★ Si el domingo ya cerró la semana, el mensual no la pisa (sin sobrescribir nada)', /if \(ev\.semanalDesdeMensual\) \{[\s\S]{0,300}haceSemanal = false;/.test(s75));
chk('★ Domingo con la semana cerrada por el mensual → ancla cierre_semanal (con comprobación de corte más nuevo)', /origPrev\.tipo === 'cierre_mensual'[\s\S]{0,700}_anclaPosteriorA\(fd\)[\s\S]{0,900}anclaTipo   = 'cierre_semanal';/.test(s75));
chk('Sin poder leer el inicial existente no se contabiliza a ciegas', /if \(haceSemanal && previoSemana\.error\) \{[\s\S]{0,200}return;/.test(s75));
const contab = s75.slice(s75.indexOf('async function contabilizarInventario('), s75.indexOf('async function contabilizarInventario(') + 40000);
chk('Contabilizar sigue siendo UN solo batch', (contab.slice(0, contab.indexOf('\n        }\n')).match(/const batch = _db\.batch\(\);/g) || []).length === 1);
chk('★ Reglas: anclasExistencia acepta tipo cierre_semanal con id = fecha; inmutable salvo el importado', /d\.tipo in \['fin_de_mes', 'mitad_de_semana', 'cierre_semanal'\]/.test(reglas) && /tipo in \['fin_de_mes', 'mitad_de_semana', 'cierre_semanal', 'importacion_excel'\]/.test(reglas));
chk('Reglas: inventariosIniciales sigue create-only (sin update ni delete)', /match \/inventariosIniciales\/\{semanaId\} \{[\s\S]{0,400}allow update, delete: if false;/.test(reglas));

// ── B · pedido sugerido ──
const c73 = { console, Math, Date, String, Number, Array, Object, JSON, isFinite, parseFloat, window: {}, document: undefined,
  pedidoSugeridoProducto: (p) => p._sug, existenciaMostrada: (p) => p._st };
vm.createContext(c73); vm.runInContext(leer('js/73-pedido-sugerido.js'), c73);
c73._prods = [
  { id: 'A', name: 'TEQUILA', group: 'TEQUILA', unit: 'Bot', precio: 100, stockMinimo: 10, _sug: 8, _st: 2 },
  { id: 'B', name: 'RON', group: 'RON', stockMinimo: 5, _sug: 4, _st: 1 },
  { id: '0012', name: 'MEZCAL', group: 'TEQUILA', precio: 300, stockMinimo: 2, _sug: 0, _st: 9 },
  { id: 'D', name: 'SIN MINIMO', group: 'X', _sug: 3, _st: 0 }];
const ex = vm.runInContext(`pedidoSugeridoExportFilas(pedidoSugeridoFilas(_prods, { soloBajo: true }), function(f) { return f.id === 'B' ? 7 : f.sugerido; })`, c73);
chk('★ Exporta SOLO los productos con pedido sugerido > 0 (con mínimo definido)', ex.map(f => f.id).join(',') === 'B,A', ex.map(f => f.id).join(','));
chk('Ordenado por grupo y nombre', ex[0].grupo === 'RON' && ex[1].grupo === 'TEQUILA');
chk('★ Total = cantidad × precio; sin precio → vacío (no 0)', ex[1].total === 800 && ex[0].precio === null && ex[0].total === null && ex[0].cantidad === 7);
chk('Una cantidad inválida cae al sugerido', vm.runInContext(`pedidoSugeridoExportFilas([{ id: 'Z', nombre: 'Z', grupo: 'G', sugerido: 3, precio: 2 }], function() { return NaN; })[0].cantidad`, c73) === 3);
chk('Nombre del archivo con fecha local', vm.runInContext(`pedidoSugeridoExportNombre(new Date(2026, 10, 1))`, c73) === 'Pedido_Sugerido_2026-11-01.xlsx');
const s73 = leer('js/73-pedido-sugerido.js');
const exportar = s73.slice(s73.indexOf('function exportarPedidoSugeridoExcel('), s73.indexOf('function pedidoSugeridoGenerar('));
chk('★ Exportar solo lee: no escribe catálogo, carrito, localStorage ni Firestore', exportar.length > 100 && !/addToCart|saveToLocalStorage|syncToCloud|localStorage|collection\(|\.set\(|\.update\(/.test(exportar));
chk('★ El alcance NO depende del filtro de grupo ni de la búsqueda (soloBajo fijo, sin _ps.grupo)', /pedidoSugeridoFilas\(typeof products !== 'undefined' \? products : \[\], \{ soloBajo: true \}\)/.test(exportar) && !/_ps\.grupo|_ps\.busqueda/.test(exportar));
chk('Botón solo con inventory.export', /_psPuedeExportar\(\) \? '<button type="button" class="mc-pill" id="psExportBtn"/.test(s73) && /hasPermission\('inventory\.export'\)/.test(s73));

let mal = 0;
C.forEach(c => { console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '  → ' + c.d)); if (!c.ok) mal++; });
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron\n');
process.exit(mal ? 1 : 0);
