// v5.35 — Físico vs Sistema: capa pura (Grupo, «Diferencias ↑», orden visible),
// exportación a Excel (filas, fórmulas, vacíos, libro real) y garantías estáticas.
//   node pruebas/prueba-v535-fvs-tabla.js
// El libro .xlsx se arma y se relee con SheetJS 0.18.5 (la misma versión que
// carga la app desde cdnjs) si está instalado: `npm i --no-save xlsx@0.18.5`
// o NODE_PATH apuntando a una copia. Si no está, esas comprobaciones salen
// como NO VERIFICADAS (no como aprobadas). La descarga real la cubre
// prueba-v535-fvs-navegador.js.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const NOVERIF = [];

const src49 = leer('js/49-fisico-vs-sistema.js');
const src86 = leer('js/97-exportar-diferencias.js');
const src85 = leer('js/85-ui-inventario-fisico.js');
const src97 = leer('js/97-exportar-existencias.js');
const idx = leer('index.html'), sw = leer('sw.js'), util = leer('css/utilidades.css');
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function funcion(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    const m = /\n        (?:async )?function /.exec(src.slice(ini + 10));
    return m ? src.slice(ini, ini + 10 + m.index) : src.slice(ini);
}

// ── Contexto: el js/49 real con un inventario abierto simulado ────────────
const ctx = {
    console, Math, Date, String, Number, Array, Object, JSON, isFinite, parseFloat,
    AREAS_CONTEO: ['almacen', 'barra1'],
    _inventarioActivo: { estado: 'SINCRONIZADO', numero: 7 }, _inventarioActivoId: 'INV7',
    inventarioAbierto: (i) => !!i && i.estado === 'SINCRONIZADO',
    existenciaEntradas: () => ({}), existenciaVentas: () => ({}),
    EXISTENCIA_TOLERANCIA: 0.001,
    tieneConversion: () => false, convertirOzAPuntos: () => 0,
    existenciaOficial: (p) => ({ valor: p._sis, origen: 'oficial', hayInicial: true }),
    products: [
        { id: 'A', name: 'TEQUILA A', group: 'TEQUILA', unit: 'Botellas', precio: 100, _sis: 10 },   // −4 → −400
        { id: 'B', name: 'RON B',     group: 'RON',     unit: 'Botellas', precio: 50,  _sis: 2 },    // +3 → 150
        { id: 'C', name: 'VODKA C',   group: 'VODKA',   unit: 'Botellas', precio: 20,  _sis: 5 },    // sin contar
        { id: 'D', name: 'RON D',     group: 'RON',     unit: 'Piezas',   precio: 12.5, _sis: 4 },   // 0
        { id: 'E', name: 'CERVEZA E', group: 'CERVEZA', unit: 'Piezas',                _sis: 24 },   // −0.5, SIN precio
        { id: '0012', name: 'MEZCAL 0012', group: 'TEQUILA', unit: 'Botellas', precio: 'x', _sis: 1 } // +1.25, precio inválido
    ],
    auditoriaConteo: {
        A: { almacen: { enteras: 6, abiertas: [] } },
        B: { barra1: { enteras: 5, abiertas: [] } },
        D: { almacen: { enteras: 4, abiertas: [] } },
        E: { almacen: { enteras: 23, abiertas: [0.5] } },
        '0012': { almacen: { enteras: 2, abiertas: [0.25] } }
    }
};
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(src49, ctx);
vm.runInContext(src86, ctx);
const antesProductos = JSON.stringify(ctx.products), antesConteo = JSON.stringify(ctx.auditoriaConteo);
const datos = vm.runInContext('fisicoVsSistemaCalcular()', ctx);
const fila = (id) => datos.filas.find(f => f.id === id);

// ═══ 1 · Convención de la app (no se cambia) ══════════════════════════════
chk('Convención intacta: diferencia = físico − sistema (A: 6 − 10 = −4; neto −400)', fila('A').diferencia === -4 && fila('A').neto === -400);
chk('Sin contar → diferencia null (no 0); sí trae «Sistema»', fila('C').estado === 'pendiente' && fila('C').diferencia === null && fila('C').fisico === null && fila('C').sistema === 5);

