/**
 * js/auth-roles.js — v1.2 (CORREGIDO)
 * ══════════════════════════════════════════════════════════════
 * Módulo de Control de Acceso Basado en Roles (RBAC)
 *
 * CORRECCIONES v1.2:
 * • Guard _creatingProfile evita loops de creación duplicada
 * • Guard _listenersStarted evita duplicar listeners
 * • Guard _initInProgress evita llamadas simultáneas
 * • _sanitizeRole() valida roles contra whitelist
 * • _safeRender() con retry limitado (1 solo retry)
 * • cleanupRoles() es la ÚNICA función que detiene listeners
 *   (auth.js ya no llama stopRealtimeListeners directamente)
 * • Guard contra logout durante initRoles en progreso
 * • data-role="anonymous" consistente para estado sin auth
 *
 * FLUJO:
 *   initRoles(user)
 *     ├─ GET /usuarios/{uid}
 *     │   ├─ Existe  → aplicar rol → startListeners → resolve
 *     │   └─ !Existe → crear perfil → onSnapshot re-dispara
 *     └─ Listener tiempo real para cambios de rol
 *
 * COLECCIÓN: /usuarios/{uid}
 *   { uid, email, displayName, role, createdAt, lastLogin }
 * ══════════════════════════════════════════════════════════════
 */

import { state }                from './state.js';
import { startRealtimeListeners,
         stopRealtimeListeners } from './sync.js';
import { showNotification }     from './ui.js';

// ─── Constantes ────────────────────────────────────────────────
const VALID_ROLES   = ['admin', 'user'];
const DEFAULT_ROLE  = 'user';
const LOG_PREFIX    = '[Roles]';

// ─── Guards internos ───────────────────────────────────────────
let _roleUnsubscribe  = null;  // Cancelar listener de /usuarios/{uid}
let _initResolved      = false; // Evita resolver Promise >1 vez
let _creatingProfile   = false; // Evita crear perfil duplicado
let _initInProgress    = false; // Evita llamadas simultáneas
let _listenersStarted  = false; // Evita duplicar startRealtimeListeners
let _currentInitUid    = null;  // UID del usuario en init actual

// ═════════════════════════════════════════════════════════════
// API PÚBLICA
// ═════════════════════════════════════════════════════════════

/**
 * initRoles(user)
 * Retorna Promise<'admin'|'user'> cuando el rol está confirmado.
 * startRealtimeListeners() se invoca UNA SOLA VEZ internamente.
 *
 * @param  {firebase.User} user
 * @returns {Promise<'admin'|'user'>}
 */
export function initRoles(user) {
    // ── Sin usuario → retorno inmediato ───────────────────────
    if (!user) {
        console.warn(`${LOG_PREFIX} initRoles llamado sin usuario.`);
        return Promise.resolve(DEFAULT_ROLE);
    }

    // ── Guard: si ya hay una init en progreso, limpiar primero ─
    if (_initInProgress) {
        console.warn(`${LOG_PREFIX} initRoles re-llamado — limpiando init anterior.`);
        _cleanupSubscription();
    }

    // ── Sin Firestore (modo desarrollo) ───────────────────────
    if (!window._db) {
        console.warn(`${LOG_PREFIX} Firestore no disponible — rol "admin" (modo dev).`);
        _applyRoleToState(user, {
            role:        'admin',
            email:       user.email,
            displayName: user.email
        });
        _safeStartListeners();
        return Promise.resolve('admin');
    }

    // ── Resetear guards para esta sesión ──────────────────────
    _initResolved    = false;
    _initInProgress  = true;
    _creatingProfile = false;
    _currentInitUid  = user.uid;

    return new Promise((resolve) => {
        const userRef = window._db.collection('usuarios').doc(user.uid);

        _roleUnsubscribe = userRef.onSnapshot(
            async (snap) => {
                // ── Guard: si el usuario cambió (logout/switch), abortar ──
                if (_currentInitUid !== user.uid) {
                    console.warn(`${LOG_PREFIX} UID cambió durante snapshot — abortando.`);
                    return;
                }

                try {
                    // ── Documento NO existe → crear perfil ────────
                    if (!snap.exists) {
                        if (_creatingProfile) {
                            console.debug(`${LOG_PREFIX} Perfil en creación — esperando...`);
                            return;
                        }

                        console.info(`${LOG_PREFIX} Primer login — creando perfil: ${user.email}`);
                        _creatingProfile = true;

                        try {
                            await _createUserProfile(user);
                            // onSnapshot volverá a disparar con el doc creado
                        } catch (createErr) {
                            console.error(`${LOG_PREFIX} Error creando perfil — fallback.`);
                            _creatingProfile = false;
                            _resolveWithFallback(user, resolve);
                        }
                        return;
                    }

                    // ── Documento EXISTE → procesar ───────────────
                    _creatingProfile = false;
                    const profile = snap.data();
                    const prevRole = state.userRole;
                    const newRole  = _sanitizeRole(profile.role);

                    _applyRoleToState(user, { ...profile, role: newRole });

                    // ── Primer disparo exitoso → resolver Promise ──
                    if (!_initResolved) {
                        _initResolved   = true;
                        _initInProgress = false;

                        // Actualizar lastLogin (async, no bloquea)
                        _updateLastLogin(user.uid).catch(() => {});

                        // Iniciar listeners de datos
                        _safeStartListeners();

                        // Re-renderizar UI con rol aplicado
                        _safeRender();

                        console.info(`${LOG_PREFIX} ✓ Sesión — ${user.email}, rol: ${newRole}`);
                        resolve(newRole);
                        return;
                    }

                    // ── Cambio de rol en tiempo real ──────────────
                    if (prevRole !== null && prevRole !== newRole) {
                        console.warn(`${LOG_PREFIX} Rol: "${prevRole}" → "${newRole}"`);

                        const label = newRole === 'admin'
                            ? '🔑 Administrador'
                            : '👤 Usuario';
                        showNotification(`ℹ️ Tu acceso cambió a: ${label}`);

                        // Reiniciar listeners con nuevos permisos
                        _safeStopListeners();
                        _safeStartListeners();
                        _safeRender();
                    }

                } catch (err) {
                    console.error(`${LOG_PREFIX} Error procesando snapshot:`, err);
                    _resolveWithFallback(user, resolve);
                }
            },
            (err) => {
                console.error(`${LOG_PREFIX} Error listener /usuarios/${user.uid}:`,
                    err.code, err.message);
                _resolveWithFallback(user, resolve);
            }
        );
    });
}

