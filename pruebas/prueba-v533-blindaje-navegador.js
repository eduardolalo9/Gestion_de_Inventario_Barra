// v5.33 — Etapa 0: blindaje de `activeTab`, probado en Chromium contra la app REAL
// y contra una copia REAL de v5.32 (extraída del commit b9378d4 con `git archive`,
// fuera del repositorio). Nada toca Firebase: _db es un doble en memoria que
// registra lo que se escribiría.
//
//   npm run test:v533nav
//
// Qué demuestra:
//   A · Pestaña inválida en localStorage / IndexedDB → arranca en Inicio con contenido.
//   B · renderTab con una pestaña desconocida nunca deja la pantalla en blanco y no escribe nada.
//   C · Aplicar datos remotos conserva la pestaña local y SÍ actualiza los datos compartidos.
//   D · v5.32 real: qué pestañas procesa, qué le pasa con 'perfil' o una desconocida.
//   E · Extremo a extremo v5.33 → v5.32: lo que v5.33 sube a la nube lo procesa v5.32.
//   F · Prueba diferencial: el mismo guion en v5.32 y en v5.33 deja los datos del
//       inventario IDÉNTICOS (sólo difiere la pestaña).
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const COMMIT_V532 = 'b9378d4';
const V532_TABS = ['inicio', 'productos', 'pedidos', 'inventario', 'historia', 'compras', 'recetario',
    'ventas', 'pedido_sugerido', 'importar', 'papelera', 'ajustes', 'notificaciones', 'admin'];
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const NOVERIF = [];
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function servir(dir) {
    return new Promise((res) => {
        const s = http.createServer((req, rsp) => {
            let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
            const f = path.join(dir, u);
            if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
            rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            fs.createReadStream(f).pipe(rsp);
        }).listen(0, '127.0.0.1', () => res({ s, base: 'http://127.0.0.1:' + s.address().port }));
    });
}
function extraerV532() {
    execSync('git cat-file -e ' + COMMIT_V532 + '^{commit}', { cwd: RAIZ, stdio: 'ignore' });
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'bi-v532-'));
    execSync('git archive ' + COMMIT_V532 + ' | tar -x -C "' + dir + '"', { cwd: RAIZ, shell: '/bin/bash', stdio: 'ignore' });
    return dir;
}

// ── Código que se inyecta en la página ──────────────────────────────────────
const SESION_ADMIN = () => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'admin1'; currentUserRole = 'admin';
    _authzState.loaded = true; _authzState.roleId = 'ADMIN'; _authzState.permissions = new Set(['*']); _authzState.overrides = {};
    window._auth = { currentUser: { uid: 'admin1', email: 'a@b.c' } }; try { _auth = window._auth; } catch (e) {}
    _syncEnabled = true;
};
const INSTALAR_DB = () => {
    window.__sets = [];
    const vacio = { forEach() {}, empty: true, size: 0, docs: [] };
    const docRef = (p) => ({ path: p, id: p.split('/').pop(),
        get: async () => ({ exists: false, data: () => undefined }),
        set: async (d, o) => { window.__sets.push({ path: p, claves: Object.keys(d), tiene: Object.prototype.hasOwnProperty.call(d, 'activeTab'),
            activeTab: d.activeTab, merge: !!(o && o.merge), datos: JSON.parse(JSON.stringify(d)) }); },
        update: async () => {}, collection: (n) => colRef(p + '/' + n), onSnapshot() { return () => {}; } });
    const colRef = (p) => ({ path: p, doc: (id) => docRef(p + '/' + id), get: async () => vacio, where() { return this; }, limit() { return this; }, onSnapshot() { return () => {}; } });
    _db = { collection: (n) => colRef(n), batch: () => ({ set() {}, delete() {}, commit: async () => {} }) };
};
const SEMILLA = () => {
    products = [{ id: 'P1', name: 'TEQUILA', unit: 'PZA', group: 'Tequila', capacidadMl: 700, precio: 800, stockMinimo: 2, conversion: 1, stockByArea: { almacen: 3 } },
                { id: 'P2', name: 'VODKA', unit: 'PZA', group: 'Vodka', capacidadMl: 750, precio: 500, stockMinimo: 2, conversion: 1, stockByArea: { almacen: 5 } }];
    inventarioConteo = { P1: { almacen: { enteras: 3, abiertas: [0.5] } } };
    orders = [{ id: 'O1', supplier: 'Prov', date: '2026-10-20', items: [{ id: 'P1', quantity: 2 }] }];
    cart = [{ id: 'P2', quantity: 4 }];
    selectedArea = 'almacen';
};
const LEER = () => ({ tab: activeTab, largo: document.getElementById('tabContent').innerHTML.length });
const FOTO = () => JSON.stringify({
    products, orders, inventories, inventarioConteo, myAuditoriaConteo, auditoriaConteo, auditoriaStatus, cart, selectedArea,
    compras, movimientos, costosUltimos, recetas, ventas, _syncQueue
});

