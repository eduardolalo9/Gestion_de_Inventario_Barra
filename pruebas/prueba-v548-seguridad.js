// v5.48 — Auditoría de seguridad C-1: XSS almacenado por manejadores en línea.
//   · jsArg() es PURA: se prueba con el código real de js/00-nucleo.js (carga idéntica al navegador).
//   · datoNubeSeguro() y el lector de fragmentos descartan ids con sintaxis al LEER de Firestore.
//   · Guarda estática: ningún manejador on*="…" puede interpolar un valor que no pase por jsArg().
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
function extraer(src, nombre) {
    let ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return '';
    if (src.slice(ini - 6, ini) === 'async ') ini -= 6;
    const m = /\n        (?:\/\*\*|(?:async )?function )/.exec(src.slice(ini + 16));
    return m ? src.slice(ini, ini + 16 + m.index) : src.slice(ini);
}
const nucleo = leer('js/00-nucleo.js');
const ctx = { console }; vm.createContext(ctx);
vm.runInContext(extraer(nucleo, 'jsArg') + '\n' + extraer(nucleo, 'datoNubeSeguro') + '\n' + extraer(nucleo, 'escapeHtml'), ctx);

// ═══ 1 · jsArg ═══
const cargas = ["x');alert(1);//", 'a");alert(1);//', "');fetch('//evil')//", '\\', "\\');alert(1);//", '</script><script>alert(1)</script>',
    '<img src=x onerror=alert(1)>', "&#039;);alert(1);//", 'línea\nnueva', 'ñandú · 🍸', "'", '"', '', 'PED-003-ab12'];
ctx.__c = cargas;
const idas = vm.runInContext('__c.map(jsArg)', ctx);
chk('★ La salida de jsArg solo contiene letras, números, espacio, _ . - y secuencias \\x / \\u (ni HTML ni JS la leen como sintaxis)',
    idas.every(s => /^(?:[A-Za-z0-9 _.\-]|\\x[0-9a-f]{2}|\\u[0-9a-f]{4})*$/.test(s)), JSON.stringify(idas.filter(s => !/^(?:[A-Za-z0-9 _.\-]|\\x[0-9a-f]{2}|\\u[0-9a-f]{4})*$/.test(s))));
chk('★ Ida y vuelta exacta: al ejecutarse el JS del atributo recupera el valor original (también con ñ, emoji y saltos de línea)',
    idas.every((s, i) => vm.runInNewContext("'" + s + "'") === cargas[i]), '');
chk('Un id legítimo (PED-003-ab12) sale sin cambios', ctx.jsArg('PED-003-ab12') === 'PED-003-ab12');
chk('null / undefined → cadena vacía', ctx.jsArg(null) === '' && ctx.jsArg(undefined) === '');
// Reproduce el ataque: el patrón viejo (escapeHtml dentro del atributo) vs el nuevo
const viejo = (v) => "deleteOrder('" + ctx.escapeHtml(v) + "')";
const decodifica = (attr) => attr.replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
chk('(demostración) con el patrón VIEJO el atributo decodificado SÍ ejecuta código inyectado',
    /deleteOrder\('x'\);alert\(1\);\/\//.test(decodifica(viejo(cargas[0]))), decodifica(viejo(cargas[0])));
const nuevo = (v) => "deleteOrder('" + ctx.jsArg(v) + "')";
let llamadas = [], pwn = 0;
vm.runInNewContext(decodifica(nuevo(cargas[0])), { deleteOrder: (x) => llamadas.push(x), alert: () => pwn++ });
chk('★ Con jsArg el mismo ataque llama a deleteOrder UNA vez con el id literal y no ejecuta nada más', pwn === 0 && llamadas.length === 1 && llamadas[0] === cargas[0], JSON.stringify(llamadas));

// ═══ 2 · datoNubeSeguro ═══
const ok = (o) => ctx.datoNubeSeguro(o);
chk('Acepta ids legítimos de pedido, inventario y sesión', ok({ id: 'PED-003-ab12' }) && ok({ id: 'INV-0012', inventoryId: 'sess_17a3b9' }) && ok({ id: 42 }) && ok({ nombre: 'sin id' }));
chk('★ Rechaza ids con comillas, <, >, &, \\, acento grave, saltos de línea o > 120 caracteres',
    ["x'y", 'x"y', 'x<y', 'x>y', 'x&y', 'x\\y', 'x`y', 'x\ny', 'x\u2028y', 'a'.repeat(121)].every(v => !ok({ id: v })));
chk('Rechaza inventoryId con sintaxis y elementos que no son objetos', !ok({ inventoryId: "x');//" }) && !ok(null) && !ok('texto') && !ok({ id: { a: 1 } }));
// lector de fragmentos con el código real
const fs40 = leer('js/40-firestore.js');
ctx.console = { warn() {} };
vm.runInContext(extraer(fs40, '_readChunkedSubcollection'), ctx);
const docs = [{ id: 'chunk_0', data: () => ({ chunkIndex: 0, totalChunks: 1, items: [{ id: 'PED-001-aa11' }, { id: "x');alert(1);//" }, { id: 'PED-002-bb22' }] }) }];
ctx.__ref = { collection: () => ({ orderBy: () => ({ get: async () => ({ empty: false, forEach: (f) => docs.forEach(f) }) }) }) };
vm.runInContext('__leer = _readChunkedSubcollection(__ref, "ordersChunks")', ctx);
ctx.__leer.then((res) => {
    chk('★ El lector de fragmentos entrega los elementos legítimos y descarta el que trae un id con sintaxis', res.length === 2 && res.every(x => /^PED-00/.test(x.id)), JSON.stringify(res));

    // ═══ 3 · Guarda estática ═══
    const pat = /\\'' *\+ *(.+?) *\+ *'\\'/g;
    const malos = [];
    fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js')).forEach(f => {
        leer('js/' + f).split('\n').forEach((l, i) => {
            if (!(/on[a-z]+=\\?"/.test(l) || l.includes('onclick'))) return;
            let m; pat.lastIndex = 0;
            while ((m = pat.exec(l))) if (!/^jsArg\(/.test(m[1].trim())) malos.push(f + ':' + (i + 1) + ' → ' + m[1].slice(0, 40));
        });
    });
    chk('★ GUARDA: ningún manejador on*="…" interpola un valor sin pasar por jsArg() (' + malos.length + ' fuera de regla)', malos.length === 0, malos.join(' | '));
    const cuantos = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js')).reduce((n, f) => n + (leer('js/' + f).match(/\\'' \+ jsArg\(/g) || []).length, 0);
    chk('Los 57 sitios revisados en la auditoría usan jsArg() (hay ≥ 57)', cuantos >= 57, String(cuantos));

    const fallos = C.filter(c => !c.ok);
    C.forEach(c => console.log((c.ok ? '  ✅ ' : '  ❌ ') + c.n + (c.ok ? '' : '  ← ' + c.d)));
    console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron');
    process.exit(fallos.length ? 1 : 0);
});
