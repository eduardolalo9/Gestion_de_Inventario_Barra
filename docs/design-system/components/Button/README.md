# Button

Botón del sistema, 44 px mínimo para el pulgar: `UI.btn('Contabilizar', { variante, accion, icono, ancho })`.

## Variantes
| variante | uso | tokens |
|---|---|---|
| `primario` | LA acción de la pantalla (una sola) | `brass` / `brass-on` |
| `secundario` | acción de apoyo | `accent-dim`, texto `brass`, borde `accent-dim2` |
| `fantasma` | cancelar, volver | transparente, `border-mid`, `txt-secondary` |
| `peligro` | borrar, descartar | transparente, `danger`, borde `danger-dim` |
| `book` | contabilizar / corte de mes | `book` / `book-on` |

## Qué aporta quien lo usa
- `accion` → `data-bi-accion` (patrón delegado); preferible a `onclick` en línea.
- `icono`: una clase `fa-*` de los iconos locales (ver Iconos).
- `ancho: 'completo'` para botones a todo el ancho en móvil; `deshabilitado` baja a 45 % de opacidad.
