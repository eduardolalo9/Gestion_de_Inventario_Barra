#!/usr/bin/env node
/**
 * todas-locales.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Corre, una tras otra, todas las pruebas que NO necesitan el emulador de
 * Firestore. Es lo que `npm test` ejecuta antes de arrancar el emulador.
 *
 * Por qué un script en vez de encadenar con && en package.json: los scripts de
 * npm se ejecutan a través de cmd.exe en Windows, no de sh, y encadenar ahí ya
 * nos costó un diagnóstico equivocado. Aquí se lanza cada prueba con el mismo
 * Node que corre este archivo, sin pasar por ningún shell.
 *
 * Para añadir una prueba nueva: una línea más en la lista.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

// Solo pruebas ESTÁTICAS: leen los archivos del repositorio y no necesitan
// navegador, servidor ni red. Por eso pueden correr en cualquier máquina y en
// cualquier momento, que es lo que se quiere de un pretest.
//
// Las de navegador (prueba-m2a, prueba-c1, prueba-p0, prueba-p1) NO están aquí
// a propósito: levantan Chromium contra http://127.0.0.1:8080 y prueba-p0
// además necesita descargar SheetJS de cdnjs. Se ejecutan con
//     npm run test:navegador
// que arranca el servidor solo. Meterlas en el pretest haría que `npm test`
// fallara por no tener red, que no es lo mismo que tener el código roto.
const PRUEBAS = [
    'prueba-integridad-split.js',   // M2 — la partición en 17 archivos sigue sana
    'prueba-r1.js',                 // R1 — conteo en oz, decimales, sin motivo
    'prueba-r2.js',                 // R2 — el PV de Parrot en el catálogo
    'prueba-r3.js',                 // R3 — dos entornos, elegidos por el dominio
    'prueba-r4.js',                 // R4 — ciclo semanal lunes→domingo
    'prueba-r5.js',                 // R5 — el catálogo
    'prueba-r6.js',                 // R6 — áreas de conteo configurables
    'prueba-r7.js',                 // R7 — crear inventario desde formulario
    'prueba-f1.js',                 // F1 — los tres defectos criticos de la auditoria
    'prueba-d.js',                  // D  — sincronizacion y defectos criticos
    'prueba-f2.js',                 // F2 — permisos, privacidad y seguridad de servidor
    'prueba-f3prev.js',             // Paso previo a F3 — cierre atomico e inmutabilidad
    'prueba-f3.js',                 // F3 — contabilizar: inicial inmutable y alcance
    'prueba-p2.js',                 // FASE 4 — compras: persistencia e importacion desde Excel
    'prueba-fase5.js',              // FASE 5 — reapertura de area + conteo de auditoria huerfano
    'prueba-fase6.js',              // FASE 6 — buscadores: motor unificado + integracion
    'prueba-fase7.js',              // FASE 7 — seguridad: chunks, ajustes, conflictos, cambios
    'prueba-reconteo.js',      // RECONTEO — ventana de reconteo (estática)
    'prueba-fase8.js',         // FASE 8 — existencia oficial, versión de catálogo y reporte
    'prueba-contabilizar-conteo.js', // Contabilizar en Conteo + CONTABILIZADO ya no es "abierto"
    'prueba-8c.js',                  // FASE 8C — retiro de la escritura heredada de conteoAreas
    'prueba-recetario1.js',          // RECETARIO-1 — bill of materials, costeo, publicar/suscribir
    'prueba-recetario2.js',          // RECETARIO-2 — importador de recetas desde Excel
    'prueba-fase10.js',              // FASE 10 — ventas del POS: permisos, reglas, parser
    'prueba-fase11a.js',             // FASE 11A — costeo por unidad y consumo teórico
    'prueba-consumo-conversion.js',  // v5.26 — hallazgo #2: el consumo convierte ml/oz igual que el costeo
    'prueba-huella-catalogo-grande.js', // v5.26 — hallazgo #6: la huella con >100 productos ya no queda ciega a precio/mínimo/proveedor/PV/conversión
    'prueba-hallazgo4-xss-notificaciones.js', // v5.26 — hallazgo #4: XSS almacenado en Notificaciones (id sin escapar + regla permisiva)
    'prueba-hallazgo5-escalada-admin.js', // v5.26 — hallazgo #5: escalada latente a ADMIN vía permissions.update/roles.update
    'prueba-hallazgo3-respaldo-importar.js', // v5.26 — hallazgo #3: el respaldo previo a importar ahora incluye recetas/compras/ventas
    'prueba-hallazgo7-importar-json.js', // v5.26 — hallazgo #7: importar JSON exige settings.update y respalda antes de aplicar
    'prueba-hallazgo8-borrar-usuario.js', // v5.26 — hallazgo #8: borrar usuarios/{uid} ya no reactiva como BARTENDER activo
    'prueba-hallazgo9-cuenta-activa.js', // v5.26 — hallazgo #9: desactivar cuenta ahora revoca acceso en el servidor, no solo en el cliente
    'prueba-hallazgo10-deleteorder.js', // v5.26 — hallazgo #10: deleteOrder() exige isAdmin() igual que sus hermanos
    'prueba-hallazgo11-receta-inactiva.js', // v5.26 — hallazgo #11: una receta desactivada ya no sigue consumiendo inventario
    'prueba-hallazgo12-notificar-admin.js', // v5.26 — hallazgo #12: las solicitudes de ajuste ya dejan un rastro que SÍ le llega al admin
    'prueba-hallazgo13-permisos-delegables.js', // v5.26 — hallazgo #13: inventory.create/closeGlobal y reports.export ya no prometen una delegación que nunca funcionó
    'prueba-hallazgo14-roles-reales.js', // v5.26 — hallazgo #14: "Usuarios y permisos" lee roles/* real de Firestore, no el fallback del código
    'prueba-hallazgo15-compras-almacen-permiso.js', // v5.26 — hallazgo #15: Almacén sin nombre ya no se pierde; purchases.import ya puede guardar lo que importa
    'prueba-hallazgo16-cargar-ventas-semana.js', // v5.26 — hallazgo #16: Ventas se refresca sola al arrancar, al recuperar y en vivo entre dispositivos
    'prueba-paquete-textos-interfaz.js', // v5.26 — paquete de textos e interfaz: los 8 detalles menores (Pedidos, fechas de ancla, pie de login, Escape en 3 modales, discrepancia documentada, tokens de tema y permiso de exportación)
    'prueba-limpieza-codigo-muerto.js', // v5.26 — limpieza de código muerto: 4 funciones borradas (cero referencias reales), 4 conservadas (tenían prueba propia exigiéndolo) y la fuga de listener de Total publicado que esa verificación destapó
    'prueba-fase12.js',              // FASE 12 — folio #1001, anti-solapamiento y consistencia entre dispositivos
    'prueba-fisico-vs-sistema.js',   // FASE 11B (parte 1) — comparación físico vs. sistema
    'prueba-hotfix-4.22-movimientos.js', // HOTFIX 4.22 — recorte de movimientos y aviso de cuota
    'prueba-fase11b-parte2.js',      // FASE 11B (parte 2) — pedido sugerido y niveles de alerta
    'prueba-fase13-contabilizar-fin-de-mes.js', // FASE 13 — contabilizar el corte de fin de mes
    'prueba-redis-r1.js',            // REDISEÑO R1 — tokens, kit y retiro de los CDN
    'prueba-redis-r2.js',            // REDISEÑO R2 — una sola navegación y limpieza de la paleta anterior
    'prueba-redis-r3.js',            // REDISEÑO R3 — Inicio: mismo contenido, aspecto del kit, sin emoji de interfaz
    'prueba-redis-r4.js',            // REDISEÑO R4 — Conteo: el modal no cambia de flujo, solo de aspecto
    'prueba-redis-r5.js',            // REDISEÑO R5 — Inventario y áreas: historial, físico vs sistema y detalle cerrado
    'prueba-hotfix-4.25-almacenamiento.js', // HOTFIX 4.25 — almacenamiento local al 104%: respaldos por peso real, guardado que no se corta
    'prueba-redis-r6.js',             // REDISEÑO R6 — Catálogo y ficha: la ficha de producto (#productModal)
    'prueba-redis-r7.js',             // REDISEÑO R7 — Recetario y los modales pendientes
    'prueba-recetario-buscador-unificado.js', // Recetario — mismo buscador que Inicio (motor unificado, v5.8)
    'prueba-redis-r7b.js',             // REDISEÑO R7b — Compras (y Pedidos, revisado)
    'prueba-redis-r7c.js',             // REDISEÑO R7c — Ventas al kit Carbón & Latón
    'prueba-redis-r7d.js',             // REDISEÑO R7d — Historia, Notificaciones, Ajustes, Admin y Roles
    'prueba-redis-r8.js',              // REDISEÑO R8 — barrido global: contraste, CSS muerto, !important, táctil, encabezado
    'prueba-fase14.js',                // FASE 14 — ancla del Total (arrastre continuo) y venta del turno
    'prueba-posicion-conteo.js',       // v5.17 — conteo: la lista se queda donde estaba al contar y al cambiar de grupo
    'prueba-importar.js',              // v5.18 — Importar desde Excel, corte de existencias y detalle de compras
    'prueba-fase16.js',                // v5.19 — Total publicado, cortesías/2x1 y papelera de servidor
    'prueba-icono.js',                 // v5.20 — ícono de la app (archivos reales, manifest, SW)
    'prueba-corte-total.js',           // v5.21 — corte de existencias con el reporte de SBO (En Stock = total)
    'prueba-sync-vivo.js',             // v5.22 — compras, ventas y cortes en vivo entre dispositivos
    'prueba-inicio-conteo.js',         // v5.23 — diseño de Inicio y Conteo
    'prueba-tema-esmeralda.js',        // v5.25 — Verde Esmeralda: fuentes propias, paleta, barra lateral, tablet
    'prueba-conteo-compacto.js',       // v5.11 — vista compacta de las tarjetas de área del Conteo
    'prueba-actualizaciones.js',       // v5.12 — las actualizaciones sí llegan y se ven (SW + aviso + herramientas)
];

let fallaron = [];

for (const archivo of PRUEBAS) {
    const r = spawnSync(process.execPath, [path.join(__dirname, archivo)], {
        stdio: 'inherit',
    });
    // Un archivo que no existe, o que revienta al arrancar, cuenta como fallo:
    // una prueba que no corre no es una prueba que pasa.
    if (r.error) {
        console.error('\n  ✗ No se pudo ejecutar ' + archivo + ': ' + r.error.message + '\n');
        fallaron.push(archivo);
    } else if (r.status !== 0) {
        fallaron.push(archivo);
    }
}

if (fallaron.length) {
    console.error('\n  ═══ Fallaron ' + fallaron.length + ' de ' + PRUEBAS.length +
                  ' archivos de prueba: ' + fallaron.join(', ') + ' ═══\n');
    process.exit(1);
}

console.log('  ═══ ' + PRUEBAS.length + ' archivos de prueba locales, todos en verde ═══\n');
