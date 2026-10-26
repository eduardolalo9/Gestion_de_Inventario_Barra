// v5.34 — Mi Perfil (Etapa 1): garantías estáticas del overlay de solo lectura.
//   node pruebas/prueba-v534-perfil.js
// No necesita navegador. El comportamiento en la app real lo cubre
// prueba-v534-perfil-navegador.js.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });

const mod = leer('js/56-mi-perfil.js');
const idx = leer('index.html');
const sw = leer('sw.js');
const nucleo = leer('js/00-nucleo.js');
const render = leer('js/70-conversion-render.js');
const nav = leer('js/98-navegacion-atras.js');
const util = leer('css/utilidades.css');
const estilos = leer('css/estilos.css');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const codigo = sinComentarios(mod);

// ── Arquitectura: overlay, NO pestaña ────────────────────────────────────
chk('★ El módulo no llama a switchTab para abrirse ni tocar activeTab (la única salida es perfilIrAAjustes)',
    !/activeTab/.test(codigo) && (codigo.match(/switchTab\(/g) || []).length === 1 && /function perfilIrAAjustes\(\)\s*\{[\s\S]*?switchTab\('ajustes'\)/.test(codigo));
const bloqueTabs = nucleo.slice(nucleo.indexOf('v5.33-TABS-BEGIN'), nucleo.indexOf('v5.33-TABS-END'));
chk('★ TABS_VALIDAS y TABS_COMPARTIBLES siguen SIN \'perfil\' (14 pestañas)',
    bloqueTabs.length > 100 && !/perfil/i.test(bloqueTabs.replace(/\/\/.*$/gm, '')) && (bloqueTabs.match(/'inicio'/g) || []).length >= 2);
const renderTabFn = render.slice(render.indexOf('function renderTab'), render.indexOf('function renderTab') + 6000);
chk('★ renderTab no tiene case \'perfil\'', renderTabFn.indexOf('function renderTab') === 0 && !/case\s+'perfil'/.test(renderTabFn));
chk('El sidebar no marca Mi perfil con data-sb-tab (no es una pestaña)', /id="sbPerfilBtn"/.test(idx) && !/id="sbPerfilBtn"[^>]*data-sb-tab/.test(idx) && !/data-sb-tab="perfil"/.test(idx));

// ── Solo lectura: ni guarda, ni sincroniza, ni escribe ───────────────────
chk('★ El módulo no escribe: sin localStorage, IndexedDB, Firestore, saveToLocalStorage ni syncToCloud',
    !/localStorage|sessionStorage|indexedDB|_db\b|\.collection\(|\.doc\(|saveToLocalStorage|syncToCloud|setItem|\.set\(|\.update\(/.test(codigo) && !/(?<!classList)\.add\(/.test(codigo));
chk('★ No asigna a ninguna variable global de datos (products, areasConteoDef, _lastUserData, auditCurrentUser…)',
    !/\b(products|areasConteoDef|_lastUserData|auditCurrentUser|currentUserRole|orders|inventories)\s*=[^=]/.test(codigo));
chk('Todo texto de datos pasa por escapeHtml (_pfT) antes de entrar al HTML',
    /function _pfT\(v\)\s*\{\s*return escapeHtml\(/.test(codigo) && !/\+\s*d\.(nombre|email|alias)\s*\+/.test(codigo.replace(/_pfT\(d\.(nombre|email|alias)[^)]*\)/g, '')));
chk('El campo «Nombre visible» está deshabilitado', /id="perfilNombreVisible"[^>]*disabled/.test(mod));
chk('Nombre visible = displayName de usuarios/{uid} (con el correo de respaldo)', /u && u\.displayName\) \|\| email/.test(mod));

// ── Integración ──────────────────────────────────────────────────────────
const pos = (s) => idx.indexOf(s);
chk('index.html carga js/56 después de js/54 y antes del arranque (js/60)', pos('<script src="js/56-mi-perfil.js') > pos('<script src="js/54-sync-vivo.js') && pos('<script src="js/56-mi-perfil.js') < pos('<script src="js/60-arranque.js'));
chk('sw.js lo calienta (WARM_URLS), no en PRECACHE', /'\.\/js\/56-mi-perfil\.js\?v=' \+ APP_VERSION/.test(sw) && !/PRECACHE_URLS\s*=\s*\[[^\]]*56-mi-perfil/.test(sw));
chk('Botón de cabecera FUERA de #headerActions (renderTab lo reescribe en cada pestaña)',
    /id="perfilBtn"/.test(idx) && pos('id="perfilBtn"') < pos('id="headerActions"') && !/headerActions\.innerHTML[^;]*perfil/i.test(render));
chk('Acceso desde «Más» (sidebar) cierra el menú y abre el perfil', /id="sbPerfilBtn" onclick="sbClose\(\); abrirMiPerfil\(\)"/.test(idx));
chk('Overlay accesible: role=dialog, aria-modal, título enlazado, cierra con clic en el fondo',
    /id="perfilOverlay"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="perfilTitulo"[^>]*event\.target === this/.test(idx) && /id="perfilTitulo"/.test(idx));
chk('Arranca oculto (clase hidden)', /id="perfilOverlay" class="pf-overlay hidden"/.test(idx));
chk('Atrás de Android cierra el perfil antes que el menú y que los modales',
    /nombre: 'mi perfil'[\s\S]*?cerrarMiPerfil/.test(nav) && nav.indexOf("nombre: 'mi perfil'") < nav.indexOf("nombre: 'menú'") && nav.indexOf("nombre: 'mi perfil'") < nav.indexOf("nombre: 'producto'"));
chk('Escape cierra el perfil y el listener se retira al cerrar', /key === 'Escape'\) cerrarMiPerfil/.test(codigo) && /removeEventListener\('keydown', _perfilEscHandler\)/.test(codigo));
chk('Foco: va al botón cerrar al abrir y regresa a quien abrió', /getElementById\('perfilCerrarBtn'\)[\s\S]*?focus/.test(codigo) && /_perfilAbridor/.test(codigo) && /a\.focus\(\)/.test(codigo));
chk('Con la pantalla de acceso visible no se abre', /function _perfilEnLogin\(\)/.test(codigo) && /if \(_perfilEnLogin\(\)\) return;/.test(codigo));

// ── Estilos ──────────────────────────────────────────────────────────────
const bloqueCss = util.slice(util.indexOf('/* ══════════════════════════════════════════════════════════════════════════\n   v5.34'));
chk('Estilos en utilidades.css (estilos.css no se toca), solo tokens: cero hex ni rgba()', bloqueCss.length > 500 && !/#[0-9a-fA-F]{3,8}\b/.test(bloqueCss) && !/rgba?\(/.test(bloqueCss) && !/pf-/.test(estilos));
chk('Controles táctiles de 44 px (cerrar, campo, botones)', (bloqueCss.match(/min-height: 44px|width: 44px; height: 44px/g) || []).length >= 3);
chk('z-index del overlay entre los modales (300) y la confirmación (9999)', /\.pf-overlay\s*\{[^}]*z-index: 400/.test(bloqueCss));
chk('La hoja respeta la altura visible del móvil (100dvh)', /max-height: calc\(100dvh/.test(bloqueCss));

// ── Versión ──────────────────────────────────────────────────────────────
const mV = /const APP_VERSION = '([\d.]+)'/.exec(sw);
const vs = [...new Set([...idx.matchAll(/\?v=([\d.]+)/g)].map(m => m[1]))];
chk('★ Versión ≥ 5.34: sw.js y todas las etiquetas ?v= de index.html coinciden', !!mV && parseFloat(mV[1]) >= 5.34 && vs.length === 1 && vs[0] === mV[1], (mV ? mV[1] : '?') + ' / ' + vs.join(','));

// ── Capa de lectura, ejecutada de verdad en un contexto aislado ──────────
const html = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
function contexto(extra) {
    const ctx = Object.assign({
        console, Math, Date, String, Number, Array, Object, JSON, setTimeout,
        escapeHtml: html, document: { getElementById: () => null, activeElement: null, addEventListener() {}, removeEventListener() {}, body: { contains: () => false } },
        _roleCanonico: (r) => String(r).toUpperCase(),
        ROLES_SISTEMA_DEFECTO: { ADMIN: { nombre: 'Administrador' }, BARTENDER: { nombre: 'Bartender' } },
        hasPermission: () => false
    }, extra || {});
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(mod, ctx);
    return ctx;
}
let c = contexto({
    _lastUserData: { displayName: 'Eduardo <b>X</b>', email: 'e@bar.mx', role: 'admin', status: 'activo' },
    areasConteoDef: [{ id: 'barra1', nombre: 'Barra 1', icono: '🍸', orden: 2 }, { id: 'almacen', nombre: 'Almacén', icono: '📦', orden: 1 }],
    products: [{ unit: 'PZA' }, { unit: 'PZA' }, { unit: ' Litros ' }, { unit: '' }, {}],
    auditCurrentUser: { userName: 'Barra-Tablet' }
});
let h = vm.runInContext('_perfilHtml()', c);
chk('★ Muestra el displayName, ESCAPADO (sin HTML inyectable)', /value="Eduardo &lt;b&gt;X&lt;\/b&gt;"/.test(h) && !/<b>X<\/b>/.test(h));
chk('Muestra correo, rol (nombre legible) y estado Activa', /e@bar\.mx/.test(h) && />Administrador</.test(h) && /eq-estado--activa/.test(h));
chk('Áreas en su orden, solo lectura', h.indexOf('Almacén') > 0 && h.indexOf('Almacén') < h.indexOf('Barra 1') && !/Administrar áreas/.test(h));
chk('Unidades en uso: cuenta por unidad, recorta espacios, agrupa vacías', /<span>PZA<\/span><span class="pf-n">2 productos<\/span>/.test(h) && /<span>Litros<\/span><span class="pf-n">1 producto<\/span>/.test(h) && /\(sin unidad\)<\/span><span class="pf-n">2 productos/.test(h));
chk('El alias del dispositivo se rotula aparte del nombre visible', /Nombre en el conteo/.test(h) && /Barra-Tablet/.test(h) && /No es tu nombre visible/.test(h));
c = contexto({ _lastUserData: { displayName: '', email: 'sin@nombre.mx', role: 'user' }, hasPermission: (p) => p === 'warehouses.update' });
h = vm.runInContext('_perfilHtml()', c);
chk('Sin displayName cae al correo; con permiso de áreas aparece «Administrar áreas en Ajustes»', /value="sin@nombre\.mx"/.test(h) && /Administrar áreas en Ajustes/.test(h));
c = contexto({});
h = vm.runInContext('_perfilHtml()', c);
chk('★ Sin datos de cuenta (sin red / aún no carga) no lanza error y avisa', /Aún no se cargan los datos de tu cuenta/.test(h) && /No hay áreas definidas/.test(h) && /aún no tiene productos/.test(h));
c = contexto({ _lastUserData: { role: 'user', status: 'inactivo' } });
chk('Cuenta inactiva se rotula Inactiva', /eq-estado--inactiva/.test(vm.runInContext('_perfilHtml()', c)));

const fallos = C.filter(x => !x.ok);
C.forEach(x => console.log((x.ok ? '  ✅  ' : '  ❌  ') + x.n + (x.ok ? '' : '  → ' + x.d)));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
process.exit(fallos.length ? 1 : 0);
