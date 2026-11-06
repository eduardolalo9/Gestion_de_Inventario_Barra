// v5.41 — Chromium real (390 × 844): Compras con «Importar Excel», rango de fechas de ingreso
// y resumen (entradas, proveedores, total, líneas). Firestore va SIMULADO en memoria (con dos
// semanas locales y entradas viejas solo en el «servidor»): nada toca Firebase.
//   npm run test:v541nav
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const URL_APP = 'http://127.0.0.1:' + (process.env.PUERTO || '8080') + '/index.html';

const MONTAJE = (perms) => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden');
  document.getElementById('loginScreen').classList.add('auth-hidden');
  document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u1'; currentUserRole = 'admin';
  _authzState.loaded = true; _authzState.overrides = {}; _authzState.roleId = 'ADMIN'; _authzState.permissions = new Set(perms);
  products = [{ id: 'P0', name: 'TEQUILA 1800', group: 'TEQUILA', unit: 'PZA', precio: 300, stockByArea: { almacen: 1 } }];
  const mk = (id, ing, prov, nl, imp, extra) => Object.assign({ compraId: id, folio: id.toUpperCase(), fecha: ing, fechaIngreso: ing, semanaId: semanaId(ing),
    proveedorNombre: prov, origen: 'excel', importe: imp,
    lineas: Array.from({ length: nl }, (_, i) => ({ productoId: 'P0', descripcionSap: 'ART ' + i, cantidadInventario: 1, cantidadDocumento: 1, unidadDocumento: 'PZA', costoUnitario: imp / nl, importe: imp / nl, enCatalogo: true })) }, extra || {});
  const local = [mk('a', '2026-10-31', 'ALFA', 2, 100), mk('b', '2026-11-01', 'ALFA', 3, 300), mk('c', '2026-11-02', 'BETA', 1, 50),
                 mk('d', '2026-11-05', 'BETA', 4, 400), mk('e', '2026-11-03', 'GAMA', 2, 999, { cancelada: true })];
  const viejas = [mk('z0', '2026-09-10', 'PROVEEDOR VIEJO', 1, 10), mk('z1', '2026-09-11', 'PROVEEDOR VIEJO', 2, 20), mk('z2', '2026-09-12', 'OTRO VIEJO', 1, 30)];
  compras = local.slice(); movimientos = [];
  window.__servidor = local.concat(viejas); window.__consultas = []; window.__escrituras = 0;
  const crear = (q) => ({
    where(c, op, v) { return crear({ f: q.f.concat([[c, op, v]]), o: q.o, l: q.l }); },
    orderBy(c, d) { return crear({ f: q.f, o: [c, d], l: q.l }); },
    limit(n) { return crear({ f: q.f, o: q.o, l: n }); },
    set() { window.__escrituras++; return Promise.resolve(); }, update() { window.__escrituras++; return Promise.resolve(); },
    async get() {
      window.__consultas.push(q.f.map(x => x[0]).join(','));
      await new Promise(r => setTimeout(r, 120));
      let r = window.__servidor.filter(d => q.f.every(([c, op, v]) => d[c] !== undefined && (op === '>=' ? d[c] >= v : d[c] <= v)));
      if (q.o) r.sort((a, b) => String(b[q.o[0]]).localeCompare(String(a[q.o[0]])));
      if (q.l) r = r.slice(0, q.l);
      return { docs: r.map(d => ({ data: () => d })) };
    }
  });
  _db = { collection() { return crear({ f: [], o: null, l: null }); }, batch() { window.__escrituras++; return { set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }; } };
  activeTab = 'compras'; renderTab();
};

