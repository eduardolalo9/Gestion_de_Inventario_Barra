#!/usr/bin/env node
/**
 * prueba-actualizaciones.js — v5.12 · "las actualizaciones SÍ llegan y se ven" · estática
 * ═══════════════════════════════════════════════════════════════════════════
 * Entre la 5.3 y la 5.10 el teléfono de Eduardo siguió mostrando la 5.3. Dos
 * capas fallaron a la vez: (1) los bundles no se habían fusionado ni
 * publicado (PR #39-#48 vacíos) y (2) aun publicado, el Service Worker servía
 * el HTML viejo "mientras revalidaba", así que la versión nueva solo
 * aparecía en la SEGUNDA apertura, y el aviso era un toast de pocos segundos.
 * Esta prueba fija lo que se corrigió en el Service Worker y en la página, y
 * que las dos herramientas de línea de comandos existan y sean válidas.
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const RAIZ = path.resolve(__dirname, '..');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const sw = leer('sw.js'), html = leer('index.html'), css = leer('css/estilos.css');
const sh = leer('herramientas/publicar-bundle.sh'), ver = leer('herramientas/verificar-despliegue.js');

// ═══ 1 · SERVICE WORKER ═══════════════════════════════════════════════════
chk('★ El precache pide los archivos con {cache:\'reload\'} (no hereda la caché HTTP de Pages)',
    /PRECACHE_URLS\.map\(function\(u\) \{\s*return new Request\(u, \{ cache: 'reload' \}\);/.test(sw));
chk('★ El calentamiento también salta la caché HTTP', /fetch\(url, \{ cache: 'reload' \}\)/.test(sw));
chk('★ Las navegaciones (abrir/recargar) son RED PRIMERO, no stale-while-revalidate',
    /event\.request\.mode === 'navigate'/.test(sw) && /networkFirstNavegacion\(event\)/.test(sw));
chk('La red primero revalida ({cache:\'no-cache\'}) y guarda la copia para sin señal',
    /fetch\(request\.url, \{ cache: 'no-cache'/.test(sw) && /cache\.put\(request, clone\)/.test(sw));
chk('★ Red lenta: tras un plazo abre con la copia guardada (nunca deja esperando al bartender)',
    /NAVEGACION_TIMEOUT_MS\s*=\s*3500/.test(sw) && /Promise\.race\(/.test(sw));
chk('Sin señal ni copia, cae al index.html del precache (no a una pantalla en blanco)', /caches\.match\('\.\/index\.html'\)/.test(sw));
chk('★ El propio sw.js nunca se sirve desde caché (la comprobación de versión no puede mentir)',
    /\\\/sw\\\.js\$\/\.test\(url\.pathname\)\) return;/.test(sw));
chk('Los .js/.css siguen en stale-while-revalidate (llevan ?v=, no hay riesgo de servir uno viejo)',
    /event\.respondWith\(staleWhileRevalidate\(event\.request\)\)/.test(sw));
chk('skipWaiting + clients.claim se conservan (la versión nueva toma el control sola)', /self\.skipWaiting\(\)/.test(sw) && /self\.clients\.claim\(\)/.test(sw));
try { new (require('vm').Script)(sw); chk('sw.js es JavaScript válido', true); } catch (e) { chk('sw.js es JavaScript válido', false, e.message); }

// ═══ 2 · PÁGINA: MÓDULO DE ACTUALIZACIONES ═════════════════════════════════
chk('★ Existe BIActualizaciones y el registro del SW lo inicia', /window\.BIActualizaciones = \{/.test(html) && /BIActualizaciones\.iniciar\(registration\)/.test(html));
chk('El toast pasajero "Nueva versión disponible — recarga" ya no es el único aviso',
    !/Nueva versión disponible — recarga la página'\);/.test(html));
const modulo = html.slice(html.indexOf('var INTERVALO_MS'), html.indexOf('window.buscarActualizacion ='));
chk('★ Compara versiones por partes numéricas (5.10 > 5.9), nunca con parseFloat',
    /function comparar\(a, b\)/.test(modulo) && !/parseFloat\(/.test(modulo) && modulo.length > 3000, 'módulo=' + modulo.length);
chk('★ Pregunta al servidor la versión publicada con sw.js?chk=<hora> y sin caché', /fetch\('\.\/sw\.js\?chk=' \+ Date\.now\(\), \{ cache: 'no-store' \}\)/.test(html));
chk('Compara también la versión del SW activo (nombre de su caché) contra la de la página', /barinventory-v/.test(html) && /versionInstalada\(\)/.test(html));
chk('★ NO recarga solo: recargar es decisión de quien toca "Actualizar" (un conteo a medias no se pierde)',
    /function aplicar\(\)/.test(html) && !/controllerchange'[^;]*location\.reload/.test(html));
chk('Revisa al abrir (4 s), al volver a la app y cada 30 min — y solo con la app visible',
    /setTimeout\(function \(\) \{ revisar\(false\); \}, 4000\)/.test(html) && /visibilitychange/.test(html) && /INTERVALO_MS = 30 \* 60 \* 1000/.test(html) && /visibilityState === 'visible'/.test(html));
chk('"Reparar" borra archivos y caché de la app, NO localStorage ni IndexedDB',
    /\/\^barinventory-\//.test(html) && !/localStorage\.clear|indexedDB\.deleteDatabase/.test(html.slice(html.indexOf('function reparar()'), html.indexOf('function reparar()') + 2500)));
chk('"Reparar" pide confirmación y dice que los datos no se borran', /Tus conteos y datos NO se borran/.test(html));
chk('El pie de Más tiene "Buscar actualización" y "Reparar"', /onclick="buscarActualizacion\(\)"/.test(html) && /onclick="repararAplicacion\(\)"/.test(html));
chk('El pie dice la versión con PALABRA cuando hay una pendiente (el color nunca va solo)', /' · actualización ' \+ instalada \+ ' lista'/.test(html));
chk('Sin emoji como iconografía de interfaz en el aviso fijo y el pie (iconos del kit)',
    !/[\u{1F300}-\u{1FAFF}]/u.test(html.slice(html.indexOf('function mostrarBanner'), html.indexOf('function aplicar()'))) &&
    /fa-solid fa-arrows-rotate/.test(html) && /\.fa-arrows-rotate\s*\{/.test(leer('css/utilidades.css')));

// ═══ 3 · ESTILOS DEL AVISO ═════════════════════════════════════════════════
chk('El aviso fijo vive sobre la barra inferior (z 200) y bajo el menú lateral (z 300)', /\.act-banner \{[^}]*z-index: 250/.test(css));
chk('★ Botones táctiles del aviso y del pie >= 44 px', (css.match(/(?:\.act-banner__btn|\.act-banner__x|\.sb-act__btn) \{[^}]*min-height: 44px/g) || []).length === 3);
chk('El latón es solo el botón "Actualizar" (la decisión)', /\.act-banner__btn \{[^}]*background: var\(--accent\)/.test(css) && !/\.act-banner \{[^}]*background: var\(--accent\)/.test(css));
chk('Sin colores hex a mano en las reglas nuevas', !/\.(?:act-banner|sb-act)[^{]*\{[^}]*#[0-9a-fA-F]{3,6}\b/.test(css));

// ═══ 4 · HERRAMIENTAS ══════════════════════════════════════════════════════
chk('publicar-bundle.sh es bash válido', (() => { try { cp.execSync('bash -n ' + JSON.stringify(path.join(RAIZ, 'herramientas/publicar-bundle.sh'))); return true; } catch (_) { return false; } })());
chk('★ publicar-bundle.sh verifica el bundle, exige árbol limpio y NO usa push --force', /git bundle verify/.test(sh) && /git status --porcelain/.test(sh) && !/push[^\n]*(--force|-f\b)/.test(sh));
chk('★ publicar-bundle.sh se niega a publicar una fusión que no cambió ningún archivo (el síntoma de los PR #39-#48)', /NO cambió ningún archivo de la aplicación/.test(sh));
chk('publicar-bundle.sh pregunta antes de subir y avisa si el bundle ya estaba aplicado', /\[s\/N\]/.test(sh) && /YA está incluido/.test(sh));
chk('verificar-despliegue.js compara por partes numéricas y consulta sw.js sin caché', /const cmp = /.test(ver) && /cache: 'no-store'/.test(ver) && !/parseFloat\(/.test(ver));
chk('verificar-despliegue.js es JavaScript válido', (() => { try { cp.execSync('node --check ' + JSON.stringify(path.join(RAIZ, 'herramientas/verificar-despliegue.js'))); return true; } catch (_) { return false; } })());

// ═══ Versión ═══════════════════════════════════════════════════════════════
const vH = (html.match(/\?v=(\d+\.\d+)/) || [])[1], vS = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vH && vH === vS, 'index=' + vH + ' sw=' + vS);
chk('La versión avanzó (>= 5.12)', Number((vS || '').split('.')[1]) >= 12, 'es ' + vS);

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── v5.12 · Actualizaciones que sí llegan (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
