// FASE 10B — Inventario Físico en el celular: una sola columna, botones
// grandes para el pulgar, separados y con alto contraste. Se mide en Chromium
// con viewport de teléfono (390×844), contra la app real.
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

  const montar = (estado) => p.evaluate((estado) => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; _authzState.loaded = true; _authzState.roleId = 'ADMIN';
    _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    products = Array.from({ length: 40 }, (_, i) => ({ id: 'P' + i, name: 'PRODUCTO ' + i, unit: 'PZA', group: 'TEQUILA' }));
    _auditoriaSessionId = 'S7'; _inventarioActivoCarga = 'ok';
    _inventarioActivo = estado ? { numero: 7, estado: estado, fechaCreacion: Date.now(), fechaCierre: Date.now(), creadoPorNombre: 'Eduardo', creadoPorRol: 'ADMIN',
      fechaRecuento: '2026-10-04', semanaId: '2026-09-28', warehousesSnapshot: ['almacen', 'barra1', 'barra2'], comentario: 'Cierre de semana' } : null;
    allUsersAuditoria = { u1: { uid: 'u1', email: 'luis@barra.mx', conteo: { P1: { almacen: { enteras: 2, abiertas: [] } } }, status: { almacen: 'completada' }, updatedAt: Date.now() } };
    auditoriaStatus = { almacen: 'completada', barra1: 'pendiente', barra2: 'pendiente' };
    auditoriaView = 'selection'; activeTab = 'inventario';
    renderTab();
  }, estado);

  // Contraste WCAG calculado con los colores REALES que pinta el navegador.
  const CONTRASTE = () => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const L = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
                                      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    return [...document.querySelectorAll('#tabContent .bt')].filter(b => b.offsetParent).map(b => {
      const cs = getComputedStyle(b);
      const a = L(rgb(cs.color)), f = L(rgb(cs.backgroundColor));
      return { t: b.innerText.trim().slice(0, 30), r: Math.round(((Math.max(a, f) + 0.05) / (Math.min(a, f) + 0.05)) * 100) / 100 };
    });
  };
  // REDISEÑO R1 — se añade `wp`: el ancho del contenedor del botón.
  // Antes se comprobaba "w >= 300", un número absoluto, y eso resultó ser
  // frágil por una razón que conviene dejar escrita: en la caja de pruebas el
  // proxy de salida BLOQUEA cdn.tailwindcss.com (403), así que hasta la 4.24
  // Chromium cargaba la app SIN Tailwind y las utilidades (px-3, max-w-7xl…)
  // no aplicaban. En el teléfono del usuario, con internet, sí aplicaban: las
  // medidas de esta prueba describían un layout que solo existía sin red.
  // Desde R1 las utilidades son locales y SIEMPRE aplican, aquí y en
  // producción, de modo que el contenedor recupera sus 12 px de padding y el
  // botón mide 284 px en vez de 308. Lo que la prueba quería afirmar —que la
  // acción ocupa todo el ancho disponible, no media fila— se mide ahora
  // contra su contenedor, que es lo que de verdad importa y no cambia con el
  // padding de los ancestros ni con el ancho del viewport.
  const MEDIDAS = () => [...document.querySelectorAll('#tabContent .bt')].filter(b => b.offsetParent).map(b => {
    const r = b.getBoundingClientRect();
    const padre = b.parentElement ? b.parentElement.getBoundingClientRect().width : r.width;
    return { t: b.innerText.trim().slice(0, 30), h: r.height, w: r.width, wp: padre, fs: parseFloat(getComputedStyle(b).fontSize) };
  });

  // ── Inventario ABIERTO (admin) ──────────────────────────────────────────
  await montar('SINCRONIZADO'); await p.waitForTimeout(250);
  let m = await p.evaluate(MEDIDAS);
  chk('★ Todos los botones de la pantalla miden al menos 48 px de alto (pulgar)', m.length >= 6 && m.every(b => b.h >= 48), JSON.stringify(m.filter(b => b.h < 48)));
  chk('★ Todos los botones tienen texto de al menos 14 px (antes 11–12 px)', m.every(b => b.fs >= 14), JSON.stringify(m.filter(b => b.fs < 14)));
  chk('Las acciones principales ocupan todo el ancho (una columna, no una fila apretada)',
      m.filter(b => /Reconteo$|Reconteos|Historial|Cerrar Inventario/.test(b.t)).every(b => b.w >= 300), JSON.stringify(m.map(b => [b.t, Math.round(b.w)])));
  const c = await p.evaluate(CONTRASTE);
  chk('★ Contraste de todos los botones ≥ 4.5:1 (WCAG AA) — antes "Cerrar" era 1.7:1', c.every(x => x.r >= 4.5), JSON.stringify(c.filter(x => x.r < 4.5)));
  const orden = await p.evaluate(() => {
    const t = [...document.querySelectorAll('#tabContent .bt')].filter(b => b.offsetParent).map(b => b.innerText.trim());
    return { ultimo: t[t.length - 1], total: t.length, iReconteo: t.findIndex(x => /Reconteo$/.test(x)), iCerrar: t.findIndex(x => /Cerrar Inventario/.test(x)) };
  });
  chk('★ "Cerrar Inventario Físico" (irreversible) es el ÚLTIMO botón, en su zona separada',
      /Cerrar Inventario Físico/.test(orden.ultimo) && await p.evaluate(() => !!document.querySelector('.bt-zona-peligro .bt--peligro')), JSON.stringify(orden));
  const sep = await p.evaluate(() => {
    // Se buscan por texto en cualquier botón: así la prueba también MIDE (y
    // falla) contra la versión anterior en vez de reventar.
    const todos = [...document.querySelectorAll('#tabContent button, #tabContent [data-rc-accion]')].filter(b => b.offsetParent);
    const cerrar = todos.find(b => /Cerrar Inventario Físico/.test(b.innerText));
    const rec = todos.find(b => /Reconteo$/.test(b.innerText.trim()));
    if (!cerrar || !rec) return -1;
    return Math.round(cerrar.getBoundingClientRect().top - rec.getBoundingClientRect().bottom);
  });
  chk('"Cerrar" ya no está junto a "Reconteo" (más de 300 px de distancia)', sep > 300, String(sep));
  const huecos = await p.evaluate(() => {
    const bs = [...document.querySelectorAll('#tabContent .bt-pila')].flatMap(pila => {
      const hs = [...pila.children].filter(x => x.classList.contains('bt') && x.offsetParent).map(x => x.getBoundingClientRect());
      return hs.slice(1).map((r, i) => Math.round(r.top - hs[i].bottom));
    });
    return bs;
  });
  chk('★ Entre botones apilados hay al menos 10 px (no se tocan dos a la vez)', huecos.length > 0 && huecos.every(h => h >= 10), JSON.stringify(huecos));
  chk('No hay desplazamiento horizontal en un teléfono de 390 px',
      await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '');
  chk('"Cerrar área para todos" y "Reabrir" ya no son enlaces diminutos dentro de la tarjeta del área',
      await p.evaluate(() => ![...document.querySelectorAll('.audit-area-card a')].length &&
          [...document.querySelectorAll('.if-area > .bt')].some(b => /Cerrar área para todos/.test(b.innerText)) &&
          [...document.querySelectorAll('.if-area > .bt')].some(b => /Reabrir/.test(b.innerText))), '');
  chk('Las tarjetas de área miden al menos 72 px de alto',
      await p.evaluate(() => [...document.querySelectorAll('.audit-area-card')].every(c => c.getBoundingClientRect().height >= 72)), '');
  chk('Ya no aparece un segundo "Nuevo Inventario Físico" en la pantalla',
      !/Nuevo Inventario Físico|Cierra #7 primero/.test(await p.evaluate(() => document.getElementById('tabContent').innerText)), '');
  chk('Los datos van uno por fila (Recuento, Creado, Áreas, Usuarios contando)',
      await p.evaluate(() => [...document.querySelectorAll('.if-dato dt')].map(x => x.innerText.trim().toLowerCase()).join('|')) === 'recuento|creado|áreas|usuarios contando', '');

  // Las acciones siguen conectadas a las mismas funciones
  chk('Reconteo, Reconteos y Contabilizar siguen usando sus atributos data-* de siempre',
      await p.evaluate(() => !!document.querySelector('.bt[data-rc-accion="iniciar"]') && !!document.querySelector('.bt[data-rc-accion="historial"]')), '');

  // ── Inventario CERRADO: siguiente paso con botones grandes ──────────────
  await montar('CERRADO'); await p.waitForTimeout(250);
  m = await p.evaluate(MEDIDAS);
  const aLoAncho = (b) => b.h >= 48 && b.w >= b.wp - 1;   // ocupa su contenedor
  chk('Con el inventario cerrado: "Contabilizar" y "Crear el siguiente" son botones grandes y apilados',
      m.some(b => /Contabilizar/.test(b.t) && aLoAncho(b)) && m.some(b => /Crear el siguiente/.test(b.t) && aLoAncho(b)),
      JSON.stringify(m.map(b => [b.t, Math.round(b.h), Math.round(b.w), Math.round(b.wp)])));
  chk('Con el inventario cerrado no se ofrece "Cerrar Inventario Físico"',
      !m.some(b => /Cerrar Inventario Físico/.test(b.t)), '');
  chk('Contraste ≥ 4.5:1 también con el inventario cerrado', (await p.evaluate(CONTRASTE)).every(x => x.r >= 4.5), '');

  // ── Sin inventario ──────────────────────────────────────────────────────
  await montar(null); await p.waitForTimeout(200);
  m = await p.evaluate(MEDIDAS);
  chk('Sin inventario: "Crear Inventario Físico" es el primer botón, grande y a lo ancho',
      m.length >= 2 && /Crear Inventario Físico/.test(m[0].t) && m[0].h >= 48 && m[0].w >= 300, JSON.stringify(m));

  // ── Modo claro: el contraste se sostiene ───────────────────────────────
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await montar('SINCRONIZADO'); await p.waitForTimeout(200);
  chk('★ En modo claro todos los botones siguen ≥ 4.5:1', (await p.evaluate(CONTRASTE)).every(x => x.r >= 4.5),
      JSON.stringify((await p.evaluate(CONTRASTE)).filter(x => x.r < 4.5)));
  await p.evaluate(() => document.documentElement.removeAttribute('data-theme'));

  // ── Modal "Nuevo Inventario Físico" ─────────────────────────────────────
  await montar(null);
  await p.evaluate(() => { _auditoriaSessionId = null; abrirModalNuevoInventario(); document.getElementById('nuevoInventarioModal').classList.remove('hidden'); });
  await p.waitForTimeout(250);
  const modal = await p.evaluate(() => {
    const q = (s) => document.querySelector('#nuevoInventarioModal ' + s).getBoundingClientRect();
    const crear = q('#nuevoInvBtnCrear'), cancelar = [...document.querySelectorAll('#nuevoInventarioModal button')].find(b => /Cancelar/.test(b.innerText)).getBoundingClientRect();
    return {
      crear: [crear.height, crear.width], cancelar: [cancelar.height, cancelar.width],
      apilados: cancelar.top >= crear.bottom, hueco: Math.round(cancelar.top - crear.bottom),
      campos: [...document.querySelectorAll('#nuevoInventarioModal .ni-campo input[type="text"], #nuevoInventarioModal .ni-campo input[type="date"]')].map(i => Math.round(i.getBoundingClientRect().height)),
      areas: [...document.querySelectorAll('#nuevoInventarioModal .ni-area')].map(a => Math.round(a.getBoundingClientRect().height)),
      fsCampo: parseFloat(getComputedStyle(document.getElementById('nuevoInvNombre')).fontSize)
    };
  });
  chk('★ Modal: "Crear" y "Cancelar" apilados, a lo ancho, con separación', modal.apilados && modal.hueco >= 10 && modal.crear[1] > 280 && modal.cancelar[1] > 280, JSON.stringify(modal));
  chk('Modal: botones de al menos 48 px', modal.crear[0] >= 48 && modal.cancelar[0] >= 48, JSON.stringify(modal));
  chk('Modal: campos de al menos 44 px con texto ≥ 16 px (el teclado del celular no hace zoom)', modal.campos.every(h => h >= 44) && modal.fsCampo >= 16, JSON.stringify(modal));
  chk('Modal: cada área es una fila de al menos 56 px que se marca tocándola completa', modal.areas.length === 3 && modal.areas.every(h => h >= 56), JSON.stringify(modal.areas));
  // Tocar la fila (no la casilla) desmarca el área
  // .click() del DOM: sin depender de dónde quede el modal en la ventana
  await p.evaluate(() => { const s = document.querySelector('#nuevoInventarioModal .ni-area:nth-child(2) span') || document.querySelectorAll('#nuevoInventarioModal label span')[1]; if (s) s.click(); });
  chk('Tocar el nombre del área cambia la casilla', await p.evaluate(() => !document.querySelectorAll('.nuevoInvArea')[1].checked), '');
  chk('Los ids que usa la lógica del modal siguen iguales',
      await p.evaluate(() => ['nuevoInvNombre', 'nuevoInvFecha', 'nuevoInvAvisoFecha', 'nuevoInvCreadoPor', 'nuevoInvAreas', 'nuevoInvComentario', 'nuevoInvBtnCrear']
          .every(id => !!document.getElementById(id))), '');

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── FASE 10B · Inventario Físico para el pulgar (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
