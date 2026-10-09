// Barrido de accesibilidad (exploratorio, R8): nombre accesible de cada control, etiquetas de campos,
// ids duplicados, imágenes sin alt, desbordamiento horizontal y objetivos táctiles < 44 px.
const { chromium } = require('playwright');
const PUERTO = process.env.PUERTO || '8080';
(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const agg = {};
  for (const ancho of [390, 820, 1280]) {
    const p = await (await nav.newContext({ viewport: { width: ancho, height: 844 } })).newPage();
    await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
    await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(700);
    await p.evaluate(() => {
      document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
      currentUserUid = 'adm1'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']); _authzState.roleId = 'ADMIN';
      const g = ['TEQUILA', 'RON', 'WHISKY', 'VODKA']; products = []; for (let i = 0; i < 24; i++) products.push({ id: 'P' + i, name: g[i % 4] + ' MARCA ' + i, unit: 'Botellas', group: g[i % 4], precio: 300 + i, stockMinimo: 4, conversion: 750, pv: 'PV' + i, proveedor: 'DIST', stockByArea: { almacen: i % 7, barra1: 1, barra2: 0 } });
      recetas = [{ id: 'r1', pv: 'PV1', nombre: 'MARGARITA', activa: true, ingredientes: [{ productoId: 'P0', cantidad: 0.06, uom: 'PZA' }] }];
      ventas = [{ sku: 'PV1', nombre: 'Margarita', cantidad: 7 }]; ventasSemanaId = semanaId(new Date()); ventasPeriodos = [{ inicio: ventasSemanaId, fin: ventasSemanaId }];
      _notificaciones = [{ id: 'n1', tipo: 'ajuste', texto: 'Ajuste', creadoEn: 1, leido: false }]; _ajustes = [{ id: 'a1', estado: 'pendiente', productoId: 'P1', productoNombre: 'RON', motivo: 'c', creadoEn: 1, solicitanteUid: 'u2' }];
      orders = []; inventories = [];
    });
    const estados = ['inicio', 'productos', 'pedidos', 'inventario', 'compras', 'recetario', 'ventas', 'historia', 'ajustes', 'notificaciones', 'admin'].map(t => ({ n: t, f: "activeTab='" + t + "';renderTab();" }))
      .concat([{ n: 'sidebar', f: "activeTab='inicio';renderTab();sbOpen();" }, { n: 'modal:producto', f: "sbClose();openProductModal();" }, { n: 'modal:pedido', f: "document.getElementById('productModal').classList.add('hidden');openOrderModal();" }]);
    for (const tema of ['dark', 'light']) {
      await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), tema);
      for (const e of estados) {
        await p.evaluate(new Function(e.f)); await p.waitForTimeout(300);
        const fallos = await p.evaluate(() => {
          const out = [];
          const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('.hidden, [hidden], [aria-hidden="true"]'); };
          const nombre = el => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && [...el.getAttribute('aria-labelledby').split(' ')].map(i => (document.getElementById(i) || {}).textContent || '').join(' ') || el.getAttribute('title') || el.innerText || el.textContent || '').trim();
          const id = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
          document.querySelectorAll('button, a[href], [role="button"], [onclick]').forEach(el => { if (visible(el) && !nombre(el) && !el.querySelector('img[alt]')) out.push(['sin-nombre', id(el)]); });
          document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach(el => {
            if (!visible(el)) return;
            const lab = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); const env = el.closest('label');
            if (!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || lab || env)) out.push(['campo-sin-etiqueta', id(el) + (el.placeholder ? ' ph="' + el.placeholder.slice(0, 20) + '"' : '')]);
          });
          const ids = {}; document.querySelectorAll('[id]').forEach(el => { ids[el.id] = (ids[el.id] || 0) + 1; }); Object.keys(ids).filter(k => ids[k] > 1).forEach(k => out.push(['id-duplicado', k]));
          document.querySelectorAll('img:not([alt])').forEach(el => { if (visible(el)) out.push(['img-sin-alt', id(el)]); });
          if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(['desborde-horizontal', document.documentElement.scrollWidth + '>' + window.innerWidth]);
          document.querySelectorAll('button, a[href], [role="button"], input[type=checkbox], input[type=radio], select').forEach(el => {
            if (!visible(el)) return; const r = el.getBoundingClientRect();
            if (r.right <= 0 || r.left >= window.innerWidth || el.closest('#sidebar, nav')  && r.right <= 0) return;
            if ((r.height < 44 || r.width < 44) && !(el.tagName === 'A' && el.closest('p, li, span')) && !el.closest('#bottomTabBar')) out.push(['objetivo-chico', id(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)]);
          });
          return out;
        });
        fallos.forEach(([tipo, que]) => { const k = tipo + '|' + que; const a = agg[k] || (agg[k] = { donde: new Set() }); a.donde.add(ancho + '/' + tema[0] + '/' + e.n); });
      }
    }
    await p.close();
  }
  const filas = Object.entries(agg).map(([k, v]) => [k, v.donde.size, [...v.donde].slice(0, 3).join(' ')]).sort((a, b) => a[0].localeCompare(b[0]));
  const porTipo = {}; filas.forEach(f => { const t = f[0].split('|')[0]; porTipo[t] = (porTipo[t] || 0) + 1; });
  console.log(JSON.stringify(porTipo));
  filas.forEach(f => console.log(f[0] + '  (' + f[1] + ' estados; ej. ' + f[2] + ')'));
  await nav.close();
})();
