#!/usr/bin/env node
/**
 * prueba-fase7.js — FASE 7 (seguridad), comprobaciones estáticas.
 * La ejecución real contra Firestore está en prueba-fase7-integracion.js y en
 * run-rules-tests.js (F7-1 … F7-9).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8').replace(/\r/g, '');
const casos = []; let fallos = 0;
function chk(n, ok, d) { casos.push({ n, ok: !!ok, d: d || '' }); if (!ok) fallos++; }
function cuerpo(src, firma) {
    const i = src.indexOf(firma); if (i === -1) return '';
    let nivel = 0, dentro = false;
    for (let j = i; j < src.length; j++) {
        if (src[j] === '{') { nivel++; dentro = true; }
        else if (src[j] === '}') { nivel--; if (dentro && nivel === 0) return src.slice(i, j + 1); }
    }
    return '';
}
const reglas = leer('firestore.rules');
const fire = leer('js/40-firestore.js');
const roles = leer('js/50-roles-permisos.js');
const inv = leer('js/85-ui-inventario-fisico.js');
const busc = leer('js/80-buscador.js');
const pers = leer('js/20-persistencia.js');
const auth = leer('js/auth.js');
const sw = leer('sw.js');

// ── S1 ──
['ordersChunks', 'inventoriesChunks'].forEach(c => {
    const m = new RegExp('match /' + c + '/\\{chunkId\\} \\{([\\s\\S]*?)\\n\\s*\\}').exec(reglas);
    const b = m ? m[1] : '';
    chk(c + ': ya no hay "allow read, write" abierto', b && !/allow read, write/.test(b));
    chk(c + ': borrar es solo de administración', /allow delete:\s*if isAdminUser\(\);/.test(b));
    chk(c + ': escribir exige cuenta activa y forma válida', /_cuentaActiva\(\) && _chunkValido\(chunkId\)/.test(b));
});
chk('_chunkValido fija id, campos exactos, índice coherente y ≤ 80 items',
    /chunkId\.matches\('chunk_\[0-9\]\{1,4\}'\)/.test(reglas) && /hasOnly\(\['items', 'chunkIndex', 'totalChunks', '_updatedAt'\]\)/.test(reglas) &&
    /chunkId == 'chunk_' \+ string\(d\.chunkIndex\)/.test(reglas) && /d\.items\.size\(\) <= 80/.test(reglas));
const esc = cuerpo(fire, 'async function _writeChunkedSubcollection(');
chk('El cliente solo intenta borrar sobrantes si es admin', /if \(typeof isAdmin === 'function' && isAdmin\(\)\) \{[\s\S]*delBatch\.delete/.test(esc));
chk('La limpieza es de mejor esfuerzo (no tumba la sincronización)', /catch \(e\) \{\s*console\.warn\('\[Firebase\]\[Chunk\] Limpieza/.test(esc));
const lee = cuerpo(fire, 'async function _readChunkedSubcollection(');
chk('La lectura respeta el totalChunks de chunk_0', /d\.id === 'chunk_0'/.test(lee) && /data\.chunkIndex < total/.test(lee));
chk('La lectura ignora residuos que no se llaman chunk_N', /\^chunk_\\d\+\$/.test(lee));

// ── S2 ──
const aj = /match \/ajustes\/\{ajusteId\} \{([\s\S]*?)\n\s{15}\}/.exec(reglas);
const ajb = aj ? aj[1] : '';
chk('ajustes: create valida cuenta activa, id automático, autoría y estado', /_cuentaActiva\(\)/.test(ajb) &&
    /ajusteId\.matches\('\[A-Za-z0-9\]\{20\}'\)/.test(ajb) && /solicitanteUid == request\.auth\.uid/.test(ajb) && /estado == 'pendiente'/.test(ajb));
chk('ajustes: cantidadSugerida solo número o null', /cantidadSugerida is number/.test(ajb));
chk('ajustes: resolver toca solo estado/resolvidoEn/resolvidoPor', /hasOnly\(\['estado', 'resolvidoEn', 'resolvidoPor'\]\)/.test(ajb));
const rend = cuerpo(roles, 'function renderAjustesTab(') || roles;
chk('La pantalla de ajustes escapa la cantidad y normaliza estado e id',
    /escapeHtml\(String\(sug\)\)/.test(rend) && /\['pendiente', 'aprobado', 'rechazado'\]\.indexOf\(a\.estado\)/.test(rend) &&
    /resolverAjuste\(\\'' \+ idSeg/.test(rend) && !/' \(Sugerido: ' \+ a\.cantidadSugerida/.test(rend));
chk('Una cantidad sugerida de 0 ya no se pierde', !/cantidadSugerida: cantidadSugerida \|\| null/.test(roles) && !/parseFloat\(c\.value\)\|\|null/.test(roles));

// ── S3 ──
const cf = /match \/conflictos\/\{conflictoId\} \{([\s\S]*?)\n\s*\}/.exec(reglas);
chk('conflictos: solo-creación con cuenta activa', cf && /allow create: if _cuentaActiva\(\);/.test(cf[1]) && /allow update: if false;/.test(cf[1]));
const cb = /match \/cambios\/\{cambioId\} \{([\s\S]*?)allow update/.exec(reglas);
chk('cambios: al crear, el uid es el propio o ninguno', cb && /request\.resource\.data\.uid == request\.auth\.uid/.test(cb[1]) && /_cuentaActiva\(\)/.test(cb[1]));

// ── S5 / C2 / corrección FASE 6 ──
chk('Se pide almacenamiento persistente tras iniciar sesión, sin bloquear',
    /navigator\.storage\.persist\(\)/.test(pers) && /_pedirAlmacenamientoPersistente\(\)/.test(auth));
chk('La barra de progreso usa el número real de áreas', /totalCompletas \/ totalAreas/.test(inv) && !/totalCompletas \/ 3\)/.test(inv));
chk('El conteo no usa carga por tandas (Finalizar área nunca antes de productos ocultos)',
    /BusquedaUI\.registrar\('conteo', \{[\s\S]*?paso: 100000/.test(busc));
chk('La versión de caché subió por encima de 4.1',
    (() => { const m = /const APP_VERSION = '([^']+)'/.exec(sw); return m && parseFloat(m[1]) > 4.1; })());

const w = Math.max(...casos.map(c => c.n.length));
console.log('\n  ── FASE 7 · seguridad (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
