// F3 — humo en el navegador real: la app carga con el código de FASE 3 y las
// tres piezas nuevas (operación, glosario, interfaz) se comportan en Chromium.
//
// Lo que aquí se prueba NO se puede probar leyendo el archivo: que el código
// nuevo no rompa la carga, que el glosario se pinte con los tres estados y que
// el detalle del inventario cerrado muestre el botón o la explicación según el
// permiso. El comportamiento contra Firestore está en prueba-f3-integracion.js.
const { chromium, devices } = require('playwright');
const C = []; const chk = (n, ok, d) => { C.push({ n, ok, d }); };

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await nav.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await p.goto('http://127.0.0.1:' + (process.env.PUERTO || '8080') + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(2000);
  chk('La página carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  // ── Las piezas nuevas existen en el entorno real ────────────────────────
  const piezas = await p.evaluate(() => ({
    contabilizar: typeof contabilizarInventario,
    saldos:       typeof _saldosDesdeSnapshot,
    verificar:    typeof _verificarInicialExistente,
    inicial:      typeof inicialDesdeCierre,
  }));
  chk('contabilizarInventario() está disponible', piezas.contabilizar === 'function', JSON.stringify(piezas));
  chk('_saldosDesdeSnapshot() está disponible',   piezas.saldos === 'function');
  chk('_verificarInicialExistente() está disponible', piezas.verificar === 'function');
  chk('inicialDesdeCierre() sigue disponible',    piezas.inicial === 'function');

  // ── El glosario de estados ──────────────────────────────────────────────
  const glos = await p.evaluate(() => {
    const html = renderGlosarioEstados();
    const d = document.createElement('div'); d.innerHTML = html;
    return { html, pills: [...d.querySelectorAll('span')].map(s => s.textContent.trim()) };
  });
  chk('El glosario pinta exactamente tres estados',
      glos.pills.filter(t => /^(Sincronizado|Cerrado|Contabilizado)$/.test(t)).length === 3,
      JSON.stringify(glos.pills));
  chk('Explica qué significa Contabilizado, no solo lo nombra',
      /stock inicial de la semana siguiente/.test(glos.html));
  chk('Sigue explicando los dos estados anteriores',
      /Conteo en curso/.test(glos.html) && /inmutable/.test(glos.html));

  // ── El historial distingue el estado nuevo ──────────────────────────────
  const hist = await p.evaluate(() => {
    _historialInventarios = [
      { inventoryId: 'inv-a', numero: 41, estado: 'CERRADO',
        fechaCreacion: Date.parse('2026-09-06T12:00:00Z'), totalProductos: 120 },
      { inventoryId: 'inv-b', numero: 42, estado: 'CONTABILIZADO', semanaDestino: '2026-09-14',
        fechaCreacion: Date.parse('2026-09-13T12:00:00Z'), totalProductos: 122 },
    ];
    auditoriaView = 'historial';
    window.isAdmin = () => true;
    return renderHistorialInventarios();
  });
  chk('El inventario contabilizado se marca distinto del cerrado',
      /CONTABILIZADO/.test(hist) && /CERRADO/.test(hist), '');
  chk('Dice de qué semana quedó como inicial',
      /Inicial de la semana 2026-09-14/.test(hist));

  // ── El detalle: botón con permiso, explicación sin él ───────────────────
  const detalle = async (estado, permiso, extra) => p.evaluate(a => {
    window.hasPermission = perm => (perm === 'inventory.post' ? a.permiso : true);
    _detalleInventarioCerradoId = 'inv-x';
    _detalleInventarioCerradoData = {
      meta: Object.assign({ inventoryId: 'inv-x', numero: 42, estado: a.estado,
                            semanaId: '2026-09-07', fechaCreacion: Date.now(),
                            fechaCierre: Date.now(), fechaRecuento: '2026-09-13',
                            totalProductos: 3 }, a.extra || {}),
      registros: [],
    };
    auditoriaView = 'detalle_cerrado';
    return renderDetalleInventarioCerrado();
  }, { estado, permiso, extra });

  const conPermiso = await detalle('CERRADO', true);
  chk('Con permiso y cerrado, aparece el botón de contabilizar',
      /Contabilizar/.test(conPermiso) && /contabilizarInventario\(/.test(conPermiso), '');

  const sinPermiso = await detalle('CERRADO', false);
  chk('Sin permiso, el botón NO se dibuja',
      !/contabilizarInventario\(/.test(sinPermiso), '');

  const yaContab = await detalle('CONTABILIZADO', true, { semanaDestino: '2026-09-14' });
  chk('Ya contabilizado: informa, y no ofrece repetirlo',
      /[Cc]ontabilizado/.test(yaContab) && !/contabilizarInventario\(/.test(yaContab), '');

  chk('Ningún error de JS en toda la prueba', errs.length === 0, errs.join(' | '));

  await nav.close();

  let fallos = 0;
  console.log('');
  for (const c of C) {
    if (!c.ok) fallos++;
    console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(54) + (c.ok ? '' : '   ← ' + (c.d || '')));
  }
  console.log('\n  ' + C.length + ' pruebas · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})();
