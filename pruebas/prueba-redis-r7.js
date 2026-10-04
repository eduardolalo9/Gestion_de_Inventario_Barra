#!/usr/bin/env node
/**
 * prueba-redis-r7.js — REDISEÑO R7 · Recetario y los modales pendientes · estática
 * ═══════════════════════════════════════════════════════════════════════════
 * R6 dejó anotado que el mismo patrón de violaciones (valores de reserva
 * hex muertos — var(--x,#hex) —, un hover rgba(202,196,208,…) suelto y
 * emoji como iconografía) se repetía en otros cuatro modales del repo:
 * #recetaModal, #orderModal, nuevoInventarioModal y registrarFechaRecuentoModal.
 *
 * Al investigar #recetaModal se encontró que su contenido dinámico —
 * _recetaRenderIngredientesLista() y toda la pestaña Recetario
 * (renderRecetarioTab / _renderRecetarioLista / _renderRecetaFicha, en
 * js/91-recetario.js) — comparte exactamente los mismos colores hex a mano
 * (#dc2626, #d97706, #4b5563) y los mismos fallbacks muertos. Separar el
 * modal del resto del módulo habría dejado un diff a medias dentro del
 * mismo archivo, así que R7 cierra el módulo completo: Recetario (ficha +
 * lista + detalle) y, además, los otros tres modales ya señalados.
 *
 * Violaciones reales encontradas y corregidas:
 *   1  ★ #recetaModal / #orderModal / nuevoInventarioModal / regFechaRecuentoModal:
 *        valores de reserva hex muertos (var(--border-mid,#e5e7eb),
 *        var(--modal-bg,#fff), var(--accent-on,#003063), var(--border-mid,#d1d5db)).
 *   2  ★ #orderModal: el hover de "Cancelar" (rgba(202,196,208,…)) y el fondo
 *        del botón "Compartir WhatsApp" (rgba(109,213,140,.18) a mano, en vez
 *        de var(--ok-dim), que ya existe para exactamente este uso).
 *   3  ★ nuevoInventarioModal: el botón "➕ Crear inventario" (emoji) → icono
 *        fa-plus; y el checklist de áreas pintaba el emoji configurable del
 *        área (a.icono) en vez del icono real del kit (areasAuditoriaFA),
 *        que es lo que ya usan las otras dos pantallas que muestran las
 *        mismas áreas (js/85-ui-inventario-fisico.js líneas 665 y 1111).
 *   4  ★ _pintarAvisoFechaNuevoInv() / _pintarAvisoFechaRegistrar()
 *        (js/75-auditoria-flujo.js): var(--red, #f87171) / var(--amber,
 *        #fbbf24) a mano, y emoji decorativo (⚠️/✓) en texto que ya dice la
 *        palabra completa — mismo criterio que _avisarPVDuplicado en R6:
 *        el color nunca va solo, pero tampoco hace falta el emoji si la
 *        palabra ya lo dice.
 *   5  ★ Recetario — _recetaRenderIngredientesLista(): #dc2626 a mano, el
 *        emoji ⚠️ y el glifo "✕" (en vez de fa-xmark) en el botón de quitar
 *        insumo.
 *   6  ★ Recetario — renderRecetarioTab() y afines: candado (🔒) y libro
 *        (📖) como emoji de estado vacío → iconos del kit; badge "Inactiva"
 *        con #4b5563/#fff a mano → superficie neutra del kit; "sin costo" /
 *        "incompleto" con #d97706 a mano → var(--warn); botón "Eliminar"
 *        con rgba(220,38,38,.35) a mano → var(--danger-dim); "← Volver al
 *        recetario" con una flecha de texto suelta → fa-chevron-left, el
 *        mismo icono que ya usan los demás botones "Volver" de la app
 *        (audit-back-btn, en js/85-ui-inventario-fisico.js).
 *
 * Lo que NO se tocó: el flujo de guardar/editar/eliminar receta
 * (saveRecetaModal, openRecetaModal, eliminarReceta), el cálculo de costo
 * (costoReceta/costoLineaReceta), el permiso recipe.edit/recipe.read, el
 * carrito de pedidos (createOrder/renderOrderTable — ya estaban bien
 * tokenizados, incluido el degradado purpura→azul de la cabecera de la
 * tabla, que ya redirige a latón desde R1), y la clasificación de fecha de
 * recuento (clasificarRecuento) — solo cambia cómo se pinta su resultado.
 *
 *   node pruebas/prueba-redis-r7.js
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

const html    = leer('index.html');
const util    = leer('css/utilidades.css');
const estilos = leer('css/estilos.css');
const auditJs = leer('js/75-auditoria-flujo.js');
const recJs   = leer('js/91-recetario.js');
const invJs   = leer('js/85-ui-inventario-fisico.js');
const sw      = leer('sw.js');

function slice(src, desdeMarca, hastaMarca) {
    const i = src.indexOf(desdeMarca);
    const j = hastaMarca ? src.indexOf(hastaMarca, i) : src.length;
    return (i === -1) ? '' : src.slice(i, j === -1 ? src.length : j);
}
function funcion(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    const m = /\n        (?:async )?function /.exec(src.slice(ini + 10));
    return m ? src.slice(ini, ini + 10 + m.index) : src.slice(ini);
}

const recetaModal   = slice(html, 'id="recetaModal"', '<!-- Modal Pedido -->');
const orderModal     = slice(html, 'id="orderModal"', '<!-- Toast -->');
const nuevoInvModal  = slice(html, 'id="nuevoInventarioModal"', 'id="regFechaRecuentoModal"');
const regFechaModal  = slice(html, 'id="regFechaRecuentoModal"', '<!-- Modal Inventario -->');
const sinComentarios = function (s) { return s.replace(/<!--[\s\S]*?-->/g, ''); };

const EMOJI_UI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const DEAD_FALLBACK = /var\(--[a-z-]+,\s*#[0-9a-fA-F]{3,6}\)/;

// ═══ 1 · LOS CUATRO MODALES, SIN FALLBACKS MUERTOS ═════════════════════════
[['#recetaModal', recetaModal], ['#orderModal', orderModal],
 ['nuevoInventarioModal', nuevoInvModal], ['regFechaRecuentoModal', regFechaModal]
].forEach(function (par) {
    chk('★ ' + par[0] + ' no tiene valores de reserva hex muertos (var(--x,#hex))',
        !DEAD_FALLBACK.test(par[1]));
});

// ═══ 2 · ORDERMODAL — HOVER Y FONDO A MANO ═════════════════════════════════
chk('★ El hover de "Cancelar" en orderModal usa --border-mid, no rgba(202,196,208,…) suelto',
    /this\.style\.background='var\(--border-mid\)'/.test(orderModal) &&
    !/rgba\(202,\s*196,\s*208/.test(orderModal));
chk('★ "Compartir WhatsApp" usa var(--ok-dim), no rgba(109,213,140,…) a mano',
    /background:var\(--ok-dim\)/.test(orderModal) && !/rgba\(109,\s*213,\s*140/.test(orderModal));
chk('--ok-dim está definido como alias de --green-dim', /--ok-dim:\s*var\(--green-dim\)/.test(estilos));

// ═══ 3 · NUEVOINVENTARIOMODAL — EMOJI E ICONO DE ÁREA ══════════════════════
chk('★ nuevoInventarioModal ya no usa emoji como iconografía (antes: ➕ en "Crear inventario")',
    !EMOJI_UI.test(sinComentarios(nuevoInvModal)));
chk('★ El botón "Crear inventario" usa el icono fa-plus del kit',
    /fa-solid fa-plus" aria-hidden="true"><\/i> Crear inventario/.test(nuevoInvModal));
chk('★ El checklist de áreas del nuevo inventario ya usa areasAuditoriaFA, no el emoji configurable (a.icono)',
    /areasAuditoriaFA\[a\.id\] \|\| 'fa-solid fa-location-dot'/.test(auditJs) &&
    (function () {
        // Sin comentarios: el propio comentario explicativo del cambio
        // menciona "a.icono" al contarlo — lo que no debe existir es el
        // código que de verdad lo usa (misma lección de R6).
        const f = slice(auditJs, "document.getElementById('nuevoInvAreas')", 'var f = document.getElementById(\'nuevoInvFecha\')')
                    .replace(/\/\/[^\n]*/g, '');
        return f.indexOf('a.icono') === -1;
    })());

