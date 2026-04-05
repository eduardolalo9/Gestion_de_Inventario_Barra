/**
 * js/audit.js
 * ══════════════════════════════════════════════════════════════
 * Auditoría Física Ciega: identidad multiusuario, estadísticas
 * de conteo, render de paneles y flujo de navegación.
 *
 * CAMBIOS RESPECTO A LA VERSIÓN ANTERIOR:
 *
 *   auditoriaFinalizarConteo() [actualizada]
 *     Antes: actualizaba auditoriaStatus localmente y lo subía
 *            a través de saveToLocalStorage → syncToCloud, lo que
 *            podía sobreescribir el cierre de otra zona hecho por
 *            un dispositivo distinto.
 *
 *     Ahora: llama a txCloseZone(area) de sync.js, que usa
 *            runTransaction con dot-notation para escribir SOLO
 *            el campo de esta zona sin tocar las demás.
 *            El estado local se actualiza con el resultado
 *            mergedStatus devuelto por la transacción.
 *
 *   auditoriaResetear() [actualizada]
 *     Usa resetConteoAtomicoEnFirestore() (batch + transaction),
 *     que garantiza que todos los deletes sean atómicos.
 * ══════════════════════════════════════════════════════════════
 */

import { state }                    from './state.js';
import { AREAS_AUDITORIA, AUDIT_TOLERANCE } from './constants.js';
import { showNotification, showConfirm, escapeHtml } from './ui.js';
import { saveToLocalStorage }       from './storage.js';
import {
    txCloseZone,
    syncConteoAtomicoPorArea,
    syncConteoPorUsuarioToFirestore,
    resetConteoAtomicoEnFirestore,
    updateCloudSyncBadge,
}                                   from './sync.js';

// ═════════════════════════════════════════════════════════════
//  IDENTIDAD DEL DISPOSITIVO
// ═════════════════════════════════════════════════════════════

export function initAuditUser() {
    try {
        const raw = localStorage.getItem('inventarioApp_auditUser');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.userId) {
                state.auditCurrentUser = parsed;
                console.info('[MultiUser] Identidad recuperada:', parsed.userName,
                    '(' + parsed.userId.slice(0, 16) + '…)');
                return;
            }
        }
    } catch (_) {}

    const uid   = 'usr-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
    const uName = 'Contador-' + Math.random().toString(36).substr(2, 4).toUpperCase();
    state.auditCurrentUser = { userId: uid, userName: uName, createdAt: Date.now() };
    try { localStorage.setItem('inventarioApp_auditUser', JSON.stringify(state.auditCurrentUser)); }
    catch (_) {}
    console.info('[MultiUser] Nueva identidad creada:', uName, '(' + uid.slice(0, 16) + '…)');
}

export function setAuditUserName(newName) {
    if (!newName || !newName.trim()) { showNotification('⚠️ El nombre no puede estar vacío'); return; }
    if (!state.auditCurrentUser) initAuditUser();
    state.auditCurrentUser.userName = newName.trim().slice(0, 32);
    try { localStorage.setItem('inventarioApp_auditUser', JSON.stringify(state.auditCurrentUser)); } catch (_) {}
    const panel = document.getElementById('auditRenameInline');
    if (panel) panel.classList.remove('visible');
    showNotification('✅ Nombre actualizado: ' + state.auditCurrentUser.userName);
    import('./render.js').then(m => m.renderTab());
}

export function toggleAuditRename() {
    const panel = document.getElementById('auditRenameInline');
    if (!panel) return;
    const opening = !panel.classList.contains('visible');
    panel.classList.toggle('visible', opening);
    if (opening) {
        const inp = document.getElementById('auditRenameInput');
        if (inp) {
            inp.value = state.auditCurrentUser ? state.auditCurrentUser.userName : '';
            setTimeout(() => inp.focus(), 60);
        }
    }
}

export function auditSaveName() {
    const inp = document.getElementById('auditRenameInput');
    if (inp) setAuditUserName(inp.value);
}

// ═════════════════════════════════════════════════════════════
//  ESTADÍSTICAS DE MULTI-CONTEO
// ═════════════════════════════════════════════════════════════

