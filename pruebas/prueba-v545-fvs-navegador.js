// v5.45 — Físico vs Sistema: resumen ejecutivo (KPIs), insignias con ayuda en
// vez de párrafos, pestañas Comparativo / Muestreo, selección múltiple con barra
// flotante, grupos plegables y edición rápida en la celda. Chromium real.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

const MONTAJE = (rol) => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden');
  document.getElementById('loginScreen').classList.add('auth-hidden');
  document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u1'; currentUserRole = rol === 'admin' ? 'admin' : 'user';
  _authzState.loaded = true; _authzState.overrides = {};
  _authzState.permissions = new Set(rol === 'admin' ? ['*'] : ['inventory.count', 'inventory.viewAll']);
  products = [
    { id: 'A', name: 'TEQUILA FALTANTE', group: 'TEQUILA', unit: 'Botellas', precio: 100, stockMinimo: 1, stockByArea: { almacen: 10 } },
    { id: 'B', name: 'RON SOBRANTE', group: 'RON', unit: 'Botellas', precio: 50, stockMinimo: 1, stockByArea: { almacen: 2 } },
    { id: 'C', name: 'VODKA SIN CONTAR', group: 'VODKA', unit: 'Botellas', precio: 20, stockMinimo: 1, stockByArea: { almacen: 5 } },
    { id: 'D', name: 'RON COINCIDE', group: 'RON', unit: 'Piezas', precio: 12.5, stockMinimo: 1, stockByArea: { almacen: 4 } },
    { id: 'DJ7', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'PZA', precio: 1480, capacidadMl: 700, pesoBotellaLlenaOz: 53.65, conteoOzHabilitado: true, stockMinimo: 1, stockByArea: { almacen: 6 } },
    { id: '0012', name: 'MEZCAL CÓDIGO CON CEROS', group: 'TEQUILA', unit: 'Botellas', precio: 300, stockMinimo: 1, stockByArea: { almacen: 1 } }
  ];
  auditoriaConteo = { A: { almacen: { enteras: 6, abiertas: [] } }, B: { almacen: { enteras: 3, abiertas: [] }, barra1: { enteras: 2, abiertas: [] } },
    D: { almacen: { enteras: 4, abiertas: [] } }, DJ7: { almacen: { enteras: 6, abiertas: [] } }, '0012': { barra1: { enteras: 3, abiertas: [] } } };
  myAuditoriaConteo = JSON.parse(JSON.stringify(auditoriaConteo));
  _auditoriaSessionId = 'INV1001'; _inventarioActivoId = 'INV1001';
  _inventarioActivo = { estado: 'SINCRONIZADO', numero: 1001, fechaCreacion: Date.now() };
  allUsersAuditoria = {}; activeTab = 'inventario'; auditoriaView = 'fisico_vs_sistema'; renderTab();
  window.__esp = { guardar: 0, syncMy: 0, notas: [] };
  const sg = window.saveToLocalStorage; window.saveToLocalStorage = function () { window.__esp.guardar++; return sg.apply(this, arguments); };
  window.syncMyAuditoriaToFirestore = function () { window.__esp.syncMy++; return Promise.resolve(); };
  const sn = window.showNotification; window.showNotification = function (m) { window.__esp.notas.push(String(m)); return sn.apply(this, arguments); };
};

