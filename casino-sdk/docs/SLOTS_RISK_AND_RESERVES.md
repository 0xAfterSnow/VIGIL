# Slots: `quoteRiskParams` and tiered reserves

## Why this matters

Slot paytables are **heavy-tailed**: a tiny probability mass at huge multipliers dominates variance. The protocol’s portfolio model uses:

1. **`quoteCaps`** — per-session escrow / reserved-profit ceilings.
2. **`quoteRiskParams`** — inputs for **aggregate** vault reserve (VaR + jackpot tier).

If you under-report `maxPayout` or mis-report the jackpot **`probabilityWad`**, you risk **`InsufficientPortfolioReserve`** at `openSession` or incorrect risk accounting.

## What to return for a typical single-spin slot

Align with the interface in [`ICasinoGameV2.sol`](../simulator/contracts/ICasinoGameV2.sol):

- **`maxPayout`**: Worst-case total payout for the round (e.g. `wager * topMultiplier`). Used for high-multiplier floor and heavy-tail detection.
- **`probabilityWad`**: Win probability of the **jackpot (top) tier** in WAD (1e18 = 100%). The facet + `CasinoRiskLib` use this for tiered jackpot pooling when `isHeavyTail` is true.
  - Must be **≤ 1 WAD**.
- **`expectedPayout`**: Mean payout for the round consistent with your RTP (used in aggregate expectations).
- **`bodyVarianceScaled`**: the **body variance** — the variance of the round's payout distribution **with the top tier removed**, per bet, in the reserve's scaled units (see below). Return **`0`** only if the top tier is the game's sole winning outcome (coinflip-style). A multi-tier paytable that returns `0` is under-measured: for a rich slot the body is ~89% of the variance.

## Body variance

The protocol pins one variance figure per bet at `openSession`:

```
pinnedVariance = max(bodyVariance + p_top · (1 − p_top) · maxPayout², (wager · σ_floor)²)
```

- The **top-tier binary** term is computed on chain from your `probabilityWad` and `maxPayout`.
- The **body variance** is yours to supply. It is counted for **every** bet, heavy-tail or not.
- The **σ floor** is a per-game standard deviation per unit wager that the security council may register (`setGameSigmaFloor`); it raises an understated quote. A slot whose top multiplier is above the heavy-tail threshold **cannot be whitelisted** unless it quotes a nonzero body variance or a σ floor is registered.
- The whitelist guard quotes `quoteRiskParams` at each vault's minimum bet (the default minimum bet if no vault is registered yet). It uses empty `gameData` unless the council passes a `referenceGameData` to the four-argument `setGameWhitelisted`; a game that reverts on the supplied `gameData` is **not** checked, so pass a decodable configuration for any game that decodes `gameData`.

**Units.** The reserve stores variance in **wei² × 1e18** so that `sqrt(sum / 1e18)` is in wei. For a body standard deviation of `σ_body` tokens per unit wager:

```solidity
uint256 bodySigma = Math.mulDiv(wager, bodySigmaWad, 1e18); // wei
bodyVarianceScaled = bodySigma * bodySigma * 1e18;
```

where `bodySigmaWad = σ_body × 1e18`. Equivalently, from the paytable (unit wager, multipliers `M_k`, probabilities `p_k`, top tier excluded):

```
σ_body² = Σ_{k ≠ top} p_k · M_k² − (Σ_{k ≠ top} p_k · M_k)²
```

## Heavy-tail regime (on-chain)

`CasinoRiskLib.isHeavyTail` is roughly:

- `maxPayout / wager >` governance **multiplier threshold** (default **100**), **and**
- `probabilityWad <` governance **probability threshold** (default **0.1%** = **1e15** WAD).

Then the **tiered** model applies: explicit jackpot reserve + body-only VaR instead of naive normal VaR on the full tail. The top-tier binary term is swapped out of the VaR because the jackpot tier covers it; the body variance stays in.

---

## Example paytable (fictional)

Single-spin game: outcome is one row; payout = `wager × multiplier` (0 = loss). Probabilities sum to 1. RTP ≈ **92%** (house edge 8%).

| Tier    | Multiplier M |             Probability p | RTP contribution p·M |
| ------- | -----------: | ------------------------: | -------------------: |
| Jackpot |   **5 000×** | **2×10⁻⁶** (1 in 500 000) |                 0.01 |
| Major   |         200× |                    5×10⁻⁵ |                 0.01 |
| Big     |          50× |                     0.002 |                 0.10 |
| Small   |          10× |                      0.05 |                 0.50 |
| Mini    |           2× |                      0.15 |                 0.30 |
| Loss    |           0× |                  0.795948 |                 0.00 |
| **Σ**   |              |              **1.000000** |       **RTP = 0.92** |