export function calcAuditStats(productId, area) {
    const byArea  = state.auditoriaConteoPorUsuario[productId]?.[area];
    const entries = byArea ? Object.values(byArea) : [];
    if (entries.length === 0) return null;

    const totals = entries.map(u => {
        const enteras     = typeof u.enteras === 'number' ? u.enteras : 0;
        const sumAbiertas = Array.isArray(u.abiertas)
            ? u.abiertas.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0)
            : 0;
        return {
            userId:        u.userId,
            userName:      u.userName || u.userId,
            ts:            u.ts || 0,
            enteras,
            totalAbiertas: Math.round(sumAbiertas * 1000) / 1000,
            total:         Math.round((enteras + sumAbiertas) * 10000) / 10000,
        };
    });

    totals.sort((a, b) => a.ts - b.ts);
    const vals = totals.map(t => t.total);
    const sum  = Math.round(vals.reduce((a, b) => a + b, 0) * 10000) / 10000;
    const avg  = Math.round((sum / vals.length) * 10000) / 10000;
    const min  = Math.min(...vals);
    const max  = Math.max(...vals);
    const diff = Math.round((max - min) * 10000) / 10000;

    return {
        totals,
        sum, avg, min, max, diff,
        hasConflict: vals.length >= 2 && diff > AUDIT_TOLERANCE,
        count:       vals.length,
    };
}

function formatAuditTs(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return ''; }
}

// ═════════════════════════════════════════════════════════════
//  RENDER: TRAIL DE TRAZABILIDAD
// ═════════════════════════════════════════════════════════════

export function renderAuditTrailForProduct(productId, area) {
    const stats = calcAuditStats(productId, area);
    if (!stats || stats.count === 0) return '';
    const myId  = state.auditCurrentUser?.userId;

    let html = '<div class="audit-trail">';
    html += '<div class="audit-trail-header">';
    html += `<span>${stats.count} conteo${stats.count !== 1 ? 's' : ''} registrado${stats.count !== 1 ? 's' : ''}</span>`;

    if (stats.count >= 2) {
        const badgeCls = stats.hasConflict ? 'error' : 'ok';
        const badgeLbl = stats.hasConflict
            ? `⚠️ DIFERENCIA (${stats.diff.toFixed(2)})`
            : '✓ OK';
        html += `<span class="audit-status-badge ${badgeCls}">${badgeLbl}</span>`;
    }
    html += '</div>';

    stats.totals.forEach(entry => {
        const isMe  = myId && entry.userId === myId;
        const meTxt = isMe ? ' <em style="opacity:.5;font-size:.58rem;font-style:normal">(tú)</em>' : '';
        html += `<div class="audit-trail-entry${isMe ? ' is-me' : ''}">`;
        html += `<span class="audit-entry-name">${escapeHtml(entry.userName)}${meTxt}</span>`;
        html += `<span class="audit-entry-count">${entry.enteras} ent + ${entry.totalAbiertas.toFixed(2)} ab = <strong>${entry.total.toFixed(2)}</strong></span>`;
        html += `<span class="audit-entry-ts">${formatAuditTs(entry.ts)}</span>`;
        html += '</div>';
    });

    if (stats.count >= 2) {
        const diffColor = stats.hasConflict ? 'var(--red-text)' : 'var(--green-text)';
        html += '<div class="audit-stats-row">';
        html += `<span>Σ ${stats.sum.toFixed(2)}</span>`;
        html += `<span>μ ${stats.avg.toFixed(2)}</span>`;
        html += `<span>min ${stats.min.toFixed(2)}</span>`;
        html += `<span>max ${stats.max.toFixed(2)}</span>`;
        html += `<span style="color:${diffColor}">Δ ${stats.diff.toFixed(2)}</span>`;
        html += '</div>';
    }

    html += '</div>';
    return html;
}

// ═════════════════════════════════════════════════════════════
//  RENDER: PANEL DE IDENTIDAD
// ═════════════════════════════════════════════════════════════

export function renderAuditUserPanel() {
    const user     = state.auditCurrentUser || { userName: '—', userId: '?' };
    const initials = user.userName.slice(0, 2).toUpperCase();
    let html = '';

    html += '<div id="auditRenameInline" class="audit-rename-inline">';
    html += '<p style="font-size:0.68rem;color:var(--txt-muted);margin-bottom:0;">Nuevo nombre de usuario (máx. 32 caracteres)</p>';
    html += '<div class="audit-rename-row">';
    html += '<input id="auditRenameInput" class="audit-rename-input" type="text" maxlength="32" placeholder="Tu nombre…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();window.auditSaveName();}">';
    html += '<button onclick="window.auditSaveName()" style="padding:6px 12px;background:var(--accent);color:#fff;border-radius:var(--r-sm);font-size:.75rem;font-weight:600;cursor:pointer;min-height:auto;">Guardar</button>';
    html += '<button onclick="window.toggleAuditRename()" style="padding:6px 10px;background:var(--surface);border:1px solid var(--border-mid);border-radius:var(--r-sm);color:var(--txt-secondary);font-size:.75rem;cursor:pointer;min-height:auto;">Cancelar</button>';
    html += '</div></div>';

    html += '<div class="audit-user-panel">';
    html += `<div class="audit-user-avatar">${escapeHtml(initials)}</div>`;
    html += '<div class="audit-user-info">';
    html += '<div class="audit-user-label">Dispositivo actual</div>';
    html += `<div class="audit-user-name-text">${escapeHtml(user.userName)}</div>`;
    html += `<div class="audit-user-id-text">${escapeHtml(user.userId.slice(0, 22))}…</div>`;
    html += '</div>';
    html += '<button class="audit-rename-btn" onclick="window.toggleAuditRename()"><i class="fa-solid fa-pen" style="font-size:.65rem;margin-right:4px;"></i>Cambiar nombre</button>';
    html += '</div>';

    return html;
}

