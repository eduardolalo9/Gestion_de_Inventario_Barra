#!/usr/bin/env node
/**
 * prueba-conteo-compacto.js — Vista compacta de las tarjetas de área (v5.11) · estática
 * Eduardo pidió "vista compacta empresarial" en la primera pantalla del Conteo.
 * Restricción heredada (FASE 10B): tarjeta de área >= 72 px, botones >= 48 px,
 * texto de botón >= 14 px. Se compacta lo demás. Ver informe de la entrega.
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const css = leer('css/estilos.css'), js = leer('js/85-ui-inventario-fisico.js'), html = leer('index.html'), sw = leer('sw.js');

chk('★ La sección Áreas usa if-areas--compacto', /<div class="if-areas if-areas--compacto">/.test(js));
chk('★ El Historial conserva .if-areas SIN el modificador (no se compactó por accidente)',
    (js.match(/<div class="if-areas">/g) || []).length === 1 && (js.match(/if-areas--compacto/g) || []).length === 1);
chk('.if-areas (compartida) conserva su gap de 16 px', /\.if-areas \{ display: flex; flex-direction: column; gap: 16px; \}/.test(css));
chk('.if-areas--compacto baja la separación a 8 px', /\.if-areas--compacto \{ gap: 8px; \}/.test(css));
chk('★ Piso FASE 10B: la tarjeta de área conserva min-height >= 72 px',
    Number((css.match(/\.if-area \.audit-area-card \{ min-height: (\d+)px/) || [])[1]) >= 72);
chk('★ Piso FASE 10B: el botón del área conserva min-height >= 48 px',
    Number((css.match(/\.if-area \.bt \{ min-height: (\d+)px/) || [])[1]) >= 48);
chk('★ Piso FASE 10B: el texto del botón sigue >= 14 px (.95rem)', /\.if-area \.bt \{[^}]*font-size: \.95rem/.test(css));
chk('Estado y conteo comparten renglón (.audit-area-info en flex-wrap)', /\.if-area \.audit-area-info \{ display: flex; flex-wrap: wrap/.test(css));
chk('El radio del contenedor del par tarjeta+botón usa token (--r-lg), no 20px a mano',
    /\.if-area:has\(> \.bt\) \{[^}]*border-radius: var\(--r-lg\)/.test(css) && !/\.if-area:has\(> \.bt\) \{[^}]*20px/.test(css));
chk('El icono del área se achicó a 1.05rem (inline) y la flecha a 18 px',
    /font-size:1\.05rem;color:/.test(js) && /audit-area-arrow" width="18" height="18"/.test(js));
chk('★ "Reabrir" sigue diciendo qué área reabre (aria-label con el nombre) aunque el texto visible es corto',
    /onclick="reabrirArea\(\\'' \+ area \+ '\\'\)" aria-label="Reabrir ' \+ escapeHtml\(areasAuditoria\[area\]\) \+ '"/.test(js) && /<\/i> Reabrir<\/button>/.test(js));
chk('"Cerrar área para todos" conserva su texto completo (acción de grupo, no se abrevia)', /<\/i> Cerrar área para todos<\/button>/.test(js));
chk('La tarjeta sigue siendo role="button" con onclick auditoriaEntrarArea (no cambió la acción)', /role="button" tabindex="0" aria-label="Entrar a '/.test(js) && /auditoriaEntrarArea\(\\'' \+ area/.test(js));
chk('Sin colores hex a mano en las reglas nuevas', !/\.if-area[^{]*\{[^}]*#[0-9a-fA-F]{3,6}\b/.test(css));
const vH = (html.match(/\?v=(\d+\.\d+)/) || [])[1], vS = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vH && vH === vS, 'index=' + vH + ' sw=' + vS);
chk('La versión avanzó (>= 5.11)', Number((vS || '').split('.')[1]) >= 11, 'es ' + vS);

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Vista compacta del Conteo (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
