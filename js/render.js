/**
 * js/render.js — Motor de renderizado de tabs (SPA sin framework).
 * Genera HTML como strings y lo inyecta en #tabContent.
 */
import { state } from './state.js';
import { AREAS, AREAS_AUDITORIA, AREAS_AUDITORIA_FA, AREA_KEYS } from './constants.js';
import { escapeHtml, updateHeaderActions } from './ui.js';
import { saveToLocalStorage } from './storage.js';
import {
  filterByGroup, getAvailableGroups, getTotalStock
} from './products.js';
import {
  renderAuditTrailForProduct, renderAuditUserPanel,
  renderAuditComparePanel, auditoriaTotalAreasCompletadas,
  auditoriaTodasCompletas
} from './audit.js';
import { renderNotificacionesPanel } from './notificaciones.js';
import { renderAjustesPendientesPanel } from './ajustes.js';
import { renderReportesPublicados } from './reportes.js';

/* ── Utilidad de scroll/foco ─────────────────────────────────── */
function _getElementSelector(el) {
  if (!el || el === document.body) return null;
  if (el.id) return '#' + el.id;
  if (el.tagName === 'INPUT' && el.placeholder === 'Buscar...')
    return '#tabContent input[placeholder="Buscar..."]';
  const parent = el.closest('[data-render-key]');
  if (parent)
    return '[data-render-key="' + parent.dataset.renderKey + '"] ' + el.tagName.toLowerCase();
  return null;
}

/* ── Punto de entrada principal ──────────────────────────────── */
export function renderTab() {
  updateHeaderActions();
  const content = document.getElementById('tabContent');
  if (!content) return;

  const scrollY        = window.scrollY || window.pageYOffset;
  const focused        = document.activeElement;
  const focusedSelector = _getElementSelector(focused);
  const cursorPos      = (focused && focused.selectionStart !== undefined)
                         ? focused.selectionStart : null;
  const focusedValue   = (focused && focused.tagName === 'INPUT')
                         ? focused.value : null;

  content.style.animation = 'none';
  void content.offsetWidth;
  content.style.animation = '';

  switch (state.activeTab) {
    case 'inicio':          content.innerHTML = renderInicioTab();          break;
    case 'productos':       content.innerHTML = renderProductosTab();       break;
    case 'pedidos':         content.innerHTML = renderPedidosTab();         break;
    case 'inventario':      content.innerHTML = renderInventarioTab();      break;
    case 'historia':        content.innerHTML = renderHistoriaTab();        break;
    case 'notificaciones':  content.innerHTML = renderNotificacionesTab();  break;
    case 'ajustes':         content.innerHTML = renderAjustesTab();         break;
    default:
      console.warn('[Render] Tab desconocido:', state.activeTab, '— mostrando inicio.');
      state.activeTab = 'inicio';
      content.innerHTML = renderInicioTab();
      break;
  }

  requestAnimationFrame(() => {
    window.scrollTo(0, scrollY);
    if (focusedSelector) {
      const el = document.querySelector(focusedSelector);
      if (el) {
        el.focus();
        if (cursorPos !== null && el.tagName === 'INPUT') {
          try { el.setSelectionRange(cursorPos, cursorPos); } catch (_) {}
        }
        if (focusedValue !== null && el.tagName === 'INPUT' && el.value !== focusedValue) {
          el.value = focusedValue;
        }
      }
    }
  });
}

export function switchTab(tab) {
  state.activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const indicator = btn.querySelector('.tab-indicator');
    if (btn.dataset.tab === tab) {
      btn.classList.remove('text-gray-600');
      btn.classList.add('text-gray-900');
      if (!indicator) {
        const div = document.createElement('div');
        div.className =
          'tab-indicator absolute bottom-0 left-0 right-0 h-1 ' +
          'bg-gradient-to-r from-purple-500 to-orange-500 rounded-t-full animate-slideIn';
        btn.appendChild(div);
      }
    } else {
      btn.classList.remove('text-gray-900');
      btn.classList.add('text-gray-600');
      if (indicator) indicator.remove();
    }
  });

  document.querySelectorAll('.sb-item').forEach(btn => {
    if (btn.dataset.sbTab === tab) btn.classList.add('sb-active');
    else btn.classList.remove('sb-active');
  });

  saveToLocalStorage();
  renderTab();
}

