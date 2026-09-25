        // ═════════════════════════════════════════════════════════════════════
        //  FASE 8 — EXISTENCIA: UNA SOLA FUENTE, CALCULADA EN UN SOLO SITIO
        //  ───────────────────────────────────────────────────────────────────
        //  Capa de datos pura: NO pinta, NO escribe, NO toca reglas. Solo
        //  responde "¿cuánto hay de este producto?" con una respuesta que dice
        //  de dónde salió el número.
        //
        //  La app tenía tres formas distintas de contestar esa pregunta:
        //    1. stockByArea            — el conteo operativo continuo (heredado)
        //    2. el inventario físico    — lo que cuenta el equipo, congelado al cerrar
        //    3. inicial + compras       — el arrastre semanal (FASE 3 y FASE 4)
        //
        //  La fuente OFICIAL acordada es la 3:
        //      existencia = inicial contabilizado + compras − ventas
        //
        //  Con dos advertencias que el código respeta al pie de la letra:
        //
        //  · VENTAS NO EXISTEN todavía (es FASE 10). existenciaVentasSemana()
        //    devuelve {} a propósito y está aislada para que enchufarla luego
        //    sea cambiar una función, no perseguir restas por todo el código.
        //
        //  · EL INICIAL PUEDE NO EXISTIR. inventariosIniciales/{semana} solo
        //    nace cuando un admin CONTABILIZA el inventario cerrado del domingo.
        //    Sin ese documento —o para un producto dado de alta después— no hay
        //    arrastre, y devolver "0 + compras" sería inventar un número peor
        //    que el actual. En ese caso se cae al stock operativo y se DICE, con
        //    origen: 'operativo_no_reconciliado'. La regla del proyecto es no
        //    presentar como oficial un número que no lo es.
        //
        //  MIENTRAS TANTO (semana de observación, decisión de Eduardo):
        //  EXISTENCIA_FUENTE_OFICIAL_ACTIVA = false. Las dos cifras se calculan
        //  y se muestran lado a lado, pero "bajo mínimo", el valor en existencia
        //  y el catálogo siguen usando la cifra operativa de siempre. Cambiar
        //  esa constante a true es lo único que hace falta para que la app
        //  entera pase a la fuente oficial: por eso todo el mundo pregunta por
        //  existenciaMostrada() y nadie llama a getTotalStock() por su cuenta.
        // ═════════════════════════════════════════════════════════════════════

        // El interruptor. Una sola línea cambia la fuente de toda la app.
        var EXISTENCIA_FUENTE_OFICIAL_ACTIVA = false;

        // Diferencia por debajo de la cual dos cifras se consideran iguales.
        // El conteo se redondea a 3 decimales; sin tolerancia, una cola de coma
        // flotante (0.30000000000000004) se reportaría como discrepancia real.
        var EXISTENCIA_TOLERANCIA = 0.001;

        var _existenciaInicial = { semana: null, estado: 'sin_cargar', saldos: null, origen: null };
        var _existenciaAvisos  = [];   // repintados pendientes cuando llegue el inicial

        function _existenciaRedondear(n) {
            var x = Number(n);
            if (!isFinite(x)) return 0;
            return Math.round(x * 1000) / 1000;
        }

        /** Semana en curso (id = fecha del lunes), o null si aún no cargó 15-ciclo-semanal. */
        function existenciaSemanaHoy() {
            return (typeof semanaId === 'function') ? semanaId(new Date()) : null;
        }

        /** Estado del inicial en memoria. Nunca null: siempre trae `estado`. */
        function existenciaInicialEstado() {
            return _existenciaInicial;
        }

        /**
         * Carga (una vez por semana y sesión) el inicial contabilizado.
         *
         * `alTerminar` es opcional y se guarda en una lista: si tres pantallas
         * piden el inicial mientras vuela la misma consulta, se hace UNA sola
         * lectura a Firestore y se avisa a las tres. En un bar, cada lectura
         * evitada es batería y datos móviles que no se gastan.
         */
        function existenciaCargarInicial(alTerminar) {
            var sem = existenciaSemanaHoy();
            if (!sem || typeof _db === 'undefined' || !_db) return;

            // Ya hay respuesta firme para esta semana: no se consulta de nuevo
            // y no se apunta a nadie a la lista de avisos (una lista que nadie
            // vaciara se quedaría creciendo con funciones que nunca se llaman).
            var resuelto = (_existenciaInicial.semana === sem &&
                            (_existenciaInicial.estado === 'ok' || _existenciaInicial.estado === 'no_existe'));
            if (resuelto) return;

            if (typeof alTerminar === 'function' && _existenciaAvisos.indexOf(alTerminar) === -1) {
                _existenciaAvisos.push(alTerminar);
            }
            // Consulta en vuelo para esta misma semana: el aviso ya quedó
            // apuntado, no se lanza una segunda lectura.
            if (_existenciaInicial.semana === sem && _existenciaInicial.estado === 'cargando') return;

            _existenciaInicial = { semana: sem, estado: 'cargando', saldos: null, origen: null };
            _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
               .collection('inventariosIniciales').doc(sem).get()
               .then(function(doc) {
                   if (_existenciaInicial.semana !== sem) return;   // cambió de semana mientras volaba
                   if (doc.exists) {
                       var d = doc.data() || {};
                       _existenciaInicial = { semana: sem, estado: 'ok',
                                              saldos: d.saldos || {}, origen: d.origen || null };
                   } else {
                       _existenciaInicial = { semana: sem, estado: 'no_existe', saldos: null, origen: null };
                   }
                   _existenciaNotificar();
               })
               .catch(function(e) {
                   console.warn('[Existencia] No se pudo leer el inventario inicial:', e);
                   if (_existenciaInicial.semana !== sem) return;   // estado ya invalidado
                   _existenciaInicial.estado = 'error';
                   _existenciaNotificar();
               });
        }

        /**
         * Olvida el inicial en memoria para que la próxima consulta lo lea de
         * nuevo. Se llama al contabilizar: sin esto, si se contabiliza ya
         * dentro de la semana destino, el panel seguiría diciendo "esta semana
         * no tiene inicial" hasta recargar la app.
         */
        function existenciaInvalidarInicial() {
            // Incondicional, también con una consulta en vuelo: esa consulta
            // pudo salir ANTES de contabilizar y traer "no existe". Al poner
            // semana en null, su respuesta llega a un estado que ya no es el
            // suyo y se descarta (ver la guarda en existenciaCargarInicial).
            _existenciaInicial = { semana: null, estado: 'sin_cargar', saldos: null, origen: null };
        }

        function _existenciaNotificar() {
            var lista = _existenciaAvisos.slice();
            _existenciaAvisos = [];
            lista.forEach(function(fn) {
                try { fn(); } catch (e) { console.warn('[Existencia] Aviso falló:', e); }
            });
        }

        /**
         * Entradas por compra de la semana en curso, por producto.
         *
         * Memorizado: con la fuente oficial encendida esto se pregunta una vez
         * por producto al pintar el catálogo, y recorrer el libro de
         * movimientos 424 veces seguidas se nota en un teléfono de barra. La
         * huella es la semana más el número de asientos: el libro solo crece
         * (_agregarCompraLocal AGREGA asientos, nunca los edita), así que un
         * cambio real siempre cambia la longitud.
         */
        var _existenciaEntradasMemo = { semana: null, n: -1, mapa: null };

        function existenciaEntradasSemana() {
            var sem = existenciaSemanaHoy();
            var lista = (typeof movimientos !== 'undefined' && Array.isArray(movimientos)) ? movimientos : [];
            if (_existenciaEntradasMemo.mapa &&
                _existenciaEntradasMemo.semana === sem &&
                _existenciaEntradasMemo.n === lista.length) {
                return _existenciaEntradasMemo.mapa;
            }
            var r = {};
            lista.forEach(function(m) {
                if (!m || m.tipo !== 'compra' || m.semanaId !== sem) return;
                r[m.productoId] = (r[m.productoId] || 0) + (Number(m.cantidad) || 0);
            });
            _existenciaEntradasMemo = { semana: sem, n: lista.length, mapa: r };
            return r;
        }

        /**
         * Salidas por venta de la semana en curso, por producto.
         *
         * FASE 10. Hoy devuelve {} — no es un descuido: hasta que exista la
         * importación de ventas de Parrot y el recetario (bebida → insumos),
         * NO HAY forma honesta de saber cuánto salió. Restar una estimación
         * daría un número que parece exacto y no lo es.
         */
        function existenciaVentasSemana() {
            return {};
        }

        /** La cifra heredada: suma de stockByArea en todas las áreas. */
        function existenciaOperativa(product) {
            if (!product) return 0;
            return (typeof getTotalStock === 'function') ? getTotalStock(product) : 0;
        }

        /**
         * existenciaOficial(product)
         * ──────────────────────────
         * Devuelve SIEMPRE un objeto, nunca un número suelto, porque el número
         * sin su procedencia es justo lo que causó el desorden que arregla esta
         * fase.
         *
         *   { valor, origen, inicial, entradas, ventas, operativa, hayInicial }
         *
         *   origen 'oficial'                  → inicial + compras − ventas
         *   origen 'operativo_no_reconciliado' → respaldo: no hay inicial para
         *                                        esta semana o para este producto
         */
        function existenciaOficial(product, cacheEntradas, cacheVentas) {
            var operativa = existenciaOperativa(product);
            if (!product || !product.id) {
                return { valor: 0, origen: 'operativo_no_reconciliado', inicial: undefined,
                         entradas: 0, ventas: 0, operativa: 0, hayInicial: false };
            }
            var ent = (cacheEntradas || existenciaEntradasSemana())[product.id] || 0;
            var ven = (cacheVentas   || existenciaVentasSemana())[product.id]   || 0;
            var hay = (_existenciaInicial.estado === 'ok' && _existenciaInicial.saldos &&
                       typeof _existenciaInicial.saldos[product.id] === 'number');
            if (!hay) {
                return { valor: operativa, origen: 'operativo_no_reconciliado', inicial: undefined,
                         entradas: ent, ventas: ven, operativa: operativa, hayInicial: false };
            }
            var ini = _existenciaInicial.saldos[product.id];
            return {
                valor:     _existenciaRedondear(ini + ent - ven),
                origen:    'oficial',
                inicial:   ini,
                entradas:  ent,
                ventas:    ven,
                operativa: operativa,
                hayInicial: true
            };
        }

        /**
         * La cifra que la interfaz debe mostrar y usar para decidir.
         *
         * Un único sitio donde se elige entre las dos fuentes. Con la bandera
         * apagada devuelve exactamente lo de siempre, así que encender FASE 8
         * no cambió ni un número mientras dure la semana de observación.
         */
        function existenciaMostrada(product, cacheEntradas, cacheVentas) {
            if (!EXISTENCIA_FUENTE_OFICIAL_ACTIVA) return existenciaOperativa(product);
            var r = existenciaOficial(product, cacheEntradas, cacheVentas);
            return r.valor;
        }

        /**
         * Comparación de las dos cifras para la semana de observación.
         * Solo entra a la comparación lo que tiene inicial: un producto sin
         * arrastre no "difiere", simplemente todavía no se puede comparar.
         */
        function existenciaComparacion() {
            var ent   = existenciaEntradasSemana();
            var ven   = existenciaVentasSemana();
            var filas = [];
            var coinciden = 0, sinInicial = 0;
            (typeof products !== 'undefined' && Array.isArray(products) ? products : [])
                .forEach(function(p) {
                    var r = existenciaOficial(p, ent, ven);
                    if (!r.hayInicial) { sinInicial++; return; }
                    var dif = _existenciaRedondear(r.valor - r.operativa);
                    if (Math.abs(dif) <= EXISTENCIA_TOLERANCIA) { coinciden++; return; }
                    filas.push({
                        id:        p.id,
                        nombre:    p.name || p.id,
                        operativa: _existenciaRedondear(r.operativa),
                        oficial:   r.valor,
                        inicial:   r.inicial,
                        entradas:  r.entradas,
                        dif:       dif
                    });
                });
            filas.sort(function(a, b) { return Math.abs(b.dif) - Math.abs(a.dif); });
            return {
                estado:     _existenciaInicial.estado,
                semana:     _existenciaInicial.semana,
                comparados: coinciden + filas.length,
                coinciden:  coinciden,
                difieren:   filas.length,
                sinInicial: sinInicial,
                filas:      filas
            };
        }
