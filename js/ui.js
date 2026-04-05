/**
 * js/ui.js — CORREGIDO v2
 * ══════════════════════════════════════════════════════════════
 * Utilidades de interfaz de usuario.
 *
 * CORRECCIÓN:
 *   showConfirm() ahora retorna Promise<boolean> además de aceptar
 *   el callback onConfirm opcional para compatibilidad con audit.js.
 *
 *   CAUSA DEL BUG:
 *     ui.js definía showConfirm(message, onConfirm) → retornaba undefined.
 *     actions.js usaba `const ok = await showConfirm(...)` → ok = undefined
 *     → falsy → las 5 acciones de borrar/resetear NUNCA se ejecutaban.
 *
 *   SOLUCIÓN (compatible hacia atrás):
 *     La función ahora retorna new Promise(resolve => {...}).
 *     • Cancelar / ESC          → resolve(false)
 *     • Confirmar               → resolve(true) + llama onConfirm() si existe
 *     audit.js funciona igual (callback), actions.js funciona con await.
 * ══════════════════════════════════════════════════════════════
 */

import { state } from './state.js';

let _notificationTimeout = null;
let _toastHideTimer      = null;
let _searchDebounceTimer = null;

// ═════════════════════════════════════════════════════════════
//  ESCAPE HTML
// ═════════════════════════════════════════════════════════════

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

export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem('inventarioApp_theme') || 'dark'; } catch (_) {}
    applyTheme(saved);
}

// ═════════════════════════════════════════════════════════════
//  SIDEBAR
// ═════════════════════════════════════════════════════════════

export function sbOpen() {
    document.getElementById('sidebar').classList.add('sb-open');
    document.getElementById('sbOverlay').classList.add('sb-open');
    document.getElementById('hamburgerBtn').setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
}

export function sbClose() {
    document.getElementById('sidebar').classList.remove('sb-open');
    document.getElementById('sbOverlay').classList.remove('sb-open');
    document.getElementById('hamburgerBtn').setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    document.getElementById('hamburgerBtn').focus();
}

// ═════════════════════════════════════════════════════════════
//  TOAST
// ═════════════════════════════════════════════════════════════

export function showNotification(message) {
    const isCritical = message.startsWith('⚠️') || message.startsWith('❌');
    if (_notificationTimeout && !isCritical) return;

    const toast        = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    if (!toast || !toastMessage) { console.warn('[UI] Toast no encontrado.'); return; }

    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    toast.style.animation = 'none';
    void toast.offsetWidth;
    toast.style.animation = '';

    clearTimeout(_toastHideTimer);
    _toastHideTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
    _notificationTimeout = setTimeout(() => { _notificationTimeout = null; }, 1000);
}

// ═════════════════════════════════════════════════════════════
//  MODAL DE CONFIRMACIÓN — FIX: retorna Promise<boolean>
// ═════════════════════════════════════════════════════════════

/**
 * Muestra un diálogo de confirmación personalizado.
 *
 * @param {string}    message     Texto del diálogo (admite \n para saltos de línea)
 * @param {function}  [onConfirm] Callback opcional (compatibilidad audit.js)
 * @returns {Promise<boolean>}    true = confirmó | false = canceló / ESC
 *
 * @example
 * // Con await (actions.js):
 * const ok = await showConfirm('¿Eliminar este producto?');
 * if (!ok) return;
 *
 * // Con callback (audit.js — sin await, compatible):
 * showConfirm('¿Finalizar conteo?', () => { guardarConteo(); });
 */
export function showConfirm(message, onConfirm) {
    return new Promise((resolve) => {

        // ── Construir overlay ──────────────────────────────────
        const overlay = document.createElement('div');
        overlay.id = '_confirmOverlay';
        overlay.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;' +
            'display:flex;align-items:center;justify-content:center;' +
            'animation:fadeIn 0.15s ease-out;';

        overlay.innerHTML =
            '<div style="background:var(--card);border:1px solid var(--border-mid);' +
            'border-radius:10px;padding:24px 24px 20px;max-width:360px;width:90%;' +
            'box-shadow:var(--shadow-modal);">' +
            '<p style="color:var(--txt-primary);font-family:\'IBM Plex Sans\',sans-serif;' +
            'font-size:0.875rem;line-height:1.55;margin:0 0 20px;white-space:pre-wrap;">' +
            message.replace(/</g, '&lt;') +
            '</p>' +
            '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
            '<button id="_cfmCancel" style="padding:7px 18px;border:1px solid var(--border-mid);' +
            'border-radius:6px;background:transparent;color:var(--txt-secondary);' +
            'font-family:\'IBM Plex Sans\',sans-serif;font-size:0.8125rem;cursor:pointer;">' +
            'Cancelar</button>' +
            '<button id="_cfmOk" style="padding:7px 18px;background:var(--red);color:#fff;' +
            'border:none;border-radius:6px;font-family:\'IBM Plex Sans\',sans-serif;' +
            'font-size:0.8125rem;font-weight:600;cursor:pointer;">Confirmar</button>' +
            '</div></div>';

        document.body.appendChild(overlay);

        // ── Limpiar overlay y listener de ESC ─────────────────
        const close = () => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            document.removeEventListener('keydown', escHandler);
        };

        // ── CANCELAR → resolve(false) ──────────────────────────
        overlay.querySelector('#_cfmCancel').onclick = () => {
            close();
            resolve(false);
        };

        // ── CONFIRMAR → resolve(true) + callback opcional ──────
        overlay.querySelector('#_cfmOk').onclick = () => {
            close();
            resolve(true);
            if (typeof onConfirm === 'function') onConfirm();
        };

        // ── ESC → cancelar ────────────────────────────────────
        const escHandler = e => {
            if (e.key === 'Escape') {
                close();
                resolve(false);
            }
        };
        document.addEventListener('keydown', escHandler);

        // ── Foco en Cancelar por defecto (más seguro) ─────────
        setTimeout(() => { overlay.querySelector('#_cfmCancel')?.focus(); }, 30);
    });
}

// ═════════════════════════════════════════════════════════════
//  HEADER ACTIONS
// ═════════════════════════════════════════════════════════════

export function updateHeaderActions() {
    const container = document.getElementById('headerActions');
    if (!container) return;

    const isAdmin   = state.userRole === 'admin';
    const cartCount = state.cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
    let html = '';

    if ((state.activeTab === 'inicio' || state.activeTab === 'pedidos') && cartCount > 0) {
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

export function updateSearchTerm(value) {
    state.searchTerm = value;
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(async () => {
        try {
            const { saveToLocalStorage } = await import('./storage.js');
            const { renderTab }          = await import('./render.js');
            saveToLocalStorage();
            renderTab();
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

export function estimateStorageUsed() {
    let total = 0;
    try {
        for (const key of Object.keys(localStorage)) {
            total += (localStorage.getItem(key) || '').length * 2;
        }
    } catch (_) {}
    return total;
}

// ═════════════════════════════════════════════════════════════
//  BINDINGS GLOBALES
// ═════════════════════════════════════════════════════════════
window.sbOpen              = sbOpen;
window.sbClose             = sbClose;
window.toggleTheme         = toggleTheme;
window.showNotification    = showNotification;
window.showConfirm         = showConfirm;
window.updateSearchTerm    = updateSearchTerm;
window.updateSelectedGroup = updateSelectedGroup;