async function abrir(nav, base, lsInicial) {
    const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route((u) => !/^https?:\/\/127\.0\.0\.1/.test(u.href), (r) => r.abort());
    if (lsInicial) await ctx.addInitScript((ls) => { for (const k in ls) localStorage.setItem(k, ls[k]); }, lsInicial);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160))); p.on('dialog', (d) => d.dismiss());
    await p.goto(base + '/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(1800);
    p.__errs = errs; p.__ctx = ctx;
    return p;
}
const datosRemotos = (extra) => Object.assign({
    products: [{ id: 'C1', name: 'RON NUBE', unit: 'PZA', group: 'Ron' }], orders: [], inventories: [], cart: [{ id: 'C1', quantity: 9 }],
    selectedArea: 'almacen', _lastModified: Date.now() + 5000
}, extra || {});

(async () => {
    const nuevo = await servir(RAIZ);
    let viejo = null, dir532 = null;
    try { dir532 = extraerV532(); viejo = await servir(dir532); }
    catch (e) { NOVERIF.push('No se pudo extraer v5.32 con `git archive ' + COMMIT_V532 + '` (' + String(e.message).slice(0, 80) + '): las secciones D, E y F NO se verificaron.'); }
    const nav = await chromium.launch(require('./_lanzar-navegador')());

    // ═══ A · Restauración con valores inválidos ══════════════════════════════
    for (const v of ['perfil', 'xyz']) {
        const p = await abrir(nav, nuevo.base, { inventarioApp_activeTab: v });
        const r = await p.evaluate(LEER);
        chk('★ A1 · localStorage con pestaña inválida "' + v + '" → arranca en Inicio con contenido', r.tab === 'inicio' && r.largo > 0, JSON.stringify(r));
        await p.__ctx.close();
    }
    {   // IndexedDB inválido (más reciente que localStorage, que dice 'ventas')
        const p = await abrir(nav, nuevo.base);
        await p.evaluate(SESION_ADMIN);
        await p.evaluate(SEMILLA);
        await p.evaluate(async () => { saveToLocalStorage(); await _idbSaveAll(); });
        await p.goto(nuevo.base + '/manifest.json');            // sin scripts de la app: nada pisa lo que escribimos a mano
        await p.evaluate(() => new Promise((res, rej) => {
            const rq = indexedDB.open('BarInventoryDB', 2);
            rq.onerror = () => rej(rq.error);
            rq.onsuccess = () => {
                const tx = rq.result.transaction('criticalData', 'readwrite'); const st = tx.objectStore('criticalData');
                st.put('perfil', 'activeTab'); st.put(Date.now() + 600000, '_savedAt');
                tx.oncomplete = () => { localStorage.setItem('inventarioApp_activeTab', 'ventas'); localStorage.setItem('inventarioApp_lastModified', '1'); res(); };
            };
        }));
        await p.goto(nuevo.base + '/index.html', { waitUntil: 'load' }); await p.waitForTimeout(1800);
        const r = await p.evaluate(() => ({ tab: activeTab, largo: document.getElementById('tabContent').innerHTML.length, ids: products.map((x) => x.id), conteo: inventarioConteo }));
        chk('★ A2 · IndexedDB con pestaña inválida "perfil" (rama IndexedDB, no localStorage) → Inicio con contenido', r.tab === 'inicio' && r.largo > 0, JSON.stringify({ tab: r.tab, largo: r.largo }));
        chk('   …y los productos y el conteo restaurados son los que se guardaron', igual(r.ids, ['P1', 'P2']) && igual(r.conteo, { P1: { almacen: { enteras: 3, abiertas: [0.5] } } }), JSON.stringify(r.ids));
        await p.__ctx.close();
    }
    {   // Valor válido: se conserva
        const p = await abrir(nav, nuevo.base, { inventarioApp_activeTab: 'ventas' });
        const r = await p.evaluate(LEER);
        chk('A3 · localStorage con pestaña válida (ventas) → se restaura tal cual', r.tab === 'ventas' && r.largo > 0, JSON.stringify(r));
        await p.__ctx.close();
    }

    // ═══ B · renderTab con pestaña desconocida ══════════════════════════════
    {
        const p = await abrir(nav, nuevo.base);
        await p.evaluate(SESION_ADMIN); await p.evaluate(INSTALAR_DB); await p.evaluate(SEMILLA);
        await p.evaluate(() => { switchTab('productos'); });
        await p.waitForTimeout(300);
        const inicio = await p.evaluate(() => { activeTab = 'inicio'; renderTab(); return document.getElementById('tabContent').textContent.trim(); });
        await p.evaluate(() => { switchTab('productos'); });
        await p.waitForTimeout(300);
        const r = await p.evaluate(() => {
            window.__ls = []; const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k) { window.__ls.push(k); return o.apply(this, arguments); };
            window.__sets.length = 0;
            const antes = JSON.stringify({ products, inventarioConteo, orders, cart });
            const res = {};
            ['xyz', 'perfil', '', null, 5].forEach((v) => {
                activeTab = v; renderTab();
                res[String(v)] = { texto: document.getElementById('tabContent').textContent.trim(), tab: activeTab };
            });
            const despues = JSON.stringify({ products, inventarioConteo, orders, cart });
            Storage.prototype.setItem = o;
            return { res, escrituras: window.__ls.length, firestore: window.__sets.length, igual: antes === despues };
        });
        const todos = Object.keys(r.res).every((k) => r.res[k].texto.length > 0 && r.res[k].texto === inicio);
        chk('★ B1 · renderTab con "xyz", "perfil", vacío, null y número pinta la pantalla de Inicio (no queda en blanco)', todos, JSON.stringify(Object.keys(r.res).map((k) => [k, r.res[k].texto.length, r.res[k].texto === inicio])));
        chk('★ B2 · …sin escribir en localStorage, ni en Firestore, ni tocar los datos del inventario', r.escrituras === 0 && r.firestore === 0 && r.igual, JSON.stringify({ ls: r.escrituras, fs: r.firestore, igual: r.igual }));
        chk('B3 · …y no altera activeTab en memoria (la normalización no se hace en el render)', r.res.xyz.tab === 'xyz' && r.res.perfil.tab === 'perfil');
        await p.__ctx.close();
    }

    // ═══ C / F · datos remotos y diferencial v5.32 ↔ v5.33 ════════════════════
    async function guion(base, tabRemota) {
        const p = await abrir(nav, base);
        await p.evaluate(SESION_ADMIN); await p.evaluate(INSTALAR_DB); await p.evaluate(SEMILLA);
        await p.evaluate(() => { saveToLocalStorage(); });
        await p.evaluate(() => { switchTab('productos'); }); await p.evaluate(() => { switchTab('ventas'); });
        await p.evaluate(async () => { _syncInProgress = false; await syncToCloud(); });
        await p.waitForTimeout(300);
        const sync = await p.evaluate(() => window.__sets.filter((s) => s.path === 'inventarioApp/barra-principal').map((s) => ({ claves: s.claves.slice().sort(), tiene: s.tiene, activeTab: s.activeTab, merge: s.merge, cart: s.datos.cart, selectedArea: s.datos.selectedArea, ids: (s.datos.products || []).map((x) => x.id) })));
        const antesTab = await p.evaluate(() => activeTab);
        await p.evaluate(async (d) => { await _applyCloudData(d); }, datosRemotos({ activeTab: tabRemota }));
        await p.waitForTimeout(300);
        const r = await p.evaluate(() => ({ tab: activeTab, largo: document.getElementById('tabContent').innerHTML.length }));
        const foto = await p.evaluate(FOTO);
        const ls = await p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
        await p.__ctx.close();
        return { sync, antesTab, r, foto, ls };
    }
    const IGNORAR_LS = /_activeTab$|_lastModified$|_lastBackupTs$|_emergencySnapshot$|_preMergeBackup$|_syncQueue$|_deviceId|_auditUser$|_migrLog$/; // auditUser y migrLog llevan marcas de tiempo de sesión/migración (ruido ajeno a la pestaña)
    const nuevoR = await guion(nuevo.base, 'compras');
    chk('★ C1 · v5.33: tras aplicar datos remotos con activeTab="compras", la pestaña local ("ventas") se conserva', nuevoR.r.tab === 'ventas' && nuevoR.r.largo > 0, JSON.stringify(nuevoR.r));
    const nuevoP = await guion(nuevo.base, 'perfil');
    chk('★ C2 · v5.33: con activeTab="perfil" remoto tampoco cambia la pestaña local', nuevoP.r.tab === 'ventas' && nuevoP.r.largo > 0, JSON.stringify(nuevoP.r));
    const ids = (f) => JSON.parse(f).products.map((x) => x.id).sort();
    chk('★ C3 · v5.33: los datos compartidos SÍ se aplican (el producto de la nube C1 se fusionó con los locales)', igual(ids(nuevoR.foto), ['C1', 'P1', 'P2']), JSON.stringify(ids(nuevoR.foto)));
    chk('C4 · v5.33: la sincronización escribió con merge:true y la pestaña válida "ventas" viajó', nuevoR.sync.length >= 1 && nuevoR.sync[0].merge && nuevoR.sync[0].tiene && nuevoR.sync[0].activeTab === 'ventas', JSON.stringify(nuevoR.sync.map((s) => [s.merge, s.tiene, s.activeTab])));

    if (viejo) {
        const viejoR = await guion(viejo.base, 'compras');
        chk('D0 · (premisa) v5.32 adopta la pestaña remota, como se documentó', viejoR.r.tab === 'compras', JSON.stringify(viejoR.r));
        chk('★ F1 · MISMO guion en v5.32 y v5.33: la foto de los datos del inventario (productos, pedidos, conteos, carrito, compras, ventas, cola) es IDÉNTICA',
            viejoR.foto === nuevoR.foto, viejoR.foto === nuevoR.foto ? '' : 'difieren: ' + viejoR.foto.length + ' vs ' + nuevoR.foto.length);
        const clavesLS = (o) => Object.keys(o).filter((k) => !IGNORAR_LS.test(k)).sort();
        const difLS = clavesLS(viejoR.ls).concat(clavesLS(nuevoR.ls)).filter((k, i, a) => a.indexOf(k) === i).filter((k) => viejoR.ls[k] !== nuevoR.ls[k]);
        chk('★ F2 · …y todas las claves inventarioApp_* de localStorage (salvo pestaña y marcas de tiempo) son idénticas', difLS.length === 0, difLS.join(', '));
        chk('★ F3 · …y el payload sincronizado es el mismo (mismas claves, carrito, área, productos) en ambas versiones',
            igual(viejoR.sync.map((s) => [s.claves, s.cart, s.selectedArea, s.ids]), nuevoR.sync.map((s) => [s.claves, s.cart, s.selectedArea, s.ids])),
            JSON.stringify([viejoR.sync[0] && viejoR.sync[0].claves, nuevoR.sync[0] && nuevoR.sync[0].claves]));
    }

    // ═══ D · Qué hace v5.32 con cada pestaña ═════════════════════════════════
    const mezcla = {};   // lo que cada valor de pestaña produce en una copia v5.32
    if (viejo) {
        const p = await abrir(nav, viejo.base);
        await p.evaluate(SESION_ADMIN); await p.evaluate(INSTALAR_DB); await p.evaluate(SEMILLA);
        const aplicar = async (t) => {
            await p.evaluate(() => { activeTab = 'inicio'; renderTab(); });
            const previo = await p.evaluate(() => document.getElementById('tabContent').innerHTML);
            await p.evaluate(async (d) => { _applyingCloudData = false; await _applyCloudData(d); }, datosRemotos({ activeTab: t, products: [] }));
            await p.waitForTimeout(150);
            const r = await p.evaluate(() => ({ tab: activeTab, html: document.getElementById('tabContent').innerHTML }));
            return { tab: r.tab, largo: r.html.length, cambioPantalla: r.html !== previo };
        };
        for (const t of V532_TABS) mezcla[t] = await aplicar(t);
        chk('★ D1 · v5.32 REAL procesa y pinta cada una de las 14 pestañas compartibles (adopta la pestaña y la pantalla cambia o, en Inicio, se pinta)',
            V532_TABS.every((t) => mezcla[t].tab === t && mezcla[t].largo > 0), JSON.stringify(V532_TABS.filter((t) => !(mezcla[t].tab === t && mezcla[t].largo > 0))));
        for (const t of ['perfil', 'xyz']) mezcla[t] = await aplicar(t);
        chk('D2 · (límite documentado) v5.32 REAL, al recibir "perfil" o una pestaña desconocida, SÍ la adopta y NO cambia la pantalla (queda la anterior)',
            ['perfil', 'xyz'].every((t) => mezcla[t].tab === t && mezcla[t].cambioPantalla === false), JSON.stringify([mezcla.perfil, mezcla.xyz]));
        await p.__ctx.close();
        const pb = await abrir(nav, viejo.base, { inventarioApp_activeTab: 'perfil' });
        const rb = await pb.evaluate(LEER);
        chk('D3 · (límite documentado) v5.32 REAL arrancando con "perfil" guardado queda con la pantalla EN BLANCO', rb.tab === 'perfil' && rb.largo === 0, JSON.stringify(rb));
        await pb.__ctx.close();
    }

    // ═══ E · Extremo a extremo v5.33 → v5.32 ═════════════════════════════════
    if (viejo) {
        const valores = V532_TABS.concat(['perfil', 'xyz', '', null, 5, 'INICIO']);
        const p = await abrir(nav, nuevo.base);
        await p.evaluate(SESION_ADMIN); await p.evaluate(INSTALAR_DB); await p.evaluate(SEMILLA);
        const subidos = [];
        for (const v of valores) {
            const r = await p.evaluate(async (v) => {
                window.__sets.length = 0; activeTab = v; _syncInProgress = false;
                try { await syncToCloud(); } catch (e) {}
                const s = window.__sets.filter((x) => x.path === 'inventarioApp/barra-principal')[0];
                return s ? { tiene: s.tiene, activeTab: s.activeTab } : null;
            }, v);
            subidos.push({ v, r });
        }
        await p.__ctx.close();
        const sinEscritura = subidos.filter((x) => !x.r).map((x) => String(x.v));
        chk('E0 · (premisa) v5.33 escribió el documento para cada valor probado', sinEscritura.length === 0, sinEscritura.join(','));
        const salieron = subidos.filter((x) => x.r && x.r.tiene).map((x) => x.r.activeTab);
        chk('★ E1 · v5.33 NUNCA envía "perfil" ni una pestaña desconocida: todo lo enviado es una de las 14 que v5.32 conoce',
            salieron.every((t) => V532_TABS.indexOf(t) !== -1) && !salieron.includes('perfil') && !salieron.includes('xyz'), JSON.stringify(salieron));
        chk('E2 · …y para esos valores inválidos la clave simplemente no viaja',
            subidos.filter((x) => V532_TABS.indexOf(x.v) === -1).every((x) => x.r && x.r.tiene === false),
            JSON.stringify(subidos.filter((x) => V532_TABS.indexOf(x.v) === -1 && x.r && x.r.tiene).map((x) => String(x.v))));

        // Documento de la nube tal como queda: lo anterior + merge del payload (omitir una clave conserva la previa; verificado con el emulador en prueba-v533-merge-emulador.js)
        const pv = await abrir(nav, viejo.base);
        await pv.evaluate(SESION_ADMIN); await pv.evaluate(INSTALAR_DB); await pv.evaluate(SEMILLA);
        const resultados = [];
        for (const x of subidos) {
            const docNube = Object.assign({ activeTab: 'productos' }, x.r && x.r.tiene ? { activeTab: x.r.activeTab } : {});
            await pv.evaluate(() => { activeTab = 'inicio'; renderTab(); });
            await pv.evaluate(async (d) => { _applyingCloudData = false; await _applyCloudData(d); }, datosRemotos({ activeTab: docNube.activeTab, products: [] }));
            await pv.waitForTimeout(120);
            resultados.push(Object.assign({ v: String(x.v) }, await pv.evaluate(LEER)));
        }
        await pv.__ctx.close();
        chk('★ E3 · lo que v5.33 deja en la nube lo recibe v5.32 REAL sin pantalla en blanco y con una pestaña que conoce (en los 20 casos probados)',
            resultados.every((r) => V532_TABS.indexOf(r.tab) !== -1 && r.largo > 0), JSON.stringify(resultados.filter((r) => !(V532_TABS.indexOf(r.tab) !== -1 && r.largo > 0))));
    }

    await nav.close(); nuevo.s.close(); if (viejo) viejo.s.close();
    if (dir532) { try { fs.rmSync(dir532, { recursive: true, force: true }); } catch (e) {} }

    const w = Math.max.apply(null, C.map((c) => c.n.length));
    console.log('\n  ── v5.33 · Etapa 0: blindaje de activeTab (navegador, contra v5.32 real) ──\n');
    C.forEach((c) => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(Math.min(w, 170)) + (c.ok ? '' : '   ← ' + c.d)));
    const fallos = C.filter((c) => !c.ok).length;
    console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron');
    NOVERIF.forEach((m) => console.log('  ⚠️  NO VERIFICADO: ' + m));
    console.log('');
    process.exit(fallos ? 1 : (NOVERIF.length ? 3 : 0));
})().catch((e) => { console.error('ERROR en la prueba:', e); process.exit(2); });
