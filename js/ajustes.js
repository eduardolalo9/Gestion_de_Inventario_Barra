/**
 * js/ajustes.js
 * ══════════════════════════════════════════════════════════════
 * Módulo de ajustes de producto.
 *
 * FLUJO:
 *   Usuario → openAjusteModal(productId)
 *     → solicitarAjuste(productId, campo, valorNuevo, razon)
 *       → Escribe en /ajustes/{id} con estado 'pendiente'
 *       → Envía notificación al admin
 *   Admin → ve lista en tab Ajustes (o badge)
 *     → procesarAjuste(ajusteId, true/false)
 *       → Actualiza /ajustes/{id} con estado 'aprobado'/'rechazado'
 *       → Si aprobado: aplica cambio al producto localmente
 *       → Notifica al usuario
 *
 * COLECCIÓN FIRESTORE:  /ajustes/{ajusteId}
 * {
 *   productoId, productoName,
 *   usuarioId, usuarioName,
 *   campo, campoLabel, valorAnterior, valorNuevo,
 *   razon, estado: 'pendiente'|'aprobado'|'rechazado',
 *   fecha, procesadoPor?, fechaProcesado?,
 *   docId
 * }
 *
 * COLA OFFLINE:
 *   Si syncEnabled=false o sin conexión, el ajuste se guarda en
 *   state.adjustmentsPending y se sube cuando hay conexión.
 * ══════════════════════════════════════════════════════════════
 */

import { state }                        from './state.js';
import { CAMPOS_AJUSTABLES }            from './constants.js';
import { showNotification, escapeHtml } from './ui.js';
import { saveToLocalStorage }           from './storage.js';
import { enviarNotificacion }           from './notificaciones.js';

// ═════════════════════════════════════════════════════════════
//  MODAL DE SOLICITUD (usuario)
// ═════════════════════════════════════════════════════════════

