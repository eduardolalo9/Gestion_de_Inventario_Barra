// v5.36 — Chromium contra la app REAL:
//   (1) Físico vs Sistema: botón «Diferencias ↓» (mayor a menor), excluyente con ↑, respeta Grupo, Atrás lo reinicia.
//   (2) Importar → «Último corte importado»: panel, eliminar con confirmación (batch papelera + borrado),
//       cancelar no borra, sin permiso no aparece, error del servidor no borra nada.
//   npm run test:v536nav   (servidor local en PUERTO; lo levanta todas-navegador.js)
// Firestore es un SIMULADOR en memoria (window._db): nada toca Firebase real.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const URL_APP = 'http://127.0.0.1:' + PUERTO + '/index.html';

const MONTAJE = (rol) => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden');
  document.getElementById('loginScreen').classList.add('auth-hidden');
  document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'u1'; currentUserRole = rol === 'admin' ? 'admin' : 'user';
  _authzState.loaded = true; _authzState.overrides = {};
  _authzState.roleId = rol === 'admin' ? 'ADMIN' : 'SUBJEFE_BARRA';
  _authzState.permissions = new Set(rol === 'admin' ? ['*'] : ['inventory.count', 'inventory.viewAll']);
  products = [
    { id: 'A', name: 'TEQUILA FALTANTE', group: 'TEQUILA', unit: 'Botellas', precio: 100, stockMinimo: 1, stockByArea: { almacen: 10, barra1: 0, barra2: 0 } },
    { id: 'B', name: 'RON SOBRANTE',     group: 'RON',     unit: 'Botellas', precio: 50,  stockMinimo: 1, stockByArea: { almacen: 2,  barra1: 0, barra2: 0 } },
    { id: 'C', name: 'VODKA SIN CONTAR', group: 'VODKA',   unit: 'Botellas', precio: 20,  stockMinimo: 1, stockByArea: { almacen: 5,  barra1: 0, barra2: 0 } },
    { id: 'D', name: 'RON COINCIDE',     group: 'RON',     unit: 'Piezas',   precio: 12.5, stockMinimo: 1, stockByArea: { almacen: 4, barra1: 0, barra2: 0 } },
    { id: 'E', name: 'CERVEZA FALTA DOS', group: 'CERVEZA', unit: 'Piezas', stockMinimo: 1, stockByArea: { almacen: 24, barra1: 0, barra2: 0 } },
    { id: '0012', name: 'MEZCAL SOBRANTE DOS', group: 'TEQUILA', unit: 'Botellas', precio: 300, stockMinimo: 1, stockByArea: { almacen: 1, barra1: 0, barra2: 0 } }
  ];
  auditoriaConteo = {
    A: { almacen: { enteras: 6, abiertas: [] } },
    B: { almacen: { enteras: 3, abiertas: [] }, barra1: { enteras: 2, abiertas: [] } },
    D: { almacen: { enteras: 4, abiertas: [] } },
    E: { almacen: { enteras: 22, abiertas: [] } },
    '0012': { barra1: { enteras: 3, abiertas: [] } }
  };
  myAuditoriaConteo = JSON.parse(JSON.stringify(auditoriaConteo));
  _auditoriaSessionId = 'INV1001'; _inventarioActivoId = 'INV1001';
  _inventarioActivo = { estado: 'SINCRONIZADO', numero: 1001, fechaCreacion: Date.now(), creadoPorNombre: 'Eduardo' };
  allUsersAuditoria = {};
  activeTab = 'inventario'; auditoriaView = 'fisico_vs_sistema'; renderTab();
};

// Firestore simulado: anclasExistencia + papelera en memoria; batch atómico; fallo opcional en commit.
const SIM = () => {
  const docs = {
    anclasExistencia: {
      '2026-10-05_2340': { fecha: '2026-10-05', hora: '23:40', tipo: 'importacion_excel', origen: { tipo: 'importacion_excel', archivo: 'corte-anterior.xlsx' }, saldos: { A: 1 }, productosContados: 1, contabilizadoEn: 1790000000000 },
      '2026-10-06_1000': { fecha: '2026-10-06', hora: '10:00', tipo: 'importacion_excel', origen: { tipo: 'importacion_excel', archivo: 'corte-ultimo.xlsx' }, saldos: { A: 2 }, productosContados: 7, contabilizadoEn: 1790100000000 },
      '2026-10-04': { fecha: '2026-10-04', tipo: 'mitad_de_semana', saldos: { A: 3 } }
    },
    papelera: {}
  };
  window.__sim = { docs, fallar: false, batches: 0 };
  const col = (nombre) => ({
    doc: (id) => ({ _c: nombre, _id: id }),
    orderBy: () => ({ limit: () => ({ get: async () => { const ids = Object.keys(docs[nombre]).sort().reverse();
      return { forEach: (fn) => ids.forEach(id => fn({ id, data: () => JSON.parse(JSON.stringify(docs[nombre][id])) })) }; } }) })
  });
  const FALSO = {
    collection: () => ({ doc: () => ({ collection: col }) }),
    batch: () => { const ops = []; return {
      set: (r, d) => ops.push(['s', r, d]), delete: (r) => ops.push(['d', r]),
      commit: async () => { if (window.__sim.fallar) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
        ops.forEach(o => { if (o[0] === 's') docs[o[1]._c][o[1]._id] = JSON.parse(JSON.stringify(o[2])); else delete docs[o[1]._c][o[1]._id]; }); window.__sim.batches++; } }; }
  };
  _db = FALSO; window._db = FALSO;   // en la app _db es un «let» global
};

