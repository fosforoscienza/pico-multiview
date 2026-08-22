#!/usr/bin/env node
// Scarica le dipendenze binarie che non stanno nel repo:
//  - scrcpy-server (il .jar che viene spinto sui visori per lo streaming video)
//  - opzionalmente le platform-tools di Google (adb) con --with-platform-tools
//
// Uso:  node scripts/fetch-deps.mjs [--with-platform-tools] [--force]

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');

const SCRCPY = {
  version: '2.7',
  url: 'https://github.com/Genymobile/scrcpy/releases/download/v2.7/scrcpy-server-v2.7',
  sha256: 'a23c5659f36c260f105c022d27bcb3eafffa26070e7baa9eda66d01377a1adba',
  dest: path.join(VENDOR, 'scrcpy-server'),
};

const PLATFORM_TOOLS_URL = {
  darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
  linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
  win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
};

const args = process.argv.slice(2);
const force = args.includes('--force');
const withPlatformTools = args.includes('--with-platform-tools');

function log(...a) {
  console.log('[deps]', ...a);
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} per ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function fetchScrcpyServer() {
  if (!force && fs.existsSync(SCRCPY.dest) && sha256(SCRCPY.dest) === SCRCPY.sha256) {
    log(`scrcpy-server v${SCRCPY.version} già presente.`);
    return;
  }
  log(`scarico scrcpy-server v${SCRCPY.version}...`);
  const size = await download(SCRCPY.url, SCRCPY.dest);
  const got = sha256(SCRCPY.dest);
  if (got !== SCRCPY.sha256) {
    fs.rmSync(SCRCPY.dest, { force: true });
    throw new Error(`checksum non valido (atteso ${SCRCPY.sha256}, ottenuto ${got})`);
  }
  log(`scrcpy-server scaricato (${size} byte, checksum ok).`);
}

async function fetchPlatformTools() {
  const url = PLATFORM_TOOLS_URL[process.platform];
  if (!url) throw new Error(`piattaforma non supportata: ${process.platform}`);
  const adbPath = path.join(VENDOR, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  if (!force && fs.existsSync(adbPath)) {
    log('platform-tools già presenti.');
    return;
  }
  const zip = path.join(VENDOR, 'platform-tools.zip');
  log('scarico le platform-tools (adb)...');
  await download(url, zip);
  log('estraggo...');
  execFileSync('unzip', ['-o', '-q', zip, '-d', VENDOR], { stdio: 'inherit' });
  fs.rmSync(zip, { force: true });
  if (process.platform !== 'win32') fs.chmodSync(adbPath, 0o755);
  log(`adb installato in ${adbPath}`);
}

try {
  await fetchScrcpyServer();
  if (withPlatformTools) await fetchPlatformTools();
  else {
    // Suggerimento non bloccante: adb serve comunque.
    log('adb: uso quello di sistema. Se non ce l\'hai: npm run deps:adb  (oppure brew install --cask android-platform-tools)');
  }
  log('fatto.');
} catch (err) {
  console.error('[deps] ERRORE:', err.message);
  console.error('[deps] Puoi riprovare con: npm run deps -- --force');
  // Non blocchiamo npm install: l\'app segnala la dipendenza mancante all\'avvio.
  process.exitCode = 0;
}
