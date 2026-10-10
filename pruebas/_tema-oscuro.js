/**
 * _tema-oscuro.js — v5.25: la app arranca en tema CLARO (marca Verde Esmeralda).
 * Las pruebas R1–R7 se escribieron cuando el oscuro era el predeterminado y
 * comprueban colores del tema oscuro; este ayudante lo fija ANTES de que cargue
 * la página (la marca 'esmeralda' evita la migración de una sola vez que forzaría el claro).
 */
'use strict';
module.exports = function fijarTemaOscuro(ctx) {
    ctx.addInitScript(() => {
        try {
            localStorage.setItem('inventarioApp_theme', 'dark');
            localStorage.setItem('inventarioApp_temaMarca', 'esmeralda');
        } catch (e) { /* sin almacenamiento: queda el predeterminado */ }
    });
    return ctx;
};
