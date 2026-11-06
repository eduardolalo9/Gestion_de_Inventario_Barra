// v5.40 — Chromium real (390 × 844): Recetario (buscar por receta o por insumo; menú ⋮ con
// Editar / Desactivar / Eliminar), regla de ceros (lo no contado = 0) y Control de negativos.
// Nada toca Firebase: el corte y las ventas se siembran en memoria.
//   npm run test:v540nav
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
    { id: 'A', name: 'TEQUILA 1800 AÑEJO', group: 'TEQUILA', unit: 'PZA', precio: 300, stockMinimo: 1, stockByArea: { almacen: 9, barra1: 0, barra2: 0 } },
    { id: 'B', name: 'LIMON PERSA', group: 'FRUTA', unit: 'PZA', precio: 10, stockMinimo: 1, stockByArea: { almacen: 9, barra1: 0, barra2: 0 } },
    { id: 'C', name: 'RON BLANCO', group: 'RON', unit: 'PZA', precio: 200, stockMinimo: 1, stockByArea: { almacen: 9, barra1: 0, barra2: 0 } }
  ];
  recetas = [
    { id: 'R1', nombre: 'MARGARITA', pv: 'PV1', categoria: 'Cocteles', activa: true, ingredientes: [{ productoId: 'A', cantidad: 0.06, uom: 'PZA' }, { productoId: 'B', cantidad: 1, uom: 'PZA' }, { productoId: 'C', cantidad: 0.05, uom: 'PZA' }] },
    { id: 'R2', nombre: 'MOJITO', pv: 'PV2', categoria: 'Cocteles', activa: true, ingredientes: [{ productoId: 'C', cantidad: 0.06, uom: 'PZA' }] }
  ];
  const hoy = new Date(), f = (n) => { const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - n); return fechaISOLocal(d); };
  window.__f = { corte: f(3), venta: f(2) };
  _existenciaInicial = { semana: existenciaSemanaHoy(), estado: 'ok', saldos: { A: 1, B: 50 }, origen: null,
                         ancla: { tipo: 'mitad_de_semana', fecha: f(3), id: f(3), ruta: 'arrastre', dias: 3 } };
  _existenciaArrastre = { anclaFecha: f(3), compras: [], comprasNoDisponibles: false, ventasNoDisponibles: false, version: 4040,
                          periodos: [{ id: f(2) + '_' + f(2), inicio: f(2), fin: f(2), semanaId: semanaId(f(2)), lineas: [{ sku: 'PV1', nombre: 'MARGARITA', cantidad: 30, ventaNeta: 3000 }] }] };
  movimientos = [];
};
(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('inventarioApp_theme', 'dark'); localStorage.setItem('inventarioApp_temaMarca', 'ultra-pro'); } catch (e) {} });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  p.on('dialog', d => d.dismiss());
  await p.goto(URL_APP, { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600); await p.evaluate(MONTAJE);

  // ═══ 1 · Recetario ═══
  await p.evaluate(() => { activeTab = 'recetario'; renderTab(); }); await p.waitForTimeout(250);
  const chips = await p.evaluate(() => [...document.querySelectorAll('[data-sbx-chips="recetario"] .sbx-chip')].map(b => [b.textContent.trim(), b.getAttribute('aria-pressed')]));
  chk('★ Recetario: chips «Receta» (activo por defecto) e «Insumo»', JSON.stringify(chips) === JSON.stringify([['Receta', 'true'], ['Insumo', 'false']]), JSON.stringify(chips));
  chk('★ Las tarjetas ya no muestran Editar/Desactivar/Eliminar sueltos: solo el botón ⋮ (44 px de alto)', await p.evaluate(() => {
    const c = document.querySelector('.rec-card'); const b = c.querySelector('.rec-menu__btn'); const l = c.querySelector('.rec-menu__lista');
    return !!b && l.hidden && b.getBoundingClientRect().height >= 44 && !/Editar|Eliminar|Desactivar/.test(c.innerText);
  }));
  await p.fill('#sbx-input-recetario', 'mojito'); await p.waitForTimeout(450);
  chk('Modo Receta: «mojito» encuentra la receta MOJITO por su nombre', await p.evaluate(() => { const t = [...document.querySelectorAll('.rec-card__nom')].map(n => n.textContent); return t.length === 1 && t[0] === 'MOJITO'; }));
  await p.click('[data-sbx-filtro="porInsumo"]'); await p.fill('#sbx-input-recetario', 'tequila'); await p.waitForTimeout(450);
  const porIns = await p.evaluate(() => [...document.querySelectorAll('.rec-card')].map(c => ({ n: c.querySelector('.rec-card__nom').textContent, i: (c.querySelector('.rec-card__insumo') || {}).textContent || '' })));
  chk('★ Modo Insumo: «tequila» encuentra solo MARGARITA y dice qué insumo coincide', porIns.length === 1 && porIns[0].n === 'MARGARITA' && /TEQUILA 1800/.test(porIns[0].i), JSON.stringify(porIns));
  await p.fill('#sbx-input-recetario', 'ron'); await p.waitForTimeout(450);
  chk('Modo Insumo: «ron» encuentra las dos recetas que llevan RON BLANCO', (await p.evaluate(() => document.querySelectorAll('.rec-card').length)) === 2);
  await p.fill('#sbx-input-recetario', 'C'); await p.waitForTimeout(450);
  chk('Modo Insumo: también por código del insumo', (await p.evaluate(() => document.querySelectorAll('.rec-card').length)) === 2);
  await p.fill('#sbx-input-recetario', ''); await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(150); await p.click('[data-sbx-filtro="porReceta"]'); await p.waitForTimeout(400);
  // Menú
  await p.click('.rec-card .rec-menu__btn'); await p.waitForTimeout(150);
  const menu = await p.evaluate(() => { const l = document.querySelector('.rec-card .rec-menu__lista'); return { abierto: !l.hidden, items: [...l.querySelectorAll('[role="menuitem"]')].map(i => [i.textContent.trim(), Math.round(i.getBoundingClientRect().height)]), vista: recetarioView,
    aria: document.querySelector('.rec-card .rec-menu__btn').getAttribute('aria-expanded') }; });
  chk('★ ⋮ despliega Editar, Desactivar y Eliminar (44 px c/u) SIN abrir la ficha', menu.abierto && menu.items.map(i => i[0]).join('|') === 'Editar|Desactivar|Eliminar' && menu.items.every(i => i[1] >= 44) && menu.vista !== 'ficha' && menu.aria === 'true', JSON.stringify(menu));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  chk('Escape cierra el menú', await p.evaluate(() => document.querySelector('.rec-card .rec-menu__lista').hidden));
  await p.click('.rec-card .rec-menu__btn'); await p.click('.rec-card [data-rec-accion="activar"]'); await p.waitForTimeout(200);
  chk('★ Desactivar desde el menú cambia la receta (queda Inactiva)', await p.evaluate(() => recetas.find(r => r.id === 'R1').activa === false && /Inactiva/i.test(document.querySelector('.rec-card').innerText)));
  await p.click('.rec-card .rec-menu__btn'); await p.click('.rec-card [data-rec-accion="activar"]'); await p.waitForTimeout(200);
  chk('…y «Activar» desde el mismo menú la regresa', await p.evaluate(() => recetas.find(r => r.id === 'R1').activa === true));
  await p.click('.rec-card .rec-menu__btn'); await p.click('.rec-card [data-rec-accion="eliminar"]'); await p.waitForTimeout(200);
  chk('Eliminar pide confirmación (no borra de inmediato)', await p.evaluate(() => !!document.getElementById('_confirmOverlay') && recetas.length === 2));
  await p.click('#_cfmCancel'); await p.waitForTimeout(100);
  await p.click('.rec-card .rec-menu__btn'); await p.click('.rec-card [data-rec-accion="editar"]'); await p.waitForTimeout(250);
  chk('Editar desde el menú abre el editor de la receta', await p.evaluate(() => { const m = document.getElementById('recetaModal'); return !!m && !m.classList.contains('hidden'); }));
  await p.evaluate(() => closeRecetaModal());
  await p.click('.rec-card .rec-card__nom'); await p.waitForTimeout(250);
  const ficha = await p.evaluate(() => ({ vista: recetarioView, menu: !!document.querySelector('#tabContent .rec-menu__btn'), sueltos: [...document.querySelectorAll('#tabContent button')].filter(b => /^(Editar|Eliminar|Desactivar|Activar)$/.test(b.textContent.trim()) && b.offsetParent).length }));
  chk('★ Tocar la tarjeta abre la ficha, y la ficha usa el mismo menú ⋮ (sin botones sueltos)', ficha.vista === 'ficha' && ficha.menu && ficha.sueltos === 0, JSON.stringify(ficha));

  // ═══ 2 · Regla de ceros ═══
  const cero = await p.evaluate(() => { const r = existenciaOficial(products[2]); return { valor: r.valor, origen: r.origen, ini: r.inicial }; });
  chk('★ Regla de ceros: RON BLANCO no estaba en el corte → inicial 0 − 1.5 de consumo = −1.5 (nunca el respaldo operativo de 9)', cero.valor === -1.5 && cero.origen === 'oficial' && cero.ini === 0, JSON.stringify(cero));

  // ═══ 3 · Control de negativos ═══
  await p.evaluate(() => { activeTab = 'ventas'; ventasImportView = 'lista'; renderTab(); }); await p.waitForTimeout(250);
  const acceso = await p.evaluate(() => { const b = document.querySelector('.cn-acceso'); return b ? { n: (b.querySelector('.cn-acceso__n') || {}).textContent, h: Math.round(b.getBoundingClientRect().height) } : null; });
  chk('★ Ventas muestra «Control de negativos» con cuántos insumos están en negativo (2)', acceso && acceso.n === '2' && acceso.h >= 44, JSON.stringify(acceso));
  await p.click('.cn-acceso'); await p.waitForTimeout(250);
  const cn = await p.evaluate(() => ({ filas: [...document.querySelectorAll('.cn-fila')].map(f => f.innerText.replace(/\s+/g, ' ')), kpis: [...document.querySelectorAll('.kpi')].map(k => k.innerText.replace(/\s+/g, ' ')),
    corte: (document.querySelector('.cn-corte') || {}).textContent || '' }));
  chk('★ Lista de negativos: RON (−1.5, sin estar en el corte) y TEQUILA (1 − 1.8 = −0.8), el mayor pendiente primero', cn.filas.length === 2 && /RON BLANCO/.test(cn.filas[0]) && /-1\.5/.test(cn.filas[0]) && /TEQUILA/.test(cn.filas[1]) && /-0\.8/.test(cn.filas[1]), JSON.stringify(cn.filas));
  chk('Cada negativo dice desde qué día (el de la venta)', await p.evaluate(() => { const [y, m, d] = window.__f.venta.split('-'); return [...document.querySelectorAll('.cn-fila')].every(f => f.innerText.includes('DESDE ' + d + '/' + m) || f.innerText.includes('desde ' + d + '/' + m)); }));
  chk('KPIs: 2 en negativo y valor pendiente $540.00 (1.5×200 + 0.8×300)', /2 En negativo/i.test(cn.kpis[0]) && /\$540\.00/.test(cn.kpis[2]), JSON.stringify(cn.kpis));
  chk('Dice de qué corte parte y que lo anterior quedó absorbido', /absorbido/.test(cn.corte) && /1 de/.test(cn.corte), cn.corte);
  await p.click('.sbx-chip:has-text("No alcanza")'); await p.waitForTimeout(200);
  const riesgo = await p.evaluate(() => [...document.querySelectorAll('.cn-fila')].map(f => f.innerText.replace(/\s+/g, ' ')));
  chk('★ «No alcanza»: LIMÓN con 20 en stock y 30 de consumo diario no llega a un día', riesgo.length === 1 && /LIMON/.test(riesgo[0]) && /NO ALCANZA/i.test(riesgo[0]), JSON.stringify(riesgo));
  await p.click('.sbx-chip:has-text("Negativos")'); await p.waitForTimeout(200);
  const antes = await p.evaluate(() => JSON.stringify({ products, recetas, i: _existenciaInicial.saldos }));
  await p.evaluate(() => document.querySelector('.cn-fila .cn-btn').click()); await p.waitForTimeout(400);
  const rec = await p.evaluate(() => ({ tab: activeTab, insumo: BusquedaUI.filtroActivo('recetario', 'porInsumo'), n: [...document.querySelectorAll('.rec-card__nom')].map(x => x.textContent) }));
  chk('★ «Recetas que lo usan» abre el Recetario buscando por ese insumo (RON → MARGARITA y MOJITO)', rec.tab === 'recetario' && rec.insumo && rec.n.length === 2, JSON.stringify(rec));
  chk('★ El control de negativos solo lee: catálogo, recetas y corte intactos', (await p.evaluate(() => JSON.stringify({ products, recetas, i: _existenciaInicial.saldos }))) === antes);
  await p.evaluate(() => { activeTab = 'ventas'; controlNegativosAbrir(); }); await p.waitForTimeout(200);
  await p.click('.mc-cab__volver'); await p.waitForTimeout(200);
  chk('Volver regresa a Ventas', await p.evaluate(() => !controlNegativosActivo() && !!document.querySelector('.cn-acceso')));
  chk('Sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  await nav.close();
  console.log('\n  ── v5.40 · Recetario, regla de ceros y Control de negativos (navegador) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + c.d)));
  const fl = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fl) + ' pasaron · ' + fl + ' fallaron\n');
  process.exit(fl ? 1 : 0);
})();
