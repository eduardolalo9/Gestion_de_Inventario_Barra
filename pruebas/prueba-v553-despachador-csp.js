// v5.53 — Despachador de eventos (preparación para quitar 'unsafe-inline' del CSP).
//   1 · Analizador: lo que acepta y lo que RECHAZA (intentos de ataque incluidos).
//   2 · Valores: lo que genera jsArg() llega EXACTO como argumento (ida y vuelta).
//   3 · Resolución: solo funciones propias de la app (nunca nativas ni nombres peligrosos).
//   4 · Ejecución: orden, this/event, return false, atomicidad.
//   5 · Guarda estática: TODO manejador en línea de la fuente es ejecutable por el despachador.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });

// El despachador se carga en un contexto con un «window» propio y funciones de ejemplo
const llamadas = [];
const win = { alert() { llamadas.push('ALERT'); }, miFuncion(...a) { llamadas.push(['miFuncion', ...a]); }, otra(...a) { llamadas.push(['otra', ...a]); },
              UI: { cabecera: function (...a) { llamadas.push(['UI.cabecera', ...a]); } }, noFuncion: 5 };
win.alert = Function.prototype.call.bind(function () {});             // función «nativa» (bound → [native code])
win.window = win; win.eval = Function.prototype.call.bind(function () {}); win.fetch = win.open = win.setTimeout = win.alert;   // como en un navegador real: window.window === window
const ctx = { console, window: win, localStorage: undefined, Math, JSON, Object, String, Array, parseInt, parseFloat, Function };
vm.createContext(ctx);
vm.runInContext(leer('js/02-despachador-eventos.js'), ctx);
const D = ctx.CspDespachador;
const jsArg = vm.runInNewContext('(' + (/function jsArg\([\s\S]*?\n        }\n/.exec(leer('js/00-nucleo.js'))[0]) + ')', { String });

// ═══ 1 · Analizador ═══
const ok = (t) => D.parsear(t).ok;
chk('Acepta llamadas simples, con argumentos y en secuencia', ok("f()") && ok("f('a', 1, true, null)") && ok("switchTab('x'); sbClose()") && ok("a.b.c('x');") && ok("cerrarMiPerfil(); signOutUser()"));
chk('Acepta this / this.value / this.checked / this.getAttribute / event como argumentos', ok("f(this)") && ok("f(this.value)") && ok("f(this.checked)") && ok("f(this.getAttribute('data-x'))") && ok("f(event)") && ok("f('id', event)"));
chk('Acepta return false, event.preventDefault() y event.stopPropagation()', ok("return false") && ok("event.stopPropagation(); f('x')") && ok("event.preventDefault(); f()"));
const ataques = ["eval('alert(1)')", "f(1+2)", "f(x)", "x = 1", "a.constructor('return 1')()", "f()()", "new Foo()", "function(){}", "(function(){})()",
                 "f('a') + g()", "f(`x`)", "f([1,2])", "f({a:1})", "if(x) f()", "f(a.b)", "f() || g()", "document.cookie", "location='http://x'", "f('sin cerrar", "javascript:f()", "f(;)", "f(,)", ";", "",
                 "this.value = 1", "f(this.value.length)", "event.target.remove()", "f('x'); y = 2", "toString()", "constructor('x')", "__proto__.x()"];
const aceptados = ataques.filter(t => ok(t));
chk('★ RECHAZA asignaciones, eval, expresiones, encadenados, plantillas, new, funciones anónimas, constructor y __proto__ (' + ataques.length + ' casos)', aceptados.length === 0, 'aceptados: ' + aceptados.join(' | '));
chk('Los textos entre comillas con paréntesis o punto y coma no confunden al analizador', ok("f('a);b(')") && D.parsear("f('a);b(')").pasos.length === 1);

// ═══ 2 · Valores: ida y vuelta con jsArg ═══
const cargas = ["x');alert(1);//", 'a");alert(1);//', '\\', "&#039;);alert(1);//", '</script><script>alert(1)</script>', 'línea\nnueva', 'ñandú · 🍸', "'", '"', '', 'PED-003-ab12', 'a b'];
let malas = [];
cargas.forEach(v => {
  llamadas.length = 0;
  const attr = "miFuncion('" + jsArg(v) + "')";
  const r = D.ejecutar(attr, { tagName: 'DIV' }, { preventDefault() {} });
  if (!(r.ok && llamadas.length === 1 && llamadas[0][0] === 'miFuncion' && llamadas[0][1] === v)) malas.push(JSON.stringify(v));
});
chk('★ Lo que produce jsArg() llega EXACTO como argumento y sin ejecutar nada más (comillas, \\, saltos de línea, emoji…)', malas.length === 0, malas.join(' | '));

