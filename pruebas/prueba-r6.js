#!/usr/bin/env node
/**
 * prueba-r6.js — R6: áreas de conteo configurables
 * ═══════════════════════════════════════════════════════════════════════════
 * Hasta aquí las áreas eran tres constantes escritas a mano en CINCO sitios:
 * el array AREAS_CONTEO y cuatro objetos de metadatos. Agregar una cuarta
 * obligaba a editar los cinco de forma consistente, y olvidar uno produce el
 * fallo más difícil de ver: un área en la que se puede contar pero que no
 * entra en los totales. Lo contado ahí no desaparece de la pantalla — solo
 * deja de sumar.
 *
 * Esta prueba carga el módulo real y lo ejecuta con las estructuras de la app
 * simuladas, para comprobar que un alta llega a las cinco a la vez.
 *
 * Lo que defiende, por encima de todo: los identificadores almacen, barra1 y
 * barra2 no se pueden eliminar ni renombrar. Están escritos dentro de cada
 * conteo guardado y de cada inventario cerrado; tocarlos desconectaría el
 * histórico del presente sin dar ningún error.
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
function eq(nombre, recibido, esperado, nota) {
    chk(nombre, JSON.stringify(recibido) === JSON.stringify(esperado),
        'esperaba ' + JSON.stringify(esperado) + ' y llegó ' + JSON.stringify(recibido) +
        (nota ? ' — ' + nota : ''));
}

const src = fs.readFileSync(path.join(RAIZ, 'js/18-areas-config.js'), 'utf8');
// El módulo pregunta "¿está abierto el inventario?" a inventarioAbierto()
// (10-multiusuario.js). Se trae la función REAL, no una copia: si la regla
// cambia allí, esta prueba tiene que enterarse.
const multi = fs.readFileSync(path.join(RAIZ, 'js/10-multiusuario.js'), 'utf8');
const srcAbierto = (multi.match(/function inventarioAbierto\(inv\) \{[\s\S]*?\n        \}/) || [''])[0];

// Se monta el entorno mínimo que el módulo espera: las cinco estructuras que
// muta, más los pocos globales que consulta.
function nuevoEntorno(esAdmin) {
    const ctx = vm.createContext({
        AREAS_CONTEO: ['almacen', 'barra1', 'barra2'],
        areas: {}, areasAuditoria: {}, areasAuditoriaIcons: {}, areasAuditoriaFA: {},
        selectedArea: 'almacen',
        inventarioConteo: {}, myAuditoriaConteo: {},
        _inventarioActivo: null,
        isAdmin: function() { return esAdmin !== false; },
        // FASE 2A — el módulo de áreas dejó de preguntar "¿eres admin?" y
        // ahora pregunta por un permiso concreto (warehouses.*). En este
        // entorno de prueba el administrador los tiene todos, igual que en
        // la aplicación real, donde el comodín '*' se resuelve antes que
        // cualquier otra regla.
        hasPermission: function(p) {
            return esAdmin !== false && /^warehouses\./.test(p);
        },
        localStorage: (function() {
            const m = {};
            return { getItem: k => (k in m ? m[k] : null),
                     setItem: (k, v) => { m[k] = String(v); },
                     removeItem: k => { delete m[k]; } };
        })(),
        console: { warn() {}, info() {} },
    });
    vm.runInContext(srcAbierto + '\n' + src + `
        globalThis.API = { areasDefinidas, areaInfo, crearAreaConteo, editarAreaConteo,
            eliminarAreaConteo, aplicarDefinicionAreas, cargarAreasLocal, conteosEnArea,
            sugerirIdArea, _stockInicialPorArea, _esAreaDeSistema, renderAreasConteoAdmin };
        globalThis.G = () => ({ ids: AREAS_CONTEO.slice(), areas: Object.assign({}, areas),
            aud: Object.assign({}, areasAuditoria), ico: Object.assign({}, areasAuditoriaIcons),
            fa: Object.assign({}, areasAuditoriaFA), sel: selectedArea });
        cargarAreasLocal();
    `, ctx);
    return ctx;
}

// ═══ 1 · Estado de partida ════════════════════════════════════════════════
let ctx = nuevoEntorno(true);
eq('Arranca con las tres áreas de producción', ctx.G().ids, ['almacen', 'barra1', 'barra2']);
eq('Los nombres corporativos son los de siempre', ctx.G().aud,
   { almacen: 'Almacén', barra1: 'Barra Restaurante', barra2: 'Barra Bar' },
   'R6 no puede cambiar lo que el bartender ve escrito');

// ═══ 2 · Un alta llega a las CINCO estructuras ═══════════════════════════
const alta = ctx.API.crearAreaConteo({ nombre: 'Barra Terraza', icono: '🌴' });
chk('Se puede crear un área nueva', alta.ok === true, JSON.stringify(alta));
eq('El identificador se genera del nombre', alta.id, 'barra-terraza');

let g = ctx.G();
chk('Entra en AREAS_CONTEO',        g.ids.indexOf('barra-terraza') !== -1);
chk('Entra en las etiquetas',       g.areas['barra-terraza'] === 'Barra Terraza');
chk('Entra en los nombres largos',  g.aud['barra-terraza'] === 'Barra Terraza');
chk('Entra en los emojis',          g.ico['barra-terraza'] === '🌴');
chk('Entra en los iconos FA',       !!g.fa['barra-terraza'],
    'si falta aquí, el área se cuenta pero sale sin icono en el panel');
eq('Las tres originales siguen intactas', g.ids.slice(0, 3), ['almacen', 'barra1', 'barra2']);

eq('El stock inicial de un producto nuevo incluye la nueva',
   Object.keys(ctx.API._stockInicialPorArea(0)), ['almacen', 'barra1', 'barra2', 'barra-terraza'],
   'con el objeto escrito a mano, el producto no tenía dónde acumular lo contado ahí');

// ═══ 3 · Identificadores ═════════════════════════════════════════════════
eq('Los acentos y espacios se convierten en un id limpio',
   ctx.API.sugerirIdArea('Bodega Fría del Sótano'), 'bodega-fria-del-sotano');
eq('Un nombre solo con símbolos no produce id', ctx.API.sugerirIdArea('!!!'), '');

chk('No se admite un id repetido',
    ctx.API.crearAreaConteo({ nombre: 'Barra Terraza' }).ok === false);
chk('No se admite un área sin nombre',
    ctx.API.crearAreaConteo({ nombre: '   ' }).ok === false);
chk('No se admite un id con caracteres raros',
    ctx.API.crearAreaConteo({ nombre: 'X', id: 'barra/terraza' }).ok === false,
    'ese id acabaría formando una ruta de Firestore');

// ═══ 4 · Lo que NO se puede tocar ════════════════════════════════════════
['almacen', 'barra1', 'barra2'].forEach(function(id) {
    const r = ctx.API.eliminarAreaConteo(id);
    chk('No se puede eliminar ' + id, r.ok === false,
        'su id está dentro de cada inventario ya cerrado');
});

// Renombrar sí, pero el id se queda.
const ren = ctx.API.editarAreaConteo('barra1', { nombre: 'Barra Principal' });
chk('Sí se puede renombrar un área fija', ren.ok === true);
eq('El nombre cambió',       ctx.G().aud['barra1'], 'Barra Principal');
eq('Pero el id NO cambió',   ctx.G().ids.slice(0, 3), ['almacen', 'barra1', 'barra2'],
   'cambiarlo desconectaría el histórico del presente sin dar ningún error');
chk('Un nombre vacío se rechaza al editar',
    ctx.API.editarAreaConteo('barra1', { nombre: '  ' }).ok === false);

// ═══ 5 · Eliminar un área con conteos dentro ═════════════════════════════
ctx = nuevoEntorno(true);
ctx.API.crearAreaConteo({ nombre: 'Barra Terraza' });
vm.runInContext("inventarioConteo['P1'] = { 'barra-terraza': { enteras: 3, abiertas: [] } };", ctx);

eq('Se detectan los conteos del área', ctx.API.conteosEnArea('barra-terraza'), 1);
const conDatos = ctx.API.eliminarAreaConteo('barra-terraza');
chk('Un área con conteos NO se elimina', conDatos.ok === false);
eq('…y se dice cuántos hay',            conDatos.conteos, 1,
   'decir solo "no se puede" obliga a adivinar qué falta');

vm.runInContext("inventarioConteo['P1']['barra-terraza'] = { enteras: 0, abiertas: [] };", ctx);
chk('Vaciado el conteo, ya se elimina',
    ctx.API.eliminarAreaConteo('barra-terraza').ok === true);
eq('Y quedan las tres de siempre', ctx.G().ids, ['almacen', 'barra1', 'barra2']);

// Con un inventario abierto no se toca el reparto: puede haber gente contando.
ctx = nuevoEntorno(true);
ctx.API.crearAreaConteo({ nombre: 'Barra Terraza' });
vm.runInContext("_inventarioActivo = { estado: 'SINCRONIZADO' };", ctx);
chk('Con un Inventario Físico abierto no se eliminan áreas',
    ctx.API.eliminarAreaConteo('barra-terraza').ok === false,
    'puede haber bartenders contando en ella ahora mismo');
// Un inventario CONTABILIZADO ya no se cuenta: antes se tomaba por abierto
// (no era 'CERRADO') y dejaba las áreas bloqueadas para siempre.
vm.runInContext("_inventarioActivo = { estado: 'CONTABILIZADO' };", ctx);
chk('★ Con el inventario CONTABILIZADO las áreas vuelven a editarse',
    !!srcAbierto && ctx.API.eliminarAreaConteo('barra-terraza').ok === true,
    'un contabilizado es de solo lectura, no un inventario abierto');

// ═══ 6 · Permisos ════════════════════════════════════════════════════════
const noAdmin = nuevoEntorno(false);
chk('Un no-admin no puede crear áreas',    noAdmin.API.crearAreaConteo({ nombre: 'X' }).ok === false);
chk('Un no-admin no puede editarlas',      noAdmin.API.editarAreaConteo('barra1', { nombre: 'X' }).ok === false);
chk('Un no-admin no puede eliminarlas',    noAdmin.API.eliminarAreaConteo('barra2').ok === false);
eq('Y no ve la pantalla de administración', noAdmin.API.renderAreasConteoAdmin(), '');

// ═══ 7 · Configuración que llega de fuera ════════════════════════════════
ctx = nuevoEntorno(true);
chk('Una definición vacía se rechaza',  ctx.API.aplicarDefinicionAreas([]) === false,
    'quedarse sin áreas dejaría la app sin poder contar');
chk('Una definición que no es lista se rechaza', ctx.API.aplicarDefinicionAreas('nada') === false);
eq('Tras rechazarla, las áreas siguen ahí', ctx.G().ids, ['almacen', 'barra1', 'barra2']);

// Si la nube manda una configuración a la que le falta un área de sistema, se
// repone: sin ella, los conteos históricos de esa área quedan fuera de los
// totales sin que nada avise.
ctx.API.aplicarDefinicionAreas([{ id: 'solo-una', nombre: 'Sola', orden: 9 }]);
const tras = ctx.G().ids;
['almacen', 'barra1', 'barra2'].forEach(function(id) {
    chk('Se repone el área de sistema ' + id, tras.indexOf(id) !== -1);
});
chk('Y se conserva la que venía', tras.indexOf('solo-una') !== -1);

// Basura mezclada con datos buenos: se filtra lo malo y se queda lo bueno.
ctx = nuevoEntorno(true);
ctx.API.aplicarDefinicionAreas([
    { id: 'almacen', nombre: 'Almacén' },
    null, 'texto suelto', { nombre: 'Sin id' }, { id: 'MAL/ID', nombre: 'X' },
    { id: 'terraza', nombre: 'Terraza', orden: 7 }
]);
chk('Las entradas corruptas se descartan', ctx.G().ids.indexOf('MAL/ID') === -1);
chk('Las buenas se conservan',             ctx.G().ids.indexOf('terraza') !== -1);

// ═══ 8 · selectedArea nunca queda huérfana ═══════════════════════════════
ctx = nuevoEntorno(true);
ctx.API.crearAreaConteo({ nombre: 'Barra Terraza' });
vm.runInContext("selectedArea = 'barra-terraza';", ctx);
ctx.API.eliminarAreaConteo('barra-terraza');
chk('Al eliminar el área seleccionada, se salta a otra',
    ctx.G().sel !== 'barra-terraza',
    'si no, el conteo se guardaría bajo una clave que ya no existe');

// ═══ 9 · Persistencia ════════════════════════════════════════════════════
ctx = nuevoEntorno(true);
ctx.API.crearAreaConteo({ nombre: 'Bodega Fría', icono: '❄️' });
const guardado = JSON.parse(ctx.localStorage.getItem('inventarioApp_areasConteo') || '[]');
chk('El alta se guarda en el dispositivo',
    guardado.some(function(a) { return a.id === 'bodega-fria'; }));
vm.runInContext("areasConteoDef = []; cargarAreasLocal();", ctx);
chk('Y se recupera al arrancar de nuevo', ctx.G().ids.indexOf('bodega-fria') !== -1);

// ═══ 10 · Enganchado a la app ════════════════════════════════════════════
const html   = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const sw     = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
const datos  = fs.readFileSync(path.join(RAIZ, 'js/45-inventario-datos.js'), 'utf8');
const fire   = fs.readFileSync(path.join(RAIZ, 'js/40-firestore.js'), 'utf8');
const roles  = fs.readFileSync(path.join(RAIZ, 'js/50-roles-permisos.js'), 'utf8');
const arran  = fs.readFileSync(path.join(RAIZ, 'js/99-window-arranque.js'), 'utf8');
const rend   = fs.readFileSync(path.join(RAIZ, 'js/70-conversion-render.js'), 'utf8');
const ciclo  = fs.readFileSync(path.join(RAIZ, 'js/90-ciclo-admin.js'), 'utf8');
const uiInv  = fs.readFileSync(path.join(RAIZ, 'js/85-ui-inventario-fisico.js'), 'utf8');

chk('index.html carga el módulo',   /src="js\/18-areas-config\.js\?v=/.test(html));
chk('Se carga antes de persistencia',
    html.indexOf('js/18-areas-config.js') < html.indexOf('js/20-persistencia.js'));
chk('El Service Worker lo cachea',  /18-areas-config\.js/.test(sw));
chk('Se carga la configuración al arrancar',
    /cargarAreasLocal\(\);\s*\n\s*initializeApp\(\)/.test(arran),
    'cargarla después dejaría el primer render con las tres por defecto');

chk('La definición viaja a la nube con lo del admin',
    /payload\.areasConteo = areasConteoDef/.test(fire),
    'sin esto el admin crea un área y los bartenders no la ven');
chk('Y se aplica al descargar',
    /aplicarDefinicionAreas\(data\.areasConteo\)/.test(datos));
chk('Se aplica ANTES del estado que la usa',
    datos.indexOf('aplicarDefinicionAreas(data.areasConteo)') <
    datos.indexOf('auditoriaStatus = data.auditoriaStatus'),
    'al revés, un área nueva aparecería sin estado');

chk('La pantalla de áreas está en Ajustes',
    /renderAreasConteoAdmin\(\)/.test(roles));

// Ya no quedan áreas escritas a mano en los sitios que las derivaban.
chk('Las rutas de Firestore ya no llevan las áreas fijas',
    !/doc\('barra1'\)/.test(datos) && !/doc\('barra2'\)/.test(datos),
    'una cuarta área no se leería de la nube');
chk('Los conteos se cargan recorriendo las áreas definidas',
    /AREAS_CONTEO\.map\(function\(a\) \{\s*\n?\s*return _cargarYAgeregarConteos\(a\);/.test(datos));
chk('Las etiquetas de la pestaña Inicio salen de la configuración',
    /CHIP_LABELS\s*=\s*areas;/.test(rend));
chk('El stock inicial al importar se construye por área',
    /stockByArea: _stockInicialPorArea\(stock\)/.test(ciclo));
chk('Y el del alta manual también',
    /stockByArea: _stockInicialPorArea\(0\)/.test(uiInv));
chk('El área por defecto es la primera definida, no "almacen" fijo',
    /AREAS_CONTEO\[0\] \|\| 'almacen'/.test(datos));

// ═══ 11 · Caché ══════════════════════════════════════════════════════════
const vTags = [...new Set([...html.matchAll(/<script\s+src="js\/[^"?]+\.js\?v=([^"]*)"/g)].map(m => m[1]))];
chk('R6 subió la versión de caché por encima de 3.1',
    vTags.length === 1 && parseFloat(vTags[0]) > 3.1,
    'versiones encontradas: ' + vTags.join(', '));

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── R6 · áreas de conteo configurables ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');

process.exit(fallos ? 1 : 0);
