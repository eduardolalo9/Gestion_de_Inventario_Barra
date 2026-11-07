#!/usr/bin/env node
/**
 * prueba-staging-aislado-navegador.js — el build de STAGING funciona en modo local
 * y NO se conecta a Firebase, en Chromium real (móvil y PC).
 *
 *   node pruebas/prueba-staging-aislado-navegador.js
 *
 * Construye el staging en una carpeta temporal, lo sirve en local y comprueba:
 *   · se identifica como STAGING (título y franja), sin inicio de sesión;
 *   · CERO peticiones a Firebase (Auth, Firestore, Realtime DB, SDK);
 *   · el conteo físico local funciona, incluido el separador decimal con coma;
 *   · lo contado persiste en localStorage tras recargar;
 *   · el semáforo de sincronización dice que NO hay nube (no simula sincronización).
 */
'use strict';
const { spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const DESTINO = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-staging-'));
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });

// 1 · Build
const b = spawnSync(process.execPath, [path.join(RAIZ, 'herramientas/construir-staging.js'), DESTINO], { encoding: 'utf8' });
chk('El build de staging se genera y pasa sus aserciones de aislamiento', b.status === 0, (b.stderr || b.stdout).trim());

// Servidor estático mínimo (sin dependencias)
const tipos = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
const servidor = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const ruta = path.join(DESTINO, rel === '/' ? 'index.html' : rel);
    if (!ruta.startsWith(DESTINO) || !fs.existsSync(ruta) || fs.statSync(ruta).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': tipos[path.extname(ruta)] || 'application/octet-stream' });
    fs.createReadStream(ruta).pipe(res);
});
const PUERTO = 8093;

const PATRONES_FIREBASE = /firebaseio\.com|firestore\.googleapis\.com|identitytoolkit|securetoken|firebase\.googleapis\.com|firebasejs|firebaseapp\.com|gstatic\.com\/firebasejs/i;

(async () => {
    await new Promise((r) => servidor.listen(PUERTO, '127.0.0.1', r));
    const nav = await chromium.launch(require('./_lanzar-navegador')());
    const vistas = [
        { nombre: 'móvil 390', vp: { width: 390, height: 844 } },
        { nombre: 'PC 1440', vp: { width: 1440, height: 900 } }
    ];
    try {
        for (const v of vistas) {
            const ctx = await nav.newContext({ viewport: v.vp });
            const p = await ctx.newPage();
            const errores = []; p.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
            const firebase = [];
            p.on('request', (r) => { if (PATRONES_FIREBASE.test(r.url())) firebase.push(r.url()); });

            await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
            await p.waitForTimeout(900);

            const estado = await p.evaluate(() => ({
                titulo: document.title,
                banner: (document.getElementById('bannerEntorno') || {}).textContent || '',
                login: !!document.getElementById('loginScreen') && !document.getElementById('loginScreen').classList.contains('auth-hidden'),
                app: document.getElementById('appWrapper').classList.contains('auth-visible'),
                sync: (document.getElementById('syncDot') || {}).dataset ? document.getElementById('syncDot').dataset.state : null
            }));
            chk(`[${v.nombre}] se identifica como STAGING (título)`, /STAGING/.test(estado.titulo), estado.titulo);
            chk(`[${v.nombre}] franja STAGING · PRUEBAS · MODO LOCAL visible`, /STAGING · PRUEBAS · MODO LOCAL/.test(estado.banner), estado.banner);
            chk(`[${v.nombre}] entra directo, sin inicio de sesión`, !estado.login && estado.app);
            chk(`[${v.nombre}] semáforo de sincronización: sin nube (no simula sincronización)`, estado.sync === 'none', String(estado.sync));
            chk(`[${v.nombre}] CERO peticiones a Firebase`, firebase.length === 0, firebase.slice(0, 3).join(' | '));

            // Conteo local con coma decimal, guardado y recuperado tras recargar
            await p.evaluate(() => {
                products = [{ id: 'GOLOS-1', name: 'GOLOS', unit: 'KGS', group: 'Botanas' }];
                selectedArea = 'almacen'; inventarioConteo = {};
                isAuditoriaMode = false; activeTab = 'inventario';
                renderTab();
                saveToLocalStorage();
            });
            await p.evaluate(() => openInventarioModal('GOLOS-1'));
            await p.waitForTimeout(120);
            await p.evaluate(() => {
                const el = document.getElementById('inv_cantidadTotal');
                el.focus();
                el.value = '';
                for (const ch of '0,850') { el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); }
            });
            await p.evaluate(() => saveInventarioModal());
            await p.waitForTimeout(200);
            const guardado = await p.evaluate(() => JSON.stringify(inventarioConteo['GOLOS-1'] || null));
            chk(`[${v.nombre}] conteo con coma: "0,850" se guarda como 0.85 (no 850)`,
                /"enteras":0\.85\b/.test(guardado), guardado);

            await p.evaluate(() => saveToLocalStorage());
            await p.reload({ waitUntil: 'load' });
            await p.waitForTimeout(900);
            const tras = await p.evaluate(() => {
                const cont = typeof inventarioConteo !== 'undefined' ? inventarioConteo : {};
                return JSON.stringify(cont['GOLOS-1'] || null);
            });
            chk(`[${v.nombre}] lo contado sobrevive a recargar (persistencia local)`,
                /"enteras":0\.85\b/.test(tras), tras);
            chk(`[${v.nombre}] sin errores de JavaScript`, errores.length === 0, errores.join(' | '));
            chk(`[${v.nombre}] tras recargar, sigue sin peticiones a Firebase`, firebase.length === 0, firebase.slice(0, 3).join(' | '));
            await ctx.close();
        }
    } finally {
        await nav.close();
        servidor.close();
        fs.rmSync(DESTINO, { recursive: true, force: true });
    }
    const w = Math.max(...C.map((c) => c.n.length));
    console.log('\n  ── STAGING aislado · modo local (navegador real) ──\n');
    C.forEach((c) => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
    const fallos = C.filter((c) => !c.ok).length;
    console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); servidor.close(); process.exit(1); });
