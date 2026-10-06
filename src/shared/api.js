// L'elenco delle chiamate che l'interfaccia può fare al processo principale.
//
// È QUI, in un posto solo, perché di interfacce ce ne sono due — la finestra
// Electron e il telecomando nel browser — e per mesi hanno avuto due copie di
// questo elenco. Le copie divergono: il telecomando era rimasto indietro di
// otto versioni, e dall'iPad i filmati partivano senza modalità e senza
// «dall'inizio», senza che nessun errore lo dicesse. Da un elenco solo non si
// diverge.
export function costruisciApi(invoke) {
  return {
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
      eye: (serials, mode) => invoke('devices:eye', { serials, mode }),
      videos: (serials) => invoke('devices:videos', { serials }),
      playerState: (serials) => invoke('devices:playerState', { serials }),
      media: (serials, action, profile) => invoke('devices:media', { serials, action, profile }),
      seek: (serials, ms) => invoke('devices:seek', { serials, ms }),
      replay: (serials) => invoke('devices:replay', { serials }),
      stopVideo: (serials) => invoke('devices:stopVideo', { serials }),
      videoThumb: (serial) => invoke('device:videoThumb', { serial }),
      playVideo: (entries, opts) => invoke('devices:playVideo', { entries, ...(opts ?? {}) }),
    },
    device: {
      reconnect: (serial) => invoke('device:reconnect', { serial }),
      setLabel: (serial, label) => invoke('device:label', { serial, label }),
      setMirror: (serial, mode) => invoke('device:mirror', { serial, mode }),
      setCrop: (serial, crop) => invoke('device:crop', { serial, crop }),
      setDisplay: (serial, displayId) => invoke('device:display', { serial, displayId }),
      preview: (serial) => invoke('device:preview', { serial }),
      displays: (serial) => invoke('device:displays', { serial }),
      status: (serial) => invoke('device:status', { serial }),
    },
    remoteQr: (url) => invoke('remote:qr', { url }),
    actions: {
      closeForeground: (serials) => invoke('action:closeForeground', { serials }),
      home: (serials) => invoke('action:home', { serials }),
      key: (serials, keycode) => invoke('action:key', { serials, keycode }),
      volume: (serials, steps) => invoke('action:volume', { serials, steps }),
      reboot: (serials) => invoke('action:reboot', { serials }),
    },
  };
}
