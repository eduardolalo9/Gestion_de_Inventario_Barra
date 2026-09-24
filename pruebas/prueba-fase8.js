#!/usr/bin/env node
/**
 * prueba-fase8.js — FASE 8 · Consistencia
 * ═══════════════════════════════════════════════════════════════════════════
 * Tres cosas distintas, una sola fase:
 *
 *   1. EXISTENCIA — una fuente oficial (inicial contabilizado + compras −
 *      ventas) calculada en un solo sitio, con respaldo declarado cuando no
 *      hay inicial. Se ejecuta el código REAL de js/47-existencia.js: no se
 *      reimplementa la fórmula aquí, porque una copia de la fórmula puede
 *      pasar la prueba mientras la app falla.
 *
 *   2. CATÁLOGO CON VERSIÓN — que una edición no se pierda por el orden en
 *      que sincronizan dos dispositivos. Se ejecutan las dos fusiones reales.
 *
 *   3. REPORTE — que lea lo mismo que ve la pantalla.
 *
 * No necesita emulador ni red.
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

const existenciaSrc  = fs.readFileSync(path.join(RAIZ, 'js', '47-existencia.js'), 'utf8');
const persistencia   = fs.readFileSync(path.join(RAIZ, 'js', '20-persistencia.js'), 'utf8');
const roles          = fs.readFileSync(path.join(RAIZ, 'js', '50-roles-permisos.js'), 'utf8');
const uiInv          = fs.readFileSync(path.join(RAIZ, 'js', '85-ui-inventario-fisico.js'), 'utf8');
const panel          = fs.readFileSync(path.join(RAIZ, 'js', '83-panel.js'), 'utf8');
const html           = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

// ═══ 1 · EXISTENCIA — el módulo real, con datos de mentira ═════════════════
// El contexto imita lo que la app tiene en memoria. `with (ctx)` hace que las
// funciones del módulo lean estas variables como leerían las globales reales.
const SEM = '2026-09-21';   // lunes de la semana "en curso" durante la prueba

const ctx = {
    semanaId:      function() { return SEM; },
    getTotalStock: function(p) { return (p && p.operativa) || 0; },
    products:      [],
    movimientos:   [],
    console:       { warn: function() {} }
};

let api;
try {
    api = new Function('ctx', 'with (ctx) {' + existenciaSrc + `
        return {
            oficial:    existenciaOficial,
            mostrada:   existenciaMostrada,
            comparar:   existenciaComparacion,
            entradas:   existenciaEntradasSemana,
            ventas:     existenciaVentasSemana,
            cargar:     existenciaCargarInicial,
            estado:     existenciaInicialEstado,
            setInicial: function(x) { _existenciaInicial = x; },
            setBandera: function(v) { EXISTENCIA_FUENTE_OFICIAL_ACTIVA = v; },
            bandera:    function() { return EXISTENCIA_FUENTE_OFICIAL_ACTIVA; }
        };
    }`)(ctx);
    chk('El módulo de existencia se puede ejecutar aislado', true);
} catch (e) {
    chk('El módulo de existencia se puede ejecutar aislado', false, String(e));
}

if (api) {
    const P_A = { id: 'A', name: 'TEQUILA A', operativa: 5 };
    const P_B = { id: 'B', name: 'RON B',     operativa: 2 };
    const P_N = { id: 'N', name: 'NUEVO',     operativa: 7 };   // alta posterior al cierre

    ctx.products    = [P_A, P_B, P_N];
    ctx.movimientos = [
        { tipo: 'compra', productoId: 'A', cantidad: 3,  semanaId: SEM },
        { tipo: 'compra', productoId: 'A', cantidad: 1,  semanaId: SEM },
        { tipo: 'compra', productoId: 'B', cantidad: 10, semanaId: '2026-09-14' }, // otra semana
        { tipo: 'ajuste', productoId: 'A', cantidad: 99, semanaId: SEM }           // otro tipo
    ];

    // ── Sin inicial: respaldo declarado, nunca un número inventado ──────────
    api.setInicial({ semana: SEM, estado: 'no_existe', saldos: null, origen: null });
    const sinIni = api.oficial(P_A);
    chk('★ Sin inicial, la existencia cae al conteo operativo y lo dice',
        sinIni.valor === 5 && sinIni.origen === 'operativo_no_reconciliado' && sinIni.hayInicial === false,
        JSON.stringify(sinIni));

    // ── Con inicial ─────────────────────────────────────────────────────────
    api.setInicial({ semana: SEM, estado: 'ok', saldos: { A: 12, B: 4 }, origen: { numero: 9 } });

    const a = api.oficial(P_A);
    chk('★ Existencia oficial = inicial + compras de la semana',
        a.valor === 16 && a.origen === 'oficial' && a.inicial === 12 && a.entradas === 4,
        JSON.stringify(a));

    const b = api.oficial(P_B);
    chk('Una compra de otra semana no suma a esta',
        b.valor === 4 && b.entradas === 0, JSON.stringify(b));

    chk('Un movimiento que no es compra no suma',
        api.entradas().A === 4, JSON.stringify(api.entradas()));

    const n = api.oficial(P_N);
    chk('★ Un producto sin línea en el inicial usa el respaldo, no cero',
        n.valor === 7 && n.origen === 'operativo_no_reconciliado', JSON.stringify(n));

    // ── Ventas: hoy vacías (FASE 10), pero la resta ya está enchufada ───────
    chk('Las ventas hoy son un hueco explícito (FASE 10)',
        JSON.stringify(api.ventas()) === '{}');
    const conVentas = api.oficial(P_A, undefined, { A: 6 });
    chk('★ Cuando existan ventas, se restan sin tocar nada más',
        conVentas.valor === 10 && conVentas.ventas === 6, JSON.stringify(conVentas));

    // ── Redondeo: sin esto las colas de coma flotante se arrastran ──────────
    api.setInicial({ semana: SEM, estado: 'ok', saldos: { A: 0.1 }, origen: null });
    ctx.movimientos = [{ tipo: 'compra', productoId: 'A', cantidad: 0.2, semanaId: SEM }];
    chk('El resultado se redondea a 3 decimales',
        api.oficial(P_A).valor === 0.3, String(api.oficial(P_A).valor));

    // ── El interruptor ──────────────────────────────────────────────────────
    ctx.movimientos = [];
    api.setInicial({ semana: SEM, estado: 'ok', saldos: { A: 12 }, origen: null });
    chk('★ Con la bandera apagada, la app sigue usando la cifra operativa',
        api.bandera() === false && api.mostrada(P_A) === 5, String(api.mostrada(P_A)));
    api.setBandera(true);
    chk('★ Encender la bandera cambia la fuente de toda la app',
        api.mostrada(P_A) === 16 - 4, String(api.mostrada(P_A)));   // 12 + 0 compras
    api.setBandera(false);

    // ── Comparación de la semana de observación ─────────────────────────────
    ctx.products = [P_A, P_B, P_N];
    api.setInicial({ semana: SEM, estado: 'ok', saldos: { A: 12, B: 2.0005 }, origen: null });
    const c = api.comparar();
    chk('La comparación solo mide lo comparable',
        c.comparados === 2 && c.sinInicial === 1, JSON.stringify(c).slice(0, 160));
    chk('★ Una diferencia por debajo de la tolerancia cuenta como coincidencia',
        c.coinciden === 1 && c.difieren === 1, JSON.stringify(c).slice(0, 160));
    chk('La diferencia se reporta con signo (oficial − operativa)',
        c.filas[0].id === 'A' && c.filas[0].dif === 7, JSON.stringify(c.filas[0]));

    // ── Una sola lectura: sin _db no hay consulta ni avisos colgados ────────
    let llamado = 0;
    api.setInicial({ semana: SEM, estado: 'ok', saldos: {}, origen: null });
    api.cargar(function() { llamado++; });
    chk('Con el inicial ya resuelto no se vuelve a consultar Firestore',
        llamado === 0 && api.estado().estado === 'ok');
}

// ═══ 2 · CATÁLOGO CON VERSIÓN — las dos fusiones reales ════════════════════
const trozos = ['_versionProducto\\(anterior\\)', '_comparaVersion\\(a, b\\)',
                '_mergeArrayByIdPreferLocal\\(localArr, cloudArr, deletedIds\\)',
                '_mergeArrayByIdPreferCloud\\(localArr, cloudArr\\)']
    .map(function(firma) {
        const m = persistencia.match(new RegExp('function ' + firma + ' \\{[\\s\\S]*?\\n        \\}'));
        return m ? m[0] : null;
    });

if (trozos.some(function(t) { return !t; })) {
    chk('Las funciones de fusión se pudieron aislar', false, 'firma cambiada');
} else {
    chk('Las funciones de fusión se pudieron aislar', true);
    const fus = new Function('with ({}) {' + trozos.join('\n') + `
        return { ver: _versionProducto, cmp: _comparaVersion,
                 local: _mergeArrayByIdPreferLocal, nube: _mergeArrayByIdPreferCloud };
    }`)();

    // Sin versión: EXACTAMENTE el comportamiento anterior (lo que permite
    // desplegar esto sin migrar los 424 productos del bar ni tocar reglas).
    const viejoLocal = fus.local([{ id: 'A', name: 'local' }], [{ id: 'A', name: 'nube' }], []);
    chk('★ Sin versión, al subir sigue ganando la copia local (como antes)',
        viejoLocal.length === 1 && viejoLocal[0].name === 'local', JSON.stringify(viejoLocal));

    const viejoNube = fus.nube([{ id: 'A', name: 'local' }], [{ id: 'A', name: 'nube' }]);
    chk('★ Sin versión, al bajar sigue ganando la copia de la nube (como antes)',
        viejoNube.length === 1 && viejoNube[0].name === 'nube', JSON.stringify(viejoNube));

    // Con versión: gana la más nueva, suba o baje.
    const nubeGana = fus.local([{ id: 'A', name: 'local', _v: 100 }],
                               [{ id: 'A', name: 'nube',  _v: 200 }], []);
    chk('★ Una edición más nueva en la nube ya no se pisa al subir',
        nubeGana.length === 1 && nubeGana[0].name === 'nube', JSON.stringify(nubeGana));

    const localGana = fus.nube([{ id: 'A', name: 'local', _v: 300 }],
                               [{ id: 'A', name: 'nube',  _v: 200 }]);
    chk('★ Una edición local sin sincronizar ya no se pierde al bajar un snapshot',
        localGana.length === 1 && localGana[0].name === 'local', JSON.stringify(localGana));

    const empate = fus.nube([{ id: 'A', name: 'local', _v: 200 }],
                            [{ id: 'A', name: 'nube',  _v: 200 }]);
    chk('Con la misma versión se aplica el criterio de siempre',
        empate[0].name === 'nube', JSON.stringify(empate));

    const soloUnaTiene = fus.nube([{ id: 'A', name: 'local', _v: 200 }], [{ id: 'A', name: 'nube' }]);
    chk('Una copia con versión gana a una copia sin versión (es posterior)',
        soloUnaTiene[0].name === 'local', JSON.stringify(soloUnaTiene));

    const borrado = fus.local([], [{ id: 'C', name: 'nube', _v: 999 }], ['C']);
    chk('★ La lápida manda sobre la versión: un producto borrado no revive',
        borrado.length === 0, JSON.stringify(borrado));

    const pedidos = fus.nube([{ id: 'P1', total: 10 }], [{ id: 'P1', total: 20 }, { id: 'P2' }]);
    chk('Pedidos e inventarios (sin versión) no cambian de comportamiento',
        pedidos.length === 2 && pedidos[0].total === 20, JSON.stringify(pedidos));

    chk('★ La versión nunca baja, aunque el reloj del teléfono esté atrasado',
        fus.ver(Date.now() + 60000) > Date.now() + 60000, String(fus.ver(Date.now() + 60000)));
    chk('Un producto nuevo nace con versión',
        typeof fus.ver(0) === 'number' && fus.ver(0) > 0);
}

// ═══ 3 · REPORTE — misma regla que la pantalla ═════════════════════════════
const repo = (roles.match(/async function generarYPublicarReporte\(\)[\s\S]*?\n        \}/) || [''])[0];
// Se busca la LECTURA, no la palabra: el comentario de la función explica de
// dónde venía el dato antes, y esa explicación debe poder seguir ahí.
chk('★ El reporte ya no relee la colección heredada conteoAreas',
    repo.length > 0 && !/collection\(\s*['"]conteoAreas['"]\s*\)/.test(repo),
    'sigue leyendo conteoAreas/dispositivos');
chk('★ El reporte usa auditoriaConteo, la misma cifra que ve el administrador',
    /auditoriaConteo/.test(repo));
chk('El reporte ya no promedia conteos por su cuenta',
    !/promedioEnteras|promedioAbiertas/.test(repo));
chk('★ Un reporte sin conteos no se publica en silencio',
    /conDatos === 0[\s\S]{0,200}?showNotification/.test(repo));
chk('El conflicto entre bartenders viaja al reporte',
    /hayConflicto/.test(repo));

// ═══ 4 · Cableado ══════════════════════════════════════════════════════════
chk('★ La fuente oficial nace apagada (semana de observación)',
    /var EXISTENCIA_FUENTE_OFICIAL_ACTIVA = false;/.test(existenciaSrc));
chk('index.html carga 47-existencia.js antes de 50-roles-permisos.js',
    html.indexOf('js/47-existencia.js') > 0 &&
    html.indexOf('js/47-existencia.js') < html.indexOf('js/50-roles-permisos.js') &&
    html.indexOf('js/47-existencia.js') > html.indexOf('js/45-inventario-datos.js'));
chk('El panel dejó de guardar su propia copia del inicial',
    !/_panelInicial\s*=\s*\{/.test(panel) && /existenciaCargarInicial/.test(panel),
    'dos copias del mismo dato vuelven a divergir');
chk('El panel pide la comparación a la capa de existencia',
    /existenciaComparacion\(\)/.test(panel));
chk('★ Guardar un producto sella su versión (alta y edición)',
    /_v: _versionProducto\(0\)/.test(uiInv) && /product\._v = _versionProducto\(product\._v\)/.test(uiInv));

// El interruptor solo sirve si TODO pregunta por él. Si "bajo mínimo" o el
// catálogo siguieran llamando a getTotalStock por su cuenta, encender la
// fuente oficial dejaría media app con una cifra y media con la otra.
const buscador = fs.readFileSync(path.join(RAIZ, 'js', '80-buscador.js'), 'utf8');
const render   = fs.readFileSync(path.join(RAIZ, 'js', '70-conversion-render.js'), 'utf8');
const bajoMin  = (buscador.match(/function _bajoMinimo\(p\) \{[\s\S]*?\n        \}/) || [''])[0];
chk('★ "Bajo mínimo" pregunta por la cifra oficial de la app',
    /existenciaMostrada/.test(bajoMin), bajoMin.slice(0, 200));
chk('★ El catálogo pregunta por la misma cifra',
    /existenciaMostrada\(product\)/.test(render));
chk('★ Los indicadores del panel preguntan por la misma cifra',
    /existenciaMostrada\(p\)/.test(panel));

// ═══ Resultado ═════════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(function(c) { return c.nombre.length; }));
console.log('\n  ── FASE 8 · existencia, versión de catálogo y reporte ──\n');
casos.forEach(function(c) {
    console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
                (c.ok ? '' : '   ← ' + c.detalle));
});
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) +
            ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
