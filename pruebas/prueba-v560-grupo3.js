// v5.60 — Grupo 3 del rediseño (estática).
//   node pruebas/prueba-v560-grupo3.js
// · H10: un inventario cerrado sin fechaCierre válida dice «Fecha no registrada»
//   (antes «31/12/1969» o «Invalid Date»).
// · H11: las filas de filtros del buscador común desvanecen su borde solo donde hay
//   más filtros (máscara movida por la línea de tiempo del propio desplazamiento).
// · H7: content-visibility en las tarjetas de Inicio se midió y se DESCARTÓ. Al volver
//   a pintar estando abajo en la lista, la vista saltaba de 3 a 6 productos. Esta
//   prueba evita que vuelva sin otra medición.
// La medición real en Chromium es prueba-v560-grupo3-navegador.js.
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const js85 = leer('js/85-ui-inventario-fisico.js'), util = leer('css/utilidades.css'), dens = leer('css/densidad.css'),
      esti = leer('css/estilos.css'), mini = leer('css/tema-minimal.css'), idx = leer('index.html'), sw = leer('sw.js'),
      neg = leer('js/94-control-negativos.js'), b06 = leer('js/06-busqueda-ui.js');

// ── Versión ──
const ver = (/const APP_VERSION = '([\d.]+)'/.exec(sw) || [])[1];
// v5.61 — la versión sigue subiendo: se pide la 5.60 o una posterior y que TODOS los ?v= coincidan con APP_VERSION.
const _vNum = (v) => String(v || '0').split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
const _vEsc = String(ver).replace(/\./g, '\\.');
chk('★ APP_VERSION 5.60 o posterior y todos los ?v= de index.html iguales a ella',
    _vNum(ver) >= _vNum('5.60') && (idx.match(new RegExp('\\?v=' + _vEsc + '\\b', 'g')) || []).length >= 50 && !new RegExp('\\?v=(?!' + _vEsc + '\\b)[\\d.]+').test(idx), ver);

// ── H10 ──
const fn = (/function _fechaCierreTexto\(v\) \{[\s\S]*?\n        \}/.exec(js85) || [''])[0];
chk('★ H10: _fechaCierreTexto reconoce null, ausente, vacío, 0 y fechas ilegibles', /=== null/.test(fn) && /=== undefined/.test(fn) && /=== ''/.test(fn) && /=== 0/.test(fn) && /isNaN\(d\.getTime\(\)\)/.test(fn), fn.slice(0, 120));
chk('H10: el texto es exactamente «Fecha no registrada»', /var FECHA_NO_REGISTRADA = 'Fecha no registrada';/.test(js85));
chk('H10: una fecha válida se sigue pintando con toLocaleDateString(\'es-MX\')', /d\.toLocaleDateString\('es-MX'\)/.test(fn));
chk('H10: un Timestamp de Firestore se lee como fecha (toMillis)', /typeof v\.toMillis === 'function'/.test(fn));
chk('★ H10: las dos vistas de «Cerrado» usan la guardia; ya no queda new Date(…fechaCierre) en js/85',
    (js85.match(/_cerradoTexto\((inv|meta)\.fechaCierre, (inv|meta)\.cerradoPorNombre\)/g) || []).length === 2 && !/new Date\(\w+\.fechaCierre\)/.test(js85));
chk('H10: fecha y nombre se escapan (escapeHtml)', /return escapeHtml\(f\) \+ \(f === FECHA_NO_REGISTRADA \? ' · por ' : ' por '\) \+ escapeHtml\(nombre \|\| '—'\);/.test(js85));

// ── H11 ──
const ini = util.indexOf('/* v5.60 — H11');
const bloque = ini >= 0 ? util.slice(ini) : '';
const regla = sinCom(bloque);
chk('★ H11: el bloque vive en utilidades.css (estilos.css y densidad.css no se tocan para esto)', ini >= 0 && !/sbx-borde/.test(esti + dens + mini));
chk('★ H11: solo la fila del buscador común ([data-sbx-chips])', /\.sbx-chips\[data-sbx-chips\]\s*\{/.test(regla) && !/\.sbx-chips\s*\{/.test(regla));
chk('H11: BusquedaUI.chips sigue marcando la fila con data-sbx-chips', /<div class="sbx-chips" role="group" aria-label="Filtros rápidos" data-sbx-chips="/.test(b06));
chk('H11: la fila propia de Control de negativos (aplazado) no lleva data-sbx-chips, así que no cambia', /<div class="sbx-chips" role="group" aria-label="Filtrar">/.test(neg) && !/data-sbx-chips/.test(neg));
chk('★ H11: sin JS; desvanecido movido por scroll(self inline) y protegido con @supports', /@supports \(animation-timeline: scroll\(\)\)/.test(regla) && /animation-timeline: scroll\(self inline\);/.test(regla) && /animation: sbx-borde linear both;\s*animation-timeline/.test(regla));
chk('H11: máscara con y sin prefijo, y las dos orillas como propiedades registradas', /-webkit-mask-image: linear-gradient/.test(regla) && /\n\s*mask-image: linear-gradient/.test(regla) && /@property --sbx-borde-izq/.test(regla) && /@property --sbx-borde-der/.test(regla));
chk('H11: sin overflow las orillas valen 0 px (initial-value) y no se desvanece nada', /--sbx-borde-izq \{[^}]*initial-value: 0px/.test(regla) && /--sbx-borde-der \{[^}]*initial-value: 0px/.test(regla));
chk('H11: con teclado el filtro enfocado queda fuera del desvanecido (scroll-padding-inline)', /scroll-padding-inline: 28px/.test(regla));
chk('H11: solo transparencia; ni hex, ni rgb(), ni oklch()', bloque.length > 300 && !/#[0-9a-fA-F]{3,8}\b/.test(regla) && !/rgba?\(|oklch\(/.test(regla));

// ── H7 descartado ──
chk('★ H7: content-visibility NO está en ninguna hoja (se midió: movía la vista al volver a pintar)', !/content-visibility/.test(sinCom(esti + util + dens + mini)));

let mal = 0;
C.forEach(c => { console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '  → ' + c.d)); if (!c.ok) mal++; });
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron\n');
process.exit(mal ? 1 : 0);
