#!/usr/bin/env node
/**
 * prueba-hallazgo8-borrar-usuario.js — v5.26 · hallazgo #8 (escalada / pérdida de control)
 * ═══════════════════════════════════════════════════════════════════════════
 * loadUserRole() auto-creaba usuarios/{uid} con role:'user' (BARTENDER activo,
 * permisos por defecto) cada vez que el documento no existía — sin distinguir
 * un alta genuina de una cuenta que YA existía y a la que le borraron el
 * documento. Un admin que borraba usuarios/{uid} pensando que así "daba de
 * baja" a alguien conseguía justo lo contrario en el siguiente inicio de
 * sesión: la cuenta volvía sola, activa, con los permisos por defecto del rol
 * (los overrides/áreas que tuviera sí se pierden para siempre al borrar el
 * documento — eso no tiene remedio — pero el problema real era que volvía
 * CON ACCESO).
 *
 * El fix usa user.metadata.creationTime vs lastSignInTime (lo único que
 * distingue "nunca existió" de "existía y lo borraron", porque Firestore ya
 * no tiene esa historia) para recrear el documento INACTIVO en el segundo
 * caso, en vez de activo.
 *
 * Se ejecuta el código REAL de loadUserRole() en una sandbox (mismo patrón de
 * extracción que ya usan otras pruebas de este archivo) para comprobar el
 * _authzState resultante, no solo el texto fuente.
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

const roles = leer('js/50-roles-permisos.js');
const auth  = leer('js/auth.js');

// ── Estático ────────────────────────────────────────────────────────────────
chk('★ auth.js pasa user.metadata a loadUserRole (única fuente de creationTime/lastSignInTime)',
    /_loadRole\(user\.uid, user\.metadata\)/.test(auth));
chk('★ loadUserRole distingue alta genuina de cuenta recreada (creationTime === lastSignInTime)',
    /authMeta\.creationTime === authMeta\.lastSignInTime/.test(roles));
chk('★ Si NO es la primera vez de verdad, el documento se recrea con status: \'inactivo\' (no activo)',
    /await ref\.set\(\{ uid, role: 'user', status: 'inactivo', creadoEn: Date\.now\(\)/.test(roles));

// ── Comportamiento real ─────────────────────────────────────────────────────
const fnLoadUserRole    = extraerFuncion(roles, 'loadUserRole');
const fnRoleCanonico    = extraerFuncion(roles, '_roleCanonico');
const constRolesDefectoSrc = extraerConst(roles, 'ROLES_SISTEMA_DEFECTO');
const constLegacy       = extraerConst(roles, 'ROLE_LEGACY_A_CANONICO');
// Mismo objeto, pero evaluado una vez aquí para poder inyectarlo como dato en ctx.
const ROLES_SISTEMA_DEFECTO_DATA = eval('(' + constRolesDefectoSrc.replace(/^const\s+ROLES_SISTEMA_DEFECTO\s*=\s*/, '').replace(/;\s*$/, '') + ')');

const codigo = constLegacy + '\n' +
    'var ROLES_SISTEMA_DEFECTO = ctx.ROLES_SISTEMA_DEFECTO;\n' +
    fnRoleCanonico + '\n' + fnLoadUserRole + '\n' +
    'ctx._loadUserRole = loadUserRole;';

function construirCtx() {
    const docsCreados = {};
    const ctx = {
        console: { info: function() {}, warn: function() {}, error: function() {} },
        ROLES_SISTEMA_DEFECTO: ROLES_SISTEMA_DEFECTO_DATA,
        _db: {
            collection: function() {
                return { doc: function(uid) {
                    return {
                        get: function() { return Promise.resolve({ exists: false }); },
                        set: function(data) { docsCreados[uid] = data; return Promise.resolve(); }
                    };
                } };
            }
        },
        _resolverPermisosDeRol: function(roleId) {
            return Promise.resolve((ROLES_SISTEMA_DEFECTO_DATA[roleId] || ROLES_SISTEMA_DEFECTO_DATA.BARTENDER).permissions);
        },
        _rolesCache: {},
        _sanitizarOverrides: function(raw) { return raw || {}; },
        _purgarConteosAjenosLocales: function() {},
        isAdmin: function() { return false; },
        _asegurarRolesSistemaEnFirestore: function() {},
        applyRoleUI: function() {},
        _suscribirUsuarioPropio: function() {},
        _suscribirRolActual: function() {},
        subscribeMainDoc: function() {},
        _reconciliarListenersPorAutorizacion: function() {},
        _resetAuthzState: function() { ctx._authzState = { loaded: false }; },
        _authzState: { loaded: false },
        currentUserRole: null,
        currentUserUid: null,
        _lastUserData: null
    };
    ctx._docsCreados = docsCreados;
    new Function('ctx', 'with (ctx) {' + codigo + '}')(ctx);
    return ctx;
}

async function casoAltaGenuina() {
    const ctx = construirCtx();
    const uid = 'uidNuevo';
    const ts = new Date().toISOString();
    await ctx._loadUserRole(uid, { creationTime: ts, lastSignInTime: ts });
    chk('★ Alta genuina (primer login real): el documento se crea ACTIVO, con permisos del rol por defecto',
        ctx._docsCreados[uid].role === 'user' && ctx._docsCreados[uid].status === undefined &&
        ctx._authzState.disabled === false && ctx._authzState.permissions.size > 0,
        JSON.stringify(ctx._docsCreados[uid]) + ' / disabled=' + ctx._authzState.disabled);
}

async function casoCuentaBorrada() {
    const ctx = construirCtx();
    const uid = 'uidBorrado';
    await ctx._loadUserRole(uid, { creationTime: '2026-01-01T00:00:00.000Z', lastSignInTime: '2026-10-11T00:00:00.000Z' });
    chk('★ Cuenta que YA existía y perdió su documento: se recrea INACTIVA (status: \'inactivo\'), no como BARTENDER activo',
        ctx._docsCreados[uid].status === 'inactivo',
        JSON.stringify(ctx._docsCreados[uid]));
    chk('★ _authzState queda deshabilitado y SIN permisos (no resucita acceso solo)',
        ctx._authzState.disabled === true && ctx._authzState.permissions.size === 0,
        'disabled=' + ctx._authzState.disabled + ' permisos=' + ctx._authzState.permissions.size);
}

async function casoSinAuthMeta() {
    const ctx = construirCtx();
    const uid = 'uidSinMeta';
    await ctx._loadUserRole(uid); // llamada vieja, sin segundo argumento
    chk('Sin authMeta (llamada vieja), se mantiene el comportamiento anterior — no revienta, no bloquea por accidente',
        ctx._docsCreados[uid].role === 'user' && ctx._docsCreados[uid].status === undefined);
}

(async function main() {
    try {
        await casoAltaGenuina();
        await casoCuentaBorrada();
        await casoSinAuthMeta();
    } catch (e) {
        console.error('Error ejecutando la prueba:', e);
        process.exit(1);
    }
    const w = Math.max.apply(null, casos.map(c => c.n.length));
    console.log('\n  ── Borrar usuarios/{uid}: ya no reactiva como BARTENDER (v5.26, hallazgo #8) ──\n');
    casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
    console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
})();
