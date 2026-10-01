// FASE 11B (parte 1) — "Físico vs Sistema" en la app real (Chromium), sin
// mockear la pantalla: botón por permiso, tabla, búsqueda, chip de filtro y
// la honestidad de "pendiente" vs. "diferencia cero".
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

  // ── Montaje: inventario abierto, dos productos contados y uno pendiente ──
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u1'; currentUserRole = 'bartender';
    _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['inventory.count', 'inventory.viewOwn']);   // SIN viewAll todavía

    products = [
      { id: 'A', name: 'TEQUILA FALTANTE', precio: 100, stockMinimo: 1, stockByArea: { almacen: 10, barra1: 0, barra2: 0 } },
      { id: 'B', name: 'RON SOBRANTE',     precio: 50,  stockMinimo: 1, stockByArea: { almacen: 2,  barra1: 0, barra2: 0 } },
      { id: 'C', name: 'VODKA SIN CONTAR', precio: 20,  stockMinimo: 1, stockByArea: { almacen: 5,  barra1: 0, barra2: 0 } }
    ];
    auditoriaConteo = {
      A: { almacen: { enteras: 6, abiertas: [] } },
      B: { almacen: { enteras: 5, abiertas: [] } }
    };
    _auditoriaSessionId = 'INV1001'; _inventarioActivoId = 'INV1001';
    _inventarioActivo = { estado: 'SINCRONIZADO', numero: 1001, fechaCreacion: Date.now(), creadoPorNombre: 'Eduardo' };
    allUsersAuditoria = {};
    activeTab = 'inventario'; auditoriaView = 'selection'; renderTab();
  });
  await p.waitForTimeout(200);

  chk('★ Sin "Ver todos los conteos", el botón NO aparece',
      await p.evaluate(() => !document.querySelector('[onclick*="fisico_vs_sistema"]')), '');

  await p.evaluate(() => {
    _authzState.permissions = new Set(['inventory.count', 'inventory.viewOwn', 'inventory.viewAll']);
    renderTab();
  });
  await p.waitForTimeout(150);
  chk('★ Con "Ver todos los conteos", el botón sí aparece',
      await p.evaluate(() => !!document.querySelector('[onclick*="fisico_vs_sistema"]')), '');

  await p.evaluate(() => document.querySelector('[onclick*="fisico_vs_sistema"]').click());
  await p.waitForTimeout(200);
  const t1 = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('Abre la pantalla con el título correcto', /Físico vs Sistema/.test(t1), t1.slice(0, 80));
  chk('★ Muestra 2 contados y 1 pendiente', /2 contados/.test(t1) && /1 pendiente/.test(t1), t1.slice(0, 300));
  chk('★ El faltante de A se ve (físico 6 contra sistema 10)', /TEQUILA FALTANTE/.test(t1) && /Faltante/.test(t1), '');
  chk('★ El sobrante de B se ve', /RON SOBRANTE/.test(t1) && /Sobrante/.test(t1), '');
  chk('★ El pendiente dice "sin contar", nunca una diferencia inventada',
      /VODKA SIN CONTAR/.test(t1) && /[Ss]in contar/.test(t1), '');
  chk('Neto en dinero: -4×100 + 3×50 = -$250 (signo antes del símbolo)', /-\$250\.00/.test(t1.replace(/\s/g, ' ')), t1);

  // ── Chip "solo con diferencias": oculta el pendiente de la lista ─────────
  await p.evaluate(() => document.querySelector('[data-sbx-filtro="solo_dif"]').click());
  await p.waitForTimeout(150);
  const t2 = await p.evaluate(() => document.getElementById('sbx-res-fvs').innerText);
  chk('★ "Solo con diferencias" quita el pendiente de la lista', !/VODKA SIN CONTAR/.test(t2), t2.slice(0, 200));
  chk('…pero conserva faltante y sobrante', /TEQUILA FALTANTE/.test(t2) && /RON SOBRANTE/.test(t2), '');

  // ── Buscador ──────────────────────────────────────────────────────────
  await p.evaluate(() => document.querySelector('[data-sbx-filtro="solo_dif"]').click()); // apagar el chip
  await p.fill('#sbx-input-fvs', 'ron');
  await p.waitForTimeout(350);
  const t3 = await p.evaluate(() => document.getElementById('sbx-res-fvs').innerText);
  chk('★ El buscador filtra por nombre ("ron" solo encuentra RON SOBRANTE)',
      /RON SOBRANTE/.test(t3) && !/TEQUILA FALTANTE/.test(t3), t3.slice(0, 200));

  chk('Volver regresa a la selección y limpia la búsqueda',
      await p.evaluate(() => {
          document.querySelector('button[onclick*="auditoriaView=\'selection\'"]').click();
          return auditoriaView === 'selection' && _fvsSearchTerm === '';
      }), '');

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── FASE 11B · Físico vs Sistema (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
