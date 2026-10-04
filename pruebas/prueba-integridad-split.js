#!/usr/bin/env node
/**
 * prueba-integridad-split.js — M2
 * ═══════════════════════════════════════════════════════════════════════════
 * Vigila que la partición del código en archivos siga siendo consistente.
 *
 * Un archivo único no podía romperse de estas formas. Uno partido en 17 sí:
 * basta una etiqueta olvidada, un archivo renombrado, un orden de carga
 * alterado o una versión de caché desincronizada para que la app falle de
 * maneras difíciles de diagnosticar — a veces solo en el teléfono de una
 * persona, porque su navegador tiene un .js viejo en caché.
 *
 * Esta prueba corre antes que las de Firestore en `npm test`. No necesita
 * emulador ni red.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok, detalle });
    if (!ok) fallos++;
}

// ── Cargar acorn si está disponible; si no, se salta el parseo ──────────────
let acorn = null;
try { acorn = require('acorn'); } catch (_) { /* opcional */ }

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

// ═══ 1 · Etiquetas declaradas en index.html ════════════════════════════════
const declaradas = [];
const reTag = /<script\s+src="(js\/[^"?]+\.js)(\?v=([^"]*))?"><\/script>/g;
let m;
while ((m = reTag.exec(html))) declaradas.push({ ruta: m[1], v: m[3] || null });

chk('index.html declara al menos 16 archivos js',
    declaradas.length >= 16, declaradas.length + ' encontrados');

// ═══ 2 · Cada archivo declarado existe en disco ════════════════════════════
const faltantes = declaradas.filter(d => !fs.existsSync(path.join(RAIZ, d.ruta)));
chk('Todos los archivos declarados existen en disco',
    faltantes.length === 0, faltantes.map(f => f.ruta).join(', '));

// ═══ 3 · Cada archivo en disco está declarado ══════════════════════════════
const enDisco = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js')).sort();
const declSet = new Set(declaradas.map(d => path.basename(d.ruta)));
const huerfanos = enDisco.filter(f => !declSet.has(f));
chk('Ningún archivo js queda huérfano (en disco pero sin etiqueta)',
    huerfanos.length === 0, huerfanos.join(', '));

// ═══ 4 · El orden de carga respeta el prefijo numérico ═════════════════════
// El orden ES la seguridad: 00-nucleo declara el estado global que todo lo
// demás usa, y 99-window-arranque expone las funciones y arranca la app.
const numerados = declaradas
    .map(d => path.basename(d.ruta))
    .filter(f => /^\d\d-/.test(f));
const ordenado = [...numerados].sort();
chk('El orden de las etiquetas coincide con el orden numérico',
    JSON.stringify(numerados) === JSON.stringify(ordenado),
    'declarado: ' + numerados.join(' ') + '  |  esperado: ' + ordenado.join(' '));

// ═══ 5 · 99-window-arranque.js es el último js numerado ════════════════════
chk('99-window-arranque.js se carga al final',
    numerados[numerados.length - 1] === '99-window-arranque.js',
    'último: ' + numerados[numerados.length - 1]);

// ═══ 6 · Cada archivo parsea por sí solo ═══════════════════════════════════
if (acorn) {
    const rotos = [];
    for (const d of declaradas) {
        const p = path.join(RAIZ, d.ruta);
        if (!fs.existsSync(p)) continue;
        try { acorn.parse(fs.readFileSync(p, 'utf8'), { ecmaVersion: 2022, sourceType: 'script' }); }
        catch (e) { rotos.push(d.ruta + ': ' + e.message); }
    }
    chk('Cada archivo js parsea por sí solo', rotos.length === 0, rotos.join(' | '));

    // ═══ 7 · La concatenación en orden de carga también parsea ═════════════
    // Detecta un corte hecho a mitad de una función: los trozos podrían
    // parecer válidos por separado y no formar un programa coherente.
    try {
        const junto = declaradas
            .filter(d => /^js\/\d\d-/.test(d.ruta))
            .map(d => fs.readFileSync(path.join(RAIZ, d.ruta), 'utf8'))
            .join('\n');
        acorn.parse(junto, { ecmaVersion: 2022, sourceType: 'script' });
        chk('La concatenación en orden de carga parsea como un solo programa', true, '');
    } catch (e) {
        chk('La concatenación en orden de carga parsea como un solo programa', false, e.message);
    }
} else {
    chk('acorn disponible para verificar sintaxis', false,
        'no instalado — ejecuta: npm install acorn');
}

// ═══ 8 · Todas las etiquetas usan la MISMA versión ═════════════════════════
const versiones = [...new Set(declaradas.map(d => d.v))];
chk('Todas las etiquetas js usan la misma ?v=',
    versiones.length === 1 && versiones[0], versiones.join(', ') || 'sin versión');

// ═══ 9 · El CSS usa esa misma versión ══════════════════════════════════════
const mCss = /<link\s+rel="stylesheet"\s+href="(css\/[^"?]+\.css)(\?v=([^"]*))?"/.exec(html);
chk('index.html enlaza el CSS con la misma versión',
    !!mCss && mCss[3] === versiones[0],
    mCss ? ('css v=' + mCss[3]) : 'no hay <link> al css');
chk('El archivo css existe en disco',
    !!mCss && fs.existsSync(path.join(RAIZ, mCss[1])), mCss ? mCss[1] : '—');

// ═══ 10 · sw.js: APP_VERSION coincide con el ?v= ═══════════════════════════
// El fallo más difícil de diagnosticar de una PWA partida: index.html nuevo
// sirviendo un .js viejo desde la caché del Service Worker.
const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
const mV = /const\s+APP_VERSION\s*=\s*'([^']+)'/.exec(sw);
chk('sw.js declara APP_VERSION', !!mV, mV ? mV[1] : 'no encontrada');
chk('APP_VERSION de sw.js coincide con el ?v= de index.html',
    !!mV && mV[1] === versiones[0],
    (mV ? mV[1] : '?') + ' vs ' + versiones[0]);

// ═══ 11 · PRECACHE_URLS apunta a archivos que existen ══════════════════════
const mPre = /const\s+PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/.exec(sw);
if (mPre) {
    const rutas = [...mPre[1].matchAll(/'\.\/([^'?]+)/g)].map(x => x[1]);
    const noExisten = rutas.filter(r => !fs.existsSync(path.join(RAIZ, r)));
    chk('Todo lo que PRECACHE_URLS pide existe en disco',
        noExisten.length === 0, noExisten.join(', '));
    // addAll() es todo-o-nada: cuanto más largo, más probable que aborte.
    chk('PRECACHE_URLS se mantiene en el camino crítico (≤ 6 entradas)',
        rutas.length <= 6, rutas.length + ' entradas');
} else {
    chk('sw.js declara PRECACHE_URLS', false, 'no encontrada');
}