// ═══ 2 · «Diferencias ↑» ══════════════════════════════════════════════════
const filasCopia = JSON.stringify(datos.filas);
const asc = vm.runInContext('fisicoVsSistemaOrdenarDifAsc(fisicoVsSistemaCalcular().filas)', ctx);
chk('★ Orden ascendente NUMÉRICO: −4, −0.5, 0, +1.25, +3 y lo sin contar al final',
    JSON.stringify(asc.map(f => f.id)) === JSON.stringify(['A', 'E', 'D', '0012', 'B', 'C']), asc.map(f => f.id + ':' + f.diferencia).join(' '));
const raras = [
    { id: 'x1', nombre: 'Z', estado: 'contado', diferencia: 10 }, { id: 'x2', nombre: 'Y', estado: 'contado', diferencia: -10 },
    { id: 'x3', nombre: 'X', estado: 'contado', diferencia: 2 },  { id: 'x4', nombre: 'W', estado: 'contado', diferencia: NaN },
    { id: 'x5', nombre: 'V', estado: 'pendiente', diferencia: null }, { id: 'x6', nombre: 'U', estado: 'contado', diferencia: 0 },
    { id: 'x7', nombre: 'A', estado: 'contado', diferencia: 2 }
];
ctx._raras = raras;
const ordR = vm.runInContext('fisicoVsSistemaOrdenarDifAsc(_raras)', ctx).map(f => f.id);
chk('★ Numérico, no texto (−10 < 0 < 2 < 10; "10" no va antes de "2"); inválidos/vacíos NO se vuelven 0: van al final',
    JSON.stringify(ordR) === JSON.stringify(['x2', 'x6', 'x7', 'x3', 'x1', 'x5', 'x4']), ordR.join(','));
chk('Empates por nombre (orden estable y repetible)', ordR.indexOf('x7') < ordR.indexOf('x3'));
chk('★ Ordenar no modifica las filas recibidas ni su orden original', JSON.stringify(datos.filas) === filasCopia
    && JSON.stringify(raras.map(r => r.id)) === JSON.stringify(['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7']));

// ═══ 3 · «Grupo» ══════════════════════════════════════════════════════════
const grupos = vm.runInContext('fisicoVsSistemaGrupos(fisicoVsSistemaCalcular().filas)', ctx);
chk('Grupos reales del catálogo (campo group), alfabéticos, con cuántos productos',
    JSON.stringify(grupos) === JSON.stringify([{ grupo: 'CERVEZA', n: 1 }, { grupo: 'RON', n: 2 }, { grupo: 'TEQUILA', n: 2 }, { grupo: 'VODKA', n: 1 }]), JSON.stringify(grupos));
const ron = vm.runInContext('fisicoVsSistemaFiltrarGrupo(fisicoVsSistemaCalcular().filas, "RON")', ctx);
const todos1 = vm.runInContext('fisicoVsSistemaFiltrarGrupo(fisicoVsSistemaCalcular().filas, "")', ctx);
const todos2 = vm.runInContext('fisicoVsSistemaFiltrarGrupo(fisicoVsSistemaCalcular().filas, null)', ctx);
chk('★ Filtrar por grupo deja solo ese grupo, sin duplicar ni cambiar IDs', ron.length === 2 && ron.every(f => f.grupo === 'RON') && new Set(ron.map(f => f.id)).size === 2);
chk('★ «Todos» (vacío o null) regresa todas las filas', todos1.length === 6 && todos2.length === 6);
ctx.products.push({ id: 'G', name: 'SIN GRUPO', unit: 'Piezas', precio: 1, _sis: 0 });
chk('Producto sin grupo cae en «General» (igual que la app)', vm.runInContext('fisicoVsSistemaGrupos(fisicoVsSistemaCalcular().filas)', ctx).some(g => g.grupo === 'General'));
ctx.products.pop();

