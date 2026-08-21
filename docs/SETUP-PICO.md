# Preparare i PICO 4 (una volta sola per visore)

Obiettivo: rendere ogni visore raggiungibile via ADB sulla wifi, così da poterlo governare
dal Mac senza cavi. Serve circa un minuto a visore.

## 0. Prima di iniziare

- Metti Mac e visori sulla **stessa rete wifi**. Se il router ha l'opzione *AP isolation*
  (o *isolamento client*), disattivala: altrimenti il Mac non vede i visori.
- Tieni a portata un cavo USB-C dati (non solo di ricarica).
- Sul Mac serve `adb`: `npm run deps:adb` dentro la cartella del progetto, oppure
  `brew install --cask android-platform-tools`.

Consiglio per gli eventi: usa una rete wifi dedicata (anche un router portatile), con SSID e
password uguali per tutti i visori. La wifi dell'ospite è la causa numero uno dei problemi.

## 1. Attiva la modalità sviluppatore sul visore

1. Indossa il visore e vai in **Impostazioni → Generale → Informazioni sul dispositivo**.
2. Tocca ripetutamente su **Numero build** (7-8 volte) finché non appare la conferma che la
   modalità sviluppatore è attiva.
3. Torna in **Impostazioni → Sviluppatore** e attiva:
   - **Debug USB**
   - se presente, **Debug wireless / ADB su rete**
   - opzionale ma comodo: **Resta attivo durante la ricarica**

> I nomi delle voci cambiano leggermente fra le versioni di PICO OS; la sostanza è quella.

## 2. Autorizza il Mac

1. Collega il visore al Mac via USB.
2. Nel visore compare la richiesta **"Consenti debug USB da questo computer?"**:
   metti la spunta su **"Consenti sempre da questo computer"** e conferma.
   Senza quella spunta dovrai riautorizzare a ogni collegamento.
3. Verifica dal Mac:

```bash
adb devices -l
# deve comparire il visore con stato "device", non "unauthorized"
```

## 3. Passa alla wifi

Con il visore ancora collegato, apri Pico MultiView e premi **Adotta USB**.
L'app fa tre cose: legge l'IP wifi del visore, esegue `adb tcpip 5555`, si ricollega via rete.
Il visore compare nel mosaico e il cavo può essere staccato.

Lo stesso a mano, se preferisci il terminale:

```bash
adb -s <seriale-usb> shell ip -f inet addr show wlan0   # leggi l'IP
adb -s <seriale-usb> tcpip 5555
adb connect 192.168.1.51:5555
```

### Renderlo permanente (consigliato)

`adb tcpip` si perde a ogni riavvio del visore. Su molti firmware PICO questa proprietà
sopravvive e ti risparmia il giro col cavo:

```bash
adb -s <seriale> shell setprop persist.adb.tcp.port 5555
```

Se dopo un riavvio il visore non si ricollega, la proprietà non è stata mantenuta: ricollega
il cavo e ripremi **Adotta USB**.

## 4. Dai un nome ai visori

Nel mosaico, icona **⚙︎** su ogni riquadro → campo **Nome**: "Postazione 1", "Visore rosso", quello
che ti torna comodo durante l'evento. Il nome resta salvato insieme all'IP.

Suggerimento: attacca un'etichetta fisica con lo stesso nome sul visore. Quando qualcuno chiama,
sapere *quale* riquadro guardare vale più di qualsiasi funzione software.

## 5. Prepara la libreria app

**Libreria…** nella barra comandi → **Rileva app installate**: l'app elenca i pacchetti presenti
sui visori (con ✓ quelli presenti su tutti). Clicca quello dell'esperienza, dai un nome leggibile
e salva. Da quel momento lo lanci ovunque con **Avvia**.

Se conosci anche l'activity puoi indicarla per un avvio più diretto; altrimenti l'app usa
l'intent LAUNCHER del pacchetto, che va bene nella grande maggioranza dei casi.

## Checklist da fare il giorno dell'evento

1. Visori carichi e accesi, tutti sulla rete giusta.
2. Mac sulla stessa rete, app aperta: i visori noti si ricollegano da soli
   (altrimenti **Cerca in rete**).
3. Controlla le percentuali di batteria nel mosaico.
4. **Avvia** l'app dell'evento su tutti.
5. Lascia il **Puntatore disarmato** finché non ti serve davvero.

## Se qualcosa non torna

| Sintomo | Causa più probabile | Rimedio |
|---|---|---|
| il visore non compare nella scansione | rete diversa o AP isolation | stessa rete, isolamento client off |
| stato `unauthorized` | manca l'autorizzazione permanente | ricollega via USB e spunta "Consenti sempre" |
| si collegava, ora no | visore riavviato | **Adotta USB**, oppure `persist.adb.tcp.port` |
| immagine ferma su un visore | streaming interrotto | **⟳** nel riquadro, o modalità `screencap` |
| tutto lento con 10 visori | banda wifi | abbassa `quality.grid` in `config.json` |
