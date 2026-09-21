#!/usr/bin/env node
/**
 * prueba-fase6.js — FASE 6: buscadores
 * ═══════════════════════════════════════════════════════════════════════════
 * Dos partes:
 *   1. El MOTOR se ejecuta de verdad (es código puro: sin DOM ni Firestore)
 *      contra un catálogo sintético de 2000 productos.
 *   2. La INTEGRACIÓN se verifica leyendo los archivos: que cada vista use la
 *      barra unificada, que el conteo no herede la búsqueda del catálogo, que
 *      buscar no reconstruya la pestaña ni guarde el estado por tecla.
 * La prueba en navegador real está en prueba-fase6-navegador.js.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.resolve(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8').replace(/\r/g, '');
const casos = []; let fallos = 0;
function chk(nombre, ok, detalle) { casos.push({ nombre, ok: !!ok, detalle: detalle || '' }); if (!ok) fallos++; }

// ═══ 1 · MOTOR (ejecutado) ═════════════════════════════════════════════════
const motorSrc = leer('js/05-busqueda-motor.js');
const ctx = { performance, console };
vm.createContext(ctx);
vm.runInContext(motorSrc, ctx);
const { crearMotorBusqueda, createSearchEngine, normalizarBusqueda, tokenizarBusqueda, resaltarBusqueda } = ctx;

chk('El motor expone crearMotorBusqueda y el alias createSearchEngine',
    typeof crearMotorBusqueda === 'function' && createSearchEngine === crearMotorBusqueda);
chk('Normaliza minúsculas, acentos y ñ', normalizarBusqueda('  Añejo  ÚNICO Ñandú ') === 'anejo unico nandu');
chk('Conserva el punto decimal ("1.75") y separa lo demás',
    normalizarBusqueda('1.75 LT / Don-Julio') === '1.75 lt don julio');
chk('Tokeniza sin repetidos', JSON.stringify(tokenizarBusqueda('don JULIO don')) === '["don","julio"]');
chk('Limita la consulta a 8 palabras', tokenizarBusqueda('a1 b2 c3 d4 e5 f6 g7 h8 i9 j10').length === 8);

const marcas = ['DON JULIO', 'MAESTRO DOBEL', '1800', 'HERRADURA', 'JOSE CUERVO', 'BACARDI', 'CAPTAIN MORGAN', 'ABSOLUT',
                'SMIRNOFF', 'JOHNNIE WALKER', 'BUCHANANS', 'CINZANO', 'APEROL', 'CAMPARI', 'JAGERMEISTER', 'TORRES',
                'MARTELL', 'HENNESSY', 'BEEFEATER', 'TANQUERAY'];
const tipos = ['BLANCO', 'REPOSADO', 'AÑEJO', 'CRISTALINO', '70', 'DIAMANTE', 'ETIQUETA ROJA', 'ETIQUETA NEGRA',
               '12 AÑOS', '18 AÑOS', 'PRO SPRITZ', 'GOLD', 'SPICED', 'CITRON'];
const tam = ['700 ML', '750 ML', '1 LT', '1.75 LT', '375 ML'];
const grupos = ['TEQUILA', 'RON', 'VODKA', 'WHISKY', 'APERITIVO', 'BRANDY', 'GINEBRA', 'MEZCAL'];
const P = [];
for (let i = 0; P.length < 2000; i++) {
    P.push({ id: String(1180000 + i), name: marcas[i % 20] + ' ' + tipos[Math.floor(i / 20) % 14] + ' ' + tam[Math.floor(i / 280) % 5],
             group: grupos[i % 8], pv: 'PV' + i });
}
const motor = crearMotorBusqueda({ claves: [
    { nombre: 'name', peso: 3 }, { nombre: 'id', peso: 2, codigo: true },
    { nombre: 'pv', peso: 2, codigo: true }, { nombre: 'group', peso: 1 }] });

let r = motor.buscar(P, '');
chk('Consulta vacía devuelve todo, en el orden original', r.coincidencias === 2000 && r.items[0] === P[0] && r.items[1999] === P[1999]);
r = motor.buscar(P, '1180015');
chk('Un código completo devuelve UN solo producto (antes ~1200)', r.coincidencias === 1 && r.items[0].id === '1180015',
    r.coincidencias + ' resultados');
r = motor.buscar(P, 'pv15');
chk('El PV también se busca como código exacto', r.items[0] && r.items[0].pv === 'PV15');
r = motor.buscar(P, '1180');
// 1000 ids 1180000-1180999 + el producto cuyo PV es "PV1180" (contiene el código).
chk('Un código parcial busca por prefijo/contenido, sin difuso',
    r.coincidencias === 1001 && r.difusos.length === 0 && r.items.slice(0, 1000).every(p => p.id.indexOf('1180') === 0), r.coincidencias);
r = motor.buscar(P, 'anejo');
chk('"anejo" encuentra "AÑEJO" sin usar el respaldo difuso',
    r.coincidencias > 0 && r.items.every(p => /AÑEJO/.test(p.name)) && r.difusos.length === 0, r.coincidencias);
r = motor.buscar(P, 'reposdo');
chk('Un typo ("reposdo") usa el respaldo difuso y encuentra REPOSADO',
    r.coincidencias > 0 && r.difusos[0] === 'reposdo' && /REPOSADO/.test(r.items[0].name));
r = motor.buscar(P, 'don julio reposado');
chk('Varias palabras: todas deben aparecer (Y lógico)',
    r.coincidencias > 0 && r.items.every(p => /DON JULIO REPOSADO/.test(p.name)));
r = motor.buscar(P, 'julio don');
chk('La frase en orden puntúa más que las palabras sueltas',
    motor.buscar(P, 'don julio').items[0].name.indexOf('DON JULIO') === 0 && r.items.every(p => /DON JULIO/.test(p.name)));
r = motor.buscar(P, 'zzqqxx');
chk('Sin coincidencias devuelve 0 sin lanzar', r.coincidencias === 0 && r.total === 2000);
r = motor.buscar(P, 'don', { filtro: p => p.group === 'TEQUILA' });
chk('El filtro se aplica antes: total = los que pasan el filtro', r.total === 250 && r.items.every(p => p.group === 'TEQUILA'));

const orden = motor.buscar(P, 'tequila').items;
const esEstable = orden.every((p, i) => i === 0 || Number(orden[i - 1].id) < Number(p.id) ||
    motor.buscar([orden[i - 1]], 'tequila').items.length === 1);
chk('Empates conservan el orden original de la lista', esEstable);

const antes = motor.buscar(P, 'zacapa').coincidencias;
P[7].name = 'RON ZACAPA 23';
chk('Editar un producto en sitio se refleja sin invalidar nada a mano',
    antes === 0 && motor.buscar(P, 'zacapa').coincidencias === 1);
chk('Elementos nulos en la lista se ignoran sin error',
    motor.buscar([null, P[0], undefined], 'julio').coincidencias === 1);

motor.buscar(P, 'x');                       // calentar índice
let suma = 0;
for (let i = 0; i < 30; i++) suma += motor.buscar(P, 'herradura rep').ms;
const prom = suma / 30;
chk('2000 productos: búsqueda con índice caliente < 25 ms en promedio', prom < 25, prom.toFixed(2) + ' ms');

chk('Resaltar escapa cada tramo: "amp" no rompe "&amp;"',
    resaltarBusqueda('RON & COLA', 'amp') === 'RON &amp; COLA');
chk('Resaltar no permite inyectar HTML',
    resaltarBusqueda('<img src=x onerror=alert(1)>', 'img') === '&lt;<mark class="sb-mark">img</mark> src=x onerror=alert(1)&gt;');
chk('Resaltar entiende acentos: "anejo" marca "Añejo"',
    resaltarBusqueda('Don Julio Añejo', 'anejo') === 'Don Julio <mark class="sb-mark">Añejo</mark>');
chk('Resaltar une coincidencias contiguas',
    resaltarBusqueda('DONJULIO', 'don donj') === '<mark class="sb-mark">DONJ</mark>ULIO');

// ═══ 2 · INTEGRACIÓN (lectura de código) ═══════════════════════════════════
const html   = leer('index.html');
const sw     = leer('sw.js');
const ui     = leer('js/06-busqueda-ui.js');
const app    = leer('js/80-buscador.js');
const render = leer('js/70-conversion-render.js');
const inv    = leer('js/85-ui-inventario-fisico.js');
const aud    = leer('js/75-auditoria-flujo.js');
const fire   = leer('js/40-firestore.js');

const posMotor = html.indexOf('js/05-busqueda-motor.js'), posUi = html.indexOf('js/06-busqueda-ui.js');
chk('index.html carga el motor y la barra antes que el resto de la app',
    posMotor > 0 && posUi > posMotor && posUi < html.indexOf('js/10-multiusuario.js'));
chk('El Service Worker incluye los dos archivos nuevos',
    /05-busqueda-motor\.js/.test(sw) && /06-busqueda-ui\.js/.test(sw));
chk('La versión de caché subió por encima de 4.0 (FASE 5)',
    (() => { const m = /const APP_VERSION = '([^']+)'/.exec(sw); return m && parseFloat(m[1]) > 4.0; })());

['catalogo', 'conteo', 'pedidos', 'historia'].forEach(k => {
    chk('Buscador "' + k + '" registrado con alAplicar y refrescar',
        new RegExp("BusquedaUI\\.registrar\\('" + k + "', \\{[\\s\\S]{0,500}?alAplicar[\\s\\S]{0,300}?refrescar").test(app));
});
[['Inicio', render, "function renderInicioTab"], ['Productos', render, "function renderProductosTab"],
 ['Pedidos', render, "function renderPedidosTab"], ['Conteo', inv, "function renderAuditoriaConteo"],
 ['Historia', inv, "function renderHistoriaTab"]].forEach(([n, src, fn]) => {
    const i = src.indexOf(fn); const cuerpo = i === -1 ? '' : src.slice(i, src.indexOf('\n        }\n', i));
    chk(n + ' usa la barra unificada y una región de resultados',
        /BusquedaUI\.barra\(/.test(cuerpo) && /BusquedaUI\.region\(/.test(cuerpo), fn);
});
chk('Ya no queda ningún input de búsqueda con oninput en línea',
    !/oninput="update(Search|Conteo|Pedidos|Historia)/.test(render + inv));
chk('Las copias duplicadas de puntuación difusa desaparecieron',
    !/function _csFuzzyMatchOrder|function _csFuzzyMatchInventario/.test(app + aud + inv));

// El bug del filtro oculto
const iConteo = inv.indexOf('function _renderConteoResultados');
const cConteo = iConteo === -1 ? '' : inv.slice(iConteo, inv.indexOf('\n        }\n', iConteo));
chk('El conteo usa su propia búsqueda (_buscarConteo), no filterByGroup()',
    /_buscarConteo\(/.test(cConteo) && !/filterByGroup\(\)/.test(cConteo));
const iBC = app.indexOf('function _buscarConteo');
const cBC = iBC === -1 ? '' : app.slice(iBC, app.indexOf('\n        }\n', iBC));
chk('_buscarConteo NO lee searchTerm (la búsqueda del catálogo)',
    cBC.length > 0 && !/[^_a-zA-Z]searchTerm/.test(cBC.replace(/_conteoSearchTerm/g, '')));
chk('Al abrir la app ya no se restaura la búsqueda del catálogo',
    !/if \(storedSearch\) searchTerm\s*=/.test(fire));

// Rendimiento: buscar no reconstruye la pestaña ni guarda el estado
const iUST = render.indexOf('function updateSearchTerm(value) {');
const cUST = render.slice(iUST, render.indexOf('\n        }', iUST));
chk('updateSearchTerm ya no llama a renderTab() ni a saveToLocalStorage()',
    iUST !== -1 && !/renderTab\(\)|saveToLocalStorage\(\)/.test(cUST));
const iRef = ui.indexOf('function refrescar(key');
const cRef = ui.slice(iRef, ui.indexOf('\n            }\n', iRef));
chk('Refrescar reescribe solo la región (no llama a renderTab)', iRef !== -1 && !/renderTab/.test(cRef));
chk('renderTab() avisa a BusquedaUI después de pintar', /BusquedaUI\.trasRender\(\)/.test(render));
chk('Debounce por defecto dentro del rango pedido (150-250 ms)',
    (() => { const m = /debounceMs:\s*(\d+)/.exec(ui); return m && +m[1] >= 150 && +m[1] <= 250; })());
chk('No se ignora isComposing (Gboard compone cada palabra en Android)',
    !/if \(e\.isComposing\)|e\.isComposing\s*\)\s*return/.test(ui));

// UX y accesibilidad
chk('La barra tiene role="search", label asociado, combobox y aria-controls',
    /role="search"/.test(ui) && /<label class="sbx-sr" for="sbx-input-/.test(ui) &&
    /role="combobox"/.test(ui) && /aria-controls="sbx-res-/.test(ui));
chk('Hay región viva (aria-live) para anunciar el número de resultados', /role="status" aria-live="polite"/.test(ui));
chk('Teclado: ↑ ↓ Enter Esc manejados', ["'ArrowDown'", "'ArrowUp'", "'Enter'", "'Escape'"].every(k => ui.indexOf(k) !== -1));
chk('Esc detiene la propagación (no cierra el menú lateral ni sale del área)',
    /case 'Escape':[\s\S]{0,120}?e\.stopPropagation\(\)/.test(ui));
chk('Historial de recientes limitado a 8 y con localStorage protegido',
    /HIST_MAX\s*=\s*8/.test(ui) && /function _lsGet[\s\S]{0,120}?try \{/.test(ui) && /function _lsSet[\s\S]{0,120}?try \{/.test(ui));
chk('Teclado numérico conmutable (inputmode) para buscar por código', /inputmode="' \+ \(numerico \? 'numeric' : 'search'\)/.test(ui));
chk('Carga incremental con IntersectionObserver y botón de respaldo',
    /new IntersectionObserver/.test(ui) && /data-sbx-accion="mas"/.test(ui));
chk('La barra se resalta con el tema (tokens, claro/oscuro) y respeta reduced-motion',
    (() => { const css = leer('css/estilos.css'); return /\.sbx__input \{[\s\S]{0,400}?var\(--card\)/.test(css) &&
        /html\[data-theme="light"\] \.sbx__input/.test(css) && /prefers-reduced-motion: reduce\) \{\s*\.sbx-res--refresco/.test(css); })());
chk('No hay chip "activo/inactivo": el catálogo no tiene ese campo (no se inventa)',
    !/id: 'activo'|id: 'inactivo'/.test(app));

// ── Resumen ────────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── FASE 6 · buscadores (motor + integración) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
