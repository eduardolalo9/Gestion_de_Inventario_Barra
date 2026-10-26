// v5.34 — Mi Perfil, probado en Chromium contra la app REAL.
//   npm run test:v534nav      (requiere el servidor local en PUERTO, 8080; lo levanta todas-navegador.js)
// Nada toca Firebase: _db no existe en la prueba. Se espían saveToLocalStorage,
// syncToCloud y localStorage.setItem para demostrar que el overlay NO escribe.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const URL_APP = 'http://127.0.0.1:' + PUERTO + '/index.html';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  p.on('dialog', d => d.dismiss());

  const entrar = async () => {
    await p.goto(URL_APP, { waitUntil: 'load' });
    await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
    await p.waitForTimeout(700);
    await p.evaluate(() => {
      document.getElementById('authLoadingScreen').classList.add('auth-hidden');
      document.getElementById('loginScreen').classList.add('auth-hidden');
      document.getElementById('appWrapper').classList.add('auth-visible');
    });
  };
  await entrar();
  await p.evaluate(() => {
    currentUserUid = 'u1'; currentUserRole = 'admin';
    _authzState.loaded = true; _authzState.roleId = 'ADMIN'; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    _lastUserData = { uid: 'u1', displayName: 'Eduardo Prueba', email: 'eduardo@bar.mx', role: 'admin', status: 'activo' };
    products = [{ id: '1', name: 'A', unit: 'PZA', group: 'G', stockByArea: {} }, { id: '2', name: 'B', unit: 'PZA', group: 'G', stockByArea: {} }, { id: '3', name: 'C', unit: 'Litros', group: 'G', stockByArea: {} }];
    activeTab = 'productos'; renderTab();
    // espías: el overlay no debe guardar, sincronizar ni cambiar de pestaña
    window.__esp = { guardar: 0, sync: 0, ls: 0, tab: 0 };
    const sg = window.saveToLocalStorage; window.saveToLocalStorage = function () { window.__esp.guardar++; return sg.apply(this, arguments); };
    const ss = window.syncToCloud;        window.syncToCloud        = function () { window.__esp.sync++;    return ss && ss.apply(this, arguments); };
    const st = window.switchTab;          window.switchTab          = function () { window.__esp.tab++;     return st.apply(this, arguments); };
    const si = Storage.prototype.setItem; Storage.prototype.setItem = function () { window.__esp.ls++;     return si.apply(this, arguments); };
  });
  await p.waitForTimeout(200);
  const visible = () => p.evaluate(() => !document.getElementById('perfilOverlay').classList.contains('hidden'));
  const esp = () => p.evaluate(() => JSON.stringify(window.__esp));
  const cero = JSON.stringify({ guardar: 0, sync: 0, ls: 0, tab: 0 });

  // 1 · Botón de cabecera
  const caja = await p.evaluate(() => { const r = document.getElementById('perfilBtn').getBoundingClientRect(); return { w: r.width, h: r.height, vis: r.width > 0 && r.height > 0 }; });
  chk('El botón de persona se ve en la cabecera y mide ≥ 44 px', caja.vis && caja.w >= 44 && caja.h >= 44, JSON.stringify(caja));
  await p.tap('#perfilBtn');
  await p.waitForTimeout(250);
  chk('★ Tocar el botón abre el overlay', await visible());
  const e1 = await p.evaluate(() => ({ tab: activeTab, ls: localStorage.getItem('inventarioApp_activeTab'), nom: document.getElementById('perfilNombreVisible').value, dis: document.getElementById('perfilNombreVisible').disabled, foco: document.activeElement && document.activeElement.id }));
  chk('★ Abrir NO cambia activeTab ni lo guarda (sigue en Productos)', e1.tab === 'productos' && e1.ls !== 'perfil', JSON.stringify(e1));
  chk('★ Muestra usuarios/{uid}.displayName en un campo deshabilitado', e1.nom === 'Eduardo Prueba' && e1.dis === true, JSON.stringify(e1));
  chk('El foco pasa al botón cerrar', e1.foco === 'perfilCerrarBtn', e1.foco);
  chk('★ Abrir no guarda, no sincroniza, no escribe en localStorage ni llama a switchTab', (await esp()) === cero, await esp());
  const cont = await p.evaluate(() => document.getElementById('perfilCuerpo').textContent);
  chk('Muestra correo, rol Administrador, áreas y unidades (2 productos en PZA, 1 en Litros)', /eduardo@bar\.mx/.test(cont) && /Administrador/.test(cont) && /Almacén/.test(cont) && /PZA2 productos/.test(cont) && /Litros1 producto/.test(cont), cont.slice(0, 300));
  const encaja = await p.evaluate(() => { const h = document.querySelector('.pf-hoja').getBoundingClientRect(); return h.bottom <= innerHeight + 1 && h.width <= innerWidth + 1; });
  chk('La hoja cabe en la pantalla del móvil (390×844)', encaja);

  // 2 · Cerrar: X, Escape, fondo, Atrás
  await p.tap('#perfilCerrarBtn'); await p.waitForTimeout(150);
  chk('Cerrar con la X', !(await visible()));
  chk('Al cerrar, el foco vuelve al botón que lo abrió', await p.evaluate(() => document.activeElement && document.activeElement.id) === 'perfilBtn');
  await p.evaluate(() => abrirMiPerfil()); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  chk('Cerrar con Escape', !(await visible()));
  await p.evaluate(() => abrirMiPerfil()); await p.waitForTimeout(100);
  await p.mouse.click(10, 10); await p.waitForTimeout(150);
  chk('Cerrar con un toque en el fondo', !(await visible()));
  await p.evaluate(() => abrirMiPerfil()); await p.waitForTimeout(100);
  await p.click('.pf-cab__tit'); await p.waitForTimeout(100);
  chk('Un toque DENTRO de la hoja no la cierra', await visible());
  await p.evaluate(() => cerrarMiPerfil());

  // 3 · Atrás de Android
  await p.mouse.click(200, 300); await p.waitForTimeout(200);   // primer toque real: arma la guardia
  await p.evaluate(() => { switchTab('productos'); abrirMiPerfil(); window.__esp.tab = 0; }); await p.waitForTimeout(150);
  await p.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => null); await p.waitForTimeout(300);
  const e3 = await p.evaluate(() => ({ vis: !document.getElementById('perfilOverlay').classList.contains('hidden'), tab: activeTab, url: location.pathname }));
  chk('★ Atrás de Android cierra el perfil y se queda en la pestaña (no sale, no va a Inicio)', !e3.vis && e3.tab === 'productos' && /index\.html/.test(e3.url), JSON.stringify(e3));

  // 4 · Menú «Más»
  await p.evaluate(() => { sbOpen(); }); await p.waitForTimeout(250);
  await p.tap('#sbPerfilBtn'); await p.waitForTimeout(300);
  const e4 = await p.evaluate(() => ({ vis: !document.getElementById('perfilOverlay').classList.contains('hidden'), menu: document.getElementById('sidebar').classList.contains('sb-open'), tab: activeTab }));
  chk('★ «Mi perfil» en Más abre el overlay y cierra el menú', e4.vis && !e4.menu && e4.tab === 'productos', JSON.stringify(e4));
  await p.evaluate(() => cerrarMiPerfil());

  // 5 · Abrir y cerrar no deja rastro en ninguna pestaña
  await p.evaluate(() => { window.__esp = { guardar: 0, sync: 0, ls: 0, tab: 0 }; });
  for (const t of ['inicio', 'productos', 'inventario', 'ajustes']) {
    await p.evaluate((x) => { switchTab(x); }, t); await p.waitForTimeout(120);
    await p.evaluate(() => { abrirMiPerfil(); cerrarMiPerfil(); });
  }
  const e5 = JSON.parse(await esp());
  chk('★ Abrir/cerrar sobre 4 pestañas: cero guardados, cero syncToCloud (las 4 llamadas a switchTab son del propio recorrido)', e5.sync === 0 && e5.tab === 4, JSON.stringify(e5));
  chk('El overlay nunca puso \'perfil\' en TABS ni en localStorage', await p.evaluate(() => TABS_VALIDAS.indexOf('perfil') === -1 && TABS_COMPARTIBLES.indexOf('perfil') === -1 && !Object.keys(localStorage).some(k => /perfil/i.test(localStorage.getItem(k) || '') && /activeTab/.test(k))));

  // 6 · Seguridad: nombre malicioso
  await p.evaluate(() => { _lastUserData.displayName = '<img src=x onerror="window.__xss=1"><script>window.__xss=1<\/script>'; abrirMiPerfil(); });
  await p.waitForTimeout(250);
  const x = await p.evaluate(() => ({ xss: window.__xss === 1, imgs: document.querySelectorAll('#perfilCuerpo img').length, val: document.getElementById('perfilNombreVisible').value }));
  chk('★ Un displayName con HTML se muestra como texto y no ejecuta nada', !x.xss && x.imgs === 0 && /<img/.test(x.val), JSON.stringify(x));
  await p.evaluate(() => { _lastUserData.displayName = 'Eduardo Prueba'; cerrarMiPerfil(); });

  // 7 · Rol sin permisos de áreas
  await p.evaluate(() => { _authzState.permissions = new Set(['inventory.count']); _authzState.roleId = 'BARTENDER'; currentUserRole = 'user'; _lastUserData.role = 'user'; abrirMiPerfil(); });
  await p.waitForTimeout(200);
  const e7 = await p.evaluate(() => ({ admin: /Administrar áreas/.test(document.getElementById('perfilCuerpo').textContent), rol: document.getElementById('perfilCuerpo').textContent }));
  chk('★ Un bartender no ve «Administrar áreas en Ajustes»', !e7.admin, e7.rol.slice(0, 200));
  await p.evaluate(() => { cerrarMiPerfil(); _authzState.permissions = new Set(['*']); _authzState.roleId = 'ADMIN'; currentUserRole = 'admin'; _lastUserData.role = 'admin'; abrirMiPerfil(); });
  await p.waitForTimeout(200);
  await p.evaluate(() => { window.__esp.tab = 0; });
  await p.tap('.pf-btn--sec'); await p.waitForTimeout(300);
  const e8 = await p.evaluate(() => ({ vis: !document.getElementById('perfilOverlay').classList.contains('hidden'), tab: activeTab }));
  chk('El administrador entra a Ajustes por la navegación de siempre y el overlay se cierra', !e8.vis && e8.tab === 'ajustes', JSON.stringify(e8));

  // 8 · Sin datos de cuenta (sin red): no falla
  await p.evaluate(() => { _lastUserData = null; abrirMiPerfil(); });
  await p.waitForTimeout(200);
  const e9 = await p.evaluate(() => document.getElementById('perfilCuerpo').textContent);
  chk('★ Con _lastUserData = null el overlay abre y avisa, sin errores', /Aún no se cargan los datos de tu cuenta/.test(e9));
  await p.evaluate(() => cerrarMiPerfil());

  // 9 · Pantalla de acceso visible → no abre
  await p.evaluate(() => { document.getElementById('loginScreen').classList.remove('auth-hidden'); abrirMiPerfil(); });
  chk('Con la pantalla de acceso visible, abrirMiPerfil no hace nada', !(await visible()));
  await p.evaluate(() => document.getElementById('loginScreen').classList.add('auth-hidden'));

  // 10 · Recargar con el overlay abierto → abre la app normal, sin overlay
  await p.evaluate(() => { _lastUserData = { uid: 'u1', displayName: 'Eduardo Prueba', email: 'eduardo@bar.mx', role: 'admin' }; switchTab('pedidos'); abrirMiPerfil(); });
  await p.waitForTimeout(300);
  await p.reload({ waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(700);
  await p.evaluate(() => { document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible'); });
  const e10 = await p.evaluate(() => ({ vis: !document.getElementById('perfilOverlay').classList.contains('hidden'), tab: activeTab, valida: TABS_VALIDAS.indexOf(activeTab) !== -1, ls: localStorage.getItem('inventarioApp_activeTab') }));
  chk('★ Tras recargar con el overlay abierto, el overlay NO reaparece y la pestaña es válida (nunca \'perfil\')', !e10.vis && e10.valida && e10.tab !== 'perfil' && e10.ls !== 'perfil', JSON.stringify(e10));

  chk('Sin errores de JavaScript en toda la sesión', errs.length === 0, errs.join(' | '));
  await nav.close();
  console.log('\n  ── v5.34 · Mi Perfil (navegador) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + (c.d || ''))));
  const f = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - f) + ' pasaron · ' + f + ' fallaron\n');
  process.exit(f ? 1 : 0);
})();