// ═══ 4 · Orden visible (el MISMO para pantalla y Excel) ═══════════════════
const vG = vm.runInContext('fisicoVsSistemaOrdenVisible(fisicoVsSistemaCalcular().filas, { orden: "menor_mayor" })', ctx);
const agr = vm.runInContext('fisicoVsSistemaAgrupar(fisicoVsSistemaCalcular().filas, "menor_mayor")', ctx);
chk('Sin «Diferencias ↑»: modo por grupo, idéntico a fisicoVsSistemaAgrupar (orden de siempre)',
    vG.modo === 'grupos' && JSON.stringify(vG.filas.map(f => f.id)) === JSON.stringify([].concat.apply([], agr.map(g => g.filas.map(f => f.id)))));
const vGd = vm.runInContext('fisicoVsSistemaOrdenVisible(fisicoVsSistemaCalcular().filas, { orden: "mayor_menor" })', ctx);
chk('Respeta el chip «Mayor diferencia primero» en el modo por grupo', JSON.stringify(vGd.filas.filter(f => f.grupo === 'TEQUILA').map(f => f.id)) === JSON.stringify(['0012', 'A']));
const vP = vm.runInContext('fisicoVsSistemaOrdenVisible(fisicoVsSistemaCalcular().filas, { grupo: "TEQUILA", difAsc: true })', ctx);
chk('★ «Diferencias ↑» respeta el grupo elegido', vP.modo === 'plano' && JSON.stringify(vP.filas.map(f => f.id)) === JSON.stringify(['A', '0012']));

// ═══ 5 · Exportación: filas, fórmulas y vacíos ═══════════════════════════
chk('Nombre Diferencias_Fisico_y_Sistema_YYYY-MM-DD.xlsx con la fecha LOCAL',
    vm.runInContext('fvsExportNombre(new Date(2026, 9, 26, 23, 59))', ctx) === 'Diferencias_Fisico_y_Sistema_2026-10-26.xlsx'
    && vm.runInContext('fvsExportNombre(new Date(2026, 0, 5, 0, 1))', ctx) === 'Diferencias_Fisico_y_Sistema_2026-01-05.xlsx');
chk('★ Columnas EXACTAS y en orden', JSON.stringify(vm.runInContext('FVS_EXPORT_COLUMNAS', ctx)) === JSON.stringify(
    ['Grupo', 'ID', 'Descripción', 'Unidad', 'Cantidad en sistema', 'Cantidad contada', 'Diferencia', 'Precio', 'Precio total de diferencia']));
const ex = vm.runInContext('fvsExportFilas(fisicoVsSistemaOrdenVisible(fisicoVsSistemaCalcular().filas, { difAsc: true }).filas, function(id) { return products.find(function(p) { return p.id === id; }); })', ctx);
const e = (id) => ex.find(f => f.id === id);
chk('★ Contado: sistema, contada, diferencia (con signo), precio y total = diferencia × precio', JSON.stringify(e('A')) === JSON.stringify(
    { grupo: 'TEQUILA', id: 'A', descripcion: 'TEQUILA A', unidad: 'Botellas', sistema: 10, contada: 6, diferencia: -4, precio: 100, total: -400, estado: 'contado' }), JSON.stringify(e('A')));
