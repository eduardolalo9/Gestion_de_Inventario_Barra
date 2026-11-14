// REDISEÑO R7b — Compras (y Pedidos, revisado), en pantalla real (Chromium).
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
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
  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['*']); // admin: purchases.read/import/create
    products = [
      { id: 'P1', name: 'TEQUILA DON JULIO', unit: 'Botellas', group: 'Premium', precio: 410.5 }
    ];
    orders = [];
  });

  // ══ A · COMPRAS — VACÍO: icono real, sin emoji ══════════════════════════
  await p.evaluate(() => { activeTab = 'compras'; renderTab(); });
  await p.waitForTimeout(150);
  const vacio = await p.evaluate(() => {
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const cont = document.getElementById('tabContent');
    const ico = cont.querySelector('.fa-receipt');
    return {
      emoji: (cont.innerText.match(re) || []).join(' '),
      icoAncho: ico ? ico.getBoundingClientRect().width : 0,
      texto: cont.innerText.slice(0, 200)
    };
  });
  chk('★ El vacío de Compras no tiene emoji (antes: 📦) y el icono fa-receipt tiene ancho real',
      vacio.emoji === '' && vacio.icoAncho >= 6, JSON.stringify(vacio));

  // ══ B · VISTA PREVIA — precio de lista (aviso ámbar), incidencia, costo distinto ══
  await p.evaluate(() => {
    comprasImportView = 'vista_previa';
    _comprasImportPendiente = {
      grupos: [{
        compraId: 'c1', proveedorNombre: 'DISTRIBUIDORA EL ÁGUILA', proveedorCodigo: 'PROV-01',
        fecha: '2026-10-01', fechaInvalida: false, folio: '3646', docSap: '27615',
        totalLineas: 2, importe: 1250.75,
        incidencias: ['sku no encontrado'],
        lineas: [{ productoId: 'P1', enCatalogo: true, costoUnitario: 450 }] // 450 vs 410.5 catálogo → ~9.6%
      }]
    };
    renderTab();
  });
  await p.waitForTimeout(150);
  const vp = await p.evaluate(() => {
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const cont = document.getElementById('tabContent');
    const avisoListaBg = (function() {
      const divs = [...cont.querySelectorAll('div')];
      const cand = divs.filter(x => /costo que trae este archivo/.test(x.textContent) && x.querySelector('i.fa-triangle-exclamation'));
      const d = cand.find(x => !cand.some(y => y !== x && x.contains(y)));
      return d ? getComputedStyle(d).backgroundColor : null;
    })();
    const confirmarBtn = [...cont.querySelectorAll('button')].find(b => /Confirmar e importar/.test(b.textContent));
    return {
      emoji: (cont.innerText.match(re) || []).join(' '),
      avisoListaBg,
      confirmarFondo: confirmarBtn ? getComputedStyle(confirmarBtn).backgroundColor : null,
      coinsIco: !!cont.querySelector('.fa-coins'),
      triangleCount: cont.querySelectorAll('.fa-triangle-exclamation').length,
      texto: cont.innerText.slice(0, 300)
    };
  });
  chk('★ La vista previa no tiene emoji (antes: ⚠️ ×2, 💲)', vp.emoji === '', vp.texto);
  chk('★ El aviso de "precio de lista" tiene un fondo ámbar real (no transparente)',
      vp.avisoListaBg && vp.avisoListaBg !== 'rgba(0, 0, 0, 0)', vp.avisoListaBg);
  chk('★ "Confirmar e importar" tiene un fondo verde real (var(--ok-dim)), no transparente',
      vp.confirmarFondo && vp.confirmarFondo !== 'rgba(0, 0, 0, 0)', vp.confirmarFondo);
  chk('★ "Costo distinto al catálogo" (9.6% sobre el precio) se muestra con fa-coins',
      vp.coinsIco, '');
  chk('Hay dos triángulos de advertencia (el aviso general + la incidencia del grupo)',
      vp.triangleCount === 2, String(vp.triangleCount));

  // ══ C · FECHA INVÁLIDA — aviso rojo con fa-circle-exclamation ═══════════
  await p.evaluate(() => {
    _comprasImportPendiente.grupos[0].fechaInvalida = true;
    renderTab();
  });
  await p.waitForTimeout(150);
  const fechaInv = await p.evaluate(() => {
    const cont = document.getElementById('tabContent');
    const ico = cont.querySelector('.fa-circle-exclamation');
    const d = ico ? ico.closest('div') : null;
    return {
      icoAncho: ico ? ico.getBoundingClientRect().width : 0,
      fondo: d ? getComputedStyle(d).backgroundColor : null,
      sinConfirmar: ![...cont.querySelectorAll('button')].some(b => /Confirmar e importar/.test(b.textContent)),
      btnDisabled: (function() { const b = [...cont.querySelectorAll('button')].find(x => /Confirmar e importar/.test(x.textContent)); return b ? b.disabled : null; })(),
      motivo: /(Elige la fecha de ingreso|No queda ninguna entrada nueva|Sin verificación de duplicados)/.test(cont.innerText)
    };
  });
  chk('★ Fecha inválida: aviso con fa-circle-exclamation de ancho real y fondo rojo real',
      fechaInv.icoAncho >= 6 && fechaInv.fondo && fechaInv.fondo !== 'rgba(0, 0, 0, 0)', JSON.stringify(fechaInv));
  // Sin nada importable, "Confirmar e importar" aparece DESHABILITADO y la
  // pantalla dice por qué (diseño actual de la vista previa). No se puede pulsar.
  chk('Sin entradas guardables (todas con fecha inválida): Confirmar queda deshabilitado y explica por qué',
      fechaInv.btnDisabled === true && fechaInv.motivo === true, JSON.stringify({ d: fechaInv.btnDisabled, m: fechaInv.motivo }));

  // Caso mixto: un grupo válido y uno inválido. El válido se puede importar y el
  // inválido se identifica para corregirlo, sin bloquear al válido.
  await p.evaluate(() => {
    const base = _comprasImportPendiente.grupos[0];
    const valido = Object.assign({}, base, { compraId: 'c2', folio: '3647', fechaInvalida: false, fecha: '2026-10-02', semanaId: '2026-09-28' });
    _comprasImportPendiente.grupos = [valido, base];
    // Estado que deja la verificación real de duplicados (ver prueba-importacion-mixta-integracion.js):
    // sin verificación completa el botón queda bloqueado a propósito.
    _comprasImportPendiente.fechaIngreso = '2026-10-05';
    _comprasImportPendiente.verificando = false;
    _comprasImportPendiente.verificacionCompleta = true;
    renderTab();
  });
  await p.waitForTimeout(150);
  const mixta = await p.evaluate(() => {
    const cont = document.getElementById('tabContent');
    const b = [...cont.querySelectorAll('button')].find(x => /Confirmar e importar/.test(x.textContent));
    return { texto: b ? b.textContent.trim() : null, disabled: b ? b.disabled : null,
             identificaInvalido: /sin fecha válida/.test(cont.innerText) };
  });
  chk('Mezcla válido + inválido: se ofrece importar 1 entrada (no se bloquea por el inválido)',
      mixta.disabled === false && /\(1\)/.test(mixta.texto || ''), JSON.stringify(mixta));
  chk('Mezcla válido + inválido: el grupo inválido queda identificado como "sin fecha válida"',
      mixta.identificaInvalido === true, JSON.stringify(mixta));

  // ══ D · RESULTADO CON FALLIDAS — aviso rojo real ═════════════════════════
  await p.evaluate(() => {
    comprasImportView = 'incidencias';
    _comprasImportResultado = {
      creadas: 1, yaExistian: 0,
      fallidas: [{ folio: '9999', motivo: 'fecha no reconocible' }],
      grupos: []
    };
    renderTab();
  });
  await p.waitForTimeout(150);
  const resultado = await p.evaluate(() => {
    const cont = document.getElementById('tabContent');
    const ico = cont.innerText;
    const divFallidas = [...cont.querySelectorAll('div')].find(d => /fecha no reconocible/.test(d.textContent) && d.children.length === 0);
    const fondoFallidas = divFallidas ? getComputedStyle(divFallidas.parentElement).backgroundColor : null;
    return { fondoFallidas, texto: ico.slice(0, 200) };
  });
  chk('★ El resultado con fallidas tiene un fondo rojo real (no transparente)',
      resultado.fondoFallidas && resultado.fondoFallidas !== 'rgba(0, 0, 0, 0)', JSON.stringify(resultado));

  // ══ E · PEDIDOS — sigue en pantalla igual que siempre (sin regresión) ═══
  await p.evaluate(() => {
    orders = [{ id: 'PED-1', supplier: 'DON JULIO', date: '2026-10-01', products: [{ name: 'TEQUILA', unit: 'Botellas', quantity: 2 }], total: 2 }];
    activeTab = 'historia'; _historiaVista = 'pedidos'; renderTab();   // v5.47: los pedidos generados viven en Historia → Pedidos
  });
  await p.waitForTimeout(150);
  const pedidos = await p.evaluate(() => {
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const cont = document.getElementById('tabContent');
    return { n: cont.querySelectorAll('[data-sbx-item]').length, emoji: (cont.innerText.match(re) || []).join(' ') };
  });
  chk('Pedidos sigue mostrando su tarjeta sin emoji (no se tocó, pero se confirma sin regresión)',
      pedidos.n === 1 && pedidos.emoji === '', JSON.stringify(pedidos));

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── REDISEÑO R7b · Compras (y Pedidos, revisado) (navegador) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})();
