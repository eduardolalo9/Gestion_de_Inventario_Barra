#!/usr/bin/env node
/**
 * prueba-fisico-vs-sistema.js — FASE 11B (parte 1) · Físico vs Sistema
 * ═══════════════════════════════════════════════════════════════════════════
 * Ejecuta el código REAL de js/49-fisico-vs-sistema.js (y, debajo, el de
 * js/47-existencia.js, sin reimplementar la fórmula) con datos de mentira.
 * No necesita emulador: fisicoVsSistemaCalcular() es una capa de cálculo
 * pura — no toca Firestore. La consolidación multiusuario que alimenta
 * auditoriaConteo (_recalcAdminAggregatedConteo) ya tiene su propia prueba
 * de integración (prueba-fase8.js, prueba-ciclo-completo-integracion.js);
 * aquí se da por buena y se prueba lo que es nuevo: sumar sus áreas,
 * distinguir "nadie contó esto" de "contaron cero", y la comparación contra
 * el sistema.
 *
 *   1  ★ fvsConteoFisicoProducto — null (no 0) cuando nadie contó; suma
 *        correcta en todas las áreas; abiertas convertidas a puntos.
 *   2  ★ fisicoVsSistemaCalcular — null sin inventario SINCRONIZADO.
 *   3  ★ Diferencia = físico − sistema (mismo signo que el Excel real:
 *        negativo = faltante, positivo = sobrante); neto = diferencia × precio.
 *   4    Honestidad: sin inicial contabilizado, "sistema" es la operativa de
 *        siempre (origen 'operativo_no_reconciliado'); con inicial, es la
 *        oficial (inicial + compras − consumo).
 *   5    Orden: mayor diferencia absoluta primero; pendientes al final.
 *   6  ★ Cableado: botón, vista y registro de búsqueda en su sitio.
 *
 *   node pruebas/prueba-fisico-vs-sistema.js
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

const existenciaSrc = leer('js/47-existencia.js');
const fvsSrc         = leer('js/49-fisico-vs-sistema.js');
const conversion     = leer('js/70-conversion-render.js');
const multiusuario   = leer('js/10-multiusuario.js');
const uiInv          = leer('js/85-ui-inventario-fisico.js');
const buscador       = leer('js/80-buscador.js');
const roles          = leer('js/50-roles-permisos.js');
const html           = leer('index.html');
const sw             = leer('sw.js');

// ═══ 0 · Montaje — mismo patrón que prueba-fase8.js ════════════════════════
const SEM = '2026-09-28';   // lunes de la semana en curso durante la prueba

const ctx = {
    semanaId: function() { return SEM; },
    getTotalStock: function(p) {
        if (!p || !p.stockByArea) return 0;
        return Object.keys(p.stockByArea).reduce(function(a, k) { return a + (p.stockByArea[k] || 0); }, 0);
    },
    products: [],
    movimientos: [],
    auditoriaConteo: {},
    AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
    _inventarioActivo: null,
    _inventarioActivoId: null,
    console: { warn: function() {} }
};

const codigo = existenciaSrc + '\n'
    + extraerFuncion(multiusuario, 'inventarioAbierto') + '\n'
    + ['tieneDatosConversion', 'tieneConversion', 'convertirOzAPuntos'].map(function(n) { return extraerFuncion(conversion, n); }).join('\n') + '\n'
    + fvsSrc;

let api;
try {
    api = new Function('ctx', 'with (ctx) {' + codigo + `
        return {
            calcular: fisicoVsSistemaCalcular,
            conteo:   fvsConteoFisicoProducto,
            setInicial: function(x) { _existenciaInicial = x; }
        };
    }`)(ctx);
} catch (e) {
    console.error('No se pudo montar el módulo:', e.message);
    process.exit(1);
}

function reset() {
    ctx.products = [];
    ctx.movimientos = [];
    ctx.auditoriaConteo = {};
    ctx._inventarioActivo = null;
    ctx._inventarioActivoId = null;
    api.setInicial({ semana: null, estado: 'sin_cargar', saldos: null, origen: null });
}

const INV_ABIERTO  = { estado: 'SINCRONIZADO', numero: 1001 };
const INV_CERRADO  = { estado: 'CERRADO', numero: 999 };

// ═══ 1 · fvsConteoFisicoProducto — null vs. 0, suma por áreas ══════════════
reset();
ctx.products = [
    { id: 'P1', name: 'TEQUILA DON JULIO', precio: 500, conteoOzHabilitado: false },
    { id: 'P2', name: 'VODKA ABSOLUT', precio: 300, capacidadMl: 750, pesoBotellaLlenaOz: 38, conteoOzHabilitado: true }
];

chk('★ Nadie contó el producto todavía → null, nunca 0',
    api.conteo('P1') === null);

ctx.auditoriaConteo = { P1: { almacen: { enteras: 2, abiertas: [] }, barra1: { enteras: 1, abiertas: [] } } };
chk('★ Suma enteras de TODAS las áreas (2 + 1 = 3), sin convertir (no usa oz)',
    api.conteo('P1') === 3, String(api.conteo('P1')));

// P2 tiene conversión real: una abierta a 30oz, capacidad 750ml, botella llena 38oz.
ctx.auditoriaConteo = { P2: { barra2: { enteras: 1, abiertas: [30] } } };
const esperadoP2 = Math.round((1 + (function() {
    const ML_POR_OZ = 29.5735, liquidoOz = 750 / ML_POR_OZ, pesoVidrio = 38 - liquidoOz;
    return (30 - pesoVidrio) / liquidoOz;
})()) * 1000) / 1000;   // fvsConteoFisicoProducto redondea a 3 decimales, igual que getTotalStock
chk('★ Convierte botellas abiertas a puntos con la MISMA fórmula que el resto de la app',
    api.conteo('P2') === esperadoP2, String(api.conteo('P2')) + ' vs ' + esperadoP2);

chk('Un área sin dato para ese producto no cuenta como "tocado"',
    (function() { ctx.auditoriaConteo = { P3: {} }; return api.conteo('P3'); })() === null);

// ═══ 2 · fisicoVsSistemaCalcular — sin inventario abierto ══════════════════
reset();
ctx._inventarioActivo = INV_CERRADO;
chk('★ Sin inventario SINCRONIZADO (cerrado o inexistente) devuelve null',
    api.calcular() === null);

ctx._inventarioActivo = null;
chk('Sin ningún inventario activo también devuelve null',
    api.calcular() === null);

// ═══ 3 · Diferencia, signo y neto — sin inicial (respaldo operativo) ═══════
reset();
ctx._inventarioActivo = INV_ABIERTO;
ctx._inventarioActivoId = 'INV1001';
ctx.products = [
    { id: 'A', name: 'Producto A (faltante)', precio: 100, stockByArea: { almacen: 10, barra1: 0, barra2: 0 } },
    { id: 'B', name: 'Producto B (sobrante)', precio: 50,  stockByArea: { almacen: 2,  barra1: 0, barra2: 0 } },
    { id: 'C', name: 'Producto C (sin contar)', precio: 20, stockByArea: { almacen: 5, barra1: 0, barra2: 0 } }
];
// Físico: A=6 (faltan 4 contra la operativa=10), B=5 (sobran 3 contra 2), C sin tocar.
ctx.auditoriaConteo = {
    A: { almacen: { enteras: 6, abiertas: [] } },
    B: { almacen: { enteras: 5, abiertas: [] } }
};
const r1 = api.calcular();
chk('★ totalProductos/contados/pendientes correctos', r1.totalProductos === 3 && r1.contados === 2 && r1.pendientes === 1,
    JSON.stringify(r1).slice(0, 200));

const filaA = r1.filas.find(function(f) { return f.id === 'A'; });
const filaB = r1.filas.find(function(f) { return f.id === 'B'; });
const filaC = r1.filas.find(function(f) { return f.id === 'C'; });

chk('★ Sin inicial: "sistema" es la operativa de siempre y el origen lo dice',
    filaA.sistema === 10 && filaA.origenSistema === 'operativo_no_reconciliado');
chk('★ Diferencia = físico − sistema (negativo = faltante, como el Excel real)',
    filaA.diferencia === -4 && filaA.fisico === 6);
chk('★ Diferencia positiva = sobrante',
    filaB.diferencia === 3 && filaB.fisico === 5 && filaB.sistema === 2);
chk('★ Neto en dinero = diferencia × precio del producto',
    filaA.neto === -400 && filaB.neto === 150, filaA.neto + ' / ' + filaB.neto);
chk('★ Pendiente: fisico/diferencia/neto en null, nunca 0 ni inventado',
    filaC.estado === 'pendiente' && filaC.fisico === null && filaC.diferencia === null && filaC.neto === null);
chk('Pendiente también reporta su "sistema" (para que se vea cuánto se espera encontrar)',
    filaC.sistema === 5);
chk('★ Totales: neto global, faltante y sobrante agregados por separado',
    r1.totalNeto === -250 && r1.totalFaltante === -4 && r1.totalSobrante === 3,
    JSON.stringify({ n: r1.totalNeto, f: r1.totalFaltante, s: r1.totalSobrante }));
chk('★ Orden: mayor diferencia absoluta primero (A con -4 antes que B con +3), pendiente al final',
    r1.filas[0].id === 'A' && r1.filas[1].id === 'B' && r1.filas[2].id === 'C');
chk('sinInicial cuenta los productos sin arrastre (los 3, en este escenario)',
    r1.sinInicial === 3);

// ═══ 4 · Con inicial contabilizado: "sistema" pasa a ser la oficial ════════
api.setInicial({ semana: SEM, estado: 'ok', saldos: { A: 8 }, origen: { numero: 1001 } });
ctx.movimientos = [{ tipo: 'compra', productoId: 'A', cantidad: 2, semanaId: SEM }];
const r2 = api.calcular();
const filaA2 = r2.filas.find(function(f) { return f.id === 'A'; });
chk('★ Con inicial: oficial = inicial + compras (aún sin ventas, FASE 10/11A las resta aparte)',
    filaA2.sistema === 10 && filaA2.origenSistema === 'oficial', JSON.stringify(filaA2));
chk('Físico contra la cifra oficial: sigue siendo físico − sistema',
    filaA2.diferencia === -4, String(filaA2.diferencia));
chk('Un producto sin inicial propio sigue cayendo al respaldo operativo, aunque otros sí tengan',
    r2.filas.find(function(f) { return f.id === 'B'; }).origenSistema === 'operativo_no_reconciliado');
chk('sinInicial ahora cuenta 2 (B y C), no los 3',
    r2.sinInicial === 2);

// ═══ 5 · Cableado en la app ═════════════════════════════════════════════
chk('★ El botón solo aparece con inventory.viewAll y el inventario abierto',
    /hasPermission\('inventory\.viewAll'\) && !esCerrado\) \{\s*acc \+= _ifBtn\('bt--secundario', '📊 Físico vs Sistema'/.test(uiInv));
chk("renderInventarioTab() enruta 'fisico_vs_sistema' a renderFisicoVsSistema()",
    /auditoriaView === 'fisico_vs_sistema'\)\s*return renderFisicoVsSistema\(\);/.test(uiInv));
chk('★ renderFisicoVsSistema() vuelve a negar el acceso si no hay inventory.viewAll (defensa en profundidad, no solo el botón)',
    /function renderFisicoVsSistema\(\) \{\s*if \(!hasPermission\('inventory\.viewAll'\)\)/.test(uiInv));
chk('El buscador "fvs" está registrado en BusquedaUI, con su propio motor',
    /BusquedaUI\.registrar\('fvs'/.test(buscador) && /var _motorFvs = crearMotorBusqueda/.test(buscador));
chk('_fvsSearchTerm se declara junto a los demás términos de búsqueda transitorios',
    /let _fvsSearchTerm\s*=\s*'';/.test(roles));
chk('index.html carga js/49-fisico-vs-sistema.js después de 48-consumo-teorico.js',
    html.indexOf('js/48-consumo-teorico.js') > 0 &&
    html.indexOf('js/48-consumo-teorico.js') < html.indexOf('js/49-fisico-vs-sistema.js') &&
    html.indexOf('js/49-fisico-vs-sistema.js') < html.indexOf('js/50-roles-permisos.js'));
chk('sw.js precalienta js/49-fisico-vs-sistema.js',
    /49-fisico-vs-sistema\.js/.test(sw));
chk('★ La fuente oficial quedó encendida (FASE 11B) — ver prueba-fase8.js y prueba-fase11a.js para el detalle',
    /var EXISTENCIA_FUENTE_OFICIAL_ACTIVA = true;/.test(existenciaSrc));

// ═══ Resultado ══════════════════════════════════════════════════════════
console.log('\n  ── FASE 11B · Físico vs Sistema (estática) ──\n');
casos.forEach(function(c) {
    console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre + (c.ok ? '' : '  ← ' + c.detalle));
});
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
