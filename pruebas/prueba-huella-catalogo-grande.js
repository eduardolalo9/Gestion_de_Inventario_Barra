#!/usr/bin/env node
/**
 * prueba-huella-catalogo-grande.js — v5.26 · hallazgo #6 (Cero Pérdida de Datos)
 * ═══════════════════════════════════════════════════════════════════════════
 * _computeDataHash() (js/30-indexeddb.js) decide si hay algo nuevo que subir
 * a la nube. Con más de 100 productos usa una huella compacta (id/nombre/
 * unidad/grupo) por velocidad — pero eso dejaba FUERA cualquier cambio de
 * precio, mínimo, proveedor, PV o conversión: con 431 productos esos campos
 * podían editarse y nunca sincronizarse en automático (solo "Sincronizar
 * ahora" los subía). El fix agrega `_v` a la huella: TODA edición de producto
 * pasa por saveProduct(), que siempre bumpea `_v` (js/85), así que cualquier
 * cambio de campo mueve la huella sin tener que listarlos uno por uno.
 * Se ejecuta el código real para comprobar el comportamiento, no solo el texto.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r/g, '');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

// _computeDataHash() vive en js/10-multiusuario.js (no en js/30-indexeddb.js,
// que solo la LLAMA desde saveToLocalStorage) — se cargan los dos en la
// sandbox para ejecutar el cruce real tal como ocurre en la app.
const srcMultiusuario = leer('js/10-multiusuario.js');
chk('★ La huella compacta (>100 productos) incluye _v, además de id/nombre/unidad/grupo',
    /products\.map\(function\(p\) \{\s*return \(p\.id \|\| ''\) \+ '\|' \+ \(p\.name \|\| ''\) \+ '\|' \+ \(p\.unit \|\| ''\) \+ '\|' \+ \(p\.group \|\| ''\) \+ '\|' \+ \(p\._v \|\| 0\)/.test(srcMultiusuario));

function construirCtx() {
    const ctx = { console };
    ctx.window = ctx;
    // estadoAreasVacio() se llama a nivel de módulo (línea 8, myAuditoriaStatus) —
    // normalmente la define otro archivo de la app; aquí basta un stub inerte,
    // no participa en el cálculo de _computeDataHash().
    ctx.estadoAreasVacio = function() { return {}; };
    vm.createContext(ctx);
    vm.runInContext(srcMultiusuario, ctx, { filename: 'js/10-multiusuario.js' });
    return ctx;
}

function catalogoGrande(n) {
    const lista = [];
    for (let i = 0; i < n; i++) lista.push({ id: 'P' + i, name: 'PRODUCTO ' + i, unit: 'PZA', group: 'GRUPO', precio: 100, _v: 1 });
    return lista;
}

// ── Con 431 productos (como Eduardo), editar el precio de uno debe mover la huella ──
{
    const ctx = construirCtx();
    ctx.products = catalogoGrande(431);
    ctx.orders = []; ctx.inventories = []; ctx.inventarioConteo = {};
    const h1 = vm.runInContext('_computeDataHash()', ctx);
    // saveProduct() SIEMPRE bumpea _v al editar (js/85-ui-inventario-fisico.js) —
    // se simula ese mismo cambio: el precio cambia Y el _v sube junto con él.
    ctx.products[200].precio = 150;
    ctx.products[200]._v = 2;
    ctx._computeDataHash._lastTs = 0; // sin esto el throttle de 50ms devolvería el mismo resultado cacheado
    const h2 = vm.runInContext('_computeDataHash()', ctx);
    chk('★ Con 431 productos, cambiar el precio de uno (con su _v) mueve la huella (antes no se movía)',
        h1 !== h2, 'h1 === h2: ' + (h1 === h2));
}

// ── Sin tocar nada, la huella no cambia (no se gatillan sincronizaciones de más) ──
{
    const ctx = construirCtx();
    ctx.products = catalogoGrande(200);
    ctx.orders = []; ctx.inventories = []; ctx.inventarioConteo = {};
    const h1 = vm.runInContext('_computeDataHash()', ctx);
    ctx._computeDataHash._lastTs = 0;
    const h2 = vm.runInContext('_computeDataHash()', ctx);
    chk('Sin cambios, la huella es idéntica (no desperdicia syncs)', h1 === h2);
}

// ── Con <=100 productos sigue usando JSON.stringify completo (cubre todo, sin tocar esa rama) ──
{
    const ctx = construirCtx();
    ctx.products = catalogoGrande(50);
    ctx.orders = []; ctx.inventories = []; ctx.inventarioConteo = {};
    const h1 = vm.runInContext('_computeDataHash()', ctx);
    ctx.products[10].stockMinimo = 9; // campo que la huella compacta ni siquiera lista
    ctx._computeDataHash._lastTs = 0;
    const h2 = vm.runInContext('_computeDataHash()', ctx);
    chk('Con 100 productos o menos (JSON completo) cualquier campo mueve la huella, como siempre', h1 !== h2);
}

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Huella de sincronización con catálogos grandes (v5.26, hallazgo #6) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
