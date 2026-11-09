# BarInventory — Carbón & Latón

Un instrumento de medición, no un panel de administración. Es el sistema visual de BarInventory, la app de inventario de barra (conteo ciego, auditoría, recetario, compras, ventas y contabilización), y la base para cualquier producto nuevo de la misma operación, incluida la interfaz del asistente de barra.

Fuente: `eduardolalo9/Gestion_de_Inventario_Barra` @ `1ea08da` — `css/estilos.css` (tokens y kit `.bi-*`), `js/03-ui-kit.js` (componentes `UI.*`), `css/utilidades.css` (iconos), `index.html` (fuentes).

## Las tres reglas

1. **El latón se gana.** Solo lo que se toca o exige una decisión va en `accent` (alias `brass`): el botón primario, el foco, la cifra que hay que mirar. Una sola tarjeta con acento por pantalla (`bi-card--acento`). Si todo brilla, nada guía.
2. **Las cifras van en IBM Plex Mono, tabulares y a la derecha.** Una columna de cantidades se escanea como una hoja de inventario, sin leer palabra por palabra. Toda cantidad pasa por `UI.cifra()`.
3. **El color nunca va solo.** Cada estado lleva color Y palabra (`UI.badge`). En una barra con poca luz, y para quien no distingue tonos, el texto es lo que manda.

Y una cuarta que aplica el kit: **todo control táctil mide 44 px** (`touch-min`). La app se usa de pie, con una mano y el teléfono mojado.

## Contenido y tono

- Español de México, operativo y concreto: "Guardar conteo", "Agregar otra abierta", "Cerrar área". Verbos en infinitivo en botones.
- Vocabulario de barra: botella cerrada / abierta, oz, ml, sub-receta, merma, físico vs sistema, corte de mes, contabilizar.
- Etiquetas en versales (`etiqueta`: 10.4px, 700, +0.07em) solo para rótulos cortos. Las pistas y frases van en minúsculas ("ingresa el peso en oz"): en versales se leen como un grito.
- Sin dato se muestra `—`, nunca `0`. Un cero inventado es una mentira contable.
- Estados con una sola palabra del diccionario `UI.ESTADOS`: Sincronizado, En conteo, Pendiente, Advertencia, Limitado, Conflicto, Contabilizado, Corte de mes…

## Fundamentos visuales

**Color.** Dos temas. El principal es oscuro ("carbón azulado, nunca negro plano"): `bg` #0e1013 → `surface` #15181d → `card` #1c2027 → `card-high` #242932, elevación por luminosidad, no por sombra. El claro es papel cálido (`bg` #fbf9f6) y el latón baja a bronce #8a5a14 para pasar 4.5:1. Bordes translúcidos en tres fuerzas: `border`, `border-mid`, `border-strong`.

**Semántica.** `ok` (verde), `warn` (ámbar), `info` (azul, en curso), `danger` (rojo), `book` (violeta, exclusivo de contabilidad). Cada uno con su `-dim` para fondos tonales. Los nombres viejos (`green`, `red`, `amber`, `sky`) siguen vivos porque los usan miles de reglas; en código nuevo use los semánticos.

| Texto | sobre `bg` | sobre `surface` | sobre `card` |
|---|---|---|---|
| `txt-primary` oscuro | 15.3 | 14.3 | 13.1 |
| `txt-muted` oscuro | 5.3 | 4.9 | 4.5 |
| `txt-muted` claro | 4.6 | **4.29 ⚠** | 4.8 |
| `accent` claro | 5.6 | 5.3 | 5.9 |

⚠ `txt-muted` en tema claro sobre `surface` no llega a 4.5:1 en texto pequeño. Se conserva el valor del código; corregir a ~#6e6962 en una fase propia.

**Tipografía.** IBM Plex Sans para todo el texto, IBM Plex Mono para cifras y monogramas (Google Fonts). Cuerpo 13px/1.55 (15px en móvil); inputs nunca por debajo de 16px para que iOS no haga zoom.

**Forma.** Radios `r-sm` 8 (campos), `r-md` 12 (botones, filas), `r-lg` 16 (tarjetas), `r-full` (badges y botones del modal). Espaciado compacto: `space-10` entre piezas de una fila, `space-14` dentro de tarjetas.

**Campos hundidos.** Un input usa `bg` (más oscuro que su tarjeta): se distingue por estar abajo, no por ser blanco.

**Movimiento.** Transiciones de 140–220 ms con `cubic-bezier(0.05, 0.7, 0.1, 1)`. El único elemento que late es el punto de un badge vivo (`statusPulse` 2.4 s).

## Iconografía

46 iconos propios en `assets/Icons/`: trazo de 2–2.4 px, caja 24×24, puntas redondeadas. En la app son **máscaras CSS** (`<i class="fa-solid fa-plus">`) que heredan `currentColor`, así un icono dentro de un badge verde sale verde. No es Font Awesome: solo reutiliza sus nombres de clase para no tocar 42 usos existentes. No hay emoji en la interfaz (los estados vacíos usan un icono a 38px con 55 % de opacidad).

No hay logotipo: la marca es tipográfica ("BarInventory" en Plex Sans 600).

## Componentes

El kit `UI` (`components/bundle.js`, copia de `js/03-ui-kit.js`) son funciones que devuelven cadenas HTML para `innerHTML`, no componentes React. Todo texto de datos se escapa.

| Componente | Función | Para qué |
|---|---|---|
| Badge | `UI.badge(estado)` | estado con color y palabra |
| Cifra | `UI.cifra(v, {decimales, sufijo, tono})` | toda cantidad |
| Mono | `UI.mono(nombre, grupo)` | monograma en lugar de foto |
| Meter | `UI.meter(hecho, total)` | avance de conteo segmentado |
| Button | `UI.btn(texto, {variante})` | primario, secundario, fantasma, peligro, book |
| Card | `UI.card({...})` | contenedor; una con acento por pantalla |
| Row | `UI.row({...})` | fila de producto |
| Kpi | `UI.kpi(v, total, etiqueta)` | cifra grande de tablero |
| Field | `UI.field({...})` | campo con etiqueta y unidad |
| Stepper | `UI.stepper({...})` | − / valor / + de 44px |
| Seccion | `UI.seccion(titulo, der)` | encabezado en versales |
| ModalConteo | (HTML de `85-ui-inventario-fisico.js`) | captura de conteo |

Uso en una página: cargue `tokens.css`, `components/bundle.css` y `components/bundle.js`, luego `el.innerHTML = UI.card({ titulo: 'Inventario #1001', badge: UI.badge('en_conteo'), cuerpo: UI.meter(412, 431) })`.

## No sincronizado

- **Motion**: `--ease-std`, `--ease-out`, `--ease-spring` no tienen familia en este formato; documentados arriba.
- **Legado**: `--ink`, `--accent-2`, `--accent-3`, `--accent-blue`, `--accent-green`, `--shadow-mid`, `--glow-accent` (alias o `none`) y las ~22 familias antiguas (`if-*`, `pm-*`, `prd-*`, `audit-*`…) no se traen: el kit `.bi-*` es la definición vigente.
- **Cabecera**: usa colores fijos (#0b1325, #0f2040) fuera de tokens; deuda del código.
- **Fuentes**: Plex por Google Fonts, sin archivos. `index.html` carga Plex Mono solo en 400/500, pero el CSS pide 700 en cifras: el navegador sintetiza la negrita. Conviene añadir `wght@400;500;600;700` al `<link>`.
- **Componentes**: ruta "lectura": el bundle es el archivo real del repo, sin compilación.
