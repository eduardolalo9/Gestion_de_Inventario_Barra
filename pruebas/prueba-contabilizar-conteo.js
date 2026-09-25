#!/usr/bin/env node
/**
 * prueba-contabilizar-conteo.js — Contabilizar dentro de Conteo
 * ═══════════════════════════════════════════════════════════════════════════
 * Dos cosas, y la segunda es la que importa:
 *
 *   1. El botón "Contabilizar" vive en el encabezado de Conteo, no tres
 *      pantallas más adentro, y la regla de si se puede es UNA sola.
 *
 *   2. Un inventario CONTABILIZADO ya no se toma por abierto. Antes, toda la
 *      app preguntaba "¿está CERRADO?"; como CONTABILIZADO no es CERRADO, un
 *      inventario contabilizado aparecía como SINCRONIZADO, dejaba entrar a
 *      contar y BLOQUEABA crear el de la semana siguiente.
 *
 * Se ejecuta el código real (inventarioAbierto, evaluarContabilizable y el
 * ciclo semanal), no copias de las reglas. No necesita emulador ni red.
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
    casos.push({ nombre, ok: !!ok, detalle: detalle || '' });
    if (!ok) fallos++;
}
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

const multi   = leer('js/10-multiusuario.js');
const ciclo   = leer('js/15-ciclo-semanal.js');
const flujo   = leer('js/75-auditoria-flujo.js');
const ui      = leer('js/85-ui-inventario-fisico.js');
const existe  = leer('js/47-existencia.js');
const panel   = leer('js/83-panel.js');
const areas   = leer('js/18-areas-config.js');

// Extrae una función completa contando llaves (las firmas pueden ser async).
function extraer(fuente, nombre) {
    const m = new RegExp('(async\\s+)?function ' + nombre + '\\s*\\(').exec(fuente);
    if (!m) return null;
    let nivel = 0, dentro = false;
    for (let j = m.index; j < fuente.length; j++) {
        if (fuente[j] === '{') { nivel++; dentro = true; }
        else if (fuente[j] === '}') { nivel--; if (dentro && nivel === 0) return fuente.slice(m.index, j + 1); }
    }
    return null;
}

// ═══ 1 · inventarioAbierto — el estado en el que se cuenta ═════════════════
const srcAbierto = extraer(multi, 'inventarioAbierto');
const evalc      = extraer(flujo, 'evaluarContabilizable');
chk('Existen inventarioAbierto() y evaluarContabilizable()', !!srcAbierto && !!evalc);

const ctx = vm.createContext({ console: { warn() {}, info() {} } });
try {
    // El ciclo semanal real: clasificarRecuento, semanaSiguiente, etiquetaSemana…
    vm.runInContext(ciclo + '\n' + srcAbierto + '\n' + evalc +
        '\nglobalThis.API = { inventarioAbierto, evaluarContabilizable, semanaSiguiente };', ctx);
    chk('Las reglas se ejecutan aisladas con el ciclo semanal real', true);
} catch (e) {
    chk('Las reglas se ejecutan aisladas con el ciclo semanal real', false, String(e));
}
const A = ctx.API;

if (A) {
    chk('SINCRONIZADO es el único estado abierto', A.inventarioAbierto({ estado: 'SINCRONIZADO' }) === true);
    chk('CERRADO es solo lectura',                  A.inventarioAbierto({ estado: 'CERRADO' }) === false);
    chk('★ CONTABILIZADO es solo lectura (antes se tomaba por abierto)',
        A.inventarioAbierto({ estado: 'CONTABILIZADO' }) === false);
    chk('Un estado desconocido falla cerrando, no abriendo',
        A.inventarioAbierto({ estado: 'OTRO' }) === false && A.inventarioAbierto({}) === false);
    chk('Sin inventario no hay nada abierto', A.inventarioAbierto(null) === false);

    // ═══ 2 · evaluarContabilizable — una sola regla ═══════════════════════
    // 2026-09-20 fue domingo; 2026-09-23, miércoles.
    const DOM = '2026-09-20', MIE = '2026-09-23';
    const ok = A.evaluarContabilizable({ estado: 'CERRADO', semanaId: '2026-09-14', fechaRecuento: DOM });
    chk('★ Un cierre en domingo se puede contabilizar',
        ok.puede === true, JSON.stringify(ok));
    chk('…y su destino es la semana siguiente (lunes 21)',
        ok.semanaDestino === '2026-09-21', String(ok.semanaDestino));

    const mie = A.evaluarContabilizable({ estado: 'CERRADO', semanaId: '2026-09-21', fechaRecuento: MIE });
    chk('★ Un corte a media semana no se contabiliza, y dice por qué',
        mie.puede === false && /DOMINGO/.test(mie.motivo) && /2026-09-23/.test(mie.motivo), JSON.stringify(mie));

    const sinSem = A.evaluarContabilizable({ estado: 'CERRADO', fechaRecuento: DOM });
    chk('Sin semana en la cabecera no se inventa una',
        sinSem.puede === false && /cabecera/.test(sinSem.motivo), JSON.stringify(sinSem));

    const abierto = A.evaluarContabilizable({ estado: 'SINCRONIZADO', semanaId: '2026-09-14', fechaRecuento: DOM });
    chk('Un inventario abierto no se contabiliza: primero se cierra',
        abierto.puede === false && /cerrar/.test(abierto.motivo), JSON.stringify(abierto));

    const hecho = A.evaluarContabilizable({ estado: 'CONTABILIZADO', semanaDestino: '2026-09-21' });
    chk('Uno ya contabilizado se reconoce como hecho, con su semana',
        hecho.puede === false && hecho.hecho === true && hecho.semanaDestino === '2026-09-21', JSON.stringify(hecho));
}

// ═══ 3 · Nadie más pregunta "¿está CERRADO?" para decidir si se cuenta ═════
// La única comprobación literal que puede quedar es la de la propia
// contabilización (solo se contabiliza desde CERRADO), que es correcta.
const js = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js'));
const sobrantes = [];
js.forEach(function(f) {
    const src = leer('js/' + f);
    const permitidos = [extraer(src, 'contabilizarInventario'), extraer(src, 'evaluarContabilizable')].filter(Boolean);
    let limpio = src;
    permitidos.forEach(function(b) { limpio = limpio.replace(b, ''); });
    const m = limpio.match(/_inventarioActivo\.estado\s*[!=]==\s*'CERRADO'|inv\.estado\s*[!=]==\s*'CERRADO'/g);
    if (m) sobrantes.push(f + ' (' + m.length + ')');
});
chk('★ Ninguna decisión de "¿se puede contar?" depende ya de === \'CERRADO\'',
    sobrantes.length === 0, sobrantes.join(', '));

const fin = extraer(flujo, 'auditoriaFinalizarConteo') || '';
chk('Finalizar un área se bloquea con cualquier estado no abierto',
    /!inventarioAbierto\(_inventarioActivo\)/.test(fin));
chk('Entrar a contar se bloquea con cualquier estado no abierto',
    /!inventarioAbierto\(_inventarioActivo\)/.test(extraer(flujo, 'auditoriaEntrarArea') || ''));
chk('Cerrar solo se ofrece sobre un inventario abierto',
    /if \(!inventarioAbierto\(_inventarioActivo\)\)/.test(extraer(flujo, 'cerrarInventarioFisico') || ''));
chk('★ Crear el siguiente ya no se bloquea tras contabilizar',
    /if \(inventarioAbierto\(_inventarioActivo\)\)/.test(extraer(flujo, 'abrirModalNuevoInventario') || '') &&
    /if \(inventarioAbierto\(_inventarioActivo\)\)/.test(extraer(flujo, 'auditoriaResetear') || ''));
chk('Las áreas se pueden editar con el inventario contabilizado',
    /inventarioAbierto\(_inventarioActivo\)/.test(areas));

// ═══ 4 · El botón, dentro de Conteo ════════════════════════════════════════
const cab   = extraer(ui, '_renderInventarioFisicoHeader') || '';
const paso  = extraer(ui, '_renderSiguientePasoInventario') || '';
chk('★ El encabezado de Conteo dibuja el siguiente paso del inventario',
    /_renderSiguientePasoInventario\(inv\)/.test(cab));
chk('★ El siguiente paso ofrece "Contabilizar" con el permiso inventory.post',
    /hasPermission\('inventory\.post'\)/.test(paso) && /data-inv-accion="contabilizar"/.test(paso));
chk('Decide con la regla compartida, no con una copia',
    /evaluarContabilizable\(inv\)/.test(paso));
chk('Cuando no se puede, dice por qué (mismo texto que el Historial)',
    /No se puede contabilizar\. ' \+ escapeHtml\(ev\.motivo\)/.test(paso));
chk('Avisa de que es irreversible antes del clic',
    /irreversible/.test(paso));
chk('★ Tras cerrar o contabilizar, ofrece crear el siguiente inventario',
    /abrirModalNuevoInventario\(\)/.test(paso) && /inventory\.create/.test(paso));
chk('El detalle del Historial usa la misma regla',
    /evaluarContabilizable\(meta\)/.test(ui));
chk('Seguridad: la acción es delegada y toma el id del inventario escuchado',
    /closest\('\[data-inv-accion="contabilizar"\]'\)/.test(ui) &&
    /contabilizarInventario\(_inventarioActivoId, _inventarioActivo\.numero\)/.test(ui) &&
    !/onclick="contabilizarInventario/.test(paso));
chk('Evita el doble toque, pero deja reintentar si se cancela',
    /b\.disabled = true;/.test(ui) && /setTimeout\(function\(\) \{ b\.disabled = false; \}/.test(ui));
chk('El encabezado distingue CONTABILIZADO de SINCRONIZADO',
    /INVENTARIO BARRA CONTABILIZADO/.test(cab) && /const esCerrado = !inventarioAbierto\(inv\);/.test(cab));

// ═══ 5 · Coherencia con el resto ═══════════════════════════════════════════
const contab = extraer(flujo, 'contabilizarInventario') || '';
chk('★ Al contabilizar se olvida el inicial en memoria (el panel lo relee)',
    /existenciaInvalidarInicial\(\)/.test(contab) && /function existenciaInvalidarInicial\(\)/.test(existe));
chk('Crear el siguiente sin contabilizar pregunta antes, no bloquea',
    /todavía NO está contabilizado/.test(extraer(flujo, 'abrirModalNuevoInventario') || '') &&
    /_saltarAvisoContabilizar = false;/.test(flujo));
chk('El panel de Inicio ya no manda al Historial para contabilizar',
    !/Conteo → Historial → inventario cerrado → Contabilizar/.test(panel));

// ═══ 6 · El inventario activo sobrevive a reabrir la app (4.8) ═════════════
// Visto en producción con la 4.7: sesión con las tres áreas contadas y Conteo
// ofreciendo "Crear Inventario Físico". La prueba de integración
// prueba-sesion-integracion.js lo reproduce contra Firestore real; aquí se
// vigila que las piezas sigan en su sitio.
const datos = leer('js/45-inventario-datos.js');
const hasc  = extraer(datos, 'handleAuditSessionChange') || '';
const sinCambio = (hasc.match(/if \(nuevoSessionId === _auditoriaSessionId\) \{[\s\S]*?return \{ procesado: false, motivo: 'sin_cambio' \};/) || [''])[0];
chk('★ Con la misma sesión (app reabierta) se engancha igualmente el inventario',
    /_suscribirInventarioActivo\(nuevoSessionId\);/.test(sinCambio));
chk('La suscripción distingue "cargando" de "no existe"',
    /_inventarioActivoCarga = 'cargando';/.test(datos) &&
    /_inventarioActivoCarga = snap\.exists \? 'ok' : 'no_existe';/.test(datos));
const reset = extraer(flujo, 'auditoriaResetear') || '';
chk('★ Crear un inventario pregunta al SERVIDOR si hay uno abierto antes de borrar',
    /await _inventarioAbiertoEnServidor\(\)/.test(reset) &&
    reset.indexOf('_inventarioAbiertoEnServidor()') < reset.indexOf('_adminIniciarSesionFirestore(') &&
    reset.indexOf('_inventarioAbiertoEnServidor()') < reset.indexOf('_obtenerSiguienteNumeroInventario('));
chk('★ La consulta va al servidor, no a la caché local',
    /source: 'server'/.test(extraer(flujo, '_inventarioAbiertoEnServidor') || ''));
chk('Si no se puede consultar, no se borra nada',
    /if \(vigente\.error\) \{[\s\S]{0,700}?return;/.test(reset));
chk('Conteo no ofrece crear mientras el inventario no se ha leído',
    /_inventarioActivoSinResolver\(\)/.test(cab) && /!_inventarioActivoSinResolver\(\)/.test(ui));

// ═══ Resultado ═════════════════════════════════════════════════════════════
const ancho = Math.max.apply(null, casos.map(c => c.nombre.length));
console.log('\n  ── Contabilizar dentro de Conteo · y CONTABILIZADO ya no es "abierto" ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) + (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
