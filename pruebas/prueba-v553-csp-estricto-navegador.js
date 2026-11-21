// v5.53 — Política de contenido ESTRICTA en un Chromium real, con servidor propio (no depende del de la suite):
//   · 8093: index.html con la política final (sin 'unsafe-inline' en script-src, con el hash de cada <script> en línea): la de v5.57 en adelante.
//   · 8094: la política ANTERIOR (con 'unsafe-inline', CSP_LAXA=1): se conserva para probar el modo «sombra» del despachador.
// Esta prueba es INDEPENDIENTE del cálculo de hashes: si un hash estuviera mal, el navegador bloquearía el script en línea y aquí se vería.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http'), path = require('path');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const RAIZ = path.join(__dirname, '..');
const arrancar = (puerto, estricto) => spawn(process.execPath, [path.join(RAIZ, 'herramientas', 'servidor-estatico.js'), String(puerto)],
  { cwd: RAIZ, stdio: 'ignore', env: Object.assign({}, process.env, estricto ? { CSP_ESTRICTO: '1', CSP_LAXA: '' } : { CSP_ESTRICTO: '', CSP_LAXA: '1' }) });
const esperar = (puerto) => new Promise((ok) => { let n = 40; (function t() { http.get('http://127.0.0.1:' + puerto + '/index.html', (r) => { r.resume(); ok(true); }).on('error', () => { if (--n <= 0) ok(false); else setTimeout(t, 250); }); })(); });

