#!/usr/bin/env node
/**
 * css-huerfano.js — ¿qué reglas de css/estilos.css ya no las usa nadie?
 * ═══════════════════════════════════════════════════════════════════════════
 * Una regla es HUÉRFANA si todos sus selectores nombran una clase o un id que
 * no aparece en ninguna parte del código (index.html, js/*.js, sw.js, ni en el
 * otro css). Es conservador a propósito: una clase se da por usada si su texto
 * aparece tal cual, o si aparece su prefijo hasta el último '-', '_' o '--'
 * (clases armadas por concatenación: 'pr-estado--' + estado).
 *
 *   node herramientas/css-huerfano.js              informe
 *   node herramientas/css-huerfano.js --borrar     reescribe css/estilos.css sin ellas
 *   node herramientas/css-huerfano.js --json       salida para las pruebas
 *
 * Qué NO toca: @keyframes, @font-face, reglas de :root / html / body / *, y
 * cualquier selector que no nombre una clase o un id propio (etiquetas y
 * atributos). Cuando solo algunos selectores de una lista son huérfanos, quita
 * esos y deja el resto.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const ARCHIVO = path.join(RAIZ, 'css', 'estilos.css');

function leerCorpus() {
    const partes = [];
    ['index.html', 'sw.js', 'css/utilidades.css'].forEach(f => { try { partes.push(fs.readFileSync(path.join(RAIZ, f), 'utf8')); } catch (e) {} });
    fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js')).forEach(f => partes.push(fs.readFileSync(path.join(RAIZ, 'js', f), 'utf8')));
    return partes.join('\n');
}

// Parte la hoja en una lista de nodos {tipo, ini, fin, sel, hijos}; ini/fin son índices en `txt`.
function analizar(txt) {
    const nodos = []; let i = 0;
    function saltarTrivia() {
        for (;;) {
            while (i < txt.length && /\s/.test(txt[i])) i++;
            if (txt.startsWith('/*', i)) { const f = txt.indexOf('*/', i + 2); i = f === -1 ? txt.length : f + 2; } else break;
        }
    }
    function bloque(dentroDe) {
        const lista = [];
        for (;;) {
            saltarTrivia();
            if (i >= txt.length || txt[i] === '}') return lista;
            const ini = i; let j = i, par = 0;
            while (j < txt.length && (txt[j] !== '{' && txt[j] !== ';' || par)) { if (txt[j] === '(') par++; else if (txt[j] === ')') par--; else if (txt[j] === '"' || txt[j] === "'") { const q = txt[j]; j++; while (j < txt.length && txt[j] !== q) { if (txt[j] === '\\') j++; j++; } } j++; }
            if (txt[j] === ';') { i = j + 1; lista.push({ tipo: 'linea', ini, fin: i }); continue; }
            const sel = txt.slice(ini, j).trim(); i = j + 1;
            if (/^@(media|supports|layer|container)/i.test(sel)) {
                const hijos = bloque(sel); i++; // consume '}'
                lista.push({ tipo: 'grupo', ini, fin: i, sel, hijos });
            } else {
                let prof = 1; const cuerpoIni = i;
                while (i < txt.length && prof) { if (txt[i] === '{') prof++; else if (txt[i] === '}') prof--; i++; }
                lista.push({ tipo: /^@/.test(sel) ? 'arroba' : 'regla', ini, fin: i, sel, cuerpoIni });
            }
        }
    }
    return bloque(null);
}

function usada(nombre, corpus, memo) {
    if (memo.has(nombre)) return memo.get(nombre);
    let ok = corpus.indexOf(nombre) !== -1;
    if (!ok) {
        // Clase armada por concatenación: el código tiene 'prefijo-' y le pega el resto.
        const corte = Math.max(nombre.lastIndexOf('-'), nombre.lastIndexOf('_'));
        if (corte >= 5) {
            const pref = nombre.slice(0, corte + 1);
            ok = ["'", '"', '`'].some(q => corpus.indexOf(pref + q) !== -1);
        }
    }
    memo.set(nombre, ok); return ok;
}

