# VIGIL — SDK discovery notes (Phase 1)

Authoritative sources read (not recalled):
`casino-sdk/docs/CHAIN_WTF_CASINO_GAMES.md`, `docs/CONTRACT_CONSTRAINTS.md`,
`docs/RANDOMNESS_DICE.md`, `docs/LOCAL_SIMULATOR.md`, `docs/GETTING_STARTED.md`,
`docs/CHANGELOG.md`, `casino-sdk/src/{types,manifest,guest,bet-limits}.ts`,
`casino-sdk/simulator/contracts/ICasinoGameV2.sol`, `simulator/contracts/LocalCasinoHost.sol`,
`examples/coinflip-public/**`, `simulator/local-node/game-contracts.ts`.
SDK version: `@chain/casino-sdk@0.4.0` (CHANGELOG top entry `2026.09.18-1`).

## 1. Environment actually used

```
node v24.13.1 · npm 11.8.0 · python 3.13.9 · google-chrome present
cd casino-sdk && npm install            # SDK declares bun, but npm workspaces work (CHANGELOG 2026.09.18-1)
cd casino-sdk && npm start              # local-node (chain+VRF+deploy) :8545, harness :3300, coinflip :3100
```

`npm install` added 311 packages; `npm start` booted:

```
[local-node] Deployment: { bootId, chainId: 31337, rpcUrl: http://127.0.0.1:8545,
  host: 0xe7f1…0512, vault: 0xCafa…052c, token: 0x5fbd…0aa3, router: 0x057e…8544,
  games: [ { name: 'CoinflipGame', address: '0x9fe4…a6e0' } ] }
```

Harness `:3300`, coinflip `:3100`, `/game.manifest.json` and `/__local-contracts.json` all 200.

### Coinflip played end to end (real output)

A round was driven through the exact chain the harness uses, with the real Verify Network VRF node
fulfilling the request (`casino-sdk/tmp-probe-coinflip.ts`, kept as evidence):

```
quoteCaps -> [ 10000000000000000000n, 1200000000000000000n ]     # wager 10e18, 3 coins / 1 hit
openSession tx 0xac3f222b…a2791   open status success logs 4
SETTLED { "sessionId":"1", "phase":3, "payout":"0", "randomness":"0x68735fcf…e472",
          "gameState":"0x…01…01…01 + randomness" }
# a following (won) round:
SETTLED { "phase":3, "payout":"11200000000000000000" }           # = wager 10e18 + reserve 1.2e18
CasinoSessionAdvanced count 1
```

`openSession → onSessionStart → VRF request → onRandomness → SETTLED` (phase 3) works, and the
**zero-slack cap is real**: the win paid exactly `escrowedStake + reservedProfit`
(`10e18 + 1.2e18`), i.e. `LocalCasinoHost._finalizeSession` would revert `InvalidPayout` one base
unit higher. Honest note: the first pass had no browser automation, so the click-through was done
programmatically at the chain level instead; headless Chrome is present and drives the real
harness/iframe checks from Phase 3 on.

## 2. `ICasinoGameV2` — the exact interface (from `simulator/contracts/ICasinoGameV2.sol`)

`pragma solidity ^0.8.30`; `enum SessionPhase { NONE, WAITING_RANDOMNESS, WAITING_PLAYER_ACTION,
SETTLED, FORFEITED, CANCELLED }`.

```solidity
struct SessionContext { uint256 sessionId; address player; address vault; uint256 wagerBase;
  uint256 escrowedStake; uint256 reservedProfit; uint32 step; bytes gameData; bytes gameState; }
struct StepResult { bytes newGameState; int256 escrowDelta; int256 reservedProfitDelta;
  SessionPhase nextPhase; bool requestRandomnessNow; uint256 payout; }
interface ICasinoGameV2 {
  function quoteCaps(uint256 wager, bytes calldata gameData) external view
    returns (uint256 maxEscrowStake, uint256 maxReservedProfit);
  function quoteRiskParams(uint256 wager, bytes calldata gameData) external view
    returns (uint256 maxPayout, uint256 probabilityWad, uint256 expectedPayout, uint256 bodyVarianceScaled);
  function onSessionStart(SessionContext calldata ctx) external view returns (StepResult memory);
  function onPlayerAction(SessionContext calldata ctx, bytes calldata actionData) external view returns (StepResult memory);
  function onRandomness(SessionContext calldata ctx, bytes32 randomness) external view returns (StepResult memory);
  function quoteForfeitPayout(SessionContext calldata ctx) external view returns (uint256 cashoutValue);
}
```

