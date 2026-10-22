#!/usr/bin/env node
/**
 * prueba-hallazgo16-cargar-ventas-semana.js — v5.26 · hallazgo #16 (nadie
 * llama a cargarVentasSemana: la lista de Ventas solo refleja lo importado
 * EN ESE dispositivo)
 * ═══════════════════════════════════════════════════════════════════════════
 * cargarVentasSemana() (js/93-ventas.js) existía desde FASE 10 — trae a
 * memoria ventas/ventasPeriodos/ventasSemanaId sumando los periodos de
 * Firestore — pero nada la invocaba nunca. Compras SÍ tenía su equivalente
 * (cargarComprasIniciales) llamado al arrancar y al recuperar sync-vivo;
 * Ventas no tenía ninguno. Resultado: si el admin importaba las ventas en
 * su PC, el celular seguía mostrando "sin ventas" (o las de una importación
 * vieja) hasta que alguien importara TAMBIÉN desde ese celular — y el Total
 * en la ruta 'semana' (sin ancla de arrastre) usaba ese mismo arreglo
 * `ventas`, así que también quedaba desactualizado.
 *
 * El fix añade tres llamadas, en el mismo patrón que ya existía para
 * compras:
 *   1. Al arrancar (js/60-arranque.js) — mismo bloque que cargarComprasIniciales.
 *   2. Al recuperar sync-vivo tras un hueco (js/54, syncVivoRecuperar).
 *   3. Al llegar un cambio EN VIVO de ventas de otro dispositivo (js/54,
 *      _svRefrescar) — antes solo recalculaba el Total, nunca refrescaba la
 *      lista que pinta la propia pestaña Ventas.
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

const arranque = leer('js/60-arranque.js');
const syncVivo = leer('js/54-sync-vivo.js');
const ventas   = leer('js/93-ventas.js');

// ── 1 · Arranque ─────────────────────────────────────────────────────────────
chk('★ El arranque llama a cargarVentasSemana() — mismo bloque que cargarComprasIniciales()',
    /cargarComprasIniciales[\s\S]{0,400}cargarVentasSemana\(semanaId\(new Date\(\)\)\)/.test(arranque));

// ── 2 · Recuperación de sync-vivo ────────────────────────────────────────────
const fnRecuperar = extraerFuncion(syncVivo, 'syncVivoRecuperar');
chk('★ syncVivoRecuperar() también refresca ventas, no solo compras',
    /cargarComprasIniciales/.test(fnRecuperar) && /cargarVentasSemana\(semanaId\(new Date\(\)\)\)/.test(fnRecuperar));

// ── 3 · Refresco en vivo (cambio de OTRO dispositivo) ────────────────────────
const fnRefrescar = extraerFuncion(syncVivo, '_svRefrescar');
chk('★ _svRefrescar() llama a cargarVentasSemana() cuando motivos.ventas está presente',
    /motivos\.ventas && typeof cargarVentasSemana === 'function'[\s\S]{0,80}cargarVentasSemana\(semanaId\(new Date\(\)\)\)/.test(fnRefrescar));
chk('El camino "soloCompras" (nada de ventas cambió) sigue sin releer nada de Firestore — no se volvió más caro de lo necesario',
    /var soloCompras = Object\.keys\(motivos\)\.every/.test(fnRefrescar) && /if \(soloCompras\) \{/.test(fnRefrescar));

// ── Control: cargarVentasSemana() en sí no se tocó (ya existía, ya era correcta) ──
const fnCargar = extraerFuncion(ventas, 'cargarVentasSemana');
chk('cargarVentasSemana() sigue igual: trae la semana, aplica, y no lanza si falla (sin permiso o sin red)',
    /_ventasAplicarSemana\(semana, docs\)/.test(fnCargar) && /catch \(e\) \{/.test(fnCargar) && /return false;/.test(fnCargar));

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Ventas ya se refresca sola — al arrancar, al recuperar y en vivo (v5.26, hallazgo #16) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
