// v5.38 — «Ultra Pro Emerald» en Chromium real (390 × 844), oscuro y claro:
// alturas de la densidad, objetivos táctiles de 44 px, cifras mono y contraste.
//   npm run test:v538nav
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const URL_APP = 'http://127.0.0.1:' + (process.env.PUERTO || '8080') + '/index.html';
const MONTAJE = () => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden');
  document.getElementById('loginScreen').classList.add('auth-hidden');
  document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u1'; currentUserRole = 'admin';
  _authzState.loaded = true; _authzState.overrides = {}; _authzState.roleId = 'ADMIN'; _authzState.permissions = new Set(['*']);
  products = [
    { id: '1060056', name: 'AGUA MINERAL TOPO CHICO 355 ML PQT 24 PZ', group: 'REFRESCOS', unit: 'Piezas', precio: 18.5, stockMinimo: 20, conversion: 1, proveedor: 'MODELO', stockByArea: { almacen: 3, barra1: 0, barra2: 0 } },
    { id: '1060002', name: 'AGUA CIEL 355 ML PQT 12 PZ', group: 'REFRESCOS', unit: 'PZA', precio: 12, stockMinimo: 10, conversion: 1, stockByArea: { almacen: 8, barra1: 0, barra2: 0 } },
    { id: 'A', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'Botellas', precio: 500, stockMinimo: 2, conversion: 1, stockByArea: { almacen: 9, barra1: 0, barra2: 0 } }
  ];
  auditoriaConteo = { A: { almacen: { enteras: 3, abiertas: [] } } }; myAuditoriaConteo = JSON.parse(JSON.stringify(auditoriaConteo));
  _auditoriaSessionId = 'INV1'; _inventarioActivoId = 'INV1';
  _inventarioActivo = { estado: 'SINCRONIZADO', numero: 1, fechaCreacion: Date.now(), creadoPorNombre: 'Eduardo', semanaId: '2026-10-26', fechaRecuento: '2026-11-01' };
  allUsersAuditoria = {};
};
const CONTRASTE = (sel) => {
  const L = (c) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c); return [m[1], m[2], m[3]].map(x => x / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0); };
  const fondo = (e) => { while (e) { const b = getComputedStyle(e).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && !/, 0\)$/.test(b)) return b; e = e.parentElement; } return getComputedStyle(document.body).backgroundColor; };
  return [...document.querySelectorAll(sel)].filter(e => e.offsetParent).map(e => { const a = L(getComputedStyle(e).color), b = L(fondo(e)); return Math.round((Math.max(a, b) + .05) / (Math.min(a, b) + .05) * 100) / 100; });
};
(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  // ── Un dispositivo nuevo abre en OSCURO ──
  {
    const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    await p.goto(URL_APP, { waitUntil: 'load' }); await p.waitForTimeout(400);
    chk('★ Un dispositivo nuevo abre en tema OSCURO (Ultra Pro Emerald)', (await p.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');
    await ctx.close();
  }
  for (const tema of ['dark', 'light']) {
    const T = '[' + tema + '] ';
    const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await ctx.addInitScript((t) => { try { localStorage.setItem('inventarioApp_theme', t); localStorage.setItem('inventarioApp_temaMarca', 'ultra-pro'); } catch (e) {} }, tema);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await p.goto(URL_APP, { waitUntil: 'load' });
    await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
    await p.waitForTimeout(600); await p.evaluate(MONTAJE);
    // Encabezado y barra inferior
    await p.evaluate(() => { activeTab = 'pedido_sugerido'; renderTab(); }); await p.waitForTimeout(250);
    const marco = await p.evaluate(() => {
      const hd = document.querySelector('.sticky.top-0').getBoundingClientRect(), bb = document.getElementById('bottomTabBar').getBoundingClientRect();
      return { hd: Math.round(hd.height), barra: Math.round(bb.height), items: [...document.querySelectorAll('#bottomTabBar .btab-item')].map(b => Math.round(b.getBoundingClientRect().height)),
               etq: parseFloat(getComputedStyle(document.querySelector('#bottomTabBar .btab-item span')).fontSize) };
    });
    chk(T + '★ Encabezado de 48 px y barra inferior de 56 px (antes 80)', marco.hd <= 48 && marco.barra === 56, JSON.stringify(marco));
    chk(T + 'Cada destino de la barra sigue siendo un objetivo ≥ 44 px, con etiqueta de 10 px', marco.items.every(h => h >= 44) && marco.etq === 10, JSON.stringify(marco));
    // Pedido sugerido
    const ps = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('.ps-card')], r = (e) => e.getBoundingClientRect();
      const nom = cards[0].querySelector('.ps-card__nom'), pie = document.querySelector('.ps-pie'), barra = document.getElementById('bottomTabBar');
      const chip = document.querySelector('.ps-orden__btn'), chipCaja = getComputedStyle(chip, '::after');
      return { alturas: cards.map(c => Math.round(r(c).height)), pad: parseFloat(getComputedStyle(cards[0]).paddingTop),
               nomCompleto: nom.scrollHeight <= nom.clientHeight + 1, nomLineas: Math.round(r(nom).height / parseFloat(getComputedStyle(nom).lineHeight)),
               cifraFuente: getComputedStyle(cards[0].querySelector('.ps-card__num b')).fontFamily, cifraTam: parseFloat(getComputedStyle(cards[0].querySelector('.ps-card__num b')).fontSize),
               check: Math.round(r(cards[0].querySelector('.ps-check')).height), input: Math.round(r(cards[0].querySelector('.ps-input')).height), inputFs: parseFloat(getComputedStyle(cards[0].querySelector('.ps-input')).fontSize),
               estado: (() => { const t = cards.find(c => /TOPO CHICO/.test(c.textContent)); const e = t && t.querySelector('.ps-estado'); return e ? [e.textContent, parseFloat(getComputedStyle(e).fontSize)] : null; })(),
               gap: r(cards[1]).top - r(cards[0]).bottom, pieSobreBarra: r(pie).bottom <= r(barra).top + 1 && r(pie).height > 0,
               chipObjetivo: Math.round(r(chip).height), chipDibujo: parseFloat(chipCaja.height), sinTitulo: !/Reaprovisionamiento/.test(document.getElementById('tabContent').innerText),
               desborde: document.scrollingElement.scrollWidth > innerWidth + 1 };
    });
    chk(T + '★ Tarjeta del pedido ≤ 68 px de alto (antes 76, y ahora con el nombre completo) con padding vertical ≤ 12 px', ps.alturas.every(h => h <= 68) && ps.pad <= 12, JSON.stringify(ps.alturas) + ' pad ' + ps.pad);
    chk(T + '★ El nombre largo se lee completo en 2 renglones (ya no se corta a los 12 caracteres)', ps.nomCompleto && ps.nomLineas <= 2, JSON.stringify(ps));
    chk(T + '★ Stock y Mín en IBM Plex Mono de 14 px; casilla y campo con objetivo ≥ 40/44 px; campo a 16 px (sin zoom en iOS)', /IBM Plex Mono/.test(ps.cifraFuente) && ps.cifraTam === 14 && ps.check >= 44 && ps.input >= 40 && ps.inputFs === 16, JSON.stringify(ps));
    chk(T + 'Estado discreto: «Crítico» (3 de mínimo 20) en 9 px', ps.estado && ps.estado[0] === 'Crítico' && ps.estado[1] === 9, JSON.stringify(ps.estado));
    chk(T + 'Separación entre tarjetas de 4 px', Math.round(ps.gap) === 4, String(ps.gap));
    chk(T + '★ La barra de resumen queda por encima de la barra inferior', ps.pieSobreBarra);
    chk(T + '★ Chip: se dibuja de 30 px y su objetivo táctil es de 44 px', ps.chipDibujo === 30 && ps.chipObjetivo >= 44, JSON.stringify([ps.chipDibujo, ps.chipObjetivo]));
    chk(T + 'Sin subtítulos descriptivos ni desborde horizontal', ps.sinTitulo && !ps.desborde);
    const cps = await p.evaluate(CONTRASTE, '.ps-card__nom, .ps-card__cod, .ps-card__etq, .ps-card__num b, .ps-card__num .num, .ps-estado, .ps-pie__txt, .ps-micro');
    chk(T + '★ Contraste ≥ 4.5:1 en toda la tarjeta y el resumen del pedido', cps.length > 8 && cps.every(c => c >= 4.5), JSON.stringify(cps));
    // Conteo y catálogo
    await p.evaluate(() => { activeTab = 'inventario'; auditoriaView = 'counting'; auditoriaAreaActiva = 'almacen'; isAuditoriaMode = true; renderTab(); }); await p.waitForTimeout(250);
    const cnt = await p.evaluate(() => [...document.querySelectorAll('.inv-card')].map(c => Math.round(c.getBoundingClientRect().height)));
    chk(T + '★ Tarjeta de conteo ≤ 80 px (antes ≈ 110)', cnt.length === 3 && cnt.every(h => h <= 80), JSON.stringify(cnt));
    await p.evaluate(() => { activeTab = 'productos'; renderTab(); }); await p.waitForTimeout(250);
    const cat = await p.evaluate(() => ({ filas: [...document.querySelectorAll('.cat-tabla tbody tr')].map(r => Math.round(r.getBoundingClientRect().height)),
      botones: [...document.querySelectorAll('.cat-tabla tbody button')].map(b => Math.round(b.getBoundingClientRect().height)) }));
    chk(T + '★ Fila del catálogo ≤ 56 px con acciones de 44 px', cat.filas.length === 3 && cat.filas.every(h => h <= 56) && cat.botones.every(h => h >= 44), JSON.stringify(cat));
    // Modal
    await p.evaluate(() => showConfirm('¿Eliminar?', () => {})); await p.waitForTimeout(150);
    const mod = await p.evaluate(() => { const c = document.querySelector('#_confirmOverlay > div'); return { pad: parseFloat(getComputedStyle(c).paddingTop), bts: [...c.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().height)) }; });
    chk(T + 'Modal de confirmación: padding 14 px (antes 24) y botones de 44 px', mod.pad === 14 && mod.bts.every(h => h >= 44), JSON.stringify(mod));
    chk(T + 'Sin errores de JavaScript', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await nav.close();
  console.log('\n  ── v5.38 · Ultra Pro Emerald: densidad operativa (navegador) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + c.d)));
  const fl = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fl) + ' pasaron · ' + fl + ' fallaron\n');
  process.exit(fl ? 1 : 0);
})();