chk('★ El total coincide con el «Neto» de la app en cada producto con precio válido', ['A', 'B', 'D'].every(id => e(id).total === fila(id).neto), ['A', 'B', 'D'].map(id => e(id).total + '/' + fila(id).neto).join(' '));
chk('★ Sin contar: la fila SALE, con «Sistema», y contada/diferencia/total VACÍOS (no 0)', e('C') && e('C').sistema === 5 && e('C').contada === null && e('C').diferencia === null && e('C').total === null && e('C').precio === 20);
chk('★ Sin precio: Precio y Precio total VACÍOS (no se inventa); la diferencia sí sale (−0.5)', e('E').precio === null && e('E').total === null && e('E').diferencia === -0.5);
chk('Precio inválido (texto) = sin precio, no NaN ni 0', e('0012').precio === null && e('0012').total === null && e('0012').diferencia === 1.25);
chk('Diferencia cero: 0 (no vacío) y total 0 sin "-0"', e('D').diferencia === 0 && e('D').total === 0 && !Object.is(e('D').total, -0));
chk('Negativos conservan su signo (faltante en dinero negativo)', e('A').total < 0 && e('E').diferencia < 0);
chk('★ El Excel sale en el mismo orden visible', JSON.stringify(ex.map(f => f.id)) === JSON.stringify(['A', 'E', 'D', '0012', 'B', 'C']));
chk('★ Calcular/exportar NO modificó products ni el conteo', JSON.stringify(ctx.products) === antesProductos && JSON.stringify(ctx.auditoriaConteo) === antesConteo);

