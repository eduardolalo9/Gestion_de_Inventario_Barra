// Vista compacta del Conteo (v5.11) — se mide en Chromium (390x844) contra la app real.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const PUERTO = process.env.PUERTO || '8080';
(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
  chk('La página carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.roleId = 'ADMIN';
    _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = Array.from({ length: 40 }, (_, i) => ({ id: 'P' + i, name: 'PRODUCTO ' + i, unit: 'PZA', group: 'TEQUILA' }));
    _auditoriaSessionId = 'S7'; _inventarioActivoCarga = 'ok';
    _inventarioActivo = { numero: 1001, estado: 'SINCRONIZADO', fechaCreacion: Date.now(), fechaCierre: Date.now(), creadoPorNombre: 'Eduardo', creadoPorRol: 'ADMIN', fechaRecuento: '2026-10-04', semanaId: '2026-09-28', warehousesSnapshot: ['almacen','barra1','barra2'], comentario: 'x' };
    allUsersAuditoria = {};
    auditoriaStatus = { almacen: 'completada', barra1: 'completada', barra2: 'completada' };
    auditoriaView = 'selection'; activeTab = 'inventario'; renderTab();
  });
  await p.waitForTimeout(300);
  const m = await p.evaluate(() => {
    const c = document.querySelector('.if-areas--compacto');
    if (!c) return null;
    const tarj = [...c.querySelectorAll('.audit-area-card')], bts = [...c.querySelectorAll('.bt')];
    const st = c.querySelector('.audit-area-status'), de = c.querySelector('.if-area__detalle');
    return { alto: c.getBoundingClientRect().height, n: tarj.length, hT: tarj.map(x => x.getBoundingClientRect().height),
      hB: bts.map(x => x.getBoundingClientRect().height), fB: bts.map(x => parseFloat(getComputedStyle(x).fontSize)),
      aria: bts.map(x => x.getAttribute('aria-label')), gap: parseFloat(getComputedStyle(c).rowGap),
      mismoRenglon: Math.abs(st.getBoundingClientRect().top - de.getBoundingClientRect().top) < 14,
      scrollH: document.documentElement.scrollWidth > window.innerWidth };
  });
  chk('★ La sección Áreas compacta existe y pinta las 3 áreas', m && m.n === 3, JSON.stringify(m));
  chk('★ Las tres áreas completadas con su botón caben en <= 480 px (antes 613 px)', m && m.alto <= 480, 'alto=' + (m && m.alto));
  chk('★ Piso de ergonomía: cada tarjeta mide >= 72 px', m && m.hT.every(h => h >= 72), JSON.stringify(m && m.hT));
  chk('★ Piso de ergonomía: cada botón mide >= 48 px y su texto >= 14 px', m && m.hB.length === 3 && m.hB.every(h => h >= 48) && m.fB.every(f => f >= 14), JSON.stringify(m && [m.hB, m.fB]));
  chk('Separación entre áreas de 8 px', m && m.gap === 8, 'gap=' + (m && m.gap));
  chk('★ "Reabrir" conserva el nombre del área en aria-label', m && m.aria.join('|') === 'Reabrir Almacén|Reabrir Barra Restaurante|Reabrir Barra Bar', JSON.stringify(m && m.aria));
  chk('Estado y conteo comparten renglón', m && m.mismoRenglon);
  chk('Sin desplazamiento horizontal en 390 px', m && !m.scrollH);
  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();
  const w = Math.max.apply(null, C.map(c => c.n.length)); let f = 0;
  console.log('\n  ── Vista compacta del Conteo (navegador) ──\n');
  C.forEach(c => { if (!c.ok) f++; console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)); });
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - f) + ' pasaron · ' + f + ' fallaron\n');
  process.exit(f ? 1 : 0);
})();
