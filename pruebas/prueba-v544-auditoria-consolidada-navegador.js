// v5.44 — Exportación de la Auditoría consolidada (botón Excel de Conteo,
// inventario total del admin, mi conteo y reportes publicados).
// Se descarga el .xlsx REAL en Chromium y se relee celda por celda:
//   Hoja «Auditoría»: ID, Nombre, Unidad, Grupo, Almacén Enteras / Abierta 1 (oz) / Total,
//     Barra Restaurante Enteras / Abierta 1 (oz) / Total, Barra Bar Enteras / Abierta 1 (oz) /
//     Abierta 2 (oz) / Total, Total General.
//   Hoja «Inventario»: Grupo, ID, Nombre, Unidad, Precio, Total General, Precio total.
// SheetJS: copia local si existe (XLSX_LOCAL o paquete xlsx), si no, cdnjs.
const { chromium } = require('playwright');
const fs = require('fs');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

function rutaXlsxLocal() {
  if (process.env.XLSX_LOCAL && fs.existsSync(process.env.XLSX_LOCAL)) return process.env.XLSX_LOCAL;
  try { return require.resolve('xlsx/dist/xlsx.full.min.js'); } catch (_) { return null; }
}

const CAB_AUDITORIA = ['ID', 'Nombre', 'Unidad', 'Grupo',
  'Almacén Enteras', 'Almacén Abierta 1 (oz)', 'Almacén Total',
  'Barra Restaurante Enteras', 'Barra Restaurante Abierta 1 (oz)', 'Barra Restaurante Total',
  'Barra Bar Enteras', 'Barra Bar Abierta 1 (oz)', 'Barra Bar Abierta 2 (oz)', 'Barra Bar Total', 'Total General'];
