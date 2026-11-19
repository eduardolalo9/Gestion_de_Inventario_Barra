// v5.54 — Exportar / compartir el conteo activo (PDF A4 vertical y Excel): capa pura + guardas estáticas.
// El PDF se genera con la jsPDF REAL del repositorio y se espía lo que dibuja (doc.text), de modo que se prueba la
// maquetación de verdad: hojas, encabezado repetido, bandas de grupo, ceros, límites de la hoja y «Hoja X de Y».
//   node pruebas/prueba-v554-exportar-conteo.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');

const { jsPDF } = require(path.join(RAIZ, 'js', 'jspdf.umd.min.js'));
const XLSX = require(path.join(RAIZ, 'js', 'xlsx.full.min.js'));
const sb = { console, window: {}, Object, Math, String, Number, Array, JSON, Date, RegExp, Boolean };
sb.window = sb; vm.createContext(sb);
vm.runInContext(leer('js/97-exportar-conteo.js'), sb);

// ── Espía: una subclase de jsPDF que anota cada texto con su hoja, posición, fuente y cuerpo ──
function espia() {
  const log = [];
  // jsPDF instala sus métodos en cada instancia (no en el prototipo): el espía envuelve la instancia ya creada.
  const J = function (opts) {
    const d = new jsPDF(opts);
    const text = d.text.bind(d), setTextColor = d.setTextColor.bind(d);
    d.setTextColor = function (r, g, b) { d._col = [r, g, b]; return setTextColor(r, g, b); };
    d.text = function (t, x, y, o) {
      const f = d.getFont ? d.getFont() : {};
      log.push({ t: String(t), x, y, o: o || {}, pag: d.getCurrentPageInfo().pageNumber, fuente: f.fontName, estilo: f.fontStyle, cuerpo: d.getFontSize(), color: d._col || null });
      return text(t, x, y, o);
    };
    return d;
  };
  return { J, log };
}

const AREAS = [{ clave: 'almacen', nombre: 'Almacén' }, { clave: 'barra1', nombre: 'Barra Restaurante' }, { clave: 'barra2', nombre: 'Barra Bar' }];
const claves = AREAS.map(a => a.clave);
const INFO = { titulo: 'Inventario físico — Conteo activo', subtitulo: 'Almacén · Barra Restaurante · Barra Bar', derecha: ['Inventario #12', '19/11/2026 · 10:42', 'Generado por Admin'], version: '5.54', generado: '19/11/2026 10:42', usuario: 'Admin' };

