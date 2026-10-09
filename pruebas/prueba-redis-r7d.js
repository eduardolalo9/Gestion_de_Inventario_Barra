#!/usr/bin/env node
/**
 * prueba-redis-r7d.js — REDISEÑO R7d · Historia, Notificaciones, Ajustes,
 * Admin y Roles/Permisos (+ insignia de sincronía y aviso "sin conexión") · estática
 * ═══════════════════════════════════════════════════════════════════════════
 * Lo que había (v5.13) y lo que esta fase deja:
 *   · ERRORES REALES, no solo estéticos
 *       - La pantalla "Usuarios y permisos" usaba tokens que NO existen
 *         (--bg-card, --txt, --blue): el selector de usuario/rol quedaba sin
 *         fondo y la etiqueta "Asignado" sin color.
 *       - Historia/Físico-vs-Sistema usaba var(--border-soft) (no existe) sin
 *         fallback: el borde de cada fila no se pintaba.
 *       - .adm-btn.primary: texto BLANCO sobre latón (~2:1, ilegible).
 *       - .ajuste-btn (Aprobar/Rechazar) de ~24 px de alto; "Leído" con
 *         min-height:auto: por debajo del piso táctil de 44 px.
 *   · Hex a mano: #f59e0b/#fff (aviso sin conexión), #4a1010 (.adm-btn.warn),
 *     #f87171 ×2 (catálogo), seis hex + emoji en la insignia de sincronía,
 *     rgba(...) en role-badge y syncDot.
 *   · ~40 emoji como iconografía (👑 👤 🔔 📝 🔧 ✅ ❌ 🔐 📍 ⚡ 📊 📋 ✏️ 🗑️ 🔍 ☁️ 🔄 ⏳ 📴).
 *
 * Decisiones deliberadas (para que nadie las "corrija"):
 *   · El icono de un ÁREA (a.icono) es un dato que elige el administrador: se
 *     sigue guardando y mostrando tal cual (puede ser un emoji).
 *   · El texto de una notificación guardada en Firestore NO se modifica: el
 *     emoji inicial se limpia solo al pintar, y el icono sale del tipo.
 *   · showNotification y showConfirm conservan su emoji (texto plano de
 *     diálogos/avisos, mismo criterio que R1-R7c).
 *
 * No se tocó: permisos (hasPermission, permisosEfectivos, reglas de Firestore),
 * resolverAjuste, crearNotificacion, ni la lógica de sincronización.
 *
 *   node pruebas/prueba-redis-r7d.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const casos = []; let fallos = 0;
function chk(nombre, ok, detalle) { casos.push({ nombre, ok: !!ok, detalle: detalle || '' }); if (!ok) fallos++; }
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

const roles = leer('js/50-roles-permisos.js');
const hist  = leer('js/85-ui-inventario-fisico.js');
const areas = leer('js/18-areas-config.js');
const datos = leer('js/45-inventario-datos.js');
const conv  = leer('js/70-conversion-render.js');
const busUi = leer('js/06-busqueda-ui.js');
const css   = leer('css/estilos.css');
const util  = leer('css/utilidades.css');
const html  = leer('index.html');
const sw    = leer('sw.js');

const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function funcion(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    const m = /\n        (?:async )?function /.exec(src.slice(ini + 10));
    return sinComentarios(m ? src.slice(ini, ini + 10 + m.index) : src.slice(ini));
}
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]/u;
const HEX = /#[0-9a-fA-F]{3,6}\b/;
const bloque = (css.split('/* ── R7d (v5.14)')[1] || '').split('/* ── fin R7d')[0];

// ═══ 1 · LOS ERRORES REALES ═════════════════════════════════════════════════
const defs = new Set(); (css + util + html).replace(/(--[a-zA-Z0-9-]+)\s*:/g, (_, n) => defs.add(n));
const noDef = [];
[['50', roles], ['85', hist], ['70', conv], ['18', areas], ['45', datos], ['css', css]].forEach(function (par) {
    (par[1].match(/var\((--[a-zA-Z0-9-]+)(?=[,)])/g) || []).forEach(function (u) {
        const n = u.slice(4);
        if (!defs.has(n) && n !== '--sbx-top') noDef.push(par[0] + ':' + n);
    });
});
chk('★ Ningún var(--token) apunta a un token que no existe (antes --bg-card, --txt, --blue, --border-soft, --txt-strong, --amber-text)',
    noDef.length === 0, [...new Set(noDef)].join(', '));
chk('★ La pantalla de permisos ya no usa --bg-card / --txt / --blue',
    !/var\(--(bg-card|txt|blue)\)/.test(roles));
chk('★ .adm-btn.primary usa --accent-on (antes #fff sobre latón)',
    /\.adm-btn\.primary\{background:var\(--accent\);color:var\(--accent-on\)/.test(css));
chk('★ .adm-btn mide ≥ 48 px y ≥ .9rem', /\.adm-btn\{[^}]*min-height:48px[^}]*font-size:\.9rem/.test(css));
chk('★ .ajuste-btn (Aprobar/Rechazar) mide ≥ 44 px', /\.ajuste-btn\{[^}]*min-height:44px/.test(css));

// ═══ 2 · SIN HEX NI EMOJI DE INTERFAZ EN LAS PANTALLAS DE R7d ═══════════════
const piezas = {
    'renderNotificacionesTab': funcion(roles, 'renderNotificacionesTab'),
    'renderAjustesTab': funcion(roles, 'renderAjustesTab'),
    'renderAdminTab': funcion(roles, 'renderAdminTab'),
    'renderUsuariosPermisosTab': funcion(roles, 'renderUsuariosPermisosTab'),
    '_permBadgeEstado': funcion(roles, '_permBadgeEstado'),
    'renderHistoriaTab': funcion(hist, 'renderHistoriaTab'),
    'renderAreasConteoAdmin': funcion(areas, 'renderAreasConteoAdmin'),
    'updateCloudSyncBadge': funcion(datos, 'updateCloudSyncBadge'),
    'updateNetworkStatus': funcion(roles, 'updateNetworkStatus'),
    'applyRoleUI': funcion(roles, 'applyRoleUI')
};
Object.keys(piezas).forEach(function (n) {
    const f = piezas[n];
    // Se admiten emoji solo dentro de showNotification(...) y del icono de área (dato).
    const ui = f.split('\n').filter(l => !/showNotification|a\.icono|value="📍"/.test(l)).join('\n');
    chk('★ ' + n + '() existe y no tiene emoji de interfaz', f.length > 50 && !EMOJI.test(ui), (ui.match(EMOJI) || []).join(' '));
    chk(n + '() no tiene hex a mano, rgba() ni style.cssText', !HEX.test(f) && !/rgba?\(/.test(f) && !/style\.cssText/.test(f));
});
['renderNotificacionesTab', 'renderAjustesTab', 'renderAdminTab', 'renderUsuariosPermisosTab', 'renderHistoriaTab', 'renderAreasConteoAdmin']
    .forEach(n => chk('★ ' + n + '() no tiene atributos style="…"', !/style\s*=/.test(piezas[n]), (piezas[n].match(/style\s*=/g) || []).length + ' restantes'));
chk('El catálogo ya no pinta #f87171 a mano (stock bajo mínimo y botón eliminar)',
    !/#f87171|rgba\(248,\s*113,\s*113/.test(conv));
chk('El vacío del buscador usa fa-magnifying-glass, no 🔍', /sbx-vacio__icono" aria-hidden="true"><i class="fa-solid fa-magnifying-glass">/.test(busUi) && !/🔍/.test(sinComentarios(busUi)));
chk('Historia: sin Tailwind (bg-white/text-gray) ni SVG a mano', !/bg-white|text-gray|<svg/.test(piezas.renderHistoriaTab));
chk('El borde de cada fila de Físico vs Sistema usa --border-mid (antes --border-soft, inexistente)', !/--border-soft/.test(hist + conv));

// ═══ 3 · LO QUE ES DATO NO SE TOCA ══════════════════════════════════════════
chk('★ El icono de un área sigue siendo dato del administrador (se guarda y se muestra tal cual)',
    /escapeHtml\(a\.icono \|\| '📍'\)/.test(piezas.renderAreasConteoAdmin) && /areaNuevaIcono/.test(piezas.renderAreasConteoAdmin));
chk('★ El texto guardado de una notificación NO se modifica: se limpia solo al pintar',
    /function _notifTextoLimpio\(/.test(roles) && /escapeHtml\(_notifTextoLimpio\(n\.texto\)\)/.test(piezas.renderNotificacionesTab) &&
    /crearNotificacion\('ajuste', '📝 Ajuste solicitado: '/.test(roles));
chk('El icono de la notificación sale del TIPO (ajuste, reporte, catálogo, recetario)',
    /ajuste: 'pen-to-square', reporte: 'file-chart-column', catalogo: 'boxes-stacked', recetario: 'book'/.test(roles));
chk('showNotification conserva su emoji (texto plano de aviso)', /showNotification\(\\'⚠️ Selecciona un producto\\'\)/.test(roles));

// ═══ 4 · ICONOS DEL KIT ═════════════════════════════════════════════════════
['bell', 'trash', 'bolt', 'user-shield', 'user', 'pen-to-square', 'list-check', 'circle-check', 'xmark', 'lock', 'location-dot',
 'file-chart-column', 'clock-rotate-left', 'download', 'hourglass', 'circle-exclamation', 'triangle-exclamation', 'arrows-rotate', 'circle-info', 'magnifying-glass', 'pen']
    .forEach(function (ic) {
        chk('fa-' + ic + ' está definido en el kit (utilidades.css)', new RegExp('\\.fa-' + ic + '\\s*[,{ ]').test(util));
    });
const usados = new Set();
[roles, hist, areas, datos].forEach(src => (src.match(/fa-(?:solid fa-)?([a-z][a-z0-9-]+)/g) || []).forEach(m => usados.add(m.replace(/^fa-(solid fa-)?/, '').split(' ')[0])));
const sinKit = [...usados].filter(n => !['solid', 'regular', 'spin', 'fw'].includes(n) && !new RegExp('\\.fa-' + n.replace(/-/g, '\\-') + '\\s*[,{ ]').test(util));
chk('★ Todo icono que usan estas pantallas está en el kit', sinKit.length === 0, sinKit.join(', '));
chk('Todo <i class="fa-solid …"> de estas pantallas va con aria-hidden="true"',
    Object.keys(piezas).every(n => (piezas[n].match(/<i class="fa-solid [^"]*"[^>]*>/g) || []).every(t => /aria-hidden="true"/.test(t))));

// ═══ 5 · CSS ════════════════════════════════════════════════════════════════
chk('★ Existe el bloque R7d en estilos.css', bloque.length > 1500);
chk('★ El bloque R7d no tiene hex, rgba() ni !important', !HEX.test(bloque) && !/rgba?\(/.test(bloque) && !/!important/.test(bloque));
chk('★ La insignia de sincronía usa tokens por estado y no depende de color: lleva icono y palabra',
    /\.sy-insignia\[data-sync="ok"\]\s*\{ color: var\(--ok\)/.test(css) && /\.sy-insignia\[data-sync="error"\]\s*\{ color: var\(--danger\)/.test(css) &&
    /icono: 'triangle-exclamation', text: 'Error sync'/.test(datos) && /icono: 'circle-check',\s+text: 'Sincronizado'/.test(datos));
chk('La insignia ya no se pinta con style.background/borderColor/color ni con hex + "22"', !/badge\.style\.(background|borderColor|color)/.test(datos) && !/c\.bg\b/.test(datos));
chk('index.html: #cloudSyncBadge usa la clase .sy-insignia (sin style="…" ni rgba ni hex)',
    /<div id="cloudSyncBadge" class="sy-insignia"/.test(html) && !/id="cloudSyncBadge"[^>]*style=/.test(html));
chk('El botón de sincronizar ahora mide ≥ 44 px', /\.sy-insignia__btn \{ min-width: 44px; min-height: 44px/.test(css));
chk('★ El aviso sin conexión es una clase (.net-aviso, solo en el sw/app: sobre la barra inferior) con icono y role="status"',
    /bar\.className = 'net-aviso'/.test(piezas.updateNetworkStatus) && /role', 'status'/.test(piezas.updateNetworkStatus) && /\.net-aviso \{[^}]*bottom: calc\(80px/.test(css));
chk('.role-badge.admin y syncDot usan --warn/--warn-dim (sin rgba suelto)', !/\.role-badge\.admin\s*\{[^}]*rgba/.test(css) && !/\.role-badge\.admin\{[^}]*rgba/.test(css) && /#syncDot\[data-state="pending"\] \{ background: var\(--warn\)/.test(css));
chk('★ La regla legada #networkStatus (fondo #78350f con !important, 12 px) desapareció: el aviso es solo .net-aviso', !/#networkStatus\s*\{/.test(css));
chk('.adm-btn.warn ya no usa #4a1010 (el que queda es el override Tailwind legado: R8)', !/\.adm-btn\.warn[^}]*#4a1010/.test(css));
chk('Los radios del bloque usan tokens --r-*', /\.ui-campo \{[^}]*var\(--r-md\)/.test(bloque) && /\.ui-vacio--caja \{[^}]*var\(--r-lg\)/.test(bloque));
chk('Las casillas de permisos miden 24 px y la fila ≥ 48 px', /\.pr-fila \{[^}]*min-height: 48px/.test(bloque) && /\.pr-fila input\[type="checkbox"\] \{ width: 24px; height: 24px/.test(bloque));
const usadas = new Set(); [roles, hist, areas].forEach(src => (src.match(/\b(?:ui|nt|aj|pr|hs|sy)-[a-z_-]*[a-z]/g) || []).forEach(c => usadas.add(c)));
const faltan = [...usadas].filter(c => !new RegExp('\\.' + c.replace(/[-_]/g, m => '\\' + m) + '(?![a-z_-])').test(css));
chk('★ Toda clase ui-/nt-/aj-/pr-/hs-/sy- que usa el JS está definida en estilos.css', faltan.length === 0, 'faltan: ' + faltan.join(', '));

// ═══ 6 · LÓGICA DE NEGOCIO SIN CAMBIOS ═════════════════════════════════════
chk('resolverAjuste y solicitarAjuste conservan su firma', /async function resolverAjuste\(/.test(roles) && /async function solicitarAjuste\(/.test(roles));
chk('Aprobar/Rechazar siguen llamando resolverAjuste(id, estado) con id validado (FASE 7 S2)',
    /resolverAjuste\(\\'' \+ idSeg \+ '\\',\\'aprobado\\'\)/.test(roles) && /\^\[A-Za-z0-9\]\{1,40\}\$/.test(roles));
chk('Usuarios y permisos sigue exigiendo permissions.read', /hasPermission\('permissions\.read'\)/.test(piezas.renderUsuariosPermisosTab));
chk('El panel Admin sigue exigiendo isAdmin()', /if \(!isAdmin\(\)\) return/.test(piezas.renderAdminTab));
chk('Las áreas de conteo siguen exigiendo warehouses.read', /hasPermission\('warehouses\.read'\)/.test(piezas.renderAreasConteoAdmin));
chk('El semáforo #syncDot conserva data-state y aria-label', /dot\.setAttribute\('data-state', c\.dotState\)/.test(piezas.updateCloudSyncBadge) && /dot\.setAttribute\('aria-label'/.test(piezas.updateCloudSyncBadge));
chk('Sin Firebase, la insignia cae en "none" (no inventa un estado)', /if \(!_db\) \{ status = 'none'; \}/.test(piezas.updateCloudSyncBadge));

// ═══ Versión ═══════════════════════════════════════════════════════════════
const vHtml = (html.match(/\?v=(\d+\.\d+)/) || [])[1];
const vSw = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vHtml && vHtml === vSw, 'index=' + vHtml + ' sw=' + vSw);
chk('La versión avanzó (>= 5.14)', Number((vSw || '').split('.')[1]) >= 14, 'es ' + vSw);

const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── REDISEÑO R7d · Historia, Notificaciones, Ajustes, Admin y Roles (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
