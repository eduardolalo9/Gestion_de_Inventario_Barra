/**
 * js/products.js — v2.2 CORREGIDO
 * ══════════════════════════════════════════════════════════════
 * Gestión de productos: CRUD, importación Excel, cálculos de
 * stock, sincronización de conteo desde la nube.
 *
 * EXPORTS:
 *   - syncStockByAreaFromConteo()    → sync.js
 *   - calcularTotalConAbiertas()     → reportes.js
 *   - calcularContenidoMl()          → reportes.js, render.js
 *   - handleFileImport()             → app.js (delegación de eventos)
 *   - importFullData()               → app.js (delegación de eventos) ← NUEVO
 *   - addProduct()                   → render.js
 *   - updateProduct()                → render.js
 *   - deleteProduct()                → render.js
 *   - getProductById()               → varios módulos
 *   - getProductsByGroup()           → render.js
 *   - getUniqueGroups()              → render.js
 *   - filterByGroup()                → render.js ← NUEVO
 *   - getAvailableGroups()           → render.js ← NUEVO
 *   - getTotalStock()                → render.js ← NUEVO
 *   - parseExcelNumber()             → helper público
 *
 * CORRECCIONES v2.2:
 * • Añadido import de AREA_KEYS desde constants.js — se usaba en
 *   calcularStockTotal, syncStockByAreaFromConteo y ajustarProducto
 *   pero NO estaba importado → ReferenceError en runtime.
 * • Añadida filterByGroup() — importada por render.js pero no existía.
 * • Añadida getAvailableGroups() — importada por render.js pero no existía.
 * • Añadida getTotalStock(p) — importada por render.js pero no existía.
 * • Añadida importFullData(event) — importada por app.js pero no existía.
 * ══════════════════════════════════════════════════════════════
 */

// ═══ IMPORTS ══════════════════════════════════════════════════
import { state }                from './state.js';
import { showNotification }     from './ui.js';
import { saveToLocalStorage }   from './storage.js';
import { PESO_BOTELLA_VACIA_OZ,
         AREA_KEYS }            from './constants.js'; // FIX: AREA_KEYS no estaba importado

// ═════════════════════════════════════════════════════════════
// HELPER: parsear números de Excel
// ═════════════════════════════════════════════════════════════

