// v5.61 — Ventas, Pedido sugerido y Control de negativos, contra la app REAL en Chromium.
// Datos ficticios en memoria; nada toca Firebase (_db = null). Los .xlsx se DESCARGAN y se releen
// con el mismo SheetJS que carga la app (js/xlsx.full.min.js).
//   · Ventas: selector único «Semana | Mes» + «‹ periodo ›», flechas, tope en hoy, pesos con 2 decimales,
//     «—» explicado, lugar y parte de la venta, exportación real.
//   · Pedido sugerido: «Ordenar por ▾» (8 órdenes), proveedor en su línea, tarjetas (teléfono) y tabla con
//     selección por fila (≥ 1280 px), generar pedido (carrito + ventana), Excel real, vacíos, permisos.
//   · Control de negativos: Exportar dentro del ⋮ (abre, Esc, fuera, flechas, dentro de pantalla), Excel
//     real desde el menú, permisos, vacío con «Ir a Inventario».
//   · Venta por turno: mismo texto de pesos que antes.
//   · 360/412/1366/1440 px, oscuro y claro: sin desborde, sin errores, objetivos ≥ 44 px, texto ≥ 12 px.
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d === undefined ? '' : String(d).slice(0, 300) });
const NOVERIF = [];
const PUERTO = process.env.PUERTO || '8080';
const URL_APP = 'http://127.0.0.1:' + PUERTO + '/index.html';
const CARGA_APP = /<script src="js\/xlsx\.full\.min\.js\?v=[^"]+" defer>/.test(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'));
let X = null;
try { X = CARGA_APP ? require(path.join(__dirname, '..', 'js', 'xlsx.full.min.js')) : null; } catch (_) { X = null; }

const MONTAJE = (opc) => {
  opc = opc || {};
  document.getElementById('authLoadingScreen').classList.add('auth-hidden');
  document.getElementById('loginScreen').classList.add('auth-hidden');
  document.getElementById('appWrapper').classList.add('auth-visible');
  const b = document.getElementById('bannerEntorno'); if (b) b.style.display = 'none';
  currentUserUid = 'jefe'; currentUserRole = 'admin'; _db = null;
  _authzState.loaded = true; _authzState.overrides = {}; _authzState.roleId = 'ADMIN';
  _authzState.permissions = new Set(opc.permisos || ['*']);
  products = [
    { id: 'A', name: 'TEQUILA 1800 AÑEJO', group: 'TEQUILA', unit: 'Botellas', precio: 300, stockMinimo: 10, conversion: 1, proveedor: 'DISTRIBUIDORA DE VINOS Y LICORES DEL BAJÍO', stockByArea: { almacen: 2, barra1: 0, barra2: 0 } },
    { id: 'B', name: 'RON BLANCO', group: 'RON', unit: 'Botellas', stockMinimo: 5, conversion: 1, stockByArea: { almacen: 1, barra1: 0, barra2: 0 } },
    { id: 'C', name: 'LIMON PERSA', group: 'FRUTA', unit: 'KGS', precio: 24.5, stockMinimo: 8, conversion: 1, proveedor: 'MERCADO CENTRAL', stockByArea: { almacen: 5, barra1: 0, barra2: 0 } },
    { id: '0012', name: 'MEZCAL', group: 'TEQUILA', unit: 'Botellas', precio: 450, stockMinimo: 2, conversion: 1, proveedor: 'AGAVE SUR', stockByArea: { almacen: 9, barra1: 0, barra2: 0 } }
  ];
  recetas = [{ id: 'R1', nombre: 'MARGARITA', pv: 'PV1', categoria: 'Cocteles', activa: true, ingredientes: [{ productoId: 'A', cantidad: 0.06, uom: 'Botellas' }, { productoId: 'C', cantidad: 0.1, uom: 'KGS' }] }];
  cart = []; orders = []; movimientos = [];
  ventasSemanaId = semanaId(new Date()); ventasImportView = 'lista';
  ventas = [
    { sku: 'PV1', nombre: 'MARGARITA CLASICA DE LA CASA', tipo: 'Coctel', cantidad: 48, ventaNeta: 7680 },
    { sku: 'PV2', nombre: 'CERVEZA', tipo: 'Cerveza', cantidad: 120, ventaNeta: 6000.5 },
    { sku: 'PV3', nombre: 'MEZCALITA', tipo: 'Coctel', cantidad: 10, ventaNeta: 1450.25 }
  ];
  const lunes = ventasSemanaId;
  ventasPeriodos = [{ id: lunes + '_' + lunes, inicio: lunes, fin: lunes }];
  const hoy = new Date(), f = (n) => fechaISOLocal(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - n));
  if (opc.soloCatalogo) {
    // Pedido sugerido: la existencia sale del catálogo (como v537), sin corte ni ventas que la muevan.
  } else if (!opc.sinCorte) {
    _existenciaInicial = { semana: existenciaSemanaHoy(), estado: 'ok', saldos: { A: 1, C: 2 }, origen: null,
                           ancla: { tipo: 'mitad_de_semana', fecha: f(3), id: f(3), ruta: 'arrastre', dias: 3 } };
    _existenciaArrastre = { anclaFecha: f(3), compras: [], comprasNoDisponibles: false, ventasNoDisponibles: false, version: 5610,
                            periodos: [{ id: f(2) + '_' + f(2), inicio: f(2), fin: f(2), semanaId: semanaId(f(2)), lineas: [{ sku: 'PV1', nombre: 'MARGARITA', cantidad: 30, ventaNeta: 3000 }] }] };
  } else {
    _existenciaInicial = { semana: existenciaSemanaHoy(), estado: 'ok', saldos: {}, origen: null, ancla: null };
  }
  if (typeof _vs !== 'undefined') { _vs.vista = 'semana'; _vs.semana = null; _vs.mes = null; _vs.datos = {}; _vs.busqueda = ''; }
  if (typeof _ps !== 'undefined') { _ps.seleccion = null; _ps.cantidades = {}; _ps.orden = { campo: 'nombre', dir: 1 }; _ps.busqueda = ''; _ps.soloBajo = true; _ps.grupo = ''; _ps.fuente = 'sistema'; }
  activeTab = 'inicio'; renderTab();
};

