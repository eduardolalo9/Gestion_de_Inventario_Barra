// v5.20 — Ícono de la app en Chromium real: el manifest y todos sus íconos se
// descargan (200, PNG), la pestaña usa el favicon nuevo y la pantalla de
// inicio de sesión muestra el ícono real. Sin errores de JavaScript.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const BASE = 'http://127.0.0.1:' + PUERTO + '/';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto(BASE + 'index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(800);
  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  const r = await p.evaluate(async () => {
    const man = await (await fetch(document.querySelector('link[rel="manifest"]').href)).json();
    const urls = man.icons.map(i => i.src).concat(['icons/favicon-32.png', 'icons/favicon-48.png', 'icons/apple-touch-icon.png']);
    const res = [];
    for (const u of urls) {
      const x = await fetch(u, { cache: 'reload' });
      const b = new Uint8Array(await x.arrayBuffer());
      res.push({ u, status: x.status, png: b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 });
    }
    const iconos = [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map(l => l.getAttribute('href'));
    const img = document.querySelector('img.login-brand-icon');
    if (img && !img.complete) await new Promise(ok => { img.onload = img.onerror = ok; });
    return { man: { maskable: man.icons.filter(i => i.purpose === 'maskable').length, any: man.icons.filter(i => i.purpose === 'any').length, fondo: man.background_color },
             res, iconos, img: img ? { w: img.naturalWidth, alt: img.alt, caja: img.getBoundingClientRect().width } : null };
  });
  chk('★ El manifest declara 2 íconos "any" y 2 "maskable"', r.man.any === 2 && r.man.maskable === 2, JSON.stringify(r.man));
  chk('★ Todos los íconos se descargan (200) y son PNG', r.res.every(x => x.status === 200 && x.png), JSON.stringify(r.res.filter(x => !(x.status === 200 && x.png))));
  chk('La pestaña y la pantalla de inicio de iPhone apuntan a archivos (no a una imagen dibujada)',
      r.iconos.length >= 3 && r.iconos.every(h => /^icons\//.test(h)), JSON.stringify(r.iconos));
  chk('★ El inicio de sesión muestra el ícono real (192 px reales en una caja de 56)', r.img && r.img.w === 192 && r.img.alt === 'BarInventory' && Math.round(r.img.caja) === 56, JSON.stringify(r.img));

  // El Service Worker se instala con el ícono en su caché (y sin interceptarlo).
  await p.waitForTimeout(2500);
  const sw = await p.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const ks = await caches.keys();
    let enCache = false;
    for (const k of ks) { const c = await caches.open(k); if (await c.match('./icons/barinventory-192.png')) enCache = true; }
    return { activo: !!(reg && (reg.active || reg.waiting || reg.installing)), enCache };
  });
  chk('El Service Worker se instala y guarda el ícono de 192 en su caché', sw.activo && sw.enCache, JSON.stringify(sw));

  chk('Sin errores de JavaScript en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();
  let mal = 0; C.forEach(c => { if (!c.ok) mal++; console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  →  ' + c.d)); });
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron');
  process.exit(mal ? 1 : 0);
})();
