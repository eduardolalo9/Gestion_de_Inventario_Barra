#!/usr/bin/env node
/**
 * prueba-redis-r5.js — REDISEÑO R5 · Inventario y áreas · estática
 * ═══════════════════════════════════════════════════════════════════════════
 * R5 re-pinta las pantallas de Inventario Físico que R1-R4 no habían tocado
 * todavía: Historial, Físico vs Sistema, el detalle de un inventario cerrado,
 * el panel de administración en vivo, la comparación entre dispositivos y las
 * tres pantallas de Reconteo. NINGUNA lógica de negocio cambia: mismos id,
 * mismos permisos, mismo cálculo. Lo que cambia es que dejan de usar el
 * envoltorio Tailwind crudo (bg-white rounded-xl…), el hex escrito a mano
 * (#16a34a, #ef4444, color:#fff) y el emoji como iconografía.
 *
 *   1  ★ Las tres pantallas grandes (Historial, Físico vs Sistema, Detalle
 *        cerrado) usan la tarjeta del kit (.if-card), no el envoltorio
 *        Tailwind de antes de R1.
 *   2  ★ Ni un hex de color escrito a mano en las zonas tocadas: todo pasa
 *        por los tokens del sistema (var(--ok), var(--danger), var(--accent-on)…).
 *   3  ★ El "← Volver" de las tres pantallas usa el botón del kit
 *        (.audit-back-btn), el mismo que ya usaba Reconteo.
 *   4  ★ Ya no queda emoji como iconografía en las zonas de R5: historial,
 *        físico vs sistema, detalle cerrado, panel admin, comparación entre
 *        dispositivos, trail de auditoría y las tres pantallas de Reconteo.
 *   5  ★ Todo icono que se pide está definido en utilidades.css.
 *   6    Los avisos de texto (showNotification/showConfirm) y los mensajes
 *        de WhatsApp no se tocan: siguen siendo lógica o texto plano para
 *        otra app, no interfaz de BarInventory.
 *
 *   node pruebas/prueba-redis-r5.js
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
const inv   = leer('js/85-ui-inventario-fisico.js');
const multi = leer('js/10-multiusuario.js');
const rc    = leer('js/87-reconteo.js');
const sw    = leer('sw.js');

// Recorta cada función objetivo por su nombre, hasta la siguiente función al
// mismo nivel de indentación de 8 espacios (el patrón que usa todo el archivo).
function funcion(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    const m = /\n        (?:async )?function /.exec(src.slice(ini + 10));
    return m ? src.slice(ini, ini + 10 + m.index) : src.slice(ini);
}

const fHistorial = funcion(inv, 'renderHistorialInventarios');
const fFvsRes     = funcion(inv, '_renderFvsResultados');
const fFvsPant    = funcion(inv, 'renderFisicoVsSistema');
const fDetalle    = funcion(inv, 'renderDetalleInventarioCerrado');
const fAdminPanel = funcion(inv, '_renderAdminUsersPanel');
const fComparar   = funcion(multi, 'renderAuditComparePanel');
const fTrail      = funcion(multi, 'renderAuditTrailForProduct');

// ═══ 1 · LAS TRES PANTALLAS GRANDES USAN LA TARJETA DEL KIT ════════════════
chk('★ Historial ya no usa el envoltorio Tailwind crudo de antes de R1',
    !/bg-white rounded-xl p-4/.test(fHistorial) && /<div class="audit-screen"><div class="if-card">/.test(fHistorial));
chk('★ Físico vs Sistema usa if-card (ya lo usaba desde FASE 11B, R5 solo re-pinta el interior)',
    /<div class="audit-screen"><div class="if-card">/.test(fFvsPant));
chk('★ El detalle de un inventario cerrado ya no usa el envoltorio Tailwind crudo',
    !/bg-white rounded-xl p-4/.test(fDetalle) && /<div class="if-card">/.test(fDetalle));
chk('El panel de administración en vivo usa if-card, no un div con estilo en línea',
    !/background:var\(--surface\);border:1px solid var\(--border\);border-radius:var\(--r-lg\);padding:14px;margin-bottom:16px;/.test(fAdminPanel) &&
    /<div class="if-card">/.test(fAdminPanel));

// ═══ 2 · NI UN HEX ESCRITO A MANO EN LAS ZONAS TOCADAS ═════════════════════
const HEX_PROHIBIDO = /#(16a34a|ef4444|22c55e|f59e0b|fff\b)/i;
chk('★ Historial no tiene hex escrito a mano (antes: #16a34a para CERRADO)',
    !HEX_PROHIBIDO.test(fHistorial));
chk('★ Físico vs Sistema no tiene hex escrito a mano (antes: #ef4444 / #16a34a)',
    !HEX_PROHIBIDO.test(fFvsRes) && !HEX_PROHIBIDO.test(fFvsPant));
chk('★ El detalle cerrado no tiene hex escrito a mano (antes: color:#fff, var(--amber,#f59e0b))',
    !HEX_PROHIBIDO.test(fDetalle) && !/var\(--amber,#f59e0b\)/.test(fDetalle));
chk('El panel admin no tiene el verde #22c55e escrito a mano (EN VIVO)',
    !HEX_PROHIBIDO.test(fAdminPanel));
chk('★ .audit-live-dot usa el token --ok, no #22c55e',
    /\.audit-live-dot\s*\{[^}]*background:\s*var\(--ok\)/.test(esti),
    'el punto "EN VIVO" era un verde de Tailwind escrito a mano');
chk('.rc-area--corregida y .rc-estado--abierto usan --warn-dim, no el ámbar de Tailwind en rgba',
    /\.rc-area--corregida \{ border-color: var\(--amber\); background: var\(--warn-dim\); \}/.test(esti) &&
    /\.rc-estado--abierto \{ background: var\(--warn-dim\); color: var\(--amber\); \}/.test(esti));
chk('.audit-area-status.pendiente usa --warn-dim, no rgba(245,158,11,…) escrito a mano',
    /\.audit-area-status\.pendiente \{\s*background: var\(--warn-dim\);/.test(esti));
/**
 * BUG REAL, encontrado por captura de pantalla: con un título largo a dos
 * líneas ("Historial de Inventarios Físicos"), el icono de ".audit-back-btn"
 * no tenía mínimo propio en el layout flex y se encogía a 0 px — el botón
 * "Volver" se veía sin flecha. Corregido con flex-shrink:0 en el botón y en
 * su icono.
 */