export function parseExcelNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;

  let str = String(value).trim();
  str = str.replace(/\s/g, '');

  // Formato europeo: 1.234,56 → 1234.56
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(str)) {
    str = str.replace(/\./g, '').replace(',', '.');
  }
  // Coma decimal simple: 12,5 → 12.5
  else if (/^\d+,\d+$/.test(str)) {
    str = str.replace(',', '.');
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// ═════════════════════════════════════════════════════════════
// CRUD DE PRODUCTOS
// ═════════════════════════════════════════════════════════════

/**
 * Busca un producto por ID.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getProductById(id) {
  return state.products.find(p => p.id === id);
}

/**
 * Devuelve las categorías únicas de los productos actuales.
 * @returns {string[]}
 */
export function getUniqueGroups() {
  const groups = new Set(state.products.map(p => p.group || 'General'));
  return ['Todos', ...Array.from(groups).sort()];
}

/**
 * Filtra productos por grupo (categoría).
 * @param {string} group — 'Todos' devuelve todos
 * @returns {object[]}
 */
export function getProductsByGroup(group = 'Todos') {
  if (group === 'Todos') return [...state.products];
  return state.products.filter(p => (p.group || 'General') === group);
}

// ─────────────────────────────────────────────────────────────
// FIX CRÍTICO: funciones importadas por render.js que no existían
// ─────────────────────────────────────────────────────────────

/**
 * filterByGroup() — FIX v2.2
 * ──────────────────────────────────────────────────────────────
 * Filtra los productos del estado aplicando el grupo seleccionado
 * (state.selectedGroup) Y el término de búsqueda (state.searchTerm).
 *
 * render.js la usa como:
 *   const filtered = filterByGroup();
 *
 * Era importada desde './products.js' pero NO existía →
 * SyntaxError al cargar render.js → pantalla en blanco.
 *
 * @returns {object[]} productos filtrados
 */
export function filterByGroup() {
  let products = getProductsByGroup(state.selectedGroup || 'Todos');

  const term = (state.searchTerm || '').toLowerCase().trim();
  if (term) {
    products = products.filter(p =>
      (p.name  || '').toLowerCase().includes(term) ||
      (p.id    || '').toLowerCase().includes(term) ||
      (p.group || '').toLowerCase().includes(term) ||
      (p.unit  || '').toLowerCase().includes(term)
    );
  }

  return products;
}

/**
 * getAvailableGroups() — FIX v2.2
 * ──────────────────────────────────────────────────────────────
 * Devuelve los grupos disponibles para el selector de filtro.
 * Alias de getUniqueGroups() con el nombre que render.js espera.
 *
 * Era importada desde './products.js' pero NO existía →
 * SyntaxError al cargar render.js → pantalla en blanco.
 *
 * @returns {string[]} ['Todos', 'Destilados', ...]
 */
export function getAvailableGroups() {
  return getUniqueGroups();
}

/**
 * getTotalStock(product) — FIX v2.2
 * ──────────────────────────────────────────────────────────────
 * Devuelve el stock total de un producto en TODAS las áreas.
 *
 * render.js la usa como:
 *   const total = getTotalStock(p);          // número simple
 *   const totalStock = state.products.reduce((s, p) => s + getTotalStock(p), 0);
 *
 * Era importada desde './products.js' pero NO existía →
 * SyntaxError al cargar render.js → pantalla en blanco.
 *
 * @param {object} product — objeto producto de state.products
 * @returns {number} suma de stock en las 3 áreas (con decimales)
 */
export function getTotalStock(product) {
  if (!product) return 0;

  // Sumar stockByArea si está disponible (modo inventario operativo)
  if (product.stockByArea) {
    let total = 0;
    AREA_KEYS.forEach(area => {
      total += parseFloat(product.stockByArea[area] || 0);
    });
    return parseFloat(total.toFixed(4));
  }

  // Fallback: calcular desde conteos de auditoría
  return calcularStockTotal(product.id).total;
}

// ─────────────────────────────────────────────────────────────
// FIN FIXES de render.js
// ─────────────────────────────────────────────────────────────

/**
 * Agrega un nuevo producto al catálogo.
 * @param {object} productData — { name, unit, group, capacidadMl?, pesoBotellaLlenaOz? }
 * @returns {object} producto creado
 */
export function addProduct(productData) {
  // Generar ID único
  let maxNum = 0;
  state.products.forEach(p => {
    const m = String(p.id).match(/^PRD-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  const id = 'PRD-' + String(maxNum + 1).padStart(3, '0');

  const product = {
    id,
    name:        (productData.name  || 'Sin nombre').trim(),
    unit:        (productData.unit  || 'Unidad').trim(),
    group:       (productData.group || 'General').trim(),
    stockByArea: { almacen: 0, barra1: 0, barra2: 0 },
  };

  if (productData.capacidadMl > 0) {
    product.capacidadMl = parseFloat(productData.capacidadMl);
  }
  if (productData.pesoBotellaLlenaOz > 0) {
    product.pesoBotellaLlenaOz = parseFloat(productData.pesoBotellaLlenaOz);
  }

  state.products.push(product);
  saveToLocalStorage();
  showNotification(`✅ Producto "${product.name}" agregado`);
  console.info('[Products] Producto creado:', id, product.name);
  return product;
}

/**
 * Actualiza un producto existente.
 * @param {string} id
 * @param {object} updates — campos a actualizar
 * @returns {object|null}
 */
export function updateProduct(id, updates) {
  const product = state.products.find(p => p.id === id);
  if (!product) {
    showNotification('⚠️ Producto no encontrado');
    return null;
  }

  if (updates.name  !== undefined) product.name  = String(updates.name).trim();
  if (updates.unit  !== undefined) product.unit  = String(updates.unit).trim();
  if (updates.group !== undefined) product.group = String(updates.group).trim();
  if (updates.capacidadMl !== undefined) {
    product.capacidadMl = parseFloat(updates.capacidadMl) || null;
  }
  if (updates.pesoBotellaLlenaOz !== undefined) {
    product.pesoBotellaLlenaOz = parseFloat(updates.pesoBotellaLlenaOz) || null;
  }
  if (updates.stockByArea) {
    product.stockByArea = { ...product.stockByArea, ...updates.stockByArea };
  }

  saveToLocalStorage();
  console.info('[Products] Producto actualizado:', id);
  return product;
}

/**
 * Elimina un producto por ID.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteProduct(id) {
  const index = state.products.findIndex(p => p.id === id);
  if (index === -1) {
    showNotification('⚠️ Producto no encontrado');
    return false;
  }

  const name = state.products[index].name;
  state.products.splice(index, 1);

  // Limpiar datos de conteo asociados (evita datos huérfanos)
  delete state.inventarioConteo[id];
  delete state.auditoriaConteo[id];
  delete state.auditoriaConteoPorUsuario[id];

  saveToLocalStorage();
  showNotification(`🗑️ "${name}" eliminado`);
  console.info('[Products] Producto eliminado:', id, name);
  return true;
}

// ═════════════════════════════════════════════════════════════
// tieneConversion() — FIX: faltaba export, reportes.js la importa
// ═════════════════════════════════════════════════════════════

/**
 * tieneConversion(product) — FIX v2.3
 * ──────────────────────────────────────────────────────────────
 * Indica si un producto tiene datos suficientes para convertir
 * unidades a mililitros (requiere capacidadMl definida y > 0).
 *
 * reportes.js la usa como:
 *   const totalMl = tieneConversion(p) ? Math.round(totalGeneral * p.capacidadMl) : null;
 *
 * Era importada desde './products.js' pero NO existía →
 * "does not provide an export named 'tieneConversion'" → crash.
 *
 * @param {object} product — objeto producto de state.products
 * @returns {boolean}
 */
export function tieneConversion(product) {
  return !!(product && product.capacidadMl && product.capacidadMl > 0);
}

// ═════════════════════════════════════════════════════════════
// CÁLCULOS DE STOCK
// ═════════════════════════════════════════════════════════════

/**
 * Calcula el stock total de un producto en un área,
 * sumando unidades enteras + equivalente decimal de abiertas.
 *
 * @param {string} productId
 * @param {string} area — 'almacen' | 'barra1' | 'barra2'
 * @returns {number} total con decimales (ej: 5.73)
 */
export function calcularTotalConAbiertas(productId, area) {
  const product = getProductById(productId);
  if (!product) return 0;

  const conteo = state.auditoriaConteo[productId]?.[area];
  if (!conteo) {
    return product.stockByArea?.[area] || 0;
  }

  const enteras  = typeof conteo.enteras  === 'number' ? conteo.enteras  : 0;
  const abiertas = Array.isArray(conteo.abiertas) ? conteo.abiertas : [];

  if (abiertas.length === 0) return enteras;

  const pesoLlena = product.pesoBotellaLlenaOz || 0;
  const pesoVacia = PESO_BOTELLA_VACIA_OZ || 14.0;

  if (pesoLlena <= pesoVacia) {
    return enteras + (abiertas.length * 0.5);
  }

  const contenidoLlena = pesoLlena - pesoVacia;
  let totalAbiertas = 0;

  abiertas.forEach(pesoActual => {
    const peso = parseFloat(pesoActual) || 0;
    if      (peso <= pesoVacia) totalAbiertas += 0;
    else if (peso >= pesoLlena) totalAbiertas += 1;
    else    totalAbiertas += (peso - pesoVacia) / contenidoLlena;
  });

  return parseFloat((enteras + totalAbiertas).toFixed(4));
}

/**
 * Calcula el contenido en mililitros de un producto en un área.
 */
export function calcularContenidoMl(productId, area) {
  const product = getProductById(productId);
  if (!product || !product.capacidadMl) return 0;
  const totalUnidades = calcularTotalConAbiertas(productId, area);
  return parseFloat((totalUnidades * product.capacidadMl).toFixed(2));
}

/**
 * Calcula el stock total de un producto en TODAS las áreas.
 * @returns {{ total: number, porArea: object, totalMl: number }}
 */
export function calcularStockTotal(productId) {
  const porArea = {};
  let total = 0;

  AREA_KEYS.forEach(area => {
    const val = calcularTotalConAbiertas(productId, area);
    porArea[area] = val;
    total += val;
  });

  const product = getProductById(productId);
  const totalMl = product?.capacidadMl
    ? parseFloat((total * product.capacidadMl).toFixed(2))
    : 0;

  return { total: parseFloat(total.toFixed(4)), porArea, totalMl };
}

// ═════════════════════════════════════════════════════════════
// MULTI-USUARIO
// ═════════════════════════════════════════════════════════════

/**
 * Calcula el total considerando conteos de MÚLTIPLES usuarios.
 * Enteras: toma el MAYOR. Abiertas: concatena todas.
 */
export function calcularTotalMultiUsuario(productId, area) {
  const product = getProductById(productId);
  if (!product) return 0;

  const porUsuario = state.auditoriaConteoPorUsuario[productId]?.[area];
  if (!porUsuario || Object.keys(porUsuario).length === 0) {
    return calcularTotalConAbiertas(productId, area);
  }

  let maxEnteras    = 0;
  let todasAbiertas = [];

  Object.values(porUsuario).forEach(conteo => {
    if (typeof conteo === 'object' && conteo !== null) {
      const ent = typeof conteo.enteras === 'number' ? conteo.enteras : 0;
      if (ent > maxEnteras) maxEnteras = ent;
      if (Array.isArray(conteo.abiertas)) {
        todasAbiertas = todasAbiertas.concat(conteo.abiertas);
      }
    }
  });

  if (todasAbiertas.length === 0) return maxEnteras;

  const pesoLlena = product.pesoBotellaLlenaOz || 0;
  const pesoVacia = PESO_BOTELLA_VACIA_OZ || 14.0;

  if (pesoLlena <= pesoVacia) {
    return maxEnteras + (todasAbiertas.length * 0.5);
  }

  const contenidoLlena = pesoLlena - pesoVacia;
  let totalAbiertas = 0;

  todasAbiertas.forEach(pesoActual => {
    const peso = parseFloat(pesoActual) || 0;
    if      (peso <= pesoVacia) totalAbiertas += 0;
    else if (peso >= pesoLlena) totalAbiertas += 1;
    else    totalAbiertas += (peso - pesoVacia) / contenidoLlena;
  });

  return parseFloat((maxEnteras + totalAbiertas).toFixed(4));
}

// ═════════════════════════════════════════════════════════════
// syncStockByAreaFromConteo()
// ═════════════════════════════════════════════════════════════

export function syncStockByAreaFromConteo() {
  if (!state.inventarioConteo) return;

  let updated = 0;

  state.products.forEach(product => {
    const conteo = state.inventarioConteo[product.id];
    if (!conteo) return;

    if (!product.stockByArea) {
      product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
    }

    AREA_KEYS.forEach(area => {
      if (conteo[area] !== undefined && conteo[area] !== null) {
        const valor = parseFloat(conteo[area]);
        if (!isNaN(valor)) {
          product.stockByArea[area] = valor;
          updated++;
        }
      }
    });
  });

  if (updated > 0) {
    console.info(`[Products] syncStockByAreaFromConteo: ${updated} campos actualizados.`);
  }
}

// ═════════════════════════════════════════════════════════════
// handleFileImport() — Importación de PRODUCTOS desde Excel
// ═════════════════════════════════════════════════════════════

export function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const fileInput = event.target;

  console.info('[Import] Archivo recibido:', file.name, file.size, 'bytes');

  if (state.userRole === 'user') {
    showNotification('⛔ Solo el administrador puede importar productos');
    fileInput.value = '';
    return;
  }

  const validExtensions = ['.xlsx', '.xls', '.csv'];
  const fileName = file.name.toLowerCase();
  const isValid  = validExtensions.some(ext => fileName.endsWith(ext));
  if (!isValid) {
    showNotification('⚠️ Selecciona un archivo Excel (.xlsx, .xls, .csv)');
    fileInput.value = '';
    return;
  }

  if (typeof window.XLSX === 'undefined' || !window.XLSX.read) {
    showNotification('❌ La librería XLSX no está cargada. Recarga la página.');
    fileInput.value = '';
    return;
  }

  const reader = new FileReader();

  reader.onerror = function () {
    showNotification('❌ Error al leer el archivo');
    fileInput.value = '';
  };

  reader.onload = function (e) {
    try {
      const data     = new Uint8Array(e.target.result);
      const workbook = window.XLSX.read(data, { type: 'array' });

      if (!workbook.SheetNames?.length) {
        showNotification('El archivo no contiene hojas válidas');
        fileInput.value = ''; return;
      }

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) {
        showNotification('La primera hoja del archivo está vacía');
        fileInput.value = ''; return;
      }

      const jsonData = window.XLSX.utils.sheet_to_json(firstSheet);
      if (!jsonData?.length) {
        showNotification('El archivo no contiene datos válidos');
        fileInput.value = ''; return;
      }

      const columnMap = {
        id:   ['ID', 'Id', 'id', 'Código', 'codigo'],
        name: ['Producto', 'Nombre', 'Descripción', 'descripcion', 'producto',
               'nombre', 'Name', 'name', 'PRODUCTO', 'NOMBRE'],
        unit:  ['Unidad', 'unidad', 'Medida', 'medida', 'Unit', 'UNIDAD'],
        group: ['Grupo', 'grupo', 'Categoría', 'categoria', 'Group', 'GRUPO'],
        stock: ['Cantidad', 'cantidad', 'Stock', 'stock', 'Enteras', 'CANTIDAD'],
        capacidadMl: ['CapacidadML', 'capacidadMl', 'CapacidadMl',
                      'Capacidad_ML', 'CapML', 'capacidadML', 'capacidadml'],
        pesoBotellaLlenaOz: ['PesoBotellaOz', 'pesoBotellaOz', 'PesoLlenaOz',
                             'PesoOz', 'pesoBotellaLlenaOz', 'PesoBotellaLlenaOz'],
      };

      const findCol = (row, keys) => {
        for (const key of keys) {
          if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
        }
        const rowKeys = Object.keys(row);
        for (const key of keys) {
          const found = rowKeys.find(rk => rk.toLowerCase() === key.toLowerCase());
          if (found && row[found] !== undefined && row[found] !== null && row[found] !== '') return row[found];
        }
        return undefined;
      };

      const existingIds  = new Set(state.products.map(p => p.id));
      let maxNum = 0;
      state.products.forEach(p => {
        const m = String(p.id).match(/^PRD-(\d+)$/);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      });
      let nextNum = maxNum + 1;

      const toImport = [];
      const usedInBatch = new Set();
      let skipped = 0;

      jsonData.forEach(row => {
        const nameRaw = findCol(row, columnMap.name);
        const name    = nameRaw !== undefined ? String(nameRaw).trim() : '';
        if (!name) { skipped++; return; }

        const rawId = findCol(row, columnMap.id);
        let id = rawId !== undefined ? String(rawId).trim() : '';

        if (!id || existingIds.has(id) || usedInBatch.has(id)) {
          do { id = 'PRD-' + String(nextNum++).padStart(3, '0'); }
          while (existingIds.has(id) || usedInBatch.has(id));
        }
        usedInBatch.add(id);

        const unit  = String(findCol(row, columnMap.unit)  ?? 'Unidad').trim();
        const group = String(findCol(row, columnMap.group) ?? 'General').trim();
        const stock = parseExcelNumber(findCol(row, columnMap.stock) ?? 0);

        const capRaw  = findCol(row, columnMap.capacidadMl);
        const capacidadMl = capRaw !== undefined
          ? (isNaN(parseFloat(capRaw)) ? null : parseFloat(capRaw)) : null;

        const pesoRaw = findCol(row, columnMap.pesoBotellaLlenaOz);
        const pesoBotellaLlenaOz = pesoRaw !== undefined
          ? (isNaN(parseFloat(pesoRaw)) ? null : parseFloat(pesoRaw)) : null;

        const product = { id, name, unit, group,
          stockByArea: { almacen: stock, barra1: 0, barra2: 0 } };
        if (capacidadMl        > 0) product.capacidadMl        = capacidadMl;
        if (pesoBotellaLlenaOz > 0) product.pesoBotellaLlenaOz = pesoBotellaLlenaOz;

        toImport.push(product);
      });

      if (!toImport.length) {
        showNotification('⚠️ No se encontraron productos válidos. Verifica las columnas.');
        fileInput.value = ''; return;
      }

      state.products = state.products.concat(toImport);
      showNotification(`✅ ${toImport.length} productos importados.` +
        (skipped ? ` ${skipped} filas omitidas.` : ''));

      state.activeTab    = 'inicio';
      state.selectedGroup = 'Todos';
      state.searchTerm   = '';
      state.selectedArea = 'almacen';
      saveToLocalStorage();

      if (state.syncEnabled && window._db) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
      }
      import('./render.js').then(m => m.renderTab());
      fileInput.value = '';

    } catch (error) {
      showNotification('❌ Error al importar archivo: ' + error.message);
      console.error('[Import] Error:', error);
      fileInput.value = '';
    }
  };

  reader.readAsArrayBuffer(file);
}

// ═════════════════════════════════════════════════════════════
// importFullData() — FIX v2.2
// ══════════════════════════════════════════════════════════════
// Importa el estado completo de la app desde un archivo JSON
// (backup exportado previamente). Solo disponible para admins.
//
// Era importada por app.js línea 9:
//   import { ..., importFullData } from './products.js';
// pero NO existía → SyntaxError al cargar app.js → la app
// nunca arrancaba.
// ═════════════════════════════════════════════════════════════

export function importFullData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const fileInput = event.target;

  if (state.userRole === 'user') {
    showNotification('⛔ Solo el administrador puede importar datos completos');
    fileInput.value = '';
    return;
  }

  if (!file.name.toLowerCase().endsWith('.json')) {
    showNotification('⚠️ Selecciona un archivo JSON de respaldo (.json)');
    fileInput.value = '';
    return;
  }

  const reader = new FileReader();

  reader.onerror = () => {
    showNotification('❌ Error al leer el archivo de respaldo');
    fileInput.value = '';
  };

  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);

      // Validar estructura mínima
      if (!data || typeof data !== 'object') {
        showNotification('⚠️ Formato de archivo inválido');
        fileInput.value = ''; return;
      }

      // Restaurar campos con validación de tipo
      if (Array.isArray(data.products))     state.products     = data.products;
      if (Array.isArray(data.inventories))  state.inventories  = data.inventories;
      if (Array.isArray(data.orders))       state.orders       = data.orders;
      if (data.inventarioConteo)            state.inventarioConteo          = data.inventarioConteo;
      if (data.auditoriaConteo)             state.auditoriaConteo           = data.auditoriaConteo;
      if (data.auditoriaStatus)             state.auditoriaStatus           = data.auditoriaStatus;
      if (data.auditoriaConteoPorUsuario)   state.auditoriaConteoPorUsuario = data.auditoriaConteoPorUsuario;
      if (data.ajustes)                     state.ajustes                   = data.ajustes;

      // Reconstruir stockByArea desde conteo si se perdió
      syncStockByAreaFromConteo();
      saveToLocalStorage();

      const total = state.products.length;
      showNotification(`✅ Datos importados: ${total} productos restaurados`);
      console.info('[ImportFull] ✓ Estado restaurado desde JSON —', total, 'productos');

      state.activeTab    = 'inicio';
      state.selectedGroup = 'Todos';
      state.searchTerm   = '';
      saveToLocalStorage();

      import('./render.js').then(m => m.renderTab()).catch(() => {});

      if (state.syncEnabled && window._db && navigator.onLine) {
        import('./sync.js').then(m => m.syncToCloud()).catch(() => {});
      }

      fileInput.value = '';

    } catch (err) {
      showNotification('❌ Error al parsear el archivo: ' + err.message);
      console.error('[ImportFull] Error:', err);
      fileInput.value = '';
    }
  };

  reader.readAsText(file, 'utf-8');
}

