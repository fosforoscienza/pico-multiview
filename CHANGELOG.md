# Versioni

Il numero di versione si vede in fondo alla finestra dell'app e sulla copertina
della guida PDF.

**Come cambia:** il **primo** numero per le modifiche corpose (1.4 → 2.0), il
**secondo** per quelle piccole (1.4 → 1.5). Sta scritto in un punto solo,
`package.json`, da cui lo leggono sia l'app sia il generatore della guida.

---

## 2.1 — agosto 2026

Il registro mostrava il server morire con «Aborted» (SIGABRT) a ogni avvio, in un cerchio che si
autoalimentava. Tre cause, tutte corrette.

- **Un server rimasto da una sessione precedente teneva occupato lo schermo del visore**, e ogni
  server nuovo moriva sul nascere. Fermare il processo adb sul Mac non ferma quello remoto: ora
  prima di ogni avvio i server rimasti vengono chiusi **sul visore**.
- **Due connessioni potevano correre insieme** — il pulsante ⟳ durante la riconnessione
  automatica, un cambio di qualità nel mezzo — fermandosi la sessione a vicenda: nel registro si
  vedevano due conteggi di tentativi paralleli. Ora una alla volta.
- Dopo una morte violenta del server, il file sul visore viene **ricopiato** alla partenza
  successiva, nel dubbio che non sia più integro. E «Aborted» nel registro ora è spiegato in
  italiano.

## 2.0 — agosto 2026

**Video su tutti i visori insieme.** Nuovo pulsante *Video…* nella barra comandi: una barra di
ricerca che guarda nei file di tutti i visori collegati, e cliccando un filmato parte su tutti
quelli che ce l'hanno.

- L'elenco raggruppa per **nome del file**, non per percorso: lo stesso filmato può stare in
  `Movies` su un visore e in `Download` su un altro, e chi lo cerca lo cerca per nome. Accanto a
  ogni riga c'è su quanti visori si trova — è l'informazione che dice se mandarlo in riproduzione
  o se prima va copiato sugli altri.
- I comandi partono **insieme**, non uno dopo l'altro. È un avvio simultaneo, non una sincronia
  fotogramma per fotogramma: per quella servirebbe un'app dentro il visore.
- La ricerca si fa in `Movies`, `Download`, `DCIM`, `Video`, `Videos` e `Pictures`, non su tutta
  la memoria: su dieci visori pieni la differenza è fra qualche secondo e qualche minuto.

**Il telecomando da iPad era rotto, e l'ho rotto io nella 1.10.** Spostando una costante in un
modulo condiviso, l'interfaccia ha cominciato a importare un file fuori dalla cartella servita
sulla rete: dal browser non caricava più niente. Sul Mac non si vedeva, perché lì i file si
aprono dal disco. Ora il server serve anche i moduli condivisi, e quattro test coprono cosa è
raggiungibile dalla rete e cosa no.

**Anche i tasti finiscono nel registro.** Le frecce e Invio passavano da un `.catch(() => {})`,
lo stesso difetto già corretto per il puntatore: un tasto che non parte era indistinguibile da un
tasto che il visore ignora.

**Guida:** la modalità sviluppatore si attiva toccando **Versione software**, non *Numero build*.
Corretto in guida, README e SETUP-PICO, con la nota che su alcune versioni di PICO OS la riga ha
l'altro nome.

## 1.11 — agosto 2026

- **«Socket video chiuso dal dispositivo», ogni quindici secondi.** Il server viene copiato sul
  visore in `/data/local/tmp` e caricato da un processo che resta in esecuzione. Lo ricopiavamo
  **a ogni riavvio della sessione** — e ce ne sono molti: cambio di qualità, riconnessione,
  ritaglio — riscrivendo il file sotto il processo che lo stava usando. Ora la copia si fa una
  volta per visore. Il sintomo non puntava affatto alla causa, ed è per questo che è rimasto
  in mezzo ai piedi mentre cercavamo il tocco.

## 1.10 — agosto 2026

Correzioni trovate leggendo il registro di una diagnostica vera su un Pico Neo 3.

- **Le prove sugli altri schermi non toccavano niente, per colpa mia.** Mandavano le coordinate
  dello schermo stereo (`3240,1080` su 4320×2160) anche a pannelli molto più piccoli, dove
  cadono fuori. Ora ogni schermo riceve il punto calcolato **sulla sua misura**, e la misura di
  ciascuno finisce nel registro. Il visore ne dichiara dieci: senza questa correzione nove prove
  su quattordici erano sprecate.
- **La diagnostica riprova sull'ultimo punto cliccato**, non al centro dell'inquadratura. Con la
  visuale spostata sull'altro occhio provava nell'occhio destro — cioè da tutt'altra parte
  rispetto a quello che l'operatore stava cercando di premere.
