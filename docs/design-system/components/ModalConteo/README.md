# ModalConteo

La pantalla de captura del conteo físico (clases `.inv-modal*`, `.inv-abierta*`): rendición estática del modal real de `js/85-ui-inventario-fisico.js`.

## Por qué así
Un bartender la abre cientos de veces por turno, de pie, con el teléfono en una mano. Todo se juzga por eso.

## Reglas
- La cifra capturada (`.inv-modal__num`) es mono tabular 22 px, centrada, sobre fondo hundido `bg`.
- Cerradas en un campo; cada botella abierta en su fila con su peso (oz) y botón quitar de 36 px.
- «Agregar otra abierta» es secundaria: borde punteado, a todo el ancho, en su propia línea.
- El único latón del modal es **Guardar** (`accent` / `accent-on`, radio `r-full`).
- La pista de unidad va en minúsculas y en `brass`: es una frase, no una etiqueta.
- Acciones pegadas abajo (`position: sticky`).

No es una función del kit `UI`: el HTML lo arma el módulo de inventario físico.
