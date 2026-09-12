#!/usr/bin/env node
/**
 * prueba-r1.js — R1: conteo en oz, decimales y fin del motivo de cambio
 * ═══════════════════════════════════════════════════════════════════════════
 * Reglas cubiertas: 13 (decimales), 14 (casilla de conteo en oz), 16 (fuera
 * el motivo de cambio).
 *
 * Lo que de verdad vigila esta prueba es la RETROCOMPATIBILIDAD. El riesgo de
 * R1 no es que la casilla nueva no funcione: es que los 424 productos que ya
 * existen, y que no tienen el campo, cambien de modo de conteo al actualizar
 * la app. Eso reinterpretaría conteos ya guardados y movería el inventario
 * sin que nadie hubiera tocado nada.
 *
 * La función tieneConversion NO se copia aquí: se extrae del archivo real y
 * se ejecuta. Una copia probaría que la copia funciona.
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

const html   = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const conv   = fs.readFileSync(path.join(RAIZ, 'js/70-conversion-render.js'), 'utf8');
const uiProd = fs.readFileSync(path.join(RAIZ, 'js/85-ui-inventario-fisico.js'), 'utf8');
const roles  = fs.readFileSync(path.join(RAIZ, 'js/50-roles-permisos.js'), 'utf8');
const audit  = fs.readFileSync(path.join(RAIZ, 'js/75-auditoria-flujo.js'), 'utf8');
const importa= fs.readFileSync(path.join(RAIZ, 'js/90-ciclo-admin.js'), 'utf8');
const expor  = fs.readFileSync(path.join(RAIZ, 'js/95-exportacion.js'), 'utf8');

// ═══ 1 · Extraer y EJECUTAR la lógica real del modo de conteo ══════════════
// Se toman las dos funciones tal como están escritas en el archivo. Si alguien
// las reescribe mal, esta prueba lo ve; si las renombra, falla la extracción,
// que también es información.
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

const fnDatos = extraer(conv, 'tieneDatosConversion');
const fnConv  = extraer(conv, 'tieneConversion');
chk('tieneDatosConversion existe en 70-conversion-render.js', !!fnDatos);
chk('tieneConversion existe en 70-conversion-render.js',      !!fnConv);

let tieneConversion = null;
if (fnDatos && fnConv) {
    const ctx = vm.createContext({});
    vm.runInContext(fnDatos + '\n' + fnConv + '\nglobalThis._tc = tieneConversion;', ctx);
    tieneConversion = ctx._tc;
}

if (tieneConversion) {
    const DATOS = { capacidadMl: 750, pesoBotellaLlenaOz: 44.65 };

    // EL CASO QUE IMPORTA: producto creado antes de R1. No tiene el campo.
    // Tiene que seguir contándose en oz, exactamente como ayer.
    chk('Producto anterior a R1 (sin la casilla) conserva el conteo en oz',
        tieneConversion(Object.assign({}, DATOS)) === true,
        'un producto ya capturado no puede cambiar de modo al actualizar la app');

    chk('Casilla explícita en true cuenta en oz',
        tieneConversion(Object.assign({}, DATOS, { conteoOzHabilitado: true })) === true);

    chk('Casilla explícita en false NO cuenta en oz',
        tieneConversion(Object.assign({}, DATOS, { conteoOzHabilitado: false })) === false,
        'es la única forma de apagar el conteo en oz de un producto que ya lo tenía');

    // Sin los dos números la conversión daría NaN. La casilla no puede forzarlo.
    chk('Casilla en true pero SIN capacidad ni peso no cuenta en oz',
        tieneConversion({ conteoOzHabilitado: true }) === false);
    chk('Casilla en true con capacidad pero sin peso no cuenta en oz',
        tieneConversion({ capacidadMl: 750, conteoOzHabilitado: true }) === false);
    chk('Capacidad 0 no habilita el conteo en oz',
        tieneConversion({ capacidadMl: 0, pesoBotellaLlenaOz: 44.65, conteoOzHabilitado: true }) === false);

    chk('null se trata como "no definido" y conserva el modo anterior',
        tieneConversion(Object.assign({}, DATOS, { conteoOzHabilitado: null })) === true,
        'null es lo que se graba en Firestore cuando el producto es anterior a R1');

    chk('Producto inexistente no rompe la función',
        tieneConversion(null) === false && tieneConversion(undefined) === false);
} else {
    chk('Se pudo ejecutar la lógica real del modo de conteo', false, 'no se extrajeron las funciones');
}

// ═══ 2 · Regla 16 — el motivo de cambio desapareció de la interfaz ═════════
chk('El selector de motivo ya no está en index.html',
    !/id="inv_motivo"/.test(html) && !/id="inv_motivoContainer"/.test(html),
    'quedan restos del selector de motivo');
chk('No queda el mensaje de error del motivo',
    !/inv_motivoError/.test(html) && !/inv_motivoError/.test(conv));
chk('saveInventarioModal ya no lee el motivo del usuario',
    !/getElementById\('inv_motivo'\)/.test(conv));
chk('No se valida un motivo obligatorio',
    !/Debes seleccionar un motivo/.test(conv) && !/Debes seleccionar un motivo/.test(html));
// El historial sí conserva un motivo automático: la trazabilidad no se pierde,
// solo se deja de pedirle al bartender que la escriba.
chk('El historial sigue registrando un motivo automático',
    /motivoFinal\s*=\s*'Conteo'/.test(conv),
    'sin esto el historial de auditoría perdería la columna Motivo');

// ═══ 3 · Regla 14 — la casilla existe y está cableada ═════════════════════
chk('El formulario de producto tiene la casilla de conteo en oz',
    /id="productConteoOz"/.test(html));
chk('La casilla se re-evalúa al escribir capacidad y peso',
    (html.match(/oninput="_sincronizarCasillaOz\(\)"/g) || []).length >= 2,
    'capacidad y peso deben recalcular si la casilla puede activarse');
chk('_sincronizarCasillaOz está definida',  /function _sincronizarCasillaOz\(/.test(uiProd));
chk('_ponerCasillaOz está definida',        /function _ponerCasillaOz\(/.test(uiProd));
chk('_leerCasillaOz está definida',         /function _leerCasillaOz\(/.test(uiProd));
chk('Al abrir un producto la casilla se puebla con su modo real',
    /_ponerCasillaOz\(tieneConversion\(product\)\)/.test(uiProd),
    'sin esto, abrir y guardar un producto antiguo lo cambiaría de modo en silencio');
chk('saveProduct guarda conteoOzHabilitado al editar y al crear',
    (uiProd.match(/conteoOzHabilitado\s*=\s*_leerCasillaOz\(/g) || []).length === 2,
    'tiene que escribirse en las dos ramas');

// ═══ 4 · Regla 14 — los dos modos de captura en el modal ══════════════════
chk('El modal tiene el bloque de botella y el de cantidad',
    /id="inv_bloqueBotella"/.test(html) && /id="inv_bloqueCantidad"/.test(html));
chk('El campo de cantidad total existe',  /id="inv_cantidadTotal"/.test(html));
chk('Solo se muestra uno de los dos bloques a la vez',
    /bloqueBot\.style\.display\s*=\s*usaBotella\s*\?\s*''\s*:\s*'none'/.test(conv) &&
    /bloqueCant\.style\.display\s*=\s*usaBotella\s*\?\s*'none'\s*:\s*''/.test(conv),
    'mostrar los dos permitiría capturar la misma cantidad por dos caminos');

// ═══ 5 · Regla 13 — decimales donde corresponde ═══════════════════════════
chk('El campo de cantidad total admite milésimas',
    /id="inv_cantidadTotal"[^>]*step="0\.001"/.test(html), 'golos 0.490 KG');
chk('El campo de cantidad total usa teclado decimal en el móvil',
    /id="inv_cantidadTotal"[^>]*inputmode="decimal"/.test(html));
chk('Botellas enteras sigue siendo entero (la fracción va en Abiertas)',
    /Las botellas enteras deben ser número entero/.test(conv));
chk('La cantidad total se redondea a 3 decimales al guardar',
    /Math\.round\(cant \* 1000\) \/ 1000/.test(conv),
    'evita que 0.1+0.2 se guarde como 0.30000000000000004');
chk('La cantidad total rechaza notación científica',
    /if \(\/e\/i\.test\(rawCant\)\)/.test(conv), '1e5 no puede colarse como 100000');
chk('La cantidad total conserva el tope de 9999',
    /if \(cant > 9999\)/.test(conv));

// ═══ 6 · El modo de conteo viaja con el producto ══════════════════════════
// Estas cuatro proyecciones copian campos uno por uno. Si el campo no viaja,
// el producto llega sin la casilla, se lee como "anterior a R1" y vuelve a
// contarse en oz aunque el administrador lo hubiera apagado.
chk('El reporte de auditoría lleva el modo de conteo',
    /conteoOzHabilitado:\s*\(typeof p\.conteoOzHabilitado === 'boolean'\)/.test(roles));
chk('Al reconstruir el reporte manda lo grabado, no el catálogo actual',
    /conteoOzHabilitado:\s*\(typeof p\.conteoOzHabilitado === 'boolean'\)\s*\n?\s*\?\s*p\.conteoOzHabilitado\s*:\s*catalog\.conteoOzHabilitado/.test(roles));
chk('El cierre de inventario congela el modo de conteo',
    /conteoOzHabilitado:\s*\(typeof p\.conteoOzHabilitado === 'boolean'\)/.test(audit));
chk('Los productos congelados del cierre conservan el modo',
    /conteoOzHabilitado:\s*r\.conteoOzHabilitado/.test(audit));

// ═══ 7 · Excel: ida y vuelta sin perder el modo ═══════════════════════════
chk('La importación reconoce una columna ConteoOz',
    /conteoOz:\s*\['ConteoOz'/.test(importa));
chk('Sin capacidad ni peso, la importación fuerza el modo cantidad',
    /if \(capacidadMl === null \|\| pesoBotellaLlenaOz === null\) \{\s*\n\s*product\.conteoOzHabilitado = false;/.test(importa));
chk('Si el Excel no trae la columna, se deduce el comportamiento de siempre',
    /product\.conteoOzHabilitado = true;/.test(importa));
chk('La exportación escribe la columna ConteoOz',
    /headerRow\.push\('ConteoOz'\)/.test(expor));
chk('La exportación y la importación usan el mismo nombre de columna',
    /headerRow\.push\('ConteoOz'\)/.test(expor) && /'ConteoOz'/.test(importa),
    'si no coinciden, exportar y reimportar pierde el modo');

// ═══ 8 · Caché: la versión tiene que subir ════════════════════════════════
// Es el fallo más difícil de diagnosticar de esta PWA: index.html nuevo
// sirviendo js viejo desde la caché del Service Worker.
const vTags = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
chk('R1 subió la versión de caché por encima de 2.6',
    vTags.length === 1 && parseFloat(vTags[0]) > 2.6,
    'versiones encontradas: ' + vTags.join(', '));

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── R1 · conteo en oz, decimales y fin del motivo ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');

process.exit(fallos ? 1 : 0);
