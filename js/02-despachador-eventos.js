        // ═══════════════════════════════════════════════════════════════════════
        //  v5.53 — DESPACHADOR DE EVENTOS (preparación para quitar 'unsafe-inline')
        //  ─────────────────────────────────────────────────────────────────────
        //  PROBLEMA. La app tiene cientos de manejadores en línea (onclick="f('x')").
        //  Con la política de contenido (CSP) sin 'unsafe-inline', el navegador no los
        //  ejecuta, y esa es justo la defensa que se busca: un HTML inyectado ya no
        //  puede correr JavaScript arbitrario ni disparar nada por su cuenta.
        //
        //  SOLUCIÓN. Este módulo escucha los eventos de USUARIO en el documento, lee el
        //  texto del atributo (onclick, onchange, oninput, onsubmit) y lo ejecuta con un
        //  intérprete MINÚSCULO, sin eval ni new Function (ambos están prohibidos por el
        //  CSP). Lo que entiende es deliberadamente poco:
        //
        //      sentencia  := llamada | 'return false' | 'event.preventDefault()' | 'event.stopPropagation()'
        //      llamada    := nombre('.'nombre)* '(' [argumento (',' argumento)*] ')'
        //      argumento  := 'texto' | número | true | false | null | this | this.value |
        //                    this.checked | this.getAttribute('x') | event
        //      el atributo := sentencia (';' sentencia)* [';']
        //
        //  LÍMITES DE SEGURIDAD (el diseño importa más que la comodidad):
        //   · Solo eventos de usuario: click, change, input, submit. Nunca load/error/focus/
        //     mouseover: un HTML inyectado no puede disparar nada sin que alguien toque.
        //   · Solo funciones PROPIAS de la app: se rechazan las nativas (alert, eval, fetch,
        //     open, setTimeout…) y los nombres peligrosos (constructor, __proto__…).
        //   · Argumentos solo literales: no hay expresiones, ni asignaciones, ni acceso libre
        //     a variables.
        //   · Un HTML inyectado aún podría pedir llamar a una función existente con un clic de
        //     la víctima; eso es MUCHO menos que JavaScript arbitrario, pero no es cero. El
        //     paso siguiente (más versiones) es pasar de texto a acciones registradas.
        //
        //  MODOS.
        //   · 'sombra' — mientras el CSP SÍ permite los manejadores en línea (hoy): no ejecuta
        //     nada; solo comprueba que cada manejador que se toca lo entendería y lo anota
        //     (localStorage inventarioApp_cspSombra) para poder ver, con uso real, que no
        //     queda ninguno sin soporte ANTES de quitar 'unsafe-inline'.
        //   · 'activo' — cuando el navegador NO ejecuta los manejadores en línea: ejecuta.
        //  El modo se decide solo (ver _detectarModo): no hay interruptor que olvidar.
        // ═══════════════════════════════════════════════════════════════════════
        var CspDespachador = (function() {
            var PROHIBIDOS = { constructor: 1, prototype: 1, __proto__: 1, eval: 1, Function: 1, __defineGetter__: 1, __defineSetter__: 1,
                               __lookupGetter__: 1, __lookupSetter__: 1, toString: 1, valueOf: 1, hasOwnProperty: 1 };
            var EVENTOS = { click: 'onclick', change: 'onchange', input: 'oninput', submit: 'onsubmit' };

            // ── Tokenizador ──────────────────────────────────────────────────────
            function _tokenizar(s) {
                var t = [], i = 0, n = s.length, c;
                while (i < n) {
                    c = s.charAt(i);
                    if (/\s/.test(c)) { i++; continue; }
                    if (c === "'" || c === '"') {
                        var q = c, v = '', cerrada = false; i++;
                        while (i < n) {
                            c = s.charAt(i);
                            if (c === '\\') {
                                var d = s.charAt(i + 1);
                                if (d === 'x' && /^[0-9a-fA-F]{2}$/.test(s.substr(i + 2, 2))) { v += String.fromCharCode(parseInt(s.substr(i + 2, 2), 16)); i += 4; continue; }
                                if (d === 'u' && /^[0-9a-fA-F]{4}$/.test(s.substr(i + 2, 4))) { v += String.fromCharCode(parseInt(s.substr(i + 2, 4), 16)); i += 6; continue; }
                                if (d === 'n') { v += '\n'; i += 2; continue; }
                                if (d === 't') { v += '\t'; i += 2; continue; }
                                if (d === '' ) return null;
                                v += d; i += 2; continue;
                            }
                            if (c === q) { cerrada = true; i++; break; }
                            v += c; i++;
                        }
                        if (!cerrada) return null;
                        t.push({ k: 'str', v: v }); continue;
                    }
                    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(s.charAt(i + 1)))) {
                        var m = /^-?\d+(?:\.\d+)?/.exec(s.slice(i));
                        t.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
                    }
                    if (/[A-Za-z_$]/.test(c)) {
                        var id = /^[A-Za-z_$][\w$]*/.exec(s.slice(i))[0];
                        t.push({ k: 'id', v: id }); i += id.length; continue;
                    }
                    if ('(),;.'.indexOf(c) !== -1) { t.push({ k: c }); i++; continue; }
                    return null;   // cualquier otro carácter (=, +, &, |, {, [, !, ?…) → no soportado
                }
                return t;
            }

            // ── Analizador ───────────────────────────────────────────────────────
            /** parsear(texto) → { ok:true, pasos:[…] } | { ok:false, motivo } */
            function parsear(texto) {
                var tk = _tokenizar(String(texto == null ? '' : texto));
                if (!tk) return { ok: false, motivo: 'caracteres no soportados' };
                var p = 0, pasos = [];
                function ver() { return tk[p]; }
                function es(k, v) { var x = tk[p]; return !!x && x.k === k && (v === undefined || x.v === v); }
                function ruta() {
                    if (!es('id')) return null;
                    var partes = [tk[p++].v];
                    while (es('.')) { p++; if (!es('id')) return null; partes.push(tk[p++].v); }
                    return partes;
                }
                function argumento() {
                    var x = ver();
                    if (!x) return { error: 'argumento incompleto' };
                    if (x.k === 'str' || x.k === 'num') { p++; return { arg: { t: 'lit', v: x.v } }; }
                    if (x.k === 'id') {
                        if (x.v === 'true' || x.v === 'false') { p++; return { arg: { t: 'lit', v: x.v === 'true' } }; }
                        if (x.v === 'null') { p++; return { arg: { t: 'lit', v: null } }; }
                        var r = ruta();
                        if (!r) return { error: 'argumento inválido' };
                        var j = r.join('.');
                        if (j === 'event') return { arg: { t: 'event' } };
                        if (j === 'this') return { arg: { t: 'this' } };
                        if (j === 'this.value') return { arg: { t: 'this.value' } };
                        if (j === 'this.checked') return { arg: { t: 'this.checked' } };
                        if (j === 'this.getAttribute' && es('(')) {
                            p++;
                            if (!es('str')) return { error: 'getAttribute exige un texto' };
                            var nombre = tk[p++].v;
                            if (!es(')')) return { error: 'getAttribute mal cerrado' };
                            p++;
                            return { arg: { t: 'attr', v: nombre } };
                        }
                        return { error: 'argumento no soportado: ' + j };
                    }
                    return { error: 'argumento no soportado' };
                }
                while (p < tk.length) {
                    if (es(';')) { p++; continue; }
                    // return false
                    if (es('id', 'return')) {
                        p++;
                        if (es('id', 'false')) { p++; pasos.push({ t: 'retfalse' }); continue; }
                        return { ok: false, motivo: 'solo se admite «return false»' };
                    }
                    var r = ruta();
                    if (!r) return { ok: false, motivo: 'se esperaba una llamada' };
                    if (!es('(')) return { ok: false, motivo: 'se esperaba «(» tras ' + r.join('.') };
                    p++;
                    var args = [];
                    if (!es(')')) {
                        for (;;) {
                            var a = argumento();
                            if (a.error) return { ok: false, motivo: a.error };
                            args.push(a.arg);
                            if (es(',')) { p++; continue; }
                            break;
                        }
                    }
                    if (!es(')')) return { ok: false, motivo: 'se esperaba «)»' };
                    p++;
                    if (p < tk.length && !es(';')) return { ok: false, motivo: 'sentencia no soportada tras la llamada' };
                    var nombre = r.join('.');
                    if (nombre === 'event.preventDefault' || nombre === 'event.stopPropagation') {
                        if (args.length) return { ok: false, motivo: nombre + ' no lleva argumentos' };
                        pasos.push({ t: nombre === 'event.preventDefault' ? 'prevent' : 'stop' });
                        continue;
                    }
                    for (var i = 0; i < r.length; i++) if (PROHIBIDOS[r[i]]) return { ok: false, motivo: 'nombre prohibido: ' + r[i] };
                    if (r[0] === 'event' || r[0] === 'this') return { ok: false, motivo: 'llamada sobre ' + r[0] + ' no soportada' };
                    pasos.push({ t: 'call', ruta: r, args: args });
                }
                if (!pasos.length) return { ok: false, motivo: 'vacío' };
                return { ok: true, pasos: pasos };
            }

            // ── Resolución: solo funciones propias de la app ─────────────────────
            function _esNativa(f) {
                try { return /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(f)); } catch (e) { return true; }
            }
            /** resolver(ruta) → { fn, contexto } | null. Rechaza nativas y nombres prohibidos. */
            function resolver(ruta) {
                var o = (typeof window !== 'undefined') ? window : null, ctx = null;
                if (!o) return null;
                for (var i = 0; i < ruta.length; i++) {
                    var k = ruta[i];
                    if (PROHIBIDOS[k]) return null;
                    if (!Object.prototype.hasOwnProperty.call(o, k)) return null;
                    ctx = o; o = o[k];
                    if (o === null || (typeof o !== 'object' && typeof o !== 'function')) return null;
                }
                if (typeof o !== 'function' || _esNativa(o)) return null;
                return { fn: o, contexto: ctx };
            }

            // ── Ejecución ────────────────────────────────────────────────────────
            function _valor(a, el, ev) {
                switch (a.t) {
                    case 'lit': return a.v;
                    case 'event': return ev;
                    case 'this': return el;
                    case 'this.value': return el ? el.value : undefined;
                    case 'this.checked': return el ? el.checked : undefined;
                    case 'attr': return el && el.getAttribute ? el.getAttribute(a.v) : null;
                }
            }
            var _cache = {};
            function _analizar(texto) { return _cache[texto] || (_cache[texto] = parsear(texto)); }

            /** Ejecuta un manejador ya analizado. Devuelve { ok, detuvo, cancelo, motivo }. */
            function ejecutar(texto, el, ev) {
                var an = _analizar(texto);
                if (!an.ok) return { ok: false, motivo: an.motivo };
                var r = { ok: true, detuvo: false, cancelo: false };
                // Se resuelve TODO antes de ejecutar nada: o se ejecuta completo o no se ejecuta.
                var llamadas = [];
                for (var i = 0; i < an.pasos.length; i++) {
                    var s = an.pasos[i];
                    if (s.t === 'call') {
                        var f = resolver(s.ruta);
                        if (!f) return { ok: false, motivo: 'función no disponible: ' + s.ruta.join('.') };
                        llamadas.push(f);
                    } else llamadas.push(null);
                }
                for (var j = 0; j < an.pasos.length; j++) {
                    var p = an.pasos[j];
                    if (p.t === 'prevent') { if (ev && ev.preventDefault) ev.preventDefault(); r.cancelo = true; }
                    else if (p.t === 'stop') { r.detuvo = true; }
                    else if (p.t === 'retfalse') { if (ev && ev.preventDefault) ev.preventDefault(); r.cancelo = true; }
                    else {
                        var args = p.args.map(function(a) { return _valor(a, el, ev); });
                        llamadas[j].fn.apply(llamadas[j].contexto, args);
                    }
                }
                return r;
            }

            // ── Modo ─────────────────────────────────────────────────────────────
            var _modo = null, _probando = false;
            function _detectarModo() {
                if (_modo) return _modo;
                if (typeof document === 'undefined') return (_modo = 'sombra');
                // 1) Si el meta CSP de la página YA prohíbe los manejadores en línea, no hace falta probar nada: dos
                //    políticas se SUMAN en restricción (una cabecera no puede aflojar al meta), así que es seguro
                //    y evita el aviso que la sonda dejaría en la consola.
                var meta = document.querySelector && document.querySelector('meta[http-equiv="Content-Security-Policy"]');
                var pol = meta ? (meta.getAttribute('content') || '') : '';
                var script = (/script-src\s+([^;]*)/.exec(pol) || [])[1] || '';
                if (pol && script && !/'unsafe-inline'/.test(script)) return (_modo = 'activo');
                // 2) Si el meta lo permite (o no hay meta), una cabecera HTTP podría prohibirlo: se PRUEBA de verdad.
                //    Cuando el navegador lo permite la sonda no deja rastro.
                try {
                    _probando = true;   // el clic de la sonda también pasa por el despachador: no se re-entra
                    window.__cspSonda = 0;
                    var d = document.createElement('div');
                    d.setAttribute('onclick', 'window.__cspSonda = 1');
                    (document.body || document.documentElement).appendChild(d);
                    d.click();
                    (document.body || document.documentElement).removeChild(d);
                    _modo = window.__cspSonda === 1 ? 'sombra' : 'activo';
                    try { delete window.__cspSonda; } catch (e) { window.__cspSonda = undefined; }
                } catch (e) { _modo = 'sombra'; }
                _probando = false;
                return _modo;
            }

            // ── Telemetría de la «sombra» (solo en el aparato) ───────────────────
            //  Lo NORMAL (el manejador se entiende) solo suma a un contador EN MEMORIA: no escribe nada en el
            //  aparato. Solo cuando algo NO se entiende se guarda (localStorage), porque es justo lo que hay que
            //  poder revisar antes de quitar 'unsafe-inline'. Así abrir una pantalla o exportar sigue sin
            //  escribir nada, como exigen las pruebas de «solo lectura» de la app.
            var LS = 'inventarioApp_cspSombra';
            var _n = 0;
            function _anotar(texto, motivo) {
                _n++;
                if (!motivo) return;
                try {
                    var d = JSON.parse(localStorage.getItem(LS) || '{}');
                    d.fallos = d.fallos || {};
                    var k = String(texto).slice(0, 120);
                    if (d.fallos[k] || Object.keys(d.fallos).length < 25) d.fallos[k] = { n: ((d.fallos[k] || {}).n || 0) + 1, m: String(motivo).slice(0, 80) };
                    localStorage.setItem(LS, JSON.stringify(d));
                } catch (e) { /* sin almacenamiento: no pasa nada */ }
            }

            // ── Escucha en el documento ──────────────────────────────────────────
            function _manejar(ev) {
                var attr = EVENTOS[ev.type];
                if (!attr || _probando) return;
                var modo = _detectarModo();
                var el = ev.target && ev.target.nodeType === 1 ? ev.target : (ev.target && ev.target.parentElement);
                for (; el && el !== document; el = el.parentElement) {
                    var texto = el.getAttribute && el.getAttribute(attr);
                    if (texto === null || texto === undefined || texto === '') continue;
                    if (modo === 'sombra') {
                        // Solo verifica: el navegador ya ejecuta el manejador por su cuenta.
                        var an = _analizar(texto), faltante = null;
                        if (!an.ok) faltante = an.motivo;
                        else for (var i = 0; i < an.pasos.length; i++) if (an.pasos[i].t === 'call' && !resolver(an.pasos[i].ruta)) { faltante = 'función no disponible: ' + an.pasos[i].ruta.join('.'); break; }
                        _anotar(texto, faltante);
                        continue;
                    }
                    var res = ejecutar(texto, el, ev);
                    if (!res.ok) {
                        _anotar(texto, res.motivo);
                        if (typeof console !== 'undefined') console.warn('[CSP] Manejador no soportado (' + attr + '): ' + res.motivo + ' → ' + String(texto).slice(0, 80));
                        continue;
                    }
                    if (res.detuvo) { if (ev.stopPropagation) ev.stopPropagation(); break; }   // como un manejador en línea: no sigue hacia los padres ni hacia otros oyentes
                }
            }

            // v5.53 — Orden de ejecución IGUAL al de un manejador en línea. Un atributo onclick="" corre en la
            // fase de BURBUJA del propio elemento: si un oyente anterior (p. ej. uno en captura del document, o uno de un
            // contenedor) llama a stopPropagation(), los manejadores de los padres NO corren. Ejecutarlos desde la captura
            // del document rompía eso (el ⋮ del Recetario abría además la ficha de la tarjeta). Por eso, durante la captura
            // solo se ENGANCHA, en cada elemento con atributo, un oyente de burbuja de un solo evento; el navegador lo
            // invoca en su turno y respeta stopPropagation / eventos que no burbujean, tal como con el atributo.
            function _alCapturar(ev) {
                var attr = EVENTOS[ev.type];
                if (!attr || _probando) return;
                if (_detectarModo() === 'sombra') { _manejar(ev); return; }   // solo verifica: el navegador ejecuta el atributo
                var enganchados = [];
                var limpiar = function() { enganchados.forEach(function(x) { x.el.removeEventListener(ev.type, x.fn, false); }); enganchados = []; };
                var el = ev.target && ev.target.nodeType === 1 ? ev.target : (ev.target && ev.target.parentElement);
                for (; el && el !== document; el = el.parentElement) {
                    if (!el.getAttribute) continue;
                    var t0 = el.getAttribute(attr);
                    if (t0 === null || t0 === undefined || t0 === '') continue;
                    (function(nodo) {
                        var fn = function(ev2) {
                            nodo.removeEventListener(ev.type, fn, false);
                            if (ev2 !== ev) return;
                            var texto = nodo.getAttribute(attr);
                            if (texto === null || texto === undefined || texto === '') return;
                            var res = ejecutar(texto, nodo, ev);
                            if (!res.ok) {
                                _anotar(texto, res.motivo);
                                if (typeof console !== 'undefined') console.warn('[CSP] Manejador no soportado (' + attr + '): ' + res.motivo + ' → ' + String(texto).slice(0, 80));
                                return;
                            }
                            if (res.detuvo && ev.stopPropagation) ev.stopPropagation();
                        };
                        nodo.addEventListener(ev.type, fn, false);
                        enganchados.push({ el: nodo, fn: fn });
                    })(el);
                }
                // Si algún oyente detuvo la propagación antes de llegar a un elemento, su escucha no se usó: se retira.
                if (enganchados.length) setTimeout(limpiar, 0);
            }

            // Teclado: las tarjetas que son role="button" se activan con Enter o Espacio. Antes lo hacía un
            // onkeydown en línea; ahora basta marcar el elemento con data-activar-teclado (no es un manejador
            // en línea, así que funciona igual con o sin 'unsafe-inline'): se convierte en un clic.
            function _teclado(ev) {
                // Enter dentro de un campo de texto → pulsa el botón indicado (solo por id: #algo). Reemplaza un
                // onkeydown en línea que llamaba a la misma función que ese botón.
                if (ev.key === 'Enter' && ev.target && ev.target.getAttribute) {
                    var sel = ev.target.getAttribute('data-enter-click');
                    if (sel && /^#[\w-]+$/.test(sel)) {
                        var b = document.querySelector(sel);
                        if (b) { ev.preventDefault(); b.click(); }
                        return;
                    }
                }
                if (ev.key !== 'Enter' && ev.key !== ' ') return;
                var t = ev.target && ev.target.closest ? ev.target.closest('[data-activar-teclado]') : null;
                if (!t || ev.target !== t) return;   // solo si el foco está en el propio elemento (no en un botón o campo de dentro)
                ev.preventDefault();
                t.click();
            }

            function iniciar() {
                if (typeof document === 'undefined' || !document.addEventListener || iniciar._hecho) return;
                iniciar._hecho = true;
                // FASE DE CAPTURA solo para ENGANCHAR (ver _alCapturar): así también se atienden los eventos que no
                // burbujean (un change/input disparado por código con bubbles:false SÍ llegaba a un manejador en línea,
                // que está en el propio elemento) y el orden/stopPropagation es el del navegador.
                Object.keys(EVENTOS).forEach(function(tipo) { document.addEventListener(tipo, _alCapturar, true); });
                document.addEventListener('keydown', _teclado, false);
            }

            return {
                parsear: parsear, resolver: resolver, ejecutar: ejecutar, iniciar: iniciar,
                modo: function() { return _detectarModo(); },
                // { n: manejadores revisados en esta sesión, fallos?: { texto: {n, m} } (persistentes en el aparato) }
                resumen: function() { var d = {}; try { d = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { d = {}; } d.n = _n; return d; },
                _manejar: _manejar, _alCapturar: _alCapturar, _EVENTOS: EVENTOS
            };
        })();
        if (typeof window !== 'undefined') { window.CspDespachador = CspDespachador; CspDespachador.iniciar(); }
