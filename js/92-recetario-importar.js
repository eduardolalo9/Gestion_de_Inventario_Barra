

        // ══════════════════════════════════════════════════════════════════════
        //  RECETARIO-2 (27/09/2026) — Importador de recetas desde Excel
        //  ────────────────────────────────────────────────────────────────────
        //  Lee DIRECTAMENTE la hoja "Recetas" del Excel real de producción
        //  (verificado celda por celda contra Formato_Barra_Actualizado1.0.xlsm
        //  — ver claude/verificacion-excel-formato-barra-2026-09-27.md y
        //  claude/recetario2-analisis-2026-09-27.md). Columnas reales:
        //    PV, Receta, Categoría, Activa, Código insumo, Descripción insumo,
        //    Cantidad, UoM, Almacén, Nombre almacén, VENTA, CONSUMO
        //  Se usan las primeras ocho MÁS `Almacén`, que es el filtro de
        //  alcance de la barra (ver COLUMNAS_EXCEL_RECETARIO y la corrección
        //  de FASE 10). `Nombre almacén`, `VENTA` y `CONSUMO` sí quedan fuera:
        //  son el motor de consumo teórico (FASE 11).
        //
        //  ARQUITECTURA — mismo patrón que Compras (js/88-compras.js), NO el
        //  de Catálogo: cada PV agrupa varias filas (una por ingrediente) y
        //  cada línea se valida contra el catálogo real, así que hace falta
        //  vista previa + incidencias antes de confirmar (decisión del
        //  propietario, 2026-09-27) — un import silencioso como el de
        //  Catálogo no da tiempo de revisar 1,326 recetas antes de publicar.
        //
        //  PV es la llave de coincidencia (código único, verificado 1-a-1 con
        //  el nombre: 1,326 PV, 1,326 nombres, sin cruces) — si ya existe una
        //  receta con ese PV, se actualiza; si no, se crea. Además, para no
        //  duplicar una receta que el admin ya tecleó a mano (sin código PV
        //  todavía), se acepta también una coincidencia por NOMBRE, pero solo
        //  cuando es inequívoca (exactamente una receta sin pv con ese nombre
        //  exacto) — con más de una coincidencia posible, se crea una nueva en
        //  vez de adivinar cuál era. Esto no se le preguntó al propietario en
        //  esos términos exactos; es una extensión directa de "actualizar por
        //  PV para no duplicar" al único caso donde el PV solo no alcanza. Se
        //  documenta así, explícitamente, para que se pueda revisar.
        //
        //  VALIDACIÓN POR LÍNEA (igual espíritu que Compras — nunca se pierde
        //  el dato, se marca la incidencia y se sigue viendo):
        //    - Código insumo Y cantidad vacíos en la misma fila → no es una
        //      línea real, es una receta sin ingredientes en el Excel (caso
        //      real verificado: PVB1001308 "TE GOURMET"). Se importa igual,
        //      activa según la columna, con 0 ingredientes.
        //    - Código vacío pero cantidad presente → incidencia, línea
        //      omitida (no hay a qué insumo referirse).
        //    - Cantidad no numérica o ≤ 0 → incidencia, línea omitida.
        //    - Código que NO existe en el catálogo actual → a diferencia de
        //      lo que describí en el análisis antes de mirar con cuidado
        //      costoReceta()/_recetaRenderIngredientesLista(), NO se excluye:
        //      la app ya sabe mostrar "sin costo"/"no está en el catálogo"
        //      para un productoId que no resuelve, exactamente igual que
        //      cuando se escribe a mano un código que no existe. Excluir la
        //      línea aquí sí perdería el dato (cero pérdida de datos); en vez
        //      de eso, la línea se guarda con el código tal cual y con la
        //      descripción del Excel (ing.descripcionExcel) para que la ficha
        //      y el editor sigan mostrando algo útil, no solo un código. La
        //      incidencia queda igual para que se note al importar.
        //
        //  El importador SOLO llena/actualiza el arreglo local `recetas` — la
        //  publicación a todos sigue siendo un paso aparte y consciente
        //  (publicarRecetarioFirestore(), ya existente), igual que Catálogo.
        // ══════════════════════════════════════════════════════════════════════

        // _normCabCompras / _findColCompras (js/88-compras.js) son utilidades
        // genéricas de lectura de Excel — el nombre viene de dónde se usaron
        // primero, no de que sean exclusivas de Compras. Se reutilizan tal
        // cual en vez de escribir una tercera copia de la misma normalización.
        const COLUMNAS_EXCEL_RECETARIO = {
            pv:          ['PV', 'pv'],
            nombre:      ['Receta', 'receta'],
            categoria:   ['Categoría', 'Categoria', 'categoria'],
            activa:      ['Activa', 'activa'],
            codigo:      ['Código insumo', 'Codigo insumo', 'codigo insumo'],
            descripcion: ['Descripción insumo', 'Descripcion insumo', 'descripcion insumo'],
            cantidad:    ['Cantidad', 'cantidad'],
            uom:         ['UoM', 'uom', 'Unidad', 'UOM'],
            // FASE 10 — corrección: `Almacén` NO era un dato de FASE 11 como
            // supuse al construir Recetario-2, es el filtro de alcance de toda
            // la app. La fórmula real del Excel es
            //   VENTA = IF(Almacén="12", SUMIF(Venta!SKU, PV, Venta!Cantidad), 0)
            // es decir: solo las líneas de la BARRA generan consumo. Sin este
            // filtro se importaban ~393 recetas de cocina y cava (aceites,
            // aguachiles, vinos, las 45 sub-recetas SUB-0XX) y 1,383 líneas de
            // insumos que el catálogo de barra no tiene ni debe tener.
            // Mismo criterio y misma constante que js/88-compras.js (D-2).
            almacen:     ['Almacén', 'Almacen', 'almacen']
        };

        /**
         * _activaExcelBool(v)
         * En los datos reales el único valor presente es "Sí" (2,799/2,799
         * filas) — no hay muestra real de "No", así que se acepta un conjunto
         * de variantes razonable en vez de solo el valor visto, y cualquier
         * otra cosa (incluido vacío) se toma como falso. Reutiliza
         * _normCabCompras para no reimplementar el despojo de acentos.
         */
        function _activaExcelBool(v) {
            if (v === null || v === undefined || v === '') return false;
            if (typeof v === 'boolean') return v;
            var t = _normCabCompras(v);
            return ['si', '1', 'true', 'x', 'yes', 'verdadero'].indexOf(t) !== -1;
        }

        /**
         * _normalizarLineaReceta(cruda, producto)
         * Ver cabecera del archivo — decide qué hacer con una fila de
         * ingrediente: ignorarla en silencio (receta sin ingredientes),
         * marcarla con incidencia y omitirla (código vacío o cantidad
         * inválida), o guardarla con o sin incidencia (código no encontrado
         * en catálogo, pero la línea SÍ se guarda).
         */
        function _normalizarLineaReceta(cruda, producto) {
            var codigoVacio = (cruda.codigo === undefined || cruda.codigo === null || String(cruda.codigo).trim() === '');
            var cantidadVacia = (cruda.cantidad === undefined || cruda.cantidad === null || String(cruda.cantidad).trim() === '');

            if (codigoVacio && cantidadVacia) {
                return { ok: false, vacia: true };
            }
            if (codigoVacio) {
                return { ok: false, incidencia: {
                    tipo: 'codigo_vacio', codigo: '', descripcion: cruda.descripcion || '',
                    detalle: 'Línea con cantidad (' + cruda.cantidad + ') pero sin código de insumo — se omite'
                }};
            }
            var cantidad = _numeroExcel(cruda.cantidad);
            if (cantidad === null || cantidad <= 0) {
                return { ok: false, incidencia: {
                    tipo: 'cantidad_invalida', codigo: cruda.codigo, descripcion: cruda.descripcion || '',
                    detalle: 'Cantidad no numérica o ≤ 0: "' + cruda.cantidad + '" — línea omitida'
                }};
            }

            var codigoStr = String(cruda.codigo).trim();
            var uom = String(cruda.uom || '').trim();

            if (!producto) {
                return {
                    ok: true,
                    linea: { productoId: codigoStr, cantidad: cantidad, uom: uom,
                              descripcionExcel: String(cruda.descripcion || '').trim() || undefined },
                    incidencia: {
                        tipo: 'sin_catalogo', codigo: codigoStr, descripcion: cruda.descripcion || '',
                        detalle: 'Código "' + codigoStr + '" (' + (cruda.descripcion || '—') +
                                 ') no está en el catálogo — se guardó igual, pero el costo de esta receta quedará "incompleto" hasta que lo des de alta'
                    }
                };
            }

            return { ok: true, linea: { productoId: producto.id, cantidad: cantidad, uom: uom } };
        }

        /**
         * _parsearExcelRecetario(filas)
         * Agrupa por PV (código único). Para cada grupo decide si es alta o
         * actualización mirando el `recetas` ya cargado en memoria — no hace
         * falta esperar a Firestore como en Compras, porque aquí el estado
         * local YA es la fuente que se va a publicar.
         */
        function _parsearExcelRecetario(filas) {
            const grupos = {};
            const orden = [];
            let filasSinPV = 0;
            let lineasFueraDeAlcance = 0;   // líneas de cocina (11) / cava (13)

            (filas || []).forEach(function(fila) {
                const pvCrudo = _findColCompras(fila, COLUMNAS_EXCEL_RECETARIO.pv);
                if (pvCrudo === undefined || pvCrudo === null || String(pvCrudo).trim() === '') {
                    filasSinPV++; // sin PV no hay con qué agrupar ni publicar — se descarta la fila
                    return;
                }
                const pv = String(pvCrudo).trim();

                if (!grupos[pv]) {
                    grupos[pv] = {
                        pv: pv,
                        nombre: String(_findColCompras(fila, COLUMNAS_EXCEL_RECETARIO.nombre) || '').trim() || pv,
                        categoria: String(_findColCompras(fila, COLUMNAS_EXCEL_RECETARIO.categoria) || '').trim(),
                        activa: _activaExcelBool(_findColCompras(fila, COLUMNAS_EXCEL_RECETARIO.activa)),
                        ingredientes: [],
                        incidencias: [],
                        lineasOtroAlmacen: 0,
                        lineasConCodigo: 0
                    };
                    orden.push(pv);
                }
                const g = grupos[pv];

                const codigo = _findColCompras(fila, COLUMNAS_EXCEL_RECETARIO.codigo);
                const codigoStr = (codigo === undefined || codigo === null) ? '' : String(codigo).trim();

                // ── Filtro de alcance (D-2, mismo que Compras): solo almacén 12 ──
                // Se aplica por LÍNEA, no por receta, porque es como lo hace el
                // Excel: un platillo de cocina que lleva una cerveza SÍ consume
                // inventario de barra por esa línea, y sus demás líneas no.
                // Sin código no hay línea real que filtrar (receta sin
                // ingredientes) — ese caso lo resuelve _normalizarLineaReceta.
                if (codigoStr) {
                    g.lineasConCodigo++;
                    var almacenCrudo = _findColCompras(fila, COLUMNAS_EXCEL_RECETARIO.almacen);
                    var almacen = (almacenCrudo === undefined || almacenCrudo === null) ? '' : String(almacenCrudo).trim();
                    if (almacen !== ALMACEN_BARRA_CODIGO) {
                        g.lineasOtroAlmacen++;
                        lineasFueraDeAlcance++;
                        return; // cocina, cava o sin almacén: no le compete a la barra
                    }
                }
                const producto = codigoStr ? products.find(function(p) { return String(p.id) === codigoStr; }) : null;
                const cruda = {
                    codigo: codigo,
                    descripcion: _findColCompras(fila, COLUMNAS_EXCEL_RECETARIO.descripcion),
                    cantidad: _findColCompras(fila, COLUMNAS_EXCEL_RECETARIO.cantidad),
                    uom: _findColCompras(fila, COLUMNAS_EXCEL_RECETARIO.uom)
                };
                const norm = _normalizarLineaReceta(cruda, producto);
                if (!norm.ok) {
                    if (norm.incidencia) g.incidencias.push(norm.incidencia);
                    return; // línea vacía (receta sin ingredientes) o con incidencia bloqueante
                }
                g.ingredientes.push(norm.linea);
                if (norm.incidencia) g.incidencias.push(norm.incidencia);
            });

            // ── Recetas que NO son de la barra ───────────────────────────────
            // Una receta que traía líneas de ingrediente y NINGUNA es de
            // almacén 12 es de cocina o cava (aguachiles, aceites, vinos, las
            // sub-recetas SUB-0XX): no se importa. Se cuenta en bloque, no
            // como ~393 incidencias que no se pueden leer.
            // Una receta SIN ninguna línea de ingrediente (caso real:
            // PVB1001308 "TE GOURMET") sí se importa: no hay línea que
            // clasificar, y ya está documentada como el caso borde de
            // Recetario-2.
            const recetasOtroAlmacen = [];
            const ordenBarra = orden.filter(function(pv) {
                const g = grupos[pv];
                const esDeOtroAlmacen = g.lineasConCodigo > 0 && g.ingredientes.length === 0 && g.lineasOtroAlmacen === g.lineasConCodigo;
                if (esDeOtroAlmacen) { recetasOtroAlmacen.push(g.nombre); return false; }
                return true;
            });

            // ── Decidir alta vs actualización contra el `recetas` en memoria ──
            const gruposList = ordenBarra.map(function(pv) {
                const g = grupos[pv];
                var existente = recetas.find(function(r) {
                    return r.pv && String(r.pv).toUpperCase() === pv.toUpperCase();
                });
                var viaNombre = false;
                if (!existente) {
                    // Sin coincidencia por PV: se intenta por nombre, SOLO si es
                    // inequívoco (una única receta sin pv con ese nombre exacto).
                    // Evita duplicar una receta que el admin ya tecleó a mano.
                    var candidatas = recetas.filter(function(r) {
                        return !r.pv && String(r.nombre || '').trim().toLowerCase() === g.nombre.trim().toLowerCase();
                    });
                    if (candidatas.length === 1) { existente = candidatas[0]; viaNombre = true; }
                }
                return {
                    pv: g.pv, nombre: g.nombre, categoria: g.categoria, activa: g.activa,
                    ingredientes: g.ingredientes, incidencias: g.incidencias,
                    totalIngredientes: g.ingredientes.length,
                    esNueva: !existente,
                    recetaExistenteId: existente ? existente.id : null,
                    coincidenciaPorNombre: viaNombre
                };
            });

            return {
                recetas: gruposList,
                filasSinPV: filasSinPV,
                totalFilas: (filas || []).length,
                lineasFueraDeAlcance: lineasFueraDeAlcance,
                recetasOtroAlmacen: recetasOtroAlmacen.length,
                ejemplosOtroAlmacen: recetasOtroAlmacen.slice(0, 5)
            };
        }

        // ══════════════════════════════════════════════════════════════════════
        //  VISTA PREVIA E INCIDENCIAS
        // ══════════════════════════════════════════════════════════════════════

        function renderVistaPreviaRecetario(parsed) {
            if (!parsed || !parsed.recetas || parsed.recetas.length === 0) {
                return '<div style="text-align:center;padding:32px 18px;background:var(--surface);'
                     + 'border:1px solid var(--border-mid);border-radius:12px">'
                     + '<div style="font-weight:600;margin-bottom:6px">No hay ninguna receta con PV reconocible en este archivo</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.86rem">Revisa que sea la hoja "Recetas" del Excel de producción.</div></div>'
                     + '<div style="margin-top:14px"><button type="button" onclick="cancelarImportacionRecetario()" '
                     + 'style="padding:0 15px;min-height:44px;border-radius:var(--r-md);background:var(--surface);'
                     + 'border:1px solid var(--border-mid);color:var(--txt-primary);cursor:pointer">Cerrar</button></div>';
            }

            var nuevas = parsed.recetas.filter(function(r) { return r.esNueva; }).length;
            var actualizadas = parsed.recetas.length - nuevas;
            var totalIncidencias = parsed.recetas.reduce(function(a, r) { return a + r.incidencias.length; }, 0);
            var sinIngredientes = parsed.recetas.filter(function(r) { return r.totalIngredientes === 0; }).length;

            var html = '<div style="margin-bottom:14px">'
                      + '<div style="font-weight:700;font-size:1.05rem;margin-bottom:4px">Vista previa de la importación</div>'
                      + '<div style="color:var(--txt-secondary);font-size:.86rem;line-height:1.5">'
                      + parsed.recetas.length + ' receta(s) · <b>' + nuevas + ' nueva(s)</b> · <b>' + actualizadas + ' se actualizan</b>'
                      + (parsed.filasSinPV ? ' · ' + parsed.filasSinPV + ' fila(s) sin PV (descartadas)' : '')
                      + (totalIncidencias ? ' · <b style="color:var(--warn)">' + totalIncidencias + ' incidencia(s)</b>' : '')
                      + (sinIngredientes ? ' · <b style="color:var(--danger)">' + sinIngredientes + ' sin ingredientes</b>' : '')
                      + '</div></div>';

            html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                  + 'background:var(--warn-dim);border:1px solid var(--warn-dim);'
                  + 'color:var(--warn);font-size:.82rem;line-height:1.5">'
                  + '⚠️ Esto reemplaza los ingredientes de cada receta que ya existe con el mismo PV. '
                  + 'No se publica todavía — después de confirmar, sigue haciendo falta "Publicar recetario" '
                  + 'para que lo vean los demás.</div>';

            // FASE 10 — lo descartado por almacén se informa en bloque: son
            // cientos de líneas y de recetas, y verlas como incidencias una por
            // una escondería las que sí importan.
            if (parsed.recetasOtroAlmacen || parsed.lineasFueraDeAlcance) {
                html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                      + 'background:var(--surface);border:1px solid var(--border-mid);'
                      + 'color:var(--txt-secondary);font-size:.82rem;line-height:1.5">'
                      + '🏷️ Fuera de alcance de la barra (almacén ' + ALMACEN_BARRA_CODIGO + '): '
                      + '<b>' + (parsed.recetasOtroAlmacen || 0) + '</b> receta(s) de cocina o cava no se importan'
                      + ((parsed.ejemplosOtroAlmacen && parsed.ejemplosOtroAlmacen.length)
                          ? ' (' + escapeHtml(parsed.ejemplosOtroAlmacen.join(', ')) + '…)' : '')
                      + (parsed.lineasFueraDeAlcance
                          ? ', y <b>' + parsed.lineasFueraDeAlcance + '</b> línea(s) de insumo de otros almacenes se omiten '
                            + 'dentro de las recetas que sí son de barra.' : '.')
                      + '</div>';
            }

            var actualizadasPorNombre = parsed.recetas.filter(function(r) { return !r.esNueva && r.coincidenciaPorNombre; });
            if (actualizadasPorNombre.length) {
                html += '<div style="padding:10px 12px;margin-bottom:14px;border-radius:10px;'
                      + 'background:var(--accent-dim);border:1px solid var(--accent-dim2);color:var(--accent);font-size:.82rem">'
                      + 'ℹ️ ' + actualizadasPorNombre.length + ' receta(s) se emparejaron por NOMBRE (no tenían PV — se crearon a mano antes): '
                      + escapeHtml(actualizadasPorNombre.slice(0, 5).map(function(r) { return r.nombre; }).join(', '))
                      + (actualizadasPorNombre.length > 5 ? '…' : '') + '</div>';
            }

            parsed.recetas.forEach(function(r, idx) {
                html += '<div style="background:var(--surface);border:1px solid var(--border-mid);'
                      + 'border-radius:12px;padding:14px 16px;margin-bottom:10px">'
                      + '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">'
                      + '<span style="font-weight:700">' + escapeHtml(r.nombre) + '</span>'
                      + '<span style="font-size:.72rem;padding:2px 8px;border-radius:999px;white-space:nowrap;' +
                        (r.esNueva ? 'background:var(--ok-dim);color:var(--ok);' : 'background:var(--accent-dim);color:var(--brass);') + '">' +
                        (r.esNueva ? 'Nueva' : 'Actualiza') + '</span></div>'
                      + '<div style="color:var(--txt-secondary);font-size:.82rem;margin-top:5px">'
                      + 'PV ' + escapeHtml(r.pv) + (r.categoria ? ' · ' + escapeHtml(r.categoria) : '')
                      + (r.activa ? '' : ' · <span style="color:var(--txt-muted)">inactiva</span>') + '</div>'
                      + '<div style="margin-top:7px;font-size:.9rem">'
                      + '<b>' + r.totalIngredientes + '</b> ingrediente' + (r.totalIngredientes === 1 ? '' : 's')
                      + (r.totalIngredientes === 0 ? ' <span style="color:var(--danger)">— sin ingredientes en el Excel</span>' : '') + '</div>';

                if (r.incidencias.length) {
                    html += '<div style="margin-top:8px;font-size:.8rem;color:var(--warn)">'
                          + '⚠️ ' + r.incidencias.length + ' incidencia(s) — '
                          + '<a href="javascript:void(0)" onclick="_recetarioVerIncidenciasGrupo(\'' + escapeHtml(r.pv) + '\')" '
                          + 'style="color:var(--warn);text-decoration:underline">ver detalle</a></div>';
                }
                html += '</div>';
            });

            html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">'
                  + '<button type="button" onclick="confirmarImportacionRecetario()" '
                  + 'style="padding:0 15px;min-height:44px;border-radius:var(--r-md);background:var(--ok-dim);'
                  + 'border:1px solid var(--ok-dim);color:var(--ok);font-weight:600;cursor:pointer">'
                  + 'Confirmar e importar</button>'
                  + '<button type="button" onclick="cancelarImportacionRecetario()" '
                  + 'style="padding:0 15px;min-height:44px;border-radius:var(--r-md);background:var(--surface);'
                  + 'border:1px solid var(--border-mid);color:var(--txt-primary);cursor:pointer">Cancelar</button>'
                  + '</div>';
            return html;
        }

        function renderIncidenciasImportacionRecetario(resultado) {
            if (!resultado) return '';
            var html = '<div style="margin-bottom:14px">'
                     + '<div style="font-weight:700;font-size:1.05rem;margin-bottom:4px">Resultado de la importación</div>'
                     + '<div style="color:var(--txt-secondary);font-size:.86rem">'
                     + resultado.creadas + ' receta(s) nueva(s) · ' + resultado.actualizadas + ' actualizada(s)'
                     + '</div></div>';

            var todasIncidencias = [];
            (resultado.recetas || []).forEach(function(r) {
                (r.incidencias || []).forEach(function(inc) {
                    todasIncidencias.push(Object.assign({ pv: r.pv, nombre: r.nombre }, inc));
                });
            });
            if (todasIncidencias.length) {
                html += '<div style="font-weight:600;margin-bottom:8px">Incidencias (' + todasIncidencias.length + ')</div>';
                todasIncidencias.forEach(function(inc) {
                    html += '<div style="background:var(--surface);border:1px solid var(--border-mid);'
                          + 'border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:.84rem">'
                          + '<div style="color:var(--txt-secondary);font-size:.76rem;margin-bottom:2px">'
                          + 'PV ' + escapeHtml(inc.pv) + ' · ' + escapeHtml(inc.nombre) + '</div>'
                          + escapeHtml(inc.detalle) + '</div>';
                });
            } else {
                html += '<div style="color:var(--txt-secondary);font-size:.86rem">Sin incidencias.</div>';
            }

            html += '<div style="margin-top:16px"><button type="button" onclick="cerrarResultadoImportacionRecetario()" '
                  + 'style="padding:0 15px;min-height:44px;border-radius:var(--r-md);background:var(--surface);'
                  + 'border:1px solid var(--border-mid);color:var(--txt-primary);cursor:pointer">Aceptar</button></div>';
            return html;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  ORQUESTACIÓN DE LA PANTALLA
        // ══════════════════════════════════════════════════════════════════════

        function recetarioImportarExcel() {
            if (!hasPermission('recipe.edit')) {
                showNotification('⚠️ No tienes permiso para importar recetas');
                return;
            }
            const input = document.getElementById('fileInputRecetario');
            if (input) input.click();
        }
        window.recetarioImportarExcel = recetarioImportarExcel;

        function handleFileImportRecetario(event) {
            const file = event.target.files[0];
            if (!file) return;
            if (!hasPermission('recipe.edit')) {
                showNotification('⚠️ No tienes permiso para importar recetas');
                event.target.value = '';
                return;
            }
            if (typeof XLSX === 'undefined') {
                showNotification('⏳ Cargando librería Excel… intenta en unos segundos');
                event.target.value = '';
                return;
            }
            showNotification('⏳ Leyendo ' + file.name + '…');
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                        showNotification('El archivo no contiene hojas válidas'); return;
                    }
                    // A diferencia de Compras/Catálogo (primera hoja), aquí se busca
                    // la hoja "Recetas" por nombre — el Excel real trae 13 hojas y la
                    // que interesa no es necesariamente la primera.
                    var nombreHoja = workbook.SheetNames.find(function(n) {
                        return _normCabCompras(n) === 'recetas';
                    }) || workbook.SheetNames[0];
                    const sheet = workbook.Sheets[nombreHoja];
                    if (!sheet) { showNotification('No se encontró una hoja "Recetas" en el archivo'); return; }
                    const filas = XLSX.utils.sheet_to_json(sheet);
                    if (!filas || filas.length === 0) { showNotification('La hoja "Recetas" no contiene datos'); return; }

                    const parsed = _parsearExcelRecetario(filas);
                    _recetarioImportPendiente = parsed;
                    recetarioImportView = 'vista_previa';
                    renderTab();
                } catch (err) {
                    console.error('[Recetario] Error leyendo el Excel:', err);
                    showNotification('❌ No se pudo leer el archivo — revisa que sea el Excel real con la hoja "Recetas"');
                }
            };
            reader.onerror = function() { showNotification('❌ Error leyendo el archivo'); };
            reader.readAsArrayBuffer(file);
            event.target.value = '';
        }
        window.handleFileImportRecetario = handleFileImportRecetario;

        function confirmarImportacionRecetario() {
            const parsed = _recetarioImportPendiente;
            if (!parsed || !parsed.recetas || parsed.recetas.length === 0) return;

            _crearBackupNombrado('pre_importacion_recetario_' + Date.now());
            const now = Date.now();
            var creadas = 0, actualizadas = 0;

            parsed.recetas.forEach(function(g) {
                if (g.recetaExistenteId) {
                    var receta = _recetaPorId(g.recetaExistenteId);
                    if (receta) {
                        receta.pv = g.pv; // adopta el código real también cuando venía de una coincidencia por nombre
                        receta.nombre = g.nombre;
                        receta.categoria = g.categoria;
                        receta.activa = g.activa;
                        receta.ingredientes = g.ingredientes;
                        receta._v = (receta._v || 1) + 1;
                        receta.actualizadoPor = currentUserUid;
                        receta.actualizadoEn = now;
                        actualizadas++;
                        return;
                    }
                }
                recetas.push({
                    id: _generarRecetaId(), pv: g.pv, nombre: g.nombre, categoria: g.categoria, activa: g.activa,
                    ingredientes: g.ingredientes, metodo: '', cristaleria: '', hielo: '', decoracion: '', _v: 1,
                    creadoPor: currentUserUid, creadoEn: now, actualizadoPor: currentUserUid, actualizadoEn: now
                });
                creadas++;
            });

            saveToLocalStorage();
            // FASE 11A — cambió el recetario: el consumo teórico se recalcula.
            if (typeof consumoTeoricoInvalidar === 'function') consumoTeoricoInvalidar();
            _recetarioImportPendiente = null;
            _recetarioImportResultado = { creadas: creadas, actualizadas: actualizadas, recetas: parsed.recetas };
            recetarioImportView = 'incidencias';
            showNotification('✅ ' + creadas + ' receta(s) nueva(s), ' + actualizadas + ' actualizada(s) — publica el recetario para que todos las vean');
            if (typeof activeTab !== 'undefined' && activeTab === 'recetario') renderTab();
        }
        window.confirmarImportacionRecetario = confirmarImportacionRecetario;

        function cancelarImportacionRecetario() {
            _recetarioImportPendiente = null;
            recetarioImportView = 'lista';
            renderTab();
        }
        window.cancelarImportacionRecetario = cancelarImportacionRecetario;

        function cerrarResultadoImportacionRecetario() {
            _recetarioImportResultado = null;
            recetarioImportView = 'lista';
            renderTab();
        }
        window.cerrarResultadoImportacionRecetario = cerrarResultadoImportacionRecetario;

        // Enlace "ver detalle" de una tarjeta de la vista previa — mismo patrón
        // que _comprasVerIncidenciasGrupo.
        function _recetarioVerIncidenciasGrupo(pv) {
            if (!_recetarioImportPendiente) return;
            var g = _recetarioImportPendiente.recetas.find(function(r) { return r.pv === pv; });
            if (!g) return;
            _recetarioImportResultado = { creadas: 0, actualizadas: 0, recetas: [g] };
            recetarioImportView = 'incidencias';
            renderTab();
        }
        window._recetarioVerIncidenciasGrupo = _recetarioVerIncidenciasGrupo;
