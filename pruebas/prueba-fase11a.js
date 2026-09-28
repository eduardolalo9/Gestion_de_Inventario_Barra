#!/usr/bin/env node
/**
 * prueba-fase11a.js — FASE 11A (consumo teórico) · comprobaciones estáticas.
 * ═══════════════════════════════════════════════════════════════════════════
 * Ver claude/fase11-diseno-teorico-2026-09-27.md:
 *
 *   1. Costeo consciente de la unidad: una línea en la unidad del insumo
 *      (PZA/KGS/LTS) se costea como cantidad × precio; una en ml/oz sigue
 *      convirtiéndose con la conversión; lo que no se sabe interpretar deja
 *      la receta "incompleta" (nunca se adivina un factor).
 *   2. Motor de consumo teórico: cruce recetario × ventas SIN convertir
 *      unidades (igual que el Excel), con avisos por SKU vendido sin receta,
 *      insumo fuera de catálogo y UoM distinta.
 *   3. El hueco que FASE 8 reservó queda relleno, con la guarda de semana.
 *   4. La fuente oficial sigue APAGADA (decisión del propietario).
 *   5. Integración: archivo declarado en orden, precacheado, y pantalla de
 *      verificación en la pestaña Ventas.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok: !!ok, detalle: detalle || '' });
    if (!ok) fallos++;
}
function leer(rel) { return fs.readFileSync(path.join(RAIZ, rel), 'utf8'); }

const receta    = leer('js/91-recetario.js');
const consumo   = leer('js/48-consumo-teorico.js');
const existencia= leer('js/47-existencia.js');
const ventasJs  = leer('js/93-ventas.js');
const recImport = leer('js/92-recetario-importar.js');
const html      = leer('index.html');
const sw        = leer('sw.js');

// ═══ 1 · Costeo consciente de la unidad ════════════════════════════════════
chk('★ Existe factorAUnidadProducto(): cuántas unidades de inventario vale 1 UoM',
    /function factorAUnidadProducto\(uom, producto\)/.test(receta));
chk('★ Una UoM de stock (PZA/KGS/LTS…) vale 1 — la cantidad ya está en unidades del insumo',
    /_UOM_DE_STOCK/.test(receta) && /'pza'/.test(receta) && /'kgs'/.test(receta) && /'lts'/.test(receta) &&
    /if \(_UOM_DE_STOCK\.indexOf\(u\) !== -1\) return 1;/.test(receta));
chk('Una UoM igual a la unidad del producto también vale 1',
    /_normUom\(producto\.unit\) === u\) return 1;/.test(receta));
chk('ml y oz siguen convirtiéndose con la conversión del catálogo (caso de la receta tecleada a mano)',
    /u === 'ml'[\s\S]{0,80}?return 1 \/ conv;/.test(receta) && /_ML_POR_OZ \/ conv/.test(receta));
chk('★ Una UoM que no se sabe interpretar devuelve null — nunca se inventa un factor',
    /return null;\s*\/\/ unidad que no sabemos interpretar/.test(receta));
chk('costoLineaReceta usa cantidad × factor × precio',
    /return cant \* factor \* producto\.precio;/.test(receta));
chk('★ costoReceta ya NO multiplica por costoPorUnidadBase (que asumía mililitros)',
    /costoLineaReceta\(ing, producto\)/.test(receta) &&
    !/total \+= cu \* \(typeof ing\.cantidad/.test(receta));
chk('La ficha muestra el costo por línea con el mismo cálculo corregido',
    /costoLinea === null \? '<span style="color:#d97706;">sin costo<\/span>' : \('\$' \+ costoLinea\.toFixed\(2\)\)/.test(receta));

// ═══ 2 · Motor de consumo teórico ══════════════════════════════════════════
chk('El motor vive en su propia capa (js/48-consumo-teorico.js) y no pinta nada',
    /function consumoTeorico\(\)/.test(consumo) &&
    !/document\.getElementById/.test(consumo) && !/innerHTML/.test(consumo));
chk('★ El cruce es el del Excel: unidades vendidas × cantidad de la receta, SIN convertir unidades',
    /resultado\.consumo\[pid\] = \(resultado\.consumo\[pid\] \|\| 0\) \+ unidades \* cant;/.test(consumo));
chk('Agrupa las recetas por su código pv (case-insensitive), no por nombre',
    /recetaPorPV\[String\(r\.pv\)\.trim\(\)\.toUpperCase\(\)\]/.test(consumo));
chk('★ Un SKU vendido SIN receta se reporta, nunca se estima su consumo',
    /avisos\.sinReceta\.push/.test(consumo) && /if \(!receta\) \{/.test(consumo));
chk('Un insumo de receta fuera del catálogo se reporta',
    /avisos\.sinCatalogo\.push/.test(consumo));
chk('Una UoM de receta distinta a la del insumo se reporta (65 líneas reales del Excel)',
    /avisos\.uomDistinta\.push/.test(consumo));
chk('El resultado trae su procedencia (semana, líneas aplicadas, SKU vendidos), no un mapa suelto',
    /semana: semana,/.test(consumo) && /lineasCalculadas/.test(consumo) && /skusVendidos/.test(consumo));
chk('El cruce está memorizado por semana + tamaño de listas, y se puede invalidar',
    /_consumoMemo/.test(consumo) && /function consumoTeoricoInvalidar/.test(consumo));
chk('Importar ventas o recetario invalida el cruce memorizado',
    /consumoTeoricoInvalidar\(\)/.test(ventasJs) && /consumoTeoricoInvalidar\(\)/.test(recImport));

// ═══ 3 · El hueco de FASE 8, relleno con guarda de semana ══════════════════
chk('★ existenciaVentasSemana() ya no devuelve {} fijo: pregunta al motor',
    /function existenciaVentasSemana\(\)[\s\S]{0,400}?consumoTeorico\(\)/.test(existencia) &&
    !/function existenciaVentasSemana\(\) \{\s*return \{\};\s*\}/.test(existencia));
chk('★ Si las ventas cargadas son de OTRA semana, NO se restan (devuelve {})',
    /if \(!r \|\| !r\.semana \|\| r\.semana !== sem\) return \{\};/.test(existencia));
chk('Si el motor todavía no cargó, se comporta como antes de FASE 11A (no revienta)',
    /if \(typeof consumoTeorico !== 'function'\) return \{\};/.test(existencia));

// ═══ 4 · La fuente oficial sigue apagada ═══════════════════════════════════
chk('★ EXISTENCIA_FUENTE_OFICIAL_ACTIVA sigue en false (decisión del propietario: comparar antes de confiar)',
    /var EXISTENCIA_FUENTE_OFICIAL_ACTIVA = false;/.test(existencia));
chk('FASE 11A no calcula desviación ni pedido sugerido (eso es 11B)',
    !/function .*desviacion/i.test(consumo) && !/pedidoSugerido/i.test(consumo));

// ═══ 5 · Integración ═══════════════════════════════════════════════════════
chk('La pestaña Ventas muestra el consumo teórico y sus avisos para poder verificarlo',
    /_renderConsumoTeorico/.test(ventasJs) && /Consumo teórico/.test(ventasJs));
chk('La pantalla avisa de que la app todavía NO decide con esa cifra',
    /todavía NO decide con esta cifra/.test(ventasJs));
chk('index.html carga js/48-consumo-teorico.js justo después de 47-existencia.js',
    /47-existencia\.js\?v=[\d.]+"><\/script>\s*<script src="js\/48-consumo-teorico\.js\?v=[\d.]+"><\/script>/.test(html));
chk('sw.js precalienta js/48-consumo-teorico.js',
    /'\.\/js\/48-consumo-teorico\.js\?v=' \+ APP_VERSION/.test(sw));

// ═══ Resultado ═══════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(function(c) { return c.nombre.length; }));
console.log('\n  ── FASE 11A · consumo teórico (estática) ──\n');
casos.forEach(function(c) {
    console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
                (c.ok ? '' : '   ← ' + c.detalle));
});
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) +
            ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
