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

    await testEnv.cleanup();

    console.log('\n── Resumen ──');
    console.log('Total de pruebas: ' + totalPruebas);
    console.log('Pasaron: ' + (totalPruebas - fallos));
    console.log('Fallaron: ' + fallos);
    console.log(fallos === 0 ? '\n✅ TODAS LAS PRUEBAS PASARON (motor real de Firestore)' : '\n❌ ' + fallos + ' prueba(s) fallaron');
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error fatal ejecutando la suite:', e); process.exit(1); });
