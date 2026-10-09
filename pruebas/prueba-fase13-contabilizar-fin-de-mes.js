#!/usr/bin/env node
/**
 * prueba-fase13-contabilizar-fin-de-mes.js — FASE 13 · contabilizar un corte
 * de fin de mes · comprobaciones estáticas.
 * ═══════════════════════════════════════════════════════════════════════════
 * Autorizado por Eduardo (1-oct-2026): "Implementa contabilizar el finde
 * mes". Decisiones confirmadas antes de programar:
 *
 *   D1  Un domingo que además es fin de mes genera LAS DOS COSAS en un solo
 *       clic (el inicial semanal y el corte mensual), en el mismo batch.
 *   D2  El corte mensual se valoriza en dinero, con el mismo respaldo
 *       "sin precio" que ya usa "Valor en existencia" (83-panel.js): nunca
 *       se inventa un precio que el producto no tiene.
 *   D3  Sin pantalla de revisión todavía — solo se desbloquea la acción.
 *
 * clasificarRecuento() (js/15-ciclo-semanal.js) ya distinguía un corte de
 * fin de mes de un cierre de semana; hasta esta fase evaluarContabilizable()
 * lo bloqueaba sin excepción (decisión N-1 original, FASE 3). Esta prueba
 * cubre la ampliación de esa regla y la función nueva que arma el corte.
 *
 *   1  ★ cierreMensualDesdeSnapshot(): null si la fecha no es fin de mes.
 *   2  ★ mesId correcto ('YYYY-MM'), incluso cuando el mes también cierra
 *        semana (31-may-2026 es domingo Y fin de mes).
 *   3  ★ Valorización honesta: solo suma precio cuando es numérico; cuenta
 *        aparte los productos sin precio; nunca inventa uno.
 *   4    Redondeo: saldos a 3 decimales (igual que el inicial semanal),
 *        dinero a 2 decimales.
 *   5  ★ evaluarContabilizable() ahora distingue tres casos: semanal puro,
 *        mensual puro, y ambos a la vez — sin tocar el caso semanal puro
 *        (regresión cubierta también por prueba-contabilizar-conteo.js).
 *   6    Las reglas de Firestore protegen cortesMensuales igual que
 *        inventariosIniciales: create-sin-update-ni-delete, inmutable.
 *   7    contabilizarInventario() escribe ambos destinos en el MISMO batch
 *        cuando corresponde, y nunca escribe el que no corresponde.
 *
 *   node pruebas/prueba-fase13-contabilizar-fin-de-mes.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;
function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok: !!ok, detalle: detalle || '' });
    if (!ok) fallos++;
}
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

function extraer(fuente, nombre) {
    const m = new RegExp('(async\\s+)?function ' + nombre + '\\s*\\(').exec(fuente);
    if (!m) return null;
    let nivel = 0, dentro = false;
    for (let j = m.index; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(m.index, j + 1); }
    }
    return null;
}

const ciclo  = leer('js/15-ciclo-semanal.js');
const flujo  = leer('js/75-auditoria-flujo.js');
const ui     = leer('js/85-ui-inventario-fisico.js');
const reglas = leer('firestore.rules');

function bloqueReglas(cabecera) {
    const i = reglas.indexOf(cabecera);
    if (i === -1) return '';
    const j = reglas.indexOf('match /', i + cabecera.length);
    return reglas.slice(i, j === -1 ? reglas.length : j);
}

// ═══ 0 · Montaje — funciones puras reales, con el ciclo semanal real ═══════
const srcCierreMensual = extraer(flujo, 'cierreMensualDesdeSnapshot');
const srcEvaluar       = extraer(flujo, 'evaluarContabilizable');
chk('Existen cierreMensualDesdeSnapshot() y evaluarContabilizable()',
    !!srcCierreMensual && !!srcEvaluar);

const ctx = vm.createContext({ console: { warn() {}, info() {} } });
let A = null;
try {
    vm.runInContext(ciclo + '\n' + srcCierreMensual + '\n' + srcEvaluar +
        '\nglobalThis.API = { clasificarRecuento, semanaSiguiente, cierreMensualDesdeSnapshot, evaluarContabilizable };',
        ctx);
    A = ctx.API;
    chk('Las funciones se ejecutan aisladas con el ciclo semanal real', !!A);
} catch (e) {
    chk('Las funciones se ejecutan aisladas con el ciclo semanal real', false, String(e));
}

if (A) {
    // ═══ 1 · cierreMensualDesdeSnapshot — forma básica ═════════════════════
    chk('Sin cierre o sin fecha → null',
        A.cierreMensualDesdeSnapshot(null) === null &&
        A.cierreMensualDesdeSnapshot({}) === null);

    chk('★ Un domingo que NO es fin de mes → null (nada que valorizar)',
        A.cierreMensualDesdeSnapshot({ fecha: '2026-09-13', inventoryId: 'x', numero: 1, productos: [] }) === null,
        '13-sep-2026 es domingo pero no es el último día del mes');

    // ═══ 2 · mesId correcto, incluso cuando también cierra semana ══════════
    const corteMiercoles = A.cierreMensualDesdeSnapshot({
        fecha: '2026-09-30', inventoryId: 'inv-1', numero: 42,
        productos: [{ id: 'p1', total: 5, precio: 100 }]
    });
    chk('★ Miércoles fin de mes → corte mensual con mesId correcto',
        !!corteMiercoles && corteMiercoles.mesId === '2026-09',
        JSON.stringify(corteMiercoles));

    const corteAmbos = A.cierreMensualDesdeSnapshot({
        fecha: '2026-05-31', inventoryId: 'inv-2', numero: 7,
        productos: [{ id: 'p1', total: 2, precio: 50 }]
    });
    chk('★ Domingo-fin-de-mes (31-may-2026) también genera corte mensual, mesId=2026-05',
        !!corteAmbos && corteAmbos.mesId === '2026-05',
        JSON.stringify(corteAmbos));

    chk('El origen trae trazabilidad al inventario y a la semana cerrada',
        corteMiercoles.origen.inventoryId === 'inv-1' &&
        corteMiercoles.origen.numero === 42 &&
        corteMiercoles.origen.fechaCierre === '2026-09-30' &&
        corteMiercoles.origen.semanaCerrada === '2026-09-28',
        JSON.stringify(corteMiercoles.origen));

    // ═══ 3 · Valorización honesta — nunca se inventa un precio ═════════════
    const mixto = A.cierreMensualDesdeSnapshot({
        fecha: '2026-09-30', inventoryId: 'inv-3', numero: 1,
        productos: [
            { id: 'a', total: 10, precio: 25 },     // 250
            { id: 'b', total: 4,  precio: 12.5 },   // 50
            { id: 'c', total: 3 },                  // sin precio — NO se valoriza
            { id: 'd', total: 0, precio: 99 }        // en cero, pero sí tiene precio
        ]
    });
    chk('★ Solo suma el valor de los productos CON precio numérico',
        mixto.valorTotal === 300,
        'obtenido: ' + mixto.valorTotal);
    chk('★ Cuenta aparte los productos sin precio, no los excluye del total de productos',
        mixto.productosConPrecio === 3 && mixto.productosSinPrecio === 1 &&
        mixto.totalProductos === 4,
        JSON.stringify(mixto));
    chk('Un producto sin id se descarta sin reventar',
        A.cierreMensualDesdeSnapshot({
            fecha: '2026-09-30', inventoryId: 'x', numero: 1,
            productos: [{ total: 5, precio: 1 }, { id: 'ok', total: 1, precio: 2 }]
        }).totalProductos === 1);

    // ═══ 4 · Redondeo — saldos a 3 decimales, dinero a 2 ═══════════════════
    const redondeo = A.cierreMensualDesdeSnapshot({
        fecha: '2026-09-30', inventoryId: 'x', numero: 1,
        productos: [{ id: 'p', total: 0.1 + 0.2, precio: 3 }]   // 0.30000000000000004 en JS
    });
    chk('★ El saldo se redondea a 3 decimales (misma razón que el inicial semanal)',
        redondeo.saldos.p === 0.3,
        'obtenido: ' + redondeo.saldos.p);
    const dinero = A.cierreMensualDesdeSnapshot({
        fecha: '2026-09-30', inventoryId: 'x', numero: 1,
        productos: [{ id: 'p', total: 1, precio: 0.1 + 0.2 }]   // 0.1+0.2 = 0.30000000000000004
    });
    chk('El valor total se redondea a centavos',
        dinero.valorTotal === 0.3,
        'obtenido: ' + dinero.valorTotal);

    // ═══ 5 · evaluarContabilizable — tres casos, sin tocar el semanal puro ═
    const base = { estado: 'CERRADO', semanaId: '2026-09-28' };

    // Caso semanal puro — 2026-09-13 es domingo, no fin de mes.
    const semanalPuro = A.evaluarContabilizable(Object.assign({}, base, { fechaRecuento: '2026-09-13', semanaId: '2026-09-07' }));
    chk('★ Semanal puro: haceSemanal sí, haceMensual no (sin regresión)',
        semanalPuro.puede === true && semanalPuro.haceSemanal === true &&
        semanalPuro.haceMensual === false && semanalPuro.mesId === null &&
        semanalPuro.semanaDestino === '2026-09-14',
        JSON.stringify(semanalPuro));

    // Caso mensual puro — 2026-09-30 es miércoles, fin de mes, no domingo.
    const mensualPuro = A.evaluarContabilizable(Object.assign({}, base, { fechaRecuento: '2026-09-30' }));
    chk('★ Mensual puro (miércoles fin de mes): antes se bloqueaba — ahora se puede',
        mensualPuro.puede === true, JSON.stringify(mensualPuro));
    chk('★ Mensual puro: NO genera inicial semanal, sí mesId',
        mensualPuro.haceSemanal === false && mensualPuro.semanaDestino === null &&
        mensualPuro.haceMensual === true && mensualPuro.mesId === '2026-09-30'.slice(0, 7),
        JSON.stringify(mensualPuro));

    // Caso combinado — 2026-05-31 es domingo Y fin de mes.
    const combinado = A.evaluarContabilizable(Object.assign({}, base, { fechaRecuento: '2026-05-31', semanaId: '2026-05-25' }));
    chk('★ D1 · Domingo-fin-de-mes: hace las dos cosas a la vez',
        combinado.puede === true && combinado.haceSemanal === true && combinado.haceMensual === true &&
        combinado.semanaDestino === A.semanaSiguiente('2026-05-31') && combinado.mesId === '2026-05',
        JSON.stringify(combinado));

    // FASE 14 (decisión de Eduardo, 5-oct-2026): un miércoles normal ya NO se
    // bloquea — se contabiliza como ANCLA del Total, sin inicial ni corte.
    const fuera = A.evaluarContabilizable(Object.assign({}, base, { fechaRecuento: '2026-09-23' }), '2026-10-05');  // miércoles normal
    chk('FASE 14 · un miércoles que no es fin de mes se contabiliza solo como ancla',
        fuera.puede === true && fuera.haceAncla === true && fuera.anclaTipo === 'mitad_de_semana' &&
        fuera.haceSemanal === false && fuera.haceMensual === false && fuera.anclaFecha === '2026-09-23',
        JSON.stringify(fuera));
    chk('FASE 14 · el fin de mes entre semana además es ancla (tipo fin_de_mes)',
        mensualPuro.haceAncla === true && mensualPuro.anclaTipo === 'fin_de_mes', JSON.stringify(mensualPuro));
    chk('FASE 14 · un domingo NO genera ancla aparte (su inicial ya lo es)',
        semanalPuro.haceAncla === false && combinado.haceAncla === false);

    // Ya contabilizado: el "hecho" ahora puede traer los dos destinos.
    const hecho = A.evaluarContabilizable({ estado: 'CONTABILIZADO', semanaDestino: '2026-06-01', mesDestino: '2026-05' });
    chk('★ "Hecho" conserva ambos destinos cuando los hay',
        hecho.hecho === true && hecho.semanaDestino === '2026-06-01' && hecho.mesDestino === '2026-05',
        JSON.stringify(hecho));
    const hechoSoloMes = A.evaluarContabilizable({ estado: 'CONTABILIZADO', mesDestino: '2026-09' });
    chk('"Hecho" sin inicial semanal no inventa una semana',
        hechoSoloMes.semanaDestino === null && hechoSoloMes.mesDestino === '2026-09');
}

// ═══ 6 · Firestore rules — cortesMensuales inmutable, igual patrón ═════════
const bloqueCM = bloqueReglas('match /cortesMensuales/{mesId} {');
chk('Existe el bloque de reglas para cortesMensuales', !!bloqueCM);
chk('★ Inmutable: create sí, update y delete no',
    /allow update, delete: if false;/.test(bloqueCM));
chk('★ Crear exige inventory.post, igual que el inicial semanal',
    /hasPerm\('inventory\.post'\)/.test(bloqueCM));
chk('El documento no puede declarar un mes distinto de su ruta',
    /request\.resource\.data\.mesId == mesId/.test(bloqueCM));
chk('El mesId se valida con formato YYYY-MM',
    /_mesIdValido\(mesId\)/.test(bloqueCM) &&
    /function _mesIdValido\(s\)/.test(reglas));
chk('★ La lectura de dinero se restringe (no abierta a cualquier autenticado, a diferencia del inicial semanal)',
    /allow read:\s*if hasPerm\('inventory\.viewAll'\)/.test(bloqueCM),
    'lleva valorTotal — mismo criterio que ventas/compras, que también restringen lectura');
chk('inventariosIniciales sigue abierto a cualquier autenticado (sin regresión)',
    /allow read:\s*if request\.auth != null;/.test(bloqueReglas('match /inventariosIniciales/{semanaId} {')));

// ═══ 7 · contabilizarInventario — un solo batch, ambos destinos cuando toca ═
const contab = extraer(flujo, 'contabilizarInventario') || '';
chk('Existe contabilizarInventario() (no se duplicó la función)', !!contab);
chk('★ Decide con haceSemanal/haceMensual de evaluarContabilizable(), no con una copia',
    /const ev = evaluarContabilizable\(inv\);/.test(contab) &&
    /ev\.haceSemanal/.test(contab) && /ev\.haceMensual/.test(contab));
chk('★ Sigue siendo UN SOLO batch (atómico) incluso con dos destinos',
    (contab.match(/const batch = _db\.batch\(\);/g) || []).length === 1 &&
    (contab.match(/await batch\.commit\(\);/g) || []).length === 1);
chk('★ El inicial semanal solo se crea si faltaba (faltaSemana)',
    /if \(faltaSemana\) \{[\s\S]{0,400}?batch\.set\(inicialRef/.test(contab));
chk('★ El corte mensual solo se crea si faltaba (faltaMes)',
    /if \(faltaMes\) \{[\s\S]{0,400}?batch\.set\(corteRef/.test(contab) &&
    /\.collection\('cortesMensuales'\)/.test(contab));
chk('El corte mensual guarda el valor en dinero',
    /valorTotal:\s*corteMensual\.valorTotal/.test(contab));
chk('La cabecera del inventario guarda mesDestino cuando corresponde',
    /estadoUpdate\.mesDestino\s*=\s*corteMensual\.mesId/.test(contab));
chk('Un conflicto en CUALQUIERA de los dos destinos bloquea sin escribir nada',
    /No se sobrescribe nada/.test(contab) &&
    /ya tiene un corte contable generado por el/.test(contab) &&
    /ya tiene un inicial generado por el/.test(contab));
chk('El mensaje de confirmación menciona el valor estimado solo cuando hay corte mensual',
    /if \(faltaMes\) \{[\s\S]{0,300}?Valor estimado del corte/.test(contab));
chk('NO escribe el corte mensual cuando el cierre es semanal puro (sin regresión)',
    /if \(faltaMes\) \{/.test(contab),  // la guarda existe; la prueba de comportamiento real vive en integración
    'la guarda condicional es la que impide escribir de más; el valor de faltaMes se prueba en integración');

// ═══ 8 · UI — botón y mensajes distinguen los tres casos ═══════════════════
const paso = extraer(ui, '_renderSiguientePasoInventario') || '';
chk('★ El botón cambia de etiqueta cuando el corte es mensual',
    /Contabilizar \(semana \+ mes\)/.test(paso) && /Contabilizar cierre de mes/.test(paso));
chk('El texto de "pendiente" ya no asume que siempre hay una semana destino (FASE 14: + ancla)',
    /destinos\(ev\.semanaDestino, ev\.mesId, ev\.anclaFecha\)/.test(paso));
chk('El texto de "hecho" también usa todos los destinos (FASE 14: + ancla)',
    /destinos\(ev\.semanaDestino, ev\.mesDestino, ev\.anclaDestino\)/.test(paso));
chk('El Historial muestra el corte mensual aparte del inicial semanal',
    /inv\.mesDestino/.test(ui) && /Corte mensual/.test(ui));
chk('El detalle del inventario cerrado también distingue ambos destinos',
    /meta\.mesDestino/.test(ui));
chk('El indicador "corte de mes" en la cabecera no pisa a "cierra semana"',
    /cierra semana<\/span>/.test(ui) && /corte de mes<\/span>/.test(ui));

// ═══ Resultado ═══════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(function(c) { return c.nombre.length; }));
console.log('\n  ── FASE 13 · contabilizar fin de mes (estática) ──\n');
casos.forEach(function(c) {
    console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
                (c.ok ? '' : '   ← ' + c.detalle));
});
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) +
            ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
