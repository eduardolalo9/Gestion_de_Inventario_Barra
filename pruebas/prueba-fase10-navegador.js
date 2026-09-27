// FASE 10 — importador de ventas del POS, en Chromium contra la app real.
// Igual que prueba-p2-navegador.js y la de Recetario-2, se llama a
// _parsearExcelVentas(filas) con filas simuladas en vez de subir un .xlsx:
// evita depender de cdnjs (SheetJS) y prueba el mismo código de producción.
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
    ventas = []; ventasSemanaId = null; ventasImportView = 'lista';
    activeTab = 'ventas'; updateHeaderActions(); renderTab();
  });
  await p.waitForTimeout(150);

  chk('Con sales.import el header ofrece "Importar ventas"',
      await p.evaluate(() => !!document.querySelector('[onclick="ventasImportarExcel()"]')), '');
  chk('Sin ventas cargadas, la pestaña lo dice',
      /Todavía no hay ventas cargadas/.test(await p.evaluate(() => document.getElementById('tabContent').innerText)), '');

  // ── Filas simuladas: columnas reales de la hoja "Venta" del POS ─────────
  const FILAS = () => ([
    { Nombre: '1800 Anejo Copa', 'Tipo de artículo': 'Bebidas', Tipo: 'Artículo', Cantidad: 12, 'Venta neta': 2496, SKU: 'PVB1000002' },
    { Nombre: 'Rib Eye Mochomos', 'Tipo de artículo': 'Alimentos', Tipo: 'Artículo', Cantidad: 35, 'Venta neta': 28687.94, SKU: 'PVA1001169' },
    // Mismo SKU en dos filas (variante promo 2x1): el Excel las SUMA
    { Nombre: 'St Germain Sprit', 'Tipo de artículo': 'Bebidas', Tipo: 'Artículo', Cantidad: 13, 'Venta neta': 2600, SKU: 'PVB1001270' },
    { Nombre: 'St Germain Spritz promo 2x1', 'Tipo de artículo': 'Bebidas', Tipo: 'Artículo', Cantidad: 3, 'Venta neta': 0, SKU: 'PVB1001270' },
    // Cantidad no numérica: incidencia, línea omitida
    { Nombre: 'Bebida rara', 'Tipo de artículo': 'Bebidas', Tipo: 'Artículo', Cantidad: 'x', 'Venta neta': 0, SKU: 'PVB9999999' },
    // Fila con cantidad pero sin SKU: incidencia
    { Nombre: 'Sin sku', 'Tipo de artículo': 'Bebidas', Tipo: 'Artículo', Cantidad: 4, 'Venta neta': 100, SKU: null },
    // La nota al pie del reporte real: se descarta sin incidencia
    { Nombre: 'Nota: Esta tabla no toma en cuenta los descuentos de orden. ', 'Tipo de artículo': null, Tipo: null, Cantidad: null, 'Venta neta': null, SKU: null }
  ]);

  const parsed = await p.evaluate((filas) => _parsearExcelVentas(filas), FILAS());
  chk('Agrupa 3 SKU válidos (bebida, alimento y la promo sumada)', parsed.lineas.length === 3, JSON.stringify(parsed.lineas.map(l => l.sku)));
  const stGermain = parsed.lineas.find(l => l.sku === 'PVB1001270');
  chk('★ Un SKU repetido en dos filas se SUMA (13 + 3 = 16), nunca "el último gana"', stGermain && stGermain.cantidad === 16, JSON.stringify(stGermain));
  chk('…y se reporta que ese SKU venía en varias filas', parsed.skusAgrupados.length === 1 && parsed.skusAgrupados[0].sku === 'PVB1001270', JSON.stringify(parsed.skusAgrupados));
  chk('★ NO se filtran los alimentos: un platillo puede consumir inventario de barra', parsed.lineas.some(l => l.sku === 'PVA1001169'), '');
  chk('La nota al pie del reporte se descarta sin incidencia', parsed.filasIgnoradas === 1, String(parsed.filasIgnoradas));
  chk('Cantidad no numérica genera incidencia y omite la línea', parsed.incidencias.some(i => i.tipo === 'cantidad_invalida') && !parsed.lineas.some(l => l.sku === 'PVB9999999'), JSON.stringify(parsed.incidencias));
  chk('Fila con cantidad pero sin SKU genera incidencia', parsed.incidencias.some(i => i.tipo === 'sin_sku'), '');
  chk('El total de unidades suma bien (12 + 35 + 16 = 63)', parsed.totalUnidades === 63, String(parsed.totalUnidades));

  // ── La semana propuesta sale del inventario abierto ─────────────────────
  const semanaConInv = await p.evaluate(() => {
    _inventarioActivo = { numero: 40, estado: 'abierto', fechaRecuento: '2026-09-27' }; // domingo
    return semanaVentasPorDefecto();
  });
  chk('★ La semana propuesta es la del inventario abierto (domingo 27 → lunes 21)', semanaConInv === '2026-09-21', semanaConInv);
  const semanaSinInv = await p.evaluate(() => { _inventarioActivo = null; return semanaVentasPorDefecto(); });
  chk('Sin inventario abierto, propone la semana en curso (no revienta)', /^\d{4}-\d{2}-\d{2}$/.test(semanaSinInv), semanaSinInv);

  // ── Vista previa ────────────────────────────────────────────────────────
  await p.evaluate((parsed) => {
    _inventarioActivo = { numero: 40, estado: 'abierto', fechaRecuento: '2026-09-27' };
    parsed.semanaDestino = semanaVentasPorDefecto();
    parsed.yaExistia = 0;
    _ventasImportPendiente = parsed; ventasImportView = 'vista_previa'; renderTab();
  }, parsed);
  await p.waitForTimeout(120);
  let previa = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('La vista previa muestra SKU, unidades y la semana propuesta',
      /3 SKU/.test(previa) && /63/.test(previa) && /2026-09-21/.test(previa), previa.slice(0, 300));
  chk('La vista previa avisa de los SKU que se sumaron', /se sumaron/.test(previa), '');
  chk('La vista previa deja cambiar la semana antes de confirmar',
      await p.evaluate(() => !!document.getElementById('ventasSemanaInput')), '');

  // Cambiar la semana a mano
  await p.evaluate(() => _ventasCambiarSemana('2026-09-14'));
  await p.waitForTimeout(120);
  chk('Cambiar la fecha reasigna la semana (se normaliza al lunes)',
      await p.evaluate(() => _ventasImportPendiente.semanaDestino === '2026-09-14'),
      await p.evaluate(() => _ventasImportPendiente.semanaDestino));
  await p.evaluate(() => _ventasCambiarSemana('2026-09-27'));
  await p.waitForTimeout(120);

  // Aviso de reemplazo
  await p.evaluate(() => { _ventasImportPendiente.yaExistia = 7; renderTab(); });
  await p.waitForTimeout(100);
  previa = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('★ Si la semana ya tenía ventas, avisa que se reemplazan ANTES de confirmar',
      /ya tenía 7 SKU cargados/.test(previa), previa.slice(0, 400));

  // ── Confirmar (sin Firestore: guardarVentasSemana falla y se reporta) ───
  await p.evaluate(() => { _db = null; });
  await p.evaluate(() => confirmarImportacionVentas());
  await p.waitForTimeout(200);
  chk('★ Sin conexión, la importación NO miente: lo reporta como no guardado',
      await p.evaluate(() => _ventasImportResultado && _ventasImportResultado.guardado === false), '');
  chk('…y la pantalla de resultado explica el motivo',
      /No se guardó/.test(await p.evaluate(() => document.getElementById('tabContent').innerText)), '');
  await p.evaluate(() => cerrarResultadoImportacionVentas());

  // ── Lista con ventas cargadas ───────────────────────────────────────────
  await p.evaluate((lineas) => {
    ventas = lineas; ventasSemanaId = '2026-09-21'; ventasImportView = 'lista'; renderTab();
  }, parsed.lineas);
  await p.waitForTimeout(120);
  const lista = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('La lista muestra la semana, el total y los SKU ordenados por cantidad',
      /2026-09-21/.test(lista) && /3.*SKU/.test(lista) && /Rib Eye Mochomos/.test(lista), lista.slice(0, 300));
  chk('La lista dice que el cruce con el recetario llega después (no promete lo que no hace)',
      /siguiente fase/.test(lista), '');

  // ── Permisos ────────────────────────────────────────────────────────────
  await p.evaluate(() => { _authzState.permissions = new Set(['sales.read']); updateHeaderActions(); renderTab(); });
  await p.waitForTimeout(100);
  chk('Sin sales.import el header dice "Solo lectura" y no ofrece importar',
      await p.evaluate(() => !document.querySelector('[onclick="ventasImportarExcel()"]') &&
          /Solo lectura/.test(document.getElementById('headerActions').innerText)), '');
  chk('Con sales.read la lista sí se ve', /Rib Eye Mochomos/.test(await p.evaluate(() => document.getElementById('tabContent').innerText)), '');

  await p.evaluate(() => { _authzState.permissions = new Set([]); renderTab(); });
  await p.waitForTimeout(100);
  chk('Sin sales.read, la pestaña muestra el candado',
      /No tienes acceso a las ventas/.test(await p.evaluate(() => document.getElementById('tabContent').innerText)), '');

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── FASE 10 · ventas del POS (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
