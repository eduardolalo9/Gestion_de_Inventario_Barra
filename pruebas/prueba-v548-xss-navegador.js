// v5.48 — Auditoría C-1 en Chromium REAL: un id de pedido o de producto con sintaxis JavaScript ya no
// ejecuta código al tocar el botón, y la función recibe el id literal. (Antes: escapeHtml dentro de
// onclick → el navegador decodificaba &#039; y la cadena JS se cerraba.)
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const ATAQUE_PEDIDO = "x');window.__pwn=1;//";
const ATAQUE_PROD = "p');window.__pwn=2;//";

const FAKE = () => {
  const vacio = { exists: false, docs: [], empty: true, size: 0, forEach() {}, data() { return {}; }, docChanges() { return []; } };
  const mk = () => new Proxy(function () {}, { get(_, k) { if (k === 'then') return undefined; if (k === 'get') return async () => vacio; if (k === 'onSnapshot') return () => () => {}; return () => mk(); } });
  _db = { collection: () => mk(), batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }), runTransaction: async () => {} };
};
const MONTAR = (a) => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u'; currentUserRole = 'admin'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
  window.__pwn = 0; window.__got = {};
  products = [{ id: a.prod, name: 'PRODUCTO DE PRUEBA', group: "GRUPO');window.__pwn=3;//", unit: 'PZA', precio: 10, stockMinimo: 1, conversion: 1, stockByArea: { almacen: 1 } }];
  orders = [{ id: a.pedido, date: '13/11/2026, 10:42:11 a. m.', supplier: 'PROVEEDOR', total: 1, products: [{ id: a.prod, name: 'PRODUCTO DE PRUEBA', unit: 'PZA', quantity: 1 }] }];
  inventories = []; compras = []; movimientos = []; costosUltimos = {};
  ['shareOrderWhatsApp', 'deleteOrder', 'addToCart', 'editProduct', 'deleteProduct', 'updateSelectedGroup', 'agregarPedidoSugerido']
    .forEach(n => { window[n] = (...x) => { (window.__got[n] = window.__got[n] || []).push(x[0]); }; });
};
(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600);
  await p.evaluate(FAKE); await p.evaluate(MONTAR, { prod: ATAQUE_PROD, pedido: ATAQUE_PEDIDO });

  // ── Pedidos: tarjeta desplegada con los botones Compartir / Eliminar
  await p.evaluate((id) => abrirHistorialPedidos(id), ATAQUE_PEDIDO);
  await p.waitForTimeout(300);
  // Se despliega la tarjeta como lo haría el usuario: tocando su cabecera.
  const cab = p.locator('button[data-ped-accion="abrir"]').first();
  if (!(await p.locator('button[onclick*="shareOrderWhatsApp"]').first().isVisible().catch(() => false))) { await cab.click(); await p.waitForTimeout(200); }
  const btnShare = p.locator('button[onclick*="shareOrderWhatsApp"]').first();
  chk('El botón Compartir del pedido con id malicioso existe', await btnShare.count() === 1);
  await btnShare.click(); await p.waitForTimeout(100);
  await p.locator('button[onclick*="deleteOrder"]').first().click(); await p.waitForTimeout(100);
  let est = await p.evaluate(() => ({ pwn: window.__pwn, got: window.__got }));
  chk('★ Tocar Compartir y Eliminar NO ejecuta el código del id (window.__pwn sigue en 0)', est.pwn === 0, JSON.stringify(est));
  chk('★ shareOrderWhatsApp y deleteOrder reciben el id literal, completo y una sola vez', JSON.stringify(est.got.shareOrderWhatsApp) === JSON.stringify([ATAQUE_PEDIDO]) && JSON.stringify(est.got.deleteOrder) === JSON.stringify([ATAQUE_PEDIDO]), JSON.stringify(est.got));

  // ── Catálogo: tarjetas de producto (id y grupo maliciosos)
  await p.evaluate(() => { activeTab = 'productos'; renderTab(); });
  await p.waitForTimeout(300);
  for (const sel of ['editProduct', 'deleteProduct']) {
    const b = p.locator('button[onclick*="' + sel + '"]').first();
    if (await b.count()) { await b.evaluate(e => e.click()); await p.waitForTimeout(80); }
  }
  est = await p.evaluate(() => ({ pwn: window.__pwn, got: window.__got }));
  chk('★ Los botones de producto con id malicioso tampoco ejecutan código (window.__pwn sigue en 0)', est.pwn === 0, JSON.stringify(est));
  chk('editProduct / deleteProduct (tabla del catálogo) reciben el id literal del producto',
    ['editProduct', 'deleteProduct'].every(n => JSON.stringify(est.got[n]) === JSON.stringify([ATAQUE_PROD])), JSON.stringify(est.got));
  // ── Un id normal sigue funcionando igual
  await p.evaluate(MONTAR, { prod: 'DJ7', pedido: 'PED-003-ab12' });
  await p.evaluate(() => abrirHistorialPedidos('PED-003-ab12'));
  await p.waitForTimeout(250);
  if (!(await p.locator('button[onclick*="shareOrderWhatsApp"]').first().isVisible().catch(() => false))) { await p.locator('button[data-ped-accion="abrir"]').first().click(); await p.waitForTimeout(200); }
  await p.locator('button[onclick*="shareOrderWhatsApp"]').first().click(); await p.waitForTimeout(80);
  est = await p.evaluate(() => window.__got);
  chk('Un id normal (PED-003-ab12) llega intacto a shareOrderWhatsApp', JSON.stringify(est.shareOrderWhatsApp) === JSON.stringify(['PED-003-ab12']), JSON.stringify(est));
  chk('Sin errores de página', errs.length === 0, errs.join(' | '));
  await nav.close();
  const fallos = C.filter(c => !c.ok);
  C.forEach(c => console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  ← ' + c.d)));
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
  process.exit(fallos.length ? 1 : 0);
})();
