#!/usr/bin/env node
/**
 * reiniciar-inventarios.js — borra TODOS los inventarios y vuelve a empezar
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedido del propietario (30/09/2026): "borra todos los inventarios que se han
 * creado y volvemos a empezar de nuevo", incluyendo el stock inicial semanal,
 * las ventas importadas y las existencias operativas.
 *
 * POR QUÉ UN SCRIPT Y NO UN BOTÓN
 *   Las reglas de Firestore prohíben borrar inventarios desde la app
 *   (allow delete: if false). Es deliberado: un botón así, en un teléfono de
 *   barra, es un accidente esperando a ocurrir. Este script corre en la
 *   laptop con la clave de administrador del proyecto (Admin SDK), que es la
 *   única que salta las reglas.
 *
 * TRES PASOS, EN ESTE ORDEN
 *   1. SIMULAR (por defecto, sin argumentos): cuenta lo que borraría. No toca nada.
 *   2. --ejecutar: saca un RESPALDO completo (herramientas/respaldo-firestore.js).
 *      Si el respaldo falla o sale vacío, NO borra nada.
 *   3. Pide escribir BORRAR para confirmar, borra, y verifica que quedó en cero.
 *
 * QUÉ BORRA (bajo inventarioApp/{DOC_PRINCIPAL})
 *   inventories (+ snapshotChunks)    inventarios físicos y sus cierres
 *   userAuditoria, conteoMultiUsuario conteos del inventario físico
 *   reconteos, conteosAuditoriaHuerfanos
 *   contadores/inventarios            folio: el siguiente vuelve a ser #1001
 *   inventariosIniciales              stock inicial semanal (contabilizados)
 *   ventas                            periodos de ventas importados
 *   stockAreas (+ productos)          existencias operativas por área
 *   y en el documento raíz: el conteo agregado, el estado de las áreas y la
 *   existencia (stockByArea) de cada producto, también en el catálogo publicado.
 *
 * QUÉ NO TOCA
 *   Catálogo de productos (nombres, precios, conversiones), recetario,
 *   compras, movimientos, costos, usuarios, roles, reportes publicados y las
 *   bitácoras de cambios (cambios, historialCambios, conflictos).
 *
 * CÓMO SABEN LOS TELÉFONOS QUE HUBO UN REINICIO
 *   El documento raíz recibe _reinicioInventariosEn (fecha) y una sesión nueva
 *   sin inventario. La app 4.20+ lo detecta al abrir y vacía su copia local
 *   (js/45 _aplicarReinicioSiCorresponde). Por eso la 4.20 se publica ANTES.
 *
 * USO
 *   Producción (Git Bash, en la raíz del repo):
 *     npm install --no-save firebase-admin
 *     export GOOGLE_APPLICATION_CREDENTIALS="/c/ruta/clave-servicio.json"
 *     node herramientas/reiniciar-inventarios.js              # 1) simular
 *     node herramientas/reiniciar-inventarios.js --ejecutar   # 2) respaldar + 3) confirmar y borrar
 *
 *   Emulador (pruebas): FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
 *     GOOGLE_CLOUD_PROJECT=demo-barinventory node herramientas/reiniciar-inventarios.js --ejecutar --si
 *   (--si salta la pregunta: SOLO para pruebas automáticas.)
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const DOC_PRINCIPAL = process.env.DOC_PRINCIPAL || 'barra-principal';
const SUBCOLECCIONES = [
    { nombre: 'inventories',               que: 'Inventarios físicos (y sus cierres congelados)' },
    { nombre: 'userAuditoria',             que: 'Conteos por persona del inventario físico' },
    { nombre: 'conteoMultiUsuario',        que: 'Conteos por dispositivo del inventario físico' },
    { nombre: 'reconteos',                 que: 'Reconteos' },
    { nombre: 'conteosAuditoriaHuerfanos', que: 'Conteos huérfanos archivados' },
    { nombre: 'inventariosIniciales',      que: 'Stock inicial semanal (contabilizados)' },
    { nombre: 'ventas',                    que: 'Periodos de ventas importados' },
    { nombre: 'stockAreas',                que: 'Existencias operativas por área' }
];
const tiene = (flag) => process.argv.indexOf('--' + flag) !== -1;

async function contarProfundo(ref) {
    // ref: CollectionReference. listDocuments() incluye documentos "fantasma"
    // (sin datos pero con subcolecciones), como stockAreas/barra1.
    let n = 0;
    const docs = await ref.listDocuments();
    for (const d of docs) {
        const snap = await d.get();
        if (snap.exists) n++;
        for (const sub of await d.listCollections()) n += await contarProfundo(sub);
    }
    return n;
}

async function borrarProfundo(db, ref) {
    if (typeof db.recursiveDelete === 'function') { await db.recursiveDelete(ref); return; }
    const docs = await ref.listDocuments();
    for (const d of docs) {
        for (const sub of await d.listCollections()) await borrarProfundo(db, sub);
        await d.delete();
    }
}

async function inventario(db) {
    const raiz = db.collection('inventarioApp').doc(DOC_PRINCIPAL);
    const r = { raiz: raiz, filas: [], total: 0 };
    for (const s of SUBCOLECCIONES) {
        const n = await contarProfundo(raiz.collection(s.nombre));
        r.filas.push({ nombre: s.nombre, que: s.que, n: n });
        r.total += n;
    }
    const cont = await raiz.collection('contadores').doc('inventarios').get();
    r.folio = cont.exists ? (cont.data() || {}).ultimoNumero : null;
    const snapRaiz = await raiz.get();
    r.datosRaiz = snapRaiz.exists ? (snapRaiz.data() || {}) : null;
    const cat = await db.collection('catalogo').doc('productos').get();
    r.catalogo = cat.exists ? (cat.data() || {}) : null;
    return r;
}

// Existencias en cero, conservando la forma (las mismas áreas).
function productosEnCero(lista, areas) {
    return (Array.isArray(lista) ? lista : []).map(function(p) {
        if (!p || typeof p !== 'object') return p;
        const cero = {};
        Object.keys(p.stockByArea || {}).concat(areas).forEach(function(a) { cero[a] = 0; });
        return Object.assign({}, p, { stockByArea: cero });
    });
}
function idsDeAreas(datosRaiz) {
    const def = (datosRaiz && Array.isArray(datosRaiz.areasConteo)) ? datosRaiz.areasConteo : [];
    const ids = def.map(function(a) { return typeof a === 'string' ? a : (a && (a.id || a.clave)); }).filter(Boolean);
    return ids.length ? ids : ['almacen', 'barra1', 'barra2'];
}

function imprimir(r, titulo) {
    console.log('\n  ' + titulo);
    console.log('  ' + '─'.repeat(72));
    r.filas.forEach(function(f) {
        console.log('  ' + String(f.n).padStart(6) + '  ' + f.que.padEnd(48) + ' (' + f.nombre + ')');
    });
    console.log('  ' + '─'.repeat(72));
    console.log('  ' + String(r.total).padStart(6) + '  documentos en total');
    console.log('         Folio actual: ' + (r.folio === null ? '(sin contador)' : '#' + r.folio) + ' → el siguiente será #1001');
    const prods = r.datosRaiz && Array.isArray(r.datosRaiz.products) ? r.datosRaiz.products.length : 0;
    console.log('         Existencias (stockByArea) a cero en ' + prods + ' producto(s) del documento raíz'
        + (r.catalogo && Array.isArray(r.catalogo.productos) ? ' y ' + r.catalogo.productos.length + ' del catálogo publicado' : ''));
    console.log('         Sesión de inventario actual: ' + ((r.datosRaiz && r.datosRaiz._auditoriaSessionId) || '(ninguna)') + ' → nueva, sin inventario\n');
}

function preguntar(texto) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(function(res) { rl.question(texto, function(r) { rl.close(); res(String(r || '').trim()); }); });
}

(async function principal() {
    let initializeApp, applicationDefault, getFirestore, FieldValue;
    try {
        ({ initializeApp, applicationDefault } = require('firebase-admin/app'));
        ({ getFirestore, FieldValue } = require('firebase-admin/firestore'));
    } catch (_) {
        let admin;
        try { admin = require('firebase-admin'); }
        catch (e) {
            console.error('\n  Falta firebase-admin. Instálalo con:  npm install --no-save firebase-admin\n');
            process.exit(1);
        }
        initializeApp = admin.initializeApp; applicationDefault = admin.credential.applicationDefault;
        getFirestore = function(app) { return admin.firestore(app); }; FieldValue = admin.firestore.FieldValue;
    }

    const enEmulador = !!process.env.FIRESTORE_EMULATOR_HOST;
    const proyecto = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'gestor-de-inventarios-76c19';
    if (!enEmulador && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.error('\n  Falta GOOGLE_APPLICATION_CREDENTIALS (ruta a la clave de cuenta de servicio).');
        console.error('  Consola de Firebase → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada.\n');
        process.exit(1);
    }
    const app = initializeApp(enEmulador ? { projectId: proyecto } : { credential: applicationDefault(), projectId: proyecto });
    const db = getFirestore(app);

    console.log('\n  Proyecto: ' + proyecto + (enEmulador ? '  (EMULADOR)' : '  (PRODUCCIÓN)') + ' · documento: inventarioApp/' + DOC_PRINCIPAL);
    const antes = await inventario(db);
    if (!antes.datosRaiz) {
        console.error('\n  ❌ No existe inventarioApp/' + DOC_PRINCIPAL + '. ¿Proyecto o credenciales equivocados? No se hizo nada.\n');
        process.exit(2);
    }

    if (!tiene('ejecutar')) {
        imprimir(antes, 'SIMULACIÓN — esto es lo que se BORRARÍA (no se tocó nada):');
        console.log('  Catálogo, recetario, compras, usuarios y roles NO se tocan.');
        console.log('  Para hacerlo de verdad:  node herramientas/reiniciar-inventarios.js --ejecutar\n');
        process.exit(0);
    }

    imprimir(antes, 'SE VA A BORRAR:');

    // ── Respaldo obligatorio ─────────────────────────────────────────────
    const dirResp = path.resolve(process.env.DIR_RESPALDOS || 'respaldos');
    const previos = fs.existsSync(dirResp) ? new Set(fs.readdirSync(dirResp)) : new Set();
    console.log('  1/3 · Respaldo completo antes de borrar…');
    const r = spawnSync(process.execPath, [path.join(__dirname, 'respaldo-firestore.js'), '--salida', dirResp],
                        { stdio: 'inherit', env: process.env });
    const nuevos = fs.existsSync(dirResp) ? fs.readdirSync(dirResp).filter(function(f) { return !previos.has(f) && /^respaldo-.*\.json$/.test(f); }) : [];
    if (r.status !== 0 || nuevos.length === 0) {
        console.error('\n  ❌ El respaldo falló (código ' + r.status + '). NO se borró nada.\n');
        process.exit(3);
    }
    const archivoResp = path.join(dirResp, nuevos.sort().pop());
    let respaldo;
    try { respaldo = JSON.parse(fs.readFileSync(archivoResp, 'utf8')); } catch (e) { respaldo = null; }
    if (!respaldo || !respaldo.inventarioApp || respaldo.__docPrincipal !== DOC_PRINCIPAL) {
        console.error('\n  ❌ El respaldo no se pudo verificar (' + archivoResp + '). NO se borró nada.\n');
        process.exit(3);
    }
    console.log('  ✅ Respaldo verificado: ' + archivoResp + '\n     Guárdalo: es la ÚNICA forma de recuperar lo que se borra.\n');

    // ── Confirmación ─────────────────────────────────────────────────────
    if (!tiene('si')) {
        const resp = await preguntar('  2/3 · Escribe BORRAR (en mayúsculas) para confirmar, o Enter para cancelar: ');
        if (resp !== 'BORRAR') { console.log('\n  Cancelado. No se borró nada.\n'); process.exit(0); }
    }

    // ── Borrado ──────────────────────────────────────────────────────────
    console.log('\n  3/3 · Borrando…');
    const raiz = antes.raiz;
    for (const s of SUBCOLECCIONES) {
        await borrarProfundo(db, raiz.collection(s.nombre));
        console.log('     ✓ ' + s.nombre);
    }
    await raiz.collection('contadores').doc('inventarios').delete();
    console.log('     ✓ contadores/inventarios (folio)');

    const ahora = Date.now();
    const areas = idsDeAreas(antes.datosRaiz);
    const estadoAreas = {};
    areas.forEach(function(a) { estadoAreas[a] = 'pendiente'; });
    const cambiosRaiz = {
        // Sesión nueva SIN inventario: cada teléfono la adopta y reinicia sus
        // conteos del inventario físico por el camino normal; la app ofrece
        // "Crear Inventario Físico" y el primero será #1001.
        _auditoriaSessionId:         String(ahora),
        _auditoriaStartedBy:         'reinicio-inventarios',
        _auditoriaStartedByDeviceId: 'reinicio-inventarios',
        _auditoriaStartedAt:         ahora,
        auditoriaStatus:             estadoAreas,
        auditoriaConteo:             {},
        inventarioConteo:            FieldValue.delete(),
        _reinicioInventariosEn:      ahora,
        _lastModified:               ahora,
        _lastWrittenBy:              'reinicio-inventarios',
        _lastWrittenRole:            'admin'
    };
    if (Array.isArray(antes.datosRaiz.products)) cambiosRaiz.products = productosEnCero(antes.datosRaiz.products, areas);
    await raiz.update(cambiosRaiz);
    console.log('     ✓ documento raíz (sesión nueva, estados y existencias en cero)');
    if (antes.catalogo && Array.isArray(antes.catalogo.productos)) {
        await db.collection('catalogo').doc('productos').update({
            productos: productosEnCero(antes.catalogo.productos, areas),
            version: ahora, publicadoEn: ahora
        });
        console.log('     ✓ catálogo publicado (existencias en cero; nombres y precios intactos)');
    }

    // ── Verificación ─────────────────────────────────────────────────────
    const despues = await inventario(db);
    imprimir(despues, 'DESPUÉS DEL REINICIO:');
    const bitacora = path.join(dirResp, 'reinicio-' + new Date(ahora).toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json');
    fs.writeFileSync(bitacora, JSON.stringify({ fecha: new Date(ahora).toISOString(), proyecto: proyecto, respaldo: archivoResp,
        borrado: antes.filas, folioAnterior: antes.folio, sesionAnterior: antes.datosRaiz._auditoriaSessionId || null }, null, 1));
    if (despues.total !== 0) {
        console.error('  ⚠️  Quedaron ' + despues.total + ' documento(s). Vuelve a ejecutar el script; el respaldo ya está guardado.\n');
        process.exit(4);
    }
    console.log('  ✅ Reinicio completo. Bitácora: ' + bitacora);
    console.log('     Abre la app (4.20) en cada teléfono y en la laptop: se pondrá en cero sola.\n');
    process.exit(0);
})().catch(function(e) { console.error('\n  ❌ Error:', e && e.message ? e.message : e, '\n'); process.exit(1); });