function selectoresDe(sel) {
    // separa por comas de primer nivel
    const out = []; let par = 0, ini = 0;
    for (let k = 0; k < sel.length; k++) { const c = sel[k]; if (c === '(' || c === '[') par++; else if (c === ')' || c === ']') par--; else if (c === ',' && !par) { out.push(sel.slice(ini, k).trim()); ini = k + 1; } }
    out.push(sel.slice(ini).trim()); return out.filter(Boolean);
}
const nombresPropios = (s) => { const r = []; s.replace(/\[[^\]]*\]/g, ' ').replace(/::?[a-z-]+(\([^)]*\))?/gi, ' ').replace(/([.#])(-?[_a-zA-Z][\w-]*)/g, (_, t, n) => { r.push(n); return ''; }); return r; };

function huerfanos(txt, corpus) {
    const memo = new Map(), res = []; const edits = [];
    (function recorrer(lista) {
        lista.forEach(n => {
            if (n.tipo === 'grupo') return recorrer(n.hijos);
            if (n.tipo !== 'regla') return;
            const sels = selectoresDe(n.sel);
            const clasif = sels.map(s => {
                if (/^(:root|html|body|\*)\s*$/.test(s) || /^(html|body)(\[[^\]]*\])?\s*$/.test(s)) return 'vivo';
                const nombres = nombresPropios(s);
                if (!nombres.length) return 'vivo'; // solo etiquetas o atributos
                return nombres.every(x => usada(x, corpus, memo)) ? 'vivo' : 'huerfano';
            });
            if (clasif.every(c => c === 'huerfano')) { res.push({ sel: n.sel.replace(/\s+/g, ' ').slice(0, 100), bytes: n.fin - n.ini }); edits.push({ ini: n.ini, fin: n.fin }); }
            else if (clasif.includes('huerfano')) {
                const vivos = sels.filter((s, k) => clasif[k] === 'vivo');
                res.push({ sel: '(parcial) ' + sels.filter((s, k) => clasif[k] === 'huerfano').join(', ').slice(0, 90), bytes: 0 });
                edits.push({ ini: n.ini, fin: n.ini + n.sel.length + (txt.slice(n.ini).indexOf(n.sel) || 0), reemplazo: vivos.join(',\n') + ' ', soloSelector: true, selLen: n.sel.length, nodo: n });
            }
        });
    })(analizar(txt));
    return { res, edits };
}

module.exports = { analizar, huerfanos, leerCorpus };

if (require.main === module) {
    const txt = fs.readFileSync(ARCHIVO, 'utf8'); const corpus = leerCorpus();
    const { res, edits } = huerfanos(txt, corpus);
    const completos = res.filter(r => !r.sel.startsWith('(parcial)'));
    if (process.argv.includes('--json')) { console.log(JSON.stringify({ completas: completos.length, parciales: res.length - completos.length, bytes: completos.reduce((a, r) => a + r.bytes, 0) })); process.exit(0); }
    res.slice(0, 400).forEach(r => console.log('  ' + (r.bytes ? String(r.bytes).padStart(5) + ' B  ' : '       ') + r.sel));
    console.log('\n  ' + completos.length + ' reglas huérfanas completas (' + completos.reduce((a, r) => a + r.bytes, 0) + ' bytes) · ' + (res.length - completos.length) + ' con selectores huérfanos parciales');
    if (process.argv.includes('--borrar')) {
        // solo reglas completas; de atrás hacia adelante
        const borrar = edits.filter(e => !e.soloSelector).sort((a, b) => b.ini - a.ini);
        let out = txt; borrar.forEach(e => { out = out.slice(0, e.ini) + out.slice(e.fin); });
        out = out.replace(/\n{3,}/g, '\n\n');
        fs.writeFileSync(ARCHIVO, out); console.log('  ✔ css/estilos.css reescrito sin ' + borrar.length + ' reglas huérfanas.');
    }
}
