# Card

Una tarjeta, una definición: `UI.card({ titulo, etiqueta, badge, cuerpo, pie, tono, acento })`.

## Reglas
- `acento: true` (fondo `card`, borde `accent-dim2`) solo para LA tarjeta activa de la pantalla; nunca más de una. Si todo se destaca, nada destaca.
- `tono: 'book'` para tarjetas de contabilidad.
- Padding `space-14`, radio `r-lg`, borde `border-mid`, fondo `surface`.
- `etiqueta` va en versales (`txt-muted`), `titulo` en 16.8px/700.

## Qué aporta quien lo usa
`badge`, `cuerpo` y `pie` son HTML ya construido con el kit (no se escapan); `titulo` y `etiqueta` sí se escapan.
