// JadeRpc driver tests against a mock Web Serial port — no hardware, no browser.
// Covers network validation, the CBOR request/reply round-trip, the `seqlen`
// multi-chunk reassembly for sign_psbt, and close() idempotency. `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JadeRpc } from "../src/index.js";
import { encode, decode } from "../src/cbor.js";

// A mock SerialPort. `onWrite(bytes, respond)` is invoked for every request the
// driver writes; call `respond(frameBytes)` to feed a reply back through the
// reader (as the device would). Enough surface for JadeRpc's constructor
// (getReader/getWriter), read loop, and close().
function makeMockPort() {
  const readQueue = [];
  let readResolve = null;
  let cancelled = false;
  let onWrite = null;

  const pushToReader = (bytes) => {
    if (readResolve) { const r = readResolve; readResolve = null; r({ value: bytes, done: false }); }
    else readQueue.push(bytes);
  };

  const reader = {
    read() {
      if (cancelled) return Promise.resolve({ value: undefined, done: true });
      if (readQueue.length) return Promise.resolve({ value: readQueue.shift(), done: false });
      return new Promise((res) => { readResolve = res; });
    },
    cancel() {
      cancelled = true;
      if (readResolve) { const r = readResolve; readResolve = null; r({ value: undefined, done: true }); }
      return Promise.resolve();
    },
    releaseLock() {},
  };

  const written = [];
  const writer = {
    async write(bytes) { written.push(bytes); if (onWrite) onWrite(bytes, pushToReader); },
    async close() {},
    releaseLock() {},
  };

  return {
    readable: { getReader: () => reader },
    writable: { getWriter: () => writer },
    async open() {},
    async close() {},
    // test hooks:
    onWrite(fn) { onWrite = fn; },
    written,
  };
}

test("rejects an unknown network before touching the wire", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  await assert.rejects(() => jade.getXpub("regtest", "m/0"), /unknown network/i);
  await assert.rejects(() => jade.signPsbt("liquid", new Uint8Array([1])), /unknown network/i);
  assert.equal(port.written.length, 0, "nothing should have been written");
  await jade.close();
});

test("getXpub round-trips a CBOR request/reply by id", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  port.onWrite((bytes, respond) => {
    const { value: req } = decode(bytes);
    if (req.method === "get_xpub") respond(encode({ id: req.id, result: "tpubDEADBEEF" }));
  });
  const xpub = await jade.getXpub("testnet", "m/84'/1'/0'");
  assert.equal(xpub, "tpubDEADBEEF");
  await jade.close();
});

test("signPsbt reassembles multi-chunk seqlen responses in order", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  const chunk1 = new Uint8Array([1, 2, 3]);
  const chunk2 = new Uint8Array([4, 5, 6]);
  const chunk3 = new Uint8Array([7, 8]);
  port.onWrite((bytes, respond) => {
    const { value: req } = decode(bytes);
    if (req.method === "sign_psbt") {
      respond(encode({ id: req.id, result: chunk1, seqlen: 3 }));
    } else if (req.method === "get_extended_data") {
      const next = req.params.seqnum === 2 ? chunk2 : chunk3;
      respond(encode({ id: req.id, result: next }));
    }
  });
  const signed = await jade.signPsbt("testnet", new Uint8Array([9, 9]));
  assert.deepEqual(signed, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  await jade.close();
});

test("signPsbt returns the single frame directly when seqlen <= 1", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  const whole = new Uint8Array([10, 20, 30]);
  port.onWrite((bytes, respond) => {
    const { value: req } = decode(bytes);
    if (req.method === "sign_psbt") respond(encode({ id: req.id, result: whole, seqlen: 1 }));
  });
  assert.deepEqual(await jade.signPsbt("mainnet", new Uint8Array([0])), whole);
  await jade.close();
});

test("a Jade error reply rejects the pending call", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  port.onWrite((bytes, respond) => {
    const { value: req } = decode(bytes);
    respond(encode({ id: req.id, error: { message: "User declined" } }));
  });
  await assert.rejects(() => jade.getXpub("testnet", "m/0"), /User declined/);
  await jade.close();
});

test("signPsbt requires a Uint8Array", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  await assert.rejects(() => jade.signPsbt("testnet", "not-bytes"), /Uint8Array/);
  await jade.close();
});

