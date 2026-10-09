// FASE 14 — ancla del Total y venta del turno (Simular / Procesar), en Chromium
// real contra la app (390×844), tema oscuro y claro. Sin Firestore: el ancla y
// los periodos se ponen en memoria, y la escritura se sustituye por un doble que
// registra la llamada — así se demuestra que SIMULAR no escribe y PROCESAR sí.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  // ── Escenario: corte hace 3 días, una venta posterior ya procesada ──────
  const esc = await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {}; _authzState.roleId = 'ADMIN';
    const dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return fechaISOLocal(d); };
    products = [
      { id: 'TEQ', name: 'TEQUILA DON JULIO', unit: 'PZA', group: 'Tequila', precio: 350, stockMinimo: 1, conversion: 1, stockByArea: { almacen: 0 } },
      { id: 'LIM', name: 'LIMON', unit: 'KGS', group: 'Fruta', stockByArea: { almacen: 4 } },
      { id: 'GIN', name: 'GINEBRA', unit: 'PZA', group: 'Ginebra', precio: 400, stockByArea: { almacen: 0 } }
    ];
    recetas = [{ id: 'r1', pv: 'PV1', nombre: 'MARGARITA', activa: true,
                 ingredientes: [{ productoId: 'TEQ', cantidad: 0.06, uom: 'PZA' }, { productoId: 'LIM', cantidad: 0.03, uom: 'KGS' }] },
               { id: 'r2', pv: 'PV2', nombre: 'GIN TONIC', activa: true, ingredientes: [{ productoId: 'GIN', cantidad: 0.06, uom: 'PZA' }] }];
    movimientos = []; compras = [];
    _existenciaInicial = { semana: semanaId(new Date()), estado: 'ok', saldos: { TEQ: 1, GIN: 5 }, origen: { numero: 1009 },
                           ancla: { tipo: 'mitad_de_semana', fecha: dia(-3), id: dia(-3), ruta: 'arrastre', dias: 3 } };
    _existenciaArrastre = { anclaFecha: dia(-3), compras: [], comprasNoDisponibles: false, ventasNoDisponibles: false, version: 99,
                            periodos: [{ id: dia(-2) + '_' + dia(-2), inicio: dia(-2), fin: dia(-2), lineas: [{ sku: 'PV1', cantidad: 5 }] }] };
    _existenciaArrastreMemo = { clave: null };
    return { corte: dia(-3), hoy: dia(0), ayer: dia(-1) };
  });

  // ── 1 · El Total sale del ancla ──────────────────────────────────────────
  const tot = await p.evaluate(() => ({ teq: existenciaOficial(products[0]), lim: existenciaOficial(products[1]) }));
  chk('★ Total del tequila = corte 1 − 5×0.06 = 0.7 (venta posterior al corte)', tot.teq.valor === 0.7 && tot.teq.origen === 'oficial', JSON.stringify(tot.teq));
  chk('Un insumo que no entró al corte usa el respaldo (limón = 4 de áreas)', tot.lim.valor === 4 && tot.lim.origen === 'operativo_no_reconciliado', JSON.stringify(tot.lim));

  await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); activeTab = 'inicio'; renderTab(); });
  await p.waitForTimeout(300);
  const panel = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('★ Inicio explica el origen del Total: tarjeta "Origen del Total" con el ancla',
      /Origen del Total/.test(panel) && /Recuento de mitad de semana/.test(panel), panel.slice(0, 400));
  chk('…y avisa los días de ventas que faltan desde el corte (ayer no está cargado)', /Faltan 1 día\(s\) de ventas/.test(panel), '');

  await p.evaluate(() => abrirFichaProducto('TEQ')); await p.waitForTimeout(200);
  const ficha = await p.evaluate(() => (document.getElementById('pm-ficha-wrap') || {}).innerText || '');
  chk('La ficha muestra el desglose "Desde el último corte" con el consumo teórico',
      /Desde el último corte/i.test(ficha) && /Consumo teórico/i.test(ficha) && /−0\.3/.test(ficha), ficha.slice(0, 500));
  await p.evaluate(() => cerrarFichaProducto());

  // ── 2 · Vista previa de la venta del turno ──────────────────────────────
  await p.evaluate((esc) => {
    window.__escrituras = [];
    // Dobles de la capa de datos: registran, no tocan la red.
    leerPeriodosVentasSemana = async () => [];
    guardarVentasPeriodo = async (periodo, lineas) => { window.__escrituras.push({ periodo, n: lineas.length }); return { ok: true, id: periodo.inicio + '_' + periodo.fin }; };
    _crearBackupNombrado = () => {};
    _ventasImportPendiente = {
      lineas: [{ sku: 'PV1', nombre: 'MARGARITA', cantidad: 20, ventaNeta: 3000 }, { sku: 'PV2', nombre: 'GIN TONIC', cantidad: 10, ventaNeta: 1500 },
               { sku: 'PV9', nombre: 'TE GOURMET', cantidad: 2, ventaNeta: 100 }],
      incidencias: [], skusAgrupados: [], filasIgnoradas: 0, totalUnidades: 32, excedeTope: false,
      hoja: 'Detalle', archivo: 'turno.xlsx',
      periodo: { inicio: esc.ayer, fin: esc.ayer },
      existentes: { semanaId: semanaId(esc.ayer), estado: 'ok', periodos: [] }
    };
    ventasImportView = 'vista_previa'; activeTab = 'ventas'; renderTab();
  }, esc);
  await p.waitForTimeout(200);
  const prev = await p.evaluate(() => ({
    txt: document.getElementById('tabContent').innerText,
    btnSim: (() => { const b = document.getElementById('vtBtnSimular'); return b ? Math.round(b.getBoundingClientRect().height) : 0; })(),
    proc: (() => { const b = document.getElementById('ventasBtnConfirmar'); return b ? { txt: b.innerText, dis: b.disabled } : null; })()
  }));
  chk('La vista previa ofrece "Reventar contra recetas" con el botón Simular (≥44 px)',
      /Reventar contra recetas/.test(prev.txt) && prev.btnSim >= 44, JSON.stringify(prev.btnSim));
  chk('El botón de guardar ahora dice "Procesar venta (baja el inventario)" y está habilitado',
      prev.proc && /Procesar venta \(baja el inventario\)/.test(prev.proc.txt) && !prev.proc.dis, JSON.stringify(prev.proc));

  // ── 3 · SIMULAR: calcula, no escribe ───────────────────────────────────
  const antesVentas = await p.evaluate(() => JSON.stringify(ventas));
  await p.click('#vtBtnSimular'); await p.waitForTimeout(250);
  const sim = await p.evaluate(() => ({
    txt: (document.getElementById('vtSimulacion') || {}).innerText || '',
    s: _ventasImportPendiente && _ventasImportPendiente.simulacion,
    escrituras: window.__escrituras.length,
    filas: document.querySelectorAll('#vtSimulacion .vt-sim__tabla tbody tr').length
  }));
  chk('★ Simular NO escribe nada (ningún guardado, ventas en memoria intactas)',
      sim.escrituras === 0 && antesVentas === await p.evaluate(() => JSON.stringify(ventas)), String(sim.escrituras));
  chk('★ Efecto: ventas posteriores al corte → "bajan el Total"', sim.s && sim.s.efecto === 'baja_total' && /bajan el Total/.test(sim.txt), sim.s && sim.s.efecto);
  // Tequila: Total 0.7 − 20×0.06 = −0.5 → faltante 0.5 × $350 = $175. Limón: respaldo 4 − 0.6 → alcanza. Ginebra: 5 − 0.6 → alcanza.
  const teq = sim.s && sim.s.noAlcanzan.find(x => x.productoId === 'TEQ');
  chk('★ Señala el insumo que el Total no cubre: tequila, faltante 0.5, costo $175',
      sim.s && sim.s.totalNoAlcanzan === 1 && teq && teq.faltante === 0.5 && teq.costoFaltante === 175, JSON.stringify(sim.s && sim.s.noAlcanzan));
  chk('La tabla "Insumos que el Total no cubre" tiene una fila y muestra el costo en pesos',
      sim.filas === 1 && /\$175\.00/.test(sim.txt), sim.txt.slice(0, 600));
  chk('Avisa el producto vendido sin receta (no se descuenta de nada)', /1 producto\(s\) sin receta/.test(sim.txt) && /TE GOURMET/.test(sim.txt));
  chk('Marca el insumo que usa el respaldo (limón, no entró al corte)', sim.s && sim.s.enRespaldo === 1 && /respaldo/.test(sim.txt));

  const ovf = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  chk('Sin desborde horizontal a 390 px con la simulación abierta', ovf);

  // Contraste de los textos nuevos (oscuro y claro)
  for (const tema of ['dark', 'light']) {
    await p.evaluate(t => { document.documentElement.setAttribute('data-theme', t); renderTab(); }, tema);
    await p.waitForTimeout(150);
    const peor = await p.evaluate(() => {
      const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
      const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
      const fondo = el => { const ch = []; for (let e = el; e; e = e.parentElement) ch.push(e); let base = [255, 255, 255];
        for (let i = ch.length - 1; i >= 0; i--) { const c = rgb(getComputedStyle(ch[i]).backgroundColor); if (c.length < 3) continue; const a = c.length === 4 ? c[3] : 1; if (a > 0) base = [0, 1, 2].map(k => c[k] * a + base[k] * (1 - a)); } return base; };
      let min = 99, cual = '';
      document.querySelectorAll('#vtSimulacion *').forEach(el => {
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
        const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const fg = rgb(cs.color); const bg = fondo(el); const a = fg.length === 4 ? fg[3] : 1;
        const f3 = fg.slice(0, 3).map((v, k) => v * a + bg[k] * (1 - a));
        const L1 = lum(f3), L2 = lum(bg); const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
        if (ratio < min) { min = ratio; cual = el.tagName + '.' + (el.className || '') + ' "' + el.textContent.trim().slice(0, 30) + '"'; }
      });
      return { min: Math.round(min * 100) / 100, cual };
    });
    chk('[' + tema + '] contraste del panel de simulación ≥ 4.5:1', peor.min >= 4.5, JSON.stringify(peor));
  }
  await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); renderTab(); });

  // ── 4 · PROCESAR: confirma con el resumen y guarda ─────────────────────
  await p.evaluate(() => { window.__msg = null; showConfirm = (msg, cb) => { window.__msg = msg; window.__cb = cb; }; });
  await p.click('#ventasBtnConfirmar'); await p.waitForTimeout(150);
  const conf = await p.evaluate(() => ({ msg: window.__msg, escrituras: window.__escrituras.length }));
  chk('★ Procesar pide confirmación con el resumen (insumos, no alcanzan, desviación) ANTES de escribir',
      conf.escrituras === 0 && /PROCESAR VENTA/.test(conf.msg || '') && /1 insumo\(s\) no alcanzan · desviación \$175\.00/.test(conf.msg || ''), conf.msg);
  await p.evaluate(async () => { await window.__cb(); }); await p.waitForTimeout(300);
  const fin = await p.evaluate(() => ({ escrituras: window.__escrituras, txt: document.getElementById('tabContent').innerText,
                                       res: _ventasImportResultado }));
  chk('★ Al confirmar, se guarda el periodo una sola vez (es lo que baja el Total)',
      fin.escrituras.length === 1 && fin.escrituras[0].periodo.inicio === esc.ayer && fin.escrituras[0].n === 3, JSON.stringify(fin.escrituras));
  chk('La pantalla de resultado dice "Inventario descontado" y repite la desviación',
      /Inventario descontado/.test(fin.txt) && /\$175\.00/.test(fin.txt), fin.txt.slice(0, 500));
  chk('Procesar no tocó stockByArea (el conteo por área sigue igual)',
      await p.evaluate(() => products[0].stockByArea.almacen === 0 && products[1].stockByArea.almacen === 4));

  // ── 5 · Un periodo que cruza el corte no se deja procesar ──────────────
  await p.evaluate((esc) => {
    _existenciaInicial = { semana: semanaId(new Date()), estado: 'ok', saldos: { TEQ: 1 }, origen: {},
                           ancla: { tipo: 'mitad_de_semana', fecha: esc.corte, id: esc.corte, ruta: 'arrastre', dias: 3 } };
    const d = parseFechaLocal(esc.corte); const antes = fechaISOLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
    const despues = fechaISOLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
    _ventasImportPendiente = { lineas: [{ sku: 'PV1', nombre: 'MARGARITA', cantidad: 1, ventaNeta: 1 }], incidencias: [], skusAgrupados: [],
      filasIgnoradas: 0, totalUnidades: 1, excedeTope: false, periodo: { inicio: antes, fin: despues },
      existentes: { semanaId: semanaId(antes), estado: 'ok', periodos: [] } };
    // Solo tiene sentido si antes y después caen en la misma semana; si no, la regla de semana ya lo bloquea.
    ventasImportView = 'vista_previa'; renderTab();
  }, esc);
  await p.waitForTimeout(150);
  const cruza = await p.evaluate(() => ({ txt: document.getElementById('tabContent').innerText, dis: document.getElementById('ventasBtnConfirmar').disabled }));
  chk('★ Un periodo que cruza la fecha del corte se bloquea (o lo bloquea la regla de semana)',
      cruza.dis && (/cruza la fecha del último corte/.test(cruza.txt) || /cruza de semana/.test(cruza.txt)), cruza.txt.slice(0, 500));

  // ── 6 · Conteo: un recuento de mitad de semana se contabiliza como ancla ─
  // El día pasado más reciente que no sea domingo ni fin de mes (mitad de semana).
  const paso = await p.evaluate(() => {
    let d = new Date(); d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || esUltimoDiaDelMes(d)) d.setDate(d.getDate() - 1);
    const f = fechaISOLocal(d);
    return _renderSiguientePasoInventario({ estado: 'CERRADO', semanaId: semanaId(f), fechaRecuento: f, numero: 1010 });
  });
  chk('★ Un inventario cerrado a mitad de semana ofrece "Contabilizar como ancla del Total"',
      /Contabilizar como ancla del Total/.test(paso) && /punto de partida \(ancla\) del Total/.test(paso), paso.replace(/<[^>]+>/g, ' ').slice(0, 400));
  const futuro = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); const f = fechaISOLocal(d);
    return _renderSiguientePasoInventario({ estado: 'CERRADO', semanaId: semanaId(f), fechaRecuento: f, numero: 1011 }); });
  chk('…pero uno fechado en el futuro no, y dice por qué', /futuro/.test(futuro) && !/data-inv-accion="contabilizar"/.test(futuro), futuro.replace(/<[^>]+>/g, ' ').slice(0, 300));

  // ── 7 · Nuevo inventario con fecha de mitad de semana: permitido ───────
  const nuevo = await p.evaluate((esc) => {
    const f = document.getElementById('nuevoInvFecha'); const btn = document.getElementById('nuevoInvBtnCrear');
    if (!f || !btn) return null;
    const d = parseFechaLocal(esc.hoy); let x = d;
    while (x.getDay() === 0 || esUltimoDiaDelMes(x)) x = new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1);
    f.value = fechaISOLocal(x); _pintarAvisoFechaNuevoInv();
    return { txt: document.getElementById('nuevoInvAvisoFecha').textContent, dis: btn.disabled };
  }, esc);
  chk('Crear un inventario a mitad de semana ya no se bloquea: aviso de que será ancla del Total',
      nuevo && !nuevo.dis && /Recuento de mitad de semana/.test(nuevo.txt), JSON.stringify(nuevo));

  chk('Sin errores de JavaScript en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();
  let mal = 0; C.forEach(c => { if (!c.ok) mal++; console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  →  ' + c.d)); });
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron');
  process.exit(mal ? 1 : 0);
})();
