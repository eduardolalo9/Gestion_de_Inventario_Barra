# Stepper

Captura de cantidad con el pulgar: `UI.stepper({ id, valor, accionMas, accionMenos, etiqueta })`.

## Reglas
- Botones de 44×44: «−» en `card-high`, «+» en latón tonal (sumar es lo frecuente en conteo).
- El valor es un input real: se puede teclear la cifra, no solo tocar.
- La etiqueta va en `.bi-sr` (solo lector de pantalla); el contexto visual la da la fila o el modal.
- El comportamiento (+/−) lo pone quien lo usa vía `data-bi-accion`.
