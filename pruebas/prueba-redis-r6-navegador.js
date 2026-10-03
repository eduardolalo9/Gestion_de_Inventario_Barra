#!/usr/bin/env node
/**
 * prueba-redis-r6-navegador.js — REDISEÑO R6 · Catálogo y ficha · navegador
 * ═══════════════════════════════════════════════════════════════════════════
 * La ficha (#productModal) es un formulario, no una pantalla de solo
 * lectura: lo que importa comprobar en el navegador es que de verdad se ve
 * bien — nada de gris de fábrica, nada de fondo blanco, nada de emoji, y el
 * icono nuevo (fa-bottle) con ancho real, no colapsado a 0 px como pasó con
 * ".audit-back-btn" en R5. Se abre en los dos modos reales: Agregar (sin
 * producto) y Editar (con uno existente, para confirmar que los 12 campos
 * se repueblan).
 *
 *   PUERTO=8080 node pruebas/prueba-redis-r6-navegador.js
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
    _authzState.permissions = new Set(['*']); // admin: puede editar catálogo
    products = [
      { id: 'P1', name: 'TEQUILA DON JULIO', unit: 'Botellas', group: 'Premium',
        capacidadMl: 750, pesoBotellaLlenaOz: 44.65, conteoOzHabilitado: true,
        precio: 410.5, stockMinimo: 3, conversion: 12, proveedor: 'STANDARD FOODS', pv: 'PVA1001169',
        stockByArea: { almacen: 2, barra1: 1, barra2: 0 } }
    ];
  });

  // ══ A · AGREGAR PRODUCTO (ficha vacía) ══════════════════════════════════
  await p.evaluate(() => { openProductModal(null); });
  await p.waitForTimeout(150);

  const agregar = await p.evaluate((grisRe) => {
    const rx = new RegExp(grisRe, 'i');
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const modal = document.getElementById('productModal');
    const caja = modal.querySelector('.modal-box');
    const titulo = document.getElementById('productModalTitle');
    const icoOz = modal.querySelector('.fa-bottle');
    const cajaOz = icoOz ? icoOz.closest('div') : null;
    const blancos = [...modal.querySelectorAll('*')]
      .filter(e => getComputedStyle(e).backgroundColor === 'rgb(255, 255, 255)').map(e => e.className || e.tagName);
    const grisores = [...modal.querySelectorAll('button')]
      .filter(b => rx.test(getComputedStyle(b).backgroundColor)).map(b => b.className);
    return {
      visible: !modal.classList.contains('hidden'),
      titulo: titulo ? titulo.textContent.trim() : null,
      idGenerado: (document.getElementById('productId') || {}).value || '',
      icoOzExiste: !!icoOz,
      icoOzAncho: icoOz ? icoOz.getBoundingClientRect().width : 0,
      cajaOzFondo: cajaOz ? getComputedStyle(cajaOz).backgroundColor : null,
      cajaFondo: caja ? getComputedStyle(caja).backgroundColor : null,
      blancos: blancos, grisores: grisores,
      emoji: (modal.innerText.match(re) || []).join(' ')
    };
  }, GRIS_DE_FABRICA.source);

  chk('★ "Agregar Producto" abre la ficha vacía, con un ID generado',
      agregar.visible && agregar.titulo === 'Agregar Producto' && agregar.idGenerado.length > 0,
      JSON.stringify({ titulo: agregar.titulo, id: agregar.idGenerado }));
  chk('★ El icono de "Conteo de botella en oz" existe y tiene ancho real (no colapsado a 0 px)',
      agregar.icoOzExiste && agregar.icoOzAncho >= 8, 'ancho: ' + agregar.icoOzAncho);
  chk('★ El recuadro de conteo en oz ya no es el índigo de antes de R1 (es una superficie neutra del kit)',
      agregar.cajaOzFondo !== 'rgba(0, 0, 0, 0)' && !/rgba\(108,\s*99,\s*255/.test(agregar.cajaOzFondo || ''),
      agregar.cajaOzFondo);
  chk('★ La caja del modal no se quedó con el fondo blanco de fábrica (bg-white sin redirigir)',
      agregar.cajaFondo !== 'rgb(255, 255, 255)', agregar.cajaFondo);
  chk('★ Ni un fondo blanco dentro de la ficha', agregar.blancos.length === 0, agregar.blancos.join(', '));
  chk('★ Ningún botón de la ficha se quedó con el gris de fábrica',
      agregar.grisores.length === 0, agregar.grisores.join(', '));
  chk('★ La ficha ya no usa emoji como iconografía (antes: ⚗️)', agregar.emoji === '', 'quedan: ' + agregar.emoji);

  await p.evaluate(() => { closeProductModal(); });
  await p.waitForTimeout(100);

  // ══ B · EDITAR PRODUCTO (repuebla los 12 campos) ════════════════════════
  await p.evaluate(() => { openProductModal('P1'); });
  await p.waitForTimeout(150);

  const editar = await p.evaluate(() => {
    const val = (id) => (document.getElementById(id) || {}).value;
    return {
      titulo: (document.getElementById('productModalTitle') || {}).textContent.trim(),
      id: val('productId'), nombre: val('productName'), unidad: val('productUnit'), grupo: val('productGroup'),
      capacidad: val('productCapacidadMl'), peso: val('productPesoLlenaOz'),
      precio: val('productPrecio'), minimo: val('productStockMinimo'), conversion: val('productConversion'),
      proveedor: val('productProveedor'), pv: val('productPV'),
      casillaOz: (document.getElementById('productConteoOz') || {}).checked
    };
  });
  chk('★ "Editar Producto" repuebla los 12 campos reales con los datos del producto',
      editar.titulo === 'Editar Producto' && editar.id === 'P1' && editar.nombre === 'TEQUILA DON JULIO' &&
      editar.unidad === 'Botellas' && editar.grupo === 'Premium' && editar.capacidad === '750' &&
      editar.peso === '44.65' && editar.precio === '410.5' && editar.minimo === '3' &&
      editar.conversion === '12' && editar.proveedor === 'STANDARD FOODS' && editar.pv === 'PVA1001169' &&
      editar.casillaOz === true,
      JSON.stringify(editar));

  // ══ C · AVISO DE PV DUPLICADO EN VIVO (tokens, no hex a mano) ═══════════
  await p.evaluate(() => {
    const el = document.getElementById('productPV');
    el.value = 'OTRO';
    _normalizarPV(el); // sin choque: debe quedar en color neutro
  });
  const sinChoque = await p.evaluate(() => getComputedStyle(document.getElementById('productPVAviso')).color);

  await p.evaluate(() => {
    products.push({ id: 'P2', name: 'OTRO PRODUCTO', unit: 'Piezas', pv: 'PVCHOQUE' });
    const el = document.getElementById('productPV');
    el.value = 'PVCHOQUE';
    _normalizarPV(el); // choca con P2: debe pasar a color de alerta
  });
  const conChoque = await p.evaluate(() => ({
    color: getComputedStyle(document.getElementById('productPVAviso')).color,
    texto: document.getElementById('productPVAviso').textContent
  }));

  chk('El aviso de PV sin choque usa el color neutro del kit (no #9ca3af a mano)',
      sinChoque !== 'rgb(156, 163, 175)' /* color literal del hex viejo si no se hubiera tokenizado */);
  chk('★ El aviso de PV EN CHOQUE cambia a un color de alerta real (no sigue en el mismo neutro)',
      conChoque.color !== sinChoque && /OTRO PRODUCTO/.test(conChoque.texto), JSON.stringify(conChoque));

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));

  // ── Resultado ───────────────────────────────────────────────────────────
  const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
  console.log('\n  ── REDISEÑO R6 · Catálogo y ficha (navegador) ──\n');
  casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
  console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  await nav.close();
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
