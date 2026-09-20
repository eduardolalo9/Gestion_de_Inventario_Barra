// P1 — la pestaña de Compras existe, respeta permisos y no rompe nada
const { chromium, devices } = require('playwright');
const C=[]; const chk=(n,ok,d)=>C.push({n,ok,d});

(async()=>{
  const nav=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const ctx=await nav.newContext({...devices['Pixel 5'],viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,150)));
  await p.goto('http://127.0.0.1:' + (process.env.PUERTO || '8080') + '/index.html',{waitUntil:'load'});
  await p.evaluate(async()=>{ const rs=await navigator.serviceWorker.getRegistrations();
    await Promise.all(rs.map(r=>r.unregister())); const ks=await caches.keys();
    await Promise.all(ks.map(k=>caches.delete(k))); });
  await p.reload({waitUntil:'load'}); await p.waitForTimeout(2000);
  chk('La página carga sin errores de JavaScript', errs.length===0, errs.join(' | '));

  const admin = async () => p.evaluate(()=>{
    document.getElementById('authLoadingScreen').classList.add('auth-hidden');
    document.getElementById('loginScreen').classList.add('auth-hidden');
    document.getElementById('appWrapper').classList.add('auth-visible');
    currentUserUid='u'; currentUserRole='admin';
    _authzState.loaded=true; _authzState.permissions=new Set(['*']); _authzState.overrides={};
  });

  chk('Los permisos de compras están en el catálogo cerrado',
      await p.evaluate(()=>['purchases.read','purchases.create','purchases.import','purchases.delete']
        .every(x=>PERMISOS_CATALOGO_SET.has(x))), '');

  // ── Admin: pestaña vacía, con el mensaje correcto ──
  await admin();
  const vacio = await p.evaluate(()=>{ compras=[]; activeTab='compras'; renderTab();
    const t=document.getElementById('tabContent').innerText;
    return {txt:t, botones:[...document.querySelectorAll('#tabContent button')].map(b=>b.textContent.trim())}; });
  chk('Con 0 compras muestra el mensaje de vacío',
      vacio.txt.includes('Todavía no hay compras registradas'), vacio.txt.slice(0,90));
  chk('Ofrece importar y capturar a mano',
      vacio.botones.some(b=>b.includes('Importar')) && vacio.botones.some(b=>b.includes('a mano')),
      JSON.stringify(vacio.botones));

  // ── Con compras: totaliza bien ──
  // FASE 4: `lineas` dejó de ser un conteo (número) y pasó a ser el ARRAY real
  // de renglones — {productoId, cantidadInventario, costoUnitario, importe,
  // enCatalogo} — porque así es como lo exige firestore.rules (lineas is
  // list) y como lo guarda guardarCompra(). El número de unidades ya no es un
  // campo aparte: se calcula sumando cantidadInventario (_unidadesCompra).
  const conDatos = await p.evaluate(()=>{
    compras=[
      {folio:'1898',docSap:'27113',proveedorCodigo:'P00164',proveedorNombre:'STANDARD FOODS',
       fecha:'2026-09-09',importe:8482.68,origen:'excel',
       lineas:[
         {productoId:'P1',cantidadInventario:100,costoUnitario:10,importe:1000,enCatalogo:true},
         {productoId:'P2',cantidadInventario:200,costoUnitario:20,importe:4000,enCatalogo:true},
         {productoId:'P3',cantidadInventario:132,costoUnitario:26.38,importe:3482.68,enCatalogo:true}
       ]},
      {folio:'M-0001',proveedorNombre:'FRESCO DEL VALLE',fecha:'2026-09-10',
       importe:1200.50,origen:'manual',
       lineas:[
         {productoId:'P4',cantidadInventario:10,costoUnitario:80.05,importe:800.50,enCatalogo:true},
         {productoId:'P5',cantidadInventario:5,costoUnitario:80,importe:400,enCatalogo:true}
       ]}
    ];
    renderTab();
    return document.getElementById('tabContent').innerText;
  });
  chk('Suma los importes de las dos compras', conDatos.includes('9,683.18'), conDatos.slice(0,160));
  chk('Cuenta 5 líneas en total', /\b5\b/.test(conDatos), '');
  chk('Cada tarjeta muestra sus unidades sumadas desde las líneas (432 y 15)',
      conDatos.includes('432 unidades') && conDatos.includes('15 unidades'), conDatos.slice(0,400));
  chk('Cuenta 2 proveedores distintos', conDatos.includes('2'), '');
  chk('La fecha sale en castellano y sin corrimiento de día',
      conDatos.includes('9 de septiembre de 2026'), conDatos.slice(0,200));
  chk('Distingue importada de capturada a mano',
      conDatos.includes('importada de Excel') && conDatos.includes('capturada a mano'), '');
  chk('La más reciente aparece primero',
      conDatos.indexOf('FRESCO DEL VALLE') < conDatos.indexOf('STANDARD FOODS'), '');

  // ── Sin permiso: NO debe verse nada ──
  const sinPermiso = await p.evaluate(()=>{
    _authzState.permissions=new Set(['inventory.count']);   // un bartender
    renderTab();
    return document.getElementById('tabContent').innerText;
  });
  chk('Sin purchases.read no muestra ninguna compra',
      sinPermiso.includes('No tienes permiso') && !sinPermiso.includes('STANDARD FOODS'),
      sinPermiso.slice(0,100));

  // ── No haber roto las demás pestañas ──
  const otras = await p.evaluate(()=>{
    _authzState.permissions=new Set(['*']);
    const res={};
    ['inicio','productos','pedidos','inventario','historia','ajustes'].forEach(t=>{
      try{ activeTab=t; renderTab(); res[t]=document.getElementById('tabContent').innerHTML.length>0; }
      catch(e){ res[t]='ERROR: '+e.message; }
    });
    return res;
  });
  chk('Las 6 pestañas anteriores siguen renderizando',
      Object.values(otras).every(v=>v===true), JSON.stringify(otras));
  chk('Sin errores de JS en toda la prueba', errs.length===0, errs.join(' | '));

  await nav.close();
  const w=Math.max(...C.map(c=>c.n.length));
  C.forEach(c=>console.log('  '+(c.ok?'✅':'❌')+'  '+c.n.padEnd(w)+(c.ok?'':'   ← '+c.d)));
  const mal=C.filter(c=>!c.ok).length;
  console.log(`\n  ${C.length} pruebas · ${C.length-mal} pasaron · ${mal} fallaron`);
  process.exit(mal?1:0);
})();
