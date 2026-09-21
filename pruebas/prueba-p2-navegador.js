// P2 — humo en el navegador real: la importación de compras se comporta en
// Chromium con el código tal como se publica.
//
// Lo que aquí se prueba NO se puede probar leyendo el archivo ni contra el
// emulador: que el código nuevo no rompa la carga de la app, que el parseo
// del Excel funcione en un navegador de verdad, que la vista previa y la
// pantalla de incidencias se pinten y se cierren, que el botón dispare el
// input de compras y NO el del catálogo, y que lo que venga del Excel se
// pinte escapado aunque traiga HTML dentro.
//
// El camino contra Firestore (guardarCompra, idempotencia, batch atómico)
// vive en prueba-p2-integracion.js; las reglas, en run-rules-tests.js.
const { chromium, devices } = require('playwright');
const C = []; const chk = (n, ok, d) => { C.push({ n, ok, d }); };

// Filas con la forma EXACTA del export de SAP (folio 3646 / Doc 27615),
// incluida una de cocina y la fila de totales del pie.
const FILAS = [
  { 'Folio': 3646, 'Doc SAP': 27615, 'Sucursal': 'MOCHOMOS MONTERREY',
    'Proveedor': 'P00106 — VINOTECA MEXICO', 'Fecha': '2026-09-16', 'Entrega': '2026-09-16',
    'Estado': 'Sincronizado', 'Código': 1180015, 'Artículo': 'DON JULIO 70 700 ML',
    'UoM': 'PZA', 'Almacén': '12 — BARRA MOCHOMOS MONTERREY',
    'Cantidad': 2, 'Precio': 661.33, 'Total línea': 1322.66 },
  { 'Folio': 3646, 'Doc SAP': 27615, 'Proveedor': 'P00106 — VINOTECA MEXICO',
    'Fecha': '2026-09-16', 'Estado': 'Sincronizado', 'Código': 7777777,
    'Artículo': 'PRODUCTO QUE NO ESTA EN EL CATALOGO', 'UoM': 'PZA',
    'Almacén': '12 — BARRA MOCHOMOS MONTERREY',
    'Cantidad': 3, 'Precio': 50, 'Total línea': 150 },
  { 'Folio': 3646, 'Doc SAP': 27615, 'Proveedor': 'P00106 — VINOTECA MEXICO',
    'Fecha': '2026-09-16', 'Estado': 'Sincronizado', 'Código': 2000111,
    'Artículo': 'ACEITE DE OLIVA', 'UoM': 'PZA',
    'Almacén': '11 — COCINA MOCHOMOS MONTERREY',
    'Cantidad': 6, 'Precio': 300, 'Total línea': 1800 },
  { 'Precio': 'TOTAL', 'Total línea': 3272.66 }
];

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await p.goto('http://127.0.0.1:' + (process.env.PUERTO || '8080') + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys();
    await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(2000);
  chk('La página carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  const admin = async () => p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; currentUserRole = 'admin';
    _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = [
      { id: '1180015', name: 'DON JULIO 70 700 ML', unit: 'PZA', precio: 620.00 },
      { id: '1060023', name: 'SANGRITA VIUDA DE SANCHEZ', unit: 'PZA', precio: 75.00 }
    ];
    compras = []; movimientos = []; costosUltimos = {};
    comprasImportView = 'lista'; _comprasImportPendiente = null; _comprasImportResultado = null;
  });
  await admin();

  // ── Las piezas nuevas existen en el entorno real ────────────────────────
  const piezas = await p.evaluate(() => ({
    guardar:   typeof guardarCompra,
    parsear:   typeof _parsearExcelCompras,
    asientos:  typeof _asientosDesdeCompra,
    cargar:    typeof cargarComprasDeLaSemana,
    arranque:  typeof cargarComprasIniciales,
    importar:  typeof comprasImportarExcel,
    handler:   typeof handleFileImportCompras,
    confirmar: typeof confirmarImportacionCompras,
    batch:     typeof _escribirCompraEnBatch,
    folio:     typeof _obtenerSiguienteFolioCompra,
    costos:    typeof _actualizarUltimosCostos
  }));
  chk('Todas las funciones de compras están disponibles en la app real',
      Object.values(piezas).every(t => t === 'function'), JSON.stringify(piezas));

  // ── El input de compras existe y NO es el del catálogo ──────────────────
  const inputs = await p.evaluate(() => ({
    compras:  !!document.getElementById('fileInputCompras'),
    catalogo: !!document.getElementById('fileInput'),
    distintos: document.getElementById('fileInputCompras') !== document.getElementById('fileInput'),
    acepta: (document.getElementById('fileInputCompras') || {}).accept
  }));
  chk('★ El input de compras es propio y separado del catálogo',
      inputs.compras && inputs.catalogo && inputs.distintos, JSON.stringify(inputs));

  const disparo = await p.evaluate(() => {
    let cualClickearon = null;
    const orig1 = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () { cualClickearon = this.id; };
    try { comprasImportarExcel(); } finally { HTMLInputElement.prototype.click = orig1; }
    return cualClickearon;
  });
  chk('★ El botón de importar compras dispara #fileInputCompras, nunca #fileInput',
      disparo === 'fileInputCompras', 'disparó: ' + disparo);

  // ── El parseo del Excel real, en el navegador ───────────────────────────
  const parsed = await p.evaluate((filas) => {
    const r = _parsearExcelCompras(filas);
    return {
      grupos: r.grupos.length,
      fueraDeAlcance: r.fueraDeAlcance,
      filasIgnoradas: r.filasIgnoradas,
      compraId: r.grupos[0] && r.grupos[0].compraId,
      semanaId: r.grupos[0] && r.grupos[0].semanaId,
      proveedorCodigo: r.grupos[0] && r.grupos[0].proveedorCodigo,
      proveedorNombre: r.grupos[0] && r.grupos[0].proveedorNombre,
      totalLineas: r.grupos[0] && r.grupos[0].totalLineas,
      importe: r.grupos[0] && r.grupos[0].importe,
      incidencias: r.grupos[0] ? r.grupos[0].incidencias.map(i => i.tipo) : [],
      enCatalogo: r.grupos[0] ? r.grupos[0].lineas.map(l => l.enCatalogo) : [],
      factores: r.grupos[0] ? r.grupos[0].lineas.map(l => l.factorConversion) : []
    };
  }, FILAS);
  chk('El Excel produce una compra, con el id del Doc SAP',
      parsed.grupos === 1 && parsed.compraId === 'sap-27615', JSON.stringify(parsed));
  chk('La fila de cocina se descarta como fuera de alcance (D-2)',
      parsed.fueraDeAlcance === 1, 'fueraDeAlcance=' + parsed.fueraDeAlcance);
  chk('La fila de totales del pie se ignora sin incidencia',
      parsed.filasIgnoradas === 1, 'filasIgnoradas=' + parsed.filasIgnoradas);
  chk('El proveedor se separa en código y nombre',
      parsed.proveedorCodigo === 'P00106' && parsed.proveedorNombre === 'VINOTECA MEXICO',
      JSON.stringify([parsed.proveedorCodigo, parsed.proveedorNombre]));
  chk('La semana se deriva de la fecha del documento (lunes 2026-09-14)',
      parsed.semanaId === '2026-09-14', parsed.semanaId);
  chk('★ El producto fuera de catálogo entra en la compra pero marcado enCatalogo:false',
      parsed.totalLineas === 2 && JSON.stringify(parsed.enCatalogo) === '[true,false]',
      JSON.stringify(parsed.enCatalogo));
  chk('★ Y genera una incidencia sin_catalogo, no un error silencioso',
      parsed.incidencias.indexOf('sin_catalogo') !== -1, JSON.stringify(parsed.incidencias));
  chk('★ factorConversion es 1 en todas las líneas: nunca se multiplica a ciegas',
      JSON.stringify(parsed.factores) === '[1,1]', JSON.stringify(parsed.factores));

  // ── La vista previa se pinta de verdad ──────────────────────────────────
  const previa = await p.evaluate((filas) => {
    _comprasImportPendiente = _parsearExcelCompras(filas);
    comprasImportView = 'vista_previa';
    activeTab = 'compras';
    renderTab();
    const el = document.getElementById('tabContent');
    return { txt: el.innerText, html: el.innerHTML,
             botones: [...el.querySelectorAll('button')].map(b => b.textContent.trim()) };
  }, FILAS);
  chk('La vista previa nombra al proveedor y su folio',
      previa.txt.includes('VINOTECA MEXICO') && previa.txt.includes('3646'), previa.txt.slice(0, 200));
  chk('★ Avisa de que el costo es precio de lista, sin descuento ni IVA',
      /precio de\s*lista/i.test(previa.txt) && /IVA/.test(previa.txt), previa.txt.slice(0, 400));
  chk('Ofrece confirmar y cancelar antes de escribir nada',
      previa.botones.some(b => /Confirmar/i.test(b)) && previa.botones.some(b => /Cancelar/i.test(b)),
      JSON.stringify(previa.botones));
  chk('Anuncia las incidencias en vez de esconderlas',
      /incidencia/i.test(previa.txt), previa.txt.slice(0, 300));

  // ── Cancelar devuelve a la lista sin escribir ───────────────────────────
  const trasCancelar = await p.evaluate(() => {
    cancelarImportacionCompras();
    return { vista: comprasImportView, pendiente: _comprasImportPendiente,
             compras: compras.length, txt: document.getElementById('tabContent').innerText };
  });
  chk('★ Cancelar descarta lo pendiente y no deja ninguna compra',
      trasCancelar.vista === 'lista' && trasCancelar.pendiente === null && trasCancelar.compras === 0,
      JSON.stringify({ v: trasCancelar.vista, c: trasCancelar.compras }));
  chk('Y vuelve a la lista vacía de siempre',
      trasCancelar.txt.includes('Todavía no hay compras registradas'), trasCancelar.txt.slice(0, 120));

  // ── La pantalla de incidencias (D-4) ────────────────────────────────────
  const incidencias = await p.evaluate((filas) => {
    const parsed = _parsearExcelCompras(filas);
    _comprasImportResultado = { creadas: 1, yaExistian: 0,
      fallidas: [{ compraId: 'sap-99', folio: '9999', motivo: 'sin fecha válida' }],
      grupos: parsed.grupos };
    comprasImportView = 'incidencias';
    renderTab();
    const el = document.getElementById('tabContent');
    return { txt: el.innerText, botones: [...el.querySelectorAll('button')].map(b => b.textContent.trim()) };
  }, FILAS);
  chk('La pantalla de incidencias dice cuántas se guardaron y cuántas no',
      /1 entrada\(s\) guardada\(s\)/.test(incidencias.txt) && /no se pudieron guardar/.test(incidencias.txt),
      incidencias.txt.slice(0, 250));
  chk('★ Nombra el folio que falló y por qué, en vez de un error genérico',
      incidencias.txt.includes('9999') && /sin fecha válida/.test(incidencias.txt),
      incidencias.txt.slice(0, 300));
  chk('Lista la incidencia del producto fuera de catálogo con su código',
      incidencias.txt.includes('7777777') && /no está en el catálogo/.test(incidencias.txt),
      incidencias.txt.slice(0, 400));
  chk('Se puede cerrar', incidencias.botones.some(b => /Aceptar/i.test(b)), JSON.stringify(incidencias.botones));

  const trasCerrar = await p.evaluate(() => {
    cerrarResultadoImportacionCompras();
    return { vista: comprasImportView, resultado: _comprasImportResultado };
  });
  chk('Cerrar el resultado vuelve a la lista',
      trasCerrar.vista === 'lista' && trasCerrar.resultado === null, JSON.stringify(trasCerrar));

  // ── Lo que viene del Excel se pinta ESCAPADO ────────────────────────────
  const xss = await p.evaluate(() => {
    const malicioso = [{
      'Folio': 1, 'Doc SAP': 999,
      'Proveedor': 'P001 — <img src=x onerror="window.__cayo=1">',
      'Fecha': '2026-09-16', 'Código': '1180015',
      'Artículo': '<script>window.__cayo2=1<\/script>', 'UoM': 'PZA',
      'Almacén': '12 — BARRA', 'Cantidad': 1, 'Precio': 10, 'Total línea': 10
    }];
    _comprasImportPendiente = _parsearExcelCompras(malicioso);
    comprasImportView = 'vista_previa';
    renderTab();
    const el = document.getElementById('tabContent');
    return { html: el.innerHTML, cayo: !!window.__cayo, cayo2: !!window.__cayo2,
             imgs: el.querySelectorAll('img').length, scripts: el.querySelectorAll('script').length };
  });
  chk('★ Un proveedor con HTML dentro no ejecuta nada ni inyecta etiquetas',
      xss.cayo === false && xss.cayo2 === false && xss.imgs === 0 && xss.scripts === 0,
      JSON.stringify({ cayo: xss.cayo, imgs: xss.imgs, scripts: xss.scripts }));
  chk('★ Y se muestra como texto, escapado',
      /&lt;img/.test(xss.html) || /&lt;script/.test(xss.html), xss.html.slice(0, 200));

  // ── El permiso se comprueba en la función, no solo ocultando el botón ───
  const sinPermiso = await p.evaluate(() => {
    cancelarImportacionCompras();
    _authzState.permissions = new Set(['inventory.count']);   // un bartender
    const avisos = [];
    const orig = window.showNotification;
    window.showNotification = (t) => avisos.push(String(t));
    let cualClickearon = null;
    const origClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () { cualClickearon = this.id; };
    try { comprasImportarExcel(); }
    finally { HTMLInputElement.prototype.click = origClick; window.showNotification = orig; }
    const txt = (renderTab(), document.getElementById('tabContent').innerText);
    return { avisos, cualClickearon, txt };
  });
  chk('★ Sin purchases.import, importar avisa y NO abre el selector de archivos',
      sinPermiso.cualClickearon === null && sinPermiso.avisos.some(a => /permiso/i.test(a)),
      JSON.stringify(sinPermiso.avisos));
  chk('Sin purchases.read la pestaña entera se niega',
      /No tienes permiso/.test(sinPermiso.txt), sinPermiso.txt.slice(0, 120));

  chk('Ningún error de JS en toda la prueba', errs.length === 0, errs.join(' | '));

  await nav.close();

  let fallos = 0;
  const w = Math.max(...C.map(c => c.n.length));
  console.log('');
  for (const c of C) {
    if (!c.ok) fallos++;
    console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + (c.d || '')));
  }
  console.log('\n  ' + C.length + ' pruebas · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})();
