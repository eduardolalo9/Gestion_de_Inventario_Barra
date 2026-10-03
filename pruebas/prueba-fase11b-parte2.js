#!/usr/bin/env node
/**
 * prueba-fase11b-parte2.js — FASE 11B (parte 2) · pedido sugerido y niveles
 * de alerta · comprobaciones estáticas.
 * ═══════════════════════════════════════════════════════════════════════════
 * Autorizado por Eduardo (1-oct-2026). Ver js/49-fisico-vs-sistema.js y
 * claude/fase11b-parte2-pedido-sugerido-2026-10-01.md.
 *
 * Ejecuta el código REAL de pedidoSugeridoProducto() y nivelAlertaProducto()
 * (js/49-fisico-vs-sistema.js) con un existenciaMostrada() de mentira
 * (controlado por cada caso) — esa función ya tiene su propia batería de
 * pruebas en FASE 8/11A; aquí solo se verifica la lógica NUEVA que se
 * construye encima de ella.
 *
 *   1  ★ Pedido sugerido = TECHO((mínimo − total) / conversión), nunca
 *        negativo, igual al Excel real (Tabla!O) y al ejemplo de Eduardo
 *        (lychees: (10.68−7.52)/0.567 → 6 latas).
 *   2    Sin conversión numérica > 0, nunca se inventa una cantidad (null).
 *   3  ★ Tolerancia de punto flotante: un déficit que matemáticamente es un
 *        entero exacto no se redondea una unidad de más por ruido binario.
 *   4  ★ Niveles de alerta anidados: limitado (<½) ⊂ advertencia (<⅔) ⊂
 *        bajo (<1×), siempre el más severo, nunca se apilan dos a la vez.
 *   5    Ambos leen la MISMA cifra que ya decide "Bajo mínimo"
 *        (existenciaMostrada), no stockByArea/getTotalStock.
 *
 *   node pruebas/prueba-fase11b-parte2.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok: !!ok, detalle: detalle || '' });
    if (!ok) fallos++;
}
function leer(f) { return fs.readFileSync(path.join(RAIZ, f), 'utf8'); }

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

const fvsSrc = leer('js/49-fisico-vs-sistema.js');

// ═══ 0 · Montaje ════════════════════════════════════════════════════════════
// existenciaMostrada() es la ÚNICA dependencia externa de las dos funciones
// nuevas — se controla por caso, sin reimplementar FASE 8/11A aquí.
let _totalFalso = 0;
const ctx = {
    existenciaMostrada: function() { return _totalFalso; }
};

const codigo =
    extraerFuncion(fvsSrc, 'pedidoSugeridoProducto') + '\n' +
    extraerFuncion(fvsSrc, 'nivelAlertaProducto');

let api;
try {
    api = new Function('ctx', 'with (ctx) {' + codigo + `
        return {
            pedido: pedidoSugeridoProducto,
            nivel:  nivelAlertaProducto
        };
    }`)(ctx);
} catch (e) {
    console.error('No se pudo montar el módulo:', e.message);
    process.exit(1);
}

function conTotal(valor, fn) { _totalFalso = valor; return fn(); }

// ═══ 1 · Pedido sugerido — forma básica y ejemplo real de Eduardo ══════════
chk('Sin stockMinimo numérico → null (nunca inventa)',
    api.pedido({ conversion: 1 }) === null);
chk('stockMinimo en 0 o negativo → null',
    api.pedido({ stockMinimo: 0, conversion: 1 }) === null &&
    api.pedido({ stockMinimo: -5, conversion: 1 }) === null);
chk('Total ya alcanza el mínimo → 0 (nunca negativo)',
    conTotal(12, function() { return api.pedido({ stockMinimo: 10, conversion: 1 }); }) === 0);
chk('Total por encima del mínimo → 0, no un número negativo',
    conTotal(50, function() { return api.pedido({ stockMinimo: 10, conversion: 1 }); }) === 0);
chk('★ Ejemplo real de Eduardo — lychees: (10.68−7.52)/0.567 → 6 latas',
    conTotal(7.52, function() { return api.pedido({ stockMinimo: 10.68, conversion: 0.567 }); }) === 6);
chk('★ Nunca negativo ni cero falso cuando sí hace falta pedir',
    conTotal(0, function() { return api.pedido({ stockMinimo: 12, conversion: 6 }); }) === 2);

// ═══ 2 · Honestidad de datos — sin conversión, nunca se inventa ════════════
chk('★ Sin `conversion` numérica → null, NO se inventa una cantidad',
    conTotal(2, function() { return api.pedido({ stockMinimo: 10 }); }) === null);
chk('`conversion` en 0 o negativa se trata igual que ausente → null',
    conTotal(2, function() { return api.pedido({ stockMinimo: 10, conversion: 0 }); }) === null &&
    conTotal(2, function() { return api.pedido({ stockMinimo: 10, conversion: -3 }); }) === null);

// ═══ 3 · Tolerancia de punto flotante ══════════════════════════════════════
chk('★ Un déficit matemáticamente entero no sube una unidad por ruido binario (0.1+0.2 ≠ 0.3 en JS)',
    conTotal(0, function() { return api.pedido({ stockMinimo: 0.1 + 0.2, conversion: 0.1 }); }) === 3,
    'obtenido: ' + conTotal(0, function() { return api.pedido({ stockMinimo: 0.1 + 0.2, conversion: 0.1 }); }));
chk('Un déficit real con fracción SÍ redondea hacia arriba (TECHO, nunca trunca)',
    conTotal(0, function() { return api.pedido({ stockMinimo: 5, conversion: 2 }); }) === 3);

// ═══ 4 · Niveles de alerta — anidados, siempre el más severo ═══════════════
// stockMinimo = 12 → bajo: <12 · advertencia: <8 (12 − 12/3) · limitado: <6 (12/2)
chk('total=11 (justo bajo el mínimo, por encima de los dos nuevos umbrales) → "bajo"',
    conTotal(11, function() { return api.nivel({ stockMinimo: 12 }); }) === 'bajo');
chk('total=8 (frontera advertencia, NO estrictamente menor) sigue siendo "bajo"',
    conTotal(8, function() { return api.nivel({ stockMinimo: 12 }); }) === 'bajo');
chk('★ total=7 (entre ⅔ y ½ del mínimo) → "advertencia"',
    conTotal(7, function() { return api.nivel({ stockMinimo: 12 }); }) === 'advertencia');
chk('total=6 (frontera limitado, NO estrictamente menor) sigue siendo "advertencia"',
    conTotal(6, function() { return api.nivel({ stockMinimo: 12 }); }) === 'advertencia');
chk('★ total=5 (por debajo de la mitad del mínimo) → "limitado" (el más grave)',
    conTotal(5, function() { return api.nivel({ stockMinimo: 12 }); }) === 'limitado');
chk('total=12 (en el mínimo o por encima) → sin alerta (null)',
    conTotal(12, function() { return api.nivel({ stockMinimo: 12 }); }) === null &&
    conTotal(20, function() { return api.nivel({ stockMinimo: 12 }); }) === null);
chk('Sin stockMinimo numérico → null',
    api.nivel({}) === null);

// ═══ 5 · Misma fuente que "Bajo mínimo" — ni stockByArea ni getTotalStock ══
chk('★ pedidoSugeridoProducto lee existenciaMostrada(), no getTotalStock/stockByArea',
    /existenciaMostrada\(product, cacheEntradas, cacheVentas\)/.test(
        extraerFuncion(fvsSrc, 'pedidoSugeridoProducto')) &&
    !/getTotalStock|stockByArea/.test(extraerFuncion(fvsSrc, 'pedidoSugeridoProducto')));
chk('★ nivelAlertaProducto lee existenciaMostrada(), no getTotalStock/stockByArea',
    /existenciaMostrada\(product\)/.test(extraerFuncion(fvsSrc, 'nivelAlertaProducto')) &&
    !/getTotalStock|stockByArea/.test(extraerFuncion(fvsSrc, 'nivelAlertaProducto')));

// ═══ Resultado ═══════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(function(c) { return c.nombre.length; }));
console.log('\n  ── FASE 11B (parte 2) · pedido sugerido y niveles de alerta (estática) ──\n');
casos.forEach(function(c) {
    console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
                (c.ok ? '' : '   ← ' + c.detalle));
});
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) +
            ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