/**
 * cleanupRoles()
 * Limpia TODO: suscripción, estado, listeners, UI.
 * Es la ÚNICA función que debe llamarse desde auth.js en logout.
 */
export function cleanupRoles() {
    // 1. Cancelar suscripción de rol
    _cleanupSubscription();

    // 2. Resetear todos los guards
    _initResolved    = false;
    _initInProgress  = false;
    _creatingProfile = false;
    _currentInitUid  = null;

    // 3. Detener listeners de datos
    _safeStopListeners();

    // 4. Limpiar estado global
    state.currentUser = null;
    state.userRole    = null;
    state.userProfile = null;

    // 5. Limpiar UI
    document.documentElement.setAttribute('data-role', 'anonymous');
    _updateRoleBadge(null);

    const emailEl = document.getElementById('sbUserEmail');
    if (emailEl) emailEl.textContent = '';

    console.info(`${LOG_PREFIX} Sesión limpiada completamente.`);
}

// ═════════════════════════════════════════════════════════════
// HELPERS DE ROL (exportados)
// ═════════════════════════════════════════════════════════════

/** @returns {boolean} */
export const isAdmin = () => state.userRole === 'admin';

/** @returns {boolean} */
export const isUser  = () => state.userRole === 'admin' || state.userRole === 'user';

/**
 * @param {'products'|'orders'|'inventory'|'auditoria'} context
 * @returns {boolean}
 */
export function canWrite(context) {
    switch (context) {
        case 'products':   return state.userRole === 'admin';
        case 'orders':     return state.userRole === 'admin';
        case 'inventory':  return isUser();
        case 'auditoria':  return isUser();
        default:           return false;
    }
}

/** @returns {'admin'|'user'|null} */
export function getUserRole() {
    return state.userRole;
}

// ═════════════════════════════════════════════════════════════
// FUNCIONES PRIVADAS
// ═════════════════════════════════════════════════════════════

/**
 * Valida que el rol sea uno de los permitidos.
 * @param  {*} role
 * @returns {'admin'|'user'}
 */
function _sanitizeRole(role) {
    if (typeof role === 'string' && VALID_ROLES.includes(role.toLowerCase())) {
        return role.toLowerCase();
    }
    console.warn(`${LOG_PREFIX} Rol inválido: "${role}" → "${DEFAULT_ROLE}"`);
    return DEFAULT_ROLE;
}

/**
 * Aplica perfil al estado global y actualiza UI.
 */
function _applyRoleToState(user, profile) {
    state.currentUser = user;
    state.userRole    = profile.role || DEFAULT_ROLE;
    state.userProfile = { ...profile };

    // CSS: html[data-role="admin"] o html[data-role="user"]
    document.documentElement.setAttribute('data-role', state.userRole);

    // Sidebar: email
    const emailEl = document.getElementById('sbUserEmail');
    if (emailEl) emailEl.textContent = profile.email || user.email || '';

    // Sidebar: badge de rol
    _updateRoleBadge(state.userRole);

    console.debug(`${LOG_PREFIX} Aplicado — rol: ${state.userRole}, uid: ${user.uid.slice(0, 8)}…`);
}

