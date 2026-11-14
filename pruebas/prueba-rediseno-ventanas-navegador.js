// v5.43 — Rediseño de las ventanas pendientes: todas usan el encabezado común
// (UI.cabecera / moduloCabecera → header.pg-cab) con título, descripción y,
// en las interiores, Volver a la izquierda (.mc-cab__volver, el que pulsa
// Atrás de Android). Se mide en Chromium real, en móvil y escritorio, claro y oscuro.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const VISTAS = [{ n: 'móvil', width: 390, height: 844 }, { n: 'PC', width: 1440, height: 900 }];
const PRODS = [
  { id: 'DJ7', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'PZA', stockMinimo: 4, conversion: 700, precio: 1480, stockByArea: { almacen: 8, barra1: 2, barra2: 0 } },
  { id: 'ACE', name: 'ACEITUNA SIN HUESO', group: 'ABARROTES', unit: 'KGS', stockMinimo: 3, conversion: 1, precio: 180, stockByArea: { almacen: 1.7, barra1: 0, barra2: 0 } }
];
// [clave, cómo abrirla, título esperado, ¿lleva Volver?, ¿lleva punto de sincronía?]
const VENTANAS = [
  ['Conteo', () => { auditoriaView = 'selection'; switchTab('inventario'); }, 'Conteo', false, false],
  ['Ventas', () => switchTab('ventas'), 'Ventas', true, true],
  ['Pedidos (Pedido sugerido)', () => switchTab('pedidos'), 'Pedidos', false, false],   // v5.47: es la pestaña Pedidos, sin Volver
  ['Notificaciones', () => { _notificaciones = [{ id: 'a1', texto: 'Se cerró el área Almacén', tipo: 'inventario', creadoEn: Date.now(), leido: false }]; switchTab('notificaciones'); }, 'Notificaciones', false, false],
  ['Papelera', () => switchTab('papelera'), 'Papelera', false, false],
  ['Importar', () => switchTab('importar'), 'Importar desde Excel', false, false],
  ['Control de negativos', () => { switchTab('ventas'); controlNegativosAbrir(); }, 'Control de negativos', true, true],
  ['Gestión de equipo', () => { switchTab('admin'); abrirUsuariosPermisos(); }, 'Gestión de equipo', true, true],
  ['Físico vs Sistema', () => { switchTab('inventario'); auditoriaView = 'fisico_vs_sistema'; renderTab(); }, 'Físico vs Sistema', true, false],
  ['Reconteos', () => { switchTab('inventario'); auditoriaView = 'reconteo_historial'; renderTab(); }, 'Reconteos', true, false],
  ['Historial de inventarios', () => { switchTab('inventario'); auditoriaView = 'historial'; renderTab(); }, 'Historial de inventarios', true, false],
  ['Importar · catálogo', () => { switchTab('importar'); _impPendiente = { seccion: 'catalogo', archivo: 'catalogo.xlsx', validacion: { total: 1, altas: 1, actualizaciones: 0, errores: [], avisos: [], filas: [] } }; renderTab(); }, 'Catálogo de productos', true, false]
];

async function preparar(nav, v, tema) {
  const ctx = await nav.newContext({ viewport: { width: v.width, height: v.height } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('inventarioApp_temaMarca', 'ultra-pro'); localStorage.setItem('inventarioApp_theme', t); } catch (_) {} }, tema);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' }); await p.waitForTimeout(600);
  await p.evaluate((prods) => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; currentUserRole = 'admin';
    _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
    products = prods; cart = []; orders = []; renderTab();
  }, PRODS);
  return { ctx, p, errs };
}

