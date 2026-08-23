/**
 * Prueba REAL de firestore.rules contra el emulador oficial de Firestore.
 * NO es una simulación — usa @firebase/rules-unit-testing, que levanta el
 * motor de reglas real de Google y evalúa el archivo firestore.rules tal
 * cual, byte a byte.
 *
 * ── CÓMO EJECUTAR (necesitas una máquina/CI con acceso normal a internet
 *    — este script no pudo correrse dentro del entorno de Claude porque
 *    ese entorno bloquea storage.googleapis.com, de donde se descarga el
 *    binario del emulador; en tu máquina o en GitHub Actions no debería
 *    haber ningún problema) ──
 *
 *   1. npm install --no-save firebase-tools @firebase/rules-unit-testing
 *   2. Coloca este archivo y firestore.rules en la misma carpeta.
 *   3. npx firebase emulators:exec --only firestore --project demo-barinventory \
 *        "node run-rules-tests.js"
 *
 *      (la primera vez, firebase-tools descargará el emulador — requiere
 *      internet; luego queda cacheado localmente)
 *
 * El script imprime PASS/FAIL por cada prueba y termina con código de
 * salida distinto de 0 si algo falló, para poder usarlo en CI.
 */

const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const fs = require('fs');

const PROJECT_ID = 'demo-barinventory';
let testEnv;
let fallos = 0;

async function prueba(nombre, fn) {
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

async function main() {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync('firestore.rules', 'utf8'),
            host: 'localhost',
            port: 8080
        }
    });

    // ── Preparar usuarios de prueba (usuarios/{uid} con distintos roles) ──
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await db.doc('usuarios/admin1').set({ uid: 'admin1', role: 'ADMIN' });
        await db.doc('usuarios/bartender1').set({ uid: 'bartender1', role: 'BARTENDER' });
        await db.doc('usuarios/bartender2').set({ uid: 'bartender2', role: 'BARTENDER' });
    });

    const admin1 = testEnv.authenticatedContext('admin1').firestore();
    const bt1 = testEnv.authenticatedContext('bartender1').firestore();
    const bt2 = testEnv.authenticatedContext('bartender2').firestore();
    const sinAuth = testEnv.unauthenticatedContext().firestore();

    const rutaProducto = (db) => db.doc('inventarioApp/barra-principal/stockAreas/almacen/productos/PRD-001');

    // ── PARTE 1: P0 — optimistic locking real ──

    await prueba('1. Primera escritura (create, version=1) es aceptada', async () => {
        await testEnv.clearFirestore();
        await assertSucceeds(rutaProducto(bt1).set(docBase(1)));
    });

    await prueba('2/3. Dos dispositivos parten de version=3: solo el primero en llegar es aceptado, el segundo es RECHAZADO', async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaProducto(ctx.firestore()).set(docBase(3));
        });
        // bt1 (dispositivo A) llega primero:
        await assertSucceeds(rutaProducto(bt1).set(docBase(4)));
        // bt2 (dispositivo B) intenta el MISMO 3→4 después — el servidor ya está en 4:
        await assertFails(rutaProducto(bt2).set(docBase(4)));
    });

    await prueba('4. version vieja (servidor=5, intenta escribir 4) es rechazada', async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => { await rutaProducto(ctx.firestore()).set(docBase(5)); });
        await assertFails(rutaProducto(bt1).set(docBase(4)));
    });

    await prueba('5. misma version (servidor=3, reintenta 3) es rechazada', async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => { await rutaProducto(ctx.firestore()).set(docBase(3)); });
        await assertFails(rutaProducto(bt1).set(docBase(3)));
    });

    await prueba('6. salto de version (servidor=3, intenta 7) es rechazado', async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => { await rutaProducto(ctx.firestore()).set(docBase(3)); });
        await assertFails(rutaProducto(bt1).set(docBase(7)));
    });

    await prueba('7. usuario NO autenticado no puede escribir, aunque la version sea válida', async () => {
        await testEnv.clearFirestore();
        await assertFails(rutaProducto(sinAuth).set(docBase(1)));
    });

    await prueba('8. documento legacy SIN campo version puede actualizarse escribiendo version=1 (fix P0.3)', async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await rutaProducto(ctx.firestore()).set({ enteras: 2, abiertas: [] }); // sin 'version'
        });
        await assertSucceeds(rutaProducto(bt1).set(docBase(1)));
    });

    await prueba('9. enteras negativo es rechazado', async () => {
        await testEnv.clearFirestore();
        await assertFails(rutaProducto(bt1).set(Object.assign(docBase(1), { enteras: -1 })));
    });

    await prueba('10. abiertas no es una lista → rechazado', async () => {
        await testEnv.clearFirestore();
        await assertFails(rutaProducto(bt1).set(Object.assign(docBase(1), { abiertas: 'no-es-lista' })));
    });

    await prueba('11. falta un campo requerido (ts) → rechazado', async () => {
        await testEnv.clearFirestore();
        const doc = docBase(1); delete doc.ts;
        await assertFails(rutaProducto(bt1).set(doc));
    });

    // ── PARTE 2: hallazgo de precedencia — userAuditoria ──

    await prueba('12. bartender1 NO puede escribir el userAuditoria de bartender2', async () => {
        await testEnv.clearFirestore();
        await assertFails(
            bt1.doc('inventarioApp/barra-principal/userAuditoria/bartender2').set({ sessionId: 'x', conteo: {} })
        );
    });

    await prueba('13. bartender1 SÍ puede escribir su propio userAuditoria', async () => {
        await assertSucceeds(
            bt1.doc('inventarioApp/barra-principal/userAuditoria/bartender1').set({ sessionId: 'x', conteo: {} })
        );
    });

    await prueba('14. admin1 SÍ puede escribir el userAuditoria de cualquier usuario', async () => {
        await assertSucceeds(
            admin1.doc('inventarioApp/barra-principal/userAuditoria/bartender2').set({ sessionId: 'x', conteo: {} })
        );
    });

    await testEnv.cleanup();

    console.log('\n' + (fallos === 0 ? '✅ TODAS LAS PRUEBAS PASARON (motor real de Firestore)' : '❌ ' + fallos + ' prueba(s) fallaron'));
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error fatal ejecutando la suite:', e); process.exit(1); });
