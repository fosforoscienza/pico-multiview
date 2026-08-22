# Logo Brown Enterprises

Carica qui i due file del logo. Il programma sceglie da solo quale usare in base
allo sfondo, e finché non ci sono mostra soltanto la scritta dei crediti — quindi
puoi caricarli quando vuoi, senza che nulla si rompa.

## I due file

| Nome del file | Versione | Dove viene usata |
|---|---|---|
| `brown-enterprises-bianco.svg` | logo **bianco** | nella barra in basso dell'app, che ha lo sfondo scuro |
| `brown-enterprises-nero.svg` | logo **nero** | nel piè di pagina della guida PDF, che ha lo sfondo bianco |

Vanno bene anche in `.png` (stessi nomi, estensione diversa). Se ci sono
entrambi, viene preferito l'SVG perché resta nitido a qualsiasi dimensione, sia a
schermo che stampato.

## Come caricarli su GitHub

Dalla pagina del progetto su GitHub:

1. entra nella cartella `assets/brand`;
2. **Add file → Upload files**;
3. trascina i due file (con i nomi esatti della tabella qui sopra);
4. **Commit changes**.

Se invece lavori dal Mac con la cartella già scaricata, copiali dentro
`pico-multiview/assets/brand/` e basta: l'app li prende al prossimo avvio.

## Note pratiche

- Il logo viene mostrato **alto circa 14 pixel** nell'app e **3 mm** nel PDF:
  assicurati che si legga anche in piccolo. Un logo con testo molto fine sparisce.
- Meglio se il file ha lo sfondo **trasparente** (l'SVG ce l'ha per natura, il PNG
  va salvato con trasparenza).
- Dopo aver caricato i file, rigenera la guida con `npm run guida` per vederli
  comparire anche nel PDF. Nell'app basta riavviarla.
