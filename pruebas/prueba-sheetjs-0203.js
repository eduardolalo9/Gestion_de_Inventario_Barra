// SheetJS 0.20.3 propio (js/xlsx.full.min.js, v5.49) — integridad, carga y comportamiento con datos FICTICIOS.
//   node pruebas/prueba-sheetjs-0203.js
// Usa el MISMO archivo que carga la app (js/xlsx.full.min.js) y las funciones REALES de
// exportación, plantillas y fechas de la app. No escribe nada fuera de la carpeta temporal del sistema.
// Cubre: integridad, CSP, Service Worker, NaN, Infinity, nulos, numéricos inválidos, fechas de Compras
// en CSV, lectura y escritura XLSX, importación XLS, exportación de Existencias, primera fila congelada,
// plantillas, valores y formatos.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto'), { spawnSync } = require('child_process');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d === undefined ? '' : String(d) });
const NOVERIF = [];
function funcion(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    const m = /\n        (?:async )?function /.exec(src.slice(ini + 10));
    return m ? src.slice(ini, ini + 10 + m.index) : src.slice(ini);
}
const VERSION = '0.20.3';
const SHA256_REF = 'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41';
const RUTA = 'js/xlsx.full.min.js';   // v5.49 — copia propia (mismo origen); la carga y el CSP los cubre también prueba-v549-sheetjs.js
const idx = leer('index.html'), sw = leer('sw.js');
const VER_APP = (/APP_VERSION = '([^']+)'/.exec(sw) || [])[1] || '';

// ═══ 1 · Integridad y carga ══════════════════════════════════════════════
const bin = fs.readFileSync(path.join(RAIZ, RUTA));
const sha256 = crypto.createHash('sha256').update(bin).digest('hex');
chk('★ js/xlsx.full.min.js = la copia verificada de 0.20.3 (SHA-256 de referencia, 951,904 bytes)', sha256 === SHA256_REF && bin.length === 951904, sha256 + ' · ' + bin.length);
chk('El archivo no tiene CR (la regla eol=lf no lo altera en ningún checkout)', !bin.includes(13), 'CR: ' + bin.filter(b => b === 13).length);
const tag = (/<script[^>]*src="js\/xlsx\.full\.min\.js[^"]*"[^>]*><\/script>/.exec(idx) || [''])[0];
chk('★ index.html carga SheetJS desde el propio origen, con la versión de la app y defer', tag.indexOf('src="' + RUTA + '?v=' + VER_APP + '"') !== -1 && /\sdefer\b/.test(tag), tag);
chk('★ Ya no se pide SheetJS a cdnjs ni a ningún CDN', !/<script[^>]*src="https?:\/\/[^"]*xlsx/i.test(idx) && !/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx/.test(idx));
const csp = (/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(idx) || [, ''])[1];
const scriptSrc = (/script-src([^;]*)/.exec(csp) || [, ''])[1];
chk('CSP: script-src sin cdnjs y sin «unsafe-inline» (v5.57), con «self» para la copia local', scriptSrc && !/cdnjs/.test(scriptSrc) && !/unsafe-inline/.test(scriptSrc) && /'self'/.test(scriptSrc), scriptSrc.trim());
const warm = (/const\s+WARM_URLS\s*=\s*\[([\s\S]*?)\]/.exec(sw) || [, ''])[1], pre = (/const\s+PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/.exec(sw) || [, ''])[1];
chk('★ Service Worker: la biblioteca se calienta con la misma URL que pide la página (WARM_URLS + ?v=)', warm.indexOf("'./" + RUTA + "?v=' + APP_VERSION") !== -1);
chk('No entra en PRECACHE_URLS (camino crítico atómico, sin los ~950 KB)', pre.indexOf('xlsx') === -1);
let X = null;
try { X = require(path.join(RAIZ, RUTA)); } catch (e) { X = null; }
chk('★ El archivo se carga y es la versión ' + VERSION, X && X.version === VERSION, X && X.version);
if (!X) { console.log('  ❌ No se pudo cargar ' + RUTA); process.exit(1); }
const API = ['read', 'write', 'writeFile', 'CFB.read', 'CFB.find', 'CFB.write', 'utils.book_new', 'utils.book_append_sheet', 'utils.aoa_to_sheet',
             'utils.sheet_to_json', 'utils.encode_cell', 'utils.encode_range', 'utils.decode_range'];
