/**
 * js/ui.js
 * ══════════════════════════════════════════════════════════════
 * Utilidades de interfaz de usuario:
 *   • Tema claro/oscuro
 *   • Sidebar hamburguesa
 *   • Toast de notificaciones
 *   • Modal de confirmación personalizado
 *   • Escape HTML (seguridad XSS)
 *   • updateHeaderActions
 * ══════════════════════════════════════════════════════════════
 */

import { state } from './state.js';

// ── Throttle interno de notificaciones ────────────────────────
let _notificationTimeout = null;
let _toastHideTimer      = null;

// ── Debounce interno de búsqueda ──────────────────────────────
let _searchDebounceTimer = null;

// ── Advertencia cuota localStorage (solo una vez por sesión) ──
// FIX BUG-13: eliminadas las exports _lsQuotaWarned / setLsQuotaWarned
// (nunca se importaban; storage.js usa su propio _quotaWarned local)

// ═════════════════════════════════════════════════════════════
//  SEGURIDAD — escape HTML
// ═════════════════════════════════════════════════════════════

/**
 * Escapa caracteres HTML especiales para prevenir XSS.
 * @param {*} unsafe - valor a escapar (se convierte a string)
 * @returns {string} string HTML-safe
 */
export function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#039;');
}

// ═════════════════════════════════════════════════════════════
//  TEMA CLARO / OSCURO
// ═════════════════════════════════════════════════════════════

/**
 * Aplica el tema dado ('dark' | 'light') al documento y lo persiste.
 */
export function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const moonIcon = document.getElementById('themeIconMoon');
    const sunIcon  = document.getElementById('themeIconSun');
    const sbLabel  = document.getElementById('sbThemeLabel');

    if (theme === 'light') {
        moonIcon && moonIcon.classList.add('hidden');
        sunIcon  && sunIcon.classList.remove('hidden');
        if (sbLabel) sbLabel.textContent = 'Modo oscuro';
    } else {
        moonIcon && moonIcon.classList.remove('hidden');
        sunIcon  && sunIcon.classList.add('hidden');
        if (sbLabel) sbLabel.textContent = 'Modo claro';
    }

    try { localStorage.setItem('inventarioApp_theme', theme); } catch (_) {}
}

/**
 * Alterna entre tema oscuro y claro.
 */
export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

/**
 * Inicializa el tema leyendo localStorage (se llama en DOMContentLoaded).
 */
export function initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem('inventarioApp_theme') || 'dark'; } catch (_) {}
    applyTheme(saved);
}

// ═════════════════════════════════════════════════════════════
//  SIDEBAR
// ═════════════════════════════════════════════════════════════

/** Abre el sidebar. */
export function sbOpen() {
    document.getElementById('sidebar').classList.add('sb-open');
    document.getElementById('sbOverlay').classList.add('sb-open');
    document.getElementById('hamburgerBtn').setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    console.debug('[UI] Sidebar abierto.');
}

/** Cierra el sidebar y devuelve el foco al botón hamburguesa. */
export function sbClose() {
    document.getElementById('sidebar').classList.remove('sb-open');
    document.getElementById('sbOverlay').classList.remove('sb-open');
    document.getElementById('hamburgerBtn').setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    document.getElementById('hamburgerBtn').focus();
}

// ═════════════════════════════════════════════════════════════
//  TOAST (notificaciones)
// ═════════════════════════════════════════════════════════════

/**
 * Muestra un toast de notificación.
 * Mensajes críticos (⚠️, ❌) siempre pasan; los demás tienen throttle de 1 s.
 * @param {string} message
 */
export function showNotification(message) {
    const isCritical = message.startsWith('⚠️') || message.startsWith('❌');
    if (_notificationTimeout && !isCritical) return;

    const toast        = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    if (!toast || !toastMessage) {
        console.warn('[UI] Toast no encontrado en el DOM.');
        return;
    }

    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    // Reiniciar animación CSS
    toast.style.animation = 'none';
    void toast.offsetWidth; // reflow
    toast.style.animation = '';

    clearTimeout(_toastHideTimer);
    _toastHideTimer = setTimeout(() => toast.classList.add('hidden'), 3000);

    _notificationTimeout = setTimeout(() => { _notificationTimeout = null; }, 1000);
}

// ═════════════════════════════════════════════════════════════
//  MODAL DE CONFIRMACIÓN (reemplaza confirm() nativo)
// ═════════════════════════════════════════════════════════════

/**
 * Muestra un diálogo de confirmación personalizado (no bloquea el hilo).
 * @param {string}   message   - Texto de confirmación (admite \n)
 * @param {function} onConfirm - Callback al confirmar
 */
