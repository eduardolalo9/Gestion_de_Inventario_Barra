// v5.61 — Ventas, Pedido sugerido y Control de negativos (estática).
//   node pruebas/prueba-v561-modulos.js
// Lo que cambió es la PRESENTACIÓN: selector de periodo único, «Ordenar por ▾», proveedor en su línea,
// tabla de escritorio, Exportar en el ⋮ y pesos con 2 decimales. Esta prueba fija además que los
// CÁLCULOS, el orden, la selección, la generación del pedido y las EXPORTACIONES son el mismo código
// que en v5.60: huella SHA-256 del texto de cada función (37 funciones).
// La medición real en Chromium es prueba-v561-modulos-navegador.js.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d === undefined ? '' : String(d).slice(0, 300) });
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const s73 = leer('js/73-pedido-sugerido.js'), s93 = leer('js/93-ventas.js'), s94 = leer('js/94-control-negativos.js'), s94t = leer('js/94-venta-turno.js'),
      dens = leer('css/densidad.css'), util = leer('css/utilidades.css'), esti = leer('css/estilos.css'), idx = leer('index.html'), sw = leer('sw.js'),
      t537 = leer('pruebas/prueba-v537-navegador.js');

// ── Versión ──
const ver = (/const APP_VERSION = '([\d.]+)'/.exec(sw) || [])[1];
chk('★ APP_VERSION 5.61 y los ?v= de index.html iguales', ver === '5.61' && (idx.match(/\?v=5\.61\b/g) || []).length >= 50 && !/\?v=(?!5\.61\b)[\d.]+/.test(idx), ver);

