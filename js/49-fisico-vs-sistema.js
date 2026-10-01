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
         * Suma, para un producto, lo que el agregado admin en vivo lleva en
         * TODAS las áreas del inventario en curso, convirtiendo botellas
         * abiertas a puntos con la misma fórmula que usa el resto de la app.
         *
         * Devuelve null si nadie ha contado ese producto en ninguna área
         * todavía (no 0 — ver nota de cabecera).
         */
        function fvsConteoFisicoProducto(prodId) {
            if (typeof auditoriaConteo === 'undefined' || !auditoriaConteo || !auditoriaConteo[prodId]) return null;
            var areasC = (typeof AREAS_CONTEO !== 'undefined' && AREAS_CONTEO.length) ? AREAS_CONTEO : ['almacen', 'barra1', 'barra2'];
            var product = (typeof products !== 'undefined' && Array.isArray(products))
                ? products.find(function(p) { return p.id === prodId; }) : null;
            var tocado = false;
            var total = 0;
            areasC.forEach(function(area) {
                var d = auditoriaConteo[prodId][area];
                if (!d) return;
                tocado = true;
                var enteras = d.enteras || 0;
                var suma = 0;
                if (product && typeof tieneConversion === 'function' && tieneConversion(product)) {
                    (d.abiertas || []).forEach(function(oz) {
                        suma += convertirOzAPuntos(oz, product.capacidadMl, product.pesoBotellaLlenaOz);
                    });
                } else {
                    (d.abiertas || []).forEach(function(v) { suma += (v || 0); });
                }
                total += enteras + suma;
            });
            if (!tocado) return null;
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
            var ent = (typeof existenciaEntradasSemana === 'function') ? existenciaEntradasSemana() : {};
            var ven = (typeof existenciaVentasSemana   === 'function') ? existenciaVentasSemana()   : {};
            var tol = (typeof EXISTENCIA_TOLERANCIA === 'number') ? EXISTENCIA_TOLERANCIA : 0.001;
            var redondear = (typeof _existenciaRedondear === 'function')
                ? _existenciaRedondear
                : function(n) { return Math.round((Number(n) || 0) * 1000) / 1000; };

            var filas = [];
            var pendientes = 0, sinInicial = 0;
            var totalNeto = 0, totalFaltante = 0, totalSobrante = 0;

            (typeof products !== 'undefined' && Array.isArray(products) ? products : []).forEach(function(p) {
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
                        origenSistema: origen
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
                    origenSistema: origen
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
