# Versioni

Il numero di versione si vede in fondo alla finestra dell'app e sulla copertina
della guida PDF.

**Come cambia:** il **primo** numero per le modifiche corpose (1.4 → 2.0), il
**secondo** per quelle piccole (1.4 → 1.5). Sta scritto in un punto solo,
`package.json`, da cui lo leggono sia l'app sia il generatore della guida.

---

## 1.5 — agosto 2026

I due difetti visti al primo collegamento con un visore vero.

- **L'anteprima restava per sempre su «In attesa dell'immagine…»**, pur dicendo «in
  streaming». Il socket video viene messo in pausa durante l'handshake, per non perdere i byte
  arrivati insieme al *dummy byte* di scrcpy; poi gli si attaccava il lettore — ma su uno
  stream messo in pausa di proposito **attaccare un listener non lo rimette in moto**. Mancava
  `resume()`, e non arrivava un solo fotogramma. Il collegamento riusciva in tutto il resto, ed
  è per questo che l'app si diceva pronta.
- **Un visore occupava due postazioni.** Lo stesso visore si presenta ad adb con due nomi — il
  seriale del cavo e `indirizzo:porta` sul wifi — e «Adotta USB» aggiungeva il secondo senza
  togliere il primo. Ora i due nomi vengono riconosciuti come la stessa macchina, confrontando
  `ro.serialno`, e vince quello wifi: è l'unico che continua a funzionare staccando il cavo.
  Vale anche riaprendo il programma con il cavo ancora attaccato.

Otto test nuovi. Quello sul flusso video usa un socket vero, non finto: è il comportamento di
Node sugli stream in pausa a essere in gioco, e un finto lo mancherebbe.

## 1.4 — agosto 2026

- **«L'app è danneggiata e non può essere aperta».** Non lo era: il pacchetto usciva dalla
  costruzione **senza nessuna firma**, e i Mac con chip Apple rifiutano un'app non firmata
  con quelle parole, senza dare la via d'uscita del tasto destro. Ora l'app esce **firmata
  in modo ad-hoc**, e con il *runtime irrobustito* spento — acceso, insieme a una firma
  ad-hoc, impedirebbe a Electron di caricare i propri framework e l'app si aprirebbe solo
  per chiudersi. Due test tengono ferme entrambe le impostazioni.
- La firma ad-hoc rende l'app eseguibile, non ne certifica l'autore: resta la quarantena, che
  si toglie una volta sola con `xattr -dr com.apple.quarantine "/Applications/Pico Multiview.app"`.
  Il comando ora è nelle note della release, nel README e nella guida (Parte 2 e tabella dei
  problemi), con le alternative e la nota che solo un certificato Apple (99 $/anno) toglie
  l'avviso del tutto.
- La catena di montaggio ora tiene **una sola costruzione alla volta**. I Mac di GitHub sono
  pochi e contesi: due esecuzioni identiche in coda si rubavano il posto a vicenda per
  produrre lo stesso file.
- **Costruire il `.dmg` sul proprio Mac è ora la strada principale**, in README e guida; GitHub
  Actions è l'alternativa. Motivo: quando la quota mensile di Actions finisce, GitHub non lo
  dice — accoda le esecuzioni per ore senza mai assegnare loro una macchina, e non si riescono
  nemmeno ad annullare, perché non esiste ancora un job a cui mandare il segnale. Il segno per
  riconoscerlo (un'esecuzione «Queued» con **nessun job**) e dove guardare sono ora scritti fra
  i problemi frequenti. `npm run dist` fa la stessa cosa in due minuti, senza quota.

## 1.3 — agosto 2026

Tre difetti trovati leggendo il log della prima build vera.

- **La build falliva alla fine**, dopo aver costruito correttamente i due
  `.dmg`: in CI electron-builder cerca di pubblicare la release da solo e si
  ferma perché non ha un token. Ora la costruzione usa `--publish never` e la
  release resta compito del passo che la pubblica con `gh`.
- **L'app nel `.dmg` aveva l'icona generica di Electron**: mancava
  `mac.icon`. Ora `npm run icona` genera anche `assets/icona/pico-multiview.icns`
  e il pacchetto usa quella, cioè il visore VR.
- **L'archivio per Intel non aveva l'architettura nel nome**, quindi era
  impossibile capire quale dei due scaricare. Ora si chiamano
  `…-arm64.dmg` e `…-x64.dmg`.

## 1.2 — agosto 2026

- **App pronta da scaricare.** Una catena di montaggio su GitHub (*Actions →
  Costruisci l'app per Mac*) costruisce il `.dmg` e lo pubblica nelle Releases,
  con dentro anche `adb` e la guida PDF: chi lo riceve non installa più niente.
- **Corretto un difetto che avrebbe reso il `.dmg` inservibile:** nel pacchetto
  i file finiscono dentro `app.asar`, un archivio da cui un binario non si può
  eseguire e da cui `adb push` non può leggere il server scrcpy. Ora `vendor/`
  viene estratto (`asarUnpack`) e i percorsi puntano alla copia vera su disco.
- Nella guida, un riquadro a inizio installazione: chi riceve il `.dmg` salta
  tutta la parte del Terminale.

## 1.1 — agosto 2026

- Spiegato, nel README e nella guida, perché l'installazione può sembrare
  infinita: il progetto pesa 5 MB, ma `npm install` scarica Electron (221 MB)
  dalle release di GitHub, che alcune reti strozzano. Con le tre vie d'uscita:
  usare il Telecomando dal browser senza installare niente, copiare il `.dmg`
  già costruito, o cambiare rete/mirror.

## 1.0 — agosto 2026

Prima versione completa, in uso.

**Regia dei visori**

- Dieci postazioni da riempire (scansione della rete, adozione via USB, IP
  manuale). La disposizione resta salvata fra un avvio e l'altro.
- Anteprima affiancata: a sinistra il visore scelto, grande e a più risoluzione;
  a destra le miniature di tutti gli altri, sempre vive.
- Visuale libera dentro l'immagine del visore, con zoom, e pulsante "visuale
  visitatore" per tornare su quello che sta guardando chi indossa il visore.
- Modalità Tocco: il mouse diventa un dito sullo schermo del visore. Si riparte
  sempre dalla modalità sicura quando si cambia visore.
- Comandi di gruppo: avvio e chiusura app, home, volume, riavvio, su una
  selezione o su tutte le postazioni.
- Riconnessione automatica, batteria e app in primo piano per ogni visore.

**Telecomando**

- Il Mac serve la stessa interfaccia sulla wifi, protetta da PIN: da iPad,
  iPhone o da un altro computer, con i gesti al posto del mouse.

**Contorno**

- Avvio con doppio clic (`Pico Multiview`, icona del visore VR).
- Guida illustrata di sedici pagine per chi parte da zero.
- Crediti Brown Enterprises nell'app e nella guida.
