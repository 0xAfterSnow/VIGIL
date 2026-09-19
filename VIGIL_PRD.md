# VIGIL — Product Requirements Document

**Six candles. One survivor. Pick yours.**
Entry for Chain Jam Vol. 1 (jam.chain.wtf). Built on the Chain casino SDK (`@chain/casino-sdk`, `ICasinoGameV2`).

> **HARD DEADLINE: September 20, 2026, 23:59 UTC.** Submissions can be updated at the same URL until then; the newest build counts. Ship an ugly-but-eligible build early, then improve it.

---

## 0. How to read this document

- This PRD defines **the game** (rules, math, UX, feel). It does **not** define the SDK integration.
- **The SDK checkout is the source of truth for integration**: the real `ICasinoGameV2.sol`, the coinflip example, the manifest schema, the guest bridge, the simulator, the SDK README. Anything in this PRD that mentions SDK internals is a *working assumption* marked **[VERIFY IN SDK]**. If the SDK disagrees with this PRD on integration details, the SDK wins and the deviation gets noted in `NOTES.md`. If it disagrees on **game math or rules**, stop and report before changing anything.
- Third-party jam entries describe the SDK interface inconsistently (some show quote/session/randomness hooks, one shows a single `calculateOutcome` function). Do not copy any interface from memory or from other entries. Read the SDK's own interface file.

---

## 1. Summary

VIGIL is an instant on-chain casino game. The player picks one of six candles and a ticket type, places a wager, and the contract uses one verified random word to decide the order in which the six candles die. The client replays that order as a slow, tense vigil: candles are snuffed out one at a time, and after every snuff the win chance of every surviving candle is **re-priced live on screen**. The house edge is a fixed 4% (RTP 96%) on every one of the 12 possible tickets.

**Why it can win (mapped to the four judging criteria, scored unweighted by the Chain team):**

| Criterion | What VIGIL does about it |
|---|---|
| Novelty ("is there a similar game on the market?") | Elimination-order betting with live conditional re-pricing after each death. Not blackjack/roulette/plinko/dice/limbo/crash. Honest caveat: adjacent products exist (virtual racing, last-man-standing bets). The defense is the *sequential live re-pricing* reveal, not the candle skin. Do not overclaim novelty in copy. |
| Fun ("will someone still play after 10 hours?") | 12 tickets with very different volatility (1.17x to 36.43x), a 10–15 s round, a built-in near-miss (your candle dies second-to-last), one-key rematch, a turbo/skip control, and a cosmetic-only variation seed so no two vigils look identical. |
| Simplicity ("understood quickly, no manual") | One sentence on screen, one decision (tap a candle), one optional toggle. Multipliers are printed above each candle. No tutorial, no modal, no wallet screen. |
| Visual & sound ("feels like a real game, no AI slop") | Dark room, six hand-tuned procedural flames, wax, smoke, and fully synthesized audio (no audio files). One art direction, executed with restraint. |

---

## 2. Scope

### 2.1 In scope (MUST)
1. `VigilGame` Solidity contract implementing the SDK's `ICasinoGameV2` (exact interface from the SDK checkout).
2. Exact-integer paytable, RTP 96%, all 12 tickets.
3. Web client (static build) with SDK guest bridge (host mode) and a standalone free-play mode.
4. `game.manifest.json` per the SDK schema. Jam widget script tag in the game page HTML.
5. Full test suite proving the contract math (Section 9).
6. Static hosting with iframe embedding allowed, a public or shareable source repo, README with the math.

### 2.2 Should build (SHOULD)
- Synthesized audio (wind bed, flame crackle, snuff, tension pulse, win/lose stingers).
- Near-miss pacing and slow-motion for the final two flames.
- **ORDER ID** share code (the death order as a short string) on the result card.
- Turbo / skip control and keyboard support.

