#!/usr/bin/env node
/**
 * prueba-f2.js — FASE 2: permisos, privacidad y seguridad de servidor
 * ═══════════════════════════════════════════════════════════════════════════
 * Esta suite cubre la mitad de CLIENTE de la FASE 2. La mitad de servidor vive
 * en run-rules-tests.js, contra el emulador real de Firestore.
 *
 * Reparto deliberado:
 *   run-rules-tests.js → P1..P8, P18, P19, P21b/c/d, P22, P26
 *   este archivo       → P21a, P23, P24, P25, P27, P28
 *
 * P21 (paridad cliente/servidor) se demuestra en dos mitades que se encadenan:
 *
 *   P21a (aquí)              hasPermission()  ≡  permisosEfectivos()
 *   P21b (run-rules-tests)   permisosEfectivos()  ≡  hasPerm() de las reglas
 *   ────────────────────────────────────────────────────────────────────────
 *   por transitividad        hasPermission()  ≡  hasPerm()
 *
 * Las dos mitades recorren la MISMA matriz de casos (rol × override × estado
 * de la cuenta) con los mismos resultados esperados. Si los dos motores
 * divergieran, una de las dos suites se pondría roja.
 *
 * Las funciones se EXTRAEN del archivo real y se ejecutan. Una copia probaría
 * que la copia funciona.
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
    casos.push({ nombre, ok, detalle: detalle || '' });
    if (!ok) fallos++;
}

const leer     = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const roles    = leer('js/50-roles-permisos.js');
const expor    = leer('js/95-exportacion.js');
const flujo    = leer('js/75-auditoria-flujo.js');
const multi    = leer('js/10-multiusuario.js');
const firest   = leer('js/40-firestore.js');
const persis   = leer('js/20-persistencia.js');
const invDatos = leer('js/45-inventario-datos.js');
const uiProd   = leer('js/85-ui-inventario-fisico.js');
const areasCfg = leer('js/18-areas-config.js');
const ciclo    = leer('js/90-ciclo-admin.js');
const render   = leer('js/70-conversion-render.js');
const reglas   = leer('firestore.rules');

function extraer(fuente, nombre) {
    const i = fuente.indexOf('function ' + nombre + '(');
    if (i === -1) return null;
    let nivel = 0, dentro = false;
    for (let j = i; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(i, j + 1); }
    }
    return null;
}

function extraerConst(fuente, nombre) {
    const i = fuente.indexOf('const ' + nombre + ' = ');
    if (i === -1) return null;
    // Se corta en el primer ';' que quede a nivel 0 de llaves/corchetes.
    let llaves = 0, corch = 0;
    for (let j = i; j < fuente.length; j++) {
        const c = fuente[j];
        if (c === '{') llaves++;
        else if (c === '}') llaves--;
        else if (c === '[') corch++;
        else if (c === ']') corch--;
        else if (c === ';' && llaves === 0 && corch === 0) return fuente.slice(i, j + 1);
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  P21a · PARIDAD INTERNA DEL CLIENTE
//  hasPermission() (la autoridad de la sesión) y permisosEfectivos() (lo que
//  la pantalla de administración muestra de CUALQUIER usuario) tienen que
//  decidir igual. Si no, el administrador vería en los checkboxes algo
//  distinto de lo que el sistema aplica de verdad.
// ═══════════════════════════════════════════════════════════════════════════
const PIEZAS = [
    extraerConst(roles, 'PERMISOS_CATALOGO'),
    'const PERMISOS_CATALOGO_SET = new Set(PERMISOS_CATALOGO);',
    extraerConst(roles, 'ROLES_SISTEMA_DEFECTO'),
    extraerConst(roles, 'ROLE_LEGACY_A_CANONICO'),
    extraer(roles, '_roleCanonico'),
    extraer(roles, '_sanitizarOverrides'),
    extraer(roles, 'hasPermission'),
    extraer(roles, 'permisosEfectivos')
];
chk('Se pudieron extraer las piezas reales del motor de permisos',
    PIEZAS.every(Boolean),
    'si esto falla, el resto de P21a no está probando el código real');

let motor = null;
if (PIEZAS.every(Boolean)) {
    const ctx = vm.createContext({ console, currentUserUid: null, _authzState: null, _rolesCache: {} });
    vm.runInContext(
        PIEZAS.join('\n') + `
        // Reproduce el bootstrap de _authzState tal como lo construyen
        // loadUserRole() y _actualizarAuthzState(): permisos vacíos y sin
        // overrides si la cuenta está inactiva.
        globalThis._montar = function(userData) {
            const legacy = (userData && userData.role) || 'user';
            const roleId = _roleCanonico(legacy);
            const activo = ((userData && userData.status) || 'activo') !== 'inactivo';
            const delRol = _rolesCache[roleId] ||
                (ROLES_SISTEMA_DEFECTO[roleId] || ROLES_SISTEMA_DEFECTO.BARTENDER).permissions;
            currentUserUid = 'u-test';
            _authzState = {
                loaded: true, uid: 'u-test', legacyRole: legacy, roleId: roleId,
                permissions: activo ? new Set(delRol) : new Set(),
                overrides:   activo ? _sanitizarOverrides(userData && userData.permissionOverrides) : {},
                disabled:    !activo
            };
        };
        globalThis._hasPermission     = hasPermission;
        globalThis._permisosEfectivos = permisosEfectivos;
        globalThis._catalogo          = PERMISOS_CATALOGO;
        globalThis._setRolesCache     = function(c) { _rolesCache = c; };
        `, ctx);
    motor = ctx;
}

// La MISMA matriz que P21b usa contra el emulador.
const MATRIZ = [
    // [rol,              override, status,     esperado]
    ['ADMIN',             null,     'activo',   true ],
    ['ADMIN',             'deny',   'activo',   true ],   // el comodín gana
    ['ADMIN',             null,     'inactivo', false],
    ['SUBJEFE_BARRA',     null,     'activo',   false],
    ['SUBJEFE_BARRA',     'allow',  'activo',   true ],
    ['SUBJEFE_BARRA',     'deny',   'activo',   false],
    ['BARTENDER',         null,     'activo',   false],
    ['BARTENDER',         'allow',  'activo',   true ],
    ['BARTENDER',         'allow',  'inactivo', false],
    ['BARTENDER',         'deny',   'activo',   false],
    ['ROL_DESCONOCIDO',   null,     'activo',   false],
    ['ROL_DESCONOCIDO',   'allow',  'activo',   true ]
];
const PERM = 'catalog.publish';

if (motor) {
    // El emulador se siembra con los permisos por defecto de esta versión;
    // aquí se hace lo mismo para que las dos mitades hablen de lo mismo.
    let divergen = [], erroneos = [];
    MATRIZ.forEach(([rol, ov, status, esperado]) => {
        const doc = { uid: 'u-test', role: rol, status: status };
        if (ov) doc.permissionOverrides = { [PERM]: ov };

        motor._montar(doc);
        const porHasPermission = motor._hasPermission(PERM);

        const efec   = motor._permisosEfectivos(doc);
        const estado = efec.estados[PERM];
        const porEfectivos = (estado === 'comodin' || estado === 'asignado' || estado === 'heredado');

        const etiqueta = rol + '/' + (ov || 'sin-override') + '/' + status;
        if (porHasPermission !== porEfectivos) divergen.push(etiqueta);
        if (porHasPermission !== esperado)     erroneos.push(etiqueta + ' → ' + porHasPermission);
    });

    chk('P21a · hasPermission() y permisosEfectivos() nunca divergen',
        divergen.length === 0,
        'divergen en: ' + divergen.join(', '));
    chk('P21a · la precedencia real coincide con la matriz esperada',
        erroneos.length === 0,
        'casos incorrectos: ' + erroneos.join(', '));

    // El comodín antes que los overrides no es un detalle: es lo que impide
    // que un administrador quede degradado por una casilla.
    motor._montar({ role: 'ADMIN', permissionOverrides: { 'inventory.closeGlobal': 'deny' } });
    chk('P21a · un override deny NO degrada a un administrador',
        motor._hasPermission('inventory.closeGlobal') === true);

    // Un permiso fuera del catálogo se deniega, no se concede por descuido.
    motor._montar({ role: 'ADMIN' });
    chk('P21a · un permiso fuera del catálogo se deniega incluso siendo admin',
        motor._hasPermission('inventado.que.no.existe') === false);
}

// La matriz de este archivo y la de run-rules-tests.js tienen que ser la misma.
const rulesTests = leer('run-rules-tests.js');
chk('P21 · la matriz de paridad es idéntica en las dos mitades',
    MATRIZ.every(([rol, ov, status, esperado]) => {
        const ovTxt = ov ? "'" + ov + "'" : 'null';
        const re = new RegExp("\\['" + rol + "'\\s*,\\s*" + ovTxt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                              "\\s*,\\s*'" + status + "'\\s*,\\s*" + (esperado ? 'true' : 'false'));
        return re.test(rulesTests);
    }),
    'si las matrices se separan, la paridad deja de estar demostrada');

// ═══════════════════════════════════════════════════════════════════════════
//  P23 · Ningún isAdmin() convertido quedó sin protección
// ═══════════════════════════════════════════════════════════════════════════
const CONVERTIDOS = [
    ['Importar catálogo',      ciclo,    "hasPermission('catalog.publish')"],
    ['Publicar catálogo',      roles,    "hasPermission('catalog.publish')"],
    ['Editar producto',        uiProd,   "hasPermission('catalog.edit')"],
    ['Crear área',             areasCfg, "hasPermission('warehouses.create')"],
    ['Editar área',            areasCfg, "hasPermission('warehouses.update')"],
    ['Eliminar área',          areasCfg, "hasPermission('warehouses.disable')"],
    ['Generar reporte',        roles,    "hasPermission('reports.export')"],
    ['Pausar sincronización',  roles,    "hasPermission('settings.update')"],
    ['Restaurar respaldo',     persis,   "hasPermission('settings.update')"],
    ['Exportar Excel',         expor,    "hasPermission('inventory.export')"],
    ['Respaldo completo',      expor,    "hasPermission('data.exportFull')"],
    ['Diagnóstico',            expor,    "hasPermission('settings.read')"],
    ['Finalizar conteo propio', flujo,   "hasPermission('inventory.closeOwn')"],
    ['Cerrar área completa',   flujo,    "hasPermission('inventory.closeOther')"],
    ['Desbloquear candado',    ciclo,    "hasPermission('settings.update')"]
];
CONVERTIDOS.forEach(([nombre, fuente, esperado]) => {
    chk('P23 · ' + nombre + ' está protegido por ' + esperado,
        fuente.includes(esperado),
        'quedó sin guarda o con el permiso equivocado');
});

chk('P23 · ninguna acción convertida dejó un isAdmin() suelto en su lugar',
    !/function saveProduct\(\)\s*\{\s*if \(!isAdmin\(\)\)/.test(uiProd) &&
    !/async function publicarCatalogoFirestore\(\)\s*\{\s*if \(!_db \|\| !isAdmin\(\)\)/.test(roles),
    'la conversión no llegó a aplicarse en algún punto');

chk('P23 · todo permiso usado en el código existe en el catálogo cerrado',
    (() => {
        const cat = new Set(JSON.parse(
            (extraerConst(roles, 'PERMISOS_CATALOGO') || '')
                .replace(/^const PERMISOS_CATALOGO = /, '')
                .replace(/;$/, '')
                .replace(/\/\/[^\n]*/g, '')
                .replace(/'/g, '"')
                .replace(/,(\s*])/g, '$1')
        ));
        const todos = [roles, expor, flujo, multi, firest, persis, invDatos, uiProd, areasCfg, ciclo, render].join('\n');
        const usados = [...todos.matchAll(/hasPermission\('([^']+)'\)/g)].map(m => m[1]);
        const fuera  = usados.filter(p => !cat.has(p));
        return fuera.length === 0;
    })(),
    'hasPermission() rechaza cualquier string fuera del catálogo: sería una guarda que siempre deniega');

