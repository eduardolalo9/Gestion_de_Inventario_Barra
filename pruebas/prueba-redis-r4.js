#!/usr/bin/env node
/**
 * prueba-redis-r4.js — REDISEÑO R4 · Conteo · estática
 * ═══════════════════════════════════════════════════════════════════════════
 * DECISIÓN DE EDUARDO: "Mejor dejarlo en el modal, como dijiste antes". El
 * flujo del conteo no cambia. Esta prueba vigila sobre todo eso: que el modal
 * siga siendo el modal, con sus mismos id y sus mismos onclick, porque de
 * ellos cuelga toda la captura.
 *
 *   1  ★ El modal conserva su contrato: cada id y cada onclick que el JS
 *        busca sigue existiendo en el HTML. Si se cae uno, la captura deja
 *        de funcionar sin que nada avise.
 *   2  ★ El campo numérico es mono tabular. Es LA cifra de la pantalla.
 *   3  ★ No queda azul de la paleta anterior en el modal ni en el conteo.
 *   4  ★ El chip y el total usan el mismo redondeo: el mismo número no puede
 *        salir dos veces distinto en la misma tarjeta.
 *   5  ★ Todo icono que se pide está definido.
 *   6    Los emoji de los avisos de texto siguen intactos (son lógica).
 *
 *   node pruebas/prueba-redis-r4.js
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

const html  = leer('index.html');
const esti  = leer('css/estilos.css');
const util  = leer('css/utilidades.css');
const rend  = leer('js/70-conversion-render.js');
const inv   = leer('js/85-ui-inventario-fisico.js');
const multi = leer('js/10-multiusuario.js');
const sw    = leer('sw.js');

// El trozo de HTML del modal, para no confundirlo con el resto del documento.
const modal = html.slice(html.indexOf('id="inventarioModal"'),
                         html.indexOf('<script src="js/00-nucleo.js'));

// ═══ 1 · EL CONTRATO DEL MODAL, INTACTO ════════════════════════════════════
// Son los id y los onclick de los que cuelga toda la captura. El rediseño
// podía tocar cómo se ve cada uno; no podía hacer desaparecer ninguno.
[
    ['inventarioModal',          'el contenedor que se muestra y se oculta'],
    ['inventarioModalTitle',     'el nombre del producto'],
    ['inventarioModalSubtitle',  'grupo, unidad y área'],
    ['inv_bloqueBotella',        'el modo botella (enteras + abiertas en oz)'],
    ['inv_bloqueCantidad',       'el modo cantidad (un campo con decimales)'],
    ['inv_enteras',              'las botellas enteras'],
    ['inv_abiertasContainer',    'donde se crean las filas de abiertas'],
    ['inv_abiertasLabel',        'la etiqueta del grupo de abiertas'],
    ['inv_abiertasUnidadHint',   'la pista de unidad'],
    ['inv_cantidadTotal',        'el campo único del modo cantidad'],
    ['inv_cantidadUnidad',       'la unidad del modo cantidad']
].forEach(function (par) {
    chk('★ El modal conserva #' + par[0], modal.indexOf('id="' + par[0] + '"') !== -1, par[1]);
});
[
    ['closeInventarioModal()', 'cerrar'],
    ['inventarioGuardarYSiguiente()',  'guardar (v5.23: "Guardar y siguiente", que llama a saveInventarioModal())'],
    ['inventarioModalPaso(',   'el paso ± de las botellas enteras (v5.23)'],
    ['addAbiertaInModal()',    'añadir otra botella abierta'],
    ['_sanearEntradaEntero(this)',  'saneado de enteros'],
    ['_sanearEntradaDecimal(this)', 'saneado de decimales']
].forEach(function (par) {
    chk('★ El modal conserva la acción ' + par[1], modal.indexOf(par[0]) !== -1, par[0]);
});
chk('★ La fila de una abierta conserva su id y su botón de quitar',
    /id="inv_abierta_' \+ idx \+ '"/.test(rend) && /removeAbiertaInModal\(/.test(rend),
    'de estos id lee saveInventarioModal() al guardar');
chk('El flujo no cambió: la tarjeta sigue abriendo el modal',
    /onclick="openInventarioModal\(/.test(inv),
    'decisión de Eduardo: "mejor dejarlo en el modal"');
chk('No se añadió captura en línea a la tarjeta',
    !/class="inv-card[^"]*"[^>]*>[\s\S]{0,400}<input/.test(inv),
    'el flujo del conteo no cambia en R4');

// ═══ 2 · LA CIFRA, EN MONO TABULAR ═════════════════════════════════════════
chk('★ El campo numérico del modal es mono tabular',
    /\.inv-modal__num\s*\{[^}]*IBM Plex Mono/.test(esti) &&
    /\.inv-modal__num\s*\{[^}]*tabular-nums/.test(esti));
chk('★ El campo numérico es grande y táctil',
    /\.inv-modal__num\s*\{[^}]*font-size:\s*1\.3\d+rem/.test(esti) &&
    /\.inv-modal__num\s*\{[^}]*min-height:\s*5\dpx/.test(esti));
chk('Las dos entradas del modal usan esa clase, no utilidades sueltas',
    (modal.match(/class="inv-modal__num"/g) || []).length === 2 &&
    /class="inv-modal__num inv-abierta__num"/.test(rend));
chk('★ El total de la tarjeta de conteo es la cifra del kit',
    /inv-card__total-n/.test(inv) && /\.inv-card__total-n/.test(esti) &&
    /class="num bi-cifra inv-card__total-n"/.test(inv));
chk('Sin contar y contado en cero se distinguen',
    /inv-card__total--vacio/.test(inv) && /\.inv-card__total--vacio/.test(esti),
    'en un inventario, "no contado" y "contado en cero" no son lo mismo');

// ═══ 3 · NI UN RESTO DE LA PALETA ANTERIOR ═════════════════════════════════
const AZULES = /#2563eb|#1d4ed8|#818cf8|#7c3aed|rgba\(59,\s*130,\s*246|border-blue-|bg-blue-|ring-blue-|text-blue-/;
chk('★ El modal no conserva ni una clase azul de la paleta anterior',
    !AZULES.test(modal), 'quedaba azul en el modal de captura');
chk('★ El modal no conserva las clases de tema claro (bg-white, text-gray-*)',
    !/bg-white|text-gray-\d|bg-gray-\d|border-orange-|ring-orange-/.test(modal),
    'eran del tema claro original: sobre fondo oscuro no decían nada');
chk('La fila de abiertas tampoco las conserva',
    !/border-orange-200|ring-orange-400|text-gray-500|bg-white/.test(
        rend.slice(rend.indexOf('function renderAbiertaInput'),
                   rend.indexOf('function renderAbiertaInput') + 1600)));
chk('★ El velo del modal usa el token del sistema',
    /#productModal, #orderModal, #inventarioModal \{[^}]*background-color:\s*var\(--scrim\)/.test(esti),
    'era un negro fijo al 38% que no cambiaba con el tema');
chk('Los chips de abiertas usan tokens, no el ámbar escrito a mano',
    !/\.inv-chip\.abierta[^}]*rgba\(245,158,11/.test(esti) &&
    !/\.inv-chip\.abierta \.inv-chip__val \{ color: #fcd34d/.test(esti) &&
    /\.inv-chip\.abierta \{ border-color: var\(--warn-dim\)/.test(esti));
chk('El badge de conflicto ya no lleva su marrón de tema claro',
    !/\.inv-card__conflict-badge\s*\{[^}]*#92400e/.test(esti) &&
    /UI\.badge\('conflicto'/.test(inv),
    '#92400e sobre fondo oscuro apenas se leía');
chk('El badge "CONTANDO" usa tokens y un punto que late',
    /\.audit-counting-badge\s*\{[^}]*var\(--warn-dim\)/.test(esti) &&
    /audit-counting-badge__punto/.test(inv));

// ═══ 4 · EL MISMO NÚMERO, UN SOLO VALOR ════════════════════════════════════
/**
 * El HOTFIX de decimales arregló el TOTAL (1.245, no "1.25") pero el chip se
 * quedó en toFixed(2). La misma tarjeta mostraba 1.245 arriba y 1.25 abajo.
 */
