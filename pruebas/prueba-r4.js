#!/usr/bin/env node
/**
 * prueba-r4.js — R4: el ciclo semanal lunes→domingo
 * ═══════════════════════════════════════════════════════════════════════════
 * Reglas 4 y 5. La semana va SIEMPRE de lunes a domingo; el fin de mes es un
 * corte adicional que no la parte. Solo el cierre del domingo arrastra su
 * físico al inicial del lunes siguiente.
 *
 * Las fechas son terreno de bugs silenciosos, y hay tres que muerden de
 * verdad en este dominio:
 *
 *   · getDay() da 0 al domingo. Tratarlo como primer día de la semana manda
 *     el cierre del domingo a la semana SIGUIENTE, y el inventario inicial
 *     aparece una semana tarde.
 *   · new Date('2026-09-13') se interpreta como UTC. En México eso devuelve
 *     el 12 — un sábado. El cierre del domingo caería fuera de su semana.
 *   · Diciembre. La semana del 28/12/2026 termina el 03/01/2027. Si el
 *     identificador llevara año natural, esa semana se partiría en dos.
 *
 * El módulo se carga entero y se ejecuta. Todas las fechas de aquí están
 * comprobadas contra el calendario real.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ  = path.resolve(__dirname, '..');
const casos = [];
let fallos  = 0;

function chk(nombre, ok, detalle) {
    casos.push({ nombre, ok, detalle: detalle || '' });
    if (!ok) fallos++;
}
function eq(nombre, recibido, esperado, nota) {
    chk(nombre, recibido === esperado,
        'esperaba ' + JSON.stringify(esperado) + ' y llegó ' + JSON.stringify(recibido) +
        (nota ? ' — ' + nota : ''));
}

// El módulo es cálculo puro: se ejecuta tal cual, sin DOM ni stubs.
const src = fs.readFileSync(path.join(RAIZ, 'js/15-ciclo-semanal.js'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(src + `
    globalThis.API = { parseFechaLocal, fechaISOLocal, inicioSemana, finSemana,
        semanaId, semanaSiguiente, semanaAnterior, esUltimoDiaDelMes,
        clasificarRecuento, perteneceASemana, etiquetaSemana, inicialDesdeCierre };
`, ctx);
const A = ctx.API;

// ═══ 1 · Parseo en hora local, no en UTC ══════════════════════════════════
const d = A.parseFechaLocal('2026-09-13');
chk('Una fecha ISO se parsea en hora local', !!d && d.getDate() === 13 && d.getMonth() === 8,
    'new Date("2026-09-13") daría el 12 en México — un sábado en vez de un domingo');
eq('El domingo parseado sigue siendo domingo', d && d.getDay(), 0);
eq('Ida y vuelta a texto no mueve el día', A.fechaISOLocal(d), '2026-09-13');

chk('Una fecha inexistente se rechaza',   A.parseFechaLocal('2026-02-31') === null,
    'el 31 de febrero rebota solo al 3 de marzo si no se comprueba');
chk('Un mes imposible se rechaza',        A.parseFechaLocal('2026-13-01') === null);
chk('Una cadena con basura se rechaza',   A.parseFechaLocal('hoy') === null);
chk('Vacío o nulo se rechazan',           A.parseFechaLocal('') === null && A.parseFechaLocal(null) === null);
chk('Se admiten espacios alrededor',      !!A.parseFechaLocal('  2026-09-13  '));

// ═══ 2 · El domingo pertenece a la semana que TERMINA ═════════════════════
// Es el error clásico: getDay() da 0 al domingo, y tratarlo como primer día
// manda el cierre a la semana siguiente.
eq('Domingo 13-sep → semana que empieza el lunes 7',  A.semanaId('2026-09-13'), '2026-09-07');
eq('Lunes 7-sep → esa misma semana',                  A.semanaId('2026-09-07'), '2026-09-07');
eq('Lunes 14-sep → ya es la semana siguiente',        A.semanaId('2026-09-14'), '2026-09-14');
eq('Miércoles 30-sep → semana del lunes 28',          A.semanaId('2026-09-30'), '2026-09-28');
eq('La semana del 7 termina el domingo 13',           A.fechaISOLocal(A.finSemana('2026-09-07')), '2026-09-13');
eq('Y desde el propio domingo, el fin es él mismo',   A.fechaISOLocal(A.finSemana('2026-09-13')), '2026-09-13');

chk('El fin de semana llega al último milisegundo del día',
    A.finSemana('2026-09-07').getHours() === 23 && A.finSemana('2026-09-07').getMinutes() === 59,
    'si terminara a las 00:00 el domingo quedaría fuera de su propia semana');

// ═══ 3 · Cruces de mes y de año ═══════════════════════════════════════════
eq('Semana que cruza septiembre y octubre',  A.semanaId('2026-10-01'), '2026-09-28');
eq('El domingo 4-oct cierra esa misma semana', A.semanaId('2026-10-04'), '2026-09-28',
   'la semana que empieza en septiembre termina en octubre, y no se parte');

// El caso que rompe los números de semana ISO: esta semana empieza en 2026 y
// termina en 2027. Con el lunes como identificador no hay ambigüedad.
eq('Lunes 28-dic-2026 abre su semana',        A.semanaId('2026-12-28'), '2026-12-28');
eq('Domingo 3-ene-2027 pertenece a esa misma semana de 2026',
   A.semanaId('2027-01-03'), '2026-12-28',
   'con año natural esta semana se partiría en dos');
eq('Y la semana siguiente ya es de 2027',     A.semanaSiguiente('2027-01-03'), '2027-01-04');

eq('Año bisiesto: 29-feb-2028 cae en su semana', A.semanaId('2028-02-29'), '2028-02-28');
chk('29-feb-2028 existe',                        !!A.parseFechaLocal('2028-02-29'));
chk('29-feb-2027 no existe',                     A.parseFechaLocal('2027-02-29') === null);

eq('Semana siguiente cruza de mes',  A.semanaSiguiente('2026-09-28'), '2026-10-05');
eq('Semana anterior cruza de año',   A.semanaAnterior('2027-01-04'),  '2026-12-28');

// ═══ 4 · Fin de mes ═══════════════════════════════════════════════════════
chk('30-sep es último día de septiembre',   A.esUltimoDiaDelMes('2026-09-30') === true);
chk('31-sep no existe, no confunde',        A.parseFechaLocal('2026-09-31') === null);
chk('28-feb-2028 NO es último (es bisiesto)', A.esUltimoDiaDelMes('2028-02-28') === false);
chk('29-feb-2028 SÍ es último',             A.esUltimoDiaDelMes('2028-02-29') === true);
chk('31-dic es último día del año',         A.esUltimoDiaDelMes('2026-12-31') === true);

// ═══ 5 · Qué significa contar ese día — el corazón de la regla 4 ══════════
const miercolesFinMes = A.clasificarRecuento('2026-09-30');   // miércoles Y fin de mes
eq('30-sep (miércoles y fin de mes) es corte mensual', miercolesFinMes.esCorteMensual, true);
eq('…pero NO cierra semana',                           miercolesFinMes.cierraSemana, false,
   'si cerrara, partiría la semana del 28-sep en dos mitades');
eq('…y se etiqueta como fin_de_mes',                   miercolesFinMes.tipo, 'fin_de_mes');
eq('…y sigue perteneciendo a la semana del 28',        miercolesFinMes.semanaId, '2026-09-28');

const domingoNormal = A.clasificarRecuento('2026-09-13');
eq('Domingo 13-sep cierra semana',        domingoNormal.cierraSemana, true);
eq('…y no es corte mensual',              domingoNormal.esCorteMensual, false);
eq('…y se etiqueta como semanal',         domingoNormal.tipo, 'semanal');

// Un domingo que ADEMÁS es fin de mes hace las dos cosas. No son excluyentes.
const ambos = A.clasificarRecuento('2026-05-31');   // domingo Y último de mayo
eq('31-may-2026 es domingo y fin de mes: cierra semana', ambos.cierraSemana, true);
eq('…y también es corte mensual',                        ambos.esCorteMensual, true);
eq('…y se etiqueta como semanal_y_mensual',              ambos.tipo, 'semanal_y_mensual');

const lunesFinMes = A.clasificarRecuento('2026-08-31');  // lunes Y fin de mes
eq('31-ago (lunes y fin de mes) no cierra semana', lunesFinMes.cierraSemana, false);
eq('…y abre su propia semana',                     lunesFinMes.semanaId, '2026-08-31');

const martesCualquiera = A.clasificarRecuento('2026-09-15');
eq('Un martes normal no es ni una cosa ni la otra', martesCualquiera.tipo, 'fuera_de_calendario');

// ═══ 6 · Pertenencia ══════════════════════════════════════════════════════
chk('El domingo pertenece a su semana',
    A.perteneceASemana('2026-09-13', '2026-09-07') === true);
chk('El lunes siguiente ya no',
    A.perteneceASemana('2026-09-14', '2026-09-07') === false,
    'la regla 6 lo necesita: una factura no entra en la semana equivocada');
chk('Una fecha inválida no pertenece a nada',
    A.perteneceASemana('no-es-fecha', '2026-09-07') === false);

// ═══ 7 · Regla 5 — el inicial sale del cierre ═════════════════════════════
const cierreDomingo = {
    fecha: '2026-09-13', inventoryId: 'INV-778', numero: 12,
    productos: [ { id: 'TEQ01', total: 8.5584 },
                 { id: 'ACE01', total: 1.5 },
                 { id: 'GOL01', total: 0.49 } ]
};
const inicial = A.inicialDesdeCierre(cierreDomingo);
chk('Un cierre en domingo genera inicial', !!inicial);
eq('El inicial es de la semana SIGUIENTE',      inicial && inicial.semanaId, '2026-09-14');
eq('Conserva el total de cada producto',        inicial && inicial.saldos.ACE01, 1.5);
eq('Y los decimales de tres cifras',            inicial && inicial.saldos.GOL01, 0.49);
eq('Redondea la cola de coma flotante',         inicial && inicial.saldos.TEQ01, 8.558,
   'sumar tres áreas deja colas como 8.558400000000001 que se arrastrarían cada semana');
eq('Cuenta los productos arrastrados',          inicial && inicial.totalProductos, 3);

// Trazabilidad: sin esto, dentro de tres meses nadie reconstruye de dónde
// salió un saldo inicial.
eq('Deja escrito de qué inventario viene', inicial && inicial.origen.inventoryId, 'INV-778');
eq('Y su número',                          inicial && inicial.origen.numero, 12);
eq('Y qué semana cerró',                   inicial && inicial.origen.semanaCerrada, '2026-09-07');
eq('Y la fecha exacta del cierre',         inicial && inicial.origen.fechaCierre, '2026-09-13');

// Lo que NO debe arrastrar.
chk('Un corte de fin de mes en miércoles NO genera inicial',
    A.inicialDesdeCierre({ fecha: '2026-09-30', productos: [{ id: 'X', total: 1 }] }) === null,
    'arrastrar ahí partiría la semana del 28 en dos');
chk('Un cierre en martes tampoco',
    A.inicialDesdeCierre({ fecha: '2026-09-15', productos: [] }) === null);
chk('Un cierre sin fecha no genera nada',
    A.inicialDesdeCierre({ productos: [] }) === null);
chk('Un cierre nulo no revienta',
    A.inicialDesdeCierre(null) === null);

const raros = A.inicialDesdeCierre({ fecha: '2026-09-13',
    productos: [ { id: 'A', total: 'ocho' }, { id: 'B' }, { total: 5 }, null ] });
eq('Un total no numérico se guarda como 0, no como NaN', raros.saldos.A, 0,
   'un NaN se propagaría a todos los cálculos de la semana');
eq('Un producto sin total cuenta como 0',   raros.saldos.B, 0);
eq('Las filas sin id se descartan',         raros.totalProductos, 2);

// ═══ 8 · Etiqueta legible ═════════════════════════════════════════════════
eq('Semana dentro de un mes',  A.etiquetaSemana('2026-09-13'),
   'semana del 7 al 13 de septiembre de 2026');
eq('Semana que cruza de mes',  A.etiquetaSemana('2026-10-01'),
   'semana del 28 de septiembre al 4 de octubre de 2026');
eq('Semana que cruza de año',  A.etiquetaSemana('2027-01-03'),
   'semana del 28 de diciembre de 2026 al 3 de enero de 2027');

// ═══ 9 · El módulo está enganchado a la app ═══════════════════════════════
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const sw   = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
chk('index.html carga el módulo',      /src="js\/15-ciclo-semanal\.js\?v=/.test(html));
chk('Se carga antes de quien lo usará',
    html.indexOf('js/15-ciclo-semanal.js') < html.indexOf('js/75-auditoria-flujo.js'));
chk('El Service Worker lo cachea',     /15-ciclo-semanal\.js/.test(sw),
    'sin esto la app se rompe sin señal en el dispositivo que pierda la caché HTTP');

// ── Resumen ───────────────────────────────────────────────────────────────
const ancho = Math.max(...casos.map(c => c.nombre.length));
console.log('\n  ── R4 · ciclo semanal lunes→domingo ──\n');
casos.forEach(c => console.log(
    '  ' + (c.ok ? '✅' : '❌') + '  ' + c.nombre.padEnd(ancho) +
    (c.ok ? '' : '   ← ' + c.detalle)));
console.log('\n  ' + casos.length + ' comprobaciones · ' +
            (casos.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');

process.exit(fallos ? 1 : 0);