### 2.3 Explicitly OUT of scope (CUT)
Accounts, leaderboards, multiple rooms or lineups, in-play cash-out or any mid-round player action, more than two ticket types, "FIRST OUT" ticket, 3D or WebGL, external art/audio assets, backend services, chain deployment or whitelisting work (not required by the stated eligibility rules; the simulator plus hosted static build is what is judged).

---

## 3. Game design

### 3.1 Objects
- **Six candles**, index 0 to 5, with integer **death weights** `d = [1, 2, 3, 4, 5, 6]`. A higher weight means the candle is more likely to be snuffed early. Draw wick/wax so this is legible: candle 0 is thick and tall (the favorite), candle 5 is thin and short (the long shot).

### 3.2 How a round resolves
1. The player chooses a candle `c` (0–5), a ticket `t`, and a wager.
2. The contract receives `(wager, gameData = abi.encode(uint8 c, uint8 t))` and, later, the verified random `bytes32` word from the SDK's VRF flow.
3. From the word, the contract builds the **death order**: 6 sequential weighted draws without replacement. At each step, among the candles still lit with total weight `W`, draw an integer `r` uniformly in `[0, W)` and pick the candle whose cumulative-weight interval contains `r`. That candle dies next. (This is exactly the death order of six independent exponential lifetimes, and it is a Plackett–Luce distribution.)
4. The ticket wins or loses from the order alone; the payout is computed by one function (Section 6).

### 3.3 Tickets
| Ticket `t` | UI label | Wins when | Resolves at |
|---|---|---|---|
| 0 | **LAST LIT** | your candle is the last one burning | after the 5th death |
| 1 | **FINAL THREE** | your candle survives the first 3 deaths | after the 3rd death |

Both tickets pay `wager × 0.96 / P(win)` on a win and 0 on a loss. Every one of the 12 tickets has RTP exactly 96%. There is no optimal ticket; the player is choosing volatility and story.

### 3.4 Paytable (RTP 96%, weights 1..6)
Generated and verified by `vigil_math.py` (run it; do not trust this table over the script).

| Candle | d | P(last lit) | LAST LIT pays | P(final three) | FINAL THREE pays |
|---|---|---|---|---|---|
| 0 | 1 | 52.82% | 1.82x | 81.94% | 1.17x |
| 1 | 2 | 22.31% | 4.30x | 65.92% | 1.46x |
| 2 | 3 | 11.53% | 8.32x | 52.22% | 1.84x |
| 3 | 4 | 6.62% | 14.49x | 41.11% | 2.34x |
| 4 | 5 | 4.08% | 23.56x | 32.62% | 2.94x |
| 5 | 6 | 2.64% | 36.43x | 26.20% | 3.66x |

Maximum payout multiplier: **36.4272x** (LAST LIT on candle 5). This is below the 100x heavy-tail threshold that other entries report the SDK treats specially **[VERIFY IN SDK]**; keep every ticket under it.

### 3.5 Live re-pricing (display only, never authoritative)
After `k` deaths are shown, the client displays, for **every surviving candle**, its current chance of winning *your ticket type* (i.e., "chance this candle is last lit" for LAST LIT; "chance this candle still makes the final three" for FINAL THREE). Because death is memoryless under this model, the conditional distribution is the same Plackett–Luce process restricted to the survivors:
- LAST LIT: `P(i last | survivors R) = Σ over subsets S of R∖{i} of (−1)^|S| · d_i / (d_i + Σ_{j∈S} d_j)`.
- FINAL THREE: enumerate the at-most-720 remaining orders and sum. (Ticket is settled after the 3rd death, so this only matters for k < 3.)
- Render as bars under each candle that visibly redistribute after every snuff. Bars for dead candles collapse to zero. Your candle's bar is highlighted. This is the signature moment of the game.
- These numbers are computed client-side for display. They must be tested against the contract's exact probabilities (Section 9), and they must never influence a payout.

---

## 4. UX specification

