# Respaldo FUERA de GitHub (Google Drive) — pasos

El respaldo semanal ya se genera y se **cifra** (AES-256) en GitHub Actions. Con esto, además, cada respaldo cifrado se copia a **tu Google Drive** y se verifica que quedó completo. Así, si algo le pasa a tu cuenta de GitHub o al repositorio, tus datos siguen en tu Drive.

Lo que sube a Drive es **solo el archivo `.gpg` (cifrado)**. Sin tu contraseña (`RESPALDO_PASSPHRASE`) no sirve a nadie.

## Paso 1 — Instalar rclone en tu PC (una sola vez)
1. Descarga rclone para Windows desde https://rclone.org/downloads/ (Windows · Intel/AMD 64 Bit) y descomprímelo, por ejemplo en `C:\rclone`.
2. Abre **PowerShell** y entra a esa carpeta:
   ```powershell
   cd C:\rclone
   ```

## Paso 2 — Conectar tu Google Drive
```powershell
.\rclone config
```
Responde así (lo demás, Enter):
| Pregunta | Respuesta |
|---|---|
| `n) New remote` | `n` |
| `name>` | `respaldo`  (exactamente así, en minúsculas) |
| `Storage>` | `drive` (escribe la palabra, o el número que tenga «Google Drive») |
| `client_id>` y `client_secret>` | Enter (vacío) |
| `scope>` | `3`  (**drive.file**: rclone solo ve los archivos que él mismo crea; no puede leer el resto de tu Drive) |
| `service_account_file>` | Enter |
| `Edit advanced config?` | `n` |
| `Use web browser to automatically authenticate?` | `y` → se abre el navegador: inicia sesión con **tu cuenta de Google** y pulsa **Permitir** |
| `Configure this as a Shared Drive?` | `n` |
| `Yes this is OK` | `y` |
Luego `q` para salir.

Comprueba que funciona:
```powershell
.\rclone mkdir respaldo:BarInventory-respaldos
.\rclone lsd respaldo:
```
Debe aparecer la carpeta **BarInventory-respaldos** (y también la verás en tu Google Drive).

## Paso 3 — Guardar la configuración como secreto de GitHub
1. Muestra dónde quedó el archivo y ábrelo:
   ```powershell
   .\rclone config file
   notepad (.\rclone config file | Select-Object -Last 1)
   ```
2. Copia **todo** el contenido del archivo (empieza con `[respaldo]`). **No lo pegues en ningún chat ni lo subas al repositorio**: contiene el permiso de acceso a tu carpeta.
3. En GitHub: repositorio → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `RCLONE_CONF`
   - Secret: pega el contenido. Guardar.

## Paso 4 — Probarlo
1. GitHub → pestaña **Actions** → **Respaldo semanal de Firestore** → **Run workflow**.
2. Al terminar (≈ 2 min) abre la ejecución: el resumen debe decir **✅ respaldo-….json.gpg copiado a Drive y verificado**, y el archivo debe aparecer en `BarInventory-respaldos` de tu Drive.
3. Si el paso dice «Copia fuera de GitHub NO configurada», el secreto no se guardó con el nombre `RCLONE_CONF`.

## Revisión mensual (5 minutos)
- En tu Drive: la carpeta `BarInventory-respaldos` debe tener un archivo nuevo cada lunes.
- Una vez al mes, **comprueba que un respaldo sirve** (descifrar y revisar):
  ```powershell
  gpg --batch --yes --passphrase "TU_PASSPHRASE" --decrypt respaldo-AAAA-MM-DD.json.gpg > respaldo.json
  node herramientas/verificar-respaldo.js respaldo.json
  ```
  Debe terminar en **✅ El respaldo sirve.** (usuarios > 0 y documentos en compras, ventas, inventories…).
- Un correo de GitHub «Respaldo semanal… failed» significa que ese lunes **no** se respaldó: avísame.

## Si algún día cambias de cuenta de Google o revocas el permiso
Repite los pasos 2 y 3 (el secreto `RCLONE_CONF` se reemplaza).
