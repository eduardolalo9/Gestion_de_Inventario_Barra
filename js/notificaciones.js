/**
 * js/notificaciones.js
 * ══════════════════════════════════════════════════════════════
 * Sistema de notificaciones en tiempo real.
 *
 * COLECCIÓN FIRESTORE:  /notificaciones/{notifId}
 * {
 *   tipo:        'ajuste' | 'conteo' | 'sync' | 'reporte' | 'sistema'
 *   mensaje:     string
 *   usuarioId:   string   — UID Firebase o auditCurrentUser.userId
 *   usuarioName: string
 *   productoId:  string | null
 *   productoName:string | null
 *   datos:       object   — payload adicional según tipo
 *   leida:       boolean
 *   fecha:       number   — timestamp ms
 *   docId:       string   — window.FIRESTORE_DOC_ID (multi-instalación)
 * }
 *
 * VISIBILIDAD:
 *   Admin → todas las notificaciones del docId
 *   User  → solo las propias + broadcasts (usuarioId == 'broadcast')
 *
 * EXPORTS:
 *   enviarNotificacion({ tipo, mensaje, usuarioId, usuarioName, ... })
 *   marcarComoLeida(notifId)
 *   marcarTodasLeidas()
 *   suscribirNotificaciones()  → unsub function
 *   renderNotificacionesPanel() → HTML string
 * ══════════════════════════════════════════════════════════════
 */

import { state }                        from './state.js';
import { showNotification, escapeHtml } from './ui.js';

// ═════════════════════════════════════════════════════════════
//  ENVÍO
// ═════════════════════════════════════════════════════════════

/**
 * Crea una notificación en Firestore.
 * Falla silenciosamente si no hay Firebase / conexión.
 *
 * @param {{ tipo, mensaje, usuarioId, usuarioName,
 *           productoId?, productoName?, datos? }} opts
 */
export async function enviarNotificacion({
    tipo        = 'sistema',
    mensaje     = '',
    usuarioId   = 'sistema',
    usuarioName = 'Sistema',
    productoId  = null,
    productoName = null,
    datos       = {},
}) {
    if (!window._db) return;

    const notif = {
        tipo,
        mensaje,
        usuarioId,
        usuarioName,
        productoId,
        productoName,
        datos,
        leida: false,
        fecha: Date.now(),
        docId: window.FIRESTORE_DOC_ID,
    };

    try {
        await window._db.collection('notificaciones').add(notif);
    } catch (err) {
        console.warn('[Notif] Error al enviar notificación:', err.message);
    }
}

// ═════════════════════════════════════════════════════════════
//  LECTURA / GESTIÓN
// ═════════════════════════════════════════════════════════════

export async function marcarComoLeida(notifId) {
    if (!window._db || !notifId) return;
    try {
        await window._db.collection('notificaciones').doc(notifId).update({ leida: true });
        const idx = state.notifications.findIndex(n => n._id === notifId);
        if (idx !== -1) {
            state.notifications[idx].leida = true;
            _recalcUnread();
        }
    } catch (err) {
        console.warn('[Notif] Error al marcar como leída:', err.message);
    }
}

export async function marcarTodasLeidas() {
    if (!window._db) return;
    const unread = state.notifications.filter(n => !n.leida);
    if (unread.length === 0) return;

    const batch = window._db.batch();
    unread.forEach(n => {
        batch.update(window._db.collection('notificaciones').doc(n._id), { leida: true });
        n.leida = true;
    });
    try {
        await batch.commit();
        _recalcUnread();
        import('./render.js').then(m => m.renderTab());
    } catch (err) {
        console.warn('[Notif] Error al marcar todas como leídas:', err.message);
    }
}

// ═════════════════════════════════════════════════════════════
//  LISTENER onSnapshot
// ═════════════════════════════════════════════════════════════

/**
 * Suscribe al usuario a su feed de notificaciones.
 * Admin ve todo; usuario ve las propias + broadcasts.
 * @returns {function} unsub — función de cancelación
 */
