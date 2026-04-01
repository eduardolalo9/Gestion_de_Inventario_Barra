/**
 * js/auth-roles.js
 * ══════════════════════════════════════════════════════════════
 * Módulo de Control de Acceso Basado en Roles (RBAC) — Fase 1
 *
 * RESPONSABILIDADES:
 *   1. Interceptar el login de Firebase (llamado por auth.js)
 *   2. Consultar /usuarios/{uid} para obtener el rol del usuario
 *   3. Guardar currentUser, userRole y userProfile en state.js
 *   4. Iniciar los listeners de Firestore SOLO cuando el rol esté
 *      confirmado (evita que un 'user' lea antes de tener permiso)
 *   5. Suscribirse en tiempo real a /usuarios/{uid} para que los
 *      cambios de rol surtan efecto sin necesidad de re-login
 *   6. Limpiar toda la sesión al cerrar sesión (cleanupRoles)
 *   7. Exportar helpers de rol para módulos de UI
 *
 * FLUJO DE AUTENTICACIÓN CON ROLES:
 *
 *   Firebase onAuthStateChanged(user)
 *       │
 *       ▼
 *   auth.js → initRoles(user)
 *       │
 *       ├─ GET /usuarios/{uid}  [Firestore]
 *       │       │
 *       │       ├─ Existe → state.userRole = 'admin' | 'user'
 *       │       │           applyRoleUI()
 *       │       │           startRealtimeListeners()    ← solo aquí
 *       │       │
 *       │       └─ No existe → _createUserProfile()    ← primer login
 *       │                       (onSnapshot dispara de nuevo con rol)
 *       │
 *       └─ Listener en tiempo real: rol puede cambiar sin re-login
 *
 * COLECCIÓN DE FIRESTORE:
 *   /usuarios/{uid}
 *   {
 *     uid:         string,    // Firebase UID
 *     email:       string,    // email del usuario
 *     displayName: string,    // nombre para mostrar
 *     role:        'admin' | 'user',
 *     createdAt:   number,    // timestamp ms
 *     lastLogin:   number,    // timestamp ms, actualizado en cada login
 *   }
 *
 * GLOBALS EXPUESTOS (para uso en render.js, products.js sin importar):
 *   window.isAdmin()    → boolean
 *   window.isUser()     → boolean
 *   window.getUserRole() → 'admin' | 'user' | null
 * ══════════════════════════════════════════════════════════════
 */

import { state }                        from './state.js';
import { startRealtimeListeners,
         stopRealtimeListeners }         from './sync.js';
import { showNotification }             from './ui.js';

// ─── Listener de rol en tiempo real (se cancela en cleanupRoles) ───
let _roleUnsubscribe = null;

// ─── Semáforo: evita que la Promise resuelva más de una vez ────────
let _initResolved = false;

// ═════════════════════════════════════════════════════════════
//  API PÚBLICA
// ═════════════════════════════════════════════════════════════

/**
 * initRoles(user)
 * ──────────────────────────────────────────────────────────────
 * Llamado por auth.js justo después de que Firebase confirma el login.
 * Retorna una Promise que resuelve con el rol ('admin' | 'user')
 * cuando el perfil ha sido leído (o creado si es primer login).
 *
 * GARANTÍA: startRealtimeListeners() se invoca UNA SOLA VEZ, después
 * de que el rol esté disponible. Esto asegura que las reglas de
 * Firestore se aplican antes de abrir cualquier listener.
 *
 * @param {firebase.User} user - Firebase User object
 * @returns {Promise<'admin'|'user'>}
 */
