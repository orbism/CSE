# Cubic Symmetry Engine

512 generative works. Each token is one cubic equation, drawn as the thing it
actually is: the three roots become the primary bodies, the discriminant decides
whether they separate, fracture or merge, and the cube-root branch rotates the
whole ω-triad by a third of a turn.

Rendered in WebGL, then resolved to a character grid.

Based on the derivation at <https://hidden-phenomena.com/articles/cubic>,
prompted by <https://x.com/VitalikButerin/status/2081776660941029636>.

---

## 1. Test it locally

```bash
pnpm setup     # installs deps, chromium and the foundry libs — once
pnpm dev       # builds the art, deploys, mints a few, opens the site
```

Then open <http://localhost:3000>.

`pnpm dev` is self-bootstrapping. On a clean checkout it builds the art bundle,
starts anvil, deploys the contract, mints a dozen Forms from random seeds the
way the site does (each one approved with a signature from the deployer, who is
the local approver), renders their covers with the mint watcher, and starts the
site — all wired together. It needs no API keys and no `.env`. `CSE_DEV_TOKENS`
sets how many it mints.

It writes `apps/web/.env.local` for you, and also prints the same block so you
can copy it straight out of the terminal:

```
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_CONTRACT_ADDRESS=0xe7f1…0512
NEXT_PUBLIC_MASTER_SEED=CUBIC-SYMMETRY-ENGINE   # must match the collection's seed
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545       # anvil has no key, skip /api/rpc
# ALCHEMY_API_KEY=                              # not needed against anvil
# ALCHEMY_NETWORK=
SIGNER_PRIVATE_KEY=0xac09…ff80                  # the approver; locally the anvil key
NEXT_PUBLIC_COVERS_BASE=http://127.0.0.1:8788/covers/
NEXT_PUBLIC_LOCAL_ASSETS=http://127.0.0.1:8788
```

The block is generated from a single definition in `scripts/lib/web-env.mjs`,
shared with `pnpm deploy`, and cross-checked against `apps/web/.env.example` —
a key documented there but not emitted is a warning, not a silent omission.

The mint opens LIVE. To actually mint, import this key into your **browser
wallet** and add a network for `http://127.0.0.1:8545`, chain ID `31337`:

```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

`Ctrl-C` stops everything.

### The two private keys are unrelated

This trips people up, so plainly:

| | anvil key (printed by `pnpm dev`) | `DEPLOYER_PRIVATE_KEY` in `.env` |
|---|---|---|
| What | anvil's public test account #0 | your real, funded deployer |
| Goes where | your browser wallet, to click Mint locally | root `.env`, nowhere else |
| Read by | nothing — it is hardcoded in `dev-local.mjs` | `pnpm deploy`, for Sepolia/mainnet only |
| Secret? | No. Every anvil user has it. Never fund it. | Yes. |

`pnpm dev` never reads `DEPLOYER_PRIVATE_KEY`, and a local deploy rehearsal
(`pnpm deploy` → Localhost) always uses the anvil account regardless of what is
in `.env`, since your real key has no balance on a fresh anvil.

| | |
|---|---|
| `pnpm dev` | full local stack, mint open |
| `pnpm dev:closed` | same, but mint CLOSED — the panel browses instead of minting |
| `CSE_DEV_TOKENS=60 pnpm dev` | 60 extra Forms on top of the one-per-archetype cover |
| `pnpm test` | core maths + 36 contract tests |

### Ports and leftovers

`pnpm dev` is safe to re-run. If a previous run was killed rather than
`Ctrl-C`'d it leaves anvil behind, and the script reuses that node instead of
fighting it for the port — chain state carries over, and `Ctrl-C` will not stop
a node it did not start. If anything else is on 8788 or 3000 it moves the asset
server and the site to the next free port and prints where they went, so two
stacks can run side by side.

To start genuinely fresh:

```bash
pkill -f anvil; pkill -f serve-assets; pkill -f next-server
```

The preview collection is small and low-resolution on purpose. The real run is
`pnpm generate` (below) and takes hours.

---

## 2. Deploy to Sepolia

Create `.env` from the template and fill in three values:

```bash
cp .env.example .env
```

```
DEPLOYER_PRIVATE_KEY=0x…     # a dedicated deployer key
ALCHEMY_API_KEY=…            # all RPC goes through Alchemy
ETHERSCAN_API_KEY=…          # for source verification
```

Fund the deployer from a Sepolia faucet, then:

```bash
pnpm deploy
```

Pick **Sepolia**. The script walks the whole thing:

1. **Preflight** — checks the RPC responds, the chain ID matches, the deployer
   has ETH, and foundry libs are installed.
2. **Metadata** — the fallback base URI (a placeholder is fine; on-chain
   metadata takes over once the renderer is deployed), the on-chain page from
   `out/onchain` and the cover base, and the approver address (`CSE_SIGNER`).
3. **Parameters** — owner, price, royalty. Defaults come from `.env`.
4. **Deploy** — implementation + ERC1967 proxy, initialised in one transaction,
   then the renderer with the engine on chain, wired in.
5. **Verify** — submits both contracts to Etherscan, retrying standalone with
   re-encoded constructor args if the inline pass does not confirm. It prints a
   copy-pasteable command if verification still fails.
6. **Post-deploy** — optionally claim the 11 reserved tokens and open the mint.
7. **Record** — writes `deployments/sepolia.json` and prints the environment
   variables to set on the site, in the same copy-pasteable form as `pnpm dev`
   (with `ALCHEMY_API_KEY` live and `NEXT_PUBLIC_RPC_URL` commented out, since
   on a real network the browser goes through `/api/rpc`).

Rehearse the exact same flow for free first by picking **Localhost** with
`pnpm dev` running in another terminal.

> After verifying, Etherscan may not show read/write tabs until you mark the
> address as a proxy at `sepolia.etherscan.io/proxyContractChecker`. The script
> prints the link.

Non-interactive:

```bash
pnpm deploy -- --network sepolia --yes
```

---

## 3. Deploy live

The real sequence, in order. Do not skip the Sepolia rehearsal.

```bash
# 1. Fix the seed. Changing it changes every token. Never touch it again.
#    CSE_MASTER_SEED in .env

