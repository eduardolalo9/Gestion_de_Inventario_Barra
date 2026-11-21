// v5.55 — Anular inventarios físicos (no borrar) y descargar/compartir al contabilizar: guardas estáticas y lógica pura.
//   node pruebas/prueba-v555-anular-inventario.js   (el comportamiento real contra Firestore lo prueba run-rules-tests.js: AN1–AN9)
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const rules = leer('firestore.rules'), f75 = leer('js/75-auditoria-flujo.js'), f85 = leer('js/85-ui-inventario-fisico.js'), f97 = leer('js/97-exportar-conteo.js');
const sinComentarios = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

// ═══ 1 · Reglas de Firestore ═══
const bloque = rules.slice(rules.indexOf('match /inventories/{inventoryId}'), rules.indexOf('match /snapshotChunks/{chunkId}'));
chk('★ El borrado de inventarios SIGUE prohibido (allow delete: if false) — se anula, no se borra', /allow delete: if false;/.test(bloque));
chk('★ La anulación es una rama aparte: solo desde CERRADO y sin cambiar de estado (nunca desde CONTABILIZADO)', /resource\.data\.estado == 'CERRADO'\s*&& request\.resource\.data\.estado == 'CERRADO'[\s\S]*hasOnly\(\['anulado'/.test(bloque));
chk('La lista blanca de la anulación son exactamente 7 campos', /hasOnly\(\['anulado','anuladoEn','anuladoPor','anuladoPorNombre','motivoAnulacion','restauradoEn','restauradoPor'\]\)/.test(bloque));
chk('Al anular exige motivo de 5 a 300 caracteres y que quien anula sea quien escribe', /motivoAnulacion\.size\(\) >= 5/.test(bloque) && /motivoAnulacion\.size\(\) <= 300/.test(bloque) && /anuladoPor == request\.auth\.uid/.test(bloque));
chk('★ La transición a CONTABILIZADO exige que no esté anulado (el servidor lo impide aunque se saltaran la app)', /resource\.data\.get\('anulado', false\) != true[\s\S]{0,260}hasOnly\(\['estado','contabilizadoEn'/.test(bloque));
chk('Sigue siendo solo para administración (isAdminUser) y la contabilización sigue exigiendo inventory.post', /allow update: if isAdminUser\(\)/.test(bloque) && /hasPerm\('inventory\.post'\)/.test(bloque));
chk('No se tocaron las reglas de snapshotChunks (siguen inmutables): update y delete en false', (() => { const i = rules.indexOf('match /snapshotChunks/{chunkId}'); return /allow update, delete: if false;/.test(rules.slice(i, i + 1800)); })());

// ═══ 2 · evaluarContabilizable (lógica real, extraída del archivo) ═══
const ini = f75.indexOf('function evaluarContabilizable(inv, hoyISO)');
let fin = f75.indexOf('\n        }\n', ini) + '\n        }\n'.length;
const ctx = vm.createContext({ console, semanaId: (f) => f, esUltimoDiaDelMes: () => false, clasificarRecuento: () => ({ cierraSemana: true, esCorteMensual: false }), fechaISOLocal: () => '2026-11-20', Date, Object, Math, String, Number });
vm.runInContext(f75.slice(ini, fin), ctx);
const ev = (x) => vm.runInContext('evaluarContabilizable(' + JSON.stringify(x) + ')', ctx);
const r1 = ev({ estado: 'CERRADO', anulado: true, motivoAnulacion: 'Se creó por error', semanaId: '2026-11-16' });
chk('★ Un CERRADO anulado no es contabilizable y el motivo lo dice (con el texto del motivo)', r1.puede === false && r1.anulado === true && /ANULADO/.test(r1.motivo) && /Se creó por error/.test(r1.motivo), JSON.stringify(r1));
chk('Un anulado sin motivo registrado también se bloquea', ev({ estado: 'CERRADO', anulado: true, semanaId: 'x' }).puede === false);
chk('Un CONTABILIZADO sigue reportándose como hecho (nunca se trata como anulado)', ev({ estado: 'CONTABILIZADO', semanaDestino: '2026-11-16' }).hecho === true);
chk('Un CERRADO con anulado=false (restaurado) vuelve a evaluarse como antes (no queda bloqueado por la marca)', ev({ estado: 'CERRADO', anulado: false, semanaId: '2026-11-16', fechaRecuento: '2026-11-15' }).anulado !== true);

// ═══ 2b · inventarioAnulable (único lugar de la decisión) ═══
const ia = f75.indexOf('function inventarioAnulable(inv)');
const ctx2 = vm.createContext({ Object, Boolean });
vm.runInContext(f75.slice(ia, f75.indexOf('\n', ia)), ctx2);
const an = (x) => vm.runInContext('inventarioAnulable(' + JSON.stringify(x) + ')', ctx2);
chk('★ inventarioAnulable: solo un CERRADO sin anular (no abierto, no contabilizado, no ya anulado, no vacío)', an({ estado: 'CERRADO' }) === true && an({ estado: 'CERRADO', anulado: false }) === true
    && an({ estado: 'SINCRONIZADO' }) === false && an({ estado: 'CONTABILIZADO' }) === false && an({ estado: 'CERRADO', anulado: true }) === false && an(null) === false);

// ═══ 3 · Funciones de anular / restaurar ═══
// v5.56: anularInventarioAbierto() (cierre atómico con snapshot) tiene su propia prueba (prueba-v556-anular-abierto.js); aquí solo
// el anular de un CERRADO y el restaurar, que escriben UNA marca con update().
const fAn = sinComentarios(f75.slice(f75.indexOf('function _anNombreUsuario()'), f75.indexOf('async function anularInventarioAbierto()'))
                         + f75.slice(f75.indexOf('function restaurarInventario('), f75.indexOf('if (typeof window !== \'undefined\') { window.anularInventario')));
chk('★ Anular solo ESCRIBE con ref.update(datos) de 5 campos: anulado, anuladoEn, anuladoPor, anuladoPorNombre, motivoAnulacion', /var datos = \{ anulado: true, anuladoEn: Date\.now\(\), anuladoPor: _anUidAuth\(\), anuladoPorNombre: _anNombreUsuario\(\), motivoAnulacion: motivo \}/.test(fAn) && (fAn.match(/\.update\(/g) || []).length === 2);
chk('★ Ninguna de las dos funciones borra ni reemplaza documentos (nada de delete/set/batch)', !/\.(delete|set|batch|runTransaction)\s*\(/.test(fAn));
chk('Antes de escribir relee el inventario del SERVIDOR y exige estado CERRADO y que no esté ya anulado', /get\(\{ source: 'server' \}\)/.test(fAn) && /inventarioAnulable\(inv\)/.test(fAn) && /inv\.anulado === true/.test(fAn));
chk('Solo administración y con conexión: isAdmin(), _db y navigator.onLine se comprueban primero', /if \(!isAdmin\(\)\)/.test(fAn) && /if \(!_db\)/.test(fAn) && /navigator\.onLine/.test(fAn));
chk('Pide el motivo (mínimo 5 caracteres) y confirma antes de restaurar (showConfirm)', /m\.length < 5/.test(fAn) && /showConfirm\(/.test(fAn));
chk('★ Los avisos importantes empiezan con ⚠️ o ❌ (los demás se descartan si hay otro aviso reciente): ningún «🛑» en este flujo', !/🛑/.test(fAn) && !/🛑 Este inventario está ANULADO/.test(f75));
chk('Un rechazo del servidor (permission-denied) se explica: «¿Ya publicaste las reglas de Firestore de la v5.55?»', /permission-denied/.test(fAn) && /reglas de Firestore de la v5\.55/.test(fAn));
chk('Queda registro de auditoría (cola de sincronización): inventario_anulado e inventario_restaurado', /tipo: 'inventario_anulado'/.test(fAn) && /tipo: 'inventario_restaurado'/.test(fAn));
chk('El motivo se escapa al pintarlo (escapeHtml) y el texto del número no se interpola sin Number()/escapeHtml', /escapeHtml\(String\(numero\)\)/.test(fAn) && !/innerHTML\s*=\s*[^;]*motivo/.test(fAn));

// ═══ 4 · Pantalla ═══
const c85 = sinComentarios(f85);
chk('★ El paso de contabilizar muestra «Descargar / Compartir» en los tres estados (contabilizado, por contabilizar, cerrado sin poder contabilizar)', (c85.match(/btnExp/g) || []).length >= 6);
chk('«Anular inventario» (menú ⋮, v5.56) solo se ofrece a administración y, en un cerrado, con inventarioAnulable()', /function _ifMenuAccionDe\(inv\)[\s\S]*?isAdmin\(\)[\s\S]*?inventarioAnulable\(inv\)/.test(c85));
chk('El Historial oculta los anulados y solo administración puede mostrarlos', /if \(!\(isAdmin\(\) && _historialMostrarAnulados\)\)/.test(c85) && /historialAlternarAnulados/.test(c85));
chk('El detalle de un contabilizado no ofrece anular (la condición exige estado CERRADO)', /isAdmin\(\) && inventarioAnulable\(meta\)/.test(c85));
chk('El encabezado de Conteo marca ANULADO y la tarjeta ofrece Restaurar y Crear el siguiente', /ANULADO<\/span>/.test(c85) && /restaurarInventario/.test(c85) && /btnCrear\(true\)/.test(c85));

// ═══ 5 · Exportar un inventario cerrado ═══
chk('El botón de un inventario cerrado exige inventory.export + inventory.viewAll + nube (no sale en modo local)', /origen && origen\.inventoryId\) return typeof _db !== 'undefined' && !!_db/.test(f97));
chk('Reutiliza el consolidado del Excel del Historial (_consolidarConteoCongelado), sin reglas propias', /_consolidarConteoCongelado\(usuarios, hist, prods\)/.test(f97));

// ═══ 6 · Versión y archivos ═══
const ver = /APP_VERSION = '([^']+)'/.exec(leer('sw.js'))[1];
chk('La versión es 5.55 o posterior y coincide entre index.html y sw.js', parseFloat(ver) >= 5.55 && new RegExp('97-exportar-conteo\\.js\\?v=' + ver.replace('.', '\\.')).test(leer('index.html')), ver);

const fallos = C.filter(c => !c.ok);
C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + ' ' + c.n + (c.ok ? '' : '  ←  ' + c.d)));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron\n');
process.exit(fallos.length ? 1 : 0);
