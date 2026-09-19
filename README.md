# VIGIL — six candles, one survivor

An instant on-chain casino game for [Chain Jam Vol. 1](https://jam.chain.wtf). You pick one of six
candles and a ticket, and one verified random word decides the order in which the six candles die.
The client replays that order as a vigil: candles go out one at a time, and after every snuff **the
odds of every surviving candle re-price live on screen**.

Built on `@chain/casino-sdk` — `VigilGame.sol` implements `ICasinoGameV2`, the client is a static
build that talks to the host over the SDK's guest bridge.

- **RTP 96%** on all 12 tickets, one payout function, exact integer math
- **36.43x** top multiplier (LAST LIT on candle 6)
- **No image or audio files** — the room, the flames, the smoke and the snuff are all drawn in CSS

---

## Play it

| | |
|---|---|
| **Hosted (entry URL)** | `https://vigil-three-psi.vercel.app` — see [Deploy](#deploy-to-your-own-domain) |
| **Standalone demo** | the same URL, opened directly: free play with demo chips, no wallet, no chain |
| **Local, against a real chain** | the SDK simulator harness (below) |

The build serves both modes from one bundle. It decides at runtime:

- **not framed** (`window.parent === window`) → **free play**. Demo chips starting at 1,000, a
  Refill chip when the balance runs low, and the *same* sampler, paytable and reveal the on-chain
  game uses. Rounds are decided locally.
- **framed** → **host mode** over the guest bridge: real sessions, real VRF, real payouts. The
  payout stays hidden until the reveal finishes and `revealOutcome` fires.
- `?demo=1` forces free play, `?demo=0` forces the host bridge. A frame that never completes the
  handshake falls back to free play after 4 s rather than hanging on a spinner.

Free play is **not provably fair** and the chips are not money — the bottom bar says so on screen.

## Run it locally

```bash
# 1. The chain, the VRF node, the simulator harness (:3300) and the coinflip example (:3100)
cd casino-sdk && npm install && npm start

# 2. VIGIL itself (:3200)
cd casino-sdk/examples/vigil && npm run dev
```

Then open the harness with VIGIL's address. The harness fills in the deployment automatically once
the watcher has compiled and deployed `VigilGame` (`simulator/contracts/VigilGame.sol` is hot-loaded
from that directory); the address also appears in `simulator/local-node/deployed.json`:

```
http://localhost:3300/?game=http://localhost:3200&gameAddress=0x0b306bf915c4d645ff596e518faf3f9669b97016
```

For free play, just open <http://localhost:3200/> directly — no chain needed.

## Deploy to your own domain

It is a static build; there is no server component.

```bash
cd casino-sdk/examples/vigil
npm run build          # -> dist/
```

Upload `dist/` anywhere (Vercel, Netlify, Cloudflare Pages, nginx, a box under your bed). Two
headers matter, and the config for the three common hosts is already in this directory:

- `Content-Security-Policy: frame-ancestors *` — the gallery renders a live miniature of the game
  inside its cartridge, so the page must be frameable.
- **No `X-Frame-Options`.** A framework default of `SAMEORIGIN` would blank that miniature.
- `Access-Control-Allow-Origin: *` — the host fetches `/game.manifest.json` cross-origin.

| Host | File | Notes |
|---|---|---|
| Vercel | `vercel.json` | root directory = `casino-sdk/examples/vigil` |
| Netlify | `netlify.toml` | base directory = `casino-sdk/examples/vigil` |
| Cloudflare Pages | `public/_headers` | copied into `dist/` by the build |

If you serve from a subpath rather than a domain root, set `base` in `vite.config.ts` to that path.

## The game

Six candles, indexed 0–5, with integer **death weights** `1, 2, 3, 4, 5, 6`. A heavier candle is more
likely to be snuffed early, so candle 1 is the thick favourite and candle 6 the thin long shot — the
wax height and thickness in the artwork encode exactly that.

A round is one word. From it the contract builds the **death order** as six weighted draws without
replacement, and both tickets are decided by that order alone:

| Ticket | Wins when | Resolves after |
|---|---|---|
| **LAST LIT** | your candle is the last one burning | the 5th death |
| **FINAL THREE** | your candle survives the first three deaths | the 3rd death |

### Paytable (RTP 96%, weights 1..6)

| Candle | weight | P(last lit) | LAST LIT pays | P(final three) | FINAL THREE pays |
|---|---|---|---|---|---|
| 1 | 1 | 52.82% | 1.82x | 81.94% | 1.17x |
| 2 | 2 | 22.31% | 4.30x | 65.92% | 1.46x |
| 3 | 3 | 11.53% | 8.32x | 52.22% | 1.84x |
| 4 | 4 | 6.62% | 14.49x | 41.11% | 2.34x |
| 5 | 5 | 4.08% | 23.56x | 32.62% | 2.94x |
| 6 | 6 | 2.64% | 36.43x | 26.20% | 3.66x |

There is no optimal ticket: the player is choosing volatility and story, not edge.

### Live re-pricing (display only)

After `k` deaths the client shows, for **every surviving candle**, its current chance of winning your
ticket — and therefore the price it would pay right now. Because death is memoryless under this
model, the conditional distribution is the same Plackett–Luce process restricted to the survivors:

- **LAST LIT** — inclusion–exclusion over subsets of the survivors:
  `P(i last | R) = Σ_{S ⊆ R∖{i}} (−1)^|S| · d_i / (d_i + Σ_{j∈S} d_j)`
- **FINAL THREE** — enumerate the ordered death prefixes that leave `i` standing (≤ 60 terms).

These numbers are computed client-side, in exact rational arithmetic (`BigInt` numerator and
denominator), and they are **never** authoritative: the payout comes from the contract, and the
client renders what the contract decided.

## Math

```
weights      d   = [1, 2, 3, 4, 5, 6]
D                = 2053230379200                    # common denominator of all 720 order probabilities
LAST_NUM         = [1084606372080, 458051106240, 236773817280, 136008421920, 83680014600, 54110647080]
FINAL3_NUM       = [1682359451640, 1353394178640, 1072234928520, 843998712480, 669859331400, 537844534920]
P(win)           = NUM[ticket][candle] / D
payout (a win)   = (wager * 96 * D) / (100 * NUM[ticket][candle])      # integer division, floored once
payout (a loss)  = 0
```

Invariants, all asserted in the test suite:

- `sum(LAST_NUM) == D` and `sum(FINAL3_NUM) == 3·D` — the 720 death orders are partitioned exactly.
- For every one of the 12 tickets, `P(win) × multiplier == 0.96` exactly in rational arithmetic.
- `LAST_NUM[c]` and `FINAL3_NUM[c]` match an exhaustive enumeration of the 720 orders weighted by the
  sampler's exact leaf probabilities.
- The single floor at the end can only ever favor the house, by at most one base unit per winning
  bet: the realized RTP is 96% minus that dust.

**Sampler.** Six sequential weighted draws without replacement. At each step, with remaining total
weight `W`, the contract takes the next unused 16-bit window `v` from the word (expanding with
`keccak256(abi.encode(word, blockIndex))` when it runs past sixteen windows), rejects `v` when
`v >= floor(65536 / W) * W`, and otherwise draws the candle whose cumulative-weight interval contains
`v % W`. Candle `c` owns exactly `d_c = c + 1` of the `r` values, which is what makes the sampler
exact rather than approximate — and the worst-case rejection rate in play is 4/65536 ≈ 0.006%.

The client carries a byte-for-byte mirror of that sampler (`src/game/sampler.ts`), so free play and
the on-chain game produce identical distributions, and the reveal can be replayed from the word if
the settled blob lags a push. The decoded on-chain state always wins when it is present.

## Where things live

```
casino-sdk/simulator/contracts/VigilGame.sol   the game contract (the simulator watcher deploys it)
casino-sdk/examples/vigil/                     the client
  src/game/        constants, payout, sampler, codec, live re-pricing, reveal timeline
  src/components/  sidebar, candle stage, order rail, stats, history, result overlay
  src/demo/        the standalone free-play host
  src/styles/      the chain.wtf design system (copied from the coinflip example) + the vigil scene
  test/            contract tests, end-to-end sessions, golden-file generator
VIGIL_PRD.md                                   the spec this was built to
NOTES.md                                       SDK findings, deviations, and what was verified how
vigil_math.py                                  reference constants
```

## Verification

```bash
cd casino-sdk/examples/vigil
npm test                 # 30 tests: sampler parity, codec, live re-pricing, reveal timeline
npm run check-types

# On-chain: compiles VigilGameTests.sol against the real contract and runs the PRD §9 suite on the EVM
npx tsx test/run-contract-tests.ts
# Real sessions through LocalCasinoHost with the real VRF node
npx tsx test/run-simulator-e2e.ts
```

`NOTES.md` records what each of these actually printed, plus every place the SDK disagreed with the
PRD.

## Honest notes

- **Free play is not provably fair.** Its word comes from `crypto.getRandomValues`, not from a VRF,
  and the chips are not money. It exists so the entry URL is playable, not to imitate the on-chain
  game's guarantees.
- **The contract is not deployed to a public chain.** The judged build runs against the SDK's local
  simulator, which is what the submission describes.
- Blocking iframes doesn't make the entry ineligible — it only costs the gallery's live miniature.
