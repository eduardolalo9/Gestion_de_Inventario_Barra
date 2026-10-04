#!/usr/bin/env node
/**
 * prueba-redis-r6.js — REDISEÑO R6 · Catálogo y ficha · estática
 * ═══════════════════════════════════════════════════════════════════════════
 * Alcance real de R6, confirmado contra el plan original (ver
 * claude/rediseno-auditoria-ux-y-design-system-2026-10-02.md): "Filas con
 * monograma, cifra a la derecha, badge de nivel, pedido sugerido" ya quedó
 * resuelto en R3 — por tu decisión, el catálogo se queda listado en Inicio
 * (js/83-panel.js, ya tokenizado, ya sin emoji). Lo único que seguía sin
 * tocar es la "ficha con los 12 campos reales (incluido PV Parrot y conteo
 * en oz)": el formulario #productModal (index.html) que abre
 * openProductModal() para dar de alta o editar un producto.
 *
 * A diferencia de R3-R5, este formulario NO estaba roto ni visualmente
 * inconsistente en su mayoría: las utilidades de Tailwind que usa
 * (bg-white, text-gray-*, focus:ring-blue-500, bg-black/bg-opacity-60,
 * shadow-2xl) YA redirigen a tokens desde R1 (ver css/utilidades.css). Lo
 * que sí eran violaciones reales:
 *
 *   1  ★ El emoji ⚗️ del recuadro "Conteo de botella en oz" → icono del kit.
 *   2  ★ El recuadro en sí usaba rgba(108,99,255,…) — un índigo de antes de
 *        R1 que no es ningún token del sistema — → var(--card-high) /
 *        var(--border-mid) (caja neutra: no es una acción que decidir, el
 *        latón se reserva para Guardar).
 *   3    Tres colores con un valor hex de reserva muerto
 *        (var(--border-mid,#e5e7eb), var(--modal-bg,#fff),
 *        var(--accent-on,#003063)) — el token ya resuelve solo, el resto
 *        era peso muerto.
 *   4    color:#9ca3af y color:'#dc2626' escritos a mano en
 *        _avisarPVDuplicado() (js/85-ui-inventario-fisico.js) → tokens.
 *   5    El hover de "Cancelar" usaba un gris rgba(202,196,208,…) sin
 *        relación con el sistema → var(--border-mid).
 *
 * Qué NO cambia: los 12 campos, sus id, saveProduct(), openProductModal(),
 * la validación de PV duplicado, la casilla de conteo en oz y su bloqueo
 * cuando faltan capacidad/peso, los permisos (catalog.edit) — todo sigue
 * exactamente igual. Las notificaciones de error de saveProduct() (⚠️) y
 * las confirmaciones de borrado de deleteProduct()/deleteAllProducts()
 * siguen con su emoji: son avisos de texto plano, no iconografía de
 * interfaz (mismo criterio que R1-R5).
 *
 *   node pruebas/prueba-redis-r6.js
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
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

const html = leer('index.html');
const util = leer('css/utilidades.css');
const inv  = leer('js/85-ui-inventario-fisico.js');
const sw   = leer('sw.js');

// El trozo de HTML del modal, para no confundirlo con el resto del documento.
const modal = html.slice(html.indexOf('id="productModal"'),
                         html.indexOf('<!-- Modal Receta'));
// Sin comentarios: el código de hoy TODAVÍA menciona el índigo viejo dentro
// de un comentario que explica por qué cambió — lo que no debe existir es el
// color en el CSS/HTML que de verdad se renderiza.
const modalSinComentarios = modal.replace(/<!--[\s\S]*?-->/g, '');

function funcion(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    const m = /\n        (?:async )?function /.exec(src.slice(ini + 10));
    return m ? src.slice(ini, ini + 10 + m.index) : src.slice(ini);
}
const fAvisarPV = funcion(inv, '_avisarPVDuplicado');

// ═══ 1 · EL CONTRATO DEL FORMULARIO, INTACTO ═══════════════════════════════
// Los 12 campos reales del catálogo (ver el plan original). El rediseño
// podía tocar cómo se ven; no podía hacer desaparecer ninguno.
[
    ['productId',          'ID'],
    ['productName',        'Descripción'],
    ['productUnit',        'Unidad'],
    ['productGroup',       'Grupo'],
    ['productConteoOz',    'casilla de conteo en oz'],
    ['productCapacidadMl', 'capacidad en ml'],
    ['productPesoLlenaOz', 'peso de botella llena en oz'],
    ['productPrecio',      'precio unitario'],
    ['productStockMinimo', 'stock mínimo'],
    ['productConversion',  'conversión (piezas por caja)'],
    ['productProveedor',   'proveedor'],
    ['productPV',          'PV de Parrot (SKU)']
].forEach(function (par) {
    chk('★ La ficha conserva #' + par[0], modal.indexOf('id="' + par[0] + '"') !== -1, par[1]);
});
chk('★ Guardar sigue llamando a saveProduct()', /onclick="saveProduct\(\)"/.test(modal));
chk('Cancelar sigue llamando a closeProductModal()', /onclick="closeProductModal\(\)"/.test(modal));
chk('El aviso de PV duplicado conserva su id (lo repinta _avisarPVDuplicado)',
    modal.indexOf('id="productPVAviso"') !== -1);
chk('La normalización de PV en vivo sigue cableada (oninput="_normalizarPV(this)")',
    /oninput="_normalizarPV\(this\)"/.test(modal));
chk('La sincronización de la casilla oz sigue cableada (oninput/onchange="_sincronizarCasillaOz\\(\\)")',
    (modal.match(/_sincronizarCasillaOz\(\)/g) || []).length >= 3);

// ═══ 2 · EL EMOJI DE LA FICHA, LIMPIADO ════════════════════════════════════
const EMOJI_UI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
chk('★ La ficha ya no usa emoji como iconografía (antes: ⚗️ en "Conteo de botella en oz")',
    !EMOJI_UI.test(modal));
chk('★ El recuadro de conteo en oz usa el icono fa-bottle del kit',
    /fa-solid fa-bottle" aria-hidden="true"><\/i> Conteo de botella en oz/.test(modal));
chk('★ fa-bottle está definido en utilidades.css', /\.fa-bottle\s*[,{ ]/.test(util));

// ═══ 3 · NI UN COLOR AJENO AL SISTEMA EN LA ZONA TOCADA ════════════════════
chk('★ El recuadro de conteo en oz ya no usa el índigo rgba(108,99,255,…) de antes de R1',
    !/rgba\(108,\s*99,\s*255/.test(modalSinComentarios));
chk('★ Ese recuadro usa tokens del sistema (--card-high / --border-mid), no un color a mano',
    /background:var\(--card-high\);border:1px solid var\(--border-mid\)/.test(modal));
chk('Sin valores de reserva muertos en los tokens ya definidos (var(--x,#hex))',
    !/var\(--border-mid,#e5e7eb\)/.test(modal) &&
    !/var\(--modal-bg,#fff\)/.test(modal) &&
    !/var\(--accent-on,#003063\)/.test(modal));
chk('El hover de "Cancelar" usa --border-mid, no el gris rgba(202,196,208,…) suelto',
    /this\.style\.background='var\(--border-mid\)'/.test(modal) &&
    !/rgba\(202,\s*196,\s*208/.test(modal));
chk('★ _avisarPVDuplicado ya no escribe colores a mano (#dc2626 / #9ca3af)',
    !/#dc2626/.test(fAvisarPV) && !/#9ca3af/.test(fAvisarPV) &&
    /var\(--danger\)/.test(fAvisarPV) && /var\(--txt-muted\)/.test(fAvisarPV));

// ═══ 4 · TODO ICONO PEDIDO ESTÁ DEFINIDO ═══════════════════════════════════
const pedidos = new Set();
const reIco = /\bfa-(?!solid\b|regular\b|fw\b|spin\b)[a-z][a-z0-9-]*/g;
let m;
while ((m = reIco.exec(modal)) !== null) pedidos.add(m[0]);
const faltan = Array.from(pedidos).filter(function (ic) {
    return !new RegExp('\\.' + ic + '\\s*[,{ ]').test(util);
});
chk('★ Todo icono que pide la ficha está definido en utilidades.css', faltan.length === 0, 'sin definir: ' + faltan.join(', '));

