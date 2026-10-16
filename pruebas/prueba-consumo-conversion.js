#!/usr/bin/env node
/**
 * prueba-consumo-conversion.js — v5.26 · hallazgo #2 (aprobado por Eduardo, 11-oct-2026)
 * ═══════════════════════════════════════════════════════════════════════════
 * consumoTeorico() debe convertir ml/oz a la unidad del insumo, igual que ya
 * hacía costoLineaReceta(). Se ejecuta el código real (js/91 + js/48) en una
 * sandbox, con datos sintéticos, para comprobar el NÚMERO, no solo el texto
 * fuente — una regresión aquí movería el stock teórico sin que nada avise.
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

// Botella de tequila: 700 ml, se cuenta en PZA (botellas).
const BOTELLA = { id: 'TEQ', name: 'TEQUILA', unit: 'PZA', conversion: 700 };
// Aceituna: se cuenta en KGS, sin conversion/capacidadMl. "rebanada" no es
// ml/oz, no coincide con KGS y no está en la lista de unidades de stock
// conocidas (pza/kg/lt/unidad…): es el caso real de "no se puede convertir".
const ACEITUNA = { id: 'ACE', name: 'ACEITUNA', unit: 'KGS' };

ctx.products = [BOTELLA, ACEITUNA];
ctx.recetas = [
    { id: 'R1', pv: 'PVB1', activa: true, ingredientes: [
        { productoId: 'TEQ', cantidad: 45, uom: 'ml' },         // 45 ml de una botella de 700 ml
        { productoId: 'ACE', cantidad: 2, uom: 'rebanada' }      // UoM no interpretable para un insumo en KGS
    ] }
];
ctx.ventas = [{ sku: 'PVB1', nombre: 'MARGARITA', cantidad: 10 }]; // se vendieron 10
ctx.ventasSemanaId = 'S1';

const r = vm.runInContext('consumoTeorico()', ctx);

// 10 ventas × 45 ml ÷ 700 ml/botella = 0.642857… botellas (antes: 450 "piezas", 700× más).
const esperadoTeq = Math.round((10 * 45 / 700) * 1000) / 1000;
chk('★ 45 ml de una botella de 700 ml descuentan botellas, no "45 piezas" (antes: ' + (10 * 45) + ')',
    r.consumo.TEQ === esperadoTeq, 'consumo.TEQ = ' + r.consumo.TEQ + ', esperado ' + esperadoTeq);
chk('El factor de conversión es el mismo que usa el costeo (factorAUnidadProducto)',
    Math.abs(r.consumo.TEQ - 10 * 45 * ctx.factorAUnidadProducto('ml', BOTELLA)) < 0.001);

// La UoM "pza" para un insumo sin conversion/capacidadMl no se puede convertir:
// se usa tal cual (como antes) Y se avisa — eso sí cambió respecto al bug viejo,
// que trataba ese caso como factor 1 sin avisar cuando coincidía por casualidad.
chk('★ Una UoM no interpretable se usa tal cual (no inventa una conversión)',
    r.consumo.ACE === 10 * 2, 'consumo.ACE = ' + r.consumo.ACE);
chk('★ Y se reporta en avisos.uomDistinta (antes solo avisaba si el factor daba 1 Y no coincidía)',
    r.avisos.uomDistinta.length === 1 && r.avisos.uomDistinta[0].productoId === 'ACE');

// Receta sin PV (hallazgo #1): la venta nunca la encuentra.
ctx.recetas.push({ id: 'R2', pv: '', activa: true, ingredientes: [{ productoId: 'TEQ', cantidad: 30, uom: 'ml' }] });
ctx.consumoTeoricoInvalidar();
const r2 = vm.runInContext('consumoTeorico()', ctx);
chk('Una receta sin PV sigue sin recibir consumo (la corrige el campo PV del modal, no este motor)',
    r2.consumo.TEQ === esperadoTeq, 'sin cambio esperado: ' + r2.consumo.TEQ);

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Conversión de unidades en el consumo teórico (v5.26, hallazgo #2) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
