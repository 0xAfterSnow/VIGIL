import {
  CANDLE_COUNT,
  DEATH_WEIGHTS,
  FINAL_THREE,
  LAST_LIT,
  RTP_PERCENT,
  type TicketId,
} from './constants';

/**
 * Live re-pricing: the odds each still-lit candle would pay *right now*, given the candles already
 * dead — including the candles whose fate has not yet been drawn. This is the headline feature.
 *
 * Both re-pricings are exact integer math on the same weights `vigil_math.py` used for `D`, so the
 * headline figures and the payout table come from one source of truth:
 *
 *  - LAST LIT: inclusion–exclusion over subsets of the survivors (PRD §3.5). For candle `i` with
 *    the other survivors' weights `D_S`:
 *        P(i is last) = sum over S ⊆ survivors\{i} of (-1)^|S| * w_i / (w_i + sum_{j∈S} w_j)
 *    With zero deaths this reproduces `LAST_NUM/D` exactly (test 7), and on a live board it
 *    re-prices by treating the candles still standing as a fresh weighted draw.
 *
 *  - FINAL THREE: the ticket resolves after the 3rd death, so with `k` candles already dead it
 *    needs the candle to survive the next `m = 3 - k` draws. Enumerate every ordered prefix of
 *    deaths from the survivors (at most 5·4·3 = 60 terms) under the same Plackett–Luce process.
 */

export type Rational = { n: bigint; d: bigint };

const ONE: Rational = { n: 1n, d: 1n };
const ZERO: Rational = { n: 0n, d: 1n };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

export function frac(n: bigint, d: bigint): Rational {
  if (d === 0n) throw new Error('zero denominator');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export const add = (a: Rational, b: Rational) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational) => frac(a.n * b.n, a.d * b.d);
export const sub = (a: Rational, b: Rational) => frac(a.n * b.d - b.n * a.d, a.d * b.d);

export const weightOf = (candle: number) => BigInt(DEATH_WEIGHTS[candle]);

/** P(candle `i` is the last lit) restricted to `survivors` (which must include `i`). */
export function lastLitProbabilityRational(i: number, survivors: readonly number[]): Rational {
  const others = survivors.filter(c => c !== i);
  const wI = weightOf(i);
  let total = ZERO;
  for (let subset = 0; subset < 1 << others.length; subset++) {
    let subsetWeight = wI;
    let bits = 0;
    for (let k = 0; k < others.length; k++) {
      if (subset & (1 << k)) {
        subsetWeight += weightOf(others[k]);
        bits += 1;
      }
    }
    const term = { n: wI, d: subsetWeight };
    total = bits % 2 === 0 ? add(total, term) : sub(total, term);
  }
  return total;
}

/** P(candle `i` survives the next `m` deaths) under the weighted draw over `survivors`, exact. */
export function surviveProbabilityRational(
  i: number,
  survivors: readonly number[],
  m: number,
): Rational {
  if (m <= 0) return ONE;
  const others = survivors.filter(c => c !== i);
  if (others.length < m) return ONE; // not enough candles left to kill i out of the running

  // Enumerate the ordered death sequences of length m that contain NO i. i is still lit the whole
  // time, so its weight stays in the draw denominator at every step — leaving it out is exactly the
  // wrong-model error this module exists to avoid.
  const wI = weightOf(i);
  let total = ZERO;
  const walk = (remaining: number[], depth: number, p: Rational) => {
    if (depth === m) {
      total = add(total, p);
      return;
    }
    let weightLeft = wI;
    for (const c of remaining) weightLeft += weightOf(c);
    for (let k = 0; k < remaining.length; k++) {
      const c = remaining[k];
      const step = mul(p, { n: weightOf(c), d: weightLeft });
      const rest = remaining.slice(0, k).concat(remaining.slice(k + 1));
      walk(rest, depth + 1, step);
    }
  };
  walk(others, 0, ONE);
  return total;
}

/**
 * The current win probability of every candle, exact. Dead candles get 0; a candle that has
 * already locked its ticket result gets 1.
 */
