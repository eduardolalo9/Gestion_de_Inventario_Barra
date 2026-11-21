// v5.56 — Anular el inventario ABIERTO, menú ⋮ y «Conteos por usuario» compacto: guardas estáticas.
// (El comportamiento real está en prueba-v556-menu-usuarios-navegador.js y en run-rules-tests.js: AN10–AN12.)
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const sin = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const f75 = sin(leer('js/75-auditoria-flujo.js')), f85 = sin(leer('js/85-ui-inventario-fisico.js')), css = leer('css/utilidades.css');
const fAb = f75.slice(f75.indexOf('async function anularInventarioAbierto()'), f75.indexOf('function restaurarInventario('));

chk('★ Anular el abierto usa los MISMOS ayudantes del cierre normal: snapshot + semana + batch (todo o nada)', /_construirSnapshotInventario\(\)/.test(fAb) && /_semanaIdDelInventario\(_inventarioActivo\)/.test(fAb) && /_escribirSnapshotEnBatch\(batch, inventoryRef, registros\)/.test(fAb) && (fAb.match(/batch\.commit\(\)/g) || []).length === 1);
chk('★ El inventario pasa a CERRADO con cierreTipo «anulado» y la marca de anulado en el MISMO batch', /estado: 'CERRADO', cierreTipo: 'anulado'/.test(fAb) && /anulado: true, anuladoEn: Date\.now\(\), anuladoPor: _anUidAuth\(\)/.test(fAb));
chk('Nunca borra ni reemplaza documentos (sin delete/set sobre el inventario) y no toca los conteos de los usuarios', !/\.(delete|runTransaction)\s*\(/.test(fAb) && !/userAuditoria/.test(fAb) && !/allUsersAuditoria\s*=|myAuditoriaConteo\s*=/.test(fAb));
chk('Mismas guardas que cerrar: administración con inventory.closeGlobal, nube, conexión, inventario abierto de la sesión y SIN reconteo abierto', /isAdmin\(\) \|\| !hasPermission\('inventory\.closeGlobal'\)|!isAdmin\(\) \|\| !hasPermission\('inventory\.closeGlobal'\)/.test(fAb) && /navigator\.onLine/.test(fAb) && /inventarioAbierto\(_inventarioActivo\)/.test(fAb) && /_hayReconteoAbierto\(_auditoriaSessionId\)/.test(fAb) && /String\(_inventarioActivoId\) !== String\(_auditoriaSessionId\)/.test(fAb));
chk('Un inventario huérfano (de otra sesión) no se anula: se manda a «cerrar como abandonado»', /cerrarInventarioHuerfano\(_inventarioActivoId\)/.test(fAb));
chk('Evita el doble toque (_anulandoAbierto) y avisa cuántas personas tienen conteos que se conservan', /_anulandoAbierto/.test(fAb) && /se guardan dentro del inventario \(no se pierden\)/.test(fAb));
chk('★ Los avisos finales usan _anAviso (no se descartan tras el «⏳ …»), el rechazo del servidor se explica y no hay «🛑»', /_anAviso\('🚫 Inventario #' \+ numero \+ ' anulado\. Ya puedes crear/.test(fAb) && /_anErrorEscritura\(err, 'anular el inventario'\)/.test(fAb) && !/🛑/.test(fAb));
chk('Se deja registro de auditoría (cola de sincronización) con el estado antes y después', /tipo: 'inventario_anulado', detalle: 'Inventario Físico #' \+ numero \+ ' \(abierto\) anulado/.test(fAb));

// Menú ⋮
const fMenu = f85.slice(f85.indexOf('var _ifMenuAbierto = false;'), f85.indexOf('function _renderInventarioFisicoHeader()'));
chk('★ El menú ⋮ solo se arma para administración; contabilizado y huérfano no tienen menú', /if \(!inv \|\| !isAdmin\(\)\) return null;/.test(fMenu) && /inv\.estado === 'CONTABILIZADO'\) return null/.test(fMenu) && /_esInventarioHuerfano\(\)/.test(fMenu));
chk('Para el abierto exige además inventory.closeGlobal; para un anulado ofrece Restaurar', /hasPermission\('inventory\.closeGlobal'\)/.test(fMenu) && /return 'restaurar'/.test(fMenu));
chk('★ Sin manejadores en línea (compatible con la CSP estricta): usa data-if-menu / data-if-accion y un oyente delegado', !/\bon(click|change|keydown)\s*=/.test(fMenu) && /data-if-menu/.test(fMenu) && /addEventListener\('click'/.test(fMenu));
chk('Reutiliza el menú de Recetario (rec-menu*) ya definido en densidad.css, con aria-haspopup/aria-expanded y botón de 44 px', /rec-menu__btn/.test(fMenu) && /aria-haspopup="menu"/.test(fMenu) && /aria-expanded/.test(fMenu) && /\.rec-menu__btn \{ width: 44px; height: 44px/.test(leer('css/densidad.css')));
chk('Escape y tocar fuera lo cierran; el estado sobrevive a los repintados en vivo (_ifMenuAbierto)', /e\.key === 'Escape' && _ifMenuAbierto/.test(fMenu) && /!t\.closest\('\[data-if-menu-wrap\]'\)/.test(fMenu));
chk('La tarjeta «Siguiente paso» ya no repite el botón «Anular inventario» (lo sustituye el menú)', !/btnAnular/.test(f85));

// Panel compacto
const fPan = f85.slice(f85.indexOf('function _renderAdminUsersPanel()'), f85.indexOf("e.target.closest('[data-uc-toggle]')"));
chk('★ El panel sigue siendo una if-card (if-card--usuarios) y una fila por persona (uc-fila)', /<div class="if-card if-card--usuarios">/.test(fPan) && /class="uc-fila/.test(fPan));
chk('★ Ya no pinta lo que sobraba: ni «Sin iniciar», ni «prods», ni totales «ent/ab», ni una fila por área', !/Sin iniciar|' prod'|' ent'|' ab'|audit-area-row|totalEnteras|totalAbiertas/.test(fPan.replace(/'sin iniciar'/g, '')));
chk('★ Conserva las acciones de administración (Ver, Habilitar, Reabrir) con los mismos manejadores y permisos, solo al desplegar', /adminVerConteoUsuario/.test(fPan) && /adminUnlockAreaUsuario/.test(fPan) && /reabrirAlmacenAdmin/.test(fPan) && /hasPermission\('inventory\.reopenArea'\)/.test(fPan) && /if \(abierto\)/.test(fPan));
chk('Todo dato de la persona se escapa (escapeHtml) y los argumentos de los manejadores pasan por jsArg', /escapeHtml\(_ucNombre\(u\)\)/.test(fPan) && /escapeHtml\(u\.email \|\| ''\)/.test(fPan) && /jsArg\(u\.uid\)/.test(fPan) && /jsArg\(area\)/.test(fPan));
chk('El CSS nuevo usa solo tokens (sin hex ni rgba) y define todas las clases uc-* e if-cab', (() => { const bloque = css.slice(css.indexOf('v5.56 — Menú')); const clases = [...new Set((fPan + f85.slice(f85.indexOf('var _tituloInv'), f85.indexOf('html += badge;')) ).match(/(?<![-\w])uc-[a-z_]+(--[a-z]+)?|(?<![-\w])if-cab\b/g) || [])]; return !/#[0-9a-fA-F]{3,6}\b|rgba\(/.test(bloque) && clases.every(c => new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '\\b').test(bloque)); })());

const ver = /APP_VERSION = '([^']+)'/.exec(leer('sw.js'))[1];
chk('La versión es 5.56 o posterior y coincide en index.html', parseFloat(ver) >= 5.56 && new RegExp('97-exportar-conteo\\.js\\?v=' + ver.replace('.', '\\.')).test(leer('index.html')), ver);
const fallos = C.filter(c => !c.ok);
C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + ' ' + c.n + (c.ok ? '' : '  ←  ' + c.d)));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron\n');
process.exit(fallos.length ? 1 : 0);
