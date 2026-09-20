#!/usr/bin/env node
/**
 * prueba-p2.js — FASE 4: COMPRAS (persistencia + importación desde Excel)
 * ═══════════════════════════════════════════════════════════════════════════
 * Esta suite cubre lo que se comprueba leyendo el código: estructura, guardas
 * de permiso y de estado, el batch por folio, el id determinista, que
 * escapeHtml envuelve todo lo que viene del Excel, y el ALCANCE de la fase.
 *
 * El comportamiento contra el motor real de reglas está en run-rules-tests.js
 * (C1-C14). Una integración de punta a punta contra Firestore real —al
 * estilo de prueba-f3-integracion.js— queda pendiente como trabajo de
 * seguimiento (ver el informe de cierre de FASE 4).
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok, detalle: detalle || '' });
    if (!ok) fallos++;
}

const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

const compras = leer('js/88-compras.js');
const firest  = leer('js/40-firestore.js');
const nucleo  = leer('js/00-nucleo.js');
const idb     = leer('js/30-indexeddb.js');
const persis  = leer('js/20-persistencia.js');
const arranque = leer('js/60-arranque.js');
const html    = leer('index.html');
const reglas  = leer('firestore.rules');
const roles   = leer('js/50-roles-permisos.js');
const ventana = leer('js/99-window-arranque.js');

// Los comentarios de este mismo módulo EXPLICAN el alcance nombrando las
// palabras que NO deben aparecer en código ("no toca stockAreas", "pv, sku,
// pvParrot"...), así que un chequeo de alcance sobre el texto completo se
// dispara con su propia documentación. Se despoja de comentarios antes de
// buscar, para que estas comprobaciones vigilen código, no prosa.
function sinComentarios(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extraer(fuente, nombre) {
    const i = fuente.indexOf('function ' + nombre + '(');
    if (i === -1) return null;
    let nivel = 0, dentro = false;
    for (let j = i; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(i, j + 1); }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ESTADO — dos capas, el hecho y el efecto
// ═══════════════════════════════════════════════════════════════════════════
chk('let compras = [] sigue existiendo en el núcleo',
    /let compras = \[\];/.test(nucleo));
chk('let movimientos = [] — el libro de movimientos',
    /let movimientos = \[\];/.test(nucleo));
chk('let costosUltimos = {} — el último costo, sin tocar el catálogo',
    /let costosUltimos = \{\};/.test(nucleo));

// ═══════════════════════════════════════════════════════════════════════════
//  IDENTIDAD E IDEMPOTENCIA
// ═══════════════════════════════════════════════════════════════════════════
const fnCompraId = extraer(compras, '_compraId');
chk('_compraId() existe', !!fnCompraId);
chk('_compraId() prioriza Doc SAP sobre folio (hallazgo del anexo del 20/09)',
    !!fnCompraId && /docSap/.test(fnCompraId) && /'sap-'/.test(fnCompraId) && /'folio-'/.test(fnCompraId));

const fnAsientos = extraer(compras, '_asientosDesdeCompra');
chk('_asientosDesdeCompra() existe', !!fnAsientos);
chk('El id del asiento es determinista: compra_{compraId}_{productoId}',
    !!fnAsientos && /'compra_' \+ compra\.compraId \+ '_' \+ l\.productoId/.test(fnAsientos));
chk('Una línea sin catálogo (enCatalogo:false) NO genera asiento',
    !!fnAsientos && /enCatalogo !== false/.test(fnAsientos));

const fnVerificar = extraer(compras, '_verificarCompraExistente');
chk('_verificarCompraExistente() existe (espejo de _verificarInicialExistente)',
    !!fnVerificar);

// ═══════════════════════════════════════════════════════════════════════════
//  GUARDADO — el batch por folio, nunca por archivo
// ═══════════════════════════════════════════════════════════════════════════
const fnGuardar = extraer(compras, 'guardarCompra');
chk('guardarCompra() existe', !!fnGuardar);
chk('guardarCompra() exige purchases.create',
    !!fnGuardar && /hasPermission\('purchases\.create'\)/.test(fnGuardar));
chk('guardarCompra() comprueba conexión antes de intentar nada',
    !!fnGuardar && /navigator\.onLine/.test(fnGuardar));
chk('guardarCompra() consulta idempotencia ANTES de escribir (no confía solo en el servidor)',
    !!fnGuardar && /_verificarCompraExistente/.test(fnGuardar));
chk('guardarCompra() solo avanza el estado local DESPUÉS de que el batch confirme (await batch.commit())',
    !!fnGuardar && /await batch\.commit\(\)/.test(fnGuardar) &&
    fnGuardar.indexOf('await batch.commit()') < fnGuardar.indexOf('_agregarCompraLocal(compra, asientos)'));
chk('★ Un permission-denied se interpreta releyendo el documento (mismo patrón que FASE 3)',
    !!fnGuardar && /err\.code === 'permission-denied'/.test(fnGuardar) &&
    /_verificarCompraExistente\(compra\.compraId\)/.test(fnGuardar));

const fnEscribirBatch = extraer(firest, '_escribirCompraEnBatch');
chk('_escribirCompraEnBatch() existe en js/40-firestore.js', !!fnEscribirBatch);
chk('_escribirCompraEnBatch() SOLO añade al batch — nunca hace commit',
    !!fnEscribirBatch && !/\.commit\(\)/.test(fnEscribirBatch));
chk('_escribirCompraEnBatch() valida el tope de operaciones antes de escribir',
    !!fnEscribirBatch && /COMPRA_MAX_OPS/.test(fnEscribirBatch) && /totalOps > COMPRA_MAX_OPS/.test(fnEscribirBatch));
chk('★ Una sola compra por batch (batch por folio, no por archivo)',
    !!fnGuardar && (fnGuardar.match(/_escribirCompraEnBatch\(/g) || []).length === 1);

const fnFolio = extraer(firest, '_obtenerSiguienteFolioCompra');
chk('_obtenerSiguienteFolioCompra() existe (para la futura captura manual)', !!fnFolio);
chk('_obtenerSiguienteFolioCompra() usa runTransaction (concurrencia real, no un contador ingenuo)',
    !!fnFolio && /runTransaction/.test(fnFolio));

const fnCostos = extraer(firest, '_actualizarUltimosCostos');
chk('_actualizarUltimosCostos() existe', !!fnCostos);
chk('_actualizarUltimosCostos() escribe con merge (nunca reescribe costos/ultimos entero)',
    !!fnCostos && /\{\s*merge:\s*true\s*\}/.test(fnCostos));
chk('★ El costo NUNCA reescribe product.precio automáticamente',
    !/product\.precio\s*=/.test(compras) && !/\.precio\s*=\s*l\.costoUnitario/.test(compras));

// ═══════════════════════════════════════════════════════════════════════════
//  CARGA — siempre acotada
// ═══════════════════════════════════════════════════════════════════════════
const fnCargarSemana = extraer(compras, 'cargarComprasDeLaSemana');
chk('cargarComprasDeLaSemana() existe', !!fnCargarSemana);
chk("cargarComprasDeLaSemana() filtra por semanaId — nunca trae la colección entera",
    !!fnCargarSemana && /where\('semanaId', '==', idSemana\)/.test(fnCargarSemana) &&
    !/collection\('compras'\)\.get\(\)/.test(fnCargarSemana));
chk('cargarComprasIniciales() existe y se llama al arrancar',
    /function cargarComprasIniciales/.test(compras) &&
    /cargarComprasIniciales\(\)/.test(arranque));

// ═══════════════════════════════════════════════════════════════════════════
//  IMPORTACIÓN — mapa de columnas verificado contra el Excel real
// ═══════════════════════════════════════════════════════════════════════════
chk('El almacén de la barra está fijado en "12" (D-2, confirmado por el anexo)',
    /const ALMACEN_BARRA_CODIGO = '12';/.test(compras));
chk('_parsearExcelCompras() descarta sin incidencia las filas de otro almacén',
    /fueraDeAlcance\+\+/.test(compras));
chk('_parsearExcelCompras() descarta sin incidencia la fila de totales del pie (sin Código)',
    /filasIgnoradas\+\+/.test(compras));
chk('_parsearExcelCompras() agrupa por compra — un archivo puede traer varios folios',
    /const grupos = \{\};/.test(compras) && /orden\.push\(compraId\)/.test(compras));

const fnNormLinea = extraer(compras, '_normalizarLineaCompra');
chk('_normalizarLineaCompra() existe', !!fnNormLinea);
chk('★ factorConversion es SIEMPRE 1 en esta fase — nunca se multiplica a ciegas (hallazgo del anexo)',
    !!fnNormLinea && (fnNormLinea.match(/factorConversion: 1/g) || []).length === 2 &&
    !/cantidadInventario:\s*cantidad\s*\*/.test(fnNormLinea));
