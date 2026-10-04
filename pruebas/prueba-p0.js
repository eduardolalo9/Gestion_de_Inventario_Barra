// P0 — los 4 campos del catálogo sobreviven importar → exportar → reimportar
const { chromium, devices } = require('playwright');
const C=[]; const chk=(n,ok,d)=>C.push({n,ok,d});

(async()=>{
  const nav=await chromium.launch(require('./_lanzar-navegador')());
  const ctx=await nav.newContext({...devices['Pixel 5'],viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,150)));
  // El Service Worker cachea los js por ?v=. En una prueba donde el archivo
  // cambia sin cambiar la version, eso sirve copias viejas y mezcla versiones.
  await p.goto('http://127.0.0.1:' + (process.env.PUERTO || '8080') + '/index.html',{waitUntil:'load'});
  await p.evaluate(async()=>{
    const rs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(rs.map(r=>r.unregister()));
    const ks = await caches.keys();
    await Promise.all(ks.map(k=>caches.delete(k)));
  });
  await p.reload({waitUntil:'load'});
  await p.waitForTimeout(2000);
  chk('La página carga sin errores de JavaScript', errs.length===0, errs.join(' | '));
  chk('XLSX disponible', await p.evaluate(()=>typeof XLSX!=='undefined'), '');

  // El catálogo real (catalogo.xlsx) no está en el repositorio: contiene los
  // datos del bar. Sin él esta prueba no tiene qué importar; se OMITE con
  // aviso claro en vez de fallar con "total=0". Para correrla, copia tu
  // catálogo exportado a la raíz del repo como catalogo.xlsx.
  const hayCatalogo = await p.evaluate(async()=>{ try { return (await fetch('catalogo.xlsx',{method:'HEAD'})).ok; } catch(_) { return false; } });
  if (!hayCatalogo) {
    console.log('\n  ⏭️  P0 omitida: falta catalogo.xlsx en la raíz del repo (no se versiona: son datos del bar).\n');
    await nav.close(); process.exit(0);
  }

  // ── Importar el catálogo REAL por el camino real de la app ──
  const imp = await p.evaluate(async()=>{
    products = [];
    const buf = await (await fetch('catalogo.xlsx')).arrayBuffer();
    const f = new File([buf],'catalogo.xlsx',
      {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const dt = new DataTransfer(); dt.items.add(f);
    const inp = document.getElementById('fileInput');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,3000));
    return {
      total: products.length,
      conPrecio:  products.filter(x=>typeof x.precio==='number').length,
      conConv:    products.filter(x=>typeof x.conversion==='number').length,
      conMinimo:  products.filter(x=>typeof x.stockMinimo==='number').length,
      conProv:    products.filter(x=>x.proveedor).length,
      muestra:    products.find(x=>x.id==='1060052') || products[0]
    };
  });

  chk('Importa los 424 productos del catálogo real', imp.total===424, 'total='+imp.total);
  chk('Precio en 424 de 424', imp.conPrecio===424, 'con precio='+imp.conPrecio);
  chk('Conversión en 419 de 424', imp.conConv===419, 'con conversión='+imp.conConv);
  chk('Stock mínimo en 254 (el 0 cuenta como valor)', imp.conMinimo>=254, 'con mínimo='+imp.conMinimo);
  chk('Proveedor en 420 (4 productos no tienen)', imp.conProv===420, 'con proveedor='+imp.conProv);
  chk('AGUA NATURAL: precio 15.64 y conversión 24 (caja de 24 pzs)',
      imp.muestra && imp.muestra.precio===15.64 && imp.muestra.conversion===24,
      JSON.stringify(imp.muestra));
  chk('El id sigue siendo el código de SAP', imp.muestra && imp.muestra.id==='1060052',
      imp.muestra && imp.muestra.id);

  // ── Exportar y reimportar: los campos NO se pueden perder ──
  const ida = await p.evaluate(async()=>{
    const antes = products.map(x=>({id:x.id,precio:x.precio,conversion:x.conversion,
                                   stockMinimo:x.stockMinimo,proveedor:x.proveedor}));
    // Reconstruir el Excel igual que lo hace exportToExcel, y releerlo
    const ws = XLSX.utils.aoa_to_sheet([
      ['ID','Nombre','Unidad','Grupo','CapacidadML','PesoBotellaOz',
       'Precio','Stock minimo','Conversion de producto','Proveedor'],
      ...products.map(x=>[x.id,x.name,x.unit,x.group,'','',
        typeof x.precio==='number'?x.precio:'',
        typeof x.stockMinimo==='number'?x.stockMinimo:'',
        typeof x.conversion==='number'?x.conversion:'',
        x.proveedor||''])
    ]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Productos');
    const out = XLSX.write(wb,{bookType:'xlsx',type:'array'});
    products = [];                                   // vaciar y reimportar
    const f = new File([out],'reexport.xlsx');
    const dt = new DataTransfer(); dt.items.add(f);
    const inp = document.getElementById('fileInput');
    inp.files = dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,3000));
    const despues = {}; products.forEach(x=>despues[x.id]=x);
    let iguales=0, distintos=[];
    antes.forEach(a=>{
      const b = despues[a.id];
      if (b && b.precio===a.precio && b.conversion===a.conversion
            && b.stockMinimo===a.stockMinimo && b.proveedor===a.proveedor) iguales++;
      else distintos.push({id:a.id, antes:a, despues:b?{precio:b.precio,conversion:b.conversion,
                           stockMinimo:b.stockMinimo,proveedor:b.proveedor}:null});
    });
    return {total:antes.length, iguales, distintos:distintos.slice(0,3)};
  });
  chk('Tras exportar y reimportar, los 4 campos sobreviven en los 424',
      ida.iguales===ida.total, `${ida.iguales}/${ida.total} · ${JSON.stringify(ida.distintos)}`);

  await nav.close();
  const w=Math.max(...C.map(c=>c.n.length));
  C.forEach(c=>console.log('  '+(c.ok?'✅':'❌')+'  '+c.n.padEnd(w)+(c.ok?'':'   ← '+c.d)));
  const mal=C.filter(c=>!c.ok).length;
  console.log(`\n  ${C.length} pruebas · ${C.length-mal} pasaron · ${mal} fallaron`);
  process.exit(mal?1:0);
})();
