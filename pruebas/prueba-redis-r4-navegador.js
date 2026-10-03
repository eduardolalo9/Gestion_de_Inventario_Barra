#!/usr/bin/env node
/**
 * prueba-redis-r4-navegador.js — REDISEÑO R4 · Conteo · navegador
 * ═══════════════════════════════════════════════════════════════════════════
 * DECISIÓN DE EDUARDO: "Mejor dejarlo en el modal, como dijiste antes". El
 * flujo del conteo NO cambia. Por eso la primera sección de esta prueba
 * comprueba que sigue funcionando igual: se toca la tarjeta, se abre el
 * modal, se captura, se guarda y el número llega a su sitio.
 *
 * LECCIÓN DE R3, APLICADA AQUÍ. En R3 borré sin querer las reglas de los
 * botones de la tarjeta y las tres capas de pruebas pasaron en verde con
 * tres ladrillos blancos en pantalla, porque comprobaban que los botones
 * EXISTEN. Esta prueba pregunta por el ASPECTO: tamaños reales, tipografía
 * real, color real, y ningún elemento con el gris de fábrica del navegador.
 *
 *   PUERTO=8080 node pruebas/prueba-redis-r4-navegador.js
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
// El gris con el que Chromium pinta un <button> al que no le llegó ninguna regla.
const GRIS_DE_FABRICA = /rgb\(239, 239, 239\)|buttonface/i;

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

  // Catálogo con los dos modos de captura que existen: botella (oz) y cantidad.
  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['*']);
    products = [
      { id: 'DJ7', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'PZA', stockMinimo: 4,
        conversion: 700, capacidadMl: 700, pesoBotellaLlenaOz: 53.65, conteoOzHabilitado: true,
        precio: 1480, stockByArea: { almacen: 8 } },
      { id: 'ACE', name: 'ACEITUNA SIN HUESO', group: 'ABARROTES', unit: 'KGS', stockMinimo: 3,
        conversion: 1, precio: 180, stockByArea: { almacen: 1.7 } },
      { id: 'JWB', name: 'JOHNNIE WALKER BLACK LABEL', group: 'WHISKY', unit: 'PZA', stockMinimo: 3,
        conversion: 750, precio: 980, stockByArea: { almacen: 2 } }
    ];
    // ACEITUNA con 1.245: el caso del HOTFIX de decimales.
    auditoriaConteo = {
      DJ7: { almacen: { enteras: 3, abiertas: [32.5, 18.2] } },
      ACE: { almacen: { enteras: 0, abiertas: [1.245], _hayConflicto: true } }
    };
    myAuditoriaConteo = auditoriaConteo; allUsersAuditoria = {};
    isAuditoriaMode = true; auditoriaView = 'counting'; auditoriaAreaActiva = 'almacen';
    activeTab = 'inventario'; renderTab();
  });
  await p.waitForTimeout(400);

  // ══ A · EL FLUJO NO CAMBIÓ ═══════════════════════════════════════════════
  const flujo = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.inv-card')].find(x => x.textContent.includes('DON JULIO 70'));
    return {
      tarjetas: document.querySelectorAll('.inv-card').length,
      abrePorClic: !!(c && (c.getAttribute('onclick') || '').includes('openInventarioModal')),
      esAccesible: !!(c && c.getAttribute('role') === 'button' && c.getAttribute('tabindex') === '0'),
      tieneTeclado: !!(c && (c.getAttribute('onkeydown') || '').includes('openInventarioModal')),
      modalOculto: document.getElementById('inventarioModal').classList.contains('hidden')
    };
  });
  chk('★ Siguen las tarjetas de producto del conteo', flujo.tarjetas === 3, 'tarjetas: ' + flujo.tarjetas);
  chk('★ Tocar la tarjeta sigue abriendo el modal de captura', flujo.abrePorClic === true,
      'el flujo no cambia: es la decisión de Eduardo');
  chk('La tarjeta sigue siendo accesible por teclado', flujo.esAccesible && flujo.tieneTeclado);
  chk('El modal arranca cerrado', flujo.modalOculto === true);

  // Abrir el modal de un producto que se cuenta por botella.
  await p.evaluate(() => openInventarioModal('DJ7'));
  await p.waitForTimeout(350);
  const abierto = await p.evaluate(() => {
    const m = document.getElementById('inventarioModal');
    return {
      visible: !m.classList.contains('hidden'),
      titulo: (document.getElementById('inventarioModalTitle') || {}).textContent,
      sub: (document.getElementById('inventarioModalSubtitle') || {}).textContent,
      enteras: (document.getElementById('inv_enteras') || {}).value,
      abiertas: [...document.querySelectorAll('#inv_abiertasContainer input')].map(i => i.value),
      bloqueBotella: getComputedStyle(document.getElementById('inv_bloqueBotella')).display,
      bloqueCantidad: getComputedStyle(document.getElementById('inv_bloqueCantidad')).display
    };
  });
  chk('★ El modal se abre con lo ya contado, no desde cero',
      abierto.visible && abierto.enteras === '3' && abierto.abiertas.length === 2,
      JSON.stringify(abierto));
  chk('En modo botella se ve el bloque de botellas y no el de cantidad',
      abierto.bloqueBotella !== 'none' && abierto.bloqueCantidad === 'none',
      JSON.stringify({ bot: abierto.bloqueBotella, cant: abierto.bloqueCantidad }));

  // ══ B · EL MODAL, COMO SE VE ═════════════════════════════════════════════
  const modal = await p.evaluate(() => {
    const med = s => { const e = document.querySelector(s); if (!e) return null;
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return { w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor,
               color: cs.color, font: cs.fontFamily, size: parseFloat(cs.fontSize),
               tabular: cs.fontVariantNumeric }; };
    const m = document.getElementById('inventarioModal');
    return {
      scrim: getComputedStyle(m).backgroundColor,
      enteras: med('#inv_enteras'),
      abierta: med('#inv_abiertasContainer input'),
      agregar: med('.inv-modal__agregar'),
      cancelar: med('.inv-modal__btn--fantasma'),
      guardar: med('.inv-modal__btn--primario'),
      // ¿La etiqueta de abiertas y el botón de agregar se pisan? Antes sí: el
      // botón compartía fila con la etiqueta y la tapaba al crecer a dos líneas.
      seSolapan: (() => {
        const l = document.getElementById('inv_abiertasLabel');
        const b = document.querySelector('.inv-modal__agregar');
        if (!l || !b) return null;
        const a = l.getBoundingClientRect(), c = b.getBoundingClientRect();
        return !(c.top >= a.bottom - 1 || c.bottom <= a.top + 1 || c.left >= a.right - 1 || c.right <= a.left + 1);
      })()
    };
  });
  chk('★ El campo de enteras es mono tabular (es la cifra que se escribe)',
      /Plex Mono/.test(modal.enteras.font || ''), modal.enteras.font);
  chk('★ El campo de enteras es grande de leer (≥ 20 px)',
      modal.enteras.size >= 20, 'tamaño: ' + modal.enteras.size);
  chk('★ El campo de enteras es táctil (≥ 48 px de alto)',
      modal.enteras.h >= 48, 'alto: ' + modal.enteras.h);
  chk('★ El campo de una botella abierta también es mono tabular y táctil',
      /Plex Mono/.test(modal.abierta.font || '') && modal.abierta.h >= 44,
      JSON.stringify(modal.abierta));
  chk('★ "Agregar otra abierta" ya no pisa la etiqueta de al lado',
      modal.seSolapan === false, 'se solapaban: ' + modal.seSolapan);
  chk('★ "Agregar" dejó de ser el botón azul de la paleta anterior',
      !/rgb\(111, 178, 232\)/.test(modal.agregar.bg) && !GRIS_DE_FABRICA.test(modal.agregar.bg),
      'fondo: ' + modal.agregar.bg);
  chk('★ Guardar es el único latón del modal (el latón se gana)',
      /rgb\(232, 181, 92\)/.test(modal.guardar.bg) &&
      !/rgb\(232, 181, 92\)/.test(modal.agregar.bg) &&
      !/rgb\(232, 181, 92\)/.test(modal.cancelar.bg),
      JSON.stringify({ guardar: modal.guardar.bg, agregar: modal.agregar.bg, cancelar: modal.cancelar.bg }));
  chk('Cancelar y Guardar son táctiles (≥ 44 px)',
      modal.cancelar.h >= 44 && modal.guardar.h >= 44,
      JSON.stringify({ c: modal.cancelar.h, g: modal.guardar.h }));
  chk('El velo del modal usa el token del sistema, no un negro a mano',
      /rgba?\(5, 6, 8/.test(modal.scrim) || /rgba\(0, 0, 0, 0\.7/.test(modal.scrim), modal.scrim);

  const sinGris = await p.evaluate((re) => {
    const rx = new RegExp(re, 'i');
    return [...document.querySelectorAll('#inventarioModal button, #inventarioModal input')]
      .filter(e => rx.test(getComputedStyle(e).backgroundColor))
      .map(e => e.className || e.id);
  }, GRIS_DE_FABRICA.source);
  chk('★ Ningún botón ni campo del modal se quedó con el gris de fábrica',
      sinGris.length === 0, 'sin estilo: ' + sinGris.join(', '));

  const sinEmojiModal = await p.evaluate(() =>
    !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.getElementById('inventarioModal').innerText));
  chk('★ El modal ya no usa emoji como iconografía', sinEmojiModal === true);

  // ══ C · GUARDAR SIGUE GUARDANDO ══════════════════════════════════════════
  await p.evaluate(() => {
    document.getElementById('inv_enteras').value = '5';
    saveInventarioModal();
  });
  await p.waitForTimeout(400);
  const guardado = await p.evaluate(() => ({
    enteras: (myAuditoriaConteo.DJ7 && myAuditoriaConteo.DJ7.almacen || {}).enteras,
    cerrado: document.getElementById('inventarioModal').classList.contains('hidden')
  }));
  chk('★ Guardar sigue escribiendo el conteo y cerrando el modal',
      guardado.enteras === 5 && guardado.cerrado === true, JSON.stringify(guardado));

  // ══ D · MODO CANTIDAD (el otro modo de captura) ══════════════════════════
  await p.evaluate(() => openInventarioModal('ACE'));
  await p.waitForTimeout(350);
  const cantidad = await p.evaluate(() => {
    const i = document.getElementById('inv_cantidadTotal');
    const cs = i ? getComputedStyle(i) : null;
    return {
      bloqueCantidad: getComputedStyle(document.getElementById('inv_bloqueCantidad')).display,
      bloqueBotella: getComputedStyle(document.getElementById('inv_bloqueBotella')).display,
      font: cs ? cs.fontFamily : null,
      size: cs ? parseFloat(cs.fontSize) : null
    };
  });
  chk('★ En modo cantidad se ve el campo único y no el de botellas',
      cantidad.bloqueCantidad !== 'none' && cantidad.bloqueBotella === 'none',
      JSON.stringify(cantidad));
  chk('El campo de cantidad también es mono tabular y grande',
      /Plex Mono/.test(cantidad.font || '') && cantidad.size >= 20, JSON.stringify(cantidad));
  await p.evaluate(() => closeInventarioModal());
  await p.waitForTimeout(250);

  // ══ E · LA TARJETA DE CONTEO ═════════════════════════════════════════════
  const tarjeta = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.inv-card')].find(x => x.textContent.includes('ACEITUNA'));
    if (!c) return { falta: true };
    const mono = c.querySelector('.bi-mono');
    const total = c.querySelector('.inv-card__total-n');
    const nombre = c.querySelector('.inv-card__name');
    const chips = [...c.querySelectorAll('.inv-chip__val')].map(x => x.textContent.trim());
    const badge = c.querySelector('.inv-card__conflict-badge .bi-badge');
    const cs = total ? getComputedStyle(total) : null;
    return {
      mono: mono ? mono.textContent.trim() : null,
      totalTexto: total ? total.textContent.trim() : null,
      totalFuente: cs ? cs.fontFamily : null,
      totalTam: cs ? parseFloat(cs.fontSize) : null,
      totalALaDerecha: (total && nombre)
        ? total.getBoundingClientRect().left > nombre.getBoundingClientRect().right - 2 : null,
      chips: chips,
      badgeKit: !!badge,
      badgeTexto: badge ? badge.textContent.trim() : null
    };
  });
  chk('★ La tarjeta de conteo lleva el MISMO monograma que en Inicio',
      tarjeta.mono === 'ASH', 'monograma: ' + tarjeta.mono);
  chk('★ El total es la cifra grande de la tarjeta, a la derecha y en mono',
      /Plex Mono/.test(tarjeta.totalFuente || '') && tarjeta.totalTam >= 15 &&
      tarjeta.totalALaDerecha === true, JSON.stringify(tarjeta));
  /**
   * EL MISMO NÚMERO, UN SOLO VALOR.
   * El HOTFIX de decimales arregló el total (1.245, no 1.25) pero el chip se
   * quedó en toFixed(2): la misma tarjeta mostraba 1.245 arriba y 1.25 abajo.
   * R4 aplica al chip el mismo redondeo. Esta comprobación lo fija.
   */
  chk('★ El chip y el total muestran el MISMO número (1.245, no 1.25)',
      tarjeta.totalTexto === '1.245' && tarjeta.chips.includes('1.245'),
      JSON.stringify({ total: tarjeta.totalTexto, chips: tarjeta.chips }));
  chk('★ El conflicto lo pinta un badge del kit, no una píldora propia',
      tarjeta.badgeKit === true && /conflicto/i.test(tarjeta.badgeTexto || ''),
      JSON.stringify(tarjeta));

  // Sin contar ≠ contado en cero: el primero sale apagado.
  const vacio = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.inv-card')].find(x => x.textContent.includes('JOHNNIE'));
    const t = c ? c.querySelector('.inv-card__total') : null;
    const n = c ? c.querySelector('.inv-card__total-n') : null;
    return t ? { clase: t.className, opacidad: n ? getComputedStyle(n).opacity : null } : { falta: true };
  });
  chk('★ Un producto sin contar se distingue de uno contado en cero',
      /inv-card__total--vacio/.test(vacio.clase || '') && parseFloat(vacio.opacidad) < 1,
      JSON.stringify(vacio));

  // ══ F · NI UN RESTO DE LA PALETA ANTERIOR, EN PANTALLA ═══════════════════
  const restos = await p.evaluate(() => {
    const AZULES = ['rgb(37, 99, 235)', 'rgb(29, 78, 216)', 'rgb(129, 140, 248)', 'rgb(124, 58, 237)'];
    const malos = [];
    document.querySelectorAll('#tabContent *, #inventarioModal *').forEach(e => {
      const cs = getComputedStyle(e);
      // Los iconos locales son máscaras: su background-color ES la tinta
      // (currentColor), así que un icono dentro de un botón de texto blanco sale
      // legítimamente con el fondo blanco. No son fondos, son dibujos.
      const esIcono = (cs.maskImage && cs.maskImage !== 'none') ||
                      (cs.webkitMaskImage && cs.webkitMaskImage !== 'none');
      if (esIcono) return;
      if (AZULES.includes(cs.backgroundColor) || AZULES.includes(cs.color)) {
        malos.push((e.className || e.tagName) + ' ' + cs.backgroundColor + '/' + cs.color);
      }
      if (cs.backgroundColor === 'rgb(255, 255, 255)') malos.push('BLANCO: ' + (e.className || e.tagName));
    });
    return malos.slice(0, 5);
  });
  chk('★ Ni un azul de la paleta anterior ni un fondo blanco en el conteo',
      restos.length === 0, restos.join(' | '));

  const sinEmojiPantalla = await p.evaluate(() => {
    const t = document.getElementById('tabContent').innerText;
    const m = t.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
    return m ? m.join(' ') : '';
  });
  chk('★ La pantalla de conteo ya no usa emoji como iconografía',
      sinEmojiPantalla === '', 'quedan: ' + sinEmojiPantalla);

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));

  // ── Resultado ───────────────────────────────────────────────────────────
  const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
  console.log('\n  ── REDISEÑO R4 · Conteo (navegador) ──\n');
  casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
  console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  await nav.close();
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
