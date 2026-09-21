        let isAuditoriaMode = false;

        // ══════════════════════════════════════════════════════════════════════
        //  AUDITORÍA AISLADA POR USUARIO — cada usuario guarda SU propio conteo.
        //  Admin ve todos; usuarios solo ven el propio.
        // ══════════════════════════════════════════════════════════════════════
        let myAuditoriaConteo  = {};   // conteo propio (aislado)
        let myAuditoriaStatus  = estadoAreasVacio('pendiente');
        let myAuditoriaUnlocks = {};   // { 'prodId__area': { unlockedBy, unlockedAt, used } }
        // D — rastro de finalización de área: { area: { uid, nombre, ts, rol } }.
        // myAuditoriaStatus solo guarda la palabra 'completada', que no dice
        // quién la cerró ni cuándo. Esto lo acompaña sin sustituirlo, para no
        // tocar a los diez sitios que ya leen ese estado.
        let myAuditoriaFinalizadas = {};
        let allUsersAuditoria  = {};   // admin: { uid: { email, status, conteo, updatedAt } }
        let _auditoriaSessionId = null;

        // ETAPA 15 — INVENTARIO FÍSICO. inventoryId === _auditoriaSessionId
        // (mismo identificador — ver informe). _inventarioActivo es la
        // representación en memoria del documento inventories/{id}, mantenida
        // en tiempo real por _suscribirInventarioActivo(); nunca se escribe a
        // mano fuera de esa función y de las que ejecutan una acción concreta
        // (crear/cerrar/reabrir).
        let _inventarioActivo    = null;  // { numero, estado, fechaCreacion, creadoPorNombre, creadoPorRol, ... } | null
        let _unsubInventarioActivo = null;
        let _inventarioActivoId    = null; // qué inventoryId está siendo escuchado ahora mismo
        let _unsubMyAuditoria  = null;
        let _unsubAllUsers     = null;

        // ═════════════════════════════════════════════════════════════════════
        //  ESTADO MULTIUSUARIO
        //  auditCurrentUser         — identidad del dispositivo actual
        //  auditoriaConteoPorUsuario — todos los conteos, sin sobreescribir
        //  AUDIT_TOLERANCE          — diferencia máxima considerada OK
        // ═════════════════════════════════════════════════════════════════════
        /**
         * auditCurrentUser: { userId: string, userName: string, createdAt: number }
         * Se genera una sola vez por dispositivo y persiste en localStorage.
         *
         * auditoriaConteoPorUsuario:
         *   { productId: { area: { userId: { userId, userName, enteras, abiertas, ts } } } }
         *   Estructura aditiva — cada dispositivo escribe SOLO su propia clave userId,
         *   nunca toca los datos de otros usuarios.
         *
         * AUDIT_TOLERANCE: si |max - min| > tolerance y hay ≥ 2 usuarios → ERROR.
         */
        let auditCurrentUser          = null;
        let auditoriaConteoPorUsuario  = {};
        const AUDIT_TOLERANCE         = 0.2;  // botellas; ajustable según necesidad

        // ── Estado de sincronización con la nube ──────────────────────────────
        // _cloudSyncPending: true cuando hay cambios locales sin subir a Firestore
        // _lastCloudSync:    timestamp (ms) de la última sincronización exitosa
        // _syncInProgress:   semáforo para evitar escrituras concurrentes
        let _cloudSyncPending = false;
        let _lastCloudSync    = 0;
        let _syncInProgress   = false;

        // ── Hash ligero para detectar cambios reales en los datos ────────────
        // Se calcula antes y después de cada saveToLocalStorage.
        // Si el hash no cambia, NO se dispara syncToCloud.
        let _lastDataHash = '';

        function _computeDataHash() {
            // CORRECCIÓN 6 + FIX-2: Throttle del hash + cobertura completa del catálogo.
            // ──────────────────────────────────────────────────────────────────────────
            // BUG ORIGINAL: para catálogos > 100 productos, el hash usaba solo los
            // primeros 20 + el total. Un cambio en el producto 50 (ej. renombrar
            // "Vodka Ruso" → "Vodka Premium") NO cambiaba el hash → nunca se sincronizaba.
            //
            // FIX: Para catálogos grandes, se genera una "huella compacta" de TODOS los
            // productos usando solo id+name+unit (mucho más ligero que JSON.stringify completo
            // pero detecta cualquier adición, renombrado, eliminación o cambio de unidad).
            // El inventarioConteo sigue serializándose completo (es el dato más crítico
            // y generalmente es el más pequeño: solo tiene productos con conteo activo).
            const now = Date.now();
            // FIX-5: Throttle reducido 300ms → 50ms para no perder syncs en conteos rápidos
    if (_computeDataHash._lastTs && (now - _computeDataHash._lastTs) < 50) {
                return _computeDataHash._lastResult || '';
            }
            _computeDataHash._lastTs = now;
            try {
                // FIX-2: huella de productos cubre TODO el catálogo sin serialización completa.
                // id+name+unit captura: altas, bajas, renombres, cambios de unidad.
                // Para >100 productos esto es ~5× más rápido que JSON.stringify y
                // cubre el 100% de las propiedades críticas del catálogo.
                const prodFingerprint = products.length > 100
                    ? products.map(function(p) {
                          return (p.id || '') + '|' + (p.name || '') + '|' + (p.unit || '') + '|' + (p.group || '');
                      }).join('§')  // § evita colisiones con valores que contengan |
                    : JSON.stringify(products);

                const result = prodFingerprint +
                               JSON.stringify(orders) +
                               JSON.stringify(inventories) +
                               JSON.stringify(inventarioConteo);
                _computeDataHash._lastResult = result;
                return result;
            } catch (_) { return ''; }
        }
        _computeDataHash._lastTs     = 0;
        _computeDataHash._lastResult = '';

        // ── Registro de errores de sincronización (CORRECCIÓN 7) ──────────────
        // Los errores se acumulan en memoria y LS para diagnóstico.
        // Máximo 50 entradas para no crecer indefinidamente.
        let _syncErrorLog = [];

        function _logSyncError(tipo, mensaje, detalle) {
            const entry = {
                ts:      Date.now(),
                tipo:    tipo,
                mensaje: mensaje,
                detalle: String(detalle || '').slice(0, 500) // truncar para no crecer
            };
            _syncErrorLog.push(entry);
            if (_syncErrorLog.length > 50) _syncErrorLog = _syncErrorLog.slice(-50);
            try {
                localStorage.setItem('inventarioApp_syncErrorLog', JSON.stringify(_syncErrorLog));
            } catch(_) {}
            console.error('[SyncError] ' + tipo + ':', mensaje, detalle);
        }

        /**
         * verErroresSync()
         * Muestra el log de errores de sincronización en consola.
         * Accesible desde consola: verErroresSync()
         */
        function verErroresSync() {
            let log = [];
            try {
                const raw = localStorage.getItem('inventarioApp_syncErrorLog');
                log = raw ? JSON.parse(raw) : [];
            } catch(_) {}
            if (log.length === 0) { console.info('[SyncErrors] Sin errores de sync ✓'); return []; }
            console.group('[SyncErrors] ' + log.length + ' error(es) registrado(s)');
            console.table(log.map(function(e) {
                return { Fecha: new Date(e.ts).toLocaleString('es-MX'), Tipo: e.tipo, Mensaje: e.mensaje };
            }));
            console.groupEnd();
            return log;
        }
        window.verErroresSync = verErroresSync;

        const areas = {
            almacen: 'Almacén',
            barra1: 'Barra 1',
            barra2: 'Barra 2'
        };

        // Nombres de área para la Auditoría Física Ciega (corporativos)
        const areasAuditoria = {
            almacen: 'Almacén',
            barra1:  'Barra Restaurante',
            barra2:  'Barra Bar'
        };
        const areasAuditoriaIcons = {
            almacen: '📦',
            barra1:  '🍽️',
            barra2:  '🍸'
        };
        // Iconos FontAwesome 6 (complemento visual corporativo)
        const areasAuditoriaFA = {
            almacen: 'fa-solid fa-warehouse',
            barra1:  'fa-solid fa-utensils',
            barra2:  'fa-solid fa-martini-glass'
        };

        // ═════════════════════════════════════════════════════════════════════
        //  MULTIUSUARIO — Identidad, estadísticas, render y sincronización
        // ═════════════════════════════════════════════════════════════════════

        /**
         * initAuditUser()
         * ─────────────────
         * Genera o recupera la identidad única de ESTE dispositivo.
         * La clave localStorage 'inventarioApp_auditUser' persiste entre sesiones.
         * Nunca sobreescribe un userId ya asignado → mismo ID de por vida.
         */
        function initAuditUser() {
            try {
                const raw = localStorage.getItem('inventarioApp_auditUser');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && parsed.userId) {
                        auditCurrentUser = parsed;
                        console.info('[MultiUser] Identidad recuperada:', parsed.userName, '(' + parsed.userId.slice(0,16) + '…)');
                        return;
                    }
                }
            } catch (_) {}
            // Primera vez en este dispositivo: crear identidad única
            const uid   = 'usr-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
            const uName = 'Contador-' + Math.random().toString(36).substr(2, 4).toUpperCase();
            auditCurrentUser = { userId: uid, userName: uName, createdAt: Date.now() };
            try {
                localStorage.setItem('inventarioApp_auditUser', JSON.stringify(auditCurrentUser));
            } catch (_) {}
            console.info('[MultiUser] Nueva identidad creada:', auditCurrentUser.userName, '(' + uid.slice(0, 16) + '…)');
        }

        /**
         * setAuditUserName(newName)
         * ──────────────────────────
         * Permite al operador personalizar su nombre de usuario en la UI.
         * Actualiza auditCurrentUser.userName y lo persiste en localStorage.
         * Cierra el panel de renombrado inline automáticamente.
         */
        function setAuditUserName(newName) {
            if (!newName || !newName.trim()) {
                showNotification('⚠️ El nombre no puede estar vacío');
                return;
            }
            if (!auditCurrentUser) initAuditUser();
            auditCurrentUser.userName = newName.trim().slice(0, 32); // máx 32 chars
            try {
                localStorage.setItem('inventarioApp_auditUser', JSON.stringify(auditCurrentUser));
            } catch (_) {}
            // Cerrar panel inline
            const panel = document.getElementById('auditRenameInline');
            if (panel) panel.classList.remove('visible');
            showNotification('✅ Nombre actualizado: ' + auditCurrentUser.userName);
            renderTab();
        }

        /**
         * toggleAuditRename()
         * ─────────────────────
         * Muestra u oculta el formulario inline para cambiar el nombre de usuario.
         * Pre-rellena el input con el nombre actual y mueve el foco al campo.
         */
        function toggleAuditRename() {
            const panel = document.getElementById('auditRenameInline');
            if (!panel) return;
            const opening = !panel.classList.contains('visible');
            panel.classList.toggle('visible', opening);
            if (opening) {
                const inp = document.getElementById('auditRenameInput');
                if (inp) {
                    inp.value = auditCurrentUser ? auditCurrentUser.userName : '';
                    setTimeout(function() { inp.focus(); }, 60);
                }
            }
        }

        /**
         * auditSaveName()
         * ──────────────────
         * Helper que lee el valor del input de renombrado y llama a setAuditUserName.
         * FIX-01: Evita comillas anidadas en atributos onclick/onkeydown del HTML generado.
         */
        function auditSaveName() {
            const inp = document.getElementById('auditRenameInput');
            if (inp) setAuditUserName(inp.value);
        }

        /**
         * calcAuditStats(productId, area)
         * ──────────────────────────────────
         * Calcula estadísticas de multi-conteo para un producto y área dados.
         *
         * @returns null si no hay conteos, o un objeto:
         *   {
         *     totals:      Array<{ userId, userName, ts, enteras, totalAbiertas, total }>,
         *     sum:         number,  // suma de todos los totales
         *     avg:         number,  // promedio
         *     min:         number,
         *     max:         number,
         *     diff:        number,  // max - min
         *     hasConflict: boolean, // diff > AUDIT_TOLERANCE y count >= 2
         *     count:       number   // número de usuarios que contaron
         *   }
         */
        function calcAuditStats(productId, area) {
            const byArea   = auditoriaConteoPorUsuario[productId] && auditoriaConteoPorUsuario[productId][area];
            const entries  = byArea ? Object.values(byArea) : [];
            if (entries.length === 0) return null;

            const totals = entries.map(function(u) {
                const enteras     = typeof u.enteras === 'number' ? u.enteras : 0;
                const sumAbiertas = Array.isArray(u.abiertas)
                    ? u.abiertas.reduce(function(s, v) { return s + (typeof v === 'number' ? v : 0); }, 0)
                    : 0;
                return {
                    userId:        u.userId,
                    userName:      u.userName || u.userId,
                    ts:            u.ts || 0,
                    enteras:       enteras,
                    totalAbiertas: Math.round(sumAbiertas * 1000) / 1000,
                    total:         Math.round((enteras + sumAbiertas) * 10000) / 10000
                };
            });

            // Orden cronológico (quién contó primero)
            totals.sort(function(a, b) { return a.ts - b.ts; });

            const vals = totals.map(function(t) { return t.total; }); // FIX-07
            const sum  = Math.round(vals.reduce(function(a, b) { return a + b; }, 0) * 10000) / 10000;
            const avg  = Math.round((sum / vals.length) * 10000) / 10000; // FIX-07
            const min  = Math.min.apply(null, vals);
            const max  = Math.max.apply(null, vals);
            const diff = Math.round((max - min) * 10000) / 10000;

            return {
                totals:      totals,
                sum:         sum,
                avg:         avg,
                min:         min,
                max:         max,
                diff:        diff,
                hasConflict: vals.length >= 2 && diff > AUDIT_TOLERANCE,
                count:       vals.length
            };
        }

        /**
         * formatAuditTs(ts)
         * ──────────────────
         * Convierte un timestamp en milisegundos a "HH:MM" legible.
         * Usado en el trail de auditoría de cada tarjeta de producto.
         */
        function formatAuditTs(ts) {
            if (!ts) return '';
            try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
            catch (_) { return ''; }
        }

        /**
         * renderAuditTrailForProduct(productId, area)
         * ─────────────────────────────────────────────
         * Genera el HTML del panel de trazabilidad que aparece debajo de cada
         * tarjeta de producto en la pantalla de conteo de auditoría.
         *
         * Muestra: quién contó, cuánto contó, a qué hora, estadísticas y estado OK/ERROR.
         *
         * FIX #3 — CONTEO CIEGO: El trail multiusuario (quién contó qué cantidad)
         * solo se muestra cuando:
         *  a) El usuario es administrador, O
         *  b) El área ya está marcada como "completada" por este bartender
         *      (ya terminó su propio conteo, por lo que ver el de otros no sesga su resultado).
         * Mientras el bartender está contando activamente, el trail permanece oculto
         * para garantizar la independencia del conteo ciego.
         */
        function renderAuditTrailForProduct(productId, area) {
            // BUG-H8 FIX: usar myAuditoriaStatus para usuarios (estado propio del bartender),
            // no auditoriaStatus que es el estado global del admin.
            // Un bartender que finalizó su área debe ver el trail aunque el admin no la haya cerrado globalmente.
            const areaCompletada = isAdmin()
                ? (auditoriaStatus[area] === 'completada')
                : (myAuditoriaStatus[area] === 'completada');
            if (!isAdmin() && !areaCompletada) return '';

            const stats = calcAuditStats(productId, area); // FIX-07
            if (!stats || stats.count === 0) return '';
            const myId  = auditCurrentUser ? auditCurrentUser.userId : null;

            let html = '<div class="audit-trail">'; // FIX-07

            // Cabecera: número de conteos + badge de estado
            html += '<div class="audit-trail-header">';
            html += '<span>' + stats.count + ' conteo' + (stats.count !== 1 ? 's' : '') + ' registrado' + (stats.count !== 1 ? 's' : '') + '</span>';
            if (stats.count >= 2) {
                const badgeCls = stats.hasConflict ? 'error' : 'ok'; // FIX-07
                const badgeLbl = stats.hasConflict
                    ? '⚠️ DIFERENCIA (' + stats.diff.toFixed(2) + ')'
                    : '✓ OK';
                html += '<span class="audit-status-badge ' + badgeCls + '">' + badgeLbl + '</span>';
            }
            html += '</div>';

            // Fila por usuario
            stats.totals.forEach(function(entry) {
                const isMe    = myId && entry.userId === myId; // FIX-07
                const meCls   = isMe ? ' is-me' : '';
                const meTxt = isMe ? ' <em style="opacity:.5;font-size:.58rem;font-style:normal">(tú)</em>' : ''; // FIX-02
                html += '<div class="audit-trail-entry' + meCls + '">';
                html += '<span class="audit-entry-name">' + escapeHtml(entry.userName) + meTxt + '</span>';
                html += '<span class="audit-entry-count">'
                      + entry.enteras + ' ent + '
                      + entry.totalAbiertas.toFixed(2) + ' ab = <strong>'
                      + entry.total.toFixed(2) + '</strong></span>';
                html += '<span class="audit-entry-ts">' + formatAuditTs(entry.ts) + '</span>';
                html += '</div>';
            });

            // Fila de estadísticas (solo si hay ≥ 2 conteos)
            if (stats.count >= 2) {
                const diffColor = stats.hasConflict ? 'var(--red-text)' : 'var(--green-text)'; // FIX-07
                html += '<div class="audit-stats-row">';
                html += '<span>Σ ' + stats.sum.toFixed(2)  + '</span>';
                html += '<span>μ '  + stats.avg.toFixed(2)  + '</span>';
                html += '<span>min ' + stats.min.toFixed(2)  + '</span>';
                html += '<span>max ' + stats.max.toFixed(2)  + '</span>';
                html += '<span style="color:' + diffColor + '">Δ ' + stats.diff.toFixed(2) + '</span>';
                html += '</div>';
            }

            html += '</div>'; // .audit-trail
            return html;
        }

        /**
         * renderAuditUserPanel()
         * ───────────────────────
         * Genera el HTML del panel de identidad del dispositivo actual.
         * Incluye avatar con iniciales, nombre, ID corto y botón para renombrar.
         * También incluye el formulario inline de renombrado (oculto por defecto).
         */
        function renderAuditUserPanel() {
            const user     = auditCurrentUser || { userName: '—', userId: '?' }; // FIX-07
            const initials = user.userName.slice(0, 2).toUpperCase();
            let html       = '';

            // Formulario inline (oculto hasta que el usuario pulse "Cambiar nombre")
            // FIX-01: Se usa función helper auditSaveName() para evitar comillas anidadas
            html += '<div id="auditRenameInline" class="audit-rename-inline">';
            html += '<p style="font-size:0.68rem;color:var(--txt-muted);margin-bottom:0;">Nuevo nombre de usuario (máx. 32 caracteres)</p>';
            html += '<div class="audit-rename-row">';
            html += '<input id="auditRenameInput" class="audit-rename-input" type="text" maxlength="32"'
                  + ' placeholder="Tu nombre..."'
                  + ' onkeydown="if(event.key===\"Enter\"){event.preventDefault();auditSaveName();}">';
            html += '<button onclick="auditSaveName()"'
                  + ' style="padding:6px 12px;background:var(--accent);color:#fff;border-radius:var(--r-sm);font-size:.75rem;font-weight:600;cursor:pointer;min-height:auto;">Guardar</button>';
            html += '<button onclick="toggleAuditRename()"'
                  + ' style="padding:6px 10px;background:var(--surface);border:1px solid var(--border-mid);border-radius:var(--r-sm);color:var(--txt-secondary);font-size:.75rem;cursor:pointer;min-height:auto;">Cancelar</button>';
            html += '</div>';
            html += '</div>'; // #auditRenameInline

            // Tarjeta de identidad
            html += '<div class="audit-user-panel">';
            html += '<div class="audit-user-avatar">' + escapeHtml(initials) + '</div>';
            html += '<div class="audit-user-info">';
            html += '<div class="audit-user-label">Dispositivo actual</div>';
            html += '<div class="audit-user-name-text">' + escapeHtml(user.userName) + '</div>';
            const displayId = user.userId.length > 22
                ? user.userId.slice(0, 22) + '…'
                : user.userId;
            html += '<div class="audit-user-id-text">' + escapeHtml(displayId) + '</div>';
            html += '</div>';
            html += '<button class="audit-rename-btn" onclick="toggleAuditRename()">'
                  + '<i class="fa-solid fa-pen" style="font-size:.65rem;margin-right:4px;"></i>'
                  + 'Cambiar nombre</button>';
            html += '</div>'; // .audit-user-panel
            return html;
        }

        /**
         * renderAuditComparePanel()
         * ──────────────────────────
         * Genera el HTML del panel de comparación de conteos por área.
         * Muestra cuántos dispositivos contaron cada área y si existen diferencias.
         * Solo se renderiza si hay al menos un conteo registrado.
         */
        function renderAuditComparePanel() {
            const areasList = AREAS_CONTEO; // FIX-07
            const areaInfo  = areasList.map(function(area) {
                const userIds   = new Set();
                let   conflicts = 0;
                products.forEach(function(p) {
                    var stats = calcAuditStats(p.id, area);
                    if (stats) {
                        stats.totals.forEach(function(t) { userIds.add(t.userId); });
                        if (stats.hasConflict) conflicts++;
                    }
                });
                return { area: area, userCount: userIds.size, conflicts: conflicts };
            });

            if (!areaInfo.some(function(a) { return a.userCount > 0; })) return '';

            let html = '<div class="audit-compare-panel">'; // FIX-07
            html += '<div class="audit-compare-header">'
                  + '<i class="fa-solid fa-users" style="color:var(--accent);font-size:.75rem;"></i>'
                  + 'Comparación de conteos (multi-dispositivo)'
                  + '</div>';

            areaInfo.forEach(function(info) {
                let badge; // FIX-07
                if (info.userCount === 0) {
                    badge = '<span class="audit-compare-badge pend">Sin conteos</span>';
                } else if (info.userCount < 2) {
                    badge = '<span class="audit-compare-badge pend">'
                          + info.userCount + ' usuario — necesita 1 más</span>';
                } else if (info.conflicts > 0) {
                    badge = '<span class="audit-compare-badge warn">'
                          + '⚠️ ' + info.conflicts + ' diferencia'
                          + (info.conflicts > 1 ? 's' : '') + '</span>';
                } else {
                    badge = '<span class="audit-compare-badge ok">'
                          + '✓ ' + info.userCount + ' usuarios — OK</span>';
                }

                html += '<div class="audit-compare-area-row">';
                html += '<span class="audit-compare-area-name">'
                      + areasAuditoriaIcons[info.area] + ' '
                      + escapeHtml(areasAuditoria[info.area]) + '</span>';
                html += '<span class="audit-compare-users">'
                      + info.userCount + ' conteo' + (info.userCount !== 1 ? 's' : '')
                      + '</span>';
                html += badge;
                html += '</div>';
            });

            html += '</div>'; // .audit-compare-panel
            return html;
        }

        // ─── Firebase: escritura y lectura multiusuario ──────────────────────

        /**
         * syncConteoPorUsuarioToFirestore(area)
         * ──────────────────────────────────────
         * Escribe ÚNICAMENTE el conteo del usuario actual para el área indicada
         * en la subcolección 'conteoMultiUsuario/{area}'.
         *
         * Usa set({merge:true}) → preserva los datos de TODOS los otros usuarios.
         * Estructura en Firestore:
         *   inventarioApp/{FIRESTORE_DOC_ID}/conteoMultiUsuario/{area}
         *     → { [safeUserId]: { userId, userName, ts, productos: { [prodId]: {enteras,abiertas,ts} } } }
         */
        async function syncConteoPorUsuarioToFirestore(area) {
            if (!_db || !navigator.onLine || !auditCurrentUser) return;
            const cu      = auditCurrentUser; // FIX-07
            // ── D · La clave del bloque pasa a ser el uid de Firebase ────────
            // Antes era `cu.userId`, que NO es el uid: es un identificador que
            // el propio dispositivo se inventa y guarda en localStorage
            // ('usr-<fecha>-<azar>', ver initAuditUser). Como el servidor no
            // podía relacionarlo con nadie, la regla de Firestore no tenía
            // forma de comprobar que un usuario solo tocara su propio bloque,
            // y por eso este documento estaba abierto de par en par: cualquier
            // bartender podía vaciar el conteo de todos sus compañeros.
            //
            // Con el uid como clave, la regla exige que una escritura afecte
            // únicamente al bloque de quien la hace.
            //
            // Esto no rompe los datos anteriores: quien lee
            // (loadConteoPorUsuarioFromFirestore) indexa por el `userId` de
            // DENTRO del bloque, no por la clave, así que los bloques viejos
            // se siguen leyendo igual y la misma persona no aparece dos veces.
            // El uid de Firebase ya es alfanumérico; se usa tal cual porque la
            // regla lo compara literalmente con request.auth.uid. Solo se
            // sanea el identificador de respaldo, que sí lleva guiones.
            const safeId  = currentUserUid || cu.userId.replace(/[^a-zA-Z0-9]/g, '_');
            const areaRef = _db
                .collection('inventarioApp')
                .doc(FIRESTORE_DOC_ID)
                .collection('conteoMultiUsuario')
                .doc(area);
            try {
                // BUG-1 FIX CRÍTICO: leer de myAuditoriaConteo (fuente canónica de verdad)
                // auditoriaConteoPorUsuario es el sistema antiguo y ya no recibe escrituras.
                // syncMyAuditoriaToFirestore (la función de finalización) ya usa myAuditoriaConteo
                // correctamente. Esta función debe ser consistente.
                const conteoFuenteUsuario = myAuditoriaConteo;
                const productos = {};
                products.forEach(function(p) {
                    const areaData = conteoFuenteUsuario[p.id] && conteoFuenteUsuario[p.id][area];
                    if (areaData && (areaData.enteras > 0 || (areaData.abiertas || []).some(v => v > 0))) {
                        productos[p.id] = {
                            enteras:  areaData.enteras  || 0,
                            abiertas: areaData.abiertas || [],
                            ts:       areaData._ts || Date.now()
                        };
                    }
                });

                if (Object.keys(productos).length === 0) {
                    console.info('[MultiUser] Sin conteos para sincronizar en área', area);
                    return;
                }

                const payload    = {}; // FIX-07
                payload[safeId] = {
                    userId:   cu.userId,
                    userName: cu.userName,
                    // D — autoría verificable: es el uid que la regla compara
                    // contra request.auth.uid. `userId` se conserva porque es
                    // lo que usa el lector y lo que llevan los datos viejos.
                    uid:      currentUserUid || null,
                    ts:       Date.now(),
                    productos: productos
                };

                // merge:true → preserva campos de otros usuarios en el mismo documento
                await areaRef.set(payload, { merge: true });
                console.info('[MultiUser] Conteo "' + cu.userName + '" → área "' + area + '" sincronizado ✓');

            } catch (err) {
                console.warn('[MultiUser] Error al sincronizar conteo:', err);
            }
        }

        /**
         * loadConteoPorUsuarioFromFirestore()
         * ──────────────────────────────────────
         * Descarga los conteos de TODOS los dispositivos desde la subcolección
         * 'conteoMultiUsuario' y los fusiona con los datos locales.
         *
         * Estrategia de fusión: por cada (producto, área, usuario) gana el conteo
         * con timestamp más alto — "último-gana por usuario".
         * Nunca elimina conteos de otros usuarios.
         */