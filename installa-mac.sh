#!/bin/bash
# Installa Pico MultiView su un Mac, da zero, con un solo comando:
#
#   U=https://raw.githubusercontent.com/fosforoscienza/pico-multiview/main
#   /bin/bash -c "$(curl -fsSL $U/installa-mac.sh)"
#
# Fa tutto quello che la Guida spiega passo per passo:
#   1. installa Node.js (se manca o è troppo vecchio) dal sito ufficiale;
#   2. scarica il progetto in ~/Documents/pico-multiview (o lo aggiorna);
#   3. scarica i componenti: Electron, scrcpy-server, adb;
#   4. costruisce l'app e la mette in Applicazioni.
#
# Serve internet solo adesso: l'app che ne esce contiene già tutto e funziona
# anche su una wifi senza internet. Non serve git, né un account GitHub.
# Si può rilanciare quando si vuole: aggiorna e ricostruisce.
#
# Scritto per il bash 3.2 di macOS: niente costrutti dei bash più recenti.

REPO_ZIP="https://github.com/fosforoscienza/pico-multiview/archive/refs/heads/main.zip"
CARTELLA="$HOME/Documents/pico-multiview"
NOME_APP="Pico MultiView.app"

BOLD=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[31m'
GREEN=$'\033[32m'
RESET=$'\033[0m'

passo() { echo; echo "${BOLD}$1${RESET}"; }
nota() { echo "${DIM}$1${RESET}"; }
fallisci() {
  echo
  echo "${RED}$1${RESET}"
  echo "${DIM}La procedura a mano, passo per passo, è in Guida-Installazione-Mac.pdf${RESET}"
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fallisci "Questo script è per macOS."

# Dove finisce node installato dal pacchetto ufficiale, e dove lo mette Homebrew.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

echo "${BOLD}Installazione di Pico MultiView${RESET}"
nota "Ci vogliono 5-15 minuti, quasi tutti di download. Lascia aperta questa finestra."

# --------------------------------------------------------------------- Node.js
passo "1/4 · Node.js"

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 20 ]; then
  nota "Già installato: $(node -v)"
else
  # Node 24 vuole macOS 13.5 o più recente; sui Mac più vecchi va il 22.
  RAMO=$(sw_vers -productVersion | awk -F. '{ print ($1 > 13 || ($1 == 13 && $2 >= 5)) ? "v24" : "v22" }')
  BASE="https://nodejs.org/dist/latest-$RAMO.x"
  PKG=$(curl -fsSL "$BASE/SHASUMS256.txt" | awk '/\.pkg$/ { print $2 }')
  [ -n "$PKG" ] || fallisci "Non raggiungo nodejs.org. Controlla la connessione a internet e rilancia."

  TMP_PKG="$(mktemp -d)/node.pkg"
  nota "Scarico $PKG…"
  curl -fL --progress-bar -o "$TMP_PKG" "$BASE/$PKG" || fallisci "Download di Node.js non riuscito."

  echo "Ora serve la ${BOLD}password del Mac${RESET} (mentre la scrivi non si vede niente, è normale)."
  sudo installer -pkg "$TMP_PKG" -target / || fallisci "Installazione di Node.js non riuscita."
  rm -f "$TMP_PKG"
  hash -r
  command -v node >/dev/null 2>&1 || fallisci "Node.js risulta installato ma non lo trovo: chiudi il Terminale, riaprilo e rilancia."
  nota "Installato: $(node -v)"
fi

# -------------------------------------------------------------------- progetto
passo "2/4 · Il progetto, in $CARTELLA"

if [ -d "$CARTELLA/.git" ] && xcode-select -p >/dev/null 2>&1; then
  # Scaricato a suo tempo con git clone: si aggiorna con git.
  nota "Già presente (git): aggiorno."
  git -C "$CARTELLA" pull --ff-only || fallisci "git pull non riuscito: ci sono modifiche locali in $CARTELLA?"
else
  TMP_ZIP_DIR="$(mktemp -d)"
  curl -fL --progress-bar -o "$TMP_ZIP_DIR/progetto.zip" "$REPO_ZIP" || fallisci "Download del progetto non riuscito."
  unzip -q "$TMP_ZIP_DIR/progetto.zip" -d "$TMP_ZIP_DIR" || fallisci "Archivio del progetto rovinato: rilancia."
  mkdir -p "$CARTELLA"
  # Copia sopra quello che c'è: node_modules e vendor, se già scaricati, restano.
  ditto "$TMP_ZIP_DIR/pico-multiview-main" "$CARTELLA" || fallisci "Non riesco a scrivere in $CARTELLA."
  rm -rf "$TMP_ZIP_DIR"
  nota "Fatto."
fi

cd "$CARTELLA" || fallisci "Non riesco ad aprire $CARTELLA."

# ------------------------------------------------------------------ componenti
passo "3/4 · Componenti: Electron, scrcpy-server, adb"
nota "Scorre molto testo: è normale. Gli avvisi «npm warn» si possono ignorare."

npm install --no-fund --no-audit || fallisci "npm install non riuscito. Rilancia: riprende da dove si è fermato."
npm run deps:adb --silent || fallisci "Download di adb non riuscito. Rilancia."
[ -f vendor/scrcpy-server ] || fallisci "Manca vendor/scrcpy-server: il download da GitHub non è riuscito. Rilancia."
[ -x vendor/platform-tools/adb ] || fallisci "Manca vendor/platform-tools/adb. Rilancia."

# ------------------------------------------------------------------------ app
passo "4/4 · Costruisco l'app"

# electron-builder mette l'app in dist/mac-arm64 per i chip Apple, in dist/mac per Intel.
case "$(uname -m)" in
  arm64) ARCH=arm64; USCITA=dist/mac-arm64 ;;
  *) ARCH=x64; USCITA=dist/mac ;;
esac

# Solo la cartella .app, per questo Mac: molto più veloce dei due .dmg.
rm -rf "$USCITA"
./node_modules/.bin/electron-builder --mac dir "--$ARCH" --publish never || fallisci "Costruzione dell'app non riuscita."

APP="$USCITA/$NOME_APP"
[ -d "$APP" ] || fallisci "Non trovo l'app costruita in $USCITA."

DEST="/Applications"
if [ ! -w "$DEST" ]; then
  # Utente senza permessi di amministratore: la cartella Applicazioni personale.
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi
rm -rf "$DEST/$NOME_APP"
ditto "$APP" "$DEST/$NOME_APP" || fallisci "Non riesco a copiare l'app in $DEST."

echo
echo "${GREEN}${BOLD}Fatto.${RESET} Pico MultiView è in ${BOLD}$DEST${RESET}: aprila da lì o dal Launchpad."
nota "Contiene già adb e il componente video: da qui in poi funziona anche senza internet."
nota "Per i .dmg da passare ad altri Mac: cd \"$CARTELLA\" && npm run dist"
open -R "$DEST/$NOME_APP" 2>/dev/null || true
