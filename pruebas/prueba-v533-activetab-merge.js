/**
 * prueba-v533-activetab-merge.js — v5.33 Etapa 0: blindaje de activeTab
 * ═══════════════════════════════════════════════════════════════════════
 * Valida que la lógica de tabParaNube/tabSegura y el comportamiento
 * merge:true de Firestore blindan correctamente la pestaña activa:
 *
 *   L1  tabParaNube() retorna el nombre de la pestaña para tabs válidas.
 *   L2  tabParaNube() retorna null para tabs inválidas/futuras → la clave
 *       se omite del payload (no se envía como undefined ni como el valor).
 *   L3  tabSegura() normaliza a 'inicio' cualquier valor inválido/nulo.
 *   L4  tabSegura() preserva intactas las 14 pestañas válidas.
 *
 *   M1  Pestaña inválida en sync → clave OMITIDA del payload →
 *       merge:true preserva el valor previo en Firestore.
 *   M2  Pestaña válida en sync → clave INCLUIDA en el payload →
 *       merge:true actualiza el valor en Firestore.
 *   M3  Documento con pestaña inválida en Firestore (escrito por versión
 *       futura) → tabSegura() normaliza a 'inicio' al leerlo localmente.
 *   M4  Ciclo completo: Firestore tiene 'admin'; dispositivo B sincroniza
 *       con 'perfil' (inválida) → Firestore conserva 'admin'.
 *   M5  Las 14 pestañas válidas viajan y persisten correctamente.
 *   M6  Las reglas de Firestore permiten que activeTab sea escrito por
 *       un usuario autenticado (está en _camposSyncNoAdmin()).
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-v533-activetab-merge.js"
 * ═══════════════════════════════════════════════════════════════════════
 */
'use strict';

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ       = path.resolve(__dirname, '..');
const PROJECT_ID = 'demo-barinventory';
const COL        = 'inventarioApp';
const DOC_ID     = 'barra-principal';

let fallos = 0, total = 0;
function chk(nombre, ok, detalle) {
    total++;
    if (ok) { console.log('  ✅ ' + nombre); }
    else     { fallos++; console.error('  ❌ ' + nombre + (detalle ? '  ← ' + detalle : '')); }
}
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

// ── Cargar las funciones v5.33 de js/00-nucleo.js ──────────────────────────
function cargarFuncionesNucleo() {
    const src = leer('js/00-nucleo.js');
    // La regex salta el resto de la línea BEGIN (que contiene texto libre tras el marcador)
    // y captura solo el bloque de código hasta END.
    const m = src.match(/\/\/ v5\.33-TABS-BEGIN[^\n]*\n([\s\S]*?)\/\/ v5\.33-TABS-END/);
    if (!m) throw new Error('Bloque v5.33-TABS-BEGIN no encontrado en js/00-nucleo.js');
    // 'const' y 'function' en top-level de un contexto vm no se exponen como propiedades
    // del sandbox (son block-scoped). Los devolvemos explícitamente con una IIFE.
    const sandbox = Object.create(null);
    sandbox.Object = Object;
    sandbox.Array  = Array;
    vm.createContext(sandbox);
    const code = '(function(){\n' + m[1].trim() + '\nreturn { TABS_VALIDAS, TABS_COMPARTIBLES, tabValida, tabSegura, tabParaNube };\n})()';
    const funcs = vm.runInContext(code, sandbox);
    if (typeof funcs.tabSegura !== 'function')  throw new Error('tabSegura no exportada');
    if (typeof funcs.tabParaNube !== 'function') throw new Error('tabParaNube no exportada');
    return funcs; // { TABS_VALIDAS, TABS_COMPARTIBLES, tabValida, tabSegura, tabParaNube }
}

// ── Simular la lógica del payload de syncToCloud (js/40, líneas 1174-1176) ─
// Esta función replica exactamente el código v5.33:
//   const _tabNube = (typeof tabParaNube === 'function') ? tabParaNube(activeTab) : activeTab;
//   if (_tabNube) payload.activeTab = _tabNube;
function construirPayloadActiveTab(activeTab, funcs) {
    const payload = {};
    const _tabNube = (typeof funcs.tabParaNube === 'function')
        ? funcs.tabParaNube(activeTab)
        : activeTab;
    if (_tabNube) payload.activeTab = _tabNube;
    return { payload, _tabNube };
}

// Payload mínimo equivalente al que syncToCloud construye (campos base)
function payloadBase(extra) {
    return Object.assign({
        cart: [],
        selectedArea: 'almacen',
        _lastModified: Date.now(),
        _syncedAt:     Date.now(),
        _ordersInChunks:      true,
        _inventoriesInChunks: true,
        _conteoInSubcol:      true,
        _lastWrittenBy:   'uid-test',
        _lastWrittenRole: 'admin'
    }, extra || {});
}

