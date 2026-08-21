# Pico MultiView

Regia da Mac per una flotta di **PICO 4**: dieci postazioni da riempire, l'anteprima grande del
visore selezionato su metà schermo e le miniature di tutti gli altri sull'altra metà, così non
perdi mai di vista la sala.

Nato per gli eventi: dieci visori in mano al pubblico, una persona che li governa da un
portatile senza toglierli dalla testa a nessuno.

![Anteprima e miniature](docs/screenshot.png)

## Come è fatta

**Schermata principale — le postazioni.** Dieci slot vuoti (puoi aggiungerne o toglierne).
Clicchi uno slot e scegli come riempirlo: cerca i visori in rete, prendi quello collegato via
USB, oppure inserisci l'IP a mano. Ogni postazione resta associata al suo visore anche dopo
aver chiuso l'app, così la disposizione dell'evento non si perde.

![Le dieci postazioni](docs/screenshot-postazioni.png)

**Clicchi un visore → si apre l'anteprima.** Lo schermo si divide: a sinistra il visore grande
e a più risoluzione, a destra le miniature di tutti gli altri, sempre vive. Ogni miniatura resta
cliccabile: passi da un visore all'altro con un clic.

**Visuale libera.** Nell'anteprima, tieni premuto il tasto sinistro e muovi il mouse per
spostarti dentro l'immagine del visore; la rotellina zooma. In questa modalità **non viene
inviato nessun tocco al visore**: puoi guardare in giro mentre il visitatore sta usando l'app,
senza disturbarlo.

**Il pulsante con la faccia** 🙂 riporta l'inquadratura esattamente su quello che sta guardando
chi indossa il visore. Si accende da solo quando ti sei spostato, così sai sempre se stai
guardando la visuale del visitatore o una tua. Scorciatoia da tastiera: `0`.

**Modalità Tocco.** Il segmento `Tocco` nella barra dell'anteprima trasforma il mouse in un dito:
clic e trascinamenti diventano tocchi veri sullo schermo del visore, la rotellina scorre, il
tasto destro fa "indietro". Si riparte sempre da `Visuale` quando cambi visore: durante un evento
non vuoi cliccare per sbaglio nel visore di un visitatore.

**Comandi di gruppo.** Avvia un'app, chiudi quella in primo piano, torna alla home, volume,
riavvio: su una selezione (le caselle sulle miniature) o su tutte le postazioni.

### Fin dove arriva la visuale libera — e dove no

Lo stream contiene **solo quello che il visore sta disegnando**, cioè il campo visivo di chi lo
indossa. La visuale libera si muove dentro quel fotogramma: siccome la cattura di un PICO 4 è
stereoscopica (i due occhi affiancati, 2:1), l'app mostra di default **l'occhio sinistro** — la
visuale del visitatore — e trascinando puoi arrivare fino all'altro occhio o zoomare sui
dettagli. Non puoi però girarti a guardare dietro le spalle del visitatore: quei pixel non
esistono nello stream.

Per un vero sguardo indipendente a 360° servirebbe una seconda telecamera **dentro** l'app VR
(un piccolo componente Unity/Unreal che pubblica una view di regia). Se l'esperienza dell'evento
è vostra, è la strada giusta: questa app è già pronta a mostrarne il flusso.

Nelle **app immersive** vale lo stesso discorso per il tocco: l'app ascolta i controller, non il
touchscreen, quindi il clic può non produrre nulla. Restano sempre validi i comandi di sistema
(Home, Indietro, Chiudi app attiva, avvio app, volume) e, in modalità Tocco, i tasti freccia +
Invio che diventano eventi DPAD. Sui **pannelli 2D** — home di PICO, menu di sistema, browser,
app 2D — il puntatore funziona invece molto bene.

---

## Scaricare e installare su Mac

### Cosa serve prima

