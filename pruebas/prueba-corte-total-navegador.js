// v5.21 — Corte de existencias con el reporte de SBO ("En Stock" = total).
// Chromium real a 390×844 contra la app:
//   · el archivo de SBO (CSV con BOM, "Almacén" = 12) se lee por el selector real
//     de archivos (si SheetJS cargó) y llega a la vista previa sin errores;
//   · el interruptor "Conservar su Total / Ponerlos en 0" recalcula la vista previa;
//   · al registrar se escribe UN documento con los totales de SBO (y los 0 si se eligió);
//   · opciones ≥ 44 px, sin desborde, contraste en oscuro y claro.
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

  // El CSV tal como lo exporta SBO: BOM, comillas solo donde hace falta, ".790000" sin cero.
  const CSV = '﻿Código,Artículo,Grupo,Almacén,"Nombre Almacén","En Stock",Comprometido,Pedido,Disponible\n'
    + '1180001,"TEQUILA DON JULIO","3 TEQUILA",12,"BARRA MOCHOMOS MONTERREY",2.750000,.000000,.000000,2.750000\n'
    + '1060020,FRESCA,"2 BEBIDAS",12,"BARRA MOCHOMOS MONTERREY",.500000,.000000,.000000,.500000\n'
    + '1200100,"WHISKY AJENO AL CATALOGO","3 WHISKY",12,"BARRA MOCHOMOS MONTERREY",1.000000,.000000,.000000,1.000000\n'
    + '1180001,"TEQUILA DON JULIO","3 TEQUILA",13,"OTRO ALMACEN",9.000000,.000000,.000000,9.000000\n';
  await p.evaluate(() => {
    importarVolver(); __ir('importar');
    window.__sets = [];
    const consulta = (ruta) => { const q = { doc: (id) => docRef(ruta + '/' + id), get: async () => ({ empty: true, docs: [], size: 0, forEach() {} }),
      onSnapshot: () => () => {} }; ['orderBy', 'where', 'limit', 'startAfter', 'endBefore'].forEach(k => { q[k] = () => q; }); return q; };
    const docRef = (ruta) => ({ collection: (c) => consulta(ruta + '/' + c), onSnapshot: () => () => {},
      set: async (data) => { window.__sets.push({ ruta, data: JSON.parse(JSON.stringify(data)) }); }, get: async () => ({ exists: false, data: () => null }) });
    _db = { collection: (c) => consulta(c) };
    window._anclaPosteriorA = async () => ({ hay: false });
    window.existenciaCargarInicial = function () {};
  });
  if (process.env.XLSX_LOCAL) await p.addScriptTag({ path: process.env.XLSX_LOCAL });   // sin red: SheetJS desde disco
  const hayXlsx = await p.evaluate(() => typeof XLSX !== 'undefined');
  if (hayXlsx) {
    // Camino real: botón "Subir" → <input type=file> → FileReader → SheetJS → vista previa.
    await p.evaluate(() => { _impSeccionArchivo = 'existencias'; });
    await p.setInputFiles('#impArchivo', { name: 'existencias_SBO_PASIONS01_2026-10-09_1.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
  } else {
    // Sin la librería (sin red en esta máquina): las filas tal como las entrega SheetJS.
    await p.evaluate(() => importarProcesarFilas('existencias', [
      { 'Código': 1180001, 'Artículo': 'TEQUILA DON JULIO', Grupo: '3 TEQUILA', 'Almacén': 12, 'Nombre Almacén': 'BARRA MOCHOMOS MONTERREY', 'En Stock': 2.75, Comprometido: 0, Pedido: 0, Disponible: 2.75 },
      { 'Código': 1060020, 'Artículo': 'FRESCA', Grupo: '2 BEBIDAS', 'Almacén': 12, 'Nombre Almacén': 'BARRA MOCHOMOS MONTERREY', 'En Stock': 0.5, Comprometido: 0, Pedido: 0, Disponible: 0.5 },
      { 'Código': 1200100, 'Artículo': 'WHISKY AJENO AL CATALOGO', Grupo: '3 WHISKY', 'Almacén': 12, 'Nombre Almacén': 'BARRA MOCHOMOS MONTERREY', 'En Stock': 1, Comprometido: 0, Pedido: 0, Disponible: 1 },
      { 'Código': 1180001, 'Artículo': 'TEQUILA DON JULIO', Grupo: '3 TEQUILA', 'Almacén': 13, 'Nombre Almacén': 'OTRO ALMACEN', 'En Stock': 9, Comprometido: 0, Pedido: 0, Disponible: 9 }
    ], 'existencias_SBO.csv'));
  }
  await p.waitForTimeout(700);
  chk('Camino de lectura: ' + (hayXlsx ? 'archivo CSV real por el selector de archivos (SheetJS)' : 'filas simuladas (SheetJS no cargó en esta máquina)'), true);
  const vp = await p.evaluate(() => {
    const b = document.getElementById('impBtnAplicar');
    return { tab: activeTab, dis: b ? b.disabled : null, errores: document.querySelectorAll('.imp-msgs--error li').length,
             avisos: [...document.querySelectorAll('.imp-msgs--aviso li')].map(x => x.innerText),
             kpis: [...document.querySelectorAll('.imp-kpi')].map(k => k.innerText.replace(/\s+/g, ' ')),
             texto: (document.querySelector('.imp-wrap') || {}).innerText || '',
             radios: [...document.querySelectorAll('input[name="impFalt"]')].map(r => [r.value, r.checked]) };
  });
  chk('★ El archivo de SBO llega a la vista previa SIN errores y con "Registrar corte" habilitado', vp.tab === 'importar' && vp.errores === 0 && vp.dis === false, JSON.stringify([vp.tab, vp.errores, vp.dis, vp.texto.slice(0, 160)]));
  chk('★ Contados = 2 (el código ajeno y la fila del almacén 13 no cuentan)', /Contados 2/.test(vp.kpis[0] || ''), vp.kpis.join(' | '));
  chk('Avisa del código fuera del catálogo y de la fila de otro almacén', vp.avisos.some(a => /1200100/.test(a)) && vp.avisos.some(a => /almacén distinto del 12/.test(a)), JSON.stringify(vp.avisos));
  chk('★ Ofrece Conservar (marcado por defecto) / Ponerlos en 0', JSON.stringify(vp.radios) === JSON.stringify([['conservar', true], ['cero', false]]), JSON.stringify(vp.radios));
  chk('Explica que "En Stock" se tomó como total, del almacén 12, con la cobertura', /En Stock/.test(vp.texto) && /almacén 12/.test(vp.texto) && /Cubre 2 de 3/.test(vp.texto), vp.texto.slice(0, 260));
  chk('El Neto vs sistema se calcula con los totales de SBO (tequila 2.75 vs 2 = +$262.50; fresca 0.5 vs 10 = −$114)', /\$148\.50|148\.5/.test(vp.kpis[2] || ''), vp.kpis.join(' | '));

  const geo = await p.evaluate(() => ({ altos: [...document.querySelectorAll('.imp-opcion')].map(x => __m.alto(x)), desborde: document.documentElement.scrollWidth - window.innerWidth,
                                         radio: [...document.querySelectorAll('.imp-opcion input')].map(r => Math.round(r.getBoundingClientRect().width)) }));
  chk('★ Las opciones miden ≥ 44 px, el radio ≥ 22 px y no hay desborde a 390 px', geo.altos.length === 2 && geo.altos.every(a => a >= 44) && geo.radio.every(w => w >= 22) && geo.desborde <= 0, JSON.stringify(geo));
  for (const t of ['dark', 'light']) {
    await tema(t); await p.waitForTimeout(100);
    const c = await p.evaluate(() => ({ tit: __m.contraste(document.querySelector('.imp-opcion b')), peq: __m.contraste(document.querySelector('.imp-opcion small')) }));
    chk('[' + t + '] Contraste de las opciones ≥ 4.5', c.tit >= 4.5 && c.peq >= 4.5, JSON.stringify(c));
  }
  await tema('dark');

  // ── Ponerlos en 0 ─────────────────────────────────────────────────────────
  await p.click('.imp-opcion:has(input[value="cero"])'); await p.waitForTimeout(250);
  const v0 = await p.evaluate(() => ({ kpis: [...document.querySelectorAll('.imp-kpi')].map(k => k.innerText.replace(/\s+/g, ' ')),
    radios: [...document.querySelectorAll('input[name="impFalt"]')].map(r => [r.value, r.checked]),
    texto: (document.querySelector('.imp-wrap') || {}).innerText || '', dis: document.getElementById('impBtnAplicar').disabled }));
  chk('★ Al elegir "Ponerlos en 0" la vista previa se recalcula: 1 producto en 0 (limón) y la opción queda marcada',
      /En 0 \(no vienen\) 1/.test(v0.kpis[1] || '') && JSON.stringify(v0.radios) === JSON.stringify([['conservar', false], ['cero', true]]) && v0.dis === false, JSON.stringify([v0.kpis, v0.radios]));
  if (process.env.CAPTURA) await p.screenshot({ path: process.env.CAPTURA, fullPage: true });   // revisión visual (opcional)
  chk('…y lo avisa (1 producto se registra en 0)', /se registran en 0/.test(v0.texto), v0.texto.slice(0, 300));

  await p.evaluate(() => { importarCambiarMomento('fecha', '2026-10-08'); importarCambiarMomento('hora', '22:00'); }); await p.waitForTimeout(150);
  await p.click('#impBtnAplicar'); await p.waitForTimeout(700);
  const ea = await p.evaluate(() => ({ sets: window.__sets, confirm: window.__confirm.slice(-1)[0] || '', res: (document.querySelector('.imp-wrap') || {}).innerText || '' }));
  const s0 = ea.sets[0] || {};
  chk('★ Se escribe UN solo documento, anclasExistencia/2026-10-08_2200, tipo importacion_excel', ea.sets.length === 1 && /\/anclasExistencia\/2026-10-08_2200$/.test(s0.ruta || '') && s0.data && s0.data.tipo === 'importacion_excel', JSON.stringify([ea.sets.length, s0.ruta]));
  chk('★ Guarda los TOTALES de SBO (tequila 2.75, fresca 0.5), el limón en 0 y nada del almacén 13 ni del código ajeno',
      s0.data && s0.data.saldos['1180001'] === 2.75 && s0.data.saldos['1060020'] === 0.5 && s0.data.saldos['1020064'] === 0 && !('1200100' in s0.data.saldos), JSON.stringify(s0.data && s0.data.saldos));
  chk('Deja constancia del origen: modoArchivo "total", faltantes "cero", 1 en cero', s0.data && s0.data.modoArchivo === 'total' && s0.data.faltantes === 'cero' && s0.data.productosEnCero === 1);
  chk('La confirmación menciona SBO y los productos que quedan en 0', /REGISTRAR CORTE/.test(ea.confirm) && /Archivo de SBO/.test(ea.confirm) && /quedan en 0/.test(ea.confirm), ea.confirm.slice(0, 260));
  chk('Resultado: corte registrado y cuántos quedaron en 0', /2026-10-08_2200/.test(ea.res) && /1 quedaron en 0/.test(ea.res), ea.res.slice(0, 200));

  // ── Conservar (por defecto) ───────────────────────────────────────────────
  await p.evaluate(() => { window.__sets = []; importarProcesarFilas('existencias', [
      { 'Código': 1180001, 'Artículo': 'TEQUILA DON JULIO', 'Almacén': 12, 'En Stock': 2.75 }], 'existencias_SBO.csv'); });
  await p.waitForTimeout(250);
  await p.evaluate(() => { importarCambiarMomento('fecha', '2026-10-07'); importarCambiarMomento('hora', '21:00'); }); await p.waitForTimeout(150);
  await p.click('#impBtnAplicar'); await p.waitForTimeout(600);
  const sc = await p.evaluate(() => window.__sets[0] || null);
  chk('★ Con "Conservar" (por defecto) no se inventa ningún 0: el limón y la fresca no entran al corte si no eran oficiales',
      sc && sc.data && sc.data.faltantes === 'conservar' && sc.data.productosEnCero === 0 && sc.data.saldos['1180001'] === 2.75 && !('1020064' in sc.data.saldos), JSON.stringify(sc && sc.data && sc.data.saldos));

  // ── La plantilla de siempre sigue igual ──────────────────────────────────
  await p.evaluate(() => { _db = null; importarVolver(); importarProcesarFilas('existencias', [{ 'Código': '1180001', Enteras: 2, Abierta: 0.75 }], 'plantilla.xlsx'); });
  await p.waitForTimeout(200);
  const pl = await p.evaluate(() => ({ radios: document.querySelectorAll('input[name="impFalt"]').length, dis: document.getElementById('impBtnAplicar').disabled,
                                        kpi: (document.querySelector('.imp-kpi') || {}).innerText }));
  chk('★ Con la plantilla (Enteras/Abierta) no aparece el interruptor y todo sigue igual', pl.radios === 0 && pl.dis === false && /Contados/.test(pl.kpi || ''), JSON.stringify(pl));

  chk('Sin errores de JavaScript en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();
  let mal = 0; C.forEach(c => { if (!c.ok) mal++; console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  →  ' + c.d)); });
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron');
  process.exit(mal ? 1 : 0);
})();
