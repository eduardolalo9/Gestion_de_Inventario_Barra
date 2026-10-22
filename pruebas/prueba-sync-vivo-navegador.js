// v5.22 — Sincronización en vivo de compras, ventas y cortes (Chromium real, 390×844).
//   · la app carga el módulo nuevo y, ya con sesión, escucha compras, ventas, cortes e iniciales;
//   · una compra que "otro dispositivo" escribe aparece en la pestaña Compras SIN recargar;
//   · ventas / cortes de otro dispositivo recalculan el Total (releen Firestore una vez);
//   · lo que escribe este mismo dispositivo no dispara lecturas; el cierre de sesión apaga todo.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })).newPage();
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
    currentUserUid = 'u-admin'; _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['*']); _authzState.roleId = 'ADMIN';
    products = [
      { id: '1180001', name: 'TEQUILA DON JULIO', unit: 'PZA', group: 'TEQUILA', precio: 350, conversion: 750, stockByArea: { almacen: 2 } },
      { id: '1020064', name: 'LIMON', unit: 'KGS', group: 'FRUTA', precio: 38, stockByArea: { almacen: 5 } },
      { id: '1060020', name: 'FRESCA', unit: 'PZA', group: 'REFRESCOS', precio: 12, stockByArea: { almacen: 10 } }
    ];
    window.__confirm = [];
    window.showConfirm = function (m, cb) { window.__confirm.push(String(m)); cb(); };
    window.__m = {
      rgb: s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number),
      lum: ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); },
      efectivo(el) {
        const cadena = []; for (let e = el; e; e = e.parentElement) cadena.push(e);
        let base = this.rgb(getComputedStyle(document.documentElement).backgroundColor); if (base.length < 3 || (base.length === 4 && base[3] === 0)) base = [255, 255, 255];
        base = base.slice(0, 3);
        for (let i = cadena.length - 1; i >= 0; i--) {
          const c = this.rgb(getComputedStyle(cadena[i]).backgroundColor);
          if (c.length < 3) continue; const a = c.length === 4 ? c[3] : 1;
          if (a > 0) base = [0, 1, 2].map(k => c[k] * a + base[k] * (1 - a));
        }
        return base;
      },
      contraste(el) { const fg = this.rgb(getComputedStyle(el).color).slice(0, 3); const a = this.lum(fg), b = this.lum(this.efectivo(el)); return +((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2); },
      alto(el) { return +el.getBoundingClientRect().height.toFixed(1); }
    };
    window.__ir = (t) => { activeTab = t; renderTab(); };
  });

  const tema = (t) => p.evaluate(t => document.documentElement.setAttribute('data-theme', t), t);

  // Firestore simulado con onSnapshot: guarda las escuchas y cuenta las lecturas puntuales.
  await p.evaluate(() => {
    window.firebase = window.firebase || { firestore: { FieldPath: { documentId: () => ({ __id: true }) } } };   // sin red no hay SDK: se simula
    window.__escuchas = []; window.__lecturas = [];
    const consulta = (ruta, filtros) => {
      const q = {
        doc: (id) => docRef(ruta + '/' + id),
        get: async () => { window.__lecturas.push(ruta); return { empty: true, docs: [], size: 0, forEach() {} }; },
        onSnapshot: (cb, err) => { const e = { ruta, filtros: filtros.slice(), cb, err, viva: true }; window.__escuchas.push(e); return () => { e.viva = false; }; }
      };
      ['where', 'orderBy', 'limit', 'startAfter', 'endBefore'].forEach(k => { q[k] = (...a) => consulta(ruta, filtros.concat([k + ' ' + a.map(x => (x && x.__id) ? '__name__' : JSON.stringify(x)).join(' ')])); });
      return q;
    };
    const docRef = (ruta) => ({ collection: (c) => consulta(ruta + '/' + c, []), onSnapshot: () => () => {}, set: async () => {},
      get: async () => ({ exists: false, data: () => null }) });
    _db = { collection: (c) => consulta(c, []) };
    window.__avisos = [];
    window.showNotification = function (m) { window.__avisos.push(String(m)); };
    window.__snap = (docs, cambios, meta) => ({ metadata: Object.assign({ hasPendingWrites: false, fromCache: false }, meta || {}),
      docChanges: () => cambios || [], forEach: (fn) => docs.forEach(fn), docs });
    window.__doc = (id, data) => ({ id, data: () => data });
    window.__emit = (ruta, snap) => { const e = window.__escuchas.filter(x => x.viva && x.ruta === ruta).slice(-1)[0]; if (e) e.cb(snap); return !!e; };
    window.existenciaRepintarSeguro = window.existenciaRepintarSeguro;
  });

  // ── 1 · El módulo está y enciende las escuchas ───────────────────────────
  const m0 = await p.evaluate(() => ({ modulo: typeof syncVivoIniciar, detener: typeof syncVivoDetener, ok: syncVivoIniciar() }));
  chk('★ El módulo js/54-sync-vivo.js carga en la app real', m0.modulo === 'function' && m0.detener === 'function' && m0.ok === true, JSON.stringify(m0));
  const e0 = await p.evaluate(() => ({ rutas: __escuchas.filter(x => x.viva).map(x => x.ruta), estado: syncVivoEstado() }));
  chk('★ Con permisos de administración escucha compras, ventas, cortes e iniciales (4 flujos)',
      e0.rutas.length === 4 && /^compras$/.test(e0.rutas[0]) && e0.rutas.some(r => /\/ventas$/.test(r)) && e0.rutas.some(r => /\/anclasExistencia$/.test(r)) && e0.rutas.some(r => /\/inventariosIniciales$/.test(r)), e0.rutas.join(','));

  // ── 2 · Una compra de otro dispositivo aparece sin recargar ───────────────
  const sem = await p.evaluate(() => semanaId(new Date()));
  await p.evaluate(() => { compras = []; movimientos = []; comprasImportView = 'lista'; __ir('compras'); });
  await p.waitForTimeout(200);
  const antes = await p.evaluate(() => document.querySelectorAll('.cp-tarjeta').length);
  const cmp = (id, prov, folio) => ({ compraId: id, folio, docSap: '5' + folio, fecha: new Date().toISOString().slice(0, 10), semanaId: null, proveedorCodigo: 'P01', proveedorNombre: prov, origen: 'excel', importe: 680,
    lineas: [{ productoId: '1180001', descripcionSap: 'TEQ', cantidadDocumento: 2, unidadDocumento: 'PZA', cantidadInventario: 2, costoUnitario: 340, importe: 680, enCatalogo: true }] });
  await p.evaluate(({ sem, c }) => {
    c.semanaId = sem;
    __emit('compras', __snap([], []));                                   // base del servidor
    __emit('compras', __snap([], [{ type: 'added', doc: __doc(c.compraId, c) }]));   // otro dispositivo importó
  }, { sem, c: cmp('CV1', 'CASA CUERVO', 'F-700') });
  await p.waitForTimeout(1700);   // debounce de 1.2 s
  const d1 = await p.evaluate(() => ({ n: document.querySelectorAll('.cp-tarjeta').length, txt: (document.querySelector('#tabContent, main, .app-main') || document.body).innerText,
    enLista: compras.some(c => c.compraId === 'CV1'), asiento: movimientos.some(m => m.movId && /CV1/.test(m.movId)), avisos: __avisos.slice(), errs: 0 }));
  chk('★ La compra importada en el otro dispositivo aparece en la pestaña Compras SIN recargar', antes === 0 && d1.n === 1 && /CASA CUERVO/.test(d1.txt), JSON.stringify([antes, d1.n]));
  chk('Queda en la lista local y con su asiento en el libro (el Total la cuenta)', d1.enLista && d1.asiento);
  chk('Avisa en pantalla que se actualizó desde otro dispositivo', d1.avisos.some(a => /compras/.test(a) && /otro dispositivo/.test(a)), JSON.stringify(d1.avisos));
  const lect1 = await p.evaluate(() => __lecturas.length);
  chk('★ Una compra sola no relee Firestore (se toma de la escucha)', lect1 === 0, String(lect1));

  // ── 3 · Lo propio no dispara nada ─────────────────────────────────────────
  await p.evaluate(() => { __avisos.length = 0; __emit('compras', __snap([], [{ type: 'added', doc: __doc('PROPIA', { compraId: 'PROPIA', lineas: [{ productoId: '1180001', cantidad: 1 }] }) }], { hasPendingWrites: true })); });
  await p.waitForTimeout(1500);
  const pr = await p.evaluate(() => ({ en: compras.some(c => c.compraId === 'PROPIA'), avisos: __avisos.length, lecturas: __lecturas.length }));
  chk('★ Lo que escribe este mismo dispositivo se ignora (sin avisos ni lecturas dobles)', !pr.en && pr.avisos === 0 && pr.lecturas === 0, JSON.stringify(pr));

  // ── 4 · Ventas / corte de otro dispositivo recalculan el Total ────────────
  await p.evaluate(() => { _syncVivo.ultimoAviso = 0; });   // el aviso en pantalla se limita a uno cada 10 s
  await p.evaluate(() => { __ir('inicio'); __lecturas.length = 0; __avisos.length = 0;
    __emit('inventarioApp/' + FIRESTORE_DOC_ID + '/ventas', __snap([], []));
    __emit('inventarioApp/' + FIRESTORE_DOC_ID + '/anclasExistencia', __snap([], [])); });
  await p.evaluate(() => {
    __emit('inventarioApp/' + FIRESTORE_DOC_ID + '/ventas', __snap([], [{ type: 'added', doc: __doc('2026-10-06_2026-10-06', { semanaId: 's' }) }]));
    __emit('inventarioApp/' + FIRESTORE_DOC_ID + '/anclasExistencia', __snap([], [{ type: 'added', doc: __doc('2026-10-08_2200', { tipo: 'importacion_excel' }) }]));
  });
  await p.waitForTimeout(1900);
  const rv = await p.evaluate(() => ({ lect: __lecturas.slice(), avisos: __avisos.slice(), est: existenciaInicialEstado().estado }));
  chk('★ Ventas + corte de otro dispositivo → el Total se recalcula releyendo cortes e iniciales UNA vez',
      rv.lect.filter(r => /anclasExistencia$/.test(r)).length === 1 && rv.lect.filter(r => /inventariosIniciales$/.test(r)).length === 1, JSON.stringify(rv.lect));
  chk('Avisa de ventas y corte en un solo mensaje', rv.avisos.length === 1 && /ventas/.test(rv.avisos[0]) && /corte de existencias/.test(rv.avisos[0]), JSON.stringify(rv.avisos));

  // ── 5 · Importar en curso no se pisa ──────────────────────────────────────
  await p.evaluate(() => { _syncVivo.ultimoAviso = 0; });
  await p.evaluate(() => { activeTab = 'ventas'; ventasImportView = 'vista_previa'; window.__rn = 0; const r = renderTab; window.renderTab = function () { window.__rn++; return r.apply(this, arguments); }; __avisos.length = 0;
    __emit('inventarioApp/' + FIRESTORE_DOC_ID + '/ventas', __snap([], [{ type: 'added', doc: __doc('V2', { semanaId: 's' }) }])); });
  await p.waitForTimeout(1700);
  const vp = await p.evaluate(() => ({ rn: window.__rn, avisos: __avisos.length }));
  chk('★ Con una vista previa de ventas abierta NO se repinta (el jefe no pierde lo que revisa) pero sí se avisa', vp.rn === 0 && vp.avisos === 1, JSON.stringify(vp));
  await p.evaluate(() => { ventasImportView = 'lista'; });

  // ── 6 · Cierre de sesión ──────────────────────────────────────────────────
  await p.evaluate(() => syncVivoDetener());
  const fin = await p.evaluate(() => ({ vivas: __escuchas.filter(x => x.viva).length, activo: syncVivoEstado().activo }));
  chk('★ Al cerrar sesión se sueltan todas las escuchas', fin.vivas === 0 && !fin.activo, JSON.stringify(fin));
  const sinPerm = await p.evaluate(() => { _authzState.permissions = new Set(['inventory.count']); _authzState.roleId = 'BARTENDER'; __escuchas.length = 0; syncVivoIniciar();
    return __escuchas.filter(x => x.viva).map(x => x.ruta); });
  chk('★ Un bartender (sin leer compras/ventas) solo escucha cortes e iniciales: no pide compras ni ventas', sinPerm.length === 2 && !sinPerm.some(r => /compras|ventas/.test(r)), sinPerm.join(','));

  chk('Sin errores de JavaScript en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();
  let mal = 0; C.forEach(c => { if (!c.ok) mal++; console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  →  ' + c.d)); });
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron');
  process.exit(mal ? 1 : 0);
})();
