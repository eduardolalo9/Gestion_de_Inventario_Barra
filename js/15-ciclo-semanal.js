        // ══════════════════════════════════════════════════════════════════════
        //  CICLO SEMANAL — R4, reglas 4 y 5
        //  ────────────────────────────────────────────────────────────────────
        //  La semana del inventario va SIEMPRE de lunes a domingo. El cambio de
        //  mes no la parte: un recuento de fin de mes es un corte ADICIONAL para
        //  contabilidad, y no abre ni cierra semana.
        //
        //      inicial de la semana + compras − ventas = teórico
        //      suma de los tres conteos               = físico
        //
        //  Solo el cierre del DOMINGO arrastra: su físico se convierte en el
        //  inicial del lunes siguiente. Un corte de fin de mes en miércoles no
        //  arrastra nada, o partiría la semana en dos.
        //
        //  ── Por qué este archivo no toca la pantalla ─────────────────────────
        //  Todo lo de aquí es cálculo puro: entra una fecha, sale un dato. No
        //  lee el DOM, no escribe en Firestore y no depende del estado de la
        //  app. Eso permite probarlo entero sin navegador, y que los ajustes
        //  que vengan en la pantalla de inventario físico no obliguen a
        //  reescribir el calendario.
        //
        //  ── Zona horaria ─────────────────────────────────────────────────────
        //  Todo se calcula en hora LOCAL del dispositivo, nunca en UTC. Un
        //  new Date('2026-09-13') se interpreta como UTC y en México devuelve el
        //  día anterior: un domingo se convertiría en sábado y el cierre caería
        //  en la semana equivocada. Por eso las fechas ISO se parten a mano.
        // ══════════════════════════════════════════════════════════════════════

        /**
         * parseFechaLocal('2026-09-13') → Date del 13/09/2026 a las 00:00 LOCAL.
         * Devuelve null si la cadena no es una fecha válida.
         */
        function parseFechaLocal(iso) {
            var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
            if (!m) return null;
            var y = parseInt(m[1], 10), mes = parseInt(m[2], 10), d = parseInt(m[3], 10);
            if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
            var f = new Date(y, mes - 1, d);
            // Rebote: el 31 de febrero se convierte solo en el 3 de marzo. Si los
            // componentes no sobreviven al viaje, la fecha no existía.
            if (f.getFullYear() !== y || f.getMonth() !== mes - 1 || f.getDate() !== d) return null;
            return f;
        }

        /** Date → 'YYYY-MM-DD' en hora local. */
        function fechaISOLocal(d) {
            if (!(d instanceof Date) || isNaN(d.getTime())) return null;
            var mm = String(d.getMonth() + 1).padStart(2, '0');
            var dd = String(d.getDate()).padStart(2, '0');
            return d.getFullYear() + '-' + mm + '-' + dd;
        }

        /** Acepta un Date o un 'YYYY-MM-DD' y devuelve un Date local a las 00:00. */
        function _aFechaLocal(x) {
            if (x instanceof Date) {
                if (isNaN(x.getTime())) return null;
                return new Date(x.getFullYear(), x.getMonth(), x.getDate());
            }
            return parseFechaLocal(x);
        }

        /**
         * Lunes de la semana a la que pertenece la fecha.
         * getDay() da 0 para domingo, así que el domingo retrocede 6 días, no 0:
         * el domingo es el ÚLTIMO día de su semana, no el primero.
         */
        function inicioSemana(x) {
            var f = _aFechaLocal(x);
            if (!f) return null;
            var dia   = f.getDay();
            var atras = (dia === 0) ? 6 : (dia - 1);
            // setDate() con un valor negativo o mayor que el mes salta bien de mes
            // y de año, y respeta cualquier cambio de horario.
            var lunes = new Date(f.getFullYear(), f.getMonth(), f.getDate() - atras);
            return lunes;
        }

        /** Domingo de esa semana, a las 23:59:59.999 locales. */
        function finSemana(x) {
            var lunes = inicioSemana(x);
            if (!lunes) return null;
            return new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6,
                            23, 59, 59, 999);
        }

        /**
         * Identificador de la semana: la FECHA DEL LUNES, 'YYYY-MM-DD'.
         *
         * Se usa el lunes en vez del número de semana ISO a propósito. El número
         * ISO arrastra un caso que muerde una vez al año: el 28/12/2026 pertenece
         * a la semana 1 de 2027, y "2026-W01" y "2027-W01" se confunden con
         * facilidad. Una fecha no tiene ese problema, se ordena sola como texto y
         * además se puede leer.
         */
        function semanaId(x) {
            return fechaISOLocal(inicioSemana(x));
        }

        /** Semana siguiente y anterior, por su id. */
        function semanaSiguiente(x) {
            var l = inicioSemana(x);
            if (!l) return null;
            return fechaISOLocal(new Date(l.getFullYear(), l.getMonth(), l.getDate() + 7));
        }
        function semanaAnterior(x) {
            var l = inicioSemana(x);
            if (!l) return null;
            return fechaISOLocal(new Date(l.getFullYear(), l.getMonth(), l.getDate() - 7));
        }

        /** ¿Es el último día de su mes? El día 0 del mes siguiente ES el último de este. */
        function esUltimoDiaDelMes(x) {
            var f = _aFechaLocal(x);
            if (!f) return false;
            var ultimo = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
            return f.getDate() === ultimo;
        }

        /**
         * clasificarRecuento(fecha) — qué significa contar en ese día.
         *
         *   cierraSemana   solo el domingo. Es el único que arrastra el inicial.
         *   esCorteMensual el último día del mes, sea el día que sea.
         *
         * Un domingo que además es fin de mes hace las dos cosas: cierra la
         * semana Y sirve de corte mensual. No son excluyentes.
         */
        function clasificarRecuento(x) {
            var f = _aFechaLocal(x);
            if (!f) return null;
            var esDomingo = (f.getDay() === 0);
            var finMes    = esUltimoDiaDelMes(f);
            var tipo;
            if (esDomingo && finMes)      tipo = 'semanal_y_mensual';
            else if (esDomingo)           tipo = 'semanal';
            else if (finMes)              tipo = 'fin_de_mes';
            else                          tipo = 'fuera_de_calendario';
            return {
                fecha:          fechaISOLocal(f),
                semanaId:       semanaId(f),
                finDeSemana:    fechaISOLocal(finSemana(f)),
                esDomingo:      esDomingo,
                esCorteMensual: finMes,
                // Solo el domingo cierra la semana. Un corte de fin de mes en
                // miércoles NO arrastra: partiría la semana en dos mitades.
                cierraSemana:   esDomingo,
                tipo:           tipo
            };
        }

        /** ¿Esa fecha cae dentro de esa semana? */
        function perteneceASemana(fecha, idSemana) {
            var s = semanaId(fecha);
            return !!s && s === String(idSemana || '');
        }

        /**
         * Etiqueta legible: 'semana del 7 al 13 de septiembre de 2026'.
         * Para que el administrador vea a qué semana pertenece un cierre sin
         * tener que interpretar una fecha suelta.
         */
        function etiquetaSemana(x) {
            var l = inicioSemana(x), d = finSemana(x);
            if (!l || !d) return '—';
            var meses = ['enero','febrero','marzo','abril','mayo','junio',
                         'julio','agosto','septiembre','octubre','noviembre','diciembre'];
            var mismoMes = (l.getMonth() === d.getMonth() && l.getFullYear() === d.getFullYear());
            if (mismoMes) {
                return 'semana del ' + l.getDate() + ' al ' + d.getDate() + ' de ' +
                       meses[l.getMonth()] + ' de ' + l.getFullYear();
            }
            var mismoAnio = (l.getFullYear() === d.getFullYear());
            return 'semana del ' + l.getDate() + ' de ' + meses[l.getMonth()] +
                   (mismoAnio ? '' : ' de ' + l.getFullYear()) +
                   ' al ' + d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
        }

        /**
         * inicialDesdeCierre(cierre) — regla 5.
         * ─────────────────────────────────────
         * Convierte el físico de un cierre en el inventario inicial de la semana
         * siguiente. No inventa cantidades: copia el total por producto que quedó
         * congelado, y deja escrito de dónde salió.
         *
         * Devuelve null si el cierre no cierra semana (un corte de fin de mes en
         * miércoles no arrastra) — para que la decisión no dependa de que quien
         * llame se acuerde de comprobarlo.
         *
         * @param {object} cierre  { fecha, inventoryId, numero, productos: [{id, total}] }
         */
        function inicialDesdeCierre(cierre) {
            if (!cierre || !cierre.fecha) return null;
            var clase = clasificarRecuento(cierre.fecha);
            if (!clase || !clase.cierraSemana) return null;

            var saldos = {};
            (cierre.productos || []).forEach(function(p) {
                if (!p || !p.id) return;
                var t = Number(p.total);
                if (!isFinite(t)) t = 0;
                // Se redondea a 3 decimales, igual que el conteo: si no, sumar
                // tres áreas en coma flotante mete colas de 0.30000000000000004
                // que se arrastran semana tras semana.
                saldos[p.id] = Math.round(t * 1000) / 1000;
            });

            return {
                semanaId:     semanaSiguiente(cierre.fecha),
                // Trazabilidad: de qué cierre salió este inicial. Sin esto, dentro
                // de tres meses nadie puede reconstruir de dónde vino un saldo.
                origen: {
                    tipo:         'cierre_inventario',
                    inventoryId:  cierre.inventoryId || null,
                    numero:       (cierre.numero !== undefined) ? cierre.numero : null,
                    fechaCierre:  clase.fecha,
                    semanaCerrada: clase.semanaId
                },
                saldos:       saldos,
                totalProductos: Object.keys(saldos).length
            };
        }
