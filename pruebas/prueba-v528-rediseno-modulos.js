#!/usr/bin/env node
/**
 * prueba-v528-rediseno-modulos.js — v5.28 · Rediseño de módulos
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedido de Eduardo (15-oct-2026) con sus decisiones:
 *   · INICIO: fuera "Origen del Total", "+ Producto", "Eliminar todos los
 *     productos" y "Reportes publicados".
 *   · PRODUCTOS: barra Agregar / Importar / Publicar / Eliminar. Publicar
 *     solo se resalta con cambios sin publicar (huella del catálogo).
 *   · PEDIDO SUGERIDO: pantalla propia, SIN filtro "Máximo stock".
 *   · INVENTARIO: áreas en una línea con íconos Ver / Habilitar.
 *   · GESTIÓN DE EQUIPO: rediseño de Usuarios y permisos, sin tocar permisos.
 *   · VENTAS: rediseño del módulo actual (sin React), KPIs sin tickets.
 *
 * Ejecuta el código REAL (js/15, js/73, js/93 y la huella de js/50) en un
 * contexto aislado, más comprobaciones estáticas del marcado y del CSS.
 *   node pruebas/prueba-v528-rediseno-modulos.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

function extraerFuncion(fuente, nombre) {
    const m = new RegExp('(async\\s+)?function ' + nombre + '\\(').exec(fuente);
    if (!m) throw new Error('No se encontró ' + nombre);
    let nivel = 0, dentro = false;
    for (let j = m.index; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(m.index, j + 1); }
    }
    throw new Error('No cerró ' + nombre);
}

const r70 = leer('js/70-conversion-render.js'), panel = leer('js/83-panel.js'), roles = leer('js/50-roles-permisos.js'),
      ps = leer('js/73-pedido-sugerido.js'), ven = leer('js/93-ventas.js'), ciclo = leer('js/15-ciclo-semanal.js'),
      ui85 = leer('js/85-ui-inventario-fisico.js'), busc = leer('js/80-buscador.js'), css = leer('css/utilidades.css'),
      idx = leer('index.html'), sw = leer('sw.js'), tablero = leer('js/72-inicio-tablero.js');

// ═══ 1 · INICIO ═════════════════════════════════════════════════════════════
const sinComent = t => t.replace(/^\s*\/\/.*$/gm, '');
const fnInicio = sinComent(extraerFuncion(r70, 'renderInicioTab'));
chk('Inicio: sin botón "+ Producto"', !/openProductModal\(\)/.test(fnInicio));
chk('Inicio: sin "Eliminar todos los productos"', !/deleteAllProducts\(\)/.test(fnInicio));
chk('Inicio: sin bloque "Reportes Publicados"', !/Reportes Publicados/i.test(fnInicio));
const fnPanel = sinComent(extraerFuncion(panel, 'renderPanelInicio'));
chk('Inicio: la tarjeta "Origen del Total" ya no se pinta', !/_panelExistenciaSemana\(\)/.test(fnPanel));
chk('Inicio: _panelExistenciaSemana se conserva (FASE 14/16 la prueban)', /function _panelExistenciaSemana\(/.test(panel));
chk('Inicio: la tarjeta de pedido sugerido abre la pantalla nueva', /abrirPedidoSugerido\(\)/.test(tablero));

// ═══ 2 · PRODUCTOS ══════════════════════════════════════════════════════════
const fnBarra = extraerFuncion(r70, '_productosBarraAcciones');
chk('Productos: barra con Agregar, Importar, Publicar y Eliminar en ese orden',
    /pa-btn--agregar[\s\S]*pa-btn--importar[\s\S]*pa-btn--publicar[\s\S]*pa-divisor[\s\S]*pa-eliminar/.test(fnBarra));
chk('Productos: Agregar → openProductModal(); Importar → módulo Importar (catálogo)',
    /openProductModal\(\)/.test(fnBarra) && /importarElegirArchivo\(\\?'catalogo\\?'\)/.test(fnBarra));
chk('Productos: Eliminar sigue usando deleteAllProducts() (que ya pide confirmación)', /deleteAllProducts\(\)/.test(fnBarra)
    && /confirm|Confirm|confirmar/.test(extraerFuncion(leer(fs.readdirSync(path.join(RAIZ, 'js')).map(f => 'js/' + f).find(f => /function deleteAllProducts\(/.test(leer(f)))), 'deleteAllProducts')));
chk('Productos: Eliminar tiene aria-label (es solo ícono)', /aria-label="Eliminar todos los productos"/.test(fnBarra));
chk('Productos: Publicar se resalta solo con cambios (pa-btn--pendiente condicionado)', /pendiente \?[\s\S]{0,80}pa-btn--pendiente/.test(fnBarra) || /if \(pendiente\)/.test(fnBarra) || /pendiente\s*\?\s*' pa-btn--pendiente'/.test(fnBarra));
chk('Productos: la barra solo la ve admin', /if \(admin\) html \+= _productosBarraAcciones\(\)/.test(r70));
chk('Productos: microcopy "N productos • M visibles"', /productos • /.test(extraerFuncion(r70, '_renderProductosResultados')) || /pa-micro/.test(extraerFuncion(r70, '_renderProductosResultados')));

// Huella del catálogo (código real de js/50)
{
    const ls = {};
    const ctx = { localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } }, products: [] };
    vm.createContext(ctx);
    vm.runInContext('var CATALOGO_HUELLA_LS = "inventarioApp_catalogPublicadoHuella";\n'
        + extraerFuncion(roles, 'catalogoHuella') + '\n' + extraerFuncion(roles, '_catalogoRecordarPublicado') + '\n'
        + extraerFuncion(roles, 'catalogoTieneCambiosSinPublicar'), ctx);
    ctx.products = [{ id: 'A1', name: 'Tequila', precio: 10, stock: 3, stockByArea: { barra: 3 } }, { id: 'B2', name: 'Ron', precio: 8 }];
    chk('Huella: sin huella guardada y con productos → "con cambios" (no se sabe qué hay publicado)', ctx.catalogoTieneCambiosSinPublicar() === true);
    ctx._catalogoRecordarPublicado(ctx.products);
    chk('Huella: recién publicado → sin cambios (Publicar en gris)', ctx.catalogoTieneCambiosSinPublicar() === false);
    ctx.products[0].stock = 99; ctx.products[0].stockByArea = { barra: 99 };
    chk('Huella: contar existencias NO cuenta como cambio del catálogo', ctx.catalogoTieneCambiosSinPublicar() === false);
    ctx.products[1].precio = 9;
    chk('Huella: cambiar un precio SÍ marca cambios sin publicar', ctx.catalogoTieneCambiosSinPublicar() === true);
    ctx.products[1].precio = 8;
    chk('Huella: el orden de los productos no altera la huella', ctx.catalogoHuella(ctx.products) === ctx.catalogoHuella(ctx.products.slice().reverse()));
    chk('Huella: publicar y recibir el catálogo la actualizan', (roles.match(/_catalogoRecordarPublicado\(/g) || []).length >= 4);
}

// ═══ 3 · PEDIDO SUGERIDO ════════════════════════════════════════════════════
chk('Pedido sugerido: js/73 cargado en index.html y precargado en sw.js',
    /js\/73-pedido-sugerido\.js\?v=/.test(idx) && /js\/73-pedido-sugerido\.js\?v=/.test(sw));
chk('Pedido sugerido: sin filtro "Máximo stock" (decisión de Eduardo)', !/Máximo stock/.test(extraerFuncion(ps, 'renderPedidoSugeridoTab')));
chk('Pedido sugerido: renderTab enruta la pestaña', /case 'pedido_sugerido':/.test(r70));
chk('Pedido sugerido: buscador registrado (nombre, código, proveedor)', /registrar\('pedsug'/.test(busc));
chk('Pedido sugerido: "Generar pedido" usa el carrito de siempre (addToCart + openOrderModal), no escribe por su cuenta',
    /addToCart\(/.test(extraerFuncion(ps, 'pedidoSugeridoGenerar')) && /openOrderModal\(/.test(extraerFuncion(ps, 'pedidoSugeridoGenerar'))
    && !/\.set\(|\.update\(|collection\(/.test(ps));
{
    const ctx = {
        pedidoSugeridoProducto: p => p._sug, existenciaMostrada: p => p._stock,
        _ps: { cantidades: {} }
    };
    vm.createContext(ctx);
    vm.runInContext(['_psRed', 'pedidoSugeridoFilas', 'pedidoSugeridoOrdenar', 'pedidoSugeridoResumen', '_psCantidad']
        .map(n => extraerFuncion(ps, n)).join('\n'), ctx);
    const lista = [
        { id: 'P1', name: 'Apio', group: 'Frutas', unit: 'KGS', stockMinimo: 5, _stock: 1, _sug: 4, precio: 20, proveedor: 'Central' },
        { id: 'P2', name: 'Blueberry', group: 'Frutas', unit: 'KGS', stockMinimo: 2, _stock: 3, _sug: 0, precio: 90, proveedor: 'Costco' },
        { id: 'P3', name: 'Cereza', group: 'Licores', unit: 'BOT', stockMinimo: 1, _stock: 0, _sug: 2, proveedor: '' },
        { id: 'P4', name: 'Sin mínimo', group: 'Frutas', unit: 'KGS', _stock: 0, _sug: 5 }
    ];
    const bajo = ctx.pedidoSugeridoFilas(lista, { soloBajo: true });
    chk('Filas: "Bajo stock" deja solo los que tienen sugerido > 0 y mínimo definido', bajo.map(f => f.id).join() === 'P1,P3');
    chk('Filas: sin "Bajo stock" salen todos los que tienen mínimo', ctx.pedidoSugeridoFilas(lista, {}).length === 3);
    chk('Filas: filtro por grupo', ctx.pedidoSugeridoFilas(lista, { grupo: 'Licores' }).map(f => f.id).join() === 'P3');
    const ord = ctx.pedidoSugeridoOrdenar(ctx.pedidoSugeridoFilas(lista, {}), 'proveedor', 1);
    chk('Orden: vacíos al final, sin importar la dirección', ord[ord.length - 1].id === 'P3'
        && ctx.pedidoSugeridoOrdenar(ctx.pedidoSugeridoFilas(lista, {}), 'proveedor', -1).slice(-1)[0].id === 'P3');
    chk('Orden: por sugerido descendente', ctx.pedidoSugeridoOrdenar(bajo, 'sugerido', -1)[0].id === 'P1');
    ctx._ps.cantidades = { P1: 6 };
    const r = ctx.pedidoSugeridoResumen(bajo, { P1: true, P3: true }, ctx._psCantidad);
    chk('Resumen: cuenta seleccionados, usa la cantidad editada (6 × $20 = $120) y avisa el que no tiene precio',
        r.productos === 2 && r.total === 120 && r.sinPrecio === 1, JSON.stringify(r));
    ctx._ps.cantidades = { P1: 0 };
    chk('Resumen: cantidad 0 no cuenta como producto pedido', ctx.pedidoSugeridoResumen(bajo, { P1: true }, ctx._psCantidad).productos === 0);
}

// ═══ 4 · INVENTARIO ═════════════════════════════════════════════════════════
// Decisión de Eduardo (16-oct-2026): el diseño de filas de una línea NO; se
// conserva el diseño de siempre (mismas tarjetas, botones y orden) y solo se
// compacta con CSS acotado a .if-pantalla--compacta.
const fnAud = extraerFuncion(ui85, 'renderAuditoriaSeleccion');
const fnCab = extraerFuncion(ui85, '_renderInventarioFisicoHeader');
chk('Inventario: pantalla compacta sobre el diseño de siempre (tarjetas de área, no filas)',
    /if-pantalla if-pantalla--compacta/.test(fnAud) && /audit-area-card/.test(fnAud) && /if-areas if-areas--compacto/.test(fnAud) && !/if-fila/.test(ui85));
chk('Inventario: mismas acciones (Reabrir, Cerrar área para todos, Ver, Habilitar) con su texto visible',
    /<\/i> Reabrir<\/button>/.test(fnAud) && /Cerrar área para todos<\/button>/.test(fnAud) && /<\/i> Ver<\/button>/.test(ui85) && /<\/i> Habilitar<\/button>/.test(ui85));
chk('Inventario: Reabrir sigue exigiendo inventory.reopenArea', /hasPermission\('inventory\.reopenArea'\)/.test(fnAud));
chk('Inventario: el estado se sigue leyendo completo ("INVENTARIO BARRA" queda para lectores de pantalla)',
    /if-badge-pre">INVENTARIO BARRA <\/span>SINCRONIZADO/.test(fnCab) && /if-badge-pre">INVENTARIO BARRA <\/span>CONTABILIZADO/.test(fnCab)
    && /\.if-pantalla--compacta \.if-badge-pre \{[^}]*clip: rect\(0 0 0 0\)/.test(css));
chk('Inventario: solo se oculta lo repetido (Áreas del encabezado y la etiqueta larga de la semana)',
    /\.if-pantalla--compacta \.if-dato--areas, \.if-pantalla\.if-pantalla--compacta \.if-dato__semana \{ display: none; \}/.test(css) && /'if-dato--areas'/.test(fnCab));
chk('★ Inventario: se respetan los pisos de FASE 10B (botones 48 px, tarjeta de área 72 px, texto de botón 14 px)',
    /bt-pila--rejilla \.bt \{ min-height: 48px;[^}]*font-size: \.875rem/.test(css) && /\.if-area \.bt \{ min-height: 48px;[^}]*font-size: \.875rem/.test(css)
    && /\.if-acc-usuario \.bt \{ min-height: 48px;[^}]*font-size: \.875rem/.test(css) && /\.bt-zona-peligro \.bt \{ min-height: 48px/.test(css)
    && /\.if-area \.audit-area-card \{ min-height: 72px/.test(css));
chk('Inventario: el compactado no toca Historial, Reconteo ni Físico vs Sistema (todo acotado)',
    css.slice(css.indexOf('Inventario compacto (v5.28'), css.indexOf('Gestión de equipo (v5.28)')).split('\n')
       .filter(l => /^[.@]/.test(l) && !/^\/\*/.test(l)).every(l => /\.if-pantalla\.if-pantalla--compacta/.test(l)));

