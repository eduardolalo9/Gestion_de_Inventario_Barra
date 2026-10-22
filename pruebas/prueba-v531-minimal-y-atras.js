#!/usr/bin/env node
/**
 * prueba-v531-minimal-y-atras.js — v5.31 · Tema minimalista claro y botón
 * Atrás de Android (estática + lógica de navegacionAtras en una sandbox)
 * ═══════════════════════════════════════════════════════════════════════════
 * Encargo de Eduardo (20-oct-2026): mismas funciones, apariencia minimalista
 * clara (Apple/Notion, esmeralda bosque) y Atrás de Android resuelto. Solo
 * dos tipos de cambio autorizados: presentación y la navegación Atrás.
 *   node pruebas/prueba-v531-minimal-y-atras.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

const css = leer('css/tema-minimal.css'), idx = leer('index.html'), sw = leer('sw.js'), esti = leer('css/estilos.css');
const nav = leer('js/98-navegacion-atras.js');
const sinCom = css.replace(/\/\*[\s\S]*?\*\//g, '');

// ═══ 1 · Carga y alcance ═══════════════════════════════════════════════════
chk('tema-minimal.css se carga DESPUÉS de estilos.css', idx.indexOf('href="css/estilos.css') > 0 && idx.indexOf('href="css/tema-minimal.css') > idx.indexOf('href="css/estilos.css'));
chk('Las hojas de cristal (v5.29 / v5.30) ya no existen ni se cargan',
    !fs.existsSync(path.join(RAIZ, 'css/tema-cristal.css')) && !fs.existsSync(path.join(RAIZ, 'css/tema-inicio.css')) && !/tema-cristal|tema-inicio/.test(idx + sw));
chk('sw.js precalienta la hoja y el módulo nuevo (PRECACHE sin cambios)',
    /'\.\/css\/tema-minimal\.css\?v=' \+ APP_VERSION/.test(sw) && /'\.\/js\/98-navegacion-atras\.js\?v=' \+ APP_VERSION/.test(sw) && !/PRECACHE_URLS\s*=\s*\[[^\]]*(tema-minimal|98-navegacion)/.test(sw));
chk('estilos.css no se tocó (sigue en su tope)', Buffer.byteLength(esti) <= 215000);
chk('★ Oscuro sobrio = el de v5.25: esta hoja NO redefine :root (no hay bloque de tokens del oscuro)', !/^:root\s*\{/m.test(sinCom));
chk('★ Sin cristal: ni desenfoque ni fondo fijo', !/backdrop-filter|body::before|--fondo-cristal|--vidrio/.test(sinCom));

// ═══ 2 · Tokens del claro: valores y contraste ═════════════════════════════
const bClaro = (/^html\[data-theme="light"\] \{([\s\S]*?)\n\}/m.exec(sinCom) || [])[1] || '';
const reglas = sinCom.replace(/^html\[data-theme="light"\] \{[\s\S]*?\n\}/m, '');
chk('★ Fuera del bloque de tokens no hay hex ni rgba a mano', bClaro.length > 800 && !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(reglas.replace(/#bottomTabBar\b/g, '')));
const tok = n => (new RegExp('--' + n + ':\\s*(#[0-9A-Fa-f]{6})').exec(bClaro) || [])[1];
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
chk('Tarjetas blancas sobre fondo blanco cálido / gris perla', tok('card') === '#FFFFFF' && lum(tok('bg')) > 0.9 && tok('bg') !== '#FFFFFF');
chk('Verde esmeralda bosque como color corporativo', tok('accent') === '#17694B');
['txt-primary', 'txt-secondary', 'txt-muted', 'accent'].forEach(t =>
    chk('Contraste ' + t + ' >= 4.5:1 sobre la superficie más oscura (' + tok('surface') + ')', tok(t) && cr(tok(t), tok('surface')) >= 4.5, tok(t) + ' ' + (tok(t) ? cr(tok(t), tok('surface')).toFixed(2) : '')));
chk('Botón esmeralda con texto blanco >= 4.5:1', cr(tok('accent-on'), tok('accent')) >= 4.5);
chk('Texto gris carbón (no negro puro)', tok('txt-primary') === '#1F2321');

// ═══ 3 · Solo presentación: lo que se añade es CSS ═════════════════════════
chk('★ Acciones con texto ("Editar", "Eliminar", "Carrito") vía ::after, solo en pantallas >= 600 px',
    /@media \(min-width: 600px\) \{[\s\S]*\.prd-action-btn\.del::after\s*\{ content: "Eliminar"; \}[\s\S]*\.cat-tabla button\[title="Eliminar"\]::after/.test(css));
chk('La hoja no oculta ninguna acción (sin display:none ni visibility sobre botones)', !/(button|\.bt|btn|-btn)[^{]*\{[^}]*(display:\s*none|visibility:\s*hidden)/.test(reglas));
chk('La hoja no usa ids de la app salvo la barra inferior', (reglas.match(/#[A-Za-z][\w-]*/g) || []).every(x => x === '#bottomTabBar'), (reglas.match(/#[A-Za-z][\w-]*/g) || []).join(' '));

// ═══ 4 · Navegación Atrás: estructura ═════════════════════════════════════
chk('Módulo aislado js/98-navegacion-atras.js cargado antes del arranque', idx.indexOf('js/98-navegacion-atras.js') > 0 && idx.indexOf('js/98-navegacion-atras.js') < idx.indexOf('js/99-window-arranque.js'));
chk('★ Un solo listener de popstate, protegido contra doble inicio', (nav.match(/addEventListener\('popstate'/g) || []).length === 1 && /if \(_navAtras\.iniciado\) return;/.test(nav));
chk('★ Nunca más de una guardia: solo pushState de { bi: "guardia" } y replaceState de la base',
    (nav.match(/history\.pushState\(/g) || []).length === 1 && /history\.pushState\(\{ bi: 'guardia' \}/.test(nav) && /history\.replaceState\(\{ bi: 'base' \}/.test(nav));
chk('La guardia se pone tras la primera interacción (Chrome salta las entradas sin interacción)', /addEventListener\('pointerdown', _navAlInteractuar, true\)/.test(nav));
chk('★ Cierra modales con sus funciones de siempre (no las redefine)',
    ['closeProductModal', 'closeOrderModal', 'closeInventarioModal', 'closeRecetaModal', 'cerrarModalNuevoInventario', 'cerrarModalRegistrarFechaRecuento', 'comprasCerrarDetalle', 'cerrarFichaProducto', 'sbClose']
        .every(f => nav.includes("'" + f + "'") && !new RegExp('function ' + f + '\\(').test(nav)));
chk('★ El módulo no redefine ninguna función existente de la app',
    !(nav.match(/function ([A-Za-z_$][\w$]*)\(/g) || []).map(x => x.slice(9, -1)).some(n => {
        return fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f !== '98-navegacion-atras.js' && f.endsWith('.js'))
                 .some(f => new RegExp('function ' + n.replace('$', '\\$') + '\\(').test(leer('js/' + f)));
    }));
chk('No escribe datos: sin Firestore, localStorage, IndexedDB ni guardados', !/collection\(|localStorage|indexedDB|saveTo|guardar[A-Z]/.test(nav));
chk('Doble Atrás para salir en Inicio, ventana de 2 s (decisión de Eduardo)', /NAV_ATRAS_VENTANA_MS = 2000/.test(nav) && /Pulsa Atrás otra vez para salir/.test(nav));

// ═══ 5 · navegacionAtras(): orden de decisión, en una sandbox ══════════════
function sandbox(conf) {
    const llamadas = [];
    const els = {};
    const mk = (id, oculto) => ({ id, classList: { contains: c => (c === 'hidden' ? oculto : (c === 'sb-open' ? !oculto : (c === 'auth-hidden' ? oculto : false))) }, click() { llamadas.push('click:' + id); } });
    (conf.visibles || []).forEach(id => { els[id] = mk(id, false); });
    els.loginScreen = mk('loginScreen', true);
    const volver = conf.volver ? { offsetParent: {}, disabled: false, click() { llamadas.push('volver'); } } : null;
    els.tabContent = { querySelectorAll: sel => (volver && sel === '.mc-cab__volver') ? [volver] : [] };
    const ctx = {
        window: {}, history: { pushState() {}, replaceState() {}, state: { bi: 'guardia' } },
        document: { getElementById: id => els[id] || null, readyState: 'complete', addEventListener() {} },
        activeTab: conf.tab || 'inicio', comprasImportView: conf.compras || 'lista', ventasImportView: 'lista', recetarioImportView: 'lista', _impPendiente: null,
        switchTab: t => { llamadas.push('switchTab:' + t); }, showNotification: m => llamadas.push('aviso:' + m), setTimeout: () => 0, clearTimeout() {}, Date
    };
    ['closeProductModal', 'closeOrderModal', 'closeInventarioModal', 'closeRecetaModal', 'cerrarModalNuevoInventario', 'cerrarModalRegistrarFechaRecuento', 'comprasCerrarDetalle', 'cerrarFichaProducto', 'sbClose']
        .forEach(f => { ctx.window[f] = () => llamadas.push(f); });
    vm.createContext(ctx);
    vm.runInContext(nav.replace(/if \(typeof window !== 'undefined' && typeof document !== 'undefined'\) \{[\s\S]*$/, ''), ctx);
    return { r: ctx.navegacionAtras(), llamadas };
}
let s = sandbox({ visibles: ['productModal', 'sidebar'], tab: 'productos' });
chk('Modal + menú abiertos: cierra primero el modal (lo de más arriba)', s.r === 'capa:producto' && s.llamadas.join() === 'closeProductModal', JSON.stringify(s));
s = sandbox({ visibles: ['inventarioModal'], tab: 'inventario', volver: true });
chk('Captura de conteo abierta: la cierra antes de salir del área', s.r === 'capa:captura de conteo' && s.llamadas.join() === 'closeInventarioModal', JSON.stringify(s));
s = sandbox({ tab: 'pedido_sugerido', volver: true });
chk('Pantalla con Volver: pulsa ese botón (nada más)', s.r === 'volver' && s.llamadas.join() === 'volver', JSON.stringify(s));
s = sandbox({ tab: 'compras', compras: 'vista_previa', volver: true });
chk('Importación en revisión: no la descarta ni pulsa Volver; avisa', s.r === 'importacion' && s.llamadas.length === 1 && /^aviso:/.test(s.llamadas[0]), JSON.stringify(s));
s = sandbox({ tab: 'productos' });
chk('Otra pestaña sin Volver: va a Inicio', s.r === 'inicio' && s.llamadas.join() === 'switchTab:inicio', JSON.stringify(s));
s = sandbox({ tab: 'inicio' });
chk('Inicio sin nada abierto: no hace nada (la decisión de salir la toma el listener)', s.r === 'salir?' && s.llamadas.length === 0, JSON.stringify(s));

console.log('\n  ── v5.31 · Tema minimalista y botón Atrás ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok || !c.d ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