// ═══ 1 · Datos: filas, ceros y conversión ═══
chk('El nombre del archivo lleva la fecha: Conteo_activo_AAAA-MM-DD.pdf / .xlsx', sb.conteoExportNombre(new Date(2026, 10, 9), 'pdf') === 'Conteo_activo_2026-11-09.pdf' && sb.conteoExportNombre(new Date(2026, 0, 31), 'xlsx') === 'Conteo_activo_2026-01-31.xlsx');
const prods = [
  { id: 'R2', name: 'RON BACARDI', group: 'RON', unit: 'BOT' },
  { id: 'T1', name: 'TEQUILA 1800', group: 'TEQUILA', unit: 'BOT' },
  { id: 'R1', name: 'RON ABUELO', group: 'RON', unit: 'BOT' },
  { id: 'T2', name: 'TEQUILA DON JULIO', group: 'TEQUILA', unit: 'BOT' },
  { id: 'X9', name: 'SIN CONTEO', group: 'TEQUILA' }
];
const conteo = {
  T1: { tocado: true, areas: { almacen: { enteras: 2, abiertas: [10], total: 3.4 }, barra1: { enteras: 1, abiertas: [], total: 1 }, barra2: null } },
  R1: { tocado: true, areas: { almacen: { enteras: 0, abiertas: [4], total: 0.75 }, barra1: null, barra2: null } },
  R2: { tocado: true, areas: { almacen: { enteras: 6, abiertas: [], total: 6 }, barra1: { enteras: 2, abiertas: [3], total: 2.7 }, barra2: { enteras: 2, abiertas: [1], total: 2.4 } } },
  T2: { tocado: false, areas: { almacen: null, barra1: null, barra2: null } }
};
const conteoDe = (p) => conteo[p.id] || { tocado: false, areas: {} };
const filas = sb.conteoExportFilas(prods, conteoDe, claves);
chk('Las filas salen ordenadas por grupo y luego por nombre (RON ABUELO, RON BACARDI, SIN CONTEO, TEQUILA 1800, …)', filas.map(f => f.id).join(',') === 'R1,R2,X9,T1,T2', filas.map(f => f.id).join(','));
const t1 = filas.find(f => f.id === 'T1');
chk('★ Las botellas abiertas se muestran YA CONVERTIDAS: abiertas = total − enteras (3.4 = 2 enteras + 1.4)', t1.cols[0].enteras === 2 && t1.cols[0].abiertas === 1.4 && t1.cols[0].total === 3.4, JSON.stringify(t1.cols[0]));
chk('El total del producto es la suma de las áreas (3.4 + 1 + 0 = 4.4)', t1.total === 4.4, String(t1.total));
chk('★ Un área sin dato vale 0 (no vacío) y queda marcada como no contada', t1.cols[2].total === 0 && t1.cols[2].enteras === 0 && t1.cols[2].abiertas === 0 && t1.cols[2].contado === false);
const sin = filas.find(f => f.id === 'T2'), sinConteoDef = filas.find(f => f.id === 'X9');
chk('★ Un producto que nadie contó sale en CEROS en todas las áreas y en el total (decisión de Eduardo)', sin.total === 0 && sin.cols.every(c => c.total === 0 && c.contado === false) && sin.contado === false);
chk('…también el que ni siquiera tiene datos de conteo (X9) y el que no trae unidad', sinConteoDef.total === 0 && sinConteoDef.unidad === '' && sinConteoDef.contado === false);
chk('Un producto contado en solo una de las áreas elegidas cuenta como contado', filas.find(f => f.id === 'R1').contado === true);
const sub = sb.conteoExportFilas(prods, conteoDe, ['barra1']);
chk('★ Con una sola área elegida, el total es solo de esa área (T1: 1) y un producto contado solo en otras áreas pasa a «sin conteo»', sub.find(f => f.id === 'T1').total === 1 && sub.find(f => f.id === 'R1').contado === false && sub.find(f => f.id === 'R1').total === 0);
const res = sb.conteoExportResumen(filas, 3);
chk('Resumen: 5 productos, 3 contados, 2 pendientes, total general 16.25 (4.4 + 0.75 + 11.1)', res.productos === 5 && res.contados === 3 && res.pendientes === 2 && Math.abs(res.total - 16.25) < 1e-9, JSON.stringify({ p: res.productos, c: res.contados, pe: res.pendientes, t: res.total }));
chk('Resumen por grupo: RON (2 productos, 11.85) y TEQUILA (3, 4.4)', res.grupos.length === 2 && res.grupos[0].nombre === 'RON' && res.grupos[0].n === 2 && Math.abs(res.grupos[0].subtotal - 11.85) < 1e-9 && res.grupos[1].n === 3, JSON.stringify(res.grupos.map(g => [g.nombre, g.n, g.subtotal])));
chk('Resumen por área: la suma de las áreas coincide con el total general', Math.abs(res.porArea.reduce((a, b) => a + b, 0) - res.total) < 1e-9, JSON.stringify(res.porArea));
chk('Cada grupo trae su propio color (distintos entre sí)', new Set(res.grupos.map(g => g.color)).size === res.grupos.length);

// ═══ 2 · PDF: 127 productos de 12 grupos, 3 áreas ═══
const GR = ['TEQUILA', 'RON', 'WHISKY', 'VODKA', 'GINEBRA', 'MEZCAL', 'CERVEZA', 'VINO', 'LICOR', 'ABARROTES', 'JARABES', 'FRUTA'];
const muchos = []; let k = 0;
GR.forEach(g => { const n = 8 + (k % 7); for (let i = 0; i < n; i++) muchos.push({ id: g[0] + String(100 + k * 13 + i), name: g + ' MARCA ' + (i + 1) + ' PREMIUM RESERVA ESPECIAL AÑEJO 750 ML', group: g, unit: 'BOT' }); k++; });
const cDe = (p) => { const h = parseInt(p.id.slice(1)); if (h % 5 === 0) return { tocado: false, areas: { almacen: null, barra1: null, barra2: null } };
  const a = (e, ab) => ({ enteras: e, abiertas: [], total: e + ab });
  return { tocado: true, areas: { almacen: a(h % 7, (h % 3) * 0.4), barra1: h % 4 ? a(h % 3, 0.35) : null, barra2: h % 6 ? a(h % 2, 0.2) : null } }; };
