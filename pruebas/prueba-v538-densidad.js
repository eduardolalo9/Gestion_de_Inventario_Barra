// v5.38 — «Ultra Pro Emerald»: densidad operativa (estática).
//   node pruebas/prueba-v538-densidad.js
// La medición real en Chromium (alturas, objetivos táctiles, contraste) es prueba-v538-densidad-navegador.js.
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const dens = leer('css/densidad.css'), esti = leer('css/estilos.css'), mini = leer('css/tema-minimal.css'), idx = leer('index.html'), sw = leer('sw.js'), nuc = leer('js/00-nucleo.js');
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const raiz = (/:root\s*\{([\s\S]*?)\n\}/.exec(esti) || ['', ''])[1];
const tok = (n) => { const m = new RegExp('--' + n + ':\\s*(#[0-9A-Fa-f]{6})').exec(raiz); return m ? m[1].toUpperCase() : null; };
const L = (h) => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ── Tokens del oscuro (encargo) ──
// v5.58 — grafito y azul marino, esmeralda sobrio (antes #0A0E0C/#10B981 de v5.38)
const esperado = { bg: '#0D141B', card: '#15212A', 'card-high': '#1D2B34', border: '#22313A', accent: '#4AB794', 'accent-hover': '#62C4A3', 'txt-primary': '#E7EEEB', 'txt-secondary': '#B3C0BB' };
Object.keys(esperado).forEach(k => chk('Token oscuro --' + k + ' = ' + esperado[k], tok(k) === esperado[k], String(tok(k))));
chk('★ Estados: crítico rosa, reabastecer ámbar, ok esmeralda', tok('red') === '#EB8A8F' && tok('amber') === '#E2B45A' && tok('green') === '#5FC68C');
['txt-primary', 'txt-secondary', 'txt-muted', 'accent', 'red', 'amber', 'green'].forEach(t =>
    chk('★ Contraste --' + t + ' ≥ 4.5:1 sobre la tarjeta y sobre --card-high', tok(t) && cr(tok(t), '#15212A') >= 4.5 && cr(tok(t), '#1D2B34') >= 4.5, tok(t) + ' ' + (tok(t) ? cr(tok(t), '#1D2B34').toFixed(2) : '')));
