/**
 * Prueba REAL de firestore.rules contra el emulador oficial de Firestore.
 * NO es una simulación — usa @firebase/rules-unit-testing, que levanta el
 * motor de reglas real de Google y evalúa el archivo firestore.rules tal
 * cual, byte a byte.
 *
 * ── CÓMO EJECUTAR ──
 *   1. npm install --no-save firebase-tools @firebase/rules-unit-testing
 *   2. Coloca este archivo y firestore.rules en la misma carpeta.
 *   3. npx firebase emulators:exec --only firestore --project demo-barinventory \
 *        "node run-rules-tests.js"
 *
 * ETAPA 15 (INVENTARIO FÍSICO): reiniciarConDatosBase() ahora TAMBIÉN siembra
 * dos inventories/{id} — uno SINCRONIZADO ('inv-activo') y uno CERRADO
 * ('inv-cerrado') — porque la regla de userAuditoria, cuando el ADMIN escribe
 * el doc de OTRO usuario, ahora exige (get()) que el inventario referenciado
 * por sessionId no esté CERRADO (ver firestore.rules). Las pruebas 1-19
 * (usuarios/roles + versionado de stockAreas) se conservan TAL CUAL estaban —
 * solo se actualizó el sessionId de placeholder 'x' a 'inv-activo' donde el
 * admin escribe el doc de otro usuario, para que seguir pasando sea una
 * afirmación real y no un artefacto de un sessionId inexistente.
 */

const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const fs = require('fs');

const PROJECT_ID = 'demo-barinventory';
let testEnv;
let fallos = 0;
let totalPruebas = 0;

async function prueba(nombre, fn) {
    totalPruebas++;
    try {
        await fn();
        console.log('✅ ' + nombre);
    } catch (e) {
        fallos++;
        console.error('❌ ' + nombre + ' — ' + e.message);
    }
}

function docBase(version) {
    return { enteras: 5, abiertas: [], version, actualizadoPor: 'u1', ts: Date.now() };
}

// FIX P0.3.1 (conservado): limpia Firestore Y re-siembra usuarios/roles en el
// MISMO paso — ninguna prueba que dependa de isAdminUser() puede quedar
// corriendo sobre un Firestore sin los documentos de usuario que necesita.
// ETAPA 15: además siembra un inventario SINCRONIZADO y uno CERRADO, porque
// la rama admin de userAuditoria ahora depende de esa referencia también.
async function reiniciarConDatosBase() {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await db.doc('usuarios/admin1').set({ uid: 'admin1', role: 'ADMIN' });
        await db.doc('usuarios/bartender1').set({ uid: 'bartender1', role: 'BARTENDER' });
        await db.doc('usuarios/bartender2').set({ uid: 'bartender2', role: 'BARTENDER' });
        await db.doc('roles/BARTENDER').set({ roleId: 'BARTENDER', nombre: 'Bartender', permissions: ['inventory.count'], esSistema: true });
        await db.doc('inventarioApp/barra-principal/inventories/inv-activo').set({
            inventoryId: 'inv-activo', numero: 101, tipo: 'inventario_fisico', branchId: 'barra-principal',
            estado: 'SINCRONIZADO', fechaCreacion: Date.now(), creadoPorUid: 'admin1',
            creadoPorNombre: 'Admin Uno', creadoPorRol: 'ADMIN', fechaCierre: null,
            cerradoPorUid: null, cerradoPorNombre: null, totalProductos: 5, warehousesSnapshot: ['almacen', 'barra1', 'barra2']
        });
        await db.doc('inventarioApp/barra-principal/inventories/inv-cerrado').set({
            inventoryId: 'inv-cerrado', numero: 100, tipo: 'inventario_fisico', branchId: 'barra-principal',
            estado: 'CERRADO', fechaCreacion: Date.now() - 86400000, creadoPorUid: 'admin1',
            creadoPorNombre: 'Admin Uno', creadoPorRol: 'ADMIN', fechaCierre: Date.now(),
            cerradoPorUid: 'admin1', cerradoPorNombre: 'Admin Uno', totalProductos: 5, warehousesSnapshot: ['almacen', 'barra1', 'barra2']
        });
    });
}

