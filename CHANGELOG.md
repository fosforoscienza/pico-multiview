# Versioni

Il numero di versione si vede in fondo alla finestra dell'app e sulla copertina
della guida PDF.

**Come cambia:** il **primo** numero per le modifiche corpose (1.4 → 2.0), il
**secondo** per quelle piccole (1.4 → 1.5). Sta scritto in un punto solo,
`package.json`, da cui lo leggono sia l'app sia il generatore della guida.

---

## 2.14 — agosto 2026

- **La modalità di proiezione si sceglie prima di avviare** — «3D 360° sopra-sotto», 360°, 180°,
  2D — dal menù nella finestra Video. Con la modalità scelta si parla direttamente al lettore
  PICO (`picovr.intent.action.player`, `videoType`): il filmato parte **già** nella proiezione
  giusta, invece di cominciare «al cinema» su uno schermo piatto e correggersi da solo dopo
  qualche secondo. Action e codici vengono dal codice pubblicato da PICO, non da tentativi. Su
  «Riconosci da solo» tutto resta com'era, e un visore che non capisce la chiamata PICO scala
  sui tentativi soliti.
- **«Dall'inizio» è di nuovo il default, sempre.** Il collegamento della spunta era sparito in
  una pulizia: la casella mostrava il segno ma non parlava più con nessuno, e la configurazione
  conservava un vecchio «no» invisibile — per questo la conferma diceva «da dove era rimasto».
  Ora la spunta è viva, e a ogni avvio dell'app torna accesa: spegnerla vale per la sessione, non
  per sempre.

## 2.13 — agosto 2026

«Riparte sempre dallo stesso punto»: il sintomo diceva tutto.

- **Il «riprendi da dove eri» sta su disco**, e chiudere il lettore non lo tocca — anzi lo
  **congela**: l'app chiusa non salva più niente, e riparte per sempre da quel punto. Ora, prima
  di lanciare, la memoria del lettore viene **azzerata** (`pm clear`): riparte come appena
  installato, quindi dall'inizio. Si azzera solo chi riproduce — il lettore visto in azione e
  quello a cui il visore affiderebbe il filmato — mai la schermata iniziale, mai il sistema, e
  nemmeno ogni app che sappia genericamente aprire video. Il registro dice chi è stato azzerato.
- **Il lettore visto in azione viene salvato nella configurazione**: al riavvio dell'app vale già
  dal primo lancio, che altrimenti sarebbe l'unico a ripartire da metà.
- Vale anche per **Da capo**, che rifà la stessa strada.
- Con la spunta **dall'inizio** spenta non si azzera e non si chiude niente, come prima.

## 2.12 — agosto 2026

- **VLC è stato tolto**: sui visori non funzionava, e un'alternativa che non funziona è solo un
  menù in più da sbagliare. Si torna al solo lettore del visore.
- **Prima di lanciare si chiudono TUTTE le app di riproduzione video**, non una indovinata:
  l'elenco lo dà il visore stesso. Sul visore chi apre il filmato e chi lo riproduce possono
  essere app diverse — il gestore file delega al lettore — e chiudere solo la prima lasciava la
  seconda viva, con il suo «riprendi da dove eri» intatto. Era questo a far ripartire i filmati
  da metà. Le chiusure viaggiano in un comando solo, e la schermata iniziale non è mai
  nell'elenco.

## 2.11 — agosto 2026

Un passo indietro dove serviva, e le difese perché non succeda più.

- **L'avvio riparte dal comando che ha sempre funzionato.** Dalla 2.8 il filmato veniva lanciato
  con dei flag che rifanno la schermata da capo: aiutano a ripartire dall'inizio, ma su certi
  lettori impediscono l'avvio — e un filmato che parte da metà vale infinitamente più di uno che
  non parte. Ora il comando nudo è il **primo** tentativo, sempre.
- **Ogni tentativo viene verificato.** Dopo il comando, l'app guarda se il visore ha davvero
  aperto qualcosa. Se no, prova a chiamare il lettore **per nome** — che è ciò che serve subito
  dopo averlo chiuso, perché un'app appena fermata può restare fuori dalla scelta automatica di
  Android — e solo per ultimo prova i flag. Se non apre niente in nessun modo, lo dice elencando
  cosa ha provato.
- **La conferma finiva dietro la finestra da cui l'avevi chiesta**, quindi bisognava chiudere
  quella per poterla approvare. Ora sta sopra a tutto.
- **Interruttore «dall'inizio»** nella barra: spegnendolo l'avvio è esattamente quello che
  funzionava prima di tutte queste aggiunte — nessun lettore chiuso, nessun flag. Il filmato
  riparte da dov'era, ma parte.

## 2.10 — agosto 2026

«Il video non parte più»: due difetti introdotti dalle due versioni precedenti, e la ragione per
cui nessuno dei due si vedeva.

- **Un avvio fallito passava per riuscito.** `am start` esce **sempre** con successo, anche
  quando scrive «Error: …» e non apre niente: l'app credeva di aver avviato il filmato, e non
  diceva nulla. Ora l'esito viene letto, e un avvio che non ha aperto niente è un errore col suo
  motivo. È il difetto che rendeva invisibili gli altri due.
