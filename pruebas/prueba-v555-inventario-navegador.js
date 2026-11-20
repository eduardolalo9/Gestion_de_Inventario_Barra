// v5.55 — Chromium real (390 px): descargar/compartir el inventario al contabilizar y ANULAR inventarios físicos.
//   · «Descargar / Compartir» en la tarjeta de contabilizar (antes y después) y en el detalle del Historial: PDF y Excel con el
//     conteo congelado al cierre (conversión incluida), compartir con navigator.share simulado.
//   · «Anular inventario» (solo administración, solo un CERRADO, con motivo), «Restaurar», «Mostrar anulados», rechazo del servidor.
// Firestore es simulado: cada escritura queda registrada y se comprueba CAMPO POR CAMPO.
//   npm run test:navegador   (o:  PUERTO=8080 node pruebas/prueba-v555-inventario-navegador.js)
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const CAPTURAS = process.env.CAPTURAS_DIR || '';

const FAKE = () => {
  const vacio = { exists: false, docs: [], empty: true, size: 0, forEach() {}, data() { return {}; }, docChanges() { return []; } };
  const mk = () => new Proxy(function () {}, { get(_, k) { if (k === 'then') return undefined; if (k === 'get') return async () => vacio; if (k === 'onSnapshot') return () => () => {}; return () => mk(); } });
  window.__store = { inv: {}, updates: [] };
  window.__rechazar = false;
  const docInv = (id) => ({
    get: async () => ({ exists: !!window.__store.inv[id], data: () => window.__store.inv[id] }),
    update: async (d) => {
      if (window.__rechazar) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
      window.__store.updates.push({ id, d: JSON.parse(JSON.stringify(d)) });
      Object.assign(window.__store.inv[id], d);
    },
    collection: () => mk()
  });
  _db = {
    collection: () => ({ doc: () => ({ collection: (c) => (c === 'inventories' ? { doc: docInv } : mk()), get: async () => vacio, set: async () => {}, update: async () => {} }) }),
    batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }), runTransaction: async () => {}
  };
};

