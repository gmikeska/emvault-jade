# Web Serial port lifecycle: pairing `@emvault/jade` with `lwk_wasm`

`@emvault/jade` is a **Bitcoin-only** Jade driver. To also support **Liquid /
Elements** on the same page (e.g. Jade-based multisig on both chains), you pair
it with [`lwk_wasm`](https://www.npmjs.com/package/lwk_wasm) (built with the
`serial` feature — see `BUILD_LWK_FROM_SOURCE.md`). Doing so exposes a Web
Serial **port-ownership quirk** that this document explains, along with the two
patterns that make it work. These findings come from the `emvault-jade-test`
harness.

---

## The core asymmetry

The two drivers manage the serial port very differently:

| Driver | Port handling |
|---|---|
| **`@emvault/jade`** (Bitcoin, pure JS) | Opens the port on `fromSerial()`, does its work, and **cleanly closes it** on `close()` — cancels the reader, releases both locks, closes the port. Safe to open/close per operation. |
| **`lwk_wasm`** (Liquid, Rust→WASM) | Opens the port on `Jade.fromSerial()` and **holds it for the object's entire lifetime**. There is **no `disconnect`/`close`**, and `free()` does **not** release the reader/writer locks or close the port. |

**Why `lwk_wasm` holds on** (from lwk's `lwk_wasm/src/serial.rs`): its
`WebSerial` transport grabs a `ReadableStreamDefaultReader` + a
`WritableStreamDefaultWriter` — both of which **lock** the port's streams — and
never releases them. `get_jade_serial()` also *always* calls `port.open()`. So a
**second** `lwk.Jade.fromSerial()` (or an `@emvault/jade` `port.open()`) against
the same still-open port throws:

```
✗ Failed to execute 'open' on 'SerialPort': The port is already open.
```

There is no manual release hook in stock `lwk_wasm`, and the lock **cannot be
cleared from JS at all**: `port.close()` fails with *"Cannot cancel a locked
stream"*, `getReader()`/`cancel()` fail because the stream is already locked, and
`port.forget()` drops the *permission* but leaves the reader lock intact (the
reader lives in the wasm and is never `releaseLock()`'d). The only way to release
it is a **full page reload** (fresh JS realm → the browser closes the port). See
Pattern 2.

---

## Pattern 1 — reuse ONE `lwk_wasm` Jade for the whole Liquid session

Because `lwk_wasm` never reopens cleanly, **do not call `Jade.fromSerial()` more
than once.** Open it on first use and keep a single instance for *all* Liquid
work in the session (onboarding **and** signing). The port then opens exactly
once and every later call reuses it.

The mechanism is just **in-memory JS state**: two module-scoped variables hold a
live reference to the wasm `Jade` object. The open port lives *inside* that wasm
object, so as long as JS keeps the reference, the object (and its open port +
reader/writer locks) survives across button clicks.

```js
let _lwk = null;        // cached wasm module
let _liquidJade = null; // cached Jade instance (holds the open port)

// Returns the one shared Liquid session, opening the port on first use only.
async function liquidJade() {
  if (!_lwk) { _lwk = await import("/lwk/lwk_wasm.js"); await _lwk.default(); }
  if (!_liquidJade) {
    _liquidJade = await _lwk.Jade.fromSerial(_lwk.Network.testnet(), false);
  }
  return { lwk: _lwk, jade: _liquidJade };
}
```

`_liquidJade` is the session state that keeps the connection alive. Every Liquid
action pulls from `liquidJade()` instead of opening a new port:

```js
// Onboard (derive key + confidential descriptor)
const { lwk, jade } = await liquidJade();
const key    = await jade.keyoriginXpub(lwk.Bip.bip84());
const ctDesc = (await jade.wpkh()).toString();

// …later, sign a PSET over the SAME open port
const { lwk, jade } = await liquidJade();
const signed = await jade.sign(new lwk.Pset(psetB64));
```

These references persist until page reload (or an explicit reset that nulls
them — see Pattern 2). This resolves the common failure — *onboard, then sign a
PSET* — which otherwise threw "port is already open" on the second
`fromSerial()`.

---

## Pattern 2 — page reload when switching between Liquid and Bitcoin

**This is the rare case.** Within one chain you're covered by Pattern 1. But if
a single page needs to sign **both** an Elements/Liquid transaction (via
`lwk_wasm`) **and** a Bitcoin transaction (via `@emvault/jade`), the two drivers
each want to own the port — and whoever went first still holds it. Switching
directly fails with "port is already open."

**`port.forget()` does NOT fix this — a page reload is the only reliable release.**
This was verified empirically. When you leave a Liquid session and try the
Bitcoin driver, `port.forget()` clears the *permission* but **not** lwk's reader
lock: the reader was created inside the wasm and is never `releaseLock()`'d, and
a reader dropped/GC'd without `releaseLock()` leaves the stream **permanently
locked**. Chromium then re-vends the *same* `SerialPort` object (its `readable`
still locked), so the Bitcoin driver throws:

```
✗ Failed to execute 'getReader' on 'ReadableStream':
  ReadableStreamDefaultReader constructor can only accept readable streams
  that are not yet locked to a reader
```

Since the lock can't be cleared from JS (`getReader`/`cancel`/`close` all fail on
a locked stream, and `forget()` doesn't unlock it), the reliable fix is a **full
page reload**: a fresh JS realm means the browser closes the port and all locks
disappear. You only need it when a Liquid session actually holds the port —
`@emvault/jade` closes its own port cleanly, so **Bitcoin→Liquid needs nothing**;
only **Liquid→Bitcoin** requires the reload. Persist the selected chain across it
so the switch is seamless:

```js
// On chain switch: reload ONLY if a Liquid (lwk) session holds the port.
document.querySelectorAll('input[name="chain"]').forEach((r) => (r.onchange = () => {
  if (_liquidJade) {                                   // lwk holds an unreleasable lock
    sessionStorage.setItem("emvault_chain", chain());  // remember the target chain
    location.reload();                                 // fresh realm → port + locks gone
    return;
  }
  applyChain();                                        // no live Liquid session → nothing to release
}));

// After the reload, restore the chosen chain:
const saved = sessionStorage.getItem("emvault_chain");
if (saved) {
  sessionStorage.removeItem("emvault_chain");
  const radio = document.querySelector(`input[name="chain"][value="${saved}"]`);
  if (radio) radio.checked = true;
}
applyChain();
```

Notes:
- The reload is cheap here because Web Serial **permissions persist** across it:
  after reload the granted port is still in `getPorts()`, so lwk/`@emvault/jade`
  reconnects **without** a new picker.
- `port.forget()` is only useful if you *want* to drop the device permission and
  force a fresh picker — it does **not** release a locked stream, so it's not a
  substitute for the reload here.

---

## Summary

- **Bitcoin (`@emvault/jade`)** opens/closes its own port cleanly per call.
- **Liquid (`lwk_wasm`)** opens the port once and holds it for the object's life,
  with **no releasable lock** — so keep **one** `Jade` instance and reuse it
  (Pattern 1).
- To use **both** drivers on one page, a **page reload on Liquid→Bitcoin** switch
  is the only reliable release (`port.forget()` does **not** clear lwk's reader
  lock). Bitcoin→Liquid needs nothing (Pattern 2).
