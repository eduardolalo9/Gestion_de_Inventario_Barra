/**
 * js/excel-import.js — CORREGIDO
 *
 * NOTA: Este archivo existía en el repositorio pero:
 *   1. Nunca se importaba desde ningún otro módulo.
 *   2. Usaba `import * as XLSX from 'xlsx'` (bare specifier sin importmap) → roto.
 *   3. Usaba variables `db` y `firebase` que no existen en este proyecto.
 *
 * La importación de Excel YA está correctamente implementada en:
 *   → js/products.js → handleFileImport(event)
 *   → js/app.js      → delegación del evento 'change' en #fileInput
 *
 * Este archivo se deja vacío para evitar confusión.
 * NO importar este módulo desde ningún lado.
 */
