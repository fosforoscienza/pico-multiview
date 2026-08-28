import assert from 'node:assert/strict';
import test from 'node:test';

import { decideAdd } from '../src/main/device-manager.js';

// Lo stesso visore si presenta ad adb con due nomi: "PA7B10…" quando è
// attaccato al cavo, "172.20.10.3:5555" quando passa al wifi. Senza
// riconoscerli come la stessa macchina finiva in due postazioni, e ognuna gli
// apriva una sessione di mirroring per conto suo.

const CAVO = { serial: 'PA7B1044HR', hardwareId: 'PA7B1044HR' };
const WIFI = { serial: '172.20.10.3:5555', hardwareId: 'PA7B1044HR' };

test('un visore mai visto si aggiunge', () => {
  assert.deepEqual(decideAdd(WIFI, []), { action: 'add' });
});

test('lo stesso seriale non si aggiunge due volte', () => {
  assert.deepEqual(decideAdd(WIFI, [WIFI]), { action: 'skip' });
});

test('il nome wifi prende il posto di quello del cavo', () => {
  // È il caso di "Adotta USB": il visore resta uno, ma cambia indirizzo.
  assert.deepEqual(decideAdd(WIFI, [CAVO]), { action: 'replace', twin: CAVO.serial });
});

test('il cavo non si aggiunge se il visore è già lì via wifi', () => {
  // Capita riaprendo il programma con il cavo ancora attaccato.
  assert.deepEqual(decideAdd(CAVO, [WIFI]), { action: 'skip', twin: WIFI.serial });
});

test('due visori diversi restano due', () => {
  const altro = { serial: '172.20.10.4:5555', hardwareId: 'PA7B2099XY' };
  assert.deepEqual(decideAdd(altro, [WIFI]), { action: 'add' });
});

test('senza identità hardware si aggiunge invece di indovinare', () => {
  // Un visore che non risponde a getprop è meglio vederlo doppio che non
  // vederlo affatto: il doppione si toglie, l'assenza no.
  const ignoto = { serial: '172.20.10.9:5555', hardwareId: null };
  assert.deepEqual(decideAdd(ignoto, [WIFI]), { action: 'add' });
});

test('due sconosciuti non vengono scambiati l\'uno per l\'altro', () => {
  const primo = { serial: '172.20.10.8:5555', hardwareId: null };
  const secondo = { serial: '172.20.10.9:5555', hardwareId: null };
  assert.deepEqual(decideAdd(secondo, [primo]), { action: 'add' });
});
