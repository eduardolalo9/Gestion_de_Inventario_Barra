// Prueba de regresión M2a — guarda de monotonía y guarda de sesión.
// Reproduce el caso EXACTO observado en producción el 2026-09-06.
const { chromium, devices } = require('playwright');

const CASOS = [];
function chk(n, ok, det) { CASOS.push({n, ok, det}); }

(async () => {
  const nav = await chromium.launch({ headless: true });
  const ctx = await nav.newContext({ ...devices['Pixel 5'], viewport:{width:390,height:844} });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0,160)));
  await p.goto('file://' + require('path').resolve(__dirname,'..','index.html') + '', { waitUntil:'load' });
  await p.waitForTimeout(1500);

  chk('La página carga sin errores de JavaScript', errs.length===0, errs.join(' | '));

  const existe = await p.evaluate(() => ({
    haySesion: typeof _haySesionFirebase,
    esperar:   typeof _esperarSesion,
    handler:   typeof handleAuditSessionChange,
  }));
  chk('_haySesionFirebase existe', existe.haySesion==='function', existe.haySesion);
  chk('_esperarSesion existe',     existe.esperar==='function',   existe.esperar);

  // ── CASO 1: el bug real. Sesión vigente 31-ago, llega un doc rezagado 30-ago.
  const c1 = await p.evaluate(() => {
    _suscribirInventarioActivo = function(){};           // aislar de Firestore
    _auditoriaSessionId = '1788197472538';               // 31-ago (vigente)
    myAuditoriaConteo   = { 'prod-1|almacen': { enteras: 7, abiertas: [0.5] } };
    const r = handleAuditSessionChange('1788115846917', 'prueba_regresion', null, null); // 30-ago
    return { resultado: r,
             conteoSobrevive: JSON.stringify(myAuditoriaConteo),
             sesionVigente: _auditoriaSessionId };
  });
  chk('Un sessionId ANTERIOR se rechaza',
      c1.resultado.motivo === 'sessionId_retrocede', JSON.stringify(c1.resultado));
  chk('El conteo del bartender NO se borra',
      c1.conteoSobrevive.includes('"enteras":7'), c1.conteoSobrevive);
  chk('La sesión vigente no retrocede',
      c1.sesionVigente === '1788197472538', c1.sesionVigente);

  // ── CASO 2: no romper el reset legítimo. Llega una sesión MÁS NUEVA.
  const c2 = await p.evaluate(() => {
    _suscribirInventarioActivo = function(){};
    _auditoriaSessionId = '1788197472538';
    myAuditoriaConteo   = { 'prod-1|almacen': { enteras: 7, abiertas: [0.5] } };
    const r = handleAuditSessionChange('1788300000000', 'prueba_regresion', null, null); // más nueva
    return { resultado: r, conteo: JSON.stringify(myAuditoriaConteo), sesion: _auditoriaSessionId };
  });
  chk('Un sessionId POSTERIOR sí resetea (no rompimos la función)',
      c2.resultado.procesado === true && c2.resultado.reseteo === true, JSON.stringify(c2.resultado));
  chk('Tras un reset legítimo el conteo sí se limpia',
      c2.conteo === '{}', c2.conteo);
  chk('Tras un reset legítimo la sesión avanza',
      c2.sesion === '1788300000000', c2.sesion);

  // ── CASO 3: idempotencia intacta (mismo id).
  const c3 = await p.evaluate(() => {
    _auditoriaSessionId = '1788197472538';
    return handleAuditSessionChange('1788197472538', 'prueba_regresion', null, null);
  });
  chk('El mismo sessionId sigue sin reprocesarse',
      c3.motivo === 'sin_cambio', JSON.stringify(c3));

  // ── CASO 4: la guarda de sesión evita la tormenta de arranque.
  const c4 = await p.evaluate(async () => {
    window._auth = { currentUser: null };
    _db = _db || {};                      // simular Firebase configurado
    _cloudSyncPending = false;
    const t0 = performance.now();
    await syncToCloud();
    return { ms: Math.round(performance.now()-t0), pendiente: _cloudSyncPending };
  });
  chk('syncToCloud sin sesión no toca la red y marca pendiente',
      c4.pendiente === true && c4.ms < 50, JSON.stringify(c4));

  const c5 = await p.evaluate(async () => {
    window._auth = { currentUser: null };
    let llamo = false;
    const orig = _db; _db = { collection(){ llamo = true; throw new Error('no deberia llegar aqui'); } };
    await loadFromCloud();
    await loadConteoPorUsuarioFromFirestore();
    await loadConflictosDesdeFirestore();
    _db = orig;
    return { llamo };
  });
  chk('Las 3 cargas de arranque no consultan Firestore sin sesión', c5.llamo === false, JSON.stringify(c5));

  await nav.close();

  const anchoN = Math.max(...CASOS.map(c=>c.n.length));
  CASOS.forEach(c => console.log(`  ${c.ok?'✅':'❌'}  ${c.n.padEnd(anchoN)}   ${c.ok?'':'← '+c.det}`));
  const mal = CASOS.filter(c=>!c.ok).length;
  console.log(`\n  ${CASOS.length} pruebas · ${CASOS.length-mal} pasaron · ${mal} fallaron`);
  process.exit(mal ? 1 : 0);
})();
