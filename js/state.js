/**
 * js/state.js — v2 (Fase 1: RBAC)
 * ══════════════════════════════════════════════════════════════
 * Fuente única de verdad (Single Source of Truth).
 *
 * CAMBIOS RESPECTO A v1:
 *   Añadidas tres propiedades para el sistema de roles:
 *     • currentUser   — Firebase User object (después del login)
 *     • userRole      — 'admin' | 'user' | null
 *     • userProfile   — perfil completo desde /usuarios/{uid}
 *
 * PATRÓN: objeto `state` exportado — los módulos importan y mutan
 *   directamente sus propiedades. Funciona porque los objetos JS
 *   se pasan por referencia.
 *
 * REGLA: NUNCA reasignar el objeto completo (state = {...}).
 *   Solo mutar propiedades individuales.
 * ══════════════════════════════════════════════════════════════
 */

export const state = {

    // ── Autenticación y Roles (Fase 1) ─────────────────────────
    /**
     * Objeto Firebase User activo, o null si no hay sesión.
     * @type {firebase.User|null}
     */
    currentUser: null,

    /**
     * Rol del usuario autenticado, cargado desde /usuarios/{uid}.
     * null = sin sesión activa o rol aún no cargado.
     * @type {'admin'|'user'|null}
     */
    userRole: null,

    /**
     * Perfil completo del usuario desde /usuarios/{uid}.
     * {
     *   uid:         string,
     *   email:       string,
     *   displayName: string,
     *   role:        'admin' | 'user',
     *   createdAt:   number,
     *   lastLogin:   number,
     * }
     * @type {Object|null}
     */
    userProfile: null,

    // ── Datos principales ──────────────────────────────────────
    /** @type {Array<{id:string, name:string, unit:string, group:string, stockByArea:object, capacidadMl?:number, pesoBotellaLlenaOz?:number}>} */
    products: [],

    /** @type {Array<{id:string, name:string, unit:string, group:string, quantity:number}>} */
    cart: [],

    /** @type {Array} */
    orders: [],

    /** @type {Array} */
    inventories: [],

    // ── Navegación / UI ─────────────────────────────────────────
    activeTab:        'inicio',
    editingProductId: null,
    searchTerm:       '',
    selectedGroup:    'Todos',
    selectedArea:     'almacen',

    /** @type {Set<string>} */
    expandedInventories: new Set(),

    /** @type {Set<string>} */
    expandedCards: new Set(),

    // ── Conteo de inventario operativo ──────────────────────────
    /**
     * { productId: { area: { enteras: number, abiertas: number[] } } }
     * area ∈ ['almacen', 'barra1', 'barra2']
     */
    inventarioConteo:        {},
    inventarioModalProductId: null,
    isInventarioModalOpen:    false,

    // ── Auditoría Física Ciega ──────────────────────────────────
    /** 'selection' | 'counting' */
    auditoriaView:       'selection',
    auditoriaAreaActiva: null,
    auditoriaStatus: {
        almacen: 'pendiente',
        barra1:  'pendiente',
        barra2:  'pendiente',
    },
    /** { productId: { area: { enteras, abiertas } } } */
    auditoriaConteo:  {},
    isAuditoriaMode:  false,

    // ── Multiusuario (conteo por dispositivo) ───────────────────
    /**
     * { userId: string, userName: string, createdAt: number }
     * Generado una sola vez por dispositivo, persiste en localStorage.
     */
    auditCurrentUser: null,
    /**
     * { productId: { area: { userId: { userId, userName, enteras, abiertas, ts } } } }
     * Estructura aditiva — cada dispositivo escribe SOLO su propio userId.
     */
    auditoriaConteoPorUsuario: {},

    // ── Sincronización con la nube ───────────────────────────────
    /** true cuando hay cambios locales sin subir a Firestore */
    _cloudSyncPending: false,
    /** timestamp (ms) de la última sincronización exitosa */
    _lastCloudSync:    0,
    /** semáforo para evitar escrituras concurrentes */
    _syncInProgress:   false,
    /** hash para detectar cambios reales en los datos */
    _lastDataHash:     '',
};

/**
 * Helpers de selección rápida.
 */
export function getDb()   { return window._db; }
export function getAuth() { return window._auth; }
