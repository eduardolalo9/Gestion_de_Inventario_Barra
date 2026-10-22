// v5.28 — Rediseño de módulos, medido en Chromium contra la app real a 360 y
// 390 px: Productos, Pedido sugerido, Inventario, Gestión de equipo y Ventas.
//   npm run test:v528nav      (requiere el servidor local en PUERTO, 8080)
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const PUERTO = process.env.PUERTO || '8080';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const errs = [];
  for (const ANCHO of [360, 390]) {
    const p = await (await nav.newContext({ viewport: { width: ANCHO, height: 844 } })).newPage();
    p.on('pageerror', e => errs.push(ANCHO + ' ' + String(e).slice(0, 200)));
    await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
    await p.evaluate(async () => {
      const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
      const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
    });
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(800);
    await p.evaluate(() => {
      document.getElementById('authLoadingScreen').classList.add('auth-hidden');
      document.getElementById('loginScreen').classList.add('auth-hidden');
      document.getElementById('appWrapper').classList.add('auth-visible');
      currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.roleId = 'ADMIN';
      _authzState.permissions = new Set(['*']); _authzState.overrides = {};
      products = [
        { id: '1020010', name: 'APIO', unit: 'KGS', group: 'VERDURA', stockMinimo: 3, conversion: 1, precio: 28, proveedor: 'CENTRAL DE ABASTOS' },
        { id: '1020020', name: 'BLUEBERRY', unit: 'KGS', group: 'FRUTA', stockMinimo: 2, conversion: 1, precio: 180, proveedor: 'COSTCO' },
        { id: '1180001', name: 'TEQUILA DON JULIO 70 AÑEJO CRISTALINO 700 ML', unit: 'PZA', group: 'TEQUILA', capacidadMl: 700, stockMinimo: 4, conversion: 1, precio: 820 }];
      const st = { '1020010': 1.2, '1020020': 0.5, '1180001': 2 }; window.existenciaMostrada = pr => st[pr.id];
    });
    const sinDesborde = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const ir = (tab, prep) => p.evaluate(({ tab, prep }) => { if (prep) (new Function(prep))(); activeTab = tab; renderTab(); if (typeof updateHeaderActions === 'function') updateHeaderActions(); }, { tab, prep });

    // ── Productos ─────────────────────────────────────────────────────────
    await ir('productos'); await p.waitForTimeout(200);
    const pr = await p.evaluate(() => ({
      n: document.querySelectorAll('.pa-barra button').length,
      recortes: [...document.querySelectorAll('.pa-barra button')].filter(b => b.scrollWidth > b.clientWidth + 1).length,
      micro: (document.querySelector('.pa-micro') || {}).innerText || '',
      linea: [...document.querySelectorAll('.cat-prod__linea')].every(l => { const a = l.querySelector('.cat-prod__cod').getBoundingClientRect(), u = l.querySelector('.cat-prod__uom').getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (u.top + u.bottom) / 2) < 14; })
    }));
    chk('[' + ANCHO + '] Productos: barra de 4 acciones sin texto recortado', pr.n === 4 && pr.recortes === 0, JSON.stringify(pr));
    chk('[' + ANCHO + '] Productos: microcopy "3 productos • 3 visibles"', /3 productos • 3 visibles/.test(pr.micro), pr.micro);
    chk('[' + ANCHO + '] Productos: código, nombre y unidad en el mismo renglón', pr.linea);
    chk('[' + ANCHO + '] Productos: sin desplazamiento horizontal', await sinDesborde());

    // ── Pedido sugerido ───────────────────────────────────────────────────
    await ir('pedido_sugerido'); await p.waitForTimeout(200);
    const ps = await p.evaluate(() => {
      const c = document.querySelector('.ps-check__c'); const r = c ? c.getBoundingClientRect() : { width: 0 };
      const pie = document.querySelector('.ps-pie').getBoundingClientRect();
      return { tarjetas: document.querySelectorAll('.ps-card').length, circulo: Math.round(r.width), checks: [...document.querySelectorAll('.ps-check')].map(b => Math.round(b.getBoundingClientRect().height)),
               maximo: /Máximo stock/.test(document.getElementById('tabContent').innerText), pieVisible: pie.bottom <= window.innerHeight + 1 && pie.height > 0,
               total: document.querySelector('.ps-pie__txt').innerText };
    });
    chk('[' + ANCHO + '] Pedido sugerido: casilla circular visible (24 px) dentro de un objetivo de 44 px', ps.tarjetas === 3 && ps.circulo >= 20 && ps.checks.every(h => h >= 44), JSON.stringify(ps));
    chk('[' + ANCHO + '] Pedido sugerido: total estimado 2×$28 + 2×$180 + 2×$820 = $2,056', /3 productos/.test(ps.total) && /\$2,056/.test(ps.total), ps.total);
    chk('[' + ANCHO + '] Pedido sugerido: sin "Máximo stock" y con barra inferior fija visible', !ps.maximo && ps.pieVisible, JSON.stringify(ps));
    chk('[' + ANCHO + '] Pedido sugerido: sin desplazamiento horizontal', await sinDesborde());

    // ── Inventario ────────────────────────────────────────────────────────
    await ir('inventario', "_auditoriaSessionId='S7'; _inventarioActivoCarga='ok'; _inventarioActivo={numero:7,estado:'SINCRONIZADO',fechaCreacion:Date.now(),creadoPorNombre:'Eduardo',creadoPorRol:'ADMIN',fechaRecuento:'2026-10-18',semanaId:'2026-10-12',warehousesSnapshot:['almacen','barra1','barra2']}; allUsersAuditoria={u1:{uid:'u1',email:'luis@barra.mx',conteo:{'1020010':{almacen:{enteras:2,abiertas:[]}}},status:{almacen:'completada'},updatedAt:Date.now()}}; auditoriaStatus={almacen:'completada',barra1:'en_progreso',barra2:'pendiente'}; auditoriaView='selection';");
    await p.waitForTimeout(250);
    // v5.28 (16-oct-2026) — mismo diseño de siempre, compactado.
    const inv = await p.evaluate(() => {
      const t = document.getElementById('tabContent'), r = e => Math.round(e.getBoundingClientRect().height);
      const bts = [...t.querySelectorAll('button.bt')].filter(b => b.offsetParent);
      return {
        alto: Math.round(t.querySelector('.if-pantalla').getBoundingClientRect().height),
        tarjetas: [...t.querySelectorAll('.if-area .audit-area-card')].map(r),
        botones: bts.map(b => [b.innerText.trim().slice(0, 24), r(b), parseFloat(getComputedStyle(b).fontSize)]),
        recortes: bts.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.innerText.trim()),
        estado: t.querySelector('.pm-estado--cab').textContent.replace(/\s+/g, ' ').trim(),
        tituloYEstadoJuntos: (() => { const a = t.querySelector('.if-card__titulo').getBoundingClientRect(), b = t.querySelector('.pm-estado--cab').getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 12; })()
      };
    });
    chk('[' + ANCHO + '] Inventario: conserva las 3 tarjetas de área (>= 72 px, piso FASE 10B) y todos los botones con texto', inv.tarjetas.length === 3 && inv.tarjetas.every(h => h >= 72) && inv.botones.length >= 9, JSON.stringify(inv));
    chk('[' + ANCHO + '] Inventario: botones >= 48 px, texto >= 14 px y sin texto recortado (piso FASE 10B)', inv.botones.every(b => b[1] >= 48 && b[2] >= 14) && inv.recortes.length === 0, JSON.stringify(inv.botones));
    chk('[' + ANCHO + '] Inventario: título y estado en el mismo renglón; el estado se lee completo', inv.tituloYEstadoJuntos && /INVENTARIO BARRA SINCRONIZADO/.test(inv.estado), JSON.stringify(inv));
    chk('[' + ANCHO + '] Inventario: la pantalla completa mide <= 1800 px (antes ~2330 px a 390)', inv.alto <= 1800, String(inv.alto));
    chk('[' + ANCHO + '] Inventario: sin desplazamiento horizontal (incluye el panel de conteos por usuario)', await sinDesborde());

    // ── Gestión de equipo ─────────────────────────────────────────────────
    await ir('admin', "_adminSubvista='permisos'; _permUidSel=null; _permUsuarios=[{uid:'admin1',email:'eduardo@barra.mx',displayName:'Eduardo',role:'ADMIN',status:'activo'},{uid:'u1',email:'luis.perez.bartender@barra.mx',displayName:'Luis Pérez',role:'BARTENDER',status:'activo'},{uid:'u3',email:'temp@barra.mx',role:'BARTENDER',status:'inactivo'}];");
    await p.waitForTimeout(200);
    const eq = await p.evaluate(() => ({ cards: [...document.querySelectorAll('.eq-card')].map(c => Math.round(c.getBoundingClientRect().height)), micro: document.getElementById('tabContent').innerText.match(/\d+ personas • \d+ activas/) }));
    chk('[' + ANCHO + '] Equipo: 3 tarjetas táctiles (>= 44 px) y microcopy de personas activas', eq.cards.length === 3 && eq.cards.every(h => h >= 44) && !!eq.micro, JSON.stringify(eq));
    chk('[' + ANCHO + '] Equipo: sin desplazamiento horizontal', await sinDesborde());

    // ── Ventas ────────────────────────────────────────────────────────────
    await ir('ventas', "ventasSemanaId=semanaId(new Date()); ventas=[{sku:'4501',nombre:'MARGARITA CLASICA DE LA CASA CON SAL DE GUSANO',tipo:'Coctel',cantidad:48,ventaNeta:7680},{sku:'2210',nombre:'CERVEZA',tipo:'Cerveza',cantidad:90,ventaNeta:5400}]; ventasPeriodos=[{inicio:ventasSemanaId,fin:ventasSemanaId}]; ventasImportView='lista';");
    await p.waitForTimeout(200);
    const vs = await p.evaluate(() => ({ kpis: document.querySelectorAll('.vs-kpi').length, txt: document.getElementById('tabContent').innerText,
      sig: document.querySelector('.vs-flecha[aria-label="Semana siguiente"]').disabled, flechas: [...document.querySelectorAll('.vs-flecha')].map(b => Math.round(b.getBoundingClientRect().width)) }));
    chk('[' + ANCHO + '] Ventas: 3 KPIs con Venta neta $13,080 y 138 artículos', vs.kpis === 3 && /\$13,080/.test(vs.txt) && /138/.test(vs.txt), vs.txt.slice(0, 200));
    chk('[' + ANCHO + '] Ventas: en la semana actual no se puede avanzar y las flechas miden 44 px', vs.sig && vs.flechas.every(w => w === 44), JSON.stringify(vs.flechas));
    chk('[' + ANCHO + '] Ventas: sin desplazamiento horizontal', await sinDesborde());
    const antes = await p.evaluate(() => JSON.stringify([ventas, ventasPeriodos, ventasSemanaId]));
    await p.evaluate(() => document.querySelector('.vs-flecha').click());
    await p.waitForTimeout(250);
    const desp = await p.evaluate(() => ({ g: JSON.stringify([ventas, ventasPeriodos, ventasSemanaId]), txt: document.getElementById('tabContent').innerText }));
    chk('[' + ANCHO + '] ★ Ventas: ver la semana anterior no toca la semana activa (Total y consumo teórico)', desp.g === antes && /Solo consulta/.test(desp.txt), desp.txt.slice(0, 200));
    await p.close();
  }
  chk('Sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  await nav.close();

  console.log('\n  ── v5.28 · Rediseño de módulos (navegador) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + (c.d || ''))));
  const f = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - f) + ' pasaron · ' + f + ' fallaron\n');
  process.exit(f ? 1 : 0);
})();
