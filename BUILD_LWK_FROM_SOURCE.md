# Building `lwk_wasm` from source

The emvault signing libraries — **`emvault-jade`** and **`emvault-elements`** —
pair with [LWK](https://github.com/Blockstream/lwk)'s WebAssembly build,
**`lwk_wasm`**, for the Liquid/Elements signing path (PSET). Your app loads
`lwk_wasm` at runtime, so **your app is what vendors it** — you place the built
`lwk_wasm` files in your app's static assets and the browser imports them.

Because this is a **Bitcoin custody** stack we hold to *"don't trust, verify"*:
every byte on the signing path should be one you can reproduce yourself from
upstream source, rather than a prebuilt blob you took on faith. This guide is
how you do that.

It walks you — from a machine with **nothing installed** — through building
`lwk_wasm` yourself and vendoring the result into **your app** (the app that
uses `emvault-jade` / `emvault-elements`). It is deliberately exhaustive: it is
meant to be followed successfully by a newcomer *or* a local coding model with
no prior Rust/wasm knowledge.

> **The build is validated.** Every command below was run end-to-end on a
> clean machine (no Rust, no wasm-pack) and confirmed to produce a working
> `lwk_wasm` that the `emvault-jade-test` app loads and serves. The gotchas
> called out in **bold** are real ones we hit — each one is here so you don't
> lose 20 minutes to it.

---

## 0. What you are building, and the pinning policy

- You will build the **`lwk_wasm`** crate from the LWK repository, at a
  **specific pinned commit** that this release of the emvault library
  (`emvault-jade` / `emvault-elements`) was tested against.
- **Pinning = checking out one exact commit** (a 40-character SHA), not
  "latest." A commit SHA is a fingerprint of the entire source tree at that
  moment, so checking out the same SHA gives everyone the same source. This is
  what makes the build *reproducible* and keeps the LWK API in lockstep with
  what the emvault library expects.
- **The pinned commit for this release:**

  ```
  LWK_COMMIT=82c987ceb1778b792d8eaf5e78fcc3dc7c93c4b6
  ```

  > **Maintainers:** when you cut a new emvault library release, bump this SHA
  > (and re-run the validation) so consumers build a compatible `lwk_wasm`.
  > This single line is the contract between the emvault library and LWK.

- **On hashes:** wasm output is **not** bit-for-bit reproducible across
  machines — the `wasm-opt` and `wasm-bindgen` versions bake into the bytes,
  so your `.wasm` will very likely have a *different* sha256 than ours. That
  is expected and fine. **Verification here is functional**, not
  hash-matching: the real test is "it builds, the app loads it, and the Jade
  signs a PSET." (See §6.)

---

## 1. Prerequisites

- A Unix-like shell (Linux, macOS, or WSL2 on Windows).
- `curl` and `git` installed (both are standard on macOS and most Linux).
- Internet access (to fetch the Rust toolchain, crates, and LWK source).
- ~3 GB free disk for the Rust toolchain + build artifacts.

No Rust, no Node, no wasm tooling needed up front — this guide installs them.

---

## 2. Install Rust (via `rustup`)

Run the official one-liner:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

This installs `rustup` (the toolchain manager) plus the current stable
compiler. It is **interactive** — it will print options and wait for you to
choose. Just press **1** (or Enter) for the standard installation.

> **For scripts / CI / a coding agent (non-interactive):** add `-y` so it does
> not block on the prompt:
> ```sh
> curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
> ```

Then make it the default and confirm:

```sh
rustup default stable
```

> **GOTCHA #1 — your current shell can't see `cargo` yet.** The installer adds
> `~/.cargo/bin` to your `PATH`, but only for *new* shells. In the shell you
> ran the install in, you must load it manually or you'll get
> `command not found: cargo`:
> ```sh
> . "$HOME/.cargo/env"      # for sh / bash / zsh
> ```
> (Or just open a new terminal.)

Verify:

```sh
rustc --version && cargo --version
```

You do **not** need to pick a Rust version by hand. LWK ships a
`rust-toolchain.toml` that pins the exact compiler it needs (currently
**1.85.0**); the moment you build inside the LWK directory, `rustup`
auto-downloads and selects that version for you. (This is also the source of
Gotcha #2 below — read on.)

---

## 3. Install `wasm-pack`

`wasm-pack` drives the wasm build. **Where and how you install it matters** —
this is the single most common way to lose time.

> **GOTCHA #2 — do NOT run `cargo install wasm-pack` from inside the LWK tree.**
> LWK's `rust-toolchain.toml` pins the compiler to `1.85.0` for *every* cargo
> command run in that directory — including compiling `wasm-pack` itself. But
> modern `wasm-pack` and its dependencies require rustc 1.86+, so you get a
> confusing wall of errors like:
> ```
> error: rustc 1.85.0 is not supported by the following packages:
>   cargo_metadata@0.23.1 requires rustc 1.86.0
>   time@0.3.53 requires rustc 1.88.0
>   ... (a dozen more)
> ```
> This has **nothing** to do with your build failing — it's the *pinned
> toolchain* refusing to compile a newer tool.

Pick **any one** of these (all sidestep the gotcha):

**Option A — prebuilt binary installer (recommended; no compiling at all):**
```sh
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
```

**Option B — install from *outside* the LWK directory** (e.g. from your home
dir, where the default `stable` toolchain applies):
```sh
cd ~ && cargo install wasm-pack
```

**Option C — override the pinned toolchain explicitly with `+stable`:**
```sh
cargo +stable install wasm-pack
```
(The `+stable` on the command line overrides the directory's
`rust-toolchain.toml`. You can prove it: inside the LWK dir,
`rustc --version` → `1.85.0` but `rustc +stable --version` → your stable
version.)

Verify:
```sh
wasm-pack --version
```

---

## 4. Get the LWK source at the pinned commit

```sh
git clone https://github.com/Blockstream/lwk.git
cd lwk
git checkout 82c987ceb1778b792d8eaf5e78fcc3dc7c93c4b6    # the pinned commit from §0
```

Confirm you're on it:
```sh
git rev-parse HEAD        # → 82c987ceb1778b792d8eaf5e78fcc3dc7c93c4b6
```

Optional sanity check — inside `lwk/`, the pinned toolchain should now be
active automatically:
```sh
rustc --version          # → rustc 1.85.0  (selected by lwk/rust-toolchain.toml)
```
(If `rustup` prints that it's downloading 1.85.0 the first time, that's
correct — let it.)

---

## 5. Build `lwk_wasm`

From the **`lwk/lwk_wasm`** subdirectory, run the exact command below:

```sh
cd lwk_wasm

RUSTFLAGS="--cfg=web_sys_unstable_apis" CARGO_PROFILE_RELEASE_OPT_LEVEL=z \
  wasm-pack build --target web --out-dir pkg -- --features serial
```

Every piece of this matters:

| Fragment | Why it's required |
|---|---|
| `RUSTFLAGS="--cfg=web_sys_unstable_apis"` | Enables the unstable Web Serial bindings. **Without it the `serial` feature won't compile.** |
| `CARGO_PROFILE_RELEASE_OPT_LEVEL=z` | Optimize the wasm for size (this is a release build; the result is ~10 MB vs ~14 MB unoptimized). |
| `--target web` | Emits a browser-native ES module (`lwk_wasm.js` you `import()` directly, with a default `init()`). **This is what `emvault-jade` expects** — *not* the default `bundler` target. |
| `--out-dir pkg` | Where the output goes. |
| `-- --features serial` | **Everything after `--` is passed to `cargo`.** `--features serial` compiles in the Jade-over-Web-Serial support that `emvault-jade` needs. |

> **GOTCHA #3 — put `--features` AFTER the `--`.** `--features` is a *cargo*
> flag, not a `wasm-pack` flag. If you place `--out-dir` after `--features`
> without the `--` separator, `wasm-pack` leaks `--out-dir` down into
> `cargo build`, and modern cargo renamed that to the nightly-only
> `--artifact-dir`, so you get:
> ```
> error: the `--artifact-dir` flag is unstable, and only available on the
> nightly channel of Cargo, but this is the `stable` channel
> ```
> The ordering in the command above (`--target`/`--out-dir` before `--`,
> `--features` after) is the one that works.

**Expected output:** a couple of minutes of compiling (the Rust build is fast,
~30s; the `wasm-opt` optimization pass is the slow tail, ~1–2 min), ending in:
```
[INFO]: :-) Done in 2m 18s
[INFO]: :-) Your wasm pkg is ready to publish at .../lwk_wasm/pkg.
```

Your `pkg/` now contains:
```
lwk_wasm.js            # ES-module JS glue (the thing you import)
lwk_wasm_bg.wasm       # the compiled wasm (~10 MB, release+optimized)
lwk_wasm.d.ts          # TypeScript types
lwk_wasm_bg.wasm.d.ts
package.json
```

---

## 6. Vendor it into **your app** and verify

`lwk_wasm` is loaded by the **browser at runtime**, so it is **your app** that
vendors it — not `emvault-jade` or `emvault-elements` themselves. Those
libraries are the Jade/Elements driver code; the `lwk_wasm` bytes live in your
app's static assets, served alongside your app, where the browser can
`import()` them.

Pick a directory your app serves as static files and drop the three runtime
files there. The reference `emvault-jade-test` harness uses `static/lwk/`, and
the app imports from `/lwk/…`; match whatever your app serves:

```sh
# from the lwk/lwk_wasm directory — set DEST to a static dir YOUR app serves:
DEST=/path/to/your-app/static/lwk
mkdir -p "$DEST"
cp pkg/lwk_wasm.js pkg/lwk_wasm_bg.wasm pkg/lwk_wasm.d.ts "$DEST/"
```

> This is the swap point. If you were handed a prebuilt `lwk_wasm` and don't
> want to trust it, this is where **your** freshly-built copy replaces it —
> same three files, your bytes.

The app loads it as an ES module, e.g.:
```js
const lwk = await import("/lwk/lwk_wasm.js");
await lwk.default();          // init() — instantiates the wasm
```

**Functional verification (the real test — not a hash match):**

1. **It serves.** Start your app and fetch the wasm — you should get `200` and
   the byte size of your fresh build:
   ```sh
   curl -s -o /dev/null -w "%{http_code} %{size_download}\n" \
     http://127.0.0.1:8089/lwk/lwk_wasm_bg.wasm
   ```
   (In the reference harness: `cargo run` in `emvault-jade-test`, which binds
   `http://0.0.0.0:8089` and serves `static/`.)

2. **It instantiates.** Open the app in Chrome/Edge/Brave (Web Serial is
   Chromium-only), open DevTools, and confirm `await lwk.default()` resolves
   with no error.

3. **It signs.** Plug in a Jade and run a real PSET sign through the app. A
   successful signature is the definitive proof the `serial` feature and the
   whole toolchain are correct.

> Remember: your `sha256` will differ from any copy we ship — wasm builds
> aren't byte-reproducible across environments. If steps 1–3 pass, your build
> is correct.

---

## 7. Troubleshooting quick-reference

| Symptom | Cause | Fix |
|---|---|---|
| `command not found: cargo` right after install | New `PATH` not loaded in current shell | `. "$HOME/.cargo/env"` or open a new terminal (Gotcha #1) |
| `rustc 1.85.0 is not supported by the following packages…` when installing wasm-pack | Ran `cargo install wasm-pack` inside the LWK tree; pinned toolchain can't build modern wasm-pack | Install from outside the tree, use `cargo +stable install wasm-pack`, or the binary installer (Gotcha #2) |
| `the --artifact-dir flag is unstable…` during build | `--features`/`--out-dir` ordering; `--out-dir` leaked into `cargo build` | Put cargo args after `--`: `wasm-pack build --target web --out-dir pkg -- --features serial` (Gotcha #3) |
| Build succeeds but Jade signing fails / `serial` API missing | Built without the serial support | Ensure both `RUSTFLAGS="--cfg=web_sys_unstable_apis"` **and** `-- --features serial` are present |
| App loads wasm but `import`/`init` behaves oddly | Wrong wasm-pack target | Rebuild with `--target web` (not the default `bundler`) |
| `rustup` keeps downloading a toolchain | First build in `lwk/` fetching the pinned 1.85.0 | Expected once; let it finish |

---

## Appendix — the whole thing, start to finish

```sh
# 1. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
rustup default stable

# 2. wasm-pack (binary installer — avoids the pinned-toolchain trap)
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# 3. LWK at the pinned commit
git clone https://github.com/Blockstream/lwk.git
cd lwk
git checkout 82c987ceb1778b792d8eaf5e78fcc3dc7c93c4b6

# 4. Build lwk_wasm (release, web target, Jade serial support)
cd lwk_wasm
RUSTFLAGS="--cfg=web_sys_unstable_apis" CARGO_PROFILE_RELEASE_OPT_LEVEL=z \
  wasm-pack build --target web --out-dir pkg -- --features serial

# 5. Vendor into your app
cp pkg/lwk_wasm.js pkg/lwk_wasm_bg.wasm pkg/lwk_wasm.d.ts /path/to/your-app/static/lwk/
```
