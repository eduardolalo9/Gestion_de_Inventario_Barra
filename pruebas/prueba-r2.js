#!/usr/bin/env node
/**
 * prueba-r2.js — R2: el PV de Parrot en el catálogo
 * ═══════════════════════════════════════════════════════════════════════════
 * Reglas cubiertas: 2 (el catálogo maneja SKU / PV de venta) y 8 (la relación
 * con ParrotConnect es SKU de Parrot ↔ PV, nunca el nombre).
 *
 * Lo que vigila esta prueba es la LLAVE. El PV es lo que va a unir cada venta
 * con su producto; si se guarda con un espacio al final, en minúsculas, o
 * repetido en dos productos, el cruce falla en silencio: no salta ningún
 * error, simplemente las ventas se reparten mal y la desviación sale torcida
 * en los dos productos a la vez. Ese es el fallo que se descubre un mes
 * después, cuando ya nadie sabe de dónde salió.
 *
 * Las funciones de normalización y de duplicados se extraen del archivo real
 * y se ejecutan. Una copia probaría que la copia funciona.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok, detalle: detalle || '' });
    if (!ok) fallos++;
}

const html    = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const uiProd  = fs.readFileSync(path.join(RAIZ, 'js/85-ui-inventario-fisico.js'), 'utf8');
const importa = fs.readFileSync(path.join(RAIZ, 'js/90-ciclo-admin.js'), 'utf8');
const expor   = fs.readFileSync(path.join(RAIZ, 'js/95-exportacion.js'), 'utf8');

function extraer(fuente, nombre) {
    const i = fuente.indexOf('function ' + nombre + '(');
    if (i === -1) return null;
    let nivel = 0, dentro = false;
    for (let j = i; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(i, j + 1); }
    }
    return null;
}

// ═══ 1 · El campo existe y está cableado ══════════════════════════════════
chk('El formulario de producto tiene el campo PV', /id="productPV"/.test(html));
chk('El campo PV normaliza mientras se escribe',
    /id="productPV"[\s\S]{0,300}?oninput="_normalizarPV\(this\)"/.test(html));
chk('El campo PV no autocorrige ni revisa ortografía',
    /id="productPV"[\s\S]{0,300}?spellcheck="false"/.test(html),
    'el corrector del móvil destrozaría un código como PVA1001169');
chk('Hay un aviso visible para el PV', /id="productPVAviso"/.test(html));
chk('Al abrir un producto se carga su PV', /product\.pv\) document\.getElementById\('productPV'\)/.test(uiProd));
chk('Al abrir el formulario en blanco se limpia el PV',
    /'productProveedor','productPV'/.test(uiProd));
chk('El aviso se recalcula al abrir, sin arrastrar el rojo anterior',
    /_avisarPVDuplicado\(\(document\.getElementById\('productPV'\)/.test(uiProd));

// ═══ 2 · Normalización — se ejecuta de verdad ═════════════════════════════
const fnNorm = extraer(uiProd, '_normalizarPV');
chk('_normalizarPV existe', !!fnNorm);
if (fnNorm) {
    // _normalizarPV llama al aviso al final. Aquí interesa solo la normalización,
    // así que el aviso se sustituye por un vacío; se prueba aparte más abajo.
    const ctx = vm.createContext({ document: { getElementById: () => null },
                                   _avisarPVDuplicado: function() {} });
    vm.runInContext(fnNorm + '\nglobalThis._n = _normalizarPV;', ctx);
    const norm = (v) => { const el = { value: v, selectionStart: 0, setSelectionRange() {} };
                          ctx._n(el); return el.value; };

    chk('El PV pasa a mayúsculas',            norm('pva1001169') === 'PVA1001169');
    chk('Se quitan los espacios del principio y del final',
        norm('  PVA1001169  ') === 'PVA1001169',
        'un PV copiado de Excel llega con espacios más veces de las que parece');
    chk('Se quitan los espacios de en medio',  norm('PVA 1001169') === 'PVA1001169');
    chk('Se quitan tabuladores y saltos',      norm('\tPVB1000058\n') === 'PVB1000058');
    chk('Un PV ya limpio no se toca',          norm('PVB1001841') === 'PVB1001841');
    chk('Un campo vacío sigue vacío',          norm('') === '');
}

// ═══ 3 · Duplicados — se ejecuta de verdad ════════════════════════════════
const fnDup = extraer(uiProd, '_buscarPVDuplicado');
chk('_buscarPVDuplicado existe', !!fnDup);
if (fnDup) {
    const CAT = [
        { id: 'A1', name: 'CERVEZA VICTORIA', pv: 'PVA1001169' },
        { id: 'B2', name: 'TOPO CHICO 355',   pv: 'PVB1000058' },
        { id: 'C3', name: 'TEQUILA 750' },              // sin PV: no se vende tal cual
    ];
    const ctx = vm.createContext({ products: CAT, editingProductId: null });
    vm.runInContext(fnDup + '\nglobalThis._d = _buscarPVDuplicado;', ctx);

    chk('Detecta un PV ya usado por otro producto',
        ctx._d('PVA1001169') && ctx._d('PVA1001169').id === 'A1');
    chk('Un PV libre no da conflicto',       ctx._d('PVZ9999999') === null);
    chk('Un PV vacío nunca da conflicto',    ctx._d('') === null,
        'los insumos que no se venden tal cual lo dejan vacío, y son muchos');
    chk('Los productos sin PV no estorban',  ctx._d('PVB1000058').id === 'B2');

    // Editar un producto no puede chocar consigo mismo, o sería imposible
    // guardar cualquier cambio en un producto que ya tiene PV.
    const ctx2 = vm.createContext({ products: CAT, editingProductId: 'A1' });
    vm.runInContext(fnDup + '\nglobalThis._d = _buscarPVDuplicado;', ctx2);
    chk('Un producto no choca con su propio PV al editarse',
        ctx2._d('PVA1001169') === null);
    chk('Pero sí choca con el PV de otro al editarse',
        ctx2._d('PVB1000058') && ctx2._d('PVB1000058').id === 'B2');
}

// ═══ 4 · Guardar bloquea el duplicado ═════════════════════════════════════
chk('saveProduct normaliza el PV antes de comprobar nada',
    /pvEl\.value\.toUpperCase\(\)\.replace\(\/\\s\+\/g, ''\)/.test(uiProd));
chk('saveProduct se niega a guardar un PV repetido',
    /ya lo usa/.test(uiProd) && /if \(pvEl\) pvEl\.focus\(\);\s*\n\s*return;/.test(uiProd),
    'bloquear es correcto: dos productos con el mismo PV reparten mal las ventas');
chk('El PV se guarda al editar y al crear',
    /product\.pv\s*=\s*pv;/.test(uiProd) && /newProduct\.pv\s*=\s*pv;/.test(uiProd));
chk('Vaciar el campo borra el PV del producto',
    /else delete product\.pv;/.test(uiProd));

// ═══ 5 · Excel: ida y vuelta ══════════════════════════════════════════════
chk('La importación acepta la columna PV y también SKU',
    /pv:\s*\['PV', 'SKU'/.test(importa),
    'en la hoja Venta de Parrot la columna se llama SKU: es el mismo dato');
chk('La importación normaliza igual que la captura manual',
    /String\(_pvRaw\)\.toUpperCase\(\)\.replace\(\/\\s\+\/g, ''\)/.test(importa),
    'si normalizaran distinto, el mismo PV no cruzaría según de dónde viniera');
chk('La exportación escribe la columna PV', /headerRow\.push\('PV'\)/.test(expor));
chk('La exportación saca el PV del producto', /cells\.push\(p\.pv \|\| ''\)/.test(expor));

// ═══ 6 · La importación masiva avisa de PV repetidos ══════════════════════
// Es donde de verdad se cuela el error: 424 filas de un Excel, nadie las mira
// una por una, y dos con el mismo PV no dan ningún síntoma.
chk('La importación busca PV repetidos al terminar', /_pvRepes/.test(importa));
chk('La importación avisa al usuario, no solo a la consola',
    /PV repetido\(s\)/.test(importa));
chk('El aviso explica la consecuencia, no solo el hecho',
    /Las ventas no cruzarán bien hasta corregirlos/.test(importa));
chk('La importación NO borra ni modifica los duplicados',
    !/splice|delete p\.pv/.test(importa.slice(importa.indexOf('_pvRepes'))),
    'cuál de los dos está mal lo decide el administrador, no la app');

// ═══ 7 · Caché ════════════════════════════════════════════════════════════
const vTags = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
chk('R2 subió la versión de caché por encima de 2.7',
    vTags.length === 1 && parseFloat(vTags[0]) > 2.7,
    'versiones encontradas: ' + vTags.join(', '));

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── R2 · el PV de Parrot en el catálogo ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');

process.exit(fallos ? 1 : 0);
