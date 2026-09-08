

        // ==================== TEMA CLARO / OSCURO ====================
        function applyTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            const isDark = theme === 'dark';

            // Icono del header
            const moonIcon = document.getElementById('themeIconMoon');
            const sunIcon  = document.getElementById('themeIconSun');
            if (moonIcon) moonIcon.classList.toggle('hidden', !isDark);
            if (sunIcon)  sunIcon.classList.toggle('hidden', isDark);

            // Label del sidebar
            const sbLabel = document.getElementById('sbThemeLabel');
            if (sbLabel) sbLabel.textContent = isDark ? 'Modo claro' : 'Modo oscuro';

            // Icono del sidebar
            const sbBtn = document.getElementById('sbThemeBtn');
            if (sbBtn) {
                const sbSvgPath = sbBtn.querySelector('path');
                if (sbSvgPath) {
                    if (isDark) {
                        // luna
                        sbSvgPath.setAttribute('d', 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z');
                    } else {
                        // sol
                        sbSvgPath.setAttribute('d', 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z');
                    }
                }
            }

            try { localStorage.setItem('inventarioApp_theme', theme); } catch(_) {}
        }

        function toggleTheme() {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            applyTheme(current === 'dark' ? 'light' : 'dark');
        }

        function initTheme() {
            let saved = 'dark';
            try {
                let t = localStorage.getItem('inventarioApp_theme');
                if (t !== 'dark' && t !== 'light') t = 'dark';
                saved = t;
            } catch (_) {}
            applyTheme(saved);
        }

        // ==================== FUNCIÓN DE ESCAPE PARA SEGURIDAD ====================
        function escapeHtml(unsafe) {
            if (unsafe === null || unsafe === undefined) return '';
            return String(unsafe)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // ==================== ESTADO GLOBAL ENCAPSULADO ====================
        // Toda la mutación de estado ocurre a través de estas variables.
        // Para futuras refactorizaciones, centralizar aquí facilita migrar a un patrón store.
        let products = [];
        let cart = [];
        let orders = [];
        let inventories = [];
        let activeTab = 'inicio';
        let editingProductId = null;
        let searchTerm = '';
        let selectedGroup = 'Todos';
        let selectedArea = 'almacen';
        let expandedInventories = new Set();
        let expandedCards = new Set(); // IDs de tarjetas de inventario expandidas
        // FIX 11: DeviceID más estable — incorpora fingerprint básico para reusar ID
        // si el usuario borra localStorage pero sigue desde el mismo navegador/dispositivo.
        const _deviceId = (function () {
            const LS_KEY = 'inventarioApp_deviceId';
            try {
                const stored = localStorage.getItem(LS_KEY);
                if (stored && stored.startsWith('dev-')) return stored;
                const id = 'dev-'
                    + Math.random().toString(36).substring(2, 10)
                    + '-'
                    + Date.now().toString(36);
                localStorage.setItem(LS_KEY, id);
                return id;
            } catch (_) {
                return 'dev-offline-' + Math.random().toString(36).slice(2, 10);
            }
        })();
        let inventarioConteo = {}; // { productId: { area: { enteras: 0, abiertas: [] } } }
        let inventarioModalProductId = null;
        let isInventarioModalOpen = false; // Para controlar botones de área

        // ══════════════════════════════════════════════════════════════════════
        //  FUENTE ÚNICA DE VERDAD — ÁREAS DE CONTEO
        //  ────────────────────────────────────────────────────────────────────
        //  Antes existían 15 declaraciones distintas de ['almacen','barra1',
        //  'barra2'] y 12 de { almacen:'pendiente', barra1:'pendiente',
        //  barra2:'pendiente' } repartidas por todo el archivo. Cualquier
        //  cambio (agregar un área, corregir un nombre) requería editar los
        //  27 sitios de forma consistente — y un olvido en cualquiera de ellos
        //  produce exactamente el tipo de reseteo parcial reportado en
        //  producción (un área que no se limpia porque una de las 27 copias
        //  no se actualizó). Todo el archivo referencia ahora esta única
        //  constante y su función auxiliar.
        // ══════════════════════════════════════════════════════════════════════
        const AREAS_CONTEO = ['almacen', 'barra1', 'barra2'];
        function estadoAreasVacio(valor) {
            const o = {};
            AREAS_CONTEO.forEach(function(a) { o[a] = valor; });
            return o;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  SESSION MANAGER — FASE 1: INFRAESTRUCTURA ÚNICAMENTE
        //  ────────────────────────────────────────────────────────────────────
        //  Este módulo NO controla la sesión todavía. onAuthStateChanged(),
        //  loadUserRole() e initializeApp() siguen siendo, hoy, los únicos
        //  responsables reales del arranque — sin ningún cambio en su lógica
        //  ni en el orden en que se ejecutan. Ningún método de SessionManager
        //  es invocado desde ningún punto del flujo real de la aplicación en
        //  esta fase.
        //
        //  Cada método de solo lectura (restoreSession, compareSession,
        //  isReady) SÍ reporta información real, leyendo las variables
        //  globales existentes tal como están — sin duplicar su lógica ni
        //  producir ningún efecto secundario. Los métodos que en una fase
        //  futura tendrían efectos reales (registerListeners,
        //  unregisterListeners, restoreAudit, clearOldState) están definidos
        //  como contenedores documentados, listos para que una fase
        //  posterior — con autorización explícita — los conecte por
        //  composición a las funciones ya existentes (subscribeMainDoc,
        //  loadUserRole, etc.), sin tener que reescribirlas.
        //
        //  Objetivo de esta fase, únicamente: que el módulo exista, compile,
        //  se pueda instanciar sin error, y quede listo para recibir
        //  responsabilidades — no que las ejerza todavía.
        // ══════════════════════════════════════════════════════════════════════
        const SessionManager = (function() {

            // Estado interno, privado al propio módulo — no interfiere con
            // ninguna variable global existente.
            let _initialized = false;
            let _ready = false;
            let _registeredListenerNames = [];

            /**
             * init()
             * Prepara el estado interno del SessionManager. No toca Firebase
             * Auth, no toca Firestore, no dispara ningún listener. Idempotente
             * — seguro de llamar cualquier cantidad de veces.
             */
            function init() {
                _initialized = true;
                _ready = false;
                console.info('[SessionManager] init() — infraestructura preparada (Fase 1, inactivo).');
                return { initialized: _initialized };
            }

            /**
             * start()
             * FASE 1: no orquesta el arranque todavía. En una fase futura,
             * con autorización explícita, aquí es donde se llamaría en
             * secuencia a restoreSession() → compareSession() →
             * restoreAudit() → registerListeners() — reemplazando la
             * orquestación que hoy vive repartida entre onAuthStateChanged
             * y loadUserRole(). Por ahora es un contenedor sin efecto.
             */
            function start() {
                if (!_initialized) init();
                console.info('[SessionManager] start() — Fase 1: sin efecto. El arranque real sigue '
                    + 'a cargo de onAuthStateChanged()/loadUserRole()/initializeApp(), sin cambios.');
                return { started: false, reason: 'fase_1_infraestructura_unicamente' };
            }

            /**
             * destroy()
             * Limpia únicamente el estado interno de este módulo. No cierra
             * ningún listener real todavía (ver unregisterListeners()).
             */
            function destroy() {
                _initialized = false;
                _ready = false;
                _registeredListenerNames = [];
                console.info('[SessionManager] destroy() — estado interno limpiado.');
            }

            /**
             * restoreSession()
             * Wrapper de SOLO LECTURA: reporta el estado de sesión ya
             * determinado por el flujo real existente (Firebase Auth y las
             * variables globales que loadUserRole() ya mantiene), sin
             * volver a ejecutar ni duplicar esa lógica.
             */
            function restoreSession() {
                const user = (typeof _auth !== 'undefined' && _auth && _auth.currentUser)
                    ? _auth.currentUser : null;
                return {
                    uid:  user ? user.uid : ((typeof currentUserUid !== 'undefined') ? currentUserUid : null),
                    role: (typeof currentUserRole !== 'undefined') ? currentUserRole : null,
                    restauradoPorSessionManager: false // Fase 1: informativo únicamente
                };
            }

            /**
             * compareSession(sessionIdRemoto)
             * Wrapper de SOLO LECTURA sobre la comparación de sesión que hoy
             * ya existe dentro de _applyCloudData(). No la reemplaza — la
             * reutiliza para reportar el resultado, sin ningún efecto
             * secundario ni limpieza de estado.
             */
            function compareSession(sessionIdRemoto) {
                const actual = (typeof _auditoriaSessionId !== 'undefined') ? _auditoriaSessionId : null;
                return {
                    local:    actual,
                    remoto:   sessionIdRemoto,
                    coincide: actual === sessionIdRemoto
                };
            }

            /**
             * registerListeners()
             * FASE 1: contenedor documentado, sin efecto — no invoca
             * subscribeMainDoc() ni ningún otro listener real todavía.
             * loadUserRole() sigue siendo, hoy, quien los registra.
             */
            function registerListeners() {
                console.info('[SessionManager] registerListeners() — Fase 1: definido pero no '
                    + 'invocado por el flujo real todavía.');
                return { registrados: _registeredListenerNames.slice(), fase: 1 };
            }

            /**
             * unregisterListeners()
             * Simétrico al anterior — sin efecto en esta fase.
             */
            function unregisterListeners() {
                console.info('[SessionManager] unregisterListeners() — Fase 1: sin efecto todavía.');
                return { liberados: [], fase: 1 };
            }

            /**
             * restoreAudit()
             * FASE 1: sin efecto. Placeholder para la apertura automática de
             * la auditoría activa — funcionalidad NUEVA que hoy no existe en
             * la aplicación y que corresponde a una fase posterior, con
             * autorización explícita por separado.
             */
            function restoreAudit() {
                console.info('[SessionManager] restoreAudit() — Fase 1: sin efecto '
                    + '(funcionalidad nueva, pendiente de autorización).');
                return { auditoriaAbierta: null, fase: 1 };
            }

            /**
             * clearOldState()
             * FASE 1: sin efecto — no toca inventarioConteo, myAuditoriaConteo,
             * localStorage, IndexedDB ni ninguna estructura de datos existente.
             */
            function clearOldState() {
                console.info('[SessionManager] clearOldState() — Fase 1: sin efecto todavía.');
                return { limpiado: false, fase: 1 };
            }

            /**
             * isReady()
             * Único estado que este módulo gestiona de forma real en esta
             * fase: si el propio SessionManager fue inicializado. No indica
             * nada sobre si la sesión de la aplicación está lista — eso
             * seguirá siendo responsabilidad del flujo actual hasta que una
             * fase futura conecte este módulo.
             */
            function isReady() {
                return _ready;
            }

            return {
                init, start, destroy,
                restoreSession, compareSession,
                registerListeners, unregisterListeners,
                restoreAudit, clearOldState,
                isReady
            };
        })();

        // ── AUDITORÍA FÍSICA CIEGA ────────────────────────────────────────────
        let auditoriaView = 'selection'; // 'selection' | 'counting' | 'historial' | 'detalle_cerrado' (ETAPA 15)
        let _detalleInventarioCerradoId = null; // ETAPA 15: qué inventario cerrado se está viendo en detalle
        let _detalleInventarioCerradoData = null; // registros de su snapshot ya cargados (cache de la vista actual)
        let auditoriaAreaActiva = null;
        let auditoriaStatus = estadoAreasVacio('pendiente');
        let auditoriaConteo = {}; // admin: vista agregada de todos los usuarios