#!/usr/bin/env node
/**
 * verificar-respaldo.js — comprueba que un respaldo JSON (el que genera respaldo-firestore.js) CONTIENE datos de verdad.
 *
 *   node herramientas/verificar-respaldo.js respaldo-AAAA-MM-DD.json          resumen + comprobaciones
 *   node herramientas/verificar-respaldo.js respaldo.json --json              lo mismo en JSON
 *
 * Sale con 0 si todo está bien, 1 si hay un problema GRAVE (vacío, proyecto equivocado, sin usuarios), 2 si el archivo no es un
 * respaldo. Lo corre el workflow ANTES de cifrar (un respaldo vacío se guarda en silencio y es peor que ninguno) y tú, después de
 * descifrar uno, para saber que sirve ANTES de necesitarlo:
 *   gpg --decrypt respaldo-….json.gpg > respaldo.json   y luego   node herramientas/verificar-respaldo.js respaldo.json
 */
'use strict';
const fs = require('fs');

/** Cuenta documentos EXISTENTES de un nodo copiado por respaldo-firestore.js (recursivo por subcolecciones). */
function contarNodo(nodo) {
    let n = nodo && nodo.__existe ? 1 : 0;
    Object.keys((nodo && nodo.subcolecciones) || {}).forEach(function(k) { n += contarColeccion(nodo.subcolecciones[k]); });
    return n;
}
function contarColeccion(lista) { return (lista || []).reduce(function(a, d) { return a + contarNodo(d); }, 0); }

const ESPERADAS = ['compras', 'ventas', 'inventories', 'movimientos'];   // subcolecciones que una barra en uso debe tener

/** Devuelve { ok, graves[], avisos[], resumen{} } de un objeto de respaldo ya leído. */
function analizar(r) {
    const graves = [], avisos = [], resumen = { generado: r && r.__generado, proyecto: r && r.__proyecto, secciones: {} };
    if (!r || typeof r !== 'object' || r.__version === undefined) return { ok: false, noEsRespaldo: true, graves: ['El archivo no es un respaldo de BarInventory (falta __version).'], avisos, resumen };
    if (r.__emulador) graves.push('Es un respaldo del EMULADOR, no de producción.');
    const raiz = r.inventarioApp;
    if (!raiz || !raiz.__existe) graves.push('Falta el documento principal inventarioApp/' + (r.__docPrincipal || '?') + ' (¿credenciales del proyecto equivocado?).');
    const subs = (raiz && raiz.subcolecciones) || {};
    Object.keys(subs).forEach(function(k) { resumen.secciones['inventarioApp/' + k] = contarColeccion(subs[k]); });
    Object.keys(r.raiz || {}).forEach(function(k) { resumen.secciones[k] = contarColeccion(r.raiz[k]); });
    resumen.total = (raiz ? contarNodo(raiz) : 0) + Object.keys(r.raiz || {}).reduce(function(a, k) { return a + contarColeccion(r.raiz[k]); }, 0);
    if (!resumen.total) graves.push('El respaldo no trae NINGÚN documento.');
    if (!(resumen.secciones.usuarios > 0)) graves.push('No trae usuarios: sin ellos no se podría volver a entrar tras restaurar.');
    ESPERADAS.forEach(function(k) { if (!(resumen.secciones['inventarioApp/' + k] > 0)) avisos.push('La sección «' + k + '» está vacía (normal solo si aún no se usa).'); });
    Object.keys(raiz && raiz.subcolecciones || {}).forEach(function(k) { /* truncados */
        (subs[k] || []).forEach(function(d) { if (d && d.__truncado) avisos.push('Documento truncado por profundidad: ' + d.__ruta); });
    });
    if (r.__generado) {
        const dias = (Date.now() - Date.parse(r.__generado)) / 86400000;
        resumen.antiguedadDias = Math.round(dias * 10) / 10;
        if (dias > 8) avisos.push('El respaldo tiene ' + Math.round(dias) + ' días: el semanal debería ser de la última semana.');
    }
    return { ok: graves.length === 0, graves, avisos, resumen };
}

module.exports = { analizar, contarNodo, contarColeccion };

if (require.main === module) {
    const archivo = process.argv[2];
    if (!archivo || archivo.indexOf('--') === 0) { console.error('Uso: node herramientas/verificar-respaldo.js respaldo.json [--json]'); process.exit(2); }
    let datos;
    try { datos = JSON.parse(fs.readFileSync(archivo, 'utf8')); }
    catch (e) { console.error('No se pudo leer ' + archivo + ': ' + e.message); process.exit(2); }
    const a = analizar(datos);
    if (process.argv.indexOf('--json') !== -1) { console.log(JSON.stringify(a, null, 1)); process.exit(a.noEsRespaldo ? 2 : (a.ok ? 0 : 1)); }
    console.log('\n  Respaldo de ' + (a.resumen.proyecto || '?') + ' generado ' + (a.resumen.generado || '?') + (a.resumen.antiguedadDias !== undefined ? ' (hace ' + a.resumen.antiguedadDias + ' días)' : ''));
    Object.keys(a.resumen.secciones || {}).forEach(function(k) { console.log('    ' + (a.resumen.secciones[k] + '').padStart(7) + '  ' + k); });
    console.log('    ' + ('' + (a.resumen.total || 0)).padStart(7) + '  TOTAL de documentos\n');
    a.avisos.forEach(function(x) { console.log('  ⚠️  ' + x); });
    a.graves.forEach(function(x) { console.log('  ❌ ' + x); });
    console.log(a.ok ? '\n  ✅ El respaldo sirve.\n' : '\n  ❌ El respaldo NO sirve.\n');
    process.exit(a.noEsRespaldo ? 2 : (a.ok ? 0 : 1));
}