Hook semantics (SDK docs §2.1/§2.3 + `LocalCasinoHost.sol`):

| Hook | Semantics |
|---|---|
| `quoteCaps` | `maxEscrowStake >= wager` or `openSession` reverts (`InvalidSessionCaps`). `maxReservedProfit` is the per-bet whale cap; the host also reverts if a step commits `reservedProfit > maxReservedProfit`. |
| `quoteRiskParams` | `probabilityWad` = **top-tier win probability** in WAD, must be `<= 1e18`. `maxPayout` = worst-case player payout. `expectedPayout` = RTP mean. `bodyVarianceScaled` = variance of the payout **with the top tier removed**, wei²×1e18; "a game with a single winning tier returns 0". |
| `onSessionStart` | `view`. Instant game: return `WAITING_RANDOMNESS` + `requestRandomnessNow = true`, commit `reservedProfitDelta = maxReservedProfit`. |
| `onPlayerAction` | Only called in `WAITING_PLAYER_ACTION`. Instant games revert. Must exist in the ABI — the simulator's watcher detects games by `quoteCaps` **and** `onPlayerAction`. |
| `onRandomness` | `view`. Receives the fulfilled `bytes32`. Terminal step: `SETTLED` + `payout`, with `reservedProfitDelta = 0` and `escrowDelta = 0` (releasing the reserve on the settling step makes every win above 1x revert `InvalidPayout`). |
| `quoteForfeitPayout` | Must return **0** unless mid-round value is fully determined by already-revealed state (mines-style). VIGIL's mid-round value depends on unresolved randomness ⇒ **return 0**. |

## 3. Storage / state encoding and delivery to the client

- Sessions are **stateless on-chain**: only `keccak256(encodedSession)` is stored; every non-terminal
  step emits `CasinoSessionAdvanced(sessionId, step, requestId, randomness, session)`, every terminal
  step emits `CasinoSessionSettled(sessionId, game, player, phase, payout, randomness, gameState)`.
- The client never reads the chain. It receives `HostSnapshotV1` via `guestApi.setState` and reads
  `snapshot.sessions.items[i].raw.{gameData,gameState,randomness}` plus `phase`/`phaseName`/`payout`.
- `sessionKey = \`${chainId}:${sessionId}\`` — match against `openSession`'s returned `sessionKey`.
- Terminal phases: `SETTLED`(3) / `FORFEITED`(4) / `CANCELLED`(5). `isSettled` flips atomically with
  `payout` + final `gameState`.
- `CasinoSessionCodec.sol` (255 fixed bytes since SDK 2026.09.17-2) is the host-side layout; a game
  only owns its own `gameState` blob.

**Our encoding (PRD §7):** `gameData = abi.encode(uint8 candle, uint8 ticket)`;
`gameState = abi.encode(uint8[6] deathOrder, uint8 candle, uint8 ticket, bool won, uint256 payout)`.
Both decode directly with viem `decodeAbiParameters` (no dynamic types).

## 4. Guest bridge (`@chain/casino-sdk/guest`)

```ts
import { connectGameToHost, computeMaxWager, SessionPhase } from '@chain/casino-sdk/guest';
const connection = connectGameToHost({ setState: async (snap) => render(snap) });
const hostApi = await connection.promise;               // HostApiV1
await hostApi.openSession({ wager: base10, gameData }); // -> { sessionKey, transactionHash }
await hostApi.revealOutcome({ sessionId });             // reveal-complete
```

