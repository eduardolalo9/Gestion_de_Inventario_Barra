#!/usr/bin/env node
/**
 * prueba-hallazgo9-cuenta-activa.js — v5.26 · hallazgo #9 (desactivar cuenta no revoca sesión)
 * ═══════════════════════════════════════════════════════════════════════════
 * Desactivar una cuenta (usuarios/{uid}.status = 'inactivo') solo invalidaba
 * el _authzState del CLIENTE — una cortesía de interfaz. El servidor nunca
 * comprobaba 'status' en dos sitios:
 *
 *   1. isAdminUser() solo miraba 'role' — un ADMIN desactivado conservaba
 *      autoridad total mientras su token de Firebase Auth siguiera vivo.
 *   2. La mayoría de las colecciones de datos reales (catálogo, recetario,
 *      compras, movimientos, inventarios, notificaciones, ajustes, reportes…)
 *      solo exigían 'allow read: if request.auth != null;' — cualquier
 *      token vivo, activo o no, seguía leyendo todo.
 *
 * El fix: isAdminUser() y cada 'allow read' que antes solo pedía estar
 * autenticado ahora exigen _cuentaActiva() — que ya existía y ya protegía
 * hasPerm() (y por tanto toda escritura granular), solo faltaba aplicarla a
 * estos dos puntos.
 *
 * Comprobación estática sobre el texto de las reglas.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const rules = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

chk('★ isAdminUser() ya no basta con role en [\'admin\',\'ADMIN\'] — también exige _cuentaActiva()',
    /function isAdminUser\(\) \{[\s\S]{0,1000}?&& _cuentaActiva\(\);\s*\n\s*\}/.test(rules));
chk('_cuentaActiva() sigue siendo la misma función ya usada por hasPerm() (no se duplicó la lógica)',
    (rules.match(/function _cuentaActiva\(\) \{/g) || []).length === 1 &&
    /return _cuentaActiva\(\) && \(/.test(rules));

// Ningún 'allow read' debe quedar como un simple 'request.auth != null' —
// deben haber pasado todos a _cuentaActiva() (o llevar una condición propia,
// como hasPerm(...) o la autocomprobación de /usuarios/{uid}).
// Se descartan las líneas de comentario (// ...) para no contar el propio
// texto explicativo que cita la forma vieja como ejemplo histórico.
const codigoSinComentarios = rules.split('\n').filter(function(l) { return !/^\s*\/\//.test(l); }).join('\n');
const lecturasBasura = codigoSinComentarios.match(/allow read:\s*if request\.auth != null;/g) || [];
chk('★ Ningún "allow read" quedó en el bare check original (todas pasaron a _cuentaActiva())',
    lecturasBasura.length === 0, lecturasBasura.length + ' quedaron sin convertir');

const lecturasConCuentaActiva = rules.match(/allow read:\s*if _cuentaActiva\(\);/g) || [];
chk('★ Al menos 15 colecciones de datos reales ahora exigen _cuentaActiva() para leer (eran 20 antes del fix)',
    lecturasConCuentaActiva.length >= 15, 'encontradas: ' + lecturasConCuentaActiva.length);

// Las colecciones mencionadas explícitamente en el hallazgo deben estar entre las convertidas.
['match /roles/{roleId}', 'match /catalogo/{docId}', 'match /recetario/{docId}',
 'match /notificaciones/{notifId}', 'match /movimientos/{movId}', 'match /ajustes/{ajusteId}',
 'match /reportes/{reporteId}'].forEach(function(bloque) {
    const i = rules.indexOf(bloque);
    const trozo = i === -1 ? '' : rules.slice(i, i + 400);
    chk('★ ' + bloque + ' exige _cuentaActiva() para leer',
        /allow read:\s*if _cuentaActiva\(\);/.test(trozo), 'bloque no encontrado o sin convertir');
});

// El self-read de /usuarios/{uid} NO debe quedar bloqueado por _cuentaActiva():
// una cuenta desactivada tiene que poder leer SU PROPIO documento para que el
// cliente sepa que está desactivada (si no, nunca se entera).
chk('/usuarios/{uid} · get sigue sin exigir _cuentaActiva() en su propia lectura (evita el círculo vicioso)',
    /allow get:\s*if request\.auth != null && \(request\.auth\.uid == uid \|\| isAdminUser\(\)\);/.test(rules));

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Desactivar cuenta ahora sí revoca acceso en el servidor (v5.26, hallazgo #9) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
