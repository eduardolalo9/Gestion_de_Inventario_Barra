#!/usr/bin/env node
/**
 * construir-staging.js — genera una copia de BarInventory de PRUEBAS (STAGING),
 * aislada de Firebase, para revisarla desde el celular y la computadora.
 *
 *   node herramientas/construir-staging.js <carpeta-de-salida>
 *
 * Qué cambia respecto a la app de producción (la producción NO se toca):
 *   · ENTORNO forzado a 'pruebas' (nunca 'produccion', sin importar el host).
 *   · Las configuraciones de Firebase quedan VACÍAS: la app no inicializa
 *     Firebase, no abre ninguna conexión y trabaja solo con localStorage de
 *     este navegador (modo local).
 *   · Franja fija "STAGING · PRUEBAS · MODO LOCAL" y título distinto.
 *   · Sin service worker ni manifest (no se puede "instalar" como app oficial
 *     ni quedar cacheada en el lugar de la versión real).
 *   · Acceso directo sin inicio de sesión, con rol de administrador LOCAL.
 *     Es aceptable porque no hay servidor ni usuarios reales: todo queda en
 *     este dispositivo y en este origen.
 *
 * Las aserciones del final impiden publicar un build que conserve la
 * configuración de producción o que no sea de pruebas.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const SALIDA = process.argv[2];
if (!SALIDA) {
    console.error('Uso: node herramientas/construir-staging.js <carpeta-de-salida>');
    process.exit(2);
}

function reemplazarUna(texto, buscar, reemplazo, etiqueta) {
    const n = texto.split(buscar).length - 1;
    if (n !== 1) throw new Error('Se esperaba 1 coincidencia para "' + etiqueta + '" y hay ' + n);
    return texto.replace(buscar, reemplazo);
}
function reemplazarBloque(texto, inicio, reemplazo, etiqueta) {
    const i = texto.indexOf(inicio);
    if (i === -1 || texto.indexOf(inicio, i + 1) !== -1) throw new Error('Bloque no único: ' + etiqueta);
    const fin = texto.indexOf('};', i) + 2;
    return texto.slice(0, i) + reemplazo + texto.slice(fin);
}

const BANNER = 'STAGING · PRUEBAS · MODO LOCAL (sin Firebase)';

let html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

html = reemplazarUna(html, '<link rel="manifest" href="manifest.json">', '', 'manifest');
html = reemplazarUna(html, '<title>BarInventory — Control de Inventario</title>',
    '<title>BarInventory STAGING</title>', 'título');
html = reemplazarUna(html, '<meta name="apple-mobile-web-app-title" content="BarInventory">',
    '<meta name="apple-mobile-web-app-title" content="STAGING">', 'título iOS');
html = reemplazarUna(html, "if (!('serviceWorker' in navigator)) {",
    "if (true) { /* STAGING: sin service worker */", 'service worker');
html = reemplazarBloque(html, 'const FIREBASE_PRODUCCION = {',
    'const FIREBASE_PRODUCCION = { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };',
    'config producción');
html = reemplazarBloque(html, 'const FIREBASE_PRUEBAS = {',
    'const FIREBASE_PRUEBAS = { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };',
    'config pruebas');
html = reemplazarUna(html, "const ENTORNO         = _esEntornoDePruebas() ? 'pruebas' : 'produccion';",
    "const ENTORNO         = 'pruebas'; // STAGING: forzado. Nunca 'produccion' en este build.", 'entorno');
{
    const ini = html.indexOf('b.textContent = FIREBASE_PRUEBAS.projectId');
    const fin = html.indexOf("solo este dispositivo';", ini);
    if (ini === -1 || fin === -1) throw new Error('banner no encontrado');
    html = html.slice(0, ini) + "b.textContent = '" + BANNER + "';" + html.slice(fin + "solo este dispositivo';".length);
}

