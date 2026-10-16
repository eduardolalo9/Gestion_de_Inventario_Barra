#!/usr/bin/env node
/**
 * prueba-limpieza-codigo-muerto.js — v5.26 · limpieza de código muerto
 * ═══════════════════════════════════════════════════════════════════════════
 * El informe de hallazgos consolidados listaba 8 funciones como "código
 * muerto" a verificar y borrar. Antes de borrar cada una se comprobó, en
 * TODO el repositorio (js/*.js, index.html Y pruebas/*.js), que no quedara
 * ningún punto de llamada real — no solo en el código de producción, sino
 * también en las pruebas existentes, que a veces documentan una decisión
 * deliberada de CONSERVAR una función aunque su UI se haya quitado.
 *
 * Resultado de esa verificación: de las 8, solo 4 eran código muerto de
 * verdad. Las otras 4 tenían una razón real para seguir ahí:
 *
 *   · totalPublicadoDesuscribir() — NO estaba muerta: le faltaba su único
 *     punto de llamada razonable. El listener que abre (js/51, suscrito
 *     desde js/47) nunca se cerraba en NINGÚN lado, ni siquiera al cerrar
 *     sesión — a diferencia de CUALQUIER otro listener de la app (ver
 *     ETAPA 14.1.1/v5.22 en js/auth.js). Es un hallazgo de fuga de listener,
 *     no limpieza: se corrigió añadiendo la llamada que faltaba.
 *   · existenciaComparacion() — prueba-fase8.js (v5.24) ya documenta que se
 *     quitó la TARJETA de Inicio que la mostraba (pedido de Eduardo), pero
 *     que la función de cálculo se conserva a propósito. prueba-fase8-
 *     navegador.js la sigue invocando. Se deja intacta.
 *   · renderGlosarioEstados() — prueba-r7.js exige que la función exista
 *     ("Existe el glosario") y solo prueba que NO se pinta en el estado
 *     vacío de Conteo ("decisión del dueño") — no que se haya eliminado.
 *     prueba-f3-navegador.js la sigue invocando. Se deja intacta.
 *   · costoPorUnidadBase() — prueba-recetario1.js prueba su comportamiento
 *     directamente (prioriza conversion sobre capacidadMl; nunca inventa
 *     un costo con 0) y prueba-fase11a.js solo exige que costoReceta() YA
 *     NO la use (porque asumía mililitros) — no que la función desaparezca.
 *     Se deja intacta.
 *
 * Las 4 que SÍ eran código muerto real (cero referencias en js/*.js,
 * index.html y pruebas/*.js, fuera de su propia definición) se borraron:
 *   guardarCorreccionProducto, saveInventorySnapshot, abrirPapelera,
 *   _resetMiConteoLocal.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

function extraerFuncion(fuente, nombre) {
    const m = new RegExp('(async\\s+)?function ' + nombre + '\\(').exec(fuente);
    if (!m) return null;
    let nivel = 0, dentro = false;
    for (let j = m.index; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(m.index, j + 1); }
    }
    return null;
}

const invDatos  = leer('js/45-inventario-datos.js');
const invFisico = leer('js/85-ui-inventario-fisico.js');
const papelera  = leer('js/53-papelera.js');
const auth      = leer('js/auth.js');
const flujo     = leer('js/75-auditoria-flujo.js');
const existencia = leer('js/47-existencia.js');
const recetario  = leer('js/91-recetario.js');

// ── Las 4 que de verdad eran código muerto: ya no existen ──────────────────
chk('★ guardarCorreccionProducto() se borró de js/45 (sin punto de llamada en todo el repositorio)',
    !extraerFuncion(invDatos, 'guardarCorreccionProducto'));
chk('★ _resetMiConteoLocal() se borró de js/45 (su lógica ya estaba duplicada, a propósito, en handleAuditSessionChange)',
    !extraerFuncion(invDatos, '_resetMiConteoLocal'));
chk('★ saveInventorySnapshot() se borró de js/85 (modelo "inventories" legacy, sustituido por el Inventario Físico de Firestore)',
    !extraerFuncion(invFisico, 'saveInventorySnapshot'));
chk('★ abrirPapelera() se borró de js/53 (el sidebar entra con switchTab(\'papelera\') directo, no con este wrapper)',
    !extraerFuncion(papelera, 'abrirPapelera'));
chk('abrirPapelera ya no se exporta a window (no queda una referencia colgando a una función borrada)',
    !/window\.abrirPapelera/.test(papelera));
chk('Las demás exportaciones de papelera.js siguen intactas (no se borró de más)',
    /window\.papeleraCargar\s*=/.test(papelera) && /window\.renderPapeleraTab\s*=/.test(papelera));

// ── Las 4 que NO se tocaron — verificadas contra las pruebas que ya exigían conservarlas ──
chk('★ existenciaComparacion() se CONSERVÓ (prueba-fase8.js ya documenta que es deliberado — solo se quitó su tarjeta de Inicio)',
    !!extraerFuncion(existencia, 'existenciaComparacion'));
chk('★ renderGlosarioEstados() se CONSERVÓ (prueba-r7.js exige que exista — "decisión del dueño" fue no pintarla en el vacío, no borrarla)',
    !!extraerFuncion(flujo, 'renderGlosarioEstados'));
chk('★ costoPorUnidadBase() se CONSERVÓ (prueba-recetario1.js prueba su comportamiento directamente)',
    !!extraerFuncion(recetario, 'costoPorUnidadBase') && /window\.costoPorUnidadBase/.test(recetario));

// ── El hallazgo real encontrado al verificar: fuga del listener de Total publicado ──
chk('★ El logout (js/auth.js) ahora también desuscribe el Total publicado — antes era el ÚNICO listener de la app que sobrevivía a un logout',
    /Sin sesión[\s\S]{0,1200}syncVivoDetener\(\)[\s\S]{0,1200}totalPublicadoDesuscribir\(\)/.test(auth));
chk('typeof-guard consistente con el resto del bloque de limpieza (mismo patrón que _unsubMainDoc, syncVivoDetener, etc.)',
    /if \(typeof totalPublicadoDesuscribir === 'function'\) totalPublicadoDesuscribir\(\);/.test(auth));

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Limpieza de código muerto — 4 borradas, 4 conservadas, 1 fuga de listener corregida (v5.26) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