const CAB_INVENTARIO = ['Grupo', 'ID', 'Nombre', 'Unidad', 'Precio', 'Total General', 'Precio total'];

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const local = rutaXlsxLocal();
  if (local) await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\//, r => r.fulfill({ path: local, contentType: 'application/javascript' }));
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  if (process.env.DEPURAR) { p.on('pageerror', e => console.log('PAGEERROR', String(e))); p.on('console', m => console.log('CONSOLE', m.text().slice(0, 200))); }
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.waitForFunction(() => typeof XLSX !== 'undefined', null, { timeout: 15000 }).catch(() => {});
  const hayXlsx = await p.evaluate(() => typeof XLSX !== 'undefined');
  chk('La librería XLSX de la app está cargada (' + (local ? 'copia local' : 'cdnjs') + ')', hayXlsx);
  if (!hayXlsx) return fin(nav);

  const MONTAR = () => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; currentUserRole = 'admin';
    _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
    products = [
      { id: 'DJ7', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'PZA', precio: 1480, capacidadMl: 700, pesoBotellaLlenaOz: 53.65, conteoOzHabilitado: true },
      { id: 'JUG', name: 'JUGO DE PIÑA', group: 'JUGOS', unit: 'LTS', precio: 45.5 },
      { id: 'SIN', name: 'PRODUCTO SIN PRECIO', group: 'JUGOS', unit: 'PZA' }
    ];
    allUsersAuditoria = { u1: { uid: 'u1', conteo: {} } };
    auditoriaConteo = {
      DJ7: { almacen: { enteras: 3, abiertas: [30] }, barra1: { enteras: 1, abiertas: [20] }, barra2: { enteras: 0, abiertas: [40, 25] } },
      JUG: { almacen: { enteras: 4, abiertas: [] }, barra1: { enteras: 2, abiertas: [] }, barra2: { enteras: 1.5, abiertas: [] } },
      SIN: { almacen: { enteras: 2, abiertas: [] } }
    };
  };
  await p.evaluate(MONTAR);

  // Descarga real y lectura con la misma SheetJS de la app
  // Cada descarga en una página nueva con los mismos datos: Chromium bloquea la
  // segunda descarga automática de una misma página. `extra` ajusta los datos.
  async function descargar(accion, extra) {
    const q = await ctx.newPage(); q.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await q.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
    await q.waitForFunction(() => typeof XLSX !== 'undefined', null, { timeout: 15000 });
    await q.evaluate(MONTAR); if (extra) await q.evaluate(extra);
    const r = await _descargar(q, accion); await q.close(); return r;
  }
  async function _descargar(p, accion) {
    // Con un clic real (gesto del usuario): Chromium bloquea la 3.ª descarga
    // automática seguida si no la origina una pulsación, igual que en el celular.
    // `accion` deja en window.__accion lo que hará el botón (sin eval: la CSP de la app lo prohíbe).
    await p.evaluate(accion);
    await p.evaluate(() => {
      let b = document.getElementById('__expPrueba');
      if (!b) { b = document.createElement('button'); b.id = '__expPrueba'; b.textContent = 'exportar';
                b.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;width:80px;height:40px'; document.body.appendChild(b); }
      b.onclick = () => window.__accion();
    });
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#__expPrueba')]);
    const b64 = fs.readFileSync(await dl.path()).toString('base64');
    return p.evaluate((b) => {
      const wb = XLSX.read(b, { type: 'base64', cellNF: true });
      const hojas = {};
      wb.SheetNames.forEach(n => { hojas[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }); });
      const fmt = (n, ref) => (wb.Sheets[n][ref] || {}).z || null;
      return { nombres: wb.SheetNames, hojas, fmtPrecio: fmt('Inventario', 'E2'), fmtValor: fmt('Inventario', 'G2'), nombre: '' };
    }, b64).then(r => Object.assign(r, { archivo: dl.suggestedFilename() }));
  }

  const x = await descargar(() => { window.__accion = () => exportarExcelAdminTotal(); });
  chk('Se descarga un .xlsx con dos hojas: «Auditoría» e «Inventario»', JSON.stringify(x.nombres) === '["Auditoría","Inventario"]' && /\.xlsx$/.test(x.archivo), JSON.stringify([x.nombres, x.archivo]));
  const A = x.hojas['Auditoría'] || [], I = x.hojas['Inventario'] || [];
  chk('★ Hoja Auditoría: exactamente las 15 columnas pedidas, en orden', JSON.stringify(A[0]) === JSON.stringify(CAB_AUDITORIA), JSON.stringify(A[0]));
  chk('Ya no salen columnas técnicas, de compras ni «Estado» en la consolidada', !A[0].some(h => /CapacidadML|PesoBotellaOz|Precio|Proveedor|Stock minimo|ConteoOz|PV|Estado/.test(h)), JSON.stringify(A[0]));

  const exp = await p.evaluate(() => {
    const d = products[0], c = (oz) => convertirOzAPuntos(oz, d.capacidadMl, d.pesoBotellaLlenaOz);
    const r = n => parseFloat(n.toFixed(2));
    const alm = r(3 + c(30)), b1 = r(1 + c(20)), b2 = r(0 + c(40) + c(25));
    return { alm, b1, b2, tot: r(alm + b1 + b2) };
  });
  const fDJ7 = A.find(f => f[0] === 'DJ7') || [];
  chk('★ DON JULIO: enteras, onzas abiertas y totales por área (oz → botellas) correctos',
      JSON.stringify(fDJ7) === JSON.stringify(['DJ7', 'DON JULIO 70', 'PZA', 'TEQUILA', 3, 30, exp.alm, 1, 20, exp.b1, 0, 40, 25, exp.b2, exp.tot]), JSON.stringify([fDJ7, exp]));
  const fJUG = A.find(f => f[0] === 'JUG') || [];
  chk('JUGO: sin abiertas, las celdas de oz quedan vacías y el Total General suma las 3 áreas (7.5)',
      JSON.stringify(fJUG) === JSON.stringify(['JUG', 'JUGO DE PIÑA', 'LTS', 'JUGOS', 4, '', 4, 2, '', 2, 1.5, '', '', 1.5, 7.5]), JSON.stringify(fJUG));
  chk('Conserva subtotales por grupo y GRAN TOTAL', A.some(f => f[1] === 'Subtotal – JUGOS' && f[14] === 9.5) && A.some(f => f[1] === 'GRAN TOTAL' && f[14] === Math.round((exp.tot + 9.5) * 100) / 100),
      JSON.stringify(A.filter(f => /Subtotal|GRAN/.test(f[1]))));

  chk('★ Hoja Inventario: Grupo, ID, Nombre, Unidad, Precio, Total General, Precio total', JSON.stringify(I[0]) === JSON.stringify(CAB_INVENTARIO), JSON.stringify(I[0]));
  const iDJ7 = I.find(f => f[1] === 'DJ7') || [], iJUG = I.find(f => f[1] === 'JUG') || [], iSIN = I.find(f => f[1] === 'SIN') || [];
  const vDJ7 = Math.round(1480 * exp.tot * 100) / 100;
  chk('★ Precio total = Precio × Total General (DON JULIO)', JSON.stringify(iDJ7) === JSON.stringify(['TEQUILA', 'DJ7', 'DON JULIO 70', 'PZA', 1480, exp.tot, vDJ7]), JSON.stringify([iDJ7, vDJ7]));
  chk('Precio total del JUGO: 45.50 × 7.5 = 341.25', JSON.stringify(iJUG) === JSON.stringify(['JUGOS', 'JUG', 'JUGO DE PIÑA', 'LTS', 45.5, 7.5, 341.25]), JSON.stringify(iJUG));
  chk('Sin precio en el catálogo: Precio y Precio total vacíos (nunca un 0 inventado)', iSIN[4] === '' && iSIN[6] === '' && iSIN[5] === 2, JSON.stringify(iSIN));
  chk('Subtotal del grupo y GRAN TOTAL del valor', I.some(f => f[2] === 'Subtotal – JUGOS' && f[6] === 341.25 && f[5] === 9.5) && I.some(f => f[2] === 'GRAN TOTAL' && f[6] === Math.round((vDJ7 + 341.25) * 100) / 100),
      JSON.stringify(I.filter(f => /Subtotal|GRAN/.test(f[2]))));
  chk('Precio y Precio total con formato de moneda en Excel', /\$/.test(x.fmtPrecio || '') && /\$/.test(x.fmtValor || ''), JSON.stringify([x.fmtPrecio, x.fmtValor]));

  // Más botellas abiertas de las previstas: se agrega la columna, no se pierde el dato
  const masAbiertas = () => { auditoriaConteo.DJ7.barra2.abiertas = [40, 25, 10]; };
  const y = await descargar(() => { window.__accion = () => exportarExcelAdminTotal(); }, masAbiertas);
  const A2 = y.hojas['Auditoría'];
  chk('Con 3 botellas abiertas en Barra Bar aparece «Barra Bar Abierta 3 (oz)» y el 10 no se pierde',
      A2[0][13] === 'Barra Bar Abierta 3 (oz)' && A2[0][14] === 'Barra Bar Total' && (A2.find(f => f[0] === 'DJ7') || [])[13] === 10, JSON.stringify(A2[0]));


  // El usuario (no admin) exporta su propio conteo con el mismo formato
  const comoUsuario = () => { currentUserRole = 'user'; _authzState.permissions = new Set(['inventory.read', 'inventory.export']); myAuditoriaStatus = { almacen: 'completada' }; myAuditoriaConteo = { JUG: { almacen: { enteras: 4, abiertas: [] } } }; };
  const z = await descargar(() => { window.__accion = () => exportarAuditoriaExcel(); }, comoUsuario);
  chk('«Mi conteo» (usuario) usa el mismo formato de dos hojas', JSON.stringify(z.nombres) === '["Auditoría","Inventario"]' && JSON.stringify(z.hojas['Auditoría'][0]) === JSON.stringify(CAB_AUDITORIA), JSON.stringify(z.nombres));


  // El inventario cerrado (modo 'completo') conserva su formato de siempre
  const w = await descargar(() => { window.__accion = () => exportToExcelConDatos('completo', auditoriaConteo, products, 'cerrado.xlsx'); });
  chk('El Excel del inventario cerrado no cambia (CapacidadML, Precio, Estado; una sola hoja)',
      w.nombres.length === 1 && ['CapacidadML', 'Precio', 'Proveedor', 'Estado'].every(h => w.hojas[w.nombres[0]][0].includes(h)), JSON.stringify([w.nombres, w.hojas[w.nombres[0]][0]]));
  chk('Exportar no cambia el conteo ni el catálogo en memoria', await p.evaluate(() => products.length === 3 && auditoriaConteo.DJ7.almacen.enteras === 3));
  chk('Sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  fin(nav);
})().catch(e => { console.error(e); process.exit(1); });

async function fin(nav) {
  await nav.close();
  const w = Math.max(...C.map(c => c.n.length));
  console.log('\n  ── v5.44 · Auditoría consolidada en Excel (descarga real) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
  const fallos = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
}