const MEDIR = () => {
  const cabs = [...document.querySelectorAll('#tabContent header.pg-cab')];
  const c = cabs[0]; if (!c) return { n: 0 };
  const t = c.querySelector('.pg-cab__tit'), d = c.querySelector('.pg-cab__desc'), v = c.querySelector('.mc-cab__volver'), punto = c.querySelector('.mc-cab__punto');
  const vq = v && v.getBoundingClientRect(), tq = t.getBoundingClientRect();
  return {
    n: cabs.length, tit: t.textContent.trim(), h1: t.tagName, fs: getComputedStyle(t).fontSize,
    desc: d ? d.textContent.trim() : '', volver: !!v, // Redondeo: durante la animación de entrada de la pestaña el alto sale 43.99 px (subpíxel).
    volverOk: !v || (Math.round(vq.width) >= 44 && Math.round(vq.height) >= 44 && vq.right <= tq.left + 1),
    punto: punto ? punto.getAttribute('aria-label') : null,
    viejas: document.querySelectorAll('#tabContent .mc-cab, #tabContent .imp-cab, #tabContent .pap-cab, #tabContent .ui-cab, #tabContent .rc-cab').length,
    desborde: document.documentElement.scrollWidth > window.innerWidth + 1
  };
};

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  for (const tema of ['dark', 'light']) for (const v of VISTAS) {
    const { ctx, p, errs } = await preparar(nav, v, tema);
    const tag = `[${v.n} · ${tema}]`;
    const tamanos = new Set();
    for (const [nombre, abrir, titulo, conVolver, conPunto] of VENTANAS) {
      await p.evaluate(abrir); await p.waitForTimeout(150);
      const r = await p.evaluate(MEDIR);
      tamanos.add(r.fs);
      chk(`${tag} ${nombre}: un solo encabezado común con título «${titulo}» (h1) y descripción`,
          r.n === 1 && r.tit === titulo && r.h1 === 'H1' && r.desc.length > 5, JSON.stringify(r));
      chk(`${tag} ${nombre}: ${conVolver ? 'Volver a la izquierda del título, ≥ 44 px' : 'sin Volver (ventana principal)'}`, r.volver === conVolver && r.volverOk, JSON.stringify(r));
      if (conPunto) chk(`${tag} ${nombre}: conserva el punto de sincronía con texto accesible`, /Sincroniza/.test(r.punto || ''), String(r.punto));
      chk(`${tag} ${nombre}: sin encabezados del estilo anterior y sin desplazamiento horizontal`, r.viejas === 0 && !r.desborde, JSON.stringify(r));
      await p.evaluate(() => { try { if (controlNegativosActivo()) controlNegativosCerrar(); } catch (_) {} try { _impPendiente = null; } catch (_) {} auditoriaView = 'selection'; });
    }
    chk(`${tag} El título mide lo mismo en todas las ventanas`, tamanos.size === 1, JSON.stringify([...tamanos]));

    // Conteo sin inventario: Crear (primario, a lo ancho) y luego Historial + Reconteos lado a lado, en una línea.
    await p.evaluate(() => { auditoriaView = 'selection'; switchTab('inventario'); }); await p.waitForTimeout(150);
    const ct = await p.evaluate(() => {
      const bs = [...document.querySelectorAll('#tabContent .if-card')][0].querySelectorAll('.bt');
      return [...bs].map(b => { const q = b.getBoundingClientRect(); return { t: b.innerText.trim(), c: b.className, w: Math.round(q.width), h: Math.round(q.height), top: Math.round(q.top), aria: b.getAttribute('aria-label') }; });
    });
    chk(`${tag} Conteo: «Crear Inventario Físico» es el primer botón, primario y a lo ancho`, ct.length === 3 && /Crear Inventario Físico/.test(ct[0].t) && /bt--primario/.test(ct[0].c) && ct[0].w > ct[1].w * 1.8, JSON.stringify(ct));
    chk(`${tag} Conteo: Historial y Reconteos secundarios, en la misma fila y en una sola línea (≤ 50 px)`,
        ct.length === 3 && ct.slice(1).every(b => /bt--secundario/.test(b.c) && b.h >= 44 && b.h <= 50) && ct[1].top === ct[2].top && ct[1].aria === 'Historial de inventarios', JSON.stringify(ct));

    // Ventas: como Compras — primero las acciones (Importar primario), luego el periodo.
    await p.evaluate(() => switchTab('ventas')); await p.waitForTimeout(150);
    const vs = await p.evaluate(() => {
      const acc = document.querySelector('#tabContent .vs-acciones'), per = document.querySelector('#tabContent .vs-flecha, #tabContent [class*="vs-periodo"]');
      return { orden: !!acc && !!per && (acc.compareDocumentPosition(per) & Node.DOCUMENT_POSITION_FOLLOWING) > 0, prim: !!(acc && acc.firstElementChild && /vs-btn--primario/.test(acc.firstElementChild.className)) };
    });
    chk(`${tag} Ventas: las acciones (Importar primero) van antes del periodo y la búsqueda`, vs.orden && vs.prim, JSON.stringify(vs));

    // Volver funciona igual que antes (incluido el que escucha por data-rc-accion)
    await p.evaluate(() => { switchTab('inventario'); auditoriaView = 'fisico_vs_sistema'; renderTab(); }); await p.waitForTimeout(120);
    await p.click('#tabContent .mc-cab__volver'); await p.waitForTimeout(150);
    const v1 = await p.evaluate(() => auditoriaView);
    await p.evaluate(() => { auditoriaView = 'reconteo_historial'; renderTab(); }); await p.waitForTimeout(120);
    await p.click('#tabContent .mc-cab__volver'); await p.waitForTimeout(150);
    const v2 = await p.evaluate(() => auditoriaView);
    await p.evaluate(() => { auditoriaView = 'historial'; renderTab(); }); await p.waitForTimeout(120);
    await p.click('#tabContent .mc-cab__volver'); await p.waitForTimeout(150);
    const v3 = await p.evaluate(() => auditoriaView);
    chk(`${tag} Volver regresa a Conteo desde Físico vs Sistema, Reconteos e Historial`, v1 === 'selection' && v2 === 'selection' && v3 === 'selection', JSON.stringify([v1, v2, v3]));
    await p.evaluate(() => { switchTab('importar'); _impPendiente = { seccion: 'catalogo', archivo: 'x.xlsx', validacion: { total: 1, altas: 1, actualizaciones: 0, errores: [], avisos: [], filas: [] } }; renderTab(); });
    await p.waitForTimeout(120);
    const descArchivo = await p.evaluate(() => (document.querySelector('#tabContent .pg-cab__desc') || {}).innerHTML || '');
    await p.click('#tabContent .mc-cab__volver'); await p.waitForTimeout(150);
    const hub = await p.evaluate(() => (document.querySelector('#tabContent .pg-cab__tit') || {}).textContent);
    chk(`${tag} Importar: la vista previa nombra el archivo y Volver regresa al hub`, /<b>x\.xlsx<\/b>/.test(descArchivo) && hub === 'Importar desde Excel', JSON.stringify([descArchivo, hub]));
    // v5.47 — «Pedidos generados» (en la pestaña Pedidos) abre Historia → Pedidos
    await p.evaluate(() => { switchTab('pedidos'); }); await p.waitForTimeout(120);
    await p.click('#psHistorialBtn'); await p.waitForTimeout(150);
    chk(`${tag} Pedidos: «Pedidos generados» abre Historia → Pedidos`, await p.evaluate(() => activeTab === 'historia' && _historiaVista === 'pedidos'));

    chk(`${tag} Sin errores de JavaScript`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await nav.close();
  const w = Math.max(...C.map(c => c.n.length));
  console.log('\n  ── v5.43 · Rediseño de las ventanas pendientes (navegador real) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
  const fallos = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
