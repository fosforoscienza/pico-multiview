#!/bin/bash
# Doppio clic su questo file per avviare Pico MultiView, senza scrivere comandi.
#
# macOS apre i file .command nel Terminale: la finestra nera che vedi comparire
# serve a tenere acceso il programma, va lasciata aperta e si chiude da sola
# quando chiudi Pico MultiView.

cd "$(dirname "$0")" || exit 1

# Aperto dal Finder, il Terminale non carica sempre le stesse cartelle di una
# sessione normale: aggiungiamo in coda i posti dove finisce node. In coda e non
# in testa, così se hai già un node tuo (nvm, Homebrew) resta quello a comandare.
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

BOLD=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[31m'
GREEN=$'\033[32m'
RESET=$'\033[0m'

clear
echo "${BOLD}Pico MultiView${RESET}"
echo "${DIM}$(pwd)${RESET}"
echo

# Aspetta un tasto e chiude: serve a non far sparire i messaggi d'errore.
fine_con_errore() {
  echo
  echo "${RED}$1${RESET}"
  echo
  echo "${DIM}Premi un tasto qualsiasi per chiudere questa finestra.${RESET}"
  read -r -n 1 -s
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  fine_con_errore "Node.js non è installato.
Scaricalo da https://nodejs.org (il pulsante grande LTS), installalo,
poi riprova con un doppio clic su questo file.
La procedura completa è nella Parte 2 della guida (docs/Guida-Pico-MultiView.pdf)."
fi

if ! command -v npm >/dev/null 2>&1; then
  fine_con_errore "npm non è disponibile: reinstalla Node.js da https://nodejs.org."
fi

# Prima volta (o dopo un aggiornamento): installa quello che manca.
if [ ! -d node_modules ]; then
  echo "${BOLD}Prima volta: sto installando i componenti necessari.${RESET}"
  echo "${DIM}Ci vogliono alcuni minuti. Vedrai scorrere molto testo: è normale.${RESET}"
  echo
  npm install || fine_con_errore "Installazione non riuscita. Controlla di essere connesso a internet."
  echo
fi

if [ ! -f vendor/scrcpy-server ]; then
  echo "${DIM}Scarico il componente per lo streaming dei visori…${RESET}"
  npm run deps --silent || fine_con_errore "Download non riuscito. Controlla la connessione a internet."
  echo
fi

if ! command -v adb >/dev/null 2>&1 && [ ! -x vendor/platform-tools/adb ]; then
  echo "${DIM}Scarico adb, lo strumento che parla con i visori…${RESET}"
  if ! npm run deps:adb --silent; then
    # Non è un motivo per fermarsi: il programma parte lo stesso e dice a schermo
    # che adb manca, così si può installare con calma.
    echo "${RED}Non sono riuscito a scaricare adb.${RESET}"
    echo "${DIM}Il programma parte lo stesso, ma non vedrà i visori finché adb non c'è.${RESET}"
  fi
  echo
fi

echo "${GREEN}Avvio in corso…${RESET} ${DIM}(lascia aperta questa finestra)${RESET}"
echo

npm start --silent
CODICE=$?

if [ $CODICE -ne 0 ] && [ $CODICE -ne 130 ]; then
  fine_con_errore "Il programma si è chiuso con un errore (codice $CODICE).
Guarda i messaggi qui sopra: di solito dicono cosa è mancato."
fi

echo
echo "${DIM}Pico MultiView è stato chiuso. Puoi chiudere questa finestra.${RESET}"