(async () => {
    let testEnv;
    try {
        // ── Cargar funciones JS ──────────────────────────────────────────
        const funcs = cargarFuncionesNucleo();

        // ── Inicializar emulador con reglas reales ───────────────────────
        testEnv = await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: {
                rules: leer('firestore.rules'),
                host:  'localhost',
                port:  8080
            }
        });

        // Contextos reutilizables
        const asAdmin    = () => testEnv.authenticatedContext('uid-admin', { role: 'admin' }).firestore();
        const asBartender= () => testEnv.authenticatedContext('uid-barra', { role: 'bartender' }).firestore();
        const asRoot     = (ctx) => ctx.firestore(); // dentro de withSecurityRulesDisabled

        // ── SUITE L: Lógica local (sin Firestore) ────────────────────────
        console.log('\n── Suite L: Lógica local de tabParaNube / tabSegura ──────────');

        // L1: tabs válidas → se incluyen en el payload
        const VALIDAS = ['inicio','productos','pedidos','inventario','historia','compras',
                         'recetario','ventas','pedido_sugerido','importar','papelera',
                         'ajustes','notificaciones','admin'];
        for (const t of VALIDAS) {
            const { payload, _tabNube } = construirPayloadActiveTab(t, funcs);
            chk('L1 tabParaNube("' + t + '") → incluida en payload',
                _tabNube === t && payload.activeTab === t,
                'tabNube=' + _tabNube);
        }

        // L2: tabs inválidas/futuras → null → clave OMITIDA del payload
        const INVALIDAS = ['perfil', 'ajustes2', 'INICIO', 'Inicio', '', 'undefined',
                           undefined, null, 0, 123, {}, [], false, 'mi-perfil', 'VENTAS'];
        for (const t of INVALIDAS) {
            const { payload, _tabNube } = construirPayloadActiveTab(t, funcs);
            const omitida = !('activeTab' in payload);
            chk('L2 tabParaNube("' + t + '") → null → clave omitida del payload',
                _tabNube === null && omitida,
                'tabNube=' + JSON.stringify(_tabNube) + ' clave=' + (omitida ? 'OMITIDA ✓' : String(payload.activeTab)));
        }

        // L3: tabSegura normaliza inválidos → 'inicio'
        const INVALIDAS_SEG = ['perfil', '', undefined, null, 0, false, 'INICIO', 123, 'mi-perfil'];
        for (const t of INVALIDAS_SEG) {
            const r = funcs.tabSegura(t);
            chk('L3 tabSegura("' + t + '") → "inicio"',
                r === 'inicio', 'obtuvo: ' + JSON.stringify(r));
        }

        // L4: tabSegura preserva tabs válidas
        for (const t of VALIDAS) {
            const r = funcs.tabSegura(t);
            chk('L4 tabSegura("' + t + '") → preservada',
                r === t, 'obtuvo: ' + JSON.stringify(r));
        }

        // ── SUITE M: merge:true contra Firestore emulador ────────────────
        console.log('\n── Suite M: merge:true de activeTab contra Firestore emulador ──');

        await testEnv.clearFirestore();

        // Siembra mínima de cuentas: firestore.rules exige que exista usuarios/{uid}
        // (_cuentaActiva) para LEER el documento principal y para que isAdminUser() sea
        // verdadero. Sin esto, la primera lectura falla con "evaluation error at L323".
        // clearFirestore() borra todo, por eso se siembra DESPUÉS de limpiar.
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await asRoot(ctx).doc('usuarios/uid-admin').set({ uid: 'uid-admin', role: 'ADMIN', status: 'activo' });
            await asRoot(ctx).doc('usuarios/uid-barra').set({ uid: 'uid-barra', role: 'user',  status: 'activo' });
        });

        // M1 — Pestaña INVÁLIDA: clave omitida del payload → merge:true PRESERVA valor previo
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await asRoot(ctx).collection(COL).doc(DOC_ID)
                .set(payloadBase({ activeTab: 'compras' }));
        });
        const preM1 = (await asAdmin().collection(COL).doc(DOC_ID).get()).data();
        chk('M1.pre  documento sembrado con activeTab="compras"',
            preM1.activeTab === 'compras', 'valor: ' + preM1.activeTab);

        const { payload: pM1, _tabNube: tM1 } = construirPayloadActiveTab('perfil', funcs);
        Object.assign(pM1, payloadBase());
        chk('M1.a   tabParaNube("perfil") devuelve null',     tM1 === null);
        chk('M1.b   activeTab ausente del payload enviado',   !('activeTab' in pM1));

        await asAdmin().collection(COL).doc(DOC_ID).set(pM1, { merge: true });
        const snapM1 = (await asAdmin().collection(COL).doc(DOC_ID).get()).data();
        chk('M1.c   merge:true preserva "compras" cuando la clave viene omitida',
            snapM1.activeTab === 'compras',
            'Firestore tiene: ' + snapM1.activeTab);

        // M2 — Pestaña VÁLIDA: clave incluida → merge:true ACTUALIZA el valor
        const { payload: pM2, _tabNube: tM2 } = construirPayloadActiveTab('ventas', funcs);
        Object.assign(pM2, payloadBase());
        chk('M2.a   tabParaNube("ventas") devuelve "ventas"', tM2 === 'ventas');
        chk('M2.b   activeTab="ventas" presente en el payload', pM2.activeTab === 'ventas');

        await asAdmin().collection(COL).doc(DOC_ID).set(pM2, { merge: true });
        const snapM2 = (await asAdmin().collection(COL).doc(DOC_ID).get()).data();
        chk('M2.c   merge:true actualiza activeTab a "ventas"',
            snapM2.activeTab === 'ventas',
            'Firestore tiene: ' + snapM2.activeTab);

        // M3 — Pestaña inválida en Firestore (escrita por versión futura):
        //      tabSegura() normaliza a 'inicio' al leerlo
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await asRoot(ctx).collection(COL).doc(DOC_ID)
                .set(payloadBase({ activeTab: 'perfil' }));
        });
        const snapM3 = (await asAdmin().collection(COL).doc(DOC_ID).get()).data();
        chk('M3.a   Firestore contiene "perfil" (valor inválido de versión futura)',
            snapM3.activeTab === 'perfil', 'valor: ' + snapM3.activeTab);
        const tabLocalM3 = funcs.tabSegura(snapM3.activeTab);
        chk('M3.b   tabSegura() normaliza "perfil" → "inicio" al restaurar localmente',
            tabLocalM3 === 'inicio', 'normalizado: ' + tabLocalM3);

        // M4 — Ciclo completo: Firestore tiene 'admin'; dispositivo B
        //      sincroniza con 'perfil' (inválida) → Firestore conserva 'admin'
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await asRoot(ctx).collection(COL).doc(DOC_ID)
                .set(payloadBase({ activeTab: 'admin' }));
        });
        const { payload: pM4 } = construirPayloadActiveTab('perfil', funcs);
        Object.assign(pM4, payloadBase());
        await asAdmin().collection(COL).doc(DOC_ID).set(pM4, { merge: true });
        const snapM4 = (await asAdmin().collection(COL).doc(DOC_ID).get()).data();
        chk('M4     ciclo completo: Firestore conserva "admin" aunque dispositivo envíe "perfil"',
            snapM4.activeTab === 'admin',
            'Firestore tiene: ' + snapM4.activeTab);

        // M5 — Las 14 pestañas válidas viajan y persisten end-to-end
        for (const tab of VALIDAS) {
            const { payload: pT } = construirPayloadActiveTab(tab, funcs);
            Object.assign(pT, payloadBase());
            await asAdmin().collection(COL).doc(DOC_ID).set(pT, { merge: true });
            const snapT = (await asAdmin().collection(COL).doc(DOC_ID).get()).data();
            chk('M5    "' + tab + '" viaja y persiste en Firestore',
                snapT.activeTab === tab,
                'Firestore tiene: ' + snapT.activeTab);
        }

        // M6 — Las reglas permiten que un usuario autenticado (no admin) escriba
        //      activeTab (campo en _camposSyncNoAdmin de firestore.rules)
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await asRoot(ctx).collection(COL).doc(DOC_ID)
                .set(payloadBase({ activeTab: 'inicio' }));
        });
        const { payload: pM6 } = construirPayloadActiveTab('recetario', funcs);
        Object.assign(pM6, payloadBase({ _lastWrittenRole: 'bartender', _lastWrittenBy: 'uid-barra' }));
        let reglaOk = false;
        try {
            await asBartender().collection(COL).doc(DOC_ID).set(pM6, { merge: true });
            const snapM6 = (await asBartender().collection(COL).doc(DOC_ID).get()).data();
            reglaOk = snapM6.activeTab === 'recetario';
        } catch (e) {
            reglaOk = false;
        }
        chk('M6     reglas de Firestore permiten a bartender escribir activeTab="recetario"',
            reglaOk);

    } catch (err) {
        total++; fallos++;
        console.error('\n  ✗ Error inesperado (aborta los escenarios restantes de la suite M):');
        console.error('    ' + (err.message || String(err)));
        if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    } finally {
        if (testEnv) await testEnv.cleanup();
    }

    const aprobadas = total - fallos;
    console.log('\n' + (fallos === 0
        ? '✅  TODAS PASARON — ' + total + '/' + total
        : '❌  ' + fallos + ' FALLO(S) — ' + aprobadas + '/' + total) + ' verificaciones');
    process.exit(fallos > 0 ? 1 : 0);
})();
