#!/usr/bin/env node
/**
 * prueba-r5.js — R5: el catálogo
 * ═══════════════════════════════════════════════════════════════════════════
 * Lo que arregla esta fase, por orden de gravedad:
 *
 *   1. La importación NO actualizaba. Si una fila traía un ID que ya existía,
 *      se le inventaba otro (PRD-NNN) y se creaba un producto clonado.
 *      Reimportar el catálogo de 424 productos generaba 424 más, con los
 *      nombres repetidos y el conteo repartido entre los dos. Ahora el ID
 *      manda: existe → se actualiza; no existe → se da de alta.
 *
 *   2. Importar no comprobaba permisos. La única defensa era no dibujar el
 *      botón, y ocultar un botón no es un permiso.
 *
 *   3. La pestaña mostraba tres columnas de las diez que guarda el catálogo.
 *
 *   4. "hidden md:table-cell" venía de Tailwind, pero estilos.css define
 *      .hidden con display:none !important y no tiene breakpoints md:. Esas
 *      columnas quedaban ocultas SIEMPRE, también en escritorio.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok, detalle: detalle || '' });
    if (!ok) fallos++;
}

const importa = fs.readFileSync(path.join(RAIZ, 'js/90-ciclo-admin.js'), 'utf8');
const render  = fs.readFileSync(path.join(RAIZ, 'js/70-conversion-render.js'), 'utf8');
const css     = fs.readFileSync(path.join(RAIZ, 'css/estilos.css'), 'utf8');

// La pestaña se comprueba aislada: así una coincidencia en otra función no
// puede dar por buena una comprobación de esta.
const iniTab = render.indexOf('function renderProductosTab() {');
const finTab = render.indexOf('function renderPedidosTab() {');
const tab    = (iniTab !== -1 && finTab !== -1) ? render.slice(iniTab, finTab) : '';
chk('renderProductosTab existe y se pudo aislar', tab.length > 500);

// ═══ 1 · Upsert por ID ════════════════════════════════════════════════════
chk('La importación indexa el catálogo por ID antes de empezar',
    /_indicePorId\s*=\s*\{\}/.test(importa) &&
    /products\.forEach\(function\(p, i\) \{ _indicePorId\[String\(p\.id\)\] = i; \}\)/.test(importa));

chk('Ya NO se inventa un ID nuevo cuando el ID del Excel ya existe',
    !/if \(existingIds\.has\(id\) \|\| usedInBatch\.has\(id\)\) \{\s*\n\s*do \{ id = 'PRD-/.test(importa),
    'era la causa de que reimportar duplicara el catálogo entero');

chk('Una fila sin ID sigue recibiendo uno generado',
    /if \(!id\) \{[\s\S]{0,400}?do \{ id = 'PRD-/.test(importa),
    'sin ID no hay forma de saber a qué producto se refiere la fila: es un alta');

chk('Ya no se hace concat ciego del lote',
    !/products = products\.concat\(toImport\)/.test(importa));

chk('Un ID desconocido se da de alta',
    /if \(idx === undefined\) \{[\s\S]{0,200}?products\.push\(prod\)/.test(importa));

chk('Un ID conocido actualiza el producto existente',
    /var actual = products\[idx\];[\s\S]{0,300}?actual\[campo\] = prod\[campo\]/.test(importa));

// El merge es selectivo a propósito, y las dos reglas importan:
chk('Solo se tocan los campos que el Excel trae',
    /Object\.keys\(prod\)\.forEach/.test(importa),
    'importar un Excel sin la columna Proveedor no puede dejar 424 productos sin proveedor');

chk('stockByArea NUNCA se pisa al actualizar',
    /if \(campo === 'stockByArea'\) return;/.test(importa),
    'es el conteo, no es dato de catálogo: pisarlo borraría lo contado en barra1 y barra2');

chk('El aviso distingue altas de actualizaciones',
    /_nuevos \+ ' nuevos, ' \+ _actualizados \+ ' actualizados\.'/.test(importa),
    'el administrador tiene que poder ver que la reimportación no duplicó nada');

chk('Se siguen contando las filas descartadas por no traer nombre',
    /skipped \+ ' filas omitidas por falta de nombre/.test(importa));

// ═══ 2 · Permiso real, no solo un botón escondido ════════════════════════
const iniImp = importa.indexOf('function handleFileImport(event) {');
const cabeza = iniImp !== -1 ? importa.slice(iniImp, iniImp + 2200) : '';
chk('handleFileImport comprueba isAdmin()', /if \(!isAdmin\(\)\)/.test(cabeza),
    'sin esto, cualquiera podía llamarla desde la consola');
chk('El guard va antes de tocar nada',
    cabeza.indexOf('if (!isAdmin())') < cabeza.indexOf('_crearBackupNombrado'),
    'comprobar después de empezar deja el trabajo a medias');
chk('Al rechazar se limpia el input de archivo',
    /if \(!isAdmin\(\)\) \{[\s\S]{0,300}?event\.target\.value = '';[\s\S]{0,60}?return;/.test(cabeza),
    'si no, el mismo archivo no se puede volver a elegir');
chk('Se sigue creando el respaldo previo a importar',
    /_crearBackupNombrado\('pre_importacion_/.test(importa));

// ═══ 3 · La pestaña muestra el catálogo entero ═══════════════════════════
[['Grupo', 'Grupo'], ['Unidad', 'Unidad'], ['Stock', 'Stock'], ['Precio', 'Precio'],
 ['Mínimo', 'Mínimo'], ['PV', 'PV'], ['Proveedor', 'Proveedor']].forEach(function(par) {
    chk('La tabla tiene columna ' + par[0], tab.indexOf('>' + par[1] + '<') !== -1);
});
chk('Cada fila muestra el ID del producto', /escapeHtml\(product\.id\)/.test(tab),
    'es lo que identifica la fila al importar');
chk('Se marca qué productos se cuentan en oz',
    /usaOz\s*\?\s*' · <span style="color:var\(--accent\)">oz<\/span>'/.test(tab));
chk('El stock por debajo del mínimo se resalta',
    /bajoMin[\s\S]{0,200}?color:#f87171/.test(tab),
    'es la señal que dispara una compra');

// ═══ 4 · Buscador ════════════════════════════════════════════════════════
chk('La pestaña tiene buscador',            /id="productos-search-input"/.test(tab));
chk('Usa el mismo motor que Inicio',        /updateSearchTerm\(this\.value\)/.test(tab),
    'dos buscadores distintos darían resultados distintos para lo mismo');
chk('Escape limpia la búsqueda',            /event\.key===\\'Escape\\'/.test(tab));
chk('El foco vuelve al input tras re-render',
    /input\[type="search"\], #tabContent input\[type="text"\]/.test(render),
    'buscar solo type="text" no encontraba el input: en el móvil el teclado se cerraba a media palabra');

// ═══ 5 · Estados vacíos ══════════════════════════════════════════════════
chk('Hay estado para catálogo vacío',       /El catálogo está vacío/.test(tab));
chk('El texto vacío cambia según el rol',   /admin[\s\S]{0,200}?Importa el Excel del catálogo/.test(tab),
    'a un bartender no se le ofrece un botón que no puede pulsar');
chk('Hay estado para filtro sin resultados', /Ningún producto coincide/.test(tab));
chk('Se avisa de cuántos faltan de precio y de PV',
    /sin precio/.test(tab) && /sin PV/.test(tab),
    'sin precio no se costea y sin PV no cruza con Parrot');

// ═══ 6 · Solo lectura para los que no son admin ══════════════════════════
chk('Los botones de fila solo se dibujan para el admin',
    /if \(admin\) \{[\s\S]{0,1200}?editProduct/.test(tab));
chk('Se avisa al no-admin de que es solo lectura',
    /Catálogo de solo lectura/.test(tab));
chk('Los botones de acción llegan a 44px',
    (tab.match(/min-height:44px/g) || []).length >= 2,
    'por debajo de eso no se aciertan con el pulgar en la barra');

// ═══ 7 · Las columnas secundarias se ven de verdad ═══════════════════════
chk('Ya no se usa "hidden md:table-cell" en el catálogo',
    !/hidden md:table-cell/.test(tab),
    'estilos.css define .hidden con !important y no tiene breakpoints md:');
chk('Se usa una clase propia para las columnas secundarias',
    /class="cat-col-sec"/.test(tab));
chk('.cat-col-sec está definida en la hoja de estilos',
    /\.cat-col-sec\s*\{\s*display:\s*table-cell/.test(css));
chk('…y se oculta solo en pantallas estrechas',
    /@media \(max-width: 767px\) \{\s*\n?\s*\.cat-col-sec \{ display: none; \}/.test(css));

// ═══ 8 · No se rompió lo que ya existía ══════════════════════════════════
chk('Sigue el filtro por grupo',   /getAvailableGroups\(\)\.forEach/.test(tab));
chk('Sigue el botón de editar',    /editProduct\(/.test(tab));
chk('Sigue el botón de eliminar',  /deleteProduct\(/.test(tab));
chk('El catálogo se sigue leyendo con filterByGroup()',
    /filterByGroup\(\)/.test(tab),
    'reimplementar el filtro aquí lo habría desincronizado del de Inicio');

// ═══ 9 · Caché ═══════════════════════════════════════════════════════════
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const vTags = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
chk('R5 subió la versión de caché por encima de 3.0',
    vTags.length === 1 && parseFloat(vTags[0]) > 3.0,
    'versiones encontradas: ' + vTags.join(', '));
chk('El CSS va con la misma versión',
    new RegExp('css/estilos\\.css\\?v=' + vTags[0].replace('.', '\\.')).test(html),
    'R5 cambia el css: con la versión vieja el navegador serviría el de antes');

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── R5 · el catálogo ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');

process.exit(fallos ? 1 : 0);
