#!/usr/bin/env node
/**
 * prueba-hallazgo15-compras-almacen-permiso.js — v5.26 · hallazgo #15
 * (Compras: formato de Almacén y permiso inconsistente entre importar y guardar)
 * ═══════════════════════════════════════════════════════════════════════════
 * Dos defectos distintos en el mismo módulo:
 *
 *   (a) _parsearCodigoNombre() esperaba la celda "Almacén" como
 *       "12 — nombre". Si el Excel traía solo "12" (sin el nombre), el
 *       separador no aparecía, toda la cadena se guardaba como `nombre` y
 *       `codigo` quedaba ''. _parsearExcelCompras() comparaba ese '' contra
 *       ALMACEN_BARRA_CODIGO ('12'), nunca coincidía, y la fila se
 *       descartaba en silencio como "de otro almacén" — una compra real de
 *       la barra, perdida por un formato de celda más corto.
 *
 *   (b) guardarCompra() (la única función que escribe compras/movimientos)
 *       exigía purchases.create — pero quien dispara ese guardado al
 *       confirmar una importación solo necesitaba, según el catálogo de
 *       permisos, purchases.import (más sensible, pensado justo para esto).
 *       Delegar SOLO purchases.import dejaba leer el Excel y ver la vista
 *       previa, pero cada fila fallaba al confirmar — tanto en el cliente
 *       como en el servidor (firestore.rules también exigía solo
 *       purchases.create). Decisión de Eduardo (11-oct-2026): que
 *       purchases.import también habilite el guardado, igual que
 *       purchases.create.
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

const compras = leer('js/88-compras.js');
const rules   = leer('firestore.rules');

// ── (a) Formato de Almacén ───────────────────────────────────────────────────
const fnParsear = extraerFuncion(compras, '_parsearCodigoNombre');
function evaluarParseo(cadena, soloDigitos) {
    return new Function('cadena', 'soloDigitos', fnParsear + '\nreturn _parsearCodigoNombre(cadena, soloDigitos);')(cadena, soloDigitos);
}
chk('★ Almacén "12" (sin nombre) ya se reconoce como código 12, no como un almacén distinto',
    evaluarParseo('12', true).codigo === '12',
    JSON.stringify(evaluarParseo('12', true)));
chk('Almacén "12 — BARRA MOCHOMOS" sigue separando código y nombre igual que antes',
    JSON.stringify(evaluarParseo('12 — BARRA MOCHOMOS', true)) === JSON.stringify({ codigo: '12', nombre: 'BARRA MOCHOMOS' }));
chk('Almacén con espacios de sobra ("  12  ") también se reconoce',
    evaluarParseo('  12  ', true).codigo === '12');
chk('Proveedor "P00106" (sin nombre) NO se ve afectado: sigue cayendo a nombre, como siempre (soloDigitos no aplica sin pedirlo)',
    JSON.stringify(evaluarParseo('P00106')) === JSON.stringify({ codigo: '', nombre: 'P00106' }));
chk('Proveedor "P00106 — VINOTECA MEXICO" sigue exactamente igual que antes',
    JSON.stringify(evaluarParseo('P00106 — VINOTECA MEXICO')) === JSON.stringify({ codigo: 'P00106', nombre: 'VINOTECA MEXICO' }));

const fnParsearExcel = extraerFuncion(compras, '_parsearExcelCompras');
chk('★ _parsearExcelCompras() pasa soloDigitos:true al parsear la columna Almacén (donde realmente se usa el fix)',
    /_parsearCodigoNombre\(_findColCompras\(fila, COLUMNAS_EXCEL_COMPRAS\.almacen\), true\)/.test(fnParsearExcel));

// ── (b) Permiso de guardado ──────────────────────────────────────────────────
const fnGuardar = extraerFuncion(compras, 'guardarCompra');
chk('★ guardarCompra() ahora acepta purchases.create O purchases.import (antes solo create)',
    /!hasPermission\('purchases\.create'\) && !hasPermission\('purchases\.import'\)/.test(fnGuardar));

chk('★ firestore.rules acepta hasPerm(\'purchases.import\') como alternativa en compras/{compraId} create',
    /match \/compras\/\{compraId\} \{[\s\S]{0,1000}allow create: if \(hasPerm\('purchases\.create'\) \|\| hasPerm\('purchases\.import'\)\)/.test(rules));
chk('★ firestore.rules acepta lo mismo en movimientos/{movId} create (tipo compra)',
    /match \/movimientos\/\{movId\} \{[\s\S]{0,1000}allow create: if \(hasPerm\('purchases\.create'\) \|\| hasPerm\('purchases\.import'\)\)/.test(rules));

// Control: purchases.import SIN purchases.create sigue sin poder LEER
// (purchases.read es un permiso propio, deliberadamente no se tocó) ni
// borrar (purchases.delete tampoco) — el fix solo amplía el create.
chk('La lectura de compras sigue exigiendo purchases.read, sin relación con este fix (no se tocó)',
    /match \/compras\/\{compraId\} \{[\s\S]{0,50}allow read:\s*if hasPerm\('purchases\.read'\);/.test(rules));

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Compras: el Almacén sin nombre ya no se pierde, e Importar compras ya puede terminar lo que empieza (v5.26, hallazgo #15) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
