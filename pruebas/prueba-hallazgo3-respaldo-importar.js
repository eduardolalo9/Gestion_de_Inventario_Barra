#!/usr/bin/env node
/**
 * prueba-hallazgo3-respaldo-importar.js — v5.26 · hallazgo #3 (Cero Pérdida de Datos)
 * ═══════════════════════════════════════════════════════════════════════════
 * confirmarImportacionRecetario()/Compras()/Ventas() llaman a
 * _crearBackupNombrado('pre_importacion_...') justo antes de escribir — pero
 * el respaldo solo guardaba products/inventarioConteo/myAuditoriaConteo/
 * auditoriaConteo/auditoriaStatus. Si el Excel traía basura (p.ej. el import
 * de recetario muta `recetas` en memoria ANTES de guardar), no había NADA a
 * lo que volver para deshacer justo lo que se acababa de sobrescribir.
 *
 * Se ejecuta el código REAL de _crearBackupNombrado/restaurarBackup/
 * _rotarRespaldos (mismo patrón de extracción que ya usa
 * prueba-hotfix-4.25-almacenamiento.js para este mismo archivo) para
 * comprobar el round-trip real, no solo el texto fuente.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

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

chk('★ _crearBackupNombrado ahora incluye recetas, compras, movimientos y ventas en el snapshot',
    /recetas:\s*recetas,\s*\n\s*compras:\s*compras,\s*\n\s*movimientos:\s*movimientos,\s*\n\s*ventas:\s*ventas,/.test(persSrc));
chk('★ restaurarBackup() los repone de vuelta de forma simétrica',
    /if \(Array\.isArray\(data\.recetas\)\)\s*recetas\s*=\s*data\.recetas;/.test(persSrc) &&
    /if \(Array\.isArray\(data\.compras\)\)\s*compras\s*=\s*data\.compras;/.test(persSrc) &&
    /if \(Array\.isArray\(data\.ventas\)\)\s*ventas\s*=\s*data\.ventas;/.test(persSrc));

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

const codigo =
    extraerConst(persSrc, 'MAX_BACKUPS') + '\n' +
    extraerConst(persSrc, 'MAX_BACKUPS_BYTES') + '\n' +
    extraerFuncion(persSrc, '_rotarRespaldos') + '\n' +
    extraerFuncion(persSrc, '_crearBackupNombrado') + '\n' +
    extraerFuncion(persSrc, 'restaurarBackup');

function montar(ctx) {
    return new Function('ctx', 'with (ctx) {' + codigo + `
        return { crear: _crearBackupNombrado, restaurar: restaurarBackup };
    }`)(ctx);
}

// ── Estado "antes de importar": recetario sano, catálogo de 3 productos ───
const ctx = {
    console: { info: function() {}, warn: function() {}, error: function() {} },
    localStorage: fakeLocalStorage({}),
    APP_VERSION: '5.26', DB_VERSION: 1,
    inventarioCicloEstado: 'SINCRONIZADO',
    products: [{ id: 'P1', name: 'TEQUILA' }],
    inventarioConteo: {}, myAuditoriaConteo: {}, auditoriaConteo: {}, auditoriaStatus: {},
    recetas: [{ id: 'R1', pv: 'PVB1', nombre: 'MARGARITA' }],
    compras: [{ compraId: 'C1' }],
    movimientos: [{ movId: 'M1' }],
    ventas: [{ sku: 'PVB1', cantidad: 10 }],
    ventasSemanaId: 'S1', ventasPeriodos: [{ inicio: '2026-10-01', fin: '2026-10-07' }],
    hasPermission: function() { return true; },
    showNotification: function() {},
    currentUserUid: 'admin1',
    _registrarEnSyncQueue: function() {},
    renderTab: function() {},
    saveToLocalStorage: function() {}
};
const api = montar(ctx);

// 1) Se toma el respaldo "pre_importacion_recetario" ANTES de la importación.
const keyPre = api.crear('pre_importacion_recetario_1000');
chk('El respaldo se crea sin reventar', !!keyPre);
const snapshotGuardado = JSON.parse(ctx.localStorage.getItem(keyPre));
chk('★ El snapshot grabado trae las recetas de ANTES de importar (no vacío, no undefined)',
    Array.isArray(snapshotGuardado.recetas) && snapshotGuardado.recetas.length === 1 && snapshotGuardado.recetas[0].id === 'R1');
chk('También trae compras, movimientos y ventas',
    snapshotGuardado.compras.length === 1 && snapshotGuardado.movimientos.length === 1 && snapshotGuardado.ventas.length === 1);

// 2) La importación "sale mal": el recetario en memoria queda corrupto/vacío.
ctx.recetas = [];           // lo que haría un Excel corrupto, p.ej.
ctx.ventas = [{ sku: 'ROTO' }];
ctx.compras = [];

// 3) restaurarBackup(): debe devolver recetas/compras/ventas al estado previo.
let confirmado = false;
ctx.showConfirm = function(msg, cb) { confirmado = true; cb(); }; // el usuario confirma
api.restaurar(keyPre);
chk('restaurarBackup() pide confirmación antes de pisar el estado actual', confirmado);
chk('★ Tras restaurar, recetas vuelve a tener la receta de antes de la importación (ya no queda vacío)',
    Array.isArray(ctx.recetas) && ctx.recetas.length === 1 && ctx.recetas[0].id === 'R1',
    'recetas = ' + JSON.stringify(ctx.recetas));
chk('★ compras y ventas también se restauran',
    ctx.compras.length === 1 && ctx.ventas.length === 1 && ctx.ventas[0].sku === 'PVB1');
chk('ventasSemanaId y ventasPeriodos también vuelven a su valor previo',
    ctx.ventasSemanaId === 'S1' && Array.isArray(ctx.ventasPeriodos) && ctx.ventasPeriodos.length === 1);

// 4) Un respaldo VIEJO (anterior a v5.26, sin estas claves) no debe pisar
//    el estado actual con undefined al restaurar — solo products/conteo.
ctx.localStorage.setItem('inventarioApp_backup_viejo', JSON.stringify({
    etiqueta: 'viejo', ts: 500, products: [{ id: 'PX' }], inventarioConteo: {}
}));
ctx.recetas = [{ id: 'R2' }]; ctx.compras = [{ compraId: 'C2' }];
ctx.showConfirm = function(msg, cb) { cb(); };
api.restaurar('inventarioApp_backup_viejo');
chk('Un respaldo viejo sin recetas/compras no pisa el dato actual con undefined',
    Array.isArray(ctx.recetas) && ctx.recetas.length === 1 && ctx.recetas[0].id === 'R2' &&
    ctx.compras.length === 1 && ctx.compras[0].compraId === 'C2');

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Respaldo previo a importar: recetas/compras/ventas (v5.26, hallazgo #3) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
