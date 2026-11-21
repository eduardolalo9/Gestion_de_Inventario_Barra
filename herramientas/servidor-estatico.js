#!/usr/bin/env node
/**
 * Servidor estático para las pruebas de navegador (sin dependencias).
 *   node herramientas/servidor-estatico.js [puerto]
 *
 * Desde v5.57 index.html ya trae la política FINAL (herramientas/csp-hashes.js). CSP_ESTRICTO=1 la recalcula; CSP_LAXA=1 sirve la
 * anterior (con 'unsafe-inline'), solo para probar el modo «sombra». Antes (v5.53): CSP_ESTRICTO=1 servía index.html sin 'unsafe-inline' en
 * script-src y con el hash sha256 de cada <script> en línea. Sirve para correr TODA la suite de
 * Chromium bajo la política que se quiere en producción y comprobar que ningún botón dependía de
 * un manejador en línea (v5.53). Sin la variable, sirve index.html tal cual.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const RAIZ = path.join(__dirname, '..');
const PUERTO = parseInt(process.argv[2] || process.env.PUERTO || '8080', 10);
const ESTRICTO = process.env.CSP_ESTRICTO === '1';
const LAXA = process.env.CSP_LAXA === '1';   // solo para probar el modo «sombra» del despachador (la política anterior a v5.57)
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json' };

const { hashesEnLinea, aplicarCspEstricto, aplicarCspLaxa } = require('./csp-hashes');

function atender(req, res) {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.normalize(path.join(RAIZ, p));
    if (!f.startsWith(RAIZ) || f.includes(path.sep + 'node_modules' + path.sep) || f.includes(path.sep + '.git' + path.sep)) { res.writeHead(403); return res.end('403'); }
    fs.readFile(f, (e, buf) => {
        if (e) { res.writeHead(404); return res.end('404'); }
        const cab = { 'Content-Type': TIPOS[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' };
        if (path.basename(f) === 'index.html') {
            // Desde v5.57 index.html YA es estricto: CSP_ESTRICTO es redundante (y recalcula por si se probó un index.html editado).
            if (LAXA) buf = Buffer.from(aplicarCspLaxa(buf.toString('utf8')), 'utf8');
            else if (ESTRICTO) buf = Buffer.from(aplicarCspEstricto(buf.toString('utf8')), 'utf8');
        }
        res.writeHead(200, cab); res.end(buf);
    });
}

if (require.main === module) {
    http.createServer(atender).listen(PUERTO, '127.0.0.1', () => { if (process.env.SERVIDOR_VERBOSO) console.log('Servidor en http://127.0.0.1:' + PUERTO + (ESTRICTO ? ' (CSP ESTRICTO)' : '')); });
}

module.exports = { hashesEnLinea, aplicarCspEstricto };
