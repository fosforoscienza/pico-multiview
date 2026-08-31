// Registro dei visori: sincronizza l'elenco con adb, propaga gli eventi verso
// la UI e offre le operazioni "su tutti" / "sui selezionati".

import { EventEmitter } from 'node:events';

import * as adb from './adb.js';
import * as apps from './apps.js';
import { Device, STATE } from './device.js';

const STATUS_POLL_MS = 12000;

const isWifi = (serial) => serial.includes(':');

/**
 * Lo stesso visore si presenta ad adb con due nomi: il seriale del cavo
 * (`PA7B10…`) e `indirizzo:porta` quando passa al wifi. Senza confrontarli
 * finisce in due postazioni, con lo stesso nome, e ognuna gli apre una
 * sessione di mirroring per conto suo.
 *
 * Il confronto si fa su `ro.serialno`, che è la macchina e non il modo in cui
 * ci si è collegati.
 *
 * @param candidate   {serial, hardwareId} appena visto da adb
 * @param registered  [{serial, hardwareId}] già nel registro
 * @returns {{action: 'add'|'skip'|'replace', twin?: string}}
 */
export function decideAdd(candidate, registered) {
  if (registered.some((d) => d.serial === candidate.serial)) return { action: 'skip' };
  if (!candidate.hardwareId) return { action: 'add' };

  const twin = registered.find((d) => d.hardwareId === candidate.hardwareId);
  if (!twin) return { action: 'add' };

  // Fra i due nomi vince il wifi: è quello che continua a funzionare quando si
  // stacca il cavo, ed è il senso di "Adotta USB".
  if (isWifi(candidate.serial) && !isWifi(twin.serial)) {
    return { action: 'replace', twin: twin.serial };
  }
  return { action: 'skip', twin: twin.serial };
}

/**
 * Quanto aspettare prima di ribussare a un indirizzo che non risponde.
 *
 * Ritentarlo a ogni aggiornamento significava pagarne l'attesa ogni volta; non
 * ritentarlo mai significava non accorgersi del visore che torna acceso. Le
 * attese crescono, con un tetto: mezzo minuto, poi uno, poi due, fino a cinque.
 */
export function attesaRiprova(tentativi) {
  return Math.min(30000 * 2 ** Math.max(0, tentativi - 1), 300000);
}

/**
 * Gli indirizzi salvati a cui vale la pena ribussare adesso.
 *
 * Fuori restano quelli già collegati e quelli in attesa dopo un buco nell'acqua.
 */
export function daRiconnettere({ salvati = [], online = new Set(), irraggiungibili = new Map(), now = Date.now() } = {}) {
  return salvati
    .map((e) => e.serial)
    .filter((serial) => isWifi(serial) && !online.has(serial))
    .filter((serial) => (irraggiungibili.get(serial)?.prossimo ?? 0) <= now);
}

/**
 * Cosa dire di un visore che adb vede ma non è pronto all'uso.
 *
 * Sono i due modi in cui un cavo attaccato non serve a niente, e finora non
 * producevano **nessuna riga** nel registro: l'operatore vedeva un elenco
 * vuoto e un cavo in mano, senza sapere che il visore era lì e cosa mancasse.
 */
export function diagnosiCollegamento(seen = []) {
  const spiegazioni = {
    unauthorized:
      'collegato ma non ancora autorizzato: indossa il visore e accetta «Consenti debug USB» ' +
      '(spunta «ricorda sempre», così non lo richiede più)',
    offline:
      'collegato ma adb lo vede «offline»: stacca e riattacca il cavo, oppure riavvia il visore',
  };
  return seen
    .filter((d) => d.state !== 'device' && spiegazioni[d.state])
    .map((d) => ({ serial: d.serial, level: 'error', message: spiegazioni[d.state] }));
}