export function suscribirNotificaciones() {
    if (!window._db) return () => {};

    const myId   = state.currentUser?.uid || state.auditCurrentUser?.userId || 'anon';
    const isAdm  = state.userRole === 'admin';

    let query;
    if (isAdm) {
        query = window._db.collection('notificaciones')
            .where('docId', '==', window.FIRESTORE_DOC_ID)
            .orderBy('fecha', 'desc')
            .limit(50);
    } else {
        // Firestore no permite OR en where; usamos la colección completa y filtramos en cliente
        // para mantener compatibilidad con el plan Spark (sin índices compuestos)
        query = window._db.collection('notificaciones')
            .where('docId', '==', window.FIRESTORE_DOC_ID)
            .orderBy('fecha', 'desc')
            .limit(100);
    }

    const unsub = query.onSnapshot(
        snap => {
            const all = [];
            snap.forEach(doc => all.push({ _id: doc.id, ...doc.data() }));

            // Filtrar para usuarios: solo las propias + broadcasts
            state.notifications = isAdm
                ? all
                : all.filter(n => n.usuarioId === myId || n.usuarioId === 'broadcast');

            _recalcUnread();
            _updateBadge();
            import('./render.js').then(m => m.renderTab()).catch(() => {});
        },
        err => console.warn('[Notif] Error en listener:', err.message)
    );

    return unsub;
}

// ═════════════════════════════════════════════════════════════
//  HELPERS INTERNOS
// ═════════════════════════════════════════════════════════════

function _recalcUnread() {
    state.notificationsUnread = state.notifications.filter(n => !n.leida).length;
}

export function _updateBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    const count = state.notificationsUnread;
    if (count > 0) {
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

// ═════════════════════════════════════════════════════════════
//  RENDER
// ═════════════════════════════════════════════════════════════

const NOTIF_ICONS = {
    ajuste:  '🔧',
    conteo:  '✅',
    sync:    '☁️',
    reporte: '📊',
    sistema: 'ℹ️',
};

/**
 * Genera el HTML del panel de notificaciones para renderTab().
 * @returns {string} HTML string
 */
export function renderNotificacionesPanel() {
    const notifs = state.notifications.slice(0, 30);

    if (notifs.length === 0) {
        return `<div class="bg-white rounded-xl p-6 shadow-md text-center">
            <p style="font-size:0.82rem;color:var(--txt-muted);">Sin notificaciones</p>
        </div>`;
    }

    const unread = state.notificationsUnread;
    let html = `<div class="bg-white rounded-xl shadow-md" style="overflow:hidden;">`;

    // Cabecera
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);">
        <span style="font-size:0.75rem;font-weight:600;color:var(--txt-primary);">
            🔔 Notificaciones ${unread > 0 ? `<span style="background:var(--accent);color:#fff;border-radius:10px;padding:1px 6px;font-size:0.60rem;margin-left:4px;">${unread}</span>` : ''}
        </span>
        ${unread > 0 ? `<button onclick="window.marcarTodasLeidas()" style="font-size:0.68rem;color:var(--accent);background:none;border:none;cursor:pointer;padding:0;min-height:auto;">✓ Marcar todas leídas</button>` : ''}
    </div>`;

    notifs.forEach(n => {
        const icono = NOTIF_ICONS[n.tipo] || '🔔';
        const fecha = n.fecha
            ? new Date(n.fecha).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : '';
        const unreadDot = !n.leida
            ? `<span style="width:7px;height:7px;border-radius:50%;background:var(--accent);flex-shrink:0;"></span>`
            : '';

        html += `<div onclick="window.marcarNotifLeida('${n._id}')"
            style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;
                   border-bottom:1px solid var(--border);cursor:pointer;
                   background:${!n.leida ? 'var(--accent-dim)' : 'transparent'};
                   transition:background 0.12s ease;">
            <span style="font-size:1rem;flex-shrink:0;margin-top:1px;">${icono}</span>
            <div style="flex:1;min-width:0;">
                <div style="font-size:0.78rem;color:var(--txt-primary);line-height:1.4;">${escapeHtml(n.mensaje)}</div>
                <div style="font-size:0.65rem;color:var(--txt-muted);margin-top:2px;">${escapeHtml(n.usuarioName)} · ${fecha}</div>
            </div>
            ${unreadDot}
        </div>`;
    });

    html += `</div>`;
    return html;
}

// ─── Bindings globales ────────────────────────────────────────
window.marcarNotifLeida   = marcarComoLeida;
window.marcarTodasLeidas  = marcarTodasLeidas;
