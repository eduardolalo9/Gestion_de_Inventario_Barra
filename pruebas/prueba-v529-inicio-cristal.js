#!/usr/bin/env node
/**
 * prueba-v529-inicio-cristal.js — v5.29 · Inicio "Midnight Bar" (estática)
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedido de Eduardo (16-oct-2026): glassmorphism + cifras de dashboard SOLO
 * en Inicio, con su paleta "Midnight Bar"; mismos indicadores y mismas
 * tarjetas de producto (solo cambia el estilo).
 *   node pruebas/prueba-v529-inicio-cristal.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

const css = leer('css/tema-inicio.css'), idx = leer('index.html'), sw = leer('sw.js'),
      r70 = leer('js/70-conversion-render.js'), panel = leer('js/83-panel.js'), esti = leer('css/estilos.css');
const sinCom = css.replace(/\/\*[\s\S]*?\*\//g, '');

// ── Carga ────────────────────────────────────────────────────────────────
const iE = idx.indexOf('href="css/estilos.css'), iT = idx.indexOf('href="css/tema-inicio.css');
chk('tema-inicio.css se carga DESPUÉS de estilos.css (sus reglas mandan en Inicio)', iE > 0 && iT > iE);
chk('Mismo ?v= que el resto de la app', /href="css\/tema-inicio\.css\?v=(\d+\.\d+)"/.exec(idx)[1] === /APP_VERSION\s*=\s*'([\d.]+)'/.exec(sw)[1]);
chk('sw.js lo precalienta en WARM_URLS (PRECACHE conserva su tope de 6)',
    /const WARM_URLS = \[[\s\S]*?'\.\/css\/tema-inicio\.css\?v=' \+ APP_VERSION/.test(sw)
    && !/PRECACHE_URLS\s*=\s*\[[^\]]*tema-inicio/.test(sw));
chk('estilos.css no creció (sigue en su tope)', Buffer.byteLength(esti) <= 215000, String(Buffer.byteLength(esti)));

// ── Alcance: solo Inicio ─────────────────────────────────────────────────
chk('renderTab() pone html.vista-inicio solo cuando la pestaña es Inicio',
    /document\.documentElement\.classList\.toggle\('vista-inicio', activeTab === 'inicio'\);/.test(r70));
const bloques = sinCom.split('}').map(b => b.trim()).filter(Boolean);
const selectores = bloques.map(b => b.slice(0, b.indexOf('{')).trim()).filter(Boolean);
// Separa por comas de primer nivel (las de dentro de :is(...) no cuentan).
const partes = sel => { const out = []; let n = 0, cur = ''; for (const ch of sel) { if (ch === '(') n++; if (ch === ')') n--; if (ch === ',' && !n) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); };
const acotada = sel => sel === ':root' || partes(sel).every(x => /^html\.vista-inicio\b/.test(x));
chk('★ Toda regla está acotada a html.vista-inicio (salvo el bloque :root de tokens)',
    selectores.length > 30 && selectores.every(acotada), selectores.filter(x => !acotada(x)).join(' | '));
chk('★ Los tokens se redefinen dentro de #mainContent (encabezado y barra inferior conservan su tema)',
    /html\.vista-inicio #mainContent \{[^}]*--card: var\(--mb-card\);[^}]*--accent: var\(--mb-oro\);/.test(sinCom));

// ── Paleta: hex solo en tokens; contraste AA ─────────────────────────────
const tokens = (/:root \{([\s\S]*?)\n\}/.exec(sinCom) || [])[1] || '';
const reglas = sinCom.replace(/:root \{[\s\S]*?\n\}/, '');
chk('Los colores a mano (hex/rgba) viven solo en el bloque de tokens', tokens.length > 500 && !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(reglas.replace(/#mainContent/g, '')));
const val = n => (new RegExp('--' + n + ':\\s*(#[0-9A-Fa-f]{6})').exec(tokens) || [])[1];
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const TARJETA = '#181D1A';   // rgba(26,31,28,.85) sobre --mb-bg
[['mb-txt', 'texto'], ['mb-txt-2', 'secundario'], ['mb-txt-3', 'tenue'], ['mb-oro', 'dorado'], ['mb-rojo', 'rojo'], ['mb-ambar', 'ámbar'], ['mb-verde', 'verde']]
    .forEach(([t, nombre]) => chk('Contraste ' + nombre + ' sobre la tarjeta >= 4.5:1', val(t) && cr(val(t), TARJETA) >= 4.5, val(t) + ' → ' + (val(t) ? cr(val(t), TARJETA).toFixed(2) : '?')));
chk('★ Pastillas Bajo / OK con texto blanco >= 4.5:1 (la paleta original daba 3.3 y 3.7)',
    cr(val('mb-pastilla-txt'), val('mb-bajo-bg')) >= 4.5 && cr(val('mb-pastilla-txt'), val('mb-ok-bg')) >= 4.5,
    [cr(val('mb-pastilla-txt'), val('mb-bajo-bg')).toFixed(2), cr(val('mb-pastilla-txt'), val('mb-ok-bg')).toFixed(2)].join(' / '));
chk('Botón dorado: texto oscuro sobre dorado >= 4.5:1', cr(val('mb-oro-on'), val('mb-oro')) >= 4.5);
chk('Sin el degradado morado → naranja (decisión de Eduardo)', !/purple|violet|orange|#[67][0-9a-f]3[0-9a-f]{3}/i.test(css));

// ── Cifras y batería ─────────────────────────────────────────────────────
chk('Valor en existencia y Compras de la semana marcadas como dinero (pm-tile--dinero)',
    (panel.match(/clase: 'pm-tile--dinero'/g) || []).length === 2 && /pm-tile--dinero \.pm-tile__val \{ color: var\(--accent\); \}/.test(css));
chk('★ backdrop-filter solo en el buscador fijo (batería)',
    (reglas.match(/backdrop-filter/g) || []).length === 2 && /\.sbx--sticky \{[^}]*backdrop-filter: blur\(16px\)/.test(reglas));
chk('Los indicadores no cambiaron: mismos 6 tiles del panel', (extraer(panel, 'renderPanelInicio').match(/_panelTile\(/g) || []).length === 6);

function extraer(f, n) { const i = f.indexOf('function ' + n + '('); let k = 0, d = false; for (let j = i; j < f.length; j++) { if (f[j] === '{') { k++; d = true; } else if (f[j] === '}') { k--; if (d && !k) return f.slice(i, j + 1); } } return ''; }

console.log('\n  ── v5.29 · Inicio "Midnight Bar" ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok || !c.d ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