// ═════════════════════════════════════════════════════════════
//  RENDER: PANEL DE COMPARACIÓN MULTIUSUARIO
// ═════════════════════════════════════════════════════════════

export function renderAuditComparePanel() {
    const hasAny = state.products.some(p =>
        Object.keys(state.auditoriaConteoPorUsuario[p.id] || {}).some(area =>
            Object.keys((state.auditoriaConteoPorUsuario[p.id] || {})[area] || {}).length > 1
        )
    );
    if (!hasAny) return '';

    let conflictos = 0;
    state.products.forEach(p => {
        Object.keys(AREAS_AUDITORIA).forEach(area => {
            const stats = calcAuditStats(p.id, area);
            if (stats?.count >= 2 && stats.hasConflict) conflictos++;
        });
    });

    let html = '<div class="bg-white rounded-xl p-4 mb-4 shadow-md" style="border:1px solid var(--border-mid);">';
    html += '<p style="font-size:0.72rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--accent);margin-bottom:10px;">📊 Comparación multiusuario</p>';
    html += conflictos > 0
        ? `<p style="color:var(--red-text);font-size:0.75rem;font-weight:600;">⚠️ ${conflictos} diferencia${conflictos !== 1 ? 's' : ''} detectada${conflictos !== 1 ? 's' : ''}</p>`
        : '<p style="color:var(--green-text);font-size:0.75rem;font-weight:600;">✓ Sin conflictos detectados</p>';
    html += '</div>';
    return html;
}

// ═════════════════════════════════════════════════════════════
//  FLUJO DE AUDITORÍA
// ═════════════════════════════════════════════════════════════

export function auditoriaEntrarArea(area) {
    state.auditoriaAreaActiva = area;
    state.auditoriaView       = 'counting';
    state.isAuditoriaMode     = true;
    state.selectedArea        = area;
    saveToLocalStorage();
    import('./render.js').then(m => m.renderTab());
}

/**
 * Finaliza el conteo de una zona y la marca como completada.
 *
 * FLUJO ACTUALIZADO (3 operaciones paralelas no bloqueantes):
 *
 *  1. txCloseZone(area)
 *     Transacción en el doc principal que cierra SOLO esta zona
 *     con dot-notation. No sobreescribe el estado de las demás.
 *     Idempotente: si otro dispositivo ya cerró esta zona, lo
 *     detecta y no sobreescribe (devuelve wasAlreadyClosed=true).
 *
 *  2. syncConteoAtomicoPorArea(area)
 *     Transacción en conteoAreas/{area}. Reemplaza la entrada
 *     del usuario actual (_userEntradas) sin acumular duplicados.
 *
 *  3. syncConteoPorUsuarioToFirestore(area)
 *     Transacción en conteoPorUsuario/{area}. Escribe solo la
 *     entrada de este userId, preservando la de los demás.
 *
 * Si Firebase no está disponible o no hay conexión, el estado
 * se guarda localmente y se sincronizará cuando haya conexión.
 */