/**
 * Crea perfil en /usuarios/{uid} con rol 'user' por defecto.
 */
async function _createUserProfile(user) {
    if (!window._db) return;

    const profileData = {
        uid:         user.uid,
        email:       user.email || '',
        displayName: user.displayName
                     || (user.email || '').split('@')[0]
                     || 'Usuario',
        role:        DEFAULT_ROLE,
        createdAt:   Date.now(),
        lastLogin:   Date.now(),
    };

    await window._db.collection('usuarios').doc(user.uid).set(profileData);
    console.info(`${LOG_PREFIX} Perfil creado: ${user.email}`);
}

/**
 * Actualiza lastLogin. Falla silenciosamente.
 */
async function _updateLastLogin(uid) {
    if (!window._db || !uid) return;
    try {
        await window._db.collection('usuarios').doc(uid).update({
            lastLogin: Date.now(),
        });
    } catch (err) {
        console.debug(`${LOG_PREFIX} lastLogin no actualizado:`, err.code || err.message);
    }
}

/**
 * Cancela onSnapshot sin tocar estado.
 */
function _cleanupSubscription() {
    if (_roleUnsubscribe) {
        _roleUnsubscribe();
        _roleUnsubscribe = null;
        console.debug(`${LOG_PREFIX} Listener /usuarios cancelado.`);
    }
}

/**
 * Inicia listeners de datos (solo una vez).
 */
function _safeStartListeners() {
    if (_listenersStarted) {
        console.debug(`${LOG_PREFIX} Listeners ya activos — omitiendo.`);
        return;
    }
    _listenersStarted = true;

    try {
        startRealtimeListeners();
        console.debug(`${LOG_PREFIX} Listeners de datos iniciados.`);
    } catch (err) {
        console.error(`${LOG_PREFIX} Error iniciando listeners:`, err);
        _listenersStarted = false;
    }
}

/**
 * Detiene listeners de datos (solo si están activos).
 */
function _safeStopListeners() {
    if (!_listenersStarted) return;
    _listenersStarted = false;

    try {
        stopRealtimeListeners();
        console.debug(`${LOG_PREFIX} Listeners de datos detenidos.`);
    } catch (err) {
        console.error(`${LOG_PREFIX} Error deteniendo listeners:`, err);
    }
}

/**
 * Re-renderiza UI. Un solo retry si falla.
 */
function _safeRender() {
    _doRender(false);
}

function _doRender(isRetry) {
    import('./render.js')
        .then(m => {
            if (typeof m.renderTab === 'function') {
                m.renderTab();
            } else {
                console.warn(`${LOG_PREFIX} render.js no exporta renderTab().`);
            }
        })
        .catch(err => {
            console.error(`${LOG_PREFIX} Error importando render.js:`, err);
            if (!isRetry) {
                console.debug(`${LOG_PREFIX} Reintentando render en 500ms...`);
                setTimeout(() => _doRender(true), 500);
            }
            // No más reintentos después del primero
        });
}

/**
 * Resuelve Promise con rol fallback (cuando hay errores).
 */
function _resolveWithFallback(user, resolve) {
    if (_initResolved) return;

    _initResolved   = true;
    _initInProgress = false;
    _creatingProfile = false;

    _applyRoleToState(user, {
        role:  DEFAULT_ROLE,
        email: user.email
    });
    _safeStartListeners();
    _safeRender();

    console.warn(`${LOG_PREFIX} Fallback aplicado — rol: ${DEFAULT_ROLE}`);
    resolve(DEFAULT_ROLE);
}

/**
 * Actualiza badge de rol en sidebar.
 */
function _updateRoleBadge(role) {
    const badgeEl = document.getElementById('sbRoleBadge');
    if (!badgeEl) return;

    if (!role) {
        badgeEl.style.display = 'none';
        badgeEl.textContent   = '';
        return;
    }

    badgeEl.style.display = 'inline-flex';

    if (role === 'admin') {
        badgeEl.textContent      = '🔑 Admin';
        badgeEl.style.background = 'rgba(59,130,246,0.15)';
        badgeEl.style.borderColor = 'rgba(59,130,246,0.35)';
        badgeEl.style.color      = '#93c5fd';
    } else {
        badgeEl.textContent      = '👤 Usuario';
        badgeEl.style.background = 'rgba(148,163,184,0.10)';
        badgeEl.style.borderColor = 'rgba(148,163,184,0.25)';
        badgeEl.style.color      = 'var(--txt-muted)';
    }
}

// ═════════════════════════════════════════════════════════════
// BINDINGS GLOBALES
// ═════════════════════════════════════════════════════════════
window.isAdmin     = isAdmin;
window.isUser      = isUser;
window.canWrite    = canWrite;
window.getUserRole = getUserRole;