chk('★ .audit-back-btn protege su icono de encogerse a 0 px (flex-shrink)',
    /\.audit-back-btn \{[^}]*flex-shrink:\s*0/.test(esti) && /\.audit-back-btn i \{ flex-shrink: 0; \}/.test(esti));

// ═══ 3 · "← VOLVER" CON EL BOTÓN DEL KIT ═══════════════════════════════════
['fHistorial', 'fFvsPant', 'fDetalle'].forEach(function (nombreVar) {
    const src = { fHistorial, fFvsPant, fDetalle }[nombreVar];
    chk('★ ' + nombreVar.replace('f', '') + ' usa .audit-back-btn, no un botón con estilo en línea',
        /class="audit-back-btn"/.test(src) && !/background:var\(--bg-soft\);font-size:0\.7rem/.test(src));
});

// ═══ 4 · YA NO QUEDA EMOJI COMO ICONOGRAFÍA EN LAS ZONAS DE R5 ═════════════
// Nota: se excluyen a propósito los avisos de texto (showNotification,
// showConfirm) y los mensajes de WhatsApp, que no son interfaz de la app.
const EMOJI_UI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
[
    ['Historial', fHistorial], ['Físico vs Sistema (resultados)', fFvsRes],
    ['Físico vs Sistema (pantalla)', fFvsPant], ['Detalle cerrado', fDetalle],
    ['Panel admin en vivo', fAdminPanel], ['Comparación entre dispositivos', fComparar],
    ['Trail de auditoría', fTrail]
].forEach(function (par) {
    chk('★ ' + par[0] + ' ya no usa emoji como iconografía', !EMOJI_UI.test(par[1]));
});
chk('★ Las tres pantallas de Reconteo ya no usan emoji como iconografía',
    !EMOJI_UI.test(funcion(rc, 'renderReconteo')) &&
    !EMOJI_UI.test(funcion(rc, 'renderReconteoHistorial')) &&
    !EMOJI_UI.test(funcion(rc, 'renderReconteoDetalle')) &&
    !EMOJI_UI.test(funcion(rc, '_rcTarjetaHtml')) &&
    !EMOJI_UI.test(funcion(rc, '_rcPieHtml')) &&
    !EMOJI_UI.test(funcion(rc, '_rcResultadosHtml')));
