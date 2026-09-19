import { FINAL_THREE, LAST_LIT, type TicketId } from './constants';
import { survivorProbabilities } from './live';

/**
 * The reveal timeline (PRD §4.3): a deterministic schedule built from the death order, so the
 * vigil is paced by the outcome's geometry instead of a fixed timer. Every duration below is a
 * rule, not a scripted per-outcome cue:
 *
 *  - a base beat of 1.4 s between snuffs;
 *  - the beat where your ticket resolves gets a pre-hold before the stinger;
 *  - a beat where your candle's live chance crosses below 15 % holds longer;
 *  - a LAST LIT near-miss (your candle is one of the last two lit) runs its final beat in slow
 *    motion;
 *  - once your candle is already out, the rest of the vigil runs at half speed;
 *  - TURBO halves everything.
 */

/** Base beat between two snuffs. */
export const BASE_BEAT_MS = 1400;
/** Beats after your candle is already out run at this fraction of the base beat. */
export const DEAD_TICKET_SPEED = 0.5;
/** The near-miss beat stretches by this factor. */
export const NEAR_MISS_SLOWDOWN = 2.2;
/** Extra hold on the beat that resolves the ticket, before the stinger. */
export const RESOLVE_PREHOLD_MS = 250;
/** Extra hold on the beat where the pick's live chance crosses the tension threshold. */
export const TENSION_HOLD_MS = 400;
export const TENSION_THRESHOLD = 0.15;
/** Pause after the resolving snuff before the outcome is on screen. */
export const STINGER_MS = 700;
/** TURBO speed factor. */
export const TURBO_SPEED = 0.5;
/** Quiet moment before the first snuff, so the reveal does not start mid-blink. */
export const LEAD_IN_MS = 400;

/** Deaths shown before the ticket resolves: LAST LIT after the 5th snuff, FINAL THREE after the 3rd. */
export function resolveDeathCount(ticket: TicketId): number {
  return ticket === LAST_LIT ? 5 : 3;
}

export type Beat = {
  /** 0-based index into the death order. */
  index: number;
  /** The candle this beat snuffs out. */
  candle: number;
  /** Deaths visible once this beat has landed. */
  revealed: number;
  /** Offset from the start of the reveal, in ms. */
  landsAtMs: number;
  /** How long this beat holds after its snuff, before the next beat. */
  holdMs: number;
  /** This beat is the one that puts your candle out (a guaranteed loss). */
  killsPick: boolean;
  /** Your ticket resolves on this beat. */
  resolvesTicket: boolean;
  slowMo: boolean;
  tension: boolean;
};

export type Timeline = {
  beats: Beat[];
  /** From here the outcome is on screen. */
  resolveAtMs: number;
  /** From here the whole board is revealed — safe to `revealOutcome`. */
  revealCompleteAtMs: number;
};

/**
 * `order` is the death order from the contract (`order[5]` is the survivor). Only the
 * `order.length - 1` snuffs are scheduled; the survivor is never snuffed.
 */
export function buildTimeline(
  order: readonly number[],
  pick: number,
  ticket: TicketId,
  options: { turbo?: boolean } = {},
): Timeline {
  const speed = options.turbo ? TURBO_SPEED : 1;
  const resolveAt = resolveDeathCount(ticket);
  const pickDeath = order.indexOf(pick);
  const nearMiss = ticket === LAST_LIT && (order[4] === pick || order[5] === pick);

  /** The pick's live chance with `deaths` snuffs already on screen. */
  const chanceAt = (deaths: number): number => {
    const { num, den } = survivorProbabilities(ticket, order.slice(0, deaths))[pick];
    return Number(num) / Number(den);
  };

  const beats: Beat[] = [];
  let at = Math.round(LEAD_IN_MS * speed);

  for (let i = 0; i < order.length - 1; i++) {
    const revealed = i + 1;
    const chanceBefore = chanceAt(i);
    const previousChance = i === 0 ? 1 : chanceAt(i - 1);
    const stillLit = i <= pickDeath;
    // Only the beat that crosses the threshold holds — not every beat below it.
    const tension =
      stillLit && chanceBefore > 0 && chanceBefore < TENSION_THRESHOLD && previousChance >= TENSION_THRESHOLD;
    const killsPick = i === pickDeath;
    const resolvesTicket = revealed === resolveAt;
    const slowMo = i === order.length - 2 && nearMiss;

    let hold = BASE_BEAT_MS;
    if (i > pickDeath) hold *= DEAD_TICKET_SPEED;
    if (slowMo) hold *= NEAR_MISS_SLOWDOWN;
    if (resolvesTicket) hold += RESOLVE_PREHOLD_MS;
    if (tension) hold += TENSION_HOLD_MS;
    hold = Math.round(hold * speed);

    beats.push({
      index: i,
      candle: order[i],
      revealed,
      landsAtMs: at,
      holdMs: hold,
      killsPick,
      resolvesTicket,
      slowMo,
      tension,
    });
    at += hold;
  }

  const resolveBeat = beats.find(b => b.resolvesTicket) ?? beats[beats.length - 1];
  // The last beat's own hold paces nothing: the reveal is over once its snuff has landed, so the
  // board is complete one stinger after the final flame goes out (not a beat plus a stinger).
  const lastBeat = beats[beats.length - 1];

  return {
    beats,
    resolveAtMs: resolveBeat.landsAtMs + Math.round(STINGER_MS * speed),
    revealCompleteAtMs: lastBeat.landsAtMs + Math.round(STINGER_MS * speed),
  };
}

/**
 * The candle the player backed, and how far it got: `deaths` candles died before it (0 = it was
 * snuffed first, 5 = it survived). `null` when the order does not contain the pick.
 */
export function pickSurvival(
  order: readonly number[],
  pick: number,
): { deathsBefore: number; snuffedAt: number | null } {
  const index = order.indexOf(pick);
  if (index < 0) return { deathsBefore: 0, snuffedAt: null };
  // order[5] is the survivor: it is never snuffed.
  const snuffedAt = index === order.length - 1 ? null : index;
  return { deathsBefore: index, snuffedAt };
}

/** `THE 2ND OUT`, `THE LAST LIT` — how the result card narrates the pick's fate. */
export function fateLabel(order: readonly number[], pick: number): string {
  const { deathsBefore, snuffedAt } = pickSurvival(order, pick);
  if (snuffedAt === null) return 'THE LAST LIT';
  const ordinal = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'][deathsBefore] ?? `${deathsBefore + 1}TH`;
  return `THE ${ordinal} OUT`;
}

/** FINAL THREE resolves on the 3rd snuff, LAST LIT on the 5th. */
export function ticketResolvedOn(ticket: TicketId): number {
  return resolveDeathCount(ticket);
}

/** Re-exported so the stage can label the ticket without importing constants twice. */
export const TICKET_NAMES: Record<number, string> = {
  [LAST_LIT]: 'Last Lit',
  [FINAL_THREE]: 'Final Three',
};
