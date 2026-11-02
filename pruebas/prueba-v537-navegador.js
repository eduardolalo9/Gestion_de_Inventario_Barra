// v5.37 — Chromium contra la app REAL, con un Firestore SIMULADO en memoria (nada toca Firebase):
//   (1) El inventario MENSUAL (sábado 31-oct-2026) cierra la semana: crea el inicial de la semana
//       siguiente (fechaAncla = día del conteo), el corte mensual y el ancla — en UN batch.
//   (2) El domingo siguiente, con la semana ya cerrada por el mensual: queda como ancla
//       'cierre_semanal' (más nueva) y NO toca el inicial del mensual.
//   (3) Orden inverso: si el domingo ya cerró la semana, el mensual solo genera su corte mensual.
//   (4) Pedido sugerido → «Exportar Excel»: todos los productos con sugerido (descarga real, se relee).
//   npm run test:v537nav
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const NOVERIF = [];
const PUERTO = process.env.PUERTO || '8080';
const URL_APP = 'http://127.0.0.1:' + PUERTO + '/index.html';
let X = null, XLSX_LOCAL = null;
try { X = require('xlsx'); XLSX_LOCAL = path.join(path.dirname(require.resolve('xlsx')), 'dist', 'xlsx.full.min.js'); if (!fs.existsSync(XLSX_LOCAL)) XLSX_LOCAL = null; } catch (_) { X = null; }

const MONTAJE = () => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden');
  document.getElementById('loginScreen').classList.add('auth-hidden');
  document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'jefe'; currentUserRole = 'admin';
  _authzState.loaded = true; _authzState.overrides = {}; _authzState.roleId = 'ADMIN'; _authzState.permissions = new Set(['*']);
  products = [
    { id: 'A', name: 'TEQUILA', group: 'TEQUILA', unit: 'Botellas', precio: 100, stockMinimo: 10, conversion: 1, stockByArea: { almacen: 2, barra1: 0, barra2: 0 } },
    { id: 'B', name: 'RON', group: 'RON', unit: 'Botellas', stockMinimo: 5, conversion: 1, stockByArea: { almacen: 1, barra1: 0, barra2: 0 } },
    { id: '0012', name: 'MEZCAL', group: 'TEQUILA', unit: 'Botellas', precio: 300, stockMinimo: 2, conversion: 1, stockByArea: { almacen: 9, barra1: 0, barra2: 0 } }
  ];
  activeTab = 'inicio'; renderTab();
};

