#!/usr/bin/env node
/**
 * prueba-reconteo.js — RECONTEO, comprobaciones estáticas.
 * La ejecución real está en prueba-reconteo-integracion.js (Firestore real),
 * prueba-reconteo-navegador.js (Chromium) y run-rules-tests.js (RC-1 … RC-6).
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
const rc     = leer('js/87-reconteo.js');
const conv   = leer('js/70-conversion-render.js');
const flujo  = leer('js/75-auditoria-flujo.js');
const ui     = leer('js/85-ui-inventario-fisico.js');
const html   = leer('index.html');
const sw     = leer('sw.js');
const reglas = leer('firestore.rules');

// ── Carga ──
chk('index.html carga 87-reconteo.js entre 85 y 88',
    /85-ui-inventario-fisico\.js\?v=[\d.]+"><\/script>\n\s*<script src="js\/87-reconteo\.js\?v=[\d.]+"><\/script>\n\s*<script src="js\/88-compras/.test(html));
chk('El Service Worker precalienta 87-reconteo.js', /'\.\/js\/87-reconteo\.js\?v=' \+ APP_VERSION/.test(sw));
chk('La versión de caché subió por encima de 4.3',
    (() => { const m = /const APP_VERSION = '([^']+)'/.exec(sw); return m && parseFloat(m[1]) > 4.3; })());

// ── Rutas y acceso ──
const rit = cuerpo(ui, 'function renderInventarioTab(');
chk('renderInventarioTab enruta las tres vistas del reconteo',
    /'reconteo'\)\s+return renderReconteo\(\)/.test(rit) && /'reconteo_historial'\) return renderReconteoHistorial\(\)/.test(rit) &&
    /'reconteo_detalle'\)\s+return renderReconteoDetalle\(\)/.test(rit));
chk('El botón de reconteo solo aparece al admin con el inventario abierto',
    /if \(isAdmin\(\) && !esCerrado\) \{\s*html \+= '<button type="button" data-rc-accion="iniciar"/.test(ui));
['renderReconteo', 'renderReconteoHistorial', 'renderReconteoDetalle'].forEach(f => {
    chk(f + ' devuelve a la selección si no es admin',
        /if \(!_rcPuede\(\)\) \{ auditoriaView = 'selection'; return renderAuditoriaSeleccion\(\); \}/.test(cuerpo(rc, 'function ' + f + '(')));
});

// ── Modal compartido ──
const om = cuerpo(conv, 'function openInventarioModal(');
chk('openInventarioModal acepta el modo reconteo y lo apaga en una apertura normal',
    /_reconteoEdicion = _rc \? \{ prodId: productId, area: _rc\.area \} : null;/.test(om));
chk('closeInventarioModal limpia el modo reconteo', /_reconteoEdicion = null;/.test(cuerpo(conv, 'function closeInventarioModal(')));
const sm = cuerpo(conv, 'function saveInventarioModal(');
const iRc = sm.indexOf('if (_reconteoEdicion)');
chk('saveInventarioModal desvía el reconteo DESPUÉS de validar (misma validación de decimales y topes)',
    iRc > sm.indexOf('if (cant > 9999)') && iRc > sm.indexOf('invalidAbierta'));
chk('…y ANTES de escribir cualquier conteo',
    iRc > 0 && iRc < sm.indexOf('myAuditoriaConteo[inventarioModalProductId][auditoriaAreaActiva] =') &&
    iRc < sm.indexOf('inventarioConteo[inventarioModalProductId][selectedArea] ='));

// ── Integridad ──
const cierre = cuerpo(flujo, 'async function cerrarInventarioFisico(');
chk('★ Cerrar el inventario consulta si hay un reconteo abierto antes de confirmar',
    cierre.indexOf('_hayReconteoAbierto(_auditoriaSessionId)') > 0 &&
    cierre.indexOf('_hayReconteoAbierto(_auditoriaSessionId)') < cierre.indexOf('showConfirm('));
const fin = cuerpo(rc, 'function reconteoFinalizar(');
chk('Finalizar exige conexión, nombre, productos e inventario abierto',
    /navigator\.onLine/.test(fin) && /nombre de quien reconta/.test(fin) && /_rcInventarioAbierto\(\)/.test(fin) && /r\.orden\.length/.test(fin));
const conf = cuerpo(rc, 'async function _rcFinalizarConfirmado(');
chk('★ Las correcciones pasan por syncMyAuditoriaToFirestore y se verifica que subieron',
    /await syncMyAuditoriaToFirestore\(\)/.test(conf) && /_auditSyncPending/.test(conf) &&
    conf.indexOf('saveToLocalStorage()') < conf.indexOf('await syncMyAuditoriaToFirestore()'));
chk('Si el registro no se guarda, el reconteo sigue abierto (el cierre queda bloqueado)',
    /r\.estado = 'abierto'; r\.finalizadoEn = null;/.test(conf));
chk('El borrador se guarda en el dispositivo antes de subir', /_rcGuardarBorrador\(\);\s*clearTimeout\(_reconteoSubidaTimer\);/.test(cuerpo(rc, 'function _rcTocar(')));
chk('Seguridad: ninguna acción del reconteo usa onclick en línea', !/onclick\s*=/.test(rc));
chk('Seguridad: los nombres de producto se pintan escapados',
    /escapeHtml\(it\.nombre \|\| pid\)/.test(rc) && /resaltarBusqueda\(p\.name \|\| p\.id, q\)/.test(rc));

// ── Reglas ──
const blq = /match \/reconteos\/\{reconteoId\} \{([\s\S]*?)\n\s*allow delete: if false;/.exec(reglas);
const b = blq ? blq[1] : '';
chk('Reglas: leer y escribir reconteos es solo del administrador',
    /allow read: if isAdminUser\(\);/.test(b) && /allow create: if isAdminUser\(\) && _cuentaActiva\(\)/.test(b) && /allow update: if isAdminUser\(\) && _cuentaActiva\(\)/.test(b));
chk('Reglas: solo con el inventario SINCRONIZADO y nunca se borra',
    /_inventarioAbiertoPara\(docId, request\.resource\.data\.inventoryId\)/.test(b) &&
    /_inventarioAbiertoPara\(docId, resource\.data\.inventoryId\)/.test(b) && !!blq &&
    /data\.estado == 'SINCRONIZADO'/.test(reglas));
chk('Reglas: creador, fecha e inventario no se reescriben; la ronda no retrocede',
    /creadoPorUid == resource\.data\.creadoPorUid/.test(b) && /creadoEn\s+== resource\.data\.creadoEn/.test(b) &&
    /inventoryId\s+== resource\.data\.inventoryId/.test(b) && /ronda >= resource\.data\.ronda/.test(b));
chk('Reglas: la forma del documento coincide con _rcDocParaNube',
    (() => {
        const m = /d\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/.exec(reglas); if (!m) return false;
        const enReglas = m[1].replace(/[\s']/g, '').split(',').sort();
        const f = cuerpo(rc, 'function _rcDocParaNube(');
        const enCliente = (f.match(/^\s{16}(\w+):/gm) || []).map(x => x.trim().replace(':', '')).sort();
        return JSON.stringify(enReglas) === JSON.stringify(enCliente);
    })());

const w = Math.max(...casos.map(c => c.n.length));
console.log('\n  ── RECONTEO (estática) ──\n');
casos.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + '  ' + c.n.padEnd(w) + (c.ok ? '' : '   ← ' + c.d)));
console.log('\n  ' + casos.length + ' comprobaciones · ' + (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
process.exit(fallos ? 1 : 0);
