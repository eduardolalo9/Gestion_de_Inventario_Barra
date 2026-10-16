#!/usr/bin/env node
/**
 * quitar-important.js — quita los !important que sobran, demostrándolo.
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. Mide la "huella de estilos" de la app tal como está (estilo calculado de
 *    cada elemento, 11 pestañas + menú + 3 modales + confirmación + avisos, en
 *    oscuro y claro, a 390, 820 y 1280 px).
 * 2. Quita el !important de TODAS las reglas elegibles y vuelve a medir.
 * 3. Cada elemento que cambió delata las reglas que sí hacían falta: se les
 *    devuelve el !important y se repite hasta que no cambie nada.
 *
 * Una regla es elegible solo si: (a) está fuera de @media o dentro de un
 * @media de ancho; (b) ningún selector lleva :hover/:active/:focus/::pseudo
 * (esos estados no se pueden medir en reposo); (c) sus selectores SÍ
 * coincidieron con algún elemento durante la medición (una regla que nadie
 * ejercitó no se toca: no hay prueba de que sea inofensiva).
 *
 *   node herramientas/quitar-important.js            informe, no escribe nada
 *   node herramientas/quitar-important.js --aplicar  reescribe css/estilos.css
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { analizar } = require('./css-huerfano.js');
const { huella, afecta, PROPS } = require('../pruebas/_huella-estilos.js');
const ARCHIVO = path.resolve(__dirname, '..', 'css', 'estilos.css');
const APLICAR = process.argv.includes('--aplicar');

function selectoresDe(sel) { const out = []; let par = 0, ini = 0; for (let k = 0; k < sel.length; k++) { const c = sel[k]; if (c === '(' || c === '[') par++; else if (c === ')' || c === ']') par--; else if (c === ',' && !par) { out.push(sel.slice(ini, k).trim()); ini = k + 1; } } out.push(sel.slice(ini).trim()); return out.filter(Boolean); }

function extraerReglas(txt) {
    const reglas = []; let id = 0;
    (function rec(lista, grupo) {
        lista.forEach(n => {
            if (n.tipo === 'grupo') return rec(n.hijos, n.sel);
            if (n.tipo !== 'regla') return;
            const cuerpo = txt.slice(n.cuerpoIni, n.fin - 1);
            if (!/!important/.test(cuerpo)) return;
            const decls = []; const re = /([a-z-]+)\s*:\s*[^;{}]*?!important/gi; let m;
            while ((m = re.exec(cuerpo))) decls.push(m[1].toLowerCase());
            const sels = selectoresDe(n.sel.replace(/\s+/g, ' '));
            const estado = /:(hover|active|focus|focus-visible|focus-within|visited|checked|disabled|enabled|placeholder|target|invalid|valid|read-only)|::|:(before|after|first-line|first-letter)/i;
            const anchoSolo = !grupo || /^@media\s*(\(\s*(min|max)-width\s*:\s*[^)]+\)\s*(and\s*)?)+$/i.test(grupo.trim());
            const elegible = anchoSolo && !sels.some(s => estado.test(s)) && !/^@/.test(n.sel);
            reglas.push({ id: id++, ini: n.ini, fin: n.fin, cuerpoIni: n.cuerpoIni, sel: n.sel.replace(/\s+/g, ' '), sels, props: [...new Set(decls)], elegible, grupo: grupo || '' });
        });
    })(analizar(txt), null);
    return reglas;
}

function sinImportant(txt, reglas, conservar) {
    // quita '!important' del cuerpo de cada regla elegible que no esté en `conservar`; de atrás hacia adelante
    let out = txt;
    reglas.filter(r => r.elegible && !conservar.has(r.id)).sort((a, b) => b.cuerpoIni - a.cuerpoIni).forEach(r => {
        const cuerpo = out.slice(r.cuerpoIni, r.fin - 1);
        out = out.slice(0, r.cuerpoIni) + cuerpo.replace(/\s*!important/g, '') + out.slice(r.fin - 1);
    });
    return out;
}

(async () => {
    const txt = fs.readFileSync(ARCHIVO, 'utf8');
    const reglas = extraerReglas(txt);
    const enPagina = reglas.map(r => ({ id: r.id, sels: r.sels, props: r.props }));
    console.log('  Reglas con !important: ' + reglas.length + ' (' + reglas.filter(r => r.elegible).length + ' elegibles por tipo)');
    console.log('  1) Midiendo la huella base…');
    const t0 = Date.now();
    const base = await huella({ reglas: enPagina });
    const cubiertas = new Set(base.cubiertas);
    const prueba = await huella({ base: base.base, reglas: enPagina }); // determinismo: dos corridas iguales
    if (prueba.difs.length) { console.log('  ✖ La medición no es determinista (' + prueba.difs.length + ' diferencias entre dos corridas idénticas). Primeras:'); prueba.difs.slice(0, 8).forEach(d => console.log('     ' + d.estado + ' ' + d.tag + ' → ' + d.cambia.join(','))); process.exit(2); }
    console.log('     determinista ✔ (' + base.estados + ' estados, ' + Math.round((Date.now() - t0) / 1000) + ' s)');

    const sinCobertura = reglas.filter(r => r.elegible && !cubiertas.has(r.id));
    reglas.forEach(r => { if (r.elegible && !cubiertas.has(r.id)) r.elegible = false; });
    console.log('  Elegibles que alguna pantalla ejercitó: ' + reglas.filter(r => r.elegible).length + ' (' + sinCobertura.length + ' sin ejercitar → se dejan igual)');

    const conservar = new Set(); let ronda = 0;
    for (;;) {
        ronda++;
        const css = sinImportant(txt, reglas, conservar);
        const r = await huella({ css, base: base.base, reglas: enPagina });
        console.log('  ronda ' + ronda + ': ' + r.difs.length + ' elementos distintos, ' + conservar.size + ' reglas conservadas');
        if (!r.difs.length) { fs.writeFileSync('/tmp/estilos.sin-important.css', css); break; }
        let nuevas = 0;
        r.difs.forEach(d => {
            const candidatas = d.reglas.filter(R => { const reg = reglas[R.id]; return reg.elegible && !conservar.has(R.id) && R.props.some(dp => d.cambia.some(fp => afecta(dp, fp))); });
            const pool = candidatas.length ? candidatas : d.reglas.filter(R => reglas[R.id].elegible && !conservar.has(R.id));
            pool.forEach(R => { conservar.add(R.id); nuevas++; });
        });
        if (!nuevas) { console.log('  ✖ Hay diferencias que no se pueden atribuir a ninguna regla. Primeras:'); r.difs.slice(0, 10).forEach(d => console.log('     ' + d.estado + ' ' + d.tag + ' → ' + d.cambia.slice(0, 4).join(','))); process.exit(2); }
        if (ronda > 25) { console.log('  ✖ No converge.'); process.exit(2); }
    }
    const quitadas = reglas.filter(r => r.elegible && !conservar.has(r.id));
    const decl = quitadas.reduce((a, r) => a + r.props.length, 0);
    console.log('\n  Resultado: se pueden quitar los !important de ' + quitadas.length + ' reglas (' + decl + ' declaraciones) con la huella idéntica.');
    console.log('  Se conservan: ' + conservar.size + ' reglas que sí lo necesitan · ' + reglas.filter(r => !r.elegible).length + ' no elegibles (estados, pseudo-elementos, sin ejercitar).');
    if (APLICAR) { fs.writeFileSync(ARCHIVO, sinImportant(txt, reglas, conservar)); console.log('  ✔ css/estilos.css reescrito.'); }
    else console.log('  (informe: usa --aplicar para escribir. CSS resultante en /tmp/estilos.sin-important.css)');
    fs.writeFileSync('/tmp/important-necesarias.json', JSON.stringify([...conservar].map(i => ({ sel: reglas[i].sel.slice(0, 80), props: reglas[i].props })), null, 1));
})().catch(e => { console.error(e); process.exit(1); });
