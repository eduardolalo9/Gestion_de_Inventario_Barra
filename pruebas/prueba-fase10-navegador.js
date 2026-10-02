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

  // ── FASE 10B · la hoja se busca por nombre: "Detalle" (Parrot) ─────────
  const hojas = await p.evaluate(() => ({
    parrot:  _ventasElegirHoja(['Resumen', 'Detalle', 'Cargos']),
    formato: _ventasElegirHoja(['Pedidos tabla', 'inventario', 'Tabla', 'Venta', 'Recetas']),
    ninguna: _ventasElegirHoja(['Resumen', 'Cargos'])
  }));
  chk('★ 10B · Del reporte de Parrot (Resumen, Detalle, Cargos) se toma "Detalle"', hojas.parrot === 'Detalle', JSON.stringify(hojas));
  chk('El Formato de barra (hoja "Venta") se sigue aceptando', hojas.formato === 'Venta', JSON.stringify(hojas));
  chk('★ Sin "Detalle" ni "Venta" NO se cae a la primera hoja ("Resumen")', hojas.ninguna === null, JSON.stringify(hojas));

  // ── La semana propuesta sale del inventario abierto ─────────────────────
  const semanaConInv = await p.evaluate(() => {
    _inventarioActivo = { numero: 40, estado: 'abierto', fechaRecuento: '2026-09-27' }; // domingo
    return semanaVentasPorDefecto();
  });
  chk('★ La semana propuesta es la del inventario abierto (domingo 27 → lunes 21)', semanaConInv === '2026-09-21', semanaConInv);
  const semanaSinInv = await p.evaluate(() => { _inventarioActivo = null; return semanaVentasPorDefecto(); });
  chk('Sin inventario abierto, propone la semana en curso (no revienta)', /^\d{4}-\d{2}-\d{2}$/.test(semanaSinInv), semanaSinInv);

  // ── FASE 10B · periodo propuesto: lunes a domingo, nunca más allá de hoy ─
  const propuestos = await p.evaluate(() => {
    _inventarioActivo = { numero: 40, estado: 'abierto', fechaRecuento: '2026-09-27' };
    const pasada = periodoVentasPorDefecto('2026-09-30');
    _inventarioActivo = { numero: 41, estado: 'abierto', fechaRecuento: '2026-10-04' };
    const enCurso = periodoVentasPorDefecto('2026-09-30');
    _inventarioActivo = null;
    return { pasada, enCurso };
  });
  chk('Semana ya terminada: se propone del lunes 21 al domingo 27', propuestos.pasada.inicio === '2026-09-21' && propuestos.pasada.fin === '2026-09-27', JSON.stringify(propuestos.pasada));
  chk('★ Semana en curso: el fin propuesto es HOY, no el domingo que no ha llegado', propuestos.enCurso.inicio === '2026-09-28' && propuestos.enCurso.fin === '2026-09-30', JSON.stringify(propuestos.enCurso));

  // ── FASE 10B · la regla del periodo (función pura) ──────────────────────
  const v = await p.evaluate(() => {
    const H = '2026-09-30';
    const dia23 = [{ inicio: '2026-09-23', fin: '2026-09-23' }];
    const semanaLegada = [_ventasPeriodoDeDoc('2026-09-14', { semanaId: '2026-09-14', lineas: [] })];
    return {
      unDia:      validarPeriodoVentas('2026-09-23', '', [], H),
      rango:      validarPeriodoVentas('2026-09-21', '2026-09-27', [], H),
      cruza:      validarPeriodoVentas('2026-09-26', '2026-09-29', [], H),
      futuro:     validarPeriodoVentas('2026-09-28', '2026-10-02', [], H),
      alReves:    validarPeriodoVentas('2026-09-25', '2026-09-22', [], H),
      encimado:   validarPeriodoVentas('2026-09-21', '2026-09-27', dia23, H),
      mismoDia:   validarPeriodoVentas('2026-09-23', '2026-09-23', dia23, H),
      contiguo:   validarPeriodoVentas('2026-09-24', '2026-09-27', dia23, H),
      varios:     validarPeriodoVentas('2026-09-21', '2026-09-24', [{ inicio: '2026-09-22', fin: '2026-09-23' }], H),
      legado:     validarPeriodoVentas('2026-09-16', '2026-09-16', semanaLegada, H),
      incluyeHoy: validarPeriodoVentas('2026-09-28', '2026-09-30', [], H)
    };
  });
  chk('★ Un solo día: fin vacío = inicio, y se acepta', v.unDia.ok && v.unDia.fin === '2026-09-23' && v.unDia.dias.length === 1, JSON.stringify(v.unDia));
  chk('Un rango de lunes a domingo se acepta (7 días, semana del 21)', v.rango.ok && v.rango.dias.length === 7 && v.rango.semanaId === '2026-09-21', JSON.stringify(v.rango.errores));
  chk('★ Un rango que cruza de semana (sáb 26 → mar 29) se rechaza y dice por qué', !v.cruza.ok && /cruza de semana/.test(v.cruza.errores.join(' ')), JSON.stringify(v.cruza.errores));
  chk('★ Fechas futuras se rechazan (bloquearían días que aún no pasan)', !v.futuro.ok && /futuras/.test(v.futuro.errores.join(' ')), JSON.stringify(v.futuro.errores));
  chk('Fin anterior al inicio se rechaza', !v.alReves.ok, JSON.stringify(v.alReves.errores));
  chk('★ Encimado: "La fecha 23/09/2026 ya se encuentra en el sistema. No se puede cargar."',
      !v.encimado.ok && v.encimado.errores.indexOf('La fecha 23/09/2026 ya se encuentra en el sistema. No se puede cargar.') !== -1,
      JSON.stringify(v.encimado.errores));
  chk('★ El mismo día otra vez también se bloquea (ya no se reemplaza)', !v.mismoDia.ok && v.mismoDia.conflictos.length === 1, JSON.stringify(v.mismoDia));
  chk('Un periodo contiguo que no pisa ninguna fecha cargada se acepta (24 al 27)', v.contiguo.ok, JSON.stringify(v.contiguo.errores));
  chk('Varias fechas encimadas se nombran todas', !v.varios.ok && /22\/09\/2026, 23\/09\/2026 ya se encuentran/.test(v.varios.errores.join(' ')), JSON.stringify(v.varios.errores));
  chk('★ El documento semanal anterior a 10B cuenta como la semana entera cargada', !v.legado.ok && v.legado.conflictos[0] === '2026-09-16', JSON.stringify(v.legado));
  chk('Si el rango incluye hoy, se avisa (sin bloquear) que lo que falte de hoy ya no se podrá cargar', v.incluyeHoy.ok && v.incluyeHoy.avisos.length === 1, JSON.stringify(v.incluyeHoy));

  const suma = await p.evaluate(() => _ventasAgregarLineas([
    [{ sku: 'A', nombre: 'Copa', cantidad: 5, ventaNeta: 10 }, { sku: 'B', cantidad: 1 }],
    [{ sku: 'A', nombre: 'Copa', cantidad: 2, ventaNeta: 4 }]
  ]));
  chk('★ La semana en memoria SUMA los periodos por SKU (5 + 2 = 7)', suma.length === 2 && suma[0].sku === 'A' && suma[0].cantidad === 7 && suma[0].ventaNeta === 14, JSON.stringify(suma));

  // ── Vista previa ────────────────────────────────────────────────────────
  await p.evaluate((parsed) => {
    parsed.hoja = 'Detalle'; parsed.archivo = 'Ventas_27-09-2026.xlsx';
    parsed.periodo = { inicio: '2026-09-21', fin: '2026-09-27' };
    parsed.existentes = { semanaId: '2026-09-21', estado: 'ok', periodos: [] };
    _ventasImportPendiente = parsed; ventasImportView = 'vista_previa'; renderTab();
  }, parsed);
  await p.waitForTimeout(120);
  let previa = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('La vista previa muestra hoja, SKU, unidades y a qué semana pertenece',
      /Detalle/.test(previa) && /3 SKU/.test(previa) && /63/.test(previa) && /semana del 21 al 27 de septiembre de 2026/.test(previa), previa.slice(0, 400));
  chk('La vista previa avisa de los SKU que se sumaron', /se sumaron/.test(previa), '');
  chk('★ Hay fecha de inicio y fecha fin', await p.evaluate(() => !!document.getElementById('ventasFechaInicio') && !!document.getElementById('ventasFechaFin')), '');
  chk('Con el periodo válido y verificado, "Confirmar" está habilitado',
      await p.evaluate(() => !document.getElementById('ventasBtnConfirmar').disabled), '');
  chk('Los botones de la vista previa miden al menos 48 px de alto (pulgar)',
      await p.evaluate(() => [...document.querySelectorAll('#tabContent .bt')].every(b => b.getBoundingClientRect().height >= 48)), '');

  // Un solo día
  await p.evaluate(() => { _ventasCambiarPeriodo('inicio', '2026-09-23'); _ventasUnSoloDia(); });
  await p.waitForTimeout(120);
  previa = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('★ "Un solo día" deja inicio = fin y lo dice ("1 día: 23/09/2026")',
      await p.evaluate(() => _ventasImportPendiente.periodo.fin === '2026-09-23') && /1 día: 23\/09\/2026/.test(previa), previa.slice(0, 500));
  // Inicio posterior al fin → el fin se corrige al inicio
  await p.evaluate(() => { _ventasCambiarPeriodo('inicio', '2026-09-25'); });
  chk('Mover el inicio después del fin iguala el fin (no queda un rango al revés)',
      await p.evaluate(() => _ventasImportPendiente.periodo.fin === '2026-09-25'), '');

  // Encimado con una fecha ya cargada
  await p.evaluate(() => {
    _ventasImportPendiente.periodo = { inicio: '2026-09-21', fin: '2026-09-27' };
    _ventasImportPendiente.existentes = { semanaId: '2026-09-21', estado: 'ok', periodos: [{ inicio: '2026-09-23', fin: '2026-09-23' }] };
    renderTab();
  });
  await p.waitForTimeout(100);
  previa = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('★ La vista previa bloquea: "La fecha 23/09/2026 ya se encuentra en el sistema. No se puede cargar."',
      /La fecha 23\/09\/2026 ya se encuentra en el sistema\. No se puede cargar\./.test(previa) &&
      await p.evaluate(() => document.getElementById('ventasBtnConfirmar').disabled), previa.slice(0, 500));

  // Cruce de semana
  await p.evaluate(() => { _ventasImportPendiente.periodo = { inicio: '2026-09-26', fin: '2026-09-29' }; renderTab(); });
  await p.waitForTimeout(100);
  chk('Un rango que cruza de semana deshabilita "Confirmar" y explica por qué',
      await p.evaluate(() => document.getElementById('ventasBtnConfirmar').disabled) &&
      /cruza de semana/.test(await p.evaluate(() => document.getElementById('tabContent').innerText)), '');

  // Sin poder verificar contra el servidor
  await p.evaluate(() => {
    _ventasImportPendiente.periodo = { inicio: '2026-09-21', fin: '2026-09-27' };
    _ventasImportPendiente.existentes = { semanaId: '2026-09-21', estado: 'error', periodos: [], mensaje: 'No se pudo comprobar en el servidor qué fechas ya están cargadas' };
    renderTab();
  });
  await p.waitForTimeout(100);
  chk('★ Si no se pudo comprobar en el servidor, "Confirmar" queda deshabilitado (no se asume "no hay nada")',
      await p.evaluate(() => document.getElementById('ventasBtnConfirmar').disabled) &&
      /No se pudo comprobar/.test(await p.evaluate(() => document.getElementById('tabContent').innerText)), '');

  // ── Confirmar sin Firestore: no se guarda nada y se dice ────────────────
  await p.evaluate(() => {
    _ventasImportPendiente.existentes = { semanaId: '2026-09-21', estado: 'ok', periodos: [] };
    _db = null; ventas = []; ventasPeriodos = [];
  });
  await p.evaluate(() => confirmarImportacionVentas());
  await p.waitForTimeout(200);
  chk('★ Sin conexión, la importación NO miente: no guarda nada y se queda en la vista previa',
      await p.evaluate(() => ventasImportView === 'vista_previa' && ventas.length === 0 && !!_ventasImportPendiente), '');
  chk('…y la pantalla explica el motivo',
      /No se guardó nada/.test(await p.evaluate(() => document.getElementById('tabContent').innerText)), '');
  await p.evaluate(() => cancelarImportacionVentas());

  // ── Lista con ventas cargadas: semana y días cubiertos ──────────────────
  await p.evaluate((lineas) => {
    ventas = lineas; ventasSemanaId = '2026-09-21';
    ventasPeriodos = [{ id: '2026-09-21_2026-09-22', inicio: '2026-09-21', fin: '2026-09-22' },
                      { id: '2026-09-23_2026-09-23', inicio: '2026-09-23', fin: '2026-09-23' }];
    ventasImportView = 'lista'; renderTab();
  }, parsed.lineas);
  await p.waitForTimeout(120);
  const lista = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('La lista muestra la semana, el total y los SKU ordenados por cantidad',
      /semana del 21 al 27 de septiembre de 2026/.test(lista) && /3.*SKU/.test(lista) && /Rib Eye Mochomos/.test(lista), lista.slice(0, 300));
  chk('★ La lista dice cuántos días de la semana están cargados y avisa que el teórico es parcial',
      /Días cargados: 3 de 7/.test(lista) && /Faltan 4 día/.test(lista) &&
      await p.evaluate(() => document.querySelectorAll('.vt-dia--ok').length === 3), lista.slice(0, 500));

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
