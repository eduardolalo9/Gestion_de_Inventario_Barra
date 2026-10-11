#!/usr/bin/env node
/**
 * prueba-hallazgo5-escalada-admin.js — v5.26 · hallazgo #5 (escalada latente a ADMIN)
 * ═══════════════════════════════════════════════════════════════════════════
 * Dos huecos en firestore.rules dejaban que un delegado NO-admin se fabricara
 * autoridad de administrador en un solo paso, sin tocar nada que pareciera
 * "de administrador":
 *
 *   1. /usuarios/{uid} · update — un delegado con permissions.update podía
 *      cambiar CUALQUIER campo del documento de otro usuario, 'role'
 *      incluido. Bastaba poner role:'ADMIN' en una cuenta (propia o
 *      cómplice) para volverse admin. Ahora ese camino solo deja tocar lo
 *      que de verdad le corresponde a la delegación — overrides y áreas —,
 *      nunca 'role' ni 'status'.
 *
 *   2. /roles/{roleId} · update — un delegado con roles.update podía meter
 *      el comodín '*' en CUALQUIER rol que no fuera 'ADMIN' (la protección
 *      existente solo cubría ese rol), o regalarle a otro rol las dos
 *      delegaciones mismas (roles.update / permissions.update). Con eso se
 *      fabricaba autoridad total sin tocar 'usuarios/{uid}'.
 *
 * Comprobación estática sobre el texto de las reglas — mismo estilo que
 * prueba-f2.js para este archivo.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const rules = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
const casos = []; let fallos = 0;
const chk = (n, ok, d) => { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; };

// ── 1 · /usuarios/{uid} · update: el delegado de permissions.update ya no toca role/status ──
const bloqueUsuarios = rules.slice(rules.indexOf('match /usuarios/{uid}'), rules.indexOf('match /roles/{roleId}'));
chk('★ El delegado de permissions.update (uid != propio) tiene su propia rama, separada de la del usuario sobre sí mismo',
    /request\.auth\.uid != uid && hasPerm\('permissions\.update'\)/.test(bloqueUsuarios));
chk('★ Esa rama exige que la actualización NO toque \'role\'',
    /request\.auth\.uid != uid && hasPerm\('permissions\.update'\)\s*\n?\s*&& !\('role' in request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\)/.test(bloqueUsuarios));
chk('★ Y tampoco \'status\' (no puede activar/desactivar cuentas con esa delegación)',
    /hasPerm\('permissions\.update'\)[\s\S]{0,260}?!\('status' in request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\)/.test(bloqueUsuarios));
chk('El admin real sigue pudiendo cambiar cualquier campo (no se le acotó por error)',
    /allow update: if request\.auth != null && \(\s*\/\/ Admin puede cambiar cualquier campo\s*\n\s*isAdminUser\(\)/.test(bloqueUsuarios));

// ── 2 · /roles/{roleId} · update: ni el comodín ni las delegaciones se pueden regalar ──
const bloqueRoles = rules.slice(rules.indexOf('match /roles/{roleId}'), rules.indexOf('match /catalogo/{docId}'));
chk('★ El bloqueo original del comodín de ADMIN sigue intacto (no se perdió al tocar la regla)',
    /!\(roleId == 'ADMIN' && !\('\*' in request\.resource\.data\.permissions\)\)/.test(bloqueRoles));
chk('★ Un no-admin (solo roles.update) no puede meter el comodín \'*\' en NINGÚN rol, no solo en ADMIN',
    /isAdminUser\(\)\s*\|\|\s*\(\s*!\('\*' in request\.resource\.data\.permissions\)/.test(bloqueRoles));
chk('★ Tampoco puede regalarle a otro rol la delegación roles.update',
    /!\('roles\.update' in request\.resource\.data\.permissions\)/.test(bloqueRoles));
chk('★ Ni permissions.update (la otra llave que abre esta misma puerta)',
    /!\('permissions\.update' in request\.resource\.data\.permissions\)/.test(bloqueRoles));
chk('El admin real conserva la capacidad de otorgar cualquiera de los tres (no se le acotó por error)',
    /\(isAdminUser\(\)\s*\|\|\s*\(/.test(bloqueRoles));

const w = Math.max.apply(null, casos.map(c => c.n.length));
console.log('\n  ── Escalada latente a ADMIN vía permissions.update/roles.update (v5.26, hallazgo #5) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
