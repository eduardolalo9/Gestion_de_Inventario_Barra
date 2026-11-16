// v5.52 — Muestreo: filtros por desviación, grupo, buscador y revisados. Capa pura con el código REAL de
// js/49 (vm) + equivalencia con el tono de la tarjeta (js/85) + guardas estáticas.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
function extraer(src, nombre) {
    let ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    if (src.slice(ini - 6, ini) === 'async ') ini -= 6;
    const m = /\n        (?:\/\*\*|\/\/ ──|(?:async )?function )/.exec(src.slice(ini + 16));
    return m ? src.slice(ini, ini + 16 + m.index) : src.slice(ini);
}
const s49 = leer('js/49-fisico-vs-sistema.js'), s85 = leer('js/85-ui-inventario-fisico.js'), s80 = leer('js/80-buscador.js');
const ctx = { console, Math, Number, String, Array, Object, isFinite, window: {} }; vm.createContext(ctx);
vm.runInContext(['fisicoVsSistemaGrupos', 'fvsMuestreoTono', 'fvsMuestreoFiltrar', 'fvsMuestreoConteos'].map(n => extraer(s49, n)).join('\n'), ctx);
vm.runInContext(extraer(s85, '_fvsTono'), ctx);
const r = (c) => vm.runInContext(c, ctx);

const F = (id, grupo, dif) => ({ id, nombre: 'P' + id, grupo, diferencia: dif, estado: 'contado' });
const filas = [F('A', 'TEQUILA', -4), F('B', 'TEQUILA', 2), F('C', 'VODKA', 0), F('D', 'VODKA', -1), F('E', 'RON', 2), F('G', null, 0.0004)];
ctx.__f = filas; ctx.__rv = { C: 111, D: 222 };
const ids = (a) => a.map(x => x.id).join(',');
const fil = (o) => ids(vm.runInContext('fvsMuestreoFiltrar(__f, Object.assign({ revisados: __rv }, ' + JSON.stringify(o) + '))', ctx));

// ═══ 1 · Tono = el de la tarjeta ═══
chk('★ El tono de desviación es EXACTAMENTE el de la tarjeta (_fvsTono) para negativos, positivos, ceros y bordes de tolerancia',
    [-4, -0.002, -0.001, -0.0009, 0, 0.0009, 0.001, 0.002, 2].every(d => r("fvsMuestreoTono({ diferencia: " + d + " }, 0.001)") === r("_fvsTono({ diferencia: " + d + " }, 0.001)")));
// ═══ 2 · Desviación ═══
chk('Sin filtros (por defecto) deja TODO y en el mismo orden', fil({}) === 'A,B,C,D,E,G');
chk('★ «Faltante» = diferencia negativa mayor que la tolerancia (A, D)', fil({ desv: 'faltante' }) === 'A,D');
chk('★ «Sobrante» = diferencia positiva mayor que la tolerancia (B, E)', fil({ desv: 'sobrante' }) === 'B,E');
chk('★ «Coincide» incluye lo que cae dentro de la tolerancia (C, G con 0.0004)', fil({ desv: 'coincide' }) === 'C,G');
chk('★ «Con diferencia» = faltante o sobrante (A, B, D, E)', fil({ desv: 'con' }) === 'A,B,D,E');
// ═══ 3 · Grupo ═══
chk('Grupo: solo ese grupo; un producto sin grupo cuenta como «General»', fil({ grupo: 'TEQUILA' }) === 'A,B' && fil({ grupo: 'General' }) === 'G');
chk('Grupo vacío o null = todos', fil({ grupo: '' }) === 'A,B,C,D,E,G' && fil({ grupo: null }) === 'A,B,C,D,E,G');
// ═══ 4 · Revisados ═══
chk('★ «Pendientes» = lo que NO está marcado revisado (A, B, E, G)', fil({ rev: 'pendientes' }) === 'A,B,E,G');
chk('★ «Revisados» = lo marcado (C, D)', fil({ rev: 'revisados' }) === 'C,D');
chk('«Todos» no filtra', fil({ rev: 'todos' }) === 'A,B,C,D,E,G');
// ═══ 5 · Combinados ═══
chk('★ Los filtros se combinan con Y: faltante + VODKA = D', fil({ desv: 'faltante', grupo: 'VODKA' }) === 'D');
chk('★ faltante + pendientes = A (D ya está revisado)', fil({ desv: 'faltante', rev: 'pendientes' }) === 'A');
chk('faltante + VODKA + pendientes = nada (D está revisado)', fil({ desv: 'faltante', grupo: 'VODKA', rev: 'pendientes' }) === '');
chk('con diferencia + TEQUILA + revisados = nada', fil({ desv: 'con', grupo: 'TEQUILA', rev: 'revisados' }) === '');
chk('Valores desconocidos no filtran por error (se tratan como «todas/todos»)', fil({ desv: 'otra', rev: 'x' }) === 'A,B,C,D,E,G');
// ═══ 6 · Inmutabilidad y robustez ═══
r("__copia = JSON.stringify(__f)"); fil({ desv: 'faltante', rev: 'pendientes' });
chk('★ No modifica las filas recibidas ni su orden (devuelve copia)', r("JSON.stringify(__f)") === ctx.__copia);
chk('Entradas inválidas no revientan (null, filas null, sin revisados)', r("fvsMuestreoFiltrar(null).length") === 0 && r("fvsMuestreoFiltrar([null, { id: 'Z', diferencia: 1 }], { desv: 'sobrante' }).length") === 1);
// ═══ 7 · Conteos de los rótulos ═══
const n = JSON.parse(r("JSON.stringify(fvsMuestreoConteos(__f, __rv, 0.001))"));
chk('★ Conteos por desviación: todas 6 · con diferencia 4 · faltante 2 · sobrante 2 · coincide 2', JSON.stringify(n.desv) === JSON.stringify({ todas: 6, con: 4, faltante: 2, sobrante: 2, coincide: 2 }), JSON.stringify(n.desv));
chk('★ Conteos de revisados: todos 6 · pendientes 4 · revisados 2', JSON.stringify(n.rev) === JSON.stringify({ todos: 6, pendientes: 4, revisados: 2 }), JSON.stringify(n.rev));
chk('Grupos con su cantidad, alfabéticos (General 1, RON 1, TEQUILA 2, VODKA 2)', n.grupos.map(g => g.grupo + ' ' + g.n).join(', ') === 'General 1, RON 1, TEQUILA 2, VODKA 2', JSON.stringify(n.grupos));

