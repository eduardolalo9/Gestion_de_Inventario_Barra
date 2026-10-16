#!/usr/bin/env node
/**
 * prueba-v530-tema-cristal.js — v5.30 · Tema cristal en toda la app (estática)
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedido de Eduardo (16-oct-2026): las tarjetas de cristal de Inicio en toda
 * la app, con un fondo fijo elegante que se vea desenfocado detrás. Tema
 * oscuro = "Midnight Bar"; tema claro = "Cristal claro" con acento bronce.
 *   node pruebas/prueba-v530-tema-cristal.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

const css = leer('css/tema-cristal.css'), idx = leer('index.html'), sw = leer('sw.js'), esti = leer('css/estilos.css'), r70 = leer('js/70-conversion-render.js');
const sinCom = css.replace(/\/\*[\s\S]*?\*\//g, '');

// ── Carga ────────────────────────────────────────────────────────────────
const iE = idx.indexOf('href="css/estilos.css'), iT = idx.indexOf('href="css/tema-cristal.css');
chk('tema-cristal.css se carga DESPUÉS de estilos.css', iE > 0 && iT > iE);
chk('La hoja de v5.29 (solo Inicio) ya no existe ni se carga', !fs.existsSync(path.join(RAIZ, 'css/tema-inicio.css')) && !/tema-inicio/.test(idx + sw));
chk('Mismo ?v= que la app', (/href="css\/tema-cristal\.css\?v=([\d.]+)"/.exec(idx) || [])[1] === (/APP_VERSION\s*=\s*'([\d.]+)'/.exec(sw) || [])[1]);
chk('sw.js la precalienta en WARM_URLS (PRECACHE conserva su tope)', /const WARM_URLS = \[[\s\S]*?'\.\/css\/tema-cristal\.css\?v=' \+ APP_VERSION/.test(sw) && !/PRECACHE_URLS\s*=\s*\[[^\]]*tema-cristal/.test(sw));
chk('estilos.css no creció', Buffer.byteLength(esti) <= 215000, String(Buffer.byteLength(esti)));
chk('Sin la clase de v5.29: el tema ya no depende de la pestaña', !/vista-inicio/.test(r70 + css));

// ── Tokens: hex/rgba solo en los dos bloques de tokens ───────────────────
const bOsc = (/^:root \{([\s\S]*?)\n\}/m.exec(sinCom) || [])[1] || '';
const bClaro = (/^html\[data-theme="light"\] \{([\s\S]*?)\n\}/m.exec(sinCom) || [])[1] || '';
const reglas = sinCom.replace(/^:root \{[\s\S]*?\n\}/m, '').replace(/^html\[data-theme="light"\] \{[\s\S]*?\n\}/m, '');
chk('Hay bloque de tokens oscuro y claro', bOsc.length > 1500 && bClaro.length > 1000);
chk('★ Fuera de los bloques de tokens no hay hex ni rgba a mano', !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(reglas.replace(/#(productModal|orderModal|inventarioModal|bottomTabBar|sidebar)\b/g, '')),
    (reglas.replace(/#(productModal|orderModal|inventarioModal|bottomTabBar|sidebar)\b/g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []).slice(0, 5).join(' '));
const tok = (b, n) => (new RegExp('--' + n + ':\\s*(#[0-9A-Fa-f]{6})').exec(b) || [])[1];
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// Tarjeta compuesta sobre el destello más claro del fondo (peor caso), calculada a mano en el informe.
const TARJ_OSC = '#21231D', TARJ_CLARO = '#EBF0EA';
[['txt-primary', 'texto'], ['txt-secondary', 'secundario'], ['txt-muted', 'tenue'], ['accent', 'acento']].forEach(([t, n]) => {
    chk('Oscuro: ' + n + ' >= 4.5:1 sobre la tarjeta (peor caso)', tok(bOsc, t) && cr(tok(bOsc, t), TARJ_OSC) >= 4.5, tok(bOsc, t) + ' ' + (tok(bOsc, t) ? cr(tok(bOsc, t), TARJ_OSC).toFixed(2) : ''));
    chk('Claro: ' + n + ' >= 4.5:1 sobre la tarjeta (peor caso)', tok(bClaro, t) && cr(tok(bClaro, t), TARJ_CLARO) >= 4.5, tok(bClaro, t) + ' ' + (tok(bClaro, t) ? cr(tok(bClaro, t), TARJ_CLARO).toFixed(2) : ''));
});
chk('★ Claro: el acento es bronce (no dorado, que da 2.2:1 sobre blanco)', tok(bClaro, 'accent') === '#7A5A1E' && cr('#FFFFFF', tok(bClaro, 'accent')) >= 4.5);
chk('Botones con el acento: texto legible en ambos temas', cr(tok(bOsc, 'accent-on'), tok(bOsc, 'accent')) >= 4.5 && cr(tok(bClaro, 'accent-on'), tok(bClaro, 'accent')) >= 4.5);
chk('Pastillas Bajo / OK con texto blanco >= 4.5:1', cr(tok(bOsc, 'pastilla-txt'), tok(bOsc, 'pastilla-bajo')) >= 4.5 && cr(tok(bOsc, 'pastilla-txt'), tok(bOsc, 'pastilla-ok')) >= 4.5);
chk('Barra lateral: destino activo dorado con texto oscuro legible', cr(tok(bOsc, 'sidebar-active-fg'), tok(bOsc, 'sidebar-active')) >= 4.5);

// ── Fondo fijo y desenfoque ──────────────────────────────────────────────
chk('★ Fondo fijo: body::before position fixed detrás de todo con el token del tema',
    /body::before \{[^}]*position: fixed; inset: 0; z-index: -1; pointer-events: none;[^}]*background: var\(--fondo-cristal\)/.test(reglas)
    && /--fondo-cristal:\s*radial-gradient/.test(bOsc) && /--fondo-cristal:\s*radial-gradient/.test(bClaro));
chk('★ Tarjetas translúcidas (card con alfa < 1) en ambos temas', /--card:\s*rgba\([^)]*,\s*\.6\d?\)/.test(bOsc) && /--card:\s*rgba\([^)]*,\s*\.6\d?\)/.test(bClaro));
const lista = (/:is\(([\s\S]*?)\) \{\s*background: var\(--card\);[\s\S]*?backdrop-filter: var\(--vidrio-blur\)/.exec(reglas) || [])[1] || '';
['.if-card', '.prd-card', '.pm-tile', '.it-inv', '.adm-card', '.vs-kpi', '.ps-card', '.eq-card', '.rc-card'].forEach(c =>
    chk('Cristal con desenfoque en ' + c, lista.includes(c)));
chk('Desenfoque NO en botones, chips ni filas de tabla', !/(\.bt\b|\.grp-pill|\.sbx-chip|tr\b|td\b)[^{]*\{[^}]*backdrop-filter/.test(reglas));
chk('Encabezado y barra inferior en cristal', /\.sticky\.top-0 \{[^}]*backdrop-filter/.test(reglas) && /#bottomTabBar[^{]*\{[^}]*backdrop-filter/.test(reglas));
chk('Modales casi opacos (card-solida >= .94)', /--card-solida:\s*rgba\([^)]*,\s*\.9[4-9]\)/.test(bOsc) && /--card-solida:\s*rgba\([^)]*,\s*\.9[4-9]\)/.test(bClaro) && /--modal-bg:\s*var\(--card-solida\)/.test(bOsc));
chk('★ Respaldo: sin backdrop-filter o con "reducir transparencia", tarjetas casi opacas',
    /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/.test(css) && /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?--vidrio-blur: none/.test(css));

console.log('\n  ── v5.30 · Tema cristal en toda la app ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok || !c.d ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