Checklist for risk:

- **`maxPayout / wager` = 5 000** → above default multiplier threshold **100**.
- **Jackpot probability** = **2×10⁻⁶** &lt; **0.001** (10⁻³) → below default probability threshold when expressed in WAD (**2×10⁻⁶ × 1e18 = 2×10¹²** WAD, and **1e15** WAD = 0.1% — **2×10¹² &lt; 1e15**). So **`isHeavyTail`** is **true** with defaults: tiered reserve applies on-chain.

---

## Example: tiered VaR (how the protocol uses your quote)

Numbers are **illustrative** (governance multipliers, N, and w are examples).

**Given**

- Top tier: multiplier **M<sub>max</sub> = 5 000**, probability **p<sub>J</sub> = 2×10⁻⁶** (this is what you expose as **`probabilityWad`** = `2e12` in WAD terms: `p_J * 1e18`).
- Suppose **N = 100** concurrent sessions on this game type, **w = 10** tokens per spin (largest active wager **w<sub>max</sub> = 10** for the illustration).
- Confidence **z = 3.72** (the portfolio default, `confidenceMultiplierBps = 372` → 99.99%). The **same** z drives both the jackpot count below and the Tier-2 VaR.

**Tier 1 — jackpot reserve**

The number of **simultaneous** jackpots is Poisson with mean **λ = N · p<sub>J</sub>**. We reserve a confidence-bounded upper quantile via the Poisson normal upper bound, floored at 1 and **clamped to N** (you can never have more concurrent jackpots than open bets):

$$
\lambda = N \cdot p_J = 100 \cdot 2\times 10^{-6} = 2\times 10^{-4}
$$

$$
k_j = \min\Big(N,\ \max\big(1,\ \left\lceil \lambda + z\sqrt{\lambda}\,\right\rceil\big)\Big)
= \min\big(100,\ \max(1,\ \lceil 0.0002 + 3.72\sqrt{0.0002}\,\rceil)\big)
= \max(1, \lceil 0.053\rceil) = 1
$$

$$
\text{jackpotReserve} \approx k_j \cdot (M_{\max} - 1) \cdot w_{\max}
= 1 \cdot 4999 \cdot 10 = 49990\ \text{tokens}
$$

So one full jackpot-sized loss to the vault is covered **before** applying normal-VaR on the rest of the distribution. Unlike a flat coverage factor, this self-adjusts to traffic: as N (hence λ) grows, the reserved jackpot count rises at the same confidence as the VaR, and it never exceeds the live session count.

**Tier 2 — body (sub-jackpot) mass**

The jackpot tier contributes **p<sub>J</sub>·M<sub>max</sub>²** = **2×10⁻⁶ × 5 000² = 50** to the second moment of the multiplier. The protocol swaps that binary term out of the VaR (the jackpot tier covers it) and runs the portfolio VaR on the **body variance you quoted** in `bodyVarianceScaled`. For the fictional paytable, per unit wager and top tier excluded:

$$
\sigma_{\text{body}}^2 = \sum_{k \ne J} p_k M_k^2 - \Big(\sum_{k \ne J} p_k M_k\Big)^2
= (2 + 5 + 5 + 0.6) - 0.91^2 \approx 11.77
$$

so with **w = 10** the body standard deviation is **≈ 3.43 × 10 = 34.3 tokens** per spin and the quote is `bodyVarianceScaled = (34.3e18)² × 1e18`. If you return `0` here, the Tier-2 VaR sees no variance at all for this slot.

**Contrast — naive worst case**

100 spins × worst loss ≈ **100 × (5 000 × 10) = 5 000 000** tokens reserved if you reserved full worst-case per seat — the tiered model avoids that by separating the rare jackpot from the bulk of the paytable.

---

## Implementing `quoteCaps`

For a **single-spin** slot, the player posts **`wager`** once; there is no extra stake mid-round.

- **`maxEscrowStake`**: at least **`wager`** (typically **`maxEscrowStake = wager`**).
- **`maxReservedProfit`**: worst-case **vault liability** above the wager for that round: **`max(0, maxPayout - wager)`** when the worst case is a single-line jackpot on **`wager`**.

If **`gameData`** selects paylines or denomination, decode it the same way in **`quoteCaps`** and **`quoteRiskParams`** so caps and risk always match the round you will run in **`onSessionStart` / `onRandomness`**.