// ═══ 8 · Guardas estáticas ═══
const mu = ['_fvsMuTarjetaHtml', '_fvsMuBase', '_renderFvsMuResultados', '_fvsMuFiltrosHtml', 'fvsMuFiltrar', 'fvsMuLimpiarFiltros'].map(nn => extraer(s85, nn)).join('\n');
chk('★ Los filtros SOLO cambian lo que se ve: ninguna función de filtrado escribe (sin Firestore, ni update/set, ni localStorage)',
    mu.length > 500 && !/\.update\(|\.set\(|batch|localStorage|_fvsMuestreoCambiar|fvsMuestreoAgregar|fvsMuestreoQuitar|fvsMuestreoRevisado\(/.test(extraer(s85, '_renderFvsMuResultados') + extraer(s85, '_fvsMuFiltrosHtml') + extraer(s85, 'fvsMuFiltrar') + extraer(s85, 'fvsMuLimpiarFiltros')));
chk('El estado de los filtros vive en memoria (_fvsVista) y se reinicia al salir (fvsReiniciarVista)',
    /muDesv: 'todas', muGrupo: null, muRev: 'todos'/.test(s85) && /_fvsVista\.muDesv = 'todas'; _fvsVista\.muGrupo = null; _fvsVista\.muRev = 'todos'; _fvsMuTerm = ''/.test(s85));
chk('★ El buscador de Muestreo es PROPIO (clave «fvsmu», término _fvsMuTerm): no pisa el del Comparativo',
    /BusquedaUI\.registrar\('fvsmu'/.test(s80) && /_fvsMuTerm/.test(s80) && /BusquedaUI\.barra\('fvsmu'/.test(s85) && /BusquedaUI\.region\('fvsmu'/.test(s85));
chk('Los selectores usan funciones globales con valores fijos (sin interpolar datos en el onchange)', !/onchange="fvsMuFiltrar\([^"]*' *\+/.test(s85));
chk('La lista vacía conserva su mensaje y no muestra filtros', /if \(!ids\.length\) \{\s*return h \+ '<p class="fvs-mu__vacio">Lista vacía/.test(extraer(s85, '_fvsMuestreoHtml')));
chk('Las acciones de la tarjeta (editar, marcar revisado, quitar) siguen siendo las mismas', /data-fvs-accion="mu-revisado"/.test(s85) && /data-fvs-accion="mu-quitar"/.test(s85) && /data-fvs-accion="editar"/.test(s85));

const css = leer('css/utilidades.css');
const iconos = (extraer(s85, '_fvsMuFiltrosHtml').match(/fa-[a-z0-9-]+/g) || []).filter(i => !['fa-solid'].includes(i));
chk('★ Todos los iconos de los filtros existen en el set LOCAL (con máscara): si no, se ven como un cuadro sólido (' + iconos.join(', ') + ')',
    iconos.length >= 5 && iconos.every(i => new RegExp('\\.' + i + '\\s*\\{').test(css)), iconos.filter(i => !new RegExp('\\.' + i + '\\s*\\{').test(css)).join(', '));

const fallos = C.filter(x => !x.ok);
C.forEach(x => console.log((x.ok ? '  ✅ ' : '  ❌ ') + x.n + (x.ok ? '' : '  ← ' + x.d)));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
process.exit(fallos.length ? 1 : 0);
