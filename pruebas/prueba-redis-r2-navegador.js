// REDISEÑO R2 en la app real (Chromium): hay UNA navegación visible, el
// destino activo se ve y se anuncia, y los 11 módulos siguen alcanzables.
//
// Lo que esta prueba protege y la estática no puede: que no quede ningún
// botón de navegación VISIBLE fuera de la barra inferior y de la hoja "Más"
// (la estática solo ve el HTML; aquí se mide qué está realmente en pantalla),
// y que el color activo sea el latón calculado, no un azul heredado.
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
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1100);
  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['*']);
    products = [{ id: 'A', name: 'ACEITUNA SIN HUESO', group: 'ABARROTES', unit: 'KGS', stockByArea: {} }];
    allUsersAuditoria = {}; _inventarioActivo = null;
    switchTab('inicio');
  });

  // ── A · Una sola navegación visible ────────────────────────────────────
  const navs = await p.evaluate(() => {
    // "Visible" se mide por posición EN PANTALLA, no por offsetParent: la
    // hoja "Más" se aparta con transform y en ese caso sigue teniendo
    // offsetParent, así que una comprobación ingenua la cuenta como visible
    // cuando el usuario no la ve. (Primera versión de esta prueba: falso
    // positivo con 10 ítems "visibles" del panel cerrado.)
    const enPantalla = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 &&
             r.right > 0 && r.left < window.innerWidth &&
             r.bottom > 0 && r.top < window.innerHeight;
    };
    const candidatos = [...document.querySelectorAll('[data-btab], [data-sb-tab], [data-tab], .tab-btn')];
    const visibles = candidatos.filter(enPantalla);
    const porTipo = {};
    visibles.forEach(el => {
      const tipo = el.hasAttribute('data-btab') ? 'barra-inferior'
                 : el.hasAttribute('data-sb-tab') ? 'hoja-mas'
                 : 'otra';
      porTipo[tipo] = (porTipo[tipo] || 0) + 1;
    });
    // El botón "Más" no lleva data-btab (abre la hoja, no cambia de pestaña),
    // así que la barra aporta 4 destinos + ese botón.
    const botonesBarra = [...document.getElementById('bottomTabBar').querySelectorAll('button')].filter(enPantalla).length;
    return { porTipo, botonesBarra, hojaAbierta: document.getElementById('sidebar').classList.contains('sb-open') };
  });
  chk('★ Con la app en reposo, la ÚNICA navegación en pantalla es la barra inferior',
      navs.porTipo['barra-inferior'] === 4 && navs.botonesBarra === 5 &&
      !navs.porTipo['hoja-mas'] && !navs.porTipo['otra'] && navs.hojaAbierta === false,
      JSON.stringify(navs));
  chk('★ No queda ningún botón de la barra horizontal retirada',
      await p.evaluate(() => document.querySelectorAll('.tab-btn, #tabs').length === 0));

  // ── B · El destino activo se ve Y se anuncia ───────────────────────────
  const activo = await p.evaluate(() => {
    const a = document.querySelector('#bottomTabBar .btab-active');
    if (!a) return { falta: true };
    const span = a.querySelector('span'), svg = a.querySelector('svg');
    return {
      destino: a.dataset.btab,
      aria: a.getAttribute('aria-current'),
      colorTexto: span ? getComputedStyle(span).color : null,
      colorIcono: svg ? getComputedStyle(svg).stroke : null,
      cuantosActivos: document.querySelectorAll('#bottomTabBar .btab-active').length
    };
  });
  chk('Hay exactamente un destino activo, y es Inicio',
      activo.destino === 'inicio' && activo.cuantosActivos === 1, JSON.stringify(activo));
  chk('★ El destino activo es latón calculado (no un azul heredado)',
      activo.colorTexto === 'rgb(232, 181, 92)' && activo.colorIcono === 'rgb(232, 181, 92)',
      JSON.stringify(activo));
  chk('★ El activo lleva aria-current="page" (el color solo no informa)',
      activo.aria === 'page', 'aria-current: ' + activo.aria);

  // ── C · Cambiar de pestaña mueve el activo y lo anuncia ────────────────
  const tras = await p.evaluate(() => {
    switchTab('pedidos');
    const a = document.querySelector('#bottomTabBar .btab-active');
    const conAria = [...document.querySelectorAll('#bottomTabBar [aria-current]')].map(x => x.dataset.btab);
    const sbActivo = [...document.querySelectorAll('.sb-item.sb-active')].map(x => x.dataset.sbTab);
    return { activo: a ? a.dataset.btab : null, conAria, sbActivo, tab: activeTab };
  });
  chk('Cambiar de pestaña mueve el activo en la barra inferior',
      tras.activo === 'pedidos' && tras.tab === 'pedidos', JSON.stringify(tras));
  chk('…y solo uno queda con aria-current', tras.conAria.length === 1 && tras.conAria[0] === 'pedidos',
      JSON.stringify(tras.conAria));
  chk('★ La hoja "Más" refleja el mismo destino (no se desincroniza)',
      tras.sbActivo.length === 1 && tras.sbActivo[0] === 'pedidos', JSON.stringify(tras.sbActivo));

  // ── D · Un módulo que NO está en la barra sigue alcanzable y marcado ───
  const porMas = await p.evaluate(() => {
    switchTab('recetario');
    const enBarra = !!document.querySelector('#bottomTabBar [data-btab="recetario"]');
    const sb = document.querySelector('.sb-item[data-sb-tab="recetario"]');
    const activoBarra = document.querySelector('#bottomTabBar .btab-active');
    return {
      enBarra,
      sbMarcado: sb ? sb.classList.contains('sb-active') : null,
      sbAria: sb ? sb.getAttribute('aria-current') : null,
      barraSinActivo: !activoBarra,
      tab: activeTab,
      pinta: document.getElementById('tabContent').innerText.trim().length > 20
    };
  });
  chk('Recetario no está en la barra inferior, pero se alcanza por "Más"',
      porMas.enBarra === false && porMas.tab === 'recetario' && porMas.pinta, JSON.stringify(porMas));
  chk('★ Al estar en un módulo de "Más", la hoja lo marca y la barra no miente',
      porMas.sbMarcado === true && porMas.sbAria === 'page' && porMas.barraSinActivo === true,
      JSON.stringify(porMas));

  // ── E · La hoja "Más" abre con los 11 módulos ──────────────────────────
  const hoja = await p.evaluate(() => {
    sbOpen();
    const items = [...document.querySelectorAll('.sb-item')].filter(el => el.offsetParent !== null);
    const r = { visibles: items.length, destinos: items.map(x => x.dataset.sbTab).filter(Boolean) };
    sbClose();
    return r;
  });
  chk('La hoja "Más" muestra los módulos al abrirse',
      hoja.visibles >= 10 && hoja.destinos.includes('recetario') && hoja.destinos.includes('ventas'),
      JSON.stringify(hoja.destinos));

  // ── F · Barra inferior sobre tokens, no colores fijos ──────────────────
  const barra = await p.evaluate(() => {
    const b = document.getElementById('bottomTabBar');
    const cs = getComputedStyle(b);
    return { fondo: cs.backgroundColor, alto: b.getBoundingClientRect().height,
             tocables: [...b.querySelectorAll('button')].every(x => x.getBoundingClientRect().height >= 44) };
  });
  chk('La barra inferior usa la superficie del tema (#15181D), no un color fijo',
      barra.fondo === 'rgb(21, 24, 29)', 'fondo: ' + barra.fondo);
  chk('Todos sus controles son táctiles (≥ 44 px)', barra.tocables, 'alto barra: ' + barra.alto);

  // ── G · El glosario de estados usa los badges del kit ──────────────────
  const glos = await p.evaluate(() => {
    if (typeof _pillEstadoInventario !== 'function') return { falta: true };
    const caja = document.createElement('div');
    caja.innerHTML = _pillEstadoInventario('SINCRONIZADO') +
                     _pillEstadoInventario('CONTABILIZADO') +
                     _pillEstadoInventario('LO_QUE_SEA');
    document.body.appendChild(caja);
    const badges = [...caja.querySelectorAll('.bi-badge')];
    const r = {
      cuantos: badges.length,
      textos: badges.map(b => b.textContent.trim()),
      colorContab: badges[1] ? getComputedStyle(badges[1]).color : null,
      desconocido: badges[2] ? getComputedStyle(badges[2]).color : null
    };
    caja.remove();
    return r;
  });
  chk('★ El glosario pinta badges del kit, no su propia píldora',
      glos.cuantos === 3 && glos.textos[0] === 'Sincronizado', JSON.stringify(glos.textos));
  chk('"Contabilizado" usa el lila del estado contable, no el morado de Tailwind',
      glos.colorContab === 'rgb(201, 160, 232)', 'color: ' + glos.colorContab);
  chk('Un estado desconocido sale en gris, con su texto tal cual',
      glos.textos[2] === 'LO_QUE_SEA' && glos.desconocido === 'rgb(180, 176, 170)',
      JSON.stringify(glos));

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── REDISEÑO R2 · una sola navegación (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
