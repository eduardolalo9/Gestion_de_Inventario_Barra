// RECONTEO — prueba en Chromium real contra la app completa.
//
// Firestore se sustituye por un doble mínimo EN MEMORIA solo para la colección
// de reconteos y syncMyAuditoriaToFirestore se instrumenta; la escritura real
// contra reglas reales está en prueba-reconteo-integracion.js. Aquí se prueba
// la PANTALLA: buscador para agregar, tarjetas con los almacenes y el total,
// tocar un almacén abre el modal de conteo real precargado, corregir, finalizar,
// histórico en tarjeta, detalle y reabrir. Todo con el código real sin mockear.
//
// NOTA — esta caja no tiene salida a internet (el CDN de Tailwind queda
// bloqueado), así que los clics se disparan con el evento real sobre el
// elemento en vez de por coordenadas.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const PUERTO = process.env.PUERTO || '8080';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
    try { localStorage.removeItem('inventarioApp_reconteoBorrador'); } catch (_) {}
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
  chk('La página carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  chk('El módulo de reconteo está cargado', await p.evaluate(() =>
      typeof reconteoIniciar === 'function' && typeof _hayReconteoAbierto === 'function' && typeof renderReconteo === 'function'), '');

  const clic = (sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('no existe ' + s); el.click(); }, sel);
  const escribir = (sel, texto) => p.evaluate(({ sel, texto }) => {
    const el = document.querySelector(sel); el.focus(); el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of texto) { el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, { sel, texto });

  // ── Sesión admin + inventario abierto + doble de Firestore ──────────────
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'jefe'; currentUserRole = 'admin';
    _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    const P = [
      { id: 'GOL1', name: 'GOLOS', unit: 'KGS', group: 'Botanas' },
      { id: 'RON1', name: 'RON X', unit: 'PZA', group: 'Ron', capacidadMl: 750, pesoBotellaLlenaOz: 35, conteoOzHabilitado: true },
      { id: 'XSS1', name: '<img src=x onerror="window.__xss=1">', unit: 'PZA', group: 'Pruebas' }
    ];
    for (let i = 0; i < 60; i++) P.push({ id: 'F' + i, name: 'RELLENO ' + i, unit: 'PZA', group: 'Otros' });
    products = P; cart = []; orders = []; inventories = [];
    _auditoriaSessionId = 'inv-1';
    _inventarioActivo = { estado: 'SINCRONIZADO', numero: 101, fechaCreacion: Date.now(), creadoPorNombre: 'Jefe', creadoPorRol: 'ADMIN' };
    auditoriaConteo = {
      GOL1: { almacen: { enteras: 0.85, abiertas: [] }, barra1: { enteras: 0.2, abiertas: [] } },
      RON1: { barra1: { enteras: 2, abiertas: [20] } }
    };
    myAuditoriaConteo = {};
    auditCurrentUser = { userId: 'jefe', userName: 'Eduardo' };
    // Doble en memoria de Firestore (solo lo que usa el reconteo)
    window.__nube = {};
    let n = 0;
    function col() {
      const filtros = [];
      const api = {
        doc(id) { const _id = id || ('auto' + (++n)); return {
          id: _id,
          set(d) { window.__nube[_id] = JSON.parse(JSON.stringify(d)); return Promise.resolve(); },
          get() { const d = window.__nube[_id]; return Promise.resolve({ id: _id, exists: !!d, data: () => JSON.parse(JSON.stringify(d)) }); }
        }; },
        where(c, op, v) { filtros.push([c, v]); return api; },
        orderBy() { return api; }, limit() { return api; },
        get() {
          const docs = Object.keys(window.__nube).filter(id => filtros.every(f => window.__nube[id][f[0]] === f[1]))
            .map(id => ({ id, data: () => JSON.parse(JSON.stringify(window.__nube[id])) }));
          return Promise.resolve({ forEach: (fn) => docs.forEach(fn), docs });
        }
      };
      return api;
    }
    _db = { collection: () => ({ doc: () => ({ collection: () => col() }) }) };
    window.__sync = 0;
    window.syncMyAuditoriaToFirestore = async function() { window.__sync++; _auditSyncPending = false; };
    window.__avisos = [];
    const sn = window.showNotification;
    window.showNotification = function(t) { window.__avisos.push(String(t)); return sn.apply(this, arguments); };
    activeTab = 'inventario'; auditoriaView = 'selection'; renderTab();
  });

  chk('El encabezado del inventario ofrece "Reconteo" y "Reconteos" al admin',
      await p.evaluate(() => !!document.querySelector('[data-rc-accion="iniciar"]') && !!document.querySelector('[data-rc-accion="historial"]')), '');

  await clic('[data-rc-accion="iniciar"]');
  await p.waitForTimeout(150);
  const pantalla = await p.evaluate(() => ({
    vista: auditoriaView,
    nombre: (document.getElementById('rc-nombre') || {}).value,
    buscador: !!document.getElementById('sbx-input-reconteo'),
    vacio: !!document.querySelector('#rc-lista .rc-vacio')
  }));
  chk('Se abre la ventana de reconteo con el nombre de quien reconta ya escrito',
      pantalla.vista === 'reconteo' && pantalla.nombre === 'Eduardo' && pantalla.buscador && pantalla.vacio, JSON.stringify(pantalla));

  // ── Buscar y agregar ─────────────────────────────────────────────────────
  await p.click('#sbx-input-reconteo');
  await p.keyboard.type('golo', { delay: 30 });
  await p.waitForTimeout(400);
  chk('El buscador encuentra el producto y ofrece "+ Agregar"',
      await p.evaluate(() => /GOLOS/.test(document.getElementById('sbx-res-reconteo').innerText) &&
                             !!document.querySelector('#sbx-res-reconteo [data-rc-accion="agregar"][data-rc-pid="GOL1"]')), '');
  await clic('#sbx-res-reconteo [data-rc-accion="agregar"][data-rc-pid="GOL1"]');
  await p.waitForTimeout(150);
  const tarjeta = await p.evaluate(() => {
    const c = document.querySelector('#rc-lista .rc-card');
    return c ? { areas: [...c.querySelectorAll('.rc-area')].map(a => a.innerText.replace(/\s+/g, ' ').trim()),
                 total: c.querySelector('.rc-card__total').innerText, buscador: document.getElementById('sbx-input-reconteo').value } : null;
  });
  chk('La tarjeta muestra los 3 almacenes con lo contado y el total (0.85 + 0.2 + 0 = 1.05)',
      tarjeta && tarjeta.areas.length === 3 && / 0\.85 KGS$/.test(tarjeta.areas[0]) && / 0\.2 KGS$/.test(tarjeta.areas[1]) &&
      / 0 sin contar$/.test(tarjeta.areas[2]) && /1\.05/.test(tarjeta.total), JSON.stringify(tarjeta));
  chk('Tras agregar, el buscador queda limpio para el siguiente producto', tarjeta && tarjeta.buscador === '', '');

  // ── Tocar un almacén: modal real precargado con ESE almacén ─────────────
  await clic('#rc-lista [data-rc-accion="editar"][data-rc-pid="GOL1"][data-rc-area="almacen"]');
  await p.waitForTimeout(100);
  const modal = await p.evaluate(() => ({
    abierto: !document.getElementById('inventarioModal').classList.contains('hidden'),
    valor: document.getElementById('inv_cantidadTotal').value,
    sub: document.getElementById('inventarioModalSubtitle').textContent
  }));
  chk('Tocar "Almacén" abre el modal de conteo con lo contado ahí (0.85) y marca "Reconteo"',
      modal.abierto && modal.valor === '0.85' && /Reconteo/.test(modal.sub), JSON.stringify(modal));

  await escribir('#inv_cantidadTotal', '0,5');
  await p.evaluate(() => saveInventarioModal());
  await p.waitForTimeout(150);
  const corr = await p.evaluate(() => {
    const c = document.querySelector('#rc-lista .rc-card');
    return { area0: c.querySelectorAll('.rc-area')[0].innerText.replace(/\s+/g, ' '), total: c.querySelector('.rc-card__total').innerText,
             pie: document.querySelector('.rc-pie__resumen').innerText, oficial: JSON.stringify(myAuditoriaConteo),
             cerrado: document.getElementById('inventarioModal').classList.contains('hidden') };
  });
  chk('La corrección se ve como 0.85 → 0.5 y el total 1.05 → 0.7 (con coma decimal también)',
      /0\.85 → 0\.5/.test(corr.area0) && /1\.05 → 0\.7/.test(corr.total) && corr.cerrado, JSON.stringify(corr));
  chk('Solo queda ANOTADA: el conteo oficial no cambia hasta finalizar', corr.oficial === '{}' && /1 correcci/.test(corr.pie), corr.oficial);

  // ── Agregar con el teclado (↓ Enter) y corregir una botella ─────────────
  await p.click('#sbx-input-reconteo');
  await p.keyboard.type('ron x', { delay: 30 });
  await p.waitForTimeout(400);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  chk('Con ↓ y Enter también se agrega (queda arriba de la lista)',
      await p.evaluate(() => document.querySelector('#rc-lista .rc-card .rc-card__nombre').textContent === 'RON X'), '');
  await clic('#rc-lista [data-rc-accion="editar"][data-rc-pid="RON1"][data-rc-area="barra1"]');
  await p.waitForTimeout(100);
  const botella = await p.evaluate(() => ({ ent: document.getElementById('inv_enteras').value,
    ab: (document.getElementById('inv_abierta_0') || {}).value,
    bloque: document.getElementById('inv_bloqueBotella').style.display }));
  chk('En un producto de botella el modal abre en modo botella con sus enteras y abiertas',
      botella.ent === '2' && botella.ab === '20' && botella.bloque === '', JSON.stringify(botella));
  await escribir('#inv_enteras', '3');
  await p.evaluate(() => saveInventarioModal());
  await p.waitForTimeout(150);

  // ── Nombre obligatorio ───────────────────────────────────────────────────
  await escribir('#rc-nombre', '');
  await clic('[data-rc-accion="finalizar"]');
  await p.waitForTimeout(100);
  chk('Sin nombre de quien reconta no se puede finalizar',
      await p.evaluate(() => window.__avisos.some(t => /nombre de quien reconta/.test(t)) && !document.getElementById('_confirmOverlay')), '');
  await escribir('#rc-nombre', 'Luis Pérez');

  // ── Cerrar el inventario está bloqueado mientras el reconteo esté abierto
  await p.evaluate(async () => { window.__avisos = []; await cerrarInventarioFisico(); });
  chk('★ Con el reconteo abierto, "Cerrar inventario" se bloquea con aviso',
      await p.evaluate(() => window.__avisos.some(t => /reconteo abierto/.test(t)) && !document.getElementById('_confirmOverlay')), '');

  // ── Finalizar ────────────────────────────────────────────────────────────
  await clic('[data-rc-accion="finalizar"]');
  await p.waitForTimeout(100);
  chk('Finalizar pide confirmación con el resumen', await p.evaluate(() =>
      /2 correcciones en 2 productos/.test((document.getElementById('_confirmOverlay') || {}).innerText || '')), '');
  await clic('#_cfmOk');
  await p.waitForTimeout(300);
  const fin = await p.evaluate(() => ({
    vista: auditoriaView, sync: window.__sync,
    gol: myAuditoriaConteo.GOL1 && myAuditoriaConteo.GOL1.almacen,
    ron: myAuditoriaConteo.RON1 && myAuditoriaConteo.RON1.barra1,
    texto: document.getElementById('content') ? document.getElementById('content').innerText : document.body.innerText,
    borrador: localStorage.getItem('inventarioApp_reconteoBorrador')
  }));
  chk('★ Al finalizar, las correcciones se aplican solas al conteo oficial y se sincronizan',
      fin.gol && fin.gol.enteras === 0.5 && fin.ron && fin.ron.enteras === 3 && fin.ron.abiertas[0] === 20 && fin.sync === 1,
      JSON.stringify({ gol: fin.gol, ron: fin.ron, sync: fin.sync }));
  chk('Queda el detalle del reconteo: finalizado, quién recontó y opción de reabrir',
      fin.vista === 'reconteo_detalle' && /Finalizado/.test(fin.texto) && /Luis Pérez/.test(fin.texto) &&
      /Reabrir reconteo/.test(fin.texto) && fin.borrador === null, fin.vista);

  // ── Histórico ────────────────────────────────────────────────────────────
  await clic('[data-rc-accion="historial"]');
  await p.waitForTimeout(300);
  const hist = await p.evaluate(() => [...document.querySelectorAll('.rc-hist')].map(h => h.innerText.replace(/\s+/g, ' ')));
  chk('El histórico muestra la tarjeta con fecha, quién recontó y correcciones',
      hist.length === 1 && /Inventario #101/.test(hist[0]) && /Recontó: Luis Pérez/.test(hist[0]) &&
      /\d{1,2}\/\d{1,2}\/\d{4}/.test(hist[0]) && /2 productos · 2 correcciones/.test(hist[0]), JSON.stringify(hist));
  await clic('.rc-hist');
  await p.waitForTimeout(200);
  chk('Al tocar el registro se ven los productos recontados con antes → después',
      await p.evaluate(() => document.querySelectorAll('.rc-card').length === 2 &&
        /0\.85 → 0\.5/.test(document.querySelector('.rc-lista').innerText)), '');

  // ── Reabrir: segunda ronda ───────────────────────────────────────────────
  await clic('[data-rc-accion="reabrir"]');
  await p.waitForTimeout(300);
  const re = await p.evaluate(() => ({ vista: auditoriaView, txt: document.querySelector('.rc-titulo').innerText,
    area0: document.querySelector('#rc-lista .rc-card:last-child .rc-area').innerText.replace(/\s+/g, ' ') }));
  chk('Reabrir abre una segunda ronda con los mismos productos',
      re.vista === 'reconteo' && /Ronda 2/.test(re.txt), JSON.stringify(re));

  // ── XSS: un nombre de producto hostil no ejecuta nada ───────────────────
  await p.click('#sbx-input-reconteo');
  await p.keyboard.type('img', { delay: 30 });
  await p.waitForTimeout(400);
  await clic('#sbx-res-reconteo [data-rc-accion="agregar"][data-rc-pid="XSS1"]');
  await p.waitForTimeout(200);
  chk('Un nombre de producto con HTML no se ejecuta ni rompe la tarjeta',
      await p.evaluate(() => window.__xss === undefined && !document.querySelector('#rc-lista img') &&
        /<img/.test(document.querySelector('#rc-lista .rc-card .rc-card__nombre').textContent)), '');

  // ── Un usuario que no es admin no ve ni entra ───────────────────────────
  await p.evaluate(() => { _authzState.permissions = new Set(['inventory.count']); auditoriaView = 'reconteo'; renderTab(); });
  chk('Un bartender no ve los botones y no puede entrar a la ventana de reconteo',
      await p.evaluate(() => !document.querySelector('[data-rc-accion="iniciar"]') && !document.getElementById('rc-nombre') && auditoriaView === 'selection'), '');

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(c => c.n.length));
  console.log('\n  ── RECONTEO · ventana de reconteo (navegador real) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
  const fallos = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