/* ═══════════════════════════════════════════════════════════════
   TAB: INICIO
   ┌──────────────────────────────────┬───────┬──────┐
   │ Elemento                         │ admin │ user │
   ├──────────────────────────────────┼───────┼──────┤
   │ Stats + buscador + filtro grupo  │  ✓    │  ✓   │
   │ Botón "+ Producto"               │  ✓    │  ✗   │
   │ Botón "Importar Excel"           │  ✓    │  ✗   │
   │ Lista productos + stock          │  ✓    │  ✓   │
   │ Botón 🛒 Agregar al carrito      │  ✓    │  ✓   │
   │ Botón ✏️ Editar                  │  ✓    │  ✗   │
   │ Botón 🗑 Eliminar producto       │  ✓    │  ✗   │
   │ Botón "Eliminar todos"           │  ✓    │  ✗   │
   └──────────────────────────────────┴───────┴──────┘
═══════════════════════════════════════════════════════════════ */
function renderInicioTab() {
  const isAdmin      = state.userRole === 'admin';
  const filtered     = filterByGroup();
  const groups       = getAvailableGroups();
  const totalProducts = state.products.length;
  const totalStock   = state.products.reduce((s, p) => s + getTotalStock(p), 0);

  let html = '<div class="space-y-4">';

  /* ── Stats ── */
  html += '<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">';
  html += _statCard('📦', 'Productos',  totalProducts, 'var(--accent)');
  html += _statCard('📊', 'Stock total', totalStock.toFixed(1), 'var(--green)');
  html += _statCard('🛒', 'En carrito',
    state.cart.reduce((s, i) => s + i.quantity, 0).toFixed(1), 'var(--amber)');
  html += _statCard('📋', 'Pedidos', state.orders.length, 'var(--sky)');
  html += '</div>';

  /* ── Barra de filtros ── */
  html += '<div class="bg-white rounded-xl p-3 shadow-md flex flex-wrap gap-2 items-center">';

  html += `<input type="text" placeholder="Buscar..."
    value="${escapeHtml(state.searchTerm)}"
    oninput="window.updateSearchTerm(this.value)"
    class="flex-1 min-w-32 px-3 py-2 bg-white text-gray-900
           border border-gray-200 rounded text-sm">`;

  html += '<select onchange="window.updateSelectedGroup(this.value)" '
        + 'class="px-2 py-2 bg-white text-gray-900 border border-gray-200 rounded text-sm">';
  groups.forEach(g => {
    html += `<option value="${escapeHtml(g)}"${state.selectedGroup === g ? ' selected' : ''}>
      ${escapeHtml(g)}</option>`;
  });
  html += '</select>';

  /* Botones de admin — solo visibles para admin */
  if (isAdmin) {
    html += `<button onclick="window.openProductModal()"
      class="px-3 py-2 bg-gradient-to-r from-purple-500 to-blue-500
             text-white rounded text-sm font-semibold">
      + Producto
    </button>`;

    /* FIX: Importar Excel — visible en Inicio Y en Productos */
    html += `<button onclick="var fi=document.getElementById('fileInput'); fi.value=''; fi.click()"
        class="px-3 py-2 bg-gradient-to-r from-green-600 to-emerald-600
               text-white rounded text-sm font-semibold flex items-center gap-1"
        title="Importar catálogo desde Excel (.xlsx)">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
        </svg>
      📊 Importar Excel
    </button>`;
  } /* cierra if(isAdmin) */

  /* FIX Bug #3: cierre correcto del div de barra de filtros */
  html += '</div>';

  /* ── Lista de productos ── */
  if (filtered.length === 0) {
    html += '<div class="bg-white rounded-xl p-8 text-center shadow-md">'
          + '<p class="text-gray-500">No hay productos que mostrar</p></div>';
  } else {
    html += '<div class="space-y-2">';

    filtered.forEach((p, idx) => {
      const total = getTotalStock(p);
      const delay = Math.min(idx * 30, 300);

      /* Apertura card */
      html += `<div class="bg-white rounded-xl p-3 shadow-md"
        style="animation:cardIn 0.2s ease-out ${delay}ms both">`;

      html += '<div class="flex items-center gap-3">';

      /* Info producto */
      html += '<div class="flex-1 min-w-0">';
      html += `<div class="flex items-center gap-2 flex-wrap">
        <span class="font-semibold text-gray-900 text-sm">${escapeHtml(p.name)}</span>
        <span class="text-xs px-2 py-1 bg-purple-100 rounded text-purple-600">
          ${escapeHtml(p.group || 'General')}
        </span>
      </div>`;
      html += `<div class="text-xs text-gray-500 mt-1">
        ${escapeHtml(p.id)} · ${escapeHtml(p.unit || '')} ·
        Total: <strong>${total.toFixed(2)}</strong>
      </div>`;
      html += '</div>'; /* cierra flex-1 */

      /* Botones de acción */
      html += '<div class="flex gap-2 flex-shrink-0">';

      /* 🛒 Carrito — AMBOS roles */
      html += `<button data-id="${escapeHtml(p.id)}"
        onclick="window.addToCart(this.dataset.id)"
        class="p-2 bg-gradient-to-br from-purple-500 to-blue-500
               text-white rounded-lg text-xs"
        title="Agregar al carrito">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293
               c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4
               zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
        </svg>
      </button>`;

      /* 🔧 Solicitar ajuste — SOLO usuario (no admin; admin edita directamente) */
      if (!isAdmin) {
        html += `<button data-id="${escapeHtml(p.id)}"
          onclick="window.openAjusteModal(this.dataset.id)"
          class="p-2 bg-gradient-to-br from-blue-500 to-purple-500
                 text-white rounded-lg text-xs"
          title="Solicitar ajuste al administrador">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0
                 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0
                 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0
                 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0
                 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0
                 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0
                 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0
                 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07
                 2.572-1.065z"/><circle cx="12" cy="12" r="3"/>
          </svg>
        </button>`;
      }

      /* ✏️ Editar + 🗑 Eliminar — SOLO admin */
      if (isAdmin) {
        html += `<button data-id="${escapeHtml(p.id)}"
          onclick="window.editProduct(this.dataset.id)"
          class="p-2 bg-gradient-to-br from-blue-500 to-purple-500
                 text-white rounded-lg text-xs"
          title="Editar producto">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536
                 L6.5 21.036H3v-3.572L16.732 3.732z"/>
          </svg>
        </button>`;

        html += `<button data-id="${escapeHtml(p.id)}"
          onclick="window.deleteProduct(this.dataset.id)"
          class="p-2 bg-gradient-to-br from-red-500 to-orange-500
                 text-white rounded-lg text-xs"
          title="Eliminar producto">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0
                 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1
                 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </button>`;
      }

      html += '</div>'; /* cierra div.flex.gap-2 (botones) */
      html += '</div>'; /* cierra div.flex.items-center.gap-3 */

      /* Stock por área — AMBOS roles */
      html += '<div class="flex gap-2 mt-2">';
      AREA_KEYS.forEach(area => {
        const val = p.stockByArea && p.stockByArea[area] !== undefined
                    ? p.stockByArea[area] : 0;
        html += `<span class="text-xs px-2 py-1 rounded"
          style="background:var(--surface);color:var(--txt-secondary)">
          ${AREAS[area]}: <strong>${val.toFixed(2)}</strong>
        </span>`;
      });
      html += '</div>'; /* cierra div stock por área */

      html += '</div>'; /* FIX Bug #4: cierra card producto (explícito, separado) */
    });

    html += '</div>'; /* cierra div.space-y-2 */
  }

  /* ── "Eliminar todos" — SOLO admin ── */
  if (isAdmin && state.products.length > 0) {
    html += `<button onclick="window.deleteAllProducts()"
      class="w-full py-2 bg-gradient-to-r from-red-500 to-orange-500
             text-white rounded-lg text-sm font-semibold opacity-70
             hover:opacity-100 transition-opacity">
      Eliminar todos los productos
    </button>`;
  }

  html += '</div>'; /* cierra div.space-y-4 raíz */
  return html;
}
/* ─── FIN renderInicioTab ─────────────────────────────────────── */

