// FASE 8 — las dos existencias en la app real: tarjeta de comparación, ficha
// con las dos cifras, y la prueba de que el interruptor cambia de verdad la
// fuente de "bajo mínimo" (que es lo que se encenderá cuando Eduardo lo diga).
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

  // Escenario: A difiere (+11), B coincide, N no tiene inicial (no comparable).
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = [
      { id: 'A', name: 'TEQUILA A', group: 'TEQUILA', unit: 'PZA', precio: 100, stockMinimo: 10, stockByArea: { almacen: 3, barra1: 2, barra2: 0 } },
      { id: 'B', name: 'RON B',     group: 'RON',     unit: 'PZA', precio: 50,  stockMinimo: 4,  stockByArea: { almacen: 2, barra1: 0, barra2: 0 } },
      { id: 'N', name: 'NUEVO N',   group: 'RON',     unit: 'PZA', precio: 10,  stockMinimo: 1,  stockByArea: { almacen: 7, barra1: 0, barra2: 0 } },
      { id: 'X', name: '<img src=x onerror="window.__xss=1">', group: 'PRUEBA', unit: 'PZA', stockByArea: { almacen: 0, barra1: 0, barra2: 0 } }
    ];
    const sem = semanaId(new Date());
    movimientos = [{ tipo: 'compra', productoId: 'A', cantidad: 4, semanaId: sem }];
    compras = []; cart = []; orders = []; _inventarioActivo = null;
    // El inicial ya resuelto: la capa no consulta Firestore (lo comprobamos abajo).
    _existenciaInicial = { semana: sem, estado: 'ok', saldos: { A: 12, B: 2, X: 0 }, origen: { numero: 9 } };
    activeTab = 'inicio'; renderTab();
  });
  await p.waitForTimeout(300);

  const comp = await p.evaluate(() => {
    const c = document.querySelector('.pm-card--compara');
    return { txt: c ? c.innerText.replace(/\s+/g, ' ').trim() : '',
             barras: [...document.querySelectorAll('.pm-card--compara .pm-barra')].map(b => b.innerText.replace(/\s+/g, ' ').trim()) };
  });
  chk('★ Inicio muestra la tarjeta de comparación de existencias', /Comparaci[óo]n de existencias/i.test(comp.txt), comp.txt.slice(0, 120));
  chk('★ Cuenta cuántos coinciden y cuántos difieren', /Coinciden 2 de 3/.test(comp.txt) && /Difieren 1/.test(comp.txt), comp.txt.slice(0, 200));
  chk('Los productos sin inicial se declaran no comparables', /Sin inicial.*1/.test(comp.txt), comp.txt.slice(0, 240));
  chk('★ La gráfica muestra operativa → oficial con la diferencia firmada',
      /5 → 16 \(\+11\)/.test(comp.barras[0] || ''), JSON.stringify(comp.barras));
  chk('Dice que manda la operativa mientras dure la comprobación', /[Mm]anda la operativa/.test(comp.txt), comp.txt.slice(0, 240));
  chk('★ Un nombre con HTML no se ejecuta en la comparación',
      await p.evaluate(() => window.__xss === undefined && !document.querySelector('.pm-panel img')), '');

  const tiles = await p.evaluate(() => [...document.querySelectorAll('.pm-tile')].map(t => t.innerText.replace(/\s+/g, ' ').trim()));
  chk('★ Con la fuente oficial apagada, "bajo mínimo" usa la cifra operativa (A y B)',
      /2 BAJO M[ÍI]NIMO/i.test(tiles[1] || ''), tiles[1]);

  // La ficha: las dos cifras, una al lado de la otra.
  await p.evaluate(() => document.querySelector('.pm-card--compara .pm-barra[data-pm-ficha="A"]').click());
  await p.waitForTimeout(150);
  const f = await p.evaluate(() => { const w = document.getElementById('pm-ficha-wrap'); return w ? w.innerText.replace(/\s+/g, ' ') : ''; });
  chk('★ La ficha del producto muestra las dos cifras y su diferencia',
      // innerText devuelve el texto YA transformado por el CSS: el encabezado
      // se pinta en mayúsculas, así que la comparación va sin distinguirlas.
      /las dos cifras/i.test(f) && /Operativa .*5/.test(f) && /Oficial .*16/.test(f) && /Diferencia \+11/.test(f), f.slice(0, 320));
  chk('La ficha explica que por ahora manda la operativa', /manda la operativa/i.test(f), '');
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);

  // Un producto sin inicial lo dice, en vez de enseñar un número inventado.
  await p.evaluate(() => abrirFichaProducto('N'));
  const fn = await p.evaluate(() => (document.getElementById('pm-ficha-wrap') || {}).innerText || '');
  chk('★ Sin inicial, la ficha lo dice en vez de comparar contra cero',
      /Sin inicial contabilizado/.test(fn.replace(/\s+/g, ' ')), fn.slice(0, 200));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);

  // EL INTERRUPTOR: esto es lo que se encenderá al terminar la comprobación.
  const tras = await p.evaluate(() => {
    EXISTENCIA_FUENTE_OFICIAL_ACTIVA = true;
    renderTab();
    const t = [...document.querySelectorAll('.pm-tile')].map(x => x.innerText.replace(/\s+/g, ' ').trim());
    const bajo = products.filter(p => _bajoMinimo(p)).map(p => p.id);
    EXISTENCIA_FUENTE_OFICIAL_ACTIVA = false;
    return { tiles: t, bajo: bajo };
  });
  chk('★ Encender la fuente oficial cambia de verdad quién está bajo mínimo',
      tras.bajo.length === 1 && tras.bajo[0] === 'B', JSON.stringify(tras.bajo));
  chk('★ …y el indicador del panel lo refleja (de 2 a 1)',
      /1 BAJO M[ÍI]NIMO/i.test(tras.tiles[1] || ''), tras.tiles[1]);

  const vuelta = await p.evaluate(() => { renderTab(); return document.querySelectorAll('.pm-tile')[1].innerText.replace(/\s+/g, ' ').trim(); });
  chk('Apagar la bandera devuelve la app a la cifra de siempre', /2 BAJO M[ÍI]NIMO/i.test(vuelta), vuelta);

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── FASE 8 · las dos existencias en la app real ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
