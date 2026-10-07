#!/usr/bin/env node
/**
 * prueba-importar.js — v5.18 · Módulo "Importar desde Excel", corte de
 * existencias y detalle de compras por proveedor · estática (código REAL)
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedidos de Eduardo (6-oct-2026):
 *   · Compras: tocar la tarjeta de un proveedor muestra los productos.
 *   · Módulo de importación masiva: plantillas .xlsx/.csv, validación previa
 *     (duplicados, categorías vacías, números erróneos) y carga atómica.
 *   · TODAS las importaciones viven en el módulo (se quitaron de las pestañas).
 *   · Corte de existencias desde Excel (enteras + fracción decimal) con fecha
 *     y hora, que vale al cierre del día y recalcula el Total.
 *   node pruebas/prueba-importar.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const casos = []; let fallos = 0;
function chk(n, ok, d) { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; }

const imp = leer('js/96-importar.js'), det = leer('js/89-compras-detalle.js'), ciclo = leer('js/15-ciclo-semanal.js'),
      arr = leer('js/46-arrastre.js'), cat = leer('js/90-ciclo-admin.js'), r70 = leer('js/70-conversion-render.js'),
      comp = leer('js/88-compras.js'), roles = leer('js/50-roles-permisos.js'), html = leer('index.html'), sw = leer('sw.js'),
      reglas = leer('firestore.rules'), exis = leer('js/47-existencia.js');

const ctx = { window: {}, console: { warn() {}, info() {}, log() {}, error() {} }, products: [], compras: [],
              AREAS_CONTEO: ['almacen', 'barra1', 'barra2'], areas: { almacen: 'Almacén', barra1: 'Barra Restaurante', barra2: 'Barra Bar' },
              document: { getElementById: () => null, addEventListener() {} },
              setCicloEstado() {}, isCicloBloqueado() { return false; }, _getPendingSyncCount() { return 0; },
              APP_VERSION: '5.18', DB_VERSION: 1 };
let A;
try {
    A = new Function('ctx', 'with (ctx) {' + ciclo + '\n' + arr + '\n' + cat + '\n' + imp + '\n' + det + `
      return { importarPlantilla, importarPlantillaCsv, importarValidarCatalogo, importarValidarExistencias, importarArmarCorte,
               importarValidarMomento, comprasDetalleDatos, anclaElegir, anclaEtiqueta, COLUMNAS_CATALOGO, IMPORTAR_SECCIONES, _impNumero };
    }`)(ctx);
    chk('Los archivos reales (15, 46, 90, 96, 89) se ejecutan juntos', true);
} catch (e) { chk('Los archivos reales (15, 46, 90, 96, 89) se ejecutan juntos', false, String(e && e.stack || e)); }

if (A) {
    const prods = [{ id: '1180001', name: 'TEQUILA', unit: 'PZA', group: 'TEQUILA', precio: 350, conversion: 750, pv: 'PVB1' },
                   { id: '1020064', name: 'LIMON', unit: 'KGS', group: 'FRUTA', precio: 38 },
                   { id: '1060020', name: 'FRESCA', unit: 'PZA', group: 'REFRESCOS' }];
    const areasDef = [{ id: 'almacen', nombre: 'Almacén' }, { id: 'barra1', nombre: 'Barra Restaurante' }, { id: 'barra2', nombre: 'Barra Bar' }];

    // ═══ 1 · Secciones y plantillas ═════════════════════════════════════════
    chk('★ El módulo reúne las 5 importaciones: catálogo, recetas, existencias, compras y ventas',
        A.IMPORTAR_SECCIONES.map(s => s.id).join(',') === 'catalogo,recetas,existencias,compras,ventas');
    chk('Cada sección exige su permiso (catalog.publish, recipe.edit, inventory.post, purchases.import, sales.import)',
        A.IMPORTAR_SECCIONES.map(s => s.permiso).join(',') === 'catalog.publish,recipe.edit,inventory.post,purchases.import,sales.import');
    const pc = A.importarPlantilla('catalogo', prods, areasDef);
    chk('★ Plantilla del catálogo: cabeceras que la importación reconoce, prellenada con el catálogo actual',
        pc.cabeceras.slice(0, 4).join(',') === 'ID,Nombre,Grupo,Unidad' && pc.filas.length === 3 && pc.filas[0][0] === '1180001' && pc.filas[0][4] === 350);
    const todasConocidas = [].concat.apply([], Object.keys(A.COLUMNAS_CATALOGO).map(k => A.COLUMNAS_CATALOGO[k]));
    chk('Todas las cabeceras de la plantilla del catálogo están en COLUMNAS_CATALOGO (lo que valida = lo que importa)',
        pc.cabeceras.every(c => todasConocidas.indexOf(c) !== -1), pc.cabeceras.filter(c => todasConocidas.indexOf(c) === -1).join(','));
    const pe = A.importarPlantilla('existencias', prods, areasDef);
    chk('★ Plantilla del corte: Código, Producto, Unidad, Área, Enteras, Abierta — prellenada con TODO el catálogo y cantidades vacías',
        pe.cabeceras.join(',') === 'Código,Producto,Unidad,Área,Enteras,Abierta' && pe.filas.length === 3 && pe.filas[1][4] === '' && pe.filas[1][5] === '');
    chk('La plantilla del corte explica la fracción decimal y que una fila vacía = no contado',
        pe.instrucciones.some(t => /FRACCIÓN decimal/.test(t)) && pe.instrucciones.some(t => /vacía/.test(t) && /Total actual/.test(t)));
    const pv = A.importarPlantilla('ventas', [], areasDef);
    chk('La plantilla de ventas usa la hoja "Detalle" (la que lee el importador de Parrot) y solo .xlsx',
        pv.hoja === 'Detalle' && A.IMPORTAR_SECCIONES.find(s => s.id === 'ventas').formatos.join() === 'xlsx');
    chk('La plantilla de recetas trae Almacén 12 (solo barra)', A.importarPlantilla('recetas', [], areasDef).filas.every(f => f[8] === '12'));
    const csv = A.importarPlantillaCsv({ cabeceras: ['A', 'B'], filas: [['x,y', 'di "hola"'], [1, '']] });
    chk('CSV con BOM (acentos en Excel), comas y comillas escapadas',
        csv.charCodeAt(0) === 0xFEFF && csv.indexOf('"x,y"') !== -1 && csv.indexOf('"di ""hola"""') !== -1 && /\r\n$/.test(csv));

    // ═══ 2 · Validación previa del catálogo ═════════════════════════════════
    const vc = A.importarValidarCatalogo([
        { ID: '1180001', Nombre: 'TEQUILA', Grupo: 'TEQUILA', Unidad: 'PZA', Precio: 400 },
        { ID: '1180001', Nombre: 'TEQ DUP', Grupo: 'TEQUILA', Unidad: 'PZA' },
        { ID: '2', Nombre: 'SIN GRUPO', Unidad: 'PZA', Precio: 10 },
        { ID: '3', Nombre: 'MAL', Grupo: 'RON', Unidad: 'PZA', Precio: 'abc', Conversion: -5 },
        { ID: '4', Nombre: 'NUEVO', Grupo: 'RON', Precio: '12,5', Extra: 1, PV: 'PVB1' },
        { ID: '5', Grupo: 'RON', Unidad: 'PZA' }
    ], prods);
    chk('★ Detecta el ID duplicado dentro del archivo', vc.errores.some(e => /ID 1180001 está duplicado/.test(e)), vc.errores.join(' | '));
    chk('★ Detecta la omisión de categoría (Grupo vacío)', vc.errores.some(e => /Fila 4.*sin Grupo/.test(e)));
    chk('★ Detecta números erróneos (texto) y negativos', vc.errores.some(e => /Precio no es un número \("abc"\)/.test(e)) && vc.errores.some(e => /Conversión negativo/.test(e)));
    chk('Detecta la fila sin nombre', vc.errores.some(e => /Fila 7.*sin nombre/.test(e)));
    chk('Acepta coma decimal ("12,5") como número', !vc.errores.some(e => /Fila 6/.test(e)), vc.errores.join(' | '));
    chk('Avisa (sin bloquear): sin unidad, columnas ignoradas y PV repetido',
        vc.avisos.some(a => /Fila 6: sin Unidad/.test(a)) && vc.avisos.some(a => /se ignoran: Extra/.test(a)) && vc.avisos.some(a => /PV PVB1 se repite/.test(a)), vc.avisos.join(' | '));
    chk('Cuenta altas y actualizaciones solo de las filas válidas', vc.actualizaciones === 1 && vc.altas === 1, JSON.stringify({ a: vc.altas, u: vc.actualizaciones }));
    const sinCols = A.importarValidarCatalogo([{ Codigo: 1, Precio: 3 }], prods);
    chk('Sin las columnas obligatorias (Nombre, Grupo) se bloquea antes de revisar filas',
        sinCols.errores.some(e => /"Nombre"/.test(e)) && sinCols.errores.some(e => /"Grupo"/.test(e)));
    chk('Un archivo correcto pasa sin errores', A.importarValidarCatalogo([{ ID: '9', Nombre: 'X', Grupo: 'Y', Unidad: 'PZA', Precio: 1 }], prods).errores.length === 0);

    // ═══ 3 · Corte de existencias ═══════════════════════════════════════════
    const exist = { '1180001': { valor: 3, origen: 'oficial' }, '1020064': { valor: 4, origen: 'operativo_no_reconciliado' }, '1060020': { valor: 10, origen: 'oficial' } };
    const ve = A.importarValidarExistencias([
        { 'Código': '1180001', Producto: 'TEQUILA', 'Área': 'almacen', Enteras: 1, Abierta: 0.25 },
        { 'Código': '1180001', Producto: 'TEQUILA', 'Área': 'Barra Bar', Enteras: 1, Abierta: '0,5' },
        { 'Código': '1020064', Producto: 'LIMON', Enteras: 2.5 },
        { 'Código': '1060020', Producto: 'FRESCA' }                         // vacío = no contado
    ], prods, areasDef, p => exist[p.id]);
    chk('★ Suma enteras + fracción abierta por área (1.25 + 1.5 = 2.75)', ve.saldos['1180001'] === 2.75 && ve.porArea['1180001'].almacen === 1.25 && ve.porArea['1180001'].barra2 === 1.5, JSON.stringify(ve.saldos));
    chk('Acepta el área por nombre o por id', ve.errores.length === 0, ve.errores.join(' | '));
    chk('★ Una fila con cantidades vacías NO es un cero: el producto no se cuenta', !('1060020' in ve.saldos) && ve.vacias === 1);
    chk('★ El no contado conserva su Total actual SOLO si era oficial', ve.arrastrables['1060020'] === 10 && ve.noVienen.indexOf('1060020') !== -1);
    const tq = ve.comparacion.find(c => c.id === '1180001');
    chk('Compara contra el Total de hoy con la diferencia en pesos (2.75 − 3 = −0.25 × $350 = −$87.50)', tq && tq.dif === -0.25 && tq.dinero === -87.5, JSON.stringify(tq));
    const vm = A.importarValidarExistencias([
        { 'Código': '9999', Enteras: 1 }, { 'Código': '1180001', Enteras: 'dos' }, { 'Código': '1020064', Enteras: -1 },
        { 'Código': '1060020', 'Área': 'cocina', Enteras: 1 }, { 'Código': '1060020', Enteras: 1 }, { 'Código': '1060020', Enteras: 2 },
        { Producto: 'sin codigo', Enteras: 3 }
    ], prods, areasDef, p => exist[p.id]);
    chk('★ Errores: código fuera del catálogo, número inválido, negativo, área inexistente, duplicado, sin código',
        ['no está en el catálogo', 'Enteras no es un número', 'Enteras negativas', 'el área "cocina" no existe', 'está duplicado', 'no Código']
          .every(t => vm.errores.some(e => e.indexOf(t) !== -1)), vm.errores.join(' | '));
    const sinCant = A.importarValidarExistencias([{ 'Código': '1180001', Enteras: '', Abierta: '' }], prods, areasDef, p => exist[p.id]);
    chk('Si ninguna fila trae cantidades no hay corte que registrar', sinCant.errores.some(e => /no hay nada que cortar/.test(e)));
    chk('Falta "Enteras" → bloquea; falta "Abierta" → solo avisa',
        A.importarValidarExistencias([{ 'Código': '1' }], prods, areasDef).errores.some(e => /"Enteras"/.test(e)) &&
        A.importarValidarExistencias([{ 'Código': '1180001', Enteras: 1 }], prods, areasDef, p => exist[p.id]).avisos.some(a => /"Abierta"/.test(a)));

    const corte = A.importarArmarCorte(ve, { fecha: '2026-10-06', hora: '14:30', archivo: 'corte.xlsx', uid: 'u1', productos: prods, existenciaDe: p => exist[p.id],
                                            anclaAnterior: { id: '2026-10-04', tipo: 'inicial_semanal', fecha: '2026-10-04' } });
    chk('★ El corte se guarda como anclasExistencia/{fecha}_{HHmm}, tipo importacion_excel, con fecha y hora',
        corte.id === '2026-10-06_1430' && corte.doc.tipo === 'importacion_excel' && corte.doc.fecha === '2026-10-06' && corte.doc.hora === '14:30', corte.id);
    chk('★ Guarda el Total ANTERIOR de cada producto como histórico (previo) y el ancla que reemplaza',
        corte.doc.previo['1180001'].valor === 3 && corte.doc.previo['1020064'].origen === 'respaldo' && corte.doc.anclaAnterior.id === '2026-10-04');
    chk('Los saldos llevan lo contado + los no contados que conservan su Total (oficiales)',
        corte.doc.saldos['1180001'] === 2.75 && corte.doc.saldos['1060020'] === 10 && corte.doc.productosArrastrados.join() === '1060020');
    chk('origen.inventoryId es texto (lo exige la regla) y queda la trazabilidad del archivo',
        corte.doc.origen.inventoryId === 'excel:2026-10-06_1430' && corte.doc.origen.archivo === 'corte.xlsx');
    chk('Fecha/hora futura se rechaza; inválida también',
        /futuro/.test(A.importarValidarMomento('2026-10-06', '15:00', { fecha: '2026-10-06', hora: '14:59' })) &&
        A.importarValidarMomento('2026-10-06', '14:59', { fecha: '2026-10-06', hora: '14:59' }) === null &&
        /hora válida/.test(A.importarValidarMomento('2026-10-06', '25:00', { fecha: '2026-10-06', hora: '23:00' })));

    // ═══ 4 · El ancla con hora: desempate por registro ══════════════════════
    const cnt = { tipo: 'mitad_de_semana', fecha: '2026-10-06', saldos: {}, registradoEn: 1000 };
    const im1 = { tipo: 'importacion_excel', fecha: '2026-10-06', hora: '14:30', saldos: {}, registradoEn: 2000 };
    chk('★ Mismo día: gana el corte registrado después (importado a las 14:30 > recuento contabilizado antes)',
        A.anclaElegir([cnt, im1], '2026-10-06') === im1 && A.anclaElegir([im1, cnt], '2026-10-06') === im1);
    chk('Sin registro en alguno, se conserva la regla de FASE 14 (gana el inicial semanal)',
        A.anclaElegir([{ tipo: 'importacion_excel', fecha: '2026-10-04', saldos: {} }, { tipo: 'inicial_semanal', fecha: '2026-10-04', saldos: {} }], '2026-10-06').tipo === 'inicial_semanal');
    chk('Etiqueta del ancla importada con fecha y hora', /Corte importado de Excel \(06\/10\/2026 14:30\)/.test(A.anclaEtiqueta(im1)));

    // ═══ 5 · Detalle de compras por proveedor ════════════════════════════════
    const cs = [
        { compraId: 'A', proveedorNombre: 'DIST NORTE', proveedorCodigo: 'P1', fecha: '2026-10-05', lineas: [
            { productoId: '1180001', descripcionSap: 'TEQ 700', cantidadDocumento: 6, unidadDocumento: 'PZA', cantidadInventario: 6, costoUnitario: 340, importe: 2040, enCatalogo: true },
            { productoId: 'X9', descripcionSap: 'VASO', cantidadDocumento: 50, unidadDocumento: 'PZA', cantidadInventario: 50, costoUnitario: 1, importe: 50, enCatalogo: false }] },
        { compraId: 'B', proveedorNombre: 'DIST NORTE', proveedorCodigo: 'P1', fecha: '2026-09-29', lineas: [
            { productoId: '1180001', cantidadInventario: 2, costoUnitario: 330, importe: 660, enCatalogo: true }] },
        { compraId: 'C', proveedorNombre: 'OTRO', fecha: '2026-10-01', lineas: [{ productoId: '1180001', cantidadInventario: 9, importe: 1 }] }
    ];
    const d = A.comprasDetalleDatos(cs[0], cs, prods);
    chk('★ Muestra los productos de esa entrada, con el nombre del catálogo y la marca "no está en el catálogo"',
        d.totalLineas === 2 && d.lineas.some(l => l.nombre === 'TEQUILA' && l.importe === 2040) && d.lineas.some(l => l.productoId === 'X9' && !l.enCatalogo));
    chk('★ Acumula todo lo recibido del MISMO proveedor (6 + 2 = 8 tequilas, 2 entradas), no de otros',
        d.documentosProveedor === 2 && d.acumulado.find(a => a.productoId === '1180001').cantidad === 8 && d.acumulado.find(a => a.productoId === '1180001').entradas === 2);
    chk('El último costo es el de la entrada más reciente', d.acumulado.find(a => a.productoId === '1180001').ultimoCosto === 340);
    chk('Importe de la entrada y del proveedor', d.importeCompra === 2090 && d.importeProveedor === 2750, JSON.stringify([d.importeCompra, d.importeProveedor]));
}

// ═══ 6 · Integración con la app ═════════════════════════════════════════════
chk('★ handleFileImport acepta filas ya validadas (event._filas) y no vuelve a leer el archivo',
    /if \(Array\.isArray\(event\._filas\)\) \{\s*\n?\s*_catalogoAplicarFilas\(event\._filas, fileInput, event\);/.test(cat.replace(/\r/g, '')));
chk('…con las MISMAS reglas: _catalogoAplicarFilas es el cuerpo de siempre (alta/actualización por ID, F1, PV repetidos)',
    /function _catalogoAplicarFilas\(jsonData, fileInput, event\)/.test(cat) && /_resolverConteoOz\(prod, actual\)/.test(cat) && /if \(campo === 'stockByArea'\) return;/.test(cat));
chk('Desde el módulo no navega a Inicio: avisa al terminar (_alTerminar)', /event\._desdeModulo[\s\S]{0,400}event\._alTerminar\(/.test(cat));
chk('El permiso catalog.publish se sigue comprobando primero', /function handleFileImport\(event\) \{[\s\S]{0,1600}if \(!hasPermission\('catalog\.publish'\)\)/.test(cat));
chk('publicarCatalogoFirestore devuelve si se publicó (true/false)', /return true;\s*\/\/ v5\.18/.test(roles) && /return false;/.test(roles));
chk('★ Catálogo: aplicar y publicar en un paso, con confirmación y respaldo', /function importarAplicarCatalogo[\s\S]*showConfirm[\s\S]*handleFileImport\(evento\)[\s\S]*publicarCatalogoFirestore\(\)/.test(imp) || /_alTerminar: async function[\s\S]{0,400}publicarCatalogoFirestore\(\)/.test(imp));
chk('★ Corte: un solo documento (atómico) en anclasExistencia, con respaldo local, verificación de corte más nuevo y recarga del Total',
    /collection\('anclasExistencia'\)\.doc\(corte\.id\)\.set\(corte\.doc\)/.test(imp) && /_crearBackupNombrado\('pre_corte_existencias_/.test(imp) &&
    /_anclaPosteriorA\(p\.fecha\)/.test(imp) && /existenciaInvalidarInicial\(\)[\s\S]{0,200}existenciaCargarInicial\(/.test(imp));
chk('El corte se re-valida contra el Total del instante antes de guardar', /p\.validacion = importarValidarExistencias\(p\.filas/.test(imp));
chk('★ Los errores bloquean: el botón Aplicar/Registrar queda deshabilitado', /id="impBtnAplicar"[^;]*\(v\.errores\.length \? ' disabled/.test(imp) && /id="impBtnAplicar"[^;]*\(bloqueado \? ' disabled/.test(imp));
chk('Recetas, compras y ventas usan su importador de siempre y su vista previa se muestra dentro del módulo',
    /recetarioImportarExcel\(\)/.test(imp) && /comprasImportarExcel\(\)/.test(imp) && /ventasImportarExcel\(\)/.test(imp) &&
    /importarSeccion === 'compras'[\s\S]{0,200}renderComprasTab\(\)/.test(imp));

// ═══ 7 · Solo en el módulo ═══════════════════════════════════════════════════
const fnHeader = (r70.match(/function updateHeaderActions\(\)[\s\S]*?\n        }\n/) || [''])[0];
chk('★ El encabezado ya no importa: sin "Importar Excel" (catálogo/recetario) ni "Importar ventas"',
    !/fileInput'\)\.click\(\)|recetarioImportarExcel\(\)|ventasImportarExcel\(\)/.test(fnHeader));
chk('★ Inicio ya no tiene el botón "Excel" que importaba sin validar', !/onclick="document\.getElementById\(\\'fileInput\\'\)\.click\(\)"/.test(r70));
chk('★ Compras ya no tiene "Importar entrada de mercancía"', !/Importar entrada de mercancía<\/button>/.test(comp) && !/onclick="comprasImportarExcel\(\)"/.test(comp));
chk('El menú tiene "Importar desde Excel" y renderTab conoce la pestaña', /data-sb-tab="importar"[\s\S]{0,400}Importar desde Excel/.test(html) && /case 'importar':/.test(r70));
chk('index.html declara el input #impArchivo (xlsx, xls, csv)', /id="impArchivo" accept="\.xlsx,\.xls,\.csv"/.test(html));

// ═══ 8 · Compras: la tarjeta abre el detalle ═════════════════════════════════
chk('★ Cada tarjeta de compra es un botón accesible que abre el detalle', /class="cp-tarjeta" role="button" tabindex="0"[\s\S]{0,400}comprasVerDetalle\(/.test(comp.replace(/\r/g, '')));
chk('El detalle es solo lectura (no escribe en Firestore ni en el dispositivo)', !/collection\(|\.set\(|saveToLocalStorage/.test(det.replace(/\/\/.*$/gm, '')));
chk('Se cierra con X, con "Cerrar", tocando fuera o con Escape', /data-cd-cerrar/.test(det) && /e\.key === 'Escape'/.test(det) && /e\.target === wrap\.firstChild/.test(det));

// ═══ 9 · Reglas, archivos y versión ══════════════════════════════════════════
chk('★ Regla: el corte importado usa id fecha_HHmm que coincide con fecha y hora del documento',
    /d\.tipo == 'importacion_excel'[\s\S]{0,400}id == d\.fecha \+ '_' \+ d\.hora\.split\(':'\)\[0\] \+ d\.hora\.split\(':'\)\[1\]/.test(reglas) &&
    /tipo in \['fin_de_mes', 'mitad_de_semana', 'importacion_excel'\]/.test(reglas));
chk('El motor lee hasta 6 anclas del mismo día y desempata por registro', /\.limit\(6\)\.get\(\)/.test(exis) && /registradoEn:/.test(exis));
chk('index.html carga 89 tras 88 y 96 tras 95', html.indexOf('js/89-compras-detalle.js') > html.indexOf('js/88-compras.js') && html.indexOf('js/96-importar.js') > html.indexOf('js/95-exportacion.js'));
chk('sw.js precalienta los dos archivos nuevos', /'\.\/js\/89-compras-detalle\.js\?v=' \+ APP_VERSION/.test(sw) && /'\.\/js\/96-importar\.js\?v=' \+ APP_VERSION/.test(sw));
const vH = (html.match(/\?v=(\d+\.\d+)/) || [])[1], vS = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vH && vH === vS, vH + ' / ' + vS);
chk('La versión avanzó (>= 5.18)', Number((vS || '').split('.')[1]) >= 18, vS);

const ancho = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── v5.18 · Importar desde Excel, corte de existencias y detalle de compras (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
