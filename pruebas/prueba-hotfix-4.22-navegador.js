// HOTFIX 4.22 — en la app real (Chromium): movimientos se recorta a la
// semana en curso + la anterior, `compras` (la fuente de verdad) nunca se
// toca, y el aviso de cuota ya nombra la clave real en vez de mandar
// genéricamente al botón equivocado ("Exporta y limpia historiales").
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
    localStorage.clear();
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
  chk('La página carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  // ── 1) El recorte: semana en curso + anterior se quedan, lo más viejo cae ──
  const r1 = await p.evaluate(() => {
    const hoy = new Date();
    const semHoy      = semanaId(hoy);
    const semAnterior = semanaAnterior(semHoy);
    const semVieja    = semanaAnterior(semAnterior);

    movimientos = [
      { movId: 'm1', tipo: 'compra', productoId: 'P1', semanaId: semHoy },
      { movId: 'm2', tipo: 'compra', productoId: 'P2', semanaId: semAnterior },
      { movId: 'm3', tipo: 'compra', productoId: 'P3', semanaId: semVieja },
      { movId: 'm4', tipo: 'compra', productoId: 'P4', semanaId: semVieja }
    ];
    compras = [{ compraId: 'C1', folio: 'F1', semanaId: semVieja, lineas: [] }]; // fuente de verdad: no debe tocarse

    _movimientosRecortar();

    return {
      ids: movimientos.map(m => m.movId),
      comprasIntactas: compras.length === 1 && compras[0].compraId === 'C1'
    };
  });
  chk('★ Se conservan semana en curso y anterior, se descarta lo de dos semanas atrás',
      r1.ids.length === 2 && r1.ids.includes('m1') && r1.ids.includes('m2'), JSON.stringify(r1.ids));
  chk('★ `compras` (la fuente de verdad) no se toca — solo `movimientos`',
      r1.comprasIntactas, JSON.stringify(r1));

  // ── 2) saveToLocalStorage() recorta de verdad antes de persistir ──────────
  const r2 = await p.evaluate(() => {
    const hoy = new Date();
    const semVieja = semanaAnterior(semanaAnterior(semanaId(hoy)));
    movimientos = [{ movId: 'mViejo', tipo: 'compra', productoId: 'PX', semanaId: semVieja }];
    saveToLocalStorage();
    const persistido = JSON.parse(localStorage.getItem('inventarioApp_movimientos') || '[]');
    return { enMemoria: movimientos.length, persistido: persistido.length };
  });
  chk('★ saveToLocalStorage() ya deja `movimientos` recortado, en memoria Y en lo persistido',
      r2.enMemoria === 0 && r2.persistido === 0, JSON.stringify(r2));

  // ── 3) El aviso de cuota nombra la clave real, no el genérico de siempre ──
  const r3 = await p.evaluate(() => {
    _lsQuotaWarned = false;
    // Relleno deliberado para cruzar el umbral de aviso (4 MB) de forma
    // determinista, sin depender de cuánto haya acumulado la app hasta
    // ahora. 2 300 000 caracteres × 2 bytes (UTF-16) ≈ 4.4 MB.
    localStorage.setItem('inventarioApp_pruebaRelleno', 'x'.repeat(2300000));
    saveToLocalStorage();
    const toast = document.getElementById('toastMessage');
    const texto = toast ? toast.textContent : '';
    localStorage.removeItem('inventarioApp_pruebaRelleno'); // limpieza: no es dato real
    return { texto, warned: _lsQuotaWarned };
  });
  chk('★ El aviso se disparó (cruzó el umbral de 4 MB)', r3.warned === true, JSON.stringify(r3));
  chk('★ …y ya NO manda genéricamente a "Exporta y limpia historiales"',
      !/Exporta y limpia historiales/.test(r3.texto), r3.texto);
  chk('★ …sino que nombra la clave real y su peso en KB',
      /pruebaRelleno.*KB/.test(r3.texto) || /KB.*pruebaRelleno/.test(r3.texto), r3.texto);
  chk('…y aclara que no hay riesgo de pérdida (nube + respaldo interno)',
      /a salvo/.test(r3.texto), r3.texto);

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── HOTFIX 4.22 · recorte de movimientos y aviso de cuota (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
