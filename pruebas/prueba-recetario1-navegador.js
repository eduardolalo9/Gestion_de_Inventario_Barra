// RECETARIO-1 — pestaña, editor, costeo y permisos, ejecutados en Chromium
// contra la app real (sin mockear el módulo).
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

  // ── Arranque como ADMIN, con dos productos en el catálogo ──────────────
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = [
      { id: '1180001', name: 'TEQUILA 1800 ANEJO 700 ML', group: 'TEQUILA', unit: 'Botellas', precio: 350, conversion: 700 },
      { id: '1100017', name: 'JUGO DE PINA 1 LT', group: 'ABARROTES', unit: 'Litros', precio: 30, conversion: 1000 },
      { id: '2000099', name: 'INSUMO SIN COSTO', group: 'OTROS', unit: 'PZA' }
    ];
    recetas = [];
    activeTab = 'recetario'; renderTab();
  });
  await p.waitForTimeout(200);

  // ── Header y estado vacío ───────────────────────────────────────────────
  const vacio = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('Con recipe.edit, el header ofrece "Nueva receta" y "Publicar recetario"',
      await p.evaluate(() => !!document.querySelector('[onclick="openRecetaModal()"]') && !!document.querySelector('[onclick="publicarRecetarioFirestore()"]')), '');
  chk('Sin recetas, la lista lo dice y ofrece agregar la primera', /Aún no hay recetas/.test(vacio) && /Agrega la primera/.test(vacio), vacio.slice(0, 120));

  // ── Crear una receta con dos ingredientes ──────────────────────────────
  await p.evaluate(() => openRecetaModal());
  chk('El modal de receta abre', await p.evaluate(() => !document.getElementById('recetaModal').classList.contains('hidden')), '');
  await p.fill('#recetaNombre', 'MARGARITA');
  await p.fill('#recetaCategoria', 'Cocteles');

  // Línea 1: tequila, 45 ml
  await p.evaluate(() => {
    const lineas = document.querySelectorAll('#recetaIngredientesLista input[list]');
    lineas[0].value = '1180001 — TEQUILA 1800 ANEJO 700 ML';
    lineas[0].dispatchEvent(new Event('change'));
    const cants = document.querySelectorAll('#recetaIngredientesLista input[type=number]');
    cants[0].value = '45'; cants[0].dispatchEvent(new Event('change'));
    // FASE 11A — la unidad es parte de la receta: "45" sin unidad significaría
    // 45 botellas, no 45 ml. Se escribe como lo haría una persona.
    const uoms = document.querySelectorAll('#recetaIngredientesLista input[placeholder^="ml"]');
    uoms[0].value = 'ml'; uoms[0].dispatchEvent(new Event('change'));
  });
  // Línea 2: agrega una fila y captura jugo de piña, 30 ml
  await p.evaluate(() => _recetaAgregarIngrediente());
  await p.evaluate(() => {
    const lineas = document.querySelectorAll('#recetaIngredientesLista input[list]');
    lineas[1].value = '1100017 — JUGO DE PINA 1 LT';
    lineas[1].dispatchEvent(new Event('change'));
    const cants = document.querySelectorAll('#recetaIngredientesLista input[type=number]');
    cants[1].value = '30'; cants[1].dispatchEvent(new Event('change'));
    const uoms = document.querySelectorAll('#recetaIngredientesLista input[placeholder^="ml"]');
    uoms[1].value = 'ml'; uoms[1].dispatchEvent(new Event('change'));
  });
  await p.evaluate(() => saveRecetaModal());
  await p.waitForTimeout(150);
  chk('Guardar cierra el modal', await p.evaluate(() => document.getElementById('recetaModal').classList.contains('hidden')), '');
  chk('La receta queda en el arreglo local con sus dos ingredientes',
      await p.evaluate(() => recetas.length === 1 && recetas[0].nombre === 'MARGARITA' && recetas[0].ingredientes.length === 2), '');

  // ── Costeo: 45ml×(350/700) + 30ml×(30/1000) = 22.50 + 0.90 = 23.40 ──────
  const costoEsperado = 45 * (350 / 700) + 30 * (30 / 1000);
  chk('costoReceta calcula el costo real de la receta (conversion, no capacidadMl)',
      await p.evaluate((esperado) => Math.abs(costoReceta(recetas[0]).costo - esperado) < 0.001, costoEsperado), '');

  const listaTxt = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('La tarjeta de la lista muestra el nombre y el costo (admin con recipe.edit)',
      /MARGARITA/.test(listaTxt) && /\$23\.40/.test(listaTxt), listaTxt.slice(0, 200));

  // ── Ficha: abrir, ver desglose, insumo sin costo avisa "incompleto" ─────
  await p.evaluate(() => _recetarioAbrirFicha(recetas[0].id));
  await p.waitForTimeout(100);
  let ficha = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('La ficha muestra los dos ingredientes con su costo por línea',
      /TEQUILA 1800 ANEJO/.test(ficha) && /JUGO DE PINA/.test(ficha) && /\$22\.50/.test(ficha) && /\$0\.90/.test(ficha), ficha.slice(0, 300));
  chk('La ficha muestra el costo total por porción', /Costo por porción/.test(ficha) && /\$23\.40/.test(ficha), '');

  await p.evaluate(() => {
    recetas[0].ingredientes.push({ productoId: '2000099', cantidad: 1, uom: 'PZA' });
    renderTab();
  });
  await p.waitForTimeout(100);
  ficha = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('★ Un insumo sin costo marca la receta como "incompleto" — nunca un total parcial disfrazado de total',
      /Incompleto/.test(ficha) && /INSUMO SIN COSTO/.test(ficha), ficha.slice(0, 300));
  await p.evaluate(() => { recetas[0].ingredientes.pop(); renderTab(); });

  // ── Desactivar / activar ────────────────────────────────────────────────
  await p.evaluate(() => toggleRecetaActiva(recetas[0].id));
  await p.waitForTimeout(100);
  chk('Desactivar marca la receta como inactiva', await p.evaluate(() => recetas[0].activa === false), '');
  ficha = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('La ficha ofrece "Activar" cuando está inactiva', /Activar/.test(ficha), '');
  await p.evaluate(() => toggleRecetaActiva(recetas[0].id));

  // ── Búsqueda en la lista ────────────────────────────────────────────────
  await p.evaluate(() => _recetarioVolverALista());
  await p.evaluate(() => updateRecetarioSearch('no existe'));
  await p.waitForTimeout(80);
  chk('Buscar algo que no existe muestra "Sin resultados"',
      /Sin resultados/.test(await p.evaluate(() => document.getElementById('tabContent').innerText)), '');
  await p.evaluate(() => clearRecetarioSearch());

  // ── Sin recipe.edit: solo lectura, sin costo, sin botones de escritura ──
  await p.evaluate(() => {
    _authzState.permissions = new Set(['recipe.read']);
    activeTab = 'recetario'; updateHeaderActions(); renderTab();
  });
  await p.waitForTimeout(100);
  chk('Sin recipe.edit, el header dice "Solo lectura" y no ofrece Nueva receta / Publicar',
      await p.evaluate(() => !document.querySelector('[onclick="openRecetaModal()"]') && !document.querySelector('[onclick="publicarRecetarioFirestore()"]') &&
          /Solo lectura/.test(document.getElementById('headerActions').innerText)), '');
  const listaSoloLectura = await p.evaluate(() => document.getElementById('tabContent').innerText);
  chk('Sin recipe.edit, la tarjeta muestra el nombre pero NO el costo (bartender no ve costos)',
      /MARGARITA/.test(listaSoloLectura) && !/\$23\.40/.test(listaSoloLectura), listaSoloLectura.slice(0, 200));

  // ── Sin recipe.read: bloqueado del todo ──────────────────────────────────
  await p.evaluate(() => { _authzState.permissions = new Set([]); renderTab(); });
  await p.waitForTimeout(80);
  chk('Sin recipe.read, la pestaña muestra el candado en vez del recetario',
      /No tienes acceso al recetario/.test(await p.evaluate(() => document.getElementById('tabContent').innerText)), '');

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── RECETARIO-1 (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
