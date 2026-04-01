/**
 * js/auth.js — v2 (Fase 1: RBAC)
 * ══════════════════════════════════════════════════════════════
 * Autenticación Firebase Email/Password con control de roles.
 *
 * CAMBIOS RESPECTO A v1:
 *   • Ya NO llama a startRealtimeListeners() directamente.
 *     Esa responsabilidad se delega a auth-roles.js, que lo invoca
 *     solo después de confirmar el rol del usuario.
 *   • Al hacer login → initRoles(user) [auth-roles.js]
 *     initRoles internamente llama startRealtimeListeners().
 *   • Al hacer logout → cleanupRoles() + stopRealtimeListeners()
 *
 * FLUJO COMPLETO:
 *   onAuthStateChanged(user)
 *     ├─ user:   showApp(user)
 *     │           └─ initRoles(user) ──→ /usuarios/{uid}
 *     │                                   └─ startRealtimeListeners()
 *     └─ !user:  cleanupRoles()
 *                stopRealtimeListeners()
 *                showLogin()
 * ══════════════════════════════════════════════════════════════
 */

import { stopRealtimeListeners }          from './sync.js';
import { initRoles, cleanupRoles }        from './auth-roles.js';

// ── Helper: acceso rápido a elementos del DOM ─────────────────
const $id = id => document.getElementById(id);

// ─── Pantallas de auth ─────────────────────────────────────────

function showLogin() {
    $id('authLoadingScreen').classList.add('auth-hidden');
    $id('loginScreen').classList.remove('auth-hidden');
    $id('appWrapper').classList.remove('auth-visible');
    console.info('[Auth] Mostrando pantalla de login.');
}

function showApp(user) {
    $id('authLoadingScreen').classList.add('auth-hidden');
    $id('loginScreen').classList.add('auth-hidden');
    $id('appWrapper').classList.add('auth-visible');
    console.info('[Auth] ✓ Usuario autenticado:', user?.email || 'N/A');
}

// ═════════════════════════════════════════════════════════════
//  INICIALIZACIÓN — onAuthStateChanged
// ═════════════════════════════════════════════════════════════

export function initAuth() {
    if (!window._auth) {
        console.warn('[Auth] Firebase Auth no disponible — modo dev sin autenticación.');
        $id('authLoadingScreen').classList.add('auth-hidden');
        $id('appWrapper').classList.add('auth-visible');
        // Sin Firebase: iniciar roles y listeners directamente
        if (window._db) {
            initRoles(null).catch(e => console.warn('[Auth] initRoles sin usuario:', e));
        }
        return;
    }

    window._auth.onAuthStateChanged(async function(user) {
        if (user) {
            // 1. Mostrar la app inmediatamente (optimistic update)
            showApp(user);

            try {
                // 2. Obtener y aplicar el rol (ANTES de renderizar contenido sensible).
                //    initRoles() también llama startRealtimeListeners() internamente.
                const role = await initRoles(user);
                console.info(`[Auth] Rol confirmado: ${role} — listeners activos.`);
            } catch (err) {
                // initRoles tiene su propio fallback; esto no debería ocurrir.
                console.error('[Auth] initRoles lanzó excepción inesperada:', err);
            }

        } else {
            // LOGOUT: limpiar rol PRIMERO, luego detener listeners
            cleanupRoles();
            stopRealtimeListeners();
            showLogin();
            console.info('[Auth] Sesión cerrada — listeners y rol limpiados.');
        }
    });
}

// ═════════════════════════════════════════════════════════════
//  MANEJO DEL FORMULARIO DE LOGIN
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
        window.showNotification?.('⚙️ Firebase no está configurado.');
        return;
    }

    const email    = ($id('loginEmail')?.value    || '').trim();
    const password = $id('loginPassword')?.value || '';
    const errEl    = $id('loginError');
    const btn      = $id('loginBtn');
    const btnText  = $id('loginBtnText');

    errEl.classList.remove('visible');

    if (!email || !password) {
        errEl.textContent = 'Por favor ingresa tu correo y contraseña.';
        errEl.classList.add('visible');
        return;
    }

    btn.disabled        = true;
    btnText.textContent = 'Iniciando sesión…';
    const spinner       = document.createElement('span');
    spinner.className   = 'login-spinner';
    btn.appendChild(spinner);

    try {
        await window._auth.signInWithEmailAndPassword(email, password);
        // onAuthStateChanged se encarga del resto (initRoles, listeners, UI)
    } catch (err) {
        console.warn('[Auth] Error al iniciar sesión:', err.code);
        errEl.textContent = AUTH_ERROR_MESSAGES[err.code] || `Error: ${err.message || err.code}`;
        errEl.classList.add('visible');
    } finally {
        btn.disabled        = false;
        btnText.textContent = 'Iniciar sesión';
        btn.querySelector('.login-spinner')?.remove();
    }
}

// ═════════════════════════════════════════════════════════════
//  CERRAR SESIÓN
// ═════════════════════════════════════════════════════════════

export async function signOutUser() {
    if (!window._auth) return;
    try {
        window.sbClose?.();
        // cleanupRoles() + stopRealtimeListeners() se llaman
        // automáticamente en onAuthStateChanged cuando user = null
        await window._auth.signOut();
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
