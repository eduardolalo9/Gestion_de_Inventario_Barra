// v5.56 — Chromium real (390 px):
//   1. Menú ⋮ en la tarjeta del inventario activo («#1008 · Inventario Barra») con «Anular inventario».
//   2. Anular un inventario ABIERTO: motivo, aviso de conteos, cierre atómico (snapshot + estado + marca) y rechazo del servidor.
//   3. Panel «Conteos por usuario» compacto (una fila por persona; acciones solo al desplegar).
// Firestore es simulado: cada batch queda registrado y se comprueba operación por operación.
//   npm run test:navegador   (o:  PUERTO=8080 node pruebas/prueba-v556-menu-usuarios-navegador.js)
const { chromium } = require('playwright');
const path = require('path');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const CAPTURAS = process.env.CAPTURAS_DIR || '';

const FAKE = () => {
  const vacio = { exists: false, docs: [], empty: true, size: 0, forEach() {}, data() { return {}; }, docChanges() { return []; } };
  const mk = () => new Proxy(function () {}, { get(_, k) { if (k === 'then') return undefined; if (k === 'get') return async () => vacio; if (k === 'onSnapshot') return () => () => {}; return () => mk(); } });
  window.__store = { inv: {} }; window.__ops = []; window.__commits = 0; window.__rechazar = false;
  const docInv = (id) => ({
    __id: id,
    get: async () => ({ exists: !!window.__store.inv[id], data: () => window.__store.inv[id] }),
    update: async (d) => { if (window.__rechazar) { const e = new Error('permission'); e.code = 'permission-denied'; throw e; } window.__ops.push({ t: 'update1', id, d: JSON.parse(JSON.stringify(d)) }); Object.assign(window.__store.inv[id], d); },
    collection: (c) => ({ doc: (cid) => ({ __c: c, __id: cid }) })
  });
  _db = {
    collection: () => ({ doc: () => ({ collection: (c) => (c === 'inventories' ? { doc: docInv } : mk()), get: async () => vacio, set: async () => {}, update: async () => {} }) }),
    batch: () => {
      const ops = [];
      return {
        set(ref, d) { ops.push({ t: 'set', c: ref.__c, id: ref.__id, d: JSON.parse(JSON.stringify(d)) }); },
        update(ref, d) { ops.push({ t: 'update', id: ref.__id, d: JSON.parse(JSON.stringify(d)) }); },
        delete() {},
        commit: async () => {
          if (window.__rechazar) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
          window.__commits++; ops.forEach(o => { window.__ops.push(o); if (o.t === 'update') Object.assign(window.__store.inv[o.id], o.d); });
        }
      };
    },
    runTransaction: async () => {}
  };
};