/* ── Helper stat card ── */
function _statCard(emoji, label, value, color) {
  return `<div class="bg-white rounded-xl p-3 shadow-md text-center">
    <div style="font-size:1.5rem">${emoji}</div>
    <div class="text-xs text-gray-500 mt-1">${label}</div>
    <div class="font-bold text-lg" style="color:${color}">${value}</div>
  </div>`;
}

/* ── TAB: PRODUCTOS (alias de inicio) ── */
function renderProductosTab() { return renderInicioTab(); }

/* ═══════════════════════════════════════════════════════════════
   TAB: PEDIDOS — Solo historial de pedidos generados por WhatsApp.
   El catálogo para agregar al carrito está en Inicio (botón 🛒).
   Los pedidos NO se sincronizan a Firestore — quedan solo en
   el dispositivo (localStorage).
═══════════════════════════════════════════════════════════════ */
function renderPedidosTab() {
  const isAdmin = state.userRole === 'admin';

  let html = '<div class="space-y-4">';

  /* ── Encabezado de sección ── */
  html += `<div class="flex items-center justify-between">
    <h3 class="text-lg font-bold text-gray-900">
      📱 Pedidos por WhatsApp
    </h3>
    <span class="text-xs text-gray-400 italic">Solo en este dispositivo</span>
  </div>`;

  /* ── Sin pedidos ── */
  if (state.orders.length === 0) {
    html += `<div class="bg-white rounded-xl p-8 text-center shadow-md">
      <div style="font-size:2.5rem">🛒</div>
      <p class="text-gray-500 mt-2 font-medium">No hay pedidos todavía</p>
      <p class="text-xs text-gray-400 mt-1">
        Ve a Inicio, agrega productos al carrito con 🛒 y genera un pedido
      </p>
    </div>`;
    html += '</div>';
    return html;
  }

  /* ── Historial de pedidos ── */
  html += '<div class="space-y-4">';

  state.orders.forEach((order, idx) => {
    const delay = Math.min(idx * 50, 400);
    html += `<div class="bg-white rounded-2xl p-4 shadow-md"
      style="animation:tabContentIn 0.3s ease-out ${delay}ms both">`;

    html += `<div class="flex justify-between items-start mb-3">
      <div>
        <h3 class="text-base font-bold text-gray-900">${escapeHtml(order.id)}</h3>
        <p class="text-sm text-gray-600">Proveedor: ${escapeHtml(order.supplier)}</p>
        <p class="text-xs text-gray-500">Fecha: ${escapeHtml(order.date)}</p>
        ${order.deliveryDate
          ? `<p class="text-xs text-gray-500">Entrega: ${escapeHtml(order.deliveryDate)}</p>`
          : ''}
      </div>`;

    html += '<div class="flex gap-2">';

    /* Re-enviar por WhatsApp — AMBOS roles */
    html += `<button data-id="${escapeHtml(order.id)}"
      onclick="window.shareOrderWhatsApp(this.dataset.id)"
      title="Reenviar por WhatsApp"
      class="p-2 bg-gradient-to-br from-green-500 to-emerald-500
             text-white rounded-xl">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342
             m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316
             m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368
             2.684 3 3 0 00-5.368-2.684z"/>
      </svg>
    </button>`;

    /* Eliminar pedido — SOLO admin */
    if (isAdmin) {
      html += `<button data-id="${escapeHtml(order.id)}"
        onclick="window.deleteOrder(this.dataset.id)"
        title="Eliminar pedido"
        class="p-2 bg-gradient-to-br from-red-500 to-orange-500
               text-white rounded-xl">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0
               01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1
               1 0 00-1 1v3M4 7h16"/>
        </svg>
      </button>`;
    }

    html += '</div>'; /* cierra div.flex.gap-2 (botones) */
    html += '</div>'; /* cierra div.flex.justify-between */

    /* Tabla productos del pedido */
    html += '<div class="overflow-x-auto"><table class="w-full">'
          + '<thead class="bg-gradient-to-r from-purple-600 to-blue-600">'
          + '<tr>'
          + '<th class="px-3 py-2 text-left text-xs text-white">Producto</th>'
          + '<th class="px-3 py-2 text-center text-xs text-white">Unidad</th>'
          + '<th class="px-3 py-2 text-center text-xs text-white">Cantidad</th>'
          + '</tr></thead>'
          + '<tbody class="divide-y divide-gray-200">';

    order.products.forEach(p => {
      html += `<tr>
        <td class="px-3 py-2 text-gray-900 text-sm">${escapeHtml(p.name)}</td>
        <td class="px-3 py-2 text-center text-gray-600 text-sm">${escapeHtml(p.unit)}</td>
        <td class="px-3 py-2 text-center font-semibold text-gray-900 text-sm">
          ${p.quantity}
        </td>
      </tr>`;
    });

    html += '</tbody></table></div>';

    html += `<div class="mt-2 text-right">
      <span class="text-sm font-bold text-gray-900">
        Total: ${(order.total || 0).toFixed(2)}
      </span>
    </div>`;

    if (order.note) {
      html += `<div class="mt-2 p-2 bg-purple-50 rounded">
        <p class="text-xs text-gray-600">Nota: ${escapeHtml(order.note)}</p>
      </div>`;
    }

    html += '</div>'; /* cierra card pedido */
  });

  html += '</div>'; /* cierra div.space-y-4 (historial) */
  html += '</div>'; /* cierra div.space-y-4 raíz */
  return html;
}

