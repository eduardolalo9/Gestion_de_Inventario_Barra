// REDISEÑO R3 en la app real (Chromium): la pantalla de Inicio con el sistema
// nuevo, conservando TODO su contenido.
//
// Decisión de Eduardo (2-oct-2026): "Inicio sigue listando los 431 productos,
// como hoy". Así que esta prueba vigila las dos mitades del trato:
//   · que el aspecto sea el del sistema (monograma, cifra en mono a la
//     derecha, badges del kit, acciones al pie, 44 px táctiles);
//   · que no se haya perdido NADA de lo que Inicio hacía: panel, buscador,
//     rail de grupos, chips, botones de admin, los productos, la tarjeta de
//     sincronización y la de reportes.
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
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1100);
  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  // Catálogo de muestra con los casos que importan: nombre largo, producto con
  // conteo en onzas, producto bajo mínimo con y sin conversión.
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['*']);
    products = [
      { id: 'ACE', name: 'ACEITUNA SIN HUESO', group: 'ABARROTES', unit: 'KGS',
        stockMinimo: 3, conversion: 1, precio: 180, stockByArea: { almacen: 1.7, barra1: 0, barra2: 0 } },
      { id: 'DJ7', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'PZA',
        stockMinimo: 4, conversion: 700, capacidadMl: 700, pesoBotellaLlenaOz: 53.65,
        conteoOzHabilitado: true, precio: 1480, stockByArea: { almacen: 8, barra1: 0, barra2: 0 } },
      { id: 'LIM', name: 'LIMON CON SEMILLA', group: 'FRUTA Y VERDURA', unit: 'KGS',
        stockMinimo: 5, conversion: 1, precio: 32, stockByArea: { almacen: 8.5, barra1: 0, barra2: 0 } }
    ];
    allUsersAuditoria = {}; _inventarioActivo = null;
    cart = []; orders = [];
    activeTab = 'inicio'; selectedGroup = 'Todos'; searchTerm = '';
    renderTab();
  });
  await p.waitForTimeout(250);

  // ── A · No se perdió nada de lo que Inicio hacía ───────────────────────
  const partes = await p.evaluate(() => {
    const t = document.getElementById('tabContent');
    return {
      panel:      !!t.querySelector('#pm-panel, .pm-panel'),
      buscador:   !!t.querySelector('#sbx-input-catalogo, [id^="sbx-input"]'),
      rail:       t.querySelectorAll('.grp-pill').length,
      chips:      !!t.querySelector('[id^="sbx-chips"], .sbx-chip'),
      productos:  t.querySelectorAll('.prd-card').length,
      btnProducto: [...t.querySelectorAll('button')].some(b => /Producto/.test(b.textContent)),
      btnExcel:   [...t.querySelectorAll('button')].some(b => /Excel/.test(b.textContent)),
      btnBorrar:  [...t.querySelectorAll('button')].some(b => /Eliminar todos/.test(b.textContent)),
      sincro:     /sincronizaci/i.test(t.innerText),
      reportes:   /reportes publicados/i.test(t.innerText),
      centinela:  !!t.querySelector('[id^="sbx-centinela"], .sbx-centinela') || true
    };
  });
  chk('★ Inicio conserva el panel de indicadores', partes.panel, JSON.stringify(partes));
  chk('★ Conserva el buscador del catálogo', partes.buscador);
  chk('★ Conserva el rail de grupos y los chips de filtro', partes.rail >= 2 && partes.chips, 'grupos: ' + partes.rail);
  chk('★ Conserva la LISTA DE PRODUCTOS en Inicio (decisión de Eduardo)',
      partes.productos === 3, 'tarjetas: ' + partes.productos);
  // v5.18 — "Excel" (importaba sin validar) se mudó al módulo Importar desde Excel.
  chk('Conserva los botones de administración (Producto, Eliminar todos); "Excel" se mudó al módulo Importar',
      partes.btnProducto && !partes.btnExcel && partes.btnBorrar, JSON.stringify(partes));
  chk('Conserva la tarjeta de sincronización y la de reportes',
      partes.sincro && partes.reportes);

  // ── B · La tarjeta de producto, con el sistema ─────────────────────────
  const card = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.prd-card')].find(x => x.textContent.includes('DON JULIO 70'));
    if (!c) return { falta: true };
    const mono = c.querySelector('.bi-mono');
    const nombre = c.querySelector('.prd-card__name');
    const cifra = c.querySelector('.prd-card__cifra .bi-cifra');
    const acciones = c.querySelector('.prd-card__actions');
    const chips = c.querySelectorAll('.prd-area-chip');
    const cs = getComputedStyle(c);
    return {
      monoTexto: mono ? mono.textContent.trim() : null,
      monoFondo: mono ? getComputedStyle(mono).backgroundColor : null,
      nombreEsBoton: nombre ? nombre.tagName : null,
      fichaAttr: nombre ? nombre.getAttribute('data-pm-ficha') : null,
      cifraTexto: cifra ? cifra.textContent.trim() : null,
      cifraFuente: cifra ? getComputedStyle(cifra).fontFamily : null,
      // La cifra tiene que estar a la DERECHA del nombre, no debajo
      cifraALaDerecha: (cifra && nombre)
        ? cifra.getBoundingClientRect().left > nombre.getBoundingClientRect().right - 2 : null,
      accionesAlPie: (acciones && chips.length)
        ? acciones.getBoundingClientRect().top >= chips[0].getBoundingClientRect().top : null,
      botonesTactiles: acciones ? [...acciones.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 44) : null,
      chips: chips.length,
      fondo: cs.backgroundColor,
      sinEmoji: !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(c.innerText)
    };
  });
  chk('La tarjeta existe', !card.falta);
  chk('★ Lleva monograma de tres letras en vez de imagen', card.monoTexto === 'DJ7', 'monograma: ' + card.monoTexto);
  chk('El monograma tiene tinte por grupo (no transparente)',
      card.monoFondo && card.monoFondo !== 'rgba(0, 0, 0, 0)', card.monoFondo);
  chk('El nombre sigue siendo el botón que abre la ficha del producto',
      card.nombreEsBoton === 'BUTTON' && card.fichaAttr === 'DJ7', JSON.stringify(card));
  chk('★ La existencia va a la DERECHA del nombre, en mono tabular',
      card.cifraALaDerecha === true && /Plex Mono/.test(card.cifraFuente || ''),
      JSON.stringify({ derecha: card.cifraALaDerecha, fuente: card.cifraFuente, texto: card.cifraTexto }));
  chk('★ Las acciones bajan al pie (el nombre se queda con el ancho de arriba)',
      card.accionesAlPie === true);
  chk('★ Los botones de acción son táctiles (≥ 44 px de alto)', card.botonesTactiles === true);

  /**
   * ESTA COMPROBACIÓN NACE DE UN FALLO REAL DE R3.
   *
   * Al rehacer la tarjeta borré sin querer las reglas de .prd-action-btn. Los
   * tres botones —carrito, editar, eliminar— se quedaron con el fondo gris por
   * defecto del navegador y 16 px de ancho, y salían como tres ladrillos
   * blancos en cada una de las 431 tarjetas. Ninguna prueba lo vio: todas
   * comprobaban que los botones EXISTEN y que miden 44 de alto (los medían,
   * porque el contenedor los estiraba). Lo vio la captura de pantalla.
   *
   * Así que aquí no se pregunta si están: se pregunta si se VEN. Un botón sin
   * ancho o con el gris de fábrica del navegador es un botón sin estilo.
   */
  const aspectoBotones = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.prd-card')].find(x => x.textContent.includes('DON JULIO 70'));
    const bs = c ? [...c.querySelectorAll('.prd-card__actions button')] : [];
    return bs.map(b => {
      const cs = getComputedStyle(b), r = b.getBoundingClientRect();
      const svg = b.querySelector('svg');
      const sr = svg ? svg.getBoundingClientRect() : null;
      return { cls: b.className, w: Math.round(r.width), h: Math.round(r.height),
               bg: cs.backgroundColor, svgW: sr ? Math.round(sr.width) : 0 };
    });
  });
  // El gris de fábrica del botón sin estilar en Chromium.
  const GRIS_DE_FABRICA = /rgb\(239, 239, 239\)|buttonface/i;
  chk('★ Los tres botones de acción tienen ancho real (no colapsados a 16 px)',
      aspectoBotones.length === 3 && aspectoBotones.every(b => b.w >= 36),
      JSON.stringify(aspectoBotones));
  chk('★ Ningún botón de acción se quedó con el gris de fábrica del navegador',
      aspectoBotones.length === 3 && !aspectoBotones.some(b => GRIS_DE_FABRICA.test(b.bg)),
      'un botón con buttonface es un botón al que no le llegó ninguna regla: ' + JSON.stringify(aspectoBotones));
  chk('★ El icono de cada botón de acción tiene tamaño (no es un SVG de 0 px)',
      aspectoBotones.length === 3 && aspectoBotones.every(b => b.svgW >= 12),
      JSON.stringify(aspectoBotones));
  chk('Conserva los tres chips de área', card.chips === 3, 'chips: ' + card.chips);
  chk('★ La tarjeta ya no usa emoji como iconografía',
      card.sinEmoji === true, 'quedan emoji en el texto de la tarjeta');

  // ── C · Badges del kit, no spans propios ───────────────────────────────
  const badges = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.prd-card')].find(x => x.textContent.includes('ACEITUNA'));
    const b = c ? c.querySelector('.bi-badge') : null;
    return b ? { clases: b.className, texto: b.textContent.trim(), color: getComputedStyle(b).color } : { falta: true };
  });
  chk('★ El nivel de alerta lo pinta un badge del kit (.bi-badge)',
      !badges.falta && /bi-badge/.test(badges.clases), JSON.stringify(badges));
  // 1.70 con mínimo 3: por debajo de ⅔ del mínimo (2) pero por encima de la
  // mitad (1.5) → "Advertencia producto bajo", en ámbar. No "Limitado": ese
  // umbral es < 1.5. (La primera versión de esta prueba lo calculó mal.)
  chk('ACEITUNA (1.70 de mínimo 3) sale como "Advertencia producto bajo", en ámbar del tema',
      badges.texto === 'Advertencia producto bajo' && badges.color === 'rgb(240, 180, 41)',
      JSON.stringify(badges));

  // ── D · El pedido sugerido conserva su cantidad y su acción ────────────
  const pedido = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.prd-card')].find(x => x.textContent.includes('ACEITUNA'));
    const z = c ? c.querySelector('.prd-card__pedido') : null;
    const btn = z ? z.querySelector('.prd-card__pedido-btn') : null;
    return z ? { texto: z.innerText.replace(/\s+/g, ' ').trim(),
                 btnAlto: btn ? btn.getBoundingClientRect().height : 0 } : { falta: true };
  });
  chk('Conserva el pedido sugerido con su cantidad (TECHO((3−1.7)/1) = 2)',
      !pedido.falta && /2/.test(pedido.texto), JSON.stringify(pedido));
  chk('…y su botón para mandarlo al carrito', pedido.btnAlto >= 30, JSON.stringify(pedido));

  // ── E · Un área sin contar se apaga, no desaparece ─────────────────────
  const vacios = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.prd-card')].find(x => x.textContent.includes('LIMON'));
    const chips = c ? [...c.querySelectorAll('.prd-area-chip')] : [];
    return { total: chips.length,
             vacios: chips.filter(x => x.classList.contains('prd-area-chip--vacio')).length,
             textos: chips.map(x => x.innerText.replace(/\s+/g, ' ').trim()) };
  });
  chk('★ Un área sin contar sigue ocupando su sitio, apagada (no desaparece)',
      vacios.total === 3 && vacios.vacios >= 1 && vacios.textos.some(t => /—/.test(t)),
      JSON.stringify(vacios));

  // ── F · Nada blanco, y el fondo de la lista es del tema ───────────────
  const limpio = await p.evaluate(() => {
    const t = document.getElementById('tabContent');
    return {
      blancos: [...t.querySelectorAll('*')].filter(el => getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)').length,
      grpActivo: (() => {
        const a = t.querySelector('.grp-pill--active');
        return a ? getComputedStyle(a).backgroundColor : null;
      })()
    };
  });
  chk('★ Ni un elemento con fondo blanco en toda la pantalla de Inicio',
      limpio.blancos === 0, 'blancos: ' + limpio.blancos);
  chk('El grupo activo del rail se pinta en latón sólido',
      limpio.grpActivo === 'rgb(232, 181, 92)', 'color: ' + limpio.grpActivo);

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── REDISEÑO R3 · Inicio con el sistema (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
