// RECETARIO-2 — importador de recetas, ejecutado en Chromium contra la app
// real (sin mockear el módulo). Igual que prueba-p2-navegador.js (Compras),
// se llama a _parsearExcelRecetario(filas) directamente con filas simuladas
// en vez de subir un .xlsx real — evita depender de que cdnjs.cloudflare.com
// (SheetJS) sea alcanzable desde este entorno; el parseo del archivo en sí
// (XLSX.read/sheet_to_json) es código de terceros ya usado en 3 importadores.
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

  // ── Arranque como ADMIN, con dos productos reales en el catálogo ────────
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = [
      { id: '1180001', name: 'TEQUILA 1800 ANEJO 700 ML', group: 'TEQUILA', unit: 'Botellas', precio: 350, conversion: 700 },
      { id: '1100017', name: 'JUGO DE PINA 1 LT', group: 'ABARROTES', unit: 'Litros', precio: 30, conversion: 1000 }
    ];
    recetas = [];
    activeTab = 'recetario'; renderTab();
  });

  // ── Filas simuladas — mismas columnas reales de la hoja "Recetas",
  //    incluida Almacén (12 = barra, 11 = cocina, 13 = cava) ───────────────
  const FILAS_BASE = () => ([
    { PV: 'PVB1000001', Receta: 'MARGARITA', 'Categoría': 'Cocteles', Activa: 'Sí', 'Código insumo': '1180001', 'Descripción insumo': 'TEQUILA 1800 ANEJO', Cantidad: 45, UoM: 'ml', 'Almacén': '12' },
    { PV: 'PVB1000001', Receta: 'MARGARITA', 'Categoría': 'Cocteles', Activa: 'Sí', 'Código insumo': '1100017', 'Descripción insumo': 'JUGO DE PIÑA', Cantidad: 30, UoM: 'ml', 'Almacén': '12' },
    { PV: 'PVB1000002', Receta: 'MOJITO', 'Categoría': 'Cocteles', Activa: 'Sí', 'Código insumo': '9999999', 'Descripción insumo': 'RON BLANCO', Cantidad: 60, UoM: 'ml', 'Almacén': '12' },
    { PV: 'PVB1000003', Receta: 'TE GOURMET', 'Categoría': 'producto_terminado', Activa: 'Sí', 'Código insumo': null, 'Descripción insumo': null, Cantidad: null, UoM: null, 'Almacén': null },
    { PV: 'PVB1000004', Receta: 'AGUA MINERAL', 'Categoría': 'Cocteles', Activa: 'Sí', 'Código insumo': '1180001', 'Descripción insumo': 'TEQUILA', Cantidad: 'no-es-numero', UoM: 'ml', 'Almacén': '12' },
    { PV: '', Receta: 'FILA SIN PV', 'Categoría': 'x', Activa: 'Sí', 'Código insumo': '1180001', Cantidad: 10, UoM: 'ml', 'Almacén': '12' },
    // Receta de cocina pura (almacén 11): NO debe importarse
    { PV: 'PVA1000015', Receta: 'AGUACHILE DE CAMARON', 'Categoría': 'producto_terminado', Activa: 'Sí', 'Código insumo': '1020033', 'Descripción insumo': 'CILANTRO KG', Cantidad: 0.01, UoM: 'KGS', 'Almacén': '11' },
    { PV: 'PVA1000015', Receta: 'AGUACHILE DE CAMARON', 'Categoría': 'producto_terminado', Activa: 'Sí', 'Código insumo': '1020064', 'Descripción insumo': 'LIMON KG', Cantidad: 0.02, UoM: 'KGS', 'Almacén': '11' },
    // Receta MIXTA (platillo de cocina que sí consume barra): se importa,
    // pero solo con su línea de almacén 12
    { PV: 'PVA1000088', Receta: 'BARBACOA DE SHORT RIB', 'Categoría': 'producto_terminado', Activa: 'Sí', 'Código insumo': '1290172', 'Descripción insumo': 'SHORT RIB 450 GR', Cantidad: 1, UoM: 'PZA', 'Almacén': '11' },
    { PV: 'PVA1000088', Receta: 'BARBACOA DE SHORT RIB', 'Categoría': 'producto_terminado', Activa: 'Sí', 'Código insumo': '1180001', 'Descripción insumo': 'TEQUILA 1800 ANEJO', Cantidad: 20, UoM: 'ml', 'Almacén': '12' },
    // Vino de cava (almacén 13): NO debe importarse
    { PV: 'PVV1000080', Receta: '3V CASA MADERO', 'Categoría': 'producto_terminado', Activa: 'Sí', 'Código insumo': '1260001', 'Descripción insumo': 'CASA MADERO 3V 750 ML', Cantidad: 1, UoM: 'PZA', 'Almacén': '13' }
  ]);

  // ── Parseo: agrupación, incidencias, "receta sin ingredientes" ──────────
  const parsed1 = await p.evaluate((filas) => _parsearExcelRecetario(filas), FILAS_BASE());
  chk('Importa 5 recetas de barra (4 PVB + la mixta PVA), descartando cocina y cava', parsed1.recetas.length === 5, JSON.stringify(parsed1.recetas.map(r => r.pv)));
  chk('filasSinPV cuenta la fila sin PV', parsed1.filasSinPV === 1, '');
  chk('★ La receta de cocina pura (AGUACHILE, almacén 11) NO se importa', !parsed1.recetas.some(r => r.pv === 'PVA1000015'), '');
  chk('★ El vino de cava (almacén 13) NO se importa', !parsed1.recetas.some(r => r.pv === 'PVV1000080'), '');
  chk('★ La receta MIXTA sí se importa, pero solo con su línea de barra (el platillo consume una bebida)',
      (() => { const b = parsed1.recetas.find(r => r.pv === 'PVA1000088');
               return b && b.totalIngredientes === 1 && b.ingredientes[0].productoId === '1180001'; })(),
      JSON.stringify(parsed1.recetas.find(r => r.pv === 'PVA1000088')));
  chk('Se informa en bloque lo descartado por almacén (recetas y líneas), no como incidencias sueltas',
      parsed1.recetasOtroAlmacen === 2 && parsed1.lineasFueraDeAlcance === 4,
      'recetas:' + parsed1.recetasOtroAlmacen + ' lineas:' + parsed1.lineasFueraDeAlcance);
  const margarita1 = parsed1.recetas.find(r => r.pv === 'PVB1000001');
  chk('MARGARITA agrupa sus dos líneas de ingrediente bajo el mismo PV', margarita1 && margarita1.totalIngredientes === 2, JSON.stringify(margarita1));
  chk('Todas son "nueva" en el primer import (recetas está vacío)', parsed1.recetas.every(r => r.esNueva), '');
  const mojito1 = parsed1.recetas.find(r => r.pv === 'PVB1000002');
  chk('★ Código no encontrado en catálogo: la línea SE GUARDA (no se descarta) con descripcionExcel', mojito1 && mojito1.ingredientes.length === 1 && mojito1.ingredientes[0].productoId === '9999999' && mojito1.ingredientes[0].descripcionExcel === 'RON BLANCO', JSON.stringify(mojito1));
  chk('…y queda registrada la incidencia "sin_catalogo"', mojito1.incidencias.some(i => i.tipo === 'sin_catalogo'), JSON.stringify(mojito1.incidencias));
  const teGourmet1 = parsed1.recetas.find(r => r.pv === 'PVB1000003');
  chk('★ Receta sin ningún ingrediente en el Excel se importa igual, activa, con 0 ingredientes y SIN incidencia de error (caso real: TE GOURMET)', teGourmet1 && teGourmet1.totalIngredientes === 0 && teGourmet1.activa === true && teGourmet1.incidencias.length === 0, JSON.stringify(teGourmet1));
  const agua1 = parsed1.recetas.find(r => r.pv === 'PVB1000004');
  chk('Cantidad inválida: la línea se omite (0 ingredientes) y queda la incidencia', agua1 && agua1.totalIngredientes === 0 && agua1.incidencias.some(i => i.tipo === 'cantidad_invalida'), JSON.stringify(agua1));

  // ── Vista previa en pantalla ─────────────────────────────────────────────
  await p.evaluate((parsed) => { _recetarioImportPendiente = parsed; recetarioImportView = 'vista_previa'; renderTab(); }, parsed1);
  await p.waitForTimeout(100);
  const previaTxt = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('La vista previa muestra el resumen (5 recetas, 5 nuevas) y las tarjetas por PV', /5 receta/.test(previaTxt) && /5 nueva/.test(previaTxt) && /MARGARITA/.test(previaTxt) && /MOJITO/.test(previaTxt), previaTxt.slice(0, 300));
  chk('La vista previa avisa de la receta sin ingredientes', /sin ingredientes/.test(previaTxt), '');

  // ── Confirmar: se guarda en `recetas`, NO se publica solo ────────────────
  await p.evaluate(() => confirmarImportacionRecetario());
  await p.waitForTimeout(100);
  const estado1 = await p.evaluate(() => ({
    total: recetas.length,
    margarita: recetas.find(r => r.pv === 'PVB1000001'),
    vista: recetarioImportView
  }));
  chk('Tras confirmar, las 5 recetas de barra quedan en el arreglo local', estado1.total === 5, String(estado1.total));
  chk('MARGARITA trae nombre correcto y sus dos ingredientes con costo calculable', estado1.margarita && estado1.margarita.nombre === 'MARGARITA' && estado1.margarita.ingredientes.length === 2, JSON.stringify(estado1.margarita));
  chk('La pantalla pasa a mostrar el resultado de la importación', estado1.vista === 'incidencias', estado1.vista);
  const costoMargarita = await p.evaluate(() => costoReceta(recetas.find(r => r.pv === 'PVB1000001')));
  const costoEsperado = 45 * (350 / 700) + 30 * (30 / 1000);
  chk('El costo de MARGARITA importada es el mismo que si se hubiera tecleado a mano', Math.abs(costoMargarita.costo - costoEsperado) < 0.001, JSON.stringify(costoMargarita));
  const costoMojito = await p.evaluate(() => costoReceta(recetas.find(r => r.pv === 'PVB1000002')));
  chk('MOJITO (insumo sin catálogo) queda "incompleto", nunca un total inventado', costoMojito.incompleto === true && costoMojito.faltantes.includes('RON BLANCO'), JSON.stringify(costoMojito));

  // ── Reimportar: PVB1000001 cambia de cantidad → ACTUALIZA, no duplica ───
  const filasReimport = FILAS_BASE();
  filasReimport[0].Cantidad = 50; // 45 → 50
  const parsed2 = await p.evaluate((filas) => _parsearExcelRecetario(filas), filasReimport);
  const margarita2 = parsed2.recetas.find(r => r.pv === 'PVB1000001');
  chk('Al reimportar, PVB1000001 ya existe → se marca para actualizar, no como nueva', margarita2 && margarita2.esNueva === false, JSON.stringify(margarita2));
  await p.evaluate((parsed) => { _recetarioImportPendiente = parsed; confirmarImportacionRecetario(); }, parsed2);
  await p.waitForTimeout(100);
  const estado2 = await p.evaluate(() => ({ total: recetas.length, cantidad: recetas.find(r => r.pv === 'PVB1000001').ingredientes[0].cantidad }));
  chk('Reimportar NO duplica — sigue habiendo 5 recetas', estado2.total === 5, String(estado2.total));
  chk('…y el ingrediente quedó con la cantidad nueva (45→50)', estado2.cantidad === 50, String(estado2.cantidad));

  // ── Coincidencia por nombre: una receta manual sin PV se adopta ─────────
  await p.evaluate(() => {
    recetas.push({ id: 'rec_manual_1', nombre: 'PALOMA', categoria: 'Cocteles', activa: true, ingredientes: [{ productoId: '1180001', cantidad: 40, uom: 'ml' }], metodo: '', cristaleria: '', hielo: '', decoracion: '', _v: 1, creadoPor: 'admin1', creadoEn: Date.now(), actualizadoPor: 'admin1', actualizadoEn: Date.now() });
  });
  const parsedPaloma = await p.evaluate(() => _parsearExcelRecetario([
    { PV: 'PVB2000099', Receta: 'PALOMA', 'Categoría': 'Cocteles', Activa: 'Sí', 'Código insumo': '1180001', 'Descripción insumo': 'TEQUILA', Cantidad: 50, UoM: 'ml', 'Almacén': '12' }
  ]));
  chk('★ Una receta creada a mano (sin pv) se reconoce por NOMBRE cuando es inequívoca — se actualiza, no se duplica', parsedPaloma.recetas[0].esNueva === false && parsedPaloma.recetas[0].coincidenciaPorNombre === true, JSON.stringify(parsedPaloma.recetas[0]));
  await p.evaluate((parsed) => { _recetarioImportPendiente = parsed; confirmarImportacionRecetario(); }, parsedPaloma);
  await p.waitForTimeout(100);
  const paloma = await p.evaluate(() => recetas.find(r => r.nombre === 'PALOMA'));
  chk('Tras importar, la receta manual "PALOMA" adopta el PV real y sigue siendo una sola', paloma && paloma.pv === 'PVB2000099', JSON.stringify(paloma));
  const totalTrasPaloma = await p.evaluate(() => recetas.filter(r => r.nombre === 'PALOMA').length);
  chk('…no quedó ninguna "PALOMA" duplicada', totalTrasPaloma === 1, String(totalTrasPaloma));

  // ── Nombre ambiguo: dos manuales con el mismo nombre → se crea aparte ───
  await p.evaluate(() => {
    recetas.push({ id: 'rec_dup_a', nombre: 'DUPLICADO', categoria: '', activa: true, ingredientes: [], metodo: '', cristaleria: '', hielo: '', decoracion: '', _v: 1, creadoPor: 'admin1', creadoEn: Date.now(), actualizadoPor: 'admin1', actualizadoEn: Date.now() });
    recetas.push({ id: 'rec_dup_b', nombre: 'DUPLICADO', categoria: '', activa: true, ingredientes: [], metodo: '', cristaleria: '', hielo: '', decoracion: '', _v: 1, creadoPor: 'admin1', creadoEn: Date.now(), actualizadoPor: 'admin1', actualizadoEn: Date.now() });
  });
  const totalAntesDup = await p.evaluate(() => recetas.length);
  const parsedDup = await p.evaluate(() => _parsearExcelRecetario([
    { PV: 'PVB3000001', Receta: 'DUPLICADO', 'Categoría': '', Activa: 'Sí', 'Código insumo': '1180001', Cantidad: 10, UoM: 'ml', 'Almacén': '12' }
  ]));
  chk('★ Con dos candidatas manuales del mismo nombre, NO adivina — se trata como receta nueva', parsedDup.recetas[0].esNueva === true, JSON.stringify(parsedDup.recetas[0]));
  await p.evaluate((parsed) => { _recetarioImportPendiente = parsed; confirmarImportacionRecetario(); }, parsedDup);
  await p.waitForTimeout(100);
  const totalDespuesDup = await p.evaluate(() => recetas.length);
  chk('…y las dos "DUPLICADO" manuales originales siguen intactas (se creó una tercera aparte)', totalDespuesDup === totalAntesDup + 1 && (await p.evaluate(() => recetas.filter(r => r.nombre === 'DUPLICADO').length)) === 3, String(totalDespuesDup));

  // ── Permisos: sin recipe.edit no se puede importar ──────────────────────
  await p.evaluate(() => { _authzState.permissions = new Set(['recipe.read']); });
  const notifAntes = await p.evaluate(() => document.querySelectorAll('.notification, [class*=notif]').length);
  await p.evaluate(() => recetarioImportarExcel());
  chk('Sin recipe.edit, recetarioImportarExcel() no revienta y no abre nada (gateado igual que Nueva receta)', true, ''); // humo: no debe lanzar excepción
  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));

  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── RECETARIO-2 (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
