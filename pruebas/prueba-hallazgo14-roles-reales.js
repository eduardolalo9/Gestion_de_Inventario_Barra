#!/usr/bin/env node
/**
 * prueba-hallazgo14-roles-reales.js — v5.26 · hallazgo #14 ("Usuarios y
 * permisos" puede mostrar el rol de sistema por defecto en vez del real)
 * ═══════════════════════════════════════════════════════════════════════════
 * _rolesCache solo se mantenía vivo para el rol del PROPIO admin
 * (_suscribirRolActual, a propósito "SOLO ese"). Para el resto de los roles
 * del catálogo, permisosEfectivos() caía al fallback ROLES_SISTEMA_DEFECTO
 * (la constante del código) en vez de leer roles/{roleId} de Firestore: si el
 * admin ya había editado el rol BARTENDER o SUBJEFE_BARRA (p. ej. con
 * "Actualizar roles de sistema"), la pantalla "Usuarios y permisos" seguía
 * mostrando los permisos VIEJOS para cualquier usuario con ese rol.
 *
 * El fix: _cargarUsuariosParaPermisos() ahora resuelve (Firestore real, vía
 * _resolverPermisosDeRol) los tres roles de sistema ANTES de listar
 * usuarios — catálogo de roles cerrado, son siempre los mismos tres — y los
 * vuelve a resolver cuando se recarga con forzar=true.
 *
 * Se ejecuta el código REAL (extraerFuncion + new Function) contra un _db
 * falso cuyo roles/BARTENDER difiere a propósito de ROLES_SISTEMA_DEFECTO.
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
    const m = new RegExp('const ' + nombre + ' = ').exec(fuente);
    if (!m) throw new Error('No se encontró ' + nombre);
    let nivel = 0, dentro = false, inicioValor = fuente.indexOf('{', m.index);
    for (let j = inicioValor; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(m.index, j + 1) + ';'; }
    }
    throw new Error('No se pudo delimitar ' + nombre);
}

const roles = leer('js/50-roles-permisos.js');

// ── Estático ─────────────────────────────────────────────────────────────────
const fnCargar = extraerFuncion(roles, '_cargarUsuariosParaPermisos');
chk('★ _cargarUsuariosParaPermisos() resuelve los roles de sistema contra Firestore antes de listar usuarios',
    /_resolverPermisosDeRol/.test(fnCargar) && /ROLES_SISTEMA_DEFECTO/.test(fnCargar));
chk('No vuelve a pedir el rol que el listener propio ya mantiene vivo (evita una lectura redundante)',
    /rid !== _rolEscuchadoActualId/.test(fnCargar));
chk('Recargar con forzar=true también refresca la caché de roles (no solo la lista de usuarios)',
    /if \(forzar\) rolesAResolver\.forEach/.test(fnCargar));

// ── Comportamiento real ──────────────────────────────────────────────────────
function construirCtx() {
    const BARTENDER_REAL = ['inventory.count', 'inventory.viewOwn', 'catalog.read']; // editado por el admin: le quitaron closeOwn/history/warehouses.read/recipe.read
    const usuariosDocs = [
        { id: 'u1', data: function() { return { email: 'ana@bar.com', role: 'BARTENDER' }; } }
    ];
    const ctx = {
        console: { info: function() {}, warn: function() {}, error: function() {} },
        renderTab: function() {},
        _adminSubvista: 'permisos',
        _db: {
            collection: function(nombre) {
                if (nombre === 'roles') {
                    return { doc: function(id) {
                        return { get: function() {
                            if (id === 'BARTENDER') {
                                return Promise.resolve({ exists: true, data: function() { return { permissions: BARTENDER_REAL }; } });
                            }
                            return Promise.resolve({ exists: false });
                        } };
                    } };
                }
                if (nombre === 'usuarios') {
                    return { get: function() { return Promise.resolve({ forEach: function(cb) { usuariosDocs.forEach(cb); } }); } };
                }
                throw new Error('colección inesperada: ' + nombre);
            }
        }
    };
    return ctx;
}

const fnResolver = extraerFuncion(roles, '_resolverPermisosDeRol');
const constRoles = extraerConst(roles, 'ROLES_SISTEMA_DEFECTO');

async function correr() {
    const ctx = construirCtx();
    new Function('ctx', 'with (ctx) {' + constRoles + '\nlet _rolesCache = {}; let _rolEscuchadoActualId = null;' +
        '\nctx._rolesCacheGet = function(k){ return _rolesCache[k]; };' +
        fnResolver + '\n' + fnCargar +
        '\nctx._cargar = _cargarUsuariosParaPermisos;' +
        '\nctx._permCargando = false; ctx._permUsuarios = null; ctx._permError = null;}')(ctx);

    await ctx._cargar();
    chk('★ Tras cargar la pantalla, roles/BARTENDER real (Firestore) queda en la caché — no el fallback del código',
        JSON.stringify(ctx._rolesCacheGet('BARTENDER')) === JSON.stringify(['inventory.count', 'inventory.viewOwn', 'catalog.read']),
        'cache = ' + JSON.stringify(ctx._rolesCacheGet('BARTENDER')));
    chk('La caché del real difiere del fallback ROLES_SISTEMA_DEFECTO.BARTENDER (si fueran iguales la prueba no probaría nada)',
        JSON.stringify(ctx._rolesCacheGet('BARTENDER')) !== JSON.stringify(ctx.ROLES_SISTEMA_DEFECTO ? null : ['inventory.count', 'inventory.viewOwn', 'inventory.closeOwn', 'inventory.history', 'catalog.read', 'warehouses.read', 'recipe.read']));
    chk('SUBJEFE_BARRA (sin doc en Firestore) cae correctamente al fallback, sin romper nada',
        Array.isArray(ctx._rolesCacheGet('SUBJEFE_BARRA')) && ctx._rolesCacheGet('SUBJEFE_BARRA').indexOf('inventory.closeOther') !== -1);

    const w = Math.max.apply(null, casos.map(c => c.n.length));
    console.log('\n  ── "Usuarios y permisos" ya lee roles/* real antes de pintar (v5.26, hallazgo #14) ──\n');
    casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
    console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}

correr();