// ── Cálculos y exportaciones: el mismo código que v5.60 ──
const extraer = (src, n) => { const i = src.indexOf('function ' + n + '('); if (i < 0) return null; const j = src.indexOf('\n        }\n', i); return src.slice(i, j + 10); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const HUELLAS_V560 = {
  'js/73-pedido-sugerido.js': { pedidoSugeridoConteoTotal: '3e532c8511275cf9', pedidoSugeridoFilas: 'cd8909fdddf7ab8e', pedidoSugeridoOrdenar: 'e90d351dc469d631', _psCantidad: '7c0c3b35fef2fb53',
    pedidoSugeridoResumen: '576e1cb9c7d3987c', _psFilasBase: '8b235289161b29d7', _psInicializarSeleccion: '80f6b49abbeddc92', _psFiltradas: 'b9f42a66310f550f', pedidoSugeridoExportNombre: 'e006991c168aabfa',
    pedidoSugeridoExportFilas: '880737d796fc1745', pedidoSugeridoExportLibro: '7b31fdaca28f4ccb', _psPuedeExportar: '4718a64f89c004e8', exportarPedidoSugeridoExcel: '19b1bc30dc7b7b57',
    pedidoSugeridoGenerar: '96d187f6e001967e', _psEstado: '145c6f119d90e7f2' },
  'js/93-ventas.js': { ventasResumen: 'd9dcca464c30acac', ventasTopProductos: 'f8a6e49adf400640', ventasRangoMes: 'ac18faaafc63e14b', ventasEtiquetaCorta: '6fd31506757802b8', _vsDatos: '084d4b588b8824fc',
    _vsCargar: '0f20b8f59abf3c5b', ventasMoverPeriodo: 'bdf11b38f7b652ef', ventasVerSemanaActiva: 'c69172856a0191b7', ventasVerSemanaAnterior: 'c863daf7b5bc0d89', ventasVerMes: 'cac5bbd5a314cdab',
    ventasExportarExcel: '433ef068d7c29a7e', _vsSemanaVista: 'a0b0576ddd367624', _vsEsActiva: '0e8e8fa0b5e2e292', _vsClave: 'dbf3c144b7eadebc' },
  'js/94-control-negativos.js': { controlNegativosCalcular: 'e94f4a6bb406d8a0', controlNegativosEtiqueta: '82c5fa2e03452eae', _cnPuede: '2fedbe896ff996c3', _cnDatos: '8c4094350b7aed97',
    controlNegativosConteo: '057dac9c9ebf7dfd', controlNegativosVerRecetas: '1331e64afc27e21e', controlNegativosCapturarCompra: 'efb2b53a0d0cc95c', controlNegativosExportarExcel: '2312ecc2f6824468' }
};
const fuentes = { 'js/73-pedido-sugerido.js': s73, 'js/93-ventas.js': s93, 'js/94-control-negativos.js': s94 };
const distintas = [];
let total = 0;
for (const [f, mapa] of Object.entries(HUELLAS_V560)) for (const [n, h] of Object.entries(mapa)) { total++; const t = extraer(fuentes[f], n); if (!t || sha(t) !== h) distintas.push(f + ' ' + n); }
chk('★ Cálculos, orden, selección, generar pedido y las 3 exportaciones: el MISMO código que v5.60 (' + total + ' funciones, huella SHA-256)', total === 37 && distintas.length === 0, distintas.join(' | '));
chk('Columnas de los Excel sin cambios (Pedido sugerido 11, Control de negativos 13)',
    /var PS_EXPORT_COLUMNAS = \['Grupo', 'ID', 'Descripción', 'Unidad', 'Proveedor', 'Existencia', 'Stock mínimo',\s*'Pedido sugerido', 'Cantidad a pedir', 'Precio', 'Total estimado'\];/.test(s73)
    && /var CN_EXPORT_COLUMNAS = \['Grupo', 'ID', 'Insumo', 'Unidad', 'Total', 'Consumo desde el corte', 'Compras desde el corte',\s*'Consumo diario', 'Estado', 'Negativo desde', 'Pendiente', 'Precio', 'Valor pendiente'\];/.test(s94));

// ── Ventas ──
const pills = extraer(s93, '_vsPeriodoPills') || '';
chk('★ Ventas: selector único «Semana | Mes» (segmentado fvs-tabs con aria-pressed) + flechas; sin «Semana anterior» ni la pill central',
    /fvs-tabs vs-seg" role="group"/.test(pills) && /aria-pressed="' \+ on \+ '"/.test(pills) && /onclick="ventasVerVista\(\\'' \+ jsArg\(v\) \+ '\\'\)"/.test(pills)
    && /ventasMoverPeriodo\(-1\)/.test(pills) && /ventasMoverPeriodo\(1\)/.test(pills) && !/Semana anterior<|ventasVerSemanaAnterior\(\)|vs-pills|mc-pill/.test(pills));
chk('Ventas: el periodo se anuncia (role="status" aria-live) con su nombre completo y dice si es la semana activa', /<p class="vs-periodo__actual" role="status" aria-live="polite" aria-label="' \+ escapeHtml\(completa\)/.test(pills) && /'Semana activa'/.test(pills) && /'Solo consulta'/.test(pills));
chk('Ventas: ventasVerVista solo cambia de vista con las funciones de siempre (Mes → ventasVerMes, Semana → ventasVerSemanaActiva)', (() => { const f = extraer(s93, 'ventasVerVista') || ''; return /ventasVerMes\(\)/.test(f) && /ventasVerSemanaActiva\(\)/.test(f) && !/_vs\.(semana|mes) =/.test(f) && /window\.ventasVerVista = ventasVerVista;/.test(s93); })());
chk('Ventas: se conservan ventasVerSemanaAnterior y ventasVerMes (compatibilidad)', /window\.ventasVerSemanaAnterior = ventasVerSemanaAnterior;/.test(s93) && /window\.ventasVerMes = ventasVerMes;/.test(s93));
chk('Ventas: un «—» siempre dice por qué', /'el reporte no trae importe'/.test(s93) && /'sin artículos cobrados'/.test(s93));
chk('Ventas: lugar en el top y parte de la venta, del periodo completo (no de la lista filtrada)', /var totalVenta = ventasResumen\(base\)\.ventaNeta;/.test(s93) && /_vsFila\(l, orden\[l\.sku\] \+ 1, totalVenta\)/.test(s93) && / de la venta<\/span>/.test(s93));
chk('Ventas: sigue sin un solo atributo style="…"', !/style\s*=/.test(s93.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));

// ── Pedido sugerido ──
chk('★ Pedido sugerido: un solo «Ordenar por ▾» con 8 órdenes (4 campos × 2 sentidos); ya no hay chips de orden', (s73.match(/\['(nombre|sugerido|enStock|proveedor)', -?1, '[^']+'\]/g) || []).length === 8
    && /<select id="psOrdenSel" onchange="pedidoSugeridoOrden\(this\.value\)" aria-label="Ordenar por">/.test(s73) && !/ps-orden__btn|class="ps-orden"/.test(s73) && !/\.ps-orden(?!ar)/.test(dens + util));
chk('pedidoSugeridoOrden acepta solo campo:sentido conocidos y usa _ps.orden', /\/\^\(nombre\|enStock\|sugerido\|proveedor\):\(-\?1\)\$\//.test(s73) && /_ps\.orden = \{ campo: m\[1\], dir: Number\(m\[2\]\) \};/.test(s73));
chk('★ Tarjeta del teléfono: proveedor en SU línea (ps-card__pie) con «Sin proveedor» explícito', /<div class="ps-card__pie">/.test(s73) && /'Sin proveedor'/.test(s73) && /grid-template-areas: "chk info cant" "chk pie pie"/.test(dens));
chk('★ Escritorio (≥ 1280 px): tabla con encabezados ordenables (aria-sort), casilla «todos» con estado mixto y selección por fila',
    /window\.matchMedia\('\(min-width: 1280px\)'\)\.matches/.test(s73) && /<table class="ps-tabla"><caption class="sbx-sr">/.test(s73) && /aria-sort="' \+ sentido \+ '"/.test(s73)
    && /\(alguno \? 'mixed' : 'false'\)/.test(s73) && /data-ps-fila="' \+ id \+ '"/.test(s73) && /e\.target\.closest\('\[data-ps-fila\]'\)/.test(s73) && /!e\.target\.closest\('input,button,select,label,a'\)/.test(s73));
chk('Al cruzar los 1280 px se vuelve a pintar (tarjetas ↔ tabla), sin tocar _ps', /_psMq\.addEventListener\('change', _psAlCruzar\)/.test(s73));
chk('Escribir una cantidad marca el producto TAMBIÉN en pantalla e importe de fila al día', /_psMarcarEnPantalla\(pid, true\)/.test(s73) && /data-ps-importe/.test(s73));

// ── Control de negativos ──
const render = extraer(s94, 'renderControlNegativos') || '';
chk('★ Control de negativos: Exportar ya no es un chip de la fila de filtros; va en el ⋮ del encabezado', !/sbx-chip" id="cnExportBtn"/.test(s94) && /moduloCabecera\('Control de negativos', 'controlNegativosCerrar\(\)', estadoSync, desc, menu\)/.test(render) && /cab\(_cnMenuHtml\(d\)\)/.test(render));
chk('★ Menú ⋮ accesible: aria-haspopup, aria-expanded, role="menu"/"menuitem", Esc devuelve el foco, flechas', /aria-haspopup="menu" aria-controls="cnMenuLista"/.test(s94) && /role="menu"/.test(s94) && /role="menuitem"/.test(s94)
    && /e\.key === 'Escape'\) \{ _cn\.menu = false; _cnMenuPintar\(true\)/.test(s94) && /ArrowDown/.test(s94));
chk('★ Permisos: «Exportar a Excel» solo con inventory.export y con filas; el ⋮ no aparece sin datos ni sin permiso de lectura', /if \(_cnPuedeExportar\(\) && d && d\.filas\.length\)/.test(s94) && /hasPermission\('inventory\.export'\)/.test(s94) && /return cab\(''\) \+ '<div class="vs-vacio"><div class="vs-vacio__t">Sin permiso/.test(render));
chk('Sin corte vigente: «Ir a Inventario» solo con inventory.post', /hasPermission\('inventory\.post'\)\)\s*\? '<button type="button" class="vs-link cn-ir" onclick="controlNegativosIrAInventario\(\)">/.test(render) && /window\.controlNegativosIrAInventario = controlNegativosIrAInventario;/.test(s94));
chk('moduloCabecera acepta el menú como 5.º parámetro opcional (Ventas y Equipo no cambian)', /function moduloCabecera\(titulo, onVolver, estado, descripcion, extra\)/.test(s73) && /\+ \(extra \|\| ''\)/.test(s73));

// ── D6: pesos con 2 decimales en los cuatro módulos ──
chk('★ D6: Ventas, Pedido sugerido, Control de negativos y Venta por turno usan el formateador común biDinero (2 decimales)',
    /function _vsMoneda\(n\) \{\s*\/?[^]*?biDinero\(v\)/.test(s93) && /function _psMoneda\(n\) \{[^]*?biDinero\(v\)/.test(s73) && /function _cnMoneda\(n\) \{[^]*?biDinero\(v\)/.test(s94) && /function _vtMoneda\(n\) \{[^]*?biDinero\(v\)/.test(s94t));
chk('D6: ya no quedan formatos de 0 a 2 decimales en estos módulos', !/maximumFractionDigits: 2 \}\);\s*\}/.test(extraer(s93, '_vsMoneda') + extraer(s73, '_psMoneda')) && !/minimumFractionDigits: 0/.test(s93 + s73));
chk('D6: el estado vacío de Ventas ya no dice «$0» sino el formato común', !/<b class="num">\$0<\/b>/.test(s93));

// ── CSS ──
chk('★ CSS: estilos.css sin tocar (203,196 B, tope 215,000)', Buffer.byteLength(esti) === 203196);
chk('CSS: el bloque v5.61 vive en densidad.css y solo usa tokens (sin hex, rgb(), oklch() ni degradados)', (() => { const i = dens.indexOf('/* ═══ v5.61'); const b = i >= 0 ? sinCom(dens.slice(i)) : ''; return b.length > 2000 && !/#[0-9a-fA-F]{3,8}\b/.test(b) && !/rgba?\(|oklch\(|gradient\(/.test(b); })());
chk('CSS: sin reglas muertas de los controles que se quitaron (.ps-orden, .vs-pills)', !/\.ps-orden(?!ar)|\.vs-pills/.test(dens + util + esti));
chk('CSS: piso de 12 px en lo que estaba en 10–11 px (tipo de producto, cantidades y nota del pie)', /\.vs-kpi__sub, \.vs-pill, \.vs-fila__cant, \.ps-pie__nota \{ font-size: var\(--d-fs-badge\); \}/.test(dens));
chk('CSS: sin cifras ni etiquetas cortadas a < 480 px (indicador principal a lo ancho)', /@media \(max-width: 479px\) \{\s*\.vs-kpis \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/.test(dens));

// ── Excel verificable en la CI ──
chk('★ v537 relee el Excel del pedido con el SheetJS de la app (antes require("xlsx"), ausente en la CI → «NO VERIFICADO»)', !/X = require\('xlsx'\)/.test(t537) && /require\(path\.join\(__dirname, '\.\.', 'js', 'xlsx\.full\.min\.js'\)\)/.test(t537));

let mal = 0;
C.forEach(c => { console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '  → ' + c.d)); if (!c.ok) mal++; });
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron\n');
process.exit(mal ? 1 : 0);
