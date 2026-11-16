#!/usr/bin/env node
/**
 * Servidor estático para las pruebas de navegador (sin dependencias).
 *   node herramientas/servidor-estatico.js [puerto]
 *
 * Con CSP_ESTRICTO=1 sirve index.html con la política FINAL de contenido: sin 'unsafe-inline' en
 * script-src y con el hash sha256 de cada <script> en línea. Sirve para correr TODA la suite de
 * Chromium bajo la política que se quiere en producción y comprobar que ningún botón dependía de
 * un manejador en línea (v5.53). Sin la variable, sirve index.html tal cual.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const RAIZ = path.join(__dirname, '..');
const PUERTO = parseInt(process.argv[2] || process.env.PUERTO || '8080', 10);
const ESTRICTO = process.env.CSP_ESTRICTO === '1';
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json' };

/** Hash CSP ('sha256-…') de cada <script> en línea (los que no tienen src). */
function hashesEnLinea(html) {
    const out = [];
    // OJO: los comentarios HTML pueden mencionar «<script>» (index.html los tiene). Se quitan ANTES de buscar,
    // si no la búsqueda arranca en el comentario y calcula un hash de «comentario + script» que no existe.
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    html.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (_, cuerpo) => {
        out.push("'sha256-" + crypto.createHash('sha256').update(cuerpo, 'utf8').digest('base64') + "'");
        return _;
    });
    return out;
}

/** Política estricta: quita 'unsafe-inline' de script-src y agrega los hashes de los scripts en línea. */
function aplicarCspEstricto(html) {
    const hashes = hashesEnLinea(html).join(' ');
    return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (m, a, pol, c) => {
        const nueva = pol.replace(/script-src([^;]*)/, (mm, fuentes) => 'script-src' + fuentes.replace(/\s*'unsafe-inline'/, '') + ' ' + hashes);
        return a + nueva + c;
    });
}

function atender(req, res) {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.normalize(path.join(RAIZ, p));
    if (!f.startsWith(RAIZ) || f.includes(path.sep + 'node_modules' + path.sep) || f.includes(path.sep + '.git' + path.sep)) { res.writeHead(403); return res.end('403'); }
    fs.readFile(f, (e, buf) => {
        if (e) { res.writeHead(404); return res.end('404'); }
        const cab = { 'Content-Type': TIPOS[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' };
        if (ESTRICTO && path.basename(f) === 'index.html') buf = Buffer.from(aplicarCspEstricto(buf.toString('utf8')), 'utf8');
        res.writeHead(200, cab); res.end(buf);
    });
}

if (require.main === module) {
    http.createServer(atender).listen(PUERTO, '127.0.0.1', () => { if (process.env.SERVIDOR_VERBOSO) console.log('Servidor en http://127.0.0.1:' + PUERTO + (ESTRICTO ? ' (CSP ESTRICTO)' : '')); });
}

module.exports = { hashesEnLinea, aplicarCspEstricto };
