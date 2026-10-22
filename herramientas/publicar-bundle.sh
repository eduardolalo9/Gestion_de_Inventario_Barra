#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  publicar-bundle.sh — aplica un .bundle de Claude y lo publica, en UN comando
# ════════════════════════════════════════════════════════════════════════════
#  POR QUÉ EXISTE
#  Un .bundle NO es un despliegue: es un paquete de commits. Hasta que esos
#  commits se FUSIONAN en la rama que publica tu sitio y se SUBEN a GitHub,
#  el teléfono sigue viendo lo de siempre. Entre la 5.3 y la 5.10 los PR que
#  se fusionaron (#39 a #57) eran fusiones main↔produccion que no traían
#  ningún archivo: parecían "actualizar" y no cambiaban nada.
#  Este script hace los pasos en orden, para ante cualquier problema y, sobre
#  todo, COMPRUEBA que la fusión trajo cambios de verdad antes de publicar.
#
#  USO (desde la carpeta de tu repositorio, en Git Bash):
#      bash herramientas/publicar-bundle.sh RUTA/AL/archivo.bundle
#
#  OPCIONES
#      --rama NOMBRE   rama que publica tu sitio (por defecto: produccion)
#      --probar        corre `npm test` antes de publicar
#      --sin-push      fusiona pero NO sube (para revisar primero)
#      --si            no pregunta antes de subir (para uso avanzado)
#
#  NO borra nada y NO reescribe historial: solo hace fetch, merge y push normal.
# ════════════════════════════════════════════════════════════════════════════
set -u

RAMA="produccion"; PROBAR=0; PUSH=1; SI=0; BUNDLE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --rama)     RAMA="${2:-}"; shift 2 ;;
        --probar)   PROBAR=1; shift ;;
        --sin-push) PUSH=0; shift ;;
        --si)       SI=1; shift ;;
        -h|--help)  sed -n '2,29p' "$0"; exit 0 ;;
        -*)         echo "Opción desconocida: $1"; exit 2 ;;
        *)          BUNDLE="$1"; shift ;;
    esac
done

paso() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ok()   { printf '  ✔ %s\n' "$1"; }
alto() { printf '\n\033[31m✖ %s\033[0m\n' "$1"; [ -n "${2:-}" ] && printf '  %s\n' "$2"; exit 1; }
version_de() { git show "$1:sw.js" 2>/dev/null | sed -n "s/.*APP_VERSION *= *'\([^']*\)'.*/\1/p" | head -1; }

# ── 0 · Comprobaciones previas ──────────────────────────────────────────────
[ -n "$BUNDLE" ] || alto "Falta el archivo .bundle" "Uso: bash herramientas/publicar-bundle.sh RUTA/AL/archivo.bundle"
[ -f "$BUNDLE" ] || alto "No existe el archivo: $BUNDLE"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || alto "Esto no es un repositorio git" "Entra primero a la carpeta de tu repositorio (cd ~/Documents/BarInventory-repo)."
RAIZ="$(git rev-parse --show-toplevel)"; cd "$RAIZ" || exit 1
git remote get-url origin >/dev/null 2>&1 || alto "El repositorio no tiene remoto 'origin'"

paso "1/7 Comprobando que no hay cambios sin guardar"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git status --short --untracked-files=no
    alto "Hay cambios sin guardar en archivos del proyecto." "Guárdalos con commit o 'git stash' y vuelve a correr el script. No toco nada hasta que esté limpio."
fi
ok "Árbol de trabajo limpio"

# ── 2 · Verificar el bundle ─────────────────────────────────────────────────
paso "2/7 Verificando el bundle"
git bundle verify "$BUNDLE" >/dev/null 2>&1 || alto "El bundle no es válido o está incompleto" "Vuelve a descargarlo (si pesa muy poco, la descarga se cortó)."
REF="$(git bundle list-heads "$BUNDLE" | head -1 | awk '{print $2}')"
[ -n "$REF" ] || alto "El bundle no trae ninguna rama"
NOMBRE="$(basename "$BUNDLE" .bundle)"
LOCAL="entrega/$NOMBRE"
git fetch --quiet "$BUNDLE" "+$REF:refs/heads/$LOCAL" || alto "No se pudo leer el bundle"
V_BUNDLE="$(version_de "$LOCAL")"
ok "Bundle válido — versión que trae: ${V_BUNDLE:-?}  (rama local de revisión: $LOCAL)"

# ── 3 · Poner al día la rama destino ────────────────────────────────────────
paso "3/7 Preparando la rama '$RAMA'"
git fetch --quiet origin || alto "No se pudo consultar GitHub (¿hay internet?)"
git rev-parse --verify --quiet "refs/heads/$RAMA" >/dev/null \
    || git checkout --quiet -b "$RAMA" "origin/$RAMA" 2>/dev/null \
    || alto "No existe la rama '$RAMA' ni en tu copia ni en GitHub" "Usa --rama NOMBRE con el nombre de la rama que publica tu sitio."