export function openAjusteModal(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) { showNotification('⚠️ Producto no encontrado'); return; }

    const options = Object.entries(CAMPOS_AJUSTABLES)
        .map(([key, label]) => {
            const actual = product[key] !== undefined ? product[key] : '—';
            return `<option value="${key}">${label} (actual: ${escapeHtml(String(actual))})</option>`;
        }).join('');

    const overlay = document.createElement('div');
    overlay.id = '_ajusteOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;' +
        'display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease both;';

    overlay.innerHTML = `
        <div style="background:var(--card);border:1px solid var(--border-mid);border-radius:var(--r-lg);
                    padding:24px 24px 20px;max-width:380px;width:90%;box-shadow:var(--shadow-modal);">
            <p style="font-weight:600;font-size:0.9rem;color:var(--txt-primary);margin:0 0 2px;">
                Solicitar ajuste
            </p>
            <p style="font-size:0.75rem;color:var(--txt-muted);margin:0 0 18px;">
                ${escapeHtml(product.name)} · ${escapeHtml(product.id)}
            </p>

            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:0.7rem;font-weight:700;letter-spacing:.07em;
                              text-transform:uppercase;color:var(--txt-secondary);margin-bottom:5px;">
                    Campo a ajustar
                </label>
                <select id="_aj_campo" style="width:100%;padding:8px 10px;background:var(--surface);
                    border:1px solid var(--border-mid);border-radius:var(--r-md);
                    color:var(--txt-primary);font-size:0.8rem;">
                    ${options}
                </select>
            </div>

            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:0.7rem;font-weight:700;letter-spacing:.07em;
                              text-transform:uppercase;color:var(--txt-secondary);margin-bottom:5px;">
                    Nuevo valor
                </label>
                <input id="_aj_valor" type="text"
                    style="width:100%;padding:8px 10px;background:var(--surface);
                           border:1px solid var(--border-mid);border-radius:var(--r-md);
                           color:var(--txt-primary);font-size:0.8rem;"
                    placeholder="Ingresa el valor correcto">
            </div>

            <div style="margin-bottom:18px;">
                <label style="display:block;font-size:0.7rem;font-weight:700;letter-spacing:.07em;
                              text-transform:uppercase;color:var(--txt-secondary);margin-bottom:5px;">
                    Razón del ajuste
                </label>
                <textarea id="_aj_razon" rows="2"
                    style="width:100%;padding:8px 10px;background:var(--surface);
                           border:1px solid var(--border-mid);border-radius:var(--r-md);
                           color:var(--txt-primary);font-size:0.8rem;resize:none;"
                    placeholder="¿Por qué necesitas este cambio?"></textarea>
            </div>

            <div style="display:flex;gap:10px;">
                <button id="_aj_cancel" style="flex:1;padding:8px 0;background:transparent;
                    border:1px solid var(--border-mid);border-radius:var(--r-md);
                    color:var(--txt-secondary);font-size:0.8rem;cursor:pointer;">
                    Cancelar
                </button>
                <button id="_aj_ok" style="flex:1;padding:8px 0;background:var(--accent);
                    border:1px solid var(--accent-hover);border-radius:var(--r-md);
                    color:#fff;font-size:0.8rem;font-weight:600;cursor:pointer;">
                    Enviar ajuste
                </button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };

    document.getElementById('_aj_cancel').onclick = close;
    document.getElementById('_aj_ok').onclick = async () => {
        const campo  = document.getElementById('_aj_campo').value;
        const valor  = document.getElementById('_aj_valor').value.trim();
        const razon  = document.getElementById('_aj_razon').value.trim();
        if (!valor) { showNotification('⚠️ Ingresa el nuevo valor'); return; }
        if (!razon) { showNotification('⚠️ La razón del ajuste es requerida'); return; }
        close();
        await solicitarAjuste(productId, campo, valor, razon);
    };

    overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') close();
    });
    setTimeout(() => document.getElementById('_aj_valor')?.focus(), 60);
}

// ═════════════════════════════════════════════════════════════
//  SOLICITAR AJUSTE (usuario)
// ═════════════════════════════════════════════════════════════

export async function solicitarAjuste(productId, campo, valorNuevo, razon = '') {
    const product = state.products.find(p => p.id === productId);
    if (!product) { showNotification('⚠️ Producto no encontrado'); return; }
    if (!CAMPOS_AJUSTABLES[campo]) { showNotification('⚠️ Campo no permitido'); return; }

    const valorAnterior = product[campo] !== undefined ? String(product[campo]) : '';
    const usuario = {
        id:   state.currentUser?.uid || state.auditCurrentUser?.userId || 'anon',
        name: state.currentUser?.email || state.auditCurrentUser?.userName || 'Anónimo',
    };

    const ajuste = {
        productoId:    productId,
        productoName:  product.name,
        usuarioId:     usuario.id,
        usuarioName:   usuario.name,
        campo,
        campoLabel:    CAMPOS_AJUSTABLES[campo],
        valorAnterior,
        valorNuevo:    valorNuevo.trim(),
        razon:         razon.trim(),
        estado:        'pendiente',
        fecha:         Date.now(),
        docId:         window.FIRESTORE_DOC_ID,
    };

    // Sin conexión o sync desactivado → cola local
    if (!window._db || !navigator.onLine || !state.syncEnabled) {
        state.adjustmentsPending = state.adjustmentsPending || [];
        state.adjustmentsPending.push(ajuste);
        saveToLocalStorage();
        showNotification('📝 Ajuste guardado — se enviará al sincronizar');
        return;
    }

    try {
        await window._db.collection('ajustes').add(ajuste);
        await enviarNotificacion({
            tipo:        'ajuste',
            mensaje:     `${usuario.name} solicita ajustar "${product.name}" · ${CAMPOS_AJUSTABLES[campo]}: ${valorAnterior} → ${valorNuevo}`,
            usuarioId:   usuario.id,
            usuarioName: usuario.name,
            productoId:  productId,
            productoName: product.name,
            datos:       ajuste,
        });
        showNotification('✅ Ajuste enviado al administrador');
    } catch (err) {
        console.error('[Ajustes] Error al enviar:', err.message);
        // Fallback a cola local
        state.adjustmentsPending = state.adjustmentsPending || [];
        state.adjustmentsPending.push(ajuste);
        saveToLocalStorage();
        showNotification('📝 Error de conexión — ajuste guardado localmente');
    }
}

// ═════════════════════════════════════════════════════════════
//  PROCESAR AJUSTE (admin)
// ═════════════════════════════════════════════════════════════

export async function procesarAjuste(ajusteId, aprobado) {
    if (!window._db) return;

    const ajuste = state.ajustesPendientes?.find(a => a._id === ajusteId);
    if (!ajuste) { showNotification('⚠️ Ajuste no encontrado'); return; }

    const nuevoEstado  = aprobado ? 'aprobado' : 'rechazado';
    const adminName    = state.currentUser?.email || 'admin';

    try {
        await window._db.collection('ajustes').doc(ajusteId).update({
            estado:          nuevoEstado,
            procesadoPor:    adminName,
            fechaProcesado:  Date.now(),
        });

        // Aplicar cambio al producto si fue aprobado
        if (aprobado) {
            const product = state.products.find(p => p.id === ajuste.productoId);
            if (product) {
                const numVal = parseFloat(ajuste.valorNuevo);
                product[ajuste.campo] = isNaN(numVal) ? ajuste.valorNuevo : numVal;
                saveToLocalStorage();
            }
        }

        // Notificar al usuario solicitante
        await enviarNotificacion({
            tipo:        'ajuste',
            mensaje:     `Tu solicitud de ajuste en "${ajuste.productoName}" fue ${aprobado ? '✅ aprobada' : '❌ rechazada'} por ${adminName}`,
            usuarioId:   ajuste.usuarioId,
            usuarioName: ajuste.usuarioName,
            productoId:  ajuste.productoId,
            productoName: ajuste.productoName,
            datos:       { ...ajuste, estado: nuevoEstado },
        });

        // Quitar de la lista local
        state.ajustesPendientes = state.ajustesPendientes.filter(a => a._id !== ajusteId);

        showNotification(aprobado ? '✅ Ajuste aprobado y aplicado' : '❌ Ajuste rechazado');
        import('./render.js').then(m => m.renderTab());

    } catch (err) {
        console.error('[Ajustes] Error al procesar:', err.message);
        showNotification('⚠️ Error al procesar ajuste');
    }
}

// ═════════════════════════════════════════════════════════════
//  SUBIR COLA OFFLINE
// ═════════════════════════════════════════════════════════════

export async function subirAjustesPendientes() {
    if (!window._db || !navigator.onLine) return;
    const pendientes = state.adjustmentsPending || [];
    if (pendientes.length === 0) return;

    let subidos = 0;
    const fallidos = [];
    for (const ajuste of pendientes) {
        try {
            await window._db.collection('ajustes').add(ajuste);
            subidos++;
        } catch (err) {
            console.warn('[Ajustes] Error al subir pendiente:', err.message);
            fallidos.push(ajuste);
        }
    }
    state.adjustmentsPending = fallidos;
    saveToLocalStorage();
    if (subidos > 0) showNotification(`☁️ ${subidos} ajuste(s) pendientes enviados`);
}

// ═════════════════════════════════════════════════════════════
//  LISTENER FIRESTORE (admin)
// ═════════════════════════════════════════════════════════════

export function suscribirAjustesAdmin() {
    if (!window._db || state.userRole !== 'admin') return () => {};

    const unsub = window._db.collection('ajustes')
        .where('docId', '==', window.FIRESTORE_DOC_ID)
        .where('estado', '==', 'pendiente')
        .orderBy('fecha', 'desc')
        .onSnapshot(
            snap => {
                state.ajustesPendientes = [];
                snap.forEach(doc => state.ajustesPendientes.push({ _id: doc.id, ...doc.data() }));
                // Actualizar badge de ajustes
                _updateAjustesBadge();
                import('./render.js').then(m => m.renderTab()).catch(() => {});
            },
            err => console.warn('[Ajustes] Error en listener admin:', err.message)
        );

    return unsub;
}

function _updateAjustesBadge() {
    const badge = document.getElementById('ajustesBadge');
    if (!badge) return;
    const count = state.ajustesPendientes?.length || 0;
    badge.textContent = count > 0 ? String(count) : '';
    badge.style.display = count > 0 ? 'flex' : 'none';
}

// ═════════════════════════════════════════════════════════════
//  RENDER: PANEL DE AJUSTES PENDIENTES (admin)
// ═════════════════════════════════════════════════════════════

export function renderAjustesPendientesPanel() {
    const ajustes = state.ajustesPendientes || [];
    if (ajustes.length === 0) {
        return `<p style="font-size:0.78rem;color:var(--txt-muted);text-align:center;padding:12px 0;">
            Sin ajustes pendientes
        </p>`;
    }

    let html = '';
    ajustes.forEach(a => {
        const fecha = a.fecha
            ? new Date(a.fecha).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : '';
        html += `<div style="background:var(--surface);border:1px solid var(--border-mid);
                              border-radius:var(--r-md);padding:10px 12px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:0.78rem;font-weight:600;color:var(--txt-primary);">
                        🔧 ${escapeHtml(a.productoName)}
                    </div>
                    <div style="font-size:0.7rem;color:var(--txt-secondary);margin-top:2px;">
                        ${escapeHtml(a.campoLabel)}: 
                        <span style="color:var(--red-text);">${escapeHtml(a.valorAnterior || '—')}</span>
                        → 
                        <span style="color:var(--green-text);">${escapeHtml(a.valorNuevo)}</span>
                    </div>
                    <div style="font-size:0.68rem;color:var(--txt-muted);margin-top:2px;">
                        ${escapeHtml(a.usuarioName)} · ${fecha}
                    </div>
                    ${a.razon ? `<div style="font-size:0.68rem;color:var(--txt-secondary);margin-top:3px;
                        background:var(--card);padding:3px 7px;border-radius:var(--r-xs);
                        border-left:2px solid var(--accent);">"${escapeHtml(a.razon)}"</div>` : ''}
                </div>
                <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;">
                    <button data-id="${escapeHtml(a._id)}"
                        onclick="window.procesarAjuste(this.dataset.id, true)"
                        style="padding:4px 10px;background:var(--green-dim);border:1px solid rgba(34,197,94,.25);
                               border-radius:var(--r-xs);color:var(--green-text);font-size:0.68rem;
                               font-weight:600;cursor:pointer;min-height:auto;">✓ Aprobar</button>
                    <button data-id="${escapeHtml(a._id)}"
                        onclick="window.procesarAjuste(this.dataset.id, false)"
                        style="padding:4px 10px;background:var(--red-dim);border:1px solid rgba(239,68,68,.18);
                               border-radius:var(--r-xs);color:var(--red-text);font-size:0.68rem;
                               font-weight:600;cursor:pointer;min-height:auto;">✗ Rechazar</button>
                </div>
            </div>
        </div>`;
    });
    return html;
}

// ─── Bindings globales ────────────────────────────────────────
window.openAjusteModal = openAjusteModal;
window.procesarAjuste  = procesarAjuste;
