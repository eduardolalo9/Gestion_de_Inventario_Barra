// v5.35 — Físico vs Sistema en Chromium contra la app REAL: tabla compacta
// (Android 390 px y escritorio 1280 px), «Grupo», «Diferencias ↑», cero
// escrituras, corrección por área intacta, Atrás de Android y descarga REAL
// del .xlsx (se relee con SheetJS 0.18.5).
//   npm run test:v535nav    (servidor local en PUERTO, 8080; lo levanta todas-navegador.js)
// Nada toca Firebase: _db no existe en la prueba.
// SheetJS: la app la pide a cdnjs. Si este equipo no llega a cdnjs y hay una
// copia local de xlsx@0.18.5 (require('xlsx')), se sirve esa MISMA versión en
// lugar de la de cdnjs; si no hay ninguna, la parte del archivo sale NO VERIFICADA.
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const NOVERIF = [];
const PUERTO = process.env.PUERTO || '8080';
const URL_APP = 'http://127.0.0.1:' + PUERTO + '/index.html';
let X = null, XLSX_LOCAL = null;
try { X = require('xlsx'); XLSX_LOCAL = path.join(path.dirname(require.resolve('xlsx')), 'dist', 'xlsx.full.min.js'); if (!fs.existsSync(XLSX_LOCAL)) XLSX_LOCAL = null; } catch (_) { X = null; }

const MONTAJE = (rol) => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden');
  document.getElementById('loginScreen').classList.add('auth-hidden');
  document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u1'; currentUserRole = rol === 'admin' ? 'admin' : 'user';
  _authzState.loaded = true; _authzState.overrides = {};
  _authzState.roleId = rol === 'admin' ? 'ADMIN' : 'SUBJEFE_BARRA';
  _authzState.permissions = new Set(rol === 'admin' ? ['*'] : rol === 'subjefe' ? ['inventory.count', 'inventory.viewAll', 'inventory.export'] : ['inventory.count', 'inventory.viewAll']);
  products = [
    { id: 'A', name: 'TEQUILA FALTANTE', group: 'TEQUILA', unit: 'Botellas', precio: 100, stockMinimo: 1, stockByArea: { almacen: 10, barra1: 0, barra2: 0 } },
    { id: 'B', name: 'RON SOBRANTE',     group: 'RON',     unit: 'Botellas', precio: 50,  stockMinimo: 1, stockByArea: { almacen: 2,  barra1: 0, barra2: 0 } },
    { id: 'C', name: 'VODKA SIN CONTAR', group: 'VODKA',   unit: 'Botellas', precio: 20,  stockMinimo: 1, stockByArea: { almacen: 5,  barra1: 0, barra2: 0 } },
    { id: 'D', name: 'RON COINCIDE',     group: 'RON',     unit: 'Piezas',   precio: 12.5, stockMinimo: 1, stockByArea: { almacen: 4, barra1: 0, barra2: 0 } },
    { id: 'E', name: 'CERVEZA SIN PRECIO CON UN NOMBRE MUY LARGO PARA PROBAR QUE NO SE CORTA', group: 'CERVEZA', unit: 'Piezas', stockMinimo: 1, stockByArea: { almacen: 24, barra1: 0, barra2: 0 } },
    { id: '0012', name: 'MEZCAL CÓDIGO CON CEROS', group: 'TEQUILA', unit: 'Botellas', precio: 300, stockMinimo: 1, stockByArea: { almacen: 1, barra1: 0, barra2: 0 } }
  ];
  auditoriaConteo = {
    A: { almacen: { enteras: 6, abiertas: [] } },
    B: { almacen: { enteras: 3, abiertas: [] }, barra1: { enteras: 2, abiertas: [] } },
    D: { almacen: { enteras: 4, abiertas: [] } },
    E: { almacen: { enteras: 22, abiertas: [] } },
    '0012': { barra1: { enteras: 3, abiertas: [] } }
  };
  myAuditoriaConteo = JSON.parse(JSON.stringify(auditoriaConteo));
  _auditoriaSessionId = 'INV1001'; _inventarioActivoId = 'INV1001';
  _inventarioActivo = { estado: 'SINCRONIZADO', numero: 1001, fechaCreacion: Date.now(), creadoPorNombre: 'Eduardo' };
  allUsersAuditoria = {};
  activeTab = 'inventario'; auditoriaView = 'fisico_vs_sistema'; renderTab();
};

