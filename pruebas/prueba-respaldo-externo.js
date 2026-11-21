// v5.58 — Respaldo fuera de GitHub (Google Drive vía rclone) y verificador del contenido del respaldo.
//   node pruebas/prueba-respaldo-externo.js
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process'), os = require('os');
const RAIZ = path.join(__dirname, '..');
const C = []; const chk = (n, ok, d) => C.push({ n, ok: !!ok, d: d || '' });
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const wf = leer('.github/workflows/respaldo.yml');
const { analizar, contarNodo } = require('../herramientas/verificar-respaldo');

// ═══ 1 · El workflow ═══
const iUp = wf.indexOf('Guardar el respaldo cifrado'), iDrive = wf.indexOf('Copiar el respaldo CIFRADO a Google Drive'), iCif = wf.indexOf('Cifrar (AES-256)');
chk('★ La copia a Drive va DESPUÉS de cifrar: nunca se sube el JSON en claro', iCif > 0 && iDrive > iCif && iDrive > iUp);
chk('★ Solo se copian archivos .gpg (--include \'*.gpg\'): el JSON en claro no puede salir del runner', /rclone --config "\$RUNNER_TEMP\/rclone\.conf" copy respaldos\/ "\$DESTINO" --include '\*\.gpg'/.test(wf));
chk('El destino es una carpeta propia «BarInventory-respaldos» del remoto «respaldo»', /DESTINO="respaldo:BarInventory-respaldos"/.test(wf));
chk('★ VERIFICA la copia: compara los bytes de Drive con los del archivo local y falla si no coinciden o no existe', /rclone --config "\$RUNNER_TEMP\/rclone\.conf" lsjson "\$DESTINO" --files-only --include "\$n"/.test(wf) && /\[ "\$remoto_size" != "\$local_size" \]/.test(wf) && /::error::La copia en Drive NO coincide/.test(wf));
chk('Sin el secreto RCLONE_CONF no rompe el respaldo: avisa (warning + resumen) y sale con 0', /if \[ -z "\$RCLONE_CONF" \]; then[\s\S]{0,400}::warning::Copia fuera de GitHub NO configurada[\s\S]{0,300}exit 0/.test(wf));
chk('★ La configuración de rclone viene de un SECRETO, se escribe con permisos 600 (umask 077), no se imprime y se BORRA siempre al final', /RCLONE_CONF: \$\{\{ secrets\.RCLONE_CONF \}\}/.test(wf) && /umask 077/.test(wf) && !/echo "\$RCLONE_CONF"|cat "\$RUNNER_TEMP\/rclone\.conf"/.test(wf) && /if: always\(\)\s*\n\s*run: rm -f "\$RUNNER_TEMP\/cuenta\.json" "\$RUNNER_TEMP\/rclone\.conf"/.test(wf));
chk('rclone se instala del repositorio de la distribución (paquete firmado de Ubuntu), no con «curl | sh»', /sudo apt-get install -y rclone/.test(wf) && !/curl[^\n]*\|\s*(sudo )?(ba)?sh/.test(wf));
chk('★ Verifica que el respaldo TRAE DATOS antes de cifrar, con pipefail: un respaldo vacío hace fallar el trabajo', /Verificar que el respaldo trae datos[\s\S]{0,300}set -o pipefail[\s\S]{0,200}verificar-respaldo\.js/.test(wf) && wf.indexOf('Verificar que el respaldo trae datos') < iCif);
chk('El artefacto de GitHub (90 días, cifrado) se conserva igual: la copia externa se SUMA, no lo reemplaza', /retention-days: 90/.test(wf) && /path: respaldos\/\*\.gpg/.test(wf));
chk('El respaldo sigue cifrándose con AES-256 y borrando el JSON en claro', /--cipher-algo AES256/.test(wf) && /rm -f "\$f"/.test(wf));
chk('La guía de pasos para el propietario existe e incluye drive.file (mínimo privilegio), el secreto RCLONE_CONF y la revisión mensual', (() => { const g = leer('herramientas/respaldo-externo.md'); return /drive\.file/.test(g) && /RCLONE_CONF/.test(g) && /verificar-respaldo/.test(g) && /Revisión mensual/.test(g); })());

