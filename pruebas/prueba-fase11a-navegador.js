// FASE 11A — costeo por unidad y consumo teórico, en Chromium contra la app real.
// Los números de este archivo salen del Excel real de Eduardo: una copa de
// 1800 Añejo es 0.06 PZA de una botella de 700 ml que cuesta $350.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
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
  chk('La página carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = [
      { id: '1180001', name: '1800 ANIEJO 700 ML', group: 'TEQUILA', unit: 'PZA', precio: 350, conversion: 700 },
      { id: '1100017', name: 'JUGO DE PINA 1 LT', group: 'ABARROTES', unit: 'LTS', precio: 30, conversion: 1000 },
      { id: '1020064', name: 'LIMON AMARILLO KG', group: 'FRUTA', unit: 'KGS', precio: 40 }
    ];
    recetas = []; ventas = []; ventasSemanaId = null;
    if (typeof consumoTeoricoInvalidar === 'function') consumoTeoricoInvalidar();
  });

  // ── Costeo por unidad: el caso real que estaba mal ──────────────────────
  const costos = await p.evaluate(() => {
    const prodTequila = products.find(x => x.id === '1180001');
    return {
      // 0.06 PZA de una botella de $350 → $21.00 (antes daba $0.03)
      copaPza: costoLineaReceta({ productoId: '1180001', cantidad: 0.06, uom: 'PZA' }, prodTequila),
      // 45 ml de esa misma botella (receta tecleada a mano) → 45 × 350/700 = $22.50
      copaMl:  costoLineaReceta({ productoId: '1180001', cantidad: 45, uom: 'ml' }, prodTequila),
      // 1.5 oz = 44.36 ml → $22.18
      copaOz:  costoLineaReceta({ productoId: '1180001', cantidad: 1.5, uom: 'oz' }, prodTequila),
      // Sin UoM declarada se asume la unidad del producto (como el Excel)
      sinUom:  costoLineaReceta({ productoId: '1180001', cantidad: 0.06, uom: '' }, prodTequila),
      // Un kilo de limón: la unidad del producto es KGS → 0.02 × 40 = $0.80
      limon:   costoLineaReceta({ productoId: '1020064', cantidad: 0.02, uom: 'KGS' }, products.find(x => x.id === '1020064')),
      // Una unidad que no se sabe interpretar (y sin conversión) → null
      rara:    costoLineaReceta({ productoId: '1020064', cantidad: 1, uom: 'cucharadita' }, products.find(x => x.id === '1020064')),
      factorPza: factorAUnidadProducto('PZA', prodTequila),
      factorMl:  factorAUnidadProducto('ml', prodTequila)
    };
  });
  chk('★ Una copa de 0.06 PZA de una botella de $350 cuesta $21.00 (antes daba $0.03)',
      Math.abs(costos.copaPza - 21) < 0.001, String(costos.copaPza));
  chk('Una receta tecleada a mano en ml sigue costeándose igual que antes (45 ml → $22.50)',
      Math.abs(costos.copaMl - 22.5) < 0.001, String(costos.copaMl));
  chk('Las onzas se convierten con la conversión (1.5 oz → $22.18)',
      Math.abs(costos.copaOz - 22.18) < 0.02, String(costos.copaOz));
  chk('Sin UoM declarada se asume la unidad del insumo, como hace el Excel',
      Math.abs(costos.sinUom - 21) < 0.001, String(costos.sinUom));
  chk('Un insumo en KGS se costea por kilo (0.02 × $40 = $0.80)',
      Math.abs(costos.limon - 0.8) < 0.001, String(costos.limon));
  chk('★ Una unidad que no se sabe interpretar devuelve null — no se inventa un costo',
      costos.rara === null, String(costos.rara));
  chk('El factor de una UoM de stock es 1 y el de ml es 1/conversión',
      costos.factorPza === 1 && Math.abs(costos.factorMl - 1 / 700) < 1e-9, costos.factorPza + '/' + costos.factorMl);

  // ── Consumo teórico: el ejemplo verificado del Excel ────────────────────
  const r = await p.evaluate(() => {
    recetas = [
      { id: 'r1', pv: 'PVB1000006', nombre: '1800 ANEJO CRISTAL COPA', activa: true,
        ingredientes: [{ productoId: '1180001', cantidad: 0.06, uom: 'PZA' }] },
      { id: 'r2', pv: 'PVB1000099', nombre: 'PINA COLADA', activa: true,
        ingredientes: [{ productoId: '1180001', cantidad: 0.04, uom: 'PZA' },
                       { productoId: '1100017', cantidad: 0.15, uom: 'LTS' },
                       { productoId: '9999999', cantidad: 1, uom: 'PZA', descripcionExcel: 'CREMA DE COCO' }] }
    ];
    ventas = [
      { sku: 'PVB1000006', nombre: '1800 Anejo Cristal Copa', tipo: 'Bebidas', cantidad: 7,  ventaNeta: 2016 },
      { sku: 'PVB1000099', nombre: 'Pina Colada',             tipo: 'Bebidas', cantidad: 10, ventaNeta: 1800 },
      { sku: 'PVB7777777', nombre: 'Bebida nueva sin receta', tipo: 'Bebidas', cantidad: 5,  ventaNeta: 500 }
    ];
    ventasSemanaId = semanaId(new Date());
    consumoTeoricoInvalidar();
    return consumoTeorico();
  });
  chk('★ El ejemplo verificado del Excel: 7 copas × 0.06 = 0.42 botellas consumidas',
      Math.abs(r.consumo['1180001'] - (7 * 0.06 + 10 * 0.04)) < 0.001, JSON.stringify(r.consumo));
  chk('El consumo de un insumo se acumula entre recetas distintas (0.42 + 0.40 = 0.82)',
      Math.abs(r.consumo['1180001'] - 0.82) < 0.001, String(r.consumo['1180001']));
  chk('Cada insumo suma lo suyo (10 × 0.15 LTS = 1.5 de jugo)',
      Math.abs(r.consumo['1100017'] - 1.5) < 0.001, String(r.consumo['1100017']));
  chk('★ Un SKU vendido sin receta se reporta y NO se estima su consumo',
      r.avisos.sinReceta.length === 1 && r.avisos.sinReceta[0].sku === 'PVB7777777', JSON.stringify(r.avisos.sinReceta));
  chk('Un insumo de receta fuera del catálogo se reporta (pero su consumo se calcula igual)',
      r.avisos.sinCatalogo.length === 1 && r.consumo['9999999'] === 10, JSON.stringify(r.avisos.sinCatalogo));
  chk('El resultado dice de qué semana es y cuántas líneas aplicó',
      r.semana === await p.evaluate(() => semanaId(new Date())) && r.lineasCalculadas === 4, r.semana + '/' + r.lineasCalculadas);

  // ── El enchufe en la capa de existencia (FASE 8) ────────────────────────
  const ex = await p.evaluate(() => {
    const v = existenciaVentasSemana();
    return { ventas: v, tequila: v['1180001'] };
  });
  chk('★ existenciaVentasSemana() ya devuelve el consumo teórico, no {}',
      Math.abs(ex.tequila - 0.82) < 0.001, JSON.stringify(ex.ventas));

  const otraSemana = await p.evaluate(() => {
    ventasSemanaId = '2020-01-06';  // ventas de otra semana
    consumoTeoricoInvalidar();
    return existenciaVentasSemana();
  });
  chk('★ Ventas de OTRA semana no se restan a la existencia de esta (devuelve {})',
      Object.keys(otraSemana).length === 0, JSON.stringify(otraSemana));

  // ── Sin inicial contabilizado, la cifra oficial cae en la operativa ─────
  // Decisión de Eduardo (FASE 11B, 1-oct-2026): EXISTENCIA_FUENTE_OFICIAL_ACTIVA
  // ya quedó encendida por defecto. Esto NO cambia el resultado de esta
  // comprobación: sigue sin existir un inventariosIniciales/{semana} para este
  // producto, así que existenciaOficial() cae al mismo respaldo operativo de
  // siempre (origen 'operativo_no_reconciliado'). Lo que prueba este bloque es
  // justo esa red de seguridad, con la bandera en su valor real de hoy.
  const oficialApagada = await p.evaluate(() => {
    ventasSemanaId = semanaId(new Date()); consumoTeoricoInvalidar();
    const prod = products.find(x => x.id === '1180001');
    prod.stockByArea = { almacen: 10 };
    return { mostrada: existenciaMostrada(prod), operativa: existenciaOperativa(prod), bandera: EXISTENCIA_FUENTE_OFICIAL_ACTIVA };
  });
  chk('★ Sin inicial contabilizado, la app sigue mostrando la cifra operativa de siempre (aunque la fuente oficial ya esté encendida)',
      oficialApagada.mostrada === oficialApagada.operativa && oficialApagada.bandera === true,
      oficialApagada.mostrada + ' vs ' + oficialApagada.operativa + ' · bandera=' + oficialApagada.bandera);

  // ── Pantalla de verificación ────────────────────────────────────────────
  await p.evaluate(() => { activeTab = 'ventas'; ventasImportView = 'lista'; renderTab(); });
  await p.waitForTimeout(150);
  const pantalla = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('La pestaña Ventas muestra el consumo teórico con el insumo más consumido',
      /Consumo teórico/.test(pantalla) && /1800 ANIEJO/.test(pantalla), pantalla.slice(0, 300));
  chk('…avisa de los productos vendidos sin receta', /sin receta/.test(pantalla), '');
  chk('…avisa del insumo que no está en el catálogo', /no están en el catálogo/.test(pantalla), '');
  chk('★ Con la fuente oficial encendida (valor real de hoy), avisa que ya decide en cuanto haya inicial',
      /fuente oficial ya está encendida/.test(pantalla), pantalla.slice(0, 400));

  // ── Y con la bandera apagada, sigue mostrando el aviso original ─────────
  // (cubre la otra mitad del texto condicional de js/93-ventas.js sin
  // depender de cuál sea el default de hoy)
  await p.evaluate(() => { EXISTENCIA_FUENTE_OFICIAL_ACTIVA = false; renderTab(); });
  await p.waitForTimeout(150);
  const pantallaApagada = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('…y con la bandera apagada, dice claramente que la app todavía no decide con esa cifra',
      /todavía NO decide con esta cifra/.test(pantallaApagada), pantallaApagada.slice(0, 400));
  // La restauramos a su valor real de hoy: el resto de la prueba, y la app de
  // verdad, corren con la fuente oficial encendida.
  await p.evaluate(() => { EXISTENCIA_FUENTE_OFICIAL_ACTIVA = true; });

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── FASE 11A · consumo teórico (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