- **Un indirizzo salvato che non risponde più** (tipico dopo un cambio di rete) veniva ritentato
  a ogni aggiornamento, riempiendo il registro di errori identici. Ora lo dice una volta, con
  cosa fare.

## 1.9 — agosto 2026

- **«Diagnostica»**, accanto a *Modo PICO*. Tocca il centro dell'anteprima provando **tutte** le
  strade possibili — touchscreen, trackball, touchpad, touchnavigation, mouse, e ogni altro
  schermo del visore — una ogni due secondi, scrivendo nel registro cosa sta per mandare
  **prima** di mandarlo. Si guarda il visore e si vede a quale prova reagisce, invece di
  indovinare quale periferica finta accetta questo modello.
- Il registro riporta anche la misura dello schermo, il ritaglio e l'elenco degli schermi visti
  dal visore: sono i numeri con cui si verifica che il tocco stia andando dove deve.

## 1.8 — agosto 2026

Il registro serve a capire perché una cosa non funziona: doveva essere leggibile, copiabile e
soprattutto **completo**.

- **Copia** e **Svuota** nel pannello Log. Svuotare, fare la prova, copiare: si ottengono le
  righe di quel gesto e basta, senza doverle pescare a mano da un pannello che scorre.
- **Ogni clic lascia una traccia**, anche quando parte per la via normale: dove è stato premuto,
  su che misura, e con quale strada. Prima l'unico caso che scriveva qualcosa era il Modo PICO.
- **Anche il clic che non parte.** Se il visore non è nel registro, il clic spariva senza dire
  niente — indistinguibile, da fuori, da un clic che non funziona. Ora lo dice.

## 1.7 — agosto 2026

- **«Modo PICO»**, nuovo pulsante accanto a *Tocco*. Un visore PICO **non ha un touchscreen**, e
  scarta gli eventi di tocco che dicono di venirne: è il motivo per cui Home, Indietro e volume
  funzionavano — sono tasti, li gestisce il sistema — mentre il clic sullo schermo no. Acceso, il
  tocco viene inviato dichiarandolo di un'altra periferica, che i PICO accettano.
- Le coordinate vengono convertite in pixel veri dello schermo: il canale normale lo fa da sé,
  questa strada no, e con l'immagine rimpicciolita e ritagliata a un occhio il clic sarebbe
  finito da un'altra parte. Sette test sulla conversione.
- **Gli errori del puntatore non vengono più ingoiati.** Il codice li scartava in silenzio
  (`.catch(() => {})`): è il motivo per cui questo guasto è rimasto invisibile così a lungo. Ora
  finiscono nel Log, insieme al comando esatto che è stato inviato al visore.

## 1.6 — agosto 2026

- **«Un occhio»**, nuovo pulsante in alto. Un visore disegna due immagini
  affiancate, una per occhio, e guardarle insieme non serve a niente. Ora si può chiedere ai
  visori la sola metà sinistra: si vede quello che vede il visitatore, **anche nelle
  miniature**, e sulla wifi viaggia **metà dei dati** — con dieci visori è la differenza fra
  scorrevole e a scatti. Il ritaglio lo fa il visore, non la finestra, quindi i clic
  continuano ad arrivare nel punto giusto: è scrcpy stesso a riportare le coordinate dentro
  la porzione ritagliata. Resta memorizzato per ogni visore.
- **Il clic in modalità Visuale non spariva più in silenzio.** In quella modalità nessun
  tocco viene inviato al visore — è la modalità sicura, e si riparte sempre da lì — ma senza
  nessun segnale sembrava che il programma fosse rotto. Ora un avviso lo dice, e si toglie da
  solo o appena si passa a Tocco.
- Se il visore rifiuta un tocco, scrcpy lo scrive in inglese in mezzo al resto: ora nel Log
  compare la spiegazione in italiano, con cosa fare, e il messaggio originale in coda.
- **`npm run versione 1.7`** cambia il numero in tutti i punti che lo contengono. È il
  passaggio manuale che aveva già bloccato un `git pull`.

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

- **`git pull` si rifiutava di aggiornare**, dicendo che sovrascriverebbe `package-lock.json`.
  Colpa di un dettaglio trascurato a ogni cambio di versione: il numero stava in
  `package.json` ma non nel lock, così `npm install` riscriveva quest'ultimo per allinearlo e
  chi aggiornava si ritrovava modificato un file che non aveva toccato. Ora i due numeri sono
  allineati, e un test controlla che restino tali.

Nove test nuovi. Quello sul flusso video usa un socket vero, non finto: è il comportamento di
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
