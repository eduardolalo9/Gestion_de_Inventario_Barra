#!/usr/bin/env node
/**
 * prueba-fase16.js — v5.19 · Total publicado para el equipo, cortesías y
 * promos 2x1, papelera de servidor · estática, con el código REAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Decisiones de Eduardo (6-oct-2026) que esta prueba protege:
 *   · Los bartenders ven el MISMO Total que administración: solo cantidades,
 *     sin importes (documento totalPublicado/actual).
 *   · Cada unidad "promo 2x1" a $0 es UNA copa: se suma (como ya se hacía) y
 *     se separa para verla. Las cortesías descuentan stock (D-5) y se
 *     muestran aparte con su costo a precio de insumo.
 *   · Papelera de servidor antes de cualquier borrado (FASE B, 26-sep).
 *   node pruebas/prueba-fase16.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r/g, '');
const casos = []; let fallos = 0;
function chk(n, ok, d) { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; }
function extraer(fuente, nombre) {
    const i = fuente.indexOf('function ' + nombre + '(');
    if (i === -1) throw new Error('No se encontró ' + nombre);
    let nivel = 0, dentro = false;
    for (let j = i; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(i, j + 1); }
    }
    throw new Error('No se pudo delimitar ' + nombre);
}

const ciclo = leer('js/15-ciclo-semanal.js'), arr = leer('js/46-arrastre.js'), cons = leer('js/48-consumo-teorico.js'),
      exis = leer('js/47-existencia.js'), tp = leer('js/51-total-publicado.js'), pap = leer('js/53-papelera.js'),
      ventasJs = leer('js/93-ventas.js'), turno = leer('js/94-venta-turno.js'), compras = leer('js/88-compras.js'),
      datos45 = leer('js/45-inventario-datos.js'), roles = leer('js/50-roles-permisos.js'), ui85 = leer('js/85-ui-inventario-fisico.js'),
      flujo = leer('js/75-auditoria-flujo.js'), panel = leer('js/83-panel.js'), render = leer('js/70-conversion-render.js'),
      reglas = leer('firestore.rules'), html = leer('index.html'), sw = leer('sw.js');

// ═══ 1 · Total publicado: el motor real (15 + 46 + 48 + 47 + 51) ═══════════
function montar(permisos) {
    const ctx = {
        window: {}, console: { warn() {}, info() {}, log() {}, error() {} },
        products: [], recetas: [], movimientos: [], ventas: [], ventasSemanaId: null,
        getTotalStock: p => (p && p.operativa) || 0, _db: null, FIRESTORE_DOC_ID: 'x', currentUserUid: 'u1',
        _authzState: { loaded: true },
        hasPermission: p => permisos === '*' || permisos.indexOf(p) !== -1
    };
    const A = new Function('ctx', 'with (ctx) {' + ciclo + '\n' + arr + '\n' + cons + '\n' + exis + '\n' + tp + `
        return { oficial: existenciaOficial, resumen: existenciaArrastreResumen, preparar: totalPublicadoPreparar,
                 armar: totalPublicadoArmar, valor: totalPublicadoValor, vigente: totalPublicadoVigente,
                 debeUsar: totalPublicadoDebeUsar, puede: totalPublicadoPuedePublicar, enUso: totalPublicadoEnUso,
                 setInicial: function(x) { _existenciaInicial = x; },
                 setArrastre: function(x) { _existenciaArrastre = x; _existenciaArrastreMemo = { clave: null }; },
                 setPub: function(x) { _totalPublicado = x; }, fechaISOLocal: fechaISOLocal };
    }`)(ctx);
    return { A, ctx };
}
let M;
try { M = montar('*'); chk('Los archivos reales 15 + 46 + 48 + 47 + 51 se ejecutan juntos', true); }
catch (e) { chk('Los archivos reales 15 + 46 + 48 + 47 + 51 se ejecutan juntos', false, String(e && e.stack || e)); }

if (M) {
    const hoy = M.A.fechaISOLocal(new Date());
    const d = new Date(); d.setDate(d.getDate() - 3);
    const fCorte = M.A.fechaISOLocal(d);
    const ancla = { tipo: 'mitad_de_semana', fecha: fCorte, id: fCorte, ruta: 'arrastre', dias: 3 };
    const prods = [{ id: 'TEQ', name: 'TEQUILA', unit: 'PZA', precio: 350, operativa: 1 },
                   { id: 'LIM', name: 'LIMON', unit: 'KGS', precio: 38, operativa: 9 },
                   { id: 'NEW', name: 'NUEVO', unit: 'PZA', operativa: 4 }];
    const preparar = (m, nodisp) => {
        m.ctx.products = prods;
        m.ctx.recetas = [{ pv: 'PV1', ingredientes: [{ productoId: 'TEQ', cantidad: 0.06, uom: 'PZA' }] }];
        m.A.setInicial({ semana: 'x', estado: 'ok', saldos: { TEQ: 3, LIM: 2 }, origen: {}, ancla: ancla });
        const dPost = new Date(); dPost.setDate(dPost.getDate() - 1); const fPost = m.A.fechaISOLocal(dPost);
        // nodisp = lo que ve quien no pudo leer compras ni ventas: nada de eso en memoria
        m.A.setArrastre({ anclaFecha: fCorte, version: 7, comprasNoDisponibles: !!nodisp, ventasNoDisponibles: !!nodisp,
            compras: nodisp ? [] : [{ tipo: 'compra', productoId: 'TEQ', cantidad: 2, fecha: fPost, semanaId: 'x' }],
            periodos: nodisp ? [] : [{ id: fPost + '_' + fPost, inicio: fPost, fin: fPost, lineas: [{ sku: 'PV1', cantidad: 10 }] }] });
    };
    preparar(M);
    const r = M.A.oficial(prods[0]);
    chk('Administración calcula su Total como siempre (3 + 2 − 10×0.06 = 4.4)', r.valor === 4.4 && r.origen === 'oficial' && r.fuente !== 'publicado', JSON.stringify(r));
    chk('Administración puede publicar y NO usa el publicado', M.A.puede() && !M.A.debeUsar());
    const prep = M.A.preparar();
    chk('★ El documento lleva por producto [Total, saldo, entradas, consumo] solo de los productos con Total oficial',
        prep.doc && JSON.stringify(prep.doc.valores.TEQ) === JSON.stringify([4.4, 3, 2, 0.6]) && prep.doc.valores.LIM[0] === 2 && !('NEW' in prep.doc.valores),
        JSON.stringify(prep.doc && prep.doc.valores));
    const txt = JSON.stringify(prep.doc || {});
    chk('★ Sin dinero: el documento no trae precio, costo, importe ni venta neta', !/precio|costo|importe|ventaNeta|350|38\b/.test(txt), txt.slice(0, 200));
    chk('Lleva ancla, días esperados/faltantes y quién publicó', prep.doc.ancla.fecha === fCorte && Array.isArray(prep.doc.diasFaltantes) && prep.doc.publicadoPor === 'u1');
    chk('La huella es estable con los mismos datos', M.A.armar(prods, p => M.A.oficial(p), M.A.resumen(), ancla, 'u1').huella === prep.doc.huella);
    const otra = M.A.armar(prods, p => Object.assign({}, M.A.oficial(p), p.id === 'TEQ' ? { valor: 9 } : {}), M.A.resumen(), ancla, 'u1');
    chk('…y cambia si cambia un Total (solo se escribe si cambió)', otra.huella !== prep.doc.huella);
    const M2 = montar('*'); preparar(M2, true);
    const inc = M2.A.preparar();
    chk('★ Un Total incompleto (compras o ventas no leídas) NO se publica', !inc.doc && inc.motivo === 'incompleto', JSON.stringify(inc.motivo));
    M2.A.setInicial({ semana: 'x', estado: 'no_existe', saldos: null, origen: null, ancla: null });
    chk('Sin ancla vigente no se publica', M2.A.preparar().motivo === 'sin_ancla');

    // Bartender
    const B = montar(['inventory.count', 'catalog.read']); preparar(B, true);
    chk('El bartender (sin sales.read/purchases.read) debe usar el publicado y no publica', B.A.debeUsar() && !B.A.puede());
    const sinPub = B.A.oficial(prods[0]);
    chk('Sin publicado, el bartender cae a su cálculo local (como antes)', sinPub.fuente !== 'publicado' && sinPub.valor === 3, JSON.stringify(sinPub));
    B.A.setPub({ estado: 'ok', datos: Object.assign({}, prep.doc, { publicadoEn: { seconds: 1791200000 } }), unsub: null });
    const conPub = B.A.oficial(prods[0]);
    chk('★ Con publicado vigente, el bartender ve EL MISMO Total que administración (4.4)', conPub.valor === 4.4 && conPub.fuente === 'publicado' && conPub.entradas === 2 && conPub.ventas === 0.6, JSON.stringify(conPub));
    chk('Un producto fuera del publicado sigue con su respaldo operativo', B.A.oficial(prods[2]).valor === 4 && B.A.oficial(prods[2]).origen === 'operativo_no_reconciliado');
    const res = B.A.resumen();
    chk('El resumen de la tarjeta viene del publicado (sin avisos de "no se pudo leer")', res && res.publicado && !res.comprasNoDisponibles && !res.ventasNoDisponibles, JSON.stringify(res && Object.keys(res)));
    // Corte más nuevo en este teléfono → publicado viejo
    const dN = new Date(); dN.setDate(dN.getDate() - 1); const fN = B.A.fechaISOLocal(dN);
    B.A.setInicial({ semana: 'x', estado: 'ok', saldos: { TEQ: 7 }, origen: {}, ancla: { tipo: 'mitad_de_semana', fecha: fN, id: fN, ruta: 'arrastre' } });
    chk('★ Si el teléfono conoce un corte MÁS NUEVO que el publicado, el publicado no se usa', B.A.oficial(prods[0]).fuente !== 'publicado' && !B.A.enUso());
    B.A.setInicial({ semana: 'x', estado: 'error', saldos: null, origen: null, ancla: null });
    chk('Sin el corte confirmado en el teléfono (sin red), tampoco se usa', !B.A.enUso());
    chk('vigente(): mismo id sí; ancla publicada más nueva sí; más vieja no',
        B.A.vigente({ ancla: { fecha: '2026-10-01', id: 'a' }, valores: {} }, { fecha: '2026-10-01', id: 'a' })
        && B.A.vigente({ ancla: { fecha: '2026-10-03', id: 'b' }, valores: {} }, { fecha: '2026-10-01', id: 'a' })
        && !B.A.vigente({ ancla: { fecha: '2026-09-30', id: 'c' }, valores: {} }, { fecha: '2026-10-01', id: 'a' }));
    chk('valor(): null si el producto no viene', B.A.valor(prep.doc, { id: 'ZZZ' }) === null);
}

// Lecturas que ni se intentan sin permiso
{
    let consultas = [];
    const fakeDb = { collection: (c) => ({ doc: () => ({ collection: (c2) => ({ where: () => ({ get: async () => { consultas.push(c2); return { forEach() {} }; } }) }) }),
                                           where: () => ({ get: async () => { consultas.push(c); return { forEach() {} }; } }) }) };
    const ctx = { window: {}, console: { warn() {}, info() {}, log() {} }, products: [], recetas: [], movimientos: [], _db: fakeDb, FIRESTORE_DOC_ID: 'x',
                  getTotalStock: () => 0, _authzState: { loaded: true }, hasPermission: () => false };
    const E = new Function('ctx', 'with (ctx) {' + ciclo + '\n' + arr + '\n' + cons + '\n' + exis + '\nreturn { _existenciaCargarArrastre };}')(ctx);
    E._existenciaCargarArrastre({ fecha: '2026-09-20' }, '2026-10-05').then(() => {
        chk('★ Sin purchases.read / sales.read ya no se intenta leer compras ni ventas (batería y datos)', consultas.length === 0, consultas.join(','));
        terminar();
    });
}

// ═══ 2 · Cortesías y promos 2x1 (93 + 94 reales) ═════════════════════════
let V, T;
try {
    const helpers = extraer(compras, '_normCabCompras') + '\n' + extraer(compras, '_findColCompras') + '\n' + extraer(compras, '_numeroExcel');
    V = new Function('ctx', 'with (ctx) {' + helpers + '\n' + ciclo + '\n' + arr + '\n' + ventasJs +
        '\nreturn { _parsearExcelVentas, _ventasAgregarLineas, ventaClasificarFila, ventaPartesLinea };}')({ window: {}, console: { warn() {} }, escapeHtml: s => s });
    T = new Function('ctx', 'with (ctx) {' + turno + '\nreturn { ventaCortesiasAnalizar, ventaTurnoAnalizar };}')({ window: {}, ventaPartesLinea: V.ventaPartesLinea });
    chk('js/93 y js/94 reales se ejecutan (con los lectores de celdas reales de js/88)', true);
} catch (e) { chk('js/93 y js/94 reales se ejecutan (con los lectores de celdas reales de js/88)', false, String(e && e.stack || e)); }
if (V && T) {
    chk('Clasifica: $0 con "promo 2x1" → promo; $0 sin promo → cortesía; con precio → venta; sin Venta neta → venta (no se adivina)',
        V.ventaClasificarFila('Aperol Spritz promo 2x1', 0, 3) === 'promo' && V.ventaClasificarFila('Bebida Cortesia Septiembre', 0, 72) === 'cortesia'
        && V.ventaClasificarFila('DOBEL PROMO', 980, 4) === 'venta' && V.ventaClasificarFila('Algo', null, 1) === 'venta' && V.ventaClasificarFila('2X1 SPICY MANGO', 0, 2) === 'promo');
    const p = V._parsearExcelVentas([
        { Nombre: 'Aperol Spritz', SKU: 'PVB1000146', Cantidad: 9, 'Venta neta': 1881 },
        { Nombre: 'Aperol Spritz promo 2x1', SKU: 'PVB1000146', Cantidad: 3, 'Venta neta': 0 },
        { Nombre: 'Bebida Cortesia Septiembre', SKU: 'PVB1003580', Cantidad: 72, 'Venta neta': 0 },
        { Nombre: 'Dobel Promo', SKU: 'PVB1009999', Cantidad: 4, 'Venta neta': 980 }
    ]);
    const ap = p.lineas.find(l => l.sku === 'PVB1000146'), co = p.lineas.find(l => l.sku === 'PVB1003580'), dob = p.lineas.find(l => l.sku === 'PVB1009999');
    chk('★ 2x1: 9 cobradas + 3 de regalo = 12 copas (se SUMA, decisión de Eduardo) y se separan 3 de regalo', ap.cantidad === 12 && ap.promo === 3 && !ap.cortesia, JSON.stringify(ap));
    chk('★ Cortesía: 72 unidades marcadas como cortesía (siguen descontando stock)', co.cantidad === 72 && co.cortesia === 72, JSON.stringify(co));
    chk('Una promo con PV propio y precio (Dobel Promo $980) es venta normal', !dob.promo && !dob.cortesia && dob.cantidad === 4);
    chk('El resumen del archivo cuenta cortesías y copas de regalo', p.unidadesCortesia === 72 && p.unidadesPromo === 3);
    const agr = V._ventasAgregarLineas([p.lineas, [{ sku: 'PVB1003580', nombre: 'Bebida Cortesia', cantidad: 8, ventaNeta: 0, cortesia: 8 }]]);
    chk('Al sumar periodos de la semana se suman también cortesías y promos', agr.find(l => l.sku === 'PVB1003580').cortesia === 80 && agr.find(l => l.sku === 'PVB1000146').promo === 3);
    chk('Línea vieja (sin desglose) a $0: se clasifica por su nombre; si mezcla venta y regalo, no se inventa',
        V.ventaPartesLinea({ nombre: 'Bebida Cortesia', cantidad: 5, ventaNeta: 0 }).cortesia === 5
        && V.ventaPartesLinea({ nombre: 'Aperol Spritz', cantidad: 12, ventaNeta: 1881 }).promo === 0);
    const sinCampos = V._parsearExcelVentas([{ Nombre: 'Margarita', SKU: 'PV1', Cantidad: 2, 'Venta neta': 300 }]).lineas[0];
    chk('Una línea normal se guarda igual que antes (sin campos nuevos)', !('cortesia' in sinCampos) && !('promo' in sinCampos), JSON.stringify(sinCampos));

    const productos = [{ id: 'T1', name: 'TEQUILA', unit: 'PZA', precio: 300 }, { id: 'L1', name: 'LIMON', unit: 'KGS', precio: 40 }, { id: 'S1', name: 'SAL', unit: 'KGS' }];
    const recetas = { PV1: [['T1', 0.06], ['L1', 0.02]], PVC: [['T1', 0.03], ['S1', 0.001]] };
    const consumir = (lineas) => { const c = {}; lineas.forEach(l => (recetas[l.sku] || []).forEach(i => { c[i[0]] = (c[i[0]] || 0) + l.cantidad * i[1]; })); return { consumo: c }; };
    const cz = T.ventaCortesiasAnalizar([{ sku: 'PV1', nombre: 'Margarita', cantidad: 12, ventaNeta: 900, promo: 3 },
                                         { sku: 'PVC', nombre: 'Cortesia', cantidad: 5, ventaNeta: 0, cortesia: 5 }], { productos, consumir });
    chk('★ Costo de cortesías a precio de insumo: 5 × 0.03 × $300 = $45 (la sal sin precio va aparte)', cz.cortesias.costo === 45 && cz.cortesias.sinPrecio === 1, JSON.stringify(cz.cortesias));
    chk('★ Costo de las copas de regalo 2x1: 3 × (0.06×300 + 0.02×40) = $56.40', cz.promos.costo === 56.4 && cz.promos.unidades === 3, JSON.stringify(cz.promos));
    chk('Total de regalos $101.40 y la promo recuerda las 12 copas totales del SKU', cz.costoTotal === 101.4 && cz.promos.items[0].totalSku === 12);
    const sim = T.ventaTurnoAnalizar([{ sku: 'PVC', nombre: 'Cortesia', cantidad: 5, ventaNeta: 0, cortesia: 5 }],
        { periodo: { inicio: '2026-10-05', fin: '2026-10-05' }, anclaFecha: '2026-10-01', productos, consumir, existencia: () => ({ valor: 10, origen: 'oficial' }) });
    chk('La simulación trae el bloque de cortesías y el consumo NO cambia (la cortesía sigue descontando)',
        sim.cortesias && sim.cortesias.cortesias.unidades === 5 && sim.insumos.find(x => x.productoId === 'T1').consumo === 0.15, JSON.stringify(sim.insumos));
    chk('Sin regalos no hay bloque (hay: false)', !T.ventaCortesiasAnalizar([{ sku: 'PV1', cantidad: 2, ventaNeta: 100 }], { productos, consumir }).hay);
}

// ═══ 3 · Papelera (53 real) ═══════════════════════════════════════════════
let P;
try {
    P = new Function('ctx', 'with (ctx) {' + pap + `
      return { papeleraTrozos, papeleraContarConteo, papeleraRegistrosConteo, papeleraRegistrosProductos, papeleraRegistroReporte,
               papeleraFusionConteos, papeleraAgrupar, papeleraVencidos, PAPELERA_MAX_BYTES, PAPELERA_DIAS_PURGA_MS };
    }`)({ window: {}, console: { warn() {}, error() {} } });
    chk('js/53-papelera.js real se ejecuta', true);
} catch (e) { chk('js/53-papelera.js real se ejecuta', false, String(e && e.stack || e)); }
if (P) {
    const ua = { uid: 'b1', email: 'bar@x.com', sessionId: '1001', status: { almacen: 'pendiente' }, conteo: { T1: { almacen: { enteras: 2, abiertas: [] }, barra1: { enteras: 1 } }, L1: { almacen: { enteras: 3 } } } };
    const rc = P.papeleraRegistrosConteo('b1', ua, { ts: 1791200000000, uidActor: 'admin', sessionNueva: '1002' });
    chk('★ Conteos: un registro con el documento ÍNTEGRO, quién lo borró y la sesión nueva', rc.length === 1 && rc[0].id === 'conteos_b1_1791200000000'
        && JSON.stringify(rc[0].data.contenido) === JSON.stringify(ua) && rc[0].data.borradoPor === 'admin' && rc[0].data.sessionNueva === '1002' && rc[0].data.origen === 'conteos',
        JSON.stringify(rc[0] && rc[0].data.resumen));
    chk('Resumen: 2 productos, 3 capturas', rc[0].data.resumen.productos === 2 && rc[0].data.resumen.entradas === 3);
    chk('Sin conteo no hay nada que perder: no se escribe registro', P.papeleraRegistrosConteo('b2', { uid: 'b2', conteo: {} }, {}).length === 0
        && P.papeleraRegistrosConteo('b3', { uid: 'b3' }, {}).length === 0);
    const grande = { uid: 'b9', conteo: {} };
    for (let i = 0; i < 9000; i++) grande.conteo['P' + i] = { almacen: { enteras: i, abiertas: [0.25, 0.5], _ts: 1791200000000 + i, nota: 'x'.repeat(40) } };
    const rg = P.papeleraRegistrosConteo('b9', grande, { ts: 1 });
    const juntos = {}; rg.forEach(r => Object.assign(juntos, r.data.contenido.conteo));
    chk('★ Un conteo que no cabe en un documento se reparte en partes del mismo grupo, sin perder nada',
        rg.length > 1 && rg.every(r => JSON.stringify(r.data).length < 1000000 && r.data.grupo === 'conteos_b9_1' && r.data.partes === rg.length)
        && Object.keys(juntos).length === 9000, rg.length + ' partes');
    const prods = []; for (let i = 0; i < 7000; i++) prods.push({ id: String(1000000 + i), name: 'PRODUCTO ' + i, unit: 'PZA', group: 'G', stockByArea: { almacen: i }, precio: i, pesoBotellaLlenaOz: 40.5, capacidadMl: 750 });
    const rp = P.papeleraRegistrosProductos(prods, 'catalogo', { ts: 5, uidActor: 'admin' });
    chk('★ Catálogo de 7,000 productos: partes < 1 MiB, mismo grupo, y suman los 7,000', rp.length > 1 && rp.every(r => JSON.stringify(r.data).length < 1000000)
        && rp.reduce((a, r) => a + r.data.contenido.productos.length, 0) === 7000 && rp.every(r => r.data.grupo === 'catalogo_5'), rp.length + ' partes');
    const r1 = P.papeleraRegistrosProductos([prods[0]], 'producto', { ts: 6 });
    chk('Un producto suelto: un registro con el objeto completo (incluye stockByArea)', r1.length === 1 && r1[0].data.contenido.productos[0].stockByArea.almacen === 0 && r1[0].id === 'producto_6');
    const rr = P.papeleraRegistroReporte('rep1', { titulo: 'Cierre', fechaTs: 9, conteo: { a: 1 } }, { ts: 7, uidActor: 'admin' });
    chk('Reporte: registro con el reporte íntegro y su id original', rr.id === 'reporte_rep1_7' && rr.data.reporteId === 'rep1' && rr.data.contenido.conteo.a === 1);
    const f = P.papeleraFusionConteos({ T1: { almacen: { enteras: 2 }, barra1: { enteras: 1 } }, L1: { almacen: { enteras: 3 } } },
                                      { T1: { almacen: { enteras: 9 } } });
    chk('★ Restaurar conteos NUNCA pisa lo ya contado en el inventario abierto (T1/almacén se queda en 9)',
        f.agregadas === 2 && f.omitidas === 1 && !f.agregar.T1.almacen && f.agregar.T1.barra1.enteras === 1 && f.agregar.L1.almacen.enteras === 3, JSON.stringify(f));
    const g = P.papeleraAgrupar([{ id: 'a_p1', grupo: 'a', parte: 1, partes: 2, origen: 'catalogo', borradoEn: 5 }, { id: 'b', grupo: 'b', parte: 1, partes: 1, origen: 'reporte', borradoEn: 9, restauradoEn: 10 },
                                 { id: 'a_p2', grupo: 'a', parte: 2, partes: 2, origen: 'catalogo', borradoEn: 5 }]);
    chk('Agrupa las partes de un mismo borrado y marca completo / restaurado', g.length === 2 && g[0].grupo === 'b' && g[0].restaurado && g[1].partes.length === 2 && g[1].completo && !g[1].restaurado);
    chk('Un grupo con partes faltantes queda incompleto (no se restaura a medias)', !P.papeleraAgrupar([{ id: 'a_p1', grupo: 'a', parte: 1, partes: 2, origen: 'catalogo' }])[0].completo);
    const ahora = 1791200000000;
    chk('Vaciar: solo lo de más de 30 días', P.papeleraVencidos([{ borradoEn: ahora - 31 * 86400000 }, { borradoEn: ahora - 29 * 86400000 }], ahora).length === 1);
}

// ═══ 4 · Integración con la app ═══════════════════════════════════════════
chk('★ Crear inventario: la papelera de conteos va en el MISMO batch, ANTES del borrado',
    /papeleraAgregarConteosABatch\(batch, docsPapelera, sessionId\);\s*\n\s*\}\s*\n\s*snap\.forEach\(doc => \{\s*\n\s*if \(doc\.id !== currentUserUid\) batch\.delete\(doc\.ref\);/.test(datos45));
chk('…y el commit sigue siendo uno solo (todo o nada)', (datos45.match(/await batch\.commit\(\); \/\/ atómico/g) || []).length === 1);
chk('Si el servidor rechaza la papelera, el aviso lo dice y aclara que no se borró nada', /papelera\?\)\. No se borró nada/.test(flujo));
chk('★ Eliminar reporte: copia en papelera y borrado en el MISMO batch', /papeleraRegistroReporte\(reporteId[\s\S]{0,300}batch\.set\([\s\S]{0,200}batch\.delete\(repRef\);\s*\n\s*await batch\.commit\(\);/.test(roles));
chk('Ya no queda un .delete() directo de reportes', !/collection\('reportes'\)\.doc\(reporteId\)\.delete\(\)/.test(roles));
chk('★ Eliminar producto / catálogo: primero la papelera del servidor, luego el borrado local',
    /papeleraProtegerProductos\(\[product\], 'producto', _aplicarBorrado\)/.test(ui85) && /papeleraProtegerProductos\(products\.slice\(\), 'catalogo', _aplicarVaciado\)/.test(ui85));
chk('Sin conexión no se borra un producto (se pide señal)', /navigator\.onLine === false\)[\s\S]{0,200}Inténtalo con señal/.test(pap));
chk('Si la copia falla, no se ejecuta el borrado', /catch \(e\) \{[\s\S]{0,600}return false;\s*\n\s*\}\s*\n\s*alContinuar\(\);/.test(pap));
chk('Restaurar productos quita la lápida de este teléfono y publica el catálogo', /_deletedProductIds\.splice/.test(pap) && /publicarCatalogoFirestore\(\)/.test(pap));
chk('Restaurar conteos: transacción y solo a un inventario abierto', /runTransaction/.test(pap) && /ya está cerrado: los conteos solo se devuelven a un inventario abierto/.test(pap));

chk('★ Regla: totalPublicado — escribe quien lee ventas y compras, campos cerrados, hora del servidor',
    /match \/totalPublicado\/\{docName\}[\s\S]{0,200}allow read:\s+if _cuentaActiva\(\);[\s\S]{0,200}hasPerm\('sales\.read'\) && hasPerm\('purchases\.read'\)[\s\S]{0,400}keys\(\)\.hasOnly\([\s\S]{0,700}publicadoEn == request\.time[\s\S]{0,300}allow delete: if false;/.test(reglas));
chk('★ Regla: papelera — lee admin, no se edita (solo restaurado), se vacía solo con más de 30 días',
    /match \/papelera\/\{registroId\}[\s\S]{0,80}allow read:\s+if isAdminUser\(\);[\s\S]{0,1200}affectedKeys\(\)\.hasOnly\(\['restauradoEn', 'restauradoPor'\]\)[\s\S]{0,300}borradoEn < request\.time\.toMillis\(\) - 2592000000/.test(reglas));
chk('Regla papelera: borradoEn a ±10 min del servidor y origen con su permiso', /borradoEn > request\.time\.toMillis\(\) - 600000/.test(reglas) && /origen in \['producto', 'catalogo'\] && hasPerm\('catalog\.edit'\)/.test(reglas));

chk('js/47 consulta el publicado (producto y resumen) y avisa al publicador al cambiar el Total',
    /_totalPublicadoParaProducto\(product\)/.test(exis) && /_totalPublicadoResumen\(\)/.test(exis) && /totalPublicadoAlCambiarExistencia\(\)/.test(exis));
chk('renderTab pide publicar si cambió (con espera)', /totalPublicadoQuizasPublicar\(false\)/.test(render));
chk('La tarjeta "Origen del Total" dice cuándo el Total viene publicado por administración', /publicado por administración/.test(panel) && /_panelHace/.test(panel));
chk('Pestaña y menú "Papelera" (solo administración)', /case 'papelera':/.test(render) && /id="sbPapeleraBtn"[^>]*data-sb-tab="papelera"[^>]*style="display:none"/.test(html) && /sbPapeleraBtn[\s\S]{0,100}isAdmin\(\)/.test(roles));
chk('index.html carga 51 y 53 tras 50', /50-roles-permisos\.js\?v=[\d.]+"><\/script>\s*<script src="js\/51-total-publicado\.js\?v=[\d.]+"><\/script><!-- v5\.19 -->\s*<script src="js\/53-papelera\.js/.test(html));
chk('sw.js precalienta 51 y 53', /51-total-publicado\.js/.test(sw) && /53-papelera\.js/.test(sw));
const vH = (html.match(/\?v=([\d.]+)/) || [])[1], vS = (sw.match(/APP_VERSION = '([\d.]+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vH && vH === vS, vH + ' / ' + vS);
chk('La versión avanzó (>= 5.19)', vS && Number(vS.split('.')[1]) >= 19 && Number(vS.split('.')[0]) >= 5, vS);

let pendientes = 1;
function terminar() {
    if (--pendientes > 0) return;
    console.log('\n  ── v5.19 · Total publicado, cortesías/2x1 y papelera (estática) ──\n');
    casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(110) + (c.ok ? '' : '  ← ' + c.d)));
    console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron');
    process.exit(fallos ? 1 : 0);
}
