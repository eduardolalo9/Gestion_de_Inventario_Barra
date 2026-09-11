        // ══════════════════════════════════════════════════════════════════════
        //  MÓDULO DE COMPRAS — P1: la pestaña y la lista
        //  ────────────────────────────────────────────────────────────────────
        //  Alcance deliberado de esta fase: mostrar. No importa, no captura y no
        //  escribe todavía en el libro de movimientos. Eso es P2, P3 y P4.
        //
        //  Modelo del negocio, tal como lo describió Eduardo:
        //  el almacén "12 — BARRA MOCHOMOS MONTERREY" de SAP NO es ninguna de las
        //  tres zonas de conteo. Es la barra entera, un único stock. Las zonas
        //  almacen / barra1 / barra2 solo existen para contar físicamente y se
        //  totalizan al cerrar. El ciclo es semanal:
        //
        //      inicial de la semana + compras − ventas = teórico
        //      suma de los tres conteos              = físico
        //
        //  Por eso una compra NO se reparte entre zonas: entra al stock de la
        //  barra y punto. Es la razón de que aquí no haya ningún campo de área.
        // ══════════════════════════════════════════════════════════════════════

        function _comprasOrdenadas() {
            // Más reciente primero. Ante misma fecha, folio descendente, que es
            // el orden en que se generan en SAP.
            return compras.slice().sort(function(a, b) {
                if (a.fecha !== b.fecha) return (b.fecha || '').localeCompare(a.fecha || '');
                return String(b.folio || '').localeCompare(String(a.folio || ''));
            });
        }

        function _dineroMX(n) {
            var v = (typeof n === 'number' && isFinite(n)) ? n : 0;
            return '$' + v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        function _fechaLarga(iso) {
            // Las fechas llegan como '2026-09-09'. Se formatean SIN pasar por
            // new Date(iso), que interpreta la cadena como UTC y en México
            // muestra el día anterior.
            var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
            if (!m) return String(iso || '—');
            var meses = ['enero','febrero','marzo','abril','mayo','junio',
                         'julio','agosto','septiembre','octubre','noviembre','diciembre'];
            return parseInt(m[3], 10) + ' de ' + meses[parseInt(m[2], 10) - 1] + ' de ' + m[1];
        }

        // ── Resumen de la cabecera ────────────────────────────────────────────
        function _resumenCompras() {
            var r = { documentos: compras.length, lineas: 0, importe: 0,
                      proveedores: {}, ultima: null };
            compras.forEach(function(c) {
                r.lineas  += (c.lineas || 0);
                r.importe += (c.importe || 0);
                if (c.proveedorNombre) r.proveedores[c.proveedorNombre] = true;
                if (!r.ultima || (c.fecha || '') > r.ultima) r.ultima = c.fecha;
            });
            r.proveedores = Object.keys(r.proveedores).length;
            return r;
        }

        function renderComprasTab() {
            if (!hasPermission('purchases.read')) {
                return '<div class="p-6 text-center" style="color:var(--txt-secondary)">'
                     + 'No tienes permiso para ver las compras.</div>';
            }

            var html = '<div style="padding:4px 0 8px">';

            // ── Cabecera con el resumen ───────────────────────────────────────
            var r = _resumenCompras();
            html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">';
            [['Documentos', r.documentos],
             ['Líneas', r.lineas],
             ['Proveedores', r.proveedores],
             ['Importe', _dineroMX(r.importe)]
            ].forEach(function(par) {
                html += '<div style="flex:1;min-width:120px;background:var(--surface);'
                      + 'border:1px solid var(--border-mid);border-radius:12px;padding:12px 14px">'
                      + '<div style="font-size:1.25rem;font-weight:700;letter-spacing:-.02em">'
                      + escapeHtml(String(par[1])) + '</div>'
                      + '<div style="font-size:.72rem;color:var(--txt-secondary);'
                      + 'text-transform:uppercase;letter-spacing:.05em;margin-top:3px">'
                      + escapeHtml(par[0]) + '</div></div>';
            });
            html += '</div>';

            // ── Acciones ──────────────────────────────────────────────────────
            html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">';
            if (hasPermission('purchases.import')) {
                html += '<button type="button" onclick="comprasImportarExcel()" '
                      + 'style="display:flex;align-items:center;gap:7px;padding:9px 15px;'
                      + 'border-radius:var(--r-md);background:#065f46;'
                      + 'border:1px solid rgba(34,197,94,.28);color:#86efac;font-weight:600;'
                      + 'cursor:pointer">Importar entrada de mercancía</button>';
            }
            if (hasPermission('purchases.create')) {
                html += '<button type="button" onclick="comprasNuevaManual()" '
                      + 'style="display:flex;align-items:center;gap:7px;padding:9px 15px;'
                      + 'border-radius:var(--r-md);background:var(--surface);'
                      + 'border:1px solid var(--border-mid);color:var(--txt-primary);'
                      + 'font-weight:600;cursor:pointer">Capturar a mano</button>';
            }
            html += '</div>';

            // ── Lista ─────────────────────────────────────────────────────────
            var lista = _comprasOrdenadas();
            if (lista.length === 0) {
                html += '<div style="text-align:center;padding:42px 18px;'
                      + 'background:var(--surface);border:1px solid var(--border-mid);'
                      + 'border-radius:12px">'
                      + '<div style="font-size:2.2rem;margin-bottom:10px">📦</div>'
                      + '<div style="font-weight:600;margin-bottom:6px">Todavía no hay compras registradas</div>'
                      + '<div style="color:var(--txt-secondary);font-size:.88rem;max-width:420px;'
                      + 'margin:0 auto;line-height:1.55">'
                      + 'Importa el Excel de entrada de mercancía de SAP, o captura una a mano. '
                      + 'Antes de guardar nada verás un resumen por proveedor y fecha para revisarlo.'
                      + '</div></div>';
            } else {
                lista.forEach(function(c) {
                    html += '<div style="background:var(--surface);border:1px solid var(--border-mid);'
                          + 'border-radius:12px;padding:14px 16px;margin-bottom:10px">'
                          + '<div style="display:flex;justify-content:space-between;gap:10px;'
                          + 'flex-wrap:wrap;align-items:baseline">'
                          + '<span style="font-weight:700">' + escapeHtml(c.proveedorNombre || 'Sin proveedor')
                          + (c.proveedorCodigo
                              ? ' <span style="color:var(--txt-secondary);font-weight:400;font-size:.82rem">('
                                + escapeHtml(c.proveedorCodigo) + ')</span>' : '')
                          + '</span>'
                          + '<span style="color:var(--txt-secondary);font-size:.84rem">'
                          + escapeHtml(_fechaLarga(c.fecha)) + '</span></div>'
                          + '<div style="color:var(--txt-secondary);font-size:.82rem;margin-top:5px">'
                          + 'Folio ' + escapeHtml(String(c.folio || '—'))
                          + (c.docSap ? ' · Doc SAP ' + escapeHtml(String(c.docSap)) : '')
                          + ' · ' + (c.origen === 'manual' ? 'capturada a mano' : 'importada de Excel')
                          + '</div>'
                          + '<div style="margin-top:7px;font-size:.9rem">'
                          + '<b>' + (c.lineas || 0) + '</b> línea' + ((c.lineas === 1) ? '' : 's')
                          + ' · ' + (c.unidades || 0) + ' unidades'
                          + ' · <b>' + _dineroMX(c.importe) + '</b></div>'
                          + '</div>';
                });
            }

            html += '</div>';
            return html;
        }

        // ── Acciones todavía no implementadas ─────────────────────────────────
        // Se declaran ya para que los botones existan y no lancen un
        // ReferenceError. Decirle al usuario "esto llega en la siguiente fase"
        // es honesto; un botón que no hace nada, no.
        function comprasImportarExcel() {
            showNotification('La importación llega en la siguiente fase (P2).');
        }
        function comprasNuevaManual() {
            showNotification('La captura a mano llega en la fase P3.');
        }
