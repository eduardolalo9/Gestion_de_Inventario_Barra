#!/usr/bin/env node
/**
 * prueba-redis-r3.js — REDISEÑO R3 · Inicio · estática
 * ═══════════════════════════════════════════════════════════════════════════
 * DECISIÓN DE EDUARDO (2-oct-2026), textual: "Inicio sigue listando los 431
 * productos, como hoy". No hay tablero que sustituya al catálogo. R3 rehace
 * el ASPECTO de lo que ya había —panel, catálogo, sincronización, reportes—
 * y no mueve ni una pieza de su sitio.
 *
 * Por eso la mitad de esta prueba es de NO-REGRESIÓN: comprueba que sigue
 * ahí lo que no debía cambiar. Un rediseño que "limpia" la pantalla
 * borrándole el buscador o los chips de área habría pasado cualquier prueba
 * de aspecto y habría sido un fallo grave.
 *
 *   1  ★ Inicio conserva su contenido: catálogo, buscador, chips, panel,
 *        sincronización y reportes. Nada se fue a otra pestaña.
 *   2  ★ Los enganches funcionales de la tarjeta siguen intactos
 *        (data-sbx-item, data-pm-ficha, has-data): de ellos cuelgan el
 *        buscador, la ficha de producto y otras pruebas.
 *   3  ★ La tarjeta usa el kit: monograma, cifra en mono y badges de
 *        UI.badge(), no tres spans con emoji propios de esta pantalla.
 *   4  ★ No queda un emoji dibujando interfaz en Inicio ni en el panel. Los
 *        emoji de los AVISOS (showNotification) se quedan: ahí no son
 *        decoración, son el dato que decide si el aviso es crítico.
 *   5  ★ Todo icono que el JS pide está definido en css/utilidades.css. Un
 *        icono sin definir no falla: se queda invisible, que es peor.
 *   6    Las cifras de Inicio son mono tabulares (regla 2 del sistema).
 *   7    La existencia sigue saliendo de existenciaMostrada(): la tarjeta no
 *        puede contradecirse a sí misma.
 *
 *   node pruebas/prueba-redis-r3.js
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
const rend  = leer('js/70-conversion-render.js');
const panel = leer('js/83-panel.js');
const kit   = leer('js/03-ui-kit.js');
const sw    = leer('sw.js');

// ═══ 1 · Inicio conserva TODO su contenido ═════════════════════════════════
// La decisión de Eduardo fue explícita. Esta sección existe para que un
// "rediseño" futuro no se lleve por delante el catálogo.
chk('★ Inicio sigue listando el catálogo de productos',
    /function _renderInicioResultados/.test(rend) && /prd-card/.test(rend),
    'el catálogo se queda en Inicio, por decisión de Eduardo');
chk('★ El buscador del catálogo sigue en Inicio',
    /BusquedaUI\.barra\(/.test(rend) && /_buscarCatalogo\(/.test(rend));
chk('★ Los chips de filtro del catálogo siguen ahí',
    /BusquedaUI\.chips\('catalogo'/.test(rend) && /_chipsCatalogo\(/.test(rend));
chk('★ El resumen de coincidencias y el vacío del buscador siguen ahí',
    /BusquedaUI\.resumen\('catalogo'/.test(rend) && /BusquedaUI\.vacio\('catalogo'/.test(rend));
chk('★ La tarjeta de sincronización sigue en Inicio',
    /sync-card/.test(rend) && /toggleSyncEnabled\(\)/.test(rend));
chk('★ Los reportes publicados siguen en Inicio (solo admin)',
    /inicioReportesLista/.test(rend) && /generarYPublicarReporte\(\)/.test(rend));
chk('★ El panel de mandos sigue siendo el de 83-panel.js',
    /_panelTile\(/.test(panel) && /pm-tile/.test(panel) && /pm-barra/.test(panel));
chk('No se inventó una pestaña nueva para mover nada de Inicio',
    !/activeTab === 'tablero'/.test(rend) && !/case 'tablero'/.test(rend),
    'R3 era aspecto, no arquitectura de navegación');

// ═══ 2 · Los enganches funcionales, intactos ═══════════════════════════════
// Si el rediseño se come uno de estos, lo que se rompe no es el aspecto: es
// el buscador, la ficha de producto o el resaltado de resultados.
[
    ['data-sbx-item',       'el buscador localiza las tarjetas por aquí'],
    ['data-sbx-principal',  'marca el campo principal de cada tarjeta'],
    ['data-pm-ficha',       'abre la ficha de producto del panel'],
    ['has-data',            'distingue el producto con datos de auditoría'],
    ['resaltarBusqueda(',   'pinta el término buscado dentro del nombre']
].forEach(function (par) {
    chk('★ Sigue presente el enganche ' + par[0], rend.indexOf(par[0]) !== -1, par[1]);
});

// ═══ 3 · La tarjeta usa el kit, no su propio dibujo ════════════════════════
chk('★ La tarjeta lleva monograma del kit en vez de hueco de imagen',
    /UI\.mono\(/.test(rend) && /bi-mono/.test(kit),
    'el monograma sustituye a la fotografía que Eduardo no quiere');
chk('★ Los niveles de alerta salen de UI.badge(), no de spans a mano',
    /UI\.badge\(/.test(rend));
chk('★ La existencia va en la clase de cifra del kit',
    /bi-cifra/.test(rend) && /\.bi-cifra/.test(esti));
chk('La cifra se tiñe sola cuando el nivel lo pide',
    /bi-cifra--danger/.test(rend) && /bi-cifra--warn/.test(rend));
chk('★ UI.badge() acepta cambiar la palabra sin inventar un estado nuevo',
    /opciones\.texto != null/.test(kit),
    '"Activa" reusa el tono de sincronizado; el color sigue significando lo mismo');
chk('★ El chip "Solo lectura" está escrito una vez, no tres',
    /function _chipSoloLectura/.test(rend) &&
    (rend.match(/_chipSoloLectura\(\)/g) || []).length >= 4,
    'estaba triplicado con rgba(255,255,255,.55) a mano, ilegible en tema claro');
chk('"Solo lectura" es neutral, no rojo',
    /tono: 'neutral'[^]]*?Solo lectura|Solo lectura[\s\S]{0,80}tono: 'neutral'/.test(rend) ||
    /texto: 'Solo lectura', tono: 'neutral'/.test(rend),
    'que tu rol no escriba no es un fallo; el rojo se reserva para lo que está mal');

// ═══ 4 · Ni un emoji dibujando interfaz ════════════════════════════════════
// Importante: NO se persiguen los emoji de los avisos de texto. En
// showNotification/showConfirm el ⚠️ no es decoración — isCritical() lo lee
// para decidir si el aviso es crítico. Tocarlo sería romper lógica.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
function lineasConEmojiDeInterfaz(texto) {
    return texto.split('\n').map(function (l, i) { return { n: i + 1, l: l }; })
        .filter(function (o) {
            const l = o.l;
            if (!EMOJI.test(l)) return false;
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) return false;            // comentarios
            if (/show(Notification|Confirm|Alert)\s*\(/.test(l)) return false; // avisos de texto
            if (/message\.startsWith|isCritical/.test(l)) return false;        // lógica del aviso
            return /<[a-z]|class=|innerHTML|html \+=|return '/.test(l);        // solo si pinta HTML
        });
}
[['js/70-conversion-render.js', rend], ['js/83-panel.js', panel]].forEach(function (par) {
    const malas = lineasConEmojiDeInterfaz(par[1]);
    chk('★ ' + par[0] + ' no dibuja interfaz con emoji',
        malas.length === 0,
        malas.slice(0, 3).map(function (o) { return o.n + ': ' + o.l.trim().slice(0, 70); }).join(' | '));
});
chk('Los emoji de los avisos de texto siguen intactos (son lógica, no adorno)',
    /message\.startsWith\('⚠️'\)/.test(rend),
    'isCritical() los lee para decidir si el aviso es crítico');

// ═══ 5 · Todo icono pedido existe ══════════════════════════════════════════
// Un icono sin definir no revienta nada: el elemento se queda en blanco. Es
// justo el fallo que nadie reporta y que hace que la app parezca a medias.
const pedidos = new Set();
[rend, panel, html, leer('js/85-ui-inventario-fisico.js')].forEach(function (src) {
    const re = /\bfa-(?!solid\b|regular\b|fw\b|spin\b)[a-z][a-z0-9-]*/g;
    let m;
    while ((m = re.exec(src)) !== null) pedidos.add(m[0]);
});
const faltan = Array.from(pedidos).filter(function (ic) {
    return util.indexOf('.' + ic + ' ') === -1 && util.indexOf('.' + ic + '{') === -1 &&
           !new RegExp('\\.' + ic + '\\s*[,{]').test(util);
});
chk('★ Todo icono que el JS pide está definido en utilidades.css',
    faltan.length === 0, 'sin definir: ' + faltan.join(', '));
