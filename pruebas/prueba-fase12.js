#!/usr/bin/env node
/**
 * prueba-fase12.js — FASE 12 · folio consecutivo, anti-solapamiento y el mismo
 * inventario en todos los dispositivos (comprobaciones estáticas).
 * El comportamiento se prueba contra el emulador real en
 * pruebas/prueba-folio-integracion.js; aquí se fija que nadie deshaga las
 * piezas en el código sin que una prueba lo note.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const casos = []; let fallos = 0;
function chk(nombre, ok, detalle) { casos.push({ nombre, ok: !!ok, detalle: detalle || '' }); if (!ok) fallos++; }
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
function extraer(fuente, nombre) {
    const m = new RegExp('(async\\s+)?function ' + nombre + '\\s*\\(').exec(fuente);
    if (!m) return '';
    let nivel = 0, dentro = false;
    for (let j = m.index; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(m.index, j + 1); }
    }
    return '';
}
const sinComentarios = (t) => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

const datos  = leer('js/45-inventario-datos.js');
const flujo  = leer('js/75-auditoria-flujo.js');
const fire   = leer('js/40-firestore.js');
const reglas = leer('firestore.rules');

// ═══ 1 · Folio ═════════════════════════════════════════════════════════════
const folio = extraer(datos, '_obtenerSiguienteNumeroInventario');
chk('★ El folio arranca en #1001 y avanza +1 dentro de una transacción',
    /FOLIO_INICIAL_INVENTARIO = 1001/.test(folio) && /Math\.max\(guardado, FOLIO_INICIAL_INVENTARIO - 1\) \+ 1/.test(folio) && /runTransaction/.test(folio));
chk('★ Reglas: el contador solo avanza +1 (y el único salto es a 1001)',
    /request\.resource\.data\.ultimoNumero == resource\.data\.ultimoNumero \+ 1/.test(reglas) &&
    /resource\.data\.ultimoNumero < 1001[\s\S]{0,120}ultimoNumero == 1001/.test(reglas) &&
    !/match \/contadores\/inventarios \{[\s\S]{0,300}allow write:  if isAdminUser\(\);/.test(reglas));
chk('★ Reglas: el folio del inventario nuevo debe ser el del contador',
    /request\.resource\.data\.numero == get\([\s\S]{0,160}?contadores\/inventarios\)\.data\.ultimoNumero/.test(reglas));

// ═══ 2 · Anti-solapamiento ═════════════════════════════════════════════════
chk('★ Reglas: no se crea un inventario si el de la sesión vigente está activo',
    /function _sesionVigenteSinInventarioActivo\(\)/.test(reglas) &&
    /allow create: if isAdminUser\(\)[\s\S]{0,700}_sesionVigenteSinInventarioActivo\(\)/.test(reglas));
chk('★ Cliente: además de la sesión vigente, cualquier inventario activo bloquea',
    /where\('estado', '==', 'SINCRONIZADO'\)\.limit\(1\)\.get\(\{ source: 'server' \}\)/.test(extraer(flujo, '_inventarioAbiertoEnServidor')));

// ═══ 3 · Misma información en todos los dispositivos ═══════════════════════
const sync = sinComentarios(extraer(fire, 'syncToCloud'));
chk('★ La sincronización general ya NO envía la sesión local (regresaba el servidor al inventario anterior)',
    sync.length > 0 && !/payload\._auditoriaSessionId\s*=/.test(sync));
chk('★ …ni el mapa local de estados de área (marcaba "completadas" las áreas del inventario nuevo)',
    sync.length > 0 && !/payload\.auditoriaStatus\s*=/.test(sync));
chk('★ Reglas: la sesión del documento raíz solo cambia creando su inventario en la misma escritura',
    /function _cambioDeSesionValido\(\)/.test(reglas) &&
    /getAfter\([\s\S]{0,160}?inventories\/\$\(nueva\)\)\.data\.estado == 'SINCRONIZADO'/.test(reglas) &&
    /allow update: if \(isAdminUser\(\) && _cambioDeSesionValido\(\)\)/.test(reglas));
const cerrar = extraer(flujo, 'auditoriaCerrarArea');
chk('Cerrar un área para todos escribe SOLO ese campo, comprobando la sesión en una transacción',
    /runTransaction/.test(cerrar) && /\['auditoriaStatus\.' \+ area\]: 'completada'/.test(cerrar) && /sesion_distinta/.test(cerrar));

// ═══ 4 · Tras crear: todo en cero y en la primera pantalla de Conteo ═══════
const reset = extraer(flujo, 'auditoriaResetear');
chk('Al crear se vacían conteo propio, agregado, estados y los de todos los usuarios',
    /myAuditoriaConteo\s+= \{\};/.test(reset) && /auditoriaConteo\s+= \{\};/.test(reset) &&
    /allUsersAuditoria\s+= \{\};/.test(reset) && /auditoriaStatus\s+= estadoAreasVacio\('pendiente'\)/.test(reset));
chk('★ Al crear, la app va a la primera pantalla de Conteo',
    /switchTab\('inventario'\)/.test(reset) && /auditoriaView\s+= 'selection'/.test(reset));

const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── FASE 12 · folio, anti-solapamiento y consistencia (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
