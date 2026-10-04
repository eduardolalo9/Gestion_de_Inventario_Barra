
    (function() {
        'use strict';

        /* ── Helpers DOM ─────────────────────────────────────────── */
        const $id  = id => document.getElementById(id);
        const loginScreen       = $id('loginScreen');
        const authLoadingScreen = $id('authLoadingScreen');
        const appWrapper        = $id('appWrapper');

        /* ── Mostrar/Ocultar pantallas ───────────────────────────── */
        function showLogin() {
            authLoadingScreen.classList.add('auth-hidden');
            loginScreen.classList.remove('auth-hidden');
            appWrapper.classList.remove('auth-visible');
        }

        function showApp(user) {
            authLoadingScreen.classList.add('auth-hidden');
            loginScreen.classList.add('auth-hidden');
            appWrapper.classList.add('auth-visible');
            // Actualizar email visible en el sidebar
            const emailEl = $id('sbUserEmail');
            if (emailEl && user) emailEl.textContent = user.email;

            // FIX-SEC-6: aviso de email sin verificar. Deliberadamente NO
            // bloquea el acceso — el sistema fue provisionado originalmente
            // sin exigir verificación, y convertir esto en un bloqueo duro
            // dejaría fuera a usuarios reales ya operando hoy. Se muestra
            // una sola vez por sesión como visibilidad, no como control de
            // acceso — endurecerlo a bloqueo requiere coordinarse primero
            // con la base de usuarios existente.
            if (user && user.emailVerified === false) {
                setTimeout(function() {
                    showNotification('⚠️ Tu email no está verificado — revisa tu bandeja de entrada.');
                }, 1500);
            }
        }

        /* ── onAuthStateChanged — persistencia de sesión ─────────── */
        if (_auth) {
            _auth.onAuthStateChanged(function(user) {
                if (user) {
                    console.info('[Auth] Usuario autenticado:', user.email);
                    showApp(user);
                    // FASE 7 (S5) — pedir que el navegador no borre los datos
                    // sin sincronizar bajo presión de espacio. No bloquea.
                    if (typeof _pedirAlmacenamientoPersistente === 'function') _pedirAlmacenamientoPersistente();
                    // Cargar rol — usar window.loadUserRole para garantizar acceso cross-script
                    var _loadRole = window.loadUserRole || loadUserRole;
                    if (typeof _loadRole === 'function') {
                        _loadRole(user.uid).catch(function(e) {
                            console.warn('[Auth] Error cargando rol:', e);
                        });
                    } else {
                        console.error('[Auth] loadUserRole no disponible — revisa el orden de los scripts');
                    }
                } else {
                    console.info('[Auth] Sin sesión — mostrando login.');
                    // Limpiar subscripciones activas
                    if (typeof _unsubAjustes   === 'function') { _unsubAjustes();   _unsubAjustes   = null; }
                    if (typeof _unsubCatalogo  === 'function') { _unsubCatalogo();  _unsubCatalogo  = null; }
                    if (typeof _unsubNotifs    === 'function') { _unsubNotifs();    _unsubNotifs    = null; }
                    if (typeof _unsubMainDoc   === 'function') { _unsubMainDoc();   _unsubMainDoc   = null; } // FIX SYNC-6
                    if (typeof _unsubAllUsers  === 'function') { _unsubAllUsers();  _unsubAllUsers  = null; }
                    if (typeof _unsubMyAuditoria === 'function') { _unsubMyAuditoria(); _unsubMyAuditoria = null; }
                    // ETAPA 14.1.1: limpiar también los listeners en tiempo
                    // real del contexto de autorización — nunca deben
                    // sobrevivir a un logout, ni seguir escuchando el doc del
                    // usuario/rol anterior en la sesión del siguiente.
                    if (typeof _unsubUsuarioPropio === 'function') { _unsubUsuarioPropio(); _unsubUsuarioPropio = null; }
                    if (typeof _unsubRolActual     === 'function') { _unsubRolActual();     _unsubRolActual     = null; }
                    _rolEscuchadoActualId = null;
                    _lastUserData         = null;
                    // ETAPA 15: el listener de Inventario Físico activo tampoco
                    // debe sobrevivir a un logout, ni seguir escuchando el
                    // inventario de la sesión anterior en la sesión del siguiente.
                    if (typeof _unsubInventarioActivo === 'function') { _unsubInventarioActivo(); _unsubInventarioActivo = null; }
                    _inventarioActivoId = null;
                    _inventarioActivo   = null;
                    if (typeof _inventarioActivoCarga !== 'undefined') _inventarioActivoCarga = 'sin_sesion';
                    allUsersAuditoria = {};
                    _ajustes = [];
                    // MICROFASE P0.2: sin este reset, si el siguiente usuario
                    // en loguearse resulta tener el MISMO modo (p.ej. admin →
                    // logout → otro admin), _reconciliarListenersPorAutorizacion()
                    // vería "nada cambió" (mismo string 'admin') y se
                    // saltaría la resuscripción — aunque los listeners de la
                    // sesión anterior ya fueron destruidos arriba. null
                    // fuerza que la próxima llamada siempre reconcilie de cero.
                    _modoListenersActual = null;
                    currentUserRole = null;
                    currentUserUid  = null;
                    _resetAuthzState(); // ETAPA 14.1: logout limpia también el contexto de permisos
                    showLogin();
                }
            });
        } else {
            // FIX #5 — Firebase Auth no disponible (fallo de red o configuración incorrecta).
            // NUNCA mostrar la app sin autenticación — mostrar el login con mensaje de error.
            // El fallback anterior (appWrapper.classList.add('auth-visible')) era un bypass
            // de seguridad peligroso: cualquier fallo de SDK exponía la app sin login.
            console.error('[Auth] Firebase Auth no disponible — mostrando pantalla de login con aviso.');
            authLoadingScreen.classList.add('auth-hidden');
            // Mostrar login — FIX-1: 'loginWrapper' no existe en el DOM.
            // El elemento correcto es 'loginScreen'. showLogin() lo muestra correctamente.
            showLogin();
            // Mostrar aviso de error de configuración al usuario
            const loginError = $id('loginError');
            if (loginError) {
                loginError.textContent = '⚠️ Error de conexión con el servidor. Verifica tu acceso a internet e intenta de nuevo.';
                loginError.classList.add('visible');
            }
        }

        /* ── Manejo del formulario de login ──────────────────────── */
        window.handleLogin = async function() {
            if (!_auth) {
                showNotification('⚙️ Firebase no está configurado.');
                return;
            }
            const email    = ($id('loginEmail').value   || '').trim();
            // FIX-AUTH: NO hacer trim() en passwords. Las contraseñas pueden tener espacios
            // intencionales al inicio/fin. Trimear causaría auth/wrong-password silencioso.
            const password = $id('loginPassword').value || '';
            const errEl    = $id('loginError');
            const btn      = $id('loginBtn');
            const btnText  = $id('loginBtnText');

            // Validaciones básicas
            errEl.classList.remove('visible');
            if (!email || !password) {
                errEl.textContent = 'Por favor ingresa tu correo y contraseña.';
                errEl.classList.add('visible');
                return;
            }

            // Estado de carga en el botón
            btn.disabled = true;
            btnText.textContent = 'Iniciando sesión…';
            btn.insertAdjacentHTML('beforeend', '<span class="login-spinner"></span>');

            try {
                await _auth.signInWithEmailAndPassword(email, password);
                // onAuthStateChanged se encarga de mostrar la app automáticamente
            } catch (err) {
                console.warn('[Auth] Error al iniciar sesión:', err.code);
                const msgs = {
                    'auth/user-not-found':      'No existe una cuenta con ese correo.',
                    'auth/wrong-password':      'Contraseña incorrecta. Inténtalo de nuevo.',
                    'auth/invalid-email':       'El formato del correo no es válido.',
                    'auth/too-many-requests':   'Demasiados intentos. Espera unos minutos.',
                    'auth/network-request-failed': 'Sin conexión. Verifica tu internet.',
                    'auth/invalid-credential':  'Correo o contraseña incorrectos.',
                };
                errEl.textContent = msgs[err.code] || ('Error: ' + (err.message || err.code));
                errEl.classList.add('visible');
            } finally {
                btn.disabled = false;
                btnText.textContent = 'Iniciar sesión';
                const spinner = btn.querySelector('.login-spinner');
                if (spinner) spinner.remove();
            }
        };

        /* ── Cerrar sesión ───────────────────────────────────────── */
        window.signOutUser = async function() {
            if (!_auth) return;
            try {
                sbClose();
                // ═══ FIX #6c: Limpiar intervals al cerrar sesión ═══
                // Sin esto, los intervals siguen corriendo aunque no haya usuario autenticado,
                // intentando syncs con Firebase y auto-guardados sin contexto válido.
                if (window._syncPeriodicInterval) { clearInterval(window._syncPeriodicInterval); window._syncPeriodicInterval = null; }
                if (window._autoSaveInterval)     { clearInterval(window._autoSaveInterval);     window._autoSaveInterval = null;     }
                await _auth.signOut();
                // onAuthStateChanged limpiará la UI automáticamente
                showNotification('👋 Sesión cerrada correctamente.');
            } catch (err) {
                console.error('[Auth] Error al cerrar sesión:', err);
                showNotification('❌ Error al cerrar sesión.');
            }
        };

        /* ── Enter en los campos del login ───────────────────────── */
        document.addEventListener('DOMContentLoaded', function() {
            const emailInput    = $id('loginEmail');
            const passwordInput = $id('loginPassword');
            if (emailInput) {
                emailInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') { e.preventDefault(); $id('loginPassword').focus(); }
                });
            }
            if (passwordInput) {
                passwordInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') { e.preventDefault(); window.handleLogin(); }
                });
            }
        });
    })();
    