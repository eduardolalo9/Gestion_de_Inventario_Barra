#!/usr/bin/env node
/**
 * todas-locales.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Corre, una tras otra, todas las pruebas que NO necesitan el emulador de
 * Firestore. Es lo que `npm test` ejecuta antes de arrancar el emulador.
 *
 * Por qué un script en vez de encadenar con && en package.json: los scripts de
 * npm se ejecutan a través de cmd.exe en Windows, no de sh, y encadenar ahí ya
 * nos costó un diagnóstico equivocado. Aquí se lanza cada prueba con el mismo
 * Node que corre este archivo, sin pasar por ningún shell.
 *
 * Para añadir una prueba nueva: una línea más en la lista.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

// Solo pruebas ESTÁTICAS: leen los archivos del repositorio y no necesitan
// navegador, servidor ni red. Por eso pueden correr en cualquier máquina y en
// cualquier momento, que es lo que se quiere de un pretest.
//
// Las de navegador (prueba-m2a, prueba-c1, prueba-p0, prueba-p1) NO están aquí
// a propósito: levantan Chromium contra http://127.0.0.1:8080 y prueba-p0
// además necesita descargar SheetJS de cdnjs. Se ejecutan con
//     npm run test:navegador
// que arranca el servidor solo. Meterlas en el pretest haría que `npm test`
// fallara por no tener red, que no es lo mismo que tener el código roto.
const PRUEBAS = [
    'prueba-integridad-split.js',   // M2 — la partición en 17 archivos sigue sana
    'prueba-r1.js',                 // R1 — conteo en oz, decimales, sin motivo
    'prueba-r2.js',                 // R2 — el PV de Parrot en el catálogo
    'prueba-r3.js',                 // R3 — dos entornos, elegidos por el dominio
    'prueba-r4.js',                 // R4 — ciclo semanal lunes→domingo
    'prueba-r5.js',                 // R5 — el catálogo
    'prueba-r6.js',                 // R6 — áreas de conteo configurables
    'prueba-r7.js',                 // R7 — crear inventario desde formulario
    'prueba-f1.js',                 // F1 — los tres defectos criticos de la auditoria
    'prueba-d.js',                  // D  — sincronizacion y defectos criticos
    'prueba-f2.js',                 // F2 — permisos, privacidad y seguridad de servidor
    'prueba-f3prev.js',             // Paso previo a F3 — cierre atomico e inmutabilidad
];

let fallaron = [];

for (const archivo of PRUEBAS) {
    const r = spawnSync(process.execPath, [path.join(__dirname, archivo)], {
        stdio: 'inherit',
    });
    // Un archivo que no existe, o que revienta al arrancar, cuenta como fallo:
    // una prueba que no corre no es una prueba que pasa.
    if (r.error) {
        console.error('\n  ✗ No se pudo ejecutar ' + archivo + ': ' + r.error.message + '\n');
        fallaron.push(archivo);
    } else if (r.status !== 0) {
        fallaron.push(archivo);
    }
}

if (fallaron.length) {
    console.error('\n  ═══ Fallaron ' + fallaron.length + ' de ' + PRUEBAS.length +
                  ' archivos de prueba: ' + fallaron.join(', ') + ' ═══\n');
    process.exit(1);
}

console.log('  ═══ ' + PRUEBAS.length + ' archivos de prueba locales, todos en verde ═══\n');