const falta = API.filter(a => typeof a.split('.').reduce((o, k) => o && o[k], X) !== 'function');
chk('Las funciones de SheetJS que usa la app existen', falta.length === 0, falta.join(', '));

const libro = (aoa, nombre) => { const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), nombre || 'H'); return wb; };
const ida = (wb, op) => X.read(new Uint8Array(X.write(wb, Object.assign({ bookType: 'xlsx', type: 'array', compression: true }, op || {}))), { type: 'array', cellNF: true });
const xmlHoja = (bytes, i) => { const z = X.CFB.read(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { type: 'array' }); const f = X.CFB.find(z, '/xl/worksheets/sheet' + i + '.xml'); return f ? Buffer.from(f.content).toString('utf8') : ''; };

// ═══ 2 · NaN, Infinity, nulos y numéricos inválidos ══════════════════════
// Regla: nunca convertir en 0 lo que no es un número. 0.20.3 escribe NaN/±Infinity como celda de ERROR visible
// en Excel (#VALUE!/#DIV/0!), en lugar del «NaN» inválido de 0.18.5; nulos quedan vacíos; texto no numérico sigue texto.
{
    const ws = ida(libro([['v'], [NaN], [Infinity], [-Infinity], [null], [undefined], [''], ['abc'], ['12,5'], ['1e999'], [0], [-0.5]])).Sheets.H;
    chk('★ NaN se escribe como celda de ERROR visible (#VALUE!), no como 0 ni como número inválido', ws.A2 && ws.A2.t === 'e' && ws.A2.v !== 0 && ws.A2.w === '#VALUE!', JSON.stringify(ws.A2));
    chk('★ Infinity y −Infinity se escriben como celda de ERROR (#DIV/0!), no como 0', ['A3', 'A4'].every(r => ws[r] && ws[r].t === 'e' && ws[r].w === '#DIV/0!'), JSON.stringify([ws.A3, ws.A4]));
    chk('★ null y undefined NO crean celda (vacío, nunca 0)', !ws.A5 && !ws.A6, JSON.stringify([ws.A5, ws.A6]));
    chk('Cadena vacía queda como texto vacío (no 0)', ws.A7 && ws.A7.t === 's' && ws.A7.v === '', JSON.stringify(ws.A7));
    chk('★ Numéricos inválidos («abc», «12,5», «1e999») siguen siendo TEXTO, sin convertirse en número ni en 0', ['A8', 'A9', 'A10'].every(r => ws[r] && ws[r].t === 's') && ws.A8.v === 'abc' && ws.A9.v === '12,5' && ws.A10.v === '1e999');
    chk('0 y −0.5 se conservan como números exactos', ws.A11.t === 'n' && ws.A11.v === 0 && ws.A12.t === 'n' && ws.A12.v === -0.5);
    const json = X.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });
    chk('★ Al releer, ninguna celda inválida aparece como 0', json.slice(1, 7).every(r => r[0] !== 0), JSON.stringify(json.slice(1, 7)));
}