/* ═══════════════════════════════════════════════════════════════
   TAB: INVENTARIO (Auditoría física ciega)
═══════════════════════════════════════════════════════════════ */
function renderInventarioTab() {
  if (state.auditoriaView === 'counting' && state.auditoriaAreaActiva)
    return renderAuditoriaConteo();
  return renderAuditoriaSeleccion();
}

function renderAuditoriaSeleccion() {
  const isAdmin       = state.userRole === 'admin';
  const totalCompletas = auditoriaTotalAreasCompletadas();
  const porcentaje    = Math.round((totalCompletas / 3) * 100);
  const todasCompletas = auditoriaTodasCompletas();

  let html = '<div class="audit-screen">';

  /* Header + barra de progreso */
  html += '<div class="bg-white rounded-xl p-4 sm:p-5 mb-4 shadow-md">';
  html += '<div class="flex items-start justify-between gap-3 mb-3"><div>';
  html += '<p class="audit-header-title">Auditoría Física Ciega</p>';
  html += '<p class="audit-header-sub">Seleccione el área de auditoría para iniciar el conteo físico.</p>';
  html += '</div>';

  html += `<button onclick="window.auditoriaResetear()"
    title="Iniciar nueva auditoría"
    style="flex-shrink:0;padding:6px 10px;border-radius:var(--r-md);
           background:var(--red-dim);border:1px solid rgba(239,68,68,0.18);
           color:var(--red-text);font-size:0.7rem;font-weight:600;cursor:pointer;"
    class="flex items-center gap-1">
    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581
           m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
    </svg>
    Nueva auditoría
  </button>`;

  html += '</div>'; /* cierra div.flex.items-start */

  /* Barra de progreso */
  html += `<div class="flex items-center gap-3">
    <div style="font-size:0.68rem;font-weight:600;color:var(--txt-muted);white-space:nowrap;">
      ${totalCompletas} / 3 áreas
    </div>
    <div class="audit-progress-bar" style="flex:1;">
      <div class="audit-progress-fill" style="width:${porcentaje}%;"></div>
    </div>
    <div style="font-size:0.68rem;font-weight:700;
                color:${todasCompletas ? 'var(--green)' : 'var(--accent)'};
                white-space:nowrap;">
      ${porcentaje}%
    </div>
  </div>`;

  html += '</div>'; /* cierra div.bg-white (header) */

  /* Paneles */
  html += renderAuditUserPanel();
  html += renderAuditComparePanel();

  /* Cards de área */
  html += '<div class="flex flex-col gap-3 mb-4">';
  ['almacen', 'barra1', 'barra2'].forEach(area => {
    const isCompleta = state.auditoriaStatus[area] === 'completada';
    html += `<div class="audit-area-card${isCompleta ? ' completada' : ''}"
      onclick="window.auditoriaEntrarArea('${area}')"
      role="button" tabindex="0"
      onkeydown="if(event.key==='Enter'||event.key===' ')
                 {event.preventDefault();window.auditoriaEntrarArea('${area}')}">`;
    html += `<div class="audit-area-icon">
      <i class="${AREAS_AUDITORIA_FA[area]}"></i>
    </div>`;
    html += `<div class="audit-area-info">
      <div class="audit-area-name">${AREAS_AUDITORIA[area]}</div>
      <span class="audit-area-status ${isCompleta ? 'completada' : 'pendiente'}">
        ${isCompleta ? '✓ Completada' : '⏳ Pendiente'}
      </span>
    </div>`;
    html += `<svg class="audit-area-arrow w-5 h-5" fill="none" stroke="currentColor"
      viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M9 5l7 7-7 7"/>
    </svg>`;
    html += '</div>'; /* cierra audit-area-card */
  });
  html += '</div>'; /* cierra div.flex.flex-col (cards área) */

  /* Botón exportar — SOLO admin */
  if (todasCompletas && isAdmin) {
    html += `<button onclick="window.exportarAuditoriaExcel()"
      class="audit-export-btn">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
      </svg>
      Exportar Auditoría a Excel
    </button>`;
  }

  html += '</div>'; /* cierra div.audit-screen */
  return html;
}