// ═══ 5 · LO QUE NO SE TOCA ══════════════════════════════════════════════════
chk('El overlay de productModal ya usaba el token del sistema desde antes (--scrim vía bg-black)',
    /#productModal,\s*#orderModal,\s*#inventarioModal\s*\{[^}]*background-color:\s*var\(--scrim\)/.test(leer('css/estilos.css')));
chk('Los avisos de error de saveProduct() conservan su ⚠️ (son texto plano, no interfaz)',
    /showNotification\('⚠️ El PV ' \+ pv/.test(inv) &&
    /showNotification\('⚠️ Error: el peso de botella llena/.test(inv));
chk('Las confirmaciones de borrado conservan su emoji (showConfirm es texto plano)',
    /showConfirm\(\s*'⚠️ ¿Eliminar el producto/.test(inv) &&
    /showConfirm\(\s*'🚨 ¿Eliminar TODOS los/.test(inv));
chk('El permiso de edición de catálogo (catalog.edit) no cambió',
    /hasPermission\('catalog\.edit'\)/.test(funcion(inv, 'saveProduct')));
chk('openProductModal() sigue poblando los mismos 12 campos al editar',
    (function () {
        const f = funcion(inv, 'openProductModal');
        return ['productId', 'productName', 'productUnit', 'productGroup', 'productCapacidadMl',
                'productPesoLlenaOz', 'productPrecio', 'productStockMinimo', 'productConversion',
                'productProveedor', 'productPV'].every(function (id) { return f.indexOf("getElementById('" + id + "')") !== -1; });
    })());

// ═══ Versión ═══════════════════════════════════════════════════════════════
const vHtml = (html.match(/\?v=(\d+\.\d+)/) || [])[1];
const vSw   = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vHtml && vHtml === vSw, 'index=' + vHtml + ' sw=' + vSw);
// Comparación por minor, no parseFloat: '5.10' como float da 5.1 y parecería
// MENOR que 5.6 — corrección 4-oct-2026 (ver prueba-redis-r3.js).
chk('La versión avanzó respecto al hotfix 4.25 (≥ 5.6)', Number((vSw || '').split('.')[1]) >= 6, 'es ' + vSw);

// ═══ Resultado ═════════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── REDISEÑO R6 · Catálogo y ficha (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