- `window.parent` + penpal 7; `allowedOrigins` = `document.referrer` origin, else `['*']`.
- Only enable betting when `snapshot.wallet.status === 'ready'`.
- Connect **once per page** (the host binds to the first handshake) — the coinflip example keeps a
  module-level singleton; `connection.destroy()` on unmount.
- `reportContentSize`/`observeGameContentSize` drive host-side iframe resizing (optional).

## 5. Reveal-complete mechanism (PRD §5.3 — CONFIRMED)

`hostApi.revealOutcome({ sessionId })`, called **after** the reveal animation. Until then the host
"clamps its balance displays so they can move down but never up": the wager debit is visible, the
payout is withheld. Losses need no reveal (harmless no-op). Refreshing the iframe drops the guard.
⇒ VIGIL must not print a payout, a balance delta or a WIN state before the animation finishes and
`revealOutcome` has been called.

## 6. Where contracts must live (PRD §5.1 — CONFIRMED)

`casino-sdk/simulator/contracts/*.sol`. The watcher (`simulator/local-node/game-contracts.ts`):

- ignores `ICasinoGameV2.sol`, `LocalCasinoHost.sol`, `LocalTestToken.sol` (infra);
- compiles every other `.sol` with bundled **solc, `viaIR: true`, optimizer runs 200**;
- resolves any import whose basename is `ICasinoGameV2.sol` to the infra file, so a game may keep
  its own repo path (e.g. `../interfaces/ICasinoGameV2.sol`);
- deploys every contract whose ABI exposes **`quoteCaps` and `onPlayerAction`**, then `registerGame`;
- **skips contracts with constructor arguments** ⇒ `VigilGame` takes no constructor args;
- hot-reloads on edit; a broken revision keeps the last good deployment.

## 7. Manifest schema (PRD §5.1/§5.4 — CONFIRMED, richer than `src/types.ts`)

`game.manifest.json` must be served **same origin** as the game and is validated by
`validateCasinoGameManifest` (zod, `src/manifest.ts`). Required:

`schemaVersion: 1`, `apiVersion: 1`, `gameId` (canonicalised: strip trailing `Game`, lowercase,
alnum only), `defaultLocale`, `locales{<locale>:{name, description?}}` containing `defaultLocale`,
`presentation{mode:'full-iframe'|'embedded', hostPanels{openSession,history,status:boolean}}`,
`capabilities{openSession:true, submitAction, forfeitExpiredSession, cancelStuckRandomness, resize:boolean}`,
optional `assets{iconUrl?,coverUrl?}`.

**Gotcha:** the harness silently falls back to a synthesized manifest when the real file is missing
or invalid (`use-game-manifest.ts`), so a broken manifest still "works" locally — we validate ours
explicitly in the test suite.

## 8. Wager / bet-limit helpers

`computeMaxWager(snapshot, { maxMultiplierX })` → `{kind:'limit',maxWager} | {kind:'no-limit'} |
{kind:'unknown'}`. It mirrors the facet: reserved profit `wager*(mult-1)` must fit
`casino.maxAllowedReservedProfit`, and `casino.maxBetAmount` when configured. Our reserved profit
**is** linear in the wager (`maxPayout - wager`), so a plain `computeMaxWager` call with the selected
ticket's multiplier is exact. No min-bet helper exists (facet-side; the harness accepts any `wager > 0`).

## 9. Framing / headers (PRD §5.4 — SDK is silent, the jam site decides)

The SDK ships no framing requirement. The jam site (jam.chain.wtf rules/FAQ copy) says: *"The gallery
shows a live miniature of your game inside its cartridge. If your host blocks iframes (X-Frame-Options
or a frame-ancestors policy), we show your pitch text instead."* So correct framing is required for
the live miniature, not for eligibility. We still ship `Content-Security-Policy: frame-ancestors *`
and **no** `X-Frame-Options`.

## 10. CI / manifest / widget verification in the SDK

