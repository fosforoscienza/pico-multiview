// Sceglie il trasporto e poi avvia l'interfaccia, che è la stessa nei due casi:
//  - nella finestra Electron `window.pico` lo ha già messo il preload;
//  - da browser (iPad, iPhone, altro computer) lo costruiamo sul WebSocket.

if (!window.pico) {
  document.body.classList.add('is-remote');
  await import('./pico-remote.js');
}

if (window.pico.isRemote) document.body.classList.add('is-remote');

await import('./app.js');
