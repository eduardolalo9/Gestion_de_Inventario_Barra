// v5.32 — Exportar existencias a Excel: capa pura y garantías estáticas.
//   node pruebas/prueba-v532-exportar-existencias.js
// No necesita navegador ni la librería XLSX (eso lo cubre
// prueba-v532-existencias-navegador.js con el archivo .xlsx real).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });

const mod = leer('js/97-exportar-existencias.js');
const idx = leer('index.html');
const sw = leer('sw.js');
const render = leer('js/70-conversion-render.js');
const util = leer('css/utilidades.css');

const ctx = { console, Math, Date, String, Number, Array, Object, isFinite, JSON };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(mod, ctx);

// ── Nombre del archivo ───────────────────────────────────────────────────
chk('Nombre Existencias_BarInventory_YYYY-MM-DD.xlsx con la fecha LOCAL',
    ctx.existenciasExportNombre(new Date(2026, 9, 21, 23, 59)) === 'Existencias_BarInventory_2026-10-21.xlsx'
    && ctx.existenciasExportNombre(new Date(2026, 0, 5, 0, 1)) === 'Existencias_BarInventory_2026-01-05.xlsx');

// ── Columnas exactas ─────────────────────────────────────────────────────
chk('★ Columnas exactas: Grupo, ID, Descripción, Unidad, En existencia',
    JSON.stringify(vm.runInContext('EXISTENCIAS_EXPORT_COLUMNAS', ctx)) === JSON.stringify(['Grupo', 'ID', 'Descripción', 'Unidad', 'En existencia']));

// ── Filas ────────────────────────────────────────────────────────────────
const prods = [
  { id: '0012', name: 'Tequila "Añejo" & <Ñ>, 750 ml', unit: 'Botella', group: 'Destilados' },
  { id: 'NUEVO', name: 'Producto nuevo', unit: 'Pza' },                // sin grupo → General
  { id: '0012', name: 'duplicado' },                                   // ID repetido
  { name: 'sin id' },                                                  // sin ID
  { id: 'NAN', name: 'cifra rota', unit: 'Pza', group: 'X' },
  { id: 77, name: 'id numérico', unit: 'Kg', group: 'Fruta' }
];
const ex = {
  '0012':  { valor: 5.5, origen: 'oficial', inicial: 3, entradas: 2.5, ventas: 0, operativa: 4 },
  'NUEVO': { valor: 0, origen: 'operativo_no_reconciliado', entradas: 12, ventas: 0, operativa: 0 },
  'NAN':   { valor: NaN, origen: 'operativo_no_reconciliado', entradas: 0, ventas: 0, operativa: NaN },
  '77':    { valor: 1.23456, origen: 'oficial', fuente: 'publicado', inicial: 1, entradas: 0.3, ventas: 0.06544, operativa: 2 }
};
const llamadas = [];
const r = ctx.existenciasExportFilas(prods, (p) => { llamadas.push(String(p.id)); return ex[String(p.id)]; });
chk('Una fila por producto con ID, sin duplicar', r.filas.length === 4 && r.filas.map(f => f.id).join(',') === '0012,NUEVO,NAN,77', r.filas.map(f => f.id).join(','));
chk('★ ID repetido sale una sola vez (el primero) y se reporta', r.duplicados.join() === '0012' && r.filas[0].descripcion.indexOf('Añejo') > 0);
chk('Producto sin ID no se exporta y se cuenta', r.sinId === 1);
chk('★ Cifra no numérica queda VACÍA (null), nunca 0, y se reporta', r.filas[2].existencia === null && r.noNumericos.join() === 'NAN');
chk('ID siempre texto (0012 conserva el cero; 77 → "77")', r.filas[0].id === '0012' && r.filas[3].id === '77');
chk('Sin grupo → "General" (igual que la tabla del catálogo)', r.filas[1].grupo === 'General');
chk('Caracteres especiales intactos', r.filas[0].descripcion === 'Tequila "Añejo" & <Ñ>, 750 ml');
chk('Redondeo a 3 decimales (igual que el conteo)', r.filas[3].existencia === 1.235);
chk('Origen: oficial / respaldo / publicado', r.filas[0].origen === 'oficial' && r.filas[1].origen === 'respaldo' && r.filas[3].origen === 'publicado');
chk('La existencia se pide a la función de la app una vez por producto (no se recalcula aparte)', llamadas.join(',') === '0012,NUEVO,NAN,77', llamadas.join(','));
chk('Lista vacía o inválida → cero filas, sin error', ctx.existenciasExportFilas(null, () => ({})).filas.length === 0);

