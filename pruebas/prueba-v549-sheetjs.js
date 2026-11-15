// v5.49 — Auditoría C-3: SheetJS 0.20.3 se sirve desde el propio origen (no desde cdnjs) y el CSP ya no
// permite scripts de cdnjs. Prueba estática + verificación del archivo real.
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const html = leer('index.html'), sw = leer('sw.js');

chk('★ index.html carga SheetJS desde js/xlsx.full.min.js (propio), no desde cdnjs',
    /<script src="js\/xlsx\.full\.min\.js\?v=5\.49" defer>/.test(html) && !/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx/.test(html));
const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
const scriptSrc = (csp.match(/script-src ([^;]+);/) || [])[1] || '';
chk('★ El CSP ya no permite scripts desde cdnjs (script-src)', scriptSrc.length > 0 && !/cdnjs/.test(scriptSrc), scriptSrc);
chk('El resto de hosts de script del CSP se conservan (gstatic de Firebase)', /www\.gstatic\.com/.test(scriptSrc));
const archivo = path.join(RAIZ, 'js', 'xlsx.full.min.js');
chk('El archivo js/xlsx.full.min.js existe', fs.existsSync(archivo));
const cab = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : '';
chk('★ El archivo es SheetJS 0.20.3 (versión auditada)', /version="0\.20\.3"/.test(cab));
chk('El Service Worker lo guarda en caché (WARM_URLS)', /js\/xlsx\.full\.min\.js\?v=' \+ APP_VERSION/.test(sw));
chk('La versión de sw.js y de index.html coinciden en 5.49',
    /APP_VERSION = '5\.49'/.test(sw) && (html.match(/\?v=5\.4[0-8]/g) || []).length === 0 && (html.match(/\?v=5\.49/g) || []).length > 40);
const todas = (html.match(/<script[^>]+src="js\/[^"]+\.js\?v=([^"]+)"/g) || []).length;
chk('Ningún <script> propio sigue en otra versión', todas > 40 && !/src="js\/[^"]+\?v=5\.4[0-8]"/.test(html));

const fallos = C.filter(c => !c.ok);
C.forEach(c => console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  ← ' + c.d)));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
process.exit(fallos.length ? 1 : 0);