async function abrir(nav, vp, rol) {
  const ctx = await nav.newContext({ viewport: vp, hasTouch: vp.width < 600 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto(URL_APP, { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(700);
  await p.evaluate(MONTAJE, rol);
  await p.waitForTimeout(250);
  return { ctx, p, errs };
}
const filasTabla = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#sbx-res-fvs tr.fvs-t__fila')).map(tr => ({
  nombre: tr.querySelector('.fvs-t__nom').textContent, celdas: Array.from(tr.querySelectorAll('td')).map(td => td.innerText.replace(/\s+/g, ' ').trim()) })));
const num = (t) => { const m = /^([+-]?)([\d,]+\.\d+)/.exec(t.replace(/\s/g, '')); return m ? parseFloat(m[1] + m[2].replace(/,/g, '')) : null; };

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());

  // ═══ 1 · Diferencias ↓ ═══
  let { ctx, p, errs } = await abrir(nav, { width: 390, height: 844 }, 'admin');
  const antes = await p.evaluate(() => JSON.stringify({ products, auditoriaConteo, myAuditoriaConteo }));
  chk('El botón «Diferencias ↓» existe, junto a ↑, ≥ 44 px', await p.evaluate(() => { const b = document.getElementById('fvsDifDescBtn'); const r = b && b.getBoundingClientRect(); return !!b && r.height >= 44 && r.right <= innerWidth + 1 && !!document.getElementById('fvsDifAscBtn'); }));
  await p.click('#fvsDifDescBtn'); await p.waitForTimeout(250);
  let f = await filasTabla(p);
  let difs = f.map(x => num(x.celdas[5]));
  chk('★ «Diferencias ↓»: +3, +2, 0, −2, −4 y lo sin contar al final', JSON.stringify(difs) === JSON.stringify([3, 2, 0, -2, -4, null]), JSON.stringify(difs));
  chk('Los 6 productos siguen ahí y el botón queda marcado', f.length === 6 && await p.evaluate(() => document.getElementById('fvsDifDescBtn').getAttribute('aria-pressed') === 'true'));
  await p.click('#fvsDifAscBtn'); await p.waitForTimeout(250);
  difs = (await filasTabla(p)).map(x => num(x.celdas[5]));
  chk('★ Tocar ↑ apaga ↓ (excluyentes) y ordena de menor a mayor', JSON.stringify(difs) === JSON.stringify([-4, -2, 0, 2, 3, null]) && await p.evaluate(() => document.getElementById('fvsDifDescBtn').getAttribute('aria-pressed') === 'false'), JSON.stringify(difs));
  await p.click('#fvsDifDescBtn'); await p.waitForTimeout(250);
  chk('★ Tocar ↓ apaga ↑', await p.evaluate(() => document.getElementById('fvsDifAscBtn').getAttribute('aria-pressed') === 'false' && document.getElementById('fvsDifDescBtn').getAttribute('aria-pressed') === 'true'));
  await p.selectOption('#fvsGrupoSel', 'TEQUILA'); await p.waitForTimeout(250);
  f = await filasTabla(p);
  chk('★ ↓ respeta el grupo (TEQUILA: +2 y luego −4)', JSON.stringify(f.map(x => num(x.celdas[5]))) === JSON.stringify([2, -4]), JSON.stringify(f.map(x => x.nombre)));
  await p.selectOption('#fvsGrupoSel', ''); await p.waitForTimeout(150);
  await p.click('#fvsDifDescBtn'); await p.waitForTimeout(250);
  chk('Otro toque vuelve al orden por grupo', await p.evaluate(() => document.querySelectorAll('tr.fvs-t__grupo').length === 4));
  chk('★ Ordenar no modifica conteos ni catálogo', (await p.evaluate(() => JSON.stringify({ products, auditoriaConteo, myAuditoriaConteo }))) === antes);
  chk('Sin errores de JavaScript (Físico vs Sistema)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ═══ 2 · Importar → Último corte importado ═══
  ({ ctx, p, errs } = await abrir(nav, { width: 390, height: 844 }, 'admin'));
  await p.evaluate(SIM);
  await p.evaluate(() => { importarVolver(); activeTab = 'importar'; renderTab(); });
  await p.waitForTimeout(500);
  const panel = await p.evaluate(() => { const s = document.getElementById('impUltTit'); const b = document.getElementById('impBtnEliminarCorte'); return { tit: s && s.textContent, txt: s ? s.closest('section').innerText : '', btn: !!b, h: b ? b.getBoundingClientRect().height : 0 }; });
  chk('★ El hub muestra «Último corte importado» con el corte MÁS RECIENTE (ignora el contabilizado)', panel.tit === 'Último corte importado' && /2026-10-06_1000/.test(panel.txt) && /corte-ultimo\.xlsx/.test(panel.txt) && !/2026-10-04/.test(panel.txt), panel.txt);
  chk('Botón «Eliminar último corte» ≥ 44 px', panel.btn && panel.h >= 44, JSON.stringify(panel));
  // Cancelar
  await p.click('#impBtnEliminarCorte'); await p.waitForSelector('#_confirmOverlay');
  const msg = await p.evaluate(() => document.querySelector('#_confirmOverlay p').innerText);
  chk('La confirmación nombra el corte y avisa de la Papelera (30 días)', /2026-10-06_1000/.test(msg) && /Papelera/.test(msg) && /30 días/.test(msg), msg.slice(0, 200));
  await p.click('#_cfmCancel'); await p.waitForTimeout(250);
  chk('★ Cancelar NO borra nada', await p.evaluate(() => !!window.__sim.docs.anclasExistencia['2026-10-06_1000'] && Object.keys(window.__sim.docs.papelera).length === 0 && window.__sim.batches === 0));
  // Error del servidor
  await p.evaluate(() => { window.__sim.fallar = true; });
  await p.click('#impBtnEliminarCorte'); await p.waitForSelector('#_confirmOverlay'); await p.click('#_cfmOk'); await p.waitForTimeout(400);
  chk('★ Si el servidor rechaza, NO se borra nada y se avisa de las reglas', await p.evaluate(() => !!window.__sim.docs.anclasExistencia['2026-10-06_1000'] && Object.keys(window.__sim.docs.papelera).length === 0) && /rechaz/i.test(await p.evaluate(() => document.body.innerText)));
  await p.evaluate(() => { window.__sim.fallar = false; });
  // Eliminar
  await p.click('#impBtnEliminarCorte'); await p.waitForSelector('#_confirmOverlay'); await p.click('#_cfmOk'); await p.waitForTimeout(600);
  const post = await p.evaluate(() => { const d = window.__sim.docs; const pk = Object.keys(d.papelera);
    return { anclas: Object.keys(d.anclasExistencia).sort(), pap: pk, reg: pk.length ? d.papelera[pk[0]] : null, batches: window.__sim.batches }; });
  chk('★ Elimina SOLO el último importado (queda el anterior y el contabilizado)', JSON.stringify(post.anclas) === JSON.stringify(['2026-10-04', '2026-10-05_2340']), JSON.stringify(post.anclas));
  chk('★ Copia completa en la papelera, en el mismo batch (origen «corte», contenido íntegro)', post.pap.length === 1 && post.batches === 1 && post.reg.origen === 'corte' && JSON.stringify(post.reg.contenido).includes('corte-ultimo.xlsx'), JSON.stringify(post.reg).slice(0, 200));
  await p.waitForTimeout(500);
  const panel2 = await p.evaluate(() => { const s = document.getElementById('impUltTit'); return s ? s.closest('section').innerText : ''; });
  chk('El panel pasa a mostrar el corte anterior (2026-10-05_2340)', /2026-10-05_2340/.test(panel2), panel2);
  chk('Sin errores de JavaScript (Importar)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // Sin permiso
  ({ ctx, p, errs } = await abrir(nav, { width: 390, height: 844 }, 'ver'));
  await p.evaluate(SIM);
  const sinPerm = await p.evaluate(() => { try { activeTab = 'importar'; renderTab(); } catch (e) {} return { panel: !!document.getElementById('impUltTit'), boton: !!document.getElementById('impBtnEliminarCorte') }; });
  await p.evaluate(() => importarEliminarUltimoCorte()); await p.waitForTimeout(200);
  chk('★ Sin inventory.post no hay panel ni botón, y la función se niega (no borra)', !sinPerm.panel && !sinPerm.boton && await p.evaluate(() => Object.keys(window.__sim.docs.anclasExistencia).length === 3 && window.__sim.batches === 0));
  await ctx.close();

  await nav.close();
  console.log('\n  ── v5.36 · Diferencias ↓ y Eliminar último corte importado (navegador) ──\n');
  C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '   ← ' + (c.d || ''))));
  const fl = C.filter(c => !c.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fl) + ' pasaron · ' + fl + ' fallaron\n');
  process.exit(fl ? 1 : 0);
})();