- **La conferma non era un modale dell'app ma il dialogo del browser**, che dentro Electron può
  non comparire: e un dialogo che non compare vale come un «no» che nessuno ha detto — il filmato
  non parte e non lascia traccia. Ora è un modale come gli altri, con Invio e Esc.
- **VLC scelto ma non installato** faceva un comando che non apriva niente, in silenzio. Ora lo
  dice prima, e dice anche come tornare indietro.
- **Se un lettore rifiuta il riavvio pulito**, il filmato parte lo stesso col comando semplice:
  davanti al pubblico la differenza fra «parte da metà» e «non parte» è tutta. Il ripiego viene
  scritto nel registro, non nascosto.
- **La schermata iniziale non può più essere scambiata per un lettore.** Il pacchetto in primo
  piano viene ricordato solo se sa davvero aprire filmati: un visore su cui l'app chiude il
  proprio launcher è messo peggio di prima.

## 2.9 — agosto 2026

**VLC come lettore dei visori**, in alternativa a quello di sistema.

Il lettore del visore, da fuori, è cieco e sordo: non pubblica a che punto è e non riceve i tasti
media. VLC fa entrambe le cose, e in più accetta **la posizione dentro il comando di avvio**.

- **La timeline funziona davvero**: VLC apre una sessione multimediale, quindi la barra sa dove si
  trova il filmato e la pausa lo ferma.
- **Il salto diventa un punto, non un inseguimento.** Col lettore di sistema si danno colpi di
  avanti e indietro finché non si arriva «lì attorno»; con VLC si riapre il filmato al
  millisecondo voluto, uguale su tutti i visori.
- **«Dall'inizio» smette di dipendere da chi chiude cosa**: con VLC non si chiude niente e non si
  chiede niente al sistema — `from_start` sta nel comando.
- **Installazione dai visori**: si sceglie l'apk scaricato da videolan.org e si installa su tutti
  in un colpo. Il pulsante compare solo dove VLC manca. L'app non scarica apk da internet per
  conto suo: è software che finisce dentro i visori, e chi ce lo mette dev'essere una persona.
- **Si torna indietro dallo stesso menù**: «Lettore del visore» e tutto è com'era.

## 2.8 — agosto 2026

Tre difetti della barra del filmato, tutti trovati usandola davvero.

- **«Dall'inizio» non ripartiva dall'inizio.** Per chiudere il lettore prima di lanciare bisogna
  sapere quale sia, e lo si chiedeva al visore **senza dirgli quale file**: così la domanda
  tornava a mani vuote, nessuno veniva chiuso, e il lettore riprendeva da dov'era. Ora il file si
  passa, il lettore che si è aperto davvero viene ricordato per la volta dopo, e la schermata
  viene rifatta da capo (`--activity-clear-task`) invece di essere riusata.
- **I tasti del lettore ora si scelgono, e si provano.** I tasti «media» sono gli unici standard
  di Android e su molti visori non fanno niente: il sistema li consegna alla sessione
  multimediale, e un lettore che non ne apre una non li riceve mai. Nella barra c'è un menù —
  tasti media, OK/Invio, centro del pad, barra spaziatrice — con un pulsante **Prova**: si manda
  il tasto e si guarda il visore. La scelta resta, e vale anche per il salto (col pad, avanti e
  indietro sono le frecce).
- **Un clic su un filmato non lo lancia più in sala.** Ora chiede conferma, dicendo su quanti
  visori sta per partire: la riga dell'elenco serve a scegliere, la conferma a lanciare.

## 2.7 — agosto 2026

- **La barra del filmato c'è sempre**, finché c'è un visore in postazione. Prima compariva solo
  quando qualcuno rispondeva: una riga che a volte c'è e a volte no, per chi guarda, è un guasto
  — non una scelta di stile. Ora quando manca qualcosa lo scrive: «nessun filmato in corso»,
  «durata sconosciuta», «il lettore non dice a che punto è».
- **Pausa e «Da capo» restano attivi anche con un lettore che non pubblica il suo stato**: sono
  tasti da mandare, non domande da fare. È il salto che, senza posizione, non ha un bersaglio —
  e infatti è quello che si spegne.

## 2.6 — agosto 2026

I filmati si comandano dal computer: si vede a che punto sono, si fermano insieme, si spostano
tutti sullo stesso punto.

- **La barra del filmato** compare quando un filmato è in corso: il punto dei visori, la durata,
  e sotto ogni miniatura il punto di quel visore. Fra una lettura e l'altra scorre da sola —
  chiedere al visore due volte al secondo, per dieci visori, sarebbe un martellamento.
- **Pausa a tutti / Riprendi tutti.** Il tasto unico «play-pausa» di Android è un interruttore:
  mandato a dieci visori di cui uno era già fermo, li lascia metà in moto e metà fermi. Qui si
  mandano due tasti distinti, così il comando è un'istruzione e i visori restano allineati.