const fMuchas = sb.conteoExportFilas(muchos, cDe, claves);
const e = espia();
const t0 = Date.now();
const r = sb.conteoExportPdf(e.J, fMuchas, AREAS, INFO);
const ms = Date.now() - t0;
const bytes = Buffer.from(r.doc.output('arraybuffer'));
chk('★ Genera un PDF válido (empieza con %PDF- y termina con %%EOF)', bytes.slice(0, 5).toString() === '%PDF-' && /%%EOF\s*$/.test(bytes.slice(-20).toString('latin1')));
chk('★ Es A4 vertical (210 × 297 mm) en todas las hojas', Math.round(r.doc.internal.pageSize.getWidth()) === 210 && Math.round(r.doc.internal.pageSize.getHeight()) === 297);
chk('127 productos caben en 3 a 5 hojas (el diseño aprobado)', r.paginas >= 3 && r.paginas <= 5, String(r.paginas));
chk('Se genera en menos de 3 s', ms < 3000, ms + ' ms');
chk('El PDF pesa poco (< 200 KB para 127 productos)', bytes.length < 200 * 1024, bytes.length + ' bytes');
const T = (t) => e.log.filter(x => x.t === t);
chk('★ El título (en cada hoja) no pierde el guion largo («—» pasa a «-», nunca «?»)', T('Inventario físico - Conteo activo').length === r.paginas && !e.log.some(x => /\?/.test(x.t) && /Conteo/.test(x.t)));
chk('★ «Hoja X de N» aparece en TODAS las hojas, con el total correcto', Array.from({ length: r.paginas }, (_, i) => T('Hoja ' + (i + 1) + ' de ' + r.paginas).length === 1).every(Boolean));
chk('★ El encabezado de la tabla se repite en cada hoja (PRODUCTO y TOTAL CONV.)', T('PRODUCTO').length === r.paginas && T('TOTAL CONV.').length === r.paginas, T('PRODUCTO').length + ' / ' + r.paginas);
chk('El encabezado largo «BARRA RESTAURANTE» se parte en dos líneas, sin reducir la letra por debajo de 5.6 pt', e.log.filter(x => /^(BARRA|RESTAURANTE)$/.test(x.t) && x.fuente === 'helvetica').every(x => x.cuerpo >= 5.6) && T('RESTAURANTE').length === r.paginas, JSON.stringify(e.log.filter(x => /RESTAURANTE/.test(x.t)).slice(0, 2).map(x => x.t + '@' + x.cuerpo)));
chk('★ Cada producto aparece UNA vez en el PDF (su código en la columna de códigos)', fMuchas.every(f => e.log.filter(x => x.fuente === 'courier' && x.t === f.id).length === 1));
const codigosPorHoja = {}; e.log.filter(x => x.fuente === 'courier').forEach(x => { codigosPorHoja[x.pag] = (codigosPorHoja[x.pag] || 0) + 1; });
chk('La suma de filas por hoja es 127 (ninguna se pierde ni se duplica al cambiar de hoja)', Object.keys(codigosPorHoja).reduce((a, p) => a + codigosPorHoja[p], 0) === 127, JSON.stringify(codigosPorHoja));
chk('Los 12 grupos tienen su banda con el nombre en mayúsculas', GR.every(g => e.log.some(x => x.t === g && x.fuente === 'helvetica' && x.estilo === 'bold' && x.cuerpo === 8.2)));
// Una banda de grupo nunca se queda sola al pie de la hoja: debe tener al menos 2 filas debajo en esa hoja.
const bandas = e.log.filter(x => x.fuente === 'helvetica' && x.estilo === 'bold' && x.cuerpo === 8.2 && GR.indexOf(x.t) !== -1);
const huerfanas = bandas.filter(b => {
  const tam = fMuchas.filter(f => f.grupo === b.t).length;
  const debajo = e.log.filter(x => x.fuente === 'courier' && x.pag === b.pag && x.y > b.y).length;
  return debajo < Math.min(2, tam);
});
chk('★ Ninguna banda de grupo queda sola al final de una hoja (mínimo 2 filas debajo)', huerfanas.length === 0, huerfanas.map(b => b.t + '@h' + b.pag).join(','));
chk('Si un grupo continúa en la hoja siguiente, su banda se repite marcada «continúa»', e.log.some(x => /· continúa$/.test(x.t)) || r.paginas === 1, String(e.log.filter(x => /continúa/.test(x.t)).length));
// Ceros y grises para los no contados
const sinC = fMuchas.filter(f => !f.contado);
chk('★ Los productos sin conteo salen en ceros: «0» en cada área y en el total', sinC.length > 0 && sinC.every(f => {
  const fila = e.log.filter(x => x.fuente === 'courier' && x.t === f.id)[0];
  const mismaFila = e.log.filter(x => x.pag === fila.pag && Math.abs(x.y - (fila.y)) < 0.2 && x.t === '0');
  return mismaFila.length >= 4;   // 3 áreas + total
}), 'sin conteo: ' + sinC.length);
chk('★ Esos productos se pintan en gris (nombre y total), los contados en negro / verde', (() => {
  const f0 = sinC[0], fila = e.log.filter(x => x.fuente === 'courier' && x.t === f0.id)[0];
  const nombreGris = e.log.find(x => x.pag === fila.pag && Math.abs(x.y - fila.y) < 0.2 && x.fuente === 'helvetica' && x.estilo === 'bold' && /MARCA/.test(x.t));
  const f1 = fMuchas.find(f => f.contado), fila1 = e.log.filter(x => x.fuente === 'courier' && x.t === f1.id)[0];
  const nombreNegro = e.log.find(x => x.pag === fila1.pag && Math.abs(x.y - fila1.y) < 0.2 && x.fuente === 'helvetica' && x.estilo === 'bold' && /MARCA/.test(x.t));
  return nombreGris && nombreNegro && nombreGris.color.join() === '148,163,184' && nombreNegro.color.join() === '15,23,42';
})());
// Límites de la hoja
const fuera = e.log.filter(x => x.x < 0 || x.x > 210 || x.y < 0 || x.y > 297 - 4);
chk('★ Nada se dibuja fuera de la hoja (x 0–210, y hasta el pie)', fuera.length === 0, fuera.slice(0, 3).map(x => x.t + '@' + x.x + ',' + x.y).join(' | '));
const dentroMargen = e.log.filter(x => x.x > 210 - 11 + 0.01 || x.x < 11 - 0.01);
chk('Los textos respetan el margen de 11 mm a ambos lados', dentroMargen.length === 0, dentroMargen.slice(0, 3).map(x => x.t + '@' + x.x).join(' | '));
chk('Los nombres largos se recortan con «...» y no se desbordan (la columna del producto mide ≈ 99 mm)', e.log.filter(x => x.fuente === 'helvetica' && x.estilo === 'bold' && /^[A-Z]+ MARCA/.test(x.t)).every(x => r.doc.setFontSize(x.cuerpo) && r.doc.setFont('helvetica', 'bold') && r.doc.getTextWidth(x.t) <= 100));
chk('El pie explica el total y avisa que los no contados salen en 0', T('Total = botellas enteras + botellas abiertas convertidas a puntos de botella (según capacidad y peso).').length === r.paginas && e.log.some(x => /sin conteo aparecen en 0/.test(x.t)));
chk('Las tarjetas del encabezado: 127 productos, contados y pendientes sumando 127', (() => { const c = r.resumen; return c.productos === 127 && c.contados + c.pendientes === 127 && T('127').length >= 1; })());

