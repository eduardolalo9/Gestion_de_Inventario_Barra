// v5.50 — Pedidos: opción «Conteo de todas las áreas». Chromium real, 390 px.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const FAKE = () => {
  const vacio = { exists: false, docs: [], empty: true, size: 0, forEach() {}, data() { return {}; }, docChanges() { return []; } };
  const mk = () => new Proxy(function () {}, { get(_, k) { if (k === 'then') return undefined; if (k === 'get') return async () => vacio; if (k === 'onSnapshot') return () => () => {}; return () => mk(); } });
  _db = { collection: () => mk(), batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }), runTransaction: async () => {} };
};
const MONTAR = () => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u'; currentUserRole = 'admin'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
  const P = (id, name, extra) => Object.assign({ id, name, group: 'TEQUILA', unit: 'PZA', precio: 100, stockMinimo: 10, conversion: 1 }, extra);
  products = [
    P('A', 'PRODUCTO A', { stockByArea: { almacen: 3, barra1: 1 } }),             // sistema 20 · conteo 4
    P('B', 'PRODUCTO B', { stockByArea: { almacen: 8, barra1: 7, barra2: 0 } }),  // sistema 2  · conteo 15
    P('C', 'PRODUCTO C'),                                                         // sin conteo
    P('D', 'PRODUCTO D', { stockByArea: { almacen: 3 } })                         // sistema 3  · conteo 3
  ];
  const sis = { A: 20, B: 2, C: 20, D: 3 };
  window.existenciaMostrada = (p) => sis[p.id];
  orders = []; inventories = []; compras = []; movimientos = []; costosUltimos = {}; cart = [];
  window.openOrderModal = () => { window.__modal = true; };
  activeTab = 'pedidos'; renderTab();
};
const ids = (p) => p.evaluate(() => Array.from(document.querySelectorAll('.ps-card .ps-card__cod')).map(e => e.textContent.trim()).join(','));
(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600);
  await p.evaluate(FAKE); await p.evaluate(MONTAR); await p.waitForTimeout(300);

  // ── Base «sistema» (por defecto)
  const pill = (f) => p.locator('[data-ps-fuente="' + f + '"]');
  chk('Existen los dos botones de base: «Existencia del sistema» y «Conteo de todas las áreas»', await pill('sistema').count() === 1 && await pill('conteo').count() === 1);
  chk('★ Por defecto está activa la existencia del sistema (aria-pressed)', await pill('sistema').getAttribute('aria-pressed') === 'true' && await pill('conteo').getAttribute('aria-pressed') === 'false');
  chk('Con la base del sistema se pide B (2), C (20→no) y D (3): tarjetas B y D', await ids(p) === 'B,D', await ids(p));
  chk('La nota explica la base en uso (sistema)', /existencia del sistema/i.test(await p.locator('#psFuenteNota').innerText()));
  chk('La etiqueta de la cifra dice «Stock»', (await p.locator('.ps-card__etq').first().textContent()).trim() === 'Stock');

  // Se escribe una cantidad y se cambia de base: debe descartarse
  await p.evaluate(() => { const i = document.querySelector('.ps-input'); i.value = '99'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  chk('(preparación) hay una cantidad escrita a mano sobre la base anterior', await p.evaluate(() => Object.keys(_ps.cantidades).length === 1));

  // ── Cambiar a «conteo»
  await pill('conteo').click(); await p.waitForTimeout(300);
  chk('★ Con el conteo de todas las áreas se pide A (4→6) y D (3→7); B (15) ya no y C (sin conteo) tampoco', await ids(p) === 'A,D', await ids(p));
  chk('El botón de conteo queda activo y el del sistema apagado', await pill('conteo').getAttribute('aria-pressed') === 'true' && await pill('sistema').getAttribute('aria-pressed') === 'false');
  chk('La etiqueta de la cifra cambia a «Conteo»', (await p.locator('.ps-card__etq').first().textContent()).trim() === 'Conteo');
  const nota = await p.locator('#psFuenteNota').innerText();
  chk('★ La nota avisa del producto sin conteo (no se sugiere) y de la base usada', /conteo físico total/i.test(nota) && /1 producto con mínimo sin conteo/.test(nota), nota);
  chk('★ Al cambiar de base se descartó la cantidad escrita (99) y los sugeridos son los del conteo',
      await p.evaluate(() => Object.keys(_ps.cantidades).length === 0 && Array.from(document.querySelectorAll('.ps-input')).map(i => i.value).join(',') === '6,7'));
  chk('Todo lo sugerido queda marcado para el pedido', await p.evaluate(() => Array.from(document.querySelectorAll('.ps-check')).every(c => c.getAttribute('aria-checked') === 'true')));
  chk('La barra inferior suma lo del conteo: 2 productos · $1,300 (6×100 + 7×100)', /2 productos/.test(await p.locator('#ps-pie').innerText()) && /1,300/.test(await p.locator('#ps-pie').innerText()), await p.locator('#ps-pie').innerText());

  // ── Generar el pedido con la base de conteo
  await p.locator('[data-ps-accion="generar"]').click(); await p.waitForTimeout(250);
  const carro = await p.evaluate(() => ({ cart: cart.map(c => [c.id, c.quantity != null ? c.quantity : c.cantidad]), modal: !!window.__modal }));
  chk('★ «Generar pedido» llena el carrito con las cantidades del conteo (A 6, D 7) y abre el pedido', JSON.stringify(carro.cart) === '[["A",6],["D",7]]' && carro.modal, JSON.stringify(carro));

  // ── Objetivos táctiles y contraste de la nota
  const m = await p.evaluate(() => {
    const alto = (s) => Math.round(document.querySelector(s).getBoundingClientRect().height);
    const n = document.getElementById('psFuenteNota'); const cs = getComputedStyle(n);
    return { sis: alto('[data-ps-fuente="sistema"]'), con: alto('[data-ps-fuente="conteo"]'), overflow: document.documentElement.scrollWidth > innerWidth + 1, color: cs.color };
  });
  chk('★ Los botones de base miden ≥ 44 px de alto (táctil)', m.sis >= 44 && m.con >= 44, JSON.stringify(m));
  chk('Sin desbordamiento horizontal a 390 px', !m.overflow);

  // ── Volver al sistema
  await pill('sistema').click(); await p.waitForTimeout(300);
  chk('★ Volver a «Existencia del sistema» restablece B y D', await ids(p) === 'B,D', await ids(p));

  // ── Exportación: misma base
  const filasConteo = await p.evaluate(() => { _ps.fuente = 'conteo'; return pedidoSugeridoExportFilas(pedidoSugeridoFilas(products, { soloBajo: true, fuente: _ps.fuente }), (f) => f.sugerido).map(f => f.id + ':' + f.cantidad).join(','); });
  chk('La exportación con base «conteo» lleva A:6 y D:7', filasConteo === 'A:6,D:7', filasConteo);
  chk('Sin errores de página', errs.length === 0, errs.join(' | '));
  await nav.close();
  const fallos = C.filter(c => !c.ok);
  C.forEach(c => console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  ← ' + c.d)));
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
  process.exit(fallos.length ? 1 : 0);
})();
