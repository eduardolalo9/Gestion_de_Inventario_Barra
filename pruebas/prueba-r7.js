#!/usr/bin/env node
/**
 * prueba-r7.js — R7: crear el Inventario Físico desde un formulario
 * ═══════════════════════════════════════════════════════════════════════════
 * Antes, crear un inventario eran dos cuadros de texto seguidos con "¿estás
 * seguro?". No se elegía nada: ni las áreas, ni la fecha, ni quedaba dicho
 * para qué era ese conteo.
 *
 * Lo que esta prueba defiende:
 *
 *   · El número lo asigna el servidor con una transacción, no el formulario.
 *     Dos administradores creando a la vez no pueden llevarse el mismo.
 *   · La bandera que salta las confirmaciones se apaga SIEMPRE. Si quedara
 *     encendida, el siguiente intento de crear un inventario se saltaría los
 *     avisos sin que nadie lo pidiera — y esa acción borra todos los conteos.
 *   · Los inventarios creados antes de R7 no tienen ninguno de los campos
 *     nuevos, y la pantalla no puede romperse por eso.
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

const html  = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const flujo = fs.readFileSync(path.join(RAIZ, 'js/75-auditoria-flujo.js'), 'utf8');
const datos = fs.readFileSync(path.join(RAIZ, 'js/45-inventario-datos.js'), 'utf8');
const uiInv = fs.readFileSync(path.join(RAIZ, 'js/85-ui-inventario-fisico.js'), 'utf8');

// ═══ 1 · El formulario existe y pide lo que tiene que pedir ══════════════
chk('Hay modal de nuevo inventario', /id="nuevoInventarioModal"/.test(html));
[['nuevoInvNombre', 'nombre'], ['nuevoInvFecha', 'fecha del recuento'],
 ['nuevoInvCreadoPor', 'creado por'], ['nuevoInvAreas', 'áreas de conteo'],
 ['nuevoInvComentario', 'comentario']].forEach(function(par) {
    chk('El formulario pide ' + par[1], html.indexOf('id="' + par[0] + '"') !== -1);
});
chk('El comentario tiene tope de longitud', /id="nuevoInvComentario"[^>]*maxlength="300"/.test(html));

// El número NO se escribe: es lo que evita que dos admin choquen.
chk('El formulario NO tiene campo de número',
    !/id="nuevoInvNumero"/.test(html),
    'el número lo asigna el servidor con una transacción');
chk('Se explica que el número se asigna solo',
    /El número se asigna solo al crearlo/.test(html));
chk('La numeración sigue siendo transaccional',
    /_db\.runTransaction/.test(datos) && /ultimoNumero/.test(datos));

// ═══ 2 · Áreas ═══════════════════════════════════════════════════════════
chk('Las áreas del formulario salen de la configuración',
    /areasDefinidas\(\)\.map/.test(flujo), 'no de una lista fija de tres');
chk('Todas llegan marcadas por defecto',
    /class="nuevoInvArea" value="' \+ escapeHtml\(a\.id\) \+ '" checked/.test(flujo));
chk('Sin ninguna área marcada no se crea',
    /if \(!areas\.length\)[\s\S]{0,200}?Elige al menos un área/.test(flujo));
chk('Las áreas elegidas quedan congeladas en el inventario',
    /warehousesSnapshot: _areasDelNuevoInventario\(\)/.test(datos));
chk('Se descarta un área que ya no existe',
    /o\.areas\.filter\(function\(a\) \{ return AREAS_CONTEO\.indexOf\(a\) !== -1; \}\)/.test(datos),
    'una lista guardada puede nombrar un área que el admin borró entre medias');
chk('Sin selección se usan todas las áreas',
    /return AREAS_CONTEO\.slice\(\);/.test(datos));

// ═══ 3 · Fecha, apoyada en el calendario de R4 ══════════════════════════
chk('La fecha se propone con el día de hoy en hora local',
    /fechaISOLocal\(new Date\(\)\)/.test(flujo),
    'toISOString daría el día anterior en México');
chk('La fecha se valida antes de crear',
    /parseFechaLocal\(fecha\)/.test(flujo));
chk('Se avisa a qué semana pertenece la fecha',
    /clasificarRecuento\(f\.value\)/.test(flujo));
chk('Se distingue el domingo, que cierra semana',
    /cl\.cierraSemana[\s\S]{0,200}?cierra la/.test(flujo));
chk('Y el fin de mes, que NO la cierra',
    /No cierra semana: el inicial del lunes seguirá saliendo del domingo/.test(flujo),
    'es la regla 4 dicha donde el administrador la necesita');
chk('El aviso no bloquea: solo informa',
    !/return;[\s\S]{0,80}?_pintarAvisoFechaNuevoInv/.test(flujo),
    'contar a media semana es legítimo');

// ═══ 4 · La bandera de confirmación ═════════════════════════════════════
chk('Existe el envoltorio de confirmación', /function _confirmarOSaltar\(/.test(flujo));
chk('Con la bandera apagada se comporta como siempre',
    /if \(_saltarConfirmacionNuevoInv\) \{ alAceptar\(\); return; \}\s*\n?\s*showConfirm\(mensaje, alAceptar\);/.test(flujo));

const iniReset = flujo.indexOf('function auditoriaResetear() {');
const finReset = flujo.indexOf('function reabrirArea(area) {');
const reset    = (iniReset !== -1 && finReset > iniReset) ? flujo.slice(iniReset, finReset) : '';
chk('auditoriaResetear se pudo aislar', reset.length > 500);
chk('Sus dos confirmaciones pasan por el envoltorio',
    (reset.match(/_confirmarOSaltar\(/g) || []).length === 2);
chk('Y ya no llama a showConfirm directamente',
    !/showConfirm\(/.test(reset));

// Esto es lo más importante del archivo: la bandera tiene que apagarse aunque
// la creación falle a mitad. Dejarla encendida haría que el siguiente intento
// borrara todos los conteos sin preguntar.
chk('La bandera se apaga en un finally',
    /_saltarConfirmacionNuevoInv = true;[\s\S]{0,200}?finally \{[\s\S]{0,120}?_saltarConfirmacionNuevoInv = false;/.test(flujo),
    'si quedara encendida, el siguiente intento se saltaría los avisos');

// ═══ 5 · Guardas antes de abrir el formulario ═══════════════════════════
const iniAbrir = flujo.indexOf('function abrirModalNuevoInventario() {');
const abrir    = iniAbrir !== -1 ? flujo.slice(iniAbrir, iniAbrir + 1400) : '';
chk('Solo el admin abre el formulario',
    /!isAdmin\(\) \|\| !hasPermission\('inventory\.create'\)/.test(abrir));
chk('No se abre con un inventario sin cerrar',
    /_inventarioActivo\.estado !== 'CERRADO'/.test(abrir),
    'crear otro perdería los conteos en curso');
chk('No se abre sin conexión',
    /!navigator\.onLine/.test(abrir),
    'el número se pide al servidor: sin red no hay número');

// ═══ 6 · La tarjeta muestra lo que se capturó ═══════════════════════════
chk('La tarjeta muestra la fecha de recuento', /inv\.fechaRecuento/.test(uiInv));
chk('…y a qué semana pertenece',               /etiquetaSemana\(inv\.fechaRecuento\)/.test(uiInv));
chk('…y las áreas del inventario',             /inv\.warehousesSnapshot\.map/.test(uiInv));
chk('…y el comentario',                        /inv\.comentario/.test(uiInv));
chk('…y cuántos usuarios están contando',      /_usuariosContando\(\)/.test(uiInv));
chk('Los usuarios contando se resaltan si los hay',
    /_contando \? 'var\(--accent\)' : 'var\(--txt-muted\)'/.test(uiInv),
    'es el dato que el admin mira antes de cerrar');

// Retrocompatibilidad: los inventarios anteriores a R7 no traen estos campos.
chk('Cada campo nuevo se lee con su guarda',
    /if \(inv\.fechaRecuento\)/.test(uiInv) &&
    /if \(Array\.isArray\(inv\.warehousesSnapshot\)/.test(uiInv) &&
    /if \(inv\.comentario\)/.test(uiInv),
    'un inventario de antes de R7 no puede romper la pantalla');
chk('Las opciones del formulario se leen a la defensiva',
    /function _opcNuevoInv\(campo, porDefecto\)/.test(datos),
    'por el camino antiguo _opcionesNuevoInventario es null');

// ═══ 7 · Glosario de estados ════════════════════════════════════════════
chk('Existe el glosario',            /function renderGlosarioEstados\(/.test(flujo));
chk('Define Sincronizado',           /SINCRONIZADO: \{[\s\S]{0,200}?Conteo en curso/.test(flujo));
chk('Define Cerrado',                /CERRADO: \{[\s\S]{0,220}?inmutable/.test(flujo));
chk('NO define Contabilizado',       !/CONTABILIZADO/.test(flujo),
    'Lalo lo descartó: solo hay dos estados');
chk('El glosario aparece con el inventario vacío',
    /renderGlosarioEstados === 'function'\) html \+= renderGlosarioEstados\(\)/.test(uiInv));

// ═══ 8 · El botón y el estado vacío ═════════════════════════════════════
chk('El botón abre el formulario, ya no crea directo',
    /onclick="abrirModalNuevoInventario\(\)"/.test(uiInv));
chk('Ya no hay un botón que llame a auditoriaResetear',
    !/onclick="auditoriaResetear\(\)"/.test(uiInv));
chk('El estado vacío invita a crear',
    /Sin Inventario Físico abierto/.test(uiInv));
chk('Y dice algo distinto a un bartender',
    /todavía no ha abierto el inventario de esta semana/.test(uiInv),
    'no se ofrece un botón que no puede pulsar');

// ═══ 9 · Ya no quedan "3 áreas" escritas a mano ════════════════════════
chk('El progreso cuenta las áreas reales',
    /AREAS_CONTEO\.length \+ ' áreas<\/div>/.test(uiInv),
    'con una cuarta área, "/ 3" mostraría 4 / 3');
chk('La confirmación lista las áreas reales',
    /AREAS_CONTEO\.map\(function\(a\) \{ return areasAuditoria\[a\]; \}\)\.join/.test(flujo));
chk('No quedan "/3 áreas" en la pantalla de inventario',
    !/\/3 áreas/.test(uiInv) && !/ \/ 3 áreas/.test(uiInv));

// ═══ 10 · Caché ═════════════════════════════════════════════════════════
const vTags = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
chk('R7 subió la versión de caché por encima de 3.2',
    vTags.length === 1 && parseFloat(vTags[0]) > 3.2,
    'versiones encontradas: ' + vTags.join(', '));

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── R7 · crear el Inventario Físico desde un formulario ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');

process.exit(fallos ? 1 : 0);
