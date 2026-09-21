// ═══════════════════════════════════════════════════════════════════════════
//  prueba-d.js — ETAPA D · Sincronización y defectos críticos
//
//  Comprueba, sobre el código real y ejecutando la lógica donde se puede:
//
//   D1 · El conteo hecho sin señal queda anotado y se reintenta al volver,
//        sin pisar el conteo de otro.
//   D2 · "Eliminar todo el catálogo" borra de verdad, también las dos copias
//        de la nube, y con más de 300 productos.
//   D3 · Las colecciones que estaban abiertas ya no permiten que cualquiera
//        borre el conteo de todos.
//   D4 · Finalizar un área deja constancia de quién y cuándo.
//   D5 · Reabrir un área es una sola puerta, con permiso y con rastro, y
//        reabre de verdad para el bartender.
//
//  No usa red ni emulador: eso lo cubre prueba-d-integracion.js.
// ═══════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

const firestore   = leer('js/40-firestore.js');
const persistencia = leer('js/20-persistencia.js');
const invDatos    = leer('js/45-inventario-datos.js');
const roles       = leer('js/50-roles-permisos.js');
const arranque    = leer('js/60-arranque.js');
const render      = leer('js/70-conversion-render.js');
const flujo       = leer('js/75-auditoria-flujo.js');
const ui          = leer('js/85-ui-inventario-fisico.js');
const multi       = leer('js/10-multiusuario.js');
const reglas      = leer('firestore.rules');
const html        = leer('index.html');

const casos = [];
let fallos = 0;
function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok: !!ok, detalle: detalle || '' });
    if (!ok) fallos++;
}

// ───────────────────────────────────────────────────────────────────────────
//  D1 · EL CONTEO SIN SEÑAL
// ───────────────────────────────────────────────────────────────────────────

chk('Existe el registro de conteos pendientes',
    /let _outboxConteo = \{\}/.test(firestore) &&
    /const _OUTBOX_CONTEO_KEY = 'inventarioApp_conteoPendiente'/.test(firestore));

chk('El pendiente se anota ANTES de intentar subir',
    /_outboxAnotar\(productId, area\);[\s\S]{0,400}?const docRef = _docPrincipal\(\);/.test(firestore),
    'si se anota después, un corte a mitad deja el conteo sin rastro');

