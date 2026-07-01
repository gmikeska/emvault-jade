// CBOR encoder/decoder tests. Run headlessly: `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decode } from "../src/cbor.js";

const roundtrip = (v) => decode(encode(v)).value;

test("round-trips unsigned integers across head sizes", () => {
  for (const n of [0, 1, 23, 24, 255, 256, 65535, 65536, 1_000_000, 0xffffffff, 2 ** 40]) {
    assert.equal(roundtrip(n), n, `uint ${n}`);
  }
});

test("round-trips negative integers", () => {
  for (const n of [-1, -24, -256, -1_000_000]) {
    assert.equal(roundtrip(n), n, `negint ${n}`);
  }
});

test("round-trips text strings (incl. UTF-8)", () => {
  for (const s of ["", "hello", "sign_psbt", "üñîçödé"]) {
    assert.equal(roundtrip(s), s);
  }
});

test("round-trips byte strings as Uint8Array", () => {
  const bytes = new Uint8Array([0, 1, 2, 255, 128]);
  const out = roundtrip(bytes);
  assert.ok(out instanceof Uint8Array);
  assert.deepEqual(out, bytes);
});

test("round-trips booleans and null", () => {
  assert.equal(roundtrip(true), true);
  assert.equal(roundtrip(false), false);
  assert.equal(roundtrip(null), null);
});

test("round-trips arrays and nested maps (a Jade-shaped request)", () => {
  const req = {
    id: "m1",
    method: "get_xpub",
    params: { network: "testnet", path: [2147483732, 2147483649, 2147483648] },
  };
  assert.deepEqual(roundtrip(req), req);
});

test("decode reports the number of bytes consumed", () => {
  const buf = encode({ id: "m1", method: "ping" });
  const { length } = decode(buf);
  assert.equal(length, buf.length);
});

test("decode throws RangeError on an incomplete item (caller should buffer more)", () => {
  const full = encode({ id: "m1", method: "sign_psbt", params: { network: "testnet" } });
  const truncated = full.subarray(0, full.length - 3);
  assert.throws(() => decode(truncated), RangeError);
});

test("two back-to-back items decode one at a time by consumed length", () => {
  const a = encode({ id: "m1", result: true });
  const b = encode({ id: "m2", result: 7 });
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a, 0);
  joined.set(b, a.length);
  const first = decode(joined);
  assert.deepEqual(first.value, { id: "m1", result: true });
  const second = decode(joined.subarray(first.length));
  assert.deepEqual(second.value, { id: "m2", result: 7 });
});
