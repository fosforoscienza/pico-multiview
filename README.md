# Pico MultiView

Regia da Mac per una flotta di **PICO 4**: un mosaico con lo schermo di tutti i visori,
avvio e chiusura delle app su uno o su tutti insieme, e il mouse che fa da puntatore
dentro il visore selezionato.

Nato per gli eventi: dieci visori in mano al pubblico, una persona che li governa da un
portatile senza toglierli dalla testa a nessuno.

![Mosaico dei visori](docs/screenshot.png)

## Cosa fa

- **Mosaico live** di tutti i visori collegati alla stessa rete wifi (video H.264 accelerato dalla GPU).
- **Comandi singoli o di gruppo**: avvia un'app, chiudi quella in primo piano, torna alla home,
  alza/abbassa il volume, riavvia. Senza selezione i comandi valgono per tutti.
- **Puntatore mouse**: clic, trascinamento e rotellina vengono iniettati nel visore come
  eventi di tocco. Il puntatore è **disarmato** finché non lo accendi (interruttore in alto a destra):
  durante un evento non vuoi cliccare per sbaglio nel visore di un visitatore.
- **Focus**: un visore a schermo intero e a qualità più alta, con i tasti freccia/Invio/Esc.
- **Libreria app** condivisa: definisci una volta le app dell'evento e le lanci ovunque con un clic.
- **Riconnessione automatica** con backoff quando un visore esce e rientra dalla rete.

## Requisiti

