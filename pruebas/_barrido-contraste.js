// Barrido de contraste (exploratorio, R8): recorre cada pestaña en oscuro y claro y lista todo
// texto visible que no llega a 4.5:1 (3:1 si es grande). No es una prueba: es el mapa de trabajo.
const { chromium } = require('playwright');
const PUERTO = process.env.PUERTO || '8080';
(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'adm1'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']); _authzState.roleId = 'ADMIN';
    const g = ['TEQUILA', 'RON', 'WHISKY', 'VODKA'];
    products = []; for (let i = 0; i < 24; i++) products.push({ id: 'P' + i, name: g[i % 4] + ' MARCA ' + i, unit: 'Botellas', group: g[i % 4], precio: 300 + i, stockMinimo: 4, conversion: 750, stockByArea: { almacen: i % 7, barra1: 1, barra2: 0 } });
    recetas = [{ id: 'r1', pv: 'PV1', nombre: 'MARGARITA', activa: true, ingredientes: [{ productoId: 'P0', cantidad: 0.06, uom: 'PZA' }] }];
    ventas = [{ sku: 'PV1', nombre: 'Margarita', cantidad: 7 }]; ventasSemanaId = semanaId(new Date()); ventasPeriodos = [{ inicio: ventasSemanaId, fin: ventasSemanaId }];
    _notificaciones = [{ id: 'n1', tipo: 'ajuste', texto: 'Ajuste solicitado', creadoEn: Date.now(), leido: false }];
    _ajustes = []; orders = [];
    window.__rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
    window.__lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    window.__bg = (el) => { const ch = []; for (let e = el; e; e = e.parentElement) ch.push(e); let base = [255, 255, 255]; for (let i = ch.length - 1; i >= 0; i--) { const c = window.__rgb(getComputedStyle(ch[i]).backgroundColor); if (c.length < 3) continue; const a = c.length === 4 ? c[3] : 1; if (a > 0) base = [0, 1, 2].map(k => c[k] * a + base[k] * (1 - a)); } return base; };
  });
  const tabs = ['inicio', 'productos', 'pedidos', 'inventario', 'compras', 'recetario', 'ventas', 'historia', 'ajustes', 'notificaciones', 'admin'];
  const agg = {};
  for (const tema of ['dark', 'light']) {
    await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), tema);
    for (const tab of tabs) {
      await p.evaluate(t => { try { activeTab = t; renderTab(); } catch (e) {} }, tab);
      await p.waitForTimeout(250);
      const fallos = await p.evaluate(() => {
        const out = [];
        const root = document.getElementById('tabContent') || document.body;
        const els = [...root.querySelectorAll('*')];
        els.forEach(el => {
          const tieneTexto = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
          if (!tieneTexto) return;
          const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
          const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
          if (el.closest('[disabled],[aria-disabled="true"]')) return;
          const fg = window.__rgb(cs.color); const a = fg.length === 4 ? fg[3] : 1;
          const bg = window.__bg(el); const f3 = fg.slice(0, 3).map((v, k) => v * a + bg[k] * (1 - a));
          const L1 = window.__lum(f3), L2 = window.__lum(bg); const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
          const px = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700; const grande = px >= 24 || (px >= 18.66 && bold);
          const min = grande ? 3 : 4.5;
          if (ratio < min) out.push({ sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), ratio: +ratio.toFixed(2), px, txt: el.textContent.trim().slice(0, 28) });
        });
        return out;
      });
      fallos.forEach(f => { const k = tema + '|' + tab + '|' + f.sel; const a = agg[k] || (agg[k] = { n: 0, min: 99, ej: f.txt, px: f.px }); a.n++; a.min = Math.min(a.min, f.ratio); });
    }
  }
  const filas = Object.entries(agg).sort((a, b) => a[1].min - b[1].min);
  console.log('tema|pestaña|selector → ocurrencias · peor ratio · px · ejemplo');
  filas.forEach(([k, v]) => console.log(k + ' → ' + v.n + ' · ' + v.min + ' · ' + v.px + 'px · "' + v.ej + '"'));
  console.log('\nTotal de grupos con falla: ' + filas.length);
  await nav.close();
})();
