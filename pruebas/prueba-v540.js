// v5.40 — Control de negativos (capa pura), regla de ceros y garantías estáticas del Recetario.
//   node pruebas/prueba-v540.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const ctx = { console, Math, Date, String, Number, Array, Object, JSON, isFinite, window: {} };
vm.createContext(ctx); vm.runInContext(require('./_precio-producto'), ctx); vm.runInContext(leer('js/94-control-negativos.js'), ctx);
const calc = (e) => vm.runInContext('controlNegativosCalcular', ctx)(e);
const P = [{ id: 'A', name: 'TEQUILA', precio: 300 }, { id: 'B', name: 'LIMON', precio: 10 }, { id: 'C', name: 'RON', precio: 200 }, { id: 'D', name: 'SIN MOV' }, { id: 'E', name: 'HIELO' }];
const T = { A: -0.8, B: 20, C: -1.5, D: 5, E: 30 }, INI = { A: 1, B: 50, E: 30 };
const r = calc({ productos: P, totalDe: p => T[p.id], inicialDe: p => INI[p.id] || 0, dias: ['2026-11-04', '2026-11-05'],
  comprasPorDia: { A: { '2026-11-05': 0 } }, consumoPorDia: { A: { '2026-11-04': 1.8 }, B: { '2026-11-04': 30 }, C: { '2026-11-04': 1.5 }, E: { '2026-11-04': 3 } }, diasConVenta: 1 });
const f = (id) => r.filas.find(x => x.id === id);
chk('★ Negativos primero, el mayor pendiente arriba: RON (1.5) y luego TEQUILA (0.8)', r.filas[0].id === 'C' && r.filas[1].id === 'A' && f('A').estado === 'negativo');
chk('★ «Negativo desde» = el primer día que cruzó por debajo de cero', f('A').desde === '2026-11-04' && f('C').desde === '2026-11-04');
chk('Pendiente y valor al precio del catálogo (0.8 × 300 = 240; 1.5 × 200 = 300)', f('A').pendiente === 0.8 && f('A').valor === 240 && f('C').valor === 300);
chk('★ «No alcanza»: 20 en stock con 30 de consumo diario', f('B').estado === 'no_alcanza' && f('B').promedio === 30);
chk('«Alcanza n días»: 30 en stock con 3 diarios = 10 días → Alcanza (≥ 7)', f('E').estado === 'alcanza' && f('E').dias === 10);
chk('Un producto sin consumo ni negativo no aparece', !f('D'));
chk('Resumen: 2 negativos, 1 no alcanza, $540 pendientes', r.resumen.negativos === 2 && r.resumen.noAlcanza === 1 && r.resumen.valorPendiente === 540);
const r2 = calc({ productos: [{ id: 'X', name: 'X' }], totalDe: () => 1, inicialDe: () => 2, dias: ['d1', 'd2', 'd3'],
  comprasPorDia: { X: { d2: 3 } }, consumoPorDia: { X: { d1: 3, d3: 1 } }, diasConVenta: 2 });
chk('Si se recupera (llega la compra) ya no es negativo; con 1 de stock y 2 diarios «No alcanza»', r2.filas[0].estado === 'no_alcanza' && r2.filas[0].desde === null);
const r3 = calc({ productos: [{ id: 'Y', name: 'Y' }], totalDe: () => -2, inicialDe: () => 0, dias: [], comprasPorDia: {}, consumoPorDia: {}, diasConVenta: 0 });
chk('Negativo sin precio: valor null (no se inventa) y se cuenta en sinPrecio', r3.filas[0].valor === null && r3.resumen.sinPrecio === 1);
const s94 = leer('js/94-control-negativos.js');
chk('★ El control de negativos SOLO LEE (sin escribir en Firestore, catálogo ni dispositivo)', !/\.set\(|\.update\(|\.add\(|batch\(|saveToLocalStorage|syncToCloud|localStorage|products\s*=[^=]|recetas\s*=[^=]/.test(s94.replace(/\/\/.*$/gm, '')));
// Regla de ceros (estático)
const s47 = leer('js/47-existencia.js'), s49 = leer('js/49-fisico-vs-sistema.js');
chk('★ Existencia: con corte vigente, un producto sin línea vale 0 + compras − ventas', /if \(hayAncla && !hay\) \{[\s\S]{0,200}valor: _existenciaRedondear\(ent - ven\), origen: 'oficial', inicial: 0/.test(s47));
chk('★ Contabilizar: lo no contado entra en 0 (inicial semanal, mensual, ancla y corte mensual)', ['js/15-ciclo-semanal.js', 'js/46-arrastre.js', 'js/75-auditoria-flujo.js'].every(fi => /if \(p\.contado === false\) \{ noContados\+\+; p = \{ id: p\.id, total: 0, precio: p\.precio \}; \}/.test(leer(fi))) && !/contado === false\) \{ noContados\+\+; return; \}/.test(leer('js/15-ciclo-semanal.js')));
chk('★ Físico vs Sistema: lo no contado = 0 físico (marcado sin_contar), con diferencia y neto', /if \(sinContar\) \{ pendientes\+\+; fisico = 0; \}/.test(s49) && /estado: sinContar \? 'sin_contar' : 'contado'/.test(s49));
// Recetario
const s91 = leer('js/91-recetario.js'), s80 = leer('js/80-buscador.js');
chk('★ Recetario: modos «Receta» e «Insumo» (motor por insumo con nombre y código)', /id: 'porReceta', etiqueta: 'Receta', grupo: 'modo'/.test(s91) && /id: 'porInsumo', etiqueta: 'Insumo', grupo: 'modo'/.test(s91) && /_motorRecetasInsumo = crearMotorBusqueda/.test(s80));
chk('★ Menú ⋮ con Editar / Desactivar·Activar / Eliminar, accesible (aria-haspopup, role=menu)', /aria-haspopup="menu"/.test(s91) && /role="menu"/.test(s91) && /data-rec-accion="editar"/.test(s91) && /data-rec-accion="activar"/.test(s91) && /data-rec-accion="eliminar"/.test(s91));
chk('Las acciones del menú usan las mismas funciones (con su permiso y confirmación)', /if \(acc === 'editar'\) openRecetaModal\(id\);/.test(s91) && /eliminarReceta\(id\)/.test(s91) && /function eliminarReceta\(id\) \{\s*if \(!hasPermission\('recipe\.edit'\)\) return;[\s\S]{0,200}showConfirm/.test(s91));
let mal = 0;
C.forEach(c => { console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '  → ' + c.d)); if (!c.ok) mal++; });
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron\n');
process.exit(mal ? 1 : 0);
