#!/usr/bin/env node
/**
 * prueba-redis-r2.js — REDISEÑO R2 · una sola navegación · estática
 * ═══════════════════════════════════════════════════════════════════════════
 * Autorizado por Eduardo (2-oct-2026): "sí, unificar las tres navegaciones en
 * una sola".
 *
 * CORRECCIÓN A LA AUDITORÍA. El informe de auditoría dijo que había tres
 * navegaciones VISIBLES. Al implementarlo se vio que no: la barra horizontal
 * de pestañas (.tab-btn) llevaba `display:none !important` desde varias
 * versiones, con el comentario "Tabs ocultos (necesarios para switchTab)". No
 * era una tercera navegación a la vista, era código muerto que seguía en pie
 * solo porque switchTab() pintaba y quitaba un indicador dentro de botones
 * invisibles en cada cambio de pestaña. Visibles había dos: la barra inferior
 * y el panel lateral. R2 retira el residuo y deja la jerarquía explícita.
 *
 *   1  ★ El residuo .tab-btn desapareció del HTML, del JS y del CSS.
 *   2  ★ switchTab() sincroniza SOLO la barra inferior y la hoja "Más", y
 *        marca el destino activo con aria-current (no solo con color).
 *   3    Los destinos no cambiaron: el equipo ya los tiene aprendidos.
 *   4  ★ No queda ni un color de la paleta azul/morada anterior escrito a
 *        mano: si quedara, esa parte de la app seguiría viéndose "vieja"
 *        aunque los tokens hayan cambiado.
 *   5    El glosario de estados usa el kit, no su propia píldora de colores.
 *
 *   node pruebas/prueba-redis-r2.js
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
const flujo = leer('js/75-auditoria-flujo.js');
const jsDir = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js'));
const todoJs = jsDir.map(f => leer('js/' + f)).join('\n');

// ═══ 1 · El residuo muerto ya no está ══════════════════════════════════════
chk('★ No queda ningún botón .tab-btn en el HTML',
    !/class="[^"]*\btab-btn\b/.test(html));
chk('★ El id #tabs (su contenedor) desapareció del HTML',
    !/id="tabs"/.test(html));
chk('★ switchTab() ya no recorre .tab-btn ni fabrica .tab-indicator',
    !/querySelectorAll\('\.tab-btn'\)/.test(todoJs) &&
    !/tab-indicator/.test(todoJs.replace(/\/\/[^\n]*/g, '')),
    'quedaba un bucle pintando un indicador dentro de botones invisibles');
chk('El CSS ya no estiliza .tab-btn',
    !/\.tab-btn(?![\w-])/.test(esti) && !/\.tab-btn(?![\w-])/.test(util));
// El comentario que explica el retiro tiene que sobrevivir al propio retiro:
// es lo único que impide que alguien vuelva a añadir la barra "porque
// switchTab la necesita". (No se comprueba la ausencia de `display:none` en
// todo el HTML: hay usos legítimos, como el botón de administración que se
// oculta según el rol.)
chk('Queda escrito en el código POR QUÉ se retiró (para que nadie lo reponga)',
    /REDISEÑO R2[\s\S]{0,400}barra horizontal de pestañas[\s\S]{0,400}bottomTabBar/.test(html),
    'falta el comentario de retiro en index.html');