### 4.1 Screen (one screen, no navigation)
- **Top strip:** balance (host balance in host mode; free-play chips in standalone), wager control, RTP label ("96%").
- **Center stage:** six candles in a row in a dark room. Above each candle: its multiplier for the currently selected ticket. Below each: its live probability bar (idle state shows the starting probabilities).
- **Prompt line (idle):** exactly one sentence — "Six candles. One survivor. Pick yours." No other instructions.
- **Bottom controls:** ticket toggle (LAST LIT | FINAL THREE), a big LIGHT IT / BET button, TURBO, and rematch (same ticket, same wager) after a result.
- No splash, no modal, no tutorial, no wallet prompt. The page must show the prompt line, six candles and their multipliers with **zero clicks**.

### 4.2 Thumbnail rule
The gallery renders a **live miniature** of the game inside a cartridge. At roughly 200 by 120 px the player must still see: six distinct flames, the highlighted candle, and a large multiplier. Design the layout, contrast, and animation so the miniature reads instantly and is visually striking. Test the game at that size inside the SDK harness/iframe.

### 4.3 Reveal timeline (cinematic, 9–14 s at normal speed)
Build the reveal as a deterministic timeline from the death order (an array of 6 candle indices, first to die first). Base beat interval about 1.4 s. Pacing rules, all derived from geometry, not scripted per outcome:
- Beat where your ticket resolves: 250 ms pre-hold, then the result stinger.
- Beat where your candle's live chance drops below 15%: extend the hold by about 400 ms.
- **Near-miss:** if your candle is one of the last two lit on a LAST LIT ticket, run the final beat in slow motion (about 2.2x longer) with a rising tension pulse and a flame flicker before the last snuff.
- After your ticket is already dead, keep the reveal but run it at about 0.5x duration. TURBO (key `T`) halves all durations; a SKIP action jumps to the settled state.
- Total worst case must never exceed about 15 s at normal speed.

### 4.4 Result card
Shows: outcome (WIN x.xx / LOST), payout, net, the **ORDER ID** (the death order rendered as six digits, e.g. `4-2-6-1-3-5`, optionally shortened to a base-36 code), and a one-click rematch. In host mode, do not show any payout/balance change before the reveal finishes (see 5.3).

### 4.5 Keyboard
`1`–`6` pick a candle, `Tab` or `L`/`F` toggles ticket, `Enter`/`Space` bets or rematches, `T` turbo, `M` mute.

### 4.6 Cosmetic-only variation
Derive a separate **visual seed** from the random word (for example `keccak256(word, "vigil-visual")` client-side) that drives wind gusts, flame flicker phase, wax drips and smoke shapes. It must not affect the order, the payout, or timing beyond cosmetic micro-variation. Rule: the room changes, the math does not.

---

## 5. Technical requirements

### 5.1 Repo layout (adapt to the SDK example convention) **[VERIFY IN SDK]**
```
contracts/            VigilGame.sol      (or wherever the simulator watcher expects: simulator/contracts/)
examples/vigil/       the game frontend forked from the SDK coinflip example
  public/game.manifest.json
  src/game/           math (mirror of contract), order sampler, live-probability, codec
  src/bridge/         host bridge (SDK guest) + standalone demo host
  src/render/         canvas scene, timeline, pacing
  src/audio/          synthesized audio graphs
test/                 contract + math + parity tests
vigil_math.py         reference constants (provided)
NOTES.md              deviations from this PRD, SDK findings
README.md             how to run, math, RTP proof
```
Start from the SDK's coinflip example: keep its build, bridge wiring, manifest shape, and CI checks; replace the game logic and UI.

