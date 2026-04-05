/**
 * js/state.js — v2.3 DEFINITIVO
 * ══════════════════════════════════════════════════════════════
 * Estado global centralizado de la aplicación.
 * TODAS las propiedades que cualquier módulo lee/escribe deben
 * estar declaradas aquí — sin excepción.
 *
 * CORRECCIONES ACUMULADAS (v2.1 → v2.3):
 *
 * v2.1 (original) — sin ninguna de las propiedades de abajo
 *
 * v2.2 — añadidas:
 *   • currentUser        — auth-roles.js: _applyRoleToState()
 *   • userProfile        — auth-roles.js: _applyRoleToState()
 *   • adjustmentsPending — app.js: subirAjustesPendientes() al reconectar
 *   • auditoriaAreaActiva — render.js: pantalla de conteo de auditoría
 *
 * v2.3 — añadidas:
 *   • auditoriaView      — audit.js lo escribe ('counting'|'selection');
 *                          render.js lo lee para decidir qué sub-vista pintar.
 *                          Sin declarar → undefined → siempre pintaba selección.
 *   • notifications      — notificaciones.js usa state.NOTIFICATIONS (en inglés)
 *                          pero state.js solo tenía state.notificaciones (en español).
 *                          Mismatch de nombre → state.notifications era undefined →
 *                          filter/findIndex sobre undefined → TypeError en runtime.
 *   • notificationsUnread — notificaciones.js escribe este número para el badge.
 *                          Sin declarar → badge siempre mostraba undefined.
 *   • ajustesPendientes  — ajustes.js y render.js usan state.ajustesPendientes
 *                          (con s final) para la lista de ajustes del admin.
 *                          Sin declarar → optional chaining lo ignoraba silenciosamente.
 * ══════════════════════════════════════════════════════════════
 */

export const state = {

  // ─── Catálogo de productos (fuente: Admin) ──────────────────
  products: [],

  // ─── Carrito (pedidos en curso) ─────────────────────────────
  cart: [],

  // ─── Historial ──────────────────────────────────────────────
  orders:      [],   // Pedidos completados (solo local, NO se sincronizan)
  inventories: [],   // Historiales de inventario (se sincronizan chunkeados)

  // ─── Navegación / UI ────────────────────────────────────────
  activeTab:     'inicio',
  selectedArea:  'almacen',
  selectedGroup: 'Todos',
  searchTerm:    '',

  // ─── Inventario operativo (conteo diario por área) ──────────
  // Estructura: { [productId]: { almacen: number, barra1: number, barra2: number } }
  inventarioConteo: {},

  // ─── Auditoría (conteo de verificación) ─────────────────────
  // Estructura: { [productId]: { [area]: { enteras: n, abiertas: [...] } } }
  auditoriaConteo: {},

  // Estado de cada zona: 'pendiente' | 'en_progreso' | 'completada'
  auditoriaStatus: {
    almacen: 'pendiente',
    barra1:  'pendiente',
    barra2:  'pendiente',
  },

  // FIX v2.2 — área activa en pantalla de conteo
  // render.js: if (state.auditoriaView === 'counting' && state.auditoriaAreaActiva)
  auditoriaAreaActiva: null,

  // FIX v2.3 — sub-vista de auditoría: 'selection' | 'counting'
  // audit.js escribe 'counting' al entrar al conteo y 'selection' al volver.
  // render.js lo lee para elegir qué sub-pantalla pintar.
  // Sin esta propiedad declarada → siempre undefined → siempre pintaba selección.
  auditoriaView: 'selection',

  // ─── Multi-usuario (conteo por persona) ─────────────────────
  // Estructura: { [productId]: { [area]: { [userId]: { enteras, abiertas, ts } } } }
  auditoriaConteoPorUsuario: {},

  // ─── Usuario actual de auditoría ────────────────────────────
  // { userId: string, userName: string, role: 'admin'|'user' }
  auditCurrentUser: null,

  // ─── Sesión de autenticación (FIX v2.2) ───────────────────────
  currentUser:  null,   // firebase.User | null  — asignado por auth-roles.js
  userProfile:  null,   // { uid, email, displayName, role, ... } — ídem

  // ─── Rol del usuario autenticado ────────────────────────────
  // 'admin' | 'user' | null (null = modo dev, se trata como admin)
  userRole: null,

  // ─── Sincronización ─────────────────────────────────────────
  syncEnabled:        true,    // Toggle del usuario (pausar/activar sync)
  _cloudSyncPending:  false,   // Hay cambios locales sin subir
  _syncInProgress:    false,   // Mutex: evita sync simultáneos
  _lastCloudSync:     0,       // Timestamp del último sync exitoso
  _lastDataHash:      '',      // Hash para detectar cambios reales

  // ─── Ajustes pendientes offline (FIX v2.2) ───────────────────
  // app.js verifica .length > 0 al reconectar para subirAjustesPendientes()
  adjustmentsPending: [],

  // ─── Notificaciones (FIX v2.3) ───────────────────────────────
  // IMPORTANTE: notificaciones.js usa `state.notifications` (inglés),
  // NO `state.notificaciones` (español). El nombre original causaba
  // TypeError: Cannot read properties of undefined (reading 'findIndex').
  notifications:       [],   // Array de notificaciones del usuario/admin
  notificationsUnread: 0,    // Contador de no leídas → badge en UI

  // ─── Ajustes pendientes del admin (FIX v2.3) ─────────────────
  // ajustes.js y render.js usan `state.ajustesPendientes` (con 's')
  // para la lista de solicitudes de ajuste pendientes de aprobar.
  ajustesPendientes: [],

  // ─── Config de ajustes sincronizada ──────────────────────────
  ajustes: {},

  // ─── Reportes ───────────────────────────────────────────────
  reportesPublicados: [],   // Reportes publicados por admin para descarga
};
