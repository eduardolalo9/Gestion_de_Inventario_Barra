// FASE 13 — contabilizar fin de mes, en la app real (Chromium): el botón y
// los mensajes de "Siguiente paso: contabilizar" distinguen los tres casos
// (semanal puro, mensual puro, los dos a la vez), y el Historial muestra el
// corte mensual aparte del inicial semanal. Complementa, sin repetir,
// prueba-contabilizar-navegador.js (que cubre el caso semanal puro a fondo).
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
      const botones = [...t.querySelectorAll('button')].map(b => b.textContent.trim());
      return {
        txt:     t.innerText.replace(/\s+/g, ' '),
        botones: botones,
        contab:  !!t.querySelector('[data-inv-accion="contabilizar"]'),
        txtBtnContab: (t.querySelector('[data-inv-accion="contabilizar"]') || {}).textContent || null,
        crear:   botones.some(bt => /Crear el siguiente inventario/.test(bt))
      };
    };
  });

  const base = { fechaCreacion: Date.now() - 86400000, fechaCierre: Date.now(),
                 creadoPorNombre: 'Eduardo', creadoPorRol: 'ADMIN', cerradoPorNombre: 'Eduardo' };

  // ── A · Corte de fin de mes PURO (miércoles 30-sep-2026), administrador ──
  const a = await p.evaluate(b => __pintar(Object.assign({}, b, {
    numero: 201, estado: 'CERRADO', fechaRecuento: '2026-09-30', semanaId: '2026-09-28'
  }), ['*']), base);
  chk('★ Mensual puro: "Siguiente paso: contabilizar" aparece (antes de FASE 13 se bloqueaba)',
      /Siguiente paso: contabilizar/.test(a.txt), a.txt.slice(0, 300));
  chk('★ El botón dice "Contabilizar cierre de mes", no el genérico ni el combinado',
      /📅 Contabilizar cierre de mes/.test(a.txtBtnContab || ''), JSON.stringify(a.txtBtnContab));
  chk('★ El texto habla del corte contable del mes, NO de una semana destino',
      /corte contable del mes 2026-09/.test(a.txt) && !/stock inicial de la semana/.test(a.txt),
      a.txt.slice(0, 400));
  chk('Sigue avisando de que es irreversible', /irreversible/i.test(a.txt));

  // ── B · Domingo-fin-de-mes (31-may-2026): las DOS cosas en un botón ─────
  const b = await p.evaluate(bb => __pintar(Object.assign({}, bb, {
    numero: 301, estado: 'CERRADO', fechaRecuento: '2026-05-31', semanaId: '2026-05-25'
  }), ['*']), base);
  chk('★ D1 · Domingo-fin-de-mes: el botón dice "Contabilizar (semana + mes)"',
      /📘 Contabilizar \(semana \+ mes\)/.test(b.txtBtnContab || ''), JSON.stringify(b.txtBtnContab));
  chk('★ El texto menciona el stock inicial de la semana Y el corte del mes, a la vez',
      /stock inicial de la semana/.test(b.txt) && /corte contable del mes 2026-05/.test(b.txt),
      b.txt.slice(0, 500));

  // ── C · El caso semanal puro no cambió de etiqueta (sin regresión) ──────
  const c = await p.evaluate(bb => __pintar(Object.assign({}, bb, {
    numero: 12, estado: 'CERRADO', fechaRecuento: '2026-09-20', semanaId: '2026-09-14'
  }), ['*']), base);
  chk('El botón semanal puro sigue diciendo solo "Contabilizar" (sin regresión)',
      c.txtBtnContab && /^📘 Contabilizar$/.test(c.txtBtnContab.trim()), JSON.stringify(c.txtBtnContab));
  chk('…y el texto sigue mencionando la semana destino, sin hablar de ningún mes',
      /stock inicial de la/.test(c.txt) && !/corte contable del mes/.test(c.txt));

  // ── D · Un bartender ve el corte mensual pendiente, sin el botón ────────
  const d = await p.evaluate(bb => __pintar(Object.assign({}, bb, {
    numero: 202, estado: 'CERRADO', fechaRecuento: '2026-09-30', semanaId: '2026-09-28'
  }), ['inventory.history']), base);
  chk('Un bartender ve el corte mensual como pendiente, sin botón',
      /Pendiente de que administración/.test(d.txt) && /corte contable del mes 2026-09/.test(d.txt) && !d.contab,
      d.txt.slice(0, 400));

  // ── E · Contabilizado con SOLO mesDestino (mensual puro ya aplicado) ────
  const e = await p.evaluate(bb => __pintar(Object.assign({}, bb, {
    numero: 203, estado: 'CONTABILIZADO', fechaRecuento: '2026-09-30', semanaId: '2026-09-28',
    mesDestino: '2026-09', contabilizadoEn: Date.now()
  }), ['*']), base);
  chk('★ "Contabilizado" con solo corte mensual no inventa una semana',
      /Contabilizado/.test(e.txt) && /corte contable del mes 2026-09/.test(e.txt) && !/stock inicial de la semana —/.test(e.txt),
      e.txt.slice(0, 400));

  // ── F · Contabilizado con AMBOS destinos ────────────────────────────────
  const f = await p.evaluate(bb => __pintar(Object.assign({}, bb, {
    numero: 302, estado: 'CONTABILIZADO', fechaRecuento: '2026-05-31', semanaId: '2026-05-25',
    semanaDestino: '2026-06-01', mesDestino: '2026-05', contabilizadoEn: Date.now()
  }), ['*']), base);
  chk('★ "Contabilizado" con los dos destinos los menciona a ambos',
      /stock inicial de la semana/.test(f.txt) && /corte contable del mes 2026-05/.test(f.txt),
      f.txt.slice(0, 400));

  // ── G · El Historial distingue el corte mensual del inicial semanal ─────
  const g = await p.evaluate(() => {
    _historialInventarios = [
      { inventoryId: 'i1', numero: 301, estado: 'CONTABILIZADO', fechaCreacion: Date.now(),
        totalProductos: 3, semanaDestino: '2026-06-01', mesDestino: '2026-05' },
      { inventoryId: 'i2', numero: 201, estado: 'CONTABILIZADO', fechaCreacion: Date.now(),
        totalProductos: 3, mesDestino: '2026-09' }
    ];
    auditoriaView = 'historial'; renderTab();
    return document.getElementById('tabContent').innerText.replace(/\s+/g, ' ');
  });
  chk('★ El Historial muestra el corte mensual junto al inicial cuando hay los dos',
      /Inicial de la semana 2026-06-01/.test(g) && /Corte mensual 2026-05/.test(g), g.slice(0, 400));
  chk('★ …y el corte mensual solo, cuando el cierre fue mensual puro',
      /Corte mensual 2026-09/.test(g), g.slice(0, 400));

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── FASE 13 · contabilizar fin de mes (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
