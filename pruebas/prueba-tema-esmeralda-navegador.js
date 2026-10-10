// Tema Verde Esmeralda (v5.25) — se mide en Chromium contra la app real, en claro, oscuro y tablet.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const PUERTO = process.env.PUERTO || '8080';
async function abrir(nav, tema, W, H) {
  const ctx = await nav.newContext({ viewport: { width: W, height: H } });
  if (tema) await ctx.addInitScript(t => { try { localStorage.setItem('inventarioApp_theme', t); localStorage.setItem('inventarioApp_temaMarca', 'esmeralda'); } catch (e) {} }, tema);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(900);
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.roleId = 'ADMIN'; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    const P = (id, name, group) => ({ id, name, group, unit: 'PZA', stockMinimo: 2, stockByArea: { almacen: 3 } });
    products = [P('JWB', 'JOHNNIE WALKER BLACK', 'WHISKY'), P('TQL', 'TANQUERAY LONDON DRY', 'GINEBRA'), P('DJ7', 'DON JULIO 70', 'TEQUILA'), P('APR', 'APEROL', 'LICORES'), P('ACE', 'ACEITUNA', 'ABARROTES')];
    _auditoriaSessionId = 'S1'; _inventarioActivoCarga = 'ok';
    _inventarioActivo = { numero: 12, estado: 'SINCRONIZADO', fechaCreacion: Date.now(), creadoPorNombre: 'Eduardo', creadoPorRol: 'ADMIN', fechaRecuento: '2026-10-09', semanaId: '2026-10-05', warehousesSnapshot: ['almacen', 'barra1', 'barra2'] };
    auditoriaStatus = { almacen: 'completada', barra1: 'en_progreso', barra2: 'pendiente' };
    activeTab = 'inicio'; renderTab();
  });
  await p.waitForTimeout(400);
  return { p, errs };
}
// luminancia relativa de un rgb(...) para comparar "oscuro" vs "claro"
const lum = s => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || ''); if (!m) return -1; return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255; };
(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  for (const tema of ['light', 'dark']) {
    const { p, errs } = await abrir(nav, tema, 390, 844);
    const m = await p.evaluate(() => {
      const cs = (e, k) => getComputedStyle(e)[k];
      const sb = document.getElementById('sidebar'), hero = document.querySelector('.it-inv'), hd = document.querySelector('.sticky.top-0'), h1 = hd.querySelector('h1');
      const mono = [...document.querySelectorAll('.bi-mono')];
      return { tema: document.documentElement.getAttribute('data-theme'), sbBg: cs(sb, 'backgroundColor'), sbItem: cs(sb.querySelector('.sb-item:not(.sb-active)'), 'color'),
        sbActivoBg: cs(sb.querySelector('.sb-item.sb-active'), 'backgroundColor'), sbActivoColor: cs(sb.querySelector('.sb-item.sb-active'), 'color'),
        sbMuted: cs(sb.querySelector('#sbFoot p'), 'color'),
        heroBg: hero && cs(hero, 'backgroundColor'), heroColor: hero && cs(hero, 'color'), hd: Math.round(hd.getBoundingClientRect().height),
        h1Fuente: cs(h1, 'fontFamily'), cuerpo: cs(document.body, 'fontFamily'), fuentesOk: document.fonts && [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + f.weight),
        sombraCerrada: cs(sb, 'boxShadow'), monoClases: mono.map(x => x.className), body: cs(document.body, 'backgroundColor') };
    });
    const T = '[' + tema + '] ';
    chk(T + '★ La barra lateral es Noche Profunda (#101E18) en este tema', m.sbBg === 'rgb(16, 30, 24)', m.sbBg);
    chk(T + 'Sus textos son claros sobre fondo oscuro (luminancia > .6)', lum(m.sbItem) > 0.6 && lum(m.sbMuted) > 0.45, m.sbItem + ' / ' + m.sbMuted);
    chk(T + '★ El destino activo es esmeralda #10664A con texto blanco', m.sbActivoBg === 'rgb(16, 102, 74)' && m.sbActivoColor === 'rgb(255, 255, 255)', m.sbActivoBg + ' / ' + m.sbActivoColor);
    chk(T + '★ La tarjeta principal es verde (#10664A en claro, más oscura en el oscuro) con texto blanco', m.heroBg && lum(m.heroBg) < 0.4 && m.heroBg !== 'rgba(0, 0, 0, 0)' && m.heroColor === 'rgb(255, 255, 255)', m.heroBg + ' / ' + m.heroColor);
    chk(T + '★ El encabezado mide 48 px', m.hd === 48, String(m.hd));
    chk(T + '★ Títulos en Manrope y cuerpo en DM Sans', /Manrope/.test(m.h1Fuente) && /DM Sans/.test(m.cuerpo), m.h1Fuente + ' | ' + m.cuerpo);
    chk(T + '★ Las fuentes propias se descargan del servidor (no caen a la del sistema)', m.fuentesOk && m.fuentesOk.some(f => /Manrope/.test(f)) && m.fuentesOk.some(f => /DM Sans/.test(f)), JSON.stringify(m.fuentesOk));
    chk(T + 'Cerrada, la barra lateral no proyecta sombra al borde', m.sombraCerrada === 'none', m.sombraCerrada);
    chk(T + '★ El tema respeta la elección guardada', m.tema === tema, String(m.tema));
    chk(T + 'Sin errores de JS', errs.length === 0, errs.join(' | '));
    await p.context().close();
  }
  // Monogramas por categoría (Productos)
  {
    const { p } = await abrir(nav, 'light', 390, 844);
    const r = await p.evaluate(() => ({ w: UI.mono('JOHNNIE WALKER', 'WHISKY'), g: UI.mono('TANQUERAY', 'GINEBRA'), t: UI.mono('DON JULIO', 'TEQUILA'), l: UI.mono('APEROL', 'LICORES'), x: UI.mono('ACEITUNA', 'ABARROTES') }));
    chk('★ UI.mono pinta whisky=morado, ginebra=azul, tequila=índigo, licores=celeste', /--whisky/.test(r.w) && /--gin/.test(r.g) && /--dest/.test(r.t) && /--lic/.test(r.l), JSON.stringify(r));
    chk('Un grupo sin categoría conserva el tinte por hash (no se rompe)', /bi-mono--(laton|neutro|info|ok|book)/.test(r.x), r.x);
    const col = await p.evaluate(() => { const d = document.createElement('div'); d.innerHTML = UI.mono('JW', 'WHISKY'); document.body.appendChild(d); const e = d.firstChild; const c = getComputedStyle(e); const o = { bg: c.backgroundColor, fg: c.color }; d.remove(); return o; });
    chk('El pastel de whisky es un morado claro con texto morado oscuro', lum(col.bg) > 0.85 && lum(col.fg) < 0.35, JSON.stringify(col));
    await p.context().close();
  }
  // Tablet: barra lateral fija
  for (const tema of ['light', 'dark']) {
    const { p, errs } = await abrir(nav, tema, 1180, 820);
    const t = await p.evaluate(() => {
      const sb = document.getElementById('sidebar'), r = sb.getBoundingClientRect(), main = document.getElementById('mainContent').getBoundingClientRect();
      const vis = id => { const e = document.getElementById(id); return e ? getComputedStyle(e).display !== 'none' : false; };
      return { x: Math.round(r.left), w: Math.round(r.width), mainX: Math.round(main.left), ham: vis('hamburgerBtn'), bar: vis('bottomTabBar'), velo: vis('sbOverlay'),
        scroll: document.documentElement.scrollWidth > window.innerWidth };
    });
    const T = '[tablet ' + tema + '] ';
    chk(T + '★ La barra lateral está siempre visible (264 px a la izquierda)', t.x === 0 && t.w === 264, JSON.stringify(t));
    chk(T + 'El contenido empieza a la derecha de la barra y no se solapa', t.mainX >= 264, JSON.stringify(t));
    chk(T + 'Se ocultan hamburguesa, barra inferior y velo', !t.ham && !t.bar && !t.velo, JSON.stringify(t));
    chk(T + 'Sin desplazamiento horizontal', !t.scroll && errs.length === 0, errs.join(' | '));
    await p.context().close();
  }
  // Migración de una sola vez: sin marca → claro; con marca y 'dark' → oscuro
  {
    const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('_sembrado')) { localStorage.setItem('inventarioApp_theme', 'dark'); sessionStorage.setItem('_sembrado', '1'); } } catch (e) {} });
    const p = await ctx.newPage();
    await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' }); await p.waitForTimeout(500);
    const a = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
    chk('★ Un dispositivo con tema oscuro viejo y sin marca pasa UNA vez a claro', a === 'light', String(a));
    await p.evaluate(() => localStorage.setItem('inventarioApp_theme', 'dark'));
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(500);
    const b = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
    chk('★ Después de la migración se respeta su elección (oscuro se queda oscuro)', b === 'dark', String(b));
    await ctx.close();
  }
  await nav.close();
  const w = Math.max.apply(null, C.map(c => c.n.length)); let f = 0;
  console.log('\n  ── Tema Verde Esmeralda v5.25 (navegador) ──\n');
  C.forEach(c => { if (!c.ok) f++; console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)); });
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - f) + ' pasaron · ' + f + ' fallaron\n');
  process.exit(f ? 1 : 0);
})();
