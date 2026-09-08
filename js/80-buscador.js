        function clearConteoSearch() {
            clearTimeout(_csSearchTimer);
            _conteoSearchTerm = '';
            const inp  = document.getElementById('csb-input');
            const wrap = document.getElementById('csb-wrap');
            if (inp)  { inp.value = ''; inp.focus(); }
            if (wrap) wrap.classList.remove('csb-wrap--active');
            renderTab();
        }

        // ═════════════════════════════════════════════════════════════════
        // FIX-BUSCADOR-PEDIDOS-HISTORIA (BarInventario)
        // Buscador fuzzy para las pestañas de Pedidos e Historia, con el
        // mismo comportamiento (tolerancia a typos/acentos, multi-palabra,
        // orden por relevancia) que el buscador de Inicio y el del conteo.
        // Se duplica la puntuación (en vez de reusar _csFuzzyMatch) a
        // propósito: así el buscador de productos existente queda
        // completamente intacto, sin ningún riesgo de romperlo.
        // ═════════════════════════════════════════════════════════════════

        function _csFuzzyMatchOrder(order, query) {
            if (!query) return 1;
            const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const words = norm(query.trim()).split(/\s+/).filter(Boolean);
            if (!words.length) return 1;

            const productNames = (order.products || []).map(p => p.name || '').join(' ');
            const fields = [norm(order.id), norm(order.supplier), norm(order.note || ''), norm(productNames)];
            const haystack = fields.join(' ');
            const tokens   = haystack.split(/\s+/).filter(Boolean);

            let totalScore = 0;
            for (const word of words) {
                let wordScore = 0;
                if (haystack.includes(word)) {
                    wordScore = 10;
                } else if (tokens.some(t => t.startsWith(word))) {
                    wordScore = 7;
                } else if (word.length >= 3) {
                    const qBig = _csBigrams(word);
                    let bestSim = 0;
                    for (const token of tokens) {
                        if (Math.abs(token.length - word.length) > 3) continue;
                        const tBig   = _csBigrams(token);
                        const common = qBig.filter(b => tBig.includes(b)).length;
                        if (common === 0) continue;
                        const sim = (2 * common) / (qBig.length + tBig.length);
                        if (sim > bestSim) bestSim = sim;
                    }
                    if (bestSim >= 0.45) wordScore = Math.max(1, Math.round(bestSim * 6));
                }
                if (wordScore === 0) return 0;
                totalScore += wordScore;
            }
            return totalScore;
        }

        function _csFuzzyMatchInventario(inv, query) {
            if (!query) return 1;
            const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const words = norm(query.trim()).split(/\s+/).filter(Boolean);
            if (!words.length) return 1;

            const productNames = (inv.products || []).map(p => p.name || '').join(' ');
            const areaLabel = (typeof areas !== 'undefined' && areas[inv.area]) ? areas[inv.area] : (inv.area || '');
            const fields = [norm(inv.id), norm(areaLabel), norm(inv.date || ''), norm(productNames)];
            const haystack = fields.join(' ');
            const tokens   = haystack.split(/\s+/).filter(Boolean);

            let totalScore = 0;
            for (const word of words) {
                let wordScore = 0;
                if (haystack.includes(word)) {
                    wordScore = 10;
                } else if (tokens.some(t => t.startsWith(word))) {
                    wordScore = 7;
                } else if (word.length >= 3) {
                    const qBig = _csBigrams(word);
                    let bestSim = 0;
                    for (const token of tokens) {
                        if (Math.abs(token.length - word.length) > 3) continue;
                        const tBig   = _csBigrams(token);
                        const common = qBig.filter(b => tBig.includes(b)).length;
                        if (common === 0) continue;
                        const sim = (2 * common) / (qBig.length + tBig.length);
                        if (sim > bestSim) bestSim = sim;
                    }
                    if (bestSim >= 0.45) wordScore = Math.max(1, Math.round(bestSim * 6));
                }
                if (wordScore === 0) return 0;
                totalScore += wordScore;
            }
            return totalScore;
        }

        function _filtrarPedidos() {
            let filtered = orders;
            if (_pedidosSearchTerm) {
                const scored = filtered
                    .map(function(o) { return { o: o, score: _csFuzzyMatchOrder(o, _pedidosSearchTerm) }; })
                    .filter(function(x) { return x.score > 0; });
                scored.sort(function(a, b) { return b.score - a.score; });
                filtered = scored.map(function(x) { return x.o; });
            }
            return filtered;
        }

        function _filtrarHistoriaInventarios() {
            let filtered = inventories;
            if (_historiaSearchTerm) {
                const scored = filtered
                    .map(function(inv) { return { inv: inv, score: _csFuzzyMatchInventario(inv, _historiaSearchTerm) }; })
                    .filter(function(x) { return x.score > 0; });
                scored.sort(function(a, b) { return b.score - a.score; });
                filtered = scored.map(function(x) { return x.inv; });
            }
            return filtered;
        }

        function updatePedidosSearch(val) {
            const next = (val || '').trimStart();
            clearTimeout(_pedSearchTimer);
            _pedSearchTimer = setTimeout(function() {
                const trimmed = next.trimEnd();
                if (trimmed === _pedidosSearchTerm) return;
                _pedidosSearchTerm = trimmed;
                const wrap = document.getElementById('pedidos-csb-wrap');
                if (wrap) wrap.classList.toggle('csb-wrap--active', !!_pedidosSearchTerm);
                renderTab();
            }, 180);
        }

        function clearPedidosSearch() {
            clearTimeout(_pedSearchTimer);
            _pedidosSearchTerm = '';
            const inp  = document.getElementById('pedidos-search-input');
            const wrap = document.getElementById('pedidos-csb-wrap');
            if (inp)  { inp.value = ''; inp.focus(); }
            if (wrap) wrap.classList.remove('csb-wrap--active');
            renderTab();
        }

        function updateHistoriaSearch(val) {
            const next = (val || '').trimStart();
            clearTimeout(_histSearchTimer);
            _histSearchTimer = setTimeout(function() {
                const trimmed = next.trimEnd();
                if (trimmed === _historiaSearchTerm) return;
                _historiaSearchTerm = trimmed;
                const wrap = document.getElementById('historia-csb-wrap');
                if (wrap) wrap.classList.toggle('csb-wrap--active', !!_historiaSearchTerm);
                renderTab();
            }, 180);
        }

        function clearHistoriaSearch() {
            clearTimeout(_histSearchTimer);
            _historiaSearchTerm = '';
            const inp  = document.getElementById('historia-search-input');
            const wrap = document.getElementById('historia-csb-wrap');
            if (inp)  { inp.value = ''; inp.focus(); }
            if (wrap) wrap.classList.remove('csb-wrap--active');
            renderTab();
        }