There is **no** SDK-side CI that verifies a game's manifest or widget, and **no** `widget`/`jam`
string anywhere in the SDK checkout. Available checks: root `npm run check-types`; `simulator`
`npm run compile-contracts` (regenerates `src/local-node/artifacts.ts`, needed only when editing
harness contracts) and `npm run check-types`; per-workspace `test` (vitest; the coinflip example
runs `vitest run --passWithNoTests`).

**The jam widget** (from jam.chain.wtf docs and its `widget.js`):

```html
<script async src="https://jam.chain.wtf/widget.js"></script>
```

Exactly once, in the raw HTML of the game page. It renders a badge and pings view/heartbeat stats,
and stays silent inside gallery iframes. Submission form fields (required marked \*): title\*,
gameUrl\*, declared RTP\* (93–98, numeric), discord\*, sourceAccess\*, pitch\*, x (optional).

## Phase 2 — contract, math, tests (GATE PASSED)

`casino-sdk/simulator/contracts/VigilGame.sol` implements `ICasinoGameV2` exactly (six hooks,
storage-free). Constants are taken from `vigil_math.py`: `D = 2053230379200`,
`LAST_NUM = [1084606372080, 458051106240, 236773817280, 136008421920, 83680014600, 54110647080]`,
`FINAL3_NUM = [1682359451640, 1353394178640, 1072234928520, 843998712480, 669859331400, 537844534920]`.
Payout is `floor(wager * 96 * D / (100 * NUM))` on a win, 0 on a loss, from one `_payout`.

