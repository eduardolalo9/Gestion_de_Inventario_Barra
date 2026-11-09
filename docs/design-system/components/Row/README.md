# Row

La fila de producto de catálogo, conteo, pedidos y stock: `UI.row({ mono, nombre, meta, cifra, sufijo, estado, onclick | accion })`.

## Reglas
- Con `onclick` o `accion` se vuelve un `<button>` real (recibe foco con Tab) y mide 56 px de alto.
- La cifra va a la derecha en mono: en una lista de 431 productos la columna se escanea sin leer nombres.
- `cifra: null` pinta `—`, nunca un hueco.
- `activa: true` marca la fila en edición (borde `accent-dim2`).
- Nombre en una línea con elipsis; `meta` = grupo · presentación.
