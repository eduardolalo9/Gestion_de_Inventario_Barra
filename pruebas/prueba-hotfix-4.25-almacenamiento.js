#!/usr/bin/env node
/**
 * prueba-hotfix-4.25-almacenamiento.js — HOTFIX 4.25 · almacenamiento local
 * al 104%: respaldos rotados por peso real y guardado que ya no se corta.
 * ═══════════════════════════════════════════════════════════════════════════
 * Motivo (ver claude/hotfix-4.25-almacenamiento-local-2026-10-03.md):
 *
 *   El aviso de HOTFIX 4.22 ya nombraba la clave pesada, pero no actuaba.
 *   Dos cosas de fondo:
 *
 *   A) `inventarioApp_backup_*` (_crearBackupNombrado, js/20-persistencia.js)
 *      rotaba por CANTIDAD (10) ordenando las claves como TEXTO — y el texto
 *      mezcla fechas ('pre_reset_auditoria_2026-09-25'), epoch-ms
 *      ('pre_importacion_1696300000000') e ids de producto
 *      ('pre_eliminacion_<id>_<ts>'), que no se pueden comparar entre sí como
 *      si fueran cronológicos. Además cada respaldo lleva el catálogo
 *      COMPLETO de productos (lo necesita restaurarBackup()), así que 10
 *      respaldos sin tope de PESO crecen sin límite según crece el catálogo.
 *
 *   B) saveToLocalStorage() (js/30-indexeddb.js) hacía `break` en cuanto
 *      fallaba CUALQUIER clave que no fuera inventories/orders/
 *      inventarioConteo/myAuditoriaConteo — cortando el guardado de TODO lo
 *      que viniera después en el array `entries`, incluyendo
 *      inventarioApp_cicloEstado/cicloInfo. Cada clave es una entrada
 *      independiente de localStorage: no hay nada que "corromper" siguiendo
 *      con la próxima, y sí mucho que perder deteniéndose.
 *
 * Ejecuta el código REAL de _rotarRespaldos() y _liberarEspacioEmergencia()
 * (js/20-persistencia.js) con datos de mentira. No necesita emulador ni
 * navegador: ninguna de las dos toca Firestore ni el DOM.
 *
 *   1  ★ _rotarRespaldos ordena por el `ts` real guardado DENTRO del
 *        respaldo, no por el nombre de la clave — y descarta los más viejos.
 *   2  ★ Un respaldo corrupto (JSON inválido) se trata como el más viejo,
 *        nunca revienta la rotación.
 *   3  ★ El tope de PESO (maxBytes) descarta aunque la cantidad esté bajo
 *        el tope de cantidad — y calcula el peso con la MISMA fórmula que
 *        el guardado real ((clave+valor) × 2, UTF-16).
 *   4    _crearBackupNombrado llama a _rotarRespaldos con MAX_BACKUPS y
 *        MAX_BACKUPS_BYTES (cableado estático).
 *   5  ★ _liberarEspacioEmergencia usa un tope de cantidad más estricto
 *        (3) que la rotación normal (10) — y solo toca inventarioApp_backup_*.
 *   6  ★ El guardado YA NO corta el resto de claves si una falla por cuota
 *        (break → continue) — pin de regresión del bug real.
 *   7    El aviso de cuota llama a _liberarEspacioEmergencia ANTES de
 *        mostrar el texto al usuario (cableado estático).
 *   8    El aviso genérico de error de guardado se muestra una sola vez por
 *        ciclo, aunque fallen varias claves.
 *
 *   node pruebas/prueba-hotfix-4.25-almacenamiento.js
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

function leer(f) { return fs.readFileSync(path.join(RAIZ, f), 'utf8'); }

function extraerFuncion(fuente, nombre) {
    const m = new RegExp('(async\\s+)?function ' + nombre + '\\(').exec(fuente);
    if (!m) throw new Error('No se encontró ' + nombre);
    let nivel = 0, dentro = false;
    for (let j = m.index; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(m.index, j + 1); }
    }
    throw new Error('No se pudo delimitar ' + nombre);
}

function extraerConst(fuente, nombre) {
    const m = new RegExp('const ' + nombre + '\\s*=[^;]*;').exec(fuente);
    if (!m) throw new Error('No se encontró la constante ' + nombre);
    return m[0];
}

const persSrc = leer('js/20-persistencia.js');
const idbSrc  = leer('js/30-indexeddb.js');

// ═══ 0 · Montaje ════════════════════════════════════════════════════════════
// Fábrica de un localStorage falso con getItem/setItem/removeItem/length/key
// — misma interfaz mínima que usa el código real.
function fakeLocalStorage(obj) {
    const store = Object.assign({}, obj);
    return {
        get length() { return Object.keys(store).length; },
        key: function(i) { return Object.keys(store)[i]; },
        getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function(k, v) { store[k] = String(v); },
        removeItem: function(k) { delete store[k]; },
        _dump: function() { return store; }
    };
}

const ctx = {
    console: { info: function() {}, warn: function() {}, error: function() {} },
    localStorage: fakeLocalStorage({})
};

const codigo =
    extraerConst(persSrc, 'EMERGENCIA_MAX_BACKUPS') + '\n' +
    extraerConst(persSrc, 'EMERGENCIA_MAX_BYTES') + '\n' +
    extraerFuncion(persSrc, '_rotarRespaldos') + '\n' +
    extraerFuncion(persSrc, '_liberarEspacioEmergencia');

let api;
try {
    api = new Function('ctx', 'with (ctx) {' + codigo + `
        return {
            rotar:    _rotarRespaldos,
            liberar:  _liberarEspacioEmergencia
        };
    }`)(ctx);
} catch (e) {
    console.error('No se pudo montar el módulo:', e.message);
    process.exit(1);
}

// Respaldo pequeño (unos pocos KB) — para probar ORDEN sin que el peso pese.
function backupChico(ts) { return JSON.stringify({ ts: ts, relleno: 'x'.repeat(2000) }); }
// Bytes exactos que usa la fórmula real: (clave.length + valor.length) * 2.
function bytesReales(key, val) { return (key.length + val.length) * 2; }

// ═══ 1 · Ordena por ts real, no por el nombre de la clave ══════════════════
ctx.localStorage = fakeLocalStorage({
    // A propósito con nombres cuyo orden alfabético contradice el ts real:
    'inventarioApp_backup_ciclo_cerrado_2026-09-20':        backupChico(3000), // más nuevo, pero "c" < "p"
    'inventarioApp_backup_pre_importacion_1000':            backupChico(1000), // más viejo
    'inventarioApp_backup_pre_reset_auditoria_2026-09-25':  backupChico(2000)
});
let r = api.rotar(10, 10 * 1024 * 1024); // topes amplios: solo observar el orden, no descartar
chk('_rotarRespaldos no descarta nada si cantidad y peso están bajo el tope',
    r.descartados === 0 && r.vivos === 3, JSON.stringify(r));

ctx.localStorage = fakeLocalStorage({
    'inventarioApp_backup_ciclo_cerrado_2026-09-20':        backupChico(3000),
    'inventarioApp_backup_pre_importacion_1000':            backupChico(1000),
    'inventarioApp_backup_pre_reset_auditoria_2026-09-25':  backupChico(2000)
});
r = api.rotar(2, 10 * 1024 * 1024); // tope de cantidad: deben sobrevivir ts=3000 y ts=2000
const sobreviven = Object.keys(ctx.localStorage._dump());
chk('★ Con tope de cantidad=2, sobreviven los dos de ts MÁS ALTO (no los dos primeros en orden alfabético)',
    sobreviven.length === 2 &&
    sobreviven.includes('inventarioApp_backup_ciclo_cerrado_2026-09-20') &&
    sobreviven.includes('inventarioApp_backup_pre_reset_auditoria_2026-09-25'),
    JSON.stringify(sobreviven));

// ═══ 2 · Un respaldo corrupto se trata como el más viejo, nunca revienta ═══
ctx.localStorage = fakeLocalStorage({
    'inventarioApp_backup_sano_1':     backupChico(5000),
    'inventarioApp_backup_corrupto':   '{esto no es JSON válido',
    'inventarioApp_backup_sano_2':     backupChico(4000)
});
let noRevento = true;
try { r = api.rotar(2, 10 * 1024 * 1024); } catch (e) { noRevento = false; }
chk('★ Un respaldo con JSON corrupto no revienta la rotación y se descarta primero (ts=0)',
    noRevento && r && r.descartados === 1 &&
    !Object.prototype.hasOwnProperty.call(ctx.localStorage._dump(), 'inventarioApp_backup_corrupto'),
    JSON.stringify(r));

// ═══ 3 · Tope de PESO descarta aunque la cantidad esté permitida ═══════════
// Tres respaldos del MISMO tamaño exacto (misma fórmula que el código real):
// el tope de bytes se fija para que quepa uno solo, nunca dos.
const keyA = 'inventarioApp_backup_a', keyB = 'inventarioApp_backup_b', keyC = 'inventarioApp_backup_c';
const valA = backupChico(3000), valB = backupChico(2000), valC = backupChico(1000);
const pesoUno = bytesReales(keyA, valA); // los tres pesan lo mismo
ctx.localStorage = fakeLocalStorage({ [keyA]: valA, [keyB]: valB, [keyC]: valC });
r = api.rotar(10, Math.floor(pesoUno * 1.5)); // cabe exactamente uno, no dos
chk('★ El tope de peso recorta aunque el tope de cantidad no se haya alcanzado',
    r.vivos === 1 && r.descartados === 2 && r.bytes === pesoUno, JSON.stringify(r));
chk('…y conserva el de ts más alto, no el primero por orden de clave',
    Object.prototype.hasOwnProperty.call(ctx.localStorage._dump(), keyA) &&
    !Object.prototype.hasOwnProperty.call(ctx.localStorage._dump(), keyB) &&
    !Object.prototype.hasOwnProperty.call(ctx.localStorage._dump(), keyC),
    JSON.stringify(Object.keys(ctx.localStorage._dump())));

// ═══ 5 · _liberarEspacioEmergencia usa un tope de cantidad más estricto ════
ctx.localStorage = fakeLocalStorage({
    'inventarioApp_backup_1': backupChico(5000),
    'inventarioApp_backup_2': backupChico(4000),
    'inventarioApp_backup_3': backupChico(3000),
    'inventarioApp_backup_4': backupChico(2000), // el más viejo de los 4: debe caer
    'inventarioApp_products': 'x'.repeat(1000)   // no es un respaldo: nunca debe tocarse
});
const descartadosEmergencia = api.liberar();
const dump = ctx.localStorage._dump();
chk('★ _liberarEspacioEmergencia recorta a su tope más estricto (3 respaldos)',
    descartadosEmergencia === 1 &&
    Object.keys(dump).filter(k => k.indexOf('inventarioApp_backup_') === 0).length === 3 &&
    !Object.prototype.hasOwnProperty.call(dump, 'inventarioApp_backup_4'),
    JSON.stringify(Object.keys(dump)));
chk('…y nunca toca claves que no son respaldos',
    Object.prototype.hasOwnProperty.call(dump, 'inventarioApp_products'));

console.log('\n  ── HOTFIX 4.25 · _rotarRespaldos / _liberarEspacioEmergencia ──\n');
let w = Math.max(...casos.map(c => c.nombre.length));
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(w) + (c.ok ? '' : '   ← ' + c.detalle)));

// ═══ 6, 7, 8 · Cableado estático en saveToLocalStorage ═════════════════════
const save = extraerFuncion(idbSrc, 'saveToLocalStorage');

chk('★ El guardado YA NO corta el resto de claves si una falla por cuota (break → continue)',
    !/\n\s*break;\s*\/\/ detener para no corromper/.test(save) && /\bcontinue;/.test(save),
    'contiene break-viejo=' + /\n\s*break;\s*\/\/ detener para no corromper/.test(save) + ' continue=' + /\bcontinue;/.test(save));

chk('El aviso de cuota llama a _liberarEspacioEmergencia antes de mostrar el texto',
    (function() {
        const iLib = save.indexOf('_liberarEspacioEmergencia');
        const iAviso = save.indexOf('Almacenamiento local al');
        return iLib >= 0 && iAviso >= 0 && iLib < iAviso;
    })());

chk('El aviso genérico de error de guardado solo se muestra una vez por ciclo',
    /_avisoGenericoMostrado/.test(save) &&
    save.indexOf('_avisoGenericoMostrado = true') < save.lastIndexOf("showNotification('⚠️ Error al guardar datos"));

chk('_crearBackupNombrado rota con MAX_BACKUPS y MAX_BACKUPS_BYTES',
    /_rotarRespaldos\(MAX_BACKUPS,\s*MAX_BACKUPS_BYTES\)/.test(
        extraerFuncion(persSrc, '_crearBackupNombrado')));

console.log('\n  ── Cableado estático ──\n');
casos.slice(-4).forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre + (c.ok ? '' : '   ← ' + c.detalle)));

const totalFallos = casos.filter(c => !c.ok).length;
console.log('\n  ' + casos.length + ' comprobaciones en total · ' + (casos.length - totalFallos) + ' pasaron · ' + totalFallos + ' fallaron\n');
process.exit(totalFallos ? 1 : 0);