async function abrir(nav, vp, rol) {
  const ctx = await nav.newContext({ viewport: vp, hasTouch: vp.width < 600, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  p.on('dialog', d => d.dismiss());
  if (XLSX_LOCAL) await p.route('**/xlsx.full.min.js', r => r.fulfill({ body: fs.readFileSync(XLSX_LOCAL), contentType: 'text/javascript' }));
  await p.goto(URL_APP, { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(700);
  await p.evaluate(MONTAJE, rol);
  await p.waitForTimeout(250);
  return { ctx, p, errs };
}
const filasTabla = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#sbx-res-fvs tr.fvs-t__fila')).map(tr => ({
  nombre: tr.querySelector('.fvs-t__nom').textContent, sub: tr.querySelector('.fvs-t__sub').textContent,
  celdas: Array.from(tr.querySelectorAll('td')).map(td => td.innerText.replace(/\s+/g, ' ').trim())
})));
const estadoDatos = (p) => p.evaluate(() => JSON.stringify({ products, auditoriaConteo, myAuditoriaConteo, a: activeTab }));
const num = (t) => { const m = /^([+-]?)([\d,]+\.\d+)/.exec(t.replace(/\s/g, '')); return m ? parseFloat(m[1] + m[2].replace(/,/g, '')) : null; };

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());

  // ═══ 1 · Android (390 px), administrador ═════════════════════════════════
  let { ctx, p, errs } = await abrir(nav, { width: 390, height: 844 }, 'admin');
  const antes = await estadoDatos(p);
  await p.evaluate(() => {
    window.__esp = { guardar: 0, sync: 0, syncMy: 0, ls: 0 };
    const sg = window.saveToLocalStorage; window.saveToLocalStorage = function () { window.__esp.guardar++; return sg.apply(this, arguments); };
    const ss = window.syncToCloud;        window.syncToCloud        = function () { window.__esp.sync++; return ss && ss.apply(this, arguments); };
    const sm = window.syncMyAuditoriaToFirestore; window.syncMyAuditoriaToFirestore = function () { window.__esp.syncMy++; return sm && sm.apply(this, arguments); };
    const si = Storage.prototype.setItem; Storage.prototype.setItem = function () { window.__esp.ls++; return si.apply(this, arguments); };
  });

  let f = await filasTabla(p);
  chk('★ La tabla muestra los 6 productos (ninguno se pierde)', f.length === 6, f.map(x => x.nombre).join(' | '));
  const fA = f.find(x => x.nombre === 'TEQUILA FALTANTE');
  chk('★ Conserva toda la información de la tarjeta: ID · unidad, cada área, físico, sistema, diferencia con etiqueta y neto',
      fA && fA.sub === 'A · Botellas' && fA.celdas.length === 3 + 4 && /^6 Botellas/.test(fA.celdas[0]) && /— sin contar/.test(fA.celdas[1])
      && fA.celdas[3] === '6.00' && fA.celdas[4] === '10.00' && fA.celdas[5] === '-4.00 Faltante' && fA.celdas[6] === '-$400.00', JSON.stringify(fA));
  const fC = f.find(x => x.nombre === 'VODKA SIN CONTAR');
  chk('★ Sin contar: «—» y «Sin contar», nunca una diferencia ni un neto inventados', fC && fC.celdas[3] === '—' && fC.celdas[5] === '— Sin contar' && fC.celdas[6] === '—', JSON.stringify(fC));
  const t1 = await p.evaluate(() => document.getElementById('tabContent').innerText);
  const cabG = await p.evaluate(() => Array.from(document.querySelectorAll('tr.fvs-t__grupo')).map(r => r.querySelector('.fvs-grupo__nom').textContent + ' | ' + r.querySelector('.fvs-grupo__dat').textContent));
  chk('Encabezados de grupo con contados, sin contar y neto (como antes)', JSON.stringify(cabG) === JSON.stringify(
      ['CERVEZA | 1 contado · $0.00', 'RON | 2 contados · $150.00', 'TEQUILA | 2 contados · $200.00', 'VODKA | 0 contados · 1 sin contar · $0.00']), JSON.stringify(cabG));
  chk('Neto total intacto: −400 + 150 + 0 + 0 + 600 = $350.00', /\$350\.00/.test(t1));

  const med = await p.evaluate(() => {
    // La fila con el nombre a propósito larguísimo envuelve a más líneas (no se corta): se mide aparte.
    const filas = Array.from(document.querySelectorAll('tr.fvs-t__fila')).filter(r => !/MUY LARGO/.test(r.textContent));
    const alturas = filas.map(r => r.getBoundingClientRect().height);
    const w = document.querySelector('.fvs-t-wrap');
    const nom = document.querySelector('tr.fvs-t__fila .fvs-t__prod');
    const antesL = nom.getBoundingClientRect().left;
    w.scrollLeft = 5000;
    const despuesL = nom.getBoundingClientRect().left;
    const largo = Array.from(document.querySelectorAll('.fvs-t__nom')).find(n => /MUY LARGO/.test(n.textContent));
    return { max: Math.max.apply(null, alturas), prom: alturas.reduce((a, b) => a + b, 0) / alturas.length,
             paginaAncho: document.scrollingElement.scrollWidth, vista: innerWidth, tablaDesplaza: w.scrollWidth > w.clientWidth, w: w.scrollLeft,
             fijo: Math.abs(antesL - despuesL) < 1, largoCompleto: largo && largo.scrollWidth <= largo.clientWidth + 1 && /PARA PROBAR QUE NO SE CORTA$/.test(largo.innerText.replace(/\s+/g, ' ')) };
  });
  chk('★ Compacta en Android: cada fila ≤ 80 px (las tarjetas de v5.34 medían más del doble; ver informe)', med.max <= 80, JSON.stringify(med));
  chk('★ La PÁGINA no se desplaza a lo ancho; solo la tabla, de forma controlada', med.paginaAncho <= med.vista && med.tablaDesplaza && med.w > 0, JSON.stringify(med));
  chk('★ La columna del producto queda fija al desplazar la tabla', med.fijo, JSON.stringify(med));
  chk('Una descripción larga se lee completa (envuelve, no se corta)', med.largoCompleto, JSON.stringify(med));
  await p.evaluate(() => { document.querySelector('.fvs-t-wrap').scrollLeft = 0; });

  const ctl = await p.evaluate(() => ['.fvs-ctl__grupo', '#fvsDifAscBtn', '#fvsExportBtn'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return { s, w: r.width, h: r.height, dentro: r.right <= innerWidth + 1 }; }));
  chk('Botones Grupo / Diferencias ↑ / Exportar visibles, ≥ 44 px y dentro de la pantalla', ctl.every(c => c.h >= 44 && c.w >= 44 && c.dentro), JSON.stringify(ctl));

  // ── «Grupo» ──
  await p.selectOption('#fvsGrupoSel', 'RON'); await p.waitForTimeout(250);
  f = await filasTabla(p);
  const tG = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('★ «Grupo» = RON deja solo los 2 productos de RON', f.length === 2 && f.every(x => /^RON /.test(x.nombre)), f.map(x => x.nombre).join(','));
  chk('El botón dice el grupo elegido y el alcance del Excel lo aclara', /Grupo\s*RON/.test(tG) && /Excel: 2 productos · Grupo «RON»/.test(tG), tG.slice(0, 600));
  await p.selectOption('#fvsGrupoSel', ''); await p.waitForTimeout(250);
  chk('★ «Todos los grupos» regresa los 6', (await filasTabla(p)).length === 6);

  // ── «Diferencias ↑» ──
  await p.click('#fvsDifAscBtn'); await p.waitForTimeout(250);
  f = await filasTabla(p);
  const difs = f.map(x => num(x.celdas[5]));
  const contadas = difs.filter(d => d !== null);
  chk('★ «Diferencias ↑»: −4, −2, 0, +2, +3 y lo sin contar al final (orden numérico)', JSON.stringify(difs) === JSON.stringify([-4, -2, 0, 2, 3, null]), JSON.stringify(difs));
  chk('Las 6 filas siguen ahí, ahora sin cabeceras de grupo (el grupo va en cada fila)', f.length === 6 && contadas.length === 5
      && (await p.evaluate(() => document.querySelectorAll('tr.fvs-t__grupo').length)) === 0 && f[0].sub === 'A · Botellas · TEQUILA');
  chk('El botón queda marcado (aria-pressed) y el chip de invertir orden se oculta', await p.evaluate(() => document.getElementById('fvsDifAscBtn').getAttribute('aria-pressed') === 'true'
      && !document.querySelector('[data-sbx-filtro="orden_desc"]') && !!document.querySelector('[data-sbx-filtro="solo_dif"]')));
  await p.selectOption('#fvsGrupoSel', 'TEQUILA'); await p.waitForTimeout(250);
  f = await filasTabla(p);
  chk('★ El orden respeta el filtro de grupo (TEQUILA: −4 y luego +2)', JSON.stringify(f.map(x => x.nombre)) === JSON.stringify(['TEQUILA FALTANTE', 'MEZCAL CÓDIGO CON CEROS']), f.map(x => x.nombre).join(','));
  await p.selectOption('#fvsGrupoSel', ''); await p.waitForTimeout(150);
  await p.click('#fvsDifAscBtn'); await p.waitForTimeout(250);
  chk('★ Otro toque vuelve al orden original por grupo', await p.evaluate(() => document.querySelectorAll('tr.fvs-t__grupo').length === 4
      && document.getElementById('fvsDifAscBtn').getAttribute('aria-pressed') === 'false' && !!document.querySelector('[data-sbx-filtro="orden_desc"]')));

  // ── Búsqueda y chips siguen funcionando ──
  await p.click('[data-sbx-filtro="solo_dif"]'); await p.waitForTimeout(200);
  f = await filasTabla(p);
  chk('«Solo con diferencias» sigue funcionando (quita coincide y sin contar)', f.length === 4 && !f.some(x => /VODKA|COINCIDE/.test(x.nombre)), f.map(x => x.nombre).join(','));
  await p.click('[data-sbx-filtro="solo_dif"]'); await p.waitForTimeout(150);
  await p.fill('#sbx-input-fvs', 'ron'); await p.waitForTimeout(400);
  f = await filasTabla(p);
  chk('El buscador sigue filtrando dentro de la tabla', f.length === 2 && f.every(x => /RON/.test(x.nombre)), f.map(x => x.nombre).join(','));
  await p.fill('#sbx-input-fvs', ''); await p.waitForTimeout(400);

  // ── Nada de lo anterior escribió ──
  const esp1 = await p.evaluate(() => JSON.stringify(window.__esp));
  chk('★ Grupo, orden, chips y búsqueda: cero guardados, cero sync, cero escrituras de conteo', /"guardar":0,"sync":0,"syncMy":0/.test(esp1), esp1);
  chk('★ products, auditoriaConteo y myAuditoriaConteo IDÉNTICOS (orden incluido) tras filtrar y ordenar', (await estadoDatos(p)) === antes);

  // ── Corrección por área: sigue abriendo el modal de siempre ──
  await p.click('button[data-fvs-accion="editar"][data-fvs-pid="A"][data-fvs-area="almacen"]'); await p.waitForTimeout(250);
  const modal = await p.evaluate(() => !document.getElementById('inventarioModal').classList.contains('hidden'));
  chk('Admin: tocar un área de la fila abre el modal de corrección de siempre', modal);
  await p.evaluate(() => closeInventarioModal()); await p.waitForTimeout(150);
  chk('Cerrar el modal sin guardar no cambia nada', (await estadoDatos(p)) === antes);

  // ── Exportar (descarga real) ──
  const hayXlsx = await p.evaluate(async () => { for (let i = 0; i < 30 && typeof XLSX === 'undefined'; i++) await new Promise(r => setTimeout(r, 200)); return typeof XLSX !== 'undefined' ? XLSX.version : null; });
  if (!hayXlsx || !X) {
    NOVERIF.push('Descarga del .xlsx en el navegador (SheetJS no disponible: sin cdnjs ni copia local)');
  } else {
    await p.selectOption('#fvsGrupoSel', ''); await p.click('#fvsDifAscBtn'); await p.waitForTimeout(250);
    const visibles = (await filasTabla(p)).map(x => x.sub.split(' · ')[0]);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('#fvsExportBtn')]);
    const dir = path.join(os.tmpdir(), 'bi-v535'); fs.mkdirSync(dir, { recursive: true });
    const ruta = path.join(dir, dl.suggestedFilename()); await dl.saveAs(ruta);
    const buf = fs.readFileSync(ruta);
    chk('★ Descarga un .xlsx real (zip OOXML) con el nombre pedido', /^Diferencias_Fisico_y_Sistema_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()) && buf[0] === 0x50 && buf[1] === 0x4b, dl.suggestedFilename());
    chk('SheetJS de la app = 0.18.5', hayXlsx === '0.18.5', hayXlsx);
    const wb = X.read(buf, { type: 'buffer', cellNF: true });
    const ws = wb.Sheets['Diferencias'];
    const aoa = X.utils.sheet_to_json(ws, { header: 1, defval: null });
    chk('★ Las 9 columnas, en el orden exacto', JSON.stringify(aoa[0]) === JSON.stringify(['Grupo', 'ID', 'Descripción', 'Unidad', 'Cantidad en sistema', 'Cantidad contada', 'Diferencia', 'Precio', 'Precio total de diferencia']), JSON.stringify(aoa[0]));
    chk('★ Mismo orden que la tabla visible («Diferencias ↑»)', JSON.stringify(aoa.slice(1).map(r => r[1])) === JSON.stringify(visibles), aoa.slice(1).map(r => r[1]).join(',') + ' vs ' + visibles.join(','));
    const r = (id) => aoa.find(x => x[1] === id);
    chk('★ Faltante: sistema 10, contada 6, diferencia −4, precio 100, total −400', JSON.stringify(r('A')) === JSON.stringify(['TEQUILA', 'A', 'TEQUILA FALTANTE', 'Botellas', 10, 6, -4, 100, -400]), JSON.stringify(r('A')));
    chk('★ Sobrante en dos áreas: contada 5 (3 + 2), +3 × 50 = 150', JSON.stringify(r('B').slice(4)) === JSON.stringify([2, 5, 3, 50, 150]), JSON.stringify(r('B')));
    chk('★ Sin contar: sale, con sistema 5, y contada/diferencia/total VACÍOS', JSON.stringify(r('C').slice(4)) === JSON.stringify([5, null, null, 20, null]), JSON.stringify(r('C')));
    chk('★ Sin precio: precio y total VACÍOS, diferencia −2 conservada', JSON.stringify(r('E').slice(4)) === JSON.stringify([24, 22, -2, null, null]), JSON.stringify(r('E')));
    chk('Coincide: diferencia 0 y total 0 (no vacíos)', r('D')[6] === 0 && r('D')[8] === 0, JSON.stringify(r('D')));
    chk('ID "0012" como texto (no 12)', ws['B' + (aoa.findIndex(x => x[1] === '0012') + 1)].t === 's');
    chk('★ Los totales del Excel = el «Neto» de cada fila en pantalla', await p.evaluate((filasX) => {
      const d = fisicoVsSistemaCalcular();
      return filasX.every(x => { const fila = d.filas.find(y => y.id === x[1]); return x[8] === null ? (fila.estado === 'pendiente' || typeof products.find(p => p.id === x[1]).precio !== 'number') : x[8] === fila.neto; });
    }, aoa.slice(1)));
    const zip = X.CFB.read(buf, { type: 'buffer' });
    const xml = Buffer.from(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content).toString('utf8');
    chk('Encabezado congelado y filtros de Excel', /state="frozen"/.test(xml) && /<autoFilter ref="A1:I7"/.test(xml));
    // Con un grupo elegido, el archivo es ese grupo
    await p.click('#fvsDifAscBtn'); await p.selectOption('#fvsGrupoSel', 'RON'); await p.waitForTimeout(250);
    const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('#fvsExportBtn')]);
    const ruta2 = path.join(dir, 'grupo-' + dl2.suggestedFilename()); await dl2.saveAs(ruta2);
    const aoa2 = X.utils.sheet_to_json(X.read(fs.readFileSync(ruta2), { type: 'buffer' }).Sheets['Diferencias'], { header: 1, defval: null });
    chk('★ Con «Grupo» = RON el Excel trae solo RON, en el orden por grupo de la tabla', JSON.stringify(aoa2.slice(1).map(x => x[1])) === JSON.stringify(['D', 'B']), JSON.stringify(aoa2.slice(1).map(x => x[1])));
    const inf2 = X.utils.sheet_to_json(X.read(fs.readFileSync(ruta2), { type: 'buffer' }).Sheets['Información'], { header: 1 });
    chk('La hoja «Información» dice el alcance (grupo RON)', inf2.some(x => x[0] === 'Alcance' && /RON/.test(x[1])));
    chk('★ Exportar tampoco escribió nada', (await estadoDatos(p)) === antes && /"guardar":0,"sync":0,"syncMy":0/.test(await p.evaluate(() => JSON.stringify(window.__esp))));
  }

  // ── Atrás de Android: Volver, y la vista se reinicia ──
  await p.mouse.click(200, 120); await p.waitForTimeout(150);
  await p.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => null); await p.waitForTimeout(300);
  const tras = await p.evaluate(() => ({ vista: auditoriaView, tab: activeTab, grupo: _fvsVista.grupo, dif: _fvsVista.difAsc, url: location.pathname }));
  chk('★ Atrás de Android sale de Físico vs Sistema a la selección (sin salir de la app) y reinicia Grupo/orden', tras.vista === 'selection' && tras.tab === 'inventario' && tras.grupo === null && tras.dif === false && /index\.html/.test(tras.url), JSON.stringify(tras));
  chk('Sin errores de JavaScript (Android)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 2 · Escritorio (1280 px), claro y oscuro ════════════════════════════
  ({ ctx, p, errs } = await abrir(nav, { width: 1280, height: 800 }, 'admin'));
  const esc = await p.evaluate(() => { const w = document.querySelector('.fvs-t-wrap'); const al = Array.from(document.querySelectorAll('tr.fvs-t__fila')).map(r => r.getBoundingClientRect().height);
    return { cabe: w.scrollWidth <= w.clientWidth + 1, max: Math.max.apply(null, al) }; });
  chk('★ En pantalla grande la tabla cabe completa (sin desplazamiento) y sigue compacta', esc.cabe && esc.max <= 75, JSON.stringify(esc));
  for (const tema of ['light', 'dark']) {
    const col = await p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); const td = document.querySelector('.fvs-t__dif--faltante .fvs-t__difval'); const th = document.querySelector('.fvs-t__fila .fvs-t__prod');
      return { dif: getComputedStyle(td).color, fondo: getComputedStyle(th).backgroundColor }; }, tema);
    chk('Tema ' + (tema === 'light' ? 'claro' : 'oscuro') + ': faltante en color de peligro y columna fija con fondo opaco', /rgb/.test(col.dif) && col.fondo !== 'rgba(0, 0, 0, 0)', JSON.stringify(col));
  }
  chk('Sin errores de JavaScript (escritorio)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 3 · Permisos ════════════════════════════════════════════════════════
  ({ ctx, p, errs } = await abrir(nav, { width: 390, height: 844 }, 'ver'));
  const sinExp = await p.evaluate(() => ({ exp: !!document.getElementById('fvsExportBtn'), grupo: !!document.getElementById('fvsGrupoSel'), dif: !!document.getElementById('fvsDifAscBtn'),
    editar: document.querySelectorAll('button[data-fvs-accion="editar"]').length, r: exportarDiferenciasExcel().motivo }));
  chk('★ Sin permiso de exportar: no hay botón y la función se niega (Grupo y orden sí están)', !sinExp.exp && sinExp.grupo && sinExp.dif && sinExp.r === 'sin_permiso', JSON.stringify(sinExp));
  chk('Sin ser administración no hay botones de corrección (solo lectura, como antes)', sinExp.editar === 0);
  await ctx.close();
  ({ ctx, p, errs } = await abrir(nav, { width: 390, height: 844 }, 'subjefe'));
  chk('Subjefe con inventory.export ve «Exportar diferencias a Excel»', await p.evaluate(() => !!document.getElementById('fvsExportBtn')));
  chk('Sin errores de JavaScript (permisos)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  await nav.close();
  console.log('\n  ── v5.35 · Físico vs Sistema: tabla, Grupo, Diferencias ↑ y Excel (navegador) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + (c.d || ''))));
  NOVERIF.forEach(n => console.log('  ⚪  NO VERIFICADO: ' + n));
  const fl = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fl) + ' pasaron · ' + fl + ' fallaron' + (NOVERIF.length ? ' · ' + NOVERIF.length + ' sin verificar' : '') + '\n');
  process.exit(fl ? 1 : 0);
})();
