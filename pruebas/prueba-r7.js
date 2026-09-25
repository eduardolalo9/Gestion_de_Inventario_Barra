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
chk('Y el fin de mes, que NO cierra semana pero sí se puede contabilizar',
    /No cierra semana[\s\S]{0,40}el inicial del lunes seguirá saliendo/.test(flujo),
    'es la regla 4 dicha donde el administrador la necesita');
// H-40 (hotfix 4.9): decisión explícita del dueño — un inventario fuera de
// domingo/fin de mes NUNCA podrá contabilizarse (evaluarContabilizable lo
// rechaza para siempre tras cerrarlo), así que ahora SÍ se bloquea al
// crear, en vez de solo avisar. Defensa en dos capas: el botón se
// deshabilita en la pantalla, y confirmarNuevoInventario() lo vuelve a
// comprobar por si el estado del botón se pierde.
chk('Fuera de domingo/fin de mes se deshabilita el botón de crear',
    /no es domingo ni fin de mes[\s\S]{0,400}btn\.disabled = true/.test(flujo));
chk('…y confirmarNuevoInventario() lo bloquea también, no solo la pantalla',
    /cierraSemana && !_cl\.esCorteMensual\)[\s\S]{0,200}?return;/.test(flujo));
chk('La fecha por defecto ya no es "hoy": se propone la próxima fecha válida',
    /proximaFechaRecuentoValida\(new Date\(\)\)/.test(flujo),
    'proponer "hoy" casi siempre generaba un inventario que no se podía contabilizar');

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
// Contabilizar en Conteo: la pregunta pasó de "¿no está CERRADO?" a
// "¿está abierto?", porque un CONTABILIZADO no es CERRADO y bloqueaba crear.
chk('No se abre con un inventario sin cerrar',
    /if \(inventarioAbierto\(_inventarioActivo\)\)/.test(abrir),
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
// Esta comprobación decía 'NO define Contabilizado': en R7 Lalo había
// descartado el tercer estado. La decisión N-3 lo autoriza expresamente
// ('FASE 3 añade únicamente CONTABILIZADO'), así que lo que hay que vigilar
// ya no es su ausencia sino que sea el ÚNICO que se añadió y que esté
// explicado, no solo pintado.
const _glosario = (flujo.match(/const ESTADOS_INVENTARIO = \{[\s\S]*?\n        \};/) || [''])[0];
chk('Define Contabilizado, y ningún estado más (N-3)',
    /CONTABILIZADO: \{[\s\S]{0,300}?stock inicial de la semana siguiente/.test(_glosario) &&
    (_glosario.match(/^            [A-Z_]+: \{/gm) || []).length === 3,
    'el glosario debe tener exactamente tres estados');
// PREMIUM (22-sep-2026) — el dueño pidió quitar el cuadro "Sin Inventario
// Físico abierto" con el glosario. La función sigue existiendo (y probada en
// prueba-f3-navegador), pero ya no se pinta en el estado vacío.
chk('PREMIUM · el glosario ya no se pinta en el estado vacío (decisión del dueño)',
    !/html \+= renderGlosarioEstados\(\)/.test(uiInv));

// ═══ 8 · El botón y el estado vacío ═════════════════════════════════════
chk('El botón abre el formulario, ya no crea directo',
    /onclick="abrirModalNuevoInventario\(\)"/.test(uiInv));
chk('Ya no hay un botón que llame a auditoriaResetear',
    !/onclick="auditoriaResetear\(\)"/.test(uiInv));
chk('El estado vacío invita a crear (botón directo) y deja ver el historial',
    /➕ Crear Inventario Físico/.test(uiInv) && /📜 Historial de inventarios/.test(uiInv));
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

// ═══ 10.5 · H-40 (hotfix 4.9): registrar fecha en un inventario legado ══
// El caso real que lo motivó: un inventario abierto creado antes de esta
// regla no tiene fechaRecuento, así que jamás se podrá contabilizar tras
// cerrarlo (evaluarContabilizable lo rechaza para siempre). Esto deja
// completarla UNA vez, sin violar la inmutabilidad de FASE 7.
chk('Existe abrirModalRegistrarFechaRecuento()', /function abrirModalRegistrarFechaRecuento\(\)/.test(flujo));
chk('Solo el administrador con permiso puede abrirlo',
    /function abrirModalRegistrarFechaRecuento[\s\S]{0,120}isAdmin\(\)[\s\S]{0,40}hasPermission\('inventory\.create'\)/.test(flujo));
chk('No se ofrece si el inventario ya tiene fecha registrada',
    /function abrirModalRegistrarFechaRecuento[\s\S]{0,700}_inventarioActivo\.fechaRecuento\)[\s\S]{0,200}return;/.test(flujo));
chk('★ confirmarRegistrarFechaRecuento() relee el documento del SERVIDOR antes de escribir',
    /function confirmarRegistrarFechaRecuento[\s\S]{0,1400}await ref\.get\(\)/.test(flujo),
    'no se confía en el estado en memoria: pudo cambiar entre abrir el modal y pulsar Guardar');
chk('★ No escribe si el servidor ya tenía fechaRecuento (evita una carrera entre dos admins)',
    /if \(inv\.fechaRecuento\) \{[\s\S]{0,250}return;/.test(flujo));
chk('★ No escribe si el inventario ya no está abierto (FASE 7: nada retroactivo sobre CERRADO/CONTABILIZADO)',
    /if \(!inventarioAbierto\(inv\)\) \{[\s\S]{0,250}return;/.test(flujo));
chk('Solo escribe fechaRecuento y semanaId — nada más del documento',
    /ref\.update\(\{ fechaRecuento: fecha, semanaId: cl\.semanaId \}\)/.test(flujo));
chk('La fecha se valida con la misma regla que "Nuevo Inventario" (domingo o fin de mes)',
    /function confirmarRegistrarFechaRecuento[\s\S]{0,600}!cl\.cierraSemana && !cl\.esCorteMensual/.test(flujo));
chk('El encabezado ofrece el botón solo mientras el inventario sigue abierto',
    /!esCerrado && isAdmin\(\) && hasPermission\('inventory\.create'\)\)[\s\S]{0,200}abrirModalRegistrarFechaRecuento/.test(uiInv));
chk('Sin fechaRecuento, el encabezado avisa en vez de mostrar una línea vacía',
    /Recuento: no registrado \(inventario creado antes de esta regla\)/.test(uiInv));

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
