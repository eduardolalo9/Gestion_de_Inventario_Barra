// v5.46 — Muestreo compartido entre dispositivos y con el equipo, insignia sobre
// el buscador y autoguardado que ya no corre al volver a la app. Chromium real.
// Firestore se sustituye por un doble que REGISTRA cada update() (ruta y campos).
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

const FAKE = () => {
  window.__upd = [];
  const vacio = { exists: false, docs: [], empty: true, size: 0, forEach() {}, data() { return {}; }, docChanges() { return []; } };
  const mk = (ruta) => new Proxy(function () {}, {
    get(_, k) {
      if (k === 'update') return (...a) => { window.__upd.push({ ruta, a }); return Promise.resolve(); };
      if (k === 'get') return () => Promise.resolve(vacio);
      if (k === 'onSnapshot') return () => () => {};
      if (k === 'then') return undefined;
      return (...a) => mk(ruta + '/' + (typeof a[0] === 'string' ? a[0] : k));
    }
  });
  window.firebase = window.firebase || {};
  firebase.firestore = firebase.firestore || {};
  firebase.firestore.FieldValue = { arrayUnion: (...v) => ({ op: 'union', v }), arrayRemove: (...v) => ({ op: 'remove', v }), delete: () => ({ op: 'delete' }) };
  firebase.firestore.FieldPath = function (...s) { this.segmentos = s; };
  _db = mk('db');
};
const MONTAR = (rol) => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = rol === 'admin' ? 'adm' : 'usr'; currentUserRole = rol; _authzState.loaded = true; _authzState.overrides = {};
  _authzState.permissions = new Set(rol === 'admin' ? ['*'] : ['inventory.count', 'inventory.read']);
  products = [
    { id: 'A', name: 'TEQUILA FALTANTE', group: 'TEQUILA', unit: 'Botellas', precio: 100, stockMinimo: 1, stockByArea: { almacen: 10 } },
    { id: 'C', name: 'VODKA SIN CONTAR', group: 'VODKA', unit: 'Botellas', precio: 20, stockMinimo: 1, stockByArea: { almacen: 5 } },
    { id: 'X.1', name: 'CÓDIGO CON PUNTO', group: 'VODKA', unit: 'Piezas', precio: 5, stockMinimo: 1, stockByArea: { almacen: 2 } }
  ];
  auditoriaConteo = { A: { almacen: { enteras: 6, abiertas: [] } }, 'X.1': { almacen: { enteras: 2, abiertas: [] } } };
  myAuditoriaConteo = rol === 'admin' ? JSON.parse(JSON.stringify(auditoriaConteo)) : { A: { almacen: { enteras: 5, abiertas: [] } } };
  _auditoriaSessionId = 'INV1001'; _inventarioActivoId = 'INV1001'; _unsubInventarioActivo = () => {};
  _inventarioActivo = { estado: 'SINCRONIZADO', numero: 1001, fechaCreacion: Date.now() };
  allUsersAuditoria = {}; activeTab = 'inventario'; auditoriaView = rol === 'admin' ? 'fisico_vs_sistema' : 'selection'; renderTab();
  window.__esp = { sync: 0, guardar: 0 };
  window.syncMyAuditoriaToFirestore = function () { window.__esp.sync++; return Promise.resolve(); };
  const sg = window.saveToLocalStorage; window.saveToLocalStorage = function () { window.__esp.guardar++; return sg.apply(this, arguments); };
};
const ultimo = (p) => p.evaluate(() => { const u = window.__upd[window.__upd.length - 1]; return u ? { ruta: u.ruta, a: JSON.parse(JSON.stringify(u.a)) } : null; });

