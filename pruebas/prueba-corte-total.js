#!/usr/bin/env node
/**
 * prueba-corte-total.js — v5.21 · Corte de existencias con el reporte de SBO
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedido de Eduardo (9-oct-2026): subir al Corte de existencias el archivo
 * "existencias_SBO_*.csv", cuya columna "En Stock" es la cantidad TOTAL (sin
 * unidades cerradas ni fracción abierta).
 *   · Cabeceras reales del archivo: Código, Artículo, Grupo, Almacén (12),
 *     Nombre Almacén, En Stock, Comprometido, Pedido, Disponible.
 *   · Valores con punto sin cero (".790000"): SheetJS los entrega como número.
 *   node pruebas/prueba-corte-total.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const casos = []; let fallos = 0;
function chk(n, ok, d) { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; }

const imp = leer('js/96-importar.js'), html = leer('index.html'), sw = leer('sw.js'), css = leer('css/estilos.css');
const ctx = { window: {}, console: { warn() {}, info() {}, log() {}, error() {} }, products: [],
              document: { getElementById: () => null, addEventListener() {} }, AREAS_CONTEO: [], areas: {} };
let A;
try {
    A = new Function('ctx', 'with (ctx) {' + imp + '\nreturn { importarValidarExistencias, importarArmarCorte, importarPlantilla, COLUMNAS_EXISTENCIAS, IMPORTAR_SECCIONES };}')(ctx);
    chk('js/96-importar.js real se ejecuta', true);
} catch (e) { chk('js/96-importar.js real se ejecuta', false, String(e && e.stack || e)); }

if (A) {
    const areasDef = [{ id: 'almacen', nombre: 'Almacén' }, { id: 'barra1', nombre: 'Barra Restaurante' }];
    const prods = [
        { id: '1000006', name: 'ACEITUNA SIN HUESO 3.85 KG LOSADA', unit: 'PZA', precio: 100 },
        { id: '1200111', name: 'WHISKY ABASOLO 750 ML', unit: 'PZA', precio: 500 },
        { id: '1200136', name: 'WHISKY ANGELS ENVY 750 ML', unit: 'PZA', precio: 1000 },
        { id: '1180015', name: 'DON JULIO 70 700 ML', unit: 'PZA', precio: 700 },   // NO viene en el reporte
        { id: '1020064', name: 'LIMON', unit: 'KGS' }];                               // NO viene en el reporte
    const exist = { '1000006': { valor: 4, origen: 'oficial' }, '1200111': { valor: 1, origen: 'oficial' }, '1200136': { valor: 2, origen: 'oficial' },
                    '1180015': { valor: 3, origen: 'oficial' }, '1020064': { valor: 5, origen: 'operativo_no_reconciliado' } };
    const ex = p => exist[p.id];
    // Filas tal como las entrega SheetJS al leer el CSV de SBO (números, cabeceras con acento y BOM ya quitado).
    const sbo = (cod, nom, alm, st) => ({ 'Código': cod, 'Artículo': nom, Grupo: '3 WHISKY', 'Almacén': alm, 'Nombre Almacén': 'BARRA MOCHOMOS MONTERREY',
                                          'En Stock': st, Comprometido: 0, Pedido: 0, Disponible: st });
    const archivo = [sbo(1000006, 'ACEITUNA SIN HUESO 3.85 KG LOSADA', 12, 3.97), sbo(1200111, 'WHISKY ABASOLO 750 ML', 12, 0.79),
                     sbo(1200136, 'WHISKY ANGELS ENVY 750 ML', 12, 2), sbo(1200100, 'WHISKY 18 SHERRY OAK 700 ML MACALLAN', 12, 1)];

    // ═══ 1 · El archivo de SBO se acepta tal cual ═══════════════════════════
    const v = A.importarValidarExistencias(archivo, prods, areasDef, ex);
    chk('★ Detecta el modo "total" por la columna "En Stock" (sin Enteras ni Abierta)', v.modo === 'total', v.modo);
    chk('★ Sin errores: no exige "Enteras" y "Almacén=12" NO se confunde con un área', v.errores.length === 0, v.errores.join(' | '));
    chk('★ "En Stock" es el TOTAL del producto (3.97, 0.79 y 2), tal cual, sin sumar nada más',
        v.saldos['1000006'] === 3.97 && v.saldos['1200111'] === 0.79 && v.saldos['1200136'] === 2, JSON.stringify(v.saldos));
    chk('El total va al saldo del producto, sin desglose por área (el reporte no trae áreas)', Object.keys(v.porArea).length === 0);
    chk('★ Un código que no está en el catálogo se OMITE con aviso (no bloquea) y se nombra',
        v.contados === 3 && v.ajenos.length === 1 && v.ajenos[0].codigo === '1200100' && v.avisos.some(a => /no están en tu catálogo/.test(a) && /1200100 WHISKY 18 SHERRY OAK/.test(a)), JSON.stringify(v.avisos));
    chk('Informa la cobertura (3 de 5 productos del catálogo)', v.cobertura && v.cobertura.archivo === 3 && v.cobertura.catalogo === 5, JSON.stringify(v.cobertura));
    const aba = v.comparacion.find(c => c.id === '1200111');
    chk('Compara contra el Total de hoy (0.79 − 1 = −0.21 × $500 = −$105)', aba && aba.dif === -0.21 && aba.dinero === -105, JSON.stringify(aba));

    // ═══ 2 · Lo que el reporte no lista ═════════════════════════════════════
    chk('★ Por defecto los productos que NO vienen conservan su Total SOLO si es oficial (Don Julio 3 sí; limón en respaldo no)',
        v.faltantes === 'conservar' && v.noVienen.length === 2 && v.arrastrables['1180015'] === 3 && !('1020064' in v.arrastrables) && v.enCero.length === 0,
        JSON.stringify([v.noVienen, v.arrastrables]));
    const v0 = A.importarValidarExistencias(archivo, prods, areasDef, ex, { faltantes: 'cero' });
    chk('★ Con "Ponerlos en 0": los que no vienen se registran en 0 (Don Julio y limón)', v0.faltantes === 'cero' && v0.saldos['1180015'] === 0 && v0.saldos['1020064'] === 0 && v0.enCero.length === 2, JSON.stringify(v0.saldos));
    chk('…y ya no quedan "sin capturar" ni se arrastran', v0.noVienen.length === 0 && Object.keys(v0.arrastrables).length === 0);
    chk('…"contados" sigue siendo lo que el archivo trae (3), no los que se pusieron en 0', v0.contados === 3);
    const dj = v0.comparacion.find(c => c.id === '1180015');
    chk('La baja a 0 aparece en la comparación (−3 × $700 = −$2,100) para decidir con datos', dj && dj.dif === -3 && dj.dinero === -2100, JSON.stringify(dj));
    chk('Avisa cuántos pasan a 0 y cuántos tenían existencia', v0.avisos.some(a => /2 producto\(s\) del catálogo no vienen en el archivo y se registran en 0 \(2 tenían Total mayor a 0\)/.test(a)), JSON.stringify(v0.avisos));
    const vSolo = A.importarValidarExistencias([sbo(9999999, 'NO EXISTE', 12, 1)], prods, areasDef, ex, { faltantes: 'cero' });
    chk('★ Si NINGÚN código coincide con el catálogo no se pone todo en 0: error claro y nada que registrar',
        vSolo.errores.some(e => /Ningún código del archivo coincide/.test(e)) && vSolo.enCero.length === 0, JSON.stringify(vSolo.errores));

    // ═══ 3 · Almacén ════════════════════════════════════════════════════════
    const vAlm = A.importarValidarExistencias(archivo.concat([sbo(1180015, 'DON JULIO 70 700 ML', 13, 9)]), prods, areasDef, ex);
    chk('★ Una fila de otro almacén (13) se omite con aviso: no suma al Total de la barra',
        !('1180015' in vAlm.saldos) && vAlm.otroAlmacen === 1 && vAlm.avisos.some(a => /almacén distinto del 12/.test(a)), JSON.stringify(vAlm.avisos));
    const sinAlm = archivo.map(f => { const o = Object.assign({}, f); delete o['Almacén']; delete o['Nombre Almacén']; return o; });
    chk('Sin columna de almacén también funciona (todas las filas cuentan)', A.importarValidarExistencias(sinAlm, prods, areasDef, ex).contados === 3);

    // ═══ 4 · Errores que sí bloquean ════════════════════════════════════════
    const vm = A.importarValidarExistencias([sbo(1000006, 'X', 12, 'tres'), sbo(1200111, 'Y', 12, -1), sbo(1200136, 'Z', 12, 1), sbo(1200136, 'Z', 12, 2)], prods, areasDef, ex);
    chk('★ "En Stock" no numérico, negativo y código repetido SÍ bloquean (nombran la columna)',
        vm.errores.some(e => /En Stock no es un número/.test(e)) && vm.errores.some(e => /En Stock negativo/.test(e)) && vm.errores.some(e => /duplicado/.test(e)), vm.errores.join(' | '));
    chk('★ Un cero escrito es un conteo válido (0 ≠ vacío)', A.importarValidarExistencias([sbo(1000006, 'X', 12, 0)], prods, areasDef, ex).saldos['1000006'] === 0);
    chk('Una fila con "En Stock" vacío no cuenta (no se inventa un 0)', A.importarValidarExistencias([sbo(1000006, 'X', 12, ''), sbo(1200111, 'Y', 12, 1)], prods, areasDef, ex).vacias === 1);
    chk('Coma decimal en texto ("0,79") también se entiende', A.importarValidarExistencias([sbo(1200111, 'Y', 12, '0,79')], prods, areasDef, ex).saldos['1200111'] === 0.79);
    const dosForma = A.importarValidarExistencias([{ 'Código': '1000006', 'En Stock': 3, Enteras: 3 }], prods, areasDef, ex);
    chk('★ "En Stock" junto con "Enteras" bloquea (se sumaría dos veces)', dosForma.errores.some(e => /una sola forma/.test(e)), dosForma.errores.join(' | '));
    chk('Sin "Enteras" ni "En Stock": el error nombra las dos opciones', A.importarValidarExistencias([{ 'Código': '1' }], prods, areasDef).errores.some(e => /"Enteras"/.test(e) && /"En Stock"/.test(e)));

    // ═══ 5 · La plantilla de siempre NO cambia ══════════════════════════════
    const vp = A.importarValidarExistencias([{ 'Código': '9999', Enteras: 1 }, { 'Código': '1000006', Enteras: 1, Abierta: 0.5 }], prods, areasDef, ex);
    chk('★ En la plantilla (Enteras/Abierta) un código fuera del catálogo SIGUE siendo error', vp.modo === 'enteras_abierta' && vp.errores.some(e => /no está en el catálogo/.test(e)), vp.errores.join(' | '));
    chk('★ …y "Almacén" sigue siendo un área en la plantilla', A.importarValidarExistencias([{ 'Código': '1000006', 'Almacén': '12', Enteras: 1 }], prods, areasDef, ex).errores.some(e => /el área "12" no existe/.test(e)));
    chk('La opción "faltantes" no afecta a la plantilla', A.importarValidarExistencias([{ 'Código': '1000006', Enteras: 1 }], prods, areasDef, ex, { faltantes: 'cero' }).enCero.length === 0);
    const pl = A.importarPlantilla('existencias', prods, areasDef);
    chk('La plantilla del corte avisa que también se puede subir el reporte de SBO', pl.instrucciones.some(i => /SBO/.test(i) && /En Stock/.test(i) && /almacén 12/.test(i)));
    chk('La descripción de la sección lo menciona', /SBO/.test(A.IMPORTAR_SECCIONES.find(s => s.id === 'existencias').desc));

    // ═══ 6 · El documento del corte ═════════════════════════════════════════
    const c0 = A.importarArmarCorte(v0, { fecha: '2026-10-08', hora: '22:00', archivo: 'existencias_SBO.csv', uid: 'u1', productos: prods, existenciaDe: ex });
    chk('★ El corte queda en anclasExistencia/2026-10-08_2200 con tipo importacion_excel y saldos incluidos los 0',
        c0.id === '2026-10-08_2200' && c0.doc.tipo === 'importacion_excel' && c0.doc.saldos['1180015'] === 0 && c0.doc.saldos['1000006'] === 3.97, JSON.stringify(c0.doc.saldos));
    chk('Deja constancia: modoArchivo "total", faltantes "cero" y cuántos quedaron en 0', c0.doc.modoArchivo === 'total' && c0.doc.faltantes === 'cero' && c0.doc.productosEnCero === 2);
    chk('El Total anterior de cada producto queda en "previo" (histórico)', c0.doc.previo['1180015'] && c0.doc.previo['1180015'].valor === 3);
    const c1 = A.importarArmarCorte(v, { fecha: '2026-10-08', hora: '22:00', archivo: 'x.csv', productos: prods, existenciaDe: ex });
    chk('Con "Conservar": los arrastrados llevan su Total y no se inventan ceros', c1.doc.saldos['1180015'] === 3 && !('1020064' in c1.doc.saldos) && c1.doc.productosArrastrados.join() === '1180015' && c1.doc.productosEnCero === 0, JSON.stringify(c1.doc.saldos));
    chk('Los campos nuevos del documento no requieren cambiar firestore.rules (no hay lista cerrada de campos en anclasExistencia)',
        !/anclasExistencia\/\{fecha\}[\s\S]{0,400}hasOnly/.test(leer('firestore.rules')));
}

// ═══ 7 · Interfaz y versión ═════════════════════════════════════════════════
chk('★ La vista previa ofrece "Conservar su Total actual" / "Ponerlos en 0" (radiogroup) y se conecta a importarCambiarFaltantes',
    /role="radiogroup"/.test(imp) && /Conservar su Total actual/.test(imp) && /Ponerlos en 0/.test(imp) && /onchange="importarCambiarFaltantes\(this\.value\)"/.test(imp) && /window\.importarCambiarFaltantes\s*=/.test(imp));
chk('★ Al registrar, el corte se re-valida con la opción elegida', /importarValidarExistencias\(p\.filas, products, _impAreasDef\(\), _impExistenciaDe, \{ faltantes: p\.faltantes \}\)/.test(imp));
chk('La confirmación dice cuántos quedan en 0 y que viene de SBO', /quedan en 0/.test(imp) && /Archivo de SBO/.test(imp));
chk('Las opciones miden ≥ 44 px y usan tokens (sin hex a mano)', /\.imp-opcion \{[^}]*min-height: 44px/.test(css) && !/\.imp-opcion[^{]*\{[^}]*#[0-9a-fA-F]{3,6}/.test(css));
const vH = (html.match(/\?v=([\d.]+)/) || [])[1], vS = (sw.match(/APP_VERSION = '([\d.]+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vH && vH === vS, vH + ' / ' + vS);
chk('La versión avanzó (>= 5.21)', vS && Number(vS.split('.')[0]) >= 5 && Number(vS.split('.')[1]) >= 21, vS);

console.log('\n  ── v5.21 · Corte de existencias con el reporte de SBO (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(104) + (c.ok ? '' : '  ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron');
process.exit(fallos ? 1 : 0);
