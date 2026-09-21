/**
 * _lanzar-navegador.js — opciones de arranque de Chromium para las pruebas
 * de navegador, portables entre la caja de pruebas de Claude y tu PC.
 *
 * Antes cada prueba fijaba executablePath: '/opt/pw-browsers/chromium', que
 * solo existe en la caja de pruebas; en Windows fallaba con "executable
 * doesn't exist". Ahora se usa esa ruta solo si existe; si no, Playwright usa
 * su propio Chromium (instálalo una vez con: npx playwright install chromium).
 */
'use strict';
const fs = require('fs');
const RUTA_CAJA = '/opt/pw-browsers/chromium';
module.exports = function opcionesLanzamiento(extra) {
    const base = fs.existsSync(RUTA_CAJA) ? { executablePath: RUTA_CAJA } : {};
    return Object.assign(base, extra || {});
};
