#!/usr/bin/env node
/**
 * prueba-redis-r7c.js — REDISEÑO R7c · Ventas · estática (v5.13)
 * ═══════════════════════════════════════════════════════════════════════════
 * js/93-ventas.js llegó al rediseño con la misma deuda que tenía Compras:
 *   · 57 atributos style="…" con tamaños, radios y colores a mano
 *   · 7 colores a mano (#fbbf24, #f87171, #dc2626 + tres rgba(...) de aviso)
 *   · ~25 emoji usados como iconografía (📍 📅 ⏳ 🛑 ⚠️ ℹ️ ✅ 🔒 📈)
 *   · .vt-msg--error / --aviso con un rgba suelto y un fallback muerto
 *     (var(--red-text, var(--red))) en css/estilos.css
 *   · .vt-dia--ok (día con ventas cargadas) con el verde por sí solo: el
 *     color era la única señal.
 *
 * Todo pasa a clases `.vt-*` sobre tokens. Lo que NO se toca: el parseo del
 * reporte de Parrot, validarPeriodoVentas, el cálculo de consumo teórico,
 * los permisos sales.* y las notificaciones (showNotification conserva su
 * emoji: es texto plano, no iconografía de interfaz).
 *
 *   node pruebas/prueba-redis-r7c.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const casos = []; let fallos = 0;
function chk(nombre, ok, detalle) { casos.push({ nombre, ok: !!ok, detalle: detalle || '' }); if (!ok) fallos++; }
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

const js   = leer('js/93-ventas.js');
const css  = leer('css/estilos.css');
const util = leer('css/utilidades.css');
const html = leer('index.html');
const sw   = leer('sw.js');

const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const jsCod = sinComentarios(js);
// Las líneas de showNotification (y su continuación en ternario) conservan emoji.
const lineasUI = jsCod.split('\n').filter(l => !/showNotification|^\s*[?:]\s*'[✅❌]/.test(l)).join('\n');

const EMOJI_UI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]/u;
const bloqueVt = (css.split('/* ── R7c (v5.13)')[1] || '').split('/* ── ')[0];

// ═══ 1 · JS SIN ESTILOS EN LÍNEA NI COLORES A MANO ═════════════════════════
chk('★ 93-ventas.js no tiene ni un atributo style="…" (antes: 57)', !/style\s*=/.test(jsCod), (jsCod.match(/style\s*=/g) || []).length + ' restantes');
chk('★ 93-ventas.js no tiene colores hex a mano (antes #fbbf24 #f87171 #dc2626)', !/#[0-9a-fA-F]{3,6}\b/.test(jsCod));
chk('★ 93-ventas.js no tiene rgba(…) a mano (antes ×6)', !/rgba?\(/.test(jsCod));
chk('93-ventas.js no tiene fallbacks muertos var(--x,#hex)', !/var\(--[a-z-]+,\s*#/.test(jsCod));
chk('★ Ningún emoji de interfaz en 93-ventas.js (las notificaciones sí lo conservan)', !EMOJI_UI.test(lineasUI),
    (lineasUI.match(EMOJI_UI) || []).join(' '));
chk('Las notificaciones (showNotification) conservan su emoji — texto plano, no iconografía',
    /showNotification\('⚠️ No tienes permiso para importar ventas'\)/.test(js) && /showNotification\('❌ Error leyendo el archivo'\)/.test(js));

// ═══ 2 · ICONOS DEL KIT ═════════════════════════════════════════════════════
['location-dot', 'calendar-days', 'hourglass', 'circle-exclamation', 'triangle-exclamation', 'circle-info', 'circle-check', 'lock', 'file-chart-column']
    .forEach(function (ic) {
        chk('fa-' + ic + ' se usa en Ventas y está definido en el kit (utilidades.css)',
            js.indexOf('fa-' + ic) !== -1 && new RegExp('\\.fa-' + ic + '\\s*[,{ ]').test(util));
    });
chk('Todo icono de Ventas va con aria-hidden="true" (decorativo: el texto ya dice lo mismo)',
    (js.match(/<i class="fa-solid fa-[a-z-]+"[^>]*>/g) || []).every(t => /aria-hidden="true"/.test(t)));

// ═══ 3 · CSS: TOKENS, NO COLORES ════════════════════════════════════════════
chk('★ Existe el bloque R7c de Ventas en estilos.css', bloqueVt.length > 500);
chk('★ El bloque R7c no tiene hex a mano ni rgba()', !/#[0-9a-fA-F]{3,6}\b/.test(bloqueVt) && !/rgba?\(/.test(bloqueVt));
chk('El bloque R7c no usa !important', !/!important/.test(bloqueVt));
chk('★ .vt-msg--aviso usa --warn-dim/--warn (antes rgba(246,195,82,…) suelto)',
    /\.vt-msg--aviso \{ background: var\(--warn-dim\); border-color: var\(--warn\); color: var\(--warn\); \}/.test(css));
chk('★ .vt-msg--error usa --danger (antes var(--red-text, var(--red)), fallback muerto)',
    /\.vt-msg--error \{[^}]*color: var\(--danger\);/.test(css) && !/\.vt-msg--error[^}]*var\(--red-text,/.test(css));
chk('★ .vt-dia--ok ya no depende de #00391a ni de un override del tema claro: usa --ok-dim/--ok',
    /\.vt-dia--ok \{ background: var\(--ok-dim\); color: var\(--ok\); border-color: var\(--ok\); \}/.test(css) &&
    !/html\[data-theme="light"\] \.vt-dia--ok/.test(css));
chk('★ El día cargado lleva un icono de check además del color (el color nunca va solo)',
    /vt-dia--ok/.test(js) && /fa-circle-check" aria-hidden="true"><\/i>' : ''\)/.test(js));
chk('Las cifras de las tablas van en IBM Plex Mono, a la derecha',
    /\.vt-num \{[^}]*text-align: right[^}]*IBM Plex Mono/.test(css));
chk('Los radios usan los tokens --r-sm/--r-md/--r-lg, no píxeles sueltos',
    /\.vt-panel \{[^}]*var\(--r-md\)/.test(css) && /\.vt-nota \{[^}]*var\(--r-sm\)/.test(css) && /\.vt-panel--resumen \{[^}]*var\(--r-lg\)/.test(css));
// Toda clase vt-* que usa el JS está definida.
const usadas = new Set(); (js.match(/\bvt-[a-z_-]+/g) || []).forEach(c => usadas.add(c));
const faltan = [...usadas].filter(c => !new RegExp('\\.' + c.replace(/[-_]/g, m => '\\' + m) + '(?![a-z_-])').test(css));
chk('★ Toda clase .vt-* que usa el JS está definida en estilos.css', faltan.length === 0, 'faltan: ' + faltan.join(', '));

// ═══ 4 · LO QUE NO SE TOCÓ ══════════════════════════════════════════════════
chk('renderVentasTab sigue exigiendo sales.read', /hasPermission\('sales\.read'\)/.test(js));
chk('La importación sigue exigiendo sales.import', /hasPermission\('sales\.import'\)/.test(js));
chk('Sin comprobación del servidor no se importa (red de seguridad intacta)', /Sin comprobación del servidor no se importa/.test(js));
chk('confirmarImportacionVentas / cancelarImportacionVentas / _ventasVerIncidencias conservan su nombre',
    /function confirmarImportacionVentas\(/.test(js) && /function cancelarImportacionVentas\(/.test(js) && /function _ventasVerIncidencias\(/.test(js));
chk('El aviso "producto(s) vendidos sin receta" conserva su texto (es la alarma de integridad del consumo)',
    /producto\(s\) vendidos sin receta/.test(js) && /su consumo NO se descuenta de ningún insumo/.test(js));

// ═══ Versión ═══════════════════════════════════════════════════════════════
const vHtml = (html.match(/\?v=(\d+\.\d+)/) || [])[1];
const vSw = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vHtml && vHtml === vSw, 'index=' + vHtml + ' sw=' + vSw);
chk('La versión avanzó (>= 5.13)', Number((vSw || '').split('.')[1]) >= 13, 'es ' + vSw);

const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── REDISEÑO R7c · Ventas (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
