#!/usr/bin/env node
/**
 * prueba-tema-esmeralda.js — v5.25 · Verde Esmeralda Bosque (estática)
 * Eduardo pidió aplicar la visualización "Atmósfera y Paleta de Color": primario esmeralda,
 * barra lateral Noche Profunda, perla, pasteles de categoría, Manrope + DM Sans.
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const css = leer('css/estilos.css'), html = leer('index.html'), sw = leer('sw.js'), man = JSON.parse(leer('manifest.json'));
const kit = leer('js/03-ui-kit.js'), nuc = leer('js/00-nucleo.js');
const bloque = css.slice(css.indexOf('v5.25 — VERDE ESMERALDA BOSQUE · piel final'));
// v5.38 — «Ultra Pro Emerald» (encargo de Eduardo, 2-nov-2026): Plus Jakarta Sans + IBM Plex Mono
// sustituyen a Manrope + DM Sans, y el tema OSCURO pasa a ser el predeterminado.
const FUENTES = ['plus-jakarta-sans-400', 'plus-jakarta-sans-500', 'plus-jakarta-sans-600', 'plus-jakarta-sans-700', 'plus-jakarta-sans-800', 'ibm-plex-mono-500', 'ibm-plex-mono-600'];

// ── Tipografías propias, sin Google Fonts ──
chk('★ Las 7 fuentes woff2 existen en fonts/ y no están vacías',
    FUENTES.every(f => fs.existsSync(path.join(RAIZ, 'fonts', f + '.woff2')) && fs.statSync(path.join(RAIZ, 'fonts', f + '.woff2')).size > 5000));
chk('Las licencias (OFL) viajan con las fuentes', fs.existsSync(path.join(RAIZ, 'fonts/LICENSE-Plus-Jakarta-Sans.txt')) && fs.existsSync(path.join(RAIZ, 'fonts/LICENSE-IBM-Plex-Mono.txt')));
chk('★ estilos.css declara cada fuente con @font-face y font-display: swap',
    FUENTES.every(f => css.includes('../fonts/' + f + '.woff2')) && (css.match(/font-display:\s*swap/g) || []).length >= 7);
chk('★ index.html ya no carga Google Fonts (funciona sin conexión)', !/fonts\.googleapis\.com\/css/.test(html.replace(/<!--[\s\S]*?-->/g, '')));
chk('★ La CSP deja cargar fuentes del propio origen (font-src \'self\')', /font-src[^;"]*'self'/.test(html));
chk('★ sw.js precalienta las 7 fuentes (primera carga sin red)', FUENTES.every(f => sw.includes('./fonts/' + f + '.woff2')));
chk('v5.38 · Los tokens de fuente son Plus Jakarta Sans (títulos y cuerpo) e IBM Plex Mono (cifras)',
    /--f-head:\s*'Plus Jakarta Sans'/.test(css) && /--f-body:\s*'Plus Jakarta Sans'/.test(css) && /--f-num:\s*'IBM Plex Mono'/.test(css));
chk('v5.38 · Ya no queda ninguna referencia a Manrope ni DM Sans (ni archivos ni @font-face)',
    !/Manrope|DM Sans/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')) && !/manrope|dm-sans/.test(sw) && !fs.existsSync(path.join(RAIZ, 'fonts/manrope-700.woff2')));

// ── Paleta ──
chk('★ Tema claro = de marca: primario esmeralda #10664A, fondo perla #F5F7F6', /html\[data-theme="light"\]\s*\{[\s\S]*?--accent:\s*#10664A/.test(css) && /html\[data-theme="light"\]\s*\{[\s\S]*?--bg:\s*#F5F7F6/.test(css));
chk('v5.38 · Cajón lateral casi negro #0D1410 y su pareja (--sidebar-2, --sidebar-line)', /--sidebar:\s*#0D1410/.test(css) && /--sidebar-2:/.test(css) && /--sidebar-line:/.test(css));
chk('★ La barra lateral es oscura en AMBOS temas (tokens re-declarados dentro de #sidebar)',
    /#sidebar \{[^}]*--bg: var\(--sidebar\)[^}]*--txt-primary: var\(--sidebar-fg\)/.test(bloque) && /--accent: var\(--dk-accent\)/.test(bloque));
chk('El destino activo del menú va en esmeralda sólido con texto blanco', /#sidebar \.sb-item\.sb-active[^{]*\{[^}]*background: var\(--sidebar-active\)[^}]*color: var\(--blanco\)/.test(bloque));
chk('Hay 4 pasteles de categoría (whisky, gin, destilados, licores) en --cat-*',
    ['whisky', 'gin', 'dest', 'lic'].every(k => new RegExp('--cat-' + k + '-bg:').test(css) && new RegExp('--cat-' + k + '-fg:').test(css)));
chk('★ La tarjeta principal de Inicio usa --hero-bg con texto --hero-fg', /\.it-inv \{[^}]*background: var\(--hero-bg\)[^}]*color: var\(--hero-fg\)/.test(bloque));
chk('El encabezado ya no es azul marino: usa --bg', /html body \.sticky\.top-0[^{]*\{[^}]*background: var\(--bg\)/.test(bloque) && !/body > \.sticky\.top-0 \{/.test(css));
chk('★ El bloque v5.25 usa solo tokens (cero hex, rgba() ni oklch() a mano)', bloque.length > 3000 && !/#[0-9a-fA-F]{3,8}\b/.test(bloque.replace(/#(sidebar|sb\w*|hamburgerBtn|themeToggleBtn|bottomTabBar|appWrapper|mainContent|syncDot)\b/g, '')) && !/rgba?\(|oklch\(/.test(bloque));

// ── Tema por defecto y migración ──
chk('★ v5.38 · El tema predeterminado es OSCURO (initTheme y toggleTheme)', /let saved\s*=\s*'dark'/.test(nuc) && !/let saved\s*=\s*'light'/.test(nuc) && /getAttribute\('data-theme'\) \|\| 'dark'/.test(nuc));
chk('★ v5.38 · Migración de una sola vez: la marca inventarioApp_temaMarca=ultra-pro fuerza el oscuro una vez y luego respeta la elección',
    /inventarioApp_temaMarca/.test(html) && /'ultra-pro'/.test(html) && /t = 'dark';/.test(html));
chk('theme-color y manifest siguen el tema nuevo (el fondo del arranque sigue siendo el del ícono)',
    /theme-color[^>]*#F5F7F6/i.test(html) && /theme-color[^>]*#0A0E0C/i.test(html) && man.theme_color === '#0A0E0C' && man.background_color === '#010c1d');

// ── Monogramas por categoría ──
chk('★ UI.mono reconoce whisky, ginebra, destilados y licores (y conserva el tinte por hash para lo demás)',
    /'whisky'/.test(kit) && /'gin'/.test(kit) && /'dest'/.test(kit) && /'lic'/.test(kit) && /TINTES\[semilla % TINTES\.length\]/.test(kit));
chk('Existen las 4 clases .bi-mono--whisky/gin/dest/lic', ['whisky', 'gin', 'dest', 'lic'].every(k => new RegExp('\\.bi-mono--' + k + '\\s*\\{').test(bloque)));

// ── Tablet ──
chk('★ Desde 1024 px la barra lateral es fija y se ocultan hamburguesa, velo y barra inferior',
    /@media \(min-width: 1024px\) \{[^@]*#appWrapper \{ padding-left: 264px; \}[^@]*#sidebar \{ transform: none !important[^@]*#bottomTabBar \{ display: none !important/.test(bloque));
chk('Cerrada, la barra lateral no deja sombra en el borde (#sidebar:not(.sb-open))', /html #sidebar:not\(\.sb-open\)[^{]*\{ box-shadow: none; \}/.test(bloque));

// ── Versión ──
const vH = (html.match(/\?v=(\d+\.\d+)/) || [])[1], vS = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vH && vH === vS, 'index=' + vH + ' sw=' + vS);
chk('La versión avanzó (>= 5.25)', Number((vS || '').split('.')[1]) >= 25, 'es ' + vS);

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Tema Verde Esmeralda v5.25 (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
