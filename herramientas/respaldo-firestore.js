#!/usr/bin/env node
/**
 * respaldo-firestore.js — copia completa de los datos a un archivo JSON
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 *
 * Hoy los respaldos de BarInventory viven todos DENTRO del teléfono:
 * `_crearBackupNombrado()` y el snapshot de emergencia escriben en
 * localStorage. Si el navegador limpia el almacenamiento —que es justo el
 * escenario del que hay que protegerse— los respaldos se van con los datos.
 *
 * Y del lado de la nube, el plan Spark de Firestore no hace exportaciones
 * automáticas: si un error o un administrador borra algo, no hay punto de
 * restauración. Este script es esa red: corre desde GitHub Actions una vez
 * por semana (o a mano cuando haga falta) y deja un JSON fuera del teléfono
 * y fuera de Firestore.
 *
 * QUÉ COPIA
 *   · Todo el árbol de inventarioApp/{docId} y sus subcolecciones.
 *   · Las colecciones de nivel raíz: usuarios, roles, catalogo.
 * No copia nada de Auth (usuarios/contraseñas los administra Firebase).
 *
 * CÓMO SE USA
 *
 *   Contra el emulador (pruebas, sin credenciales):
 *     FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     GOOGLE_CLOUD_PROJECT=demo-barinventory \
 *     node herramientas/respaldo-firestore.js --salida respaldos
 *
 *   Contra producción (necesita una clave de cuenta de servicio):
 *     GOOGLE_APPLICATION_CREDENTIALS=/ruta/clave.json \
 *     node herramientas/respaldo-firestore.js --salida respaldos
 *
 *   La clave de cuenta de servicio se saca de:
 *     Consola de Firebase → Configuración del proyecto → Cuentas de servicio
 *     → "Generar nueva clave privada".
 *   NUNCA se commitea: va como secreto de GitHub (ver .github/workflows/respaldo.yml).
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// Documento raíz de la app. Es el mismo valor que FIRESTORE_DOC_ID en
// index.html; se deja configurable por si algún día hay más de una barra.
const DOC_PRINCIPAL = process.env.DOC_PRINCIPAL || 'barra-principal';

// Colecciones de nivel raíz que no cuelgan de inventarioApp.
const COLECCIONES_RAIZ = ['usuarios', 'roles', 'catalogo'];

// Tope de profundidad al bajar por subcolecciones. El árbol real llega a 3
// niveles (inventarioApp → stockAreas → productos); 6 deja margen de sobra
// sin arriesgar una recursión infinita si alguien anida de más.
const PROFUNDIDAD_MAX = 6;

function argumento(nombre, porDefecto) {
    const i = process.argv.indexOf('--' + nombre);
    return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : porDefecto;
}

/**
 * Serializa los tipos propios de Firestore que JSON.stringify no entiende
 * (Timestamp, GeoPoint, DocumentReference, Buffer). Sin esto, un Timestamp
 * se guardaría como {"_seconds":…} y al restaurar dejaría de ser una fecha.
 */
function serializar(valor) {
    if (valor === null || valor === undefined) return valor;
    if (Array.isArray(valor)) return valor.map(serializar);
    if (typeof valor === 'object') {
        if (typeof valor.toDate === 'function') {          // Timestamp
            return { __tipo: 'timestamp', valor: valor.toDate().toISOString() };
        }
        if (valor._latitude !== undefined && valor._longitude !== undefined) {
            return { __tipo: 'geopoint', lat: valor._latitude, lng: valor._longitude };
        }
        if (typeof valor.path === 'string' && valor.firestore) {  // DocumentReference
            return { __tipo: 'referencia', ruta: valor.path };
        }
        if (Buffer.isBuffer(valor)) {
            return { __tipo: 'bytes', base64: valor.toString('base64') };
        }
        const salida = {};
        for (const clave of Object.keys(valor)) salida[clave] = serializar(valor[clave]);
        return salida;
    }
    return valor;
}

