// v5.47 — El acceso al precio vigente (precioProducto) vive en js/00-nucleo.js. Las pruebas que cargan
// solo ALGUNOS módulos en un contexto de vm lo necesitan para ejecutar los que ya lo usan (49, 73, 91,
// 94, 95, 96, 97…). Este helper lo extrae del archivo real (no es una copia): lo que se prueba es el
// código de producción. Uso:  vm.runInContext(require('./_precio-producto'), ctx);
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', '00-nucleo.js'), 'utf8');
const ini = src.indexOf('function _costoValido(c)');
const f0 = src.indexOf('function precioProductoOrigen(');
if (ini === -1 || f0 === -1) throw new Error('_precio-producto: no se encontró el acceso al precio en js/00-nucleo.js');
const fin = src.indexOf('\n        }\n', f0) + '\n        }\n'.length;
module.exports = 'var costosUltimos = (typeof costosUltimos === "undefined") ? {} : costosUltimos;\n' + src.slice(ini, fin);
