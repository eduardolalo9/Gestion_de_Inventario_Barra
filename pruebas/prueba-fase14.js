#!/usr/bin/env node
/**
 * prueba-fase14.js — FASE 14 · Ancla del Total (arrastre continuo) y
 * venta del turno (Simular / Procesar) · estática, con el código REAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Decisiones de Eduardo (5-oct-2026) que esta prueba protege:
 *   · El Total sale del ÚLTIMO corte contabilizado (inicial de domingo, fin
 *     de mes o recuento de mitad de semana) + compras − consumo teórico de
 *     las ventas POSTERIORES a su fecha, aunque pasen semanas (tope 56 días).
 *   · Un recuento de mitad de semana se contabiliza como ancla si no hay uno
 *     más nuevo.
 *   · Venta del turno: Simular no escribe nada; Procesar guarda el periodo y
 *     con eso baja el Total. Nunca escribe en stockByArea.
 *
 * Se ejecutan los archivos reales js/15, js/46, js/48 y js/47 juntos, con
 * datos de mentira, igual que prueba-fase8.js.
 *   node pruebas/prueba-fase14.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const casos = []; let fallos = 0;
function chk(nombre, ok, detalle) { casos.push({ nombre, ok: !!ok, detalle: detalle || '' }); if (!ok) fallos++; }

const ciclo = leer('js/15-ciclo-semanal.js'), arr = leer('js/46-arrastre.js'), cons = leer('js/48-consumo-teorico.js'),
      exis = leer('js/47-existencia.js'), turno = leer('js/94-venta-turno.js'), ventasJs = leer('js/93-ventas.js'),
      flujo = leer('js/75-auditoria-flujo.js'), ui = leer('js/85-ui-inventario-fisico.js'), panel = leer('js/83-panel.js'),
      arranque = leer('js/60-arranque.js'), reglas = leer('firestore.rules'), html = leer('index.html'), sw = leer('sw.js');

// ═══ Montaje: los cuatro archivos reales en un mismo contexto ═══════════════
const ctx = {
    window: {}, console: { warn() {}, info() {}, log() {} },
    products: [], recetas: [], movimientos: [], ventas: [], ventasSemanaId: null,
    getTotalStock: p => (p && p.operativa) || 0,
    _db: null, FIRESTORE_DOC_ID: 'x'
};
let A;
try {
    A = new Function('ctx', 'with (ctx) {' + ciclo + '\n' + arr + '\n' + cons + '\n' + exis + `
        return {
            parseFechaLocal, fechaISOLocal, semanaId,
            anclaFechaDeInicial, anclaElegir, arrastreSemanasNecesarias, arrastreEntradas, arrastrePeriodosVentas,
            arrastreLineasVentas, anclaDesdeCierre, periodoCruzaAncla, anclaEtiqueta, arrastreDiasEntre, ARRASTRE_MAX_DIAS,
            consumoTeorico, consumoTeoricoDeLineas, consumoTeoricoInvalidar,
            oficial: existenciaOficial, entradas: existenciaEntradas, ventasEx: existenciaVentas, resumen: existenciaArrastreResumen,
            setInicial: function(x) { _existenciaInicial = x; },
            setArrastre: function(x) { _existenciaArrastre = x; _existenciaArrastreMemo = { clave: null }; },
            invalidar: existenciaInvalidarInicial, estado: existenciaInicialEstado
        };
    }`)(ctx);
    chk('Los archivos reales 15 + 46 + 48 + 47 se ejecutan juntos', true);
} catch (e) { chk('Los archivos reales 15 + 46 + 48 + 47 se ejecutan juntos', false, String(e && e.stack || e)); }

if (A) {
    // ═══ 1 · El ancla ════════════════════════════════════════════════════════
    chk('★ El ancla de un inicial semanal es el DOMINGO anterior a su lunes',
        A.anclaFechaDeInicial('2026-10-05') === '2026-10-04', A.anclaFechaDeInicial('2026-10-05'));
    const ini = { tipo: 'inicial_semanal', fecha: '2026-09-27', saldos: { P: 1 } };
    const fdm = { tipo: 'fin_de_mes', fecha: '2026-09-30', saldos: { P: 2 } };
    const mit = { tipo: 'mitad_de_semana', fecha: '2026-10-08', saldos: { P: 3 } };
    chk('★ Gana el corte MÁS NUEVO (fin de mes 30 > inicial del 27)',
        A.anclaElegir([ini, fdm], '2026-10-03') === fdm);
    chk('Un corte con fecha futura no vale hoy',
        A.anclaElegir([ini, fdm, mit], '2026-10-05') === fdm);
    chk('Empate de fecha: gana el inicial semanal (el ciclo oficial)',
        A.anclaElegir([{ tipo: 'mitad_de_semana', fecha: '2026-09-27', saldos: {} }, ini], '2026-10-01').tipo === 'inicial_semanal');
    chk('Sin candidatos no hay ancla (nunca se inventa una)', A.anclaElegir([], '2026-10-01') === null);
    chk('Tope de arrastre: 56 días (8 semanas)', A.ARRASTRE_MAX_DIAS === 56);
    chk('Semanas a leer desde el día siguiente al ancla hasta hoy',
        JSON.stringify(A.arrastreSemanasNecesarias('2026-09-30', '2026-10-12')) === JSON.stringify(['2026-09-28', '2026-10-05', '2026-10-12']),
        JSON.stringify(A.arrastreSemanasNecesarias('2026-09-30', '2026-10-12')));
    chk('Un ancla de hoy no necesita leer ninguna semana', A.arrastreSemanasNecesarias('2026-10-05', '2026-10-05').length === 0);

    const anc = A.anclaDesdeCierre({ fecha: '2026-10-01', inventoryId: 'inv9', numero: 1009,
        productos: [{ id: 'A', total: 2.0004 }, { id: 'B', total: 0, contado: true }, { id: 'C', total: 0, contado: false }] }, 'mitad_de_semana');
    chk('★ anclaDesdeCierre: lo contado entra (también el cero contado); lo NO contado no entra',
        anc && anc.saldos.A === 2 && anc.saldos.B === 0 && !('C' in anc.saldos) && anc.productosNoContados === 1, JSON.stringify(anc));
    chk('anclaDesdeCierre deja trazabilidad (inventario, número, fecha) y su semana',
        anc.origen.inventoryId === 'inv9' && anc.origen.numero === 1009 && anc.fecha === '2026-10-01' && anc.semanaId === '2026-09-28');
    chk('anclaDesdeCierre rechaza un tipo que no es ancla', A.anclaDesdeCierre({ fecha: '2026-10-01', productos: [] }, 'semanal') === null);

    // ═══ 2 · Lo que se suma y lo que se resta ═══════════════════════════════
    const movs = [
        { movId: 'm1', tipo: 'compra', productoId: 'A', cantidad: 5, fecha: '2026-09-30' },   // el día del corte: ya contado
        { movId: 'm2', tipo: 'compra', productoId: 'A', cantidad: 2, fecha: '2026-10-01' },
        { movId: 'm2', tipo: 'compra', productoId: 'A', cantidad: 2, fecha: '2026-10-01' },   // duplicado (memoria + Firestore)
        { movId: 'm3', tipo: 'compra', productoId: 'B', cantidad: 1, semanaId: '2026-10-05' },// sin fecha: usa su lunes
        { movId: 'm4', tipo: 'compra', productoId: 'B', cantidad: 9, fecha: '2026-10-09' },   // futura
        { movId: 'm5', tipo: 'ajuste', productoId: 'A', cantidad: 99, fecha: '2026-10-02' }
    ];
    const ent = A.arrastreEntradas('2026-09-30', movs, '2026-10-06');
    chk('★ Solo suman compras POSTERIORES al corte (la del mismo día ya está en el conteo)', ent.A === 2, JSON.stringify(ent));
    chk('Una compra repetida (mismo movId) no suma dos veces', ent.A === 2);
    chk('Una compra sin fecha usa el lunes de su semana', ent.B === 1, JSON.stringify(ent));
    chk('Una compra futura o que no es compra no suma', ent.B === 1 && ent.A === 2);

    const per = A.arrastrePeriodosVentas('2026-09-30', [
        { id: 'a', inicio: '2026-09-28', fin: '2026-09-29', lineas: [] },   // anterior
        { id: 'b', inicio: '2026-09-30', fin: '2026-10-01', lineas: [] },   // cruza el corte
        { id: 'c', inicio: '2026-10-02', fin: '2026-10-02', lineas: [] },   // incluido
        { id: 'c', inicio: '2026-10-02', fin: '2026-10-02', lineas: [] }    // duplicado
    ], '2026-10-05');
    chk('★ Periodo posterior al corte: se resta', per.incluidos.length === 1 && per.incluidos[0].id === 'c');
    chk('Periodo anterior (o del mismo día del corte): no se resta', per.anteriores.length === 1 && per.anteriores[0].id === 'a');
    chk('★ Periodo que cruza el corte: no se resta y se reporta', per.partidos.length === 1 && per.partidos[0].id === 'b');
    chk('★ Días esperados = del día siguiente al corte hasta ayer; faltan 03 y 04',
        per.diasEsperados.join(',') === '2026-10-01,2026-10-02,2026-10-03,2026-10-04' &&
        per.diasFaltantes.join(',') === '2026-10-03,2026-10-04', JSON.stringify(per));
    chk('periodoCruzaAncla detecta el cruce y nada más',
        A.periodoCruzaAncla('2026-09-30', '2026-10-01', '2026-09-30') && !A.periodoCruzaAncla('2026-10-01', '2026-10-02', '2026-09-30')
        && !A.periodoCruzaAncla('2026-09-29', '2026-09-30', '2026-09-30'));

    // ═══ 3 · El Total, de punta a punta, por la ruta de arrastre ═══════════
    ctx.products = [{ id: 'TEQ', name: 'TEQUILA', unit: 'PZA', operativa: 1 }, { id: 'LIM', name: 'LIMON', unit: 'KGS', operativa: 7 },
                    { id: 'NUE', name: 'NUEVO', unit: 'PZA', operativa: 4 }];
    ctx.recetas  = [{ pv: 'PV1', nombre: 'MARGARITA', ingredientes: [{ productoId: 'TEQ', cantidad: 0.06, uom: 'PZA' }, { productoId: 'LIM', cantidad: 0.03, uom: 'KGS' }] }];
    ctx.movimientos = [{ movId: 'x1', tipo: 'compra', productoId: 'TEQ', cantidad: 1, fecha: '2026-10-02' }];
    const hoy = A.fechaISOLocal(new Date());
    const corte = A.arrastreSumarDias ? null : null; // (no se usa)
    const fechaCorte = (function() { const d = new Date(); d.setDate(d.getDate() - 3); return A.fechaISOLocal(d); })();
    const diaPost = (function() { const d = new Date(); d.setDate(d.getDate() - 2); return A.fechaISOLocal(d); })();
    ctx.movimientos = [{ movId: 'x1', tipo: 'compra', productoId: 'TEQ', cantidad: 1, fecha: diaPost }];
    A.setInicial({ semana: A.semanaId(new Date()), estado: 'ok', saldos: { TEQ: 2, LIM: 1 }, origen: { numero: 1001 },
                   ancla: { tipo: 'mitad_de_semana', fecha: fechaCorte, id: fechaCorte, ruta: 'arrastre' } });
    A.setArrastre({ anclaFecha: fechaCorte, version: 7, comprasNoDisponibles: false, ventasNoDisponibles: false,
                    compras: [{ movId: 'x1', tipo: 'compra', productoId: 'TEQ', cantidad: 1, fecha: diaPost }],   // el mismo asiento que en memoria
                    periodos: [{ id: diaPost + '_' + diaPost, inicio: diaPost, fin: diaPost, lineas: [{ sku: 'PV1', cantidad: 10 }] },
                               { id: fechaCorte + '_' + fechaCorte, inicio: fechaCorte, fin: fechaCorte, lineas: [{ sku: 'PV1', cantidad: 50 }] }] });
    const teq = A.oficial(ctx.products[0]);
    chk('★ Total = saldo del corte + compras posteriores − consumo de ventas posteriores (2 + 1 − 10×0.06 = 2.4)',
        teq.valor === 2.4 && teq.origen === 'oficial' && teq.entradas === 1 && teq.ventas === 0.6, JSON.stringify(teq));
    chk('La venta del día del corte NO se resta (ya está en ese conteo)', A.ventasEx().TEQ === 0.6, JSON.stringify(A.ventasEx()));
    chk('El resultado trae de qué ancla salió', teq.ancla && teq.ancla.tipo === 'mitad_de_semana' && teq.ancla.fecha === fechaCorte);
    const lim = A.oficial(ctx.products[1]);
    chk('Un insumo sin compras solo resta su consumo (1 − 10×0.03 = 0.7)', lim.valor === 0.7, JSON.stringify(lim));
    const nue = A.oficial(ctx.products[2]);
    chk('★ Un producto que no entró al corte usa el respaldo operativo, nunca cero', nue.valor === 4 && nue.origen === 'operativo_no_reconciliado');
    const res = A.resumen();
    chk('El resumen dice el ancla y los días de ventas que faltan',
        res && res.ancla.fecha === fechaCorte && res.diasEsperados === 2 && res.diasFaltantes.length === 1, JSON.stringify(res));

    // La ruta antigua (sin ancla) sigue idéntica: es la que usan las pruebas de FASE 8/11.
    A.setInicial({ semana: A.semanaId(new Date()), estado: 'ok', saldos: { TEQ: 2 }, origen: null });
    ctx.movimientos = [{ tipo: 'compra', productoId: 'TEQ', cantidad: 3, semanaId: A.semanaId(new Date()) }];
    chk('★ Sin ancla de arrastre, la ruta de la semana en curso no cambia (2 + 3 = 5)',
        A.oficial(ctx.products[0]).valor === 5, JSON.stringify(A.oficial(ctx.products[0])));
    chk('Sin ancla de arrastre no hay resumen de arrastre', A.resumen() === null);
    A.invalidar();
    chk('Invalidar olvida el ancla para releerla', A.estado().estado === 'sin_cargar' && A.estado().ancla === null);

    // consumoTeorico() sigue igual tras separar el cruce
    ctx.ventas = [{ sku: 'PV1', cantidad: 7 }]; ctx.ventasSemanaId = '2026-09-28'; A.consumoTeoricoInvalidar();
    const ct = A.consumoTeorico();
    chk('★ consumoTeorico() da lo mismo que antes: 7 × 0.06 = 0.42', ct.consumo.TEQ === 0.42 && ct.semana === '2026-09-28', JSON.stringify(ct.consumo));
    chk('consumoTeoricoDeLineas() usa el mismo cruce', A.consumoTeoricoDeLineas([{ sku: 'PV1', cantidad: 7 }]).consumo.TEQ === 0.42);
}

// ═══ 4 · Venta del turno — capa pura ═══════════════════════════════════════
let T;
try {
    T = new Function('ctx', 'with (ctx) {' + turno + '\nreturn { ventaTurnoAnalizar, ventaTurnoEfecto };}')({ window: {} });
} catch (e) { chk('js/94-venta-turno.js se ejecuta aislado', false, String(e)); }
if (T) {
    chk('js/94-venta-turno.js se ejecuta aislado', true);
    const prods = [{ id: 'TEQ', name: 'TEQUILA', unit: 'PZA', precio: 350 }, { id: 'LIM', name: 'LIMON', unit: 'KGS' },
                   { id: 'GIN', name: 'GINEBRA', unit: 'PZA', precio: 400 }];
    const exist = { TEQ: { valor: 0.5, origen: 'oficial' }, LIM: { valor: 0.1, origen: 'operativo_no_reconciliado' }, GIN: { valor: 3, origen: 'oficial' } };
    const consumir = () => ({ consumo: { TEQ: 1.2, LIM: 0.3, GIN: 0.5, FANT: 2 }, avisos: { sinReceta: [{ sku: 'X', nombre: 'TE', cantidad: 1 }], sinCatalogo: [{ productoId: 'FANT' }], uomDistinta: [] } });
    const opts = { periodo: { inicio: '2026-10-05', fin: '2026-10-05' }, anclaFecha: '2026-10-04', productos: prods,
                   existencia: p => exist[p.id], consumir: consumir };
    const s = T.ventaTurnoAnalizar([{ sku: 'PV1', cantidad: 20 }], opts);
    chk('★ Efecto: ventas posteriores al corte bajan el Total', s.efecto === 'baja_total');
    chk('★ Señala los insumos que el Total no cubre (TEQ y LIM), no los que sí (GIN)',
        s.totalNoAlcanzan === 2 && s.noAlcanzan.every(x => x.productoId !== 'GIN'), JSON.stringify(s.noAlcanzan));
    const teq = s.noAlcanzan.find(x => x.productoId === 'TEQ');
    chk('★ Faltante = consumo − Total disponible (1.2 − 0.5 = 0.7) y costo = faltante × precio ($245)',
        !!teq && teq.faltante === 0.7 && teq.costoFaltante === 245, JSON.stringify(teq));
    chk('★ Un insumo sin precio no entra al costo: se cuenta aparte (nunca se inventa)',
        s.noAlcanzanSinPrecio === 1 && s.costoDesviacion === 245, JSON.stringify(s));
    chk('Un insumo fuera del catálogo no tiene Total del cual restar: queda en avisos', s.insumos.every(x => x.productoId !== 'FANT') && s.avisos.sinCatalogo.length === 1);
    chk('Marca cuántos insumos usan el respaldo (no bajan al procesar)', s.enRespaldo === 1);
    const ant = T.ventaTurnoAnalizar([{ sku: 'PV1', cantidad: 20 }], Object.assign({}, opts, { periodo: { inicio: '2026-10-03', fin: '2026-10-04' } }));
    chk('★ Ventas anteriores al corte: no bajan el Total y no se inventan faltantes',
        ant.efecto === 'anterior_al_corte' && ant.totalNoAlcanzan === 0 && ant.insumos.every(x => x.despues === x.disponible));
    chk('Un periodo que cruza el corte se detecta', T.ventaTurnoEfecto({ inicio: '2026-10-03', fin: '2026-10-05' }, '2026-10-04') === 'cruza_corte');
    chk('Sin corte contabilizado se dice (el respaldo no resta ventas)', T.ventaTurnoEfecto({ inicio: '2026-10-05', fin: '2026-10-05' }, null) === 'sin_ancla');
}
chk('★ Simular NO escribe: el analizador no toca Firestore ni guarda nada',
    !/collection\(|\.set\(|\.update\(|saveToLocalStorage/.test((turno.match(/function ventaTurnoAnalizar[\s\S]*?\n        }\n/) || [''])[0])
    && /function ventaTurnoSimular[\s\S]{0,700}parsed\.simulacion = _ventaTurnoCalcular\(parsed\);\s*\n\s*renderTab\(\);/.test(turno));
chk('★ Procesar guarda con confirmarImportacionVentas() (misma regla create-only de FASE 10B) y relee el Total',
    /function ventaTurnoProcesar[\s\S]*await confirmarImportacionVentas\(\)[\s\S]*existenciaInvalidarInicial\(\)/.test(turno));
chk('★ La venta del turno NUNCA escribe en stockByArea ni en el conteo físico',
    !/stockByArea\s*[\[.=]|stockByArea\s*\)|userAuditoria|auditoriaConteo\s*=/.test(turno.replace(/\/\/.*$/gm, '')));
chk('Procesar pide confirmación con el resumen de lo que se va a descontar',
    /showConfirm\(msg/.test(turno) && /no alcanzan · desviación/.test(turno));
chk('Un periodo que cruza el corte no se deja procesar', /efecto === 'cruza_corte'[\s\S]{0,200}divídelo en dos/.test(turno));

// ═══ 5 · Ventas: el botón y la validación ═════════════════════════════════
let V;
try {
    V = new Function('ctx', 'with (ctx) {' + ciclo + '\n' + arr + '\n' + ventasJs + '\nreturn { validarPeriodoVentas };}')({
        window: {}, console: { warn() {} }, escapeHtml: s => s, _findColCompras: () => null, _numeroExcel: () => null, _normCabCompras: s => s });
} catch (e) { chk('js/93-ventas.js se ejecuta aislado', false, String(e)); }
if (V) {
    const v = V.validarPeriodoVentas('2026-09-29', '2026-10-01', [], '2026-10-05', '2026-09-30');
    chk('★ Importar un periodo que cruza el último corte se bloquea con un motivo claro',
        !v.ok && v.errores.some(e => /cruza la fecha del último corte/.test(e)), JSON.stringify(v.errores));
    const ok = V.validarPeriodoVentas('2026-10-01', '2026-10-02', [], '2026-10-05', '2026-09-30');
    chk('Un periodo posterior al corte pasa', ok.ok, JSON.stringify(ok.errores));
    const sinAncla = V.validarPeriodoVentas('2026-09-29', '2026-10-01', [], '2026-10-05');
    chk('Sin ancla conocida, la validación es la de siempre (sin cambios para las llamadas existentes)', sinAncla.ok, JSON.stringify(sinAncla.errores));
}
chk('El botón de la vista previa dice "Procesar venta (baja el inventario)" y conserva su id',
    /id="ventasBtnConfirmar"[\s\S]{0,300}ventaTurnoProcesar\(\)[\s\S]{0,300}Procesar venta \(baja el inventario\)/.test(ventasJs));
chk('La vista previa incluye el panel "Reventar contra recetas" con el botón Simular',
    /renderSimulacionVentaTurno\(parsed\)/.test(ventasJs) && /id="vtBtnSimular"[^>]*onclick="ventaTurnoSimular\(\)"/.test(turno));
chk('Cambiar el periodo descarta la simulación (el efecto depende de las fechas)', /p\.simulacion = null;/.test(ventasJs));

// ═══ 6 · Contabilizar escribe el ancla ═════════════════════════════════════
const contab = (flujo.match(/async function contabilizarInventario[\s\S]*?\n        }\n/) || [''])[0];
chk('★ El ancla viaja en el MISMO batch que el estado CONTABILIZADO (todo o nada)',
    /collection\('anclasExistencia'\)\.doc\(ancla\.fecha\)[\s\S]{0,1200}batch\.set\(anclaRef/.test(contab) &&
    /estadoUpdate\.anclaDestino\s*=\s*ancla\.fecha/.test(contab) && /await batch\.commit\(\)/.test(contab));
chk('★ Antes de escribir se comprueba si hay un corte más nuevo; mitad de semana se rechaza, fin de mes conserva su corte',
    /_anclaPosteriorA\(anclaFecha\)/.test(contab) && /if \(!haceMensual\) \{[\s\S]{0,300}no se contabiliza/.test(contab) && /anclaOmitida = post\.desc/.test(contab));
chk('Si no se puede comprobar el corte más nuevo, no se contabiliza a ciegas', /post\.error[\s\S]{0,200}No se contabilizó nada/.test(contab));
chk('Idempotente: un ancla ya escrita por este mismo inventario cuenta como hecha; otra la bloquea',
    /_verificarAnclaExistente\(anclaFecha, inventoryId\)/.test(contab) && /previoAncla\.existe && !previoAncla\.mismoOrigen/.test(contab));
chk('Tras contabilizar se invalida y se vuelve a pedir el ancla (el Total cambia sin recargar)',
    /existenciaInvalidarInicial\(\)[\s\S]{0,400}existenciaCargarInicial\(/.test(contab));
chk('La pantalla ofrece "Contabilizar como ancla del Total" y lo muestra en Historial/detalle',
    /Contabilizar como ancla del Total/.test(ui) && /inv\.anclaDestino/.test(ui) && /meta\.anclaDestino/.test(ui));

// ═══ 7 · Reglas de Firestore ═══════════════════════════════════════════════
const bloque = (reglas.match(/match \/anclasExistencia\/\{fecha\} \{[\s\S]*?\n                 \}/) || [''])[0];
chk('Existe el bloque anclasExistencia/{fecha}', !!bloque);
chk('★ Inmutable: create sí; update y delete no', /allow update, delete: if false;/.test(bloque));
// v5.18 — el id se valida con _idAnclaValido (fecha, o fecha_HHmm para el corte importado).
chk('Crear exige inventory.post, id válido (fecha o fecha_HHmm), tipo de ancla, origen y saldos',
    /hasPerm\('inventory\.post'\)/.test(bloque) && /_idAnclaValido\(fecha, request\.resource\.data\)/.test(bloque) &&
    /tipo in \['fin_de_mes', 'mitad_de_semana', 'importacion_excel'\]/.test(bloque) &&
    /origen\.inventoryId is string/.test(bloque) && /saldos is map/.test(bloque) &&
    /d\.fecha == id/.test(reglas) && /id == d\.fecha \+ '_' \+ d\.hora/.test(reglas));
chk('Lectura para cualquier autenticado (solo cantidades, sin dinero, como el inicial)', /allow read:\s+if request\.auth != null;/.test(bloque));
chk('★ La transición a CONTABILIZADO admite anclaDestino (si no, hasOnly tumba el batch entero)',
    /hasOnly\(\['estado','contabilizadoEn','contabilizadoPor','semanaDestino','mesDestino','anclaDestino'\]\)/.test(reglas));

// ═══ 8 · Arranque, panel y registro de archivos ════════════════════════════
chk('El ancla se pide al arrancar (no solo al abrir Inicio)', /existenciaCargarInicial\(function\(\)[\s\S]{0,200}existenciaRepintarSeguro/.test(arranque));
chk('El repintado al llegar el ancla no interrumpe un modal ni una captura',
    /function existenciaRepintarSeguro[\s\S]{0,500}activeTab !== 'inicio' && activeTab !== 'productos'[\s\S]{0,300}modal-open/.test(exis));
chk('Si las reglas nuevas no están desplegadas, se sigue con el inicial semanal (no revienta)',
    /collection\('anclasExistencia'\)[\s\S]{0,450}\.catch\(function\(e\)/.test(exis));
chk('El panel explica el origen del Total y los días de ventas que faltan',
    /Origen del Total/.test(panel) && /Faltan ' \+ r\.diasFaltantes\.length \+ ' día\(s\) de ventas/.test(panel));
chk('La ficha del producto muestra el desglose desde el ancla',
    /Desde el último corte/.test(panel) && /Consumo teórico \(ventas × receta\)/.test(panel));
chk('index.html carga 46-arrastre antes de 47 y 94-venta-turno después de 93',
    html.indexOf('js/46-arrastre.js') > 0 && html.indexOf('js/46-arrastre.js') < html.indexOf('js/47-existencia.js') &&
    html.indexOf('js/94-venta-turno.js') > html.indexOf('js/93-ventas.js'));
chk('sw.js precalienta los dos archivos nuevos',
    /'\.\/js\/46-arrastre\.js\?v=' \+ APP_VERSION/.test(sw) && /'\.\/js\/94-venta-turno\.js\?v=' \+ APP_VERSION/.test(sw));
const vHtml = (html.match(/\?v=(\d+\.\d+)/) || [])[1];
const vSw = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vHtml && vHtml === vSw, 'index=' + vHtml + ' sw=' + vSw);
chk('La versión avanzó (>= 5.16)', Number((vSw || '').split('.')[1]) >= 16, 'es ' + vSw);

const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── FASE 14 · Ancla del Total y venta del turno (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