1. **Node.js 20 o superiore.** Scaricalo da [nodejs.org](https://nodejs.org) (pulsante LTS) e
   installa il `.pkg`. Per verificare, apri **Terminale** (⌘+Spazio → "Terminale") e scrivi:
   ```bash
   node -v
   ```
   Deve rispondere qualcosa come `v22.x.x`.

2. **Git**, per scaricare il progetto. Sui Mac recenti c'è già; se scrivendo `git --version` il
   Mac ti propone di installare gli strumenti da riga di comando, accetta.

### Scaricare e avviare

Nel Terminale, una riga alla volta:

```bash
cd ~/Documents
git clone https://github.com/fosforoscienza/pico-multiview.git
cd pico-multiview
npm install          # installa tutto e scarica scrcpy-server (verificato con checksum)
npm run deps:adb     # scarica adb (salta se hai già le platform-tools di Android)
npm start            # avvia l'app
```

Le volte successive bastano le ultime due righe:

```bash
cd ~/Documents/pico-multiview
npm start
```

Per aggiornare all'ultima versione: `git pull` e poi di nuovo `npm install`.

### Creare una vera app da doppio clic (opzionale)

```bash
npm run dist
```

Trovi `Pico MultiView.dmg` nella cartella `dist/`: aprilo e trascina l'app in *Applicazioni*.
Da lì parte con un doppio clic, senza Terminale. L'app non è firmata con un certificato Apple:
essendo compilata da te sul tuo Mac, macOS la lascia partire senza problemi; se un domani la
copi su un altro Mac, la prima volta va aperta con tasto destro → *Apri*.

### Vuoi solo vedere com'è fatta, senza visori?

```bash
npm start -- --demo=10
```

Riempie le dieci postazioni con visori finti e un'immagine sintetica (stereoscopica, come quella
vera): utile per prendere confidenza con l'anteprima, la visuale libera e il pulsante faccia.

---

## Collegare i visori

La procedura completa, passo passo e con le schermate del visore, è in
**[docs/SETUP-PICO.md](docs/SETUP-PICO.md)**. Qui la versione breve.

### Una volta sola, per ogni visore

1. **Stessa rete.** Mac e visori sulla stessa wifi. Sul router disattiva l'*isolamento client*
   (*AP isolation*), altrimenti il Mac non vede i visori. Per gli eventi conviene una rete
   dedicata: la wifi degli ospiti è la causa numero uno dei problemi.

2. **Modalità sviluppatore sul visore.** Impostazioni → Generale → Informazioni sul dispositivo →
   tocca **Numero build** 7-8 volte. Poi Impostazioni → **Sviluppatore** → attiva **Debug USB**.

3. **Autorizza il Mac.** Collega il visore al Mac con un cavo USB-C **dati**. Nel visore compare
   *"Consenti debug USB da questo computer?"*: metti la spunta su **"Consenti sempre da questo
   computer"** e conferma. Senza quella spunta dovrai riautorizzare ogni volta.

4. **Passa al wifi.** Nell'app, clicca una postazione vuota → **Adotta quello collegato via USB**.
   L'app legge l'IP del visore, esegue `adb tcpip 5555` e si ricollega via rete. Il cavo si può
   staccare: il visore compare nella postazione.

   Per non dover rifare il giro col cavo dopo ogni riavvio del visore, rendilo permanente:
   ```bash
   adb -s <seriale> shell setprop persist.adb.tcp.port 5555
   ```

5. **Dai un nome alla postazione.** Icona ⚙︎ sulla miniatura → campo **Nome**: "Postazione 1",
   "Visore rosso"… e attacca un'etichetta fisica uguale sul visore. Quando qualcuno chiama,
   sapere *quale* riquadro guardare vale più di qualsiasi funzione software.

### Tutte le altre volte

Accendi i visori e apri l'app: le postazioni si ricollegano da sole. Se qualcuno manca, premi
**Cerca in rete** (o clicca la sua postazione → **Cerca in rete**).

### Prepara la libreria app

**Libreria…** nella barra comandi → **Rileva app installate**: l'app elenca i pacchetti presenti
sui visori (✓ = presente su tutti). Clicca quello dell'esperienza, dagli un nome leggibile e
salva. Da quel momento lo lanci ovunque con **Avvia**.

## Come si usa durante un evento

| Voglio… | Come |
|---|---|
| lanciare l'esperienza su tutti | nessuna selezione → scegli l'app → **Avvia** |
| lanciarla solo su alcuni | spunta le caselle delle postazioni → **Avvia** |
| vedere bene cosa fa una persona | clicca la sua miniatura → anteprima grande |
| guardarmi intorno nella sua visuale | trascina nell'anteprima, rotellina per zoomare |
| tornare a quello che vede lei | pulsante **Visuale visitatore** (o tasto `0`) |
| aiutarla a cliccare | segmento **Tocco** → clicca al posto suo |
| far uscire uno dall'app | **✕** sulla sua miniatura, o **Chiudi app attiva** nell'anteprima |
| rimettere tutti alla home | **Home** senza selezione |
| controllare le batterie | la percentuale su ogni miniatura (rossa sotto il 20%) |

Il pannello **Log** in basso mostra cosa è successo, visore per visore: è la prima cosa da
guardare quando qualcosa non va.

## Impostazioni per visore (icona ⚙︎)

