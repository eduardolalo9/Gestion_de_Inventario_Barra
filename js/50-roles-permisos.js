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
            'adminLog.read'
        ];
        const PERMISOS_CATALOGO_SET = new Set(PERMISOS_CATALOGO);

        // Roles de sistema — semilla y fallback si Firestore no tiene (todavía)
        // los documentos roles/{roleId}, o si no hay conexión. ADMIN usa '*'
        // (comodín: todos los permisos del catálogo, presentes y futuros).
        // SUBJEFE_BARRA y BARTENDER arrancan con la MISMA base técnica a
        // propósito (así lo pide esta etapa) — diferenciarlos es
        // responsabilidad de una etapa posterior, agregando permisos, no de
        // esta.
        const ROLES_SISTEMA_DEFECTO = {
            ADMIN: {
                nombre: 'Administrador',
                permissions: ['*'],
                esSistema: true
            },
            SUBJEFE_BARRA: {
                nombre: 'Subjefe de Barra',
                permissions: ['inventory.count', 'inventory.viewOwn', 'inventory.closeOwn', 'inventory.history'],
                esSistema: true
            },
            BARTENDER: {
                nombre: 'Bartender',
                permissions: ['inventory.count', 'inventory.viewOwn', 'inventory.closeOwn', 'inventory.history'],
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
        function renderAdminTab() {
            if (!isAdmin()) return '<p style="color:var(--txt-muted)">Acceso restringido</p>';
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
            html += '<button class="adm-btn warn" onclick="migrarRolesExistentes()"><i class="fa-solid fa-arrows-rotate"></i> Migrar roles legacy a nuevo modelo</button>';
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
