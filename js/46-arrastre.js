        // ═════════════════════════════════════════════════════════════════════
        //  FASE 14 — ANCLA DEL TOTAL Y ARRASTRE CONTINUO (capa pura)
        //  ───────────────────────────────────────────────────────────────────
        //  NO pinta, NO escribe, NO toca Firestore. Responde dos preguntas:
        //
        //    1. ¿Cuál es el último conteo físico contabilizado que vale como
        //       punto de partida (el "ancla") del Total?
        //    2. Desde esa fecha, ¿qué compras se suman y qué ventas se restan?
        //
        //  Antes de esta fase el Total oficial solo existía si la SEMANA EN
        //  CURSO tenía un inicial (inventariosIniciales/{lunes}), que solo nace
        //  al contabilizar el domingo anterior. Un corte de fin de mes en
        //  miércoles, o un domingo sin contabilizar, dejaban la semana sin
        //  inicial y el Total caía al respaldo operativo — el "Total: 0.00" del
        //  4-oct-2026.
        //
        //  Decisión de Eduardo (5-oct-2026):
        //    · ARRASTRE CONTINUO: el último corte vale hasta que haya uno más
        //      nuevo, aunque pasen semanas. Se suman compras y se restan ventas
        //      con fecha POSTERIOR al corte.
        //    · Un recuento de mitad de semana también puede ser ancla, si no hay
        //      uno más nuevo.
        //
        //  CONVENCIÓN DE FECHA — la misma que ya usaba el ciclo semanal: un
        //  conteo representa la existencia AL CIERRE de su día. El inicial de la
        //  semana que empieza el lunes 5 sale del conteo del domingo 4, así que
        //  su ancla es el domingo 4 y TODAS las compras/ventas desde el lunes 5
        //  cuentan. Un corte del miércoles 30 cuenta ventas desde el jueves 1.
        //
        //  TOPE: ARRASTRE_MAX_DIAS. Un ancla de hace más de 8 semanas ya no es
        //  confiable (cualquier día de ventas sin cargar se acumula) y obliga a
        //  leer demasiadas semanas de Firestore en un teléfono de barra: se cae
        //  al respaldo y se dice por qué.
        // ═════════════════════════════════════════════════════════════════════

        var ARRASTRE_MAX_DIAS = 56;

        function _arrFecha(iso) {
            return (typeof parseFechaLocal === 'function') ? parseFechaLocal(iso) : null;
        }

        function _arrISO(d) {
            return (typeof fechaISOLocal === 'function') ? fechaISOLocal(d) : null;
        }

        /** 'YYYY-MM-DD' + n días → 'YYYY-MM-DD' (hora local, sin husos). */
        function arrastreSumarDias(iso, n) {
            var f = _arrFecha(iso);
            if (!f) return null;
            return _arrISO(new Date(f.getFullYear(), f.getMonth(), f.getDate() + n));
        }

        /** Días naturales de a → b (b − a). null si alguna fecha no es válida. */
        function arrastreDiasEntre(a, b) {
            var fa = _arrFecha(a), fb = _arrFecha(b);
            if (!fa || !fb) return null;
            return Math.round((fb.getTime() - fa.getTime()) / 86400000);
        }

        /**
         * Fecha-ancla de un inicial semanal: el DOMINGO anterior a su lunes.
         * inventariosIniciales/2026-10-05 sale del conteo del domingo 4.
         */
        function anclaFechaDeInicial(semanaIdLunes) {
            return arrastreSumarDias(semanaIdLunes, -1);
        }

        /**
         * anclaElegir(candidatos, hoyISO)
         * De todos los candidatos, el MÁS NUEVO cuya fecha no sea futura.
         * Empate de fecha: v5.18 — gana el que se REGISTRÓ después
         * (registradoEn, ms), porque un corte importado a las 14:30 de un día
         * en que ya se había contabilizado un recuento es lo más reciente que
         * se sabe. Si alguno no trae registradoEn, se conserva la regla de
         * FASE 14: gana el inicial semanal (el ciclo oficial).
         *
         * candidato: { tipo: 'inicial_semanal'|'fin_de_mes'|'mitad_de_semana',
         *              fecha, id, saldos, origen, semanaId? }
         */
        function anclaElegir(candidatos, hoyISO) {
            var mejor = null;
            (candidatos || []).forEach(function(c) {
                if (!c || !c.fecha || !_arrFecha(c.fecha)) return;
                if (hoyISO && c.fecha > hoyISO) return;   // un corte de mañana no vale hoy
                if (!c.saldos || typeof c.saldos !== 'object') return;
                var empate = mejor && c.fecha === mejor.fecha;
                var ambosConRegistro = empate && typeof c.registradoEn === 'number' && typeof mejor.registradoEn === 'number';
                if (!mejor || c.fecha > mejor.fecha ||
                    (ambosConRegistro && c.registradoEn > mejor.registradoEn) ||
                    (empate && !ambosConRegistro && c.tipo === 'inicial_semanal' && mejor.tipo !== 'inicial_semanal')) {
                    mejor = c;
                }
            });
            return mejor;
        }

        /**
         * Semanas (id = lunes) que hay que leer para cubrir del día siguiente al
         * ancla hasta hoy, ambas incluidas. Acotado por el tope de arrastre.
         */
        function arrastreSemanasNecesarias(anclaFecha, hoyISO) {
            var desde = arrastreSumarDias(anclaFecha, 1);
            if (!desde || !hoyISO || desde > hoyISO) return [];
            var out = [];
            var s = (typeof semanaId === 'function') ? semanaId(desde) : null;
            var fin = (typeof semanaId === 'function') ? semanaId(hoyISO) : null;
            while (s && fin && s <= fin && out.length < 10) {
                out.push(s);
                s = arrastreSumarDias(s, 7);
            }
            return out;
        }

        /**
         * anclaDesdeCierre(cierre, tipo)
         * El documento de anclasExistencia/{fecha} a partir del físico de un
         * cierre. Mismo criterio que inicialDesdeCierre(): un producto que
         * nadie contó (contado === false) NO entra — "nadie lo tocó" no es
         * "se contó y dio cero" (decisión del 4-oct-2026).
         *
         * @param {object} cierre { fecha, inventoryId, numero, productos: [{id, total, contado?}] }
         * @param {string} tipo   'fin_de_mes' | 'mitad_de_semana'
         */
        function anclaDesdeCierre(cierre, tipo) {
            if (!cierre || !cierre.fecha || !_arrFecha(cierre.fecha)) return null;
            if (tipo !== 'fin_de_mes' && tipo !== 'mitad_de_semana') return null;
            var saldos = {};
            var noContados = 0;
            (cierre.productos || []).forEach(function(p) {
                if (!p || !p.id) return;
                if (p.contado === false) { noContados++; return; }
                var t = Number(p.total);
                if (!isFinite(t)) t = 0;
                saldos[p.id] = Math.round(t * 1000) / 1000;
            });
            return {
                fecha:    cierre.fecha,
                tipo:     tipo,
                semanaId: (typeof semanaId === 'function') ? semanaId(cierre.fecha) : null,
                origen: {
                    tipo:        'cierre_inventario',
                    inventoryId: cierre.inventoryId || null,
                    numero:      (cierre.numero !== undefined) ? cierre.numero : null,
                    fechaCierre: cierre.fecha
                },
                saldos:              saldos,
                totalProductos:      Object.keys(saldos).length,
                productosNoContados: noContados
            };
        }

        /**
         * arrastreEntradas(anclaFecha, movimientos, hoyISO)
         * Compras con fecha POSTERIOR al ancla y no futura, por producto.
         * Un asiento sin fecha (D-4: el Excel no la trajo) usa el lunes de su
         * semana: entra si su semana empieza después del ancla.
         * Los asientos se deduplican por movId: la misma compra puede venir de
         * la memoria del dispositivo y de la lectura de Firestore.
         */
        function arrastreEntradas(anclaFecha, movimientos, hoyISO) {
            var r = {}, vistos = {};
            (movimientos || []).forEach(function(m) {
                if (!m || m.tipo !== 'compra' || !m.productoId) return;
                if (m.movId) { if (vistos[m.movId]) return; vistos[m.movId] = true; }
                var f = m.fecha || m.semanaId || null;
                if (!f || f <= anclaFecha) return;
                if (hoyISO && f > hoyISO) return;
                r[m.productoId] = (r[m.productoId] || 0) + (Number(m.cantidad) || 0);
            });
            Object.keys(r).forEach(function(k) { r[k] = Math.round(r[k] * 1000) / 1000; });
            return r;
        }

        /** Todas las fechas de a a b, ambas incluidas (tope defensivo de 400). */
        function _arrRango(a, b) {
            var out = [];
            var f = _arrFecha(a), g = _arrFecha(b);
            if (!f || !g) return out;
            for (var d = f; d <= g && out.length < 400; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
                out.push(_arrISO(d));
            }
            return out;
        }

        /**
         * arrastrePeriodosVentas(anclaFecha, periodos, hoyISO)
         * Clasifica cada periodo de ventas contra la fecha del ancla:
         *   · incluido  — empieza DESPUÉS del ancla: se resta completo.
         *   · anterior  — termina el día del ancla o antes: ya está reflejado
         *                 en el conteo físico, no se resta.
         *   · partido   — empieza antes y termina después: el reporte trae las
         *                 cantidades sumadas y NO se puede repartir por día. No
         *                 se resta y se avisa (restarlo entero contaría dos veces
         *                 lo vendido antes del corte; ignorarlo deja el Total alto).
         * Además: qué días desde el ancla hasta ayer no tienen ventas cargadas.
         *
         * periodo: { id, inicio, fin, lineas }
         */
        function arrastrePeriodosVentas(anclaFecha, periodos, hoyISO) {
            var r = { incluidos: [], anteriores: [], partidos: [], diasEsperados: [], diasCubiertos: [], diasFaltantes: [] };
            var vistos = {};
            var cubiertos = {};
            (periodos || []).forEach(function(p) {
                if (!p || !p.inicio || !p.fin) return;
                var clave = p.id || (p.inicio + '_' + p.fin);
                if (vistos[clave]) return;
                vistos[clave] = true;
                if (p.inicio > anclaFecha) {
                    r.incluidos.push(p);
                    _arrRango(p.inicio, p.fin).forEach(function(f) { cubiertos[f] = true; });
                } else if (p.fin <= anclaFecha) {
                    r.anteriores.push(p);
                } else {
                    r.partidos.push(p);
                    _arrRango(arrastreSumarDias(anclaFecha, 1), p.fin).forEach(function(f) { cubiertos[f] = true; });
                }
            });
            // Días esperados: del día siguiente al ancla hasta AYER. Hoy solo
            // cuenta si ya hay algo cargado (el día no ha terminado).
            var desde = arrastreSumarDias(anclaFecha, 1);
            var ayer  = hoyISO ? arrastreSumarDias(hoyISO, -1) : null;
            if (desde && ayer && desde <= ayer) r.diasEsperados = _arrRango(desde, ayer);
            if (hoyISO && cubiertos[hoyISO] && desde && desde <= hoyISO) r.diasEsperados.push(hoyISO);
            r.diasCubiertos = r.diasEsperados.filter(function(f) { return cubiertos[f]; });
            r.diasFaltantes = r.diasEsperados.filter(function(f) { return !cubiertos[f]; });
            return r;
        }

        /** Junta las líneas de varios periodos, sumando por SKU (misma regla del Excel). */
        function arrastreLineasVentas(periodos) {
            var porSku = {}, orden = [];
            (periodos || []).forEach(function(p) {
                (p && Array.isArray(p.lineas) ? p.lineas : []).forEach(function(l) {
                    if (!l || !l.sku) return;
                    if (!porSku[l.sku]) { porSku[l.sku] = { sku: l.sku, nombre: l.nombre || '', cantidad: 0, ventaNeta: 0 }; orden.push(l.sku); }
                    porSku[l.sku].cantidad  += Number(l.cantidad)  || 0;
                    porSku[l.sku].ventaNeta += Number(l.ventaNeta) || 0;
                });
            });
            return orden.map(function(s) {
                var g = porSku[s];
                return { sku: g.sku, nombre: g.nombre,
                         cantidad: Math.round(g.cantidad * 1000) / 1000,
                         ventaNeta: Math.round(g.ventaNeta * 100) / 100 };
            });
        }

        /**
         * ¿Un periodo de ventas cruza la fecha de un ancla? Se usa para
         * BLOQUEAR una importación así: después ya no se podría repartir.
         */
        function periodoCruzaAncla(inicio, fin, anclaFecha) {
            return !!(inicio && fin && anclaFecha && inicio <= anclaFecha && fin > anclaFecha);
        }

        /** Etiqueta legible del tipo de ancla. */
        function anclaEtiqueta(ancla) {
            if (!ancla) return 'sin ancla';
            var f = _arrFecha(ancla.fecha);
            var fecha = f ? (String(f.getDate()).padStart(2, '0') + '/' + String(f.getMonth() + 1).padStart(2, '0') + '/' + f.getFullYear()) : String(ancla.fecha || '');
            if (ancla.tipo === 'inicial_semanal') return 'Inicial semanal (conteo del ' + fecha + ')';
            if (ancla.tipo === 'fin_de_mes')      return 'Corte de fin de mes (' + fecha + ')';
            if (ancla.tipo === 'mitad_de_semana') return 'Recuento de mitad de semana (' + fecha + ')';
            if (ancla.tipo === 'importacion_excel') return 'Corte importado de Excel (' + fecha + (ancla.hora ? ' ' + ancla.hora : '') + ')';
            return 'Conteo del ' + fecha;
        }

        window.ARRASTRE_MAX_DIAS        = ARRASTRE_MAX_DIAS;
        window.arrastreSumarDias        = arrastreSumarDias;
        window.arrastreDiasEntre        = arrastreDiasEntre;
        window.anclaFechaDeInicial      = anclaFechaDeInicial;
        window.anclaElegir              = anclaElegir;
        window.arrastreSemanasNecesarias = arrastreSemanasNecesarias;
        window.anclaDesdeCierre         = anclaDesdeCierre;
        window.arrastreEntradas         = arrastreEntradas;
        window.arrastrePeriodosVentas   = arrastrePeriodosVentas;
        window.arrastreLineasVentas     = arrastreLineasVentas;
        window.periodoCruzaAncla        = periodoCruzaAncla;
        window.anclaEtiqueta            = anclaEtiqueta;