`VigilGame.sol` cannot declare `uint256[6] constant` arrays (solc: "Only constants of value type and
byte array type are implemented"), so the numerators are six individual constants selected by index.

The simulator's watcher picked the file up with no restart:

```
[local-node] [local-node] VigilGame.sol: deployed VigilGame at 0x0b306bf915c4d645ff596e518faf3f9669b97016
[local-node]       name: 'VigilGame', address: '0x0b306b…7016'
```

### PRD §9 tests 1–5 (real output, on-chain via `eth_call`)

`npx tsx examples/vigil/test/run-contract-tests.ts` compiles `VigilGameTests.sol` with the harness
settings, deploys it to the local chain and runs every assertion on the real EVM against the real
compiled `VigilGame`:

```
TEST 1 paytable-exactness: PASS (720 orders, sum(last)=D, sum(final3)=3D, 12/12 numerators match)
TEST 2 sampler-mapper: PASS (63 subsets, 672 r-values, preimage count == d_c for every candle)
TEST 3 rtp: PASS (96 ticket/wager checks, payout == floor(wager*96*D/(100*NUM)) exactly)
TEST 4 single-payout-function: PASS (96 ticket/wager combos x 3 words: quoteCaps, quoteRiskParams, onSessionStart and onRandomness agree)
TEST 5 reverts: PASS (44 checks: candle 6..11, ticket 2..7, gameData 0/32/96 bytes, onPlayerAction reverts, (5,1)/(0,0) accepted)
TEST 5b sampler-wellformed: PASS (64 words incl. all-1s and all-0s decode to valid permutations)

ALL PRD §9 CONTRACT TESTS PASSED (tests 1-5 + 5b)
```

Test 1 scales each of the 720 leaves exactly: a leaf's probability is `prodD / denom` over the
prefix weight products, and `D * prodD / denom` is an exact integer because every leaf's reduced
denominator divides `D` (that is what `D` is). My first attempt used `(D / denom) * prodD`, which
truncated — it failed the assertion and was fixed.

### PRD §9 test 8, chain half (real session lifecycle)

`npx tsx examples/vigil/test/run-simulator-e2e.ts` — 12 real sessions through `LocalCasinoHost`
with the real Verify Network VRF node:

```
ticket candle  death order   result  mult     payout (base units)
------ ------  -----------   ------  -------  --------------------
     0      0  6-2-3-5-4-1   WIN   1.8173x  9086712077174725499
     0      1  6-3-2-5-4-1   LOSS           0
     0      2  3-4-1-5-2-6   LOSS           0
     0      3  6-3-2-5-4-1   LOSS           0
     0      4  5-4-6-1-3-2   LOSS           0
     0      5  3-1-4-6-5-2   LOSS           0
     1      0  5-4-3-6-2-1   WIN   1.1716x  5858145125022266790
     1      1  4-6-2-3-5-1   LOSS           0
     1      2  3-4-6-5-2-1   LOSS           0
     1      3  6-5-4-3-2-1   LOSS           0
     1      4  4-6-3-2-5-1   WIN   2.9426x  14712799177645373919
     1      5  2-3-5-4-6-1   WIN   3.6648x  18324079134923117385

12/12 sessions settled; 11 distinct death orders; 4 wins

E2E PASSED: 12/12 sessions settled through LocalCasinoHost with the real VRF node, every decoded gameState matches the on-chain decision
```

Every observed multiplier is the paytable value (1.8173x, 1.1716x, 2.9426x, 3.6648x), each decoded
`gameState` matches `deriveOrder(word)` and `payoutFor(...)`, and every payout is inside
`wager + maxReservedProfit`. No contract changes were needed at this gate.

### Deviation logged

Two consecutive roots would have been false: the first e2e run reported "session never settled" for
all 12 tickets. The cause was **my script**, not the contract — I matched the settled event on a
case-sensitive address comparison against the lowercase `deployed.json` value. Fixed by matching
`sessionId` from `currentSessionId()` plus lowercase address comparison.

| # | PRD assumption | Result |
|---|---|---|
| 1 | `ICasinoGameV2` hook set and semantics | **CONFIRMED** exactly as in §2: six functions; the instant-game shape is `onSessionStart → WAITING_RANDOMNESS`, `onPlayerAction` reverts. |
| 2 | Top multiplier 36.4272x is under the heavy-tail threshold | **CONFIRMED**: `DEFAULT_HEAVY_TAIL_MULT_THRESHOLD = 100`, `DEFAULT_HEAVY_TAIL_PROB_THRESHOLD_WAD = 1e15` ⇒ VIGIL is not heavy-tail, no σ floor needed. |
| 3 | Zero-slack payout cap / one payout function | **CONFIRMED and reproduced**: `LocalCasinoHost._finalizeSession` requires `payout <= escrowedStake + reservedProfit`; the observed win paid exactly the cap. |
| 4 | Session-start hooks may be called more than once; keep them pure | **CONFIRMED**: both are `view`, and `openSession` re-runs `quoteCaps`/`quoteRiskParams` before `onSessionStart`. `VigilGame` has no storage at all. |
| 5 | Reveal-complete hook exists | **CONFIRMED**: `hostApi.revealOutcome({ sessionId })`. |
| 6 | Repo layout `contracts/` + `examples/vigil/` | **CHANGED**: only `simulator/contracts/` is watched. Layout = `casino-sdk/simulator/contracts/VigilGame.sol` + `casino-sdk/examples/vigil/` (a workspace member so the SDK's own tooling applies). |
| 7 | Where each blob goes in `gameData`/`gameState` | **CONFIRMED + DECIDED**: `gameData = abi.encode(uint8,uint8)`; `gameState = abi.encode(uint8[6],uint8,uint8,bool,uint256)` delivered via `snapshot.sessions.items[].raw.gameState`. |
| 8 | `frame-ancestors *`, no `X-Frame-Options` | **PARTIALLY CHANGED**: no SDK requirement exists; the jam FAQ confirms blocking iframes only costs the gallery miniature. We still ship the headers. |
| 9 | Manifest carries a declared RTP / thumbnail | **CHANGED**: the manifest schema has **no RTP field and no thumbnail field** — only `locales[].{name,description}` and optional `assets.{iconUrl,coverUrl}`. Declared RTP lives on the jam form + README. |
| 10 | Jam widget tag | **CONFIRMED, exact snippet found** (it is absent from the SDK checkout). |

## 12. Deviations from the PRD (integration only — no math or rule change)

1. **Repo layout** — contract at `casino-sdk/simulator/contracts/VigilGame.sol`, frontend at
   `casino-sdk/examples/vigil/` (PRD §5.1 says "adapt to the SDK convention", so this is that
   adaptation). `NOTES.md`, `README.md`, `vigil_math.py` stay at the repo root.
2. **Manifest has no RTP/thumbnail field** — declared RTP 96% goes on the jam form and in the README.
3. **`StepResult` has no `outcome` field**, although `docs/CONTRACT_CONSTRAINTS.md` lists one.
   `ICasinoGameV2.sol` is authoritative: six fields only.
4. **Randomness rule** — `RANDOMNESS_DICE.md` mandates rejection sampling for *byte*-level d6
   (`byte < 252`, then `% 6`) and generalises it: "for domain `M` and `n` outcomes:
   `limit = floor(M/n)*n`, reject `>= limit`, then `% n`; `uint16 → d6: reject >= 65532`".
   VIGIL uses the PRD's 16-bit-window form of that same rule, which is **stricter** (worst-case
   reject rate 4/65536 = 0.006%) and never uses a bare `byte % n`. No conflict.
5. **`quoteForfeitPayout` returns 0** deliberately (unresolved-randomness game), per the SDK's
   explicit adverse-selection warning.
6. **Hosting** — GitHub Pages cannot set custom response headers while the PRD requires
   `frame-ancestors *`. Resolution recorded in the Phase 4 section below.

## 13. Extra public views on `VigilGame` (for auditability)

`deriveOrder(bytes32)`, `mapDraw(uint8 survivorsMask, uint256 r)`,
`payoutFor(uint256,uint8,uint8,bool)`, `maxMultiplierBps(uint8,uint8)`,
`probabilityNumerators(uint8)`, `probabilityDenominator()`.

These are the **same internal code paths** the hooks use (not re-derivations), exposed so the test
suite and the Chain review team can prove the sampler preimage counts, the single-payout invariant
and the paytable on-chain, without a fork. Being `pure`/`view` and storage-free, they add no risk to
the session lifecycle.


## Phase 5 — UI/UX rebuild: the coinflip design system + the reveal animation

The Phase 3/4 client was a functional placeholder: a card grid with one pre-selected candle and a
result line that appeared instantly. Two things were wrong and both are now fixed.

### 5.1 The UI is the SDK's own kit, not a lookalike

The layout, the type ramp and the component recipes are copied from
`examples/coinflip-public/**`, so VIGIL now reads as the same product family on the shelf:

| Piece | Source |
|---|---|
| `src/styles/{tokens,shell,components}.css` | copied **verbatim** from the coinflip example |
| `src/components/ui/{controls,ToggleSwitch}.tsx` | copied verbatim (`ToggleTab`, `Slider`, `BetAmountInput`, `CtaButton`, `TokenIcon`, the SVG switch) |
| `src/components/{Sidebar,BottomBar,HistoryStrip,StatsStrip,ResultOverlay}.tsx` | same recipes, VIGIL content |
| `src/styles/vigil.css` | VIGIL-only: the candle stage, the ticket pills, the ORDER rail |

Mapping: the coinflip's **Heads/Tails pills → the two tickets** (LAST LIT / FINAL THREE), its
**Manual/Auto slot → nothing** (dropped rather than faked), its **Fast Mode switch → Turbo**, its
**coin grid → the six candles**, its **canvas stats strip → Profit on Win / Win Chance**, its
**Win overlay → the win card plus a red `OUT` twin**, its **bet-history pills → the multiplier
rail**. Everything else (frame, dot-pattern shell, recessed value pills, gradient CTA, bottom bar)
is the kit unchanged.

Two kit-level fixes came out of using it: `@fontsource` is imported as **latin subsets only**
(the full entry points shipped 60 font files / 508 KB; latin-only is 7 files / 88 KB, which matters
for the PRD's 250 KB transfer budget), and the bottom bar's copied "Coinflip" label now reads
`VIGIL · 96% RTP`.

### 5.2 No candle is lit until the player lights one

`pick` starts as `null`: the board opens with **all six flames burning, identical, nothing
highlighted**, the stats strip showing `—`, and the CTA disabled with "Light a candle on the board to
back it." Tapping a candle lights it (magenta accent, the kit's cool accent). Picking is frozen for
the duration of a vigil.

The old client also derived a "live" death order from **any** session in the host snapshot — another
player's round, or the player's own finished one — so a fresh page could open with candles already
greyed out and re-priced against a stale order. The board is now driven only by
`round.order`, which exists only for the round in flight.

### 5.3 The reveal is a timeline, not a timer

`src/game/reveal.ts` builds the whole schedule from the death order — the PRD §4.3 rules, as rules:
base beat 1.4 s, +250 ms on the beat that resolves the ticket, +400 ms where the pick's live chance
crosses below 15 %, `2.2x` slow motion on a LAST LIT near-miss, `0.5x` once the pick is already out,
halved under TURBO. `buildTimeline` returns per-beat `landsAtMs` / `holdMs` plus
`resolveAtMs` and `revealCompleteAtMs`; the client runs one timer per snuff and one for the finish.
`src/game/reveal.test.ts` (9 tests) checks the schedule over a stride through all 720 orders:
monotonic beats, the survivor is never snuffed, one resolve beat at the right death, the half-speed
and slow-motion rules, and **worst case ≤ 15 s** (measured ~7.1 s).

The candles are CSS-only (PRD: no image assets): wax height *and* thickness encode the death weight,
the flame is a layered radial gradient with a per-candle flicker phase, and a snuff plays as the
order is replayed — the flame flares, gutters and collapses, the glow dies, a wisp of smoke rises,
the wax goes dark. After every snuff the survivors' multipliers and bars **re-price live** and the
ORDER rail fills in one chip per death, ending on the amber survivor chip.

Payouts stay gated: the result card appears at `revealCompleteAtMs`, and `revealOutcome` is called
from the same timer, so the host never releases the withheld payout before the animation is over.
SKIP retires the pending timers and settles the board immediately.

### 5.4 Verification (real, headless Chrome against the harness)

Driven through `localhost:3300/?game=http://localhost:3200&gameAddress=0x0b306b…7016` over CDP, with
the real local-node, the real `VigilGame` and the real VRF node. Observed, not assumed:

```
idle      all six lit, nothing picked, 1.82x…36.43x, stats "—", CTA disabled
pick      candle 5 → 23.56x, Win Chance 4.08 %, Profit on Win 22.56
reveal    ORDER 5 3 2 _ _ _   (picked candle out first → red panel, rest at 0.5x)
          1.28x / 5.87x / 10.87x on the survivors with 74.81 % + 16.36 % + 8.83 % = 100.00 %
result    OUT | −1 | ORDER 5-3-2-1-4-6 | CANDLE 5 · THE 1ST OUT
win       WIN | 1.82x | + 0.8173 | ORDER 5-2-3-4-6-1 · CANDLE 1 · THE LAST LIT
          (balance debited at bet time, credited only after the reveal completed)
mobile    420x900: canvas stacks first, ORDER rail below the board, no overlap
```

Two bugs the pass caught and fixed: the ORDER rail's survivor slot never filled (it is never
snuffed, so it needed its own reveal condition), and on a short canvas the absolutely-positioned
rail landed on the candle labels — the rail is now in flow under the board.

### 5.5 Robustness: the round cannot hang on a lagging blob

The settled `gameState` can trail the settled phase by one push. The settle path now falls back to
the client's **exact mirror of the contract's sampler** (`sampleOrder(word)`) and win rule
(`isWin`), with the payout from the row, else from `payoutFor` — the same function the contract pays
with. The fallback only ever runs when the blob is absent; the decoded on-chain state always wins.

### 5.6 One thing outside this work

`examples/vigil copy/` (a stray duplicate of this project, same `package.json` name) makes the pnpm
workspace resolve two workspaces named `vigil-game`, which breaks `npx tsc`/anything that reads the
workspace from inside the repo. Not touched — it is not mine to delete — but the direct binary
(`./node_modules/.bin/tsc`) is unaffected, and that is what the numbers above were produced with.

## Phase 6 — standalone free play, and the hosting config the entry URL needs

The rule is "your URL = your entry, and it must also run standalone: anyone opening it directly gets
a playable demo". Until now the build was host-mode only — open it directly and the guest bridge
handshake never resolves, so the page sat on "Connecting to host…". The live Vercel deploy was
exactly that: `vigil-three-psi.vercel.app` served `index-D92IEYt6.js`, the Phase 5 UI with no demo
mode, and no `frame-ancestors` header (framing still worked, because Vercel sets no
`X-Frame-Options`, but the PRD asks for the header and it was missing).

### 6.1 Free play is the default, host mode is the exception

`detectMode()` in `src/App.tsx`:

| Condition | Mode |
|---|---|
| opened top-level (`window.parent === window`) | **free play** |
| framed | **host bridge** — the casino, or the local harness |
| `?demo=1` / `?demo=0` | forced either way |
| framed, handshake never resolves (4 s) | falls back to free play |

`src/demo/useDemoHost.ts` stands in for the casino host: it keeps a demo-chip balance, answers
`openSession` by drawing a word from `crypto.getRandomValues` and running **the same
`sampleOrder()` the contract runs**, settles with **the same `payoutFor()` the contract pays with**,
and pushes a real `HostSnapshotV1` — so the game has one code path and no idea which host it is
talking to. The stake leaves the balance at open and the payout only lands on `revealOutcome`: the
host's reveal gate, reproduced locally, so the demo cannot spoil its own result either.

Demo house limits mirror the real ones' shape (100 chips a bet, 250 chips of reserved profit), the
word is drawn 900 ms after the bet so the "burning" beat exists, and the balance starts at 1,000
with a **Refill** chip under 10. It is labelled on screen, not in a comment: `FREE PLAY · DEMO
CHIPS` / `VIGIL · NO REAL MONEY` in the bottom bar (amber dot, not the green "provably fair" one)
and `Demo balance:` in the sidebar. The client's sampler is exact, but `getRandomValues` is not a
VRF — the demo is not provably fair and does not claim to be.

### 6.2 What was observed (headless Chrome, both modes, real rounds)

```
standalone  localhost:3200 + the production build on :3201
            "FREE PLAY · DEMO CHIPS | chain.wtf | VIGIL · NO REAL MONEY"
            "Demo balance: C 1,000.00"   no loading screen   6 candles
            100-chip bet → OUT | −100 | ORDER 5-6-2-4-1-3 | CANDLE 1 · THE 5TH OUT → 900.00
            100-chip bet → WIN | 1.82x | + 81.7342 | ORDER 5-2-4-6-3-1 → 981.73
            (debit at open, credit only after the reveal — the same order the host enforces)
refill      with the threshold temporarily raised to 2,000 (verification only, reverted):
            chip appears → click → 1,000.00 becomes 2,000.00 → chip disappears
host        harness :3300 → iframe :3200  "PROVABLY FAIR | chain.wtf | VIGIL · 96% RTP"
            real balance 2,633,258.24 → OUT | −1 | ORDER 5-4-3-1-2-6 | CANDLE 4 · THE 2ND OUT
            → 2,633,257.24   (unchanged behaviour: the mode split did not touch the bridge)
```

### 6.3 Hosting config

`vercel.json`, `netlify.toml` and `public/_headers` (which vite copies into `dist/`, so Netlify and
Cloudflare Pages pick it up) all set the three headers that matter: `frame-ancestors *`,
`Access-Control-Allow-Origin: *` for the cross-origin manifest fetch, and never `X-Frame-Options`.
Nothing is deployed from here — a deploy publishes to the entry URL, which is the owner's call.
`README.md` (PRD §5.1) now exists with the run/deploy instructions, the paytable, the sampler and
the RTP invariants, verified against `src/game/payout.ts` rather than copied from the PRD.