function renderAuditoriaConteo() {
  const area      = state.auditoriaAreaActiva;
  const areaLabel = AREAS_AUDITORIA[area];
  const filtered  = filterByGroup();

  let html = '<div>';

  /* Header sticky */
  html += '<div class="audit-count-header">';
  html += `<div class="flex items-center gap-2 mb-2">
    <button onclick="window.auditoriaVolverSeleccion()" class="audit-back-btn">
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
          d="M15 19l-7-7 7-7"/>
      </svg>Volver
    </button>
    <span class="audit-count-area-badge">
      <i class="${AREAS_AUDITORIA_FA[area]}"></i>${areaLabel}
    </span>
  </div>`;
  html += `<p style="font-size:0.7rem;color:var(--txt-muted);">
    Conteo ciego · ${filtered.length} productos
  </p>`;
  html += '</div>'; /* cierra audit-count-header */

  /* Búsqueda + filtro por grupo */
  const _invGroups = getAvailableGroups();
  html += `<div class="mb-3 flex gap-2">
    <input type="text" placeholder="Buscar..."
      value="${escapeHtml(state.searchTerm)}"
      oninput="window.updateSearchTerm(this.value)"
      class="flex-1 min-w-0 px-3 py-2 bg-white text-gray-900 border border-gray-200
             rounded-lg text-sm">
    <select onchange="window.updateSelectedGroup(this.value)"
      class="px-2 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg text-sm flex-shrink-0">`;
  _invGroups.forEach(g => {
    html += `<option value="${escapeHtml(g)}"${state.selectedGroup === g ? ' selected' : ''}>${escapeHtml(g)}</option>`;
  });
  html += `</select>
  </div>`;

  /* Tarjetas de producto */
  html += '<div class="space-y-2">';
  filtered.forEach(p => {
    const conteo   = state.auditoriaConteo[p.id]?.[area] || { enteras: 0, abiertas: [] };
    const hasCount = conteo.enteras > 0 ||
                     (conteo.abiertas && conteo.abiertas.some(a => a > 0));

    html += `<div class="bg-white rounded-xl p-3 shadow-md border
      ${hasCount ? 'border-green-400/40' : 'border-transparent'}"
      data-id="${escapeHtml(p.id)}"
      onclick="window.openInventarioModal(this.dataset.id)"
      style="cursor:pointer;">`;

    html += '<div class="flex items-center justify-between">';
    html += `<div class="flex-1 min-w-0">
      <span class="font-medium text-sm text-gray-900">${escapeHtml(p.name)}</span>
      <div class="text-xs text-gray-500 mt-0.5">
        ${escapeHtml(p.group || 'General')} · ${escapeHtml(p.unit || '')}
      </div>
    </div>`;

    html += '<div class="flex-shrink-0 ml-2">';
    if (hasCount) {
      html += `<div class="text-right">
        <div class="text-sm font-bold text-green-600">${conteo.enteras} ent.</div>`;
      if (conteo.abiertas && conteo.abiertas.some(a => a > 0)) {
        html += `<div class="text-xs text-amber-500">
          + ${conteo.abiertas.filter(a => a > 0).length} ab.
        </div>`;
      }
      html += '</div>';
    } else {
      html += '<span class="text-xs text-gray-400 italic">Sin contar</span>';
    }
    html += '</div>'; /* cierra flex-shrink-0 */
    html += '</div>'; /* cierra flex.items-center */

    html += renderAuditTrailForProduct(p.id, area);
    html += '</div>'; /* cierra card producto conteo */
  });
  html += '</div>'; /* cierra div.space-y-2 */

  html += `<button onclick="window.auditoriaFinalizarConteo()"
    class="audit-finish-btn">
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M5 13l4 4L19 7"/>
    </svg>
    Finalizar conteo de ${areaLabel}
  </button>`;

  html += '</div>'; /* cierra div raíz */
  return html;
}

