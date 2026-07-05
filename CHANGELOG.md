# Changelog

All notable changes to `@emeraldlabs/emvault-jade` are documented here.

## 0.2.0

### Security

- **`registerMultisig` no longer silently overwrites an existing registration.**
  Jade overwrites a same-name registration whose content differs, which a
  hostile host can abuse to swap in an attacker-cosigner descriptor. The driver
  now refuses to register when a wallet of the same `name` already exists unless
  the caller passes `{ allowOverwrite: true }` explicitly.

### Added

- `getRegisteredMultisigs()` — list the device's registered multisigs, keyed by
  name (Jade summary records).
- `getRegisteredMultisig(name)` — read back a name's full descriptor, including
  per-cosigner `signers`, so callers can **verify** what the device holds
  against an expected federation descriptor (register-once + verify-stored).
- `registerMultisig(..., { allowOverwrite })` options argument.
- Type exports: `MultisigSigner`, `RegisteredMultisigSummary`,
  `RegisteredMultisigDetails`.
