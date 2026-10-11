#!/usr/bin/env node
/**
 * prueba-paquete-textos-interfaz.js — v5.26 · paquete de textos e interfaz
 * (8 detalles menores, agrupados en un solo encargo)
 * ═══════════════════════════════════════════════════════════════════════════
 * Cubre, en un solo archivo, los 8 puntos de la lista "paquete de textos e
 * interfaz" del informe de hallazgos consolidados:
 *   1. Pedidos decía "Solo en este dispositivo" — es falso, sí se sincroniza.
 *   2. "Solo domingo o fin de mes" — no reflejaba que cualquier fecha ancla
 *      el Total (FASE 13/14), solo domingo/fin de mes CIERRAN la semana.
 *   3. El pie de login tenía "v2.4" fijo, desde hace versiones.
 *   4. Escape no cerraba recetaModal / nuevoInventarioModal / regFechaRecuentoModal.
 *   5. Discrepancia "Bajo mínimo" entre el tablero y el contador del catálogo
 *      — documentada como diseño deliberado (nivelAlertaProducto vs
 *      _bajoMinimo), no un bug: aquí solo se comprueba que quedó explicada.
 *   6/7. Pedidos (pestaña + tarjetas de resultado) y el modal "Generar Pedido"
 *      seguían en Tailwind fijo (bg-white, text-gray-*, gradientes morado/
 *      azul) en vez de los tokens de tema — no cambiaban con modo oscuro.
 *   8. El botón "Excel" (DESCARGAR MI CONTEO) del encabezado de Conteo se
 *      mostraba a CUALQUIER no-admin sin comprobar inventory.export — el
 *      Bartender por defecto no tiene ese permiso (sí el Subjefe de Barra).
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
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

const sinComentarios = function (s) { return s.replace(/\/\/[^\n]*/g, ''); };

const html        = leer('index.html');
const conversion   = leer('js/70-conversion-render.js');
const inventario   = leer('js/85-ui-inventario-fisico.js');
const inventDatos  = leer('js/45-inventario-datos.js');
const recetario    = leer('js/91-recetario.js');
const auditoriaFlujo = leer('js/75-auditoria-flujo.js');
const tablero      = leer('js/72-inicio-tablero.js');
const roles        = leer('js/50-roles-permisos.js');

// ── 1 · Pedidos: "Sincronizado", no "Solo en este dispositivo" ──────────────
const fnPedidosTab = extraerFuncion(conversion, 'renderPedidosTab');
chk('★ renderPedidosTab() ya no dice "Solo en este dispositivo" (orders SÍ se sincroniza vía ordersChunks)',
    !/Solo en este dispositivo/.test(fnPedidosTab));
chk('renderPedidosTab() dice "Sincronizado entre dispositivos"',
    /Sincronizado entre dispositivos/.test(fnPedidosTab));

// ── 2 · "Cualquier fecha ancla el Total", no "Solo domingo o fin de mes" ────
chk('★ Ya no queda "Solo domingo o fin de mes" en index.html (era falso: cualquier fecha ancla el Total)',
    !/Solo domingo o fin de mes/.test(html));
const apariciones2 = (html.match(/cierran la semana/g) || []).length;
chk('Los dos avisos (nuevo inventario y registrar fecha de recuento) explican la regla real',
    apariciones2 >= 2);

// ── 3 · Pie de login: versión real, no "v2.4" fijo ──────────────────────────
chk('★ El pie de login ya no lleva un número de versión fijo en el HTML (lo llena versionPagina())',
    /id="loginVersion"[^>]*>BarInventory · Instituto ULinks</.test(html));
chk('Un DOMContentLoaded llena #loginVersion con versionPagina() (misma fuente que el pie de "Más")',
    /loginVersion[\s\S]{0,200}versionPagina\(\)/.test(html));