### 5.2 Contract (`VigilGame.sol`)
- Implements `ICasinoGameV2` **exactly as defined in the SDK checkout**. Implement every required hook with the SDK's semantics **[VERIFY IN SDK]**.
- Inputs: `gameData = abi.encode(uint8 candle, uint8 ticket)`. Revert on `candle > 5` or `ticket > 1`.
- **Single payout function.** Every hook that needs a payout or a cap (quotes, risk params, session start, randomness callback) must call the **same internal `_payout(wager, candle, ticket, won)`**. Other entries report the host enforces a zero-slack cap, so any independent re-derivation that differs by even one base unit can revert every winning round **[VERIFY IN SDK]**.
- **Reserve/max-payout quotes:** the maximum possible payout for a given `(wager, candle, ticket)` is `_payout(wager, candle, ticket, true)`. A loss pays 0. Respect the SDK's requirement about what the host must reserve **[VERIFY IN SDK]**.
- **Idempotence:** session-start style hooks may be invoked more than once (including as a simulation). Keep them pure functions of `(wager, gameData)` **[VERIFY IN SDK]**.
- **No storage bloat, no loops over the ordering space.** The heaviest operation is 6 sampling draws.
- **Outcome state:** write the death order (6 bytes) plus `candle`, `ticket`, `won`, and `payout` into whatever game-state structure the SDK defines, so the client can render exactly what the contract decided.

### 5.3 Reveal gating **[VERIFY IN SDK]**
Other entries report the host hides the payout until the game calls a reveal-complete style method after its animation finishes, so the balance does not spoil the result. Use the SDK's real mechanism as demonstrated in the coinflip example. Never display a payout or balance change earlier than the SDK allows.

