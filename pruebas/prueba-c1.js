// C1 — el aviso al bartender nunca miente.
const { chromium, devices } = require('playwright');
const C=[]; const chk=(n,ok,d)=>{C.push({n,ok,d})};

(async()=>{
  const nav=await chromium.launch(require('./_lanzar-navegador')());
  const ctx=await nav.newContext({...devices['Pixel 5'],viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto('http://127.0.0.1:' + (process.env.PUERTO || '8080') + '/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2000);
  chk('La página carga sin errores de JavaScript', errs.length===0, errs.join(' | '));

  const prep = async () => p.evaluate(()=>{
    window.__avisos=[]; window.__badge=[];
    if(!window.__orig){ window.__orig = showNotification; }
    showNotification = m => window.__avisos.push(m);
    updateCloudSyncBadge = s => window.__badge.push(s);
    products = [{id:'tequila-x', name:'TEQUILA DON JULIO 70', unit:'pza', group:'Tequila',
                 stockByArea:{almacen:0,barra1:0,barra2:0}}];
    if (typeof areas !== 'object' || !areas) window.areas = {};
    areas.almacen='Almacén'; areas.barra1='Barra Restaurante'; areas.barra2='Barra Bar';
  });

  const caso = async (res) => { await prep();
    return p.evaluate(r=>{ _avisarResultadoConteo(r,'tequila-x','almacen');
      return {avisos:window.__avisos, badge:window.__badge}; }, res); };

  const ok = await caso({ok:true, version:4});
  chk('Éxito: confirma y pone el indicador en verde',
      ok.avisos[0].includes('confirmado') && ok.badge.includes('ok'), JSON.stringify(ok));

  const off = await caso({ok:false, motivo:'offline'});
  chk('Sin conexión: NO lo llama error, dice que subirá solo',
      off.avisos[0].includes('Sin conexión') && off.badge.includes('pending'), JSON.stringify(off));

  const cf = await caso({ok:false, motivo:'conflicto_version'});
  chk('Conflicto: nombra el producto y dice que el conteo NO se perdió',
      cf.avisos[0].includes('TEQUILA DON JULIO 70') && cf.avisos[0].includes('Tu conteo está guardado'),
      JSON.stringify(cf));
  chk('Conflicto: el aviso es crítico (empieza por ⚠️, salta el limitador)',
      cf.avisos[0].startsWith('⚠️'), cf.avisos[0]);
  chk('Conflicto: nombra el área en castellano, no el id interno',
      cf.avisos[0].includes('Almacén') && !cf.avisos[0].includes('almacen'), cf.avisos[0]);

  const err = await caso({ok:false, motivo:'lo-que-sea'});
  chk('Fallo desconocido: también avisa y promete reintento',
      err.avisos[0].startsWith('⚠️') && err.avisos[0].includes('reintentar'), JSON.stringify(err));

  // El limitador de 1 s no puede tragarse un aviso de fallo
  const critico = await p.evaluate(()=>{
    showNotification = window.__orig; window.__avisos=[];
    const el=document.getElementById('toastMessage');
    showNotification('mensaje normal');               // arma el limitador
    showNotification('⚠️ fallo que DEBE verse');       // dentro del segundo
    return el ? el.textContent : 'sin toast';
  });
  chk('Un fallo dentro del primer segundo NO se traga', critico.includes('DEBE verse'), critico);

  // Y el texto que sale al guardar ya no afirma lo que no sabe
  const fuente = await p.evaluate(async()=>{
    const r = await fetch('js/70-conversion-render.js?v=2.6'); const t = await r.text();
    return { miente: t.includes("'Conteo guardado en ' + areas["),
             honesto: t.includes('Guardado en el dispositivo') };
  });
  chk('Ya no queda el aviso que afirmaba "Conteo guardado en <área>"', !fuente.miente, JSON.stringify(fuente));
  chk('El aviso inmediato dice "Guardado en el dispositivo"', fuente.honesto, JSON.stringify(fuente));

  await nav.close();
  const w=Math.max(...C.map(c=>c.n.length));
  C.forEach(c=>console.log('  '+(c.ok?'✅':'❌')+'  '+c.n.padEnd(w)+(c.ok?'':'   ← '+c.d)));
  const mal=C.filter(c=>!c.ok).length;
  console.log(`\n  ${C.length} pruebas · ${C.length-mal} pasaron · ${mal} fallaron`);
  process.exit(mal?1:0);
})();
