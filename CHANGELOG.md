# Versioni

Il numero di versione si vede in fondo alla finestra dell'app e sulla copertina
della guida PDF.

**Come cambia:** il **primo** numero per le modifiche corpose (1.4 → 2.0), il
**secondo** per quelle piccole (1.4 → 1.5). Sta scritto in un punto solo,
`package.json`, da cui lo leggono sia l'app sia il generatore della guida.

---

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
