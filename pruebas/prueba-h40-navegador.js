// H-40 (hotfix 4.9), en la app real (Chromium):
//   1) 'Nuevo Inventario Físico' ya no deja crear con una fecha que después
//      nunca se podría contabilizar — se bloquea en pantalla y otra vez en
//      confirmarNuevoInventario() por si el botón se reactivara solo.
//   2) Un inventario abierto SIN fechaRecuento (creado antes de esta regla)
//      lo dice en el encabezado y deja al administrador registrarla una
//      sola vez, sin tocar Firestore de verdad — se mockea _db con un
//      espía, igual que 'contabilizarInventario' se mockea en la prueba de
//      Contabilizar en Conteo.
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
    _authzState.permissions = new Set(['*']);
    window.__avisos = []; window.showNotification = m => __avisos.push(String(m));
    window.__updates = [];
    // _db falso: encadena collection()/doc() sin más, y responde get()/update().
    window.__fakeSnap = { estado: 'SINCRONIZADO' }; // sin fechaRecuento
    // Asignación SIN 'window.': _db es un 'let' de alcance global de página,
    // no una propiedad de window — igual que ya hacen prueba-m2a.js y
    // prueba-reconteo-navegador.js para simular Firestore.
    _db = {
      collection() { return this; },
      doc() { return this; },
      get: async function() { return { exists: true, data: () => Object.assign({}, window.__fakeSnap) }; },
      update: async function(payload) { window.__updates.push(payload); }
    };
    navigator.__onlineFake = true;
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
  });

  // ══════════════════════════════════════════════════════════════════════
  //  PARTE 1 — 'Nuevo Inventario Físico': domingo/fin de mes o no se crea
  // ══════════════════════════════════════════════════════════════════════

  const abre = await p.evaluate(() => {
    _inventarioActivo = null; _inventarioActivoCarga = 'no_existe';
    abrirModalNuevoInventario();
    const f = document.getElementById('nuevoInvFecha');
    const cl = clasificarRecuento(f.value);
    return { abierto: !document.getElementById('nuevoInventarioModal').classList.contains('hidden'),
             fecha: f.value, valida: !!(cl && (cl.cierraSemana || cl.esCorteMensual)),
             disabled: document.getElementById('nuevoInvBtnCrear').disabled };
  });
  chk('★ El formulario propone por defecto una fecha que sí se puede contabilizar',
      abre.abierto && abre.valida && !abre.disabled, JSON.stringify(abre));

  const invalida = await p.evaluate(() => {
    const f = document.getElementById('nuevoInvFecha');
    f.value = '2026-09-22'; // martes, no es fin de mes
    _pintarAvisoFechaNuevoInv();
    return { disabled: document.getElementById('nuevoInvBtnCrear').disabled,
             aviso: document.getElementById('nuevoInvAvisoFecha').textContent };
  });
  chk('★ Un martes cualquiera deshabilita "Crear inventario"',
      invalida.disabled && /no es domingo ni fin de mes/.test(invalida.aviso), JSON.stringify(invalida));

  const domingo = await p.evaluate(() => {
    const f = document.getElementById('nuevoInvFecha');
    f.value = '2026-09-20'; // domingo
    _pintarAvisoFechaNuevoInv();
    return { disabled: document.getElementById('nuevoInvBtnCrear').disabled,
             aviso: document.getElementById('nuevoInvAvisoFecha').textContent };
  });
  chk('Un domingo vuelve a habilitar el botón', !domingo.disabled && /cierra la/.test(domingo.aviso), JSON.stringify(domingo));

  const finMes = await p.evaluate(() => {
    const f = document.getElementById('nuevoInvFecha');
    f.value = '2026-09-30'; // último día de septiembre 2026, no domingo
    _pintarAvisoFechaNuevoInv();
    return { disabled: document.getElementById('nuevoInvBtnCrear').disabled,
             aviso: document.getElementById('nuevoInvAvisoFecha').textContent };
  });
  chk('★ Un fin de mes entre semana también se permite (corte mensual, no semanal)',
      !finMes.disabled && /Corte de fin de mes/.test(finMes.aviso), JSON.stringify(finMes));

  // Defensa en profundidad: aunque el botón se reactive a la fuerza (devtools,
  // una carrera de eventos…), confirmarNuevoInventario() vuelve a comprobar.
  const forzado = await p.evaluate(() => {
    __avisos = [];
    const f = document.getElementById('nuevoInvFecha'); f.value = '2026-09-22';
    document.getElementById('nuevoInvBtnCrear').disabled = false;
    document.querySelector('.nuevoInvArea').checked = true;
    confirmarNuevoInventario();
    return { creado: !document.getElementById('nuevoInventarioModal').classList.contains('hidden') === false,
             av: __avisos.slice() };
  });
  chk('★ confirmarNuevoInventario() rechaza la fecha aunque el botón esté habilitado',
      forzado.av.some(m => /no es domingo ni fin de mes/.test(m)), JSON.stringify(forzado));
  await p.evaluate(() => cerrarModalNuevoInventario());

  // ══════════════════════════════════════════════════════════════════════
  //  PARTE 2 — Inventario abierto SIN fechaRecuento (creado antes de R7/F3)
  // ══════════════════════════════════════════════════════════════════════

  const legado = await p.evaluate(() => {
    _inventarioActivo = { numero: 7, estado: 'SINCRONIZADO', fechaCreacion: Date.now(),
                           creadoPorNombre: 'Eduardo', creadoPorRol: 'ADMIN' }; // sin fechaRecuento
    _inventarioActivoId = 'INV7';
    allUsersAuditoria = {}; products = [];
    activeTab = 'inventario'; auditoriaView = 'selection'; renderTab();
    const t = document.getElementById('tabContent');
    return { txt: t.innerText.replace(/\s+/g, ' '),
              hayBtn: !!t.querySelector('button[onclick="abrirModalRegistrarFechaRecuento()"]') };
  });
  chk('★ Un inventario abierto sin fechaRecuento lo dice en vez de no mostrar nada',
      /Recuento: no registrado/.test(legado.txt), legado.txt.slice(0, 300));
  chk('★ …y ofrece registrarla, mientras siga abierto', legado.hayBtn);

  const modal = await p.evaluate(() => {
    abrirModalRegistrarFechaRecuento();
    const f = document.getElementById('regFechaRecuentoInput');
    const cl = clasificarRecuento(f.value);
    return { abierto: !document.getElementById('regFechaRecuentoModal').classList.contains('hidden'),
             fecha: f.value, valida: !!(cl && (cl.cierraSemana || cl.esCorteMensual)) };
  });
  chk('El modal propone también una fecha válida por defecto', modal.abierto && modal.valida, JSON.stringify(modal));

  const regInvalida = await p.evaluate(() => {
    const f = document.getElementById('regFechaRecuentoInput');
    f.value = '2026-09-22'; _pintarAvisoFechaRegistrar();
    return document.getElementById('regFechaRecuentoBtnGuardar').disabled;
  });
  chk('Fuera de domingo/fin de mes, "Guardar" se deshabilita', regInvalida);

  const guardar = await p.evaluate(async () => {
    const f = document.getElementById('regFechaRecuentoInput');
    f.value = '2026-09-20'; // domingo
    _pintarAvisoFechaRegistrar();
    const disabledAntes = document.getElementById('regFechaRecuentoBtnGuardar').disabled;
    await confirmarRegistrarFechaRecuento();
    return { disabledAntes, updates: window.__updates.slice(),
             cerrado: document.getElementById('regFechaRecuentoModal').classList.contains('hidden'),
             av: window.__avisos.slice() };
  });
  chk('Con domingo, "Guardar" está habilitado', !guardar.disabledAntes);
  chk('★ Guardar escribe SOLO fechaRecuento y semanaId, nada más',
      guardar.updates.length === 1
        && guardar.updates[0].fechaRecuento === '2026-09-20'
        && guardar.updates[0].semanaId === '2026-09-14'
        && Object.keys(guardar.updates[0]).length === 2,
      JSON.stringify(guardar.updates));
  chk('El modal se cierra y avisa del éxito', guardar.cerrado && guardar.av.some(m => /registrada/.test(m)));

  // Carrera: entre abrir el modal y pulsar Guardar, otro admin ya le puso
  // fecha (o alguien cerró el inventario). No se confía en la memoria: se
  // relee el servidor antes de escribir.
  const yaTenia = await p.evaluate(async () => {
    window.__updates = []; window.__avisos = [];
    window.__fakeSnap = { estado: 'SINCRONIZADO', fechaRecuento: '2026-09-13' }; // otro ya la puso
    _inventarioActivo.fechaRecuento = undefined; // en memoria seguía "sin fecha"
    document.getElementById('regFechaRecuentoInput').value = '2026-09-20';
    await confirmarRegistrarFechaRecuento();
    return { updates: window.__updates.slice(), av: window.__avisos.slice() };
  });
  chk('★ Si el servidor ya tenía fecha, NO se sobrescribe (se relee antes de escribir)',
      yaTenia.updates.length === 0 && yaTenia.av.some(m => /Ya tenía/.test(m)), JSON.stringify(yaTenia));

  const yaCerrado = await p.evaluate(async () => {
    window.__updates = []; window.__avisos = [];
    window.__fakeSnap = { estado: 'CERRADO' }; // se cerró justo antes de guardar
    document.getElementById('regFechaRecuentoInput').value = '2026-09-20';
    await confirmarRegistrarFechaRecuento();
    return { updates: window.__updates.slice(), av: window.__avisos.slice() };
  });
  chk('★ Si ya se cerró entre medias, tampoco se escribe (FASE 7: nada retroactivo)',
      yaCerrado.updates.length === 0 && yaCerrado.av.some(m => /ya no está abierto/.test(m)), JSON.stringify(yaCerrado));

  // Con la fecha ya registrada, el aviso y el botón desaparecen del encabezado.
  const conFecha = await p.evaluate(() => {
    _inventarioActivo = { numero: 7, estado: 'SINCRONIZADO', fechaCreacion: Date.now(),
                           fechaRecuento: '2026-09-20', creadoPorNombre: 'Eduardo', creadoPorRol: 'ADMIN' };
    renderTab();
    const t = document.getElementById('tabContent');
    return { txt: t.innerText.replace(/\s+/g, ' '),
             hayBtn: !!t.querySelector('button[onclick="abrirModalRegistrarFechaRecuento()"]') };
  });
  chk('Con fechaRecuento ya registrada, se muestra normal y no se vuelve a ofrecer el botón',
      /Recuento: 2026-09-20/.test(conFecha.txt) && !conFecha.hayBtn, conFecha.txt.slice(0, 200));

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── H-40 (hotfix 4.9) · fecha de recuento, en la app real ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
