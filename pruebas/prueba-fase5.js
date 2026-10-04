#!/usr/bin/env node
/**
 * prueba-fase5.js — FASE 5: INVENTARIO FÍSICO (reapertura + conteo huérfano)
 * ═══════════════════════════════════════════════════════════════════════════
 * Esta suite cubre lo que se comprueba leyendo el código: estructura de los
 * dos fixes (5A reapertura de área, 5B conteo huérfano), el ORDEN de la
 * llamada de archivo respecto al vaciado del conteo, que usa la variable
 * capturada y no la mutable, las guardas de contenido/estado pendiente, la
 * cola local, la conexión con reconexión/arranque, las reglas de Firestore
 * y el ALCANCE deliberado de esta fase.
 *
 * El comportamiento se prueba ejecutando, en la otra suite:
 *
 *   run-rules-tests.js (H1-H6)   → contra el motor real de reglas
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok, detalle: detalle || '' });
    if (!ok) fallos++;
}

const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

const invDatos = leer('js/45-inventario-datos.js');
const firest   = leer('js/40-firestore.js');
const persis   = leer('js/20-persistencia.js');
const roles    = leer('js/50-roles-permisos.js');
const arranque = leer('js/60-arranque.js');
const reglas   = leer('firestore.rules');
const html     = leer('index.html');
const sw       = leer('sw.js');

// Los comentarios de este mismo módulo y de los archivos de producción
// EXPLICAN el alcance nombrando lo que NO debe aparecer o el sentido en que
// NO se reacciona ("alcance deliberado", "sentido contrario"...), así que un
// chequeo de alcance sobre el texto completo se dispara con su propia
// documentación. Se despoja de comentarios antes de buscar, para que estas
// comprobaciones vigilen código, no prosa.
function sinComentarios(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

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

// ═══════════════════════════════════════════════════════════════════════════
//  5A — REAPERTURA DE ÁREA (Path D en subscribeMyAuditoria)
// ═══════════════════════════════════════════════════════════════════════════
const fnSubscribe = extraer(invDatos, 'subscribeMyAuditoria');
chk('subscribeMyAuditoria() existe', !!fnSubscribe);
chk('El fix está marcado como FIX 5A (FASE 5), localizable sin ambigüedad',
    /FIX 5A \(FASE 5\)/.test(invDatos));

chk('Path D lee data.status del snapshot (antes solo se leían sessionId y unlocks)',
    !!fnSubscribe && /const serverStatus = data\.status \|\| \{\};/.test(fnSubscribe));

chk('Path D compara serverStatus[area] contra \'pendiente\' y myAuditoriaStatus[area] contra \'completada\'',
    !!fnSubscribe && /serverStatus\[area\] === 'pendiente' && myAuditoriaStatus\[area\] === 'completada'/.test(fnSubscribe));

chk('★ Path D tiene UNA sola condición de comparación — no reacciona en el sentido contrario '
    + '(servidor completada + local pendiente no es reapertura, es sincronía entre dispositivos, fuera de alcance)',
    !!fnSubscribe && (fnSubscribe.match(/serverStatus\[area\]\s*===/g) || []).length === 1 &&
    !/serverStatus\[area\] === 'completada'/.test(fnSubscribe));

chk('Cuando hay reapertura: se actualiza myAuditoriaStatus[area] a \'pendiente\' y se borra myAuditoriaFinalizadas[area]',
    !!fnSubscribe && /myAuditoriaStatus\[area\] = 'pendiente';/.test(fnSubscribe) &&
    /delete myAuditoriaFinalizadas\[area\];/.test(fnSubscribe));

chk('El efecto (persistir, notificar, re-renderizar) está gateado por el flag huboReapertura — no se dispara de más',
    !!fnSubscribe && /if \(huboReapertura\) \{[\s\S]*?saveToLocalStorage\(\{ skipSyncTrigger: true \}\);[\s\S]*?showNotification\([\s\S]*?renderTab\(\);[\s\S]*?\}/.test(fnSubscribe));

// ═══════════════════════════════════════════════════════════════════════════
//  5B — CONTEO DE AUDITORÍA HUÉRFANO: el llamador (handleAuditSessionChange)
// ═══════════════════════════════════════════════════════════════════════════
const fnHandleChange = extraer(invDatos, 'handleAuditSessionChange');
chk('handleAuditSessionChange() existe', !!fnHandleChange);
chk('El fix está marcado como 5B (FASE 5), localizable sin ambigüedad',
    /5B \(FASE 5\)/.test(invDatos));

chk('handleAuditSessionChange() llama a _archivarConteoHuerfanoSiAplica()',
    !!fnHandleChange && /_archivarConteoHuerfanoSiAplica\(/.test(fnHandleChange));

chk('★ ORDEN: la llamada a _archivarConteoHuerfanoSiAplica ocurre ANTES de vaciar myAuditoriaConteo '
    + '(un test que se rompe si alguien mueve la llamada después del RESET REAL)',
    !!fnHandleChange &&
    fnHandleChange.indexOf('_archivarConteoHuerfanoSiAplica(') <
    fnHandleChange.indexOf('myAuditoriaConteo   = {};') &&
    fnHandleChange.indexOf('myAuditoriaConteo   = {};') !== -1);

chk('★ La llamada usa `sessionAnterior` (capturado ANTES de la reasignación) — NUNCA la variable mutable '
    + '_auditoriaSessionId — y no bloquea el flujo (sin await, con .catch)',
    /_archivarConteoHuerfanoSiAplica\(sessionAnterior\)\.catch\(/.test(invDatos) &&
    !/_archivarConteoHuerfanoSiAplica\(_auditoriaSessionId\)/.test(invDatos) &&
    !/await _archivarConteoHuerfanoSiAplica/.test(invDatos));

// ═══════════════════════════════════════════════════════════════════════════
//  5B — js/40-firestore.js: la implementación
// ═══════════════════════════════════════════════════════════════════════════
chk('El bloque está marcado como "FASE 5 (5B) — CONTEO DE AUDITORÍA HUÉRFANO"',
    /FASE 5 \(5B\) — CONTEO DE AUDITORÍA HUÉRFANO/.test(firest));

const fnArchivar = extraer(firest, '_archivarConteoHuerfanoSiAplica');
chk('_archivarConteoHuerfanoSiAplica() existe y no hace nada sin currentUserUid o sin sessionIdViejo',
    !!fnArchivar && /if \(!currentUserUid \|\| !sessionIdViejo\) return;/.test(fnArchivar));
chk('★ NO archiva si no había nada pendiente (guarda _auditSyncPending) — evita crear un huérfano vacío en cada arranque',
    !!fnArchivar && /if \(!_auditSyncPending\) return;/.test(fnArchivar));
chk('Descarta el payload sin contenido real antes de notificar o subir (_conteoHuerfanoTieneContenido)',
    !!fnArchivar && /if \(!_conteoHuerfanoTieneContenido\(payload\)\) return;/.test(fnArchivar));
chk('Cuando SÍ archiva: notifica al usuario y registra el evento en la cola de sincronización auditable',
    !!fnArchivar && /showNotification\(/.test(fnArchivar) &&
    /_registrarEnSyncQueue\(\{/.test(fnArchivar) && /tipo:\s*'conteo_auditoria_huerfano'/.test(fnArchivar));

const fnConstruir = extraer(firest, '_construirConteoHuerfano');
chk('_construirConteoHuerfano() arma {uid, sessionId, conteo, status, finalizadas, capturadoEn} clonando (no referenciando) el estado actual',
    !!fnConstruir && /uid:\s*currentUserUid/.test(fnConstruir) &&
    /sessionId:\s*sessionIdViejo/.test(fnConstruir) &&
    /capturadoEn:\s*Date\.now\(\)/.test(fnConstruir) &&
    (fnConstruir.match(/JSON\.parse\(JSON\.stringify\(/g) || []).length >= 3);

const fnTieneContenido = extraer(firest, '_conteoHuerfanoTieneContenido');
chk('_conteoHuerfanoTieneContenido() revisa conteo, status (buscando \'completada\') y finalizadas',
    !!fnTieneContenido && /payload\.conteo/.test(fnTieneContenido) &&
    /payload\.status\[k\] === 'completada'/.test(fnTieneContenido) &&
    /payload\.finalizadas/.test(fnTieneContenido));

const fnIntentarSubir = extraer(firest, '_intentarSubirConteoHuerfano');
chk('_intentarSubirConteoHuerfano() escribe en conteosAuditoriaHuerfanos con id uid + \'_\' + sessionId',
    !!fnIntentarSubir && /\.collection\('conteosAuditoriaHuerfanos'\)/.test(fnIntentarSubir) &&
    /\.doc\(payload\.uid \+ '_' \+ payload\.sessionId\)/.test(fnIntentarSubir));
chk('_intentarSubirConteoHuerfano() usa .set(payload) — nunca update (colección inmutable, create-only)',
    !!fnIntentarSubir && /\.set\(payload\)/.test(fnIntentarSubir) && !/\.update\(/.test(fnIntentarSubir));
chk('_intentarSubirConteoHuerfano() encola local si está offline o falla la escritura, y desencola tras subir con éxito',
    !!fnIntentarSubir && /if \(!_db \|\| !navigator\.onLine\)/.test(fnIntentarSubir) &&
    (fnIntentarSubir.match(/_encolarConteoHuerfanoLocal\(/g) || []).length >= 2 &&
    /_quitarConteoHuerfanoLocal\(payload\)/.test(fnIntentarSubir));

// ── Cola local: misma clave en las tres funciones ──────────────────────────
const fnLeerCola = extraer(firest, '_leerColaConteosHuerfanos');
const fnEncolar  = extraer(firest, '_encolarConteoHuerfanoLocal');
const fnQuitar   = extraer(firest, '_quitarConteoHuerfanoLocal');
chk('Existen las tres funciones de cola local (_leerColaConteosHuerfanos, _encolarConteoHuerfanoLocal, _quitarConteoHuerfanoLocal)',
    !!fnLeerCola && !!fnEncolar && !!fnQuitar);
chk('★ Las tres usan la MISMA clave AUDIT_HUERFANO_KEY para leer/escribir localStorage — ninguna hardcodea el string aparte',
    /const AUDIT_HUERFANO_KEY = 'inventarioApp_conteoHuerfanoPendiente';/.test(firest) &&
    /AUDIT_HUERFANO_KEY/.test(fnLeerCola) &&
    (fnEncolar.match(/AUDIT_HUERFANO_KEY/g) || []).length >= 1 &&
    (fnQuitar.match(/AUDIT_HUERFANO_KEY/g) || []).length >= 1);
chk('_encolarConteoHuerfanoLocal() no duplica un payload ya encolado para el mismo uid+sessionId',
    !!fnEncolar && /cola\.some\(function\(p\)/.test(fnEncolar));

const fnReintentar = extraer(firest, 'reintentarConteosHuerfanosPendientes');
chk('reintentarConteosHuerfanosPendientes() existe y recorre la cola local intentando subir cada payload',
    !!fnReintentar && /_leerColaConteosHuerfanos\(\)/.test(fnReintentar) &&
    /_intentarSubirConteoHuerfano\(payload\)/.test(fnReintentar));

// ═══════════════════════════════════════════════════════════════════════════
//  5B — Conexión con reconexión (50) y arranque (60)
// ═══════════════════════════════════════════════════════════════════════════
chk('reintentarConteosHuerfanosPendientes() está conectada tanto en la reconexión (js/50-roles-permisos.js) '
    + 'como en el arranque (js/60-arranque.js)',
    /reintentarConteosHuerfanosPendientes\(\)/.test(roles) &&
    /reintentarConteosHuerfanosPendientes\(\)/.test(arranque));

// ═══════════════════════════════════════════════════════════════════════════
//  PERSISTENCIA — tipo auditable nuevo
// ═══════════════════════════════════════════════════════════════════════════
chk("TIPOS_AUDITABLES incluye 'conteo_auditoria_huerfano'",
    /'conteo_auditoria_huerfano'/.test(persis));

// ═══════════════════════════════════════════════════════════════════════════
//  REGLAS — conteosAuditoriaHuerfanos: inmutable, con validación de identidad
// ═══════════════════════════════════════════════════════════════════════════
chk('firestore.rules define match /conteosAuditoriaHuerfanos/{huerfanoId}, marcado FASE 5 (5B)',
    /match \/conteosAuditoriaHuerfanos\/\{huerfanoId\}/.test(reglas) &&
    /FASE 5 \(5B\) — CONTEO DE AUDITORÍA HUÉRFANO/.test(reglas));
chk('allow read exige el permiso inventory.reopenArea',
    /allow read:\s*if hasPerm\('inventory\.reopenArea'\);/.test(reglas));
chk('allow create valida uid == request.auth.uid',
    /request\.resource\.data\.uid == request\.auth\.uid/.test(reglas));
chk('allow create valida que el id del documento sea exactamente uid + \'_\' + sessionId, '
    + 'y que sessionId sea string y capturadoEn sea number',
    /huerfanoId == \(request\.resource\.data\.uid \+ '_' \+ request\.resource\.data\.sessionId\)/.test(reglas) &&
    /request\.resource\.data\.sessionId is string/.test(reglas) &&
    /request\.resource\.data\.capturadoEn is number/.test(reglas));
chk('★ allow update, delete: if false — el documento es inmutable una vez creado',
    /match \/conteosAuditoriaHuerfanos\/\{huerfanoId\}[\s\S]{0,900}?allow update, delete: if false;/.test(reglas));

// ═══════════════════════════════════════════════════════════════════════════
//  ALCANCE — lo que FASE 5 (5A + 5B) NO debía tocar
// ═══════════════════════════════════════════════════════════════════════════
const invDatosCodigo = sinComentarios(invDatos);
const firestCodigo   = sinComentarios(firest);

chk('ALCANCE · reabrirArea() del lado de la escritura no cambió — el fix 5A es de LECTURA en subscribeMyAuditoria, '
    + 'no se duplicó lógica de escritura de status en reabrirArea()',
    !/function reabrirArea/.test(invDatosCodigo) && !/function reabrirArea/.test(firestCodigo));

chk('ALCANCE · no se tocó stockAreas desde el conteo huérfano ni desde el path de reapertura',
    !/stockAreas/.test(sinComentarios(fnArchivar || '')) && !/stockAreas/.test(sinComentarios(fnSubscribe || '')));

chk('ALCANCE · el conteo huérfano nunca se mezcla automáticamente con el inventario nuevo '
    + '(no hay ninguna escritura a userAuditoria dentro de _archivarConteoHuerfanoSiAplica ni de _intentarSubirConteoHuerfano)',
    !!fnArchivar && !/collection\('userAuditoria'\)/.test(sinComentarios(fnArchivar)) &&
    !/collection\('userAuditoria'\)/.test(sinComentarios(fnIntentarSubir || '')));

// ═══════════════════════════════════════════════════════════════════════════
//  CACHÉ
// ═══════════════════════════════════════════════════════════════════════════
// FASE 6: antes exigía EXACTAMENTE 4.0, y eso rompía en cuanto cualquier fase
// posterior subía la versión. Como el resto de las fases: "al menos" la suya.
chk('La versión de caché es al menos 4.0 (por encima de la de FASE 4) y es consistente entre index.html (JS y CSS) y sw.js',
    (() => {
        const v = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
        const mSw = /const APP_VERSION = '([^']+)';/.exec(sw);
        return v.length === 1 && parseFloat(v[0]) >= 4.0 &&
               html.indexOf('href="css/estilos.css?v=' + v[0] + '"') !== -1 &&
               !!mSw && mSw[1] === v[0];
    })(),
    'un index.html nuevo sirviendo .js viejos desde caché es el fallo más difícil de diagnosticar');

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── FASE 5 · inventario físico (5A reapertura + 5B conteo huérfano) ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos === 0 ? 0 : 1);
