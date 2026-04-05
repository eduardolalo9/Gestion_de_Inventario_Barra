/**
 * js/auth.js — v2.2 (CORREGIDO)
 * ══════════════════════════════════════════════════════════════
 * Autenticación Firebase Email/Password con control de roles.
 *
 * CORRECCIONES v2.2:
 * • _authResolve usa patrón re-creatable (no Promise única)
 * • Eliminados duplicados: stopRealtimeListeners y limpieza
 *   de email ya se manejan dentro de cleanupRoles()
 * • Añadido timeout de seguridad para initRoles
 * • Guard contra race condition logout-durante-init
 *
 * FLUJO:
 *   onAuthStateChanged(user)
 *     ├─ user  → initRoles(user) → showApp(user) → resolve(user)
 *     └─ !user → cleanupRoles() → showLogin()
 * ══════════════════════════════════════════════════════════════
 */

import { initRoles, cleanupRoles } from './auth-roles.js';

// ── Helper: acceso rápido a elementos del DOM ─────────────────
const $id = id => document.getElementById(id);

// ── Promise que app.js puede esperar ──────────────────────────
// Patrón: se re-crea en cada cambio de auth para evitar el
// problema de "Promise resuelta con null en logout".
let _authResolve;
let _authReady = new Promise(resolve => { _authResolve = resolve; });

/** Retorna la Promise actual de auth ready */
export function getAuthReady() {
    return _authReady;
}

// ── Alias legacy (si app.js usa `onAuthReady` directamente) ───
export { _authReady as onAuthReady };

// ── Timeout de seguridad (ms) ─────────────────────────────────
const INIT_TIMEOUT = 15000; // 15 segundos máximo para initRoles

// ── Guard: evitar procesar auth si hay un cambio en progreso ──
let _authChangeInProgress = false;
let _lastAuthUid = null;

// ─── Pantallas de auth ─────────────────────────────────────────

function showLogin() {
    const loadingEl = $id('authLoadingScreen');
    const loginEl = $id('loginScreen');
    const appEl = $id('appWrapper');

    if (loadingEl) loadingEl.classList.add('auth-hidden');
    if (loginEl) loginEl.classList.remove('auth-hidden');
    if (appEl) appEl.classList.remove('auth-visible');

    console.info('[Auth] Mostrando pantalla de login.');
}

function showApp(user) {
    const loadingEl = $id('authLoadingScreen');
    const loginEl = $id('loginScreen');
    const appEl = $id('appWrapper');

    if (loadingEl) loadingEl.classList.add('auth-hidden');
    if (loginEl) loginEl.classList.add('auth-hidden');
    if (appEl) appEl.classList.add('auth-visible');

    console.info('[Auth] ✓ Usuario autenticado:', user?.email || 'N/A');
}

function showAuthLoading() {
    const loadingEl = $id('authLoadingScreen');
    const loginEl = $id('loginScreen');
    const appEl = $id('appWrapper');

    if (loadingEl) loadingEl.classList.remove('auth-hidden');
    if (loginEl) loginEl.classList.add('auth-hidden');
    if (appEl) appEl.classList.remove('auth-visible');
}

function showAuthError(message) {
    const loadingEl = $id('authLoadingScreen');
    const loginEl = $id('loginScreen');
    const appEl = $id('appWrapper');

    if (loadingEl) loadingEl.classList.add('auth-hidden');
    if (loginEl) loginEl.classList.remove('auth-hidden');
    if (appEl) appEl.classList.remove('auth-visible');

    // Mostrar el error en el campo de error del login
    const errEl = $id('loginError');
    if (errEl) {
        errEl.textContent = message;
        errEl.classList.add('visible');
    }
    console.error('[Auth]', message);
}

// ═════════════════════════════════════════════════════════════
// INICIALIZACIÓN — onAuthStateChanged
// ═════════════════════════════════════════════════════════════

export function initAuth() {
    // ── Si Firebase Auth no está disponible → BLOQUEAR ────────
    if (!window._auth) {
        console.error('[Auth] Firebase Auth no disponible — acceso bloqueado.');
        showAuthError('⚠️ Error de configuración: Firebase Auth no está disponible.');
        _authResolve(null);
        return;
    }

    window._auth.onAuthStateChanged(async function (user) {
        // ── Guard: evitar procesar si ya hay un cambio en curso ──
        // (puede pasar si Firebase dispara dos eventos rápido)
        if (_authChangeInProgress) {
            console.warn('[Auth] Cambio de auth en progreso — encolando.');
            // Esperar a que termine el anterior
            await new Promise(r => {
                const check = setInterval(() => {
                    if (!_authChangeInProgress) {
                        clearInterval(check);
                        r();
                    }
                }, 100);
                // Safety: máximo 10s de espera
                setTimeout(() => { clearInterval(check); r(); }, 10000);
            });
        }

        _authChangeInProgress = true;

        try {
            if (user) {
                await _handleLogin(user);
            } else {
                _handleLogout();
            }
        } catch (err) {
            console.error('[Auth] Error en onAuthStateChanged:', err);
            // Fallback: mostrar login
            showLogin();
            _authResolve(null);
        } finally {
            _authChangeInProgress = false;
        }
    });
}

// ─── Handler de LOGIN ──────────────────────────────────────────