export function auditoriaFinalizarConteo() {
    if (!state.auditoriaAreaActiva) return;
    const area       = state.auditoriaAreaActiva;
    const nombreArea = AREAS_AUDITORIA[area];

    showConfirm(
        `¿Finalizar conteo de ${nombreArea}?\n\nEsto guardará los datos del área y te regresará al panel de áreas.`,
        async () => {
            // ── 1. Actualización local optimista ─────────────────────────────
            state.auditoriaStatus[area] = 'completada';
            state.auditoriaView         = 'selection';
            state.auditoriaAreaActiva   = null;
            state.isAuditoriaMode       = false;
            saveToLocalStorage();

            showNotification(`✅ Conteo de ${nombreArea} guardado`);

            const { renderTab } = await import('./render.js');
            renderTab();

            // ── 2. Operaciones Firestore (paralelas, no bloquean la UI) ──────
            if (!window._db || !navigator.onLine) {
                console.info(`[Audit] Sin Firebase/conexión — cierre de "${area}" guardado localmente.`);
                return;
            }

            // Notificar al admin que un área fue completada
            const usuario = state.currentUser?.email || state.auditCurrentUser?.userName || 'Usuario';
            import('./notificaciones.js').then(m => m.enviarNotificacion({
                tipo:        'conteo',
                mensaje:     `${usuario} completó el conteo de ${nombreArea}`,
                usuarioId:   state.currentUser?.uid || state.auditCurrentUser?.userId || 'anon',
                usuarioName: usuario,
                datos:       { area, status: 'completada' },
            })).catch(() => {});

            // Ejecutar las 3 transacciones en paralelo
            const [zoneResult] = await Promise.allSettled([
                txCloseZone(area).then(result => {
                    if (result.wasAlreadyClosed) {
                        console.info(`[Audit] Zona "${area}" ya estaba cerrada por otro dispositivo.`);
                        showNotification(`ℹ️ ${nombreArea} ya fue cerrada por otro dispositivo`);
                    }
                    if (result.mergedStatus) {
                        const prevStatus = { ...state.auditoriaStatus };
                        state.auditoriaStatus = result.mergedStatus;
                        const changed = AREA_KEYS.some(a => prevStatus[a] !== result.mergedStatus[a]);
                        if (changed) {
                            saveToLocalStorage();
                            renderTab();
                            console.info('[Audit] Estado de zonas sincronizado con Firestore:', result.mergedStatus);
                        }
                    }
                    return result;
                }),

                syncConteoAtomicoPorArea(area).catch(err => {
                    console.warn('[Audit] syncConteoAtomicoPorArea falló (no crítico):', err?.message);
                }),

                syncConteoPorUsuarioToFirestore(area).catch(err => {
                    console.warn('[Audit] syncConteoPorUsuarioToFirestore falló (no crítico):', err?.message);
                }),
            ]);

            if (zoneResult.status === 'rejected') {
                console.error('[Audit] txCloseZone falló:', zoneResult.reason);
                showNotification('⚠️ Error al confirmar el cierre en la nube — se reintentará');
            }
        }
    );
}

export function auditoriaVolverSeleccion() {
    state.auditoriaView       = 'selection';
    state.auditoriaAreaActiva = null;
    state.isAuditoriaMode     = false;
    saveToLocalStorage();
    import('./render.js').then(m => m.renderTab());
}

export function auditoriaTotalAreasCompletadas() {
    return Object.values(state.auditoriaStatus).filter(s => s === 'completada').length;
}

export function auditoriaTodasCompletas() {
    return Object.values(state.auditoriaStatus).every(s => s === 'completada');
}

/**
 * Reinicia la auditoría completa.
 * Usa resetConteoAtomicoEnFirestore() que garantiza:
 *   - Batch atómico para borrar conteoAreas + conteoPorUsuario (6 docs)
 *   - Transaction para resetear auditoriaStatus en el doc principal
 */
export function auditoriaResetear() {
    showConfirm(
        '⚠️ ¿Iniciar nueva auditoría?\n\nSe borrarán todos los conteos actuales de las tres áreas.',
        async () => {
            // Actualización local optimista
            state.auditoriaStatus           = { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' };
            state.auditoriaConteo           = {};
            state.auditoriaConteoPorUsuario = {};
            state.auditoriaView             = 'selection';
            state.auditoriaAreaActiva       = null;
            state.isAuditoriaMode           = false;
            saveToLocalStorage();
            showNotification('Nueva auditoría iniciada');
            const { renderTab } = await import('./render.js');
            renderTab();

            // Reset en Firestore (batch + transaction)
            if (window._db && navigator.onLine) {
                try {
                    await resetConteoAtomicoEnFirestore();
                    console.info('[Audit] ✓ Reset completado en Firestore.');
                } catch (err) {
                    console.warn('[Audit] Reset en Firestore falló — se reintentará:', err?.message);
                }
            }
        }
    );
}

// ── Bindings globales ─────────────────────────────────────────
window.auditSaveName            = auditSaveName;
window.toggleAuditRename        = toggleAuditRename;
window.auditoriaEntrarArea      = auditoriaEntrarArea;
window.auditoriaFinalizarConteo = auditoriaFinalizarConteo;
window.auditoriaVolverSeleccion = auditoriaVolverSeleccion;
window.auditoriaResetear        = auditoriaResetear;
