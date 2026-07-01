# @emvault/jade

A **dependency-free Blockstream Jade driver for the browser**, speaking Jade's
CBOR-RPC protocol directly over the **Web Serial API** (USB).

It exists because `lwk_wasm`'s `Jade` has no Bitcoin `sign_psbt` entry point and
no xpub / fingerprint / multisig-registration surface. This driver fills that
gap: **Bitcoin PSBT signing** plus full **device onboarding** (xpub, master
fingerprint, multisig registration) over a single USB connection.

## Requirements

- A **Chromium-based desktop browser** (Web Serial API: Chrome/Edge/Brave/Arc).
  The driver throws a clear error elsewhere.
- A Blockstream **Jade** (v1, Jade Plus, or a DIY ESP32 build — USB-UART
  filters for CP210x / ESP32-S3 / CH9102 / CH340 are pre-registered).

## Usage

```js
import { JadeRpc } from "@emvault/jade";

const jade = await JadeRpc.fromSerial();          // call inside a click handler
await jade.unlock("testnet");                     // PIN on device → pinserver auth

// Onboarding
const fp   = await jade.getMasterFingerprintHex("testnet");
const xpub = await jade.getXpub("testnet", "m/84'/1'/0'");
await jade.registerMultisig("testnet", "ast1234", multisigFileText);

// Bitcoin signing
const signedPsbt = await jade.signPsbt("testnet", psbtBytes); // Uint8Array

await jade.close();
```

> `fromSerial()` calls `navigator.serial.requestPort()`, which the browser only
> allows from a **user gesture** — invoke it from a click/tap handler, not on
> page load.

## API

| Method | Purpose |
|---|---|
| `JadeRpc.fromSerial({ filter? })` | Open a Web Serial port and wrap it. Pass `{ filter: false }` for unlisted USB-UART chips. |
| `unlock(network)` | Auth handshake — relays the device's `http_request` to Blockstream's pinserver. |
| `getXpub(network, path)` | XPUB at a derivation path (`"m/84'/1'/0'"` or a `u32[]`). |
| `getMasterFingerprintHex(network)` | Master key fingerprint (hex). |
| `registerMultisig(network, name, descriptor)` | Register a Bitcoin multisig wallet. |
| `signPsbt(network, psbtBytes)` | Sign a Bitcoin PSBT → signed PSBT bytes. |
| `close()` | Release the serial port (idempotent). |

Also exported: `NETWORKS` (valid network strings), and helpers
`pathToU32Array`, `base58CheckDecode`, `bytesToHex`, `hexToBytes`,
`base64ToBytes`, `bytesToBase64`.

## Network names

Jade firmware expects specific identifiers:

| Chain | `network` argument |
|---|---|
| Bitcoin mainnet | `mainnet` |
| Bitcoin testnet/signet | `testnet` |
| Bitcoin regtest | `localtest` |

## Layout

```
src/index.js     — public re-exports
src/jade-rpc.js  — the JadeRpc CBOR-RPC WebSerial driver (no dependencies)
src/cbor.js      — minimal CBOR encode/decode
```

No build step: ship the ES modules as-is, or bundle with your app.
