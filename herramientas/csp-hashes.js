#!/usr/bin/env node
/**
 * csp-hashes.js — política de contenido (CSP) ESTRICTA de index.html: sin 'unsafe-inline' en script-src y con el hash
 * sha256 de cada <script> en línea. Auditoría de seguridad A-1 (v5.57).
 *
 *   node herramientas/csp-hashes.js --escribir     recalcula los hashes y reescribe el <meta> de index.html
 *   node herramientas/csp-hashes.js --verificar    sale con 1 si index.html tiene hashes desfasados (lo corre la prueba v5.57)
 *
 * POR QUÉ HACE FALTA: con una CSP sin 'unsafe-inline' el navegador solo ejecuta un script en línea si su hash está en la
 * política. Si alguien edita UNO de los 4 scripts en línea de index.html (tema, comprobador de versión, registro del
 * service worker, configuración de Firebase) y no recalcula el hash, ese script deja de ejecutarse y la app no arranca.
 * Por eso: después de tocar un <script> de index.html, corre `node herramientas/csp-hashes.js --escribir`. Si se te olvida,
 * la prueba «prueba-v557-csp-hashes» falla en CI antes de que llegue a producción.
 *
 * Los manejadores en línea (onclick="…") NO se hashean: los ejecuta js/02-despachador-eventos.js (ver ahí).
 * style-src conserva 'unsafe-inline' a propósito (hay estilos en línea por toda la app y el riesgo es mucho menor).
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RAIZ = path.join(__dirname, '..');
const META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/;

/** Hash CSP ('sha256-…') de cada <script> en línea (los que no tienen src), en orden de aparición. */
function hashesEnLinea(html) {
    const out = [];
    // Los comentarios HTML pueden mencionar «<script>» (index.html los tiene): se quitan ANTES de buscar, si no la búsqueda
    // arranca en el comentario y calcula el hash de «comentario + script», que no existe.
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    html.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, function (m, cuerpo) {
        out.push("'sha256-" + crypto.createHash('sha256').update(cuerpo, 'utf8').digest('base64') + "'");
        return m;
    });
    return out;
}

function _reescribirScriptSrc(html, fn) {
    if (!META.test(html)) throw new Error('csp-hashes: no se encontró el <meta http-equiv="Content-Security-Policy">');
    return html.replace(META, function (m, a, pol, c) {
        if (!/script-src[^;]*/.test(pol)) throw new Error('csp-hashes: la política no tiene script-src');
        return a + pol.replace(/script-src([^;]*)/, function (mm, fuentes) { return 'script-src' + fn(fuentes); }) + c;
    });
}

/** Política ESTRICTA, idempotente: quita 'unsafe-inline' y cualquier hash viejo, y agrega los hashes vigentes. */
function aplicarCspEstricto(html) {
    const hashes = Array.from(new Set(hashesEnLinea(html)));
    return _reescribirScriptSrc(html, function (fuentes) {
        const base = fuentes.replace(/\s*'unsafe-inline'/g, '').replace(/\s*'sha256-[A-Za-z0-9+\/=]+'/g, '').replace(/\s+$/, '');
        return base + ' ' + hashes.join(' ');
    });
}

/** Política LAXA (solo para pruebas del modo «sombra»): con 'unsafe-inline' y SIN hashes (con hashes presentes el navegador ignora 'unsafe-inline'). */
function aplicarCspLaxa(html) {
    return _reescribirScriptSrc(html, function (fuentes) {
        const base = fuentes.replace(/\s*'unsafe-inline'/g, '').replace(/\s*'sha256-[A-Za-z0-9+\/=]+'/g, '').replace(/\s+$/, '');
        return base + " 'unsafe-inline'";
    });
}

/** Resumen de la política de un HTML: { scriptSrc, tieneUnsafeInline, hashes } (para pruebas y avisos). */
function leerPolitica(html) {
    const m = META.exec(html);
    const pol = m ? m[2] : '';
    const ss = (/script-src([^;]*)/.exec(pol) || [])[1] || '';
    return { politica: pol, scriptSrc: ss, tieneUnsafeInline: /'unsafe-inline'/.test(ss), hashes: (ss.match(/'sha256-[A-Za-z0-9+\/=]+'/g) || []) };
}

module.exports = { hashesEnLinea, aplicarCspEstricto, aplicarCspLaxa, leerPolitica };

if (require.main === module) {
    const arg = process.argv[2];
    const ruta = path.join(RAIZ, 'index.html');
    const html = fs.readFileSync(ruta, 'utf8');
    const nuevo = aplicarCspEstricto(html);
    if (arg === '--escribir') {
        if (nuevo !== html) { fs.writeFileSync(ruta, nuevo); console.log('index.html: política CSP actualizada (' + leerPolitica(nuevo).hashes.length + ' hashes).'); }
        else console.log('index.html: la política CSP ya estaba al día (' + leerPolitica(nuevo).hashes.length + ' hashes).');
    } else if (arg === '--verificar') {
        if (nuevo !== html) { console.error('index.html tiene hashes de CSP DESFASADOS: corre  node herramientas/csp-hashes.js --escribir'); process.exit(1); }
        console.log('index.html: hashes de CSP al día.');
    } else {
        console.error('Uso: node herramientas/csp-hashes.js --escribir | --verificar'); process.exit(2);
    }
}
