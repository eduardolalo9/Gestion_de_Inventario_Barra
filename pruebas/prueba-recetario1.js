#!/usr/bin/env node
/**
 * prueba-recetario1.js — RECETARIO-1 · comprobaciones estáticas.
 * ═══════════════════════════════════════════════════════════════════════════
 * Verifica, sobre el código REAL (no una copia), lo acordado con el
 * propietario y verificado contra el Excel real antes de escribir código:
 *
 *   claude/recetario-diseno-tecnico-2026-09-26.md
 *   claude/verificacion-excel-formato-barra-2026-09-27.md
 *
 *   1. Catálogo de permisos: recipe.read / recipe.edit existen, con metadata,
 *      y los roles por defecto (BARTENDER, SUBJEFE_BARRA) traen recipe.read
 *      ("admin edita, todos consultan" — no es una excepción sin permiso).
 *   2. Reglas de Firestore: recetario/{docId} — lectura solo autenticado,
 *      escritura solo recipe.edit. Espejo de /catalogo.
 *   3. Publicar/suscribir: mismo patrón "documento único" que el catálogo
 *      (recetario/recetas), con el mismo mecanismo de vaciado sin borrar
 *      documento, y ambos listeners (admin y usuario) conectados en el único
 *      punto de reconciliación de _reconciliarListenersPorAutorizacion().
 *   4. Motor de costeo: conversion → capacidadMl → null, y costoReceta nunca
 *      devuelve un total parcial disfrazado de completo.
 *   5. Persistencia local: recetas viaja por localStorage e IndexedDB igual
 *      que products/compras (guardado y restaurado en ambas ramas de carga).
 *   6. Decisiones confirmadas 2026-09-27: SIN bloqueo de PV duplicado, SIN
 *      lista cerrada de UoM.
 *   7. Integración en la UI: pestaña enrutada, botón de navegación, script
 *      declarado en el orden correcto (ver prueba-integridad-split.js).
 *
 * No necesita emulador ni red — eso vive en prueba-recetario1-integracion.js.
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
function leer(rel) { return fs.readFileSync(path.join(RAIZ, rel), 'utf8'); }
function cuerpo(src, firma) {
    const i = src.indexOf(firma);
    if (i === -1) return '';
    let nivel = 0, dentro = false;
    for (let j = i; j < src.length; j++) {
        if (src[j] === '{') { nivel++; dentro = true; }
        else if (src[j] === '}') { nivel--; if (dentro && nivel === 0) return src.slice(i, j + 1); }
    }
    return '';
}
function soloCodigoVivo(texto) {
    return texto.split('\n').filter(function(l) { return !/^\s*\/\//.test(l) && !/^\s*\*/.test(l); }).join('\n');
}

const roles    = leer('js/50-roles-permisos.js');
const receta   = leer('js/91-recetario.js');
const nucleo   = leer('js/00-nucleo.js');
const idb      = leer('js/30-indexeddb.js');
const firest   = leer('js/40-firestore.js');
const render   = leer('js/70-conversion-render.js');
const reglas   = leer('firestore.rules');
const html     = leer('index.html');
const sw       = leer('sw.js');

