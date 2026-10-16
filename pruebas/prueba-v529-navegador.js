// v5.29 — Inicio "Midnight Bar" medido en Chromium contra la app real (390 px):
// contraste AA de TODO el texto de Inicio en tema claro y oscuro, y que las
// demás pestañas, el encabezado y la barra inferior conserven su tema.
//   npm run test:v529nav      (requiere el servidor local en PUERTO, 8080)
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
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.roleId = 'ADMIN';
    _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = [
      { id: '1180001', name: 'TEQUILA DON JULIO 70 700 ML', unit: 'PZA', group: 'TEQUILA', capacidadMl: 700, precio: 820, stockMinimo: 12, conversion: 1, stockByArea: { almacen: 2, barra1: 1 } },
      { id: '2210010', name: 'CERVEZA CORONA 355 ML', unit: 'PZA', group: 'CERVEZA', precio: 22, stockMinimo: 60, conversion: 1, stockByArea: { almacen: 48 } },
      { id: '1020064', name: 'LIMON PERSA', unit: 'KGS', group: 'FRUTA', precio: 32, stockMinimo: 10, conversion: 1, stockByArea: { almacen: 14 } }];
    _auditoriaSessionId = 'S7'; _inventarioActivoCarga = 'ok';
    _inventarioActivo = { numero: 7, estado: 'SINCRONIZADO', fechaCreacion: Date.now(), creadoPorNombre: 'Eduardo', creadoPorRol: 'ADMIN', fechaRecuento: '2026-10-18', semanaId: '2026-10-12', warehousesSnapshot: ['almacen', 'barra1', 'barra2'] };
    auditoriaStatus = { almacen: 'completada', barra1: 'en_progreso', barra2: 'pendiente' };
  });
  await p.addScriptTag({ content: `
    window.__rgb = s => (s.match(/[\\d.]+/g) || []).map(Number);
    window.__lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    // Fondo efectivo: compone las capas translúcidas hasta el fondo de #mainContent (o del body).
    window.__fondo = el => {
      const capas = [];
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e), c = __rgb(cs.backgroundColor);
        if (c.length && (c.length < 4 || c[3] > 0)) capas.push(c);
        if (cs.backgroundImage && cs.backgroundImage !== 'none' && /gradient/.test(cs.backgroundImage)) {
          const m = cs.backgroundImage.match(/rgba?\\([^)]*\\)/g) || []; const ult = m.length ? __rgb(m[m.length - 1]) : null;
          if (ult) { capas.push(ult.slice(0, 3)); break; }
        }
        if (c.length && (c.length < 4 || c[3] >= 1)) break;
      }
      let base = [255, 255, 255];
      for (let i = capas.length - 1; i >= 0; i--) { const c = capas[i], a = c.length === 4 ? c[3] : 1; base = base.map((b, k) => c[k] * a + b * (1 - a)); }
      return base;
    };
    window.__contraste = raiz => {
      const malos = [];
      raiz.querySelectorAll('*').forEach(el => {
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
        const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
        const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('.sbx-sr, .if-badge-pre, [aria-hidden="true"]')) return;
        if (cs.position === 'absolute' && cs.clip && cs.clip !== 'auto') return;
        const fg = __rgb(cs.color), a = fg.length === 4 ? fg[3] : 1, bg = __fondo(el);
        const f3 = fg.slice(0, 3).map((v, k) => v * a + bg[k] * (1 - a));
        const L1 = __lum(f3), L2 = __lum(bg), ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
        const px = parseFloat(cs.fontSize), min = (px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700)) ? 3 : 4.5;
        if (ratio < min) malos.push((el.className || el.tagName).toString().slice(0, 40) + ' "' + el.textContent.trim().slice(0, 20) + '" ' + ratio.toFixed(2));
      });
      return malos;
    };` });

  for (const tema of ['dark', 'light']) {
    await p.evaluate(t => { applyTheme(t); activeTab = 'inicio'; renderTab(); }, tema);
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => {
      const main = document.getElementById('mainContent'), cs = getComputedStyle(main);
      const tarjeta = document.querySelector('#tabContent .pm-tile');
      return {
        clase: document.documentElement.classList.contains('vista-inicio'),
        fondo: cs.backgroundImage, oro: getComputedStyle(document.querySelector('.pm-tile--dinero .pm-tile__val')).color,
        borde: getComputedStyle(tarjeta).borderTopColor, malos: __contraste(document.getElementById('tabContent')),
        sw: document.documentElement.scrollWidth, hdTema: getComputedStyle(document.querySelector('.sticky.top-0')).backgroundColor
      };
    });
    chk('[' + tema + '] Inicio activa html.vista-inicio y el fondo radial oscuro', r.clase && /radial-gradient/.test(r.fondo), JSON.stringify(r).slice(0, 300));
    chk('[' + tema + '] Valor en existencia en dorado y tarjetas con borde dorado translúcido', r.oro === 'rgb(200, 169, 106)' && /rgba\(200, 169, 106/.test(r.borde), r.oro + ' / ' + r.borde);
    chk('[' + tema + '] ★ Todo el texto de Inicio con contraste AA (4.5:1; 3:1 en texto grande)', r.malos.length === 0, r.malos.slice(0, 8).join(' | '));
    chk('[' + tema + '] Sin desplazamiento horizontal', r.sw <= 390, String(r.sw));
    // Otra pestaña: se quita la clase y vuelve el tema de siempre.
    const otra = await p.evaluate(() => {
      activeTab = 'productos'; renderTab();
      const main = document.getElementById('mainContent');
      return { clase: document.documentElement.classList.contains('vista-inicio'), fondo: getComputedStyle(main).backgroundImage,
               card: getComputedStyle(main).getPropertyValue('--card').trim(), raiz: getComputedStyle(document.documentElement).getPropertyValue('--card').trim() };
    });
    chk('[' + tema + '] ★ Productos (otra pestaña) vuelve al tema de siempre: sin clase, sin fondo y con sus tokens',
        !otra.clase && otra.fondo === 'none' && otra.card === otra.raiz, JSON.stringify(otra));
  }
  chk('Sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  await nav.close();

  console.log('\n  ── v5.29 · Inicio "Midnight Bar" (navegador) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + (c.d || ''))));
  const f = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - f) + ' pasaron · ' + f + ' fallaron\n');
  process.exit(f ? 1 : 0);
})();
