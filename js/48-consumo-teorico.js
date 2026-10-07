

        // ═════════════════════════════════════════════════════════════════════
        //  FASE 11A — CONSUMO TEÓRICO: RECETARIO × VENTAS
        //  ───────────────────────────────────────────────────────────────────
        //  Capa de cálculo pura: NO pinta, NO escribe, NO toca Firestore. Cruza
        //  dos cosas que ya están en memoria — `recetas` (filtrado a barra, con
        //  su código `pv`) y `ventas` (una semana, sumada por SKU) — y responde
        //  cuánto DEBERÍA haberse consumido de cada insumo.
        //
        //  Es la traducción literal de la cadena del Excel:
        //
        //    Recetas!VENTA   = IF(Almacén="12", SUMIF(Venta!SKU, PV, Venta!Cantidad), 0)
        //    Recetas!CONSUMO = VENTA × Cantidad
        //    Tabla!Venta     = SUMIF(Recetas!Código insumo, Sap, Recetas!CONSUMO)
        //
        //  El filtro de almacén 12 ya se aplicó al importar el recetario
        //  (RECETARIO-2 corregido en FASE 10), así que aquí todas las líneas
        //  que hay son de barra.
        //
        //  SIN CONVERSIÓN DE UNIDADES, igual que el Excel: la cantidad de la
        //  receta ya viene en la unidad de inventario del insumo (0.06 PZA de
        //  una botella). Cuando la UoM de la línea NO es la del insumo, el
        //  número se calcula igual —para no divergir del Excel— pero la línea
        //  se reporta en `avisos` para que una persona la revise. Son 65 líneas
        //  reales de 1,416: una aceituna que se compra en KGS y cuya receta
        //  pide PZA, por ejemplo.
        //
        //  LO QUE NO HACE, a propósito: no decide el stock teórico ni la
        //  desviación ni el pedido sugerido. Solo entrega el consumo. Quien lo
        //  resta es la capa de existencia de FASE 8 (js/47-existencia.js), que
        //  desde entonces tenía reservado exactamente este hueco.
        // ═════════════════════════════════════════════════════════════════════

        function _consumoRedondear(n) {
            var x = Number(n);
            if (!isFinite(x)) return 0;
            return Math.round(x * 1000) / 1000;
        }

        // Memoria de una sola entrada: el cruce se pide una vez por producto al
        // pintar el catálogo (424 veces seguidas en un teléfono de barra). La
        // huella incluye la semana y el tamaño de las dos listas, que es lo que
        // cambia cuando se importa un recetario o unas ventas nuevas.
        var _consumoMemo = { huella: null, resultado: null };

        function _consumoHuella() {
            var nR = (typeof recetas !== 'undefined' && Array.isArray(recetas)) ? recetas.length : -1;
            var nV = (typeof ventas  !== 'undefined' && Array.isArray(ventas))  ? ventas.length  : -1;
            var nP = (typeof products !== 'undefined' && Array.isArray(products)) ? products.length : -1;
            var sem = (typeof ventasSemanaId !== 'undefined') ? ventasSemanaId : null;
            return [sem, nR, nV, nP].join('|');
        }

        /** Olvida el cruce memorizado. Se llama al importar ventas o recetario. */
        function consumoTeoricoInvalidar() {
            _consumoMemo = { huella: null, resultado: null };
        }
        window.consumoTeoricoInvalidar = consumoTeoricoInvalidar;

        /**
         * consumoTeorico()
         * ────────────────
         * Devuelve SIEMPRE un objeto con su procedencia, nunca un mapa suelto:
         *
         *   {
         *     semana,            // semana de las ventas usadas, o null
         *     consumo,           // { productoId: unidades consumidas }
         *     lineasCalculadas,  // cuántas líneas de receta entraron al cálculo
         *     skusVendidos,      // SKU distintos en las ventas
         *     avisos: {
         *       sinReceta:      [ {sku, nombre, cantidad} ],   // se vendió y no hay receta
         *       sinCatalogo:    [ {productoId, descripcion} ], // insumo que no está en el catálogo
         *       uomDistinta:    [ {productoId, nombre, uomReceta, unidadProducto} ]
         *     }
         *   }
         *
         * `sinReceta` es el aviso que más importa: un producto de la carta sin
         * receta hace que su consumo NO se descuente de ningún insumo, y el
         * stock teórico saldría alto sin que nada falle a la vista.
         */
        function consumoTeorico() {
            var huella = _consumoHuella();
            if (_consumoMemo.resultado && _consumoMemo.huella === huella) return _consumoMemo.resultado;

            var listaVentas  = (typeof ventas  !== 'undefined' && Array.isArray(ventas))  ? ventas  : [];
            var semana       = (typeof ventasSemanaId !== 'undefined') ? ventasSemanaId : null;
            var resultado    = _consumoCalcular(listaVentas, semana);

            _consumoMemo = { huella: huella, resultado: resultado };
            return resultado;
        }

        /**
         * _consumoCalcular(listaVentas, semana)
         * FASE 14 — el cruce, separado de DE DÓNDE salen las ventas. Antes vivía
         * dentro de consumoTeorico() (que solo sabe de la semana en memoria);
         * ahora lo usan también el arrastre desde el ancla (varias semanas) y la
         * simulación de la venta del turno (un archivo que todavía no se guarda).
         * Mismo código, mismo resultado: consumoTeorico() le delega sin cambiar
         * una sola regla.
         */
        function _consumoCalcular(listaVentas, semana) {
            listaVentas      = Array.isArray(listaVentas) ? listaVentas : [];
            var listaRecetas = (typeof recetas !== 'undefined' && Array.isArray(recetas)) ? recetas : [];
            var listaProd    = (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];

            var resultado = {
                semana: semana,
                consumo: {},
                lineasCalculadas: 0,
                skusVendidos: listaVentas.length,
                avisos: { sinReceta: [], sinCatalogo: [], uomDistinta: [] }
            };

            if (!listaVentas.length || !listaRecetas.length) return resultado;

            // Índices por código, para no recorrer los arreglos dentro del bucle.
            var recetaPorPV = {};
            listaRecetas.forEach(function(r) {
                if (r && r.pv) recetaPorPV[String(r.pv).trim().toUpperCase()] = r;
            });
            var productoPorId = {};
            listaProd.forEach(function(p) { if (p && p.id) productoPorId[String(p.id)] = p; });

            var vistosSinCatalogo = {}, vistosUom = {};

            listaVentas.forEach(function(v) {
                if (!v || !v.sku) return;
                var unidades = (typeof v.cantidad === 'number' && isFinite(v.cantidad)) ? v.cantidad : 0;
                if (!unidades) return;

                var receta = recetaPorPV[String(v.sku).trim().toUpperCase()];
                if (!receta) {
                    // Se vendió algo que no tiene receta: su consumo no se puede
                    // repartir entre insumos. Se reporta, nunca se estima.
                    resultado.avisos.sinReceta.push({ sku: v.sku, nombre: v.nombre || v.sku, cantidad: unidades });
                    return;
                }

                var ingredientes = Array.isArray(receta.ingredientes) ? receta.ingredientes : [];
                ingredientes.forEach(function(ing) {
                    if (!ing || !ing.productoId) return;
                    var cant = (typeof ing.cantidad === 'number' && isFinite(ing.cantidad)) ? ing.cantidad : 0;
                    if (!cant) return;

                    var pid = String(ing.productoId);
                    var prod = productoPorId[pid];
                    if (!prod && !vistosSinCatalogo[pid]) {
                        vistosSinCatalogo[pid] = true;
                        resultado.avisos.sinCatalogo.push({
                            productoId: pid,
                            descripcion: ing.descripcionExcel || '(sin descripción)'
                        });
                    }
                    if (prod && ing.uom && !vistosUom[pid]) {
                        var f = (typeof factorAUnidadProducto === 'function') ? factorAUnidadProducto(ing.uom, prod) : 1;
                        // Solo interesa avisar cuando la UoM NO es la del insumo
                        // y aun así el Excel la trata como si lo fuera (factor 1).
                        var mismaUnidad = String(ing.uom).trim().toLowerCase() === String(prod.unit || '').trim().toLowerCase();
                        if (f === 1 && !mismaUnidad) {
                            vistosUom[pid] = true;
                            resultado.avisos.uomDistinta.push({
                                productoId: pid, nombre: prod.name || pid,
                                uomReceta: ing.uom, unidadProducto: prod.unit || '(sin unidad)'
                            });
                        }
                    }

                    // El cálculo del Excel, literal: unidades vendidas × cantidad
                    // de la receta, sin convertir nada.
                    resultado.consumo[pid] = (resultado.consumo[pid] || 0) + unidades * cant;
                    resultado.lineasCalculadas++;
                });
            });

            Object.keys(resultado.consumo).forEach(function(k) {
                resultado.consumo[k] = _consumoRedondear(resultado.consumo[k]);
            });
            return resultado;
        }

        /**
         * consumoTeoricoDeLineas(lineas, etiqueta?)
         * FASE 14 — el mismo cruce para un conjunto de ventas cualquiera (las
         * del arrastre desde el ancla, o las de un archivo en vista previa).
         * Sin memoria propia: quien lo llama decide cuándo recalcular.
         */
        function consumoTeoricoDeLineas(lineas, etiqueta) {
            return _consumoCalcular(lineas, etiqueta || null);
        }
        window.consumoTeoricoDeLineas = consumoTeoricoDeLineas;
        window.consumoTeorico = consumoTeorico;

        /**
         * consumoTeoricoTop(n)
         * Los n insumos más consumidos, con su nombre, para poder verificar el
         * cálculo contra el Excel de un vistazo.
         */
        function consumoTeoricoTop(n) {
            var r = consumoTeorico();
            var listaProd = (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];
            var porId = {};
            listaProd.forEach(function(p) { if (p && p.id) porId[String(p.id)] = p; });
            return Object.keys(r.consumo)
                .map(function(id) {
                    var p = porId[id];
                    return { productoId: id, nombre: p ? (p.name || id) : id,
                             unidad: p ? (p.unit || '') : '', cantidad: r.consumo[id], enCatalogo: !!p };
                })
                .sort(function(a, b) { return b.cantidad - a.cantidad; })
                .slice(0, n || 15);
        }
        window.consumoTeoricoTop = consumoTeoricoTop;