/** Baja recursivamente un documento con todas sus subcolecciones. */
async function copiarDocumento(ref, profundidad, cuenta) {
    const snap = await ref.get();
    const nodo = {
        __id:    ref.id,
        __ruta:  ref.path,
        __existe: snap.exists,
        datos:   snap.exists ? serializar(snap.data()) : null,
        subcolecciones: {}
    };
    if (snap.exists) cuenta.documentos++;

    if (profundidad >= PROFUNDIDAD_MAX) {
        nodo.__truncado = true;
        return nodo;
    }
    // listCollections() también encuentra subcolecciones de documentos que
    // no existen como tal (documentos "fantasma"), que es un caso real en
    // Firestore y una forma silenciosa de perder datos en un respaldo.
    const subs = await ref.listCollections();
    for (const sub of subs) {
        nodo.subcolecciones[sub.id] = await copiarColeccion(sub, profundidad + 1, cuenta);
    }
    return nodo;
}

/** Baja una colección entera, documento por documento. */
async function copiarColeccion(ref, profundidad, cuenta) {
    cuenta.colecciones++;
    const docs = await ref.listDocuments();
    const salida = [];
    for (const doc of docs) {
        salida.push(await copiarDocumento(doc, profundidad, cuenta));
    }
    return salida;
}

(async function principal() {
    // firebase-admin v13+ solo expone la API modular ('firebase-admin/app',
    // 'firebase-admin/firestore'); v11/v12 exponían admin.firestore(). Se
    // intenta la moderna y se cae a la antigua, para que el script no dependa
    // de qué versión quedó instalada en la máquina o en el runner.
    let initializeApp, applicationDefault, getFirestore;
    try {
        ({ initializeApp, applicationDefault } = require('firebase-admin/app'));
        ({ getFirestore } = require('firebase-admin/firestore'));
    } catch (_) {
        const admin = require('firebase-admin');
        initializeApp      = admin.initializeApp;
        applicationDefault = admin.credential.applicationDefault;
        getFirestore       = function(app) { return admin.firestore(app); };
    }

    const enEmulador = !!process.env.FIRESTORE_EMULATOR_HOST;
    const proyecto   = process.env.GOOGLE_CLOUD_PROJECT
                    || process.env.GCLOUD_PROJECT
                    || 'gestor-de-inventarios-76c19';

    if (!enEmulador && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.error('\n  Falta GOOGLE_APPLICATION_CREDENTIALS (clave de cuenta de servicio).');
        console.error('  Contra el emulador, usa FIRESTORE_EMULATOR_HOST en su lugar.\n');
        process.exit(1);
    }

    const app = initializeApp(
        enEmulador ? { projectId: proyecto }
                   : { credential: applicationDefault(), projectId: proyecto }
    );
    const db = getFirestore(app);

    const inicio = Date.now();
    const cuenta = { documentos: 0, colecciones: 0 };

    const respaldo = {
        __version:   1,
        __generado:  new Date().toISOString(),
        __proyecto:  proyecto,
        __emulador:  enEmulador,
        __docPrincipal: DOC_PRINCIPAL,
        inventarioApp: null,
        raiz: {}
    };

    console.log('  Copiando inventarioApp/' + DOC_PRINCIPAL + '…');
    respaldo.inventarioApp = await copiarDocumento(
        db.collection('inventarioApp').doc(DOC_PRINCIPAL), 0, cuenta);

    for (const nombre of COLECCIONES_RAIZ) {
        console.log('  Copiando ' + nombre + '…');
        respaldo.raiz[nombre] = await copiarColeccion(db.collection(nombre), 0, cuenta);
    }

    const dirSalida = argumento('salida', 'respaldos');
    fs.mkdirSync(dirSalida, { recursive: true });
    const sello   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archivo = path.join(dirSalida, 'respaldo-' + sello + '.json');
    fs.writeFileSync(archivo, JSON.stringify(respaldo, null, 1), 'utf8');

    const kb = Math.round(fs.statSync(archivo).size / 1024);
    console.log('\n  ✅ Respaldo escrito: ' + archivo);
    console.log('     ' + cuenta.documentos + ' documentos · ' + cuenta.colecciones +
                ' colecciones · ' + kb + ' KB · ' +
                ((Date.now() - inicio) / 1000).toFixed(1) + ' s\n');

    // Un respaldo vacío casi siempre significa credenciales del proyecto
    // equivocado, no una base de datos vacía. Falla ruidosamente: un
    // respaldo vacío que se guarda en silencio es peor que ninguno.
    if (cuenta.documentos === 0) {
        console.error('  ⚠️  No se copió ningún documento. ¿Proyecto o credenciales equivocados?\n');
        process.exit(2);
    }
    process.exit(0);
})().catch(function(e) {
    console.error('\n  ❌ Falló el respaldo:', e && e.message ? e.message : e, '\n');
    process.exit(1);
});
