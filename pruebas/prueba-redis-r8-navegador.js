// REDISEÑO R8 — barrido global en pantalla real: sin desborde horizontal (390/820/1280 × oscuro/claro × 11 pestañas),
// contraste de texto, nombres accesibles, objetivos táctiles de 44 px, encabezado de Productos en celular,
// menú lateral sin comprimirse y presupuesto de rendimiento con 2 000 productos.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const TABS = ['inicio', 'productos', 'pedidos', 'inventario', 'compras', 'recetario', 'ventas', 'historia', 'ajustes', 'notificaciones', 'admin'];

async function abrir(nav, ancho) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: 844 } });
  const p = await ctx.newPage(); p.__errs = []; p.on('pageerror', e => p.__errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(900);
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'adm1'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']); _authzState.roleId = 'ADMIN';
    const g = ['TEQUILA', 'RON', 'WHISKY', 'VODKA']; products = [];
    for (let i = 0; i < 24; i++) products.push({ id: 'P' + i, name: g[i % 4] + ' MARCA ' + i, unit: 'Botellas', group: g[i % 4], precio: 300 + i, stockMinimo: 4, conversion: 750, pv: 'PV' + i, proveedor: 'DIST', stockByArea: { almacen: i % 7, barra1: 1, barra2: 0 } });
    recetas = [{ id: 'r1', pv: 'PV1', nombre: 'MARGARITA', activa: true, ingredientes: [{ productoId: 'P0', cantidad: 0.06, uom: 'PZA' }] }];
    ventas = [{ sku: 'PV1', nombre: 'Margarita', cantidad: 7 }]; ventasSemanaId = semanaId(new Date()); ventasPeriodos = [{ inicio: ventasSemanaId, fin: ventasSemanaId }];
    _notificaciones = [{ id: 'n1', tipo: 'ajuste', texto: 'Ajuste solicitado', creadoEn: Date.now(), leido: false }];
    _ajustes = [{ id: 'a1', estado: 'pendiente', productoId: 'P1', productoNombre: 'RON', motivo: 'c', creadoEn: 1, solicitanteUid: 'u2' }];
    orders = []; inventories = [];
    window.__rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
    window.__lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    window.__bg = el => { const ch = []; for (let e = el; e; e = e.parentElement) ch.push(e); let base = [255, 255, 255]; for (let i = ch.length - 1; i >= 0; i--) { const c = window.__rgb(getComputedStyle(ch[i]).backgroundColor); if (c.length < 3) continue; const a = c.length === 4 ? c[3] : 1; if (a > 0) base = [0, 1, 2].map(k => c[k] * a + base[k] * (1 - a)); } return base; };
  });
  return p;
}

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const desborde = []; const contraste = []; const sinNombre = []; const chicos = []; const idsDup = [];
  for (const ancho of [390, 820, 1280]) {
    const p = await abrir(nav, ancho);
    chk('[' + ancho + '] la app carga sin errores de JavaScript', p.__errs.length === 0, p.__errs.join(' | '));
    const estados = TABS.map(t => ({ n: t, f: "activeTab='" + t + "';renderTab();" }))
      .concat([{ n: 'sidebar', f: "activeTab='inicio';renderTab();sbOpen();" }, { n: 'modal:producto', f: "sbClose();openProductModal();" }]);
    for (const tema of ['dark', 'light']) {
      await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), tema);
      for (const e of estados) {
        await p.evaluate(new Function(e.f)); await p.waitForTimeout(280);
        const r = await p.evaluate(() => {
          const out = { desborde: null, contraste: [], nombre: [], chicos: [], ids: [] };
          const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('.hidden, [hidden], [aria-hidden="true"]'); };
          const nom = el => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(' ').map(i => (document.getElementById(i) || {}).textContent || '').join(' ') || el.getAttribute('title') || el.innerText || el.textContent || '').trim();
          const idc = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
          if (document.documentElement.scrollWidth > window.innerWidth + 1) out.desborde = document.documentElement.scrollWidth + '>' + window.innerWidth;
          document.querySelectorAll('button, a[href], [role="button"], [onclick]').forEach(el => { if (vis(el) && !nom(el) && !el.querySelector('img[alt]')) out.nombre.push(idc(el)); });
          document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach(el => {
            if (!vis(el)) return; const lab = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
            if (!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || lab || el.closest('label'))) out.nombre.push('campo ' + idc(el));
          });
          const ids = {}; document.querySelectorAll('[id]').forEach(el => { ids[el.id] = (ids[el.id] || 0) + 1; }); Object.keys(ids).filter(k => ids[k] > 1).forEach(k => out.ids.push(k));
          document.querySelectorAll('button, a[href], [role="button"], input[type=checkbox], input[type=radio], select').forEach(el => {
            if (!vis(el)) return; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
            if (r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0) return;
            if (+cs.opacity === 0 || cs.pointerEvents === 'none') return;
            if (el.matches('.sync-pill')) return;                                   // área sensible ampliada con ::before
            if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) return;   // toda la etiqueta es el objetivo
            if (el.matches('a') && el.closest('p, li, span')) return;
            const piso = el.matches('.prd-card__name, .pm-barra') ? 32 : 43.5;     // enlace-título de tarjeta / fila de gráfica
            if (r.height < piso || (r.width < 43.5 && !el.matches('input'))) out.chicos.push(idc(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
          });
          if (window.innerWidth === 390) {
            const root = document.getElementById('tabContent') || document.body;
            root.querySelectorAll('*').forEach(el => {
              if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
              const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return; const cs = getComputedStyle(el);
              if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0 || el.closest('[disabled],[aria-disabled="true"]')) return;
              const fg = window.__rgb(cs.color); const a = fg.length === 4 ? fg[3] : 1; const bg = window.__bg(el);
              const f3 = fg.slice(0, 3).map((v, k) => v * a + bg[k] * (1 - a)); const L1 = window.__lum(f3), L2 = window.__lum(bg);
              const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05); const px = parseFloat(cs.fontSize);
              const min = (px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700)) ? 3 : 4.5;
              if (ratio < min) out.contraste.push(idc(el) + ' ' + ratio.toFixed(2));
            });
          }
          return out;
        });
        const clave = ancho + '/' + tema[0] + '/' + e.n;
        if (r.desborde) desborde.push(clave + ' ' + r.desborde);
        r.contraste.forEach(x => contraste.push(clave + ' ' + x)); r.nombre.forEach(x => sinNombre.push(clave + ' ' + x));
        r.chicos.forEach(x => chicos.push(clave + ' ' + x)); r.ids.forEach(x => idsDup.push(clave + ' ' + x));
      }
    }
    if (ancho === 390) {
      // Encabezado de Productos (admin) en celular: la fila de acciones baja a su renglón y cabe entera.
      await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); activeTab = 'productos'; renderTab(); });
      await p.waitForTimeout(300);
      const h = await p.evaluate(() => {
        const bs = [...document.querySelectorAll('#headerActions .hd-btn')]; const rects = bs.map(b => b.getBoundingClientRect());
        const ha = document.getElementById('headerActions').getBoundingClientRect(); const hb = document.getElementById('hamburgerBtn').getBoundingClientRect();
        return { n: bs.length, dentro: rects.every(r => r.left >= 0 && r.right <= innerWidth), altos: rects.map(r => Math.round(r.height)), bajo: ha.top >= hb.bottom - 1,
          nombres: bs.map(b => (b.getAttribute('aria-label') || b.innerText || '').trim()), peligro: !!document.querySelector('#headerActions .hd-btn--peligro'), sw: document.documentElement.scrollWidth };
      });
      // v5.18 — "Importar Excel" se mudó al módulo Importar desde Excel: quedan 3 acciones.
      chk('Productos (admin, 390 px): 3 acciones (Agregar, Publicar, Eliminar todos), todas dentro de la pantalla', h.n === 3 && h.dentro && !h.nombres.some(n => /importar/i.test(n)), JSON.stringify(h));
      chk('Las acciones bajan a su propio renglón (no empujan el título ni desbordan)', h.bajo && h.sw <= 390, JSON.stringify(h));
      chk('Todas las acciones miden ≥44 px y tienen nombre accesible', h.altos.every(a => a >= 44) && h.nombres.every(n => n.length > 0), JSON.stringify(h));
      chk('"Eliminar todos" es el único botón de peligro y conserva su nombre completo', h.peligro && h.nombres.some(n => /eliminar todos/i.test(n)), '');
    }
    if (ancho >= 820) {
      await p.evaluate(() => { activeTab = 'productos'; renderTab(); });
      await p.waitForTimeout(250);
      const una = await p.evaluate(() => { const a = [...document.querySelectorAll('#headerActions .hd-btn')].map(b => Math.round(b.getBoundingClientRect().top)); return new Set(a).size === 1 && a.length === 3; });
      chk('[' + ancho + '] las 3 acciones van en una sola fila', una, '');
      await p.evaluate(() => { activeTab = 'inicio'; renderTab(); sbOpen(); }); await p.waitForTimeout(350);
      const alt = await p.evaluate(() => [...document.querySelectorAll('.sb-item')].filter(b => b.getBoundingClientRect().height > 0).map(b => Math.round(b.getBoundingClientRect().height)));
      chk('[' + ancho + '] el menú lateral no comprime sus entradas (todas ≥44 px)', alt.length > 5 && alt.every(a => a >= 44), alt.join(','));
    }
    await p.context().close();
  }
  chk('Sin desborde horizontal en 3 anchos × 2 temas × 13 pantallas', desborde.length === 0, desborde.slice(0, 5).join(' | '));
  chk('Contraste de texto ≥ 4.5:1 (3:1 grande) en las 11 pestañas, oscuro y claro, 390 px', contraste.length === 0, contraste.slice(0, 6).join(' | '));
  chk('Todo botón/enlace/campo visible tiene nombre accesible', sinNombre.length === 0, [...new Set(sinNombre.map(s => s.replace(/^\S+ /, '')))].slice(0, 6).join(' | '));
  chk('Sin ids duplicados en ninguna pantalla', idsDup.length === 0, idsDup.slice(0, 5).join(' | '));
  chk('Objetivos táctiles ≥44 px en todas las pantallas (toggle con área ampliada; enlace de tarjeta y fila de gráfica ≥32)', chicos.length === 0, [...new Set(chicos.map(s => s.replace(/^\S+ /, '')))].slice(0, 8).join(' | '));

  // Rendimiento con un catálogo grande (2 000 productos): Productos e Inicio, presupuesto generoso para CI.
  const p = await abrir(nav, 390);
  const perf = await p.evaluate(() => {
    const g = ['TEQUILA', 'RON', 'WHISKY', 'VODKA', 'GINEBRA']; products = [];
    for (let i = 0; i < 2000; i++) products.push({ id: 'Q' + i, name: g[i % 5] + ' MARCA ' + i, unit: 'Botellas', group: g[i % 5], precio: 300, stockMinimo: 4, conversion: 750, stockByArea: { almacen: i % 7, barra1: 1, barra2: 0 } });
    const t = (tab) => { const a = performance.now(); activeTab = tab; renderTab(); return Math.round(performance.now() - a); };
    return { productos: t('productos'), inicio: t('inicio'), nodos: document.getElementsByTagName('*').length };
  });
  chk('2 000 productos: Productos se pinta en <3 s', perf.productos < 3000, JSON.stringify(perf));
  chk('2 000 productos: Inicio se pinta en <3 s', perf.inicio < 3000, JSON.stringify(perf));
  chk('2 000 productos: el DOM no pasa de 30 000 nodos', perf.nodos < 30000, JSON.stringify(perf));
  console.log('rendimiento (informativo): ' + JSON.stringify(perf));
  await nav.close();

  let mal = 0; C.forEach(c => { if (!c.ok) mal++; console.log((c.ok ? '  ✔ ' : '  ✖ ') + c.n + (c.ok ? '' : '  →  ' + c.d)); });
  console.log('\n' + (C.length - mal) + '/' + C.length + ' comprobaciones'); process.exit(mal ? 1 : 0);
})();
