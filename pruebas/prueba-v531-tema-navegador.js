// v5.31 — Tema minimalista claro (+ oscuro sobrio de v5.25), medido en Chromium
// contra la app real (390 px): contraste AA de TODO el texto de 10 pantallas y
// del modal de producto en ambos temas, tarjetas blancas y sin desborde.
//   npm run test:v531nav      (requiere el servidor local en PUERTO, 8080)
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const PUERTO = process.env.PUERTO || '8080';
const PANTALLAS = ['inicio', 'inventario', 'productos', 'pedido_sugerido', 'pedidos', 'compras', 'ventas', 'recetario', 'admin', 'importar'];

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  for (const ancho of [390, 820]) {
  const p = await (await nav.newContext({ viewport: { width: ancho, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.roleId = 'ADMIN';
    _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = [
      { id: '1180001', name: 'TEQUILA DON JULIO 70 700 ML', unit: 'PZA', group: 'TEQUILA', capacidadMl: 700, precio: 820, stockMinimo: 12, conversion: 1, stockByArea: { almacen: 2, barra1: 1 } },
      { id: '2210010', name: 'CERVEZA CORONA 355 ML', unit: 'PZA', group: 'CERVEZA', precio: 22, stockMinimo: 60, conversion: 1, stockByArea: { almacen: 48 } }];
    _auditoriaSessionId = 'S7'; _inventarioActivoCarga = 'ok';
    _inventarioActivo = { numero: 7, estado: 'SINCRONIZADO', fechaCreacion: Date.now(), creadoPorNombre: 'Eduardo', creadoPorRol: 'ADMIN', fechaRecuento: '2026-10-25', semanaId: '2026-10-19', warehousesSnapshot: ['almacen', 'barra1', 'barra2'] };
    auditoriaStatus = { almacen: 'completada', barra1: 'en_progreso', barra2: 'pendiente' };
    allUsersAuditoria = { u1: { uid: 'u1', email: 'luis@barra.mx', conteo: { '1180001': { almacen: { enteras: 2, abiertas: [] } } }, status: { almacen: 'completada' }, updatedAt: Date.now() } };
    ventasSemanaId = semanaId(new Date());
    ventas = [{ sku: '4501', nombre: 'MARGARITA CLASICA', tipo: 'Coctel', cantidad: 48, ventaNeta: 7680 }];
    ventasPeriodos = [{ inicio: ventasSemanaId, fin: ventasSemanaId }];
    _adminSubvista = 'permisos'; _permUidSel = null;
    _permUsuarios = [{ uid: 'admin1', email: 'eduardo@barra.mx', displayName: 'Eduardo', role: 'ADMIN', status: 'activo' }];
  });
  await p.addScriptTag({ content: `
    window.__rgb = s => (s.match(/[\\d.]+/g) || []).map(Number);
    window.__lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    window.__fondo = el => {
      const capas = [];
      for (let e = el; e; e = e.parentElement) {
        const c = __rgb(getComputedStyle(e).backgroundColor);
        if (c.length && (c.length < 4 || c[3] > 0)) capas.push(c);
        if (c.length && (c.length < 4 || c[3] >= 1)) break;
      }
      let base = __rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3);
      for (let i = capas.length - 1; i >= 0; i--) { const c = capas[i], a = c.length === 4 ? c[3] : 1; base = base.map((b, k) => c[k] * a + b * (1 - a)); }
      return base;
    };
    window.__contraste = raiz => {
      const malos = []; let n = 0;
      raiz.querySelectorAll('*').forEach(el => {
        if (![...el.childNodes].some(x => x.nodeType === 3 && x.textContent.trim())) return;
        const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
        const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('.sbx-sr, .if-badge-pre, [aria-hidden="true"], [disabled], option')) return;
        if (cs.position === 'absolute' && cs.clip && cs.clip !== 'auto') return;
        const fg = __rgb(cs.color), a = fg.length === 4 ? fg[3] : 1, bg = __fondo(el);
        const f3 = fg.slice(0, 3).map((v, k) => v * a + bg[k] * (1 - a));
        const L1 = __lum(f3), L2 = __lum(bg), ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
        const px = parseFloat(cs.fontSize), min = (px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700)) ? 3 : 4.5; n++;
        if (ratio < min) malos.push((el.className || el.tagName).toString().slice(0, 36) + ' "' + el.textContent.trim().slice(0, 18) + '" ' + ratio.toFixed(2));
      });
      return { malos, n };
    };` });

  for (const tema of ['light', 'dark']) {
    await p.evaluate(t => applyTheme(t), tema);
    const T = '[' + ancho + '/' + tema + '] ';
    if (tema === 'light') {
      const tok = await p.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { card: cs.getPropertyValue('--card').trim(), acc: cs.getPropertyValue('--accent').trim(), body: getComputedStyle(document.body).backgroundColor }; });
      chk(T + 'Tarjetas blancas, esmeralda bosque y fondo blanco cálido', tok.card === '#FFFFFF' && tok.acc === '#17694B' && tok.body === 'rgb(247, 247, 245)', JSON.stringify(tok));
    } else {
      const tok = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
      chk(T + 'El oscuro es el sobrio de v5.25 (acento esmeralda #54C398)', tok.toUpperCase() === '#54C398', tok);
    }
    for (const t of PANTALLAS) {
      const r = await p.evaluate(t => {
        if (t === 'inventario') auditoriaView = 'selection';
        activeTab = t; renderTab(); window.scrollTo(0, 0);
        const c = __contraste(document.getElementById('tabContent'));
        const blur = [...document.querySelectorAll('#tabContent *')].some(e => /blur/.test(getComputedStyle(e).backdropFilter));
        return { malos: c.malos, n: c.n, sw: document.documentElement.scrollWidth, blur };
      }, t);
      chk(T + t + ': contraste AA en todo el texto (' + r.n + ' textos), sin desborde y sin cristal', r.n >= 1 && r.malos.length === 0 && r.sw <= ancho && !r.blur, r.malos.slice(0, 6).join(' | ') + ' sw=' + r.sw + ' blur=' + r.blur);
    }
    const modal = await p.evaluate(() => {
      activeTab = 'productos'; renderTab(); openProductModal();
      const caja = document.querySelector('#productModal > div'); const bg = __rgb(getComputedStyle(caja).backgroundColor);
      const c = __contraste(document.getElementById('productModal'));
      closeProductModal();
      return { alfa: bg.length === 4 ? bg[3] : 1, malos: c.malos };
    });
    chk(T + 'Modal de producto opaco y con contraste AA', modal.alfa >= 0.99 && modal.malos.length === 0, JSON.stringify(modal).slice(0, 300));
    const acciones = await p.evaluate(() => {
      activeTab = 'inicio'; renderTab();
      const b = document.querySelector('.prd-card .prd-action-btn.del');
      return b ? { texto: getComputedStyle(b, '::after').content, onclick: b.getAttribute('onclick'), aria: b.getAttribute('aria-label') } : null;
    });
    chk(T + (ancho >= 600 ? '"Eliminar" visible con texto' : 'En el teléfono el botón sigue siendo ícono (sin aplastar la tarjeta)') + ' y conserva su onclick y su nombre',
        acciones && /deleteProduct\('/.test(acciones.onclick) && acciones.aria === 'Eliminar producto' && (ancho >= 600 ? acciones.texto === '"Eliminar"' : (acciones.texto === 'none' || acciones.texto === 'normal')), JSON.stringify(acciones));
  }
  chk('[' + ancho + '] Sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  await p.close();
  }
  await nav.close();
  console.log('\n  ── v5.31 · Tema minimalista (navegador) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + (c.d || ''))));
  const f = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - f) + ' pasaron · ' + f + ' fallaron\n');
  process.exit(f ? 1 : 0);
})();