// ═══ 2 · Una sola navegación, con jerarquía explícita ══════════════════════
const switchTab = (() => {
    const i = rend.indexOf('function switchTab(');
    if (i === -1) return '';
    let nivel = 0, dentro = false;
    for (let j = i; j < rend.length; j++) {
        if (rend[j] === '{') { nivel++; dentro = true; }
        else if (rend[j] === '}') { nivel--; if (dentro && nivel === 0) return rend.slice(i, j + 1); }
    }
    return '';
})();
chk('switchTab() existe', !!switchTab);
chk('★ Sincroniza la barra inferior (navegación primaria)',
    /#bottomTabBar \.btab-item/.test(switchTab));
chk('★ Sincroniza la hoja "Más" (el panel lateral)',
    /\.sb-item/.test(switchTab));
chk('★ El destino activo se marca con aria-current, no solo con color',
    (switchTab.match(/aria-current/g) || []).length >= 2,
    'el color por sí solo no le dice a un lector de pantalla dónde está uno');
chk('No sincroniza ninguna tercera navegación',
    (switchTab.match(/querySelectorAll/g) || []).length === 2,
    'dos consultas: barra inferior y hoja Más');
chk('Sigue guardando el estado y repintando (no se perdió nada de su trabajo)',
    /saveToLocalStorage\(\);/.test(switchTab) && /renderTab\(\);/.test(switchTab));

// ═══ 3 · Los destinos no cambiaron ═════════════════════════════════════════
const DESTINOS_BARRA = ['inicio', 'inventario', 'pedidos', 'compras'];
chk('★ La barra inferior conserva sus cuatro destinos + "Más"',
    DESTINOS_BARRA.every(d => new RegExp('data-btab="' + d + '"').test(html)) &&
    /onclick="sbOpen\(\)"/.test(html),
    'cambiar los destinos en esta fase habría movido hábitos sin necesidad');
const MODULOS = ['inicio', 'productos', 'pedidos', 'inventario', 'compras',
                 'recetario', 'ventas', 'historia', 'ajustes', 'notificaciones', 'admin'];
chk('Los 11 módulos siguen accesibles desde la hoja "Más"',
    MODULOS.every(m => new RegExp('data-sb-tab="' + m + '"').test(html)),
    MODULOS.filter(m => !new RegExp('data-sb-tab="' + m + '"').test(html)).join(' '));
chk('El router de pestañas sigue atendiendo los 11 módulos',
    MODULOS.every(m => new RegExp("case '" + m + "':").test(rend)));

// ═══ 4 · Ni un color de la paleta anterior escrito a mano ══════════════════
// Son los azules y morados del tema viejo (baseline M3 y paleta de Tailwind).
// Mientras sigan escritos a mano, esas zonas no obedecen al tema: se quedan
// azules aunque el acento ahora sea latón.
const PALETA_VIEJA = /rgba\(\s*59,\s*130,\s*246|rgba\(\s*26,\s*91,\s*186|rgba\(\s*29,\s*78,\s*216|rgba\(\s*96,\s*165,\s*250|rgba\(\s*129,\s*140,\s*248|#1d4ed8|#2563eb|#1e40af|#60a5fa|#818cf8|#7c3aed|#1d1d2a|#ede8f4|#eff6ff|#a8c7fa|#1a5bba|#4B8BF5/i;
['css/estilos.css', 'css/utilidades.css'].forEach(function(f) {
    const src = leer(f);
    const lineas = src.split('\n')
        .map((l, i) => ({ n: i + 1, l }))
        .filter(x => PALETA_VIEJA.test(x.l) && !/^\s*(\/\*|\*|\/\/)/.test(x.l));
    chk('★ ' + f + ' no conserva colores de la paleta anterior',
        lineas.length === 0, lineas.slice(0, 4).map(x => x.n + ': ' + x.l.trim().slice(0, 60)).join(' | '));
});
jsDir.forEach(function(f) {
    const src = leer('js/' + f);
    const lineas = src.split('\n')
        .map((l, i) => ({ n: i + 1, l }))
        .filter(x => PALETA_VIEJA.test(x.l) && !/^\s*(\/\/|\*|\/\*)/.test(x.l));
    if (lineas.length) {
        chk('js/' + f + ' no conserva colores de la paleta anterior', false,
            lineas.slice(0, 3).map(x => x.n + ': ' + x.l.trim().slice(0, 60)).join(' | '));
    }
});
chk('★ Ningún archivo JS conserva colores de la paleta anterior',
    !jsDir.some(f => leer('js/' + f).split('\n')
        .some(l => PALETA_VIEJA.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))));

// ═══ 5 · El glosario de estados usa el kit ═════════════════════════════════
chk('★ El glosario de estados ya no define sus propios colores',
    !/color:\s*'#/.test(flujo.slice(flujo.indexOf('ESTADOS_INVENTARIO'), flujo.indexOf('ESTADOS_INVENTARIO') + 1400)),
    'tenía #60a5fa, #4ade80 y #818cf8 propios, en paralelo a los badges del resto');
chk('★ _pillEstadoInventario() pinta con UI.badge(), no con su propia píldora',
    /UI\.badge\(/.test(flujo) && /function _pillEstadoInventario/.test(flujo));
chk('El glosario conserva la explicación de cada estado (eso sí era suyo)',
    /Conteo en curso/.test(flujo) && /Cerrado e inmutable/.test(flujo) &&
    /stock inicial de la semana siguiente/.test(flujo));
chk('Un estado desconocido sale en gris, sin inventarle un color',
    /tono: 'neutral'/.test(flujo));

// ═══ Resultado ═════════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── REDISEÑO R2 · una sola navegación (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
