# @emeraldlabs/emvault-jade

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

## Install

```sh
npm install @emeraldlabs/emvault-jade
```

Zero runtime dependencies; ships as ES modules with TypeScript types. Runs in the
browser (Web Serial). No build step required.

## Usage

```js
import { JadeRpc } from "@emeraldlabs/emvault-jade";

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

> **Pinserver / CORS:** `unlock()` performs Jade's PIN handshake by POSTing from
> the browser to Blockstream's pinserver (`https://j8d.io` or
> `jadepin.blockstream.com`). Your app's origin must be allowed to reach it — if
> a browser CORS policy or network filter blocks the request, `unlock()` rejects
> with a clear *"could not reach the pinserver … (network error or CORS block)"*
> message (distinct from a pinserver that answers with an error status).

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

The driver is silent by default. For troubleshooting, set `JadeRpc.debug = true`
to surface read-loop/decode diagnostics on the console.

## Network names

Jade firmware expects specific identifiers:

| Chain | `network` argument |
|---|---|
| Bitcoin mainnet | `mainnet` |
| Bitcoin testnet/signet | `testnet` |
| Bitcoin regtest | `localtest` |

## Liquid / Elements support (pair with `lwk_wasm`)

`@emeraldlabs/emvault-jade` is Bitcoin-only. To add **Liquid/Elements** (PSET signing and
Liquid onboarding) on the same page, pair it with
[`lwk_wasm`](https://www.npmjs.com/package/lwk_wasm) (built with the `serial`
feature). Two companion guides in this repo cover that:

- **[BUILD_LWK_FROM_SOURCE.md](https://github.com/gmikeska/emvault-jade/blob/master/BUILD_LWK_FROM_SOURCE.md)**
  — how to **build and install `lwk_wasm`** yourself (Rust + `wasm-pack`
  toolchain, pinned commit, vendoring the output into your app), for Elements support. (As of June 1st, 2026, the version of lwk_wasm on npm doesn't come with USB support so Jade functionality requres a compiled library)
- **[WEBSERIAL_PORT_LIFECYCLE.md](https://github.com/gmikeska/emvault-jade/blob/master/WEBSERIAL_PORT_LIFECYCLE.md)**
  — how to use **`@emeraldlabs/emvault-jade` alongside `lwk_wasm`** for Elements support:
  managing the shared Web Serial port between the two drivers (single-session reuse, and the page reload needed when switching Liquid ↔ Bitcoin).

## Layout

```
src/index.js     — public re-exports
src/jade-rpc.js  — the JadeRpc CBOR-RPC WebSerial driver (no dependencies)
src/cbor.js      — minimal CBOR encode/decode
```