```solidity
function quoteCaps(uint256 wager, bytes calldata gameData)
    external
    view
    returns (uint256 maxEscrowStake, uint256 maxReservedProfit)
{
    Paytable memory t = paytableFor(gameData);
    uint256 maxPayout = wager * t.jackpotMultiplier; // e.g. 5000 * wager for top tier
    maxEscrowStake = wager;
    maxReservedProfit = maxPayout > wager ? maxPayout - wager : 0;
}
```

(Adjust naming/scaling to your storage; the **idea** is: **`maxReservedProfit`** = peak profit the vault might owe **beyond** escrowed stake for this session.)

---

## Implementing `quoteRiskParams`

**Contract surface** (from `ICasinoGameV2`):

- **`maxPayout`**: worst-case **token** payout for the round (same units as **`wager`**).
- **`probabilityWad`**: **p<sub>jackpot</sub> × 1e18** for the **top tier** only (the tier with **largest multiplier**).
- **`expectedPayout`**: **RTP × wager** in token units, i.e. $\sum_k p_k \cdot \text{payout}_{k}$ for one spin.
- **`bodyVarianceScaled`**: the **body variance** of one spin with the top tier removed, in **wei² × 1e18** (see [Body variance](#body-variance)). `0` only for a single-tier game.

**Worked mapping for the fictional paytable** (one spin, **`wager = w`**):

| Return field         | Value                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `maxPayout`          | `w * 5000`                                                                                             |
| `probabilityWad`     | `2e12` — i.e. **`(2e-6) * 1e18`**                                                                      |
| `expectedPayout`     | **`(w * 9200) / 10000`** if RTP is exactly **92%** = 9200 BPS                                          |
| `bodyVarianceScaled` | **`bodySigma² * 1e18`** with `bodySigma = w * 3.43e18 / 1e18` (σ<sub>body</sub> ≈ 3.43 per unit wager) |

```solidity
uint256 internal constant WAD = 1e18;
uint16 private constant RTP_BPS = 9200; // 92.00%

// pJackpot = 2e-6  =>  probabilityWad = 2e12
uint256 private constant JACKPOT_PROB_WAD = 2e12;
// sigma of the paytable with the jackpot tier removed, per unit wager (WAD): sqrt(11.77) ~= 3.43
uint256 private constant BODY_SIGMA_WAD = 3.43e18;

function quoteRiskParams(uint256 wager, bytes calldata gameData)
    external
    view
    returns (
        uint256 maxPayout,
        uint256 probabilityWad,
        uint256 expectedPayout,
        uint256 bodyVarianceScaled
    )
{
    Paytable memory t = paytableFor(gameData);
    maxPayout = Math.mulDiv(wager, t.jackpotMultiplier, 1); // e.g. 5000 * w
    probabilityWad = JACKPOT_PROB_WAD; // must match actual top-tier probability
    expectedPayout = Math.mulDiv(wager, RTP_BPS, 10_000);
    uint256 bodySigma = Math.mulDiv(wager, BODY_SIGMA_WAD, WAD);
    bodyVarianceScaled = bodySigma * bodySigma * WAD;
}
```

**Invariants you must preserve**

1. **`probabilityWad`** is exactly the **marginal** probability of the **highest-multiplier** winning outcome used for heavy-tail detection — not “any win”, not average win chance.
2. **`expectedPayout`** must match the **same** paytable you simulate in **`onRandomness`** (same RTP).
3. If you have multiple **`gameData`** variants (different RTP skins), recompute **`maxPayout`**, **`probabilityWad`**, **`expectedPayout`** and **`bodyVarianceScaled`** from the same tables.
4. **`bodyVarianceScaled`** excludes exactly one tier — the one whose probability you return as **`probabilityWad`** — so the on-chain binary term and your body term never double count.

---

## Implementing session phases (typical RNG slot)

1. **`onSessionStart`**: Decode **`ctx.gameData`**, commit **`newGameState`** (e.g. pending spin), set **`nextPhase = WAITING_RANDOMNESS`**, **`requestRandomnessNow = true`**, **`reservedProfitDelta`** per your game’s pattern (see `CoinflipGame` / facet for how reserved profit interacts with **`quoteCaps`**).
2. **`onRandomness`**: Map **`randomness`** to an outcome index using a **reproducible** function (uniform draw over cumulative weights), compute **`payout`**, set **`SETTLED`**, **`requestRandomnessNow = false`**.

`onPlayerAction` can **`revert`** if the slot has no mid-round choices.

---

## Doc drift warning

**`ICasinoGameV2` + `CasinoGameFacet` + `CasinoRiskLib`** are the source of truth for exact field names and units; this document describes how they use your quote.
