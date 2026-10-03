#!/usr/bin/env node
/**
 * prueba-redis-r7-navegador.js — REDISEÑO R7 · Recetario y los modales pendientes · navegador
 * ═══════════════════════════════════════════════════════════════════════════
 * Verifica en la app real lo que la prueba estática no puede: que los
 * colores de verdad se vean (no solo que el string correcto esté en el
 * HTML), que los iconos nuevos tengan ancho real (no colapsados a 0 px,
 * la lección de R3/R5), y que abrir/cerrar cada uno de los cuatro
 * modales siga funcionando sin errores de JS.
 *
 *   PUERTO=8080 node pruebas/prueba-redis-r7-navegador.js
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
    _authzState.permissions = new Set(['*']); // admin: puede editar recetario, pedidos e inventario
    products = [
      { id: 'P1', name: 'TEQUILA DON JULIO', unit: 'Botellas', group: 'Premium', precio: 410.5 }
    ];
    recetas = [
      { id: 'R1', nombre: 'MARGARITA', categoria: 'Clásicos', activa: true,
        ingredientes: [{ productoId: 'P1', cantidad: 45, uom: 'ml' }] },
      { id: 'R2', nombre: 'INSUMO FANTASMA', categoria: 'Prueba', activa: false,
        ingredientes: [{ productoId: 'PX', cantidad: 10, uom: 'ml' }] }
    ];
  });

  // ══ A · PESTAÑA RECETARIO — LISTA ═══════════════════════════════════════
  await p.evaluate(() => { activeTab = 'recetario'; renderTab(); });
  await p.waitForTimeout(150);

  const lista = await p.evaluate(() => {
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const cont = document.getElementById('tabContent');
    const tarjetas = [...cont.querySelectorAll('div[onclick^="_recetarioAbrirFicha"]')];
    const inactivaBadge = cont.querySelector('span');
    return {
      numTarjetas: tarjetas.length,
      emoji: (cont.innerText.match(re) || []).join(' '),
      inactivaTexto: inactivaBadge ? inactivaBadge.textContent : null,
      inactivaFondo: inactivaBadge ? getComputedStyle(inactivaBadge).backgroundColor : null,
      tabFondo: getComputedStyle(cont).backgroundColor
    };
  });
  chk('★ La lista del recetario muestra las 2 recetas, sin emoji como iconografía',
      lista.numTarjetas === 2 && lista.emoji === '', JSON.stringify(lista));
  chk('★ El badge "Inactiva" tiene un fondo real (no transparente, no blanco de fábrica)',
      lista.inactivaTexto === 'Inactiva' &&
      lista.inactivaFondo !== 'rgba(0, 0, 0, 0)' && lista.inactivaFondo !== 'rgb(255, 255, 255)',
      lista.inactivaFondo);

  // ══ B · FICHA DE RECETA (ingrediente fantasma → aviso rojo real) ════════
  await p.evaluate(() => { _recetarioAbrirFicha('R2'); renderTab(); });
  await p.waitForTimeout(150);

  const ficha = await p.evaluate(() => {
    const cont = document.getElementById('tabContent');
    const volver = cont.querySelector('button i.fa-chevron-left');
    const avisoCatalogo = [...cont.querySelectorAll('span')].find(s => /no está en el catálogo/.test(s.textContent));
    const sinCosto = [...cont.querySelectorAll('span')].find(s => /sin costo/.test(s.textContent));
    const eliminarBtn = [...cont.querySelectorAll('button')].find(b => /Eliminar/.test(b.textContent));
    return {
      volverExiste: !!volver, volverAncho: volver ? volver.getBoundingClientRect().width : 0,
      avisoColor: avisoCatalogo ? getComputedStyle(avisoCatalogo).color : null,
      sinCostoColor: sinCosto ? getComputedStyle(sinCosto).color : null,
      eliminarBorde: eliminarBtn ? getComputedStyle(eliminarBtn).borderColor : null,
      eliminarColor: eliminarBtn ? getComputedStyle(eliminarBtn).color : null
    };
  });
  chk('★ El botón "Volver al recetario" usa el icono fa-chevron-left con ancho real (no colapsado a 0 px)',
      ficha.volverExiste && ficha.volverAncho >= 6, 'ancho: ' + ficha.volverAncho);
  chk('★ "(no está en el catálogo)" se pinta en un color de alerta real, no el #dc2626 literal muerto',
      !!ficha.avisoColor && ficha.avisoColor !== 'rgba(0, 0, 0, 0)', ficha.avisoColor);
  chk('★ "sin costo" se pinta en el color de advertencia del sistema (var(--warn))',
      !!ficha.sinCostoColor && ficha.sinCostoColor !== 'rgba(0, 0, 0, 0)', ficha.sinCostoColor);
  chk('★ El botón "Eliminar" tiene borde y texto de alerta reales (var(--danger-dim)/var(--danger))',
      !!ficha.eliminarBorde && ficha.eliminarBorde !== 'rgba(0, 0, 0, 0)' && !!ficha.eliminarColor,
      JSON.stringify({ borde: ficha.eliminarBorde, color: ficha.eliminarColor }));

  await p.evaluate(() => { _recetarioVolverALista(); renderTab(); });
  await p.waitForTimeout(100);

  // ══ C · MODAL DE RECETA — NUEVA, Y EL AVISO DE INSUMO QUE NO EXISTE ═════
  await p.evaluate(() => { openRecetaModal(null); });
  await p.waitForTimeout(150);

  const recModal1 = await p.evaluate((emojiSrc) => {
    const re = new RegExp(emojiSrc, 'u');
    const modal = document.getElementById('recetaModal');
    return {
      visible: !modal.classList.contains('hidden'),
      titulo: document.getElementById('recetaModalTitle').textContent.trim(),
      emoji: (modal.innerText.match(re) || []).join(' ')
    };
  }, EMOJI.source);
  chk('★ "Nueva receta" abre el modal vacío, sin emoji como iconografía',
      recModal1.visible && recModal1.titulo === 'Nueva receta' && recModal1.emoji === '',
      JSON.stringify(recModal1));

  // Forzar el aviso de insumo fantasma dentro del editor de ingredientes.
  const avisoModal = await p.evaluate(() => {
    _recetaEditIngredientes = [{ productoId: 'PX', cantidad: 5, uom: 'ml' }];
    _recetaRenderIngredientesLista();
    const cont = document.getElementById('recetaIngredientesLista');
    const aviso = [...cont.querySelectorAll('p')].find(x => /No existe en el catálogo/.test(x.textContent));
    const icoAviso = aviso ? aviso.querySelector('i.fa-triangle-exclamation') : null;
    const quitarBtn = cont.querySelector('button');
    const icoQuitar = quitarBtn ? quitarBtn.querySelector('i.fa-xmark') : null;
    return {
      avisoExiste: !!aviso, avisoColor: aviso ? getComputedStyle(aviso).color : null,
      icoAvisoAncho: icoAviso ? icoAviso.getBoundingClientRect().width : 0,
      icoQuitarAncho: icoQuitar ? icoQuitar.getBoundingClientRect().width : 0,
      quitarTexto: quitarBtn ? quitarBtn.textContent.trim() : null
    };
  });
  chk('★ El aviso de insumo inexistente usa fa-triangle-exclamation con ancho real',
      avisoModal.avisoExiste && avisoModal.icoAvisoAncho >= 6, JSON.stringify(avisoModal));
  chk('★ El botón de quitar insumo usa fa-xmark con ancho real (ya no el glifo "✕")',
      avisoModal.icoQuitarAncho >= 6 && avisoModal.quitarTexto === '', JSON.stringify(avisoModal));

  await p.evaluate(() => { closeRecetaModal(); });
  await p.waitForTimeout(100);

  // ══ D · MODAL DE PEDIDO — footer y botones con color real ═══════════════
  await p.evaluate(() => {
    cart = [{ id: 'P1', name: 'TEQUILA DON JULIO', unit: 'Botellas', quantity: 2 }];
    openOrderModal();
  });
  await p.waitForTimeout(150);

  const orderM = await p.evaluate(() => {
    const modal = document.getElementById('orderModal');
    const footer = modal.querySelector('.modal-box > div:last-child');
    const btnCompartir = [...modal.querySelectorAll('button')].find(b => /Compartir WhatsApp/.test(b.textContent));
    return {
      visible: !modal.classList.contains('hidden'),
      footerFondo: footer ? getComputedStyle(footer).backgroundColor : null,
      compartirFondo: btnCompartir ? getComputedStyle(btnCompartir).backgroundColor : null
    };
  });
  chk('★ El modal de pedido abre y su footer pegajoso no es blanco de fábrica ni transparente',
      orderM.visible && orderM.footerFondo !== 'rgb(255, 255, 255)' && orderM.footerFondo !== 'rgba(0, 0, 0, 0)',
      orderM.footerFondo);
  chk('★ "Compartir WhatsApp" tiene un fondo verde real (var(--ok-dim)), no transparente',
      orderM.compartirFondo !== 'rgba(0, 0, 0, 0)', orderM.compartirFondo);

  await p.evaluate(() => { closeOrderModal(); });
  await p.waitForTimeout(100);

  // ══ E · NUEVO INVENTARIO — botón con icono, áreas con icono real ════════
  await p.evaluate(() => { _inventarioActivo = null; abrirModalNuevoInventario(); });
  await p.waitForTimeout(150);

  const nuevoInv = await p.evaluate((emojiSrc) => {
    const re = new RegExp(emojiSrc, 'u');
    const modal = document.getElementById('nuevoInventarioModal');
    const btnCrear = document.getElementById('nuevoInvBtnCrear');
    const icoCrear = btnCrear ? btnCrear.querySelector('i.fa-plus') : null;
    const areas = [...document.querySelectorAll('#nuevoInvAreas i')];
    return {
      visible: modal ? !modal.classList.contains('hidden') : false,
      emoji: (modal ? modal.innerText : '').match(re)?.join(' ') || '',
      icoCrearAncho: icoCrear ? icoCrear.getBoundingClientRect().width : 0,
      numAreas: areas.length,
      areasConAnchoReal: areas.every(i => i.getBoundingClientRect().width >= 6)
    };
  }, EMOJI.source);
  chk('★ "Nuevo Inventario Físico" abre, sin emoji, con el botón "Crear inventario" usando fa-plus',
      nuevoInv.visible && nuevoInv.emoji === '' && nuevoInv.icoCrearAncho >= 6, JSON.stringify(nuevoInv));
  chk('★ El checklist de áreas pinta un icono real por cada área (no el emoji configurable)',
      nuevoInv.numAreas >= 3 && nuevoInv.areasConAnchoReal, JSON.stringify(nuevoInv));

  await p.evaluate(() => { cerrarModalNuevoInventario(); });
  await p.waitForTimeout(100);

  // ══ F · REGISTRAR FECHA DE RECUENTO — sin fallback muerto en el aviso ══
  await p.evaluate(() => { _inventarioActivo = { estado: 'SINCRONIZADO' }; abrirModalRegistrarFechaRecuento(); });
  await p.waitForTimeout(150);

  const regFecha = await p.evaluate(() => {
    const modal = document.getElementById('regFechaRecuentoModal');
    const aviso = document.getElementById('regFechaRecuentoAviso');
    return {
      visible: modal ? !modal.classList.contains('hidden') : false,
      avisoColor: aviso ? getComputedStyle(aviso).color : null,
      avisoTexto: aviso ? aviso.textContent : null
    };
  });
  chk('★ "Registrar fecha de recuento" abre y su aviso tiene un color real (var(--ok)/var(--red), sin fallback muerto)',
      regFecha.visible && !!regFecha.avisoColor && regFecha.avisoColor !== 'rgba(0, 0, 0, 0)',
      JSON.stringify(regFecha));

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));

  // ── Resultado ───────────────────────────────────────────────────────────
  const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
  console.log('\n  ── REDISEÑO R7 · Recetario y los modales pendientes (navegador) ──\n');
  casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
  console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  await nav.close();
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