/* ═══════════════════════════════════════════════════════════════
   TAB: HISTORIA
   ┌──────────────────────────────────┬───────┬──────┐
   │ Elemento                         │ admin │ user │
   ├──────────────────────────────────┼───────┼──────┤
   │ Selector de área                 │  ✓    │  ✓   │
   │ "💾 Guardar inventario"          │  ✓    │  ✓   │
   │ "📊 Excel" (exportar)            │  ✓    │  ✗   │
   │ "🗑 Reset" (borrar todo)         │  ✓    │  ✗   │
   │ Lista de inventarios guardados   │  ✓    │  ✓   │
   │ Botón compartir WhatsApp         │  ✓    │  ✓   │
   │ Botón eliminar inventario        │  ✓    │  ✗   │
   └──────────────────────────────────┴───────┴──────┘
═══════════════════════════════════════════════════════════════ */
function renderHistoriaTab() {
  const isAdmin = state.userRole === 'admin';

  let html = '<div class="space-y-4">';

  /* ── Guardar conteo actual ── */
  html += '<div class="bg-white rounded-xl p-4 shadow-md">';
  html += '<h3 class="text-lg font-bold text-gray-900 mb-3">Guardar conteo actual</h3>';

  /* Selector de área — AMBOS roles */
  html += '<div class="flex gap-2 flex-wrap mb-3">';
  AREA_KEYS.forEach(area => {
    const isActive = state.selectedArea === area;
    html += `<button onclick="window.switchArea('${area}')"
      class="area-btn px-3 py-2 rounded-lg text-sm font-medium border ${
        isActive
          ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white border-transparent'
          : 'border-gray-200 text-gray-600'
      }">
      ${AREAS[area]}
    </button>`;
  });
  html += '</div>'; /* cierra div.flex.gap-2 (selector área) */

  /* Guardar — AMBOS roles */
  html += `<button onclick="window.saveInventory('${state.selectedArea}')"
    class="w-full py-2 bg-gradient-to-r from-green-500 to-emerald-500
           text-white rounded-lg font-semibold text-sm">
    💾 Guardar inventario de ${AREAS[state.selectedArea]}
  </button>`;

  html += '</div>'; /* cierra div.bg-white (guardar conteo) */

  /* Excel + Reset — SOLO admin */
  if (isAdmin) {
    html += `<div class="flex gap-2 mb-2">
      <button onclick="window.exportToExcel('INVENTARIO')"
        class="flex-1 py-2 bg-gradient-to-r from-green-600 to-emerald-600
               text-white rounded-lg text-sm font-semibold">
        📊 Excel
      </button>
      <button onclick="window.resetAllInventario()"
        class="flex-1 py-2 bg-gradient-to-r from-red-500 to-orange-500
               text-white rounded-lg text-sm font-semibold">
        🗑 Reset
      </button>
    </div>`;
  }

  /* ── Listado de inventarios guardados ── */
  if (state.inventories.length === 0) {
    html += '<div class="bg-white rounded-xl p-8 text-center shadow-md">'
          + '<p class="text-gray-500">No hay inventarios guardados</p></div>';
  } else {
    html += '<div class="space-y-3">';
    state.inventories.forEach((inv, idx) => {
      const delay = Math.min(idx * 50, 400);
      html += `<div class="bg-white rounded-xl p-4 shadow-md"
        style="animation:tabContentIn 0.3s ease-out ${delay}ms both">`;

      html += `<div class="flex justify-between items-start mb-2">
        <div>
          <h3 class="font-bold text-gray-900 text-sm">${escapeHtml(inv.id)}</h3>
          <p class="text-xs text-gray-500">
            ${escapeHtml(inv.date)} · ${escapeHtml(AREAS[inv.area] || inv.area)}
          </p>
        </div>`;

      html += '<div class="flex gap-2">';

      /* Compartir WhatsApp — AMBOS roles */
      html += `<button data-id="${escapeHtml(inv.id)}"
        onclick="window.shareInventoryWhatsApp(this.dataset.id)"
        class="p-2 bg-gradient-to-br from-green-500 to-emerald-500
               text-white rounded-lg"
        title="Compartir por WhatsApp">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342
               m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316
               m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368
               2.684 3 3 0 00-5.368-2.684z"/>
        </svg>
      </button>`;

      /* Eliminar inventario — SOLO admin */
      if (isAdmin) {
        html += `<button data-id="${escapeHtml(inv.id)}"
          onclick="window.deleteInventory(this.dataset.id)"
          class="p-2 bg-gradient-to-br from-red-500 to-orange-500
                 text-white rounded-lg"
          title="Eliminar registro">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0
                 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1
                 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </button>`;
      }

      html += '</div>'; /* cierra div.flex.gap-2 (botones inventario) */
      html += '</div>'; /* cierra div.flex.justify-between */

      html += `<p class="text-xs text-gray-600">
        Total: <strong>${(inv.totalProducts || 0).toFixed(2)}</strong>
        · ${(inv.products || []).length} productos
      </p>`;

      html += '</div>'; /* cierra card inventario */
    });
    html += '</div>'; /* cierra div.space-y-3 */
  }

  /* ── Toggle de sincronización — AMBOS roles ── */
  html += '<div class="bg-white rounded-xl p-4 shadow-md">';
  html += '<h3 class="text-sm font-bold text-gray-900 mb-3">⚙️ Control de sincronización</h3>';
  const syncOn = state.syncEnabled !== false;
  html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
    <div>
      <div style="font-size:0.8rem;font-weight:600;color:var(--txt-primary);">
        ${syncOn ? '☁️ Sincronización activa' : '📴 Sincronización pausada'}
      </div>
      <div style="font-size:0.7rem;color:var(--txt-muted);margin-top:2px;">
        ${syncOn
          ? 'Los datos se suben automáticamente a la nube.'
          : 'Los datos se guardan solo localmente hasta que actives la sync.'}
      </div>
    </div>
    <button onclick="window.toggleSync()"
      style="padding:8px 16px;border-radius:var(--r-md);font-size:0.78rem;font-weight:600;
             cursor:pointer;min-height:auto;flex-shrink:0;
             background:${syncOn ? 'var(--red-dim)' : 'var(--accent-dim)'};
             border:1px solid ${syncOn ? 'rgba(239,68,68,.22)' : 'var(--accent-dim2)'};
             color:${syncOn ? 'var(--red-text)' : 'var(--accent)'};">
      ${syncOn ? '⏸ Pausar' : '▶ Activar'}
    </button>
  </div>`;
  html += '</div>';

  /* ── Reportes publicados — AMBOS roles ── */
  html += '<h3 class="text-base font-bold text-gray-900">📊 Reportes publicados</h3>';

  /* Botón publicar — SOLO admin */
  if (isAdmin) {
    html += `<button onclick="window.openPublicarReporteModal()"
      style="width:100%;padding:10px;background:linear-gradient(135deg,#065f46,#047857);
             border:1px solid rgba(34,197,94,.28);border-radius:var(--r-lg);
             color:#86efac;font-size:0.82rem;font-weight:600;cursor:pointer;
             display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px;">
      📊 Generar y publicar reporte final
    </button>`;
  }

  html += renderReportesPublicados();

  html += '</div>'; /* cierra div.space-y-4 raíz */
  return html;
}

/* ═══════════════════════════════════════════════════════════════
   TAB: NOTIFICACIONES
═══════════════════════════════════════════════════════════════ */
function renderNotificacionesTab() {
  let html = '<div class="space-y-3">';
  html += renderNotificacionesPanel();
  html += '</div>';
  return html;
}

/* ═══════════════════════════════════════════════════════════════
   TAB: AJUSTES  (admin ve pendientes; usuario ve historial propio)
═══════════════════════════════════════════════════════════════ */
function renderAjustesTab() {
  const isAdmin = state.userRole === 'admin';
  let html = '<div class="space-y-3">';

  if (isAdmin) {
    const count = state.ajustesPendientes?.length || 0;
    html += `<div class="bg-white rounded-xl p-4 shadow-md">
      <h3 class="text-sm font-bold text-gray-900 mb-3">
        🔧 Ajustes pendientes
        ${count > 0 ? `<span style="background:var(--accent);color:#fff;border-radius:10px;
          padding:1px 7px;font-size:0.60rem;margin-left:4px;">${count}</span>` : ''}
      </h3>
      ${renderAjustesPendientesPanel()}
    </div>`;
  } else {
    /* Usuario: cola local pendiente de subir */
    const pending = state.adjustmentsPending || [];
    html += '<div class="bg-white rounded-xl p-4 shadow-md">';
    html += '<h3 class="text-sm font-bold text-gray-900 mb-2">📤 Mis ajustes enviados</h3>';
    if (pending.length === 0) {
      html += '<p style="font-size:0.78rem;color:var(--txt-muted);">Sin ajustes pendientes</p>';
    } else {
      pending.forEach(a => {
        html += `<div style="background:var(--surface);border:1px solid var(--border);
                              border-radius:var(--r-md);padding:8px 12px;margin-bottom:6px;
                              font-size:0.75rem;color:var(--txt-secondary);">
          <strong style="color:var(--txt-primary);">${escapeHtml(a.productoName)}</strong>
          · ${escapeHtml(a.campoLabel)}: ${escapeHtml(a.valorAnterior || '—')} → ${escapeHtml(a.valorNuevo)}
          <span style="margin-left:6px;font-size:0.65rem;color:var(--amber);">⏳ Pendiente de subir</span>
        </div>`;
      });
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/* ── Bindings globales ── */
window.switchTab = switchTab;
window.renderTab = renderTab;