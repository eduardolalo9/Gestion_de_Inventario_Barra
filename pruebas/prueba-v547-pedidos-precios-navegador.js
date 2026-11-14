// v5.47 — (1) El precio vigente sale de la última compra y llega a todas las pantallas.
// (2) La pestaña Pedidos muestra el Pedido sugerido. (3) Historia tiene los botones Inventario | Pedidos y
// el historial de pedidos usa tarjetas COMPACTAS que, al seleccionarlas, muestran el pedido completo.
// Chromium real; Firestore se sustituye por un doble en memoria con transacciones.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

const FAKE = () => {
  const store = { 'costos/ultimos': null };
  window.__store = store; window.__tx = 0;
  const borrar = { op: 'delete' };
  window.firebase = window.firebase || {}; firebase.firestore = firebase.firestore || {};
  firebase.firestore.FieldValue = { delete: () => borrar };
  firebase.firestore.FieldPath = function (...s) { this.segmentos = s; };
  const clon = (o) => JSON.parse(JSON.stringify(o));
  const vacio = { exists: false, docs: [], empty: true, size: 0, forEach() {}, data() { return {}; }, docChanges() { return []; } };
  // Todo lo que la app pide que no sea costos/ultimos responde vacío (consultas, escuchas, subcolecciones).
  const mk = (path) => new Proxy(function () {}, {
    get(_, k) {
      if (k === 'path') return path;
      if (k === 'then') return undefined;
      if (k === 'get') return async () => (path in store ? { exists: store[path] != null, data: () => clon(store[path]) } : vacio);
      if (k === 'onSnapshot') return () => () => {};
      if (k === 'doc' || k === 'collection') return (n) => mk(path + '/' + n);
      return () => mk(path);
    }
  });
  const docRef = (path) => mk(path);
  _db = {
    collection: (c) => mk(c),
    batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }),
    runTransaction: async (fn) => {
      const tx = {
        get: async (ref) => ({ exists: store[ref.path] != null, data: () => clon(store[ref.path]) }),
        set: (ref, obj) => { store[ref.path] = clon(obj); },
        update: (ref, ...args) => { const cur = store[ref.path]; for (let i = 0; i < args.length; i += 2) { const pid = args[i].segmentos[1], v = args[i + 1]; if (v && v.op === 'delete') delete cur.productos[pid]; else cur.productos[pid] = clon(v); } }
      };
      await fn(tx); window.__tx++;
    }
  };
};
const MONTAR = (rol) => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u'; currentUserRole = rol; _authzState.loaded = true; _authzState.overrides = {};
  _authzState.permissions = new Set(rol === 'admin' ? ['*'] : ['inventory.count', 'inventory.read']);
  products = [
    { id: 'DJ7', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'PZA', precio: 1400, stockMinimo: 4, conversion: 1, stockByArea: { almacen: 1 } },
    { id: 'ACE', name: 'ACEITUNA SIN HUESO', group: 'ABARROTES', unit: 'KGS', precio: 150, stockMinimo: 3, stockByArea: { almacen: 1.7 } },
    { id: 'JWB', name: 'JOHNNIE WALKER BLACK LABEL', group: 'WHISKY', unit: 'PZA', stockMinimo: 3, stockByArea: { almacen: 0.8 } }
  ];
  orders = [
    { id: 'PED-002-cd34', date: '10/11/2026, 5:10:00 p. m.', supplier: 'LICORES DEL NORTE', total: 12, products: [{ id: 'DJ7', name: 'DON JULIO 70', unit: 'PZA', quantity: 12 }] },
    { id: 'PED-003-ab12', date: '13/11/2026, 10:42:11 a. m.', supplier: 'DISTRIBUIDORA EL ÁGUILA', deliveryDate: '2026-11-15', note: 'Entregar por la puerta trasera', total: 7.5,
      products: [{ id: 'DJ7', name: 'DON JULIO 70', unit: 'PZA', quantity: 3 }, { id: 'ACE', name: 'ACEITUNA SIN HUESO', unit: 'KGS', quantity: 2.5 }, { id: 'JWB', name: 'JOHNNIE WALKER BLACK LABEL', unit: 'PZA', quantity: 2 }] }
  ];
  inventories = []; compras = []; movimientos = []; costosUltimos = {};
  window.__wa = []; window.open = (u) => { window.__wa.push(u); return null; };
  activeTab = 'pedidos'; renderTab();
};
async function abrir(nav, rol, ancho) {
  const ctx = await nav.newContext({ viewport: { width: ancho || 390, height: 844 }, hasTouch: (ancho || 390) < 600 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600);
  await p.evaluate(FAKE); await p.evaluate(MONTAR, rol); await p.waitForTimeout(250);
  return { ctx, p, errs };
}

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());

  // ═══ 1 · La pestaña Pedidos ES el Pedido sugerido ════════════════════════
  let { ctx, p, errs } = await abrir(nav, 'admin');
  const t1 = await p.evaluate(() => ({ tit: (document.querySelector('#tabContent .pg-cab__tit') || {}).textContent, volver: !!document.querySelector('#tabContent .mc-cab__volver'),
    filtros: !!document.querySelector('#tabContent .ps-filtros'), barra: !!document.querySelector('#tabContent #sbx-res-pedsug'), generar: !!document.querySelector('[data-ps-accion="generar"]'),
    viejas: document.querySelectorAll('#tabContent .ped-c, #tabContent .ped-card').length,
    hist: (document.getElementById('psHistorialBtn') || {}).innerText }));
  chk('★ Pedidos muestra la ventana del Pedido sugerido (filtros, lista y «Generar pedido»), sin Volver', t1.tit === 'Pedidos' && !t1.volver && t1.filtros && t1.barra && t1.generar, JSON.stringify(t1));
  chk('Ya no lista aquí los pedidos generados; ofrece «Pedidos generados» con su cuenta (2)', t1.viejas === 0 && /Pedidos generados/.test(t1.hist) && /2/.test(t1.hist), JSON.stringify(t1));
  chk('La barra inferior marca «Pedidos» y abrirPedidoSugerido() lleva a esta misma pestaña', await p.evaluate(() => { abrirPedidoSugerido(); return activeTab === 'pedidos'; }));
  await p.evaluate(() => { activeTab = 'pedido_sugerido'; renderTab(); });
  chk('El enlace viejo (pedido_sugerido) muestra la misma ventana', await p.evaluate(() => (document.querySelector('#tabContent .pg-cab__tit') || {}).textContent === 'Pedidos' && !!document.querySelector('[data-ps-accion="generar"]')));
  await p.evaluate(() => { activeTab = 'pedidos'; renderTab(); });

  // ═══ 2 · Historia: Inventario | Pedidos ═════════════════════════════════
  await p.click('#psHistorialBtn'); await p.waitForTimeout(250);
  const h = await p.evaluate(() => ({ tab: activeTab, vista: _historiaVista, tabs: Array.from(document.querySelectorAll('#tabContent [role="tab"]')).map(b => ({ t: b.innerText.replace(/\s+/g, ' ').trim(), sel: b.getAttribute('aria-selected'), alto: Math.round(b.getBoundingClientRect().height) })),
    tarjetas: document.querySelectorAll('.ped-c').length }));
  chk('★ «Pedidos generados» abre Historia en la vista Pedidos', h.tab === 'historia' && h.vista === 'pedidos' && h.tarjetas === 2, JSON.stringify(h));
  chk('★ Historia tiene dos botones, Inventario y Pedidos (con su cuenta), ≥ 44 px, Pedidos activo', h.tabs.length === 2 && /^Inventario 0$/.test(h.tabs[0].t) && /^Pedidos 2$/.test(h.tabs[1].t) && h.tabs[1].sel === 'true' && h.tabs.every(b => b.alto >= 44), JSON.stringify(h.tabs));
  await p.click('#hsTab-inventario'); await p.waitForTimeout(250);
  chk('★ El botón Inventario muestra el historial de inventarios (reportes y conteos), sin pedidos', await p.evaluate(() => _historiaVista === 'inventario' && !!document.getElementById('historiaReportesWrap') && !document.querySelector('.ped-c')));
  await p.click('#hsTab-pedidos'); await p.waitForTimeout(250);

  // ═══ 3 · Tarjeta compacta → pedido completo ═════════════════════════════
  const c1 = await p.evaluate(() => Array.from(document.querySelectorAll('.ped-c')).map(c => { const q = c.getBoundingClientRect(); return { alto: Math.round(q.height), texto: c.innerText.replace(/\s+/g, ' ').trim(), tabla: !!c.querySelector('.ped-tabla'), exp: c.querySelector('.ped-c__cab').getAttribute('aria-expanded') }; }));
  chk('★ Tarjeta COMPACTA: cada pedido cabe en ≤ 72 px y muestra folio, proveedor, fecha, nº de productos y total', c1.every(c => c.alto <= 72) && /PED-002-cd34/.test(c1[0].texto) && /LICORES DEL NORTE/.test(c1[0].texto) && /10\/11\/2026/.test(c1[0].texto) && /1 producto/.test(c1[0].texto) && /12\.00/.test(c1[0].texto) && !/Entrega/.test(c1[1].texto), JSON.stringify(c1));
  chk('Compacta = sin el detalle (sin tabla de productos) y cerrada (aria-expanded=false)', c1.every(c => !c.tabla && c.exp === 'false'));
  await p.click('[data-ped-id="PED-003-ab12"]'); await p.waitForTimeout(200);
  const c2 = await p.evaluate(() => { const c = document.querySelector('.ped-c--abierto'); const q = c.querySelector('.ped-c__cab');
    return { id: c.querySelector('.ped-c__id').textContent, exp: q.getAttribute('aria-expanded'), ctrl: !!document.getElementById(q.getAttribute('aria-controls')),
      filas: Array.from(c.querySelectorAll('.ped-tabla tbody tr')).map(tr => tr.innerText.replace(/\s+/g, ' ').trim()), pie: (c.querySelector('.ped-card__pie') || {}).innerText, nota: (c.querySelector('.ped-card__nota') || {}).innerText,
      fecha: (c.querySelector('.ped-c__fecha') || {}).innerText, botones: Array.from(c.querySelectorAll('.ped-c__acc button')).map(b => b.getAttribute('aria-label')), abiertas: document.querySelectorAll('.ped-c--abierto').length }; });
  chk('★ Al seleccionar la tarjeta se muestra el PEDIDO COMPLETO: los 3 productos con unidad y cantidad, total, nota y fecha completa',
      c2.exp === 'true' && c2.ctrl && c2.filas.length === 3 && /DON JULIO 70 PZA 3/.test(c2.filas[0]) && /ACEITUNA SIN HUESO KGS 2\.5/.test(c2.filas[1]) && /Total Productos: 7\.50/.test(c2.pie) && /puerta trasera/.test(c2.nota) && /10:42:11/.test(c2.fecha) && /Entrega: 2026-11-15/.test(c2.fecha), JSON.stringify(c2));
  chk('El pedido abierto ofrece Compartir por WhatsApp y Eliminar con nombre accesible', c2.botones.length === 2 && /Compartir pedido PED-003-ab12 por WhatsApp/.test(c2.botones[0]) && /Eliminar pedido PED-003-ab12/.test(c2.botones[1]), JSON.stringify(c2.botones));
  await p.click('[data-ped-id="PED-002-cd34"]'); await p.waitForTimeout(200);
  chk('Solo un pedido abierto a la vez (abrir otro cierra el anterior)', await p.evaluate(() => document.querySelectorAll('.ped-c--abierto').length === 1 && document.querySelector('.ped-c--abierto .ped-c__id').textContent === 'PED-002-cd34'));
  await p.click('[data-ped-id="PED-002-cd34"]'); await p.waitForTimeout(200);
  chk('Tocar de nuevo el abierto lo vuelve a compactar', await p.evaluate(() => document.querySelectorAll('.ped-c--abierto').length === 0 && !document.querySelector('.ped-tabla')));
  await p.click('[data-ped-id="PED-003-ab12"]'); await p.waitForTimeout(150);
  await p.click('.ped-c__acc .bt--primario'); await p.waitForTimeout(150);
  const wa = await p.evaluate(() => window.__wa.slice());
  chk('★ Compartir por WhatsApp abre wa.me con el pedido completo (folio, proveedor, productos y nota)', wa.length === 1 && /^https:\/\/wa\.me\/\?text=/.test(wa[0]) && (() => { const t = decodeURIComponent(wa[0].split('text=')[1]); return /PED-003-ab12/.test(t) && /DISTRIBUIDORA EL ÁGUILA/.test(t) && /ACEITUNA SIN HUESO/.test(t) && /puerta trasera/.test(t); })(), wa[0]);
  chk('Buscar sigue funcionando sobre las tarjetas (por proveedor)', await (async () => { await p.fill('#sbx-input-pedidos, [data-sbx-key="pedidos"] input', 'norte').catch(() => {}); await p.waitForTimeout(350);
    return p.evaluate(() => Array.from(document.querySelectorAll('.ped-c')).map(c => c.querySelector('.ped-c__id').textContent).join() === 'PED-002-cd34'); })());
  chk('Sin desplazamiento horizontal (móvil)', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.evaluate(() => { _pedidosSearchTerm = ''; renderTab(); });
  await p.click('[data-ped-id="PED-002-cd34"]'); await p.waitForTimeout(150);
  await p.click('.ped-c__acc .ui-icono-btn--peligro'); await p.waitForTimeout(200);
  await p.click('#_cfmOk'); await p.waitForTimeout(250);
  chk('Eliminar (administración) pide confirmación y quita el pedido', await p.evaluate(() => orders.length === 1 && orders[0].id === 'PED-003-ab12' && document.querySelectorAll('.ped-c').length === 1));

  // ═══ 4 · Generar un pedido lleva a Historia → Pedidos con el pedido abierto ═══
  await p.evaluate(() => { activeTab = 'pedidos'; _historiaVista = 'inventario'; renderTab(); }); await p.waitForTimeout(200);
  await p.evaluate(() => { addToCart('DJ7', 4); openOrderModal(); }); await p.waitForTimeout(250);
  await p.fill('#orderSupplier', 'PROVEEDOR NUEVO'); await p.evaluate(() => createOrder()); await p.waitForTimeout(350);
  const g = await p.evaluate(() => ({ tab: activeTab, vista: _historiaVista, abierto: (document.querySelector('.ped-c--abierto .ped-c__id') || {}).textContent, n: orders.length, wa: window.__wa.length, carrito: cart.length }));
  chk('★ Al crear el pedido se comparte por WhatsApp y se abre Historia → Pedidos con ese pedido desplegado', g.tab === 'historia' && g.vista === 'pedidos' && /^PED-004-/.test(g.abierto) && g.n === 2 && g.wa === 2 && g.carrito === 0, JSON.stringify(g));
  chk('Sin errores de JavaScript (pedidos)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 5 · Precio vigente = última compra, en todas las pantallas ══════════
  ({ ctx, p, errs } = await abrir(nav, 'admin'));
  await p.evaluate(() => { costosUltimos = { DJ7: { costo: 1480, fecha: '2026-11-10', folio: '3646', compraId: 'c1', ts: 1 } }; renderTab(); });
  const sug = await p.evaluate(() => { const f = pedidoSugeridoFilas(products, { soloBajo: true }).find(x => x.id === 'DJ7'); return { precio: f.precio, texto: document.getElementById('ps-pie') ? document.getElementById('ps-pie').innerText : '' }; });
  chk('★ Pedido sugerido usa el precio de la última compra ($1,480), no el del catálogo ($1,400)', sug.precio === 1480 && /\$4,440|4,440/.test(sug.texto.replace(/\s/g, '')) , JSON.stringify(sug));
  await p.evaluate(() => { activeTab = 'productos'; renderTab(); }); await p.waitForTimeout(250);
  const cat = await p.evaluate(() => { const tr = Array.from(document.querySelectorAll('#tabContent tbody tr')).find(r => /DON JULIO/.test(r.textContent)); return tr ? tr.textContent.replace(/\s+/g, ' ') : ''; });   // textContent: en el teléfono la columna de precio se oculta
  chk('★ El catálogo muestra $1,480.00 para el producto con compra y $150.00 (catálogo) para el que no la tiene', /1,480\.00/.test(cat) && !/1,400/.test(cat) && await p.evaluate(() => /150\.00/.test(Array.from(document.querySelectorAll('#tabContent tbody tr')).find(r => /ACEITUNA/.test(r.textContent)).textContent)), cat);
  const val = await p.evaluate(() => ({ ind: _panelIndicadores().valor, esperado: existenciaMostrada(products[0]) * 1480 + existenciaMostrada(products[1]) * 150, sin: _panelIndicadores().conPrecio }));
  chk('El valor en existencia del panel usa el precio vigente', Math.abs(val.ind - val.esperado) < 0.01 && val.sin === 2, JSON.stringify(val));
  await p.evaluate(() => abrirFichaProducto('DJ7')); await p.waitForTimeout(250);
  const fi = await p.evaluate(() => ((document.getElementById('pm-ficha-wrap') || {}).textContent || '').replace(/\s+/g, ' '));
  chk('La ficha del producto dice «Precio · última compra» y el último costo con su fecha', /Precio · última compra\$1,480/.test(fi) && /Último costo\$1,480 \(2026-11-10\)/.test(fi), fi.slice(0, 300));
  await p.evaluate(() => cerrarFichaProducto());
  await p.evaluate(() => openProductModal('DJ7')); await p.waitForTimeout(200);
  const form = await p.evaluate(() => ({ campo: document.getElementById('productPrecio').value, hint: document.getElementById('productPrecioHint').hidden ? '' : document.getElementById('productPrecioHint').textContent }));
  chk('★ El formulario del producto conserva el precio del CATÁLOGO ($1,400) y avisa cuál es el vigente y de qué compra', form.campo === '1400' && /1,480\.00/.test(form.hint) && /3646/.test(form.hint) && /2026-11-10/.test(form.hint), JSON.stringify(form));
  await p.evaluate(() => { closeProductModal(); openProductModal('ACE'); });
  chk('Sin compra no aparece el aviso', await p.evaluate(() => document.getElementById('productPrecioHint').hidden));
  await p.evaluate(() => closeProductModal());
  chk('Sin errores de JavaScript (precio vigente)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 6 · Persistencia y reconciliación de costos/ultimos ═════════════════
  ({ ctx, p, errs } = await abrir(nav, 'admin'));
  const compra = { compraId: 'c10', folio: '3700', fechaIngreso: '2026-11-12', creadoEn: 10, lineas: [{ productoId: 'DJ7', costoUnitario: 1500, enCatalogo: true }, { productoId: 'ACE', costoUnitario: 0, enCatalogo: true }] };
  const s1 = await p.evaluate(async (c) => { const r = await aplicarCostosDeCompra(c); return { r, doc: JSON.parse(JSON.stringify(window.__store['costos/ultimos'])), local: JSON.parse(JSON.stringify(costosUltimos)), tx: window.__tx }; }, compra);
  chk('★ Guardar una compra escribe costos/ultimos en el servidor (transacción) y el espejo local; un costo 0 se ignora', s1.doc.productos.DJ7.costo === 1500 && s1.doc.productos.DJ7.compraId === 'c10' && !('ACE' in s1.doc.productos) && s1.local.DJ7.costo === 1500 && s1.tx === 1 && s1.r.guardado === true, JSON.stringify(s1));
  const s2 = await p.evaluate(async () => { await aplicarCostosDeCompra({ compraId: 'c11', folio: '3711', fechaIngreso: '2026-11-13', creadoEn: 11, lineas: [{ productoId: 'DJ7', costoUnitario: 1550, enCatalogo: true }] });
    return JSON.parse(JSON.stringify(window.__store['costos/ultimos'].productos.DJ7)); });
  chk('Una compra más nueva reemplaza y deja la anterior como «previo»', s2.costo === 1550 && s2.previo.costo === 1500 && s2.previo.compraId === 'c10', JSON.stringify(s2));
  const s3 = await p.evaluate(async () => { await aplicarCostosDeCompra({ compraId: 'c05', folio: '3500', fechaIngreso: '2026-10-01', creadoEn: 99, lineas: [{ productoId: 'DJ7', costoUnitario: 900, enCatalogo: true }] });
    return window.__store['costos/ultimos'].productos.DJ7.costo; });
  chk('★ Una entrada VIEJA registrada después no regresa el precio', s3 === 1550);
  const s4 = await p.evaluate(async () => { await revertirCostosDeCompra('c11'); return { srv: window.__store['costos/ultimos'].productos.DJ7, local: costosUltimos.DJ7.costo, precio: precioProducto(products[0]) }; });
  chk('★ Cancelar la compra vigente regresa el precio a la anterior (servidor, espejo y pantallas)', s4.srv.costo === 1500 && s4.srv.compraId === 'c10' && s4.local === 1500 && s4.precio === 1500, JSON.stringify(s4));
  const s5 = await p.evaluate(async () => { await revertirCostosDeCompra('c10'); return { hay: 'DJ7' in window.__store['costos/ultimos'].productos, precio: precioProducto(products[0]) }; });
  chk('Cancelar también la última compra quita el costo y vuelve el precio del catálogo ($1,400)', !s5.hay && s5.precio === 1400, JSON.stringify(s5));
  // Reconciliar: un aparato con compras cargadas pero sin costos en el servidor (p. ej. importó desde otro)
  const s6 = await p.evaluate(async () => {
    window.__store['costos/ultimos'] = null; costosUltimos = {};
    compras = [
      { compraId: 'a1', folio: '1', fechaIngreso: '2026-11-01', creadoEn: 1, lineas: [{ productoId: 'DJ7', costoUnitario: 1300, enCatalogo: true }, { productoId: 'ACE', costoUnitario: 140, enCatalogo: true }] },
      { compraId: 'a2', folio: '2', fechaIngreso: '2026-11-09', creadoEn: 2, lineas: [{ productoId: 'DJ7', costoUnitario: 1450, enCatalogo: true }] },
      { compraId: 'a3', folio: '3', fechaIngreso: '2026-11-12', creadoEn: 3, cancelada: true, lineas: [{ productoId: 'DJ7', costoUnitario: 9999, enCatalogo: true }] }
    ];
    const cambio = await cargarUltimosCostos();
    await new Promise(r => setTimeout(r, 200));
    return { cambio, local: JSON.parse(JSON.stringify(costosUltimos)), srv: window.__store['costos/ultimos'] && JSON.parse(JSON.stringify(window.__store['costos/ultimos'])) };
  });
  chk('★ Al cargar, se reconcilia con las compras del aparato: gana la más reciente NO cancelada (1450, no 9999) y ACE queda en 140', s6.cambio && s6.local.DJ7.costo === 1450 && s6.local.ACE.costo === 140 && s6.srv && s6.srv.productos.DJ7.costo === 1450 && s6.srv.productos.ACE.costo === 140, JSON.stringify(s6));
  // Quien NO puede registrar compras: ve los precios pero no escribe
  const s7 = await p.evaluate(async () => { _authzState.permissions = new Set(['inventory.read']); window.__store['costos/ultimos'] = { productos: { DJ7: { costo: 1475, fecha: '2026-11-11', folio: '9', compraId: 'z9', ts: 5, previo: null } } }; window.__tx = 0; costosUltimos = {};
    const antes = JSON.stringify(window.__store['costos/ultimos']);
    compras = [{ compraId: 'z1', folio: '1', fechaIngreso: '2026-11-13', creadoEn: 1, lineas: [{ productoId: 'ACE', costoUnitario: 160, enCatalogo: true }] }];
    await cargarUltimosCostos(); return { precio: precioProducto(products[0]), ace: precioProducto(products[1]), tx: window.__tx, igual: JSON.stringify(window.__store['costos/ultimos']) === antes }; });
  chk('★ Una cuenta sin permiso de compras LEE el precio vigente (1475 y 160 de lo que conoce) pero no escribe nada en el servidor', s7.precio === 1475 && s7.ace === 160 && s7.tx === 0 && s7.igual, JSON.stringify(s7));
  chk('Sin errores de JavaScript (costos)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 7 · Usuario sin administración en Historia → Pedidos ═══════════════
  ({ ctx, p, errs } = await abrir(nav, 'user'));
  await p.evaluate(() => abrirHistorialPedidos('PED-003-ab12')); await p.waitForTimeout(250);
  const u = await p.evaluate(() => ({ eliminarTodos: !!Array.from(document.querySelectorAll('#tabContent button')).find(b => /Eliminar todos/.test(b.innerText)), abierta: document.querySelectorAll('.ped-c--abierto').length, comp: !!document.querySelector('.ped-c__acc .bt--primario') }));
  chk('Un usuario ve el historial y puede compartir, pero no tiene «Eliminar todos» (la regla de administración se conserva)', !u.eliminarTodos && u.abierta === 1 && u.comp, JSON.stringify(u));
  chk('Sin errores de JavaScript (usuario)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 8 · Escritorio claro/oscuro ═════════════════════════════════════════
  for (const tema of ['light', 'dark']) {
    ({ ctx, p, errs } = await abrir(nav, 'admin', 1280));
    await p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); abrirHistorialPedidos('PED-003-ab12'); }, tema); await p.waitForTimeout(250);
    const d = await p.evaluate(() => { const c = document.querySelector('.ped-c--abierto'); const bg = getComputedStyle(c).backgroundColor, bd = getComputedStyle(c).borderTopColor; return { bg, bd, filas: c.querySelectorAll('.ped-tabla tbody tr').length }; });
    chk(`[PC ${tema}] La tarjeta abierta tiene fondo y borde propios y muestra el pedido completo`, d.bg !== 'rgba(0, 0, 0, 0)' && d.bd !== 'rgba(0, 0, 0, 0)' && d.filas === 3, JSON.stringify(d));
    await ctx.close();
  }

  await nav.close();
  const w = Math.max(...C.map(c => c.n.length));
  console.log('\n  ── v5.47 · Pedidos = Pedido sugerido · Historia con Inventario | Pedidos · precio de la última compra ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
  const fallos = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