export class DeviceManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.devices = new Map(); // serial -> Device
    this.hardwareIds = new Map(); // serial -> ro.serialno, per riconoscere i doppioni
    // indirizzo salvato -> {tentativi, prossimo}: quando ribussare, e da quante
    // volte non risponde. Serve a non pagare l'attesa a ogni aggiornamento.
    this.unreachable = new Map();
    this.reti = null; // sottoreti locali dell'ultimo giro: se cambiano si riprova subito
    this.statiDetti = new Map(); // serial -> stato già spiegato, per non ripeterlo
    this.lettoriMuti = new Set(); // visori il cui lettore non pubblica lo stato
    this.statusTimer = null;
  }

  /** `ro.serialno` del visore, chiesto una volta sola e poi tenuto in cache. */
  async #hardwareId(serial) {
    if (this.hardwareIds.has(serial)) return this.hardwareIds.get(serial);
    const registrato = this.devices.get(serial)?.info?.hardwareId;
    const id = registrato ?? (await apps.deviceInfo(serial).catch(() => ({}))).hardwareId ?? null;
    this.hardwareIds.set(serial, id);
    return id;
  }

  #registered() {
    return [...this.devices.keys()].map((serial) => ({
      serial,
      hardwareId: this.hardwareIds.get(serial) ?? this.devices.get(serial)?.info?.hardwareId ?? null,
    }));
  }

  list() {
    return [...this.devices.values()].map((d) => d.toJSON());
  }

  get(serial) {
    return this.devices.get(serial) ?? null;
  }

  #wire(device) {
    device.on('state', (payload) => this.emit('device-state', payload));
    device.on('status', (payload) => this.emit('device-status', payload));
    device.on('codec', (payload) => this.emit('device-codec', payload));
    device.on('frame', (payload) => this.emit('frame', payload));
    device.on('log', (payload) => this.emit('log', payload));
  }

  add(serial, { label = null, connect = true } = {}) {
    let device = this.devices.get(serial);
    if (device) return device;

    const entry = this.config.deviceEntry(serial) ?? {};
    device = new Device(serial, {
      label: label ?? entry.label ?? null,
      playerPackage: entry.playerPackage ?? null,
      config: {
        mirror: entry.mirror ?? 'scrcpy',
        crop: entry.crop ?? null,
        displayId: entry.displayId ?? 0,
        pointerMode: entry.pointerMode ?? this.config.data.pointerMode ?? 'scrcpy',
        quality: this.config.data.quality.grid,
        autoReconnect: this.config.data.autoReconnect,
        screencapIntervalMs: this.config.data.screencapIntervalMs,
      },
    });
    this.#wire(device);
    this.devices.set(serial, device);
    this.config.upsertDevice({
      serial,
      label: device.label,
      mirror: device.mirror,
      crop: device.crop,
      displayId: device.displayId,
    });
    this.emit('devices', this.list());
    if (connect) device.connect();
    return device;
  }

  async remove(serial, { forget = false } = {}) {
    const device = this.devices.get(serial);
    if (device) {
      await device.dispose();
      this.devices.delete(serial);
    }
    if (forget) {
      this.config.removeDevice(serial);
      await adb.disconnect(serial);
    }
    this.emit('devices', this.list());
  }

  /**
   * Allinea il registro a quello che vede adb: aggiunge i nuovi dispositivi
   * online e prova a ricollegare quelli salvati in configurazione.
   *
   * L'ordine conta. Prima i visori che adb già vede — il cavo, soprattutto —
   * e solo dopo i tentativi verso la rete: quando le due cose stavano in fila,
   * un indirizzo salvato che non risponde teneva fermo il giro per secondi, e
   * se falliva con un errore lo interrompeva del tutto. Il visore attaccato al
   * cavo non arrivava mai a essere aggiunto.
   */
  async sync({ autoConnect = this.config.data.autoConnect } = {}) {
    const seen = await adb.listDevices();
    const online = new Set(seen.filter((d) => d.state === 'device').map((d) => d.serial));

    await this.#registra(online, autoConnect);

    if (autoConnect) {
      const tornati = await this.#riconnettiSalvati(online);
      for (const serial of tornati) online.add(serial);
      if (tornati.length) await this.#registra(new Set(tornati), autoConnect);
    }

    for (const avviso of diagnosiCollegamento(seen)) {
      // Una volta sola per stato: chi non autorizza il visore al primo
      // aggiornamento non lo autorizza nemmeno al decimo avviso uguale.
      if (this.statiDetti.get(avviso.serial) === avviso.message) continue;
      this.statiDetti.set(avviso.serial, avviso.message);
      this.emit('log', avviso);
    }
    for (const d of seen) {
      if (d.state === 'device') this.statiDetti.delete(d.serial);
      const dev = this.devices.get(d.serial);
      if (dev && d.state !== 'device' && dev.state === STATE.STREAMING) {
        dev.log('error', `dispositivo in stato "${d.state}"`);
      }
    }

    this.emit('devices', this.list());
    return { seen, online: [...online] };
  }

  /** Mette in elenco i visori che adb vede pronti, saltando i doppioni. */
  async #registra(online, autoConnect) {
    for (const serial of online) {
      if (this.devices.has(serial)) continue;
      const decision = decideAdd(
        { serial, hardwareId: await this.#hardwareId(serial) },
        this.#registered(),
      );
      if (decision.action === 'skip') {
        if (decision.twin) {
          this.emit('log', {
            serial: decision.twin,
            level: 'info',
            message: `${serial} è lo stesso visore, già in elenco: non lo aggiungo una seconda volta`,
          });
        }
        continue;
      }
      if (decision.action === 'replace') {
        this.emit('log', {
          serial,
          level: 'info',
          message: `passato al wifi: prende il posto di ${decision.twin}`,
        });
        await this.remove(decision.twin, { forget: true });
      }
      this.add(serial, { connect: autoConnect });
    }
  }

  /**
   * Ribussa agli indirizzi salvati che non sono già collegati.
   *
   * Tutti insieme, non in fila: sono attese di rete, e una decina di visori
   * spenti metterebbe in coda un minuto buono di aggiornamento.
   */
  async #riconnettiSalvati(online) {
    // Cambiare rete cambia gli indirizzi buoni: le attese accumulate finora
    // non dicono più niente, e si riprova subito da capo.
    const reti = adb.localSubnets().sort().join(' ');
    if (this.reti !== null && this.reti !== reti) this.unreachable.clear();
    this.reti = reti;

    const now = Date.now();
    const piano = daRiconnettere({
      salvati: this.config.data.devices,
      online,
      irraggiungibili: this.unreachable,
      now,
    });
    const esiti = await Promise.all(piano.map((serial) => this.#riconnetti(serial, now)));
    return esiti.filter(Boolean);
  }

  async #riconnetti(serial, now) {
    const [host, porta] = serial.split(':');
    const port = Number(porta) || 5555;
    // Si bussa alla porta prima di chiamare adb: un indirizzo morto si scopre
    // in un attimo, mentre "adb connect" ci mette fino a otto secondi.
    const raggiungibile = await adb.isPortOpen(host, port);
    const res = raggiungibile
      ? await adb.connect(host, port)
      : { ok: false, message: 'non risponde sulla porta adb' };
    if (res.ok) {
      this.unreachable.delete(serial);
      return serial;
    }
    const tentativi = (this.unreachable.get(serial)?.tentativi ?? 0) + 1;
    this.unreachable.set(serial, { tentativi, prossimo: now + attesaRiprova(tentativi) });
    // Un indirizzo che non risponde più — tipico dopo un cambio di rete — lo si
    // dice una volta, con cosa fare, invece di riempire il registro.
    if (tentativi > 1) return null;
    const dove = this.reti ? ` Il computer ora è sulla rete ${this.reti.split(' ').join(', ')}.` : '';
    this.emit('log', {
      serial,
      level: 'error',
      message:
        `${serial} non risponde: è un visore salvato su un indirizzo che non esiste più ` +
        `(succede cambiando rete).${dove} Toglilo dalla sua postazione, oppure riaggiungilo ` +
        'con l\'indirizzo nuovo.',
    });
    return null;
  }

  /** Scansione della rete + aggiunta di tutto ciò che risponde. */
  async scan({ subnets = null, port = 5555, timeout = 400 } = {}) {
    const result = await adb.scanNetwork({
      subnets: subnets?.length ? subnets : adb.localSubnets(),
      port,
      timeout,
      onProgress: (p) => this.emit('scan-progress', p),
    });
    // Non li aggiungiamo qui: "adb connect" li ha già resi visibili a
    // "adb devices", e sync() li prende passando dal controllo dei doppioni.
    await this.sync();
    return result;
  }

  /** Prende i visori collegati via USB e li passa al controllo wifi. */
  async adoptUsbDevices() {
    const seen = await adb.listDevices();
    const usb = seen.filter((d) => d.transport === 'usb' && d.state === 'device');
    const results = [];
    for (const d of usb) {
      try {
        // L'identità va letta ora, finché il cavo c'è: serve a riconoscere
        // questo stesso visore quando si ripresenterà come "indirizzo:porta".
        const hardwareId = await this.#hardwareId(d.serial);
        const serial = await adb.enableWifiAdb(d.serial);
        if (hardwareId) this.hardwareIds.set(serial, hardwareId);
        // Il nome del cavo non serve più, e lasciarlo significherebbe due
        // postazioni per lo stesso visore.
        if (this.devices.has(d.serial)) await this.remove(d.serial, { forget: true });
        this.add(serial);
        results.push({ usb: d.serial, wifi: serial, ok: true });
      } catch (err) {
        results.push({ usb: d.serial, ok: false, error: err.message });
      }
    }
    await this.sync();
    return results;
  }

  targets(serials) {
    if (!serials || serials === 'all' || (Array.isArray(serials) && serials.length === 0)) {
      return [...this.devices.values()];
    }
    return serials.map((s) => this.devices.get(s)).filter(Boolean);
  }

  /**
   * Esegue un'azione su più visori in parallelo, senza far fallire il gruppo.
   *
   * `quiet` serve alle azioni ripetute da sole — leggere a che punto è il
   * filmato, due volte al secondo — dove un visore che non risponde
   * riempirebbe il registro della stessa riga per tutta la proiezione. L'esito
   * torna comunque a chi ha chiesto: è solo il registro a restare pulito.
   */
  async each(serials, fn, { concurrency = 10, quiet = false } = {}) {
    const list = this.targets(serials);
    const results = [];
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= list.length) return;
        const device = list[i];
        try {
          results.push({ serial: device.serial, ok: true, value: await fn(device) });
        } catch (err) {
          results.push({ serial: device.serial, ok: false, error: err.message });
          if (!quiet) device.log('error', err.message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
    return results;
  }

  /**
   * Video trovati sui visori, raggruppati per nome del file.
   *
   * Il raggruppamento è per **nome**, non per percorso: lo stesso filmato
   * copiato in `/sdcard/Movies` su un visore e in `/sdcard/Download` su un
   * altro è lo stesso filmato, e chi lo cerca lo cerca per nome.
   */
  async videoLibrary(serials) {
    const perDevice = await this.each(serials, (d) => apps.listVideos(d.serial));
    const perNome = new Map();
    for (const r of perDevice) {
      const device = this.devices.get(r.serial);
      // L'esito va scritto per ogni visore: "nessun filmato" e "la ricerca è
      // fallita" sono due risposte diverse, e senza il registro si confondono.
      if (!r.ok) {
        device?.log('error', `ricerca video fallita: ${r.error}`);
        continue;
      }
      // La cartella in cui ha cercato va detta insieme al numero: «0 file» è
      // una risposta che si capisce solo sapendo dove ha guardato.
      const dove = r.value.roots.length
        ? ` in ${r.value.roots.join(', ')}`
        : ' (nessuna memoria da guardare: il visore non espone /sdcard)';
      device?.log('info', `ricerca video: ${r.value.paths.length} file trovati${dove}`);
    }
    for (const r of perDevice) {
      if (!r.ok) continue;
      for (const percorso of r.value.paths) {
        const nome = apps.fileName(percorso);
        if (!nome) continue;
        if (!perNome.has(nome)) perNome.set(nome, { name: nome, on: [] });
        perNome.get(nome).on.push({ serial: r.serial, path: percorso });
      }
    }
    const totale = perDevice.filter((r) => r.ok).length;
    return [...perNome.values()]
      .map((v) => ({ ...v, count: v.on.length, total: totale, onAll: v.on.length === totale }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'it'));
  }

  /**
   * Manda un filmato in riproduzione su tutti i visori che ce l'hanno.
   *
   * I comandi partono **insieme**, non uno dopo l'altro: partire in fila
   * significherebbe un visore indietro di qualche secondo rispetto al primo.
   * Resta comunque un avvio simultaneo, non una sincronia fotogramma per
   * fotogramma: per quella servirebbe un'app dentro il visore.
   */
  async playVideoEverywhere(voci, { fromStart = true, videoType = null } = {}) {
    const results = await Promise.all(
      voci.map(async ({ serial, path }) => {
        const device = this.devices.get(serial);
        try {
          const esito = await apps.playVideo(serial, path, {
            fromStart,
            videoType,
            player: device?.playerPackage ?? null,
          });
          // Quali lettori sono stati azzerati va scritto: se un giorno un
          // lettore perdesse le sue impostazioni, questa è la riga che spiega
          // il perché — e se il filmato riparte ancora da metà, la sua assenza
          // dice che il lettore vero non è ancora stato visto in azione.
          if (esito?.azzerati?.length) {
            device?.log('info', `azzerata la memoria di: ${esito.azzerati.join(', ')}`);
          }
          // La strada con cui è partito va scritta: «parte ma in cinema» e
          // «parte ma da metà» si diagnosticano solo sapendo quale chiamata ha
          // aperto il filmato, e quali sono state saltate e perché.
          for (const saltato of esito?.saltati ?? []) device?.log('error', saltato);
          if (esito?.via) device?.log('info', `avviato con: ${esito.via}`);
          // La durata la conosce l'indice del visore, e serve alla barra: senza,
          // si vedrebbe il tempo trascorso senza sapere quanto manca.
          const durationMs = await apps.videoDuration(serial, path).catch(() => null);
          device?.setPlaying({ path, name: apps.fileName(path), durationMs, startedAt: Date.now() });
          device?.log('info', `riproduco ${apps.fileName(path)}${fromStart ? ' dall\'inizio' : ''}`);
          // La verifica non fa aspettare chi ha premuto: parte per conto suo e
          // finisce nel registro. Serve perché «riparte dall'inizio» non può
          // essere una speranza — o il lettore l'ha fatto, o va detto.
          if (fromStart && device) this.#verificaPartenza(device).catch(() => {});
          return { serial, ok: true, value: path };
        } catch (err) {
          device?.log('error', `non riesco ad avviare ${apps.fileName(path)}: ${err.message}`);
          return { serial, ok: false, error: err.message };
        }
      }),
    );
    return results;
  }

  /**
   * Controlla che il filmato sia partito davvero dall'inizio.
   *
   * Chiudere il lettore prima di lanciare basta quasi sempre, ma «quasi» non è
   * una garanzia: certi lettori si riaprono dove erano rimasti. Allora si
   * guarda, e se è ripartito da metà lo si riporta indietro.
   *
   * E se il lettore non pubblica il suo stato, non c'è niente da guardare: è
   * un limite di quel lettore, e va detto una volta — altrimenti l'operatore
   * aspetterebbe una barra che non arriverà mai.
   */
  async #verificaPartenza(device, { attesaMs = 2500, sogliaMs = 5000 } = {}) {
    await adb.delay(attesaMs);
    // Chi si è aperto davvero: è il lettore da chiudere e azzerare al prossimo
    // avvio, ed è più affidabile di qualunque domanda al sistema. Si salva
    // nella configurazione: al riavvio dell'app, saperlo già dal primo lancio
    // fa la differenza fra un primo filmato che riparte da metà e uno no.
    const imparato = await device.imparaLettore().catch(() => null);
    if (imparato) this.config.upsertDevice({ serial: device.serial, playerPackage: imparato });
    const stato = await device.playerState().catch(() => null);
    if (!stato) {
      if (this.lettoriMuti.has(device.serial)) return;
      this.lettoriMuti.add(device.serial);
      device.log(
        'error',
        'il lettore di questo visore non dice a che punto è il filmato: la barra non può ' +
          'seguirlo, e pausa e salto potrebbero non rispondere',
      );
      return;
    }
    this.lettoriMuti.delete(device.serial);
    if (stato.positionMs <= sogliaMs) return;
    device.log('info', `era ripartito da ${Math.round(stato.positionMs / 1000)}s: lo riporto all'inizio`);
    await device.seekTo(0).catch((err) => device.log('error', `non riesco a riportarlo all'inizio: ${err.message}`));
  }

  /**
   * A che punto è il filmato su ogni visore.
   *
   * Le letture partono insieme: in fila, l'ultimo visore risponderebbe con una
   * fotografia più vecchia di quella del primo, e la barra li mostrerebbe
   * sfasati anche quando sono allineati davvero.
   */
  async playersState(serials) {
    return this.each(serials, (d) => d.playerState(), { quiet: true });
  }

  /**
   * Un comando del lettore su tutti i visori, nello stesso momento.
   *
   * Insieme, non in fila: fermarsi è la cosa che più si nota se avviene a
   * scaglioni, ed è il motivo per cui esiste questo pulsante.
   */
  async mediaEverywhere(serials, azione, profilo = this.config.data.playerKeys) {
    return this.each(serials, async (d) => {
      await d.mediaKey(azione, profilo);
      return azione;
    });
  }

  /** Porta tutti i visori allo stesso punto del filmato. */
  async seekEverywhere(serials, ms) {
    return this.each(serials, async (d) => {
      const stato = await d.seekTo(ms, { profilo: this.config.data.playerKeys });
      return stato?.positionMs ?? null;
    });
  }

  /** Rimanda dall'inizio il filmato che ciascuno sta già guardando. */
  async replayEverywhere(serials) {
    const voci = this.targets(serials)
      .filter((d) => d.playing?.path)
      .map((d) => ({ serial: d.serial, path: d.playing.path }));
    if (!voci.length) throw new Error('nessun filmato in corso: mandane uno dalla finestra «Video…»');
    return this.playVideoEverywhere(voci, { fromStart: true });
  }

  /** Pacchetti presenti su TUTTI i visori indicati (utile per la libreria app). */
  async commonPackages(serials) {
    const perDevice = await this.each(serials, (d) => d.listPackages());
    const ok = perDevice.filter((r) => r.ok).map((r) => r.value);
    if (!ok.length) return [];
    const counts = new Map();
    for (const list of ok) for (const pkg of new Set(list)) counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
    return [...counts.entries()]
      .map(([pkg, n]) => ({ package: pkg, onAll: n === ok.length, count: n, total: ok.length }))
      .sort((a, b) => Number(b.onAll) - Number(a.onAll) || a.package.localeCompare(b.package));
  }

  startStatusPolling() {
    this.stopStatusPolling();
    this.statusTimer = setInterval(() => {
      for (const d of this.devices.values()) {
        if (d.state === STATE.STREAMING) d.refreshStatus().catch(() => {});
      }
    }, STATUS_POLL_MS);
  }

  stopStatusPolling() {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
  }

  async disposeAll() {
    this.stopStatusPolling();
    await Promise.all([...this.devices.values()].map((d) => d.dispose()));
    this.devices.clear();
  }
}
