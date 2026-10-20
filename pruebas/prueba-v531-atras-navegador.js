// v5.31 — Botón Atrás de Android, probado en Chromium contra la app real con
// el Atrás del NAVEGADOR (page.goBack), que es lo que dispara el botón o el
// gesto Atrás de Android en la PWA y en Chrome.
//   npm run test:atrasnav      (requiere el servidor local en PUERTO, 8080)
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const PUERTO = process.env.PUERTO || '8080';
const URL_APP = 'http://127.0.0.1:' + PUERTO + '/index.html';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  p.on('dialog', d => d.dismiss());
  await p.goto('about:blank');                       // una página ANTES de la app: así "salir" se puede medir
  await p.goto(URL_APP, { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
  });
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.roleId = 'ADMIN';
    _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = [
      { id: '1180001', name: 'TEQUILA DON JULIO 70 700 ML', unit: 'PZA', group: 'TEQUILA', capacidadMl: 700, precio: 820, stockMinimo: 12, conversion: 1, stockByArea: { almacen: 2 } },
      { id: '2210010', name: 'CERVEZA CORONA 355 ML', unit: 'PZA', group: 'CERVEZA', precio: 22, stockMinimo: 60, conversion: 1, stockByArea: { almacen: 48 } }];
    _auditoriaSessionId = 'S7'; _inventarioActivoCarga = 'ok';
    _inventarioActivo = { numero: 7, estado: 'SINCRONIZADO', fechaCreacion: Date.now(), creadoPorNombre: 'Eduardo', creadoPorRol: 'ADMIN', fechaRecuento: '2026-10-25', semanaId: '2026-10-19', warehousesSnapshot: ['almacen', 'barra1', 'barra2'] };
    auditoriaStatus = { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' };
    auditoriaConteo = { '1180001': { almacen: { enteras: 3, abiertas: [0.5] } } };
    myAuditoriaConteo = JSON.parse(JSON.stringify(auditoriaConteo));
    activeTab = 'inicio'; renderTab();
  });
  const atras = async () => { await p.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => null); await p.waitForTimeout(250); };
  const estado = () => p.evaluate(() => ({ tab: activeTab, vista: typeof auditoriaView !== 'undefined' ? auditoriaView : null, st: history.state, largo: history.length, url: location.href }));

  // Primer toque real (la guardia se pone con la primera interacción).
  await p.tap('#bottomTabBar [data-tab="pedidos"], #bottomTabBar button:nth-child(3)').catch(async () => { await p.mouse.click(200, 400); });
  await p.waitForTimeout(250);
  let e = await estado();
  chk('Tras el primer toque hay UNA guardia encima de la base', e.st && e.st.bi === 'guardia', JSON.stringify(e));
  const largo0 = e.largo;

  // 1 · Pestaña → Inicio
  await p.evaluate(() => switchTab('pedidos')); await p.waitForTimeout(150);
  await atras(); e = await estado();
  chk('★ Desde otra pestaña, Atrás vuelve a Inicio sin salir de la app', e.tab === 'inicio' && /index\.html/.test(e.url), JSON.stringify(e));
  chk('La guardia se repone (el siguiente Atrás también se atiende)', e.st && e.st.bi === 'guardia', JSON.stringify(e.st));

  // 2 · Modal de producto → se cierra con su función de siempre
  await p.evaluate(() => { switchTab('productos'); openProductModal(); }); await p.waitForTimeout(150);
  await atras();
  let r = await p.evaluate(() => ({ modal: !document.getElementById('productModal').classList.contains('hidden'), tab: activeTab, prods: products.length }));
  chk('★ Con un modal abierto, Atrás cierra el modal y se queda en la pantalla', !r.modal && r.tab === 'productos' && r.prods === 2, JSON.stringify(r));

  // 3 · Confirmación (Eliminar producto) → Cancelar; el producto NO se borra
  await p.evaluate(() => { deleteProduct('2210010'); }); await p.waitForTimeout(150);
  const hayConfirm = await p.evaluate(() => !!document.getElementById('_cfmCancel'));
  await atras();
  r = await p.evaluate(() => ({ confirm: !!document.getElementById('_cfmCancel'), prods: products.map(x => x.id) }));
  chk('★ Con la confirmación de Eliminar abierta, Atrás cancela y el producto sigue', hayConfirm && !r.confirm && r.prods.includes('2210010'), JSON.stringify({ hayConfirm, ...r }));

  // 4 · Menú lateral
  await p.evaluate(() => { switchTab('inicio'); sbOpen(); }); await p.waitForTimeout(150);
  await atras();
  r = await p.evaluate(() => ({ abierto: document.getElementById('sidebar').classList.contains('sb-open'), tab: activeTab }));
  chk('Con el menú abierto, Atrás lo cierra', !r.abierto && r.tab === 'inicio', JSON.stringify(r));

  // 5 · Conteo: entrar a un área, abrir la captura, Atrás dos veces → sin perder datos
  const antes = await p.evaluate(() => JSON.stringify(auditoriaConteo));
  await p.evaluate(() => { switchTab('inventario'); auditoriaView = 'selection'; renderTab(); auditoriaEntrarArea('almacen'); }); await p.waitForTimeout(250);
  const enArea = await p.evaluate(() => ({ vista: auditoriaView, volver: !!document.querySelector('#tabContent .audit-back-btn') }));
  await p.evaluate(() => { if (typeof openInventarioModal === 'function') openInventarioModal('1180001'); }); await p.waitForTimeout(200);
  const capturaAbierta = await p.evaluate(() => !document.getElementById('inventarioModal').classList.contains('hidden'));
  await atras();
  r = await p.evaluate(() => ({ captura: !document.getElementById('inventarioModal').classList.contains('hidden'), vista: auditoriaView }));
  chk('★ En el conteo, Atrás cierra primero la captura y se queda en el área', capturaAbierta && !r.captura && r.vista === enArea.vista, JSON.stringify({ enArea, capturaAbierta, r }));
  await atras();
  r = await p.evaluate(() => ({ vista: auditoriaView, tab: activeTab, conteo: JSON.stringify(auditoriaConteo) }));
  chk('★ Segundo Atrás: sale del área con su botón Volver (vuelve a Áreas)', r.vista === 'selection' && r.tab === 'inventario', JSON.stringify(r));
  chk('★ El conteo capturado sigue intacto', r.conteo === antes, r.conteo + ' vs ' + antes);

  // 6 · Pantalla secundaria con botón Volver (Pedido sugerido) → su Volver
  await p.evaluate(() => switchTab('pedido_sugerido')); await p.waitForTimeout(150);
  await atras(); e = await estado();
  chk('Pantalla secundaria: Atrás pulsa su botón Volver (Pedido sugerido → Inicio)', e.tab === 'inicio', JSON.stringify(e));

  // 7 · Importación sin confirmar: no se descarta
  r = await p.evaluate(() => { const prev = comprasImportView; comprasImportView = 'vista_previa'; activeTab = 'compras'; const res = navegacionAtras(); const t = activeTab; comprasImportView = prev; activeTab = 'inicio'; renderTab(); return { res, t }; });
  chk('★ Con una importación en revisión, Atrás NO la descarta (se queda y avisa)', r.res === 'importacion' && r.t === 'compras', JSON.stringify(r));

  // 8 · El historial no crece
  e = await estado();
  chk('★ El historial no crece al navegar (sin ciclos ni entradas de más)', e.largo === largo0, largo0 + ' → ' + e.largo);

  // 9 · Inicio: primer Atrás se queda; el segundo (en 2 s) sale
  await p.evaluate(() => { activeTab = 'inicio'; renderTab(); });
  await atras(); e = await estado();
  await p.waitForTimeout(1100);   // el toast de siempre puede tardar 1 s si acaba de mostrarse otro
  const aviso = await p.evaluate(() => { const t = document.getElementById('toastMessage'); return t ? t.textContent : ''; });
  chk('★ En Inicio, el primer Atrás NO sale: se queda y avisa "Pulsa Atrás otra vez para salir"', /index\.html/.test(e.url) && e.tab === 'inicio' && /Pulsa Atrás otra vez para salir/.test(aviso), JSON.stringify(e));
  await p.goBack({ waitUntil: 'load', timeout: 5000 }).catch(() => null); await p.waitForTimeout(300);
  chk('★ El segundo Atrás seguido (antes de 2 s del primero) sí sale de la app', !/index\.html/.test(p.url()), p.url());

  // 10 · Pasada la ventana, Atrás en Inicio vuelve a quedarse
  await p.goto(URL_APP, { waitUntil: 'load' }); await p.waitForTimeout(600);
  await p.evaluate(() => { document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible'); activeTab = 'inicio'; renderTab(); });
  await p.mouse.click(200, 300); await p.waitForTimeout(150);
  await atras(); await p.waitForTimeout(2300);
  await atras(); e = await estado();
  chk('Pasados 2 s del aviso, un Atrás vuelve a avisar en lugar de salir', /index\.html/.test(e.url), e.url);
  const unoSolo = await p.evaluate(() => { iniciarNavegacionAtras(); iniciarNavegacionAtras(); return true; });
  chk('Iniciar dos veces no duplica listeners (protegido por bandera)', unoSolo && /if \(_navAtras\.iniciado\) return;/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'js/98-navegacion-atras.js'), 'utf8')));

  chk('Sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  await nav.close();
  console.log('\n  ── v5.31 · Botón Atrás de Android (navegador) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + (c.d || ''))));
  const f = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - f) + ' pasaron · ' + f + ' fallaron\n');
  process.exit(f ? 1 : 0);
})();