git checkout --quiet "$RAMA" || alto "No se pudo cambiar a '$RAMA'"
if git rev-parse --verify --quiet "origin/$RAMA" >/dev/null; then
    git merge --ff-only --quiet "origin/$RAMA" 2>/dev/null \
        || alto "Tu '$RAMA' local tiene commits que GitHub no tiene (o al revés) y no se puede avanzar limpio." \
                "Revisa con: git log --oneline origin/$RAMA..$RAMA   y   git log --oneline $RAMA..origin/$RAMA"
fi
V_ANTES="$(version_de HEAD)"
ok "'$RAMA' al día con GitHub — versión actual: ${V_ANTES:-?}"

# ── 4 · Fusionar ────────────────────────────────────────────────────────────
paso "4/7 Fusionando $LOCAL en $RAMA"
if git merge-base --is-ancestor "$LOCAL" HEAD; then
    printf '\n\033[33m⚠ Este bundle YA está incluido en %s (versión %s).\033[0m\n' "$RAMA" "${V_ANTES:-?}"
    echo "  No hay nada nuevo que aplicar. Si en el teléfono no la ves, el problema NO es el bundle:"
    echo "  corre  node herramientas/verificar-despliegue.js <URL-de-tu-sitio>  y revisa la sección 'Pages' del informe."
    exit 0
fi
git merge --no-edit --quiet "$LOCAL" >/dev/null 2>&1 || {
    git merge --abort >/dev/null 2>&1
    alto "La fusión tiene conflictos y se canceló sin dejar nada a medias." \
         "Significa que '$RAMA' tiene cambios propios que chocan con el bundle. Avísale a Claude con el nombre de los archivos: git diff --name-only $RAMA $LOCAL"
}
ok "Fusión hecha"

# ── 5 · Comprobar que de verdad trajo cambios ───────────────────────────────
paso "5/7 Comprobando que la fusión trajo archivos nuevos"
V_DESPUES="$(version_de HEAD)"
CAMBIOS="$(git diff --name-only ORIG_HEAD HEAD -- . ':!*.md' | wc -l | tr -d ' ')"
if [ "$CAMBIOS" = "0" ]; then
    git reset --hard --quiet ORIG_HEAD
    alto "La fusión NO cambió ningún archivo de la aplicación (se deshizo)." "Es el mismo síntoma de los PR #39-#48: parece que se actualiza y no se actualiza."
fi
ok "$CAMBIOS archivo(s) de la aplicación cambiaron — versión: ${V_ANTES:-?} → ${V_DESPUES:-?}"
if [ -n "$V_BUNDLE" ] && [ "$V_DESPUES" != "$V_BUNDLE" ]; then
    printf '\033[33m  ⚠ Ojo: el bundle trae la %s pero tu rama quedó en la %s. Revisa antes de publicar.\033[0m\n' "$V_BUNDLE" "$V_DESPUES"
fi
git diff --stat ORIG_HEAD HEAD -- . ':!*.md' | tail -1 | sed 's/^/  /'

# ── 6 · Pruebas (opcional) ──────────────────────────────────────────────────
if [ "$PROBAR" = "1" ]; then
    paso "6/7 Corriendo las pruebas (npm test)"
    npm test || { git reset --hard --quiet ORIG_HEAD; alto "Las pruebas fallaron; la fusión se deshizo." "Nada se publicó."; }
    ok "Pruebas en verde"
else
    paso "6/7 Pruebas"; echo "  (omitidas — agrega --probar para correr 'npm test' antes de publicar)"
fi

# ── 7 · Publicar ────────────────────────────────────────────────────────────
paso "7/7 Publicar en GitHub"
if [ "$PUSH" = "0" ]; then
    echo "  --sin-push: la fusión quedó SOLO en tu computadora. Para publicar:  git push origin $RAMA"
else
    if [ "$SI" = "0" ]; then
        printf '  ¿Subir %s (versión %s) a GitHub ahora? [s/N] ' "$RAMA" "$V_DESPUES"; read -r R
        case "$R" in s|S|si|SI|Si|y|Y) ;; *) echo "  Cancelado. Cuando quieras:  git push origin $RAMA"; exit 0 ;; esac
    fi
    git push origin "$RAMA" || alto "GitHub rechazó el push" "Si la rama está protegida, súbela a otra rama y abre un Pull Request:  git push origin $RAMA:release-$V_DESPUES"
    ok "Subido"
    REPO_URL="$(git remote get-url origin | sed 's/\.git$//')"
    echo
    echo "  Siguiente (1-3 minutos después):"
    echo "    1) Comprobar que el sitio ya sirve la ${V_DESPUES}:"
    echo "         node herramientas/verificar-despliegue.js https://TU-USUARIO.github.io/TU-REPO/ --esperar 300"
    echo "    2) Si tu sitio se publica desde 'main' y no desde '$RAMA', abre este Pull Request y fusiónalo:"
    echo "         $REPO_URL/compare/main...$RAMA?expand=1"
    echo "    3) En el teléfono: abre la app, espera 10 s, toca 'Actualizar' en el aviso (o Más → Buscar actualización)."
fi
