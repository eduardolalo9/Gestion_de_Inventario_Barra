#!/usr/bin/env node
/**
 * prueba-8c.js — FASE 8C · Retiro de la escritura heredada de conteoAreas
 * ═══════════════════════════════════════════════════════════════════════════
 * Lo que el informe de cierre de FASE 8 (§6, §9) dejó pendiente: retirar
 * syncConteoAtomicoPorArea() y todo lo que dependía de ella, porque su único
 * consumidor real (el reporte) ya lee auditoriaConteo desde FASE 8.
 *
 * Esta suite verifica, sobre el código REAL (no una copia):
 *   1. Que las tres funciones de la colección heredada conteoAreas ya no
 *      existen: syncConteoAtomicoPorArea, _cargarYAgeregarConteos,
 *      loadConflictosDesdeFirestore.
 *   2. Que ningún archivo las sigue llamando (ni index.html).
 *   3. Que la bandera de conflicto de botellas abiertas no se perdió: la UI
 *      (85, 80) ya no depende de alerta_conflicto (que solo existía en
 *      conteoAreas) sino de _hayConflicto, calculado en vivo por
 *      _recalcAdminAggregatedConteo() — y que ese cálculo compara TANTO
 *      enteras COMO abiertas (antes de esta fase, alerta_conflicto solo
 *      cubría abiertas; _hayConflicto por sí solo solo cubría enteras).
 *   4. Control negativo: que conteoMultiUsuario / syncConteoPorUsuarioToFirestore
 *      — un sistema legacy DISTINTO, fuera del alcance de esta fase — sigue
 *      intacto. Retirar conteoAreas no debe arrastrar a su vecino.
 *   5. Que resetConteoMultiUsuarioEnFirestore (la función renombrada) ya
 *      solo borra conteoMultiUsuario, no conteoAreas.
 *
 * No necesita emulador ni red.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok: !!ok, detalle: detalle || '' });
    if (!ok) fallos++;
}

const firest    = fs.readFileSync(path.join(RAIZ, 'js', '40-firestore.js'), 'utf8');
const flujo     = fs.readFileSync(path.join(RAIZ, 'js', '75-auditoria-flujo.js'), 'utf8');
const roles     = fs.readFileSync(path.join(RAIZ, 'js', '50-roles-permisos.js'), 'utf8');
const invDatos  = fs.readFileSync(path.join(RAIZ, 'js', '45-inventario-datos.js'), 'utf8');
const uiInv     = fs.readFileSync(path.join(RAIZ, 'js', '85-ui-inventario-fisico.js'), 'utf8');
const buscador  = fs.readFileSync(path.join(RAIZ, 'js', '80-buscador.js'), 'utf8');
const arranque  = fs.readFileSync(path.join(RAIZ, 'js', '60-arranque.js'), 'utf8');
const multi     = fs.readFileSync(path.join(RAIZ, 'js', '10-multiusuario.js'), 'utf8');
const html      = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

const TODO_JS = [firest, flujo, roles, invDatos, uiInv, buscador, arranque, multi].join('\n');

// ═══ 1 · Las funciones de conteoAreas ya no existen ════════════════════════
chk('syncConteoAtomicoPorArea ya no está definida',
    !/function\s+syncConteoAtomicoPorArea\s*\(/.test(TODO_JS));
chk('_cargarYAgeregarConteos ya no está definida',
    !/function\s+_cargarYAgeregarConteos\s*\(/.test(TODO_JS));
chk('loadConflictosDesdeFirestore ya no está definida',
    !/function\s+loadConflictosDesdeFirestore\s*\(/.test(TODO_JS));

// ═══ 2 · Nadie las llama (solo pueden quedar mencionadas en comentarios) ═══
// Quita las líneas que son puro comentario (// ... o * ... de un bloque /* */)
// para que una mención documental en un comentario no cuente como código vivo.
function soloCodigoVivo(texto) {
    return texto.split('\n').filter(function(linea) {
        return !/^\s*\/\//.test(linea) && !/^\s*\*/.test(linea);
    }).join('\n');
}
const vivoJS = soloCodigoVivo(TODO_JS);

function soloEnComentarios(nombreFn, texto) {
    return soloCodigoVivo(texto).indexOf(nombreFn + '(') === -1;
}
chk('Ningún archivo JS llama a syncConteoAtomicoPorArea(',
    soloEnComentarios('syncConteoAtomicoPorArea', TODO_JS));
chk('Ningún archivo JS llama a _cargarYAgeregarConteos(',
    soloEnComentarios('_cargarYAgeregarConteos', TODO_JS));
chk('Ningún archivo JS llama a loadConflictosDesdeFirestore(',
    soloEnComentarios('loadConflictosDesdeFirestore', TODO_JS));
