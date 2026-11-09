// Inicio · tarjetas de «Operación» — tarjeta compacta 2×2 medida en Chromium real.
// Rejilla: 2 columnas hasta 600 px, 3 desde 1024 px. Icono de 22 px que abarca las dos filas;
// título 13.5/600 y subtítulo 11.5 atenuado (elipsis solo en escritorio). min-height 52 px,
// padding 8/10, borde 1 px y radio 8 px; hover a --card-high con borde de acento; :active scale(.99).
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const ANCHOS = [360, 390, 600, 768, 1024, 1440];

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  for (const tema of ['dark', 'light']) for (const w of ANCHOS) {
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('inventarioApp_temaMarca', 'ultra-pro'); localStorage.setItem('inventarioApp_theme', t); } catch (_) {} }, tema);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' }); await p.waitForTimeout(600);
    await p.evaluate(() => {
      document.getElementById('authLoadingScreen').classList.add('auth-hidden');
      document.getElementById('loginScreen').classList.add('auth-hidden');
      document.getElementById('appWrapper').classList.add('auth-visible');
      currentUserUid = 'u'; currentUserRole = 'admin';
      _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
      products = Array.from({ length: 142 }, (_, i) => ({ id: 'P' + i, name: 'PRODUCTO ' + i, group: 'G', unit: 'PZA', stockByArea: { almacen: 5 } }));
      orders = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }];
      activeTab = 'inicio'; renderTab();
    });
    await p.waitForTimeout(300);
    const tag = `[${w}px · ${tema}]`;
    const r = await p.evaluate(() => {
      const g = document.querySelector('.it-modulos'), gs = getComputedStyle(g);
      const cards = [...g.querySelectorAll('.it-modulo')];
      const c0 = cards[0], cs = getComputedStyle(c0), ico = c0.querySelector('.it-modulo__ico'), is = getComputedStyle(ico);
      const t = getComputedStyle(c0.querySelector('.it-modulo__t')), s = getComputedStyle(c0.querySelector('.it-modulo__s'));
      return {
        tema: document.documentElement.getAttribute('data-theme'),
        cols: gs.gridTemplateColumns.split(' ').length, gap: gs.columnGap,
        botones: cards.every(b => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button'),
        altos: cards.map(b => Math.round(b.getBoundingClientRect().height)),
        tarjeta: { disp: cs.display, col: cs.gridTemplateColumns.split(' ')[0], minH: cs.minHeight, pad: cs.paddingTop + ' ' + cs.paddingLeft, borde: cs.borderTopWidth, radio: cs.borderTopLeftRadius },
        ico: { fila: is.gridRowStart + '/' + is.gridRowEnd, col: is.gridColumnStart },
        tit: { fs: t.fontSize, fw: t.fontWeight, wrap: t.overflowWrap },
        sub: { fs: s.fontSize, ws: s.whiteSpace, to: s.textOverflow, wrap: s.overflowWrap, color: s.color, colorTit: t.color },
        datos: cards.map(b => ({ t: b.querySelector('.it-modulo__t').textContent.trim(), s: b.querySelector('.it-modulo__s').textContent.trim(), i: [...b.querySelector('.it-modulo__ico').classList].find(x => /^fa-(?!solid)/.test(x)) })),
        desborde: document.documentElement.scrollWidth > window.innerWidth + 1,
        dentro: cards.every(b => { const q = b.getBoundingClientRect(); return q.left >= 0 && q.right <= window.innerWidth + 0.5; })
      };
    });
    chk(`${tag} el tema aplicado es el pedido`, r.tema === tema, r.tema);
    const colsEsperadas = w <= 600 ? 2 : (w >= 1024 ? 3 : 2);
    chk(`${tag} rejilla de ${colsEsperadas} columnas con gap de 8 px`, r.cols === colsEsperadas && r.gap === '8px', JSON.stringify([r.cols, r.gap]));
    chk(`${tag} cada tarjeta es <button type="button">`, r.botones);
    chk(`${tag} anatomía: grid 22 px | 1fr, min-height 52, padding 8/10, borde 1 px, radio 8 px`,
        r.tarjeta.disp === 'grid' && r.tarjeta.col === '22px' && r.tarjeta.minH === '52px' && r.tarjeta.pad === '8px 10px' && r.tarjeta.borde === '1px' && r.tarjeta.radio === '8px', JSON.stringify(r.tarjeta));
    chk(`${tag} el icono ocupa la columna 1 y abarca las 2 filas`, r.ico.fila === '1/3' && r.ico.col === '1', JSON.stringify(r.ico));
    chk(`${tag} título 13.5 px / 600 / overflow-wrap anywhere`, r.tit.fs === '13.5px' && r.tit.fw === '600' && r.tit.wrap === 'anywhere', JSON.stringify(r.tit));
    chk(`${tag} subtítulo 11.5 px, más atenuado que el título`, r.sub.fs === '11.5px' && r.sub.color !== r.sub.colorTit, JSON.stringify(r.sub));
    if (w >= 1024) chk(`${tag} subtítulo con elipsis en escritorio`, r.sub.ws === 'nowrap' && r.sub.to === 'ellipsis', JSON.stringify(r.sub));
    else chk(`${tag} subtítulo fluido en móvil (sin elipsis)`, r.sub.ws !== 'nowrap' && r.sub.wrap === 'anywhere', JSON.stringify(r.sub));
    chk(`${tag} todas las tarjetas ≥ 52 px de alto (objetivo táctil)`, r.altos.every(h => h >= 52), JSON.stringify(r.altos));
    chk(`${tag} sin desbordes: tarjetas dentro de la pantalla y sin scroll horizontal`, !r.desborde && r.dentro);
    if (w === 390 && tema === 'dark') {
      const esperado = [['Inventario', 'Físico y cierres', 'fa-boxes-stacked'], ['Catálogo', '142 productos', 'fa-box'], ['Pedidos', '3 en este dispositivo', 'fa-clipboard-list'],
                        ['Físico vs Sistema', 'Diferencias', 'fa-file-chart-column'], ['Recetario', 'Recetas y costos', 'fa-book'], ['Ventas', 'Importar y consumo', 'fa-receipt']];
      chk('Los 6 módulos, en orden, con su icono y subtítulo (Catálogo y Pedidos son dinámicos)',
          JSON.stringify(r.datos.map(d => [d.t, d.s, d.i])) === JSON.stringify(esperado), JSON.stringify(r.datos));
    }
    if (w === 1440) {
      // Hover: fondo --card-high y borde iluminado con el acento
      const antes = await p.evaluate(() => { const b = document.querySelector('.it-modulo'); const c = getComputedStyle(b); return { bg: c.backgroundColor, bd: c.borderTopColor }; });
      await p.hover('.it-modulo'); await p.waitForTimeout(250);
      const hov = await p.evaluate(() => {
        const b = document.querySelector('.it-modulo'), c = getComputedStyle(b);
        const tmp = document.createElement('div'); tmp.style.background = 'var(--card-high)'; document.body.appendChild(tmp);
        const ch = getComputedStyle(tmp).backgroundColor; tmp.remove();
        return { bg: c.backgroundColor, bd: c.borderTopColor, cardHigh: ch };
      });
      chk(`${tag} hover: fondo pasa a --card-high y el borde cambia al acento`, hov.bg === hov.cardHigh && hov.bg !== antes.bg && hov.bd !== antes.bd, JSON.stringify({ antes, hov }));
      const box = await p.evaluate(() => { const q = document.querySelector('.it-modulo').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
      await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.waitForTimeout(150);
      const tr = await p.evaluate(() => getComputedStyle(document.querySelector('.it-modulo')).transform);
      await p.mouse.up();
      chk(`${tag} al presionar: micro-compresión scale(0.99)`, /^matrix\(0\.99, 0, 0, 0\.99/.test(tr), tr);
    }
    // Navegación intacta
    if (w === 390 && tema === 'light') {
      await p.evaluate(() => [...document.querySelectorAll('.it-modulo')].find(b => /Catálogo/.test(b.textContent)).click()); await p.waitForTimeout(200);
      chk('Tocar «Catálogo» sigue abriendo Productos', await p.evaluate(() => activeTab === 'productos'));
    }
    chk(`${tag} sin errores de JavaScript`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await nav.close();
  const w = Math.max(...C.map(c => c.n.length));
  console.log('\n  ── Inicio · tarjetas de Operación (navegador real) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
  const fallos = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
