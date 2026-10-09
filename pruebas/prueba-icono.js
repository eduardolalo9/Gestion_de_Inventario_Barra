#!/usr/bin/env node
/**
 * prueba-icono.js — v5.20 · Ícono de la app (estática)
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedido de Eduardo (9-oct-2026): usar su imagen (botella con palomita dentro
 * de un hexágono dorado) como ícono de la app.
 *
 * Antes no había archivos de ícono: index.html dibujaba una "B" blanca sobre
 * azul con Canvas en cada carga, y sw.js interceptaba icons/icon-*.png para
 * servir esa misma "B". Esta prueba protege el cambio a archivos reales:
 *   · existen, son PNG y tienen el tamaño que declaran;
 *   · manifest.json declara "any" y "maskable" (192 y 512) que existen;
 *   · ya no queda ningún dibujo por Canvas ni intercepción en el SW.
 *   node pruebas/prueba-icono.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const casos = []; let fallos = 0;
function chk(n, ok, d) { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; }

/** Ancho y alto de un PNG leyendo su cabecera IHDR (sin dependencias). */
function medidaPng(rel) {
    const b = fs.readFileSync(path.join(RAIZ, rel));
    const firma = b.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
    return { png: firma && b.slice(12, 16).toString() === 'IHDR', w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

const html = leer('index.html'), sw = leer('sw.js'), css = leer('css/estilos.css');
let man = null;
try { man = JSON.parse(leer('manifest.json')); chk('manifest.json es JSON válido', true); }
catch (e) { chk('manifest.json es JSON válido', false, String(e)); }

const ESPERADOS = {
    'icons/barinventory-192.png': 192, 'icons/barinventory-512.png': 512,
    'icons/barinventory-maskable-192.png': 192, 'icons/barinventory-maskable-512.png': 512,
    'icons/apple-touch-icon.png': 180, 'icons/favicon-32.png': 32, 'icons/favicon-48.png': 48,
    'icons/barinventory-fuente-1024.png': 1024
};
Object.keys(ESPERADOS).forEach(f => {
    const existe = fs.existsSync(path.join(RAIZ, f));
    const m = existe ? medidaPng(f) : null;
    chk('★ ' + f + ' existe, es PNG y mide ' + ESPERADOS[f] + '×' + ESPERADOS[f],
        m && m.png && m.w === ESPERADOS[f] && m.h === ESPERADOS[f], m ? JSON.stringify(m) : 'no existe');
});
const m192 = medidaPng('icons/barinventory-192.png');
chk('El de 192 pesa poco (se precalienta en el teléfono: < 80 KB)', m192.bytes < 80 * 1024, m192.bytes + ' bytes');

if (man) {
    const iconos = man.icons || [];
    const tiene = (src, sizes, purpose) => iconos.some(i => i.src === src && i.sizes === sizes && i.type === 'image/png' && i.purpose === purpose);
    chk('★ manifest: "any" de 192 y 512', tiene('icons/barinventory-192.png', '192x192', 'any') && tiene('icons/barinventory-512.png', '512x512', 'any'));
    chk('★ manifest: "maskable" de 192 y 512 (archivos con margen, no los mismos que "any")',
        tiene('icons/barinventory-maskable-192.png', '192x192', 'maskable') && tiene('icons/barinventory-maskable-512.png', '512x512', 'maskable'));
    chk('Todo lo que declara el manifest existe (íconos y atajos)',
        iconos.concat(...(man.shortcuts || []).map(s => s.icons || [])).every(i => fs.existsSync(path.join(RAIZ, i.src))));
    chk('Ya no apunta a los íconos viejos (icons/icon-192.png / icon-512.png, que no existían)', !/icons\/icon-(192|512)\.png/.test(JSON.stringify(man)));
    chk('El fondo de la pantalla de arranque es el del ícono (#010c1d)', man.background_color === '#010c1d');
}

chk('★ index.html enlaza favicon, 192 y apple-touch-icon con archivos reales',
    /<link rel="icon" type="image\/png" sizes="32x32" href="icons\/favicon-32\.png">/.test(html)
    && /<link rel="icon" type="image\/png" sizes="192x192" href="icons\/barinventory-192\.png">/.test(html)
    && /<link rel="apple-touch-icon" sizes="180x180" href="icons\/apple-touch-icon\.png">/.test(html));
chk('★ Ya no se dibuja la "B" con Canvas (ni al cargar ni para el SW)',
    !/generatePWAIcons|makeIcon\(|_makeIconPng|fillText\('B'/.test(html) && !/postMessage\(\{\s*type:\s*'CACHE_ICONS'/.test(html));
chk('Ya no queda el favicon de emoji 📦', !/%F0%9F%93%A6/.test(html));
chk('La pantalla de inicio de sesión muestra el ícono real (sin el emoji 🍸)',
    /<img class="login-brand-icon" src="icons\/barinventory-192\.png" alt="BarInventory" width="56" height="56">/.test(html) && !/login-brand-icon[^>]*>🍸/.test(html));
chk('…con estilo sin el azul de antes', /\.login-brand-icon \{[\s\S]{0,300}object-fit: cover;/.test(css) && !/\.login-brand-icon \{[^}]*#0A84FF/.test(css));

chk('★ El SW ya no intercepta ni dibuja íconos (serveIcon / generateIconResponse retirados)',
    !/function serveIcon\(|function generateIconResponse\(|respondWith\(serveIcon/.test(sw));
chk('★ El SW ya no acepta CACHE_ICONS (una pestaña vieja no puede volver a meter la "B")', !/data\.type === 'CACHE_ICONS'/.test(sw));
chk('El SW precalienta el ícono en WARM_URLS (uno por uno: si falta, no tumba la instalación)',
    /const WARM_URLS = \[[\s\S]*'\.\/icons\/barinventory-192\.png',[\s\S]*\];/.test(sw) && !/const PRECACHE[\s\S]{0,3000}icons\/barinventory/.test(sw.split('const WARM_URLS')[0]));
chk('Las notificaciones usan el ícono nuevo', /data\.icon\s+\|\| '\.\/icons\/barinventory-192\.png'/.test(sw));
const vH = (html.match(/\?v=([\d.]+)/) || [])[1], vS = (sw.match(/APP_VERSION = '([\d.]+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vH && vH === vS, vH + ' / ' + vS);
chk('La versión avanzó (>= 5.20)', vS && Number(vS.split('.')[0]) >= 5 && Number(vS.split('.')[1]) >= 20, vS);

console.log('\n  ── v5.20 · Ícono de la app (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(104) + (c.ok ? '' : '  ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron');
process.exit(fallos ? 1 : 0);
