#!/usr/bin/env node
/**
 * prueba-hallazgo10-deleteorder.js — v5.26 · hallazgo #10 (deleteOrder sin permiso)
 * ═══════════════════════════════════════════════════════════════════════════
 * deleteAllOrders() y deleteAllInventories() ya exigían isAdmin() (FIX-AUDIT),
 * pero deleteOrder(orderId) — borrar UN pedido — se quedó sin ese candado:
 * cualquier autenticado podía borrar cualquier pedido individual, y como
 * `orders` se sincroniza a Firestore vía ordersChunks, el borrado llegaba a
 * todos los dispositivos.
 *
 * Se ejecuta el código REAL de deleteOrder() en una sandbox para comprobar
 * el comportamiento, no solo el texto fuente.
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

const invSrc = leer('js/85-ui-inventario-fisico.js');
const fnSrc = extraerFuncion(invSrc, 'deleteOrder');

chk('★ deleteOrder() exige isAdmin() antes de pedir confirmación (mismo candado que sus hermanos)',
    /if \(!isAdmin\(\)\) \{ showNotification\('⚠️ Solo el administrador puede eliminar pedidos'\); return; \}/.test(fnSrc) &&
    fnSrc.indexOf('isAdmin()') < fnSrc.indexOf('showConfirm'));

function construirCtx(permitido) {
    const ctx = {
        console: { info: function() {}, warn: function() {}, error: function() {} },
        isAdmin: function() { return permitido; },
        showNotification: function(msg) { ctx._ultimaNotif = msg; },
        showConfirm: function(msg, cb) { ctx._confirmado = true; cb(); },
        _marcarComoBorrado: function() { ctx._marcado = true; },
        saveToLocalStorage: function() {},
        renderTab: function() {},
        orders: [{ id: 'O1' }, { id: 'O2' }]
    };
    return ctx;
}
function llamar(ctx, orderId) {
    const fn = new Function('ctx', 'with (ctx) { return ' + fnSrc + '; }')(ctx);
    fn(orderId);
}

// 1) Sin isAdmin(): el pedido NO se borra, ni se pide confirmación.
{
    const ctx = construirCtx(false);
    llamar(ctx, 'O1');
    chk('★ Sin permiso de administrador, el pedido no se borra',
        ctx.orders.length === 2 && !ctx._confirmado && !ctx._marcado);
}

// 2) Con isAdmin(): se pide confirmación y el pedido se borra.
{
    const ctx = construirCtx(true);
    llamar(ctx, 'O1');
    chk('Con permiso de administrador, el pedido se borra como antes',
        ctx.orders.length === 1 && ctx.orders[0].id === 'O2' && ctx._confirmado && ctx._marcado);
}

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── deleteOrder() exige administrador (v5.26, hallazgo #10) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
