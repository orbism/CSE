# Deploying Cubic Symmetry Engine

End-to-end runbook: generate the collection, pin it to IPFS, deploy the
contract, ship the site. Sepolia first, mainnet second — the steps are
identical apart from the network you pick.

The one-way doors are flagged **⚠ permanent**. Everything else can be redone.

---

## Demo deploy (no contract)

To put the site up before anything is deployed on chain. In Vercel:

- **Root Directory:** `apps/web` (framework Next.js; pnpm is picked up from the
  root lockfile)
- **Environment Variables:** just

  ```
  MODE=DEMO
  ```

That's the lot. In demo the mint panel reads CLOSED and solves Forms locally,
the output page says "closed till post mint", the provenance check says the
contract isn't deployed yet, and nothing calls the chain or `/api/rpc`, so no
Alchemy key or contract address is needed. The Lab, art and math pages are
unaffected.

Going live later: deploy the contract (below), set `MODE=LIVE` (or delete it)
plus the step 7 variables, and redeploy. `MODE` is baked in at build time, so
changing it needs a redeploy, not just a restart.

---

## 0. Prerequisites

- `pnpm setup` has been run (installs deps, Playwright chromium, forge libs)
- `foundry` on PATH (`forge`, `cast`)
- a 4EVERLAND account with an **IPFS-type** bucket
- a funded deployer key (see gas estimates in step 6)

### `.env` (repo root, gitignored)

```
DEPLOYER_PRIVATE_KEY=0x…
ALCHEMY_API_KEY=…
ETHERSCAN_API_KEY=…

CSE_MASTER_SEED=CUBIC-SYMMETRY-ENGINE

FOUREVERLAND_KEY=…
FOUREVERLAND_SECRET=…
FOUREVERLAND_BUCKET=cse
FOUREVERLAND_ENDPOINT=https://endpoint.4everland.co
CSE_IPFS_GATEWAY=https://<your-dedicated>.4everland.io/ipfs
```

⚠ **permanent** — `CSE_MASTER_SEED` determines every token in the collection and
is written into the contract at initialisation with no setter. Fix it before
step 2 and never change it.

Use a dedicated deployer key, not a wallet holding funds you care about.

---

## 1. Clean slate

Needed whenever a previous run exists, and **mandatory after any change to the
maths, the traits or the renderer** — those change every token, so a collection
generated before the change no longer matches the code that ships.

```sh
rm -rf out packages/art/dist
```

The whole of `out/` is generator output — `collection`, `smoke`, `variety` — and
is gitignored wholesale. Nothing reads it as an input except the upload and
deploy path reading `out/collection`, so there is nothing to preserve.

Then delete the `cse/` folder in the 4EVERLAND bucket. Skip-existing during
upload matches on **filename**, so stale files from an earlier run would
otherwise survive and get pinned into the snapshot.

⚠ Old snapshot CIDs stay pinned and resolvable after you delete the folder —
IPFS is content-addressed, deleting the bucket path does not unpin what was
already published. Take fresh snapshots and use the new CIDs; never carry a CID
across a regeneration.

---

## 2. Generate

```sh
pnpm build      # art bundle -> packages/art/dist/index.html
pnpm generate   # 512 tokens -> out/collection
```

Run `pnpm generate` in a clean shell — no `CSE_URI_SCHEME` or `CSE_*_CID` set,
or the metadata bakes in local URLs instead of `ipfs://PENDING_*` placeholders.

Two passes, and the first is not the slow-looking one. Pass 1 fixes each token's
nonce against both uniqueness gates using a cheap 16x16 fingerprint — 15–25
minutes for 512, evaluating several thousand candidates, because both gates
reject hard by design and the last fifty tokens face a full index. Pass 2 then
renders the accepted set once per token. A run that looks stuck in pass 1 is
usually working; watch the `accepted N/512` counter rather than the clock.

Stills render at **2000px**, which is the smallest size at which no token loses
its glyph texture — rows reach 200 and a glyph needs ~10px. Do not lower it
without re-checking the densest tokens; at 1200px, 45% of the supply degrades
into smooth silhouettes. SVG masters are independent of this and stay at 3000
units. Override with `--size` only for test runs.

Verify before continuing:

```sh
grep -c PENDING out/collection/metadata/1.json          # > 0
node -e "const p=require('./out/collection/provenance.json'); \
  console.log(p.supply, p.complete)"                    # 512 true
```

`pnpm deploy` refuses to touch a live network unless provenance covers all 512.

---

## 3. Pin to IPFS

Directory CIDs on 4EVERLAND only exist once you take a **Snapshot** of the
folder in the dashboard — there is no S3 or HTTP API for it. So the upload runs
in three passes. Re-running is cheap: already-pinned files are skipped.

1. `pnpm upload`
   Pins art, images and svg. Stops and asks for the images snapshot.
2. Dashboard → bucket `cse` → select folder `cse/images` → **Snapshot** → copy CID.
3. `CSE_IMAGES_CID=<images-cid> pnpm upload`
   Rewrites metadata with the real CIDs and pins it. Stops and asks again.
4. Dashboard → select `cse/metadata` → **Snapshot** → copy CID.
5. `CSE_IMAGES_CID=<images-cid> CSE_METADATA_CID=<metadata-cid> pnpm upload`
   Verifies a sample through the gateway and writes `out/collection/upload.json`.

`upload.json` holds `artCID`, `imagesCID`, `metadataCID` and the `baseURI` —
`pnpm deploy` reads it automatically.

Check `"verified": true` in `upload.json` before moving on. `false` means the
sample fetch did not match through the gateway — usually the public
`4everland.io/ipfs` gateway timing out rather than a bad pin, but do not deploy
against an unverified pin without confirming a token by hand in a browser.