// ── Avisos ───────────────────────────────────────────────────────────────
const base = { filas: r.filas, duplicados: r.duplicados, sinId: r.sinId, noNumericos: r.noNumericos,
               estado: 'ok', resumen: null, nube: true, enLinea: true, pendientes: 0, sync: 'ok', debeUsarPublicado: false, publicadoEnUso: false };
let av = ctx.existenciasExportAvisos(base);
const txt = (a) => a.map(x => (x.grave ? '[G] ' : '') + x.texto).join(' | ');
chk('★ Compras no reflejadas (producto sin saldo en el corte con entradas) = aviso IMPORTANTE con el ID',
    av.some(a => a.grave && /compras que su existencia todavía NO suma/.test(a.texto) && /NUEVO/.test(a.texto)), txt(av));
chk('Cifra no válida = aviso importante', av.some(a => a.grave && /sin cifra válida/.test(a.texto)));
chk('Duplicados y sin ID = avisos informativos', av.some(a => !a.grave && /ID repetido/.test(a.texto)) && av.some(a => !a.grave && /sin ID/.test(a.texto)));
av = ctx.existenciasExportAvisos(Object.assign({}, base, { filas: [r.filas[0]], noNumericos: [], duplicados: [], sinId: 0 }));
chk('Todo oficial y sincronizado → sin avisos', av.length === 0, txt(av));
av = ctx.existenciasExportAvisos(Object.assign({}, base, { filas: [r.filas[0]], noNumericos: [], duplicados: [], sinId: 0, pendientes: 3, enLinea: false, sync: 'error' }));
chk('★ Sincronización incompleta: sin conexión, cambios pendientes y error = avisos importantes',
    av.filter(a => a.grave).length === 3 && /3 cambio/.test(txt(av)), txt(av));
av = ctx.existenciasExportAvisos(Object.assign({}, base, { filas: [r.filas[0]], noNumericos: [], duplicados: [], sinId: 0, nube: false }));
chk('Sin Firebase: aviso importante (cifras del dispositivo)', av.length === 1 && av[0].grave && /Sin conexión a la nube/.test(av[0].texto));
av = ctx.existenciasExportAvisos(Object.assign({}, base, { filas: [r.filas[0]], noNumericos: [], duplicados: [], sinId: 0,
    resumen: { comprasNoDisponibles: true, ventasNoDisponibles: true, diasFaltantes: ['2026-10-19', '2026-10-20'], periodosPartidos: [{ id: 'x' }] } }));
chk('Compras/ventas ilegibles = importantes; días sin ventas y periodos partidos = informativos',
    av.filter(a => a.grave).length === 2 && av.some(a => !a.grave && /2 día\(s\) sin ventas/.test(a.texto)) && av.some(a => !a.grave && /cruzan la fecha del corte/.test(a.texto)), txt(av));
av = ctx.existenciasExportAvisos(Object.assign({}, base, { filas: [{ id: 'N', existencia: -1, origen: 'oficial', entradas: 0 }], noNumericos: [], duplicados: [], sinId: 0 }));
chk('Existencia negativa = aviso (se exporta tal cual, no se "corrige" a 0)', av.length === 1 && /negativa/.test(av[0].texto));
av = ctx.existenciasExportAvisos(Object.assign({}, base, { filas: [r.filas[0]], noNumericos: [], duplicados: [], sinId: 0, debeUsarPublicado: true, publicadoEnUso: false }));
chk('Usuario sin compras/ventas y sin Total publicado vigente = aviso importante', av.length === 1 && av[0].grave);
av = ctx.existenciasExportAvisos(Object.assign({}, base, { filas: [r.filas[1]], noNumericos: [], duplicados: [], sinId: 0, estado: 'no_existe', motivo: 'ancla_vieja' }));
chk('Sin corte vigente (ancla vieja) = se dice que todo sale del conteo', av.some(a => /más de 8 semanas/.test(a.texto)), txt(av));

