        function _resetMiConteoLocal(msg) {
            myAuditoriaConteo  = {};
            myAuditoriaStatus  = estadoAreasVacio('pendiente');
            myAuditoriaUnlocks = {};
            auditoriaView      = 'selection';
            auditoriaAreaActiva = null;
            isAuditoriaMode    = false;
            saveToLocalStorage({ skipSyncTrigger: true });
            if (msg) showNotification(msg);
            renderTab();
        }
        // NOTA: tras la unificación de abajo, _resetMiConteoLocal() ya no
        // tiene ningún punto de llamada — se conserva sin eliminar (no se
        // borra código existente en esta fase) por si una fase futura
        // decide reutilizarla; su lógica está ahora duplicada de forma
        // intencional y correcta dentro de handleAuditSessionChange().

        // ══════════════════════════════════════════════════════════════════════
        //  AUTORIDAD CENTRAL DE CAMBIO DE SESIÓN DE AUDITORÍA
        //  ────────────────────────────────────────────────────────────────────
        //  Unifica lo que antes eran DOS implementaciones independientes:
        //    · _applyCloudData()     comparaba inventarioApp/{docId}._auditoriaSessionId
        //    · subscribeMyAuditoria() comparaba userAuditoria/{uid}.sessionId,
        //                              vía _resetMiConteoLocal()
        //  Ambas rutas de DETECCIÓN se conservan intactas — cada listener
        //  sigue recibiendo su propio snapshot de Firestore exactamente igual
        //  que antes — pero ninguna de las dos vuelve a decidir por su cuenta
        //  qué limpiar ni cuándo. Las dos delegan aquí.
        //
        //  Por qué es SÍNCRONA a propósito (sin await antes de completar su
        //  trabajo): en JavaScript, dos callbacks de onSnapshot que "llegan
        //  casi al mismo tiempo" nunca se ejecutan en paralelo de verdad — el
        //  bucle de eventos los procesa uno a la vez, hasta el final de cada
        //  función síncrona. Mientras esta función no ceda el hilo antes de
        //  actualizar _auditoriaSessionId, ninguna segunda llamada puede
        //  colarse a mitad de un procesamiento — es lo que la hace idempotente
        //  sin necesitar ningún mecanismo de bloqueo adicional.
        //
        //  Qué NO toca, nunca, bajo ninguna rama: products, cart, orders,
        //  inventories, inventarioConteo (conteo regular — no es auditoría),
        //  catálogo, configuración, ni ninguna estructura de datos permanente.
        //  Solo limpia el estado que pertenece exclusivamente a la sesión de
        //  auditoría anterior.
        //
        //  @param {string} nuevoSessionId   el sessionId reportado por Firestore
        //  @param {string} origen           'applyCloudData' | 'subscribeMyAuditoria' (solo para logs)
        //  @param {string|null} iniciadoPorUid  uid de quien inició la sesión,
        //         si se conoce (viene de data._auditoriaStartedBy en el doc
        //         principal; subscribeMyAuditoria no tiene este dato y pasa null).
        //         Se conserva únicamente para trazabilidad/logs — YA NO decide
        //         por sí solo si el cambio fue "propio" (ver FIX P0 abajo).
        //  @param {string|null} iniciadoPorDeviceId  deviceId de la INSTANCIA que
        //         inició la sesión, si se conoce (viene de
        //         data._auditoriaStartedByDeviceId en el doc principal;
        //         subscribeMyAuditoria no tiene este dato y pasa null).
        //
        //  FIX P0 — USUARIO ≠ DISPOSITIVO:
        //  Un mismo UID puede estar activo simultáneamente en más de un
        //  dispositivo (mismo usuario, dos instancias). Antes, "inicio propio"
        //  se decidía comparando solo iniciadoPorUid === currentUserUid, lo que
        //  hacía que CUALQUIER dispositivo logueado con el mismo usuario que
        //  inició la auditoría se considerara a sí mismo el iniciador — aunque
        //  el reset real hubiera ocurrido en OTRA instancia — y por lo tanto
        //  nunca limpiaba su estado temporal obsoleto. Ahora "inicio propio" se
        //  decide por identidad de INSTANCIA (deviceId), no de cuenta (uid): la
        //  instancia que ejecutó el reset ya limpió su estado localmente y de
        //  forma síncrona (ver auditoriaResetear) antes de escribir a Firestore,
        //  así que cuando su propio snapshot regresa no debe reprocesar. Ese
        //  caso, sin embargo, ya queda cubierto primero por la idempotencia del
        //  paso 2 (mismo sessionId ⇒ no-op) — esPropioInicio solo entra en juego
        //  cuando el sessionId SÍ cambió respecto al local, es decir: para
        //  cualquier instancia (propia o ajena) que aún no había visto este
        //  sessionId. Si iniciadoPorDeviceId no coincide con _deviceId (incluye
        //  el caso "no se conoce" ⇒ null), se trata como ajeno y se resetea.
        //  @returns {{procesado:boolean, reseteo?:boolean, motivo?:string,
        //             sessionAnterior?:string, sessionNueva?:string}}
        // ══════════════════════════════════════════════════════════════════════
        // ══════════════════════════════════════════════════════════════════════
        //  ETAPA 15 — INVENTARIO FÍSICO: listener del inventario activo
        //  ────────────────────────────────────────────────────────────────────
        //  Único listener de datos de Inventario Físico — escucha SOLO el
        //  documento inventories/{inventoryId} actualmente vigente (nunca toda
        //  la colección — ver "RENDIMIENTO" del ticket). Si el inventoryId
        //  cambia, se destruye el listener anterior y se crea uno nuevo,
        //  mismo patrón de desduplicación que _suscribirRolActual() (14.1.1).
        // ══════════════════════════════════════════════════════════════════════
        function _suscribirInventarioActivo(inventoryId) {
            if (!_db || !inventoryId) { _inventarioActivo = null; return; }
            if (_unsubInventarioActivo && _inventarioActivoId === inventoryId) return; // ya escuchando este mismo inventario
            if (typeof _unsubInventarioActivo === 'function') { _unsubInventarioActivo(); _unsubInventarioActivo = null; }
            _inventarioActivoId = inventoryId;
            _unsubInventarioActivo = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                .collection('inventories').doc(inventoryId)
                .onSnapshot(function(snap) {
                    _inventarioActivo = snap.exists ? snap.data() : null;
                    renderTab(); // refleja número/estado (SINCRONIZADO/CERRADO) en tiempo real
                }, function(err) {
                    console.warn('[InventarioFisico] Error en listener de inventories/' + inventoryId + ':', err);
                });
        }

        function handleAuditSessionChange(nuevoSessionId, origen, iniciadoPorUid, iniciadoPorDeviceId) {
            // 1. Validación
            if (!nuevoSessionId) {
                return { procesado: false, motivo: 'sessionId_invalido' };
            }

            // 2. Idempotencia — si ya es la sesión activa, no hay nada que
            //    procesar. Cubre tanto "la misma sesión llega varias veces"
            //    como "la segunda ruta llega después de que la primera ya
            //    procesó este mismo cambio" (TEST 4, 5, 6, 11).
            if (nuevoSessionId === _auditoriaSessionId) {
                console.info('[AuditSession] (' + origen + ') sessionId', nuevoSessionId,
                    'ya es la sesión activa — sin cambios, no se reprocesa.');
                return { procesado: false, motivo: 'sin_cambio' };
            }

            // 2-bis. GUARDA DE MONOTONIA (M2a) — ARREGLO DE PERDIDA DE DATOS.
            //    Un sessionId es SIEMPRE String(Date.now()) del dispositivo que
            //    inicio la auditoria (ver auditoriaResetear), asi que solo puede
            //    avanzar en el tiempo. Un id MAS VIEJO que el vigente no es una
            //    sesion nueva: es un documento rezagado.
            //
            //    El caso real: userAuditoria/{uid} solo se reescribe cuando el
            //    usuario FINALIZA un area. Si el admin abre una sesion nueva y
            //    ese usuario no finaliza nada, su documento se queda con el id
            //    de la sesion anterior — dias o semanas atras. Al siguiente
            //    arranque, subscribeMyAuditoria entregaba ese id rezagado, esta
            //    funcion lo tomaba por una sesion nueva y ejecutaba un RESET
            //    COMPLETO, que borra myAuditoriaConteo — el conteo del
            //    bartender — en silencio, sin aviso ni error.
            //
            //    Observado en produccion el 2026-09-06: la sesion retrocedio de
            //    1788197472538 (31-ago) a 1788115846917 (30-ago), 22.7 horas
            //    hacia atras, sin que nadie hubiera iniciado una auditoria.
            //
            //    La guarda es deliberadamente numerica y no confia en el origen:
            //    protege TODAS las rutas presentes y futuras, no solo la que
            //    fallo. Si algun id no fuese numerico, no se bloquea nada — se
            //    conserva el comportamiento anterior.
            var _nuevoNum   = Number(nuevoSessionId);
            var _vigenteNum = Number(_auditoriaSessionId);
            if (_auditoriaSessionId &&
                isFinite(_nuevoNum) && isFinite(_vigenteNum) &&
                _nuevoNum < _vigenteNum) {
                console.warn('[AuditSession] (' + origen + ') sessionId ' + nuevoSessionId +
                    ' es ANTERIOR al vigente ' + _auditoriaSessionId +
                    ' — documento rezagado, se ignora. NO se resetea el conteo.');
                return { procesado: false, motivo: 'sessionId_retrocede' };
            }

            const sessionAnterior     = _auditoriaSessionId;
            const teniaSesionAnterior = !!sessionAnterior; // false = primer arranque, nada que perder
            // FIX P0 (USUARIO ≠ DISPOSITIVO): "inicio propio" se decide por
            // INSTANCIA (deviceId), no por cuenta (uid) — dos dispositivos con
            // el mismo uid ya no se confunden entre sí. iniciadoPorUid se
            // conserva como argumento solo por trazabilidad (logs / futura
            // auditoría), nunca participa en esta decisión.
            const esPropioInicio      = !!iniciadoPorDeviceId && iniciadoPorDeviceId === _deviceId;

            // 3. Actualizar la única fuente de verdad EN MEMORIA — síncrono,
            //    antes de cualquier otro paso (ver nota de idempotencia arriba).
            //    Firestore es quien decide esto — localStorage/IndexedDB nunca
            //    participan en esta decisión, solo se actualizan después,
            //    como copia de exhibición/recuperación (REGLA DE PRIORIDAD).
            _auditoriaSessionId = nuevoSessionId;
            try { localStorage.setItem('inventarioApp_auditoriaSessionId', nuevoSessionId); } catch(_) {}

            // ETAPA 15: inventoryId === sessionId — cada vez que la sesión de
            // auditoría cambia (por CUALQUIER motivo: propio inicio, reset
            // real, o primer arranque), el Inventario Físico correspondiente
            // también cambia. Enganchado aquí, en el ÚNICO punto donde
            // _auditoriaSessionId se reasigna, para no duplicar la detección
            // de cambio de sesión (misma razón por la que existe esta función).
            _suscribirInventarioActivo(nuevoSessionId);

            // 4. Primer arranque (no había sesión previa que perder) o cambio
            //    provocado por esta misma INSTANCIA (mismo deviceId), que ya
            //    reseteó su estado localmente y de forma síncrona en
            //    auditoriaResetear() ANTES de escribir a Firestore — en ambos
            //    casos se adopta el sessionId sin repetir una limpieza que no
            //    corresponde o que ya ocurrió. Otra instancia con el MISMO uid
            //    (otro dispositivo del mismo usuario) NO entra por esta rama.
            if (!teniaSesionAnterior || esPropioInicio) {
                console.info('[AuditSession] (' + origen + ') sessionId adoptado sin reset (motivo: '
                    + (!teniaSesionAnterior ? 'primer_arranque' : 'propio_inicio_mismo_dispositivo')
                    + ', uid=' + (iniciadoPorUid || '—') + ', deviceId=' + (iniciadoPorDeviceId || '—') + ').');
                return { procesado: true, reseteo: false, sessionAnterior: sessionAnterior, sessionNueva: nuevoSessionId };
            }

            // 5B (FASE 5) — Antes de vaciar el conteo: archivarlo si había
            // algo sin confirmar contra el servidor (_auditSyncPending).
            //
            // Debe ir ANTES del vaciado (lee las variables actuales) y usa
            // `sessionAnterior` — capturado en el paso 2, ANTES de la
            // reasignación de _auditoriaSessionId de la línea de arriba —
            // nunca la variable mutable: para cuando este código corre,
            // _auditoriaSessionId YA apunta a la sesión NUEVA, así que un
            // set() con esa variable mezclaría conteo viejo con la sesión
            // nueva. Ver _archivarConteoHuerfanoSiAplica (js/40-firestore.js).
            _archivarConteoHuerfanoSiAplica(sessionAnterior).catch(function(err) {
                console.warn('[AuditHuerfano] Error inesperado al archivar:', err);
            });

            // 5. RESET REAL — únicamente el estado que pertenece en exclusiva
            //    a la auditoría anterior. Deliberadamente NO aparecen aquí:
            //    products, cart, orders, inventories, inventarioConteo, catálogo.
            myAuditoriaConteo   = {};
            myAuditoriaStatus   = estadoAreasVacio('pendiente');
            myAuditoriaUnlocks  = {};
            auditoriaView       = 'selection';
            auditoriaAreaActiva = null;
            isAuditoriaMode     = false;
            auditoriaConteo     = {};
            auditoriaStatus     = estadoAreasVacio('pendiente');

            // Vista agregada de admin — pertenece exclusivamente a la sesión
            // anterior. Se limpia y se re-suscribe con el sessionId YA
            // actualizado (evita el bug admin-a-admin corregido puntualmente
            // en un turno anterior: el filtro de subscribeAllUsersAuditoria
            // debe evaluarse con el valor nuevo, no con el que tenía cargado
            // antes de que esta función corriera).
            if (isAdmin()) {
                allUsersAuditoria = {};
                subscribeAllUsersAuditoria();
            }

            // 6. Persistir el nuevo estado (vacío) local — para que sobreviva
            //    un cierre de la app a mitad de la transición — vía el mismo
            //    saveToLocalStorage()/_idbSaveAll() ya existentes, sin
            //    reimplementar esa lógica aquí.
            saveToLocalStorage({ skipSyncTrigger: true });
            renderTab();
            // Retraso deliberado (idéntico al que ya usaba _applyCloudData)
            // para que la notificación se muestre después de que renderTab()
            // termine, no se pierda visualmente en el redibujado.
            setTimeout(function() {
                showNotification('🔄 Nueva auditoría iniciada — tus conteos se reiniciaron.');
            }, 500);

            console.info('[AuditSession] (' + origen + ') Reset completo:', sessionAnterior, '→', nuevoSessionId);

            return { procesado: true, reseteo: true, sessionAnterior: sessionAnterior, sessionNueva: nuevoSessionId };
        }

        // Se expone también como capacidad del SessionManager ya existente
        // (Fase 1) por composición — no se crea un segundo SessionManager ni
        // una arquitectura paralela; es la misma función, referenciada desde
        // ambos lugares.
        if (typeof SessionManager !== 'undefined' && SessionManager) {
            SessionManager.handleAuditSessionChange = handleAuditSessionChange;
        }

        function subscribeMyAuditoria() {
            if (!_db || !currentUserUid) return;
            if (typeof _unsubMyAuditoria === 'function') { _unsubMyAuditoria(); _unsubMyAuditoria = null; }
            const ref = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                           .collection('userAuditoria').doc(currentUserUid);
            _unsubMyAuditoria = ref.onSnapshot(function(snap) {
                if (snap.metadata.hasPendingWrites) return;

                // ─────────────────────────────────────────────────────────────
                // Path A: El documento userAuditoria/{uid} no existe en Firestore.
                //
                // FIX CRÍTICO (BUG 1): NO resetear aquí.
                //
                // Antes este path reseteaba myAuditoriaConteo si el doc no existía
                // Y el usuario tenía datos locales — lo que borraba TODO el conteo
                // aunque el admin NO hubiera iniciado una nueva auditoría.
                //
                // La ausencia del doc significa simplemente que el usuario aún no
                // finalizó ningún área (su primera escritura a Firestore ocurre en
                // auditoriaFinalizarConteo → syncMyAuditoriaToFirestore). No es señal
                // de "nueva auditoría".
                //
                // El reset real por "nueva auditoría del admin" llega via el listener
                // del documento principal (subscribeMainDoc → _applyCloudData) que
                // detecta el cambio de _auditoriaSessionId en inventarioApp/{docId}.
                // ─────────────────────────────────────────────────────────────
                if (!snap.exists) return;

                const data = snap.data();

                // ─────────────────────────────────────────────────────────────
                // Path B: El doc existe y tiene sessionId.
                //
                // FIX (BUG 2): Diferenciar "primer arranque" de "nueva auditoría real".
                //
                // Detección de cambio de sesión — delega en la autoridad
                // central (handleAuditSessionChange), que unifica esta ruta
                // con la de _applyCloudData(). Ya no se decide aquí qué
                // limpiar ni cuándo — solo se reporta lo que este listener
                // observó en su propio documento (userAuditoria/{uid}).
                if (data.sessionId) {
                    // userAuditoria/{uid} no registra quién inició la sesión (ni uid
                    // ni deviceId) — se pasan ambos como null explícitamente. Esto
                    // es seguro: si esta instancia fue la iniciadora, su propio
                    // _auditoriaSessionId ya fue actualizado de forma síncrona por
                    // auditoriaResetear() antes de este snapshot, así que la
                    // idempotencia (paso 2) ya intercepta ese caso antes de llegar
                    // aquí — este listener nunca necesita distinguir "propia" de
                    // "ajena" por sí mismo.
                    const resultado = handleAuditSessionChange(data.sessionId, 'subscribeMyAuditoria', null, null);
                    if (resultado.procesado && resultado.reseteo) {
                        return; // reset ya aplicado y renderizado — no seguir con Path C sobre datos viejos
                    }
                }

                // Path C: Desbloqueos nuevos del admin
                const serverUnlocks = data.unlocks || {};
                let nuevoDesbloqueo = false;
                Object.keys(serverUnlocks).forEach(key => {
                    if (!myAuditoriaUnlocks[key] || !myAuditoriaUnlocks[key].unlockedAt) {
                        myAuditoriaUnlocks[key] = serverUnlocks[key];
                        nuevoDesbloqueo = true;
                    }
                });
                if (nuevoDesbloqueo) {
                    saveToLocalStorage({ skipSyncTrigger: false });
                    showNotification('🔓 El administrador desbloqueó un producto para corrección');
                    renderTab();
                }

                // ─────────────────────────────────────────────────────────────
                // Path D: Reapertura de área confirmada por el admin.
                //
                // FIX 5A (FASE 5): reabrirArea() (js/75-auditoria-flujo.js)
                // escribe status.{area} = 'pendiente' en ESTE documento para
                // cada persona afectada — pero este listener nunca leía
                // data.status, solo sessionId (Path B) y unlocks (Path C). El
                // bartender nunca se enteraba de que su área fue reabierta:
                // auditoriaEntrarArea() sigue bloqueando por myAuditoriaStatus,
                // variable local que nunca se actualizaba. El admin veía el
                // área en pendiente; el bartender la seguía viendo bloqueada,
                // sin ningún error visible, sin importar si recargaba.
                //
                // Alcance deliberado: solo se reacciona al sentido "reabrir"
                // (servidor dice 'pendiente' para un área que aquí sigue
                // 'completada'). El sentido contrario — reflejar aquí que YA
                // se finalizó desde OTRO dispositivo del mismo usuario — es un
                // problema distinto (sincronía entre dispositivos del mismo
                // uid, no reapertura) y no es lo que este fix corrige.
                // ─────────────────────────────────────────────────────────────
                const serverStatus = data.status || {};
                let huboReapertura = false;
                Object.keys(serverStatus).forEach(function(area) {
                    if (serverStatus[area] === 'pendiente' && myAuditoriaStatus[area] === 'completada') {
                        myAuditoriaStatus[area] = 'pendiente';
                        if (typeof myAuditoriaFinalizadas !== 'undefined' && myAuditoriaFinalizadas) {
                            delete myAuditoriaFinalizadas[area];
                        }
                        huboReapertura = true;
                    }
                });
                if (huboReapertura) {
                    saveToLocalStorage({ skipSyncTrigger: true });
                    showNotification('↩️ El administrador reabrió un área para que la corrijas');
                    renderTab();
                }
            }, function(err) { console.warn('[AuditUser] Error listener propio:', err); });
        }

        /**
         * Admin: escucha TODOS los documentos userAuditoria/* en tiempo real.
         * Llena allUsersAuditoria con los conteos de cada usuario.
         */
        let _adminRenderTimer = null; // FIX-8: debounce para renders del admin

