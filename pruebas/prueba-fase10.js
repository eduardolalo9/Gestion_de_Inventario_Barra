#!/usr/bin/env node
/**
 * prueba-fase10.js — FASE 10 (ventas del POS) · comprobaciones estáticas.
 * ═══════════════════════════════════════════════════════════════════════════
 * Verifica, sobre el código REAL, lo acordado y lo medido en el archivo real
 * — ver claude/fase10-diseno-ventas-2026-09-27.md:
 *
 *   1. Permisos: sales.read / sales.import en el catálogo cerrado, con
 *      metadata y grupo propio, y SIN asignarse a subjefe ni bartender por
 *      defecto (información comercial, mismo criterio que compras).
 *   2. Reglas de Firestore: ventas/{semanaId} — lectura con sales.read,
 *      escritura con sales.import, update SÍ (reimportar reemplaza), delete
 *      NO, tope de líneas.
 *   3. Parser: agrupa por SKU SUMANDO (el caso de las variantes promo), lee
 *      la hoja "Venta" por nombre, no filtra por tipo de artículo, reutiliza
 *      los helpers de Excel ya existentes.
 *   4. El periodo se propone desde el inventario abierto y es editable.
 *   5. Alcance: NO calcula consumo teórico (eso es FASE 11).
 *   6. Persistencia local y integración de UI.
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
function leer(rel) { return fs.readFileSync(path.join(RAIZ, rel), 'utf8'); }

const ventas   = leer('js/93-ventas.js');
const roles    = leer('js/50-roles-permisos.js');
const reglas   = leer('firestore.rules');
const nucleo   = leer('js/00-nucleo.js');
const idb      = leer('js/30-indexeddb.js');
const firest   = leer('js/40-firestore.js');
const render   = leer('js/70-conversion-render.js');
const html     = leer('index.html');
const arranque = leer('js/99-window-arranque.js');
const sw       = leer('sw.js');

// ═══ 1 · Permisos ═══════════════════════════════════════════════════════════
chk("'sales.read' y 'sales.import' están en el catálogo cerrado de permisos",
    /PERMISOS_CATALOGO\s*=\s*\[[\s\S]*?'sales\.read'/.test(roles) &&
    /PERMISOS_CATALOGO\s*=\s*\[[\s\S]*?'sales\.import'/.test(roles));
chk('Ambos tienen metadata en español, en el grupo Ventas',
    /'sales\.read':\s*\{[^}]*grupo:\s*'Ventas'/.test(roles) &&
    /'sales\.import':\s*\{[^}]*grupo:\s*'Ventas'/.test(roles));
chk("'Ventas' está en el orden de grupos de la pantalla de permisos",
    /PERMISOS_GRUPOS_ORDEN\s*=\s*\[[\s\S]*?'Ventas'/.test(roles));
chk('★ Ni SUBJEFE_BARRA ni BARTENDER traen sales.* por defecto (mismo criterio que compras)',
    !/ROLES_SISTEMA_DEFECTO[\s\S]*?SUBJEFE_BARRA[\s\S]*?'sales\./.test(roles) &&
    !/BARTENDER:[\s\S]*?'sales\./.test(roles));

// ═══ 2 · Reglas de Firestore ════════════════════════════════════════════════
chk('firestore.rules define match /ventas/{semanaId}',
    /match \/ventas\/\{semanaId\} \{/.test(reglas));
chk('Ventas: lectura exige sales.read (no queda abierta a cualquier autenticado)',
    /match \/ventas\/\{semanaId\} \{[\s\S]{0,400}?allow read: if hasPerm\('sales\.read'\)/.test(reglas));
chk('Ventas: escritura exige sales.import y valida semanaId, lista y tope',
    /allow create, update: if hasPerm\('sales\.import'\)[\s\S]{0,400}?request\.resource\.data\.semanaId == semanaId[\s\S]{0,400}?lineas\.size\(\) <= 3000/.test(reglas));
chk('★ Ventas: update SÍ se permite (reimportar reemplaza) pero delete NO',
    /match \/ventas\/\{semanaId\} \{[\s\S]{0,700}?allow delete: if false;/.test(reglas));

// ═══ 3 · Parser ═════════════════════════════════════════════════════════════
chk('★ Agrupa por SKU SUMANDO las cantidades — el caso real de las variantes promo (2x1)',
    /g\.cantidad \+= cantidad;/.test(ventas) && !/g\.cantidad = cantidad;/.test(ventas));
chk('Reporta qué SKU venían en varias filas, en vez de sumarlos en silencio',
    /skusAgrupados/.test(ventas) && /se sumaron/.test(ventas));
chk('La hoja "Venta" se busca por NOMBRE, no se asume la primera del libro',
    /_normCabCompras\(n\) === 'venta'/.test(ventas));
chk('Reutiliza _numeroExcel/_findColCompras/_normCabCompras (no los reimplementa)',
    /_numeroExcel\(/.test(ventas) && /_findColCompras\(/.test(ventas) &&
    !/function _numeroExcel\(/.test(ventas) && !/function _findColCompras\(/.test(ventas));
chk('★ NO filtra las ventas por tipo de artículo (un platillo puede consumir barra)',
    !/tipo === 'Bebidas'/.test(ventas) && !/startsWith\('PVB'\)/.test(ventas));
chk('Una fila sin SKU y sin cantidad (la nota al pie del reporte) se descarta sin incidencia',
    /filasIgnoradas\+\+/.test(ventas));
chk('Una fila con cantidad pero sin SKU sí genera incidencia (no se puede cruzar con receta)',
    /tipo: 'sin_sku'/.test(ventas));
chk('Cantidad no numérica genera incidencia y omite la línea',
    /tipo: 'cantidad_invalida'/.test(ventas));

// ═══ 4 · El periodo ═════════════════════════════════════════════════════════
chk('semanaVentasPorDefecto() propone la semana del inventario abierto, con la semana en curso como respaldo',
    /function semanaVentasPorDefecto/.test(ventas) &&
    /_inventarioActivo\.fechaRecuento/.test(ventas) &&
    /return semanaId\(new Date\(\)\);/.test(ventas));
chk('La vista previa deja CAMBIAR la semana antes de confirmar',
    /_ventasCambiarSemana/.test(ventas) && /id="ventasSemanaInput"/.test(ventas));
chk('Si la semana destino ya tenía ventas, la vista previa lo avisa antes de reemplazar',
    /yaExistia/.test(ventas) && /ya tenía/.test(ventas));

// ═══ 5 · Alcance: no calcula consumo teórico ════════════════════════════════
chk('★ FASE 10 NO calcula consumo teórico ni stock teórico (eso es FASE 11)',
    !/function .*consumoTeorico/i.test(ventas) && !/stockTeorico/.test(ventas) &&
    !/function calcularDesviacion/.test(ventas));
chk('confirmarImportacionVentas() toma respaldo antes de escribir y guarda en local',
    /_crearBackupNombrado\('pre_importacion_ventas_'/.test(ventas) &&
    /saveToLocalStorage\(\);/.test(ventas));

// ═══ 6 · Persistencia e integración de UI ═══════════════════════════════════
chk('El estado de ventas está declarado en js/00-nucleo.js',
    /let ventas = \[\];/.test(nucleo) && /let ventasSemanaId = null;/.test(nucleo) &&
    /let ventasImportView = 'lista';/.test(nucleo));
chk('ventas viaja por localStorage e IndexedDB (guardado y restaurado)',
    /inventarioApp_ventas/.test(idb) && /_idbGet\('ventas'\)/.test(idb) &&
    /ventas = idbData\.ventas;/.test(idb) &&
    /ventas\s*=\s*safeGet\('inventarioApp_ventas'/.test(firest));
chk("renderTab() enruta 'ventas' a renderVentasTab()",
    /case 'ventas':\s*content\.innerHTML = renderVentasTab\(\); break;/.test(render));
chk("La pestaña 'ventas' respeta sales.import para su header",
    /activeTab === 'ventas'[\s\S]{0,500}?hasPermission\('sales\.import'\)/.test(render));
chk('renderVentasTab() exige sales.read para mostrar algo',
    /function renderVentasTab\(\)[\s\S]{0,300}?hasPermission\('sales\.read'\)/.test(ventas));
chk("index.html tiene botón de navegación a 'ventas'",
    /data-sb-tab="ventas" onclick="switchTab\('ventas'\); sbClose\(\)"/.test(html));
chk('index.html declara #fileInputVentas, propio y separado de los otros inputs',
    /id="fileInputVentas"/.test(html));
chk('js/99-window-arranque.js cablea #fileInputVentas a handleFileImportVentas',
    /getElementById\('fileInputVentas'\)/.test(arranque) && /handleFileImportVentas\(e\)/.test(arranque));
chk('index.html carga js/93-ventas.js entre 92-recetario-importar.js y 95-exportacion.js',
    /92-recetario-importar\.js\?v=[\d.]+"><\/script>\s*<script src="js\/93-ventas\.js\?v=[\d.]+"><\/script>\s*<script src="js\/95-exportacion/.test(html));
chk('sw.js precalienta js/93-ventas.js',
    /'\.\/js\/93-ventas\.js\?v=' \+ APP_VERSION/.test(sw));

// ═══ Resultado ═══════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(function(c) { return c.nombre.length; }));
console.log('\n  ── FASE 10 · ventas del POS (estática) ──\n');
casos.forEach(function(c) {
    console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
                (c.ok ? '' : '   ← ' + c.detalle));
});
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) +
            ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
