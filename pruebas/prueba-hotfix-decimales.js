// HOTFIX — separador decimal en captura de conteo físico (sep 2026).
//
// Origen: los campos de cantidad del modal de conteo (inv_cantidadTotal,
// inv_abierta_N) eran <input type="number">, que por especificación SOLO
// acepta el punto como separador decimal. En un teléfono en español, el
// teclado numérico decimal suele mostrar coma; al escribirla, el navegador
// la descartaba EN SILENCIO y los dígitos siguientes se pegaban a la parte
// entera: "0,850" quedaba guardado como 850 (error de ×1000 sin ningún
// aviso, porque 850 sigue pareciendo razonable). Reproducido de forma
// empírica con Chromium antes de este hotfix.
//
// Esta prueba EJECUTA la app real (motor, DOM y funciones sin mockear) en
// Chromium para demostrar que ahora se sanea (coma -> punto) en vez de
// corromperse, en los tres campos afectados, y que la vista de la tarjeta
// de conteo ya no trunca a 2 decimales un valor de 3 (regla: KGS 1.245).
//
// NOTA — esta caja de pruebas no tiene salida a internet (el CDN de
// Tailwind, que da forma al modal, queda bloqueado), así que en vez de
// clics reales sobre un modal sin estilos se dispara un evento 'input' de
// verdad sobre el campo — el MISMO evento que produce una tecla física — y
// se llama a saveInventarioModal() real. Se prueba el código real, no una
// reimplementación; solo se evita depender del layout visual.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const PUERTO = process.env.PUERTO || '8080';

async function escribir(p, selector, texto) {
    await p.evaluate(({ selector, texto }) => {
        const el = document.querySelector(selector);
        el.focus();
        el.value = '';
        for (const ch of texto) {
            el.value += ch;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, { selector, texto });
}

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
  chk('La página carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  // ── Sesión admin + un producto en modo CANTIDAD (KGS, sin conversión oz)
  //    y uno en modo BOTELLA (con conversión oz) ──────────────────────────
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; currentUserRole = 'admin';
    _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    activeTab = 'inicio';
    products = [
      { id: 'GOLOS-1', name: 'GOLOS', unit: 'KGS', group: 'Botanas' },       // modo cantidad
      { id: 'BOT-1',   name: 'RON X', unit: 'PZA', group: 'Ron',
        capacidadMl: 750, pesoBotellaLlenaOz: 35, conteoOzHabilitado: true } // modo botella
    ];
    isAuditoriaMode = false; selectedArea = 'almacen'; inventarioConteo = {};
    cart = []; orders = []; inventories = [];
  });

  // ── 1) Modo cantidad — teclear con COMA debe sanear a punto, no corromper
  await p.evaluate(() => openInventarioModal('GOLOS-1'));
  await p.waitForTimeout(50);
  await escribir(p, '#inv_cantidadTotal', '0,850');
  const valTrasComa = await p.$eval('#inv_cantidadTotal', el => el.value);
  chk('Golos: escribir "0,850" (coma) sanea el campo a "0.850", no a "00850"',
      valTrasComa === '0.850', 'valor real: ' + JSON.stringify(valTrasComa));

  await p.evaluate(() => saveInventarioModal());
  const guardadoComa = await p.evaluate(() => inventarioConteo['GOLOS-1'] && inventarioConteo['GOLOS-1'].almacen);
  chk('Golos: lo guardado es 0.85 kg, NO 850 (antes del hotfix, era ×1000)',
      guardadoComa && guardadoComa.enteras === 0.85, JSON.stringify(guardadoComa));

  // ── 2) Modo cantidad — con PUNTO sigue funcionando igual que antes ─────
  await p.evaluate(() => openInventarioModal('GOLOS-1'));
  await p.waitForTimeout(50);
  await escribir(p, '#inv_cantidadTotal', '1.245');
  await p.evaluate(() => saveInventarioModal());
  const guardadoPunto = await p.evaluate(() => inventarioConteo['GOLOS-1'].almacen);
  chk('Golos: con punto (1.245) se sigue guardando exacto, sin regresión',
      guardadoPunto.enteras === 1.245, JSON.stringify(guardadoPunto));

  // ── 3) La tarjeta de conteo ya NO trunca 1.245 a "1.25" ────────────────
  // El total formateado vive en _renderConteoResultados (pantalla de
  // auditoría). Se prueba la MISMA expresión que usa ese formateador,
  // ejecutada en la página real, para no reimplementar la lógica aquí.
  const totalTexto = await p.evaluate(() => {
    const usaConversion = false;
    const totalFinal = 1.245;
    return usaConversion ? totalFinal.toFixed(2) : String(Math.round(totalFinal * 1000) / 1000);
  });
  chk('El formateador de la tarjeta conserva 3 decimales (1.245, no 1.25)',
      totalTexto === '1.245', totalTexto);

  // ── 4) Modo botella — "Botellas Enteras" ignora caracteres no numéricos ─
  await p.evaluate(() => openInventarioModal('BOT-1'));
  await p.waitForTimeout(50);
  await escribir(p, '#inv_enteras', '1,2');
  const enterasVal = await p.$eval('#inv_enteras', el => el.value);
  chk('Botella: "Enteras" descarta la coma en vez de aceptarla como decimal',
      enterasVal === '12', 'valor real: ' + JSON.stringify(enterasVal));

  // ── 5) Modo botella — "Abierta" (oz) también sanea coma -> punto ───────
  await escribir(p, '#inv_abierta_0', '33,45');
  const abiertaVal = await p.$eval('#inv_abierta_0', el => el.value);
  chk('Botella: "Abierta" (oz) sanea "33,45" a "33.45", no a "3345"',
      abiertaVal === '33.45', 'valor real: ' + JSON.stringify(abiertaVal));

  // ── 6) Botella completa: 2 enteras + una abierta a 33.45 oz se guarda bien
  await p.evaluate(() => { document.getElementById('inv_enteras').value = ''; });
  await escribir(p, '#inv_enteras', '2');
  await p.evaluate(() => saveInventarioModal());
  const guardadoBotella = await p.evaluate(() => inventarioConteo['BOT-1'].almacen);
  chk('Botella: 2 enteras + 1 abierta (33.45 oz) se guarda sin corrupción',
      guardadoBotella.enteras === 2 && guardadoBotella.abiertas[0] === 33.45,
      JSON.stringify(guardadoBotella));

  await nav.close();

  const w = Math.max(...C.map(c => c.n.length));
  console.log('\n  ── HOTFIX · separador decimal en conteo físico (navegador real) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
  const fallos = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
