#!/usr/bin/env node
/**
 * _captura-r3.js — captura de Inicio con el rediseño R3, para el informe.
 * No es una prueba: no afirma nada, solo saca la foto. Por eso no está
 * registrada en todas-navegador.js.
 *
 *   PUERTO=8080 node pruebas/_captura-r3.js
 */
'use strict';
const { chromium } = require('playwright');
const PUERTO = process.env.PUERTO || '8080';
const SALIDA = process.env.SALIDA || '/mnt/user-data/outputs/rediseno-r3-inicio.png';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: process.env.TARJETAS ? 3400 : 1500 }, deviceScaleFactor: 2 })).newPage();
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1100);

  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['*']);
    products = [
      { id: 'DJ7', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'PZA',
        stockMinimo: 4, conversion: 700, capacidadMl: 700, pesoBotellaLlenaOz: 53.65,
        conteoOzHabilitado: true, precio: 1480, stockByArea: { almacen: 8, barra1: 2, barra2: 0 } },
      { id: 'ACE', name: 'ACEITUNA SIN HUESO', group: 'ABARROTES', unit: 'KGS',
        stockMinimo: 3, conversion: 1, precio: 180, stockByArea: { almacen: 1.7, barra1: 0, barra2: 0 } },
      { id: 'LIM', name: 'LIMON CON SEMILLA', group: 'FRUTA Y VERDURA', unit: 'KGS',
        stockMinimo: 5, conversion: 1, precio: 32, stockByArea: { almacen: 8.5, barra1: 1, barra2: 0 } },
      { id: 'JWB', name: 'JOHNNIE WALKER BLACK LABEL', group: 'WHISKY', unit: 'PZA',
        stockMinimo: 3, conversion: 750, precio: 980, stockByArea: { almacen: 0.8, barra1: 0, barra2: 0 } },
      { id: 'JUG', name: 'JUGO DE PIÑA', group: 'JUGOS', unit: 'LTS',
        stockMinimo: 6, conversion: 1, precio: 45, stockByArea: { almacen: 12, barra1: 3, barra2: 2 } }
    ];
    allUsersAuditoria = {}; _inventarioActivo = null;
    cart = []; orders = [];
    activeTab = 'inicio'; selectedGroup = 'Todos'; searchTerm = '';
    renderTab();
  });
  await p.waitForTimeout(500);
  if (process.env.TARJETAS) {
    // Las tarjetas viven dentro de un contenedor con scroll propio, no en el
    // window: recortar por el rectángulo de las tres primeras es más fiable
    // que intentar desplazar la página.
    const caja = await p.evaluate(() => {
      const cs = [...document.querySelectorAll('.prd-card')].slice(0, 3);
      if (!cs.length) return null;
      const a = cs[0].getBoundingClientRect(), b = cs[cs.length - 1].getBoundingClientRect();
      return { x: Math.max(0, a.left - 10), y: Math.max(0, a.top - 10),
               width: Math.min(390, a.width + 20), height: (b.bottom - a.top) + 20 };
    });
    await p.screenshot({ path: SALIDA, clip: caja });
  } else {
    await p.screenshot({ path: SALIDA, fullPage: false });
  }
  console.log('  captura: ' + SALIDA);
  await nav.close();
})().catch(e => { console.error(e); process.exit(1); });
