// Ponte sicuro fra UI e processo principale (contextIsolation attivo).

import { contextBridge, ipcRenderer } from 'electron';

import { costruisciApi } from './shared/api.js';

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
  ...costruisciApi(invoke),
  remote: {
    status: () => invoke('remote:status'),
    start: (port) => invoke('remote:start', { port }),
    stop: () => invoke('remote:stop'),
    newPin: () => invoke('remote:newPin'),
  },
  isRemote: false,
  on(event, handler) {
    if (!EVENTS.includes(event)) throw new Error(`evento non consentito: ${event}`);
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
