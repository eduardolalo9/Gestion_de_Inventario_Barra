#!/usr/bin/env node
/**
 * prueba-hallazgo13-permisos-delegables.js — v5.26 · hallazgo #13 (permisos
 * "delegables" que en realidad no se pueden delegar)
 * ═══════════════════════════════════════════════════════════════════════════
 * El catálogo de permisos (PERMISOS_METADATOS) marcaba inventory.create,
 * inventory.closeGlobal y reports.export como delegable:true — pero ninguno
 * de los tres podía delegarse de verdad:
 *
 *   · inventory.create / inventory.closeGlobal — el propio código (js/75, js/85)
 *     exige isAdmin() ADEMÁS del permiso, y firestore.rules exige
 *     isAdminUser() en inventories/{id} sin mirar hasPerm() en absoluto.
 *   · reports.export — firestore.rules exige isAdminUser() en reportes/{id}
 *     sin mirar hasPerm(); el cliente (generarYPublicarReporte/eliminarReporte)
 *     solo miraba hasPermission(), así que un delegado SÍ llegaba a intentar
 *     la escritura y el servidor la rechazaba sin explicación.
 *
 * Decisión de Eduardo (11-oct-2026): NO ampliar quién puede crear/cerrar un
 * inventario físico completo o publicar el reporte oficial — eso sería un
 * cambio real del modelo de seguridad. En vez de eso, corregir el catálogo
 * para que deje de prometer una delegación que nunca funcionó (delegable:false,
 * igual que settings.update), y cerrar el hueco de defensa en profundidad que
 * le faltaba a reports.export en el cliente.
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
function extraerObjeto(fuente, nombre) {
    const m = new RegExp('const ' + nombre + ' = \\{').exec(fuente);
    if (!m) throw new Error('No se encontró ' + nombre);
    let nivel = 0, dentro = false;
    for (let j = m.index; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(m.index, j + 1); }
    }
    throw new Error('No se pudo delimitar ' + nombre);
}

const roles  = leer('js/50-roles-permisos.js');
const rules  = leer('firestore.rules');
const metadatos = extraerObjeto(roles, 'PERMISOS_METADATOS');

// ── 1 · El catálogo ya no promete lo que el servidor rechaza ────────────────
['inventory.create', 'inventory.closeGlobal', 'reports.export'].forEach(function(p) {
    const re = new RegExp("'" + p.replace('.', '\\.') + "':\\s*\\{[^}]*delegable:\\s*false");
    chk('★ ' + p + ' ya está marcado delegable:false en el catálogo',
        re.test(metadatos));
});

// ── 2 · El servidor efectivamente sigue exigiendo isAdminUser() para estos tres ──
chk('firestore.rules exige isAdminUser() para crear en inventories/{id} (sin hasPerm)',
    /match \/inventories\/\{inventoryId\} \{[\s\S]{0,160}allow create: if isAdminUser\(\)/.test(rules));
chk('firestore.rules exige isAdminUser() para cerrar (transición a CONTABILIZADO pasa por isAdminUser() también)',
    /allow update: if isAdminUser\(\) &&/.test(rules));
chk('firestore.rules exige isAdminUser() para escribir reportes/{id} (sin hasPerm)',
    /match \/reportes\/\{reporteId\} \{[\s\S]{0,160}allow write: if isAdminUser\(\);/.test(rules));

// ── 3 · El cliente no deja pasar a un no-admin a intentar ninguno de los tres ──
const auditoria = leer('js/75-auditoria-flujo.js');
const fnAbrir   = extraerFuncion(auditoria, 'abrirModalNuevoInventario');
const fnFecha   = extraerFuncion(auditoria, 'abrirModalRegistrarFechaRecuento');
const fnConfirmaFecha = extraerFuncion(auditoria, 'confirmarRegistrarFechaRecuento');
chk('★ abrirModalNuevoInventario() exige isAdmin() (inventory.create no se puede delegar)',
    /isAdmin\(\)/.test(fnAbrir) && /hasPermission\('inventory\.create'\)/.test(fnAbrir));
chk('abrirModalRegistrarFechaRecuento() exige isAdmin() también',
    /isAdmin\(\)/.test(fnFecha));
chk('confirmarRegistrarFechaRecuento() exige isAdmin() también',
    /isAdmin\(\)/.test(fnConfirmaFecha));

const uiFisico = leer('js/85-ui-inventario-fisico.js');
const fnZonaCerrar = extraerFuncion(uiFisico, '_renderZonaCerrarInventario');
chk('★ El botón "Cerrar Inventario Físico" solo se pinta con isAdmin() (inventory.closeGlobal no se puede delegar)',
    /isAdmin\(\) && hasPermission\('inventory\.closeGlobal'\)/.test(fnZonaCerrar));

const fnGenerarReporte = extraerFuncion(roles, 'generarYPublicarReporte');
const fnEliminarReporte = extraerFuncion(roles, 'eliminarReporte');
chk('★ generarYPublicarReporte() ahora exige isAdmin() además de hasPermission (reports.export no se puede delegar)',
    /if \(!isAdmin\(\) \|\| !hasPermission\('reports\.export'\)\) return;/.test(fnGenerarReporte));
chk('★ eliminarReporte() ahora exige isAdmin() además de hasPermission',
    /if \(!isAdmin\(\) \|\| !hasPermission\('reports\.export'\)\)/.test(fnEliminarReporte));

// ── 4 · Contraejemplo: inventory.post SÍ es delegable de punta a punta (no se tocó) ──
// Sirve de control: confirma que el patrón correcto (hasPerm en las reglas, sin
// isAdmin() de más en el cliente) ya existe en el código para lo que de verdad
// se delega, y que este fix no lo tocó.
chk('inventory.post sigue delegable:true en el catálogo (no se tocó)',
    /'inventory\.post':\s*\{[^}]*delegable:\s*true/.test(metadatos));
chk('firestore.rules usa hasPerm(\'inventory.post\') — no isAdminUser() — para contabilizar',
    /hasPerm\('inventory\.post'\)/.test(rules));
chk('contabilizarInventario() (js/75) no exige isAdmin(), solo hasPermission (sigue siendo delegable)',
    !/isAdmin\(\)/.test(extraerFuncion(auditoria, 'contabilizarInventario')));

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Un permiso "delegable" en el catálogo ahora SÍ se puede delegar — o deja de prometerlo (v5.26, hallazgo #13) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
