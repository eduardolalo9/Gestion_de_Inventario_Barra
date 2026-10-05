// REDISEÑO R7c — Ventas, en pantalla real (Chromium, 390×844), tema oscuro y claro.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
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
  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['*']);
    products = [
      { id: '1180001', name: '1800 ANIEJO 700 ML', group: 'TEQUILA', unit: 'PZA', precio: 350, conversion: 700 }
    ];
    recetas = [
      { id: 'r1', pv: 'PVB1000006', nombre: 'COPA', activa: true, ingredientes: [{ productoId: '1180001', cantidad: 0.06, uom: 'PZA' }] },
      { id: 'r2', pv: 'PVB1000099', nombre: 'COLADA', activa: true, ingredientes: [{ productoId: '9999999', cantidad: 1, uom: 'PZA', descripcionExcel: 'CREMA DE COCO' }] }
    ];
    ventas = [
      { sku: 'PVB1000006', nombre: '1800 Anejo Cristal Copa', cantidad: 7 },
      { sku: 'PVB1000099', nombre: 'Pina Colada', cantidad: 10 },
      { sku: 'PVB7777777', nombre: 'Bebida nueva sin receta', cantidad: 5 }
    ];
    const lunes = semanaId(new Date());
    ventasSemanaId = lunes;
    ventasPeriodos = [{ inicio: lunes, fin: lunes }];
    consumoTeoricoInvalidar();
  });

  const medir = (tema) => p.evaluate((tema) => {
    document.documentElement.setAttribute('data-theme', tema);
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const cont = document.getElementById('tabContent');
    const opaco = (el) => { const c = getComputedStyle(el).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'; };
    // contraste WCAG entre el color del texto y el fondo efectivo (se sube por los ancestros)
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const fondoEfectivo = (el) => { let e = el; while (e) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > .5)) return c; e = e.parentElement; } return [0, 0, 0]; };
    const mezcla = (el) => { // fondo con alfa sobre el fondo del ancestro
      const c = rgb(getComputedStyle(el).backgroundColor); const base = fondoEfectivo(el.parentElement || el);
      if (c.length === 4 && c[3] < 1) return [0, 1, 2].map(i => c[i] * c[3] + base[i] * (1 - c[3]));
      return c.slice(0, 3);
    };
    const contraste = (el) => { const fg = rgb(getComputedStyle(el).color).slice(0, 3); const bg = mezcla(el); const a = lum(fg), b = lum(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
    const nota = (cls) => { const e = cont.querySelector('.vt-nota--' + cls); return e ? { opaco: opaco(e), contraste: +contraste(e).toFixed(2), icono: !!e.querySelector('i.fa-solid') } : null; };
    const celdaNum = cont.querySelector('.vt-num');
    const tabla = cont.querySelector('.vt-tabla--densa');
    const sobra = document.documentElement.scrollWidth > window.innerWidth + 1;
    return {
      emoji: (cont.innerText.match(re) || []).join(' '),
      aviso: nota('aviso'), error: nota('error'), info: nota('info'),
      numAlign: celdaNum ? getComputedStyle(celdaNum).textAlign : null,
      numFont: celdaNum ? getComputedStyle(celdaNum).fontFamily : null,
      filas: cont.querySelectorAll('.vt-tabla tr').length,
      tarjetas: cont.querySelectorAll('.vt-panel').length,
      diaOk: (() => { const d = cont.querySelector('.vt-dia--ok'); return d ? { icono: !!d.querySelector('i.fa-circle-check'), contraste: +contraste(d).toFixed(2), ancho: d.getBoundingClientRect().width } : null; })(),
      estilosEnLinea: cont.querySelectorAll('[style]').length,
      scrollHorizontal: sobra
    };
  }, tema);

  // ══ A · LISTA DE VENTAS + CONSUMO TEÓRICO (oscuro y claro) ═══════════════
  await p.evaluate(() => { ventasImportView = 'lista'; activeTab = 'ventas'; renderTab(); });
  await p.waitForTimeout(200);
  for (const tema of ['dark', 'light']) {
    const m = await medir(tema);
    chk('[' + tema + '] ★ La lista de Ventas no trae emoji de interfaz', m.emoji === '', m.emoji);
    chk('[' + tema + '] ★ Cero atributos style="…" en la pantalla de Ventas', m.estilosEnLinea === 0, String(m.estilosEnLinea));
    chk('[' + tema + '] Aviso "sin receta": fondo real, icono y contraste ≥ 4.5', m.aviso && m.aviso.opaco && m.aviso.icono && m.aviso.contraste >= 4.5, JSON.stringify(m.aviso));
    chk('[' + tema + '] Aviso "insumo fuera del catálogo": fondo real, icono y contraste ≥ 4.5', m.error && m.error.opaco && m.error.icono && m.error.contraste >= 4.5, JSON.stringify(m.error));
    chk('[' + tema + '] Las cifras van a la derecha y en IBM Plex Mono', m.numAlign === 'right' && /Plex Mono/i.test(m.numFont || ''), m.numAlign + ' / ' + m.numFont);
    chk('[' + tema + '] Día con ventas: lleva check (no solo color), contraste ≥ 3 y objetivo ≥ 36 px de ancho', m.diaOk && m.diaOk.icono && m.diaOk.contraste >= 3 && m.diaOk.ancho >= 36, JSON.stringify(m.diaOk));
    chk('[' + tema + '] Sin desbordamiento horizontal a 390 px', !m.scrollHorizontal, '');
  }

  // ══ B · VISTA PREVIA DE LA IMPORTACIÓN ═══════════════════════════════════
  await p.evaluate(() => {
    const hoy = fechaISOLocal(new Date());
    ventasImportView = 'vista_previa';
    const periodo = { inicio: hoy, fin: hoy };
    const v = validarPeriodoVentas(periodo.inicio, periodo.fin, []);
    _ventasImportPendiente = {
      hoja: 'Detalle', archivo: 'ventas.xlsx', totalUnidades: 22, filasIgnoradas: 2, excedeTope: false,
      periodo, existentes: { estado: 'ok', periodos: [], semanaId: v.semanaId },
      lineas: [{ sku: 'A', nombre: 'Margarita', cantidad: 12 }, { sku: 'B', nombre: 'Paloma', cantidad: 10 }],
      incidencias: [{ sku: 'A', detalle: 'cantidad negativa' }],
      skusAgrupados: [{ nombre: 'Margarita 2x1', filas: 2 }]
    };
    renderTab();
  });
  await p.waitForTimeout(200);
  const vp = await p.evaluate(() => {
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const cont = document.getElementById('tabContent');
    // FASE 14 — el botón pasó a "Procesar venta (baja el inventario)"; mismo id y misma regla.
    const btn = [...cont.querySelectorAll('button')].find(b => /Confirmar e importar|Procesar venta/.test(b.textContent));
    return {
      emoji: (cont.innerText.match(re) || []).join(' '),
      estilos: cont.querySelectorAll('[style]').length,
      confirmar: btn ? { habilitado: !btn.disabled, alto: btn.getBoundingClientRect().height, icono: !!btn.querySelector('i.fa-circle-check') } : null,
      iconosSinAncho: [...cont.querySelectorAll('i.fa-solid')].filter(i => i.getBoundingClientRect().width < 6).length,
      msgInfo: !!cont.querySelector('.vt-msg--info'),
      masVendidos: cont.querySelectorAll('.vt-tabla tr').length
    };
  });
  chk('★ La vista previa no tiene emoji (antes 📍 📅 ⚠️ ℹ️ ✅) ni estilos en línea', vp.emoji === '' && vp.estilos === 0, JSON.stringify(vp));
  chk('★ "Procesar venta" (antes "Confirmar e importar") con fechas válidas y servidor comprobado: habilitado, ≥ 48 px, con icono',
      vp.confirmar && vp.confirmar.habilitado && vp.confirmar.alto >= 48 && vp.confirmar.icono, JSON.stringify(vp.confirmar));
  chk('Todos los iconos de la vista previa tienen ancho real (el kit los pinta)', vp.iconosSinAncho === 0, String(vp.iconosSinAncho));
  chk('Se listan los más vendidos y el aviso de SKU agrupados', vp.masVendidos === 2 && vp.msgInfo, JSON.stringify(vp));

  // ══ C · RESULTADO CON INCIDENCIAS Y ERROR ════════════════════════════════
  await p.evaluate(() => {
    ventasImportView = 'incidencias';
    _ventasImportResultado = { guardado: false, motivo: 'sin permiso en el servidor', inicio: null, fin: null, incidencias: [{ sku: 'A', detalle: 'cantidad negativa' }] };
    renderTab();
  });
  await p.waitForTimeout(150);
  const rs = await p.evaluate(() => {
    const cont = document.getElementById('tabContent');
    const e = cont.querySelector('.vt-txt-error');
    return { texto: !!e && /No se guardó/.test(e.textContent), icono: !!(e && e.querySelector('i.fa-circle-exclamation')), inc: cont.querySelectorAll('.vt-inc').length, estilos: cont.querySelectorAll('[style]').length };
  });
  chk('★ "No se guardó": palabra + icono (el rojo no va solo) y la incidencia se pinta con su clase',
      rs.texto && rs.icono && rs.inc === 1 && rs.estilos === 0, JSON.stringify(rs));

  // ══ D · SIN PERMISO Y VACÍO ══════════════════════════════════════════════
  await p.evaluate(() => { ventasImportView = 'lista'; ventas = []; ventasPeriodos = []; renderTab(); });
  await p.waitForTimeout(100);
  const vacio = await p.evaluate(() => {
    const cont = document.getElementById('tabContent');
    const i = cont.querySelector('.vt-vacio i');
    return { icono: i ? i.getBoundingClientRect().width : 0, emoji: /[\u{1F300}-\u{1FAFF}]/u.test(cont.innerText), txt: cont.innerText.slice(0, 80) };
  });
  chk('★ El vacío de Ventas usa icono del kit (antes 📈), no emoji', vacio.icono >= 6 && !vacio.emoji, JSON.stringify(vacio));
  await p.evaluate(() => { _authzState.permissions = new Set([]); renderTab(); });
  await p.waitForTimeout(100);
  const sinAcceso = await p.evaluate(() => {
    const cont = document.getElementById('tabContent');
    return { lock: !!cont.querySelector('.fa-lock'), emoji: /[\u{1F300}-\u{1FAFF}]/u.test(cont.innerText), txt: /No tienes acceso a las ventas/.test(cont.innerText) };
  });
  chk('★ Sin sales.read: candado del kit + texto "No tienes acceso" (antes 🔒)', sinAcceso.lock && !sinAcceso.emoji && sinAcceso.txt, JSON.stringify(sinAcceso));

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── REDISEÑO R7c · Ventas (navegador) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})();
