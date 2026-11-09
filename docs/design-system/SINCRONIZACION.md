# Sistema de diseño — cómo se mantiene

Esta carpeta es la copia versionada del sistema de diseño **BarInventory — Carbón & Latón**, publicado como artefacto en claude.ai (privado: compártelo desde su menú Share).

- **La fuente de verdad sigue siendo el código**: `css/estilos.css` (tokens `:root` y kit `.bi-*`), `js/03-ui-kit.js` (`UI.*`) y `css/utilidades.css` (iconos).
- `components/bundle.js` y `components/bundle.css` son **instantáneas** de esos archivos en el commit `1ea08da`. No se cargan en la app (no están en `index.html` ni en `sw.js`); solo alimentan las previews.
- Si cambias un token o un componente en la app, vuelve a pedir a Claude Code que re-sincronice el sistema: actualiza `tokens.json`, las instantáneas y el artefacto.
- `assets/Icons/*.svg` llevan trazo latón solo para la galería; en la app son máscaras con `currentColor`.
