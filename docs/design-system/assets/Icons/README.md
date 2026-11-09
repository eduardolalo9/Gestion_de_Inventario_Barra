# Icons

46 iconos propios de BarInventory (caja 24×24, trazo 2–2.4 px, puntas y uniones redondeadas), extraídos de `css/utilidades.css`.

- Aquí se guardan con trazo `#e8b55c` (latón) solo para verlos en la galería. En la app NO son imágenes: son máscaras CSS (`mask-image`) que pintan con `currentColor`; use `<i class="fa-solid fa-<nombre>" aria-hidden="true"></i>` y el color lo da el texto que lo rodea.
- El nombre del archivo es el de la clase sin `fa-` (`martini-glass.svg` → `.fa-martini-glass`).
- Un icono nunca va solo como único portador de significado: acompáñelo de texto o `aria-label`.
- Para un icono nuevo: mismo trazo y caja, añádalo como `.fa-<nombre> { --bi-icono: url("data:image/svg+xml,…") }` en `css/utilidades.css`.