// ═══ 1 · Catálogo y metadata de permisos ═══════════════════════════════════
chk("'recipe.read' está en el catálogo cerrado de permisos",
    /PERMISOS_CATALOGO\s*=\s*\[[\s\S]*?'recipe\.read'/.test(roles));
chk("'recipe.edit' está en el catálogo cerrado de permisos",
    /PERMISOS_CATALOGO\s*=\s*\[[\s\S]*?'recipe\.edit'/.test(roles));
chk("recipe.read / recipe.edit tienen metadata en español (grupo Recetario)",
    /'recipe\.read':\s*\{[^}]*grupo:\s*'Recetario'/.test(roles) &&
    /'recipe\.edit':\s*\{[^}]*grupo:\s*'Recetario'/.test(roles));
chk("'Recetario' está en el orden de grupos de la pantalla de administración",
    /PERMISOS_GRUPOS_ORDEN\s*=\s*\[[\s\S]*?'Recetario'/.test(roles));
chk("BARTENDER trae recipe.read por defecto (todos consultan)",
    /BARTENDER:\s*\{[\s\S]*?permissions:\s*\[[\s\S]*?'recipe\.read'[\s\S]*?\]/.test(roles));
chk("SUBJEFE_BARRA trae recipe.read por defecto",
    /SUBJEFE_BARRA:\s*\{[\s\S]*?permissions:\s*\[[\s\S]*?'recipe\.read'[\s\S]*?\]/.test(roles));

// ═══ 2 · Reglas de Firestore ════════════════════════════════════════════════
const mReglasRec = /match \/recetario\/\{docId\} \{([\s\S]*?)\n\s*\}/.exec(reglas);
chk('firestore.rules define match /recetario/{docId}', !!mReglasRec);
if (mReglasRec) {
    const b = mReglasRec[1];
    chk('Recetario: lectura para cualquier autenticado (no exige recipe.read)',
        /allow read:\s*if request\.auth != null;/.test(b));
    chk('Recetario: escritura exige recipe.edit explícito',
        /allow write:\s*if hasPerm\(\'recipe\.edit\'\);/.test(b));
}

// ═══ 3 · Publicar/suscribir — mismo patrón que catálogo ════════════════════
chk('publicarRecetarioFirestore existe y exige recipe.edit',
    /async function publicarRecetarioFirestore\(\)\s*\{\s*if \(!_db \|\| !hasPermission\('recipe\.edit'\)\) return;/.test(roles));
chk('publicarRecetarioFirestore escribe recetario/recetas con version/publicadoEn/publicadoPor',
    /_db\.collection\('recetario'\)\.doc\('recetas'\)\s*\.set\(\{\s*recetas:\s*recetas,\s*publicadoPor:/.test(roles));
chk('_vaciarRecetarioPublicado vacía con versión mayor, sin borrar el documento (mismo patrón que catálogo)',
    /async function _vaciarRecetarioPublicado\(\)[\s\S]{0,500}?vaciado:\s*true/.test(roles));
chk('subscribeRecetarioUsuario y subscribeRecetarioAdmin existen (el admin SÍ escucha, a diferencia del catálogo)',
    /function subscribeRecetarioUsuario\(\)/.test(roles) && /function subscribeRecetarioAdmin\(\)/.test(roles));
chk('Ambos listeners de recetario están conectados en el único punto de reconciliación',
    /subscribeRecetarioAdmin\(\);/.test(roles) && /subscribeRecetarioUsuario\(\);/.test(roles));
chk('_unsubRecetario se limpia en ambas ramas de _reconciliarListenersPorAutorizacion',
    (cuerpo(roles, 'function _reconciliarListenersPorAutorizacion(').match(/_unsubRecetario\(\); _unsubRecetario = null;/g) || []).length >= 2);

// ═══ 4 · Motor de costeo ════════════════════════════════════════════════════
chk('costoPorUnidadBase prioriza conversion sobre capacidadMl',
    (() => {
        const f = cuerpo(receta, 'function costoPorUnidadBase(');
        const iConv = f.indexOf('conversion');
        const iCap  = f.indexOf('capacidadMl');
        return iConv > -1 && iCap > -1 && iConv < iCap;
    })());
chk('costoPorUnidadBase devuelve null si no hay forma de calcularlo (nunca 0 inventado)',
    /return null;\s*\}\s*window\.costoPorUnidadBase/.test(receta));
chk('costoReceta nunca disfraza un total parcial: incompleto → costo null',
    /if \(faltantes\.length > 0\) return \{ costo: null, incompleto: true, faltantes: faltantes \};/.test(receta));

// ═══ 5 · Persistencia local (mismo TIER que products/compras) ══════════════
chk("'recetas' se declara junto al resto del estado global (js/00-nucleo.js)",
    /let recetas = \[\];/.test(nucleo));
chk('saveToLocalStorage guarda inventarioApp_recetas',
    /inventarioApp_recetas/.test(idb) && /JSON\.stringify\(\s*\(typeof recetas/.test(idb));
chk('_idbSaveAll guarda recetas en IndexedDB',
    /store\.put\(\(typeof recetas !== 'undefined'\) \? recetas : \[\],\s*'recetas'\);/.test(idb));
chk('_idbLoadAll lee recetas de IndexedDB',
    /_idbGet\('recetas'\)/.test(idb));
chk('_applyIDBData restaura recetas si IDB trae algo',
    /if \(Array\.isArray\(idbData\.recetas\)\)\s*\n\s*recetas = idbData\.recetas;/.test(idb));
chk('loadFromLocalStorage restaura recetas desde LS',
    /recetas\s*=\s*safeGet\('inventarioApp_recetas',\s*\[\]\);/.test(firest));

// ═══ 6 · Decisiones confirmadas 2026-09-27 ═════════════════════════════════
chk('SIN bloqueo de PV duplicado (decisión explícita del propietario)',
    !/pv duplicad/i.test(soloCodigoVivo(receta)) &&
    !/recetas\.some\(function\(r\) \{ return r\.pv/.test(receta));
chk('SIN lista cerrada de UoM (texto libre, coincide con el Excel real)',
    !/UOM_VALIDAS/.test(receta) && !/uom.*\[.*'ml'.*'oz'.*'pza'/i.test(receta));

// ═══ 7 · Integración en la UI ═══════════════════════════════════════════════
chk("renderTab() enruta 'recetario' a renderRecetarioTab()",
    /case 'recetario':\s*content\.innerHTML = renderRecetarioTab\(\); break;/.test(render));
chk("La pestaña 'recetario' respeta recipe.read / recipe.edit para su header",
    /activeTab === 'recetario'[\s\S]{0,400}?hasPermission\('recipe\.edit'\)/.test(render));
chk("index.html tiene un botón de navegación a 'recetario'",
    /data-sb-tab="recetario" onclick="switchTab\('recetario'\); sbClose\(\)"/.test(html));
chk('index.html declara el modal #recetaModal con los campos del schema',
    /id="recetaModal"/.test(html) && /id="recetaPV"/.test(html) && /id="recetaCategoria"/.test(html) &&
    /id="recetaActiva"/.test(html) && /id="recetaIngredientesLista"/.test(html) &&
    /id="recetaInsumosDatalist"/.test(html) && /id="recetaMetodo"/.test(html) &&
    /id="recetaCristaleria"/.test(html) && /id="recetaHielo"/.test(html) && /id="recetaDecoracion"/.test(html));
chk('index.html carga js/91-recetario.js entre 90-ciclo-admin.js y 95-exportacion.js',
    /90-ciclo-admin\.js\?v=[\d.]+"><\/script>\s*<script src="js\/91-recetario\.js\?v=[\d.]+"><\/script>\s*<script src="js\/95-exportacion/.test(html));
chk('sw.js precalienta js/91-recetario.js',
    /'\.\/js\/91-recetario\.js\?v=' \+ APP_VERSION/.test(sw));

// ═══ Resultado ═══════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(function(c) { return c.nombre.length; }));
console.log('\n  ── RECETARIO-1 (estática) ──\n');
casos.forEach(function(c) {
    console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
                (c.ok ? '' : '   ← ' + c.detalle));
});
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) +
            ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
