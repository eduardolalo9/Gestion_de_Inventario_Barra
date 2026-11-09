# Badge

Píldora de estado que siempre lleva color Y palabra: `UI.badge('sincronizado')`.

## Cuándo usarlo
- Para cualquier estado de negocio (inventario, área, existencia, contabilidad). Las claves viven en `UI.ESTADOS`: un mismo estado se ve igual en todas las pantallas.
- `opciones.texto` cambia la palabra sin cambiar el significado del color ("Activa" con el tono de sincronizado).
- Un objeto `{ texto, tono, vivo }` sirve para un estado que aún no está en el diccionario; agréguelo a `ESTADOS` en cuanto se repita.

## Reglas
- El punto animado (`vivo`) solo en estados que cambian solos: `sincronizado`, `en_conteo`. Un estado final no late.
- Tonos: `ok` (green), `warn` (amber), `info` (sky), `danger` (red), `book` (contabilidad), `brass`, `neutral`. Fondo `--<tono>-dim`, texto `--<tono>`.
- Nunca color solo: en barra con poca luz y para quien no distingue tonos, manda la palabra.

## Qué aporta quien lo usa
La clave del estado. El texto se escapa con `escapeHtml`.