async function _handleLogin(user) {
    // Si es el mismo usuario que ya está logueado, ignorar
    if (_lastAuthUid === user.uid) {
        console.debug('[Auth] Mismo usuario, ignorando re-trigger.');
        return;
    }

    // Si había otro usuario, limpiar primero
    if (_lastAuthUid && _lastAuthUid !== user.uid) {
        console.info('[Auth] Cambio de usuario detectado — limpiando sesión anterior.');
        cleanupRoles();
    }

    _lastAuthUid = user.uid;

    // Re-crear Promise de auth ready para este nuevo login
    _authReady = new Promise(resolve => { _authResolve = resolve; });

    // Mostrar pantalla de carga mientras se obtiene el rol
    showAuthLoading();

    try {
        // ── initRoles CON timeout de seguridad ───────────────
        const role = await Promise.race([
            initRoles(user),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT')), INIT_TIMEOUT)
            )
        ]);

        // ── Verificar que no se hizo logout mientras esperábamos ──
        if (_lastAuthUid !== user.uid) {
            console.warn('[Auth] Usuario cambió durante initRoles — abortando.');
            return;
        }

        console.info(`[Auth] Rol confirmado: ${role} — listeners activos.`);
        showApp(user);
        _authResolve(user);

    } catch (err) {
        // ── Verificar que no se hizo logout mientras esperábamos ──
        if (_lastAuthUid !== user.uid) {
            console.warn('[Auth] Usuario cambió durante initRoles (error path) — abortando.');
            return;
        }

        if (err.message === 'TIMEOUT') {
            console.error('[Auth] Timeout al obtener rol — mostrando app con rol por defecto.');
        } else {
            console.error('[Auth] Error al inicializar roles:', err);
        }

        // initRoles tiene fallback interno, así que la app debería
        // funcionar. Mostrar la app de todos modos.
        showApp(user);
        _authResolve(user);
    }
}

// ─── Handler de LOGOUT ─────────────────────────────────────────

function _handleLogout() {
    const prevUid = _lastAuthUid;
    _lastAuthUid = null;

    // cleanupRoles() se encarga de:
    // - Cancelar listener de /usuarios/{uid}
    // - Limpiar state (currentUser, userRole, userProfile)
    // - Detener listeners de datos (stopRealtimeListeners)
    // - Limpiar UI (data-role, badge, email)
    cleanupRoles();

    showLogin();

    // Re-crear Promise de auth ready
    _authReady = new Promise(resolve => { _authResolve = resolve; });
    _authResolve(null);

    if (prevUid) {
        console.info('[Auth] Sesión cerrada — todo limpiado.');
    }
}

// ═════════════════════════════════════════════════════════════
// MANEJO DEL FORMULARIO DE LOGIN
// ═════════════════════════════════════════════════════════════

const AUTH_ERROR_MESSAGES = {
    'auth/user-not-found':         'No existe una cuenta con ese correo.',
    'auth/wrong-password':         'Contraseña incorrecta. Inténtalo de nuevo.',
    'auth/invalid-email':          'El formato del correo no es válido.',
    'auth/too-many-requests':      'Demasiados intentos. Espera unos minutos.',
    'auth/network-request-failed': 'Sin conexión. Verifica tu internet.',
    'auth/invalid-credential':     'Correo o contraseña incorrectos.',
    'auth/user-disabled':          'Esta cuenta ha sido deshabilitada.',
    'auth/operation-not-allowed':  'Inicio de sesión con correo no habilitado.',
};

export async function handleLogin() {
    if (!window._auth) {
        window.showNotification?.('⚠️ Firebase no está configurado.');
        return;
    }

    const emailInput = $id('loginEmail');
    const passInput = $id('loginPassword');
    const errEl = $id('loginError');
    const btn = $id('loginBtn');
    const btnText = $id('loginBtnText');

    const email = (emailInput?.value || '').trim();
    const password = passInput?.value || '';

    // Limpiar error anterior
    if (errEl) errEl.classList.remove('visible');

    // Validación
    if (!email || !password) {
        if (errEl) {
            errEl.textContent = 'Por favor ingresa tu correo y contraseña.';
            errEl.classList.add('visible');
        }
        return;
    }

    // Deshabilitar botón
    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Iniciando sesión…';

    let spinner = null;
    if (btn) {
        spinner = document.createElement('span');
        spinner.className = 'login-spinner';
        btn.appendChild(spinner);
    }

    try {
        await window._auth.signInWithEmailAndPassword(email, password);
        // onAuthStateChanged se encarga del resto

        // Limpiar campos después de login exitoso
        if (passInput) passInput.value = '';

    } catch (err) {
        console.warn('[Auth] Error al iniciar sesión:', err.code);
        if (errEl) {
            errEl.textContent = AUTH_ERROR_MESSAGES[err.code]
                || `Error: ${err.message || err.code}`;
            errEl.classList.add('visible');
        }
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Iniciar sesión';
        if (spinner) spinner.remove();
    }
}

// ═════════════════════════════════════════════════════════════
// CERRAR SESIÓN
// ═════════════════════════════════════════════════════════════

export async function signOutUser() {
    if (!window._auth) return;
    try {
        // Cerrar sidebar si está abierto
        window.sbClose?.();

        await window._auth.signOut();
        // onAuthStateChanged se encarga de cleanupRoles + showLogin

        window.showNotification?.('👋 Sesión cerrada correctamente.');
        console.info('[Auth] signOut ejecutado.');
    } catch (err) {
        console.error('[Auth] Error al cerrar sesión:', err);
        window.showNotification?.('❌ Error al cerrar sesión.');
    }
}

// ── Bindings globales ─────────────────────────────────────────
window.handleLogin = handleLogin;
window.signOutUser = signOutUser;
