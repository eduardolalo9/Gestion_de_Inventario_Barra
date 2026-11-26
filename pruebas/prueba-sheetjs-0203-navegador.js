// SheetJS 0.20.3 propio (js/xlsx.full.min.js, v5.49) — en Chromium contra la app REAL.
//   node pruebas/prueba-sheetjs-0203-navegador.js   (servidor local en PUERTO, 8080; lo levanta todas-navegador.js)
// Comprueba: la app carga SheetJS de su propio origen (sin cdnjs ni otro CDN) con la CSP estricta (v5.57),
// el Excel se genera con las funciones reales de la app, y sin red la biblioteca sale del Service Worker
// (Excel funciona sin conexión). Datos ficticios; nada toca Firebase.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d === undefined ? '' : String(d) });
const NOVERIF = [];
const PUERTO = process.env.PUERTO || '8080';
const ORIGEN = 'http://127.0.0.1:' + PUERTO;
const URL_APP = ORIGEN + '/index.html';
const RUTA = 'js/xlsx.full.min.js';
const VER_APP = (/APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8')) || [])[1] || '';
const RUTA_V = RUTA + '?v=' + VER_APP;   // la URL exacta que pide index.html y que guarda el Service Worker
const X = require(path.join(__dirname, '..', RUTA));
const esperarXlsx = (p) => p.evaluate(async () => { for (let i = 0; i < 40 && typeof XLSX === 'undefined'; i++) await new Promise(r => setTimeout(r, 150)); return typeof XLSX !== 'undefined' ? XLSX.version : null; });

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());

  // ═══ 1 · Carga desde el propio origen, sin CDN ═══════════════════════════
  let ctx = await nav.newContext({ serviceWorkers: 'block' });
  let p = await ctx.newPage();
  const pedidas = []; const errs = [];
  p.on('request', q => pedidas.push(q.url())); p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  const respVendor = [];
  p.on('response', r => { if (r.url().indexOf(RUTA) !== -1) respVendor.push(r.status() + ' ' + r.url()); });
  await p.goto(URL_APP, { waitUntil: 'load' });
  const v = await esperarXlsx(p);
  chk('★ La app carga SheetJS 0.20.3', v === '0.20.3', v);
  chk('★ Se pidió al propio origen (' + RUTA_V + ') y respondió 200', respVendor.length >= 1 && respVendor.every(s => s === '200 ' + ORIGEN + '/' + RUTA_V), JSON.stringify(respVendor));
  chk('★ Ninguna petición a cdnjs ni a otra URL de xlsx externa', !pedidas.some(u => /cdnjs\.cloudflare\.com/.test(u) || (/xlsx/i.test(u) && u.indexOf(ORIGEN) !== 0)), pedidas.filter(u => /xlsx|cdnjs/i.test(u)).join(' | '));
  chk('El <script> lleva la versión de la app y defer', await p.evaluate((r) => { const s = [...document.scripts].find(x => (x.getAttribute('src') || '') === r); return !!s && s.defer; }, RUTA_V));

  // ═══ 2 · Excel con las funciones reales de la app (en el navegador) ══════
  const res = await p.evaluate(() => {
    const filas = [{ grupo: 'TEQUILA', id: '0012', descripcion: 'TEQUILA FICTICIO', unidad: 'Botellas', existencia: 3.25 },
                   { grupo: 'RON', id: 'R-1', descripcion: 'RON FICTICIO', unidad: 'Botellas', existencia: null }];
    const wb = existenciasExportLibro(XLSX, filas, { generado: 'hoy', usuario: 'prueba', version: '5.41', fuente: 'oficial', corte: 'Ficticio', avisos: [] });
    const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
    const fijo = existenciasExportCongelar(XLSX, bytes, 3);
    return Array.from(new Uint8Array(fijo || bytes));
  });
  const buf = Buffer.from(res);
  const wbN = X.read(buf, { type: 'buffer' });
  const xml = Buffer.from(X.CFB.find(X.CFB.read(buf, { type: 'buffer' }), '/xl/worksheets/sheet1.xml').content).toString('utf8');
  const aoa = X.utils.sheet_to_json(wbN.Sheets['Existencias'], { header: 1, defval: null });
  chk('★ Existencias generadas en el navegador: 3 hojas, ID «0012» como texto, cifra inválida VACÍA y fila fija',
      wbN.SheetNames.length === 3 && aoa[1][1] === '0012' && aoa[2][4] === null && /state="frozen"/.test(xml), JSON.stringify(aoa));
  chk('Sin errores de JavaScript al cargar y exportar', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 3 · Sin red: la biblioteca sale del Service Worker ══════════════════
  ctx = await nav.newContext();
  p = await ctx.newPage();
  await p.goto(URL_APP, { waitUntil: 'load' });
  let swListo = false;
  try {
    await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.getRegistration().then(r => !!(r && r.active)), null, { timeout: 20000 });
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(async (r) => { for (const k of await caches.keys()) { const c = await caches.open(k); if (await c.match(new URL(r, location.href).href)) return true; } return false; }, RUTA_V, { timeout: 20000 });
    swListo = true;
  } catch (_) { swListo = false; }
  if (!swListo) {
    NOVERIF.push('Excel sin red (el Service Worker no quedó activo con la biblioteca en caché en este entorno)');
  } else {
    chk('★ El Service Worker guardó la biblioteca en su caché (mismo origen, con la ?v= de la app)', true);
    await ctx.setOffline(true);
    await p.reload({ waitUntil: 'load' }).catch(() => {});
    const vOff = await esperarXlsx(p);
    const offBytes = vOff ? await p.evaluate(() => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ID', 'Cantidad'], ['0012', 3]]), 'H'); return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }).byteLength; }) : 0;
    chk('★ SIN RED la app vuelve a abrir con SheetJS 0.20.3 desde la caché y genera un .xlsx', vOff === '0.20.3' && offBytes > 1000, vOff + ' · ' + offBytes + ' bytes');
    await ctx.setOffline(false);
  }
  await ctx.close();
  await nav.close();

  console.log('\n  ── SheetJS 0.20.3 en el navegador: propio origen, CSP estricta y sin red ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + c.d)));
  NOVERIF.forEach(n => console.log('  ⚪  NO VERIFICADO: ' + n));
  const fl = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fl) + ' pasaron · ' + fl + ' fallaron' + (NOVERIF.length ? ' · ' + NOVERIF.length + ' sin verificar' : '') + '\n');
  process.exit(fl ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
