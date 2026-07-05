// Type declarations for @emeraldlabs/emvault-jade — a dependency-free Blockstream Jade
// WebSerial (USB) driver for the browser. Bitcoin PSBT signing + onboarding.

/** Canonical Jade Bitcoin network identifiers (see `NETWORKS`). */
export type Network = "mainnet" | "testnet" | "localtest";

/** The frozen list of valid `network` strings Jade firmware accepts. */
export const NETWORKS: readonly Network[];

/** A BIP-32 path as a string (`"m/84'/1'/0'"`) or an array of u32 indices. */
export type Bip32Path = string | number[];

export class JadeRpc {
  /** Opt-in diagnostic logging (default `false`). Set `true` to troubleshoot. */
  static debug: boolean;

  /**
   * Open a Web Serial port and wrap it in a `JadeRpc`. Surfaces the browser's
   * port picker, so it must be called from within a user gesture (a click/tap
   * handler). Pass `{ filter: false }` for unlisted USB-UART chips.
   */
  static fromSerial(options?: { filter?: boolean }): Promise<JadeRpc>;

  /** Wrap an already-open Web Serial `SerialPort`. Prefer `fromSerial()`. */
  constructor(port: unknown);

  /**
   * Trigger Jade's auth handshake against Blockstream's pinserver (prompts for
   * the PIN on the device). Rejects with a clear error if the pinserver is
   * unreachable (network/CORS) or declines.
   */
  unlock(network: Network): Promise<void>;

  /** Fetch the XPUB at `path`. `network` must match the `unlock` network. */
  getXpub(network: Network, path: Bip32Path): Promise<string>;

  /** Master key fingerprint as a lowercase hex string. */
  getMasterFingerprintHex(network: Network): Promise<string>;

  /**
   * Register a Bitcoin multisig wallet on the device. Accepts a Coldcard/
   * Sparrow-style multisig-file `string` or a Jade descriptor `object`. The
   * user confirms on the Jade screen. `name` must be 1..15 ASCII chars.
   *
   * Refuses to overwrite an existing same-name registration unless
   * `{ allowOverwrite: true }` is passed — a hostile host can otherwise
   * silently swap the descriptor. Prefer register-once + `getRegisteredMultisig`.
   */
  registerMultisig(
    network: Network,
    name: string,
    fileOrDescriptor: string | object,
    options?: { allowOverwrite?: boolean },
  ): Promise<void>;

  /**
   * List multisig wallets registered on the device, keyed by name. Values are
   * Jade summary records. Device-global, not network-scoped.
   */
  getRegisteredMultisigs(): Promise<Record<string, RegisteredMultisigSummary>>;

  /**
   * Read back the full registration for `name` — descriptor plus per-cosigner
   * `signers` — so a caller can verify what the device holds against an
   * expected federation descriptor. `name` must be 1..15 ASCII chars.
   */
  getRegisteredMultisig(name: string): Promise<RegisteredMultisigDetails>;

  /** Sign a Bitcoin PSBT (`Uint8Array` in → signed `Uint8Array` out). */
  signPsbt(network: Network, psbtBytes: Uint8Array): Promise<Uint8Array>;

  /** Release the WebSerial port. Idempotent. */
  close(): Promise<void>;
}

/** One cosigner in a registered multisig descriptor (read-back). */
export interface MultisigSigner {
  /** Master fingerprint bytes. */
  fingerprint: Uint8Array;
  /** Derivation from the master node (m) to the xpub, as u32 indices. */
  derivation: number[];
  /** The cosigner xpub. */
  xpub: string;
  /** Derivation from the xpub to the signer, as u32 indices. */
  path: number[];
}

/** Jade's per-name summary from `getRegisteredMultisigs`. */
export interface RegisteredMultisigSummary {
  variant: string;
  sorted: boolean;
  threshold: number;
  num_signers: number;
  master_blinding_key?: Uint8Array;
}

/** Full descriptor read back by `getRegisteredMultisig`. */
export interface RegisteredMultisigDetails {
  multisig_name: string;
  descriptor: {
    variant: string;
    sorted: boolean;
    threshold: number;
    master_blinding_key?: Uint8Array;
    signers: MultisigSigner[];
  };
}

/** Parse a BIP-32 path into a flat array of u32 indices (hardened bit set). */
export function pathToU32Array(path: Bip32Path): number[];

/** Decode a base58check string to its payload; throws on checksum mismatch. */
export function base58CheckDecode(s: string): Uint8Array;

export function bytesToHex(bytes: Uint8Array): string;
export function hexToBytes(hex: string): Uint8Array;
export function base64ToBytes(b64: string): Uint8Array;
export function bytesToBase64(bytes: Uint8Array): string;
