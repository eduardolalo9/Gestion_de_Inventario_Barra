#!/usr/bin/env node
/**
 * prueba-inicio-conteo.js — v5.23 · Diseño de Inicio y Conteo
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedido de Eduardo (9-oct-2026): aplicar el diseño de Inicio y Conteo SIN
 * tocar la barra inferior ni la lógica de negocio. Esta prueba comprueba:
 *   · que el módulo nuevo está cargado, precalentado y es solo presentación
 *     (no escribe en Firestore, no guarda, no usa colores a mano);
 *   · que la lógica crítica NO cambió (convertirOzAPuntos, validaciones de
 *     saveInventarioModal, barra inferior de 5 destinos);
 *   · los datos del tablero con el módulo REAL contra un estado simulado.
 *   node pruebas/prueba-inicio-conteo.js
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');
const casos = []; let fallos = 0;
function chk(n, ok, d) { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; }

const mod = leer('js/72-inicio-tablero.js'), r70 = leer('js/70-conversion-render.js'), r85 = leer('js/85-ui-inventario-fisico.js'),
      r83 = leer('js/83-panel.js'), html = leer('index.html'), sw = leer('sw.js'), css = leer('css/estilos.css'), util = leer('css/utilidades.css');

// ── A · cableado ─────────────────────────────────────────────────────────
chk('index.html carga 72-inicio-tablero.js entre 71 y 75',
    html.indexOf('js/71-posicion-conteo.js') < html.indexOf('js/72-inicio-tablero.js') && html.indexOf('js/72-inicio-tablero.js') < html.indexOf('js/75-auditoria-flujo.js'));
chk('sw.js precalienta el módulo con APP_VERSION', /'\.\/js\/72-inicio-tablero\.js\?v=' \+ APP_VERSION/.test(sw));
chk('★ La versión es 5.23 en sw.js y en todos los ?v= de index.html',
    /APP_VERSION = '5\.23'/.test(sw) && !/\?v=5\.22/.test(html) && (html.match(/\?v=5\.23/g) || []).length >= 35);
chk('renderInicioTab pinta el tablero primero y el panel de siempre debajo',
    /renderInicioTablero\(\)/.test(r70) && /renderPanelInicio\(\{ sinInventario:/.test(r70));
chk('El panel omite SU tarjeta de inventario solo cuando el tablero la muestra',
    /function renderPanelInicio\(opciones\)/.test(r83) && /if \(!\(opciones && opciones\.sinInventario\)\) h \+= _panelEstadoInventario\(\);/.test(r83));

// ── B · es solo presentación ─────────────────────────────────────────────
chk('★ El tablero NO escribe en Firestore ni en el almacenamiento',
    !/\.(set|update|add|delete)\(|localStorage|saveToLocalStorage|_db\b|runTransaction|batch\(/.test(mod));
chk('El tablero no usa colores a mano ni emoji', !/#[0-9a-fA-F]{3,8}\b/.test(mod) && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(mod));
chk('El tablero usa solo iconos del kit (fa-solid fa-…)',
    (mod.match(/fa-[a-z-]+/g) || []).filter(x => x !== 'fa-solid').every(x => ['fa-chevron-right', 'fa-boxes-stacked', 'fa-box', 'fa-clipboard-list', 'fa-file-chart-column', 'fa-book', 'fa-receipt'].includes(x)),
    [...new Set(mod.match(/fa-[a-z-]+/g))].join(' '));
const bloque = css.slice(css.indexOf('v5.23 · Diseño'));
chk('★ El CSS de v5.23 usa solo tokens (cero colores hex)', !/#[0-9a-fA-F]{3,8}\b/.test(bloque) && !/rgba?\(/.test(bloque));
chk('★ Objetivos táctiles de v5.23 >= 44 px (botón 48, enlace 44, cerrar 44, módulo 96, paso 52)',
    /\.it-btn \{[^}]*min-height: 48px/.test(bloque) && /\.it-enlace \{[^}]*min-height: 44px/.test(bloque) &&
    /\.inv-modal__cerrar \{[^}]*width: 44px; height: 44px/.test(bloque) && /\.it-modulo \{[^}]*min-height: 96px/.test(bloque) &&
    /\.inv-paso__btn \{[^}]*min-height: 52px/.test(bloque) && /\.audit-count-header \.audit-back-btn \{ min-height: 44px/.test(bloque));
chk('El kit de iconos tiene la máscara fa-minus', /^\.fa-minus\b/m.test(util));

// ── C · la lógica crítica NO cambió ──────────────────────────────────────
const i0 = r70.indexOf('function convertirOzAPuntos('), j0 = r70.indexOf('\n        }\n', i0) + 11;
chk('★ convertirOzAPuntos es EXACTAMENTE la de antes (huella)',
    crypto.createHash('sha256').update(r70.slice(i0, j0)).digest('hex') === 'ea612559574f4715c708bbfb9fa524fba50e562641425208c1e125bbeb226534');
const guardar = r70.slice(r70.indexOf('function saveInventarioModal()'), r70.indexOf('// Toggle expansión de tarjeta'));
[['las enteras deben ser número entero', /Number\.isInteger\(enterasRaw\)/], ['tope 9999', /enterasRaw > 9999/], ['sin notación científica', /\/e\/i\.test\(raw\)/],
 ['detección de cambio anómalo', /checkAnomaly/], ['candado de ciclo cerrado', /isCicloBloqueado\(\)/],
 ['conteo propio por usuario', /myAuditoriaConteo\[inventarioModalProductId\]\[auditoriaAreaActiva\] = \{ enteras, abiertas, _ts: Date\.now\(\) \}/],
 ['sync atómico por producto', /syncConteoProductoAtomico\(pid, area, ent, abi\)/]].forEach(function (p) {
    chk('★ saveInventarioModal conserva: ' + p[0], p[1].test(guardar));
});
chk('★ "Guardar y siguiente" fija el siguiente ANTES de validar/guardar y lo abre DESPUÉS de cerrar',
    /const _sigId = _guardarYSiguiente \? _siguienteProductoConteo\(inventarioModalProductId\) : null;/.test(guardar) &&
    /_guardarYSiguiente = false;\n\s+closeInventarioModal\(\);\n\s+renderTab\(\);\n\s+if \(_sigId\) openInventarioModal\(_sigId\);/.test(guardar));
chk('Cerrar o abrir el modal apaga la bandera (la X nunca salta al siguiente)',
    /_reconteoEdicion = null;\n\s+_guardarYSiguiente = false;/.test(r70) && /_guardarYSiguiente = false;\n/.test(r70.slice(r70.indexOf('function openInventarioModal'), r70.indexOf('function renderAbiertaInput'))));
chk('El Reconteo no salta al siguiente (usa su propio flujo)', /!isAuditoriaMode[^;]*\) return null;/.test(r70) && /_reconteoEdicion \|\| !isAuditoriaMode/.test(r70));
chk('★ La barra inferior sigue con sus 5 destinos: Inicio, Conteo, Pedidos, Compras, Más',
    ['inicio', 'inventario', 'pedidos', 'compras'].every(t => new RegExp('data-btab="' + t + '"').test(html)) && (html.match(/class="btab-item/g) || []).length === 5);
chk('Todo id del modal que lee saveInventarioModal sigue en index.html',
    ['inv_enteras', 'inv_abiertasContainer', 'inv_cantidadTotal', 'inv_bloqueBotella', 'inv_bloqueCantidad'].every(id => html.indexOf('id="' + id + '"') !== -1));
chk('Conteo: el encabezado conserva volver, área y contador (y suma medidor y "Conteo ciego")',
    /auditoriaVolverSeleccion\(\)/.test(r85) && /Conteo ciego/.test(r85) && /Capturados/.test(r85) && /inicioMedidor\(ingresados, products\.length\)/.test(r85));
chk('La tarjeta de conteo conserva su criterio hasData y suma Capturado/Pendiente', /hasData \? 'Capturado' : 'Pendiente'/.test(r85));

// ── D · el módulo REAL contra un estado simulado ─────────────────────────
const ctx = { console, escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), window: {} };
ctx.products = [
    { id: 'A', name: 'A', proveedor: 'P1' }, { id: 'B', name: 'B', proveedor: 'P2' }, { id: 'C', name: 'C' }, { id: 'D', name: 'D' }];
ctx.orders = [1, 2];
ctx._inventarioActivo = { numero: 1001, estado: 'SINCRONIZADO' };
ctx.allUsersAuditoria = { u1: { conteo: { A: {}, B: {} } }, u2: { conteo: { B: {}, C: {} } } };
ctx.AREAS_CONTEO = ['almacen', 'barra2']; ctx.areasAuditoria = { almacen: 'Almacén', barra2: 'Barra Bar' };
ctx.auditoriaConteo = { A: { almacen: { enteras: 2, abiertas: [] }, barra2: { enteras: 0, abiertas: [0.5] } }, B: { almacen: { enteras: 0, abiertas: [0] } } };
ctx.myAuditoriaConteo = {}; ctx.auditoriaStatus = { almacen: 'completada' }; ctx.myAuditoriaStatus = {};
ctx.puedeVerConteosAjenos = () => true; ctx.isAdmin = () => true; ctx.hasPermission = () => true;
ctx.nivelAlertaProducto = p => ({ A: 'limitado', B: 'advertencia', C: 'bajo', D: null })[p.id];
ctx.pedidoSugeridoProducto = p => ({ A: 3, B: 1, C: 0, D: null })[p.id];
ctx._auth = { currentUser: { displayName: 'Eduardo Pérez' } };
ctx.auditCurrentUser = { userName: 'Contador-BM1G' };
ctx.UI = { badge: k => '[badge ' + k + ']' };
ctx.inventarioAbierto = inv => inv.estado === 'SINCRONIZADO';
vm.createContext(ctx);
vm.runInContext(mod, ctx);
const d = ctx.inicioTableroDatos();
chk('★ Contados = unión entre personas (A, B, C = 3 de 4), no suma', d.contados === 3 && d.total === 4, JSON.stringify([d.contados, d.total]));
chk('★ Áreas: cuenta productos con cantidad y el estado (completada / en conteo / pendiente)',
    d.areas.length === 2 && d.areas[0].contados === 1 && d.areas[0].estado === 'completada' && d.areas[1].contados === 1 && d.areas[1].estado === 'en_conteo', JSON.stringify(d.areas));
chk('★ Una abierta en 0 NO cuenta como capturada', ctx.inicioTableroDatos().areas[0].contados === 1);
chk('★ Alertas: una por nivel, sin doble conteo', d.alertas.limitado === 1 && d.alertas.advertencia === 1 && d.alertas.bajo === 1, JSON.stringify(d.alertas));
chk('★ Pedido sugerido: solo productos con cantidad > 0 y proveedores distintos', d.pedido.productos === 2 && d.pedido.proveedores === 2, JSON.stringify(d.pedido));
const h = ctx.renderInicioTablero();
chk('El saludo usa el nombre de la cuenta (no el apodo "Contador-XXXX")', /Hola, Eduardo</.test(h) && !/Contador-BM1G/.test(h));
chk('Sin nombre en la cuenta, saluda sin inventar uno', (ctx._auth = { currentUser: { email: 'x@y.z' } }, /Hola</.test(ctx.renderInicioTablero()) && !/Hola, /.test(ctx.renderInicioTablero())));
chk('★ La tarjeta trae cifra, medidor de 12 tramos, áreas y el botón "Continuar conteo"',
    /class="num it-inv__grande">3</.test(h) && (h.match(/it-medidor__seg"/g) || []).length + (h.match(/it-medidor__seg it-medidor__seg--on"/g) || []).length === 12 &&
    /Almacén/.test(h) && /Completada/.test(h) && /En conteo/.test(h) && /Continuar conteo/.test(h));
chk('El pedido sugerido muestra "2 productos por reponer · 2 proveedores"', /2 productos por reponer · 2 proveedores/.test(h));
ctx.pedidoSugeridoProducto = () => 0;
chk('Sin nada que pedir, la tarjeta de pedido sugerido no aparece', !/Pedido sugerido listo/.test(ctx.renderInicioTablero()));
ctx.hasPermission = () => false;
chk('"Físico vs Sistema" solo aparece con el permiso inventory.viewAll', !/Físico vs Sistema/.test(ctx.renderInicioTablero()) && /Físico vs Sistema/.test(h));
ctx._inventarioActivo = null;
chk('Sin inventario abierto lo dice y ofrece ir a Conteo', /Sin inventario físico abierto/.test(ctx.renderInicioTablero()));
chk('★ Medidor: 0 contados = 0 tramos; 1 contado = al menos 1; todos = 12',
    ctx.inicioSegmentosLlenos(0, 431) === 0 && ctx.inicioSegmentosLlenos(1, 431) === 1 && ctx.inicioSegmentosLlenos(431, 431) === 12 && ctx.inicioSegmentosLlenos(412, 431) === 11 && ctx.inicioSegmentosLlenos(5, 0) === 0);
chk('El medidor nunca pasa de 12 aunque contados > total', ctx.inicioSegmentosLlenos(500, 431) === 12);

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Diseño de Inicio y Conteo (v5.23, estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