### 5.4 Client
- **Render:** Canvas 2D (single canvas, DPR-aware), 60 fps target on a mid laptop. Procedural everything: no image or audio files. Performance budgets: total transfer under about 250 KB, first interactive under 1.2 s (cold open on a normal connection), reveal frame time under 20 ms p95.
- **Host mode:** use the SDK guest bridge (`@chain/casino-sdk/guest` or the vendored guest script, as the coinflip example does) to open sessions and receive settled state. In host mode the client **renders what the contract decided and does not recompute the outcome**.
- **Standalone mode:** if the page detects it is not embedded, it runs a clearly labeled **free-play** mode with fake chips (start at 1,000; stake selectable; a REFILL button when low) that resolves rounds locally using the **same** sampler and payout math as the contract. Free-play must be visibly labeled so nobody mistakes it for real money.
- **Embedding:** the hosting config must allow framing by chain.wtf. Serve `Content-Security-Policy: frame-ancestors *` and do **not** send `X-Frame-Options` (a framework default of `SAMEORIGIN` reportedly breaks the gallery's live preview) **[VERIFY IN SDK]**.
- **Widget:** include the jam widget script tag exactly once in the raw HTML of the game page, copied exactly from the jam site (jam.chain.wtf) or the SDK example. Submission is void without it.
- **Manifest:** `game.manifest.json` copied from the coinflip example and edited to the SDK schema (name, description, declared RTP 96, thumbnail/metadata as the schema requires). Ensure the built static output contains it.

### 5.5 Audio (Web Audio API, synthesized)
- Ambient: low filtered-noise wind bed, very quiet.
- Flame: continuous crackle (filtered noise with random gain bursts) per lit candle; gain and brightness reduce as the flame shrinks.
- Snuff: short breath/hiss plus a descending pitch tick; the pitch of the snuff tone steps down as fewer candles remain so the tension is audible eyes-closed.
- Final two: slow heartbeat-like pulse under the crackle.
- Win: warm rising chord. Loss: a single low note, then quiet. Must respect `M` mute and browser autoplay rules (start audio on first user gesture).

### 5.6 Visual direction
One sentence: **a single room lit only by six candles, shot close, warm amber against near-black.**
- Palette discipline: amber for flame and light; your candle's highlight in one distinct cool accent; red only for a dead ticket. No gradients-for-decoration, no stock glow, no emoji.
- Wick thickness and wax height encode death weight so the favorite and long shot are obvious without reading.
- Flame: layered procedural shapes with noise-driven flicker; snuff produces smoke wisps and a fading glow on the wall. Wax drips are cosmetic and seeded.
- Typography: one typeface, large multipliers, minimal text.

---

## 6. Math specification (authoritative)

Constants (from `vigil_math.py`):
```
D_WEIGHTS   = [1, 2, 3, 4, 5, 6]
RTP         = 96 / 100
D           = 2053230379200                       // common denominator of all 720 order probabilities
LAST_NUM    = [1084606372080, 458051106240, 236773817280, 136008421920, 83680014600, 54110647080]
FINAL3_NUM  = [1682359451640, 1353394178640, 1072234928520, 843998712480, 669859331400, 537844534920]
// P(win) = NUM[ticket][candle] / D
```
Payout on a win: `payout = (wager * 96 * D) / (100 * NUM[ticket][candle])`, integer division, floor **once** at the end (house-favoring, at most 1 base unit). `payout = 0` on a loss. Declared RTP: 96%.

Invariants that must hold and be tested:
- `sum(LAST_NUM) == D`; `sum(FINAL3_NUM) == 3 * D`.
- For every ticket, `P(win) × multiplier = 0.96` exactly in rational arithmetic.
- For each candle, `LAST_NUM` and `FINAL3_NUM` match the exhaustive enumeration of the 720 orders weighted by the sampler's exact leaf probabilities.

### 6.1 Sampler (contract and client mirror, identical)
- Input: the `bytes32` VRF word. Split into sixteen 16-bit windows.
- Six draws in order. For draw with total remaining weight `W`: take the next unused window `v`; if `v >= floor(65536 / W) * W`, discard it (rejection) and take the next; otherwise `r = v % W`. Using `%` is only allowed **after** the rejection check; never use a bare `byte % n`.
- If the windows are exhausted (astronomically unlikely; per-window reject probability is under 0.03% for every `W` in play), derive a fresh word `keccak256(abi.encode(word, counter))` and continue with counter incremented. The client mirror does the same.
- Map `r` to a candle via cumulative weights over the surviving candles in ascending index order.

### 6.2 Why this is exact
Each draw maps exactly `d_c` values of `r` to candle `c`, so the probability of any full order is the exact product of `d/W` terms, which is precisely the Plackett–Luce probability used to build `NUM` and `D`. There is no simulation and no approximation.

---

## 7. Data encoding **[VERIFY IN SDK for where each blob goes]**
- Bet input (`gameData`): `abi.encode(uint8 candle, uint8 ticket)`.
- Settled state the client decodes: `deathOrder` (6 × uint8, first-to-die first), `candle`, `ticket`, `won` (bool), `payout` (uint256). Provide a TS codec mirroring this exactly and a round-trip test.

---

## 8. Standalone/host parity
The TypeScript sampler and payout function must produce **identical** results to the contract for the same word/wager/ticket. Prove with a parity test over at least 200 pseudo-random words × all 12 tickets, plus fixed golden vectors (a handful of words with their exact death order and payout, checked in as fixtures).

---

## 9. Test plan (all must pass before submitting)

1. **Paytable exactness:** brute-force all 720 orders with exact rational leaf probabilities; assert equality with `LAST_NUM`, `FINAL3_NUM`, and `D`.
2. **Sampler exactness:** for every reachable survivor subset (63 non-empty subsets) and every `r` in `[0, W)`, the cumulative-weight mapper returns candle `c` exactly `d_c` times.
3. **RTP:** for all 12 tickets, `P(win) × payout multiplier = 96/100` exactly (rational), and the integer payout never exceeds the exact value.
4. **Single payout function:** a test that every hook returning or reserving a payout agrees to the base unit across a range of wagers (including tiny and very large wagers within SDK limits).
5. **Reverts:** invalid candle/ticket revert.
6. **Client/contract parity** (Section 8).
7. **Live-probability correctness:** the display function's output at `k = 0` equals the exact `NUM/D` values; conditional values sum to 1 (LAST LIT) and satisfy the Plackett–Luce recursion on survivors.
8. **Simulator end-to-end:** run the SDK simulator with the real VRF node; place bets for every ticket; verify rendered state matches on-chain state.
9. **Standalone:** open the built page directly (not in the harness), free-play works with no wallet, no console errors.
10. **Embed check:** load inside the SDK harness/iframe; live miniature readable; CSP/framing headers correct on the deployed origin.

---

## 10. Eligibility checklist (binary; every line must be true)

- [ ] Implements the Chain casino SDK exactly: contract, bridge, manifest.
- [ ] Runs correctly in the local simulator; loads near-instantly.
- [ ] Theoretical RTP within 93–98% (VIGIL: 96%) and the declared math matches the actual paytable.
- [ ] Recognizably a casino game (wager in, outcome, payout); not a classic; not a plinko/dice/limbo/crash clone; original code.
- [ ] Runs standalone outside the chain.wtf iframe as a playable demo.
- [ ] Jam widget present in the game page HTML.
- [ ] Submitted through jam.chain.wtf with source access for the Chain team.
- [ ] Hosted on our own domain (Vercel/Netlify/etc.), static build.

---

## 11. Schedule (assume about 24–30 hours remain; adjust to the clock)

| Phase | Target | Gate to pass |
|---|---|---|
| 1. SDK discovery + coinflip running in simulator | T+0–1.5h | coinflip playable in the harness; interface, manifest schema, widget snippet, reveal mechanism understood and written to `NOTES.md` |
| 2. Contract + math + tests | T+1.5–5h | tests 1–5 green; contract accepted by simulator watcher |
| 3. Client v0 (ugly but complete flow, host + standalone) | T+5–10h | full bet → reveal → result works in the harness for all 12 tickets |
| **Ship v1 to hosting and SUBMIT (eligible, playable)** | **by T+10–12h** | eligibility checklist all ticked; form submitted |
| 4. Visual and audio pass, live re-pricing bars, near-miss pacing | T+12–20h | thumbnail readable; audio synthesized; performance budgets met |
| 5. Polish, ORDER ID, turbo/skip, keyboard, README with math | T+20–24h | tests 6–10 green |
| Freeze | at least 3h before deadline | re-verify submission page/URL, widget, manifest, framing headers; no new features |

### Cut order if time is short (drop from the top)
1. ORDER ID and keyboard shortcuts.
2. Slow-motion polish and cosmetic variation seed.
3. FINAL THREE ticket (LAST LIT alone is still a complete game).
4. Live re-pricing bars (last resort; they are the differentiator, so protect them).

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Deadline (about one day) | Ship an eligible v1 by T+10–12h; iterate on the same URL. |
| SDK details differ from assumptions | Phase 1 discovery; SDK wins on integration; record deviations. |
| Off-by-one payout breaks host cap | One `_payout` function; test 4; never re-derive payouts elsewhere. |
| Client/contract mismatch shows one result and pays another | Client renders contract state in host mode; parity tests. |
| "Similar game exists" on Novelty | Lead with sequential live re-pricing; avoid overclaiming; keep the copy honest. |
| "AI slop" on Visual & sound | Procedural, hand-tuned art direction; single palette; synthesized audio with intent; test at thumbnail size. |
| Simplicity failure | One sentence prompt, one decision, zero-click first screen, no tutorial. |
| Framing/CSP misconfiguration hides the live preview | Correct headers on the deployed origin; verify in the harness iframe. |
| Chain team whitelisting | Not required for the stated eligibility; do not spend time on it. |

---

## 13. Appendix — copy

- **Title:** VIGIL
- **Prompt (idle):** Six candles. One survivor. Pick yours.
- **Tickets:** LAST LIT — your candle is the last flame. FINAL THREE — your candle outlasts three others.
- **Result:** "Your flame held." / "Your flame went out."
- **One-liner for the jam form:** Bet on which candle outlasts the rest, and watch every survivor's odds re-price live as each flame goes out. Exact integer math, 96% RTP on all 12 tickets.
