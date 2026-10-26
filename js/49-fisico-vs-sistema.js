        // ═════════════════════════════════════════════════════════════════════
        //  FASE 11B (parte 1) — FÍSICO VS SISTEMA
        //  ───────────────────────────────────────────────────────────────────
        //  Decisión de Eduardo (1-oct-2026): la desviación se compara contra
        //  el conteo físico del inventario EN CURSO (estado SINCRONIZADO,
        //  sumando todas las áreas), no contra el histórico de un inventario
        //  ya cerrado. Esta capa responde eso: "con lo que llevamos contado
        //  hasta ahora, ¿qué dice el sistema que debería haber?"
        //
        //  Capa de cálculo pura: no pinta, no escribe, no decide permisos.
        //  Reutiliza dos motores que ya existen y ya están probados:
        //
        //    · El conteo físico en vivo         → auditoriaConteo
        //      (45-inventario-datos.js, _recalcAdminAggregatedConteo). Ya
        //      resuelve conflictos entre contadores exactamente como el
        //      cierre lo hace (admin gana; si no, el más reciente).
        //    · El stock de sistema               → existenciaOficial()
        //      (47-existencia.js, FASE 8/11A). Ya distingue con honestidad
        //      si el número es el oficial (inicial + compras − consumo
        //      teórico) o un respaldo operativo porque todavía no hay
        //      inicial contabilizado para esta semana.
        //
        //  UN PUNTO QUE NO SE PUEDE PERDER: "nadie ha contado este producto
        //  todavía" y "se contó y dio cero" son dos hechos distintos. Esta
        //  capa nunca los mezcla — devuelve null para el primer caso, nunca
        //  0. Tratar lo no contado como 0 inventaría una diferencia falsa en
        //  cada producto que todavía no le toca a nadie contar.
        // ═════════════════════════════════════════════════════════════════════

        /**
         * v5.27 — lo contado de un producto, ÁREA POR ÁREA (la tarjeta de
         * Físico vs Sistema muestra cada almacén, como la del reconteo).
         * Devuelve { tocado, areas: { area: { enteras, abiertas, total } | null } }.
         * Un área sin dato es null (no {0}): misma regla de la cabecera.
         */
        function fvsConteoPorArea(prodId) {
            var areasC = (typeof AREAS_CONTEO !== 'undefined' && AREAS_CONTEO.length) ? AREAS_CONTEO : ['almacen', 'barra1', 'barra2'];
            var out = { tocado: false, areas: {} };
            var reg = (typeof auditoriaConteo !== 'undefined' && auditoriaConteo) ? auditoriaConteo[prodId] : null;
            var product = (typeof products !== 'undefined' && Array.isArray(products))
                ? products.find(function(p) { return p.id === prodId; }) : null;
            var botella = !!(product && typeof tieneConversion === 'function' && tieneConversion(product));
            areasC.forEach(function(area) {
                var d = reg ? reg[area] : null;
                if (!d) { out.areas[area] = null; return; }
                out.tocado = true;
                var enteras = d.enteras || 0;
                var suma = 0;
                (d.abiertas || []).forEach(function(v) {
                    suma += botella ? convertirOzAPuntos(v, product.capacidadMl, product.pesoBotellaLlenaOz) : (v || 0);
                });
                out.areas[area] = {
                    enteras:  enteras,
                    abiertas: Array.isArray(d.abiertas) ? d.abiertas.slice() : [],
                    total:    Math.round((enteras + suma) * 1000) / 1000
                };
            });
            return out;
        }

        /**
         * Suma, para un producto, lo que el agregado admin en vivo lleva en
         * TODAS las áreas del inventario en curso, convirtiendo botellas
         * abiertas a puntos con la misma fórmula que usa el resto de la app.
         *
         * Devuelve null si nadie ha contado ese producto en ninguna área
         * todavía (no 0 — ver nota de cabecera).
         */
        function fvsConteoFisicoProducto(prodId) {
            var r = fvsConteoPorArea(prodId);
            if (!r.tocado) return null;
            var total = 0;
            Object.keys(r.areas).forEach(function(a) { if (r.areas[a]) total += r.areas[a].total; });
            return Math.round(total * 1000) / 1000;
        }

        /**
         * Tabla completa "Físico vs Sistema" para el inventario abierto.
         * Devuelve null si no hay un inventario en estado SINCRONIZADO.
         *
         * Cada fila:
         *   { id, nombre, estado: 'contado'|'pendiente',
         *     fisico, sistema, diferencia, neto, origenSistema }
         *
         *   diferencia = físico − sistema   (mismo signo que tu Excel:
         *                negativo = faltante, positivo = sobrante)
         *   neto       = diferencia × precio del producto
         *   origenSistema: 'oficial' | 'operativo_no_reconciliado'
         *
         * Las filas 'pendiente' llevan fisico/diferencia/neto en null: no
         * hay nada que comparar todavía, y no es lo mismo que una diferencia
         * de cero.
         */
        function fisicoVsSistemaCalcular() {
            if (typeof _inventarioActivo === 'undefined' || !_inventarioActivo
                || typeof inventarioAbierto !== 'function' || !inventarioAbierto(_inventarioActivo)) {
                return null;
            }
            // FASE 14 — las entradas y el consumo que dicta la ruta vigente del
            // Total (arrastre desde el ancla o, sin ancla, la semana en curso):
            // el mismo número que muestra el catálogo.
            var ent = (typeof existenciaEntradas === 'function') ? existenciaEntradas()
                    : ((typeof existenciaEntradasSemana === 'function') ? existenciaEntradasSemana() : {});
            var ven = (typeof existenciaVentas === 'function') ? existenciaVentas()
                    : ((typeof existenciaVentasSemana   === 'function') ? existenciaVentasSemana()   : {});
            var tol = (typeof EXISTENCIA_TOLERANCIA === 'number') ? EXISTENCIA_TOLERANCIA : 0.001;
            var redondear = (typeof _existenciaRedondear === 'function')
                ? _existenciaRedondear
                : function(n) { return Math.round((Number(n) || 0) * 1000) / 1000; };

            var filas = [];
            var pendientes = 0, sinInicial = 0;
            var totalNeto = 0, totalFaltante = 0, totalSobrante = 0;

            (typeof products !== 'undefined' && Array.isArray(products) ? products : []).forEach(function(p) {
                var porArea = fvsConteoPorArea(p.id);
                var fisico = fvsConteoFisicoProducto(p.id);
                var r = (typeof existenciaOficial === 'function') ? existenciaOficial(p, ent, ven) : null;
                var sistema = redondear(r ? r.valor : 0);
                var origen  = r ? r.origen : 'operativo_no_reconciliado';
                if (!r || !r.hayInicial) sinInicial++;

                if (fisico === null) {
                    pendientes++;
                    filas.push({
                        id: p.id, nombre: p.name || p.id, estado: 'pendiente',
                        fisico: null, sistema: sistema, diferencia: null, neto: null,
                        origenSistema: origen,
                        grupo: p.group || 'General', unidad: p.unit || '', areas: porArea.areas
                    });
                    return;
                }

                var precio = (typeof p.precio === 'number') ? p.precio : 0;
                var dif  = redondear(fisico - sistema);
                var neto = Math.round(dif * precio * 100) / 100;
                totalNeto += neto;
                if (dif < -tol) totalFaltante += dif;
                if (dif >  tol) totalSobrante += dif;

                filas.push({
                    id: p.id, nombre: p.name || p.id, estado: 'contado',
                    fisico: fisico, sistema: sistema, diferencia: dif, neto: neto,
                    origenSistema: origen,
                    grupo: p.group || 'General', unidad: p.unit || '', areas: porArea.areas
                });
            });

            // Diferencias más grandes primero; lo pendiente (sin dato) al final.
            filas.sort(function(a, b) {
                var da = a.diferencia === null ? -1 : Math.abs(a.diferencia);
                var db = b.diferencia === null ? -1 : Math.abs(b.diferencia);
                return db - da;
            });

            return {
                inventoryId:   (typeof _inventarioActivoId !== 'undefined') ? _inventarioActivoId : null,
                numero:        _inventarioActivo.numero || null,
                totalProductos: filas.length,
                contados:      filas.length - pendientes,
                pendientes:    pendientes,
                sinInicial:    sinInicial,
                totalNeto:     Math.round(totalNeto * 100) / 100,
                totalFaltante: redondear(totalFaltante),
                totalSobrante: redondear(totalSobrante),
                filas:         filas
            };
        }

        /**
         * v5.27 — fisicoVsSistemaAgrupar(filas, orden) — capa pura.
         * Pedido de Eduardo (12-oct-2026): "organizar por grupos, por
         * diferencia de menor a mayor". Agrupa por el grupo del catálogo
         * (orden alfabético) y, dentro de cada grupo, ordena lo contado por
         * diferencia: 'menor_mayor' (predeterminado: el faltante más grande
         * primero, el sobrante más grande al final) o 'mayor_menor'. Lo
         * pendiente (sin contar) va al final de su grupo, por nombre.
         * @returns [{ grupo, filas, contados, pendientes, neto }]
         */
        function fisicoVsSistemaAgrupar(filas, orden) {
            var desc = orden === 'mayor_menor';
            var mapa = {};
            (filas || []).forEach(function(f) {
                var g = f.grupo || 'General';
                if (!mapa[g]) mapa[g] = { grupo: g, filas: [], contados: 0, pendientes: 0, neto: 0 };
                mapa[g].filas.push(f);
                if (f.estado === 'pendiente') mapa[g].pendientes++;
                else { mapa[g].contados++; mapa[g].neto += (f.neto || 0); }
            });
            var porNombre = function(a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); };
            return Object.keys(mapa).sort(function(a, b) { return a.localeCompare(b, 'es'); }).map(function(k) {
                var g = mapa[k];
                g.filas.sort(function(a, b) {
                    var pa = a.estado === 'pendiente', pb = b.estado === 'pendiente';
                    if (pa !== pb) return pa ? 1 : -1;
                    if (pa) return porNombre(a, b);
                    var d = desc ? (b.diferencia - a.diferencia) : (a.diferencia - b.diferencia);
                    return d || porNombre(a, b);
                });
                g.neto = Math.round(g.neto * 100) / 100;
                return g;
            });
        }

        // ═════════════════════════════════════════════════════════════════════
        //  v5.35 — FILTRO POR GRUPO Y ORDEN «DIFERENCIAS ↑» (capa pura)
        //  ───────────────────────────────────────────────────────────────────
        //  Solo ORDENAN y FILTRAN copias de las filas que ya calculó
        //  fisicoVsSistemaCalcular(). No recalculan la diferencia, no tocan el
        //  conteo, las existencias ni el orden guardado de products.
        //  La pantalla y el Excel usan la MISMA función de orden
        //  (fisicoVsSistemaOrdenVisible), así el archivo sale en el mismo
        //  orden que se ve.
        // ═════════════════════════════════════════════════════════════════════

        /** ¿La fila tiene una diferencia numérica real? (pendiente / inválida → no) */
        function _fvsTieneDif(f) {
            return !!f && f.estado !== 'pendiente' && typeof f.diferencia === 'number' && isFinite(f.diferencia);
        }

        /** Grupos presentes en las filas, alfabéticos: [{ grupo, n }]. */
        function fisicoVsSistemaGrupos(filas) {
            var cuenta = {};
            (filas || []).forEach(function(f) { var g = f.grupo || 'General'; cuenta[g] = (cuenta[g] || 0) + 1; });
            return Object.keys(cuenta).sort(function(a, b) { return a.localeCompare(b, 'es'); })
                .map(function(g) { return { grupo: g, n: cuenta[g] }; });
        }

        /** Solo las filas de un grupo. Sin grupo (null/'') → todas. Devuelve copia. */
        function fisicoVsSistemaFiltrarGrupo(filas, grupo) {
            var lista = (filas || []).slice();
            if (grupo === null || grupo === undefined || grupo === '') return lista;
            return lista.filter(function(f) { return (f.grupo || 'General') === grupo; });
        }

        /**
         * «Diferencias ↑»: TODAS las filas por diferencia numérica, de menor a
         * mayor (−5, −0.5, 0, 2…). Lo que no tiene diferencia (sin contar o un
         * valor inválido) NO se vuelve 0: va al final, por nombre. Empates por
         * nombre y luego por ID, para que el orden sea siempre el mismo.
         */
        function fisicoVsSistemaOrdenarDifAsc(filas) {
            var porNombre = function(a, b) {
                return String(a.nombre).localeCompare(String(b.nombre), 'es') || String(a.id).localeCompare(String(b.id), 'es');
            };
            return (filas || []).slice().sort(function(a, b) {
                var ca = _fvsTieneDif(a), cb = _fvsTieneDif(b);
                if (ca !== cb) return ca ? -1 : 1;
                if (!ca) return porNombre(a, b);
                return (a.diferencia - b.diferencia) || porNombre(a, b);
            });
        }

        /**
         * Orden visible de Físico vs Sistema, el mismo para pantalla y Excel.
         * op: { grupo, difAsc, orden: 'menor_mayor'|'mayor_menor' }
         * → { modo: 'plano'|'grupos', grupos: [..] (solo en 'grupos'), filas: [en orden] }
         */
        function fisicoVsSistemaOrdenVisible(filas, op) {
            op = op || {};
            var base = fisicoVsSistemaFiltrarGrupo(filas, op.grupo);
            if (op.difAsc) return { modo: 'plano', grupos: null, filas: fisicoVsSistemaOrdenarDifAsc(base) };
            var grupos = fisicoVsSistemaAgrupar(base, op.orden);
            var planas = [];
            grupos.forEach(function(g) { planas.push.apply(planas, g.filas); });
            return { modo: 'grupos', grupos: grupos, filas: planas };
        }

        // ═════════════════════════════════════════════════════════════════════
        //  FASE 11B (parte 2) — PEDIDO SUGERIDO Y NIVELES DE ALERTA
        //  ───────────────────────────────────────────────────────────────────
        //  Autorizado por Eduardo (1-oct-2026). La "parte 2" que el cierre de
        //  FASE 11B dejó explícitamente fuera de alcance.
        //
        //  Fórmula de pedido sugerido verificada CARÁCTER POR CARÁCTER contra
        //  el Excel real de Eduardo (ver claude/verificacion-excel-formato-
        //  barra-2026-09-27.md, hoja `Tabla!O`):
        //      SI(total < stockMínimo, TECHO((stockMínimo − total) / conversión), 0)
        //  Confirmado también por Eduardo con un ejemplo propio (lychees):
        //  (10.68 − 7.52) / 0.567 = 5.57 → se sugieren 6 latas (TECHO, nunca
        //  trunca: pedir de menos nunca es la opción segura).
        //
        //  "total" es, a propósito, EXACTAMENTE la misma cifra que ya decide
        //  "Bajo mínimo" (existenciaMostrada — FASE 8/11A): catálogo, badges,
        //  pedido sugerido y niveles de alerta leen todos un solo número por
        //  producto. Fragmentarlo en varias cifras "parecidas" es justo el
        //  desorden que FASE 8 existe para evitar.
        //
        //  Nunca se inventa una cantidad: sin `product.conversion` numérica
        //  y mayor que 0 no hay forma honesta de traducir un déficit a
        //  unidades de compra (mismo criterio que costoPorUnidadBase /
        //  factorAUnidadProducto en 91-recetario.js — "nunca se adivina un
        //  factor") y se devuelve null, nunca un número adivinado.
        // ═════════════════════════════════════════════════════════════════════

        /**
         * pedidoSugeridoProducto(product, cacheEntradas, cacheVentas)
         * @returns {number|null} null = sin datos para sugerir (sin mínimo o
         *          sin conversión); 0 = no hace falta pedir; N = cantidad a
         *          pedir, en unidades de compra (TECHO, nunca negativo).
         */
        function pedidoSugeridoProducto(product, cacheEntradas, cacheVentas) {
            if (!product || typeof product.stockMinimo !== 'number' || product.stockMinimo <= 0) return null;
            var total = (typeof existenciaMostrada === 'function')
                ? existenciaMostrada(product, cacheEntradas, cacheVentas) : null;
            if (typeof total !== 'number') return null;
            if (total >= product.stockMinimo) return 0;
            if (typeof product.conversion !== 'number' || product.conversion <= 0) return null;
            var deficit = product.stockMinimo - total;
            // Tolerancia de punto flotante HACIA ABAJO antes de TECHO: un
            // déficit que debería dar exactamente 5.0 no puede convertirse en
            // 6 por una cola binaria (5.000000000000001). Nunca al revés:
            // jamás resta una unidad real, solo descarta ruido de coma
            // flotante muy por debajo de la precisión de cualquier báscula.
            return Math.ceil((deficit / product.conversion) - 1e-9);
        }

        /**
         * nivelAlertaProducto(product)
         * ─────────────────────────────────────────────────────────────────
         * Clasifica un producto en el nivel de alerta MÁS SEVERO que aplique,
         * sobre la misma cifra que ya decide "Bajo mínimo". Umbrales
         * confirmados por Eduardo (1-oct-2026):
         *
         *   'bajo'        → total < stockMínimo                     (ya existía — _bajoMinimo)
         *   'advertencia' → total < stockMínimo − (stockMínimo ÷ 3)  (= ⅔ del mínimo)
         *   'limitado'    → total < stockMínimo ÷ 2                  (el más grave)
         *
         * Los tres umbrales están anidados uno dentro de otro
         * (limitado ⊂ advertencia ⊂ bajo: ½ < ⅔ < 1), así que un producto
         * nunca recibe más de un nivel a la vez: esta función siempre
         * devuelve el más severo que aplique, para no apilar tres etiquetas
         * diciendo básicamente lo mismo en la misma tarjeta.
         *
         * NO reemplaza a _bajoMinimo() (js/80-buscador.js): ese sigue siendo
         * el criterio de filtros y contadores ("Bajo mínimo (N)" del chip y
         * del panel). Esta función es solo para decidir QUÉ ETIQUETA mostrar
         * dentro de ese mismo conjunto de productos.
         *
         * @returns {'limitado'|'advertencia'|'bajo'|null}
         */
        function nivelAlertaProducto(product) {
            if (!product || typeof product.stockMinimo !== 'number' || product.stockMinimo <= 0) return null;
            var total = (typeof existenciaMostrada === 'function') ? existenciaMostrada(product) : null;
            if (typeof total !== 'number') return null;
            var min = product.stockMinimo;
            if (total < min / 2) return 'limitado';
            if (total < min - (min / 3)) return 'advertencia';
            if (total < min) return 'bajo';
            return null;
        }
