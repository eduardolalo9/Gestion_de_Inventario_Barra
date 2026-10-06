#!/usr/bin/env node
/**
 * prueba-redis-r7b.js — REDISEÑO R7b · Compras (y Pedidos, revisado) · estática
 * ═══════════════════════════════════════════════════════════════════════════
 * R7 dejó anotado "Pedidos (la lista) y Compras" como pendiente, con la duda
 * de si `renderPedidosTab()`/`_renderPedidosResultados()` (js/70-conversion-
 * render.js) tenían las mismas violaciones que el resto del rediseño.
 *
 * Al revisarlas a fondo: NO las tienen. Ya usan clases Tailwind de gradiente
 * (from-red-500/to-orange-600, from-green-500/to-emerald-500, from-purple-600/
 * to-blue-600) que R1 ya redirige a los tokens del kit en css/utilidades.css,
 * y no tienen un solo emoji de interfaz ni un color hex a mano. R7b no les
 * cambia una línea — esta prueba lo deja comprobado en vez de asumido.
 *
 * El trabajo real de R7b está en js/88-compras.js:
 *   1  ★ Los cuatro colores a mano del flujo de importación
 *      (#fbbf24/#f87171/#065f46/#86efac, con sus rgba(...) de fondo y borde)
 *      → var(--warn)/var(--warn-dim), var(--danger)/var(--danger-dim),
 *      var(--ok)/var(--ok-dim) — los mismos alias que ya usa el resto de la
 *      app para exactamente estos tres estados.
 *   2  ★ Emoji como iconografía en renderVistaPreviaCompras/
 *      renderIncidenciasImportacion/renderComprasTab (⚠️ ×2, 🛑, 💲, 📦) →
 *      iconos del kit (fa-triangle-exclamation, fa-circle-exclamation,
 *      fa-coins, fa-receipt). fa-circle-exclamation y fa-coins se eligieron
 *      porque YA significan exactamente esto en el panel (js/83-panel.js):
 *      fa-circle-exclamation para un aviso que bloquea, fa-coins para
 *      "Valor en existencia" (dinero). fa-receipt porque el panel ya lo usa
 *      para "Compras esta semana" — el mismo concepto, la misma pantalla.
 *
 * Lo que NO se tocó: _diferenciasDeCosto, _resumenCompras, _comprasOrdenadas,
 * el parseo del Excel de SAP (handleFileImport, _normCabCompras,
 * _findColCompras), los permisos purchases.read/create/import, y las
 * notificaciones (showNotification) de este módulo — siguen con su emoji,
 * porque son avisos de texto plano, no iconografía de interfaz (mismo
 * criterio que R1-R7).
 *
 *   node pruebas/prueba-redis-r7b.js
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
const convJs  = leer('js/70-conversion-render.js');
const compJs  = leer('js/88-compras.js');
const sw      = leer('sw.js');

function funcion(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    const m = /\n        (?:async )?function /.exec(src.slice(ini + 10));
    return m ? src.slice(ini, ini + 10 + m.index) : src.slice(ini);
}
const sinComentarios = function (s) { return s.replace(/\/\/[^\n]*/g, ''); };