- **Un clic sulla barra porta tutti in quel punto.** Da fuori non esiste un «vai al minuto due»:
  l'app dà un colpo di avanti, misura quanto è valso su quel lettore, fa il conto dei colpi che
  mancano e verifica. Arriva entro un paio di secondi dal punto chiesto — e se il lettore ai
  tasti non risponde, lo dice invece di far finta.
- **La fascia rossa** sulla barra è la distanza fra il visore più avanti e quello più indietro:
  è il dato che altrimenti si scopre solo in sala, guardandoli.
- **Un filmato mandato da qui riparte sempre dall'inizio**: il lettore viene chiuso prima di
  lanciarlo, e dopo l'avvio l'app **controlla** di essere davvero all'inizio — se il lettore era
  ripartito da metà, lo riporta indietro e lo scrive nel registro.
- **Se il lettore del visore non pubblica il proprio stato**, il registro lo dice una volta: la
  barra non può seguirlo, ed è un limite di quel lettore, non un guasto da cercare.

## 2.5 — agosto 2026

Una difesa in più sulla ricerca dei video, per il caso che la 2.3 non copriva.

- **Si guardano anche le memorie separate montate sotto `/storage`** — una microSD, una
  chiavetta: sono altri posti, non altri nomi della memoria interna, e un filmato copiato lì
  restava invisibile. La memoria interna resta guardata una volta sola: `emulated`, `self` e
  `primary` sotto `/storage` sono lei, e ripassarci vorrebbe dire elencare ogni filmato due
  volte.
- Il registro elenca **tutte** le memorie in cui ha cercato, non solo la prima.

## 2.4 — agosto 2026

«Non si connette, né via cavo né via wifi»: il registro mostrava solo tentativi verso indirizzi
di una rete abbandonata. Erano quelli a impedire tutto il resto.

- **Un indirizzo salvato che non risponde non interrompe più l'aggiornamento.** `adb connect`
  usciva con errore, l'errore risaliva fino a interrompere il giro a metà, e i visori che adb
  già vedeva — quelli **attaccati al cavo** — non arrivavano mai a essere messi in elenco. Ora
  il cavo viene servito per primo, e la rete dopo.
- **Gli indirizzi salvati si provano tutti insieme, e si bussa alla porta prima di chiamare
  adb**: un indirizzo morto costa una frazione di secondo invece di otto, e due indirizzi morti
  non fanno più quindici secondi di attesa a ogni aggiornamento.
- **Chi non risponde viene ritentato con calma** — mezzo minuto, poi uno, fino a cinque — e
  **subito** se cambia la rete del computer: è il momento in cui gli indirizzi salvati possono
  tornare buoni.
- **Un cavo attaccato ma inutile ora lo dice.** Un visore che adb vede «unauthorized» oppure
  «offline» non produceva nessuna riga: elenco vuoto e cavo in mano, senza sapere che il visore
  era lì e cosa gli mancasse. Ora il registro dice cosa fare.
- Il messaggio sull'indirizzo perduto dice anche **su quale rete si trova ora il computer**: è
  il dato che spiega in un colpo perché quel `192.168.1.x` non risponde più.

## 2.3 — agosto 2026

«Il video lo vedo nel visore, ma dal computer non lo trova»: la ricerca guardava nel posto
giusto e non ci entrava.

- **La ricerca ora attraversa la radice della memoria.** `/sdcard` non è una cartella: è un
  collegamento a `/storage/self/primary`, e `find` non attraversa i collegamenti se non glielo
  si chiede. Guardava quindi il solo collegamento — che non è un filmato — e finiva senza
  risultati **e senza errori**: «0 file trovati» su un visore pieno di video. Ora il
  collegamento viene seguito, e se `/sdcard` mancasse si provano gli altri due nomi della
  stessa memoria.
- **Il registro dice anche dove ha cercato**, non solo quanti file ha trovato: «0 file trovati
  in /sdcard» si legge, «0 file trovati» lascia il dubbio fra un visore vuoto e una ricerca
  cieca — ed era proprio quel dubbio a nascondere questo difetto.
- **Gli spazi nel nome non troncano più il filmato da riprodurre**: «Tra Borghi e Natura.mp4»
  arrivava al lettore come «Tra». Lo stesso valeva per `#` e `?`.

## 2.2 — agosto 2026

«Non trova il file nel visore»: due difetti nella ricerca dei video, uno dei quali la rendeva
anche muta.

- **La ricerca ora guarda in tutta la memoria condivisa**, non in sei cartelle indovinate: i
  filmati stavano altrove, e l'elenco usciva vuoto. L'unica cartella esclusa è `Android` — i
  dati privati delle app, decine di migliaia di file dove un filmato non sta comunque.
- **Una ricerca fallita non si traveste più da «nessun filmato trovato»**: sono due risposte
  diverse. Ogni visore ora scrive nel registro quanti file ha trovato, o perché ha fallito.
- Il tipo `video/*` nel comando di avvio va tra virgolette: nudo, la shell del visore lo
  trattava come un glob da espandere.

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