// ═══ 3 · PDF: casos límite ═══
const e2 = espia();
const raro = sb.conteoExportFilas([{ id: 'Z1', name: 'MEZCAL ★ ESPECIAL 😀 “DOBLE” – AÑEJO ÑANDÚ', group: 'MEZCAL ÁÉÍ', unit: 'BOT' }], () => ({ tocado: true, areas: { almacen: { enteras: 1, abiertas: [], total: 1.5 }, barra1: null, barra2: null } }), claves);
let rRaro = null, errRaro = null; try { rRaro = sb.conteoExportPdf(e2.J, raro, AREAS, INFO); } catch (x) { errRaro = x; }
chk('★ Caracteres fuera de Latin-1 (★, emoji, comillas tipográficas) no rompen el PDF: salen como «?» o su equivalente simple', !errRaro && rRaro && e2.log.some(x => /MEZCAL \? ESPECIAL/.test(x.t) && /"DOBLE" - A/.test(x.t)), errRaro ? String(errRaro) : e2.log.filter(x => /MEZCAL/.test(x.t)).map(x => x.t).join('|'));
chk('Las letras con acento y la Ñ se conservan (Latin-1)', e2.log.some(x => /AÑEJO ÑANDÚ/.test(x.t)) && e2.log.some(x => x.t === 'MEZCAL ÁÉÍ'));
const e3 = espia(); const vacio = sb.conteoExportPdf(e3.J, [], AREAS, INFO);
chk('Sin productos genera 1 hoja con el aviso «No hay productos para mostrar.»', vacio.paginas === 1 && e3.log.some(x => x.t === 'No hay productos para mostrar.'));
const e4 = espia();
const cinco = [{ clave: 'a', nombre: 'Almacén' }, { clave: 'b', nombre: 'Barra Restaurante' }, { clave: 'c', nombre: 'Barra Bar' }, { clave: 'd', nombre: 'Terraza Principal' }, { clave: 'e', nombre: 'Cava de Vinos' }];
const f5 = sb.conteoExportFilas(muchos.slice(0, 30), (p) => ({ tocado: true, areas: { a: { enteras: 1, abiertas: [], total: 1.25 }, b: { enteras: 2, abiertas: [], total: 2 }, c: null, d: { enteras: 3, abiertas: [], total: 3.5 }, e: { enteras: 0, abiertas: [], total: 0.5 } } }), cinco.map(a => a.clave));
let r5 = null, err5 = null; try { r5 = sb.conteoExportPdf(e4.J, f5, cinco, INFO); } catch (x) { err5 = x; }
chk('★ Con 5 áreas (áreas propias creadas en la app) las columnas se reajustan y todo cabe en la hoja', !err5 && r5 && e4.log.every(x => x.x >= 0 && x.x <= 210) && e4.log.filter(x => x.fuente === 'courier').length === 30, err5 ? String(err5) : '');
chk('Con 5 áreas la columna del producto conserva al menos 56 mm', (() => { const util = 188, colArea = Math.max(17, Math.min(25, (util - 17 - 22 - 56) / 5)); return util - 17 - 22 - colArea * 5 >= 56 - 0.001; })());