- **Nome** — l'etichetta della postazione.
- **Modalità immagine**
  - `scrcpy` (predefinita): video fluido, 20 fps nelle miniature e 30 fps nell'anteprima.
  - `screencap`: istantanee PNG circa una al secondo. Rete di sicurezza se su un visore lo
    streaming non parte; in questa modalità i tocchi diventano `input tap` / `input swipe`.
- **Display** — se il firmware espone più display (per esempio quello usato per il cast), puoi
  scegliere quale specchiare: a volte dà un'immagine più pulita di quella VR.
- **Ritaglio** `L:A:X:Y` — per tagliare direttamente sul visore, prima della trasmissione.
  Esempio con sorgente 3840×1920: `1920:1920:0:0` manda solo l'occhio sinistro e dimezza la
  banda usata. (Se invece vuoi poter *esplorare* tutto il fotogramma, lascialo vuoto: ci pensa
  la visuale libera.)
- **Libera lo slot** toglie il visore dalla postazione ma lo lascia collegato;
  **Rimuovi visore** lo scollega del tutto.

Qualità, intervallo delle istantanee e altre preferenze stanno nel file di configurazione:
`~/Library/Application Support/pico-multiview/config.json`.

## Struttura del progetto

```
src/
  shared/protocol.js       codifica dei messaggi di controllo scrcpy (tocco, tasti, scroll)
  shared/stream-parser.js  parser del flusso video (header 12B + frame Annex-B)
  main/adb.js              wrapper adb, scoperta in rete, port forwarding
  main/scrcpy-session.js   push+avvio del server, socket video e di controllo
  main/device.js           un visore: stato, mirroring, puntatore, comandi
  main/device-manager.js   registro dei visori e operazioni di gruppo
  main/apps.js             pm/am/dumpsys: elenco app, avvio, chiusura, batteria
  main/demo.js             visori finti e immagine sintetica per --demo
  main/main.js             finestra Electron e ponte IPC
  renderer/viewport.js     telecamera virtuale: visuale libera, zoom, "visuale visitatore"
  renderer/decoder.js      decodifica H.264 con WebCodecs, disegno sul canvas
  renderer/pointer.js      mouse → spostamento visuale oppure tocchi sul visore
  renderer/app.js          postazioni, anteprima, comandi
test/                      test di protocollo, parser video e telecamera (npm test)
```

`npm test` non richiede visori: verifica byte per byte i messaggi di controllo, il parser del
flusso video e la matematica della visuale libera — le tre parti dove un errore si nota solo
sul campo.

## Problemi frequenti

**"adb non eseguibile"** → `npm run deps:adb`, oppure `brew install --cask android-platform-tools`.

**"Cerca in rete" non trova niente** → i visori devono essere accesi e *svegli*, sulla stessa
rete del Mac, e la rete non deve isolare i client. Se la tua rete non è una /24 standard puoi
indicare le sottoreti in `config.json` → `scan.subnets`.

**Un visore risulta `unauthorized`** → va riautorizzato via USB: la spunta "Consenti sempre" non
era stata messa, oppure il Mac è cambiato.

**Dopo un riavvio del visore non si collega più** → `adb tcpip` non sopravvive al riavvio.
Ricollegalo via USB e ripremi **Adotta USB**, oppure imposta `persist.adb.tcp.port` (sopra).

**L'immagine non parte su un solo visore** → prova la modalità `screencap` dalle impostazioni di
quel visore; se il log dice *"versione del server scrcpy incompatibile"*, allinea `SCRCPY_VERSION`
in `src/main/scrcpy-session.js` alla versione scaricata in `scripts/fetch-deps.mjs`.

**Video a scatti con 10 visori** → abbassa `quality.grid.maxSize` (es. 640) e `maxFps` (es. 12)
in `config.json`: dieci flussi video su una wifi affollata sono la parte più fragile del sistema.

## Limiti noti

- Servono i permessi di debug ADB su ogni visore: preparazione da fare una volta, ma va fatta.
- La visuale libera si muove dentro il fotogramma catturato, non oltre (vedi sopra).
- Il tocco non sostituisce i controller nelle app immersive.
- Niente audio: lo streaming è solo video, di proposito (serve banda per dieci flussi).
- Testato per dieci visori su una rete dedicata; su wifi molto affollate conviene una rete a parte.

## Licenze di terze parti

L'app scarica a parte, senza ridistribuirlo, `scrcpy-server` del progetto
[scrcpy](https://github.com/Genymobile/scrcpy) (Apache 2.0) e, se richiesto, le
platform-tools di Google.
