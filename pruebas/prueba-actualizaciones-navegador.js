// v5.12 — "las actualizaciones sí llegan y se ven" · de punta a punta en Chromium.
// Simula un DESPLIEGUE real: sirve una copia de la app con la misma política de
// caché que GitHub Pages (Cache-Control: max-age=600), la abre con Service
// Worker, "publica" una versión nueva cambiando los archivos del servidor, y
// comprueba que la app lo detecta, avisa, actualiza con UN toque y conserva los datos.
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const http = require('http');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const RAIZ = path.resolve(__dirname, '..');
const PUERTO = 8091;

function copiar(origen, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const e of fs.readdirSync(origen, { withFileTypes: true })) {
    const o = path.join(origen, e.name), d = path.join(destino, e.name);
    if (e.isDirectory()) copiar(o, d); else fs.copyFileSync(o, d);
  }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-despliegue-'));
  ['index.html', 'sw.js', 'manifest.json'].forEach(f => fs.copyFileSync(path.join(RAIZ, f), path.join(tmp, f)));
  copiar(path.join(RAIZ, 'css'), path.join(tmp, 'css')); copiar(path.join(RAIZ, 'js'), path.join(tmp, 'js'));
  const V0 = (fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8').match(/APP_VERSION = '([^']+)'/) || [])[1];
  const V1 = '5.99';

  // Mismo cache-control que GitHub Pages: el HTML y los archivos se pueden quedar en la caché HTTP 10 min.
  // Servidor propio y sin dependencias: lee del disco en cada petición (así el "despliegue" es escribir un archivo).
  const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
  const srv = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]); if (rel === '/') rel = '/index.html';
    const f = path.join(tmp, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=600', 'ETag': '"' + buf.length + '-' + fs.statSync(f).mtimeMs + '"' });
      res.end(buf);
    });
  });
  await new Promise(r => srv.listen(PUERTO, '127.0.0.1', r));

  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  const URL = 'http://127.0.0.1:' + PUERTO + '/index.html';
  const montar = () => p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
  });
  const esperaSW = async (v) => { await p.waitForFunction(async (v) => { const k = await caches.keys(); return !!navigator.serviceWorker.controller && k.includes('barinventory-v' + v); }, v, { timeout: 20000 }); };

  // ── 1 · Primera visita: instala el SW y deja la app controlada ─────────────
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.getRegistration().then(r => !!(r && r.active)), null, { timeout: 20000 });
  await p.reload({ waitUntil: 'load' });
  await esperaSW(V0); await montar();
  await p.evaluate(() => localStorage.setItem('prueba_dato_del_bar', 'conteo-pendiente-123'));
  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  chk('★ BIActualizaciones existe y el pie dice la versión que corre (' + V0 + ')', await p.evaluate((v) => !!window.BIActualizaciones && document.getElementById('sbVersion').textContent.includes('versión ' + v), V0));
  chk('Sin versión nueva no hay aviso fijo', await p.evaluate(() => !document.getElementById('actBanner')));
  const sinNueva = await p.evaluate(async () => { const v = await window.buscarActualizacion(); return v; });
  chk('"Buscar actualización" sin nada nuevo no muestra aviso fijo', !(await p.$('#actBanner')) && sinNueva === (await p.evaluate(() => window.BIActualizaciones._versionPagina())), String(sinNueva));
  chk('★ El SW no guardó su propio sw.js en caché (la comprobación no puede mentir)',
      await p.evaluate(async () => { for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) { if (/\/sw\.js/.test(r.url)) return false; } } return true; }));

  // ── 2 · "Se publica" la versión nueva en el servidor ────────────────────────
  let h = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
  h = h.split('?v=' + V0).join('?v=' + V1).replace('<title>', '<meta name="bi-prueba" content="despliegue-' + V1 + '"><title>');
  fs.writeFileSync(path.join(tmp, 'index.html'), h);
  fs.writeFileSync(path.join(tmp, 'sw.js'), fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8').replace("APP_VERSION = '" + V0 + "'", "APP_VERSION = '" + V1 + "'"));

  await p.evaluate(() => window.buscarActualizacion());
  await p.waitForSelector('#actBanner', { timeout: 15000 });
  const banner = await p.evaluate(() => { const b = document.getElementById('actBanner'); const r = b.querySelector('#actBannerBtn'); return { txt: b.textContent, h: r.offsetHeight, z: getComputedStyle(b).zIndex, pos: getComputedStyle(b).position }; });
  chk('★ Aparece el aviso FIJO "Nueva versión ' + V1 + ' lista · Actualizar"', /5\.99/.test(banner.txt) && /Actualizar/.test(banner.txt), banner.txt);
  chk('El botón "Actualizar" mide >= 44 px y el aviso es fijo sobre la barra inferior', banner.h >= 44 && banner.pos === 'fixed' && Number(banner.z) > 200, JSON.stringify(banner));
  chk('★ NO se recargó solo: sigue la página vieja hasta que se toca "Actualizar"', await p.evaluate((v) => window.BIActualizaciones._versionPagina() === v, V0));
  await p.waitForTimeout(3500);   // el SW nuevo ya se instaló por detrás
  chk('★ El SW nuevo se instaló y el pie lo dice con palabras ("actualización ' + V1 + ' lista")', await p.evaluate((v) => document.getElementById('sbVersion').textContent.includes('actualización ' + v + ' lista'), V1), await p.evaluate(() => document.getElementById('sbVersion').textContent));

  // ── 3 · Un toque en "Actualizar": la página nueva, con la versión nueva ──────
  await Promise.all([p.waitForNavigation({ waitUntil: 'load', timeout: 20000 }), p.click('#actBannerBtn')]);
  await p.waitForTimeout(800); await montar();
  chk('★ Tras UN toque en "Actualizar" corre la versión nueva (el HTML no salió de la caché HTTP de 10 min)', await p.evaluate((v) => window.BIActualizaciones._versionPagina() === v && !!document.querySelector('meta[name="bi-prueba"]'), V1));
  chk('El pie ya dice la versión nueva sin aviso pendiente', await p.evaluate((v) => document.getElementById('sbVersion').textContent.trim() === 'BarInventory · versión ' + v, V1), await p.evaluate(() => document.getElementById('sbVersion').textContent));
  await esperaSW(V1);
  chk('El caché de la versión vieja se limpió (queda solo barinventory-v' + V1 + ')', await p.evaluate(async (v) => { const k = (await caches.keys()).filter(x => /^barinventory-v/.test(x)); return k.length === 1 && k[0] === 'barinventory-v' + v; }, V1));
  chk('★ El dato guardado en el teléfono (localStorage) sobrevivió a la actualización', await p.evaluate(() => localStorage.getItem('prueba_dato_del_bar') === 'conteo-pendiente-123'));
  chk('Sin errores de JS tras actualizar', errs.length === 0, errs.join(' | '));

  // ── 4 · Sin señal: la app abre desde la copia guardada ──────────────────────
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'load' }).catch(() => {});
  await p.waitForTimeout(800);
  chk('★ Sin señal, recargar abre la app desde la copia guardada (no pantalla en blanco)', await p.evaluate(() => !!document.getElementById('appWrapper') && !!document.querySelector('meta[name="bi-prueba"]')));
  await ctx.setOffline(false);

  // ── 5 · "Reparar": borra archivos y caché, conserva los datos ───────────────
  await p.evaluate(() => { window.showConfirm = function (m, cb) { window.__msgReparar = m; cb(); }; });
  await Promise.all([p.waitForNavigation({ waitUntil: 'load', timeout: 25000 }), p.evaluate(() => window.repararAplicacion())]);
  await p.waitForTimeout(1200);
  chk('"Reparar" reinicia la app con ?r=<hora> (salta cualquier caché)', /[?&]r=\d+/.test(p.url()), p.url());
  chk('★ "Reparar" conservó los datos del teléfono (localStorage)', await p.evaluate(() => localStorage.getItem('prueba_dato_del_bar') === 'conteo-pendiente-123'));
  chk('Y la app volvió a instalar su Service Worker y cargó sin errores', await p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())) && errs.length === 0, errs.join(' | '));

  await nav.close(); srv.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  const w = Math.max.apply(null, C.map(c => c.n.length)); let f = 0;
  console.log('\n  ── v5.12 · Actualizaciones que sí llegan (navegador, despliegue simulado) ──\n');
  C.forEach(c => { if (!c.ok) f++; console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)); });
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - f) + ' pasaron · ' + f + ' fallaron\n');
  process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