chk('El badge ⚠️ DIFERENCIA / ✓ OK del trail ahora usa iconos del kit',
    /fa-triangle-exclamation[^;]*;? ?<\/i> DIFERENCIA/.test(fTrail) || /fa-triangle-exclamation" aria-hidden="true"><\/i> DIFERENCIA/.test(fTrail) ||
    /fa-triangle-exclamation" aria-hidden="true"><\/i>\s*DIFERENCIA/.test(fTrail),
    'ya no debe quedar el carácter ⚠️ ni el ✓ sueltos');
chk('El badge de comparación (⚠️ diferencias / ✓ OK) ahora usa iconos del kit',
    /fa-triangle-exclamation" aria-hidden="true"><\/i>/.test(fComparar) &&
    /fa-circle-check" aria-hidden="true"><\/i>/.test(fComparar));

// ═══ 5 · TODO ICONO PEDIDO ESTÁ DEFINIDO ═══════════════════════════════════
const pedidos = new Set();
[html, inv, multi, rc].forEach(function (src) {
    const re = /\bfa-(?!solid\b|regular\b|fw\b|spin\b)[a-z][a-z0-9-]*/g;
    let m;
    while ((m = re.exec(src)) !== null) pedidos.add(m[0]);
});
const faltan = Array.from(pedidos).filter(function (ic) {
    return !new RegExp('\\.' + ic + '\\s*[,{ ]').test(util);
});
chk('★ Todo icono que se pide está definido en utilidades.css', faltan.length === 0, 'sin definir: ' + faltan.join(', '));
chk('★ Los iconos nuevos de R5 están definidos',
    ['fa-plus', 'fa-book', 'fa-calendar-days', 'fa-clock-rotate-left', 'fa-circle-info',
     'fa-download', 'fa-folder-open', 'fa-eye', 'fa-clock']
        .every(function (ic) { return new RegExp('\\.' + ic + '\\s*[,{ ]').test(util); }));

// ═══ 6 · LO QUE NO SE TOCA ══════════════════════════════════════════════════
chk('Los avisos de texto con ⚠️ para isCritical() siguen intactos (son lógica, no adorno)',
    /message\.startsWith\('⚠️'\)/.test(leer('js/70-conversion-render.js')));
chk('Los mensajes de WhatsApp conservan sus emoji (texto plano para otra app)',
    /\u{1F4E6} \*Total Enteras:\*/u.test(inv));
chk('El permiso del historial (inventory.history) no cambió',
    /renderHistorialInventarios/.test(inv) && /hasPermission\('inventory\.history'\)/.test(inv));
chk('El permiso de Físico vs Sistema (inventory.viewAll) no cambió',
    /function renderFisicoVsSistema\(\) \{\s*if \(!hasPermission\('inventory\.viewAll'\)\)/.test(inv));
chk('Contabilizar desde el detalle cerrado sigue llamando a la misma función, con los mismos argumentos',
    fDetalle.indexOf('onclick="contabilizarInventario(\\\'\' + _detalleInventarioCerradoId + \'\\\', \' + meta.numero + \')"') !== -1);

// ═══ Versión ═══════════════════════════════════════════════════════════════
const vHtml = (html.match(/\?v=(\d+\.\d+)/) || [])[1];
const vSw   = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vHtml && vHtml === vSw, 'index=' + vHtml + ' sw=' + vSw);
// Comparación por minor, no parseFloat: '5.10' como float da 5.1 y parecería
// MENOR que 5.4 — corrección 4-oct-2026 (ver prueba-redis-r3.js).
chk('La versión avanzó respecto a R4 (≥ 5.4)', Number((vSw || '').split('.')[1]) >= 4, 'es ' + vSw);

// ═══ Resultado ═════════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── REDISEÑO R5 · Inventario y áreas (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