const kpis = (p) => p.evaluate(() => [...document.querySelectorAll('#cp-resumen .kpi')].map(k => [k.querySelector('.kpi__t').textContent.trim(), k.querySelector('.kpi__n').textContent.trim()]));
const tarjetas = (p) => p.evaluate(() => [...document.querySelectorAll('.cp-tarjeta')].map(t => t.getAttribute('data-compra-id')).sort().join(''));
const listo = (p) => p.waitForFunction(() => _comprasRangoCache.estado !== 'cargando', null, { timeout: 5000 });

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('inventarioApp_theme', 'dark'); localStorage.setItem('inventarioApp_temaMarca', 'ultra-pro'); } catch (e) {} });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  p.on('dialog', d => d.dismiss());
  await p.goto(URL_APP, { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600);
  await p.evaluate(MONTAJE, ['*']); await p.waitForTimeout(300);

  // ═══ 1 · Importar Excel ═══
  const btn = await p.evaluate(() => { const b = [...document.querySelectorAll('.cp-acciones button')].find(x => /Importar Excel/.test(x.textContent)); const r = b && b.getBoundingClientRect();
    return b ? { alto: Math.round(r.height), der: r.right, ico: !!b.querySelector('.fa-file-excel'), ancho: Math.round(getComputedStyle(b.querySelector('i'), '::before').width.replace('px', '')) || 1 } : null; });
  chk('★ Compras muestra «Importar Excel» con su icono, ≥ 44 px y dentro de la pantalla', btn && btn.alto >= 44 && btn.der <= 390 && btn.ico, JSON.stringify(btn));
  const disparo = await p.evaluate(() => { let id = null; const o = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function() { id = this.id; };
    try { [...document.querySelectorAll('.cp-acciones button')].find(x => /Importar Excel/.test(x.textContent)).click(); } finally { HTMLInputElement.prototype.click = o; } return id; });
  chk('★ El botón abre el selector de archivos de COMPRAS (#fileInputCompras), el mismo flujo de siempre', disparo === 'fileInputCompras', String(disparo));
  await p.evaluate(MONTAJE, ['purchases.read', 'purchases.create']); await p.waitForTimeout(200);
  chk('★ Sin purchases.import el botón no aparece (pero «Capturar a mano» sí, con su permiso)', await p.evaluate(() => !/Importar Excel/.test(document.querySelector('.cp-acciones').innerText) && /Capturar a mano/.test(document.querySelector('.cp-acciones').innerText)));
  await p.evaluate(MONTAJE, ['*']); await p.waitForTimeout(200);

  // ═══ 2 · Resumen sin rango ═══
  let k = await kpis(p);
  chk('★ Resumen: Entradas · Proveedores · Total compras · Líneas (en ese orden)', JSON.stringify(k.map(x => x[0])) === JSON.stringify(['Entradas', 'Proveedores', 'Total compras', 'Líneas']), JSON.stringify(k));
  chk('Sin rango: 4 entradas activas, 2 proveedores, $850.00 y 10 líneas (la cancelada no cuenta)', JSON.stringify(k.map(x => x[1])) === JSON.stringify(['4', '2', '$850.00', '10']), JSON.stringify(k));
  chk('★ Ninguna etiqueta del resumen se corta («Proveedores», «Total compras») y los importes caben enteros a 390 px',
      await p.evaluate(() => [...document.querySelectorAll('#cp-resumen .kpi__t, #cp-resumen .kpi__n')].every(e => e.scrollWidth <= e.clientWidth + 1)),
      await p.evaluate(() => JSON.stringify([...document.querySelectorAll('#cp-resumen .kpi__t, #cp-resumen .kpi__n')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent + ':' + e.scrollWidth + '>' + e.clientWidth))));
  chk('El periodo dice que son las entradas cargadas en el dispositivo', await p.evaluate(() => /Todo lo cargado en este dispositivo/.test(document.querySelector('.cp-periodo').innerText)));
  chk('Hay dos campos de fecha (Desde / Hasta) de 44 px y el botón «Quitar fechas» está oculto', await p.evaluate(() => { const d = document.getElementById('cp-desde'), h = document.getElementById('cp-hasta'), l = document.getElementById('cp-rango-limpiar');
    return d.type === 'date' && h.type === 'date' && d.getBoundingClientRect().height >= 44 && h.getBoundingClientRect().height >= 44 && l.hidden; }));

  // ═══ 3 · Rango dentro de lo cargado ═══
  await p.fill('#cp-desde', '2026-11-01'); await listo(p); await p.waitForTimeout(150);
  await p.fill('#cp-hasta', '2026-11-02'); await listo(p); await p.waitForTimeout(150);
  k = await kpis(p);
  chk('★ Rango 01/11 → 02/11: 2 entradas (b y c), 2 proveedores, $350.00 y 4 líneas', JSON.stringify(k.map(x => x[1])) === JSON.stringify(['2', '2', '$350.00', '4']), JSON.stringify(k));
  chk('★ La lista muestra SOLO las entradas del rango (ambos días incluidos)', (await tarjetas(p)) === 'bc', await tarjetas(p));
  chk('El periodo nombra el rango y aparece «Quitar fechas»', await p.evaluate(() => /01\/11\/2026 al 02\/11\/2026/.test(document.querySelector('.cp-periodo').innerText.replace(/\s+/g, ' ')) && !document.getElementById('cp-rango-limpiar').hidden));
  chk('El selector de proveedor solo ofrece los proveedores del rango (ALFA, BETA)', await p.evaluate(() => [...document.querySelectorAll('#cp-filtro-prov option')].map(o => o.textContent.replace(/\s*\(\d+\)/, '').trim()).join('|') === 'Todos los proveedores|ALFA|BETA'));
  await p.selectOption('#cp-filtro-prov', { label: 'ALFA (1)' }); await p.waitForTimeout(150);
  k = await kpis(p);
  chk('★ El resumen sigue al proveedor elegido: ALFA en el rango = 1 entrada, $300.00, 3 líneas', JSON.stringify(k.map(x => x[1])) === JSON.stringify(['1', '1', '$300.00', '3']) && (await tarjetas(p)) === 'b', JSON.stringify(k));
  await p.selectOption('#cp-filtro-prov', ''); await p.waitForTimeout(100);

  // ═══ 4 · Rango viejo: se consulta al servidor ═══
  const antes = await p.evaluate(() => ({ c: compras.length, m: movimientos.length, ls: localStorage.getItem('inventarioApp_compras') }));
  await p.fill('#cp-desde', '2026-09-01'); await p.waitForTimeout(40);
  chk('Mientras consulta lo dice («Consultando…») con aria-live', await p.evaluate(() => { const a = document.querySelector('#cp-resumen .cp-aviso'); return !!a && /Consultando/.test(a.innerText) && a.getAttribute('role') === 'status'; }));
  await listo(p); await p.fill('#cp-hasta', '2026-09-30'); await listo(p); await p.waitForTimeout(200);
  k = await kpis(p);
  chk('★ Un rango que la app NO tenía cargado (septiembre) trae sus entradas del servidor: 3 entradas, 2 proveedores, $60.00, 4 líneas', JSON.stringify(k.map(x => x[1])) === JSON.stringify(['3', '2', '$60.00', '4']) && (await tarjetas(p)) === 'z0z1z2', JSON.stringify(k) + await tarjetas(p));
  chk('★ La consulta fue por rango (fechaIngreso y fecha), nunca la colección entera', await p.evaluate(() => window.__consultas.length >= 2 && window.__consultas.every(q => /^(fechaIngreso|fecha)(,\1)?$/.test(q))), await p.evaluate(() => JSON.stringify(window.__consultas)));
  chk('★ Consultar NO escribe nada: ni compras/movimientos locales, ni el almacenamiento del dispositivo, ni Firestore', await p.evaluate((a) => compras.length === a.c && movimientos.length === a.m && localStorage.getItem('inventarioApp_compras') === a.ls && window.__escrituras === 0, antes));
  await p.click('.cp-tarjeta[data-compra-id="z1"]'); await p.waitForTimeout(250);
  chk('★ Una entrada consultada (que no está en `compras`) abre su detalle', await p.evaluate(() => { const t = document.getElementById('cd-titulo'); return !!t && /PROVEEDOR VIEJO/.test(t.textContent); }));
  await p.evaluate(() => comprasCerrarDetalle()); await p.waitForTimeout(100);

  // ═══ 5 · Sin conexión: no finge estar completo ═══
  await ctx.setOffline(true);
  await p.fill('#cp-desde', '2026-08-01'); await p.waitForTimeout(250);
  const off = await p.evaluate(() => { const a = document.querySelector('#cp-resumen .cp-aviso--alerta'); return a ? { txt: a.innerText, rol: a.getAttribute('role') } : null; });
  chk('★ Sin conexión: avisa que solo cuenta lo guardado en el dispositivo y que el rango puede estar incompleto', off && /Sin consultar el servidor/.test(off.txt) && /incompleto/.test(off.txt) && off.rol === 'alert', JSON.stringify(off));
  await ctx.setOffline(false);

  // ═══ 6 · Rango vacío y rango al revés ═══
  await p.fill('#cp-desde', '2027-01-01'); await listo(p); await p.fill('#cp-hasta', '2027-01-31'); await listo(p); await p.waitForTimeout(150);
  chk('★ Rango sin entradas: «Sin entradas en este rango», resumen en 0 y salida «Quitar fechas»', await p.evaluate(() => /Sin entradas en este rango/.test(document.getElementById('sbx-res-compras').innerText) && [...document.querySelectorAll('#cp-resumen .kpi__n')].map(x => x.textContent).join() === '0,0,$0.00,0'));
  await p.fill('#cp-hasta', '2026-12-31'); await p.waitForTimeout(100); await p.fill('#cp-desde', '2027-02-01'); await listo(p); await p.waitForTimeout(150);
  chk('★ Si «desde» pasa de «hasta», los campos se alinean (nunca un rango al revés)', await p.evaluate(() => document.getElementById('cp-desde').value === '2027-02-01' && document.getElementById('cp-hasta').value === '2027-02-01'));
  await p.click('#cp-rango-limpiar'); await p.waitForTimeout(200);
  k = await kpis(p);
  chk('★ «Quitar fechas» regresa al resumen de lo cargado y oculta el botón', JSON.stringify(k.map(x => x[1])) === JSON.stringify(['4', '2', '$850.00', '10']) && await p.evaluate(() => document.getElementById('cp-rango-limpiar').hidden && document.getElementById('cp-desde').value === ''));

  // ═══ 7 · App sin compras cargadas: igual se puede consultar un rango ═══
  await p.evaluate(MONTAJE, ['*']); await p.evaluate(() => { compras = []; renderTab(); }); await p.waitForTimeout(200);
  chk('Sin compras cargadas: estado vacío con los campos de fecha disponibles (y sin lista)', await p.evaluate(() => !!document.getElementById('cp-desde') && !document.getElementById('sbx-res-compras') && /Todavía no hay compras/.test(document.getElementById('tabContent').innerText)));
  await p.fill('#cp-desde', '2026-09-01'); await listo(p); await p.fill('#cp-hasta', '2026-09-30'); await listo(p); await p.waitForTimeout(250);
  chk('★ …y al elegir fechas aparece la lista con lo que hay en el servidor', (await tarjetas(p)) === 'z0z1z2');
  await p.click('#cp-rango-limpiar'); await p.waitForTimeout(250);
  chk('…y al quitar las fechas vuelve el estado vacío', await p.evaluate(() => !document.getElementById('sbx-res-compras') && /Todavía no hay compras/.test(document.getElementById('tabContent').innerText)));

  // ═══ 8 · Pantalla: sin desborde y capturas ═══
  await p.evaluate(MONTAJE, ['*']); await p.waitForTimeout(200);
  await p.fill('#cp-desde', '2026-11-01'); await listo(p); await p.fill('#cp-hasta', '2026-11-05'); await listo(p); await p.waitForTimeout(250);
  chk('Sin desborde horizontal a 390 px y todos los controles nuevos ≥ 44 px', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1
    && [...document.querySelectorAll('.cp-acciones button, .cp-rango input, #cp-rango-limpiar, #cp-filtro-prov')].every(e => e.getBoundingClientRect().height >= 44)));
  chk('Sin atributos style="…" en lo nuevo (rango, resumen y acciones van en clases)', await p.evaluate(() => !document.querySelector('.cp-rango [style], #cp-resumen [style], .cp-acciones [style]')));
  if (process.env.CAPTURAS) await p.screenshot({ path: process.env.CAPTURAS + '/v541-compras-rango.png' });
  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();
  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── v5.41 · Compras: Importar Excel y rango de fechas (navegador) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const f = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - f) + ' pasaron · ' + f + ' fallaron\n');
  process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
