// REDISEÑO R7d — Notificaciones, Ajustes, Admin/Permisos, Historia, insignia de sincronía
// y aviso sin conexión, en pantalla real (Chromium 390×844), tema oscuro y claro.
const { chromium } = require('playwright');
const C = []; const chk = (n, ok, d) => C.push({ n, ok, d: d || '' });
const PUERTO = process.env.PUERTO || '8080';

(async () => {
  const nav = await chromium.launch(require('./_lanzar-navegador')());
  const p = await (await nav.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('http://127.0.0.1:' + PUERTO + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async () => {
    const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1000);
  chk('La app carga sin errores de JavaScript', errs.length === 0, errs.join(' | '));

  await p.evaluate(() => {
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid = 'adm1'; _authzState.loaded = true; _authzState.overrides = {};
    _authzState.permissions = new Set(['*']); _authzState.roleId = 'ADMIN';
    products = [{ id: 'P1', name: 'TEQUILA DON JULIO', unit: 'Botellas', group: 'Premium' }];
    // utilidades de medición, compartidas por todas las pantallas
    window.__m = {
      rgb: s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number),
      lum: ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); },
      // Fondo efectivo: se compone, de la raíz hacia el elemento, cada capa con su alfa
      // (un fondo translúcido como --accent-dim NO es opaco: mide contra lo que tiene debajo).
      efectivo(el) {
        const cadena = []; for (let e = el; e; e = e.parentElement) cadena.push(e);
        let base = this.rgb(getComputedStyle(document.documentElement).backgroundColor); if (base.length < 3 || (base.length === 4 && base[3] === 0)) base = [255, 255, 255];
        base = base.slice(0, 3);
        for (let i = cadena.length - 1; i >= 0; i--) {
          const c = this.rgb(getComputedStyle(cadena[i]).backgroundColor);
          if (c.length < 3) continue; const a = c.length === 4 ? c[3] : 1;
          if (a > 0) base = [0, 1, 2].map(k => c[k] * a + base[k] * (1 - a));
        }
        return base;
      },
      contraste(el) { const fg = this.rgb(getComputedStyle(el).color).slice(0, 3); const a = this.lum(fg), b = this.lum(this.efectivo(el)); return +((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2); },
      emoji(txt) { return (txt.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).join(' '); },
      alto(el) { return +el.getBoundingClientRect().height.toFixed(1); }
    };
  });
  const tema = (t) => p.evaluate(t => document.documentElement.setAttribute('data-theme', t), t);

  for (const t of ['dark', 'light']) {
    await tema(t);
    const T = '[' + t + '] ';

    // ══ A · NOTIFICACIONES ═══════════════════════════════════════════════
    await p.evaluate(() => {
      _notificaciones = [
        { id: 'n1', tipo: 'ajuste',  texto: '📝 Ajuste solicitado: TEQUILA — conteo real', creadoEn: Date.now(), leido: false },
        { id: 'n2', tipo: 'reporte', texto: '📊 Reporte global publicado — disponible para descarga', creadoEn: Date.now() - 6e4, leido: false },
        { id: 'n3', tipo: 'ajuste',  texto: '✅ Ajuste aprobado: TEQUILA', creadoEn: Date.now() - 12e4, leido: true }
      ];
      activeTab = 'notificaciones'; renderTab();
    });
    await p.waitForTimeout(150);
    const nt = await p.evaluate(() => {
      const c = document.getElementById('tabContent'); const M = window.__m;
      const botones = [...c.querySelectorAll('button.ui-link')];
      const item = c.querySelector('.notif-item.unread .notif-text');
      return {
        emoji: M.emoji(c.innerText), estilos: c.querySelectorAll('[style]').length,
        iconos: c.querySelectorAll('.nt-icono i').length,
        sinEmojiInicial: [...c.querySelectorAll('.notif-text')].map(x => x.textContent),
        altos: botones.map(b => M.alto(b)), nBotones: botones.length,
        contraste: item ? M.contraste(item) : 0,
        hora: getComputedStyle(c.querySelector('.notif-time')).fontFamily
      };
    });
    chk(T + '★ Notificaciones: sin emoji de interfaz ni style="…"; icono por tipo en cada fila', nt.emoji === '' && nt.estilos === 0 && nt.iconos === 3, JSON.stringify(nt).slice(0, 220));
    chk(T + 'El texto se pinta sin el emoji inicial (el dato guardado no cambia)', nt.sinEmojiInicial.every(x => /^[A-Za-zÁ-ú]/.test(x)), nt.sinEmojiInicial.join(' | '));
    chk(T + '★ "Marcar todas leídas" y "Leído" miden ≥ 44 px (antes min-height:auto)', nt.nBotones === 3 && nt.altos.every(h => h >= 44), nt.altos.join(','));
    chk(T + 'El texto de una notificación nueva contrasta ≥ 4.5', nt.contraste >= 4.5, String(nt.contraste));

    // ══ B · AJUSTES — usuario (formulario) y admin (pendientes + áreas) ════
    await p.evaluate(() => { _authzState.permissions = new Set(['inventory.read']); _authzState.roleId = 'USER'; _ajustes = []; activeTab = 'ajustes'; renderTab(); });
    await p.waitForTimeout(150);
    const fAj = await p.evaluate(() => {
      const c = document.getElementById('tabContent'); const M = window.__m;
      const campos = [...c.querySelectorAll('.ui-campo')];
      const enviar = [...c.querySelectorAll('button')].find(b => /Enviar solicitud/.test(b.textContent));
      return { emoji: M.emoji(c.innerText), estilos: c.querySelectorAll('[style]').length, campos: campos.length,
               altos: campos.map(x => M.alto(x)), enviar: enviar ? M.alto(enviar) : 0, fs: campos[0] ? getComputedStyle(campos[0]).fontSize : '' };
    });
    chk(T + '★ Ajustes (usuario): formulario sin emoji ni style; 3 campos ≥ 44 px y letra de 16 px (sin zoom en iOS)',
        fAj.emoji === '' && fAj.estilos === 0 && fAj.campos === 3 && fAj.altos.every(h => h >= 44) && fAj.fs === '16px', JSON.stringify(fAj));
    chk(T + '"Enviar solicitud" mide ≥ 48 px', fAj.enviar >= 48, String(fAj.enviar));

    await p.evaluate(() => {
      _authzState.permissions = new Set(['*']); _authzState.roleId = 'ADMIN';
      _ajustes = [
        { id: 'a1', estado: 'pendiente', productoId: 'P1', productoNombre: 'TEQUILA DON JULIO', motivo: 'conteo real vs sistema', creadoEn: Date.now(), solicitanteUid: 'u2', cantidadSugerida: 3 },
        { id: 'a2', estado: 'aprobado', productoId: 'P1', productoNombre: 'TEQUILA DON JULIO', motivo: 'ok', creadoEn: Date.now(), solicitanteUid: 'u2' }
      ];
      renderTab();
    });
    await p.waitForTimeout(150);
    const aA = await p.evaluate(() => {
      const c = document.getElementById('tabContent'); const M = window.__m;
      const ok = c.querySelector('.ajuste-btn.ok'), nok = c.querySelector('.ajuste-btn.nok');
      const iconoArea = c.querySelector('.aj-area__icono');
      const edit = c.querySelector('.aj-area .ui-icono-btn');
      const sinIcono = [...c.querySelectorAll('.ajuste-btn i, .aj-area .ui-icono-btn i')].filter(i => i.getBoundingClientRect().width < 6).length;
      const textoSinAreas = [...c.querySelectorAll('.adm-card')].map(x => x.innerText).join(' ').replace(/[📦🍽🍸📍]️?/gu, '');
      return {
        emoji: M.emoji(textoSinAreas), estilos: c.querySelectorAll('[style]').length,
        ok: ok ? { alto: M.alto(ok), c: M.contraste(ok) } : null, nok: nok ? { alto: M.alto(nok), c: M.contraste(nok) } : null,
        areas: c.querySelectorAll('.aj-area').length, iconoArea: iconoArea ? iconoArea.textContent.length > 0 : false,
        editAlto: edit ? [M.alto(edit), edit.getBoundingClientRect().width] : null, sinIcono
      };
    });
    chk(T + '★ Ajustes (admin): sin emoji de interfaz (el icono del ÁREA sigue siendo dato) ni style="…"', aA.emoji === '' && aA.estilos === 0, JSON.stringify(aA));
    chk(T + '★ Aprobar y Rechazar: ≥ 44 px (antes ~24) y contraste ≥ 4.5',
        aA.ok && aA.nok && aA.ok.alto >= 44 && aA.nok.alto >= 44 && aA.ok.c >= 4.5 && aA.nok.c >= 4.5, JSON.stringify([aA.ok, aA.nok]));
    chk(T + 'Las áreas de conteo siguen listadas con su icono de dato, y editar/eliminar miden ≥ 44×44',
        aA.areas >= 4 && aA.iconoArea && aA.editAlto && aA.editAlto[0] >= 44 && aA.editAlto[1] >= 44, JSON.stringify(aA.editAlto));
    chk(T + 'Los iconos de Ajustes tienen ancho real (el kit los pinta)', aA.sinIcono === 0, String(aA.sinIcono));

    // ══ C · ADMIN ═════════════════════════════════════════════════════════
    await p.evaluate(() => { _adminSubvista = 'panel'; activeTab = 'admin'; renderTab(); });
    await p.waitForTimeout(150);
    const ad = await p.evaluate(() => {
      const c = document.getElementById('tabContent'); const M = window.__m;
      const btns = [...c.querySelectorAll('.adm-btn')];
      const prim = c.querySelector('.adm-btn.primary'), warn = c.querySelector('.adm-btn.warn'), succ = c.querySelector('.adm-btn.success');
      const h3 = [...c.querySelectorAll('.adm-card h3 i')].filter(i => i.getBoundingClientRect().width < 6).length;
      return { emoji: M.emoji(c.innerText), estilos: c.querySelectorAll('[style]').length, n: btns.length,
               altos: btns.map(b => M.alto(b)), prim: prim ? M.contraste(prim) : 0, warn: warn ? M.contraste(warn) : 0, succ: succ ? M.contraste(succ) : 0, h3 };
    });
    chk(T + '★ Admin: sin emoji de interfaz ni style="…"', ad.emoji === '' && ad.estilos === 0, JSON.stringify(ad).slice(0, 200));
    chk(T + '★ Admin: todos los botones miden ≥ 48 px', ad.n >= 6 && ad.altos.every(h => h >= 48), ad.altos.join(','));
    chk(T + '★ Admin: texto del botón primario contrasta ≥ 4.5 (antes blanco sobre latón)', ad.prim >= 4.5, String(ad.prim));
    chk(T + 'Admin: botones "warn" y "success" contrastan ≥ 4.5', ad.warn >= 4.5 && ad.succ >= 4.5, ad.warn + ' / ' + ad.succ);
    chk(T + 'Admin: los iconos de los títulos tienen ancho real', ad.h3 === 0, String(ad.h3));

    // ══ D · USUARIOS Y PERMISOS ═══════════════════════════════════════════
    await p.evaluate(() => {
      _adminSubvista = 'permisos'; _permCargando = false; _permError = null;
      _permUsuarios = [{ uid: 'u2', email: 'barman@bar.mx', role: 'USER', status: 'activo' }];
      permSeleccionarUsuario('u2'); renderTab();
    });
    await p.waitForTimeout(200);
    const pr = await p.evaluate(() => {
      const c = document.getElementById('tabContent'); const M = window.__m;
      const sel = c.querySelector('#permUserSel'), rol = c.querySelector('#permRolSel');
      const filas = [...c.querySelectorAll('.pr-fila')];
      const cb = c.querySelector('.pr-fila input[type=checkbox]');
      const asig = c.querySelector('.pr-estado--asignado');
      const bg = (el) => el ? M.efectivo(el).map(Math.round).join(',') : null;
      return {
        emoji: M.emoji(c.innerText), estilos: c.querySelectorAll('[style]').length,
        selBg: sel ? getComputedStyle(sel).backgroundColor : null, rolBg: rol ? getComputedStyle(rol).backgroundColor : null,
        selAlto: sel ? M.alto(sel) : 0, rolAlto: rol ? M.alto(rol) : 0,
        filas: filas.length, filaMin: filas.length ? Math.min(...filas.map(f => M.alto(f))) : 0,
        cb: cb ? [cb.getBoundingClientRect().width, cb.getBoundingClientRect().height] : null,
        badges: [...new Set([...c.querySelectorAll('.pr-estado')].map(x => x.className.replace('pr-estado ', '')))],
        coloresBadge: [...c.querySelectorAll('.pr-estado')].slice(0, 6).map(x => M.contraste(x)),
        sensibles: c.querySelectorAll('.ui-aviso-estado').length, sinIcono: [...c.querySelectorAll('i.fa-solid')].filter(i => i.getBoundingClientRect().width < 6).length
      };
    });
    chk(T + '★ Permisos: sin emoji ni style="…"', pr.emoji === '' && pr.estilos === 0, JSON.stringify(pr).slice(0, 220));
    chk(T + '★ Los selectores de usuario y rol ya tienen fondo real (antes: tokens inexistentes) y miden ≥ 44 px',
        pr.selBg && pr.selBg !== 'rgba(0, 0, 0, 0)' && pr.rolBg && pr.rolBg !== 'rgba(0, 0, 0, 0)' && pr.selAlto >= 44 && pr.rolAlto >= 44, JSON.stringify([pr.selBg, pr.rolBg, pr.selAlto]));
    chk(T + '★ Cada permiso es una fila ≥ 48 px con casilla de 24 px', pr.filas > 10 && pr.filaMin >= 48 && pr.cb && pr.cb[0] >= 24 && pr.cb[1] >= 24, JSON.stringify([pr.filas, pr.filaMin, pr.cb]));
    chk(T + 'Las etiquetas de estado ("Del rol", "Asignado"…) se ven con palabra y contraste ≥ 3', pr.badges.length >= 1 && pr.coloresBadge.every(x => x >= 3), JSON.stringify([pr.badges, pr.coloresBadge]));
    chk(T + 'Los iconos de Permisos tienen ancho real', pr.sinIcono === 0, String(pr.sinIcono));

    // ══ E · HISTORIA ══════════════════════════════════════════════════════
    await p.evaluate(() => {
      inventories = [];
      _db = { collection: () => ({ orderBy: () => ({ limit: () => ({ get: () => Promise.resolve({ empty: false, docs: [{ id: 'r1', data: () => ({ fecha: '2026-10-01', totalProductos: 42 }) }] }) }) }) }) };
      activeTab = 'historia'; renderTab();
    });
    await p.waitForTimeout(400);
    const hs = await p.evaluate(() => {
      const c = document.getElementById('tabContent'); const M = window.__m;
      const borrar = c.querySelector('.ui-icono-btn--peligro'); const desc = c.querySelector('.hs-rep-acciones .adm-btn');
      return { emoji: M.emoji(c.innerText), estilos: c.querySelectorAll('[style]').length, vacio: !!c.querySelector('.ui-vacio--caja i'),
               tarjetas: c.querySelectorAll('.rep-card').length, borrar: borrar ? [M.alto(borrar), borrar.getBoundingClientRect().width, M.contraste(borrar)] : null,
               desc: desc ? M.alto(desc) : 0, cifra: getComputedStyle(c.querySelector('.rep-card-meta')).fontFamily,
               sinIcono: [...c.querySelectorAll('i.fa-solid')].filter(i => i.getBoundingClientRect().width < 6).length };
    });
    chk(T + '★ Historia: sin emoji ni style="…", con estado vacío de icono del kit', hs.emoji === '' && hs.estilos === 0 && hs.vacio, JSON.stringify(hs));
    chk(T + '★ Reporte publicado: "Descargar" ≥ 48 px y eliminar ≥ 44×44 con contraste ≥ 3 (sin SVG a mano)',
        hs.tarjetas === 1 && hs.desc >= 48 && hs.borrar && hs.borrar[0] >= 44 && hs.borrar[1] >= 44 && hs.borrar[2] >= 3, JSON.stringify([hs.desc, hs.borrar]));
    chk(T + 'Los iconos de Historia tienen ancho real y la cifra va en Plex Mono', hs.sinIcono === 0 && /Plex Mono/i.test(hs.cifra), hs.sinIcono + ' / ' + hs.cifra);
    await p.evaluate(() => { _db = null; });

    // ══ F · INSIGNIA DE SINCRONÍA ═════════════════════════════════════════
    const sy = await p.evaluate(() => {
      const M = window.__m; _db = {}; const out = {};
      ['ok', 'syncing', 'pending', 'error', 'offline'].forEach(st => {
        updateCloudSyncBadge(st);
        const b = document.getElementById('cloudSyncBadge'); const btn = b.querySelector('.sy-insignia__btn'); const i = b.querySelector('i');
        out[st] = { data: b.getAttribute('data-sync'), texto: b.innerText.trim(), icono: i ? i.getBoundingClientRect().width : 0, contraste: M.contraste(b),
                    btn: btn ? M.alto(btn) : null, emoji: M.emoji(b.innerText), inline: b.getAttribute('style') };
      });
      _db = null; updateCloudSyncBadge('ok');
      const n = document.getElementById('cloudSyncBadge');
      out.none = { data: n.getAttribute('data-sync'), texto: n.innerText.trim() };
      return out;
    });
    chk(T + '★ Insignia de sincronía: cada estado lleva icono + palabra y ninguno trae emoji ni style en línea',
        Object.keys(sy).filter(k => k !== 'none').every(k => sy[k].icono >= 6 && sy[k].texto.length > 3 && sy[k].emoji === '' && sy[k].inline === null), JSON.stringify(sy).slice(0, 260));
    chk(T + '★ Insignia: contraste ≥ 4.5 en ok/syncing/pending/error/offline',
        ['ok', 'syncing', 'pending', 'error', 'offline'].every(k => sy[k].contraste >= 4.5), JSON.stringify(['ok', 'syncing', 'pending', 'error', 'offline'].map(k => sy[k].contraste)));
    chk(T + '"Sincronizar ahora" mide ≥ 44 px (salvo en "Sincronizando…", donde no se ofrece)', sy.ok.btn >= 44 && sy.pending.btn >= 44 && sy.error.btn >= 44 && sy.syncing.btn === null, JSON.stringify([sy.ok.btn, sy.syncing.btn]));
    chk(T + 'Sin Firebase la insignia cae en "none" y lo dice', sy.none.data === 'none' && /Sin Firebase/.test(sy.none.texto), JSON.stringify(sy.none));

    // ══ G · AVISO SIN CONEXIÓN E INSIGNIA DE ROL ═════════════════════════
    const net = await p.evaluate(() => {
      const M = window.__m;
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      updateNetworkStatus();
      const b = document.getElementById('networkStatus');
      const r = b ? b.getBoundingClientRect() : null;
      const out = b ? { clase: b.className, rol: b.getAttribute('role'), icono: b.querySelector('i').getBoundingClientRect().width, emoji: M.emoji(b.innerText),
                        texto: b.innerText.trim(), inline: b.getAttribute('style'), contraste: M.contraste(b), bottomLibre: window.innerHeight - r.bottom >= 80, ancho: r.width } : null;
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      const ex = document.getElementById('networkStatus'); if (ex) ex.remove();
      applyRoleUI();
      const rb = document.getElementById('sbRoleBadge');
      return { net: out, rol: rb ? { icono: rb.querySelector('i') ? rb.querySelector('i').getBoundingClientRect().width : 0, texto: rb.innerText.trim(), emoji: M.emoji(rb.innerText), contraste: M.contraste(rb) } : null };
    });
    chk(T + '★ Aviso sin conexión: clase .net-aviso, role="status", icono + texto, sin style ni emoji, contraste ≥ 4.5 y por encima de la barra inferior',
        net.net && net.net.clase === 'net-aviso' && net.net.rol === 'status' && net.net.icono >= 6 && net.net.emoji === '' && net.net.inline === null && net.net.contraste >= 4.5 && net.net.bottomLibre && /Sin conexión/.test(net.net.texto), JSON.stringify(net.net));
    chk(T + '★ Insignia de rol (menú Más): icono del kit + palabra, sin emoji (antes 👑/👤), contraste ≥ 4.5',
        net.rol && net.rol.icono >= 6 && net.rol.emoji === '' && /admin|usuario/i.test(net.rol.texto) && net.rol.contraste >= 4.5, JSON.stringify(net.rol));
  }

  chk('Sin errores de JS en toda la prueba', errs.length === 0, errs.join(' | '));
  await nav.close();

  const w = Math.max(...C.map(x => x.n.length));
  console.log('\n  ── REDISEÑO R7d · Historia, Notificaciones, Ajustes, Admin y Roles (navegador) ──\n');
  C.forEach(x => console.log('  ' + (x.ok ? '✅' : '❌') + '  ' + x.n.padEnd(w) + (x.ok ? '' : '   ← ' + x.d)));
  const fallos = C.filter(x => !x.ok).length;
  console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos) + ' pasaron · ' + fallos + ' fallaron\n');
  process.exit(fallos ? 1 : 0);
})();
