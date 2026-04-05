/**
 * js/reportes.js
 * ══════════════════════════════════════════════════════════════
 * Módulo de reportes publicados.
 *
 * FLUJO:
 *   Admin → openPublicarReporteModal()
 *     → publicarReporte(titulo)
 *       → Escribe en /reportesPublicados/{id} con datos consolidados
 *       → Notifica a todos los usuarios (broadcast)
 *   Usuario → ve la sección "Reportes" en Historia
 *     → descargarReporteExcel(reporteId) → .xlsx local
 *
 * COLECCIÓN FIRESTORE:  /reportesPublicados/{reporteId}
 * {
 *   titulo, fecha, timestamp, publicadoPor, docId,
 *   totalProductos,
 *   productos: [{ id, nombre, unidad, grupo, capacidadMl,
 *                 areas: { almacen, barra1, barra2 },
 *                 totalLlenas, totalAbiertas, totalGeneral, totalMl }],
 *   auditoriaStatus: { almacen, barra1, barra2 }
 * }
 * ══════════════════════════════════════════════════════════════
 */

import { state }                        from './state.js';
import { AREA_KEYS, AREAS }             from './constants.js';
import { showNotification, escapeHtml } from './ui.js';
import { calcularTotalConAbiertas,
         tieneConversion }              from './products.js';
import { enviarNotificacion }           from './notificaciones.js';

// ═════════════════════════════════════════════════════════════
//  MODAL DE PUBLICACIÓN (admin)
// ═════════════════════════════════════════════════════════════