export function survivorProbabilities(
  ticket: TicketId,
  order: readonly number[],
): { num: bigint; den: bigint }[] {
  const deathsSoFar = Math.min(order.length, ticket === LAST_LIT ? 5 : 3);
  const dead = order.slice(0, deathsSoFar);
  const survivors: number[] = [];
  for (let c = 0; c < CANDLE_COUNT; c++) {
    if (!dead.includes(c)) survivors.push(c);
  }
  const remaining = (ticket === LAST_LIT ? 5 : 3) - deathsSoFar;

  return Array.from({ length: CANDLE_COUNT }, (_, c) => {
    if (!survivors.includes(c)) return { num: 0n, den: 1n };
    if (remaining <= 0) return { num: 1n, den: 1n };
    const rational =
      ticket === LAST_LIT
        ? lastLitProbabilityRational(c, survivors)
        : surviveProbabilityRational(c, survivors, remaining);
    return { num: rational.n, den: rational.d };
  });
}

/** Float view for the bars and the multipliers. */
export function survivorProbabilityFloats(ticket: TicketId, order: readonly number[]): number[] {
  return survivorProbabilities(ticket, order).map(r => Number(r.num) / Number(r.den));
}

/**
 * The live payout if you bet candle `candle` right now on a `wager` stake: the same
 * `floor(wager * 96 * D / (100 * NUM))` formula with the probability re-priced live.
 * Floored, so the quoted multiplier is never optimistic.
 */
export function livePayout(
  wager: bigint,
  ticket: TicketId,
  order: readonly number[],
  candle: number,
): bigint {
  const { num, den } = survivorProbabilities(ticket, order)[candle];
  if (num === 0n) return 0n;
  return (wager * 96n * den) / (100n * num);
}

/** Live multiplier label for a candle, e.g. `1.83x` (or `—` once the candle is out). */
export function liveMultiplierLabel(
  wager: bigint,
  ticket: TicketId,
  order: readonly number[],
  candle: number,
): string {
  if (wager <= 0n) return '—';
  const { num } = survivorProbabilities(ticket, order)[candle];
  if (num === 0n) return '—';
  const x = Number(livePayout(wager, ticket, order, candle)) / Number(wager);
  return `${x.toFixed(2)}x`;
}

/** Live probability as a compact percentage label, e.g. `12.4%`. */
export function probabilityLabel(
  ticket: TicketId,
  order: readonly number[],
  candle: number,
): string {
  const { num, den } = survivorProbabilities(ticket, order)[candle];
  const pct = (Number(num) / Number(den)) * 100;
  return `${pct.toFixed(1)}%`;
}

/**
 * The live multiplier the board prints above a candle: `0.96 / P(win)` at the current set of
 * revealed deaths — the same figure the paytable gives with nothing snuffed yet, so the idle board
 * and the re-priced board agree. Wager-independent, because a multiplier is a price.
 *
 *  - `null` when the candle is out (it can no longer win your ticket);
 *  - `locked` once your ticket has already resolved on it: the payout is then the ticket's paying
 *    multiplier, not `0.96 / 1`.
 */
export function liveMultiplierState(
  ticket: TicketId,
  order: readonly number[],
  candle: number,
): { x: number; locked: boolean } | null {
  const { num, den } = survivorProbabilities(ticket, order)[candle];
  if (num === 0n) return null;
  const probability = Number(num) / Number(den);
  if (probability >= 1) return { x: 0, locked: true };
  return { x: (Number(RTP_PERCENT) / 100) * (Number(den) / Number(num)), locked: false };
}

/** The live chance of winning the selected ticket, 0..1. */
export function liveProbability(ticket: TicketId, order: readonly number[], candle: number): number {
  const { num, den } = survivorProbabilities(ticket, order)[candle];
  return Number(num) / Number(den);
}

export const TICKET_LABELS: Record<number, string> = {
  [LAST_LIT]: 'LAST LIT',
  [FINAL_THREE]: 'FINAL THREE',
};