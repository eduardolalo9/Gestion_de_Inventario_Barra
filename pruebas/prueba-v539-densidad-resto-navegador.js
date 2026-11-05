// v5.39 — densidad en las pantallas que faltaban (Pedidos, Recetario, Ventas, Ajustes, Admin,
// Importar, Papelera, Historia), en Chromium real 390 × 844, oscuro y claro.
//   npm run test:v539nav
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const URL_APP = 'http://127.0.0.1:' + (process.env.PUERTO || '8080') + '/index.html';
const MONTAJE = () => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden');
  document.getElementById('loginScreen').classList.add('auth-hidden');
  document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u1'; currentUserRole = 'admin';
  _authzState.loaded = true; _authzState.overrides = {}; _authzState.roleId = 'ADMIN'; _authzState.permissions = new Set(['*']);
  products = [{ id: 'A', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'Botellas', precio: 500, stockMinimo: 2, conversion: 1, stockByArea: { almacen: 3, barra1: 0, barra2: 0 } }];
  recetas = [{ id: 'R1', nombre: 'MARGARITA CLÁSICA', categoria: 'Cocteles', pv: 'PV1', activa: true, ingredientes: [{ productoId: 'A', cantidad: 0.1 }] },
             { id: 'R2', nombre: 'MOJITO', activa: false, ingredientes: [] }];
  orders = [{ id: 'PED-0042', supplier: 'CASA CUERVO', date: '2026-11-01', products: [{ name: 'DON JULIO 70 700 ML', unit: 'Botellas', quantity: 3 }, { name: 'HERRADURA REPOSADO 700 ML', unit: 'Botellas', quantity: 2 }], total: 5, note: 'Antes de las 4' }];
};
const CONTRASTE = (sel) => {
  const L = (c) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c); return [m[1], m[2], m[3]].map(x => x / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0); };
  const fondo = (e) => { while (e) { const b = getComputedStyle(e).backgroundColor; const al = /rgba\([^)]*,\s*([\d.]+)\)/.exec(b); if (b && (!al || parseFloat(al[1]) >= 0.5)) return b;   /* un tinte translúcido (< 50 %) deja ver la superficie de abajo */ e = e.parentElement; } return getComputedStyle(document.body).backgroundColor; };
  return [...document.querySelectorAll(sel)].filter(e => e.offsetParent && e.textContent.trim()).map(e => { const a = L(getComputedStyle(e).color), b = L(fondo(e)); return Math.round((Math.max(a, b) + .05) / (Math.min(a, b) + .05) * 100) / 100; });
};
(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  for (const tema of ['dark', 'light']) {
    const T = '[' + tema + '] ';
    const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await ctx.addInitScript((t) => { try { localStorage.setItem('inventarioApp_theme', t); localStorage.setItem('inventarioApp_temaMarca', 'ultra-pro'); } catch (e) {} }, tema);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await p.goto(URL_APP, { waitUntil: 'load' });
    await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
    await p.waitForTimeout(600); await p.evaluate(MONTAJE);
    const ir = async (tab) => { await p.evaluate((t) => { activeTab = t; renderTab(); window.scrollTo(0, 0); }, tab); await p.waitForTimeout(250); };
    const desborde = () => p.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1);

    // Pedidos
    await ir('pedidos');
    const ped = await p.evaluate(() => { const c = document.querySelector('.ped-card'); const filas = [...c.querySelectorAll('.ped-tabla tbody tr')].map(r => Math.round(r.getBoundingClientRect().height));
      return { filas, cab: [...c.querySelectorAll('.ped-tabla th')].map(t => t.textContent), cant: getComputedStyle(c.querySelector('td.ped-tabla__n')).fontFamily,
               bts: [...c.querySelectorAll('.ui-icono-btn')].map(b => [Math.round(b.getBoundingClientRect().height), b.getAttribute('aria-label')]), nota: /Antes de las 4/.test(c.textContent), total: /Total Productos: 5\.00/.test(c.textContent) }; });
    chk(T + '★ Pedidos: filas de la tabla ≤ 40 px, encabezados cortos (Producto / Unidad / Cant.) y cantidad en mono', ped.filas.every(h => h <= 40) && ped.cab.join('|') === 'Producto|Unidad|Cant.' && /IBM Plex Mono/.test(ped.cant), JSON.stringify(ped));
    chk(T + 'Pedidos: compartir y eliminar siguen de 44 px y con nombre accesible; nota y total intactos', ped.bts.length === 2 && ped.bts.every(b => b[0] >= 44 && /pedido PED-0042/.test(b[1])) && ped.nota && ped.total, JSON.stringify(ped.bts));
    // Recetario
    await ir('recetario');
    const rec = await p.evaluate(() => [...document.querySelectorAll('.rec-card')].map(c => ({ h: Math.round(c.getBoundingClientRect().height), t: c.innerText.replace(/\s+/g, ' ') })));
    chk(T + '★ Recetario: cada receta ≤ 56 px (antes ≈ 100) con nombre, insignia, categoría · insumos y costo', rec.length === 2 && rec.every(r => r.h <= 56) && /MARGARITA CLÁSICA/.test(rec[0].t) && /Cocteles · 1 insumo/.test(rec[0].t) && /\$/.test(rec[0].t) && /INACTIVA|Inactiva/.test(rec[1].t), JSON.stringify(rec));
    // Ventas
    await ir('ventas');
    const vs = await p.evaluate(() => ({ bts: [...document.querySelectorAll('.vs-btn')].filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().height)) }));
    chk(T + 'Ventas: botones de acción de 44 px (antes 48)', vs.bts.length >= 1 && vs.bts.every(h => h >= 44 && h <= 46), JSON.stringify(vs));
    // Ajustes y Admin
    await ir('ajustes');
    const aj = await p.evaluate(() => ({ areas: [...document.querySelectorAll('.aj-area:not(.aj-area--alta)')].map(a => Math.round(a.getBoundingClientRect().height)), nota: (document.querySelector('.aj-nuevo .ui-nota') || {}).textContent || '',
      tit: parseFloat(getComputedStyle(document.querySelector('.adm-card h3')).fontSize) }));
    chk(T + '★ Ajustes: áreas ≤ 60 px, nota de una línea y títulos de sección de 10 px', aj.areas.length >= 3 && aj.areas.every(h => h <= 60) && aj.nota.length < 110 && aj.tit <= 13, JSON.stringify(aj));
    await ir('admin');
    const adm = await p.evaluate(() => ({ stats: [...document.querySelectorAll('.adm-stat')].slice(0, 3).map(s => Math.round(s.getBoundingClientRect().height)), bts: [...document.querySelectorAll('.adm-btn')].filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().height)) }));
    chk(T + 'Admin: filas de dato ≤ 36 px y botones de 44 px', adm.stats.every(h => h <= 36) && adm.bts.length > 0 && adm.bts.every(h => h >= 44 && h <= 46), JSON.stringify(adm));
    // Importar y Papelera
    await ir('importar');
    const imp = await p.evaluate(() => ({ sub: (document.querySelector('.imp-cab__sub') || {}).textContent || '', pad: parseFloat(getComputedStyle(document.querySelector('.imp-sec')).paddingTop) }));
    chk(T + 'Importar: subtítulo de una línea y secciones con padding de 10 px', imp.sub.length < 70 && imp.pad === 10, JSON.stringify(imp));
    await ir('papelera');
    chk(T + 'Papelera: la regla de 30 días en una línea', await p.evaluate(() => { const s = document.querySelector('.pap-cab__sub'); return !!s && s.textContent.length < 70 && /30 días/.test(s.textContent); }));
    // Contraste y desborde en todas
    let peor = [];
    for (const t of ['pedidos', 'recetario', 'ventas', 'ajustes', 'admin', 'importar', 'papelera', 'historia']) {
      await ir(t);
      const c = await p.evaluate(CONTRASTE, '#tabContent :is(p, span, td, th, h3, b, div.rec-card__nom, .adm-stat, .ui-nota, .imp-sec__desc, .vs-vacio__s)');
      const malos = c.filter(x => x < 4.5);
      if (malos.length) peor.push(t + ':' + malos.join(','));
      if (await desborde()) peor.push(t + ':desborde');
    }
    chk(T + '★ Contraste ≥ 4.5:1 y sin desborde horizontal en las 8 pantallas', peor.length === 0, peor.join(' | '));
    chk(T + 'Sin errores de JavaScript', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await nav.close();
  console.log('\n  ── v5.39 · Densidad en las pantallas restantes (navegador) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + c.d)));
  const fl = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fl) + ' pasaron · ' + fl + ' fallaron\n');
  process.exit(fl ? 1 : 0);
})();