export function openPublicarReporteModal() {
    if (state.userRole !== 'admin') {
        showNotification('⚠️ Solo el administrador puede publicar reportes');
        return;
    }

    const fecha = new Date().toLocaleDateString('es-MX');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;' +
        'display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease both;';

    const totalProductos = state.products.length;
    const areasCompletadas = Object.values(state.auditoriaStatus || {}).filter(s => s === 'completada').length;

    overlay.innerHTML = `
        <div style="background:var(--card);border:1px solid var(--border-mid);border-radius:var(--r-lg);
                    padding:24px 24px 20px;max-width:400px;width:90%;box-shadow:var(--shadow-modal);">
            <p style="font-weight:600;font-size:0.95rem;color:var(--txt-primary);margin:0 0 4px;">
                📊 Publicar reporte final
            </p>
            <p style="font-size:0.75rem;color:var(--txt-muted);margin:0 0 16px;">
                Se publicará el inventario actual. Los usuarios podrán descargarlo desde "Historia".
            </p>

            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);
                        padding:10px 14px;margin-bottom:16px;font-size:0.78rem;color:var(--txt-secondary);">
                <div>📦 ${totalProductos} producto(s)</div>
                <div style="margin-top:3px;">🗺️ ${areasCompletadas}/3 áreas de auditoría completadas</div>
            </div>

            <div style="margin-bottom:16px;">
                <label style="display:block;font-size:0.7rem;font-weight:700;letter-spacing:.07em;
                              text-transform:uppercase;color:var(--txt-secondary);margin-bottom:5px;">
                    Título del reporte
                </label>
                <input id="_rp_titulo" type="text" value="Reporte ${fecha}"
                    style="width:100%;padding:8px 10px;background:var(--surface);
                           border:1px solid var(--border-mid);border-radius:var(--r-md);
                           color:var(--txt-primary);font-size:0.85rem;">
            </div>

            <div style="display:flex;gap:10px;">
                <button id="_rp_cancel" style="flex:1;padding:9px 0;background:transparent;
                    border:1px solid var(--border-mid);border-radius:var(--r-md);
                    color:var(--txt-secondary);font-size:0.82rem;cursor:pointer;">
                    Cancelar
                </button>
                <button id="_rp_ok" style="flex:2;padding:9px 0;
                    background:linear-gradient(135deg,#065f46,#047857);
                    border:1px solid rgba(34,197,94,.28);border-radius:var(--r-md);
                    color:#86efac;font-size:0.82rem;font-weight:600;cursor:pointer;">
                    📊 Publicar y notificar usuarios
                </button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    document.getElementById('_rp_cancel').onclick = close;
    document.getElementById('_rp_ok').onclick = async () => {
        const titulo = document.getElementById('_rp_titulo').value.trim();
        close();
        await publicarReporte(titulo);
    };
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    setTimeout(() => {
        const inp = document.getElementById('_rp_titulo');
        inp?.focus(); inp?.select();
    }, 60);
}

// ═════════════════════════════════════════════════════════════
//  PUBLICAR REPORTE (admin)
// ═════════════════════════════════════════════════════════════

export async function publicarReporte(titulo = '') {
    if (state.userRole !== 'admin') {
        showNotification('⚠️ Solo el administrador puede publicar reportes');
        return;
    }
    if (!window._db) { showNotification('⚠️ Firebase no disponible'); return; }

    const fecha      = new Date().toLocaleDateString('es-MX');
    const tituloFinal = titulo || `Reporte ${fecha}`;

    // Construir datos consolidados
    const productos = state.products.map(p => {
        const areas = {};
        let totalLlenas   = 0;
        let totalAbiertas = 0;

        AREA_KEYS.forEach(area => {
            const d = (state.inventarioConteo[p.id] || {})[area] || { enteras: 0, abiertas: [] };
            const enteras  = d.enteras || 0;
            const abiertas = d.abiertas || [];
            const total    = calcularTotalConAbiertas(p.id, area);
            areas[area]    = { enteras, abiertas: abiertas.length, total };
            totalLlenas   += enteras;
            totalAbiertas += abiertas.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
        });

        const totalGeneral = AREA_KEYS.reduce((s, a) => s + (areas[a].total || 0), 0);
        const totalMl = tieneConversion(p)
            ? Math.round(totalGeneral * p.capacidadMl)
            : null;

        return {
            id:           p.id,
            nombre:       p.name,
            unidad:       p.unit || '',
            grupo:        p.group || 'General',
            capacidadMl:  p.capacidadMl || null,
            areas,
            totalLlenas,
            totalAbiertas: Math.round(totalAbiertas * 1000) / 1000,
            totalGeneral:  Math.round(totalGeneral * 10000) / 10000,
            totalMl,
        };
    });

    const reporte = {
        titulo:          tituloFinal,
        fecha,
        timestamp:       Date.now(),
        publicadoPor:    state.currentUser?.email || 'admin',
        docId:           window.FIRESTORE_DOC_ID,
        totalProductos:  productos.length,
        productos,
        auditoriaStatus: { ...state.auditoriaStatus },
    };

    try {
        showNotification('☁️ Publicando reporte…');
        const docRef = await window._db.collection('reportesPublicados').add(reporte);
        reporte._id  = docRef.id;

        // Broadcast a todos los usuarios
        await enviarNotificacion({
            tipo:        'reporte',
            mensaje:     `📊 Nuevo reporte disponible: "${tituloFinal}"`,
            usuarioId:   'broadcast',
            usuarioName: 'Sistema',
            datos:       { reporteId: docRef.id, titulo: tituloFinal },
        });

        showNotification(`✅ "${tituloFinal}" publicado y notificado`);
        import('./render.js').then(m => m.renderTab());

    } catch (err) {
        console.error('[Reportes] Error al publicar:', err.message);
        showNotification('⚠️ Error al publicar reporte');
    }
}

// ═════════════════════════════════════════════════════════════
//  DESCARGAR REPORTE (admin y usuario)
// ═════════════════════════════════════════════════════════════

export function descargarReporteExcel(reporteId) {
    const reporte = (state.reportesPublicados || []).find(
        r => r._id === reporteId || r.id === reporteId
    );
    if (!reporte) { showNotification('⚠️ Reporte no encontrado'); return; }
    if (!window.XLSX) { showNotification('⚠️ Librería Excel no disponible'); return; }

    // Cabecera
    const headerRow = ['ID', 'Nombre', 'Unidad', 'Grupo', 'Capacidad ml'];
    AREA_KEYS.forEach(area => {
        const label = AREAS[area] || area;
        headerRow.push(`${label} Enteras`, `${label} Total`);
    });
    headerRow.push('Total General', 'Total ml');

    const rows = [headerRow];
    (reporte.productos || []).forEach(p => {
        const row = [p.id, p.nombre, p.unidad, p.grupo, p.capacidadMl ?? ''];
        AREA_KEYS.forEach(area => {
            const d = (p.areas || {})[area] || { enteras: 0, total: 0 };
            row.push(d.enteras, d.total);
        });
        row.push(p.totalGeneral, p.totalMl ?? '');
        rows.push(row);
    });

    // Fila de totales
    const totalsRow = ['', 'TOTALES', '', '', ''];
    AREA_KEYS.forEach(() => totalsRow.push('', ''));
    const granTotal = (reporte.productos || []).reduce((s, p) => s + (p.totalGeneral || 0), 0);
    totalsRow.push(Math.round(granTotal * 100) / 100, '');
    rows.push(totalsRow);

    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    const sheetName = reporte.titulo.slice(0, 31).replace(/[:\\/?*[\]]/g, '');
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Reporte');
    const filename = `REPORTE_${(reporte.titulo || 'inventario').replace(/\s+/g, '_')}_${reporte.fecha.replace(/\//g, '-')}.xlsx`;
    window.XLSX.writeFile(wb, filename);
    showNotification('✅ Reporte descargado');
}

// ═════════════════════════════════════════════════════════════
//  LISTENER FIRESTORE
// ═════════════════════════════════════════════════════════════

export function suscribirReportesPublicados() {
    if (!window._db) return () => {};

    const unsub = window._db.collection('reportesPublicados')
        .where('docId', '==', window.FIRESTORE_DOC_ID)
        .orderBy('timestamp', 'desc')
        .limit(20)
        .onSnapshot(
            snap => {
                state.reportesPublicados = [];
                snap.forEach(doc => state.reportesPublicados.push({ _id: doc.id, ...doc.data() }));
                import('./render.js').then(m => m.renderTab()).catch(() => {});
            },
            err => console.warn('[Reportes] Error en listener:', err.message)
        );

    return unsub;
}

// ═════════════════════════════════════════════════════════════
//  RENDER: LISTA DE REPORTES PUBLICADOS
// ═════════════════════════════════════════════════════════════

export function renderReportesPublicados() {
    const reportes = state.reportesPublicados || [];

    if (reportes.length === 0) {
        return `<div class="bg-white rounded-xl p-6 shadow-md text-center">
            <p style="font-size:0.8rem;color:var(--txt-muted);">Sin reportes publicados</p>
        </div>`;
    }

    let html = '<div class="space-y-2">';
    reportes.forEach((r, idx) => {
        const delay = Math.min(idx * 40, 300);
        html += `<div class="bg-white rounded-xl p-4 shadow-md"
            style="animation:cardIn 0.2s ease-out ${delay}ms both;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:0.83rem;color:var(--txt-primary);">
                        📊 ${escapeHtml(r.titulo)}
                    </div>
                    <div style="font-size:0.7rem;color:var(--txt-muted);margin-top:3px;">
                        ${escapeHtml(r.fecha)} · ${r.totalProductos || 0} productos
                        · Publicado por ${escapeHtml(r.publicadoPor || '—')}
                    </div>
                    <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;">
                        ${['almacen','barra1','barra2'].map(a => {
                            const st = (r.auditoriaStatus || {})[a];
                            return st === 'completada'
                                ? `<span style="font-size:0.60rem;font-weight:700;padding:1px 7px;border-radius:3px;background:var(--green-dim);color:var(--green-text);border:1px solid rgba(34,197,94,.20);">✓ ${AREAS[a]}</span>`
                                : `<span style="font-size:0.60rem;padding:1px 7px;border-radius:3px;background:rgba(148,163,184,.10);color:var(--txt-muted);">${AREAS[a]}</span>`;
                        }).join('')}
                    </div>
                </div>
                <button data-id="${escapeHtml(r._id)}"
                    onclick="window.descargarReporteExcel(this.dataset.id)"
                    style="padding:7px 12px;background:linear-gradient(135deg,#065f46,#047857);
                           border:1px solid rgba(34,197,94,.28);border-radius:var(--r-md);
                           color:#86efac;font-size:0.72rem;font-weight:600;cursor:pointer;
                           flex-shrink:0;white-space:nowrap;min-height:auto;">
                    ⬇️ Excel
                </button>
            </div>
        </div>`;
    });
    html += '</div>';
    return html;
}

// ─── Bindings globales ────────────────────────────────────────
window.openPublicarReporteModal = openPublicarReporteModal;
window.descargarReporteExcel    = descargarReporteExcel;