// ═══ 4 · AVISOS DE FECHA — SIN FALLBACK MUERTO, SIN EMOJI DECORATIVO ═══════
const fNuevoInv    = funcion(auditJs, '_pintarAvisoFechaNuevoInv');
const fRegistrar   = funcion(auditJs, '_pintarAvisoFechaRegistrar');
chk('★ _pintarAvisoFechaNuevoInv() ya no escribe var(--red, #f87171) / var(--amber, #fbbf24) a mano',
    !DEAD_FALLBACK.test(fNuevoInv) && /var\(--red\)/.test(fNuevoInv) && /var\(--amber\)/.test(fNuevoInv));
chk('★ _pintarAvisoFechaNuevoInv() ya no usa emoji decorativo (⚠️/✓) — la palabra ya dice el estado',
    !EMOJI_UI.test(fNuevoInv));
chk('★ _pintarAvisoFechaRegistrar() ya no escribe var(--red, #f87171) a mano ni usa emoji',
    !DEAD_FALLBACK.test(fRegistrar) && !EMOJI_UI.test(fRegistrar) && /var\(--red\)/.test(fRegistrar));
chk('El aviso de fecha sigue deshabilitando el botón cuando la fecha no sirve (no cambió la lógica)',
    /btn\.disabled = true/.test(fNuevoInv) && /btn\.disabled = false/.test(fNuevoInv) &&
    /btn\.disabled = true/.test(fRegistrar) && /btn\.disabled = false/.test(fRegistrar));

