#!/usr/bin/env node
/**
 * prueba-f1.js — F1: los tres defectos críticos de la auditoría
 * ═══════════════════════════════════════════════════════════════════════════
 * Estas pruebas no comprueban que el código "se vea bien": ejecutan la lógica
 * real extraída de los archivos que se publican, con los mismos datos que
 * causaron el problema.
 *
 *   Defecto 1 · El conteo regular nunca llegaba a Firestore porque
 *               syncConteoProductoAtomico usaba una variable `docRef` que no
 *               existe en su ámbito. Lanzaba ReferenceError antes de escribir.
 *
 *   Defecto 2 · Importar un Excel sin las columnas de capacidad y peso apagaba
 *               el conteo en onzas de productos que SÍ tenían esos datos, y eso
 *               reinterpretaba conteos ya capturados: 2 enteras + 33.45 oz
 *               pasaba de valer 2.86 botellas a valer 35.45.
 *
 *   Defecto 3 · El Excel de un inventario cerrado salía en ceros, sin nombres,
 *               y con las áreas de hoy en vez de las del inventario.
 *
 * La prueba de ejecución REAL contra Firestore (defecto 1 de punta a punta)
 * vive en pruebas/prueba-f1-integracion.js, que necesita el emulador.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok: !!ok, detalle: detalle || '' });
    if (!ok) fallos++;
}

const firestore = fs.readFileSync(path.join(RAIZ, 'js/40-firestore.js'), 'utf8');
const importa   = fs.readFileSync(path.join(RAIZ, 'js/90-ciclo-admin.js'), 'utf8');
const flujo     = fs.readFileSync(path.join(RAIZ, 'js/75-auditoria-flujo.js'), 'utf8');
const expor     = fs.readFileSync(path.join(RAIZ, 'js/95-exportacion.js'), 'utf8');
const roles     = fs.readFileSync(path.join(RAIZ, 'js/50-roles-permisos.js'), 'utf8');
const html      = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

// ══════════════════════════════════════════════════════════════════════════
//  DEFECTO 1 · docRef
// ══════════════════════════════════════════════════════════════════════════

// Lo que rompía: un identificador libre. Se comprueba que ya no queda ninguno
// suelto, es decir, que toda función que use docRef lo declare o lo reciba.
const usosDocRef = [...firestore.matchAll(/^[ \t]*(?:async )?function ([\w$]+)\(([^)]*)\)[^\n]*\{/gm)]
    .map(m => ({ nombre: m[1], args: m[2], desde: m.index }));

function cuerpoDeFuncion(src, desde) {
    // Recorte hasta la siguiente declaración de función al mismo nivel, sin
    // comentarios: los comentarios que quedan al final del recorte pertenecen
    // en realidad a la función siguiente, y varios de ellos nombran docRef
    // en prosa — contarlos daría un falso positivo.
    const sig = src.indexOf('\n        function ', desde + 10);
    const sigAsync = src.indexOf('\n        async function ', desde + 10);
    let fin = [sig, sigAsync].filter(i => i > 0).sort((a, b) => a - b)[0];
    if (fin === undefined) fin = src.length;
    return src.slice(desde, fin)
              .replace(/\/\*[\s\S]*?\*\//g, '')
              .replace(/\/\/[^\n]*/g, '');
}

let funcionesConDocRefLibre = [];
usosDocRef.forEach(f => {
    const cuerpo = cuerpoDeFuncion(firestore, f.desde);
    if (!/\bdocRef\b/.test(cuerpo)) return;
    const loDeclara = /(?:const|let|var)\s+docRef\s*=/.test(cuerpo);
    const loRecibe  = /\bdocRef\b/.test(f.args);
    if (!loDeclara && !loRecibe) funcionesConDocRefLibre.push(f.nombre);
});

chk('Ninguna función usa docRef sin declararlo ni recibirlo',
    funcionesConDocRefLibre.length === 0,
    'quedan libres: ' + funcionesConDocRefLibre.join(', '));

