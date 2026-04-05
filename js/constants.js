// constants.js — v2.2 CORREGIDO
// ══════════════════════════════════════════════════════════════
// Configuración Global y Reglas de Negocio
//
// CORRECCIONES v2.2:
// • Añadidos AREA_KEYS, MAX_CHUNK_SIZE, AREAS, AREAS_AUDITORIA,
//   AREAS_AUDITORIA_FA, AUDIT_TOLERANCE, CAMPOS_AJUSTABLES —
//   todos importados por sync.js, render.js, audit.js, ajustes.js
//   y reportes.js pero que NO estaban definidos aquí → crash al arrancar.
// • Añadidos AUTO_SAVE_INTERVAL_MS, SYNC_RECOVERY_INTERVAL_MS
//   e INITIAL_PRODUCTS importados por app.js.
// ══════════════════════════════════════════════════════════════

// ─── 1. Pesos de Referencia ────────────────────────────────────
export const PESO_BOTELLA_VACIA_OZ = 25.0;

// ─── 2. Factores de Conversión ────────────────────────────────
export const OZ_A_ML = 29.5735;

// ─── 3. Roles de Usuario ──────────────────────────────────────
export const ROLES = {
    ADMIN: 'admin',
    USUARIO: 'usuario',
};

// ─── 4. Estados de Sincronización ────────────────────────────
export const SYNC_STATUS = {
    PENDIENTE:     'pendiente',
    SINCRONIZADO:  'sincronizado',
    ERROR:         'error',
};

// ─── 5. Categorías de Inventario ─────────────────────────────
export const CATEGORIAS = [
    'Destilados',
    'Vinos',
    'Cervezas',
    'Refrescos',
    'Cristalería',
    'Insumos',
];

// ─── 6. Configuración de Almacenamiento Local ─────────────────
export const LOCAL_STORAGE_KEYS = {
    CONTEOS_PENDIENTES:  'inventario_offline_queue',
    CATALOGO_PRODUCTOS:  'inventario_catalogo_cache',
    SESION_USUARIO:      'inventario_user_session',
};

// ─── 7. Estructura base de un Producto ────────────────────────
export const PRODUCTO_TEMPLATE = {
    id:             '',
    nombre:         '',
    capacidad_ml:   750,
    peso_lleno_oz:  0,
    peso_vacio_oz:  PESO_BOTELLA_VACIA_OZ,
    categoria:      '',
    activo:         true,
};

// ═════════════════════════════════════════════════════════════
// NUEVAS CONSTANTES — NECESARIAS PARA EL CORRECTO FUNCIONAMIENTO
// ═════════════════════════════════════════════════════════════

// ─── 8. Áreas de inventario (clave de sistema) ────────────────
// Usado por: sync.js, render.js, products.js, reportes.js
// CRÍTICO: el orden importa — coincide con el orden de areaSnaps en syncToCloud
export const AREA_KEYS = ['almacen', 'barra1', 'barra2'];

// ─── 9. Etiquetas legibles de áreas (inventario operativo) ────
// Usado por: render.js, reportes.js
export const AREAS = {
    almacen: 'Almacén',
    barra1:  'Barra 1',
    barra2:  'Barra 2',
};

// ─── 10. Etiquetas legibles de áreas (auditoría) ─────────────
// Usado por: render.js, audit.js
// Separado de AREAS para permitir nombres distintos en auditoría
export const AREAS_AUDITORIA = {
    almacen: 'Almacén',
    barra1:  'Barra 1',
    barra2:  'Barra 2',
};

// ─── 11. Íconos Font Awesome por área (auditoría) ─────────────
// Usado por: render.js — se inyecta en <i class="...">
export const AREAS_AUDITORIA_FA = {
    almacen: 'fa-solid fa-warehouse',
    barra1:  'fa-solid fa-martini-glass',
    barra2:  'fa-solid fa-champagne-glasses',
};

// ─── 12. Tamaño máximo de chunk para Firestore ────────────────
// Usado por: sync.js — _writeChunkedSubcollection
// Firestore límite por documento: 1 MB. 50 productos/chunk es seguro.
export const MAX_CHUNK_SIZE = 50;

// ─── 13. Tolerancia de auditoría (oz) ────────────────────────
// Usado por: audit.js — comparación de totales entre usuarios
// Si la diferencia en oz entre conteos es menor a esto, no se reporta conflicto
export const AUDIT_TOLERANCE = 0.05;

// ─── 14. Campos ajustables por usuarios (solicitudes) ─────────
// Usado por: ajustes.js — openAjusteModal, solicitarAjuste
// Mapa: campo (clave en objeto producto) → etiqueta legible
export const CAMPOS_AJUSTABLES = {
    capacidadMl:        'Capacidad (mL)',
    pesoBotellaLlenaOz: 'Peso Lleno (oz)',
    name:               'Nombre del producto',
    unit:               'Unidad de medida',
    group:              'Categoría / Grupo',
};

// ─── 15. Intervalos de auto-guardado y sync de recuperación ───
// Usado por: app.js — setInterval
export const AUTO_SAVE_INTERVAL_MS      = 30_000;   // 30 segundos
export const SYNC_RECOVERY_INTERVAL_MS  = 180_000;  // 3 minutos

// ─── 16. Productos de ejemplo (primera ejecución) ─────────────
// Usado por: app.js — cuando state.products.length === 0
export const INITIAL_PRODUCTS = [
    {
        id:                 'PRD-001',
        name:               'Bacardí Blanco',
        unit:               'Botella',
        group:              'Destilados',
        stockByArea:        { almacen: 0, barra1: 0, barra2: 0 },
        capacidadMl:        750,
        pesoBotellaLlenaOz: 55.0,
    },
    {
        id:                 'PRD-002',
        name:               'Jack Daniel\'s',
        unit:               'Botella',
        group:              'Destilados',
        stockByArea:        { almacen: 0, barra1: 0, barra2: 0 },
        capacidadMl:        750,
        pesoBotellaLlenaOz: 58.0,
    },
    {
        id:                 'PRD-003',
        name:               'Absolut Vodka',
        unit:               'Botella',
        group:              'Destilados',
        stockByArea:        { almacen: 0, barra1: 0, barra2: 0 },
        capacidadMl:        750,
        pesoBotellaLlenaOz: 52.0,
    },
    {
        id:                 'PRD-004',
        name:               'Corona',
        unit:               'Caja 24',
        group:              'Cervezas',
        stockByArea:        { almacen: 0, barra1: 0, barra2: 0 },
        capacidadMl:        null,
        pesoBotellaLlenaOz: null,
    },
    {
        id:                 'PRD-005',
        name:               'Coca-Cola 600ml',
        unit:               'Botella',
        group:              'Refrescos',
        stockByArea:        { almacen: 0, barra1: 0, barra2: 0 },
        capacidadMl:        null,
        pesoBotellaLlenaOz: null,
    },
];
