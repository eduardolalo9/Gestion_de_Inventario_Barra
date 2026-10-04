        // ═════════════════════════════════════════════════════════════════════
        //  FASE 6 — MOTOR DE BÚSQUEDA (puro: sin DOM, sin Firestore, sin estado
        //  de la app)
        //  ───────────────────────────────────────────────────────────────────
        //  Reemplaza a las tres copias de puntuación difusa que existían
        //  (_csFuzzyMatch, _csFuzzyMatchOrder, _csFuzzyMatchInventario). Las
        //  tres normalizaban TODOS los campos de TODOS los productos en CADA
        //  búsqueda, y las tres aplicaban tolerancia a errores también a los
        //  códigos: buscar "1180015" devolvía el producto correcto... y otros
        //  ~1200 con códigos parecidos (medido contra un catálogo de 2000).
        //
        //  Decisiones:
        //   1. El índice por elemento se guarda en un WeakMap, con una "firma"
        //      (los valores crudos concatenados). Si el producto cambia —se
        //      edita, llega una versión nueva de Firestore— la firma cambia y
        //      se vuelve a indexar SOLO ese elemento. No hace falta avisarle al
        //      motor de nada: no hay invalidación manual que se pueda olvidar.
        //   2. La tolerancia a errores es un RESPALDO, no la regla: solo entra
        //      para una palabra que no coincide exactamente con nada en toda la
        //      lista. "anejo" encuentra "AÑEJO" sin ruido; "reposdo" (typo)
        //      encuentra "REPOSADO" porque nada contiene "reposdo".
        //   3. Los campos marcados `codigo` (id, SKU, PV) nunca usan difuso: un
        //      código se acierta o no. Coincidencia exacta de código va primero.
        //   4. Todas las palabras de la consulta tienen que aparecer (Y lógico).
        //   5. Sin dependencias. Fuse.js resolvería lo mismo con ~24 KB más y
        //      sin la regla 2 ni la 3, que son las que importan en una barra.
        // ═════════════════════════════════════════════════════════════════════

        var BUSQUEDA_MAX_TOKENS       = 8;     // una consulta pegada de un Excel no congela la app
        var BUSQUEDA_MAX_LARGO_TOKEN  = 40;
        var BUSQUEDA_UMBRAL_DIFUSO    = 0.45;  // mismo umbral que tenía el motor anterior
        var BUSQUEDA_MIN_LARGO_DIFUSO = 3;

        // Caché global de bigramas por palabra. El vocabulario de un catálogo de
        // barra es pequeño (marcas, tipos, tamaños se repiten), así que cada
        // palabra se descompone una sola vez aunque aparezca en 300 productos.
        var _busqBigramas = new Map();

        /**
         * Normaliza un carácter o texto corto: minúsculas y sin diacríticos.
         * "Añejo" → "anejo". La ñ se trata como n a propósito: en un teléfono
         * nadie escribe la ñ para buscar.
         */
        function _busqNormChar(c) {
            return c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        }

        /**
         * Normaliza un texto y devuelve, además, a qué posición del texto
         * ORIGINAL corresponde cada carácter del normalizado. Ese mapa es lo que
         * permite resaltar "Añejo" cuando se buscó "anejo" (el resaltado viejo
         * no podía: buscaba la consulta tal cual sobre el nombre con acentos).
         *
         * Reglas: letras y dígitos se conservan; el punto solo entre dígitos
         * (para "1.75"); todo lo demás es un separador (espacio).
         */
        function _busqMapear(texto) {
            var s = texto == null ? '' : String(texto);
            var norm = '';
            var mapa = [];
            var i = 0;
            for (var cp of s) {                       // por punto de código: no parte emojis
                var n = _busqNormChar(cp);
                for (var k = 0; k < n.length; k++) {
                    var ch = n[k];
                    var esAlnum = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
                    if (!esAlnum) {
                        var ant = s[i - 1], sig = s[i + cp.length];
                        var puntoDecimal = ch === '.' && ant >= '0' && ant <= '9' && sig >= '0' && sig <= '9';
                        if (!puntoDecimal) ch = ' ';
                    }
                    norm += ch;
                    mapa.push(i);
                }
                i += cp.length;
            }
            return { norm: norm, mapa: mapa, largoOriginal: s.length };
        }

        /** Texto normalizado, con espacios colapsados. */
        function normalizarBusqueda(texto) {
            return _busqMapear(texto).norm.replace(/\s+/g, ' ').trim();
        }

        /** Divide una consulta en palabras normalizadas, sin repetidas. */
        function tokenizarBusqueda(consulta) {
            var norm = normalizarBusqueda(consulta);
            if (!norm) return [];
            var vistos = new Set();
            var out = [];
            norm.split(' ').forEach(function(t) {
                if (!t) return;
                t = t.slice(0, BUSQUEDA_MAX_LARGO_TOKEN);
                if (vistos.has(t)) return;
                vistos.add(t);
                out.push(t);
            });
            // Si una palabra es prefijo de otra ("don" y "donjulio"), la corta no
            // aporta nada: la larga ya la exige. Se quitan para no puntuar doble.
            out = out.filter(function(t) {
                return !out.some(function(o) { return o !== t && o.length > t.length && o.indexOf(t) === 0; });
            });
            return out.slice(0, BUSQUEDA_MAX_TOKENS);
        }

        function _busqEsNumerico(t) { return /^[0-9.]+$/.test(t); }

        function _busqBigramasDe(palabra) {
            var b = _busqBigramas.get(palabra);
            if (b) return b;
            b = new Set();
            for (var i = 0; i < palabra.length - 1; i++) b.add(palabra.slice(i, i + 2));
            // Tope de memoria: un catálogo real no se acerca, pero un historial
            // de pedidos de años podría. Vaciar es más simple que un LRU y el
            // costo de reconstruir es de milisegundos.
            if (_busqBigramas.size > 20000) _busqBigramas.clear();
            _busqBigramas.set(palabra, b);
            return b;
        }

        /** Coeficiente de Dice entre dos palabras (0..1). */
        function _busqSimilitud(a, b) {
            var ba = _busqBigramasDe(a), bb = _busqBigramasDe(b);
            if (!ba.size || !bb.size) return 0;
            var comunes = 0;
            ba.forEach(function(x) { if (bb.has(x)) comunes++; });
            return (2 * comunes) / (ba.size + bb.size);
        }

        /**
         * Crea un motor de búsqueda para un tipo de elemento.
         *
         * @param {Object}   config
         * @param {Array}    config.claves  [{ nombre, peso=1, codigo=false, obtener(item) }]
         *                   `obtener` es opcional; si falta se lee item[nombre].
         * @param {number}  [config.umbralDifuso]
         * @returns {{ buscar: Function, config: Object }}
         *
         * buscar(lista, consulta, { filtro }) →
         *   { items, total, coincidencias, tokens, difusos, ms }
         *   - total: cuántos pasan el filtro (lo que se está buscando "de").
         *   - items: los que coinciden, del más relevante al menos; empates
         *     conservan el orden original de la lista.
         */
        function crearMotorBusqueda(config) {
            var claves = (config && config.claves || []).map(function(c) {
                return {
                    nombre: c.nombre,
                    peso:   typeof c.peso === 'number' ? c.peso : 1,
                    codigo: !!c.codigo,
                    obtener: typeof c.obtener === 'function'
                        ? c.obtener
                        : function(item) { return item == null ? '' : item[c.nombre]; }
                };
            });
            var umbral = (config && typeof config.umbralDifuso === 'number')
                ? config.umbralDifuso : BUSQUEDA_UMBRAL_DIFUSO;
            var cache = new WeakMap();

            function _valorCrudo(clave, item) {
                var v;
                try { v = clave.obtener(item); } catch (_) { v = ''; }
                return v == null ? '' : String(v);
            }

            function _indexar(item) {
                var crudos = claves.map(function(c) { return _valorCrudo(c, item); });
                var firma = crudos.join('\u0001');
                var cacheable = item !== null && typeof item === 'object';
                var hit = cacheable ? cache.get(item) : null;
                if (hit && hit.firma === firma) return hit;
                var campos = crudos.map(function(v, i) {
                    var norm = normalizarBusqueda(v);
                    return {
                        norm:    norm,
                        palabras: norm ? norm.split(' ') : [],
                        peso:    claves[i].peso,
                        codigo:  claves[i].codigo
                    };
                });
                var idx = { firma: firma, campos: campos };
                if (cacheable) cache.set(item, idx);
                return idx;
            }

            // Puntaje exacto de UNA palabra contra UN elemento. 0 = no aparece.
            function _puntajeExacto(idx, t) {
                var mejor = 0;
                var num = _busqEsNumerico(t);
                for (var f = 0; f < idx.campos.length; f++) {
                    var c = idx.campos[f];
                    if (!c.norm) continue;
                    var p = 0;
                    if (c.codigo) {
                        // Un código completo escrito tal cual gana a todo lo demás.
                        if (c.norm === t) p = 100;
                        else if (c.norm.indexOf(t) === 0) p = 40;
                        else if (c.norm.indexOf(t) !== -1) p = 15;
                    } else {
                        for (var w = 0; w < c.palabras.length; w++) {
                            var pal = c.palabras[w];
                            var pw = 0;
                            if (pal === t) pw = 12;
                            else if (pal.indexOf(t) === 0) pw = 9;
                            else if (!num && pal.indexOf(t) !== -1) pw = 5;
                            if (pw > p) p = pw;
                            if (p === 12) break;
                        }
                    }
                    p *= c.peso;
                    if (p > mejor) mejor = p;
                }
                return mejor;
            }

            // Respaldo tolerante a errores: solo campos de texto, nunca códigos.
            function _puntajeDifuso(idx, t) {
                var mejor = 0;
                for (var f = 0; f < idx.campos.length; f++) {
                    var c = idx.campos[f];
                    if (c.codigo || !c.norm) continue;
                    for (var w = 0; w < c.palabras.length; w++) {
                        var pal = c.palabras[w];
                        if (pal.length < 2 || Math.abs(pal.length - t.length) > 3) continue;
                        var sim = _busqSimilitud(t, pal);
                        if (sim >= umbral) {
                            var p = Math.max(1, Math.round(sim * 5)) * c.peso;
                            if (p > mejor) mejor = p;
                        }
                    }
                }
                return mejor;
            }

            function buscar(lista, consulta, opciones) {
                var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                var filtro = opciones && typeof opciones.filtro === 'function' ? opciones.filtro : null;
                var base = [];
                var arr = Array.isArray(lista) ? lista : [];
                for (var i = 0; i < arr.length; i++) {
                    var it = arr[i];
                    if (it == null) continue;
                    if (filtro && !filtro(it)) continue;
                    base.push(it);
                }
                var tokens = tokenizarBusqueda(consulta);
                if (!tokens.length) {
                    return { items: base, total: base.length, coincidencias: base.length,
                             tokens: [], difusos: [], ms: 0 };
                }

                var idxs = base.map(_indexar);
                var puntajes = new Array(base.length).fill(0);
                var vivos = new Array(base.length).fill(true);
                var difusos = [];

                // Frase completa: premia que las palabras aparezcan juntas y en
                // orden en un campo ("don julio" sobre "DON JULIO 70").
                var frase = tokens.join(' ');

                for (var ti = 0; ti < tokens.length; ti++) {
                    var t = tokens[ti];
                    var parcial = new Array(base.length).fill(0);
                    var aciertos = 0;
                    for (var j = 0; j < base.length; j++) {
                        if (!vivos[j]) continue;
                        var p = _puntajeExacto(idxs[j], t);
                        parcial[j] = p;
                        if (p > 0) aciertos++;
                    }
                    // Ninguna coincidencia exacta en toda la lista → typo probable.
                    if (aciertos === 0 && t.length >= BUSQUEDA_MIN_LARGO_DIFUSO && !_busqEsNumerico(t)) {
                        difusos.push(t);
                        for (var j2 = 0; j2 < base.length; j2++) {
                            if (!vivos[j2]) continue;
                            parcial[j2] = _puntajeDifuso(idxs[j2], t);
                        }
                    }
                    for (var j3 = 0; j3 < base.length; j3++) {
                        if (!vivos[j3]) continue;
                        if (parcial[j3] === 0) { vivos[j3] = false; continue; }
                        puntajes[j3] += parcial[j3];
                    }
                }

                var salida = [];
                for (var k = 0; k < base.length; k++) {
                    if (!vivos[k]) continue;
                    var bonus = 0;
                    if (tokens.length > 1) {
                        var cs = idxs[k].campos;
                        for (var f = 0; f < cs.length; f++) {
                            if (!cs[f].codigo && cs[f].norm.indexOf(frase) !== -1) {
                                bonus = Math.max(bonus, 8 * cs[f].peso);
                            }
                        }
                    }
                    salida.push({ item: base[k], p: puntajes[k] + bonus, o: k });
                }
                // Orden estable explícito: el motor no depende de que el sort
                // del navegador lo sea.
                salida.sort(function(a, b) { return (b.p - a.p) || (a.o - b.o); });

                var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                return {
                    items: salida.map(function(x) { return x.item; }),
                    total: base.length,
                    coincidencias: salida.length,
                    tokens: tokens,
                    difusos: difusos,
                    ms: Math.round((t1 - t0) * 100) / 100
                };
            }

            /** Indexa por adelantado (p. ej. al enfocar el buscador, en tiempo ocioso). */
            function indexar(lista) {
                (Array.isArray(lista) ? lista : []).forEach(function(it) { if (it != null) _indexar(it); });
            }

            return { buscar: buscar, indexar: indexar, config: { claves: claves, umbralDifuso: umbral } };
        }

        // Alias con el nombre pedido en la especificación.
        var createSearchEngine = crearMotorBusqueda;

        /**
         * Devuelve `texto` como HTML seguro con las coincidencias de `consulta`
         * envueltas en <mark class="sb-mark">.
         *
         * Escapa cada tramo POR SEPARADO, después de ubicar las coincidencias
         * sobre el texto crudo. El resaltado anterior escapaba primero y luego
         * buscaba con regex sobre el HTML: buscar "amp" en "RON & COLA" metía
         * la marca dentro de "&amp;" y rompía la entidad en pantalla.
         */
        function resaltarBusqueda(texto, consulta) {
            var s = texto == null ? '' : String(texto);
            var esc = function(x) {
                return x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            };
            var tokens = tokenizarBusqueda(consulta);
            if (!s || !tokens.length) return esc(s);
            // Una sola letra resalta media pantalla: solo si es lo único escrito.
            if (tokens.length > 1) tokens = tokens.filter(function(t) { return t.length >= 2; });
            var m = _busqMapear(s);
            var rangos = [];
            tokens.forEach(function(t) {
                var desde = 0, pos;
                while ((pos = m.norm.indexOf(t, desde)) !== -1) {
                    var ini = m.mapa[pos];
                    var ultimo = pos + t.length - 1;
                    var fin = (ultimo + 1 < m.mapa.length) ? m.mapa[ultimo + 1] : m.largoOriginal;
                    // Si el último carácter normalizado viene de un carácter
                    // original que produjo varios (raro), se cubre completo.
                    if (fin <= ini) fin = ini + 1;
                    rangos.push([ini, fin]);
                    desde = pos + t.length;
                }
            });
            if (!rangos.length) return esc(s);
            rangos.sort(function(a, b) { return a[0] - b[0]; });
            var unidos = [rangos[0].slice()];
            for (var r = 1; r < rangos.length; r++) {
                var u = unidos[unidos.length - 1];
                if (rangos[r][0] <= u[1]) u[1] = Math.max(u[1], rangos[r][1]);
                else unidos.push(rangos[r].slice());
            }
            var out = '', cursor = 0;
            unidos.forEach(function(g) {
                out += esc(s.slice(cursor, g[0])) + '<mark class="sb-mark">' + esc(s.slice(g[0], g[1])) + '</mark>';
                cursor = g[1];
            });
            return out + esc(s.slice(cursor));
        }
