#!/usr/bin/env node
/**
 * prueba-redis-r5-navegador.js — REDISEÑO R5 · Inventario y áreas · navegador
 * ═══════════════════════════════════════════════════════════════════════════
 * R5 re-pinta Historial, Físico vs Sistema y el Detalle de un inventario
 * cerrado: el envoltorio Tailwind crudo de antes de R1 pasa a ser la tarjeta
 * del kit, el hex escrito a mano pasa a ser tokens, y el emoji pasa a ser
 * icono local. NINGUNA lógica cambia — no hay flujo que romper aquí (son
 * pantallas de solo lectura), así que esta prueba se concentra en el
 * ASPECTO real: nada de gris de fábrica, nada de fondo blanco, nada de
 * emoji, botones distinguibles por peso visual (el latón se gana).
 *
 *   PUERTO=8080 node pruebas/prueba-redis-r5-navegador.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const { chromium } = require('playwright');
const PUERTO = process.env.PUERTO || '8080';

const casos = [];
let fallos = 0;
function chk(nombre, ok, detalle) {
  casos.push({ nombre, ok: !!ok, detalle: detalle || '' });
  if (!ok) fallos++;
}
const GRIS_DE_FABRICA = /rgb\(239, 239, 239\)|buttonface/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

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

  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['*']); // admin: ve todo lo de R5
    products = [];
    allUsersAuditoria = {};
  });

  // ══ A · HISTORIAL DE INVENTARIOS ═════════════════════════════════════════
  await p.evaluate(() => {
    _historialInventarios = [
      { inventoryId: 'inv-cerrado', numero: 120, estado: 'CERRADO', fechaCreacion: Date.now(), totalProductos: 40 },
      { inventoryId: 'inv-contab', numero: 121, estado: 'CONTABILIZADO', fechaCreacion: Date.now(),
        totalProductos: 40, semanaDestino: '2026-09-28', mesDestino: '2026-09' }
    ];
    activeTab = 'inventario'; auditoriaView = 'historial'; renderTab();
  });
  await p.waitForTimeout(250);

  const historialReal = await p.evaluate((grisRe) => {
    const rx = new RegExp(grisRe, 'i');
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const cont = document.getElementById('tabContent');
    const volver = cont.querySelector('.audit-back-btn');
    const filas = [...cont.querySelectorAll('.rc-hist')];
    const badges = [...cont.querySelectorAll('.bi-badge')].map(b => ({
      texto: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor
    }));
    const grisores = [...cont.querySelectorAll('button')]
      .filter(b => rx.test(getComputedStyle(b).backgroundColor)).map(b => b.className);
    const blancos = [...cont.querySelectorAll('*')]
      .filter(e => getComputedStyle(e).backgroundColor === 'rgb(255, 255, 255)').map(e => e.className || e.tagName);
    const volverIcono = volver ? volver.querySelector('.fa-chevron-left') : null;
    return {
      volverExiste: !!volver, volverTexto: volver ? volver.textContent.trim() : null,
      volverTieneIcono: !!volverIcono,
      volverIconoAncho: volverIcono ? volverIcono.getBoundingClientRect().width : 0,
      filas: filas.length, badges: badges,
      grisores: grisores, blancos: blancos,
      emoji: (cont.innerText.match(re) || []).join(' ')
    };
  }, GRIS_DE_FABRICA.source);

  chk('★ El Historial usa el botón "Volver" del kit, con su icono',
      historialReal.volverExiste && /Volver/.test(historialReal.volverTexto) && historialReal.volverTieneIcono,
      JSON.stringify(historialReal.volverTexto));
  /**
   * BUG REAL ENCONTRADO EN R5, SOLO POR CAPTURA DE PANTALLA: con el título
   * largo "Historial de Inventarios Físicos" envuelto a dos líneas, el icono
   * del botón "Volver" no tenía flex-shrink propio y el layout lo encogía a
   * 0 px — el botón se veía sin flecha. Corregido en .audit-back-btn (R5).
   * Esta comprobación fija el ancho real, no solo la existencia en el DOM.
   */
  chk('★ El icono de "Volver" tiene ancho real (no se encogió a 0 px con el título a dos líneas)',
      historialReal.volverIconoAncho >= 8, 'ancho: ' + historialReal.volverIconoAncho);
  chk('★ Las dos filas del historial se pintan con la tarjeta compartida (.rc-hist)',
      historialReal.filas === 2, 'filas: ' + historialReal.filas);
  chk('★ CERRADO y CONTABILIZADO llevan cada uno su badge del kit, con color real (no transparente)',
      historialReal.badges.length === 2 &&
      historialReal.badges.every(b => b.bg !== 'rgba(0, 0, 0, 0)' && b.bg !== 'transparent'),
      JSON.stringify(historialReal.badges));
  chk('Los dos badges dicen palabras distintas (Cerrado / Contabilizado), nunca solo color',
      /cerrado/i.test(historialReal.badges[0].texto) && /contabilizado/i.test(historialReal.badges[1].texto),
      JSON.stringify(historialReal.badges));
  chk('★ Ningún botón del Historial se quedó con el gris de fábrica',
      historialReal.grisores.length === 0, historialReal.grisores.join(', '));
  chk('★ Ni un fondo blanco en el Historial (ya no queda el bg-white de antes de R1)',
      historialReal.blancos.length === 0, historialReal.blancos.join(', '));
  chk('★ El Historial ya no usa emoji como iconografía',
      historialReal.emoji === '', 'quedan: ' + historialReal.emoji);

  // ══ B · DETALLE DE UN INVENTARIO CERRADO ═════════════════════════════════
  await p.evaluate(() => {
    _detalleInventarioCerradoId = 'inv-contab';
    _detalleInventarioCerradoData = {
      meta: { numero: 121, estado: 'CONTABILIZADO', fechaCreacion: Date.now(), fechaCierre: Date.now(),
              creadoPorNombre: 'Eduardo', cerradoPorNombre: 'Eduardo', totalProductos: 40,
              semanaDestino: '2026-09-28', mesDestino: '2026-09', contabilizadoEn: Date.now() },
      registros: [
        { tipo: 'usuario', email: 'bar1@test.com', uid: 'u1', status: { almacen: 'completada' }, isAdmin: false }
      ]
    };
    auditoriaView = 'detalle_cerrado'; renderTab();
  });
  await p.waitForTimeout(250);

  const detalle = await p.evaluate((grisRe) => {
    const rx = new RegExp(grisRe, 'i');
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const cont = document.getElementById('tabContent');
    const volver = cont.querySelector('.audit-back-btn');
    const exportar = [...cont.querySelectorAll('button')].find(b => /Exportar Excel/.test(b.textContent));
    const pasoHecho = cont.querySelector('.pm-paso--hecho');
    const blancos = [...cont.querySelectorAll('*')]
      .filter(e => getComputedStyle(e).backgroundColor === 'rgb(255, 255, 255)').map(e => e.className || e.tagName);
    const grisores = [...cont.querySelectorAll('button')]
      .filter(b => rx.test(getComputedStyle(b).backgroundColor)).map(b => b.className);
    return {
      volverExiste: !!volver, volverTieneIcono: volver ? !!volver.querySelector('.fa-chevron-left') : false,
      exportarExiste: !!exportar,
      exportarIcono: exportar ? !!exportar.querySelector('.fa-download') : false,
      pasoHechoExiste: !!pasoHecho,
      pasoHechoTexto: pasoHecho ? pasoHecho.textContent.trim() : null,
      blancos: blancos, grisores: grisores,
      emoji: (cont.innerText.match(re) || []).join(' ')
    };
  }, GRIS_DE_FABRICA.source);

  chk('★ El detalle cerrado usa el botón "Volver" del kit, con su icono', detalle.volverExiste && detalle.volverTieneIcono);
  chk('★ "Exportar Excel" existe con su icono (no el emoji 📥 de antes)',
      detalle.exportarExiste && detalle.exportarIcono);
  chk('★ Un inventario CONTABILIZADO muestra el paso "Contabilizado" con sus dos destinos',
      detalle.pasoHechoExiste && /semana 2026-09-28/.test(detalle.pasoHechoTexto) &&
      /mes 2026-09/.test(detalle.pasoHechoTexto), detalle.pasoHechoTexto);
  chk('★ Ni un fondo blanco en el detalle cerrado', detalle.blancos.length === 0, detalle.blancos.join(', '));
  chk('★ Ningún botón del detalle cerrado se quedó con el gris de fábrica',
      detalle.grisores.length === 0, detalle.grisores.join(', '));
  chk('★ El detalle cerrado ya no usa emoji como iconografía', detalle.emoji === '', 'quedan: ' + detalle.emoji);

  // ══ C · CONTABILIZAR, CUANDO SÍ SE PUEDE (botón primario = el único latón) ═
  await p.evaluate(() => {
    _detalleInventarioCerradoId = 'inv-pend';
    _detalleInventarioCerradoData = {
      meta: { numero: 130, estado: 'CERRADO', fechaCreacion: Date.now(), fechaCierre: Date.now(),
              creadoPorNombre: 'Eduardo', cerradoPorNombre: 'Eduardo', totalProductos: 10,
              fechaRecuento: '2026-09-27', semanaId: '2026-09-21' },
      registros: []
    };
    window.evaluarContabilizable = () => ({ puede: true, motivo: null });
    auditoriaView = 'detalle_cerrado'; renderTab();
  });
  await p.waitForTimeout(250);
  const contab = await p.evaluate(() => {
    const cont = document.getElementById('tabContent');
    const btn = [...cont.querySelectorAll('button')].find(b => /^\s*Contabilizar\s*$/.test(b.textContent.trim()));
    const cs = btn ? getComputedStyle(btn) : null;
    return { existe: !!btn, icono: btn ? !!btn.querySelector('.fa-book') : false, bg: cs ? cs.backgroundColor : null };
  });
  chk('★ El botón "Contabilizar" del detalle es bt--primario (el único latón de la pantalla)',
      contab.existe && contab.icono && /rgb\(232, 181, 92\)/.test(contab.bg || ''), JSON.stringify(contab));

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));

  // ── Resultado ───────────────────────────────────────────────────────────
  const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
  console.log('\n  ── REDISEÑO R5 · Inventario y áreas (navegador) ──\n');
  casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
  console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  await nav.close();
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
