// v5.36 — Físico vs Sistema: «Diferencias ↓» (de mayor a menor), junto a «Diferencias ↑».
//   node pruebas/prueba-v536-diferencias-desc.js
// Capa pura (js/49) + garantías estáticas de la pantalla (js/85) y del Excel (js/97).
// La prueba en navegador real del mismo botón vive en prueba-v536-diferencias-navegador.js.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function funcion(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    const m = /\n        (?:async )?function /.exec(src.slice(ini + 10));
    return m ? src.slice(ini, ini + 10 + m.index) : src.slice(ini);
}
const src49 = leer('js/49-fisico-vs-sistema.js'), src85 = leer('js/85-ui-inventario-fisico.js'), src97 = leer('js/97-exportar-diferencias.js');

const ctx = { console, Math, Date, String, Number, Array, Object, JSON, isFinite, parseFloat,
    AREAS_CONTEO: ['almacen'], _inventarioActivo: { estado: 'SINCRONIZADO', numero: 7 }, _inventarioActivoId: 'INV7',
    inventarioAbierto: (i) => !!i && i.estado === 'SINCRONIZADO', existenciaEntradas: () => ({}), existenciaVentas: () => ({}),
    EXISTENCIA_TOLERANCIA: 0.001, tieneConversion: () => false, convertirOzAPuntos: () => 0,
    existenciaOficial: (p) => ({ valor: p._sis, origen: 'oficial', hayInicial: true }), products: [], auditoriaConteo: {} };
ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src49, ctx);

const filas = [
    { id: 'x1', nombre: 'Z', grupo: 'RON',  estado: 'contado', diferencia: 10 }, { id: 'x2', nombre: 'Y', grupo: 'RON',  estado: 'contado', diferencia: -10 },
    { id: 'x3', nombre: 'X', grupo: 'VODKA', estado: 'contado', diferencia: 2 }, { id: 'x4', nombre: 'W', grupo: 'RON',  estado: 'contado', diferencia: NaN },
    { id: 'x5', nombre: 'V', grupo: 'RON',  estado: 'pendiente', diferencia: null }, { id: 'x6', nombre: 'U', grupo: 'VODKA', estado: 'contado', diferencia: 0 },
    { id: 'x7', nombre: 'A', grupo: 'RON',  estado: 'contado', diferencia: 2 }
];
ctx._f = filas; const antes = JSON.stringify(filas);
const ids = (r) => r.map(f => f.id).join(',');

const desc = vm.runInContext('fisicoVsSistemaOrdenarDifDesc(_f)', ctx);
chk('★ Descendente NUMÉRICO: +10, +2, +2, 0, −10; sin contar/ inválidos al final (no se vuelven 0)', ids(desc) === 'x1,x7,x3,x6,x2,x5,x4', ids(desc));
chk('Empate (+2 y +2) se resuelve por nombre, siempre igual', ids(desc).indexOf('x7,x3') !== -1);
chk('★ Es exactamente lo contrario de ↑ en lo contado (mismos productos, sin perder ninguno)',
    JSON.stringify(desc.slice(0, 5).map(f => f.id).sort()) === JSON.stringify(vm.runInContext('fisicoVsSistemaOrdenarDifAsc(_f)', ctx).slice(0, 5).map(f => f.id).sort()) && desc.length === filas.length);
chk('★ Ordenar no modifica las filas recibidas', JSON.stringify(filas) === antes);

const vD = vm.runInContext('fisicoVsSistemaOrdenVisible(_f, { difDesc: true })', ctx);
chk('Orden visible con difDesc: modo plano y orden descendente', vD.modo === 'plano' && ids(vD.filas) === ids(desc));
const vG = vm.runInContext('fisicoVsSistemaOrdenVisible(_f, { difDesc: true, grupo: "VODKA" })', ctx);
chk('★ «Diferencias ↓» respeta el grupo elegido', ids(vG.filas) === 'x3,x6');
const vAmbos = vm.runInContext('fisicoVsSistemaOrdenVisible(_f, { difAsc: true, difDesc: true })', ctx);
chk('Si llegan los dos, manda ↑ (nunca dos órdenes a la vez)', ids(vAmbos.filas) === ids(vm.runInContext('fisicoVsSistemaOrdenarDifAsc(_f)', ctx)));
const vNada = vm.runInContext('fisicoVsSistemaOrdenVisible(_f, {})', ctx);
chk('Sin ↑ ni ↓: orden por grupo de siempre', vNada.modo === 'grupos');

const c85 = sinCom(funcion(src85, 'fvsAlternarDifDesc') + funcion(src85, 'fvsAlternarDifAsc') + funcion(src85, 'fvsReiniciarVista'));
chk('★ ↑ y ↓ son excluyentes y solo cambian la vista (sin guardar ni sincronizar)',
    /difAsc\) _fvsVista\.difDesc = false/.test(c85) && /difDesc\) _fvsVista\.difAsc = false/.test(c85) && !/saveToLocalStorage|syncToCloud|localStorage|Firestore|\.set\(|\.update\(/.test(c85));
chk('Volver reinicia también ↓', /fvsReiniciarVista\(\)[^}]*difDesc = false/.test(src85.replace(/\n/g, ' ')));
chk('Botón «Diferencias ↓» con id, aria-pressed y objetivo táctil de 44 px (misma clase que ↑)',
    /id="fvsDifDescBtn"/.test(src85) && /fvsAlternarDifDesc\(\)/.test(src85) && /Diferencias ↓/.test(src85) && /aria-pressed="' \+ \(_fvsVista\.difDesc/.test(src85));
chk('Las opciones de la vista (pantalla y Excel) incluyen difDesc', /difDesc: _fvsVista\.difDesc/.test(src85) && /difDesc: false/.test(src97));
chk('Con ↑ o ↓ se oculta el chip de invertir el orden por grupo', /_fvsVista\.difAsc \|\| _fvsVista\.difDesc\) && c\.id === 'orden_desc'/.test(src85));
chk('El Excel conserva el mismo orden visible y rotula «mayor a menor»', /Diferencias de mayor a menor \(sin agrupar\)/.test(src97) && /fisicoVsSistemaOrdenVisible\(datos\.filas, op\)/.test(src97));
chk('Las 9 columnas del Excel no cambian', /FVS_EXPORT_COLUMNAS = \['Grupo', 'ID', 'Descripción', 'Unidad', 'Cantidad en sistema',\s*'Cantidad contada', 'Diferencia', 'Precio', 'Precio total de diferencia'\]/.test(src97));

let mal = 0;
C.forEach(c => { console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok ? '' : '  → ' + c.d)); if (!c.ok) mal++; });
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - mal) + ' pasaron · ' + mal + ' fallaron\n');
process.exit(mal ? 1 : 0);