// ═══ 5 · GESTIÓN DE EQUIPO ══════════════════════════════════════════════════
const fnEq = extraerFuncion(roles, 'renderUsuariosPermisosTab');
chk('Equipo: cabecera "Gestión de equipo" y buscador propio', /Gestión de equipo/.test(fnEq) && /registrar\('equipo'/.test(busc));
chk('Equipo: tarjeta de persona abre el editor de siempre (permSeleccionarUsuario)', /permSeleccionarUsuario/.test(extraerFuncion(roles, '_equipoTarjeta')));
chk('Equipo: el editor sigue guardando con las mismas funciones (sin cambios de lógica)', /hasPermission\('(users|permissions)\./.test(roles));

// ═══ 6 · VENTAS ═════════════════════════════════════════════════════════════
{
    const avisos = [];
    const ctx = {
        console: { warn: () => {}, error: () => {}, log: () => {} },
        window: {}, Date, Math, Number, String, JSON, Object, Array, isFinite, Promise,
        hasPermission: () => true, escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
        showNotification: m => avisos.push(m), saveToLocalStorage: () => {}, renderTab: () => { ctx._repintes++; }, _repintes: 0,
        BusquedaUI: { barra: () => '<div class="sbx"></div>', region: (k, h) => '<div id="sbx-res-' + k + '">' + h + '</div>', refrescar: () => {} },
        moduloCabecera: t => '<div class="mc-cab">' + t + '</div>',
        _db: null, activeTab: 'ventas', _syncEnabled: true,
        ventas: [], ventasPeriodos: [], ventasSemanaId: null, ventasImportView: 'lista', products: []
    };
    vm.createContext(ctx);
    vm.runInContext(ciclo, ctx);
    vm.runInContext(ven.replace(/^\s*(let|const) /gm, 'var '), ctx);
    ctx._renderConsumoTeorico = () => '<div id="consumo"></div>';
    ctx.renderCortesiasVenta = () => '<div id="cortesias"></div>';
    ctx.ventaCortesiasAnalizar = () => ({});

    const lineas = [
        { sku: '100', nombre: 'Margarita', tipo: 'Coctel', cantidad: 10, ventaNeta: 1200 },
        { sku: '200', nombre: 'Mezcal promo 2x1', tipo: 'Destilado', cantidad: 4, ventaNeta: 300, promo: 2 },
        { sku: '300', nombre: 'Agua', tipo: 'Sin alcohol', cantidad: 3, ventaNeta: 0 }
    ];
    const r = ctx.ventasResumen(lineas);
    chk('KPI Venta neta = suma de Venta neta', r.ventaNeta === 1500, JSON.stringify(r));
    chk('KPI Artículos vendidos incluye regalos (salieron de la barra)', r.articulos === 17 && r.regalos === 5);
    chk('KPI Precio promedio = venta neta ÷ artículos COBRADOS (1500 ÷ 12 = 125)', r.precioPromedio === 125);
    chk('KPI: sin Venta neta en el archivo no inventa precio promedio',
        ctx.ventasResumen([{ sku: '1', nombre: 'X', cantidad: 5 }]).precioPromedio === null);
    chk('KPI: lista vacía → ceros y sin promedio', (() => { const v = ctx.ventasResumen([]); return v.ventaNeta === 0 && v.articulos === 0 && v.precioPromedio === null; })());
    const top = ctx.ventasTopProductos(lineas);
    chk('Top productos ordenado por venta neta y sin mutar la lista', top.map(l => l.sku).join() === '100,200,300' && lineas[0].sku === '100');
    chk('Rango de mes correcto (feb bisiesto, dic)', JSON.stringify(ctx.ventasRangoMes('2028-02')) === '{"inicio":"2028-02-01","fin":"2028-02-29"}'
        && ctx.ventasRangoMes('2026-12').fin === '2026-12-31' && ctx.ventasRangoMes('2026-13') === null);
    chk('Etiqueta corta de la pill', ctx.ventasEtiquetaCorta('2026-10-12') === '12–18 oct 2026' && ctx.ventasEtiquetaCorta('2026-09-28') === '28 sep – 4 oct 2026');

    // Pantalla vacía
    ctx.ventasSemanaId = '2026-10-12';
    let html = ctx.renderVentasTab();
    chk('Vacío: "Sin ventas esta semana" + texto de siempre ("Todavía no hay ventas cargadas…")',
        /Sin ventas esta semana/.test(html) && /Todavía no hay ventas cargadas para la semana del 12 al 18 de octubre de 2026/.test(html));
    chk('Vacío: Importar Ventas visible con permiso y Exportar deshabilitado', /Importar Ventas/.test(html) && /onclick="ventasExportarExcel\(\)" disabled/.test(html));
    chk('Vacío: microcopy "0 productos • 0 artículos"', /0 productos • 0 artículos/.test(html));
    ctx.hasPermission = p => p === 'sales.read';
    html = ctx.renderVentasTab();
    chk('Sin sales.import: no hay botón Importar y el texto lo explica', !/Importar Ventas<\/button>/.test(html) && /El administrador todavía no las importa/.test(html));
    ctx.hasPermission = () => false;
    chk('Sin sales.read: no se muestra nada', /No tienes acceso a las ventas/.test(ctx.renderVentasTab()));
    ctx.hasPermission = () => true;

    // Semana activa con datos
    ctx.ventas = lineas; ctx.ventasPeriodos = [{ inicio: '2026-10-12', fin: '2026-10-14' }];
    html = ctx.renderVentasTab();
    chk('Con datos: 3 KPIs (Venta neta, Artículos vendidos, Precio promedio) y nada de "tickets"',
        /Venta neta/.test(html) && /Artículos vendidos/.test(html) && /Precio promedio/.test(html) && !/ticket promedio|Tickets/i.test(html.replace(/fa-ticket/g, '')));
    chk('Con datos: semana activa conserva consumo teórico y cortesías', /id="consumo"/.test(html) && /id="cortesias"/.test(html));
    chk('Con datos: días cargados 3 de 7 y aviso de consumo parcial', /3 de 7/.test(html) && /Faltan 4 día/.test(html));
    chk('Con datos: Exportar habilitado', /onclick="ventasExportarExcel\(\)">/.test(html));

    // ★ Navegar NO toca los globales de la semana activa (Total, consumo, sync)
    const antes = JSON.stringify([ctx.ventas, ctx.ventasPeriodos, ctx.ventasSemanaId]);
    ctx.ventasMoverPeriodo(-1);
    html = ctx.renderVentasTab();
    chk('★ Ver la semana anterior NO modifica ventas / ventasPeriodos / ventasSemanaId', JSON.stringify([ctx.ventas, ctx.ventasPeriodos, ctx.ventasSemanaId]) === antes);
    chk('Otra semana: aviso "Solo consulta" y sin consumo teórico', /Solo consulta/.test(html) && !/id="consumo"/.test(html));
    chk('Otra semana sin conexión: avisa en vez de mostrar datos falsos', /Sin conexión: solo se puede ver la semana activa/.test(html));
    ctx.ventasVerMes();
    html = ctx.renderVentasTab();
    chk('Mes: aviso de que suma los periodos que inician en él', /inician/.test(html) && JSON.stringify([ctx.ventas, ctx.ventasPeriodos, ctx.ventasSemanaId]) === antes);
    ctx.ventasVerSemanaActiva();
    chk('Volver a la semana activa vuelve a mostrar sus datos', /id="consumo"/.test(ctx.renderVentasTab()));
    const hoy = ctx.semanaId(new Date());
    ctx.ventasSemanaId = hoy;
    ctx.ventasMoverPeriodo(1);
    chk('No se puede avanzar más allá de la semana actual', ctx._vs.semana === null);

    // Lectura de otra semana con Firestore simulado
    const docs = { '2026-10-05_2026-10-11': { semanaId: '2026-10-05', fechaInicio: '2026-10-05', fechaFin: '2026-10-11', lineas: [{ sku: '100', nombre: 'Margarita', cantidad: 2, ventaNeta: 240 }] } };
    const consulta = (filtros) => ({
        where: (c, op, v) => consulta(filtros.concat([[c, op, v]])),
        get: async () => {
            const ids = Object.keys(docs).filter(id => filtros.every(f => f[1] === '==' ? docs[id][f[0]] === f[2] : (f[1] === '>=' ? docs[id][f[0]] >= f[2] : docs[id][f[0]] <= f[2])));
            return { forEach: fn => ids.forEach(id => fn({ id, data: () => docs[id] })) };
        }
    });
    ctx._db = {};
    ctx._docPrincipal = () => ({ collection: () => consulta([]) });
    ctx.ventasSemanaId = '2026-10-12';
    ctx._vs.semana = '2026-10-05'; ctx._vs.vista = 'semana'; ctx._vs.datos = {};
    html = ctx.renderVentasTab();
    chk('Otra semana: primero "Cargando ventas…"', /Cargando ventas/.test(html));
    setTimeout(() => {
        const h2 = ctx.renderVentasTab();
        chk('Otra semana: muestra lo leído de Firestore ($240) sin tocar la semana activa',
            /\$240/.test(h2) && JSON.stringify(ctx.ventas) === JSON.stringify(lineas) && ctx.ventasSemanaId === '2026-10-12');
        chk('Otra semana: se repinta al terminar de leer', ctx._repintes > 0);
        ctx.ventasVerMes();
        ctx.renderVentasTab();
        setTimeout(() => {
            const h3 = ctx.renderVentasTab();
            chk('Mes: consulta por fechaInicio dentro del mes (octubre 2026)', /\$240/.test(h3) && /Octubre 2026/.test(h3));
            terminar();
        }, 20);
    }, 20);
}

// ═══ 7 · CSS, ÍCONOS Y ACCESIBILIDAD ════════════════════════════════════════
const bloque528 = css.slice(css.indexOf('v5.28'));
chk('CSS v5.28: sin colores hex a mano (todo con tokens)', !/#[0-9a-fA-F]{3,8}\b/.test(bloque528.replace(/url\("data:image\/svg\+xml[^"]*"\)/g, '')));
['pa-barra', 'pa-eliminar', 'cat-prod__linea', 'mc-cab', 'mc-pill', 'ps-pie', 'ps-lista', 'if-card--avance', 'if-card--nota', 'bt-pila--rejilla', 'eq-card', 'vs-kpis', 'vs-kpi', 'vs-fila', 'vs-vacio', 'vs-flecha', 'vs-btn']
    .forEach(c => chk('CSS: .' + c + ' tiene estilo', new RegExp('\\.' + c + '[\\s,{.:]').test(css)));
chk('Ventas: flechas y botones de 44 px o más', /\.vs-flecha \{[^}]*width: 44px; height: 44px/.test(css) && /\.vs-btn \{[^}]*min-height: 48px/.test(css));
chk('Ventas: todos sus íconos están en el kit', (ven.slice(ven.indexOf('v5.28 — VENTAS SEMANALES')).match(/fa-[a-z-]+/g) || [])
    .filter(i => i !== 'fa-solid' && i !== 'fa-spin').every(i => new RegExp('\\.' + i + '\\s*[,{ ]').test(css)));
chk('Ventas: buscador registrado (nombre, SKU, tipo)', /registrar\('ventas'/.test(busc) && /_motorVentas/.test(busc));
// v5.29 — sin fijar el número exacto: basta con que sea 5.28 o posterior.
chk('Versión: index.html y sw.js en 5.28 o posterior', (() => { const m = /APP_VERSION\s*=\s*'5\.(\d+)'/.exec(sw); return !!m && Number(m[1]) >= 28; })() && !/\?v=5\.27/.test(idx));

function terminar() {
    console.log('\n  ── v5.28 · Rediseño de módulos ──\n');
    casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n + (c.ok || !c.d ? '' : '   ← ' + c.d)));
    console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
    process.exit(fallos ? 1 : 0);
}
