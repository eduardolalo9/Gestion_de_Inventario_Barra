// v5.23 — Diseño de Inicio y Conteo (Chromium real, 390×844, tema oscuro y claro).
//   · Inicio: tablero (saludo, inventario, alertas, pedido sugerido, módulos) sobre el panel de siempre;
//   · "Generar" agrega al carrito la cantidad sugerida y abre el pedido;
//   · Conteo: encabezado con medidor, tarjetas Capturado/Pendiente;
//   · hoja de captura: paso ±, total en vivo (misma convertirOzAPuntos), Guardar y siguiente, cerrar sin guardar;
//   · la barra inferior no cambió; sin desborde; contraste y objetivos táctiles.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.roleId = 'ADMIN'; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = [
      { id: 'DJ7', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'PZA', stockMinimo: 4, conversion: 700, capacidadMl: 700, pesoBotellaLlenaOz: 53.65, conteoOzHabilitado: true, precio: 1480, proveedor: 'LICORES SA', stockByArea: { almacen: 1, barra1: 0, barra2: 0 } },
      { id: 'ACE', name: 'ACEITUNA SIN HUESO', group: 'ABARROTES', unit: 'KGS', stockMinimo: 3, conversion: 1, precio: 180, stockByArea: { almacen: 1.7 } },
      { id: 'LYC', name: 'LYCHEES EN ALMIBAR', group: 'FRUTA', unit: 'LATA', stockMinimo: 2, conversion: 1, precio: 60, stockByArea: {} },
      { id: 'LIM', name: 'LIMON CON SEMILLA', group: 'FRUTA Y VERDURA', unit: 'KGS', stockMinimo: 5, conversion: 1, precio: 32, stockByArea: { almacen: 8.5 } }];
    _auditoriaSessionId = 'S1'; _inventarioActivoCarga = 'ok';
    _inventarioActivo = { numero: 1001, estado: 'SINCRONIZADO', fechaCreacion: Date.now(), creadoPorNombre: 'Eduardo', creadoPorRol: 'ADMIN', fechaRecuento: '2026-10-02', semanaId: '2026-09-28', warehousesSnapshot: ['almacen', 'barra1', 'barra2'] };
    myAuditoriaConteo = { ACE: { barra2: { enteras: 1.7, abiertas: [] } }, LIM: { barra2: { enteras: 8.5, abiertas: [] } } }; auditoriaConteo = myAuditoriaConteo;
    allUsersAuditoria = { u1: { conteo: { ACE: {}, LIM: {} } } };
    auditoriaStatus = { almacen: 'completada', barra1: 'completada', barra2: 'pendiente' };
    cart = []; orders = [];
    window.showConfirm = function (m, cb) { window.__confirm = String(m); cb(); };
    window.showNotification = function (m) { (window.__avisos = window.__avisos || []).push(String(m)); };
    window.__m = {
      rgb: s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number),
      lum: ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); },
      efectivo(el) {
        const cadena = []; for (let e = el; e; e = e.parentElement) cadena.push(e);
        let base = this.rgb(getComputedStyle(document.documentElement).backgroundColor); if (base.length < 3 || (base.length === 4 && base[3] === 0)) base = [255, 255, 255];
        base = base.slice(0, 3);
        for (let i = cadena.length - 1; i >= 0; i--) { const c = this.rgb(getComputedStyle(cadena[i]).backgroundColor); if (c.length < 3) continue; const a = c.length === 4 ? c[3] : 1; if (a > 0) base = [0, 1, 2].map(k => c[k] * a + base[k] * (1 - a)); }
        return base;
      },
      contraste(el) { const fg = this.rgb(getComputedStyle(el).color).slice(0, 3); const a = this.lum(fg), b = this.lum(this.efectivo(el)); return +((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2); },
      alto(el) { return +el.getBoundingClientRect().height.toFixed(1); }
    };
  });
  const tema = t => p.evaluate(t => document.documentElement.setAttribute('data-theme', t), t);
  const irInicio = () => p.evaluate(() => { activeTab = 'inicio'; renderTab(); });

  // ══ A · INICIO ═══════════════════════════════════════════════════════════
  await tema('dark'); await irInicio(); await p.waitForTimeout(300);
  const a = await p.evaluate(() => {
    const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
    return {
      hero: !!q('.it-inv'), grande: (q('.it-inv__grande') || {}).textContent, de: (q('.it-inv__de') || {}).textContent,
      segs: qa('.it-medidor__seg').length, segsOn: qa('.it-medidor__seg--on').length,
      areas: qa('.it-area').map(x => x.textContent.replace(/\s+/g, ' ').trim()),
      alertas: qa('.it-alerta__n').map(x => x.textContent.trim()),
      pedido: (q('.it-pedido') || {}).textContent, modulos: qa('.it-modulo__t').map(x => x.textContent.trim()),
      btab: qa('#bottomTabBar .btab-item').map(x => x.getAttribute('aria-label')),
      pmInv: !!q('.pm-inv'), tiles: qa('.pm-tile').length, tarjetas: qa('.prd-card').length,
      desborde: document.documentElement.scrollWidth > window.innerWidth,
      orden: (() => { const h = q('.it-tablero'), pnl = q('#pm-panel'), l = q('.prd-card'); return !!(h && pnl && l) && (h.compareDocumentPosition(pnl) & 4) && (pnl.compareDocumentPosition(l) & 4) ? true : false; })()
    };
  });
  chk('★ Inicio pinta la tarjeta del inventario con 2 de 4 contados (la unión entre personas)', a.hero && a.grande === '2' && /4/.test(a.de), JSON.stringify([a.grande, a.de]));
  chk('★ El medidor tiene 12 tramos y 6 encendidos (2 de 4 = 50 %)', a.segs === 12 && a.segsOn === 6, JSON.stringify([a.segs, a.segsOn]));
  chk('★ Las 3 áreas salen con su estado: completada, completada y en conteo',
      a.areas.length === 3 && /Almacén.*Completada/.test(a.areas[0]) && /Barra Restaurante.*Completada/.test(a.areas[1]) && /Barra Bar.*2.*En conteo/.test(a.areas[2]), JSON.stringify(a.areas));
  chk('Alertas: Limitado, Advertencia y Bajo mínimo suman los productos en alerta', a.alertas.length === 3 && a.alertas.every(x => /^\d+$/.test(x)), JSON.stringify(a.alertas));
  chk('Existe "Pedido sugerido listo" con su cuenta', /Pedido sugerido listo/.test(a.pedido || ''), a.pedido);
  chk('★ Operación trae Inventario, Catálogo, Pedidos, Físico vs Sistema, Recetario y Ventas',
      ['Inventario', 'Catálogo', 'Pedidos', 'Físico vs Sistema', 'Recetario', 'Ventas'].every(m => a.modulos.includes(m)), JSON.stringify(a.modulos));
  chk('★ La barra inferior NO cambió: Inicio, Conteo, Pedidos, Compras, Más', JSON.stringify(a.btab) === JSON.stringify(['Inicio', 'Conteo', 'Pedidos', 'Compras', 'Más opciones']), JSON.stringify(a.btab));
  chk('El tablero va primero; después el panel de indicadores y el catálogo de siempre', a.orden === true && a.tiles >= 4 && a.tarjetas === 4, JSON.stringify([a.orden, a.tiles, a.tarjetas]));
  chk('El panel de indicadores ya no repite la tarjeta de inventario', a.pmInv === false);
  chk('Sin desplazamiento horizontal en 390 px', a.desborde === false);

  for (const t of ['dark', 'light']) {
    await tema(t); await p.waitForTimeout(120);
    const c = await p.evaluate(() => {
      const casos = { saludo: '.it-saludo__titulo', rol: '.it-saludo__rol', etq: '.it-inv__etq', grande: '.it-inv__grande', area: '.it-area__nombre', nArea: '.it-area__n',
        ok: '.it-area__estado--ok', info: '.it-area__estado--info', btn: '.it-btn--primario', alN: '.it-alerta--danger .it-alerta__n', alT: '.it-alerta__t',
        pedT: '.it-pedido__t', pedS: '.it-pedido__s', modT: '.it-modulo__t', modS: '.it-modulo__s', enlace: '.it-enlace', secT: '.it-seccion__titulo', btnSec: '.it-btn--sec' };
      const o = {}; for (const k in casos) { const e = document.querySelector(casos[k]); o[k] = e ? __m.contraste(e) : null; } return o;
    });
    const malos = Object.entries(c).filter(([, v]) => v === null || v < 4.5);
    chk('★ Inicio, tema ' + t + ': todo el texto del tablero con contraste >= 4.5:1', malos.length === 0, JSON.stringify(malos));
  }
  await tema('dark');
  const tact = await p.evaluate(() => [...document.querySelectorAll('.it-btn, .it-enlace, .it-modulo')].map(e => [e.className, __m.alto(e)]));
  chk('★ Botones, enlace y módulos del tablero miden >= 44 px de alto', tact.length >= 9 && tact.every(x => x[1] >= 44), JSON.stringify(tact.filter(x => x[1] < 44)));

  // Módulos: navegan
  await p.evaluate(() => document.querySelectorAll('.it-modulo')[1].click());
  chk('"Catálogo" lleva a la pestaña del catálogo', await p.evaluate(() => activeTab) === 'productos');
  await irInicio();
  await p.evaluate(() => [...document.querySelectorAll('.it-modulo')].find(x => /Físico vs Sistema/.test(x.textContent)).click());
  chk('"Físico vs Sistema" abre esa vista dentro de Conteo', await p.evaluate(() => activeTab === 'inventario' && auditoriaView === 'fisico_vs_sistema'));
  await p.evaluate(() => { auditoriaView = 'selection'; });
  await irInicio();

  // Generar pedido sugerido
  const antes = await p.evaluate(() => ({ cart: cart.length, ped: pedidoSugeridoProducto(products[0]) }));
  await p.evaluate(() => { window.openOrderModal = function () { window.__abrioPedido = true; }; document.querySelector('.it-pedido .it-btn').click(); });
  await p.waitForTimeout(150);
  const gen = await p.evaluate(() => ({ cart: cart.map(c => [c.id, c.quantity]), msg: window.__confirm, abrio: !!window.__abrioPedido,
                                         esperado: products.map(p => [p.id, pedidoSugeridoProducto(p)]).filter(x => typeof x[1] === 'number' && x[1] > 0) }));
  chk('★ "Generar" pide confirmación y agrega al carrito la cantidad sugerida de CADA producto (la misma función de siempre)',
      /Se agregarán al carrito/.test(gen.msg || '') && antes.cart === 0 && gen.cart.length === gen.esperado.length && gen.esperado.every(e => gen.cart.some(c => c[0] === e[0] && c[1] === e[1])), JSON.stringify(gen));
  chk('Después de generar abre el pedido', gen.abrio === true);
  await p.evaluate(() => { cart = []; });

  // ══ B · CONTEO: ENCABEZADO Y TARJETAS ════════════════════════════════════
  await p.evaluate(() => { activeTab = 'inventario'; auditoriaView = 'counting'; auditoriaAreaActiva = 'barra2'; isAuditoriaMode = true; selectedArea = 'barra2'; renderTab(); });
  await p.waitForTimeout(300);
  const b = await p.evaluate(() => {
    const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
    const cards = qa('.inv-card').map(c => [c.querySelector('.inv-card__name').textContent.trim(), c.querySelector('.inv-card__estado').textContent.trim()]);
    return { area: (q('.audit-count-area-badge') || {}).textContent, sub: (q('.cnt-cab__sub') || {}).textContent, n: (q('.cnt-cab__n') || {}).textContent, de: (q('.cnt-cab__de') || {}).textContent,
      u: (q('.cnt-cab__u') || {}).textContent, pill: (q('.audit-count-header .it-pill') || {}).textContent, segs: qa('.audit-count-header .it-medidor__seg').length,
      segsOn: qa('.audit-count-header .it-medidor__seg--on').length, cards, volver: !!q('.audit-back-btn'), altoVolver: __m.alto(q('.audit-back-btn')),
      desborde: document.documentElement.scrollWidth > window.innerWidth };
  });
  chk('★ Encabezado: área, inventario y fecha', /Barra Bar/.test(b.area || '') && /Inventario #1001 · 2026-10-02/.test(b.sub || ''), JSON.stringify([b.area, b.sub]));
  chk('★ Encabezado: "2 / 4 CAPTURADOS" y medidor de 12 tramos con 6 encendidos', b.n === '2' && /4/.test(b.de) && /Capturados/i.test(b.u) && b.segs === 12 && b.segsOn === 6, JSON.stringify(b));
  chk('Encabezado: píldora "Conteo ciego" y botón volver de >= 44 px', /Conteo ciego/.test(b.pill || '') && b.volver && b.altoVolver >= 44, JSON.stringify([b.pill, b.altoVolver]));
  chk('★ Cada tarjeta dice Capturado o Pendiente según tenga cantidad',
      b.cards.length === 4 && b.cards.filter(c => c[1] === 'Capturado').map(c => c[0]).sort().join() === 'ACEITUNA SIN HUESO,LIMON CON SEMILLA' && b.cards.filter(c => c[1] === 'Pendiente').length === 2, JSON.stringify(b.cards));
  chk('Conteo sin desplazamiento horizontal', b.desborde === false);

  for (const t of ['dark', 'light']) {
    await tema(t); await p.waitForTimeout(120);
    const c = await p.evaluate(() => {
      const casos = { area: '.audit-count-area-badge', sub: '.cnt-cab__sub', n: '.cnt-cab__n', u: '.cnt-cab__u', pill: '.audit-count-header .it-pill', volver: '.audit-back-btn',
        nombre: '.inv-card__name', estadoOk: '.inv-card__estado--ok', totalN: '.has-data .inv-card__total-n' };
      const o = {}; for (const k in casos) { const e = document.querySelector(casos[k]); o[k] = e ? __m.contraste(e) : null; } return o;
    });
    const malos = Object.entries(c).filter(([, v]) => v === null || v < 4.5);
    chk('★ Conteo, tema ' + t + ': encabezado y tarjetas con contraste >= 4.5:1', malos.length === 0, JSON.stringify(malos));
  }
  await tema('dark');

  // ══ C · HOJA DE CAPTURA ══════════════════════════════════════════════════
  await p.evaluate(() => openInventarioModal('DJ7')); await p.waitForTimeout(350);
  const m0 = await p.evaluate(() => ({ titulo: document.getElementById('inventarioModalTitle').textContent, mono: document.getElementById('inventarioModalMono').textContent.trim(),
    total: document.getElementById('inv_totalValor').textContent, det: document.getElementById('inv_totalDetalle').textContent, uni: document.getElementById('inv_totalUnidad').textContent,
    cerrar: __m.alto(document.querySelector('.inv-modal__cerrar')), mas: __m.alto(document.querySelector('.inv-paso__btn--mas')), menos: __m.alto(document.querySelector('.inv-paso__btn')),
    guardar: __m.alto(document.getElementById('inv_guardarBtn')), guardarTxt: document.getElementById('inv_guardarBtn').textContent.trim() }));
  chk('★ La hoja abre con monograma, producto y total en 0.00 botellas', m0.titulo === 'DON JULIO 70' && m0.mono === 'DJ7' && m0.total === '0.00' && /botellas/i.test(m0.uni) && /0 enteras/.test(m0.det), JSON.stringify(m0));
  chk('★ Objetivos de la hoja: cerrar >= 44, − / + >= 52, guardar >= 50', m0.cerrar >= 44 && m0.mas >= 52 && m0.menos >= 52 && m0.guardar >= 50, JSON.stringify(m0));
  chk('El botón principal dice "Guardar y siguiente"', m0.guardarTxt === 'Guardar y siguiente');

  await p.click('.inv-paso__btn--mas'); await p.click('.inv-paso__btn--mas'); await p.click('.inv-paso__btn--mas');
  await p.click('.inv-paso__btn:not(.inv-paso__btn--mas)');
  const paso = await p.evaluate(() => ({ v: document.getElementById('inv_enteras').value, t: document.getElementById('inv_totalValor').textContent }));
  chk('★ El paso ± suma y resta botellas enteras y el total se mueve (3 + 3 − 1 = 2)', paso.v === '2' && paso.t === '2.00', JSON.stringify(paso));
  await p.evaluate(() => { document.getElementById('inv_enteras').value = '0'; });
  await p.click('.inv-paso__btn:not(.inv-paso__btn--mas)');
  chk('★ El paso nunca baja de 0', await p.evaluate(() => document.getElementById('inv_enteras').value) === '0');

  await p.fill('#inv_enteras', '8'); await p.fill('#inv_abierta_0', '24.5');
  const vivo = await p.evaluate(() => ({ t: document.getElementById('inv_totalValor').textContent, d: document.getElementById('inv_totalDetalle').textContent,
    esperado: (8 + convertirOzAPuntos(24.5, 700, 53.65)).toFixed(2), frac: convertirOzAPuntos(24.5, 700, 53.65).toFixed(2) }));
  chk('★ El total en vivo = enteras + convertirOzAPuntos(oz): la MISMA conversión de siempre', vivo.t === vivo.esperado && new RegExp('8 enteras \\+ ' + vivo.frac.replace('.', '\\.') + ' de la abierta').test(vivo.d), JSON.stringify(vivo));
  await p.click('.inv-modal__agregar'); await p.fill('#inv_abierta_1', '24.5');
  const dos = await p.evaluate(() => ({ t: document.getElementById('inv_totalValor').textContent, d: document.getElementById('inv_totalDetalle').textContent, esperado: (8 + 2 * convertirOzAPuntos(24.5, 700, 53.65)).toFixed(2) }));
  chk('Con una segunda abierta suma las dos y lo dice en plural', dos.t === dos.esperado && /de las abiertas/.test(dos.d), JSON.stringify(dos));

  // Cerrar con la X no guarda
  const previo = await p.evaluate(() => JSON.stringify(myAuditoriaConteo.DJ7 || null));
  await p.click('.inv-modal__cerrar'); await p.waitForTimeout(200);
  const cerrado = await p.evaluate(() => ({ oculto: document.getElementById('inventarioModal').classList.contains('hidden'), igual: JSON.stringify(myAuditoriaConteo.DJ7 || null) }));
  chk('★ La X cierra SIN guardar y SIN saltar al siguiente', cerrado.oculto && cerrado.igual === previo, JSON.stringify(cerrado));

  // Guardar y siguiente: DJ7 → ACE
  await p.evaluate(() => openInventarioModal('DJ7')); await p.waitForTimeout(250);
  await p.fill('#inv_enteras', '8'); await p.fill('#inv_abierta_0', '24.5');
  await p.click('#inv_guardarBtn'); await p.waitForTimeout(500);
  const sig = await p.evaluate(() => ({ g: myAuditoriaConteo.DJ7 && myAuditoriaConteo.DJ7.barra2, titulo: document.getElementById('inventarioModalTitle').textContent,
    abierto: !document.getElementById('inventarioModal').classList.contains('hidden'), id: inventarioModalProductId,
    valor: document.getElementById('inv_cantidadTotal').value, bloqueCant: getComputedStyle(document.getElementById('inv_bloqueCantidad')).display }));
  chk('★ "Guardar y siguiente" guarda 8 enteras + 24.5 oz con la lógica de siempre', sig.g && sig.g.enteras === 8 && sig.g.abiertas.length === 1 && sig.g.abiertas[0] === 24.5, JSON.stringify(sig.g));
  chk('★ …y abre el siguiente producto de la lista (ACEITUNA, modo cantidad, con su valor)', sig.abierto && sig.titulo === 'ACEITUNA SIN HUESO' && sig.id === 'ACE' && sig.valor === '1.7' && sig.bloqueCant !== 'none', JSON.stringify(sig));
  const tcant = await p.evaluate(() => ({ t: document.getElementById('inv_totalValor').textContent, u: document.getElementById('inv_totalUnidad').textContent }));
  chk('En modo cantidad el total en vivo es la cantidad y su unidad (KGS)', tcant.t === '1.7' && tcant.u === 'KGS', JSON.stringify(tcant));

  // Validación: un valor inválido NO guarda y NO salta
  await p.evaluate(() => { document.getElementById('inv_cantidadTotal').value = '-3'; });   // el saneado quita el '-' al teclear; así llega un valor inválido de verdad
  await p.evaluate(() => { window.__avisos = []; });
  await p.click('#inv_guardarBtn'); await p.waitForTimeout(250);
  const inv = await p.evaluate(() => ({ abierto: !document.getElementById('inventarioModal').classList.contains('hidden'), id: inventarioModalProductId, ace: JSON.stringify(myAuditoriaConteo.ACE.barra2), avisos: window.__avisos }));
  chk('★ Un valor inválido sigue bloqueado: no guarda, no cierra y no salta de producto', inv.abierto && inv.id === 'ACE' && inv.ace === JSON.stringify({ enteras: 1.7, abiertas: [] }) && inv.avisos.some(x => /mayor o igual a 0|número/.test(x)), JSON.stringify(inv));
  await p.evaluate(() => closeInventarioModal());

  // Último producto: guarda y cierra
  await p.evaluate(() => openInventarioModal('LIM')); await p.waitForTimeout(250);
  await p.fill('#inv_cantidadTotal', '9');
  await p.click('#inv_guardarBtn'); await p.waitForTimeout(400);
  const ult = await p.evaluate(() => ({ cerrado: document.getElementById('inventarioModal').classList.contains('hidden'), v: myAuditoriaConteo.LIM.barra2.enteras }));
  chk('★ En el último producto guarda y cierra (no se queda en bucle)', ult.cerrado && ult.v === 9, JSON.stringify(ult));

  // Con filtro "Sin contar": el siguiente se fija antes de guardar
  await p.evaluate(() => { myAuditoriaConteo = { }; auditoriaConteo = myAuditoriaConteo; renderTab(); });
  await p.waitForTimeout(200);
  await p.evaluate(() => { const b = document.querySelector('[data-sbx-filtro="sinContar"]'); if (b) b.click(); });
  await p.waitForTimeout(250);
  const lista = await p.evaluate(() => [...document.querySelectorAll('.inv-card .inv-card__name')].map(x => x.textContent.trim()));
  await p.evaluate(() => openInventarioModal(document.querySelector('.inv-card').getAttribute('aria-label') ? products.find(p => 'Contar ' + p.name === document.querySelector('.inv-card').getAttribute('aria-label')).id : 'DJ7'));
  await p.waitForTimeout(250);
  const primero = await p.evaluate(() => inventarioModalProductId);
  await p.evaluate(() => { const e = document.getElementById('inv_cantidadTotal'); if (e && getComputedStyle(document.getElementById('inv_bloqueCantidad')).display !== 'none') e.value = '2'; else { document.getElementById('inv_enteras').value = '2'; } });
  await p.click('#inv_guardarBtn'); await p.waitForTimeout(500);
  const conFiltro = await p.evaluate(() => ({ id: inventarioModalProductId, abierto: !document.getElementById('inventarioModal').classList.contains('hidden') }));
  chk('★ Con el filtro "Sin contar" activo, "siguiente" es el que seguía en la lista (no se salta ninguno)',
      lista.length >= 3 && conFiltro.abierto && (await p.evaluate(([l, pr]) => { const ids = l.map(n => products.find(p => p.name === n).id); return ids[ids.indexOf(pr) + 1] === inventarioModalProductId; }, [lista, primero])), JSON.stringify({ lista, primero, conFiltro }));
  await p.evaluate(() => closeInventarioModal());

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();
  const w = Math.max.apply(null, C.map(c => c.n.length)); let f = 0;
  console.log('\n  ── Diseño de Inicio y Conteo (navegador) ──\n');
  C.forEach(c => { if (!c.ok) f++; console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)); });
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - f) + ' pasaron · ' + f + ' fallaron\n');
  process.exit(f ? 1 : 0);
})();