async function cargar(nav, puerto, preparar) {
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const viol = [], errs = [], dialogos = [];
  p.on('console', (m) => { if (/Content Security Policy|violates the following/i.test(m.text())) viol.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  p.on('dialog', (d) => { dialogos.push(d.message()); d.dismiss(); });
  if (preparar) await ctx.addInitScript(preparar);
  await p.goto('http://127.0.0.1:' + puerto + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(700);
  return { ctx, p, viol, errs, dialogos };
}
const MONTAR = () => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'adm'; currentUserRole = 'admin'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
  products = [{ id: 'A', name: 'PRODUCTO A', group: 'G', unit: 'PZA', precio: 10, stockMinimo: 5, conversion: 1, stockByArea: { almacen: 1 } }];
  orders = []; inventories = []; compras = []; movimientos = []; activeTab = 'pedidos'; renderTab();
  window.__n = []; window.accionPrueba = function (...a) { window.__n.push(a); };
};

(async () => {
  const sE = arrancar(8093, true), sN = arrancar(8094, false);
  const apagar = () => { try { sE.kill(); sN.kill(); } catch (_) {} };
  process.on('exit', apagar);
  if (!(await esperar(8093)) || !(await esperar(8094))) { console.error('No arrancaron los servidores de prueba'); apagar(); process.exit(1); }
  const nav = await chromium.launch(require('./_lanzar-navegador')());

  // ═══ A · POLÍTICA ESTRICTA ═══
  let { ctx, p, viol, errs, dialogos } = await cargar(nav, 8093, () => { try { localStorage.setItem('inventarioApp_theme', 'light'); } catch (e) {} });
  const pol = await p.evaluate(() => (document.querySelector('meta[http-equiv="Content-Security-Policy"]').getAttribute('content').match(/script-src([^;]*)/) || [])[1]);
  chk('(preparación) la política servida NO tiene \'unsafe-inline\' en script-src y lleva hashes', !/'unsafe-inline'/.test(pol) && (pol.match(/'sha256-/g) || []).length === 4, pol);
  chk('★ El navegador NO bloqueó ningún <script> en línea de la página (los 4 hashes son los de scripts reales)', !viol.some(v => /inline script/i.test(v)), viol.join(' | '));
  const est = await p.evaluate(() => ({ tema: document.documentElement.getAttribute('data-theme'), marca: localStorage.getItem('inventarioApp_temaMarca'), modo: CspDespachador.modo(),
                                         config: typeof ENTORNO !== 'undefined', sw: typeof navigator.serviceWorker !== 'undefined' }));
  chk('★ El script del TEMA (el primero, antes de pintar) sí corrió: un tema claro sin marca pasó a oscuro', est.tema === 'dark' && est.marca === 'ultra-pro', JSON.stringify(est));
  chk('★ El bloque de configuración de Firebase y entornos sí corrió', est.config);
  chk('★ El despachador detecta que los manejadores en línea están prohibidos y pasa a «activo»', est.modo === 'activo', est.modo);
  chk('Sin errores de JavaScript al cargar', errs.length === 0, errs.join(' | '));

  await p.evaluate(MONTAR); await p.waitForTimeout(300);
  await p.click('#psHistorialBtn'); await p.waitForTimeout(300);
  chk('★ Un botón con onclick en línea (Pedidos → «Pedidos generados») FUNCIONA bajo la política estricta: lo ejecuta el despachador',
      await p.evaluate(() => typeof activeTab !== 'undefined' && !!document.querySelector('#tabContent') && /Historial|Pedidos/.test(document.querySelector('#tabContent').innerText) && !document.getElementById('psHistorialBtn')));
  // teclado
  await p.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<div id="tk" role="button" tabindex="0" data-activar-teclado onclick="accionPrueba(\'tarjeta\')" style="position:fixed;top:0;left:0;width:50px;height:50px">t</div><input id="ti" data-enter-click="#tb"><button id="tb" onclick="accionPrueba(\'guardar\')">g</button>'); });
  await p.focus('#tk'); await p.keyboard.press('Enter'); await p.keyboard.press(' ');
  await p.focus('#ti'); await p.keyboard.press('Enter');
  chk('★ El teclado funciona sin onkeydown en línea: Enter y Espacio activan la tarjeta (data-activar-teclado) y Enter en el campo pulsa «Guardar»',
      JSON.stringify(await p.evaluate(() => window.__n)) === JSON.stringify([['tarjeta'], ['tarjeta'], ['guardar']]), JSON.stringify(await p.evaluate(() => window.__n)));
  // argumentos: this.value
  await p.evaluate(() => { window.__n = []; document.body.insertAdjacentHTML('beforeend', '<input id="tv" value="5" onchange="accionPrueba(\'cant\', this.value)">'); });
  await p.fill('#tv', '7'); await p.press('#tv', 'Tab');
  chk('onchange con this.value llega con el valor escrito', JSON.stringify(await p.evaluate(() => window.__n)) === JSON.stringify([['cant', '7']]), JSON.stringify(await p.evaluate(() => window.__n)));

  // orden de propagación: igual que un onclick en línea (regresión: el ⋮ del Recetario abría además la ficha de la tarjeta)
  await p.evaluate(() => {
    window.__n = [];
    document.body.insertAdjacentHTML('beforeend',
      '<div id="pc" onclick="accionPrueba(\'padre-captura\')"><button id="hc" onclick="accionPrueba(\'hijo-captura\')">x</button></div>' +
      '<div id="pb" onclick="accionPrueba(\'padre-contenedor\')"><div id="cont"><button id="hb" onclick="accionPrueba(\'hijo-contenedor\')">y</button></div></div>' +
      '<div id="pn" onclick="accionPrueba(\'padre-nb\')"><input id="hn" onchange="accionPrueba(\'hijo-nb\')"></div>');
    // (1) oyente en CAPTURA del document que detiene la propagación solo para #hc: ningún onclick (ni el del botón) debe correr
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#hc')) e.stopPropagation(); }, true);
    // (2) oyente de burbuja en un contenedor intermedio: el botón (más abajo) SÍ corre, el padre (más arriba) NO
    document.getElementById('cont').addEventListener('click', (e) => e.stopPropagation());
  });
  await p.evaluate(() => document.getElementById('hc').click());
  const o1 = await p.evaluate(() => window.__n.slice()); await p.evaluate(() => { window.__n = []; });
  await p.evaluate(() => document.getElementById('hb').click());
  const o2 = await p.evaluate(() => window.__n.slice()); await p.evaluate(() => { window.__n = []; });
  await p.evaluate(() => document.getElementById('hn').dispatchEvent(new Event('change', { bubbles: false })));
  const o3 = await p.evaluate(() => window.__n.slice()); await p.evaluate(() => { window.__n = []; });
  chk('★ Si un oyente en captura detiene el clic, NO corre ningún onclick en línea (ni el del padre ni el del hijo), como en el navegador', o1.length === 0, JSON.stringify(o1));
  chk('★ Si un contenedor intermedio detiene la subida, el onclick del hijo corre y el del padre NO', JSON.stringify(o2) === JSON.stringify([['hijo-contenedor']]), JSON.stringify(o2));
  chk('★ Un evento que NO burbujea llega al onchange del propio elemento pero no al del padre', JSON.stringify(o3) === JSON.stringify([['hijo-nb']]), JSON.stringify(o3));

  // ── Inyección de HTML: lo que el CSP estricto DEBE impedir ──
  await p.evaluate(() => {
    window.__pwn = []; window.__n = [];
    document.body.insertAdjacentHTML('beforeend',
      '<img id="x1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onerror="window.__pwn.push(1)" onload="window.__pwn.push(11)">' +
      '<button id="x2" onclick="window.__pwn.push(2)">a</button>' +
      '<button id="x3" onclick="eval(\'window.__pwn.push(3)\')">b</button>' +
      '<button id="x4" onclick="alert(4)">c</button>' +
      '<button id="x5" onclick="window.__pwn.push(5); accionPrueba(\'x\')">d</button>' +
      '<button id="x6" onclick="fetch(\'/x\')">e</button>' +
      '<svg onload="window.__pwn.push(6)"></svg><input id="x7" autofocus onfocus="window.__pwn.push(7)">' +
      '<a id="x8" href="javascript:window.__pwn.push(8)">f</a>');
    const s = document.createElement('script'); s.textContent = 'window.__pwn.push(9)'; document.body.appendChild(s);
  });
  for (const id of ['x2', 'x3', 'x4', 'x5', 'x6']) await p.click('#' + id);
  await p.click('#x8').catch(() => {}); await p.waitForTimeout(400);
  const pwn = await p.evaluate(() => ({ pwn: window.__pwn, n: window.__n }));
  chk('★ INYECCIÓN: ni onerror/onload/onfocus (automáticos), ni onclick con código, eval, alert, fetch o asignaciones, ni javascript:, ni un <script> inyectado se ejecutan',
      pwn.pwn.length === 0 && pwn.n.length === 0 && dialogos.length === 0, JSON.stringify({ pwn: pwn.pwn, n: pwn.n, dialogos }));
  chk('El navegador sí registró los bloqueos (señal de que la política está actuando, no de que la prueba no hizo nada)', viol.length >= 3, String(viol.length));
  await ctx.close();

  // ═══ B · POLÍTICA ACTUAL (con 'unsafe-inline'): «sombra», nada se ejecuta dos veces ═══
  ({ ctx, p, viol, errs, dialogos } = await cargar(nav, 8094));
  const sombra = await p.evaluate(() => CspDespachador.modo());
  chk('★ Con la política de hoy el despachador queda en «sombra»', sombra === 'sombra', sombra);
  await p.evaluate(MONTAR); await p.waitForTimeout(250);
  await p.evaluate(() => { window.__n = []; document.body.insertAdjacentHTML('beforeend', '<button id="b1" onclick="accionPrueba(\'uno\')">1</button><div id="tk" role="button" tabindex="0" data-activar-teclado onclick="accionPrueba(\'tec\')" style="position:fixed;top:0;left:0;width:50px;height:50px">t</div>'); });
  await p.click('#b1'); await p.focus('#tk'); await p.keyboard.press('Enter');
  chk('★ En «sombra» cada manejador se ejecuta UNA sola vez (lo hace el navegador; el despachador no duplica) — también por teclado', JSON.stringify(await p.evaluate(() => window.__n)) === JSON.stringify([['uno'], ['tec']]), JSON.stringify(await p.evaluate(() => window.__n)));
  const tel = await p.evaluate(() => CspDespachador.resumen());
  chk('La «sombra» anotó los manejadores revisados y NINGÚN fallo (n > 0, sin «fallos»)', tel.n > 0 && !tel.fallos, JSON.stringify(tel));
  chk('Sin violaciones de CSP ni errores con la política actual', viol.length === 0 && errs.length === 0, viol.concat(errs).join(' | '));
  await ctx.close();

  await nav.close(); apagar();
  const fallos = C.filter(c => !c.ok);
  C.forEach(c => console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  ← ' + c.d)));
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
  process.exit(fallos.length ? 1 : 0);
})();