chk('★ El gris tenue de texto pasa AA y el apagado queda solo en --txt-disabled', tok('txt-muted') === '#8E9D98' && tok('txt-disabled') === '#66756F');
chk('Botón primario: texto #062A20 sobre esmeralda ≥ 4.5:1', tok('accent-on') === '#062A20' && cr('#062A20', '#4AB794') >= 4.5);
chk('Sin sombras decorativas en el oscuro (--shadow-card: none)', /--shadow-card:\s*none;/.test(raiz));
const claroAcc = (/--accent:\s*(#[0-9A-Fa-f]{6})/.exec(mini) || [])[1];
chk('★ Claro: esmeralda #1A7058 con ≥ 4.5:1 sobre el fondo y con texto blanco', claroAcc === '#1A7058' && cr('#1A7058', '#F2F5F3') >= 4.5 && cr('#FFFFFF', '#1A7058') >= 4.5);

// ── Tipografía ──
chk('★ Plus Jakarta Sans (400–800) e IBM Plex Mono (500/600) propias, sin Google Fonts', ['400', '500', '600', '700', '800'].every(w => fs.existsSync(path.join(RAIZ, 'fonts/plus-jakarta-sans-' + w + '.woff2')))
    && ['500', '600'].every(w => fs.existsSync(path.join(RAIZ, 'fonts/ibm-plex-mono-' + w + '.woff2'))) && !/fonts\.googleapis\.com\/css/.test(idx.replace(/<!--[\s\S]*?-->/g, '')));
chk('Las fuentes están en el precache del Service Worker', /plus-jakarta-sans-700\.woff2/.test(sw) && /ibm-plex-mono-600\.woff2/.test(sw));
chk('Cifras y códigos en IBM Plex Mono (--f-num)', /--f-num:\s*'IBM Plex Mono'/.test(esti));

// ── Capa de densidad ──
chk('★ densidad.css carga la ÚLTIMA (después de tema-minimal.css) y está en el precache', idx.indexOf('href="css/densidad.css') > idx.indexOf('href="css/tema-minimal.css') && /'\.\/css\/densidad\.css\?v=' \+ APP_VERSION/.test(sw));
chk('★ densidad.css usa solo tokens (cero hex, rgb() u oklch() a mano)', !/#[0-9a-fA-F]{3,8}\b/.test(sinCom(dens).replace(/#(sidebar|sb\w*|hamburgerBtn|themeToggleBtn|perfilBtn|bottomTabBar|mainContent|tabContent|headerActions|rc-pie|_confirmOverlay|_cfmCancel)\b/g, '')) && !/rgba?\(|oklch\(/.test(sinCom(dens)));
chk('Sin cristal ni brillo: ni backdrop-filter ni degradados', !/backdrop-filter|gradient\(/.test(sinCom(dens)));
chk('Tokens de densidad: tarjeta 10 px de padding, gaps 6 px, cuerpo 13 px, barra 56 px', /--d-pad:\s*10px/.test(dens) && /--d-gap:\s*6px/.test(dens) && /--d-fs:\s*13px/.test(dens) && /--alto-barra:\s*56px/.test(dens));
chk('★ Lo que se pegaba sobre la barra de 80 px baja con ella (pie del pedido, avisos)', /\.ps-pie\s*\{ bottom: calc\(var\(--alto-barra\)/.test(dens) && /\.net-aviso\s*\{ bottom: calc\(var\(--alto-barra\)/.test(dens) && /#mainContent \{ padding-bottom: calc\(var\(--alto-barra\)/.test(dens));
chk('★ Los chips se DIBUJAN de 30 px pero conservan 44 px de objetivo (::after; estilos.css apaga button::before)', /\.sbx-chip::after[^{]*\{[^}]*height: 30px/.test(dens) && /\.ps-orden__btn \{ min-height: 44px; \}/.test(dens) && /\.mc-pill \{ min-height: 44px;/.test(dens));
chk('★ Botones: piso de 44 px en toda la capa (ninguna regla de .bt baja de 44)', /\.bt \{ min-height: 44px;/.test(dens) && !/\.bt[^{]*\{[^}]*min-height:\s*(3\d|4[0-3])px/.test(dens));
// Rediseño 2026-11 (D3-A, aprobado por Eduardo): las insignias pasan de 9 a 12 px. Se comprueba la regla
// de las insignias, el valor real del token y que en la capa ya no quede ningún tamaño fijo de 9 o 10 px.
// (La medición en Chromium está en prueba-v538-densidad-navegador.js.)
chk('Insignias de estado de 12 px (D3-A): la regla usa --d-fs-badge, el token vale 12 px y no queda ningún 9 o 10 px fijo',
    /\.bi-badge, \.it-pill[^{]*\{[^}]*font-size: var\(--d-fs-badge\) !important/.test(dens) && /--d-fs-badge:\s*12px/.test(dens)
    && !/font-size:\s*(9|10)px/.test(sinCom(dens)));

// ── Pedido Sugerido (tarjeta densa) ──
const s73 = leer('js/73-pedido-sugerido.js');
chk('★ Tarjeta del pedido: nombre a todo lo ancho (2 renglones), Stock/Mín apilados y Pedir editable', /ps-card__cifras/.test(s73) && /-webkit-line-clamp: 2/.test(dens) && /class="ps-input"/.test(s73));
chk('Estado mínimo: borde de color Y palabra (el color nunca va solo)', /ps-card--' \+ est\.clase/.test(s73) && /ps-estado ps-estado--' \+ est\.clase \+ '">' \+ est\.txt/.test(s73));

// ── Tema predeterminado ──
chk('★ Oscuro predeterminado, migración de una sola vez con la marca «ultra-pro»', /let saved\s*=\s*'dark'/.test(nuc) && /'ultra-pro'/.test(idx) && /t = 'dark';/.test(idx));
chk('Se retiraron los subtítulos descriptivos (Físico vs Sistema y Conteo)', !/'>Suma lo contado/.test(leer('js/85-ui-inventario-fisico.js')) && !/'>Conteo ciego —/.test(leer('js/85-ui-inventario-fisico.js')));

let mal = 0;
C.forEach(c => { console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '  → ' + c.d)); if (!c.ok) mal++; });
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron\n');
process.exit(mal ? 1 : 0);
