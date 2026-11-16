// v5.52 — Muestreo: filtros por desviación, grupo, buscador y revisados. Chromium real, 390 px.
// Firestore se sustituye por un doble que REGISTRA cada update(): los filtros no deben generar ninguno.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';
const FAKE = () => {
  window.__upd = [];
  const vacio = { exists: false, docs: [], empty: true, size: 0, forEach() {}, data() { return {}; }, docChanges() { return []; } };
  const mk = (ruta) => new Proxy(function () {}, { get(_, k) {
    if (k === 'update') return (...a) => { window.__upd.push({ ruta, a }); return Promise.resolve(); };
    if (k === 'get') return () => Promise.resolve(vacio); if (k === 'onSnapshot') return () => () => {}; if (k === 'then') return undefined;
    return (...a) => mk(ruta + '/' + (typeof a[0] === 'string' ? a[0] : k)); } });
  window.firebase = window.firebase || {}; firebase.firestore = firebase.firestore || {};
  firebase.firestore.FieldValue = { arrayUnion: (...v) => ({ op: 'union', v }), arrayRemove: (...v) => ({ op: 'remove', v }), delete: () => ({ op: 'delete' }) };
  firebase.firestore.FieldPath = function (...s) { this.segmentos = s; };
  _db = mk('db');
};
const MONTAR = () => {
  document.getElementById('authLoadingScreen').classList.add('auth-hidden'); document.getElementById('loginScreen').classList.add('auth-hidden'); document.getElementById('appWrapper').classList.add('auth-visible');
  currentUserUid = 'adm'; currentUserRole = 'admin'; _authzState.loaded = true; _authzState.overrides = {}; _authzState.permissions = new Set(['*']);
  const P = (id, name, group, stock) => ({ id, name, group, unit: 'Botellas', precio: 100, stockMinimo: 1, stockByArea: { almacen: stock } });
  products = [P('A', 'TEQUILA FALTANTE', 'TEQUILA', 10), P('B', 'TEQUILA SOBRANTE', 'TEQUILA', 3), P('C', 'VODKA COINCIDE', 'VODKA', 4),
              P('D', 'VODKA FALTANTE', 'VODKA', 8), P('E', 'RON SOBRANTE ÁMBAR', 'RON', 1), P('F', 'GINEBRA FUERA DE LA LISTA', 'GINEBRA', 5)];
  // sistema = stockByArea (sin inicial) · físico = auditoriaConteo
  auditoriaConteo = { A: { almacen: { enteras: 6, abiertas: [] } }, B: { almacen: { enteras: 5, abiertas: [] } }, C: { almacen: { enteras: 4, abiertas: [] } },
                      D: { almacen: { enteras: 7, abiertas: [] } }, E: { almacen: { enteras: 3, abiertas: [] } }, F: { almacen: { enteras: 5, abiertas: [] } } };
  myAuditoriaConteo = JSON.parse(JSON.stringify(auditoriaConteo));
  _auditoriaSessionId = 'INV1001'; _inventarioActivoId = 'INV1001'; _unsubInventarioActivo = () => {};
  _inventarioActivo = { estado: 'SINCRONIZADO', numero: 1001, fechaCreacion: Date.now(),
                        muestreo: { ids: ['A', 'B', 'C', 'D', 'E'], revisados: { C: 111, D: 222 }, actualizadoEn: 1, actualizadoPor: 'adm' } };
  allUsersAuditoria = {}; activeTab = 'inventario'; auditoriaView = 'fisico_vs_sistema'; _fvsVista.tab = 'muestreo'; renderTab();
};
const vis = (p) => p.evaluate(() => Array.from(document.querySelectorAll('.fvs-mu__item .fvs-mu__sub')).map(e => e.textContent.split(' ')[0].trim()).join(','));
const res = (p) => p.evaluate(() => { const e = document.querySelector('.fvs-mu__res'); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; });
const nUpd = (p) => p.evaluate(() => window.__upd.length);

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); });
  await p.waitForTimeout(600);
  await p.evaluate(FAKE); await p.evaluate(MONTAR); await p.waitForTimeout(300);

  // ═══ 1 · Controles presentes y sin filtrar por defecto ═══
  chk('★ La pestaña Muestreo trae buscador, Desviación, Grupo y Revisados', await p.evaluate(() => !!document.getElementById('sbx-input-fvsmu') && !!document.getElementById('fvsMuDesvSel') && !!document.getElementById('fvsMuGrupoSel') && document.querySelectorAll('[data-fvs-accion="mu-rev"]').length === 3));
  chk('Por defecto se ven los 5 productos del muestreo (el que no está en la lista, F, nunca aparece)', await vis(p) === 'A,B,C,D,E', await vis(p));
  chk('Sin filtros no hay resumen ni «Quitar filtros»', await res(p) === '');
  const rot = await p.evaluate(() => ({ d: Array.from(document.querySelectorAll('#fvsMuDesvSel option')).map(o => o.textContent.trim()), g: Array.from(document.querySelectorAll('#fvsMuGrupoSel option')).map(o => o.textContent.trim()),
                                         r: Array.from(document.querySelectorAll('[data-fvs-accion="mu-rev"]')).map(b => b.innerText.replace(/\s+/g, ' ').trim()) }));
  chk('★ Los rótulos traen sus conteos: Todas (5) · Con diferencia (4) · Faltante (2) · Sobrante (2) · Coincide (1)', rot.d.join(' | ') === 'Todas las desviaciones (5) | Con diferencia (4) | Faltante (2) | Sobrante (2) | Coincide (1)', rot.d.join(' | '));
  chk('Los grupos son los del muestreo, con su cantidad (RON 1 · TEQUILA 2 · VODKA 2) y NO GINEBRA', rot.g.join(' | ') === 'Todos los grupos (5) | RON (1) | TEQUILA (2) | VODKA (2)', rot.g.join(' | '));
  chk('Revisados: Todos 5 · Pendientes 3 · Revisados 2', rot.r.join(' | ') === 'Todos 5 | Pendientes 3 | Revisados 2', rot.r.join(' | '));
  const antes = await nUpd(p);

  // ═══ 2 · Desviación ═══
  await p.selectOption('#fvsMuDesvSel', 'faltante'); await p.waitForTimeout(250);
  chk('★ Desviación «Faltante» → A y D', await vis(p) === 'A,D', await vis(p));
  chk('El resumen dice «2 de 5 en el muestreo» y ofrece quitar los filtros', /2 de 5 en el muestreo/.test(await res(p)) && /Quitar filtros/.test(await res(p)), await res(p));
  await p.selectOption('#fvsMuDesvSel', 'sobrante'); await p.waitForTimeout(250);
  chk('★ «Sobrante» → B y E', await vis(p) === 'B,E', await vis(p));
  await p.selectOption('#fvsMuDesvSel', 'coincide'); await p.waitForTimeout(250);
  chk('★ «Coincide» → C', await vis(p) === 'C', await vis(p));
  await p.selectOption('#fvsMuDesvSel', 'con'); await p.waitForTimeout(250);
  chk('★ «Con diferencia» → A, B, D, E', await vis(p) === 'A,B,D,E', await vis(p));

  // ═══ 3 · Grupo (se combina con la desviación) ═══
  await p.selectOption('#fvsMuGrupoSel', 'TEQUILA'); await p.waitForTimeout(250);
  chk('★ Con diferencia + grupo TEQUILA → A y B', await vis(p) === 'A,B', await vis(p));
  await p.selectOption('#fvsMuDesvSel', 'faltante'); await p.waitForTimeout(250);
  chk('Faltante + TEQUILA → A', await vis(p) === 'A', await vis(p));

  // ═══ 4 · Revisados ═══
  await p.click('[data-fvs-rev="revisados"]'); await p.waitForTimeout(250);
  chk('★ Faltante + TEQUILA + Revisados → ninguno, con mensaje y botón para quitar filtros', await vis(p) === '' && /Ningún producto del muestreo coincide/.test(await p.evaluate(() => document.querySelector('.fvs-mu').innerText)) && await p.locator('[data-fvs-accion="mu-limpiar"]').count() === 1);
  chk('El botón de Revisados queda marcado (aria-pressed)', await p.getAttribute('[data-fvs-rev="revisados"]', 'aria-pressed') === 'true' && await p.getAttribute('[data-fvs-rev="todos"]', 'aria-pressed') === 'false');
  await p.click('[data-fvs-accion="mu-limpiar"]'); await p.waitForTimeout(250);
  chk('★ «Quitar filtros» devuelve los 5 productos y reinicia los tres controles', await vis(p) === 'A,B,C,D,E' && await p.evaluate(() => document.getElementById('fvsMuDesvSel').value === 'todas' && document.getElementById('fvsMuGrupoSel').value === ''));
  await p.click('[data-fvs-rev="revisados"]'); await p.waitForTimeout(250);
  chk('★ Revisados → C y D', await vis(p) === 'C,D', await vis(p));
  await p.click('[data-fvs-rev="pendientes"]'); await p.waitForTimeout(250);
  chk('★ Pendientes → A, B, E', await vis(p) === 'A,B,E', await vis(p));

  // ═══ 5 · Buscador (combinado con los demás) ═══
  await p.click('[data-fvs-rev="todos"]'); await p.waitForTimeout(250);
  await p.fill('#sbx-input-fvsmu', 'tequ'); await p.waitForTimeout(600);
  chk('★ Buscar «tequ» → A y B', await vis(p) === 'A,B', await vis(p));
  await p.fill('#sbx-input-fvsmu', 'ambar'); await p.waitForTimeout(600);
  chk('★ La búsqueda ignora acentos y mayúsculas: «ambar» → E (RON SOBRANTE ÁMBAR)', await vis(p) === 'E', await vis(p));
  await p.fill('#sbx-input-fvsmu', 'D'); await p.waitForTimeout(600);
  chk('Buscar por código exacto: «D» → D', (await vis(p)).split(',')[0] === 'D', await vis(p));
  await p.fill('#sbx-input-fvsmu', 'f'); await p.waitForTimeout(600);
  chk('Un producto que no está en el muestreo (GINEBRA, F) no aparece aunque coincida con la búsqueda', !(await vis(p)).split(',').includes('F'), await vis(p));
  await p.fill('#sbx-input-fvsmu', 'vodka'); await p.waitForTimeout(600);
  await p.selectOption('#fvsMuDesvSel', 'faltante'); await p.waitForTimeout(300);
  chk('★ Buscador + desviación juntos: «vodka» + Faltante → D', await vis(p) === 'D', await vis(p));
  chk('El texto buscado se conserva al cambiar un filtro', await p.inputValue('#sbx-input-fvsmu') === 'vodka');
  chk('El buscador de Muestreo es independiente del del Comparativo', await p.evaluate(() => _fvsSearchTerm === '' && _fvsMuTerm === 'vodka'));

  // ═══ 6 · Marcar revisado con filtro «Pendientes»: el producto sale y los contadores se actualizan ═══
  await p.click('[data-fvs-accion="mu-limpiar"]'); await p.waitForTimeout(250);
  await p.click('[data-fvs-rev="pendientes"]'); await p.waitForTimeout(250);
  await p.click('[data-fvs-accion="mu-revisado"][data-fvs-pid="A"]'); await p.waitForTimeout(300);
  chk('★ Al marcar A como revisado con «Pendientes» activo, A sale de la vista y quedan B y E', await vis(p) === 'B,E', await vis(p));
  const rev2 = await p.evaluate(() => Array.from(document.querySelectorAll('[data-fvs-accion="mu-rev"]')).map(b => b.innerText.replace(/\s+/g, ' ').trim()).join(' | '));
  chk('Los contadores se actualizan: Pendientes 2 · Revisados 3', rev2 === 'Todos 5 | Pendientes 2 | Revisados 3', rev2);
  const u = await p.evaluate(() => window.__upd.length);
  chk('★ Solo marcar revisado escribió en la nube (1 escritura); los filtros anteriores no escribieron nada', u - antes === 1, 'antes=' + antes + ' ahora=' + u);

  // ═══ 7 · Táctil, desbordamiento y reinicio ═══
  const m = await p.evaluate(() => {
    const alto = (e) => Math.round(e.getBoundingClientRect().height);
    return { sel: Array.from(document.querySelectorAll('.fvs-mu__filtros .fvs-ctl__btn')).map(alto), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  chk('★ Todos los controles de filtro miden ≥ 44 px de alto (táctil)', m.sel.length === 5 && m.sel.every(h => h >= 44), JSON.stringify(m));
  chk('Sin desbordamiento horizontal a 390 px', !m.overflow);
  await p.evaluate(() => { fvsReiniciarVista(); });
  chk('★ Al salir (fvsReiniciarVista) los filtros y el texto vuelven a su estado inicial', await p.evaluate(() => _fvsVista.muDesv === 'todas' && _fvsVista.muGrupo === null && _fvsVista.muRev === 'todos' && _fvsMuTerm === ''));
  // Comparativo sigue funcionando
  await p.evaluate(() => { _fvsVista.tab = 'comparativo'; renderTab(); }); await p.waitForTimeout(300);
  chk('La pestaña Comparativo sigue intacta (su tabla y su buscador)', await p.evaluate(() => !!document.querySelector('.fvs-t') && !!document.getElementById('sbx-input-fvs') && !document.getElementById('sbx-input-fvsmu')));
  chk('Sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  await nav.close();
  const fallos = C.filter(c => !c.ok);
  C.forEach(c => console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  ← ' + c.d)));
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
  process.exit(fallos.length ? 1 : 0);
})();