async function abrir(nav, vp, rol) {
  const ctx = await nav.newContext({ viewport: vp, hasTouch: vp.width < 600 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  p.on('dialog', d => d.dismiss());
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600);
  await p.evaluate(MONTAJE, rol); await p.waitForTimeout(250);
  return { ctx, p, errs };
}
const filas = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#sbx-res-fvs tr.fvs-t__fila')).map(tr => tr.querySelector('.fvs-t__nom').textContent));
const datosApp = (p) => p.evaluate(() => JSON.stringify({ products, auditoriaConteo, myAuditoriaConteo }));

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());

  // ═══ 0 · Capa pura ══════════════════════════════════════════════════════
  let { ctx, p, errs } = await abrir(nav, { width: 390, height: 844 }, 'admin');
  const pura = await p.evaluate(() => ({
    v: ['7', '7,5', '0.125', ' 12 ', '0', '.5'].map(x => fvsValidarCantidad(x)),
    malos: ['abc', '5abc', '1e5', '-1', '', '10000', '1.2.3'].map(x => fvsValidarCantidad(x).ok),
    redondeo: fvsValidarCantidad('1.23456').valor,
    m1: fvsMuestraAleatoria([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], 2, ['b'], () => 0.5),
    m2: fvsMuestraAleatoria([{ id: 'a' }, { id: 'b' }], 5, ['a', 'b']),
    m3: fvsMuestraAleatoria([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 10, [])
  }));
  chk('Validación de la celda = la del modal: coma decimal, 0 y decimales válidos', pura.v.every(r => r.ok) && pura.v.map(r => r.valor).join('|') === '7|7.5|0.125|12|0|0.5', JSON.stringify(pura.v));
  chk('★ Rechaza texto, «5abc», notación científica, negativos, vacío, > 9999 y dos puntos', pura.malos.every(ok => ok === false), JSON.stringify(pura.malos));
  chk('Redondea a 3 decimales (como el conteo)', pura.redondeo === 1.235, String(pura.redondeo));
  chk('Muestra aleatoria: no repite lo que ya está en la lista y respeta el tamaño', pura.m1.length === 2 && !pura.m1.includes('b') && pura.m2.length === 0 && pura.m3.length === 3 && new Set(pura.m3).size === 3, JSON.stringify([pura.m1, pura.m2, pura.m3]));

  // ═══ 1 · Resumen ejecutivo e insignias (móvil, admin) ═══════════════════
  const k = await p.evaluate(() => {
    const d = fisicoVsSistemaCalcular();
    const kp = Array.from(document.querySelectorAll('.fvs-kpi')).map(x => x.innerText.replace(/\s+/g, ' ').trim());
    return { kp, d: { contados: d.contados, total: d.totalProductos, pend: d.pendientes, neto: d.totalNeto, nf: d.netoFaltante, ns: d.netoSobrante, cd: d.conDiferencia },
      parrafos: document.querySelectorAll('#tabContent .fvs-ayuda, #tabContent .pm-paso--aviso, #tabContent dl.if-datos').length,
      badges: Array.from(document.querySelectorAll('.fvs-badges summary')).map(s => s.innerText.trim()) };
  });
  chk('★ Datos del resumen: 5 de 6 contados, 1 sin contar, neto = faltante + sobrante', k.d.contados === 5 && k.d.total === 6 && k.d.pend === 1 && Math.abs(k.d.nf + k.d.ns - k.d.neto) < 0.01 && k.d.nf < 0 && k.d.ns > 0, JSON.stringify(k.d));
  chk('★ 4 tarjetas KPI: Contados X / total, Sin contar, Neto con cuántos difieren, Variaciones faltante · sobrante',
      k.kp.length === 4 && /contados 5 \/ 6/i.test(k.kp[0]) && /sin contar 1 cuentan como 0/i.test(k.kp[1]) && /neto/i.test(k.kp[2]) && new RegExp(k.d.cd + ' con diferencia').test(k.kp[2]) && /variaciones/i.test(k.kp[3]) && /faltante · sobrante/.test(k.kp[3]), JSON.stringify(k.kp));
  chk('★ Sin párrafos largos: la ayuda y el aviso de stock operativo son insignias', k.parrafos === 0 && k.badges.some(b => /Editable/.test(b)) && k.badges.some(b => /sin inicial/.test(b)), JSON.stringify(k));
  await p.click('.fvs-badges details:nth-of-type(1) summary'); await p.waitForTimeout(100);
  chk('Tocar la insignia muestra su explicación (y «Sistema» no se edita)', await p.evaluate(() => { const t = document.querySelector('.fvs-badges details[open] .fvs-tip'); return !!t && t.offsetHeight > 0 && /no se edita/.test(t.textContent); }));
  await p.click('.fvs-badges details:nth-of-type(1) summary');
  const tabs = await p.evaluate(() => Array.from(document.querySelectorAll('.fvs-tab')).map(b => ({ t: b.innerText.replace(/\s+/g, ' ').trim(), sel: b.getAttribute('aria-selected'), h: Math.round(b.getBoundingClientRect().height) })));
  chk('Pestañas Comparativo / Muestreo (0), ≥ 44 px, Comparativo activa', tabs.length === 2 && tabs[0].sel === 'true' && /Muestreo 0/.test(tabs[1].t) && tabs.every(t => t.h >= 44), JSON.stringify(tabs));

  // ═══ 2 · Selección múltiple y barra flotante ════════════════════════════
  const antes = await datosApp(p);
  await p.click('input[data-fvs-sel="A"]'); await p.click('input[data-fvs-sel="C"]');
  const s1 = await p.evaluate(() => { const b = document.getElementById('fvsSelBarra'), q = b.getBoundingClientRect(), tb = document.getElementById('bottomTabBar').getBoundingClientRect(), t = document.getElementById('fvsSelTodos');
    return { vis: !b.hidden && q.height > 0, n: document.getElementById('fvsSelN').textContent, dentro: q.left >= 0 && q.right <= innerWidth, sobreTab: q.bottom <= tb.top + 1, ind: t.indeterminate,
             marcadas: document.querySelectorAll('tr.fvs-t__fila--sel').length }; });
  chk('★ Marcar 2 productos muestra la barra flotante «2 seleccionados», sobre la barra inferior y dentro de la pantalla', s1.vis && s1.n === '2' && s1.dentro && s1.sobreTab && s1.marcadas === 2, JSON.stringify(s1));
  chk('La casilla de la cabecera queda a medias (indeterminada)', s1.ind);
  await p.click('#fvsSelTodos');
  chk('★ La casilla de la cabecera marca todos los visibles (6)', await p.evaluate(() => document.getElementById('fvsSelN').textContent === '6' && document.querySelectorAll('#sbx-res-fvs input[data-fvs-sel]:checked').length === 6));
  await p.click('[data-fvs-accion="sel-limpiar"]');
  chk('Quitar la selección oculta la barra', await p.evaluate(() => document.getElementById('fvsSelBarra').hidden && !document.querySelector('#sbx-res-fvs input[data-fvs-sel]:checked')));
  chk('★ Seleccionar no escribe nada (ni conteo ni sincronización)', (await datosApp(p)) === antes && await p.evaluate(() => window.__esp.guardar === 0 && window.__esp.syncMy === 0));

  // ═══ 3 · Grupos plegables ═══════════════════════════════════════════════
  await p.click('button.fvs-t__gcab[data-fvs-grupo="RON"]'); await p.waitForTimeout(150);
  let f = await filas(p);
  chk('★ Plegar «RON» oculta sus 2 productos (los demás siguen) y lo anuncia (aria-expanded)', f.length === 4 && !f.some(x => /^RON/.test(x)) && await p.evaluate(() => document.querySelector('button.fvs-t__gcab[data-fvs-grupo="RON"]').getAttribute('aria-expanded') === 'false'), f.join(','));
  await p.click('button.fvs-t__gcab[data-fvs-grupo="RON"]'); await p.waitForTimeout(150);
  chk('Desplegarlo los regresa', (await filas(p)).length === 6);

  // ═══ 4 · Edición rápida en la celda ═════════════════════════════════════
  await p.click('button[data-fvs-accion="editar"][data-fvs-pid="0012"][data-fvs-area="barra1"]'); await p.waitForTimeout(150);
  const e1 = await p.evaluate(() => { const i = document.querySelector('.fvs-inl__in'); return { ok: !!i, val: i && i.value, foco: document.activeElement === i, modal: !document.getElementById('inventarioModal').classList.contains('hidden') }; });
  chk('★ Producto por cantidad: el área se edita en la misma celda (valor actual y foco), sin modal', e1.ok && e1.val === '3' && e1.foco && !e1.modal, JSON.stringify(e1));
  await p.fill('.fvs-inl__in', '5abc'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  const e2 = await p.evaluate(() => ({ inv: document.querySelector('.fvs-inl__in').getAttribute('aria-invalid'), nota: window.__esp.notas.slice(-1)[0] || '' }));
  chk('★ Un valor inválido no se guarda: avisa y marca el campo', e2.inv === 'true' && /número/.test(e2.nota) && (await datosApp(p)) === antes, JSON.stringify(e2));
  await p.fill('.fvs-inl__in', '7,5'); await p.click('[data-fvs-accion="inl-ok"]'); await p.waitForTimeout(300);
  const e3 = await p.evaluate(() => ({ reg: myAuditoriaConteo['0012'].barra1, sync: window.__esp.syncMy, guardar: window.__esp.guardar }));
  chk('★ Guardar (coma decimal) escribe 7.5 como conteo del administrador y sincroniza (la vía de siempre)', e3.reg.enteras === 7.5 && e3.reg._fvs === true && e3.sync === 1 && e3.guardar === 1, JSON.stringify(e3));
  chk('«Sistema» no se tocó (solo se corrige lo contado)', await p.evaluate(() => products.find(x => x.id === '0012').stockByArea.almacen === 1));
  await p.click('button[data-fvs-accion="editar"][data-fvs-pid="A"][data-fvs-area="almacen"]'); await p.waitForTimeout(150);
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  chk('Guardar el mismo valor no escribe («Sin cambios»)', await p.evaluate(() => window.__esp.syncMy === 1 && /Sin cambios/.test(window.__esp.notas.slice(-1)[0] || '')));
  await p.click('button[data-fvs-accion="editar"][data-fvs-pid="DJ7"][data-fvs-area="almacen"]'); await p.waitForTimeout(250);
  chk('★ Producto de botella (oz): sigue abriendo el modal de conteo (necesita las onzas)', await p.evaluate(() => !document.getElementById('inventarioModal').classList.contains('hidden') && !document.querySelector('.fvs-inl')));
  await p.evaluate(() => closeInventarioModal()); await p.waitForTimeout(150);

  // ═══ 5 · Muestreo ═══════════════════════════════════════════════════════
  await p.click('input[data-fvs-sel="A"]'); await p.click('input[data-fvs-sel="C"]');
  await p.click('[data-fvs-accion="sel-muestreo"]'); await p.waitForTimeout(250);
  const m1 = await p.evaluate(() => ({ tab: _fvsVista.tab, sel: document.getElementById('fvsTab-muestreo').getAttribute('aria-selected'), items: Array.from(document.querySelectorAll('.fvs-mu__item .fvs-mu__nom')).map(x => x.textContent),
    ls: JSON.parse(localStorage.getItem('inventarioApp_fvsMuestreo') || 'null'), n: document.querySelector('.fvs-tab__n').textContent, barra: !document.getElementById('fvsSelBarra') }));
  chk('★ «Agregar a muestreo» abre la pestaña Muestreo con los 2 productos', m1.tab === 'muestreo' && m1.sel === 'true' && m1.items.join('|') === 'TEQUILA FALTANTE|VODKA SIN CONTAR' && m1.n === '2', JSON.stringify(m1));
  chk('La lista se guarda en este dispositivo, ligada al inventario (no en Firebase)', m1.ls && m1.ls.inventoryId === 'INV1001' && m1.ls.ids.join() === 'A,C', JSON.stringify(m1.ls));
  chk('Cada producto del muestreo muestra sus 3 áreas editables, físico, sistema y neto', await p.evaluate(() => { const it = document.querySelector('.fvs-mu__item'); return it.querySelectorAll('button[data-fvs-accion="editar"]').length === 3 && /Físico 6\.00 · Sistema 10\.00/.test(it.innerText.replace(/\s+/g, ' ')); }));
  await p.click('.fvs-mu__item:first-of-type button[data-fvs-accion="editar"][data-fvs-area="barra2"]'); await p.waitForTimeout(150);
  chk('★ En el muestreo también se corrige al toque en la celda', await p.evaluate(() => !!document.querySelector('.fvs-mu__item .fvs-inl__in')));
  await p.keyboard.press('Escape');
  await p.click('[data-fvs-accion="mu-revisado"][data-fvs-pid="A"]'); await p.waitForTimeout(150);
  chk('★ «Marcar revisado»: 1 de 2 revisados y el botón queda presionado', await p.evaluate(() => /1 de 2 revisados/.test(document.querySelector('.fvs-mu__prog').innerText) && document.querySelector('[data-fvs-accion="mu-revisado"][data-fvs-pid="A"]').getAttribute('aria-pressed') === 'true'));
  await p.evaluate(() => fvsMuestreoAleatoria(5)); await p.waitForTimeout(200);
  const m2 = await p.evaluate(() => _fvsMuestreo().ids.slice());
  chk('Muestra aleatoria (5) completa la lista sin repetir (6 productos en total)', m2.length === 6 && new Set(m2).size === 6, JSON.stringify(m2));
  await p.click('[data-fvs-accion="mu-quitar"][data-fvs-pid="C"]'); await p.waitForTimeout(150);
  chk('Quitar un producto lo saca de la lista (los conteos no cambian)', await p.evaluate(() => !_fvsMuestreo().ids.includes('C') && document.querySelectorAll('.fvs-mu__item').length === 5));
  chk('Sin desplazamiento horizontal de la página (móvil)', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.click('#fvsTab-comparativo'); await p.waitForTimeout(150);
  chk('Volver a Comparativo muestra la tabla', (await filas(p)).length === 6);
  chk('Sin errores de JavaScript (admin)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 6 · Solo lectura (sin ser administración) ══════════════════════════
  ({ ctx, p, errs } = await abrir(nav, { width: 390, height: 844 }, 'ver'));
  const ro = await p.evaluate(() => ({ editar: document.querySelectorAll('button[data-fvs-accion="editar"]').length, badge: Array.from(document.querySelectorAll('.fvs-badges summary')).map(s => s.innerText).join('|'),
    chks: document.querySelectorAll('#sbx-res-fvs input[data-fvs-sel]').length }));
  chk('★ Sin ser administración: cero celdas editables e insignia «Solo lectura»; sí puede seleccionar y armar su muestreo', ro.editar === 0 && /Solo lectura/.test(ro.badge) && ro.chks === 6, JSON.stringify(ro));
  chk('Sin errores de JavaScript (solo lectura)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 7 · Escritorio claro y oscuro ══════════════════════════════════════
  for (const tema of ['light', 'dark']) {
    ({ ctx, p, errs } = await abrir(nav, { width: 1280, height: 800 }, 'admin'));
    const d = await p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t);
      const w = document.querySelector('.fvs-t-wrap'), kp = Array.from(document.querySelectorAll('.fvs-kpi')).map(x => Math.round(x.getBoundingClientRect().top));
      const neg = document.querySelector('.fvs-kpi__f');
      return { cabe: w.scrollWidth <= w.clientWidth + 1, unaFila: new Set(kp).size === 1, color: getComputedStyle(neg).color, fondo: getComputedStyle(document.querySelector('.fvs-kpi')).backgroundColor }; }, tema);
    chk(`[PC ${tema}] KPIs en una fila, tabla completa sin desplazamiento, faltante en color y tarjetas con fondo`, d.cabe && d.unaFila && /rgb/.test(d.color) && d.fondo !== 'rgba(0, 0, 0, 0)', JSON.stringify(d));
    chk(`[PC ${tema}] Sin errores de JavaScript`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  await nav.close();
  const w = Math.max(...C.map(c => c.n.length));
  console.log('\n  ── v5.45 · Físico vs Sistema: KPIs, selección, edición rápida y muestreo ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
  const fallos = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
