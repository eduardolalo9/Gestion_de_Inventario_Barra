#!/usr/bin/env node
/**
 * prueba-recetario2.js — RECETARIO-2 (importador de Excel) · comprobaciones
 * estáticas.
 * ═══════════════════════════════════════════════════════════════════════════
 * Verifica, sobre el código REAL, lo acordado y verificado antes de escribir
 * código — ver claude/recetario2-analisis-2026-09-27.md:
 *
 *   1. Corrección de nomenclatura: receta.nombre es el nombre visible,
 *      receta.pv vuelve a significar lo mismo que product.pv (código único).
 *      Cubierto también en prueba-recetario1.js; aquí solo lo que agrega
 *      Recetario-2 sobre esa base.
 *   2. El importador lee la hoja "Recetas" por NOMBRE (no la primera hoja),
 *      usa las columnas reales (PV, Receta, Categoría, Activa, Código
 *      insumo, Descripción insumo, Cantidad, UoM) y reutiliza
 *      _numeroExcel/_normCabCompras/_findColCompras — no las reimplementa.
 *   3. Agrupación por PV, decisión alta/actualización contra `recetas` en
 *      memoria (por PV, o por nombre solo si es inequívoco).
 *   4. Validación por línea: código+cantidad vacíos → sin incidencia (receta
 *      sin ingredientes); código vacío con cantidad → incidencia, se omite;
 *      cantidad inválida → incidencia, se omite; código no encontrado en
 *      catálogo → SE GUARDA igual (con descripcionExcel), con incidencia —
 *      nunca se descarta el dato.
 *   5. No auto-publica: solo llena `recetas`, sigue haciendo falta
 *      publicarRecetarioFirestore().
 *   6. Integración en la UI: botón "Importar Excel", input de archivo propio
 *      (nunca compartido con #fileInput/#fileInputCompras), listener
 *      cableado, script declarado en el orden correcto, sw.js lo precalienta.
 *
 * No necesita emulador ni red — el motor de costeo y las reglas de Firestore
 * ya se prueban en prueba-recetario1.js y run-rules-tests.js (recetario/recetas
 * no cambia con Recetario-2: sigue siendo el mismo documento único).
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

const importa = leer('js/92-recetario-importar.js');
const nucleo  = leer('js/00-nucleo.js');
const render  = leer('js/70-conversion-render.js');
const html    = leer('index.html');
const arranque = leer('js/99-window-arranque.js');
const sw      = leer('sw.js');

// ═══ 1 · Estado dedicado (mismo patrón que comprasImportView) ══════════════
chk("recetarioImportView / _recetarioImportPendiente / _recetarioImportResultado declarados en js/00-nucleo.js",
    /let recetarioImportView = 'lista'/.test(nucleo) &&
    /let _recetarioImportPendiente = null/.test(nucleo) &&
    /let _recetarioImportResultado = null/.test(nucleo));

// ═══ 2 · Lectura del archivo: hoja "Recetas" por nombre, no la primera ═════
chk('handleFileImportRecetario busca la hoja "Recetas" por nombre (no workbook.SheetNames[0] a ciegas)',
    /_normCabCompras\(n\) === 'recetas'/.test(importa));
chk('El importador reutiliza _numeroExcel/_normCabCompras/_findColCompras de Compras (no los reimplementa)',
    /_numeroExcel\(cruda\.cantidad\)/.test(importa) &&
    /_findColCompras\(fila,/.test(importa) &&
    !/function _numeroExcel\(/.test(importa) &&
    !/function _findColCompras\(/.test(importa));
chk('Las columnas reales del Excel están mapeadas (PV, Receta, Categoría, Activa, Código insumo, Descripción insumo, Cantidad, UoM, Almacén)',
    /pv:\s*\['PV'/.test(importa) && /nombre:\s*\['Receta'/.test(importa) &&
    /categoria:\s*\['Categoría'/.test(importa) && /activa:\s*\['Activa'/.test(importa) &&
    /codigo:\s*\['Código insumo'/.test(importa) && /descripcion:\s*\['Descripción insumo'/.test(importa) &&
    /cantidad:\s*\['Cantidad'/.test(importa) && /uom:\s*\['UoM'/.test(importa) &&
    /almacen:\s*\['Almacén'/.test(importa));

// ═══ 2b · Filtro de alcance por almacén (corrección de FASE 10) ════════════
chk('★ El filtro de almacén usa la MISMA constante que Compras (ALMACEN_BARRA_CODIGO), no un 12 suelto',
    /almacen !== ALMACEN_BARRA_CODIGO/.test(importa) && !/almacen !== '12'/.test(importa));
chk('★ El filtro se aplica por LÍNEA, no por receta — una receta mixta conserva sus líneas de barra',
    /if \(codigoStr\) \{[\s\S]{0,600}?lineasFueraDeAlcance\+\+/.test(importa));
chk('★ Una receta cuyas líneas son TODAS de otro almacén no se importa (cocina/cava)',
    /esDeOtroAlmacen = g\.lineasConCodigo > 0 && g\.ingredientes\.length === 0 && g\.lineasOtroAlmacen === g\.lineasConCodigo/.test(importa));
chk('★ Una receta SIN ninguna línea de ingrediente sí se importa (no hay línea que clasificar — caso TE GOURMET)',
    /g\.lineasConCodigo > 0 &&/.test(importa));
chk('Lo descartado por almacén se informa en bloque en la vista previa, no como cientos de incidencias',
    /recetasOtroAlmacen/.test(importa) && /lineasFueraDeAlcance/.test(importa) &&
    /Fuera de alcance de la barra/.test(importa));

// ═══ 3 · Agrupación por PV y decisión alta/actualización ═══════════════════
chk('_parsearExcelRecetario agrupa por PV (código único), no por nombre',
    /const pv = String\(pvCrudo\)\.trim\(\);/.test(importa) &&
    /if \(!grupos\[pv\]\)/.test(importa));
chk('Fila sin PV se descarta y se cuenta (filasSinPV), nunca se inventa un PV',
    /filasSinPV\+\+/.test(importa));
chk('Coincidencia primero por PV exacto (case-insensitive) contra `recetas` en memoria',
    /r\.pv && String\(r\.pv\)\.toUpperCase\(\) === pv\.toUpperCase\(\)/.test(importa));
chk('★ Coincidencia por nombre SOLO si es inequívoca (exactamente una receta sin pv con ese nombre) — nunca adivina con varias candidatas',
    /candidatas\.length === 1/.test(importa) && /!r\.pv &&/.test(importa));

// ═══ 4 · Validación por línea — nunca se pierde el dato ════════════════════
chk('Código y cantidad vacíos en la misma fila → receta sin ingredientes, sin incidencia (caso real: TE GOURMET)',
    /if \(codigoVacio && cantidadVacia\)/.test(importa) &&
    /return \{ ok: false, vacia: true \};/.test(importa));
chk('Código vacío con cantidad presente → incidencia tipo codigo_vacio, línea omitida',
    /tipo: 'codigo_vacio'/.test(importa));
chk('Cantidad no numérica o ≤ 0 → incidencia tipo cantidad_invalida, línea omitida',
    /tipo: 'cantidad_invalida'/.test(importa) && /cantidad === null \|\| cantidad <= 0/.test(importa));
chk('★ Código que no existe en el catálogo NO se descarta: se guarda con descripcionExcel + incidencia (corrección sobre el análisis inicial)',
    /tipo: 'sin_catalogo'/.test(importa) &&
    /linea: \{ productoId: codigoStr, cantidad: cantidad, uom: uom,/.test(importa) &&
    /descripcionExcel: String\(cruda\.descripcion \|\| ''\)\.trim\(\) \|\| undefined/.test(importa));
// ═══ 4b · Migración del esquema anterior (hotfix 4.14) ═════════════════════
const receta91 = leer('js/91-recetario.js');
chk('★ Existe la migración idempotente pv → nombre para las recetas del esquema anterior',
    /function _migrarRecetasNomenclatura\(lista\)/.test(receta91) &&
    /if \(r\.nombre && String\(r\.nombre\)\.trim\(\)\) return;/.test(receta91) &&
    /r\.nombre = pv;/.test(receta91));
chk('★ La migración solo borra `pv` cuando NO parece un código real (una importada sin nombre conserva el suyo)',
    /function _pareceCodigoPV/.test(receta91) &&
    /if \(!_pareceCodigoPV\(pv\)\) delete r\.pv;/.test(receta91));
chk('La migración se aplica en los TRES puntos de entrada: localStorage, IndexedDB y el documento publicado',
    /_migrarRecetasNomenclatura\(recetas\)/.test(leer('js/40-firestore.js')) &&
    /_migrarRecetasNomenclatura\(recetas\)/.test(leer('js/30-indexeddb.js')) &&
    /_migrarRecetasNomenclatura\(recetas\)/.test(leer('js/50-roles-permisos.js')));
chk('★ El repositorio declara el proyecto de Firebase (.firebaserc), para que `firebase deploy` no falle por falta de proyecto activo',
    /"default":\s*"gestor-de-inventarios-76c19"/.test(leer('.firebaserc')));

chk('costoReceta y la ficha muestran descripcionExcel cuando el producto no existe (no solo el código)',
    /faltantes\.push\(\(producto && producto\.name\) \? producto\.name : \(ing\.descripcionExcel \|\| ing\.productoId/.test(leer('js/91-recetario.js')) &&
    /escapeHtml\(producto \? producto\.name : \(ing\.descripcionExcel \|\| ing\.productoId\)\)/.test(leer('js/91-recetario.js')));

// ═══ 5 · No auto-publica ════════════════════════════════════════════════════
chk('confirmarImportacionRecetario() NO llama a publicarRecetarioFirestore — sigue siendo un paso aparte',
    /function confirmarImportacionRecetario/.test(importa) &&
    !/function confirmarImportacionRecetario[\s\S]{0,1500}?publicarRecetarioFirestore\(\)/.test(importa));
chk('confirmarImportacionRecetario() llama a saveToLocalStorage() y toma un respaldo antes de aplicar',
    /_crearBackupNombrado\('pre_importacion_recetario_'/.test(importa) &&
    /saveToLocalStorage\(\);/.test(importa));

// ═══ 6 · Integración en la UI ═══════════════════════════════════════════════
chk('renderRecetarioTab() enruta a la vista previa / incidencias de importación antes que lista/ficha',
    /recetarioImportView === 'vista_previa' && _recetarioImportPendiente/.test(leer('js/91-recetario.js')));
// v5.18 (decisión de Eduardo, 6-oct-2026): importar el recetario se hace SOLO
// desde el módulo "Importar desde Excel" (js/96-importar.js), que llama a este
// mismo importador. El encabezado conserva "Nueva receta" / "Publicar recetario".
chk('v5.18 · importar el recetario vive en el módulo Importar (y usa este mismo importador)',
    !/activeTab === 'recetario'[\s\S]{0,1500}?recetarioImportarExcel\(\)/.test(render) &&
    /recetarioImportarExcel\(\)/.test(fs.readFileSync(path.join(RAIZ, 'js/96-importar.js'), 'utf8')));
chk('index.html declara #fileInputRecetario, propio y nunca compartido con #fileInput/#fileInputCompras',
    /id="fileInputRecetario"/.test(html) &&
    !/id="fileInput"[^>]*recetario/i.test(html));
chk('js/99-window-arranque.js cablea el listener de #fileInputRecetario a handleFileImportRecetario',
    /getElementById\('fileInputRecetario'\)/.test(arranque) &&
    /handleFileImportRecetario\(e\)/.test(arranque));
chk('index.html carga js/92-recetario-importar.js justo después de 91-recetario.js (necesita sus funciones)',
    /91-recetario\.js\?v=[\d.]+"><\/script>\s*<script src="js\/92-recetario-importar\.js\?v=[\d.]+"><\/script>/.test(html));
chk('sw.js precalienta js/92-recetario-importar.js',
    /'\.\/js\/92-recetario-importar\.js\?v=' \+ APP_VERSION/.test(sw));

// ═══ Resultado ═══════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(function(c) { return c.nombre.length; }));
console.log('\n  ── RECETARIO-2 (estática) ──\n');
casos.forEach(function(c) {
    console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
                (c.ok ? '' : '   ← ' + c.detalle));
});
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) +
            ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
