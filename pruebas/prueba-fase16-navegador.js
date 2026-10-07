// v5.19 — Total publicado, cortesías/2x1 y papelera, en Chromium real (390×844).
//   · El bartender ve el Total publicado por administración (tarjeta y ficha).
//   · Administración publica UN documento sin dinero, y no repite si no cambió.
//   · Ventas: cortesías y copas de regalo 2x1 separadas, con su costo.
//   · Papelera: borrar un producto exige copia en el servidor; sin señal o si
//     la copia falla, no se borra. La pantalla lista y restaura.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctxNav = await nav.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctxNav.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    window.__confirm = [];
    window.showConfirm = function (m, cb) { window.__confirm.push(String(m)); cb(); };
    window.__avisos = [];
    const sn = window.showNotification; window.showNotification = function (m) { window.__avisos.push(String(m)); try { sn(m); } catch (_) {} };
    if (typeof firebase === 'undefined') window.firebase = {};
    firebase.firestore = firebase.firestore || {};
    firebase.firestore.FieldValue = firebase.firestore.FieldValue || {};
    firebase.firestore.FieldValue.serverTimestamp = () => ({ __ts: 'servidor' });
    // Firestore de mentira que anota todo lo que se escribe.
    window.__ops = []; window.__falla = null;
    const ref = (ruta) => ({
      id: ruta.split('/').pop(), path: ruta,
      collection: (c) => col(ruta + '/' + c),
      set: async (d) => { if (window.__falla) throw window.__falla; window.__ops.push({ op: 'set', ruta, d: JSON.parse(JSON.stringify(d)) }); },
      update: async (d) => { window.__ops.push({ op: 'update', ruta, d }); },
      get: async () => ({ exists: false, data: () => null }),
      onSnapshot: () => () => {}
    });
    const col = (ruta) => { const q = { doc: (id) => ref(ruta + '/' + id), get: async () => ({ empty: true, docs: [], forEach() {} }), onSnapshot: () => () => {} };
      ['where', 'orderBy', 'limit'].forEach(k => { q[k] = () => q; }); return q; };
    window.__db = {
      collection: (c) => col(c),
      batch: () => { const ops = []; return {
        set: (r, d) => ops.push({ op: 'set', ruta: r.path, d: JSON.parse(JSON.stringify(d)) }),
        update: (r, d) => ops.push({ op: 'update', ruta: r.path, d }),
        delete: (r) => ops.push({ op: 'delete', ruta: r.path }),
        commit: async () => { if (window.__falla) throw window.__falla; ops.forEach(o => window.__ops.push(o)); } }; }
    };
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
    window.__como = (rol) => {
      currentUserUid = rol === 'admin' ? 'u-admin' : 'u-bar'; _authzState.loaded = true; _authzState.overrides = {};
      _authzState.permissions = new Set(rol === 'admin' ? ['*'] : ['inventory.count', 'inventory.viewOwn', 'catalog.read', 'recipe.read']);
      _authzState.roleId = rol === 'admin' ? 'ADMIN' : 'BARTENDER';
      currentUserRole = rol === 'admin' ? 'admin' : 'user';
      if (typeof applyRoleUI === 'function') applyRoleUI();
    };
    const hoy = new Date(); const f = (n) => { const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n); return fechaISOLocal(d); };
    window.__fCorte = f(-3); window.__fPost = f(-1);
    products = [{ id: 'T1', name: 'TEQUILA DON JULIO', unit: 'PZA', group: 'TEQUILA', precio: 300, stockByArea: { almacen: 1 } },
                { id: 'L1', name: 'LIMON', unit: 'KGS', group: 'FRUTA', precio: 40, stockByArea: { almacen: 9 } }];
    recetas = [{ pv: 'PV1', nombre: 'MARGARITA', ingredientes: [{ productoId: 'T1', cantidad: 0.06, uom: 'PZA' }, { productoId: 'L1', cantidad: 0.02, uom: 'KGS' }] },
               { pv: 'PVC', nombre: 'CORTESIA', ingredientes: [{ productoId: 'T1', cantidad: 0.03, uom: 'PZA' }] }];
    window.__ponerCorte = () => {
      _existenciaInicial = { semana: semanaId(new Date()), estado: 'ok', saldos: { T1: 3, L1: 2 }, origen: { numero: 1010 },
                             ancla: { tipo: 'mitad_de_semana', fecha: window.__fCorte, id: window.__fCorte, ruta: 'arrastre', dias: 3 } };
    };
  });

  // ═══ 1 · Menú ═════════════════════════════════════════════════════════════
  await p.evaluate(() => __como('bartender'));
  chk('El bartender NO ve "Papelera" en el menú', await p.evaluate(() => getComputedStyle(document.getElementById('sbPapeleraBtn')).display === 'none'));
  await p.evaluate(() => __como('admin'));
  chk('★ Administración ve "Papelera" en el menú', await p.evaluate(() => getComputedStyle(document.getElementById('sbPapeleraBtn')).display !== 'none'));

  // ═══ 2 · Administración publica el Total ═══════════════════════════════════
  const pub = await p.evaluate(async () => {
    _db = __db; __ponerCorte();
    _existenciaArrastre = { anclaFecha: __fCorte, version: 99, comprasNoDisponibles: false, ventasNoDisponibles: false,
      compras: [{ tipo: 'compra', productoId: 'T1', cantidad: 2, fecha: __fPost, semanaId: semanaId(__fPost) }],
      periodos: [{ id: __fPost + '_' + __fPost, inicio: __fPost, fin: __fPost, lineas: [{ sku: 'PV1', cantidad: 10 }] }] };
    _existenciaArrastreMemo = { clave: null };
    __ops = [];
    const r1 = await totalPublicadoPublicarAhora();
    const r2 = await totalPublicadoPublicarAhora();
    const op = __ops.find(o => /totalPublicado\/actual$/.test(o.ruta));
    return { r1, r2, op, n: __ops.length, valorAdmin: existenciaMostrada(products[0]) };
  });
  chk('★ Administración publica UN documento en totalPublicado/actual', pub.r1.ok && pub.op && pub.n === 1, JSON.stringify(pub.r1));
  chk('Con su Total (3 + 2 − 10×0.06 = 4.4) y la hora del servidor', pub.op && pub.op.d.valores.T1[0] === 4.4 && pub.op.d.publicadoEn && pub.op.d.publicadoEn.__ts === 'servidor' && pub.valorAdmin === 4.4, JSON.stringify(pub.op && pub.op.d.valores));
  chk('★ Sin dinero en el documento (ni precio ni importes)', pub.op && !/precio|costo|importe|ventaNeta|"300"|:300\b/.test(JSON.stringify(pub.op.d)));
  chk('Si nada cambió no vuelve a escribir (batería y datos)', pub.r2.ok === false && pub.r2.motivo === 'sin_cambios', JSON.stringify(pub.r2));

  // ═══ 3 · El bartender usa el publicado ═════════════════════════════════════
  const bar = await p.evaluate((doc) => {
    __como('bartender');
    _existenciaArrastre = { anclaFecha: __fCorte, version: 100, comprasNoDisponibles: true, ventasNoDisponibles: true, compras: [], periodos: [] };
    _existenciaArrastreMemo = { clave: null };
    const antes = existenciaMostrada(products[0]);
    _totalPublicado = { estado: 'ok', datos: Object.assign({}, doc, { publicadoEn: { seconds: Math.floor(Date.now() / 1000) - 600 } }), unsub: () => {} };
    const despues = existenciaMostrada(products[0]);
    activeTab = 'inicio'; renderTab();
    const card = [...document.querySelectorAll('.pm-card')].find(c => /Origen del Total/.test(c.innerText));
    abrirFichaProducto('T1');
    const ficha = document.querySelector('.pm-ficha');
    const r = { antes, despues, card: card ? card.innerText : '', ficha: ficha ? ficha.innerText : '',
                aviso: card && card.querySelector('.pm-aviso--info') ? __m.contraste(card.querySelector('.pm-aviso--info span')) : 0 };
    cerrarFichaProducto();
    return r;
  }, pub.op && pub.op.d);
  chk('Sin el publicado, el bartender veía otro Total (3: sin compras ni consumo)', bar.antes === 3, String(bar.antes));
  chk('★ Con el publicado, el bartender ve el MISMO Total que administración (4.4)', bar.despues === 4.4, String(bar.despues));
  chk('★ La tarjeta "Origen del Total" dice que viene publicado por administración y hace cuánto', /publicado por administración/.test(bar.card) && /hace 10 min/.test(bar.card), bar.card.slice(0, 300));
  chk('…y ya no dice "no se pudieron leer las compras ni las ventas"', !/No se pudieron leer/.test(bar.card));
  chk('La ficha del producto muestra el desglose publicado (saldo, entradas, consumo)', /Cifras publicadas por administración/.test(bar.ficha) && /−0\.6/.test(bar.ficha), bar.ficha.slice(0, 400));
  chk('El aviso contrasta ≥ 4.5', bar.aviso >= 4.5, String(bar.aviso));
  const sinPub = await p.evaluate(() => {
    _totalPublicado = { estado: 'no_existe', datos: null, unsub: () => {} };
    activeTab = 'inicio'; renderTab();
    const card = [...document.querySelectorAll('.pm-card')].find(c => /Origen del Total/.test(c.innerText));
    return card ? card.innerText : '';
  });
  chk('Sin Total publicado, el bartender ve un aviso claro (no incluye compras ni consumo)', /todavía no hay un Total publicado/.test(sinPub), sinPub.slice(0, 300));
  await p.evaluate(() => { _totalPublicado = { estado: 'sin_cargar', datos: null, unsub: null }; __como('admin'); });

  // ═══ 4 · Cortesías y promos 2x1 ═══════════════════════════════════════════
  const cz = await p.evaluate(() => {
    const parsed = _parsearExcelVentas([
      { Nombre: 'Margarita', SKU: 'PV1', Cantidad: 9, 'Venta neta': 900 },
      { Nombre: 'Margarita promo 2x1', SKU: 'PV1', Cantidad: 3, 'Venta neta': 0 },
      { Nombre: 'Bebida Cortesia', SKU: 'PVC', Cantidad: 5, 'Venta neta': 0 }]);
    _ventasImportPendiente = Object.assign(parsed, { periodo: { inicio: __fPost, fin: __fPost }, archivo: 'ventas.xlsx', hoja: 'Detalle' });
    ventasImportView = 'vista_previa'; activeTab = 'ventas'; renderTab();
    const nota = (document.querySelector('.vt-wrap') || {}).innerText || '';
    const etiquetas = [...document.querySelectorAll('.vt-regalo')].map(e => e.textContent);
    ventaTurnoSimular();
    const sec = document.getElementById('vtCzTit') ? document.getElementById('vtCzTit').closest('section') : null;
    const kpis = sec ? [...sec.querySelectorAll('.vt-sim__kpi')].map(k => k.innerText.replace(/\s+/g, ' ')) : [];
    return { nota, etiquetas, kpis, txt: sec ? sec.innerText : '', desborde: document.documentElement.scrollWidth - window.innerWidth,
             c: sec ? __m.contraste(sec.querySelector('.vt-ayuda')) : 0, cr: document.querySelector('.vt-regalo') ? __m.contraste(document.querySelector('.vt-regalo')) : 0 };
  });
  chk('★ La vista previa avisa: 5 cortesías y 3 copas de regalo 2x1 (y que descuentan inventario)', /Incluye 5 cortesía\(s\) y 3 copa\(s\) de regalo 2x1/.test(cz.nota), cz.nota.slice(0, 200));
  chk('Las líneas llevan su etiqueta ("3 de regalo 2x1", "5 cortesía")', cz.etiquetas.some(t => /3 de regalo 2x1/.test(t)) && cz.etiquetas.some(t => /5 cortesía/.test(t)), JSON.stringify(cz.etiquetas));
  chk('★ Simular separa cortesías y promos con su costo a precio de insumo ($45 + $56.40 = $101.40)',
      /Cortesías 5/.test(cz.kpis[0] || '') && /Copas de regalo 2x1 3/.test(cz.kpis[1] || '') && /101\.40/.test(cz.kpis[2] || ''), JSON.stringify(cz.kpis));
  chk('Dice que NO se costean contra la venta', /no se costean contra la venta/.test(cz.txt));
  chk('Sin desborde y contraste ≥ 4.5 (texto y etiqueta)', cz.desborde <= 0 && cz.c >= 4.5 && cz.cr >= 4.5, JSON.stringify([cz.desborde, cz.c, cz.cr]));
  const cztab = await p.evaluate(() => {
    _ventasImportPendiente = null; ventasImportView = 'lista';
    ventas = [{ sku: 'PV1', nombre: 'Margarita', cantidad: 12, ventaNeta: 900, promo: 3 }, { sku: 'PVC', nombre: 'Bebida Cortesia', cantidad: 5, ventaNeta: 0, cortesia: 5 }];
    ventasSemanaId = semanaId(new Date()); ventasPeriodos = [];
    if (typeof consumoTeoricoInvalidar === 'function') consumoTeoricoInvalidar();
    renderTab();
    const sec = document.getElementById('vtCzTit') ? document.getElementById('vtCzTit').closest('section') : null;
    return sec ? sec.innerText : '';
  });
  chk('La pestaña Ventas muestra el resumen de cortesías y promos de la semana', /Cortesías y promociones 2x1/.test(cztab) && /101\.40/.test(cztab), cztab.slice(0, 200));

  // ═══ 5 · Papelera: borrar un producto ════════════════════════════════════
  await ctxNav.setOffline(true);
  const off = await p.evaluate(async () => {
    __ops = []; __avisos = [];
    deleteProduct('L1'); await new Promise(r => setTimeout(r, 200));
    return { sigue: !!products.find(x => x.id === 'L1'), ops: __ops.length, aviso: __avisos.join(' | ') };
  });
  chk('★ Sin señal NO se borra el producto (primero va la copia a la papelera del servidor)', off.sigue && off.ops === 0 && /Sin conexión/.test(off.aviso), JSON.stringify(off));
  await ctxNav.setOffline(false);
  const falla = await p.evaluate(async () => {
    __ops = []; __avisos = []; __falla = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    deleteProduct('L1'); await new Promise(r => setTimeout(r, 300));
    __falla = null;
    return { sigue: !!products.find(x => x.id === 'L1'), aviso: __avisos.join(' | ') };
  });
  chk('★ Si el servidor rechaza la copia, NO se borra nada (y lo dice)', falla.sigue && /No se borró nada/.test(falla.aviso), JSON.stringify(falla));
  const ok = await p.evaluate(async () => {
    __ops = []; __avisos = [];
    deleteProduct('L1'); await new Promise(r => setTimeout(r, 300));
    const reg = __ops.find(o => /\/papelera\//.test(o.ruta));
    return { sigue: !!products.find(x => x.id === 'L1'), reg, aviso: __avisos.join(' | '), confirm: __confirm.slice(-2).join(' || ') };
  });
  chk('★ Con señal: primero la copia en papelera (producto completo, quién y cuándo) y después se borra',
      !ok.sigue && ok.reg && ok.reg.d.origen === 'producto' && ok.reg.d.contenido.productos[0].id === 'L1' && ok.reg.d.borradoPor === 'u-admin' && typeof ok.reg.d.borradoEn === 'number',
      JSON.stringify(ok.reg && ok.reg.d.resumen));
  chk('La confirmación ya no dice "NO se puede deshacer": dice que queda copia en la Papelera', /Queda una copia en la Papelera/.test(ok.confirm) && !/NO se puede deshacer/.test(ok.confirm), ok.confirm.slice(0, 200));

  // ═══ 6 · Papelera: pantalla y restaurar ══════════════════════════════════
  const scr = await p.evaluate((reg) => {
    _papelera = { estado: 'ok', error: null, accion: null, items: [
      Object.assign({ id: reg.ruta.split('/').pop() }, reg.d),
      { id: 'conteos_u1_1', origen: 'conteos', grupo: 'conteos_u1_1', parte: 1, partes: 1, uidAfectado: 'u1', emailAfectado: 'bar@x.com', resumen: { productos: 3, entradas: 5 }, borradoEn: Date.now() - 3600e3, contenido: { conteo: {} } },
      { id: 'reporte_r1_2', origen: 'reporte', grupo: 'reporte_r1_2', parte: 1, partes: 1, reporteId: 'r1', resumen: { titulo: 'Cierre' }, borradoEn: Date.now() - 40 * 86400e3, contenido: {}, restauradoEn: Date.now() - 86400e3 }
    ] };
    window.papeleraCargar = async function () {};
    activeTab = 'papelera'; renderTab();
    const items = [...document.querySelectorAll('.pap-item')];
    const btns = [...document.querySelectorAll('.pap-wrap button')];
    return { n: items.length, txt: document.querySelector('.pap-wrap').innerText, altos: btns.map(b => __m.alto(b)),
             desborde: document.documentElement.scrollWidth - window.innerWidth,
             cTit: __m.contraste(document.querySelector('.pap-item__tit')), cMeta: __m.contraste(document.querySelector('.pap-item__meta')),
             cBtn: __m.contraste(document.querySelector('[data-pap-restaurar]')), restaurados: document.querySelectorAll('.pap-item--hecho').length,
             vaciar: btns.some(b => /Vaciar 1 de más de 30 días/.test(b.innerText)) };
  }, ok.reg);
  chk('★ La Papelera lista los tres borrados (producto, conteos, reporte)', scr.n === 3 && /Producto eliminado/.test(scr.txt) && /bar@x\.com · 3 producto\(s\), 5 captura\(s\)/.test(scr.txt) && /Reporte publicado eliminado/.test(scr.txt), scr.txt.slice(0, 300));
  chk('Lo ya restaurado se marca y no ofrece "Restaurar"', scr.restaurados === 1 && /Restaurado el/.test(scr.txt));
  chk('Solo ofrece vaciar lo de más de 30 días', scr.vaciar);
  chk('Botones ≥ 44 px, sin desborde, contraste ≥ 4.5', scr.altos.every(a => a >= 44) && scr.desborde <= 0 && scr.cTit >= 4.5 && scr.cMeta >= 4.5 && scr.cBtn >= 4.5, JSON.stringify(scr));
  const rest = await p.evaluate(async () => {
    __ops = []; window.__publicado = 0;
    window.publicarCatalogoFirestore = async () => { window.__publicado++; return true; };
    const b = document.querySelector('[data-pap-restaurar^="producto_"]');
    b.click(); await new Promise(r => setTimeout(r, 400));
    return { vuelve: !!products.find(x => x.id === 'L1'), lapida: (typeof _deletedProductIds !== 'undefined') ? _deletedProductIds.indexOf('L1') : -2,
             marca: __ops.find(o => o.op === 'update' && /\/papelera\//.test(o.ruta)), publicado: window.__publicado, aviso: __avisos.slice(-1)[0] || '' };
  });
  chk('★ Restaurar devuelve el producto al catálogo y quita su lápida', rest.vuelve && rest.lapida === -1, JSON.stringify(rest));
  chk('…publica el catálogo y marca el registro como restaurado (quién y cuándo)', rest.publicado === 1 && rest.marca && rest.marca.d.restauradoPor === 'u-admin', JSON.stringify(rest.marca));
  for (const t of ['light']) {
    await p.evaluate(t => { document.documentElement.setAttribute('data-theme', t); renderTab(); }, t);
    const cl = await p.evaluate(() => [__m.contraste(document.querySelector('.pap-item__tit')), __m.contraste(document.querySelector('.pap-item__meta'))]);
    chk('[' + t + '] Papelera: contraste ≥ 4.5', cl.every(x => x >= 4.5), JSON.stringify(cl));
  }

  chk('Sin errores de JavaScript en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();
  let mal = 0; C.forEach(c => { if (!c.ok) mal++; console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  →  ' + c.d)); });
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron');
  process.exit(mal ? 1 : 0);
})();
