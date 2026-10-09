#!/usr/bin/env node
/**
 * prueba-redis-r8.js — REDISEÑO R8 · barrido global (contraste, CSS muerto,
 * !important, objetivos táctiles, encabezado en celular) · estática
 * ═══════════════════════════════════════════════════════════
 * Qué dejó esta fase (v5.15) y esta prueba protege:
 *   · CONTRASTE: --txt-muted no llegaba a 4.5:1 sobre fondos tintados
 *     (oscuro 3.69, claro 4.29). Tokens corregidos.
 *   · CSS MUERTO: 70 reglas huérfanas (−9 KB) y 32 var(--x, fallback) con
 *     --x definido (fallback inalcanzable). herramientas/css-huerfano.js
 *     queda como guardia: cero huérfanas.
 *   · !important: 44 reglas (88 declaraciones) demostradas innecesarias con
 *     una huella de estilos computados (≈60 propiedades × cada elemento ×
 *     108 estados). La prueba fija un TOPE: el número solo puede bajar.
 *   · ENCABEZADO: los botones de Productos/Recetario/Ventas/Conteo repetían
 *     ~300 caracteres de utilidades y en 390 px la fila desbordaba la pantalla
 *     (documento de 444 px; "Eliminar todos" cortado). Ahora .hd-btn, 44 px,
 *     fila propia en celular.
 *   · MENÚ LATERAL: .sb-item solo tenía flex-shrink:0 hasta 768 px; en
 *     tablet/escritorio las entradas se comprimían a 20 px.
 *   · TÁCTIL/A11Y: botones a 44 px; #sbOverlay aria-hidden; importador de
 *     recetas sin colores a mano; sin .fa-download duplicado.
 *
 * No se tocó ninguna función de negocio ni firestore.rules.
 *   node pruebas/prueba-redis-r8.js
 * ═══════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const casos = []; let fallos = 0;
function chk(nombre, ok, detalle) { casos.push({ nombre, ok: !!ok, detalle: detalle || '' }); if (!ok) fallos++; }

const css = leer('css/estilos.css'), util = leer('css/utilidades.css'), html = leer('index.html'), sw = leer('sw.js');
const j70 = leer('js/70-conversion-render.js'), j92 = leer('js/92-recetario-importar.js');
const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');

// ═══ Contraste de tokens ═════════════════════════════════
function lum(h) { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4)); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const tokenEn = (bloque, nombre) => { const m = new RegExp(nombre + '\\s*:\\s*(#[0-9a-fA-F]{6})').exec(bloque); return m && m[1]; };
const iOscuro = css.indexOf(':root'), iClaro = css.indexOf('html[data-theme="light"]{') >= 0 ? css.indexOf('html[data-theme="light"]{') : css.search(/html\[data-theme="light"\]\s*\{/);
const bOscuro = css.slice(iOscuro, iOscuro + 6000);
const bClaro = css.slice(iClaro, iClaro + 6000);
const mOscuro = tokenEn(bOscuro, '--txt-muted'), mClaro = tokenEn(bClaro, '--txt-muted');
chk('--txt-muted (oscuro) = #A19D96', mOscuro && mOscuro.toUpperCase() === '#A19D96', String(mOscuro));
chk('--txt-muted (claro) = #68635D', mClaro && mClaro.toUpperCase() === '#68635D', String(mClaro));
chk('--txt-muted oscuro ≥ 4.5:1 sobre una tarjeta tintada (#2A2723 aprox.)', mOscuro && ratio(mOscuro, '#2A2723') >= 4.5, mOscuro && ratio(mOscuro, '#2A2723').toFixed(2));
chk('--txt-muted claro ≥ 4.5:1 sobre un fondo tintado (#EFE9DF aprox.)', mClaro && ratio(mClaro, '#EFE9DF') >= 4.5, mClaro && ratio(mClaro, '#EFE9DF').toFixed(2));

// ═══ CSS muerto ═══════════════════════════════════════════
const { huerfanos, leerCorpus } = require('../herramientas/css-huerfano.js');
const h = huerfanos(css, leerCorpus());
chk('Cero reglas huérfanas en estilos.css (herramientas/css-huerfano.js)', h.res.length === 0, h.res.slice(0, 5).map(r => r.sel).join(' | '));
const definidos = new Set(); (css + util).replace(/(--[a-z0-9-]+)\s*:/gi, (m, n) => { definidos.add(n); return m; });
const muertos = []; sinComentarios.replace(/var\(\s*(--[a-z0-9-]+)\s*,\s*([^()]*?(?:\([^()]*\))?[^()]*?)\)/gi, (m, n) => { if (definidos.has(n) && n !== '--sbx-top') muertos.push(m); return m; });
chk('Sin var(--token, fallback) con el token definido (fallback inalcanzable)', muertos.length === 0, muertos.slice(0, 4).join(' | '));
chk('.fa-download definido una sola vez en utilidades.css', (util.match(/^\.fa-download\b/gm) || []).length === 1, String((util.match(/^\.fa-download\b/gm) || []).length));
chk('El bloque viejo de estados de #syncDot (hex) ya no existe', !/#syncDot\[data-state="[a-z]+"\]\s*\{\s*background:\s*(#|rgba)/.test(sinComentarios));

// ═══ Tope de !important (solo puede bajar) ════════════════
const nImp = sinComentarios.split('\n').filter(l => l.includes('!important')).length;
const TOPE_IMPORTANT = 238;
chk('Líneas con !important ≤ ' + TOPE_IMPORTANT + ' (eran 338 antes de R8; el número solo puede bajar)', nImp <= TOPE_IMPORTANT, 'hay ' + nImp);
const bytes = Buffer.byteLength(css);
// v5.18: el presupuesto sube a 195 KB por los módulos Importar y detalle de compras (~6 KB).
// v5.23: sube a 210 KB por el diseño de Inicio y Conteo (tablero, encabezado, hoja de captura: ~9 KB).
chk('estilos.css pesa menos de 210 KB (presupuesto)', bytes < 210 * 1024, Math.round(bytes / 1024) + ' KB');

// ═══ Encabezado ═══════════════════════════════════════════
chk('Los botones del encabezado salen de un solo constructor _hdBtn()', /function _hdBtn\(/.test(j70) && (j70.match(/_hdBtn\(/g) || []).length >= 6);   // v5.18: sin los 3 de importar
const fnHeader = (j70.match(/function updateHeaderActions\(\)[\s\S]*?\n        }\n/) || [''])[0];
chk('updateHeaderActions ya no usa utilidades Tailwind ni degradados', fnHeader && !/bg-gradient|from-purple|from-red|text-xs sm:text-base|px-3 sm:px-6/.test(fnHeader), fnHeader.length + ' chars');
chk('"Eliminar todos" conserva nombre accesible aunque en celular solo muestre el icono', /_hdBtn\('deleteAllProducts\(\)'[^)]*'Eliminar todos los productos'\)/.test(fnHeader));
// v5.18 — los botones de importar (catálogo, recetario, ventas) se movieron al módulo Importar desde Excel.
chk('Acciones intactas: openProductModal, publicarCatalogoFirestore, deleteAllProducts, recetas, Excel', ['openProductModal()', 'publicarCatalogoFirestore()', 'deleteAllProducts()', 'openRecetaModal()', 'publicarRecetarioFirestore()', 'exportarAuditoriaExcel()'].every(a => fnHeader.includes(a)));
chk('v5.18 · el encabezado ya no importa nada: catálogo, recetario y ventas se importan desde el módulo',
    !["document.getElementById('fileInput').click()", 'recetarioImportarExcel()', 'ventasImportarExcel()'].some(a => fnHeader.includes(a)));
chk('CSS .hd-btn: 44 px y colores por token (sin hex)', /\.hd-btn\s*\{[^}]*min-height:\s*44px/.test(css) && !/\.hd-btn[^{]*\{[^}]*#[0-9a-f]{3,6}/i.test(sinComentarios));
chk('En ≤520 px la fila de acciones ocupa su propio renglón', /@media \(max-width: 520px\)\s*\{\s*\.hd-acciones:not\(:empty\)\s*\{[^}]*flex:\s*1 1 100%/.test(css));
chk('La fila del encabezado puede partirse (flex-wrap) y #headerActions usa .hd-acciones', /hd-fila-cab/.test(html) && /id="headerActions" class="hd-acciones"/.test(html) && /\.hd-fila-cab\s*\{[^}]*flex-wrap:\s*wrap/.test(css));
chk('Botón de tema de 44 px (inline y regla)', /width:44px;height:44px/.test(html.slice(html.indexOf('id="themeToggleBtn"'), html.indexOf('id="themeToggleBtn"') + 400)) && /#themeToggleBtn\s*\{\s*width:\s*44px\s*!important/.test(css));

// ═══ Táctil / accesibilidad ═══════════════════════════════
chk('#sbOverlay lleva aria-hidden="true"', /id="sbOverlay"[^>]*aria-hidden="true"/.test(html));
chk('.sb-item conserva su alto en todos los anchos (flex-shrink:0 fuera de media query)', /\n\.sb-item\s*\{\s*flex-shrink:\s*0;\s*\}/.test(css));
const pisos = [['.sbx-chip', /\.sbx-chip\s*\{\s*min-height:\s*44px/], ['.grp-pill', /\.grp-pill\s*\{\s*height:\s*44px/], ['.prd-card__pedido-btn', /\.prd-card__pedido-btn\s*\{\s*min-height:\s*44px/], ['.prd-action-btn', /\.prd-action-btn\s*\{\s*width:\s*44px;\s*height:\s*44px/], ['.sync-pause-btn', /\.sync-pause-btn\s*\{\s*min-height:\s*44px/], ['.audit-rename-btn', /\.audit-rename-btn\s*\{\s*min-height:\s*44px/], ['.pm-btn', /\.pm-btn\s*\{\s*min-height:\s*44px/], ['.sbx__limpiar', /\.sbx__limpiar\s*\{\s*width:\s*44px;\s*height:\s*44px/]];
pisos.forEach(([n, re]) => chk('Objetivo táctil de 44 px: ' + n, re.test(css)));
chk('.sync-pill conserva su dibujo y amplía solo el área sensible (::before)', /\.sync-pill::before\s*\{[^}]*inset:\s*-13px/.test(css));
chk('Botones Guardar/Cancelar de los modales miden 44 px', (html.match(/flex:1;height:44px/g) || []).length >= 6 && !/flex:1;height:40px/.test(html));
chk('Botones de compras e importador de recetas con min-height:44px', !/padding:9px 15px/.test(leer('js/88-compras.js') + j92));
chk('showConfirm: botones Cancelar/Confirmar de 44 px', (j70.match(/padding:0 18px;min-height:44px;/g) || []).length === 2);
chk('Importador de recetas sin colores a mano (hex/rgba) en estilos en línea', !/(#[0-9a-f]{6}|rgba\()/i.test(j92.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));

// ═══ Herramientas y versión ═══════════════════════════════
['herramientas/css-huerfano.js', 'herramientas/quitar-important.js', 'pruebas/_huella-estilos.js'].forEach(f => chk('Existe ' + f, fs.existsSync(path.join(RAIZ, f))));
const vHtml = (html.match(/\?v=(\d+\.\d+)/) || [])[1];
const vSw = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vHtml && vHtml === vSw, 'index=' + vHtml + ' sw=' + vSw);
chk('La versión avanzó (>= 5.15)', Number((vSw || '').split('.')[1]) >= 15, 'es ' + vSw);

const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── REDISEÑO R8 · barrido global (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
