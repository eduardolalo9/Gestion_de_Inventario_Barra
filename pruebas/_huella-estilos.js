// Huella de estilos: el estilo CALCULADO de cada elemento, en cada pantalla, tema y ancho.
// Sirve para demostrar que un cambio de CSS (p. ej. quitar !important) no mueve nada.
//   const { huella, comparar } = require('./_huella-estilos');
'use strict';
const { chromium } = require('playwright');
const PUERTO = process.env.PUERTO || '8080';

const PROPS = ['color', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'boxShadow',
  'outlineStyle', 'outlineColor', 'outlineWidth', 'fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'lineHeight', 'letterSpacing',
  'textTransform', 'textAlign', 'textDecorationLine', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'display', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'opacity', 'transform', 'zIndex', 'overflowX', 'overflowY',
  'whiteSpace', 'flexDirection', 'justifyContent', 'alignItems', 'gap', 'cursor', 'visibility', 'filter', 'backdropFilter'];

const TABS = ['inicio', 'productos', 'pedidos', 'inventario', 'compras', 'recetario', 'ventas', 'historia', 'ajustes', 'notificaciones', 'admin'];
const ANCHOS = [390, 820, 1280];
const TEMAS = ['dark', 'light'];

// kebab → ¿qué propiedades de la huella puede mover?
function afecta(decl, fp) {
  const cam = decl.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (fp === cam) return true;
  const reglas = {
    background: /^background/, border: /^border/, 'border-color': /^border.*Color$/, 'border-width': /^border.*Width$/, 'border-style': /^border.*Style$/,
    'border-radius': /Radius$/, 'border-top': /^borderTop/, 'border-bottom': /^borderBottom/, 'border-left': /^borderLeft/, 'border-right': /^borderRight/,
    padding: /^padding/, margin: /^margin/, font: /^(font|lineHeight)/, outline: /^outline/, inset: /^(top|right|bottom|left)$/,
    gap: /gap/i, overflow: /^overflow/, flex: /^(flex|justify|align)/, 'text-decoration': /^textDecoration/, 'background-image': /^backgroundImage$/,
    'min-width': /^minWidth$/, 'box-shadow': /^boxShadow$/
  };
  if (reglas[decl]) return reglas[decl].test(fp);
  if (/^(transition|animation|will-change|pointer-events|touch-action|-webkit-|user-select|content|appearance|accent-color|scroll|-moz-)/.test(decl)) return false; // no están en la huella
  return false;
}

function sembrar(p) {
  return p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'adm1'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']); _authzState.roleId = 'ADMIN';
    const g = ['TEQUILA', 'RON', 'WHISKY', 'VODKA'];
    products = []; for (let i = 0; i < 24; i++) products.push({ id: 'P' + i, name: g[i % 4] + ' MARCA ' + i, unit: 'Botellas', group: g[i % 4], precio: 300 + i, stockMinimo: 4, conversion: 750, pv: 'PV' + i, proveedor: 'DIST', stockByArea: { almacen: i % 7, barra1: 1, barra2: 0 } });
    recetas = [{ id: 'r1', pv: 'PV1', nombre: 'MARGARITA', activa: true, ingredientes: [{ productoId: 'P0', cantidad: 0.06, uom: 'PZA' }] }];
    ventas = [{ sku: 'PV1', nombre: 'Margarita', cantidad: 7 }, { sku: 'PV9', nombre: 'Sin receta', cantidad: 2 }]; ventasSemanaId = semanaId(new Date()); ventasPeriodos = [{ inicio: ventasSemanaId, fin: ventasSemanaId }];
    _notificaciones = [{ id: 'n1', tipo: 'ajuste', texto: 'Ajuste solicitado: TEQUILA', creadoEn: 1, leido: false }, { id: 'n2', tipo: 'reporte', texto: 'Reporte', creadoEn: 1, leido: true }];
    _ajustes = [{ id: 'a1', estado: 'pendiente', productoId: 'P1', productoNombre: 'RON', motivo: 'conteo', creadoEn: 1, solicitanteUid: 'u2' }];
    orders = [{ id: 'PED-1', supplier: 'DIST', date: '2026-10-01', products: [{ name: 'TEQUILA', unit: 'Botellas', quantity: 2 }], total: 2 }];
    inventories = []; _permCargando = false; _permError = null; _permUsuarios = [{ uid: 'u2', email: 'a@b.mx', role: 'USER', status: 'activo' }];
    Date.now = () => 1790000000000; // reloj fijo: ninguna hora cambia entre corridas
  });
}