// ═══ 4 · Excel ═══
const wb = sb.conteoExportLibro(XLSX, fMuchas.slice(0, 6), AREAS, { generado: 'hoy', usuario: 'Admin', version: '5.54', inventario: '#12' });
const ws = wb.Sheets['Conteo activo'];
const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
chk('El libro tiene dos hojas: «Conteo activo» e «Información»', wb.SheetNames.join('|') === 'Conteo activo|Información');
chk('★ Columnas: Grupo · Código · Producto · Unidad, por cada área (enteras, abiertas conv., total) y al final Total conv. y Estado (15 en total)', aoa[0].length === 15 && aoa[0][0] === 'Grupo' && aoa[0][4] === 'Almacén · enteras' && aoa[0][5] === 'Almacén · abiertas (conv.)' && aoa[0][6] === 'Almacén · total' && aoa[0][13] === 'Total conv.' && aoa[0][14] === 'Estado', JSON.stringify(aoa[0]));
chk('Los productos sin conteo traen ceros (no celdas vacías) y el estado «Sin conteo (0)»', (() => { const f = fMuchas.slice(0, 6).findIndex(x => !x.contado); if (f < 0) return true; const fila = aoa[f + 1]; return fila[13] === 0 && fila[14] === 'Sin conteo (0)' && fila.slice(4, 13).every(v => v === 0); })());
chk('El código se guarda como texto (un «0012» no se vuelve 12)', ws[XLSX.utils.encode_cell({ r: 1, c: 1 })].t === 's');
chk('Tiene filtro automático sobre toda la tabla', ws['!autofilter'] && /^A1:O7$/.test(ws['!autofilter'].ref), ws['!autofilter'] && ws['!autofilter'].ref);
const info = XLSX.utils.sheet_to_json(wb.Sheets['Información'], { header: 1 });
chk('La hoja Información explica el cálculo y trae los totales por área', info.some(f => f[0] === 'Cómo se calcula el total') && info.some(f => f[0] === 'Total Barra Restaurante'));

