# Field

Campo de formulario con etiqueta asociada por `for` y fondo HUNDIDO (`bg`) respecto a su tarjeta: `UI.field({ id, etiqueta, valor, sufijo, ayuda, numerico })`.

## Reglas
- `numerico: true` añade `inputmode="decimal"` y la clase `num` (mono).
- Alto mínimo 44 px; el CSS global de la app fuerza 16 px en inputs para que iOS no haga zoom.
- Foco: borde `brass` + anillo 3 px `accent-dim`.
- `sufijo` (unidad) dentro del campo, a la derecha, `txt-muted`.

## Deuda conocida
`background-color: var(--bg) !important` gana a una regla global antigua de `input`; se limpia en la fase R8.
