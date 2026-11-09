// REDISEÑO DE VENTANAS — Compras (referencia) y captura manual, en Chromium real.
// Verifica estructura, jerarquía de botones, tamaños táctiles, que nada se desborde
// (móvil 360/390/430 y PC 1440, tema claro y oscuro) y que la captura manual funcione.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

const PRODS = [
  { id: 'DJ7', name: 'DON JULIO 70', group: 'TEQUILA', unit: 'PZA', precio: 1480, stockByArea: { almacen: 8 } },
  { id: 'ACE', name: 'ACEITUNA SIN HUESO', group: 'ABARROTES', unit: 'KGS', precio: 180, stockByArea: { almacen: 1.7 } }
];
const VISTAS = [
  { n: 'móvil 360', w: 360, h: 740 }, { n: 'móvil 390', w: 390, h: 844 },
  { n: 'móvil 430', w: 430, h: 932 }, { n: 'PC 1440', w: 1440, h: 900 }
];

async function preparar(nav, vista, tema) {
  const ctx = await nav.newContext({ viewport: { width: vista.w, height: vista.h } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('inventarioApp_temaMarca', 'ultra-pro'); localStorage.setItem('inventarioApp_theme', t); } catch (_) {} }, tema);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(700);
  await p.evaluate((prods) => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'u'; currentUserRole = 'admin';
    _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
    products = prods; compras = []; movimientos = [];
    activeTab = 'compras'; comprasImportView = 'lista'; renderTab();
  }, PRODS);
  await p.waitForTimeout(250);
  return { ctx, p, errs };
}
const sinDesborde = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());

  // ══ 1 · Estructura y jerarquía, en 4 anchos × 2 temas ═══════════════════════════
  for (const tema of ['dark', 'light']) for (const v of VISTAS) {
    const { ctx, p, errs } = await preparar(nav, v, tema);
    const tag = `[${v.n} · ${tema}]`;
    const lista = await p.evaluate(() => {
      const cab = document.querySelector('#tabContent .pg-cab');
      const acc = document.querySelector('#tabContent .pg-acc');
      const bs = acc ? [...acc.querySelectorAll('button')] : [];
      const r = (b) => { const q = b.getBoundingClientRect(); return { alto: q.height, ancho: q.width, izq: q.left, der: q.right, txt: b.textContent.trim(), cls: b.className }; };
      return {
        tit: cab && cab.querySelector('.pg-cab__tit') ? cab.querySelector('.pg-cab__tit').textContent : null,
        desc: !!(cab && cab.querySelector('.pg-cab__desc')),
        accionesDespuesDelEncabezado: !!(acc && acc.previousElementSibling === cab),
        botones: bs.map(r), vw: window.innerWidth
      };
    });
    chk(`${tag} El tema aplicado es realmente «${tema}» (la prueba no se engaña)`, await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === tema);
    chk(`${tag} Compras: título «Compras» y descripción breve`, lista.tit === 'Compras' && lista.desc, JSON.stringify([lista.tit, lista.desc]));
    chk(`${tag} Acciones justo después del encabezado`, lista.accionesDespuesDelEncabezado);
    const [prim, sec] = lista.botones;
    chk(`${tag} «Captura manual» es la acción principal y «Importar archivo» la secundaria, en ese orden`,
        !!prim && !!sec && prim.txt === 'Captura manual' && /bt--primario/.test(prim.cls) && sec.txt === 'Importar archivo' && /bt--secundario/.test(sec.cls), JSON.stringify(lista.botones));
    chk(`${tag} Ambos botones ≥ 44 px de alto, dentro de la pantalla y la principal no es más angosta`,
        lista.botones.every(b => b.alto >= 44 && b.izq >= 0 && b.der <= lista.vw + 0.5) && prim.ancho >= sec.ancho - 1, JSON.stringify(lista.botones));
    chk(`${tag} Sin desplazamiento horizontal (lista)`, await sinDesborde(p));

    // Captura manual abierta
    await p.evaluate(() => comprasNuevaManual()); await p.waitForTimeout(200);
    const man = await p.evaluate(() => {
      const f = document.getElementById('cm-form'); if (!f) return null;
      const inputs = [...f.querySelectorAll('input')];
      const barra = document.querySelector('.pg-barra'); const tb = document.getElementById('bottomTabBar');
      const bq = barra && barra.getBoundingClientRect(); const tq = tb && tb.getBoundingClientRect();
      const tabVisible = !!tb && getComputedStyle(tb).display !== 'none' && tq.height > 0;
      return {
        tit: document.querySelector('#tabContent .pg-cab__tit').textContent,
        volver: !!document.querySelector('#tabContent .mc-cab__volver'),
        inputsBajos: inputs.filter(i => i.getBoundingClientRect().height < 44).map(i => i.id),
        barraBotones: barra ? [...barra.querySelectorAll('button')].map(b => ({ t: b.textContent.trim(), c: b.className, h: b.getBoundingClientRect().height })) : [],
        barraVisible: !!bq && bq.bottom <= window.innerHeight + 1 && bq.top >= 0,
        barraSobreTabBar: !tabVisible || bq.bottom <= tq.top + 1
      };
    });
    chk(`${tag} Captura manual: título, botón Volver y campos ≥ 44 px`, !!man && man.tit === 'Captura manual' && man.volver && man.inputsBajos.length === 0, JSON.stringify(man));
    chk(`${tag} Barra Cancelar/Guardar visible sin hacer scroll y sin quedar bajo la barra inferior`,
        !!man && man.barraVisible && man.barraSobreTabBar && man.barraBotones.length === 2 && man.barraBotones[0].t === 'Cancelar'
        && /bt--primario/.test(man.barraBotones[1].c) && /Guardar entrada/.test(man.barraBotones[1].t) && man.barraBotones.every(b => b.h >= 44), JSON.stringify(man && man.barraBotones));
    chk(`${tag} Sin desplazamiento horizontal (captura manual)`, await sinDesborde(p));

    // Vista previa de importación con el mismo encabezado
    await p.evaluate(() => {
      comprasImportView = 'vista_previa';
      _comprasImportPendiente = { fechaIngreso: '2026-11-05', verificando: false, verificacionCompleta: true, grupos: [{
        compraId: 'c1', proveedorNombre: 'DISTRIBUIDORA EL ÁGUILA', proveedorCodigo: 'PROV-01', fecha: '2026-10-01', fechaInvalida: false,
        folio: '3646', docSap: '27615', totalLineas: 1, importe: 410.5, incidencias: [],
        lineas: [{ productoId: 'DJ7', enCatalogo: true, costoUnitario: 410.5 }] }] };
      renderTab();
    });
    await p.waitForTimeout(200);
    const prev = await p.evaluate(() => ({
      tit: (document.querySelector('#tabContent .pg-cab__tit') || {}).textContent, volver: !!document.querySelector('#tabContent .mc-cab__volver'),
      paso: /Paso 2 de 3/.test((document.querySelector('#tabContent .pg-cab__desc') || {}).textContent || '')
    }));
    chk(`${tag} Importación: encabezado «Importar archivo» con Volver y «Paso 2 de 3»`, prev.tit === 'Importar archivo' && prev.volver && prev.paso, JSON.stringify(prev));
    chk(`${tag} Sin desplazamiento horizontal (vista previa)`, await sinDesborde(p));
    chk(`${tag} Sin errores de JavaScript`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ══ 2 · Funcionamiento de la captura manual (móvil 390, oscuro) ═══════════════════
  const { ctx, p, errs } = await preparar(nav, VISTAS[1], 'dark');
  await p.evaluate(() => comprasNuevaManual()); await p.waitForTimeout(150);

  // Guardar vacío → errores comprensibles y foco en el primero
  await p.evaluate(() => comprasManualGuardar()); await p.waitForTimeout(250);
  const e1 = await p.evaluate(() => ({
    aviso: (document.querySelector('.pg-aviso') || {}).textContent || '',
    prov: (document.getElementById('cm-prov-e') || {}).textContent || '',
    invalid: document.getElementById('cm-prov').getAttribute('aria-invalid'),
    foco: document.activeElement && document.activeElement.id
  }));
  chk('Guardar vacío: avisa «Revisa los campos marcados» y nombra el campo (proveedor)', /Revisa los campos marcados/.test(e1.aviso) && /nombre del proveedor/.test(e1.prov) && e1.invalid === 'true', JSON.stringify(e1));
  chk('El foco salta al primer campo con error', e1.foco === 'cm-prov', e1.foco);

  // Corregir el campo limpia su error al instante (no queda un mensaje obsoleto)
  await p.evaluate(() => { const i = document.getElementById('cm-prov'); i.focus(); i.value = 'VINOTECA MEXICO'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  chk('Al corregir el proveedor desaparece su mensaje de error y su marca roja', await p.evaluate(() => !document.getElementById('cm-prov-e') && !document.getElementById('cm-prov').closest('.pg-campo').classList.contains('pg-campo--err') && !document.getElementById('cm-prov').hasAttribute('aria-invalid')));

  // Escribir producto, coma decimal, total en vivo
  await p.evaluate(() => {
    comprasManualCampo('proveedorNombre', 'VINOTECA MEXICO');
    const i = document.getElementById('cm-p-0'); i.value = 'DON JULIO 70 · DJ7'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const k0 = await p.evaluate(() => document.getElementById('cm-k-0').value);
  chk('Elegir un producto rellena el costo con el precio del catálogo (editable)', k0 === '1480', k0);
  await p.evaluate(() => { const c = document.getElementById('cm-c-0'); c.value = '2,5'; c.dispatchEvent(new Event('input', { bubbles: true })); });
  const t1 = await p.evaluate(() => ({ imp: document.getElementById('cm-i-0').textContent, tot: document.getElementById('cm-total').textContent }));
  chk('Cantidad con coma decimal (2,5 × $1,480 = $3,700.00): importe y total en vivo, sin ×10', /3,700\.00/.test(t1.imp) && /3,700\.00/.test(t1.tot), JSON.stringify(t1));

  // Agregar y quitar líneas
  await p.evaluate(() => comprasManualAgregarLinea()); await p.waitForTimeout(80);
  const l2 = await p.evaluate(() => ({ n: document.querySelectorAll('.cm-linea').length, quitar: document.querySelectorAll('.cm-linea__quitar').length, prod0: document.getElementById('cm-p-0').value, foco: document.activeElement.id }));
  chk('Agregar producto: 2 líneas, botón Quitar en cada una, lo escrito se conserva y el foco va a la línea nueva', l2.n === 2 && l2.quitar === 2 && /DJ7/.test(l2.prod0) && l2.foco === 'cm-p-1', JSON.stringify(l2));
  await p.evaluate(() => comprasManualQuitarLinea(1)); await p.waitForTimeout(80);
  chk('Quitar producto: vuelve a 1 línea y desaparece el botón Quitar', await p.evaluate(() => document.querySelectorAll('.cm-linea').length === 1 && document.querySelectorAll('.cm-linea__quitar').length === 0));

  // Producto repetido
  await p.evaluate(() => comprasManualAgregarLinea()); await p.waitForTimeout(60);
  await p.evaluate(() => { const i = document.getElementById('cm-p-1'); i.value = 'DJ7'; i.dispatchEvent(new Event('input', { bubbles: true })); const c = document.getElementById('cm-c-1'); c.value = '1'; c.dispatchEvent(new Event('input', { bubbles: true })); const k = document.getElementById('cm-k-1'); k.value = '10'; k.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.evaluate(() => comprasManualGuardar()); await p.waitForTimeout(250);
  const rep = await p.evaluate(() => (document.getElementById('cm-p-1-e') || {}).textContent || '');
  chk('Mismo producto en dos líneas: se rechaza con un mensaje que dice cómo resolverlo', /otra línea/.test(rep), rep);

  // Texto que no es de la lista
  await p.evaluate(() => comprasManualQuitarLinea(1)); await p.waitForTimeout(60);
  await p.evaluate(() => { const i = document.getElementById('cm-p-0'); i.value = 'producto raro'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.evaluate(() => comprasManualGuardar()); await p.waitForTimeout(250);
  chk('Producto escrito que no es del catálogo: «Elige un producto de la lista»', await p.evaluate(() => /de la lista/.test((document.getElementById('cm-p-0-e') || {}).textContent || '')));
  await p.evaluate(() => { const i = document.getElementById('cm-p-0'); i.value = 'DON JULIO 70 · DJ7'; i.dispatchEvent(new Event('input', { bubbles: true })); });

  // Guardar en modo local (sin nube): mensaje claro, no pierde lo escrito
  await p.evaluate(() => comprasManualGuardar()); await p.waitForTimeout(300);
  const loc = await p.evaluate(() => ({ aviso: (document.querySelector('.pg-aviso') || {}).textContent || '', prov: document.getElementById('cm-prov').value, form: !!document.getElementById('cm-form') }));
  chk('Sin conexión a la nube: lo dice con claridad, no se pierde lo escrito y no se cierra la ventana', /no está conectada a la nube/.test(loc.aviso) && loc.prov === 'VINOTECA MEXICO' && loc.form, JSON.stringify(loc));

  // Guardado exitoso (se simula la respuesta de guardarCompra; la escritura real se prueba con el emulador)
  await p.evaluate(() => { window.__orig = window.comprasGuardarManual; window.comprasGuardarManual = async () => ({ ok: true, motivo: 'creada', compra: { folio: 'M-0007' } }); });
  await p.evaluate(() => comprasManualGuardar()); await p.waitForTimeout(300);
  const ok = await p.evaluate(() => ({ form: !!document.getElementById('cm-form'), lista: !!document.querySelector('#tabContent .pg-acc'), toast: (document.getElementById('toastMessage') || {}).textContent || '' }));
  chk('Guardado correcto: vuelve a la lista de Compras y avisa el folio asignado', !ok.form && ok.lista && /M-0007/.test(ok.toast), JSON.stringify(ok));

  // Cancelar: con datos pide confirmación; vacío sale directo; Atrás de Android
  await p.evaluate(() => { window.comprasGuardarManual = window.__orig; comprasNuevaManual(); }); await p.waitForTimeout(120);
  await p.evaluate(() => { comprasManualCampo('proveedorNombre', 'X'); comprasManualCancelar(); }); await p.waitForTimeout(150);
  const conf = await p.evaluate(() => ({ overlay: !!document.getElementById('_confirmOverlay'), form: !!document.getElementById('cm-form') }));
  chk('Cancelar con datos escritos pide confirmar antes de descartar (y no sale todavía)', conf.overlay && conf.form, JSON.stringify(conf));
  await p.evaluate(() => { const b = [...document.querySelectorAll('#_confirmOverlay button')].find(x => /Confirmar|Aceptar|Sí|Descartar|Eliminar/i.test(x.textContent)) || [...document.querySelectorAll('#_confirmOverlay button')].pop(); b.click(); });
  await p.waitForTimeout(250);
  chk('Confirmar el descarte vuelve a la lista', await p.evaluate(() => !document.getElementById('cm-form') && !!document.querySelector('#tabContent .pg-acc')));
  await p.evaluate(() => comprasNuevaManual()); await p.waitForTimeout(120);
  await p.evaluate(() => navegacionAtras()); await p.waitForTimeout(250);
  chk('Atrás de Android en la captura manual vacía vuelve a Compras', await p.evaluate(() => !document.getElementById('cm-form') && !!document.querySelector('#tabContent .pg-acc')));

  // Importar archivo sigue abriendo el selector de COMPRAS
  const inp = await p.evaluate(() => { const o = HTMLInputElement.prototype.click; let id = null; HTMLInputElement.prototype.click = function() { id = this.id; };
    try { [...document.querySelectorAll('.cp-acciones button')].find(x => /Importar archivo/.test(x.textContent)).click(); } finally { HTMLInputElement.prototype.click = o; } return id; });
  chk('«Importar archivo» sigue abriendo el selector de archivos de Compras (#fileInputCompras)', inp === 'fileInputCompras', String(inp));

  // Permisos
  await p.evaluate(() => { _authzState.permissions = new Set(['purchases.read', 'purchases.import']); renderTab(); }); await p.waitForTimeout(120);
  chk('Solo con purchases.import: aparece «Importar archivo» y no «Captura manual»', await p.evaluate(() => { const t = [...document.querySelectorAll('.cp-acciones button')].map(b => b.textContent.trim()); return t.length === 1 && t[0] === 'Importar archivo'; }));
  await p.evaluate(() => { _authzState.permissions = new Set(['purchases.read', 'purchases.create']); renderTab(); }); await p.waitForTimeout(120);
  chk('Solo con purchases.create: aparece «Captura manual» y no «Importar archivo»', await p.evaluate(() => { const t = [...document.querySelectorAll('.cp-acciones button')].map(b => b.textContent.trim()); return t.length === 1 && t[0] === 'Captura manual'; }));
  chk('Sin errores de JavaScript en toda la sesión', errs.length === 0, errs.join(' | '));
  await ctx.close(); await nav.close();

  const w = Math.max(...C.map(c => c.n.length));
  console.log('\n  ── REDISEÑO · Compras y captura manual (navegador real) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
  const fallos = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
