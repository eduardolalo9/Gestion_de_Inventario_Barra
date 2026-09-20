#!/usr/bin/env node
/**
 * prueba-f3prev.js — PASO PREVIO A FASE 3
 * ═══════════════════════════════════════════════════════════════════════════
 * Cubre los tres defectos del cierre que el análisis del 18/09 destapó y que
 * el propietario autorizó corregir ANTES de contabilizar:
 *
 *   H-1  El cierre no era atómico y un reintento era imposible.
 *        Reescribir un fragmento existente es un 'update' para Firestore, y
 *        las reglas lo prohíben, así que el reintento moría con
 *        permission-denied y el inventario quedaba atascado: ni cerrado ni
 *        reabrible. El comentario del código afirmaba lo contrario.
 *
 *   H-2  El snapshot de un inventario cerrado se podía AMPLIAR. Los
 *        fragmentos existentes eran intocables, pero nada impedía crear
 *        otros nuevos, y el lector los concatena sin distinguirlos.
 *        (Se prueba contra el emulador: X1-X5b de run-rules-tests.js.)
 *
 *   H-3  El semanaId salía del reloj del dispositivo en el instante de
 *        cerrar, no de la fecha de recuento elegida. Cerrar el lunes de
 *        madrugada un inventario del domingo asignaba la semana siguiente, y
 *        contabilizar heredaría el error desde el primer ciclo.
 *
 * La lógica de la semana no se comprueba por expresión regular: se EXTRAE del
 * archivo real y se EJECUTA. Una copia probaría que la copia funciona.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok, detalle: detalle || '' });
    if (!ok) fallos++;
}

const leer   = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const flujo  = leer('js/75-auditoria-flujo.js');
const firest = leer('js/40-firestore.js');
const ciclo  = leer('js/15-ciclo-semanal.js');
const reglas = leer('firestore.rules');
const html   = leer('index.html');

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
//  X6 · H-1 — El cierre es una sola operación atómica
// ═══════════════════════════════════════════════════════════════════════════
const cerrar = extraer(flujo, 'cerrarInventarioFisico');
chk('X6 · se pudo extraer cerrarInventarioFisico()', !!cerrar);

if (cerrar) {
    chk('X6 · el cierre construye un batch',
        /const batch = _db\.batch\(\);/.test(cerrar));
    chk('X6 · los fragmentos se añaden a ESE batch',
        /_escribirSnapshotEnBatch\(batch, inventoryRef, registros\)/.test(cerrar));
    chk('X6 · el paso a CERRADO va en el MISMO batch',
        /batch\.update\(inventoryRef, \{[\s\S]{0,700}?estado:\s*'CERRADO'/.test(cerrar));
    chk('X6 · hay un único commit del batch',
        (cerrar.match(/batch\.commit\(\)/g) || []).length === 1);
    chk('X6 · el cierre ya NO usa el escritor genérico de fragmentos',
        !/_writeChunkedSubcollection\(inventoryRef, 'snapshotChunks'/.test(cerrar),
        'ese escritor sobrescribe y borra: ilegal sobre snapshotChunks');
    chk('X6 · desaparece el comentario que afirmaba que el reintento era seguro',
        !/borra los anteriores antes de escribir/.test(cerrar),
        'era falso y mandaba al admin a reintentar contra un permission-denied');
    chk('X6 · un snapshot demasiado grande se detiene con un motivo claro',
        /demasiados_fragmentos/.test(cerrar),
        'mejor fallar con un motivo que recibir un error opaco a mitad del cierre');
}

// ═══════════════════════════════════════════════════════════════════════════
//  X7 · El escritor del snapshot solo crea
// ═══════════════════════════════════════════════════════════════════════════
const escritor = extraer(firest, '_escribirSnapshotEnBatch');
chk('X7 · existe _escribirSnapshotEnBatch()', !!escritor);

if (escritor) {
    chk('X7 · no borra nada',
        !/\.delete\(/.test(escritor) && !/delBatch/.test(escritor),
        'snapshotChunks tiene allow delete: if false');
    chk('X7 · no hace commit por su cuenta',
        !/\.commit\(/.test(escritor),
        'quien llama decide cuándo se confirma: esa es la atomicidad');
    chk('X7 · no lee la subcolección antes de escribir',
        !/colRef\.get\(\)/.test(escritor));
    chk('X7 · reserva margen bajo el límite de operaciones de Firestore',
        /SNAPSHOT_MAX_OPS/.test(escritor) && /totalChunks \+ 1 > SNAPSHOT_MAX_OPS/.test(escritor),
        'el batch lleva además el update del inventario');
    chk('X7 · devuelve un resultado que el llamador puede comprobar',
        /return \{ ok: true/.test(escritor) && /return \{ ok: false/.test(escritor));
}
chk('X7 · el escritor genérico sigue existiendo para orders/inventories',
    /async function _writeChunkedSubcollection\(/.test(firest),
    'no se elimina código legado: tiene otros dos consumidores legítimos');
chk('X7 · el tamaño de fragmento no cambió',
    /const SNAPSHOT_CHUNK_SIZE = 80;/.test(firest),
    'un tamaño distinto rompería la compatibilidad con los snapshots ya escritos');

// ═══════════════════════════════════════════════════════════════════════════
//  X8-X9 · H-3 — La semana sale de la fecha de recuento, no del reloj
// ═══════════════════════════════════════════════════════════════════════════
const fnSemana = extraer(flujo, '_semanaIdDelInventario');
chk('X8 · existe _semanaIdDelInventario()', !!fnSemana);

const snapshot = extraer(flujo, '_construirSnapshotInventario');
if (snapshot) {
    chk('X8 · el snapshot ya NO clasifica por new Date()',
        !/clasificarRecuento\(new Date\(\)\)/.test(snapshot),
        'ese era exactamente el defecto H-3');
    chk('X8 · el snapshot usa la función nueva',
        /_semanaIdDelInventario\(_inventarioActivo\)/.test(snapshot));
    chk('X8 · el registro meta guarda el origen de la semana',
        /semanaIdOrigen:\s*_semana\.origen/.test(snapshot));
}
if (cerrar) {
    chk('X10 · el semanaId se guarda también en la cabecera del inventario',
        /semanaId:\s*_semanaCierre\.clase \? _semanaCierre\.clase\.semanaId : null/.test(cerrar),
        'contabilizar necesita leerlo sin abrir los fragmentos');
    chk('X10 · la cabecera guarda también el origen',
        /semanaIdOrigen:\s*_semanaCierre\.origen/.test(cerrar));
}

// ── Ejecución real de la lógica de semana ─────────────────────────────────
if (fnSemana) {
    const piezas = [
        extraer(ciclo, 'parseFechaLocal'),
        extraer(ciclo, '_aFechaLocal'),
        extraer(ciclo, 'fechaISOLocal'),
        extraer(ciclo, 'inicioSemana'),
        extraer(ciclo, 'finSemana'),
        extraer(ciclo, 'semanaId'),
        extraer(ciclo, 'esUltimoDiaDelMes'),
        extraer(ciclo, 'clasificarRecuento'),
        fnSemana
    ];
    chk('X9 · se pudieron extraer las piezas reales del ciclo semanal',
        piezas.every(Boolean));

    if (piezas.every(Boolean)) {
        const ctx = vm.createContext({ console, window: {} });
        vm.runInContext(piezas.join('\n') + '\nglobalThis._f = _semanaIdDelInventario;', ctx);
        const f = ctx._f;

        // El caso que motivó todo el defecto: inventario contado el domingo,
        // cerrado de madrugada del lunes. La fecha del formulario manda.
        const domingo = f({ fechaRecuento: '2026-09-13' });
        chk('X9 · con fechaRecuento se usa la fecha del formulario',
            domingo.origen === 'fechaRecuento',
            'origen recibido: ' + domingo.origen);
        chk('X9 · el domingo se clasifica como cierre de semana',
            !!domingo.clase && domingo.clase.cierraSemana === true);
        // OJO con el formato: semanaId NO es una semana ISO tipo '2026-W37'.
        // Es la FECHA DEL LUNES de esa semana — semanaId() es
        // fechaISOLocal(inicioSemana(x)). El domingo 2026-09-13 pertenece a la
        // semana que arranca el lunes 2026-09-07.
        chk('X9 · la semana es la del domingo contado, no la del lunes de cierre',
            !!domingo.clase && domingo.clase.semanaId === '2026-09-07',
            'semanaId recibido: ' + (domingo.clase && domingo.clase.semanaId));

        // El lunes siguiente pertenece a OTRA semana: es justo el error que
        // se producía al clasificar por el reloj del cierre.
        const lunes = f({ fechaRecuento: '2026-09-14' });
        chk('X9 · el lunes siguiente cae en una semana distinta',
            lunes.clase && domingo.clase && lunes.clase.semanaId !== domingo.clase.semanaId,
            'si coincidieran, el defecto H-3 no tendría consecuencias');

        // Camino antiguo: sin formulario, fechaRecuento nace null.
        const sinFecha = f({ fechaRecuento: null });
        chk('X9 · sin fechaRecuento se usa el respaldo',
            sinFecha.origen === 'fechaCierre',
            'origen recibido: ' + sinFecha.origen);
        chk('X9 · el respaldo devuelve una clasificación utilizable',
            !!sinFecha.clase && !!sinFecha.clase.semanaId);

        const sinInv = f(null);
        chk('X9 · un inventario nulo no revienta la función',
            !!sinInv && sinInv.origen === 'fechaCierre');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  X11 · H-2 en las reglas
// ═══════════════════════════════════════════════════════════════════════════
// Estas tres medían la distancia en caracteres desde la cabecera del match.
// Era fragil: los comentarios que FASE 3 añadió para documentar los defectos
// P12 y F4 empujaron las guardas más allá del límite. Ahora se mira DENTRO
// del bloque que toca, y se comprueba la garantía endurecida: los dos
// estados finales bloqueados, y CONTABILIZADO alcanzable solo desde CERRADO
// con cuatro campos en lista blanca.
function bloqueReglas(cabecera) {
    const i = reglas.indexOf(cabecera);
    if (i === -1) return '';
    const j = reglas.indexOf('match /', i + cabecera.length);
    return reglas.slice(i, j === -1 ? reglas.length : j);
}
const _chunks = bloqueReglas('match /snapshotChunks/{chunkId} {');
const _inv    = bloqueReglas('match /inventories/{inventoryId} {');

chk('X11 · crear un fragmento exige que el inventario NO esté cerrado',
    /allow create: if isAdminUser\(\) &&[\s\S]{0,400}?\.data\.estado != 'CERRADO'/.test(_chunks) &&
    /\.data\.estado != 'CONTABILIZADO'/.test(_chunks),
    'FASE 3 tuvo que bloquear también el estado nuevo: CONTABILIZADO no es CERRADO');
chk('X11 · update y delete de un fragmento siguen prohibidos',
    /allow update, delete: if false;/.test(_chunks));
chk('X11 · el inventario cerrado sigue siendo inmutable e imborrable',
    /resource\.data\.estado != 'CERRADO' && resource\.data\.estado != 'CONTABILIZADO'/.test(_inv) &&
    /\.hasOnly\(\['estado','contabilizadoEn','contabilizadoPor','semanaDestino'\]\)/.test(_inv) &&
    /allow delete: if false;/.test(_inv));
chk('X11 · el comentario de las reglas ya no afirma algo falso sobre el batch',
    !/cuando el padre pasa a CERRADO en el MISMO\s*\n?\s*\/\/\s*batch\), nunca se actualiza después/.test(reglas),
    'ese comentario describía un batch único que el código no hacía');

// ═══════════════════════════════════════════════════════════════════════════
//  X12 · Alcance — esto es el paso previo, no FASE 3
// ═══════════════════════════════════════════════════════════════════════════
const todo = flujo + firest + ciclo + leer('js/45-inventario-datos.js') + leer('js/50-roles-permisos.js');
// Estas dos exigían que FASE 3 no existiera todavía. Ya está autorizada e
// implementada, así que lo que protegen ahora es que siga confinada: la
// operación y la colección viven en el módulo de flujo, no en la capa de
// datos, el catálogo ni el ciclo semanal.
const _fueraDeFlujo = firest + ciclo + leer('js/45-inventario-datos.js') + leer('js/50-roles-permisos.js');
chk('X12 · contabilizar no se filtró fuera del módulo de flujo',
    /function contabilizarInventario/.test(flujo) &&
    !/function contabilizarInventario/.test(_fueraDeFlujo));
chk('X12 · la colección de iniciales solo se toca desde el flujo',
    /inventariosIniciales/.test(flujo) &&
    !/inventariosIniciales/.test(_fueraDeFlujo));
chk('X12 · no se implementaron recetas',
    !/collection\('recetas'\)/.test(todo));
chk('X12 · no se implementaron ventas ni movimientos',
    !/collection\('ventas'\)/.test(todo) && !/collection\('movimientos'\)/.test(todo));
chk('X12 · no se implementó stock teórico ni desviación',
    !/stockTeorico|calcularDesviacion/.test(todo));
// La función vive en js/15-ciclo-semanal.js y allí aparece dos veces: en su
// comentario de cabecera y en su definición. Lo que hay que vigilar es que
// NADIE la invoque desde el resto de la aplicación — conectarla es FASE 3.
// Decía 'sigue sin conectarse': conectarla era justo el trabajo de FASE 3.
// Lo que queda por vigilar es que tenga UN solo llamador y que la función en
// sí no se haya tocado para encajarla.
chk('X12 · inicialDesdeCierre() tiene exactamente un llamador',
    (flujo.match(/inicialDesdeCierre\(/g) || []).length === 1 &&
    !/inicialDesdeCierre\(/.test(firest + leer('js/45-inventario-datos.js') +
                                 leer('js/50-roles-permisos.js') + leer('js/85-ui-inventario-fisico.js')),
    'su definición vive en el ciclo semanal y no se modificó');
chk('X12 · stockAreas sigue sin tocarse en el cierre',
    !!cerrar && !/stockAreas/.test(cerrar),
    'es el stock operativo continuo: el cierre nunca lo modifica');
chk('X12 · los identificadores de área siguen intactos',
    /const AREAS_SISTEMA = \['almacen', 'barra1', 'barra2'\]/.test(leer('js/18-areas-config.js')));
chk('X12 · no se tocó el campo pv del catálogo',
    !/pvParrot/.test(todo + leer('js/90-ciclo-admin.js')));

// ═══════════════════════════════════════════════════════════════════════════
//  Caché
// ═══════════════════════════════════════════════════════════════════════════
chk('La versión de caché subió por encima de la de FASE 2',
    (() => {
        const v = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
        return v.length === 1 && parseFloat(v[0]) > 3.6;
    })(),
    'una regla nueva con código viejo en caché es la peor combinación posible');

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── Paso previo a FASE 3 · cierre atómico e inmutabilidad del snapshot ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos === 0 ? 0 : 1);