export function initRoles(user) {
    if (!user) {
        console.warn('[Roles] initRoles llamado sin usuario.');
        return Promise.resolve('user');
    }

    // Sin Firebase en modo desarrollo — asignar 'admin' por defecto
    if (!window._db) {
        console.warn('[Roles] Firestore no disponible — rol asignado como "admin" (modo dev).');
        _applyRoleToState(user, { role: 'admin', email: user.email, displayName: user.email });
        startRealtimeListeners();
        return Promise.resolve('admin');
    }

    _initResolved = false;

    return new Promise((resolve, reject) => {
        const userRef = window._db.collection('usuarios').doc(user.uid);

        // Suscripción en tiempo real al documento de rol.
        // onSnapshot dispara inmediatamente con el estado actual
        // y cada vez que el documento cambie.
        _roleUnsubscribe = userRef.onSnapshot(
            async (snap) => {
                try {
                    if (!snap.exists) {
                        // ── PRIMER LOGIN: crear perfil con rol 'user' ─────
                        // onSnapshot volverá a disparar con el documento creado.
                        console.info('[Roles] Primer login — creando perfil para:', user.email);
                        await _createUserProfile(user);
                        // No resolver la Promise aquí; se resuelve cuando
                        // onSnapshot dispara de nuevo con el documento creado.
                        return;
                    }

                    const profile = snap.data();
                    const prevRole = state.userRole;
                    const newRole  = profile.role || 'user';

                    _applyRoleToState(user, profile);

                    // ── Primer disparo: iniciar listeners y resolver ──────
                    if (!_initResolved) {
                        _initResolved = true;

                        // Actualizar lastLogin de forma asíncrona (no bloquea)
                        _updateLastLogin(user.uid).catch(() => {});

                        // Solo ahora iniciamos los listeners (rol confirmado)
                        startRealtimeListeners();

                        // Re-renderizar UI con el rol confirmado (controles admin/user visibles)
                        import('./render.js')
                            .then(m => m.renderTab())
                            .catch(e => console.error('[Roles] Error al re-renderizar tras login:', e));

                        console.info(`[Roles] ✓ Sesión iniciada — usuario: ${user.email}, rol: ${newRole}`);
                        resolve(newRole);
                        return;
                    }

                    // ── Cambio de rol en tiempo real ─────────────────────
                    if (prevRole !== null && prevRole !== newRole) {
                        console.warn(`[Roles] Rol actualizado en tiempo real: "${prevRole}" → "${newRole}"`);

                        const label = newRole === 'admin' ? '🔑 Administrador' : '👤 Usuario';
                        showNotification(`ℹ️ Tu nivel de acceso cambió a: ${label}`);

                        // Reiniciar listeners con los permisos del nuevo rol
                        stopRealtimeListeners();
                        startRealtimeListeners();

                        // Re-renderizar UI para mostrar/ocultar controles
                        import('./render.js')
                            .then(m => m.renderTab())
                            .catch(e => console.error('[Roles] Error al re-renderizar:', e));
                    }

                } catch (err) {
                    console.error('[Roles] Error al procesar snapshot de rol:', err);
                    if (!_initResolved) {
                        _initResolved = true;
                        // Fallback seguro: asignar 'user' y continuar
                        _applyRoleToState(user, { role: 'user', email: user.email });
                        startRealtimeListeners();
                        resolve('user');
                    }
                }
            },
            (err) => {
                console.error('[Roles] Error en listener de /usuarios/{uid}:', err.code, err.message);
                if (!_initResolved) {
                    _initResolved = true;
                    // Fallback en caso de error de permisos (reglas Firestore aún no publicadas)
                    _applyRoleToState(user, { role: 'user', email: user.email });
                    startRealtimeListeners();
                    // No rechazar la Promise — la app debe seguir funcionando
                    resolve('user');
                }
            }
        );
    });
}

/**
 * cleanupRoles()
 * ──────────────────────────────────────────────────────────────
 * Limpia todo el estado de rol y cancela el listener de /usuarios/{uid}.
 * Debe llamarse al cerrar sesión (auth.js → onAuthStateChanged).
 */
export function cleanupRoles() {
    if (_roleUnsubscribe) {
        _roleUnsubscribe();
        _roleUnsubscribe = null;
        console.info('[Roles] Listener de /usuarios/{uid} cancelado.');
    }

    _initResolved          = false;
    state.currentUser      = null;
    state.userRole         = null;
    state.userProfile      = null;

    // Limpiar atributo data-role del HTML (vuelve a estado anónimo)
    document.documentElement.removeAttribute('data-role');

    // Limpiar badge de rol en el sidebar
    _updateRoleBadge(null);

    console.info('[Roles] Estado de rol limpiado.');
}

// ═════════════════════════════════════════════════════════════
//  HELPERS DE ROL — exportados para uso en otros módulos
// ═════════════════════════════════════════════════════════════

/** @returns {boolean} true si el usuario autenticado es administrador */
export const isAdmin = () => state.userRole === 'admin';

/** @returns {boolean} true si el usuario tiene cualquier rol válido */
export const isUser  = () => state.userRole === 'admin' || state.userRole === 'user';

