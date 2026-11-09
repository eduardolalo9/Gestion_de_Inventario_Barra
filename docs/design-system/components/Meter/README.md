# Meter

Medidor segmentado de avance (12 segmentos): `UI.meter(412, 431)`. Se lee como un instrumento, no como una barra de progreso.

## Reglas
- Redondea HACIA ABAJO y solo enciende todos los segmentos al 100 %: 412/431 (96 %) deja uno apagado, para que el jefe de barra no cierre un área incompleta.
- Algo contado siempre enciende al menos un segmento.
- Lleva el porcentaje y "N de M" en `aria-label`.
- Tonos: latón por defecto (en curso), `ok` (terminado), `info`.