// Firestore simulado por rutas. Soporta doc().get(), where/orderBy/limit/get, batch set/update/commit.
const SIM = () => {
  const store = {};   // ruta → datos
  window.__store = store; window.__batches = 0;
  const copia = (o) => JSON.parse(JSON.stringify(o));
  const snapDoc = (p) => ({ id: p.split('/').pop(), exists: p in store, data: () => (p in store ? copia(store[p]) : undefined) });
  const consulta = (col, filtros, orden, lim) => ({
    where: (f, op, v) => consulta(col, filtros.concat([[f, op, v]]), orden, lim),
    orderBy: (f, dir) => consulta(col, filtros, [f, dir || 'asc'], lim),
    limit: (n) => consulta(col, filtros, orden, n),
    get: async () => {
      let ids = Object.keys(store).filter(p => p.startsWith(col + '/') && p.slice(col.length + 1).indexOf('/') === -1);
      ids = ids.filter(p => filtros.every(([f, op, v]) => { const x = store[p][f];
        return op === '==' ? x === v : op === '<=' ? x <= v : op === '<' ? x < v : op === '>' ? x > v : op === '>=' ? x >= v : false; }));
      if (orden) ids.sort((a, b) => { const x = store[a][orden[0]], y = store[b][orden[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (orden[1] === 'desc' ? -1 : 1); });
      if (lim) ids = ids.slice(0, lim);
      const docs = ids.map(snapDoc);
      return { empty: !docs.length, size: docs.length, docs, forEach: (fn) => docs.forEach(fn) };
    },
    onSnapshot: () => () => {}
  });
  const ref = (p) => ({ _p: p, id: p.split('/').pop(), get: async () => snapDoc(p), collection: (n) => col(p + '/' + n),
                       onSnapshot: () => () => {} });
  const col = (p) => Object.assign(consulta(p, [], null, null), { doc: (id) => ref(p + '/' + id) });
  const FALSO = { collection: (n) => col(n),
    batch: () => { const ops = []; return { set: (r, d) => ops.push(['s', r._p, d]), update: (r, d) => ops.push(['u', r._p, d]), delete: (r) => ops.push(['d', r._p]),
      commit: async () => {
        // Reglas de create-only (inventariosIniciales, cortesMensuales, anclasExistencia): set sobre existente = rechazo.
        for (const o of ops) if (o[0] === 's' && o[1] in store && /\/(inventariosIniciales|cortesMensuales|anclasExistencia)\//.test(o[1])) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
        ops.forEach(o => { if (o[0] === 's') store[o[1]] = copia(o[2]); else if (o[0] === 'u') store[o[1]] = Object.assign({}, store[o[1]], copia(o[2])); else delete store[o[1]]; });
        window.__batches++; } }; } };
  _db = FALSO; window._db = FALSO;
  // El físico congelado de cada inventario: se simula _readChunkedSubcollection / _saldosDesdeSnapshot.
  window.__fisicos = {};
  window._readChunkedSubcollection = async (docRef) => (window.__fisicos[docRef.id] ? [{ tipo: 'producto', id: 'x' }] : []);
  window._saldosDesdeSnapshot = () => window.__fisicoActual;
};
const BASE = 'inventarioApp/barra-principal';

async function contabilizar(p, inv, fisico) {
  await p.evaluate(({ inv, fisico, BASE }) => {
    const id = inv.inventoryId;
    window.__store[BASE + '/inventories/' + id] = inv;
    window.__fisicos[id] = true;
    window.__fisicoActual = { ok: true, productos: fisico, totalProductos: fisico.length, enCero: 0, noContados: 0, areas: ['almacen', 'barra1', 'barra2'] };
    window.__notifs = [];
    contabilizarInventario(id, inv.numero);
  }, { inv, fisico, BASE });
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(100); if (await p.$('#_confirmOverlay')) break; }
  const msg = await p.evaluate(() => { const o = document.querySelector('#_confirmOverlay p'); return o ? o.innerText : null; });
  if (msg) { await p.click('#_cfmOk'); await p.waitForTimeout(600); }
  return { msg, notif: await p.evaluate(() => document.body.innerText) };
}
const leerStore = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__store)));

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const abrir = async () => {
    const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
    p.on('dialog', d => d.dismiss());
    if (XLSX_LOCAL) await p.route('**/xlsx.full.min.js', r => r.fulfill({ body: fs.readFileSync(XLSX_LOCAL), contentType: 'text/javascript' }));
    await p.goto(URL_APP, { waitUntil: 'load' });
    await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
    await p.waitForTimeout(700);
    await p.evaluate(MONTAJE); await p.evaluate(SIM);
    return { ctx, p, errs };
  };
  const invMensual = { inventoryId: 'INV-M', numero: 50, estado: 'CERRADO', semanaId: '2026-10-26', fechaRecuento: '2026-10-31' };
  const invDomingo = { inventoryId: 'INV-D', numero: 51, estado: 'CERRADO', semanaId: '2026-10-26', fechaRecuento: '2026-11-01' };
  const fisM = [{ id: 'A', total: 4 }, { id: 'B', total: 2.5 }];
  const fisD = [{ id: 'A', total: 3 }, { id: 'B', total: 2 }];

  // ═══ 1 · Mensual sábado → cierra la semana ═══
  let { ctx, p, errs } = await abrir();
  const ev = await p.evaluate((inv) => evaluarContabilizable(inv, '2026-11-02'), invMensual);
  chk('★ El mensual del sábado 31-oct se puede contabilizar y CIERRA la semana (inicial de la del 2-nov) + corte mensual + ancla',
      ev.puede && ev.haceSemanal && ev.semanalDesdeMensual && ev.semanaDestino === '2026-11-02' && ev.haceMensual && ev.mesId === '2026-10' && ev.haceAncla, JSON.stringify(ev));
  let r = await contabilizar(p, invMensual, fisM);
  chk('La confirmación dice que el mensual cierra la semana y desde cuándo aplica entradas y consumo',
      r.msg && /Semana destino: 2026-11-02 \(el inventario mensual cierra la semana\)/.test(r.msg) && /desde el día siguiente al 2026-10-31/.test(r.msg) && /Corte mensual: 2026-10/.test(r.msg), r.msg);
  let st = await leerStore(p);
  const ini = st[BASE + '/inventariosIniciales/2026-11-02'];
  chk('★ Inicial de la semana 2026-11-02 creado con los saldos del mensual y fechaAncla 2026-10-31',
      ini && ini.fechaAncla === '2026-10-31' && ini.origen.tipo === 'cierre_mensual' && ini.origen.inventoryId === 'INV-M' && ini.saldos.A === 4 && ini.saldos.B === 2.5, JSON.stringify(ini));
  chk('★ Corte mensual 2026-10 y ancla fin_de_mes 2026-10-31 creados en el MISMO batch', !!st[BASE + '/cortesMensuales/2026-10'] && st[BASE + '/anclasExistencia/2026-10-31'] && st[BASE + '/anclasExistencia/2026-10-31'].tipo === 'fin_de_mes' && (await p.evaluate(() => window.__batches)) === 1);
  const invM = st[BASE + '/inventories/INV-M'];
  chk('El inventario queda CONTABILIZADO con semana, mes y ancla de destino', invM.estado === 'CONTABILIZADO' && invM.semanaDestino === '2026-11-02' && invM.mesDestino === '2026-10' && invM.anclaDestino === '2026-10-31', JSON.stringify(invM));
  const fe = await p.evaluate((d) => fechaConteoDeInicial('2026-11-02', d), ini);
  chk('★ El Total parte del 31-oct (no del domingo): las compras del domingo 1-nov SÍ se suman',
      fe === '2026-10-31' && JSON.stringify(await p.evaluate(() => arrastreEntradas('2026-10-31', [{ tipo: 'compra', productoId: 'A', cantidad: 6, fecha: '2026-11-01', movId: 'm1' }], '2026-11-02'))) === '{"A":6}');

  // ═══ 2 · El domingo siguiente → ancla cierre_semanal ═══
  r = await contabilizar(p, invDomingo, fisD);
  st = await leerStore(p);
  const anD = st[BASE + '/anclasExistencia/2026-11-01'];
  chk('★ Domingo 1-nov con la semana ya cerrada por el mensual: queda como ancla «cierre_semanal» del Total',
      anD && anD.tipo === 'cierre_semanal' && anD.saldos.A === 3 && anD.origen.inventoryId === 'INV-D', JSON.stringify(anD) + ' · ' + (r.msg || r.notif.slice(0, 300)));
  chk('★ El inicial del mensual NO se tocó (inmutable)', JSON.stringify(st[BASE + '/inventariosIniciales/2026-11-02']) === JSON.stringify(ini));
  chk('La confirmación explica por qué el domingo va como corte del Total', r.msg && /cierre del domingo/.test(r.msg) && /ya tiene el inicial del inventario mensual #50/.test(r.msg), r.msg);
  chk('El domingo queda CONTABILIZADO con anclaDestino (sin semanaDestino)', st[BASE + '/inventories/INV-D'].estado === 'CONTABILIZADO' && st[BASE + '/inventories/INV-D'].anclaDestino === '2026-11-01' && !st[BASE + '/inventories/INV-D'].semanaDestino);
  const elegido = await p.evaluate(() => anclaElegir([
    { tipo: 'inicial_semanal', fecha: fechaConteoDeInicial('2026-11-02', { fechaAncla: '2026-10-31' }), saldos: { A: 4 } },
    { tipo: 'fin_de_mes', fecha: '2026-10-31', saldos: { A: 4 } },
    { tipo: 'cierre_semanal', fecha: '2026-11-01', saldos: { A: 3 } }], '2026-11-02'));
  chk('★ El Total parte del domingo (el corte más nuevo)', elegido.tipo === 'cierre_semanal' && elegido.saldos.A === 3, JSON.stringify(elegido));
  chk('Sin errores de JavaScript (contabilizar)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 3 · Orden inverso: domingo primero ═══
  ({ ctx, p, errs } = await abrir());
  await contabilizar(p, invDomingo, fisD);
  st = await leerStore(p);
  chk('Domingo contabilizado primero: inicial normal de la semana 2026-11-02 (sin fechaAncla)', st[BASE + '/inventariosIniciales/2026-11-02'] && !st[BASE + '/inventariosIniciales/2026-11-02'].fechaAncla && st[BASE + '/inventariosIniciales/2026-11-02'].origen.inventoryId === 'INV-D');
  r = await contabilizar(p, invMensual, fisM);
  st = await leerStore(p);
  chk('★ Después, el mensual NO pisa la semana: solo genera su corte mensual (gana el domingo)',
      st[BASE + '/inventariosIniciales/2026-11-02'].origen.inventoryId === 'INV-D' && !!st[BASE + '/cortesMensuales/2026-10'] && !st[BASE + '/anclasExistencia/2026-10-31']
      && st[BASE + '/inventories/INV-M'].estado === 'CONTABILIZADO' && st[BASE + '/inventories/INV-M'].mesDestino === '2026-10' && !st[BASE + '/inventories/INV-M'].semanaDestino, (r.msg || '') + JSON.stringify(st[BASE + '/inventories/INV-M']));
  chk('La confirmación lo explica', r.msg && /No se cierra la semana con este inventario/.test(r.msg), r.msg);
  chk('Sin errores de JavaScript (orden inverso)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 4 · Pedido sugerido → Exportar Excel ═══
  ({ ctx, p, errs } = await abrir());
  await p.evaluate(() => { activeTab = 'pedido_sugerido'; renderTab(); });
  await p.waitForTimeout(300);
  const filasPs = await p.evaluate(() => pedidoSugeridoFilas(products, { soloBajo: true }).map(f => f.id + ':' + f.sugerido));
  chk('Escenario: A y B tienen pedido sugerido; MEZCAL (sobre su mínimo) no', filasPs.length === 2 && filasPs.every(x => !/0012/.test(x)), filasPs.join(','));
  const btn = await p.evaluate(() => { const b = document.getElementById('psExportBtn'); const r = b && b.getBoundingClientRect(); return b ? { h: r.height, dentro: r.right <= innerWidth + 1 } : null; });
  chk('Botón «Exportar Excel» visible, ≥ 44 px y dentro de la pantalla', btn && btn.h >= 44 && btn.dentro, JSON.stringify(btn));
  // Filtro de grupo y cantidad editada: el archivo debe traer TODOS, con la cantidad escrita.
  await p.evaluate(() => { pedidoSugeridoGrupo('RON'); });
  await p.waitForTimeout(200);
  await p.fill('.ps-input[data-ps-pid="B"]', '7'); await p.press('.ps-input[data-ps-pid="B"]', 'Tab'); await p.waitForTimeout(200);
  const hayXlsx = await p.evaluate(async () => { for (let i = 0; i < 30 && typeof XLSX === 'undefined'; i++) await new Promise(r => setTimeout(r, 200)); return typeof XLSX !== 'undefined' ? XLSX.version : null; });
  if (!hayXlsx || !X) {
    NOVERIF.push('Descarga del .xlsx del pedido sugerido (SheetJS no disponible)');
  } else {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('#psExportBtn')]);
    const dir = path.join(os.tmpdir(), 'bi-v537'); fs.mkdirSync(dir, { recursive: true });
    const ruta = path.join(dir, dl.suggestedFilename()); await dl.saveAs(ruta);
    const buf = fs.readFileSync(ruta);
    chk('★ Descarga un .xlsx real con el nombre Pedido_Sugerido_AAAA-MM-DD.xlsx', /^Pedido_Sugerido_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()) && buf[0] === 0x50 && buf[1] === 0x4b, dl.suggestedFilename());
    const wb = X.read(buf, { type: 'buffer' });
    const aoa = X.utils.sheet_to_json(wb.Sheets['Pedido sugerido'], { header: 1, defval: null });
    chk('Columnas en orden', JSON.stringify(aoa[0]) === JSON.stringify(['Grupo', 'ID', 'Descripción', 'Unidad', 'Proveedor', 'Existencia', 'Stock mínimo', 'Pedido sugerido', 'Cantidad a pedir', 'Precio', 'Total estimado']), JSON.stringify(aoa[0]));
    const dat = aoa.slice(1).filter(x => x[1]);
    chk('★ Trae TODOS los productos con sugerido (aunque el filtro de grupo esté en RON), ninguno sin sugerido', dat.length === 2 && dat.map(x => x[1]).sort().join(',') === 'A,B', JSON.stringify(dat));
    const fA = dat.find(x => x[1] === 'A'), fB = dat.find(x => x[1] === 'B');
    chk('★ TEQUILA: existencia 2, mínimo 10, sugerido 8, pedir 8, precio 100, total 800', JSON.stringify(fA.slice(5)) === JSON.stringify([2, 10, 8, 8, 100, 800]), JSON.stringify(fA));
    chk('★ RON: cantidad escrita (7) y sin precio → Precio y Total VACÍOS', fB[8] === 7 && fB[9] === null && fB[10] === null && fB[7] === 4, JSON.stringify(fB));
    const tot = aoa.find(x => x[9] === 'Total');
    chk('Fila de Total = 800', tot && tot[10] === 800, JSON.stringify(tot));
    chk('Hoja «Información» presente', !!wb.Sheets['Información']);
  }
  chk('★ Exportar no cambió el catálogo ni el carrito', await p.evaluate(() => products.length === 3 && (typeof cart === 'undefined' || Object.keys(cart || {}).length === 0)));
  chk('Sin errores de JavaScript (pedido sugerido)', errs.length === 0, errs.join(' | '));
  await ctx.close();
  // Sin permiso de exportar
  ({ ctx, p, errs } = await abrir());
  await p.evaluate(() => { _authzState.permissions = new Set(['inventory.count']); activeTab = 'pedido_sugerido'; renderTab(); });
  chk('Sin inventory.export no hay botón y la función se niega', await p.evaluate(() => !document.getElementById('psExportBtn') && exportarPedidoSugeridoExcel().motivo === 'sin_permiso'));
  await ctx.close();

  await nav.close();
  console.log('\n  ── v5.37 · Mensual cierra la semana y Exportar pedido sugerido (navegador) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + (c.d || ''))));
  NOVERIF.forEach(n => console.log('  ⚪  NO VERIFICADO: ' + n));
  const fl = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fl) + ' pasaron · ' + fl + ' fallaron' + (NOVERIF.length ? ' · ' + NOVERIF.length + ' sin verificar' : '') + '\n');
  process.exit(fl ? 1 : 0);
})();