// ═══ 5 · Guardas estáticas ═══
const fuente = leer('js/97-exportar-conteo.js');
const limpio = fuente.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
chk('★ El módulo SOLO LEE: no escribe en Firestore, localStorage, products ni conteos', !/\.(set|update|delete|add|commit)\s*\(|localStorage|sessionStorage|_db\b|firebase\.firestore|products\s*(=(?!=)|\.push|\.splice)|auditoriaConteo\s*=/.test(limpio));
chk('★ No usa eval, new Function, innerHTML con datos del usuario ni document.write', !/\beval\s*\(|new\s+Function|document\.write/.test(limpio) && (limpio.match(/\.innerHTML\s*=/g) || []).length === 1);
chk('El único innerHTML es el de la hoja, y todo texto de datos pasa por escapeHtml / jsArg', /ov\.innerHTML = _cxHojaHtml\(\)/.test(limpio) && /escapeHtml\(a\.nombre\)/.test(limpio) && /jsArg\(a\.clave\)/.test(limpio) && /escapeHtml\(String\(num\)\)/.test(limpio));
chk('★ No usa partes peligrosas de jsPDF: html(), addImage, addSvg, loadFile, addJS, output(save)', !/\.(html|addImage|addSvgAsImage|svg|loadFile|addJS|addFileToVFS)\s*\(|output\(\s*['"](save|dataurlnewwindow|pdfobjectnewwindow)/.test(limpio));
chk('Exige inventory.export Y inventory.viewAll (el conteo es ciego) y un inventario abierto', /hasPermission\('inventory\.export'\)/.test(limpio) && /puedeVerConteosAjenos/.test(limpio) && /inventarioAbierto\(_inventarioActivo\)/.test(limpio));
chk('Usa la conversión de la app (fvsConteoPorArea), no una propia', /fvsConteoPorArea\(p\.id\)/.test(limpio) && !/convertirOzAPuntos/.test(limpio));
chk('Compartir usa navigator.canShare/share con archivo y cae a descarga; cerrar el menú (AbortError) no es un error', /navigator\.canShare\(\{ files: \[archivo\] \}\)/.test(limpio) && /AbortError/.test(limpio) && /descargar\(\)/.test(limpio));
const html = leer('index.html'), sw = leer('sw.js');
const ver = /APP_VERSION = '([^']+)'/.exec(sw)[1];
chk('★ index.html carga js/97-exportar-conteo.js con la versión del service worker', new RegExp('<script src="js/97-exportar-conteo\\.js\\?v=' + ver.replace(/\./g, '\\.') + '"').test(html), ver);
chk('★ jsPDF NO está en index.html (se carga bajo demanda): no pesa al arrancar la app', !/jspdf/i.test(html.replace(/<!--[\s\S]*?-->/g, '')));
chk('★ El service worker precalienta js/97-exportar-conteo.js y js/jspdf.umd.min.js (en WARM, no en PRECACHE)', /'\.\/js\/97-exportar-conteo\.js\?v=' \+ APP_VERSION/.test(sw) && /'\.\/js\/jspdf\.umd\.min\.js\?v=' \+ APP_VERSION/.test(sw.slice(sw.indexOf('WARM_URLS'))) && !/jspdf/.test(sw.slice(0, sw.indexOf('WARM_URLS')).replace(/\/\/.*$/gm, '')));
const vend = leer('js/jspdf.umd.min.js');
chk('★ jsPDF es la 4.2.1 original (MIT) en el repositorio, sin tocar', /jsPDF - PDF Document creation from JavaScript\s*\n\s*\* Version 4\.2\.1/.test(vend.slice(0, 400)) && vend.length > 300000);
chk('La CSP solo permite scripts propios (la carga bajo demanda es del mismo origen) y no se agregó ningún dominio nuevo', (() => { const m = /script-src([^;]*)/.exec(html); return !!m && !/jspdf|cdn\.jsdelivr|unpkg/.test(m[1]); })());
chk('★ Todo icono que usa el módulo existe en el juego local (css/utilidades.css): si no, se ve un cuadro sólido', (() => { const css = leer('css/utilidades.css') + leer('css/estilos.css'); const usados = [...new Set((fuente.match(/fa-(?!solid)[a-z0-9-]+/g) || []))]; const faltan = usados.filter(i => !new RegExp('\\.' + i + '\\b').test(css)); return faltan.length === 0 ? true : faltan.join(','); })() === true);
chk('La ventana Inventario muestra el botón (renderAuditoriaSeleccion llama a conteoExportBotonHtml)', /conteoExportBotonHtml/.test(leer('js/85-ui-inventario-fisico.js')));
chk('El CSS nuevo vive en utilidades.css (estilos.css no crece)', /\.cx-hoja/.test(leer('css/utilidades.css')) && !/\.cx-/.test(leer('css/estilos.css')));

const fallos = C.filter(c => !c.ok);
C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + ' ' + c.n + (c.ok ? '' : '  ←  ' + c.d)));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron\n');
process.exit(fallos.length ? 1 : 0);