- macOS (funziona anche su Linux/Windows, ma è pensato e impacchettato per il Mac)
- [Node.js](https://nodejs.org) 20 o superiore
- `adb` (platform-tools di Android) — se non ce l'hai lo scarica lo script (vedi sotto)
- Mac e visori **sulla stessa rete wifi**, possibilmente con isolamento client disattivato sul router

## Installazione

```bash
git clone <questo-repo>
cd pico-multiview
npm install          # scarica anche scrcpy-server (verificato con checksum)
npm run deps:adb     # solo se "adb" non è già installato sul Mac
npm start
```

Vuoi solo vedere com'è fatta l'interfaccia, senza visori?

```bash
npm start -- --demo=10
```

## Preparare i visori (una volta sola)

La procedura completa, passo passo, è in **[docs/SETUP-PICO.md](docs/SETUP-PICO.md)**.
In breve, per ogni PICO 4:

1. attiva la modalità sviluppatore e il debug USB;
2. collegalo al Mac via USB e accetta la richiesta *"Consenti debug USB"* mettendo la spunta
   su *"Consenti sempre da questo computer"*;
3. nell'app premi **Adotta USB**: legge l'IP del visore, attiva `adb tcpip 5555` e si ricollega
   via rete. Da quel momento il cavo non serve più.

Dalla seconda volta in poi basta accendere i visori e premere **Cerca in rete** (oppure lasciar
fare all'avvio: i visori già noti vengono ricollegati da soli).

## Come si usa durante un evento

| Voglio… | Come |
|---|---|
| lanciare l'esperienza su tutti | nessuna selezione → scegli l'app → **Avvia** |
| lanciarla solo su alcuni | spunta le caselle dei visori → **Avvia** |
| far uscire uno dall'app | il tasto **✕** nel riquadro di quel visore |
| rimettere tutti alla home | **Home** senza selezione |
| aiutare una persona in difficoltà | **⤢** sul suo riquadro → arma il **Puntatore** → clicca al posto suo |
| controllare le batterie | la percentuale in alto a destra di ogni riquadro (rossa sotto il 20%) |

Il pannello **Log** in basso mostra cosa è successo, visore per visore: è la prima cosa da
guardare quando qualcosa non va.

## Il puntatore: cosa aspettarsi davvero

Il mouse invia al visore veri eventi di tocco (`INJECT_TOUCH_EVENT` del protocollo scrcpy),
mappati sull'immagine che stai vedendo. Questo funziona **molto bene sui pannelli 2D**: la home
di PICO, i menu di sistema, le finestre delle app 2D, i browser.

Nelle **applicazioni immersive** il discorso cambia: quello che vedi nel mosaico è il rendering
VR e l'app non ascolta il touchscreen ma i controller. Lì il clic del mouse può non produrre
nulla. Per quei casi hai due strade, entrambe già cablate nell'interfaccia:

- i comandi di sistema (**Home**, **Indietro**, **Chiudi app attiva**, volume, avvio app), che
  passano da `am`/`input` e funzionano sempre;
- in **Focus**, i tasti freccia + Invio + Esc, che diventano eventi DPAD: molte app VR con menu
  navigabili li accettano.

Insomma: il puntatore è pensato per *sbloccare* un visitatore (rimetterlo nell'app giusta,
chiudere un popup, ripartire dalla home), non per giocare al posto suo.

## Impostazioni per visore (icona ⚙︎)

- **Nome** — l'etichetta che vedi nel mosaico (es. "Postazione 3").
- **Modalità immagine**
  - `scrcpy` (predefinita): video fluido, 20 fps nel mosaico e 30 fps in focus.
  - `screencap`: istantanee PNG circa una al secondo. Serve solo come rete di sicurezza se
    su un visore lo streaming non parte; in questa modalità clic e trascinamenti diventano
    `input tap` / `input swipe`.
- **Display** — se il firmware espone più display (per esempio quello usato per il cast),
  qui puoi scegliere quale specchiare: a volte dà un'immagine più pulita di quella VR.
- **Ritaglio** `L:A:X:Y` — utile quando l'immagine è stereoscopica e ti basta un occhio.
  Esempio con sorgente 3840×1920: `1920:1920:0:0`.

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
  main/main.js             finestra Electron e ponte IPC
  renderer/                mosaico, decodifica WebCodecs, mappatura del mouse
test/                      test del protocollo e del parser (npm test)
```

`npm test` non richiede visori: verifica byte per byte i messaggi di controllo e il parser
del flusso video, che sono le due parti dove un errore si nota solo sul campo.

## Problemi frequenti

**"adb non trovato"** → `npm run deps:adb`, oppure `brew install --cask android-platform-tools`.

**"Cerca in rete" non trova niente** → i visori devono essere accesi e *svegli*, sulla stessa
rete del Mac, e la rete non deve isolare i client (AP isolation). Se la tua rete non è una /24
standard puoi indicare le sottoreti in `config.json` → `scan.subnets`.

**Un visore risulta `unauthorized`** → va riautorizzato via USB: la spunta "Consenti sempre" non
era stata messa, oppure il Mac è cambiato.

**Dopo un riavvio del visore non si collega più** → `adb tcpip` non sopravvive al riavvio.
Ricollegalo via USB e premi di nuovo **Adotta USB**. Su molti firmware puoi renderlo permanente:

```bash
adb -s <seriale> shell setprop persist.adb.tcp.port 5555
```

**L'immagine non parte su un solo visore** → prova la modalità `screencap` dalle impostazioni di
quel visore; se il log dice *"versione del server scrcpy incompatibile"*, allinea `SCRCPY_VERSION`
in `src/main/scrcpy-session.js` alla versione scaricata in `scripts/fetch-deps.mjs`.

**Video a scatti con 10 visori** → abbassa `quality.grid.maxSize` (es. 640) e `maxFps` (es. 12)
in `config.json`: dieci flussi video su una wifi affollata sono la parte più fragile del sistema.

## Limiti noti

- Servono i permessi di debug ADB su ogni visore: è una preparazione da fare una volta, ma va fatta.
- Il puntatore non sostituisce i controller nelle app immersive (vedi sopra).
- Niente audio: lo streaming è solo video, di proposito (serve larghezza di banda per dieci flussi).
- Testato per dieci visori su una rete dedicata; su wifi molto affollate conviene una rete a parte.

## Licenze di terze parti

L'app scarica a parte, senza ridistribuirlo, `scrcpy-server` del progetto
[scrcpy](https://github.com/Genymobile/scrcpy) (Apache 2.0) e, se richiesto, le
platform-tools di Google.
