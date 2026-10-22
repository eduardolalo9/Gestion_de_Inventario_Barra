#!/usr/bin/env node
/**
 * prueba-hallazgo12-notificar-admin.js — v5.26 · hallazgo #12 (ajustes nunca notifican al admin)
 * ═══════════════════════════════════════════════════════════════════════════
 * solicitarAjuste() llamaba a crearNotificacion('ajuste', ..., null, false) —
 * un documento con destinatarioUid:null Y broadcast:false, que el filtro de
 * _notificaciones (n.broadcast || n.destinatarioUid === uid) nunca iba a
 * mostrarle a NADIE. Y el admin, en modo admin, ni siquiera escucha la
 * colección 'notificaciones' (_reconciliarListenersPorAutorizacion la apaga).
 * El mensaje "✅ Ajuste enviado al administrador" prometía algo que el código
 * no cumplía.
 *
 * El aviso real que SÍ le llega al admin es subscribeAjustesPendientes(), que
 * ya corría en vivo — pero solo como un toast efímero, fácil de perder si no
 * estaba mirando la pantalla justo en ese momento. El fix:
 *   1. Quita la escritura muerta de solicitarAjuste().
 *   2. subscribeAjustesPendientes() ahora además pinta la campanita del
 *      sidebar con el número de pendientes — un rastro que sigue ahí aunque
 *      el admin no estuviera conectado cuando se solicitó.
 *
 * Se ejecuta el código REAL de subscribeAjustesPendientes()/actualizarBadgeNotif()
 * en una sandbox para comprobar el comportamiento, no solo el texto fuente.
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

const roles = leer('js/50-roles-permisos.js');
const fnSolicitar = extraerFuncion(roles, 'solicitarAjuste');

// ── Estático ────────────────────────────────────────────────────────────────
// Se filtran las líneas de comentario antes de buscar: el propio comentario
// que explica el fix menciona "crearNotificacion()" por nombre, y eso no
// cuenta como una llamada real que haya quedado viva.
const fnSolicitarSinComentarios = fnSolicitar
    .split('\n')
    .filter(function(linea) { return !/^\s*\/\//.test(linea); })
    .join('\n');
chk('★ solicitarAjuste() ya no llama a crearNotificacion (escritura muerta que nadie leía)',
    !/crearNotificacion/.test(fnSolicitarSinComentarios));
chk('Sigue avisando al bartender que su solicitud se envió',
    /showNotification\('✅ Ajuste enviado al administrador'\)/.test(fnSolicitar));

// ── Comportamiento real ─────────────────────────────────────────────────────
const fnSubscribe = extraerFuncion(roles, 'subscribeAjustesPendientes');
const fnPintar     = extraerFuncion(roles, '_pintarBadgeNotif');
const fnActualizar = extraerFuncion(roles, 'actualizarBadgeNotif');

function construirCtx(admin) {
    const badge = { textContent: '', style: { display: 'none' } };
    const docs = [];
    const ctx = {
        console: { info: function() {}, warn: function() {}, error: function() {} },
        document: { getElementById: function(id) { return id === 'sbNotifBadge' ? badge : null; } },
        isAdmin: function() { return admin; },
        showNotification: function() {},
        renderTab: function() {},
        activeTab: 'otra',
        _notificaciones: [],
        _ajustes: [],
        _unsubAjustes: null,
        _db: {
            collection: function() {
                return {
                    orderBy: function() { return this; },
                    limit: function() { return this; },
                    onSnapshot: function(onNext) { ctx._dispararSnapshot = onNext; return function() {}; }
                };
            }
        }
    };
    ctx._badge = badge;
    ctx._docsFake = docs;
    new Function('ctx', 'with (ctx) {' + fnPintar + '\n' + fnActualizar + '\n' + fnSubscribe +
        '\nctx._subscribe = subscribeAjustesPendientes;}')(ctx);
    return ctx;
}

function snapshotCon(pendientes) {
    return { docs: pendientes.map(function(p, i) {
        return { id: 'A' + i, data: function() { return p; } };
    }) };
}

// 1) Dos ajustes pendientes llegan por el listener: la campanita debe mostrar "2".
{
    const ctx = construirCtx(true);
    ctx._subscribe();
    ctx._dispararSnapshot(snapshotCon([{ estado: 'pendiente' }, { estado: 'pendiente' }, { estado: 'aprobado' }]));
    chk('★ subscribeAjustesPendientes() pinta la campanita con el número de pendientes (2, no 3)',
        ctx._badge.textContent === '2' && ctx._badge.style.display === '',
        'textContent=' + ctx._badge.textContent + ' display=' + ctx._badge.style.display);
}

// 2) Cero pendientes: la campanita se oculta.
{
    const ctx = construirCtx(true);
    ctx._subscribe();
    ctx._dispararSnapshot(snapshotCon([{ estado: 'aprobado' }]));
    chk('Sin pendientes, la campanita se oculta',
        ctx._badge.style.display === 'none');
}

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Las solicitudes de ajuste ya dejan un rastro que SÍ le llega al admin (v5.26, hallazgo #12) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
