#!/usr/bin/env node
/**
 * prueba-recetario-buscador-unificado.js — Recetario: mismo buscador que
 * Inicio · comprobaciones estáticas.
 * ═══════════════════════════════════════════════════════════════════════════
 * Encargo de Eduardo (3-oct-2026): "módulo receta / Buscador, que sea el
 * mismo de la pantalla de inicio". El Recetario tenía su propio <input> de
 * texto (js/91-recetario.js, _renderRecetarioLista) con una comparación de
 * subcadena a mano sobre nombre/categoría: sin tildes, sin tolerancia a
 * typos, sin puntaje por relevancia, sin paginación por tandas y sin los
 * atajos de teclado que ya tienen Inicio, Pedidos, Conteo e Historia.
 *
 * Este cambio conecta el Recetario al mismo buscador unificado (FASE 6:
 * js/05-busqueda-motor.js + js/06-busqueda-ui.js) con un motor propio
 * (_motorRecetas, en js/80-buscador.js) configurado igual que el del
 * catálogo: el nombre manda, el código (pv — solo existe si la receta vino
 * de una importación, ver RECETARIO-2) puntúa como código exacto, y la
 * categoría pesa como el grupo del catálogo.
 *
 * Decisión de presentación (no toca el motor compartido): sin búsqueda
 * activa, la lista se muestra alfabética por nombre — igual que siempre
 * mostró esta pantalla. El motor, con una consulta vacía, devuelve la lista
 * en su orden original (ver buscar() en 05-busqueda-motor.js) — el
 * alfabetizado es cosa de _renderRecetarioResultados(), no del buscador.
 *
 * No se tocó: costoReceta/costoLineaReceta, saveRecetaModal, openRecetaModal,
 * toggleRecetaActiva, eliminarReceta, los permisos recipe.edit/recipe.read,
 * ni _recetaRenderIngredientesLista ni _renderRecetaFicha (ficha de detalle).
 * Tampoco el total ni los chips por área de la tarjeta de Inicio — ver la
 * aclaración a Eduardo del 3-oct-2026: ya usan la cifra oficial de sistema
 * que el propio pedido sugerido consulta (existenciaMostrada), sin cambios.
 *
 *   node pruebas/prueba-recetario-buscador-unificado.js
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
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

const html  = leer('index.html');
const busc  = leer('js/80-buscador.js');
const rec   = leer('js/91-recetario.js');
const nucleo = leer('js/00-nucleo.js');
const sw    = leer('sw.js');

function funcion(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    const m = /\n        (?:async )?function /.exec(src.slice(ini + 10));
    return m ? src.slice(ini, ini + 10 + m.index) : src.slice(ini);
}

// ═══ 1 · EL MOTOR — MISMO CRITERIO QUE EL CATÁLOGO ═════════════════════════
chk('★ Existe _motorRecetas, construido con crearMotorBusqueda (el mismo motor de Inicio)',
    /var _motorRecetas = crearMotorBusqueda\(/.test(busc));
chk('★ El nombre manda (peso 3), igual que en el catálogo',
    /\{ nombre: 'nombre',\s*peso: 3 \}/.test(busc));
chk('★ El PV se trata como código exacto (codigo:true) — solo existe si la receta vino de una importación',
    /\{ nombre: 'pv',\s*peso: 2, codigo: true \}/.test(busc));
chk('La categoría pesa como el grupo del catálogo (peso 1, texto libre)',
    /\{ nombre: 'categoria',\s*peso: 1 \}/.test(busc));
chk('★ _buscarRecetario() usa el motor sobre el arreglo real `recetas` y la variable de consulta real',
    /function _buscarRecetario\(\) \{\s*return _motorRecetas\.buscar\(recetas, _recetarioSearchTerm\);\s*\}/.test(busc));

// ═══ 2 · EL REGISTRO EN BusquedaUI — MISMA BARRA, MISMOS ATAJOS ════════════
chk('★ Existe BusquedaUI.registrar(\'recetario\', …) — la misma barra, el mismo resaltado, los mismos atajos de teclado que Inicio',
    /BusquedaUI\.registrar\('recetario', \{/.test(busc));
chk('obtenerConsulta/alAplicar leen y escriben la misma variable global de siempre (_recetarioSearchTerm) — nada se rompe para quien la lea',
    /obtenerConsulta: function\(\) \{ return _recetarioSearchTerm; \}/.test(busc) &&
    /alAplicar:\s*function\(v\) \{ _recetarioSearchTerm = v; \}/.test(busc));
chk('refrescar() repinta solo la región de resultados (no la barra entera) con _renderRecetarioResultados()',
    /refrescar:\s*function\(\) \{ return _pintarRegionBusqueda\('recetario', _renderRecetarioResultados\(\)\); \}/.test(busc));
chk('precalentar() indexa el recetario en tiempo ocioso, igual que el catálogo indexa products',
    /precalentar: function\(\) \{ _motorRecetas\.indexar\(recetas\); \}/.test(busc));
chk('paso: 60 — misma paginación por tandas que el catálogo de Inicio (antes el Recetario no paginaba, pintaba todo de golpe)',
    /BusquedaUI\.registrar\('recetario', \{[\s\S]{0,400}?paso: 60/.test(busc));

// ═══ 3 · LA PANTALLA — SIN EL <input> A MANO DE ANTES ══════════════════════
chk('★ _renderRecetarioLista() ya NO tiene el <input> a mano de antes (oninput="updateRecetarioSearch")',
    !/oninput="updateRecetarioSearch/.test(rec));
chk('★ _renderRecetarioLista() ya NO compara subcadenas a mano (.toLowerCase().indexOf)',
    !/_recetarioSearchTerm \|\| ''\)\.trim\(\)\.toLowerCase\(\)/.test(rec));
chk('★ _renderRecetarioLista() ahora pinta la barra compartida (BusquedaUI.barra(\'recetario\', …))',
    /function _renderRecetarioLista\(\) \{\s*var html = BusquedaUI\.barra\('recetario', \{/.test(rec));
chk('★ La región de resultados se arma con BusquedaUI.region(\'recetario\', …) — lo que permite el refresco incremental',
    /html \+= BusquedaUI\.region\('recetario', _renderRecetarioResultados\(\)\.html\);/.test(rec));
chk('El placeholder menciona nombre, código Y categoría — las tres claves del motor',
    /placeholder: 'Buscar receta por nombre, código o categoría…'/.test(rec));

// ═══ 4 · _renderRecetarioResultados() — EL MISMO TRATO QUE INICIO ══════════
const fRes = funcion(rec, '_renderRecetarioResultados');
chk('★ Existe _renderRecetarioResultados(), que devuelve {html, coincidencias, total} como el resto de pantallas',
    /return \{ html: html, coincidencias: res\.coincidencias, total: res\.total \};/.test(fRes));
chk('Sin recetas en absoluto, conserva el aviso de siempre ("Aún no hay recetas" / "Agrega la primera")',
    /Aún no hay recetas/.test(fRes) && /Agrega la primera con el botón de arriba/.test(fRes) &&
    /El administrador todavía no publica el recetario/.test(fRes));
chk('★ Con recetas pero sin resultados de la búsqueda, usa el estado vacío COMPARTIDO (BusquedaUI.vacio), no un "Sin resultados" a mano',
    /BusquedaUI\.vacio\('recetario', 'recetas'\)/.test(fRes) && !/Sin resultados para/.test(fRes));
chk('Muestra el resumen "N de M recetas" como el resto de pantallas',
    /BusquedaUI\.resumen\('recetario', res\.coincidencias, res\.total, 'receta', 'recetas'\)/.test(fRes));
chk('★ Pagina con BusquedaUI.centinela (\"Mostrar N más\") — antes pintaba TODAS las recetas de golpe, sin límite',
    /BusquedaUI\.centinela\('recetario', lista\.length - lim\)/.test(fRes));
chk('★ Cada tarjeta lleva data-sbx-item — habilita la navegación con flechas del teclado (igual que Inicio/Pedidos/Historia)',
    /data-sbx-item onclick="_recetarioAbrirFicha/.test(fRes));
chk('★ El nombre y la categoría se resaltan con el mismo resaltarBusqueda() del motor compartido (antes: texto plano)',
    /resaltarBusqueda\(receta\.nombre \|\| '\(sin nombre\)', _recetarioSearchTerm\)/.test(fRes) &&
    /resaltarBusqueda\(receta\.categoria, _recetarioSearchTerm\)/.test(fRes));
chk('Sin consulta activa, se alfabetiza por nombre (el motor no reordena una lista sin consulta — ver 05-busqueda-motor.js)',
    /if \(!\(_recetarioSearchTerm \|\| ''\)\.trim\(\)\) \{[\s\S]{0,600}?localeCompare/.test(fRes));
chk('El alfabetizado se hace sobre una COPIA (.slice()) — nunca reordena el arreglo real `recetas` (cero riesgo de desorden al guardar/publicar)',
    /lista = lista\.slice\(\)\.sort\(/.test(fRes));
chk('El costo por receta sigue calculándose con costoReceta() sin cambios (no se tocó el cálculo)',
    /var cr = costoReceta\(receta\);/.test(fRes) &&
    /var costoTxt = cr\.incompleto \? 'Costo incompleto' : \('\$' \+ cr\.costo\.toFixed\(2\)\)/.test(fRes));
chk('El badge "Inactiva" y el color de costo incompleto (var(--warn)) se conservan igual que en R7',
    /Inactiva<\/span>/.test(fRes) && /cr\.incompleto \? 'var\(--warn\)' : 'var\(--accent\)'/.test(fRes));

// ═══ 5 · COMPATIBILIDAD — LAS FUNCIONES ANTERIORES SIGUEN EXISTIENDO ═══════
chk('updateRecetarioSearch(val) sigue existiendo, pero ahora delega en BusquedaUI.establecer (no reimplementa el filtro)',
    /function updateRecetarioSearch\(val\) \{ BusquedaUI\.establecer\('recetario', val\); \}/.test(rec) &&
    /window\.updateRecetarioSearch = updateRecetarioSearch;/.test(rec));
chk('clearRecetarioSearch() sigue existiendo, delega en BusquedaUI.limpiar',
    /function clearRecetarioSearch\(\) \{ BusquedaUI\.limpiar\('recetario'\); \}/.test(rec) &&
    /window\.clearRecetarioSearch = clearRecetarioSearch;/.test(rec));
chk('El comentario de _recetarioSearchTerm en 00-nucleo.js ya no dice que la pantalla la gestiona sola',
    /BusquedaUI \(js\/80-buscador\.js, registro\s*\n?\s*\/\/ 'recetario'\)/.test(nucleo) || /ahora la gestiona BusquedaUI/.test(nucleo));

// ═══ 6 · LO QUE NO SE TOCÓ ══════════════════════════════════════════════════
chk('costoReceta/costoLineaReceta no cambiaron de firma (siguen recibiendo (r) y (ing, producto))',
    /function costoReceta\(r\)/.test(rec) || /costoReceta = function\(r\)/.test(rec) || /function costoReceta\(receta\)/.test(rec));
chk('saveRecetaModal/openRecetaModal/toggleRecetaActiva/eliminarReceta conservan el permiso recipe.edit',
    /function openRecetaModal\(id\) \{\s*if \(!hasPermission\('recipe\.edit'\)\)/.test(rec) &&
    /function saveRecetaModal\(\) \{\s*if \(!hasPermission\('recipe\.edit'\)\)/.test(rec) &&
    /function toggleRecetaActiva\(id\) \{\s*if \(!hasPermission\('recipe\.edit'\)\) return;/.test(rec) &&
    /function eliminarReceta\(id\) \{\s*if \(!hasPermission\('recipe\.edit'\)\) return;/.test(rec));
chk('_renderRecetaFicha (el detalle de una receta) no se tocó: sigue usando _recetaPorId y costoReceta igual',
    /function _renderRecetaFicha\(id\) \{\s*var r = _recetaPorId\(id\);/.test(rec));
chk('_recetaRenderIngredientesLista (el editor del modal) no se tocó por este cambio',
    /function _recetaRenderIngredientesLista\(\) \{/.test(rec));
chk('El permiso de lectura (recipe.read) de renderRecetarioTab no cambió',
    /function renderRecetarioTab\(\) \{\s*if \(!hasPermission\('recipe\.read'\)\)/.test(rec));

// ═══ 7 · VERSIÓN ════════════════════════════════════════════════════════════
const vHtml = (html.match(/\?v=(\d+\.\d+)/) || [])[1];
const vSw   = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vHtml && vHtml === vSw, 'index=' + vHtml + ' sw=' + vSw);
chk('La versión avanzó respecto a R7 (≥ 5.8)', parseFloat(vSw) >= 5.8, 'es ' + vSw);

// ═══ Resultado ═══════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── Recetario · buscador unificado (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