chk('★ El chip de cantidad usa el mismo redondeo que el total',
    /_chipCantidad\s*=\s*\(v\)\s*=>\s*String\(Math\.round\(\(v \|\| 0\) \* 1000\) \/ 1000\)/.test(inv),
    'si no, 1.245 sale como 1.25 en el chip y como 1.245 en el total');
chk('Los dos chips de abiertas lo usan (el primero y los extra)',
    (inv.match(/_chipCantidad\(pt/g) || []).length === 2,
    'usos: ' + (inv.match(/_chipCantidad\(pt/g) || []).length);
chk('El total sigue con su redondeo de 3 decimales',
    /String\(Math\.round\(totalFinal \* 1000\) \/ 1000\)/.test(inv));

// ═══ 5 · TODO ICONO PEDIDO EXISTE ══════════════════════════════════════════
const pedidos = new Set();
[html, rend, inv, multi, leer('js/83-panel.js'), leer('js/18-areas-config.js')].forEach(function (src) {
    const re = /\bfa-(?!solid\b|regular\b|fw\b|spin\b)[a-z][a-z0-9-]*/g;
    let m;
    while ((m = re.exec(src)) !== null) pedidos.add(m[0]);
});
const faltan = Array.from(pedidos).filter(function (ic) {
    return !new RegExp('\\.' + ic + '\\s*[,{ ]').test(util);
});
chk('★ Todo icono que se pide está definido en utilidades.css',
    faltan.length === 0, 'sin definir: ' + faltan.join(', '));
chk('★ Los iconos nuevos de R4 están definidos',
    ['fa-bottle', 'fa-wine-glass', 'fa-lock', 'fa-user']
        .every(function (ic) { return new RegExp('\\.' + ic + '\\s*[,{ ]').test(util); }));
chk('★ La píldora del área usa el icono, no el emoji del mapa antiguo',
    !/areasAuditoriaIcons\[area\]/.test(inv) && !/areasAuditoriaIcons\[info\.area\]/.test(multi) &&
    /areasAuditoriaFA\[area\]/.test(inv),
    'la misma área salía con icono en una pantalla y con emoji en otra');

// ═══ 6 · LOS AVISOS DE TEXTO, INTACTOS ═════════════════════════════════════
chk('Los emoji de los avisos de texto siguen intactos (son lógica, no adorno)',
    /message\.startsWith\('⚠️'\)/.test(rend),
    'isCritical() los lee para decidir si el aviso es crítico');
chk('Los mensajes de WhatsApp conservan sus emoji (son texto plano, no interfaz)',
    /\u{1F4E6} \*Total Enteras:\*/u.test(inv),
    'van en un mensaje de WhatsApp: ahí el emoji es la única jerarquía posible');

// ═══ Versión ═══════════════════════════════════════════════════════════════
const vHtml = (html.match(/\?v=(\d+\.\d+)/) || [])[1];
const vSw   = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vHtml && vHtml === vSw,
    'index=' + vHtml + ' sw=' + vSw);
// Comparación por minor, no parseFloat: '5.10' como float da 5.1 y parecería
// MENOR que 5.3 — corrección 4-oct-2026 (ver prueba-redis-r3.js).
chk('La versión avanzó respecto a R3 (≥ 5.3)', Number((vSw || '').split('.')[1]) >= 3, 'es ' + vSw);

// ═══ Resultado ═════════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── REDISEÑO R4 · Conteo (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
