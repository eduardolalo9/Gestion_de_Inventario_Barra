#!/usr/bin/env node
/**
 * prueba-hallazgo7-importar-json.js — v5.26 · hallazgo #7 (Cero Pérdida de Datos)
 * ═══════════════════════════════════════════════════════════════════════════
 * importFullData() (js/99-window-arranque.js) reemplaza TODO el estado local
 * (catálogo, pedidos, inventarios, auditoría…) con lo que traiga el JSON — y
 * hasta ahora no pedía ningún permiso ni dejaba un respaldo previo. El botón
 * "Importar datos" del menú lateral es visible para cualquier autenticado
 * (a diferencia de "Panel Admin"/"Papelera", que sí se ocultan), así que
 * cualquier bartender podía borrar el inventario de todos con un archivo
 * cualquiera, sin nada a lo que volver si salía mal.
 *
 * Se ejecuta el código REAL de importFullData() en una sandbox (mismo patrón
 * de extracción que prueba-hotfix-4.25-almacenamiento.js) para comprobar el
 * comportamiento, no solo el texto fuente.
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

const arranqueSrc = leer('js/99-window-arranque.js');
const fnSrc = extraerFuncion(arranqueSrc, 'importFullData');

// ── Estático ────────────────────────────────────────────────────────────────
chk('★ importFullData() exige settings.update antes de tocar el archivo (mismo candado que restaurarBackup)',
    /if \(!hasPermission\('settings\.update'\)\) \{/.test(fnSrc) &&
    fnSrc.indexOf("hasPermission('settings.update')") < fnSrc.indexOf('new FileReader()'));
chk('★ Se respalda el estado actual ANTES de sobreescribirlo (pre_importacion_json)',
    /_crearBackupNombrado\('pre_importacion_json_'/.test(fnSrc) &&
    fnSrc.indexOf('_crearBackupNombrado') < fnSrc.indexOf('products = data.products;'));

// ── Comportamiento real ─────────────────────────────────────────────────────
function FakeFileReader() {}
FakeFileReader.prototype.readAsText = function(file) {
    const self = this;
    if (typeof self.onload === 'function') self.onload({ target: { result: file.texto } });
};

function construirCtx(permitido) {
    const backups = {};
    const ctx = {
        console: { info: function() {}, warn: function() {}, error: function() {} },
        FileReader: FakeFileReader,
        hasPermission: function() { return permitido; },
        showNotification: function(msg) { ctx._ultimaNotif = msg; },
        showConfirm: function(msg, cb) { ctx._confirmado = true; cb(); },
        _crearBackupNombrado: function(etiqueta) { backups[etiqueta] = true; ctx._backups = backups; return etiqueta; },
        saveToLocalStorage: function() {},
        switchTab: function() {},
        syncStockByAreaFromConteo: function() {},
        AREAS_CONTEO: ['almacen'],
        products: [{ id: 'VIEJO' }], orders: [], inventories: [], cart: [],
        inventarioConteo: {}, auditoriaConteo: {}, auditoriaConteoPorUsuario: {}, auditoriaStatus: {},
        auditoriaView: 'selection', auditoriaAreaActiva: null, isAuditoriaMode: false,
        myAuditoriaConteo: {}, myAuditoriaStatus: {}, myAuditoriaUnlocks: {}, _auditoriaSessionId: null,
        activeTab: 'inicio', searchTerm: '', selectedGroup: 'Todos', selectedArea: 'almacen',
        expandedInventories: new Set(),
        _backups: backups
    };
    return ctx;
}

function jsonValido() {
    return JSON.stringify({ products: [{ id: 'NUEVO' }], orders: [], inventories: [], cart: [], inventarioConteo: {} });
}

function llamar(ctx, textoArchivo) {
    const fn = new Function('ctx', 'with (ctx) { return ' + fnSrc + '; }')(ctx);
    const event = { target: { files: [{ texto: textoArchivo }], value: 'archivo.json' } };
    fn(event);
}

// 1) Sin el permiso: NO debe tocar products, NO debe pedir confirmación, NO debe respaldar.
{
    const ctx = construirCtx(false);
    llamar(ctx, jsonValido());
    chk('★ Sin settings.update, los datos actuales NO se tocan',
        ctx.products.length === 1 && ctx.products[0].id === 'VIEJO');
    chk('Sin el permiso, nunca se llega a pedir confirmación ni a crear un respaldo',
        !ctx._confirmado && Object.keys(ctx._backups).length === 0);
}

// 2) Con el permiso: se respalda el estado ANTES de reemplazarlo, y products cambia.
{
    const ctx = construirCtx(true);
    llamar(ctx, jsonValido());
    chk('★ Con settings.update, se crea un respaldo "pre_importacion_json_…" antes de aplicar el cambio',
        Object.keys(ctx._backups).some(function(k) { return k.indexOf('pre_importacion_json_') === 0; }));
    chk('Y los datos SÍ se reemplazan con los del archivo',
        ctx.products.length === 1 && ctx.products[0].id === 'NUEVO');
}

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Importar JSON: permiso y respaldo previo (v5.26, hallazgo #7) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
