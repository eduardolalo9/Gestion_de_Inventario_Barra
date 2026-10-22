#!/usr/bin/env node
/**
 * prueba-posicion-conteo.js — v5.17 · Conteo por área: la pantalla no se mueve
 * bajo los dedos · estática
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedido de Eduardo (5-oct-2026): después de contar, la lista se queda donde
 * estaba (no vuelve al primer producto); el riel de grupos conserva su
 * desplazamiento; cada grupo recuerda su propia posición.
 * Causa real: body.modal-open usa position:fixed (truco de iOS) y el
 * navegador pone la página en 0 sin regresarla al cerrar el modal.
 * La prueba de comportamiento está en prueba-posicion-conteo-navegador.js
 * (sin el arreglo falla 18 de 23; con él, 23/23).
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const casos = []; let fallos = 0;
function chk(n, ok, d) { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; }
const mod = leer('js/71-posicion-conteo.js'), r70 = leer('js/70-conversion-render.js'), html = leer('index.html'),
      sw = leer('sw.js'), css = leer('css/estilos.css');

chk('El módulo existe y se ejecuta sin errores de sintaxis', (() => { try { new (require('vm').Script)(mod); return true; } catch (e) { return false; } })());
chk('★ Observa body.modal-open (todos los modales) con un MutationObserver', /new MutationObserver\([\s\S]{0,400}attributeFilter: \['class'\]/.test(mod));
chk('★ Al abrir un modal fija top: -Y (el fondo no salta) y al cerrar regresa a Y', /b\.style\.top = \(-_posBloqueo\.y\) \+ 'px'/.test(mod) && /b\.style\.top = '';[\s\S]{0,600}posicionIrA\(y\)/.test(mod));
chk('La última posición solo se guarda con la página libre (el scroll a 0 del body fijo se ignora)', /if \(!_posModalAbierto\(\)\) _posUltimoY = /.test(mod));
chk('★ Ancla la TARJETA contada (posición de layout, sin la animación cardIn)', /_posTopDocumento/.test(mod) && /closest\('\.inv-card'\)/.test(mod) && /n\.offsetParent/.test(mod));
chk('El ancla solo cuenta si la tarjeta se tocó justo antes de abrir el modal', /Date\.now\(\) - _posAncla\.t < 1500/.test(mod));
chk('Si el modal llevó a otra pestaña, no se restaura una posición ajena', /mismaPantalla = [\s\S]{0,80}activeTab === g\.tab/.test(mod));
chk('Ir a una posición sin animación (html tiene scroll-behavior: smooth)', /scrollBehavior = 'auto'/.test(mod) && /html \{ scroll-behavior: smooth; \}/.test(css));
chk('★ El riel de grupos recuerda su desplazamiento por pantalla y deja visible el grupo activo',
    /classList\.contains\('grp-rail'\)[\s\S]{0,120}_posRielX\[posicionClavePantalla\(\)\] = t\.scrollLeft/.test(mod) && /grp-pill--active/.test(mod));
chk('La clave de pantalla distingue las tres áreas del conteo', /auditoriaAreaActiva[\s\S]{0,120}tab \+ '\|' \+ vista \+ '\|' \+ area/.test(mod));
chk('★ updateSelectedGroup guarda la posición del grupo que se deja y recupera la del elegido',
    /function updateSelectedGroup\(value\) \{[\s\S]{0,400}posicionGuardarGrupo\(selectedGroup\);[\s\S]{0,200}renderTab\(\);\s*\n\s*if \(typeof posicionRestaurarGrupo === 'function'\) posicionRestaurarGrupo\(value\);/.test(r70));
chk('renderTab() llama a posicionTrasRender() después de pintar', /BusquedaUI\.trasRender\(\);[\s\S]{0,300}posicionTrasRender\(\)/.test(r70));
chk('La restauración de renderTab ya no anima la lista', /posicionIrA\(scrollY\)/.test(r70));
chk('No toca datos: sin Firestore, sin localStorage, sin conteos', !/collection\(|localStorage|saveToLocalStorage|myAuditoriaConteo|auditoriaConteo\s*=/.test(mod.replace(/\/\/.*$/gm, '')));
chk('index.html carga 71-posicion-conteo.js entre 70 y 75',
    html.indexOf('js/70-conversion-render.js') < html.indexOf('js/71-posicion-conteo.js') && html.indexOf('js/71-posicion-conteo.js') < html.indexOf('js/75-auditoria-flujo.js'));
chk('sw.js precalienta el módulo', /'\.\/js\/71-posicion-conteo\.js\?v=' \+ APP_VERSION/.test(sw));
const vH = (html.match(/\?v=(\d+\.\d+)/) || [])[1], vS = (sw.match(/APP_VERSION\s*=\s*'(\d+\.\d+)'/) || [])[1];
chk('La versión de index.html y sw.js coincide', vH && vH === vS, vH + ' / ' + vS);
chk('La versión avanzó (>= 5.17)', Number((vS || '').split('.')[1]) >= 17, vS);

const ancho = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── v5.17 · Posición en el conteo (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
