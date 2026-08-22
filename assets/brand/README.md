# Logo Brown Enterprises

Carica qui i due file del logo. Il programma sceglie da solo quale usare in base
allo sfondo, e finché non ci sono mostra soltanto la scritta dei crediti — quindi
puoi caricarli quando vuoi, senza che nulla si rompa.

## I due file

| Nome del file | Versione | Dove viene usata |
|---|---|---|
| un file con **`bianco`** nel nome | logo **bianco** | nella barra in basso dell'app, che ha lo sfondo scuro |
| un file con **`nero`** nel nome | logo **nero** | nel piè di pagina della guida PDF, che ha lo sfondo bianco |

Il nome esatto non conta: basta che contenga la parola `bianco` o `nero`. Vanno
bene `.svg`, `.png`, `.jpg` e `.webp`; se per la stessa variante ci sono più
file, viene preferito l'SVG perché resta nitido a qualsiasi dimensione.

## Come caricarli su GitHub

Dalla pagina del progetto su GitHub:

1. entra nella cartella `assets/brand`;
2. **Add file → Upload files**;
3. trascina i due file (basta che il nome contenga `bianco` e `nero`);
4. **Commit changes**.

Se invece lavori dal Mac con la cartella già scaricata, copiali dentro
`pico-multiview/assets/brand/` e basta: l'app li prende al prossimo avvio.

## Note pratiche

- Il logo viene mostrato **alto 24 pixel** nell'app e **6 mm** nel PDF. Su un
  marchio a più righe come questo è il minimo per leggere la scritta principale:
  se un giorno avete una versione **orizzontale a una riga sola**, in questi
  spazi renderebbe molto meglio.
- Meglio se il file ha lo sfondo **trasparente** (l'SVG ce l'ha per natura, il PNG
  va salvato con trasparenza).
- Dopo aver caricato i file, rigenera la guida con `npm run guida` per vederli
  comparire anche nel PDF. Nell'app basta riavviarla.