function subscribeAllUsersAuditoria() {
            if (!_db || !isAdmin()) return;
            if (typeof _unsubAllUsers === 'function') { _unsubAllUsers(); _unsubAllUsers = null; }
            const colRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                              .collection('userAuditoria');
            _unsubAllUsers = colRef.onSnapshot(function(snap) {
                allUsersAuditoria = {};
                snap.forEach(function(doc) {
                    const data = doc.data();
                    // FIX 3 CRÍTICO: Solo filtrar por sessionId si AMBOS lados tienen
                    // sessionId definido. Si _auditoriaSessionId es null (primera carga),
                    // mostrar todos los usuarios de la sesión más reciente.
                    if (data.sessionId && _auditoriaSessionId && data.sessionId !== _auditoriaSessionId) return;
                    allUsersAuditoria[doc.id] = {
                        uid:       doc.id,
                        email:     data.email || doc.id,
                        status:    data.status || estadoAreasVacio('pendiente'),
                        conteo:    data.conteo || {},
                        unlocks:   data.unlocks || {},
                        updatedAt: data.updatedAt || 0,
                        // FIX ADMIN-MERGE: preservar bandera para priorización en agregación
                        isAdmin:   data.isAdmin || false
                    };
                });
                // Reconstruir auditoriaConteo agregado (suma/promedio de todos los usuarios)
        _recalcAdminAggregatedConteo();
        // FIX-8: Debounce render — max 1 cada 500ms con múltiples usuarios
        clearTimeout(_adminRenderTimer);
        _adminRenderTimer = setTimeout(function() {
            if (activeTab === 'inventario' || activeTab === 'inicio') renderTab();
        }, 500);
            }, function(err) { console.warn('[AuditAdmin] Error listener usuarios:', err); });
        }

        /** Recalcula auditoriaConteo con la estrategia ADMIN-PRIORITY.
         *
         *  Lógica de prioridad por producto/área:
         *  1. Si el admin contó ese producto/área → su conteo es AUTORIDAD.
         *     (El admin ya vio el conteo del usuario como base y solo agregó lo que faltaba)
         *  2. Si ningún admin contó → Last-Write-Wins entre usuarios regulares.
         *
         *  Esto garantiza que cuando el admin agrega una botella abierta que el
         *  usuario olvidó, el total final incluye AMBAS contribuciones sin pérdida. */
        function _recalcAdminAggregatedConteo() {
            const AREAS = AREAS_CONTEO;
            const aggregated = {};
const usersList = Object.values(allUsersAuditoria);
    // FIX-2: NO borrar auditoriaConteo si usersList está vacío por desconexión
    // temporal de Firestore. El wipe real ocurre en _adminIniciarSesionFirestore.
    if (usersList.length === 0) { return; }
            // Separar admins de usuarios regulares
            const adminEntries   = usersList.filter(u => u.isAdmin);
            const regularEntries = usersList.filter(u => !u.isAdmin);

            // Recolectar todos los prodIds (de todos los usuarios)
            const prodIds = new Set();
            usersList.forEach(u => Object.keys(u.conteo).forEach(id => prodIds.add(id)));

            prodIds.forEach(prodId => {
                aggregated[prodId] = {};
                AREAS.forEach(area => {
                    // ── Paso 1: ¿Algún admin contó este producto/área? ──────────
                    const adminConEntradas = adminEntries
                        .map(u => ({ u, d: u.conteo[prodId] && u.conteo[prodId][area] }))
                        .filter(e => e.d);

                    if (adminConEntradas.length > 0) {
                        // Admin tiene autoridad → usar su conteo (ya incluye el del usuario como base)
                        // Si varios admins contaron, tomar el más reciente
                        adminConEntradas.sort((a, b) => (b.u.updatedAt || 0) - (a.u.updatedAt || 0));
                        const winner = adminConEntradas[0].d;
                        aggregated[prodId][area] = {
                            enteras:       winner.enteras  || 0,
                            abiertas:      winner.abiertas || [],
                            _usuarios:     usersList.filter(u => u.conteo[prodId] && u.conteo[prodId][area]).length,
                            _hayConflicto: false, // Admin resolvió el conflicto al guardar su conteo final
                            _adminCorrigió: true  // bandera visual para el panel
                        };
                        return;
                    }

                    // ── Paso 2: Solo usuarios regulares → Last-Write-Wins ──────
                    const entries = regularEntries
                        .map(u => ({ u, d: u.conteo[prodId] && u.conteo[prodId][area] }))
                        .filter(e => e.d);

                    if (entries.length === 0) {
                        aggregated[prodId][area] = { enteras: 0, abiertas: [], _usuarios: 0 };
                        return;
                    }

                    // BUG-4 FIX: usar timestamp del conteo del PRODUCTO específico
                    // (d._ts o d._lastWrite), no el updatedAt del documento de usuario
                    // que refleja cualquier escritura del usuario (en cualquier área).
                    entries.sort((a, b) => {
                        const tsA = (a.d._ts || a.d._lastWrite || a.u.updatedAt || 0);
                        const tsB = (b.d._ts || b.d._lastWrite || b.u.updatedAt || 0);
                        return tsB - tsA;
                    });
                    const winner = entries[0].d;
                    aggregated[prodId][area] = {
                        enteras:       winner.enteras  || 0,
                        abiertas:      winner.abiertas || [],
                        _usuarios:     entries.length,
                        _hayConflicto: entries.length > 1 &&
                            entries.some(e => (e.d.enteras || 0) !== (winner.enteras || 0)),
                        _adminCorrigió: false
                    };
                });
            });
            auditoriaConteo = aggregated;
        }

        /**
         * Admin desbloquea UN producto específico para que UN usuario lo corrija.
         * Escribe el unlock en Firestore → subscribeMyAuditoria() lo detecta en tiempo real.
         */
        async function adminUnlockProducto(userId, prodId, area) {
            if (!_db || !isAdmin()) return;
            const key = prodId + '__' + area;
            const unlockData = { unlockedBy: currentUserUid, unlockedAt: Date.now(), used: false };
            try {
                await _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                         .collection('userAuditoria').doc(userId)
                         .set({ unlocks: { [key]: unlockData } }, { merge: true });
                showNotification('🔓 Corrección habilitada para el usuario');
            } catch (err) {
                console.error('[AuditAdmin] Error unlock:', err);
                showNotification('❌ Error al habilitar corrección');
            }
        }

        /**
         * Usuario guarda la corrección de un producto desbloqueado.
         * Solo actualiza ESE producto; el resto del conteo permanece intacto.
         */
        async function guardarCorreccionProducto(prodId, area, enteras, abiertas) {
            const key = prodId + '__' + area;
            if (!myAuditoriaUnlocks[key]) {
                showNotification('⚠️ Este producto no está habilitado para corrección');
                return;
            }
            if (!myAuditoriaConteo[prodId]) myAuditoriaConteo[prodId] = {};
            myAuditoriaConteo[prodId][area] = { enteras, abiertas, _corregidoEn: Date.now(), _ts: Date.now() }; // BUG-12 FIX
            // Marcar el unlock como usado (evitar correcciones múltiples sin nueva autorización)
            myAuditoriaUnlocks[key] = Object.assign({}, myAuditoriaUnlocks[key], { used: true });
            saveToLocalStorage();
            await syncMyAuditoriaToFirestore();
            showNotification('✅ Corrección guardada');
            renderTab();
        }

        /**
         * Admin: reiniciar sesión de auditoría.
         * Escribe nuevo sessionId en Firestore → todos los usuarios lo detectan y reinician.
         */
        // ══════════════════════════════════════════════════════════════════════
        //  ETAPA 15 — INVENTARIO FÍSICO: numeración segura
        //  ────────────────────────────────────────────────────────────────────
        //  Obtiene el siguiente número visible (#101, #102...) de forma seguro
        //  ante concurrencia: dos admins pulsando "Nuevo Inventario Físico" casi
        //  simultáneamente NUNCA pueden recibir el mismo número, porque
        //  runTransaction() reintenta automáticamente si detecta que el
        //  documento cambió entre la lectura y la escritura (optimistic
        //  concurrency nativo de Firestore, no algo que se implementa a mano).
        //  No se combina con el batch atómico de _adminIniciarSesionFirestore
        //  porque una transacción (lectura+escritura condicionada) y un
        //  WriteBatch (escrituras incondicionales) son mecanismos distintos de
        //  Firestore — el pequeño costo aceptado es que, en el caso extremo de
        //  que ESTA transacción tenga éxito pero el batch posterior falle
        //  (p.ej. se corta la conexión justo entre ambas), el número queda
        //  "consumido" sin usarse (un salto en la numeración, #101→#103), pero
        //  NUNCA puede haber dos inventarios con el mismo número — que es el
        //  requisito real del ticket ("no debe generarse #101 #101").
        // ══════════════════════════════════════════════════════════════════════
        async function _obtenerSiguienteNumeroInventario() {
            const contadorRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                                    .collection('contadores').doc('inventarios');
            return _db.runTransaction(async function(tx) {
                const snap = await tx.get(contadorRef);
                const anterior = (snap.exists && typeof snap.data().ultimoNumero === 'number')
                    ? snap.data().ultimoNumero : 100; // primer inventario real = #101
                const nuevo = anterior + 1;
                tx.set(contadorRef, { ultimoNumero: nuevo }, { merge: true });
                return nuevo;
            });
        }

        // R7 — lectura defensiva de lo que dejo el formulario. Si alguien llama
        // a la creacion por el camino antiguo, _opcionesNuevoInventario es null
        // y todo cae a los valores de siempre.
        function _opcNuevoInv(campo, porDefecto) {
            var o = (typeof _opcionesNuevoInventario !== 'undefined') ? _opcionesNuevoInventario : null;
            if (!o || o[campo] === undefined || o[campo] === null || o[campo] === '') return porDefecto;
            return o[campo];
        }
        function _areasDelNuevoInventario() {
            var o = (typeof _opcionesNuevoInventario !== 'undefined') ? _opcionesNuevoInventario : null;
            if (o && Array.isArray(o.areas) && o.areas.length) {
                // Solo las que existen de verdad: una lista guardada podria
                // nombrar un area que el admin borro entre medias.
                var v = o.areas.filter(function(a) { return AREAS_CONTEO.indexOf(a) !== -1; });
                if (v.length) return v;
            }
            return AREAS_CONTEO.slice();
        }

        async function _adminIniciarSesionFirestore(sessionId, numeroInventario) {
            // FIX-PROP-1 (CRÍTICO): antes, si el admin estaba offline en el
            // instante exacto de confirmar, esta función retornaba en silencio
            // (sin lanzar error) y auditoriaResetear() —que SÍ tiene manejo de
            // error correcto— nunca se enteraba de que nada llegó a Firestore.
            // El admin veía "✅ Nueva auditoría iniciada" mientras el resto de
            // los dispositivos seguían viendo la sesión anterior indefinidamente,
            // porque _auditoriaSessionId nunca cambió en el documento principal.
            // Ahora se lanza el error para que el llamador lo detecte y lo
            // muestre — nunca más un "éxito" falso.
            if (!_db || !isAdmin()) return; // estado inválido genuino, no un fallo a reportar
            if (!navigator.onLine) {
                throw new Error('sin_conexion: no se puede iniciar la sesión de auditoría offline');
            }

            const mainDocRef          = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID);
            const userAuditoriaColRef = mainDocRef.collection('userAuditoria');
            const inventoryRef        = mainDocRef.collection('inventories').doc(sessionId); // ETAPA 15

            // FIX P0.1 (ATOMICIDAD DEL INICIO DE AUDITORÍA):
            // Antes, esta función ejecutaba TRES operaciones Firestore
            // independientes en secuencia: (1) batch.commit() borrando
            // userAuditoria/* de otros usuarios, (2) .set() del documento
            // principal, (3) .set() del userAuditoria propio del admin. Si la
            // conexión se cortaba entre cualquiera de ellas, Firestore quedaba
            // en un estado intermedio real y persistente:
            //   - (1)✅+(2)❌: el progreso finalizado de OTROS usuarios ya se
            //     había borrado de Firestore, pero el documento principal
            //     seguía anunciando la sesión ANTERIOR — ningún otro
            //     dispositivo se enteraba de nada, y ese progreso perdido era
            //     irrecuperable desde Firestore.
            //   - (2)✅+(3)❌: el documento principal ya apuntaba a la nueva
            //     sesión (otros dispositivos podían empezar a converger) pero
            //     el propio admin nunca recibía su confirmación de vuelta.
            // Ahora las tres operaciones viven en el MISMO WriteBatch:
            // Firestore garantiza que se aplican TODAS o NINGUNA. La lectura
            // previa (snap = colRef.get()) es solo lectura, no escribe nada,
            // así que no rompe la atomicidad de lo que sí se escribe.
            //
            // ETAPA 15: se agrega UNA 4ª operación al MISMO batch — el
            // documento inventories/{sessionId} — precisamente para que la
            // creación del Inventario Físico comparta la MISMA garantía
            // atómica que ya protegía el inicio de sesión (nunca queda un
            // inventario "a medias": o se crea junto con la sesión, o no se
            // crea nada). No se abre un batch/transacción separada para esto.
            const snap  = await userAuditoriaColRef.get();
            const batch = _db.batch();

            // 1) Borrar todos los documentos de userAuditoria de la sesión
            //    anterior, EXCEPTO el propio admin (BUG-6 FIX: evita que su
            //    propio delete dispare un loop de reset en su propio listener;
            //    su doc se sobrescribe explícitamente en el punto 3).
            snap.forEach(doc => {
                if (doc.id !== currentUserUid) batch.delete(doc.ref);
            });

            // 2) Documento principal: nueva sesión + limpieza de campos de
            //    auditoría del ciclo anterior (FIX-G1) + metadatos de
            //    trazabilidad de quién y qué instancia la inició (FIX-PROP-3,
            //    FIX P0 — incluye _auditoriaStartedByDeviceId).
            batch.set(mainDocRef, {
                _auditoriaSessionId:  sessionId,
                _auditoriaStartedBy:  currentUserUid,
                _auditoriaStartedByDeviceId: _deviceId,
                _auditoriaStartedAt:  Date.now(),
                _lastModified:        Date.now(),
                _lastWrittenBy:       currentUserUid,
                _lastWrittenRole:     'admin',
                auditoriaStatus:  estadoAreasVacio('pendiente'),
                auditoriaConteo:  {}
            }, { merge: true });

            // 3) userAuditoria del propio admin (FIX-G2): sobrescritura
            //    completa (sin merge, elimina conteos/unlocks del ciclo
            //    anterior), ahora en el MISMO batch en vez de una escritura
            //    aparte.
            batch.set(userAuditoriaColRef.doc(currentUserUid), {
                uid:       currentUserUid,
                email:     (_auth && _auth.currentUser) ? _auth.currentUser.email : currentUserUid,
                sessionId: sessionId,
                status:    estadoAreasVacio('pendiente'),
                conteo:    {},
                unlocks:   {},
                updatedAt: Date.now(),
                isAdmin:   true
            });

            // 4) ETAPA 15 — documento del Inventario Físico. inventoryId ===
            //    sessionId (mismo identificador; ver informe sobre por qué no
            //    se introduce un segundo ID paralelo). 'stockAreas'/
            //    'userAuditoria' NO se tocan aquí — son el stock operativo
            //    continuo de la sucursal (ver aclaración de negocio de esta
            //    etapa), nunca se ponen en cero al crear un nuevo inventario.
            batch.set(inventoryRef, {
                inventoryId:     sessionId,
                numero:          numeroInventario,
                tipo:            'inventario_fisico',
                branchId:        FIRESTORE_DOC_ID,
                estado:          'SINCRONIZADO',
                fechaCreacion:   Date.now(),
                creadoPorUid:    currentUserUid,
                creadoPorNombre: (_auth && _auth.currentUser) ? _auth.currentUser.email : currentUserUid,
                creadoPorRol:    _authzState.roleId || 'ADMIN',
                creadoPorDeviceId: _deviceId,
                fechaCierre:     null,
                cerradoPorUid:   null,
                cerradoPorNombre: null,
                totalProductos:  products.length,
                // R7 — el formulario puede limitar el inventario a unas areas
                // concretas. Si no hay formulario (camino antiguo), entran todas.
                // Esta fotografia es la que manda para ese inventario: aunque
                // despues se creen o borren areas, este conteo sigue siendo de
                // las que tenia cuando se abrio.
                warehousesSnapshot: _areasDelNuevoInventario(),
                nombre:          _opcNuevoInv('nombre', 'BARRA INVENTARIO FISICO'),
                comentario:      _opcNuevoInv('comentario', ''),
                fechaRecuento:   _opcNuevoInv('fechaRecuento', null)
            });

            await batch.commit(); // atómico: todo-o-nada para (1)+(2)+(3)+(4)

            console.info('[AuditAdmin] Nueva sesión', sessionId, '(Inventario Físico #' + numeroInventario + ') iniciada ✓ (batch atómico)');
            // Ya NO hay try/catch aquí — cualquier error de red a mitad de estas
            // escrituras se propaga tal cual al llamador (auditoriaResetear),
            // que es quien decide cómo informarlo al usuario. Con el batch
            // atómico, un error aquí garantiza que NADA de lo anterior se
            // aplicó — no hay estados intermedios que limpiar.
        }

        /**
         * Exportar a Excel solo el conteo propio del usuario (áreas finalizadas).
         * El usuario NO ve los conteos de los demás.
         */
        function exportarExcelMiConteo() {
            const areasFinalizadas = AREAS_CONTEO
                .filter(a => myAuditoriaStatus[a] === 'completada');
            if (areasFinalizadas.length === 0) {
                showNotification('⚠️ Finaliza al menos un área antes de exportar');
                return;
            }
            exportToExcelConDatos('AUDITORIA', myAuditoriaConteo, products,
                'mi_conteo_' + new Date().toISOString().split('T')[0] + '.xlsx');
        }

        /**
         * Admin: exportar el inventario total consolidado de todos los usuarios y áreas.
         */
        function exportarExcelAdminTotal() {
            if (Object.keys(allUsersAuditoria).length === 0 && Object.keys(auditoriaConteo).length === 0) {
                showNotification('⚠️ No hay conteos de usuarios para exportar');
                return;
            }
            exportToExcelConDatos('AUDITORIA', auditoriaConteo, products,
                'inventario_total_' + new Date().toISOString().split('T')[0] + '.xlsx');
        }
        /**
         * loadConflictosDesdeFirestore()
         * ─────────────────────────────
         * Al iniciar la app, descarga el estado de conflictos de abiertas
         * para mostrarlo en las tarjetas de auditoría.
         */
        async function loadConflictosDesdeFirestore() {
            if (!_db || !navigator.onLine || !_haySesionFirebase()) return; // M2a
            // FASE 2B — se invoca en el arranque sin ninguna guarda de rol y
            // agrega los conteos de todos los dispositivos. La guarda real
            // vive dentro de _cargarYAgeregarConteos(), pero se corta también
            // aquí para no lanzar una consulta por área que no llevará a nada.
            if (!puedeVerConteosAjenos()) return;
            try {
                // R6: una por cada area definida, no tres fijas. Con las areas
                // escritas a mano, una cuarta area se contaba en el telefono y
                // nunca llegaba al panel del administrador.
                await Promise.all(AREAS_CONTEO.map(function(a) {
                    return _cargarYAgeregarConteos(a);
                }));
                console.info('[MultiDisp] Conteos de todos los dispositivos cargados ✓');
            } catch (err) {
                console.warn('[MultiDisp] No se pudieron cargar conteos desde Firestore:', err);
            }
        }

        /**
         * loadFromCloud()
         * ───────────────
         * Descarga el estado de Firestore y lo compara con localStorage.
         * Gana el registro con _lastModified más alto (último-gana).
         * Si la nube tiene datos más recientes, reemplaza el estado en memoria
         * y en localStorage sin pedir confirmación (startup silencioso).
         * Si localStorage tiene datos más recientes (cambios offline previos),
         * inicia una sincronización hacia la nube.
         */
        async function loadFromCloud() {
            if (!_db) return;
            if (!_haySesionFirebase()) return; // M2a: la lectura seria rechazada
            if (!navigator.onLine) {
                console.info('[Firebase] Sin conexión — usando localStorage.');
                return;
            }

            updateCloudSyncBadge('syncing');

            try {
                const docRef = _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID);
                // FIX SYNC-2: forzar lectura desde servidor en la primera carga
                // para ignorar caché stale de Firestore offline persistence.
                // Sin esto, Firestore sirve datos viejos del caché antes que los reales.
                const snap   = await docRef.get({ source: 'server' }).catch(() => docRef.get());

                if (!snap.exists) {
                    // Primera vez: subir datos locales a la nube
                    console.info('[Firebase] Documento nuevo — subiendo estado inicial…');
                    await syncToCloud();
                    return;
                }

                const cloudData = snap.data();
                const cloudTs   = cloudData._lastModified || 0;
                const localTs   = parseInt(localStorage.getItem('inventarioApp_lastModified') || '0', 10);

                console.info('[Firebase] localTs=' + localTs + ' cloudTs=' + cloudTs);

                if (cloudTs > localTs) {
                    // La nube es más reciente → aplicar
                    await _applyCloudData(cloudData);
                    showNotification('☁️ Datos sincronizados desde la nube');
                } else if (localTs > cloudTs) {
                    // Local es más reciente → subir
                    console.info('[Firebase] Local más reciente — subiendo…');
                    await syncToCloud();
                } else {
                    // Iguales → sin conflicto
                    updateCloudSyncBadge('ok');
                    console.info('[Firebase] Estado sincronizado ✓');
                }

            } catch (err) {
                console.error('[Firebase] Error en loadFromCloud:', err);
                updateCloudSyncBadge('error');
                // No interrumpir arranque — se sigue con datos locales
            }
        }

        /**
         * _preservarConteosPendientes(deLaNube, local)
         * ───────────────────────────────────────────
         * Devuelve el conteo de la nube, pero conservando los productos/área
         * que este dispositivo tiene anotados como pendientes de subir.
         *
         * Solo protege lo que está en el outbox, no todo lo local: un conteo
         * ya confirmado por el servidor no tiene por qué ganarle a la nube,
         * porque la nube ya lo incluye. Y un conteo que perdió un conflicto
         * de versión tampoco, porque salió del outbox a propósito.
         *
         * Sin _db o sin outbox (por ejemplo en las pruebas del navegador) se
         * comporta exactamente como antes: gana la nube.
         */
        function _preservarConteosPendientes(deLaNube, local) {
            if (typeof _outboxPendientes !== 'function') return deLaNube;
            const pendientes = _outboxPendientes();
            if (!pendientes.length || !local) return deLaNube;

            const resultado = deLaNube || {};
            let conservados = 0;

            pendientes.forEach(function(clave) {
                const corte = clave.indexOf('|');
                if (corte <= 0) return;
                const pid  = clave.slice(0, corte);
                const area = clave.slice(corte + 1);

                const valorLocal = local[pid] && local[pid][area];
                if (!valorLocal || typeof valorLocal.enteras === 'undefined') return;

                if (!resultado[pid]) resultado[pid] = {};
                resultado[pid][area] = valorLocal;
                conservados++;
            });

            if (conservados > 0) {
                console.info('[ConteoProducto]', conservados,
                    'conteo(s) sin confirmar conservados frente a la nube.');
            }
            return resultado;
        }

        /**
         * _applyCloudData(data)
         * ──────────────────────
         * Aplica un snapshot de Firestore al estado en memoria y a localStorage.
         * Incluye la migración de formato de inventarioConteo (compatibilidad backups).
         */
        async function _applyCloudData(data) {
            // FIX 7: Guard de reentrada — si ya estamos aplicando datos de la nube,
            // ignorar el snapshot duplicado en lugar de ejecutar en paralelo.
            if (_applyingCloudData) {
                console.info('[Firebase] _applyCloudData ya en progreso — snapshot ignorado');
                return;
            }
            _applyingCloudData = true;
            try {
                // ══════════════════════════════════════════════════════════════
                // FIX 1 (complemento descarga) + FIX #3 (función global)
                // Si el documento de la nube usa el esquema de subcolecciones
                // (_ordersInChunks / _inventoriesInChunks), leer los chunks y
                // reconstruir los arrays usando la función global _readChunkedSubcollection.
                // ══════════════════════════════════════════════════════════════
                let cloudOrders      = data.orders      || [];
                let cloudInventories = data.inventories || [];
                const docRef = _db
                    ? _db.collection('inventarioApp').doc(FIRESTORE_DOC_ID)
                    : null;

                if (data._ordersInChunks) {
                    cloudOrders = await _readChunkedSubcollection(docRef, 'ordersChunks');
                }
                if (data._inventoriesInChunks) {
                    cloudInventories = await _readChunkedSubcollection(docRef, 'inventoriesChunks');
                }

                // Validación básica de estructura (ahora que ya tenemos los arrays)
                if (!Array.isArray(data.products) || !Array.isArray(cloudOrders) ||
                    !Array.isArray(cloudInventories)) {
                    console.warn('[Firebase] Documento en nube con estructura inválida — ignorado.');
                    updateCloudSyncBadge('error');
                    return;
                }

                // FIX-CLOUD-VALIDATE: Validación de integridad de los productos descargados.
                // Firestore podría devolver un array con nulls o entradas sin 'id' si hubo
                // una escritura corrupta. Filtrar antes de aplicar para no romper el catálogo.
                const validatedProducts = data.products.filter(function(p) {
                    if (!p || typeof p !== 'object') {
                        console.warn('[Firebase] Producto corrupto descartado:', p);
                        return false;
                    }
                    if (!p.id || typeof p.id !== 'string') {
                        console.warn('[Firebase] Producto sin ID descartado:', p);
                        return false;
                    }
                    if (!p.name || typeof p.name !== 'string') {
                        console.warn('[Firebase] Producto sin nombre descartado:', p.id);
                        return false;
                    }
                    return true;
                });

                if (validatedProducts.length === 0 && data.products.length > 0) {
                    // Todos los productos fallaron validación — rechazar para no limpiar catálogo
                    console.error('[Firebase] TODOS los productos fallaron validación — aplicación abortada para proteger datos locales.');
                    updateCloudSyncBadge('error');
                    showNotification('❌ Error: datos de nube inválidos. Catálogo local protegido.');
                    return;
                }

                // FIX-PRE-MERGE-BACKUP: Guardar snapshot de los datos locales ANTES de sobreescribir
                // con los datos de la nube. Si la nube tiene datos corruptos o incompletos,
                // se puede recuperar el estado anterior desde este backup.
                try {
                    const premergeSnap = JSON.stringify({
                        products:          products,
                        inventarioConteo:  inventarioConteo,
                        myAuditoriaConteo: myAuditoriaConteo,
                        _ts:               Date.now()
                    });
                    localStorage.setItem('inventarioApp_preMergeBackup', premergeSnap);
                } catch (_) { /* backup es best-effort */ }

                // FIX-CONCURRENCIA (BarInventory): en vez de sobrescribir products/
                // orders/inventories por completo con lo que llega de la nube (lo
                // que borraba cualquier alta local hecha en este dispositivo que
                // todavía no se había sincronizado), se fusiona por id — la nube
                // gana para ids que ya existen en ambos lados (trae ediciones de
                // otros dispositivos), pero se conservan los ids que solo existen
                // localmente (alta reciente de este dispositivo, aún pendiente).
                // D — dos sentidos de la purga del catálogo:
                //   • Si OTRO administrador vació el catálogo, su marca llega
                //     con fecha más nueva que la nuestra: se adopta el vaciado
                //     en vez de conservar los productos locales, que es lo que
                //     hacía _mergeArrayByIdPreferCloud (conserva los ids que
                //     solo existen en local — aquí serían los 424 enteros).
                //   • Si la purga la hicimos NOSOTROS y la nube todavía no la
                //     refleja, no se fusiona nada de la nube.
                const _purgaNube = (data && data._catalogoPurgadoEn) || 0;
                if (_purgaNube > (_catalogoPurgadoEn || 0)) {
                    console.info('[Catalogo] Otro administrador vació el catálogo — se adopta el vaciado.');
                    _marcarCatalogoPurgado(_purgaNube);
                    products = validatedProducts.slice();
                } else if (_purgaDeCatalogoVigente(data)) {
                    console.info('[Catalogo] Purga local vigente — no se recuperan productos de la nube.');
                } else {
                    products = _mergeArrayByIdPreferCloud(products, validatedProducts);
                }
                orders      = _mergeArrayByIdPreferCloud(orders,      cloudOrders);
                inventories = _mergeArrayByIdPreferCloud(inventories, cloudInventories);
                cart        = data.cart        || [];
                activeTab   = data.activeTab   || 'inicio';
                selectedArea = data.selectedArea || AREAS_CONTEO[0] || 'almacen';   // R6
                // R6: la definicion de areas llega antes que el estado que la usa.
                // Si se aplicara despues, auditoriaStatus se leeria contra las areas
                // viejas y un area nueva apareceria sin estado.
                if (Array.isArray(data.areasConteo) && typeof aplicarDefinicionAreas === 'function') {
                    aplicarDefinicionAreas(data.areasConteo);
                    if (typeof _guardarAreasLocal === 'function') _guardarAreasLocal();
                }
                if (data.auditoriaStatus && typeof data.auditoriaStatus === 'object') auditoriaStatus = data.auditoriaStatus;
                if (data.auditoriaConteo && typeof data.auditoriaConteo === 'object') auditoriaConteo = data.auditoriaConteo;

                // Detectar cambio de sesión de auditoría — delega en la
                // autoridad central (handleAuditSessionChange), que unifica
                // esta ruta con la de subscribeMyAuditoria(). Ya no se decide
                // aquí qué limpiar ni cuándo — solo se reporta lo que este
                // listener observó en el documento principal.
                if (data._auditoriaSessionId) {
                    // FIX P0 (USUARIO ≠ DISPOSITIVO): se añade el deviceId del
                    // iniciador (data._auditoriaStartedByDeviceId) como 4º
                    // argumento — es el dato que handleAuditSessionChange usa
                    // ahora para decidir "inicio propio" por instancia. El uid
                    // (3er argumento) se conserva solo para trazabilidad.
                    handleAuditSessionChange(
                        data._auditoriaSessionId,
                        'applyCloudData',
                        data._auditoriaStartedBy,
                        data._auditoriaStartedByDeviceId
                    );
                }

                // Migración de formato inventarioConteo — tres niveles de
                // compatibilidad, del más nuevo al más antiguo:
                //   1) stockAreas/{area}/productos/{id} — esquema nuevo, un
                //      documento por producto, con `version` (concurrencia segura)
                //   2) stockAreas/{area} como documento único con todos los
                //      productos — esquema anterior, se usa si (1) no tiene
                //      datos todavía (dispositivo/organización sin migrar)
                //   3) data.inventarioConteo embebido en el doc principal —
                //      el esquema más antiguo de todos
                let rawConteo = {};
                if (docRef) {
                    const areasConocidas = AREAS_CONTEO;
                    const snapshotsProductos = await Promise.all(areasConocidas.map(function(area) {
                        return docRef.collection('stockAreas').doc(area).collection('productos').get();
                    }));
                    let huboDatosNuevos = false;
                    snapshotsProductos.forEach(function(snap, idx) {
                        const areaKey = areasConocidas[idx];
                        snap.forEach(function(doc) {
                            huboDatosNuevos = true;
                            const d = doc.data();
                            const prodId = doc.id;
                            if (!rawConteo[prodId]) rawConteo[prodId] = {};
                            rawConteo[prodId][areaKey] = { enteras: d.enteras, abiertas: d.abiertas };
                            _versionesConteoProducto[_claveVersionProducto(prodId, areaKey)] = d.version || 0;
                        });
                    });

                    if (!huboDatosNuevos && data._conteoInSubcol) {
                        // Nivel 2 — esquema anterior (documento único por área)
                        // R6: se leen las areas definidas, no tres fijas.
                        const _areasLegacy = AREAS_CONTEO.slice();
                        const _snapsLegacy = await Promise.all(_areasLegacy.map(function(a) {
                            return docRef.collection('stockAreas').doc(a).get();
                        }));
                        const mergeArea = (snap, areaKey) => {
                            if (!snap.exists) return;
                            const areaData = snap.data();
                            Object.keys(areaData).forEach(prodId => {
                                if (prodId.startsWith('_')) return; // saltar metadatos
                                if (!rawConteo[prodId]) rawConteo[prodId] = {};
                                rawConteo[prodId][areaKey] = areaData[prodId];
                            });
                        };
                        _snapsLegacy.forEach(function(snap, i) { mergeArea(snap, _areasLegacy[i]); });
                    }
                }
                if (Object.keys(rawConteo).length === 0) {
                    // Nivel 3 — compatibilidad con documentos muy anteriores
                    rawConteo = data.inventarioConteo || {};
                }
                const migrated  = {};
                Object.keys(rawConteo).forEach(prodId => {
                    const val = rawConteo[prodId];
                    if (!val || typeof val !== 'object') return;
                    if (typeof val.enteras !== 'undefined' &&
                        val.almacen === undefined && val.barra1 === undefined && val.barra2 === undefined) {
                        migrated[prodId] = { almacen: val };
                    } else {
                        migrated[prodId] = val;
                    }
                });
                // ── D · Preservar lo que todavía no se ha confirmado ──────────
                // Antes esta línea era `inventarioConteo = migrated;` a secas:
                // un reemplazo completo por lo que dice la nube. Si el
                // bartender contaba sin señal y otro aparato sincronizaba
                // entretanto, al reconectar este reemplazo borraba el conteo
                // local antes de que nadie hubiera intentado subirlo. El aviso
                // decía "Guardado en el dispositivo" y el dato desaparecía.
                //
                // Ahora los conteos anotados como pendientes sobreviven a la
                // bajada. No es preferir lo local por gusto: es que ese valor
                // aún no ha tenido su oportunidad de llegar al servidor, y
                // quien decide si entra o choca con otro es
                // syncConteoProductoAtomico con la versión real en la mano
                // (drenarConteosPendientes lo llama justo después).
                inventarioConteo = _preservarConteosPendientes(migrated, inventarioConteo);

                // Actualizar stockByArea desde conteo
                syncStockByAreaFromConteo();

                // FIX #1 — ANTI-BUCLE DE SINCRONIZACIÓN
                // _applyCloudData aplica datos de la nube → escribe localStorage.
                // saveToLocalStorage detecta el hash cambiado y dispararía syncToCloud de nuevo,
                // creando un ciclo infinito descarga→subida→descarga.
                // Solución: actualizar el hash y limpiar _cloudSyncPending ANTES de guardar,
                // así saveToLocalStorage ve que no hay cambios reales y no lanza syncToCloud.
                _lastDataHash = _computeDataHash();
                _cloudSyncPending = false;

                // FIX 8: pasar skipSyncTrigger:true para evitar el loop cloud→save→sync→cloud
                saveToLocalStorage({ skipSyncTrigger: true });
                if (data._lastModified) {
                    localStorage.setItem('inventarioApp_lastModified', String(data._lastModified));
                }
                if (data._auditoriaSessionId) {
                    localStorage.setItem('inventarioApp_auditoriaSessionId', data._auditoriaSessionId);
                }

                _lastCloudSync = Date.now();
                _cloudSyncPending = false;
                updateCloudSyncBadge('ok');
                renderTab();

            } catch (err) {
                console.error('[Firebase] Error al aplicar datos de la nube:', err);
                updateCloudSyncBadge('error');
            } finally {
                // FIX 7: Siempre liberar el guard, incluso si hay error
                _applyingCloudData = false;
            }
        }

        /**
         * updateCloudSyncBadge(status)
         * ─────────────────────────────
         * Actualiza el indicador visual de estado de sincronización.
         * status: 'ok' | 'syncing' | 'pending' | 'error' | 'offline'
         */
        function updateCloudSyncBadge(status) {
            const badge = document.getElementById('cloudSyncBadge');
            const dot   = document.getElementById('syncDot');

            const cfg = {
                ok:      { bg: '#06d6a0', icon: '☁️', text: 'Sincronizado',   pulse: false, dotState: 'ok',      dotTitle: 'Sincronizado ✓' },
                syncing: { bg: '#4cc9f0', icon: '🔄', text: 'Sincronizando…', pulse: true,  dotState: 'syncing', dotTitle: 'Subiendo datos…' },
                pending: { bg: '#ffd166', icon: '⏳', text: 'Pendiente',       pulse: false, dotState: 'pending', dotTitle: 'Cambios pendientes' },
                error:   { bg: '#ff6b6b', icon: '⚠️', text: 'Error sync',     pulse: false, dotState: 'error',   dotTitle: 'Error de sincronización' },
                offline: { bg: '#8b8ca8', icon: '📴', text: 'Sin conexión',   pulse: false, dotState: 'offline', dotTitle: 'Sin conexión' },
                none:    { bg: '#50516a', icon: '☁️', text: 'Sin Firebase',   pulse: false, dotState: 'none',    dotTitle: 'Sin Firebase' }
            };

            if (!_db) { status = 'none'; }
            const c = cfg[status] || cfg.none;

            // ── Conteo de cambios pendientes en la cola ──────────────────────
            const pendingCount = _getPendingSyncCount();
            let textLabel = c.text;
            if (status === 'pending' && pendingCount > 0) {
                textLabel = pendingCount + ' cambio' + (pendingCount !== 1 ? 's' : '') + ' pendiente' + (pendingCount !== 1 ? 's' : '');
            }

            // ── Tiempo de última sincronización exitosa ───────────────────────
            let lastSyncStr = '';
            if (status === 'ok' && _lastCloudSync > 0) {
                lastSyncStr = ' · ' + new Date(_lastCloudSync).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
            }

            // ── Badge del sidebar ────────────────────────────────────────
            if (badge) {
                badge.style.background   = c.bg + '22';
                badge.style.borderColor  = c.bg + '66';
                badge.style.color        = c.bg;
                badge.innerHTML = '<span style="margin-right:4px">' + c.icon + '</span>' +
                    textLabel + lastSyncStr +
                    (status !== 'none' && status !== 'syncing' ?
                        ' <button onclick="syncToCloud()" title="Sincronizar ahora" style="margin-left:6px;background:transparent;border:1px solid currentColor;border-radius:4px;padding:1px 5px;cursor:pointer;font-size:0.7rem;color:inherit;opacity:0.75" aria-label="Sincronizar ahora">↑</button>' : '');
                badge.style.animation    = c.pulse ? 'pulse 1.5s ease-in-out infinite' : 'none';
            }

            // ── Semáforo en el header (círculo verde/amarillo/rojo) ──────
            if (dot) {
                dot.setAttribute('data-state', c.dotState);
                dot.setAttribute('title',
                    c.dotTitle +
                    (pendingCount > 0 ? ' — ' + pendingCount + ' pendiente(s)' : '') +
                    (_lastCloudSync > 0 ? ' — Última sync: ' + new Date(_lastCloudSync).toLocaleTimeString('es-MX') : ''));
                dot.setAttribute('aria-label', 'Sync: ' + c.dotTitle);
            }
        }

        // BUG-FIX m3: updateNetworkStatus definida a nivel global
