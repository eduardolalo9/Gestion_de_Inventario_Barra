// v5.57 — Política de contenido ESTRICTA en producción (auditoría A-1): index.html sin 'unsafe-inline' en script-src y con el hash
// sha256 de cada <script> en línea. Esta prueba impide que un cambio futuro deje la política desfasada (la app no arrancaría).
//   node pruebas/prueba-v557-csp-hashes.js
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process'), os = require('os');
const RAIZ = path.join(__dirname, '..');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const html = leer('index.html');
const { hashesEnLinea, aplicarCspEstricto, aplicarCspLaxa, leerPolitica } = require('../herramientas/csp-hashes');

// Cálculo INDEPENDIENTE de la herramienta: se vuelve a buscar cada <script> en línea (sin comentarios) y se hashea.
const bloques = []; html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (m, b) => { bloques.push(b); return m; });
const hash = (b) => "'sha256-" + crypto.createHash('sha256').update(b, 'utf8').digest('base64') + "'";
const pol = leerPolitica(html);

chk('★ index.html NO lleva \'unsafe-inline\' en script-src (un <script> o un manejador inyectado ya no se ejecuta)', !pol.tieneUnsafeInline && pol.scriptSrc.length > 0, pol.scriptSrc);
chk('★ Lleva el hash EXACTO de cada <script> en línea (' + bloques.length + ' bloques): ni uno de más ni uno de menos', bloques.length >= 4 && pol.hashes.length === new Set(bloques.map(hash)).size && bloques.every(b => pol.hashes.indexOf(hash(b)) !== -1), pol.hashes.length + ' hashes / ' + bloques.length + ' bloques');
chk('★ Los hashes están AL DÍA: recalcularlos no cambia nada (si falla: node herramientas/csp-hashes.js --escribir)', aplicarCspEstricto(html) === html);
const r = spawnSync(process.execPath, [path.join(RAIZ, 'herramientas', 'csp-hashes.js'), '--verificar'], { encoding: 'utf8' });
chk('La herramienta en modo --verificar sale con 0 sobre el index.html del repositorio', r.status === 0, r.stderr + r.stdout);
chk('★ Si se edita un script en línea y no se recalcula, se DETECTA: el hash viejo ya no coincide', (() => { const roto = html.replace('// Evitar FOUC', '// Evitar FOUC (editado)'); return roto !== html && aplicarCspEstricto(roto) !== roto && hashesEnLinea(roto).join() !== hashesEnLinea(html).join(); })());
chk('El cálculo es idempotente y no acumula hashes viejos al recalcular (siempre 4)', leerPolitica(aplicarCspEstricto(aplicarCspEstricto(html))).hashes.length === pol.hashes.length);
const laxa = aplicarCspLaxa(html);
chk('La política «laxa» (solo para probar el modo «sombra») lleva \'unsafe-inline\' y NINGÚN hash (con hashes el navegador ignoraría \'unsafe-inline\')', leerPolitica(laxa).tieneUnsafeInline && leerPolitica(laxa).hashes.length === 0);
chk('El resto de la política se conserva: default-src, object-src none, base-uri self, form-action self, worker-src self', /default-src 'self'/.test(pol.politica) && /object-src 'none'/.test(pol.politica) && /base-uri 'self'/.test(pol.politica) && /form-action 'self'/.test(pol.politica) && /worker-src 'self'/.test(pol.politica));
chk('Los hosts de script permitidos no crecieron: self + tailwind + gstatic (Firebase) + fontawesome', pol.scriptSrc.replace(/'sha256-[^']+'/g, '').trim().split(/\s+/).sort().join(' ') === "'self' https://cdn.tailwindcss.com https://kit.fontawesome.com https://use.fontawesome.com https://www.gstatic.com");
chk('(decisión documentada) style-src conserva \'unsafe-inline\': hay estilos en línea por toda la app y un estilo no ejecuta código', /style-src[^;]*'unsafe-inline'/.test(pol.politica));
chk('Cada script en línea es UN script real (ningún comentario HTML ni etiqueta arrastrada dentro del bloque)', bloques.every(b => !/<!--|<\/?script/i.test(b)));

// Los manejadores en línea (onclick="…") los ejecuta el despachador: ninguno puede estar fuera de su gramática (guardia ya existente) y el despachador debe estar cargado ANTES que el resto
const iDesp = html.indexOf('js/02-despachador-eventos.js'), iPrimero = html.indexOf('js/10-multiusuario.js');
chk('★ El despachador de eventos se carga ANTES que los módulos que pintan botones (si no, ningún onclick funcionaría con la política estricta)', iDesp > 0 && iDesp < iPrimero);
chk('index.html no usa javascript: en enlaces ni atributos style con expresiones (nada que la política estricta bloquee en silencio)', !/href="javascript:/i.test(html.replace(/<!--[\s\S]*?-->/g, '')));

// El constructor de STAGING cambia scripts en línea y agrega uno: debe recalcular los hashes (si no, staging no arranca)
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'stg-'));
const b = spawnSync(process.execPath, [path.join(RAIZ, 'herramientas', 'construir-staging.js'), out], { encoding: 'utf8' });
const hs = b.status === 0 ? fs.readFileSync(path.join(out, 'index.html'), 'utf8') : '';
const bs = []; hs.replace(/<!--[\s\S]*?-->/g, '').replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (m, x) => { bs.push(x); return m; });
const ps = leerPolitica(hs);
chk('★ El build de STAGING recalcula los hashes de CSP (sus scripts en línea son otros): estricto y con el hash de cada uno', b.status === 0 && !ps.tieneUnsafeInline && bs.length >= 5 && bs.every(x => ps.hashes.indexOf(hash(x)) !== -1) && ps.hashes.length === new Set(bs.map(hash)).size, b.stderr.slice(0, 200) + ' ' + bs.length + '/' + ps.hashes.length);
fs.rmSync(out, { recursive: true, force: true });

const sw = leer('sw.js'), ver = /APP_VERSION = '([^']+)'/.exec(sw)[1];
chk('La versión es 5.57 o posterior y coincide en index.html', parseFloat(ver) >= 5.57 && new RegExp('js/02-despachador-eventos\\.js\\?v=' + ver.replace('.', '\\.')).test(html), ver);

const fallos = C.filter(c => !c.ok);
C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + ' ' + c.n + (c.ok ? '' : '  ←  ' + c.d)));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron\n');
process.exit(fallos.length ? 1 : 0);
