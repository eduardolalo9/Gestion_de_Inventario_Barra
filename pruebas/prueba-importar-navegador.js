// v5.18 — Módulo "Importar desde Excel" y detalle de compras por proveedor.
// Chromium real a 390×844 contra la app:
//   · el menú tiene "Importar desde Excel" y la pestaña muestra las 5 secciones;
//   · botones ≥ 44 px, sin desborde horizontal, contraste en oscuro y claro;
//   · catálogo: un archivo con errores deja "Aplicar" deshabilitado; uno válido
//     se aplica con las reglas de siempre y se publica en el mismo paso;
//   · corte de existencias: vista previa, fecha/hora, y al registrar se escribe
//     UN documento anclasExistencia/{fecha}_{HHmm} tipo importacion_excel;
//   · las pestañas ya no tienen botones de importar;
//   · compras: la tarjeta abre la ventana con los productos del proveedor.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })).newPage();
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
    currentUserUid = 'u-admin'; _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['*']); _authzState.roleId = 'ADMIN';
    products = [
      { id: '1180001', name: 'TEQUILA DON JULIO', unit: 'PZA', group: 'TEQUILA', precio: 350, conversion: 750, stockByArea: { almacen: 2 } },
      { id: '1020064', name: 'LIMON', unit: 'KGS', group: 'FRUTA', precio: 38, stockByArea: { almacen: 5 } },
      { id: '1060020', name: 'FRESCA', unit: 'PZA', group: 'REFRESCOS', precio: 12, stockByArea: { almacen: 10 } }
    ];
    window.__confirm = [];
    window.showConfirm = function (m, cb) { window.__confirm.push(String(m)); cb(); };
    window.__m = {
      rgb: s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number),
      lum: ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); },
      efectivo(el) {
        const cadena = []; for (let e = el; e; e = e.parentElement) cadena.push(e);
        let base = this.rgb(getComputedStyle(document.documentElement).backgroundColor); if (base.length < 3 || (base.length === 4 && base[3] === 0)) base = [255, 255, 255];
        base = base.slice(0, 3);
        for (let i = cadena.length - 1; i >= 0; i--) {
          const c = this.rgb(getComputedStyle(cadena[i]).backgroundColor);
          if (c.length < 3) continue; const a = c.length === 4 ? c[3] : 1;
          if (a > 0) base = [0, 1, 2].map(k => c[k] * a + base[k] * (1 - a));
        }
        return base;
      },
      contraste(el) { const fg = this.rgb(getComputedStyle(el).color).slice(0, 3); const a = this.lum(fg), b = this.lum(this.efectivo(el)); return +((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2); },
      alto(el) { return +el.getBoundingClientRect().height.toFixed(1); }
    };
    window.__ir = (t) => { activeTab = t; renderTab(); };
  });
  const tema = (t) => p.evaluate(t => document.documentElement.setAttribute('data-theme', t), t);

  // ═══ 1 · Menú y hub ════════════════════════════════════════════════════════
  const menu = await p.evaluate(() => {
    const it = document.querySelector('[data-sb-tab="importar"]');
    return it ? it.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  chk('★ El menú lateral tiene "Importar desde Excel"', menu && /Importar desde Excel/.test(menu), String(menu));

  await p.evaluate(() => { importarVolver(); __ir('importar'); }); await p.waitForTimeout(250);
  const hub = await p.evaluate(() => {
    const secs = [...document.querySelectorAll('.imp-sec')];
    const btns = [...document.querySelectorAll('#tabContent .imp-wrap button, .imp-wrap button')];
    return {
      secciones: secs.map(s => s.querySelector('.imp-sec__tit').textContent.trim()),
      subir: document.querySelectorAll('[data-imp-subir]').length,
      plantillas: [...document.querySelectorAll('[data-imp-plantilla]')].map(b => b.getAttribute('data-imp-plantilla')),
      altos: btns.map(b => __m.alto(b)),
      desborde: document.documentElement.scrollWidth - window.innerWidth,
      btnFuera: btns.filter(b => b.getBoundingClientRect().right > window.innerWidth + 1).length,
      partidos: [...document.querySelectorAll('[data-imp-plantilla]')].filter(b => b.getBoundingClientRect().height > 50).length
    };
  });
  chk('★ El módulo muestra las 5 secciones (catálogo, recetas, existencias, compras, ventas)', hub.secciones.length === 5, hub.secciones.join(' · '));
  chk('Cada sección tiene "Subir archivo"', hub.subir === 5, String(hub.subir));
  chk('★ Catálogo, recetas y existencias ofrecen plantilla .xlsx y .csv',
      ['catalogo:xlsx', 'catalogo:csv', 'recetas:xlsx', 'recetas:csv', 'existencias:xlsx', 'existencias:csv'].every(x => hub.plantillas.indexOf(x) !== -1), hub.plantillas.join(','));
  chk('★ Todos los botones del módulo miden ≥ 44 px', hub.altos.length > 0 && hub.altos.every(a => a >= 44), hub.altos.join(','));
  chk('Sin desborde horizontal a 390 px y ningún botón se sale', hub.desborde <= 0 && hub.btnFuera === 0, JSON.stringify(hub));
  chk('Los botones de plantilla no se parten en dos líneas', hub.partidos === 0, String(hub.partidos));

  for (const t of ['dark', 'light']) {
    await tema(t); await p.waitForTimeout(120);
    const c = await p.evaluate(() => {
      const q = s => document.querySelector(s);
      return { tit: __m.contraste(q('.imp-sec__tit')), desc: __m.contraste(q('.imp-sec__desc')), cab: __m.contraste(q('.imp-cab__tit')),
               subir: __m.contraste(q('[data-imp-subir]')), plantilla: __m.contraste(q('[data-imp-plantilla]')) };
    });
    chk('[' + t + '] Contraste: títulos y descripciones ≥ 4.5, botones ≥ 4.5', Object.values(c).every(x => x >= 4.5), JSON.stringify(c));
  }
  await tema('dark');

  // Plantilla descargable (xlsx real con SheetJS si está cargada; si no, csv)
  const desc = await p.evaluate(() => typeof XLSX !== 'undefined');
  const dl = p.waitForEvent('download', { timeout: 6000 }).catch(() => null);
  await p.click(desc ? '[data-imp-plantilla="existencias:xlsx"]' : '[data-imp-plantilla="existencias:csv"]');
  const d = await dl;
  chk('★ La plantilla del corte se descarga con nombre claro', d && /existencias/i.test(d.suggestedFilename()) && /\.(xlsx|csv)$/.test(d.suggestedFilename()), d ? d.suggestedFilename() : 'sin descarga');
  const dlc = p.waitForEvent('download', { timeout: 6000 }).catch(() => null);
  await p.click('[data-imp-plantilla="catalogo:csv"]');
  const dc = await dlc;
  let csv = '';
  if (dc) { const fs = require('fs'); csv = fs.readFileSync(await dc.path(), 'utf8'); }
  chk('La plantilla CSV del catálogo trae BOM, cabeceras validadas y el catálogo actual',
      csv.charCodeAt(0) === 0xFEFF && /^﻿ID,Nombre,Grupo,Unidad/.test(csv) && /1180001/.test(csv), csv.slice(0, 80));

  // ═══ 2 · Catálogo con errores → bloqueado ═════════════════════════════════
  await p.evaluate(() => importarProcesarFilas('catalogo', [
    { ID: '1180001', Nombre: 'TEQUILA DON JULIO 70', Grupo: 'TEQUILA', Unidad: 'PZA', Precio: 420 },
    { ID: '1180001', Nombre: 'DUPLICADO', Grupo: 'TEQUILA', Unidad: 'PZA' },
    { ID: '9', Nombre: 'SIN GRUPO', Unidad: 'PZA' },
    { ID: '10', Nombre: 'MAL', Grupo: 'RON', Unidad: 'PZA', Precio: 'abc' }
  ], 'catalogo-malo.xlsx'));
  await p.waitForTimeout(200);
  const cm = await p.evaluate(() => {
    const b = document.getElementById('impBtnAplicar');
    return { dis: b ? b.disabled : null, errores: document.querySelectorAll('.imp-msgs--error li').length,
             texto: (document.querySelector('.imp-wrap') || {}).innerText || '', desborde: document.documentElement.scrollWidth - window.innerWidth };
  });
  chk('★ Catálogo con duplicados, categoría vacía y número erróneo: errores visibles y "Aplicar" deshabilitado',
      cm.dis === true && cm.errores >= 3 && /duplicado/.test(cm.texto) && /sin Grupo/.test(cm.texto) && /no es un número/.test(cm.texto), JSON.stringify({ dis: cm.dis, e: cm.errores }));
  chk('La vista previa no desborda a 390 px', cm.desborde <= 0, String(cm.desborde));
  const antes = await p.evaluate(() => JSON.stringify(products));
  await p.evaluate(() => importarAplicarCatalogo()); await p.waitForTimeout(150);
  chk('Aunque se fuerce "Aplicar", con errores no cambia nada', await p.evaluate(() => JSON.stringify(products)) === antes);

  // ═══ 3 · Catálogo válido → aplica y publica en un paso ═════════════════════
  await p.evaluate(() => {
    window.__publicado = 0;
    _db = _db || { collection() { throw new Error('no se usa'); } };   // _db es let en index.html
    window.publicarCatalogoFirestore = async function () { window.__publicado++; return true; };
    importarCancelar();
    importarProcesarFilas('catalogo', [
      { ID: '1180001', Nombre: 'TEQUILA DON JULIO 70', Grupo: 'TEQUILA', Unidad: 'PZA', Precio: 420 },
      { ID: '1200300', Nombre: 'MEZCAL UNION', Grupo: 'MEZCAL', Unidad: 'PZA', Precio: 280 }
    ], 'catalogo-bueno.xlsx');
  });
  await p.waitForTimeout(200);
  const cb = await p.evaluate(() => { const b = document.getElementById('impBtnAplicar'); return { dis: b ? b.disabled : null, alto: b ? __m.alto(b) : 0 }; });
  chk('Catálogo válido: "Aplicar y publicar" habilitado y ≥ 44 px', cb.dis === false && cb.alto >= 44, JSON.stringify(cb));
  await p.click('#impBtnAplicar'); await p.waitForTimeout(900);
  const ca = await p.evaluate(() => ({
    tq: products.find(x => x.id === '1180001'), mz: products.find(x => x.id === '1200300'), n: products.length,
    publicado: window.__publicado, confirm: window.__confirm.slice(-1)[0] || '', tab: activeTab,
    res: (document.querySelector('.imp-wrap') || {}).innerText || ''
  }));
  chk('★ Aplica con las reglas de siempre: actualiza por ID y da de alta el nuevo, sin tocar el conteo por área',
      ca.tq && ca.tq.name === 'TEQUILA DON JULIO 70' && ca.tq.precio === 420 && ca.tq.stockByArea && ca.tq.stockByArea.almacen === 2 && ca.mz && ca.n === 4, JSON.stringify([ca.tq, ca.n]));
  chk('★ Y publica a todos los dispositivos en el mismo paso (una sola vez)', ca.publicado === 1, String(ca.publicado));
  chk('Se pide confirmación con altas y actualizaciones antes de aplicar', /APLICAR Y PUBLICAR/.test(ca.confirm) && /1 alta/.test(ca.confirm) && /1 actualizaci/.test(ca.confirm), ca.confirm.slice(0, 120));
  chk('Se queda en el módulo y muestra el resultado (no salta a Inicio)', ca.tab === 'importar' && /Catálogo aplicado/.test(ca.res) && /Publicado/.test(ca.res), ca.tab + ' · ' + ca.res.slice(0, 120));

  // ═══ 4 · Corte de existencias ═════════════════════════════════════════════
  await p.evaluate(() => {
    importarVolver();
    window.__sets = [];
    // Consulta falsa: cualquier lectura devuelve vacío (otras pantallas pueden consultar).
    const consulta = (ruta) => { const q = { doc: (id) => docRef(ruta + '/' + id), get: async () => ({ empty: true, docs: [], size: 0, forEach() {} }),
      onSnapshot: () => () => {} }; ['orderBy', 'where', 'limit', 'startAfter', 'endBefore'].forEach(k => { q[k] = () => q; }); return q; };
    const docRef = (ruta) => ({
      collection: (c) => consulta(ruta + '/' + c), onSnapshot: () => () => {},
      set: async (data) => { window.__sets.push({ ruta, data: JSON.parse(JSON.stringify(data)) }); },
      get: async () => ({ exists: false, data: () => null })
    });
    _db = { collection: (c) => consulta(c) };
    window._anclaPosteriorA = async () => ({ hay: false });
    window.existenciaCargarInicial = function () {};
    importarProcesarFilas('existencias', [
      { 'Código': '1180001', 'Producto': 'TEQUILA DON JULIO 70', 'Área': 'Almacén', Enteras: 2, Abierta: 0.75 },
      { 'Código': '1020064', 'Producto': 'LIMON', Enteras: 4.5 }
    ], 'corte.xlsx');
  });
  await p.waitForTimeout(250);
  const ep = await p.evaluate(() => {
    const b = document.getElementById('impBtnAplicar');
    return { fecha: (document.getElementById('impFecha') || {}).value, hora: (document.getElementById('impHora') || {}).value,
             dis: b ? b.disabled : null, kpis: [...document.querySelectorAll('.imp-kpi')].map(k => k.innerText.replace(/\s+/g, ' ')),
             texto: (document.querySelector('.imp-wrap') || {}).innerText || '', desborde: document.documentElement.scrollWidth - window.innerWidth,
             campos: [...document.querySelectorAll('#impFecha, #impHora')].map(i => __m.alto(i)) };
  });
  chk('★ Vista previa del corte: fecha y hora prellenadas (ahora) y "Registrar corte" habilitado',
      /^\d{4}-\d{2}-\d{2}$/.test(ep.fecha) && /^\d{2}:\d{2}$/.test(ep.hora) && ep.dis === false, JSON.stringify([ep.fecha, ep.hora, ep.dis]));
  chk('Explica que el corte vale al cierre del día', /al cierre de ese día/.test(ep.texto));
  chk('KPIs: contados, sin capturar, neto vs sistema, errores', ep.kpis.length === 4 && /Contados 2/.test(ep.kpis[0]), ep.kpis.join(' | '));
  chk('Fecha y hora ≥ 44 px y sin desborde', ep.campos.every(a => a >= 44) && ep.desborde <= 0, JSON.stringify([ep.campos, ep.desborde]));

  // Fecha futura → bloquea
  await p.evaluate(() => importarCambiarMomento('fecha', '2099-01-01')); await p.waitForTimeout(150);
  const fut = await p.evaluate(() => ({ dis: document.getElementById('impBtnAplicar').disabled, txt: document.querySelector('.imp-wrap').innerText }));
  chk('★ Una fecha futura deshabilita el registro y lo explica', fut.dis === true && /futuro/.test(fut.txt), JSON.stringify(fut.dis));
  await p.evaluate(() => { importarCambiarMomento('fecha', '2026-10-05'); importarCambiarMomento('hora', '23:40'); }); await p.waitForTimeout(150);
  await p.click('#impBtnAplicar'); await p.waitForTimeout(700);
  const ea = await p.evaluate(() => ({ sets: window.__sets, confirm: window.__confirm.slice(-1)[0] || '', res: (document.querySelector('.imp-wrap') || {}).innerText || '' }));
  const s0 = ea.sets[0] || {};
  chk('★ Se escribe UN solo documento (atómico)', ea.sets.length === 1, String(ea.sets.length));
  chk('★ En anclasExistencia/2026-10-05_2340, tipo importacion_excel, con fecha y hora',
      /\/anclasExistencia\/2026-10-05_2340$/.test(s0.ruta || '') && s0.data && s0.data.tipo === 'importacion_excel' && s0.data.fecha === '2026-10-05' && s0.data.hora === '23:40', s0.ruta);
  chk('Lleva las cantidades del corte (2 + 0.75 = 2.75 tequilas; 4.5 kg de limón)',
      s0.data && s0.data.saldos && s0.data.saldos['1180001'] === 2.75 && s0.data.saldos['1020064'] === 4.5, JSON.stringify(s0.data && s0.data.saldos));
  chk('Lo anterior queda como histórico dentro del corte (previo)', s0.data && s0.data.previo && typeof s0.data.previo === 'object', JSON.stringify(s0.data && Object.keys(s0.data)));
  chk('Confirmación clara antes de registrar (inmutable, compras − consumo posteriores)',
      /REGISTRAR CORTE/.test(ea.confirm) && /INMUTABLE/.test(ea.confirm) && /POSTERIORES/.test(ea.confirm), ea.confirm.slice(0, 160));
  chk('Resultado: corte registrado y cómo se recalcula el Total', /2026-10-05_2340/.test(ea.res) && /compras posteriores/.test(ea.res), ea.res.slice(0, 160));

  await p.evaluate(() => { _db = null; });
  // ═══ 5 · Las pestañas ya no importan ══════════════════════════════════════
  const sinBotones = {};
  for (const t of ['productos', 'recetario', 'compras', 'ventas', 'inicio']) {
    await p.evaluate((t) => __ir(t), t); await p.waitForTimeout(200);
    sinBotones[t] = await p.evaluate(() => {
      const txt = [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.innerText.trim()).join(' | ');
      return /Importar Excel|Importar ventas|Importar entrada|^Excel$/m.test(txt.replace(/ \| /g, '\n')) ? txt : '';
    });
  }
  chk('★ Productos, Recetario, Compras, Ventas e Inicio ya no tienen botones de importar',
      Object.values(sinBotones).every(x => x === ''), JSON.stringify(sinBotones).slice(0, 300));

  // ═══ 6 · Compras: la tarjeta abre los productos del proveedor ═════════════
  await p.evaluate(() => {
    compras = [
      { compraId: 'C1', folio: 'F-100', docSap: '5001', fecha: '2026-10-05', proveedorCodigo: 'P01', proveedorNombre: 'CASA CUERVO', origen: 'excel', importe: 2090,
        lineas: [{ productoId: '1180001', descripcionSap: 'TEQ DJ 70', cantidadDocumento: 6, unidadDocumento: 'PZA', cantidadInventario: 6, costoUnitario: 340, importe: 2040, enCatalogo: true },
                 { productoId: 'X9', descripcionSap: "TAPÓN D'ORO", cantidadDocumento: 1, unidadDocumento: 'PZA', cantidadInventario: 1, costoUnitario: 50, importe: 50, enCatalogo: false }] },
      { compraId: "C2'x", folio: 'F-090', fecha: '2026-10-01', proveedorCodigo: 'P01', proveedorNombre: 'CASA CUERVO', origen: 'excel', importe: 660,
        lineas: [{ productoId: '1180001', cantidadDocumento: 2, unidadDocumento: 'PZA', cantidadInventario: 2, costoUnitario: 330, importe: 660, enCatalogo: true }] },
      { compraId: 'C3', folio: 'F-095', fecha: '2026-10-03', proveedorCodigo: 'P02', proveedorNombre: 'FRUTAS DEL VALLE', origen: 'excel', importe: 190,
        lineas: [{ productoId: '1020064', cantidadDocumento: 5, unidadDocumento: 'KGS', cantidadInventario: 5, costoUnitario: 38, importe: 190, enCatalogo: true }] }
    ];
    comprasImportView = 'lista'; __ir('compras');
  });
  await p.waitForTimeout(250);
  const tj = await p.evaluate(() => {
    const t = [...document.querySelectorAll('.cp-tarjeta')];
    return { n: t.length, roles: t.every(x => x.getAttribute('role') === 'button' && x.tabIndex === 0), altos: t.map(x => __m.alto(x)),
             ver: t.every(x => /Ver productos/.test(x.innerText)) };
  });
  chk('★ Cada tarjeta de compra es un botón (role, tabindex) con "Ver productos"', tj.n === 3 && tj.roles && tj.ver && tj.altos.every(a => a >= 44), JSON.stringify(tj));
  await p.click('.cp-tarjeta[data-compra-id="C1"]'); await p.waitForTimeout(250);
  const md = await p.evaluate(() => {
    const w = document.getElementById('cd-wrap'); if (!w) return null;
    const x = w.querySelector('.pm-ficha__x');
    return { titulo: w.querySelector('#cd-titulo').textContent, secs: [...w.querySelectorAll('.pm-ficha__sec')].map(s => s.textContent),
             items: w.querySelectorAll('.cd-item').length, texto: w.innerText, foco: document.activeElement === x,
             x: x ? [__m.alto(x), x.getBoundingClientRect().width] : null, modal: document.body.classList.contains('modal-open'),
             dialog: w.querySelector('[role="dialog"]') && w.querySelector('[role="dialog"]').getAttribute('aria-modal') === 'true',
             desborde: document.documentElement.scrollWidth - window.innerWidth,
             cTitulo: __m.contraste(w.querySelector('#cd-titulo')), cMeta: __m.contraste(w.querySelector('.cd-item__meta')) };
  });
  chk('★ Abre la ventana del proveedor con los productos de esa entrada', md && md.titulo === 'CASA CUERVO' && md.secs[0] === 'Productos de esta entrada' && /TEQUILA DON JULIO 70/.test(md.texto), JSON.stringify(md && md.secs));
  chk('★ …y todo lo recibido del mismo proveedor (8 PZA en 2 entradas), sin mezclar otros',
      md && md.secs[1] === 'Todo lo recibido de este proveedor' && /8 PZA/.test(md.texto) && /2 entradas/.test(md.texto) && !/LIMON/.test(md.texto), md ? md.texto.slice(0, 400) : '');
  chk('Marca el código que no está en el catálogo', md && /no está en el catálogo/.test(md.texto));
  chk('Diálogo accesible: aria-modal, foco en cerrar, X ≥ 44×44', md && md.dialog && md.foco && md.x[0] >= 44 && md.x[1] >= 44, JSON.stringify(md && md.x));
  chk('Contraste del detalle ≥ 4.5 y sin desborde', md && md.cTitulo >= 4.5 && md.cMeta >= 4.5 && md.desborde <= 0, JSON.stringify(md && [md.cTitulo, md.cMeta, md.desborde]));
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  chk('Escape cierra la ventana', await p.evaluate(() => !document.getElementById('cd-wrap') && !document.body.classList.contains('modal-open')));
  await p.click('.cp-tarjeta[data-compra-id="C2\'x"]'); await p.waitForTimeout(200);
  chk('★ Un folio con apóstrofo también abre su detalle (el id se lee del atributo)', await p.evaluate(() => !!document.getElementById('cd-wrap') && document.getElementById('cd-wrap').getAttribute('data-compra') === "C2'x"));
  await p.evaluate(() => document.querySelector('#cd-wrap .pm-ficha').click()); await p.waitForTimeout(150);
  chk('Tocar fuera cierra la ventana', await p.evaluate(() => !document.getElementById('cd-wrap')));
  await p.focus('.cp-tarjeta[data-compra-id="C3"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  chk('Con teclado (Enter) también se abre', await p.evaluate(() => { const w = document.getElementById('cd-wrap'); return !!w && /FRUTAS DEL VALLE/.test(w.innerText); }));
  await p.click('#cd-wrap .pm-btn[data-cd-cerrar]'); await p.waitForTimeout(150);
  chk('"Cerrar" cierra la ventana', await p.evaluate(() => !document.getElementById('cd-wrap')));
  await tema('light'); await p.click('.cp-tarjeta[data-compra-id="C1"]'); await p.waitForTimeout(200);
  const cl = await p.evaluate(() => { const w = document.getElementById('cd-wrap'); return [__m.contraste(w.querySelector('#cd-titulo')), __m.contraste(w.querySelector('.cd-item__meta'))]; });
  chk('[light] Contraste del detalle ≥ 4.5', cl.every(x => x >= 4.5), JSON.stringify(cl));
  await p.keyboard.press('Escape');

  // ═══ 7 · Compras desde el módulo: la vista previa de siempre, dentro del módulo
  await p.evaluate(() => {
    importarVolver(); __ir('importar');
    importarSeccion = 'compras';
    _comprasImportPendiente = _parsearExcelCompras([
      { 'Proveedor': 'P01', 'Nombre proveedor': 'CASA CUERVO', 'Fecha contabilización': '2026-10-05', 'Doc SAP': '7001', 'Material': '1180001', 'Texto breve material': 'TEQ', 'Cantidad': 1, 'Unidad': 'PZA', 'Importe': 340 }
    ]);
    comprasImportView = 'vista_previa'; renderTab();
  });
  await p.waitForTimeout(200);
  const vp = await p.evaluate(() => ({ tab: activeTab, wrap: !!document.querySelector('.imp-wrap'), txt: (document.querySelector('.imp-wrap') || {}).innerText || '' }));
  chk('La vista previa de compras se muestra dentro del módulo Importar', vp.tab === 'importar' && vp.wrap && /Compras/.test(vp.txt), vp.txt.slice(0, 120));
  await p.evaluate(() => { comprasImportView = 'lista'; _comprasImportPendiente = null; importarVolver(); });

  chk('Sin errores de JavaScript en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();
  let mal = 0; C.forEach(c => { if (!c.ok) mal++; console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  →  ' + c.d)); });
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron');
  process.exit(mal ? 1 : 0);
})();