// Se ejecuta DENTRO de la página. base: {path: 'v1|v2|…'} del estado equivalente (o null para solo medir).
function medir(arg) {
  const { props, base, reglas } = arg;
  const els = [...document.querySelectorAll('body *')].filter(e => !/^(SCRIPT|STYLE|LINK|META|TITLE|NOSCRIPT)$/.test(e.tagName));
  const ruta = (e) => { const p = []; for (let x = e; x && x !== document.body; x = x.parentElement) { const i = x.parentElement ? [...x.parentElement.children].indexOf(x) : 0; p.push(x.tagName[0] + i); } return p.reverse().join('/'); };
  const huella = {}, difs = [], cubiertas = new Set();
  els.forEach(e => {
    const cs = getComputedStyle(e); const v = props.map(k => cs[k]); const r = ruta(e);
    huella[r] = v.join('\u0001');
    if (base) {
      const b = base[r];
      if (b !== huella[r]) {
        const bv = b ? b.split('\u0001') : null;
        const cambia = bv ? props.filter((k, i) => bv[i] !== v[i]) : ['(elemento nuevo)'];
        difs.push({ r, cambia, tag: e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
          reglas: reglas.filter(R => R.sels.some(s => { try { return e.matches(s); } catch (x) { return false; } })).map(R => ({ id: R.id, props: R.props })) });
      }
    }
  });
  Object.keys(base || {}).forEach(r => { if (!(r in huella)) difs.push({ r, cambia: ['(elemento desaparecido)'], tag: '?', reglas: [] }); });
  reglas.forEach(R => { if (R.sels.some(s => { try { return !!document.querySelector(s); } catch (x) { return false; } })) cubiertas.add(R.id); });
  return { huella: base ? null : huella, difs, cubiertas: [...cubiertas], n: els.length };
}

const ESTADOS = [].concat(
  TABS.map(t => ({ n: 'tab:' + t, f: "activeTab='" + t + "'; renderTab();" })),
  [
    { n: 'admin:permisos', f: "_adminSubvista='permisos'; activeTab='admin'; renderTab(); permSeleccionarUsuario('u2');" },
    { n: 'sidebar', f: "_adminSubvista='panel'; activeTab='inicio'; renderTab(); sbOpen();" },
    { n: 'modal:producto', f: "sbClose(); openProductModal();" },
    { n: 'modal:pedido', f: "document.getElementById('productModal').classList.add('hidden'); openOrderModal();" },
    { n: 'modal:conteo', f: "document.getElementById('orderModal').classList.add('hidden'); try { openInventarioModal('P1'); } catch (e) {}" },
    { n: 'confirm', f: "document.getElementById('inventarioModal').classList.add('hidden'); showConfirm('¿Seguro?\\n\\nNo se puede deshacer.', function(){});" },
    { n: 'toast', f: "document.querySelectorAll('body > div[style*=\"z-index\"]').forEach(function(x){ if (x.id !== 'networkStatus') x.remove(); }); showNotification('✅ Guardado'); showNotification('⚠️ Algo pasó');" }
  ]);

async function huella({ css, base, reglas, anchos, temas, log }) {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const salida = { base: {}, difs: [], cubiertas: new Set(), estados: 0 };
  for (const ancho of (anchos || ANCHOS)) {
    const ctx = await nav.newContext({ viewport: { width: ancho, height: 844 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    if (css) await p.route('**/css/estilos.css*', r => r.fulfill({ status: 200, contentType: 'text/css', body: css }));
    await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
    await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(600);
    await sembrar(p);
    await p.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    for (const tema of (temas || TEMAS)) {
      await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), tema);
      for (const est of ESTADOS) {
        const clave = ancho + '|' + tema + '|' + est.n;
        await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.add('hidden'); });
        try { await p.evaluate(new Function(est.f)); } catch (e) { /* un estado que no abre se mide tal cual */ }
        await p.evaluate(() => { try { document.activeElement && document.activeElement.blur(); } catch (e) {} });
        await p.waitForTimeout(/^(modal|confirm|toast|sidebar)/.test(est.n) ? 900 : 350);
        const r = await p.evaluate(medir, { props: PROPS, base: base ? base[clave] || {} : null, reglas: reglas || [] });
        if (!base) salida.base[clave] = r.huella;
        r.difs.forEach(d => salida.difs.push(Object.assign({ estado: clave }, d)));
        r.cubiertas.forEach(c => salida.cubiertas.add(c));
        salida.estados++;
      }
      await p.evaluate(() => { try { sbClose(); } catch (e) {} ['productModal', 'orderModal', 'inventarioModal'].forEach(id => { const m = document.getElementById(id); if (m) m.classList.add('hidden'); }); });
    }
    await ctx.close();
    if (log) log('  ancho ' + ancho + ' listo');
  }
  await nav.close();
  salida.cubiertas = [...salida.cubiertas];
  return salida;
}

module.exports = { huella, afecta, PROPS, ESTADOS, ANCHOS, TEMAS };

if (require.main === module) {
  const fs = require('fs'); const out = process.argv[2];
  if (!out) { console.error('uso: node pruebas/_huella-estilos.js base.json'); process.exit(2); }
  huella({ log: console.log }).then(r => { fs.writeFileSync(out, JSON.stringify(r.base)); console.log('estados: ' + r.estados + ' · archivo: ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)'); });
}