test("getRegisteredMultisigs returns the device's name→summary map", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  const summary = { "Fed-v1": { variant: "wsh(multi(k))", sorted: true, threshold: 2, num_signers: 3 } };
  port.onWrite((bytes, respond) => {
    const { value: req } = decode(bytes);
    if (req.method === "get_registered_multisigs") respond(encode({ id: req.id, result: summary }));
  });
  assert.deepEqual(await jade.getRegisteredMultisigs(), summary);
  await jade.close();
});

test("getRegisteredMultisig reads back a name's full descriptor", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  const details = {
    multisig_name: "Fed-v1",
    descriptor: { variant: "wsh(multi(k))", sorted: true, threshold: 2, signers: [] },
  };
  port.onWrite((bytes, respond) => {
    const { value: req } = decode(bytes);
    if (req.method === "get_registered_multisig") {
      assert.equal(req.params.multisig_name, "Fed-v1");
      respond(encode({ id: req.id, result: details }));
    }
  });
  assert.deepEqual(await jade.getRegisteredMultisig("Fed-v1"), details);
  await jade.close();
});

test("getRegisteredMultisig rejects an out-of-range name before the wire", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  await assert.rejects(() => jade.getRegisteredMultisig(""), /1\.\.15 ASCII/);
  await assert.rejects(() => jade.getRegisteredMultisig("x".repeat(16)), /1\.\.15 ASCII/);
  assert.equal(port.written.length, 0, "nothing should have been written");
  await jade.close();
});

test("registerMultisig registers when no same-name wallet exists", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  let registered = false;
  port.onWrite((bytes, respond) => {
    const { value: req } = decode(bytes);
    if (req.method === "get_registered_multisigs") respond(encode({ id: req.id, result: {} }));
    else if (req.method === "register_multisig") { registered = true; respond(encode({ id: req.id, result: true })); }
  });
  await jade.registerMultisig("testnet", "Fed-v1", { variant: "wsh(multi(k))", sorted: true, threshold: 2, signers: [] });
  assert.ok(registered, "register_multisig should have been sent");
  await jade.close();
});

test("registerMultisig refuses to silently overwrite an existing same-name wallet", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  let registerSent = false;
  port.onWrite((bytes, respond) => {
    const { value: req } = decode(bytes);
    if (req.method === "get_registered_multisigs") respond(encode({ id: req.id, result: { "Fed-v1": { threshold: 2 } } }));
    else if (req.method === "register_multisig") { registerSent = true; respond(encode({ id: req.id, result: true })); }
  });
  await assert.rejects(
    () => jade.registerMultisig("testnet", "Fed-v1", { variant: "wsh(multi(k))", sorted: true, threshold: 2, signers: [] }),
    /already registered/,
  );
  assert.equal(registerSent, false, "must not send register_multisig on a refused overwrite");
  await jade.close();
});

test("registerMultisig overwrites an existing wallet when allowOverwrite is set", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  let registerSent = false;
  let readBack = false;
  port.onWrite((bytes, respond) => {
    const { value: req } = decode(bytes);
    if (req.method === "get_registered_multisigs") { readBack = true; respond(encode({ id: req.id, result: { "Fed-v1": { threshold: 2 } } })); }
    else if (req.method === "register_multisig") { registerSent = true; respond(encode({ id: req.id, result: true })); }
  });
  await jade.registerMultisig(
    "testnet", "Fed-v1", { variant: "wsh(multi(k))", sorted: true, threshold: 2, signers: [] },
    { allowOverwrite: true },
  );
  assert.ok(registerSent, "register_multisig should have been sent");
  assert.equal(readBack, false, "allowOverwrite should skip the existence read-back");
  await jade.close();
});

test("registerMultisig requires a string or object descriptor", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  await assert.rejects(() => jade.registerMultisig("testnet", "Fed-v1", 123, { allowOverwrite: true }), /string or object/);
  await jade.close();
});

test("close() is idempotent", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  await jade.close();
  await jade.close(); // must not throw
});

test("close() rejects an in-flight call instead of hanging", async () => {
  const port = makeMockPort();
  const jade = new JadeRpc(port);
  // No onWrite handler → the device never replies; the call stays pending.
  const pending = jade.getXpub("testnet", "m/0");
  await jade.close();
  await assert.rejects(() => pending, /port closed/);
});

