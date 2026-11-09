# Cifra

Toda cantidad de la app en IBM Plex Mono tabular, con redondeo consistente: `UI.cifra(8.65, { decimales: 2, sufijo: 'oz' })`.

## Reglas
- Sin valor numérico devuelve un guion `—` en `txt-muted`, nunca un cero inventado: una celda vacía se lee como cero.
- Sin `decimales`, redondea a 3 (`Math.round(v*1000)/1000`).
- `tono`: `brass | ok | warn | info | danger | book`. Úselo solo para la cifra que exige decisión (diferencia físico vs sistema, merma).
- El sufijo de unidad (oz, ml, bot) va en sans, 0.72em, `txt-muted`.
- Las columnas de cantidades se alinean a la derecha.
