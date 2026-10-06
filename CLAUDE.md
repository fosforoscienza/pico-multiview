# Note per chi lavora su questo repo

Regole nate dall'uso vero, da rispettare a ogni modifica.

- **Il tutorial segue l'interfaccia.** I passi del giro guidato vivono in
  `src/renderer/app.js`, accanto al pulsante «Tutorial»: ogni modifica alla UI
  (un pulsante nuovo, uno spostato, un comportamento cambiato) aggiorna anche
  il passo che lo racconta, nello stesso commit.
- **Una versione per consegna.** Ogni lotto di modifiche incrementa la versione
  in `package.json` (+ le due occorrenze in `package-lock.json`) e aggiunge la
  voce in `CHANGELOG.md`, nello stile delle esistenti: si scrive il perché,
  non solo il cosa. Il numero si vede nel footer dell'app: è come l'utente
  verifica di stare eseguendo la versione giusta.
- **Le due interfacce sono una.** La finestra Electron e il telecomando nel
  browser condividono `src/shared/api.js`: le chiamate nuove si aggiungono lì,
  mai nei due file di trasporto. È già successo che divergessero: otto
  versioni di distanza, senza un errore.
- **Gli esiti importanti vanno in faccia, non nel registro.** Il registro è
  per la diagnosi; quello che l'operatore deve sapere subito (es. «puoi
  staccare il cavo») va in un avviso (`mostraAvviso`).
- **Niente promesse non verificate verso i visori.** I comandi adb falliscono
  in silenzio: ogni avvio si verifica (`qualcosaSiEAperto`), ogni esito
  incerto si scrive nel registro con il suo motivo.
- **I test girano con `npm test`.** I parser e i comandi shell si provano
  contro adb finti (vedi `test/avvio-video.test.mjs`): un difetto trovato sul
  visore diventa un test che lo sorveglia.
