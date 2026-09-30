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
// FASE 10B (30/09): un documento por PERIODO y create-only — decisión del
// propietario: una fecha ya cargada no se vuelve a subir.
chk('firestore.rules define match /ventas/{periodoId}',
    /match \/ventas\/\{periodoId\} \{/.test(reglas));
chk('Ventas: lectura exige sales.read (no queda abierta a cualquier autenticado)',
    /match \/ventas\/\{periodoId\} \{[\s\S]{0,400}?allow read: if hasPerm\('sales\.read'\)/.test(reglas));
chk('Ventas: crear exige sales.import y un periodo válido (id = inicio_fin, dentro de su semana, lista con tope)',
    /allow create: if hasPerm\('sales\.import'\)[\s\S]{0,200}?_periodoVentasValido\(periodoId, request\.resource\.data\)/.test(reglas) &&
    /periodoId == d\.fechaInicio \+ '_' \+ d\.fechaFin/.test(reglas) &&
    /duration\.value\(6, 'd'\)/.test(reglas) && /d\.lineas\.size\(\) <= 3000/.test(reglas));
chk('★ 10B · Ventas: update y delete NO — una fecha cargada no se reescribe ni se borra',
    /match \/ventas\/\{periodoId\} \{[\s\S]{0,500}?allow update, delete: if false;/.test(reglas) &&
    !/match \/ventas\/\{periodoId\} \{[\s\S]{0,500}?allow create, update/.test(reglas));

// ═══ 3 · Parser ═════════════════════════════════════════════════════════════
chk('★ Agrupa por SKU SUMANDO las cantidades — el caso real de las variantes promo (2x1)',
    /g\.cantidad \+= cantidad;/.test(ventas) && !/g\.cantidad = cantidad;/.test(ventas));
chk('Reporta qué SKU venían en varias filas, en vez de sumarlos en silencio',
    /skusAgrupados/.test(ventas) && /se sumaron/.test(ventas));
chk('★ 10B · Se importa la hoja "Detalle" del reporte de Parrot (y "Venta" del Formato), por NOMBRE',
    /function _ventasElegirHoja/.test(ventas) && /buscar\(\['detalle'\]\)/.test(ventas) && /\['venta', 'ventas'\]/.test(ventas));
chk('★ 10B · Nunca se cae a la primera hoja (en el reporte es "Resumen")',
    !/\|\| workbook\.SheetNames\[0\]/.test(ventas) && /no tiene una hoja "Detalle"/.test(ventas));
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
chk('★ 10B · La vista previa pide fecha de inicio y fecha fin',
    /id="ventasFechaInicio"/.test(ventas) && /id="ventasFechaFin"/.test(ventas) && /_ventasCambiarPeriodo/.test(ventas));
chk('★ 10B · Un solo día: fin vacío = inicio, y hay botón "Un solo día"',
    /fin: fin \|\| inicio \|\| ''/.test(ventas) && /function _ventasUnSoloDia/.test(ventas));
chk('La vista previa dice a qué semana pertenece el periodo',
    /Pertenece a la <b>' \+ escapeHtml\(etiquetaSemana\(v\.inicio\)\)/.test(ventas));
chk('★ 10B · Fecha ya cargada: "La fecha … ya se encuentra en el sistema. No se puede cargar."',
    /ya se encuentra en el sistema\. No se puede cargar\./.test(ventas));
chk('★ 10B · Rango que cruza de semana y fechas futuras se rechazan',
    /cruza de semana/.test(ventas) && /No se pueden cargar fechas futuras/.test(ventas));
chk('★ 10B · Antes de escribir se relee el SERVIDOR (no la caché) para detectar fechas ya cargadas',
    /leerPeriodosVentasSemana\(previa\.semanaId, \{ servidor: true \}\)/.test(ventas) && /source: 'server'/.test(ventas));
chk('★ 10B · Si no se pudo comprobar en el servidor, no se habilita "Confirmar"',
    /v\.puedeConfirmar = v\.ok && v\.verificado/.test(ventas));
chk('★ 10B · La semana en memoria es la SUMA de sus periodos (no el último importado)',
    /function _ventasAgregarLineas/.test(ventas) && /_ventasAplicarSemana\(v\.semanaId/.test(ventas) && !/ventas = parsed\.lineas;/.test(ventas));
chk('Ya no existe "reimportar reemplaza" en la pantalla',
    !/se reemplazan por completo/.test(ventas) && !/yaExistia/.test(ventas));

// ═══ 5 · Alcance: no calcula consumo teórico ════════════════════════════════
// FASE 11A añadió a esta pestaña la PANTALLA del consumo teórico, pero el
// cálculo sigue viviendo en su propia capa (js/48-consumo-teorico.js): el
// módulo de ventas lo muestra, no lo calcula. Eso es lo que se comprueba.
chk('★ El módulo de ventas MUESTRA el consumo teórico pero no lo calcula (el motor vive en js/48)',
    /_renderConsumoTeorico/.test(ventas) &&
    !/function consumoTeorico\(\)/.test(ventas) &&
    !/unidades \* cant/.test(ventas));
chk('★ FASE 10 sigue sin calcular stock teórico ni desviación (eso es 11B)',
    !/stockTeorico/.test(ventas) && !/function calcularDesviacion/.test(ventas));
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
chk('10B · ventasPeriodos (qué días están cargados) se declara y viaja por localStorage e IndexedDB',
    /let ventasPeriodos = \[\];/.test(nucleo) &&
    /inventarioApp_ventasPeriodos/.test(idb) && /_idbGet\('ventasPeriodos'\)/.test(idb) &&
    /ventasPeriodos = idbData\.ventasPeriodos;/.test(idb) &&
    /ventasPeriodos\s*=\s*safeGet\('inventarioApp_ventasPeriodos'/.test(firest));
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