chk('Un producto fuera de catálogo se registra en la compra pero NO en el asiento (enCatalogo:false)',
    !!fnNormLinea && /enCatalogo: false/.test(fnNormLinea));
chk('Una UoM distinta de la unidad del producto genera incidencia informativa, no una conversión automática',
    !!fnNormLinea && /unidad_distinta/.test(fnNormLinea));

chk('_parsearCodigoNombre() separa "código — nombre" (proveedor Y almacén)',
    /function _parsearCodigoNombre/.test(compras) && /\\s\+—\\s\+/.test(compras));

chk('El refactor de _normCab\\/findCol se documentó como deuda, no se ejecutó a ciegas sin red',
    /_normCabCompras/.test(compras) && /_findColCompras/.test(compras) &&
    /COPIA deliberada/.test(compras) && /cdnjs\.cloudflare\.com/.test(compras));

// ── El input de compras nunca comparte estado con el del catálogo ──────────
chk('index.html tiene un #fileInputCompras propio, separado de #fileInput',
    /id="fileInputCompras"/.test(html) && /id="fileInput"/.test(html));
chk('El listener de #fileInputCompras llama a handleFileImportCompras, no a handleFileImport',
    /fileInputCompras['"]?\)/.test(ventana) && /handleFileImportCompras/.test(ventana));
chk('handleFileImportCompras() exige purchases.import',
    /function handleFileImportCompras/.test(compras) &&
    (extraer(compras, 'handleFileImportCompras') || '').includes("hasPermission('purchases.import')"));

// ─ Todo lo que viene del Excel se pinta escapado, sin excepción ───────────
chk('renderVistaPreviaCompras() escapa proveedor, fecha y folio',
    /renderVistaPreviaCompras/.test(compras) &&
    (() => {
        const f = extraer(compras, 'renderVistaPreviaCompras');
        return !!f && /escapeHtml\(g\.proveedorNombre\)/.test(f) &&
               /escapeHtml\(g\.proveedorCodigo\)/.test(f) && /escapeHtml\(g\.folio/.test(f);
    })());
chk('renderIncidenciasImportacion() escapa el detalle de cada incidencia',
    (() => {
        const f = extraer(compras, 'renderIncidenciasImportacion');
        return !!f && /escapeHtml\(inc\.detalle\)/.test(f);
    })());

// ═══════════════════════════════════════════════════════════════════════════
//  PERSISTENCIA — localStorage, IndexedDB, auditoría
// ═══════════════════════════════════════════════════════════════════════════
chk('saveToLocalStorage() persiste compras, movimientos y costosUltimos',
    /inventarioApp_compras/.test(idb) && /inventarioApp_movimientos/.test(idb) &&
    /inventarioApp_costosUltimos/.test(idb));
chk('_idbSaveAll() incluye compras, movimientos y costosUltimos',
    /store\.put\([^,]*compras[^,]*,\s*'compras'\)/.test(idb) &&
    /store\.put\([^,]*movimientos[^,]*,\s*'movimientos'\)/.test(idb));
chk("compra_importada y compra_manual son auditables (TIPOS_AUDITABLES)",
    /'compra_importada'/.test(persis) && /'compra_manual'/.test(persis));
chk('guardarCompra() registra el tipo correcto según el origen',
    !!fnGuardar && /compra\.origen === 'manual'\) \? 'compra_manual' : 'compra_importada'/.test(fnGuardar));

// ═══════════════════════════════════════════════════════════════════════════
//  REGLAS — las cuatro colecciones existen (comportamiento real en run-rules-tests.js)
// ═══════════════════════════════════════════════════════════════════════════
chk("firestore.rules define compras/{compraId}", /match \/compras\/\{compraId\}/.test(reglas));
chk("firestore.rules define movimientos/{movId}", /match \/movimientos\/\{movId\}/.test(reglas));
chk("firestore.rules define contadores/compras", /match \/contadores\/compras/.test(reglas));
chk("firestore.rules define costos/{docId}", /match \/costos\/\{docId\}/.test(reglas));
chk('El libro de movimientos solo admite tipo compra en esta fase',
    /request\.resource\.data\.tipo == 'compra'/.test(reglas));
chk('purchases.delete sigue efectivo:false — el borrado NO se implementó (R7)',
    /purchases\.delete/.test(roles) && /efectivo:\s*false/.test(roles));

// ═══════════════════════════════════════════════════════════════════════════
//  ALCANCE — lo que FASE 4 (4A + 4B) NO debía tocar
// ═══════════════════════════════════════════════════════════════════════════
const comprasCodigo = sinComentarios(compras);
const firestCodigo  = sinComentarios(firest);

chk('ALCANCE · no se tocó nada de ventas',
    !/collection\('ventas'\)/.test(comprasCodigo + firestCodigo) && !/tipo:\s*'consumo_venta'/.test(comprasCodigo + firestCodigo));
chk('ALCANCE · no se implementaron recetas',
    !/collection\('recetas'\)/.test(comprasCodigo + firestCodigo));
chk('ALCANCE · no se implementó stock teórico ni desviación',
    !/stockTeorico|calcularDesviacion/.test(comprasCodigo + firestCodigo));
chk('ALCANCE · stockAreas sigue sin tocarse desde compras',
    !/stockAreas/.test(comprasCodigo));
chk('ALCANCE · no se tocó pv, sku ni pvParrot',
    !/\bpvParrot\b/.test(comprasCodigo) && !/\bsku\b/.test(comprasCodigo));
chk('ALCANCE · los identificadores de área siguen intactos',
    /const AREAS_SISTEMA = \['almacen', 'barra1', 'barra2'\]/.test(leer('js/18-areas-config.js')));
chk('ALCANCE · la captura manual (4C) sigue sin implementarse — es la siguiente etapa, no esta',
    /comprasNuevaManual/.test(compras) &&
    /todavía no está disponible/.test(extraer(compras, 'comprasNuevaManual') || ''));

// ═══════════════════════════════════════════════════════════════════════════
//  CACHÉ
// ═══════════════════════════════════════════════════════════════════════════
chk('La versión de caché subió por encima de la de FASE 3',
    (() => {
        const v = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
        return v.length === 1 && parseFloat(v[0]) > 3.8;
    })(),
    'un index.html nuevo sirviendo .js viejos desde caché es el fallo más difícil de diagnosticar');

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── FASE 4 · compras (4A persistencia + 4B importación) ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos === 0 ? 0 : 1);