// ── 4 · Escape cierra recetaModal / nuevoInventarioModal / regFechaRecuentoModal ──
chk('★ Escape cierra recetaModal (mismo patrón que la ficha de producto y el detalle de compra)',
    /document\.addEventListener\('keydown'[\s\S]{0,300}recetaModal[\s\S]{0,200}closeRecetaModal\(\)/.test(recetario));
chk('★ Escape cierra regFechaRecuentoModal / nuevoInventarioModal, comprobando primero el más específico (mFecha antes que mNuevo)',
    /document\.addEventListener\('keydown'[\s\S]{0,900}if \(mFecha[\s\S]{0,150}cerrarModalRegistrarFechaRecuento\(\)[\s\S]{0,50}\} else if \(mNuevo[\s\S]{0,150}cerrarModalNuevoInventario\(\)/.test(auditoriaFlujo));
chk('Los dos listeners nuevos se guardan con typeof document !== \'undefined\' — varias pruebas cargan estos archivos sin DOM',
    /typeof document !== 'undefined' && document\.addEventListener[\s\S]{0,200}recetaModal/.test(recetario) &&
    /typeof document !== 'undefined' && document\.addEventListener[\s\S]{0,300}regFechaRecuentoModal/.test(auditoriaFlujo));

// ── 5 · Discrepancia "Bajo mínimo" documentada (por diseño, no bug) ─────────
chk('★ js/72-inicio-tablero.js explica por qué el tablero y el contador del catálogo difieren a propósito',
    /nivelAlertaProducto[\s\S]{0,400}_bajoMinimo/.test(tablero) || /_bajoMinimo[\s\S]{0,400}nivelAlertaProducto/.test(tablero));

// ── 6/7 · Pedidos y "Generar Pedido" con tokens de tema, no Tailwind fijo ───
const fnPedidosResultados = extraerFuncion(conversion, '_renderPedidosResultados');
const TAILWIND_FIJO = /(bg-white\b|text-gray-\d|bg-gray-\d|from-purple|from-red-500|to-orange-600|from-green-500|to-emerald-500|bg-purple-50|divide-gray)/;
chk('★ renderPedidosTab() sin clases Tailwind fijas de color',
    !TAILWIND_FIJO.test(sinComentarios(fnPedidosTab)));
chk('★ _renderPedidosResultados() (tarjetas de pedido) sin clases Tailwind fijas de color',
    !TAILWIND_FIJO.test(sinComentarios(fnPedidosResultados)));
chk('El botón "Eliminar todos los pedidos" usa .bt--peligro (theme-aware), no color:#fff a mano',
    /class="bt bt--peligro"/.test(fnPedidosTab) && !/color:#fff/.test(fnPedidosTab));
chk('Los botones de la tarjeta de pedido llevan aria-label (compartir y eliminar)',
    /aria-label="Compartir pedido/.test(fnPedidosResultados) && /aria-label="Eliminar pedido/.test(fnPedidosResultados));

(function () {
    const i = html.indexOf('id="orderModal"');
    if (i < 0) throw new Error('No se encontró #orderModal en index.html');
    const start = html.lastIndexOf('<div', i);
    let depth = 0, k = start, n = html.length;
    while (k < n) {
        if (html.slice(k, k + 4) === '<div') { depth++; k += 4; continue; }
        if (html.slice(k, k + 6) === '</div>') { depth--; k += 6; if (depth === 0) break; continue; }
        k++;
    }
    const bloqueModal = html.slice(start, k);
    chk('★ #orderModal ("Generar Pedido") ya no tiene clases Tailwind fijas de color',
        !TAILWIND_FIJO.test(bloqueModal));
    chk('#orderModal usa var(--modal-bg)/var(--shadow-modal) para la caja del modal',
        /var\(--modal-bg\)/.test(bloqueModal) && /var\(--shadow-modal\)/.test(bloqueModal));
})();

const fnActualizarCantidad = (function () {
    try { return extraerFuncion(inventario, 'renderOrderTable'); } catch (e) { return ''; }
})();
chk('Las filas del carrito llevan aria-label en cantidad y en "quitar"',
    /aria-label="Cantidad de /.test(fnActualizarCantidad) && /aria-label="Quitar /.test(fnActualizarCantidad));

// ── 8 · "DESCARGAR MI CONTEO" exige inventory.export (el Bartender no lo tiene) ──
chk('★ ROLES_SISTEMA_DEFECTO.BARTENDER NO incluye inventory.export (control: SUBJEFE_BARRA sí)',
    /BARTENDER:\s*\{[\s\S]{0,300}permissions:\s*\[([^\]]*)\]/.exec(roles) &&
    !/BARTENDER:\s*\{[\s\S]{0,300}permissions:\s*\[[^\]]*inventory\.export/.test(roles) &&
    /SUBJEFE_BARRA:\s*\{[\s\S]{0,300}permissions:\s*\[[^\]]*inventory\.export/.test(roles));

const fnAuditoriaSeleccion = extraerFuncion(inventario, 'renderAuditoriaSeleccion');
chk('★ El botón "DESCARGAR MI CONTEO" solo se agrega al html si hasPermission(\'inventory.export\') — antes no comprobaba nada',
    /\} else if \(hasPermission\('inventory\.export'\)\) \{[\s\S]{0,700}exportarExcelMiConteo\(\)/.test(fnAuditoriaSeleccion));

const fnExportarMiConteo = extraerFuncion(inventDatos, 'exportarExcelMiConteo');
chk('★ exportarExcelMiConteo() también comprueba el permiso por su cuenta (defensa en profundidad, igual que exportToExcel/exportarInventarioCerrado)',
    /if \(!hasPermission\('inventory\.export'\)\) \{/.test(fnExportarMiConteo));
chk('El botón de admin (EXPORTAR INVENTARIO TOTAL) sigue intacto — el fix no le agregó una comprobación redundante',
    /isAdmin\(\)\) \{[\s\S]{0,200}exportarExcelAdminTotal\(\)/.test(fnAuditoriaSeleccion));

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Paquete de textos e interfaz (8 detalles menores, v5.26) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
