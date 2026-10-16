#!/usr/bin/env node
/**
 * prueba-hallazgo4-xss-notificaciones.js — v5.26 · hallazgo #4 (Cero Pérdida de Datos / XSS)
 * ═══════════════════════════════════════════════════════════════════════════
 * Antes, n.id se pintaba crudo dentro del onclick de marcarNotifLeida() y la
 * regla de Firestore dejaba crear /notificaciones/{notifId} con CUALQUIER id
 * y CUALQUIER forma a cualquier autenticado — un id elegido a mano (p.ej.
 * desde la consola del navegador, saltándose crearNotificacion()) podía
 * romper el atributo onclick y ejecutar código con la sesión de quien abriera
 * la pantalla (normalmente el admin, por las broadcast).
 *
 * El fix es el mismo patrón que ya protege /ajustes (FASE 7 S2):
 *   1. js/50-roles-permisos.js — el render descarta cualquier id que no sea
 *      alfanumérico antes de meterlo en el onclick (igual que idSeg en
 *      renderAjustesTab).
 *   2. firestore.rules — 'create' exige el id automático de add() (20
 *      alfanuméricos), valida la forma exacta del documento y solo el admin
 *      puede marcar broadcast:true.
 *
 * Comprobación estática (como ya hacen prueba-fase7.js y prueba-redis-r7d.js
 * para el mismo patrón en /ajustes): no hace falta ejecutar el render para
 * confirmar que el candado está puesto en el texto fuente.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

const roles = leer('js/50-roles-permisos.js');
const rules = leer('firestore.rules');

// ── 1 · Render: el id de la notificación se sanea antes del onclick ───────
chk('★ renderNotificacionesTab() descarta un id que no sea alfanumérico (mismo candado que /ajustes)',
    /const idSeg = \/\^\[A-Za-z0-9\]\{1,40\}\$\/\.test\(String\(n\.id \|\| ''\)\) \? n\.id : '';/.test(roles));
chk('★ El botón "Leído" usa idSeg, ya no n.id crudo, dentro del onclick',
    /marcarNotifLeida\(\\'' \+ idSeg \+ '\\'\)/.test(roles) &&
    !/marcarNotifLeida\(\\'' \+ n\.id \+ '\\'\)/.test(roles));
chk('Sin un id válido, el botón no se pinta (en vez de pintar un onclick vacío o roto)',
    /if \(!n\.leido && idSeg\) html \+=/.test(roles));
chk('El texto de la notificación sigue escapado (eso ya estaba bien, no se tocó)',
    /escapeHtml\(_notifTextoLimpio\(n\.texto\)\)/.test(roles));

// ── 2 · Firestore: 'create' ya no acepta cualquier id ni cualquier forma ──
chk('★ El id del documento debe ser el automático de add() (20 alfanuméricos), no uno elegido a mano',
    // v5.26 (hallazgo #9) — la lectura de /notificaciones/{notifId} pasó de
    // 'request.auth != null' a '_cuentaActiva()'; no es lo que este chk
    // comprueba (eso vive en prueba-hallazgo9-cuenta-activa.js), así que el
    // patrón solo ancla el bloque por el 'allow create' que le sigue.
    /match \/notificaciones\/\{notifId\} \{[\s\S]{0,200}?allow create: if request\.auth != null[\s\S]{0,40}?notifId\.matches\('\[A-Za-z0-9\]\{20\}'\)/.test(rules));
chk('La forma del documento queda fijada (hasOnly/hasAll) a lo que escribe crearNotificacion()',
    /request\.resource\.data\.keys\(\)\.hasOnly\(\['tipo', 'texto', 'broadcast',\s*'destinatarioUid', 'remitenteUid', 'creadoEn', 'leido'\]\)/.test(rules));
chk('★ Solo el admin puede crear una notificación broadcast (a todo el personal)',
    /request\.resource\.data\.broadcast == false \|\| isAdminUser\(\)/.test(rules));
chk('remitenteUid no se puede falsear: debe ser el uid autenticado que escribe',
    /request\.resource\.data\.remitenteUid == request\.auth\.uid/.test(rules));
chk('El tipo queda acotado a los cuatro valores reales que usa la app',
    /request\.resource\.data\.tipo in \['catalogo', 'recetario', 'ajuste', 'reporte'\]/.test(rules));
chk('update sigue limitado a solo "leido", dirigido a uno mismo o broadcast (sin cambios — ya estaba bien)',
    /allow update: if request\.auth != null\s*&& request\.resource\.data\.diff\(resource\.data\)\s*\.affectedKeys\(\)\.hasOnly\(\['leido'\]\)/.test(rules));

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── XSS almacenado en Notificaciones (v5.26, hallazgo #4) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