export function showConfirm(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.id = '_confirmOverlay';
    overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;' +
        'display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease-out;';

    overlay.innerHTML =
        '<div style="background:var(--card);border:1px solid var(--border-mid);border-radius:10px;' +
        'padding:24px 24px 20px;max-width:360px;width:90%;box-shadow:var(--shadow-modal);">' +
        '<p style="color:var(--txt-primary);font-family:\'IBM Plex Sans\',sans-serif;font-size:0.875rem;' +
        'line-height:1.55;margin:0 0 20px;white-space:pre-wrap;">' + message.replace(/</g, '&lt;') + '</p>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
        '<button id="_cfmCancel" style="padding:7px 18px;border:1px solid var(--border-mid);border-radius:6px;' +
        'background:transparent;color:var(--txt-secondary);font-family:\'IBM Plex Sans\',sans-serif;' +
        'font-size:0.8125rem;cursor:pointer;">Cancelar</button>' +
        '<button id="_cfmOk" style="padding:7px 18px;background:var(--red);color:#fff;border:none;' +
        'border-radius:6px;font-family:\'IBM Plex Sans\',sans-serif;font-size:0.8125rem;' +
        'font-weight:600;cursor:pointer;">Confirmar</button>' +
        '</div></div>';

    document.body.appendChild(overlay);

    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    overlay.querySelector('#_cfmCancel').onclick = close;
    overlay.querySelector('#_cfmOk').onclick = function() { close(); onConfirm(); };

    // Cerrar con ESC
    const escHandler = e => {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    // Foco automático en Cancelar (más seguro por defecto)
    setTimeout(() => { overlay.querySelector('#_cfmCancel')?.focus(); }, 30);
}

// ═════════════════════════════════════════════════════════════
//  HEADER ACTIONS (carrito + sincronización)
// ═════════════════════════════════════════════════════════════

/**
 * Re-renderiza los botones de acción del header según el tab activo.
 * Se llama cada vez que cambia el estado del carrito o del tab.
 */

/**
 * updateHeaderActions()
 *
 * Re-renderiza los botones de acción del header según:
 *   • El tab activo  (state.activeTab)
 *   • El rol actual  (state.userRole)
 *
 * Matriz de visibilidad:
 * ┌─────────────────────────┬───────┬──────┐
 * │ Botón                   │ admin │ user │
 * ├─────────────────────────┼───────┼──────┤
 * │ 📥 Importar Excel       │  ✓    │  ✗   │  tab: inicio / productos
 * │ 🛒 Carrito              │  ✓    │  ✓   │  tab: pedidos (si hay items)
 * │ ⬇️ Excel (export)       │  ✓    │  ✗   │  tab: inventario
 * └─────────────────────────┴───────┴──────┘
 */
export function updateHeaderActions() {
    const container = document.getElementById('headerActions');
    if (!container) return;

    const isAdmin    = state.userRole === 'admin';
    const cartCount  = state.cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
    let html = '';

    // ── "📥 Importar Excel" — tab inicio / productos, solo admin ──
    // Activa el input oculto #fileInput que acepta .xlsx/.xls/.csv
    // y llama a window.handleFileImport (definido en products.js).
    if (isAdmin && (state.activeTab === 'inicio' || state.activeTab === 'productos')) {
        html += `<button
            onclick="document.getElementById('fileInput').click()"
            class="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-white rounded-lg text-xs font-semibold shadow-sm"
            style="background:rgba(255,255,255,0.09);border-color:rgba(255,255,255,0.18);"
            title="Importar catálogo de productos desde Excel (.xlsx)">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
            </svg>
            Excel
        </button>`;
    }

    // ── 🛒 Carrito — tab pedidos, visible para ambos roles ────────
    // El botón de carrito no requiere restricción de rol porque
    // ver el resumen del pedido no modifica el catálogo de productos.
    if (state.activeTab === 'pedidos' && cartCount > 0) {
        html += `<button
            onclick="window.openOrderModal()"
            class="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-500 to-orange-500 text-white rounded-lg text-sm font-semibold shadow-sm"
            aria-label="Ver carrito (${cartCount} items)">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
            </svg>
            <span>${cartCount}</span>
        </button>`;
    }

    // ── ⬇️ Excel export — tab inventario, solo admin ──────────────
    // Exportar el estado de inventario es una operación de reporting
    // que solo el administrador debe poder ejecutar.
    if (isAdmin && state.activeTab === 'inventario') {
        html += `<button
            onclick="window.exportToExcel('INVENTARIO')"
            class="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg text-xs font-semibold shadow-sm"
            title="Exportar inventario a Excel">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            Excel
        </button>`;
    }

    container.innerHTML = html;
}

// ═════════════════════════════════════════════════════════════
//  BÚSQUEDA CON DEBOUNCE
// ═════════════════════════════════════════════════════════════

/**
 * Actualiza el término de búsqueda con debounce de 300 ms.
 * Importa saveToLocalStorage y renderTab de forma dinámica para
 * evitar dependencias circulares.
 * @param {string} value
 */
export function updateSearchTerm(value) {
    state.searchTerm = value;
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(async () => {
        try {
            const { saveToLocalStorage } = await import('./storage.js');
            const { renderTab }          = await import('./render.js');
            saveToLocalStorage();
            renderTab();
            // Restaurar foco y cursor al input de búsqueda tras el re-render
            const searchInput = document.querySelector('#tabContent input[type="text"]');
            if (searchInput) {
                searchInput.focus();
                const len = searchInput.value.length;
                searchInput.setSelectionRange(len, len);
            }
        } catch (e) {
            console.error('[UI] Error en updateSearchTerm:', e);
        }
    }, 300);
}

export function updateSelectedGroup(value) {
    state.selectedGroup = value;
    import('./storage.js').then(m => m.saveToLocalStorage());
    import('./render.js').then(m => m.renderTab());
}

// ═════════════════════════════════════════════════════════════
//  ESTIMACIÓN DE ALMACENAMIENTO
// ═════════════════════════════════════════════════════════════

/** Estima el uso actual de localStorage en bytes. */
export function estimateStorageUsed() {
    let total = 0;
    try {
        for (const key of Object.keys(localStorage)) {
            total += (localStorage.getItem(key) || '').length * 2; // UTF-16
        }
    } catch (_) {}
    return total;
}

// ═════════════════════════════════════════════════════════════
//  BINDINGS GLOBALES (requeridos por onclick en el HTML)
// ═════════════════════════════════════════════════════════════
window.sbOpen            = sbOpen;
window.sbClose           = sbClose;
window.toggleTheme       = toggleTheme;
window.showNotification  = showNotification;
window.showConfirm       = showConfirm;
window.updateSearchTerm  = updateSearchTerm;
window.updateSelectedGroup = updateSelectedGroup;
