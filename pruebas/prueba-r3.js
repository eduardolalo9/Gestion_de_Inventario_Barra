#!/usr/bin/env node
/**
 * prueba-r3.js — R3: dos entornos, elegidos por el dominio
 * ═══════════════════════════════════════════════════════════════════════════
 * Hasta R3 había una sola configuración de Firebase. Abrir la app en
 * localhost para probar cualquier cosa escribía en la base REAL del bar: el
 * mismo Firestore que usan los bartenders durante el servicio.
 *
 * Lo que esta prueba defiende es una sola frase: NUNCA caer a producción por
 * accidente. Si el entorno de pruebas no está configurado, la app se queda
 * en local con localStorage — no se conecta a la base del bar "mientras
 * tanto". Fallar cerrado.
 *
 * La función que decide el entorno se extrae del archivo real y se ejecuta
 * contra los dominios de verdad.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok, detalle: detalle || '' });
    if (!ok) fallos++;
}

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

// ═══ 1 · Las dos configuraciones existen y están separadas ════════════════
chk('Existe la configuración de producción', /const FIREBASE_PRODUCCION = \{/.test(html));
chk('Existe la configuración de pruebas',    /const FIREBASE_PRUEBAS = \{/.test(html));
chk('Producción conserva el proyecto del bar',
    /FIREBASE_PRODUCCION = \{[\s\S]*?projectId: "gestor-de-inventarios-76c19"/.test(html),
    'R3 no puede cambiar a qué base se conecta el bar');
// R4: el proyecto ya existe, así que projectId dejó de estar vacío. Lo que
// tiene que seguir vacío es la apiKey: es lo que mantiene la app sin nube en
// local hasta que Eduardo pegue las credenciales.
chk('Pruebas apunta a barinventory-staging',
    /FIREBASE_PRUEBAS = \{[\s\S]*?projectId: "barinventory-staging"/.test(html));
chk('Pruebas sigue sin credenciales, así que no se conecta todavía',
    /FIREBASE_PRUEBAS = \{[\s\S]*?apiKey: ""/.test(html));
chk('Producción y pruebas no apuntan al mismo proyecto',
    !/FIREBASE_PRUEBAS = \{[\s\S]*?projectId: "gestor-de-inventarios-76c19"/.test(html),
    'sería el peor error posible de esta fase');

// ═══ 2 · La decisión se ejecuta de verdad ═════════════════════════════════
const i = html.indexOf('function _esEntornoDePruebas()');
let fn = null;
if (i !== -1) {
    let nivel = 0, dentro = false;
    for (let j = i; j < html.length; j++) {
        if (html[j] === '{') { nivel++; dentro = true; }
        else if (html[j] === '}') { nivel--; if (dentro && nivel === 0) { fn = html.slice(i, j + 1); break; } }
    }
}
chk('_esEntornoDePruebas existe', !!fn);

if (fn) {
    const probar = (hostname) => {
        const ctx = vm.createContext({ location: { hostname } });
        vm.runInContext(fn + '\nglobalThis._e = _esEntornoDePruebas();', ctx);
        return ctx._e;
    };

    // El dominio del bar. Si esto falla, los bartenders se quedan sin datos.
    chk('eduardolalo9.github.io es PRODUCCIÓN', probar('eduardolalo9.github.io') === false,
        'es el dominio donde cuenta el bar');
    chk('Cualquier subdominio github.io es PRODUCCIÓN', probar('otro.github.io') === false);

    // Todo lo que es "mi máquina" tiene que ser pruebas.
    chk('localhost es PRUEBAS',   probar('localhost') === true);
    chk('127.0.0.1 es PRUEBAS',   probar('127.0.0.1') === true);
    chk('::1 (IPv6) es PRUEBAS',  probar('::1') === true);
    chk('file:// es PRUEBAS',     probar('') === true,
        'abrir el index a doble clic tampoco puede escribir en la base del bar');
    chk('Un .local de red interna es PRUEBAS', probar('laptop.local') === true);

    chk('LOCALHOST en mayúsculas también es PRUEBAS', probar('LOCALHOST') === true,
        'el hostname puede llegar con mayúsculas y no puede decidir a qué base se escribe');

    // Un dominio que solo CONTIENE la palabra no cuenta: milocalhost.com es
    // un sitio de internet cualquiera, no la máquina de nadie.
    chk('Un dominio que solo contiene "localhost" NO es pruebas',
        probar('milocalhost.com') === false);
    chk('Un dominio que solo contiene ".local" en medio NO es pruebas',
        probar('mi.local.ejemplo.com') === false);
}

// ═══ 3 · Fallar cerrado ═══════════════════════════════════════════════════
chk('firebaseConfig se elige por entorno, no a mano',
    /const firebaseConfig\s*=\s*\(ENTORNO === 'pruebas'\)\s*\?\s*FIREBASE_PRUEBAS\s*:\s*FIREBASE_PRODUCCION/.test(html));
chk('Con pruebas sin configurar NO se cae a producción',
    !/FIREBASE_PRUEBAS\.projectId\s*\?\s*FIREBASE_PRUEBAS\s*:\s*FIREBASE_PRODUCCION/.test(html) &&
    !/\|\|\s*FIREBASE_PRODUCCION/.test(html),
    'un respaldo a producción convertiría el descuido en pérdida de datos');
chk('Sin config válida la app se queda en localStorage',
    /if \(!configured\) \{[\s\S]{0,600}?return;/.test(html));
chk('El aviso de consola explica que no se toca la base del bar',
    /No se toca la base del bar/.test(html));

// ═══ 4 · Se ve a simple vista ═════════════════════════════════════════════
chk('Hay un banner de entorno', /id = 'bannerEntorno'/.test(html));
chk('El banner solo aparece fuera de producción',
    /if \(ENTORNO === 'pruebas'\) \{[\s\S]{0,200}?bannerEntorno/.test(html),
    'un banner en producción sería ruido para los bartenders');
chk('El banner dice cuándo no hay nube',
    /sin nube, solo este dispositivo/.test(html));
chk('El banner no se puede pulsar por accidente',
    /bannerEntorno[\s\S]{0,700}?pointer-events:none/.test(html));
chk('La consola registra a qué proyecto se conectó',
    /\[Firebase\] Entorno: /.test(html));

// ═══ 5 · Caché ════════════════════════════════════════════════════════════
const vTags = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
chk('R3 subió la versión de caché por encima de 2.8',
    vTags.length === 1 && parseFloat(vTags[0]) > 2.8,
    'versiones encontradas: ' + vTags.join(', '));

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── R3 · dos entornos, elegidos por el dominio ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');

process.exit(fallos ? 1 : 0);
