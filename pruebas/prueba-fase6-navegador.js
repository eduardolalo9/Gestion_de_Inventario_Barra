// FASE 6 — buscadores: prueba en Chromium real contra la app completa.
//
// Lo que esta prueba demuestra EJECUTANDO (no leyendo código):
//   · escribir en el buscador NO destruye el input (mismo nodo, foco intacto),
//     no llama a renderTab() ni a saveToLocalStorage() por tecla;
//   · un código completo da UN resultado (antes: ~1200 en un catálogo de 2000);
//   · typos, acentos, resaltado seguro, contador "N de M", estado vacío;
//   · teclado ↑↓ Enter Esc, historial reciente, chips, carga incremental;
//   · el conteo ya no hereda en silencio la búsqueda del catálogo.
const { chromium, devices } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const PUERTO = process.env.PUERTO || '8080';

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await nav.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
    try { Object.keys(localStorage).filter(k => k.indexOf('inventarioApp_busq') === 0).forEach(k => localStorage.removeItem(k)); } catch (_) {}
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1500);
  chk('La página carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  chk('El motor y la barra están cargados',
      await p.evaluate(() => typeof crearMotorBusqueda === 'function' && typeof createSearchEngine === 'function' &&
                            typeof BusquedaUI === 'object' && typeof resaltarBusqueda === 'function'), '');

  // ── Datos: admin + 500 productos sintéticos + casos especiales ──────────
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; currentUserRole = 'admin';
    _authzState.loaded = true; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    const marcas = ['DON JULIO', 'MAESTRO DOBEL', 'HERRADURA', 'JOSE CUERVO', 'BACARDI', 'ABSOLUT', 'SMIRNOFF', 'BUCHANANS', 'APEROL', 'CAMPARI'];
    const tipos = ['BLANCO', 'REPOSADO', 'AÑEJO', 'CRISTALINO', '70'];
    const grupos = ['TEQUILA', 'RON', 'VODKA', 'WHISKY', 'APERITIVO'];
    const P = [];
    for (let i = 0; i < 498; i++) {
      P.push({ id: String(1180000 + i), name: marcas[i % 10] + ' ' + tipos[Math.floor(i / 10) % 5] + ' ' + (700 + (i % 3) * 50) + ' ML',
               group: grupos[i % 5], unit: 'PZA', precio: i % 7 === 0 ? undefined : 100 + i,
               pv: i % 11 === 0 ? '' : 'PV' + i, stockMinimo: i < 5 ? 999 : 0 });
    }
    P.push({ id: 'X1', name: 'RON & COLA <b>', group: 'RON', unit: 'PZA', precio: 1, pv: 'PVX1' });
    P.push({ id: 'X2', name: 'Mezcal Añejo Único', group: 'MEZCAL', unit: 'PZA', precio: 1, pv: 'PVX2' });
    products = P; cart = []; orders = []; inventories = [];
    selectedGroup = 'Todos'; searchTerm = '';
    activeTab = 'inicio'; renderTab();
  });

  const inp = '#sbx-input-catalogo';
  chk('Inicio tiene la barra unificada, con role="search" y etiqueta accesible',
      await p.evaluate(() => {
        const w = document.getElementById('sbx-catalogo'); const i = document.getElementById('sbx-input-catalogo');
        const lab = document.querySelector('label[for="sbx-input-catalogo"]');
        return !!w && w.getAttribute('role') === 'search' && !!i && !!lab && lab.textContent.length > 3 &&
               i.getAttribute('aria-controls') === 'sbx-res-catalogo' && i.getAttribute('enterkeyhint') === 'search';
      }), '');
  chk('Sin búsqueda: resumen con el total y carga incremental (60 de 500)',
      await p.evaluate(() => {
        const t = document.getElementById('sbx-res-catalogo').innerText;
        return /500\s+productos/.test(t) && document.querySelectorAll('#sbx-res-catalogo [data-sbx-item]').length === 60 &&
               !!document.querySelector('#sbx-res-catalogo [data-sbx-accion="mas"]');
      }), '');

  // ── Escribir: el input sobrevive, sin renderTab ni guardado por tecla ───
  await p.evaluate(() => {
    window.__rt = 0; window.__save = 0;
    const rt = window.renderTab, sv = window.saveToLocalStorage;
    window.renderTab = function() { window.__rt++; return rt.apply(this, arguments); };
    window.saveToLocalStorage = function() { window.__save++; return sv.apply(this, arguments); };
    document.getElementById('sbx-input-catalogo').__marca = 'mismo-nodo';
  });
  await p.click(inp);
  await p.keyboard.type('don julio', { delay: 40 });
  await p.waitForTimeout(450);
  const tras = await p.evaluate(() => {
    const i = document.getElementById('sbx-input-catalogo');
    const nombres = [...document.querySelectorAll('#sbx-res-catalogo .prd-card__name')].map(e => e.textContent);
    return { mismo: i.__marca === 'mismo-nodo', foco: document.activeElement === i, rt: window.__rt, save: window.__save,
             n: nombres.length, todos: nombres.every(x => x.indexOf('DON JULIO') === 0),
             resumen: document.getElementById('sbx-res-catalogo').innerText.slice(0, 80),
             marks: document.querySelectorAll('#sbx-res-catalogo .sb-mark').length,
             texto: document.getElementById('sbx-catalogo').classList.contains('sbx--texto') };
  });
  chk('Al escribir, el input es el MISMO nodo y conserva el foco', tras.mismo && tras.foco, JSON.stringify(tras));
  chk('Escribir no llama a renderTab()', tras.rt === 0, 'llamadas: ' + tras.rt);
  chk('Escribir no guarda todo el estado (saveToLocalStorage) por tecla', tras.save === 0, 'llamadas: ' + tras.save);
  chk('"don julio" filtra solo DON JULIO', tras.n > 0 && tras.todos, JSON.stringify(tras));
  chk('El contador dice "N de 500"', /\b50\s+de 500 productos/.test(tras.resumen), tras.resumen);
  chk('Las coincidencias se resaltan', tras.marks >= tras.n, 'marks=' + tras.marks);
  chk('El botón limpiar aparece solo con texto', tras.texto, '');

  // ── Limpiar ──────────────────────────────────────────────────────────────
  await p.click('#sbx-catalogo [data-sbx-accion="limpiar"]');
  await p.waitForTimeout(150);
  const limpio = await p.evaluate(() => ({ v: document.getElementById('sbx-input-catalogo').value, st: searchTerm,
    n: document.querySelectorAll('#sbx-res-catalogo [data-sbx-item]').length,
    foco: document.activeElement && document.activeElement.id,
    texto: document.getElementById('sbx-catalogo').classList.contains('sbx--texto') }));
  chk('Limpiar vacía input y estado, devuelve la lista y deja el foco en el input',
      limpio.v === '' && limpio.st === '' && limpio.n === 60 && limpio.foco === 'sbx-input-catalogo' && !limpio.texto,
      JSON.stringify(limpio));

  const buscar = async (q) => {
    await p.fill(inp, q); await p.waitForTimeout(320);
    return p.evaluate(() => ({
      nombres: [...document.querySelectorAll('#sbx-res-catalogo .prd-card__name')].map(e => e.textContent),
      html: document.getElementById('sbx-res-catalogo').innerHTML,
      texto: document.getElementById('sbx-res-catalogo').innerText }));
  };
  let r = await buscar('1180015');
  chk('Un código completo devuelve exactamente UN producto', r.nombres.length === 1, r.nombres.length + ' resultados');
  r = await buscar('reposdo');
  chk('Tolera el typo "reposdo" → REPOSADO', r.nombres.length > 0 && r.nombres.every(n => n.indexOf('REPOSADO') !== -1), r.nombres.slice(0, 3).join(' | '));
  r = await buscar('anejo unico');
  chk('Sin acentos encuentra "Mezcal Añejo Único" y resalta sobre el texto con acentos',
      r.nombres.length === 1 && /<mark class="sb-mark">Añejo<\/mark>/.test(r.html) && /<mark class="sb-mark">Único<\/mark>/.test(r.html), r.nombres.join('|'));
  r = await buscar('amp');
  chk('Resaltar "amp" no rompe la entidad de "RON & COLA <b>" ni inyecta HTML',
      !/&<mark/.test(r.html) && r.html.indexOf('<b>') === -1, '');
  r = await buscar('zzqqxx');
  chk('Estado vacío profesional con el término y salida', /No se encontró “zzqqxx”/.test(r.texto) &&
      /Limpiar búsqueda/.test(r.texto), r.texto.slice(0, 120));
  await p.click('#sbx-res-catalogo [data-sbx-accion="limpiar"]'); await p.waitForTimeout(150);
  chk('El botón del estado vacío limpia la búsqueda',
      await p.evaluate(() => searchTerm === '' && document.querySelectorAll('#sbx-res-catalogo [data-sbx-item]').length === 60), '');

  // ── Teclado ──────────────────────────────────────────────────────────────
  await p.fill(inp, 'herradura blanco'); await p.waitForTimeout(320);
  await p.focus(inp);
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  const kb = await p.evaluate(() => {
    const its = [...document.querySelectorAll('#sbx-res-catalogo [data-sbx-item]')];
    const act = its.findIndex(e => e.classList.contains('sbx-activo'));
    const i = document.getElementById('sbx-input-catalogo');
    return { act, desc: i.getAttribute('aria-activedescendant'), idAct: its[act] && its[act].id, foco: document.activeElement === i };
  });
  chk('↓↓ resalta el segundo resultado y lo anuncia con aria-activedescendant',
      kb.act === 1 && kb.desc && kb.desc === kb.idAct && kb.foco, JSON.stringify(kb));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  chk('Enter ejecuta la acción principal del resultado (agregar al carrito)',
      await p.evaluate(() => cart.length === 1 && /HERRADURA BLANCO/.test(cart[0].name)), '');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(100);
  chk('Esc limpia la búsqueda sin sacar el foco del input',
      await p.evaluate(() => searchTerm === '' && document.activeElement && document.activeElement.id === 'sbx-input-catalogo'), '');

  // ── Historial de recientes ───────────────────────────────────────────────
  const rec = await p.evaluate(() => {
    const cont = document.getElementById('sbx-rec-catalogo');
    return { visible: !cont.hidden, items: [...cont.querySelectorAll('[data-sbx-accion="reciente"]')].map(b => b.getAttribute('data-sbx-valor')) };
  });
  chk('Con el input vacío y enfocado se ofrecen las búsquedas recientes', rec.visible && rec.items[0] === 'herradura blanco', JSON.stringify(rec));
  await p.click('#sbx-rec-catalogo [data-sbx-accion="reciente"]');
  await p.waitForTimeout(150);
  chk('Tocar una búsqueda reciente la aplica', await p.evaluate(() => searchTerm === 'herradura blanco'), '');
  chk('El historial persiste en localStorage (máx. 8)',
      await p.evaluate(() => { const h = JSON.parse(localStorage.getItem('inventarioApp_busqRecientes_catalogo') || '[]'); return h.length >= 1 && h.length <= 8; }), '');
  await p.click('#sbx-catalogo [data-sbx-accion="limpiar"]'); await p.waitForTimeout(120);

  // ── Chips ────────────────────────────────────────────────────────────────
  await p.click('#tabContent [data-sbx-filtro="bajoMin"]'); await p.waitForTimeout(150);
  const chip = await p.evaluate(() => ({
    n: document.querySelectorAll('#sbx-res-catalogo [data-sbx-item]').length,
    on: document.querySelector('[data-sbx-filtro="bajoMin"]').getAttribute('aria-pressed') }));
  chk('Chip "Bajo mínimo" filtra a los 5 productos por debajo de su mínimo', chip.n === 5 && chip.on === 'true', JSON.stringify(chip));
  await p.click('#tabContent [data-sbx-filtro="bajoMin"]'); await p.waitForTimeout(150);

  // ── Carga incremental ────────────────────────────────────────────────────
  await p.click('#sbx-res-catalogo [data-sbx-accion="mas"]'); await p.waitForTimeout(150);
  chk('"Mostrar más" agrega la siguiente tanda (120)',
      await p.evaluate(() => document.querySelectorAll('#sbx-res-catalogo [data-sbx-item]').length === 120), '');

  // ── Productos comparte estado con Inicio ─────────────────────────────────
  await p.fill(inp, 'aperol'); await p.waitForTimeout(320);
  const prod = await p.evaluate(() => {
    activeTab = 'productos'; renderTab();
    const i = document.getElementById('sbx-input-catalogo');
    const filas = [...document.querySelectorAll('#sbx-res-catalogo tr[data-sbx-item]')];
    return { v: i && i.value, n: filas.length, ok: filas.every(f => /APEROL/.test(f.innerText)),
             chips: [...document.querySelectorAll('[data-sbx-chips="catalogo"] .sbx-chip')].map(b => b.getAttribute('data-sbx-filtro')) };
  });
  chk('Productos muestra la misma búsqueda y filtra la tabla', prod.v === 'aperol' && prod.n === 49 && prod.ok, JSON.stringify(prod));
  chk('Para el admin, Productos ofrece los chips "Sin precio" y "Sin PV"',
      prod.chips.indexOf('sinPrecio') !== -1 && prod.chips.indexOf('sinPV') !== -1, prod.chips.join(','));

  // ── Conteo: ya no hereda la búsqueda del catálogo ────────────────────────
  const conteo = await p.evaluate(() => {
    searchTerm = 'zzqqxx';   // búsqueda de catálogo que no coincide con nada
    myAuditoriaConteo = { '1180001': { almacen: { enteras: 3, abiertas: [] } } };
    auditoriaConteo = myAuditoriaConteo;
    auditoriaView = 'counting'; auditoriaAreaActiva = 'almacen';
    activeTab = 'inventario'; renderTab();
    return { n: document.querySelectorAll('#sbx-res-conteo [data-sbx-item]').length,
             hayBarra: !!document.getElementById('sbx-input-conteo'),
             v: document.getElementById('sbx-input-conteo').value };
  });
  chk('El conteo NO queda filtrado por la búsqueda del catálogo (bug de filtro oculto)',
      conteo.hayBarra && conteo.v === '' && conteo.n === 120, JSON.stringify(conteo));
  await p.click('#tabContent [data-sbx-filtro="contados"]'); await p.waitForTimeout(150);
  chk('Chip "Contados" deja solo lo ya contado en el área',
      await p.evaluate(() => document.querySelectorAll('#sbx-res-conteo [data-sbx-item]').length === 1), '');
  await p.click('#tabContent [data-sbx-filtro="sinContar"]'); await p.waitForTimeout(150);
  chk('"Sin contar" y "Contados" son excluyentes',
      await p.evaluate(() => {
        const on = [...document.querySelectorAll('[data-sbx-chips="conteo"] .sbx-chip--on')].map(b => b.getAttribute('data-sbx-filtro'));
        return on.length === 1 && on[0] === 'sinContar';
      }), '');
  await p.fill('#sbx-input-conteo', 'campari 70'); await p.waitForTimeout(320);
  // "70" también es prefijo de "700 ML": entran, pero después de los "CAMPARI 70".
  const cq = await p.evaluate(() => ({ q: _conteoSearchTerm,
    n: [...document.querySelectorAll('#sbx-res-conteo .inv-card__name')].map(e => e.textContent) }));
  chk('El buscador del conteo filtra, ordena por relevancia y actualiza _conteoSearchTerm',
      cq.q === 'campari 70' && cq.n.length > 0 && cq.n.every(x => /CAMPARI/.test(x)) && /^CAMPARI 70 /.test(cq.n[0]),
      JSON.stringify(cq).slice(0, 200));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  chk('Esc en el conteo limpia la búsqueda y NO dispara el cierre del menú lateral',
      await p.evaluate(() => _conteoSearchTerm === '' && document.activeElement && document.activeElement.id === 'sbx-input-conteo'), '');

  // ── Pedidos e Historia ───────────────────────────────────────────────────
  const ped = await p.evaluate(() => {
    orders = [
      { id: 'PED-001', supplier: 'Standard Foods', date: '2026-09-01', products: [{ name: 'DON JULIO 70', unit: 'PZA', quantity: 2 }], total: 2 },
      { id: 'PED-002', supplier: 'Fresco del Valle', date: '2026-09-02', products: [{ name: 'LIMON', unit: 'KG', quantity: 5 }], total: 5 }
    ];
    activeTab = 'pedidos'; renderTab(); return !!document.getElementById('sbx-input-pedidos');
  });
  await p.fill('#sbx-input-pedidos', 'fresco'); await p.waitForTimeout(320);
  chk('Pedidos: busca por proveedor', ped && await p.evaluate(() =>
      document.querySelectorAll('#sbx-res-pedidos [data-sbx-item]').length === 1 &&
      /PED-002/.test(document.getElementById('sbx-res-pedidos').innerText)), '');
  await p.fill('#sbx-input-pedidos', 'don julio'); await p.waitForTimeout(320);
  chk('Pedidos: busca por producto dentro del pedido', await p.evaluate(() =>
      /PED-001/.test(document.getElementById('sbx-res-pedidos').innerText) &&
      document.querySelectorAll('#sbx-res-pedidos [data-sbx-item]').length === 1), '');

  await p.evaluate(() => {
    inventories = [
      { id: 'INV-1', area: 'almacen', date: '2026-09-07', products: [{ name: 'APEROL', stock: 1, unit: 'PZA', abiertas: [] }], totalProducts: 1 },
      { id: 'INV-2', area: 'barra1',  date: '2026-09-07', products: [{ name: 'CAMPARI', stock: 1, unit: 'PZA', abiertas: [] }], totalProducts: 1 },
      { id: 'INV-3', area: 'barra1',  date: '2026-09-14', products: [{ name: 'APEROL', stock: 2, unit: 'PZA', abiertas: [] }], totalProducts: 2 }
    ];
    activeTab = 'historia'; renderTab();
  });
  await p.click('#tabContent [data-sbx-filtro="area:barra1"]'); await p.waitForTimeout(150);
  await p.fill('#sbx-input-historia', 'aperol'); await p.waitForTimeout(320);
  chk('Historia: chip de área + búsqueda por producto se combinan', await p.evaluate(() => {
    const t = document.getElementById('sbx-res-historia').innerText;
    return document.querySelectorAll('#sbx-res-historia [data-sbx-item]').length === 1 && /INV-3/.test(t);
  }), '');

  // ── Móvil: teclado numérico ──────────────────────────────────────────────
  await p.evaluate(() => { activeTab = 'inicio'; renderTab(); });
  const modoVisible = await p.isVisible('#sbx-catalogo [data-sbx-accion="modo"]');
  if (modoVisible) await p.click('#sbx-catalogo [data-sbx-accion="modo"]');
  chk('En móvil, el botón 123 cambia el teclado a numérico y se recuerda',
      modoVisible && await p.evaluate(() => document.getElementById('sbx-input-catalogo').getAttribute('inputmode') === 'numeric' &&
        localStorage.getItem('inventarioApp_busqModo_catalogo') === 'true'), 'visible=' + modoVisible);

  // ── Nada más se rompió ───────────────────────────────────────────────────
  const otras = await p.evaluate(() => {
    const res = {};
    auditoriaView = 'seleccion';
    ['inicio', 'productos', 'pedidos', 'inventario', 'historia', 'compras', 'ajustes'].forEach(t => {
      try { activeTab = t; renderTab(); res[t] = document.getElementById('tabContent').innerHTML.length > 0; }
      catch (e) { res[t] = 'ERROR: ' + e.message; }
    });
    return res;
  });
  chk('Todas las pestañas siguen renderizando', Object.values(otras).every(v => v === true), JSON.stringify(otras));
  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));

  await nav.close();
  const w = Math.max(...C.map(c => c.n.length));
  console.log('\n  ── FASE 6 · buscadores (navegador real) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
  const mal = C.filter(c => !c.ok).length;
  console.log(`\n  ${C.length} pruebas · ${C.length - mal} pasaron · ${mal} fallaron`);
  process.exit(mal ? 1 : 0);
})();