// ── Garantías estáticas: SOLO LECTURA ────────────────────────────────────
const codigo = mod.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
chk('★ No escribe en Firestore (sin set/update/add/delete/batch/runTransaction)', !/\.(set|update|add|delete|batch|runTransaction)\s*\(/.test(codigo),
    (codigo.match(/\.(set|update|add|delete|batch|runTransaction)\s*\(/g) || []).join(','));
chk('★ No toca localStorage, la cola de sync ni guarda datos', !/localStorage\.(setItem|removeItem|clear)|saveToLocalStorage|_syncQueue\.push|syncToCloud\(|guardarCompra|guardarVentasPeriodo/.test(codigo));
chk('★ No modifica productos, áreas, conteos, compras ni movimientos',
    !/\b(products|compras|movimientos|inventarioConteo|auditoriaConteo|stockByArea)\s*(=[^=]|\.push|\.splice)/.test(codigo) && !/\.stockByArea\s*\[[^\]]*\]\s*=[^=]/.test(codigo));
chk('★ La cifra sale de existenciaOficial() con UNA foto de entradas y consumo (la misma de la columna Stock)',
    /var ent = existenciaEntradas\(\), ven = existenciaVentas\(\);/.test(mod) && /existenciaOficial\(p, ent, ven\)/.test(mod));
chk('★ Error al leer el corte o el Total publicado → NO se exporta', /est\.estado === 'error'[\s\S]{0,400}motivo: 'error_corte'/.test(mod) && /motivo: 'error_publicado'/.test(mod));
chk('Corte aún cargando tras esperar → NO se exporta', /motivo: 'cargando'/.test(mod));
chk('★ Exige inventory.export (botón y función)', (mod.match(/hasPermission\('inventory\.export'\)/g) || []).length >= 2);
chk('★ Una exportación a la vez (candado enCurso)', /if \(_exExport\.enCurso\)/.test(mod) && /_exExport\.enCurso = true;/.test(mod));
chk('Avisos importantes → confirmación antes de descargar (showConfirm)', /showConfirm\(msg/.test(mod));
chk('Usa la librería XLSX que ya carga la app (sin librerías nuevas)', /typeof XLSX === 'undefined'/.test(mod) && !/<script|import\s|require\(/.test(codigo));
chk('Filtros (autofilter), anchos (!cols) y primera fila fija (pane frozen)', /'!autofilter'/.test(mod) && /'!cols'/.test(mod) && /state="frozen"/.test(mod));

// ── Integración ──────────────────────────────────────────────────────────
chk('index.html carga js/97 antes de js/98 y del arranque', idx.indexOf('js/97-exportar-existencias.js') > 0 && idx.indexOf('js/97-exportar-existencias.js') < idx.indexOf('js/98-navegacion-atras.js') && idx.indexOf('js/98-navegacion-atras.js') < idx.indexOf('js/99-window-arranque.js'));
chk('sw.js lo calienta (WARM_URLS), no en PRECACHE', /'\.\/js\/97-exportar-existencias\.js\?v=' \+ APP_VERSION/.test(sw) && !/PRECACHE_URLS\s*=\s*\[[^\]]*97-exportar/.test(sw));
chk('Productos inserta el botón fuera de la región de búsqueda (exporta el catálogo completo)',
    /if \(typeof existenciasExportBotonHtml === 'function'\) html \+= existenciasExportBotonHtml\(\);[\s\S]*BusquedaUI\.barra\('catalogo'/.test(render));
const bloqueCss = util.slice(util.indexOf('/* v5.32'));
chk('Estilos del botón en utilidades.css, solo tokens (cero hex), táctil ≥ 44 px', bloqueCss.length > 100 && !/#[0-9a-fA-F]{3,8}\b/.test(bloqueCss) && /min-height: 44px/.test(bloqueCss));
chk('Icono Excel ya definido en utilidades.css', /^\.fa-file-excel\b/m.test(util) && /^\.fa-spin\b/m.test(util));

const fallos = C.filter(c => !c.ok);
C.forEach(c => console.log((c.ok ? '  ✅  ' : '  ❌  ') + c.n + (c.ok ? '' : '  → ' + c.d)));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
process.exit(fallos.length ? 1 : 0);
