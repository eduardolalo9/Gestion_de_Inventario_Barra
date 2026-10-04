// Recetario — mismo buscador que Inicio: humo en la app real (Chromium).
//
// Lo que esta prueba demuestra EJECUTANDO (no leyendo código), igual que
// prueba-fase6-navegador.js lo demuestra para Inicio/Pedidos/Historia:
//   · tolera un typo en el nombre ("margarta" → MARGARITA),
//   · encuentra sin tildes (categoría "Café" con "cafe"),
//   · un PV completo (código) encuentra exactamente esa receta,
//   · resalta las coincidencias con <mark>,
//   · pagina por tandas de 60 con "Mostrar N más" (antes pintaba TODO de golpe),
//   · navegación con flechas + Enter abre la ficha de la receta activa,
//   · sin búsqueda, la lista queda alfabética por nombre.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

function receta(i, nombre, categoria, pv) {
    return {
        id: 'r' + i, nombre, categoria, pv, activa: true,
        ingredientes: [{ productoId: '1180001', cantidad: 10, uom: 'ml' }],
        _v: 1
    };
}

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

  // ── 65 recetas (para forzar la paginación por tandas de 60) ─────────────
  await p.evaluate(({ recetasBase }) => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = [{ id: '1180001', name: 'TEQUILA 1800 ANEJO 700 ML', group: 'TEQUILA', unit: 'Botellas', precio: 350, conversion: 700 }];
    recetas = recetasBase;
    activeTab = 'recetario'; renderTab();
  }, {
    recetasBase: (function () {
        var lista = [];
        for (var i = 0; i < 63; i++) lista.push({ id: 'g' + i, nombre: 'GENÉRICO ' + String(i).padStart(2, '0'), categoria: 'Genéricos', activa: true, ingredientes: [{ productoId: '1180001', cantidad: 10, uom: 'ml' }], _v: 1 });
        lista.push({ id: 'marg', nombre: 'MARGARITA', categoria: 'Cócteles', pv: 'PVB1000777', activa: true, ingredientes: [{ productoId: '1180001', cantidad: 45, uom: 'ml' }], _v: 1 });
        lista.push({ id: 'cafe', nombre: 'CAFÉ IRLANDÉS', categoria: 'Café', activa: true, ingredientes: [{ productoId: '1180001', cantidad: 20, uom: 'ml' }], _v: 1 });
        return lista;
    })()
  });
  await p.waitForTimeout(200);

  // ── La barra compartida existe (misma barra que Inicio) ─────────────────
  const barra = await p.evaluate(() => !!document.getElementById('sbx-input-recetario'));
  chk('★ El Recetario pinta la misma barra de búsqueda compartida (sbx-input-recetario existe)', barra, '');

  // ── Sin búsqueda: 65 recetas, paginadas a 60, orden alfabético ──────────
  const inicial = await p.evaluate(() => ({
      n: document.querySelectorAll('#sbx-res-recetario [data-sbx-item]').length,
      masTexto: (document.querySelector('[data-sbx-mas="recetario"] button') || {}).textContent || '',
      primerNombre: (document.querySelector('#sbx-res-recetario [data-sbx-item] p') || {}).textContent || ''
  }));
  chk('★ Sin búsqueda, pagina a 60 (no pinta las 65 de golpe) — igual que el catálogo de Inicio',
      inicial.n === 60, JSON.stringify(inicial));
  chk('El botón "Mostrar N más" ofrece las 5 restantes', /5 restantes/.test(inicial.masTexto), inicial.masTexto);
  chk('Sin búsqueda, la lista es alfabética por nombre (CAFÉ IRLANDÉS va antes que GENÉRICO)',
      inicial.primerNombre.indexOf('CAFÉ') === 0, inicial.primerNombre);
  await p.click('[data-sbx-accion="mas"][data-sbx-key="recetario"]');
  await p.waitForTimeout(150);
  chk('"Mostrar más" revela el resto (las 65)',
      await p.evaluate(() => document.querySelectorAll('#sbx-res-recetario [data-sbx-item]').length === 65), '');

  const buscar = async (q) => {
    await p.fill('#sbx-input-recetario', q); await p.waitForTimeout(320);
    return p.evaluate(() => ({
      // El primer <p> de cada tarjeta es el nombre (los demás son categoría,
      // conteo de insumos y costo) — un <p> por card, no todos.
      nombres: [...document.querySelectorAll('#sbx-res-recetario [data-sbx-item]')].map(card => (card.querySelector('p') || {}).textContent || ''),
      html: document.getElementById('sbx-res-recetario').innerHTML
    }));
  };

  // ── Typo tolerado (mismo motor difuso que Inicio) ───────────────────────
  let r = await buscar('margarta');
  chk('★ Tolera el typo "margarta" → MARGARITA (mismo motor difuso de Inicio)',
      r.nombres.length === 1 && /MARGARITA/.test(r.nombres[0]), r.nombres.join('|'));
  // ── Resaltado (con la palabra exacta, no el typo — el resaltado marca
  //    coincidencias exactas; el typo pasa por el respaldo difuso, igual
  //    que en Inicio: ver prueba-fase6-navegador.js, "reposdo" vs "amp") ──
  r = await buscar('margarita');
  chk('Resalta la coincidencia con <mark> (mismo resaltado que Inicio)',
      /<mark class="sb-mark">Margarita<\/mark>/i.test(r.html), r.html.slice(0, 200));

  // ── Sin tildes encuentra con tilde (categoría) ───────────────────────────
  r = await buscar('cafe irlandes');
  chk('★ Sin tildes encuentra "CAFÉ IRLANDÉS" (normalización diacrítica del motor compartido)',
      r.nombres.length === 1 && /CAFÉ IRLANDÉS/.test(r.nombres[0]), r.nombres.join('|'));

  // ── El PV (código) encuentra exactamente esa receta ──────────────────────
  r = await buscar('PVB1000777');
  chk('★ El código (PV) completo encuentra exactamente la receta importada que lo trae',
      r.nombres.length === 1 && /MARGARITA/.test(r.nombres[0]), r.nombres.join('|'));

  // ── Sin resultados: estado compartido, con botón de limpiar ─────────────
  r = await buscar('zzqqxx');
  chk('Sin resultados, usa el mismo estado vacío profesional que Inicio ("No se encontró…")',
      !r.nombres.length, '');
  const vacioHtml = await p.evaluate(() => document.getElementById('sbx-res-recetario').innerHTML);
  chk('El estado vacío ofrece "Limpiar búsqueda"', /Limpiar búsqueda/.test(vacioHtml), '');
  await p.click('#sbx-res-recetario [data-sbx-accion="limpiar"]');
  await p.waitForTimeout(150);

  // ── Teclado: ↓↓ resalta, Enter abre la ficha ─────────────────────────────
  await p.fill('#sbx-input-recetario', 'margarta');
  await p.waitForTimeout(320);
  await p.focus('#sbx-input-recetario');
  await p.keyboard.press('ArrowDown');
  const activo = await p.evaluate(() => {
      const its = [...document.querySelectorAll('#sbx-res-recetario [data-sbx-item]')];
      return its.findIndex(e => e.classList.contains('sbx-activo'));
  });
  chk('↓ resalta el único resultado (navegación con teclado igual que Inicio)', activo === 0, String(activo));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  chk('★ Enter sobre el resultado activo abre la ficha de esa receta (data-sbx-item = la tarjeta completa)',
      await p.evaluate(() => recetarioView === 'ficha' && recetarioFichaId === 'marg'), await p.evaluate(() => recetarioView + '/' + recetarioFichaId));

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── Recetario · buscador unificado (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})();