// ═══ 5 · RECETAMODAL — EL FORMULARIO DINÁMICO DE INGREDIENTES ═════════════
const fIngList = funcion(recJs, '_recetaRenderIngredientesLista');
chk('★ _recetaRenderIngredientesLista() ya no escribe #dc2626 a mano', !/#dc2626/.test(fIngList));
chk('★ El aviso "No existe en el catálogo" usa el icono fa-triangle-exclamation, no el emoji ⚠️',
    /fa-solid fa-triangle-exclamation" aria-hidden="true"><\/i> No existe en el catálogo/.test(fIngList) &&
    !EMOJI_UI.test(fIngList));
chk('★ El botón de quitar insumo usa fa-xmark, no el glifo "✕"',
    /fa-solid fa-xmark" aria-hidden="true"><\/i><\/button>/.test(fIngList) && !/>✕</.test(fIngList));
chk('fa-triangle-exclamation y fa-xmark están definidos en utilidades.css',
    /\.fa-triangle-exclamation\s*[,{ ]/.test(util) && /\.fa-xmark\s*[,{ ]/.test(util));

// ═══ 6 · LA PESTAÑA RECETARIO (LISTA + FICHA) ══════════════════════════════
const fTab    = funcion(recJs, 'renderRecetarioTab');
// NOTA (buscador unificado, posterior a R7): el pintado de la tarjeta —el
// aviso de vacío, el badge "Inactiva", el color de "Costo incompleto" y el
// uso de costoReceta()— se movió de _renderRecetarioLista() (que ahora solo
// pinta la barra compartida) a _renderRecetarioResultados(). Las violaciones
// que R7 corrigió siguen corregidas; solo cambió qué función las contiene.
const fLista  = funcion(recJs, '_renderRecetarioResultados') || funcion(recJs, '_renderRecetarioLista');
const fFicha  = funcion(recJs, '_renderRecetaFicha');
chk('★ Sin acceso al recetario: candado como icono del kit, no emoji 🔒',
    /fa-solid fa-lock" aria-hidden="true"><\/i> No tienes acceso al recetario/.test(fTab));
chk('★ Recetario vacío: icono fa-book, no emoji 📖',
    /fa-solid fa-book" aria-hidden="true"><\/i> Aún no hay recetas/.test(fLista));
chk('★ El badge "Inactiva" usa superficie neutra del kit, no #4b5563/#fff a mano',
    /background:var\(--card-high\);color:var\(--txt-muted\)/.test(fLista) &&
    !/#4b5563/.test(fLista));
chk('★ "Costo incompleto" en la tarjeta usa var(--warn), no #d97706 a mano',
    /cr\.incompleto \? 'var\(--warn\)' : 'var\(--accent\)'/.test(fLista));
chk('★ "← Volver al recetario" usa fa-chevron-left, como los demás botones Volver de la app',
    /fa-solid fa-chevron-left" aria-hidden="true"><\/i> Volver al recetario/.test(fFicha));
chk('★ Los botones Editar/Activar/Eliminar de la ficha no tienen fallback muerto ni hex a mano',
    !DEAD_FALLBACK.test(fFicha) && !/#dc2626/.test(fFicha) && !/#d97706/.test(fFicha));
chk('★ "Eliminar" usa var(--danger-dim) de borde, no rgba(220,38,38,.35) a mano',
    /border:1px solid var\(--danger-dim\)/.test(fFicha) && !/rgba\(220,\s*38,\s*38/.test(fFicha));
chk('★ La tabla de ingredientes de la ficha usa var(--danger)/var(--warn), sin hex a mano',
    /color:var\(--danger\)/.test(fFicha) && /color:var\(--warn\)/.test(fFicha));
chk('Ningún color hex a mano queda en js/91-recetario.js',
    !/#[0-9a-fA-F]{3,6}\b/.test(recJs.replace(/\/\/[^\n]*/g, '')));

// ═══ 7 · LO QUE NO SE TOCA ══════════════════════════════════════════════════
chk('saveRecetaModal() conserva su validación y su permiso recipe.edit',
    /hasPermission\('recipe\.edit'\)/.test(funcion(recJs, 'saveRecetaModal')));
chk('costoReceta/costoLineaReceta no cambiaron de firma (siguen usándose igual en la ficha)',
    /costoReceta\((r|receta)\)/.test(fLista) && /costoLineaReceta\(ing, producto\)/.test(fFicha));
chk('createOrder() y renderOrderTable() conservan su lógica (el carrito no cambió)',
    /cart\.reduce\(\(sum, item\) => sum \+ item\.quantity, 0\)/.test(funcion(invJs, 'createOrder')) &&
    /orderTotal\.textContent = 'Total: ' \+ total\.toFixed\(2\)/.test(funcion(invJs, 'renderOrderTable')));
chk('El degradado de la cabecera de la tabla de pedidos sigue redirigido a latón (from-purple-600 to-blue-600)',
    /\.from-purple-500, \.from-purple-600, \.from-blue-500 \{ --bi-g1: var\(--brass\); \}/.test(util) &&
    /\.to-orange-500, \.to-blue-600 \{ --bi-g2: var\(--brass-hover\); \}/.test(util));
chk('Los dos avisos de fecha siguen clasificando con clasificarRecuento() (no se tocó la regla de negocio)',
    /clasificarRecuento\(f\.value\)/.test(fNuevoInv) && /clasificarRecuento\(f\.value\)/.test(fRegistrar));
chk('Las notificaciones y confirmaciones de este módulo conservan su emoji (texto plano, no interfaz)',
    /showNotification\('⚠️ No tienes permiso para editar el recetario'\)/.test(recJs) &&
    /showNotification\('✅ Receta guardada/.test(recJs));

// ═══ Versión ═══════════════════════════════════════════════════════════════
const vHtml = (html.match(/\?v=(\d+\.\d+)/) || [])[1];
const vSw   = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vHtml && vHtml === vSw, 'index=' + vHtml + ' sw=' + vSw);
// Comparación por minor, no parseFloat: '5.10' como float da 5.1 y parecería
// MENOR que 5.7 — corrección 4-oct-2026 (ver prueba-redis-r3.js).
chk('La versión avanzó respecto a R6 (≥ 5.7)', Number((vSw || '').split('.')[1]) >= 7, 'es ' + vSw);

// ═══ Resultado ═════════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── REDISEÑO R7 · Recetario y los modales pendientes (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