chk('Sin señal el conteo queda pendiente en vez de descartarse',
    /if \(!navigator\.onLine\) \{[\s\S]{0,300}?motivo: 'offline'/.test(firestore));

chk('La clave sale de pendientes SOLO cuando el servidor confirma',
    /_versionesConteoProducto\[clave\] = nuevaVersion;[\s\S]{0,300}?_outboxQuitar\(productId, area\);[\s\S]{0,120}?return \{ ok: true/.test(firestore));

chk('El pendiente recuerda la versión que esperaba',
    /_outboxConteo\[clave\] = \{ ts: Date\.now\(\), base: base \}/.test(firestore),
    'sin la versión base, el reintento pisaría el conteo de otro');

chk('Un fallo de red ya no se confunde con un conflicto de versión',
    /function _esErrorDeRed\(err\)/.test(firestore) &&
    /if \(_esErrorDeRed\(err\)\) \{[\s\S]{0,800}?motivo: 'offline'/.test(firestore));

chk('Un conflicto de versión SÍ sale de pendientes',
    /_outboxQuitar\(productId, area\);[\s\S]{0,200}?_registrarConflictoVersion/.test(firestore),
    'reintentarlo solo sobrescribiría el conteo del otro');

chk('Existe el drenaje de pendientes',
    /async function drenarConteosPendientes\(\)/.test(firestore));

chk('El drenaje compara contra la versión real del servidor',
    /const remoto\s*= await _leerConteoProducto\(pid, area\);[\s\S]{0,900}?const servidorIntacto = \(versionServidor === baseEsperada\)/.test(firestore));

chk('Si el servidor se movió, el reintento NO sube: registra conflicto',
    /if \(!servidorIntacto\) \{[\s\S]{0,900}?_registrarConflictoVersion\(pid, area/.test(firestore) &&
    /if \(!servidorIntacto\) \{[\s\S]{0,900}?continue;/.test(firestore));

chk('El drenaje descarta lo que ya no existe en local',
    /if \(!valor \|\| typeof valor\.enteras === 'undefined'\) \{[\s\S]{0,160}?delete _outboxConteo\[clave\];/.test(firestore));

chk('Se drena al volver la conexión',
    /drenarConteosPendientes\(\)/.test(roles) &&
    /loadFromCloud\(\)\.then\(function\(\) \{[\s\S]{0,500}?drenarConteosPendientes\(\)/.test(roles),
    'y después de loadFromCloud, no antes');

chk('Se drena al arrancar',
    /loadFromCloud\(\)[\s\S]{0,400}?drenarConteosPendientes\(\)/.test(arranque));

chk('Se drena en el sync periódico como red de seguridad',
    /_outboxPendientes\(\)\.length > 0\) \{[\s\S]{0,200}?drenarConteosPendientes\(\)/.test(arranque));

chk('Se recupera la lista al arrancar sin borrarla antes de reintentar',
    /const pendientes = _outboxCargar\(\);/.test(arranque) &&
    !/removeItem\('inventarioApp_conteoProductoPendiente'\)[\s\S]{0,200}?syncConteoProductoAtomico/.test(arranque),
    'la versión anterior borraba la lista y luego reintentaba: si fallaba, se perdía');

chk('Se migra lo que dejó anotado la versión anterior',
    /_OUTBOX_CONTEO_KEY_LEGACY = 'inventarioApp_conteoProductoPendiente'/.test(firestore));

chk('Al reconectar ya NO se reemplaza el conteo entero',
    !/\n\s*inventarioConteo = migrated;/.test(invDatos) &&
    /inventarioConteo = _preservarConteosPendientes\(migrated, inventarioConteo\)/.test(invDatos));

chk('Solo se preserva lo pendiente, no todo lo local',
    /function _preservarConteosPendientes\(deLaNube, local\)/.test(invDatos) &&
    /const pendientes = _outboxPendientes\(\);/.test(invDatos));

chk('Sin outbox disponible se comporta como antes (gana la nube)',
    /if \(typeof _outboxPendientes !== 'function'\) return deLaNube;/.test(invDatos));

chk('El temporizador de subida ya no deja claves colgadas',
    /delete _conteoProductoSyncTimers\[clave\];/.test(render),
    'si no se borran, al cerrar la pestaña se reenvía todo lo tocado en la sesión');

// ── Ejecución real de la lógica de preservación ────────────────────────────
(function ejecutarPreservacion() {
    const cuerpo = invDatos.match(
        /function _preservarConteosPendientes\(deLaNube, local\) \{[\s\S]*?\n        \}/);
    if (!cuerpo) { chk('_preservarConteosPendientes se pudo aislar', false); return; }
    chk('_preservarConteosPendientes se pudo aislar', true);

    let pendientes = [];
    const contexto = {
        _outboxPendientes: () => pendientes,
        console: { info() {} }
    };
    const fn = new Function('ctx', 'with (ctx) { ' + cuerpo[0] +
        '\n return _preservarConteosPendientes; }')(contexto);

    // Caso real: el bartender contó 7 botellas sin señal. Mientras tanto la
    // nube quedó en 2 (valor viejo). Al reconectar, su 7 debe sobrevivir.
    pendientes = ['TEQ-01|barra1'];
    let r = fn(
        { 'TEQ-01': { barra1: { enteras: 2, abiertas: [] } } },
        { 'TEQ-01': { barra1: { enteras: 7, abiertas: [0.5] } } });
    chk('El conteo sin subir sobrevive a la bajada de la nube',
        r['TEQ-01'].barra1.enteras === 7 && r['TEQ-01'].barra1.abiertas[0] === 0.5,
        'quedó en ' + JSON.stringify(r['TEQ-01'].barra1));

    // Lo que NO está pendiente debe seguir ganándolo la nube.
    pendientes = [];
    r = fn(
        { 'TEQ-01': { barra1: { enteras: 2, abiertas: [] } } },
        { 'TEQ-01': { barra1: { enteras: 7, abiertas: [] } } });
    chk('Lo ya confirmado lo sigue ganando la nube',
        r['TEQ-01'].barra1.enteras === 2);

    // Un área pendiente no debe arrastrar las demás áreas del producto.
    pendientes = ['TEQ-01|almacen'];
    r = fn(
        { 'TEQ-01': { almacen: { enteras: 1, abiertas: [] }, barra1: { enteras: 9, abiertas: [] } } },
        { 'TEQ-01': { almacen: { enteras: 4, abiertas: [] }, barra1: { enteras: 3, abiertas: [] } } });
    chk('Solo se preserva el área pendiente, no el producto entero',
        r['TEQ-01'].almacen.enteras === 4 && r['TEQ-01'].barra1.enteras === 9);

    // Un pendiente de un producto que la nube no conoce debe entrar igual.
    pendientes = ['NUEVO-9|barra2'];
    r = fn({}, { 'NUEVO-9': { barra2: { enteras: 3, abiertas: [] } } });
    chk('Un producto que la nube no tiene también se preserva',
        r['NUEVO-9'] && r['NUEVO-9'].barra2.enteras === 3);

    // Un pendiente sin valor local ya no debe inventar nada.
    pendientes = ['FANTASMA|barra1'];
    r = fn({ 'OTRO': { barra1: { enteras: 1, abiertas: [] } } }, {});
    chk('Un pendiente sin valor local no inventa un conteo',
        !r['FANTASMA'] && r['OTRO'].barra1.enteras === 1);
})();

// ───────────────────────────────────────────────────────────────────────────
//  D2 · ELIMINAR TODO EL CATÁLOGO
// ───────────────────────────────────────────────────────────────────────────

chk('Existe la marca de purga del catálogo',
    /let _catalogoPurgadoEn = 0;/.test(persistencia) &&
    /function _marcarCatalogoPurgado\(ts\)/.test(persistencia));

chk('El tope de lápidas sigue en 300 (no se resolvió subiéndolo)',
    /const _TOMBSTONE_MAX = 300;/.test(persistencia),
    'subir el tope solo mueve el problema al siguiente catálogo más grande');

chk('El borrado total marca la purga',
    /_marcarCatalogoPurgado\(Date\.now\(\)\);[\s\S]{0,300}?products = \[\];/.test(ui));

chk('Con purga vigente no se fusiona el catálogo de la nube',
    /if \(_purgaDeCatalogoVigente\(cloudDataForMerge\)\) \{[\s\S]{0,500}?\} else \{[\s\S]{0,200}?_mergeArrayByIdPreferLocal\(products, cloudProductsForMerge/.test(firestore));

chk('La marca de purga viaja a la nube',
    /if \(_catalogoPurgadoEn\) payload\._catalogoPurgadoEn = _catalogoPurgadoEn;/.test(firestore));

chk('La purga de otro administrador se adopta al bajar',
    /if \(_purgaNube > \(_catalogoPurgadoEn \|\| 0\)\) \{[\s\S]{0,300}?_marcarCatalogoPurgado\(_purgaNube\);/.test(invDatos));

chk('La marca sobrevive al cierre de la app',
    /localStorage\.setItem\('inventarioApp_catalogoPurgadoEn'/.test(persistencia) &&
    /localStorage\.getItem\('inventarioApp_catalogoPurgadoEn'/.test(firestore));

chk('También se vacía la segunda copia del catálogo',
    /async function _vaciarCatalogoPublicado\(\)/.test(roles) &&
    /_vaciarCatalogoPublicado\(\)/.test(ui));

chk('La segunda copia se vacía, no se borra',
    /productos:\s*\[\],[\s\S]{0,200}?vaciado:\s*true/.test(roles),
    'borrar el documento haría que los listeners salgan sin hacer nada');

chk('Los dos listeners aplican el vaciado en vez de descartarlo',
    (roles.match(/if \(data\.productos\.length === 0 && data\.vaciado\)/g) || []).length === 2,
    'antes ambos hacían return con length === 0 y el vaciado no llegaba a nadie');

chk('El vaciado avisa si no se pudo propagar',
    /No se pudo vaciar el catálogo publicado[\s\S]{0,300}?showNotification/.test(ui),
    'si falla en silencio, el admin cree que borró y el catálogo vuelve');

// ── Ejecución real: 424 productos contra un tope de 300 lápidas ────────────
(function ejecutarPurga() {
    const cuerpoMerge = persistencia.match(
        /function _mergeArrayByIdPreferLocal\(localArr, cloudArr, deletedIds\) \{[\s\S]*?\n        \}/);
    const cuerpoPurga = persistencia.match(
        /function _purgaDeCatalogoVigente\(datosNube\) \{[\s\S]*?\n        \}/);
    if (!cuerpoMerge || !cuerpoPurga) {
        chk('Las funciones de catálogo se pudieron aislar', false);
        return;
    }
    chk('Las funciones de catálogo se pudieron aislar', true);

    const ctx = { _catalogoPurgadoEn: 0 };
    const api = new Function('ctx', 'with (ctx) { ' + cuerpoMerge[0] + '\n' + cuerpoPurga[0] +
        '\n return { merge: _mergeArrayByIdPreferLocal, purga: _purgaDeCatalogoVigente }; }')(ctx);

    // El catálogo real del bar: 424 productos.
    const nube = Array.from({ length: 424 }, (_, i) => ({ id: 'PRD-' + i, name: 'p' + i }));

    // Lo que hacía el código anterior: 424 lápidas recortadas a las últimas 300.
    const lapidas = nube.map(p => p.id).slice(-300);
    const sinPurga = api.merge([], nube, lapidas);
    chk('Reproducido el defecto: sin purga vuelven 124 productos',
        sinPurga.length === 124,
        'volvieron ' + sinPurga.length + ', se esperaban 124');

    // Con la marca de purga vigente, el llamador no fusiona nada.
    ctx._catalogoPurgadoEn = 1000;
    chk('Con purga más nueva que la nube, la purga está vigente',
        api.purga({ _catalogoPurgadoEn: 500 }) === true);
    chk('Una vez propagada, la purga deja de estar vigente',
        api.purga({ _catalogoPurgadoEn: 1000 }) === false,
        'si no se apagara sola, el catálogo nuevo nunca podría sincronizarse');
    chk('Sin marca local no hay purga vigente',
        new Function('ctx', 'with (ctx) { ' + cuerpoPurga[0] +
            '\n return _purgaDeCatalogoVigente; }')({ _catalogoPurgadoEn: 0 })({}) === false);

    // Y el borrado de un producto suelto sigue funcionando con lápidas.
    const unoMenos = api.merge(
        [{ id: 'A' }, { id: 'B' }],
        [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        ['C']);
    chk('El borrado de un producto suelto sigue usando lápidas',
        unoMenos.length === 2 && !unoMenos.some(p => p.id === 'C'));
})();

// ───────────────────────────────────────────────────────────────────────────
//  D3 · LAS COLECCIONES ABIERTAS
// ───────────────────────────────────────────────────────────────────────────

chk('conteoMultiUsuario ya no acepta escritura libre',
    !/match \/conteoMultiUsuario\/\{area\} \{\s*\n\s*allow read, write: if request\.auth != null;/.test(reglas));

chk('Cada quien solo puede tocar su propio bloque',
    /match \/conteoMultiUsuario\/\{area\} \{[\s\S]{0,900}?affectedKeys\(\)\.hasOnly\(\[request\.auth\.uid\]\)/.test(reglas));

// FASE 2 — la garantía no cambia; la regla ahora exige ADEMÁS que la cuenta
// esté activa, así que el patrón lleva _cuentaActiva() de por medio.
chk('Crear el documento también exige que sea el bloque propio',
    /allow create: if request\.auth != null\s*\n\s*&& _cuentaActiva\(\)\s*\n\s*&& request\.resource\.data\.keys\(\)\.hasOnly\(\[request\.auth\.uid\]\);/.test(reglas));

chk('Borrar el área es cosa del administrador',
    /match \/conteoMultiUsuario\/\{area\} \{[\s\S]{0,1100}?allow delete: if isAdminUser\(\);/.test(reglas));

chk('El bloque se guarda bajo el uid, no bajo un id inventado por el aparato',
    /const safeId\s*= currentUserUid \|\| cu\.userId\.replace/.test(multi),
    'sin uid, el servidor no puede comprobar de quién es el bloque');

chk('El bloque lleva el uid dentro, para que la regla lo compruebe',
    /uid:\s*currentUserUid \|\| null,/.test(multi));

chk('El lector sigue indexando por userId (no se duplican personas)',
    /auditoriaConteoPorUsuario\[prodId\]\[area\]\[ud\.userId\]/.test(persistencia));

chk('El documento por dispositivo exige que el uid coincida',
    /allow create, update: if request\.auth != null\s*\n\s*&& _cuentaActiva\(\)\s*\n\s*&& request\.resource\.data\._userUid == request\.auth\.uid;/.test(reglas));

chk('Ese uid ya viajaba en el payload',
    /_userUid:\s*currentUserUid \|\| 'anonymous',/.test(firestore));

chk('La bitácora de conflictos ya no se puede borrar',
    /match \/conflictos\/\{conflictoId\} \{[\s\S]{0,400}?allow delete: if isAdminUser\(\);/.test(reglas));

chk('La cola de cambios ya no se puede borrar',
    /match \/cambios\/\{cambioId\} \{[\s\S]{0,800}?allow delete: if isAdminUser\(\);/.test(reglas));

chk('No se puede reescribir el evento de otro',
    /resource\.data\.uid == request\.auth\.uid \);/.test(reglas));

chk('Un evento sin uid todavía se puede completar',
    /!\('uid' in resource\.data\)/.test(reglas),
    'los eventos anteriores a la sesión nacen sin uid y hay que poder subirlos');

// FASE 2B — la decisión 2 que esta comprobación estaba esperando YA SE TOMÓ:
// durante la captura nadie ve el conteo de otra persona. La guarda se invierte
// en consecuencia: lo que ahora hay que vigilar es que esa lectura NO vuelva
// a quedar abierta a cualquier autenticado.
chk('La lectura del conteo ajeno está cerrada por permiso',
    /match \/conteoMultiUsuario\/\{area\} \{\s*\n\s*allow read: if hasPerm\('inventory\.viewAll'\);/.test(reglas),
    'ese documento lleva dentro el nombre y las cantidades de cada persona');

chk('Sigue en pie el aislamiento por uid de userAuditoria',
    /match \/userAuditoria\/\{uid\}/.test(reglas) &&
    /request\.auth\.uid == uid \|\| isAdminUser\(\)/.test(reglas));

chk('Sigue en pie el bloqueo optimista del conteo',
    /request\.resource\.data\.version ==\s*\n\s*\(\('version' in resource\.data\) \? resource\.data\.version : 0\) \+ 1;/.test(reglas));

// FASE 3 endureció esta regla (ver prueba-f1.js). La inmutabilidad que D
// protegía sigue intacta: se comprueba la garantía, no el texto literal.
chk('Sigue en pie la inmutabilidad del inventario cerrado',
    (/allow update: if isAdminUser\(\) && \(\s*\n\s*\(resource\.data\.estado != 'CERRADO' && resource\.data\.estado != 'CONTABILIZADO'/.test(reglas) &&
     /\.hasOnly\(\['estado','contabilizadoEn','contabilizadoPor','semanaDestino'\]\)/.test(reglas)));

// ───────────────────────────────────────────────────────────────────────────
//  D4 · RASTRO AL FINALIZAR ÁREA
// ───────────────────────────────────────────────────────────────────────────

chk('Existe el registro de finalización de área',
    /let myAuditoriaFinalizadas = \{\};/.test(multi));

chk('Finalizar un área anota quién y cuándo',
    /myAuditoriaFinalizadas\[area\] = \{[\s\S]{0,400}?uid:[\s\S]{0,300}?ts:\s*Date\.now\(\)/.test(flujo));

chk('El rastro se sube con el conteo',
    /finalizadas: \(typeof myAuditoriaFinalizadas !== 'undefined'\)/.test(firestore));

chk('El rastro sobrevive al cierre de la app',
    /inventarioApp_myAuditoriaFinalizadas/.test(leer('js/30-indexeddb.js')) &&
    /inventarioApp_myAuditoriaFinalizadas/.test(firestore));

chk('Se sigue marcando el estado como antes',
    /myAuditoriaStatus\[area\] = 'completada';/.test(flujo),
    'el rastro acompaña al estado, no lo sustituye');

// ───────────────────────────────────────────────────────────────────────────
//  D5 · UNA SOLA PUERTA PARA REABRIR
// ───────────────────────────────────────────────────────────────────────────

chk('Reabrir exige el permiso, no un isAdmin() suelto',
    /async function reabrirArea\(area\) \{[\s\S]{0,400}?hasPermission\('inventory\.reopenArea'\)/.test(flujo));

chk('No se puede reabrir si el inventario ya no está SINCRONIZADO',
    /async function reabrirArea\(area\)[\s\S]{0,900}?_inventarioActivo\.estado !== 'SINCRONIZADO'/.test(flujo));

chk('Reabrir escribe en el documento de cada persona',
    /collection\('userAuditoria'\)\.doc\(uid\)\s*\n\s*\.update\(\{ \['status\.' \+ area\]: 'pendiente'/.test(flujo),
    'es el único estado que la puerta de entrada al conteo consulta');

chk('Reabrir también reabre el estado propio del administrador',
    /if \(myAuditoriaStatus\[area\] === 'completada'\) \{[\s\S]{0,200}?myAuditoriaStatus\[area\] = 'pendiente';/.test(flujo));

chk('Reabrir deja rastro',
    /async function reabrirArea\(area\)[\s\S]{0,4000}?tipo:\s*'reapertura_almacen'/.test(flujo));

chk('Reabrir avisa si alguien no recibió el cambio',
    /if \(fallidos > 0\) \{[\s\S]{0,200}?no recibieron el cambio/.test(flujo));

chk('Reabrir sin señal lo dice en vez de fingir que funcionó',
    /Sin conexión — el área se reabrió aquí/.test(flujo));

chk('El enlace de reabrir se ofrece según el permiso',
    /if \(hasPermission\('inventory\.reopenArea'\)\) \{[\s\S]{0,300}?reabrirArea\(/.test(ui));

chk('La ruta por usuario sigue existiendo para casos puntuales',
    /async function reabrirAlmacenAdmin\(uid, area\)/.test(flujo),
    'reabrir a una sola persona sigue siendo válido');

// ───────────────────────────────────────────────────────────────────────────
//  ALCANCE · D no debía tocar lo que no le toca
// ───────────────────────────────────────────────────────────────────────────

chk('D subió la versión de caché por encima de 3.4',
    (() => {
        const v = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
        return v.length === 1 && parseFloat(v[0]) > 3.4;
    })(),
    'sin subirla, los teléfonos siguen con el código viejo en caché');

// FASE 2 — misma reorientación que en prueba-f1.js: los roles YA se podían
// diferenciar en esta fase, con autorización expresa. Lo que se sigue
// vigilando es el conteo ciego.
chk('Un Bartender no recibe por defecto ver los conteos de otros',
    !/BARTENDER:\s*\{[\s\S]{0,400}?'inventory\.viewAll'/.test(roles),
    'sería romper el conteo ciego por configuración de fábrica');

chk('Los identificadores de área NO se tocaron',
    /const AREAS_SISTEMA = \['almacen', 'barra1', 'barra2'\]/.test(leer('js/18-areas-config.js')),
    'renombrarlos destruiría el histórico');

chk('No se implementó stock teórico ni desviación',
    !/stockTeorico|calcularDesviacion/.test(firestore + invDatos + flujo + ui),
    'sin compras ni ventas, cualquier número sería inventado');

chk('No se tocó la numeración del inventario',
    /anterior = 100/.test(invDatos) || /_obtenerSiguienteNumeroInventario/.test(invDatos));

// ───────────────────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── D · sincronización y defectos críticos ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');

process.exit(fallos ? 1 : 0);
