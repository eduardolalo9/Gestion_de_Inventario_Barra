// Contabilizar dentro de Conteo, en la app real (Chromium): el botón aparece
// donde el administrador está mirando, explica cuando no se puede, y un
// inventario CONTABILIZADO ya no se comporta como si siguiera abierto.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const PUERTO = process.env.PUERTO || '8080';

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
  chk('La página carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  // Espías: se registra lo que la app intenta hacer, sin tocar Firestore.
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.overrides = {};
    products = [{ id: 'A', name: 'TEQUILA A', group: 'TEQUILA', unit: 'PZA', stockByArea: { almacen: 1, barra1: 0, barra2: 0 } }];
    allUsersAuditoria = {};
    window.__avisos = []; window.__confirm = []; window.__contab = [];
    window.showNotification = function(m) { window.__avisos.push(String(m)); };
    window.showConfirm = function(m, cb) { window.__confirm.push({ m: String(m), cb: cb }); };
    window.contabilizarInventario = function(id, n) { window.__contab.push([id, n]); };
    window.__pintar = function(inv, permisos) {
      _authzState.permissions = new Set(permisos);
      _inventarioActivo = inv; _inventarioActivoId = 'INV' + inv.numero;
      activeTab = 'inventario'; auditoriaView = 'selection'; renderTab();
      const t = document.getElementById('tabContent');
      return {
        txt:     t.innerText.replace(/\s+/g, ' '),
        contab:  !!t.querySelector('[data-inv-accion="contabilizar"]'),
        crear:   [...t.querySelectorAll('button')].some(b => /Crear el siguiente inventario/.test(b.textContent)),
        cerrar:  [...t.querySelectorAll('button')].some(b => /Cerrar Inventario Físico/.test(b.textContent)),
        reconteo: !!t.querySelector('[data-rc-accion="iniciar"]')
      };
    };
  });

  const base = { numero: 12, fechaCreacion: Date.now() - 86400000, fechaCierre: Date.now(),
                 creadoPorNombre: 'Eduardo', creadoPorRol: 'ADMIN', cerradoPorNombre: 'Eduardo', semanaId: '2026-09-14' };

  // ── A · Cerrado en domingo, administrador ──────────────────────────────
  const a = await p.evaluate(b => __pintar(Object.assign({}, b, { estado: 'CERRADO', fechaRecuento: '2026-09-20' }), ['*']), base);
  chk('★ Cerrado en domingo: Conteo muestra "Siguiente paso: contabilizar"', /Siguiente paso: contabilizar/.test(a.txt), a.txt.slice(0, 300));
  chk('★ …con el botón Contabilizar ahí mismo', a.contab);
  chk('Dice a qué semana pasa el resultado y que es irreversible',
      /semana del 21/.test(a.txt) && /irreversible/i.test(a.txt), a.txt.slice(0, 400));
  chk('Ofrece crear el siguiente inventario', a.crear);
  chk('Un inventario cerrado ya no ofrece "Cerrar" ni "Reconteo"', !a.cerrar && !a.reconteo);

  await p.evaluate(() => document.querySelector('[data-inv-accion="contabilizar"]').click());
  const click = await p.evaluate(() => ({ llamadas: __contab.slice(), deshab: document.querySelector('[data-inv-accion="contabilizar"]').disabled }));
  chk('★ El botón contabiliza el inventario que Conteo está mostrando',
      click.llamadas.length === 1 && click.llamadas[0][0] === 'INV12' && click.llamadas[0][1] === 12, JSON.stringify(click.llamadas));
  await p.evaluate(() => document.querySelector('[data-inv-accion="contabilizar"]').click());
  chk('Un segundo toque inmediato no lanza otra contabilización',
      click.deshab && (await p.evaluate(() => __contab.length)) === 1);
  await p.waitForTimeout(2100);
  chk('Si se cancela la confirmación, se puede volver a intentar',
      await p.evaluate(() => !document.querySelector('[data-inv-accion="contabilizar"]').disabled));

  // Crear el siguiente sin contabilizar: pregunta antes, no bloquea.
  await p.evaluate(() => { __confirm = []; abrirModalNuevoInventario(); });
  const nudge = await p.evaluate(() => ({ c: __confirm.map(x => x.m), abierto: !document.getElementById('nuevoInventarioModal').classList.contains('hidden') }));
  chk('★ Crear otro sin contabilizar pregunta antes de abrir el formulario',
      nudge.c.length === 1 && /NO está contabilizado/.test(nudge.c[0]) && !nudge.abierto, JSON.stringify(nudge));
  await p.evaluate(() => __confirm[0].cb());
  chk('…y si se acepta, el formulario se abre',
      await p.evaluate(() => !document.getElementById('nuevoInventarioModal').classList.contains('hidden')));
  await p.evaluate(() => cerrarModalNuevoInventario());

  // ── B · Mismo inventario, visto por un bartender ──────────────────────
  const b = await p.evaluate(b => __pintar(Object.assign({}, b, { estado: 'CERRADO', fechaRecuento: '2026-09-20' }), ['inventory.history']), base);
  chk('Un bartender ve que está pendiente, sin el botón',
      /Pendiente de que administración/.test(b.txt) && !b.contab && !b.crear, b.txt.slice(0, 300));

  // ── C · Cerrado a media semana ────────────────────────────────────────
  const c = await p.evaluate(b => __pintar(Object.assign({}, b, { estado: 'CERRADO', fechaRecuento: '2026-09-23' }), ['*']), base);
  chk('★ Un corte a media semana explica por qué no se contabiliza',
      /No se puede contabilizar\. Solo se contabiliza un recuento fechado en DOMINGO/.test(c.txt) && !c.contab, c.txt.slice(0, 400));
  chk('…y deja crear el siguiente', c.crear);

  // ── D · Contabilizado: el caso que antes dejaba la app atorada ─────────
  await p.evaluate(() => { __avisos = []; __confirm = []; });
  const d = await p.evaluate(b => __pintar(Object.assign({}, b, { estado: 'CONTABILIZADO', fechaRecuento: '2026-09-20',
                                                                   semanaDestino: '2026-09-21', contabilizadoEn: Date.now() }), ['*']), base);
  chk('★ Un inventario contabilizado se muestra como CONTABILIZADO, no SINCRONIZADO',
      /INVENTARIO BARRA CONTABILIZADO/.test(d.txt) && !/SINCRONIZADO/.test(d.txt), d.txt.slice(0, 200));
  chk('Dice de qué semana es ya el stock inicial', /Contabilizado/.test(d.txt) && /semana del 21/.test(d.txt));
  chk('★ Ya no ofrece "Cerrar" ni "Reconteo" sobre un contabilizado', !d.cerrar && !d.reconteo);
  chk('★ Ofrece crear el inventario siguiente', d.crear && !d.contab);

  await p.evaluate(() => auditoriaEntrarArea('almacen'));
  const entrar = await p.evaluate(() => ({ av: __avisos.slice(), vista: auditoriaView }));
  chk('★ Nadie puede entrar a contar en un contabilizado',
      entrar.vista === 'selection' && entrar.av.some(m => /solo lectura/.test(m)), JSON.stringify(entrar));

  await p.evaluate(() => { __avisos = []; cerrarInventarioFisico(); });
  chk('Cerrar un contabilizado se rechaza en la propia app',
      await p.evaluate(() => __avisos.some(m => /No hay un Inventario Físico abierto/.test(m))));

  await p.evaluate(() => { __confirm = []; abrirModalNuevoInventario(); });
  const crearD = await p.evaluate(() => ({ c: __confirm.length, abierto: !document.getElementById('nuevoInventarioModal').classList.contains('hidden'), av: __avisos.slice() }));
  chk('★ Tras contabilizar, crear el siguiente abre el formulario (antes: "Cierra el #12…")',
      crearD.abierto && crearD.c === 0 && !crearD.av.some(m => /antes de crear otro/.test(m)), JSON.stringify(crearD));
  await p.evaluate(() => cerrarModalNuevoInventario());

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── Contabilizar en Conteo (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