// ═══ 2 · Verificador del contenido ═══
const doc = (id, subs) => ({ __id: id, __ruta: 'x/' + id, __existe: true, datos: {}, subcolecciones: subs || {} });
const bueno = { __version: 1, __generado: new Date().toISOString(), __proyecto: 'gestor', __emulador: false, __docPrincipal: 'barra-principal',
  inventarioApp: doc('barra-principal', { compras: [doc('c1'), doc('c2')], ventas: [doc('v1')], inventories: [doc('i1', { snapshotChunks: [doc('k0')] })], movimientos: [doc('m1')] }),
  raiz: { usuarios: [doc('u1'), doc('u2')], roles: [doc('r1')], catalogo: [] } };
const a = analizar(bueno);
chk('★ Un respaldo con datos: sirve, cuenta bien los documentos (raíz 1 + 2 + 1 + 2 + 1 + usuarios 2 + roles 1 = 10) y no hay problemas graves', a.ok && a.resumen.total === 10 && a.graves.length === 0, JSON.stringify([a.resumen.total, a.graves]));
chk('Cuenta recursivamente las subcolecciones (inventories/i1/snapshotChunks)', contarNodo(bueno.inventarioApp.subcolecciones.inventories[0]) === 2);
const vacio = JSON.parse(JSON.stringify(bueno)); vacio.inventarioApp = doc('barra-principal'); vacio.inventarioApp.__existe = false; vacio.raiz = { usuarios: [], roles: [], catalogo: [] };
chk('★ Un respaldo VACÍO (credenciales del proyecto equivocado) NO sirve: grave', analizar(vacio).ok === false && analizar(vacio).graves.length >= 2);
const sinUsr = JSON.parse(JSON.stringify(bueno)); sinUsr.raiz.usuarios = [];
chk('★ Sin usuarios no sirve (no se podría volver a entrar tras restaurar)', analizar(sinUsr).ok === false && analizar(sinUsr).graves.some(g => /usuarios/.test(g)));
const emu = JSON.parse(JSON.stringify(bueno)); emu.__emulador = true;
chk('Un respaldo del emulador no se acepta como de producción', analizar(emu).ok === false);
chk('Un archivo que no es un respaldo se reconoce (noEsRespaldo)', analizar({ hola: 1 }).noEsRespaldo === true && analizar(null).ok === false);
const viejo = JSON.parse(JSON.stringify(bueno)); viejo.__generado = new Date(Date.now() - 20 * 86400000).toISOString();
chk('Un respaldo de hace 20 días da AVISO (el semanal debería ser reciente) pero no es grave', analizar(viejo).ok === true && analizar(viejo).avisos.some(x => /días/.test(x)));
const sinCompras = JSON.parse(JSON.stringify(bueno)); sinCompras.inventarioApp.subcolecciones.compras = [];
chk('Una sección esperada vacía (compras) es solo un aviso', analizar(sinCompras).ok === true && analizar(sinCompras).avisos.some(x => /compras/.test(x)));
// CLI
const tmp = path.join(os.tmpdir(), 'resp-' + process.pid + '.json'); fs.writeFileSync(tmp, JSON.stringify(bueno));
const r1 = spawnSync(process.execPath, [path.join(RAIZ, 'herramientas', 'verificar-respaldo.js'), tmp], { encoding: 'utf8' });
fs.writeFileSync(tmp, JSON.stringify(vacio)); const r2 = spawnSync(process.execPath, [path.join(RAIZ, 'herramientas', 'verificar-respaldo.js'), tmp], { encoding: 'utf8' });
fs.writeFileSync(tmp, 'no es json'); const r3 = spawnSync(process.execPath, [path.join(RAIZ, 'herramientas', 'verificar-respaldo.js'), tmp], { encoding: 'utf8' });
fs.rmSync(tmp, { force: true });
chk('★ CLI: sale con 0 si sirve, 1 si está vacío y 2 si no es un respaldo', r1.status === 0 && /El respaldo sirve/.test(r1.stdout) && r2.status === 1 && /NO sirve/.test(r2.stdout) && r3.status === 2, [r1.status, r2.status, r3.status].join());

const fallos = C.filter(c => !c.ok);
C.forEach(c => console.log('  ' + (c.ok ? '✅' : '❌') + ' ' + c.n + (c.ok ? '' : '  ←  ' + c.d)));
console.log('\n  ' + C.length + ' comprobaciones · ' + (C.length - fallos.length) + ' pasaron · ' + fallos.length + ' fallaron\n');
process.exit(fallos.length ? 1 : 0);
