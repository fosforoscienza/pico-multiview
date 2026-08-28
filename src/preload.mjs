// Ponte sicuro fra UI e processo principale (contextIsolation attivo).

import { contextBridge, ipcRenderer } from 'electron';

const EVENTS = [
  'devices',
  'device-state',
  'device-status',
  'device-codec',
  'frame',
  'log',
  'scan-progress',
  'config',
  'remote-status',
];

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload).then((res) => {
    if (!res?.ok) throw new Error(res?.error ?? 'errore sconosciuto');
    return res.value;
  });
}

contextBridge.exposeInMainWorld('pico', {
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
    start: (port) => invoke('remote:start', { port }),
    stop: () => invoke('remote:stop'),
    newPin: () => invoke('remote:newPin'),
  },
  isRemote: false,
  pointer: (payload) => ipcRenderer.send('pointer', payload),
  scroll: (payload) => ipcRenderer.send('scroll', payload),
  on(event, handler) {
    if (!EVENTS.includes(event)) throw new Error(`evento non consentito: ${event}`);
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