chk('Hay iconos de sobra, no un icono por archivo',
    pedidos.size >= 15, 'pedidos: ' + pedidos.size);
chk('★ Los iconos nuevos de R3 están definidos',
    ['fa-xmark', 'fa-circle-exclamation', 'fa-boxes-stacked', 'fa-coins', 'fa-receipt']
        .every(function (ic) { return new RegExp('\\.' + ic + '\\s*[,{ ]').test(util); }));

// ═══ 6 · Las cifras, mono tabulares ════════════════════════════════════════
chk('★ Las cifras del panel son mono tabulares',
    /\.pm-tile__val\s*\{[^}]*font-variant-numeric:\s*tabular-nums/.test(esti),
    'sin tabular-nums las columnas de cifras bailan al cambiar de dígito');
chk('La clase de cifra del kit también es tabular',
    /\.bi-cifra\s*\{[^}]*tabular-nums/.test(esti) ||
    /\.bi-cifra[^{]*\{[^}]*tabular-nums/.test(esti));
chk('El estado vacío de Inicio usa icono y clase, no un style= en línea',
    /inicio-vacio__ico/.test(rend) && /\.inicio-vacio__ico/.test(esti));

// ═══ 7 · La cifra sigue siendo la misma que decide todo ════════════════════
chk('★ La existencia de la tarjeta sale de existenciaMostrada()',
    /const total\s*=\s*existenciaMostrada\(product\)/.test(rend),
    'la misma cifra que decide badges y pedido sugerido: la tarjeta no se contradice');
chk('No se reintrodujo getTotalStock() en la tarjeta',
    !/getTotalStock\(product\)/.test(rend.slice(
        rend.indexOf('_renderInicioResultados'),
        rend.indexOf('_renderInicioResultados') + 6000)),
    'el caché stockByArea se queda rancio — ver claude/analisis-stock-teorico-2026-09-18.md');
chk('El pedido sugerido sigue saliendo de su función, no de un cálculo nuevo',
    /pedidoSugeridoProducto\(product\)/.test(rend));

// ═══ Versión coherente ═════════════════════════════════════════════════════
const vHtml = (html.match(/\?v=(\d+\.\d+)/) || [])[1];
const vSw   = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vHtml && vHtml === vSw,
    'index=' + vHtml + ' sw=' + vSw);
// Comparación por minor, no parseFloat: '5.10' como float da 5.1 (el cero
// a la derecha se pierde) y parecería MENOR que 5.2 — rompía al cruzar a un
// minor de dos cifras por primera vez (corrección 4-oct-2026).
chk('La versión avanzó respecto a R2 (≥ 5.2)', Number((vSw || '').split('.')[1]) >= 2, 'es ' + vSw);

// ═══ Resultado ═════════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── REDISEÑO R3 · Inicio (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