/**
 * canWrite(context)
 * Verifica si el usuario actual puede realizar una escritura específica.
 *
 * @param {'products'|'orders'|'inventory'|'auditoria'} context
 * @returns {boolean}
 */
export function canWrite(context) {
    switch (context) {
        case 'products': // Catálogo de productos — solo admin
            return state.userRole === 'admin';
        case 'orders':   // Crear pedidos — solo admin
            return state.userRole === 'admin';
        case 'inventory': // Conteo de inventario — ambos roles
            return isUser();
        case 'auditoria': // Auditoría ciega — ambos roles
            return isUser();
        default:
            return false;
    }
}

// ═════════════════════════════════════════════════════════════
//  FUNCIONES PRIVADAS
// ═════════════════════════════════════════════════════════════

/**
 * Aplica los datos del perfil al estado global y actualiza la UI.
 */
function _applyRoleToState(user, profile) {
    state.currentUser  = user;
    state.userRole     = profile.role || 'user';
    state.userProfile  = { ...profile };

    // ── Atributo data-role en <html> (control de visibilidad CSS) ─
    // Ej: html[data-role="user"] .admin-only { display: none }
    document.documentElement.setAttribute('data-role', state.userRole);

    // ── Actualizar sidebar ─────────────────────────────────────────
    const emailEl = document.getElementById('sbUserEmail');
    if (emailEl) emailEl.textContent = profile.email || user.email || '';

    _updateRoleBadge(state.userRole);

    console.debug(`[Roles] Estado aplicado — rol: ${state.userRole}, uid: ${user.uid.slice(0, 12)}…`);
}

/**
 * Crea el documento de perfil en /usuarios/{uid} para un usuario nuevo.
 * Siempre asigna rol 'user' por defecto — el admin debe elevar manualmente.
 */
async function _createUserProfile(user) {
    if (!window._db) return;
    try {
        await window._db.collection('usuarios').doc(user.uid).set({
            uid:         user.uid,
            email:       user.email || '',
            displayName: user.displayName || (user.email || '').split('@')[0],
            role:        'user',          // siempre 'user' por defecto
            createdAt:   Date.now(),
            lastLogin:   Date.now(),
        });
        console.info('[Roles] Perfil creado para nuevo usuario:', user.email);
    } catch (err) {
        // Puede fallar si las reglas de Firestore aún no están publicadas.
        // El listener onSnapshot manejará el error y asignará rol fallback.
        console.error('[Roles] Error al crear perfil de usuario:', err.code, err.message);
        throw err; // re-lanzar para que el caller use el fallback
    }
}

/**
 * Actualiza el campo lastLogin en /usuarios/{uid}.
 * Falla silenciosamente si el usuario no tiene permisos.
 */
async function _updateLastLogin(uid) {
    if (!window._db || !uid) return;
    try {
        await window._db.collection('usuarios').doc(uid).update({
            lastLogin: Date.now(),
        });
    } catch (_) {
        // Silencioso — no crítico
    }
}

/**
 * Actualiza el badge de rol en el sidebar.
 * @param {'admin'|'user'|null} role
 */
function _updateRoleBadge(role) {
    const badgeEl = document.getElementById('sbRoleBadge');
    if (!badgeEl) return;

    if (!role) {
        badgeEl.style.display = 'none';
        return;
    }

    badgeEl.style.display = 'inline-flex';

    if (role === 'admin') {
        badgeEl.textContent = '🔑 Admin';
        badgeEl.style.background   = 'rgba(59,130,246,0.15)';
        badgeEl.style.borderColor  = 'rgba(59,130,246,0.35)';
        badgeEl.style.color        = '#93c5fd';
    } else {
        badgeEl.textContent = '👤 Usuario';
        badgeEl.style.background   = 'rgba(148,163,184,0.10)';
        badgeEl.style.borderColor  = 'rgba(148,163,184,0.25)';
        badgeEl.style.color        = 'var(--txt-muted)';
    }
}

// ═════════════════════════════════════════════════════════════
//  BINDINGS GLOBALES
//  Expuestos en window para que render.js y products.js puedan
//  usarlos sin necesidad de importar auth-roles.js directamente
//  (evita dependencias circulares).
// ═════════════════════════════════════════════════════════════
window.isAdmin     = isAdmin;
window.isUser      = isUser;
window.canWrite    = canWrite;
window.getUserRole = () => state.userRole;
