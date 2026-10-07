#!/usr/bin/env node
/**
 * verificar-despliegue.js — ¿qué versión está sirviendo tu sitio AHORA?
 * ═══════════════════════════════════════════════════════════════════════════
 * Compara la versión de tu copia local (sw.js) con la que el servidor entrega
 * de verdad, sin pasar por ninguna caché. Responde en 5 segundos a la
 * pregunta que más tiempo ha costado: "¿ya se publicó o no?".
 *
 *   node herramientas/verificar-despliegue.js https://tu-usuario.github.io/tu-repo/
 *   node herramientas/verificar-despliegue.js <URL> --esperar 300
 *
 * La URL también puede ir en la variable BAR_URL o en un archivo
 * .url-despliegue (una línea) en la raíz del repositorio.
 *
 *   --esperar N   vuelve a preguntar cada 15 s, hasta N segundos, esperando
 *                 que el sitio alcance la versión local (GitHub Pages tarda
 *                 de 1 a 3 minutos en publicar después de un push).
 *
 * Códigos de salida: 0 = el sitio sirve la versión local o una más nueva;
 *                    1 = el sitio sirve una versión MÁS VIEJA; 2 = no se pudo consultar.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
let url = null, esperar = 0;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--esperar') esperar = Number(args[++i]) || 0;
    else if (args[i] === '-h' || args[i] === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 20).join('\n')); process.exit(0); }
    else if (!url) url = args[i];
}
if (!url) url = process.env.BAR_URL || null;
if (!url) {
    const f = path.join(RAIZ, '.url-despliegue');
    if (fs.existsSync(f)) url = fs.readFileSync(f, 'utf8').trim().split('\n')[0];
}
if (!url) { console.error('Falta la URL de tu sitio. Ej.:  node herramientas/verificar-despliegue.js https://tu-usuario.github.io/tu-repo/'); process.exit(2); }
if (!/\/$/.test(url)) url += '/';

const versionDe = (txt, re) => { const m = re.exec(txt); return m ? m[1] : null; };
// Comparar por partes numéricas: '5.10' es MÁS nueva que '5.9' (parseFloat diría lo contrario).
const cmp = (a, b) => {
    const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
    return 0;
};

async function pedir(ruta) {
    const r = await fetch(url + ruta + (ruta.includes('?') ? '&' : '?') + 'chk=' + Date.now(), { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(ruta + ' → HTTP ' + r.status);
    return r.text();
}

async function una() {
    const local = versionDe(fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8'), /APP_VERSION\s*=\s*'([^']+)'/);
    let sw, html;
    try { [sw, html] = await Promise.all([pedir('sw.js'), pedir('index.html')]); }
    catch (e) { return { estado: 'error', local, msg: e.message }; }
    const vSw = versionDe(sw, /APP_VERSION\s*=\s*'([^']+)'/);
    const vHtml = versionDe(html, /\?v=(\d+(?:\.\d+)+)/);
    return { estado: 'ok', local, vSw, vHtml };
}

(async () => {
    const t0 = Date.now();
    let r;
    for (;;) {
        r = await una();
        const alcanzo = r.estado === 'ok' && r.vSw && cmp(r.vSw, r.local) >= 0;
        if (alcanzo || r.estado === 'error' || (Date.now() - t0) / 1000 >= esperar) break;
        process.stdout.write('  … el sitio sirve la ' + r.vSw + ', esperando la ' + r.local + ' (reintento en 15 s)\n');
        await new Promise(res => setTimeout(res, 15000));
    }
    console.log('\n  Sitio:            ' + url);
    if (r.estado === 'error') { console.log('  ✖ No se pudo consultar: ' + r.msg + '\n    Revisa la URL (debe terminar en la carpeta donde vive index.html) y tu internet.'); process.exit(2); }
    console.log('  Tu copia local:   ' + r.local);
    console.log('  Servidor (sw.js): ' + r.vSw);
    console.log('  Servidor (HTML):  ' + r.vHtml);
    if (r.vSw !== r.vHtml) console.log('  ⚠ El HTML y el sw.js del servidor NO coinciden: se está publicando a medias. Espera 2-3 minutos y repite.');
    const c = cmp(r.vSw, r.local);
    if (c >= 0) { console.log('\n  ✔ El sitio ya sirve la ' + r.vSw + (c > 0 ? ' (más nueva que tu copia local)' : '') + '. Si el teléfono no la muestra: abre la app, espera 10 s y toca "Actualizar" (o Más → Buscar actualización).'); process.exit(0); }
    console.log('\n  ✖ El sitio sirve una versión MÁS VIEJA que tu copia local. Causas, de más a menos probable:');
    console.log('     1) No has hecho push de la rama que publica el sitio (git push origin produccion).');
    console.log('     2) GitHub Pages publica OTRA rama (p. ej. main). Revisa Settings → Pages → Source, o abre el PR produccion → main.');
    console.log('     3) Pages aún está construyendo: repite con  --esperar 300.');
    console.log('     4) Revisa la pestaña Actions de GitHub: una corrida "pages build and deployment" en rojo.');
    process.exit(1);
})();
