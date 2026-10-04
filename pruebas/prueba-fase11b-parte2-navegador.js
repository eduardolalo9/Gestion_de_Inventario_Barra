// FASE 11B (parte 2) — en la app real (Chromium): "Total" de la tarjeta de
// Inicio ya lee existenciaMostrada() (no el caché stockByArea/getTotalStock),
// los tres niveles de alerta se muestran como UN SOLO badge (el más severo),
// "Pedido sugerido" aparece con la cantidad real (TECHO del déficit entre la
// conversión) y agregarlo al carrito fija esa cantidad exacta, de forma
// idempotente, sin tocar el comportamiento del botón 🛒 normal.
// AJUSTE DE R3 (2-oct-2026): el rediseño cambió la PRESENTACIÓN de estos
// badges —los pinta UI.badge() con el diccionario común, sin emoji y en
// mayúsculas por CSS— y el pedido sugerido perdió los dos puntos. Las
// aserciones se reescribieron para comprobar el FONDO (qué nivel aplica, que
// no se apilen, qué cantidad se sugiere y que sin `conversion` se avise en vez
// de inventar un número) sin depender de cómo se dibuja. Lo que protegían
// sigue protegido; lo que medían de la forma, ya no.
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
    localStorage.clear();
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
  chk('La página carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {};

    const sem = semanaId(new Date());
    // P: tiene inicial contabilizado + entradas → existenciaOficial() da un
    // número MUY distinto de getTotalStock()/stockByArea. Si "Total:" en la
    // tarjeta sigue mostrando la suma de stockByArea (2), el cambio no se
    // habría aplicado de verdad.
    products = [
      { id: 'P', name: 'PRODUCTO OFICIAL', group: 'PRUEBA', unit: 'PZA', stockMinimo: 5,
        stockByArea: { almacen: 2, barra1: 0, barra2: 0 } },
      // Q: sin inicial (cae a operativo = stockByArea = 0), con conversión →
      // pedido sugerido calculable. mínimo 12 ÷ 2 = 6 → total 0 < 6 → "limitado".
      { id: 'Q', name: 'PRODUCTO LIMITADO', group: 'PRUEBA', unit: 'PZA', stockMinimo: 12, conversion: 6,
        stockByArea: { almacen: 0, barra1: 0, barra2: 0 } },
      // R: igual que Q pero SIN conversión → nunca se inventa una cantidad.
      { id: 'R', name: 'PRODUCTO SIN CONVERSION', group: 'PRUEBA', unit: 'PZA', stockMinimo: 10,
        stockByArea: { almacen: 0, barra1: 0, barra2: 0 } },
      // S: total=9, mínimo=12 → por encima de ⅔ (8) → "bajo" (el más leve).
      { id: 'S', name: 'PRODUCTO BAJO', group: 'PRUEBA', unit: 'PZA', stockMinimo: 12,
        stockByArea: { almacen: 9, barra1: 0, barra2: 0 } },
      // T: total=7, mínimo=12 → entre ⅔ (8) y ½ (6) → "advertencia".
      { id: 'T', name: 'PRODUCTO ADVERTENCIA', group: 'PRUEBA', unit: 'PZA', stockMinimo: 12,
        stockByArea: { almacen: 7, barra1: 0, barra2: 0 } }
    ];
    _existenciaInicial = { semana: sem, estado: 'ok', saldos: { P: 10 }, origen: 'prueba' };
    movimientos = [{ tipo: 'compra', productoId: 'P', cantidad: 3, semanaId: sem }];
    compras = []; costosUltimos = {}; cart = []; orders = []; _inventarioActivo = null;
    activeTab = 'inicio'; selectedGroup = 'Todos'; renderTab();
  });
  await p.waitForTimeout(300);

  // Helper: toma el texto de la tarjeta de un producto por su nombre visible.
  async function tarjeta(nombre) {
    return p.evaluate((n) => {
      const card = [...document.querySelectorAll('.prd-card')].find(c => c.textContent.includes(n));
      return card ? card.innerText.replace(/\s+/g, ' ').trim() : null;
    }, nombre);
  }

  const tP = await tarjeta('PRODUCTO OFICIAL');
  chk('★ "Total:" ya NO es la suma de stockByArea (2.00) — usa existenciaMostrada()',
      !!tP && /Total: 13\.00/.test(tP), tP);
  chk('P está por encima de su mínimo (5): sin ningún badge de alerta', !!tP && !/Bajo mínimo|Limitado|Advertencia/.test(tP), tP);

  const tQ = await tarjeta('PRODUCTO LIMITADO');
  chk('★ Q (total=0, mínimo=12) muestra el badge "Limitado" (el más severo)', !!tQ && /\bLIMITADO\b/i.test(tQ), tQ);
  chk('Q NO muestra también "Bajo mínimo" ni "Advertencia" apilados', !!tQ && !/Bajo mínimo \(/i.test(tQ) && !/Advertencia producto bajo/i.test(tQ), tQ);
  chk('★ Q muestra el pedido sugerido 2 — TECHO((12−0)/6)', !!tQ && /Pedido sugerido\s*:?\s*2\b/i.test(tQ), tQ);

  const tR = await tarjeta('PRODUCTO SIN CONVERSION');
  chk('R está en el mismo umbral que Q (limitado)', !!tR && /\bLIMITADO\b/i.test(tR), tR);
  chk('★ R, sin `conversion`, nunca inventa una cantidad — avisa honestamente', !!tR && /Sin dato de conversión para sugerir cantidad/.test(tR), tR);

  const tS = await tarjeta('PRODUCTO BAJO');
  chk('★ S (total=9 de 12) → "Bajo mínimo (12)", el más leve de los tres', !!tS && /Bajo mínimo \(12\)/i.test(tS), tS);
  chk('S no tiene pedido sugerido (sin conversión y sin alcanzar los umbrales nuevos no cambia: aquí no hay `conversion`)',
      !!tS && /Sin dato de conversión/.test(tS), tS);

  const tT = await tarjeta('PRODUCTO ADVERTENCIA');
  chk('★ T (total=7 de 12, entre ⅔ y ½) → "Advertencia producto bajo"', !!tT && /Advertencia producto bajo/i.test(tT), tT);

  // ── Agregar pedido sugerido: cantidad exacta, idempotente ──────────────
  await p.evaluate(() => agregarPedidoSugerido('Q'));
  await p.waitForTimeout(80);
  let r1 = await p.evaluate(() => cart.find(c => c.id === 'Q'));
  chk('★ "Agregar sugerido" pone la cantidad sugerida exacta en el carrito (2)', r1 && r1.quantity === 2, JSON.stringify(r1));

  await p.evaluate(() => agregarPedidoSugerido('Q'));
  await p.waitForTimeout(80);
  let r2 = await p.evaluate(() => cart.find(c => c.id === 'Q'));
  chk('★ Tocarlo otra vez es idempotente: sigue en 2, no se duplica a 4', r2 && r2.quantity === 2, JSON.stringify(r2));

  // ── El botón 🛒 normal de toda la app NO cambia su comportamiento ──────
  await p.evaluate(() => { addToCart('S'); addToCart('S'); });
  await p.waitForTimeout(80);
  let r3 = await p.evaluate(() => cart.find(c => c.id === 'S'));
  chk('El botón normal de carrito sigue incrementando de uno en uno (sin cantidad)', r3 && r3.quantity === 2, JSON.stringify(r3));

  // ── El botón real "Agregar sugerido" en el DOM también funciona ────────
  await p.evaluate(() => { cart = []; renderTab(); });
  await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('[onclick*="agregarPedidoSugerido(\'Q\')"]').click());
  await p.waitForTimeout(100);
  let r4 = await p.evaluate(() => cart.find(c => c.id === 'Q'));
  chk('★ El botón real "🛒 Agregar sugerido" en pantalla agrega la cantidad sugerida', r4 && r4.quantity === 2, JSON.stringify(r4));

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── FASE 11B (parte 2) · pedido sugerido y niveles de alerta (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})();