const MONTAR = () => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u'; currentUserRole = 'admin'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
  _lastUserData = { role: 'admin', displayName: 'Eduardo Admin', email: 'admin@bar.mx' };
  const P = (id, name, group, extra) => Object.assign({ id, name, group, unit: 'BOT', precio: 100, stockMinimo: 1, conversion: 1, stockByArea: { almacen: 0, barra1: 0, barra2: 0 } }, extra);
  products = [P('T1', 'TEQUILA 1800 AÑEJO 700 ML', 'TEQUILA', { capacidadMl: 750, pesoBotellaLlenaOz: 55, conteoOzHabilitado: true }), P('R1', 'RON BACARDI BLANCO', 'RON'), P('W1', 'WHISKY BUCHANANS', 'WHISKY')];
  auditoriaConteo = {}; orders = []; inventories = []; compras = []; movimientos = []; costosUltimos = {}; cart = [];
  const hoy = new Date(); const dom = new Date(hoy); dom.setDate(hoy.getDate() - ((hoy.getDay() + 7) % 7 || 7));   // último domingo ya pasado
  window.__fechaDom = fechaISOLocal(dom);
  const base = (id, numero, extra) => Object.assign({ inventoryId: id, numero, estado: 'CERRADO', fechaCreacion: Date.now() - 86400000 * 5, fechaCierre: Date.now() - 86400000 * 2,
    creadoPorNombre: 'Eduardo', cerradoPorNombre: 'Eduardo', totalProductos: 3, fechaRecuento: window.__fechaDom, semanaId: semanaId(window.__fechaDom),
    warehousesSnapshot: ['almacen', 'barra1', 'barra2'], participantesUids: ['u'] }, extra || {});
  window.__store.inv['inv-1007'] = base('inv-1007', 1007, { estado: 'CONTABILIZADO', contabilizadoEn: Date.now() - 86400000, semanaDestino: '2026-11-16' });
  window.__store.inv['inv-1008'] = base('inv-1008', 1008);
  window.__store.inv['inv-1009'] = base('inv-1009', 1009, { anulado: true, anuladoEn: Date.now() - 3600000, anuladoPor: 'u', anuladoPorNombre: 'Eduardo Admin', motivoAnulacion: 'Se creó por error' });
  // Snapshot congelado de 1007: T1 contado por el admin (2 + 1 enteras y una botella abierta a 42.32 oz ≈ 0.5), R1 contado 4 en Almacén, W1 sin conteo
  const REG = [
    { tipo: 'meta', warehousesSnapshot: ['almacen', 'barra1', 'barra2'] },
    { tipo: 'producto', id: 'T1', name: 'TEQUILA 1800 AÑEJO 700 ML', group: 'TEQUILA', unit: 'BOT', capacidadMl: 750, pesoBotellaLlenaOz: 55, conteoOzHabilitado: true },
    { tipo: 'producto', id: 'R1', name: 'RON BACARDI BLANCO', group: 'RON', unit: 'BOT' },
    { tipo: 'producto', id: 'W1', name: 'WHISKY BUCHANANS', group: 'WHISKY', unit: 'BOT' },
    { tipo: 'usuario', uid: 'a1', email: 'admin@bar.mx', isAdmin: true, updatedAt: 5,
      conteo: { T1: { almacen: { enteras: 2, abiertas: [42.32] }, barra1: { enteras: 1, abiertas: [] } }, R1: { almacen: { enteras: 4, abiertas: [] } } },
      status: { almacen: 'completada', barra1: 'completada', barra2: 'completada' } }
  ];
  window.__REG = REG;
  window.__lecturas = 0;
  _readChunkedSubcollection = async () => { window.__lecturas++; return REG; };
  _inventarioActivoId = 'inv-1007'; _inventarioActivo = window.__store.inv['inv-1007']; _inventarioActivoCarga = 'ok';
  isAuditoriaMode = true; auditoriaView = 'seleccion'; auditoriaAreaActiva = null; activeTab = 'inventario'; renderTab();
};
const toastTxt = (p) => p.locator('#toastMessage').textContent();
const verActivo = (p, id) => p.evaluate((i) => { _inventarioActivoId = i; _inventarioActivo = window.__store.inv[i]; auditoriaView = 'seleccion'; activeTab = 'inventario'; notificationTimeout = null; renderTab(); }, id);

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = [], viol = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  p.on('console', m => { if (/Content Security Policy|violates the following/i.test(m.text()) && !/inline event handler/i.test(m.text())) viol.push(m.text().slice(0, 200)); });
  p.on('dialog', d => d.dismiss());
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600);
  await p.evaluate(FAKE); await p.evaluate(MONTAR); await p.waitForTimeout(400);

  // ═══ 1 · Inventario CONTABILIZADO: descargar / compartir ═══
  const tarjeta = p.locator('.pm-paso--hecho');
  chk('★ La tarjeta «Contabilizado» muestra el botón «Descargar / Compartir»', await tarjeta.count() === 1 && await tarjeta.locator('.cx-btn-inv').count() === 1 && /Descargar \/ Compartir/.test(await tarjeta.locator('.cx-btn-inv').innerText()));
  chk('Un contabilizado NO ofrece «Anular inventario» (ya es el stock inicial de la semana)', await p.locator('text=Anular inventario').count() === 0);
  const caja = await tarjeta.locator('.cx-btn-inv').boundingBox();
  chk('El botón mide ≥ 44 px y cabe en 390 px', caja && caja.height >= 44 && caja.x >= 0 && caja.x + caja.width <= 390, JSON.stringify(caja));
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'contabilizado-botones-390.png') });
  const antes = await p.evaluate(() => JSON.stringify({ p: products, c: auditoriaConteo, inv: window.__store.inv, ls: Object.keys(localStorage).sort().map(k => k + '=' + localStorage.getItem(k)) }));
  await tarjeta.locator('.cx-btn-inv').click(); await p.waitForTimeout(500);
  chk('★ Abre la hoja «Exportar inventario #1007» («conteo al cierre»)', await p.evaluate(() => { const h = document.querySelector('#cxOverlay .cx-hoja'); return !!h && /Exportar inventario #1007/.test(h.innerText) && /conteo al cierre/.test(h.innerText); }));
  chk('★ Lee el snapshot del inventario UNA vez al abrir (para que Compartir no espere a la red)', await p.evaluate(() => window.__lecturas) === 1);
  const foto = await p.evaluate(async () => {
    const f = await _cxInstantanea();
    const t1 = f.filas.find(x => x.id === 'T1'), r1 = f.filas.find(x => x.id === 'R1'), w1 = f.filas.find(x => x.id === 'W1');
    return { orden: f.filas.map(x => x.id).join(','), t1: t1.total, t1alm: t1.cols[0], r1: r1.total, w1: w1.total, w1c: w1.contado, areas: f.areas.map(a => a.nombre).join('|'), titulo: f.info.titulo, base: f.nombreBase,
             pura: Math.round((2 + 1 + convertirOzAPuntos(42.32, 750, 55)) * 1000) / 1000, sub: f.info.subtitulo, der: f.info.derecha };
  });
  chk('★ El total con conversión sale del snapshot: T1 = 2 + 1 enteras + la abierta convertida (42.32 oz ≈ 0.5) = 3.5', foto.t1 === foto.pura && Math.abs(foto.t1 - 3.5) < 0.01 && foto.t1alm.enteras === 2 && foto.t1alm.abiertas > 0.45 && foto.t1alm.abiertas < 0.55, JSON.stringify(foto));
  chk('R1 = 4 (solo Almacén) y W1, que nadie contó, sale en CERO y como no contado', foto.r1 === 4 && foto.w1 === 0 && foto.w1c === false);
  chk('Orden por grupo y nombre: RON, TEQUILA, WHISKY', foto.orden === 'R1,T1,W1', foto.orden);
  chk('El título dice «Contabilizado» con el número y el destino (inicial de la semana) y el archivo se llama «Inventario_fisico_1007»', /Inventario físico #1007 — Contabilizado/.test(foto.titulo) && /inicial de la semana 2026-11-16/.test(foto.sub) && foto.base === 'Inventario_fisico_1007', JSON.stringify([foto.titulo, foto.sub, foto.base]));
  chk('Incluye las 3 áreas del inventario', foto.areas === 'Almacén|Barra Restaurante|Barra Bar', foto.areas);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.locator('.cx-opc--pri').click()]);
  const rutaPdf = path.join(dir, dl.suggestedFilename()); await dl.saveAs(rutaPdf);
  const pdf = fs.readFileSync(rutaPdf);
  chk('★ Descargar PDF baja «Inventario_fisico_1007_AAAA-MM-DD.pdf», un PDF válido de 1 hoja A4', /^Inventario_fisico_1007_\d{4}-\d{2}-\d{2}\.pdf$/.test(dl.suggestedFilename()) && pdf.slice(0, 5).toString() === '%PDF-' && (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length === 1, dl.suggestedFilename());
  await p.waitForTimeout(300);
  await tarjeta.locator('.cx-btn-inv').click(); await p.waitForTimeout(300);
  const [dx] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.getByRole('button', { name: /Descargar Excel/ }).click()]);
  const rutaX = path.join(dir, dx.suggestedFilename()); await dx.saveAs(rutaX);
  const x = await p.evaluate((b) => { const wb = XLSX.read(b, { type: 'base64' }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); }, fs.readFileSync(rutaX).toString('base64'));
  chk('★ El Excel trae los 3 productos con el total convertido de T1 (3.5) y W1 en 0 «Sin conteo (0)»', x.length === 4 && Math.abs(x.find(f => f[1] === 'T1')[13] - 3.5) < 0.01 && x.find(f => f[1] === 'W1')[13] === 0 && x.find(f => f[1] === 'W1')[14] === 'Sin conteo (0)', JSON.stringify(x.map(f => f[1] + ':' + f[13])));
  await p.evaluate(() => { window.__sh = null; navigator.canShare = () => true; navigator.share = async (d) => { window.__sh = { n: d.files.map(f => f.name), t: d.files.map(f => f.type) }; }; });
  await tarjeta.locator('.cx-btn-inv').click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Compartir PDF/ }).click(); await p.waitForTimeout(1200);
  const sh = await p.evaluate(() => window.__sh);
  chk('★ Compartir PDF abre el menú del aparato con «Inventario_fisico_1007…pdf» (application/pdf)', sh && sh.n.length === 1 && /^Inventario_fisico_1007_.*\.pdf$/.test(sh.n[0]) && sh.t[0] === 'application/pdf', JSON.stringify(sh));
  const despues = await p.evaluate(() => JSON.stringify({ p: products, c: auditoriaConteo, inv: window.__store.inv, ls: Object.keys(localStorage).sort().map(k => k + '=' + localStorage.getItem(k)) }));
  chk('★ Exportar un inventario NO modifica nada: ni productos, ni conteos, ni el inventario, ni localStorage, y no hubo escrituras', antes === despues && await p.evaluate(() => window.__store.updates.length) === 0);

  // ═══ 2 · Inventario CERRADO (antes de contabilizar): descargar/compartir y ANULAR ═══
  await verActivo(p, 'inv-1008'); await p.waitForTimeout(300);
  const paso = p.locator('.pm-paso').first();
  chk('★ Un inventario CERRADO (aún sin contabilizar) ofrece «Descargar / Compartir» y «Anular inventario»', await p.locator('.pm-paso .cx-btn-inv').count() === 1 && await p.locator('.pm-paso >> text=Anular inventario').count() === 1);
  chk('Y sigue ofreciendo Contabilizar o explicando por qué no se puede (no se rompió el paso de contabilizar)', await p.locator('[data-inv-accion="contabilizar"]').count() === 1 || /No se puede contabilizar/.test(await paso.innerText()));
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'cerrado-botones-390.png') });
  // Cancelar con Escape: no escribe
  await p.locator('.pm-paso >> text=Anular inventario').click(); await p.waitForTimeout(250);
  chk('★ «Anular inventario» abre una ventana que pide el MOTIVO (obligatorio) y explica que no se borra', await p.evaluate(() => { const o = document.getElementById('anOverlay'); return !!o && /Anular inventario #1008/.test(o.innerText) && /No se borra/.test(o.innerText) && !!document.getElementById('anMotivo'); }));
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'anular-motivo-390.png') });
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  chk('Escape cierra la ventana sin escribir nada', await p.locator('#anOverlay').count() === 0 && await p.evaluate(() => window.__store.updates.length) === 0);
  // Motivo vacío / corto: no escribe
  await p.locator('.pm-paso >> text=Anular inventario').click(); await p.waitForTimeout(250);
  await p.locator('[data-an-accion="aceptar"]').click(); await p.waitForTimeout(150);
  chk('★ Sin motivo no se anula: avisa «Escribe el motivo» y la ventana sigue abierta', /Escribe el motivo/.test(await p.locator('#anError').innerText()) && await p.locator('#anOverlay').count() === 1 && await p.evaluate(() => window.__store.updates.length) === 0);
  await p.fill('#anMotivo', 'abc'); await p.locator('[data-an-accion="aceptar"]').click(); await p.waitForTimeout(150);
  chk('Un motivo de 3 caracteres tampoco (mínimo 5)', await p.locator('#anOverlay').count() === 1 && await p.evaluate(() => window.__store.updates.length) === 0);
  // Rechazo del servidor (reglas sin publicar)
  await p.evaluate(() => { window.__rechazar = true; notificationTimeout = null; });
  await p.fill('#anMotivo', 'Se creó por error'); await p.locator('[data-an-accion="aceptar"]').click(); await p.waitForTimeout(800);
  chk('★ Si el servidor rechaza (reglas v5.55 sin publicar) lo dice claro y NO queda anulado en pantalla', /reglas de Firestore de la v5\.55/.test(await toastTxt(p)) && await p.evaluate(() => window.__store.inv['inv-1008'].anulado !== true && window.__store.updates.length === 0));
  // Anular de verdad
  await p.evaluate(() => { window.__rechazar = false; notificationTimeout = null; });
  await p.locator('.pm-paso >> text=Anular inventario').click(); await p.waitForTimeout(250);
  await p.fill('#anMotivo', '  Se creó por error durante una prueba  '); await p.locator('[data-an-accion="aceptar"]').click(); await p.waitForTimeout(900);
  const up = await p.evaluate(() => window.__store.updates.slice());
  chk('★ Anular escribe UNA vez, solo la marca: anulado, anuladoEn, anuladoPor, anuladoPorNombre y motivoAnulacion (recortado)', up.length === 1 && up[0].id === 'inv-1008'
      && Object.keys(up[0].d).sort().join() === 'anulado,anuladoEn,anuladoPor,anuladoPorNombre,motivoAnulacion' && up[0].d.anulado === true && up[0].d.anuladoPor === 'u'
      && up[0].d.anuladoPorNombre === 'Eduardo Admin' && up[0].d.motivoAnulacion === 'Se creó por error durante una prueba' && typeof up[0].d.anuladoEn === 'number', JSON.stringify(up));
  chk('No se tocó el estado, las fechas ni el contenido del inventario', await p.evaluate(() => { const i = window.__store.inv['inv-1008']; return i.estado === 'CERRADO' && i.numero === 1008 && i.totalProductos === 3 && i.semanaId; }));
  chk('Se avisa que se puede restaurar', /anulado/.test(await toastTxt(p)) && /Mostrar anulados/.test(await toastTxt(p)));
  // El listener real actualiza _inventarioActivo con el documento: se emula con el mismo dato
  await p.evaluate(() => { _inventarioActivo = Object.assign({}, window.__store.inv['inv-1008']); renderTab(); }); await p.waitForTimeout(300);
  chk('★ Anulado: el encabezado dice ANULADO y la tarjeta muestra el motivo, quién y que no se puede contabilizar', await p.evaluate(() => /ANULADO/.test(document.querySelector('.pm-estado--cab').innerText) && /Inventario anulado/.test(document.body.innerText) && /Se creó por error durante una prueba/.test(document.body.innerText) && /No se puede contabilizar/.test(document.body.innerText)));
  chk('★ Un anulado ya NO ofrece Contabilizar ni Anular, pero sí Restaurar, Descargar / Compartir y Crear el siguiente', await p.locator('[data-inv-accion="contabilizar"]').count() === 0 && await p.locator('.pm-paso >> text=Anular inventario').count() === 0
      && await p.locator('.pm-paso >> text=Restaurar').count() === 1 && await p.locator('.pm-paso .cx-btn-inv').count() === 1 && /Crear el siguiente/.test(await p.locator('.pm-paso').innerText()));
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'anulado-390.png') });
  // Contabilizar un anulado: la función lo frena antes de escribir
  await p.evaluate(() => { notificationTimeout = null; window.__store.updates.length = 0; });
  await p.evaluate(() => contabilizarInventario('inv-1008', 1008)); await p.waitForTimeout(600);
  chk('★ contabilizarInventario frena un anulado (avisa «ANULADO») y no escribe nada', /ANULADO/.test(await toastTxt(p)) && await p.evaluate(() => window.__store.updates.length) === 0);
  chk('evaluarContabilizable lo reporta como no contabilizable con el motivo', await p.evaluate(() => { const r = evaluarContabilizable(window.__store.inv['inv-1008']); return r.puede === false && r.anulado === true && /ANULADO/.test(r.motivo) && /Se creó por error/.test(r.motivo); }));

  // ═══ 3 · Restaurar ═══
  await p.evaluate(() => { notificationTimeout = null; });
  await p.locator('.pm-paso >> text=Restaurar').click(); await p.waitForTimeout(250);
  chk('Restaurar pide confirmación antes de escribir', await p.locator('#_confirmOverlay').count() === 1 && await p.evaluate(() => window.__store.updates.length) === 0);
  await p.click('#_cfmCancel'); await p.waitForTimeout(500);
  chk('Cancelar la confirmación no escribe', await p.evaluate(() => window.__store.updates.length) === 0);
  await p.locator('.pm-paso >> text=Restaurar').click(); await p.waitForTimeout(250); await p.click('#_cfmOk'); await p.waitForTimeout(800);
  const up2 = await p.evaluate(() => window.__store.updates.slice());
  chk('★ Restaurar escribe solo anulado=false, restauradoEn y restauradoPor', up2.length === 1 && Object.keys(up2[0].d).sort().join() === 'anulado,restauradoEn,restauradoPor' && up2[0].d.anulado === false && up2[0].d.restauradoPor === 'u', JSON.stringify(up2));
  await p.evaluate(() => { _inventarioActivo = Object.assign({}, window.__store.inv['inv-1008']); renderTab(); }); await p.waitForTimeout(300);
  chk('Restaurado, vuelve a ofrecer Contabilizar/Anular y ya no dice ANULADO', await p.locator('.pm-paso >> text=Anular inventario').count() === 1 && !/ANULADO/.test(await p.locator('.pm-estado--cab').innerText()));

  // ═══ 4 · Historial: ocultar anulados y «Mostrar anulados» ═══
  await p.evaluate(() => { _historialInventarios = ['inv-1007', 'inv-1008', 'inv-1009'].map(i => window.__store.inv[i]); _historialMostrarAnulados = false; _historialHayMas = false; auditoriaView = 'historial'; activeTab = 'inventario'; renderTab(); });
  await p.waitForTimeout(300);
  const titulos = () => p.evaluate(() => [...document.querySelectorAll('.rc-hist__titulo')].map(e => e.textContent.trim()).join('|'));
  chk('★ El Historial NO muestra el anulado (#1009): solo #1007 y #1008', await titulos() === '#1007 · Inventario Barra|#1008 · Inventario Barra', await titulos());
  chk('Administración ve «Mostrar anulados (1)»', /Mostrar anulados \(1\)/.test(await p.locator('.if-hist-anulados').innerText()));
  await p.locator('.if-hist-anulados').click(); await p.waitForTimeout(250);
  chk('★ Al mostrarlos aparece #1009 con la marca «Anulado», el motivo y estilo atenuado', (await titulos()).indexOf('#1009') !== -1 && await p.locator('.rc-hist--anulado').count() === 1 && /anulado/i.test(await p.locator('.rc-hist--anulado').innerText()) && /Se creó por error/.test(await p.locator('.rc-hist--anulado').innerText()));
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'historial-anulados-390.png') });
  await p.locator('.if-hist-anulados').click(); await p.waitForTimeout(200);
  chk('«Ocultar anulados» los vuelve a esconder', (await titulos()).indexOf('#1009') === -1);
  await p.evaluate(() => { currentUserRole = 'user'; _authzState.permissions = new Set(['inventory.history', 'inventory.export', 'inventory.viewAll']); _historialInventarios.forEach(i => { i.participantesUids = ['u']; }); renderTab(); });
  await p.waitForTimeout(200);
  chk('★ Quien no es administrador no ve ni el botón «Mostrar anulados» ni los anulados', await p.locator('.if-hist-anulados').count() === 0 && (await titulos()).indexOf('#1009') === -1);
  await p.evaluate(() => { currentUserRole = 'admin'; _authzState.permissions = new Set(['*']); renderTab(); });

  // ═══ 5 · Detalle del inventario (desde el Historial) ═══
  await p.evaluate(() => { notificationTimeout = null; _detalleInventarioCerradoId = 'inv-1009'; _detalleInventarioCerradoData = { meta: window.__store.inv['inv-1009'], registros: window.__REG }; auditoriaView = 'detalle_cerrado'; renderTab(); });
  await p.waitForTimeout(300);
  chk('★ El detalle de un anulado muestra el aviso con el motivo y «Restaurar inventario»', /Inventario anulado/.test(await p.locator('.if-card').innerText()) && await p.locator('text=Restaurar inventario').count() === 1);
  chk('El detalle también ofrece «Descargar / Compartir» y el Excel completo de siempre', await p.locator('.if-card .cx-btn-inv').count() === 1 && await p.locator('text=Exportar').count() >= 1);
  await p.evaluate(() => { _detalleInventarioCerradoId = 'inv-1008'; _detalleInventarioCerradoData = { meta: window.__store.inv['inv-1008'], registros: window.__REG }; renderTab(); }); await p.waitForTimeout(250);
  chk('El detalle de un CERRADO ofrece «Anular inventario»', await p.locator('.if-card >> text=Anular inventario').count() === 1);
  await p.evaluate(() => { _detalleInventarioCerradoId = 'inv-1007'; _detalleInventarioCerradoData = { meta: window.__store.inv['inv-1007'], registros: window.__REG }; renderTab(); }); await p.waitForTimeout(250);
  chk('★ El detalle de un CONTABILIZADO NO ofrece anular, y sí descargar / compartir', await p.locator('.if-card >> text=Anular inventario').count() === 0 && await p.locator('.if-card .cx-btn-inv').count() === 1);
  // Anular un contabilizado por la consola: el servidor-simulado lo lee y la función lo rechaza antes de escribir
  await p.evaluate(() => { notificationTimeout = null; window.__store.updates.length = 0; });
  const rr = await p.evaluate(() => { const pr = anularInventario('inv-1007', 1007); setTimeout(() => { document.getElementById('anMotivo').value = 'Intento de anular un contabilizado'; document.querySelector('[data-an-accion="aceptar"]').click(); }, 300); return pr; });
  chk('★ Aunque se fuerce por consola, un CONTABILIZADO no se anula (avisa y no escribe)', rr.ok === false && rr.motivo === 'estado' && /contabilizado no se puede anular/.test(await toastTxt(p)) && await p.evaluate(() => window.__store.updates.length) === 0, JSON.stringify(rr));
  // Sin ser administrador
  await p.evaluate(() => { currentUserRole = 'user'; _authzState.permissions = new Set(['inventory.export', 'inventory.viewAll']); notificationTimeout = null; });
  const r3 = await p.evaluate(() => anularInventario('inv-1008', 1008));
  chk('★ Sin ser administrador no se puede anular (la función lo rechaza)', r3.ok === false && r3.motivo === 'sin_permiso');
  chk('Sin permiso de exportar o de ver todos los conteos no hay botón de descargar/compartir', await p.evaluate(() => { _authzState.permissions = new Set(['inventory.viewAll']); const a = conteoExportBotonInventarioHtml('inv-1007', 1007); _authzState.permissions = new Set(['inventory.export']); const b = conteoExportBotonInventarioHtml('inv-1007', 1007); return a === '' && b === ''; }));

  chk('Sin errores de JavaScript en toda la prueba', errs.length === 0, errs.join(' | '));
  chk('Sin violaciones de CSP (jsPDF y la ventana del motivo son del mismo origen, sin manejadores nuevos fuera del despachador)', viol.length === 0, viol.join(' | '));

  await nav.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const fallos = C.filter(c => !c.ok);
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + ' ' + c.n + (c.ok ? '' : '  ←  ' + c.d)));
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron\n');
  process.exit(fallos.length ? 1 : 0);
})();
