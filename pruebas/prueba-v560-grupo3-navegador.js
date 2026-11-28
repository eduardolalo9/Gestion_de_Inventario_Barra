// v5.60 — Grupo 3 del rediseño, medido en Chromium contra la app real (datos ficticios).
// · H10: «Fecha no registrada» en un inventario cerrado sin fechaCierre (tarjeta y detalle).
// · H11: la fila de filtros del buscador común desvanece su borde solo donde hay más filtros.
// · H7 (descartado): volver a pintar Inicio estando abajo deja la vista donde estaba
//   (la promesa de v5.17, «la pantalla no se mueve bajo los dedos»).
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d === undefined ? '' : String(d).slice(0, 300) });
const PUERTO = process.env.PUERTO || '8080';

const SEMBRAR = () => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden');
  document.getElementById('loginScreen').classList.add('auth-hidden');
  document.getElementById('appWrapper').classList.add('auth-visible');
  const b = document.getElementById('bannerEntorno'); if (b) b.style.display = 'none';
  currentUserUid = 'adm1'; _authzState.loaded = true; _authzState.overrides = {};
  _authzState.permissions = new Set(['*']); _authzState.roleId = 'ADMIN';
  const g = ['TEQUILA', 'RON', 'WHISKY', 'VODKA', 'GINEBRA', 'ABARROTES', 'FRUTA Y VERDURA', 'REFRESCOS'];
  products = [];
  for (let i = 0; i < 220; i++) products.push({ id: 'P' + i, name: g[i % 8] + ' MARCA FICTICIA ' + i, unit: i % 3 ? 'Botellas' : 'KGS', group: g[i % 8],
    precio: 300 + i * 3.5, stockMinimo: 4, conversion: 750, capacidadMl: 750, pv: 'PV' + i, proveedor: 'DISTRIBUIDORA FICTICIA ' + (i % 5) });
  recetas = []; ventas = []; orders = []; inventories = []; cart = [];
  _auditoriaSessionId = 'S7'; _inventarioActivoCarga = 'ok';
  _inventarioActivo = { numero: 7, estado: 'SINCRONIZADO', fechaCreacion: Date.now(), creadoPorNombre: 'Demo', creadoPorRol: 'ADMIN', fechaRecuento: '2026-11-22', semanaId: '2026-11-16', warehousesSnapshot: ['almacen', 'barra1', 'barra2'] };
  const cnt = {};
  for (let i = 0; i < 220; i++) { const c = {}; if (i % 3 === 0) c.almacen = { enteras: i % 5, abiertas: i % 2 ? [12.5] : [] }; if (i % 2 === 0) c.barra1 = { enteras: (i % 4) + 1, abiertas: [] }; if (Object.keys(c).length) cnt['P' + i] = c; }
  auditoriaConteo = cnt; myAuditoriaConteo = JSON.parse(JSON.stringify(cnt)); allUsersAuditoria = {};
  auditoriaStatus = { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' };
  myAuditoriaStatus = { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' };
  auditoriaView = 'selection'; selectedGroup = 'Todos'; searchTerm = ''; activeTab = 'inicio';
};

const FILA = () => {
  const f = document.querySelector('#tabContent .sbx-chips[data-sbx-chips]');
  if (!f) return null;
  const cs = getComputedStyle(f);
  return { desborda: f.scrollWidth > f.clientWidth + 1, sl: Math.round(f.scrollLeft), mascara: (cs.maskImage || cs.webkitMaskImage || 'none') !== 'none',
           izq: cs.getPropertyValue('--sbx-borde-izq').trim(), der: cs.getPropertyValue('--sbx-borde-der').trim() };
};

async function abrir(nav, w, h) {
  const ctx = await nav.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(900);
  await p.evaluate('(' + SEMBRAR.toString() + ')()');
  return { ctx, p, errs };
}

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());

  // ── H10 ─────────────────────────────────────────────────────────────
  {
    const { ctx, p, errs } = await abrir(nav, 360, 800);
    const valida = await p.evaluate(() => new Date(2026, 10, 20, 15, 0).getTime());
    const fechaValida = await p.evaluate(v => new Date(v).toLocaleDateString('es-MX'), valida);
    const tarjeta = (fc, borrar, nombre) => p.evaluate(([fc, borrar, nombre]) => {
      _inventarioActivo = Object.assign({}, _inventarioActivo, { estado: 'CERRADO', fechaCierre: fc, cerradoPorNombre: nombre });
      if (borrar) delete _inventarioActivo.fechaCierre;
      activeTab = 'inventario'; auditoriaView = 'selection'; renderTab();
      const dt = [...document.querySelectorAll('#tabContent dt')].find(d => d.textContent.trim() === 'Cerrado');
      return dt ? (dt.nextElementSibling || dt.parentElement).textContent.trim() : null;
    }, [fc, borrar, nombre]);
    chk('★ H10 · tarjeta: fechaCierre en null → «Fecha no registrada · por Ana» (antes «31/12/1969»)', (await tarjeta(null, false, 'Ana')) === 'Fecha no registrada · por Ana', await tarjeta(null, false, 'Ana'));
    chk('★ H10 · tarjeta: sin el campo → «Fecha no registrada · por Ana» (antes «Invalid Date»)', (await tarjeta(null, true, 'Ana')) === 'Fecha no registrada · por Ana', await tarjeta(null, true, 'Ana'));
    chk('H10 · tarjeta: una fecha válida se pinta igual que antes', (await tarjeta(valida, false, 'Ana')) === fechaValida + ' por Ana', await tarjeta(valida, false, 'Ana'));
    await tarjeta(null, false, '<img src=x id=inyectado>');
    chk('H10 · el nombre se escapa: no aparece ningún <img> inyectado', await p.evaluate(() => !document.getElementById('inyectado')));
    const detalle = (meta) => p.evaluate((meta) => {
      _detalleInventarioCerradoId = 'inv-x'; _detalleInventarioCerradoData = { meta: meta, registros: [] };
      activeTab = 'inventario'; auditoriaView = 'detalle_cerrado'; renderTab();
      const dt = [...document.querySelectorAll('#tabContent dt')].find(d => d.textContent.trim() === 'Cerrado');
      return dt ? dt.nextElementSibling.textContent.trim() : null;
    }, meta);
    const base = { numero: 88, estado: 'CERRADO', fechaCreacion: valida - 86400000 * 30, creadoPorNombre: 'Demo', cerradoPorNombre: 'Ana' };
    chk('★ H10 · detalle de solo lectura: sin fechaCierre → «Fecha no registrada · por Ana»', (await detalle(base)) === 'Fecha no registrada · por Ana', await detalle(base));
    chk('H10 · detalle: fechaCierre en null → «Fecha no registrada · por Ana»', (await detalle(Object.assign({}, base, { fechaCierre: null }))) === 'Fecha no registrada · por Ana');
    chk('H10 · detalle: una fecha válida se pinta igual que antes', (await detalle(Object.assign({}, base, { estado: 'CONTABILIZADO', fechaCierre: valida }))) === fechaValida + ' por Ana');
    chk('H10 · sin errores de JavaScript', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ── H11 ─────────────────────────────────────────────────────────────
  for (const [w, h] of [[360, 800], [1366, 768]]) {
    const { ctx, p, errs } = await abrir(nav, w, h);
    await p.evaluate(() => { activeTab = 'productos'; renderTab(); window.scrollTo(0, 0); }); await p.waitForTimeout(400);
    const ini = await p.evaluate(FILA);
    if (w === 360) {
      chk('★ H11 · 360: la fila de filtros de Productos se desplaza y lleva la máscara', ini && ini.desborda && ini.mascara, JSON.stringify(ini));
      chk('★ H11 · 360, al inicio: se desvanece solo la orilla derecha (der 28 px, izq 0 px)', ini && ini.der === '28px' && ini.izq === '0px', JSON.stringify(ini));
      await p.evaluate(() => { const f = document.querySelector('#tabContent .sbx-chips[data-sbx-chips]'); f.scrollLeft = f.scrollWidth; }); await p.waitForTimeout(200);
      const fin = await p.evaluate(FILA);
      chk('★ H11 · 360, al final: se desvanece solo la orilla izquierda (izq 28 px, der 0 px)', fin && fin.sl > 0 && fin.izq === '28px' && fin.der === '0px', JSON.stringify(fin));
      // Una fila .sbx-chips que no es del buscador común (como la de Control de negativos) no cambia
      const ajena = await p.evaluate(() => { const d = document.createElement('div'); d.className = 'sbx-chips'; d.innerHTML = '<button type="button" class="sbx-chip">A</button>'; document.getElementById('tabContent').appendChild(d); const cs = getComputedStyle(d); const r = (cs.maskImage || cs.webkitMaskImage || 'none'); d.remove(); return r; });
      chk('H11 · una fila .sbx-chips sin data-sbx-chips no lleva máscara', ajena === 'none', ajena);
    } else {
      chk('★ H11 · 1366: la fila cabe completa y no se desvanece nada (izq y der 0 px)', ini && !ini.desborda && ini.izq === '0px' && ini.der === '0px', JSON.stringify(ini));
    }
    const toque = await p.evaluate(() => { const b = document.querySelector('#tabContent .sbx-chips[data-sbx-chips] button'); const a = b.getAttribute('aria-pressed'); b.click(); const b2 = document.querySelector('#tabContent .sbx-chips[data-sbx-chips] button'); return [a, b2 && b2.getAttribute('aria-pressed')]; });
    chk('H11 · ' + w + ': el primer filtro sigue respondiendo al toque', toque[0] === 'false' && toque[1] === 'true', JSON.stringify(toque));
    chk('H11 · ' + w + ': sin desborde de página ni errores de JavaScript', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) && errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ── H7 descartado: la vista no se mueve al volver a pintar Inicio estando abajo ──
  {
    const { ctx, p, errs } = await abrir(nav, 360, 800);
    await p.evaluate(() => { activeTab = 'inicio'; renderTab(); }); await p.waitForTimeout(500);
    const ARRIBA = () => { for (const c of document.querySelectorAll('#tabContent .prd-card')) { const r = c.getBoundingClientRect(); if (r.bottom > 120) { const n = c.querySelector('.prd-card__name'); return { n: n ? n.textContent.trim() : '?', top: Math.round(r.top) }; } } return null; };
    const alto = await p.evaluate(() => document.documentElement.scrollHeight);
    let ok = true; const det = [];
    for (const f of [0.5, 0.75]) {
      const y = Math.round(alto * f);
      for (let yy = 0; yy <= y; yy += 600) { await p.evaluate(v => posicionIrA(v), yy); await p.waitForTimeout(40); }
      await p.evaluate(v => posicionIrA(v), y); await p.waitForTimeout(300);
      const a = await p.evaluate(ARRIBA);
      await p.evaluate(() => renderTab()); await p.waitForTimeout(600);
      const d = await p.evaluate(ARRIBA);
      det.push(JSON.stringify([a, d]));
      if (!a || !d || a.n !== d.n || Math.abs(a.top - d.top) > 1) ok = false;
    }
    chk('★ H7 · Inicio: volver a pintar estando abajo deja el mismo producto en el mismo lugar', ok, det.join(' | '));
    chk('H7 · las tarjetas de Inicio no usan content-visibility', await p.evaluate(() => { const c = document.querySelector('#tabContent .prd-card'); return c && getComputedStyle(c).contentVisibility !== 'auto'; }));
    chk('H7 · sin errores de JavaScript', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  await nav.close();
  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── v5.60 · Grupo 3 (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
