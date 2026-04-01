/**
 * js/constants.js
 * ══════════════════════════════════════════════════════════════
 * Constantes de configuración: áreas, iconos y tolerancias.
 * Importar aquí evita valores mágicos dispersos por el código.
 * ══════════════════════════════════════════════════════════════
 */

/** Áreas operativas con nombre corto para el inventario regular */
export const AREAS = {
    almacen: 'Almacén',
    barra1:  'Barra 1',
    barra2:  'Barra 2',
};

/** Nombres corporativos de área para la Auditoría Física Ciega */
export const AREAS_AUDITORIA = {
    almacen: 'Almacén',
    barra1:  'Barra Restaurante',
    barra2:  'Barra Bar',
};

/** Emojis de área para la UI de auditoría */
export const AREAS_AUDITORIA_ICONS = {
    almacen: '📦',
    barra1:  '🍽️',
    barra2:  '🍸',
};

/** Clases FontAwesome 6 para los iconos de área */
export const AREAS_AUDITORIA_FA = {
    almacen: 'fa-solid fa-warehouse',
    barra1:  'fa-solid fa-utensils',
    barra2:  'fa-solid fa-martini-glass',
};

/**
 * Tolerancia de auditoría (botellas).
 * Si |max - min| > AUDIT_TOLERANCE y hay ≥ 2 conteos → se marca ERROR.
 * Ajustable según las necesidades del negocio.
 */
export const AUDIT_TOLERANCE = 0.2;

/** Claves de área en el orden canónico usado para export/sync */
export const AREA_KEYS = ['almacen', 'barra1', 'barra2'];

/** Unidades enteras (no permiten fracciones en la cantidad de pedido) */
export const INTEGER_UNITS = ['Piezas', 'Unidad', 'Botellas', 'Paquete', 'Tapas', 'Cartones'];

/** Umbral de alerta de almacenamiento localStorage (~4 MB de 5 MB) */
export const LS_WARN_BYTES = 4 * 1024 * 1024;

/** Milisegundos entre autoguardados inteligentes */
export const AUTO_SAVE_INTERVAL_MS = 30_000;

/** Milisegundos entre sincronizaciones periódicas de recuperación */
export const SYNC_RECOVERY_INTERVAL_MS = 3 * 60_000;

/** Tamaño máximo de chunk para subcolecciones Firestore */
export const MAX_CHUNK_SIZE = 80;

/** Conversión mililitros → onzas */
export const ML_POR_OZ = 29.5735;

/** Productos de ejemplo para la primera carga */
export const INITIAL_PRODUCTS = [
    { id: 'PRD-001', name: 'Vodka Premium',       stockByArea: { almacen: 12, barra1: 5, barra2: 3  }, unit: 'Botellas', group: 'Premium'  },
    { id: 'PRD-002', name: 'Ron Añejo',            stockByArea: { almacen: 8,  barra1: 4, barra2: 2  }, unit: 'Botellas', group: 'Premium'  },
    { id: 'PRD-003', name: 'Whisky Escocés',       stockByArea: { almacen: 4,  barra1: 2, barra2: 1  }, unit: 'Botellas', group: 'Premium'  },
    { id: 'PRD-004', name: 'Gin London Dry',       stockByArea: { almacen: 10, barra1: 3, barra2: 2  }, unit: 'Botellas', group: 'Premium'  },
    { id: 'PRD-005', name: 'Tequila Reposado',     stockByArea: { almacen: 3,  barra1: 2, barra2: 1  }, unit: 'Botellas', group: 'Premium'  },
    { id: 'PRD-006', name: 'Cerveza Nacional',     stockByArea: { almacen: 48, barra1: 24, barra2: 18 }, unit: 'Unidad',   group: 'Bebidas' },
    { id: 'PRD-007', name: 'Cerveza Importada',    stockByArea: { almacen: 18, barra1: 12, barra2: 6  }, unit: 'Unidad',   group: 'Bebidas' },
    { id: 'PRD-008', name: 'Vino Tinto Reserva',   stockByArea: { almacen: 15, barra1: 6,  barra2: 4  }, unit: 'Botellas', group: 'Vinos'   },
    { id: 'PRD-009', name: 'Vino Blanco',          stockByArea: { almacen: 12, barra1: 5,  barra2: 3  }, unit: 'Botellas', group: 'Vinos'   },
    { id: 'PRD-010', name: 'Coca Cola',            stockByArea: { almacen: 36, barra1: 20, barra2: 15 }, unit: 'Unidad',   group: 'Bebidas' },
    { id: 'PRD-011', name: 'Agua Mineral',         stockByArea: { almacen: 42, barra1: 25, barra2: 18 }, unit: 'Unidad',   group: 'Bebidas' },
    { id: 'PRD-012', name: 'Jugo de Naranja',      stockByArea: { almacen: 8,  barra1: 4,  barra2: 3  }, unit: 'Litros',   group: 'Bebidas' },
    { id: 'PRD-013', name: 'Limones',              stockByArea: { almacen: 5,  barra1: 2,  barra2: 1.5 }, unit: 'Kilos',  group: 'Frutas'  },
    { id: 'PRD-014', name: 'Hielo',                stockByArea: { almacen: 20, barra1: 10, barra2: 8  }, unit: 'Kilos',   group: 'Insumos' },
];
