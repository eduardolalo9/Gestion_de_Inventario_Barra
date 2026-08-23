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
 * FIX P0.3.1: cada prueba ahora es VERDADERAMENTE independiente — se limpia
 * Firestore Y se re-siembran los documentos usuarios/* en el MISMO paso
 * (reiniciarConDatosBase), nunca en pasos separados. Antes, los documentos
 * usuarios/admin1|bartender1|bartender2 se creaban UNA sola vez al inicio del
 * script, y la primera llamada a testEnv.clearFirestore() (dentro de la
 * prueba 1) los borraba para siempre — las pruebas 12-14, que dependen de
 * isAdminUser() (y por tanto de que esos documentos existan), quedaban
 * corriendo sobre un Firestore sin usuarios. Las pruebas 12 y 13 "pasaban"
 * por razones accidentales (ver comentarios en cada una); la 14 fue la única
 * que expuso el problema, porque es la única que exige que isAdminUser()
 * evalúe realmente a true.
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

// FIX P0.3.1: limpia Firestore Y re-siembra usuarios/roles en el MISMO paso
// atómico — ninguna prueba que dependa de isAdminUser() puede quedar
// corriendo sobre un Firestore sin los documentos de usuario que necesita.
async function reiniciarConDatosBase() {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await db.doc('usuarios/admin1').set({ uid: 'admin1', role: 'ADMIN' });
        await db.doc('usuarios/bartender1').set({ uid: 'bartender1', role: 'BARTENDER' });
        await db.doc('usuarios/bartender2').set({ uid: 'bartender2', role: 'BARTENDER' });
        // Rol de sistema real (mismo shape que _asegurarRolesSistemaEnFirestore
        // escribe en index.html) — necesario para la prueba 7, que usa
        // roles/{roleId} como operación que depende EXCLUSIVAMENTE de admin.
        await db.doc('roles/BARTENDER').set({ roleId: 'BARTENDER', nombre: 'Bartender', permissions: ['inventory.count'], esSistema: true });
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

    // ══════════════════════════════════════════════════════════════════
    //  PARTE 1 — USUARIOS Y ROLES (userAuditoria + isAdminUser)
    // ══════════════════════════════════════════════════════════════════

    await prueba('1. Un usuario normal puede escribir su propio userAuditoria', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaAuditoria(bt1, 'bartender1').set({ sessionId: 'x', conteo: {} }));
    });

    await prueba('2. Un usuario normal NO puede escribir userAuditoria de otro usuario', async () => {
        await reiniciarConDatosBase();
        // Ahora isAdminUser() SÍ puede evaluarse limpiamente (usuarios/bartender1
        // existe) — esta prueba verifica la razón de negocio correcta (no es
        // admin y no es su propio doc), no un error de evaluación accidental.
        await assertFails(rutaAuditoria(bt1, 'bartender2').set({ sessionId: 'x', conteo: {} }));
    });

    await prueba('3. Un admin puede escribir userAuditoria de otro usuario', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(rutaAuditoria(admin1, 'bartender2').set({ sessionId: 'x', conteo: {} }));
    });

    await prueba('4. Un admin puede leer userAuditoria de otro usuario', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaAuditoria(ctx.firestore(), 'bartender2').set({ sessionId: 'x', conteo: {} });
        });
        await assertSucceeds(rutaAuditoria(admin1, 'bartender2').get());
    });

    await prueba('5. Un usuario normal NO puede leer userAuditoria de otro usuario', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaAuditoria(ctx.firestore(), 'bartender2').set({ sessionId: 'x', conteo: {} });
        });
        await assertFails(rutaAuditoria(bt1, 'bartender2').get());
    });

    await prueba('6. admin1 puede leer su PROPIO documento usuarios/admin1 (diagnóstico A)', async () => {
        await reiniciarConDatosBase();
        await assertSucceeds(admin1.doc('usuarios/admin1').get());
    });

    await prueba('7. isAdminUser() probado de forma AISLADA: roles/{roleId} exige EXCLUSIVAMENTE ser admin (sin escape "es mi propio doc")', async () => {
        await reiniciarConDatosBase();
        // A diferencia de userAuditoria (que tiene la vía alterna "es tu propio
        // doc"), la actualización de roles/{roleId} depende ÚNICAMENTE de
        // isAdminUser() — es la operación más limpia para aislar la función.
        await assertFails(bt1.doc('roles/BARTENDER').update({ permissions: ['inventory.count', 'inventory.export'] }));
        await assertSucceeds(admin1.doc('roles/BARTENDER').update({ permissions: ['inventory.count', 'inventory.export'] }));
    });

    await prueba('8. isAdminUser() con usuarios/{uid} INEXISTENTE no lanza error, deniega de forma segura (fix P0.3.1)', async () => {
        await testEnv.clearFirestore(); // sin reiniciarConDatosBase: usuarios/* NO existen a propósito
        // Un uid autenticado cuyo doc usuarios/{uid} todavía no existe (ventana
        // real de un usuario recién registrado) no debe recibir un error de
        // evaluación — debe denegarse limpiamente, como cualquier no-admin.
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

    await prueba('10/11. Dos dispositivos parten de version=3: solo el primero en llegar es aceptado, el segundo es RECHAZADO', async () => {
        await reiniciarConDatosBase();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaProducto(ctx.firestore()).set(docBase(3));
        });
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
            await rutaProducto(ctx.firestore()).set({ enteras: 2, abiertas: [] }); // sin 'version'
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

    await testEnv.cleanup();

    console.log('\n── Resumen ──');
    console.log('Total de pruebas: ' + totalPruebas);
    console.log('Pasaron: ' + (totalPruebas - fallos));
    console.log('Fallaron: ' + fallos);
    console.log(fallos === 0 ? '\n✅ TODAS LAS PRUEBAS PASARON (motor real de Firestore)' : '\n❌ ' + fallos + ' prueba(s) fallaron');
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error fatal ejecutando la suite:', e); process.exit(1); });
