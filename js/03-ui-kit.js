        // ══════════════════════════════════════════════════════════════════════
        //  BI UI KIT — componentes reutilizables del rediseño (R1, v5.0)
        //  ────────────────────────────────────────────────────────────────────
        //  POR QUÉ EXISTE
        //  Hasta la 4.24 el mismo concepto visual estaba implementado varias
        //  veces con nombres distintos: una tarjeta era `if-card` en Inventario,
        //  `sync-card` en Inicio, `pm-card` en el panel, `inv-card` en el conteo
        //  y `prd-card` en el catálogo. Un badge de estado se pintaba con
        //  `pm-estado--*` en un sitio, con `audit-cstat-pill` en otro y con
        //  estilos en línea en un tercero. Cada fase añadió su propia familia:
        //  22 prefijos distintos para seis o siete ideas.
        //
        //  Este archivo es la pieza que faltaba: UNA definición por componente.
        //  El CSS correspondiente son las clases `.bi-*` al final de estilos.css.
        //
        //  QUÉ NO ES
        //  No es un framework ni un sistema de componentes reactivos. La app
        //  pinta con funciones que devuelven cadenas de HTML y se asignan a
        //  innerHTML; el kit respeta ese patrón exactamente, porque cambiarlo
        //  habría significado reescribir 27 000 líneas y arriesgar la lógica de
        //  negocio. Lo que hace es que esas cadenas se construyan una sola vez
        //  y en un solo sitio.
        //
        //  CÓMO SE USA
        //      html += UI.card({ titulo: 'Inventario #1001',
        //                        badge: UI.badge('sincronizado'),
        //                        cuerpo: UI.meter(412, 431) });
        //      html += UI.row({ mono: 'DJ7', nombre: 'DON JULIO 70',
        //                       meta: 'TEQUILA · 700 ml', cifra: '8.65' });
        //
        //  REGLAS QUE EL KIT APLICA SOLO, para no tener que recordarlas:
        //   · toda cifra sale en mono tabular (clase .num);
        //   · todo badge lleva color Y palabra, nunca color solo;
        //   · todo control táctil mide 44 px como mínimo;
        //   · todo texto que venga de datos pasa por escapeHtml().
        // ══════════════════════════════════════════════════════════════════════

        var UI = (function() {
            'use strict';

            // escapeHtml vive en js/00-nucleo.js, que carga antes que este
            // archivo. El respaldo existe para que el kit se pueda probar
            // aislado (las pruebas estáticas lo extraen sin cargar el núcleo).
            function esc(v) {
                if (typeof escapeHtml === 'function') return escapeHtml(v == null ? '' : v);
                return String(v == null ? '' : v)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            }

            // ── Estados ──────────────────────────────────────────────────────
            //  Un único diccionario para TODOS los estados de la aplicación.
            //  Antes cada módulo decidía su color y su palabra, y el mismo
            //  estado se veía distinto en dos pantallas. La clave es el estado
            //  de negocio; el valor, cómo se dice y de qué color.
            var ESTADOS = {
                sincronizado:  { texto: 'Sincronizado',  tono: 'ok',      vivo: true  },
                completada:    { texto: 'Completada',    tono: 'ok',      vivo: false },
                completado:    { texto: 'Completado',    tono: 'ok',      vivo: false },
                en_nivel:      { texto: 'En nivel',      tono: 'ok',      vivo: false },
                en_conteo:     { texto: 'En conteo',     tono: 'info',    vivo: true  },
                pendiente:     { texto: 'Pendiente',     tono: 'neutral', vivo: false },
                cerrado:       { texto: 'Cerrado',       tono: 'neutral', vivo: false },
                abandonado:    { texto: 'Abandonado',    tono: 'neutral', vivo: false },
                contabilizado: { texto: 'Contabilizado', tono: 'book',    vivo: false },
                corte_mes:     { texto: 'Corte de mes',  tono: 'book',    vivo: false },
                cierra_semana: { texto: 'Cierra semana', tono: 'ok',      vivo: false },
                // Los tres niveles de existencia de FASE 11B (parte 2)
                bajo:          { texto: 'Bajo mínimo',   tono: 'neutral', vivo: false },
                advertencia:   { texto: 'Advertencia',   tono: 'warn',    vivo: false },
                limitado:      { texto: 'Limitado',      tono: 'danger',  vivo: false },
                conflicto:     { texto: 'Conflicto',     tono: 'danger',  vivo: false }
            };

            /**
             * UI.badge('sincronizado') → píldora de estado.
             * Acepta una clave de ESTADOS o un objeto { texto, tono, vivo }
             * para un estado que todavía no esté en el diccionario.
             * El punto animado ('vivo') se reserva para estados que cambian
             * por sí solos: sincronizando, contando. Un estado final no late.
             */
            function badge(estado, opciones) {
                opciones = opciones || {};
                var def = (typeof estado === 'string') ? ESTADOS[estado] : estado;
                if (!def) def = { texto: String(estado || '—'), tono: 'neutral', vivo: false };
                var tono = opciones.tono || def.tono || 'neutral';
                /**
                 * REDISEÑO R3 — `opciones.texto` reusa el tono y el punto vivo de
                 * un estado del diccionario con la palabra que toque en esa
                 * pantalla ("Activa" en vez de "Sincronizado"), sin inventar un
                 * estado nuevo ni volver a escribir la píldora a mano. El tono
                 * sigue saliendo del diccionario: la palabra cambia, el
                 * significado del color no.
                 */
                var texto = (opciones.texto != null) ? opciones.texto : def.texto;
                var h = '<span class="bi-badge bi-badge--' + esc(tono) + '">';
                if (def.vivo) h += '<span class="bi-badge__punto" aria-hidden="true"></span>';
                h += esc(texto);
                h += '</span>';
                return h;
            }

            /**
             * UI.mono('DON JULIO 70', 'TEQUILA') → monograma del producto.
             * Sustituye a cualquier imagen de producto: tres letras en mono y
             * un tinte derivado del grupo. El tinte se calcula del nombre del
             * grupo, no al azar, para que el mismo grupo tenga siempre el mismo
             * color en todas las pantallas.
             */
            function mono(nombre, grupo) {
                var texto = String(nombre || '').trim().toUpperCase().replace(/[^A-Z0-9ÁÉÍÓÚÑ ]/g, '');
                var partes = texto.split(/\s+/).filter(Boolean);
                var iniciales;
                if (partes.length >= 3)      iniciales = partes[0][0] + partes[1][0] + partes[2][0];
                else if (partes.length === 2) iniciales = partes[0].slice(0, 2) + partes[1][0];
                else                          iniciales = (partes[0] || '—').slice(0, 3);
                var TINTES = ['laton', 'neutro', 'info', 'ok', 'book'];
                var semilla = 0, g = String(grupo || '');
                for (var i = 0; i < g.length; i++) semilla = (semilla + g.charCodeAt(i)) % 997;
                var tinte = g ? TINTES[semilla % TINTES.length] : 'neutro';
                return '<span class="bi-mono bi-mono--' + tinte + '" aria-hidden="true">' + esc(iniciales) + '</span>';
            }

            /**
             * UI.cifra(valor, { decimales, tono, sufijo })
             * Toda cantidad de la app debería pasar por aquí: garantiza mono
             * tabular y un redondeo consistente. Sin valor numérico devuelve
             * un guion, nunca un cero inventado — el mismo criterio de
             * honestidad de datos que sigue el resto del sistema.
             */
            function cifra(valor, opciones) {
                opciones = opciones || {};
                var tono = opciones.tono ? ' bi-cifra--' + esc(opciones.tono) : '';
                if (typeof valor !== 'number' || !isFinite(valor)) {
                    return '<span class="num bi-cifra bi-cifra--sin-dato' + tono + '">—</span>';
                }
                var dec = (typeof opciones.decimales === 'number') ? opciones.decimales : null;
                var texto = (dec === null)
                    ? String(Math.round(valor * 1000) / 1000)
                    : valor.toFixed(dec);
                var h = '<span class="num bi-cifra' + tono + '">' + esc(texto);
                if (opciones.sufijo) h += '<span class="bi-cifra__sufijo">' + esc(opciones.sufijo) + '</span>';
                h += '</span>';
                return h;
            }

            /**
             * UI.meter(hecho, total) → medidor segmentado.
             * Segmentado y no degradado a propósito: se lee como un
             * instrumento y el avance se cuenta de un vistazo. Lleva su
             * porcentaje en aria-label porque el color por sí solo no informa.
             */
            function meter(hecho, total, opciones) {
                opciones = opciones || {};
                var segmentos = opciones.segmentos || 12;
                var t = (typeof total === 'number' && total > 0) ? total : 0;
                var h = (typeof hecho === 'number' && hecho > 0) ? hecho : 0;
                var pct = t ? Math.max(0, Math.min(100, Math.round(h / t * 100))) : 0;
                // Se redondea HACIA ABAJO, y solo se encienden todos los
                // segmentos cuando de verdad está al 100 %. Con Math.round,
                // un 96 % encendía los 12 de 12 y quedaba idéntico a estar
                // terminado: justo la cifra que el jefe de barra mira para
                // saber si puede cerrar el área. Lo detectó la prueba de
                // navegador con el caso real 412/431.
                var llenos = (pct >= 100) ? segmentos : Math.min(segmentos - 1, Math.floor(pct / 100 * segmentos));
                if (pct > 0 && llenos === 0) llenos = 1;   // algo contado siempre se ve
                var tono = opciones.tono ? ' bi-meter--' + esc(opciones.tono) : '';
                var out = '<div class="bi-meter' + tono + '" role="img" aria-label="Avance: '
                        + pct + ' por ciento' + (t ? ' (' + h + ' de ' + t + ')' : '') + '">';
                for (var i = 0; i < segmentos; i++) {
                    out += '<span class="bi-meter__seg' + (i < llenos ? ' is-on' : '') + '"></span>';
                }
                out += '</div>';
                return out;
            }

            /**
             * UI.btn('Contabilizar', { variante, accion, icono, ancho })
             * variante: 'primario' | 'secundario' | 'peligro' | 'fantasma'
             * `accion` se inyecta como atributo de datos (patrón delegado, el
             * que ya usa la app para contabilizar) en vez de onclick en línea.
             */
            function btn(texto, opciones) {
                opciones = opciones || {};
                var v = opciones.variante || 'primario';
                var attrs = ' type="button" class="bi-btn bi-btn--' + esc(v)
                          + (opciones.ancho === 'completo' ? ' bi-btn--completo' : '') + '"';
                if (opciones.accion)   attrs += ' data-bi-accion="' + esc(opciones.accion) + '"';
                if (opciones.id)       attrs += ' data-bi-id="' + esc(opciones.id) + '"';
                if (opciones.onclick)  attrs += ' onclick="' + opciones.onclick + '"';
                if (opciones.aria)     attrs += ' aria-label="' + esc(opciones.aria) + '"';
                if (opciones.deshabilitado) attrs += ' disabled';
                var h = '<button' + attrs + '>';
                if (opciones.icono) h += '<i class="fa-solid ' + esc(opciones.icono) + '" aria-hidden="true"></i>';
                h += esc(texto);
                h += '</button>';
                return h;
            }

            /**
             * UI.card({ titulo, etiqueta, badge, cuerpo, pie, tono, acento })
             * Una tarjeta, una definición. `acento: true` la destaca con el
             * borde de latón (la tarjeta activa de la pantalla, nunca más de
             * una a la vez: si todo se destaca, nada destaca).
             */
            function card(o) {
                o = o || {};
                var cls = 'bi-card';
                if (o.acento) cls += ' bi-card--acento';
                if (o.tono)   cls += ' bi-card--' + esc(o.tono);
                var h = '<div class="' + cls + '"' + (o.id ? ' data-bi-id="' + esc(o.id) + '"' : '') + '>';
                if (o.titulo || o.badge || o.etiqueta) {
                    h += '<div class="bi-card__cab">';
                    h += '<div class="bi-card__ident">';
                    if (o.etiqueta) h += '<span class="bi-card__etq">' + esc(o.etiqueta) + '</span>';
                    if (o.titulo)   h += '<span class="bi-card__titulo">' + esc(o.titulo) + '</span>';
                    h += '</div>';
                    if (o.badge) h += o.badge;   // ya viene escapado por badge()
                    h += '</div>';
                }
                if (o.cuerpo) h += '<div class="bi-card__cuerpo">' + o.cuerpo + '</div>';
                if (o.pie)    h += '<div class="bi-card__pie">' + o.pie + '</div>';
                h += '</div>';
                return h;
            }

            /**
             * UI.row({ mono, nombre, meta, cifra, sufijo, estado, tono, onclick })
             * La fila de producto que usan catálogo, conteo, pedidos y stock.
             * La cifra va a la derecha en mono: en una lista de 431 productos
             * la columna de cantidades se escanea sin leer los nombres.
             */
            function row(o) {
                o = o || {};
                var interactiva = !!(o.onclick || o.accion);
                var etiqueta = 'div';
                var attrs = ' class="bi-row' + (o.activa ? ' is-activa' : '') + '"';
                if (interactiva) {
                    // Un div con onclick no recibe foco con Tab: cuando la fila
                    // es accionable se usa un <button> de verdad.
                    etiqueta = 'button';
                    attrs = ' type="button" class="bi-row bi-row--accionable' + (o.activa ? ' is-activa' : '') + '"';
                    if (o.onclick) attrs += ' onclick="' + o.onclick + '"';
                    if (o.accion)  attrs += ' data-bi-accion="' + esc(o.accion) + '"';
                    if (o.id)      attrs += ' data-bi-id="' + esc(o.id) + '"';
                }
                var h = '<' + etiqueta + attrs + '>';
                if (o.mono) h += o.mono;         // ya viene de UI.mono()
                h += '<span class="bi-row__texto">';
                h += '<span class="bi-row__nombre">' + (o.nombreHtml || esc(o.nombre)) + '</span>';
                if (o.meta) h += '<span class="bi-row__meta">' + esc(o.meta) + '</span>';
                h += '</span>';
                if (o.cifra !== undefined || o.estado) {
                    h += '<span class="bi-row__der">';
                    if (o.cifra !== undefined) {
                        // Una cadena ya formateada se respeta tal cual; todo lo
                        // demás pasa por cifra(), que es quien sabe convertir
                        // "no hay dato" en un guion en vez de en un hueco vacío
                        // (con cifra: null la fila se quedaba sin nada, y una
                        // celda vacía se lee como un cero).
                        h += (typeof o.cifra === 'string')
                             ? '<span class="num bi-cifra">' + esc(o.cifra) + '</span>'
                             : cifra(o.cifra, { decimales: o.decimales, tono: o.tono, sufijo: o.sufijo });
                    }
                    if (o.estado) h += '<span class="bi-row__estado">' + badge(o.estado) + '</span>';
                    h += '</span>';
                }
                h += '</' + etiqueta + '>';
                return h;
            }

            /**
             * UI.kpi(valor, total, etiqueta, { tono })
             * El bloque de cifra grande del tablero: 412 / 431 · contados.
             */
            function kpi(valor, total, etiqueta, opciones) {
                opciones = opciones || {};
                var h = '<div class="bi-kpi' + (opciones.tono ? ' bi-kpi--' + esc(opciones.tono) : '') + '">';
                h += '<span class="num bi-kpi__val">' + esc(valor);
                if (total !== undefined && total !== null) {
                    h += '<span class="bi-kpi__de"> / ' + esc(total) + '</span>';
                }
                h += '</span>';
                if (etiqueta) h += '<span class="bi-kpi__etq">' + esc(etiqueta) + '</span>';
                h += '</div>';
                return h;
            }

            /**
             * UI.field({ id, etiqueta, valor, tipo, sufijo, ayuda, numerico })
             * El campo de formulario del sistema. Existe para desplazar a los
             * inputs con `bg-white` y `text-gray-900` de Tailwind, que eran
             * blancos sobre una app oscura: éste usa un fondo hundido del tema
             * y la etiqueta va SIEMPRE asociada con `for`, no como texto suelto.
             */
            function field(o) {
                o = o || {};
                var id = esc(o.id || ('bi-f-' + Math.random().toString(36).slice(2, 8)));
                var h = '<div class="bi-field">';
                if (o.etiqueta) h += '<label class="bi-field__etq" for="' + id + '">' + esc(o.etiqueta) + '</label>';
                h += '<div class="bi-field__caja">';
                h += '<input id="' + id + '" class="bi-field__input' + (o.numerico ? ' num' : '') + '"'
                   + ' type="' + esc(o.tipo || 'text') + '"'
                   + (o.numerico ? ' inputmode="decimal"' : '')
                   + (o.valor !== undefined && o.valor !== null ? ' value="' + esc(o.valor) + '"' : '')
                   + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '')
                   + (o.oninput ? ' oninput="' + o.oninput + '"' : '')
                   + (o.deshabilitado ? ' disabled' : '')
                   + '>';
                if (o.sufijo) h += '<span class="bi-field__sufijo">' + esc(o.sufijo) + '</span>';
                h += '</div>';
                if (o.ayuda) h += '<p class="bi-field__ayuda">' + esc(o.ayuda) + '</p>';
                h += '</div>';
                return h;
            }

            /**
             * UI.stepper({ id, valor, accionMas, accionMenos, etiqueta })
             * Controles de 44 px para capturar una cantidad con el pulgar.
             * El valor es un input de verdad (se puede teclear una cifra
             * directamente, no solo tocar − y +).
             */
            function stepper(o) {
                o = o || {};
                var id = esc(o.id || 'bi-step');
                var h = '<div class="bi-stepper">';
                h += '<button type="button" class="bi-stepper__btn bi-stepper__btn--menos" aria-label="Restar"'
                   + (o.accionMenos ? ' data-bi-accion="' + esc(o.accionMenos) + '"' : '')
                   + (o.id ? ' data-bi-id="' + id + '"' : '') + '>&minus;</button>';
                h += '<label class="bi-sr" for="' + id + '">' + esc(o.etiqueta || 'Cantidad') + '</label>';
                h += '<input id="' + id + '" class="num bi-stepper__val" type="text" inputmode="decimal" value="'
                   + esc(o.valor !== undefined ? o.valor : 0) + '">';
                h += '<button type="button" class="bi-stepper__btn bi-stepper__btn--mas" aria-label="Sumar"'
                   + (o.accionMas ? ' data-bi-accion="' + esc(o.accionMas) + '"' : '')
                   + (o.id ? ' data-bi-id="' + id + '"' : '') + '>+</button>';
                h += '</div>';
                return h;
            }

            /** UI.seccion('Existencias en alerta', derechaHtml) → encabezado de sección. */
            function seccion(titulo, derecha) {
                var h = '<div class="bi-seccion">';
                h += '<span class="bi-seccion__titulo">' + esc(titulo) + '</span>';
                if (derecha) h += '<span class="bi-seccion__der">' + derecha + '</span>';
                h += '</div>';
                return h;
            }

            return {
                ESTADOS: ESTADOS,
                badge: badge,
                mono: mono,
                cifra: cifra,
                meter: meter,
                btn: btn,
                card: card,
                row: row,
                kpi: kpi,
                field: field,
                stepper: stepper,
                seccion: seccion
            };
        })();

        window.UI = UI;
