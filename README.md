# @emvault/jade

A **dependency-free Blockstream Jade driver for the browser**, speaking Jade's
CBOR-RPC protocol directly over the **Web Serial API** (USB).

It exists because `lwk_wasm`'s `Jade` only exposes `sign(pset)` for Liquid — it
has no Bitcoin `sign_psbt` entry point and no xpub/registration surface. This
driver covers the full device workflow for **both Bitcoin (PSBT) and
Liquid/Elements (PSET)**, which is the connection method that unlocks Liquid
*and* Bitcoin mainnet alike.

## Requirements

- A **Chromium-based desktop browser** (Web Serial API: Chrome/Edge/Brave/Arc).
  The driver throws a clear error elsewhere.
- A Blockstream **Jade** (v1, Jade Plus, or a DIY ESP32 build — USB-UART
  filters for CP210x / ESP32-S3 / CH9102 / CH340 are pre-registered).

## Usage

```js
import { JadeRpc } from "@emvault/jade";

const jade = await JadeRpc.fromSerial();          // prompts for the serial port
await jade.unlock("testnet-liquid");              // PIN on device → pinserver auth

// Onboarding
const fp   = await jade.getMasterFingerprintHex("testnet-liquid");
const xpub = await jade.getXpub("testnet-liquid", "m/84'/1'/0'");

// Liquid signing
await jade.registerLiquidMultisig("testnet-liquid", "astL1234", descriptor);
const signedPset = await jade.signPset("testnet-liquid", psetBytes); // Uint8Array

// Bitcoin signing
const signedPsbt = await jade.signPsbt("testnet", psbtBytes);

await jade.close();
```

## API

| Method | Purpose |
|---|---|
| `JadeRpc.fromSerial({ filter? })` | Open a Web Serial port and wrap it. Pass `{ filter: false }` for unlisted USB-UART chips. |
| `unlock(network)` | Auth handshake — relays the device's `http_request` to Blockstream's pinserver. |
| `getXpub(network, path)` | XPUB at a derivation path (`"m/84'/1'/0'"` or a `u32[]`). |
| `getMasterFingerprintHex(network)` | Master key fingerprint (hex). |
| `registerMultisig(network, name, descriptor)` | Register a Bitcoin multisig wallet. |
| `registerLiquidMultisig(network, name, descriptor)` | Register a Liquid multisig (with `master_blinding_key`). |
| `signPsbt(network, psbtBytes)` | Sign a Bitcoin PSBT → signed PSBT bytes. |
| `signPset(network, psetBytes)` | Sign a Liquid PSET → signed PSET bytes. |
| `close()` | Release the serial port (idempotent). |

Helpers also exported: `pathToU32Array`, `base58CheckDecode`, `bytesToHex`,
`hexToBytes`, `base64ToBytes`, `bytesToBase64`.

## Network names

Jade firmware expects specific identifiers:

| Chain | `network` argument |
|---|---|
| Bitcoin mainnet | `mainnet` |
| Bitcoin testnet/signet | `testnet` |
| Bitcoin regtest | `localtest` |
| Liquid mainnet | `liquid` |
| **Liquid testnet** | `testnet-liquid` |
| Elements regtest | `localtest-liquid` |

## Layout

```
src/index.js     — public re-exports
src/jade-rpc.js  — the JadeRpc CBOR-RPC WebSerial driver (no dependencies)
src/cbor.js      — minimal CBOR encode/decode
```

No build step: ship the ES modules as-is, or bundle with your app.

> ⚠️ Liquid (PSET) is **only** available over USB/Serial — not over Jade's QR
> air-gap mode (which is Bitcoin-only). That's the whole reason this driver
> exists.