// Acceso directo en modo local, después de que auth.js haya evaluado su rama sin Firebase.
const ACCESO_LOCAL = `
    <script>
    /* STAGING — modo local: sin Firebase Auth. Se entra directo como administrador
       LOCAL de este dispositivo. No hay servidor ni usuarios reales en este build. */
    (function () {
        var ids = { load: 'authLoadingScreen', login: 'loginScreen', app: 'appWrapper' };
        document.getElementById(ids.load).classList.add('auth-hidden');
        document.getElementById(ids.login).classList.add('auth-hidden');
        document.getElementById(ids.app).classList.add('auth-visible');
        var mail = document.getElementById('sbUserEmail');
        if (mail) mail.textContent = 'STAGING · modo local';
        currentUserUid = 'staging-local';
        currentUserRole = 'admin';
        if (typeof _authzState !== 'undefined') {
            _authzState.loaded = true;
            _authzState.permissions = new Set(['*']);
            _authzState.overrides = {};
        }
    })();
    </script>
`;
html = reemplazarUna(html, '</body>', ACCESO_LOCAL + '</body>', 'cierre body');
// El SDK de Firebase no se carga en staging: ninguna petición a Firebase, ni siquiera de código.
{
    const sdk = html.split('\n').filter((l) => /src="https:\/\/www\.gstatic\.com\/firebasejs\//.test(l));
    if (sdk.length !== 3) throw new Error('Se esperaban 3 etiquetas del SDK de Firebase y hay ' + sdk.length);
    html = html.split('\n').filter((l) => !/src="https:\/\/www\.gstatic\.com\/firebasejs\//.test(l)).join('\n');
}

// Carpeta de salida limpia (solo se crea/limpia la carpeta indicada).
fs.rmSync(SALIDA, { recursive: true, force: true });
fs.mkdirSync(SALIDA, { recursive: true });
fs.writeFileSync(path.join(SALIDA, 'index.html'), html, 'utf8');
for (const dir of ['css', 'js']) {
    fs.cpSync(path.join(RAIZ, dir), path.join(SALIDA, dir), { recursive: true });
}

// ── Aserciones de aislamiento ─────────────────────────────────────────────
// Credenciales de PRODUCCIÓN que no pueden aparecer en ningún archivo del build.
const PRODUCCION_NO_PERMITIDA = [
    'AIzaSyDaMcyv_o0YYv9XRDG1A', 'gestor-de-inventarios-76c19', '520575498448', '1:520575498448'
];
const salida = fs.readFileSync(path.join(SALIDA, 'index.html'), 'utf8');
const fallos = [];
const todos = [];
(function leerTodo(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) leerTodo(p);
        else if (/\.(html|js|css)$/.test(e.name)) todos.push([p, fs.readFileSync(p, 'utf8')]);
    }
})(SALIDA);
for (const [archivo, contenido] of todos) {
    for (const t of PRODUCCION_NO_PERMITIDA) {
        if (contenido.indexOf(t) !== -1) fallos.push(path.relative(SALIDA, archivo) + ' contiene credencial de producción: ' + t);
    }
}
if (!/const ENTORNO\s*=\s*'pruebas'/.test(salida)) fallos.push('ENTORNO no está forzado a pruebas');
if (/'produccion'/.test(salida) && !/STAGING/.test(salida)) fallos.push('queda la rama de producción');
if (salida.indexOf('sw.js') !== -1 && salida.indexOf('if (true)') === -1) fallos.push('el service worker sigue activo');
if (fallos.length) {
    console.error('✖ Build de staging RECHAZADO:\n  - ' + fallos.join('\n  - '));
    process.exit(1);
}
const archivos = [];
(function listar(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) listar(p); else archivos.push(path.relative(SALIDA, p));
    }
})(SALIDA);
console.log('✔ Build de staging listo en ' + SALIDA + ' (' + archivos.length + ' archivos, modo local, sin Firebase).');
