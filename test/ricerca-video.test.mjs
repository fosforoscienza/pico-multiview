import assert from 'node:assert/strict';
import test from 'node:test';

import { DeviceManager } from '../src/main/device-manager.js';
import { descriviRicerca, rigaEsito } from '../src/shared/ricerca-video.js';

// «Non trova nessun video nei visori»: la finestra diceva solo «nessun filmato
// trovato in Movies, Download, DCIM…» — cartelle che la ricerca non guardava
// più da tempo — e il motivo vero stava nel registro. Questi test tengono il
// motivo sullo schermo.

const vuoto = { serial: 'a', nome: 'Visore 1', ok: true, file: 0, radici: ['/sdcard'] };
const pieno = { serial: 'b', nome: 'Visore 2', ok: true, file: 3, radici: ['/sdcard'] };
const fallito = { serial: 'c', nome: 'Visore 3', ok: false, errore: 'timeout' };
const assente = { serial: 'd', nome: '192.168.1.9:5555', ok: false, errore: 'non collegato' };

test('ogni visore dice cosa ha trovato, o perché non ha potuto cercare', () => {
  assert.equal(rigaEsito(vuoto), 'Visore 1: nessun file video in /sdcard');
  assert.equal(rigaEsito(pieno), 'Visore 2: 3 file in /sdcard');
  assert.equal(rigaEsito(fallito), 'Visore 3: ricerca non riuscita — timeout');
  assert.equal(rigaEsito(assente), '192.168.1.9:5555: non collegato, non ho potuto cercare');
});

test('nessun filmato: si elencano tutti i visori, e si dice dove copiare i file', () => {
  const d = descriviRicerca(0, [vuoto, fallito]);
  assert.equal(d.titolo, 'Nessun filmato trovato sui visori.');
  assert.equal(d.righe.length, 2);
  assert.match(d.consiglio, /Movies/);
  assert.match(d.consiglio, /mp4/);
  assert.doesNotMatch(d.titolo, /DCIM/, 'niente cartelle che la ricerca non guarda');
});

test('se la ricerca fallisce ovunque, il titolo non parla di visori vuoti', () => {
  const d = descriviRicerca(0, [fallito, assente]);
  assert.equal(d.titolo, 'La ricerca non è riuscita su nessun visore.');
  assert.equal(d.consiglio, null, 'copiare file non risolve una ricerca fallita');
});

test('con dei filmati, si segnalano solo i visori che hanno un problema', () => {
  const d = descriviRicerca(5, [pieno, vuoto, fallito]);
  assert.equal(d.titolo, '5 filmati trovati');
  assert.deepEqual(d.righe, [rigaEsito(fallito), rigaEsito(vuoto)]);
});

test('senza visori da interrogare lo si dice', () => {
  assert.match(descriviRicerca(0, []).titolo, /postazione/);
});

test('videoLibrary restituisce anche gli esiti: fallita, vuota, e visore assente', async () => {
  const manager = new DeviceManager({ data: { devices: [] }, deviceEntry: () => null, patch: () => {} });
  for (const serial of ['a:5555', 'b:5555']) {
    manager.devices.set(serial, { serial, displayName: `V-${serial}`, log: () => {}, dispose: async () => {} });
  }
  manager.each = async () => [
    { serial: 'a:5555', ok: true, value: { roots: ['/sdcard'], paths: [] } },
    { serial: 'b:5555', ok: false, error: 'timeout' },
  ];
  const { filmati, esiti } = await manager.videoLibrary(['a:5555', 'b:5555', 'z:5555']);
  assert.deepEqual(filmati, []);
  const per = Object.fromEntries(esiti.map((e) => [e.serial, e]));
  assert.equal(per['a:5555'].file, 0);
  assert.equal(per['b:5555'].errore, 'timeout');
  assert.equal(per['z:5555'].errore, 'non collegato', 'un visore assente non sparisce in silenzio');
});