async function abrir(nav, rol, antesDeMontar) {
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600);
  if (antesDeMontar) await p.evaluate(antesDeMontar);
  await p.evaluate(FAKE); await p.evaluate(MONTAR, rol); await p.waitForTimeout(250);
  return { ctx, p, errs };
}

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());

  // ═══ 1 · Administración (PC): la lista se guarda en el inventario, no en el aparato ═══
  let { ctx, p, errs } = await abrir(nav, 'admin');
  await p.click('input[data-fvs-sel="A"]'); await p.click('input[data-fvs-sel="X.1"]');
  await p.click('[data-fvs-accion="sel-muestreo"]'); await p.waitForTimeout(250);
  let u = await ultimo(p);
  chk('★ «Agregar a muestreo» escribe en el documento del inventario abierto (inventories/INV1001)', u && /inventories\/INV1001$/.test(u.ruta), JSON.stringify(u && u.ruta));
  chk('★ Con arrayUnion (dos administradores no se pisan) y quién/cuándo', u && u.a[0] === 'muestreo.ids' && u.a[1].op === 'union' && JSON.stringify(u.a[1].v) === '["A","X.1"]'
      && u.a.includes('muestreo.actualizadoEn') && u.a.includes('muestreo.actualizadoPor') && u.a[u.a.indexOf('muestreo.actualizadoPor') + 1] === 'adm', JSON.stringify(u && u.a));
  chk('Nada se guarda en el almacenamiento del aparato (la lista vive en la nube)', await p.evaluate(() => localStorage.getItem('inventarioApp_fvsMuestreo') === null));
  chk('Se ve al instante en este aparato y dice que está compartida', await p.evaluate(() => document.querySelectorAll('.fvs-mu__item').length === 2 && /compartida con el equipo/.test(document.querySelector('.fvs-mu__prog').innerText)));
  await p.click('[data-fvs-accion="mu-revisado"][data-fvs-pid="X.1"]'); await p.waitForTimeout(150);
  u = await ultimo(p);
  chk('★ «Marcar revisado» usa un FieldPath por producto (un código con punto no rompe la ruta)', u && JSON.stringify(u.a[0].segmentos) === '["muestreo","revisados","X.1"]' && typeof u.a[1] === 'number', JSON.stringify(u && u.a));
  await p.click('[data-fvs-accion="mu-quitar"][data-fvs-pid="X.1"]'); await p.waitForTimeout(150);
  u = await ultimo(p);
  chk('Quitar: arrayRemove y borra su marca de revisado', u && u.a[0] === 'muestreo.ids' && u.a[1].op === 'remove' && u.a[1].v[0] === 'X.1' && u.a[3].op === 'delete', JSON.stringify(u && u.a));
  // La insignia «Editable» abre su explicación POR ENCIMA del buscador fijo
  await p.click('#fvsTab-comparativo'); await p.waitForTimeout(150);
  await p.click('.fvs-badges details summary'); await p.waitForTimeout(150);
  const tip = await p.evaluate(() => { const t = document.querySelector('.fvs-badges details[open] .fvs-tip'); const q = t.getBoundingClientRect(); const s = document.querySelector('.sbx').getBoundingClientRect();
    const x = q.left + q.width / 2, y = Math.min(q.bottom - 6, s.bottom - 4); const el = document.elementFromPoint(x, y);
    return { solapa: q.bottom > s.top, encima: !!el && !!el.closest('.fvs-tip') }; });
  chk('★ La explicación de «Editable» se ve completa por encima del buscador (antes quedaba detrás)', tip.solapa && tip.encima, JSON.stringify(tip));
  chk('Sin errores de JavaScript (administración)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 2 · Lista de v5.45 que quedó en el aparato: se sube una vez ═══
  ({ ctx, p, errs } = await abrir(nav, 'admin', () => localStorage.setItem('inventarioApp_fvsMuestreo', JSON.stringify({ inventoryId: 'INV1001', ids: ['C'], revisados: {} }))));
  await p.waitForTimeout(150);
  const mig = await p.evaluate(() => ({ upd: window.__upd.map(x => JSON.parse(JSON.stringify(x.a))), ls: localStorage.getItem('inventarioApp_fvsMuestreo') }));
  chk('★ La lista que quedó solo en este aparato (v5.45) se sube al inventario y se borra del aparato', mig.upd.some(a => a[0] === 'muestreo.ids' && a[1].op === 'union' && a[1].v.join() === 'C') && mig.ls === null, JSON.stringify(mig));
  await ctx.close();

  // ═══ 3 · Otro dispositivo, USUARIO: ve la lista y vuelve a contar ═══
  ({ ctx, p, errs } = await abrir(nav, 'user'));
  chk('Sin lista: no aparece la tarjeta en Conteo', await p.evaluate(() => !document.querySelector('.mc-tarjeta')));
  await p.evaluate(() => { _inventarioActivo = Object.assign({}, _inventarioActivo, { muestreo: { ids: ['A', 'C'], revisados: { A: Date.now() } } }); renderTab(); });   // lo que entrega la escucha del inventario
  await p.waitForTimeout(150);
  chk('★ Lo que agregó administración aparece en el teléfono del usuario: «Lista de reconteo · 2 productos»', await p.evaluate(() => { const t = document.querySelector('.mc-tarjeta'); return !!t && /Lista de reconteo/.test(t.innerText) && /2 productos/.test(t.innerText); }));
  await p.click('.mc-tarjeta'); await p.waitForTimeout(200);
  const vista = await p.evaluate(() => { const t = document.getElementById('tabContent').innerText;
    return { items: Array.from(document.querySelectorAll('.fvs-mu__item .fvs-mu__nom')).map(x => x.textContent), tit: document.querySelector('.pg-cab__tit').textContent,
             ciego: !/Sistema|Físico|Neto|\$/.test(t), propio: document.querySelector('[data-mc-pid="A"][data-mc-area="almacen"] .fvs-t__val').textContent,
             revisado: /Revisado/.test(document.querySelector('.fvs-mu__item').innerText), adminCtl: document.querySelectorAll('[data-fvs-accion="mu-quitar"], [data-fvs-accion="mu-revisado"]').length,
             volver: !!document.querySelector('.pg-cab .mc-cab__volver') }; });
  chk('★ La lista muestra los 2 productos con su encabezado y Volver', vista.tit === 'Lista de reconteo' && vista.items.join('|') === 'TEQUILA FALTANTE|VODKA SIN CONTAR' && vista.volver, JSON.stringify(vista));
  chk('★ Conteo ciego: el usuario ve SOLO su conteo (5, no el 6 consolidado) y nada de Sistema/Físico/dinero', vista.ciego && vista.propio === '5', JSON.stringify(vista));
  chk('Ve qué revisó administración, pero sin poder modificar la lista', vista.revisado && vista.adminCtl === 0, JSON.stringify(vista));
  await p.click('[data-mc-pid="C"][data-mc-area="barra1"]'); await p.waitForTimeout(250);
  const modal = await p.evaluate(() => ({ abierto: !document.getElementById('inventarioModal').classList.contains('hidden'), txt: document.getElementById('inventarioModal').innerText }));
  chk('★ Tocar un área abre el modal de conteo de siempre, marcado «Reconteo»', modal.abierto && /Reconteo/.test(modal.txt), modal.txt.slice(0, 160));
  await p.fill('#inv_cantidadTotal', '4,5'); await p.evaluate(() => saveInventarioModal()); await p.waitForTimeout(250);
  const g = await p.evaluate(() => ({ reg: myAuditoriaConteo.C && myAuditoriaConteo.C.barra1, esp: window.__esp, val: document.querySelector('[data-mc-pid="C"][data-mc-area="barra1"] .fvs-t__val').textContent }));
  chk('★ Se guarda como SU conteo (4.5, marcado _muestreo) y se sincroniza por la vía de siempre', g.reg && g.reg.enteras === 4.5 && g.reg._muestreo === true && g.esp.sync === 1 && g.esp.guardar >= 1, JSON.stringify(g));
  chk('La tarjeta del área muestra lo recontado', g.val === '4.5', g.val);
  const fuera = await p.evaluate(() => { muestreoAplicarConteoUsuario('X.1', 'almacen', 9, []); return !myAuditoriaConteo['X.1']; });
  chk('★ Un producto que NO está en la lista no se puede guardar por esta vía', fuera);
  await p.evaluate(() => { _inventarioActivo = Object.assign({}, _inventarioActivo, { estado: 'CERRADO' }); renderTab(); }); await p.waitForTimeout(150);
  chk('Con el inventario cerrado la lista desaparece y no se puede recontar', await p.evaluate(() => { muestreoAplicarConteoUsuario('A', 'almacen', 9, []); return myAuditoriaConteo.A.almacen.enteras === 5 && _muestreoConteoIds().length === 0; }));
  chk('Sin errores de JavaScript (usuario)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 4 · Volver a la app: el autoguardado no corre al desbloquear ═══
  ({ ctx, p, errs } = await abrir(nav, 'user'));
  const vis = await p.evaluate(async () => {
    let estado = 'visible'; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => estado });
    window.__esp.guardar = 0;
    estado = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
    const alOcultar = window.__esp.guardar;
    estado = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 300));
    return { alOcultar, alVolver: window.__esp.guardar - alOcultar, diag: typeof diagnosticoReanudarHtml === 'function' && /Rendimiento al volver a la app/.test(diagnosticoReanudarHtml()) };
  });
  chk('★ Guarda al pasar a segundo plano y NO al volver (nada pesado justo al desbloquear)', vis.alOcultar === 1 && vis.alVolver === 0, JSON.stringify(vis));
  chk('Administración tiene la tarjeta «Rendimiento al volver a la app» (diagnóstico de este aparato)', vis.diag);
  chk('Sin errores de JavaScript (volver a la app)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  await nav.close();
  const w = Math.max(...C.map(c => c.n.length));
  console.log('\n  ── v5.46 · Muestreo compartido, insignia sobre el buscador y volver a la app ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
  const fallos = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
