        function renderInventarioTab() {
            // ── PANTALLA DE CONTEO ─────────────────────────────────────────────
            if (auditoriaView === 'counting' && auditoriaAreaActiva) {
                return renderAuditoriaConteo();
            }
            // ETAPA 15 — HISTORIAL DE INVENTARIOS FÍSICOS
            if (auditoriaView === 'historial') {
                return renderHistorialInventarios();
            }
            if (auditoriaView === 'detalle_cerrado' && _detalleInventarioCerradoId) {
                return renderDetalleInventarioCerrado();
            }
            // ── PANTALLA DE SELECCIÓN DE ÁREAS (default) ───────────────────────
            return renderAuditoriaSeleccion();
        }

        // ── Pantalla 1: Selección de área ──────────────────────────────────────
        // ══════════════════════════════════════════════════════════════════════
        //  ETAPA 15 — UI del Inventario Físico
        // ══════════════════════════════════════════════════════════════════════

        // Tarjeta de estado en tiempo real — visible para admin y usuario.
        // Se alimenta de _inventarioActivo (mantenido por _suscribirInventarioActivo).
        function _renderInventarioFisicoHeader() {
            let html = '<div class="bg-white rounded-xl p-4 sm:p-5 mb-4 shadow-md">';

            if (!_inventarioActivo) {
                // R7: el estado vacio invita a crear en vez de constatar que no hay nada.
                html += '<p style="font-size:0.86rem;font-weight:600;color:var(--txt-primary);margin-bottom:4px;">Sin Inventario Físico abierto</p>';
                html += '<p style="font-size:0.75rem;color:var(--txt-muted);line-height:1.5;">'
                     +  (isAdmin()
                         ? 'Crea uno para que el equipo pueda empezar a contar. El número se asigna solo.'
                         : 'El administrador todavía no ha abierto el inventario de esta semana.')
                     +  '</p>';
                if (typeof renderGlosarioEstados === 'function') html += renderGlosarioEstados();
                html += '</div>';
                return html;
            }

            const inv = _inventarioActivo;
            const esCerrado = inv.estado === 'CERRADO';
            const badge = esCerrado
                ? '<span style="background:rgba(107,114,128,.12);color:#4b5563;padding:3px 10px;border-radius:999px;font-size:0.68rem;font-weight:700;">🔒 INVENTARIO BARRA CERRADO</span>'
                : '<span style="background:rgba(34,197,94,.12);color:#16a34a;padding:3px 10px;border-radius:999px;font-size:0.68rem;font-weight:700;">🟢 INVENTARIO BARRA SINCRONIZADO</span>';

            // Artículos contados = productos con al menos una entrada de conteo
            // de ALGÚN usuario (unión, no suma) — dato ya disponible en memoria,
            // sin lecturas adicionales a Firestore.
            const productosContados = new Set();
            Object.values(allUsersAuditoria).forEach(function(u) {
                Object.keys(u.conteo || {}).forEach(function(pid) { productosContados.add(pid); });
            });

            html += '<div class="flex items-start justify-between gap-3 flex-wrap">';
            html += '<div>';
            html += '<div class="flex items-center gap-2 mb-1">';
            html += '<span style="font-size:1rem;font-weight:800;color:var(--txt-strong);">#' + (inv.numero || '—') + ' · Inventario Barra</span>';
            html += '</div>';
            html += '<div style="margin-bottom:4px;">' + badge + '</div>';
            html += '<p style="font-size:0.72rem;color:var(--txt-muted);">Fecha: ' + new Date(inv.fechaCreacion).toLocaleDateString('es-MX') + ' &nbsp;·&nbsp; Creado por: ' + escapeHtml(inv.creadoPorNombre || '—') + ' (' + escapeHtml(inv.creadoPorRol || '') + ')</p>';
            if (esCerrado) {
                html += '<p style="font-size:0.72rem;color:var(--txt-muted);">Cerrado: ' + new Date(inv.fechaCierre).toLocaleDateString('es-MX') + ' por ' + escapeHtml(inv.cerradoPorNombre || '—') + '</p>';
            }
            html += '<p style="font-size:0.72rem;color:var(--txt-muted);margin-top:2px;">Artículos contados: ' + productosContados.size + ' / ' + products.length + '</p>';

            // ── R7: lo que el formulario dejo escrito ────────────────────────
            // Se lee siempre a la defensiva: los inventarios creados antes de R7
            // no tienen ninguno de estos campos.
            if (inv.fechaRecuento) {
                var _cl = (typeof clasificarRecuento === 'function') ? clasificarRecuento(inv.fechaRecuento) : null;
                html += '<p style="font-size:0.72rem;color:var(--txt-muted);margin-top:2px;">Recuento: '
                     +  escapeHtml(inv.fechaRecuento)
                     +  (_cl && typeof etiquetaSemana === 'function' ? ' · ' + escapeHtml(etiquetaSemana(inv.fechaRecuento)) : '')
                     +  (_cl && _cl.cierraSemana ? ' · <span style="color:var(--green,#4ade80);font-weight:600;">cierra semana</span>' : '')
                     +  '</p>';
            }
            if (Array.isArray(inv.warehousesSnapshot) && inv.warehousesSnapshot.length) {
                html += '<p style="font-size:0.72rem;color:var(--txt-muted);margin-top:2px;">Áreas: '
                     +  escapeHtml(inv.warehousesSnapshot.map(function(a) {
                            return (typeof areasAuditoria !== 'undefined' && areasAuditoria[a]) ? areasAuditoria[a] : a;
                        }).join(', '))
                     +  '</p>';
            }
            // Cuantas personas tienen algo contado. Es el dato que el admin mira
            // antes de cerrar: cerrar con gente contando pierde su trabajo.
            var _contando = (typeof _usuariosContando === 'function') ? _usuariosContando() : 0;
            if (!esCerrado) {
                html += '<p style="font-size:0.72rem;margin-top:2px;color:'
                     +  (_contando ? 'var(--accent)' : 'var(--txt-muted)') + ';font-weight:'
                     +  (_contando ? '600' : '400') + ';">Usuarios contando: ' + _contando + '</p>';
            }
            if (inv.comentario) {
                html += '<p style="font-size:0.72rem;color:var(--txt-secondary);margin-top:6px;'
                     +  'padding-left:8px;border-left:2px solid var(--border-mid);line-height:1.5;">'
                     +  escapeHtml(inv.comentario) + '</p>';
            }
            html += '</div>';

            html += '<div class="flex flex-col gap-2" style="align-items:flex-end;">';
            if (isAdmin() && !esCerrado && hasPermission('inventory.closeGlobal')) {
                html += '<button onclick="cerrarInventarioFisico()" style="padding:6px 12px;border-radius:var(--r-md);background:#1f2937;color:#fff;font-size:0.7rem;font-weight:700;cursor:pointer;white-space:nowrap;">🔒 Cerrar Inventario Físico</button>';
            }
            if (hasPermission('inventory.history')) {
                html += '<button onclick="auditoriaView=\'historial\'; _historialInventarios=null; renderTab(); _cargarHistorialInventarios().then(renderTab);" style="padding:5px 10px;border-radius:var(--r-md);background:var(--accent-dim);color:var(--accent);font-size:0.68rem;font-weight:600;cursor:pointer;white-space:nowrap;">📜 Historial</button>';
            }
            html += '</div>';
            html += '</div>';
            html += '</div>';
            return html;
        }

        // Historial — carga bajo demanda (ver _cargarHistorialInventarios).
        // Admin ve todos los cerrados; usuario normal ve solo aquellos donde
        // participó (filtrado por participantesUids, ya viene en el doc — sin
        // leer snapshots para armar la lista).
        function renderHistorialInventarios() {
            let html = '<div class="audit-screen">';
            html += '<div class="bg-white rounded-xl p-4 sm:p-5 mb-4 shadow-md">';
            html += '<div class="flex items-center justify-between mb-3">';
            html += '<p class="audit-header-title">📜 Historial de Inventarios Físicos</p>';
            html += '<button onclick="auditoriaView=\'selection\'; renderTab();" style="padding:5px 10px;border-radius:var(--r-md);background:var(--bg-soft);font-size:0.7rem;font-weight:600;cursor:pointer;">← Volver</button>';
            html += '</div>';

            if (_historialInventarios === null) {
                html += '<p style="font-size:0.8rem;color:var(--txt-muted);">⏳ Cargando historial…</p></div></div>';
                return html;
            }

            let lista = _historialInventarios;
            if (!isAdmin()) {
                lista = lista.filter(function(inv) {
                    return Array.isArray(inv.participantesUids) && inv.participantesUids.indexOf(currentUserUid) !== -1;
                });
            }

            if (lista.length === 0) {
                html += '<p style="font-size:0.8rem;color:var(--txt-muted);">' + (isAdmin() ? 'Todavía no hay inventarios cerrados.' : 'Todavía no participaste en ningún inventario cerrado.') + '</p>';
            } else {
                lista.forEach(function(inv) {
                    html += '<div onclick="_detalleInventarioCerradoId=\'' + inv.inventoryId + '\'; _detalleInventarioCerradoData=null; auditoriaView=\'detalle_cerrado\'; renderTab();" style="cursor:pointer;padding:10px 12px;border:1px solid var(--border-soft);border-radius:var(--r-md);margin-bottom:8px;">';
                    html += '<div class="flex items-center justify-between">';
                    html += '<span style="font-weight:700;font-size:0.82rem;">#' + inv.numero + ' | Inventario Barra</span>';
                    // FASE 3 — un inventario contabilizado ya no es solo
                    // "cerrado": su resultado pasó a ser el inicial de la
                    // semana siguiente, y eso se ve de un vistazo.
                    var _contab = (inv.estado === 'CONTABILIZADO');
                    html += '<span style="font-size:0.68rem;font-weight:700;color:'
                         +  (_contab ? '#2563eb' : '#16a34a') + ';">'
                         +  (_contab ? 'CONTABILIZADO' : 'CERRADO') + '</span>';
                    html += '</div>';
                    html += '<p style="font-size:0.72rem;color:var(--txt-muted);">Fecha: ' + new Date(inv.fechaCreacion).toLocaleDateString('es-MX') + ' &nbsp;·&nbsp; Artículos: ' + (inv.totalProductos || '—') + '</p>';
                    if (_contab && inv.semanaDestino) {
                        html += '<p style="font-size:0.7rem;color:#2563eb;font-weight:600;">📘 Inicial de la semana '
                             +  escapeHtml(inv.semanaDestino) + '</p>';
                    }
                    html += '</div>';
                });
            }
            html += '</div></div>';
            return html;
        }

        // Detalle de un inventario cerrado — SOLO LECTURA. Carga su snapshot
        // (bajo demanda, la primera vez que se abre) y ofrece exportar.
        function renderDetalleInventarioCerrado() {
            let html = '<div class="audit-screen">';
            html += '<div class="bg-white rounded-xl p-4 sm:p-5 mb-4 shadow-md">';
            html += '<div class="flex items-center justify-between mb-3">';
            html += '<p class="audit-header-title">🔒 Inventario Físico (solo lectura)</p>';
            html += '<button onclick="auditoriaView=\'historial\'; renderTab();" style="padding:5px 10px;border-radius:var(--r-md);background:var(--bg-soft);font-size:0.7rem;font-weight:600;cursor:pointer;">← Volver al historial</button>';
            html += '</div>';

            if (_detalleInventarioCerradoData === null) {
                html += '<p style="font-size:0.8rem;color:var(--txt-muted);">⏳ Cargando snapshot…</p></div></div>';
                const invRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID).collection('inventories').doc(_detalleInventarioCerradoId);
                Promise.all([invRef.get(), _readChunkedSubcollection(invRef, 'snapshotChunks')]).then(function(res) {
                    const invSnap = res[0];
                    _detalleInventarioCerradoData = { meta: invSnap.exists ? invSnap.data() : null, registros: res[1] || [] };
                    renderTab();
                }).catch(function(err) {
                    console.error('[InventarioFisico] Error cargando detalle:', err);
                    _detalleInventarioCerradoData = { meta: null, registros: [] };
                    renderTab();
                });
                return html;
            }

            const meta = _detalleInventarioCerradoData.meta;
            const registros = _detalleInventarioCerradoData.registros;
            if (!meta) {
                html += '<p style="font-size:0.8rem;color:var(--red-text);">No se pudo cargar este inventario.</p></div></div>';
                return html;
            }
            const usuarios = registros.filter(function(r) { return r.tipo === 'usuario'; });
            const productosSnap = registros.filter(function(r) { return r.tipo === 'producto'; });

            html += '<p style="font-size:0.9rem;font-weight:800;">#' + meta.numero + ' · Inventario Barra</p>';
            html += '<p style="font-size:0.72rem;color:var(--txt-muted);margin-bottom:10px;">';
            html += 'Creado: ' + new Date(meta.fechaCreacion).toLocaleDateString('es-MX') + ' por ' + escapeHtml(meta.creadoPorNombre || '—') + '<br>';
            html += 'Cerrado: ' + new Date(meta.fechaCierre).toLocaleDateString('es-MX') + ' por ' + escapeHtml(meta.cerradoPorNombre || '—') + '<br>';
            html += 'Productos: ' + (meta.totalProductos || productosSnap.length) + ' &nbsp;·&nbsp; Participantes: ' + usuarios.length;
            html += '</p>';

            if (hasPermission('inventory.export')) {
                html += '<button onclick="exportarInventarioCerrado(\'' + _detalleInventarioCerradoId + '\', ' + meta.numero + ')" style="padding:7px 14px;border-radius:var(--r-md);background:var(--accent);color:#fff;font-size:0.75rem;font-weight:700;cursor:pointer;margin-bottom:10px;">📥 Exportar Excel</button>';
            }

            // ── FASE 3 · CONTABILIZAR ────────────────────────────────────────
            // El botón no se limita a estar o no estar: cuando no se puede, dice
            // POR QUÉ. Un control gris sin explicación manda al administrador a
            // adivinar, y aquí las tres razones posibles son muy distintas
            // entre sí.
            if (meta.estado === 'CONTABILIZADO') {
                html += '<div style="padding:9px 12px;border-radius:var(--r-md);background:#eff6ff;'
                     +  'border-left:3px solid #2563eb;margin-bottom:10px;">'
                     +  '<p style="font-size:0.75rem;font-weight:700;color:#1d4ed8;margin:0;">📘 Contabilizado</p>'
                     +  '<p style="font-size:0.7rem;color:var(--txt-muted);margin:2px 0 0;">'
                     +  'Su resultado es el stock inicial de la semana ' + escapeHtml(meta.semanaDestino || '—')
                     +  (meta.contabilizadoEn ? ' · ' + new Date(meta.contabilizadoEn).toLocaleDateString('es-MX') : '')
                     +  '</p></div>';
            } else if (hasPermission('inventory.post')) {
                var _cl = (typeof clasificarRecuento === 'function' && meta.fechaRecuento)
                          ? clasificarRecuento(meta.fechaRecuento) : null;
                var _motivo = null;
                if (!meta.semanaId) {
                    _motivo = 'Este inventario se cerró antes de que se guardara la semana en su cabecera.';
                } else if (!_cl || !_cl.cierraSemana) {
                    _motivo = 'Solo se contabiliza un recuento fechado en DOMINGO. Este está fechado '
                            + (meta.fechaRecuento || 'sin fecha de recuento')
                            + ', y un corte a media semana partiría el ciclo en dos.';
                }
                if (_motivo) {
                    html += '<div style="padding:9px 12px;border-radius:var(--r-md);background:var(--bg-soft);'
                         +  'border-left:3px solid var(--amber,#f59e0b);margin-bottom:10px;">'
                         +  '<p style="font-size:0.72rem;color:var(--txt-muted);margin:0;">'
                         +  '📘 No se puede contabilizar. ' + escapeHtml(_motivo) + '</p></div>';
                } else {
                    html += '<button onclick="contabilizarInventario(\'' + _detalleInventarioCerradoId + '\', ' + meta.numero + ')" '
                         +  'style="padding:7px 14px;border-radius:var(--r-md);background:#2563eb;color:#fff;'
                         +  'font-size:0.75rem;font-weight:700;cursor:pointer;margin-bottom:10px;margin-left:6px;">'
                         +  '📘 Contabilizar</button>';
                }
            }

            html += '<div style="max-height:320px;overflow-y:auto;border-top:1px solid var(--border-soft);padding-top:8px;">';
            usuarios.forEach(function(u) {
                const completas = AREAS_CONTEO.filter(function(a) { return u.status && u.status[a] === 'completada'; }).length;
                html += '<p style="font-size:0.75rem;margin-bottom:3px;"><b>' + escapeHtml(u.email) + '</b> — ' + completas + '/' + AREAS_CONTEO.length + ' áreas completadas' + (u.isAdmin ? ' (admin)' : '') + '</p>';
            });
            html += '</div>';

            html += '</div></div>';
            return html;
        }


        function renderAuditoriaSeleccion() {
            const totalCompletas = auditoriaTotalAreasCompletadas();
            // FASE 7 (C2) — antes dividía entre 3 fijo: con una 4ª área la barra
            // pasaba de 100 %, y con dos se quedaba corta. El texto de al lado
            // ya usaba AREAS_CONTEO.length; ahora los dos dicen lo mismo.
            const totalAreas = (typeof AREAS_CONTEO !== 'undefined' && AREAS_CONTEO.length) ? AREAS_CONTEO.length : 1;
            const porcentaje = Math.min(100, Math.round((totalCompletas / totalAreas) * 100));
            const todasCompletas = auditoriaTodasCompletas();
            const statusRef = isAdmin() ? auditoriaStatus : myAuditoriaStatus;

            let html = '<div class="audit-screen">';

            // ── ETAPA 15: encabezado de Inventario Físico (numero/estado/creador,
            //    en tiempo real vía _inventarioActivo) ─────────────────────────
            html += _renderInventarioFisicoHeader();

            // ── Header ────────────────────────────────────────────────────────
            html += '<div class="bg-white rounded-xl p-4 sm:p-5 mb-4 shadow-md">';
            html += '<div class="flex items-start justify-between gap-3 mb-3">';
            html += '<div>';
            html += '<p class="audit-header-title">Auditoría Física Ciega</p>';
            html += '<p class="audit-header-sub">' + (isAdmin()
                ? 'Panel de administrador — puedes ver todos los conteos y gestionar la sesión.'
                : 'Cuenta tu área y finaliza. Solo tú ves tu conteo; el admin lo revisa al final.') + '</p>';
            html += '</div>';
            // ETAPA 15 — FIX RIESGO DE PÉRDIDA (auditoría 2026-09-01): mismo
            // guard que auditoriaResetear() — el botón no se ofrece si hay un
            // Inventario Físico activo que no esté CERRADO, para que el admin
            // ni siquiera vea la opción que la función rechazaría.
            if (isAdmin() && hasPermission('inventory.create') && (!_inventarioActivo || _inventarioActivo.estado === 'CERRADO')) {
                html += '<button onclick="abrirModalNuevoInventario()" title="Crear nuevo Inventario Físico (solo admin)" style="flex-shrink:0;padding:6px 10px;border-radius:var(--r-md);background:var(--red-dim);border:1px solid rgba(239,68,68,0.18);color:var(--red-text);font-size:0.7rem;font-weight:600;cursor:pointer;white-space:nowrap;" class="flex items-center gap-1">';
                html += '<svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
                html += ' Nuevo Inventario Físico</button>';
            } else if (isAdmin() && hasPermission('inventory.create') && _inventarioActivo) {
                html += '<span title="Cierra el Inventario Físico #' + _inventarioActivo.numero + ' para poder iniciar uno nuevo" style="flex-shrink:0;padding:6px 10px;border-radius:var(--r-md);background:var(--bg-subtle,rgba(148,163,184,0.12));border:1px solid rgba(148,163,184,0.18);color:var(--txt-muted);font-size:0.7rem;font-weight:600;white-space:nowrap;" class="flex items-center gap-1">';
                html += '🔒 Cierra #' + _inventarioActivo.numero + ' primero</span>';
            }
            html += '</div>';
            // Barra de progreso
            html += '<div class="flex items-center gap-3">';
            html += '<div style="font-size:0.68rem;font-weight:600;color:var(--txt-muted);white-space:nowrap;">' + totalCompletas + ' / ' + AREAS_CONTEO.length + ' áreas</div>';
            html += '<div class="audit-progress-bar" style="flex:1;"><div class="audit-progress-fill" style="width:' + porcentaje + '%;"></div></div>';
            html += '<div style="font-size:0.68rem;font-weight:700;color:' + (todasCompletas ? 'var(--green)' : 'var(--accent)') + ';white-space:nowrap;">' + porcentaje + '%</div>';
            html += '</div>';
            html += '</div>';

            html += renderAuditUserPanel();

            // ── Panel de usuarios (solo quien puede ver conteos ajenos) ───────
            if (puedeVerConteosAjenos()) {
                html += _renderAdminUsersPanel();
            }

            html += renderAuditComparePanel();

            // ── Botones de área ───────────────────────────────────────────────
            html += '<div class="flex flex-col gap-3 mb-4">';
            AREAS_CONTEO.forEach(area => {
                const isCompleta = statusRef[area] === 'completada';
                const tieneUnlock = !isAdmin() && Object.keys(myAuditoriaUnlocks)
                    .some(k => k.endsWith('__' + area) && !myAuditoriaUnlocks[k].used);
                html += '<div class="audit-area-card' + (isCompleta ? ' completada' : '') + '"'
                      + ' onclick="auditoriaEntrarArea(\'' + area + '\')"'
                      + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();auditoriaEntrarArea(\'' + area + '\');}"'
                      + ' role="button" tabindex="0" aria-label="Entrar a ' + areasAuditoria[area] + '">';
                html += '<div class="audit-area-icon"><i class="' + areasAuditoriaFA[area] + '" style="font-size:1.2rem;color:' + (isCompleta ? 'var(--green)' : 'var(--accent)') + ';"></i></div>';
                html += '<div class="audit-area-info">';
                html += '<div class="audit-area-name">' + areasAuditoria[area] + '</div>';
                html += '<div class="audit-area-status ' + (isCompleta ? 'completada' : 'pendiente') + '">';
                html += isCompleta
                    ? '<svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg> Completada'
                    : '<span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;"></span> Pendiente';
                html += '</div>';
                if (isCompleta) {
                    // FASE 2B — auditoriaConteo es el agregado de TODAS las
                    // personas; myAuditoriaConteo es el propio. El criterio
                    // pasa a ser el permiso de privacidad, no el rol.
                    const conteoRef = puedeVerConteosAjenos() ? auditoriaConteo : myAuditoriaConteo;
                    const totalProductos = products.filter(p => conteoRef[p.id] && conteoRef[p.id][area] &&
                        (conteoRef[p.id][area].enteras > 0 || (conteoRef[p.id][area].abiertas || []).some(a => a > 0))).length;
                    html += '<div style="font-size:0.63rem;color:var(--txt-muted);margin-top:3px;">' + totalProductos + ' producto(s) con cantidad';
                    // D — el enlace se ofrece según el permiso, no según
                    // isAdmin(): es el mismo criterio que ahora aplica
                    // reabrirArea(), y así no se muestra una acción que el
                    // servidor va a rechazar.
                    if (hasPermission('inventory.reopenArea')) {
                        html += ' · <a href="#" onclick="event.stopPropagation();reabrirArea(\'' + area + '\');" style="color:var(--amber);text-decoration:underline;font-weight:600;">↩ Reabrir</a>';
                    } else if (tieneUnlock) {
                        html += ' · <span style="color:var(--amber);font-weight:600;">🔓 Corrección habilitada</span>';
                    } else {
                        html += ' · <span style="color:var(--green);font-weight:600;">🔒 Bloqueada</span>';
                    }
                    html += '</div>';
                } else if (hasPermission('inventory.closeOther')) {
                    // FASE 2A — cerrar el área para TODAS las personas deja
                    // de ser un efecto secundario de "finalizar mi conteo" y
                    // pasa a ser una acción visible y propia.
                    html += '<div style="font-size:0.63rem;margin-top:3px;">'
                          + '<a href="#" onclick="event.stopPropagation();auditoriaCerrarArea(\'' + area + '\');" '
                          + 'style="color:var(--amber);text-decoration:underline;font-weight:600;">'
                          + '🔒 Cerrar área para todos</a></div>';
                }
                html += '</div>';
                html += '<svg class="audit-area-arrow" width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 18l6-6-6-6"/></svg>';
                html += '</div>';
            });
            html += '</div>';

            // ── Botones de exportar (rol-específicos) ─────────────────────────
            if (todasCompletas) {
                html += '<div style="animation: springUp 0.26s var(--ease-out) both;">';
                if (isAdmin()) {
                    // Admin: descarga total + publica
                    html += '<button class="audit-export-btn" onclick="exportarExcelAdminTotal()">';
                    html += '<i class="fa-solid fa-file-excel" style="font-size:1.1rem;"></i>';
                    html += 'EXPORTAR INVENTARIO TOTAL (TODOS LOS USUARIOS)';
                    html += '</button>';
                    html += '<p style="text-align:center;font-size:0.68rem;color:var(--txt-muted);margin-top:8px;">Inventario consolidado de todos los almacenes y todos los usuarios</p>';
                    html += '<button onclick="generarYPublicarReporte()" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:8px;padding:10px 16px;border-radius:var(--r-md);background:var(--accent);color:#fff;font-size:0.8rem;font-weight:600;border:none;cursor:pointer;">';
                    html += '<i class="fa-solid fa-cloud-arrow-up"></i> Publicar Inventario Total para Todos los Usuarios';
                    html += '</button>';
                } else {
                    // Usuario: solo descarga su propio conteo
                    html += '<button class="audit-export-btn" onclick="exportarExcelMiConteo()">';
                    html += '<i class="fa-solid fa-file-excel" style="font-size:1.1rem;"></i>';
                    html += 'DESCARGAR MI CONTEO (ÁREAS FINALIZADAS)';
                    html += '</button>';
                    html += '<p style="text-align:center;font-size:0.68rem;color:var(--txt-muted);margin-top:8px;">Exporta únicamente tu conteo personal de las ' + AREAS_CONTEO.length + ' áreas</p>';
                }
                html += '</div>';
            } else {
                const faltantes = AREAS_CONTEO
                    .filter(a => statusRef[a] !== 'completada')
                    .map(a => areasAuditoria[a]).join(', ');
                html += '<div style="text-align:center;padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);">';
                html += '<p style="font-size:0.75rem;color:var(--txt-muted);">El botón de exportación aparecerá cuando completes todas las áreas.</p>';
                html += '<p style="font-size:0.7rem;color:var(--txt-muted);margin-top:4px;">Pendiente: <strong style="color:var(--amber);">' + faltantes + '</strong></p>';
                html += '</div>';
            }

            html += '</div>'; // audit-screen
            return html;
        }

        /**
         * _adminRelTime(ts) — formatea un timestamp en texto relativo compacto.
         * Ejemplo: "hace 5 s", "hace 2 min", "hace 1 h"
         */
        function _adminRelTime(ts) {
            if (!ts) return '';
            const diff = Math.floor((Date.now() - ts) / 1000);
            if (diff < 5)   return 'justo ahora';
            if (diff < 60)  return 'hace ' + diff + ' s';
            if (diff < 3600) return 'hace ' + Math.floor(diff / 60) + ' min';
            return 'hace ' + Math.floor(diff / 3600) + ' h';
        }

        /**
         * Panel admin: tabla en TIEMPO REAL de todos los usuarios con sus conteos.
         *
         * Mejoras vs versión anterior:
         *  • Muestra contador de productos contados incluso para áreas "Pendiente"
         *    (el Firestore onSnapshot ya alimenta allUsersAuditoria en tiempo real)
         *  • Dot verde pulsante "● EN VIVO" cuando hay usuarios contando
         *  • Badge animado "CONTANDO…" con número de productos en curso
         *  • Timestamp relativo ("hace 5 s") por usuario
         *  • Borde verde en tarjetas de usuarios activos
         *  • Total de botellas enteras + abiertas por área (no solo número de productos)
         */
        function _renderAdminUsersPanel() {
            const users = Object.values(allUsersAuditoria);
            if (users.length === 0) return '';

            const AREAS = AREAS_CONTEO;

            // ¿Hay algún usuario actualmente contando (área pendiente con productos ya cargados)?
            const hayAlguienContando = users.some(u =>
                AREAS.some(a => u.status[a] !== 'completada' &&
                    Object.keys(u.conteo).some(pid =>
                        u.conteo[pid] && u.conteo[pid][a] &&
                        (u.conteo[pid][a].enteras > 0 || (u.conteo[pid][a].abiertas || []).some(v => v > 0))
                    )
                )
            );

            let html = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:14px;margin-bottom:16px;">';

            // ── Cabecera del panel con indicador EN VIVO ────────────────────
            html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:10px;">';
            html += '<p style="font-size:0.75rem;font-weight:700;color:var(--txt-primary);margin:0;">👥 Conteos por usuario</p>';
            if (hayAlguienContando) {
                html += '<span style="display:inline-flex;align-items:center;gap:5px;font-size:0.62rem;font-weight:700;color:#22c55e;">'
                      + '<span class="audit-live-dot"></span>EN VIVO</span>';
            }
            html += '</div>';

            // ── Tarjeta por usuario ─────────────────────────────────────────
            users.forEach(function(u) {
                const areasOk        = AREAS.filter(a => u.status[a] === 'completada');
                const totalAreas     = areasOk.length;
                const isLive         = AREAS.some(a => u.status[a] !== 'completada' &&
                    Object.keys(u.conteo).some(pid =>
                        u.conteo[pid] && u.conteo[pid][a] &&
                        (u.conteo[pid][a].enteras > 0 || (u.conteo[pid][a].abiertas || []).some(v => v > 0))
                    )
                );
                const relTime = u.updatedAt ? _adminRelTime(u.updatedAt) : '';

                html += '<div class="audit-user-row' + (isLive ? ' live' : '') + '">';

                // Cabecera del usuario
                html += '<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:4px;">';
                html += '<div style="display:flex;flex-direction:column;gap:1px;">';
                html += '<span style="font-size:0.72rem;font-weight:600;color:var(--accent);">👤 ' + escapeHtml(u.email) + '</span>';
                if (relTime) {
                    html += '<span class="audit-timestamp">⏱ ' + relTime + '</span>';
                }
                html += '</div>';
                html += '<span style="font-size:0.65rem;color:var(--txt-muted);">' + totalAreas + '/' + AREAS_CONTEO.length + ' áreas</span>';
                html += '</div>';

                // ── Fila por área ───────────────────────────────────────────
                AREAS.forEach(function(area) {
                    const completada = u.status[area] === 'completada';

                    // Contar productos con cantidad en esta área (siempre, no solo si completada)
                    const prodsConCantidad = Object.keys(u.conteo).filter(function(pid) {
                        const d = u.conteo[pid] && u.conteo[pid][area];
                        return d && (d.enteras > 0 || (d.abiertas || []).some(function(v) { return v > 0; }));
                    });
                    const numProds = prodsConCantidad.length;

                    // Sumar totales de botellas para esta área
                    var totalEnteras = 0, totalAbiertas = 0;
                    prodsConCantidad.forEach(function(pid) {
                        var d = u.conteo[pid][area];
                        totalEnteras  += (d.enteras || 0);
                        totalAbiertas += (d.abiertas || []).reduce(function(s, v) { return s + (v || 0); }, 0);
                    });

                    const hayDatosEnCurso = !completada && numProds > 0;

                    html += '<div class="audit-area-row">';

                    // Nombre del área
                    html += '<span class="audit-area-row-label">' + areasAuditoria[area] + '</span>';

                    // Badge de estado
                    if (completada) {
                        html += '<span class="audit-done-badge">'
                              + '<svg width="9" height="9" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
                              + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>'
                              + ' Finalizado</span>';
                    } else if (hayDatosEnCurso) {
                        html += '<span class="audit-counting-badge">⬤ CONTANDO…</span>';
                    } else {
                        html += '<span style="font-size:0.62rem;color:var(--txt-muted);">Sin iniciar</span>';
                    }

                    // Contador de productos y botellas (siempre visible si hay datos)
                    if (numProds > 0) {
                        html += '<span class="audit-area-row-count">'
                              + numProds + ' prod'
                              + (numProds !== 1 ? 's' : '')
                              + ' · ' + totalEnteras + ' ent'
                              + (totalAbiertas > 0 ? ' · ' + totalAbiertas.toFixed(2) + ' ab' : '')
                              + '</span>';
                    }

                    // Botones de acción (solo áreas completadas)
                    if (completada) {
                        html += '<div style="display:flex;gap:4px;flex-shrink:0;">';
                        html += '<button onclick="adminVerConteoUsuario(\'' + escapeHtml(u.uid) + '\',\'' + area + '\')"'
                              + ' style="padding:2px 7px;border-radius:4px;background:var(--accent);color:#fff;font-size:0.62rem;border:none;cursor:pointer;">'
                              + 'Ver</button>';
                        html += '<button onclick="adminUnlockAreaUsuario(\'' + escapeHtml(u.uid) + '\',\'' + area + '\')"'
                              + ' style="padding:2px 7px;border-radius:4px;background:var(--amber);color:#fff;font-size:0.62rem;border:none;cursor:pointer;">'
                              + '🔓 Habilitar</button>';
                        // ETAPA 15: reapertura completa del almacén (distinto del
                        // desbloqueo por producto de arriba) — solo mientras el
                        // Inventario Físico esté SINCRONIZADO, solo con permiso.
                        if (hasPermission('inventory.reopenArea') && _inventarioActivo && _inventarioActivo.estado === 'SINCRONIZADO') {
                            html += '<button onclick="reabrirAlmacenAdmin(\'' + escapeHtml(u.uid) + '\',\'' + area + '\')"'
                                  + ' style="padding:2px 7px;border-radius:4px;background:#6366f1;color:#fff;font-size:0.62rem;border:none;cursor:pointer;">'
                                  + '🔄 Reabrir</button>';
                        }
                        html += '</div>';
                    }

                    html += '</div>'; // audit-area-row
                });

                html += '</div>'; // audit-user-row
            });

            html += '</div>'; // panel container
            return html;
        }

        /** Admin muestra el conteo de un usuario en un área específica */
        function adminVerConteoUsuario(uid, area) {
            const u = allUsersAuditoria[uid];
            if (!u) return;
            const prods = products.filter(p => u.conteo[p.id] && u.conteo[p.id][area] &&
                (u.conteo[p.id][area].enteras > 0 || (u.conteo[p.id][area].abiertas || []).some(v => v > 0)));
            if (prods.length === 0) { showNotification('Sin productos contados en esta área'); return; }
            const lines = prods.map(p => {
                const d = u.conteo[p.id][area];
                return escapeHtml(p.name) + ': ' + (d.enteras || 0) + ' ent, ' + (d.abiertas || []).length + ' ab';
            }).join('\n');
            showConfirm('Conteo de ' + u.email + ' — ' + areasAuditoria[area] + ':\n\n' + lines, function() {});
        }

        /** Admin habilita corrección de un área completa para un usuario (por producto) */
        function adminUnlockAreaUsuario(uid, area) {
            const u = allUsersAuditoria[uid];
            if (!u) return;
            // Mostrar lista de productos para elegir cuál desbloquear
            const prods = products.filter(p => u.conteo[p.id] && u.conteo[p.id][area]);
            if (prods.length === 0) { showNotification('No hay productos contados para desbloquear'); return; }
            // Por simplicidad: desbloquear todos los productos del área para ese usuario
            showConfirm('¿Habilitar corrección de TODOS los productos de ' + areasAuditoria[area] + ' para ' + u.email + '?\n\nEl usuario podrá modificar su conteo de esta área.', function() {
                Promise.all(prods.map(p => adminUnlockProducto(uid, p.id, area)))
                    .then(() => showNotification('🔓 Correcciones habilitadas para ' + u.email))
                    .catch(err => { console.error(err); showNotification('❌ Error al habilitar'); });
            });
        }

        // FASE 6 — región de resultados del conteo de un área. La llama
        // renderAuditoriaConteo() y, sin reconstruir la pantalla, BusquedaUI al
        // buscar o filtrar. Recalcula aquí lo que necesita (área, conteo de
        // referencia) para poder llamarse sola.
        function _renderConteoResultados() {
            const area = auditoriaAreaActiva;
            const conteoRef = puedeVerConteosAjenos() ? auditoriaConteo : myAuditoriaConteo;
            const r   = _buscarConteo(area, conteoRef);
            const filteredProducts = r.items;
            const lim = BusquedaUI.limite('conteo');
            let html = '';
            html += BusquedaUI.resumen('conteo', r.coincidencias, r.total, 'producto', 'productos');
            html += '<div class="flex flex-col gap-3">';

            if (filteredProducts.length === 0) {
                html += BusquedaUI.vacio('conteo', 'productos');
            } else {
                filteredProducts.slice(0, lim).forEach((product, idx) => {
                    // Leer conteo de auditoría (no del inventario operativo)
                    const areaData = (conteoRef[product.id] && conteoRef[product.id][area]) || { enteras: 0, abiertas: [] };
                    const enteras  = areaData.enteras || 0;
                    const abiertas = areaData.abiertas || [];
                    const hasData  = enteras > 0 || abiertas.some(a => a > 0);
                    const hasExtra = abiertas.length > 1;
                    const isExpanded = expandedCards.has(product.id);
                    const delay = Math.min(idx * 35, 350);
                    const usaConversion = tieneConversion(product);

                    // Total con conversión
                    let totalFinal = enteras;
                    if (usaConversion) {
                        abiertas.forEach(oz => { totalFinal += convertirOzAPuntos(oz, product.capacidadMl, product.pesoBotellaLlenaOz); });
                    } else {
                        abiertas.forEach(v => { totalFinal += (v || 0); });
                    }

                    const puntosAbiertas = abiertas.map(pesoOz =>
                        usaConversion
                            ? convertirOzAPuntos(pesoOz, product.capacidadMl, product.pesoBotellaLlenaOz)
                            : pesoOz
                    );

                    // FIX #4: onkeydown para activar la tarjeta con Enter/Espacio desde teclado
                    html += '<div class="inv-card' + (hasData ? ' has-data' : '') + (areaData.alerta_conflicto ? ' inv-card--conflict' : '') + '" data-sbx-item'
                          + ' onclick="openInventarioModal(\'' + escapeHtml(product.id) + '\')"'
                          + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openInventarioModal(\'' + escapeHtml(product.id) + '\');}"'
                          + ' role="button" tabindex="0" aria-label="Contar ' + escapeHtml(product.name) + '" style="animation-delay:' + delay + 'ms">';
                    html += '<div class="inv-card__ripple"></div>';

                    html += '<div class="inv-card__header">';
                    html += '<div style="min-width:0;flex:1">';
                    html += '<div class="inv-card__name">' + resaltarBusqueda(product.name, _conteoSearchTerm) + '</div>';
                    html += '<span class="inv-card__group-badge">' + escapeHtml(product.group || 'General') + '</span>';
                    if (areaData.alerta_conflicto) {
                        html += '<div class="inv-card__conflict-badge"><i class="fa-solid fa-triangle-exclamation"></i> Conflicto abierta</div>';
                    }
                    html += '</div>';
                    // HOTFIX: en modo cantidad (KGS/LTS/PZA) el conteo admite hasta
                    // 3 decimales (ver 70-conversion-render.js); toFixed(2) fijo aqui
                    // redondeaba la vista a 2 y ocultaba, por ejemplo, 1.245 -> "1.25".
                    // El dato guardado siempre fue exacto: esto solo corrige la vista.
                    const totalFinalTexto = usaConversion ? totalFinal.toFixed(2) : String(Math.round(totalFinal * 1000) / 1000);
                    html += '<span class="inv-card__code" title="Total (enteras + fracciones de abiertas)">' + totalFinalTexto + ' u</span>';
                    html += '</div>';

                    html += '<div class="inv-card__chips">';
                    html += '<div class="inv-chip entera' + (enteras === 0 ? ' empty' : '') + '">';
                    html += '<span class="inv-chip__val">' + (enteras > 0 ? enteras : '0') + '</span>';
                    html += '<span class="inv-chip__label">Entera</span>';
                    html += '</div>';

                    const pt1 = puntosAbiertas.length > 0 ? puntosAbiertas[0] : 0;
                    const ab1Raw = abiertas.length > 0 ? abiertas[0] : 0;
                    const ab1Label = usaConversion ? (pt1 * 100).toFixed(0) + '%' : pt1.toFixed(2);
                    html += '<div class="inv-chip abierta' + (pt1 === 0 ? ' empty' : '') + '">';
                    html += '<span class="inv-chip__val">' + ab1Label + '</span>';
                    html += '<span class="inv-chip__label">' + (usaConversion ? ab1Raw.toFixed(1) + ' oz' : 'Abierta 1') + '</span>';
                    html += '</div>';

                    html += '</div>'; // FIX-3: cierre de .inv-card__chips ANTES de chips extra

                    if (hasExtra) {
                        // FIX-3: wrap chips extra en .inv-card__extra con id="card-extra-{id}"
                        // para que toggleCardExpand() lo encuentre y aplique la clase .open
                        html += '<div class="inv-card__extra' + (isExpanded ? ' open' : '') + '" id="card-extra-' + escapeHtml(product.id) + '">';
                        puntosAbiertas.slice(1).forEach((pt, i) => {
                            const rawOz = abiertas[i + 1] || 0;
                            const chipLabel = usaConversion ? (pt * 100).toFixed(0) + '%' : pt.toFixed(2);
                            html += '<div class="inv-chip abierta' + (pt === 0 ? ' empty' : '') + '">';
                            html += '<span class="inv-chip__val">' + chipLabel + '</span>';
                            html += '<span class="inv-chip__label">' + (usaConversion ? rawOz.toFixed(1) + ' oz' : 'Abierta ' + (i + 2)) + '</span>';
                            html += '</div>';
                        });
                        html += '</div>'; // close .inv-card__extra
                    }

                    if (hasExtra) {
                        html += '<button class="inv-card__expand-btn' + (isExpanded ? ' open' : '') + '" id="card-expand-btn-' + escapeHtml(product.id) + '" onclick="toggleCardExpand(\'' + escapeHtml(product.id) + '\', event)" aria-expanded="' + isExpanded + '">';
                        html += '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/></svg>';
                        html += '<span>' + (isExpanded ? 'Ocultar' : 'Ver más abiertas') + '</span>';
                        html += '<span style="font-size:0.65rem;opacity:0.7;margin-left:2px">(+' + (abiertas.length - 1) + ')</span>';
                        html += '</button>';
                    }
                    html += '</div>'; // inv-card

                    // ── Trail multiusuario (quién contó, cuánto, cuándo, diferencias) ──
                    html += renderAuditTrailForProduct(product.id, area); // FIX-04: usa var local en lugar de global
                });
            }
            html += '</div>'; // flex flex-col gap-3
            html += BusquedaUI.centinela('conteo', filteredProducts.length - lim);
            return { html: html, coincidencias: r.coincidencias, total: r.total };
        }

        // ── Pantalla 2: Conteo de un área específica ───────────────────────────
        function renderAuditoriaConteo() {
            const area = auditoriaAreaActiva;
            const nombreArea = areasAuditoria[area];
            // Para el usuario: usa myAuditoriaStatus; para el admin: auditoriaStatus
            const estaCompleta = isAdmin()
                ? (auditoriaStatus[area] === 'completada')
                : (myAuditoriaStatus[area] === 'completada');
            // Usuario con área completada → solo lectura SALVO que tenga unlock pendiente
            const tieneUnlocksPendientes = !isAdmin() && Object.keys(myAuditoriaUnlocks)
                .some(k => k.endsWith('__' + area) && !myAuditoriaUnlocks[k].used);
            const soloLectura = estaCompleta && !isAdmin() && !tieneUnlocksPendientes;
            // Conteo a mostrar en las tarjetas
            // FASE 2B — el criterio deja de ser el rol y pasa a ser el
            // permiso de privacidad: auditoriaConteo agrega el conteo de
            // todas las personas, myAuditoriaConteo es solo el propio.
            const conteoRef = puedeVerConteosAjenos() ? auditoriaConteo : myAuditoriaConteo;

            let html = '<div class="audit-screen">';

            // ── Header sticky del área ────────────────────────────────────────
            html += '<div class="audit-count-header">';
            html += '<div class="flex items-center justify-between gap-3">';
            html += '<div class="flex items-center gap-3">';
            html += '<button class="audit-back-btn" onclick="auditoriaVolverSeleccion()">';
            html += '<i class="fa-solid fa-chevron-left"></i> Áreas';
            html += '</button>';
            html += '<div>';
            html += '<div class="audit-count-area-badge">' + areasAuditoriaIcons[area] + ' &nbsp;' + nombreArea + '</div>';
            if (soloLectura) {
                // FIX #4 — Mensaje claro de que el área está bloqueada para el bartender
                html += '<div style="font-size:0.62rem;color:var(--amber);margin-top:4px;font-weight:600;">🔒 Área completada — solicita al administrador reabrir para corregir</div>';
            } else if (estaCompleta && isAdmin()) {
                html += '<div style="font-size:0.62rem;color:var(--green);margin-top:4px;font-weight:600;">✓ Área completada — editando como administrador</div>';
            }
            html += '</div>';
            html += '</div>';
            // Contador de productos ingresados
            const ingresados = products.filter(p => conteoRef[p.id] && conteoRef[p.id][area] && (conteoRef[p.id][area].enteras > 0 || (conteoRef[p.id][area].abiertas || []).some(a => a > 0))).length;
            html += '<div style="text-align:right;">';
            html += '<div style="font-size:0.65rem;font-weight:600;color:var(--txt-muted);">Con cantidad</div>';
            html += '<div style="font-family:\'IBM Plex Mono\',monospace;font-weight:700;font-size:1rem;color:var(--accent);">' + ingresados + '<span style="font-size:0.65rem;font-weight:500;color:var(--txt-muted);">/' + products.length + '</span></div>';
            html += '</div>';
            html += '</div></div>'; // end audit-count-header

            // ── Pantalla bloqueada para bartender ────────────────────────────
            // FIX #4: Si soloLectura, mostrar vista de resumen en lugar del formulario
            if (soloLectura) {
                html += '<div style="margin:16px 0;padding:20px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);text-align:center;">';
                html += '<div style="font-size:2rem;margin-bottom:8px;">🔒</div>';
                html += '<p style="font-size:0.85rem;font-weight:600;color:var(--txt-primary);margin-bottom:6px;">Tu conteo de "' + nombreArea + '" está registrado</p>';
                html += '<p style="font-size:0.75rem;color:var(--txt-muted);">Si necesitas hacer correcciones, pide al administrador que reabra esta área.</p>';
                html += '<div style="margin-top:16px;padding:12px;background:var(--bg);border-radius:var(--r-md);">';
                html += '<p style="font-size:0.7rem;font-weight:600;color:var(--txt-muted);margin-bottom:8px;">Resumen de tu conteo:</p>';
                const resumen = products.filter(p => {
                    const d = conteoRef[p.id] && conteoRef[p.id][area];
                    return d && (d.enteras > 0 || (d.abiertas || []).some(v => v > 0));
                });
                if (resumen.length === 0) {
                    html += '<p style="font-size:0.72rem;color:var(--txt-muted);">No se registraron cantidades en esta área.</p>';
                } else {
                    resumen.slice(0, 8).forEach(p => {
                        const d = conteoRef[p.id][area];
                        const key = p.id + '__' + area;
                        const hasUnlock = myAuditoriaUnlocks[key] && !myAuditoriaUnlocks[key].used;
                        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);font-size:0.72rem;">';
                        html += '<span style="color:var(--txt-primary);">' + escapeHtml(p.name) + (hasUnlock ? ' <span style="color:var(--amber);">🔓</span>' : '') + '</span>';
                        html += '<span style="color:var(--accent);font-weight:600;">' + (d.enteras || 0) + ' ent · ' + (d.abiertas || []).length + ' ab</span>';
                        html += '</div>';
                    });
                    if (resumen.length > 8) {
                        html += '<p style="font-size:0.68rem;color:var(--txt-muted);margin-top:6px;">... y ' + (resumen.length - 8) + ' producto(s) más</p>';
                    }
                }
                html += '</div>';
                html += '</div>';
                html += '</div>'; // audit-screen
                return html;
            }

            // ── Pill-rail de grupos (horizontal, reemplaza <select>) ──────────
            html += '<div class="grp-rail-wrap"><div class="grp-rail">';
            getAvailableGroups().forEach(function(group) {
                var isActive = selectedGroup === group;
                html += '<button type="button" class="grp-pill' + (isActive ? ' grp-pill--active' : '') + '"'
                      + ' onclick="updateSelectedGroup(\'' + escapeHtml(group).replace(/'/g, '&#39;') + '\')">'
                      + escapeHtml(group)
                      + '</button>';
            });
            html += '</div></div>';

            // ── Buscador (FASE 6: barra unificada) ───────────────────────────────
            // Sin `sticky`: el encabezado del área ya es pegajoso y dos barras
            // pegajosas apiladas se tapan entre sí.
            html += BusquedaUI.barra('conteo', {
                placeholder: 'Buscar por nombre, código o grupo…',
                etiqueta: 'Buscar producto en el conteo'
            });
            html += BusquedaUI.chips('conteo', _chipsConteo(area, conteoRef));

            html += '<p class="text-xs text-gray-400 mb-3 px-1">Conteo ciego — toca cada producto para ingresar la cantidad física</p>';

            // ── Barra de estado multiusuario para el área actual ─────────────────
            // FIX-06: bloque { } limpio en lugar de IIFE innecesario
            // FASE 2B — esta barra dice cuántos dispositivos contaron el área y
            // cuántas diferencias hay entre ellos. Es información agregada, pero
            // sigue siendo información DERIVADA del conteo de otras personas y no
            // tenía ninguna guarda de rol: un bartender sabía en tiempo real si su
            // cifra discrepaba de la de su compañero, que es justo lo que el
            // conteo ciego debe impedir.
            if (puedeVerConteosAjenos()) {
                const auditUniqUsers = new Set();
                let   auditNConf     = 0;
                products.forEach(p => {
                    const auditSt = calcAuditStats(p.id, area);
                    if (auditSt) {
                        auditSt.totals.forEach(t => auditUniqUsers.add(t.userId));
                        if (auditSt.hasConflict) auditNConf++;
                    }
                });
                if (auditUniqUsers.size > 0) {
                    html += '<div class="audit-counting-status-bar">';
                    html += '<span class="audit-cstat-pill info">'
                          + '<i class="fa-solid fa-users" style="font-size:.63rem;margin-right:3px;"></i>'
                          + auditUniqUsers.size + ' dispositivo'
                          + (auditUniqUsers.size !== 1 ? 's' : '') + ' contaron esta área</span>';
                    if (auditUniqUsers.size >= 2 && auditNConf === 0) {
                        html += '<span class="audit-cstat-pill ok">'
                              + '<i class="fa-solid fa-circle-check" style="font-size:.63rem;margin-right:3px;"></i>'
                              + 'Sin diferencias</span>';
                    }
                    if (auditNConf > 0) {
                        html += '<span class="audit-cstat-pill warn">'
                              + '<i class="fa-solid fa-triangle-exclamation" style="font-size:.63rem;margin-right:3px;"></i>'
                              + auditNConf + ' diferencia'
                              + (auditNConf !== 1 ? 's' : '') + ' detectada'
                              + (auditNConf !== 1 ? 's' : '') + '</span>';
                    }
                    html += '</div>';
                }
            }

            // ── Lista de tarjetas (región que refresca la búsqueda) ───────────
            html += BusquedaUI.region('conteo', _renderConteoResultados().html);

            // ── Botón FINALIZAR ÁREA ──────────────────────────────────────────
            // FIX #4 — Solo mostrar si el área no está completada (o si es admin)
            if (!estaCompleta || isAdmin()) {
                html += '<button class="audit-finish-btn" onclick="auditoriaFinalizarConteo()">';
                html += '<i class="fa-solid fa-circle-check" style="font-size:1.1rem;"></i>';
                html += (estaCompleta && isAdmin() ? 'GUARDAR CORRECCIÓN — ' : 'FINALIZAR ÁREA — ') + nombreArea.toUpperCase();
                html += '</button>';
                html += '<p style="text-align:center;font-size:0.68rem;color:var(--txt-muted);margin-top:8px;margin-bottom:16px;">Guarda el conteo de este área y regresa al panel de áreas</p>';
            }

            html += '</div>'; // audit-screen
            return html;
        }

        // FASE 6 — región de resultados del historial de conteos.
        function _renderHistoriaResultados() {
            let html = '';
            const r = _buscarHistoria();
            const filteredInventories = r.items;
            const lim = BusquedaUI.limite('historia');
            if (filteredInventories.length === 0) {
                return { html: BusquedaUI.vacio('historia', 'conteos'), coincidencias: 0, total: r.total };
            }
            html += BusquedaUI.resumen('historia', r.coincidencias, r.total, 'conteo', 'conteos');
            html += '<div class="space-y-4">';
            filteredInventories.slice(0, lim).forEach((inv, idx) => {
                const isExpanded = expandedInventories.has(inv.id);
                const delay = Math.min(idx * 50, 400);
                html += '<div class="bg-white rounded-2xl shadow-md overflow-hidden" data-sbx-item style="animation: tabContentIn 0.3s ease-out both; animation-delay:' + delay + 'ms">';
                html += '<div class="p-4 sm:p-6 cursor-pointer hover:bg-gray-50 transition-colors" data-sbx-principal onclick="toggleInventory(\'' + escapeHtml(inv.id) + '\')">';
                html += '<div class="flex items-center justify-between gap-4">';
                html += '<div class="flex-1">';
                html += '<div class="flex items-center gap-3 mb-1">';
                html += '<h3 class="text-lg font-bold text-gray-900">' + resaltarBusqueda(inv.id, _historiaSearchTerm) + '</h3>';
                html += '<span class="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-full font-medium">' + escapeHtml(areas[inv.area] || inv.area || 'General') + '</span>';
                html += '</div>';
                html += '<p class="text-sm text-gray-600">' + escapeHtml(inv.date) + ' • ' + inv.products.length + ' productos • Total: ' + (inv.totalProducts || 0).toFixed(2) + '</p>';
                html += '</div>';
                html += '<div class="flex items-center gap-2">';
                html += '<button onclick="event.stopPropagation(); downloadInventory(\'' + escapeHtml(inv.id) + '\')" class="p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95" title="Descargar"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg></button>';
                html += '<button onclick="event.stopPropagation(); shareInventoryWhatsApp(\'' + escapeHtml(inv.id) + '\')" class="p-2.5 bg-gradient-to-br from-green-500 to-emerald-500 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95" title="Compartir"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg></button>';
                html += '<svg class="w-5 h-5 text-gray-600 transition-transform ' + (isExpanded ? 'rotate-180' : '') + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';
                html += '</div></div></div>';
                if (isExpanded) {
                    html += '<div class="border-t border-gray-200 p-4 sm:p-6 bg-gray-50 animate-fadeIn"><div class="overflow-x-auto">';
                    html += '<table class="w-full"><thead class="bg-gradient-to-r from-purple-600 to-blue-600"><tr><th class="px-4 py-3 text-left text-sm font-semibold text-white">Producto</th><th class="px-4 py-3 text-center text-sm font-semibold text-white">Stock (Enteras)</th><th class="px-4 py-3 text-center text-sm font-semibold text-white">Abiertas</th><th class="px-4 py-3 text-center text-sm font-semibold text-white">Grupo</th></tr></thead><tbody class="divide-y divide-gray-200 bg-white">';
                    inv.products.forEach(p => {
                        const abiertasStr = p.abiertas ? p.abiertas.map(a => (a || 0).toFixed(2)).join(' + ') : '';
                        html += '<tr><td class="px-4 py-3 text-gray-900">' + escapeHtml(p.name) + '</td><td class="px-4 py-3 text-center text-gray-600">' + p.stock + ' ' + escapeHtml(p.unit) + '</td><td class="px-4 py-3 text-center text-orange-600">' + escapeHtml(abiertasStr) + '</td><td class="px-4 py-3 text-center font-semibold text-gray-900">' + escapeHtml(p.group || 'General') + '</td></tr>';
                    });
                    html += '</tbody></table></div></div>';
                }
                html += '</div>';
            });
            html += '</div>';
            html += BusquedaUI.centinela('historia', filteredInventories.length - lim);
            return { html: html, coincidencias: r.coincidencias, total: r.total };
        }

        function renderHistoriaTab() {
            let html = '';

            // ── Sección: Reportes publicados por admin (visible para todos) ──
            html += '<div id="historiaReportesWrap" style="margin-bottom:20px;">';
            html += '<h3 style="font-size:.85rem;font-weight:600;color:var(--txt-primary);margin-bottom:10px;">📊 Reportes globales publicados</h3>';
            html += '<div id="historiaReportesList" style="color:var(--txt-muted);font-size:.8rem;">Cargando…</div>';
            html += '</div>';

            // ── Sección: Historial de inventarios locales ────────────────────
            if (inventories.length === 0) {
                html += '<div class="bg-white rounded-2xl p-12 text-center shadow-md"><svg class="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><p class="text-gray-600">No hay inventarios guardados</p></div>';
            } else {
                html += '<div class="flex justify-between items-center mb-4">';
                html += '<h3 style="font-size:.85rem;font-weight:600;color:var(--txt-primary);">📋 Historial de conteos</h3>';
                if (isAdmin()) {
                html += '<button onclick="deleteAllInventories()" class="bg-gradient-to-r from-red-500 to-orange-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 transition-all duration-200 text-xs" title="Eliminar todo el historial"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg><span class="font-medium">Eliminar historial</span></button>';
                }
                html += '</div>';
                // FASE 6 — barra unificada sobre folio, área, fecha y productos,
                // con chips por área cuando hay más de una.
                html += BusquedaUI.barra('historia', {
                    placeholder: 'Buscar por folio, área, fecha o producto…',
                    etiqueta: 'Buscar en el historial de conteos',
                    sticky: true
                });
                html += BusquedaUI.chips('historia', _chipsHistoria());
                html += BusquedaUI.region('historia', _renderHistoriaResultados().html);
            }

            // Cargar reportes async después de render
            setTimeout(function() {
                const el = document.getElementById('historiaReportesList');
                if (!el) return;
                if (!_db) { el.innerHTML = '<p style="color:var(--txt-muted);font-size:.79rem;">Firebase no configurado</p>'; return; }
                _db.collection('reportes').orderBy('fechaTs', 'desc').limit(10).get()
                    .then(function(snap) {
                        if (!el) return;
                        if (snap.empty) { el.innerHTML = '<p style="color:var(--txt-muted);font-size:.79rem;">Sin reportes publicados aún</p>'; return; }
                        let rhtml = '';
                        snap.docs.forEach(function(d) {
                            const r = d.data();
                            rhtml += '<div class="rep-card" style="position:relative;">';
                            rhtml += '<div class="rep-card-title">📊 ' + escapeHtml(r.fecha || d.id) + '</div>';
                            rhtml += '<div class="rep-card-meta">' + (r.totalProductos || 0) + ' productos · publicado por admin</div>';
                            rhtml += '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">';
                            rhtml += '<button class="adm-btn primary" style="margin:0;padding:7px 14px;" onclick="descargarReporte(\'' + d.id + '\')"><i class="fa-solid fa-download"></i> Descargar Excel</button>';
                            // Icono eliminar — solo visible para admin
                            if (typeof isAdmin === 'function' && isAdmin()) {
                                rhtml += '<button onclick="eliminarReporte(\'' + d.id + '\')" title="Eliminar reporte" style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:var(--r-md);background:var(--red-dim,rgba(239,68,68,.12));border:1px solid rgba(239,68,68,.22);color:var(--red-text,#ef4444);cursor:pointer;flex-shrink:0;transition:background .18s;" onmouseover="this.style.background=\'rgba(239,68,68,.22)\'" onmouseout="this.style.background=\'var(--red-dim,rgba(239,68,68,.12))\'">';
                                rhtml += '<svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
                                rhtml += '</button>';
                            }
                            rhtml += '</div>';
                            rhtml += '</div>';
                        });
                        el.innerHTML = rhtml;
                    }).catch(function(e) {
                        if (el) el.innerHTML = '<p style="color:var(--txt-muted);font-size:.79rem;">Error cargando reportes</p>';
                    });
            }, 80);

            return html;
        }

        function toggleInventory(invId) {
            if (expandedInventories.has(invId)) expandedInventories.delete(invId);
            else expandedInventories.add(invId);
            saveToLocalStorage();
            renderTab();
        }

        function downloadInventory(invId) {
            const inv = inventories.find(i => i.id === invId);
            if (!inv) return;
            // Bug #10 fix: cada botella abierta en su propia columna (igual que exportToExcel)
            const maxAb = Math.max(1, ...inv.products.map(p => (p.abiertas || []).length));
            const abHeaders = Array.from({ length: maxAb }, (_, i) => 'Abierta ' + (i + 1) + ' (oz)');
            const headers = ['Producto', 'Stock (Enteras)', ...abHeaders, 'Unidad', 'Grupo'];
            const rows = inv.products.map(p => {
                const ab = p.abiertas || [];
                const abCells = Array.from({ length: maxAb }, (_, i) =>
                    i < ab.length ? (ab[i] != null ? Number(ab[i]).toFixed(2) : '0.00') : '');
                return [p.name || '', p.stock || 0, ...abCells, p.unit || '', p.group || 'General'];
            });
            const csvEscape = v => { const s = String(v == null ? '' : v); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s; };
            const csv = [headers].concat(rows).map(row => row.map(csvEscape).join(',')).join('\n');
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeDate = (inv.date || '').replace(/[/:,\s]/g, '-').replace(/-+/g, '-').replace(/-$/, '');
            a.download = inv.id + '_' + safeDate + '.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => window.URL.revokeObjectURL(url), 1000);
            showNotification('Inventario descargado');
        }

        function shareInventoryWhatsApp(invId) {
            const inv = inventories.find(i => i.id === invId);
            if (!inv) return;
            let message = '*INVENTARIO ' + inv.id + '*\n';
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            message += '📅 *Fecha:* ' + inv.date + '\n';
            message += '📍 *Área:* ' + (areas[inv.area] || inv.area || 'N/A') + '\n';
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            message += '*PRODUCTOS:*\n';
            inv.products.forEach((p, i) => {
                message += (i + 1) + '. ' + p.name + '\n';
                message += '   • Enteras: ' + p.stock + ' ' + p.unit + '\n';
                if (p.abiertas && p.abiertas.length) {
                    message += '   • Abiertas: ' + p.abiertas.map(a => (a || 0).toFixed(2)).join(' + ') + '\n';
                }
                message += '   • Grupo: ' + p.group + '\n\n';
            });
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            message += '📦 *Total Enteras:* ' + (inv.totalProducts || 0).toFixed(2) + '\n';
            const url = 'https://wa.me/?text=' + encodeURIComponent(message);
            window.open(url, '_blank');
        }

        function generateProductId() {
            let maxNum = 0;
            products.forEach(p => {
                // FIX: guardia — p.id podría ser undefined/null en datos corruptos,
                // y .match() sobre undefined lanza TypeError bloqueando la apertura del modal.
                if (!p.id || typeof p.id !== 'string') return;
                const match = p.id.match(/^PRD-(\d+)$/);
                if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
            });
            return 'PRD-' + String(maxNum + 1).padStart(3, '0');
        }

        // ── R1 (regla 14) — La casilla "Habilitar conteo de botella en oz" ─────
        // Vive en el formulario de producto y decide como se contara ese producto.
        // Estas dos funciones son todo su comportamiento en la interfaz.

        /**
         * Lee la casilla al guardar. Devuelve false —no lo que marque la casilla—
         * cuando faltan capacidad o peso lleno: sin esos dos numeros la conversion
         * no existe, y guardar true dejaria un producto que pide oz y no sabe
         * convertirlos. La interfaz ya lo impide; esto lo impide tambien si el
         * producto llega por importacion o por una version vieja de la pantalla.
         */
        function _leerCasillaOz(capacidadMl, pesoBotellaLlenaOz) {
            if (capacidadMl === undefined || pesoBotellaLlenaOz === undefined) return false;
            var el = document.getElementById('productConteoOz');
            return !!(el && el.checked);
        }

        // ── R2 (reglas 2 y 8) — el PV de Parrot ───────────────────────────────
        // Parrot genera un product_id por articulo de venta: PVA1001169. Es la
        // llave con la que se cruzan las ventas contra el catalogo. Cruzar por
        // nombre seria fragil: basta que cambien "Margarita" por "Margarita
        // Clasica" en la carta para que las ventas dejen de encontrar su producto.

        /**
         * Normaliza el PV mientras se escribe: mayusculas y sin espacios.
         * Un PV copiado de un Excel llega con espacios al final mas veces de las
         * que parece, y " PVA1001169" no cruza con "PVA1001169".
         */
        function _normalizarPV(el) {
            if (!el) return;
            var pos   = el.selectionStart;
            var antes = el.value;
            var val   = antes.toUpperCase().replace(/\s+/g, '');
            if (val !== antes) {
                el.value = val;
                // Conservar la posicion del cursor: sin esto, corregir una letra
                // en medio del PV manda el cursor al final en cada tecla.
                try { el.setSelectionRange(pos, pos); } catch (_) {}
            }
            _avisarPVDuplicado(val);
        }

        /**
         * Busca si otro producto ya usa ese PV. Devuelve el producto en conflicto
         * o null. Excluye el que se esta editando.
         */
        function _buscarPVDuplicado(pv) {
            if (!pv) return null;
            for (var i = 0; i < products.length; i++) {
                var p = products[i];
                if (!p.pv) continue;
                if (p.id === editingProductId) continue;
                if (String(p.pv).toUpperCase() === pv) return p;
            }
            return null;
        }

        // Aviso en vivo. No bloquea: avisar mientras se escribe y dejar seguir es
        // menos molesto que pelearse con el campo. El bloqueo real va al guardar.
        function _avisarPVDuplicado(pv) {
            var aviso = document.getElementById('productPVAviso');
            if (!aviso) return;
            var choque = _buscarPVDuplicado(pv);
            if (choque) {
                aviso.textContent = 'Ese PV ya lo usa ' + (choque.name || choque.id) + '.';
                aviso.style.color = '#dc2626';
            } else {
                aviso.textContent = 'Déjalo vacío si el producto no se vende tal cual en el punto de venta.';
                aviso.style.color = '#9ca3af';
            }
        }

        function _ponerCasillaOz(valor) {
            var el = document.getElementById('productConteoOz');
            if (el) el.checked = !!valor;
        }

        /**
         * Mantiene la casilla coherente con los datos que hay capturados.
         * Sin capacidad y peso lleno la conversion daria NaN, asi que la casilla
         * se desactiva y se explica por que, en vez de dejar marcar algo que no
         * puede funcionar y que fallaria despues, durante el conteo.
         */
        function _sincronizarCasillaOz() {
            var chk  = document.getElementById('productConteoOz');
            var hint = document.getElementById('productConteoOzHint');
            if (!chk) return;
            var cap  = parseFloat((document.getElementById('productCapacidadMl') || {}).value);
            var peso = parseFloat((document.getElementById('productPesoLlenaOz') || {}).value);
            var hayDatos = !isNaN(cap) && cap > 0 && !isNaN(peso) && peso > 0;

            chk.disabled = !hayDatos;
            if (!hayDatos && chk.checked) chk.checked = false;

            if (!hint) return;
            if (!hayDatos) {
                hint.textContent = 'Llena capacidad y peso lleno para poder activarlo.';
            } else if (chk.checked) {
                hint.textContent = 'Se contara como botellas enteras + botella abierta en oz.';
            } else {
                hint.textContent = 'Se contara con una sola cantidad, con decimales.';
            }
        }

        function openProductModal(productId) {
            const modal = document.getElementById('productModal');
            const title = document.getElementById('productModalTitle');
            document.getElementById('productId').value = '';
            document.getElementById('productName').value = '';
            document.getElementById('productUnit').value = 'Botellas';
            document.getElementById('productGroup').value = '';
            document.getElementById('productCapacidadMl').value = '';
            document.getElementById('productPesoLlenaOz').value = '';
            // P0 — limpiar tambien los campos de compras
            ['productPrecio','productStockMinimo','productConversion','productProveedor','productPV']
                .forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
            if (productId) {
                const product = products.find(p => p.id === productId);
                if (product) {
                    editingProductId = product.id;
                    title.textContent = 'Editar Producto';
                    document.getElementById('productId').value = product.id;
                    document.getElementById('productName').value = product.name || '';
                    document.getElementById('productUnit').value = product.unit || 'Botellas';
                    document.getElementById('productGroup').value = product.group || '';
                    // Cargar campos de conversión si existen
                    if (product.capacidadMl) document.getElementById('productCapacidadMl').value = product.capacidadMl;
                    if (product.pesoBotellaLlenaOz) document.getElementById('productPesoLlenaOz').value = product.pesoBotellaLlenaOz;
                    // P0 — stockMinimo puede ser 0 y 0 es un valor legitimo ('no se
                    // repone'), asi que aqui NO vale un if(valor) como en los de arriba.
                    if (typeof product.precio      === 'number') document.getElementById('productPrecio').value      = product.precio;
                    if (typeof product.conversion  === 'number') document.getElementById('productConversion').value  = product.conversion;
                    if (typeof product.stockMinimo === 'number') document.getElementById('productStockMinimo').value = product.stockMinimo;
                    if (product.proveedor) document.getElementById('productProveedor').value = product.proveedor;
                    if (product.pv) document.getElementById('productPV').value = product.pv;   // R2
                    // R1 (regla 14) — poblar la casilla con el modo REAL del producto.
                    // Es lo que evita el accidente silencioso: si no se poblara, abrir
                    // y guardar un producto antiguo lo cambiaria de modo de conteo sin
                    // que nadie tocara la casilla.
                    _ponerCasillaOz(tieneConversion(product));
                } else {
                    showNotification('Producto no encontrado');
                    return;
                }
            } else {
                editingProductId = null;
                title.textContent = 'Agregar Producto';
                document.getElementById('productId').value = generateProductId();
                _ponerCasillaOz(false);
            }
            _sincronizarCasillaOz();
            // R2 — recalcular el aviso de PV: si no, queda el rojo de la edicion anterior.
            _avisarPVDuplicado((document.getElementById('productPV') || {}).value || '');
            modal.classList.remove('hidden');
            document.body.classList.add('modal-open');
            setTimeout(() => {
                const firstInput = modal.querySelector('input, select, button');
                if (firstInput) firstInput.focus();
            }, 50);
            // Focus trap
            modal._trapHandler = function(e) {
                if (e.key !== 'Tab') return;
                const focusable = Array.from(modal.querySelectorAll('input, select, textarea, button'));
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
                else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
            };
            modal.addEventListener('keydown', modal._trapHandler);
        }

        function closeProductModal() {
            const modal = document.getElementById('productModal');
            if (modal._trapHandler) { modal.removeEventListener('keydown', modal._trapHandler); modal._trapHandler = null; }
            modal.classList.add('hidden');
            document.body.classList.remove('modal-open');
            editingProductId = null;
        }

        function saveProduct() {
            // FASE 2A — catalog.edit sustituye a la comprobación de rol. Sin
            // cambio para el administrador (comodín '*'); delegable a Subjefe
            // desde la pantalla de permisos.
            if (!hasPermission('catalog.edit')) { showNotification('⚠️ No tienes permiso para modificar productos'); return; }
            const name = document.getElementById('productName').value.trim();
            if (!name) { showNotification('La descripción es requerida'); return; }
            let productId = document.getElementById('productId').value.trim();
            if (!productId) productId = generateProductId();
            // Validar duplicado de ID
            const idExists = products.some(p => p.id === productId && p.id !== editingProductId);
            if (idExists) { showNotification('El ID ya existe'); return; }
            // Validar duplicado de nombre + grupo (case-insensitive)
            const group = document.getElementById('productGroup').value.trim() || 'General';
            const nameExists = products.some(p =>
                (p.name || '').toLowerCase() === name.toLowerCase() &&
                (p.group || '').toLowerCase() === group.toLowerCase() &&
                p.id !== editingProductId
            );
            if (nameExists) { showNotification('Ya existe un producto con ese nombre en el mismo grupo'); return; }

            const unit = document.getElementById('productUnit').value;
            // Campos opcionales de conversión
            const capacidadMlRaw    = parseFloat(document.getElementById('productCapacidadMl').value);
            const pesoLlenaOzRaw    = parseFloat(document.getElementById('productPesoLlenaOz').value);
            const capacidadMl       = isNaN(capacidadMlRaw) || capacidadMlRaw <= 0 ? undefined : capacidadMlRaw;
            const pesoBotellaLlenaOz = isNaN(pesoLlenaOzRaw) || pesoLlenaOzRaw <= 0 ? undefined : pesoLlenaOzRaw;

            // P0 — campos de compras y reposicion.
            // stockMinimo admite 0 ('no se repone'); precio y conversion no:
            // un precio de 0 o una conversion de 0 corromperian cualquier costeo.
            function _leerNum(id, permitirCero) {
                var el = document.getElementById(id);
                if (!el || el.value === '') return undefined;
                var n = parseFloat(el.value);
                if (isNaN(n) || !isFinite(n) || n < 0) return undefined;
                if (n === 0 && !permitirCero) return undefined;
                return n;
            }
            const precio      = _leerNum('productPrecio', false);
            const conversion  = _leerNum('productConversion', false);
            const stockMinimo = _leerNum('productStockMinimo', true);
            const provEl      = document.getElementById('productProveedor');
            const proveedor   = provEl ? provEl.value.trim() : '';

            // ── R2 (reglas 2 y 8): PV de Parrot ──────────────────────────────
            // Se bloquea el duplicado. Dos productos con el mismo PV no darian un
            // error visible: repartirian mal las ventas y la desviacion saldria
            // torcida en los dos, que es mucho peor que no guardar.
            const pvEl = document.getElementById('productPV');
            const pv   = pvEl ? pvEl.value.toUpperCase().replace(/\s+/g, '') : '';
            if (pv) {
                const choquePV = _buscarPVDuplicado(pv);
                if (choquePV) {
                    showNotification('⚠️ El PV ' + pv + ' ya lo usa ' + (choquePV.name || choquePV.id) +
                                     '. Cada PV pertenece a un solo producto.');
                    if (pvEl) pvEl.focus();
                    return;
                }
            }

            // Bug #6 fix: validar coherencia física antes de guardar
            // pesoVidrio = pesoLleno - liquidoOz; si es negativo el usuario invirtió los campos
            if (capacidadMl !== undefined && pesoBotellaLlenaOz !== undefined) {
                const liquidoOz  = capacidadMl / 29.5735;
                const pesoVidrio = pesoBotellaLlenaOz - liquidoOz;
                if (pesoVidrio < 0) {
                    showNotification('⚠️ Error: el peso de botella llena (' + pesoBotellaLlenaOz + ' oz) es menor que el líquido (' + liquidoOz.toFixed(2) + ' oz). ¿Invertiste los campos?');
                    return;
                }
            }

            if (editingProductId) {
                const product = products.find(p => p.id === editingProductId);
                if (!product) {
                    // FIX: el producto ya no existe (borrado desde otro dispositivo mientras el modal estaba abierto).
                    // Notificar y salir sin guardar ni cerrar — el usuario debe refrescar.
                    showNotification('⚠️ Producto no encontrado — puede haber sido eliminado por otro usuario');
                    return;
                }
                // Si cambia el ID, migrar TODOS los objetos de conteo que usan el ID como clave
                if (editingProductId !== productId) {
                    // inventarioConteo (conteo regular de áreas)
                    if (inventarioConteo[editingProductId]) {
                        inventarioConteo[productId] = inventarioConteo[editingProductId];
                        delete inventarioConteo[editingProductId];
                    }
                    // FIX: auditoriaConteo (vista agregada del admin) — sin migrar, el producto
                    // mostraba 0 en el panel de auditoría tras cambiar el ID.
                    if (auditoriaConteo[editingProductId]) {
                        auditoriaConteo[productId] = auditoriaConteo[editingProductId];
                        delete auditoriaConteo[editingProductId];
                    }
                    // FIX: myAuditoriaConteo (conteo propio del usuario) — sin migrar, el usuario
                    // perdía su propio conteo al renombrarse el producto.
                    if (myAuditoriaConteo[editingProductId]) {
                        myAuditoriaConteo[productId] = myAuditoriaConteo[editingProductId];
                        delete myAuditoriaConteo[editingProductId];
                    }
                    // FIX: auditoriaConteoPorUsuario (conteos multi-usuario) — sin migrar, todos
                    // los conteos de bartenders quedaban huérfanos bajo el ID antiguo.
                    if (auditoriaConteoPorUsuario[editingProductId]) {
                        auditoriaConteoPorUsuario[productId] = auditoriaConteoPorUsuario[editingProductId];
                        delete auditoriaConteoPorUsuario[editingProductId];
                    }
                }
                product.id = productId;
                product.name = name;
                product.unit = unit;
                product.group = group;
                // Actualizar campos de conversión (quitar si se borraron)
                if (capacidadMl !== undefined) product.capacidadMl = capacidadMl;
                else delete product.capacidadMl;
                if (pesoBotellaLlenaOz !== undefined) product.pesoBotellaLlenaOz = pesoBotellaLlenaOz;
                else delete product.pesoBotellaLlenaOz;
                // R1 (regla 14) — se guarda SIEMPRE, true o false. Dejarlo sin
                // escribir cuando es false lo devolveria al valor heredado de los
                // productos anteriores a R1, que es true, y el administrador no
                // podria desactivar el conteo en oz de un producto que ya lo tenia.
                product.conteoOzHabilitado = _leerCasillaOz(capacidadMl, pesoBotellaLlenaOz);
                // P0 — mismo criterio: si el campo se vacia, el dato se quita.
                if (precio      !== undefined) product.precio      = precio;      else delete product.precio;
                if (conversion  !== undefined) product.conversion  = conversion;  else delete product.conversion;
                if (stockMinimo !== undefined) product.stockMinimo = stockMinimo; else delete product.stockMinimo;
                if (proveedor)                 product.proveedor   = proveedor;   else delete product.proveedor;
                // R2 — mismo criterio: si se vacia el campo, el dato se quita.
                if (pv)                        product.pv          = pv;          else delete product.pv;
                // stockByArea se recalcula
                syncStockByAreaFromConteo();
                // CORRECCIÓN 3: Auditoría obligatoria en modificación de producto
                _registrarEnSyncQueue({
                    tipo:         'edicion_producto',
                    prodId:       productId,
                    prodName:     name,
                    detalle:      editingProductId !== productId
                                  ? 'ID renombrado de ' + editingProductId + ' → ' + productId
                                  : 'Campos actualizados',
                    valorAntes:   editingProductId,
                    valorDespues: productId,
                    motivo:       'Edición de catálogo'
                });
                showNotification('Producto actualizado');
            } else {
                const newProduct = {
                    id: productId,
                    name: name,
                    unit: unit,
                    group: group,
                    stockByArea: _stockInicialPorArea(0)
                };
                if (capacidadMl !== undefined)       newProduct.capacidadMl = capacidadMl;
                if (pesoBotellaLlenaOz !== undefined) newProduct.pesoBotellaLlenaOz = pesoBotellaLlenaOz;
                // R1 (regla 14)
                newProduct.conteoOzHabilitado = _leerCasillaOz(capacidadMl, pesoBotellaLlenaOz);
                // P0
                if (precio      !== undefined) newProduct.precio      = precio;
                if (conversion  !== undefined) newProduct.conversion  = conversion;
                if (stockMinimo !== undefined) newProduct.stockMinimo = stockMinimo;
                if (proveedor)                 newProduct.proveedor   = proveedor;
                if (pv)                        newProduct.pv          = pv;   // R2
                products.push(newProduct);
                // CORRECCIÓN 3: Auditoría de nuevo producto
                _registrarEnSyncQueue({
                    tipo:         'nuevo_producto',
                    prodId:       productId,
                    prodName:     name,
                    detalle:      'Producto creado: ' + name + ' (' + unit + ' / ' + group + ')',
                    motivo:       'Alta de catálogo'
                });
                showNotification('Producto agregado');
            }
            saveToLocalStorage();
            closeProductModal();
            renderTab();
        }

        function editProduct(id) { if (!hasPermission('catalog.edit')) { showNotification('⚠️ No tienes permiso para editar productos'); return; } openProductModal(id); }

        function deleteProduct(id) {
            if (!hasPermission('catalog.edit')) { showNotification('⚠️ No tienes permiso para eliminar productos'); return; }
            if (isCicloBloqueado()) { showNotification('🔒 No se puede eliminar: el inventario está CERRADO.'); return; }
            const product = products.find(function(p) { return p.id === id; });
            const prodName = product ? product.name : id;
            // PROTECCIÓN: confirmación doble para eliminación de producto
            showConfirm(
                '⚠️ ¿Eliminar el producto "' + prodName + '"?\n\n' +
                'Se borrarán también sus conteos en todas las áreas.\n' +
                'Esta acción NO se puede deshacer.',
                function() {
                    // Segunda confirmación para mayor seguridad
                    showConfirm(
                        '🗑️ CONFIRMAR ELIMINACIÓN\n\n"' + prodName + '" será eliminado permanentemente.\n\n¿Estás seguro?',
                        function() {
                            // Crear respaldo antes de eliminar
                            _crearBackupNombrado('pre_eliminacion_' + id + '_' + Date.now());

                            products = products.filter(p => p.id !== id);
                            _marcarComoBorrado('producto', id); // FIX-CONCURRENCIA: no resucitar en el próximo merge
                            cart = cart.filter(item => item.id !== id);
                            delete inventarioConteo[id];
                            delete auditoriaConteo[id];
                            if (myAuditoriaConteo) delete myAuditoriaConteo[id];
                            if (auditoriaConteoPorUsuario) delete auditoriaConteoPorUsuario[id];

                            // Registrar en auditoría
                            _registrarEnSyncQueue({
                                tipo:     'eliminacion_producto',
                                prodId:   id,
                                prodName: prodName,
                                detalle:  'Producto eliminado por administrador',
                                usuario:  (auditCurrentUser ? auditCurrentUser.userName : null) || currentUserUid || 'admin',
                                uid:      currentUserUid || null
                            });

                            saveToLocalStorage();
                            showNotification('Producto eliminado: ' + prodName);
                            renderTab();
                        }
                    );
                }
            );
        }

        function deleteAllProducts() {
            if (!hasPermission('catalog.edit')) { showNotification('⚠️ No tienes permiso para eliminar productos'); return; }
            if (products.length === 0) { showNotification('No hay productos para eliminar'); return; }
            if (isCicloBloqueado()) { showNotification('🔒 No se puede eliminar: el inventario está CERRADO.'); return; }
            // PROTECCIÓN: doble confirmación para eliminación masiva del catálogo
            showConfirm(
                '🚨 ¿Eliminar TODOS los ' + products.length + ' productos?\n\n' +
                'Se borrarán el catálogo completo y todos los conteos.\n' +
                'Esta acción NO se puede deshacer.',
                function() {
                    showConfirm(
                        '🗑️ CONFIRMACIÓN FINAL\n\nSe eliminará TODO el catálogo (' + products.length + ' productos).\n\n' +
                        'Se creará un respaldo automático antes de continuar.\n\n¿Confirmar eliminación total?',
                        function() {
                            // Backup automático antes de eliminar todo
                            _crearBackupNombrado('pre_eliminacion_total_' + Date.now());

                            // Registrar en auditoría ANTES de borrar
                            _registrarEnSyncQueue({
                                tipo:     'eliminacion_catalogo',
                                detalle:  'Catálogo completo eliminado (' + products.length + ' productos)',
                                usuario:  (auditCurrentUser ? auditCurrentUser.userName : null) || currentUserUid || 'admin',
                                uid:      currentUserUid || null
                            });

                            // D — la marca de purga es lo que hace que el
                            // vaciado sea real. Las lápidas por producto se
                            // siguen poniendo (sirven para el borrado suelto),
                            // pero ya no son lo que sostiene esta operación:
                            // con 424 productos y tope de 300, 124 se quedaban
                            // sin lápida y volvían de la nube a los 900 ms.
                            _marcarCatalogoPurgado(Date.now());
                            products.forEach(function(p) { _marcarComoBorrado('producto', p.id); }); // FIX-CONCURRENCIA
                            products = []; cart = []; inventarioConteo = {};
                            auditoriaConteo = {}; myAuditoriaConteo = {}; auditoriaConteoPorUsuario = {};
                            saveToLocalStorage();

                            // D — la segunda copia del catálogo (catalogo/productos)
                            // quedaba intacta con los 424 productos. Bastaba con que
                            // un teléfono entrara por primera vez —con su contador de
                            // versión local en cero— para que el listener le inyectara
                            // el catálogo completo y, si ese teléfono era de un admin,
                            // lo devolviera a la nube. Vaciarla aquí cierra esa puerta.
                            _vaciarCatalogoPublicado().catch(function(e) {
                                console.warn('[Catalogo] No se pudo vaciar el catálogo publicado:', e);
                                showNotification('⚠️ El catálogo se borró aquí, pero no se pudo ' +
                                    'vaciar en la nube. Vuelve a intentarlo con señal.');
                            });

                            showNotification('Todos los productos han sido eliminados. Respaldo guardado.');
                            renderTab();
                        }
                    );
                }
            );
        }

        // Catálogo filtrado por grupo, chips y la búsqueda del catálogo, del
        // más relevante al menos. FASE 6: delega en el motor unificado
        // (_buscarCatalogo, js/80-buscador.js). El conteo YA NO usa esta
        // función: tiene su propia búsqueda (_buscarConteo) y no hereda la de
        // Inicio/Productos.
        function filterByGroup() {
            return _buscarCatalogo().items;
        }

        function addToCart(productId) {
            const product = products.find(p => p.id === productId);
            if (!product || !product.id) return;
            const existingItem = cart.find(item => item.id === productId);
            if (existingItem) existingItem.quantity++;
            else cart.push({ id: product.id, name: product.name, unit: product.unit || '', group: product.group || 'General', quantity: 1 });
            saveToLocalStorage();
            showNotification(product.name + ' agregado al carrito');
            updateHeaderActions();
        }

        function openOrderModal() {
            if (cart.length === 0) { showNotification('Agrega productos al carrito primero'); return; }
            document.getElementById('orderSupplier').value = '';
            document.getElementById('orderDeliveryDate').value = '';
            document.getElementById('orderNote').value = '';
            const modal = document.getElementById('orderModal');
            modal.classList.remove('hidden');
            document.body.classList.add('modal-open');
            renderOrderTable();
            setTimeout(() => {
                const firstInput = modal.querySelector('input, select, textarea, button');
                if (firstInput) firstInput.focus();
            }, 50);
            modal._trapHandler = function(e) {
                if (e.key !== 'Tab') return;
                const focusable = Array.from(modal.querySelectorAll('input, select, textarea, button'));
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
                else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
            };
            modal.addEventListener('keydown', modal._trapHandler);
        }

        function closeOrderModal() {
            const modal = document.getElementById('orderModal');
            if (modal._trapHandler) { modal.removeEventListener('keydown', modal._trapHandler); modal._trapHandler = null; }
            modal.classList.add('hidden');
            document.body.classList.remove('modal-open');
        }

        function renderOrderTable() {
            const tbody = document.getElementById('orderProductsTable');
            const emptyCart = document.getElementById('emptyCart');
            const orderTotal = document.getElementById('orderTotal');
            if (cart.length === 0) {
                tbody.innerHTML = '';
                emptyCart.classList.remove('hidden');
                orderTotal.textContent = 'Total: 0';
                return;
            }
            emptyCart.classList.add('hidden');
            let html = '';
            let total = 0;
            cart.forEach(item => {
                total += item.quantity;
                html += '<tr><td class="px-4 py-3 text-gray-900">' + escapeHtml(item.name) + '</td><td class="px-4 py-3 text-center text-gray-600">' + escapeHtml(item.unit) + '</td><td class="px-4 py-3 text-center"><input type="number" value="' + item.quantity + '" min="0.01" step="0.01" onchange="updateCartQuantity(\'' + escapeHtml(item.id) + '\', this.value)" class="w-20 px-2 py-1 text-center bg-white text-gray-900 border border-gray-200 rounded focus:ring-2 focus:ring-purple-500 font-semibold"></td><td class="px-4 py-3 text-center"><button onclick="removeFromCart(\'' + escapeHtml(item.id) + '\')" class="p-2 bg-gradient-to-br from-red-500 to-orange-500 text-white rounded-xl hover:shadow-lg transition-all transform active:scale-95"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></td></tr>';
            });
            tbody.innerHTML = html;
            orderTotal.textContent = 'Total: ' + total.toFixed(2);
        }

        function updateCartQuantity(productId, quantity) {
            const item = cart.find(i => i.id === productId);
            if (!item) return;
            let val = parseFloat(quantity);
            if (isNaN(val) || val <= 0) val = 0.01;
            // Validar según unidad (si es entero, redondear y forzar entero)
            const product = products.find(p => p.id === productId);
            if (product) {
                const integerUnits = ['Piezas', 'Unidad', 'Botellas', 'Paquete', 'Tapas', 'Cartones'];
                if (integerUnits.includes(product.unit)) {
                    val = Math.round(val);
                    if (val < 1) val = 1;
                } else {
                    if (val < 0.01) val = 0.01;
                }
            }
            item.quantity = val;
            saveToLocalStorage();
            renderOrderTable();
        }

        function removeFromCart(productId) {
            cart = cart.filter(item => item.id !== productId);
            saveToLocalStorage();
            renderOrderTable();
            updateHeaderActions();
            if (cart.length === 0) showNotification('Carrito vacío');
        }

        function _sufijoUnico() {
            // FIX-CONCURRENCIA (BarInventory): sufijo corto casi-siempre-único
            // (tiempo + aleatorio) para que dos dispositivos offline no generen
            // el mismo ID (ej. PED-004) al crear un pedido casi al mismo tiempo.
            return Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 4);
        }

        function createOrder() {
            const supplier = document.getElementById('orderSupplier').value.trim();
            if (!supplier) { showNotification('El proveedor es requerido'); return; }
            if (cart.length === 0) { showNotification('Agrega productos al carrito'); return; }
            const deliveryDate = document.getElementById('orderDeliveryDate').value;
            const note = document.getElementById('orderNote').value.trim();
            let maxOrderNum = 0;
            orders.forEach(o => {
                // FIX: guardia — o.id podría ser undefined en datos corruptos
                if (!o.id || typeof o.id !== 'string') return;
                // FIX-CONCURRENCIA: el regex ya no exige fin de cadena ($) para
                // seguir reconociendo el número aunque el id incluya el sufijo único.
                const m = o.id.match(/^PED-(\d+)/);
                if (m) maxOrderNum = Math.max(maxOrderNum, parseInt(m[1], 10));
            });
            const order = {
                id: 'PED-' + String(maxOrderNum + 1).padStart(3, '0') + '-' + _sufijoUnico(),
                date: new Date().toLocaleString(),
                supplier: supplier,
                deliveryDate: deliveryDate || null,
                note: note || null,
                products: [...cart],
                total: cart.reduce((sum, item) => sum + item.quantity, 0)
            };
            orders.push(order);
            // Vaciar el carrito antes de compartir (estado consistente si el popup es bloqueado)
            cart = [];
            saveToLocalStorage();
            shareOrderWhatsApp(order.id);
            closeOrderModal();
            showNotification('Pedido creado');
            updateHeaderActions();
        }

        function deleteOrder(orderId) {
            showConfirm('¿Está seguro de eliminar este pedido?', function() {
                orders = orders.filter(o => o.id !== orderId);
                _marcarComoBorrado('pedido', orderId); // FIX-CONCURRENCIA: no resucitar en el próximo merge
                saveToLocalStorage();
                showNotification('Pedido eliminado');
                renderTab();
            });
        }

        function deleteAllOrders() {
            // FIX-AUDIT (BarInventory): deleteAllOrders() no validaba isAdmin().
            // 'orders' se sincroniza a Firestore (ordersChunks) vía syncToCloud(), así que
            // cualquier usuario no-admin podía vaciar el historial de pedidos de TODOS
            // los dispositivos con un solo confirm(). Se alinea con deleteAllProducts(),
            // que sí exige isAdmin(), sin tocar el resto de la lógica de la función.
            if (!isAdmin()) { showNotification('⚠️ Solo el administrador puede eliminar todos los pedidos'); return; }
            if (orders.length === 0) { showNotification('No hay pedidos para eliminar'); return; }
            showConfirm('¿Está seguro de que desea eliminar TODOS los pedidos? Esta acción no se puede deshacer.', function() {
                orders.forEach(function(o) { _marcarComoBorrado('pedido', o.id); }); // FIX-CONCURRENCIA
                orders = [];
                saveToLocalStorage();
                showNotification('Todos los pedidos han sido eliminados');
                renderTab();
            });
        }

        function deleteAllInventories() {
            // FIX-AUDIT (BarInventory): mismo problema que deleteAllOrders() — sin
            // isAdmin(), cualquier usuario podía borrar el historial de inventarios.
            if (!isAdmin()) { showNotification('⚠️ Solo el administrador puede eliminar el historial de inventarios'); return; }
            if (inventories.length === 0) { showNotification('No hay historial de inventarios para eliminar'); return; }
            showConfirm('¿Está seguro de que desea eliminar TODO el historial de inventarios? Esta acción no se puede deshacer.', function() {
                inventories.forEach(function(inv) { _marcarComoBorrado('inventario', inv.id); }); // FIX-CONCURRENCIA
                inventories = [];
                expandedInventories.clear();
                saveToLocalStorage();
                showNotification('Historial de inventarios eliminado');
                renderTab();
            });
        }

        function shareOrderWhatsApp(orderId) {
            const order = orders.find(o => o.id === orderId);
            if (!order) return;
            let message = '*PEDIDO BARRA ' + order.id + '*\n';
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            message += '📋 *Proveedor:* ' + order.supplier + '\n';
            message += '🗓️ *Fecha:* ' + order.date + '\n';
            if (order.deliveryDate) message += '🚚 *Entrega:* ' + order.deliveryDate + '\n';
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            message += '*PRODUCTOS:*\n';
            order.products.forEach((p, i) => {
                message += (i + 1) + '. ' + p.name + '\n';
                message += '   • Cantidad: ' + p.quantity + ' ' + p.unit + '\n';
            });
            message += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            message += '📦 *Total Productos:* ' + (order.total || 0).toFixed(2) + '\n';
            if (order.note) message += '\n💬 *Nota:*\n' + order.note + '\n';
            const url = 'https://wa.me/?text=' + encodeURIComponent(message);
            window.open(url, '_blank');
        }

        function saveInventorySnapshot() {
            if (products.length === 0) { showNotification('No hay productos para guardar en el inventario'); return; }
            let maxInvNum = 0;
            // FIX-CONCURRENCIA: regex sin fin de cadena ($) para tolerar el sufijo único
            inventories.forEach(inv => { const m = inv.id.match(/^INV-(\d+)/); if (m) maxInvNum = Math.max(maxInvNum, parseInt(m[1], 10)); });
            const snapshot = {
                id: 'INV-' + String(maxInvNum + 1).padStart(3, '0') + '-' + _sufijoUnico(),
                date: new Date().toLocaleString(),
                area: selectedArea,
                products: products.map(p => {
                    const areaData = inventarioConteo[p.id] && inventarioConteo[p.id][selectedArea];
                    // Guardar total convertido (enteras + puntos de abiertas)
                    const totalConvertido = calcularTotalConAbiertas(p.id, selectedArea);
                    return {
                        id: p.id,
                        name: p.name,
                        stock: totalConvertido,   // total real con conversión oz→puntos
                        abiertas: areaData ? areaData.abiertas : [],
                        unit: p.unit,
                        group: p.group || 'General'
                    };
                }),
                totalProducts: products.reduce((sum, p) => sum + calcularTotalConAbiertas(p.id, selectedArea), 0)
            };
            inventories.push(snapshot);
            saveToLocalStorage();
            showNotification('Inventario de ' + areas[selectedArea] + ' guardado');
        }

        // FIX 5 — Parseo robusto de números provenientes de Excel/CSV
        function parseExcelNumber(val) {
            if (val === null || val === undefined) return 0;
            // SheetJS ya devuelve numbers para celdas numéricas — pasar directo
            if (typeof val === 'number') {
                // Rechazar seriales de fecha Excel (> 2958465 = 31/12/9999)
                if (!isFinite(val) || val > 2958465) return 0;
                return val;
            }
            const str = String(val).trim()
                .replace(/[€$£¥₩₹\s]/g, '');  // quitar monedas y espacios (el signo negativo se preserva automáticamente)

            if (!str || str === '-' || str === '+') return 0;

            // Formato europeo con punto como miles y coma como decimal: 1.234,56
            if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(str)) {
                return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
            }
            // Coma como único separador decimal: 1234,56
            // FIX: (,\d+) sin cuantificador lo hacía obligatorio; se mantiene correcto porque
            // el test ya exige exactamente "dígitos,dígitos" — el $ ancla el fin de cadena.
            if (/^\d+(,\d+)$/.test(str)) {
                return parseFloat(str.replace(',', '.')) || 0;
            }
            // Punto como miles sin decimal: 1.234
            if (/^\d{1,3}(\.\d{3})+$/.test(str)) {
                return parseFloat(str.replace(/\./g, '')) || 0;
            }
            // Formato estándar o ya limpio
            return parseFloat(str) || 0;
        }

