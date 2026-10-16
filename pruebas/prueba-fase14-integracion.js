/**
 * prueba-fase14-integracion.js — FASE 14 de punta a punta contra Firestore
 * REAL (emulador + firestore.rules byte a byte)
 * ═══════════════════════════════════════════════════════════════════════════
 *   Z1  Fin de mes entre semana: corte mensual + ancla del Total en el MISMO
 *       batch, y la cabecera anota anclaDestino (la regla lo admite).
 *   Z2  Recuento de mitad de semana: solo el ancla (sin inicial ni corte).
 *   Z3  Ya hay un corte MÁS NUEVO: mitad de semana se rechaza sin escribir;
 *       fin de mes conserva su corte mensual pero no crea ancla.
 *   Z4  Contabilizar dos veces no duplica el ancla.
 *   Z5  Reglas: el bartender lee pero no crea; nadie actualiza ni borra; un
 *       tipo inválido o un id distinto de la fecha se rechazan.
 *   Z6  ★ El Total REAL: js/47 lee del emulador el ancla más nueva, las
 *       compras y los periodos de ventas posteriores, y calcula
 *       saldo + compras − consumo teórico. Lo del día del corte no cuenta.
 *
 *   npx firebase emulators:exec --only firestore --project demo-barinventory \
 *     "node pruebas/prueba-fase14-integracion.js"
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const compat = require('firebase/compat/app');
require('firebase/compat/firestore');
const fb = compat.default || compat;

const fs   = require('fs');
const path = require('path');

const RAIZ       = path.resolve(__dirname, '..');
const PROJECT_ID = 'demo-barinventory';
const DOC_ID     = 'barra-principal';

let fallos = 0, total = 0;
function chk(nombre, ok, detalle) {
    total++;
    if (ok) { console.log('  ✅ ' + nombre); }
    else    { fallos++; console.error('  ❌ ' + nombre + (detalle ? '  ← ' + detalle : '')); }
}

// Dos productos CON precio (para valorizar) y uno SIN precio (para probar
// que nunca se inventa un valor que el catálogo no tiene).
const CATALOGO = [
    { id: 'PRD-001', name: 'Don Julio 70', unit: 'PZA', precio: 500,
      capacidadMl: 700, pesoBotellaLlenaOz: 53.65, conteoOzHabilitado: true },
    { id: 'PRD-002', name: 'Titos', unit: 'PZA', precio: 350,
      capacidadMl: 750, pesoBotellaLlenaOz: 42.54, conteoOzHabilitado: true },
    { id: 'PRD-003', name: 'Azucar refinada', unit: 'KGS',
      capacidadMl: 0, pesoBotellaLlenaOz: 0, conteoOzHabilitado: false }
];

// Monta el archivo REAL js/75-auditoria-flujo.js con un Firestore de verdad.
// Mismo montaje que prueba-f3-integracion.js (new Function + with: un
// contexto de vm tiene sus propios intrínsecos y el SDK de Firestore
// rechaza los objetos que se construyan dentro).
function montarApp(db, uid, opciones) {
    opciones = opciones || {};
    const avisos = [];
    const confirmaciones = [];

    const ciclo  = fs.readFileSync(path.join(RAIZ, 'js/15-ciclo-semanal.js'), 'utf8');
    // FASE 14 — anclaDesdeCierre() (fin de mes entre semana y mitad de semana).
    const arrastre = fs.readFileSync(path.join(RAIZ, 'js/46-arrastre.js'), 'utf8');
    const flujo  = fs.readFileSync(path.join(RAIZ, 'js/75-auditoria-flujo.js'), 'utf8');
    const firest = fs.readFileSync(path.join(RAIZ, 'js/40-firestore.js'), 'utf8');

    const conv = ['convertirOzAPuntos', 'tieneDatosConversion', 'tieneConversion']
        .map(function(n) {
            const fuente = fs.readFileSync(path.join(RAIZ, 'js/70-conversion-render.js'), 'utf8');
            const i = fuente.indexOf('function ' + n + '(');
            if (i === -1) throw new Error('No se encontró ' + n + ' en 70-conversion-render.js');
            let nivel = 0, dentro = false;
            for (let j = i; j < fuente.length; j++) {
                if (fuente[j] === '{') { nivel++; dentro = true; }
                else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(i, j + 1); }
            }
            throw new Error('No se pudo delimitar ' + n);
        }).join('\n');

    const deps = {
        navigator: { onLine: opciones.onLine !== false },
        _db: db,
        FIRESTORE_DOC_ID: DOC_ID,
        currentUserUid: uid,
        currentUserRole: opciones.admin ? 'ADMIN' : 'BARTENDER',
        _deviceId: 'disp-' + uid,
        products: (opciones.products || CATALOGO).map(p => Object.assign({}, p)),
        AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
        areasAuditoria: { almacen: 'Almacén', barra1: 'Barra Restaurante', barra2: 'Barra Bar' },
        areasAuditoriaFA: {}, areasAuditoriaIcons: {},
        auditoriaStatus: {}, myAuditoriaStatus: {}, myAuditoriaConteo: {},
        auditoriaConteo: {}, inventarioConteo: {}, allUsersAuditoria: {},
        myAuditoriaUnlocks: {}, myAuditoriaFinalizadas: {},
        auditoriaView: 'selection', auditoriaAreaActiva: null, isAuditoriaMode: false,
        _inventarioActivo: null, _auditoriaSessionId: null, _historialInventarios: null,
        auditCurrentUser: { userId: uid, userName: uid },
        isAdmin: () => !!opciones.admin,
        hasPermission: (p) => opciones.admin || (opciones.permisos || []).indexOf(p) !== -1,
        puedeOperarArea: () => true,
        puedeVerConteosAjenos: () => !!opciones.admin,
        showNotification: (t) => avisos.push(String(t)),
        // Igual que en prueba-f3-integracion.js: se guarda la promesa del
        // callback de confirmación para poder esperarla explícitamente —
        // contabilizarInventario() no espera a que el usuario confirme.
        showConfirm: (msg, cb) => {
            confirmaciones.push(String(msg));
            deps._pendiente = Promise.resolve().then(cb);
            return deps._pendiente;
        },
        // Doble mínimo: solo se necesita el formato, no el locale real.
        _panelMoneda: (n) => '$' + Math.round(n),
        renderTab() {}, saveToLocalStorage() {}, updateCloudSyncBadge() {},
        _registrarEnSyncQueue(e) { deps._eventos.push(e); },
        _registrarConflictos() {}, escapeHtml: (s) => String(s),
        exportToExcelConDatos() {}, _usuariosContando: () => 0,
        firebase: fb, _auth: { currentUser: { uid: uid, email: uid + '@local' } },
        localStorage: {
            _d: {}, getItem(k) { return this._d[k] || null; },
            setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
        },
        console: { warn() {}, error() {}, info() {}, log() {} },
        document: {
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} },
                                    appendChild() {}, setAttribute() {}, remove() {} }),
            body: { appendChild() {}, removeChild() {} },
            addEventListener() {}
        },
        requestAnimationFrame: (f) => f(),
        setTimeout: (f) => { try { f(); } catch (_) {} return 0; },
        clearTimeout() {},
        _eventos: []
    };
    deps.window = deps;

    const montar = new Function('deps', 'with (deps) {\n' + ciclo + '\n' + arrastre + '\n' + conv + '\n' + firest + '\n' + flujo +
        '\n; return { contabilizarInventario: contabilizarInventario,' +
        '            _saldosDesdeSnapshot: _saldosDesdeSnapshot,' +
        '            cierreMensualDesdeSnapshot: cierreMensualDesdeSnapshot,' +
        '            convertirOzAPuntos: convertirOzAPuntos }; }');

    let api;
    try { api = montar(deps); }
    catch (e) { throw new Error('No se pudo montar el flujo: ' + e.message); }

    api._avisos = avisos;
    api._confirmaciones = confirmaciones;
    api._eventos = deps._eventos;
    api._deps = deps;
    api.contabilizar = async function(invId, numero) {
        deps._pendiente = null;
        await api.contabilizarInventario(invId, numero);
        if (deps._pendiente) await deps._pendiente;
    };
    return api;
}


// Extrae una función con nombre de un archivo fuente (llaves balanceadas).
function extraerFuncion(rel, nombre) {
    const fuente = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const i = fuente.indexOf('function ' + nombre + '(');
    if (i === -1) throw new Error('No se encontró ' + nombre + ' en ' + rel);
    let nivel = 0, dentro = false;
    for (let j = i; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(i, j + 1); }
    }
    throw new Error('No se pudo delimitar ' + nombre);
}

// Monta la capa de existencia REAL (15 + 46 + 48 + 47) con un Firestore real.
function montarExistencia(db, productos, recetasLista) {
    const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const deps = {
        _db: db, FIRESTORE_DOC_ID: DOC_ID, products: productos, recetas: recetasLista,
        movimientos: [], ventas: [], ventasSemanaId: null,
        getTotalStock: (p) => (p && p.operativa) || 0,
        console: { warn() {}, info() {}, log() {}, error() {} }
    };
    deps.window = deps;
    const cuerpo = leer('js/15-ciclo-semanal.js') + '\n' + leer('js/46-arrastre.js') + '\n' +
                   extraerFuncion('js/88-compras.js', '_asientosDesdeCompra') + '\n' +
                   extraerFuncion('js/93-ventas.js', '_ventasPeriodoDeDoc') + '\n' +
                   leer('js/48-consumo-teorico.js') + '\n' + leer('js/47-existencia.js');
    return new Function('deps', 'with (deps) {\n' + cuerpo + '\n; return { cargar: existenciaCargarInicial, ' +
        'estado: existenciaInicialEstado, oficial: existenciaOficial, resumen: existenciaArrastreResumen, ' +
        'fechaISOLocal: fechaISOLocal, semanaId: semanaId }; }')(deps);
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8'),
            host: 'localhost', port: 8080
        }
    });

    const R = 'inventarioApp/' + DOC_ID;

    // PRD-003 (sin precio) se deja SIN contar a propósito. Desde el
    // 4-oct-2026, "no contado" ya no entra al corte con un saldo de cero
    // inventado (antes se fundía, sin querer, con "cero porque no tiene
    // precio") — se excluye de saldos igual que ya se excluía del valorTotal.
    function conteoDemo() {
        return {
            'PRD-001': {
                almacen: { enteras: 5, abiertas: [] },
                barra1:  { enteras: 2, abiertas: [40.0] },
                barra2:  { enteras: 0, abiertas: [] }
            },
            'PRD-002': {
                almacen: { enteras: 3, abiertas: [] },
                barra1:  { enteras: 1, abiertas: [] },
                barra2:  { enteras: 0, abiertas: [30.0] }
            }
        };
    }

    async function sembrarCerrado(invId, opts) {
        opts = opts || {};
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const d = ctx.firestore();
            await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
            await d.doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
            await d.doc('roles/ADMIN').set({ roleId: 'ADMIN', permissions: ['*'] });
            await d.doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count'] });

            await d.doc(R + '/inventories/' + invId).set({
                inventoryId: invId, numero: opts.numero || 101, tipo: 'inventario_fisico',
                estado: 'CERRADO',
                fechaCreacion: Date.now() - 86400000,
                fechaCierre: Date.now(),
                cerradoPorUid: 'jefe', cerradoPorNombre: 'jefe@local',
                totalProductos: CATALOGO.length,
                warehousesSnapshot: ['almacen', 'barra1', 'barra2'],
                fechaRecuento: opts.fechaRecuento || '2026-09-13',
                semanaId: opts.semanaId !== undefined ? opts.semanaId : '2026-09-07',
                semanaIdOrigen: 'fechaRecuento'
            });

            const registros = [
                { tipo: 'meta', numero: opts.numero || 101, inventoryId: invId,
                  fecha: Date.now(), semanaId: '2026-09-07', semanaIdOrigen: 'fechaRecuento',
                  totalProductos: CATALOGO.length,
                  warehousesSnapshot: ['almacen', 'barra1', 'barra2'],
                  participantes: ['bart1'] }
            ];
            // Los productos se congelan CON su precio: es lo que valoriza el
            // corte mensual, y lo hace con el precio del día del cierre, no
            // el del catálogo de hoy.
            (opts.productosCongelados || CATALOGO).forEach(function(p) {
                registros.push(Object.assign({ tipo: 'producto', nombre: p.name }, p));
            });
            registros.push({ tipo: 'usuario', uid: 'bart1', email: 'bart1@local',
                             isAdmin: false, status: {}, conteo: opts.conteo || conteoDemo() });

            await d.doc(R + '/inventories/' + invId + '/snapshotChunks/chunk_0').set({
                items: registros, chunkIndex: 0, totalChunks: 1, _updatedAt: Date.now()
            });
        });
    }

    async function leerInicial(semana) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/inventariosIniciales/' + semana).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function leerCorteMensual(mesId) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/cortesMensuales/' + mesId).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function leerInventario(invId) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/inventories/' + invId).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function contarIniciales() {
        let n = 0;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().collection(R + '/inventariosIniciales').get();
            n = s.size;
        });
        return n;
    }
    async function contarCortes() {
        let n = 0;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().collection(R + '/cortesMensuales').get();
            n = s.size;
        });
        return n;
    }

    const dbAdmin = testEnv.authenticatedContext('jefe').firestore();
    const dbBart  = testEnv.authenticatedContext('bart1').firestore();

    console.log('\n  ── FASE 14 · ancla del Total contra Firestore real ──\n');

    async function leerAncla(fecha) {
        let out = null;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const s = await ctx.firestore().doc(R + '/anclasExistencia/' + fecha).get();
            out = s.exists ? s.data() : null;
        });
        return out;
    }
    async function contarAnclas() {
        let n = 0;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            n = (await ctx.firestore().collection(R + '/anclasExistencia').get()).size;
        });
        return n;
    }

    // ═══ Z1 — fin de mes entre semana (miércoles 2026-09-30) ═════════════
    await sembrarCerrado('inv-fdm', { numero: 501, fechaRecuento: '2026-09-30', semanaId: '2026-09-28' });
    const app1 = montarApp(dbAdmin, 'jefe', { admin: true });
    await app1.contabilizar('inv-fdm', 501);
    const a1 = await leerAncla('2026-09-30');
    const c1 = await leerCorteMensual('2026-09');
    const i1 = await leerInventario('inv-fdm');
    chk('Z1 · fin de mes entre semana: corte mensual Y ancla del Total', !!a1 && !!c1, JSON.stringify(app1._avisos));
    chk('Z1 · el ancla es tipo fin_de_mes, con los mismos saldos que el corte',
        a1 && a1.tipo === 'fin_de_mes' && JSON.stringify(a1.saldos) === JSON.stringify(c1.saldos), JSON.stringify(a1 && a1.saldos));
    chk('Z1 · ★ la cabecera queda CONTABILIZADA con mesDestino y anclaDestino (la regla lo admite)',
        i1.estado === 'CONTABILIZADO' && i1.mesDestino === '2026-09' && i1.anclaDestino === '2026-09-30', JSON.stringify(i1));
    chk('Z1 · un producto no contado no entra al ancla (nunca un cero inventado)', a1 && !('PRD-003' in a1.saldos));
    chk('Z1 · no se genera ningún inicial semanal', (await contarIniciales()) === 0);

    // ═══ Z4 — contabilizar otra vez no duplica ══════════════════════════
    const app1b = montarApp(dbAdmin, 'jefe', { admin: true });
    await app1b.contabilizar('inv-fdm', 501);
    chk('Z4 · contabilizar dos veces no duplica el ancla', (await contarAnclas()) === 1 && app1b._avisos.some(a => /ya estaba contabilizado/i.test(a)),
        app1b._avisos.join(' | '));

    // ═══ Z2 — recuento de mitad de semana ═══════════════════════════════
    await sembrarCerrado('inv-mid', { numero: 502, fechaRecuento: '2026-10-01', semanaId: '2026-09-28' });
    const app2 = montarApp(dbAdmin, 'jefe', { admin: true });
    await app2.contabilizar('inv-mid', 502);
    const a2 = await leerAncla('2026-10-01');
    chk('Z2 · mitad de semana: solo el ancla (tipo mitad_de_semana)', !!a2 && a2.tipo === 'mitad_de_semana' && a2.semanaId === '2026-09-28',
        JSON.stringify(app2._avisos));
    chk('Z2 · sin inicial ni corte mensual', (await contarIniciales()) === 0 && (await contarCortes()) === 0);
    chk('Z2 · la confirmación explicó que el Total partirá de este conteo',
        app2._confirmaciones.some(m => /Ancla del Total: 2026-10-01/.test(m) && /partirá de este conteo/.test(m)));

    // ═══ Z3 — ya hay un corte más nuevo ═════════════════════════════════
    await sembrarCerrado('inv-viejo', { numero: 503, fechaRecuento: '2026-09-23', semanaId: '2026-09-21' });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc(R + '/inventariosIniciales/2026-09-28').set({
            semanaId: '2026-09-28', origen: { inventoryId: 'otro', numero: 9 }, saldos: { 'PRD-001': 1 } });
    });
    const app3 = montarApp(dbAdmin, 'jefe', { admin: true });
    await app3.contabilizar('inv-viejo', 503);
    const i3 = await leerInventario('inv-viejo');
    chk('Z3 · ★ mitad de semana con un corte más nuevo: se rechaza y no escribe nada',
        i3.estado === 'CERRADO' && !(await leerAncla('2026-09-23')) && app3._avisos.some(a => /corte más nuevo/.test(a)),
        app3._avisos.join(' | '));
    await sembrarCerrado('inv-fdm2', { numero: 504, fechaRecuento: '2026-08-31', semanaId: '2026-08-31' });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc(R + '/anclasExistencia/2026-09-10').set({
            fecha: '2026-09-10', tipo: 'mitad_de_semana', origen: { inventoryId: 'otro2' }, saldos: {} });
    });
    const app3b = montarApp(dbAdmin, 'jefe', { admin: true });
    await app3b.contabilizar('inv-fdm2', 504);
    const i3b = await leerInventario('inv-fdm2');
    chk('Z3 · fin de mes con un corte más nuevo: conserva su corte mensual, sin ancla',
        i3b.estado === 'CONTABILIZADO' && i3b.mesDestino === '2026-08' && !i3b.anclaDestino && !(await leerAncla('2026-08-31')),
        JSON.stringify(i3b) + ' ' + app3b._avisos.join(' | '));

    // ═══ Z5 — reglas ═══════════════════════════════════════════════════
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
        await ctx.firestore().doc('usuarios/bart1').set({ uid: 'bart1', role: 'BARTENDER', status: 'activo' });
        await ctx.firestore().doc('roles/ADMIN').set({ roleId: 'ADMIN', permissions: ['*'] });
        await ctx.firestore().doc('roles/BARTENDER').set({ roleId: 'BARTENDER', permissions: ['inventory.count'] });
    });
    const intento = async (fn) => { try { await fn(); return true; } catch (e) { return false; } };
    const doc = (db, f) => db.collection('inventarioApp').doc(DOC_ID).collection('anclasExistencia').doc(f);
    const valido = (f) => ({ fecha: f, tipo: 'mitad_de_semana', origen: { inventoryId: 'x' }, saldos: { A: 1 } });
    chk('Z5 · el bartender NO puede crear un ancla', !(await intento(() => doc(dbBart, '2026-10-02').set(valido('2026-10-02')))));
    chk('Z5 · el bartender SÍ puede leerla (solo cantidades)', await intento(() => doc(dbBart, '2026-09-10').get()));
    chk('Z5 · el admin con inventory.post sí puede crearla', await intento(() => doc(dbAdmin, '2026-10-03').set(valido('2026-10-03'))));
    chk('Z5 · ★ nadie la actualiza', !(await intento(() => doc(dbAdmin, '2026-10-03').update({ saldos: { A: 99 } }))));
    chk('Z5 · ★ nadie la borra', !(await intento(() => doc(dbAdmin, '2026-10-03').delete())));
    chk('Z5 · un tipo que no es ancla se rechaza',
        !(await intento(() => doc(dbAdmin, '2026-10-04').set(Object.assign(valido('2026-10-04'), { tipo: 'semanal' })))));
    chk('Z5 · un id distinto de la fecha se rechaza',
        !(await intento(() => doc(dbAdmin, '2026-10-06').set(valido('2026-10-05')))));
    chk('Z5 · un id que no es fecha se rechaza', !(await intento(() => doc(dbAdmin, 'abc').set(valido('abc')))));

    // ═══ Z6 — el Total real, leído del emulador ══════════════════════════
    // Fechas relativas a HOY: la prueba no caduca (el tope de arrastre es de 56 días).
    await testEnv.clearFirestore();
    const E0 = montarExistencia(null, [], []);
    const hoyD = new Date();
    const dia = (n) => { const d = new Date(hoyD.getFullYear(), hoyD.getMonth(), hoyD.getDate() + n); return E0.fechaISOLocal(d); };
    const fCorte = dia(-9), fViejo = dia(-20), fPost1 = dia(-8), fPost2 = dia(-1);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await d.doc('usuarios/jefe').set({ uid: 'jefe', role: 'ADMIN', status: 'activo' });
        await d.doc('roles/ADMIN').set({ roleId: 'ADMIN', permissions: ['*'] });
        // Un inicial semanal más VIEJO que el ancla: no debe ganar.
        const semViejo = E0.semanaId(dia(-19));
        await d.doc(R + '/inventariosIniciales/' + semViejo).set({ semanaId: semViejo, origen: { inventoryId: 'v' }, saldos: { TEQ: 100 } });
        await d.doc(R + '/anclasExistencia/' + fCorte).set({ fecha: fCorte, tipo: 'mitad_de_semana', semanaId: E0.semanaId(fCorte),
                                                             origen: { inventoryId: 'n', numero: 1007 }, saldos: { TEQ: 3, LIM: 2 } });
        // Ventas: el día del corte (no cuenta) y dos días posteriores.
        const per = (ini, fin, lineas) => d.doc(R + '/ventas/' + ini + '_' + fin).set({
            semanaId: E0.semanaId(ini), fechaInicio: ini, fechaFin: fin, lineas: lineas, origen: 'excel' });
        await per(fCorte, fCorte, [{ sku: 'PV1', cantidad: 100 }]);
        await per(fPost1, fPost1, [{ sku: 'PV1', cantidad: 10 }]);
        await per(fPost2, fPost2, [{ sku: 'PV1', cantidad: 5 }]);
        // Compras: una del día del corte (no cuenta) y una posterior.
        const compra = (id, f, cant) => d.doc('compras/' + id).set({ compraId: id, fecha: f, semanaId: E0.semanaId(f), folio: id,
            lineas: [{ productoId: 'TEQ', cantidadInventario: cant, enCatalogo: true, costoUnitario: 300 }] });
        await compra('C-corte', fCorte, 50);
        await compra('C-post', fPost1, 2);
    });
    const prods = [{ id: 'TEQ', name: 'TEQUILA', unit: 'PZA', operativa: 0 }, { id: 'LIM', name: 'LIMON', unit: 'KGS', operativa: 0 },
                   { id: 'SIN', name: 'SIN CORTE', unit: 'PZA', operativa: 6 }];
    const recs = [{ pv: 'PV1', ingredientes: [{ productoId: 'TEQ', cantidad: 0.06, uom: 'PZA' }, { productoId: 'LIM', cantidad: 0.02, uom: 'KGS' }] }];
    const E = montarExistencia(dbAdmin, prods, recs);
    await new Promise((res) => { E.cargar(res); setTimeout(res, 8000); });
    const est = E.estado();
    chk('Z6 · ★ elige el ancla más nueva (mitad de semana) sobre un inicial semanal más viejo',
        est.estado === 'ok' && est.ancla && est.ancla.fecha === fCorte && est.ancla.tipo === 'mitad_de_semana', JSON.stringify(est.ancla) + ' ' + est.estado);
    const teq = E.oficial(prods[0]);
    // 3 + 2 (compra posterior) − (10 + 5) × 0.06 = 5 − 0.9 = 4.1
    chk('Z6 · ★ Total = saldo del corte + compras posteriores − consumo posterior (3 + 2 − 15×0.06 = 4.1)',
        teq.valor === 4.1 && teq.entradas === 2 && teq.ventas === 0.9 && teq.origen === 'oficial', JSON.stringify(teq));
    const lim = E.oficial(prods[1]);
    chk('Z6 · otro insumo de la misma receta (2 − 15×0.02 = 1.7)', lim.valor === 1.7, JSON.stringify(lim));
    chk('Z6 · un producto fuera del corte usa el respaldo operativo', E.oficial(prods[2]).valor === 6 && E.oficial(prods[2]).origen === 'operativo_no_reconciliado');
    const res = E.resumen();
    chk('Z6 · el resumen reporta los días de ventas que faltan desde el corte',
        res && res.diasEsperados === 8 && res.diasFaltantes.length === 6 && res.periodosIncluidos === 2, JSON.stringify(res));

    await testEnv.cleanup();
    console.log('\n  ' + total + ' comprobaciones de integración · ' + (total - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