// ═══ 3 · Resolución segura ═══
chk('Resuelve funciones propias, también con ruta (UI.cabecera)', !!D.resolver(['miFuncion']) && !!D.resolver(['UI', 'cabecera']));
chk('★ NO resuelve funciones nativas (alert, eval, fetch, setTimeout, open…)', !D.resolver(['alert']) && !D.resolver(['eval']) && !D.resolver(['fetch']) && !D.resolver(['setTimeout']) && !D.resolver(['open']));
chk('★ NO resuelve nombres peligrosos ni heredados del prototipo (constructor, __proto__, toString, hasOwnProperty)', !D.resolver(['constructor']) && !D.resolver(['__proto__']) && !D.resolver(['toString']) && !D.resolver(['hasOwnProperty']) && !D.resolver(['UI', 'constructor']));
chk('No resuelve lo que no existe ni lo que no es función', !D.resolver(['noExiste']) && !D.resolver(['noFuncion']));

// ═══ 4 · Ejecución ═══
llamadas.length = 0; D.ejecutar("miFuncion(1); otra('b')", null, null);
chk('Ejecuta las llamadas EN ORDEN', JSON.stringify(llamadas) === JSON.stringify([['miFuncion', 1], ['otra', 'b']]));
llamadas.length = 0; D.ejecutar("miFuncion(this.value, this.checked, this.getAttribute('data-x'), event)", { value: 'V', checked: true, getAttribute: (k) => 'attr:' + k }, { tipo: 'E' });
chk('this.value, this.checked, this.getAttribute() y event se pasan como argumentos', JSON.stringify(llamadas) === JSON.stringify([['miFuncion', 'V', true, 'attr:data-x', { tipo: 'E' }]]));
let prev = 0; const rf = D.ejecutar('return false', null, { preventDefault() { prev++; } });
chk('return false cancela la acción por defecto (formularios)', prev === 1 && rf.cancelo);
const rs = D.ejecutar("event.stopPropagation(); miFuncion('x')", null, { preventDefault() {} });
chk('event.stopPropagation() detiene la subida a los elementos padre', rs.detuvo === true);
llamadas.length = 0; const ra = D.ejecutar("miFuncion('antes'); funcionQueNoExiste('x')", null, null);
chk('★ ATÓMICO: si una función de la secuencia no existe, NO se ejecuta ninguna (nada a medias)', !ra.ok && llamadas.length === 0, JSON.stringify(llamadas));
llamadas.length = 0;
const nat = ["alert('x')", "window.alert('x')", "eval('1')", "window.eval('1')", "fetch('http://x')", "setTimeout('x', 1)", "open('http://x')", "window.open('http://x')"].map(t => D.ejecutar(t, null, null));
chk('★ Una función NATIVA (alert, eval, fetch, setTimeout, open, también vía window.) puede ser sintácticamente una llamada pero NUNCA se ejecuta', nat.every(r => !r.ok && /no disponible|prohibido/.test(r.motivo)) && llamadas.length === 0, JSON.stringify(nat));
llamadas.length = 0; const viaWindow = D.ejecutar("window.miFuncion('ok')", null, null);
chk('(informativo) window.miFuncion() resuelve a la misma función propia; no abre nada nuevo', viaWindow.ok && llamadas.length === 1);