chk('El arranque ya no dispara loadConflictosDesdeFirestore()',
    !/loadConflictosDesdeFirestore\(\)\.catch/.test(arranque));

// ═══ 3 · La colección conteoAreas ya no se escribe ni se lee ═══════════════
chk('Ninguna consulta real a Firestore usa collection(\'conteoAreas\')',
    !/collection\(\s*['"]conteoAreas['"]\s*\)/.test(vivoJS));
// index.html embebe una copia de referencia de firestore.rules como
// documentación (no ejecuta reglas desde ahí); esa mención histórica se deja
// tal cual — lo que importa es que el CLIENTE ya no llame a esa colección.

// ═══ 4 · La bandera de conflicto sigue viva, ahora en _hayConflicto ════════
chk('_recalcAdminAggregatedConteo ya no depende de alerta_conflicto en código vivo',
    soloCodigoVivo(invDatos).indexOf('alerta_conflicto') === -1);
chk('_recalcAdminAggregatedConteo compara abiertas, no solo enteras, para _hayConflicto',
    /_hayConflicto:\s*entries\.length > 1 &&\s*\n\s*entries\.some\(e => \(e\.d\.enteras \|\| 0\) !== \(winner\.enteras \|\| 0\)\s*\n?\s*\|\| _abiertasDivergen\(e\.d\.abiertas, winner\.abiertas\)\)/.test(invDatos));
chk('Existe el comparador _abiertasDivergen con tolerancia de coma flotante',
    /function _abiertasDivergen\(a, b\)[\s\S]{0,600}?Math\.abs\(.*\) > 0\.001/.test(invDatos));
chk('La tarjeta de conteo (85) usa _hayConflicto, no alerta_conflicto en código vivo',
    /areaData\._hayConflicto/.test(uiInv) && soloCodigoVivo(uiInv).indexOf('alerta_conflicto') === -1);
chk('El buscador de conteo (80) usa _hayConflicto, no alerta_conflicto en código vivo',
    /d\._hayConflicto/.test(buscador) && soloCodigoVivo(buscador).indexOf('alerta_conflicto') === -1);

// ═══ 5 · Control negativo: conteoMultiUsuario sigue intacto ════════════════
// (Es un sistema legacy DISTINTO — syncConteoPorUsuarioToFirestore, en
// js/10-multiusuario.js — que esta fase NO toca a propósito.)
chk('syncConteoPorUsuarioToFirestore sigue definida (fuera de alcance de 8C)',
    /async function syncConteoPorUsuarioToFirestore\(area\)/.test(multi));
chk('syncConteoPorUsuarioToFirestore se sigue llamando al finalizar un área',
    /syncConteoPorUsuarioToFirestore\(area\)/.test(flujo));
chk('conteoMultiUsuario se sigue escribiendo (set con merge)',
    /collection\('conteoMultiUsuario'\)/.test(multi) &&
    /await areaRef\.set\(payload, \{ merge: true \}\);/.test(multi));

// ═══ 6 · El reset de auditoría ya solo limpia conteoMultiUsuario ═══════════
chk('resetConteoAtomicoEnFirestore ya no existe (se renombró)',
    !/function\s+resetConteoAtomicoEnFirestore\s*\(/.test(firest));
chk('resetConteoMultiUsuarioEnFirestore existe y borra conteoMultiUsuario',
    /async function resetConteoMultiUsuarioEnFirestore\(\)[\s\S]{0,900}?collection\('conteoMultiUsuario'\)/.test(firest));
chk('resetConteoMultiUsuarioEnFirestore ya NO borra conteoAreas',
    !(/async function resetConteoMultiUsuarioEnFirestore\(\)[\s\S]*?\n        \}/.exec(firest) || [''])[0]
        .includes("collection('conteoAreas')"));
chk('auditoriaResetear() llama a la función renombrada',
    /await resetConteoMultiUsuarioEnFirestore\(\);/.test(flujo));

// ═══ 7 · _pendingAreaSyncs (mecanismo exclusivo del retiro) desaparece ═════
chk('_pendingAreaSyncs ya no se usa en ningún archivo JS',
    !/_pendingAreaSyncs/.test(TODO_JS.split('\n').filter(function(l) {
        return !/^\s*\/\//.test(l) && !/^\s*\*/.test(l);
    }).join('\n')));

// ═══ Resultado ═════════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(function(c) { return c.nombre.length; }));
console.log('\n  ── FASE 8C · retiro de conteoAreas ──\n');
casos.forEach(function(c) {
    console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
                (c.ok ? '' : '   ← ' + c.detalle));
});
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) +
            ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
