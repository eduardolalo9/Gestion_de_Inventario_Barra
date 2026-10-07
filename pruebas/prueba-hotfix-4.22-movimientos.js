#!/usr/bin/env node
/**
 * prueba-hotfix-4.22-movimientos.js — HOTFIX 4.22 · recorte de `movimientos`
 * y aviso de cuota que nombra la clave real.
 * ═══════════════════════════════════════════════════════════════════════════
 * Motivo (ver claude/hotfix-4.22-...): el aviso de "almacenamiento al 95%"
 * apuntaba a "exporta y limpia historiales", pero el botón que existe
 * (deleteAllInventories) ya había dejado ese historial en cero por HOTFIX
 * 4.20. El que de verdad crecía sin límite desde FASE 4, sin ningún botón de
 * limpieza, era `movimientos` — una caché DERIVADA de `compras`
 * (_asientosDesdeCompra, js/88-compras.js) que existenciaEntradasSemana()
 * (js/47-existencia.js) solo lee para la semana en curso.
 *
 * Ejecuta el código REAL de _movimientosRecortar() y _topStorageKeys()
 * (js/30-indexeddb.js) más sus dependencias reales de fecha
 * (js/15-ciclo-semanal.js) con datos de mentira. No necesita emulador ni
 * navegador: ninguna de las dos funciones toca Firestore ni el DOM.
 *
 *   1  ★ Se conservan semana en curso + anterior; se descarta lo más viejo.
 *   2    Una entrada sin semanaId reconocible nunca se descarta (defensivo).
 *   3    `compras` nunca se toca — solo `movimientos`.
 *   4  ★ _topStorageKeys ordena por bytes reales, descendente, y solo mira
 *        claves propias de la app (inventarioApp_*).
 *   5    saveToLocalStorage() llama a _movimientosRecortar() ANTES de
 *        _idbSaveAll(), para que IDB también reciba ya la versión liviana.
 *   6  ★ El aviso de cuota ahora nombra la(s) clave(s) real(es), no el
 *        genérico "Exporta y limpia historiales".
 *
 *   node pruebas/prueba-hotfix-4.22-movimientos.js
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

const idbSrc    = leer('js/30-indexeddb.js');
const cicloSrc  = leer('js/15-ciclo-semanal.js');

// ═══ 0 · Montaje ════════════════════════════════════════════════════════════
// Fábrica de un localStorage falso para _topStorageKeys — misma interfaz
// mínima que usa el código real (length, key(i), getItem(key)).
function fakeLocalStorage(obj) {
    const keys = Object.keys(obj);
    return {
        length: keys.length,
        key: function(i) { return keys[i]; },
        getItem: function(k) { return obj[k]; }
    };
}

const ctx = {
    movimientos: [],
    console: { info: function() {}, warn: function() {}, error: function() {} },
    localStorage: fakeLocalStorage({})
};

const codigo =
    extraerFuncion(cicloSrc, 'parseFechaLocal') + '\n' +
    extraerFuncion(cicloSrc, 'fechaISOLocal') + '\n' +
    extraerFuncion(cicloSrc, '_aFechaLocal') + '\n' +
    extraerFuncion(cicloSrc, 'inicioSemana') + '\n' +
    extraerFuncion(cicloSrc, 'semanaId') + '\n' +
    extraerFuncion(cicloSrc, 'semanaAnterior') + '\n' +
    extraerFuncion(idbSrc, '_topStorageKeys') + '\n' +
    extraerFuncion(idbSrc, '_movimientosRecortar');

let api;
try {
    api = new Function('ctx', 'with (ctx) {' + codigo + `
        return {
            recortar: _movimientosRecortar,
            top:      _topStorageKeys,
            semanaId: semanaId,
            semanaAnterior: semanaAnterior
        };
    }`)(ctx);
} catch (e) {
    console.error('No se pudo montar el módulo:', e.message);
    process.exit(1);
}

// Semana de "hoy" para la prueba. Debe ser la fecha REAL: _movimientosRecortar()
// calcula "esta semana" con new Date() por dentro. Antes aquí había una fecha
// fija (30-sep-2026) y la prueba empezó a fallar el lunes 5-oct-2026 sin que
// el código hubiera cambiado: una bomba de reloj en la prueba, no un defecto.
const HOY = new Date();
const SEM_HOY       = api.semanaId(HOY);               // lunes de esta semana
const SEM_ANTERIOR  = api.semanaAnterior(SEM_HOY);      // lunes de la semana pasada
const SEM_VIEJA     = api.semanaAnterior(SEM_ANTERIOR); // dos semanas atrás — debe caer

// ═══ 1 · Se conserva semana en curso + anterior, se descarta lo más viejo ══
ctx.movimientos = [
    { movId: 'm1', tipo: 'compra', productoId: 'P1', semanaId: SEM_HOY },
    { movId: 'm2', tipo: 'compra', productoId: 'P2', semanaId: SEM_ANTERIOR },
    { movId: 'm3', tipo: 'compra', productoId: 'P3', semanaId: SEM_VIEJA },
    { movId: 'm4', tipo: 'compra', productoId: 'P4', semanaId: SEM_VIEJA }
];
api.recortar();
chk('★ Conserva la semana en curso y la anterior, descarta lo de dos semanas atrás',
    ctx.movimientos.length === 2 &&
    ctx.movimientos.some(m => m.movId === 'm1') &&
    ctx.movimientos.some(m => m.movId === 'm2') &&
    !ctx.movimientos.some(m => m.movId === 'm3' || m.movId === 'm4'),
    JSON.stringify(ctx.movimientos.map(m => m.movId)));

// ═══ 2 · Defensivo: sin semanaId reconocible, nunca se descarta ════════════
ctx.movimientos = [
    { movId: 'm5', tipo: 'compra', productoId: 'P5', semanaId: SEM_VIEJA },
    { movId: 'm6', tipo: 'compra', productoId: 'P6' } // sin semanaId: dato raro, mejor conservarlo
];
api.recortar();
chk('Una entrada sin semanaId reconocible nunca se descarta (mejor de más que perder un dato)',
    ctx.movimientos.length === 1 && ctx.movimientos[0].movId === 'm6',
    JSON.stringify(ctx.movimientos));

// ═══ 3 · Sin movimientos, no revienta ══════════════════════════════════════
ctx.movimientos = [];
let noRevento = true;
try { api.recortar(); } catch (e) { noRevento = false; }
chk('Con movimientos vacío no revienta', noRevento && ctx.movimientos.length === 0);

// ═══ 4 · _topStorageKeys — ordena por bytes reales, solo claves propias ════
ctx.localStorage = fakeLocalStorage({
    'inventarioApp_compras':     'x'.repeat(500),   // 500 chars → 1000 bytes (UTF-16)
    'inventarioApp_movimientos': 'x'.repeat(2000),  // la más grande
    'inventarioApp_products':    'x'.repeat(100),
    'otraApp_algoQueNoEsNuestro': 'x'.repeat(99999) // de otro origen/clave ajena: se ignora
});
const top = api.top(2);
chk('★ _topStorageKeys ordena por bytes reales, descendente',
    top.length === 2 && top[0].nombre === 'movimientos' && top[1].nombre === 'compras',
    JSON.stringify(top));
chk('…y nunca mira claves que no empiecen con inventarioApp_',
    !top.some(x => x.nombre.indexOf('otraApp') >= 0), JSON.stringify(top));
chk('El tamaño en bytes es exacto (clave + valor) × 2 (UTF-16)',
    top[0].bytes === ('inventarioApp_movimientos'.length + 2000) * 2, String(top[0].bytes));

console.log('\n  ── HOTFIX 4.22 · recorte de movimientos y aviso de cuota ──\n');
const w = Math.max(...casos.map(c => c.nombre.length));
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(w) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');

// ═══ 5 · Cableado estático — saveToLocalStorage recorta ANTES de _idbSaveAll,
// y el aviso ya no dice el genérico "Exporta y limpia historiales" ═════════
const save = extraerFuncion(idbSrc, 'saveToLocalStorage');
// Sin comentarios: el código de hoy TODAVÍA menciona la frase vieja dentro de
// un comentario que explica por qué cambió — lo que no debe existir es la
// frase en el texto que de verdad se muestra al usuario (showNotification).
const saveSinComentarios = save.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const ordenOk = save.indexOf('_movimientosRecortar()') >= 0 &&
    save.indexOf('_movimientosRecortar()') < save.indexOf('_idbSaveAll()');
chk('saveToLocalStorage() llama a _movimientosRecortar() ANTES de _idbSaveAll()',
    ordenOk, 'recortar@' + save.indexOf('_movimientosRecortar()') + ' idb@' + save.indexOf('_idbSaveAll()'));
chk('★ El aviso de cuota ya no manda genéricamente a "Exporta y limpia historiales"',
    !/Exporta y limpia historiales/.test(saveSinComentarios), saveSinComentarios.slice(0, 0));
chk('★ El aviso de cuota nombra la(s) clave(s) real(es) vía _topStorageKeys',
    /_topStorageKeys\(2\)/.test(save) && /x\.nombre/.test(save));
chk('El aviso aclara que no hay riesgo de pérdida (nube + respaldo interno)',
    /a salvo/.test(save));

console.log('  ── Cableado en saveToLocalStorage ──\n');
casos.slice(-4).forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre + (c.ok ? '' : '   ← ' + c.detalle)));

const totalFallos = casos.filter(c => !c.ok).length;
console.log('\n  ' + casos.length + ' comprobaciones en total · ' + (casos.length - totalFallos) + ' pasaron · ' + totalFallos + ' fallaron\n');
process.exit(totalFallos ? 1 : 0);
