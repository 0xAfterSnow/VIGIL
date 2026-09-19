import {
  CANDLE_COUNT,
  D,
  FINAL3_NUM,
  FINAL_THREE,
  LAST_LIT,
  LAST_NUM,
  PERCENT,
  PROBABILITY_WAD,
  RTP_PERCENT,
  type TicketId,
} from './constants';

/**
 * Paytable and payout, mirroring `VigilGame._payout` / `payoutFor` exactly.
 * The contract is authoritative; these numbers are used for the on-screen multipliers, the wager
 * clamp and the standalone free-play mode.
 */

export function assertBet(candle: number, ticket: number): void {
  if (!Number.isInteger(candle) || candle < 0 || candle >= CANDLE_COUNT) {
    throw new Error(`invalid candle ${candle}`);
  }
  if (ticket !== LAST_LIT && ticket !== FINAL_THREE) {
    throw new Error(`invalid ticket ${ticket}`);
  }
}

/** `NUM[ticket][candle]` — the numerator of `P(win)` over `D`. */
export function numerator(ticket: TicketId, candle: number): bigint {
  assertBet(candle, ticket);
  return ticket === LAST_LIT ? LAST_NUM[candle] : FINAL3_NUM[candle];
}

/** `P(win)` as an exact fraction. */
export function probability(ticket: TicketId, candle: number): { num: bigint; den: bigint } {
  return { num: numerator(ticket, candle), den: D };
}

/** `P(win)` as a float, for display and for bar widths. */
export function probabilityFloat(ticket: TicketId, candle: number): number {
  return Number(numerator(ticket, candle)) / Number(D);
}

/** `probabilityWad` exactly as `quoteRiskParams` returns it. */
export function probabilityWad(ticket: TicketId, candle: number): bigint {
  return (numerator(ticket, candle) * PROBABILITY_WAD) / D;
}

/**
 * THE payout. `floor(wager * 96 * D / (100 * NUM))` on a win, 0 on a loss — floored once, so the
 * integer payout never exceeds the exact 96% value.
 */
export function payoutFor(
  wager: bigint,
  candle: number,
  ticket: TicketId,
  won: boolean,
): bigint {
  assertBet(candle, ticket);
  if (!won) return 0n;
  return (wager * RTP_PERCENT * D) / (PERCENT * numerator(ticket, candle));
}

/** Worst-case payout for a bet — what `quoteCaps`/`quoteRiskParams` reserve against. */
export function maxPayout(wager: bigint, candle: number, ticket: TicketId): bigint {
  return payoutFor(wager, candle, ticket, true);
}

/** Worst-case payout above the stake — the reserved profit the facet caps. */
export function maxReservedProfit(wager: bigint, candle: number, ticket: TicketId): bigint {
  const payout = maxPayout(wager, candle, ticket);
  return payout > wager ? payout - wager : 0n;
}

/** `quoteRiskParams.expectedPayout`: the RTP-based mean payout. */
export function expectedPayout(wager: bigint): bigint {
  return (wager * RTP_PERCENT) / PERCENT;
}

/** Worst-case multiplier in basis points, **ceiled** — the ceiling direction never lets a bet slip past the cap. */
export function maxMultiplierBps(candle: number, ticket: TicketId): bigint {
  const denominator = PERCENT * numerator(ticket, candle);
  const scaled = RTP_PERCENT * D * 10_000n;
  return (scaled + denominator - 1n) / denominator;
}

/** Worst-case multiplier as a float (ceiled to a basis point, so it is never optimistic). */
export function maxMultiplierX(candle: number, ticket: TicketId): number {
  return Number(maxMultiplierBps(candle, ticket)) / 10_000;
}

/** The paytable exactly as the README and the result card quote it, e.g. `1.8173x`. */
export function multiplierLabel(candle: number, ticket: TicketId): string {
  const bps = maxMultiplierBps(candle, ticket);
  return `${(Number(bps) / 10_000).toFixed(2)}x`;
}

/** Precise multiplier for the multiplier strip (4 significant decimals). */
export function multiplierPrecise(candle: number, ticket: TicketId): string {
  const bps = maxMultiplierBps(candle, ticket);
  return `${(Number(bps) / 10_000).toFixed(4)}x`;
}

/** True when the bet wins from the death order alone — the contract's `_won`. */
export function isWin(order: readonly number[], candle: number, ticket: TicketId): boolean {
  if (ticket === LAST_LIT) return order[5] === candle;
  return order[3] === candle || order[4] === candle || order[5] === candle;
}
