#!/usr/bin/env node
/**
 * prueba-hallazgo11-receta-inactiva.js — v5.26 · hallazgo #11 (consumo de receta inactiva)
 * ═══════════════════════════════════════════════════════════════════════════
 * consumoTeorico() cruzaba ventas con TODAS las recetas que tuvieran PV, sin
 * mirar receta.activa — el mismo campo que ya pinta el badge "Inactiva" en
 * el recetario. Una receta desactivada (un trago descontinuado, o dado de
 * baja por error) seguía descontando inventario si alguna venta todavía
 * traía su PV.
 *
 * El fix excluye las recetas inactivas del índice recetaPorPV: una venta
 * contra su PV cae en la misma rama que "SKU sin receta" (avisos.sinReceta),
 * en vez de seguir calculando un consumo fantasma.
 *
 * Se ejecuta el código REAL de consumoTeorico() (js/48-consumo-teorico.js)
 * en una sandbox, mismo patrón que prueba-consumo-conversion.js.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r/g, '');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

const ctx = { console, escapeHtml: s => String(s == null ? '' : s) };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(leer('js/91-recetario.js'), ctx, { filename: 'js/91-recetario.js' });
vm.runInContext(leer('js/48-consumo-teorico.js'), ctx, { filename: 'js/48-consumo-teorico.js' });

const BOTELLA = { id: 'TEQ', name: 'TEQUILA', unit: 'PZA', conversion: 700 };
ctx.products = [BOTELLA];
ctx.recetas = [
    { id: 'R1', pv: 'PVB1', activa: false, ingredientes: [{ productoId: 'TEQ', cantidad: 45, uom: 'ml' }] },
    { id: 'R2', pv: 'PVB2', activa: true,  ingredientes: [{ productoId: 'TEQ', cantidad: 45, uom: 'ml' }] }
];
ctx.ventas = [
    { sku: 'PVB1', nombre: 'TRAGO DESCONTINUADO', cantidad: 10 },
    { sku: 'PVB2', nombre: 'TRAGO VIGENTE', cantidad: 10 }
];
ctx.ventasSemanaId = 'S1';

const r = vm.runInContext('consumoTeorico()', ctx);
const esperadoActivo = Math.round((10 * 45 / 700) * 1000) / 1000;

chk('★ La receta ACTIVA sigue descontando su consumo normalmente',
    r.consumo.TEQ === esperadoActivo, 'consumo.TEQ = ' + r.consumo.TEQ + ', esperado ' + esperadoActivo);
chk('★ La receta INACTIVA no aporta nada al consumo (el total es solo el de la activa)',
    r.consumo.TEQ === esperadoActivo,
    'si la inactiva también descontara, consumo.TEQ sería el doble: ' + (esperadoActivo * 2));
chk('★ La venta contra el PV de la receta inactiva se reporta como "sin receta" (no se ignora en silencio)',
    r.avisos.sinReceta.length === 1 && r.avisos.sinReceta[0].sku === 'PVB1',
    JSON.stringify(r.avisos.sinReceta));

// Activarla de nuevo debe volver a sumar su consumo (no es un estado permanente).
ctx.recetas[0].activa = true;
ctx.consumoTeoricoInvalidar();
const r2 = vm.runInContext('consumoTeorico()', ctx);
chk('Reactivar la receta vuelve a sumar su consumo (el filtro es dinámico, no se "quema" el PV)',
    r2.consumo.TEQ === esperadoActivo * 2, 'consumo.TEQ = ' + r2.consumo.TEQ);

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Una receta desactivada ya no sigue consumiendo inventario (v5.26, hallazgo #11) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
