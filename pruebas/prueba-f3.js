#!/usr/bin/env node
/**
 * prueba-f3.js — FASE 3: CONTABILIZAR
 * ═══════════════════════════════════════════════════════════════════════════
 * Esta suite cubre lo que se comprueba leyendo el código: estructura, guardas,
 * reglas y ALCANCE. El comportamiento se prueba ejecutando, en otras dos:
 *
 *   pruebas/prueba-f3-integracion.js  → 28 comprobaciones contra Firestore real
 *                                        (idempotencia, reintento, snapshot
 *                                        intacto, datos congelados)
 *   run-rules-tests.js                → P9-P14, F1-F6 contra el motor de reglas
 *
 * Aquí se vigila sobre todo que FASE 3 no se haya llevado por delante nada de
 * lo que no le corresponde.
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

const leer   = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const flujo  = leer('js/75-auditoria-flujo.js');
const ui     = leer('js/85-ui-inventario-fisico.js');
const ciclo  = leer('js/15-ciclo-semanal.js');
const roles  = leer('js/50-roles-permisos.js');
const persis = leer('js/20-persistencia.js');
const firest = leer('js/40-firestore.js');
const reglas = leer('firestore.rules');
const html   = leer('index.html');

// Devuelve el texto de un bloque de reglas: desde su cabecera hasta el
// siguiente 'match /'. Medir la distancia en caracteres desde la cabecera era
// fragil: los comentarios que documentan los defectos P12 y F4 empujaron las
// guardas mas alla del limite y las comprobaciones fallaban aunque las reglas
// eran correctas.
function bloqueReglas(cabecera) {
    const i = reglas.indexOf(cabecera);
    if (i === -1) return '';
    const j = reglas.indexOf('match /', i + cabecera.length);
    return reglas.slice(i, j === -1 ? reglas.length : j);
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
//  La operación existe y está protegida
// ═══════════════════════════════════════════════════════════════════════════
const contab = extraer(flujo, 'contabilizarInventario');
chk('Existe contabilizarInventario()', !!contab);

if (contab) {
    chk('Exige el permiso inventory.post',
        /hasPermission\('inventory\.post'\)/.test(contab));
    chk('Exige que el inventario esté CERRADO',
        /inv\.estado !== 'CERRADO'/.test(contab));
    chk('Detecta un inventario ya contabilizado antes de hacer nada',
        /inv\.estado === 'CONTABILIZADO'/.test(contab));
    chk('Exige conexión: no se contabiliza a ciegas',
        /navigator\.onLine/.test(contab));
    chk('N-1 · solo un recuento que cierra semana',
        /clase\.cierraSemana/.test(contab) && /DOMINGO/.test(contab),
        'y el motivo se explica, no se deja un botón mudo');
    chk('N-4 · un inventario sin semanaId en cabecera se bloquea',
        /if \(!inv\.semanaId\)/.test(contab));

    // ── El corazón del asunto: la atomicidad y la idempotencia ──
    chk('Escribe el inicial y el estado en UN SOLO batch',
        /const batch = _db\.batch\(\);/.test(contab) &&
        /batch\.set\(inicialRef/.test(contab) &&
        /batch\.update\(inventoryRef/.test(contab) &&
        (contab.match(/batch\.commit\(\)/g) || []).length === 1,
        'o queda todo escrito, o no queda nada');
    chk('El estado destino es CONTABILIZADO con sus cuatro campos',
        /estado:\s*'CONTABILIZADO'/.test(contab) &&
        /contabilizadoEn/.test(contab) &&
        /contabilizadoPor/.test(contab) &&
        /semanaDestino/.test(contab));
    chk('★ Un permission-denied se interpreta leyendo el documento',
        /err\.code === 'permission-denied'/.test(contab) &&
        /_verificarInicialExistente\(inicial\.semanaId, inventoryId\)/.test(contab),
        'un rechazo puede significar "ya estaba hecho", no siempre un fallo');
    chk('★ Distingue "ya lo hice yo" de "lo hizo otro inventario"',
        /post\.existe && post\.mismoOrigen/.test(contab) &&
        /post\.existe && !post\.mismoOrigen/.test(contab));
    chk('La confirmación avisa de que el inicial es irreversible',
        /INMUTABLE/.test(contab),
        'decisión N-2: no se puede corregir ni deshacer');
    chk('Queda registrado en el historial permanente',
        /tipo:\s*'contabilizacion'/.test(contab));

    // ── Lo que NO debe tocar ──
    chk('★ NO toca stockAreas',
        !/stockAreas/.test(contab),
        'stockAreas es el stock operativo continuo, no el físico del inventario');
    chk('★ NO escribe en snapshotChunks',
        !/snapshotChunks.*set|set.*snapshotChunks/.test(contab.replace(/_readChunkedSubcollection\([^)]*\)/g, '')),
        'la evidencia física no se toca');
    chk('NO toca userAuditoria',
        !/userAuditoria/.test(contab));
}

// ═══════════════════════════════════════════════════════════════════════════
//  El cálculo de saldos usa los datos CONGELADOS
// ═══════════════════════════════════════════════════════════════════════════
const saldos = extraer(flujo, '_saldosDesdeSnapshot');
chk('Existe _saldosDesdeSnapshot()', !!saldos);

if (saldos) {
    chk('Reutiliza la consolidación del cierre, no inventa otra regla',
        /_consolidarConteoCongelado\(usuarios, areas, productosCongelados\)/.test(saldos),
        'así el inicial dice lo mismo que el Excel del cierre');
    chk('★ Convierte con los datos del producto CONGELADO',
        /tieneConversion\(p\)/.test(saldos) &&
        /convertirOzAPuntos\(pesoOz, p\.capacidadMl, p\.pesoBotellaLlenaOz\)/.test(saldos),
        'si usara el catálogo actual, corregir un peso movería un inicial antiguo');
    chk('NO lee el catálogo actual (products) para calcular',
        !/\bproducts\b/.test(saldos),
        'ese es justo el error que se evita');
    chk('D-1 · suma las áreas en un total por producto, sin desglose',
        /areas\.forEach/.test(saldos) && /total \+= suma/.test(saldos) &&
        !/saldosPorArea/.test(saldos));
    chk('Cuenta los productos que quedaron en cero',
        /enCero/.test(saldos));
    chk('Un snapshot sin productos se rechaza',
        /snapshot_sin_productos/.test(saldos));
}

const verif = extraer(flujo, '_verificarInicialExistente');
chk('Existe _verificarInicialExistente()', !!verif);
if (verif) {
    chk('Compara el origen para distinguir repetición de conflicto',
        /mismoOrigen:\s*origenId === inventoryId/.test(verif));
}

// ═══════════════════════════════════════════════════════════════════════════
//  inicialDesdeCierre() se reutiliza SIN modificar
// ═══════════════════════════════════════════════════════════════════════════
chk('★ inicialDesdeCierre() por fin tiene un llamador real',
    /inicialDesdeCierre\(\{/.test(flujo),
    'llevaba desde su creación sin conectarse a nada');
chk('inicialDesdeCierre() NO se modificó',
    /function inicialDesdeCierre\(cierre\) \{[\s\S]{0,200}?if \(!cierre \|\| !cierre\.fecha\) return null;/.test(ciclo) &&
    !/saldosPorArea/.test(ciclo),
    'D-1 hizo innecesario el desglose por área que se había propuesto');
chk('Sus pruebas siguen existiendo',
    /inicialDesdeCierre/.test(leer('pruebas/prueba-r4.js')));

// ═══════════════════════════════════════════════════════════════════════════
//  Reglas
// ═══════════════════════════════════════════════════════════════════════════
chk('La colección de iniciales existe en las reglas',
    /match \/inventariosIniciales\/\{semanaId\} \{/.test(reglas));
chk('★ El inicial es inmutable: create sí, update y delete no',
    /match \/inventariosIniciales\/\{semanaId\} \{[\s\S]{0,600}?allow update, delete: if false;/.test(reglas),
    'la inmutabilidad ES la idempotencia');
chk('Crear el inicial exige inventory.post',
    /match \/inventariosIniciales\/\{semanaId\} \{[\s\S]{0,400}?hasPerm\('inventory\.post'\)/.test(reglas));
chk('El documento no puede declarar una semana distinta de su ruta',
    /request\.resource\.data\.semanaId == semanaId/.test(reglas));
chk('★ CONTABILIZADO solo se alcanza desde CERRADO',
    /request\.resource\.data\.estado != 'CONTABILIZADO'\)/.test(reglas) &&
    /resource\.data\.estado == 'CERRADO'[\s\S]{0,200}?request\.resource\.data\.estado == 'CONTABILIZADO'/.test(reglas),
    'sin esto se podía saltar el cierre y contabilizar sin snapshot');
chk('★ Un inventario CONTABILIZADO queda tan sellado como uno CERRADO',
    /resource\.data\.estado != 'CERRADO' && resource\.data\.estado != 'CONTABILIZADO'/.test(reglas),
    'la regla anterior lo habría dejado abierto: CONTABILIZADO no es CERRADO');
chk('La transición solo admite cuatro campos',
    /hasOnly\(\['estado','contabilizadoEn','contabilizadoPor','semanaDestino'\]\)/.test(reglas));
chk('★ El snapshot tampoco se amplía tras contabilizar',
    /estado != 'CERRADO' &&[\s\S]{0,300}?estado != 'CONTABILIZADO';/.test(reglas),
    'el agujero H-2 se reabría justo cuando el inventario pasa a ser la base del inicial');
chk('snapshotChunks conserva update y delete prohibidos',
    /allow update, delete: if false;/.test(bloqueReglas('match /snapshotChunks/{chunkId} {')));
chk('El inventario sigue sin poderse borrar',
    /allow delete: if false;/.test(bloqueReglas('match /inventories/{inventoryId} {')));

// ═══════════════════════════════════════════════════════════════════════════
//  Permiso e interfaz
// ═══════════════════════════════════════════════════════════════════════════
chk('inventory.post pasa a tener efecto real',
    /'inventory\.post':\s*\{[\s\S]{0,400}?efectivo: true/.test(roles),
    'ya no es una casilla decorativa');
chk('Su descripción avisa de que es irreversible',
    /'inventory\.post':[\s\S]{0,400}?irreversible/.test(roles));
chk('El Bartender no lo recibe por defecto',
    !/BARTENDER:\s*\{[\s\S]{0,400}?'inventory\.post'/.test(roles));
chk('El Subjefe tampoco',
    !/SUBJEFE_BARRA:\s*\{[\s\S]{0,400}?'inventory\.post'/.test(roles));
chk("El tipo de evento 'contabilizacion' es auditable",
    /'contabilizacion',/.test(persis),
    'sin estar en TIPOS_AUDITABLES no llegaría a historialCambios');

chk('El botón existe en el detalle del inventario cerrado',
    /contabilizarInventario\(/.test(ui));
chk('El botón se dibuja solo con el permiso',
    /hasPermission\('inventory\.post'\)/.test(ui));
chk('★ Cuando no se puede, se explica POR QUÉ',
    /No se puede contabilizar\. ' \+ escapeHtml\(_motivo\)/.test(ui),
    'un control gris sin explicación manda al administrador a adivinar');
chk('Un inventario contabilizado se distingue en el historial',
    /CONTABILIZADO/.test(ui) && /Inicial de la semana/.test(ui));

// ═══════════════════════════════════════════════════════════════════════════
//  ALCANCE — lo que FASE 3 NO debía tocar
// ═══════════════════════════════════════════════════════════════════════════
const todo = flujo + ui + firest + persis + roles + leer('js/45-inventario-datos.js');
// OJO CON EL NOMBRE DE ESTA COMPROBACIÓN. Decía 'no se implementaron
// compras', y es falso: la pestaña de compras EXISTE desde P1 (js/88-compras
// .js), aunque solo muestra, no importa ni escribe. Lo que FASE 3 garantiza
// no es que no haya compras, sino que no las tocó ni las conectó: el módulo
// no aparece en el diff y contabilizar no lee ni escribe compras.
// OJO CON ESTAS DOS COMPROBACIONES TAMBIÉN. FASE 4 (posterior a FASE 3) SÍ
// implementó compras y el libro de movimientos de verdad — legítimamente, y
// en su propio módulo (js/88-compras.js) más las funciones de soporte que
// añadió a js/40-firestore.js (_escribirCompraEnBatch, etc.), que por eso ya
// no pueden usarse para probar esta ausencia: `todo` incluye `firest` y
// ahora SÍ menciona 'compras' y 'movimientos'. Lo que este archivo protegía
// de verdad —que el FLUJO DE CONTABILIZACIÓN de FASE 3 no leyera ni
// escribiera compras— sigue siendo cierto y es lo que se vigila ahora,
// acotado a `flujo`/`contab` en vez de a todo el conjunto.
chk('ALCANCE · contabilizar (FASE 3) no conectó el módulo de compras',
    !/collection\('compras'\)/.test(flujo) && !/tipo:\s*'compra'/.test(flujo) &&
    !/compras/.test(contab || ''),
    'la pestaña existía antes de FASE 3 (P1) y el libro de movimientos llegó después (FASE 4); '
    + 'lo que se vigila es que la contabilización de FASE 3 nunca los tocara');
chk('ALCANCE · no se implementaron ventas',
    !/collection\('ventas'\)/.test(todo) && !/\bventas\b/.test(contab || ''));
chk('ALCANCE · no se implementaron recetas',
    !/collection\('recetas'\)/.test(todo));
chk('ALCANCE · contabilizar (FASE 3) no escribe en el libro de movimientos',
    !/collection\('movimientos'\)/.test(flujo) && !/movimientos/.test(contab || ''));
chk('ALCANCE · no se implementó stock teórico ni desviación',
    !/stockTeorico|calcularDesviacion/.test(todo));
chk('ALCANCE · no se tocó el campo pv ni se crearon sku/pvParrot',
    !/pvParrot/.test(todo + leer('js/90-ciclo-admin.js')) &&
    /pv: \['PV', 'SKU', 'PV de venta', 'PVVenta', 'ProductId', 'product_id'\]/.test(leer('js/90-ciclo-admin.js')));
chk('ALCANCE · los identificadores de área siguen intactos',
    /const AREAS_SISTEMA = \['almacen', 'barra1', 'barra2'\]/.test(leer('js/18-areas-config.js')));
chk('ALCANCE · N-3 · solo se añadió CONTABILIZADO',
    !/'BORRADOR'|'EN_CONTEO'|'EN_REVISION'/.test(flujo + leer('js/45-inventario-datos.js')),
    'un estado sin transición ni efecto es decoración');
chk('ALCANCE · el cierre atómico del paso previo sigue en pie',
    /_escribirSnapshotEnBatch\(batch, inventoryRef, registros\)/.test(flujo));

// ═══════════════════════════════════════════════════════════════════════════
//  Caché
// ═══════════════════════════════════════════════════════════════════════════
chk('La versión de caché subió por encima de la del paso previo',
    (() => {
        const v = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
        return v.length === 1 && parseFloat(v[0]) > 3.7;
    })(),
    'reglas nuevas con código viejo en caché es la peor combinación posible');

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── FASE 3 · contabilizar ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos === 0 ? 0 : 1);