const MONTAR = () => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u'; currentUserRole = 'admin'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
  _lastUserData = { role: 'admin', displayName: 'Eduardo Admin', email: 'admin@bar.mx' };
  const P = (id, name, group) => ({ id, name, group, unit: 'BOT', precio: 100, stockMinimo: 1, conversion: 1, stockByArea: { almacen: 0, barra1: 0, barra2: 0 } });
  products = [P('T1', 'TEQUILA 1800', 'TEQUILA'), P('R1', 'RON BACARDI', 'RON'), P('W1', 'WHISKY BUCHANANS', 'WHISKY')];
  auditoriaConteo = {}; orders = []; inventories = []; compras = []; movimientos = []; costosUltimos = {}; cart = [];
  window.__store.inv['inv-open'] = { inventoryId: 'inv-open', numero: 1008, estado: 'SINCRONIZADO', fechaCreacion: Date.now() - 86400000, creadoPorNombre: 'Eduardo', warehousesSnapshot: ['almacen', 'barra1', 'barra2'], participantesUids: [] };
  window.__store.inv['inv-cont'] = { inventoryId: 'inv-cont', numero: 1007, estado: 'CONTABILIZADO', fechaCreacion: Date.now() - 86400000 * 5, fechaCierre: Date.now() - 86400000 * 2, semanaDestino: '2026-11-16', fechaRecuento: '2026-11-15' };
  const cnt = (p, a, e) => { const o = {}; o[p] = {}; o[p][a] = { enteras: e, abiertas: [] }; return o; };
  const merge = (...x) => { const r = {}; x.forEach(y => Object.keys(y).forEach(k => { r[k] = Object.assign(r[k] || {}, y[k]); })); return r; };
  allUsersAuditoria = {
    u1: { uid: 'u1', email: 'admin2@gmail.com', status: { almacen: 'completada', barra1: 'pendiente', barra2: 'pendiente' }, updatedAt: Date.now() - 99 * 3600000,
          conteo: merge(cnt('T1', 'almacen', 3), cnt('R1', 'almacen', 2), cnt('W1', 'barra2', 1)) },
    u2: { uid: 'u2', email: 'eduardo_lucio_96@outlook.com', status: { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' }, updatedAt: Date.now() - 80 * 3600000,
          conteo: merge(cnt('T1', 'almacen', 1), cnt('R1', 'barra1', 4), cnt('W1', 'barra2', 2)) },
    u3: { uid: 'u3', email: 'bartender@gmail.com', status: {}, updatedAt: Date.now() - 91 * 3600000, conteo: merge(cnt('R1', 'barra1', 5)) }
  };
  _reconteoActivo = null;
  _auditoriaSessionId = 'inv-open';
  window.__ir = (id) => { _inventarioActivoId = id; _inventarioActivo = window.__store.inv[id]; _inventarioActivoCarga = 'ok'; isAuditoriaMode = true; auditoriaView = 'selection'; activeTab = 'inventario'; notificationTimeout = null; renderTab(); };
  window.__ir('inv-open');
};

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await ctx.newPage(); const errs = [], viol = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  p.on('console', m => { if (/Content Security Policy|violates the following/i.test(m.text()) && !/inline event handler/i.test(m.text())) viol.push(m.text().slice(0, 200)); });
  p.on('dialog', d => d.dismiss());
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600);
  await p.evaluate(FAKE); await p.evaluate(MONTAR); await p.waitForTimeout(400);
  const toast = () => p.locator('#toastMessage').textContent();
  const lib = () => p.evaluate(() => { notificationTimeout = null; });
  const visible = (sel) => p.locator(sel).isVisible();

  // ═══ 1 · Menú ⋮ de la tarjeta del inventario ═══
  const btn = p.locator('[data-if-menu]');
  chk('★ La tarjeta «#1008 · Inventario Barra» tiene el botón de 3 puntos (⋮)', await btn.count() === 1 && /#1008/.test(await p.locator('.if-card__titulo').first().innerText()));
  const cb = await btn.boundingBox();
  chk('El botón mide ≥ 44 px y está a la derecha dentro de la tarjeta (390 px)', cb && cb.width >= 44 && cb.height >= 44 && cb.x + cb.width <= 390 && cb.x > 250, JSON.stringify(cb));
  chk('Cerrado: la opción no se ve y aria-expanded=false', !(await visible('[data-if-accion="anular_abierto"]')) && await btn.getAttribute('aria-expanded') === 'false');
  await btn.click(); await p.waitForTimeout(150);
  chk('★ Al tocar ⋮ se despliega «Anular inventario»', await visible('[data-if-accion="anular_abierto"]') && /Anular inventario/.test(await p.locator('[data-if-accion="anular_abierto"]').innerText()) && await btn.getAttribute('aria-expanded') === 'true');
  const ci = await p.locator('[data-if-accion="anular_abierto"]').boundingBox();
  chk('La opción mide ≥ 44 px y queda dentro de la pantalla', ci && ci.height >= 44 && ci.x >= 0 && ci.x + ci.width <= 390 && ci.y >= 0 && ci.y + ci.height <= 844, JSON.stringify(ci));
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'menu-3-puntos-390.png') });
  await p.evaluate(() => renderTab()); await p.waitForTimeout(150);
  chk('Un repintado en vivo (otro usuario contando) NO cierra el menú', await visible('[data-if-accion="anular_abierto"]'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  chk('Escape lo cierra', !(await visible('[data-if-accion="anular_abierto"]')));
  await btn.click(); await p.waitForTimeout(100);
  await p.locator('.if-card__titulo').first().click(); await p.waitForTimeout(100);
  chk('Tocar fuera del menú también lo cierra', !(await visible('[data-if-accion="anular_abierto"]')));

  // ═══ 2 · Quién ve el menú ═══
  const sinMenu = async (prep, restaurar) => { await p.evaluate(prep); await p.evaluate(() => renderTab()); await p.waitForTimeout(120); const n = await p.locator('[data-if-menu]').count(); await p.evaluate(restaurar || (() => { currentUserRole = 'admin'; _authzState.permissions = new Set(['*']); _auditoriaSessionId = 'inv-open'; window.__ir('inv-open'); })); return n; };
  chk('★ Sin ser administrador no hay menú', await sinMenu(() => { currentUserRole = 'user'; _authzState.permissions = new Set(['inventory.viewAll', 'inventory.export']); }) === 0);
  chk('Sin el permiso de cerrar el inventario (inventory.closeGlobal) no hay menú en uno abierto', await sinMenu(() => { _authzState.permissions = new Set(['inventory.viewAll']); }) === 0);
  chk('★ Un inventario CONTABILIZADO no tiene menú (es el stock inicial)', await sinMenu(() => { window.__ir('inv-cont'); }) === 0);
  chk('Un inventario abierto de una versión anterior (huérfano) no tiene menú: se cierra como abandonado', await sinMenu(() => { _auditoriaSessionId = 'otra-sesion'; }) === 0);
  chk('(preparación) con todo en orden el menú vuelve', await p.locator('[data-if-menu]').count() === 1);

  // ═══ 3 · Anular el inventario ABIERTO ═══
  await lib();
  await btn.click(); await p.locator('[data-if-accion="anular_abierto"]').click(); await p.waitForTimeout(300);
  chk('★ Pide el MOTIVO y avisa que los conteos de las 3 personas se guardan dentro del inventario', await p.evaluate(() => { const o = document.getElementById('anOverlay'); return !!o && /Anular inventario #1008/.test(o.innerText) && /3 persona\(s\)/.test(o.innerText) && /no se pierden/.test(o.innerText) && /crear otro/.test(o.innerText) && !!document.getElementById('anMotivo'); }));
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'anular-abierto-390.png') });
  await p.locator('[data-an-accion="aceptar"]').click(); await p.waitForTimeout(150);
  chk('Sin motivo no se anula (avisa) y no se escribe nada', /Escribe el motivo/.test(await p.locator('#anError').innerText()) && await p.evaluate(() => window.__ops.length) === 0);
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  chk('Escape cancela sin escribir', await p.locator('#anOverlay').count() === 0 && await p.evaluate(() => window.__ops.length) === 0);
  // Reconteo abierto: se frena
  await p.evaluate(() => { _reconteoActivo = { inventoryId: 'inv-open', estado: 'abierto', orden: [1] }; notificationTimeout = null; });
  await btn.click(); await p.locator('[data-if-accion="anular_abierto"]').click(); await p.waitForTimeout(500);
  chk('★ Con un reconteo abierto no se anula (avisa que lo finalices o descartes) y no abre el motivo', /reconteo abierto/.test(await toast()) && await p.locator('#anOverlay').count() === 0 && await p.evaluate(() => window.__ops.length) === 0);
  await p.evaluate(() => { _reconteoActivo = null; notificationTimeout = null; });
  // Rechazo del servidor
  await p.evaluate(() => { window.__rechazar = true; });
  await btn.click(); await p.locator('[data-if-accion="anular_abierto"]').click(); await p.waitForTimeout(250);
  await p.fill('#anMotivo', 'Se creó por error'); await p.locator('[data-an-accion="aceptar"]').click(); await p.waitForTimeout(900);
  chk('★ Si el servidor rechaza, lo dice claro y el inventario sigue ABIERTO (el batch es todo o nada)', /reglas de Firestore/.test(await toast()) && await p.evaluate(() => window.__store.inv['inv-open'].estado === 'SINCRONIZADO' && window.__ops.length === 0));
  // Anular de verdad
  await p.evaluate(() => { window.__rechazar = false; notificationTimeout = null; });
  await btn.click(); await p.locator('[data-if-accion="anular_abierto"]').click(); await p.waitForTimeout(250);
  await p.fill('#anMotivo', '  Se creó por error  '); await p.locator('[data-an-accion="aceptar"]').click(); await p.waitForTimeout(1000);
  const w = await p.evaluate(() => ({ commits: window.__commits, ops: window.__ops.slice(), inv: window.__store.inv['inv-open'] }));
  const sets = w.ops.filter(o => o.t === 'set'), upd = w.ops.filter(o => o.t === 'update');
  chk('★ Se escribe en UN solo batch (todo o nada): fragmentos del snapshot + el cambio del inventario', w.commits === 1 && sets.length >= 1 && upd.length === 1 && upd[0].id === 'inv-open');
  const items = [].concat.apply([], sets.map(o => o.d.items));
  chk('★ Los conteos de las 3 personas y los 3 productos quedan guardados dentro del inventario (evidencia)', items.filter(i => i.tipo === 'usuario').length === 3 && items.filter(i => i.tipo === 'producto').length === 3 && sets.every(o => o.c === 'snapshotChunks'));
  const d = upd[0] && upd[0].d;
  chk('★ El inventario pasa a CERRADO + anulado con motivo (recortado), quién y cuándo; cierreTipo «anulado»', d && d.estado === 'CERRADO' && d.cierreTipo === 'anulado' && d.anulado === true && d.motivoAnulacion === 'Se creó por error'
      && d.anuladoPor === 'u' && d.anuladoPorNombre === 'Eduardo Admin' && typeof d.anuladoEn === 'number' && d.totalProductos === 3 && d.participantesUids.length === 3, JSON.stringify(d));
  chk('Avisa que ya puede crear uno nuevo y dónde ver el anulado', /anulado/.test(await toast()) && /Mostrar anulados/.test(await toast()));
  await p.evaluate(() => { window.__ir('inv-open'); }); await p.waitForTimeout(300);   // el oyente real vuelve a entregar el documento
  chk('★ Anulado: la tarjeta dice ANULADO con el motivo y ofrece «Crear el siguiente inventario» y «Restaurar»; ya no se cuenta en él', await p.evaluate(() => /ANULADO/.test(document.querySelector('.pm-estado--cab').innerText) && /Se creó por error/.test(document.body.innerText) && /Crear el siguiente inventario/.test(document.body.innerText)) && await p.locator('.pm-paso >> text=Restaurar').count() === 1);
  chk('El menú ⋮ ahora ofrece «Restaurar inventario» (y ya no «Anular»)', await p.locator('[data-if-accion="restaurar"]').count() === 1 && await p.locator('[data-if-accion="anular_abierto"]').count() === 0 && await p.locator('[data-if-accion="anular"]').count() === 0);
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'abierto-anulado-390.png') });
  // Restaurar desde el menú
  await lib(); await p.evaluate(() => { window.__ops.length = 0; });
  await p.locator('[data-if-menu]').click(); await p.locator('[data-if-accion="restaurar"]').click(); await p.waitForTimeout(250);
  chk('Restaurar pide confirmación', await p.locator('#_confirmOverlay').count() === 1);
  await p.click('#_cfmOk'); await p.waitForTimeout(800);
  const r = await p.evaluate(() => window.__ops.filter(o => o.t === 'update1'));
  chk('★ Restaurar escribe solo anulado=false, restauradoEn y restauradoPor', r.length === 1 && Object.keys(r[0].d).sort().join() === 'anulado,restauradoEn,restauradoPor' && r[0].d.anulado === false, JSON.stringify(r));
  // Un CERRADO (sin anular) también se anula desde el menú
  await p.evaluate(() => { window.__store.inv['inv-open'] = { inventoryId: 'inv-open', numero: 1008, estado: 'CERRADO', fechaCreacion: Date.now() - 86400000, fechaCierre: Date.now() - 3600000, creadoPorNombre: 'Eduardo', semanaId: '2026-11-16', warehousesSnapshot: ['almacen', 'barra1', 'barra2'] }; window.__ops.length = 0; window.__ir('inv-open'); });
  await p.waitForTimeout(250);
  chk('★ Un inventario CERRADO sin anular también tiene el menú con «Anular inventario»', await p.locator('[data-if-accion="anular"]').count() === 1);
  await lib(); await p.locator('[data-if-menu]').click(); await p.locator('[data-if-accion="anular"]').click(); await p.waitForTimeout(250);
  await p.fill('#anMotivo', 'Prueba de cerrado'); await p.locator('[data-an-accion="aceptar"]').click(); await p.waitForTimeout(900);
  const rc = await p.evaluate(() => window.__ops.filter(o => o.t === 'update1'));
  chk('Anular un CERRADO escribe solo la marca (5 campos), sin tocar el estado', rc.length === 1 && Object.keys(rc[0].d).sort().join() === 'anulado,anuladoEn,anuladoPor,anuladoPorNombre,motivoAnulacion' && rc[0].d.estado === undefined, JSON.stringify(rc));

  // ═══ 4 · «Conteos por usuario» compacto ═══
  await p.evaluate(() => { window.__store.inv['inv-open'] = { inventoryId: 'inv-open', numero: 1008, estado: 'SINCRONIZADO', fechaCreacion: Date.now() - 86400000, creadoPorNombre: 'Eduardo', warehousesSnapshot: ['almacen', 'barra1', 'barra2'] }; window.__ir('inv-open'); });
  await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('toast').classList.add('hidden'));
  const panel = p.locator('.if-card--usuarios');
  const pb = await panel.boundingBox();
  chk('★ El panel con 3 personas es compacto: mide menos de 300 px (antes ≈ 600 px)', pb && pb.height < 300, JSON.stringify(pb));
  chk('Cabe en 390 px sin desbordar', await p.evaluate(() => { const e = document.querySelector('.if-card--usuarios'); const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390 && document.documentElement.scrollWidth <= 390 && [...e.querySelectorAll('*')].every(x => x.getBoundingClientRect().right <= 391); }));
  const filas = await panel.locator('.uc-fila').count();
  chk('Una fila por persona (3) con su nombre corto (lo de antes de la @) y el correo completo al mantener pulsado', filas === 3 && (await panel.locator('.uc-nom').allInnerTexts()).map(t => t.trim()).join('|') === 'admin2|eduardo_lucio_96|bartender' && /@gmail\.com/.test(await panel.locator('.uc-nom').first().getAttribute('title')));
  chk('Cada fila mide ≤ 80 px (una línea de nombre y una de píldoras)', await p.evaluate(() => [...document.querySelectorAll('.uc-fila')].every(f => f.getBoundingClientRect().height <= 80)));
  chk('★ Muestra el avance (1/3) y una píldora por área con su estado: ✓ finalizada, punto que late = contando, – sin iniciar, y cuántos productos', await p.evaluate(() => {
    const f = document.querySelectorAll('.uc-fila')[0];
    const pil = [...f.querySelectorAll('.uc-pil')].map(e => e.className.replace('uc-pil uc-pil--', '') + ':' + (e.querySelector('.uc-pil__ico .fa-check') ? 'check' : (e.querySelector('.uc-pil__ico .audit-counting-badge__punto') ? 'punto' : e.querySelector('.uc-pil__ico').textContent)) + ' ' + e.querySelector('.uc-pil__nom').textContent + (e.querySelector('.uc-pil__n') ? ' ' + e.querySelector('.uc-pil__n').textContent : ''));
    return /^1\/3$/.test(f.querySelector('.uc-prog').textContent.trim()) && pil.length === 3 && /^ok:check Almacén 2$/.test(pil[0]) && /^nada:– B\. Rest\.$/.test(pil[1]) && /^cont:punto B\. Bar 1$/.test(pil[2]);
  }));
  chk('★ Ya no muestra lo que sobraba: «Sin iniciar», «prods», «ent», «ab» ni la lista de áreas por persona', await p.evaluate(() => { const t = document.querySelector('.if-card--usuarios').innerText; return !/Sin iniciar|prods?\b| ent\b| ab\b|Finalizado|CONTANDO/.test(t); }));
  chk('Muestra «EN VIVO» (hay quien está contando) y el «hace …» de cada persona', /EN VIVO/.test(await panel.innerText()) && (await panel.locator('.uc-hace').count()) === 3);
  chk('Solo quien tiene un área finalizada tiene la flecha para desplegar acciones (1 de 3)', await panel.locator('[data-uc-toggle]').count() === 1);
  chk('Las acciones (Ver / Habilitar / Reabrir) NO se ven hasta desplegar', await panel.locator('.uc-acc').count() === 0 && await panel.locator('text=Habilitar').count() === 0);
  if (CAPTURAS) await panel.screenshot({ path: path.join(CAPTURAS, 'usuarios-compacto-390.png') });
  await p.evaluate(() => { window.__acc = []; window.adminVerConteoUsuario = (u, a) => window.__acc.push(['ver', u, a]); window.adminUnlockAreaUsuario = (u, a) => window.__acc.push(['unlock', u, a]); });
  await panel.locator('[data-uc-toggle]').click(); await p.waitForTimeout(200);
  chk('★ Al desplegar aparecen las acciones del área finalizada (Almacén): Ver y Habilitar, ≥ 44 px', await panel.locator('.uc-acc').count() === 1 && /Almacén/.test(await panel.locator('.uc-acc__area').innerText())
      && await panel.locator('.uc-acc .bt').count() >= 2 && await p.evaluate(() => [...document.querySelectorAll('.uc-acc .bt')].every(b => b.getBoundingClientRect().height >= 44)));
  if (CAPTURAS) await panel.screenshot({ path: path.join(CAPTURAS, 'usuarios-desplegado-390.png') });
  await panel.locator('.uc-acc .bt', { hasText: 'Ver' }).click(); await panel.locator('.uc-acc .bt', { hasText: 'Habilitar' }).click(); await p.waitForTimeout(150);
  chk('★ Los botones siguen funcionando: llaman a adminVerConteoUsuario y adminUnlockAreaUsuario con la persona y el área correctas', JSON.stringify(await p.evaluate(() => window.__acc)) === JSON.stringify([['ver', 'u1', 'almacen'], ['unlock', 'u1', 'almacen']]));
  await p.evaluate(() => renderTab()); await p.waitForTimeout(150);
  chk('Un repintado en vivo mantiene desplegada a esa persona', await panel.locator('.uc-acc').count() === 1 && await panel.locator('[data-uc-toggle]').getAttribute('aria-expanded') === 'true');
  await panel.locator('[data-uc-toggle]').click(); await p.waitForTimeout(150);
  chk('Tocar la flecha otra vez las oculta', await panel.locator('.uc-acc').count() === 0);
  await p.evaluate(() => { allUsersAuditoria = {}; renderTab(); }); await p.waitForTimeout(150);
  chk('Sin personas contando el panel no aparece', await p.locator('.if-card--usuarios').count() === 0);

  chk('Sin errores de JavaScript en toda la prueba', errs.length === 0, errs.join(' | '));
  chk('Sin violaciones de CSP', viol.length === 0, viol.join(' | '));
  await nav.close();
  const fallos = C.filter(c => !c.ok);
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + ' ' + c.n + (c.ok ? '' : '  ←  ' + c.d)));
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron\n');
  process.exit(fallos.length ? 1 : 0);
})();