// ═══ 3 · Exportadores reales de la app (js/97 y js/73) con valores difíciles ═══
const ctxE = { console, TextDecoder, TextEncoder, Uint8Array, Math, Date, String, Number, Array, Object, JSON, isFinite, parseFloat };
ctxE.window = ctxE; vm.createContext(ctxE);
for (const f of ['js/97-exportar-existencias.js', 'js/97-exportar-diferencias.js', 'js/73-pedido-sugerido.js']) vm.runInContext(leer(f), ctxE, { filename: f });
const filasEx = [
    { grupo: 'TEQUILA', id: '0012', descripcion: 'TEQUILA FICTICIO 750 ML', unidad: 'Botellas', existencia: 3.25 },
    { grupo: 'RON', id: 'R-1', descripcion: 'RON DE PRUEBA «añejo» ñ €', unidad: 'Botellas', existencia: -1.5 },
    { grupo: 'General', id: '7', descripcion: 'SIN CIFRA (no numérica)', unidad: 'Piezas', existencia: null },
    { grupo: 'VODKA', id: '00099', descripcion: 'X'.repeat(300), unidad: 'Litros', existencia: 0 },
    { grupo: 'CERVEZA', id: '1e3', descripcion: '=SUMA(A1:A2)', unidad: 'Piezas', existencia: 123456789.125 }
];
const infoEx = { generado: '2026-11-25 10:00', usuario: 'prueba', version: '5.41', fuente: 'oficial', corte: 'Ficticio', avisos: [{ texto: 'Aviso ficticio', grave: true }] };
{
    const wb = ctxE.existenciasExportLibro(X, filasEx, infoEx);
    const bytes = X.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
    const fijo = ctxE.existenciasExportCongelar(X, bytes, 3);
    const r = X.read(new Uint8Array(fijo || bytes), { type: 'array', cellNF: true, cellStyles: true });   // cellStyles: así se leen los anchos (!cols)
    const ws = r.Sheets['Existencias'];
    const aoa = X.utils.sheet_to_json(ws, { header: 1, defval: null });
    chk('★ Existencias: libro con las 3 hojas (Existencias, Auditoría, Información)', JSON.stringify(r.SheetNames) === JSON.stringify(['Existencias', 'Auditoría', 'Información']), r.SheetNames.join('|'));
    chk('★ Existencias: encabezados exactos y una fila por producto', JSON.stringify(aoa[0]) === JSON.stringify(vm.runInContext('EXISTENCIAS_EXPORT_COLUMNAS', ctxE)) && aoa.length === 6, JSON.stringify(aoa[0]));
    chk('★ Existencias: ID «0012», «00099» y «1e3» siguen como TEXTO (no 12, 99 ni 1000)', ['0012', '00099', '1e3'].every(id => { const i = aoa.findIndex(x => x[1] === id); return i > 0 && ws['B' + (i + 1)].t === 's'; }));
    chk('★ Existencias: la cifra no numérica queda VACÍA (no 0); negativos y cero se conservan', aoa[3][4] === null && aoa[2][4] === -1.5 && aoa[4][4] === 0 && aoa[5][4] === 123456789.125, JSON.stringify(aoa.slice(1).map(x => x[4])));
    chk('Existencias: «=SUMA(...)» llega como texto, no como fórmula', !ws['C6'].f && ws['C6'].v === '=SUMA(A1:A2)');
    chk('★ Primera fila congelada en las 3 hojas (pane ySplit=1 frozen)', !!fijo && [1, 2, 3].every(i => /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/.test(xmlHoja(fijo, i))));
    chk('Existencias: filtros de Excel y anchos de columna', ws['!autofilter'] && ws['!autofilter'].ref === 'A1:E6' && Array.isArray(ws['!cols']) && ws['!cols'].length === 5, JSON.stringify(ws['!autofilter']));
}
{   // Físico vs Sistema y Pedido sugerido: precio inválido vacío, fórmula y formatos
    const filasFvs = [{ grupo: 'TEQUILA', id: 'A', descripcion: 'TEQUILA A', unidad: 'Botellas', sistema: 10, contada: 6, diferencia: -4, precio: 100, total: -400, estado: 'contado', sinContar: false },
                      { grupo: 'RON', id: '0012', descripcion: 'RON 0012', unidad: 'Botellas', sistema: 2, contada: 3.25, diferencia: 1.25, precio: null, total: null, estado: 'contado', sinContar: false }];
    const b1 = X.write(ctxE.fvsExportLibro(X, filasFvs, { generado: 'hoy', usuario: 'p', version: '5.41', inventario: '#7', alcance: 'Todos', orden: 'x', sinInicial: 0 }), { bookType: 'xlsx', type: 'array', compression: true });
    const f1 = ctxE.existenciasExportCongelar(X, b1, 1); const w1 = X.read(new Uint8Array(f1), { type: 'array', cellNF: true }).Sheets['Diferencias'];
    chk('★ Físico vs Sistema: precio inválido → Precio y Precio total VACÍOS (no 0); fila fija', !w1.H3 && !w1.I3 && w1.G3.v === 1.25 && /state="frozen"/.test(xmlHoja(f1, 1)));
    chk('Físico vs Sistema: formatos de cantidad, diferencia con signo y moneda se conservan', /0\.00#/.test(w1.E2.z) && /^\+/.test(w1.G2.z) && /\$/.test(w1.I2.z), [w1.E2.z, w1.G2.z, w1.I2.z].join(' | '));
    const filasPs = [{ grupo: 'TEQUILA', id: '0012', descripcion: 'TEQUILA PS', unidad: 'Botellas', proveedor: 'P', existencia: 1, minimo: 4, sugerido: 3, cantidad: 3, precio: 307, total: 921 },
                     { grupo: 'RON', id: 'B', descripcion: 'RON PS', unidad: 'Botellas', proveedor: '', existencia: null, minimo: null, sugerido: 2.5, cantidad: 2.5, precio: null, total: null }];
    const b2 = X.write(ctxE.pedidoSugeridoExportLibro(X, filasPs, { generado: 'hoy', usuario: 'p', version: '5.41' }), { bookType: 'xlsx', type: 'array', compression: true });
    const w2 = X.read(new Uint8Array(b2), { type: 'array', cellNF: true });
    const s2 = w2.Sheets[w2.SheetNames[0]];
    const tot = Object.keys(s2).find(k => s2[k] && s2[k].f && /^SUM\(/.test(s2[k].f));
    chk('★ Pedido sugerido: total con fórmula SUM y valor 921; existencia y mínimo nulos quedan VACÍOS', !!tot && s2[tot].v === 921 && !s2.F3 && !s2.G3, tot + ' ' + JSON.stringify(tot && s2[tot]));
}
{   // Control de negativos (js/94): si un NaN llegara al exportador, sale como ERROR visible, nunca como 0
    const ctxN = Object.assign({}, ctxE); ctxN.window = ctxN; vm.createContext(ctxN);
    vm.runInContext(leer('js/97-exportar-existencias.js'), ctxN); vm.runInContext(leer('js/94-control-negativos.js'), ctxN);
    let bytesCN = null;
    Object.assign(ctxN, { XLSX: X, hasPermission: () => true, showNotification: () => {}, _fvsDescargar: (b) => { bytesCN = b; }, anclaEtiqueta: () => 'Corte ficticio' });
    ctxN._cnDatos = () => ({ filas: [{ grupo: 'G', id: '0012', nombre: 'INSUMO FICTICIO', unidad: 'PZA', total: NaN, consumo: 2, compras: 1, promedio: Infinity, estado: 'negativo', desde: '2026-11-20', pendiente: 3, precio: null, valor: 30 }],
        ancla: { fecha: '2026-11-15' }, diasCubiertos: 5, diasEsperados: 7, resumen: { negativos: 1, valorPendiente: 30 } });
    let res = null; try { res = vm.runInContext('controlNegativosExportarExcel()', ctxN); } catch (e) { res = { error: e.message }; }
    if (!bytesCN) { chk('Control de negativos: exporta con datos ficticios', false, JSON.stringify(res)); }
    else {
        const w = X.read(new Uint8Array(bytesCN), { type: 'array' }).Sheets['Control de negativos'];
        chk('★ Control de negativos: un Total NaN sale como ERROR visible (no 0) y un consumo diario Infinity también', w.E2 && w.E2.t === 'e' && w.H2 && w.H2.t === 'e', JSON.stringify([w.E2, w.H2]));
        chk('Control de negativos: precio nulo queda vacío; ID «0012» como texto; fila fija', !w.L2 && w.B2.t === 's' && w.B2.v === '0012' && /state="frozen"/.test(xmlHoja(bytesCN, 1)));
    }
    chk('Control de negativos: la regla de cálculo existente (_cnRed) convierte lo no numérico ANTES de exportar (sin cambios)', /function _cnRed\(n\) \{ var x = Number\(n\); return isFinite\(x\) \? Math\.round\(x \* 1000\) \/ 1000 : 0; \}/.test(leer('js/94-control-negativos.js')));
}

// ═══ 4 · Lectura y escritura XLSX · valores y formatos ═══════════════════
{
    const FMT = ['0.00', '#,##0.00#;-#,##0.00#;0.00', '+#,##0.00#;-#,##0.00#;0.00', '"$"#,##0.00;-"$"#,##0.00;"$"0.00'];
    const ws0 = X.utils.aoa_to_sheet([['n', 'f1', 'f2', 'f3', 'f4', 'texto'], [0.1 + 0.2, 1234.5, -0.25, 3, 24774.5, '0012'], [123456789012.345, 0, 2.5, -1.5, 307, 'ñ € «» 🍺']]);
    ['B2', 'C2', 'D2', 'E2'].forEach((r, i) => { ws0[r].z = FMT[i]; });
    ws0.G2 = { t: 's', v: 'L'.repeat(32767) }; ws0['!ref'] = 'A1:G3';   // 32,767 = límite de Excel por celda
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws0, 'H');
    const ws = ida(wb).Sheets.H;
    chk('★ XLSX: números exactos (0.1+0.2, grandes) tras escribir y leer', ws.A2.v === 0.1 + 0.2 && ws.A3.v === 123456789012.345);
    chk('★ XLSX: los 4 formatos numéricos de la app se conservan', ['B2', 'C2', 'D2', 'E2'].every((r, i) => ws[r].z === FMT[i]), ['B2', 'C2', 'D2', 'E2'].map(r => ws[r].z).join(' | '));
    chk('XLSX: texto mostrado de moneda y signo', ws.E2.w === '$24,774.50' && ws.D2.w === '+3.00', ws.E2.w + ' ' + ws.D2.w);
    chk('XLSX: «0012» y unicode como texto; texto de 32,767 caracteres (límite de Excel) completo', ws.F2.v === '0012' && ws.F3.v === 'ñ € «» 🍺' && ws.G2.v.length === 32767);
    let largo = null; try { X.write(libro([['L'.repeat(32768)]]), { bookType: 'xlsx', type: 'array' }); largo = 'sin error'; } catch (e) { largo = String(e.message || e); }
    chk('XLSX: un texto de más de 32,767 caracteres da ERROR controlado (no se recorta en silencio; igual que 0.18.5)', /must not exceed 32767/.test(largo), largo);
    chk('XLSX: rango y codificación de celdas', ws['!ref'] === 'A1:G3' && X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 6, c: 8 } }) === 'A1:I7' && X.utils.encode_cell({ r: 1048575, c: 16383 }) === 'XFD1048576');
}

