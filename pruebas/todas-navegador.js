#!/usr/bin/env node
/**
 * todas-navegador.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Corre las pruebas que abren la app de verdad en Chromium. Levanta el
 * servidor estático él mismo y lo apaga al terminar, para que no haya que
 * acordarse de arrancarlo en otra terminal.
 *
 *     npm run test:navegador
 *
 * REQUISITOS — si falta alguno, la prueba avisa en vez de fallar en falso:
 *   · playwright instalado (npm i -D playwright)
 *   · salida a internet: prueba-p0 descarga SheetJS de cdnjs. En una red que
 *     bloquee ese dominio verás "XLSX is not defined", que NO significa que el
 *     código esté roto.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const http = require('http');

const RAIZ   = path.resolve(__dirname, '..');
const PUERTO = 8080;

const PRUEBAS = [
    'prueba-m2a.js',   // M2a — la sesión de auditoría no puede retroceder
    'prueba-c1.js',    // C1  — el aviso de guardado no miente
    'prueba-p0.js',    // P0  — campos de compras en el catálogo (necesita cdnjs)
    'prueba-p1.js',    // P1  — la pestaña de compras
    'prueba-f3-navegador.js',  // F3 — contabilizar: humo en la app real
    'prueba-p2-navegador.js',  // FASE 4 — importación de compras: parseo, vista previa, incidencias
    'prueba-fase6-navegador.js', // FASE 6 — buscadores en la app real
    'prueba-hotfix-decimales.js', // HOTFIX — separador decimal (coma/punto) en conteo físico
    'prueba-reconteo-navegador.js', // RECONTEO — ventana de reconteo en la app real
    'prueba-panel-navegador.js',    // PREMIUM — panel, ficha de producto y Conteo sin inventario
    'prueba-fase8-navegador.js',    // FASE 8 — las dos existencias y el interruptor de fuente
    'prueba-contabilizar-navegador.js', // Contabilizar en Conteo y estado CONTABILIZADO
    'prueba-h40-navegador.js',          // H-40 (hotfix 4.9) — fecha de recuento domingo/fin de mes
    'prueba-recetario1-navegador.js',   // RECETARIO-1 — pestaña, editor, costeo y permisos
    'prueba-recetario2-navegador.js',   // RECETARIO-2 — importador: parseo, vista previa, merge por PV/nombre
    'prueba-fase10-navegador.js',       // FASE 10 — ventas del POS: parseo, semana, vista previa, permisos
    'prueba-fase11a-navegador.js',      // FASE 11A — costeo por unidad, consumo teórico y enchufe en existencia
    'prueba-fase10b-ui-navegador.js',   // FASE 10B — Inventario Físico para el pulgar: medidas, separación y contraste
    'prueba-fisico-vs-sistema-navegador.js', // FASE 11B — botón por permiso, tabla, búsqueda y chip de filtro
    'prueba-hotfix-4.22-navegador.js',  // HOTFIX 4.22 — recorte de movimientos y aviso de cuota real
    'prueba-fase11b-parte2-navegador.js', // FASE 11B (parte 2) — pedido sugerido y niveles de alerta
    'prueba-fase13-navegador.js',       // FASE 13 — contabilizar el corte de fin de mes
    'prueba-redis-r1-navegador.js',     // REDISEÑO R1 — la app se pinta correcta sin Tailwind ni FontAwesome
    'prueba-redis-r2-navegador.js',     // REDISEÑO R2 — una sola navegación en pantalla, activo en latón
    'prueba-redis-r3-navegador.js',     // REDISEÑO R3 — Inicio en pantalla: tarjetas, cifras y panel del kit
];

function esperarServidor(intentos) {
    return new Promise(function(resolve) {
        var quedan = intentos;
        (function probar() {
            var req = http.get('http://127.0.0.1:' + PUERTO + '/index.html', function(res) {
                res.resume();
                resolve(res.statusCode === 200);
            });
            req.on('error', function() {
                if (--quedan <= 0) return resolve(false);
                setTimeout(probar, 500);
            });
        })();
    });
}

(async function main() {
    try { require.resolve('playwright'); }
    catch (_) {
        console.error('\n  playwright no está instalado. Ejecuta:  npm i -D playwright\n');
        process.exit(1);
    }

    const servidor = spawn('npx', ['--yes', 'http-server', '-p', String(PUERTO), '-c-1'],
        { cwd: RAIZ, stdio: 'ignore', shell: process.platform === 'win32' });

    // Pase lo que pase —fallo, Ctrl-C, excepción— el servidor se apaga. Dejarlo
    // vivo bloquearía el puerto 8080 en la siguiente ejecución.
    let cerrado = false;
    const apagar = function() { if (!cerrado) { cerrado = true; try { servidor.kill(); } catch (_) {} } };
    process.on('exit', apagar);
    process.on('SIGINT', function() { apagar(); process.exit(130); });

    if (!await esperarServidor(20)) {
        console.error('\n  No arrancó el servidor en el puerto ' + PUERTO +
                      '. ¿Lo tienes ocupado con otra cosa?\n');
        apagar();
        process.exit(1);
    }

    const fallaron = [];
    for (const archivo of PRUEBAS) {
        const r = spawnSync(process.execPath, [path.join(__dirname, archivo)], { stdio: 'inherit' });
        if (r.error || r.status !== 0) fallaron.push(archivo);
    }
    apagar();

    if (fallaron.length) {
        console.error('\n  ═══ Fallaron: ' + fallaron.join(', ') + ' ═══');
        console.error('  Si el error dice "XLSX is not defined", es la red bloqueando');
        console.error('  cdnjs.cloudflare.com, no el código.\n');
        process.exit(1);
    }
    console.log('  ═══ ' + PRUEBAS.length + ' pruebas de navegador, todas en verde ═══\n');
})();
