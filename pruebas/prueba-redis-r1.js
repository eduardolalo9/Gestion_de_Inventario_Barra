#!/usr/bin/env node
/**
 * prueba-redis-r1.js — REDISEÑO R1 · cimientos · comprobaciones estáticas
 * ═══════════════════════════════════════════════════════════════════════════
 * Autorizado por Eduardo (2-oct-2026), decisiones confirmadas:
 *   D1  Una sola navegación (barra inferior + "Más")  → fase R2
 *   D2  Retirar Tailwind y Font Awesome del CDN       → ESTA FASE
 *   D3  Conservar el modal de captura del conteo      → no se toca el flujo
 *   D4  Inicio como tablero, catálogo a su pestaña    → fase R3
 *
 * R1 son los cimientos: tokens re-tematizados, kit de componentes y el
 * retiro de los dos CDN. La prueba que más importa de este archivo es la de
 * COBERTURA: al quitar Tailwind, cualquier clase que la app use y que no
 * esté definida localmente deja un elemento sin estilo — y eso no se ve en
 * una prueba de lógica, solo en pantalla y tarde.
 *
 *   1  ★ Cobertura: TODA clase de utilidad usada en el HTML/JS está definida
 *        en css/utilidades.css. Cero huérfanas.
 *   2  ★ Los dos CDN ya no se cargan, y lo local sí (orden incluido).
 *   3  ★ Las clases de paleta clara apuntan a TOKENS, no a blanco/gris fijo:
 *        es lo que arregla el modo oscuro sin tocar el HTML.
 *   4    Tokens de "Carbón & Latón" en los dos temas, con los alias viejos
 *        intactos (miles de reglas los usan).
 *   5    Los 23 iconos de Font Awesome que la app usa tienen máscara local.
 *   6  ★ El kit aplica solo las reglas del sistema: cifras en mono, badge con
 *        color Y palabra, fila accionable como <button>, 44 px táctiles,
 *        y "sin dato" nunca se convierte en un cero inventado.
 *
 *   node pruebas/prueba-redis-r1.js
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
const util  = leer('css/utilidades.css');
const esti  = leer('css/estilos.css');
const kit   = leer('js/03-ui-kit.js');
const sw    = leer('sw.js');
const jsDir = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js'));
const todoJs = jsDir.map(f => leer('js/' + f)).join('\n');

// ═══ 1 · COBERTURA — ninguna clase de utilidad quedó sin definir ════════════
// Se recogen las clases de los atributos class="…" del HTML y de los que la
// app genera en cadenas de JavaScript, se descartan las familias propias
// (pm-*, if-*, prd-*…) y lo que quede —las utilidades tipo Tailwind— tiene
// que existir en css/utilidades.css o en estilos.css.
const PREFIJOS_PROPIOS = /^(pm|if|prd|inv|rc|audit|sbx|csb|vt|adm|ni|grp|notif|stat|btab|bt|role|rep|login|ajuste|sync|inicio|modal|bi|fa|tab|sb|meCls|has|primary|warn|pend|num)\b|^(fa-|bi-|pm-|if-|prd-|inv-|rc-|audit-|sbx|csb-|vt-|adm-|ni-|grp-|notif-|stat-|btab-|bt-|role-|rep-|login-|ajuste-|sync-|inicio-|modal-|tab-|sb-)/;

// Utilidades que son una sola palabra sin guion: sin esta lista habría que
// aceptar cualquier identificador suelto, y entrarían restos de JavaScript.
const UTILIDADES_DE_UNA_PALABRA = new Set([
    'flex', 'grid', 'block', 'hidden', 'relative', 'absolute', 'fixed', 'sticky',
    'border', 'rounded', 'truncate', 'uppercase', 'antialiased', 'transform',
    'num', 'primary', 'warn', 'pend'
]);

function clasesDe(fuente) {
    const out = new Set();
    const re = /class=(?:"([^"]*)"|\\'([^']*)\\'|'([^']*)')/g;
    let m;
    while ((m = re.exec(fuente)) !== null) {
        const bruto = m[1] || m[2] || m[3] || '';
        bruto.split(/\s+/).forEach(function(c) {
            c = c.trim();
            // Se saltan los fragmentos con interpolación o concatenación…
            if (!c || /[{}$+'"`()\[\]]/.test(c)) return;
            // …y los restos de expresión JavaScript que el atributo deja al
            // partirse por espacios (class="x ' + cls + ' y" → cls, +, ===…).
            // Una clase de utilidad real empieza por letra o por '-' y solo
            // lleva letras, dígitos, '-', '.', '/' o ':' (variantes de
            // Tailwind). Lo que no encaje en eso no es una clase.
            if (!/^-?[a-z][a-z0-9:./-]*$/i.test(c)) return;
            // Identificadores de JavaScript sueltos (una sola palabra sin
            // guion, dos puntos ni punto) que no son utilidades conocidas.
            if (/^[a-z][a-zA-Z0-9]*$/.test(c) && !UTILIDADES_DE_UNA_PALABRA.has(c)) return;
            // En una utilidad, el punto siempre separa un decimal (py-2.5,
            // h-1.5); un punto entre letras es acceso a propiedad de un
            // objeto (extra.clase), no una clase.
            if (c.includes('.') && !/\.\d/.test(c)) return;
            out.add(c);
        });
    }
    return out;
}

const usadas = new Set([...clasesDe(html), ...clasesDe(todoJs)]);
const utilidades = [...usadas].filter(c => !PREFIJOS_PROPIOS.test(c));

// Una clase está "definida" si aparece como selector en cualquiera de las dos
// hojas. Se escapan los caracteres que CSS necesita escapar (:, /, ., [, ]).
function definida(clase) {
    const escapada = clase.replace(/[.:\/\[\]()]/g, (ch) => '\\\\?' + ch.replace(/[.[\]()]/g, '\\$&'));
    const re = new RegExp('\\.' + escapada + '(?![\\w-])');
    return re.test(util) || re.test(esti);
}

const huerfanas = utilidades.filter(c => !definida(c));
chk('★ COBERTURA · ninguna clase de utilidad quedó sin estilo al retirar Tailwind',
    huerfanas.length === 0,
    huerfanas.length ? ('sin definir: ' + huerfanas.join(' ')) : '');
chk('La cobertura se midió sobre un número realista de clases (la prueba no está vacía)',
    utilidades.length >= 100, 'clases de utilidad detectadas: ' + utilidades.length);

// ═══ 2 · Los CDN se fueron, lo local llegó ═════════════════════════════════
// Se comprueba que no haya ETIQUETA que los cargue, no que no se mencionen:
// el comentario que documenta por qué se retiraron sí nombra los dominios, y
// debe poder seguir ahí para que nadie los vuelva a añadir sin leer el motivo.
const sinComentarios = html.replace(/<!--[\s\S]*?-->/g, '');
chk('★ Tailwind ya no se carga de un CDN',
    !/<script[^>]+cdn\.tailwindcss\.com/.test(sinComentarios),
    'el dominio solo puede aparecer en el comentario que explica por qué se quitó');
chk('★ Font Awesome ya no se carga de un CDN',
    !/<link[^>]+font-awesome/.test(sinComentarios));
chk('SheetJS SÍ sigue en CDN (solo se usa al exportar/importar, con conexión)',
    /xlsx\.full\.min\.js/.test(html),
    'quitarlo habría sido pasarse de la raya: no afecta a cómo se ve la app');
chk('★ css/utilidades.css se carga ANTES de estilos.css (las reglas propias mandan)',
    html.indexOf('css/utilidades.css') !== -1 &&
    html.indexOf('css/utilidades.css') < html.indexOf('css/estilos.css'));
chk('js/03-ui-kit.js se carga después del núcleo (necesita escapeHtml)',
    html.indexOf('js/00-nucleo.js') < html.indexOf('js/03-ui-kit.js'));
chk('★ El Service Worker precarga los dos archivos nuevos',
    /utilidades\.css/.test(sw) && /03-ui-kit\.js/.test(sw),
    'sin esto, offline-first se quedaría sin los estilos que acabamos de internalizar');
// Se comprueba COHERENCIA y que el rediseño ya empezó (≥ 5.0), no un número
// exacto: cada fase del rediseño sube la versión (R1 → 5.0, R2 → 5.1…) y una
// aserción con el número clavado haría fallar esta prueba en cada fase
// siguiente sin que nada esté roto.
const versionSw = (/APP_VERSION = '([^']+)'/.exec(sw) || [])[1];
const versionesHtml = [...new Set([...html.matchAll(/(?:src|href)="(?:js|css)\/[^"?]+\.(?:js|css)\?v=([^"]*)"/g)].map(m => m[1]))];
chk('La versión es la del rediseño (≥ 5.0) y coincide en index.html y sw.js',
    versionesHtml.length === 1 && versionesHtml[0] === versionSw && parseFloat(versionSw) >= 5.0,
    'sw.js: ' + versionSw + ' · index.html: ' + versionesHtml.join(', '));
chk('Una sola versión en todas las etiquetas de index.html',
    versionesHtml.length === 1, versionesHtml.join(', '));

// ═══ 3 · El arreglo del modo oscuro: color por token, no fijo ══════════════
function reglaDe(hoja, selector) {
    const re = new RegExp('\\' + selector + '\\s*\\{([^}]*)\\}');
    const m = re.exec(hoja);
    return m ? m[1] : '';
}
chk('★ bg-white ya no es blanco: resuelve al token de superficie del tema',
    /var\(--card\)/.test(reglaDe(util, '.bg-white')),
    reglaDe(util, '.bg-white'));
chk('★ text-gray-900 resuelve al token de texto primario',
    /var\(--txt-primary\)/.test(reglaDe(util, '.text-gray-900')));
chk('text-gray-600 y text-gray-500 resuelven a tokens, no a grises fijos',
    /var\(--txt-secondary\)/.test(reglaDe(util, '.text-gray-600')) &&
    /var\(--txt-muted\)/.test(reglaDe(util, '.text-gray-500')));
chk('border-gray-200 resuelve al token de borde',
    /var\(--border-mid\)/.test(reglaDe(util, '.border-gray-200')));
chk('★ El velo del modal usa el token --scrim (un solo sitio que lo define)',
    /var\(--scrim\)/.test(reglaDe(util, '.bg-black')) && /--scrim:/.test(esti));
chk('Los colores sueltos de Tailwind entraron al sistema semántico',
    /var\(--book\)/.test(util) && /var\(--warn\)/.test(util) && /var\(--info\)/.test(util),
    'morado → estado contable, naranja → atención, azul → información');
chk('Ninguna utilidad de color dejó un gris de Tailwind escrito a mano',
    !/#(?:f9fafb|f3f4f6|e5e7eb|d1d5db|9ca3af|6b7280|4b5563|374151|1f2937|111827)/i.test(util));
chk('El preflight que la app necesitaba se replicó (márgenes de títulos a cero)',
    /h1, h2, h3, h4, h5, h6, p[^{]*\{\s*margin: 0/.test(util),
    'sin esto, al quitar Tailwind cada h2 y cada p recupera el margen del navegador');

// ═══ 4 · Tokens de Carbón & Latón ══════════════════════════════════════════
const raiz = (/:root\s*\{([\s\S]*?)\n\}/.exec(esti) || ['', ''])[1];
const claro = (/html\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/.exec(esti) || ['', ''])[1];
chk('★ El acento es latón (#E8B55C), no el azul anterior',
    /--accent:\s*#E8B55C/i.test(raiz) && !/#a8c7fa/i.test(raiz));
chk('El texto sobre latón es oscuro (contraste), no blanco',
    /--accent-on:\s*#2A1D05/i.test(raiz));
chk('Existen los alias nuevos (--brass, --ok, --warn, --info, --danger, --book)',
    ['--brass:', '--ok:', '--warn:', '--info:', '--danger:', '--book:'].every(t => raiz.includes(t)));
chk('★ Los nombres viejos siguen existiendo (--green/--red/--amber/--sky): miles de reglas los usan',
    ['--green:', '--red:', '--amber:', '--sky:'].every(t => raiz.includes(t)));
chk('El fondo es carbón azulado, no negro plano',
    /--bg:\s*#0E1013/i.test(raiz));
chk('★ El tema claro usa bronce, no el mismo amarillo (que no pasaría contraste)',
    /--accent:\s*#8A5A14/i.test(claro) && /--accent-on:\s*#FFFFFF/i.test(claro));
chk('El tema claro define también --book y --scrim (paridad con el oscuro)',
    /--book:/.test(claro) && /--scrim:/.test(claro));

// ═══ 5 · Iconos locales ════════════════════════════════════════════════════
const iconosUsados = [...new Set((html + todoJs).match(/fa-[a-z0-9-]+/g) || [])]
    .filter(c => !['fa-solid', 'fa-regular', 'fa-brands', 'fa-fw', 'fa-spin', 'fa-lg', 'fa-sm', 'fa-xs'].includes(c));
const iconosSinDefinir = iconosUsados.filter(c => !new RegExp('\\.' + c + '(?![\\w-])').test(util));
chk('★ Los ' + iconosUsados.length + ' iconos que la app usa tienen máscara local',
    iconosSinDefinir.length === 0, iconosSinDefinir.join(' '));
chk('El icono hereda el color del texto (máscara, no imagen de color fijo)',
    /background-color: currentColor/.test(util) && /mask-image: var\(--bi-icono\)/.test(util),
    'así un icono dentro de un badge verde sale verde sin tocar nada');

// ═══ 6 · El kit aplica las reglas del sistema por sí solo ══════════════════
chk('Existe el kit con sus componentes',
    /window\.UI = UI;/.test(kit) &&
    ['badge', 'mono', 'cifra', 'meter', 'btn', 'card', 'row', 'kpi', 'field', 'stepper', 'seccion']
        .every(f => new RegExp('function ' + f + '\\(').test(kit)));
chk('★ Un badge nunca es solo color: siempre lleva la palabra del estado',
    /ESTADOS = \{/.test(kit) && /texto:/.test(kit) &&
    /esc\(def\.texto\)/.test(kit));
chk('★ Toda cifra sale en mono tabular',
    /font-variant-numeric: tabular-nums/.test(esti) &&
    /class="num bi-cifra/.test(kit));
chk('★ Sin dato numérico se muestra un guion, nunca un cero inventado',
    /bi-cifra--sin-dato[^>]*>—</.test(kit) || /sin-dato[\s\S]{0,40}—/.test(kit),
    'mismo criterio de honestidad que factorAUnidadProducto y pedidoSugeridoProducto');
chk('★ Una fila accionable es un <button>, no un div con onclick',
    /etiqueta = 'button'/.test(kit) && /Un div con onclick no recibe foco con Tab/.test(kit));
chk('★ Los controles táctiles miden 44 px',
    /min-height: 44px/.test(esti) && /width: 44px; height: 44px/.test(esti));
chk('El medidor informa el avance por texto, no solo por color',
    /role="img" aria-label="Avance/.test(kit));
chk('El stepper permite teclear la cantidad, no solo tocar − y +',
    /class="num bi-stepper__val" type="text"/.test(kit));
chk('Todo dato de usuario pasa por escapeHtml',
    /function esc\(v\)/.test(kit) && /typeof escapeHtml === 'function'/.test(kit));
chk('El kit no reimplementa lógica de negocio (solo pinta)',
    !/convertirOzAPuntos|existenciaMostrada|firestore|_db/.test(kit));
chk('Los tres niveles de FASE 11B están en el diccionario de estados',
    /bajo:/.test(kit) && /advertencia:/.test(kit) && /limitado:/.test(kit));
chk('El estado contable de FASE 13 tiene su propio color, no reusa uno',
    /contabilizado:[\s\S]{0,60}tono: 'book'/.test(kit) && /corte_mes:/.test(kit));

// ═══ Resultado ═════════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── REDISEÑO R1 · cimientos: tokens, kit y sin CDN (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
