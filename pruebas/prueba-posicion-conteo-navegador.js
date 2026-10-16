// v5.17 — Conteo por área: la pantalla no se mueve bajo los dedos.
// Chromium real a 390×844 contra la app. Antes del arreglo esta misma prueba
// medía: lista en 1500 px → modal → guardar → 0 px (vuelta al primer producto),
// y el riel de grupos regresaba a 0 en cada selección.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const GRUPOS = ['TEQUILA', 'RON', 'WHISKY', 'VODKA', 'GINEBRA', 'MEZCAL', 'CERVEZA', 'VINO', 'LICOR', 'ABARROTES'];

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  await p.evaluate((G) => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
    products = [];
    for (let i = 0; i < 120; i++) products.push({ id: 'P' + i, name: G[i % 10] + ' MARCA ' + String(i).padStart(3, '0'), group: G[i % 10], unit: 'PZA', conversion: 1, stockByArea: { almacen: 1 } });
    myAuditoriaConteo = {}; auditoriaConteo = {}; allUsersAuditoria = {}; selectedGroup = 'Todos';
    window.__ir = (area) => { isAuditoriaMode = true; auditoriaView = 'counting'; auditoriaAreaActiva = area; activeTab = 'inventario'; renderTab(); };
    window.__y = () => window.scrollY;
    window.__irA = (y) => { const h = document.documentElement; const pr = h.style.scrollBehavior; h.style.scrollBehavior = 'auto'; window.scrollTo(0, y); h.style.scrollBehavior = pr; };
  }, GRUPOS);

  // Captura real: abre la tarjeta visible, escribe y guarda con el botón del modal.
  async function capturar(valor, modo) {
    const r = await p.evaluate(() => {
      const c = [...document.querySelectorAll('.inv-card')].find(c => { const b = c.getBoundingClientRect(); return b.top > 250 && b.bottom < 700; });
      const lt = el => { let y = 0; for (let n = el; n; n = n.offsetParent) y += n.offsetTop || 0; return y - window.scrollY; };
      const top = lt(c); const nombre = c.textContent.trim().slice(0, 30);
      c.click();
      return { top, nombre };
    });
    await p.waitForTimeout(250);
    const dentro = await p.evaluate(() => ({ abierto: document.body.classList.contains('modal-open'), top: document.body.style.top }));
    if (modo === 'cancelar') {
      await p.evaluate(() => closeInventarioModal());
    } else {
      await p.evaluate((v) => {
        const i = document.getElementById('inv_cantidadTotal') || document.querySelector('#inventarioModal input');
        i.value = v; i.dispatchEvent(new Event('input', { bubbles: true }));
        saveInventarioModal();
      }, valor);
    }
    await p.waitForTimeout(400);
    const despues = await p.evaluate((nombre) => {
      const c = [...document.querySelectorAll('.inv-card')].find(c => c.textContent.trim().startsWith(nombre));
      const lt = el => { let y = 0; for (let n = el; n; n = n.offsetParent) y += n.offsetTop || 0; return y - window.scrollY; };
      return { y: window.scrollY, top: c ? lt(c) : null, cerrado: !document.body.classList.contains('modal-open') };
    }, r.nombre);
    return { antes: r, dentro, despues };
  }

  for (const area of ['almacen', 'barra1', 'barra2']) {
    await p.evaluate((a) => { selectedGroup = 'Todos'; __ir(a); }, area);
    await p.waitForTimeout(250);
    await p.evaluate(() => __irA(2600)); await p.waitForTimeout(150);
    const y0 = await p.evaluate(() => __y());
    const r = await capturar('3');
    chk('[' + area + '] ★ después de guardar el conteo la lista se queda donde estaba (no vuelve al primer producto)',
        // La Y puede moverse unos píxeles a propósito: si lo de arriba crece al
        // guardar (barra de dispositivos), se ancla la TARJETA, no el número.
        Math.abs(r.despues.y - y0) <= 60 && y0 > 2000 && r.despues.cerrado, 'antes ' + y0 + ' → después ' + r.despues.y);
    chk('[' + area + '] la tarjeta contada sigue en el mismo lugar de la pantalla',
        r.despues.top !== null && Math.abs(r.despues.top - r.antes.top) <= 2, r.antes.top + ' → ' + r.despues.top + ' (' + r.antes.nombre + ')');
    chk('[' + area + '] con el modal abierto el fondo se queda a la vista donde estaba',
        r.dentro.abierto && r.dentro.top === (-y0) + 'px', JSON.stringify(r.dentro));
  }

  // Cancelar el modal también regresa a la misma ubicación
  await p.evaluate(() => { selectedGroup = 'Todos'; __ir('almacen'); }); await p.waitForTimeout(200);
  await p.evaluate(() => __irA(1800)); await p.waitForTimeout(150);
  const yc = await p.evaluate(() => __y());
  const rc = await capturar(null, 'cancelar');
  chk('Cancelar el modal también deja la lista donde estaba', Math.abs(rc.despues.y - yc) <= 2, yc + ' → ' + rc.despues.y);

  // Un repintado mientras el modal está abierto (llega un conteo de otro dispositivo)
  await p.evaluate(() => __irA(2200)); await p.waitForTimeout(150);
  const yr = await p.evaluate(() => __y());
  const rr = await p.evaluate(async () => {
    const c = [...document.querySelectorAll('.inv-card')].find(c => { const b = c.getBoundingClientRect(); return b.top > 250 && b.bottom < 700; });
    c.click(); await new Promise(r => setTimeout(r, 200));
    renderTab();                                   // repintado en vivo con el modal abierto
    await new Promise(r => setTimeout(r, 100));
    const i = document.getElementById('inv_cantidadTotal') || document.querySelector('#inventarioModal input');
    i.value = '2'; i.dispatchEvent(new Event('input', { bubbles: true })); saveInventarioModal();
    await new Promise(r => setTimeout(r, 400));
    return window.scrollY;
  });
  chk('Aunque la lista se repinte con el modal abierto, al guardar se queda en su sitio', Math.abs(rr - yr) <= 2, yr + ' → ' + rr);

  // ── Grupos ────────────────────────────────────────────────────────────────
  await p.evaluate(() => { selectedGroup = 'Todos'; __ir('barra1'); __irA(0); }); await p.waitForTimeout(200);
  const rail0 = await p.evaluate(() => { const r = document.querySelector('.grp-rail'); r.scrollLeft = 10000; r.dispatchEvent(new Event('scroll')); return r.scrollLeft; });
  await p.waitForTimeout(100);
  await p.evaluate(() => [...document.querySelectorAll('.grp-pill')].find(b => b.textContent.trim() === 'WHISKY').click());
  await p.waitForTimeout(400);
  const g1 = await p.evaluate(() => {
    const r = document.querySelector('.grp-rail'); const a = r.querySelector('.grp-pill--active');
    const rr = r.getBoundingClientRect(), ra = a.getBoundingClientRect();
    return { x: r.scrollLeft, visible: ra.left >= rr.left - 1 && ra.right <= rr.right + 1, activo: a.textContent.trim(),
             cards: document.querySelectorAll('.inv-card').length };
  });
  chk('★ Al elegir un grupo, el riel de grupos NO regresa al inicio', rail0 > 100 && g1.x > 100, rail0 + ' → ' + g1.x);
  chk('★ El grupo elegido queda a la vista en el riel', g1.activo === 'WHISKY' && g1.visible, JSON.stringify(g1));
  chk('La lista muestra solo ese grupo', g1.cards === 12, String(g1.cards));

  // Posición propia de cada grupo
  await p.evaluate(() => [...document.querySelectorAll('.grp-pill')].find(b => b.textContent.trim() === 'Todos').click());
  await p.waitForTimeout(350);
  await p.evaluate(() => __irA(3000)); await p.waitForTimeout(150);
  const yTodos = await p.evaluate(() => __y());
  await p.evaluate(() => [...document.querySelectorAll('.grp-pill')].find(b => b.textContent.trim() === 'RON').click());
  await p.waitForTimeout(400);
  const nuevo = await p.evaluate(() => {
    const w = document.querySelector('.grp-rail-wrap').getBoundingClientRect();
    const head = document.querySelector('.sticky.top-0.z-50').getBoundingClientRect();
    const primera = document.querySelector('.inv-card').getBoundingClientRect();
    return { y: window.scrollY, rielTop: Math.round(w.top), headBottom: Math.round(head.bottom), primeraTop: Math.round(primera.top) };
  });
  chk('★ Un grupo nuevo empieza al inicio de SU lista (no al final de la anterior)',
      nuevo.y < yTodos && nuevo.rielTop >= nuevo.headBottom - 2 && nuevo.rielTop <= nuevo.headBottom + 60 && nuevo.primeraTop < 844, JSON.stringify(nuevo));
  await p.evaluate(() => __irA(700)); await p.waitForTimeout(150);
  const yRon = await p.evaluate(() => __y());
  await p.evaluate(() => [...document.querySelectorAll('.grp-pill')].find(b => b.textContent.trim() === 'Todos').click());
  await p.waitForTimeout(400);
  const yVuelta = await p.evaluate(() => __y());
  chk('★ Volver a un grupo te deja donde ibas en ese grupo (Todos: ' + yTodos + ')', Math.abs(yVuelta - yTodos) <= 2, String(yVuelta));
  await p.evaluate(() => [...document.querySelectorAll('.grp-pill')].find(b => b.textContent.trim() === 'RON').click());
  await p.waitForTimeout(400);
  chk('…y de regreso a RON, donde ibas en RON (' + yRon + ')', Math.abs(await p.evaluate(() => __y()) - yRon) <= 2, String(await p.evaluate(() => __y())));

  // Contar dentro de un grupo tampoco mueve la lista ni el riel
  const railAntes = await p.evaluate(() => document.querySelector('.grp-rail').scrollLeft);
  await p.evaluate(() => __irA(500)); await p.waitForTimeout(150);
  const yg = await p.evaluate(() => __y());
  const rg = await capturar('1');
  const railDespues = await p.evaluate(() => document.querySelector('.grp-rail').scrollLeft);
  chk('Contar dentro de un grupo: la lista y el riel se quedan donde estaban',
      Math.abs(rg.despues.y - yg) <= 2 && Math.abs(railDespues - railAntes) <= 2, 'y ' + yg + '→' + rg.despues.y + ' · riel ' + railAntes + '→' + railDespues);

  // Cada área recuerda lo suyo
  await p.evaluate(() => { selectedGroup = 'Todos'; __ir('barra2'); }); await p.waitForTimeout(250);
  const railB2 = await p.evaluate(() => document.querySelector('.grp-rail').scrollLeft);
  chk('Cada área recuerda su propio riel (barra 2 no hereda el de barra 1)', railB2 < 50, String(railB2));

  // Otro modal (ficha de producto, desde Inicio) también conserva la posición
  await p.evaluate(() => { activeTab = 'inicio'; renderTab(); }); await p.waitForTimeout(300);
  const hayLista = await p.evaluate(() => document.documentElement.scrollHeight > 1500);
  if (hayLista) {
    await p.evaluate(() => __irA(1200)); await p.waitForTimeout(150);
    const yi = await p.evaluate(() => __y());
    await p.evaluate(() => { abrirFichaProducto('P5'); }); await p.waitForTimeout(200);
    await p.evaluate(() => cerrarFichaProducto()); await p.waitForTimeout(300);
    chk('Cualquier modal (ficha de producto) también regresa a la misma ubicación', Math.abs(await p.evaluate(() => __y()) - yi) <= 2, String(yi));
  }

  // A 820 px (tableta) el arreglo no rompe nada
  await p.setViewportSize({ width: 820, height: 1100 });
  await p.evaluate(() => { selectedGroup = 'Todos'; __ir('almacen'); }); await p.waitForTimeout(250);
  await p.evaluate(() => __irA(1500)); await p.waitForTimeout(150);
  const yt = await p.evaluate(() => __y());
  const rt = await capturar('4');
  chk('[820 px] después de guardar se queda en su sitio', Math.abs(rt.despues.y - yt) <= 2, yt + ' → ' + rt.despues.y);

  chk('Sin errores de JavaScript en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();
  let mal = 0; C.forEach(c => { if (!c.ok) mal++; console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  →  ' + c.d)); });
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron');
  process.exit(mal ? 1 : 0);
})();