async function main() {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync('firestore.rules', 'utf8'),
            host: 'localhost',
            port: 8080
        }
    });

    const admin1 = testEnv.authenticatedContext('admin1').firestore();
    const bt1 = testEnv.authenticatedContext('bartender1').firestore();
    const bt2 = testEnv.authenticatedContext('bartender2').firestore();
    const sinAuth = testEnv.unauthenticatedContext().firestore();

    const rutaProducto = (db) => db.doc('inventarioApp/barra-principal/stockAreas/almacen/productos/PRD-001');
    const rutaAuditoria = (db, uid) => db.doc('inventarioApp/barra-principal/userAuditoria/' + uid);
    const rutaInventario = (db, id) => db.doc('inventarioApp/barra-principal/inventories/' + id);

    // ══════════════════════════════════════════════════════════════════
    //  PARTE 1 — USUARIOS Y ROLES (userAuditoria + isAdminUser)
    // ══════════════════════════════════════════════════════════════════

    await prueba('1. Un usuario normal puede escribir su propio userAuditoria', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaAuditoria(bt1, 'bartender1').set({ sessionId: 'inv-activo', conteo: {} }));
    });

    await prueba('2. Un usuario normal NO puede escribir userAuditoria de otro usuario', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaAuditoria(bt1, 'bartender2').set({ sessionId: 'inv-activo', conteo: {} }));
    });

    await prueba('3. Un admin puede escribir userAuditoria de otro usuario (inventario SINCRONIZADO)', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaAuditoria(admin1, 'bartender2').set({ sessionId: 'inv-activo', conteo: {} }));
    });

    await prueba('4. Un admin puede leer userAuditoria de otro usuario', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaAuditoria(ctx.firestore(), 'bartender2').set({ sessionId: 'inv-activo', conteo: {} });
        });
        await assertSucceeds(rutaAuditoria(admin1, 'bartender2').get());
    });

    await prueba('5. Un usuario normal NO puede leer userAuditoria de otro usuario', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaAuditoria(ctx.firestore(), 'bartender2').set({ sessionId: 'inv-activo', conteo: {} });
        });
        await assertFails(rutaAuditoria(bt1, 'bartender2').get());
    });

    await prueba('6. admin1 puede leer su PROPIO documento usuarios/admin1 (diagnóstico A)', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(admin1.doc('usuarios/admin1').get());
    });

    await prueba('7. isAdminUser() probado de forma AISLADA: roles/{roleId} exige EXCLUSIVAMENTE ser admin', async () => {
        await reiniciarConDatosBase();
        await assertFails(bt1.doc('roles/BARTENDER').update({ permissions: ['inventory.count', 'inventory.export'] }));
        await assertSucceeds(admin1.doc('roles/BARTENDER').update({ permissions: ['inventory.count', 'inventory.export'] }));
    });

    await prueba('8. isAdminUser() con usuarios/{uid} INEXISTENTE no lanza error, deniega de forma segura', async () => {
        await testEnv.clearFirestore();
        await assertFails(
            testEnv.authenticatedContext('usuario-sin-doc-todavia').firestore()
                .doc('inventarioApp/barra-principal/userAuditoria/otro-uid')
                .set({ sessionId: 'x', conteo: {} })
        );
    });

    // ══════════════════════════════════════════════════════════════════
    //  PARTE 2 — VERSIONADO DE stockAreas (optimistic locking real)
    // ══════════════════════════════════════════════════════════════════

    await prueba('9. Primera escritura (create, version=1) es aceptada', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaProducto(bt1).set(docBase(1)));
    });

    await prueba('10/11. Dos dispositivos parten de version=3: solo el primero es aceptado, el segundo RECHAZADO', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => { await rutaProducto(ctx.firestore()).set(docBase(3)); });
        await assertSucceeds(rutaProducto(bt1).set(docBase(4)));
        await assertFails(rutaProducto(bt2).set(docBase(4)));
    });

    await prueba('12. version vieja (servidor=5, intenta escribir 4) es rechazada', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => { await rutaProducto(ctx.firestore()).set(docBase(5)); });
        await assertFails(rutaProducto(bt1).set(docBase(4)));
    });

    await prueba('13. misma version (servidor=3, reintenta 3) es rechazada', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => { await rutaProducto(ctx.firestore()).set(docBase(3)); });
        await assertFails(rutaProducto(bt1).set(docBase(3)));
    });

    await prueba('14. salto de version (servidor=3, intenta 7) es rechazado', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => { await rutaProducto(ctx.firestore()).set(docBase(3)); });
        await assertFails(rutaProducto(bt1).set(docBase(7)));
    });

    await prueba('15. usuario NO autenticado no puede escribir, aunque la version sea válida', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaProducto(sinAuth).set(docBase(1)));
    });

    await prueba('16. documento legacy SIN campo version puede actualizarse escribiendo version=1', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaProducto(ctx.firestore()).set({ enteras: 2, abiertas: [] });
        });
        await assertSucceeds(rutaProducto(bt1).set(docBase(1)));
    });

    await prueba('17. enteras negativo es rechazado', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaProducto(bt1).set(Object.assign(docBase(1), { enteras: -1 })));
    });

    await prueba('18. abiertas no es una lista → rechazado', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaProducto(bt1).set(Object.assign(docBase(1), { abiertas: 'no-es-lista' })));
    });

    await prueba('19. falta un campo requerido (ts) → rechazado', async () => {
        await reiniciarConDatosBase();
        const doc = docBase(1); delete doc.ts;
        await assertFails(rutaProducto(bt1).set(doc));
    });

    // ══════════════════════════════════════════════════════════════════
    //  PARTE 3 — ETAPA 15: INVENTARIO FÍSICO (creación, cierre inmutable,
    //  reapertura de almacén, snapshot)
    // ══════════════════════════════════════════════════════════════════

    await prueba('20. Solo admin puede crear un Inventario Físico', async () => {
        await reiniciarConDatosBase();
        const nuevo = { inventoryId: 'inv-nuevo', numero: 102, estado: 'SINCRONIZADO', fechaCreacion: Date.now(), creadoPorUid: 'x' };
        await assertFails(rutaInventario(bt1, 'inv-nuevo').set(nuevo));
        await assertSucceeds(rutaInventario(admin1, 'inv-nuevo').set(nuevo));
    });

    await prueba('21. Inventario SINCRONIZADO puede modificarse por admin (según permisos)', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaInventario(admin1, 'inv-activo').update({ totalProductos: 6 }));
    });

    await prueba('22. Inventario CERRADO NO puede modificarse — ni siquiera por admin (inmutabilidad real)', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaInventario(admin1, 'inv-cerrado').update({ totalProductos: 999 }));
    });

    await prueba('23. bartender NO puede cerrar el inventario global (cambiar estado a CERRADO)', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaInventario(bt1, 'inv-activo').update({ estado: 'CERRADO', fechaCierre: Date.now(), cerradoPorUid: 'bartender1' }));
    });

    await prueba('24. admin SÍ puede cerrar el inventario global', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaInventario(admin1, 'inv-activo').update({ estado: 'CERRADO', fechaCierre: Date.now(), cerradoPorUid: 'admin1', cerradoPorNombre: 'Admin Uno' }));
    });

    await prueba('25. bartender NO puede reabrir un almacén de otro usuario (no es admin)', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaAuditoria(ctx.firestore(), 'bartender2').set({ sessionId: 'inv-activo', conteo: {}, status: { almacen: 'completada' } });
        });
        await assertFails(rutaAuditoria(bt1, 'bartender2').update({ 'status.almacen': 'pendiente' }));
    });

    await prueba('26. admin SÍ puede reabrir un almacén mientras el inventario está SINCRONIZADO', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaAuditoria(ctx.firestore(), 'bartender2').set({ sessionId: 'inv-activo', conteo: {}, status: { almacen: 'completada' } });
        });
        await assertSucceeds(rutaAuditoria(admin1, 'bartender2').update({ 'status.almacen': 'pendiente' }));
    });

    await prueba('27. admin NO puede reabrir un almacén si el inventario referenciado está CERRADO (Rules, no solo UI)', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaAuditoria(ctx.firestore(), 'bartender2').set({ sessionId: 'inv-cerrado', conteo: {}, status: { almacen: 'completada' } });
        });
        await assertFails(rutaAuditoria(admin1, 'bartender2').update({ 'status.almacen': 'pendiente' }));
    });

    await prueba('28. Un usuario NO autenticado no puede modificar ningún documento de Inventario Físico', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaInventario(sinAuth, 'inv-activo').update({ totalProductos: 1 }));
    });

    await prueba('29. El snapshot de un inventario (snapshotChunks) no puede alterarse después de creado', async () => {
        await reiniciarConDatosBase();
        const chunkRef = rutaInventario(admin1, 'inv-cerrado').collection('snapshotChunks').doc('chunk_0');
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('inventarioApp/barra-principal/inventories/inv-cerrado/snapshotChunks/chunk_0').set({ items: [{ tipo: 'meta', numero: 100 }] });
        });
        await assertFails(chunkRef.update({ items: [{ tipo: 'meta', numero: 999 }] }));
        await assertFails(chunkRef.delete());
    });

    await prueba('30. bartender NO puede crear snapshotChunks (solo admin, y solo durante el cierre)', async () => {
        await reiniciarConDatosBase();
        await assertFails(
            rutaInventario(bt1, 'inv-activo').collection('snapshotChunks').doc('chunk_0').set({ items: [] })
        );
    });

    await prueba('31. Solo admin puede escribir el contador de numeración (contadores/inventarios)', async () => {
        await reiniciarConDatosBase();
        await assertFails(bt1.doc('inventarioApp/barra-principal/contadores/inventarios').set({ ultimoNumero: 999 }));
        await assertSucceeds(admin1.doc('inventarioApp/barra-principal/contadores/inventarios').set({ ultimoNumero: 101 }));
    });

    await prueba('32. Nadie puede eliminar (delete) un documento de Inventario Físico — ni admin', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaInventario(admin1, 'inv-activo').delete());
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  FASE 0 — SEGURIDAD CRÍTICA
    //  Cada prueba de este bloque reproduce una vulnerabilidad concreta
    //  hallada en la auditoría. Antes de la corrección, TODAS fallan.
    // ═══════════════════════════════════════════════════════════════════════

    await prueba('S1a. bartender NO puede reescribir el catálogo (products) del doc raíz', async () => {
        await reiniciarConDatosBase();
        await assertFails(bt1.doc('inventarioApp/barra-principal')
            .set({ products: [{ id: 'HACK-001', name: 'Producto inyectado' }] }, { merge: true }));
    });

    await prueba('S1b. bartender NO puede VACIAR el catálogo del bar', async () => {
        await reiniciarConDatosBase();
        await assertFails(bt1.doc('inventarioApp/barra-principal').set({ products: [] }, { merge: true }));
    });

    await prueba('S1c. bartender NO puede alterar auditoriaStatus (reabrir/cerrar áreas)', async () => {
        await reiniciarConDatosBase();
        await assertFails(bt1.doc('inventarioApp/barra-principal')
            .set({ auditoriaStatus: { almacen: 'completada', barra1: 'completada', barra2: 'completada' } }, { merge: true }));
    });

    await prueba('S1d. bartender NO puede forzar un cambio de sesión de auditoría', async () => {
        await reiniciarConDatosBase();
        await assertFails(bt1.doc('inventarioApp/barra-principal')
            .set({ _auditoriaSessionId: 'sesion-falsa' }, { merge: true }));
    });

    await prueba('S1e. el sync normal del bartender SIGUE funcionando (no romper la operación)', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(bt1.doc('inventarioApp/barra-principal').set({
            cart: [], activeTab: 'inventario', selectedArea: 'barra1',
            _lastModified: Date.now(), _syncedAt: Date.now(),
            _ordersInChunks: true, _inventoriesInChunks: true, _conteoInSubcol: true,
            _lastWrittenBy: 'bartender1', _lastWrittenRole: 'user'
        }, { merge: true }));
    });

    // Los tres casos de abajo cubren el camino que ocurre EN PRODUCCION: el
    // documento raiz YA existe, asi que el set(merge:true) del bartender es un
    // UPDATE, no un create. S1e cubre el create (entorno nuevo); estos cubren
    // el update (operacion normal del bar).
    async function sembrarDocRaiz() {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('inventarioApp/barra-principal').set({
                products: [{ id: 'PRD-001', name: 'Tequila Reposado' }],
                auditoriaStatus: { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' },
                _auditoriaSessionId: 'sesion-real',
                cart: [], _lastModified: 1
            });
        });
    }

    await prueba('S1g. con el doc raiz YA existente, el sync del bartender funciona (UPDATE)', async () => {
        await reiniciarConDatosBase();
        await sembrarDocRaiz();
        await assertSucceeds(bt1.doc('inventarioApp/barra-principal').set({
            cart: [], activeTab: 'inventario', selectedArea: 'barra1',
            _lastModified: Date.now(), _syncedAt: Date.now(),
            _ordersInChunks: true, _inventoriesInChunks: true, _conteoInSubcol: true,
            _lastWrittenBy: 'bartender1', _lastWrittenRole: 'user'
        }, { merge: true }));
    });

    await prueba('S1h. con el doc raiz existente, el bartender NO puede tocar products', async () => {
        await reiniciarConDatosBase();
        await sembrarDocRaiz();
        await assertFails(bt1.doc('inventarioApp/barra-principal')
            .set({ _lastModified: Date.now(), products: [] }, { merge: true }));
    });

    await prueba('S1i. el catalogo sembrado sigue intacto tras el sync del bartender', async () => {
        await reiniciarConDatosBase();
        await sembrarDocRaiz();
        await assertSucceeds(bt1.doc('inventarioApp/barra-principal')
            .set({ _lastModified: Date.now() }, { merge: true }));
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const snap = await ctx.firestore().doc('inventarioApp/barra-principal').get();
            const prods = snap.data().products || [];
            if (prods.length !== 1 || prods[0].id !== 'PRD-001') {
                throw new Error('el catalogo se perdio o cambio: ' + JSON.stringify(prods));
            }
        });
    });

    await prueba('S1f. el admin SÍ puede escribir products y auditoriaStatus', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(admin1.doc('inventarioApp/barra-principal')
            .set({ products: [{ id: 'PRD-001', name: 'Tequila' }],
                   auditoriaStatus: { almacen: 'pendiente' } }, { merge: true }));
    });

    await prueba('S2a. usuario nuevo NO puede autoconcederse permissionOverrides al crear su perfil', async () => {
        await reiniciarConDatosBase();
        const nuevo = testEnv.authenticatedContext('usuario-nuevo').firestore();
        await assertFails(nuevo.doc('usuarios/usuario-nuevo').set({
            uid: 'usuario-nuevo', role: 'BARTENDER',
            permissionOverrides: { 'inventory.closeGlobal': 'allow', 'catalog.edit': 'allow' }
        }));
    });

    await prueba('S2b. usuario nuevo NO puede crearse ya desactivado-inmune (status arbitrario)', async () => {
        await reiniciarConDatosBase();
        const nuevo = testEnv.authenticatedContext('usuario-nuevo2').firestore();
        await assertFails(nuevo.doc('usuarios/usuario-nuevo2').set({
            uid: 'usuario-nuevo2', role: 'BARTENDER', status: 'superadmin'
        }));
    });

    await prueba('S2c. el alta normal de un usuario SIGUE funcionando', async () => {
        await reiniciarConDatosBase();
        const nuevo = testEnv.authenticatedContext('usuario-nuevo3').firestore();
        await assertSucceeds(nuevo.doc('usuarios/usuario-nuevo3').set({
            uid: 'usuario-nuevo3', email: 'nuevo@bar.mx', role: 'user'
        }));
    });

    await prueba('S3a. bartender NO puede MODIFICAR un evento del historial permanente', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('historialCambios/ev1')
                .set({ uid: 'admin1', tipo: 'inventario', detalle: 'conteo original' });
        });
        await assertFails(bt1.doc('historialCambios/ev1').update({ detalle: 'borrado' }));
    });

    await prueba('S3b. bartender NO puede BORRAR un evento del historial permanente', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('historialCambios/ev2').set({ uid: 'admin1', tipo: 'inventario' });
        });
        await assertFails(bt1.doc('historialCambios/ev2').delete());
    });

    await prueba('S3c. NI EL ADMIN puede modificar o borrar el historial permanente', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('historialCambios/ev3').set({ uid: 'admin1', tipo: 'inventario' });
        });
        await assertFails(admin1.doc('historialCambios/ev3').update({ tipo: 'nada' }));
        await assertFails(admin1.doc('historialCambios/ev3').delete());
    });

    await prueba('S3d. bartender NO puede escribir un evento a nombre de otro usuario', async () => {
        await reiniciarConDatosBase();
        await assertFails(bt1.doc('historialCambios/ev4')
            .set({ uid: 'admin1', tipo: 'inventario', detalle: 'evento falsificado' }));
    });

    await prueba('S3e. el bartender SÍ puede registrar sus propios eventos', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(bt1.doc('historialCambios/ev5')
            .set({ uid: 'bartender1', tipo: 'inventario', detalle: 'conteo guardado' }));
    });

    await prueba('S7a. bartender NO puede marcar leída la notificación de OTRO usuario', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('notificaciones/n1')
                .set({ destinatarioUid: 'bartender2', broadcast: false, leido: false, texto: 'privada' });
        });
        await assertFails(bt1.doc('notificaciones/n1').update({ leido: true }));
    });

    await prueba('S7b. bartender NO puede alterar el TEXTO de una notificación propia', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('notificaciones/n2')
                .set({ destinatarioUid: 'bartender1', broadcast: false, leido: false, texto: 'original' });
        });
        await assertFails(bt1.doc('notificaciones/n2').update({ texto: 'alterado' }));
    });

    await prueba('S7c. el bartender SÍ puede marcar leída SU propia notificación', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('notificaciones/n3')
                .set({ destinatarioUid: 'bartender1', broadcast: false, leido: false, texto: 'para mi' });
        });
        await assertSucceeds(bt1.doc('notificaciones/n3').update({ leido: true }));
    });

    await prueba('S7d. las notificaciones broadcast SIGUEN pudiendo marcarse leídas', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('notificaciones/n4')
                .set({ destinatarioUid: null, broadcast: true, leido: false, texto: 'para todos' });
        });
        await assertSucceeds(bt1.doc('notificaciones/n4').update({ leido: true }));
    });

    // ══════════════════════════════════════════════════════════════════
    //  PARTE D — LAS COLECCIONES QUE ESTABAN ABIERTAS
    //  ────────────────────────────────────────────────────────────────
    //  Antes de la etapa D, cinco rutas decían
    //  `allow read, write: if request.auth != null`. En la práctica eso
    //  significaba que cualquier bartender podía vaciar el conteo de
    //  todos sus compañeros en una sola escritura, y borrar después la
    //  bitácora donde habría quedado constancia.
    //
    //  Cada prueba de abajo FALLA contra las reglas anteriores. Es la
    //  única forma de saber que la regla nueva hace algo de verdad.
    // ══════════════════════════════════════════════════════════════════

    const rutaMulti = (db, area) =>
        db.doc('inventarioApp/barra-principal/conteoMultiUsuario/' + area);
    const rutaDisp = (db, area, dev) =>
        db.doc('inventarioApp/barra-principal/conteoAreas/' + area + '/dispositivos/' + dev);

    await prueba('D1. Un bartender puede crear SU propio bloque de conteo', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaMulti(bt1, 'barra1').set({
            bartender1: { userId: 'usr-x', userName: 'Ana', uid: 'bartender1', ts: Date.now(), productos: {} }
        }));
    });

    await prueba('D2. Un bartender NO puede crear el bloque de OTRO', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaMulti(bt1, 'barra1').set({
            bartender2: { userId: 'usr-y', userName: 'Luis', uid: 'bartender2', ts: Date.now(), productos: {} }
        }));
    });

    await prueba('D3. Un bartender NO puede sobrescribir el documento y borrar a los demás', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaMulti(ctx.firestore(), 'barra1').set({
                bartender1: { userId: 'a', uid: 'bartender1', ts: 1, productos: { P1: { enteras: 4 } } },
                bartender2: { userId: 'b', uid: 'bartender2', ts: 1, productos: { P1: { enteras: 9 } } }
            });
        });
        // Este es exactamente el ataque: escribir solo lo mío, sin merge,
        // dejando fuera el bloque del compañero. Antes pasaba sin problema.
        await assertFails(rutaMulti(bt1, 'barra1').set({
            bartender1: { userId: 'a', uid: 'bartender1', ts: 2, productos: {} }
        }));
    });

    await prueba('D4. Un bartender SÍ puede actualizar su bloque sin tocar el del otro', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaMulti(ctx.firestore(), 'barra1').set({
                bartender1: { userId: 'a', uid: 'bartender1', ts: 1, productos: {} },
                bartender2: { userId: 'b', uid: 'bartender2', ts: 1, productos: {} }
            });
        });
        await assertSucceeds(rutaMulti(bt1, 'barra1').set({
            bartender1: { userId: 'a', uid: 'bartender1', ts: 2, productos: { P1: { enteras: 3 } } }
        }, { merge: true }));
    });

    await prueba('D5. Un bartender NO puede modificar el bloque de otro ni con merge', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaMulti(ctx.firestore(), 'barra1').set({
                bartender2: { userId: 'b', uid: 'bartender2', ts: 1, productos: { P1: { enteras: 9 } } }
            });
        });
        await assertFails(rutaMulti(bt1, 'barra1').set({
            bartender2: { userId: 'b', uid: 'bartender2', ts: 2, productos: {} }
        }, { merge: true }));
    });

    await prueba('D6. Un bartender NO puede borrar el conteo del área', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaMulti(ctx.firestore(), 'barra1').set({ bartender1: { uid: 'bartender1', productos: {} } });
        });
        await assertFails(rutaMulti(bt1, 'barra1').delete());
    });

    await prueba('D7. El admin SÍ puede borrarlo (resetear el ciclo)', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaMulti(ctx.firestore(), 'barra1').set({ bartender1: { uid: 'bartender1', productos: {} } });
        });
        await assertSucceeds(rutaMulti(admin1, 'barra1').delete());
    });

    await prueba('D8. Un dispositivo solo escribe con SU propio uid', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaDisp(bt1, 'barra1', 'dev-a').set({
            _deviceId: 'dev-a', _lastWrite: Date.now(), _area: 'barra1', _userUid: 'bartender1'
        }));
    });

    await prueba('D9. Un dispositivo NO puede escribir firmando como otro usuario', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaDisp(bt1, 'barra1', 'dev-b').set({
            _deviceId: 'dev-b', _lastWrite: Date.now(), _area: 'barra1', _userUid: 'bartender2'
        }));
    });

    await prueba('D10. Un bartender NO puede borrar el documento de otro dispositivo', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaDisp(ctx.firestore(), 'barra1', 'dev-c').set({ _userUid: 'bartender2' });
        });
        await assertFails(rutaDisp(bt1, 'barra1', 'dev-c').delete());
    });

    await prueba('D11. El admin SÍ puede borrar documentos de dispositivo (reset)', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaDisp(ctx.firestore(), 'barra1', 'dev-d').set({ _userUid: 'bartender2' });
        });
        await assertSucceeds(rutaDisp(admin1, 'barra1', 'dev-d').delete());
    });

    await prueba('D12. Un bartender NO puede borrar el documento padre del área', async () => {
        await reiniciarConDatosBase();
        await assertFails(bt1.doc('inventarioApp/barra-principal/conteoAreas/barra1').delete());
    });

    await prueba('D13. Un bartender NO puede borrar un conflicto registrado', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('inventarioApp/barra-principal/conflictos/c1')
                .set({ tipo: 'version_mismatch', uid: 'bartender1' });
        });
        await assertFails(bt1.doc('inventarioApp/barra-principal/conflictos/c1').delete());
    });

    await prueba('D14. Un bartender SÍ puede registrar un conflicto', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(bt1.doc('inventarioApp/barra-principal/conflictos/c2')
            .set({ tipo: 'version_mismatch', uid: 'bartender1', ts: Date.now() }));
    });

    await prueba('D15. Un bartender NO puede borrar un evento de la cola de cambios', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('inventarioApp/barra-principal/cambios/e1')
                .set({ tipo: 'inventario', uid: 'bartender1' });
        });
        await assertFails(bt1.doc('inventarioApp/barra-principal/cambios/e1').delete());
    });

    await prueba('D16. Un bartender NO puede reescribir el evento de otro', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('inventarioApp/barra-principal/cambios/e2')
                .set({ tipo: 'inventario', uid: 'bartender2', valorDespues: 9 });
        });
        await assertFails(bt1.doc('inventarioApp/barra-principal/cambios/e2').update({ valorDespues: 0 }));
    });

    await prueba('D17. Reintentar el envío del evento propio sigue funcionando', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('inventarioApp/barra-principal/cambios/e3')
                .set({ tipo: 'inventario', uid: 'bartender1', estado: 'pendiente' });
        });
        await assertSucceeds(bt1.doc('inventarioApp/barra-principal/cambios/e3')
            .set({ tipo: 'inventario', uid: 'bartender1', estado: 'sincronizado' }));
    });

    await prueba('D18. Un evento sin uid todavía se puede completar', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('inventarioApp/barra-principal/cambios/e4')
                .set({ tipo: 'inventario', estado: 'pendiente' });
        });
        await assertSucceeds(bt1.doc('inventarioApp/barra-principal/cambios/e4')
            .update({ uid: 'bartender1', estado: 'sincronizado' }));
    });

    // FASE 2B — esta prueba afirmaba que un bartender podía leer
    // conteoMultiUsuario/{area} al arrancar. Esa lectura ERA la fuga de
    // privacidad: ese documento contiene el bloque de cada persona, con su
    // nombre y sus cantidades. La garantía que sustituye a la anterior es que
    // cerrar esa ruta NO rompe el arranque, porque el conteo propio vive en
    // userAuditoria/{uid}, que sigue siendo legible por su dueño.
    await prueba('D19. El conteo PROPIO se sigue pudiendo leer al arrancar', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaAuditoria(bt1, 'bartender1').get());
    });

    await prueba('D20. El admin puede reabrir el área en el documento de un bartender', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaAuditoria(ctx.firestore(), 'bartender1')
                .set({ sessionId: 'inv-activo', status: { barra1: 'completada' }, conteo: {} });
        });
        await assertSucceeds(rutaAuditoria(admin1, 'bartender1')
            .update({ 'status.barra1': 'pendiente', updatedAt: Date.now() }));
    });

    await prueba('D21. Reabrir sigue prohibido si el inventario está CERRADO', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaAuditoria(ctx.firestore(), 'bartender1')
                .set({ sessionId: 'inv-cerrado', status: { barra1: 'completada' }, conteo: {} });
        });
        await assertFails(rutaAuditoria(admin1, 'bartender1')
            .update({ 'status.barra1': 'pendiente', updatedAt: Date.now() }));
    });

    await prueba('D22. El rastro de finalización cabe en el documento del usuario', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaAuditoria(bt1, 'bartender1').set({
            uid: 'bartender1', sessionId: 'inv-activo', conteo: {},
            status: { barra1: 'completada' },
            finalizadas: { barra1: { uid: 'bartender1', nombre: 'ana@bar.mx', ts: Date.now(), rol: 'user' } }
        }));
    });

    await prueba('D23. Un bartender NO puede escribir el rastro en el documento de otro', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaAuditoria(bt1, 'bartender2').set({
            uid: 'bartender2', sessionId: 'inv-activo', conteo: {},
            finalizadas: { barra1: { uid: 'bartender1', ts: Date.now() } }
        }));
    });


    // ══════════════════════════════════════════════════════════════════
    //  FASE 2 — PERMISOS, PRIVACIDAD Y SEGURIDAD DE SERVIDOR
    //  ────────────────────────────────────────────────────────────────
    //  Todas estas pruebas atacan Firestore DIRECTAMENTE, sin pasar por la
    //  interfaz. Es el requisito explícito del propietario: "probar acceso
    //  autorizado y no autorizado directamente contra las operaciones y
    //  reglas, no únicamente mediante la interfaz".
    // ══════════════════════════════════════════════════════════════════

    // Siembra ampliada: un subjefe, un admin adicional y los roles de sistema
    // con los permisos por defecto de esta versión.
    async function sembrarFase2(extra) {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            await db.doc('roles/ADMIN').set({ roleId: 'ADMIN', nombre: 'Administrador', permissions: ['*'], esSistema: true });
            await db.doc('roles/SUBJEFE_BARRA').set({
                roleId: 'SUBJEFE_BARRA', nombre: 'Subjefe de Barra', esSistema: true,
                permissions: ['inventory.count','inventory.viewOwn','inventory.closeOwn',
                              'inventory.history','catalog.read','warehouses.read',
                              'inventory.closeOther','inventory.export']
            });
            await db.doc('roles/BARTENDER').set({
                roleId: 'BARTENDER', nombre: 'Bartender', esSistema: true,
                permissions: ['inventory.count','inventory.viewOwn','inventory.closeOwn',
                              'inventory.history','catalog.read','warehouses.read']
            });
            await db.doc('usuarios/subjefe1').set({ uid: 'subjefe1', role: 'SUBJEFE_BARRA' });
            await db.doc('usuarios/admin2').set({ uid: 'admin2', role: 'ADMIN' });
            // Conteo ajeno ya presente, para poder intentar leerlo.
            await db.doc('inventarioApp/barra-principal/conteoMultiUsuario/barra1').set({
                bartender2: { userId: 'bartender2', userName: 'luis@bar.mx', uid: 'bartender2',
                              ts: Date.now(), productos: { 'PRD-001': { enteras: 3, abiertas: [], ts: Date.now() } } }
            });
            await db.doc('inventarioApp/barra-principal/conteoAreas/barra1/dispositivos/dev-de-bartender2').set({
                _deviceId: 'dev-de-bartender2', _userUid: 'bartender2', _area: 'barra1',
                _lastWrite: Date.now(), 'PRD-001': { enteras: 3, abiertas: [], _lastWrite: Date.now() }
            });
            await db.doc('inventarioApp/barra-principal/conteoAreas/barra1/dispositivos/tablet-de-bartender1').set({
                _deviceId: 'tablet-de-bartender1', _userUid: 'bartender1', _area: 'barra1',
                _lastWrite: Date.now(), 'PRD-001': { enteras: 1, abiertas: [], _lastWrite: Date.now() }
            });
            if (extra) await extra(db);
        });
    }

    const subjefe1 = testEnv.authenticatedContext('subjefe1').firestore();
    const admin2   = testEnv.authenticatedContext('admin2').firestore();
    const rutaCatalogo = (db) => db.doc('catalogo/productos');

    // ── P1 ───────────────────────────────────────────────────────────
    await prueba('P1. Un bartender puede contar en su propio inventario', async () => {
        await sembrarFase2();
        await assertSucceeds(rutaAuditoria(bt1, 'bartender1').set({
            uid: 'bartender1', sessionId: 'inv-activo',
            conteo: { 'PRD-001': { barra1: { enteras: 2, abiertas: [], _ts: Date.now() } } }
        }));
    });

    // ── P2 ───────────────────────────────────────────────────────────
    await prueba('P2. Un bartender NO puede leer el conteo individual de otro', async () => {
        await sembrarFase2();
        await assertFails(rutaAuditoria(bt1, 'bartender2').get());
        await assertFails(rutaMulti(bt1, 'barra1').get());
        await assertFails(rutaDisp(bt1, 'barra1', 'dev-de-bartender2').get());
    });

    // ── P3 ───────────────────────────────────────────────────────────
    await prueba('P3. Un subjefe NO puede leer el conteo individual de otro', async () => {
        await sembrarFase2();
        await assertFails(rutaAuditoria(subjefe1, 'bartender2').get());
        await assertFails(rutaMulti(subjefe1, 'barra1').get());
        await assertFails(rutaDisp(subjefe1, 'barra1', 'dev-de-bartender2').get());
    });

    // ── P4 ───────────────────────────────────────────────────────────
    await prueba('P4. El admin SÍ puede consultar la consolidación', async () => {
        await sembrarFase2();
        await assertSucceeds(rutaAuditoria(admin1, 'bartender2').get());
        await assertSucceeds(rutaMulti(admin1, 'barra1').get());
        await assertSucceeds(rutaDisp(admin1, 'barra1', 'dev-de-bartender2').get());
    });

    // ── P5 ───────────────────────────────────────────────────────────
    await prueba('P5. Sin permiso no se puede ejecutar la operación DIRECTAMENTE', async () => {
        await sembrarFase2();
        // catalogo/productos exige catalog.publish, que ni bartender ni
        // subjefe tienen. No hay interfaz de por medio: es la escritura cruda.
        await assertFails(rutaCatalogo(bt1).set({ productos: [], version: Date.now() }));
        await assertFails(rutaCatalogo(subjefe1).set({ productos: [], version: Date.now() }));
        await assertSucceeds(rutaCatalogo(admin1).set({ productos: [], version: Date.now() }));
    });

    // ── P6 ───────────────────────────────────────────────────────────
    await prueba('P6. Marcar la casilla concede la capacidad real (override allow)', async () => {
        await sembrarFase2(async (db) => {
            await db.doc('usuarios/bartender1').set({
                uid: 'bartender1', role: 'BARTENDER',
                permissionOverrides: { 'catalog.publish': 'allow' }
            });
        });
        await assertSucceeds(rutaCatalogo(bt1).set({ productos: [], version: Date.now() }));
    });

    // ── P7 ───────────────────────────────────────────────────────────
    await prueba('P7. Revocar la casilla elimina la capacidad real (override deny)', async () => {
        await sembrarFase2(async (db) => {
            // inventory.closeOther lo hereda el subjefe de su rol; el override
            // 'deny' individual tiene que ganarle.
            await db.doc('usuarios/subjefe1').set({
                uid: 'subjefe1', role: 'SUBJEFE_BARRA',
                permissionOverrides: { 'inventory.viewAll': 'deny' }
            });
            await db.doc('roles/SUBJEFE_BARRA').set({
                roleId: 'SUBJEFE_BARRA', nombre: 'Subjefe de Barra', esSistema: true,
                permissions: ['inventory.count','inventory.viewAll']
            });
        });
        // El rol se lo daba, el override se lo quita.
        await assertFails(rutaMulti(subjefe1, 'barra1').get());
    });

    // ── P8 ───────────────────────────────────────────────────────────
    await prueba('P8. Manipular el cliente no escala privilegios', async () => {
        await sembrarFase2();
        // a) no puede darse overrides a sí mismo
        await assertFails(bt1.doc('usuarios/bartender1')
            .update({ permissionOverrides: { 'catalog.publish': 'allow' } }));
        // b) no puede cambiarse el rol
        await assertFails(bt1.doc('usuarios/bartender1').update({ role: 'ADMIN' }));
        // c) no puede reactivarse ni desactivar a otro
        await assertFails(bt1.doc('usuarios/bartender1').update({ status: 'activo' }));
        // d) FASE 2 — tampoco puede ampliarse las áreas asignadas
        await assertFails(bt1.doc('usuarios/bartender1')
            .update({ areasAsignadas: ['almacen', 'barra1', 'barra2'] }));
        // e) no puede reescribir el rol del sistema para regalarse el comodín
        await assertFails(bt1.doc('roles/BARTENDER').update({ permissions: ['*'] }));
    });

    // ── P18 ──────────────────────────────────────────────────────────
    await prueba('P18. Dos usuarios cuentan a la vez sin mezclar sus datos', async () => {
        await sembrarFase2();
        await assertSucceeds(rutaAuditoria(bt1, 'bartender1').set({
            uid: 'bartender1', sessionId: 'inv-activo',
            conteo: { 'PRD-001': { barra1: { enteras: 2, abiertas: [], _ts: Date.now() } } }
        }));
        await assertSucceeds(rutaAuditoria(bt2, 'bartender2').set({
            uid: 'bartender2', sessionId: 'inv-activo',
            conteo: { 'PRD-001': { barra1: { enteras: 9, abiertas: [], _ts: Date.now() } } }
        }));
        // Ninguno puede pisar el documento del otro…
        await assertFails(rutaAuditoria(bt1, 'bartender2').update({ conteo: {} }));
        // …ni leerlo.
        await assertFails(rutaAuditoria(bt2, 'bartender1').get());
    });

    // ── P19 ──────────────────────────────────────────────────────────
    await prueba('P19. Mismo UID en dos dispositivos conserva su conteo propio', async () => {
        await sembrarFase2();
        // El teléfono y la tablet del MISMO bartender son dos deviceId con un
        // solo uid. La regla cierra por USUARIO, no por dispositivo: si
        // cerrara por dispositivo, la tablet no podría leer lo que escribió el
        // teléfono y el mismo empleado perdería su propio conteo al cambiar de
        // aparato.
        await assertSucceeds(rutaDisp(bt1, 'barra1', 'tablet-de-bartender1').get());
        await assertFails(rutaDisp(bt1, 'barra1', 'dev-de-bartender2').get());
        // Y su documento de conteo propio es compartido por ambos aparatos.
        await assertSucceeds(rutaAuditoria(bt1, 'bartender1').get());
    });

    // ── P22 ──────────────────────────────────────────────────────────
    await prueba('P22. Un usuario INACTIVO no puede escribir (servidor)', async () => {
        await sembrarFase2(async (db) => {
            await db.doc('usuarios/bartender1').set({
                uid: 'bartender1', role: 'BARTENDER', status: 'inactivo'
            });
        });
        // Hasta FASE 2, 'status' solo se respetaba en el cliente: un empleado
        // dado de baja conservaba acceso de escritura mientras su token
        // siguiera vivo.
        await assertFails(rutaAuditoria(bt1, 'bartender1').set({
            uid: 'bartender1', sessionId: 'inv-activo', conteo: {}
        }));
        await assertFails(rutaDisp(bt1, 'barra1', 'dev-nuevo').set({
            _deviceId: 'dev-nuevo', _userUid: 'bartender1', _area: 'barra1', _lastWrite: Date.now()
        }));
    });

    await prueba('P22b. Un usuario SIN campo status sigue pudiendo escribir', async () => {
        await sembrarFase2();
        // Garantía de despliegue: ningún documento usuarios/* tiene hoy el
        // campo 'status'. Si la regla lo exigiera en vez de asumir 'activo'
        // por defecto, el despliegue dejaría fuera a toda la plantilla.
        await assertSucceeds(rutaAuditoria(bt1, 'bartender1').set({
            uid: 'bartender1', sessionId: 'inv-activo', conteo: {}
        }));
    });

    // ── P26 ──────────────────────────────────────────────────────────
    await prueba('P26. No se puede dejar al rol ADMIN sin el comodín', async () => {
        await sembrarFase2();
        await assertFails(admin1.doc('roles/ADMIN').update({ permissions: ['inventory.count'] }));
        await assertSucceeds(admin1.doc('roles/ADMIN').update({ permissions: ['*', 'inventory.count'] }));
    });

    // ── Delegación de la administración de permisos ──────────────────
    await prueba('P26b. Quien recibe permissions.update no puede usarlo sobre sí mismo', async () => {
        await sembrarFase2(async (db) => {
            await db.doc('usuarios/subjefe1').set({
                uid: 'subjefe1', role: 'SUBJEFE_BARRA',
                permissionOverrides: { 'permissions.update': 'allow' }
            });
        });
        // Puede administrar a otros…
        await assertSucceeds(subjefe1.doc('usuarios/bartender1')
            .update({ permissionOverrides: { 'inventory.export': 'allow' } }));
        // …pero no auto-ascenderse.
        await assertFails(subjefe1.doc('usuarios/subjefe1')
            .update({ permissionOverrides: { 'permissions.update': 'allow', 'catalog.publish': 'allow' } }));
    });

    // ── P21b — paridad servidor (la mitad de cliente vive en prueba-f2) ──
    await prueba('P21b. El servidor resuelve la precedencia igual que el cliente', async () => {
        // Matriz rol × override × estado evaluada contra una operación
        // gateada por hasPerm('catalog.publish'). El resultado esperado sale
        // de la MISMA tabla que prueba-f2.js aplica sobre permisosEfectivos()
        // del cliente; si los dos motores divergieran, una de las dos suites
        // fallaría.
        const P = 'catalog.publish';
        const casos = [
            // [rol,            override,  status,     esperado]
            ['ADMIN',           null,      'activo',   true ],
            ['ADMIN',           'deny',    'activo',   true ],  // el comodín gana
            ['ADMIN',           null,      'inactivo', false],
            ['SUBJEFE_BARRA',   null,      'activo',   false],
            ['SUBJEFE_BARRA',   'allow',   'activo',   true ],
            ['SUBJEFE_BARRA',   'deny',    'activo',   false],
            ['BARTENDER',       null,      'activo',   false],
            ['BARTENDER',       'allow',   'activo',   true ],
            ['BARTENDER',       'allow',   'inactivo', false],
            ['BARTENDER',       'deny',    'activo',   false],
            ['ROL_DESCONOCIDO', null,      'activo',   false],
            ['ROL_DESCONOCIDO', 'allow',   'activo',   true ]
        ];
        for (const [rol, ov, status, esperado] of casos) {
            await sembrarFase2(async (db) => {
                const doc = { uid: 'bartender1', role: rol, status: status };
                if (ov) doc.permissionOverrides = { [P]: ov };
                await db.doc('usuarios/bartender1').set(doc);
            });
            const intento = rutaCatalogo(bt1).set({ productos: [], version: Date.now() });
            if (esperado) await assertSucceeds(intento);
            else          await assertFails(intento);
        }
    });

    await prueba('P21c. El permiso HEREDADO del rol funciona sin override', async () => {
        // Sin esta prueba, la matriz de P21b no distinguiría "denegado por
        // regla" de "denegado por error de evaluación": todos sus casos sin
        // override esperan false. Aquí el permiso llega SOLO por el rol, sin
        // ningún override de por medio, así que la rama 5 de la precedencia
        // (el permiso está en la lista del rol) queda comprobada de verdad.
        await sembrarFase2(async (db) => {
            await db.doc('roles/SUBJEFE_BARRA').set({
                roleId: 'SUBJEFE_BARRA', nombre: 'Subjefe de Barra', esSistema: true,
                permissions: ['inventory.count', 'catalog.publish']
            });
            await db.doc('usuarios/subjefe1').set({ uid: 'subjefe1', role: 'SUBJEFE_BARRA' });
        });
        await assertSucceeds(rutaCatalogo(subjefe1).set({ productos: [], version: Date.now() }));
    });

    await prueba('P21d. El rol legacy "user" se resuelve igual que en el cliente', async () => {
        // _roleCanonico() del cliente mapea 'user'→BARTENDER y 'admin'→ADMIN.
        // Las reglas tienen que hacer lo mismo o un usuario sin migrar se
        // comportaría distinto en el servidor que en la pantalla.
        await sembrarFase2(async (db) => {
            await db.doc('usuarios/bartender1').set({ uid: 'bartender1', role: 'user' });
            await db.doc('usuarios/admin2').set({ uid: 'admin2', role: 'admin' });
        });
        await assertFails(rutaCatalogo(bt1).set({ productos: [], version: Date.now() }));
        await assertSucceeds(rutaCatalogo(admin2).set({ productos: [], version: Date.now() }));
    });


    // ══════════════════════════════════════════════════════════════════
    //  PASO PREVIO A FASE 3 — CIERRE ATÓMICO E INMUTABILIDAD DEL SNAPSHOT
    //  ────────────────────────────────────────────────────────────────
    //  X4 es la prueba que sostiene todo el diseño del cierre atómico: si
    //  las reglas NO evaluaran cada escritura del batch contra el estado ya
    //  confirmado, el propio batch que cierra el inventario se rechazaría a
    //  sí mismo y el cierre sería imposible. Se comprueba contra el motor
    //  real de Firestore, no se deduce de la documentación.
    // ══════════════════════════════════════════════════════════════════

    const rutaChunk = (db, invId, chunkId) =>
        db.doc('inventarioApp/barra-principal/inventories/' + invId + '/snapshotChunks/' + chunkId);
    const chunkDemo = (i, n) => ({ items: [{ tipo: 'producto', id: 'PRD-' + i }], chunkIndex: i, totalChunks: n, _updatedAt: Date.now() });

    await prueba('X1. Se pueden crear fragmentos mientras el inventario está abierto', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaChunk(admin1, 'inv-activo', 'chunk_0').set(chunkDemo(0, 1)));
    });

    await prueba('X2. NO se puede crear un fragmento en un inventario CERRADO', async () => {
        await reiniciarConDatosBase();
        // Este era el hueco H-2: la regla no miraba el estado del padre, así
        // que un admin podía AÑADIR registros a un snapshot ya cerrado y el
        // lector los concatenaba sin distinguirlos de los originales.
        await assertFails(rutaChunk(admin1, 'inv-cerrado', 'chunk_0').set(chunkDemo(0, 1)));
        await assertFails(rutaChunk(admin1, 'inv-cerrado', 'chunk_extra').set(chunkDemo(0, 1)));
    });

    await prueba('X3. Un fragmento existente sigue sin poder actualizarse ni borrarse', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaChunk(ctx.firestore(), 'inv-activo', 'chunk_0').set(chunkDemo(0, 1));
        });
        await assertFails(rutaChunk(admin1, 'inv-activo', 'chunk_0').set(chunkDemo(9, 1)));
        await assertFails(rutaChunk(admin1, 'inv-activo', 'chunk_0').delete());
    });

    await prueba('X4. ★ El batch atómico de cierre (fragmentos + CERRADO) se confirma entero', async () => {
        await reiniciarConDatosBase();
        const batch = admin1.batch();
        for (let i = 0; i < 3; i++) {
            batch.set(rutaChunk(admin1, 'inv-activo', 'chunk_' + i), chunkDemo(i, 3));
        }
        batch.update(rutaInventario(admin1, 'inv-activo'), {
            estado: 'CERRADO', fechaCierre: Date.now(), cerradoPorUid: 'admin1',
            semanaId: '2026-W38', semanaIdOrigen: 'fechaRecuento'
        });
        await assertSucceeds(batch.commit());
    });

    await prueba('X5. Tras el cierre atómico ya no se puede ampliar el snapshot', async () => {
        await reiniciarConDatosBase();
        const batch = admin1.batch();
        batch.set(rutaChunk(admin1, 'inv-activo', 'chunk_0'), chunkDemo(0, 1));
        batch.update(rutaInventario(admin1, 'inv-activo'), { estado: 'CERRADO', fechaCierre: Date.now() });
        await assertSucceeds(batch.commit());
        // El inventario ya está cerrado: el snapshot queda sellado.
        await assertFails(rutaChunk(admin1, 'inv-activo', 'chunk_1').set(chunkDemo(1, 2)));
        await assertFails(rutaChunk(admin1, 'inv-activo', 'chunk_0').set(chunkDemo(0, 1)));
        // Y el inventario sigue siendo inmutable e imborrable.
        await assertFails(rutaInventario(admin1, 'inv-activo').update({ estado: 'SINCRONIZADO' }));
        await assertFails(rutaInventario(admin1, 'inv-activo').delete());
    });

    await prueba('X5b. Un bartender no puede crear fragmentos ni con el inventario abierto', async () => {
        await reiniciarConDatosBase();
        await assertFails(rutaChunk(bt1, 'inv-activo', 'chunk_0').set(chunkDemo(0, 1)));
    });


    // ══════════════════════════════════════════════════════════════════
    //  FASE 3 — CONTABILIZAR
    //  ────────────────────────────────────────────────────────────────
    //  La idempotencia la garantiza el SERVIDOR: id determinista +
    //  documento inmutable. Estas pruebas atacan Firestore directamente.
    // ══════════════════════════════════════════════════════════════════

    const rutaInicial = (db, semana) =>
        db.doc('inventarioApp/barra-principal/inventariosIniciales/' + semana);
    const inicialDemo = (semana, invId, numero) => ({
        semanaId: semana,
        origen: { tipo: 'cierre_inventario', inventoryId: invId, numero: numero,
                  fechaCierre: '2026-09-13', semanaCerrada: '2026-09-07' },
        saldos: { 'PRD-001': 12.5, 'PRD-002': 0 },
        totalProductos: 2,
        contabilizadoPor: 'admin1',
        contabilizadoEn: Date.now()
    });

    await prueba('P9. Un bartender NO puede contabilizar', async () => {
        await sembrarFase2();
        await assertFails(rutaInicial(bt1, '2026-09-14').set(inicialDemo('2026-09-14', 'inv-cerrado', 100)));
    });

    await prueba('P10. Un subjefe NO puede contabilizar por defecto', async () => {
        await sembrarFase2();
        await assertFails(rutaInicial(subjefe1, '2026-09-14').set(inicialDemo('2026-09-14', 'inv-cerrado', 100)));
    });

    await prueba('P10b. Un subjefe CON inventory.post delegado sí puede', async () => {
        await sembrarFase2(async (db) => {
            await db.doc('usuarios/subjefe1').set({
                uid: 'subjefe1', role: 'SUBJEFE_BARRA',
                permissionOverrides: { 'inventory.post': 'allow' }
            });
        });
        await assertSucceeds(rutaInicial(subjefe1, '2026-09-14').set(inicialDemo('2026-09-14', 'inv-cerrado', 100)));
    });

    await prueba('P11. El admin SÍ puede crear el inicial', async () => {
        await sembrarFase2();
        await assertSucceeds(rutaInicial(admin1, '2026-09-14').set(inicialDemo('2026-09-14', 'inv-cerrado', 100)));
    });

    await prueba('P14. ★ Crear dos veces el inicial de la misma semana es imposible', async () => {
        await sembrarFase2();
        await assertSucceeds(rutaInicial(admin1, '2026-09-14').set(inicialDemo('2026-09-14', 'inv-cerrado', 100)));
        // La idempotencia no depende de que el cliente se acuerde de comprobar:
        // el servidor rechaza el segundo intento, venga de donde venga.
        await assertFails(rutaInicial(admin1, '2026-09-14').set(inicialDemo('2026-09-14', 'inv-cerrado', 100)));
        await assertFails(rutaInicial(admin1, '2026-09-14').update({ totalProductos: 99 }));
        await assertFails(rutaInicial(admin1, '2026-09-14').delete());
    });

    await prueba('F5. Otro inventario tampoco puede ocupar una semana ya usada', async () => {
        await sembrarFase2();
        await assertSucceeds(rutaInicial(admin1, '2026-09-14').set(inicialDemo('2026-09-14', 'inv-cerrado', 100)));
        // Mismo rechazo; lo que cambia es que el cliente, al leer el documento,
        // verá un origen distinto del suyo y lo reportará como conflicto.
        await assertFails(rutaInicial(admin1, '2026-09-14').set(inicialDemo('2026-09-14', 'otro-inventario', 200)));
    });

    await prueba('F6. El documento no puede declarar una semana distinta de su ruta', async () => {
        await sembrarFase2();
        await assertFails(rutaInicial(admin1, '2026-09-14').set(inicialDemo('2026-09-21', 'inv-cerrado', 100)));
    });

    await prueba('F6b. El inicial exige origen e importes con la forma correcta', async () => {
        await sembrarFase2();
        await assertFails(rutaInicial(admin1, '2026-09-14').set({ semanaId: '2026-09-14' }));
        await assertFails(rutaInicial(admin1, '2026-09-14').set({
            semanaId: '2026-09-14', origen: { tipo: 'cierre_inventario' }, saldos: {}
        }));
    });

    await prueba('P12. Un inventario NO cerrado no puede pasar a CONTABILIZADO', async () => {
        await sembrarFase2();
        await assertFails(rutaInventario(admin1, 'inv-activo').update({
            estado: 'CONTABILIZADO', contabilizadoEn: Date.now(),
            contabilizadoPor: 'admin1', semanaDestino: '2026-09-14'
        }));
    });

    await prueba('P13. Un inventario CERRADO sí puede pasar a CONTABILIZADO', async () => {
        await sembrarFase2();
        await assertSucceeds(rutaInventario(admin1, 'inv-cerrado').update({
            estado: 'CONTABILIZADO', contabilizadoEn: Date.now(),
            contabilizadoPor: 'admin1', semanaDestino: '2026-09-14'
        }));
    });

    await prueba('F2. La transición solo admite los cuatro campos de la lista blanca', async () => {
        await sembrarFase2();
        await assertFails(rutaInventario(admin1, 'inv-cerrado').update({
            estado: 'CONTABILIZADO', contabilizadoEn: Date.now(),
            contabilizadoPor: 'admin1', semanaDestino: '2026-09-14',
            totalProductos: 999          // ← un campo de más y se cae entero
        }));
        await assertFails(rutaInventario(admin1, 'inv-cerrado').update({
            estado: 'CONTABILIZADO', contabilizadoEn: Date.now(),
            contabilizadoPor: 'admin1', semanaDestino: '2026-09-14',
            fechaCierre: 1                // ← tocar el cierre queda prohibido
        }));
    });

    await prueba('F1. ★ Un inventario CONTABILIZADO ya no se puede modificar', async () => {
        await sembrarFase2();
        await assertSucceeds(rutaInventario(admin1, 'inv-cerrado').update({
            estado: 'CONTABILIZADO', contabilizadoEn: Date.now(),
            contabilizadoPor: 'admin1', semanaDestino: '2026-09-14'
        }));
        // Este era el agujero: con la regla anterior (estado != 'CERRADO'),
        // CONTABILIZADO habría quedado ABIERTO a cualquier modificación.
        await assertFails(rutaInventario(admin1, 'inv-cerrado').update({ totalProductos: 1 }));
        await assertFails(rutaInventario(admin1, 'inv-cerrado').update({ numero: 999 }));
        await assertFails(rutaInventario(admin1, 'inv-cerrado').delete());
    });

    await prueba('F3. No se puede volver de CONTABILIZADO a CERRADO ni a SINCRONIZADO', async () => {
        await sembrarFase2();
        await assertSucceeds(rutaInventario(admin1, 'inv-cerrado').update({
            estado: 'CONTABILIZADO', contabilizadoEn: Date.now(),
            contabilizadoPor: 'admin1', semanaDestino: '2026-09-14'
        }));
        await assertFails(rutaInventario(admin1, 'inv-cerrado').update({ estado: 'CERRADO' }));
        await assertFails(rutaInventario(admin1, 'inv-cerrado').update({ estado: 'SINCRONIZADO' }));
    });

    await prueba('F4. El snapshot sigue siendo inmutable tras contabilizar', async () => {
        await sembrarFase2();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaChunk(ctx.firestore(), 'inv-cerrado', 'chunk_0').set(chunkDemo(0, 1));
        });
        await assertSucceeds(rutaInventario(admin1, 'inv-cerrado').update({
            estado: 'CONTABILIZADO', contabilizadoEn: Date.now(),
            contabilizadoPor: 'admin1', semanaDestino: '2026-09-14'
        }));
        await assertFails(rutaChunk(admin1, 'inv-cerrado', 'chunk_0').set(chunkDemo(9, 1)));
        await assertFails(rutaChunk(admin1, 'inv-cerrado', 'chunk_1').set(chunkDemo(1, 2)));
        await assertFails(rutaChunk(admin1, 'inv-cerrado', 'chunk_0').delete());
    });

    await prueba('P20. Los inventarios contabilizados siguen siendo consultables', async () => {
        await sembrarFase2();
        await assertSucceeds(rutaInventario(admin1, 'inv-cerrado').update({
            estado: 'CONTABILIZADO', contabilizadoEn: Date.now(),
            contabilizadoPor: 'admin1', semanaDestino: '2026-09-14'
        }));
        await assertSucceeds(rutaInventario(bt1, 'inv-cerrado').get());
        await assertSucceeds(rutaInicial(bt1, '2026-09-14').get());
    });

    // ══════════════════════════════════════════════════════════════════
    //  FASE 4 — COMPRAS (el hecho) + MOVIMIENTOS (el efecto)
    //  ────────────────────────────────────────────────────────────────
    //  Mismo patrón de idempotencia que inventariosIniciales: id
    //  determinista + create sin update ni delete. Estas pruebas atacan
    //  Firestore directamente, sin pasar por la interfaz.
    // ══════════════════════════════════════════════════════════════════

    const rutaCompra = (db, compraId) =>
        db.doc('compras/' + compraId);
    const rutaMovimiento = (db, movId) =>
        db.doc('movimientos/' + movId);
    const compraDemo = (compraId, overrides) => Object.assign({
        compraId: compraId, folio: '3646', docSap: '27615', fecha: '2026-09-19',
        semanaId: '2026-09-14', proveedorCodigo: 'P00106', proveedorNombre: 'VINOTECA MEXICO',
        importe: 4587.72, origen: 'excel', creadoPor: 'admin1', creadoEn: Date.now(),
        lineas: [{ productoId: '1180015', cantidadInventario: 1, costoUnitario: 661.33, importe: 661.33 }]
    }, overrides || {});
    const movimientoDemo = (movId, compraId, overrides) => Object.assign({
        movId: movId, tipo: 'compra', productoId: '1180015', cantidad: 1,
        fecha: '2026-09-19', semanaId: '2026-09-14',
        origen: { tipo: 'compra', compraId: compraId, folio: '3646', proveedorNombre: 'VINOTECA MEXICO' },
        costoUnitario: 661.33, creadoPor: 'admin1', creadoEn: Date.now()
    }, overrides || {});

    async function sembrarFase4(extra) {
        await sembrarFase2(async (db) => {
            // Un usuario de compras: BARTENDER + los tres permisos delegados,
            // igual que P10b delegó inventory.post a un subjefe.
            await db.doc('usuarios/comprador1').set({
                uid: 'comprador1', role: 'BARTENDER',
                permissionOverrides: {
                    'purchases.read': 'allow', 'purchases.create': 'allow', 'purchases.import': 'allow'
                }
            });
            if (extra) await extra(db);
        });
    }
    const comprador1 = testEnv.authenticatedContext('comprador1').firestore();

    await prueba('C1. Con purchases.create se puede registrar una compra', async () => {
        await sembrarFase4();
        await assertSucceeds(rutaCompra(comprador1, 'sap-27615').set(compraDemo('sap-27615')));
    });

    await prueba('C2. ★ Importar dos veces el mismo documento SAP es imposible', async () => {
        await sembrarFase4();
        await assertSucceeds(rutaCompra(comprador1, 'sap-27615').set(compraDemo('sap-27615')));
        await assertFails(rutaCompra(comprador1, 'sap-27615').set(compraDemo('sap-27615')));
    });

    await prueba('C3. El documento no puede declarar un compraId distinto de su ruta', async () => {
        await sembrarFase4();
        await assertFails(rutaCompra(comprador1, 'sap-27615').set(compraDemo('otro-id')));
    });

    await prueba('C4. Un bartender sin el permiso NO puede registrar una compra', async () => {
        await sembrarFase4();
        await assertFails(rutaCompra(bt1, 'sap-27615').set(compraDemo('sap-27615')));
    });

    await prueba('C5. Una compra ya creada no admite update', async () => {
        await sembrarFase4();
        await assertSucceeds(rutaCompra(comprador1, 'sap-27615').set(compraDemo('sap-27615')));
        await assertFails(rutaCompra(comprador1, 'sap-27615').update({ importe: 1 }));
    });

    await prueba('C6. Una compra ya creada no admite delete', async () => {
        await sembrarFase4();
        await assertSucceeds(rutaCompra(comprador1, 'sap-27615').set(compraDemo('sap-27615')));
        await assertFails(rutaCompra(comprador1, 'sap-27615').delete());
    });

    await prueba('C7. ★ Sin purchases.read (bartender normal) no se puede leer una compra', async () => {
        await sembrarFase4();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaCompra(ctx.firestore(), 'sap-27615').set(compraDemo('sap-27615'));
        });
        await assertFails(rutaCompra(bt1, 'sap-27615').get());
        await assertSucceeds(rutaCompra(comprador1, 'sap-27615').get());
    });

    await prueba('C8. ★ El libro de movimientos NO admite tipo distinto de compra', async () => {
        await sembrarFase4();
        await assertFails(rutaMovimiento(comprador1, 'compra_sap-27615_1180015')
            .set(movimientoDemo('compra_sap-27615_1180015', 'sap-27615', { tipo: 'consumo_venta' })));
        await assertFails(rutaMovimiento(comprador1, 'ajuste_1')
            .set(movimientoDemo('ajuste_1', 'sap-27615', { tipo: 'ajuste' })));
    });

    await prueba('C9. Un movimiento de compra exige origen.compraId', async () => {
        await sembrarFase4();
        const sinOrigen = movimientoDemo('compra_sap-27615_1180015', 'sap-27615');
        delete sinOrigen.origen;
        await assertFails(rutaMovimiento(comprador1, 'compra_sap-27615_1180015').set(sinOrigen));
    });

    await prueba('C10. Una compra con 0 líneas se rechaza', async () => {
        await sembrarFase4();
        await assertFails(rutaCompra(comprador1, 'sap-27615').set(compraDemo('sap-27615', { lineas: [] })));
    });

    await prueba('C11. Una compra con más de 400 líneas se rechaza', async () => {
        await sembrarFase4();
        const muchasLineas = Array.from({ length: 401 }, (_, i) => ({ productoId: 'P' + i, cantidadInventario: 1, costoUnitario: 1, importe: 1 }));
        await assertFails(rutaCompra(comprador1, 'sap-27615').set(compraDemo('sap-27615', { lineas: muchasLineas })));
    });

    await prueba('C12. contadores/compras exige el permiso, no cualquier autenticado', async () => {
        await sembrarFase4();
        await assertFails(bt1.doc('contadores/compras').set({ ultimoNumero: 1 }));
        await assertSucceeds(comprador1.doc('contadores/compras').set({ ultimoNumero: 1 }));
    });

    await prueba('C13. costos/ultimos se escribe con purchases.import', async () => {
        await sembrarFase4();
        await assertSucceeds(comprador1.doc('costos/ultimos').set({ productos: { '1180015': { costo: 661.33 } } }));
    });

    await prueba('C14. Las garantías de FASE 3 siguen en pie tras estos cambios', async () => {
        await sembrarFase2();
        await assertSucceeds(rutaInicial(admin1, '2026-09-14').set(inicialDemo('2026-09-14', 'inv-cerrado', 100)));
        await assertFails(rutaInicial(admin1, '2026-09-14').update({ totalProductos: 99 }));
        await assertSucceeds(rutaInventario(admin1, 'inv-cerrado').update({
            estado: 'CONTABILIZADO', contabilizadoEn: Date.now(),
            contabilizadoPor: 'admin1', semanaDestino: '2026-09-14'
        }));
        await assertFails(rutaInventario(admin1, 'inv-cerrado').update({ estado: 'CERRADO' }));
    });

    // ══════════════════════════════════════════════════════════════════
    //  FASE 5 (5B) — CONTEO DE AUDITORÍA HUÉRFANO
    //  ────────────────────────────────────────────────────────────────
    //  Mismo patrón de inmutabilidad que 'compras': id determinista
    //  (uid + '_' + sessionId) + create sin update ni delete. La lectura
    //  está gateada por inventory.reopenArea, no por ser el propio dueño.
    // ══════════════════════════════════════════════════════════════════

    const rutaHuerfano = (db, huerfanoId) =>
        db.doc('inventarioApp/barra-principal/conteosAuditoriaHuerfanos/' + huerfanoId);
    const huerfanoDemo = (overrides) => Object.assign({
        uid: 'bartender1', sessionId: '1788115846917',
        conteo: { almacen: { PRD001: { enteras: 3, abiertas: [] } } },
        status: { almacen: 'completada', barra1: 'pendiente', barra2: 'pendiente' },
        finalizadas: { almacen: { finalizadoEn: Date.now(), finalizadoPor: 'bartender1' } },
        capturadoEn: Date.now()
    }, overrides || {});

    async function sembrarFase5(extra) {
        await sembrarFase2(async (db) => {
            // Un usuario con permiso de reabrir área, delegado igual que
            // C1 delegó purchases.* a un bartender normal.
            await db.doc('usuarios/reabridor1').set({
                uid: 'reabridor1', role: 'BARTENDER',
                permissionOverrides: { 'inventory.reopenArea': 'allow' }
            });
            if (extra) await extra(db);
        });
    }
    const reabridor1 = testEnv.authenticatedContext('reabridor1').firestore();

    await prueba('H1. Un usuario puede archivar su propio conteo huérfano', async () => {
        await sembrarFase5();
        await assertSucceeds(rutaHuerfano(bt1, 'bartender1_1788115846917').set(huerfanoDemo()));
    });

    await prueba('H2. Un usuario NO puede archivar un conteo huérfano a nombre de OTRO uid', async () => {
        await sembrarFase5();
        await assertFails(rutaHuerfano(bt1, 'bartender2_1788115846917')
            .set(huerfanoDemo({ uid: 'bartender2' })));
    });

    await prueba('H3. El id del documento debe coincidir exactamente con uid_sessionId del payload', async () => {
        await sembrarFase5();
        await assertFails(rutaHuerfano(bt1, 'bartender1_otraSesion')
            .set(huerfanoDemo({ sessionId: '1788115846917' })));
    });

    await prueba('H4. ★ Ni siquiera el propio dueño puede update ni delete sobre un huérfano ya creado', async () => {
        await sembrarFase5();
        await assertSucceeds(rutaHuerfano(bt1, 'bartender1_1788115846917').set(huerfanoDemo()));
        await assertFails(rutaHuerfano(bt1, 'bartender1_1788115846917').update({ sessionId: 'otro' }));
        await assertFails(rutaHuerfano(bt1, 'bartender1_1788115846917').delete());
    });

    await prueba('H5. Leer conteosAuditoriaHuerfanos exige inventory.reopenArea', async () => {
        await sembrarFase5();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaHuerfano(ctx.firestore(), 'bartender1_1788115846917').set(huerfanoDemo());
        });
        await assertFails(rutaHuerfano(bt1, 'bartender1_1788115846917').get());
        await assertSucceeds(rutaHuerfano(reabridor1, 'bartender1_1788115846917').get());
        await assertSucceeds(rutaHuerfano(admin1, 'bartender1_1788115846917').get());
    });

    await prueba('H6. Falta un campo requerido (sessionId no string o capturadoEn no number) se rechaza', async () => {
        await sembrarFase5();
        await assertFails(rutaHuerfano(bt1, 'bartender1_1788115846917')
            .set(huerfanoDemo({ sessionId: 1788115846917 })));
        await assertFails(rutaHuerfano(bt1, 'bartender1_1788115846917')
            .set(huerfanoDemo({ capturadoEn: '' + Date.now() })));
    });

    // ══════════════════════════════════════════════════════════════════
    //  FASE 7 — SEGURIDAD: chunks, ajustes, conflictos, cambios
    // ══════════════════════════════════════════════════════════════════
    const R7 = 'inventarioApp/barra-principal';
    const chunk = (i, total, extra) => Object.assign(
        { items: [{ id: 'PED-' + i }], chunkIndex: i, totalChunks: total, _updatedAt: Date.now() }, extra || {});
    async function sembrarFase7() {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('usuarios/baja1').set({ uid: 'baja1', role: 'BARTENDER', status: 'inactivo' });
        });
    }
    const baja1 = testEnv.authenticatedContext('baja1').firestore();

    await prueba('F7-1. Un bartender escribe un fragmento con la forma real de _writeChunkedSubcollection', async () => {
        await sembrarFase7();
        await assertSucceeds(bt1.doc(R7 + '/ordersChunks/chunk_0').set(chunk(0, 2)));
        await assertSucceeds(bt1.doc(R7 + '/inventoriesChunks/chunk_1').set(chunk(1, 2)));
        await assertSucceeds(bt1.doc(R7 + '/ordersChunks/chunk_0').set(chunk(0, 1)));   // sobrescribir = update
    });

    await prueba('F7-2. ★ Un bartender YA NO puede borrar fragmentos; el admin sí', async () => {
        await sembrarFase7();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc(R7 + '/ordersChunks/chunk_3').set(chunk(3, 4));
            await ctx.firestore().doc(R7 + '/inventoriesChunks/chunk_3').set(chunk(3, 4));
        });
        await assertFails(bt1.doc(R7 + '/ordersChunks/chunk_3').delete());
        await assertFails(bt1.doc(R7 + '/inventoriesChunks/chunk_3').delete());
        await assertSucceeds(admin1.doc(R7 + '/ordersChunks/chunk_3').delete());
    });

    await prueba('F7-3. Fragmentos con forma inválida se rechazan (id, índice, campos, tamaño)', async () => {
        await sembrarFase7();
        await assertFails(bt1.doc(R7 + '/ordersChunks/hack').set(chunk(0, 1)));
        await assertFails(bt1.doc(R7 + '/ordersChunks/chunk_1').set(chunk(0, 2)));            // id ≠ índice
        await assertFails(bt1.doc(R7 + '/ordersChunks/chunk_2').set(chunk(2, 2)));            // índice ≥ total
        await assertFails(bt1.doc(R7 + '/ordersChunks/chunk_0').set(chunk(0, 1, { extra: 1 })));
        await assertFails(bt1.doc(R7 + '/ordersChunks/chunk_0').set(
            chunk(0, 1, { items: Array.from({ length: 81 }, (_, k) => ({ id: 'x' + k })) })));
        await assertFails(bt1.doc(R7 + '/ordersChunks/chunk_0').set({ items: [], chunkIndex: 0, totalChunks: 1 }));
    });

    await prueba('F7-4. ★ Una cuenta dada de baja ya no escribe fragmentos ni conflictos ni ajustes', async () => {
        await sembrarFase7();
        await assertFails(baja1.doc(R7 + '/ordersChunks/chunk_0').set(chunk(0, 1)));
        await assertFails(baja1.doc(R7 + '/conflictos/cX').set({ tipo: 'version_mismatch', ts: Date.now() }));
        await assertFails(baja1.collection('ajustes').doc('AbCdEfGhIjKlMnOpQrSt').set({
            productoId: 'P1', productoNombre: 'X', motivo: 'm', cantidadSugerida: 1,
            solicitanteUid: 'baja1', estado: 'pendiente', creadoEn: Date.now() }));
    });

    const ajuste = (extra) => Object.assign({ productoId: 'PRD-001', productoNombre: 'DON JULIO 70',
        motivo: 'Botella rota', cantidadSugerida: 3, solicitanteUid: 'bartender1',
        estado: 'pendiente', creadoEn: Date.now() }, extra || {});
    const AUTO_ID = 'AbCdEfGhIjKlMnOpQrSt';

    await prueba('F7-5. Un bartender crea un ajuste con la forma real de solicitarAjuste()', async () => {
        await sembrarFase7();
        await assertSucceeds(bt1.collection('ajustes').add(ajuste()));
        await assertSucceeds(bt1.collection('ajustes').add(ajuste({ cantidadSugerida: null })));
        await assertSucceeds(bt1.collection('ajustes').add(ajuste({ cantidadSugerida: 0 })));
    });

    await prueba('F7-6. ★ Ajustes maliciosos se rechazan (XSS en cantidad, autoría, estado, id, tamaño)', async () => {
        await sembrarFase7();
        const a = bt1.collection('ajustes');
        await assertFails(a.doc(AUTO_ID).set(ajuste({ cantidadSugerida: '<img src=x onerror=alert(1)>' })));
        await assertFails(a.doc(AUTO_ID).set(ajuste({ solicitanteUid: 'bartender2' })));
        await assertFails(a.doc(AUTO_ID).set(ajuste({ estado: 'aprobado' })));
        await assertFails(a.doc("x');alert(1);-AAAAAAAA").set(ajuste()));    // id que rompería el onclick
        await assertFails(a.doc(AUTO_ID).set(ajuste({ motivo: 'x'.repeat(501) })));
        await assertFails(a.doc(AUTO_ID).set(ajuste({ motivo: '' })));
        await assertFails(a.doc(AUTO_ID).set(ajuste({ campoExtra: true })));
    });

    await prueba('F7-7. Resolver un ajuste: solo el admin y solo los campos de resolución', async () => {
        await sembrarFase7();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('ajustes/' + AUTO_ID).set(ajuste());
        });
        await assertFails(bt1.doc('ajustes/' + AUTO_ID).update({ estado: 'aprobado', resolvidoEn: Date.now(), resolvidoPor: 'bartender1' }));
        await assertFails(admin1.doc('ajustes/' + AUTO_ID).update({ estado: 'aprobado', motivo: 'otro' }));
        await assertFails(admin1.doc('ajustes/' + AUTO_ID).update({ estado: 'cualquiera' }));
        await assertSucceeds(admin1.doc('ajustes/' + AUTO_ID).update({ estado: 'aprobado', resolvidoEn: Date.now(), resolvidoPor: 'admin1' }));
    });

    await prueba('F7-8. ★ Un conflicto registrado ya no se puede reescribir, ni por quien lo creó', async () => {
        await sembrarFase7();
        await assertSucceeds(bt1.doc(R7 + '/conflictos/conf_1').set({ prodName: 'X', area: 'barra1', ts: Date.now() }));
        await assertFails(bt1.doc(R7 + '/conflictos/conf_1').set({ prodName: 'X', area: 'barra1', ts: 0 }));
        await assertFails(bt2.doc(R7 + '/conflictos/conf_1').update({ valorNube: 0 }));
    });

    await prueba('F7-9. ★ Un evento de la cola no se puede crear a nombre de otro', async () => {
        await sembrarFase7();
        await assertFails(bt1.doc(R7 + '/cambios/ev1').set({ tipo: 'inventario', uid: 'bartender2' }));
        await assertSucceeds(bt1.doc(R7 + '/cambios/ev2').set({ tipo: 'inventario', uid: 'bartender1' }));
        await assertSucceeds(bt1.doc(R7 + '/cambios/ev3').set({ tipo: 'inventario', uid: null }));
        await assertSucceeds(bt1.doc(R7 + '/cambios/ev4').set({ tipo: 'inventario' }));
    });

    // ══════════════════════════════════════════════════════════════════
    //  RECONTEO — registro de reconteo (solo admin, solo inventario abierto)
    // ══════════════════════════════════════════════════════════════════
    const RC = 'inventarioApp/barra-principal/reconteos/';
    const reconteo = (extra) => Object.assign({
        inventoryId: 'inv-activo', inventarioNumero: 101, estado: 'abierto', ronda: 1,
        recontadoPor: 'Eduardo', creadoPorUid: 'admin1', creadoPorEmail: 'a@x.mx',
        creadoEn: 1000, actualizadoEn: 1000, finalizadoEn: null, finalizadoPorUid: null,
        rondas: [], orden: ['P1'],
        items: { P1: { nombre: 'GOLOS', unidad: 'KGS', agregadoEn: 1000, areas: {} } }
    }, extra || {});
    async function sembrarReconteo(extra) {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('usuarios/adminBaja').set({ uid: 'adminBaja', role: 'ADMIN', status: 'inactivo' });
            if (extra) await ctx.firestore().doc(RC + 'rc1').set(reconteo(extra));
        });
    }
    const adminBaja = testEnv.authenticatedContext('adminBaja').firestore();

    await prueba('RC-1. El admin crea un reconteo abierto; un bartender ni lo crea ni lo lee', async () => {
        await sembrarReconteo();
        await assertSucceeds(admin1.doc(RC + 'rc1').set(reconteo()));
        await assertSucceeds(admin1.doc(RC + 'rc1').get());
        await assertFails(bt1.doc(RC + 'rc2').set(reconteo({ creadoPorUid: 'bartender1' })));
        await assertFails(bt1.doc(RC + 'rc1').get());
    });

    await prueba('RC-2. ★ No se crea sobre un inventario CERRADO ni con forma inválida', async () => {
        await sembrarReconteo();
        await assertFails(admin1.doc(RC + 'x1').set(reconteo({ inventoryId: 'inv-cerrado' })));
        await assertFails(admin1.doc(RC + 'x2').set(reconteo({ inventoryId: 'no-existe' })));
        await assertFails(admin1.doc(RC + 'x3').set(reconteo({ creadoPorUid: 'otro' })));
        await assertFails(admin1.doc(RC + 'x4').set(reconteo({ estado: 'finalizado', finalizadoEn: 1, finalizadoPorUid: 'admin1' })));
        await assertFails(admin1.doc(RC + 'x5').set(reconteo({ ronda: 2 })));
        await assertFails(admin1.doc(RC + 'x6').set(reconteo({ campoExtra: 1 })));
        await assertFails(admin1.doc(RC + 'x7').set(reconteo({ recontadoPor: 'n'.repeat(61) })));
        await assertFails(adminBaja.doc(RC + 'x8').set(reconteo({ creadoPorUid: 'adminBaja' })));
    });

    await prueba('RC-3. Finalizar: exige fecha, autor y nombre; creador, fecha e inventario no se reescriben', async () => {
        await sembrarReconteo({});
        const fin = { estado: 'finalizado', finalizadoEn: 2000, finalizadoPorUid: 'admin1', actualizadoEn: 2000,
                      rondas: [{ ronda: 1, recontadoPor: 'Eduardo', uid: 'admin1', finalizadoEn: 2000, productos: 1, correcciones: 1 }] };
        await assertFails(admin1.doc(RC + 'rc1').set(reconteo({ estado: 'finalizado' })));
        await assertFails(admin1.doc(RC + 'rc1').set(reconteo(Object.assign({}, fin, { recontadoPor: '' }))));
        await assertFails(admin1.doc(RC + 'rc1').set(reconteo(Object.assign({}, fin, { creadoPorUid: 'otro' }))));
        await assertFails(admin1.doc(RC + 'rc1').set(reconteo(Object.assign({}, fin, { creadoEn: 5 }))));
        await assertFails(admin1.doc(RC + 'rc1').set(reconteo(Object.assign({}, fin, { inventoryId: 'inv-cerrado' }))));
        await assertSucceeds(admin1.doc(RC + 'rc1').set(reconteo(fin)));
    });

    await prueba('RC-4. Reabrir para una segunda ronda; la ronda no puede retroceder', async () => {
        await sembrarReconteo({ estado: 'finalizado', finalizadoEn: 2000, finalizadoPorUid: 'admin1', ronda: 1 });
        await assertSucceeds(admin1.doc(RC + 'rc1').set(reconteo({ ronda: 2, actualizadoEn: 3000 })));
        await assertFails(admin1.doc(RC + 'rc1').set(reconteo({ ronda: 1, actualizadoEn: 4000 })));
    });

    await prueba('RC-5. ★ Cerrado el inventario, el registro queda congelado (se lee, no se escribe)', async () => {
        await sembrarReconteo({});
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('inventarioApp/barra-principal/inventories/inv-activo').update({ estado: 'CERRADO' });
        });
        await assertSucceeds(admin1.doc(RC + 'rc1').get());
        await assertFails(admin1.doc(RC + 'rc1').set(reconteo({ actualizadoEn: 9000 })));
        await assertFails(admin1.doc(RC + 'rc1').set(reconteo({ estado: 'descartado', actualizadoEn: 9000 })));
    });

    await prueba('RC-6. Nunca se borra; un reconteo descartado ya no se modifica', async () => {
        await sembrarReconteo({});
        await assertFails(admin1.doc(RC + 'rc1').delete());
        await assertSucceeds(admin1.doc(RC + 'rc1').set(reconteo({ estado: 'descartado', actualizadoEn: 2000 })));
        await assertFails(admin1.doc(RC + 'rc1').set(reconteo({ estado: 'abierto', actualizadoEn: 3000 })));
        await assertFails(admin1.doc(RC + 'rc1').delete());
    });

    await testEnv.cleanup();

    console.log('\n── Resumen ──');
    console.log('Total de pruebas: ' + totalPruebas);
    console.log('Pasaron: ' + (totalPruebas - fallos));
    console.log('Fallaron: ' + fallos);
    console.log(fallos === 0 ? '\n✅ TODAS LAS PRUEBAS PASARON (motor real de Firestore)' : '\n❌ ' + fallos + ' prueba(s) fallaron');
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error fatal ejecutando la suite:', e); process.exit(1); });
