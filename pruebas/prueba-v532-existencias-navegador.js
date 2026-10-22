// v5.32 — «Exportar existencias a Excel», probado en Chromium contra la app
// real: se pulsa el botón, se captura la DESCARGA real del .xlsx y se lee el
// archivo con la misma librería SheetJS que usa la app. Los 12 escenarios del
// encargo (21-oct-2026).
//   npm run test:existnav        (requiere el servidor local en PUERTO, 8080)
//
// SheetJS se carga de cdnjs. Si hay una copia local (XLSX_LOCAL=ruta, o el
// paquete "xlsx" instalado), se sirve esa; si no, se usa la de internet.
//
// Firestore: se sustituye por un doble en memoria que REGISTRA cualquier
// escritura (para demostrar que exportar no escribe) y que puede fallar a
// propósito (escenarios de error de lectura y sin permiso).
const { chromium } = require('playwright');
const fs = require('fs');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const URL_APP = 'http://127.0.0.1:' + PUERTO + '/index.html';

function rutaXlsxLocal() {
  if (process.env.XLSX_LOCAL && fs.existsSync(process.env.XLSX_LOCAL)) return process.env.XLSX_LOCAL;
  try { return require.resolve('xlsx/dist/xlsx.full.min.js'); } catch (_) { return null; }
}

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctxNav = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true });
  const local = rutaXlsxLocal();
  if (local) await ctxNav.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\//, r => r.fulfill({ path: local, contentType: 'application/javascript' }));
  const p = await ctxNav.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  const descargas = []; p.on('download', d => descargas.push(d));
  await p.goto(URL_APP, { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
  });
  await p.waitForFunction(() => typeof XLSX !== 'undefined', null, { timeout: 15000 }).catch(() => null);
  const hayXlsx = await p.evaluate(() => typeof XLSX !== 'undefined');
  chk('La librería XLSX de la app está cargada (' + (local ? 'copia local' : 'cdnjs') + ')', hayXlsx);
  if (!hayXlsx) { fin(); return; }

  // ── Escenario base: corte hace 3 días + compras y ventas posteriores ─────
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.roleId = 'ADMIN';
    _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    window.__toasts = [];
    const _sn = showNotification; showNotification = function(m) { window.__toasts.push(String(m)); return _sn.apply(this, arguments); };
    // Doble de Firestore: cualquier escritura queda registrada.
    window.__escrituras = []; window.__lecturas = [];
    window.__dbModo = 'vacio';
    const snap = (docs) => ({ exists: docs.length > 0, empty: !docs.length, size: docs.length,
      docs: docs.map(d => ({ id: d.id, exists: true, data: () => d.data })),
      forEach(fn) { docs.forEach(d => fn({ id: d.id, exists: true, data: () => d.data })); }, data: () => (docs[0] || {}).data });
    const escribe = (t, ruta) => () => { window.__escrituras.push(t + ' ' + ruta); return Promise.resolve(); };
    const q = (ruta) => ({
      collection: (n) => q(ruta + '/' + n), doc: (id) => q(ruta + '/' + (id || 'auto')),
      where: () => q(ruta), orderBy: () => q(ruta), limit: () => q(ruta),
      get: () => { window.__lecturas.push(ruta);
        if (window.__dbModo === 'error') return Promise.reject(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
        if (window.__dbModo === 'colgado') return new Promise(() => {});
        return Promise.resolve(snap([])); },
      onSnapshot: () => () => {},
      set: escribe('set', ruta), update: escribe('update', ruta), add: escribe('add', ruta), delete: escribe('delete', ruta)
    });
    _db = q('');
    _db.batch = () => ({ set: () => window.__escrituras.push('batch.set'), update: () => window.__escrituras.push('batch.update'),
                         delete: () => window.__escrituras.push('batch.delete'), commit: () => Promise.resolve() });
    _db.runTransaction = () => { window.__escrituras.push('tx'); return Promise.resolve(); };
    // Las demás rutas de la app que escribirían a la nube en segundo plano no
    // son de esta prueba: se neutralizan para que el doble solo vea a js/97.
    syncToCloud = function() {};
    window.__dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return fechaISOLocal(d); };
    const dia = window.__dia;
    products = [
      { id: 'A0',   name: 'RON AÑEJO 750 ML', unit: 'PZA', group: 'Ron', stockByArea: { almacen: 99 } },
      { id: 'B0',   name: 'VODKA 1 L', unit: 'PZA', group: 'Vodka', stockByArea: { almacen: 0 } },
      { id: 'M1',   name: 'JARABE NATURAL', unit: 'LT', group: 'Insumos', stockByArea: { almacen: 2, barra1: 3, barra2: 1.5, zona_vieja: 99 } },
      { id: 'M2',   name: 'GINEBRA 750 ML', unit: 'PZA', group: 'Ginebra', stockByArea: { almacen: 50, barra1: 7 } },
      { id: '0012', name: 'Licor "Café" & Ñandú <b>, 1/2 L 🍸', unit: 'PZA', group: 'Licores, Cremas & Más', stockByArea: { almacen: 1 } },
      { id: 'V1',   name: 'TEQUILA BLANCO', unit: 'PZA', group: 'Tequila', stockByArea: { almacen: 0 } }
    ];
    recetas = [{ id: 'r1', pv: 'PV1', nombre: 'MARGARITA', activa: true, ingredientes: [{ productoId: 'V1', cantidad: 0.06, uom: 'PZA' }] }];
    movimientos = []; compras = []; inventarioConteo = {};
    _existenciaInicial = { semana: semanaId(new Date()), estado: 'ok', saldos: { A0: 10, B0: 0, M2: 4, '0012': 3.25, V1: 2 },
                           origen: { numero: 1010 }, ancla: { tipo: 'mitad_de_semana', fecha: dia(-3), id: dia(-3), ruta: 'arrastre', dias: 3 } };
    _existenciaArrastre = { anclaFecha: dia(-3), compras: [], comprasNoDisponibles: false, ventasNoDisponibles: false, version: 500,
                            periodos: [{ id: dia(-2) + '_' + dia(-2), inicio: dia(-2), fin: dia(-2), lineas: [{ sku: 'PV1', cantidad: 5 }] }] };
    _existenciaArrastreMemo = { clave: null };
    window.__compra = (id, lineas, fecha) => {
      const c = { compraId: id, folio: id, fecha: fecha || dia(-1), semanaId: semanaId(fecha || dia(-1)), proveedorNombre: 'Proveedor',
                  lineas: lineas.map(([pid, cant]) => ({ productoId: pid, cantidadInventario: cant, costoUnitario: 1, enCatalogo: true })) };
      _agregarCompraLocal(c, _asientosDesdeCompra(c));
    };
    window.__compra('C1', [['B0', 12]]);
    updateCloudSyncBadge('ok');
    activeTab = 'productos'; renderTab();
  });

  // ── utilidades ───────────────────────────────────────────────────────────
  const foto = () => p.evaluate(() => JSON.stringify({ products, compras, movimientos, inventarioConteo,
    ls: Object.keys(localStorage).filter(k => !/theme|ultima|_ts$|Sync|sesion/i.test(k)).sort().map(k => [k, localStorage.getItem(k)]) }));
  const leerXlsx = async (dl) => {
    const b64 = fs.readFileSync(await dl.path()).toString('base64');
    return p.evaluate((b64) => {
      const wb = XLSX.read(b64, { type: 'base64' });
      const hojas = {};
      wb.SheetNames.forEach(n => { hojas[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }); });
      const z = XLSX.CFB.read(Uint8Array.from(atob(b64), c => c.charCodeAt(0)), { type: 'array' });
      const xml = new TextDecoder().decode(XLSX.CFB.find(z, '/xl/worksheets/sheet1.xml').content);
      const tipos = {}; const ws = wb.Sheets.Existencias;
      Object.keys(ws).filter(k => /^B\d+$/.test(k)).forEach(k => { tipos[k] = ws[k].t; });
      return { nombres: wb.SheetNames, hojas, congelada: /<pane[^>]*ySplit="1"[^>]*state="frozen"/.test(xml),
               filtro: (xml.match(/<autoFilter ref="([^"]+)"/) || [])[1] || null,
               anchos: (xml.match(/<col [^>]*width="[^"]+"/g) || []).length, tiposId: tipos };
    }, b64);
  };
  const mapa = (x) => { const m = {}; (x.hojas.Existencias || []).slice(1).forEach(f => { m[f[1]] = f; }); return m; };
  const stockUI = () => p.evaluate(() => {
    activeTab = 'productos'; renderTab();
    const m = {};
    document.querySelectorAll('#tabContent .cat-tabla tbody tr').forEach(tr => {
      const id = (tr.querySelector('.cat-prod__cod') || {}).textContent;
      const t = (tr.children[3] || {}).textContent || '';
      m[id] = /\d/.test(t) ? Number(t.replace(/,/g, '')) : null;
    });
    return m;
  });
  // Exporta pulsando el botón real. confirmar: true | false (cancelar) | null (no debe haber confirmación).
  const exportar = async (confirmar) => {
    const n0 = descargas.length;
    await p.evaluate(() => { window.__escrituras = []; window.__toasts = []; });
    const antes = await foto();
    await p.click('#exExistenciasBtn');
    const hubo = await p.waitForSelector('#_cfmOk', { timeout: 2500 }).then(() => true).catch(() => false);
    let textoConfirm = '';
    if (hubo) {
      textoConfirm = await p.evaluate(() => document.getElementById('_confirmOverlay').innerText);
      await p.click(confirmar ? '#_cfmOk' : '#_cfmCancel');
    }
    await p.waitForFunction(() => !_exExport.enCurso, null, { timeout: 20000 }).catch(() => null);
    await p.waitForTimeout(600);
    const despues = await foto();
    const r = await p.evaluate(() => ({ toasts: window.__toasts.slice(), escrituras: window.__escrituras.slice(),
      boton: !!document.getElementById('exExistenciasBtn') && !document.getElementById('exExistenciasBtn').disabled }));
    return Object.assign(r, { hubo, textoConfirm, nuevas: descargas.slice(n0), intacto: antes === despues });
  };

  // ── Botón ────────────────────────────────────────────────────────────────
  const btn = await p.evaluate(() => {
    const b = document.getElementById('exExistenciasBtn'); if (!b) return null;
    const r = b.getBoundingClientRect(); const ico = b.querySelector('i');
    return { txt: b.innerText.trim(), alto: r.height, der: r.right, ancho: innerWidth, ico: ico && ico.className,
             antesDeBuscador: !!(b.compareDocumentPosition(document.querySelector('#tabContent input[type="search"], #tabContent input')) & Node.DOCUMENT_POSITION_FOLLOWING),
             fueraDeRegion: !b.closest('[data-sbx-region], .sbx-region') };
  });
  chk('★ Botón «Exportar existencias a Excel» en Productos, con ícono de Excel, ≥ 44 px, sin desbordar',
      btn && btn.txt === 'Exportar existencias a Excel' && /fa-file-excel/.test(btn.ico) && btn.alto >= 44 && btn.der <= btn.ancho, JSON.stringify(btn));
  chk('El botón queda arriba del buscador y fuera de la región que refresca la búsqueda', btn && btn.antesDeBuscador && btn.fueraDeRegion, JSON.stringify(btn));
  const contraste = await p.evaluate(async () => {
    const lum = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const r = {};
    for (const t of ['light', 'dark']) {
      document.documentElement.setAttribute('data-theme', t);
      await new Promise(ok => setTimeout(ok, 500));   // el fondo del botón tiene transición
      const b = document.getElementById('exExistenciasBtn'); const cs = getComputedStyle(b);
      const a = lum(cs.color), f = lum(cs.backgroundColor); r[t] = Math.round(((Math.max(a, f) + 0.05) / (Math.min(a, f) + 0.05)) * 10) / 10;
    }
    document.documentElement.setAttribute('data-theme', 'light');
    return r;
  });
  chk('Texto del botón legible (AA ≥ 4.5:1) en claro y oscuro', contraste.light >= 4.5 && contraste.dark >= 4.5, JSON.stringify(contraste));
  await p.screenshot({ path: process.env.CAPTURA || '/tmp/v532-productos.png' }).catch(() => {});

  // ── 1+2+12 · Existencia registrada, multiárea, especiales, Excel = app; doble toque ──
  await p.evaluate(() => { window.__escrituras = []; window.__toasts = []; });
  const antes1 = await foto();
  const n0 = descargas.length;
  await p.evaluate(() => { const b = document.getElementById('exExistenciasBtn'); b.click(); b.click(); exportarExistenciasExcel(); });
  await p.waitForSelector('#_cfmOk', { timeout: 1500 }).then(() => p.click('#_cfmOk')).catch(() => null);
  await p.waitForFunction(() => !_exExport.enCurso, null, { timeout: 20000 }).catch(() => null);
  await p.waitForTimeout(800);
  const r1 = await p.evaluate(() => ({ toasts: window.__toasts.slice(), esc: window.__escrituras.slice() }));
  chk('★ 10 · Exportación repetida (3 toques seguidos) → UNA sola descarga y aviso "Ya se está generando"',
      descargas.length - n0 === 1 && r1.toasts.some(t => /Ya se está generando/.test(t)), (descargas.length - n0) + ' descargas · ' + r1.toasts.join(' | '));
  const d1 = descargas[descargas.length - 1];
  chk('Nombre del archivo Existencias_BarInventory_' + await p.evaluate(() => window.__dia(0)) + '.xlsx',
      d1 && d1.suggestedFilename() === 'Existencias_BarInventory_' + await p.evaluate(() => window.__dia(0)) + '.xlsx', d1 && d1.suggestedFilename());
  const x1 = await leerXlsx(d1); const m1 = mapa(x1); const ui1 = await stockUI();
  chk('★ Hoja «Existencias» primero, con EXACTAMENTE Grupo | ID | Descripción | Unidad | En existencia',
      x1.nombres[0] === 'Existencias' && JSON.stringify(x1.hojas.Existencias[0]) === JSON.stringify(['Grupo', 'ID', 'Descripción', 'Unidad', 'En existencia']), JSON.stringify(x1.hojas.Existencias[0]));
  chk('Formato: filtros en A1:E7, primera fila fija y anchos de columna', x1.filtro === 'A1:E7' && x1.congelada && x1.anchos === 5, JSON.stringify({ f: x1.filtro, c: x1.congelada, a: x1.anchos }));
  chk('Todos los productos, una fila cada uno, sin duplicados', x1.hojas.Existencias.length === 7 && Object.keys(m1).length === 6, String(x1.hojas.Existencias.length));
  chk('★ 2 · Existencia registrada en el corte: RON = 10 (no la suma de áreas 99)', m1.A0 && m1.A0[4] === 10, JSON.stringify(m1.A0));
  chk('★ 3 · Entrada 0 → 12: VODKA (saldo 0 en el corte + compra de 12) = 12', m1.B0 && m1.B0[4] === 12, JSON.stringify(m1.B0));
  chk('★ 5 · Salida por consumo: TEQUILA = corte 2 − 5 × 0.06 = 1.7', m1.V1 && m1.V1[4] === 1.7, JSON.stringify(m1.V1));
  chk('★ 6 · Varias áreas sin doble conteo: JARABE (sin corte) = 2 + 3 + 1.5 = 6.5 (el área que ya no existe no suma)', m1.M1 && m1.M1[4] === 6.5, JSON.stringify(m1.M1));
  chk('★ 6 · Producto con corte: GINEBRA = 4 del corte, no + 57 de áreas', m1.M2 && m1.M2[4] === 4, JSON.stringify(m1.M2));
  chk('★ 11 · Caracteres especiales intactos y ID "0012" como texto', m1['0012'] && m1['0012'][2] === 'Licor "Café" & Ñandú <b>, 1/2 L 🍸'
      && m1['0012'][0] === 'Licores, Cremas & Más' && x1.tiposId.B2 === 's' && Object.values(x1.tiposId).every(t => t === 's'), JSON.stringify({ f: m1['0012'], t: x1.tiposId }));
  const coincide = (m, ui) => Object.keys(ui).length > 0 && Object.keys(ui).every(id => m[id] && Math.abs(m[id][4] - ui[id]) < 0.0005) && Object.keys(m).length === Object.keys(ui).length;
  chk('★ 12 · Cada cifra del Excel = la columna Stock que muestra la app', coincide(m1, ui1), JSON.stringify({ ui: ui1, xl: Object.fromEntries(Object.entries(m1).map(([k, v]) => [k, v[4]])) }));
  chk('Hojas «Auditoría» e «Información» con el origen de cada cifra y el corte', x1.nombres.join() === 'Existencias,Auditoría,Información'
      && (x1.hojas['Auditoría'] || []).some(f => f[0] === 'A0' && /Oficial/.test(f[3]) && f[4] === 10)
      && (x1.hojas['Información'] || []).some(f => f[0] === 'Corte (ancla)' && /Mitad de semana/.test(f[1])), JSON.stringify(x1.hojas['Información']));
  chk('★ Exportar no escribió nada en Firestore ni cambió datos locales', r1.esc.length === 0 && antes1 === await foto(), r1.esc.join(','));

  // ── 4 · Entradas acumuladas: + 5 → 17; la misma compra recibida otra vez no suma ──
  await p.evaluate(() => { window.__compra('C2', [['B0', 5]]); window.__compra('C1', [['B0', 12]]); });
  let e = await exportar(true);
  let m = mapa(await leerXlsx(e.nuevas[0])); let ui = await stockUI();
  chk('★ 4 · Entradas acumuladas: VODKA 12 + 5 = 17; la compra C1 recibida dos veces NO se cuenta doble',
      e.nuevas.length === 1 && m.B0[4] === 17 && ui.B0 === 17, JSON.stringify({ xl: m.B0, ui: ui.B0 }));
  chk('12 · Excel = app después de las compras', coincide(m, ui), JSON.stringify(ui));

  // ── 5 · Ajuste por conteo físico (producto sin corte) ───────────────────
  await p.evaluate(() => { inventarioConteo = { M1: { barra1: { enteras: 1, abiertas: [] } } }; syncStockByAreaFromConteo(); });
  e = await exportar(true); m = mapa(await leerXlsx(e.nuevas[0])); ui = await stockUI();
  chk('★ 5 · Ajuste por conteo: JARABE barra1 3 → 1 ⇒ 2 + 1 + 1.5 = 4.5 en Excel y en la app', m.M1[4] === 4.5 && ui.M1 === 4.5, JSON.stringify({ xl: m.M1, ui: ui.M1 }));

  // ── 1 · Producto nuevo creado con el formulario real → 0 ─────────────────
  await p.evaluate(() => {
    openProductModal();
    document.getElementById('productName').value = 'MEZCAL NUEVO 750 ML';
    document.getElementById('productId').value = 'N1';
    document.getElementById('productGroup').value = 'Mezcal';
    document.getElementById('productUnit').value = 'Piezas';
    saveProduct();
  });
  await p.waitForTimeout(300);
  const nuevo = await p.evaluate(() => { const x = products.find(q => q.id === 'N1'); return x ? { sba: x.stockByArea } : null; });
  e = await exportar(true); m = mapa(await leerXlsx(e.nuevas[0])); ui = await stockUI();
  chk('★ 1 · Producto nuevo (formulario real) = 0 en Excel y en la app; el único aviso es que su alta aún no se sincroniza',
      nuevo && m.N1 && m.N1[4] === 0 && ui.N1 === 0 && m.N1[0] === 'Mezcal' && e.hubo && /1 cambio\(s\) de este dispositivo sin sincronizar/.test(e.textoConfirm) && !/NO suma/.test(e.textoConfirm),
      JSON.stringify({ nuevo, xl: m.N1, ui: ui.N1, conf: e.hubo, t: e.textoConfirm }));

  // ── 3/B · Producto nuevo + compra de 12 (CAUSA RAÍZ del caso B) ──────────
  await p.evaluate(() => window.__compra('C3', [['N1', 12]]));
  e = await exportar(false);
  chk('★ Caso B · Compra a un producto sin saldo en el corte: se AVISA antes de descargar (con el ID) y Cancelar no descarga',
      e.hubo && /N1/.test(e.textoConfirm) && /NO suma/.test(e.textoConfirm) && e.nuevas.length === 0 && e.toasts.some(t => /cancelada/.test(t)) && e.boton,
      JSON.stringify({ hubo: e.hubo, t: e.textoConfirm.slice(0, 300), n: e.nuevas.length, toasts: e.toasts }));
  e = await exportar(true); const xB = await leerXlsx(e.nuevas[0]); m = mapa(xB); ui = await stockUI();
  const audN1 = (xB.hojas['Auditoría'] || []).find(f => f[0] === 'N1');
  chk('Caso B · Comportamiento ACTUAL documentado: la app y el Excel muestran 0 (no 12); la Auditoría muestra las 12 entradas no reflejadas',
      m.N1[4] === 0 && ui.N1 === 0 && audN1 && audN1[5] === 12 && /no reflejadas/.test(audN1[8] || ''), JSON.stringify({ xl: m.N1, ui: ui.N1, aud: audN1 }));
  chk('12 · Excel = app también en el caso B (el Excel no inventa una cifra distinta a la pantalla)', coincide(m, ui), JSON.stringify(ui));
  chk('El aviso importante queda escrito en la hoja Información', (xB.hojas['Información'] || []).some(f => /importante/.test(f[0] || '') && /N1/.test(f[1] || '')));

  // ── Sincronización incompleta: sin conexión ──────────────────────────────
  await p.evaluate(() => { products = products.filter(q => q.id !== 'N1'); movimientos = movimientos.filter(q => q.productoId !== 'N1'); });
  await ctxNav.setOffline(true);
  e = await exportar(false);
  await ctxNav.setOffline(false);
  chk('★ Sincronización incompleta (sin conexión) → se avisa y pide confirmar antes de descargar', e.hubo && /sin conexión/i.test(e.textoConfirm) && e.nuevas.length === 0, e.textoConfirm.slice(0, 200));

  // ── 8 · Error de lectura de Firestore (permission-denied) ────────────────
  await p.evaluate(() => { existenciaInvalidarInicial(); window.__dbModo = 'error'; });
  e = await exportar(true);
  const est8 = await p.evaluate(() => existenciaInicialEstado().estado);
  chk('★ 8 · Error al leer Firestore → NO se descarga nada y se dice por qué (sin ceros silenciosos)',
      est8 === 'error' && e.nuevas.length === 0 && !e.hubo && e.toasts.some(t => /No se pudo leer el corte/.test(t)) && e.boton && e.intacto,
      JSON.stringify({ est8, n: e.nuevas.length, toasts: e.toasts }));

  // ── Corte que no termina de cargar ───────────────────────────────────────
  await p.evaluate(() => { existenciaInvalidarInicial(); window.__dbModo = 'colgado'; EXISTENCIAS_EXPORT_ESPERA_MS = 1500; });
  e = await exportar(true);
  chk('Corte que no termina de cargar → espera y NO exporta (no presenta datos parciales)', e.nuevas.length === 0 && e.toasts.some(t => /siguen cargando/.test(t)) && e.boton, JSON.stringify(e.toasts));

  // ── 7 · Sin datos ────────────────────────────────────────────────────────
  await p.evaluate(() => { window.__dbModo = 'vacio'; existenciaInvalidarInicial(); window.__respaldoProductos = products; products = []; activeTab = 'productos'; renderTab(); });
  e = await exportar(true);
  chk('★ 7 · Sin productos → no se descarga un archivo vacío; mensaje "No hay productos para exportar"', e.nuevas.length === 0 && e.toasts.some(t => /No hay productos/.test(t)), JSON.stringify(e.toasts));

  // ── Sin corte (no_existe): todo sale del conteo, se exporta con aviso ────
  await p.evaluate(() => { products = window.__respaldoProductos; existenciaInvalidarInicial(); activeTab = 'productos'; renderTab(); });
  e = await exportar(true); m = mapa(await leerXlsx(e.nuevas[0])); ui = await stockUI();
  const est0 = await p.evaluate(() => existenciaInicialEstado().estado);
  chk('Sin corte contabilizado (Firestore responde "no existe") → cifras del conteo, Excel = app', est0 === 'no_existe' && m.A0[4] === 99 && coincide(m, ui), JSON.stringify({ est0, A0: m.A0, ui }));

  // ── 9 · Sin permiso ──────────────────────────────────────────────────────
  await p.evaluate(() => { _authzState.roleId = 'BARTENDER'; _authzState.permissions = new Set(['inventory.read', 'catalog.read', 'inventory.count']); window.__toasts = []; activeTab = 'productos'; renderTab(); });
  const sinPerm = await p.evaluate(async () => ({ boton: !!document.getElementById('exExistenciasBtn'), r: await exportarExistenciasExcel(), toasts: window.__toasts.slice() }));
  await p.waitForTimeout(400);
  chk('★ 9 · Sin permiso inventory.export: no aparece el botón y la función se niega', !sinPerm.boton && sinPerm.r.motivo === 'sin_permiso' && sinPerm.toasts.some(t => /No tienes permiso/.test(t)), JSON.stringify(sinPerm));

  chk('Sin errores de JavaScript en toda la prueba', errs.length === 0, errs.join(' | '));
  fin();

  function fin() {
    const fallos = C.filter(c => !c.ok);
    C.forEach(c => console.log((c.ok ? '  ✅  ' : '  ❌  ') + c.n + (c.ok ? '' : '\n        → ' + c.d)));
    console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
    nav.close().then(() => process.exit(fallos.length ? 1 : 0));
  }
})().catch(e => { console.error(e); process.exit(1); });
