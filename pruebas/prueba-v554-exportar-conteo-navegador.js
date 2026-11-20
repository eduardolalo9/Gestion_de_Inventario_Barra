// v5.54 — Exportar / compartir el conteo activo en Chromium real (390 px): botón en la ventana Inventario, hoja de
// opciones, descarga REAL de PDF y Excel, compartir con navigator.share (simulado), cancelar, alternativa de descarga,
// permisos y que exportar no modifica ningún dato. Con CSP_ESTRICTO=1 corre bajo la política final (sin 'unsafe-inline').
//   npm run test:navegador   (o:  PUERTO=8080 node pruebas/prueba-v554-exportar-conteo-navegador.js)
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const CAPTURAS = process.env.CAPTURAS_DIR || '';
const FAKE = () => {
  const vacio = { exists: false, docs: [], empty: true, size: 0, forEach() {}, data() { return {}; }, docChanges() { return []; } };
  const mk = () => new Proxy(function () {}, { get(_, k) { if (k === 'then') return undefined; if (k === 'get') return async () => vacio; if (k === 'onSnapshot') return () => () => {}; return () => mk(); } });
  _db = { collection: () => mk(), batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }), runTransaction: async () => {} };
};
const MONTAR = () => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u'; currentUserRole = 'admin'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
  _lastUserData = { role: 'admin', displayName: 'Eduardo Admin', email: 'admin@bar.mx' };
  const P = (id, name, group, extra) => Object.assign({ id, name, group, unit: 'BOT', precio: 100, stockMinimo: 1, conversion: 1, stockByArea: { almacen: 0, barra1: 0, barra2: 0 } }, extra);
  products = [
    P('T1', 'TEQUILA 1800 AÑEJO 700 ML', 'TEQUILA', { capacidadMl: 750, pesoBotellaLlenaOz: 55, conteoOzHabilitado: true }),
    P('T2', 'TEQUILA DON JULIO 70', 'TEQUILA'),
    P('R1', 'RON BACARDI BLANCO', 'RON'),
    P('R2', 'RON ZACAPA 23', 'RON'),
    P('W1', 'WHISKY BUCHANAN\'S 12 <b>X</b>', 'WHISKY')
  ];
  // vidrio = 55 − 750/29.5735 = 29.64 oz; una abierta a 42.32 oz tiene ≈ 0.5 de botella
  auditoriaConteo = {
    T1: { almacen: { enteras: 2, abiertas: [42.32] }, barra1: { enteras: 1, abiertas: [] } },
    R1: { almacen: { enteras: 4, abiertas: [] }, barra1: { enteras: 2, abiertas: [] }, barra2: { enteras: 1, abiertas: [] } },
    R2: { barra2: { enteras: 3, abiertas: [] } }
  };   // T2 y W1: nadie los contó → deben salir en ceros
  orders = []; inventories = []; compras = []; movimientos = []; costosUltimos = {}; cart = [];
  _inventarioActivo = { numero: 7, estado: 'SINCRONIZADO', fechaCreacion: new Date().toISOString() };
  isAuditoriaMode = true; auditoriaView = 'seleccion'; auditoriaAreaActiva = null; activeTab = 'inventario'; renderTab();
};
(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = [], viol = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  // Con la política estricta el navegador anota cada manejador en línea que NO ejecuta (los corre el despachador, js/02):
  // eso es lo esperado y no cuenta. Sí cuenta cualquier script, fuente o conexión bloqueados.
  p.on('console', m => { if (/Content Security Policy|violates the following/i.test(m.text()) && !/inline event handler/i.test(m.text())) viol.push(m.text().slice(0, 200)); });
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600);
  await p.evaluate(FAKE); await p.evaluate(MONTAR); await p.waitForTimeout(400);

  // ═══ 1 · El botón en la ventana Inventario ═══
  const btn = p.locator('#cxAbrirBtn');
  chk('★ La ventana Inventario muestra el botón «Exportar / Compartir conteo»', await btn.count() === 1 && /Exportar \/ Compartir conteo/.test(await btn.innerText()));
  const caja = await btn.boundingBox();
  chk('El botón mide ≥ 44 px de alto y cabe en la pantalla (390 px)', caja && caja.height >= 44 && caja.x >= 0 && caja.x + caja.width <= 390, JSON.stringify(caja));
  if (CAPTURAS) { await p.screenshot({ path: path.join(CAPTURAS, 'ventana-inventario-390.png') }); }
  chk('Antes de abrir la hoja, jsPDF NO está cargada (carga bajo demanda)', await p.evaluate(() => typeof window.jspdf === 'undefined'));
  const antes = await p.evaluate(() => JSON.stringify({ p: products, c: auditoriaConteo, ls: Object.keys(localStorage).sort().map(k => k + '=' + localStorage.getItem(k)) }));

  // Permisos: sin viewAll (conteo ciego) o sin export, o sin inventario abierto → no hay botón
  const sinBoton = async (prep) => { await p.evaluate(prep); await p.evaluate(() => renderTab()); await p.waitForTimeout(150); const n = await p.locator('#cxAbrirBtn').count(); await p.evaluate(() => { currentUserRole = 'admin'; _authzState.permissions = new Set(['*']); _inventarioActivo = { numero: 7, estado: 'SINCRONIZADO' }; renderTab(); }); await p.waitForTimeout(150); return n; };
  chk('★ Sin inventory.viewAll (cuenta a ciegas) el botón no aparece', await sinBoton(() => { _authzState.permissions = new Set(['inventory.export']); currentUserRole = 'user'; }) === 0);
  chk('Sin inventory.export el botón no aparece', await sinBoton(() => { _authzState.permissions = new Set(['inventory.viewAll']); currentUserRole = 'user'; }) === 0);
  chk('Sin inventario abierto (cerrado / ninguno) el botón no aparece', await sinBoton(() => { _inventarioActivo = null; }) === 0 && await sinBoton(() => { _inventarioActivo = { numero: 7, estado: 'CERRADO' }; }) === 0);
  chk('(preparación) con permisos completos el botón vuelve', await p.locator('#cxAbrirBtn').count() === 1);

  // ═══ 2 · La hoja de opciones ═══
  await p.locator('#cxAbrirBtn').click(); await p.waitForTimeout(500);
  chk('★ Se abre la hoja «Exportar conteo activo» como diálogo modal accesible', await p.evaluate(() => { const h = document.querySelector('#cxOverlay .cx-hoja'); return !!h && h.getAttribute('role') === 'dialog' && h.getAttribute('aria-modal') === 'true' && /Exportar conteo activo/.test(h.innerText); }));
  chk('★ Se cargó jsPDF al abrir la hoja (precarga) desde el mismo origen', await p.evaluate(() => !!(window.jspdf && window.jspdf.jsPDF)));
  chk('Dice el inventario (#7) y que incluye las botellas abiertas convertidas', /Inventario #7/.test(await p.locator('.cx-sub').innerText()) && /convertidas/.test(await p.locator('.cx-sub').innerText()));
  const areas = await p.evaluate(() => [...document.querySelectorAll('.cx-area')].map(b => [b.querySelector('span').textContent, b.getAttribute('aria-pressed')]));
  chk('★ Las 3 áreas vienen incluidas (Almacén, Barra Restaurante, Barra Bar)', areas.length === 3 && areas.every(a => a[1] === 'true') && areas.map(a => a[0]).join('|') === 'Almacén|Barra Restaurante|Barra Bar', JSON.stringify(areas));
  const textoHoja = await p.locator('.cx-hoja').innerText();
  chk('Están las 4 opciones: Descargar PDF, Compartir PDF, Compartir Excel y Descargar Excel', ['Descargar PDF', 'Compartir PDF', 'Compartir Excel', 'Descargar Excel'].every(t => textoHoja.indexOf(t) !== -1), textoHoja.replace(/\n+/g, ' | ').slice(0, 200));
  const cajas = await p.evaluate(() => [...document.querySelectorAll('.cx-opc, .cx-area, .cx-cerrar')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.height), Math.round(r.left), Math.round(r.right)]; }));
  chk('★ Todos los botones de la hoja miden ≥ 44 px y caben en 390 px', cajas.every(c => c[0] >= 44 && c[1] >= 0 && c[2] <= 390), JSON.stringify(cajas.filter(c => c[0] < 44 || c[2] > 390)));
  chk('La hoja no provoca desplazamiento horizontal', await p.evaluate(() => document.documentElement.scrollWidth <= 390));
  if (CAPTURAS) { await p.screenshot({ path: path.join(CAPTURAS, 'hoja-exportar-390.png') }); }
  // Áreas: alternar y proteger la última
  await p.locator('.cx-area').nth(2).click(); await p.waitForTimeout(100);
  chk('Quitar «Barra Bar» la deja no incluida (aria-pressed=false)', await p.evaluate(() => document.querySelectorAll('.cx-area')[2].getAttribute('aria-pressed') === 'false'));
  await p.locator('.cx-area').nth(0).click(); await p.locator('.cx-area').nth(1).click(); await p.waitForTimeout(100);
  chk('★ Nunca se puede quitar la última área (queda al menos una incluida)', await p.evaluate(() => [...document.querySelectorAll('.cx-area')].filter(b => b.getAttribute('aria-pressed') === 'true').length === 1));
  await p.locator('.cx-area').nth(0).click(); await p.locator('.cx-area').nth(2).click(); await p.waitForTimeout(100);
  chk('Volver a incluir las áreas las deja las 3 activas', await p.evaluate(() => [...document.querySelectorAll('.cx-area')].every(b => b.getAttribute('aria-pressed') === 'true')));
  // Cerrar: Escape y velo
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  chk('Escape cierra la hoja y devuelve el foco al botón de la ventana', await p.locator('#cxOverlay').count() === 0 && await p.evaluate(() => document.activeElement && document.activeElement.id === 'cxAbrirBtn'));
  await p.locator('#cxAbrirBtn').click(); await p.waitForTimeout(200);
  await p.locator('.cx-velo').click({ position: { x: 20, y: 20 } }); await p.waitForTimeout(150);
  chk('Tocar fuera de la hoja (el velo) también la cierra', await p.locator('#cxOverlay').count() === 0);

  // ═══ 3 · Descargar PDF (descarga REAL) ═══
  await p.locator('#cxAbrirBtn').click(); await p.waitForTimeout(300);
  await p.evaluate(() => { notificationTimeout = null; });   // el aviso informativo se descarta si hay otro reciente
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.locator('.cx-opc--pri').click()]);
  const rutaPdf = path.join(dir, dl.suggestedFilename()); await dl.saveAs(rutaPdf);
  const pdf = fs.readFileSync(rutaPdf);
  chk('★ Descargar PDF baja «Conteo_activo_AAAA-MM-DD.pdf»', /^Conteo_activo_\d{4}-\d{2}-\d{2}\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  chk('★ El archivo es un PDF válido de 1 hoja A4 (595 × 842 pt)', pdf.slice(0, 5).toString() === '%PDF-' && (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length === 1 && /\/MediaBox\s*\[\s*0\s+0\s+595\.\d+\s+841\.\d+\s*\]/.test(pdf.toString('latin1')));
  await p.waitForTimeout(300);
  chk('Tras descargar la hoja se cierra y avisa con el nombre del archivo y los 5 productos', await p.locator('#cxOverlay').count() === 0 && /Conteo_activo_.*5 producto/.test(await p.locator('#toastMessage').textContent()));
  // La cifra convertida del PDF es la de la app (Físico vs Sistema)
  const datos = await p.evaluate(() => {
    const filas = conteoExportFilas(products, (pr) => fvsConteoPorArea(pr.id), ['almacen', 'barra1', 'barra2']);
    const t1 = filas.find(f => f.id === 'T1');
    const pura = Math.round((2 + 1 + convertirOzAPuntos(42.32, 750, 55)) * 1000) / 1000;
    return { orden: filas.map(f => f.id).join(','), t1total: t1.total, t1alm: t1.cols[0], pura: pura, fisico: fvsConteoFisicoProducto('T1'),
             ceros: filas.filter(f => !f.contado).map(f => f.id + ':' + f.total).join(',') };
  });
  chk('★ La conversión coincide con la de la app: T1 = 2 enteras + 1 (otra área) + (42.32 oz → ≈0.5) = fvsConteoFisicoProducto', datos.t1total === datos.fisico && Math.abs(datos.t1total - datos.pura) < 0.0015 && datos.t1alm.enteras === 2 && datos.t1alm.abiertas > 0.45 && datos.t1alm.abiertas < 0.55, JSON.stringify(datos));
  chk('★ Los productos que nadie contó (T2, W1) salen en CEROS', datos.ceros === 'T2:0,W1:0' || datos.ceros === 'W1:0,T2:0', datos.ceros);
  chk('Orden por grupo y nombre: RON (R1, R2), TEQUILA (T2, T1: DON JULIO antes de 1800), WHISKY (W1)', datos.orden === 'R1,R2,T1,T2,W1' || datos.orden === 'R1,R2,T2,T1,W1', datos.orden);

  // ═══ 4 · Descargar Excel (descarga REAL) y lectura con SheetJS ═══
  await p.locator('#cxAbrirBtn').click(); await p.waitForTimeout(300);
  const [dx] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.getByRole('button', { name: /Descargar Excel/ }).click()]);
  const rutaX = path.join(dir, dx.suggestedFilename()); await dx.saveAs(rutaX);
  const xb64 = fs.readFileSync(rutaX).toString('base64');
  const x = await p.evaluate((b) => { const wb = XLSX.read(b, { type: 'base64' }); const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); return { hojas: wb.SheetNames, aoa: aoa }; }, xb64);
  chk('★ Descargar Excel baja «Conteo_activo_AAAA-MM-DD.xlsx» con las hojas «Conteo activo» e «Información»', /^Conteo_activo_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dx.suggestedFilename()) && x.hojas.join('|') === 'Conteo activo|Información', dx.suggestedFilename() + ' ' + x.hojas.join('|'));
  chk('El Excel trae 5 productos y la columna «Total conv.» de T1 coincide con la del PDF', x.aoa.length === 6 && Math.abs(x.aoa.find(f => f[1] === 'T1')[13] - datos.t1total) < 0.0015, JSON.stringify(x.aoa.map(f => f[1] + ':' + f[13])));
  chk('★ En el Excel los no contados llevan 0 y estado «Sin conteo (0)»', x.aoa.filter(f => f[14] === 'Sin conteo (0)').length === 2 && x.aoa.filter(f => f[14] === 'Sin conteo (0)').every(f => f[13] === 0));
  chk('Un nombre con HTML («<b>X</b>») viaja como texto en el Excel y no se ejecuta en la hoja', x.aoa.some(f => /<b>X<\/b>/.test(f[2])));

  // ═══ 5 · Compartir (navigator.share simulado) ═══
  await p.evaluate(() => { window.__sh = null; window.__shN = 0; navigator.canShare = () => true; navigator.share = async (d) => { window.__shN++; window.__sh = { files: (d.files || []).map(f => ({ n: f.name, t: f.type, s: f.size })), title: d.title }; }; });
  let bajo = 0; const contar = () => { bajo++; }; p.on('download', contar);
  await p.locator('#cxAbrirBtn').click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Compartir PDF/ }).click(); await p.waitForTimeout(1200);
  const shP = await p.evaluate(() => window.__sh);
  chk('★ Compartir PDF abre el menú del aparato con UN archivo .pdf (application/pdf) con contenido', shP && shP.files.length === 1 && /\.pdf$/.test(shP.files[0].n) && shP.files[0].t === 'application/pdf' && shP.files[0].s > 1500, JSON.stringify(shP));
  chk('★ Al compartir NO se descarga nada además (una sola salida) y la hoja se cierra', bajo === 0 && await p.locator('#cxOverlay').count() === 0, 'descargas: ' + bajo);
  await p.evaluate(() => { window.__sh = null; });
  await p.locator('#cxAbrirBtn').click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Compartir Excel/ }).click(); await p.waitForTimeout(1200);
  const shX = await p.evaluate(() => window.__sh);
  chk('★ Compartir Excel comparte un .xlsx con el tipo correcto', shX && shX.files.length === 1 && /\.xlsx$/.test(shX.files[0].n) && /spreadsheetml\.sheet$/.test(shX.files[0].t) && shX.files[0].s > 1500, JSON.stringify(shX));
  // Cancelar el menú de compartir (AbortError): sin error, sin descarga, la hoja sigue abierta y los botones se liberan
  await p.evaluate(() => { navigator.share = async () => { const e = new Error('cancelado'); e.name = 'AbortError'; throw e; }; });
  await p.locator('#cxAbrirBtn').click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Compartir PDF/ }).click(); await p.waitForTimeout(1000);
  chk('★ Cerrar el menú de compartir (AbortError) no es error: no descarga y la hoja sigue para elegir otra opción', bajo === 0 && await p.locator('#cxOverlay').count() === 1 && await p.evaluate(() => [...document.querySelectorAll('.cx-opc')].every(b => !b.disabled)));
  // Si el aparato no puede compartir archivos → se descarga y se avisa
  await p.evaluate(() => { navigator.canShare = () => false; });
  const [dAlt] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.getByRole('button', { name: /Compartir PDF/ }).click()]);
  chk('★ Sin soporte de compartir archivos, «Compartir PDF» descarga el archivo y lo dice', /\.pdf$/.test(dAlt.suggestedFilename()));
  await p.waitForTimeout(400);
  chk('El aviso explica que el aparato no permite compartir y que se descargó', /no permite compartir archivos; se descargó/.test(await p.evaluate(() => document.body.innerText)));
  p.off('download', contar);

  // ═══ 6 · Doble toque, cantidad de hojas y que no se modifica ningún dato ═══
  await p.evaluate(() => { navigator.canShare = () => false; });
  await p.locator('#cxAbrirBtn').click(); await p.waitForTimeout(300);
  let n2 = 0; const c2 = () => { n2++; }; p.on('download', c2);
  await p.evaluate(() => { const b = document.querySelector('.cx-opc--pri'); b.click(); b.click(); b.click(); });
  await p.waitForTimeout(2500); p.off('download', c2);
  chk('★ Tres toques seguidos en «Descargar PDF» generan UN solo archivo', n2 === 1, 'descargas: ' + n2);
  const despues = await p.evaluate(() => JSON.stringify({ p: products, c: auditoriaConteo, ls: Object.keys(localStorage).sort().map(k => k + '=' + localStorage.getItem(k)) }));
  chk('★ Exportar NO modifica nada: ni productos, ni conteos, ni localStorage', antes === despues);
  // Muchos productos: varias hojas A4 con el nombre del inventario
  await p.evaluate(() => {
    const G = ['TEQUILA', 'RON', 'WHISKY', 'VODKA', 'GINEBRA', 'MEZCAL', 'CERVEZA', 'VINO'];
    products = []; auditoriaConteo = {};
    for (let i = 0; i < 150; i++) { const id = 'P' + (1000 + i); products.push({ id, name: G[i % 8] + ' MARCA ' + i, group: G[i % 8], unit: 'BOT', stockByArea: {} }); if (i % 4) auditoriaConteo[id] = { almacen: { enteras: i % 9, abiertas: [] }, barra1: { enteras: 1, abiertas: [] } }; }
    renderTab();
  });
  await p.waitForTimeout(300); await p.locator('#cxAbrirBtn').click(); await p.waitForTimeout(300);
  const [dm] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.locator('.cx-opc--pri').click()]);
  const rutaM = path.join(dir, 'muchos.pdf'); await dm.saveAs(rutaM);
  const hojasM = (fs.readFileSync(rutaM).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  chk('★ 150 productos → varias hojas A4 (4 a 6), todas en un solo PDF', hojasM >= 4 && hojasM <= 6, 'hojas: ' + hojasM);
  chk('Sin errores de JavaScript en toda la prueba', errs.length === 0, errs.join(' | '));
  chk('Sin violaciones de CSP (jsPDF se carga de «self», sin dominios nuevos)', viol.length === 0, viol.join(' | '));

  if (CAPTURAS) {
    fs.copyFileSync(rutaPdf, path.join(CAPTURAS, 'conteo-ejemplo.pdf'));
    fs.copyFileSync(rutaX, path.join(CAPTURAS, 'conteo-ejemplo.xlsx'));
  }
  await nav.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const fallos = C.filter(c => !c.ok);
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + ' ' + c.n + (c.ok ? '' : '  ←  ' + c.d)));
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron\n');
  process.exit(fallos.length ? 1 : 0);
})();