// ═══ 11-bis · Ningún js queda fuera del Service Worker ═════════════════════
// PRECACHE_URLS (crítico, atómico) + WARM_URLS (el resto, tolerante) tienen
// que cubrir los 16 archivos. Si mañana se añade un js y se olvida aquí, ese
// archivo nunca llega a la caché y la app se rompe sin señal — solo para quien
// haya perdido la caché HTTP, que es el fallo más difícil de reproducir.
const mWarm = /const\s+WARM_URLS\s*=\s*\[([\s\S]*?)\]/.exec(sw);
chk('sw.js declara WARM_URLS', !!mWarm, mWarm ? 'ok' : 'no encontrada');
if (mWarm && mPre) {
    const cubiertos = new Set(
        [...(mPre[1] + mWarm[1]).matchAll(/'\.\/js\/([^'?]+)/g)].map(x => x[1]));
    const sinCubrir = enDisco.filter(f => !cubiertos.has(f));
    chk('Todos los js están en PRECACHE_URLS o en WARM_URLS',
        sinCubrir.length === 0, 'sin cubrir: ' + sinCubrir.join(', '));
    const sobran = [...cubiertos].filter(f => !enDisco.includes(f));
    chk('El Service Worker no pide js que ya no existen',
        sobran.length === 0, 'sobran: ' + sobran.join(', '));
}

// ═══ 12 · No quedan bloques de script en línea de más de 40 líneas ═════════
// Los bloques de cabecera (tema, CSP, Firebase) se quedan en línea a
// propósito. Si aparece uno grande, alguien volvió a meter código al HTML.
const enLinea = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(x => x[1].split('\n').length);
// El umbral subió de 400 a 480 en R3: la configuración pasó a declarar DOS
// entornos (producción y pruebas), y eso son unas 40 líneas más. Lo que hace
// grande a ese bloque no es código de la app —son la config de Firebase, que
// tiene que cargarse antes que todo, y un comentario largo con una copia de
// las reglas de Firestore.
//
// DEUDA CONOCIDA: esa copia duplica firestore.rules. Dos copias del mismo
// texto acaban divergiendo, y la que manda es el archivo. Conviene borrar el
// comentario, pero no dentro de una fase que toca la conexión a la base.
const grandes = enLinea.filter(n => n > 480);
chk('No hay bloques de script en línea gigantes en index.html',
    grandes.length === 0,
    'bloques de ' + enLinea.join('/') + ' líneas');

// ── Resumen ────────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── Integridad de la partición (M2) ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');

process.exit(fallos ? 1 : 0);
