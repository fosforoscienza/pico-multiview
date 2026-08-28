// Trasporto WebSocket per i telecomandi (iPad, iPhone, altri computer).
//
// Espone esattamente la stessa `window.pico` del preload Electron: così tutto
// il resto dell'interfaccia — postazioni, anteprima, visuale libera, comandi —
// gira identico sui due lati senza una riga di codice duplicata.

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];

const listeners = new Map(); // evento -> Set<handler>
const pending = new Map(); // id richiesta -> { resolve, reject }
let socket = null;
let nextId = 1;
let attempt = 0;
let connected = false;

function emit(event, payload) {
  for (const handler of listeners.get(event) ?? []) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[remote] handler ${event}:`, err);
    }
  }
}

function socketUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/`;
}

function connect() {
  socket = new WebSocket(socketUrl());
  socket.binaryType = 'arraybuffer';

  socket.addEventListener('open', () => {
    attempt = 0;
    connected = true;
    emit('connection', { connected: true });
  });

  socket.addEventListener('message', (ev) => {
    if (ev.data instanceof ArrayBuffer) return onFrame(ev.data);
    let message;
    try {
      message = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (message.t === 'reply') {
      const entry = pending.get(message.payload.id);
      if (!entry) return;
      pending.delete(message.payload.id);
      if (message.payload.ok) entry.resolve(message.payload.value);
      else entry.reject(new Error(message.payload.error ?? 'errore sconosciuto'));
      return;
    }
    emit(message.t, message.payload);
  });

  socket.addEventListener('close', () => {
    connected = false;
    emit('connection', { connected: false });
    for (const [id, entry] of pending) {
      entry.reject(new Error('connessione al Mac persa'));
      pending.delete(id);
    }
    const wait = RECONNECT_DELAYS[Math.min(attempt++, RECONNECT_DELAYS.length - 1)];
    setTimeout(connect, wait);
  });

  socket.addEventListener('error', () => socket.close());
}

/** Frame video: [4 byte lunghezza header][header JSON][payload]. */
function onFrame(buffer) {
  const view = new DataView(buffer);
  const headerLength = view.getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
  emit('frame', { ...header, data: new Uint8Array(buffer, 4 + headerLength) });
}

function invoke(channel, payload) {
  return new Promise((resolve, reject) => {
    if (!connected) {
      reject(new Error('non collegato al Mac'));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ t: 'invoke', id, channel, payload }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error('il Mac non ha risposto'));
    }, 30000);
  });
}

/** Comandi senza risposta: se il socket è chiuso si perdono, ed è giusto così. */
function signal(type, payload) {
  if (connected) socket.send(JSON.stringify({ t: type, payload }));
}

const pico = {
  info: () => invoke('app:info'),
  config: {
    get: () => invoke('config:get'),
    patch: (patch) => invoke('config:patch', patch),
  },
  devices: {
    list: () => invoke('devices:list'),
    sync: () => invoke('devices:sync'),
    scan: (opts) => invoke('devices:scan', opts ?? {}),
    adoptUsb: () => invoke('devices:adoptUsb'),
    add: (host, port) => invoke('devices:add', { host, port }),
    remove: (serial, forget) => invoke('devices:remove', { serial, forget }),
    commonPackages: (serials) => invoke('devices:commonPackages', { serials }),
    eye: (serials, mode) => invoke('devices:eye', { serials, mode }),
    pointerMode: (serials, mode) => invoke('devices:pointerMode', { serials, mode }),
  },
  device: {
    reconnect: (serial) => invoke('device:reconnect', { serial }),
    setLabel: (serial, label) => invoke('device:label', { serial, label }),
    setMirror: (serial, mode) => invoke('device:mirror', { serial, mode }),
    setCrop: (serial, crop) => invoke('device:crop', { serial, crop }),
    setDisplay: (serial, displayId) => invoke('device:display', { serial, displayId }),
    preview: (serial) => invoke('device:preview', { serial }),
    packages: (serial, includeSystem = false) => invoke('device:packages', { serial, includeSystem }),
    displays: (serial) => invoke('device:displays', { serial }),
    status: (serial) => invoke('device:status', { serial }),
  },
  actions: {
    launch: (serials, pkg, activity) => invoke('action:launch', { serials, package: pkg, activity }),
    stop: (serials, pkg) => invoke('action:stop', { serials, package: pkg }),
    closeForeground: (serials) => invoke('action:closeForeground', { serials }),
    home: (serials) => invoke('action:home', { serials }),
    key: (serials, keycode) => invoke('action:key', { serials, keycode }),
    volume: (serials, steps) => invoke('action:volume', { serials, steps }),
    reboot: (serials) => invoke('action:reboot', { serials }),
  },
  remote: {
    status: () => invoke('remote:status'),
    // Il telecomando non spegne il server da cui è collegato: sarebbe come
    // segare il ramo su cui si è seduti. Si fa dal Mac.
    start: () => Promise.reject(new Error('gestibile solo dal Mac')),
    stop: () => Promise.reject(new Error('gestibile solo dal Mac')),
    newPin: () => Promise.reject(new Error('gestibile solo dal Mac')),
  },
  isRemote: true,
  pointer: (payload) => signal('pointer', payload),
  scroll: (payload) => signal('scroll', payload),
  on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event)?.delete(handler);
  },
};

connect();

// Aspettiamo la prima connessione prima di far partire l'interfaccia: così la
// schermata non parte vuota per poi riempirsi a scatti.
await new Promise((resolve) => {
  if (connected) return resolve();
  const stop = pico.on('connection', ({ connected: ok }) => {
    if (!ok) return;
    stop();
    resolve();
  });
});

window.pico = pico;
