// Pure-helper tests: path parsing, base58check, hex, base64. `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pathToU32Array,
  base58CheckDecode,
  bytesToHex,
  hexToBytes,
  base64ToBytes,
  bytesToBase64,
  NETWORKS,
} from "../src/index.js";

const H = 0x80000000;

test("pathToU32Array parses a hardened BIP-84 path", () => {
  assert.deepEqual(pathToU32Array("m/84'/1'/0'"), [H + 84, H + 1, H + 0]);
});

test("pathToU32Array accepts ', h and H as hardened markers", () => {
  assert.deepEqual(pathToU32Array("m/0'"), [H]);
  assert.deepEqual(pathToU32Array("m/0h"), [H]);
  assert.deepEqual(pathToU32Array("m/0H"), [H]);
});

test("pathToU32Array treats m, empty, and slashes as the empty path", () => {
  for (const p of ["m", "m/", "", "/"]) assert.deepEqual(pathToU32Array(p), []);
});

test("pathToU32Array passes arrays through as u32", () => {
  assert.deepEqual(pathToU32Array([0, 1, H + 5]), [0, 1, H + 5]);
});

test("pathToU32Array rejects non-numeric and out-of-range components", () => {
  assert.throws(() => pathToU32Array("m/abc"), RangeError);
  assert.throws(() => pathToU32Array("m/-1"), RangeError);
  assert.throws(() => pathToU32Array(`m/${H}`), RangeError); // index must be < 2^31
});

test("base58CheckDecode returns the 78-byte BIP-32 payload (checksum stripped)", () => {
  // A real testnet extended public key (tpub → version bytes 0x043587CF).
  const tpub =
    "tpubD6NzVbkrYhZ4Was8nwnZi7eiWUNJq2LFpPSCMQLioUfUtT1e72GkRbmVeRAZc26j5MRUz2hRLsaVHJfs6L7ppNfLUrm9btQTuaEsLrT7D87";
  const payload = base58CheckDecode(tpub);
  assert.equal(payload.length, 78);
  assert.deepEqual([...payload.subarray(0, 4)], [0x04, 0x35, 0x87, 0xcf]);
});

test("base58CheckDecode rejects invalid base58 characters", () => {
  assert.throws(() => base58CheckDecode("0OIl_not_base58"), /invalid character/);
});

test("bytesToHex / hexToBytes round-trip", () => {
  const bytes = new Uint8Array([0, 1, 15, 16, 255, 128]);
  assert.equal(bytesToHex(bytes), "00010f10ff80");
  assert.deepEqual(hexToBytes("00010f10ff80"), bytes);
});

test("hexToBytes rejects odd-length and non-hex input", () => {
  assert.throws(() => hexToBytes("abc"));
  assert.throws(() => hexToBytes("zz"));
});

test("base64ToBytes / bytesToBase64 round-trip (and accept URL-safe)", () => {
  const bytes = new Uint8Array([251, 255, 0, 62, 63]);
  const b64 = bytesToBase64(bytes);
  assert.deepEqual(base64ToBytes(b64), bytes);
  // URL-safe variant (-/_ instead of +//) decodes the same.
  const urlSafe = b64.replace(/\+/g, "-").replace(/\//g, "_");
  assert.deepEqual(base64ToBytes(urlSafe), bytes);
});

test("NETWORKS is the frozen Bitcoin-only set", () => {
  assert.deepEqual([...NETWORKS], ["mainnet", "testnet", "localtest"]);
  assert.ok(Object.isFrozen(NETWORKS));
});