If the art bundle changes after pinning, re-run with `pnpm upload -- --force`.

The public `4everland.io/ipfs` gateway is unreliable and will fail the verify in
pass 3 — point `CSE_IPFS_GATEWAY` at your dedicated gateway.

---

## 4. Rehearse against anvil

Free, and exercises the exact same script.

```sh
pnpm dev                          # terminal 1 — anvil + site
pnpm deploy --network localhost   # terminal 2
```

---

## 5. Deploy to Sepolia

```sh
pnpm deploy      # choose Sepolia at the prompt
```

The script walks: preflight (RPC, chain id, deployer balance, forge libs) →
implementation + ERC1967 proxy (initialised in the same tx) → Etherscan verify →
optional reserve mint → optional open mint → writes `deployments/sepolia.json`
and prints the site's environment block.

Answers to have ready:

| Prompt          | Value                                   |
| --------------- | --------------------------------------- |
| Contract owner  | your multisig / cold wallet (default: deployer) |
| Mint price      | `0.005`                                 |
| Royalty receiver| payout address                          |
| Royalty bps     | `500` (5%)                              |

⚠ **permanent** — the provenance hash and master seed are committed at
initialisation and have no setter.

If Etherscan shows no read/write tabs on the proxy, mark it as a proxy at
`https://sepolia.etherscan.io/proxyContractChecker?a=<proxy>`.

---

## 6. Gas

The full path is roughly **4M gas**: implementation ~2.7M, proxy + initialize
~0.5M, 11 reserve mints ~0.8M, `SetMintState` ~30k.

| Gas price | Cost       |
| --------- | ---------- |
| 0.25 gwei | ~0.001 ETH |
| 5 gwei    | ~0.02 ETH  |
| 30 gwei   | ~0.12 ETH  |

Sepolia: any faucet amount covers it. Mainnet: fund with **0.02–0.05 ETH** as
buffer and send when gas is low.

---

## 7. Ship the site

Paste the block `pnpm deploy` printed into Vercel → Project → Environment
Variables:

```
NEXT_PUBLIC_CHAIN_ID=11155111
NEXT_PUBLIC_CONTRACT_ADDRESS=0x…
NEXT_PUBLIC_IMAGES_CID=…
NEXT_PUBLIC_ART_CID=…
NEXT_PUBLIC_IPFS_GATEWAY=https://<your-dedicated>.4everland.io/ipfs
NEXT_PUBLIC_MASTER_SEED=CUBIC-SYMMETRY-ENGINE
ALCHEMY_API_KEY=…
ALCHEMY_NETWORK=eth-sepolia
```

`ALCHEMY_API_KEY` is server-side only — the browser talks to `/api/rpc`, which
proxies to Alchemy, so the key never enters the client bundle. `ALCHEMY_NETWORK`
must match `NEXT_PUBLIC_CHAIN_ID`.

Leave `NEXT_PUBLIC_RPC_URL` unset for any real deployment; it exists for the
anvil loop only.

---

## 8. Verify on Sepolia

- Gallery renders, token modal opens
- Mint one from a second wallet, confirm the id you asked for is the id you get
- `tokenURI(1)` resolves through the gateway and the image loads
- Provenance check on the site matches `out/collection/provenance.json`
- Royalty shows on a testnet marketplace

---

## 9. Mainnet

Same collection, same pin — do **not** re-generate or re-upload. The CIDs from
step 3 are reused verbatim.

```sh
pnpm deploy      # choose Mainnet, then type "mainnet" to confirm
```

Then repeat step 7 with `NEXT_PUBLIC_CHAIN_ID=1` and
`ALCHEMY_NETWORK=eth-mainnet`.

---

## Post-deploy admin

All run from `packages/contracts`, with `CSE_PROXY=<proxy>` and
`PRIVATE_KEY=<owner key>` set:

```sh
# open the mint (0 = closed, 1 = live)
CSE_MINT_STATE=1 forge script script/Admin.s.sol:SetMintState --rpc-url <rpc> --broadcast

# repoint metadata
CSE_BASE_URI=ipfs://<cid>/ forge script script/Admin.s.sol:SetBaseURI --rpc-url <rpc> --broadcast

# claim the reserve (#502–#512)
CSE_RESERVE_TO=0x… CSE_RESERVE_FROM=502 CSE_RESERVE_QTY=11 \
  forge script script/Admin.s.sol:ReserveMint --rpc-url <rpc> --broadcast

# withdraw proceeds
CSE_WITHDRAW_TO=0x… forge script script/Admin.s.sol:Withdraw --rpc-url <rpc> --broadcast

# change price
CSE_PRICE_WEI=… forge script script/Admin.s.sol:SetPrice --rpc-url <rpc> --broadcast
```

⚠ **permanent** — `FreezeMetadata` disables `SetBaseURI` forever. Only run it
once the pin is confirmed good and you never intend to move the metadata.

`Upgrade` swaps the implementation behind the proxy; state is preserved
(covered by `test_upgradePreservesState`).

---

## Facts worth keeping straight

- Supply 512, 11 reserved (#502–#512), 20 per wallet, buyers choose their id
- Provenance hash + master seed: set at init, no setter, ⚠ permanent
- Base URI: settable until `FreezeMetadata`
- Owner-only: mint state, base URI, price, reserve, withdraw, upgrade
- 41 forge tests cover all of the above — `pnpm test` before every deploy
- Any edit to `core/traits.ts`, `core/token.ts` or the `art/` renderer changes
  every token and therefore the provenance hash: go back to step 1
- Calibration probes, derivation-only and safe to run any time:
  `pnpm --filter @cse/generator analyse` (trait band distributions) and
  `distances` (uniqueness-gate margins)