// ═══ 5 · Importación XLS (BIFF8) y XLSX con el mismo flujo de los importadores ═══
{
    const aoa = [['ID', 'Producto', 'Cantidad', 'Costo', ' Grupo '], ['0012', 'TEQUILA', 2, 307.5, 'TEQUILA'], [12, 'RON', '3', '', ''], [], ['A-1', 'VODKA ñ', -1, 'abc', 'VODKA']];
    for (const bt of ['xls', 'biff8', 'xlsx']) {
        const by = X.write(libro(aoa, 'Hoja1'), { bookType: bt, type: 'array' });
        const wb = X.read(new Uint8Array(by), { type: 'array' });
        const def = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]), dv = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        chk('★ Importar .' + bt + ': filas, tipos y texto «0012» como los lee la app (sheet_to_json y defval "")',
            def.length === 3 && def[0].ID === '0012' && def[0].Cantidad === 2 && def[1].Cantidad === '3' && def[2].Costo === 'abc' && dv[1].Costo === '' && dv[0][' Grupo '] === 'TEQUILA',
            JSON.stringify(def));
    }
}

// ═══ 6 · Fechas de Compras en CSV (js/88 _fechaExcelAISO real) ═══════════
{
    const src15 = leer('js/15-ciclo-semanal.js'), src88 = leer('js/88-compras.js');
    const ctxF = { Math, Date, String, Number, isFinite, parseFloat, isNaN }; vm.createContext(ctxF);
    vm.runInContext(funcion(src15, 'fechaISOLocal') + '\n' + funcion(src88, '_numeroExcel') + '\n' + funcion(src88, '_fechaExcelAISO'), ctxF);
    const csv = 'Folio,Fecha,Cantidad\nF-1,2026-11-24,6\nF-2,2026-01-05,1\nF-3,2026-12-31,2\n';
    const filas = X.utils.sheet_to_json(X.read(new TextEncoder().encode(csv), { type: 'array' }).Sheets.Sheet1);
    const fechas = filas.map(f => ctxF._fechaExcelAISO(f.Fecha));
    chk('★ CSV de Compras: la fecha 2026-11-24 entra como 2026-11-24 (con 0.18.5 entraba un día antes)', fechas[0] === '2026-11-24', JSON.stringify(filas.map(f => f.Fecha)) + ' → ' + JSON.stringify(fechas));
    chk('★ CSV de Compras: cambio de año y fin de año sin desplazamiento', fechas[1] === '2026-01-05' && fechas[2] === '2026-12-31', JSON.stringify(fechas));
    // La misma lectura en otras zonas horarias (proceso aparte con TZ); en Windows depende del soporte de ICU.
    const hijo = 'const X=require(process.argv[1]);const t=new TextEncoder().encode("Fecha\\n2026-11-24\\n2026-01-05\\n");'
        + 'const f=X.utils.sheet_to_json(X.read(t,{type:"array"}).Sheets.Sheet1).map(r=>{const d=new Date(Date.UTC(1899,11,30)+r.Fecha*86400000);return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")+"-"+String(d.getUTCDate()).padStart(2,"0");});'
        + 'console.log(JSON.stringify({tz:Intl.DateTimeFormat().resolvedOptions().timeZone,f}));';
    const zonas = ['America/Mexico_City', 'UTC', 'Asia/Tokyo'], vistas = [];
    for (const tz of zonas) {
        const r = spawnSync(process.execPath, ['-e', hijo, path.join(RAIZ, RUTA)], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
        try { vistas.push(JSON.parse(r.stdout.trim())); } catch (_) { vistas.push({ tz: '?', f: [], err: (r.stderr || '').slice(0, 80) }); }
    }
    if (vistas.some(v => v.tz !== zonas[vistas.indexOf(v)])) NOVERIF.push('Fechas CSV en otras zonas horarias (este Node no aplica TZ): ' + JSON.stringify(vistas.map(v => v.tz)));
    else chk('CSV de Compras: misma fecha en Ciudad de México, UTC y Tokio', vistas.every(v => JSON.stringify(v.f) === '["2026-11-24","2026-01-05"]'), JSON.stringify(vistas));
    // XLSX con la fecha como texto ISO (como la plantilla) y como serial entero (como Excel)
    const wsF = ida(libro([['Fecha'], ['2026-11-24'], [46350]])).Sheets.H;
    chk('XLSX de Compras: texto ISO y serial entero de Excel dan la misma fecha', ctxF._fechaExcelAISO(wsF.A2.v) === '2026-11-24' && ctxF._fechaExcelAISO(wsF.A3.v) === '2026-11-24', [wsF.A2.v, wsF.A3.v].join(' / '));
}

// ═══ 7 · Plantillas reales (js/96) en .xlsx y .csv ═══════════════════════
{
    const c96 = { console, Math, Date, String, Number, Array, Object, JSON, isFinite, parseFloat, fechaISOLocal: (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };
    c96.window = c96; vm.createContext(c96);
    try { vm.runInContext(leer('js/96-importar.js'), c96, { filename: 'js/96-importar.js' }); } catch (_) {}
    const prods = [{ id: '0012', name: 'TEQUILA FICTICIO 750 ML', group: 'TEQUILA', unit: 'Botellas', precio: 307, conversion: 750, stockMinimo: 2, proveedor: 'PROV X', pv: 'PV1', capacidadMl: 750, pesoBotellaLlenaOz: 42.5, conteoOzHabilitado: true },
                   { id: 'R-1', name: 'RON «ñ»', group: 'RON', unit: 'Piezas' }];
    const areas = [{ id: 'almacen', nombre: 'Almacén' }, { id: 'barra1', nombre: 'Barra 1' }, { id: 'barra2', nombre: 'Barra 2' }];
    if (typeof c96.importarPlantilla !== 'function') NOVERIF.push('Plantillas (importarPlantilla no se pudo cargar sin el resto de la app)');
    else for (const sec of ['catalogo', 'existencias', 'recetas', 'compras', 'ventas']) {
        const pl = c96.importarPlantilla(sec, prods, areas);
        const wb = X.utils.book_new(); const h = X.utils.aoa_to_sheet([pl.cabeceras].concat(pl.filas));
        X.utils.book_append_sheet(wb, h, pl.hoja); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Instrucciones']].concat(pl.instrucciones.map(t => [t]))), 'Instrucciones');
        const r = ida(wb), filas = X.utils.sheet_to_json(r.Sheets[pl.hoja], { header: 1, defval: '' });
        const esperado = [pl.cabeceras].concat(pl.filas).map(f => f.map(v => v === undefined || v === null ? '' : v));
        const csvFilas = X.utils.sheet_to_json(X.read(new TextEncoder().encode(c96.importarPlantillaCsv(pl)), { type: 'array' }).Sheets.Sheet1, { header: 1, defval: '' });
        chk('★ Plantilla «' + sec + '»: .xlsx con hoja e Instrucciones; celdas idénticas al releer; el .csv trae las mismas cabeceras y filas',
            JSON.stringify(r.SheetNames) === JSON.stringify([pl.hoja, 'Instrucciones']) && JSON.stringify(filas) === JSON.stringify(esperado)
            && JSON.stringify(csvFilas[0]) === JSON.stringify(pl.cabeceras) && csvFilas.length === esperado.length,
            JSON.stringify(filas[1]).slice(0, 160));
    }
}

// ═══ 8 · Archivos dañados: error controlado, sin bloquear ═════════════════
{
    const malos = { 'vacío': new Uint8Array(0), 'zip truncado': new Uint8Array(X.write(libro([['a'], [1]]), { bookType: 'xlsx', type: 'array' })).slice(0, 200), 'cabecera PK': new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]) };
    const r = {};
    for (const [n, b] of Object.entries(malos)) { const t0 = Date.now(); try { X.read(b, { type: 'array' }); r[n] = 'libro'; } catch (e) { r[n] = 'error'; } r[n] += ' ' + (Date.now() - t0) + 'ms'; }
    chk('Archivos vacíos o dañados: terminan (error o libro vacío) en menos de 3 s, como antes', Object.values(r).every(v => parseInt(v.split(' ')[1], 10) < 3000), JSON.stringify(r));
    chk('Leer todo lo anterior no añadió propiedades a Object.prototype', Object.getOwnPropertyNames(Object.prototype).every(k => ['constructor', '__defineGetter__', '__defineSetter__', 'hasOwnProperty', '__lookupGetter__', '__lookupSetter__', 'isPrototypeOf', 'propertyIsEnumerable', 'toString', 'valueOf', '__proto__', 'toLocaleString'].includes(k)));
}

let mal = 0;
console.log('\n  ── SheetJS 0.20.3 alojado en el proyecto: integridad, valores, fechas, Excel de la app ──\n');
C.forEach(c => { console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '  → ' + c.d)); if (!c.ok) mal++; });
NOVERIF.forEach(n => console.log('  ⚪  NO VERIFICADO: ' + n));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron' + (NOVERIF.length ? ' · ' + NOVERIF.length + ' sin verificar' : '') + '\n');
process.exit(mal ? 1 : 0);