const MEDIR = (sel) => {
  const raiz = document.querySelector(sel);
  if (!raiz) return null;
  const chicos = [], textoChico = [];
  raiz.querySelectorAll('button, select, input, [role="checkbox"], [role="menuitem"]').forEach(e => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || e.closest('[hidden]') || getComputedStyle(e).visibility === 'hidden') return;
    if (e.matches('.vs-link, .ps-tabla__orden') || e.closest('.sbx')) return;   // enlaces en línea, encabezados de la tabla de escritorio y el buscador común (fuera de estos módulos)
    const caja = e.matches('select') ? (e.closest('.mc-pill') || e).getBoundingClientRect() : r;
    if (caja.height < 44 - 0.5) chicos.push((e.id || e.className || e.tagName) + ' ' + Math.round(caja.height));
  });
  raiz.querySelectorAll('*').forEach(e => {
    if (e.closest('[hidden]') || e.matches('i, i *, svg, svg *') || !e.offsetParent) return;
    const tieneTexto = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (tieneTexto && parseFloat(getComputedStyle(e).fontSize) < 12) textoChico.push((e.className || e.tagName) + ' ' + getComputedStyle(e).fontSize);
  });
  return { chicos, textoChico, desborde: document.documentElement.scrollWidth > innerWidth + 1 };
};

async function abrir(nav, ancho, opc, tema) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: ancho < 800 ? 844 : 900 }, hasTouch: ancho < 800, acceptDownloads: true });
  await ctx.addInitScript((t) => { try { localStorage.setItem('inventarioApp_theme', t || 'dark'); localStorage.setItem('inventarioApp_temaMarca', 'ultra-pro'); } catch (e) {} }, tema);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  p.on('dialog', d => d.dismiss());
  await p.goto(URL_APP, { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600);
  await p.evaluate(MONTAJE, opc || {});
  if (tema) await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
  return { ctx, p, errs };
}

