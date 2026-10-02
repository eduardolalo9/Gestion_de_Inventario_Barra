// REDISEÑO R1 en la app real (Chromium): la app arranca y se PINTA correcta
// sin Tailwind ni Font Awesome en el CDN.
//
// Esta es la prueba que de verdad protege el cambio. La estática comprueba que
// cada clase tiene una regla; esta comprueba lo que el navegador CALCULA: que
// un modal con `bg-white` ya no sale blanco, que un icono tiene su máscara,
// que el acento es latón y que nada quedó sin estilo en una pantalla real.
// Se usa getComputedStyle, no inspección de CSS: si el archivo no cargara, o
// el orden de las hojas fuera otro, esto fallaría.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d });
const PUERTO = process.env.PUERTO || '8080';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();

  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  // Se registra TODA petición a un dominio externo: así se demuestra que la
  // app ya no sale a buscar sus estilos a internet.
  const externas = [];
  p.on('request', r => {
    const u = r.url();
    if (/^https?:\/\//.test(u) && !u.includes('127.0.0.1') && !u.includes('localhost')) externas.push(u);
  });

  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);

  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  // ── A · Ya no se piden estilos a un CDN ────────────────────────────────
  const cdnEstilos = externas.filter(u => /tailwindcss\.com|font-awesome|fontawesome/.test(u));
  chk('★ Ninguna petición a Tailwind ni a Font Awesome',
      cdnEstilos.length === 0, cdnEstilos.join(' | '));
  chk('Las hojas locales sí se cargaron',
      await p.evaluate(() => {
        const hojas = [...document.styleSheets].map(h => h.href || '').join(' ');
        return hojas.includes('utilidades.css') && hojas.includes('estilos.css');
      }));
  // Google Fonts y el SDK de Firebase siguen siendo externos a propósito.
  chk('Lo que queda saliendo a internet es solo lo esperado (fuentes, Firebase, SheetJS)',
      externas.every(u => /fonts\.googleapis|fonts\.gstatic|gstatic\.com|firebase|googleapis|xlsx/.test(u)),
      externas.filter(u => !/fonts\.googleapis|fonts\.gstatic|gstatic\.com|firebase|googleapis|xlsx/.test(u)).join(' | '));

  // ── B · Los tokens de Carbón & Latón están vivos ───────────────────────
  const tok = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { accent: v('--accent'), brass: v('--brass'), bg: v('--bg'),
             book: v('--book'), scrim: v('--scrim'), ok: v('--ok'),
             onAccent: v('--accent-on') };
  });
  chk('★ El acento calculado es el latón #E8B55C',
      tok.accent.toUpperCase() === '#E8B55C', JSON.stringify(tok));
  chk('Los alias nuevos resuelven (--brass, --ok, --book, --scrim)',
      !!tok.brass && !!tok.ok && !!tok.book && !!tok.scrim, JSON.stringify(tok));
  chk('El fondo del body usa el token, no un color del navegador',
      await p.evaluate(() => {
        const bg = getComputedStyle(document.body).backgroundColor;
        return bg === 'rgb(14, 16, 19)';   // #0E1013
      }),
      await p.evaluate(() => getComputedStyle(document.body).backgroundColor));

  // ── C · EL ARREGLO: las utilidades claras ya no son claras ─────────────
  const util = await p.evaluate(() => {
    function medir(clase, prop) {
      const d = document.createElement('div');
      d.className = clase;
      document.body.appendChild(d);
      const v = getComputedStyle(d)[prop];
      d.remove();
      return v;
    }
    return {
      bgWhite:    medir('bg-white', 'backgroundColor'),
      txt900:     medir('text-gray-900', 'color'),
      txt600:     medir('text-gray-600', 'color'),
      borde:      medir('border-gray-200', 'borderTopColor'),
      velo:       medir('bg-black', 'backgroundColor'),
      flexDisp:   medir('flex', 'display'),
      gap3:       medir('gap-3', 'rowGap'),
      redondo:    medir('rounded-xl', 'borderTopLeftRadius'),
      textoSm:    medir('text-sm', 'fontSize'),
      sombra:     medir('shadow-md', 'boxShadow')
    };
  });
  chk('★ bg-white YA NO es blanco: es la superficie del tema oscuro',
      util.bgWhite !== 'rgb(255, 255, 255)' && util.bgWhite === 'rgb(28, 32, 39)',
      'calculado: ' + util.bgWhite + ' (esperado rgb(28, 32, 39) = #1C2027)');
  chk('★ text-gray-900 YA NO es casi negro: es el texto claro del tema',
      util.txt900 === 'rgb(232, 230, 227)',
      'calculado: ' + util.txt900);
  chk('text-gray-600 resuelve al texto secundario del tema',
      util.txt600 === 'rgb(180, 176, 170)', 'calculado: ' + util.txt600);
  chk('border-gray-200 resuelve al borde del tema (translúcido)',
      /rgba?\(180, 176, 170/.test(util.borde), 'calculado: ' + util.borde);
  chk('El velo del modal usa --scrim, no negro al 60 %',
      /rgba\(5, 6, 8/.test(util.velo), 'calculado: ' + util.velo);
  chk('★ Las utilidades de layout funcionan sin Tailwind (flex, gap, radio, texto, sombra)',
      util.flexDisp === 'flex' && util.gap3 === '12px' &&
      util.redondo !== '0px' && util.textoSm !== '' && util.sombra !== 'none',
      JSON.stringify(util));

  // ── D · Iconos locales ─────────────────────────────────────────────────
  const icono = await p.evaluate(() => {
    const i = document.createElement('i');
    i.className = 'fa-solid fa-users';
    i.style.color = 'rgb(95, 214, 138)';
    document.body.appendChild(i);
    const cs = getComputedStyle(i);
    const r = {
      display: cs.display,
      mascara: (cs.maskImage || cs.webkitMaskImage || ''),
      fondo: cs.backgroundColor,
      ancho: i.getBoundingClientRect().width
    };
    i.remove();
    return r;
  });
  chk('★ Un icono fa-* se pinta con máscara SVG local, sin la fuente de iconos',
      /url\("data:image\/svg\+xml/.test(icono.mascara), 'máscara: ' + icono.mascara.slice(0, 60));
  chk('…y hereda el color del texto (sale verde dentro de algo verde)',
      icono.fondo === 'rgb(95, 214, 138)', 'fondo calculado: ' + icono.fondo);
  chk('…y ocupa espacio en pantalla (no es un cuadro vacío)',
      icono.ancho > 4, 'ancho: ' + icono.ancho);

  // ── E · El kit pinta y cumple sus propias reglas ───────────────────────
  const kit = await p.evaluate(() => {
    if (typeof UI === 'undefined') return { falta: true };
    const caja = document.createElement('div');
    caja.innerHTML =
      UI.card({ etiqueta: 'Inventario físico', titulo: '#1001',
                badge: UI.badge('sincronizado'),
                cuerpo: UI.kpi(412, 431, 'contados') + UI.meter(412, 431) }) +
      UI.row({ mono: UI.mono('DON JULIO 70', 'TEQUILA'), nombre: 'DON JULIO 70',
               meta: 'TEQUILA · 700 ml', cifra: 8.65, decimales: 2, onclick: 'void 0' }) +
      UI.row({ nombre: 'SIN DATO', cifra: null }) +
      UI.btn('Contabilizar', { variante: 'primario' }) +
      UI.stepper({ id: 'st1', valor: 8 }) +
      UI.field({ id: 'f1', etiqueta: 'Peso botella llena', valor: '53.65', numerico: true }) +
      UI.badge('limitado') + UI.badge('contabilizado');
    document.body.appendChild(caja);

    const badge = caja.querySelector('.bi-badge');
    const cifra = caja.querySelector('.bi-row .bi-cifra');
    const mono  = caja.querySelector('.bi-mono');
    const btn   = caja.querySelector('.bi-btn');
    const stepBtn = caja.querySelector('.bi-stepper__btn');
    const fila  = caja.querySelector('.bi-row--accionable');
    const input = caja.querySelector('.bi-field__input');
    const label = caja.querySelector('.bi-field__etq');
    const segs  = caja.querySelectorAll('.bi-meter__seg');
    const encendidos = caja.querySelectorAll('.bi-meter__seg.is-on').length;
    const r = {
      badgeTexto: badge ? badge.textContent.trim() : null,
      badgeColor: badge ? getComputedStyle(badge).color : null,
      cifraFuente: cifra ? getComputedStyle(cifra).fontFamily : null,
      cifraTexto: cifra ? cifra.textContent.trim() : null,
      monoTexto: mono ? mono.textContent.trim() : null,
      btnAlto: btn ? btn.getBoundingClientRect().height : 0,
      stepAlto: stepBtn ? stepBtn.getBoundingClientRect().height : 0,
      filaEtiqueta: fila ? fila.tagName : null,
      inputFondo: input ? getComputedStyle(input).backgroundColor : null,
      labelFor: label ? label.getAttribute('for') : null,
      inputId: input ? input.id : null,
      segmentos: segs.length,
      encendidos: encendidos,
      sinDato: !!caja.querySelector('.bi-cifra--sin-dato'),
      aria: caja.querySelector('.bi-meter') ? caja.querySelector('.bi-meter').getAttribute('aria-label') : null
    };
    caja.remove();
    return r;
  });
  chk('El kit está disponible en la app y pinta', !kit.falta);
  chk('★ El badge lleva la palabra del estado, no solo color',
      kit.badgeTexto === 'Sincronizado', 'texto: ' + kit.badgeTexto);
  chk('★ La cifra sale en IBM Plex Mono',
      /Plex Mono/.test(kit.cifraFuente || ''), 'fuente: ' + kit.cifraFuente);
  chk('La cifra respeta los decimales pedidos', kit.cifraTexto === '8.65', 'texto: ' + kit.cifraTexto);
  chk('El monograma saca iniciales del nombre, sin imágenes',
      kit.monoTexto === 'DJ7', 'monograma: ' + kit.monoTexto);
  chk('★ Sin dato, la cifra es un guion (no un cero inventado)', kit.sinDato);
  chk('★ El botón mide 44 px o más (pulgar)', kit.btnAlto >= 44, 'alto: ' + kit.btnAlto);
  chk('★ Los controles del stepper miden 44 px', kit.stepAlto >= 44, 'alto: ' + kit.stepAlto);
  chk('★ Una fila accionable es un <button> de verdad (Tab la alcanza)',
      kit.filaEtiqueta === 'BUTTON', 'etiqueta: ' + kit.filaEtiqueta);
  chk('El campo tiene fondo hundido del tema, no blanco',
      kit.inputFondo === 'rgb(14, 16, 19)', 'fondo: ' + kit.inputFondo);
  chk('La etiqueta del campo está asociada a su input con for/id',
      kit.labelFor && kit.labelFor === kit.inputId, kit.labelFor + ' / ' + kit.inputId);
  chk('El medidor dibuja sus segmentos y enciende la proporción correcta',
      kit.segmentos === 12 && kit.encendidos === 11,
      'segmentos: ' + kit.segmentos + ', encendidos: ' + kit.encendidos + ' (412/431 ≈ 96 %)');
  chk('El medidor dice el avance en texto para lectores de pantalla',
      /96 por ciento/.test(kit.aria || ''), 'aria-label: ' + kit.aria);

  // ── F · Una pantalla real se pinta completa ────────────────────────────
  const pantalla = await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['*']);
    products = [
      { id: 'A', name: 'ACEITUNA SIN HUESO', group: 'ABARROTES', unit: 'KGS', stockMinimo: 3, conversion: 1, stockByArea: { almacen: 1.7, barra1: 0, barra2: 0 } },
      { id: 'B', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'PZA', stockMinimo: 4, conversion: 700, capacidadMl: 700, pesoBotellaLlenaOz: 53.65, conteoOzHabilitado: true, stockByArea: { almacen: 8, barra1: 0, barra2: 0 } }
    ];
    allUsersAuditoria = {}; _inventarioActivo = null;
    activeTab = 'inicio'; renderTab();
    const t = document.getElementById('tabContent');
    const cs = getComputedStyle(t);
    return {
      largo: t.innerText.trim().length,
      hayProducto: /ACEITUNA SIN HUESO/.test(t.innerText),
      colorTexto: cs.color,
      // Nada debe quedar con el blanco de Tailwind encima del fondo oscuro
      blancos: [...t.querySelectorAll('*')].filter(el => {
        const b = getComputedStyle(el).backgroundColor;
        return b === 'rgb(255, 255, 255)';
      }).length
    };
  });
  chk('La pestaña Inicio se pinta con contenido real',
      pantalla.largo > 100 && pantalla.hayProducto, JSON.stringify(pantalla).slice(0, 160));
  chk('★ No queda ningún elemento con fondo blanco de Tailwind sobre la app oscura',
      pantalla.blancos === 0, 'elementos blancos: ' + pantalla.blancos);
  chk('Sin errores de JS tras pintar', errs.length === 0, errs.join(' | '));

  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── REDISEÑO R1 · cimientos (navegador real) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