// ═══ 6 · Libro .xlsx real (SheetJS 0.18.5) ════════════════════════════════
let X = null;
try { X = require('xlsx'); } catch (_) { X = null; }
if (!X) {
    NOVERIF.push('Libro .xlsx (SheetJS no instalado en este equipo: npm i --no-save xlsx@0.18.5)');
} else {
    const wb = vm.runInContext('fvsExportLibro', ctx)(X, ex, { generado: 'hoy', usuario: 'prueba', version: '5.35', inventario: '#7', alcance: 'Todos los grupos', orden: 'Diferencias de menor a mayor (sin agrupar)', sinInicial: 0 });
    const bytes = X.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
    const ctx97 = { console, TextDecoder, TextEncoder, Uint8Array }; vm.createContext(ctx97); vm.runInContext(src97, ctx97);
    const fijo = ctx97.existenciasExportCongelar(X, bytes, 1);
    const wb2 = X.read(fijo || bytes, { type: 'array', cellNF: true, cellStyles: true });
    const ws = wb2.Sheets['Diferencias'];
    const aoa = X.utils.sheet_to_json(ws, { header: 1, defval: null });
    chk('Versión de SheetJS para la prueba = la de la app (0.18.5)', X.version === '0.18.5', X.version);
    chk('★ Archivo .xlsx válido (zip OOXML) que se vuelve a leer', !!wb2 && wb2.SheetNames[0] === 'Diferencias' && wb2.SheetNames.indexOf('Información') !== -1);
    chk('★ Encabezados: las 9 columnas, en el orden pedido', JSON.stringify(aoa[0]) === JSON.stringify(vm.runInContext('FVS_EXPORT_COLUMNAS', ctx)), JSON.stringify(aoa[0]));
    chk('Una fila por producto (6) y nada más', aoa.length === 7);
    chk('★ Cantidades, diferencia, precio y total son NÚMEROS en Excel (no texto)', ['E2', 'F2', 'G2', 'H2', 'I2'].every(r => ws[r] && ws[r].t === 'n'), ['E2', 'F2', 'G2', 'H2', 'I2'].map(r => ws[r] && ws[r].t).join(','));
    chk('ID como texto (el código "0012" no se vuelve 12)', ws['B5'] && ws['B5'].t === 's' && ws['B5'].v === '0012', JSON.stringify(ws['B5']));
    const filaC = aoa.findIndex(r => r[1] === 'C');
    chk('★ Sin contar: celdas vacías en Excel (no 0)', aoa[filaC][4] === 5 && aoa[filaC][5] === null && aoa[filaC][6] === null && aoa[filaC][8] === null, JSON.stringify(aoa[filaC]));
    const filaE = aoa.findIndex(r => r[1] === 'E');
    chk('★ Sin precio: Precio y Precio total vacíos en Excel', aoa[filaE][7] === null && aoa[filaE][8] === null && aoa[filaE][6] === -0.5, JSON.stringify(aoa[filaE]));
    chk('Valores negativos intactos en el archivo', aoa[1][6] === -4 && aoa[1][8] === -400, JSON.stringify(aoa[1]));
    chk('Formatos numéricos: cantidades, diferencia con signo y moneda', /0\.00#/.test(ws['E2'].z || '') && /^\+/.test(ws['G2'].z || '') && /\$/.test(ws['I2'].z || ''), [ws['E2'].z, ws['G2'].z, ws['I2'].z].join(' | '));
    chk('Filtros de Excel en el encabezado (A1:I7)', ws['!autofilter'] && ws['!autofilter'].ref === 'A1:I7', JSON.stringify(ws['!autofilter']));
    chk('Anchos de columna definidos para las 9', Array.isArray(ws['!cols']) && ws['!cols'].length === 9);
    const z = X.CFB.read(fijo || bytes, { type: 'array' });
    const xml = Buffer.from(X.CFB.find(z, '/xl/worksheets/sheet1.xml').content).toString('utf8');
    chk('★ Fila de encabezados congelada (pane ySplit=1 frozen)', !!fijo && /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/.test(xml));
    const inf = X.utils.sheet_to_json(wb2.Sheets['Información'], { header: 1 });
    chk('Hoja «Información»: alcance, orden, sin contar y sin precio explicados', inf.some(r => r[0] === 'Sin contar' && r[1] === 1) && inf.some(r => r[0] === 'Sin precio válido' && r[1] === 2)
        && inf.some(r => r[0] === 'Celdas vacías' && /no es cero/.test(r[1])) && inf.some(r => r[0] === 'Alcance'));
    fs.mkdirSync(path.join(require('os').tmpdir(), 'bi-v535'), { recursive: true });
    fs.writeFileSync(path.join(require('os').tmpdir(), 'bi-v535', 'pura.xlsx'), Buffer.from(fijo || bytes));
}

// ═══ 7 · Garantías estáticas ══════════════════════════════════════════════
const c86 = sinCom(src86);
chk('★ El exportador SOLO LEE: sin localStorage, Firestore, saveToLocalStorage, syncToCloud ni asignaciones a products/conteos',
    !/localStorage|indexedDB|_db\b|\.collection\(|saveToLocalStorage|syncToCloud|syncMyAuditoria/.test(c86) && !/\b(products|auditoriaConteo|myAuditoriaConteo|inventarioConteo)\s*=[^=]/.test(c86));
chk('★ Exportar exige ver la comparación Y el permiso de exportar', /hasPermission\('inventory\.viewAll'\) && hasPermission\('inventory\.export'\)/.test(src86)
    && /function fvsExportBotonHtml[\s\S]*?if \(!_fvsPuedeExportar\(\) \|\| !datos\) return '';/.test(src86));
chk('Reutiliza la fila fija y la descarga de js/97 (sin duplicar el truco del zip)', /existenciasExportCongelar\(XLSX, bytes, 1\)/.test(src86) && /_exDescargar\(bytes, nombre\)/.test(src86));
chk('★ El exportador usa el MISMO orden visible que la pantalla', /fisicoVsSistemaOrdenVisible\(datos\.filas, op\)/.test(src86) && /fisicoVsSistemaOrdenVisible\(r\.items, _fvsOpcionesVista\(\)\)/.test(src85));
const c85v = sinCom(funcion(src85, 'fvsElegirGrupo') + funcion(src85, 'fvsAlternarDifAsc') + funcion(src85, 'fvsReiniciarVista'));
chk('★ Grupo y «Diferencias ↑» solo cambian la vista (sin guardar ni sincronizar)', c85v.length > 50 && !/saveToLocalStorage|syncToCloud|localStorage|_db/.test(c85v));
chk('Volver reinicia la vista (grupo y orden) junto con la búsqueda', /_fvsSearchTerm=\\'\\'; fvsReiniciarVista\(\); renderTab\(\);/.test(src85));
chk('Con «Diferencias ↑» se oculta el chip de invertir el orden (un solo orden a la vez)', /_chipsFvs\(\)\.filter\(function\(c\) \{ return !\(_fvsVista\.difAsc && c\.id === 'orden_desc'\); \}\)/.test(src85));
chk('La pantalla sigue negando el acceso sin inventory.viewAll', /function renderFisicoVsSistema\(\) \{\s*if \(!hasPermission\('inventory\.viewAll'\)\)/.test(src85));
chk('La corrección por área se conserva (data-fvs-accion="editar", solo si se puede editar)', /if \(editable && p\)[\s\S]{0,120}data-fvs-accion="editar"/.test(funcion(src85, '_fvsFilaHtml')));
chk('Botones «Grupo», «Diferencias ↑» y «Exportar diferencias a Excel» presentes', />Grupo<span/.test(src85) && /Diferencias ↑/.test(src85) && /Exportar diferencias a Excel/.test(src86));
const pos = (s) => idx.indexOf(s);
chk('index.html carga js/97-exportar-diferencias en su orden numérico (antes de 97-exportar-existencias y del arranque)', pos('<script src="js/97-exportar-diferencias.js') > pos('<script src="js/96-importar.js') && pos('<script src="js/97-exportar-diferencias.js') < pos('<script src="js/97-exportar-existencias.js') && pos('<script src="js/97-exportar-existencias.js') < pos('<script src="js/99-window-arranque.js'));
chk('sw.js lo calienta (WARM_URLS), no en PRECACHE', /'\.\/js\/97-exportar-diferencias\.js\?v=' \+ APP_VERSION/.test(sw) && !/PRECACHE_URLS\s*=\s*\[[^\]]*97-exportar-dif/.test(sw));
const mV = /const APP_VERSION = '([\d.]+)'/.exec(sw);
const vs = [...new Set([...idx.matchAll(/\?v=([\d.]+)/g)].map(m => m[1]))];
chk('★ Versión 5.35: sw.js y todas las etiquetas ?v= coinciden', !!mV && mV[1] === '5.35' && vs.length === 1 && vs[0] === '5.35', (mV ? mV[1] : '?') + ' / ' + vs.join(','));
const bloque = util.slice(util.indexOf('v5.35 — FÍSICO VS SISTEMA'));
chk('★ Estilos en utilidades.css, solo tokens (cero hex, rgba() u oklch())', bloque.length > 1000 && !/#[0-9a-fA-F]{3,8}\b/.test(bloque) && !/rgba?\(|oklch\(/.test(bloque));
chk('Controles táctiles de 44 px (botones, celda editable)', /\.fvs-ctl__btn \{[^}]*min-height: 44px/.test(bloque) && /button\.fvs-t__celda \{[^}]*min-height: 44px/.test(bloque));
chk('Tabla con desplazamiento horizontal controlado y producto fijo', /\.fvs-t-wrap \{[^}]*overflow-x: auto/.test(bloque) && /\.fvs-t__prod \{[^}]*position: sticky; left: 0/.test(bloque));
chk('Iconos usados existen en el kit (boxes-stacked, sort, file-excel, pen)', ['fa-boxes-stacked', 'fa-sort', 'fa-file-excel', 'fa-pen'].every(i => new RegExp('^\\.' + i + '\\s', 'm').test(util)));
chk('Sin emoji como iconografía en la pantalla (regla R5)', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(funcion(src85, '_renderFvsResultados') + funcion(src85, '_fvsControlesHtml') + funcion(src85, '_fvsFilaHtml')));

const fallos = C.filter(c => !c.ok);
C.forEach(c => console.log((c.ok ? '  ✅  ' : '  ❌  ') + c.n + (c.ok ? '' : '  → ' + c.d)));
NOVERIF.forEach(n => console.log('  ⚪  NO VERIFICADO: ' + n));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron' + (NOVERIF.length ? ' · ' + NOVERIF.length + ' sin verificar' : ''));
process.exit(fallos.length ? 1 : 0);