async function descargar(p, accion) {
  const hayXlsx = await p.evaluate(async () => { for (let i = 0; i < 30 && typeof XLSX === 'undefined'; i++) await new Promise(r => setTimeout(r, 200)); return typeof XLSX !== 'undefined' ? XLSX.version : null; });
  if (!hayXlsx || !X) return null;
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), accion()]);
  const dir = path.join(os.tmpdir(), 'bi-v561'); fs.mkdirSync(dir, { recursive: true });
  const ruta = path.join(dir, dl.suggestedFilename()); await dl.saveAs(ruta);
  const buf = fs.readFileSync(ruta);
  return { nombre: dl.suggestedFilename(), zip: buf[0] === 0x50 && buf[1] === 0x4b, wb: X.read(buf, { type: 'buffer' }) };
}

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  let ctx, p, errs;

  // ═══ 1 · VENTAS ═══════════════════════════════════════════════════════════
  ({ ctx, p, errs } = await abrir(nav, 390));
  await p.evaluate(() => { activeTab = 'ventas'; renderTab(); }); await p.waitForTimeout(250);
  const v0 = await p.evaluate(() => ({
    seg: [...document.querySelectorAll('.vs-seg .fvs-tab')].map(b => b.textContent.trim() + ':' + b.getAttribute('aria-pressed')),
    viejos: document.querySelectorAll('.vs-pills, button.vs-periodo__actual').length + [...document.querySelectorAll('#tabContent button')].filter(b => /Semana anterior/.test(b.textContent)).length,
    txt: (document.querySelector('.vs-periodo__txt') || {}).textContent, nota: (document.querySelector('.vs-periodo__nota') || {}).textContent,
    aria: (document.querySelector('.vs-periodo__actual') || { getAttribute: () => '' }).getAttribute('aria-label'),
    corta: ventasEtiquetaCorta(semanaId(new Date())), larga: etiquetaSemana(semanaId(new Date())),
    sig: document.querySelector('.vs-flecha[aria-label="Semana siguiente"]').disabled
  }));
  chk('★ Ventas: un solo selector «Semana | Mes» (Semana activa) y ya no existen «Semana anterior» ni la pill central', v0.seg.join(',') === 'Semana:true,Mes:false' && v0.viejos === 0, JSON.stringify(v0));
  chk('★ Ventas: «‹ periodo ›» muestra la semana corta, dice «Semana activa» y su nombre completo para el lector', v0.txt === v0.corta && v0.nota === 'Semana activa' && v0.aria.indexOf(v0.larga) === 0, JSON.stringify(v0));
  chk('Ventas: en la semana de hoy la flecha › está deshabilitada (no pasa de hoy)', v0.sig === true);
  await p.click('.vs-flecha[aria-label="Semana anterior a la mostrada"]'); await p.waitForTimeout(200);
  const v1 = await p.evaluate(() => ({ sem: _vs.semana, esperada: semanaAnterior(ventasSemanaId), nota: document.querySelector('.vs-periodo__nota').textContent, sig: document.querySelector('.vs-flecha[aria-label="Semana siguiente"]').disabled, aviso: !!document.querySelector('.vs-aviso'), vista: _vs.vista }));
  chk('★ Ventas: ‹ lleva a la semana anterior (Solo consulta, con aviso para volver) y › se habilita', v1.sem === v1.esperada && v1.nota === 'Solo consulta' && !v1.sig && v1.aviso && v1.vista === 'semana', JSON.stringify(v1));
  await p.click('.vs-flecha[aria-label="Semana siguiente"]'); await p.waitForTimeout(200);
  chk('Ventas: › regresa a la semana activa', await p.evaluate(() => _vs.semana === null && _vsEsActiva()));
  await p.click('.vs-seg .fvs-tab:nth-child(2)'); await p.waitForTimeout(200);
  const v2 = await p.evaluate(() => ({ vista: _vs.vista, mes: _vs.mes, hoy: fechaISOLocal(new Date()).slice(0, 7), txt: document.querySelector('.vs-periodo__txt').textContent, seg: [...document.querySelectorAll('.vs-seg .fvs-tab')].map(b => b.getAttribute('aria-pressed')).join(','), sig: document.querySelector('.vs-flecha[aria-label="Mes siguiente"]').disabled, etq: _vsEtiquetaMes(fechaISOLocal(new Date()).slice(0, 7)) }));
  chk('★ Ventas: «Mes» cambia a la vista del mes de la semana (Mes resaltado, nombre del mes, › en el tope)', v2.vista === 'mes' && v2.mes === v2.hoy && v2.txt === v2.etq && v2.seg === 'false,true' && v2.sig, JSON.stringify(v2));
  await p.click('.vs-flecha[aria-label="Mes anterior"]'); await p.waitForTimeout(200);
  chk('Ventas: en Mes, ‹ va al mes anterior', await p.evaluate(() => { const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() - 1, 1); return _vs.mes === a.getFullYear() + '-' + String(a.getMonth() + 1).padStart(2, '0'); }));
  await p.click('.vs-seg .fvs-tab:nth-child(1)'); await p.waitForTimeout(200);
  chk('★ Ventas: «Semana» regresa a la semana activa', await p.evaluate(() => _vs.vista === 'semana' && _vsEsActiva()));
  await p.evaluate(() => { document.querySelector('.vs-seg .fvs-tab:nth-child(1)').click(); }); await p.waitForTimeout(150);
  chk('Ventas: tocar el segmento que ya está activo no cambia nada', await p.evaluate(() => _vs.vista === 'semana' && _vsEsActiva()));
  const v3 = await p.evaluate(() => ({
    kpi: [...document.querySelectorAll('.vs-kpi__val')].map(e => e.textContent), esperado: biDinero(7680 + 6000.5 + 1450.25), prom: biDinero(ventasResumen(ventas).precioPromedio),
    filas: [...document.querySelectorAll('.vs-fila')].map(li => ({ pos: (li.querySelector('.vs-fila__pos') || {}).textContent, imp: li.querySelector('.vs-fila__imp').textContent, parte: (li.querySelector('.vs-fila__parte') || {}).textContent, cant: li.querySelector('.vs-fila__cant').textContent }))
  }));
  chk('★ D6 · Ventas: Venta neta y precio promedio con 2 decimales ($15,130.75)', v3.kpi[0] === v3.esperado && v3.kpi[0] === '$15,130.75' && v3.kpi[2] === v3.prom && /\.\d{2}$/.test(v3.kpi[2]), JSON.stringify(v3.kpi));
  chk('★ D6 · Ventas: importes de la lista con 2 decimales ($7,680.00, $6,000.50) y c/u con 2', v3.filas[0].imp === '$7,680.00' && v3.filas[1].imp === '$6,000.50' && /\$160\.00 c\/u/.test(v3.filas[0].cant), JSON.stringify(v3.filas));
  chk('Ventas: cada producto del top dice su lugar y su parte de la venta (50.8 %)', v3.filas.map(f => f.pos).join(',') === '1,2,3' && v3.filas[0].parte === '50.8 % de la venta', JSON.stringify(v3.filas));
  // Exportar (la semana activa): descarga real y relectura
  const exV = await descargar(p, () => p.click('.vs-btn--secundario'));
  if (!exV) NOVERIF.push('Excel de Ventas (SheetJS no disponible)');
  else {
    const filas = X.utils.sheet_to_json(exV.wb.Sheets['Ventas'], { header: 1, defval: null });
    const res = X.utils.sheet_to_json(exV.wb.Sheets['Resumen'], { header: 1, defval: null });
    chk('★ Ventas · Excel real: mismo nombre, mismas columnas y los importes como NÚMEROS sin formato (7680, 6000.5)', /^ventas_semana_\d{4}-\d{2}-\d{2}\.xlsx$/.test(exV.nombre) && exV.zip
        && JSON.stringify(filas[0]) === JSON.stringify(['SKU', 'Producto', 'Tipo', 'Cantidad', 'Cortesía', 'Regalo 2x1', 'Venta neta'])
        && filas[1][6] === 7680 && filas[2][6] === 6000.5 && res.find(r => r[0] === 'Venta neta')[1] === 15130.75, JSON.stringify(filas.slice(0, 3)));
  }
  // «—» explicado: un reporte sin importe
  await p.evaluate(() => { ventas = [{ sku: 'PV9', nombre: 'SIN IMPORTE', cantidad: 5 }]; renderTab(); }); await p.waitForTimeout(150);
  const v4 = await p.evaluate(() => [...document.querySelectorAll('.vs-kpi')].map(k => k.querySelector('.vs-kpi__val').textContent + '|' + ((k.querySelector('.vs-kpi__sub') || {}).textContent || '')));
  chk('Ventas: un «—» dice por qué («el reporte no trae importe»)', v4[0] === '—|el reporte no trae importe' && v4[2] === '—|el reporte no trae importe', JSON.stringify(v4));
  await p.evaluate(() => { ventas = []; ventasPeriodos = []; renderTab(); }); await p.waitForTimeout(150);
  chk('Ventas · vacío: «Sin ventas esta semana», Exportar deshabilitado y Venta neta $0.00', await p.evaluate(() => /Sin ventas esta semana/.test(document.querySelector('.vs-vacio').textContent) && document.querySelector('.vs-btn--secundario').disabled && /\$0\.00/.test(document.querySelector('.vs-total').textContent)));
  chk('Ventas: sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 2 · PEDIDO SUGERIDO — teléfono ═══════════════════════════════════════
  ({ ctx, p, errs } = await abrir(nav, 360, { soloCatalogo: true }));
  await p.evaluate(() => { activeTab = 'pedido_sugerido'; renderTab(); }); await p.waitForTimeout(250);
  const s0 = await p.evaluate(() => ({
    chips: document.querySelectorAll('.ps-orden, .ps-orden__btn').length, tabla: !!document.querySelector('.ps-tabla'),
    opciones: [...document.querySelectorAll('#psOrdenSel option')].map(o => o.value), etq: (document.querySelector('.ps-ordenar__etq') || {}).textContent,
    selH: Math.round(document.querySelector('.ps-ordenar').getBoundingClientRect().height),
    ids: [...document.querySelectorAll('.ps-card .ps-card__cod')].map(e => e.textContent)
  }));
  chk('★ Pedido sugerido: un solo «Ordenar por ▾» con 8 órdenes (ya no hay chips de orden) y tarjetas en el teléfono', s0.chips === 0 && !s0.tabla && s0.etq === 'Ordenar por' && s0.opciones.length === 8 && s0.selH >= 44, JSON.stringify(s0));
  chk('Pedido sugerido: orden inicial por producto A–Z (LIMON, RON, TEQUILA)', s0.ids.join(',') === 'C,B,A', s0.ids.join(','));
  await p.selectOption('#psOrdenSel', 'sugerido:-1'); await p.waitForTimeout(250);
  const s1 = await p.evaluate(() => ({ ids: [...document.querySelectorAll('.ps-card .ps-card__cod')].map(e => e.textContent), sug: pedidoSugeridoFilas(products, { soloBajo: true }).map(f => f.id + ':' + f.sugerido), orden: _ps.orden }));
  chk('★ Ordenar por «Sugerido (mayor primero)» reordena: TEQUILA 8, RON 4, LIMON 3', s1.ids.join(',') === 'A,B,C' && s1.orden.campo === 'sugerido' && s1.orden.dir === -1, JSON.stringify(s1));
  await p.selectOption('#psOrdenSel', 'proveedor:1'); await p.waitForTimeout(250);
  chk('Ordenar por «Proveedor (A–Z)»: DISTRIBUIDORA…, MERCADO CENTRAL y al final el que no tiene', (await p.evaluate(() => [...document.querySelectorAll('.ps-card .ps-card__cod')].map(e => e.textContent).join(','))) === 'A,C,B');
  await p.selectOption('#psOrdenSel', 'enStock:-1'); await p.waitForTimeout(250);
  chk('Ordenar por «En stock (mayor primero)»: LIMON 5, TEQUILA 2, RON 1', (await p.evaluate(() => [...document.querySelectorAll('.ps-card .ps-card__cod')].map(e => e.textContent).join(','))) === 'C,A,B');
  await p.selectOption('#psOrdenSel', 'nombre:1'); await p.waitForTimeout(250);
  const s2 = await p.evaluate(() => [...document.querySelectorAll('.ps-card')].map(c => { const pr = c.querySelector('.ps-card__prov'), nom = c.querySelector('.ps-card__nom'), cif = c.querySelector('.ps-card__cifras');
    const ps = pr.querySelector('span'); return { id: c.querySelector('.ps-card__cod').textContent, prov: pr.textContent.trim(), recortado: ps.scrollHeight > ps.clientHeight + 1 || ps.scrollWidth > ps.clientWidth + 1, provW: Math.round(pr.getBoundingClientRect().width), provTop: Math.round(pr.getBoundingClientRect().top), nomBottom: Math.round(nom.getBoundingClientRect().bottom), metaBottom: Math.round(c.querySelector('.ps-card__meta').getBoundingClientRect().bottom), cifTop: Math.round(cif.getBoundingClientRect().top), sug: c.querySelector('.ps-card__sug').textContent, h: Math.round(c.getBoundingClientRect().height) }; }));
  const tq = s2.find(x => x.id === 'A'), ron = s2.find(x => x.id === 'B');
  chk('★ Proveedor en SU línea, debajo del nombre y del código, y COMPLETO a 360 px (antes se cortaba a 1 carácter)', tq && tq.provTop >= tq.metaBottom - 1 && tq.provW >= 120 && !tq.recortado && tq.prov === 'DISTRIBUIDORA DE VINOS Y LICORES DEL BAJÍO', JSON.stringify(tq));
  chk('Sin proveedor lo dice («Sin proveedor») y Stock/Mín quedan en la misma línea del proveedor', ron && ron.prov === 'Sin proveedor' && Math.abs(ron.cifTop - ron.provTop) <= 6, JSON.stringify(ron));
  chk('La tarjeta muestra el sugerido junto al código (Sug. 8) y sigue compacta: ≤ 96 px; solo un proveedor muy largo la alarga (≤ 125 px)', tq.sug === 'Sug. 8' && s2.filter(x => x.id !== 'A').every(x => x.h <= 96) && tq.h <= 125, JSON.stringify(s2.map(x => x.id + ':' + x.h)));
  const pie0 = await p.evaluate(() => document.querySelector('#ps-pie .ps-pie__txt').textContent);
  chk('★ D6 · Total estimado con 2 decimales: 8×$300 + 3×$24.50 = $2,473.50 (RON sin precio)', /3 productos · Total est\. \$2,473\.50/.test(pie0) && /1 sin precio/.test(pie0), pie0);
  await p.click('.ps-check[data-ps-pid="C"]'); await p.waitForTimeout(200);
  chk('Desmarcar LIMON: la casilla se apaga y el total baja a $2,400.00', await p.evaluate(() => document.querySelector('.ps-check[data-ps-pid="C"]').getAttribute('aria-checked') === 'false' && /2 productos · Total est\. \$2,400\.00/.test(document.querySelector('#ps-pie').textContent)));
  await p.fill('.ps-input[data-ps-pid="C"]', '6'); await p.press('.ps-input[data-ps-pid="C"]', 'Tab'); await p.waitForTimeout(200);
  chk('★ Escribir 6 en LIMON lo vuelve a marcar EN PANTALLA (antes quedaba la casilla apagada) y el total = $2,547.00', await p.evaluate(() => { const b = document.querySelector('.ps-check[data-ps-pid="C"]'); return b.getAttribute('aria-checked') === 'true' && b.closest('.ps-card').classList.contains('ps-card--sel') && /\$2,547\.00/.test(document.querySelector('#ps-pie').textContent); }));
  await p.click('.ps-micro__sel'); await p.waitForTimeout(150);
  chk('«quitar todos» desmarca los 3 y «Generar pedido» queda deshabilitado', await p.evaluate(() => document.querySelectorAll('.ps-check--on').length === 0 && document.querySelector('.ps-pie__btn').disabled));
  await p.click('.ps-micro__sel'); await p.waitForTimeout(150);
  await p.click('.ps-pie__btn'); await p.waitForTimeout(300);
  const gen = await p.evaluate(() => ({ cart: cart.map(i => i.id + ':' + i.quantity).sort().join(','), modal: !document.getElementById('orderModal').classList.contains('hidden') }));
  chk('★ «Generar pedido» pasa al carrito lo marcado con su cantidad (A 8, B 4, C 6) y abre la ventana del pedido', gen.cart === 'A:8,B:4,C:6' && gen.modal, JSON.stringify(gen));
  await p.evaluate(() => { closeOrderModal(); cart = []; });
  // Excel real desde el botón (con la cantidad escrita)
  const exP = await descargar(p, () => p.click('#psExportBtn'));
  if (!exP) NOVERIF.push('Excel de Pedido sugerido (SheetJS no disponible)');
  else {
    const aoa = X.utils.sheet_to_json(exP.wb.Sheets['Pedido sugerido'], { header: 1, defval: null });
    const dat = aoa.slice(1).filter(x => x[1] && x[9] !== 'Total');
    const fA = dat.find(x => x[1] === 'A'), fB = dat.find(x => x[1] === 'B'), fC = dat.find(x => x[1] === 'C');
    const tot = aoa.find(x => x[9] === 'Total');
    chk('★ Pedido sugerido · Excel real: Pedido_Sugerido_AAAA-MM-DD.xlsx, mismas 11 columnas, los 3 con sugerido', /^Pedido_Sugerido_\d{4}-\d{2}-\d{2}\.xlsx$/.test(exP.nombre) && exP.zip && aoa[0].length === 11 && dat.length === 3, exP.nombre + ' ' + JSON.stringify(aoa[0]));
    chk('★ Excel: TEQUILA 2/10/8/8 × 300 = 2400 · LIMON cantidad escrita 6 × 24.5 = 147 · RON sin precio (vacío) · Total 2547', JSON.stringify(fA.slice(5)) === JSON.stringify([2, 10, 8, 8, 300, 2400]) && fC[8] === 6 && fC[10] === 147 && fB[9] === null && fB[10] === null && tot && tot[10] === 2547, JSON.stringify([fA, fB, fC, tot]));
    chk('Excel: el proveedor completo va en su columna', fA[4] === 'DISTRIBUIDORA DE VINOS Y LICORES DEL BAJÍO' && fB[4] === '');
  }
  chk('★ Exportar y generar no cambiaron el catálogo', await p.evaluate(() => products.length === 4 && products[0].stockMinimo === 10));
  // Vacíos
  await p.fill('#sbx-input-pedsug', 'zzzz'); await p.waitForTimeout(450);
  chk('Vacío: una búsqueda sin resultados dice «Sin coincidencias»', await p.evaluate(() => /Sin coincidencias/.test(document.querySelector('.ps-vacio').textContent)));
  await p.fill('#sbx-input-pedsug', ''); await p.waitForTimeout(450);
  await p.evaluate(() => { products.forEach(x => { x.stockMinimo = 0; }); renderTab(); }); await p.waitForTimeout(200);
  chk('Vacío: sin nada bajo el mínimo dice «Nada que pedir» y el total es $0.00', await p.evaluate(() => { const v = document.querySelector('.ps-vacio'); return !!v && /Nada que pedir/.test(v.textContent) && /\$0\.00/.test(document.querySelector('#ps-pie').textContent) && document.querySelector('.ps-pie__btn').disabled; }));
  await p.click('.ps-filtros [data-ps-accion="bajo"]'); await p.waitForTimeout(200);
  chk('Vacío: sin filtro «Bajo stock» y sin mínimos dice «Sin productos con mínimo»', await p.evaluate(() => { const v = document.querySelector('.ps-vacio'); return !!v && /Sin productos con mínimo/.test(v.textContent); }));
  chk('Pedido sugerido (teléfono): sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  await ctx.close();
  // Sin permiso de exportar
  ({ ctx, p, errs } = await abrir(nav, 390, { soloCatalogo: true, permisos: ['inventory.count', 'catalog.read'] }));
  await p.evaluate(() => { activeTab = 'pedido_sugerido'; renderTab(); }); await p.waitForTimeout(200);
  chk('Permisos: sin inventory.export no hay botón Exportar y la función se niega; Ordenar por sigue', await p.evaluate(() => !document.getElementById('psExportBtn') && exportarPedidoSugeridoExcel().motivo === 'sin_permiso' && !!document.getElementById('psOrdenSel')));
  await ctx.close();

  // ═══ 3 · PEDIDO SUGERIDO — escritorio: tabla con selección por fila ══════
  ({ ctx, p, errs } = await abrir(nav, 1366, { soloCatalogo: true }));
  await p.evaluate(() => { activeTab = 'pedido_sugerido'; renderTab(); }); await p.waitForTimeout(250);
  const t0 = await p.evaluate(() => ({ tabla: !!document.querySelector('.ps-tabla'), tarjetas: document.querySelectorAll('.ps-card').length, filas: document.querySelectorAll('.ps-tabla tbody tr').length,
    cab: [...document.querySelectorAll('.ps-tabla thead th')].map(th => th.textContent.replace(/[↑↓]/g, '').trim()), sort: document.querySelector('.ps-tabla th[aria-sort="ascending"]').textContent.trim(),
    todos: document.querySelector('.ps-tabla thead .ps-check').getAttribute('aria-checked'), microBtn: !!document.querySelector('.ps-micro__sel'),
    impA: document.querySelector('[data-ps-importe="A"]').textContent, precioC: [...document.querySelector('[data-ps-fila="C"]').cells].map(c => c.textContent.trim()) }));
  chk('★ Escritorio (1366): TABLA con casilla, Producto, Proveedor, Stock, Mín, Sugerido, Pedir, Precio e Importe; sin tarjetas', t0.tabla && t0.tarjetas === 0 && t0.filas === 3 && t0.cab.slice(1).join('|') === 'Producto|Proveedor|Stock|Mín|Sugerido|Pedir|Precio|Importe', JSON.stringify(t0));
  chk('Tabla: orden marcado con aria-sort, todo marcado al inicio y «marcar todos» es la casilla del encabezado', t0.sort.indexOf('Producto') === 0 && t0.todos === 'true' && !t0.microBtn, JSON.stringify(t0));
  chk('★ D6 · Tabla: precio e importe con 2 decimales ($24.50, $73.50, $2,400.00)', t0.impA === '$2,400.00' && t0.precioC[7] === '$24.50' && t0.precioC[8] === '$73.50', JSON.stringify(t0.precioC));
  await p.click('[data-ps-fila="B"] td.ps-tabla__prov'); await p.waitForTimeout(200);
  const t1 = await p.evaluate(() => ({ b: document.querySelector('[data-ps-fila="B"] .ps-check').getAttribute('aria-checked'), selB: !!(_ps.seleccion && _ps.seleccion.B), clase: document.querySelector('[data-ps-fila="B"]').classList.contains('ps-fila--sel'), todos: document.querySelector('.ps-tabla thead .ps-check').getAttribute('aria-checked') }));
  chk('★ Tocar la FILA (no la casilla) desmarca el producto y la casilla del encabezado queda «mixta»', t1.b === 'false' && !t1.selB && !t1.clase && t1.todos === 'mixed', JSON.stringify(t1));
  await p.click('[data-ps-fila="B"] td.ps-tabla__prod'); await p.waitForTimeout(200);
  chk('Tocarla otra vez la vuelve a marcar', await p.evaluate(() => _ps.seleccion.B === true && document.querySelector('[data-ps-fila="B"] .ps-check').getAttribute('aria-checked') === 'true'));
  await p.click('[data-ps-fila="A"] .ps-input'); await p.waitForTimeout(100);
  chk('Tocar el campo Pedir NO cambia la selección', await p.evaluate(() => _ps.seleccion.A === true));
  await p.fill('[data-ps-fila="A"] .ps-input', '10'); await p.press('[data-ps-fila="A"] .ps-input', 'Tab'); await p.waitForTimeout(200);
  chk('★ Cambiar Pedir a 10 actualiza el Importe de la fila ($3,000.00) y el total ($3,073.50)', await p.evaluate(() => document.querySelector('[data-ps-importe="A"]').textContent === '$3,000.00' && /\$3,073\.50/.test(document.querySelector('#ps-pie').textContent)));
  await p.click('.ps-tabla th[aria-sort] [data-ps-orden="sugerido"]'); await p.waitForTimeout(200);
  const t2 = await p.evaluate(() => ({ ids: [...document.querySelectorAll('.ps-tabla tbody tr')].map(r => r.getAttribute('data-ps-fila')).join(','), sel: document.getElementById('psOrdenSel').value, aria: document.querySelector('[data-ps-orden="sugerido"]').closest('th').getAttribute('aria-sort') }));
  chk('★ Encabezado «Sugerido» ordena la tabla (3, 4, 8) y el selector «Ordenar por» se pone al día', t2.ids === 'C,B,A' && t2.sel === 'sugerido:1' && t2.aria === 'ascending', JSON.stringify(t2));
  await p.click('.ps-tabla th[aria-sort] [data-ps-orden="sugerido"]'); await p.waitForTimeout(200);
  chk('Tocar el mismo encabezado invierte el sentido (8, 4, 3) y el selector lo refleja', await p.evaluate(() => [...document.querySelectorAll('.ps-tabla tbody tr')].map(r => r.getAttribute('data-ps-fila')).join(',') === 'A,B,C' && document.getElementById('psOrdenSel').value === 'sugerido:-1'));
  await p.click('.ps-tabla thead .ps-check'); await p.waitForTimeout(150);
  chk('La casilla del encabezado quita todos', await p.evaluate(() => document.querySelectorAll('.ps-tabla tbody .ps-check--on').length === 0 && document.querySelector('.ps-pie__btn').disabled));
  await p.click('.ps-tabla thead .ps-check'); await p.waitForTimeout(150);
  await p.click('.ps-pie__btn'); await p.waitForTimeout(300);
  chk('★ Escritorio: «Generar pedido» con lo de la tabla (A 10, B 4, C 3) y abre la ventana', await p.evaluate(() => cart.map(i => i.id + ':' + i.quantity).sort().join(',') === 'A:10,B:4,C:3' && !document.getElementById('orderModal').classList.contains('hidden')));
  await p.evaluate(() => { closeOrderModal(); cart = []; });
  const m1366 = await p.evaluate(MEDIR, '.ps-pantalla');
  chk('Escritorio 1366: sin desborde de página', m1366 && !m1366.desborde, JSON.stringify(m1366));
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
  chk('★ Al bajar de 1280 px se vuelve a pintar en tarjetas y se conservan selección y cantidades (A 10)', await p.evaluate(() => !document.querySelector('.ps-tabla') && document.querySelectorAll('.ps-card').length === 3 && document.querySelector('.ps-input[data-ps-pid="A"]').value === '10'));
  chk('Pedido sugerido (escritorio): sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 4 · CONTROL DE NEGATIVOS ════════════════════════════════════════════
  for (const ancho of [360, 1366]) {
    ({ ctx, p, errs } = await abrir(nav, ancho));
    await p.evaluate(() => { activeTab = 'ventas'; renderTab(); controlNegativosAbrir(); }); await p.waitForTimeout(250);
    const n0 = await p.evaluate(() => ({ btn: !!document.querySelector('.pg-cab #cnMenuBtn'), exp: document.getElementById('cnMenuBtn').getAttribute('aria-expanded'), oculto: document.getElementById('cnMenuLista').hidden,
      chipExcel: [...document.querySelectorAll('.cn-pantalla .sbx-chips button')].some(b => /Excel/.test(b.textContent)), h: Math.round(document.getElementById('cnMenuBtn').getBoundingClientRect().height),
      kpi: [...document.querySelectorAll('.kpi__n')].map(k => k.textContent), esperado: biDinero(_cnDatos().resumen.valorPendiente), neg: _cnDatos().resumen.negativos }));
    chk('★ [' + ancho + '] Control de negativos: Exportar ya no es un chip de la fila de filtros; hay un ⋮ en el encabezado (44 px, cerrado)', n0.btn && n0.exp === 'false' && n0.oculto && !n0.chipExcel && n0.h >= 44, JSON.stringify(n0));
    chk('[' + ancho + '] D6 · Valor pendiente con 2 decimales y el mismo valor calculado', n0.kpi[2] === n0.esperado && /\.\d{2}$/.test(n0.kpi[2]) && n0.neg > 0, JSON.stringify(n0));
    await p.click('#cnMenuBtn'); await p.waitForTimeout(150);
    const n1 = await p.evaluate(() => { const l = document.getElementById('cnMenuLista'); const r = l.getBoundingClientRect();
      return { abierto: !l.hidden, exp: document.getElementById('cnMenuBtn').getAttribute('aria-expanded'), items: [...l.querySelectorAll('[role="menuitem"]')].map(i => i.textContent.trim() + ':' + Math.round(i.getBoundingClientRect().height)),
               foco: document.activeElement && document.activeElement.textContent.trim(), dentro: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top >= 0, tapa: (function() { const t = document.querySelector('.cn-pantalla .kpi-fila'); return t ? Math.round(t.getBoundingClientRect().top) : null; })() }; });
    chk('★ [' + ancho + '] ⋮ abre el menú con «Exportar a Excel» y «Reglas del cálculo» (44 px), enfoca la primera opción y queda DENTRO de la pantalla', n1.abierto && n1.exp === 'true' && n1.items.join('|') === 'Exportar a Excel:44|Reglas del cálculo:44' && n1.foco === 'Exportar a Excel' && n1.dentro, JSON.stringify(n1));
    await p.keyboard.press('ArrowDown'); await p.waitForTimeout(50);
    chk('[' + ancho + '] Flecha abajo pasa a «Reglas del cálculo»', await p.evaluate(() => document.activeElement.textContent.trim() === 'Reglas del cálculo'));
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    chk('[' + ancho + '] Esc cierra el menú y regresa el foco al ⋮', await p.evaluate(() => document.getElementById('cnMenuLista').hidden && document.activeElement && document.activeElement.id === 'cnMenuBtn'));
    await p.click('#cnMenuBtn'); await p.waitForTimeout(100); await p.click('.cn-pantalla .pg-cab__tit'); await p.waitForTimeout(100);
    chk('[' + ancho + '] Tocar fuera cierra el menú', await p.evaluate(() => document.getElementById('cnMenuLista').hidden));
    if (ancho === 360) {
      await p.click('#cnMenuBtn'); await p.waitForTimeout(100);
      const exN = await descargar(p, () => p.click('#cnMenuLista [data-cn-accion="exportar"]'));
      if (!exN) NOVERIF.push('Excel de Control de negativos (SheetJS no disponible)');
      else {
        const aoa = X.utils.sheet_to_json(exN.wb.Sheets['Control de negativos'], { header: 1, defval: null });
        const filas = await p.evaluate(() => _cnDatos().filas.map(f => f.id + ':' + f.total));
        chk('★ Control de negativos · «Exportar a Excel» DESDE EL MENÚ descarga un .xlsx real con las 13 columnas y una fila por insumo', /^Control_de_negativos_\d{4}-\d{2}-\d{2}\.xlsx$/.test(exN.nombre) && exN.zip && aoa[0].length === 13 && aoa[0][0] === 'Grupo' && aoa[0][12] === 'Valor pendiente'
            && aoa.length - 1 === filas.length && aoa.slice(1).map(r => r[1] + ':' + r[4]).sort().join(',') === filas.slice().sort().join(','), JSON.stringify({ n: exN.nombre, cab: aoa[0], filas }));
        chk('Excel: hoja «Información» con el corte de partida', !!exN.wb.Sheets['Información']);
      }
      chk('Después de exportar el menú queda cerrado', await p.evaluate(() => document.getElementById('cnMenuLista').hidden));
      await p.click('#cnMenuBtn'); await p.click('#cnMenuLista [data-cn-accion="reglas"]'); await p.waitForTimeout(200);
      chk('«Reglas del cálculo» abre las reglas de la pantalla', await p.evaluate(() => document.querySelector('.cn-reglas').open));
      await p.click('.cn-pantalla .sbx-chips button:nth-child(3)'); await p.waitForTimeout(150);
      chk('Los filtros siguen funcionando (Con consumo) y el ⋮ sigue en su lugar', await p.evaluate(() => _cn.filtro === 'todos' && !!document.getElementById('cnMenuBtn')));
      await p.click('.pg-cab .mc-cab__volver'); await p.waitForTimeout(150);
      chk('Volver regresa a Ventas', await p.evaluate(() => !controlNegativosActivo() && !!document.querySelector('.vs-seg')));
    }
    chk('[' + ancho + '] Control de negativos: sin errores de JavaScript', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  ({ ctx, p, errs } = await abrir(nav, 390, { permisos: ['sales.read', 'purchases.read'] }));
  await p.evaluate(() => { activeTab = 'ventas'; renderTab(); controlNegativosAbrir(); }); await p.waitForTimeout(200);
  await p.click('#cnMenuBtn'); await p.waitForTimeout(100);
  chk('★ Permisos: sin inventory.export el menú NO trae «Exportar» (solo las reglas) y la función se niega', await p.evaluate(() => !document.getElementById('cnExportBtn') && [...document.querySelectorAll('#cnMenuLista [role="menuitem"]')].map(i => i.textContent.trim()).join('|') === 'Reglas del cálculo' && controlNegativosExportarExcel().motivo === 'sin_permiso'));
  await ctx.close();
  ({ ctx, p, errs } = await abrir(nav, 390, { permisos: ['sales.read'] }));
  await p.evaluate(() => { activeTab = 'ventas'; renderTab(); controlNegativosAbrir(); }); await p.waitForTimeout(200);
  chk('Permisos: sin purchases.read dice «Sin permiso» y no hay menú', await p.evaluate(() => /Sin permiso/.test(document.querySelector('.cn-pantalla').textContent) && !document.getElementById('cnMenuBtn')));
  await ctx.close();
  ({ ctx, p, errs } = await abrir(nav, 390, { sinCorte: true }));
  await p.evaluate(() => { activeTab = 'ventas'; renderTab(); controlNegativosAbrir(); }); await p.waitForTimeout(200);
  chk('★ Sin corte vigente: el vacío ofrece «Ir a Inventario» (quien puede contabilizar) y no hay menú', await p.evaluate(() => /Sin corte vigente/.test(document.querySelector('.cn-pantalla').textContent) && !!document.querySelector('.cn-ir') && !document.getElementById('cnMenuBtn')));
  await p.click('.cn-ir'); await p.waitForTimeout(200);
  chk('«Ir a Inventario» lleva a Inventario', await p.evaluate(() => activeTab === 'inventario' && !controlNegativosActivo()));
  await ctx.close();
  ({ ctx, p, errs } = await abrir(nav, 390, { sinCorte: true, permisos: ['sales.read', 'purchases.read'] }));
  await p.evaluate(() => { activeTab = 'ventas'; renderTab(); controlNegativosAbrir(); }); await p.waitForTimeout(200);
  chk('Sin inventory.post no se ofrece «Ir a Inventario»', await p.evaluate(() => !document.querySelector('.cn-ir')));
  await ctx.close();

  // ═══ 5 · VENTA POR TURNO: mismo texto de pesos ═══════════════════════════
  ({ ctx, p, errs } = await abrir(nav, 390));
  const vt = await p.evaluate(() => [1480, -250, 0, 0.5, 1234567.891, 99.995, -12.345].map(n => [_vtMoneda(n), n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 })]));
  chk('★ D6 · Venta por turno: el formateador común da EXACTAMENTE el mismo texto que antes ($1,480.00, -$250.00…)', vt.every(([a, b]) => a === b) && vt[0][0] === '$1,480.00' && vt[1][0] === '-$250.00', JSON.stringify(vt));
  // Única diferencia, a propósito: un negativo que redondea a cero ya no sale «-$0.00».
  chk('Venta por turno: un negativo que redondea a cero ahora dice «$0.00» (antes «-$0.00»)', await p.evaluate(() => _vtMoneda(-0.004) === '$0.00'));
  await ctx.close();

  // ═══ 6 · Matriz visual: 360 / 412 / 1440 × oscuro / claro ════════════════
  for (const ancho of [360, 412, 1440]) {
    for (const tema of ['dark', 'light']) {
      ({ ctx, p, errs } = await abrir(nav, ancho, {}, tema));
      const res = {};
      await p.evaluate(() => { activeTab = 'ventas'; renderTab(); }); await p.waitForTimeout(200); res.ventas = await p.evaluate(MEDIR, '.vs-pantalla');
      await p.evaluate(() => { controlNegativosAbrir(); }); await p.waitForTimeout(200); await p.click('#cnMenuBtn'); await p.waitForTimeout(100); res.negativos = await p.evaluate(MEDIR, '.cn-pantalla');
      await p.evaluate(() => { controlNegativosCerrar(); activeTab = 'pedido_sugerido'; renderTab(); }); await p.waitForTimeout(250); res.pedido = await p.evaluate(MEDIR, '.ps-pantalla');
      const malo = Object.keys(res).filter(k => !res[k] || res[k].desborde || res[k].chicos.length || res[k].textoChico.length);
      chk('[' + ancho + ' ' + (tema === 'dark' ? 'oscuro' : 'claro') + '] Ventas, Control de negativos (menú abierto) y Pedido sugerido: sin desborde, objetivos ≥ 44 px y texto ≥ 12 px', malo.length === 0,
          JSON.stringify(malo.map(k => [k, res[k]])));
      chk('[' + ancho + ' ' + (tema === 'dark' ? 'oscuro' : 'claro') + '] sin errores de JavaScript', errs.length === 0, errs.join(' | '));
      await ctx.close();
    }
  }

  await nav.close();
  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── v5.61 · Ventas, Pedido sugerido y Control de negativos (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  NOVERIF.forEach(n => console.log('  ⚪  NO VERIFICADO: ' + n));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron' + (NOVERIF.length ? ' · ' + NOVERIF.length + ' sin verificar' : '') + '\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