// ═════════════════════════════════════════════════════════════
// ajustarProducto()
// ═════════════════════════════════════════════════════════════

export async function ajustarProducto(productId, area, nuevoValor, motivo = '') {
  const product = getProductById(productId);
  if (!product) { showNotification('⚠️ Producto no encontrado'); return; }

  const valorAnterior = product.stockByArea?.[area] || 0;
  if (!product.stockByArea) product.stockByArea = { almacen: 0, barra1: 0, barra2: 0 };
  product.stockByArea[area] = parseFloat(nuevoValor) || 0;

  saveToLocalStorage();
  console.info(`[Products] Ajuste: ${product.name} [${area}] ${valorAnterior} → ${nuevoValor}`);

  if (state.userRole === 'user') {
    try {
      const { enviarNotificacionAjuste } = await import('./notificaciones.js');
      await enviarNotificacionAjuste?.({
        productId, productName: product.name, area,
        valorAnterior, nuevoValor, motivo,
        userId:   state.auditCurrentUser?.userId   || 'unknown',
        userName: state.auditCurrentUser?.userName || 'Anónimo',
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn('[Products] No se pudo enviar notificación de ajuste:', e);
    }
  }

  showNotification(`✅ ${product.name} ajustado en ${AREA_KEYS.includes(area) ? area : 'área'}`);
}

// ═════════════════════════════════════════════════════════════
// finalizarInventario()
// ═════════════════════════════════════════════════════════════

export function finalizarInventario() {
  const snapshot = {
    id:       'INV-' + Date.now(),
    fecha:    new Date().toISOString(),
    usuario:  state.auditCurrentUser?.userName || 'Sistema',
    productos: state.products.map(p => ({
      id:            p.id,
      nombre:        p.name,
      grupo:         p.group,
      stockByArea:   { ...p.stockByArea },
      totalUnidades: calcularStockTotal(p.id).total,
      totalMl:       calcularStockTotal(p.id).totalMl,
    })),
  };

  state.inventories.push(snapshot);

  state.inventarioConteo          = {};
  state.auditoriaConteo           = {};
  state.auditoriaConteoPorUsuario = {};
  state.auditoriaStatus = { almacen: 'pendiente', barra1: 'pendiente', barra2: 'pendiente' };
  state.products.forEach(p => { p.stockByArea = { almacen: 0, barra1: 0, barra2: 0 }; });

  saveToLocalStorage();
  console.info('[Products] ✓ Inventario finalizado. Historial guardado:', snapshot.id);
  showNotification('✅ Inventario finalizado y guardado en historial');

  return snapshot;
}