// ═══ 5 · Superficie de eventos ═══
chk('★ Solo escucha eventos de USUARIO: click, change, input, submit (nunca load, error, focus, mouseover…)', Object.keys(D._EVENTOS).sort().join() === 'change,click,input,submit');
const fuente = leer('js/02-despachador-eventos.js');
chk('★ Se registra en fase de CAPTURA (recibe también los eventos que no burbujean, como los disparados por código)', /addEventListener\(tipo, _alCapturar, true\)/.test(fuente));
chk('El despachador no usa eval, new Function, setTimeout con texto ni innerHTML', !/\beval\s*\(|new\s+Function|innerHTML|document\.write|setTimeout\s*\(\s*['"]/.test(fuente.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));

// ═══ 6 · Guarda estática: todo manejador en línea de la fuente es ejecutable ═══
const archivos = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js') && f !== 'xlsx.full.min.js').map(f => 'js/' + f).concat(['index.html']);
const re = /\bon([a-z]+)\s*=\s*(\\?")([\s\S]*?)\2/g;
const entienden = [], noEntienden = [], eventosNoSoportados = [], nombres = new Set();
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"\\])\/\/.*$/gm, (m, a) => a + ' '.repeat(m.length - a.length)).replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
for (const f of archivos) {
  const s = sinComentarios(leer(f)); let m;
  while ((m = re.exec(s))) {
    const ev = m[1]; const ln = s.slice(0, m.index).split('\n').length;
    if (!['click', 'change', 'input', 'submit'].includes(ev)) { eventosNoSoportados.push(f + ':' + ln + ' on' + ev); continue; }
    const crudo = m[3];
    if (/^\s*'\s*\+/.test(crudo.replace(/\\'/g, "'"))) continue;             // «pasa-manos»: el texto lo pone quien llama (se revisa abajo)
    let c = crudo.replace(/\\'/g, "'").replace(/''\s*\+[^']*?\+\s*''/g, "'X'").replace(/'\s*\+[^'+]*?\+\s*'/g, '1');
    const r = D.parsear(c);
    if (r.ok) { entienden.push(f + ':' + ln); r.pasos.forEach(p => { if (p.t === 'call') nombres.add(p.ruta[0]); }); }
    else noEntienden.push(f + ':' + ln + ' (' + r.motivo + ') ' + c.slice(0, 90).replace(/\n/g, ' '));
  }
}
chk('★ GUARDA: ningún manejador en línea de la fuente queda fuera de lo que el despachador ejecuta (' + noEntienden.length + ' fuera de regla)', noEntienden.length === 0, noEntienden.join(' || '));
chk('Se revisaron más de 240 manejadores (la guarda no está vacía)', entienden.length > 240, String(entienden.length));
chk('★ GUARDA: no hay manejadores de eventos que no son de usuario (onkeydown, onmouseover, onload, onerror, onfocus…) — el teclado va por data-activar-teclado',
    eventosNoSoportados.length === 0, eventosNoSoportados.join(' | '));
// las funciones que se nombran en los manejadores existen como funciones GLOBALES (function x() / window.x =), no como const/let
const definidas = new Set();
for (const f of archivos) {
  const s = leer(f);
  (s.match(/(?:^|[^\w$.])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g) || []).forEach(x => definidas.add(/function\s+([A-Za-z_$][\w$]*)/.exec(x)[1]));
  (s.match(/window\.([A-Za-z_$][\w$]*)\s*=/g) || []).forEach(x => definidas.add(/window\.([A-Za-z_$][\w$]*)/.exec(x)[1]));
}
const nativosOk = new Set();
const faltan = [...nombres].filter(n => !definidas.has(n) && !nativosOk.has(n));
chk('★ GUARDA: cada función que nombran los manejadores está definida como función global (si fuera const/let, el despachador no la vería)', faltan.length === 0, 'sin definir: ' + faltan.join(', '));
// los textos que viajan por los «pasa-manos» (volver:, accion:, _hdBtn(…), moduloCabecera(…))
const pasaManos = [];
for (const f of archivos.filter(x => x.endsWith('.js'))) {
  const s = sinComentarios(leer(f));
  let mm; const reA = /\b(?:volver|accion)\s*:\s*(["'])((?:\\.|(?!\1).)*)\1/g;
  while ((mm = reA.exec(s))) pasaManos.push([f, mm[2].replace(/\\'/g, "'")]);
  const reH = /_hdBtn\(\s*(["'])((?:\\.|(?!\1).)*)\1/g;
  while ((mm = reH.exec(s))) pasaManos.push([f, mm[2].replace(/\\'/g, "'")]);
  const reM = /moduloCabecera\(\s*'[^']*'\s*,\s*(["'])((?:\\.|(?!\1).)*)\1/g;
  while ((mm = reM.exec(s))) pasaManos.push([f, mm[2].replace(/\\'/g, "'")]);
}
const malosPM = pasaManos.filter(([f, t]) => !/^[a-z_]*$/i.test(t) || t === '' ? false : !D.parsear(t).ok);
const pmFuera = pasaManos.filter(([f, t]) => !D.parsear(t).ok && /[(;=]/.test(t));
chk('★ GUARDA: los textos que pasan por volver:, accion:, _hdBtn() y moduloCabecera() también los ejecuta el despachador (' + pasaManos.length + ' revisados)', pasaManos.length > 15 && pmFuera.length === 0, pmFuera.map(x => x[0] + ': ' + x[1]).join(' || '));
// otras superficies del CSP
const html = leer('index.html');
chk('Sin enlaces javascript: en la app (no los ejecuta un CSP estricto)', !/href\s*=\s*["']javascript:/i.test(html) && archivos.filter(f => f.endsWith('.js')).every(f => !/href\s*=\s*\\?["']javascript:/i.test(sinComentarios(leer(f)))));

// ═══ 7 · Modo: «sombra» mientras el navegador ejecute manejadores en línea; «activo» cuando no ═══
function modoCon(politica, sondaEjecuta) {
  const w = { __cspSonda: 0 }; let sondas = 0;
  const meta = politica === null ? null : { getAttribute: () => politica };
  const doc = { querySelector: () => meta, createElement: () => { sondas++; return { setAttribute() {}, click() { if (sondaEjecuta) w.__cspSonda = 1; } }; },
                body: { appendChild() {}, removeChild() {} }, documentElement: {}, addEventListener() {} };
  const c2 = { console, window: w, document: doc, localStorage: undefined, Math, JSON, Object, String, Array, parseInt, parseFloat, Function };
  vm.createContext(c2); vm.runInContext(leer('js/02-despachador-eventos.js'), c2);
  return { modo: c2.CspDespachador.modo(), sondas };
}
const hoy = modoCon("default-src 'self'; script-src 'self' 'unsafe-inline' https://x", true);
chk('★ Con la política ACTUAL (meta permisivo) y un navegador que ejecuta lo en línea → «sombra»: no ejecuta nada (lo hace el navegador)', hoy.modo === 'sombra', JSON.stringify(hoy));
const estr = modoCon("default-src 'self'; script-src 'self' 'sha256-abc'", false);
chk('★ Meta estricto (sin \'unsafe-inline\') → «activo» sin probar nada (una cabecera no puede aflojar un meta): sin ruido en la consola', estr.modo === 'activo' && estr.sondas === 0, JSON.stringify(estr));
const cab = modoCon("default-src 'self'; script-src 'self' 'unsafe-inline'", false);
chk('★ Meta permisivo pero una CABECERA HTTP estricta (la sonda no se ejecuta) → «activo»: los botones no se quedan muertos', cab.modo === 'activo', JSON.stringify(cab));
chk('Sin meta CSP alguno la sonda decide', modoCon(null, true).modo === 'sombra' && modoCon(null, false).modo === 'activo');

// ═══ 8 · La política estricta (la de v5.54) se genera bien ═══
const { aplicarCspEstricto, hashesEnLinea } = require('../herramientas/csp-hashes.js');
const crypto = require('crypto');
const estricto = aplicarCspEstricto(html);
const pol = (/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(estricto) || [])[1] || '';
const scriptSrc = (/script-src([^;]*)/.exec(pol) || [])[1] || '';
const bloques = []; html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (_, b) => { bloques.push(b); return _; });
chk('★ La política estricta NO lleva \'unsafe-inline\' en script-src', !/'unsafe-inline'/.test(scriptSrc) && scriptSrc.length > 0, scriptSrc);
chk('★ Lleva el hash sha256 EXACTO de cada <script> en línea (' + bloques.length + ' bloques): solo esos se ejecutan, un script inyectado no',
    bloques.length >= 4 && bloques.every(b => scriptSrc.includes("'sha256-" + crypto.createHash('sha256').update(b, 'utf8').digest('base64') + "'")) && hashesEnLinea(html).length === bloques.length);
chk('★ Ningún bloque «en línea» arrastra un comentario ni otra etiqueta (el comentario de index.html menciona <script>): cada hash es el de UN script real',
    bloques.length >= 4 && bloques.every(b => !/<!--|<\/?script/i.test(b)) && bloques[0].trim().startsWith('// Evitar FOUC'), bloques.map(b => b.trim().slice(0, 25)).join(' | '));
chk('Conserva el resto de la política: object-src none, base-uri self, form-action self, hosts de Firebase', /object-src 'none'/.test(pol) && /base-uri 'self'/.test(pol) && /form-action 'self'/.test(pol) && /www\.gstatic\.com/.test(scriptSrc));
chk('(decisión documentada) style-src conserva \'unsafe-inline\': hay estilos en línea por toda la app y un estilo no ejecuta código', /style-src[^;]*'unsafe-inline'/.test(pol));
chk('★ (v5.57) La política que se entrega HOY ya es la estricta: sin \'unsafe-inline\' en script-src y con los 4 hashes (el cambio se activó con los datos de la «sombra»)', !/script-src[^;]*'unsafe-inline'/.test((/Content-Security-Policy" content="([^"]+)"/.exec(html) || [])[1] || '') && (html.match(/'sha256-/g) || []).length >= 4);

// ═══ 9 · La «sombra» no escribe nada en el aparato cuando todo va bien ═══
function escuchas(localStorageFalso) {
  const oyentes = {}; const doc = { querySelector: () => ({ getAttribute: () => "default-src 'self'; script-src 'self' 'unsafe-inline'" }), createElement: () => ({ setAttribute() {}, click() { c3.window.__cspSonda = 1; } }),
    body: { appendChild() {}, removeChild() {} }, documentElement: {}, addEventListener(t, f) { oyentes[t] = f; } };
  const c3 = { console, window: { __cspSonda: 0, miFuncion() {} }, document: doc, localStorage: localStorageFalso, Math, JSON, Object, String, Array, parseInt, parseFloat, Function };
  c3.window.window = c3.window; vm.createContext(c3); vm.runInContext(leer('js/02-despachador-eventos.js'), c3);
  return { oyentes, D3: c3.CspDespachador };
}
let escrituras = 0; const ls = { getItem: () => null, setItem: () => { escrituras++; } };
const E = escuchas(ls);
const el = (texto) => ({ nodeType: 1, getAttribute: (a) => a === 'onclick' ? texto : null, parentElement: null });
E.oyentes.click({ type: 'click', target: el("miFuncion('x')") });
E.oyentes.click({ type: 'click', target: el("miFuncion('y'); miFuncion('z')") });
chk('★ En «sombra», revisar manejadores que SÍ se entienden NO escribe nada en el aparato (0 escrituras)', escrituras === 0 && E.D3.resumen().n === 2, 'escrituras=' + escrituras + ' n=' + E.D3.resumen().n);
E.oyentes.click({ type: 'click', target: el("x = 1") });
chk('★ …pero un manejador que NO se entiende sí se anota (es justo lo que hay que revisar antes de quitar unsafe-inline)', escrituras === 1);
const esc2 = []; const ls2 = { _d: null, getItem() { return this._d; }, setItem(k, v) { this._d = v; esc2.push(v); } };
const E2 = escuchas(ls2); E2.oyentes.click({ type: 'click', target: el("funcionInexistente('a')") });
chk('El aviso guarda el texto del manejador y el motivo', /funcionInexistente/.test(esc2[0] || '') && /no disponible/.test(esc2[0] || ''), esc2[0]);

// ═══ 10 · Nombres de área (los define administración y viajan a todos los dispositivos): siempre escapados ═══
const s85 = leer('js/85-ui-inventario-fisico.js'), s70 = leer('js/70-conversion-render.js');
const sinEscape = (src, expr) => src.split('\n').filter(l => l.includes(expr) && /<\w/.test(l) && !new RegExp('escapeHtml\\(' + expr.replace(/[[\]]/g, '\\$&') + '\\)').test(l)).length;
chk('★ Los nombres de área se escapan en TODA línea que arma HTML (también dentro de aria-label): areasAuditoria[area] y CHIP_LABELS[area]',
    sinEscape(s85, 'areasAuditoria[area]') === 0 && sinEscape(s70, 'CHIP_LABELS[area]') === 0 && /aria-label="Entrar a ' \+ escapeHtml\(areasAuditoria\[area\]\)/.test(s85),
    'sin escape: 85=' + sinEscape(s85, 'areasAuditoria[area]') + ' 70=' + sinEscape(s70, 'CHIP_LABELS[area]'));

const fallos = C.filter(c => !c.ok);
C.forEach(c => console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  ← ' + c.d)));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
process.exit(fallos.length ? 1 : 0);