# 2. Generate the real collection (512 tokens at 3000px — hours, not minutes)
pnpm build
pnpm generate

# 3. Pin to 4EVERLAND. Order matters: art -> images -> metadata,
#    because the metadata embeds the first two CIDs.
pnpm upload -- --dry-run    # shows what would be sent
pnpm upload                 # prints the baseURI when done

# 4. Deploy
pnpm deploy                 # pick Mainnet, type "mainnet" to confirm
```

`pnpm deploy` on mainnet requires typing `mainnet` in full and warns if the base
URI is still a placeholder.

Then set the printed variables on the site host (Vercel → Environment
Variables) and deploy the site. `ALCHEMY_API_KEY` is server-side only — the
browser talks to `/api/rpc`, which proxies to Alchemy and forwards read methods
only, so the key never ships in the bundle.

Open the mint when you are ready:

```bash
cd packages/contracts
CSE_PROXY=0x… CSE_MINT_STATE=1 PRIVATE_KEY=0x… \
  forge script script/Admin.s.sol:SetMintState --rpc-url "$RPC" --broadcast
```

The site polls contract state, so the demo box becomes the mint box on its own.
`Admin.s.sol` also holds `SetBaseURI`, `SetPrice`, `ReserveMint`, `Withdraw`
and `Upgrade`.

---

## Layout

```
packages/core/        maths + trait derivation + PRNG   (isomorphic TS, zero deps)
packages/art/         three.js scene + ASCII pass       (vite -> one self-contained file)
packages/generator/   derive -> uniqueness -> render -> metadata -> pin
packages/contracts/   foundry, UUPS ERC-721
apps/web/             next.js one-pager
scripts/              dev-local.mjs, deploy.mjs, serve-assets.mjs
deployments/          one JSON record per network
out/                  generated artefacts (gitignored)
```

## The mathematics

Given `x³ + ax² + bx + c`, substitute `y = x + a/3` to reach the depressed cubic
`y³ + py + q`. The article's central object is `D = (α−β)(β−γ)(γ−α)`, asymmetric
under swaps but with a fully symmetric square:

```
Δ = D² = −4p³ − 27q²
ω = (−1 + i√3) / 2
A³ = −27q/2 − (3i√3/2)·D
α = A/3 − p/A     β = ω²A/3 − ωp/A     γ = ωA/3 − ω²p/A
```

`A` is the Lagrange resolvent. Replacing `A` with `ωA` sends α → γ → β: the same
root *set*, relabelled. That residual freedom — the choice left after fixing a
square root and a cube root — is the **Phase** trait. It is a genuine degree of
freedom each token exercises, not a quantity read off the geometry.

`packages/core/test` checks the solver against the article's worked example,
`x³+6x²+9x+3 = 0`, whose roots are `2cos(2π/9)`, `2cos(8π/9)`, `2cos(4π/9)`.

### Traits

| Axis | Derivation |
|---|---|
| Structure | 22 archetypes; discriminant class picks a family, \|c\| and phase choose within it |
| Root State | `3 Real Distinct` / `1 Real 2 Complex` / `Double Root` / `Triple Root` |
| Symmetry | permutation parity × phase |
| Discriminant Class | `Separated` (Δ>0) / `Fractured` (Δ<0) / `Merged` (Δ≈0) |
| Phase | which cube root of `A³` the token adopts |
| Palette | `arg(A)` and the discriminant band |
| Energy | largest root modulus — the scale the unit-disc normalisation discards |
| Feedback | distance between the two nearest roots; drives the render feeding back on itself |

Between 2 and 8 are surfaced per token — axes at their default value are
dropped. All eight always exist on the token and are what the gallery filters on.

### What the maths decides, and what it does not

Worth being precise, because it is easy to overclaim.

**The maths decides**, and is verifiably drawn: the coefficients, the depressed
form, the discriminant and its sign, the three roots as points in ℂ, the
resolvent `A` and its branch. Root positions place the primary bodies; Δ's sign
selects the family; the branch rotates the ω-triad by a third of a turn; |a|,
|b|, |c| set framing, glyph density and curvature. The solver is checked against
the article's worked example, and across the whole supply the worst residual
|p(root)| is **1.3 × 10⁻⁷** — the roots really do satisfy their equations.

**The maths does not decide** that Δ<0 should look like a knot rather than a
tower. The 22 archetypes are an authored vocabulary; the equation chooses
between them and drives every parameter inside them, but the vocabulary itself
is a design decision, not a theorem. Nothing is loaded from a model file —
every vertex is computed at runtime — though the primitives being composed
(torus knot, icosahedron, cone, lathe) are three.js parametric generators.

Family sizes follow class frequency, which is itself a fact about random real
cubics. Sizing them 8 / 10 / 4 across the 22 archetypes caps the commonest form
at 9.0% and leaves nothing below 11 Forms. Measured over the finished supply:

    Knot 46  Exploded 45  Tessellation 34  Grid 32  Weave 32  Cascade 29
    Lattice 28  Arbor 25  Tower 24  Bloom 24  Spiral 22  Orbital 22
    Rift 21  Strata 19  Labyrinth 16  Prism 16  Radial 15  Shell 15
    Void 12  Vessel 12  Aperture 12  Fold 11

Twelve is the ceiling on a family, and it is arithmetic rather than taste:
`archetypeOf` indexes `family[(curvatureQuartile * 3 + phase) % length]`, which
spans a contiguous 0..11, so a thirteenth form in any family would be
unreachable. The quartile boundaries are equal-*mass*, measured per class —
|c| is skewed, and binning it by equal width put 46% of the Separated tokens in
one quarter of the slots and 11% in another.

Rarity is measured, not assigned. Constrained coefficient sampling makes extreme
values naturally scarce, and 8% of the supply is built **root-first** (roots
chosen, then expanded to coefficients) because floating point will never land on
Δ = 0 by chance. Those are the `Double Root` and `Triple Root` tier, and they
are the whole Merged family. That share is the one class frequency the
collection sets rather than measures: at 4.5% the four Merged forms shared ~21
of 512 Forms, thin enough that trial master seeds regularly dropped one of them
to zero.

## Generation

Nothing is pre-generated. A Form exists when someone rolls it: the site draws
a 32-byte seed, derives the piece in the browser, and the approver checks it
against every minted Form before signing it for that wallet. The generator
package is the tooling around that:

```bash
pnpm --filter @cse/generator onchain                    # the engine page for the renderer deploy
pnpm --filter @cse/generator onchain-check              # anvil round trip of a signed mint + tokenURI
pnpm --filter @cse/generator watch-mints --contract … --rpc …   # covers + fingerprints per mint
pnpm --filter @cse/generator reveal --contract … --rpc …        # traits + rarity at sell-out
pnpm --filter @cse/generator forms                      # the 22 art-page stills
pnpm --filter @cse/generator calibrate 200              # re-measure the thresholds
```

Uniqueness runs two independent gates (`packages/core/src/uniqueness.ts`),
because either alone lets duplicates through. The **structural** gate compares
the derived mathematics (L2 over a weighted feature vector, 0.45 across forms,
1.0 within one). The **perceptual** gate compares what the piece looks like — a
496-bit hash of the rendered 16x16 grid, 32 Hamming. The browser clears the
structural gate locally while rolling, then fingerprints the live render and
asks the approver, which holds the minted set's fingerprints from the watcher's
`covers/index.json`. Too close and the roll is replaced before you see it.

The thresholds are calibrated against measured distributions rather than
guessed; `calibrate.ts` regenerates the numbers after any renderer change. They
have to be read as rejection *rates*, not distances: against a nearly full set
roughly 40% of candidates get rerolled, which the browser absorbs in well under
a second.

The art page shows one still per archetype, committed under
`apps/web/public/forms`, rendered by the same engine at one pose and forced
into a single CRT-green palette so the difference between them reads as shape
rather than hue. That palette is passed as an override and deliberately kept
out of `PALETTES` — `paletteOf` indexes that array modulo its length, so adding
an entry would recolour every token.

The older pre-generation pipeline (`pnpm generate`, `pipeline.ts`) is still in
the package for research runs and the compare harness; the mint does not use it.

## Contract

`CubicSymmetryEngine` — ERC-721 + ERC-2981 + Ownable, UUPS upgradeable.
512 supply, 11 reserved, 20 per wallet, 0.005 ETH, owner-flipped
`CLOSED → LIVE → SOLD_OUT`. The reserve is carved out of the public cap so it
stays claimable after a sellout.

```bash
pnpm test:contracts
```

There is deliberately no `[etherscan]` block in `foundry.toml` — foundry
resolves it eagerly and it breaks every local run when the key is unset. The
deploy script passes `--etherscan-api-key` explicitly instead.

## Site

One page: description, a box on the right that browses the collection while the
contract reads `CLOSED` and becomes the mint the moment it reads `LIVE`, and a
gallery filterable on all eight trait axes plus wallet address.

An individual piece is a **Form**. Downloads are named `cse-form-0417.png`.

Three pages, linked under the wordmark:

| | |
|---|---|
| **input** | the description and the mint |
| **output** | the gallery: all 512, filterable, with downloads |
| **art** | why it looks like this, and how each of the twenty-two forms is built |
| | |
| **math** | how a cubic becomes a shape, and what is authored rather than derived |

### You mint the Form you are looking at

`mint(bytes32 seed, uint256 deadline, bytes signature)` mints the seed on
screen, with the approver's EIP-712 signature over `(you, seed, deadline)`.
**Solve again** rolls a fresh seed; **Surprise me** mints the next clear roll
with the canvas covered, and lifts the cover when the transaction lands.

The signature is what keeps the guarantees that matter. It names the wallet,
so a roll seen in the mempool is useless to anyone else; it is only issued
after the seed has been checked against every minted Form; and a seed mints
once, so two people cannot end up with the same piece. Ids are sequential and
the seed is stored with the token, from which the on-chain engine derives the
art — what you got is what you saw. Traits and rarity rank are derived from
the full set of seeds at sell-out and written once.

### Tooling and the readout

Below each Form: **Pause/Play**, **Readout**, **Expand**. Pause holds the piece
where it is — it banks the elapsed animation time rather than resetting — and
while paused you can drag the Form to turn it by hand.

**Readout** is a site-only viewing mode, not part of the token. Builders call
`ctx.annotate(...)` to attach an explanation to a point on their geometry; those
become empty `Object3D`s parented into the body, so they rotate with it. The
overlay projects them to screen space each frame and fades a label out as it
swings behind the piece, comparing its camera-space distance against the framing
distance. Labels are HTML, so they stay crisp at any canvas size and never end
up baked into a PNG or GIF.

Every Form annotates its three roots. Beyond that the anchors are per-archetype
and deliberately uneven — Rift names its fault axis and slip, Orbital its
semi-major axis, Bloom each whorl's root — because pointing at an arbitrary
particle and calling it "where |c| acts" would be decoration pretending to be
derivation. On a narrow stage only the tags show, with the sentence on hover;
expanded, the full text appears.

### Export

Downloads live in the gallery, on Forms that exist — not on the mint panel,
where you are still choosing. Picking a format opens its settings rather than
exporting straight away:

| | | |
|---|---|---|
| PNG | 2000² | still |
| GIF | 400 / 800 / 1200 | 10–25fps, 1–16s |
| MP4 | 640 / 1080 / 2K | 24/30/60fps, 1–16s |

Size × rate × length is the frame count, which is what actually costs the encode
time and the file size — so the panel shows the frame count, the degrees of
rotation between frames, and an estimated output size before you commit. Those
estimates interpolate real measurements rather than a fitted curve: GIF costs
0.124 B/px at 400 falling to 0.092 at 1200 (longer flat runs compress better),
while MP4 runs 0.139 bits/px at 400 rising to 0.206 at 1080 then easing to 0.194
at 2K. They land within a few percent across every measured combination.

GIF rates are limited to those that divide 100 cleanly: the format stores
per-frame delay in hundredths of a second, so 24fps would quietly produce a loop
slightly off its stated length.

Anything below 560px shows the readout as tags only — a sentence per callout is
unreadable at that size — so 800/1200 GIF and all three MP4 sizes carry the full
text. The panel warns when a combination will be slow or awkwardly large, and
refuses outright above the point where the encoder cannot hold the frames.

**Keep readout** bakes the annotation callouts into the exported pixels. On
screen they are HTML, which stays crisp and stays out of the image; when an
export asks for them they are drawn onto the canvas from the same layout
function the overlay uses, so a download matches what was on screen. Two
implementations would have drifted apart the first time either was touched.

Frames are re-rendered by the engine at export resolution, never upscaled from
the visible canvas.

Loops are seamless by construction: export frames sample rotation over exactly
one revolution and suppress the X nod, whose period shares no short multiple
with the spin. MP4 uses `@ffmpeg/ffmpeg` — the **single-threaded** core, self
hosted from `public/ffmpeg`. That build never touches `SharedArrayBuffer`, so
the site needs no COOP/COEP headers, which would otherwise break the token
modal's iframe and the IPFS gateway images. It is a 31 MB wasm blob fetched
lazily on first use only, and it runs entirely in the browser, so Vercel just
serves it as a static file.

The masthead carries a Connect button: wagmi's EIP-6963 discovery lists every
installed wallet, so there is no project id, no hosted modal and no third-party
key anywhere in the stack — viem and wagmi only. Once connected it shows the ENS
name (resolved on mainnet regardless of the target chain) or a truncated
address, and drops down to **View forms**, which opens the gallery filtered to
that wallet, and **Disconnect**.

The app is chain-aware. A wallet on the wrong network gets a Switch pill in the
masthead and a `Switch to <chain> & mint` button, which asks the wallet to move
and then sends the transaction. Previously this surfaced wagmi's raw
`does not match the target chain` error.

Failures are translated before they reach the user. Every custom error the
contract can throw is declared in the site's ABI — without those entries viem
cannot decode a revert, and a failed mint surfaced as *"the contract function
reverted with the following reason:"* followed by nothing at all. `lib/errors.ts`
maps each one to a sentence (`AlreadyMinted` → "Someone took that one first"),
and covers the non-contract cases too: empty wallet, rejected signature, wrong
network, pending nonce, unreachable node.

That matching is structural rather than `instanceof`. There are five copies of
viem in this dependency tree and wagmi resolves a different one than the app
does, so `err instanceof BaseError` is false for the very errors this needs to
read. Walking the `cause` chain and matching on `name` works regardless of which
copy constructed it.

An empty wallet is caught before signing: the mint button reads "Not enough ETH"
and is disabled, comparing the balance against the price plus a small gas
allowance rather than the price exactly.

Two server-side routes keep credentials off the client:

- `/api/rpc` — read-only JSON-RPC proxy to Alchemy. Writes go through the user's
  own wallet, never here; without the method allowlist this would be an open
  relay pointed at your quota.
- `/api/owner` — wallet → token IDs via Alchemy, falling back to a batched
  `ownerOf` sweep on chain 31337 so the local loop needs no external services.

Fonts are self-hosted: **Departure Mono** for titles, headers and buttons,
**JetBrains Mono** for body and every numeric readout. Both OFL, licences in
`apps/web/public/fonts`.

## A note on the build order

`@cse/core` exports TypeScript **source**, not `dist`. The art bundle embeds its
own copy of core, so a stale `dist` produced art that silently disagreed with the
metadata written beside it. One source of truth removes that class of bug, and
`generate` additionally asserts up front that the bundle and the generator derive
identical tokens, failing loudly if the bundle needs rebuilding.

Rebuild the bundle after any change to `core` or `art`:

```bash
pnpm build
```