// ═══════════════════════════════════════════════════════════════════════════
//  P24 · exportFullData() no expone conteos ajenos
// ═══════════════════════════════════════════════════════════════════════════
chk('P24 · el respaldo completo exige data.exportFull',
    /const completo = hasPermission\('data\.exportFull'\);/.test(expor));
chk('P24 · los conteos ajenos solo viajan si hay permiso',
    /if \(completo\) \{[\s\S]{0,400}?data\.auditoriaConteoPorUsuario = auditoriaConteoPorUsuario;/.test(expor),
    'auditoriaConteoPorUsuario lleva nombre y cantidades de cada compañero');
chk('P24 · el objeto base del respaldo ya no incluye conteos ajenos',
    !/const data = \{[\s\S]{0,600}?auditoriaConteoPorUsuario,/.test(expor),
    'si siguen en el literal, viajan siempre');
chk('P24 · el aviso al usuario dice que el respaldo es reducido',
    /no incluye conteos de otras personas/.test(expor));
chk('P24 · js/95-exportacion.js dejó de no validar nada',
    (expor.match(/hasPermission\(/g) || []).length >= 3,
    'eran 525 líneas sin una sola comprobación');

// ═══════════════════════════════════════════════════════════════════════════
//  P25 · Purga local de datos ajenos
// ═══════════════════════════════════════════════════════════════════════════
const purga = extraer(roles, '_purgarConteosAjenosLocales');
chk('P25 · existe la purga de conteos ajenos', !!purga);
if (purga) {
    chk('P25 · la purga no hace nada si el usuario SÍ puede verlos',
        /if \(puedeVerConteosAjenos\(\)\) return;/.test(purga),
        'un administrador no debe perder su consolidación');
    chk('P25 · borra el detalle por persona de memoria',
        /delete auditoriaConteoPorUsuario\[k\]/.test(purga));
    chk('P25 · borra el agregado de memoria',
        /delete auditoriaConteo\[k\]/.test(purga));
    chk('P25 · borra las dos claves de localStorage',
        /removeItem\('inventarioApp_auditoriaConteoPorUsuario'\)/.test(purga) &&
        /removeItem\('inventarioApp_auditoriaConteo'\)/.test(purga),
        'sobreviven a reinicios: sin esto la privacidad sería solo visual');
    chk('P25 · borra también IndexedDB',
        /_idbSet\('auditoriaConteoPorUsuario', \{\}\)/.test(purga) &&
        /_idbSet\('auditoriaConteo', \{\}\)/.test(purga),
        'IDB es la capa que sobrevive incluso a limpiar localStorage');
}
chk('P25 · la purga se ejecuta al resolver el contexto de autorización',
    (roles.match(/_purgarConteosAjenosLocales\(\);/g) || []).length >= 3,
    'arranque, reconciliación en vivo y degradación de rol');

// Las tres consultas que traían conteos ajenos se cortan en el cliente.
chk('P25 · _cargarYAgeregarConteos se corta sin permiso',
    /async function _cargarYAgeregarConteos\(area\) \{[\s\S]{0,900}?if \(!puedeVerConteosAjenos\(\)\) return;/.test(firest));
chk('P25 · loadConteoPorUsuarioFromFirestore se corta sin permiso',
    /async function loadConteoPorUsuarioFromFirestore\(\) \{[\s\S]{0,900}?if \(!puedeVerConteosAjenos\(\)\) return;/.test(persis));
chk('P25 · loadConflictosDesdeFirestore se corta sin permiso',
    /async function loadConflictosDesdeFirestore\(\) \{[\s\S]{0,900}?if \(!puedeVerConteosAjenos\(\)\) return;/.test(invDatos));

// Y las superficies que los mostraban.
chk('P25 · el desglose por persona depende del permiso, no del avance del conteo',
    /function renderAuditTrailForProduct\(productId, area\) \{[\s\S]{0,900}?if \(!puedeVerConteosAjenos\(\)\) return '';/.test(multi) &&
    !/myAuditoriaStatus\[area\] === 'completada'\);\s*\n\s*if \(!isAdmin\(\) && !areaCompletada\) return '';/.test(multi),
    'antes se destapaba al terminar el área: ciego "hasta que termino", no ciego durante el inventario');
chk('P25 · el panel de comparación no se dibuja sin permiso',
    /function renderAuditComparePanel\(\) \{[\s\S]{0,700}?if \(!puedeVerConteosAjenos\(\)\) return '';/.test(multi));
chk('P25 · la barra de estado del área dejó de ser pública',
    /FASE 2B[\s\S]{0,700}?if \(puedeVerConteosAjenos\(\)\) \{\s*\n\s*const auditUniqUsers = new Set\(\);/.test(uiProd),
    'decía en tiempo real si tu cifra discrepaba de la de tu compañero');

// ═══════════════════════════════════════════════════════════════════════════
//  P27 · Todo cambio de permisos deja auditoría
// ═══════════════════════════════════════════════════════════════════════════
chk('P27 · el tipo de evento existe en la tubería auditable',
    /'permisos',\s*\/\/ cambio de rol\/permisos/.test(persis),
    'sin estar en TIPOS_AUDITABLES el evento no llega a historialCambios');
const regCambio = extraer(roles, 'registrarCambioPermisos');
chk('P27 · existe registrarCambioPermisos()', !!regCambio);
if (regCambio) {
    ['usuarioAfectado', 'rolAnterior', 'rolNuevo', 'permisosAnteriores', 'permisosNuevos',
     'overridesAnteriores', 'overridesNuevos', 'areasAnteriores', 'areasNuevas',
     'statusAnterior', 'statusNuevo', 'motivo'].forEach(campo => {
        chk('P27 · la auditoría conserva ' + campo, new RegExp(campo + ':').test(regCambio));
    });
    chk('P27 · el evento lleva estado (SOLICITADO/APLICADO/RECHAZADO/REVOCADO)',
        /estadoPermiso/.test(regCambio));
}
const guardar = extraer(roles, 'permGuardar');
chk('P27 · guardar permisos registra el cambio aplicado',
    !!guardar && /estadoPermiso:\s*'APLICADO'/.test(guardar));
chk('P27 · un guardado rechazado también queda registrado',
    !!guardar && /estadoPermiso:\s*'RECHAZADO'/.test(guardar),
    'un intento fallido de cambiar permisos es información de seguridad');
chk('P27 · historialCambios sigue siendo imborrable',
    /match \/historialCambios\/\{docId\}[\s\S]{0,400}?allow update, delete: if false/.test(reglas));

// ═══════════════════════════════════════════════════════════════════════════
//  P26 (cliente) · Protección de auto-bloqueo
// ═══════════════════════════════════════════════════════════════════════════
const noBloqueo = extraer(roles, '_permValidarNoAutobloqueo');
chk('P26 · existe la validación de auto-bloqueo', !!noBloqueo);
if (noBloqueo) {
    chk('P26 · un administrador no puede degradarse a sí mismo',
        /uid === currentUserUid/.test(noBloqueo));
    chk('P26 · no se puede dejar el sistema sin ningún administrador activo',
        /otrosAdmins\.length === 0/.test(noBloqueo) &&
        /\(u\.status \|\| 'activo'\) !== 'inactivo'/.test(noBloqueo),
        'se comprueba contra la lista real, no contra una suposición');
}
chk('P26 · guardar permisos exige pasar por esa validación',
    !!guardar && /_permValidarNoAutobloqueo\(/.test(guardar));

// ═══════════════════════════════════════════════════════════════════════════
//  P28 · Finalizar conteo propio NO cierra el área para los demás
// ═══════════════════════════════════════════════════════════════════════════
const finalizar = extraer(flujo, 'auditoriaFinalizarConteo');
const cerrarArea = extraer(flujo, 'auditoriaCerrarArea');
chk('P28 · existe la operación separada de cerrar área', !!cerrarArea);
chk('P28 · finalizar el conteo propio ya no toca el estado global del área',
    !!finalizar && !/if \(isAdmin\(\)\) auditoriaStatus\[area\] = 'completada';/.test(finalizar),
    'era un efecto secundario invisible que solo se disparaba para administradores');
chk('P28 · finalizar sigue marcando SOLO el conteo propio',
    !!finalizar && /myAuditoriaStatus\[area\] = 'completada';/.test(finalizar));
chk('P28 · cerrar el área es lo único que marca el estado global',
    !!cerrarArea && /auditoriaStatus\[area\] = 'completada';/.test(cerrarArea));
chk('P28 · cada operación tiene su propio permiso',
    !!finalizar && /hasPermission\('inventory\.closeOwn'\)/.test(finalizar) &&
    !!cerrarArea && /hasPermission\('inventory\.closeOther'\)/.test(cerrarArea));
chk('P28 · finalizar comprueba además el área asignada y el inventario abierto',
    !!finalizar && /puedeOperarArea\(area\)/.test(finalizar) &&
    /_inventarioActivo && !inventarioAbierto\(_inventarioActivo\)/.test(finalizar),
    'antes no verificaba absolutamente nada');

// ═══════════════════════════════════════════════════════════════════════════
//  Roles diferenciados y metadatos en español
// ═══════════════════════════════════════════════════════════════════════════
const defectos = extraerConst(roles, 'ROLES_SISTEMA_DEFECTO') || '';
chk('Subjefe y Bartender ya NO tienen los mismos permisos por defecto',
    (() => {
        const m = defectos.match(/SUBJEFE_BARRA:\s*\{[\s\S]*?permissions:\s*\[([\s\S]*?)\]/);
        const b = defectos.match(/BARTENDER:\s*\{[\s\S]*?permissions:\s*\[([\s\S]*?)\]/);
        if (!m || !b) return false;
        const norm = (s) => s.replace(/\s+/g, '').split(',').filter(Boolean).sort().join(',');
        return norm(m[1]) !== norm(b[1]);
    })(),
    'si son idénticos, el rol Subjefe no tiene ningún efecto real');
chk('La diferencia del Subjefe es cerrar área completa y exportar',
    /SUBJEFE_BARRA:[\s\S]{0,400}?'inventory\.closeOther'/.test(defectos) &&
    /SUBJEFE_BARRA:[\s\S]{0,400}?'inventory\.export'/.test(defectos));
chk('El Bartender NO recibe por defecto ver los conteos de otros',
    !/BARTENDER:\s*\{[\s\S]{0,400}?'inventory\.viewAll'/.test(defectos),
    'sería romper el conteo ciego por configuración de fábrica');

chk('Los IDs técnicos de permisos siguen en inglés (D1: no se migran)',
    /'inventory\.create'/.test(roles) && !/'inventario\.crear'/.test(roles),
    'renombrarlos obligaría a migrar roles/* y permissionOverrides en Firestore');
chk('Existe el mapa de presentación en español',
    /const PERMISOS_METADATOS = \{/.test(roles));
chk('Todo permiso del catálogo tiene nombre visible en español',
    (() => {
        const cat = [...(extraerConst(roles, 'PERMISOS_CATALOGO') || '')
            .matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)'/g)].map(m => m[1]);
        const meta = extraerConst(roles, 'PERMISOS_METADATOS') || '';
        const faltan = cat.filter(p => !meta.includes("'" + p + "'"));
        return cat.length > 30 && faltan.length === 0;
    })(),
    'una casilla sin nombre legible no es una interfaz en español');
chk('Los permisos nuevos de FASE 2 están registrados',
    /'inventory\.post'/.test(roles) && /'data\.exportFull'/.test(roles));
// Esta comprobación exigía que la operación NO existiera: FASE 2 solo
// declaraba el permiso. Con FASE 3 autorizada, lo que queda por vigilar es
// que la operación viva en UN solo sitio —el módulo de flujo— y no se haya
// esparcido por la capa de datos ni por el catálogo de permisos.
chk('contabilizarInventario() vive solo en el módulo de flujo',
    /function contabilizarInventario/.test(flujo) &&
    !/function contabilizarInventario/.test(roles + firest + invDatos));

// ═══════════════════════════════════════════════════════════════════════════
//  Áreas asignadas (D3)
// ═══════════════════════════════════════════════════════════════════════════
const areasUsr = extraer(roles, 'areasDeUsuario');
chk('D3 · el campo ausente significa TODAS las áreas',
    !!areasUsr && /if \(!Array\.isArray\(raw\)\) return null;/.test(areasUsr),
    'interpretarlo como "ninguna" dejaría sin contar a toda la plantilla el día del despliegue');
const puedeArea = extraer(roles, 'puedeOperarArea');
chk('D3 · sin restricción se puede operar cualquier área',
    !!puedeArea && /if \(permitidas === null\) return true;/.test(puedeArea));
chk('D3 · las reglas impiden que un usuario se amplíe sus propias áreas',
    /!\('areasAsignadas' in request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\)/.test(reglas));

// ═══════════════════════════════════════════════════════════════════════════
//  D6 · Candado local
// ═══════════════════════════════════════════════════════════════════════════
const desbloq = extraer(ciclo, 'desbloquearCandadoLocal');
chk('D6 · existe la operación de desbloqueo', !!desbloq);
if (desbloq) {
    chk('D6 · está protegida por un permiso',
        /hasPermission\('settings\.update'\)/.test(desbloq));
    chk('D6 · NO toca el inventario de Firestore',
        !/inventories/.test(desbloq) && !/_db/.test(desbloq),
        'desbloquear la captura local no puede alterar un inventario cerrado');
    chk('D6 · no se confunde con reabrir un área',
        !/reopenArea|reabrirArea/.test(desbloq));
    chk('D6 · queda registrada en el historial',
        /tipo:\s*'candado_local'/.test(desbloq));
}
chk('D6 · el candado sigue existiendo (NO se eliminó código legado)',
    /function isCicloBloqueado\(\)/.test(persis) &&
    /isCicloBloqueado\(\)/.test(render),
    'tiene consumidores reales en producción: eliminarlo rompería el guardado de conteos');
chk('D6 · el mensaje distingue el candado local del inventario histórico',
    /candado local/.test(render));
chk('D6 · el estado del candado es visible en administración',
    /Candado local de captura/.test(roles));

// ═══════════════════════════════════════════════════════════════════════════
//  Alcance: lo que FASE 2 NO debía tocar
// ═══════════════════════════════════════════════════════════════════════════
chk('ALCANCE · no se tocó el campo pv del catálogo',
    /pv: \['PV', 'SKU', 'PV de venta', 'PVVenta', 'ProductId', 'product_id'\]/.test(ciclo) &&
    !/pvParrot/.test(ciclo + uiProd + roles),
    'D5: conservar pv exactamente como está, sin reinterpretarlo');
// Igual que arriba: el alcance que protege hoy es que el permiso se exija
// desde el módulo de flujo y en ningún otro, no que no se exija en ninguno.
chk('ALCANCE · inventory.post se exige en el flujo, no en la capa de datos',
    /hasPermission\('inventory\.post'\)/.test(flujo) &&
    !/inventory\.post/.test(firest + invDatos),
    'la interfaz puede consultarlo para pintar el botón; quien lo EXIGE es el flujo');
chk('ALCANCE · no se implementó stock teórico ni desviación',
    !/stockTeorico|calcularDesviacion/.test(firest + invDatos + flujo + uiProd));
chk('ALCANCE · los identificadores de área siguen intactos',
    /const AREAS_SISTEMA = \['almacen', 'barra1', 'barra2'\]/.test(areasCfg));
chk('ALCANCE · la inmutabilidad del inventario cerrado sigue en pie',
    (/allow update: if isAdminUser\(\) && \(\s*\n\s*\(resource\.data\.estado != 'CERRADO' && resource\.data\.estado != 'CONTABILIZADO'/.test(reglas) &&
     /\.hasOnly\(\['estado','contabilizadoEn','contabilizadoPor','semanaDestino'\]\)/.test(reglas)) &&
    /allow update, delete: if false;/.test(reglas));

// ═══════════════════════════════════════════════════════════════════════════
//  Caché: sin subir la versión, los teléfonos siguen con el código viejo
// ═══════════════════════════════════════════════════════════════════════════
const html = leer('index.html');
chk('La versión de caché subió por encima de la de la fase D',
    (() => {
        const v = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
        return v.length === 1 && parseFloat(v[0]) > 3.5;
    })(),
    'una regla nueva con código viejo en caché es la peor combinación posible');

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── FASE 2 · permisos, privacidad y seguridad de servidor ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos === 0 ? 0 : 1);