chk('Existe el ayudante _docPrincipal', /function _docPrincipal\(\)/.test(firestore));
chk('_docPrincipal devuelve null sin base de datos',
    /function _docPrincipal\(\)\s*\{\s*\n\s*if \(!_db\) return null;/.test(firestore));
chk('_leerConteoProducto lo usa',
    /async function _leerConteoProducto\(productId, area\)\s*\{\s*\n\s*const docRef = _docPrincipal\(\);/.test(firestore));
// D — esta comprobación exigía que `const docRef = _docPrincipal();` fuera
// literalmente la PRIMERA línea de la función. La etapa D antepone
// _outboxAnotar(), que anota el conteo como pendiente antes de cualquier
// intento de subida. Lo que F1 defiende —que docRef salga de _docPrincipal()
// y no de una variable libre— sigue intacto, y la comprobación de arriba
// ('Ninguna función usa docRef sin declararlo ni recibirlo') lo garantiza
// para todas las funciones. Aquí se pasa a comprobar la sustancia en vez de
// la posición de la línea.
chk('syncConteoProductoAtomico lo usa',
    /async function syncConteoProductoAtomico\([^)]*\)\s*\{[\s\S]{0,600}?const docRef = _docPrincipal\(\);/.test(firestore));
chk('migrarStockAreasAProductos lo usa',
    /async function migrarStockAreasAProductos\(\)\s*\{\s*\n\s*const docRef = _docPrincipal\(\);/.test(firestore));

// La ruta del inventario físico NO se tocó: sigue escribiendo en userAuditoria.
chk('La ruta userAuditoria del inventario físico sigue intacta',
    /userAuditoria/.test(firestore) &&
    !/_docPrincipal\(\)[\s\S]{0,200}userAuditoria/.test(firestore),
    'F1 no debía tocar el conteo del inventario físico');

// Ejecución real de la función, con una base de datos simulada que registra
// en qué ruta se escribió. Esto es lo que antes lanzaba ReferenceError.
(function ejecutarSyncConteo() {
    const escrituras = [];
    const lecturas   = [];
    function colec(ruta) {
        return {
            doc: function(id) {
                const r = ruta + '/' + id;
                return {
                    collection: function(sub) { return colec(r + '/' + sub); },
                    get: async function() { lecturas.push(r); return { exists: false }; },
                    set: async function(datos) { escrituras.push({ ruta: r, datos: datos }); }
                };
            }
        };
    }

    const ctx = {
        console: { warn() {}, error() {}, info() {}, log() {} },
        navigator: { onLine: true },
        setTimeout, clearTimeout,
        _db: { collection: colec },
        FIRESTORE_DOC_ID: 'barra-principal',
        currentUserUid: 'uid-prueba',
        currentUser: { email: 'prueba@local' },
        _deviceId: 'disp-1',
        showNotification() {}, updateCloudSyncBadge() {}, saveToLocalStorage() {},
        _registrarEnSyncQueue() {}, isAdmin: () => true,
        AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    };
    ctx.window = ctx; ctx.globalThis = ctx; ctx._auth = null;
    vm.createContext(ctx);
    try { vm.runInContext(firestore, ctx); } catch (e) { /* IIFEs no relacionadas */ }

    chk('syncConteoProductoAtomico quedó definida',
        typeof ctx.syncConteoProductoAtomico === 'function');

    if (typeof ctx.syncConteoProductoAtomico === 'function') {
        let resultado = null, excepcion = null;
        const p = ctx.syncConteoProductoAtomico('PRD-001', 'almacen', 2, [33.45])
            .then(r => { resultado = r; })
            .catch(e => { excepcion = e; });

        // La prueba es síncrona: se resuelve la promesa antes de seguir.
        require('node:timers/promises').setImmediate().then(() => {});
        return p.then(() => {
            chk('Ya NO lanza ReferenceError',
                !(excepcion instanceof ReferenceError),
                excepcion ? String(excepcion.message) : '');
            chk('La llamada devuelve un resultado, no una excepción',
                resultado !== null && excepcion === null,
                excepcion ? String(excepcion && excepcion.message) : '');
            chk('Escribe exactamente un documento',
                escrituras.length === 1,
                'escrituras: ' + escrituras.length);
            chk('Lo escribe en la ruta del producto y el área',
                escrituras.length === 1 &&
                escrituras[0].ruta === 'inventarioApp/barra-principal/stockAreas/almacen/productos/PRD-001',
                escrituras.length ? escrituras[0].ruta : 'ninguna');
            chk('Guarda las enteras y las abiertas capturadas',
                escrituras.length === 1 &&
                escrituras[0].datos.enteras === 2 &&
                Array.isArray(escrituras[0].datos.abiertas) &&
                escrituras[0].datos.abiertas[0] === 33.45);
            chk('Guarda version 1 en el primer conteo',
                escrituras.length === 1 && escrituras[0].datos.version === 1,
                escrituras.length ? String(escrituras[0].datos.version) : '');
            chk('Devuelve ok:true', resultado && resultado.ok === true,
                resultado ? JSON.stringify(resultado) : 'sin resultado');
        });
    }
    return Promise.resolve();
})().then(seguir);

// ══════════════════════════════════════════════════════════════════════════
//  DEFECTO 2 y 3 · se ejecutan después de la promesa del defecto 1
// ══════════════════════════════════════════════════════════════════════════
function seguir() {

// ── Defecto 2 · la importación no puede reinterpretar lo contado ──────────
chk('La decisión del modo ya no se toma al leer la fila',
    !/if \(capacidadMl === null \|\| pesoBotellaLlenaOz === null\) \{\s*\n\s*product\.conteoOzHabilitado = false;/.test(importa),
    'esa era la línea que apagaba el conteo en oz');
chk('Existe _resolverConteoOz', /function _resolverConteoOz\(delExcel, existente\)/.test(importa));
chk('La fila solo guarda el valor crudo de la columna',
    /product\._ozCrudo = findCol\(row, columnMap\.conteoOz\);/.test(importa));
chk('El modo se decide en el merge, que sí conoce el producto existente',
    /prod\.conteoOzHabilitado = _resolverConteoOz\(prod, actual\);/.test(importa));
chk('El dato de trabajo no se guarda en el catálogo',
    /delete prod\._ozCrudo;/.test(importa));
chk('stockByArea sigue siendo intocable en una actualización',
    /if \(campo === 'stockByArea'\) return;/.test(importa));

// Se ejecuta la función real contra los casos que importan.
const ctxImp = { console };
vm.createContext(ctxImp);
const mImp = /function _resolverConteoOz\([\s\S]*?\n        \}/.exec(importa);
chk('_resolverConteoOz se pudo aislar para ejecutarla', !!mImp);
if (mImp) {
    vm.runInContext(mImp[0] + '\n;this.f = _resolverConteoOz;', ctxImp);
    const f = ctxImp.f;

    const EXISTENTE_OZ = { id: 'P1', capacidadMl: 750, pesoBotellaLlenaOz: 44.65, conteoOzHabilitado: true };

    // EL CASO DE LALO: producto con capacidad y peso ya configurados; el Excel
    // original NO trae esas columnas ni la de ConteoOz.
    chk('CASO CLAVE · el Excel original no apaga el conteo en oz',
        f({ id: 'P1' }, EXISTENTE_OZ) === true,
        'devolvió ' + f({ id: 'P1' }, EXISTENTE_OZ));

    chk('Un producto que contaba por cantidad sigue igual',
        f({ id: 'P1' }, { capacidadMl: 750, pesoBotellaLlenaOz: 44.65, conteoOzHabilitado: false }) === false);
    chk('Sin capacidad ni peso en ningún lado, se cuenta por cantidad',
        f({ id: 'P1' }, { conteoOzHabilitado: true }) === false,
        'sin los dos datos no hay conversión posible');
    chk('El Excel puede APAGARLO explícitamente con la columna',
        f({ id: 'P1', _ozCrudo: 'NO' }, EXISTENTE_OZ) === false);
    chk('…y encenderlo explícitamente',
        f({ id: 'P1', _ozCrudo: 'SI' }, { capacidadMl: 750, pesoBotellaLlenaOz: 44.65, conteoOzHabilitado: false }) === true);
    chk('Una columna vacía no cuenta como "no"',
        f({ id: 'P1', _ozCrudo: '   ' }, EXISTENTE_OZ) === true);
    chk('El Excel puede APORTAR la capacidad y el peso que faltaban',
        f({ id: 'P1', capacidadMl: 750, pesoBotellaLlenaOz: 44.65 }, { conteoOzHabilitado: false }) === false,
        'aporta los datos, pero respeta el modo que ya tenía');
    chk('Alta nueva con capacidad y peso arranca en oz',
        f({ id: 'NUEVO', capacidadMl: 750, pesoBotellaLlenaOz: 44.65 }, null) === true);
    chk('Alta nueva sin esos datos arranca por cantidad',
        f({ id: 'NUEVO' }, null) === false);
    chk('Una capacidad de 0 no habilita nada',
        f({ id: 'P1', capacidadMl: 0 }, { pesoBotellaLlenaOz: 44.65, conteoOzHabilitado: true }) === false);

    // El efecto que de verdad importa: el total calculado no puede moverse.
    // Se usa la conversión real de la app.
    const conv = fs.readFileSync(path.join(RAIZ, 'js/70-conversion-render.js'), 'utf8');
    const mConv = /function convertirOzAPuntos\([\s\S]*?\n        \}/.exec(conv);
    chk('convertirOzAPuntos se pudo aislar', !!mConv);
    if (mConv) {
        const ctxC = { console };
        vm.createContext(ctxC);
        vm.runInContext(mConv[0] + '\n;this.conv = convertirOzAPuntos;', ctxC);

        // Firma real: (pesoActualOz, capacidadMl, pesoBotellaLlenaOz).
        const CAP = 750, PESO = 44.65, OZ_ABIERTA = 33.45;
        const antes = 2 + ctxC.conv(OZ_ABIERTA, CAP, PESO);
        // Tras la importación el producto conserva capacidad, peso y modo:
        const modoTrasImportar = f({ id: 'P1' }, EXISTENTE_OZ);
        const despues = modoTrasImportar
                        ? (2 + ctxC.conv(OZ_ABIERTA, CAP, PESO))
                        : (2 + OZ_ABIERTA);

        chk('CASO CLAVE · 2 enteras + 33.45 oz vale lo mismo antes y después',
            Math.abs(antes - despues) < 1e-9,
            'antes ' + antes.toFixed(4) + ' · después ' + despues.toFixed(4));
        chk('…y ese valor NO es la suma cruda 35.45',
            Math.abs(despues - 35.45) > 0.5,
            'salió ' + despues.toFixed(4) + ' (la suma cruda era el síntoma del bug)');
    }
}

// ── Defecto 3 · la exportación del inventario cerrado ─────────────────────
chk('El snapshot ya guarda el nombre real del producto',
    /nombre: p\.name \|\| p\.nombre \|\| ''/.test(flujo) && /name:\s+p\.name \|\| p\.nombre \|\| ''/.test(flujo),
    'antes leía p.nombre, que en un producto del catálogo no existe');
chk('El snapshot guarda también la unidad y el grupo',
    /unit:\s+p\.unit \|\| ''/.test(flujo) && /group:\s+p\.group \|\| p\.grupo/.test(flujo));
chk('Ya no se entrega stockByArea como si fuera el conteo',
    !/conteoData\[p\.id\] = p\.stockByArea \|\| \{\};/.test(flujo),
    'stockByArea es un número por área, no {enteras, abiertas}');
chk('El conteo se reconstruye de los registros de usuario congelados',
    /_consolidarConteoCongelado\(usuariosCongelados, areasHistoricas/.test(flujo));
chk('Existe el consolidador', /function _consolidarConteoCongelado\(usuarios, areas, productos\)/.test(flujo));
chk('La exportación usa las áreas del inventario, no las de hoy',
    /meta\.warehousesSnapshot/.test(flujo) &&
    /exportToExcelConDatos\('completo', conteoData, productosCongelados, nombreArchivo,\s*\n\s*areasHistoricas\)/.test(flujo));
chk('El generador acepta áreas históricas como parámetro opcional',
    /function exportToExcel\(modo, fileNameOverride, areasOverride\)/.test(expor));
chk('Sin ese parámetro se comporta igual que siempre',
    /\(Array\.isArray\(areasOverride\) && areasOverride\.length\)\s*\n\s*\? areasOverride\.slice\(\)\s*\n\s*: AREAS_CONTEO/.test(expor));
chk('exportToExcelConDatos lo pasa a través',
    /function exportToExcelConDatos\(modo, conteoData, productsList, fileName, areasOverride\)/.test(roles) &&
    /exportToExcel\(modo, fileName, areasOverride\);/.test(roles));
chk('El máximo de abiertas se calcula sobre las áreas reales',
    /const maxAbiertas = \{\};\s*\n\s*areaKeys\.forEach\(function\(a\) \{ maxAbiertas\[a\] = 1; \}\);/.test(expor),
    'antes eran las tres fijas: una cuarta área comparaba contra undefined');
chk('Un área fuera de las tres de sistema recibe nombre y color',
    /if \(!areaNames\[a\]\)/.test(expor) && /if \(!areaColor\[a\]\) areaColor\[a\] = '64748B';/.test(expor));
chk('La exportación no escribe nada: solo lee el snapshot',
    !/exportarInventarioCerrado[\s\S]{0,3000}?\.(set|update|delete)\(/.test(flujo),
    'el snapshot tiene que seguir siendo inmutable');

// Ejecución real del consolidador con datos como los que congela el cierre.
const mCons = /function _consolidarConteoCongelado\([\s\S]*?\n        \}\r?\n/.exec(flujo);
chk('_consolidarConteoCongelado se pudo aislar', !!mCons);
if (mCons) {
    const ctxX = { console };
    vm.createContext(ctxX);
    vm.runInContext(mCons[0] + '\n;this.g = _consolidarConteoCongelado;', ctxX);
    const g = ctxX.g;

    const USUARIOS = [
        { tipo: 'usuario', uid: 'bart1', isAdmin: false, updatedAt: 100,
          conteo: { P1: { almacen: { enteras: 2, abiertas: [33.45], _ts: 100 } } } },
        { tipo: 'usuario', uid: 'bart2', isAdmin: false, updatedAt: 300,
          conteo: { P1: { almacen: { enteras: 5, abiertas: [], _ts: 300 } } } },
    ];
    const PRODUCTOS = [{ id: 'P1' }, { id: 'P2' }];
    const AREAS = ['almacen', 'barra1', 'barra2'];

    const r1 = g(USUARIOS, AREAS, PRODUCTOS);
    chk('Devuelve la forma {enteras, abiertas} que el Excel espera',
        r1.P1 && r1.P1.almacen && typeof r1.P1.almacen.enteras === 'number' &&
        Array.isArray(r1.P1.almacen.abiertas));
    chk('Entre dos bartenders gana el conteo más reciente',
        r1.P1.almacen.enteras === 5, 'salió ' + JSON.stringify(r1.P1.almacen));

    const CON_ADMIN = USUARIOS.concat([
        { tipo: 'usuario', uid: 'jefe', isAdmin: true, updatedAt: 50,
          conteo: { P1: { almacen: { enteras: 3, abiertas: [10.5], _ts: 50 } } } }
    ]);
    const r2 = g(CON_ADMIN, AREAS, PRODUCTOS);
    chk('El conteo del admin manda aunque sea más antiguo',
        r2.P1.almacen.enteras === 3 && r2.P1.almacen.abiertas[0] === 10.5,
        'salió ' + JSON.stringify(r2.P1.almacen));

    chk('Un producto que nadie contó sale en cero, no ausente',
        r1.P2 && r1.P2.almacen && r1.P2.almacen.enteras === 0);
    chk('Un área sin conteo sale en cero',
        r1.P1.barra2 && r1.P1.barra2.enteras === 0);

    const r3 = g(USUARIOS, ['almacen', 'barra1', 'barra2', 'cava'], PRODUCTOS);
    chk('Respeta las áreas que se le pasan, incluida una que ya no exista hoy',
        r3.P1.cava && r3.P1.cava.enteras === 0);
    chk('No inventa áreas que no estaban en el inventario',
        g(USUARIOS, ['almacen'], PRODUCTOS).P1.barra1 === undefined);

    chk('No modifica los registros congelados que recibe',
        USUARIOS[0].conteo.P1.almacen.enteras === 2 &&
        USUARIOS[1].conteo.P1.almacen.enteras === 5,
        'el snapshot es inmutable también en memoria');
}

// ── Caché ─────────────────────────────────────────────────────────────────
const vTags = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
chk('F1 subió la versión de caché por encima de 3.3',
    vTags.length === 1 && parseFloat(vTags[0]) > 3.3,
    'versiones encontradas: ' + vTags.join(', '));

// ── Alcance: F1 no debía tocar nada más ───────────────────────────────────
const reglas = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
// D cambió reglas (cerrar las colecciones abiertas), cosa que F1 tenía
// prohibida. Lo que estas dos comprobaciones protegen de verdad no es que el
// archivo esté intacto, sino que sigan en pie las dos garantías que F1 dejó:
// un inventario CERRADO no se puede modificar ni siquiera siendo admin, y el
// historial de cambios sigue teniendo su propia regla. Se renombra para que
// diga lo que comprueba.
chk('Las garantías de reglas que dejó F1 siguen en pie',
    /allow update: if isAdminUser\(\) && resource\.data\.estado != 'CERRADO';/.test(reglas) &&
    /match \/historialCambios\/\{docId\}/.test(reglas),
    'se perdió el bloqueo del inventario cerrado o la regla del historial');
// FASE 2 — esta comprobación afirmaba que Subjefe y Bartender seguían
// teniendo permisos IDÉNTICOS, porque en su momento cambiarlos estaba fuera
// de alcance. La FASE 2 los diferenció con autorización expresa del
// propietario, así que la guarda se reorienta: lo que ahora hay que vigilar
// no es que nadie los toque, sino que nadie le regale a un bartender la
// capacidad de ver el conteo de sus compañeros.
chk('Un Bartender no recibe por defecto ver los conteos de otros',
    !/BARTENDER:\s*\{[\s\S]{0,400}?'inventory\.viewAll'/.test(roles),
    'sería romper el conteo ciego por configuración de fábrica');

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── F1 · los tres defectos críticos ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');

process.exit(fallos ? 1 : 0);
}