const EMOJI_UI      = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const DEAD_FALLBACK = /var\(--[a-z-]+,\s*#[0-9a-fA-F]{3,6}\)/;
const HEX_A_MANO    = /#[0-9a-fA-F]{3,6}\b/;

// ═══ 1 · PEDIDOS — YA ESTABA LIMPIO (se comprueba, no se asume) ════════════
const fPedTab = funcion(convJs, 'renderPedidosTab');
const fPedRes = funcion(convJs, '_renderPedidosResultados');
chk('★ renderPedidosTab() no tiene emoji de interfaz ni color hex a mano',
    !EMOJI_UI.test(sinComentarios(fPedTab)) && !HEX_A_MANO.test(sinComentarios(fPedTab)));
chk('★ _renderPedidosResultados() tampoco — ya redirige sus gradientes Tailwind a latón',
    !EMOJI_UI.test(sinComentarios(fPedRes)) && !HEX_A_MANO.test(sinComentarios(fPedRes)));
chk('El botón "Eliminar todos los pedidos" sigue redirigiendo from-red-500/to-orange-600 a los tokens de alerta',
    /\.from-red-500 \{ --bi-g1: var\(--danger\); \}/.test(util) && /\.to-orange-600 \{ --bi-g2: var\(--warn\); \}/.test(util));
chk('El botón de WhatsApp del pedido sigue redirigiendo from-green-500/to-emerald-500 a --ok',
    /\.from-green-500 \{ --bi-g1: var\(--ok\); \}/.test(util) && /\.to-emerald-500 \{ --bi-g2: var\(--ok\); \}/.test(util));

// ═══ 2 · COMPRAS — LOS CUATRO COLORES A MANO, AHORA TOKENIZADOS ════════════
const fVista = funcion(compJs, 'renderVistaPreviaCompras');
const fInc   = funcion(compJs, 'renderIncidenciasImportacion');
const fTab   = funcion(compJs, 'renderComprasTab');
[['renderVistaPreviaCompras', fVista], ['renderIncidenciasImportacion', fInc], ['renderComprasTab', fTab]]
    .forEach(function (par) {
        chk('★ ' + par[0] + '() no tiene ni un color hex a mano (ni #fbbf24/#f87171/#065f46/#86efac ni ningún otro)',
            !HEX_A_MANO.test(sinComentarios(par[1])));
        chk('★ ' + par[0] + '() no tiene fallback muerto (var(--x,#hex))',
            !DEAD_FALLBACK.test(par[1]));
    });
chk('El aviso de "precio de lista" usa var(--warn-dim)/var(--warn), no rgba(251,191,36,…) a mano',
    /background:var\(--warn-dim\);border:1px solid var\(--warn-dim\);'\s*\+\s*'color:var\(--warn\)/.test(fVista) &&
    !/rgba\(251,\s*191,\s*36/.test(fVista));
chk('El aviso de "fecha no reconocible" usa var(--danger-dim)/var(--danger), no rgba(239,68,68,…) a mano',
    /background:var\(--danger-dim\);border:1px solid var\(--danger-dim\);color:var\(--danger\)/.test(fVista) &&
    !/rgba\(239,\s*68,\s*68/.test(fVista));
chk('"Confirmar e importar" usa var(--ok-dim)/var(--ok), no #065f46/#86efac a mano',
    /background:var\(--ok-dim\);'\s*\+\s*'border:1px solid var\(--ok-dim\);color:var\(--ok\)/.test(fVista));
// v5.18 — "Importar entrada de mercancía" se movió al módulo Importar desde Excel.
chk('v5.18 · la pestaña ya no tiene botón de importar (vive en el módulo Importar)',
    !/comprasImportarExcel\(\)/.test(fTab) && /comprasImportarExcel\(\)/.test(fs.readFileSync(path.join(RAIZ, 'js/96-importar.js'), 'utf8')));

// ═══ 3 · COMPRAS — SIN EMOJI COMO ICONOGRAFÍA ══════════════════════════════
chk('★ Ningún emoji de interfaz queda en renderVistaPreviaCompras/renderIncidenciasImportacion/renderComprasTab',
    !EMOJI_UI.test(sinComentarios(fVista)) && !EMOJI_UI.test(sinComentarios(fInc)) && !EMOJI_UI.test(sinComentarios(fTab)));
chk('El aviso de "precio de lista" usa fa-triangle-exclamation',
    /fa-solid fa-triangle-exclamation" aria-hidden="true"><\/i> El costo que trae este archivo/.test(fVista));
chk('★ El aviso de "fecha no reconocible" usa fa-circle-exclamation — el mismo icono que el panel usa para un aviso que bloquea',
    /fa-solid fa-circle-exclamation" aria-hidden="true"><\/i> ' \+ conFechaInvalida/.test(fVista));
chk('La incidencia por grupo usa fa-triangle-exclamation',
    /fa-solid fa-triangle-exclamation" aria-hidden="true"><\/i> ' \+ g\.incidencias\.length/.test(fVista));
chk('★ "Costo distinto al catálogo" usa fa-coins — el mismo icono que el panel usa para "Valor en existencia"',
    /fa-solid fa-coins" aria-hidden="true"><\/i> ' \+ diferencias\.length/.test(fVista));
chk('★ El vacío de Compras usa fa-receipt — el mismo icono que el panel ya usa para "Compras esta semana"',
    /fa-solid fa-receipt" aria-hidden="true">/.test(fTab));
chk('fa-circle-exclamation, fa-coins y fa-receipt están definidos en el kit (utilidades.css)',
    /\.fa-circle-exclamation\s*[,{ ]/.test(util) && /\.fa-coins\s*[,{ ]/.test(util) && /\.fa-receipt\s*[,{ ]/.test(util));

// ═══ 4 · LO QUE NO SE TOCÓ ══════════════════════════════════════════════════
chk('_diferenciasDeCosto() conserva su cálculo (±1% contra el precio del catálogo, nunca inventado)',
    /Math\.abs\(pct\) >= 1/.test(funcion(compJs, '_diferenciasDeCosto')) &&
    /if \(!prod \|\| typeof prod\.precio !== 'number' \|\| prod\.precio <= 0\) return;/.test(funcion(compJs, '_diferenciasDeCosto')));
chk('Los permisos purchases.read/purchases.import/purchases.create siguen gateando lo mismo que antes',
    /hasPermission\('purchases\.read'\)/.test(fTab) &&
    /permiso: 'purchases\.import'/.test(fs.readFileSync(path.join(RAIZ, 'js/96-importar.js'), 'utf8')) &&   // v5.18: en el módulo
    /hasPermission\('purchases\.create'\)/.test(fTab));
chk('Las notificaciones de este módulo conservan su emoji (texto plano, no interfaz)',
    /showNotification\('⚠️ No tienes permiso para importar compras'\)/.test(compJs) &&
    /showNotification\('❌ Error leyendo el archivo'\)/.test(compJs));
chk('confirmarImportacionCompras/cancelarImportacionCompras/comprasImportarExcel no cambiaron de nombre',
    /function confirmarImportacionCompras\(/.test(compJs) &&
    /function cancelarImportacionCompras\(/.test(compJs) &&
    /function comprasImportarExcel\(/.test(compJs));

// ═══ Versión ═══════════════════════════════════════════════════════════════
const vHtml = (html.match(/\?v=(\d+\.\d+)/) || [])[1];
const vSw   = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vHtml && vHtml === vSw, 'index=' + vHtml + ' sw=' + vSw);
// Comparación por minor, no parseFloat: '5.10' como float da 5.1 y parecería
// MENOR que 5.9 — corrección 4-oct-2026 (ver prueba-redis-r3.js).
chk('La versión avanzó respecto al buscador unificado del Recetario (≥ 5.9)', Number((vSw || '').split('.')[1]) >= 9, 'es ' + vSw);

// ═══ Resultado ═════════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── REDISEÑO R7b · Compras (y Pedidos, revisado) (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
