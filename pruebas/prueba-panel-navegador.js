// PREMIUM — panel de Inicio, ficha de producto y estado vacío de Conteo,
// ejecutados en Chromium contra la app real (sin mockear el panel).
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const PUERTO = process.env.PUERTO || '8080';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
  chk('La página carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = [
      { id: 'A', name: 'TEQUILA A', group: 'TEQUILA', unit: 'PZA', precio: 100, stockMinimo: 10, stockByArea: { almacen: 1, barra1: 1, barra2: 0 } },
      { id: 'B', name: 'RON B', group: 'RON', unit: 'PZA', precio: 50, stockMinimo: 4, stockByArea: { almacen: 2, barra1: 1, barra2: 0 } },
      { id: 'C', name: 'VODKA C', group: 'VODKA', unit: 'PZA', stockByArea: { almacen: 5, barra1: 0, barra2: 0 } },
      { id: 'X', name: '<img src=x onerror="window.__xss=1">', group: 'PRUEBA', unit: 'PZA', precio: 1, stockMinimo: 9, stockByArea: { almacen: 0, barra1: 0, barra2: 0 } }
    ];
    const sem = semanaId(new Date());
    compras = [{ compraId: 'C1', semanaId: sem, fecha: fechaISOLocal(new Date()), proveedorNombre: 'PROVEEDOR UNO', importe: 1200,
                 lineas: [{ productoId: 'A', cantidadInventario: 6, costoUnitario: 80 }] }];
    movimientos = [{ tipo: 'compra', productoId: 'A', cantidad: 6, semanaId: sem }];
    costosUltimos = { A: { costo: 80, fecha: fechaISOLocal(new Date()) } };
    cart = []; orders = []; _inventarioActivo = null;
    activeTab = 'inicio'; renderTab();
  });
  await p.waitForTimeout(300);

  const k = await p.evaluate(() => ({
    tiles: [...document.querySelectorAll('.pm-tile')].map(t => t.innerText.replace(/\s+/g, ' ').trim()),
    barras: [...document.querySelectorAll('.pm-barra')].map(b => b.innerText.replace(/\s+/g, ' ').trim())
  }));
  chk('Panel: 6 indicadores (productos, bajo mínimo, valor, compras, carrito, pedidos)', k.tiles.length === 6, JSON.stringify(k.tiles));
  chk('Bajo mínimo cuenta 3 (A, B y el de prueba)', /3 BAJO M[ÍI]NIMO/i.test(k.tiles[1]), k.tiles[1]);
  chk('Valor en existencia = 2×100 + 3×50 + 0×1 = $350', /\$350/.test(k.tiles[2]), k.tiles[2]);
  chk('Compras de la semana muestran el importe', /\$1,200/.test(k.tiles[3]), k.tiles[3]);
  chk('La gráfica de bajo mínimo pone primero al más urgente', /0 \/ 9/.test(k.barras[0] || '') && /2 \/ 10/.test(k.barras[1] || ''), JSON.stringify(k.barras.slice(0, 3)));
  chk('★ Un nombre con HTML no se ejecuta en el panel', await p.evaluate(() => window.__xss === undefined && !document.querySelector('.pm-panel img')), '');

  await p.evaluate(() => document.querySelector('.pm-barra[data-pm-ficha="A"]').click());
  await p.waitForTimeout(150);
  const f = await p.evaluate(() => { const w = document.getElementById('pm-ficha-wrap'); return w ? w.innerText.replace(/\s+/g, ' ') : ''; });
  chk('Tocar una barra abre la ficha del producto', /TEQUILA A/.test(f), f.slice(0, 80));
  chk('La ficha muestra existencia por área, mínimo y bajo mínimo', /Total 2/.test(f) && /Mínimo 10/.test(f) && /bajo mínimo/.test(f), f.slice(0, 200));
  chk('★ La ficha muestra las compras del producto y el último costo', /PROVEEDOR UNO/.test(f) && /\+6/.test(f) && /Último costo \$80/.test(f), f);
  chk('La ficha muestra las entradas de la semana', /Entradas por compras 6/.test(f), '');
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  chk('Esc cierra la ficha', await p.evaluate(() => !document.getElementById('pm-ficha-wrap')), '');
  await p.evaluate(() => document.querySelector('.pm-nombre-btn[data-pm-ficha="B"]').click());
  chk('El nombre en la tarjeta del catálogo también abre la ficha',
      await p.evaluate(() => /RON B/.test((document.getElementById('pm-ficha-wrap') || {}).innerText || '')), '');
  await p.evaluate(() => document.querySelector('[data-pm-carrito="B"]').click());
  chk('"Agregar al carrito" desde la ficha agrega y cierra', await p.evaluate(() => cart.some(c => c.id === 'B') && !document.getElementById('pm-ficha-wrap')), '');

  await p.evaluate(() => { activeTab = 'inventario'; auditoriaView = 'selection'; renderTab(); });
  const c = await p.evaluate(() => ({ txt: document.getElementById('tabContent').innerText,
    crear: !!document.querySelector('[onclick="abrirModalNuevoInventario()"]'), hist: /Historial de inventarios/.test(document.getElementById('tabContent').innerText) }));
  chk('★ Conteo sin inventario: ya no aparece el cuadro "Sin Inventario Físico abierto" ni el glosario',
      !/Sin Inventario Físico abierto/.test(c.txt) && !/Qué significa cada estado/i.test(c.txt), '');
  chk('★ Sin inventario abierto se puede crear uno y consultar el historial', c.crear && c.hist, JSON.stringify(c));
  chk('La barra inferior tiene Compras', await p.evaluate(() => !!document.querySelector('#bottomTabBar [data-btab="compras"]')), '');
  chk('El menú muestra la versión instalada', await p.evaluate(() => /versión \d/.test(document.getElementById('sbVersion').textContent)), '');
  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── PREMIUM · panel, ficha y Conteo (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
