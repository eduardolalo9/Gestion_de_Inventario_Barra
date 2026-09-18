        function updateNetworkStatus() {
            const existing = document.getElementById('networkStatus');
            if (existing) existing.remove();
            if (!navigator.onLine) {
                const bar = document.createElement('div');
                bar.id = 'networkStatus';
                bar.style.cssText = 'position:fixed;bottom:80px;left:0;right:0;background:#f59e0b;color:#fff;text-align:center;padding:6px;font-size:13px;font-weight:600;z-index:9999;';
                bar.textContent = '⚠️ Sin conexión — los datos están guardados localmente';
                document.body.appendChild(bar);
                updateCloudSyncBadge('offline');
            } else {
                // FIX SYNC-5: Al reconectar, primero verificar si hay datos más recientes
                // en la nube (admin pudo haber guardado mientras estábamos offline)
                // y LUEGO subir los pendientes locales si aplica.
                if (_db) {
                    console.info('[Firebase] Reconectado — verificando cambios en la nube…');
                    // FIX BUG 2: resubir conteo de auditoría si quedó pendiente
                    if (_auditSyncPending) {
                        console.info('[AuditUser] Reintentando sync de conteo pendiente…');
                        syncMyAuditoriaToFirestore().catch(e =>
                            console.warn('[AuditUser] Reintento fallido:', e)
                        );
                    }
                    // FIX 3: Reintentar syncs de área que fallaron en auditoriaFinalizarConteo
                    if (window._pendingAreaSyncs && window._pendingAreaSyncs.size > 0) {
                        console.info('[Atomico] Reintentando ' + window._pendingAreaSyncs.size + ' área(s) pendiente(s)…');
                        window._pendingAreaSyncs.forEach(function(area) {
                            syncConteoAtomicoPorArea(area)
                                .then(function() { window._pendingAreaSyncs.delete(area); })
                                .catch(function(e) { console.warn('[Atomico] Reintento fallido para ' + area + ':', e); });
                            syncConteoPorUsuarioToFirestore(area)
                                .catch(function(e) { console.warn('[MultiUser] Reintento fallido para ' + area + ':', e); });
                        });
                    }
                    loadFromCloud().then(function() {
                        // D — los conteos que se hicieron sin señal se suben
                        // aquí. Va después de loadFromCloud a propósito: así
                        // el reintento compara contra lo que el servidor tiene
                        // AHORA y detecta si alguien más contó ese producto
                        // mientras este aparato estaba desconectado.
                        return drenarConteosPendientes();
                    }).then(function() {
                        // loadFromCloud ya llama syncToCloud() si local es más reciente
                        updateCloudSyncBadge(
                            (_cloudSyncPending || _outboxPendientes().length > 0) ? 'pending' : 'ok');
                    }).catch(function(e) {
                        console.warn('[Firebase] Error en loadFromCloud tras reconexión:', e);
                        if (_cloudSyncPending) syncToCloud();
                        drenarConteosPendientes().catch(function() {});
                    });
                } else {
                    updateCloudSyncBadge('none');
                }
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  MÓDULO: ROLES Y PERMISOS
        // ══════════════════════════════════════════════════════════════════════
        let currentUserRole = null;  // 'admin' | 'user' (legacy) — SIN CAMBIOS, se sigue asignando igual
        let currentUserUid  = null;

        // ══════════════════════════════════════════════════════════════════════
        //  ETAPA 14.1 — CATÁLOGO DE ROLES Y PERMISOS
        //  ────────────────────────────────────────────────────────────────────
        //  Esto EXTIENDE el modelo anterior, no lo reemplaza. currentUserRole
        //  sigue existiendo, se sigue asignando exactamente igual que antes
        //  (ver loadUserRole más abajo), y ninguno de los +65 llamadores de
        //  isAdmin() en este archivo necesita cambiar: isAdmin() conserva su
        //  firma y su contrato de siempre ("¿tiene privilegios administrativos
        //  totales?") — solo cambia SU implementación interna para delegar en
        //  el sistema nuevo.
        //
        //  Catálogo CERRADO de permisos: ningún código puede usar un string de
        //  permiso que no esté en esta lista — hasPermission() lo rechaza.
        // ══════════════════════════════════════════════════════════════════════
        const PERMISOS_CATALOGO = [
            'users.read', 'users.create', 'users.update', 'users.disable',
            'roles.read', 'roles.update',
            'permissions.read', 'permissions.update',
            'branches.read', 'branches.create', 'branches.update', 'branches.disable',
            'warehouses.read', 'warehouses.create', 'warehouses.update', 'warehouses.disable',
            'inventory.create', 'inventory.count', 'inventory.viewOwn', 'inventory.viewAll',
            'inventory.closeOwn', 'inventory.closeOther', 'inventory.closeGlobal', 'inventory.reopenArea',
            'inventory.export', 'inventory.history',
            'catalog.read', 'catalog.publish', 'catalog.edit',
            'reports.read', 'reports.export',
            // P1 — COMPRAS. El catalogo es CERRADO: hasPermission() rechaza
            // cualquier string que no este aqui, asi que registrar los permisos
            // es requisito para que la pestana pueda existir siquiera.
            'purchases.read', 'purchases.create', 'purchases.import', 'purchases.delete',
            'settings.read', 'settings.update',
            'adminLog.read',
            // FASE 2 — permisos nuevos. Los IDs tecnicos se escriben en ingles
            // por decision explicita del propietario (D1): renombrar el
            // catalogo a espanol obligaria a migrar los documentos roles/* ya
            // sembrados en Firestore y cualquier permissionOverrides guardado,
            // sin ganancia funcional. El espanol vive en PERMISOS_METADATOS.
            //
            //   inventory.post   — "Contabilizar": convertir el resultado
            //                      fisico de un inventario CERRADO en el
            //                      inventario inicial del siguiente ciclo.
            //                      Se registra AHORA (catalogo cerrado: sin
            //                      esto la FASE 3 no podria ni declararlo),
            //                      pero la operacion NO existe todavia.
            //   data.exportFull  — Exportacion del respaldo COMPLETO en JSON.
            //                      Es un permiso distinto de inventory.export
            //                      a proposito: el Excel de inventario lleva
            //                      el conteo consolidado, mientras que
            //                      exportFullData() arrastra ademas
            //                      auditoriaConteoPorUsuario, es decir el
            //                      conteo individual de OTRAS personas.
            'inventory.post',
            'data.exportFull'
        ];
        const PERMISOS_CATALOGO_SET = new Set(PERMISOS_CATALOGO);

        // ══════════════════════════════════════════════════════════════════════
        //  FASE 2 — PERMISOS_METADATOS
        //  ────────────────────────────────────────────────────────────────────
        //  Presentacion en espanol de cada permiso del catalogo. Es un mapa
        //  PURAMENTE DE INTERFAZ: no participa en ninguna decision de
        //  autorizacion (esa sigue siendo competencia exclusiva de
        //  hasPermission()). Separar ID tecnico de nombre visible es lo que
        //  permite cumplir "toda la interfaz en espanol" sin tocar un solo
        //  dato ya guardado en Firestore.
        //
        //  Campos:
        //    nombre      — etiqueta corta del checkbox
        //    descripcion — que habilita exactamente, en lenguaje de operacion
        //    grupo       — encabezado bajo el que se agrupa en la pantalla
        //    delegable   — si un ADMIN puede concederlo a Subjefe/Bartender
        //    sensible    — si conceder/revocar exige confirmacion explicita
        //    efectivo    — si HOY existe al menos un punto del codigo que lo
        //                  consulte. Un permiso con efectivo:false se dibuja
        //                  deshabilitado y rotulado: marcar una casilla que no
        //                  controla nada es exactamente el "ocultar el boton"
        //                  que la regla 4 del propietario prohibe.
        // ══════════════════════════════════════════════════════════════════════
        const PERMISOS_METADATOS = {
            // ── Usuarios, roles y permisos ──────────────────────────────────
            'users.read':            { nombre: 'Ver usuarios',                 descripcion: 'Consultar la lista de usuarios del sistema.',                                  grupo: 'Usuarios y permisos', delegable: false, sensible: true,  efectivo: true  },
            'users.create':          { nombre: 'Crear usuarios',               descripcion: 'Dar de alta cuentas nuevas.',                                                  grupo: 'Usuarios y permisos', delegable: false, sensible: true,  efectivo: false },
            'users.update':          { nombre: 'Modificar usuarios',           descripcion: 'Cambiar el rol o los datos de una cuenta.',                                    grupo: 'Usuarios y permisos', delegable: false, sensible: true,  efectivo: true  },
            'users.disable':         { nombre: 'Desactivar usuarios',          descripcion: 'Dar de baja una cuenta sin eliminarla.',                                       grupo: 'Usuarios y permisos', delegable: false, sensible: true,  efectivo: true  },
            'roles.read':            { nombre: 'Ver roles',                    descripcion: 'Consultar la definicion de los roles del sistema.',                            grupo: 'Usuarios y permisos', delegable: false, sensible: false, efectivo: true  },
            'roles.update':          { nombre: 'Modificar roles',              descripcion: 'Cambiar los permisos que hereda un rol completo.',                             grupo: 'Usuarios y permisos', delegable: false, sensible: true,  efectivo: true  },
            'permissions.read':      { nombre: 'Ver permisos efectivos',       descripcion: 'Consultar los permisos que tiene cada usuario.',                               grupo: 'Usuarios y permisos', delegable: false, sensible: true,  efectivo: true  },
            'permissions.update':    { nombre: 'Administrar permisos',         descripcion: 'Conceder o revocar permisos individuales a un usuario.',                       grupo: 'Usuarios y permisos', delegable: false, sensible: true,  efectivo: true  },

            // ── Inventario fisico ───────────────────────────────────────────
            'inventory.create':      { nombre: 'Crear inventario',             descripcion: 'Abrir un inventario fisico nuevo para el ciclo.',                              grupo: 'Inventario fisico',   delegable: true,  sensible: true,  efectivo: true  },
            'inventory.count':       { nombre: 'Contar',                       descripcion: 'Capturar cantidades en las areas asignadas.',                                  grupo: 'Inventario fisico',   delegable: true,  sensible: false, efectivo: true  },
            'inventory.viewOwn':     { nombre: 'Ver mi conteo',                descripcion: 'Consultar unicamente el conteo propio.',                                       grupo: 'Inventario fisico',   delegable: true,  sensible: false, efectivo: true  },
            'inventory.viewAll':     { nombre: 'Ver todos los conteos',        descripcion: 'Consultar la consolidacion y el conteo individual de cada persona. Rompe el conteo ciego: concedelo solo a supervision.', grupo: 'Inventario fisico', delegable: true, sensible: true, efectivo: true },
            'inventory.closeOwn':    { nombre: 'Finalizar conteo propio',      descripcion: 'Dar por terminado el conteo propio de un area.',                               grupo: 'Inventario fisico',   delegable: true,  sensible: false, efectivo: true  },
            'inventory.closeOther':  { nombre: 'Cerrar area completa',         descripcion: 'Marcar un area como terminada para TODAS las personas que cuentan en ella.',   grupo: 'Inventario fisico',   delegable: true,  sensible: true,  efectivo: true  },
            'inventory.closeGlobal': { nombre: 'Cerrar inventario',            descripcion: 'Cerrar el inventario completo y congelar el historico.',                       grupo: 'Inventario fisico',   delegable: true,  sensible: true,  efectivo: true  },
            'inventory.reopenArea':  { nombre: 'Reabrir area',                 descripcion: 'Devolver un area cerrada al estado de captura.',                               grupo: 'Inventario fisico',   delegable: true,  sensible: true,  efectivo: true  },
            'inventory.post':        { nombre: 'Contabilizar inventario',      descripcion: 'Convertir el resultado de un inventario cerrado en el inventario inicial del siguiente ciclo. Reservado a administracion.', grupo: 'Inventario fisico', delegable: true, sensible: true, efectivo: false },
            'inventory.export':      { nombre: 'Exportar inventario',          descripcion: 'Descargar el Excel del inventario.',                                           grupo: 'Inventario fisico',   delegable: true,  sensible: false, efectivo: true  },
            'inventory.history':     { nombre: 'Ver historial',                descripcion: 'Consultar inventarios de ciclos anteriores.',                                  grupo: 'Inventario fisico',   delegable: true,  sensible: false, efectivo: true  },

            // ── Catalogo ────────────────────────────────────────────────────
            'catalog.read':          { nombre: 'Ver catalogo',                 descripcion: 'Consultar los productos del catalogo.',                                        grupo: 'Catalogo',            delegable: true,  sensible: false, efectivo: true  },
            'catalog.edit':          { nombre: 'Editar productos',             descripcion: 'Crear, modificar y eliminar productos del catalogo.',                          grupo: 'Catalogo',            delegable: true,  sensible: true,  efectivo: true  },
            'catalog.publish':       { nombre: 'Importar y publicar catalogo', descripcion: 'Importar el Excel de productos y publicar el catalogo a todos los dispositivos.', grupo: 'Catalogo',          delegable: true,  sensible: true,  efectivo: true  },

            // ── Areas de conteo ─────────────────────────────────────────────
            'warehouses.read':       { nombre: 'Ver areas',                    descripcion: 'Consultar las areas de conteo configuradas.',                                  grupo: 'Areas de conteo',     delegable: true,  sensible: false, efectivo: true  },
            'warehouses.create':     { nombre: 'Crear areas',                  descripcion: 'Dar de alta un area de conteo nueva.',                                         grupo: 'Areas de conteo',     delegable: false, sensible: true,  efectivo: true  },
            'warehouses.update':     { nombre: 'Editar areas',                 descripcion: 'Cambiar el nombre visible o el icono de un area.',                             grupo: 'Areas de conteo',     delegable: false, sensible: true,  efectivo: true  },
            'warehouses.disable':    { nombre: 'Eliminar areas',               descripcion: 'Retirar un area de conteo que no sea de sistema.',                             grupo: 'Areas de conteo',     delegable: false, sensible: true,  efectivo: true  },

            // ── Compras ─────────────────────────────────────────────────────
            'purchases.read':        { nombre: 'Ver compras',                  descripcion: 'Consultar la pestana de compras.',                                             grupo: 'Compras',             delegable: true,  sensible: false, efectivo: true  },
            'purchases.create':      { nombre: 'Registrar compras',            descripcion: 'Capturar una compra manualmente.',                                             grupo: 'Compras',             delegable: true,  sensible: false, efectivo: true  },
            'purchases.import':      { nombre: 'Importar compras',             descripcion: 'Cargar compras desde un archivo.',                                             grupo: 'Compras',             delegable: true,  sensible: true,  efectivo: true  },
            'purchases.delete':      { nombre: 'Eliminar compras',             descripcion: 'Borrar registros de compra.',                                                  grupo: 'Compras',             delegable: false, sensible: true,  efectivo: false },

            // ── Reportes y datos ────────────────────────────────────────────
            'reports.read':          { nombre: 'Ver reportes',                 descripcion: 'Consultar los reportes globales publicados.',                                  grupo: 'Reportes y datos',    delegable: true,  sensible: false, efectivo: true  },
            'reports.export':        { nombre: 'Generar reportes',             descripcion: 'Generar y publicar el reporte global del inventario.',                         grupo: 'Reportes y datos',    delegable: true,  sensible: true,  efectivo: true  },
            'data.exportFull':       { nombre: 'Exportar respaldo completo',   descripcion: 'Descargar el respaldo JSON con TODOS los datos, incluido el conteo individual de cada persona.', grupo: 'Reportes y datos', delegable: false, sensible: true, efectivo: true },

            // ── Configuracion ───────────────────────────────────────────────
            'settings.read':         { nombre: 'Ver configuracion',            descripcion: 'Consultar la configuracion del sistema y el diagnostico.',                     grupo: 'Configuracion',       delegable: true,  sensible: false, efectivo: true  },
            'settings.update':       { nombre: 'Cambiar configuracion',        descripcion: 'Modificar configuracion, restaurar respaldos y pausar la sincronizacion.',     grupo: 'Configuracion',       delegable: false, sensible: true,  efectivo: true  },
            'adminLog.read':         { nombre: 'Ver historial de cambios',     descripcion: 'Consultar la bitacora de cambios administrativos.',                            grupo: 'Configuracion',       delegable: true,  sensible: true,  efectivo: false },

            // ── Sucursales (sin materia todavia) ────────────────────────────
            'branches.read':         { nombre: 'Ver sucursales',               descripcion: 'Reservado: el sistema todavia no maneja varias sucursales.',                   grupo: 'Sucursales',          delegable: false, sensible: false, efectivo: false },
            'branches.create':       { nombre: 'Crear sucursales',             descripcion: 'Reservado: el sistema todavia no maneja varias sucursales.',                   grupo: 'Sucursales',          delegable: false, sensible: true,  efectivo: false },
            'branches.update':       { nombre: 'Editar sucursales',            descripcion: 'Reservado: el sistema todavia no maneja varias sucursales.',                   grupo: 'Sucursales',          delegable: false, sensible: true,  efectivo: false },
            'branches.disable':      { nombre: 'Eliminar sucursales',          descripcion: 'Reservado: el sistema todavia no maneja varias sucursales.',                   grupo: 'Sucursales',          delegable: false, sensible: true,  efectivo: false }
        };

        // Orden de los grupos en la pantalla de administracion.
        const PERMISOS_GRUPOS_ORDEN = [
            'Inventario fisico', 'Catalogo', 'Areas de conteo', 'Compras',
            'Reportes y datos', 'Configuracion', 'Usuarios y permisos', 'Sucursales'
        ];

        function permisoMeta(permiso) {
            return PERMISOS_METADATOS[permiso] || {
                nombre: permiso, descripcion: '', grupo: 'Otros',
                delegable: false, sensible: true, efectivo: false
            };
        }
        window.permisoMeta = permisoMeta;

        // Roles de sistema — semilla y fallback si Firestore no tiene (todavía)
        // los documentos roles/{roleId}, o si no hay conexión. ADMIN usa '*'
        // (comodín: todos los permisos del catálogo, presentes y futuros).
        //
        // FASE 2 — SUBJEFE_BARRA y BARTENDER YA NO SON IDENTICOS. Hasta la
        // etapa 14.1 ambos compartian exactamente el mismo array, de modo que
        // el rol "Subjefe de Barra" no tenia ningun efecto real: existia como
        // etiqueta y nada mas. La diferencia minima que se adopta aqui:
        //
        //   Bartender  → cuenta lo suyo y consulta historico.
        //   Subjefe    → todo lo del bartender, MAS cerrar el area completa
        //                (inventory.closeOther) y exportar el Excel del
        //                inventario (inventory.export).
        //
        // Cerrar el area completa es la operacion de supervision natural del
        // subjefe: da por terminada un area para TODAS las personas que
        // cuentan en ella, sin necesidad de ver el conteo individual de
        // nadie (inventory.viewAll sigue siendo exclusivo de administracion,
        // asi que el conteo ciego se mantiene intacto).
        //
        // Estos son solo los VALORES POR DEFECTO: desde la pantalla de
        // Usuarios y permisos el administrador puede conceder o revocar
        // cualquiera de ellos por usuario sin tocar codigo.
        const ROLES_SISTEMA_DEFECTO = {
            ADMIN: {
                nombre: 'Administrador',
                permissions: ['*'],
                esSistema: true
            },
            SUBJEFE_BARRA: {
                nombre: 'Subjefe de Barra',
                permissions: [
                    'inventory.count', 'inventory.viewOwn', 'inventory.closeOwn',
                    'inventory.history', 'catalog.read', 'warehouses.read',
                    'inventory.closeOther', 'inventory.export'
                ],
                esSistema: true
            },
            BARTENDER: {
                nombre: 'Bartender',
                permissions: [
                    'inventory.count', 'inventory.viewOwn', 'inventory.closeOwn',
                    'inventory.history', 'catalog.read', 'warehouses.read'
                ],
                esSistema: true
            }
        };

        // Mapeo de compatibilidad: valores LEGACY de usuarios/{uid}.role hacia
        // un roleId canónico, SOLO para efectos de resolución de permisos EN
        // MEMORIA. Nunca reescribe el documento — el valor 'admin'/'user'
        // original permanece intacto en Firestore hasta que se ejecute
        // migrarRolesExistentes() de forma explícita (ver más abajo).
        const ROLE_LEGACY_A_CANONICO = { admin: 'ADMIN', user: 'BARTENDER' };
        function _roleCanonico(rawRole) {
            if (!rawRole) return 'BARTENDER'; // mismo default que el código legacy (|| 'user')
            return ROLE_LEGACY_A_CANONICO[rawRole] || rawRole; // ya canónico, o desconocido → se usa tal cual
        }

        // Caché en memoria de definiciones de rol leídas de Firestore
        // (roles/{roleId}) — evita una lectura por cada resolución de
        // permisos. Se reconstruye al recargar la página; no hay listener en
        // vivo sobre roles/ en esta etapa (ver "Riesgos restantes" en el
        // entregable) — coherente con "no agregar todavía un sistema
        // complejo de caché" pedido por el ticket.
        let _rolesCache = {};

        async function _resolverPermisosDeRol(roleId) {
            if (_rolesCache[roleId]) return _rolesCache[roleId];
            let permisos = null;
            if (_db) {
                try {
                    const snap = await _db.collection('roles').doc(roleId).get();
                    if (snap.exists && Array.isArray(snap.data().permissions)) {
                        permisos = snap.data().permissions;
                    }
                } catch (e) {
                    console.warn('[Permisos] No se pudo leer roles/' + roleId + ' — usando definición por defecto:', e);
                }
            }
            if (!permisos) {
                // Fallback: rol de sistema conocido, o BARTENDER si es un roleId
                // desconocido (nunca se otorga '*' por defecto ante lo desconocido).
                permisos = (ROLES_SISTEMA_DEFECTO[roleId] || ROLES_SISTEMA_DEFECTO.BARTENDER).permissions;
            }
            _rolesCache[roleId] = permisos;
            return permisos;
        }

        // Crea (idempotente, solo si faltan) los 3 documentos roles/{roleId}
        // de sistema en Firestore. Esto NO es "migración de datos de
        // usuario" — es asegurar que exista la configuración base del
        // sistema, tan seguro de repetir como publicarCatalogoFirestore().
        // Se ejecuta de forma perezosa la primera vez que un ADMIN resuelve
        // sus propios permisos; nunca se dispara para un usuario no-admin.
        async function _asegurarRolesSistemaEnFirestore() {
            if (!_db) return;
            try {
                const batch = _db.batch();
                let huboCambios = false;
                for (const roleId of Object.keys(ROLES_SISTEMA_DEFECTO)) {
                    const ref  = _db.collection('roles').doc(roleId);
                    const snap = await ref.get();
                    if (!snap.exists) {
                        const def = ROLES_SISTEMA_DEFECTO[roleId];
                        batch.set(ref, {
                            roleId:        roleId,
                            nombre:        def.nombre,
                            permissions:   def.permissions,
                            esSistema:     true,
                            creadoEn:      Date.now(),
                            actualizadoEn: Date.now()
                        });
                        huboCambios = true;
                    }
                }
                if (huboCambios) {
                    await batch.commit();
                    console.info('[Permisos] Roles de sistema creados en Firestore ✓');
                    _rolesCache = {}; // forzar relectura la próxima vez que se resuelvan permisos
                }
            } catch (e) {
                console.warn('[Permisos] No se pudieron crear los roles de sistema (no crítico, se usa el fallback local):', e);
            }
        }

        // Overrides válidos ÚNICAMENTE con valor 'allow' o 'deny' — cualquier
        // otro valor (true, false, null, strings arbitrarios) o cualquier
        // permiso fuera del catálogo se descarta silenciosamente y NO
        // participa en la resolución.
        function _sanitizarOverrides(raw) {
            const limpio = {};
            if (raw && typeof raw === 'object') {
                Object.keys(raw).forEach(function(perm) {
                    if (PERMISOS_CATALOGO_SET.has(perm) && (raw[perm] === 'allow' || raw[perm] === 'deny')) {
                        limpio[perm] = raw[perm];
                    }
                });
            }
            return limpio;
        }

        // ── Estado de autorización en memoria (caché de LA SESIÓN ACTUAL) ──
        // Se reconstruye POR COMPLETO (nunca se fusiona con el anterior) cada
        // vez que loadUserRole() corre, y se limpia por completo en logout —
        // así no sobreviven permisos de un usuario a la sesión del siguiente.
        let _authzState = {
            loaded:      false,
            uid:         null,
            legacyRole:  null,   // valor crudo tal cual está en Firestore hoy
            roleId:      null,   // roleId canónico resuelto (ADMIN/SUBJEFE_BARRA/BARTENDER/...)
            permissions: null,   // Set<string> — permisos del rol ya resueltos
            overrides:   {},     // permissionOverrides ya saneados
            disabled:    false   // ETAPA 14.1.1: true si usuarios/{uid}.status === 'inactivo'
        };
        function _resetAuthzState() {
            _authzState = { loaded: false, uid: null, legacyRole: null, roleId: null, permissions: null, overrides: {}, disabled: false };
        }

        // ══════════════════════════════════════════════════════════════════════
        //  hasPermission() — ÚNICA autoridad de resolución de permisos del
        //  frontend. No crear hasPermissionAdmin()/hasPermissionUser()/etc. —
        //  toda decisión de permiso pasa por aquí.
        //
        //  Orden de resolución:
        //    1. El permiso no existe en el catálogo             → DENEGADO
        //    2. No hay usuario autenticado / permisos sin cargar → DENEGADO
        //    3. El rol resuelto tiene '*' (ADMIN)                → PERMITIDO
        //       (EXCEPCIÓN DELIBERADA Y DOCUMENTADA: ADMIN es autoridad
        //       absoluta — ningún override de usuario, ni siquiera un 'deny'
        //       explícito, puede degradar a un ADMIN. Ver prueba obligatoria
        //       "Override deny + ADMIN" del ticket de esta etapa.)
        //    4. Override 'deny' explícito del usuario            → DENEGADO
        //    5. Override 'allow' explícito del usuario           → PERMITIDO
        //    6. El permiso está en la lista de permisos del rol  → PERMITIDO
        //    7. Ninguna coincidencia                              → DENEGADO
        //
        //  NOTA ETAPA 14.1.1: no fue necesario tocar esta función. Cuando la
        //  cuenta está desactivada (_authzState.disabled), _actualizarAuthzState()
        //  ya deja permissions como un Set VACÍO (sin '*') — así que el paso 3
        //  nunca se cumple para una cuenta desactivada y el resto de los pasos
        //  tampoco encuentran coincidencia. Un solo lugar decide la regla.
        // ══════════════════════════════════════════════════════════════════════
        function hasPermission(permission) {
            if (!PERMISOS_CATALOGO_SET.has(permission)) {
                console.warn('[Permisos] Permiso fuera de catálogo, denegado:', permission);
                return false;
            }
            if (!currentUserUid || !_authzState.loaded || !_authzState.permissions) return false;
            if (_authzState.permissions.has('*')) return true; // ADMIN: autoridad absoluta
            const ov = _authzState.overrides;
            if (ov[permission] === 'deny')  return false;
            if (ov[permission] === 'allow') return true;
            return _authzState.permissions.has(permission);
        }
        window.hasPermission = hasPermission; // testeable desde consola — mismo patrón que window._db/_auth

        // ══════════════════════════════════════════════════════════════════════
        //  FASE 2 — permisosEfectivos(userData)
        //  ────────────────────────────────────────────────────────────────────
        //  Resuelve los permisos efectivos de CUALQUIER usuario a partir de su
        //  documento, aplicando EXACTAMENTE la misma precedencia que
        //  hasPermission() aplica sobre el usuario de la sesion. Existe para
        //  que la pantalla de administracion pueda mostrar "que tiene
        //  realmente esta persona" sin reimplementar la regla — si hubiera dos
        //  implementaciones, la pantalla podria ensenar algo distinto de lo que
        //  el sistema aplica, que es justo lo que el principio de fuente de
        //  verdad unica prohibe.
        //
        //  Devuelve, por permiso del catalogo, uno de estos estados:
        //    'heredado'  — lo da el rol
        //    'asignado'  — override 'allow' individual
        //    'revocado'  — override 'deny' individual
        //    'ninguno'   — no lo tiene
        //    'comodin'   — el rol es ADMIN ('*'): lo tiene todo y ningun
        //                  override puede degradarlo
        // ══════════════════════════════════════════════════════════════════════
        function permisosEfectivos(userData) {
            const legacyRole = (userData && userData.role) || 'user';
            const roleId     = _roleCanonico(legacyRole);
            const activo     = ((userData && userData.status) || 'activo') !== 'inactivo';
            const delRol     = _rolesCache[roleId] ||
                (ROLES_SISTEMA_DEFECTO[roleId] || ROLES_SISTEMA_DEFECTO.BARTENDER).permissions;
            const setRol     = new Set(activo ? delRol : []);
            const overrides  = activo ? _sanitizarOverrides(userData && userData.permissionOverrides) : {};
            const comodin    = setRol.has('*');

            const estados = {};
            PERMISOS_CATALOGO.forEach(function(p) {
                if (comodin)                      estados[p] = 'comodin';
                else if (overrides[p] === 'deny')  estados[p] = 'revocado';
                else if (overrides[p] === 'allow') estados[p] = 'asignado';
                else if (setRol.has(p))            estados[p] = 'heredado';
                else                               estados[p] = 'ninguno';
            });

            return {
                roleId:      roleId,
                legacyRole:  legacyRole,
                activo:      activo,
                comodin:     comodin,
                permisosRol: Array.from(setRol),
                overrides:   overrides,
                estados:     estados,
                concedidos:  PERMISOS_CATALOGO.filter(function(p) {
                    return estados[p] === 'comodin' || estados[p] === 'asignado' || estados[p] === 'heredado';
                })
            };
        }
        window.permisosEfectivos = permisosEfectivos;

        // ══════════════════════════════════════════════════════════════════════
        //  FASE 2 (D3) — AREAS ASIGNADAS POR USUARIO
        //  ────────────────────────────────────────────────────────────────────
        //  Decision del propietario: el campo AUSENTE significa TODAS las
        //  areas, nunca "ninguna". Cualquier otra interpretacion dejaria sin
        //  poder contar, el dia del despliegue, a todo el personal existente
        //  —ningun documento usuarios/{uid} tiene hoy este campo—.
        //  La restriccion solo empieza a existir cuando un administrador fija
        //  una lista explicita.
        //
        //  Un array vacio SI significa "ninguna area": es una decision
        //  deliberada del administrador, distinta de la ausencia del campo.
        // ══════════════════════════════════════════════════════════════════════
        function areasDeUsuario(userData) {
            const raw = userData && userData.areasAsignadas;
            if (!Array.isArray(raw)) return null; // null = sin restriccion = todas
            return raw.filter(function(a) { return typeof a === 'string' && a; });
        }
        window.areasDeUsuario = areasDeUsuario;

        // ¿Puede el usuario de ESTA sesion operar sobre el area indicada?
        // Un administrador (comodin) nunca queda restringido por areas.
        function puedeOperarArea(area) {
            if (!area) return false;
            if (isAdmin()) return true;
            const permitidas = areasDeUsuario(_lastUserData);
            if (permitidas === null) return true; // campo ausente = todas
            return permitidas.indexOf(area) !== -1;
        }
        window.puedeOperarArea = puedeOperarArea;

        // ══════════════════════════════════════════════════════════════════════
        //  ETAPA 14.1.1 — SINCRONIZACIÓN EN TIEMPO REAL DEL CONTEXTO DE
        //  AUTORIZACIÓN
        //  ────────────────────────────────────────────────────────────────────
        //  Dos listeners, MISMO patrón de desduplicación que el resto de la
        //  app (_unsubX + guard "si ya existe, no crear otro" — ver
        //  subscribeNotificacionesUsuario/subscribeAjustesPendientes, etc.):
        //
        //    usuarios/{uid}   (SIEMPRE el propio uid, nunca otros usuarios)
        //    roles/{roleId}   (SOLO el rol actualmente resuelto de ESTE
        //                      usuario — nunca todos los roles del catálogo)
        //
        //  Ambos convergen en UNA sola función de reconciliación,
        //  _actualizarAuthzState(), que es la única que escribe _authzState.
        //  No existe una segunda ruta de resolución de permisos.
        // ══════════════════════════════════════════════════════════════════════
        let _unsubUsuarioPropio   = null;
        let _unsubRolActual       = null;
        let _rolEscuchadoActualId = null;
        let _lastUserData         = null; // último perfil conocido de usuarios/{uid} — fuente para reconciliar

        // Huella comparable del estado de autorización — permite detectar si
        // un nuevo cálculo realmente cambió algo antes de re-renderizar
        // (PASO 3.9 / PASO 11: evitar reconstrucciones y renders innecesarios).
        function _huellaAuthz(state) {
            if (!state || !state.loaded) return 'unloaded';
            const perms = state.permissions ? Array.from(state.permissions).sort().join(',') : '';
            const overr = state.overrides ? Object.keys(state.overrides).sort().map(function(k) { return k + ':' + state.overrides[k]; }).join(',') : '';
            return state.roleId + '|' + perms + '|' + overr + '|' + (state.disabled ? '1' : '0');
        }

        // ══════════════════════════════════════════════════════════════════════
        //  _actualizarAuthzState() — ÚNICA función de reconciliación del
        //  contexto de autorización. Se invoca desde tres disparadores
        //  posibles: carga inicial (loadUserRole), snapshot de usuarios/{uid},
        //  snapshot de roles/{roleId}.
        //
        //  SIEMPRE re-deriva TODO desde la fuente más fresca conocida
        //  (_lastUserData + _rolesCache) en vez de confiar en cuál de los dos
        //  listeners la disparó — así, sin importar el orden de llegada de
        //  los eventos, el resultado final es determinista (PASO 10: cambio
        //  de rol + cambio de permisos del rol casi simultáneo). Si el roleId
        //  resuelto cambió respecto al que se estaba escuchando, esta función
        //  reapunta el listener de rol automáticamente (PASO 5).
        // ══════════════════════════════════════════════════════════════════════
        function _actualizarAuthzState() {
            if (!currentUserUid || !_lastUserData) return;

            const legacyRole  = _lastUserData.role || 'user';
            const roleId      = _roleCanonico(legacyRole);
            const status      = _lastUserData.status || 'activo';
            const cuentaActiva = status !== 'inactivo';

            // PASO 5/10: si el rol resuelto cambió, reapuntar el listener de
            // rol ANTES de leer _rolesCache[roleId] (puede que todavía no
            // tengamos ese rol en caché — _resolverPermisosDeRol más abajo
            // cubre ese primer instante con su propio fallback).
            if (roleId !== _rolEscuchadoActualId) {
                _suscribirRolActual(roleId);
            }

            const permisosDelRol = _rolesCache[roleId] ||
                (ROLES_SISTEMA_DEFECTO[roleId] || ROLES_SISTEMA_DEFECTO.BARTENDER).permissions;

            // PASO 7 — status='inactivo': se invalida el contexto de
            // autorización (permisos VACÍOS) en vez de forzar logout. Ver
            // justificación en el entregable de esta etapa.
            const permisosEfectivos = cuentaActiva ? new Set(permisosDelRol) : new Set();
            const overridesEfectivos = cuentaActiva ? _sanitizarOverrides(_lastUserData.permissionOverrides) : {};

            const eraActivaAntes = _authzState.loaded && !_authzState.disabled;
            const huellaAnterior = _huellaAuthz(_authzState);

            _authzState = { // reemplazo ATÓMICO — nunca una mutación parcial
                loaded:      true,
                uid:         currentUserUid,
                legacyRole:  legacyRole,
                roleId:      roleId,
                permissions: permisosEfectivos,
                overrides:   overridesEfectivos,
                disabled:    !cuentaActiva
            };

            if (_huellaAuthz(_authzState) === huellaAnterior) return; // nada cambió de verdad → no re-renderizar

            console.info('[Permisos] Contexto de autorización actualizado:', {
                roleId: roleId,
                permisos: permisosEfectivos.has('*') ? '*' : permisosEfectivos.size,
                disabled: !cuentaActiva
            });

            if (!cuentaActiva && eraActivaAntes) {
                showNotification('⚠️ Tu cuenta fue desactivada por un administrador. Algunas acciones ya no están disponibles.');
            } else if (cuentaActiva && !eraActivaAntes && _authzState.loaded) {
                showNotification('✅ Tu cuenta fue reactivada.');
            }

            applyRoleUI(); // re-renderiza badge/nav/tab actual con las restricciones vigentes

            // MICROFASE P0.2 (REQUISITO P1): tras aplicar la UI, reconciliar
            // qué CONJUNTO de listeners de datos debe estar activo. Antes,
            // esta decisión se tomaba UNA sola vez dentro de loadUserRole() y
            // nunca se revisaba de nuevo — un cambio de rol en tiempo real
            // (14.1.1) actualizaba _authzState/la UI correctamente, pero un
            // admin degradado seguía recibiendo en segundo plano los datos
            // de subscribeAllUsersAuditoria()/subscribeAjustesPendientes().
            _reconciliarListenersPorAutorizacion();
        }

        // ══════════════════════════════════════════════════════════════════════
        //  _reconciliarListenersPorAutorizacion() — MICROFASE P0.2 (REQUISITO
        //  P1.1: "un solo punto de reconciliación")
        //  ────────────────────────────────────────────────────────────────────
        //  ÚNICA función que decide qué conjunto de listeners de datos debe
        //  estar activo, según isAdmin() YA RESUELTO por _actualizarAuthzState()
        //  o por el bootstrap síncrono de loadUserRole(). Se invoca:
        //    1. Al final de loadUserRole() (arranque de sesión) — reemplaza al
        //       bloque if(isAdmin()){...}else{...} que antes vivía ahí inline,
        //       para que exista un único camino, no dos que puedan divergir.
        //    2. Al final de _actualizarAuthzState() en cada reconciliación de
        //       autorización en tiempo real (14.1.1).
        //
        //  Idempotente (REQUISITO P1.7): si el modo (admin/usuario) no
        //  cambió respecto a la última llamada, no hace nada — no
        //  desuscribe ni vuelve a suscribir nada innecesariamente, sin
        //  importar cuántas veces se invoque.
        // ══════════════════════════════════════════════════════════════════════
        let _modoListenersActual = null; // null | 'admin' | 'usuario' — qué conjunto está activo AHORA MISMO

        function _reconciliarListenersPorAutorizacion() {
            if (!currentUserUid) return; // sin sesión, nada que reconciliar

            const modoNuevo = isAdmin() ? 'admin' : 'usuario';
            if (modoNuevo === _modoListenersActual) return; // nada cambió → no-op

            const modoAnterior = _modoListenersActual;
            _modoListenersActual = modoNuevo;

            if (modoNuevo === 'admin') {
                // Se ganó autorización de admin (o es el arranque inicial ya
                // siendo admin): apagar listeners de "usuario" que ya no
                // corresponden, encender los de "admin".
                if (typeof _unsubMyAuditoria === 'function') { _unsubMyAuditoria(); _unsubMyAuditoria = null; }
                if (typeof _unsubNotifs      === 'function') { _unsubNotifs();      _unsubNotifs      = null; }
                // subscribeCatalogoAdmin() es un no-op (el admin publica el
                // catálogo, no necesita escucharlo) — se apaga igualmente el
                // listener de catálogo de usuario para no dejarlo huérfano.
                if (typeof _unsubCatalogo === 'function') { _unsubCatalogo(); _unsubCatalogo = null; }

                subscribeAjustesPendientes();
                subscribeCatalogoAdmin();
                subscribeAllUsersAuditoria(); // Admin ve todos los conteos en tiempo real

                console.info('[Permisos] Listeners reconciliados → modo ADMIN' + (modoAnterior ? ' (antes: ' + modoAnterior + ')' : ' (arranque)'));
            } else {
                // Se perdió autorización de admin (degradación en tiempo
                // real) o es el arranque inicial como no-admin: apagar
                // listeners administrativos INMEDIATAMENTE y limpiar los
                // datos ya recibidos que ya no corresponde conservar.
                if (typeof _unsubAllUsers === 'function') { _unsubAllUsers(); _unsubAllUsers = null; }
                if (typeof _unsubAjustes  === 'function') { _unsubAjustes();  _unsubAjustes  = null; }
                if (typeof _unsubCatalogo === 'function') { _unsubCatalogo(); _unsubCatalogo = null; }

                // REQUISITO P1.2 (pasos 6-7-9 del ticket): sin esto, los
                // conteos de TODOS los usuarios y los ajustes administrativos
                // seguirían siendo accesibles en memoria (allUsersAuditoria,
                // _ajustes) aunque los listeners ya estén apagados.
                allUsersAuditoria = {};
                _ajustes = [];

                subscribeCatalogoUsuario();
                subscribeNotificacionesUsuario();
                subscribeMyAuditoria(); // Usuario escucha sus propios desbloqueos

                console.info('[Permisos] Listeners reconciliados → modo USUARIO' + (modoAnterior ? ' (antes: ' + modoAnterior + ')' : ' (arranque)'));
            }
        }

        // Listener en vivo del PROPIO documento usuarios/{uid} — única fuente
        // de verdad para role/status/permissionOverrides/displayName de este
        // usuario. Nunca se suscribe al doc de otro usuario.
        function _suscribirUsuarioPropio(uid) {
            if (!_db || !uid || _unsubUsuarioPropio) return; // desduplicación (PASO 11)
            _unsubUsuarioPropio = _db.collection('usuarios').doc(uid).onSnapshot(function(snap) {
                if (snap.exists) {
                    _lastUserData = snap.data();
                } else {
                    _lastUserData = _lastUserData || { role: 'user' };
                }
                _actualizarAuthzState();
            }, function(err) {
                console.warn('[Permisos] Error en listener de usuarios/' + uid + ':', err);
                // PASO 16 (offline): un error de listener NO borra _lastUserData
                // ni _authzState — se conserva el último contexto conocido de
                // forma segura hasta que el SDK reconecte por su cuenta.
            });
        }

        // Listener en vivo del documento roles/{roleId} ACTUALMENTE en uso
        // por este usuario — SOLO ese, nunca una suscripción a todos los
        // roles del catálogo (PASO 2). Si el roleId del usuario cambia, este
        // listener se destruye y se vuelve a crear apuntando al nuevo roleId.
        function _suscribirRolActual(roleId) {
            if (!_db || !roleId) return;
            if (_unsubRolActual && _rolEscuchadoActualId === roleId) return; // ya escuchando este mismo rol
            if (typeof _unsubRolActual === 'function') { _unsubRolActual(); _unsubRolActual = null; }
            _rolEscuchadoActualId = roleId;
            _unsubRolActual = _db.collection('roles').doc(roleId).onSnapshot(function(snap) {
                if (snap.exists && Array.isArray(snap.data().permissions)) {
                    _rolesCache[roleId] = snap.data().permissions;
                } else {
                    delete _rolesCache[roleId]; // fallback a ROLES_SISTEMA_DEFECTO
                }
                _actualizarAuthzState();
            }, function(err) {
                console.warn('[Permisos] Error en listener de roles/' + roleId + ':', err);
            });
        }

        let _syncEnabled    = true;
        let _unsubAjustes   = null;
        let _unsubCatalogo  = null;
        let _unsubNotifs    = null;
        let _unsubMainDoc   = null;  // FIX SYNC-3: listener del documento principal de inventario

        // ══════════════════════════════════════════════════════════════════════
        //  FIX SYNC-3: LISTENER EN TIEMPO REAL DEL DOCUMENTO PRINCIPAL
        // ══════════════════════════════════════════════════════════════════════
        /**
         * subscribeMainDoc()
         * ───────────────────
         * Establece un onSnapshot en inventarioApp/{FIRESTORE_DOC_ID}.
         * Cuando admin (u otro dispositivo) escribe en Firestore, TODOS los
         * dispositivos reciben la actualización vía WebSocket en ~100-500ms,
         * sin necesidad de polling ni recarga manual.
         *
         * Anti-echo de 2 capas:
         *  1. hasPendingWrites = true → el cambio viene de este propio dispositivo
         *     (Firestore lo marca antes de confirmación del servidor) → ignorar.
         *  2. _lastWrittenBy === currentUserUid → confirmación de que escribió
         *     este mismo usuario → ignorar.
         *
         * Si ninguna capa bloquea → es un cambio externo (admin u otro bartender)
         * → llamar _applyCloudData() para actualizar estado y renderizar UI.
         */
        let _mainDocReconnectAttempts = 0;
        let _mainDocReconnectTimer = null;

        function subscribeMainDoc() {
            if (!_db) return;
            // Cancelar listener anterior si existía (ej. tras cierre de sesión)
            if (typeof _unsubMainDoc === 'function') { _unsubMainDoc(); _unsubMainDoc = null; }
            if (_mainDocReconnectTimer) { clearTimeout(_mainDocReconnectTimer); _mainDocReconnectTimer = null; }

            const docRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID);
            _unsubMainDoc = docRef.onSnapshot(
                { includeMetadataChanges: true },
                function(snapshot) {
                    _mainDocReconnectAttempts = 0; // snapshot recibido con éxito: resetear contador de reintentos
                    if (!snapshot.exists) return;

                    // Capa 1: ignorar escrituras propias aún en tránsito (optimistic updates)
                    if (snapshot.metadata.hasPendingWrites) return;

                    const data = snapshot.data();

                    // Capa 2: ignorar si fue este mismo usuario/dispositivo quien escribió
                    const writerUid = data._lastWrittenBy;
                    if (writerUid && writerUid === currentUserUid) return;

                    // Cambio externo confirmado: admin o bartender distinto.
                    // Si es del servidor (no del caché local) proceder siempre.
                    if (snapshot.metadata.fromCache) return; // caché local, esperar confirmación red

                    const cloudTs = data._lastModified || 0;
                    const localTs = parseInt(localStorage.getItem('inventarioApp_lastModified') || '0', 10);

                    if (cloudTs <= localTs) return; // no hay nada más nuevo que lo local

                    console.info('[RT-Sync] Cambio externo detectado por', writerUid || 'desconocido',
                                 '— aplicando datos de admin/red…');
                    updateCloudSyncBadge('syncing');

                    _applyCloudData(data).then(function() {
                        const quien = data._lastWrittenRole === 'admin' ? '👑 Admin' : '👤 Usuario';
                        showNotification('🔄 Inventario actualizado por ' + quien);
                    }).catch(function(err) {
                        console.error('[RT-Sync] Error aplicando datos externos:', err);
                        updateCloudSyncBadge('error');
                    });
                },
                function(err) {
                    // FIX-PROP-4: antes este error solo se registraba en consola y el
                    // listener quedaba muerto para el resto de la sesión — un dispositivo
                    // así nunca se enteraba de una nueva auditoría hasta recargar la
                    // página. Ahora se reintenta la suscripción con backoff acotado
                    // (hasta 5 intentos, 3s/6s/12s/24s/48s), y se refleja en el badge
                    // de sincronización para que no sea un fallo silencioso.
                    console.warn('[RT-Sync] Error en listener del documento principal:', err);
                    _unsubMainDoc = null;
                    if (_mainDocReconnectAttempts < 5) {
                        _mainDocReconnectAttempts++;
                        const espera = Math.min(3000 * Math.pow(2, _mainDocReconnectAttempts - 1), 48000);
                        updateCloudSyncBadge('error');
                        console.info('[RT-Sync] Reintentando suscripción en', espera, 'ms (intento', _mainDocReconnectAttempts, '/5)');
                        _mainDocReconnectTimer = setTimeout(function() {
                            if (navigator.onLine) subscribeMainDoc();
                        }, espera);
                    } else {
                        console.error('[RT-Sync] Listener del documento principal agotó sus reintentos — '
                            + 'se recuperará en la próxima recarga o reconexión de red.');
                    }
                }
            );

            console.info('[RT-Sync] Listener activo en inventarioApp/' + FIRESTORE_DOC_ID);
        }
        let _notificaciones = [];
        let _ajustes        = [];
        let _conteoSearchTerm = '';   // búsqueda dentro del conteo de inventario
        let _csSearchTimer    = null;  // debounce handle del buscador inteligente
        // FIX-BUSCADOR-PEDIDOS-HISTORIA (BarInventario): estado del buscador en
        // las pestañas de Pedidos e Historia — transitorio, no se persiste
        // (igual que _conteoSearchTerm), se reinicia en cada carga de la app.
        let _pedidosSearchTerm  = '';
        let _historiaSearchTerm = '';
        let _pedSearchTimer     = null;
        let _histSearchTimer    = null;

        // ETAPA 14.1: isAdmin() conserva firma y contrato ("¿privilegios
        // administrativos totales?") — ya NO compara currentUserRole
        // directamente, delega en el wildcard '*' resuelto por el nuevo
        // sistema de permisos (ver _authzState/hasPermission arriba). Ningún
        // llamador (+65 sitios en este archivo) necesita cambiar.
        function isAdmin() {
            return _authzState.loaded && !!_authzState.permissions && _authzState.permissions.has('*');
        }

        async function loadUserRole(uid) {
            if (!_db || !uid) { currentUserRole = 'user'; _resetAuthzState(); applyRoleUI(); return; }
            currentUserUid = uid;
            let userData = null;
            try {
                const ref  = _db.collection('usuarios').doc(uid);
                const snap = await ref.get();
                if (snap.exists) {
                    userData = snap.data();
                    currentUserRole = userData.role || 'user';
                } else {
                    // Auto-creación de usuario nuevo: SIN CAMBIOS respecto al
                    // comportamiento anterior — se sigue creando con role:'user'
                    // (legacy). _roleCanonico('user') ya lo resuelve a
                    // BARTENDER para efectos de permisos; no hay necesidad de
                    // tocar este valor para lograrlo (ver entregable, decisión
                    // documentada).
                    await ref.set({ uid, role: 'user', creadoEn: Date.now() });
                    currentUserRole = 'user';
                    userData = { uid: uid, role: 'user' };
                }
                console.info('[Roles] Rol:', currentUserRole);
            } catch (e) {
                console.warn('[Roles] Error leyendo rol:', e);
                currentUserRole = 'user';
                userData = { role: 'user' };
            }

            // ETAPA 14.1: resolver roles/permisos ANTES de que isAdmin() se
            // use más abajo — subscribeAllUsersAuditoria() vs
            // subscribeMyAuditoria() depende de un isAdmin() ya resuelto.
            const roleId = _roleCanonico(currentUserRole);
            let permisosArray;
            try {
                permisosArray = await _resolverPermisosDeRol(roleId);
            } catch (e) {
                console.warn('[Permisos] Fallback a permisos por defecto para', roleId, e);
                permisosArray = (ROLES_SISTEMA_DEFECTO[roleId] || ROLES_SISTEMA_DEFECTO.BARTENDER).permissions;
            }
            _rolesCache[roleId] = permisosArray; // ETAPA 14.1.1: comparte caché con el listener en vivo

            // ETAPA 14.1.1: _lastUserData es la fuente que usará
            // _actualizarAuthzState() en cada reconciliación futura — se
            // establece aquí ANTES de la primera construcción de _authzState
            // para que ambas rutas (bootstrap inicial y reconciliaciones en
            // vivo posteriores) apliquen exactamente la misma regla de
            // status='inactivo' (ver PASO 7).
            _lastUserData = userData;
            const cuentaActivaInicial = (userData && userData.status) !== 'inactivo';
            _authzState = {
                loaded:      true,
                uid:         uid,
                legacyRole:  currentUserRole,
                roleId:      roleId,
                permissions: cuentaActivaInicial ? new Set(permisosArray) : new Set(),
                overrides:   cuentaActivaInicial ? _sanitizarOverrides(userData && userData.permissionOverrides) : {},
                disabled:    !cuentaActivaInicial
            };

            // Asegurar (perezoso, idempotente) que los 3 roles de sistema
            // existan en Firestore — solo si este usuario es ADMIN.
            if (isAdmin()) {
                _asegurarRolesSistemaEnFirestore();
            }

            applyRoleUI();

            // ETAPA 14.1.1: listeners en tiempo real — mantienen _authzState
            // sincronizado con Firestore sin necesidad de logout/reload.
            // Se activan DESPUÉS del bootstrap síncrono de arriba (que ya
            // garantiza que isAdmin() esté resuelto para las suscripciones
            // que siguen) — nunca antes, para no cambiar el orden/timing que
            // ya dependía de esa resolución síncrona inicial.
            _suscribirUsuarioPropio(uid);
            _suscribirRolActual(roleId);

            // FIX SYNC-4: iniciar listener en tiempo real del documento principal
            // DESPUÉS de cargar el rol, para que _applyCloudData sepa si somos admin o user.
            subscribeMainDoc();

            // MICROFASE P0.2 (REQUISITO P1.1): antes este bloque decidía
            // directamente aquí, en línea, cuáles de los 6 listeners de
            // datos activar (if(isAdmin()){...}else{...}). Esa decisión
            // nunca se volvía a evaluar tras el arranque, así que un cambio
            // de rol en tiempo real (14.1.1) dejaba el conjunto de
            // listeners desactualizado respecto al isAdmin() vigente. Ahora
            // existe UN SOLO lugar que decide esto —
            // _reconciliarListenersPorAutorizacion()— invocado tanto aquí
            // (arranque) como al final de _actualizarAuthzState() (cambios
            // en tiempo real), para que nunca puedan divergir entre sí.
            _reconciliarListenersPorAutorizacion();
        }

        // ══════════════════════════════════════════════════════════════════════
        //  migrarRolesExistentes() — ETAPA 14.1
        //  ────────────────────────────────────────────────────────────────────
        //  Acción ADMINISTRATIVA EXPLÍCITA — NUNCA se ejecuta automáticamente
        //  al abrir la app. Recorre usuarios/* y reescribe SOLO el campo
        //  'role' de los documentos que todavía usan un valor legacy
        //  ('admin'/'user') hacia su equivalente canónico
        //  ('ADMIN'/'BARTENDER'). Idempotente: un usuario ya migrado (role ya
        //  es ADMIN/SUBJEFE_BARRA/BARTENDER) se omite sin escribir nada. No
        //  toca permissionOverrides, displayName, ni ningún otro campo.
        // ══════════════════════════════════════════════════════════════════════
        async function migrarRolesExistentes() {
            if (!hasPermission('users.update')) {
                showNotification('⚠️ No tienes permiso para migrar roles de usuario');
                return;
            }
            if (!_db)              { showNotification('📴 Sin conexión a Firestore'); return; }
            if (!navigator.onLine) { showNotification('📴 Sin conexión — intenta de nuevo con internet'); return; }

            showConfirm(
                '🔁 Migrar roles legacy a nuevo modelo\n\n' +
                'Esto actualizará el campo "role" de los usuarios que todavía usan ' +
                "'admin'/'user' hacia 'ADMIN'/'BARTENDER'.\n\n" +
                'Los usuarios ya migrados se omiten (operación segura de repetir). ' +
                'No se modifica ningún otro dato del usuario.\n\n' +
                '¿Continuar?',
                async function() {
                    showNotification('⏳ Migrando roles…');
                    try {
                        const snap = await _db.collection('usuarios').get();
                        const ROLES_VALIDOS_CANONICOS = new Set(Object.keys(ROLES_SISTEMA_DEFECTO));
                        let migrados = 0, omitidos = 0;
                        const docsToUpdate = [];
                        snap.forEach(function(doc) {
                            const data    = doc.data();
                            const rawRole = data.role;
                            if (ROLES_VALIDOS_CANONICOS.has(rawRole)) {
                                omitidos++; // ya migrado — no tocar (idempotencia)
                                return;
                            }
                            const nuevo = ROLE_LEGACY_A_CANONICO[rawRole];
                            if (!nuevo) {
                                omitidos++; // valor desconocido/no mapeable — no se toca por seguridad
                                return;
                            }
                            // REGLA ESPECIAL PARA ADMIN del ticket: defensa
                            // explícita adicional — esta rama nunca puede
                            // degradar a un admin, porque el único mapeo
                            // posible desde 'admin' es hacia 'ADMIN' (una
                            // equivalencia, no una degradación). Se deja el
                            // check aquí de todos modos, para que sea
                            // imposible incluso si el mapeo cambiara.
                            if (rawRole === 'admin' && nuevo !== 'ADMIN') return;
                            docsToUpdate.push({ ref: doc.ref, nuevo: nuevo });
                        });

                        // Batches de máximo 400 operaciones (margen bajo el límite de 500 de Firestore)
                        for (let i = 0; i < docsToUpdate.length; i += 400) {
                            const chunk = docsToUpdate.slice(i, i + 400);
                            const batch = _db.batch();
                            chunk.forEach(function(item) {
                                batch.update(item.ref, {
                                    role:      item.nuevo,
                                    updatedAt: Date.now(),
                                    updatedBy: currentUserUid
                                });
                            });
                            await batch.commit();
                            migrados += chunk.length;
                        }

                        showNotification('✅ Migración completa — ' + migrados + ' actualizado(s), ' + omitidos + ' ya estaban al día');
                        console.info('[Migración roles]', { migrados: migrados, omitidos: omitidos });
                    } catch (err) {
                        console.error('[Migración roles] Error:', err);
                        showNotification('❌ Error durante la migración — revisa la conexión e intenta de nuevo');
                    }
                }
            );
        }
        window.migrarRolesExistentes = migrarRolesExistentes;


        function applyRoleUI() {
            const badge = document.getElementById('sbRoleBadge');
            if (badge) {
                badge.textContent = isAdmin() ? '👑 Admin' : '👤 Usuario';
                badge.className   = 'role-badge ' + (isAdmin() ? 'admin' : 'user');
            }
            const sep = document.getElementById('sbAdminSep');
            const btn = document.getElementById('sbAdminBtn');
            if (sep) sep.style.display = isAdmin() ? '' : 'none';
            if (btn) btn.style.display  = isAdmin() ? '' : 'none';
            renderTab();
        }

        // ── Toggle sincronización ──────────────────────────────────────────
        function toggleSyncEnabled() {
            // Solo el admin puede pausar/reanudar la sincronización
            if (!isAdmin()) {
                showNotification('⚠️ Solo el administrador puede pausar la sincronización');
                return;
            }
            _syncEnabled = !_syncEnabled;
            const pill = document.getElementById('syncPill');
            if (pill) pill.classList.toggle('on', _syncEnabled);
            if (_syncEnabled) {
                showNotification('☁️ Sync activado — subiendo pendientes…');
                if (_db && navigator.onLine && _cloudSyncPending) syncToCloud();
            } else {
                showNotification('📴 Sync desactivado — datos se guardarán localmente');
            }
        }

        // ── MÓDULO: CATÁLOGO (admin publica, usuarios reciben) ────────────
        async function publicarCatalogoFirestore() {
            if (!_db || !isAdmin()) return;
            try {
                await _db.collection('catalogo').doc('productos').set({
                    productos:        products,
                    publicadoPor:     currentUserUid,
                    publicadoEn:      Date.now(),
                    version:          Date.now()
                });
                await crearNotificacion('catalogo', 'Admin publicó catálogo actualizado (' + products.length + ' productos)', null, true);
                showNotification('✅ Catálogo publicado a todos los usuarios');
            } catch (e) {
                console.error('[Catalogo] Error publicando:', e);
                showNotification('❌ Error al publicar catálogo');
            }
        }

        /**
         * _vaciarCatalogoPublicado()
         * ──────────────────────────
         * Deja `catalogo/productos` vacío y con una versión más nueva, para
         * que todos los dispositivos adopten el vaciado por el mismo camino
         * por el que adoptan una publicación normal.
         *
         * No se borra el documento: si se borrara, los listeners verían
         * `snap.exists === false`, saldrían sin hacer nada, y cada aparato se
         * quedaría con su copia local de los 424 productos. Un documento
         * vacío con versión mayor sí es una instrucción que el listener
         * entiende.
         */
        async function _vaciarCatalogoPublicado() {
            if (!_db || !isAdmin()) return false;
            const version = Date.now();
            await _db.collection('catalogo').doc('productos').set({
                productos:    [],
                publicadoPor: currentUserUid,
                publicadoEn:  version,
                version:      version,
                vaciado:      true
            });
            try {
                localStorage.setItem('inventarioApp_catalogVersion', String(version));
            } catch(_) {}
            console.info('[Catalogo] Catálogo publicado vaciado (v' + version + ').');
            return true;
        }

        function subscribeCatalogoUsuario() {
            if (!_db || _unsubCatalogo) return;
            _unsubCatalogo = _db.collection('catalogo').doc('productos')
                .onSnapshot(function(snap) {
                    if (!snap.exists) return;
                    const data = snap.data();
                    if (!Array.isArray(data.productos)) return;
                    // Solo actualizar si la versión del servidor es más nueva
                    const serverVersion = data.version || 0;
                    const localVersion  = parseInt(localStorage.getItem('inventarioApp_catalogVersion') || '0', 10);
                    if (serverVersion <= localVersion) return;

                    // D — un catálogo vacío con versión más nueva es la señal
                    // de que el administrador lo vació. Antes se descartaba
                    // junto con los snapshots inválidos (`length === 0` salía
                    // sin hacer nada), así que el vaciado no llegaba a ningún
                    // dispositivo y cada uno seguía con sus 424 productos.
                    if (data.productos.length === 0 && data.vaciado) {
                        _marcarCatalogoPurgado(serverVersion);
                        products = [];
                        syncStockByAreaFromConteo();
                        localStorage.setItem('inventarioApp_catalogVersion', String(serverVersion));
                        saveToLocalStorage();
                        renderTab();
                        showNotification('🗑️ El administrador vació el catálogo');
                        return;
                    }
                    if (data.productos.length === 0) return;
                    // FIX-CONCURRENCIA: mismo merge que _applyCloudData — conserva
                    // cualquier producto local aún no sincronizado en vez de borrarlo.
                    products = _mergeArrayByIdPreferCloud(products, data.productos);
                    // FIX: recalcular stockByArea desde inventarioConteo local después de recibir
                    // el catálogo del admin. Sin esto, el stockByArea que venía del admin
                    // sobreescribe el conteo local aunque el usuario ya había contado ese producto.
                    syncStockByAreaFromConteo();
                    localStorage.setItem('inventarioApp_catalogVersion', String(serverVersion));
                    saveToLocalStorage();
                    renderTab();
                    showNotification('📦 Catálogo actualizado por el administrador');
                    console.info('[Catalogo] Catálogo recibido:', products.length, 'productos');
                }, function(err) { console.warn('[Catalogo] Error en listener:', err); });
        }

        // ETAPA 15: antes era un no-op ("el admin publica, no necesita
        // escuchar"). Pero esa suposición solo era válida con UN admin activo
        // a la vez — el ticket exige explícitamente que un SEGUNDO dispositivo
        // admin reciba en tiempo real los cambios de catálogo publicados por
        // OTRO admin, sin logout/reload. Mismo listener, misma variable
        // compartida _unsubCatalogo y el mismo merge (_mergeArrayByIdPreferCloud)
        // que ya usa subscribeCatalogoUsuario() — no se duplica el motor.
        function subscribeCatalogoAdmin() {
            if (!_db || _unsubCatalogo) return;
            _unsubCatalogo = _db.collection('catalogo').doc('productos')
                .onSnapshot(function(snap) {
                    if (!snap.exists) return;
                    const data = snap.data();
                    if (!Array.isArray(data.productos)) return;
                    const serverVersion = data.version || 0;
                    const localVersion  = parseInt(localStorage.getItem('inventarioApp_catalogVersion') || '0', 10);
                    if (serverVersion <= localVersion) return; // ya lo tenemos (incluye el caso "yo mismo lo publiqué")

                    // D — mismo caso que en el listener de usuario: el vaciado
                    // hecho por OTRO administrador tiene que llegar aquí, o
                    // este dispositivo devolvería los 424 productos a la nube
                    // en su siguiente sincronización.
                    if (data.productos.length === 0 && data.vaciado) {
                        _marcarCatalogoPurgado(serverVersion);
                        products = [];
                        syncStockByAreaFromConteo();
                        localStorage.setItem('inventarioApp_catalogVersion', String(serverVersion));
                        saveToLocalStorage();
                        renderTab();
                        showNotification('🗑️ Otro administrador vació el catálogo');
                        return;
                    }
                    if (data.productos.length === 0) return;
                    products = _mergeArrayByIdPreferCloud(products, data.productos);
                    syncStockByAreaFromConteo();
                    localStorage.setItem('inventarioApp_catalogVersion', String(serverVersion));
                    saveToLocalStorage();
                    renderTab();
                    showNotification('📦 Catálogo actualizado desde otro dispositivo administrador');
                    console.info('[Catalogo][Admin] Catálogo recibido de otra instancia admin:', products.length, 'productos');
                }, function(err) { console.warn('[Catalogo][Admin] Error en listener:', err); });
        }

        // ── MÓDULO: NOTIFICACIONES ─────────────────────────────────────────
        async function crearNotificacion(tipo, texto, destinatarioUid, broadcast) {
            if (!_db) return;
            try {
                const notif = {
                    tipo,
                    texto,
                    broadcast:        !!broadcast,
                    destinatarioUid:  destinatarioUid || null,
                    remitenteUid:     currentUserUid || null,
                    creadoEn:         Date.now(),
                    leido:            false
                };
                await _db.collection('notificaciones').add(notif);
            } catch (e) { console.warn('[Notif] Error creando notificación:', e); }
        }

        function subscribeNotificacionesUsuario() {
            if (!_db || !currentUserUid || _unsubNotifs) return;
            const uid = currentUserUid;
            _unsubNotifs = _db.collection('notificaciones')
                .where('leido', '==', false)
                .orderBy('creadoEn', 'desc')
                .limit(30)
                .onSnapshot(function(snap) {
                    _notificaciones = snap.docs
                        .map(function(d) { return Object.assign({ id: d.id }, d.data()); })
                        .filter(function(n) { return n.broadcast || n.destinatarioUid === uid; });
                    actualizarBadgeNotif();
                    if (activeTab === 'notificaciones') renderTab();
                }, function(err) { console.warn('[Notif] Error listener:', err); });
        }

        function actualizarBadgeNotif() {
            const badge = document.getElementById('sbNotifBadge');
            if (!badge) return;
            const unread = _notificaciones.filter(function(n) { return !n.leido; }).length;
            if (unread > 0) {
                badge.textContent = unread > 9 ? '9+' : String(unread);
                badge.style.display = '';
            } else {
                badge.style.display = 'none';
            }
        }

        async function marcarNotifLeida(id) {
            if (!_db || !id) return;
            try {
                await _db.collection('notificaciones').doc(id).update({ leido: true });
                _notificaciones = _notificaciones.map(function(n) { return n.id === id ? Object.assign({}, n, { leido: true }) : n; });
                actualizarBadgeNotif();
                renderTab();
            } catch (e) { console.warn('[Notif] Error marcando:', e); }
        }

        async function marcarTodasLeidas() {
            if (!_db) return;
            const batch = _db.batch();
            _notificaciones.filter(function(n) { return !n.leido; }).forEach(function(n) {
                batch.update(_db.collection('notificaciones').doc(n.id), { leido: true });
            });
            try {
                await batch.commit();
                _notificaciones = _notificaciones.map(function(n) { return Object.assign({}, n, { leido: true }); });
                actualizarBadgeNotif();
                renderTab();
            } catch (e) { console.warn('[Notif] Error marcando todas:', e); }
        }

        // ── MÓDULO: AJUSTES ────────────────────────────────────────────────
        function subscribeAjustesPendientes() {
            if (!_db || _unsubAjustes) return;
            _unsubAjustes = _db.collection('ajustes')
                .orderBy('creadoEn', 'desc')
                .limit(50)
                .onSnapshot(function(snap) {
                    _ajustes = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
                    const pending = _ajustes.filter(function(a) { return a.estado === 'pendiente'; }).length;
                    if (pending > 0) showNotification('🔔 ' + pending + ' ajuste(s) pendiente(s) de aprobar');
                    if (activeTab === 'ajustes') renderTab();
                }, function(err) { console.warn('[Ajustes] Error listener:', err); });
        }

        async function solicitarAjuste(productoId, productoNombre, motivo, cantidadSugerida) {
            if (!_db || !currentUserUid) { showNotification('⚙️ Firebase requerido'); return; }
            if (!motivo || !motivo.trim()) { showNotification('⚠️ Escribe el motivo del ajuste'); return; }
            try {
                await _db.collection('ajustes').add({
                    productoId,
                    productoNombre,
                    motivo:           motivo.trim(),
                    cantidadSugerida: cantidadSugerida || null,
                    solicitanteUid:   currentUserUid,
                    estado:           'pendiente',
                    creadoEn:         Date.now()
                });
                await crearNotificacion('ajuste', '📝 Ajuste solicitado: ' + productoNombre + ' — ' + motivo, null, false);
                showNotification('✅ Ajuste enviado al administrador');
            } catch (e) {
                console.error('[Ajustes] Error:', e);
                showNotification('❌ Error al enviar ajuste');
            }
        }

        async function resolverAjuste(ajusteId, accion) {
            if (!_db || !isAdmin()) return;
            try {
                await _db.collection('ajustes').doc(ajusteId).update({ estado: accion, resolvidoEn: Date.now(), resolvidoPor: currentUserUid });
                const aj = _ajustes.find(function(a) { return a.id === ajusteId; });
                if (aj) {
                    const txt = accion === 'aprobado' ? '✅ Ajuste aprobado: ' : '❌ Ajuste rechazado: ';
                    await crearNotificacion('ajuste', txt + aj.productoNombre, aj.solicitanteUid, false);
                }
                showNotification(accion === 'aprobado' ? '✅ Ajuste aprobado' : '❌ Ajuste rechazado');
            } catch (e) {
                console.error('[Ajustes] Error resolviendo:', e);
                showNotification('❌ Error al resolver ajuste');
            }
        }

        // ── MÓDULO: REPORTES ──────────────────────────────────────────────
        async function generarYPublicarReporte() {
            if (!isAdmin()) return;
            showNotification('⏳ Generando reporte global…');
            try {
                // Leer conteos de todos los dispositivos desde conteoAreas
                const AREAS = AREAS_CONTEO;

                // FIX #2 — Fase 1: recopilar conteos individuales por dispositivo
                // sin sumarlos directamente. Cada entrada = { enteras, abiertas } de un dispositivo.
                // { prodId: { area: [ { enteras, abiertas }, ... ] } }
                const conteoPorDispositivo = {};

                for (const area of AREAS) {
                    const snapDisp = await _db
                        .collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                        .collection('conteoAreas').doc(area)
                        .collection('dispositivos').get();

                    snapDisp.docs.forEach(function(doc) {
                        const data = doc.data();
                        Object.keys(data).forEach(function(key) {
                            if (key.startsWith('_')) return;
                            const entry = data[key];
                            if (!entry || typeof entry !== 'object') return;
                            if (!conteoPorDispositivo[key]) conteoPorDispositivo[key] = {};
                            if (!conteoPorDispositivo[key][area]) conteoPorDispositivo[key][area] = [];
                            conteoPorDispositivo[key][area].push({
                                enteras:  typeof entry.enteras === 'number' ? entry.enteras : 0,
                                abiertas: Array.isArray(entry.abiertas)     ? entry.abiertas : []
                            });
                        });
                    });
                }

                // FIX #2 — Fase 2: calcular PROMEDIO de enteras y colección de abiertas.
                // El conteo es "ciego": varios bartenders cuentan el mismo producto de forma
                // independiente. El consenso se obtiene promediando las enteras.
                // Las abiertas son botellas físicas reales (distintas por bartender), por lo
                // que se conservan todas y se promedian individualmente.
                const conteoGlobal = {}; // { prodId: { area: { enteras, abiertas, numConteos } } }

                Object.keys(conteoPorDispositivo).forEach(function(prodId) {
                    conteoGlobal[prodId] = {};
                    AREAS.forEach(function(area) {
                        const listaConteos = conteoPorDispositivo[prodId][area] || [];
                        if (listaConteos.length === 0) {
                            conteoGlobal[prodId][area] = { enteras: 0, abiertas: [], numConteos: 0 };
                            return;
                        }
                        // Promedio de botellas enteras (redondeado al entero más cercano)
                        const sumaEnteras = listaConteos.reduce(function(s, c) { return s + c.enteras; }, 0);
                        const promedioEnteras = Math.round(sumaEnteras / listaConteos.length);

                        // Abiertas: promediar por posición (botella abierta 1, 2, …)
                        // Si un bartender reporta 2 abiertas y otro 1, se promedian las posiciones comunes
                        const maxAbiertas = listaConteos.reduce(function(m, c) { return Math.max(m, c.abiertas.length); }, 0);
                        const promedioAbiertas = [];
                        for (let i = 0; i < maxAbiertas; i++) {
                            const vals = listaConteos
                                .map(function(c) { return c.abiertas[i]; })
                                .filter(function(v) { return typeof v === 'number' && v > 0; });
                            if (vals.length > 0) {
                                const avg = vals.reduce(function(s, v) { return s + v; }, 0) / vals.length;
                                promedioAbiertas.push(Math.round(avg * 100) / 100);
                            }
                        }

                        conteoGlobal[prodId][area] = {
                            enteras:    promedioEnteras,
                            abiertas:   promedioAbiertas,
                            numConteos: listaConteos.length
                        };
                    });
                });

                const productosReporte = products.map(function(p) {
                    const porArea = {};
                    let totalEnteras = 0;
                    let totalAbiertas = 0;
                    AREAS.forEach(function(area) {
                        const d = (conteoGlobal[p.id] && conteoGlobal[p.id][area]) || { enteras: 0, abiertas: [], numConteos: 0 };
                        porArea[area] = d;
                        totalEnteras += d.enteras || 0;
                        (d.abiertas || []).forEach(function(oz) { totalAbiertas += (oz || 0); });
                    });
                    // Conservar datos técnicos del catálogo para la conversión oz→puntos
                    return {
                        id: p.id, nombre: p.name, unidad: p.unit || '',
                        grupo: p.group || 'General',
                        capacidadMl: p.capacidadMl || null,
                        pesoBotellaLlenaOz: p.pesoBotellaLlenaOz || null,
                        // R1 (regla 14) — el modo de conteo viaja con el producto.
                        // Sin esto, al reconstruir el reporte la casilla llegaria
                        // undefined, se leeria como "producto anterior a R1" y un
                        // producto configurado SIN conteo en oz se reinterpretaria
                        // como si lo tuviera. null = no definido, y asi se conserva.
                        conteoOzHabilitado: (typeof p.conteoOzHabilitado === 'boolean') ? p.conteoOzHabilitado : null,
                        porArea, totalEnteras, totalAbiertas
                    };
                });

                const reporte = {
                    id:             'REP-' + Date.now(),
                    fecha:          new Date().toLocaleString('es-MX'),
                    fechaTs:        Date.now(),
                    generadoPor:    currentUserUid,
                    productos:      productosReporte,
                    totalProductos: products.length
                };

                await _db.collection('reportes').doc(reporte.id).set(reporte);
                await crearNotificacion('reporte', '📊 Reporte global publicado — disponible para descarga', null, true);
                showNotification('✅ Reporte publicado. Los usuarios pueden descargarlo.');
                renderTab();
            } catch (e) {
                console.error('[Reporte] Error:', e);
                showNotification('❌ Error al generar reporte');
            }
        }

        // FIX #6 — descargarReporte: usar la misma lógica de exportToExcel('AUDITORIA')
        // con hoja "Auditoría", columnas completas (CapacidadML, PesoBotellaOz, Estado),
        // subtotales por grupo y Gran Total.
        async function descargarReporte(reporteId) {
            if (!_db) return;
            try {
                const snap = await _db.collection('reportes').doc(reporteId).get();
                if (!snap.exists) { showNotification('⚠️ Reporte no encontrado'); return; }
                const rep = snap.data();
                if (typeof XLSX === 'undefined') { showNotification('⏳ Cargando exportador Excel…'); return; }

                // Reconstruir el objeto de conteo compatible con exportToExcel
                const conteoReporte = {};
                (rep.productos || []).forEach(function(p) {
                    conteoReporte[p.id] = {};
                    AREAS_CONTEO.forEach(function(area) {
                        const d = p.porArea && p.porArea[area] ? p.porArea[area] : { enteras: 0, abiertas: [] };
                        conteoReporte[p.id][area] = {
                            enteras:  d.enteras  || 0,
                            abiertas: d.abiertas || []
                        };
                    });
                });

                // Reconstruir lista de productos con datos técnicos
                const productosConDatos = (rep.productos || []).map(function(p) {
                    const catalog = products.find(function(cp) { return cp.id === p.id; }) || {};
                    return Object.assign({}, catalog, {
                        id: p.id, name: p.nombre, unit: p.unidad, group: p.grupo,
                        capacidadMl:       p.capacidadMl       || catalog.capacidadMl,
                        pesoBotellaLlenaOz: p.pesoBotellaLlenaOz || catalog.pesoBotellaLlenaOz,
                        // R1 — manda lo que quedo grabado en el reporte; el catalogo
                        // pudo cambiar despues y el reporte es una fotografia.
                        conteoOzHabilitado: (typeof p.conteoOzHabilitado === 'boolean')
                                            ? p.conteoOzHabilitado : catalog.conteoOzHabilitado
                    });
                });

                exportToExcelConDatos('AUDITORIA', conteoReporte, productosConDatos,
                    'reporte_auditoria_' + rep.fechaTs + '.xlsx');
                showNotification('✅ Reporte descargado con formato Auditoría');
            } catch (e) {
                console.error('[Reporte] Error descargando:', e);
                showNotification('❌ Error al descargar reporte');
            }
        }

        /**
         * eliminarReporte(reporteId)
         * Solo admin puede eliminar un reporte global publicado de Firestore.
         * Pide confirmación antes de borrar y recarga la lista al terminar.
         */
        async function eliminarReporte(reporteId) {
            if (!isAdmin()) {
                showNotification('⚠️ Solo el administrador puede eliminar reportes');
                return;
            }
            if (!_db) { showNotification('❌ Sin conexión a base de datos'); return; }
            showConfirm('¿Eliminar este reporte publicado?\n\nEsta acción no se puede deshacer. Los usuarios ya no podrán descargarlo.', async function() {
                try {
                    await _db.collection('reportes').doc(reporteId).delete();
                    showNotification('🗑️ Reporte eliminado correctamente');
                    // Refrescar la lista de reportes en pantalla
                    const el = document.getElementById('historiaReportesList');
                    if (el) {
                        el.innerHTML = '<span style="color:var(--txt-muted);font-size:.79rem;">Actualizando…</span>';
                        setTimeout(function() { renderTab(); }, 300);
                    }
                } catch (e) {
                    console.error('[Reporte] Error eliminando:', e);
                    showNotification('❌ Error al eliminar el reporte');
                }
            });
        }

        /**
         * exportToExcelConDatos(modo, conteoData, productsList, fileName)
         * FIX #6/#8 — Versión paramétrica de exportToExcel que acepta los datos
         * directamente en lugar de leer variables globales. Elimina el swap inseguro
         * de inventarioConteo = auditoriaConteo.
         * @param {string}  modo         'AUDITORIA' | 'INVENTARIO'
         * @param {object}  conteoData   Mapa { prodId: { area: { enteras, abiertas } } }
         * @param {Array}   productsList Lista de productos a exportar
         * @param {string}  [fileName]   Nombre del archivo de salida (opcional)
         */
function exportToExcelConDatos(modo, conteoData, productsList, fileName, areasOverride) {
    if (!Array.isArray(productsList) || productsList.length === 0) {
        showNotification('⚠️ No hay productos para exportar');
        return;
    }
    // FIX-1: Bloquear _applyCloudData durante el swap para que ningún
    // onSnapshot de Firestore lea los globals temporales.
    const _backupConteo = inventarioConteo;
    const _backupProducts = products;
    const _wasApplying = _applyingCloudData;
    _applyingCloudData = true;
    inventarioConteo = conteoData;
    products = productsList;
    try {
        exportToExcel(modo, fileName, areasOverride);
    } finally {
        inventarioConteo = _backupConteo;
        products = _backupProducts;
        _applyingCloudData = _wasApplying;
    }
}
        // ── RENDER: NOTIFICACIONES ─────────────────────────────────────────
        function renderNotificacionesTab() {
            let html = '<div class="max-w-2xl mx-auto">';
            html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">';
            html += '<h2 style="font-size:1rem;font-weight:600;color:var(--txt-primary)">🔔 Notificaciones</h2>';
            if (_notificaciones.some(function(n) { return !n.leido; })) {
                html += '<button onclick="marcarTodasLeidas()" style="font-size:.75rem;color:var(--accent);background:none;border:none;cursor:pointer;min-height:auto;font-family:inherit;">Marcar todas leídas</button>';
            }
            html += '</div>';
            if (_notificaciones.length === 0) {
                html += '<div class="adm-card" style="text-align:center;padding:32px;color:var(--txt-muted);">Sin notificaciones nuevas</div>';
            } else {
                html += '<div class="notif-wrap">';
                _notificaciones.forEach(function(n) {
                    const ts = n.creadoEn ? new Date(n.creadoEn).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '';
                    html += '<div class="notif-item' + (n.leido ? '' : ' unread') + '">';
                    html += '<span class="notif-dot' + (n.leido ? ' read' : '') + '"></span>';
                    html += '<div class="notif-body"><div class="notif-text">' + escapeHtml(n.texto) + '</div><div class="notif-time">' + ts + '</div></div>';
                    if (!n.leido) html += '<button onclick="marcarNotifLeida(\'' + n.id + '\')" style="font-size:.7rem;color:var(--accent);background:none;border:none;cursor:pointer;min-height:auto;white-space:nowrap;font-family:inherit;">Leído</button>';
                    html += '</div>';
                });
                html += '</div>';
            }
            html += '</div>';
            return html;
        }

        // ── RENDER: AJUSTES ────────────────────────────────────────────────
        function renderAjustesTab() {
            let html = '<div class="max-w-2xl mx-auto">';

            // R6: la administracion de areas de conteo vive aqui, y solo para
            // el admin. La funcion devuelve cadena vacia si no lo es.
            if (typeof renderAreasConteoAdmin === 'function') html += renderAreasConteoAdmin();

            // Formulario para solicitar ajuste (solo usuarios)
            if (!isAdmin()) {
                html += '<div class="adm-card" style="margin-bottom:16px;">';
                html += '<h3>📝 Solicitar ajuste de producto</h3>';
                html += '<select id="ajusteProductoSel" style="width:100%;margin-bottom:8px;padding:8px;border-radius:6px;border:1px solid var(--border-mid);background:var(--surface);color:var(--txt-primary);font-family:inherit;font-size:.82rem;">';
                html += '<option value="">— Selecciona un producto —</option>';
                products.forEach(function(p) { html += '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + '</option>'; });
                html += '</select>';
                html += '<textarea id="ajusteMotivoTxt" placeholder="Motivo del ajuste (ej. conteo real vs sistema)" rows="3" style="width:100%;margin-bottom:8px;padding:8px;border-radius:6px;border:1px solid var(--border-mid);background:var(--surface);color:var(--txt-primary);font-family:inherit;font-size:.82rem;resize:vertical;"></textarea>';
                html += '<input type="number" id="ajusteCantidadIn" placeholder="Cantidad sugerida (opcional)" min="0" step="0.01" style="width:100%;margin-bottom:10px;padding:8px;border-radius:6px;border:1px solid var(--border-mid);background:var(--surface);color:var(--txt-primary);font-family:inherit;font-size:.82rem;">';
                html += '<button class="adm-btn primary" onclick="(function(){var s=document.getElementById(\'ajusteProductoSel\');var m=document.getElementById(\'ajusteMotivoTxt\');var c=document.getElementById(\'ajusteCantidadIn\');if(!s.value){showNotification(\'⚠️ Selecciona un producto\');return;}var p=products.find(function(x){return x.id===s.value;});solicitarAjuste(s.value,p?p.name:s.value,m.value,parseFloat(c.value)||null);m.value=\'\';c.value=\'\';s.value=\'\';})()">';
                html += '<i class="fa-solid fa-paper-plane"></i> Enviar solicitud</button>';
                html += '</div>';
            }

            html += '<div class="adm-card" style="padding:14px 16px;">';
            html += '<h3 style="font-size:.82rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--txt-secondary);margin-bottom:12px;display:flex;align-items:center;gap:6px;">';
            html += isAdmin() ? '🔧 Ajustes pendientes' : '🔧 Mis solicitudes';
            html += '</h3>';

            const lista = isAdmin() ? _ajustes : _ajustes.filter(function(a) { return a.solicitanteUid === currentUserUid; });

            if (lista.length === 0) {
                html += '<div class="adm-card" style="text-align:center;padding:32px 24px;">'
                      + '<p style="font-size:.82rem;color:var(--txt-muted);">Sin ajustes pendientes</p></div>';
            } else {
                lista.forEach(function(a) {
                    const ts = a.creadoEn ? new Date(a.creadoEn).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '';
                    html += '<div class="ajuste-card ' + (a.estado || 'pendiente') + '">';
                    html += '<div class="ajuste-meta">' + escapeHtml(a.productoNombre || a.productoId) + ' · ' + ts + ' · <b>' + (a.estado || 'pendiente') + '</b></div>';
                    html += '<div class="ajuste-desc">' + escapeHtml(a.motivo || '') + (a.cantidadSugerida != null ? ' (Sugerido: ' + a.cantidadSugerida + ')' : '') + '</div>';
                    if (isAdmin() && a.estado === 'pendiente') {
                        html += '<div class="ajuste-btns"><button class="ajuste-btn ok" onclick="resolverAjuste(\'' + a.id + '\',\'aprobado\')">✅ Aprobar</button><button class="ajuste-btn nok" onclick="resolverAjuste(\'' + a.id + '\',\'rechazado\')">❌ Rechazar</button></div>';
                    }
                    html += '</div>';
                });
            }
            html += '</div></div>';
            return html;
        }

        // ── RENDER: PANEL ADMIN ────────────────────────────────────────────
        // ══════════════════════════════════════════════════════════════════════
        //  FASE 2A — PANTALLA "USUARIOS Y PERMISOS"
        //  ────────────────────────────────────────────────────────────────────
        //  Primera ruta de ESCRITURA que existe para usuarios/{uid}.role,
        //  .permissionOverrides, .status y .areasAsignadas. Hasta ahora el
        //  motor de permisos leía esos campos y las reglas los protegían, pero
        //  ninguna parte de la aplicación podía modificarlos: la única vía era
        //  editar el documento a mano en la consola de Firebase.
        //
        //  Semántica de cada casilla (el ciclo importa): marcar y desmarcar dos
        //  veces devuelve el permiso a lo que dicta el rol, nunca deja un
        //  override residual.
        //
        //    heredado  + desmarcar → override 'deny'   (revocado)
        //    revocado  + marcar    → se BORRA el override (vuelve a heredado)
        //    ninguno   + marcar    → override 'allow'  (asignado)
        //    asignado  + desmarcar → se BORRA el override (vuelve a ninguno)
        //
        //  Nada de lo que se ve aquí decide autorización: la pantalla lee el
        //  estado con permisosEfectivos(), que aplica la misma precedencia que
        //  hasPermission(). Una segunda implementación de la regla sería una
        //  segunda fuente de verdad.
        // ══════════════════════════════════════════════════════════════════════
        let _permUsuarios  = null;   // null = todavía no cargados
        let _permCargando  = false;
        let _permError     = null;
        let _permUidSel    = null;
        let _permEdicion   = null;   // { roleId, overrides:{}, areas:null|[], status }

        function abrirUsuariosPermisos() {
            if (!hasPermission('permissions.read')) {
                showNotification('⚠️ No tienes permiso para ver la administración de permisos');
                return;
            }
            _adminSubvista = 'permisos';
            _permUidSel  = null;
            _permEdicion = null;
            renderTab();
            _cargarUsuariosParaPermisos();
        }
        window.abrirUsuariosPermisos = abrirUsuariosPermisos;

        function cerrarUsuariosPermisos() {
            _adminSubvista = 'panel';
            _permUidSel  = null;
            _permEdicion = null;
            renderTab();
        }
        window.cerrarUsuariosPermisos = cerrarUsuariosPermisos;

        async function _cargarUsuariosParaPermisos(forzar) {
            if (_permCargando) return;
            if (_permUsuarios && !forzar) return;
            if (!_db) { _permError = 'Sin conexión a Firestore'; renderTab(); return; }
            _permCargando = true;
            _permError    = null;
            try {
                const snap = await _db.collection('usuarios').get();
                const lista = [];
                snap.forEach(function(d) {
                    const data = d.data() || {};
                    lista.push(Object.assign({ uid: d.id }, data));
                });
                lista.sort(function(a, b) {
                    return String(a.email || a.uid).localeCompare(String(b.email || b.uid));
                });
                _permUsuarios = lista;
            } catch (e) {
                console.warn('[Permisos] No se pudo listar usuarios:', e);
                _permError = 'No se pudo leer la lista de usuarios. Revisa la conexión y tus permisos.';
            } finally {
                _permCargando = false;
                if (_adminSubvista === 'permisos') renderTab();
            }
        }
        window._cargarUsuariosParaPermisos = _cargarUsuariosParaPermisos;

        function _permUsuarioPorUid(uid) {
            if (!_permUsuarios) return null;
            for (let i = 0; i < _permUsuarios.length; i++) {
                if (_permUsuarios[i].uid === uid) return _permUsuarios[i];
            }
            return null;
        }

        // Documento "efectivo" = el guardado + los cambios todavía sin guardar.
        // Todo lo que la pantalla muestra se deriva de aquí, para que el
        // resumen de permisos efectivos refleje la edición en curso.
        function _permDocEditado() {
            const base = _permUsuarioPorUid(_permUidSel);
            if (!base) return null;
            if (!_permEdicion) return base;
            return Object.assign({}, base, {
                role:               _permEdicion.roleId,
                permissionOverrides: _permEdicion.overrides,
                status:             _permEdicion.status,
                areasAsignadas:     _permEdicion.areas === null ? undefined : _permEdicion.areas
            });
        }

        function permSeleccionarUsuario(uid) {
            const u = _permUsuarioPorUid(uid);
            if (!u) return;
            _permUidSel  = uid;
            _permEdicion = {
                roleId:    _roleCanonico(u.role),
                overrides: Object.assign({}, _sanitizarOverrides(u.permissionOverrides)),
                areas:     areasDeUsuario(u),            // null = todas
                status:    u.status || 'activo'
            };
            renderTab();
        }
        window.permSeleccionarUsuario = permSeleccionarUsuario;

        function permCambiarRol(roleId) {
            if (!_permEdicion) return;
            _permEdicion.roleId = roleId;
            renderTab();
        }
        window.permCambiarRol = permCambiarRol;

        function permToggleEstado() {
            if (!_permEdicion) return;
            _permEdicion.status = (_permEdicion.status === 'inactivo') ? 'activo' : 'inactivo';
            renderTab();
        }
        window.permToggleEstado = permToggleEstado;

        function permToggleArea(area) {
            if (!_permEdicion) return;
            if (_permEdicion.areas === null) {
                // Pasa de "todas" (campo ausente) a una lista explícita que
                // contiene todo MENOS la que se acaba de desmarcar.
                _permEdicion.areas = AREAS_CONTEO.filter(function(a) { return a !== area; });
            } else {
                const i = _permEdicion.areas.indexOf(area);
                if (i === -1) _permEdicion.areas.push(area);
                else          _permEdicion.areas.splice(i, 1);
                // Si vuelven a quedar TODAS marcadas, se restaura la ausencia
                // del campo: es más limpio que guardar la lista completa, y
                // significa exactamente lo mismo (D3).
                if (_permEdicion.areas.length === AREAS_CONTEO.length) _permEdicion.areas = null;
            }
            renderTab();
        }
        window.permToggleArea = permToggleArea;

        function permToggle(permiso) {
            if (!_permEdicion) return;
            if (!PERMISOS_CATALOGO_SET.has(permiso)) return;
            const doc    = _permDocEditado();
            const efec   = permisosEfectivos(doc);
            const estado = efec.estados[permiso];
            if (estado === 'comodin') return; // ADMIN: autoridad absoluta, no se toca
            if (estado === 'heredado')      _permEdicion.overrides[permiso] = 'deny';
            else if (estado === 'revocado') delete _permEdicion.overrides[permiso];
            else if (estado === 'ninguno')  _permEdicion.overrides[permiso] = 'allow';
            else if (estado === 'asignado') delete _permEdicion.overrides[permiso];
            renderTab();
        }
        window.permToggle = permToggle;

        // ── Protección de auto-bloqueo (principios 8 y 9 del propietario) ───
        // Dos garantías distintas:
        //   1. Un administrador no puede quitarse a sí mismo la autoridad.
        //   2. El sistema nunca puede quedarse sin ningún administrador.
        // La segunda se comprueba contra la lista real de usuarios, no contra
        // una suposición.
        function _permValidarNoAutobloqueo(uid, roleIdNuevo, statusNuevo) {
            const eraAdmin = _roleCanonico((_permUsuarioPorUid(uid) || {}).role) === 'ADMIN';
            const seraAdmin = roleIdNuevo === 'ADMIN' && statusNuevo !== 'inactivo';
            if (eraAdmin && !seraAdmin) {
                if (uid === currentUserUid) {
                    return 'No puedes quitarte a ti mismo la autoridad de administrador. ' +
                           'Pídele a otro administrador que lo haga.';
                }
                const otrosAdmins = (_permUsuarios || []).filter(function(u) {
                    return u.uid !== uid &&
                           _roleCanonico(u.role) === 'ADMIN' &&
                           (u.status || 'activo') !== 'inactivo';
                });
                if (otrosAdmins.length === 0) {
                    return 'Es el único administrador activo del sistema. ' +
                           'Nombra antes a otro administrador.';
                }
            }
            return null;
        }

        // ── Auditoría del cambio ────────────────────────────────────────────
        function registrarCambioPermisos(datos) {
            return _registrarEnSyncQueue({
                tipo:    'permisos',
                detalle: datos.usuarioAfectado + ': ' + datos.rolAnterior + ' → ' + datos.rolNuevo,
                estadoPermiso:       datos.estadoPermiso || 'APLICADO',
                usuarioAfectado:     datos.usuarioAfectado,
                emailAfectado:       datos.emailAfectado || null,
                rolAnterior:         datos.rolAnterior,
                rolNuevo:            datos.rolNuevo,
                permisosAnteriores:  datos.permisosAnteriores,
                permisosNuevos:      datos.permisosNuevos,
                overridesAnteriores: datos.overridesAnteriores,
                overridesNuevos:     datos.overridesNuevos,
                areasAnteriores:     datos.areasAnteriores,
                areasNuevas:         datos.areasNuevas,
                statusAnterior:      datos.statusAnterior,
                statusNuevo:         datos.statusNuevo,
                motivo:              datos.motivo || null
            });
        }
        window.registrarCambioPermisos = registrarCambioPermisos;

        async function permGuardar() {
            if (!_permEdicion || !_permUidSel) return;
            if (!hasPermission('permissions.update')) {
                showNotification('⚠️ No tienes permiso para modificar permisos');
                return;
            }
            if (!_db)              { showNotification('📴 Sin conexión a Firestore'); return; }
            if (!navigator.onLine) { showNotification('📴 Sin conexión — intenta de nuevo con internet'); return; }

            const original = _permUsuarioPorUid(_permUidSel);
            if (!original) return;

            const bloqueo = _permValidarNoAutobloqueo(_permUidSel, _permEdicion.roleId, _permEdicion.status);
            if (bloqueo) { showNotification('🛑 ' + bloqueo); return; }

            const efecAntes = permisosEfectivos(original);
            const efecAhora = permisosEfectivos(_permDocEditado());

            // ── Resumen del cambio, para que el administrador confirme sobre
            //    hechos y no sobre una sensación ────────────────────────────
            const lineas = [];
            if (efecAntes.roleId !== efecAhora.roleId) {
                lineas.push('• Rol: ' + efecAntes.roleId + ' → ' + efecAhora.roleId);
            }
            if ((original.status || 'activo') !== _permEdicion.status) {
                lineas.push('• Estado de la cuenta: ' + (original.status || 'activo') + ' → ' + _permEdicion.status);
            }
            const areasAntes = areasDeUsuario(original);
            const areasDesp  = _permEdicion.areas;
            const txtAreas = function(a) {
                return a === null ? 'todas las áreas'
                                  : (a.length ? a.map(function(x) { return areasAuditoria[x] || x; }).join(', ')
                                              : 'ninguna área');
            };
            if (JSON.stringify(areasAntes) !== JSON.stringify(areasDesp)) {
                lineas.push('• Áreas: ' + txtAreas(areasAntes) + ' → ' + txtAreas(areasDesp));
            }
            let sensibles = 0;
            PERMISOS_CATALOGO.forEach(function(p) {
                const a = efecAntes.estados[p], b = efecAhora.estados[p];
                if (a === b) return;
                const teniaA = (a === 'comodin' || a === 'asignado' || a === 'heredado');
                const teniaB = (b === 'comodin' || b === 'asignado' || b === 'heredado');
                if (teniaA === teniaB) return; // cambió el origen, no la capacidad real
                const meta = permisoMeta(p);
                if (meta.sensible) sensibles++;
                lineas.push('• ' + (teniaB ? 'CONCEDE' : 'RETIRA') + ': ' + meta.nombre +
                            (meta.sensible ? '  ⚠️ sensible' : ''));
            });

            if (lineas.length === 0) { showNotification('Sin cambios que guardar'); return; }

            const quien = original.email || original.displayName || _permUidSel.slice(0, 8);
            showConfirm(
                '🔐 Confirmar cambios de permisos\n\n' +
                'Usuario: ' + quien + '\n\n' +
                lineas.join('\n') + '\n\n' +
                (sensibles > 0
                    ? '⚠️ ' + sensibles + ' de estos permisos son sensibles.\n\n'
                    : '') +
                'El cambio quedará registrado en el historial permanente y se aplicará ' +
                'al dispositivo del usuario en cuanto tenga conexión.\n\n¿Continuar?',
                async function() {
                    try {
                        const payload = {
                            role:                _permEdicion.roleId,
                            permissionOverrides: _permEdicion.overrides,
                            status:              _permEdicion.status,
                            actualizadoEn:       Date.now(),
                            actualizadoPor:      currentUserUid
                        };
                        // D3: "todas las áreas" se representa por AUSENCIA del
                        // campo, así que se elimina en vez de escribir la lista
                        // completa. Son estados equivalentes y este es el
                        // canónico.
                        if (_permEdicion.areas === null) {
                            payload.areasAsignadas = firebase.firestore.FieldValue.delete();
                        } else {
                            payload.areasAsignadas = _permEdicion.areas.slice();
                        }

                        await _db.collection('usuarios').doc(_permUidSel).update(payload);

                        registrarCambioPermisos({
                            usuarioAfectado:     _permUidSel,
                            emailAfectado:       original.email || null,
                            rolAnterior:         efecAntes.roleId,
                            rolNuevo:            efecAhora.roleId,
                            permisosAnteriores:  efecAntes.concedidos,
                            permisosNuevos:      efecAhora.concedidos,
                            overridesAnteriores: efecAntes.overrides,
                            overridesNuevos:     efecAhora.overrides,
                            areasAnteriores:     areasAntes,
                            areasNuevas:         areasDesp,
                            statusAnterior:      original.status || 'activo',
                            statusNuevo:         _permEdicion.status,
                            estadoPermiso:       'APLICADO'
                        });

                        showNotification('✅ Permisos actualizados para ' + quien);
                        await _cargarUsuariosParaPermisos(true);
                        permSeleccionarUsuario(_permUidSel);
                    } catch (err) {
                        console.error('[Permisos] Error guardando:', err);
                        registrarCambioPermisos({
                            usuarioAfectado: _permUidSel,
                            emailAfectado:   original.email || null,
                            rolAnterior:     efecAntes.roleId,
                            rolNuevo:        _permEdicion.roleId,
                            permisosAnteriores: efecAntes.concedidos,
                            permisosNuevos:     efecAhora.concedidos,
                            estadoPermiso:   'RECHAZADO',
                            motivo:          String(err && err.code || err)
                        });
                        showNotification('❌ No se pudieron guardar los permisos — ' +
                                         (err && err.code === 'permission-denied'
                                            ? 'el servidor rechazó el cambio'
                                            : 'revisa la conexión'));
                    }
                }
            );
        }
        window.permGuardar = permGuardar;

        // ══════════════════════════════════════════════════════════════════════
        //  sincronizarRolesSistema() — acción administrativa EXPLÍCITA.
        //  _asegurarRolesSistemaEnFirestore() solo crea los roles que faltan;
        //  nunca actualiza uno existente, y con razón: sobrescribir en
        //  silencio la configuración de producción sería una modificación de
        //  datos sin autorización. Pero eso significa que un despliegue que ya
        //  tenga roles/BARTENDER sembrado con los valores antiguos no vería
        //  nunca los valores por defecto nuevos. Este botón cierra esa brecha
        //  mostrando primero, exactamente, qué cambiaría.
        // ══════════════════════════════════════════════════════════════════════
        async function sincronizarRolesSistema() {
            if (!hasPermission('roles.update')) {
                showNotification('⚠️ No tienes permiso para modificar roles');
                return;
            }
            if (!_db || !navigator.onLine) { showNotification('📴 Sin conexión'); return; }
            try {
                const cambios = [];
                for (const roleId of Object.keys(ROLES_SISTEMA_DEFECTO)) {
                    const snap = await _db.collection('roles').doc(roleId).get();
                    const actual = (snap.exists && Array.isArray(snap.data().permissions))
                                   ? snap.data().permissions : null;
                    const nuevo  = ROLES_SISTEMA_DEFECTO[roleId].permissions;
                    if (!actual) { cambios.push({ roleId: roleId, de: '(no existe)', a: nuevo, nuevo: nuevo }); continue; }
                    if (actual.slice().sort().join(',') !== nuevo.slice().sort().join(',')) {
                        cambios.push({ roleId: roleId, de: actual, a: nuevo, nuevo: nuevo });
                    }
                }
                if (cambios.length === 0) { showNotification('✅ Los roles ya coinciden con los valores por defecto'); return; }

                const detalle = cambios.map(function(c) {
                    const de = Array.isArray(c.de) ? (c.de.length + ' permiso(s)') : c.de;
                    return '• ' + c.roleId + ': ' + de + ' → ' + c.a.length + ' permiso(s)';
                }).join('\n');

                showConfirm(
                    '🔁 Actualizar roles de sistema\n\n' +
                    'Se reemplazarán los permisos heredados de estos roles por los valores ' +
                    'por defecto de esta versión:\n\n' + detalle + '\n\n' +
                    'Los permisos individuales de cada usuario (allow/deny) NO se tocan.\n\n¿Continuar?',
                    async function() {
                        try {
                            const batch = _db.batch();
                            cambios.forEach(function(c) {
                                batch.set(_db.collection('roles').doc(c.roleId), {
                                    roleId:        c.roleId,
                                    nombre:        ROLES_SISTEMA_DEFECTO[c.roleId].nombre,
                                    permissions:   c.nuevo,
                                    esSistema:     true,
                                    actualizadoEn: Date.now()
                                }, { merge: true });
                            });
                            await batch.commit();
                            _rolesCache = {};
                            cambios.forEach(function(c) {
                                registrarCambioPermisos({
                                    usuarioAfectado:    'rol:' + c.roleId,
                                    rolAnterior:        c.roleId,
                                    rolNuevo:           c.roleId,
                                    permisosAnteriores: Array.isArray(c.de) ? c.de : [],
                                    permisosNuevos:     c.nuevo,
                                    estadoPermiso:      'APLICADO',
                                    motivo:             'Sincronización de roles de sistema'
                                });
                            });
                            showNotification('✅ Roles de sistema actualizados');
                            renderTab();
                        } catch (e) {
                            console.error('[Permisos] Error sincronizando roles:', e);
                            showNotification('❌ No se pudieron actualizar los roles');
                        }
                    }
                );
            } catch (e) {
                console.warn('[Permisos] Error leyendo roles:', e);
                showNotification('❌ No se pudieron leer los roles');
            }
        }
        window.sincronizarRolesSistema = sincronizarRolesSistema;

        // ── Render de la pantalla ──────────────────────────────────────────
        function _permBadgeEstado(estado) {
            const mapa = {
                comodin:  ['Todos', 'var(--green)'],
                heredado: ['Del rol', 'var(--txt-muted)'],
                asignado: ['Asignado', 'var(--blue)'],
                revocado: ['Revocado', 'var(--red)'],
                ninguno:  ['—', 'var(--txt-muted)']
            };
            const m = mapa[estado] || mapa.ninguno;
            return '<span style="font-size:.65rem;font-weight:600;color:' + m[1] + ';">' + m[0] + '</span>';
        }

        function renderUsuariosPermisosTab() {
            if (!hasPermission('permissions.read')) {
                return '<p style="color:var(--txt-muted)">Acceso restringido</p>';
            }
            let html = '<div class="max-w-2xl mx-auto">';
            html += '<div class="adm-card">';
            html += '<button class="adm-btn" style="margin-bottom:10px" onclick="cerrarUsuariosPermisos()">'
                  + '<i class="fa-solid fa-arrow-left"></i> Volver al panel</button>';
            html += '<h3>🔐 Usuarios y permisos</h3>';

            if (_permCargando && !_permUsuarios) {
                html += '<p style="color:var(--txt-muted);font-size:.85rem">Cargando usuarios…</p></div></div>';
                return html;
            }
            if (_permError) {
                html += '<p style="color:var(--red);font-size:.85rem">' + escapeHtml(_permError) + '</p>';
                html += '<button class="adm-btn" onclick="_cargarUsuariosParaPermisos(true)">Reintentar</button>';
                html += '</div></div>';
                return html;
            }

            // ── Selector de usuario ─────────────────────────────────────────
            html += '<label style="display:block;font-size:.75rem;color:var(--txt-muted);margin-bottom:4px">Usuario</label>';
            html += '<select id="permUserSel" onchange="permSeleccionarUsuario(this.value)" '
                  + 'style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border);'
                  + 'background:var(--bg-card);color:var(--txt);margin-bottom:10px">';
            html += '<option value="">— Selecciona un usuario —</option>';
            (_permUsuarios || []).forEach(function(u) {
                const etiqueta = (u.email || u.displayName || u.uid) +
                                 '  ·  ' + _roleCanonico(u.role) +
                                 ((u.status === 'inactivo') ? '  ·  INACTIVO' : '');
                html += '<option value="' + escapeHtml(u.uid) + '"' +
                        (u.uid === _permUidSel ? ' selected' : '') + '>' +
                        escapeHtml(etiqueta) + '</option>';
            });
            html += '</select>';
            html += '<button class="adm-btn" onclick="_cargarUsuariosParaPermisos(true)">'
                  + '<i class="fa-solid fa-arrows-rotate"></i> Recargar lista</button>';
            html += '</div>';

            if (!_permUidSel || !_permEdicion) {
                html += '<div class="adm-card"><p style="color:var(--txt-muted);font-size:.85rem">'
                      + 'Selecciona un usuario para ver y modificar sus permisos.</p></div></div>';
                return html;
            }

            const doc  = _permDocEditado();
            const efec = permisosEfectivos(doc);
            const base = _permUsuarioPorUid(_permUidSel);

            // ── Rol, estado y áreas ─────────────────────────────────────────
            html += '<div class="adm-card">';
            html += '<h3>👤 ' + escapeHtml(base.email || base.displayName || base.uid) + '</h3>';
            html += '<label style="display:block;font-size:.75rem;color:var(--txt-muted);margin:6px 0 4px">Rol base</label>';
            html += '<select onchange="permCambiarRol(this.value)" '
                  + 'style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border);'
                  + 'background:var(--bg-card);color:var(--txt)">';
            Object.keys(ROLES_SISTEMA_DEFECTO).forEach(function(rid) {
                html += '<option value="' + rid + '"' + (rid === _permEdicion.roleId ? ' selected' : '') + '>'
                      + escapeHtml(ROLES_SISTEMA_DEFECTO[rid].nombre) + ' (' + rid + ')</option>';
            });
            html += '</select>';

            html += '<div class="adm-stat" style="margin-top:8px"><span>Estado de la cuenta</span>'
                  + '<b style="color:' + (_permEdicion.status === 'inactivo' ? 'var(--red)' : 'var(--green)') + '">'
                  + (_permEdicion.status === 'inactivo' ? 'Inactiva' : 'Activa') + '</b></div>';
            html += '<button class="adm-btn ' + (_permEdicion.status === 'inactivo' ? 'success' : 'warn') + '" '
                  + 'onclick="permToggleEstado()">'
                  + (_permEdicion.status === 'inactivo' ? 'Reactivar cuenta' : 'Desactivar cuenta') + '</button>';

            html += '<h3 style="margin-top:14px">📍 Áreas autorizadas</h3>';
            html += '<p style="font-size:.72rem;color:var(--txt-muted);margin:0 0 6px">'
                  + (_permEdicion.areas === null
                      ? 'Sin restricción: puede contar en todas las áreas.'
                      : 'Restringido a las áreas marcadas.') + '</p>';
            AREAS_CONTEO.forEach(function(a) {
                const marcada = (_permEdicion.areas === null) || (_permEdicion.areas.indexOf(a) !== -1);
                html += '<label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:.85rem;cursor:pointer">'
                      + '<input type="checkbox" ' + (marcada ? 'checked' : '') + ' '
                      + 'onchange="permToggleArea(\'' + escapeHtml(a) + '\')"> '
                      + escapeHtml(areasAuditoria[a] || a) + '</label>';
            });
            html += '</div>';

            // ── Permisos efectivos, agrupados ───────────────────────────────
            html += '<div class="adm-card">';
            html += '<h3>✅ Permisos</h3>';
            if (efec.comodin) {
                html += '<p style="font-size:.78rem;color:var(--green);margin:0 0 8px">'
                      + 'Este usuario es administrador: tiene autoridad absoluta sobre todos los permisos '
                      + 'y ninguna casilla individual puede degradarlo. Para limitarlo, cámbiale el rol.</p>';
            }
            html += '<div class="adm-stat"><span>Permisos concedidos</span><b>'
                  + (efec.comodin ? 'Todos' : efec.concedidos.length) + '</b></div>';

            const porGrupo = {};
            PERMISOS_CATALOGO.forEach(function(p) {
                const g = permisoMeta(p).grupo;
                (porGrupo[g] = porGrupo[g] || []).push(p);
            });
            const grupos = PERMISOS_GRUPOS_ORDEN.filter(function(g) { return porGrupo[g]; })
                .concat(Object.keys(porGrupo).filter(function(g) { return PERMISOS_GRUPOS_ORDEN.indexOf(g) === -1; }));

            grupos.forEach(function(g) {
                html += '<h4 style="margin:12px 0 4px;font-size:.8rem;color:var(--txt-muted);'
                      + 'text-transform:uppercase;letter-spacing:.04em">' + escapeHtml(g) + '</h4>';
                porGrupo[g].forEach(function(p) {
                    const meta   = permisoMeta(p);
                    const estado = efec.estados[p];
                    const tiene  = (estado === 'comodin' || estado === 'asignado' || estado === 'heredado');
                    // Motivos por los que la casilla no se puede tocar. Se
                    // muestran explícitamente: una casilla inerte sin
                    // explicación es peor que no tenerla.
                    let bloqueo = null;
                    if (estado === 'comodin')                          bloqueo = 'Administrador: autoridad absoluta';
                    else if (!meta.efectivo)                           bloqueo = 'Sin efecto todavía en esta versión';
                    else if (!meta.delegable && efec.roleId !== 'ADMIN') bloqueo = 'No delegable fuera de administración';

                    html += '<label style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;'
                          + 'border-bottom:1px solid var(--border);' + (bloqueo ? 'opacity:.55;' : 'cursor:pointer;') + '">';
                    html += '<input type="checkbox" style="margin-top:3px" ' + (tiene ? 'checked' : '')
                          + (bloqueo ? ' disabled' : '')
                          + ' onchange="permToggle(\'' + escapeHtml(p) + '\')">';
                    html += '<span style="flex:1;min-width:0">';
                    html += '<span style="font-size:.85rem;font-weight:600">' + escapeHtml(meta.nombre) + '</span> '
                          + _permBadgeEstado(estado);
                    if (meta.sensible) html += ' <span style="font-size:.62rem;color:var(--amber)">⚠️ sensible</span>';
                    html += '<br><span style="font-size:.72rem;color:var(--txt-muted)">'
                          + escapeHtml(meta.descripcion) + '</span>';
                    if (bloqueo) {
                        html += '<br><span style="font-size:.68rem;color:var(--amber)">🔒 ' + escapeHtml(bloqueo) + '</span>';
                    }
                    html += '<br><code style="font-size:.62rem;color:var(--txt-muted);opacity:.7">' + escapeHtml(p) + '</code>';
                    html += '</span></label>';
                });
            });
            html += '</div>';

            html += '<div class="adm-card">';
            html += '<button class="adm-btn success" onclick="permGuardar()">'
                  + '<i class="fa-solid fa-floppy-disk"></i> Guardar cambios</button>';
            html += '<button class="adm-btn" onclick="permSeleccionarUsuario(\'' + escapeHtml(_permUidSel) + '\')">'
                  + '<i class="fa-solid fa-rotate-left"></i> Descartar cambios</button>';
            html += '</div>';

            html += '</div>';
            return html;
        }
        window.renderUsuariosPermisosTab = renderUsuariosPermisosTab;

        // Subvista activa dentro de la pestaña Admin: 'panel' | 'permisos'
        let _adminSubvista = 'panel';

        function renderAdminTab() {
            if (!isAdmin()) return '<p style="color:var(--txt-muted)">Acceso restringido</p>';
            if (_adminSubvista === 'permisos') return renderUsuariosPermisosTab();
            const pendAjustes = _ajustes.filter(function(a) { return a.estado === 'pendiente'; }).length;
            let html = '<div class="max-w-2xl mx-auto">';
            html += '<div class="adm-card">';
            html += '<h3>👑 Panel de Administración</h3>';
            html += '<div class="adm-stat"><span>Productos en catálogo</span><b>' + products.length + '</b></div>';
            html += '<div class="adm-stat"><span>Ajustes pendientes</span><b style="color:var(--amber)">' + pendAjustes + '</b></div>';
            html += '<div class="adm-stat"><span>Conteos multi-dispositivo</span><b>' + (Object.keys(auditoriaConteo).length) + ' productos</b></div>';
            html += '</div>';

            // ETAPA 14.1: panel MÍNIMO de Roles y Permisos — solo lo
            // necesario para comprobar que el sistema funciona; la UI
            // completa de Configuración (Usuarios/Roles/Sucursales/
            // Almacenes) es una etapa posterior, fuera de este alcance.
            html += '<div class="adm-card">';
            html += '<h3>🔐 Roles y Permisos</h3>';
            html += '<div class="adm-stat"><span>Tu rol resuelto</span><b>' + escapeHtml(_authzState.roleId || '—') + '</b></div>';
            html += '<div class="adm-stat"><span>Rol legacy en Firestore</span><b>' + escapeHtml(_authzState.legacyRole || '—') + '</b></div>';
            html += '<div class="adm-stat"><span>Permisos activos</span><b>' + (_authzState.permissions ? (_authzState.permissions.has('*') ? 'Todos (*)' : _authzState.permissions.size) : 0) + '</b></div>';
            html += '<button class="adm-btn primary" onclick="abrirUsuariosPermisos()"><i class="fa-solid fa-user-shield"></i> Usuarios y permisos</button>';
            html += '<button class="adm-btn warn" onclick="migrarRolesExistentes()"><i class="fa-solid fa-arrows-rotate"></i> Migrar roles legacy a nuevo modelo</button>';
            html += '<button class="adm-btn" onclick="sincronizarRolesSistema()"><i class="fa-solid fa-code-branch"></i> Actualizar roles de sistema</button>';
            html += '</div>';

            // Acciones admin
            html += '<div class="adm-card">';
            html += '<h3>⚡ Acciones</h3>';
            html += '<button class="adm-btn success" onclick="publicarCatalogoFirestore()"><i class="fa-solid fa-cloud-arrow-up"></i> Publicar catálogo a usuarios</button>';
            html += '<button class="adm-btn primary" onclick="generarYPublicarReporte()"><i class="fa-solid fa-file-chart-column"></i> Generar y publicar reporte global</button>';
            html += '<button class="adm-btn warn" onclick="switchTab(\'ajustes\')"><i class="fa-solid fa-list-check"></i> Revisar ajustes (' + pendAjustes + ' pendientes)</button>';
            html += '</div>';

            // Reportes publicados
            html += '<div class="adm-card">';
            html += '<h3>📊 Reportes publicados</h3>';
            html += '<div id="adminReportesList"><p style="color:var(--txt-muted);font-size:.8rem;">Cargando reportes…</p></div>';
            html += '</div>';
            html += '</div>';

            // Cargar reportes de Firestore
            setTimeout(function() {
                if (!_db) return;
                _db.collection('reportes').orderBy('fechaTs', 'desc').limit(10).get()
                    .then(function(snap) {
                        const el = document.getElementById('adminReportesList');
                        if (!el) return;
                        if (snap.empty) { el.innerHTML = '<p style="color:var(--txt-muted);font-size:.8rem;">Sin reportes aún</p>'; return; }
                        let rhtml = '';
                        snap.docs.forEach(function(d) {
                            const r = d.data();
                            rhtml += '<div class="rep-card">';
                            rhtml += '<div class="rep-card-title">📊 ' + escapeHtml(r.fecha || d.id) + '</div>';
                            rhtml += '<div class="rep-card-meta">' + (r.totalProductos || 0) + ' productos</div>';
                            rhtml += '<button class="adm-btn primary" style="margin:0" onclick="descargarReporte(\'' + d.id + '\')"><i class="fa-solid fa-download"></i> Descargar Excel</button>';
                            rhtml += '</div>';
                        });
                        el.innerHTML = rhtml;
                    }).catch(function(e) { console.warn('[Admin] Error cargando reportes:', e); });
            }, 100);

            return html;
        }

        // ── RENDER: HISTORIA — agregar reportes publicados ─────────────────
        // (se inyecta en renderHistoriaTab vía función wrapper)
